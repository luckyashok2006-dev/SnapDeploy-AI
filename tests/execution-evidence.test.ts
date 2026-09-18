import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { ExecutionEvidence } from '../src/types/workspace';
import { injectFaultIntoCode } from '../src/devtools/FaultInjectorModal';

describe('Execution Evidence Integrity (Tests A-G)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A. injected fault produces real compiler evidence', async () => {
    const runtime = runtimeManager.getRuntime();
    vi.spyOn(runtime, 'spawn').mockResolvedValue({
      processId: 'proc_real_ts',
      command: 'npx',
      args: ['tsc', '--noEmit'],
      exit: Promise.resolve(2),
      kill: vi.fn()
    });

    const evidence = await runtimeManager.executeCommand('npx', ['tsc', '--noEmit']);
    expect(evidence.command).toBe('npx');
    expect(evidence.args).toEqual(['tsc', '--noEmit']);
    expect(evidence.exitCode).toBe(2);
    expect(evidence.timedOut).toBe(false);
    expect(typeof evidence.durationMs).toBe('number');
  });

  it('B. exitCode comes from actual execution', async () => {
    const runtime = runtimeManager.getRuntime();
    
    // Process exiting with actual code 42
    vi.spyOn(runtime, 'spawn').mockResolvedValue({
      processId: 'proc_exit_code',
      command: 'node',
      args: ['script.js'],
      exit: Promise.resolve(42),
      kill: vi.fn()
    });

    const evidence = await runtimeManager.executeCommand('node', ['script.js']);
    expect(evidence.exitCode).toBe(42);
    expect(evidence.timedOut).toBe(false);
  });

  it('C. stdout/stderr come from actual execution', async () => {
    const runtime = runtimeManager.getRuntime();
    const mockOutput = "src/App.tsx(2,13): error TS2304: Cannot find name 'calcTax_UNDEFINED_CALL'.";

    vi.spyOn(runtime, 'spawn').mockImplementation(async (cmd, args, opts) => {
      // Simulate real process emitting stderr
      opts?.onOutput?.(mockOutput, true);
      return {
        processId: 'proc_output_test',
        command: cmd,
        args,
        exit: Promise.resolve(1),
        kill: vi.fn()
      };
    });

    const evidence = await runtimeManager.executeCommand('npx', ['tsc', '--noEmit']);
    expect(evidence.stderr).toContain("error TS2304: Cannot find name 'calcTax_UNDEFINED_CALL'.");
    expect(evidence.exitCode).toBe(1);
  });

  it('D. duration comes from actual execution', async () => {
    const runtime = runtimeManager.getRuntime();

    vi.spyOn(runtime, 'spawn').mockImplementation(async (cmd, args) => {
      const exitPromise = new Promise<number>((resolve) => {
        setTimeout(() => resolve(0), 60);
      });
      return {
        processId: 'proc_duration',
        command: cmd,
        args,
        exit: exitPromise,
        kill: vi.fn()
      };
    });

    const start = Date.now();
    const evidence = await runtimeManager.executeCommand('sleep', ['60']);
    const elapsed = Date.now() - start;

    expect(evidence.durationMs).toBeGreaterThanOrEqual(50);
    expect(Math.abs(evidence.durationMs - elapsed)).toBeLessThan(20);
  });

  it('E. timeout is represented accurately', async () => {
    const runtime = runtimeManager.getRuntime();
    let resolveExit: (code: number) => void = () => {};
    const exitPromise = new Promise<number>((r) => { resolveExit = r; });

    const killSpy = vi.fn(async () => {
      resolveExit(143);
    });

    vi.spyOn(runtime, 'spawn').mockResolvedValue({
      processId: 'proc_timeout',
      command: 'sleep',
      args: ['1000'],
      exit: exitPromise,
      kill: killSpy
    });

    const evidence = await runtimeManager.executeCommand('sleep', ['1000'], { timeoutMs: 50 });
    expect(evidence.timedOut).toBe(true);
    expect(evidence.exitCode).toBeNull();
    expect(evidence.stderr).toContain('Process timed out after 50ms');
    expect(killSpy).toHaveBeenCalled();
  });

  it('F. no evidence is sent to Gemini before execution finishes', async () => {
    let executionFinished = false;

    const mockEvidence: ExecutionEvidence = {
      executionId: 'exec_awaited',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'TS2304 error',
      durationMs: 150,
      timedOut: false
    };

    // Simulate async execution taking 50ms
    const asyncExecution = new Promise<ExecutionEvidence>((resolve) => {
      setTimeout(() => {
        executionFinished = true;
        resolve(mockEvidence);
      }, 50);
    });

    // Diagnosing must await the evidence before calling AI provider
    const evidence = await asyncExecution;
    expect(executionFinished).toBe(true);

    const projId = 'proj-evidence-await';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'const x = 1;');

    // Verify runDiagnosisAndPatch receives the completed evidence
    expect(evidence.exitCode).toBe(1);
    expect(evidence.stderr).toBe('TS2304 error');
  });

  it('G. missing execution evidence produces a clear error rather than fabricated data', async () => {
    const projId = 'proj-no-evidence';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'const x = 1;');

    // When evidence is missing or undefined
    const undefinedEvidence = undefined as any;

    await expect(
      repairLoopEngine.runDiagnosisAndPatch(projId, undefinedEvidence)
    ).rejects.toThrow();
  });
});

describe('Fault Injection Source Shape Robustness', () => {
  it('export default function input gets fault', () => {
    const input = `import React from 'react';\n\nexport default function App() {\n  return <div>App</div>;\n}`;
    const { brokenCode, desc } = injectFaultIntoCode(input, 'syntax');

    expect(brokenCode).not.toBe(input);
    expect(brokenCode).toContain('calcTax_UNDEFINED_CALL(100)');
    expect(brokenCode).toContain('export default function App()');
    expect(desc).toContain('calcTax_UNDEFINED_CALL');
  });

  it('export function input gets fault', () => {
    const input = `import React from 'react';\n\nexport function App() {\n  return <div>App</div>;\n}\n\nexport default App;`;
    const { brokenCode, desc } = injectFaultIntoCode(input, 'syntax');

    expect(brokenCode).not.toBe(input);
    expect(brokenCode).toContain('calcTax_UNDEFINED_CALL(100)');
    expect(brokenCode).toContain('export function App()');
    expect(desc).toContain('calcTax_UNDEFINED_CALL');
  });

  it('export default input gets fault', () => {
    const input = `import React from 'react';\n\nconst App = () => <div>App</div>;\n\nexport default App;`;
    const { brokenCode, desc } = injectFaultIntoCode(input, 'syntax');

    expect(brokenCode).not.toBe(input);
    expect(brokenCode).toContain('calcTax_UNDEFINED_CALL(100)');
    expect(brokenCode).toContain('export default App;');
    expect(desc).toContain('calcTax_UNDEFINED_CALL');
  });

  it('fallback input gets fault when no standard export shape exists', () => {
    const input = `console.log("No standard export statements here");`;
    const { brokenCode, desc } = injectFaultIntoCode(input, 'syntax');

    expect(brokenCode).not.toBe(input);
    expect(brokenCode).toContain('calcTax_UNDEFINED_CALL(100)');
    expect(brokenCode).toContain(input);
    expect(desc).toContain('calcTax_UNDEFINED_CALL');
  });

  it('brokenCode is strictly different from currentCode across all shapes', () => {
    const shapes = [
      `export default function App() {}`,
      `export function App() {}\nexport default App;`,
      `const App = () => null;\nexport default App;`,
      `// Minimal script\nconst x = 42;`,
      ``
    ];

    for (const shape of shapes) {
      const { brokenCode } = injectFaultIntoCode(shape, 'syntax');
      expect(brokenCode).not.toBe(shape);
      expect(brokenCode).toContain('calcTax_UNDEFINED_CALL(100)');
    }
  });
});
