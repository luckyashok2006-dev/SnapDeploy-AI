import { describe, it, expect } from 'vitest';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { validatePatch } from '../src/features/repair/patch-validator';
import { ruleBasedAIProvider as standardAIProvider } from '../server/providers/dev/RuleBasedAIProvider';

// Mock in-memory IndexedDB persistent store for testing hydration & persistence cycles
class MockPersistentIndexedDB {
  private tables = new Map<string, Map<string, any>>();

  public open(dbName: string, version: number) {
    const dbInstance = {
      objectStoreNames: {
        contains: (name: string) => this.tables.has(name)
      },
      createObjectStore: (name: string, opts?: any) => {
        if (!this.tables.has(name)) {
          this.tables.set(name, new Map());
        }
        return {
          createIndex: () => {}
        };
      },
      transaction: (storeNames: string | string[], mode: string) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        for (const name of names) {
          if (!this.tables.has(name)) {
            this.tables.set(name, new Map());
          }
        }

        const tx = {
          oncomplete: null as any,
          onerror: null as any,
          onabort: null as any,
          error: null as any,
          objectStore: (name: string) => {
            const table = this.tables.get(name)!;
            return {
              put: (item: any) => {
                const key = item.id || item.path;
                table.set(key, JSON.parse(JSON.stringify(item)));
              },
              get: (key: string) => {
                const req: any = { result: table.get(key) ? JSON.parse(JSON.stringify(table.get(key))) : undefined };
                setTimeout(() => req.onsuccess?.({ target: req }), 0);
                return req;
              },
              getAll: () => {
                const items = Array.from(table.values()).map(v => JSON.parse(JSON.stringify(v)));
                const req: any = { result: items };
                setTimeout(() => req.onsuccess?.({ target: req }), 0);
                return req;
              },
              delete: (key: string) => {
                table.delete(key);
              },
              clear: () => {
                table.clear();
              },
              index: (idxName: string) => ({
                getAllKeys: (query: string) => {
                  const keys = Array.from(table.values())
                    .filter((v: any) => v.projectId === query)
                    .map((v: any) => v.id);
                  const req: any = { result: keys };
                  setTimeout(() => req.onsuccess?.({ target: req }), 0);
                  return req;
                }
              })
            };
          }
        };

        setTimeout(() => {
          if (tx.oncomplete) tx.oncomplete();
        }, 5);

        return tx;
      }
    };

    const openReq: any = {
      result: dbInstance,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null
    };

    setTimeout(() => {
      if (openReq.onupgradeneeded) {
        openReq.onupgradeneeded({ target: openReq });
      }
      if (openReq.onsuccess) {
        openReq.onsuccess({ target: openReq });
      }
    }, 5);

    return openReq;
  }

  public clearAll() {
    this.tables.clear();
  }
}

const mockIdb = new MockPersistentIndexedDB();
(globalThis as any).indexedDB = mockIdb;

describe('VFS Snapshot & Rollback Hardening (Tests A-H)', () => {
  it('A. snapshot of a multi-file project', async () => {
    const projId = 'proj-multi-file-snapshot';
    const initialFiles: Record<string, string> = {
      '/package.json': '{\n  "name": "snapdeploy-test",\n  "version": "1.0.0"\n}',
      '/src/App.tsx': 'export default function App() { return <div>Main App</div>; }',
      '/src/main.tsx': 'import App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);',
      '/src/components/Header.tsx': 'export const Header = () => <header>Header</header>;',
      '/src/components/Sidebar.tsx': 'export const Sidebar = () => <aside>Sidebar</aside>;'
    };

    await vfsManager.writeFilesBulk(projId, initialFiles);
    const filesBefore = vfsManager.getFiles(projId);
    expect(Object.keys(filesBefore).length).toBe(5);

    const snapshot = await vfsManager.createSnapshot(projId, 'Pre-mutation multi-file snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot.projectId).toBe(projId);
    expect(Object.keys(snapshot.files).length).toBe(5);
    expect(snapshot.hash).toMatch(/^snap_fp_/);
  });

  it('B. modified file rollback', async () => {
    const projId = 'proj-modified-rollback';
    const initialContent = 'export const count = 42;';
    const badPatchContent = 'export const count = INVALID_CALL();';

    await vfsManager.writeFile(projId, '/src/counter.ts', initialContent);
    await vfsManager.createSnapshot(projId, 'Before bad counter patch');

    // Apply bad patch
    await vfsManager.writeFile(projId, '/src/counter.ts', badPatchContent);
    expect(vfsManager.getFile(projId, '/src/counter.ts')?.content).toBe(badPatchContent);

    // Rollback
    const restored = await vfsManager.rollbackSnapshot(projId);
    expect(restored).not.toBeNull();
    expect(vfsManager.getFile(projId, '/src/counter.ts')?.content).toBe(initialContent);
  });

  it('C. deleted file rollback', async () => {
    const projId = 'proj-deleted-rollback';
    const file1 = 'export const A = 1;';
    const file2 = 'export const B = 2;';

    await vfsManager.writeFile(projId, '/src/a.ts', file1);
    await vfsManager.writeFile(projId, '/src/b.ts', file2);
    await vfsManager.createSnapshot(projId, 'Before file deletion');

    // Bad mutation deletes /src/b.ts
    await vfsManager.deleteFile(projId, '/src/b.ts');
    expect(vfsManager.getFile(projId, '/src/b.ts')).toBeNull();
    expect(Object.keys(vfsManager.getFiles(projId)).length).toBe(1);

    // Rollback
    const restored = await vfsManager.rollbackSnapshot(projId);
    expect(restored).not.toBeNull();
    expect(vfsManager.getFile(projId, '/src/b.ts')?.content).toBe(file2);
    expect(Object.keys(vfsManager.getFiles(projId)).length).toBe(2);
  });

  it('D. newly added file rollback', async () => {
    const projId = 'proj-added-file-rollback';
    await vfsManager.writeFile(projId, '/src/main.ts', 'console.log("main");');
    await vfsManager.createSnapshot(projId, 'Before adding rogue file');

    // Bad mutation adds an unwanted rogue file
    await vfsManager.writeFile(projId, '/src/rogue.ts', 'throw new Error("rogue");');
    expect(vfsManager.getFile(projId, '/src/rogue.ts')).not.toBeNull();
    expect(Object.keys(vfsManager.getFiles(projId)).length).toBe(2);

    // Rollback must remove the newly added file
    const restored = await vfsManager.rollbackSnapshot(projId);
    expect(restored).not.toBeNull();
    expect(vfsManager.getFile(projId, '/src/rogue.ts')).toBeNull();
    expect(Object.keys(vfsManager.getFiles(projId)).length).toBe(1);
    expect(vfsManager.getFile(projId, '/src/main.ts')).not.toBeNull();
  });

  it('E. multi-file mixed rollback (modified, deleted, added)', async () => {
    const projId = 'proj-mixed-rollback';
    const fileA = 'const A = "original";';
    const fileB = 'const B = "will be deleted";';
    const fileC = 'const C = "will be modified";';

    await vfsManager.writeFile(projId, '/src/a.ts', fileA);
    await vfsManager.writeFile(projId, '/src/b.ts', fileB);
    await vfsManager.writeFile(projId, '/src/c.ts', fileC);

    const snap = await vfsManager.createSnapshot(projId, 'Before mixed bad mutations');
    expect(Object.keys(snap.files).length).toBe(3);

    // 1. Modify /src/c.ts
    await vfsManager.writeFile(projId, '/src/c.ts', 'const C = "corrupted";');
    // 2. Delete /src/b.ts
    await vfsManager.deleteFile(projId, '/src/b.ts');
    // 3. Add /src/d.ts
    await vfsManager.writeFile(projId, '/src/d.ts', 'const D = "rogue added file";');

    const corruptedFiles = vfsManager.getFiles(projId);
    expect(Object.keys(corruptedFiles).length).toBe(3);
    expect(corruptedFiles['/src/b.ts']).toBeUndefined();
    expect(corruptedFiles['/src/d.ts']).toBeDefined();

    // Rollback
    const restored = await vfsManager.rollbackSnapshot(projId);
    expect(restored).not.toBeNull();

    const restoredFiles = vfsManager.getFiles(projId);
    expect(Object.keys(restoredFiles).length).toBe(3);
    expect(restoredFiles['/src/a.ts']?.content).toBe(fileA);
    expect(restoredFiles['/src/b.ts']?.content).toBe(fileB);
    expect(restoredFiles['/src/c.ts']?.content).toBe(fileC);
    expect(restoredFiles['/src/d.ts']).toBeUndefined();
  });

  it('F. complete file-set equality after rollback', async () => {
    const projId = 'proj-fileset-equality';
    const originalPaths = [
      '/package.json',
      '/src/App.tsx',
      '/src/main.tsx',
      '/src/types.ts',
      '/src/utils/math.ts'
    ];

    for (const p of originalPaths) {
      await vfsManager.writeFile(projId, p, `// Content for ${p}`);
    }

    const preFiles = vfsManager.getFiles(projId);
    const preKeySet = new Set(Object.keys(preFiles));
    expect(preKeySet.size).toBe(5);

    await vfsManager.createSnapshot(projId, 'File-set equality snapshot');

    // Mutate file set: add 2 new files, delete 2 files
    await vfsManager.writeFile(projId, '/src/new1.ts', 'new1');
    await vfsManager.writeFile(projId, '/src/new2.ts', 'new2');
    await vfsManager.deleteFile(projId, '/src/types.ts');
    await vfsManager.deleteFile(projId, '/src/utils/math.ts');

    // Rollback
    await vfsManager.rollbackSnapshot(projId);

    const postFiles = vfsManager.getFiles(projId);
    const postKeySet = new Set(Object.keys(postFiles));

    expect(postKeySet.size).toBe(preKeySet.size);
    expect(Array.from(postKeySet).sort()).toEqual(Array.from(preKeySet).sort());
  });

  it('G. byte-for-byte content equality after rollback', async () => {
    const projId = 'proj-byte-equality';
    const complexFiles: Record<string, string> = {
      '/src/InvoiceTable.tsx': 'import React from "react";\nexport const Table = () => <table><tbody><tr><td>$1,250.00</td></tr></tbody></table>;\n',
      '/src/styles.css': ':root {\n  --primary: #3b82f6;\n  --bg: #0f172a;\n}\n',
      '/src/data.json': '{\n  "invoices": [\n    { "id": "INV-001", "amount": 1250 }\n  ]\n}'
    };

    await vfsManager.writeFilesBulk(projId, complexFiles);
    const preSnapshotFiles = vfsManager.getFiles(projId);

    await vfsManager.createSnapshot(projId, 'Byte-for-byte snapshot');

    // Corrupt all files
    await vfsManager.writeFile(projId, '/src/InvoiceTable.tsx', 'corrupted 1');
    await vfsManager.writeFile(projId, '/src/styles.css', 'corrupted 2');
    await vfsManager.writeFile(projId, '/src/data.json', 'corrupted 3');

    // Rollback
    await vfsManager.rollbackSnapshot(projId);
    const postRollbackFiles = vfsManager.getFiles(projId);

    for (const [path, originalFile] of Object.entries(preSnapshotFiles)) {
      const restoredFile = postRollbackFiles[path];
      expect(restoredFile).toBeDefined();
      expect(restoredFile.content).toBe(originalFile.content);
      expect(restoredFile.content.length).toBe(originalFile.content.length);
      expect(restoredFile.hash).toBe(originalFile.hash);
    }
  });

  it('H. rollback persistence after VFS memory is cleared and rehydrated from IndexedDB', async () => {
    const projId = 'proj-rehydrate-rollback';
    const stableContent = 'export const stable = true;';

    await vfsManager.writeFile(projId, '/src/stable.ts', stableContent);
    await vfsManager.createSnapshot(projId, 'Pre-wipe snapshot');

    // Apply bad patch
    await vfsManager.writeFile(projId, '/src/stable.ts', 'export const stable = false; BAD CODE');
    await vfsManager.writeFile(projId, '/src/extra.ts', 'extra rogue file');

    // Rollback in VFS and IndexedDB
    await vfsManager.rollbackSnapshot(projId);
    expect(vfsManager.getFile(projId, '/src/stable.ts')?.content).toBe(stableContent);
    expect(vfsManager.getFile(projId, '/src/extra.ts')).toBeNull();

    // Wipe in-memory VFS state completely
    (vfsManager as any).projectFiles.clear();
    (vfsManager as any).projectSnapshots.clear();
    (vfsManager as any)._isHydrated = false;
    (vfsManager as any).hydrationPromise = null;

    // Rehydrate from IndexedDB
    await vfsManager.init();
    expect(vfsManager.isHydrated()).toBe(true);

    // Verify persisted state matches rolled-back state exactly
    const rehydratedFiles = vfsManager.getFiles(projId);
    expect(Object.keys(rehydratedFiles).length).toBe(1);
    expect(rehydratedFiles['/src/stable.ts']?.content).toBe(stableContent);
    expect(rehydratedFiles['/src/extra.ts']).toBeUndefined();
  });
});

describe('Patch Validation', () => {
  it('validates safe patch paths and detects unsafe file mutations', async () => {
    const proj = 'project-validation-test';
    await vfsManager.writeFile(proj, '/src/App.tsx', 'export default function App() {}');
    const files = vfsManager.getFiles(proj);

    const validPatch = {
      id: 'patch-1',
      summary: 'Safe patch',
      files: [
        {
          path: '/src/App.tsx',
          before: 'export default function App() {}',
          after: 'export default function App() { return <h1>Hello</h1>; }'
        }
      ]
    };

    const res = validatePatch(validPatch, files);
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);

    const unsafePatch = {
      id: 'patch-2',
      summary: 'Unsafe path patch',
      files: [
        {
          path: '/etc/passwd',
          before: '',
          after: 'evil'
        }
      ]
    };

    const unsafeRes = validatePatch(unsafePatch, files);
    expect(unsafeRes.valid).toBe(false);
    expect(unsafeRes.errors.length).toBeGreaterThan(0);
  });
});

describe('AI Generation & Diagnosis Pipeline', () => {
  it('generates a valid Vite React project plan with required files', async () => {
    const payload = await standardAIProvider.generateProject({
      prompt: 'Build a SaaS invoice dashboard with metrics'
    });

    expect(payload.plan.framework).toBe('vite-react');
    expect(payload.files['/package.json']).toBeDefined();
    expect(payload.files['/vite.config.ts']).toBeDefined();
    expect(payload.files['/src/App.tsx']).toBeDefined();
    expect(payload.files['/index.html']).toBeDefined();
  });

  it('diagnoses a runtime ReferenceError from execution evidence', async () => {
    const evidence = {
      executionId: 'exec-1',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: "ReferenceError: calcTax_UNDEFINED_CALL is not defined in '/src/App.tsx'",
      durationMs: 45
    };

    const diagnosis = await standardAIProvider.diagnoseFailure({
      evidence,
      relevantFiles: {
        '/src/App.tsx': 'const tax = calcTax_UNDEFINED_CALL(100);'
      }
    });

    expect(diagnosis.category).toBe('syntax');
    expect(diagnosis.explanation).toContain('calcTax_UNDEFINED_CALL');
    expect(diagnosis.affectedFiles).toContain('/src/App.tsx');
  });

  it('synthesizes a patch for the diagnosed error', async () => {
    const diagnosis = {
      category: 'syntax' as const,
      severity: 'high' as const,
      explanation: "Undefined reference 'calcTax_UNDEFINED_CALL'",
      affectedFiles: ['/src/App.tsx'],
      evidence: ["ReferenceError: calcTax_UNDEFINED_CALL is not defined"],
      suggestedFix: "Replace with tax function"
    };

    const patch = await standardAIProvider.generatePatch({
      diagnosis,
      evidence: {
        executionId: 'exec-1',
        command: 'npx tsc',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: '',
        durationMs: 30
      },
      relevantFiles: {
        '/src/App.tsx': 'const tax = calcTax_UNDEFINED_CALL(100);'
      }
    });

    expect(patch.files[0].path).toBe('/src/App.tsx');
    expect(patch.files[0].after).not.toContain('calcTax_UNDEFINED_CALL');
  });
});
