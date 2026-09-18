import { Snapshot, ProjectFile } from '../../types/workspace';
import { vfsManager } from '../vfs/vfs-manager';

export interface SnapshotDiffSummary {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
}

export class SnapshotService {
  private static instance: SnapshotService;

  private constructor() {}

  public static getInstance(): SnapshotService {
    if (!SnapshotService.instance) {
      SnapshotService.instance = new SnapshotService();
    }
    return SnapshotService.instance;
  }

  public async createSnapshot(projectId: string, description: string): Promise<Snapshot> {
    return vfsManager.createSnapshot(projectId, description);
  }

  public async restoreSnapshot(projectId: string): Promise<Record<string, ProjectFile> | null> {
    return vfsManager.rollbackSnapshot(projectId);
  }

  public listSnapshots(projectId: string): Snapshot[] {
    return vfsManager.getSnapshots(projectId);
  }

  public getSnapshot(projectId: string, snapshotId: string): Snapshot | undefined {
    return vfsManager.getSnapshotById(projectId, snapshotId);
  }

  public async restoreSnapshotById(
    projectId: string,
    snapshotId: string
  ): Promise<{ restoredFiles: Record<string, ProjectFile>; preRestoreCheckpoint: Snapshot }> {
    return vfsManager.restoreSnapshotById(projectId, snapshotId);
  }

  public compareSnapshots(
    currentFiles: Record<string, ProjectFile>,
    snapshotFiles: Record<string, ProjectFile>
  ): SnapshotDiffSummary {
    const currentKeys = new Set(Object.keys(currentFiles));
    const snapshotKeys = new Set(Object.keys(snapshotFiles));

    const addedFiles: string[] = [];
    const removedFiles: string[] = [];
    const modifiedFiles: string[] = [];

    for (const key of currentKeys) {
      if (!snapshotKeys.has(key)) {
        addedFiles.push(key);
      } else if (currentFiles[key].content !== snapshotFiles[key].content) {
        modifiedFiles.push(key);
      }
    }

    for (const key of snapshotKeys) {
      if (!currentKeys.has(key)) {
        removedFiles.push(key);
      }
    }

    return { addedFiles, removedFiles, modifiedFiles };
  }
}

export const snapshotService = SnapshotService.getInstance();
