import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { repairCoordinator, sanitizeExecutionEvidence } from '../src/features/repair/repair-coordinator';
import { validatePatch } from '../src/features/repair/patch-validator';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { 
  useRepairStore,
  getCanonicalState,
  isEpisodeDiagnosing,
  isEpisodeAwaitingApproval,
  isEpisodeApplying,
  isEpisodeVerifying,
  isEpisodeResolved,
  isEpisodeRolledBack,
  isEpisodeRejected,
  isEpisodeBlocked
} from '../src/store/repairStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useProjectStore } from '../src/store/projectStore';
import { useAgentStore } from '../src/store/agentStore';
import { Patch, ExecutionEvidence, RepairEpisode } from '../src/types/workspace';

let runtimeFs = new Map<string, string>();

describe('Phase 9.1: Self-Healing Engineering Loop Hardening (15 Invariants)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    runtimeFs.clear();

    useRepairStore.setState({
      episodes: {},
      activeEpisodeId: {},
      isLoopPaused: {},
      processedFingerprints: {}
    });

    useRuntimeStore.setState({
      lastEvidence: null,
      evidenceByProject: {},
      executionHistoryByProject: {},
      status: 'ready'
    });

    useProjectStore.setState({
      projects: {},
      activeProjectId: null
    });

    // Mock runtime manager replaceProject to mirror WebContainer filesystem
    vi.spyOn(runtimeManager, 'replaceProject').mockImplementation(async (files: any) => {
      runtimeFs.clear();
      for (const [path, val] of Object.entries(files)) {
        const clean = path.replace(/\\/g, '/').replace(/^\/+/g, '');
        const content = typeof val === 'string' ? val : (val as any).content;
        runtimeFs.set(clean, content);
      }
    });

    vi.spyOn(runtimeManager, 'syncFile').mockImplementation(async (path: string, content: string) => {
      const clean = path.replace(/\\/g, '/').replace(/^\/+/g, '');
      runtimeFs.set(clean, content);
    });
  });

  // 1. Diagnosis lifecycle
  it('1. Diagnosis lifecycle: records evidence, sets canonical ERROR_DETECTED, and handles failures cleanly', async () => {
    const store = useRepairStore.getState();
    const projId = 'proj-diag-lifecycle';
    const evidence: ExecutionEvidence = {
      executionId: 'exec-1',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'SyntaxError: Unexpected token',
      durationMs: 120,
      projectId: projId,
      requestId: 'req-abc-123'
    };

    const ep = store.createEpisode(projId, evidence, 'fp_syntax_err', 'ev_exec_1');
    expect(ep.status).toBe('captured');
    expect(ep.canonicalState).toBe('ERROR_DETECTED');
    expect(getCanonicalState(ep)).toBe('ERROR_DETECTED');

    // Transition to diagnosing
    store.updateEpisodeStatus(projId, ep.failureEpisodeId, 'diagnosing');
    const diagnosingEp = store.getActiveEpisode(projId);
    expect(diagnosingEp?.status).toBe('diagnosing');
    expect(isEpisodeDiagnosing(diagnosingEp)).toBe(true);

    // Explicit diagnosis failure branch
    store.markDiagnosisFailed(projId, ep.failureEpisodeId, 'Gemini quota exhausted');
    const failedEp = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(failedEp?.status).toBe('DIAGNOSIS_FAILED');
    expect(failedEp?.canonicalState).toBe('DIAGNOSIS_FAILED');
    expect(failedEp?.error).toBe('Gemini quota exhausted');
  });

  // 2. Repair lifecycle
  it('2. Repair lifecycle: transitions through REPAIRING, PATCH_READY, and AWAITING_APPROVAL', async () => {
    const store = useRepairStore.getState();
    const projId = 'proj-repair-lifecycle';
    const evidence: ExecutionEvidence = {
      executionId: 'exec-2',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'TypeError',
      durationMs: 80
    };

    const ep = store.createEpisode(projId, evidence, 'fp_type_err', 'ev_exec_2');
    store.updateEpisodeStatus(projId, ep.failureEpisodeId, 'REPAIRING');
    let current = store.getActiveEpisode(projId);
    expect(isEpisodeDiagnosing(current)).toBe(true);

    const patch: Patch = {
      id: 'patch-repair-2',
      summary: 'Fix type error',
      files: [{ path: '/src/App.tsx', before: 'const x = 1;', after: 'const x: number = 1;' }]
    };

    store.setEpisodeProposal(projId, ep.failureEpisodeId, {
      category: 'type',
      severity: 'medium',
      explanation: 'Missing type annotation',
      affectedFiles: ['/src/App.tsx'],
      evidence: ['TypeError'],
      suggestedFix: 'Add type annotation'
    }, patch);

    current = store.getActiveEpisode(projId);
    expect(isEpisodeAwaitingApproval(current)).toBe(true);
    expect(current?.patch?.id).toBe('patch-repair-2');
  });

  // 3. Patch rejection
  it('3. Patch rejection: marks PATCH_REJECTED with zero VFS mutations and clears pending patch', async () => {
    const projId = 'proj-reject-patch';
    const originalContent = 'export const test = "unmodified";';
    await vfsManager.writeFile(projId, '/src/App.tsx', originalContent);

    const store = useRepairStore.getState();
    const ep = store.createEpisode(projId, {
      executionId: 'e3', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: 'TS Error', durationMs: 40
    }, 'fp_ts', 'ev_3');

    const patch: Patch = {
      id: 'patch-reject-3',
      summary: 'Unwanted refactor',
      files: [{ path: '/src/App.tsx', before: originalContent, after: 'export const test = "mutated";' }]
    };

    store.setEpisodeProposal(projId, ep.failureEpisodeId, {
      category: 'type', severity: 'low', explanation: 'desc', affectedFiles: ['/src/App.tsx'], evidence: [], suggestedFix: ''
    }, patch);

    useAgentStore.getState().setPendingPatch(patch, projId, true);

    repairCoordinator.rejectRepair(projId, ep.failureEpisodeId);

    const rejectedEp = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(isEpisodeRejected(rejectedEp)).toBe(true);
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(originalContent);
    expect(useAgentStore.getState().getPendingPatch(projId)).toBeNull();
  });

  // 4. Stale patch rejection
  it('4. Stale patch rejection: rejects patches when baseline content does not match current VFS', async () => {
    const projId = 'proj-stale-patch';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'current updated content in VFS');

    const stalePatch: Patch = {
      id: 'patch-stale',
      summary: 'Outdated baseline patch',
      files: [
        {
          path: '/src/App.tsx',
          before: 'OLD BASELINE THAT NO LONGER MATCHES',
          after: 'new content'
        }
      ]
    };

    const files = vfsManager.getFiles(projId);
    const validation = validatePatch(stalePatch, files);
    expect(validation.valid).toBe(false);
    expect(validation.structuredErrors.some(e => e.rule === 'STALE_BEFORE_CONTENT')).toBe(true);

    const result = await repairLoopEngine.applyPatchAndVerify(projId, stalePatch);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('Patch validation failed');
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe('current updated content in VFS');
  });

  // 5. Atomic multi-file behavior
  it('5. Atomic multi-file behavior: rejects entire patch if any file targets invalid or forbidden paths', async () => {
    const projId = 'proj-atomic-files';
    const originalApp = 'export default function App() {}';
    await vfsManager.writeFile(projId, '/src/App.tsx', originalApp);

    const dangerousPatch: Patch = {
      id: 'patch-danger',
      summary: 'Mixed valid and forbidden changes',
      files: [
        {
          path: '/src/App.tsx',
          before: originalApp,
          after: 'export default function App() { return <div>Updated</div>; }'
        },
        {
          path: '/node_modules/react/index.js',
          before: '',
          after: 'malicious payload'
        }
      ]
    };

    const files = vfsManager.getFiles(projId);
    const validation = validatePatch(dangerousPatch, files);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes("Modification of 'node_modules' rejected"))).toBe(true);

    const result = await repairLoopEngine.applyPatchAndVerify(projId, dangerousPatch);
    expect(result.verified).toBe(false);
    // Crucial: First valid file was NOT modified!
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(originalApp);
  });

  // 6. Snapshot creation
  it('6. Snapshot creation: creates a verifiable snapshot before applying mutations', async () => {
    const projId = 'proj-snapshot-check';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'initial content');

    const snapSpy = vi.spyOn(snapshotService, 'createSnapshot');
    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: true,
      checks: [{ name: 'Build', success: true, status: 'passed' }],
      totalDurationMs: 100
    });

    const patch: Patch = {
      id: 'patch-snap',
      summary: 'Change content',
      files: [{ path: '/src/App.tsx', before: 'initial content', after: 'updated content' }]
    };

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(result.verified).toBe(true);
    expect(snapSpy).toHaveBeenCalledWith(projId, expect.stringContaining('Before applying patch'));
  });

  // 7. Verification success
  it('7. Verification success: transitions to REPAIRED, clears active runtime evidence, and keeps changes', async () => {
    const projId = 'proj-verify-success';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'original');

    useRuntimeStore.setState({
      status: 'error',
      lastEvidence: {
        executionId: 'e-fail', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: 'Error', durationMs: 50, projectId: projId
      },
      evidenceByProject: {
        [projId]: {
          executionId: 'e-fail', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: 'Error', durationMs: 50, projectId: projId
        }
      }
    });

    const store = useRepairStore.getState();
    const ep = store.createEpisode(projId, useRuntimeStore.getState().lastEvidence!, 'fp_ok', 'ev_ok');

    const patch: Patch = {
      id: 'patch-ok',
      summary: 'Clean fix',
      files: [{ path: '/src/App.tsx', before: 'original', after: 'fixed content' }]
    };
    store.setEpisodeProposal(projId, ep.failureEpisodeId, {
      category: 'syntax', severity: 'high', explanation: '', affectedFiles: ['/src/App.tsx'], evidence: [], suggestedFix: ''
    }, patch);

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: true,
      checks: [
        { name: 'TypeScript Compilation', success: true, status: 'passed' },
        { name: 'Production Build', success: true, status: 'passed' }
      ],
      totalDurationMs: 800
    });

    const approveResult = await repairCoordinator.approveRepair(projId, ep.failureEpisodeId);
    expect(approveResult.verified).toBe(true);

    const resolvedEp = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(isEpisodeResolved(resolvedEp)).toBe(true);
    expect(resolvedEp?.canonicalState).toBe('REPAIRED');

    // Verified: clearEvidence cleared runtime failure card!
    expect(useRuntimeStore.getState().lastEvidence).toBeNull();
    expect(useRuntimeStore.getState().evidenceByProject[projId]).toBeUndefined();
    expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe('fixed content');
  });

  // 8. Verification failure
  it('8. Verification failure: records failure output and triggers rollback', async () => {
    const projId = 'proj-verify-fail';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'broken base');

    const store = useRepairStore.getState();
    const ep = store.createEpisode(projId, {
      executionId: 'ef', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: 'err', durationMs: 10
    }, 'fp_f', 'ev_f');

    const patch: Patch = {
      id: 'patch-bad',
      summary: 'Bad patch',
      files: [{ path: '/src/App.tsx', before: 'broken base', after: 'still broken' }]
    };
    store.setEpisodeProposal(projId, ep.failureEpisodeId, {
      category: 'syntax', severity: 'high', explanation: '', affectedFiles: [], evidence: [], suggestedFix: ''
    }, patch);

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [
        { name: 'TypeScript Compilation', success: false, status: 'failed', exitCode: 2, output: 'Syntax error TS1005' }
      ],
      totalDurationMs: 600
    });

    const approveResult = await repairCoordinator.approveRepair(projId, ep.failureEpisodeId);
    expect(approveResult.verified).toBe(false);
    expect(approveResult.error).toContain('Syntax error TS1005');

    const rolledEp = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(isEpisodeRolledBack(rolledEp)).toBe(true);
    expect(rolledEp?.canonicalState).toBe('ROLLED_BACK');
  });

  // 9. Byte-for-byte rollback
  it('9. Byte-for-byte rollback: restores modified file to exact pre-repair content byte-for-byte', async () => {
    const projId = 'proj-byte-rollback';
    const originalExactContent = 'const a = 1;\nconst b = 2;\n// exact byte test\n';
    await vfsManager.writeFile(projId, '/src/App.tsx', originalExactContent);
    await runtimeManager.replaceProject(vfsManager.getFiles(projId));

    const patch: Patch = {
      id: 'patch-byte',
      summary: 'Modify App.tsx',
      files: [{ path: '/src/App.tsx', before: originalExactContent, after: 'corrupted code;\n' }]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'Build', success: false, status: 'failed' }],
      totalDurationMs: 400
    });

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(result.verified).toBe(false);

    // Byte-for-byte equality check
    const restored = vfsManager.getFile(projId, '/src/App.tsx');
    expect(restored?.content).toBe(originalExactContent);
    expect(runtimeFs.get('src/App.tsx')).toBe(originalExactContent);
  });

  // 10. Newly-created rogue file removal during rollback
  it('10. Newly-created rogue file removal during rollback: purges new file from VFS, disk, and project open tabs', async () => {
    const projId = 'proj-rogue-file';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() {}');

    useProjectStore.setState({
      projects: {
        [projId]: {
          id: projId,
          title: 'Rogue Test',
          description: '',
          badge: 'vite-react',
          status: 'ready',
          files: vfsManager.getFiles(projId),
          openTabs: ['/src/App.tsx', '/src/rogue.ts'],
          activeFilePath: '/src/rogue.ts',
          diagnostics: [],
          fixHistory: []
        }
      },
      activeProjectId: projId
    });

    const roguePatch: Patch = {
      id: 'patch-rogue',
      summary: 'Add rogue file and modify App',
      files: [
        {
          path: '/src/rogue.ts',
          before: '',
          after: 'export const rogue = "should be deleted on failure";'
        }
      ]
    };

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'Build', success: false, status: 'failed' }],
      totalDurationMs: 300
    });

    const result = await repairLoopEngine.applyPatchAndVerify(projId, roguePatch);
    expect(result.verified).toBe(false);

    // 1. Rogue file removed from VFS
    expect(vfsManager.getFile(projId, '/src/rogue.ts')).toBeNull();
    // 2. Rogue file removed from runtime mirror
    expect(runtimeFs.has('src/rogue.ts')).toBe(false);

    // 3. ProjectStore openTabs and activeFilePath sanitized!
    const proj = useProjectStore.getState().projects[projId];
    expect(proj.openTabs).not.toContain('/src/rogue.ts');
    expect(proj.activeFilePath).not.toBe('/src/rogue.ts');
    expect(proj.activeFilePath).toBe('/src/App.tsx');
  });

  // 11. Project isolation
  it('11. Project isolation: verifies that repairing Project A leaves Project B completely untouched', async () => {
    const projA = 'proj-iso-a';
    const projB = 'proj-iso-b';

    await vfsManager.writeFile(projA, '/src/App.tsx', 'App A Original');
    await vfsManager.writeFile(projB, '/src/App.tsx', 'App B Original');

    const store = useRepairStore.getState();
    const epA = store.createEpisode(projA, {
      executionId: 'ea', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: 'error in A', durationMs: 10
    }, 'fp_a', 'ev_a');

    const patchA: Patch = {
      id: 'patch-a',
      summary: 'Repair Project A',
      files: [{ path: '/src/App.tsx', before: 'App A Original', after: 'App A Fixed' }]
    };

    store.setEpisodeProposal(projA, epA.failureEpisodeId, {
      category: 'syntax', severity: 'high', explanation: '', affectedFiles: ['/src/App.tsx'], evidence: [], suggestedFix: ''
    }, patchA);

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: true,
      checks: [{ name: 'Build', success: true, status: 'passed' }],
      totalDurationMs: 200
    });

    const res = await repairCoordinator.approveRepair(projA, epA.failureEpisodeId);
    expect(res.verified).toBe(true);

    // Project A is updated
    expect(vfsManager.getFile(projA, '/src/App.tsx')?.content).toBe('App A Fixed');
    // Project B is completely pristine and untouched
    expect(vfsManager.getFile(projB, '/src/App.tsx')?.content).toBe('App B Original');
    expect(store.getProjectEpisodes(projB).length).toBe(0);
  });

  // 12. Bounded retry
  it('12. Bounded retry: halts automated repairs and marks episode blocked once max attempts are exceeded', async () => {
    const projId = 'proj-bound-retry';
    const store = useRepairStore.getState();
    const ep = store.createEpisode(projId, {
      executionId: 'e-bound', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: 'err', durationMs: 10
    }, 'fp_bound', 'ev_bound');

    // Attempt 1 -> fails
    store.rollbackEpisode(projId, ep.failureEpisodeId, 'Fail 1');
    let current = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(current?.attemptNumber).toBe(2);
    expect(current?.status).toBe('rolled_back');

    // Attempt 2 -> fails
    store.rollbackEpisode(projId, ep.failureEpisodeId, 'Fail 2');
    current = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(current?.attemptNumber).toBe(3);
    expect(current?.status).toBe('rolled_back');

    // Attempt 3 -> fails (exceeds maxAttempts = 3)
    store.rollbackEpisode(projId, ep.failureEpisodeId, 'Fail 3');
    current = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(current?.attemptNumber).toBe(4);
    expect(current?.status).toBe('blocked');
    expect(current?.resolution).toBe('max_attempts_reached');
    expect(isEpisodeBlocked(current)).toBe(true);

    // Running diagnosis on blocked episode is prevented
    const diagResult = await repairCoordinator.runEpisodeDiagnosis(projId, ep.failureEpisodeId);
    expect(diagResult?.status).toBe('blocked');
  });

  // 13. Telemetry/request IDs & secret scrubbing
  it('13. Telemetry & secret scrubbing: redacts Gemini, OpenAI, AWS, and Bearer tokens while preserving correlation IDs', () => {
    const rawEvidence: ExecutionEvidence = {
      executionId: 'exec-sec-1',
      command: 'node script.js --key AIzaSyB1234567890abcdef1234567890abc',
      args: ['Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
      exitCode: 1,
      stdout: 'Connecting with key sk-1234567890abcdef1234567890 to /Users/testuser/project',
      stderr: 'Access denied: token ghp_1234567890abcdef1234567890abcdef12345678 and AKIAIOSFODNN7EXAMPLE',
      durationMs: 95,
      projectId: 'proj-sec-test',
      requestId: 'req-uuid-999',
      errorContext: 'Exception in /home/developer/app.ts'
    };

    const sanitized = sanitizeExecutionEvidence(rawEvidence);

    // Correlation IDs preserved
    expect(sanitized.executionId).toBe('exec-sec-1');
    expect(sanitized.projectId).toBe('proj-sec-test');
    expect(sanitized.requestId).toBe('req-uuid-999');

    // Secrets scrubbed
    expect(sanitized.command).not.toContain('AIzaSyB1234567890abcdef1234567890abc');
    expect(sanitized.command).toContain('[REDACTED_GEMINI_KEY]');

    expect(sanitized.stdout).not.toContain('sk-1234567890abcdef1234567890');
    expect(sanitized.stdout).toContain('[REDACTED_API_KEY]');
    expect(sanitized.stdout).not.toContain('/Users/testuser');
    expect(sanitized.stdout).toContain('/home/user');

    expect(sanitized.stderr).not.toContain('ghp_');
    expect(sanitized.stderr).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(sanitized.stderr).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(sanitized.stderr).toContain('[REDACTED_API_KEY]');

    expect(sanitized.errorContext).not.toContain('/home/developer');
    expect(sanitized.errorContext).toContain('/home/user');
  });

  // 14. UI state transitions
  it('14. UI state transitions: helper predicates correctly classify all canonical and legacy states', () => {
    const dummyEv: ExecutionEvidence = { executionId: 'e', command: 'c', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 0 };
    const makeEp = (status: any, canonicalState?: any): RepairEpisode => ({
      failureEpisodeId: 'ep-test',
      projectId: 'p',
      attemptNumber: 1,
      maxAttempts: 3,
      failureFingerprint: 'fp',
      evidenceFingerprint: 'ev',
      status,
      canonicalState,
      evidence: dummyEv,
      createdAt: '',
      lastAttemptAt: ''
    });

    expect(isEpisodeDiagnosing(makeEp('diagnosing'))).toBe(true);
    expect(isEpisodeDiagnosing(makeEp('DIAGNOSING'))).toBe(true);
    expect(isEpisodeDiagnosing(makeEp('REPAIRING'))).toBe(true);

    expect(isEpisodeAwaitingApproval(makeEp('proposal_ready'))).toBe(true);
    expect(isEpisodeAwaitingApproval(makeEp('PATCH_READY'))).toBe(true);
    expect(isEpisodeAwaitingApproval(makeEp('AWAITING_APPROVAL'))).toBe(true);

    expect(isEpisodeApplying(makeEp('applying'))).toBe(true);
    expect(isEpisodeApplying(makeEp('APPLYING'))).toBe(true);

    expect(isEpisodeVerifying(makeEp('verifying'))).toBe(true);
    expect(isEpisodeVerifying(makeEp('VERIFYING'))).toBe(true);

    expect(isEpisodeResolved(makeEp('resolved'))).toBe(true);
    expect(isEpisodeResolved(makeEp('REPAIRED'))).toBe(true);

    expect(isEpisodeRolledBack(makeEp('rolled_back'))).toBe(true);
    expect(isEpisodeRolledBack(makeEp('ROLLED_BACK'))).toBe(true);
    expect(isEpisodeRolledBack(makeEp('VERIFICATION_FAILED'))).toBe(true);

    expect(isEpisodeRejected(makeEp('rejected'))).toBe(true);
    expect(isEpisodeRejected(makeEp('PATCH_REJECTED'))).toBe(true);

    expect(isEpisodeBlocked(makeEp('blocked'))).toBe(true);
  });

  // 15. No false-success state
  it('15. No false-success state: cannot reach REPAIRED unless verification passes with zero failed checks', async () => {
    const projId = 'proj-no-false-success';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'initial content');

    const store = useRepairStore.getState();
    const ep = store.createEpisode(projId, {
      executionId: 'e-nfs', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: 'error', durationMs: 20
    }, 'fp_nfs', 'ev_nfs');

    const patch: Patch = {
      id: 'patch-nfs',
      summary: 'Plausible patch that fails compilation',
      files: [{ path: '/src/App.tsx', before: 'initial content', after: 'syntactically valid but broken logic' }]
    };

    store.setEpisodeProposal(projId, ep.failureEpisodeId, {
      category: 'type', severity: 'medium', explanation: '', affectedFiles: ['/src/App.tsx'], evidence: [], suggestedFix: ''
    }, patch);

    // AI returned patch, but verification FAILS
    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [
        { name: 'TypeScript Compilation', success: false, status: 'failed', exitCode: 1, output: 'Type mismatch' }
      ],
      totalDurationMs: 500
    });

    const approveResult = await repairCoordinator.approveRepair(projId, ep.failureEpisodeId);
    expect(approveResult.verified).toBe(false);

    // State MUST NOT be resolved or REPAIRED!
    const finalEp = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
    expect(isEpisodeResolved(finalEp)).toBe(false);
    expect(finalEp?.status).not.toBe('resolved');
    expect(finalEp?.status).not.toBe('REPAIRED');
    expect(finalEp?.canonicalState).not.toBe('REPAIRED');
    expect(isEpisodeRolledBack(finalEp)).toBe(true);
  });
});
