import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';

describe('SnapDeploy AI — Tier 1 Feature 2: Version History & Timeline', () => {
  beforeEach(async () => {
    await vfsManager.resetForTesting();
    useProjectStore.setState({
      projects: {},
      activeProjectId: '',
      deletedProjectIds: []
    });
    useEditorStore.setState({
      openTabs: {},
      activeFilePath: {},
      dirtyFiles: {}
    });
  });

  describe('Snapshot Retrieval & Chronological Ordering', () => {
    it('retrieves snapshots in reverse-chronological order (newest first)', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Timeline Project');

      await writeFile(projId, '/src/App.tsx', 'export const v1 = 1;');
      const s1 = await snapshotService.createSnapshot(projId, 'First version');

      // Small delay to ensure timestamp separation
      await new Promise(r => setTimeout(r, 50));
      await writeFile(projId, '/src/App.tsx', 'export const v2 = 2;');
      const s2 = await snapshotService.createSnapshot(projId, 'Second version');

      await new Promise(r => setTimeout(r, 50));
      await writeFile(projId, '/src/App.tsx', 'export const v3 = 3;');
      const s3 = await snapshotService.createSnapshot(projId, 'Third version');

      const history = snapshotService.listSnapshots(projId);
      expect(history.length).toBe(3);
      expect(history[0].id).toBe(s3.id);
      expect(history[0].description).toBe('Third version');
      expect(history[1].id).toBe(s2.id);
      expect(history[1].description).toBe('Second version');
      expect(history[2].id).toBe(s1.id);
      expect(history[2].description).toBe('First version');
    });

    it('returns empty array when project has no snapshots', () => {
      const history = snapshotService.listSnapshots('non-existent-proj');
      expect(history).toEqual([]);
    });
  });

  describe('Authoritative VFS Snapshot Integrity', () => {
    it('creates snapshots containing authoritative VFS files, hashes, and project identity', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Auth Project');

      await writeFile(projId, '/src/index.ts', 'const a = 1;');
      await writeFile(projId, '/package.json', '{"name": "test"}');

      const snapshot = await snapshotService.createSnapshot(projId, 'Baseline');
      expect(snapshot.projectId).toBe(projId);
      expect(snapshot.description).toBe('Baseline');
      expect(snapshot.hash).toMatch(/^snap_fp_/);
      expect(snapshot.timestamp).toBeDefined();

      const files = snapshot.files;
      expect(Object.keys(files).length).toBe(2);
      expect(files['/src/index.ts']?.content).toBe('const a = 1;');
      expect(files['/package.json']?.content).toBe('{"name": "test"}');
    });

    it('accurately computes file-level diff summary between snapshots', async () => {
      const { createProject, writeFile, deleteFile } = useProjectStore.getState();
      const projId = createProject('Diff Project');

      await writeFile(projId, '/src/App.tsx', 'console.log("initial");');
      await writeFile(projId, '/src/shared.ts', 'export const x = 10;');
      const snap1 = await snapshotService.createSnapshot(projId, 'Initial');

      // Modify App.tsx, delete shared.ts, add new.ts
      await writeFile(projId, '/src/App.tsx', 'console.log("modified");');
      await deleteFile(projId, '/src/shared.ts');
      await writeFile(projId, '/src/new.ts', 'export const y = 20;');
      const snap2 = await snapshotService.createSnapshot(projId, 'Modified');

      const diff = snapshotService.compareSnapshots(snap2.files, snap1.files);
      expect(diff.addedFiles).toEqual(['/src/new.ts']);
      expect(diff.removedFiles).toEqual(['/src/shared.ts']);
      expect(diff.modifiedFiles).toEqual(['/src/App.tsx']);
    });
  });

  describe('Project History Isolation', () => {
    it('strictly isolates snapshots between Project A and Project B', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projA = createProject('Project A');
      const projB = createProject('Project B');

      await writeFile(projA, '/src/a.ts', 'export const a = 1;');
      await snapshotService.createSnapshot(projA, 'Snapshot for A');

      await writeFile(projB, '/src/b.ts', 'export const b = 2;');
      await snapshotService.createSnapshot(projB, 'Snapshot for B1');
      await snapshotService.createSnapshot(projB, 'Snapshot for B2');

      const historyA = snapshotService.listSnapshots(projA);
      const historyB = snapshotService.listSnapshots(projB);

      expect(historyA.length).toBe(1);
      expect(historyA[0].description).toBe('Snapshot for A');
      expect(historyB.length).toBe(2);
      expect(historyB.every(s => s.projectId === projB)).toBe(true);
    });
  });

  describe('Restore Version Workflow & Edge Cases', () => {
    it('restores historical snapshot and purges files added after the snapshot', async () => {
      const { createProject, writeFile, restoreSnapshot } = useProjectStore.getState();
      const projId = createProject('Restore Project');

      // Version 1
      await writeFile(projId, '/src/App.tsx', 'export const version = 1;');
      const v1Snapshot = await snapshotService.createSnapshot(projId, 'Version 1');

      // Version 2 (added extra file and modified App.tsx)
      await writeFile(projId, '/src/App.tsx', 'export const version = 2;');
      await writeFile(projId, '/src/after-v1.ts', 'export const rogue = true;');
      await snapshotService.createSnapshot(projId, 'Version 2');

      // Verify state before restore
      expect(vfsManager.getFiles(projId)['/src/after-v1.ts']).toBeDefined();
      expect(vfsManager.getFiles(projId)['/src/App.tsx']?.content).toBe('export const version = 2;');

      // Restore Version 1
      const restored = await restoreSnapshot(projId, v1Snapshot.id);
      expect(restored).toBe(true);

      // Verify files reverted and rogue file is purged
      const currentFiles = vfsManager.getFiles(projId);
      expect(currentFiles['/src/App.tsx']?.content).toBe('export const version = 1;');
      expect(currentFiles['/src/after-v1.ts']).toBeUndefined();
    });

    it('creates an automatic safety checkpoint prior to destructive restore', async () => {
      const { createProject, writeFile, restoreSnapshot } = useProjectStore.getState();
      const projId = createProject('Safety Checkpoint Project');

      await writeFile(projId, '/src/App.tsx', 'v1');
      const v1 = await snapshotService.createSnapshot(projId, 'v1');

      await writeFile(projId, '/src/App.tsx', 'v2-current-work');

      // Restore v1
      await restoreSnapshot(projId, v1.id);

      // History should now contain 3 items:
      // [0]: Pre-restore checkpoint (saving 'v2-current-work')
      // [1]: v1
      const history = snapshotService.listSnapshots(projId);
      expect(history.length).toBe(2);
      expect(history[0].description).toContain('Pre-restore checkpoint');
      expect(history[0].files['/src/App.tsx']?.content).toBe('v2-current-work');
    });

    it('handles dirty editor state: detects dirty files and clears dirty flags on restore', async () => {
      const { createProject, writeFile, restoreSnapshot } = useProjectStore.getState();
      const { markDirty, hasDirtyFiles, getDirtyFiles } = useEditorStore.getState();
      const projId = createProject('Dirty Project');

      await writeFile(projId, '/src/App.tsx', 'initial');
      const snap = await snapshotService.createSnapshot(projId, 'Clean Base');

      // User makes unsaved edits
      markDirty(projId, '/src/App.tsx', true);
      markDirty(projId, '/src/Header.tsx', true);

      expect(hasDirtyFiles(projId)).toBe(true);
      expect(getDirtyFiles(projId)).toEqual(['/src/App.tsx', '/src/Header.tsx']);

      // Restore snapshot
      await restoreSnapshot(projId, snap.id);

      // Dirty files must be cleared after restore
      expect(hasDirtyFiles(projId)).toBe(false);
      expect(getDirtyFiles(projId)).toEqual([]);
    });

    it('synchronizes open editor tabs and closes tabs for files removed by restore', async () => {
      const { createProject, writeFile, restoreSnapshot } = useProjectStore.getState();
      const { openFile } = useEditorStore.getState();
      const projId = createProject('Tab Sync Project');

      await writeFile(projId, '/src/App.tsx', 'app');
      const snap = await snapshotService.createSnapshot(projId, 'Baseline');

      // Add file and open in tabs
      await writeFile(projId, '/src/Temporary.tsx', 'temp');
      openFile(projId, '/src/App.tsx');
      openFile(projId, '/src/Temporary.tsx');

      expect(useEditorStore.getState().openTabs[projId]).toEqual(['/src/App.tsx', '/src/Temporary.tsx']);

      // Restore baseline (which lacks Temporary.tsx)
      await restoreSnapshot(projId, snap.id);

      // Open tabs must only contain existing files
      expect(useEditorStore.getState().openTabs[projId]).toEqual(['/src/App.tsx']);
    });

    it('rejects concurrent duplicate restore requests via in-flight lock', async () => {
      const { createProject, writeFile, restoreSnapshot } = useProjectStore.getState();
      const projId = createProject('Concurrent Project');

      await writeFile(projId, '/src/App.tsx', 'code');
      const snap = await snapshotService.createSnapshot(projId, 'Snap');

      // Trigger two restores simultaneously
      const restorePromise1 = restoreSnapshot(projId, snap.id);
      const restorePromise2 = restoreSnapshot(projId, snap.id);

      const results = await Promise.allSettled([restorePromise1, restorePromise2]);
      const rejected = results.filter(r => r.status === 'rejected');
      const fulfilled = results.filter(r => r.status === 'fulfilled');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('already in progress');
    });
  });

  describe('Retention Policy & 15-Snapshot Edge Cases', () => {
    it('enforces 15-snapshot retention limit by pruning oldest snapshot', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Retention Project');

      // Create 16 snapshots sequentially
      for (let i = 1; i <= 16; i++) {
        await writeFile(projId, '/src/counter.ts', `export const val = ${i};`);
        await snapshotService.createSnapshot(projId, `Checkpoint ${i}`);
      }

      const history = snapshotService.listSnapshots(projId);
      expect(history.length).toBe(15);
      // Newest should be Checkpoint 16
      expect(history[0].description).toBe('Checkpoint 16');
      // Oldest retained should be Checkpoint 2 (Checkpoint 1 pruned)
      expect(history[14].description).toBe('Checkpoint 2');
    });

    it('CRITICAL RETENTION EDGE CASE: restores the oldest (15th) snapshot without losing target files', async () => {
      const { createProject, writeFile, restoreSnapshot } = useProjectStore.getState();
      const projId = createProject('Edge Case 15 Snapshots');

      // Create exactly 15 snapshots
      let oldestSnapshotId = '';
      for (let i = 1; i <= 15; i++) {
        await writeFile(projId, '/src/App.tsx', `// App Version ${i}`);
        await writeFile(projId, `/src/file_${i}.ts`, `export const v = ${i};`);
        const snap = await snapshotService.createSnapshot(projId, `Checkpoint ${i}`);
        if (i === 1) {
          oldestSnapshotId = snap.id;
        }
      }

      const preHistory = snapshotService.listSnapshots(projId);
      expect(preHistory.length).toBe(15);
      expect(preHistory[14].id).toBe(oldestSnapshotId);
      expect(preHistory[14].description).toBe('Checkpoint 1');

      // User restores the oldest snapshot (Checkpoint 1, at index 14)
      const success = await restoreSnapshot(projId, oldestSnapshotId);
      expect(success).toBe(true);

      // Verify authoritative project files successfully reverted to Checkpoint 1
      const restoredFiles = vfsManager.getFiles(projId);
      expect(restoredFiles['/src/App.tsx']?.content).toBe('// App Version 1');
      expect(restoredFiles['/src/file_1.ts']?.content).toBe('export const v = 1;');
      // Files 2-15 must NOT exist
      expect(restoredFiles['/src/file_2.ts']).toBeUndefined();
      expect(restoredFiles['/src/file_15.ts']).toBeUndefined();

      // Verify history stack remains bounded to 15
      const postHistory = snapshotService.listSnapshots(projId);
      expect(postHistory.length).toBe(15);
      // Index 0 is the pre-restore checkpoint saving Checkpoint 15 state
      expect(postHistory[0].description).toContain('Pre-restore checkpoint');
      expect(postHistory[0].files['/src/App.tsx']?.content).toBe('// App Version 15');
    });
  });

  describe('Integration with Duplicate & Delete Project', () => {
    it('isolates version history across duplicated projects', async () => {
      const { createProject, writeFile, duplicateProject } = useProjectStore.getState();
      const sourceId = createProject('Source Project');

      await writeFile(sourceId, '/src/main.ts', 'export const src = 1;');
      await snapshotService.createSnapshot(sourceId, 'Source Checkpoint');

      const dupId = await duplicateProject(sourceId, 'Cloned Project');

      // Duplicate receives independent clone of snapshots
      const sourceHistory = snapshotService.listSnapshots(sourceId);
      const dupHistory = snapshotService.listSnapshots(dupId);

      expect(sourceHistory.length).toBe(1);
      expect(dupHistory.length).toBe(1);
      expect(dupHistory[0].projectId).toBe(dupId);
      expect(dupHistory[0].id).not.toBe(sourceHistory[0].id);

      // Adding snapshot to duplicate does not affect source
      await writeFile(dupId, '/src/main.ts', 'export const dup = 2;');
      await snapshotService.createSnapshot(dupId, 'Dup-Only Checkpoint');

      expect(snapshotService.listSnapshots(sourceId).length).toBe(1);
      expect(snapshotService.listSnapshots(dupId).length).toBe(2);
    });

    it('cleans up version history when project is safely deleted', async () => {
      const { createProject, writeFile, deleteProject } = useProjectStore.getState();
      const projA = createProject('Survivor Project');
      const projB = createProject('Doomed Project');

      await writeFile(projA, '/src/a.ts', 'a');
      await snapshotService.createSnapshot(projA, 'Survivor Snap');

      await writeFile(projB, '/src/b.ts', 'b');
      await snapshotService.createSnapshot(projB, 'Doomed Snap');

      expect(snapshotService.listSnapshots(projB).length).toBe(1);

      // Delete project B
      await deleteProject(projB);

      // Project B history is cleaned up
      expect(snapshotService.listSnapshots(projB)).toEqual([]);
      // Project A history is completely preserved
      expect(snapshotService.listSnapshots(projA).length).toBe(1);
    });

    it('preserves version history when project is renamed', async () => {
      const { createProject, writeFile, renameProject } = useProjectStore.getState();
      const projId = createProject('Original Name');

      await writeFile(projId, '/src/App.tsx', 'code');
      await snapshotService.createSnapshot(projId, 'Snap 1');
      await snapshotService.createSnapshot(projId, 'Snap 2');

      renameProject(projId, 'Renamed Project');

      const history = snapshotService.listSnapshots(projId);
      expect(history.length).toBe(2);
      expect(history[0].description).toBe('Snap 2');
      expect(history[1].description).toBe('Snap 1');
    });
  });
});
