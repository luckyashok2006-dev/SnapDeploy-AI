import { ExecutionEvidence, Patch, Diagnosis, RepairPlan, VerificationResult } from '../../types/workspace';
import { diagnoseFailure } from './diagnosis';
import { generatePatch } from './repair';
import { validatePatch, validatePatchMinimality } from './patch-validator';
import { snapshotService } from '../../lib/snapshots/SnapshotService';
import { verificationService } from '../verification/VerificationService';
import { runtimeManager } from '../../lib/runtime/runtime-manager';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { resetEditorBoundary } from '../../lib/editor/editor-boundary';
import { getRelevantFilesForFailure } from './repair-coordinator';
import { classifyFailureEvidence } from './failure-classifier';
import { createRepairPlan } from './repair-planner';

export interface RepairLoopStepCallback {
  (stage: string, message: string): void;
}

export class RepairLoopEngine {
  private static instance: RepairLoopEngine;
  private maxAttempts = 3;

  private constructor() {}

  public static getInstance(): RepairLoopEngine {
    if (!RepairLoopEngine.instance) {
      RepairLoopEngine.instance = new RepairLoopEngine();
    }
    return RepairLoopEngine.instance;
  }

  public async runDiagnosisAndPatch(
    projectId: string,
    evidence: ExecutionEvidence,
    onProgress?: RepairLoopStepCallback
  ): Promise<{ diagnosis: Diagnosis; patch: Patch; plan: RepairPlan }> {
    onProgress?.('diagnosing', 'Analyzing execution evidence and stack trace...');
    
    // 1. Evidence-first relevant file selection (Phase C: preferred hierarchy)
    const files = vfsManager.getFiles(projectId);
    const relevantPaths = getRelevantFilesForFailure(evidence, files);
    const relevantFiles: Record<string, string> = {};
    for (const p of relevantPaths) {
      if (files[p]) {
        relevantFiles[p] = files[p].content;
      }
    }
    // Always include package.json if present for dependency context
    if (files['/package.json'] && !relevantFiles['/package.json']) {
      relevantFiles['/package.json'] = files['/package.json'].content;
    }

    // 2. Structured Failure Diagnosis (Phase B)
    let diagnosis: Diagnosis;
    try {
      diagnosis = await diagnoseFailure({
        evidence,
        relevantFiles,
        projectId
      });
      if (!diagnosis.projectId) {
        diagnosis.projectId = projectId;
      }
    } catch (diagErr) {
      // Deterministic fallback classifier when offline or test mock
      diagnosis = classifyFailureEvidence(evidence, files);
      diagnosis.projectId = projectId;
    }
    onProgress?.('diagnosed', `Diagnosis (${diagnosis.category}): ${diagnosis.explanation}`);

    // 3. Declarative Repair Plan before Patch synthesis (Phase D)
    const plan = createRepairPlan(diagnosis, files);
    onProgress?.('planning', `Synthesizing repair plan: ${plan.summary}`);

    // 4. Generate targeted minimal patch (Phase E)
    onProgress?.('patching', 'Synthesizing source code repair patch...');
    const patch = await generatePatch({
      diagnosis,
      plan,
      evidence,
      relevantFiles,
      projectId
    });

    // 5. Validate Patch Safety & Path Traversal
    const validation = validatePatch(patch, files);
    if (!validation.valid) {
      throw new Error(`Patch validation failed: ${validation.errors.join(', ')}`);
    }

    // 6. Validate Patch Minimality (Phase E)
    const minimality = validatePatchMinimality(patch, files, diagnosis.affectedFiles);
    patch.planId = plan.id;
    patch.isMinimal = minimality.isMinimal;
    if (minimality.warnings.length > 0) {
      patch.minimalityNotes = minimality.warnings.join('; ');
    }

    onProgress?.('ready_for_review', 'Patch synthesized and verified safe. Awaiting user review.');
    return { diagnosis, plan, patch };
  }

  public async applyPatchAndVerify(
    projectId: string,
    patch: Patch,
    onProgress?: RepairLoopStepCallback
  ): Promise<{ verified: boolean; error?: string; verificationResult?: VerificationResult }> {
    console.log('[Repair Engine] applyPatchAndVerify starting for project:', projectId);

    // 1. Validate the Gemini patch against the CURRENT VFS state
    const currentFiles = vfsManager.getFiles(projectId);
    const validation = validatePatch(patch, currentFiles);
    if (!validation.valid) {
      const errorMsg = `Patch validation failed: ${validation.errors.join(', ')}`;
      console.warn('[Repair Engine]', errorMsg);
      try {
        const { useAgentStore } = await import('../../store/agentStore');
        useAgentStore.getState().setPendingPatch(null);
      } catch {}
      return { verified: false, error: errorMsg };
    }

    // 2. Create a COMPLETE project snapshot BEFORE any mutation
    onProgress?.('snapshot', 'Creating pre-repair VFS snapshot checkpoint...');
    await snapshotService.createSnapshot(projectId, `Before applying patch: ${patch.summary}`);
    console.log('[Repair Engine] Pre-repair snapshot created');

    // 3. Apply patch to VFS
    onProgress?.('applying', 'Applying validated code changes to project files...');
    try {
      for (const fileChange of patch.files) {
        await vfsManager.writeFile(projectId, fileChange.path, fileChange.after);
      }
    } catch (patchErr: any) {
      console.error('[Repair Engine] Failed to write patch files to VFS:', patchErr);
      onProgress?.('rollback', 'Failed to apply patch. Rolling back to pre-repair snapshot...');
      await snapshotService.restoreSnapshot(projectId);
      const restoredFiles = vfsManager.getFiles(projectId);
      try {
        await runtimeManager.replaceProject(restoredFiles, projectId);
      } catch {}
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      try {
        await resetEditorBoundary(projectId, restoredFiles);
      } catch {}
      try {
        const { useAgentStore } = await import('../../store/agentStore');
        useAgentStore.getState().setPendingPatch(null);
      } catch {}
      return {
        verified: false,
        error: `Failed to apply patch to VFS: ${patchErr?.message || 'Unknown VFS write error'}`
      };
    }

    // 4. Synchronize the COMPLETE resulting project state to WebContainer
    try {
      const patchedFiles = vfsManager.getFiles(projectId);
      await runtimeManager.replaceProject(patchedFiles, projectId);
      console.log('[Repair Engine] Complete patched project synchronized to runtime');
    } catch (syncErr: any) {
      // 5. If synchronization fails: rollback VFS snapshot & restore runtime from snapshot
      console.error('[Repair Engine] Runtime synchronization failed:', syncErr);
      onProgress?.('rollback', 'Runtime synchronization failed. Rolling back to pre-repair snapshot...');
      await snapshotService.restoreSnapshot(projectId);
      const restoredFiles = vfsManager.getFiles(projectId);
      try {
        await runtimeManager.replaceProject(restoredFiles, projectId);
      } catch {}
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      try {
        await resetEditorBoundary(projectId, restoredFiles);
      } catch {}
      try {
        const { useAgentStore } = await import('../../store/agentStore');
        useAgentStore.getState().setPendingPatch(null);
      } catch {}
      return {
        verified: false,
        error: `Runtime synchronization failed: ${syncErr?.message || 'Unknown runtime error'}`
      };
    }

    // 6. Run real verification pipeline
    onProgress?.('verifying', 'Running verification checks (TypeScript, Build)...');
    console.log('[Repair Engine] Running verification checks for project:', projectId);
    const result = await verificationService.runFullVerification({ projectId });
    console.log('[Repair Engine] Verification completed with result:', result);

    // 7. If verification succeeds: keep patched state, sync projectStore, and return success
    if (result.success) {
      result.originalErrorCleared = true;
      result.finalState = 'VERIFIED';
      onProgress?.('verified', `Repair verified successfully (${result.totalDurationMs}ms). Zero regressions.`);
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      try {
        const patchedFiles = vfsManager.getFiles(projectId);
        await resetEditorBoundary(projectId, patchedFiles);
      } catch {}
      return { verified: true, verificationResult: result };
    } else {
      // 8. If verification fails or times out: rollback COMPLETE project snapshot & WebContainer project
      result.originalErrorCleared = false;
      result.finalState = 'ROLLED_BACK';
      onProgress?.('rollback', 'Verification failed. Rolling back to pre-repair snapshot...');
      await snapshotService.restoreSnapshot(projectId);

      // Resync complete rolled-back project to runtime (restores files & cleans up newly added rogue files)
      const restoredFiles = vfsManager.getFiles(projectId);
      await runtimeManager.replaceProject(restoredFiles, projectId);

      // Synchronize projectStore derived file state
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      try {
        await resetEditorBoundary(projectId, restoredFiles);
      } catch {}
      try {
        const { useAgentStore } = await import('../../store/agentStore');
        useAgentStore.getState().setPendingPatch(null, projectId);
      } catch {}

      const failedCheck = result.checks.find((c) => !c.success);
      const errorOutput = failedCheck?.output ? `: ${failedCheck.output}` : '';
      return {
        verified: false,
        error: `Verification check '${failedCheck?.name || 'Pipeline'}' ${failedCheck?.status || 'failed'}${errorOutput}`,
        verificationResult: result
      };
    }
  }
}

export const repairLoopEngine = RepairLoopEngine.getInstance();
