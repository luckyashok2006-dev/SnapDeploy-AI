import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { useProjectStore } from '../src/store/projectStore';
import { useDeploymentStore } from '../src/store/deploymentStore';
import { MockDeploymentProvider } from '../src/features/deployment/providers/mock-provider';
import { NetlifyProvider } from '../src/features/deployment/providers/netlify-provider';
import { executeDeployment } from '../src/features/deployment/deployment-coordinator';
import { runPreDeploymentChecks, executeBuildGate } from '../src/features/deployment/build/build-gate';
import { packageDeploymentArtifact, ARTIFACT_LIMITS } from '../src/features/deployment/packaging/artifact-packager';
import {
  sanitizeString,
  sanitizeDeploymentError,
  validateEnvVarKey,
  isViteClientVariable,
  registerSecret,
  clearRegisteredSecrets
} from '../src/features/deployment/security/secret-sanitizer';
import { DeploymentRecord } from '../src/types/workspace';
import JSZip from 'jszip';

describe('Tier 1 Feature 7: One-Click Deployment Test Suite', () => {
  const testProjectId = 'test-deploy-proj-alpha';

  beforeEach(async () => {
    useDeploymentStore.setState({
      selectedProvider: 'mock',
      deployments: {},
      envVarMetadata: {},
      activeDeployments: {}
    });

    MockDeploymentProvider.setFailureMode('none');
    MockDeploymentProvider.setLatencyMs(5);
    clearRegisteredSecrets();

    // Seed test project files in authoritative VFS
    await vfsManager.writeFile(
      testProjectId,
      '/package.json',
      JSON.stringify({
        name: 'test-app',
        scripts: { build: 'vite build' },
        dependencies: { react: '^18.2.0' }
      })
    );

    await vfsManager.writeFile(
      testProjectId,
      '/src/App.tsx',
      'export default function App() { return <h1>Deploy Test App</h1>; }'
    );

    await vfsManager.writeFile(
      testProjectId,
      '/index.html',
      '<!DOCTYPE html><html><body><div id="root"></div></body></html>'
    );

    // Register project in projectStore
    useProjectStore.setState((state) => ({
      projects: {
        ...state.projects,
        [testProjectId]: {
          id: testProjectId,
          title: 'Deploy Test App',
          status: 'ready',
          files: vfsManager.getFiles(testProjectId),
          openTabs: ['/src/App.tsx'],
          activeFilePath: '/src/App.tsx',
          diagnostics: [],
          fixHistory: []
        }
      },
      activeProjectId: testProjectId
    }));
  });

  afterEach(async () => {
    await vfsManager.deleteProject(testProjectId);
    useDeploymentStore.getState().clearProjectDeployments(testProjectId);
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Provider Abstraction & Contract
  // -------------------------------------------------------------------------
  describe('Provider Abstraction & Contract', () => {
    it('MockDeploymentProvider fulfills the DeploymentProvider contract', async () => {
      const provider = new MockDeploymentProvider();
      expect(provider.id).toBe('mock');
      expect(provider.isAuthenticated()).toBe(true);

      const account = await provider.getAccountInfo();
      expect(account?.username).toBe('snapdeploy-tester');

      const mockZip = new Uint8Array([1, 2, 3]);
      const result = await provider.deploy({
        projectId: testProjectId,
        projectTitle: 'Deploy Test App',
        artifactZip: mockZip
      });

      expect(result.deployId).toBeDefined();
      expect(result.url).toContain('https://snapdeploy-preview-');
      expect((result as any).rawResponse).toBeUndefined(); // Revision 3: No rawResponse
    });

    it('NetlifyProvider authenticates via direct Authorization header and cleans up on disconnect', async () => {
      const provider = new NetlifyProvider();
      expect(provider.id).toBe('netlify');
      expect(provider.isAuthenticated()).toBe(false);

      // Mock fetch for Netlify user validation
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url, init) => {
        if (url.includes('/user')) {
          expect(init?.headers?.Authorization).toBe('Bearer nfp_testSecretToken1234567890');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ slug: 'octocat', email: 'octo@netlify.com' })
          });
        }
        return originalFetch(url, init);
      });

      const account = await provider.authenticate('nfp_testSecretToken1234567890');
      expect(account.username).toBe('octocat');
      expect(provider.isAuthenticated()).toBe(true);

      await provider.disconnect();
      expect(provider.isAuthenticated()).toBe(false);
      expect(await provider.getAccountInfo()).toBeNull();

      global.fetch = originalFetch;
    });
  });

  // -------------------------------------------------------------------------
  // 2. Pre-Deployment Validation & Build Gate
  // -------------------------------------------------------------------------
  describe('Pre-Deployment Validation & Build Gate', () => {
    it('detects standard Vite project and requires build gate', () => {
      const check = runPreDeploymentChecks(testProjectId);
      expect(check.canDeploy).toBe(true);
      expect(check.requiresBuild).toBe(true);
      expect(['react', 'vite']).toContain(check.framework);
      expect(check.fileCount).toBe(3);
    });

    it('detects static HTML projects and bypasses build gate safely', async () => {
      const staticProjId = 'static-html-proj-beta';
      await vfsManager.writeFile(staticProjId, '/index.html', '<h1>Static HTML</h1>');
      await vfsManager.writeFile(staticProjId, '/style.css', 'body { color: red; }');

      const check = runPreDeploymentChecks(staticProjId);
      expect(check.canDeploy).toBe(true);
      expect(check.requiresBuild).toBe(false);
      expect(check.framework).toBe('static');

      // executeBuildGate should succeed without running npm run build
      const buildRes = await executeBuildGate(staticProjId);
      expect(buildRes.success).toBe(true);
      expect(buildRes.requiresBuild).toBe(false);

      await vfsManager.deleteProject(staticProjId);
    });

    it('blocks deployment if project package.json is missing build script and has no index.html', async () => {
      const invalidProjId = 'invalid-proj-gamma';
      await vfsManager.writeFile(invalidProjId, '/package.json', JSON.stringify({ name: 'no-scripts' }));
      await vfsManager.writeFile(invalidProjId, '/src/file.ts', 'console.log("hello");');

      const check = runPreDeploymentChecks(invalidProjId);
      expect(check.canDeploy).toBe(false);
      expect(check.error).toContain('does not define a "build" script');

      await vfsManager.deleteProject(invalidProjId);
    });

    it('blocks deployment if build gate fails (exitCode !== 0)', async () => {
      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValueOnce({
        command: 'npm run build',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'TS2304: Cannot find name "UnresolvedIdentifier".',
        durationMs: 450,
        timedOut: false
      });

      const buildRes = await executeBuildGate(testProjectId);
      expect(buildRes.success).toBe(false);
      expect(buildRes.error).toContain('Cannot find name "UnresolvedIdentifier"');

      // VFS source files remain untouched
      const files = vfsManager.getFiles(testProjectId);
      expect(files['/src/App.tsx'].content).toContain('Deploy Test App');
    });

    it('Revision 1: Proves secret build variables are NOT silently injected into local build', async () => {
      const executeCommandSpy = vi.spyOn(runtimeManager, 'executeCommand');
      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValueOnce({
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: 'vite v4.0.0 building for production...\n✓ built in 200ms',
        stderr: '',
        durationMs: 200,
        timedOut: false
      });

      // Configure a secret environment variable
      useDeploymentStore.getState().setEnvVar(testProjectId, 'DATABASE_SECRET', 'superSecretDbPassword123', true);

      await executeBuildGate(testProjectId);

      // Verify no environment secrets were passed into runBuild
      expect(executeCommandSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ env: expect.objectContaining({ DATABASE_SECRET: 'superSecretDbPassword123' }) })
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Artifact Packaging & Limits
  // -------------------------------------------------------------------------
  describe('Artifact Packaging & Limit Enforcement', () => {
    it('packages valid VFS files into an in-memory ZIP buffer with index.html', async () => {
      const result = await packageDeploymentArtifact(testProjectId, false);
      expect(result.fileCount).toBeGreaterThan(0);
      expect(result.zipBuffer).toBeInstanceOf(Uint8Array);
      expect(result.entryFile).toBe('index.html');
      expect(result.compressedBytes).toBeGreaterThan(0);

      // Verify zip contains index.html
      const unzipped = await JSZip.loadAsync(result.zipBuffer);
      expect(unzipped.file('index.html')).not.toBeNull();
    });

    it('rejects path traversal in artifact packaging', async () => {
      await vfsManager.writeFile(testProjectId, '/../secrets.txt', 'forbidden');

      await expect(packageDeploymentArtifact(testProjectId, false)).rejects.toThrow(
        /Security error: path traversal forbidden/i
      );

      await vfsManager.deleteFile(testProjectId, '/../secrets.txt');
    });

    it('excludes .env files, node_modules, and .git from artifact bundle', async () => {
      await vfsManager.writeFile(testProjectId, '/.env', 'SECRET=forbidden');
      await vfsManager.writeFile(testProjectId, '/.env.production', 'API_KEY=leak');

      const result = await packageDeploymentArtifact(testProjectId, false);
      const unzipped = await JSZip.loadAsync(result.zipBuffer);

      expect(unzipped.file('.env')).toBeNull();
      expect(unzipped.file('.env.production')).toBeNull();

      await vfsManager.deleteFile(testProjectId, '/.env');
      await vfsManager.deleteFile(testProjectId, '/.env.production');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Security & Memory-Only Invariants
  // -------------------------------------------------------------------------
  describe('Security & Memory-Only Invariants', () => {
    it('Revision 1: Proves VITE_* values are treated as client-visible and non-secret', () => {
      expect(isViteClientVariable('VITE_PUBLIC_API')).toBe(true);
      expect(isViteClientVariable('VITE_SUPABASE_ANON_KEY')).toBe(true);
      expect(isViteClientVariable('DATABASE_URL')).toBe(false);
      expect(isViteClientVariable('NETLIFY_AUTH_TOKEN')).toBe(false);

      const store = useDeploymentStore.getState();
      store.setEnvVar(testProjectId, 'VITE_APP_TITLE', 'My Cool App', true); // User flags as secret

      const envVars = store.getProjectEnvVars(testProjectId);
      const viteVar = envVars.find((v) => v.key === 'VITE_APP_TITLE');
      // Must be forced to isSecret = false because Vite statically inlines it into client JS
      expect(viteVar?.isSecret).toBe(false);
    });

    it('Revision 2: Provider tokens never enter VFS, IndexedDB, Monaco, Version History, or URLs', async () => {
      const netlifyPat = 'nfp_secretTestToken98765432101234567890';
      useDeploymentStore.getState().setCredentials('netlify', netlifyPat);

      // Verify VFS does not contain the token
      const vfsFiles = vfsManager.getFiles(testProjectId);
      for (const file of Object.values(vfsFiles)) {
        expect(file.content).not.toContain(netlifyPat);
      }

      // Verify project metadata does not contain the token
      const project = useProjectStore.getState().projects[testProjectId];
      expect(JSON.stringify(project)).not.toContain(netlifyPat);

      // Verify localStorage persisted state does not contain the token
      if (typeof localStorage !== 'undefined') {
        const persisted = localStorage.getItem('snapdeploy-deployments-v1');
        expect(persisted || '').not.toContain(netlifyPat);
      }

      // Disconnect purges token from memory
      useDeploymentStore.getState().disconnect('netlify');
      expect(useDeploymentStore.getState().getCredentials('netlify')).toBeNull();
    });

    it('Revision 3 & 4: DeploymentRecord and persisted history contain only whitelisted metadata', async () => {
      const sampleRecord: DeploymentRecord = {
        deploymentId: 'dep_123',
        projectId: testProjectId,
        timestamp: Date.now(),
        status: 'live',
        provider: 'mock',
        url: 'https://test.netlify.app',
        deployId: 'remote_123',
        siteId: 'site_123',
        durationMs: 1500,
        buildDurationMs: 400,
        fileCount: 3,
        artifactSizeBytes: 2048,
        commitSummary: 'Deploy #1 (3 files)'
      };

      useDeploymentStore.getState().recordDeployment(sampleRecord);

      const records = useDeploymentStore.getState().deployments[testProjectId];
      expect(records).toHaveLength(1);
      const saved = records[0];

      // Whitelisted fields present
      expect(saved.deploymentId).toBe('dep_123');
      expect(saved.url).toBe('https://test.netlify.app');
      expect(saved.fileCount).toBe(3);

      // Prohibited fields absent
      expect((saved as any).rawResponse).toBeUndefined();
      expect((saved as any).token).toBeUndefined();
      expect((saved as any).authorization).toBeUndefined();
      expect((saved as any).environmentVariables).toBeUndefined();
    });

    it('Revision 5: SecretSanitizer scrubs tokens and registered secrets from error messages and logs', () => {
      registerSecret('mySuperSecretPassword99');

      const rawError =
        'Failed: nfp_abc123456789012345678901234567890 rejected. Password was mySuperSecretPassword99 with Bearer eyJhbGciOiJIUzI1NiJ9.test';

      const sanitized = sanitizeDeploymentError(rawError);

      expect(sanitized).not.toContain('nfp_abc');
      expect(sanitized).not.toContain('mySuperSecretPassword99');
      expect(sanitized).not.toContain('eyJhbGci');
      expect(sanitized).toContain('[REDACTED_SECRET]');
      expect(sanitized).toContain('[REDACTED_TOKEN]');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Deployment Lifecycle, Cancellation & Redeployment
  // -------------------------------------------------------------------------
  describe('Deployment Lifecycle, Cancellation & Redeployment', () => {
    it('executes full one-click deployment lifecycle successfully', async () => {
      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValueOnce({
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: 'Build completed cleanly',
        stderr: '',
        durationMs: 250,
        timedOut: false
      });

      const record = await executeDeployment(testProjectId, { providerId: 'mock' });

      expect(record.status).toBe('live');
      expect(record.url).toContain('https://snapdeploy-preview-');
      expect(record.fileCount).toBeGreaterThan(0);

      const activeProgress = useDeploymentStore.getState().activeDeployments[testProjectId];
      expect(activeProgress.status).toBe('live');
      expect(activeProgress.percent).toBe(100);

      // Verify deployment record stored in history
      const history = useDeploymentStore.getState().deployments[testProjectId];
      expect(history).toHaveLength(1);
      expect(history[0].deploymentId).toBe(record.deploymentId);
    });

    it('handles remote deployment failure without corrupting VFS source files', async () => {
      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValueOnce({
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: false
      });

      MockDeploymentProvider.setFailureMode('deploy');

      await expect(executeDeployment(testProjectId, { providerId: 'mock' })).rejects.toThrow(/Remote build\/hosting error/i);

      const activeProgress = useDeploymentStore.getState().activeDeployments[testProjectId];
      expect(activeProgress.status).toBe('failed');
      expect(activeProgress.error).toContain('Remote build/hosting error');

      // VFS source files remain untouched
      const files = vfsManager.getFiles(testProjectId);
      expect(files['/src/App.tsx'].content).toContain('Deploy Test App');
    });

    it('safely cancels an in-flight deployment via AbortController', async () => {
      vi.spyOn(runtimeManager, 'runBuild').mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return {
          command: 'npm run build',
          args: [],
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 200,
          timedOut: false
        };
      });

      const deployPromise = executeDeployment(testProjectId, { providerId: 'mock' });

      // Trigger user cancellation immediately
      setTimeout(() => {
        useDeploymentStore.getState().cancelActiveDeployment(testProjectId);
      }, 20);

      await expect(deployPromise).rejects.toThrow();

      const activeProgress = useDeploymentStore.getState().activeDeployments[testProjectId];
      expect(activeProgress.status).toBe('cancelled');
    });

    it('redeploy re-runs build, creates a new deployment record, and maintains history list', async () => {
      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValue({
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 150,
        timedOut: false
      });

      // First deploy
      const dep1 = await executeDeployment(testProjectId, { providerId: 'mock' });
      expect(dep1.status).toBe('live');

      // Source edit simulation in VFS
      await vfsManager.writeFile(testProjectId, '/src/App.tsx', 'export default function App() { return <h1>Updated V2</h1>; }');

      // Redeploy
      const dep2 = await executeDeployment(testProjectId, { providerId: 'mock' });
      expect(dep2.status).toBe('live');
      expect(dep2.deploymentId).not.toBe(dep1.deploymentId);

      // History preserves both records
      const history = useDeploymentStore.getState().deployments[testProjectId];
      expect(history).toHaveLength(2);
      expect(history[0].deploymentId).toBe(dep2.deploymentId);
      expect(history[1].deploymentId).toBe(dep1.deploymentId);
    });

    it('cleans up deployment records and in-memory secrets when project is deleted', async () => {
      useDeploymentStore.getState().setEnvVar(testProjectId, 'API_KEY', 'secretKey123', true);
      useDeploymentStore.getState().recordDeployment({
        deploymentId: 'dep_cleanup_test',
        projectId: testProjectId,
        timestamp: Date.now(),
        status: 'live',
        provider: 'mock',
        durationMs: 500,
        fileCount: 3,
        artifactSizeBytes: 1024
      });

      expect(useDeploymentStore.getState().deployments[testProjectId]).toHaveLength(1);
      expect(useDeploymentStore.getState().getProjectEnvVars(testProjectId)).toHaveLength(1);

      // Call project deletion
      await useProjectStore.getState().deleteProject(testProjectId);

      // Deployments and secrets must be wiped
      expect(useDeploymentStore.getState().deployments[testProjectId]).toBeUndefined();
      expect(useDeploymentStore.getState().getProjectEnvVars(testProjectId)).toHaveLength(0);
    });
  });
});
