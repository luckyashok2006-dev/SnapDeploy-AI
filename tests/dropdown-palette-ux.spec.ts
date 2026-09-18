import { test, expect } from '@playwright/test';

test.describe('Project Dropdown & Command Palette UI/UX Refinement Gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.locator('header').waitFor({ state: 'visible', timeout: 15000 });
  });

  // =========================================================================
  // 1. PROJECT DROPDOWN DISMISSAL & OUTSIDE CLICK
  // =========================================================================
  test('01: Project dropdown dismisses cleanly via outside click and Escape key', async ({ page }) => {
    const trigger = page.locator('button[data-testid="project-dropdown-trigger"]');
    await expect(trigger).toBeVisible({ timeout: 10000 });

    // Open dropdown
    await trigger.click();
    const dropdownMenu = page.locator('div[data-testid="project-dropdown-menu"]');
    await expect(dropdownMenu).toBeVisible();

    // 1. Outside click: Click outside on the workspace
    await page.mouse.click(600, 300);
    await expect(dropdownMenu).toBeHidden({ timeout: 5000 });

    // 2. Escape key dismissal: Re-open and press Escape
    await trigger.click();
    await expect(dropdownMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dropdownMenu).toBeHidden({ timeout: 3000 });
  });

  // =========================================================================
  // 2. NEW PROJECT CREATE / CANCEL UI
  // =========================================================================
  test('02: New Project form supports clean Cancel and Create workflow', async ({ page }) => {
    const trigger = page.locator('button[data-testid="project-dropdown-trigger"]');
    await trigger.click();

    // Click "+ New" button
    const newBtn = page.locator('button[data-testid="dropdown-new-btn"]');
    await expect(newBtn).toBeVisible();
    await newBtn.click();

    // Verify input and buttons appear
    const input = page.locator('input[data-testid="new-project-input"]');
    const cancelBtn = page.locator('button[data-testid="cancel-new-project-btn"]');
    const createBtn = page.locator('button[data-testid="create-new-project-btn"]');

    await expect(input).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    await expect(createBtn).toBeVisible();

    // Initially Create button is disabled when input is empty
    await expect(createBtn).toBeDisabled();

    // Type text then click Cancel
    await input.fill('Temporary Project');
    await cancelBtn.click();

    // Form should be dismissed, dropdown still open
    await expect(input).toBeHidden();
    const dropdownMenu = page.locator('div[data-testid="project-dropdown-menu"]');
    await expect(dropdownMenu).toBeVisible();

    // Re-open "+ New" and successfully create
    await newBtn.click();
    await expect(input).toBeVisible();
    const testProjectTitle = `Refined Project ${Date.now()}`;
    await input.fill(testProjectTitle);
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Dropdown should close automatically upon creation
    await expect(dropdownMenu).toBeHidden({ timeout: 5000 });

    // Active project trigger should now display the new project name
    await expect(trigger).toContainText(testProjectTitle);
  });

  // =========================================================================
  // 3. WHOLE PROJECT ROW CLICK TARGET
  // =========================================================================
  test('03: Entire project row is clickable to select project and close dropdown', async ({ page }) => {
    const trigger = page.locator('button[data-testid="project-dropdown-trigger"]');
    await trigger.click();

    const dropdownMenu = page.locator('div[data-testid="project-dropdown-menu"]');
    await expect(dropdownMenu).toBeVisible();

    // Find all project rows
    const projectRows = page.locator('div[data-testid^="project-row-"]');
    const count = await projectRows.count();
    expect(count).toBeGreaterThan(0);

    // If only 1 project exists, duplicate it first so we have at least 2
    if (count === 1) {
      const dupBtn = page.locator('button[data-testid^="duplicate-project-"]').first();
      await dupBtn.click();
      await page.waitForTimeout(500);
      if (await dropdownMenu.isHidden()) {
        await trigger.click();
        await expect(dropdownMenu).toBeVisible();
      }
    }

    // Now click the project row body of the first row
    const targetRow = page.locator('div[data-testid^="project-row-"]').first();
    const targetTitle = await targetRow.getAttribute('data-project-title');
    
    // Click on the row (not specifically on sub-buttons)
    await targetRow.click();

    // Dropdown must close immediately
    await expect(dropdownMenu).toBeHidden({ timeout: 3000 });

    // The trigger reflects selection
    if (targetTitle) {
      await expect(trigger).toContainText(targetTitle);
    }
  });

  // =========================================================================
  // 4. ACTION BUTTONS CLOSE DROPDOWN & OPEN MODALS
  // =========================================================================
  test('04: Action buttons close dropdown and open dedicated modals cleanly', async ({ page }) => {
    const trigger = page.locator('button[data-testid="project-dropdown-trigger"]');
    const dropdownMenu = page.locator('div[data-testid="project-dropdown-menu"]');

    // Test 1: Import button closes dropdown and opens Import modal
    await trigger.click();
    await expect(dropdownMenu).toBeVisible();
    await page.locator('button[data-testid="dropdown-import-btn"]').click();
    await expect(dropdownMenu).toBeHidden();
    const importModal = page.locator('div[data-testid="import-project-modal"]');
    await expect(importModal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(importModal).toBeHidden();

    // Test 2: GitHub button closes dropdown and opens GitHub modal
    await trigger.click();
    await expect(dropdownMenu).toBeVisible();
    await page.locator('button[data-testid="dropdown-github-btn"]').click();
    await expect(dropdownMenu).toBeHidden();
    const githubModal = page.locator('div[data-testid="github-import-modal"]');
    await expect(githubModal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(githubModal).toBeHidden();

    // Test 3: Rename button closes dropdown and opens Rename modal
    await trigger.click();
    await expect(dropdownMenu).toBeVisible();
    const renameBtn = page.locator('button[data-testid^="rename-project-"]').first();
    await renameBtn.click();
    await expect(dropdownMenu).toBeHidden();
    const renameModal = page.locator('div[data-testid="rename-project-modal"]');
    await expect(renameModal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(renameModal).toBeHidden();

    // Test 4: Delete button closes dropdown and opens Delete modal
    await trigger.click();
    await expect(dropdownMenu).toBeVisible();
    const deleteBtn = page.locator('button[data-testid^="delete-project-"]').first();
    await deleteBtn.click();
    await expect(dropdownMenu).toBeHidden();
    const deleteModal = page.locator('div[data-testid="delete-project-modal"]');
    await expect(deleteModal).toBeVisible();
    const cancelDeleteBtn = page.locator('button[data-testid="cancel-delete-project"]');
    await cancelDeleteBtn.click();
    await expect(deleteModal).toBeHidden();
  });

  // =========================================================================
  // 5. MODAL VIEWPORT-SAFE POSITIONING & INTERNAL SCROLLING
  // =========================================================================
  test('05: Modals are vertically centered, viewport-safe, and do not clip top edge', async ({ page }) => {
    // Set a compact viewport height to rigorously test top boundary protection
    await page.setViewportSize({ width: 1024, height: 600 });
    const trigger = page.locator('button[data-testid="project-dropdown-trigger"]');

    // Open Rename Modal
    await trigger.click();
    await page.locator('button[data-testid^="rename-project-"]').first().click();
    const renameModal = page.locator('div[data-testid="rename-project-modal"]');
    await expect(renameModal).toBeVisible();

    // Inspect the inner modal card geometry
    const card = renameModal.locator('> div');
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Must not be clipped above viewport
      expect(box.y).toBeGreaterThanOrEqual(8);
      // Height must be bounded within viewport
      expect(box.height).toBeLessThanOrEqual(600);
      expect(box.y + box.height).toBeLessThanOrEqual(600);
    }
    await page.keyboard.press('Escape');
    await expect(renameModal).toBeHidden();

    // Open Import Modal and verify viewport safety
    await trigger.click();
    await page.locator('button[data-testid="dropdown-import-btn"]').click();
    const importModal = page.locator('div[data-testid="import-project-modal"]');
    await expect(importModal).toBeVisible();

    const importCard = importModal.locator('> div');
    const importBox = await importCard.boundingBox();
    expect(importBox).not.toBeNull();
    if (importBox) {
      expect(importBox.y).toBeGreaterThanOrEqual(8);
      expect(importBox.y + importBox.height).toBeLessThanOrEqual(600);
    }
    await page.keyboard.press('Escape');
    await expect(importModal).toBeHidden();
  });

  // =========================================================================
  // 6. COMMAND PALETTE OPEN, CLOSE BUTTON, AND ESCAPE
  // =========================================================================
  test('06: Command Palette opens via shortcut/button and closes via Close button and Escape', async ({ page }) => {
    const paletteModal = page.locator('div[data-testid="command-palette-modal"]');

    // 1. Open via TopNavbar Command Palette button
    const navPaletteBtn = page.locator('button[data-testid="nav-command-palette-btn"]');
    await expect(navPaletteBtn).toBeVisible();
    await navPaletteBtn.click();
    await expect(paletteModal).toBeVisible();

    // Verify search input is focused
    const input = page.locator('input[data-testid="command-palette-input"]');
    await expect(input).toBeFocused();

    // 2. Dismiss via visible Close button ("X")
    const closeBtn = page.locator('button[data-testid="palette-close-btn"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(paletteModal).toBeHidden();

    // 3. Open via keyboard shortcut (Control+k or Meta+k)
    await page.keyboard.press('Control+k');
    await expect(paletteModal).toBeVisible();

    // 4. Dismiss via Escape key from root view
    await page.keyboard.press('Escape');
    await expect(paletteModal).toBeHidden();
  });

  // =========================================================================
  // 7. COMMAND PALETTE SUBVIEWS & CONTEXTUAL BACK AFFORDANCE
  // =========================================================================
  test('07: Command Palette category drill-down provides visible Back navigation and subview Escape', async ({ page }) => {
    const paletteModal = page.locator('div[data-testid="command-palette-modal"]');
    await page.locator('button[data-testid="nav-command-palette-btn"]').click();
    await expect(paletteModal).toBeVisible();

    // In root view, Back button is NOT visible
    const backBtn = page.locator('button[data-testid="palette-back-btn"]');
    await expect(backBtn).toHaveCount(0);

    // Verify filter pills are visible in root view
    const runtimeFilterPill = page.locator('button[data-testid="category-filter-runtime"]');
    await expect(runtimeFilterPill).toBeVisible();

    // Click 'Runtime' filter pill to enter category subview
    await runtimeFilterPill.click();

    // Now Back button MUST be visible
    await expect(backBtn).toBeVisible();

    // Pressing Escape while in subview should return to root view, NOT close the palette
    await page.keyboard.press('Escape');
    await expect(backBtn).toHaveCount(0);
    await expect(paletteModal).toBeVisible();
    await expect(runtimeFilterPill).toBeVisible();

    // Re-enter subview and click Back button
    await runtimeFilterPill.click();
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Returned to root view, palette still open
    await expect(backBtn).toHaveCount(0);
    await expect(paletteModal).toBeVisible();

    // Finally, pressing Escape in root view closes the palette
    await page.keyboard.press('Escape');
    await expect(paletteModal).toBeHidden();
  });

  // =========================================================================
  // 8. COMMAND EXECUTION & WORKSPACE NAVIGATION
  // =========================================================================
  test('08: Palette commands execute on click, close palette, and navigate to relevant workspace activities', async ({ page }) => {
    const paletteModal = page.locator('div[data-testid="command-palette-modal"]');
    const navPaletteBtn = page.locator('button[data-testid="nav-command-palette-btn"]');

    // 1. Build Project -> navigates to DEBUG and opens Terminal
    await navPaletteBtn.click();
    await expect(paletteModal).toBeVisible();
    const buildItem = page.locator('button[data-testid="palette-item-act-build"]');
    await expect(buildItem).toBeVisible();
    await buildItem.click();

    // Palette must close immediately
    await expect(paletteModal).toBeHidden();

    // Active activity in rail should be Debug
    const debugRailBtn = page.locator('button[aria-label="Debug workspace"]');
    await expect(debugRailBtn).toBeVisible();

    // 2. Diagnose Active Project -> navigates to DEBUG and opens Diagnostics
    await navPaletteBtn.click();
    await expect(paletteModal).toBeVisible();
    const diagnoseItem = page.locator('button[data-testid="palette-item-act-diagnose"]');
    await expect(diagnoseItem).toBeVisible();
    await diagnoseItem.click();

    await expect(paletteModal).toBeHidden();

    // 3. Inspect AI Patch / Pending Diff -> with no pending patch, navigates to DEBUG/Diagnostics with feedback
    await navPaletteBtn.click();
    await expect(paletteModal).toBeVisible();
    const diffItem = page.locator('button[data-testid="palette-item-act-diff"]');
    await expect(diffItem).toBeVisible();
    await diffItem.click();

    // Palette closes, no empty diff modal opens
    await expect(paletteModal).toBeHidden();
    const diffModal = page.locator('div[data-testid="ai-diff-modal"]');
    await expect(diffModal).toHaveCount(0);

    // 4. Run Dev Server -> navigates to RUN activity
    await navPaletteBtn.click();
    await expect(paletteModal).toBeVisible();
    const runDevItem = page.locator('button[data-testid="palette-item-act-run-dev"]');
    await expect(runDevItem).toBeVisible();
    await runDevItem.click();

    await expect(paletteModal).toBeHidden();
    const runRailBtn = page.locator('button[aria-label="Run workspace"]');
    await expect(runRailBtn).toBeVisible();
  });
});
