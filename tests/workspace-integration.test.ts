import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from '../src/store/agentStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { verificationService } from '../src/features/verification/VerificationService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { Patch } from '../src/types/workspace';

describe('SnapDeploy AI — Workspace Integration Surgical Fixes (INT-01 to INT-04)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    useAgentStore.getState().resetAgentState();
    useEditorStore.setState({
      openTabs: {},
      activeFilePath: {},
      dirtyFiles: {},
      savedBaselines: {},
      modelEpoch: 0
    });
    useRuntimeStore.setState({
      logsByProject: {},
      evidenceByProject: {},
      executionHistoryByProject: {},
      terminalLogs: [],
      lastEvidence: null,
      bottomDrawerHeight: 280,
      isBottomDrawerOpen: true,
      activeBottomTab: 'terminal',
      status: 'idle',
      previewUrl: null,
      previewPort: null
    });
    useProjectStore.setState({
      activeProjectId: 'project-alpha',
      projects: {
        'project-alpha': {
          id: 'project-alpha',
          title: 'Alpha',
          files: {
            '/src/App.tsx': { path: '/src/App.tsx', content: 'export default function App() { return <div>Alpha</div>; }' }
          },
          openTabs: ['/src/App.tsx'],
          snapshots: [],
          diagnostics: [],
          fixHistory: []
        } as any,
        'project-beta': {
          id: 'project-beta',
          title: 'Beta',
          files: {
            '/src/App.tsx': { path: '/src/App.tsx', content: 'export default function App() { return <div>Beta</div>; }' }
          },
          openTabs: ['/src/App.tsx'],
          snapshots: [],
          diagnostics: [],
          fixHistory: []
        } as any
      }
    });

    // Seed VFS
    await vfsManager.writeFile('project-alpha', '/src/App.tsx', 'export default function App() { return <div>Alpha</div>; }');
    await vfsManager.writeFile('project-alpha', '/package.json', JSON.stringify({ name: 'alpha', scripts: { dev: 'vite' } }));
    await vfsManager.writeFile('project-beta', '/src/App.tsx', 'export default function App() { return <div>Beta</div>; }');
    await vfsManager.writeFile('project-beta', '/package.json', JSON.stringify({ name: 'beta', scripts: { dev: 'vite' } }));
  });

  // =========================================================================
  // INT-01: Dirty Editor/VFS -> WebContainer Verification Divergence
  // =========================================================================
  describe('INT-01: Dirty Editor/VFS Verification Synchronization', () => {
    it('syncs uncommitted dirty VFS edits to WebContainer before running checks', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      // Simulate an in-flight dirty edit in editor and VFS
      const originalCode = 'export default function App() { return <div>Alpha</div>; }';
      const dirtyCode = 'export default function App() { return <div>Alpha Dirty Edit</div>; }';
      useEditorStore.getState().setSavedBaseline(projId, '/src/App.tsx', originalCode);
      useEditorStore.getState().markDirty(projId, '/src/App.tsx', true);
      await vfsManager.writeFile(projId, '/src/App.tsx', dirtyCode);

      // Verify dirty state exists before verification
      expect(useEditorStore.getState().hasDirtyFiles(projId)).toBe(true);
      expect(useEditorStore.getState().checkIsDirty(projId, '/src/App.tsx', dirtyCode)).toBe(true);

      const syncedFiles: Record<string, string> = {};
      vi.spyOn(runtimeManager, 'syncFile').mockImplementation(async (path, content) => {
        syncedFiles[path] = content;
      });
      vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
      vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);
      vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
      vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
        executionId: 'exec_ts',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 0,
        stdout: 'Passed',
        stderr: '',
        durationMs: 300,
        timedOut: false
      });
      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValue({
        executionId: 'exec_build',
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: 'Build passed',
        stderr: '',
        durationMs: 500,
        timedOut: false
      });

      const initialSnapshotCount = vfsManager.getSnapshots(projId).length;

      // Run verification
      const result = await verificationService.runFullVerification({ projectId: projId });
      expect(result.success).toBe(true);

      // WebContainer must have received the authoritative dirty file
      expect(syncedFiles['/src/App.tsx']).toBe(dirtyCode);

      // Must preserve user dirty state (verification is NOT a save action)
      expect(useEditorStore.getState().hasDirtyFiles(projId)).toBe(true);

      // Must NOT have created an unrequested snapshot
      expect(vfsManager.getSnapshots(projId).length).toBe(initialSnapshotCount);
    });

    it('aborts verification safely if active project switched before checks execute', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
      vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);

      // Intercept syncFile to switch active project mid-flight
      vi.spyOn(runtimeManager, 'syncFile').mockImplementation(async () => {
        useProjectStore.setState({ activeProjectId: 'project-beta' });
      });

      const checkSpy = vi.spyOn(runtimeManager, 'runTypeScriptCheck');

      const result = await verificationService.runFullVerification({ projectId: projId });
      expect(result.success).toBe(false);
      expect(result.summary).toContain('Verification aborted: active project changed');
      expect(checkSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // INT-02: Snapshot Restore -> Stale Diagnosis/Verification State
  // =========================================================================
  describe('INT-02: Snapshot Restore Invalidates Stale Diagnosis and Verification', () => {
    it('clears active diagnosis and verification result on snapshot restore while preserving checkpoints', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      // Create a snapshot at baseline
      const snapshot = await vfsManager.createSnapshot(projId, 'Initial Clean State');

      // Add snapshot record to projectStore
      useProjectStore.setState((state) => ({
        projects: {
          ...state.projects,
          [projId]: {
            ...state.projects[projId],
            snapshots: [snapshot]
          }
        }
      }));

      // Simulate a broken state with diagnosis and failed verification result in agentStore
      useAgentStore.getState().setDiagnosis({
        category: 'SyntaxError',
        severity: 'high',
        affectedFiles: ['/src/App.tsx'],
        explanation: 'Broken syntax',
        suggestedFix: 'Fix it',
        confidence: 0.9,
        evidence: ['Error line 1']
      }, projId);

      useAgentStore.getState().setVerificationResult({
        success: false,
        checks: [
          { name: 'TypeScript', status: 'failed', success: false, durationMs: 400, output: 'Syntax error' }
        ],
        totalDurationMs: 400
      }, projId);

      expect(useAgentStore.getState().getDiagnosis(projId)).not.toBeNull();
      expect(useAgentStore.getState().getVerificationResult(projId)).not.toBeNull();

      // Restore snapshot
      const restoreSuccess = await useProjectStore.getState().restoreSnapshot(projId, snapshot.id);
      expect(restoreSuccess).toBe(true);

      // Must have cleared active diagnosis
      expect(useAgentStore.getState().getDiagnosis(projId)).toBeNull();
      expect(useAgentStore.getState().diagnosis).toBeNull();

      // Must have cleared active verification result
      expect(useAgentStore.getState().getVerificationResult(projId)).toBeNull();
      expect(useAgentStore.getState().verificationResult).toBeNull();

      // Must preserve snapshots history including pre-restore checkpoint
      const finalSnapshots = useProjectStore.getState().projects[projId].snapshots;
      expect(finalSnapshots.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // INT-03: Fast Project Switch Race Guard
  // =========================================================================
  describe('INT-03: Project Switch Dev Server Startup Race Guard', () => {
    it('discards stale dev server and shuts it down if project switched during startup', async () => {
      useProjectStore.setState({ activeProjectId: 'project-alpha' });

      let resolveDevServer: (val: any) => void;
      const devServerPromise = new Promise((resolve) => {
        resolveDevServer = resolve;
      });

      vi.spyOn(useRuntimeStore.getState(), 'bootRuntime').mockResolvedValue(undefined as any);
      vi.spyOn(runtimeManager, 'mountProject').mockResolvedValue(undefined as any);
      vi.spyOn(runtimeManager, 'areDependenciesInstalled').mockResolvedValue(true);
      vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
      vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
      vi.spyOn(runtimeManager, 'getCurrentProjectId').mockReturnValue('project-alpha');
      vi.spyOn(runtimeManager, 'startDevServer').mockReturnValue(devServerPromise as any);
      const stopServerSpy = vi.spyOn(runtimeManager, 'stopDevServer').mockResolvedValue(undefined as any);

      // Start initializing project-alpha
      const initPromise = useRuntimeStore.getState().initializeProject('project-alpha');

      // While dev server is starting, user switches active project to project-beta
      useProjectStore.setState({ activeProjectId: 'project-beta' });

      // Resolve dev server for project-alpha
      resolveDevServer!({ url: 'http://localhost:5173', port: 5173 });
      await initPromise;

      // Active state must NOT adopt project-alpha's previewUrl or port
      expect(useRuntimeStore.getState().previewUrl).toBeNull();
      expect(useRuntimeStore.getState().previewPort).toBeNull();

      // Stale dev server for project-alpha must be stopped
      expect(stopServerSpy).toHaveBeenCalled();
    });

    it('correctly sets previewUrl and status ready when project is NOT switched', async () => {
      useProjectStore.setState({ activeProjectId: 'project-alpha' });

      vi.spyOn(useRuntimeStore.getState(), 'bootRuntime').mockResolvedValue(undefined as any);
      vi.spyOn(runtimeManager, 'mountProject').mockResolvedValue(undefined as any);
      vi.spyOn(runtimeManager, 'areDependenciesInstalled').mockResolvedValue(true);
      vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
      vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
      vi.spyOn(runtimeManager, 'getCurrentProjectId').mockReturnValue('project-alpha');
      vi.spyOn(runtimeManager, 'startDevServer').mockResolvedValue({
        url: 'http://localhost:5173',
        port: 5173
      });

      await useRuntimeStore.getState().initializeProject('project-alpha');

      expect(useRuntimeStore.getState().status).toBe('ready');
      expect(useRuntimeStore.getState().previewUrl).toBe('http://localhost:5173');
      expect(useRuntimeStore.getState().previewPort).toBe(5173);
    });
  });

  // =========================================================================
  // INT-04: Repair Rollback & Success Editor Synchronization
  // =========================================================================
  describe('INT-04: Repair Rollback & Success Monaco/VFS/Editor Synchronization', () => {
    it('synchronizes baselines and increments modelEpoch on rollback after verification failure', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      const cleanCode = 'export default function App() { return <div>Alpha Clean</div>; }';
      await vfsManager.writeFile(projId, '/src/App.tsx', cleanCode);
      useEditorStore.getState().setSavedBaseline(projId, '/src/App.tsx', cleanCode);
      useEditorStore.getState().markDirty(projId, '/src/App.tsx', false);

      const initialEpoch = useEditorStore.getState().modelEpoch;

      const failingPatch: Patch = {
        summary: 'Introduce buggy repair',
        files: [
          {
            path: '/src/App.tsx',
            before: cleanCode,
            after: 'export default function App() { return <div>Alpha Buggy</div>; }'
          }
        ]
      };

      vi.spyOn(runtimeManager, 'replaceProject').mockResolvedValue(undefined as any);
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: false,
        summary: 'Build check failed',
        totalDurationMs: 600,
        checks: [
          { name: 'Build', status: 'failed', success: false, durationMs: 600, output: 'Syntax error in patch' }
        ]
      });

      const outcome = await repairLoopEngine.applyPatchAndVerify(projId, failingPatch);
      expect(outcome.verified).toBe(false);

      // VFS must be rolled back to pre-repair state
      const vfsFiles = vfsManager.getFiles(projId);
      expect(vfsFiles['/src/App.tsx'].content).toBe(cleanCode);

      // Editor saved baseline must be reset to the clean rolled-back code
      expect(useEditorStore.getState().getSavedBaseline(projId, '/src/App.tsx')).toBe(cleanCode);

      // Dirty flags must be cleared
      expect(useEditorStore.getState().hasDirtyFiles(projId)).toBe(false);
      expect(useEditorStore.getState().checkIsDirty(projId, '/src/App.tsx', cleanCode)).toBe(false);

      // modelEpoch must be incremented to force Monaco remount
      expect(useEditorStore.getState().modelEpoch).toBeGreaterThan(initialEpoch);
    });

    it('synchronizes baselines and increments modelEpoch on successful repair', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      const originalCode = 'export default function App() { return <div>Alpha Clean</div>; }';
      const patchedCode = 'export default function App() { return <div>Alpha Repaired</div>; }';
      await vfsManager.writeFile(projId, '/src/App.tsx', originalCode);
      useEditorStore.getState().setSavedBaseline(projId, '/src/App.tsx', originalCode);

      const initialEpoch = useEditorStore.getState().modelEpoch;

      const successfulPatch: Patch = {
        summary: 'Successful clean repair',
        files: [
          {
            path: '/src/App.tsx',
            before: originalCode,
            after: patchedCode
          }
        ]
      };

      vi.spyOn(runtimeManager, 'replaceProject').mockResolvedValue(undefined as any);
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: true,
        summary: 'Verification succeeded',
        totalDurationMs: 450,
        checks: [
          { name: 'TypeScript', status: 'passed', success: true, durationMs: 200 },
          { name: 'Build', status: 'passed', success: true, durationMs: 250 }
        ]
      });

      const outcome = await repairLoopEngine.applyPatchAndVerify(projId, successfulPatch);
      expect(outcome.verified).toBe(true);

      // VFS has patched content
      expect(vfsManager.getFiles(projId)['/src/App.tsx'].content).toBe(patchedCode);

      // Editor baseline updated to patched content
      expect(useEditorStore.getState().getSavedBaseline(projId, '/src/App.tsx')).toBe(patchedCode);

      // Dirty flags cleared
      expect(useEditorStore.getState().hasDirtyFiles(projId)).toBe(false);
      expect(useEditorStore.getState().checkIsDirty(projId, '/src/App.tsx', patchedCode)).toBe(false);

      // modelEpoch incremented
      expect(useEditorStore.getState().modelEpoch).toBeGreaterThan(initialEpoch);
    });
  });
});
