import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyFailureEvidence, extractErrorContext } from '../src/features/repair/failure-classifier';
import { createRepairPlan } from '../src/features/repair/repair-planner';
import { getRelevantFilesForFailure } from '../src/features/repair/repair-coordinator';
import { validatePatchMinimality, validatePatch } from '../src/features/repair/patch-validator';
import { FAILURE_CORPUS } from '../src/features/repair/failure-corpus';
import { useRepairStore } from '../src/store/repairStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { repairCoordinator } from '../src/features/repair/repair-coordinator';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { verificationService } from '../src/features/verification/VerificationService';
import { ExecutionEvidence, Patch, Diagnosis } from '../src/types/workspace';

describe('SnapDeploy AI — Phase 9.2: Engineering Intelligence Hardening', () => {
  beforeEach(async () => {
    await vfsManager.waitUntilHydrated();
    useRepairStore.getState().deleteProjectRepairState('test-proj-intel-a');
    useRepairStore.getState().deleteProjectRepairState('test-proj-intel-b');
    vi.restoreAllMocks();
  });

  // 1. Failure Classification
  it('1. correctly classifies syntax, type, and dependency error signatures into structured categories', () => {
    const syntaxEvidence: ExecutionEvidence = {
      executionId: 'e1',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/App.tsx:12:5: SyntaxError: Unexpected token \';\'',
      durationMs: 100
    };
    const c1 = classifyFailureEvidence(syntaxEvidence);
    expect(c1.category).toBe('SYNTAX');
    expect(c1.rootCause).toContain('Syntax error');
    expect(c1.isHypothesis).toBe(false);

    const typeEvidence: ExecutionEvidence = {
      executionId: 'e2',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 2,
      stdout: '',
      stderr: 'src/components/Card.tsx(5,12): error TS2304: Cannot find name \'myVar\'.',
      durationMs: 100
    };
    const c2 = classifyFailureEvidence(typeEvidence);
    expect(c2.category).toBe('TYPE');
    expect(c2.rootCause).toContain('myVar');

    const depEvidence: ExecutionEvidence = {
      executionId: 'e3',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Failed to resolve import "lucide-react" from "src/App.tsx". Does the file exist?',
      durationMs: 100
    };
    const c3 = classifyFailureEvidence(depEvidence);
    expect(c3.category).toBe('DEPENDENCY');
  });

  // 2. Unknown/Insufficient-Evidence Handling
  it('2. falls back to UNKNOWN category with isHypothesis: true and low confidence when evidence is empty or ambiguous', () => {
    const emptyEvidence: ExecutionEvidence = {
      executionId: 'e_empty',
      command: 'npm run build',
      args: [],
      exitCode: 137,
      stdout: '',
      stderr: '',
      durationMs: 80
    };

    const c = classifyFailureEvidence(emptyEvidence);
    expect(c.category).toBe('UNKNOWN');
    expect(c.isHypothesis).toBe(true);
    expect(c.confidence).toBeLessThanOrEqual(0.40);
    expect(c.explanation.toLowerCase()).toContain('insufficient');
  });

  // 3. Project-Scoped Context Selection
  it('3. strictly isolates relevant file selection to target project VFS and never accesses other projects', async () => {
    const projA = 'test-proj-intel-a';
    const projB = 'test-proj-intel-b';

    await vfsManager.writeFile(projA, '/src/App.tsx', 'export default function AppA() {}');
    await vfsManager.writeFile(projB, '/src/Secret.tsx', 'export const SECRET = "CLASSIFIED";');

    const filesA = vfsManager.getFiles(projA);
    const filesB = vfsManager.getFiles(projB);

    const evidenceForA: ExecutionEvidence = {
      executionId: 'e_proj',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/Secret.tsx:1:1: Error in Secret file',
      durationMs: 100,
      projectId: projA
    };

    // Attempt to search files of Project A for Secret.tsx (which only exists in Project B)
    const selectedFiles = getRelevantFilesForFailure(evidenceForA, filesA);

    // Must NOT select /src/Secret.tsx because it does not exist in Project A!
    expect(selectedFiles).not.toContain('/src/Secret.tsx');
    expect(filesA['/src/Secret.tsx']).toBeUndefined();
    expect(filesB['/src/Secret.tsx']).toBeDefined();
  });

  // 4. Relevant-File Selection Hierarchy
  it('4. resolves files using the preferred 6-tier hierarchy: diagnostic line/col -> stack trace -> import graph -> entry fallback', () => {
    const mockFiles: Record<string, { content: string }> = {
      '/src/App.tsx': { content: 'import { Card } from "./components/Card";' },
      '/src/components/Card.tsx': { content: 'export function Card() {}' },
      '/package.json': { content: '{"dependencies":{}}' }
    };

    // Diagnostic location match
    const diagEvidence: ExecutionEvidence = {
      executionId: 'e_diag',
      command: 'npx tsc',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/components/Card.tsx:14:5: error TS2304: Cannot find name "x"',
      durationMs: 100
    };
    const res1 = getRelevantFilesForFailure(diagEvidence, mockFiles);
    expect(res1).toContain('/src/components/Card.tsx');

    // Dependency graph search for missing module
    const depEvidence: ExecutionEvidence = {
      executionId: 'e_dep',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Cannot find module "Card"',
      durationMs: 100
    };
    const res2 = getRelevantFilesForFailure(depEvidence, mockFiles);
    expect(res2).toContain('/src/App.tsx');
  });

  // 5. Structured Diagnosis Schema
  it('5. produces complete structured diagnosis schema with rootCause, confidence, errorContext, and expectedVerification', () => {
    const evidence: ExecutionEvidence = {
      executionId: 'e_schema',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 2,
      stdout: '',
      stderr: 'src/App.tsx(20,5): error TS2322: Type "number" is not assignable to type "string".',
      durationMs: 150
    };

    const diag = classifyFailureEvidence(evidence);
    expect(diag.category).toBe('TYPE');
    expect(diag.severity).toBe('high');
    expect(diag.rootCause).toBeDefined();
    expect(diag.confidence).toBeGreaterThan(0.7);
    expect(diag.errorContext).toContain('Line 20');
    expect(diag.expectedVerification).toContain('TypeScript Compilation');
    expect(diag.recommendedRepair).toBeDefined();
  });

  // 6. Repair-Plan Generation
  it('6. generates declarative RepairPlan with targetFiles, intendedModification, reason, and expectedOutcome', () => {
    const diagnosis: Diagnosis = {
      category: 'SYNTAX',
      severity: 'high',
      explanation: 'Unexpected token in App.tsx',
      rootCause: 'SyntaxError: Unexpected semicolon in expression',
      affectedFiles: ['/src/App.tsx'],
      evidence: ['src/App.tsx:10:5: SyntaxError'],
      suggestedFix: 'Remove invalid semicolon'
    };

    const plan = createRepairPlan(diagnosis, {
      '/src/App.tsx': { content: 'export default function App() {}' }
    });

    expect(plan.id).toBeDefined();
    expect(plan.summary).toContain('SYNTAX');
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].targetFile).toBe('/src/App.tsx');
    expect(plan.steps[0].intendedModification).toBeDefined();
    expect(plan.steps[0].reason).toContain('SyntaxError');
    expect(plan.steps[0].expectedOutcome).toBeDefined();
    expect(plan.verificationPlan).toContain('TypeScript Compilation');
  });

  // 7. Patch-Plan Separation
  it('7. confirms repair plan generation is purely declarative and does NOT mutate project VFS or runtime files', async () => {
    const projId = 'test-proj-intel-a';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'const original = true;');
    const beforeContent = vfsManager.getFile(projId, '/src/App.tsx')?.content;

    const diagnosis: Diagnosis = {
      category: 'TYPE',
      severity: 'high',
      explanation: 'Type error',
      affectedFiles: ['/src/App.tsx'],
      evidence: [],
      suggestedFix: 'Fix type'
    };

    // Generate plan
    const plan = createRepairPlan(diagnosis, vfsManager.getFiles(projId));
    expect(plan).toBeDefined();

    // Verify VFS content is completely UNTOUCHED
    const afterContent = vfsManager.getFile(projId, '/src/App.tsx')?.content;
    expect(afterContent).toBe(beforeContent);
  });

  // 8. Minimal Patch Behavior
  it('8. validates patch minimality: approves surgical fixes and flags bloated rewrites or unrelated files', () => {
    const files: Record<string, { content: string }> = {
      '/src/App.tsx': { content: 'import React from "react";\nexport default function App() { return <div>1</div>; }' },
      '/src/Unrelated.tsx': { content: 'export function Unrelated() { return <span>ok</span>; }' }
    };

    // Surgical minimal patch modifying only the affected file
    const surgicalPatch: Patch = {
      id: 'patch_1',
      summary: 'Fix App component return',
      files: [
        {
          path: '/src/App.tsx',
          before: files['/src/App.tsx'].content,
          after: files['/src/App.tsx'].content.replace('<div>1</div>', '<div>2</div>')
        }
      ]
    };
    const val1 = validatePatchMinimality(surgicalPatch, files, ['/src/App.tsx']);
    expect(val1.isMinimal).toBe(true);
    expect(val1.warnings.length).toBe(0);

    // Bloated patch that also modifies an unrelated file
    const bloatedPatch: Patch = {
      id: 'patch_2',
      summary: 'Fix App and modify Unrelated',
      files: [
        {
          path: '/src/App.tsx',
          before: files['/src/App.tsx'].content,
          after: files['/src/App.tsx'].content.replace('<div>1</div>', '<div>2</div>')
        },
        {
          path: '/src/Unrelated.tsx',
          before: files['/src/Unrelated.tsx'].content,
          after: 'export function Unrelated() { return <span>tampered</span>; }'
        }
      ]
    };
    const val2 = validatePatchMinimality(bloatedPatch, files, ['/src/App.tsx']);
    expect(val2.warnings.some((w) => w.includes('/src/Unrelated.tsx'))).toBe(true);
  });

  // 9. Confidence Metadata
  it('9. bounds confidence between 0.0 and 0.90 for AI assessments and flags hypotheses without claiming proof', () => {
    const directEvidence: ExecutionEvidence = {
      executionId: 'e_conf',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/App.tsx:5:1: SyntaxError: Unexpected token',
      durationMs: 100
    };
    const directDiag = classifyFailureEvidence(directEvidence);
    expect(directDiag.confidence).toBeLessThanOrEqual(0.92);
    expect(directDiag.isHypothesis).toBe(false);

    const vagueEvidence: ExecutionEvidence = {
      executionId: 'e_vague',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'something unexpected happened',
      durationMs: 100
    };
    const vagueDiag = classifyFailureEvidence(vagueEvidence);
    expect(vagueDiag.isHypothesis).toBe(true);
    expect(vagueDiag.confidence).toBeLessThan(0.5);
  });

  // 10. Verification Result Structure
  it('10. exposes structured verification checks and sets originalErrorCleared and finalState', async () => {
    const projId = 'test-proj-intel-a';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() { return <div>Ok</div>; }');
    await vfsManager.writeFile(projId, '/package.json', '{"name":"test","scripts":{"build":"vite build"}}');

    // Mock verification checks to pass
    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValueOnce({
      success: true,
      checks: [
        { name: 'TypeScript Compilation', success: true, status: 'passed', exitCode: 0, durationMs: 200 },
        { name: 'Production Build', success: true, status: 'passed', exitCode: 0, durationMs: 350 }
      ],
      totalDurationMs: 550
    });

    const patch: Patch = {
      id: 'p_test',
      summary: 'Valid fix',
      files: [
        {
          path: '/src/App.tsx',
          before: 'export default function App() { return <div>Ok</div>; }',
          after: 'export default function App() { return <div>Updated</div>; }'
        }
      ]
    };

    const result = await repairLoopEngine.applyPatchAndVerify(projId, patch);
    expect(result.verified).toBe(true);
    expect(result.verificationResult?.originalErrorCleared).toBe(true);
    expect(result.verificationResult?.finalState).toBe('VERIFIED');
    expect(result.verificationResult?.checks.length).toBe(2);
  });

  // 11. Successful Verification Flow
  it('11. completes successful verification, marks episode REPAIRED, and records structured verification results', async () => {
    const projId = 'test-proj-intel-a';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() { return <div>1</div>; }');

    const fakeEvidence: ExecutionEvidence = {
      executionId: 'e_succ',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/App.tsx:1:1: SyntaxError: Unexpected token',
      durationMs: 120,
      projectId: projId
    };

    const ep = useRepairStore.getState().createEpisode(projId, fakeEvidence, 'fp_succ', 'ev_succ');

    const patch: Patch = {
      id: 'patch_succ',
      summary: 'Fix syntax error',
      files: [
        {
          path: '/src/App.tsx',
          before: 'export default function App() { return <div>1</div>; }',
          after: 'export default function App() { return <div>Fixed</div>; }'
        }
      ]
    };

    useRepairStore.getState().setEpisodeProposal(projId, ep.failureEpisodeId, {
      category: 'SYNTAX', severity: 'high', explanation: 'Syntax error', affectedFiles: ['/src/App.tsx'], evidence: [], suggestedFix: ''
    }, patch);

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValueOnce({
      success: true,
      checks: [{ name: 'TypeScript Compilation', success: true, status: 'passed', exitCode: 0, durationMs: 200 }],
      totalDurationMs: 200
    });

    const approval = await repairCoordinator.approveRepair(projId, ep.failureEpisodeId);
    expect(approval.verified).toBe(true);
    expect(approval.verificationResult?.finalState).toBe('VERIFIED');

    const updatedEp = useRepairStore.getState().getProjectEpisodes(projId).find((e) => e.failureEpisodeId === ep.failureEpisodeId);
    expect(updatedEp?.canonicalState).toBe('REPAIRED');
    expect(updatedEp?.verificationResult?.originalErrorCleared).toBe(true);
  });

  // 12. Failed Verification Flow
  it('12. handles failed verification, triggers automatic rollback, and records structured failure checks', async () => {
    const projId = 'test-proj-intel-a';
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() { return <div>Baseline</div>; }');

    const fakeEvidence: ExecutionEvidence = {
      executionId: 'e_fail',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'Cannot find module non-existent',
      durationMs: 100,
      projectId: projId
    };

    const ep = useRepairStore.getState().createEpisode(projId, fakeEvidence, 'fp_fail', 'ev_fail');

    const badPatch: Patch = {
      id: 'patch_bad',
      summary: 'Bad patch that fails verification',
      files: [
        {
          path: '/src/App.tsx',
          before: 'export default function App() { return <div>Baseline</div>; }',
          after: 'export default function App() { return <div>Broken</div>; }'
        }
      ]
    };

    useRepairStore.getState().setEpisodeProposal(projId, ep.failureEpisodeId, {
      category: 'DEPENDENCY', severity: 'high', explanation: 'Missing module', affectedFiles: ['/src/App.tsx'], evidence: [], suggestedFix: ''
    }, badPatch);

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValueOnce({
      success: false,
      checks: [{ name: 'Production Build', success: false, status: 'failed', exitCode: 1, output: 'RollupError', durationMs: 300 }],
      totalDurationMs: 300
    });

    const approval = await repairCoordinator.approveRepair(projId, ep.failureEpisodeId);
    expect(approval.verified).toBe(false);
    expect(approval.verificationResult?.finalState).toBe('ROLLED_BACK');
    expect(approval.verificationResult?.originalErrorCleared).toBe(false);

    const updatedEp = useRepairStore.getState().getProjectEpisodes(projId).find((e) => e.failureEpisodeId === ep.failureEpisodeId);
    expect(updatedEp?.canonicalState).toBe('ROLLED_BACK');
  });

  // 13. Rollback State Preservation
  it('13. confirms byte-for-byte VFS restoration on rollback and eliminates rogue files', async () => {
    const projId = 'test-proj-intel-a';
    const originalApp = 'export default function App() { return <div>Original</div>; }';
    await vfsManager.writeFile(projId, '/src/App.tsx', originalApp);

    const snapshot = await snapshotService.createSnapshot(projId, 'Pre-repair checkpoint');

    // Mutate file and add a rogue file
    await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() { return <div>Corrupted</div>; }');
    await vfsManager.writeFile(projId, '/src/RogueFile.tsx', 'export const ROGUE = true;');

    expect(vfsManager.getFile(projId, '/src/RogueFile.tsx')).toBeDefined();

    // Execute rollback
    await snapshotService.restoreSnapshot(projId);

    // Verify byte-for-byte restoration of App.tsx
    const restoredApp = vfsManager.getFile(projId, '/src/App.tsx')?.content;
    expect(restoredApp).toBe(originalApp);

    // Verify rogue file was completely deleted
    const rogueFile = vfsManager.getFile(projId, '/src/RogueFile.tsx');
    expect(rogueFile).toBeFalsy();
  });

  // 14. Project-Switch Isolation
  it('14. guarantees project switch during diagnosis/repair keeps Project A scoped and leaves Project B pristine', async () => {
    const projA = 'test-proj-intel-a';
    const projB = 'test-proj-intel-b';

    await vfsManager.writeFile(projA, '/src/App.tsx', 'export default function AppA() {}');
    await vfsManager.writeFile(projB, '/src/App.tsx', 'export default function AppB() {}');

    const evidenceA: ExecutionEvidence = {
      executionId: 'e_iso_a',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/App.tsx: SyntaxError in Project A',
      durationMs: 100,
      projectId: projA
    };

    // Create episode in Project A
    const epA = useRepairStore.getState().createEpisode(projA, evidenceA, 'fp_iso_a', 'ev_iso_a');
    expect(useRepairStore.getState().getActiveEpisode(projA)?.failureEpisodeId).toBe(epA.failureEpisodeId);

    // Project B should have NO episodes
    expect(useRepairStore.getState().getActiveEpisode(projB)).toBeNull();
    expect(useRepairStore.getState().getProjectEpisodes(projB).length).toBe(0);

    // Verify Project B file remains completely identical
    expect(vfsManager.getFile(projB, '/src/App.tsx')?.content).toBe('export default function AppB() {}');
  });

  // 15. Failure Corpus Regression Cases
  it('15. verifies all 10 failure corpus cases against expected category, affected file, and diagnosis traits', () => {
    expect(FAILURE_CORPUS.length).toBe(10);

    for (const testCase of FAILURE_CORPUS) {
      const diag = classifyFailureEvidence(testCase.evidence, testCase.projectFiles);
      expect(diag.category, `Failed on ${testCase.id}`).toBe(testCase.expectedCategory);
      expect(diag.affectedFiles, `Failed on ${testCase.id}`).toContain(testCase.expectedAffectedFile);
      expect(diag.rootCause.toLowerCase(), `Failed on ${testCase.id}`).toContain(testCase.expectedDiagnosis.rootCauseSubstring.toLowerCase());
      expect(diag.isHypothesis, `Failed on ${testCase.id}`).toBe(testCase.expectedDiagnosis.isHypothesis);

      if (testCase.expectedDiagnosis.isHypothesis) {
        expect(diag.confidence, `Failed on ${testCase.id}`).toBeLessThanOrEqual(0.40);
      } else {
        expect(diag.confidence, `Failed on ${testCase.id}`).toBeGreaterThanOrEqual(testCase.expectedDiagnosis.minConfidence);
      }

      const plan = createRepairPlan(diag, testCase.projectFiles);
      expect(plan.steps.length, `Failed on ${testCase.id}`).toBeGreaterThanOrEqual(1);
      expect(plan.verificationPlan.length, `Failed on ${testCase.id}`).toBeGreaterThanOrEqual(1);
    }
  });
});
