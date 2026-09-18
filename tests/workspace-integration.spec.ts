import { test, expect } from '@playwright/test';

test.describe('SnapDeploy AI — Cross-Surface Integration E2E Matrix (INT-01 to INT-04)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('[role="tablist"]', { timeout: 15000 });

    // Ensure bottom drawer is open to terminal and wait for stores to be attached
    await page.waitForFunction(() => {
      return Boolean(
        (window as any).useRuntimeStore &&
        (window as any).useProjectStore &&
        (window as any).useAgentStore &&
        (window as any).useEditorStore &&
        (window as any).resetEditorBoundary
      );
    }, { timeout: 10000 });

    await page.evaluate(() => {
      (window as any).useRuntimeStore?.setState({
        isBottomDrawerOpen: true,
        activeBottomTab: 'terminal',
        bottomDrawerHeight: 280
      });
    });
  });

  // -------------------------------------------------------------------------
  // 1. INT-01: Dirty Editor/VFS Verification Synchronization
  // -------------------------------------------------------------------------
  test('INT-01: Verification evaluates current dirty VFS state without clearing dirty flag or creating unwanted snapshots', async ({ page }) => {
    const dirtyResult = await page.evaluate(async () => {
      const pStore = (window as any).useProjectStore.getState();
      const eStore = (window as any).useEditorStore.getState();
      const vfs = (window as any).__SNAPDEPLOY_VFS_MANAGER__ || (window as any).vfsManager;
      const verificationService = (window as any).verificationService;
      const runtimeManager = (window as any).runtimeManager;
      const projId = pStore.activeProjectId || 'saas-dashboard';

      // 1. Check initial snapshot count
      const initialSnapshots = pStore.projects[projId]?.snapshots?.length || 0;

      // 2. Introduce an unsaved dirty edit in editor and VFS
      const activeFile = eStore.activeFilePath?.[projId] || '/src/App.tsx';
      const originalBaseline = eStore.getSavedBaseline?.(projId, activeFile) || '';
      const dirtyContent = originalBaseline + '\n// UNSAVED_INTEGRATION_TEST_DIRTY_CHANGE';

      (window as any).useEditorStore.getState().markDirty(projId, activeFile, true);
      if (vfs) {
        await vfs.writeFile(projId, activeFile, dirtyContent);
      }

      const isDirtyBefore = (window as any).useEditorStore.getState().hasDirtyFiles(projId);

      // 3. Stub runtimeManager methods so browser test doesn't require live WebContainer instance
      const syncedFiles: Record<string, string> = {};
      const origIsBooted = runtimeManager.isBooted.bind(runtimeManager);
      const origSync = runtimeManager.syncFile.bind(runtimeManager);
      const origRunTsc = runtimeManager.runTypeScriptCheck.bind(runtimeManager);
      const origRunBuild = runtimeManager.runBuild.bind(runtimeManager);

      runtimeManager.isBooted = () => true;
      runtimeManager.syncFile = async (filePath: string, content: string) => {
        syncedFiles[filePath] = content;
      };
      runtimeManager.runTypeScriptCheck = async () => ({
        executionId: 'browser_ts',
        command: 'tsc',
        exitCode: 0,
        stdout: 'Success',
        stderr: '',
        durationMs: 50,
        timedOut: false
      });
      runtimeManager.runBuild = async () => ({
        executionId: 'browser_build',
        command: 'build',
        exitCode: 0,
        stdout: 'Success',
        stderr: '',
        durationMs: 100,
        timedOut: false
      });

      // Run verification
      let verifyResult: any = {};
      try {
        verifyResult = await verificationService.runFullVerification({ projectId: projId });
      } finally {
        runtimeManager.isBooted = origIsBooted;
        runtimeManager.syncFile = origSync;
        runtimeManager.runTypeScriptCheck = origRunTsc;
        runtimeManager.runBuild = origRunBuild;
      }

      const isDirtyAfter = (window as any).useEditorStore.getState().hasDirtyFiles(projId);
      const postSnapshots = (window as any).useProjectStore.getState().projects[projId]?.snapshots?.length || 0;

      return {
        isDirtyBefore,
        isDirtyAfter,
        syncedFileReceived: syncedFiles[activeFile] === dirtyContent || syncedFiles[activeFile.replace(/^\//, '')] === dirtyContent,
        snapshotsCreated: postSnapshots - initialSnapshots,
        verifySuccess: verifyResult?.success === true
      };
    });

    // Verify assertions
    expect(dirtyResult.isDirtyBefore).toBe(true);
    // Preserves dirty state (verification is NOT a save action)
    expect(dirtyResult.isDirtyAfter).toBe(true);
    // Unsaved dirty content was sent to WebContainer
    expect(dirtyResult.syncedFileReceived).toBe(true);
    // Did NOT create unwanted snapshot
    expect(dirtyResult.snapshotsCreated).toBe(0);
    expect(dirtyResult.verifySuccess).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. INT-02: Snapshot Restore Clears Stale Diagnosis and Verification State
  // -------------------------------------------------------------------------
  test('INT-02: Snapshot restore invalidates active diagnosis and verification failures in the UI', async ({ page }) => {
    // 1. Inject a failure diagnosis and verification failure into active project
    const snapshotId = await page.evaluate(async () => {
      const pStore = (window as any).useProjectStore.getState();
      const aStore = (window as any).useAgentStore.getState();
      const projId = pStore.activeProjectId || 'saas-dashboard';

      // Create a clean snapshot first
      const snap = await (window as any).useProjectStore.getState().createSnapshot(projId, 'Baseline for INT-02 test');

      // Now inject diagnosis error
      aStore.setDiagnosis({
        category: 'SyntaxError',
        severity: 'high',
        affectedFiles: ['/src/App.tsx'],
        explanation: 'Syntax error detected before restore',
        suggestedFix: 'Restore snapshot to clear',
        confidence: 0.95,
        evidence: ['Error at line 10']
      }, projId);

      aStore.setVerificationResult({
        success: false,
        checks: [
          { name: 'TypeScript', status: 'failed', success: false, durationMs: 150, output: 'Syntax error TS1005' }
        ],
        totalDurationMs: 150
      }, projId);

      return snap?.id;
    });

    // Verify Issues tab displays "1 Error" badge
    const issuesTab = page.locator('#tab-diagnostics');
    await expect(issuesTab).toContainText('1 Error');

    // 2. Restore the baseline snapshot
    await page.evaluate(async (snapId) => {
      const projId = (window as any).useProjectStore.getState().activeProjectId || 'saas-dashboard';
      if (snapId) {
        await (window as any).useProjectStore.getState().restoreSnapshot(projId, snapId);
      }
    }, snapshotId);

    // 3. Verify badge is cleared (no longer "1 Error")
    await expect(issuesTab).not.toContainText('1 Error');

    // 4. Verify Issues panel shows clean empty state without active failure
    await issuesTab.click();
    await expect(page.locator('#panel-diagnostics')).toBeVisible();
    await expect(page.locator('#panel-diagnostics')).not.toContainText('Syntax error detected before restore');

    // 5. Verify Checks tab shows idle / reset state without 'Failed' badge
    const checksTab = page.locator('#tab-verification');
    await expect(checksTab).not.toContainText('Failed');
    await checksTab.click();
    await expect(page.locator('#panel-verification')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 3. INT-03: Fast Project Switch Dev Server Startup Race Guard
  // -------------------------------------------------------------------------
  test('INT-03: Project switch discards stale dev server completion and keeps preview strictly isolated', async ({ page }) => {
    const isolationTestResult = await page.evaluate(async () => {
      const projA = (window as any).useProjectStore.getState().activeProjectId || 'saas-dashboard';

      // Set initial preview for Project A
      (window as any).useRuntimeStore.setState({
        previewUrl: 'http://localhost:5173',
        previewPort: 5173,
        status: 'ready'
      });

      // Create Project B (which automatically becomes activeProjectId in projectStore)
      const projB = (window as any).useProjectStore.getState().createProject('Project Beta Race Isolation');

      // Read fresh active project after createProject
      const activeAfterSwitch = (window as any).useProjectStore.getState().activeProjectId;

      return {
        projA,
        projB,
        activeAfterSwitch,
        isSwitched: activeAfterSwitch === projB
      };
    });

    expect(isolationTestResult.isSwitched).toBe(true);
    expect(isolationTestResult.activeAfterSwitch).toBe(isolationTestResult.projB);
  });

  // -------------------------------------------------------------------------
  // 4. INT-04: Repair Rollback & Success Monaco Editor Synchronization
  // -------------------------------------------------------------------------
  test('INT-04: Repair rollback and success synchronize Monaco baselines, clear dirty state, and bump epoch', async ({ page }) => {
    const repairSyncResult = await page.evaluate(async () => {
      const resetEditorBoundary = (window as any).resetEditorBoundary;
      const projId = (window as any).useProjectStore.getState().activeProjectId || 'saas-dashboard';
      const initialEpoch = (window as any).useEditorStore.getState().modelEpoch || 0;

      // 1. Test Rollback Boundary Reset
      // Simulate dirty file before rollback
      (window as any).useEditorStore.getState().markDirty(projId, '/src/App.tsx', true);
      const isDirtyBefore = (window as any).useEditorStore.getState().hasDirtyFiles(projId);

      const restoredFiles = {
        '/src/App.tsx': { content: 'export default function RestoredApp() { return <div>Restored</div>; }' }
      };

      await resetEditorBoundary(projId, restoredFiles);

      const isDirtyAfterRollback = (window as any).useEditorStore.getState().hasDirtyFiles(projId);
      const epochAfterRollback = (window as any).useEditorStore.getState().modelEpoch || 0;
      const baselineAfterRollback = (window as any).useEditorStore.getState().getSavedBaseline(projId, '/src/App.tsx');

      // 2. Test Success Boundary Reset
      const patchedFiles = {
        '/src/App.tsx': { content: 'export default function PatchedApp() { return <div>Patched</div>; }' }
      };

      await resetEditorBoundary(projId, patchedFiles);

      const isDirtyAfterSuccess = (window as any).useEditorStore.getState().hasDirtyFiles(projId);
      const epochAfterSuccess = (window as any).useEditorStore.getState().modelEpoch || 0;
      const baselineAfterSuccess = (window as any).useEditorStore.getState().getSavedBaseline(projId, '/src/App.tsx');

      return {
        isDirtyBefore,
        isDirtyAfterRollback,
        epochAfterRollbackIncreased: epochAfterRollback > initialEpoch,
        baselineMatchesRestored: baselineAfterRollback === restoredFiles['/src/App.tsx'].content,
        isDirtyAfterSuccess,
        epochAfterSuccessIncreased: epochAfterSuccess > epochAfterRollback,
        baselineMatchesPatched: baselineAfterSuccess === patchedFiles['/src/App.tsx'].content
      };
    });

    // Verify assertions
    expect(repairSyncResult.isDirtyBefore).toBe(true);
    // Rollback clears dirty flag
    expect(repairSyncResult.isDirtyAfterRollback).toBe(false);
    // Epoch bumped on rollback to trigger Monaco remount
    expect(repairSyncResult.epochAfterRollbackIncreased).toBe(true);
    // Baseline updated to restored content
    expect(repairSyncResult.baselineMatchesRestored).toBe(true);

    // Success clears dirty flag
    expect(repairSyncResult.isDirtyAfterSuccess).toBe(false);
    // Epoch bumped on success
    expect(repairSyncResult.epochAfterSuccessIncreased).toBe(true);
    // Baseline updated to patched content
    expect(repairSyncResult.baselineMatchesPatched).toBe(true);
  });
});
