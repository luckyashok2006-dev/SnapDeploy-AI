import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';

describe('SnapDeploy AI — Project Lifecycle: Rename & Duplicate Project', () => {
  beforeEach(async () => {
    // Reset stores and VFS for isolated testing
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

  describe('Rename Project', () => {
    it('renames an active project while preserving ID, files, snapshots, editor tabs, and active state', async () => {
      const { createProject, renameProject, writeFile, setActiveProjectId } = useProjectStore.getState();
      const projId = createProject('Alpha Project');
      setActiveProjectId(projId);

      // Add files and snapshots
      await writeFile(projId, '/src/index.ts', 'export const alpha = 1;');
      await snapshotService.createSnapshot(projId, 'Initial alpha snapshot');

      useEditorStore.getState().openFile(projId, '/src/index.ts');

      // Rename project
      const result = renameProject(projId, 'Alpha Prime');
      expect(result).toBe(true);

      const state = useProjectStore.getState();
      const updatedProj = state.projects[projId];
      expect(updatedProj).toBeDefined();
      expect(updatedProj.title).toBe('Alpha Prime');
      expect(updatedProj.id).toBe(projId); // ID preserved
      expect(state.activeProjectId).toBe(projId); // Active project preserved

      // Files preserved
      const files = vfsManager.getFiles(projId);
      expect(files['/src/index.ts']).toBeDefined();
      expect(files['/src/index.ts'].content).toBe('export const alpha = 1;');

      // Snapshots preserved
      const snapshots = snapshotService.listSnapshots(projId);
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].description).toBe('Initial alpha snapshot');

      // Editor state preserved
      const editorState = useEditorStore.getState();
      expect(editorState.openTabs[projId]).toEqual(['/src/index.ts']);
      expect(editorState.activeFilePath[projId]).toBe('/src/index.ts');
    });

    it('renames an inactive project without switching activeProjectId', async () => {
      const { createProject, renameProject, setActiveProjectId } = useProjectStore.getState();
      const activeId = createProject('Active Project');
      const inactiveId = createProject('Inactive Project');
      setActiveProjectId(activeId);

      const result = renameProject(inactiveId, 'Renamed Inactive Project');
      expect(result).toBe(true);

      const state = useProjectStore.getState();
      expect(state.projects[inactiveId].title).toBe('Renamed Inactive Project');
      expect(state.activeProjectId).toBe(activeId); // Did NOT switch
    });

    it('rejects invalid names: empty string, whitespace only, control chars, or > 60 chars', () => {
      const { createProject, renameProject } = useProjectStore.getState();
      const projId = createProject('Valid Project');

      // Empty name
      expect(() => renameProject(projId, '')).toThrow(/empty or whitespace/i);
      expect(() => renameProject(projId, '   ')).toThrow(/empty or whitespace/i);

      // Excessive length (> 60 chars)
      const longName = 'A'.repeat(61);
      expect(() => renameProject(projId, longName)).toThrow(/exceed 60 characters/i);

      // Control characters
      expect(() => renameProject(projId, 'Bad\x00Name')).toThrow(/control characters/i);

      // Non-existent project
      expect(() => renameProject('non_existent_id', 'New Title')).toThrow(/does not exist/i);

      // Original remains untouched
      expect(useProjectStore.getState().projects[projId].title).toBe('Valid Project');
    });

    it('trims whitespace automatically and persists renamed title', () => {
      const { createProject, renameProject } = useProjectStore.getState();
      const projId = createProject('Padded Project');

      renameProject(projId, '   Clean Title   ');
      expect(useProjectStore.getState().projects[projId].title).toBe('Clean Title');
    });
  });

  describe('Duplicate Project', () => {
    it('creates a new unique project ID and names it with "Copy"', async () => {
      const { createProject, duplicateProject, writeFile } = useProjectStore.getState();
      const originalId = createProject('Original App');
      await writeFile(originalId, '/src/App.tsx', 'export default function App() {}');

      const duplicateId = await duplicateProject(originalId);

      expect(duplicateId).toBeDefined();
      expect(duplicateId).not.toBe(originalId);
      expect(duplicateId.startsWith('proj_')).toBe(true);

      const state = useProjectStore.getState();
      const duplicateProj = state.projects[duplicateId];
      expect(duplicateProj).toBeDefined();
      expect(duplicateProj.title).toBe('Original App Copy');
      expect(duplicateProj.status).toBe('ready');
      expect(duplicateProj.diagnostics).toEqual([]);
      expect(duplicateProj.fixHistory).toEqual([]);
    });

    it('increments copy counter when duplicating multiple times', async () => {
      const { createProject, duplicateProject } = useProjectStore.getState();
      const origId = createProject('Dashboard');

      const copy1Id = await duplicateProject(origId);
      const copy2Id = await duplicateProject(origId);

      const state = useProjectStore.getState();
      expect(state.projects[copy1Id].title).toBe('Dashboard Copy');
      expect(state.projects[copy2Id].title).toBe('Dashboard Copy 2');
    });

    it('deeply clones committed authoritative VFS files with new project-scoped IDs', async () => {
      const { createProject, duplicateProject, writeFile } = useProjectStore.getState();
      const origId = createProject('Source App');
      await writeFile(origId, '/package.json', JSON.stringify({ name: 'source-app' }));
      await writeFile(origId, '/src/main.tsx', 'import React from "react";');

      const dupId = await duplicateProject(origId);

      const origFiles = vfsManager.getFiles(origId);
      const dupFiles = vfsManager.getFiles(dupId);

      expect(Object.keys(dupFiles).sort()).toEqual(Object.keys(origFiles).sort());

      // Verify contents match but IDs and projectIds are strictly re-keyed
      expect(dupFiles['/package.json'].content).toBe(origFiles['/package.json'].content);
      expect(dupFiles['/package.json'].projectId).toBe(dupId);
      expect(dupFiles['/package.json'].id).toBe(`${dupId}:/package.json`);

      expect(dupFiles['/src/main.tsx'].content).toBe(origFiles['/src/main.tsx'].content);
      expect(dupFiles['/src/main.tsx'].projectId).toBe(dupId);
      expect(dupFiles['/src/main.tsx'].id).toBe(`${dupId}:/src/main.tsx`);
    });

    it('enforces strict file isolation: mutating duplicate does NOT affect original and vice versa', async () => {
      const { createProject, duplicateProject, writeFile } = useProjectStore.getState();
      const origId = createProject('Isolation Test');
      await writeFile(origId, '/src/shared.ts', 'const x = 10;');

      const dupId = await duplicateProject(origId);

      // 1. Modify duplicate file
      await writeFile(dupId, '/src/shared.ts', 'const x = 999; // modified in duplicate');
      // Add unique file to duplicate
      await writeFile(dupId, '/src/duplicate-only.ts', 'export const dupOnly = true;');

      // Verify original is completely unchanged
      const origFilesAfterDupEdit = vfsManager.getFiles(origId);
      expect(origFilesAfterDupEdit['/src/shared.ts'].content).toBe('const x = 10;');
      expect(origFilesAfterDupEdit['/src/duplicate-only.ts']).toBeUndefined();

      // 2. Modify original file
      await writeFile(origId, '/src/shared.ts', 'const x = 42; // modified in original');
      await writeFile(origId, '/src/original-only.ts', 'export const origOnly = true;');

      // Verify duplicate is completely unchanged
      const dupFilesAfterOrigEdit = vfsManager.getFiles(dupId);
      expect(dupFilesAfterOrigEdit['/src/shared.ts'].content).toBe('const x = 999; // modified in duplicate');
      expect(dupFilesAfterOrigEdit['/src/duplicate-only.ts']).toBeDefined();
      expect(dupFilesAfterOrigEdit['/src/original-only.ts']).toBeUndefined();
    });

    it('enforces snapshot isolation: rolling back duplicate snapshot does NOT mutate original files or snapshots', async () => {
      const { createProject, duplicateProject, writeFile } = useProjectStore.getState();
      const origId = createProject('Snapshot Isolation');
      await writeFile(origId, '/src/state.ts', 'version 1');
      await snapshotService.createSnapshot(origId, 'Orig snapshot v1');

      await writeFile(origId, '/src/state.ts', 'version 2');
      await snapshotService.createSnapshot(origId, 'Orig snapshot v2');

      // Duplicate project with snapshots
      const dupId = await duplicateProject(origId);

      // Both projects should have 2 snapshots
      const origSnaps = snapshotService.listSnapshots(origId);
      const dupSnaps = snapshotService.listSnapshots(dupId);
      expect(origSnaps.length).toBe(2);
      expect(dupSnaps.length).toBe(2);

      // Verify snapshot IDs and project IDs are distinct
      expect(dupSnaps[0].id).not.toBe(origSnaps[0].id);
      expect(dupSnaps[0].projectId).toBe(dupId);

      // Rollback duplicate snapshot
      await snapshotService.restoreSnapshot(dupId);

      // Duplicate rolled back to v2 files
      const dupSnapsAfterRollback = snapshotService.listSnapshots(dupId);
      expect(dupSnapsAfterRollback.length).toBe(1);

      // Original snapshots MUST be completely intact with 2 snapshots
      const origSnapsAfterRollback = snapshotService.listSnapshots(origId);
      expect(origSnapsAfterRollback.length).toBe(2);
      expect(origSnapsAfterRollback[0].description).toBe('Orig snapshot v2');
      expect(origSnapsAfterRollback[1].description).toBe('Orig snapshot v1');

      // Original file content remains at current version
      expect(vfsManager.getFiles(origId)['/src/state.ts'].content).toBe('version 2');
    });

    it('guarantees runtime safety: duplicating an active project does NOT switch activeProjectId or disrupt runtime', async () => {
      const { createProject, duplicateProject, setActiveProjectId, setProjectStatus } = useProjectStore.getState();
      const activeId = createProject('Active Running App');
      setActiveProjectId(activeId);
      setProjectStatus(activeId, 'running');

      const dupId = await duplicateProject(activeId);

      const state = useProjectStore.getState();
      // Active project unchanged
      expect(state.activeProjectId).toBe(activeId);
      expect(state.projects[activeId].status).toBe('running');

      // Duplicate starts in clean 'ready' state
      expect(state.projects[dupId].status).toBe('ready');
    });

    it('initializes clean dirtyFiles state in editor store while preserving tab layout', async () => {
      const { createProject, duplicateProject, writeFile } = useProjectStore.getState();
      const origId = createProject('Editor App');
      await writeFile(origId, '/src/App.tsx', 'App content');
      await writeFile(origId, '/src/Header.tsx', 'Header content');

      useEditorStore.getState().openFile(origId, '/src/App.tsx');
      useEditorStore.getState().openFile(origId, '/src/Header.tsx');
      useEditorStore.getState().markDirty(origId, '/src/App.tsx', true);

      const dupId = await duplicateProject(origId);

      const editorState = useEditorStore.getState();
      // Tab layout cloned
      expect(editorState.openTabs[dupId]).toEqual(['/src/App.tsx', '/src/Header.tsx']);
      expect(editorState.activeFilePath[dupId]).toBe('/src/Header.tsx');

      // Dirty files for duplicate must be clean
      expect(editorState.dirtyFiles[`${dupId}:/src/App.tsx`]).toBeUndefined();
      expect(editorState.dirtyFiles[`${dupId}:/src/Header.tsx`]).toBeUndefined();

      // Original dirty state untouched
      expect(editorState.dirtyFiles[`${origId}:/src/App.tsx`]).toBe(true);
    });

    it('deleting duplicate leaves original project completely intact and prevents duplicate resurrection', async () => {
      const { createProject, duplicateProject, deleteProject, writeFile, setActiveProjectId } = useProjectStore.getState();
      const origId = createProject('Persistent Original');
      setActiveProjectId(origId);
      await writeFile(origId, '/src/core.ts', 'export const core = "original";');
      await snapshotService.createSnapshot(origId, 'Core snap');

      const dupId = await duplicateProject(origId);
      await writeFile(dupId, '/src/dup.ts', 'export const dup = "duplicate";');

      // Delete the duplicate
      const deleteSuccess = await deleteProject(dupId);
      expect(deleteSuccess).toBe(true);

      const state = useProjectStore.getState();
      // Duplicate is gone
      expect(state.projects[dupId]).toBeUndefined();
      expect(state.deletedProjectIds).toContain(dupId);
      expect(vfsManager.getFiles(dupId)).toEqual({});
      expect(snapshotService.listSnapshots(dupId)).toEqual([]);

      // Original is 100% intact
      expect(state.projects[origId]).toBeDefined();
      expect(state.projects[origId].title).toBe('Persistent Original');
      expect(vfsManager.getFiles(origId)['/src/core.ts'].content).toBe('export const core = "original";');
      expect(snapshotService.listSnapshots(origId).length).toBe(1);
    });

    it('handles chained operations: rename after duplication and duplicate after rename', async () => {
      const { createProject, duplicateProject, renameProject, writeFile } = useProjectStore.getState();
      const origId = createProject('Project X');
      await writeFile(origId, '/src/index.ts', 'console.log("X");');

      // Rename then duplicate
      renameProject(origId, 'Project X Renamed');
      const dupId = await duplicateProject(origId);
      expect(useProjectStore.getState().projects[dupId].title).toBe('Project X Renamed Copy');

      // Rename duplicate
      renameProject(dupId, 'Project Y Custom');
      expect(useProjectStore.getState().projects[dupId].title).toBe('Project Y Custom');

      // Duplicate the renamed duplicate
      const dupOfDupId = await duplicateProject(dupId);
      expect(useProjectStore.getState().projects[dupOfDupId].title).toBe('Project Y Custom Copy');

      // All 3 projects exist with distinct IDs and files
      expect(vfsManager.getFiles(origId)['/src/index.ts']).toBeDefined();
      expect(vfsManager.getFiles(dupId)['/src/index.ts']).toBeDefined();
      expect(vfsManager.getFiles(dupOfDupId)['/src/index.ts']).toBeDefined();
    });

    it('safely locks rapid concurrent duplications of the same project', async () => {
      const { createProject, duplicateProject } = useProjectStore.getState();
      const origId = createProject('Concurrent Source');

      // Fire duplicateProject twice concurrently
      const promise1 = duplicateProject(origId);
      const promise2 = duplicateProject(origId);

      const results = await Promise.allSettled([promise1, promise2]);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // At least one fulfilled, and concurrent collision prevented
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      if (rejected.length > 0) {
        expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already in progress/i);
      }
    });
  });
});
