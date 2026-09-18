import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { Runtime, ExecutionProcess } from '../src/lib/runtime/Runtime';

/**
 * Validates that the actual production RuntimeManager handles timeouts and process lifecycle safely.
 */

describe('Production RuntimeManager Process Lifecycle & Timeout Handling (Tests A-G)', () => {
  function createMockRuntime(opts: {
    exitCode?: number;
    exitDelayMs?: number;
    neverExit?: boolean;
  }) {
    const killed = { value: false };
    let exitResolve: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolve = resolve;
      if (!opts.neverExit && opts.exitDelayMs !== undefined) {
        setTimeout(() => {
          if (!killed.value) resolve(opts.exitCode ?? 0);
        }, opts.exitDelayMs);
      } else if (!opts.neverExit) {
        resolve(opts.exitCode ?? 0);
      }
    });

    const mockProc: ExecutionProcess = {
      processId: 'mock_proc_' + Date.now(),
      command: 'cmd',
      args: [],
      exit: exitPromise,
      kill: vi.fn(async () => {
        killed.value = true;
        exitResolve?.(143);
      })
    };

    const mockRuntime: Runtime = {
      boot: vi.fn(async () => {}),
      isBooted: vi.fn(() => true),
      mount: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => ''),
      spawn: vi.fn(async (cmd, args, opts) => {
        mockProc.command = cmd;
        mockProc.args = args;
        return mockProc;
      }),
      startDevServer: vi.fn(async () => ({ port: 3000, url: 'http://localhost:3000' })),
      onOutput: vi.fn(() => () => {}),
      onServerReady: vi.fn(() => () => {})
    };

    return { mockRuntime, mockProc, killed };
  }

  it('A. command exits 0 -> success with actual exitCode, duration, and timedOut=false', async () => {
    const { mockRuntime, mockProc } = createMockRuntime({ exitCode: 0, exitDelayMs: 10 });
    runtimeManager.setRuntimeForTesting(mockRuntime);

    const ev = await runtimeManager.executeCommand('echo', ['hello'], { timeoutMs: 5000 });
    expect(ev.exitCode).toBe(0);
    expect(ev.timedOut).toBe(false);
    expect(ev.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockProc.kill).not.toHaveBeenCalled();
  });

  it('B. command exits non-zero -> failure with actual exitCode and timedOut=false', async () => {
    const { mockRuntime, mockProc } = createMockRuntime({ exitCode: 1, exitDelayMs: 10 });
    runtimeManager.setRuntimeForTesting(mockRuntime);

    const ev = await runtimeManager.executeCommand('npx', ['tsc', '--noEmit'], { timeoutMs: 5000 });
    expect(ev.exitCode).toBe(1);
    expect(ev.timedOut).toBe(false);
    expect(mockProc.kill).not.toHaveBeenCalled();
  });

  it('C. command times out -> timedOut=true, exitCode=null, and clear stderr', async () => {
    const { mockRuntime, mockProc } = createMockRuntime({ neverExit: true });
    runtimeManager.setRuntimeForTesting(mockRuntime);

    const ev = await runtimeManager.executeCommand('npm', ['run', 'build'], { timeoutMs: 50 });
    expect(ev.timedOut).toBe(true);
    expect(ev.exitCode).toBeNull();
    expect(ev.stderr).toContain('Process timed out after 50ms');
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it('D. timed-out process is killed and underlying kill is awaited', async () => {
    const { mockRuntime, mockProc, killed } = createMockRuntime({ neverExit: true });
    runtimeManager.setRuntimeForTesting(mockRuntime);

    await runtimeManager.executeCommand('npm', ['test'], { timeoutMs: 50 });
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
    expect(killed.value).toBe(true);
  });

  it('E. timeout timer is cleared after normal process exit', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { mockRuntime } = createMockRuntime({ exitCode: 0, exitDelayMs: 10 });
    runtimeManager.setRuntimeForTesting(mockRuntime);

    await runtimeManager.executeCommand('echo', ['quick'], { timeoutMs: 5000 });
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('F. dev server management starts and stops cleanly', async () => {
    let devServerRunning = false;
    const mockRuntime: any = {
      boot: vi.fn(async () => {}),
      isBooted: vi.fn(() => true),
      startDevServer: vi.fn(async () => {
        devServerRunning = true;
        return { port: 3000, url: 'http://localhost:3000' };
      }),
      stopDevServer: vi.fn(async () => {
        devServerRunning = false;
      }),
      isDevServerRunning: vi.fn(() => devServerRunning)
    };

    runtimeManager.setRuntimeForTesting(mockRuntime);
    const info = await runtimeManager.startDevServer();
    expect(info.port).toBe(3000);
    expect(runtimeManager.isDevServerRunning()).toBe(true);

    await runtimeManager.stopDevServer();
    expect(runtimeManager.isDevServerRunning()).toBe(false);
  });

  it('G. replaceProject synchronizes complete file manifest', async () => {
    const writtenFiles = new Map<string, string>();
    const mockRuntime: any = {
      isBooted: vi.fn(() => true),
      replaceProject: vi.fn(async (files: Record<string, string>) => {
        for (const [p, c] of Object.entries(files)) {
          writtenFiles.set(p, c);
        }
      })
    };

    runtimeManager.setRuntimeForTesting(mockRuntime);
    await runtimeManager.replaceProject({
      '/package.json': '{"name": "test"}',
      '/src/App.tsx': 'export default () => null;'
    });

    expect(mockRuntime.replaceProject).toHaveBeenCalled();
    expect(writtenFiles.get('package.json')).toBe('{"name": "test"}');
    expect(writtenFiles.get('src/App.tsx')).toBe('export default () => null;');
  });
});
