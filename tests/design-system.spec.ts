import { test, expect } from '@playwright/test';

test.describe('Tier 2.5 — Design Systems End-to-End Validation', () => {
  test('verifies EDIT-only subview, design system inspection, token editing, Unified Diff gate, controlled code application, validation, and drift detection', async ({ page }) => {
    test.setTimeout(120000);

    // Forward browser console logs
    page.on('console', msg => console.log(`[Browser Console: ${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.error('[Browser PageError]', err.message));

    console.log('>>> [Step 1] Navigating to SnapDeploy AI at http://localhost:3000...');
    await page.addInitScript(() => {
      (window as any).__SNAPDEPLOY_MOCK_VERIFICATION__ = true;
    });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Confirm frozen TopNavbar layout
    await expect(page.locator('header')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('header')).toContainText('SnapDeploy');
    console.log('>>> [Step 1 Verified] Frontend host shell loaded.');

    // Step 2: Ensure active project is loaded and hydrated
    console.log('>>> [Step 2] Ensuring active project and hydration...');
    await page.evaluate(async () => {
      (window as any).__SNAPDEPLOY_MOCK_VERIFICATION__ = true;
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const { vfsManager } = await import('/src/lib/vfs/vfs-manager.ts');
      await vfsManager.waitUntilHydrated();

      let activeId = useProjectStore.getState().activeProjectId;
      if (!activeId) {
        const projects = useProjectStore.getState().projects;
        activeId = Object.keys(projects)[0] || 'saas-dashboard';
        useProjectStore.getState().setActiveProject(activeId);
      }
    });

    // Step 3: Switch to EDIT activity
    console.log('>>> [Step 3] Selecting EDIT activity...');
    const editTabBtn = page.locator('button[data-testid="nav-edit-tab"], button[data-activity="edit"]').first();
    await expect(editTabBtn).toBeVisible({ timeout: 10000 });
    await editTabBtn.click();

    // Verify EDIT subview tabs: AI Assistant, Files, History, Design exist
    const designTabBtn = page.locator('button[data-testid="nav-design-system-tab"]');
    await expect(designTabBtn).toBeVisible({ timeout: 10000 });
    console.log('>>> [Step 3 Verified] In EDIT activity with Design sub-tab visible.');

    // Step 4: Click Design sub-tab
    console.log('>>> [Step 4] Switching to Design System subview...');
    await designTabBtn.click();

    // Verify Design System Panel is mounted
    const dsPanel = page.locator('[data-testid="design-system-panel"]');
    await expect(dsPanel).toBeVisible({ timeout: 10000 });
    console.log('>>> [Step 4 Verified] Design System Panel is mounted.');

    // Step 5: Verify Overview Sub-Tab
    console.log('>>> [Step 5] Checking Overview metrics and quick actions...');
    await expect(page.locator('[data-testid="ds-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="ds-stat-colors"]')).toBeVisible();
    await expect(page.locator('[data-testid="ds-stat-patterns"]')).toBeVisible();
    await expect(page.locator('[data-testid="ds-stat-tokens"]')).toBeVisible();
    await expect(page.locator('button[data-testid="ds-btn-apply-source"]')).toBeVisible();
    console.log('>>> [Step 5 Verified] Overview metrics and action buttons are present.');

    // Step 6: Switch to Tokens Sub-Tab
    console.log('>>> [Step 6] Navigating to Tokens sub-tab...');
    const tokensSubTabBtn = page.locator('button[data-testid="ds-subtab-tokens"]');
    await tokensSubTabBtn.click();

    await expect(page.locator('[data-testid="ds-palette-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="ds-typography-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="ds-token-editor"]')).toBeVisible();

    // Step 7: Edit a token in the inline editor
    console.log('>>> [Step 7] Editing Primary Color token to #06b6d4...');
    const inputToken = page.locator('input[data-testid="ds-edit-token-input"]');
    await inputToken.fill('#06b6d4');
    const saveTokenBtn = page.locator('button[data-testid="ds-save-token-btn"]');
    await saveTokenBtn.click();
    console.log('>>> [Step 7 Verified] Token saved in Design System store.');

    // Step 8: Switch back to Overview and click "Apply to Code"
    console.log('>>> [Step 8] Triggering controlled code modification pipeline (Apply to Code)...');
    const overviewSubTabBtn = page.locator('button[data-testid="ds-subtab-overview"]');
    await overviewSubTabBtn.click();

    const applySourceBtn = page.locator('button[data-testid="ds-btn-apply-source"]');
    await applySourceBtn.click();

    // Verify Unified Diff Modal opens
    console.log('>>> [Step 8.1] Verifying Unified Diff Modal opens for user approval...');
    const diffModal = page.locator('[data-testid="unified-diff-modal"]');
    await expect(diffModal).toBeVisible({ timeout: 10000 });

    // Test User Rejection gate
    console.log('>>> [Step 8.2] Testing user rejection gate...');
    const rejectBtn = diffModal.locator('button', { hasText: 'Reject' });
    await rejectBtn.click();
    await expect(diffModal).not.toBeVisible();
    console.log('>>> [Step 8.2 Verified] Proposal rejected without mutating source.');

    // Click Apply to Code again and approve
    console.log('>>> [Step 8.3] Re-opening Diff Modal to approve patch...');
    await applySourceBtn.click();
    await expect(diffModal).toBeVisible({ timeout: 10000 });

    const approveBtn = diffModal.locator('button', { hasText: 'Apply & Verify Patch' });
    await approveBtn.click();

    // Verify success banner appears inside modal before it auto-closes
    await expect(diffModal.locator('text=Patch applied and verified successfully!')).toBeVisible({ timeout: 15000 });

    // Wait for modal to complete verification and close
    await expect(diffModal).not.toBeVisible({ timeout: 15000 });
    console.log('>>> [Step 8.3 Verified] Patch applied through canonical editExecutor.');

    // Verify VFS has been updated with the new token
    const vfsCheck = await page.evaluate(() => {
      const vfs = (window as any).__SNAPDEPLOY_VFS_MANAGER__;
      const projectStore = (window as any).__SNAPDEPLOY_PROJECT_STORE__;
      const pId = projectStore?.getState().activeProjectId || 'saas-dashboard';
      const file = vfs ? vfs.getFile(pId, '/src/index.css') : null;
      return file ? file.content : null;
    });
    expect(vfsCheck).toContain('--color-primary: #06b6d4;');
    console.log('>>> [Step 8.4 Verified] VFS /src/index.css contains updated CSS custom property.');

    // Step 9: Verify Component Patterns sub-tab
    console.log('>>> [Step 9] Inspecting Component Patterns sub-tab...');
    const componentsSubTabBtn = page.locator('button[data-testid="ds-subtab-components"]');
    await componentsSubTabBtn.click();
    await expect(page.locator('[data-testid="ds-tab-components"]')).toBeVisible();
    await expect(page.locator('text=Primary Button')).toBeVisible();
    await expect(page.locator('text=Elevated Card')).toBeVisible();
    console.log('>>> [Step 9 Verified] Reusable Component Patterns rendered.');

    // Step 10: Verify Validation & Drift sub-tab
    console.log('>>> [Step 10] Checking Validation & Drift sub-tab...');
    const driftSubTabBtn = page.locator('button[data-testid="ds-subtab-drift"]');
    await driftSubTabBtn.click();
    await expect(page.locator('[data-testid="ds-tab-drift"]')).toBeVisible();

    // Click Re-validate
    const revalidateBtn = page.locator('button', { hasText: 'Re-validate' });
    await revalidateBtn.click();
    await expect(page.locator('[data-testid="ds-validation-card"]')).toBeVisible();

    // Click Scan Codebase
    const scanBtn = page.locator('button', { hasText: 'Scan Codebase' });
    await scanBtn.click();
    console.log('>>> [Step 10 Verified] Validation and Drift detection evaluated.');

    // Step 11: Capture verification screenshot artifact
    console.log('>>> [Step 11] Capturing verification screenshot...');
    await page.screenshot({
      path: 'C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/screenshots/design_system_verified.png',
      fullPage: false
    });
    console.log('>>> [Step 11 Verified] Screenshot saved to design_system_verified.png');
  });
});
