import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'http';
import app from '../server/index';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { validatePatch } from '../src/features/repair/patch-validator';
import { ruleBasedAIProvider } from '../server/providers/dev/RuleBasedAIProvider';
import { createProjectZip, isExcludedFromExport } from '../src/lib/export/project-exporter';
import { injectFaultIntoCode } from '../src/devtools/FaultInjectorModal';
import JSZip from 'jszip';

describe('SNAPDEPLOY AI MASTER AUDIT — ADVERSARIAL RED-TEAM TEST SUITE', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  describe('1. API Input Boundaries & Fuzzing (Phase 3 & 6)', () => {
    it('rejects null, undefined, empty, and whitespace-only prompt on /api/generate', async () => {
      const payloads = [
        {},
        { prompt: null },
        { prompt: '' },
        { prompt: '    \n\t   ' },
        { prompt: 12345 },
        { prompt: true },
        { prompt: ['array'] },
        { prompt: { text: 'nested' } }
      ];

      for (let i = 0; i < payloads.length; i++) {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `10.0.1.${i + 1}`
          },
          body: JSON.stringify(payloads[i])
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.code).toBe('INVALID_PROMPT');
      }
    });

    it('rejects oversized prompt (> 10,000 characters)', async () => {
      const hugePrompt = 'a'.repeat(10_001);
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.2.1'
        },
        body: JSON.stringify({ prompt: hugePrompt })
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('PROMPT_TOO_LARGE');
    });

    it('rejects invalid project names (> 100 chars or non-string)', async () => {
      const resLong = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.2.2'
        },
        body: JSON.stringify({ prompt: 'test', name: 'n'.repeat(101) })
      });
      expect(resLong.status).toBe(400);
      const dataLong = await resLong.json();
      expect(dataLong.code).toBe('INVALID_NAME');

      const resNum = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.2.3'
        },
        body: JSON.stringify({ prompt: 'test', name: 12345 })
      });
      expect(resNum.status).toBe(400);
      const dataNum = await resNum.json();
      expect(dataNum.code).toBe('INVALID_NAME');
    });

    it('rejects invalid diagnosis request inputs', async () => {
      // Missing evidence
      const res1 = await fetch(`${baseUrl}/api/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.3.1' },
        body: JSON.stringify({ relevantFiles: {} })
      });
      expect(res1.status).toBe(400);
      expect((await res1.json()).code).toBe('INVALID_EVIDENCE');

      // Evidence without command
      const res2 = await fetch(`${baseUrl}/api/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.3.2' },
        body: JSON.stringify({ evidence: { exitCode: 1 }, relevantFiles: {} })
      });
      expect(res2.status).toBe(400);
      expect((await res2.json()).code).toBe('INVALID_EVIDENCE');

      // Missing relevantFiles
      const res3 = await fetch(`${baseUrl}/api/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.3.3' },
        body: JSON.stringify({ evidence: { command: 'tsc' } })
      });
      expect(res3.status).toBe(400);
      expect((await res3.json()).code).toBe('INVALID_FILES');

      // Too many files (> 50)
      const manyFiles: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        manyFiles[`/file${i}.ts`] = 'export const x = 1;';
      }
      const res4 = await fetch(`${baseUrl}/api/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.3.4' },
        body: JSON.stringify({
          evidence: { command: 'tsc' },
          relevantFiles: manyFiles
        })
      });
      expect(res4.status).toBe(400);
      expect((await res4.json()).code).toBe('TOO_MANY_FILES');

      // File too large (> 500,000 chars)
      const res5 = await fetch(`${baseUrl}/api/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.3.5' },
        body: JSON.stringify({
          evidence: { command: 'tsc' },
          relevantFiles: { '/large.ts': 'x'.repeat(500_001) }
        })
      });
      expect(res5.status).toBe(400);
      expect((await res5.json()).code).toBe('FILE_TOO_LARGE');
    });

    it('rejects invalid repair request inputs', async () => {
      // Missing diagnosis
      const res1 = await fetch(`${baseUrl}/api/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.4.1' },
        body: JSON.stringify({ relevantFiles: {} })
      });
      expect(res1.status).toBe(400);
      expect((await res1.json()).code).toBe('INVALID_DIAGNOSIS');

      // Diagnosis without category
      const res2 = await fetch(`${baseUrl}/api/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.4.2' },
        body: JSON.stringify({
          diagnosis: { explanation: 'error' },
          relevantFiles: {}
        })
      });
      expect(res2.status).toBe(400);
      expect((await res2.json()).code).toBe('INVALID_DIAGNOSIS');

      // Missing relevantFiles
      const res3 = await fetch(`${baseUrl}/api/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.4.3' },
        body: JSON.stringify({
          diagnosis: { category: 'syntax' }
        })
      });
      expect(res3.status).toBe(400);
      expect((await res3.json()).code).toBe('INVALID_FILES');

      // Too many files (> 50)
      const manyFiles: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        manyFiles[`/file${i}.ts`] = 'export const x = 1;';
      }
      const res4 = await fetch(`${baseUrl}/api/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.4.4' },
        body: JSON.stringify({
          diagnosis: { category: 'syntax' },
          relevantFiles: manyFiles
        })
      });
      expect(res4.status).toBe(400);
      expect((await res4.json()).code).toBe('TOO_MANY_FILES');

      // File too large (> 500KB)
      const res5 = await fetch(`${baseUrl}/api/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.4.5' },
        body: JSON.stringify({
          diagnosis: { category: 'syntax' },
          relevantFiles: { '/huge.ts': 'y'.repeat(500_001) }
        })
      });
      expect(res5.status).toBe(400);
      expect((await res5.json()).code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('2. Adversarial Patch & Path Injection (Phase 3 & 6)', () => {
    const baseFiles = {
      '/src/App.tsx': {
        id: 'p1:/src/App.tsx',
        projectId: 'p1',
        path: '/src/App.tsx',
        content: 'export default function App() { return <div>Original</div>; }',
        hash: 'h_1',
        updatedAt: new Date().toISOString(),
        language: 'typescript' as const,
        isModified: false
      }
    };

    it('rejects path traversal in patch target paths', () => {
      const maliciousPaths = [
        '../etc/passwd',
        '../../package.json',
        '/src/../../secret.env',
        'src/components/../../../config.sys',
        '..\\..\\windows\\system32'
      ];

      for (const p of maliciousPaths) {
        const result = validatePatch({
          id: 'patch-attack',
          summary: 'Attack',
          files: [{ path: p, before: '', after: 'malicious' }]
        }, baseFiles);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Path traversal'))).toBe(true);
      }
    });

    it('rejects Windows UNC and network share paths', () => {
      const uncPaths = [
        '\\\\attacker-smb\\share\\evil.js',
        '//attacker-smb/share/evil.js',
        '\\\\localhost\\c$\\Windows\\System32\\cmd.exe'
      ];

      for (const p of uncPaths) {
        const result = validatePatch({
          id: 'patch-unc',
          summary: 'UNC Attack',
          files: [{ path: p, before: '', after: 'malicious' }]
        }, baseFiles);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('UNC / network path rejected'))).toBe(true);
      }
    });

    it('rejects null byte injection in paths', () => {
      const nullBytePaths = [
        '/src/App.tsx\0.js',
        '/src/\0evil.ts',
        'valid/path\0'
      ];

      for (const p of nullBytePaths) {
        const result = validatePatch({
          id: 'patch-null',
          summary: 'Null Byte Attack',
          files: [{ path: p, before: '', after: 'malicious' }]
        }, baseFiles);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Null byte in path rejected'))).toBe(true);
      }
    });

    it('rejects OS absolute paths and URI schemes', () => {
      const badPaths = [
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
        'D:/workspace/secret.key',
        'file:///etc/passwd',
        'http://evil.com/script.js'
      ];

      for (const p of badPaths) {
        const result = validatePatch({
          id: 'patch-os',
          summary: 'OS Absolute Path Attack',
          files: [{ path: p, before: '', after: 'malicious' }]
        }, baseFiles);
        expect(result.valid).toBe(false);
      }
    });

    it('rejects duplicate file change targets within a single patch', () => {
      const result = validatePatch({
        id: 'patch-dup',
        summary: 'Duplicate paths',
        files: [
          { path: '/src/App.tsx', before: baseFiles['/src/App.tsx'].content, after: 'after1' },
          { path: '/src/App.tsx', before: baseFiles['/src/App.tsx'].content, after: 'after2' }
        ]
      }, baseFiles);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate patch entry'))).toBe(true);
    });

    it('rejects stale before content byte-for-byte mismatch', () => {
      const result = validatePatch({
        id: 'patch-stale',
        summary: 'Stale patch',
        files: [
          {
            path: '/src/App.tsx',
            before: 'export default function App() { return <div>Modified Elsewhere</div>; }',
            after: 'new content'
          }
        ]
      }, baseFiles);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Stale patch'))).toBe(true);
    });

    it('rejects creating new file if file already exists', () => {
      const result = validatePatch({
        id: 'patch-existing',
        summary: 'Create existing file',
        files: [
          {
            path: '/src/App.tsx',
            before: '',
            after: 'new content'
          }
        ]
      }, baseFiles);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('already exists'))).toBe(true);
    });

    it('rejects patching missing target file when before is specified', () => {
      const result = validatePatch({
        id: 'patch-missing',
        summary: 'Patch missing file',
        files: [
          {
            path: '/src/NonExistent.tsx',
            before: 'some content',
            after: 'new content'
          }
        ]
      }, baseFiles);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Target file does not exist'))).toBe(true);
    });
  });

  describe('3. Snapshot Lifecycle & FIFO Eviction (Phase 4, 5, 8)', () => {
    const projId = 'audit-snapshot-test';

    beforeEach(() => {
      vfsManager.clearProjectFiles(projId);
    });

    it('bounds snapshot history to maxSnapshotsPerProject (15) with FIFO eviction', async () => {
      await vfsManager.writeFile(projId, '/src/App.tsx', 'version 0');

      for (let i = 1; i <= 20; i++) {
        await vfsManager.writeFile(projId, '/src/App.tsx', `version ${i}`);
        await snapshotService.createSnapshot(projId, `Checkpoint ${i}`);
      }

      const snapshots = snapshotService.listSnapshots(projId);
      expect(snapshots.length).toBe(15);
      expect(snapshots[0].description).toBe('Checkpoint 20');
      expect(snapshots[14].description).toBe('Checkpoint 6');
    });

    it('returns null gracefully on rollback when no snapshots exist', async () => {
      const emptyProjId = 'empty-snap-proj';
      const restored = await snapshotService.restoreSnapshot(emptyProjId);
      expect(restored).toBeNull();
    });

    it('performs repeated rollbacks sequentially down the stack', async () => {
      const seqProj = 'seq-snap-proj';
      await vfsManager.writeFile(seqProj, '/test.txt', 'base');
      await snapshotService.createSnapshot(seqProj, 'Snap 1');

      await vfsManager.writeFile(seqProj, '/test.txt', 'step 2');
      await snapshotService.createSnapshot(seqProj, 'Snap 2');

      await vfsManager.writeFile(seqProj, '/test.txt', 'step 3');

      const r1 = await snapshotService.restoreSnapshot(seqProj);
      expect(r1?.['/test.txt']?.content).toBe('step 2');

      const r2 = await snapshotService.restoreSnapshot(seqProj);
      expect(r2?.['/test.txt']?.content).toBe('base');

      const r3 = await snapshotService.restoreSnapshot(seqProj);
      expect(r3).toBeNull();
    });
  });

  describe('4. Export Sanitization & Integrity (Phase 2, 6, 10)', () => {
    it('strictly excludes secrets, environments, and build artifacts from export', () => {
      const blocked = [
        '.env',
        '.env.local',
        '.env.production',
        '.env.development',
        '.env.staging',
        'node_modules/express/index.js',
        'dist/assets/index.js',
        'build/output.js',
        '.git/HEAD',
        '.git/config',
        '.DS_Store',
        'Thumbs.db'
      ];

      for (const p of blocked) {
        expect(isExcludedFromExport(p)).toBe(true);
      }
    });

    it('permits valid source and config files in export', () => {
      const allowed = [
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'vite.config.ts',
        'index.html',
        'src/main.tsx',
        'src/App.tsx',
        'src/components/Dashboard.tsx',
        'src/utils/math.ts',
        'public/favicon.svg'
      ];

      for (const p of allowed) {
        expect(isExcludedFromExport(p)).toBe(false);
      }
    });

    it('generates an export ZIP containing all project files and truthful README', async () => {
      const expProjId = 'export-eval-proj';
      await vfsManager.writeFile(expProjId, '/package.json', JSON.stringify({
        name: 'test-export-app',
        dependencies: { react: '^18.3.1' },
        devDependencies: { typescript: '^5.0.0', vite: '^5.0.0' }
      }));
      await vfsManager.writeFile(expProjId, '/src/App.tsx', 'export const App = () => <h1>Live App</h1>;');
      await vfsManager.writeFile(expProjId, '/.env', 'SECRET_KEY=leaked_test_value');

      const zip = await createProjectZip({
        projectId: expProjId,
        projectTitle: 'Test Export App',
        projectDescription: 'Evaluation for export packaging'
      });

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const loaded = await JSZip.loadAsync(buffer);

      const fileNames = Object.keys(loaded.files);
      expect(fileNames.some(f => f.includes('package.json'))).toBe(true);
      expect(fileNames.some(f => f.includes('src/App.tsx'))).toBe(true);
      expect(fileNames.some(f => f.includes('README.md'))).toBe(true);
      expect(fileNames.some(f => f.includes('.env'))).toBe(false);

      const readmeContent = await loaded.file(fileNames.find(f => f.endsWith('README.md'))!)!.async('string');
      expect(readmeContent).toContain('React');
      expect(readmeContent).toContain('TypeScript');
      expect(readmeContent).toContain('Vite');
    });
  });

  describe('5. Generated Application Archetype Quality (Phase 10)', () => {
    const archetypes = [
      {
        name: 'SaaS Invoicing Dashboard',
        prompt: 'Build a SaaS invoice dashboard with customers, invoices, revenue metrics and a responsive sidebar.'
      },
      {
        name: 'AI Workflow Pipeline Canvas',
        prompt: 'Build an AI workflow node builder with step execution, token telemetry, and run controls.'
      },
      {
        name: 'E-Commerce Storefront & Cart',
        prompt: 'Build a responsive modern e-commerce storefront with product catalog, filter tabs, and interactive cart.'
      }
    ];

    for (const arch of archetypes) {
      it(`evaluates generated ${arch.name} application completeness & validity`, async () => {
        const payload = await ruleBasedAIProvider.generateProject({ prompt: arch.prompt });

        expect(payload.plan).toBeDefined();
        expect(payload.plan.framework).toBe('vite-react');
        expect(payload.plan.files.length).toBeGreaterThanOrEqual(6);

        const fileKeys = Object.keys(payload.files);
        expect(fileKeys).toContain('/package.json');
        expect(fileKeys).toContain('/tsconfig.json');
        expect(fileKeys).toContain('/vite.config.ts');
        expect(fileKeys).toContain('/index.html');
        expect(fileKeys).toContain('/src/main.tsx');
        expect(fileKeys).toContain('/src/App.tsx');

        const pkg = JSON.parse(payload.files['/package.json']);
        expect(pkg.dependencies.react).toBeDefined();
        expect(pkg.dependencies['react-dom']).toBeDefined();
        expect(pkg.scripts.dev).toBe('vite');
        expect(pkg.scripts.build).toContain('vite build');

        const tsconfig = JSON.parse(payload.files['/tsconfig.json']);
        expect(tsconfig.compilerOptions.jsx).toBe('react-jsx');

        const html = payload.files['/index.html'];
        expect(html).toContain('id="root"');
        expect(html).toContain('/src/main.tsx');

        const main = payload.files['/src/main.tsx'];
        expect(main).toContain("createRoot(document.getElementById('root')");
        expect(main).toContain('<App />');
      });
    }
  });

  describe('6. Fault Injection & Repair Lifecycle (Phase 2, 7, 11)', () => {
    it('injects syntax fault and verifies correct modification', () => {
      const code = 'import React from "react";\nexport default function App() { return <div>Clean</div>; }';
      const { brokenCode, desc } = injectFaultIntoCode(code, 'syntax');

      expect(brokenCode).not.toBe(code);
      expect(brokenCode).toContain('calcTax_UNDEFINED_CALL');
      expect(desc.toLowerCase()).toContain('undefined reference');
    });

    it('injects type mismatch fault and verifies correct modification', () => {
      const code = 'import React from "react";\nexport default function App() { return <InvoiceList />; }';
      const { brokenCode, desc } = injectFaultIntoCode(code, 'type');

      expect(brokenCode).not.toBe(code);
      expect(brokenCode).toContain('string_type_error');
      expect(desc.toLowerCase()).toContain('type mismatch');
    });

    it('injects missing module fault and verifies correct modification', () => {
      const code = 'import React from "react";\nexport default function App() { return <div>Clean</div>; }';
      const { brokenCode, desc } = injectFaultIntoCode(code, 'missing_module');

      expect(brokenCode).not.toBe(code);
      expect(brokenCode).toContain('@uninstalled/fake-pkg');
      expect(desc.toLowerCase()).toContain('missing module');
    });
  });
});
