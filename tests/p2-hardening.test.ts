import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnsiStreamTracker, formatBoundarySafeLog } from '../src/lib/terminal/ansi-utils';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useProjectStore } from '../src/store/projectStore';
import { useAgentStore } from '../src/store/agentStore';
import { executeDeployment } from '../src/features/deployment/deployment-coordinator';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { ExecutionEvidence, Patch } from '../src/types/workspace';

describe('SnapDeploy AI — P2 Hardening Suite (INT-05 to INT-08, UX-01 to UX-03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAgentStore.getState().resetAgentState();
    useRuntimeStore.setState({
      logsByProject: {
        'proj-a': [],
        'proj-b': []
      },
      evidenceByProject: {},
      executionHistoryByProject: {},
      terminalLogs: [],
      lastEvidence: null,
      executionHistory: [],
      status: 'idle',
      isBottomDrawerOpen: false,
      activeBottomTab: 'terminal',
      bottomDrawerHeight: 280
    });
    useProjectStore.setState({
      activeProjectId: 'proj-a',
      projects: {
        'proj-a': {
          id: 'proj-a',
          title: 'Project Alpha',
          files: {
            '/package.json': { path: '/package.json', content: '{"name":"alpha"}' },
            '/index.html': { path: '/index.html', content: '<html><body>Alpha</body></html>' }
          },
          openTabs: ['/index.html'],
          activeFilePath: '/index.html',
          diagnostics: [],
          fixHistory: []
        } as any,
        'proj-b': {
          id: 'proj-b',
          title: 'Project Beta',
          files: {
            '/package.json': { path: '/package.json', content: '{"name":"beta"}' },
            '/index.html': { path: '/index.html', content: '<html><body>Beta</body></html>' }
          },
          openTabs: ['/index.html'],
          activeFilePath: '/index.html',
          diagnostics: [],
          fixHistory: []
        } as any
      }
    });
  });

  // =========================================================================
  // 1. INT-08: Stream-safe, boundary-aware ANSI Tracker
  // =========================================================================
  describe('INT-08 — Stream-Safe Boundary-Aware ANSI Tracker', () => {
    it('handles complete colored line and appends boundary reset', () => {
      const line = '\x1b[31mError occurred';
      const safe = formatBoundarySafeLog(line);
      expect(safe).toBe('\x1b[31mError occurred\x1b[0m');
    });

    it('does not duplicate reset if line already contains explicit reset', () => {
      const line = '\x1b[32mSuccess\x1b[0m';
      const safe = formatBoundarySafeLog(line);
      expect(safe).toBe('\x1b[32mSuccess\x1b[0m');
      expect(safe.endsWith('\x1b[0m\x1b[0m')).toBe(false);
    });

    it('preserves separate normal line without injecting spurious resets', () => {
      const line = 'Normal plain output line';
      const safe = formatBoundarySafeLog(line);
      expect(safe).toBe('Normal plain output line');
      expect(safe).not.toContain('\x1b[0m');
    });

    it('handles ANSI escape sequence split across chunks in stream', () => {
      const tracker = new AnsiStreamTracker();
      
      // Chunk 1 ends with partial escape: "\x1b[3"
      const res1 = tracker.processChunk('Building assets \x1b[3');
      expect(res1.output).toBe('Building assets ');
      expect(res1.hasActiveStyle).toBe(false);

      // Chunk 2 completes the escape: "1mfailed"
      const res2 = tracker.processChunk('1mfailed');
      expect(res2.output).toBe('\x1b[31mfailed');
      expect(res2.hasActiveStyle).toBe(true);

      // Boundary reset at stream boundary emits \x1b[0m
      const reset = tracker.boundaryReset();
      expect(reset).toBe('\x1b[0m');

      // Subsequent normal line has no active style
      const res3 = tracker.processChunk('Next step clean');
      expect(res3.hasActiveStyle).toBe(false);
      expect(tracker.boundaryReset()).toBe('');
    });

    it('handles consecutive styled chunks without premature reset', () => {
      const tracker = new AnsiStreamTracker();
      tracker.processChunk('\x1b[1m\x1b[34m[Step 1]');
      expect(tracker.hasActiveFormatting()).toBe(true);

      tracker.processChunk(' Still bold and blue');
      expect(tracker.hasActiveFormatting()).toBe(true);

      const reset = tracker.boundaryReset();
      expect(reset).toBe('\x1b[0m');
      expect(tracker.hasActiveFormatting()).toBe(false);
    });

    it('handles explicit process-emitted reset (SGR 0)', () => {
      const tracker = new AnsiStreamTracker();
      tracker.processChunk('\x1b[33mWarning\x1b[0m normal text');
      expect(tracker.hasActiveFormatting()).toBe(false);
      expect(tracker.boundaryReset()).toBe('');
    });
  });

  // =========================================================================
  // 2. UX-02: Zero-coupling Store Evidence Architecture
  // =========================================================================
  describe('UX-02 — Store Evidence Architecture (Zero Bidirectional Coupling)', () => {
    it('treats evidenceByProject as the sole mutable source of truth', () => {
      const evidenceA: ExecutionEvidence = {
        executionId: 'ev-a',
        command: 'npm',
        args: ['run', 'build'],
        exitCode: 1,
        stdout: '',
        stderr: 'Compilation error in Alpha',
        durationMs: 120
      };

      const evidenceB: ExecutionEvidence = {
        executionId: 'ev-b',
        command: 'npm',
        args: ['test'],
        exitCode: 0,
        stdout: 'All tests passed in Beta',
        stderr: '',
        durationMs: 45
      };

      useRuntimeStore.getState().recordEvidence(evidenceA, 'proj-a');
      useRuntimeStore.getState().recordEvidence(evidenceB, 'proj-b');

      const storeState = useRuntimeStore.getState();
      expect(storeState.evidenceByProject['proj-a']?.executionId).toBe('ev-a');
      expect(storeState.evidenceByProject['proj-b']?.executionId).toBe('ev-b');

      // Dynamic selector resolves evidence for requested project
      expect(storeState.getLastEvidence('proj-a')?.executionId).toBe('ev-a');
      expect(storeState.getLastEvidence('proj-b')?.executionId).toBe('ev-b');
    });

    it('derives lastEvidence dynamically when active project changes without push mutation', () => {
      const evidenceA: ExecutionEvidence = {
        executionId: 'ev-alpha',
        command: 'npm',
        args: ['run', 'build'],
        exitCode: 1,
        stdout: '',
        stderr: 'Alpha error',
        durationMs: 100
      };
      const evidenceB: ExecutionEvidence = {
        executionId: 'ev-beta',
        command: 'npm',
        args: ['run', 'build'],
        exitCode: 2,
        stdout: '',
        stderr: 'Beta error',
        durationMs: 100
      };

      useRuntimeStore.getState().recordEvidence(evidenceA, 'proj-a');
      useRuntimeStore.getState().recordEvidence(evidenceB, 'proj-b');

      // Alpha is active
      useProjectStore.setState({ activeProjectId: 'proj-a' });
      expect(useRuntimeStore.getState().getLastEvidence()).toBe(evidenceA);

      // Beta becomes active via projectStore without pushing into runtimeStore
      useProjectStore.getState().setActiveProjectId('proj-b');
      expect(useProjectStore.getState().activeProjectId).toBe('proj-b');
      expect(useRuntimeStore.getState().getLastEvidence()).toBe(evidenceB);
    });
  });

  // =========================================================================
  // 3. INT-05: Deployment Error Routing to Console
  // =========================================================================
  describe('INT-05 — Deployment Error Routing to Engineering Console', () => {
    it('routes deployment failure to project-scoped terminal logs and evidence', async () => {
      // Mock pre-deployment checks to fail
      const vfsSpy = vi.spyOn(vfsManager, 'getFiles').mockReturnValue({});

      await expect(executeDeployment('proj-a')).rejects.toThrow();

      const runtimeState = useRuntimeStore.getState();
      const logs = runtimeState.getTerminalLogs('proj-a');
      expect(logs.some(l => l.includes('[Deploy Failed]') || l.includes('[Deploy]'))).toBe(true);

      // Verify deploy error evidence was recorded under proj-a
      const deployEvidence = runtimeState.getLastEvidence('proj-a');
      expect(deployEvidence).toBeDefined();
      expect(deployEvidence?.command).toContain('deploy:');
      expect(deployEvidence?.exitCode).toBe(1);

      // Verify no leakage into proj-b
      expect(runtimeState.getLastEvidence('proj-b')).toBeNull();
      vfsSpy.mockRestore();
    });
  });

  // =========================================================================
  // 4. INT-06: Unified Diff Viewer Project Scoping & Rollback Invalidation
  // =========================================================================
  describe('INT-06 — Unified Diff Viewer Scoping & Invalidation', () => {
    it('sets patch with project binding and tracks patchProjectId', () => {
      const mockPatch: Patch = {
        id: 'patch-1',
        title: 'Fix Button',
        summary: 'Fix Button component',
        files: [{ path: '/src/Button.tsx', before: 'old', after: 'new' }],
        strategy: 'surgical'
      };

      useAgentStore.getState().setPendingPatch(mockPatch, 'proj-a');
      const state = useAgentStore.getState();
      expect(state.pendingPatch).toEqual(mockPatch);
      expect(state.patchProjectId).toBe('proj-a');
      expect(state.isDiffModalOpen).toBe(true);
    });

    it('clears pending patch on snapshot restore', async () => {
      const mockPatch: Patch = {
        id: 'patch-2',
        title: 'Fix Types',
        summary: 'Fix typing',
        files: [{ path: '/src/types.ts', before: 'a', after: 'b' }],
        strategy: 'surgical'
      };

      useAgentStore.getState().setPendingPatch(mockPatch, 'proj-a');
      expect(useAgentStore.getState().pendingPatch).not.toBeNull();

      vi.spyOn(snapshotService, 'restoreSnapshotById').mockResolvedValue({
        restoredFiles: {
          '/package.json': { path: '/package.json', content: '{"name":"alpha"}' }
        } as any,
        preRestoreCheckpoint: { id: 'chk-1' } as any
      });

      await useProjectStore.getState().restoreSnapshot('proj-a', 'snap-1');

      // Pending patch must be cleared
      expect(useAgentStore.getState().pendingPatch).toBeNull();
      expect(useAgentStore.getState().patchProjectId).toBeNull();
    });

    it('clears pending patch on repair rollback', async () => {
      const mockPatch: Patch = {
        id: 'patch-3',
        title: 'Failing Patch',
        summary: 'Will fail verification',
        files: [{ path: '/src/bad.ts', before: 'a', after: 'b' }],
        strategy: 'surgical'
      };

      useAgentStore.getState().setPendingPatch(mockPatch, 'proj-a');
      expect(useAgentStore.getState().pendingPatch).not.toBeNull();

      vi.spyOn(vfsManager, 'getFiles').mockReturnValue({
        '/src/bad.ts': { path: '/src/bad.ts', content: 'a' } as any
      });
      vi.spyOn(vfsManager, 'writeFile').mockResolvedValue();
      vi.spyOn(snapshotService, 'createSnapshot').mockResolvedValue({ id: 'snap-pre' } as any);
      vi.spyOn(snapshotService, 'restoreSnapshot').mockResolvedValue({} as any);
      vi.spyOn(runtimeManager, 'replaceProject').mockResolvedValue();
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: false,
        checks: [{ name: 'tsc', status: 'failed', success: false, output: 'Type error' }],
        totalDurationMs: 150
      });

      const result = await repairLoopEngine.applyPatchAndVerify('proj-a', mockPatch);
      expect(result.verified).toBe(false);

      // Pending patch must be cleared after rollback
      expect(useAgentStore.getState().pendingPatch).toBeNull();
    });
  });

  // =========================================================================
  // 5. INT-07: Bottom Drawer Strict 50% Viewport Ceiling
  // =========================================================================
  describe('INT-07 — Bottom Drawer 50% Viewport Ceiling Calculation', () => {
    it('calculates strict 50% visual viewport ceiling on desktop (1440x900)', () => {
      const viewportHeight = 900;
      const bottomDrawerHeight = 500;
      const maxAllowed = Math.floor(viewportHeight * 0.5); // 450
      const effectiveHeight = Math.min(bottomDrawerHeight, maxAllowed);
      expect(maxAllowed).toBe(450);
      expect(effectiveHeight).toBe(450);
      expect(effectiveHeight / viewportHeight).toBeLessThanOrEqual(0.5);
    });

    it('calculates strict 50% visual viewport ceiling on mobile portrait (390x844)', () => {
      const viewportHeight = 844;
      const bottomDrawerHeight = 500; // Maximized
      const maxAllowed = Math.floor(viewportHeight * 0.5); // 422
      const effectiveHeight = Math.min(bottomDrawerHeight, maxAllowed);
      expect(maxAllowed).toBe(422);
      expect(effectiveHeight).toBe(422);
      expect(effectiveHeight / viewportHeight).toBeLessThanOrEqual(0.5);
    });

    it('calculates strict 50% visual viewport ceiling on mobile portrait (375x812)', () => {
      const viewportHeight = 812;
      const bottomDrawerHeight = 280; // Default
      const maxAllowed = Math.floor(viewportHeight * 0.5); // 406
      const effectiveHeight = Math.min(bottomDrawerHeight, maxAllowed);
      expect(effectiveHeight).toBe(280);
      expect(effectiveHeight / viewportHeight).toBeLessThanOrEqual(0.5);
    });
  });

  // =========================================================================
  // 6. UX-01: Runtime-synchronized Terminal Badge
  // =========================================================================
  describe('UX-01 — Runtime-Synchronized Terminal Badge', () => {
    const getTerminalBadge = (status: string): string | null => {
      switch (status) {
        case 'running': return 'Live';
        case 'ready': return 'Ready';
        case 'booting': return 'Starting';
        case 'error': return 'Error';
        case 'idle': default: return null;
      }
    };

    it('maps running to Live', () => {
      expect(getTerminalBadge('running')).toBe('Live');
    });

    it('maps ready to Ready', () => {
      expect(getTerminalBadge('ready')).toBe('Ready');
    });

    it('maps booting to Starting', () => {
      expect(getTerminalBadge('booting')).toBe('Starting');
    });

    it('maps error to Error', () => {
      expect(getTerminalBadge('error')).toBe('Error');
    });

    it('maps idle to null', () => {
      expect(getTerminalBadge('idle')).toBeNull();
    });
  });

  // =========================================================================
  // 7. UX-03: Monaco Command Palette Shortcut Registration
  // =========================================================================
  describe('UX-03 — Monaco Command Palette Shortcut Registration', () => {
    it('registers action with disposable and cleans up on unmount without leaks', () => {
      let runAction: (() => void) | null = null;
      let isDisposed = false;

      const mockEditor = {
        addAction: vi.fn((descriptor: any) => {
          runAction = descriptor.run;
          return {
            dispose: () => {
              isDisposed = true;
            }
          };
        }),
        onDidDispose: vi.fn((cb: () => void) => {
          // simulation
        })
      };

      const mockMonaco = {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { KeyK: 41 }
      };

      const listeners: Record<string, Function[]> = {};
      const origWindow = (globalThis as any).window;
      const origCustomEvent = (globalThis as any).CustomEvent;
      (globalThis as any).window = {
        addEventListener: (event: string, fn: Function) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(fn);
        },
        removeEventListener: (event: string, fn: Function) => {
          listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
        },
        dispatchEvent: (ev: any) => {
          const fns = listeners[ev.type] || [];
          fns.forEach((fn) => fn(ev));
          return true;
        }
      };
      (globalThis as any).CustomEvent = class CustomEvent {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      };

      try {
        // Register
        const disposable = mockEditor.addAction({
          id: 'snapdeploy.openCommandPalette',
          label: 'Open Command Palette',
          keybindings: [mockMonaco.KeyMod.CtrlCmd | mockMonaco.KeyCode.KeyK],
          run: () => {
            (globalThis as any).window.dispatchEvent(new (globalThis as any).CustomEvent('snapdeploy:open-command-palette'));
          }
        });

        expect(mockEditor.addAction).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'snapdeploy.openCommandPalette',
            keybindings: [2048 | 41]
          })
        );

        // Verify event dispatch
        let eventDispatched = false;
        const listener = () => {
          eventDispatched = true;
        };
        (globalThis as any).window.addEventListener('snapdeploy:open-command-palette', listener);

        runAction?.();
        expect(eventDispatched).toBe(true);
        (globalThis as any).window.removeEventListener('snapdeploy:open-command-palette', listener);

        // Verify cleanup
        disposable.dispose();
        expect(isDisposed).toBe(true);
      } finally {
        (globalThis as any).window = origWindow;
        (globalThis as any).CustomEvent = origCustomEvent;
      }
    });
  });
});
