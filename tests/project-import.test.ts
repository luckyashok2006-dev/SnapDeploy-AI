import { describe, it, expect, beforeEach, vi } from 'vitest';
import JSZip from 'jszip';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import {
  validateAndExtractArchive,
  sanitizeArchivePath,
  isExcludedPath,
  isSensitiveEnvFile,
  MAX_ZIP_COMPRESSED_BYTES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  MAX_EXTRACTED_FILES,
  MAX_SINGLE_FILE_BYTES
} from '../src/features/import/import-validator';
import { detectProjectConfiguration, formatProjectTitle } from '../src/features/import/project-detector';
import { projectImporter } from '../src/features/import/project-importer';
import { chatService } from '../src/features/chat/chat-service';

async function createZipBuffer(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('SnapDeploy AI — Tier 1 Feature 5: Import Existing Project', () => {
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
    vi.restoreAllMocks();
  });

  describe('1. Path Sanitization & Traversal Rejection', () => {
    it('normalizes valid relative paths and removes leading redundant slashes', () => {
      expect(sanitizeArchivePath('src/App.tsx').sanitized).toBe('src/App.tsx');
      expect(sanitizeArchivePath('src/components/Header.tsx').sanitized).toBe('src/components/Header.tsx');
      expect(sanitizeArchivePath('src\\components\\Header.tsx').sanitized).toBe('src/components/Header.tsx');
    });

    it('rejects path traversal attempts containing .. segments', () => {
      expect(sanitizeArchivePath('../etc/passwd').error).toBe('PATH_TRAVERSAL_DETECTED');
      expect(sanitizeArchivePath('src/../../secrets.json').error).toBe('PATH_TRAVERSAL_DETECTED');
      expect(sanitizeArchivePath('..\\Windows\\System32').error).toBe('PATH_TRAVERSAL_DETECTED');
    });

    it('rejects absolute paths and Windows drive letters', () => {
      expect(sanitizeArchivePath('/etc/passwd').error).toBe('ABSOLUTE_OR_DRIVE_PATH');
      expect(sanitizeArchivePath('\\etc\\passwd').error).toBe('ABSOLUTE_OR_DRIVE_PATH');
      expect(sanitizeArchivePath('C:\\Windows\\system32').error).toBe('ABSOLUTE_OR_DRIVE_PATH');
      expect(sanitizeArchivePath('D:/project/code.js').error).toBe('ABSOLUTE_OR_DRIVE_PATH');
    });

    it('rejects null bytes and ASCII control characters', () => {
      expect(sanitizeArchivePath('src/file\0.js').error).toBe('INVALID_CHARACTERS');
      expect(sanitizeArchivePath('src/bad\x07file.js').error).toBe('INVALID_CHARACTERS');
    });
  });

  describe('2. Archive Extraction, Validation & Exclusion Rules', () => {
    it('extracts valid web project files correctly', async () => {
      const zipData = await createZipBuffer({
        'package.json': JSON.stringify({ name: 'my-app', version: '1.0.0' }),
        'src/App.tsx': 'export const App = () => <div>Hello World</div>;',
        'src/index.css': 'body { margin: 0; }',
        'index.html': '<!doctype html><html><body><div id="root"></div></body></html>'
      });

      const result = await validateAndExtractArchive(zipData);
      expect(result.valid).toBe(true);
      expect(result.fileCount).toBe(4);
      expect(result.extractedFiles['/package.json']).toBeDefined();
      expect(result.extractedFiles['/src/App.tsx']).toBeDefined();
      expect(result.extractedFiles['/index.html']).toBeDefined();
      expect(result.extractedFiles['/src/index.css']).toBeDefined();
    });

    it('automatically excludes build and dependency directories and OS junk', async () => {
      const zipData = await createZipBuffer({
        'package.json': '{"name":"test"}',
        'node_modules/react/package.json': '{"name":"react"}',
        'node_modules/react/index.js': 'module.exports = {};',
        '.git/config': '[core]',
        '.git/HEAD': 'ref: refs/heads/main',
        'dist/bundle.js': 'console.log("dist");',
        'build/index.html': '<html></html>',
        '.next/cache/test.json': '{}',
        '.DS_Store': 'junk',
        'Thumbs.db': 'junk',
        'src/main.ts': 'console.log("main");'
      });

      const result = await validateAndExtractArchive(zipData);
      expect(result.valid).toBe(true);
      expect(result.fileCount).toBe(2);
      expect(result.extractedFiles['/package.json']).toBeDefined();
      expect(result.extractedFiles['/src/main.ts']).toBeDefined();
      expect(result.ignoredPaths).toContain('node_modules/react/package.json');
      expect(result.ignoredPaths).toContain('.git/config');
      expect(result.ignoredPaths).toContain('dist/bundle.js');
    });

    it('excludes sensitive environment files and records user-facing warnings', async () => {
      const zipData = await createZipBuffer({
        'package.json': '{"name":"test"}',
        '.env': 'SECRET_API_KEY=12345',
        '.env.local': 'DATABASE_URL=postgres://...',
        'src/App.tsx': 'export const App = () => null;'
      });

      const result = await validateAndExtractArchive(zipData);
      expect(result.valid).toBe(true);
      expect(result.extractedFiles['/.env']).toBeUndefined();
      expect(result.extractedFiles['/.env.local']).toBeUndefined();
      expect(result.extractedFiles['/src/App.tsx']).toBeDefined();
      expect(result.warnings.some((w) => w.includes('Excluded sensitive environment file'))).toBe(true);
    });

    it('unwraps single top-level root folder so root files map cleanly to VFS root', async () => {
      const zipData = await createZipBuffer({
        'my-repo-main/package.json': '{"name":"unwrapped-app"}',
        'my-repo-main/src/App.tsx': 'export const App = () => <h1>Unwrapped</h1>;',
        'my-repo-main/index.html': '<!doctype html><html></html>'
      });

      const result = await validateAndExtractArchive(zipData);
      expect(result.valid).toBe(true);
      expect(result.extractedFiles['/package.json']).toBeDefined();
      expect(result.extractedFiles['/src/App.tsx']).toBeDefined();
      expect(result.extractedFiles['/index.html']).toBeDefined();
      expect(result.extractedFiles['/my-repo-main/package.json']).toBeUndefined();
    });

    it('rejects invalid or corrupted archives gracefully', async () => {
      const corruptData = new TextEncoder().encode('not a valid zip file content');
      const result = await validateAndExtractArchive(corruptData);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('INVALID_ARCHIVE');
    });

    it('enforces total compressed archive size limit', async () => {
      const fakeBlob = new Blob(['sample']);
      const result = await validateAndExtractArchive(fakeBlob, MAX_ZIP_COMPRESSED_BYTES + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ARCHIVE_TOO_LARGE');
    });
  });

  describe('3. Framework & Build Configuration Detection', () => {
    it('detects Vite + React project with dev script and primary App.tsx entry', () => {
      const files: Record<string, string> = {
        '/package.json': JSON.stringify({
          name: 'fintech-dashboard',
          scripts: { dev: 'vite', build: 'tsc && vite build' },
          dependencies: { react: '^18.3.0', 'react-dom': '^18.3.0' },
          devDependencies: { vite: '^5.0.0', typescript: '^5.4.0' }
        }),
        '/src/App.tsx': 'export default function App() {}',
        '/index.html': '<html></html>'
      };

      const config = detectProjectConfiguration(files);
      expect(config.framework).toBe('vite-react');
      expect(config.badge).toBe('Vite + React');
      expect(config.title).toBe('Fintech Dashboard');
      expect(config.primaryEntryFile).toBe('/src/App.tsx');
      expect(config.scripts.dev).toBe('vite');
      expect(config.hasTypeScript).toBe(true);
    });

    it('detects Vite + Vue and Vite + Svelte frameworks', () => {
      const vueFiles: Record<string, string> = {
        '/package.json': JSON.stringify({
          name: 'vue-store',
          dependencies: { vue: '^3.4.0' },
          devDependencies: { vite: '^5.0.0' }
        }),
        '/src/App.vue': '<template><div>Vue</div></template>'
      };
      const vueConfig = detectProjectConfiguration(vueFiles);
      expect(vueConfig.badge).toBe('Vite + Vue');
      expect(vueConfig.primaryEntryFile).toBe('/src/App.vue');

      const svelteFiles: Record<string, string> = {
        '/package.json': JSON.stringify({
          name: 'svelte-app',
          dependencies: { svelte: '^4.0.0' },
          devDependencies: { vite: '^5.0.0' }
        }),
        '/src/App.svelte': '<script></script><h1>Svelte</h1>'
      };
      const svelteConfig = detectProjectConfiguration(svelteFiles);
      expect(svelteConfig.badge).toBe('Vite + Svelte');
      expect(svelteConfig.primaryEntryFile).toBe('/src/App.svelte');
    });

    it('detects Next.js and CRA / Webpack React projects', () => {
      const nextFiles: Record<string, string> = {
        '/package.json': JSON.stringify({
          name: 'next-portal',
          dependencies: { next: '^14.0.0', react: '^18.0.0' }
        }),
        '/app/page.tsx': 'export default function Page() {}'
      };
      const nextConfig = detectProjectConfiguration(nextFiles);
      expect(vueFiles => nextConfig.badge === 'Next.js');
      expect(nextConfig.badge).toBe('Next.js');
      expect(nextConfig.primaryEntryFile).toBe('/app/page.tsx');
    });

    it('detects Static HTML projects without package.json gracefully', () => {
      const staticFiles: Record<string, string> = {
        '/index.html': '<!doctype html><html><h1>Static</h1></html>',
        '/styles.css': 'body { background: #000; }',
        '/main.js': 'console.log("static");'
      };

      const config = detectProjectConfiguration(staticFiles, 'My Portfolio');
      expect(config.framework).toBe('static-web');
      expect(config.badge).toBe('Static HTML');
      expect(config.hasPackageJson).toBe(false);
      expect(config.primaryEntryFile).toBe('/index.html');
      expect(config.scripts.dev).toBeUndefined();
    });

    it('detects lockfile types accurately', () => {
      expect(detectProjectConfiguration({ '/package.json': '{}', '/package-lock.json': '{}' }).lockfileType).toBe('npm');
      expect(detectProjectConfiguration({ '/package.json': '{}', '/yarn.lock': '' }).lockfileType).toBe('yarn');
      expect(detectProjectConfiguration({ '/package.json': '{}', '/pnpm-lock.yaml': '' }).lockfileType).toBe('pnpm');
      expect(detectProjectConfiguration({ '/package.json': '{}', '/bun.lockb': '' }).lockfileType).toBe('bun');
    });
  });

  describe('4. Atomic Import Commit & Failure-Injection Rollback', () => {
    const sampleFiles: Record<string, string> = {
      '/package.json': JSON.stringify({ name: 'atomic-test', scripts: { dev: 'vite' } }),
      '/src/App.tsx': 'export const App = () => <div>Atomic</div>;',
      '/index.html': '<html></html>'
    };
    const sampleConfig = detectProjectConfiguration(sampleFiles);

    it('successfully commits project to VFS, registers metadata, and creates baseline snapshot', async () => {
      const newProjectId = await projectImporter.commitImport(
        sampleFiles,
        sampleConfig,
        { customTitle: 'Atomic Project', skipRuntimeStart: true }
      );

      // Verify VFS has authoritative files
      const vfsFiles = vfsManager.getFiles(newProjectId);
      expect(Object.keys(vfsFiles).length).toBe(3);
      expect(vfsFiles['/src/App.tsx'].content).toContain('Atomic');

      // Verify authentic baseline Version History snapshot exists
      const snapshots = snapshotService.listSnapshots(newProjectId);
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].description).toBe('Initial import: Atomic Project');

      // Verify projectStore state
      const state = useProjectStore.getState();
      const project = state.projects[newProjectId];
      expect(project).toBeDefined();
      expect(project.title).toBe('Atomic Project');
      expect(project.activeFilePath).toBe('/src/App.tsx');
      expect(state.activeProjectId).toBe(newProjectId);

      // Verify editor clean baseline
      expect(useEditorStore.getState().hasDirtyFiles(newProjectId)).toBe(false);
    });

    it('failure injection Stage 1 (Before VFS Write): leaves VFS, snapshots, and store 100% empty', async () => {
      const beforeProjects = { ...useProjectStore.getState().projects };

      await expect(
        projectImporter.commitImport(
          sampleFiles,
          sampleConfig,
          { customTitle: 'Failed Stage 1' },
          'fail_before_vfs_write'
        )
      ).rejects.toThrow('Simulated failure before VFS write');

      // Assert no project was added to store
      expect(useProjectStore.getState().projects).toEqual(beforeProjects);
    });

    it('failure injection Stage 2 (After VFS, Before Snapshot): scrubs transient VFS files completely', async () => {
      const beforeProjects = { ...useProjectStore.getState().projects };

      let caughtError: Error | null = null;
      try {
        await projectImporter.commitImport(
          sampleFiles,
          sampleConfig,
          { customTitle: 'Failed Stage 2' },
          'fail_after_vfs_before_snapshot'
        );
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toContain('Simulated failure after VFS write before snapshot');

      // Assert store is completely untouched
      expect(useProjectStore.getState().projects).toEqual(beforeProjects);

      // Assert any created project files were cleaned up
      const allStoreIds = Object.keys(useProjectStore.getState().projects);
      for (const id of allStoreIds) {
        expect(beforeProjects[id]).toBeDefined();
      }
    });

    it('failure injection Stage 3 (After Snapshot, Before Store): cleans up both VFS and snapshot artifacts', async () => {
      const beforeProjects = { ...useProjectStore.getState().projects };

      await expect(
        projectImporter.commitImport(
          sampleFiles,
          sampleConfig,
          { customTitle: 'Failed Stage 3' },
          'fail_after_snapshot_before_store'
        )
      ).rejects.toThrow('Simulated failure after snapshot before store registration');

      expect(useProjectStore.getState().projects).toEqual(beforeProjects);
    });

    it('failure injection Stage 4 (During Store Registration): rolls back VFS and purges metadata cleanly', async () => {
      const beforeProjects = { ...useProjectStore.getState().projects };

      await expect(
        projectImporter.commitImport(
          sampleFiles,
          sampleConfig,
          { customTitle: 'Failed Stage 4' },
          'fail_during_store_registration'
        )
      ).rejects.toThrow('Simulated failure during store registration');

      expect(useProjectStore.getState().projects).toEqual(beforeProjects);
    });
  });

  describe('5. Project Lifecycle, Duplication, Deletion & AI Integration', () => {
    it('supports duplicating and deleting an imported project independently', async () => {
      const files: Record<string, string> = {
        '/package.json': JSON.stringify({ name: 'lifecycle-test' }),
        '/src/App.tsx': 'export const App = () => <div>Lifecycle</div>;'
      };
      const config = detectProjectConfiguration(files);

      const importedId = await projectImporter.commitImport(files, config, {
        customTitle: 'Original Imported',
        skipRuntimeStart: true
      });

      expect(useProjectStore.getState().projects[importedId]).toBeDefined();

      // Duplicate imported project
      const duplicateId = await useProjectStore.getState().duplicateProject(importedId, 'Duplicated Import');
      expect(duplicateId).not.toBe(importedId);
      expect(useProjectStore.getState().projects[duplicateId].title).toBe('Duplicated Import');

      // Assert independent VFS copy
      const dupFiles = vfsManager.getFiles(duplicateId);
      expect(dupFiles['/src/App.tsx'].content).toContain('Lifecycle');

      // Delete original imported project safely
      const deleted = await useProjectStore.getState().deleteProject(importedId);
      expect(deleted).toBe(true);
      expect(useProjectStore.getState().projects[importedId]).toBeUndefined();

      // Duplicated project remains intact
      expect(useProjectStore.getState().projects[duplicateId]).toBeDefined();
      expect(vfsManager.getFiles(duplicateId)['/src/App.tsx']).toBeDefined();
    });

    it('indexes imported project files into AI Chat/Edit bounded context', async () => {
      const files: Record<string, string> = {
        '/package.json': JSON.stringify({ name: 'ai-context-test' }),
        '/src/App.tsx': 'export const App = () => <div>AI Chat Target</div>;',
        '/src/utils.ts': 'export const add = (a: number, b: number) => a + b;'
      };
      const config = detectProjectConfiguration(files);

      const importedId = await projectImporter.commitImport(files, config, {
        customTitle: 'AI Context App',
        skipRuntimeStart: true
      });

      const context = chatService.buildEditContext(importedId, 'Add dark mode', '/src/App.tsx');
      expect(context.projectId).toBe(importedId);
      expect(context.activeFilePath).toBe('/src/App.tsx');
      expect(context.relevantFiles['/src/App.tsx']).toContain('AI Chat Target');
      expect(context.projectSummary?.fileList).toContain('/src/App.tsx');
    });

    it('allows restoring the initial imported snapshot from Version History', async () => {
      const files: Record<string, string> = {
        '/package.json': JSON.stringify({ name: 'restore-test' }),
        '/src/App.tsx': 'export const App = () => <div>Initial Version</div>;'
      };
      const config = detectProjectConfiguration(files);

      const importedId = await projectImporter.commitImport(files, config, {
        customTitle: 'Restore Target',
        skipRuntimeStart: true
      });

      const snapshots = snapshotService.listSnapshots(importedId);
      const initialSnapshotId = snapshots[0].id;

      // Make a modification
      await vfsManager.writeFile(importedId, '/src/App.tsx', 'export const App = () => <div>Modified</div>;');
      expect(vfsManager.getFiles(importedId)['/src/App.tsx'].content).toContain('Modified');

      // Restore initial snapshot
      await useProjectStore.getState().restoreSnapshot(importedId, initialSnapshotId);

      // Assert content reverted to initial import state
      expect(vfsManager.getFiles(importedId)['/src/App.tsx'].content).toContain('Initial Version');
    });
  });
});
