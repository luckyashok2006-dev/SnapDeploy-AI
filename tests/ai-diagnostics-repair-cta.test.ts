import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../src/store/agentStore';
import { useProjectStore } from '../src/store/projectStore';
import { useRepairStore } from '../src/store/repairStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { Patch, Diagnosis } from '../src/types/workspace';

describe('AI Diagnostics & Repair — "Review AI Patch Diff" CTA Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAgentStore.getState().resetAgentState();
    useRepairStore.setState({
      episodes: {},
      activeEpisodeId: {},
      isLoopPaused: {},
      processedFingerprints: {}
    });
  });

  const mockDiagnosisA: Diagnosis = {
    category: 'syntax',
    severity: 'high',
    explanation: 'Unclosed JSX tag in App.tsx',
    affectedFiles: ['src/App.tsx'],
    evidence: ['SyntaxError: Unterminated JSX contents'],
    suggestedFix: 'Close the <div> tag properly'
  };

  const mockPatchA: Patch = {
    id: 'patch_proj_a_1',
    summary: 'Fix unclosed JSX tag in App.tsx',
    files: [
      {
        path: 'src/App.tsx',
        before: '<div className="app">\n<h1>Hello</h1>\n',
        after: '<div className="app">\n<h1>Hello</h1>\n</div>'
      }
    ],
    confidence: 0.98
  };

  const mockDiagnosisB: Diagnosis = {
    category: 'type',
    severity: 'medium',
    explanation: 'Type mismatch in utils.ts',
    affectedFiles: ['src/utils.ts'],
    evidence: ['TS2322: Type number is not assignable to string'],
    suggestedFix: 'Convert number to string using toString()'
  };

  const mockPatchB: Patch = {
    id: 'patch_proj_b_1',
    summary: 'Fix number to string type error in utils.ts',
    files: [
      {
        path: 'src/utils.ts',
        before: 'export const format = (val: number): string => val;',
        after: 'export const format = (val: number): string => val.toString();'
      }
    ],
    confidence: 0.95
  };

  it('1. Canonical Source of Truth: pendingPatchByProject is authoritative and getPendingPatch reads from it', () => {
    useAgentStore.getState().setPendingPatch(mockPatchA, 'proj-alpha', false);
    useAgentStore.getState().setPendingPatch(mockPatchB, 'proj-beta', false);

    // Canonical project-scoped mapping must hold both patches independently
    const store = useAgentStore.getState();
    expect(store.pendingPatchByProject['proj-alpha']).toEqual(mockPatchA);
    expect(store.pendingPatchByProject['proj-beta']).toEqual(mockPatchB);

    // Selector getPendingPatch reads directly from canonical mapping
    expect(store.getPendingPatch('proj-alpha')).toEqual(mockPatchA);
    expect(store.getPendingPatch('proj-beta')).toEqual(mockPatchB);
    expect(store.getPendingPatch('non-existent')).toBeNull();
  });

  it('2. Diagnosis completion stores patch canonically without prematurely popping up modal', async () => {
    const projId = 'proj-diagnosis-flow';
    useProjectStore.setState({ activeProjectId: projId });

    // Simulate repairLoopEngine.runDiagnosisAndPatch producing diagnosis and patch
    vi.spyOn(repairLoopEngine, 'runDiagnosisAndPatch').mockResolvedValue({
      diagnosis: mockDiagnosisA,
      patch: mockPatchA
    });

    // Simulate completion with openModal = false
    useAgentStore.getState().setDiagnosis(mockDiagnosisA, projId);
    useAgentStore.getState().setPendingPatch(mockPatchA, projId, false);

    const state = useAgentStore.getState();
    expect(state.getDiagnosis(projId)).toEqual(mockDiagnosisA);
    expect(state.getPendingPatch(projId)).toEqual(mockPatchA);
    expect(state.isDiffModalOpen).toBe(false); // CTA is presented in result card, not pre-opened
  });

  it('3. Review AI Patch Diff CTA click resolves patch and opens Diff Viewer', () => {
    const projId = 'proj-review-cta';
    useProjectStore.setState({ activeProjectId: projId });

    useAgentStore.getState().setDiagnosis(mockDiagnosisA, projId);
    useAgentStore.getState().setPendingPatch(mockPatchA, projId, false);

    // Verify initial state: patch is ready but diff modal is closed
    expect(useAgentStore.getState().isDiffModalOpen).toBe(false);

    // Simulate handleReviewPatchDiff handler
    const targetProjId = projId;
    const patch = useAgentStore.getState().getPendingPatch(targetProjId);
    expect(patch).toEqual(mockPatchA);

    useAgentStore.getState().setPendingPatch(patch, targetProjId, true);
    useAgentStore.getState().setIsDiffModalOpen(true);

    // Verify diff modal is now open with project-bound patch
    const afterClick = useAgentStore.getState();
    expect(afterClick.isDiffModalOpen).toBe(true);
    expect(afterClick.pendingPatch).toEqual(mockPatchA);
    expect(afterClick.patchProjectId).toBe(projId);
  });

  it('4. Dismissing / Closing viewer preserves project patch so re-opening works', () => {
    const projId = 'proj-dismiss-reopen';
    useProjectStore.setState({ activeProjectId: projId });

    useAgentStore.getState().setDiagnosis(mockDiagnosisA, projId);
    useAgentStore.getState().setPendingPatch(mockPatchA, projId, true);
    expect(useAgentStore.getState().isDiffModalOpen).toBe(true);

    // User closes the modal via the "X" button (handleClose: setIsDiffModalOpen(false))
    useAgentStore.getState().setIsDiffModalOpen(false);

    // Modal is closed, but canonical patch is preserved!
    expect(useAgentStore.getState().isDiffModalOpen).toBe(false);
    expect(useAgentStore.getState().getPendingPatch(projId)).toEqual(mockPatchA);

    // User clicks "Review AI Patch Diff" again in the result card
    const resolvedPatch = useAgentStore.getState().getPendingPatch(projId);
    expect(resolvedPatch).not.toBeNull();
    useAgentStore.getState().setPendingPatch(resolvedPatch, projId, true);
    useAgentStore.getState().setIsDiffModalOpen(true);

    // Modal successfully re-opens with the preserved patch!
    expect(useAgentStore.getState().isDiffModalOpen).toBe(true);
    expect(useAgentStore.getState().pendingPatch).toEqual(mockPatchA);
  });

  it('5. Project Isolation Invariant: Project A patch cannot accidentally display when Project B is active', () => {
    // Setup Project A with patch A
    useProjectStore.setState({ activeProjectId: 'proj-a' });
    useAgentStore.getState().setDiagnosis(mockDiagnosisA, 'proj-a');
    useAgentStore.getState().setPendingPatch(mockPatchA, 'proj-a', false);

    // Setup Project B with patch B
    useAgentStore.getState().setDiagnosis(mockDiagnosisB, 'proj-b');
    useAgentStore.getState().setPendingPatch(mockPatchB, 'proj-b', false);

    // 1. When Project A is active:
    useProjectStore.setState({ activeProjectId: 'proj-a' });
    useAgentStore.getState().syncActiveProject('proj-a');

    expect(useAgentStore.getState().getPendingPatch('proj-a')).toEqual(mockPatchA);
    expect(useAgentStore.getState().pendingPatch?.id).toBe('patch_proj_a_1');
    expect(useAgentStore.getState().patchProjectId).toBe('proj-a');

    // 2. Switch to Project B:
    useProjectStore.setState({ activeProjectId: 'proj-b' });
    useAgentStore.getState().syncActiveProject('proj-b');

    expect(useAgentStore.getState().getPendingPatch('proj-b')).toEqual(mockPatchB);
    expect(useAgentStore.getState().pendingPatch?.id).toBe('patch_proj_b_1');
    expect(useAgentStore.getState().patchProjectId).toBe('proj-b');

    // Project A's patch is NOT shown while Project B is active
    expect(useAgentStore.getState().pendingPatch?.id).not.toBe('patch_proj_a_1');

    // 3. Switch back to Project A:
    useProjectStore.setState({ activeProjectId: 'proj-a' });
    useAgentStore.getState().syncActiveProject('proj-a');

    // Project A's patch is preserved and restored!
    expect(useAgentStore.getState().getPendingPatch('proj-a')).toEqual(mockPatchA);
    expect(useAgentStore.getState().pendingPatch?.id).toBe('patch_proj_a_1');
    expect(useAgentStore.getState().patchProjectId).toBe('proj-a');
  });

  it('6. Explicit Reject clears the patch for the active project and updates repair episode', () => {
    const projId = 'proj-reject-test';
    useProjectStore.setState({ activeProjectId: projId });

    // Create repair episode
    const episode = useRepairStore.getState().createEpisode(
      projId,
      { executionId: 'ex1', command: 'npm test', args: [], exitCode: 1, stdout: '', stderr: 'error', durationMs: 100 },
      'fp_1',
      'ev_1'
    );
    useRepairStore.getState().setEpisodeProposal(projId, episode.failureEpisodeId, mockDiagnosisA, mockPatchA);

    useAgentStore.getState().setDiagnosis(mockDiagnosisA, projId);
    useAgentStore.getState().setPendingPatch(mockPatchA, projId, true);

    expect(useAgentStore.getState().getPendingPatch(projId)).not.toBeNull();

    // Explicit rejection:
    useAgentStore.getState().setIsDiffModalOpen(false);
    useAgentStore.getState().setPendingPatch(null, projId);
    useRepairStore.getState().rejectEpisode(projId, episode.failureEpisodeId);

    // Patch must be cleared from canonical store
    expect(useAgentStore.getState().getPendingPatch(projId)).toBeNull();
    expect(useAgentStore.getState().pendingPatch).toBeNull();

    // Repair episode must be marked rejected and active episode cleared
    const rejectedEp = useRepairStore.getState().getProjectEpisodes(projId).find((e) => e.failureEpisodeId === episode.failureEpisodeId);
    expect(rejectedEp?.status).toBe('rejected');
    expect(rejectedEp?.resolution).toBe('rejected');
    expect(useRepairStore.getState().getActiveEpisode(projId)).toBeNull();
  });

  it('7. clearDiagnosis clears both diagnosis and canonical pending patch for target project', () => {
    const projId = 'proj-clear-test';
    useProjectStore.setState({ activeProjectId: projId });

    useAgentStore.getState().setDiagnosis(mockDiagnosisA, projId);
    useAgentStore.getState().setPendingPatch(mockPatchA, projId, false);

    expect(useAgentStore.getState().getDiagnosis(projId)).not.toBeNull();
    expect(useAgentStore.getState().getPendingPatch(projId)).not.toBeNull();

    useAgentStore.getState().clearDiagnosis(projId);

    expect(useAgentStore.getState().getDiagnosis(projId)).toBeNull();
    expect(useAgentStore.getState().getPendingPatch(projId)).toBeNull();
  });

  it('8. resetAgentState completely resets all project patches and derived state', () => {
    useAgentStore.getState().setPendingPatch(mockPatchA, 'proj-1', true);
    useAgentStore.getState().setPendingPatch(mockPatchB, 'proj-2', true);

    useAgentStore.getState().resetAgentState();

    const state = useAgentStore.getState();
    expect(state.pendingPatchByProject).toEqual({});
    expect(state.diagnosisByProject).toEqual({});
    expect(state.pendingPatch).toBeNull();
    expect(state.patchProjectId).toBeNull();
    expect(state.isDiffModalOpen).toBe(false);
  });

  it('9. Strict Approval Boundary: Opening diff viewer never applies patch to VFS or runtime', async () => {
    const projId = 'proj-approval-boundary';
    useProjectStore.setState({ activeProjectId: projId });

    const applySpy = vi.spyOn(repairLoopEngine, 'applyPatchAndVerify');

    useAgentStore.getState().setDiagnosis(mockDiagnosisA, projId);
    useAgentStore.getState().setPendingPatch(mockPatchA, projId, false);

    // User reviews diff
    useAgentStore.getState().setPendingPatch(mockPatchA, projId, true);
    useAgentStore.getState().setIsDiffModalOpen(true);

    // Verify modal is open
    expect(useAgentStore.getState().isDiffModalOpen).toBe(true);

    // Strict boundary: applyPatchAndVerify MUST NOT have been called
    expect(applySpy).not.toHaveBeenCalled();

    // User closes modal
    useAgentStore.getState().setIsDiffModalOpen(false);
    expect(applySpy).not.toHaveBeenCalled();
  });
});
