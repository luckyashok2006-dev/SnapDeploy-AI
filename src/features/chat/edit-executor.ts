import { EditProposal, Patch } from '../../types/workspace';
import { validateEditPatch } from './edit-validator';
import { snapshotService } from '../../lib/snapshots/SnapshotService';
import { runtimeManager } from '../../lib/runtime/runtime-manager';
import { verificationService } from '../verification/VerificationService';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { resetEditorBoundary } from '../../lib/editor/editor-boundary';
import { databaseCoordinator } from '../database/database-coordinator';

export interface EditProgressCallback {
  (stage: string, message: string): void;
}

export class EditExecutor {
  private static instance: EditExecutor;

  private constructor() {}

  public static getInstance(): EditExecutor {
    if (!EditExecutor.instance) {
      EditExecutor.instance = new EditExecutor();
    }
    return EditExecutor.instance;
  }

  public async executeEdit(
    projectId: string,
    proposal: EditProposal | Patch,
    onProgress?: EditProgressCallback
  ): Promise<{ verified: boolean; error?: string; rolledBack?: boolean }> {
    console.log('[EditExecutor] executeEdit starting for project:', projectId);

    // 1. Live VFS Pre-flight validation
    const liveFiles = vfsManager.getFiles(projectId);
    const validation = validateEditPatch(proposal, liveFiles);
    if (!validation.valid) {
      const errorMsg = `Edit validation failed: ${validation.errors.join(', ')}`;
      console.warn('[EditExecutor]', errorMsg);
      return { verified: false, error: errorMsg };
    }

    // 1b. Validate structured migration if proposal includes database migration
    const migration = (proposal as EditProposal).migration;
    if (migration) {
      try {
        databaseCoordinator.validateMigrationRequest(migration);
      } catch (migrationErr: any) {
        const errorMsg = `Database migration validation failed: ${migrationErr?.message || 'Invalid migration'}`;
        console.warn('[EditExecutor]', errorMsg);
        return { verified: false, error: errorMsg };
      }
    }

    // 2. Create authentic Version History checkpoint in IndexedDB
    onProgress?.('snapshot', 'Creating pre-edit Version History checkpoint...');
    const checkpointDescription = `Before AI edit: ${proposal.summary}`;
    await snapshotService.createSnapshot(projectId, checkpointDescription);
    console.log('[EditExecutor] Pre-edit snapshot created:', checkpointDescription);

    // 3. Apply patch changes to VFS
    onProgress?.('applying', 'Applying validated changes to project files...');
    try {
      for (const fileChange of proposal.files) {
        await vfsManager.writeFile(projectId, fileChange.path, fileChange.after);
      }
    } catch (patchErr: any) {
      console.error('[EditExecutor] Failed to write patch files to VFS:', patchErr);
      onProgress?.('rollback', 'Failed to write files. Rolling back to pre-edit checkpoint...');
      await snapshotService.restoreSnapshot(projectId);
      const restoredFiles = vfsManager.getFiles(projectId);
      try {
        await runtimeManager.replaceProject(restoredFiles, projectId);
      } catch {}
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      await resetEditorBoundary(projectId, restoredFiles);
      return {
        verified: false,
        error: `Failed to apply changes to VFS: ${patchErr?.message || 'Unknown VFS write error'}`
      };
    }

    // 4. Synchronize complete project to WebContainer runtime
    try {
      onProgress?.('syncing', 'Synchronizing changes with WebContainer runtime...');
      const patchedFiles = vfsManager.getFiles(projectId);
      await runtimeManager.replaceProject(patchedFiles, projectId);
      console.log('[EditExecutor] Patched project synchronized to runtime');
    } catch (syncErr: any) {
      console.error('[EditExecutor] Runtime synchronization failed:', syncErr);
      onProgress?.('rollback', 'Runtime synchronization failed. Rolling back to pre-edit checkpoint...');
      await snapshotService.restoreSnapshot(projectId);
      const restoredFiles = vfsManager.getFiles(projectId);
      try {
        await runtimeManager.replaceProject(restoredFiles, projectId);
      } catch {}
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      await resetEditorBoundary(projectId, restoredFiles);
      return {
        verified: false,
        error: `Runtime synchronization failed: ${syncErr?.message || 'Unknown runtime error'}`
      };
    }

    // 5. Finite Verification Pipeline (tsc + build)
    onProgress?.('verifying', 'Running verification checks (TypeScript, Build)...');
    const result = await verificationService.runFullVerification({ projectId });
    console.log('[EditExecutor] Verification completed with result:', result);

    if (result.success) {
      // 6. Remote Database Migration (Executed only after code verification passes)
      if (migration) {
        onProgress?.('database', 'Executing remote database migration...');
        try {
          const migrationResult = await databaseCoordinator.executeSafeMigration(projectId, migration);
          if (!migrationResult.success) {
            // Remote migration failed: Rollback VFS changes to pre-edit checkpoint
            onProgress?.('rollback', 'Database migration failed. Rolling back source code changes...');
            await snapshotService.restoreSnapshot(projectId);
            const restoredFiles = vfsManager.getFiles(projectId);
            await runtimeManager.replaceProject(restoredFiles, projectId);
            try {
              const { useProjectStore } = await import('../../store/projectStore');
              useProjectStore.getState().syncProjectFilesFromVFS(projectId);
            } catch {}
            await resetEditorBoundary(projectId, restoredFiles);
            return {
              verified: false,
              error: `Remote database migration failed: ${migrationResult.error || 'Unknown database error'}`
            };
          }
          if (migrationResult.status === 'unknown') {
            console.warn('[EditExecutor] Migration succeeded remotely but local persistence is unconfirmed (status: unknown)');
          }
        } catch (migErr: any) {
          // Migration threw an exception: Rollback VFS changes
          onProgress?.('rollback', 'Database migration failed. Rolling back source code changes...');
          await snapshotService.restoreSnapshot(projectId);
          const restoredFiles = vfsManager.getFiles(projectId);
          await runtimeManager.replaceProject(restoredFiles, projectId);
          try {
            const { useProjectStore } = await import('../../store/projectStore');
            useProjectStore.getState().syncProjectFilesFromVFS(projectId);
          } catch {}
          await resetEditorBoundary(projectId, restoredFiles);
          return {
            verified: false,
            error: `Remote database migration failed: ${migErr?.message || 'Unknown database error'}`
          };
        }
      }

      // Success branch
      onProgress?.('verified', `Edit verified successfully (${result.totalDurationMs}ms). Zero regressions.`);
      const patchedFiles = vfsManager.getFiles(projectId);
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      await resetEditorBoundary(projectId, patchedFiles);
      return { verified: true };
    } else {
      // Rollback branch
      onProgress?.('rollback', 'Verification failed. Rolling back to pre-edit checkpoint...');
      await snapshotService.restoreSnapshot(projectId);
      const restoredFiles = vfsManager.getFiles(projectId);
      await runtimeManager.replaceProject(restoredFiles, projectId);
      try {
        const { useProjectStore } = await import('../../store/projectStore');
        useProjectStore.getState().syncProjectFilesFromVFS(projectId);
      } catch {}
      await resetEditorBoundary(projectId, restoredFiles);

      const failedCheck = result.checks.find((c) => !c.success);
      const errorOutput = failedCheck?.output ? `: ${failedCheck.output}` : '';
      return {
        verified: false,
        rolledBack: true,
        error: `Verification check '${failedCheck?.name || 'Pipeline'}' ${failedCheck?.status || 'failed'}${errorOutput}`
      };
    }
  }
}

export const editExecutor = EditExecutor.getInstance();
