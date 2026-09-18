import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verificationService } from '../src/features/verification/VerificationService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';

describe('Verification Layer (Tests A-G)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
    vi.spyOn(runtimeManager, 'stopDevServer').mockResolvedValue(undefined as any);
    vi.spyOn(runtimeManager, 'startDevServer').mockResolvedValue({ port: 5173, url: 'http://localhost:5173' });
  });

  it('A. all checks pass', async () => {
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'exec_ts',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 0,
      stdout: 'TypeScript compilation passed',
      stderr: '',
      durationMs: 1500,
      timedOut: false
    });

    vi.spyOn(runtimeManager, 'runBuild').mockResolvedValue({
      executionId: 'exec_build',
      command: 'npm run build',
      args: [],
      exitCode: 0,
      stdout: 'Vite v5.0.0 building for production...\n✓ built in 850ms',
      stderr: '',
      durationMs: 2000,
      timedOut: false
    });

    const result = await verificationService.runFullVerification();
    expect(result.success).toBe(true);
    expect(result.checks.length).toBe(2);
    expect(result.checks[0].name).toBe('TypeScript Compilation');
    expect(result.checks[0].status).toBe('passed');
    expect(result.checks[0].success).toBe(true);
    expect(result.checks[0].exitCode).toBe(0);
    expect(result.checks[1].name).toBe('Production Build');
    expect(result.checks[1].status).toBe('passed');
    expect(result.checks[1].success).toBe(true);
    expect(result.checks[1].exitCode).toBe(0);
  });

  it('B. TypeScript fails', async () => {
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'exec_ts_err',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 2,
      stdout: '',
      stderr: "src/App.tsx(10,5): error TS2304: Cannot find name 'calculateTax'.",
      durationMs: 800,
      timedOut: false
    });

    const buildSpy = vi.spyOn(runtimeManager, 'runBuild');

    const result = await verificationService.runFullVerification();
    expect(result.success).toBe(false);
    expect(result.checks.length).toBe(1);
    expect(result.checks[0].name).toBe('TypeScript Compilation');
    expect(result.checks[0].status).toBe('failed');
    expect(result.checks[0].success).toBe(false);
    expect(result.checks[0].exitCode).toBe(2);
    expect(result.checks[0].output).toContain('TS2304');
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('C. build fails', async () => {
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'exec_ts',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1200,
      timedOut: false
    });

    vi.spyOn(runtimeManager, 'runBuild').mockResolvedValue({
      executionId: 'exec_build_err',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'RollupError: Could not resolve "./non-existent" from src/App.tsx',
      durationMs: 1100,
      timedOut: false
    });

    const result = await verificationService.runFullVerification();
    expect(result.success).toBe(false);
    expect(result.checks.length).toBe(2);
    expect(result.checks[0].success).toBe(true);
    expect(result.checks[1].name).toBe('Production Build');
    expect(result.checks[1].status).toBe('failed');
    expect(result.checks[1].success).toBe(false);
    expect(result.checks[1].exitCode).toBe(1);
    expect(result.checks[1].output).toContain('RollupError');
  });

  it('D. TypeScript times out', async () => {
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'exec_ts_timeout',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: null,
      stdout: '',
      stderr: 'Process timed out after 180000ms: npx tsc --noEmit',
      durationMs: 180000,
      timedOut: true
    });

    const result = await verificationService.runFullVerification();
    expect(result.success).toBe(false);
    expect(result.checks.length).toBe(1);
    expect(result.checks[0].name).toBe('TypeScript Compilation');
    expect(result.checks[0].status).toBe('timeout');
    expect(result.checks[0].success).toBe(false);
    expect(result.checks[0].timedOut).toBe(true);
    expect(result.checks[0].exitCode).toBe(null);
    expect(result.checks[0].output).toContain('[TIMEOUT]');
  });

  it('E. build times out', async () => {
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'exec_ts',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1200,
      timedOut: false
    });

    vi.spyOn(runtimeManager, 'runBuild').mockResolvedValue({
      executionId: 'exec_build_timeout',
      command: 'npm run build',
      args: [],
      exitCode: null,
      stdout: '',
      stderr: 'Process timed out after 180000ms: npm run build',
      durationMs: 180000,
      timedOut: true
    });

    const result = await verificationService.runFullVerification();
    expect(result.success).toBe(false);
    expect(result.checks.length).toBe(2);
    expect(result.checks[0].success).toBe(true);
    expect(result.checks[1].name).toBe('Production Build');
    expect(result.checks[1].status).toBe('timeout');
    expect(result.checks[1].success).toBe(false);
    expect(result.checks[1].timedOut).toBe(true);
    expect(result.checks[1].exitCode).toBe(null);
    expect(result.checks[1].output).toContain('[TIMEOUT]');
  });

  it('F. project with no test script', async () => {
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'exec_ts',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1000,
      timedOut: false
    });

    vi.spyOn(runtimeManager, 'runBuild').mockResolvedValue({
      executionId: 'exec_build',
      command: 'npm run build',
      args: [],
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1200,
      timedOut: false
    });

    const testSpy = vi.spyOn(runtimeManager, 'runTests');

    const result = await verificationService.runFullVerification({ includeTests: false });
    expect(result.success).toBe(true);
    expect(result.checks.length).toBe(2);
    expect(testSpy).not.toHaveBeenCalled();
  });

  it('G. final result always resolves', async () => {
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockRejectedValue(new Error('Fatal WebContainer IPC crash'));

    const result = await verificationService.runFullVerification();
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.checks.length).toBe(1);
    expect(result.checks[0].success).toBe(false);
    expect(result.checks[0].status).toBe('failed');
    expect(result.checks[0].output).toContain('Fatal WebContainer IPC crash');
    expect(typeof result.totalDurationMs).toBe('number');
  });
});
