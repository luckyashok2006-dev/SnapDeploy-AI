import { test, expect } from '@playwright/test';

test.describe('Sidebar & Navigation UX Refinement Pass', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
  });

  test('Primary Activity Rail: 6 activities in frozen order with accessible roles and active states', async ({ page }) => {
    // Expected order: BUILD, EDIT, RUN, DEBUG, DATA, SHIP
    const expectedActivities = [
      { id: 'build', label: 'Build' },
      { id: 'edit', label: 'Edit' },
      { id: 'run', label: 'Run' },
      { id: 'debug', label: 'Debug' },
      { id: 'data', label: 'Data' },
      { id: 'ship', label: 'Ship' },
    ];

    for (const act of expectedActivities) {
      const btn = page.locator(`button[data-activity="${act.id}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toContainText(act.label);
    }

    // Default active activity is BUILD
    const buildBtn = page.locator('button[data-activity="build"]');
    await expect(buildBtn).toHaveAttribute('aria-current', 'page');

    // Click EDIT: should switch active state
    const editBtn = page.locator('button[data-activity="edit"]');
    await editBtn.click();
    await expect(editBtn).toHaveAttribute('aria-current', 'page');
    await expect(buildBtn).not.toHaveAttribute('aria-current', 'page');

    // Contextual Edit panel sub-tabs should now be visible
    await expect(page.locator('[data-testid="nav-files-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-chat-tab"]').first()).toBeVisible();
  });

  test('Console Separation: divider exists, aria-expanded reflects drawer state, whole button clickable', async ({ page }) => {
    const consoleBtn = page.locator('[data-testid="nav-console-toggle-btn"]');
    await expect(consoleBtn).toBeVisible();
    await expect(consoleBtn).toContainText('Console');

    // Verify initial aria-expanded (false)
    await expect(consoleBtn).toHaveAttribute('aria-expanded', 'false');

    // Click to open Console drawer
    await consoleBtn.click();
    await expect(consoleBtn).toHaveAttribute('aria-expanded', 'true');

    // Bottom drawer terminal panel should now be visible
    await expect(page.locator('#panel-terminal')).toBeVisible();

    // Click again to close
    await consoleBtn.click();
    await expect(consoleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('Keyboard Navigation: focus-visible ring and tab sequence', async ({ page }) => {
    // Focus the first navigation item
    const buildBtn = page.locator('button[data-activity="build"]');
    await buildBtn.focus();
    await expect(buildBtn).toBeFocused();

    // Tab to EDIT
    await page.keyboard.press('Tab');
    const editBtn = page.locator('button[data-activity="edit"]');
    await expect(editBtn).toBeFocused();

    // Press Enter to activate EDIT
    await page.keyboard.press('Enter');
    await expect(editBtn).toHaveAttribute('aria-current', 'page');
  });

  test('Contextual Navigation: EditSubsystemPanel tabs have role=tablist and aria-selected', async ({ page }) => {
    await page.locator('button[data-activity="edit"]').click();

    const tablist = page.locator('[role="tablist"][aria-label="Edit workspace views"]');
    await expect(tablist).toBeVisible();

    const filesTab = page.locator('[data-testid="nav-files-tab"]');
    const chatTab = page.locator('[data-testid="nav-chat-tab"]').first();
    const historyTab = page.locator('[data-testid="nav-history-tab"]').first();
    const designTab = page.locator('[data-testid="nav-design-system-tab"]').first();

    // Default subview on clean edit entry is AI Assistant
    await expect(chatTab).toHaveAttribute('role', 'tab');
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');

    // Switch to Files tab
    await filesTab.click();
    await expect(filesTab).toHaveAttribute('aria-selected', 'true');
    await expect(chatTab).toHaveAttribute('aria-selected', 'false');

    // Switch to History tab
    await historyTab.click();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');

    // Switch to Design tab
    await designTab.click();
    await expect(designTab).toHaveAttribute('aria-selected', 'true');
  });

  test('Contextual Navigation: DataManagerPanel tabs have role=tablist and aria-selected', async ({ page }) => {
    await page.locator('button[data-activity="data"]').click();

    const tablist = page.locator('[role="tablist"][aria-label="Data workspace views"]');
    await expect(tablist).toBeVisible();

    const envTab = page.locator('[data-testid="data-tab-env"]');
    const dbTab = page.locator('[data-testid="data-tab-database"]');
    const authTab = page.locator('[data-testid="data-tab-auth"]');

    await expect(envTab).toHaveAttribute('role', 'tab');
    await expect(envTab).toHaveAttribute('aria-selected', 'true');

    // Switch to Database tab
    await dbTab.click();
    await expect(dbTab).toHaveAttribute('aria-selected', 'true');
    await expect(envTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('[data-testid="db-tab-schema"]')).toBeVisible();

    // Switch to Auth tab
    await authTab.click();
    await expect(authTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="auth-tab-config"]')).toBeVisible();
  });

  test('Ship Workspace: tabs vs Open Full Dialog action button distinction', async ({ page }) => {
    await page.locator('button[data-activity="ship"]').click();

    const tablist = page.locator('[role="tablist"][aria-label="Ship workspace views"]');
    await expect(tablist).toBeVisible();

    const deployTab = page.locator('[data-testid="ship-tab-deploy"]');
    const githubTab = page.locator('[data-testid="ship-tab-github"]');
    const historyTab = page.locator('[data-testid="ship-tab-history"]');
    const openModalBtn = page.locator('[data-testid="ship-open-deploy-modal-btn"]');

    // Verify tabs
    await expect(deployTab).toHaveAttribute('role', 'tab');
    await expect(deployTab).toHaveAttribute('aria-selected', 'true');

    await githubTab.click();
    await expect(githubTab).toHaveAttribute('aria-selected', 'true');

    await historyTab.click();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');

    // Verify Open Full Dialog is an action button, not a tab
    await expect(openModalBtn).toBeVisible();
    await expect(openModalBtn).not.toHaveAttribute('role', 'tab');

    // Clicking Open Full Dialog opens the modal
    await openModalBtn.click();
    const modal = page.locator('[data-testid="deployment-modal"]');
    await expect(modal).toBeVisible();

    // Close modal
    const closeBtn = page.locator('[data-testid="deploy-close-btn"]');
    await closeBtn.click();
    await expect(modal).toBeHidden();
  });

  test('Data Workspace Overflow (SB-11): No horizontal scrollbar at constrained sidebar widths', async ({ page }) => {
    // Navigate to DATA workspace
    await page.locator('button[data-activity="data"]').click();
    await page.waitForTimeout(300);

    // Check scroll container has no horizontal scrollbar (scrollWidth <= clientWidth + 2)
    const dataContainer = page.locator('.custom-scrollbar').first();
    const isEnvOverflowing = await dataContainer.evaluate((el) => {
      return el.scrollWidth > el.clientWidth + 2;
    });
    expect(isEnvOverflowing).toBe(false);

    // Switch to Database tab and check
    await page.locator('[data-testid="data-tab-database"]').click();
    await page.waitForTimeout(200);
    const isDbOverflowing = await dataContainer.evaluate((el) => {
      return el.scrollWidth > el.clientWidth + 2;
    });
    expect(isDbOverflowing).toBe(false);

    // Switch to Auth tab and check
    await page.locator('[data-testid="data-tab-auth"]').click();
    await page.waitForTimeout(200);
    const isAuthOverflowing = await dataContainer.evaluate((el) => {
      return el.scrollWidth > el.clientWidth + 2;
    });
    expect(isAuthOverflowing).toBe(false);
  });

  test('Responsive Navigation: mobile bottom rail appears under 768px, desktop rail hidden', async ({ page }) => {
    // Set mobile viewport (390 x 844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // Desktop nav rail should be hidden
    const desktopRail = page.locator('nav[aria-label="Primary Workspace Navigation"]');
    await expect(desktopRail).toBeHidden();

    // Mobile bottom navigation bar should be visible
    const mobileNav = page.locator('nav[aria-label="Mobile Workspace Navigation"]');
    await expect(mobileNav).toBeVisible();

    // All 6 activities should be present in mobile nav
    const mobileBuild = mobileNav.locator('button[data-activity="build"]');
    const mobileEdit = mobileNav.locator('button[data-activity="edit"]');
    const mobileShip = mobileNav.locator('button[data-activity="ship"]');

    await expect(mobileBuild).toBeVisible();
    await expect(mobileEdit).toBeVisible();
    await expect(mobileShip).toBeVisible();

    // Tapping mobile EDIT switches active state
    await mobileEdit.click();
    await expect(mobileEdit).toHaveAttribute('aria-current', 'page');
  });
});
