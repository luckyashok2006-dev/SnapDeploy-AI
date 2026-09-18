import { Runtime, PreviewInfo, OutputListener, ServerReadyListener } from './Runtime';
import { WebContainerRuntime } from './WebContainerRuntime';
import { ExecutionEvidence } from '../../types/workspace';
import { vfsManager } from '../vfs/vfs-manager';

/** Sentinel value returned by the timeout branch of Promise.race */
const TIMEOUT_SENTINEL = Symbol('TIMEOUT');

/** Default timeouts per command class (ms) */
const DEFAULT_TIMEOUT_MS = 180_000;          // 3 min general default
const COMMAND_TIMEOUTS: Record<string, number> = {
  'npm install':                                                         240_000,  // 4 min - network-dependent
  'npm install --no-audit --no-fund':                                    240_000,  // 4 min - optimized WebContainer install
  'npm install --no-audit --no-fund --legacy-peer-deps':                 240_000,  // 4 min - fast WebContainer install
  'npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps': 240_000,  // 4 min - secure WebContainer install
  'npx --no-install tsc --noEmit':                                       180_000,  // 3 min - TypeScript compilation
  'npx tsc --noEmit':                  180_000,  // 3 min - fallback
  'npm run build':                     180_000,  // 3 min - tsc + vite build combined
  'npm test':                          120_000,  // 2 min
};

function resolveTimeout(command: string, args: string[], explicitTimeout?: number): number {
  if (explicitTimeout !== undefined) return explicitTimeout;
  const key = `${command} ${args.join(' ')}`.trim();
  return COMMAND_TIMEOUTS[key] ?? DEFAULT_TIMEOUT_MS;
}

export class RuntimeManager {
  private static instance: RuntimeManager;
  private runtime: Runtime;
  private currentProjectId: string | null = null;
  private executionHistory: ExecutionEvidence[] = [];

  private constructor() {
    this.runtime = new WebContainerRuntime();
  }

  public static getInstance(): RuntimeManager {
    if (!RuntimeManager.instance) {
      RuntimeManager.instance = new RuntimeManager();
    }
    return RuntimeManager.instance;
  }

  public getRuntime(): Runtime {
    return this.runtime;
  }

  public setRuntimeForTesting(runtime: Runtime): void {
    this.runtime = runtime;
  }

  public async boot(): Promise<void> {
    await this.runtime.boot();
  }

  public isBooted(): boolean {
    return this.runtime.isBooted();
  }

  public getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  public setCurrentProjectId(projectId: string | null): void {
    this.currentProjectId = projectId;
  }

  public async cleanProject(projectId: string): Promise<void> {
    if (this.currentProjectId === projectId) {
      if (this.isDevServerRunning()) {
        await this.stopDevServer();
      }
      if (this.runtime.isBooted()) {
        if (typeof (this.runtime as any).replaceProject === 'function') {
          await (this.runtime as any).replaceProject({});
        }
      }
      this.currentProjectId = null;
    }
  }

  public async mountProject(projectId: string): Promise<void> {
    await vfsManager.waitUntilHydrated();
    
    // Stop running dev server before remounting
    if (this.isDevServerRunning()) {
      await this.stopDevServer();
    }

    const files = vfsManager.getFiles(projectId);
    const fileCount = Object.keys(files).length;

    if (fileCount > 0) {
      const tree = vfsManager.convertToWebContainerTree(projectId);
      await this.runtime.mount(tree);
    } else {
      // Clean project state for empty project
      if (typeof (this.runtime as any).replaceProject === 'function') {
        await (this.runtime as any).replaceProject({});
      }
    }

    this.currentProjectId = projectId;
  }

  public async syncFile(path: string, content: string, projectId?: string): Promise<void> {
    if (projectId && this.currentProjectId && this.currentProjectId !== projectId) {
      throw new Error(`Cannot sync file for project '${projectId}': runtime is mounted with '${this.currentProjectId}'`);
    }
    if (this.runtime.isBooted()) {
      await this.runtime.writeFile(path, content);
    }
  }

  public async replaceProject(
    files: Record<string, string | { content: string }>,
    projectId?: string
  ): Promise<void> {
    if (projectId && this.currentProjectId && this.currentProjectId !== projectId) {
      throw new Error(`Cannot replace project for '${projectId}': runtime is mounted with '${this.currentProjectId}'`);
    }
    if (this.runtime.isBooted()) {
      const normalizedFiles: Record<string, string> = {};
      for (const [path, val] of Object.entries(files)) {
        const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
        const content = typeof val === 'string' ? val : (val as any).content || '';
        normalizedFiles[cleanPath] = content;
      }
      if (typeof (this.runtime as any).replaceProject === 'function') {
        await (this.runtime as any).replaceProject(normalizedFiles);
      } else {
        for (const [path, content] of Object.entries(normalizedFiles)) {
          await this.runtime.writeFile(path, content);
        }
      }
    }
  }

  public async executeCommand(
    command: string,
    args: string[] = [],
    options?: { onOutput?: OutputListener; timeoutMs?: number; projectId?: string }
  ): Promise<ExecutionEvidence> {
    if (options?.projectId && this.currentProjectId && this.currentProjectId !== options.projectId) {
      throw new Error(
        `Cannot execute command for project '${options.projectId}': runtime is mounted with '${this.currentProjectId}'`
      );
    }

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    const timeoutMs = resolveTimeout(command, args, options?.timeoutMs);

    const handleOutput: OutputListener = (chunk, isErr) => {
      if (isErr) {
        stderr += chunk;
      } else {
        stdout += chunk;
      }
      if (options?.onOutput) {
        options.onOutput(chunk, isErr);
      }
    };

    let exitCode: number | null = null;
    let timedOut = false;

    try {
      const proc = await this.runtime.spawn(command, args, { onOutput: handleOutput });

      let timeoutTimer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
        timeoutTimer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
      });

      const result = await Promise.race([
        proc.exit.then((code) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          return { code };
        }),
        timeoutPromise
      ]);

      if (result === TIMEOUT_SENTINEL) {
        // Process exceeded timeout — terminate it, wait for exit, and mark as timed out
        timedOut = true;
        exitCode = null;
        stderr += `\n[RuntimeManager] Process timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`;

        try {
          await proc.kill();
          // Await actual exit of the killed process with a short bounded timeout
          await Promise.race([
            proc.exit,
            new Promise((resolve) => setTimeout(resolve, 5000))
          ]);
        } catch (killErr: any) {
          stderr += `\n[RuntimeManager] Failed to kill timed-out process: ${killErr?.message || 'Unknown error'}`;
        }
      } else {
        // Normal completion
        exitCode = result.code;
      }
    } catch (err: any) {
      stderr += `\n${err?.message || 'Execution error'}`;
      exitCode = 1;
    }

    const durationMs = Date.now() - startTime;
    const evidence: ExecutionEvidence = {
      executionId: `exec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      command,
      args,
      exitCode,
      stdout,
      stderr,
      durationMs,
      timedOut
    };

    this.executionHistory.push(evidence);
    return evidence;
  }

  public async areDependenciesInstalled(packageJsonContent?: string): Promise<boolean> {
    if (!this.runtime.isBooted()) return false;
    const hasTs = await this.hasLocalTypeScript();
    if (hasTs) return true;

    try {
      let pkgContent = packageJsonContent || '';
      if (!pkgContent) {
        try {
          pkgContent = await this.runtime.readFile('package.json');
        } catch {
          if (this.currentProjectId) {
            const files = vfsManager.getFiles(this.currentProjectId);
            pkgContent = files['/package.json']?.content || files['package.json']?.content || '';
          }
        }
      }

      if (!pkgContent || !pkgContent.trim()) {
        return true;
      }

      const parsed = JSON.parse(pkgContent);
      const deps = Object.keys(parsed.dependencies || {});
      const devDeps = Object.keys(parsed.devDependencies || {});
      const allDeps = [...deps, ...devDeps];
      if (allDeps.length > 0) {
        for (const dep of allDeps.slice(0, 2)) {
          const depPkg = await this.runtime.readFile(`node_modules/${dep}/package.json`);
          if (depPkg && depPkg.length > 0) return true;
        }
        return false;
      }

      // If package.json has no explicit dependencies listed, check if node_modules exists
      try {
        await this.runtime.readFile('node_modules/.package-lock.json');
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  public async installDependencies(onOutput?: OutputListener): Promise<ExecutionEvidence> {
    console.log('[Runtime] Installing dependencies...');
    const evidence = await this.executeCommand(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'],
      { onOutput, timeoutMs: 240_000 }
    );
    console.log(`[Runtime] npm install completed: exitCode=${evidence.exitCode}`);
    const hasTs = await this.hasLocalTypeScript();
    console.log(`[Runtime] TypeScript available: ${hasTs ? 'YES' : 'NO'}`);
    return evidence;
  }

  public async hasLocalTypeScript(): Promise<boolean> {
    if (typeof window !== 'undefined' && (window as any).__SNAPDEPLOY_MOCK_VERIFICATION__) {
      return true;
    }
    if (!this.runtime.isBooted()) return false;
    try {
      const content = await this.runtime.readFile('node_modules/typescript/package.json');
      return Boolean(content && content.length > 0);
    } catch {
      return false;
    }
  }

  public async ensureDependenciesInstalled(onOutput?: OutputListener): Promise<ExecutionEvidence | null> {
    if (!this.runtime.isBooted()) {
      await this.boot();
    }
    const depsInstalled = await this.areDependenciesInstalled();
    if (depsInstalled) {
      return null;
    }

    let hasPkgJson = false;
    try {
      const content = await this.runtime.readFile('package.json');
      hasPkgJson = Boolean(content && content.trim().length > 0);
    } catch {
      hasPkgJson = false;
    }

    if (!hasPkgJson) {
      return null;
    }

    return this.installDependencies(onOutput);
  }

  public async runTypeScriptCheck(onOutput?: OutputListener, projectId?: string): Promise<ExecutionEvidence> {
    if (typeof window !== 'undefined' && (window as any).__SNAPDEPLOY_MOCK_VERIFICATION__) {
      return {
        executionId: `exec_mock_ts_${Date.now()}`,
        command: 'npx --no-install tsc --noEmit',
        args: [],
        exitCode: 0,
        stdout: 'Clean compilation. Zero errors.',
        stderr: '',
        durationMs: 25,
        timedOut: false
      };
    }
    const hasTs = await this.hasLocalTypeScript();
    if (!hasTs) {
      return {
        executionId: `exec_missing_ts_${Date.now()}`,
        command: 'npx --no-install tsc --noEmit',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'Dependency error: TypeScript is not installed locally in node_modules. Please run npm install before verification.',
        durationMs: 0,
        timedOut: false
      };
    }
    return this.executeCommand('npx', ['--no-install', 'tsc', '--noEmit'], { onOutput, timeoutMs: 180_000, projectId });
  }

  public async runBuild(onOutput?: OutputListener): Promise<ExecutionEvidence> {
    if (typeof window !== 'undefined' && (window as any).__SNAPDEPLOY_MOCK_VERIFICATION__) {
      return {
        executionId: `exec_mock_build_${Date.now()}`,
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: 'Production build succeeded in 45ms.',
        stderr: '',
        durationMs: 30,
        timedOut: false
      };
    }
    return this.executeCommand('npm', ['run', 'build'], { onOutput, timeoutMs: 180_000 });
  }

  public async runTests(onOutput?: OutputListener): Promise<ExecutionEvidence> {
    return this.executeCommand('npm', ['test'], { onOutput, timeoutMs: 120_000 });
  }

  public async startDevServer(options?: { onOutput?: OutputListener; script?: string }): Promise<PreviewInfo> {
    return this.runtime.startDevServer(options);
  }

  public async stopDevServer(): Promise<void> {
    if (typeof (this.runtime as any).stopDevServer === 'function') {
      await (this.runtime as any).stopDevServer();
    }
  }

  public isDevServerRunning(): boolean {
    if (typeof (this.runtime as any).isDevServerRunning === 'function') {
      return (this.runtime as any).isDevServerRunning();
    }
    return false;
  }

  public onOutput(listener: OutputListener): () => void {
    return this.runtime.onOutput(listener);
  }

  public onServerReady(listener: ServerReadyListener): () => void {
    return this.runtime.onServerReady(listener);
  }

  public getLastEvidence(): ExecutionEvidence | null {
    return this.executionHistory[this.executionHistory.length - 1] || null;
  }

  public getExecutionHistory(): ExecutionEvidence[] {
    return [...this.executionHistory];
  }
}

export const runtimeManager = RuntimeManager.getInstance();

if (typeof window !== 'undefined') {
  (window as any).__SNAPDEPLOY_RUNTIME_MANAGER__ = runtimeManager;
}
