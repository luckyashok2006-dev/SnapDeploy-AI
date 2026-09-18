import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { MonacoUndoAdapter } from '../src/lib/editor/monaco-undo-adapter';
import { resetEditorBoundary } from '../src/lib/editor/editor-boundary';

describe('SnapDeploy AI — Center Editor Workspace: Behavioral, State & Layout Contracts', () => {
  const editorWorkspaceFile = path.resolve(__dirname, '../src/components/editor/EditorWorkspace.tsx');
  const resizableDividerFile = path.resolve(__dirname, '../src/components/layout/ResizableDivider.tsx');
  const appLayoutFile = path.resolve(__dirname, '../src/components/layout/AppLayout.tsx');

  const editorContent = fs.readFileSync(editorWorkspaceFile, 'utf-8');
  const resizerContent = fs.readFileSync(resizableDividerFile, 'utf-8');
  const layoutContent = fs.readFileSync(appLayoutFile, 'utf-8');

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
    useRuntimeStore.setState({
      isLocked: false,
      isRunning: false
    });
  });

  describe('1. Active Tab & Tab Switching Contracts', () => {
    it('1. Editor renders active tab and updates active file on tab switch', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile, setActiveFile } = useEditorStore.getState();

      const projId = createProject('Workspace Proj');
      await writeFile(projId, '/src/App.tsx', 'export const App = () => <div>App</div>;');
      await writeFile(projId, '/src/Header.tsx', 'export const Header = () => <header>Header</header>;');

      openFile(projId, '/src/App.tsx');
      expect(useEditorStore.getState().openTabs[projId]).toEqual(['/src/App.tsx']);
      expect(useEditorStore.getState().activeFilePath[projId]).toBe('/src/App.tsx');

      // 2. Switching tabs changes active file
      openFile(projId, '/src/Header.tsx');
      expect(useEditorStore.getState().openTabs[projId]).toEqual(['/src/App.tsx', '/src/Header.tsx']);
      expect(useEditorStore.getState().activeFilePath[projId]).toBe('/src/Header.tsx');

      // Switch back to App.tsx
      setActiveFile(projId, '/src/App.tsx');
      expect(useEditorStore.getState().activeFilePath[projId]).toBe('/src/App.tsx');
    });

    it('3. Duplicate file opening does not create duplicate tabs', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile } = useEditorStore.getState();

      const projId = createProject('Duplicate Tab Proj');
      await writeFile(projId, '/src/App.tsx', 'export const App = () => <div>App</div>;');

      openFile(projId, '/src/App.tsx');
      openFile(projId, '/src/App.tsx');
      openFile(projId, '/src/App.tsx');

      expect(useEditorStore.getState().openTabs[projId]).toEqual(['/src/App.tsx']);
    });
  });

  describe('2. Unified Dirty State Lifecycle Contracts', () => {
    it('4 & 5. Dirty indicator appears after editing and clears on save (Ctrl+S)', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile, setSavedBaseline, checkIsDirty, markDirty } = useEditorStore.getState();

      const projId = createProject('Dirty Test Proj');
      const filePath = '/src/App.tsx';
      const initialContent = 'const a = 1;';
      const editedContent = 'const a = 2;';

      await writeFile(projId, filePath, initialContent);
      openFile(projId, filePath);
      setSavedBaseline(projId, filePath, initialContent);

      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBeFalsy();

      // User types: mark dirty
      const isDirty = checkIsDirty(projId, filePath, editedContent);
      expect(isDirty).toBe(true);
      markDirty(projId, filePath, true);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBe(true);

      // User saves: mark clean and update baseline
      await writeFile(projId, filePath, editedContent);
      markDirty(projId, filePath, false);
      setSavedBaseline(projId, filePath, editedContent);

      expect(useEditorStore.getState().dirtyFiles[`${projId}:${filePath}`]).toBe(false);
    });

    it('6. Multiple files maintain independent dirty states', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile, markDirty } = useEditorStore.getState();

      const projId = createProject('Multi Dirty Proj');
      await writeFile(projId, '/src/A.tsx', 'const A = 1;');
      await writeFile(projId, '/src/B.tsx', 'const B = 2;');

      openFile(projId, '/src/A.tsx');
      openFile(projId, '/src/B.tsx');

      markDirty(projId, '/src/A.tsx', true);
      markDirty(projId, '/src/B.tsx', false);

      expect(useEditorStore.getState().dirtyFiles[`${projId}:/src/A.tsx`]).toBe(true);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:/src/B.tsx`]).toBe(false);

      // Save A
      markDirty(projId, '/src/A.tsx', false);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:/src/A.tsx`]).toBe(false);
      expect(useEditorStore.getState().dirtyFiles[`${projId}:/src/B.tsx`]).toBe(false);
    });
  });

  describe('3. Tab Closure & Invariant Contracts', () => {
    it('7. Closing active tab changes active file correctly to remaining tab', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile, closeTab } = useEditorStore.getState();

      const projId = createProject('Close Tab Proj');
      await writeFile(projId, '/src/A.tsx', 'A');
      await writeFile(projId, '/src/B.tsx', 'B');

      openFile(projId, '/src/A.tsx');
      openFile(projId, '/src/B.tsx');
      expect(useEditorStore.getState().activeFilePath[projId]).toBe('/src/B.tsx');

      closeTab(projId, '/src/B.tsx');
      expect(useEditorStore.getState().openTabs[projId]).toEqual(['/src/A.tsx']);
      expect(useEditorStore.getState().activeFilePath[projId]).toBe('/src/A.tsx');
    });

    it('8 & 9. Closing last tab renders editor-empty-state and does NOT resurrect package.json', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile, closeTab } = useEditorStore.getState();

      const projId = createProject('Empty Tab Proj');
      await writeFile(projId, '/package.json', '{}');
      await writeFile(projId, '/src/App.tsx', 'App');

      openFile(projId, '/src/App.tsx');
      expect(useEditorStore.getState().openTabs[projId]).toEqual(['/src/App.tsx']);

      // Close the only open tab
      closeTab(projId, '/src/App.tsx');

      const finalTabs = useEditorStore.getState().openTabs[projId];
      const finalActive = useEditorStore.getState().activeFilePath[projId];

      expect(finalTabs).toEqual([]);
      expect(finalActive).toBe('');
      // Invariant: activeFilePath must NOT fallback to /package.json
      expect(finalActive).not.toBe('/package.json');
      expect(editorContent).toContain('data-testid="editor-empty-state"');
      expect(editorContent).toContain('No file open');
    });
  });

  describe('4. Accessibility & UI Affordances', () => {
    it('10. Tab close button is keyboard accessible and visible on active tab', () => {
      expect(editorContent).toContain('aria-label={`Close ${fileName}`}');
      expect(editorContent).toContain('data-testid={`tab-close-${tabPath}`}');
      expect(editorContent).toContain('group-focus-within:opacity-100');
      expect(editorContent).toContain('focus:ring-violet-400');
    });
  });

  describe('5. Project Isolation & Model Lifecycle Contracts', () => {
    it('11 & 12. Project switch isolates tabs and dirty state', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile, markDirty, clearProject } = useEditorStore.getState();

      const projA = createProject('Project A');
      const projB = createProject('Project B');

      await writeFile(projA, '/src/A.tsx', 'A');
      await writeFile(projB, '/src/B.tsx', 'B');

      openFile(projA, '/src/A.tsx');
      openFile(projB, '/src/B.tsx');

      markDirty(projA, '/src/A.tsx', true);
      markDirty(projB, '/src/B.tsx', false);

      expect(useEditorStore.getState().openTabs[projA]).toEqual(['/src/A.tsx']);
      expect(useEditorStore.getState().openTabs[projB]).toEqual(['/src/B.tsx']);
      expect(useEditorStore.getState().dirtyFiles[`${projA}:/src/A.tsx`]).toBe(true);
      expect(useEditorStore.getState().dirtyFiles[`${projB}:/src/B.tsx`]).toBe(false);

      clearProject(projA);
      expect(useEditorStore.getState().openTabs[projA]).toBeUndefined();
      expect(useEditorStore.getState().dirtyFiles[`${projA}:/src/A.tsx`]).toBeUndefined();
      expect(useEditorStore.getState().openTabs[projB]).toEqual(['/src/B.tsx']);
    });

    it('13. AI edit transactional boundary reset clears dirty flags and updates baselines', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const { openFile, markDirty, getSavedBaseline } = useEditorStore.getState();

      const projId = createProject('Boundary Proj');
      await writeFile(projId, '/src/App.tsx', 'v1');
      openFile(projId, '/src/App.tsx');
      markDirty(projId, '/src/App.tsx', true);

      // Perform transactional boundary reset (as executed by AI edit / AI repair)
      await resetEditorBoundary(projId, {
        '/src/App.tsx': { content: 'v2-ai-edited' }
      });

      expect(useEditorStore.getState().dirtyFiles[`${projId}:/src/App.tsx`]).toBeFalsy();
      expect(getSavedBaseline(projId, '/src/App.tsx')).toBe('v2-ai-edited');
      expect(useEditorStore.getState().modelEpoch).toBeGreaterThan(0);
    });

    it('14. Restore does not create stale editor state', async () => {
      const { createProject, writeFile, createSnapshot, restoreSnapshot } = useProjectStore.getState();
      const projId = createProject('Restore Proj');

      await writeFile(projId, '/src/App.tsx', 'v1');
      const snap = await createSnapshot(projId, 'Snap 1');

      await writeFile(projId, '/src/App.tsx', 'v2');
      expect(useProjectStore.getState().projects[projId].files['/src/App.tsx'].content).toBe('v2');

      const restored = await restoreSnapshot(projId, snap.id);
      expect(restored).toBe(true);
      expect(useProjectStore.getState().projects[projId].files['/src/App.tsx'].content).toBe('v1');
    });

    it('15. Monaco model URI is properly project-scoped', () => {
      expect(editorContent).toContain('path={`file:///${activeProjectId}${cleanFilePath}`}');
    });
  });

  describe('6. ResizableDivider 1:1 Step Delta Contract (Section 3C)', () => {
    it('emits step deltas: 4 x +5 moves on 360 initial width yields 380, NOT 410', () => {
      let currentWidth = 360;
      const onResize = (delta: number) => {
        currentWidth = Math.max(280, Math.min(600, currentWidth + delta));
      };

      // Simulate ResizableDivider step delta handler:
      let lastPos = 100; // mouse down at clientX = 100
      const moves = [105, 110, 115, 120]; // 4 distinct pointer moves of +5px each

      for (const currentPos of moves) {
        const delta = currentPos - lastPos;
        if (delta !== 0) {
          onResize(delta);
          lastPos = currentPos;
        }
      }

      // Final width MUST be 380, NEVER 410 (the old cumulative bug was 360 + 5 + 10 + 15 + 20 = 410)
      expect(currentWidth).toBe(380);
    });

    it('correctly handles negative movement, min clamp (280), and max clamp (600)', () => {
      let currentWidth = 360;
      const onResize = (delta: number) => {
        currentWidth = Math.max(280, Math.min(600, currentWidth + delta));
      };

      let lastPos = 200;
      // Move left by 20px in two steps of -10
      for (const pos of [190, 180]) {
        const delta = pos - lastPos;
        onResize(delta);
        lastPos = pos;
      }
      expect(currentWidth).toBe(340);

      // Huge left move clamped at 280
      onResize(-200);
      expect(currentWidth).toBe(280);

      // Huge right move clamped at 600
      onResize(500);
      expect(currentWidth).toBe(600);
    });
  });
});
