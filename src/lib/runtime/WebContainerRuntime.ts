import { WebContainer } from '@webcontainer/api';
import { Runtime, RuntimeProcess, PreviewInfo, OutputListener, ServerReadyListener } from './Runtime';

export class WebContainerRuntime implements Runtime {
  private webcontainerInstance: WebContainer | null = null;
  private bootingPromise: Promise<void> | null = null;
  private activeProcesses: Map<string, any> = new Map();
  private devServerProcess: RuntimeProcess | null = null;
  private outputListeners: Set<OutputListener> = new Set();
  private serverReadyListeners: Set<ServerReadyListener> = new Set();
  private lastServerUrl: string | null = null;
  private lastPort: number | null = null;

  public isBooted(): boolean {
    if (!this.webcontainerInstance && (WebContainer as any)._instance) {
      this.webcontainerInstance = (WebContainer as any)._instance;
    }
    return this.webcontainerInstance !== null;
  }

  public async boot(): Promise<void> {
    if (this.webcontainerInstance) return;
    if ((WebContainer as any)._instance) {
      this.webcontainerInstance = (WebContainer as any)._instance;
      return;
    }
    if (this.bootingPromise) return this.bootingPromise;

    this.bootingPromise = (async () => {
      this.emitOutput('\x1b[36m[Runtime]\x1b[0m Booting WebContainer in-browser Node.js runtime...');
      
      const MAX_BOOT_ATTEMPTS = 2;
      const BOOT_TIMEOUT_MS = 45_000;
      let lastError: any = null;

      for (let attempt = 1; attempt <= MAX_BOOT_ATTEMPTS; attempt++) {
        try {
          if (attempt > 1) {
            this.emitOutput(`\x1b[33m[Runtime]\x1b[0m Retrying WebContainer boot (attempt ${attempt}/${MAX_BOOT_ATTEMPTS})...`);
          }
          const bootPromise = WebContainer.boot();
          const timeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
              reject(new Error(`WebContainer boot timed out after ${BOOT_TIMEOUT_MS / 1000}s (CDN or worker initialization stalled)`));
            }, BOOT_TIMEOUT_MS);
            bootPromise.then(() => clearTimeout(timer), () => clearTimeout(timer));
          });

          this.webcontainerInstance = await Promise.race([bootPromise, timeoutPromise]);
          
          // Listen to server-ready events
          this.webcontainerInstance.on('server-ready', (port, url) => {
            this.lastPort = port;
            this.lastServerUrl = url;
            this.emitOutput(`\x1b[32m[Runtime: Server Ready]\x1b[0m Port ${port} is active -> ${url}`);
            this.serverReadyListeners.forEach(listener => listener(port, url));
          });

          // Listen to errors
          this.webcontainerInstance.on('error', (err) => {
            this.emitOutput(`\x1b[31m[Runtime Error]\x1b[0m ${err.message}`, true);
          });

          this.emitOutput('\x1b[32m[Runtime]\x1b[0m WebContainer booted successfully.');
          return;
        } catch (err: any) {
          lastError = err;
          this.emitOutput(`\x1b[33m[Runtime Boot Attempt ${attempt} Failed]\x1b[0m ${err?.message || 'Boot failed'}`, true);
          if (attempt < MAX_BOOT_ATTEMPTS) {
            await new Promise((res) => setTimeout(res, 2000));
          }
        }
      }

      const errorMsg = lastError?.message || 'Failed to boot WebContainer';
      this.emitOutput(`\x1b[31m[Runtime Boot Failed]\x1b[0m ${errorMsg}`, true);
      throw lastError;
    })().finally(() => {
      this.bootingPromise = null;
    });

    return this.bootingPromise;
  }

  public async mount(files: Record<string, any>): Promise<void> {
    await this.boot();
    if (!this.webcontainerInstance) throw new Error('Runtime not booted');

    this.emitOutput(`\x1b[34m[Runtime]\x1b[0m Mounting project files into WebContainer root...`);
    await this.webcontainerInstance.mount(files);
    this.emitOutput(`\x1b[32m[Runtime]\x1b[0m Project files mounted.`);
  }

  private async listAllFiles(dir = ''): Promise<string[]> {
    if (!this.webcontainerInstance) return [];
    const cleanDir = dir.replace(/\\/g, '/').replace(/^\/+/, '');
    const fullDirPath = cleanDir || '.';
    try {
      const entries = await this.webcontainerInstance.fs.readdir(fullDirPath, { withFileTypes: true });
      const filePaths: string[] = [];
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vite') continue;
        const entryPath = cleanDir ? `${cleanDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const subFiles = await this.listAllFiles(entryPath);
          filePaths.push(...subFiles);
        } else {
          filePaths.push(entryPath);
        }
      }
      return filePaths;
    } catch {
      return [];
    }
  }

  public async replaceProject(files: Record<string, string>): Promise<void> {
    await this.boot();
    if (!this.webcontainerInstance) throw new Error('Runtime not booted');

    this.emitOutput('\x1b[34m[Runtime]\x1b[0m Synchronizing complete project filesystem tree...');

    // 1. Normalize incoming paths (e.g. "src/App.tsx", "package.json")
    const normalizedIncoming: Record<string, string> = {};
    for (const [rawPath, content] of Object.entries(files)) {
      const clean = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
      normalizedIncoming[clean] = typeof content === 'string' ? content : (content as any).content || '';
    }
    const incomingKeySet = new Set(Object.keys(normalizedIncoming));

    // 2. Discover existing filesystem entries to purge stale/rogue files (preserving node_modules)
    const existingFilePaths = await this.listAllFiles();
    for (const existingPath of existingFilePaths) {
      if (!incomingKeySet.has(existingPath)) {
        try {
          await this.webcontainerInstance.fs.rm(existingPath, { recursive: true, force: true });
        } catch (rmErr: any) {
          console.warn(`[WebContainerRuntime] Failed to remove stale file ${existingPath}:`, rmErr?.message);
        }
      }
    }

    // 3. Write all incoming project files, ensuring parent directories are created
    for (const [cleanPath, content] of Object.entries(normalizedIncoming)) {
      await this.writeFile(cleanPath, content);
    }

    this.emitOutput('\x1b[32m[Runtime]\x1b[0m Project tree synchronized cleanly.');
  }

  public async writeFile(path: string, content: string): Promise<void> {
    await this.boot();
    if (!this.webcontainerInstance) throw new Error('Runtime not booted');
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const lastSlash = cleanPath.lastIndexOf('/');
    if (lastSlash > 0) {
      const parentDir = cleanPath.slice(0, lastSlash);
      await this.webcontainerInstance.fs.mkdir(parentDir, { recursive: true });
    }
    await this.webcontainerInstance.fs.writeFile(cleanPath, content);
  }

  public async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await this.boot();
    if (!this.webcontainerInstance) throw new Error('Runtime not booted');
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    await this.webcontainerInstance.fs.rm(cleanPath, options);
  }

  public async readFile(path: string): Promise<string> {
    await this.boot();
    if (!this.webcontainerInstance) throw new Error('Runtime not booted');
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    return await this.webcontainerInstance.fs.readFile(cleanPath, 'utf-8');
  }

  public async spawn(
    command: string,
    args: string[] = [],
    options?: { onOutput?: OutputListener }
  ): Promise<RuntimeProcess> {
    await this.boot();
    if (!this.webcontainerInstance) throw new Error('Runtime not booted');

    const processId = `proc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fullCmd = `${command} ${args.join(' ')}`.trim();
    this.emitOutput(`\x1b[35m$ ${fullCmd}\x1b[0m`);

    const process = await this.webcontainerInstance.spawn(command, args);
    this.activeProcesses.set(processId, process);

    // Auto cleanup from active process tracking on completion
    process.exit.finally(() => {
      this.activeProcesses.delete(processId);
    });

    // Pipe process stdout
    process.output.pipeTo(
      new WritableStream({
        write: (chunk) => {
          this.emitOutput(chunk);
          if (options?.onOutput) {
            options.onOutput(chunk, false);
          }
        }
      })
    );

    const runtimeProc: RuntimeProcess = {
      processId,
      command,
      args,
      exit: process.exit,
      kill: async () => {
        try {
          process.kill();
        } catch {}
        this.activeProcesses.delete(processId);
      }
    };

    return runtimeProc;
  }

  public async startDevServer(options?: { onOutput?: OutputListener; script?: string }): Promise<PreviewInfo> {
    if (this.devServerProcess) {
      await this.devServerProcess.kill();
      this.devServerProcess = null;
    }

    return new Promise(async (resolve, reject) => {
      let resolved = false;
      let timeoutTimer: NodeJS.Timeout | null = null;

      const unbind = this.onServerReady((port, url) => {
        if (!resolved) {
          resolved = true;
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
          unbind();
          resolve({ port, url });
        }
      });

      try {
        const devScript = options?.script || 'dev';
        const proc = await this.spawn('npm', ['run', devScript], options);
        this.devServerProcess = proc;

        // Timeout fallback if server doesn't report in 90s
        timeoutTimer = setTimeout(() => {
          if (!resolved) {
            unbind();
            if (this.lastServerUrl && this.lastPort) {
              resolve({ port: this.lastPort, url: this.lastServerUrl });
            } else {
              reject(new Error('Dev server startup timed out'));
            }
          }
        }, 90000);
      } catch (err) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        unbind();
        reject(err);
      }
    });
  }

  public async stopDevServer(): Promise<void> {
    if (this.devServerProcess) {
      await this.devServerProcess.kill();
      this.devServerProcess = null;
      this.emitOutput('\x1b[33m[Runtime]\x1b[0m Development server stopped.');
    }
  }

  public isDevServerRunning(): boolean {
    return this.devServerProcess !== null;
  }

  public async kill(processId: string): Promise<void> {
    const proc = this.activeProcesses.get(processId);
    if (proc) {
      try {
        proc.kill();
      } catch {}
      this.activeProcesses.delete(processId);
    }
  }

  public onServerReady(listener: ServerReadyListener): () => void {
    this.serverReadyListeners.add(listener);
    return () => this.serverReadyListeners.delete(listener);
  }

  public onOutput(listener: OutputListener): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  private emitOutput(data: string, isError = false) {
    this.outputListeners.forEach(listener => listener(data, isError));
  }

  public async dispose(): Promise<void> {
    if (this.devServerProcess) {
      await this.devServerProcess.kill();
      this.devServerProcess = null;
    }
    for (const proc of this.activeProcesses.values()) {
      try {
        proc.kill();
      } catch {}
    }
    this.activeProcesses.clear();
  }
}
