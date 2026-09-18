export interface RuntimeProcess {
  processId: string;
  command: string;
  args: string[];
  exit: Promise<number>;
  kill(): Promise<void>;
}

export interface PreviewInfo {
  port: number;
  url: string;
}

export type OutputListener = (data: string, isError?: boolean) => void;
export type ServerReadyListener = (port: number, url: string) => void;

export interface Runtime {
  boot(): Promise<void>;
  isBooted(): boolean;
  mount(files: Record<string, any>): Promise<void>;
  replaceProject?(files: Record<string, string>): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  spawn(
    command: string,
    args?: string[],
    options?: { onOutput?: OutputListener }
  ): Promise<RuntimeProcess>;
  startDevServer(options?: { onOutput?: OutputListener; script?: string }): Promise<PreviewInfo>;
  stopDevServer?(): Promise<void>;
  isDevServerRunning?(): boolean;
  kill(processId: string): Promise<void>;
  onServerReady(listener: ServerReadyListener): () => void;
  onOutput(listener: OutputListener): () => void;
  dispose(): Promise<void>;
}
