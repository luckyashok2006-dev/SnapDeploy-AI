import { ExecutionEvidence, Patch, Diagnosis } from '../../types/workspace';
import { diagnoseFailure } from './diagnosis';
import { generatePatch } from './repair';
import { validatePatch } from './patch-validator';
import { snapshotService } from '../../lib/snapshots/SnapshotService';
import { verificationService } from '../verification/VerificationService';
import { runtimeManager } from '../../lib/runtime/runtime-manager';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { resetEditorBoundary } from '../../lib/editor/editor-boundary';

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
  ): Promise<{ diagnosis: Diagnosis; patch: Patch }> {
    onProgress?.('diagnosing', 'Analyzing execution evidence and stack trace...');
    
    // Gather project file contents for AI context
    const files = vfsManager.getFiles(projectId);
    const relevantFiles: Record<string, string> = {};
    for (const [path, f] of Object.entries(files)) {
      relevantFiles[path] = f.content;
    }

    // 1. Diagnose
    const diagnosis = await diagnoseFailure({
      evidence,
      relevantFiles
    });
    onProgress?.('diagnosed', `Diagnosis: ${diagnosis.explanation}`);

    // 2. Generate Patch
    onProgress?.('patching', 'Synthesizing source code repair patch...');
    const patch = await generatePatch({
      diagnosis,
      evidence,
      relevantFiles
    });

    // 3. Validate Patch
    const validation = validatePatch(patch, files);
    if (!validation.valid) {
      throw new Error(`Patch validation failed: ${validation.errors.join(', ')}`);
    }

    onProgress?.('ready_for_review', 'Patch synthesized and verified safe. Awaiting user review.');
    return { diagnosis, patch };
  }

  public async applyPatchAndVerify(
    projectId: string,
    patch: Patch,
    onProgress?: RepairLoopStepCallback
  ): Promise<{ verified: boolean; error?: string }> {
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
    console.log('[Repair Engine] Running verification checks...');
    const result = await verificationService.runFullVerification();
    console.log('[Repair Engine] Verification completed with result:', result);

    // 7. If verification succeeds: keep patched state, sync projectStore, and return success
    if (result.success) {
      onProgress?.('verified', `Repair verified successfully (${result.totalDurationMs}ms). Zero regressions.`);
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      try {
        const patchedFiles = vfsManager.getFiles(projectId);
        await resetEditorBoundary(projectId, patchedFiles);
      } catch {}
      return { verified: true };
    } else {
      // 8. If verification fails or times out: rollback COMPLETE project snapshot & WebContainer project
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
        useAgentStore.getState().setPendingPatch(null);
      } catch {}

      const failedCheck = result.checks.find((c) => !c.success);
      const errorOutput = failedCheck?.output ? `: ${failedCheck.output}` : '';
      return {
        verified: false,
        error: `Verification check '${failedCheck?.name || 'Pipeline'}' ${failedCheck?.status || 'failed'}${errorOutput}`
      };
    }
  }
}

export const repairLoopEngine = RepairLoopEngine.getInstance();
