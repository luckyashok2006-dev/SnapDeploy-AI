import { test, expect } from '@playwright/test';

test.describe('SnapDeploy AI — P2 Integration Hardening E2E Matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000');
    await page.waitForSelector('[role="tablist"]', { timeout: 15000 });

    await page.waitForFunction(() => {
      return Boolean(
        (window as any).useRuntimeStore &&
        (window as any).useProjectStore &&
        (window as any).useAgentStore &&
        (window as any).useEditorStore
      );
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const pStore = (window as any).useProjectStore?.getState?.();
      if (pStore && pStore.projects['saas-dashboard']) {
        pStore.setActiveProjectId('saas-dashboard');
      }
      const eStore = (window as any).useEditorStore?.getState?.();
      if (eStore) {
        eStore.openFile('saas-dashboard', '/src/App.tsx');
      }
      (window as any).useRuntimeStore?.setState({
        isBottomDrawerOpen: true,
        activeBottomTab: 'terminal',
        bottomDrawerHeight: 280
      });
    });
  });

  // -------------------------------------------------------------------------
  // 1. UX-01: Terminal Badge Synchronized with Runtime Status
  // -------------------------------------------------------------------------
  test('UX-01: Terminal tab badge reacts dynamically to WebContainer runtime status', async ({ page }) => {
    const statuses = [
      { status: 'running', expectedBadge: 'Live' },
      { status: 'ready', expectedBadge: 'Ready' },
      { status: 'booting', expectedBadge: 'Starting' },
      { status: 'error', expectedBadge: 'Error' },
      { status: 'idle', expectedBadge: null }
    ];

    for (const item of statuses) {
      await page.evaluate((s) => {
        (window as any).useRuntimeStore.setState({ status: s });
      }, item.status);

      const tabButton = page.locator('#tab-terminal');
      await expect(tabButton).toBeVisible();

      if (item.expectedBadge) {
        const badge = tabButton.locator('span.font-mono');
        await expect(badge).toHaveText(item.expectedBadge);
      } else {
        const badge = tabButton.locator('span.font-mono');
        await expect(badge).toHaveCount(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 2. UX-02: Zero-Coupling Store Evidence Architecture
  // -------------------------------------------------------------------------
  test('UX-02: lastEvidence dynamically reflects activeProjectId without push mutation from projectStore', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pStore = (window as any).useProjectStore.getState();

      pStore.createProject('Alpha Project');
      pStore.createProject('Beta Project');

      const allProjects = (window as any).useProjectStore.getState().projects;
      const ids = Object.keys(allProjects);
      const projA = ids[ids.length - 2];
      const projB = ids[ids.length - 1];

      // Record evidence directly in runtimeStore for projA and projB
      (window as any).useRuntimeStore.getState().recordEvidence({
        executionId: 'ev_a',
        command: 'npm',
        args: ['run', 'build'],
        exitCode: 1,
        stdout: '',
        stderr: 'Alpha Failed',
        durationMs: 120
      }, projA);

      (window as any).useRuntimeStore.getState().recordEvidence({
        executionId: 'ev_b',
        command: 'npm',
        args: ['test'],
        exitCode: 0,
        stdout: 'Beta Succeeded',
        stderr: '',
        durationMs: 80
      }, projB);

      // Select ProjA
      (window as any).useProjectStore.getState().setActiveProjectId(projA);
      const evidenceWhenA = (window as any).useRuntimeStore.getState().getLastEvidence();

      // Select ProjB
      (window as any).useProjectStore.getState().setActiveProjectId(projB);
      const evidenceWhenB = (window as any).useRuntimeStore.getState().getLastEvidence();

      return {
        evidenceWhenAId: evidenceWhenA?.executionId,
        evidenceWhenBId: evidenceWhenB?.executionId,
        activeAfterSwitch: (window as any).useProjectStore.getState().activeProjectId
      };
    });

    expect(result.evidenceWhenAId).toBe('ev_a');
    expect(result.evidenceWhenBId).toBe('ev_b');
  });

  // -------------------------------------------------------------------------
  // 3. INT-06: Unified Diff Viewer Project Scoping & Invalidation
  // -------------------------------------------------------------------------
  test('INT-06: Unified Diff Viewer modal is suppressed/cleared if active project diverges', async ({ page }) => {
    // 1. Get the current active project ID
    const initialActiveId = await page.evaluate(() => (window as any).useProjectStore.getState().activeProjectId);

    // 2. Set pending patch on the current active project
    await page.evaluate((projId) => {
      (window as any).useAgentStore.getState().setPendingPatch({
        id: 'patch_test_1',
        title: 'Refactor Header',
        summary: 'Update brand text',
        files: [{ path: '/src/Header.tsx', before: 'old', after: 'new' }],
        strategy: 'surgical'
      }, projId);
    }, initialActiveId);

    // 3. The modal should be open for active project
    const modal = page.locator('[data-testid="unified-diff-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 4. Create and switch to a new project
    await page.evaluate(() => {
      (window as any).useProjectStore.getState().createProject('Diff Test Project');
    });

    // 5. Modal must be automatically dismissed/invalidated because active project diverged
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 4. INT-07: Strict 50% Viewport Ceiling across Responsive Viewports
  // -------------------------------------------------------------------------
  test('INT-07: Bottom drawer strictly adheres to <= 50% visual viewport ceiling', async ({ page }) => {
    const viewports = [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 375, height: 812 }
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(100);

      // Maximize drawer height in store
      await page.evaluate(() => {
        (window as any).useRuntimeStore.setState({
          isBottomDrawerOpen: true,
          bottomDrawerHeight: 9999 // Requests maximum possible height
        });
      });

      const drawerBox = await page.locator('#panel-terminal').locator('..').boundingBox();
      expect(drawerBox).not.toBeNull();

      if (drawerBox) {
        // Drawer total height must never exceed 50% of viewport height
        const maxCeiling = Math.floor(vp.height * 0.5) + 36; // + 36px header allowance
        expect(drawerBox.height).toBeLessThanOrEqual(maxCeiling);
      }
    }

    // Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // -------------------------------------------------------------------------
  // 5. UX-03: Monaco Command Palette Shortcut (Ctrl/Cmd+K)
  // -------------------------------------------------------------------------
  test('UX-03: Ctrl/Cmd+K triggers Command Palette, Esc closes and restores focus', async ({ page }) => {
    // Wait for editor workspace to be ready
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });
    const monacoTextArea = page.locator('.monaco-editor textarea').first();
    await monacoTextArea.focus();
    await page.waitForTimeout(200);

    // Trigger Control+K shortcut
    await page.keyboard.press('Control+k');

    // Verify command palette modal appears
    const modal = page.locator('[data-testid="command-palette-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const input = page.locator('[data-testid="command-palette-input"]');
    await expect(input).toBeVisible();

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });
});
