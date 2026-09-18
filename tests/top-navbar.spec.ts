import { test, expect } from '@playwright/test';

test.describe('TopNavbar UX Refinement Gate', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local dev server
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
  });

  test('01: TopNavbar 4-group hierarchy and complete removal of redundant buttons', async ({ page }) => {
    const topNavbar = page.locator('header');
    await expect(topNavbar).toBeVisible({ timeout: 10000 });

    // 1. Verify 4 structural groups exist
    const leftGroup = page.locator('div[data-testid="nav-left-group"]');
    const centerGroup = page.locator('div[data-testid="nav-center-group"]');
    const aiStatusGroup = page.locator('div[data-testid="nav-ai-status-group"]');
    const rightGroup = page.locator('div[data-testid="nav-right-group"]');

    await expect(leftGroup).toBeVisible();
    await expect(centerGroup).toBeVisible();
    await expect(aiStatusGroup).toBeVisible();
    await expect(rightGroup).toBeVisible();

    // 2. Verify Deploy button is completely removed from TopNavbar
    const deployNavBtn = page.locator('header button[data-testid="nav-deploy-btn"]');
    await expect(deployNavBtn).toHaveCount(0);

    // 3. Verify all 7 small utility shortcut buttons are completely removed from TopNavbar
    await expect(page.locator('header button[data-testid="nav-env-btn"]')).toHaveCount(0);
    await expect(page.locator('header button[data-testid="nav-database-btn"]')).toHaveCount(0);
    await expect(page.locator('header button[data-testid="nav-auth-btn"]')).toHaveCount(0);
    await expect(page.locator('header button[data-testid="open-history-btn"]')).toHaveCount(0);
    await expect(page.locator('header button[data-testid="import-zip-btn"]')).toHaveCount(0);
    await expect(page.locator('header button[data-testid="import-github-btn"]')).toHaveCount(0);
    await expect(page.locator('header button[data-testid="command-palette-btn"]')).toHaveCount(0);

    // 4. Verify Run Dev exists in the far-right group and only once
    const runDevBtn = page.locator('div[data-testid="nav-right-group"] button[data-testid="nav-run-dev-btn"]');
    await expect(runDevBtn).toBeVisible();
    await expect(page.locator('button[data-testid="nav-run-dev-btn"]')).toHaveCount(1);
    await expect(runDevBtn).toContainText('Run Dev');
  });

  test('02: Dedicated Command Palette functionality and separation from AI status', async ({ page }) => {
    const centerGroup = page.locator('div[data-testid="nav-center-group"]');
    const commandPaletteBtn = page.locator('button[data-testid="nav-command-palette-btn"]');
    const geminiStatus = page.locator('div[data-testid="nav-gemini-status"]');
    const runtimeBadge = page.locator('div[data-testid="nav-runtime-badge"]');

    // Verify command palette button is inside center group
    await expect(centerGroup.locator('button[data-testid="nav-command-palette-btn"]')).toBeVisible();

    // Verify AI status is NOT inside center group (separated)
    await expect(centerGroup.locator('div[data-testid="nav-gemini-status"]')).toHaveCount(0);

    // Verify telemetry is informational and contains expected text
    await expect(geminiStatus).toBeVisible();
    await expect(geminiStatus).toContainText('Google Gemini');
    await expect(runtimeBadge).toBeVisible();
    await expect(runtimeBadge).toContainText('Runtime:');

    // Verify Command Palette button is interactive and opens Command Palette modal
    await commandPaletteBtn.click();
    const commandPaletteModal = page.locator('div[data-testid="command-palette-modal"]');
    await expect(commandPaletteModal).toBeVisible({ timeout: 5000 });

    // Close command palette with Escape
    await page.keyboard.press('Escape');
    await expect(commandPaletteModal).toBeHidden({ timeout: 5000 });
  });

  test('03: Project context dropdown retains all functionality', async ({ page }) => {
    const projectTrigger = page.locator('button[data-testid="project-dropdown-trigger"]');
    await expect(projectTrigger).toBeVisible();

    // Open dropdown
    await projectTrigger.click();

    // Verify dropdown items (import, github, fault injector, export)
    await expect(page.locator('button[data-testid="dropdown-import-btn"]')).toBeVisible();
    await expect(page.locator('button[data-testid="dropdown-github-btn"]')).toBeVisible();
    await expect(page.locator('text=Fault Injector')).toBeVisible();
    await expect(page.locator('text=Export ZIP')).toBeVisible();

    // Close dropdown
    await page.keyboard.press('Escape');
  });

  test('04: Canonical deployment remains fully functional via SHIP activity', async ({ page }) => {
    // Navigate to SHIP activity from primary workspace rail
    const shipNavBtn = page.locator('button[aria-label="Ship workspace"]');
    await expect(shipNavBtn).toBeVisible({ timeout: 10000 });
    await shipNavBtn.click();

    // Verify ShipManagerPanel rendered with deployment tab
    await expect(page.locator('text=Hosting Provider')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Pre-Flight Checks')).toBeVisible();

    // Verify Open Full Dialog opens the DeploymentModal
    const openFullDialogBtn = page.locator('button[data-testid="ship-open-deploy-modal-btn"]');
    await expect(openFullDialogBtn).toBeVisible();
    await openFullDialogBtn.click();

    const deploymentModal = page.locator('div[data-testid="deployment-modal"]');
    await expect(deploymentModal).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Ready to Deploy').first()).toBeVisible({ timeout: 10000 });

    // Close modal
    const deployCloseBtn = page.locator('button[data-testid="deploy-close-btn"]');
    await expect(deployCloseBtn).toBeVisible({ timeout: 5000 });
    await deployCloseBtn.click();
    await expect(deploymentModal).toBeHidden({ timeout: 5000 });
  });

  test('05: Intentional responsive layout across desktop, tablet, and mobile viewports', async ({ page }) => {
    // 1. Desktop Viewport (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);

    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Check no horizontal overflow on desktop
    const desktopOverflow = await page.evaluate(() => {
      const el = document.querySelector('header');
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(desktopOverflow).toBe(false);

    await expect(page.locator('div[data-testid="nav-left-group"]')).toBeVisible();
    await expect(page.locator('div[data-testid="nav-center-group"]')).toBeVisible();
    await expect(page.locator('div[data-testid="nav-ai-status-group"]')).toBeVisible();
    await expect(page.locator('div[data-testid="nav-right-group"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/navbar-desktop-1440.png' });

    // 2. Tablet Landscape Viewport (1024x768)
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(400);

    const tabletLandscapeOverflow = await page.evaluate(() => {
      const el = document.querySelector('header');
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(tabletLandscapeOverflow).toBe(false);

    await expect(page.locator('div[data-testid="nav-left-group"]')).toBeVisible();
    await expect(page.locator('div[data-testid="nav-center-group"]')).toBeVisible();
    await expect(page.locator('div[data-testid="nav-right-group"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/navbar-tablet-1024.png' });

    // 3. Tablet Portrait Viewport (768x1024)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(400);

    const tabletPortraitOverflow = await page.evaluate(() => {
      const el = document.querySelector('header');
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(tabletPortraitOverflow).toBe(false);

    // AI status is cleanly hidden at < 1024px to prevent horizontal squeeze
    await expect(page.locator('div[data-testid="nav-ai-status-group"]')).toBeHidden();
    await expect(page.locator('div[data-testid="nav-center-group"] button[data-testid="nav-command-palette-btn"]')).toBeVisible();
    await expect(page.locator('div[data-testid="nav-right-group"] button[data-testid="nav-run-dev-btn"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/navbar-tablet-768.png' });

    // 4. Mobile Viewport (390x844 - iPhone 12/13/14)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);

    const mobileOverflow = await page.evaluate(() => {
      const el = document.querySelector('header');
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(mobileOverflow).toBe(false);

    // Brand, project selector, command palette, and Run dev all remain accessible without horizontal overflow
    await expect(page.locator('div[data-testid="nav-left-group"]')).toBeVisible();
    await expect(page.locator('button[data-testid="project-dropdown-trigger"]')).toBeVisible();
    await expect(page.locator('button[data-testid="nav-command-palette-btn"]')).toBeVisible();
    await expect(page.locator('button[data-testid="nav-run-dev-btn"]')).toBeVisible();
    await expect(page.locator('div[data-testid="nav-ai-status-group"]')).toBeHidden();

    // Verify command palette is clickable even on mobile
    await page.locator('button[data-testid="nav-command-palette-btn"]').click();
    await expect(page.locator('div[data-testid="command-palette-modal"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.screenshot({ path: 'test-results/navbar-mobile-390.png' });

    // 5. Small Mobile Viewport (375x667 - iPhone SE)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(400);

    const smallMobileOverflow = await page.evaluate(() => {
      const el = document.querySelector('header');
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(smallMobileOverflow).toBe(false);

    await page.screenshot({ path: 'test-results/navbar-mobile-375.png' });
  });
});
