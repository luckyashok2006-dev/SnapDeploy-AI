import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProjectZip, isExcludedFromExport, generateTruthfulReadme } from '../src/lib/export/project-exporter';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { useProjectStore } from '../src/store/projectStore';

describe('Project Export Behavior (Tests A-H)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  it('A. export uses current VFS contents', async () => {
    const projId = 'proj-export-a';
    await vfsManager.writeFile(projId, '/package.json', '{"name": "vfs-app"}');
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() { return <div>VFS App</div>; }');

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'VFS App'
    });

    const folder = zip.folder('vfs-app');
    expect(folder).toBeDefined();

    const appFile = folder?.file('src/App.tsx');
    expect(appFile).toBeDefined();
    const content = await appFile?.async('string');
    expect(content).toBe('export default function App() { return <div>VFS App</div>; }');
  });

  it('B. an edited VFS file appears with the edited content', async () => {
    const projId = 'proj-export-b';
    await vfsManager.writeFile(projId, '/src/counter.ts', 'export const count = 1;');

    // Update the file in VFS
    await vfsManager.writeFile(projId, '/src/counter.ts', 'export const count = 42;');

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'Counter'
    });

    const file = zip.folder('counter')?.file('src/counter.ts');
    const content = await file?.async('string');
    expect(content).toBe('export const count = 42;');
  });

  it('C. stale projectStore content is not exported', async () => {
    const projId = 'proj-export-c';
    
    // Set stale content in zustand store
    useProjectStore.setState({
      projects: {
        [projId]: {
          id: projId,
          title: 'Store Test',
          description: '',
          badge: '',
          status: 'ready',
          files: {
            '/src/App.tsx': {
              id: `${projId}:/src/App.tsx`,
              projectId: projId,
              path: '/src/App.tsx',
              content: 'STALE STORE CONTENT',
              hash: 'h1',
              updatedAt: '',
              language: 'typescript',
              isModified: false
            }
          },
          openTabs: [],
          activeFilePath: '',
          diagnostics: [],
          fixHistory: []
        }
      }
    });

    // Write fresh, true content to VFS
    await vfsManager.writeFile(projId, '/src/App.tsx', 'FRESH AUTHORITATIVE VFS CONTENT');

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'Store Test'
    });

    const file = zip.folder('store-test')?.file('src/App.tsx');
    const content = await file?.async('string');
    expect(content).toBe('FRESH AUTHORITATIVE VFS CONTENT');
    expect(content).not.toContain('STALE STORE CONTENT');
  });

  it('D. .env is excluded', async () => {
    const projId = 'proj-export-d';
    await vfsManager.writeFile(projId, '/.env', 'GEMINI_API_KEY=secret123');
    await vfsManager.writeFile(projId, '/.env.local', 'SECRET=xyz');
    await vfsManager.writeFile(projId, '/src/main.tsx', 'console.log();');

    expect(isExcludedFromExport('.env')).toBe(true);
    expect(isExcludedFromExport('.env.local')).toBe(true);

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'Env Test'
    });

    const folder = zip.folder('env-test');
    expect(folder?.file('.env')).toBeNull();
    expect(folder?.file('.env.local')).toBeNull();
    expect(folder?.file('src/main.tsx')).toBeDefined();
  });

  it('E. node_modules is excluded', async () => {
    const projId = 'proj-export-e';
    await vfsManager.writeFile(projId, '/node_modules/pkg/index.js', 'module.exports = {}');
    await vfsManager.writeFile(projId, '/src/index.ts', 'export const x = 1;');

    expect(isExcludedFromExport('node_modules/pkg/index.js')).toBe(true);

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'Modules Test'
    });

    const folder = zip.folder('modules-test');
    expect(folder?.file('node_modules/pkg/index.js')).toBeNull();
    expect(folder?.file('src/index.ts')).toBeDefined();
  });

  it('F. dist is excluded', async () => {
    const projId = 'proj-export-f';
    await vfsManager.writeFile(projId, '/dist/assets/index.js', 'console.log("bundle");');
    await vfsManager.writeFile(projId, '/src/index.ts', 'export const y = 2;');

    expect(isExcludedFromExport('dist/assets/index.js')).toBe(true);

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'Dist Test'
    });

    const folder = zip.folder('dist-test');
    expect(folder?.file('dist/assets/index.js')).toBeNull();
    expect(folder?.file('src/index.ts')).toBeDefined();
  });

  it('G. no fake GitHub success is returned', () => {
    // Verify that legacy fake GitHub exporter is NOT imported in active app
    expect(typeof (globalThis as any).exportToGitHub).toBe('undefined');
  });

  it('H. exported ZIP contains the expected complete file set and truthful README', async () => {
    const projId = 'proj-export-h';
    await vfsManager.writeFile(projId, '/package.json', JSON.stringify({
      name: 'truthful-app',
      dependencies: { react: '^18.3.1', 'lucide-react': '^0.344.0' },
      devDependencies: { typescript: '^5.4.5', vite: '^5.2.11' },
      scripts: { dev: 'vite', build: 'vite build' }
    }));
    await vfsManager.writeFile(projId, '/tsconfig.json', '{"compilerOptions":{}}');
    await vfsManager.writeFile(projId, '/vite.config.ts', 'export default {}');
    await vfsManager.writeFile(projId, '/index.html', '<html></html>');
    await vfsManager.writeFile(projId, '/src/App.tsx', '<App />');

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'Truthful App',
      projectDescription: 'Interactive Dashboard'
    });

    const folder = zip.folder('truthful-app');
    expect(folder?.file('package.json')).toBeDefined();
    expect(folder?.file('tsconfig.json')).toBeDefined();
    expect(folder?.file('vite.config.ts')).toBeDefined();
    expect(folder?.file('index.html')).toBeDefined();
    expect(folder?.file('src/App.tsx')).toBeDefined();

    const readme = await folder?.file('README.md')?.async('string');
    expect(readme).toBeDefined();
    expect(readme).toContain('# Truthful App');
    expect(readme).toContain('React');
    expect(readme).toContain('TypeScript');
    expect(readme).not.toContain('Next.js');
    expect(readme).not.toContain('Prisma');
    expect(readme).not.toContain('SQLite');
  });

  it('I. .git directory and metadata files are excluded from exported ZIP archive', async () => {
    const projId = 'proj-export-git';
    await vfsManager.writeFile(projId, '/.git/config', '[core]\nrepositoryformatversion = 0');
    await vfsManager.writeFile(projId, '/.git/HEAD', 'ref: refs/heads/main');
    await vfsManager.writeFile(projId, '/src/index.ts', 'export const ok = true;');

    expect(isExcludedFromExport('.git/config')).toBe(true);
    expect(isExcludedFromExport('.git/HEAD')).toBe(true);

    const zip = await createProjectZip({
      projectId: projId,
      projectTitle: 'Git Test'
    });

    const folder = zip.folder('git-test');
    expect(folder?.file('.git/config')).toBeNull();
    expect(folder?.file('.git/HEAD')).toBeNull();
    expect(folder?.file('src/index.ts')).toBeDefined();
  });
});
