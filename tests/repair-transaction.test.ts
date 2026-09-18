import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { Patch } from '../src/types/workspace';
import { GeminiAIProvider } from '../server/providers/GeminiAIProvider';

// In-memory runtime filesystem mirror for testing VFS <-> WebContainer synchronization
let runtimeFs = new Map<string, string>();

describe('Repair Transaction & Rollback Coordination (Tests A-J)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    runtimeFs.clear();

    // Mock runtime manager replaceProject to update our test container mirror
    vi.spyOn(runtimeManager, 'replaceProject').mockImplementation(async (files: any) => {
      runtimeFs.clear();
      for (const [path, val] of Object.entries(files)) {
        const clean = path.replace(/\\/g, '/').replace(/^\/+/g, '');
        const content = typeof val === 'string' ? val : (val as any).content;
        runtimeFs.set(clean, content);
      }
    });

    vi.spyOn(runtimeManager, 'syncFile').mockImplementation(async (path: string, content: string) => {
      const clean = path.replace(/\\/g, '/').replace(/^\/+/g, '');
      runtimeFs.set(clean, content);
    });
  });

  it('A. valid patch + successful verification', async () => {
    const projId = 'proj-tx-a';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() { return <div>Old</div>; }');
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const validPatch: Patch = {
      id: 'patch-a',
      summary: 'Fix title in App.tsx',
      files: [
        {
          path: '/src/App.tsx',
          before: 'export default function App() { return <div>Old</div>; }',
          after: 'export default function App() { return <div>Fixed App</div>; }'
        }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: true,
      checks: [
        { name: 'TypeScript Compilation', success: true, status: 'passed', exitCode: 0 },
        { name: 'Production Build', success: true, status: 'passed', exitCode: 0 }
      ],
      totalDurationMs: 1500
    });

    const result = await repairLoopEngine.applyPatchAndVerify(projId, validPatch);
    expect(result.verified).toBe(true);
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe('export default function App() { return <div>Fixed App</div>; }');
    expect(runtimeFs.get('src/App.tsx')).toBe('export default function App() { return <div>Fixed App</div>; }');
  });

  it('B. patch application failure', async () => {
    const projId = 'proj-tx-b';
    const originalContent = 'export const initial = true;';
    await vfsManager.writeFile(projId, '/src/App.tsx', originalContent);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const badValidationPatch: Patch = {
      id: 'patch-b',
      summary: 'Target non-matching before text',
      files: [
        {
          path: '/src/App.tsx',
          before: 'DOES NOT MATCH CURRENT VFS FILE CONTENT',
          after: 'new content'
        }
      ]
    };

    const verifySpy = vi.spyOn(verificationService, 'runFullVerification');
    const result = await repairLoopEngine.applyPatchAndVerify(projId, badValidationPatch);

    expect(result.verified).toBe(false);
    expect(result.error).toContain('Patch validation failed');
    expect(verifySpy).not.toHaveBeenCalled();
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(originalContent);
  });

  it('C. runtime synchronization failure', async () => {
    const projId = 'proj-tx-c';
    const originalContent = 'export const safe = true;';
    await vfsManager.writeFile(projId, '/src/App.tsx', originalContent);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const patch: Patch = {
      id: 'patch-c',
      summary: 'Patch causing runtime error',
      files: [
        {
          path: '/src/App.tsx',
          before: originalContent,
          after: 'export const safe = "patched";'
        }
      ]
    };

    // First replaceProject succeeds for setup, then fails during applyPatchAndVerify
    vi.spyOn(runtimeManager, 'replaceProject').mockRejectedValueOnce(new Error('WebContainer ENOSPC: write failed'));
    const verifySpy = vi.spyOn(verificationService, 'runFullVerification');

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);

    expect(result.verified).toBe(false);
    expect(result.error).toContain('Runtime synchronization failed');
    expect(verifySpy).not.toHaveBeenCalled();
    // VFS should be rolled back
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(originalContent);
  });

  it('D. verification failure', async () => {
    const projId = 'proj-tx-d';
    const originalContent = 'export const count = 1;';
    await vfsManager.writeFile(projId, '/src/counter.ts', originalContent);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const patch: Patch = {
      id: 'patch-d',
      summary: 'Bad patch introducing syntax error',
      files: [
        {
          path: '/src/counter.ts',
          before: originalContent,
          after: 'export const count = UNDEFINED_VAR;'
        }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [
        {
          name: 'TypeScript Compilation',
          success: false,
          status: 'failed',
          exitCode: 1,
          output: "error TS2304: Cannot find name 'UNDEFINED_VAR'."
        }
      ],
      totalDurationMs: 800
    });

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('TypeScript Compilation');

    // Rolled back in both VFS and Runtime
    expect(vfsManager.getFile(projId, '/src/counter.ts')?.content).toBe(originalContent);
    expect(runtimeFs.get('src/counter.ts')).toBe(originalContent);
  });

  it('E. verification timeout', async () => {
    const projId = 'proj-tx-e';
    const originalContent = 'export const timeoutTest = true;';
    await vfsManager.writeFile(projId, '/src/index.ts', originalContent);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const patch: Patch = {
      id: 'patch-e',
      summary: 'Patch triggering timeout',
      files: [
        {
          path: '/src/index.ts',
          before: originalContent,
          after: 'export const timeoutTest = false;'
        }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [
        {
          name: 'Production Build',
          success: false,
          status: 'timeout',
          timedOut: true,
          exitCode: null,
          output: '[TIMEOUT] Build timed out after 180000ms'
        }
      ],
      totalDurationMs: 180000
    });

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('Production Build');

    expect(vfsManager.getFile(projId, '/src/index.ts')?.content).toBe(originalContent);
    expect(runtimeFs.get('src/index.ts')).toBe(originalContent);
  });

  it('F. rollback removes newly added files', async () => {
    const projId = 'proj-tx-f';
    await vfsManager.writeFile(projId, '/src/main.ts', 'const main = 1;');
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    // Bad patch adds a new rogue file
    const patch: Patch = {
      id: 'patch-f',
      summary: 'Add rogue file',
      files: [
        {
          path: '/src/rogue.ts',
          before: '',
          after: 'throw new Error("rogue");'
        }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'Production Build', success: false, status: 'failed', exitCode: 1 }],
      totalDurationMs: 500
    });

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(result.verified).toBe(false);

    expect(vfsManager.getFile(projId, '/src/rogue.ts')).toBeNull();
    expect(runtimeFs.has('src/rogue.ts')).toBe(false);
    expect(Object.keys(vfsManager.getFiles(projId)).length).toBe(1);
  });

  it('G. rollback restores deleted files', async () => {
    const projId = 'proj-tx-g';
    await vfsManager.writeFile(projId, '/src/keep.ts', 'keep');
    await vfsManager.writeFile(projId, '/src/delete_me.ts', 'important data');
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    // Patch deletes a file
    const patch: Patch = {
      id: 'patch-g',
      summary: 'Delete file with errors',
      files: [
        {
          path: '/src/delete_me.ts',
          before: 'important data',
          after: ''
        }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'TypeScript Compilation', success: false, status: 'failed', exitCode: 1 }],
      totalDurationMs: 600
    });

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(result.verified).toBe(false);

    expect(vfsManager.getFile(projId, '/src/delete_me.ts')?.content).toBe('important data');
    expect(runtimeFs.get('src/delete_me.ts')).toBe('important data');
  });

  it('H. rollback restores modified files', async () => {
    const projId = 'proj-tx-h';
    const original = 'const stable = 100;';
    await vfsManager.writeFile(projId, '/src/calc.ts', original);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const patch: Patch = {
      id: 'patch-h',
      summary: 'Modify calc',
      files: [
        {
          path: '/src/calc.ts',
          before: original,
          after: 'const stable = INVALID;'
        }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'TypeScript Compilation', success: false, status: 'failed', exitCode: 1 }],
      totalDurationMs: 400
    });

    await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(vfsManager.getFile(projId, '/src/calc.ts')?.content).toBe(original);
    expect(runtimeFs.get('src/calc.ts')).toBe(original);
  });

  it('I. rollback restores the complete project tree', async () => {
    const projId = 'proj-tx-i';
    const initialTree: Record<string, string> = {
      '/package.json': '{"name": "test"}',
      '/src/App.tsx': '<App />',
      '/src/components/Header.tsx': '<Header />',
      '/src/utils/helpers.ts': 'export const help = () => 1;'
    };

    await vfsManager.writeFilesBulk(projId, initialTree);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    // Multi-file chaotic patch
    const patch: Patch = {
      id: 'patch-i',
      summary: 'Chaotic multi-file mutation',
      files: [
        { path: '/src/App.tsx', before: '<App />', after: '<AppModified />' },
        { path: '/src/components/Rogue.tsx', before: '', after: '<Rogue />' }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'Production Build', success: false, status: 'failed', exitCode: 1 }],
      totalDurationMs: 500
    });

    await repairLoopEngine.applyPatchAndVerify(projId, patch);

    const vfsAfter = vfsManager.getFiles(projId);
    expect(Object.keys(vfsAfter).length).toBe(4);
    expect(vfsAfter['/src/App.tsx']?.content).toBe('<App />');
    expect(vfsAfter['/src/components/Rogue.tsx']).toBeUndefined();
    expect(runtimeFs.get('src/App.tsx')).toBe('<App />');
    expect(runtimeFs.has('src/components/Rogue.tsx')).toBe(false);
  });

  it('J. final VFS and WebContainer state match after rollback', async () => {
    const projId = 'proj-tx-j';
    const projectFiles: Record<string, string> = {
      '/package.json': '{"name": "match-test"}',
      '/src/main.tsx': 'console.log("main");',
      '/src/components/Nav.tsx': 'export const Nav = () => null;'
    };

    await vfsManager.writeFilesBulk(projId, projectFiles);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const badPatch: Patch = {
      id: 'patch-j',
      summary: 'Corrupt all files',
      files: [
        { path: '/src/main.tsx', before: 'console.log("main");', after: 'corrupted main' },
        { path: '/src/components/Nav.tsx', before: 'export const Nav = () => null;', after: 'corrupted nav' }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'Production Build', success: false, status: 'failed', exitCode: 1 }],
      totalDurationMs: 600
    });

    await repairLoopEngine.applyPatchAndVerify(projId, badPatch);

    // Verify byte-for-byte matching between VFS and Runtime container
    const vfsFinal = vfsManager.getFiles(projId);
    expect(vfsFinal['/src/main.tsx']?.content).toBe('console.log("main");');
    expect(runtimeFs.get('src/main.tsx')).toBe('console.log("main");');
    expect(vfsFinal['/src/components/Nav.tsx']?.content).toBe('export const Nav = () => null;');
    expect(runtimeFs.get('src/components/Nav.tsx')).toBe('export const Nav = () => null;');
  });
});

describe('GeminiAIProvider Repair Patch Baseline Contract', () => {
  it('pairs authoritative baseline before from relevantFiles exactly when Gemini returns only path and after', async () => {
    const provider = new GeminiAIProvider('test-key');
    const relevantCode = 'export function App() {\n  const x = calcTax_UNDEFINED_CALL(100);\n  return <div>{x}</div>;\n}';
    const repairedCode = 'export function App() {\n  const x = 8.5;\n  return <div>{x}</div>;\n}';

    // Mock Gemini client to return only path and after (NO before)
    (provider as any).ai = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            summary: 'Fix undefined calcTax_UNDEFINED_CALL reference',
            confidence: 0.98,
            files: [
              {
                path: 'src/App.tsx', // tests normalization of leading slash
                after: repairedCode
              }
            ]
          })
        })
      }
    };

    const patch = await provider.generatePatch({
      diagnosis: {
        category: 'syntax',
        severity: 'high',
        explanation: 'Undefined reference',
        affectedFiles: ['/src/App.tsx'],
        evidence: ['calcTax_UNDEFINED_CALL is not defined'],
        suggestedFix: 'Replace with calculation'
      },
      evidence: {
        executionId: 'exec_1',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'error TS2304',
        durationMs: 100,
        timedOut: false
      },
      relevantFiles: {
        '/src/App.tsx': relevantCode
      }
    });

    expect(patch.files).toHaveLength(1);
    expect(patch.files[0].path).toBe('/src/App.tsx');
    expect(patch.files[0].after).toBe(repairedCode);
    // Strict byte-for-byte equality with relevantFiles['/src/App.tsx']
    expect(patch.files[0].before).toBe(relevantCode);
    expect(patch.files[0].before === relevantCode).toBe(true);
  });

  it('rejects patch when returned file does not exist in relevantFiles', async () => {
    const provider = new GeminiAIProvider('test-key');
    (provider as any).ai = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            summary: 'Invented non-existent file',
            files: [
              {
                path: '/src/UnknownFile.tsx',
                after: 'const x = 1;'
              }
            ]
          })
        })
      }
    };

    await expect(provider.generatePatch({
      diagnosis: {
        category: 'syntax',
        severity: 'high',
        explanation: 'Err',
        affectedFiles: ['/src/App.tsx'],
        evidence: [],
        suggestedFix: 'Fix'
      },
      evidence: {
        executionId: 'exec_2',
        command: 'npx tsc',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: '',
        durationMs: 10,
        timedOut: false
      },
      relevantFiles: {
        '/src/App.tsx': 'const app = 1;'
      }
    })).rejects.toThrow(/does not exist in relevantFiles/);
  });
});
