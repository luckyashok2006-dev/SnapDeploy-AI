import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { MonacoUndoAdapter } from '../src/lib/editor/monaco-undo-adapter';

describe('SnapDeploy AI — Tier 1 Feature 3: Safe, Project-Scoped Undo / Redo', () => {
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
      dirtyFiles: {},
      savedBaselines: {},
      modelEpoch: 0
    });
  });

  describe('1. Baseline Tracking & Dirty State Contract', () => {
    it('accurately calculates dirty state against saved baseline without blind resets', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { setSavedBaseline, getSavedBaseline, checkIsDirty, markDirty } = useEditorStore.getState();

      const projId = createProject('Baseline Proj');
      const filePath = '/src/App.tsx';
      const initialContent = 'export const App = () => <div>Hello</div>;';

      await writeFile(projId, filePath, initialContent);
      setSavedBaseline(projId, filePath, initialContent);

      expect(getSavedBaseline(projId, filePath)).toBe(initialContent);
      expect(checkIsDirty(projId, filePath, initialContent)).toBe(false);

      // 1. User types in editor
      const editedContent = 'export const App = () => <div>Hello World</div>;';
      await writeFile(projId, filePath, editedContent);
      const isDirtyAfterEdit = checkIsDirty(projId, filePath, editedContent);
      expect(isDirtyAfterEdit).toBe(true);
      markDirty(projId, filePath, isDirtyAfterEdit);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBe(true);

      // 2. User presses Undo back to initial content
      await writeFile(projId, filePath, initialContent);
      const isDirtyAfterUndo = checkIsDirty(projId, filePath, initialContent);
      expect(isDirtyAfterUndo).toBe(false);
      markDirty(projId, filePath, isDirtyAfterUndo);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBe(false);

      // 3. User presses Redo back to edited content
      await writeFile(projId, filePath, editedContent);
      const isDirtyAfterRedo = checkIsDirty(projId, filePath, editedContent);
      expect(isDirtyAfterRedo).toBe(true);
      markDirty(projId, filePath, isDirtyAfterRedo);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBe(true);

      // 4. User saves (Cmd+S / Ctrl+S)
      setSavedBaseline(projId, filePath, editedContent);
      markDirty(projId, filePath, false);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBe(false);
      expect(getSavedBaseline(projId, filePath)).toBe(editedContent);

      // 5. User undos past the save point back to initial content
      await writeFile(projId, filePath, initialContent);
      const isDirtyAfterUndoPastSave = checkIsDirty(projId, filePath, initialContent);
      expect(isDirtyAfterUndoPastSave).toBe(true); // Content diverged from authoritative saved baseline!
      markDirty(projId, filePath, isDirtyAfterUndoPastSave);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBe(true);
    });
  });

  describe('2. MonacoUndoAdapter Operations & Safety', () => {
    it('safely queries canUndo and canRedo from Monaco model without crashing', () => {
      // Test with null editor
      expect(MonacoUndoAdapter.getUndoRedoState(null)).toEqual({ canUndo: false, canRedo: false });

      // Test with editor lacking model
      const mockEditorNoModel = { getModel: () => null } as any;
      expect(MonacoUndoAdapter.getUndoRedoState(mockEditorNoModel)).toEqual({ canUndo: false, canRedo: false });

      // Test with model having canUndo/canRedo methods
      const mockModel = {
        isDisposed: () => false,
        canUndo: () => true,
        canRedo: () => false,
        undo: vi.fn(),
        redo: vi.fn(),
        setValue: vi.fn(),
        getValue: () => 'content',
        uri: { toString: () => 'file:///proj1/src/App.tsx' }
      };
      const mockEditorWithModel = {
        getModel: () => mockModel,
        trigger: vi.fn()
      } as any;

      const state = MonacoUndoAdapter.getUndoRedoState(mockEditorWithModel);
      expect(state.canUndo).toBe(true);
      expect(state.canRedo).toBe(false);

      // Test triggerUndo
      const undoRes = MonacoUndoAdapter.triggerUndo(mockEditorWithModel);
      expect(undoRes).toBe(true);
      expect(mockModel.undo).toHaveBeenCalled();

      // Test triggerRedo
      const redoRes = MonacoUndoAdapter.triggerRedo(mockEditorWithModel);
      expect(redoRes).toBe(true);
      expect(mockModel.redo).toHaveBeenCalled();

      // Test resetModelHistory
      MonacoUndoAdapter.resetModelHistory(mockModel as any, 'fresh content');
      expect(mockModel.setValue).toHaveBeenCalledWith('fresh content');
    });

    it('handles disposed models gracefully', () => {
      const mockDisposedModel = {
        isDisposed: () => true,
        canUndo: () => true,
        canRedo: () => true
      } as any;
      const mockEditor = {
        getModel: () => mockDisposedModel
      } as any;

      expect(MonacoUndoAdapter.getUndoRedoState(mockEditor)).toEqual({ canUndo: false, canRedo: false });
      expect(MonacoUndoAdapter.triggerUndo(mockEditor)).toBe(false);
      expect(MonacoUndoAdapter.triggerRedo(mockEditor)).toBe(false);
    });

    it('disposes only models belonging to the specified project URI', () => {
      const disposeProjA1 = vi.fn();
      const disposeProjA2 = vi.fn();
      const disposeProjB = vi.fn();

      const mockModels = [
        { isDisposed: () => false, uri: { toString: () => 'file:///proj-alpha/src/App.tsx' }, dispose: disposeProjA1 },
        { isDisposed: () => false, uri: { toString: () => 'file:///proj-alpha/src/Header.tsx' }, dispose: disposeProjA2 },
        { isDisposed: () => false, uri: { toString: () => 'file:///proj-beta/src/App.tsx' }, dispose: disposeProjB },
      ];

      const mockMonaco = {
        editor: {
          getModels: () => mockModels
        }
      } as any;

      MonacoUndoAdapter.disposeProjectModels(mockMonaco, 'proj-alpha');

      expect(disposeProjA1).toHaveBeenCalled();
      expect(disposeProjA2).toHaveBeenCalled();
      expect(disposeProjB).not.toHaveBeenCalled();
    });
  });

  describe('3. Project Isolation & Lifecycle Boundaries', () => {
    it('isolates baselines and dirty tracking between different projects', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { setSavedBaseline, getSavedBaseline, checkIsDirty, markDirty } = useEditorStore.getState();

      const projA = createProject('Project A');
      const projB = createProject('Project B');
      const filePath = '/src/App.tsx';

      await writeFile(projA, filePath, 'Content A');
      setSavedBaseline(projA, filePath, 'Content A');

      await writeFile(projB, filePath, 'Content B');
      setSavedBaseline(projB, filePath, 'Content B');

      // Edit in Proj A
      await writeFile(projA, filePath, 'Content A Modified');
      markDirty(projA, filePath, checkIsDirty(projA, filePath, 'Content A Modified'));

      expect(useEditorStore.getState().dirtyFiles[`${projA}:${filePath}`]).toBe(true);
      expect(useEditorStore.getState().dirtyFiles[`${projB}:${filePath}`]).toBeFalsy();
      expect(getSavedBaseline(projA, filePath)).toBe('Content A');
      expect(getSavedBaseline(projB, filePath)).toBe('Content B');
    });

    it('purges baselines and editor state when a project is deleted', async () => {
      const { createProject, writeFile, deleteProject } = useProjectStore.getState();
      const { setSavedBaseline, openFile, markDirty } = useEditorStore.getState();

      const projId = createProject('To Delete');
      await writeFile(projId, '/src/index.ts', 'console.log();');
      setSavedBaseline(projId, '/src/index.ts', 'console.log();');
      openFile(projId, '/src/index.ts');
      markDirty(projId, '/src/index.ts', true);

      expect(useEditorStore.getState().savedBaselines[`${projId}:/src/index.ts`]).toBeDefined();
      expect(useEditorStore.getState().dirtyFiles[`${projId}:/src/index.ts`]).toBe(true);
      expect(useEditorStore.getState().openTabs[projId]).toBeDefined();

      await deleteProject(projId);

      expect(useEditorStore.getState().savedBaselines[`${projId}:/src/index.ts`]).toBeUndefined();
      expect(useEditorStore.getState().dirtyFiles[`${projId}:/src/index.ts`]).toBeUndefined();
      expect(useEditorStore.getState().openTabs[projId]).toBeUndefined();
      expect(useEditorStore.getState().activeFilePath[projId]).toBeUndefined();
    });

    it('clones baselines when duplicating a project without sharing mutable state', async () => {
      const { createProject, writeFile, duplicateProject } = useProjectStore.getState();
      const { setSavedBaseline, getSavedBaseline } = useEditorStore.getState();

      const sourceId = createProject('Source Proj');
      await writeFile(sourceId, '/src/App.tsx', 'Committed Source Content');
      setSavedBaseline(sourceId, '/src/App.tsx', 'Committed Source Content');

      const dupId = await duplicateProject(sourceId, 'Duplicated Proj');
      expect(dupId).toBeDefined();

      // Duplicate receives independent baseline
      expect(getSavedBaseline(dupId, '/src/App.tsx')).toBe('Committed Source Content');

      // Modifying duplicate baseline does not touch source
      setSavedBaseline(dupId, '/src/App.tsx', 'Modified Dup Baseline');
      expect(getSavedBaseline(sourceId, '/src/App.tsx')).toBe('Committed Source Content');
      expect(getSavedBaseline(dupId, '/src/App.tsx')).toBe('Modified Dup Baseline');
    });
  });

  describe('4. Version History Restore & Model Epoch Hard Invariant', () => {
    it('resets baselines, increments modelEpoch, and prevents pre-restore resurrection', async () => {
      const { createProject, writeFile, restoreSnapshot } = useProjectStore.getState();
      const { setSavedBaseline, getSavedBaseline, modelEpoch } = useEditorStore.getState();

      const projId = createProject('Version Restore Test');
      const filePath = '/src/App.tsx';

      // 1. Initial version
      await writeFile(projId, filePath, 'Version 1 Content');
      setSavedBaseline(projId, filePath, 'Version 1 Content');
      const snap1 = await snapshotService.createSnapshot(projId, 'Snapshot 1');

      // 2. User edits to Version 2
      await writeFile(projId, filePath, 'Version 2 Content (Dirty)');
      useEditorStore.getState().markDirty(projId, filePath, true);
      expect(useEditorStore.getState().hasDirtyFiles(projId)).toBe(true);

      const epochBeforeRestore = useEditorStore.getState().modelEpoch;

      // 3. Restore Snapshot 1
      const restoreSuccess = await restoreSnapshot(projId, snap1.id);
      expect(restoreSuccess).toBe(true);

      // 4. Hard invariants verified:
      // A) Model epoch incremented so React re-mounts editor with fresh model
      expect(useEditorStore.getState().modelEpoch).toBeGreaterThan(epochBeforeRestore);

      // B) Dirty files cleared
      expect(useEditorStore.getState().hasDirtyFiles(projId)).toBe(false);

      // C) Baseline updated to restored content
      expect(getSavedBaseline(projId, filePath)).toBe('Version 1 Content');

      // D) Authoritative VFS has restored content
      const vfsFile = vfsManager.getFile(projId, filePath);
      expect(vfsFile?.content).toBe('Version 1 Content');
    });
  });

  describe('5. Multi-File Editing Isolation', () => {
    it('maintains independent baselines and dirty tracking across multiple files in the same project', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { setSavedBaseline, checkIsDirty, markDirty } = useEditorStore.getState();

      const projId = createProject('Multi-File Proj');
      const fileA = '/src/App.tsx';
      const fileB = '/src/Header.tsx';

      await writeFile(projId, fileA, 'Original App');
      await writeFile(projId, fileB, 'Original Header');

      setSavedBaseline(projId, fileA, 'Original App');
      setSavedBaseline(projId, fileB, 'Original Header');

      // Edit File A only
      await writeFile(projId, fileA, 'Modified App');
      markDirty(projId, fileA, checkIsDirty(projId, fileA, 'Modified App'));

      expect(useEditorStore.getState().dirtyFiles[`${projId}:${fileA}`]).toBe(true);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${fileB}`]).toBeFalsy();

      // Undo File A
      await writeFile(projId, fileA, 'Original App');
      markDirty(projId, fileA, checkIsDirty(projId, fileA, 'Original App'));

      expect(useEditorStore.getState().dirtyFiles[`${projId}:${fileA}`]).toBe(false);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${fileB}`]).toBeFalsy();
    });
  });

  describe('6. Rapid Sequential Edits & VFS Write-Through', () => {
    it('synchronizes intermediate edits and undos to authoritative VFS without race conditions', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Rapid Edit Proj');
      const filePath = '/src/counter.ts';

      await writeFile(projId, filePath, 'count = 0;');

      const steps = ['count = 1;', 'count = 2;', 'count = 3;', 'count = 4;', 'count = 5;'];
      for (const step of steps) {
        await writeFile(projId, filePath, step);
        expect(vfsManager.getFile(projId, filePath)?.content).toBe(step);
      }

      // Simulate rapid undos
      const undoSteps = ['count = 4;', 'count = 3;', 'count = 2;', 'count = 1;', 'count = 0;'];
      for (const step of undoSteps) {
        await writeFile(projId, filePath, step);
        expect(vfsManager.getFile(projId, filePath)?.content).toBe(step);
      }

      expect(vfsManager.getFile(projId, filePath)?.content).toBe('count = 0;');
    });
  });
});
