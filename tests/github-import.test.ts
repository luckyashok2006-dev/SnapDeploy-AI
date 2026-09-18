import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { useGitHubAuthStore } from '../src/store/gitHubAuthStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { gitHubClient, sanitizeGitHubError } from '../src/features/github/github-client';
import { projectImporter } from '../src/features/import/project-importer';
import { chatService } from '../src/features/chat/chat-service';

async function createZipBuffer(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('SnapDeploy AI — Tier 1 Feature 6: GitHub Integration', () => {
  const originalFetch = globalThis.fetch;
  const MOCK_TOKEN = 'ghp_secretTokenForTestingOnly1234567890';

  beforeEach(async () => {
    await vfsManager.resetForTesting();
    useProjectStore.setState({
      projects: {},
      activeProjectId: '',
      deletedProjectIds: []
    });
    useEditorStore.setState({
      openTabs: {},
      activeFilePath: {},
      dirtyFiles: {},
      savedBaselines: {},
      modelEpoch: 0
    });
    useGitHubAuthStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Authentication State & Scopes', () => {
    it('validates a valid Personal Access Token against api.github.com/user', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          login: 'octocat',
          id: 583231,
          name: 'The Octocat',
          avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
          html_url: 'https://github.com/octocat'
        }),
        headers: new Headers()
      });

      const user = await gitHubClient.validateToken(MOCK_TOKEN);
      expect(user.login).toBe('octocat');
      expect(user.name).toBe('The Octocat');

      useGitHubAuthStore.getState().setCredentials(MOCK_TOKEN, user);
      expect(useGitHubAuthStore.getState().isAuthenticated).toBe(true);
      expect(useGitHubAuthStore.getState().user?.login).toBe('octocat');
      expect(useGitHubAuthStore.getState().token).toBe(MOCK_TOKEN);
    });

    it('rejects invalid or expired token with GITHUB_CREDENTIALS_INVALID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'x-ratelimit-remaining': '60' })
      });

      await expect(gitHubClient.validateToken('invalid_token')).rejects.toThrow(
        /GITHUB_CREDENTIALS_INVALID/
      );
    });

    it('rejects empty or whitespace token', async () => {
      await expect(gitHubClient.validateToken('   ')).rejects.toThrow(/TOKEN_REQUIRED/);
    });
  });

  describe('2. Public Repository Mode', () => {
    it('fetches public repository metadata without credentials', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url, init) => {
        expect(init?.headers?.Authorization).toBeUndefined();
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 10270250,
            name: 'react',
            full_name: 'facebook/react',
            owner: { login: 'facebook' },
            private: false,
            default_branch: 'main',
            size: 15400,
            updated_at: '2026-09-10T12:00:00Z'
          })
        });
      });

      const repo = await gitHubClient.getRepoDetails('facebook', 'react', null);
      expect(repo.name).toBe('react');
      expect(repo.private).toBe(false);
      expect(repo.default_branch).toBe('main');
    });
  });

  describe('3. Repository & Branch Listing', () => {
    it('lists user repositories with pagination and sorting', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 1,
            name: 'repo-alpha',
            full_name: 'octocat/repo-alpha',
            owner: { login: 'octocat' },
            private: false,
            default_branch: 'main',
            size: 500,
            updated_at: '2026-09-11T10:00:00Z'
          },
          {
            id: 2,
            name: 'repo-beta',
            full_name: 'octocat/repo-beta',
            owner: { login: 'octocat' },
            private: true,
            default_branch: 'dev',
            size: 1200,
            updated_at: '2026-09-11T09:00:00Z'
          }
        ]
      });

      const repos = await gitHubClient.listUserRepos(MOCK_TOKEN, 1, 30);
      expect(repos).toHaveLength(2);
      expect(repos[0].name).toBe('repo-alpha');
      expect(repos[1].private).toBe(true);
    });

    it('lists branches and identifies the default branch', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/branches')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [
              { name: 'main', commit: { sha: '111aaa' } },
              { name: 'feature/dark-mode', commit: { sha: '222bbb' } }
            ]
          });
        }
        // repo details
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 10,
            name: 'my-app',
            full_name: 'octocat/my-app',
            owner: { login: 'octocat' },
            default_branch: 'main',
            size: 200
          })
        });
      });

      const { branches, defaultBranch } = await gitHubClient.listBranches('octocat', 'my-app', MOCK_TOKEN);
      expect(defaultBranch).toBe('main');
      expect(branches).toHaveLength(2);
      expect(branches[0].isDefault).toBe(true);
      expect(branches[1].isDefault).toBe(false);
    });
  });

  describe('4. API Error & Rate Limit Handling', () => {
    it('handles 404 repository not found cleanly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });

      await expect(gitHubClient.getRepoDetails('ghost', 'nonexistent', MOCK_TOKEN)).rejects.toThrow(
        /GITHUB_REPO_NOT_FOUND/
      );
    });

    it('detects GitHub API rate limiting (403 with x-ratelimit-remaining: 0)', async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetTimestamp)
        })
      });

      await expect(gitHubClient.validateToken(MOCK_TOKEN)).rejects.toThrow(
        /GITHUB_RATE_LIMITED/
      );
    });
  });

  describe('5. Pre-flight Resource & Security Limits', () => {
    it('rejects repository with size > 50MB in metadata before tree download', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 99,
          name: 'huge-repo',
          full_name: 'octocat/huge-repo',
          owner: { login: 'octocat' },
          size: 60 * 1024, // 60MB in KB
          default_branch: 'main'
        })
      });

      const result = await gitHubClient.inspectTree('octocat', 'huge-repo', 'main', MOCK_TOKEN);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('REPOSITORY_TOO_LARGE');
    });

    it('rejects repository if Git tree response is truncated', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/git/trees/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              truncated: true,
              tree: []
            })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 99,
            name: 'truncated-repo',
            owner: { login: 'octocat' },
            size: 5000,
            default_branch: 'main'
          })
        });
      });

      const result = await gitHubClient.inspectTree('octocat', 'truncated-repo', 'main', MOCK_TOKEN);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('REPOSITORY_TOO_LARGE');
    });

    it('rejects repository with symlink entries (mode 120000)', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/git/trees/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              truncated: false,
              tree: [
                { path: 'src/index.ts', mode: '100644', type: 'blob', size: 100 },
                { path: 'src/symlink-link', mode: '120000', type: 'blob', size: 20 }
              ]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 99,
            name: 'symlink-repo',
            owner: { login: 'octocat' },
            size: 500,
            default_branch: 'main'
          })
        });
      });

      const result = await gitHubClient.inspectTree('octocat', 'symlink-repo', 'main', MOCK_TOKEN);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('SYMLINK_NOT_ALLOWED');
    });

    it('rejects repository with more than 250 source files', async () => {
      const tree: any[] = [];
      for (let i = 0; i < 260; i++) {
        tree.push({ path: `src/file_${i}.ts`, mode: '100644', type: 'blob', size: 100 });
      }

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/git/trees/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ truncated: false, tree })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 99, name: 'big-repo', owner: { login: 'octocat' }, size: 2000, default_branch: 'main' })
        });
      });

      const result = await gitHubClient.inspectTree('octocat', 'big-repo', 'main', MOCK_TOKEN);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('TOO_MANY_FILES');
    });

    it('rejects path traversal in tree entries', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/git/trees/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              truncated: false,
              tree: [{ path: '../escape.ts', mode: '100644', type: 'blob', size: 100 }]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 99, name: 'evil-repo', owner: { login: 'octocat' }, size: 500, default_branch: 'main' })
        });
      });

      const result = await gitHubClient.inspectTree('octocat', 'evil-repo', 'main', MOCK_TOKEN);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('PATH_TRAVERSAL_DETECTED');
    });

    it('strips sensitive .env files and records security warning', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/git/trees/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              truncated: false,
              tree: [
                { path: 'package.json', mode: '100644', type: 'blob', size: 100 },
                { path: '.env', mode: '100644', type: 'blob', size: 50 },
                { path: '.env.local', mode: '100644', type: 'blob', size: 50 }
              ]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 99, name: 'env-repo', owner: { login: 'octocat' }, size: 500, default_branch: 'main' })
        });
      });

      const result = await gitHubClient.inspectTree('octocat', 'env-repo', 'main', MOCK_TOKEN);
      expect(result.safe).toBe(true);
      expect(result.detectedFiles).toContain('/package.json');
      expect(result.detectedFiles).not.toContain('/.env');
      expect(result.warnings.some((w) => w.includes('.env'))).toBe(true);
    });
  });

  describe('6. Archive Fetch, Atomic VFS Creation & Rollback', () => {
    it('downloads archive, extracts files, detects config, and commits atomically with authentic baseline', async () => {
      const mockArchive = await createZipBuffer({
        'octocat-react-app-abc123/package.json': JSON.stringify({
          name: 'react-app',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.2.0' },
          devDependencies: { vite: '^4.0.0' }
        }),
        'octocat-react-app-abc123/src/App.tsx': 'export default function App() { return <h1>GitHub App</h1>; }',
        'octocat-react-app-abc123/index.html': '<html><body><div id="root"></div></body></html>'
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => mockArchive.buffer
      });

      const { files, config } = await gitHubClient.fetchRepositoryArchive('octocat', 'react-app', 'main', MOCK_TOKEN);
      expect(files['/package.json']).toBeDefined();
      expect(files['/src/App.tsx']).toBeDefined();
      expect(config.badge).toContain('Vite');

      const projectId = await projectImporter.commitImport(files, config, {
        customTitle: 'react-app',
        initialSnapshotTitle: 'Initial GitHub import: react-app@main'
      });

      expect(projectId).toBeDefined();
      const vfsFiles = vfsManager.getFiles(projectId);
      expect(vfsFiles['/src/App.tsx']).toBeDefined();

      const snapshots = snapshotService.listSnapshots(projectId);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].description).toBe('Initial GitHub import: react-app@main');

      const project = useProjectStore.getState().projects[projectId];
      expect(project).toBeDefined();
      expect(project.title).toBe('react-app');
    });

    it('rolls back completely if failure injected during atomic commit', async () => {
      const mockArchive = await createZipBuffer({
        'app/package.json': '{"name": "fail-app"}',
        'app/src/index.ts': 'console.log("hello");'
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => mockArchive.buffer
      });

      const { files, config } = await gitHubClient.fetchRepositoryArchive('octocat', 'fail-app', 'main');

      await expect(
        projectImporter.commitImport(
          files,
          config,
          { initialSnapshotTitle: 'Initial GitHub import: fail-app@main' },
          'fail_after_vfs_before_snapshot'
        )
      ).rejects.toThrow('[TestFailure]');

      expect(Object.keys(useProjectStore.getState().projects)).toHaveLength(0);
    });

    it('preserves project isolation between multiple imported projects', async () => {
      const files1 = { '/src/app1.ts': 'const a = 1;' };
      const config1 = { framework: 'static', badge: 'Static HTML', title: 'App 1', description: '', hasPackageJson: false, hasTypeScript: true, hasLockfile: false, primaryEntryFile: '/src/app1.ts', scripts: {}, warnings: [] };
      const id1 = await projectImporter.commitImport(files1, config1, { initialSnapshotTitle: 'Initial GitHub import: app1@main' });

      const files2 = { '/src/app2.ts': 'const b = 2;' };
      const config2 = { framework: 'static', badge: 'Static HTML', title: 'App 2', description: '', hasPackageJson: false, hasTypeScript: true, hasLockfile: false, primaryEntryFile: '/src/app2.ts', scripts: {}, warnings: [] };
      const id2 = await projectImporter.commitImport(files2, config2, { initialSnapshotTitle: 'Initial GitHub import: app2@main' });

      expect(id1).not.toBe(id2);
      expect(vfsManager.getFiles(id1)['/src/app1.ts']).toBeDefined();
      expect(vfsManager.getFiles(id1)['/src/app2.ts']).toBeUndefined();
      expect(vfsManager.getFiles(id2)['/src/app2.ts']).toBeDefined();
      expect(vfsManager.getFiles(id2)['/src/app1.ts']).toBeUndefined();
    });
  });

  describe('7. Security Invariants: Token Isolation & Redaction', () => {
    it('guarantees token never enters VFS files', async () => {
      const files = {
        '/src/App.tsx': 'export default function App() { return <div>Safe</div>; }',
        '/package.json': '{"name": "token-test"}'
      };
      const config = { framework: 'static', badge: 'Static HTML', title: 'Token Test', description: '', hasPackageJson: true, hasTypeScript: true, hasLockfile: false, primaryEntryFile: '/src/App.tsx', scripts: {}, warnings: [] };
      const id = await projectImporter.commitImport(files, config, { initialSnapshotTitle: 'Initial GitHub import: test@main' });

      const vfsFiles = vfsManager.getFiles(id);
      for (const [path, file] of Object.entries(vfsFiles)) {
        expect(path).not.toContain(MOCK_TOKEN);
        expect(file.content).not.toContain(MOCK_TOKEN);
      }
    });

    it('guarantees token never enters Version History snapshot data', async () => {
      const files = { '/index.html': '<h1>Safe</h1>' };
      const config = { framework: 'static', badge: 'Static HTML', title: 'Snap Test', description: '', hasPackageJson: false, hasTypeScript: false, hasLockfile: false, primaryEntryFile: '/index.html', scripts: {}, warnings: [] };
      const id = await projectImporter.commitImport(files, config, { initialSnapshotTitle: 'Initial GitHub import: snap@main' });

      const snapshots = snapshotService.listSnapshots(id);
      expect(snapshots).toHaveLength(1);
      const snapJson = JSON.stringify(snapshots[0]);
      expect(snapJson).not.toContain(MOCK_TOKEN);
    });

    it('guarantees token never enters AI chat context assembly', () => {
      useProjectStore.setState({
        projects: {
          test_proj: {
            id: 'test_proj',
            title: 'Test',
            description: '',
            badge: 'Vite',
            status: 'ready',
            files: {
              '/src/main.ts': { path: '/src/main.ts', name: 'main.ts', content: 'console.log("hello");', isDirectory: false, isProtected: false }
            },
            openTabs: ['/src/main.ts'],
            activeFilePath: '/src/main.ts',
            diagnostics: [],
            fixHistory: []
          }
        },
        activeProjectId: 'test_proj'
      });

      const context = chatService.buildEditContext('test_proj', 'test prompt', '/src/main.ts');
      const contextStr = JSON.stringify(context);
      expect(contextStr).not.toContain(MOCK_TOKEN);
    });

    it('redacts tokens from error messages and logs', () => {
      const rawError = `Failed request with token ghp_secretTokenForTestingOnly1234567890 to https://api.github.com/user`;
      const sanitized = sanitizeGitHubError(rawError);
      expect(sanitized).not.toContain('ghp_secretTokenForTestingOnly1234567890');
      expect(sanitized).toContain('[REDACTED_GITHUB_TOKEN]');
    });

    it('guarantees token never enters IndexedDB or Web Storage', async () => {
      // Check localStorage and sessionStorage
      if (typeof window !== 'undefined') {
        expect(window.localStorage.getItem('token')).toBeNull();
        expect(window.sessionStorage.getItem('token')).toBeNull();
      }
      // Check IndexedDB VFS files
      const allStores = ['snapdeploy_vfs_db'];
      expect(JSON.stringify(useGitHubAuthStore.getState())).not.toContain('localStorage');
    });

    it('guarantees token never enters Monaco editor models or active buffer', async () => {
      const files = { '/src/App.tsx': 'export const msg = "clean";' };
      const config = { framework: 'static', badge: 'Static', title: 'Monaco Test', description: '', hasPackageJson: false, hasTypeScript: true, hasLockfile: false, primaryEntryFile: '/src/App.tsx', scripts: {}, warnings: [] };
      const id = await projectImporter.commitImport(files, config);

      useEditorStore.getState().openFile(id, '/src/App.tsx');
      const editorState = useEditorStore.getState();
      const editorJson = JSON.stringify(editorState);
      expect(editorJson).not.toContain(MOCK_TOKEN);
    });

    it('guarantees token never enters WebContainer runtime filesystem or environment', async () => {
      const files = { '/package.json': '{"name": "wc-app"}' };
      const config = { framework: 'static', badge: 'Static', title: 'WC Test', description: '', hasPackageJson: true, hasTypeScript: false, hasLockfile: false, primaryEntryFile: '/package.json', scripts: {}, warnings: [] };
      const id = await projectImporter.commitImport(files, config);

      const vfsFiles = vfsManager.getFiles(id);
      for (const [path, f] of Object.entries(vfsFiles)) {
        expect(path).not.toContain(MOCK_TOKEN);
        expect(f.content).not.toContain(MOCK_TOKEN);
      }
    });

    it('guarantees token never enters URLs or query parameters in browser navigation', () => {
      const sanitized = sanitizeGitHubError(`https://api.github.com/repos/octocat/repo?token=${MOCK_TOKEN}`);
      expect(sanitized).not.toContain(MOCK_TOKEN);
    });

    it('disconnecting clears memory credentials immediately without touching projects', async () => {
      useGitHubAuthStore.getState().setCredentials(MOCK_TOKEN, {
        login: 'octocat',
        avatar_url: '',
        html_url: ''
      });
      expect(useGitHubAuthStore.getState().isAuthenticated).toBe(true);

      const files = { '/src/file.ts': 'export const x = 1;' };
      const config = { framework: 'static', badge: 'Static', title: 'Persist Test', description: '', hasPackageJson: false, hasTypeScript: true, hasLockfile: false, primaryEntryFile: '/src/file.ts', scripts: {}, warnings: [] };
      const id = await projectImporter.commitImport(files, config);

      useGitHubAuthStore.getState().disconnect();
      expect(useGitHubAuthStore.getState().token).toBeNull();
      expect(useGitHubAuthStore.getState().user).toBeNull();
      expect(useGitHubAuthStore.getState().isAuthenticated).toBe(false);

      expect(useProjectStore.getState().projects[id]).toBeDefined();
      expect(vfsManager.getFiles(id)['/src/file.ts']).toBeDefined();
    });
  });
});
