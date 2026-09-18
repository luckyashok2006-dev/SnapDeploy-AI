import { create } from 'zustand';
import { runtimeManager } from '../lib/runtime/runtime-manager';
import { ExecutionEvidence } from '../types/workspace';
import { isEligibleForAutoRepair } from '../features/repair/repair-policy';
import { repairCoordinator } from '../features/repair/repair-coordinator';
import { useProjectStore } from './projectStore';
import { sanitizeString } from '../features/deployment/security/log-sanitizer';

export interface RuntimeStoreState {
  status: 'idle' | 'booting' | 'ready' | 'running' | 'error';
  previewUrl: string | null;
  previewPort: number | null;

  // Project-Scoped State (EC-02 mutable source of truth)
  logsByProject: Record<string, string[]>;
  evidenceByProject: Record<string, ExecutionEvidence | null>;
  executionHistoryByProject: Record<string, ExecutionEvidence[]>;

  // Derived / legacy views
  terminalLogs: string[];
  lastEvidence: ExecutionEvidence | null;
  executionHistory: ExecutionEvidence[];
  pendingEvidencePromise: Promise<ExecutionEvidence> | null;
  isBottomDrawerOpen: boolean;
  activeBottomTab: 'terminal' | 'diagnostics' | 'verification';
  bottomDrawerHeight: number;

  // Selectors
  getTerminalLogs: (projectId?: string | null) => string[];
  getLastEvidence: (projectId?: string | null) => ExecutionEvidence | null;

  // Actions
  recordEvidence: (evidence: ExecutionEvidence, projectId?: string | null) => void;
  bootRuntime: () => Promise<void>;
  initializeProject: (projectId: string) => Promise<void>;
  mountAndStartProject: (projectId: string) => Promise<void>;
  executeCommand: (command: string, args?: string[], options?: { projectId?: string | null }) => Promise<ExecutionEvidence>;
  installDependencies: (projectId?: string | null) => Promise<ExecutionEvidence>;
  runBuild: (projectId?: string | null) => Promise<ExecutionEvidence>;
  runTypeScriptCheck: (projectId?: string | null) => Promise<ExecutionEvidence>;
  addTerminalLog: (log: string, projectId?: string | null) => void;
  clearTerminalLogs: (projectId?: string | null) => void;
  setPreviewUrl: (url: string | null, port?: number | null) => void;
  setIsBottomDrawerOpen: (open: boolean) => void;
  toggleBottomDrawer: () => void;
  setActiveBottomTab: (tab: 'terminal' | 'diagnostics' | 'verification') => void;
  setBottomDrawerHeight: (height: number) => void;
  setPendingEvidencePromise: (promise: Promise<ExecutionEvidence> | null) => void;
}

export const DEFAULT_TERMINAL_LOGS: string[] = [
  '\x1b[36m[SnapDeploy Runtime]\x1b[0m Ready to boot real in-browser WebContainer.'
];

const getActiveProjectId = () => useProjectStore?.getState?.()?.activeProjectId || 'default';

export const useRuntimeStore = create<RuntimeStoreState>((set, get) => ({
  status: 'idle',
  previewUrl: null,
  previewPort: null,

  logsByProject: {
    'saas-dashboard': DEFAULT_TERMINAL_LOGS,
    'default': DEFAULT_TERMINAL_LOGS
  },
  evidenceByProject: {},
  executionHistoryByProject: {},

  terminalLogs: DEFAULT_TERMINAL_LOGS,
  lastEvidence: null,
  executionHistory: [],
  pendingEvidencePromise: null,
  isBottomDrawerOpen: false,
  activeBottomTab: 'terminal',
  bottomDrawerHeight: 280,

  getTerminalLogs: (projectId?: string | null) => {
    const targetId = projectId || getActiveProjectId();
    return get().logsByProject[targetId] || DEFAULT_TERMINAL_LOGS;
  },

  getLastEvidence: (projectId?: string | null) => {
    const targetId = projectId || getActiveProjectId();
    return get().evidenceByProject[targetId] ?? null;
  },

  bootRuntime: async () => {
    if (get().status === 'ready' || get().status === 'running') return;
    set({ status: 'booting' });
    try {
      runtimeManager.onOutput((chunk) => {
        get().addTerminalLog(chunk);
      });

      runtimeManager.onServerReady((port, url) => {
        set({ previewUrl: url, previewPort: port, status: 'ready' });
        get().addTerminalLog(`\x1b[32m[Live Server]\x1b[0m Ready on ${url} (port ${port})`);
      });

      await runtimeManager.boot();
      set({ status: 'ready' });
    } catch (err: any) {
      set({ status: 'error' });
      get().addTerminalLog(`\x1b[31m[Boot Failed]\x1b[0m ${err?.message || 'Error booting WebContainer'}`);
      throw err;
    }
  },

  initializeProject: async (projectId: string) => {
    if (!projectId) return;
    const store = get();
    const projectIdAtStart = projectId;
    
    if (getActiveProjectId() === projectIdAtStart) {
      set({ status: 'running', previewUrl: null, previewPort: null });
    }

    try {
      // 1. Boot runtime
      await store.bootRuntime();

      // 2. Stop running dev server if switching from another project
      if (runtimeManager.isDevServerRunning()) {
        store.addTerminalLog(`\x1b[33m[Runtime]\x1b[0m Stopping active development server for previous project...`, projectIdAtStart);
        await runtimeManager.stopDevServer();
      }

      // 3. Mount project into WebContainer & track runtime project identity
      const { vfsManager } = await import('../lib/vfs/vfs-manager');
      await vfsManager.waitUntilHydrated();
      const files = vfsManager.getFiles(projectIdAtStart);
      const fileCount = Object.keys(files).length;

      store.addTerminalLog(`\x1b[34m[Project Mount]\x1b[0m Mounting project '${projectIdAtStart}' (${fileCount} files)...`, projectIdAtStart);
      await runtimeManager.mountProject(projectIdAtStart);

      // 4. Handle empty/new project: do not run npm install or dev server if no package.json
      const packageJsonFile = files['/package.json'] || files['package.json'];
      if (fileCount === 0 || !packageJsonFile) {
        store.addTerminalLog(`\x1b[33m[Project State]\x1b[0m Project '${projectIdAtStart}' is initialized without package.json. Awaiting file creation.`, projectIdAtStart);
        if (getActiveProjectId() === projectIdAtStart) {
          set({ status: 'ready', previewUrl: null, previewPort: null });
        }
        return;
      }

      // 5. Detect dependency state
      const depsInstalled = await runtimeManager.areDependenciesInstalled(packageJsonFile.content);

      // 6. Install dependencies only when required
      if (!depsInstalled) {
        store.addTerminalLog(`\x1b[35m[Dependencies]\x1b[0m Installing project dependencies...`, projectIdAtStart);
        const installEvidence = await runtimeManager.installDependencies((data) => store.addTerminalLog(data, projectIdAtStart));
        const isActiveNow = getActiveProjectId() === projectIdAtStart;
        set((state) => ({
          evidenceByProject: {
            ...state.evidenceByProject,
            [projectIdAtStart]: installEvidence
          },
          ...(isActiveNow ? { lastEvidence: installEvidence } : {})
        }));

        // 7. Require install exitCode === 0
        if (installEvidence.exitCode !== 0) {
          if (getActiveProjectId() === projectIdAtStart) {
            set({ status: 'error', isBottomDrawerOpen: true, activeBottomTab: 'diagnostics' });
          }
          store.addTerminalLog(`\x1b[31m[Install Failed]\x1b[0m npm install exited with code ${installEvidence.exitCode}`, projectIdAtStart);
          return;
        }
      } else {
        store.addTerminalLog(`\x1b[32m[Dependencies]\x1b[0m Local dependencies already installed.`, projectIdAtStart);
      }

      // 8. Verify local TypeScript separately with hasLocalTypeScript()
      const hasTs = await runtimeManager.hasLocalTypeScript();
      store.addTerminalLog(`\x1b[34m[Dependencies]\x1b[0m Local TypeScript compiler verified: ${hasTs ? 'YES' : 'NO'}`, projectIdAtStart);

      // 9. Detect dev script & start development server
      let devScript = 'dev';
      let hasDevScript = true;
      try {
        const pkgObj = JSON.parse(packageJsonFile.content);
        if (pkgObj?.scripts?.dev) {
          devScript = 'dev';
        } else if (pkgObj?.scripts?.start) {
          devScript = 'start';
        } else {
          hasDevScript = false;
        }
      } catch {}

      if (hasDevScript) {
        store.addTerminalLog(`\x1b[32m[Dev Server]\x1b[0m Starting development server (npm run ${devScript})...`, projectIdAtStart);
        const preview = await runtimeManager.startDevServer({
          onOutput: (data) => store.addTerminalLog(data, projectIdAtStart),
          script: devScript
        });

        // INT-03: Operation identity protection against project-switch race
        if (getActiveProjectId() === projectIdAtStart) {
          set({ previewUrl: preview.url, previewPort: preview.port, status: 'ready' });
        } else {
          console.log(`[RuntimeStore] Stale dev server completion discarded for '${projectIdAtStart}': active project switched to '${getActiveProjectId()}'`);
          if (runtimeManager.getCurrentProjectId() === projectIdAtStart) {
            runtimeManager.stopDevServer().catch(() => {});
          }
        }
      } else {
        store.addTerminalLog(`\x1b[33m[Dev Server]\x1b[0m No dev or start script found in package.json. Project mounted in ready state.`, projectIdAtStart);
        if (getActiveProjectId() === projectIdAtStart) {
          set({ previewUrl: null, previewPort: null, status: 'ready' });
        }
      }
    } catch (err: any) {
      if (getActiveProjectId() === projectIdAtStart) {
        set({ status: 'error', previewUrl: null, previewPort: null, isBottomDrawerOpen: true, activeBottomTab: 'diagnostics' });
      }
      store.addTerminalLog(`\x1b[31m[Initialization Error]\x1b[0m ${err?.message || 'Failed to initialize project runtime'}`, projectIdAtStart);
    }
  },

  mountAndStartProject: async (projectId: string) => {
    return get().initializeProject(projectId);
  },

  recordEvidence: (evidence: ExecutionEvidence, projectId?: string | null) => {
      const targetProjectId = projectId || getActiveProjectId();
      const hasMeaningfulDiagnostics = evidence.exitCode !== 0 || evidence.timedOut;
      const isEligible = isEligibleForAutoRepair(
        evidence.command,
        evidence.args,
        evidence.exitCode,
        evidence.timedOut,
        evidence
      );

      const activeIdNow = getActiveProjectId();
      const isStillActive = activeIdNow === targetProjectId;

      set((state) => {
        const updatedEvidenceByProject = {
          ...state.evidenceByProject,
          [targetProjectId]: evidence
        };
        const prevHistory = state.executionHistoryByProject[targetProjectId] || [];
        const updatedHistoryByProject = {
          ...state.executionHistoryByProject,
          [targetProjectId]: [...prevHistory, evidence]
        };

        return {
          evidenceByProject: updatedEvidenceByProject,
          executionHistoryByProject: updatedHistoryByProject,
          lastEvidence: updatedEvidenceByProject[activeIdNow] ?? null,
          executionHistory: updatedHistoryByProject[activeIdNow] || [],
          ...(isStillActive && hasMeaningfulDiagnostics ? { isBottomDrawerOpen: true, activeBottomTab: 'diagnostics' as const } : {})
        };
      });

      if (hasMeaningfulDiagnostics && isEligible) {
        repairCoordinator.handleRuntimeFailure(targetProjectId, evidence).catch((err) => {
          console.warn('[RuntimeStore] Automated repair trigger error:', err);
        });
      }
    },

    executeCommand: async (command, args = [], options) => {
      const targetProjectId = options?.projectId || runtimeManager.getCurrentProjectId() || getActiveProjectId();
      await get().bootRuntime();
      const evidence = await runtimeManager.executeCommand(command, args, {
        onOutput: (chunk) => get().addTerminalLog(chunk, targetProjectId),
        projectId: targetProjectId
      });
      get().recordEvidence(evidence, targetProjectId);
      return evidence;
    },

  installDependencies: async (projectId) => {
    return get().executeCommand('npm', ['install'], { projectId });
  },

  runBuild: async (projectId?: string | null) => {
    return get().executeCommand('npm', ['run', 'build'], { projectId });
  },

  runTypeScriptCheck: async (projectId?: string | null) => {
    return get().executeCommand('npx', ['--yes', '-p', 'typescript', 'tsc', '--noEmit'], { projectId });
  },

  addTerminalLog: (log: string, projectId?: string | null) => {
    // EC-06: Sanitize all displayed terminal output before storing or rendering
    const sanitized = sanitizeString(log);
    const targetId = projectId || getActiveProjectId();
    set((state) => {
      const prevLogs = state.logsByProject[targetId] || [];
      const updatedLogs = [...prevLogs, sanitized];
      const updatedLogsByProject = {
        ...state.logsByProject,
        [targetId]: updatedLogs
      };
      const activeId = getActiveProjectId();
      return {
        logsByProject: updatedLogsByProject,
        terminalLogs: updatedLogsByProject[activeId] || updatedLogs
      };
    });
  },

  clearTerminalLogs: (projectId?: string | null) => {
    const targetId = projectId || getActiveProjectId();
    set((state) => {
      const updatedLogsByProject = {
        ...state.logsByProject,
        [targetId]: []
      };
      const activeId = getActiveProjectId();
      return {
        logsByProject: updatedLogsByProject,
        terminalLogs: updatedLogsByProject[activeId] || []
      };
    });
  },

  setPreviewUrl: (url, port = 3000) => set({ previewUrl: url, previewPort: port }),

  setIsBottomDrawerOpen: (open) => set({ isBottomDrawerOpen: open }),
  toggleBottomDrawer: () => set((s) => ({ isBottomDrawerOpen: !s.isBottomDrawerOpen })),
  setActiveBottomTab: (tab) => set({ activeBottomTab: tab, isBottomDrawerOpen: true }),
  setBottomDrawerHeight: (height) => set({ bottomDrawerHeight: Math.max(160, Math.min(600, height)) }),
  setPendingEvidencePromise: (promise) => set({ pendingEvidencePromise: promise })
}));

export interface RuntimeSessionPayload {
  projectId: string | null;
  status: 'idle' | 'booting' | 'ready' | 'running' | 'error';
  previewUrl: string | null;
  previewPort: number | null;
  updatedAt: number;
}

export function broadcastRuntimeSession() {
  if (typeof window === 'undefined') return;
  try {
    const runtimeState = useRuntimeStore.getState();
    const projectId = useProjectStore.getState?.()?.activeProjectId || null;
    const session: RuntimeSessionPayload = {
      projectId,
      status: runtimeState.status,
      previewUrl: runtimeState.previewUrl,
      previewPort: runtimeState.previewPort,
      updatedAt: Date.now()
    };
    localStorage.setItem('snapdeploy_runtime_session', JSON.stringify(session));
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('snapdeploy_preview_channel');
      bc.postMessage({ type: 'RUNTIME_SESSION_UPDATE', session });
      bc.close();
    }
  } catch {}
}

if (typeof window !== 'undefined') {
  (window as any).useRuntimeStore = useRuntimeStore;

  useRuntimeStore.subscribe((state, prevState) => {
    if (state.status !== prevState.status || state.previewUrl !== prevState.previewUrl) {
      broadcastRuntimeSession();
    }
  });

  try {
    const hostBc = new BroadcastChannel('snapdeploy_preview_channel');
    hostBc.addEventListener('message', (event) => {
      if (event.data?.type === 'REQUEST_PREVIEW_STATE') {
        broadcastRuntimeSession();
      }
    });
  } catch {}
}
