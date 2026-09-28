import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { repairCoordinator } from '../src/features/repair/repair-coordinator';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { resetEditorBoundary } from '../src/lib/editor/editor-boundary';
import { useProjectStore } from '../src/store/projectStore';
import { useRuntimeStore, DEFAULT_TERMINAL_LOGS } from '../src/store/runtimeStore';
import { useEditorStore } from '../src/store/editorStore';
import { useAgentStore } from '../src/store/agentStore';
import { useRepairStore } from '../src/store/repairStore';
import { ExecutionEvidence, Patch } from '../src/types/workspace';

describe('SnapDeploy AI — Phase 9.2: Cross-Surface State Reliability', () => {
  const PROJ_A = 'cross-proj-alpha';
  const PROJ_B = 'cross-proj-beta';

  beforeEach(async () => {
    await vfsManager.waitUntilHydrated();
    vi.restoreAllMocks();

    // Clean up stores
    useRepairStore.getState().deleteProjectRepairState(PROJ_A);
    useRepairStore.getState().deleteProjectRepairState(PROJ_B);
    useAgentStore.getState().resetAgentState();

    // Setup mock projects in projectStore
    useProjectStore.setState({
      projects: {
        [PROJ_A]: {
          id: PROJ_A,
          title: 'Project Alpha',
          description: 'Alpha workspace',
          badge: 'React',
          status: 'ready',
          files: {},
          diagnostics: [],
          fixHistory: []
        },
        [PROJ_B]: {
          id: PROJ_B,
          title: 'Project Beta',
          description: 'Beta workspace',
          badge: 'React',
          status: 'ready',
          files: {},
          diagnostics: [],
          fixHistory: []
        }
      },
      activeProjectId: PROJ_A
    });

    // Reset editor store
    useEditorStore.setState({
      openTabs: { [PROJ_A]: [], [PROJ_B]: [] },
      activeFilePath: { [PROJ_A]: undefined, [PROJ_B]: undefined },
      dirtyFiles: {},
      savedBaselines: {},
      modelEpoch: 0
    });

    // Reset runtime store
    useRuntimeStore.setState({
      status: 'idle',
      previewUrl: null,
      previewPort: null,
      logsByProject: { [PROJ_A]: [...DEFAULT_TERMINAL_LOGS], [PROJ_B]: [...DEFAULT_TERMINAL_LOGS] },
      evidenceByProject: {},
      executionHistoryByProject: {},
      terminalLogs: [...DEFAULT_TERMINAL_LOGS],
      lastEvidence: null,
      executionHistory: []
    });
  });

  // 1. INV-1: VFS ↔ Editor Convergence & Model Epoch Incrementing
  it('1. resetEditorBoundary updates baselines, clears dirty state, prunes deleted tabs, and increments modelEpoch', async () => {
    const editorStore = useEditorStore.getState();
    const initialEpoch = editorStore.modelEpoch;

    // Simulate open tabs and dirty files in Project A
    editorStore.openFile(PROJ_A, '/src/App.tsx');
    editorStore.openFile(PROJ_A, '/src/Temporary.tsx');
    editorStore.markDirty(PROJ_A, '/src/App.tsx', true);
    editorStore.markDirty(PROJ_A, '/src/Temporary.tsx', true);

    expect(useEditorStore.getState().openTabs[PROJ_A]).toEqual(['/src/App.tsx', '/src/Temporary.tsx']);
    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).toContain('/src/App.tsx');
    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).toContain('/src/Temporary.tsx');

    // postFiles only contains /src/App.tsx (/src/Temporary.tsx was deleted/rolled back)
    const postFiles = {
      '/src/App.tsx': { content: 'export default function App() { return <div>Alpha</div>; }' }
    };

    await resetEditorBoundary(PROJ_A, postFiles);

    const updated = useEditorStore.getState();
    // Tab for Temporary.tsx must be pruned
    expect(updated.openTabs[PROJ_A]).toEqual(['/src/App.tsx']);
    expect(updated.getDirtyFiles(PROJ_A)).toEqual([]);
    expect(updated.getSavedBaseline(PROJ_A, '/src/App.tsx')).toBe(postFiles['/src/App.tsx'].content);
    expect(updated.modelEpoch).toBe(initialEpoch + 1);
  });

  // 2. INV-2: Unsaved Edits vs Verification Semantics
  it('2. verification synchronizes current VFS edits into runtime via replaceProject without clearing user dirty flags', async () => {
    // Setup file in VFS
    const initialContent = 'const a: number = 10;';
    const unsavedContent = 'const a: number = "string-type-error";';

    await vfsManager.writeFile(PROJ_A, '/src/math.ts', initialContent);
    useEditorStore.getState().setSavedBaseline(PROJ_A, '/src/math.ts', initialContent);

    // User types in editor -> VFS is written, dirty flag set to true
    await vfsManager.writeFile(PROJ_A, '/src/math.ts', unsavedContent);
    useEditorStore.getState().markDirty(PROJ_A, '/src/math.ts', true);

    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).toContain('/src/math.ts');

    const syncedFiles: Record<string, string> = {};
    vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);
    vi.spyOn(runtimeManager, 'getCurrentProjectId').mockReturnValue(PROJ_A);
    vi.spyOn(runtimeManager, 'syncFile').mockImplementation(async (path, content) => {
      syncedFiles[path] = content;
    });
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'tsc-1',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/math.ts:1:7 - error TS2322: Type "string" is not assignable to type "number".',
      durationMs: 50
    });

    const result = await verificationService.runFullVerification({ projectId: PROJ_A });

    // WebContainer received the unsaved edit content via syncFile
    expect(syncedFiles['/src/math.ts']).toBe(unsavedContent);

    // Verification evaluated the unsaved error
    expect(result.success).toBe(false);

    // User dirty flag remained intact (not cleared prematurely by verification)
    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).toContain('/src/math.ts');
  });

  // 3. INV-3: Snapshot Restore Convergence with Rogue File Pruning
  it('3. snapshot restore removes added rogue files from VFS, editor tabs, and resets baselines', async () => {
    // 1. Initial snapshot with App.tsx
    await vfsManager.writeFile(PROJ_A, '/src/App.tsx', 'original code');
    const snap = await snapshotService.createSnapshot(PROJ_A, 'Clean baseline');

    // 2. Introduce rogue file and open in editor
    await vfsManager.writeFile(PROJ_A, '/src/RogueFile.tsx', 'corrupted rogue file');
    useEditorStore.getState().openFile(PROJ_A, '/src/RogueFile.tsx');
    useEditorStore.getState().openFile(PROJ_A, '/src/App.tsx');
    useEditorStore.getState().markDirty(PROJ_A, '/src/RogueFile.tsx', true);

    expect(useEditorStore.getState().openTabs[PROJ_A]).toContain('/src/RogueFile.tsx');
    expect(vfsManager.getFiles(PROJ_A)['/src/RogueFile.tsx']).toBeDefined();

    // 3. Restore snapshot
    await useProjectStore.getState().restoreSnapshot(PROJ_A, snap.id);

    // VFS should no longer contain RogueFile
    const postVfs = vfsManager.getFiles(PROJ_A);
    expect(postVfs['/src/RogueFile.tsx']).toBeUndefined();
    expect(postVfs['/src/App.tsx']).toBeDefined();

    // Editor tabs must be pruned: RogueFile is gone
    const postTabs = useEditorStore.getState().openTabs[PROJ_A];
    expect(postTabs).not.toContain('/src/RogueFile.tsx');
    expect(postTabs).toContain('/src/App.tsx');
    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).not.toContain('/src/RogueFile.tsx');
  });

  // 4. INV-4: Repair Rollback Convergence with Added File Pruning
  it('4. repair rollback purges newly added patch files from VFS and editor tabs', async () => {
    // 1. Clean state snapshot
    await vfsManager.writeFile(PROJ_A, '/src/App.tsx', 'clean initial state');
    await snapshotService.createSnapshot(PROJ_A, 'Pre-repair checkpoint');

    // 2. Simulate AI repair adding a rogue file
    const roguePatch: Patch = {
      id: 'patch-rogue',
      summary: 'Faulty repair that adds bad file',
      description: 'Faulty repair that adds bad file',
      targetFiles: ['/src/FaultyHelper.ts'],
      files: [
        {
          path: '/src/FaultyHelper.ts',
          before: '',
          after: 'export const invalid = undefined;',
          type: 'add'
        }
      ]
    };

    // Open tab for newly created file
    useEditorStore.getState().openFile(PROJ_A, '/src/FaultyHelper.ts');
    expect(useEditorStore.getState().openTabs[PROJ_A]).toContain('/src/FaultyHelper.ts');

    // Mock verification failure to force rollback in repairLoopEngine
    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      summary: 'Verification failed: build error in FaultyHelper.ts',
      checks: [
        {
          name: 'Build Check',
          command: 'npm run build',
          exitCode: 1,
          success: false,
          status: 'failed',
          timedOut: false,
          output: 'SyntaxError in FaultyHelper.ts',
          durationMs: 40
        }
      ],
      totalDurationMs: 40
    });

    const repairOutcome = await repairLoopEngine.applyPatchAndVerify(PROJ_A, roguePatch);
    expect(repairOutcome.verified).toBe(false);

    // Rollback must have restored VFS to pre-repair state (FaultyHelper deleted)
    const filesAfterRollback = vfsManager.getFiles(PROJ_A);
    expect(filesAfterRollback['/src/FaultyHelper.ts']).toBeUndefined();
    expect(filesAfterRollback['/src/App.tsx']).toBeDefined();

    // Editor tabs must be pruned by resetEditorBoundary
    const tabsAfterRollback = useEditorStore.getState().openTabs[PROJ_A];
    expect(tabsAfterRollback).not.toContain('/src/FaultyHelper.ts');
  });

  // 5. INV-5: Project Switch Isolation (Diagnostics & Evidence)
  it('5. switching from failing Project A to healthy Project B isolates evidence and terminal logs', async () => {
    const errorEvidence: ExecutionEvidence = {
      executionId: 'err-alpha',
      command: 'npm run dev',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Project Alpha Fatal Crash: port 3000 in use',
      durationMs: 80,
      projectId: PROJ_A
    };

    // Project A experiences failure
    useRuntimeStore.getState().recordEvidence(errorEvidence, PROJ_A);

    expect(useRuntimeStore.getState().lastEvidence).toEqual(errorEvidence);
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_A)).toEqual(errorEvidence);
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_B)).toBeNull();

    // User switches to Project B
    await useProjectStore.getState().switchProject(PROJ_B);

    // After switch: top-level lastEvidence must sync to Project B (null), NOT bleed Project A
    expect(useProjectStore.getState().activeProjectId).toBe(PROJ_B);
    expect(useRuntimeStore.getState().lastEvidence).toBeNull();
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_B)).toBeNull();
    // Project A's evidence is safely preserved in its scoped partition
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_A)).toEqual(errorEvidence);
  });

  // 6. INV-6: Agent Diagnosing & Repairing State Scoping on Project Switch
  it('6. agent diagnosing flag does not bleed into a healthy project upon project switch', () => {
    // Project A has active episode in diagnosing state
    const evidenceA: ExecutionEvidence = {
      executionId: 'ev-a',
      command: 'build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Error in A',
      durationMs: 20,
      projectId: PROJ_A
    };
    useRepairStore.getState().createEpisode(PROJ_A, evidenceA, 'fp-a', 'evfp-a');
    const epA = useRepairStore.getState().getActiveEpisode(PROJ_A)!;
    useRepairStore.getState().updateEpisodeStatus(PROJ_A, epA.failureEpisodeId, 'diagnosing');

    useAgentStore.getState().syncActiveProject(PROJ_A);
    expect(useAgentStore.getState().isDiagnosing).toBe(true);

    // Switch to Project B (no active episodes)
    useAgentStore.getState().syncActiveProject(PROJ_B);
    expect(useAgentStore.getState().isDiagnosing).toBe(false);
    expect(useAgentStore.getState().isRepairing).toBe(false);
  });

  // 7. INV-7: Stale onServerReady Race Elimination
  it('7. delayed onServerReady callback from Project A is rejected when Project B is active', () => {
    // Mock runtime manager mounted to Project A
    vi.spyOn(runtimeManager, 'getCurrentProjectId').mockReturnValue(PROJ_A);

    // Active project is switched to Project B
    useProjectStore.setState({ activeProjectId: PROJ_B });
    useRuntimeStore.setState({ previewUrl: null, status: 'idle' });

    // Delayed callback triggers on onServerReady
    let capturedCallback: ((port: number, url: string) => void) | null = null;
    vi.spyOn(runtimeManager, 'onServerReady').mockImplementation((cb) => {
      capturedCallback = cb;
    });

    // Boot listener registration
    useRuntimeStore.getState().bootRuntime();

    // Trigger callback from Project A's server boot
    expect(capturedCallback).toBeDefined();
    capturedCallback!(5173, 'http://localhost:5173');

    // Because activeProjectId is PROJ_B and mounted is PROJ_A, previewUrl must NOT be set
    expect(useRuntimeStore.getState().previewUrl).toBeNull();
    expect(useRuntimeStore.getState().status).not.toBe('ready');
  });

  // 8. INV-8: Project Switch During Finite Verification
  it('8. verification cleanly aborts if active project switches during execution', async () => {
    await vfsManager.writeFile(PROJ_A, '/src/index.ts', 'console.log("A");');
    vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);

    // Switch project during verification sync
    useProjectStore.setState({ activeProjectId: PROJ_A });

    vi.spyOn(runtimeManager, 'syncFile').mockImplementation(async () => {
      // Switch active project mid-flight
      useProjectStore.setState({ activeProjectId: PROJ_B });
    });

    const result = await verificationService.runFullVerification({ projectId: PROJ_A });

    // Verification must detect project mismatch and abort
    expect(result.success).toBe(false);
    expect(result.summary).toContain('active project changed');
  });

  // 9. INV-9: Project Switch During Automated Diagnosis
  it('9. automated diagnosis aborts cleanly if cancelled or superseded', async () => {
    const evidenceA: ExecutionEvidence = {
      executionId: 'ev-diag-a',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Build error',
      durationMs: 30,
      projectId: PROJ_A
    };

    const episode = useRepairStore.getState().createEpisode(PROJ_A, evidenceA, 'fp-diag', 'evfp-diag');

    // Mock long running diagnosis
    vi.spyOn(repairLoopEngine, 'runDiagnosisAndPatch').mockImplementation(async () => {
      // Simulate delay
      await new Promise((r) => setTimeout(r, 50));
      return {
        diagnosis: {
          failureEpisodeId: episode.failureEpisodeId,
          timestamp: Date.now(),
          category: 'SYNTAX',
          rootCause: 'Syntax Error',
          confidence: 0.9,
          hypotheses: [],
          relevantFiles: [],
          recommendedAction: 'Fix syntax',
          isHypothesis: false
        },
        patch: {
          id: 'patch-a',
          summary: 'Fix',
          description: 'Fix',
          targetFiles: [],
          files: []
        },
        plan: {
          category: 'SYNTAX',
          summary: 'Fix syntax',
          steps: [],
          targetFiles: [],
          estimatedRisk: 'LOW',
          recommendedChecks: []
        }
      };
    });

    const diagPromise = repairCoordinator.runEpisodeDiagnosis(PROJ_A, episode.failureEpisodeId);

    // Immediately cancel diagnosis
    repairCoordinator.cancelDiagnosis(PROJ_A);

    const res = await diagPromise;
    expect(res).toBeNull();

    // Verify episode status is cancelled
    const epAfter = useRepairStore.getState().getProjectEpisodes(PROJ_A).find((e) => e.failureEpisodeId === episode.failureEpisodeId);
    expect(epAfter?.status).toBe('cancelled');
  });

  // 10. INV-10: VFS Manager and WebContainer Synchrony
  it('10. replaceProject normalizes files and removes deleted files', async () => {
    const removedFiles: string[] = [];
    const writtenFiles: Record<string, string> = {};

    const mockFs = {
      rm: vi.fn(async (path: string) => {
        removedFiles.push(path);
      }),
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, content: string) => {
        writtenFiles[path] = content;
      })
    };

    const mockWebContainer = {
      fs: mockFs
    };

    const webRuntime = (runtimeManager as any).runtime;
    (webRuntime as any).webcontainerInstance = mockWebContainer;
    vi.spyOn(webRuntime, 'boot').mockResolvedValue(undefined as any);
    vi.spyOn(webRuntime, 'listAllFiles').mockResolvedValue(['src/old.ts', 'src/keep.ts', 'package.json']);

    await webRuntime.replaceProject({
      '/src/keep.ts': 'export const kept = true;',
      '/src/new.ts': 'export const newlyCreated = true;'
    });

    // src/old.ts was in existing files but NOT in incoming files -> must be removed!
    expect(removedFiles).toContain('src/old.ts');
    // package.json was in existing files but NOT in incoming files -> removed
    expect(removedFiles).toContain('package.json');
    // incoming files must be written
    expect(writtenFiles['src/keep.ts']).toBe('export const kept = true;');
    expect(writtenFiles['src/new.ts']).toBe('export const newlyCreated = true;');
  });

  // 11. Multi-file unsaved edits in Monaco
  it('11. verification evaluates multi-file unsaved edits together without clearing dirty state', async () => {
    await vfsManager.writeFile(PROJ_A, '/src/file1.ts', 'const a = 1;');
    await vfsManager.writeFile(PROJ_A, '/src/file2.ts', 'const b = 2;');
    useEditorStore.getState().setSavedBaseline(PROJ_A, '/src/file1.ts', 'const a = 1;');
    useEditorStore.getState().setSavedBaseline(PROJ_A, '/src/file2.ts', 'const b = 2;');

    // Unsaved edits in both files
    await vfsManager.writeFile(PROJ_A, '/src/file1.ts', 'const a: string = 1;');
    await vfsManager.writeFile(PROJ_A, '/src/file2.ts', 'const b: string = 2;');
    useEditorStore.getState().markDirty(PROJ_A, '/src/file1.ts', true);
    useEditorStore.getState().markDirty(PROJ_A, '/src/file2.ts', true);

    const syncedFiles: Record<string, string> = {};
    vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);
    vi.spyOn(runtimeManager, 'getCurrentProjectId').mockReturnValue(PROJ_A);
    vi.spyOn(runtimeManager, 'syncFile').mockImplementation(async (path, content) => {
      syncedFiles[path] = content;
    });
    vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
      executionId: 'tsc-multi',
      command: 'tsc',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Type errors in file1.ts and file2.ts',
      durationMs: 35
    });

    const res = await verificationService.runFullVerification({ projectId: PROJ_A });
    expect(res.success).toBe(false);

    // Both unsaved edits synced into WebContainer
    expect(syncedFiles['/src/file1.ts']).toBe('const a: string = 1;');
    expect(syncedFiles['/src/file2.ts']).toBe('const b: string = 2;');

    // Both files still marked dirty in editor
    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).toContain('/src/file1.ts');
    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).toContain('/src/file2.ts');
  });

  // 12. Snapshot restore with multi-file addition and modification
  it('12. snapshot restore reverts modified files and purges multiple added files from VFS and editor tabs', async () => {
    await vfsManager.writeFile(PROJ_A, '/src/main.ts', 'console.log("clean");');
    const snap = await snapshotService.createSnapshot(PROJ_A, 'Baseline');

    // Add 2 rogue files and modify 1 existing file
    await vfsManager.writeFile(PROJ_A, '/src/main.ts', 'console.log("dirty");');
    await vfsManager.writeFile(PROJ_A, '/src/rogue1.ts', 'rogue 1');
    await vfsManager.writeFile(PROJ_A, '/src/rogue2.ts', 'rogue 2');

    useEditorStore.getState().openFile(PROJ_A, '/src/main.ts');
    useEditorStore.getState().openFile(PROJ_A, '/src/rogue1.ts');
    useEditorStore.getState().openFile(PROJ_A, '/src/rogue2.ts');
    useEditorStore.getState().markDirty(PROJ_A, '/src/main.ts', true);
    useEditorStore.getState().markDirty(PROJ_A, '/src/rogue1.ts', true);

    await useProjectStore.getState().restoreSnapshot(PROJ_A, snap.id);

    const postVfs = vfsManager.getFiles(PROJ_A);
    expect(postVfs['/src/main.ts'].content).toBe('console.log("clean");');
    expect(postVfs['/src/rogue1.ts']).toBeUndefined();
    expect(postVfs['/src/rogue2.ts']).toBeUndefined();

    const postTabs = useEditorStore.getState().openTabs[PROJ_A];
    expect(postTabs).toEqual(['/src/main.ts']);
    expect(useEditorStore.getState().getDirtyFiles(PROJ_A)).toEqual([]);
  });

  // 13. Repair rollback with multi-file patch
  it('13. repair rollback purges multiple added files and restores modified files upon verification failure', async () => {
    await vfsManager.writeFile(PROJ_A, '/src/App.tsx', 'initial App');
    await snapshotService.createSnapshot(PROJ_A, 'Pre-repair');

    const multiPatch: Patch = {
      id: 'patch-multi',
      summary: 'Multi-file bad patch',
      description: 'Multi-file bad patch',
      targetFiles: ['/src/App.tsx', '/src/Util1.ts', '/src/Util2.ts'],
      files: [
        { path: '/src/App.tsx', before: 'initial App', after: 'broken App', type: 'modify' },
        { path: '/src/Util1.ts', before: '', after: 'bad util 1', type: 'add' },
        { path: '/src/Util2.ts', before: '', after: 'bad util 2', type: 'add' }
      ]
    };

    useEditorStore.getState().openFile(PROJ_A, '/src/Util1.ts');
    useEditorStore.getState().openFile(PROJ_A, '/src/Util2.ts');

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      summary: 'Build failed on Util1.ts',
      checks: [{ name: 'Build', command: 'build', exitCode: 1, success: false, status: 'failed', timedOut: false, durationMs: 20 }],
      totalDurationMs: 20
    });

    const outcome = await repairLoopEngine.applyPatchAndVerify(PROJ_A, multiPatch);
    expect(outcome.verified).toBe(false);

    const vfsAfter = vfsManager.getFiles(PROJ_A);
    expect(vfsAfter['/src/App.tsx'].content).toBe('initial App');
    expect(vfsAfter['/src/Util1.ts']).toBeUndefined();
    expect(vfsAfter['/src/Util2.ts']).toBeUndefined();

    const tabsAfter = useEditorStore.getState().openTabs[PROJ_A];
    expect(tabsAfter).not.toContain('/src/Util1.ts');
    expect(tabsAfter).not.toContain('/src/Util2.ts');
  });

  // 14. Project switch during executeCommand
  it('14. executeCommand routes evidence to options.projectId even when activeProjectId is different', async () => {
    useProjectStore.setState({ activeProjectId: PROJ_B });

    vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);
    vi.spyOn(runtimeManager, 'executeCommand').mockResolvedValue({
      executionId: 'cmd-a',
      command: 'test-cmd',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Error in proj A',
      durationMs: 15
    });

    const evidence = await useRuntimeStore.getState().executeCommand('test-cmd', [], { projectId: PROJ_A });

    // Evidence must be in PROJ_A partition
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_A)).toBeDefined();
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_A)?.executionId).toBe('cmd-a');
    // PROJ_B (active) should have received NO error evidence
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_B)).toBeNull();
  });

  // 15. Repair approval guard against project switch
  it('15. repairCoordinator.approveRepair aborts if active project does not match target episode', async () => {
    const evidenceA: ExecutionEvidence = {
      executionId: 'ev-appr-a',
      command: 'build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Build error',
      durationMs: 25,
      projectId: PROJ_A
    };
    const episode = useRepairStore.getState().createEpisode(PROJ_A, evidenceA, 'fp-appr', 'evfp-appr');
    useRepairStore.getState().updateEpisodeStatus(PROJ_A, episode.failureEpisodeId, 'proposal_ready');

    // User switches to Project B
    useProjectStore.setState({ activeProjectId: PROJ_B });

    // Attempting to approve Project A while Project B is active
    let loggedWarning = false;
    const progressCb = vi.fn((stage, msg) => {
      if (msg.includes('switched') || msg.includes('Aborting')) loggedWarning = true;
    });

    const res = await repairCoordinator.approveRepair(PROJ_A, episode.failureEpisodeId, progressCb);
    expect(res.verified).toBe(false);
  });

  // 16. DebugManagerPanel scoped evidence isolation
  it('16. getLastEvidence returns isolated failure state per project without cross-contamination', () => {
    const errorA: ExecutionEvidence = {
      executionId: 'err-panel-a',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Build failure in A',
      durationMs: 40,
      projectId: PROJ_A
    };

    useRuntimeStore.getState().recordEvidence(errorA, PROJ_A);

    // Active project is A: getLastEvidence(activeProjectId) returns errorA
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_A)).toEqual(errorA);
    // Active project is B: getLastEvidence(activeProjectId) returns null
    expect(useRuntimeStore.getState().getLastEvidence(PROJ_B)).toBeNull();
  });

  // 17. Execution history project isolation
  it('17. execution history keeps independent partitions for each project', () => {
    const evA: ExecutionEvidence = {
      executionId: 'hist-a',
      command: 'cmd-a',
      args: [],
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 10,
      projectId: PROJ_A
    };
    const evB: ExecutionEvidence = {
      executionId: 'hist-b',
      command: 'cmd-b',
      args: [],
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 10,
      projectId: PROJ_B
    };

    useRuntimeStore.getState().recordEvidence(evA, PROJ_A);
    useRuntimeStore.getState().recordEvidence(evB, PROJ_B);

    const historyA = useRuntimeStore.getState().executionHistoryByProject[PROJ_A];
    const historyB = useRuntimeStore.getState().executionHistoryByProject[PROJ_B];

    expect(historyA).toContainEqual(evA);
    expect(historyA).not.toContainEqual(evB);
    expect(historyB).toContainEqual(evB);
    expect(historyB).not.toContainEqual(evA);
  });

  // 18. Repeated snapshot restores converge deterministically
  it('18. successive snapshot restores increment modelEpoch monotonically and preserve tab integrity', async () => {
    await vfsManager.writeFile(PROJ_A, '/src/file.ts', 'v1');
    const snap1 = await snapshotService.createSnapshot(PROJ_A, 'Snapshot 1');

    await vfsManager.writeFile(PROJ_A, '/src/file.ts', 'v2');
    const snap2 = await snapshotService.createSnapshot(PROJ_A, 'Snapshot 2');

    useEditorStore.getState().openFile(PROJ_A, '/src/file.ts');

    const epochStart = useEditorStore.getState().modelEpoch;

    // Restore snap1
    await useProjectStore.getState().restoreSnapshot(PROJ_A, snap1.id);
    const epochAfter1 = useEditorStore.getState().modelEpoch;
    expect(epochAfter1).toBe(epochStart + 1);
    expect(vfsManager.getFiles(PROJ_A)['/src/file.ts'].content).toBe('v1');

    // Restore snap2
    await useProjectStore.getState().restoreSnapshot(PROJ_A, snap2.id);
    const epochAfter2 = useEditorStore.getState().modelEpoch;
    expect(epochAfter2).toBe(epochAfter1 + 1);
    expect(vfsManager.getFiles(PROJ_A)['/src/file.ts'].content).toBe('v2');
    expect(useEditorStore.getState().openTabs[PROJ_A]).toContain('/src/file.ts');
  });
});
