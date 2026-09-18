import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore, seedDemoProjectsIfEmpty } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useAgentStore } from '../src/store/agentStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { ProjectWorkspace } from '../src/types/workspace';

// In-memory runtime filesystem mock
let runtimeFs = new Map<string, string>();

describe('Safe Project Deletion Test Suite (Requirements A - J)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    runtimeFs.clear();

    // Reset stores
    useProjectStore.setState({
      projects: {},
      activeProjectId: '',
      deletedProjectIds: [],
    });

    useEditorStore.setState({
      openTabs: {},
      activeFilePath: {},
      dirtyFiles: {},
    });

    useRuntimeStore.setState({
      status: 'idle',
      previewUrl: null,
      previewPort: null,
      terminalLogs: [],
      lastEvidence: null,
      executionHistory: [],
      pendingEvidencePromise: null,
    });

    useAgentStore.setState({
      generationState: 'idle',
      currentPrompt: '',
      generationEvents: [],
      diagnosis: null,
      pendingPatch: null,
      verificationResult: null,
      repairAttempts: 0,
      isDiagnosing: false,
      isRepairing: false,
      isDiffModalOpen: false,
      lastErrorExplanation: null,
    });

    await vfsManager.resetForTesting();

    // Mock runtime manager and runtime
    const runtime = runtimeManager.getRuntime();
    vi.spyOn(runtime, 'isBooted').mockReturnValue(true);
    vi.spyOn(runtime, 'boot').mockResolvedValue(undefined);

    (runtime as any).replaceProject = vi.fn(async (files: Record<string, string>) => {
      runtimeFs.clear();
      for (const [path, content] of Object.entries(files)) {
        const clean = path.replace(/\\/g, '/').replace(/^\/+/g, '');
        runtimeFs.set(clean, content);
      }
    });

    vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
    vi.spyOn(runtimeManager, 'stopDevServer').mockResolvedValue(undefined);
    vi.spyOn(runtimeManager, 'startDevServer').mockResolvedValue({
      port: 5173,
      url: 'http://localhost:5173',
    });
    vi.spyOn(runtimeManager, 'areDependenciesInstalled').mockResolvedValue(true);
    vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
  });

  // Helper to create a valid project in projectStore & VFS
  async function createTestProject(
    id: string,
    title: string,
    files: Record<string, string> = {},
  ): Promise<ProjectWorkspace> {
    for (const [path, content] of Object.entries(files)) {
      await vfsManager.writeFile(id, path, content);
    }
    const projectFiles = vfsManager.getFiles(id);
    const workspace: ProjectWorkspace = {
      id,
      title,
      description: `Test workspace ${title}`,
      badge: 'Vite + React',
      status: 'ready',
      files: projectFiles,
      openTabs: Object.keys(files),
      activeFilePath: Object.keys(files)[0] || '',
      diagnostics: [],
      fixHistory: [],
    };

    useProjectStore.setState((state) => ({
      projects: {
        ...state.projects,
        [id]: workspace,
      },
      activeProjectId: state.activeProjectId || id,
    }));

    useEditorStore.setState((state) => ({
      openTabs: { ...state.openTabs, [id]: Object.keys(files) },
      activeFilePath: { ...state.activeFilePath, [id]: Object.keys(files)[0] || '' },
      dirtyFiles: { ...state.dirtyFiles, [`${id}:/src/App.tsx`]: false },
    }));

    return workspace;
  }

  it('A. inactive project deletion: Project B deleted while A is active', async () => {
    await createTestProject('proj-a', 'Project A', {
      '/package.json': '{"name":"proj-a"}',
      '/src/App.tsx': 'export const App = () => "Project A";',
    });
    await createTestProject('proj-b', 'Project B', {
      '/package.json': '{"name":"proj-b"}',
      '/src/App.tsx': 'export const App = () => "Project B";',
    });

    useProjectStore.setState({ activeProjectId: 'proj-a' });
    runtimeManager.setCurrentProjectId('proj-a');

    const stopDevSpy = vi.spyOn(runtimeManager, 'stopDevServer');

    // Delete inactive Project B
    const result = await useProjectStore.getState().deleteProject('proj-b');
    expect(result).toBe(true);

    const storeState = useProjectStore.getState();
    expect(storeState.projects['proj-b']).toBeUndefined();
    expect(storeState.projects['proj-a']).toBeDefined();
    expect(storeState.activeProjectId).toBe('proj-a');

    // Verify VFS cleanup for B
    expect(Object.keys(vfsManager.getFiles('proj-b')).length).toBe(0);
    // Verify A remains completely untouched
    expect(Object.keys(vfsManager.getFiles('proj-a')).length).toBe(2);
    expect(vfsManager.getFile('proj-a', '/src/App.tsx')?.content).toBe('export const App = () => "Project A";');

    // Verify editor cleanup for B, intact for A
    const editorState = useEditorStore.getState();
    expect(editorState.openTabs['proj-b']).toBeUndefined();
    expect(editorState.activeFilePath['proj-b']).toBeUndefined();
    expect(editorState.openTabs['proj-a']).toEqual(['/package.json', '/src/App.tsx']);

    // Inactive project deletion should NOT stop active project's dev server
    expect(stopDevSpy).not.toHaveBeenCalled();
    expect(runtimeManager.getCurrentProjectId()).toBe('proj-a');
  });

  it('B. active project deletion: deletes Project A, switches cleanly to Project B', async () => {
    await createTestProject('proj-a', 'Project A', {
      '/package.json': '{"name":"proj-a"}',
      '/src/App.tsx': 'export const App = () => "App A";',
    });
    await createTestProject('proj-b', 'Project B', {
      '/package.json': '{"name":"proj-b"}',
      '/src/App.tsx': 'export const App = () => "App B";',
    });

    useProjectStore.setState({ activeProjectId: 'proj-a' });
    runtimeManager.setCurrentProjectId('proj-a');
    vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(true);
    const stopDevSpy = vi.spyOn(runtimeManager, 'stopDevServer');

    // Set some active editor & agent state
    useAgentStore.setState({
      diagnosis: {
        severity: 'high',
        category: 'typescript',
        explanation: 'Error in proj-a',
        suggestedFix: 'Fix it',
        affectedFiles: ['/src/App.tsx'],
        confidence: 0.9,
      },
      isDiffModalOpen: true,
      repairAttempts: 2,
    });

    // Delete active Project A
    const result = await useProjectStore.getState().deleteProject('proj-a');
    expect(result).toBe(true);

    // Verify runtime stopped dev server for active project
    expect(stopDevSpy).toHaveBeenCalled();

    const storeState = useProjectStore.getState();
    expect(storeState.projects['proj-a']).toBeUndefined();
    expect(storeState.projects['proj-b']).toBeDefined();
    expect(storeState.activeProjectId).toBe('proj-b');

    // Verify agent diagnostics/repair state was cleared
    const agentState = useAgentStore.getState();
    expect(agentState.diagnosis).toBeNull();
    expect(agentState.isDiffModalOpen).toBe(false);
    expect(agentState.repairAttempts).toBe(0);

    // Verify editor state cleared for A
    const editorState = useEditorStore.getState();
    expect(editorState.openTabs['proj-a']).toBeUndefined();
    expect(editorState.activeFilePath['proj-a']).toBeUndefined();
    expect(editorState.openTabs['proj-b']).toBeDefined();

    // Verify VFS cleanup for A
    expect(Object.keys(vfsManager.getFiles('proj-a')).length).toBe(0);
    expect(Object.keys(vfsManager.getFiles('proj-b')).length).toBe(2);
  });

  it('C. only-project deletion: transitions application to valid empty state', async () => {
    await createTestProject('proj-sole', 'Sole Project', {
      '/package.json': '{"name":"sole"}',
      '/src/App.tsx': 'export const App = () => "Sole";',
    });

    useProjectStore.setState({ activeProjectId: 'proj-sole' });
    runtimeManager.setCurrentProjectId('proj-sole');
    vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(true);

    const result = await useProjectStore.getState().deleteProject('proj-sole');
    expect(result).toBe(true);

    const storeState = useProjectStore.getState();
    expect(Object.keys(storeState.projects).length).toBe(0);
    expect(storeState.activeProjectId).toBe('');

    const runtimeState = useRuntimeStore.getState();
    expect(runtimeState.previewUrl).toBeNull();
    expect(runtimeState.status).toBe('idle');
    expect(runtimeManager.getCurrentProjectId()).toBeNull();

    // Verify editor is empty
    const editorState = useEditorStore.getState();
    expect(editorState.openTabs['proj-sole']).toBeUndefined();
    expect(editorState.activeFilePath['proj-sole']).toBeUndefined();
  });

  it('D. multi-project isolation: deleting Project A never affects Project B', async () => {
    await createTestProject('proj-iso-a', 'Project A', {
      '/package.json': '{"name":"iso-a"}',
      '/src/App.tsx': 'App A Content',
      '/src/isolated-a.ts': 'isolated-a',
    });
    await createTestProject('proj-iso-b', 'Project B', {
      '/package.json': '{"name":"iso-b"}',
      '/src/App.tsx': 'App B Content',
      '/src/isolated-b.ts': 'isolated-b',
    });

    // Create snapshots for both
    const snapA = await snapshotService.createSnapshot('proj-iso-a', 'Snap A');
    const snapB = await snapshotService.createSnapshot('proj-iso-b', 'Snap B');

    expect(snapshotService.listSnapshots('proj-iso-a').length).toBe(1);
    expect(snapshotService.listSnapshots('proj-iso-b').length).toBe(1);

    // Delete Project A
    await useProjectStore.getState().deleteProject('proj-iso-a');

    // Verify Project B VFS files are 100% unaltered
    const filesB = vfsManager.getFiles('proj-iso-b');
    expect(Object.keys(filesB).length).toBe(3);
    expect(filesB['/src/App.tsx'].content).toBe('App B Content');
    expect(filesB['/src/isolated-b.ts'].content).toBe('isolated-b');
    expect(filesB['/src/isolated-a.ts']).toBeUndefined();

    // Verify Project B snapshots remain completely intact
    const snapshotsB = snapshotService.listSnapshots('proj-iso-b');
    expect(snapshotsB.length).toBe(1);
    expect(snapshotsB[0].id).toBe(snapB.id);

    // Project A is completely gone
    expect(snapshotService.listSnapshots('proj-iso-a').length).toBe(0);
    expect(Object.keys(vfsManager.getFiles('proj-iso-a')).length).toBe(0);
  });

  it('E. persistent deletion after refresh (Zero Resurrection Contract)', async () => {
    // Simulate demo project
    const demoId = 'saas-dashboard';
    await createTestProject(demoId, 'SaaS Dashboard', {
      '/package.json': '{"name":"saas"}',
      '/src/App.tsx': 'export const App = () => "SaaS";',
    });

    // Delete the demo project
    await useProjectStore.getState().deleteProject(demoId);

    const store = useProjectStore.getState();
    expect(store.projects[demoId]).toBeUndefined();
    expect(store.deletedProjectIds).toContain(demoId);
    expect(Object.keys(vfsManager.getFiles(demoId)).length).toBe(0);

    // Now call seedDemoProjectsIfEmpty() (which runs on app startup)
    await seedDemoProjectsIfEmpty();

    // Verify that the deleted demo project was NOT resurrected in VFS or store
    expect(Object.keys(vfsManager.getFiles(demoId)).length).toBe(0);
    expect(useProjectStore.getState().projects[demoId]).toBeUndefined();
  });

  it('F. snapshot cleanup: all snapshots removed from memory & service', async () => {
    const projId = 'proj-snap-clean';
    await createTestProject(projId, 'Snapshot Test', {
      '/src/index.ts': 'console.log("v1");',
    });

    await snapshotService.createSnapshot(projId, 'Checkpoint 1');
    await vfsManager.writeFile(projId, '/src/index.ts', 'console.log("v2");');
    await snapshotService.createSnapshot(projId, 'Checkpoint 2');

    expect(snapshotService.listSnapshots(projId).length).toBe(2);

    await useProjectStore.getState().deleteProject(projId);

    expect(snapshotService.listSnapshots(projId).length).toBe(0);
    expect(vfsManager.getSnapshots(projId).length).toBe(0);
  });

  it('G. VFS cleanup: all files removed from memory & index', async () => {
    const projId = 'proj-vfs-clean';
    await createTestProject(projId, 'VFS Clean Test', {
      '/src/a.ts': 'a',
      '/src/b.ts': 'b',
      '/public/icon.svg': '<svg></svg>',
    });

    expect(Object.keys(vfsManager.getFiles(projId)).length).toBe(3);

    await useProjectStore.getState().deleteProject(projId);

    expect(Object.keys(vfsManager.getFiles(projId)).length).toBe(0);
    expect(vfsManager.getFile(projId, '/src/a.ts')).toBeNull();
    expect(vfsManager.getFile(projId, '/src/b.ts')).toBeNull();
    expect(vfsManager.getFile(projId, '/public/icon.svg')).toBeNull();
  });

  it('H. runtime cleanup: dev server stopped, WebContainer purged, project ID reset', async () => {
    const projId = 'proj-runtime-clean';
    await createTestProject(projId, 'Runtime Test', {
      '/package.json': '{"name":"rt"}',
    });

    useProjectStore.setState({ activeProjectId: projId });
    runtimeManager.setCurrentProjectId(projId);

    vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(true);
    const stopDevSpy = vi.spyOn(runtimeManager, 'stopDevServer');
    const cleanSpy = vi.spyOn(runtimeManager, 'cleanProject');

    await useProjectStore.getState().deleteProject(projId);

    expect(stopDevSpy).toHaveBeenCalled();
    expect(cleanSpy).toHaveBeenCalledWith(projId);
    expect(runtimeManager.getCurrentProjectId()).toBeNull();
  });

  it('I. duplicate & repeated deletion protection', async () => {
    const projId = 'proj-duplicate-test';
    await createTestProject(projId, 'Duplicate Test', {
      '/package.json': '{"name":"dup"}',
    });

    // 1. First deletion should succeed
    const firstResult = await useProjectStore.getState().deleteProject(projId);
    expect(firstResult).toBe(true);

    // 2. Second immediate deletion should throw "does not exist"
    await expect(useProjectStore.getState().deleteProject(projId)).rejects.toThrow(
      `Project with ID '${projId}' does not exist.`,
    );

    // 3. Attempting to delete non-existent project
    await expect(useProjectStore.getState().deleteProject('ghost-project')).rejects.toThrow(
      "Project with ID 'ghost-project' does not exist.",
    );
  });

  it('J. failure handling: VFS deletion failure preserves consistent state', async () => {
    const projId = 'proj-vfs-fail';
    await createTestProject(projId, 'VFS Fail Test', {
      '/package.json': '{"name":"fail"}',
    });

    // Mock vfsManager.deleteProject to fail
    vi.spyOn(vfsManager, 'deleteProject').mockRejectedValueOnce(
      new Error('Simulated IndexedDB transaction failure'),
    );

    // Deletion should fail and throw
    await expect(useProjectStore.getState().deleteProject(projId)).rejects.toThrow(
      'Simulated IndexedDB transaction failure',
    );

    // Project should NOT be removed from store because step 7 failed
    const storeState = useProjectStore.getState();
    expect(storeState.projects[projId]).toBeDefined();
    expect(storeState.deletedProjectIds).not.toContain(projId);
  });

  it('J2. failure handling: Runtime stopDevServer failure bubbles up without partial corruption', async () => {
    const projId = 'proj-runtime-fail';
    await createTestProject(projId, 'Runtime Fail Test', {
      '/package.json': '{"name":"fail-rt"}',
    });

    useProjectStore.setState({ activeProjectId: projId });
    vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(true);
    vi.spyOn(runtimeManager, 'stopDevServer').mockRejectedValueOnce(
      new Error('Simulated runtime process kill timeout'),
    );

    await expect(useProjectStore.getState().deleteProject(projId)).rejects.toThrow(
      'Simulated runtime process kill timeout',
    );

    // Project should still be in store since step 4 threw
    expect(useProjectStore.getState().projects[projId]).toBeDefined();
    expect(useProjectStore.getState().deletedProjectIds).not.toContain(projId);
  });
});
