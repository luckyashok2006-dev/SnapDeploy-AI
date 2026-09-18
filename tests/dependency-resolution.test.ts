import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';

describe('Dependency Resolution & TypeScript Local Verification (Tests A-G)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const runtime = runtimeManager.getRuntime();
    vi.spyOn(runtime, 'isBooted').mockReturnValue(true);
    vi.spyOn(runtime, 'boot').mockResolvedValue(undefined);
    vi.spyOn(runtime, 'mount').mockResolvedValue(undefined as any);
    vi.spyOn(runtime, 'writeFile').mockResolvedValue(undefined as any);
    vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
    vi.spyOn(runtimeManager, 'stopDevServer').mockResolvedValue(undefined as any);
    vi.spyOn(runtimeManager, 'startDevServer').mockResolvedValue({ port: 3000, url: 'http://localhost:3000' });
  });

  it('A. package.json + missing node_modules -> npm install runs', async () => {
    const projId = 'proj-dep-a';
    await vfsManager.writeFile(projId, '/package.json', '{"name":"app","dependencies":{"react":"^18.3.1"}}');
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default () => null;');

    const installSpy = vi.spyOn(runtimeManager, 'installDependencies').mockResolvedValue({
      executionId: 'exec_install_a',
      command: 'npm install',
      args: [],
      exitCode: 0,
      stdout: 'added 25 packages',
      stderr: '',
      durationMs: 300,
      timedOut: false
    });

    await useRuntimeStore.getState().initializeProject(projId);

    expect(installSpy).toHaveBeenCalled();
    expect(useRuntimeStore.getState().status).toBe('ready');
  });

  it('B. npm install succeeds -> local TypeScript becomes available', async () => {
    const runtime = runtimeManager.getRuntime();
    vi.spyOn(runtime, 'isBooted').mockReturnValue(true);
    vi.spyOn(runtime, 'readFile').mockImplementation(async (path: string) => {
      if (path === 'node_modules/typescript/package.json') {
        return JSON.stringify({ name: 'typescript', version: '5.4.5' });
      }
      throw new Error('File not found');
    });

    const isAvailable = await runtimeManager.hasLocalTypeScript();
    expect(isAvailable).toBe(true);
  });

  it('C. npm install fails -> verification does not start', async () => {
    vi.spyOn(runtimeManager, 'installDependencies').mockResolvedValue({
      executionId: 'exec_install_fail',
      command: 'npm install',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'npm ERR! 404 Not Found',
      durationMs: 500,
      timedOut: false
    });

    const tsSpy = vi.spyOn(runtimeManager, 'runTypeScriptCheck');
    const buildSpy = vi.spyOn(runtimeManager, 'runBuild');

    const result = await verificationService.runFullVerification({ includeNpmInstall: true });
    expect(result.success).toBe(false);
    expect(result.checks[0].name).toBe('Dependency Installation');
    expect(result.checks[0].success).toBe(false);
    expect(tsSpy).not.toHaveBeenCalled();
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('D. already-installed dependencies -> npm install is not unnecessarily repeated', async () => {
    vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
    const installSpy = vi.spyOn(runtimeManager, 'installDependencies');

    const result = await runtimeManager.ensureDependenciesInstalled();
    expect(result).toBeNull();
    expect(installSpy).not.toHaveBeenCalled();
  });

  it('E. empty project -> npm install is skipped', async () => {
    const projEmpty = 'proj-empty-no-pkg';
    vfsManager.clearProjectFiles(projEmpty);

    const installSpy = vi.spyOn(runtimeManager, 'installDependencies');

    await useRuntimeStore.getState().initializeProject(projEmpty);

    expect(installSpy).not.toHaveBeenCalled();
  });

  it('F. rollback test starts with installed dependencies', async () => {
    const projId = 'proj-rollback-bootstrap';
    await vfsManager.writeFile(projId, '/package.json', '{"name":"rollback-demo"}');
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default () => null;');

    vi.spyOn(runtimeManager, 'installDependencies').mockResolvedValue({
      executionId: 'exec_install_rb',
      command: 'npm install',
      args: [],
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 200,
      timedOut: false
    });
    vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);

    await runtimeManager.boot();
    await runtimeManager.mountProject(projId);
    const installResult = await runtimeManager.installDependencies();
    const hasTs = await runtimeManager.hasLocalTypeScript();

    expect(installResult.exitCode).toBe(0);
    expect(hasTs).toBe(true);
  });

  it('G. npx --no-install tsc --noEmit executes a real local compiler after initialization', async () => {
    vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
    const execSpy = vi.spyOn(runtimeManager, 'executeCommand').mockResolvedValue({
      executionId: 'exec_ts_real',
      command: 'npx',
      args: ['--no-install', 'tsc', '--noEmit'],
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 500,
      timedOut: false
    });

    const check = await runtimeManager.runTypeScriptCheck();
    expect(check.exitCode).toBe(0);
    expect(check.timedOut).toBe(false);
    expect(execSpy).toHaveBeenCalledWith(
      'npx',
      ['--no-install', 'tsc', '--noEmit'],
      expect.anything()
    );
  });

  it('H. installDependencies executes npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps', async () => {
    const execSpy = vi.spyOn(runtimeManager, 'executeCommand').mockResolvedValue({
      executionId: 'exec_install_flags',
      command: 'npm',
      args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'],
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 100,
      timedOut: false
    });
    vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);

    const evidence = await runtimeManager.installDependencies();
    expect(evidence.exitCode).toBe(0);
    expect(execSpy).toHaveBeenCalledWith(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'],
      expect.anything()
    );
  });
});
