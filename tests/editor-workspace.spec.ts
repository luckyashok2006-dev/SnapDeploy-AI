import { test, expect } from '@playwright/test';

test.describe('SnapDeploy AI — Center Editor Workspace: Playwright Verification Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('header').waitFor({ state: 'visible', timeout: 15000 });
  });

  test('01: Responsive Matrix — Protects 500px when available, maximum available width on narrow viewports', async ({ page }) => {
    // Switch to edit activity
    await page.keyboard.press('Alt+2');
    await page.waitForTimeout(200);

    const viewports = [
      { width: 1440, height: 900, is500Feasible: true, label: '1440x900 (Desktop)' },
      { width: 1280, height: 800, is500Feasible: true, label: '1280x800 (Desktop)' },
      { width: 1200, height: 800, is500Feasible: true, label: '1200x800 (Intermediate)' },
      { width: 1100, height: 768, is500Feasible: true, label: '1100x768 (Intermediate)' },
      { width: 1024, height: 768, is500Feasible: true, label: '1024x768 (Tablet Landscape)' },
      { width: 900, height: 768, is500Feasible: true, label: '900x768 (Intermediate)' },
      // At 768x1024, fixed chrome (Nav 56px + Sidebar 260px + Divider 5px + Recovery strip 44px = 365px)
      // leaves 403px available; 500px is not physically feasible without destroying the tablet layout.
      { width: 768, height: 1024, is500Feasible: false, label: '768x1024 (Tablet Portrait)' },
      // Mobile viewports give maximum available full width (Nav and Sidebar hidden)
      { width: 390, height: 844, is500Feasible: false, label: '390x844 (Mobile)' },
      { width: 375, height: 812, is500Feasible: false, label: '375x812 (Mobile)' },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(100);

      const editorSection = page.locator('section[aria-label="Code Editor Workspace"]');
      await expect(editorSection).toBeVisible();

      const box = await editorSection.boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;

      // Geometry-aware layout inspection: determine total non-editor chrome width and actual available space
      const layoutMetrics = await page.evaluate(() => {
        const editor = document.querySelector('section[aria-label="Code Editor Workspace"]');
        if (!editor || !editor.parentElement) {
          return { availableWidth: window.innerWidth, chromeWidth: 0 };
        }
        const parent = editor.parentElement;
        let nonEditorWidth = 0;
        for (const child of Array.from(parent.children)) {
          if (child !== editor) {
            const rect = child.getBoundingClientRect();
            nonEditorWidth += rect.width;
          }
        }
        const containerWidth = parent.clientWidth || window.innerWidth;
        return {
          availableWidth: containerWidth - nonEditorWidth,
          chromeWidth: nonEditorWidth
        };
      });

      // 1. When 500px is physically feasible, protect ~500px as intended
      if (vp.is500Feasible) {
        expect(box.width).toBeGreaterThanOrEqual(500);
      } else {
        // 2. When 500px is not feasible, give the editor the maximum width actually available after fixed UI chrome
        // Allow at most 2px practical tolerance for fractional sub-pixel rounding
        expect(box.width).toBeGreaterThanOrEqual(Math.floor(layoutMetrics.availableWidth) - 2);

        // 3. At 768px tablet portrait, explicitly guard against the historical crushed states (~106px / ~356px)
        if (vp.width === 768) {
          expect(box.width).toBeGreaterThan(360);
          expect(Math.abs(box.width - layoutMetrics.availableWidth)).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test('02: Activity Coverage across All 6 Shell Activities & Viewports', async ({ page }) => {
    const activities = [
      { id: 'build', key: '1' },
      { id: 'edit', key: '2' },
      { id: 'run', key: '3' },
      { id: 'debug', key: '4' },
      { id: 'data', key: '5' },
      { id: 'ship', key: '6' }
    ];

    const viewports = [
      { width: 1440, height: 900, is500Feasible: true },
      { width: 1280, height: 800, is500Feasible: true },
      { width: 1024, height: 768, is500Feasible: true },
      { width: 768, height: 1024, is500Feasible: false }
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(100);

      for (const act of activities) {
        await page.keyboard.press(`Alt+${act.key}`);
        await page.waitForTimeout(100);

        const editorSection = page.locator('section[aria-label="Code Editor Workspace"]');
        if (await editorSection.isVisible()) {
          const box = await editorSection.boundingBox();
          expect(box).not.toBeNull();
          if (box) {
            if (vp.is500Feasible) {
              // 1. Where 500px is feasible, enforce 500px protection across all activities
              expect(box.width).toBeGreaterThanOrEqual(500);
            } else {
              // 2. Where 500px is not feasible (768px), inspect layout geometry and verify maximum available width
              const layoutMetrics = await page.evaluate(() => {
                const editor = document.querySelector('section[aria-label="Code Editor Workspace"]');
                if (!editor || !editor.parentElement) return { availableWidth: window.innerWidth };
                let nonEditorWidth = 0;
                for (const child of Array.from(editor.parentElement.children)) {
                  if (child !== editor) nonEditorWidth += child.getBoundingClientRect().width;
                }
                return { availableWidth: (editor.parentElement.clientWidth || window.innerWidth) - nonEditorWidth };
              });

              // Receives maximum available width (within ±2px layout rounding tolerance)
              expect(box.width).toBeGreaterThanOrEqual(Math.floor(layoutMetrics.availableWidth) - 2);
              // Explicitly guard against historical crushed states (~106px / ~356px) across all activities
              expect(box.width).toBeGreaterThan(360);
            }
          }
        }
      }
    }
  });

  test('03: Dirty-State Playwright Verification — Typing, Saving, and Multi-File Isolation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press('Alt+2');
    await page.waitForTimeout(200);

    const appTab = page.locator('div[data-testid="tab-/src/App.tsx"]');
    await expect(appTab).toBeVisible();

    // A & B: Confirm initially clean
    const appDirtyDot = page.locator('span[data-testid="tab-dirty-indicator-/src/App.tsx"]');
    await expect(appDirtyDot).toHaveCount(0);

    // C & D: Focus editor and type a change
    await page.click('.monaco-editor');
    await page.keyboard.press('End');
    await page.keyboard.type(' // automated verification test');
    await page.waitForTimeout(200);

    // Assert dirty indicator appears
    await expect(appDirtyDot).toBeVisible();

    // E: Save with Ctrl+S
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyS');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // Assert saved badge appears and dirty indicator clears
    const savedBadge = page.locator('text=Saved (⌘S)');
    await expect(savedBadge).toBeVisible();
    await expect(appDirtyDot).toHaveCount(0);

    // G & H: Open and modify InvoiceList.tsx
    const invoiceTab = page.locator('div[data-testid="tab-/src/components/InvoiceList.tsx"]');
    await expect(invoiceTab).toBeVisible();
    await invoiceTab.click();
    await page.waitForTimeout(200);

    await page.click('.monaco-editor');
    await page.keyboard.press('End');
    await page.keyboard.type(' // modification to file B');
    await page.waitForTimeout(200);

    // I: Assert InvoiceList dirty indicator exists
    const invoiceDirtyDot = page.locator('span[data-testid="tab-dirty-indicator-/src/components/InvoiceList.tsx"]');
    await expect(invoiceDirtyDot).toBeVisible();

    // J: Assert App.tsx dirty indicator remains completely absent
    await expect(appDirtyDot).toHaveCount(0);
  });

  test('04: Final-Tab Invariant — Empty state rendered, no ghost file, activeFilePath cleared', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press('Alt+2');
    await page.waitForTimeout(200);

    const closeButtons = page.locator('button[data-testid^="tab-close-"]');
    let count = await closeButtons.count();

    while (count > 0) {
      await closeButtons.first().click();
      await page.waitForTimeout(80);
      count = await page.locator('button[data-testid^="tab-close-"]').count();
    }

    // 1. Assert true empty state is visible with exact copy
    const emptyState = page.locator('div[data-testid="editor-empty-state"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('No file open');
    await expect(emptyState).toContainText('Select a file from the Explorer to start editing');

    // 2. Assert previous file's editor model/content surface does NOT remain visible
    const monacoEditor = page.locator('.monaco-editor');
    await expect(monacoEditor).toHaveCount(0);

    // 3. Assert activeFilePath is empty string and no fallback file is selected
    const activeFileState = await page.evaluate(() => {
      const editorStore = (window as any).useEditorStore?.getState();
      const projStore = (window as any).useProjectStore?.getState();
      const activeProj = projStore ? projStore.activeProjectId : '';
      return editorStore ? editorStore.activeFilePath[activeProj] : null;
    });

    expect(activeFileState).toBe('');
  });

  test('05: Tab Close Accessibility — Keyboard navigation, focus visibility, activation via Enter', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.keyboard.press('Alt+2');
    await page.waitForTimeout(200);

    const firstTab = page.locator('div[data-testid^="tab-"]').first();
    await expect(firstTab).toBeVisible();

    const closeBtn = firstTab.locator('button[data-testid^="tab-close-"]');
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toHaveAttribute('aria-label', /Close /);

    // Focus the close button directly using keyboard
    await closeBtn.focus();
    await expect(closeBtn).toBeFocused();

    // Verify focus ring styling is applied
    const classAttr = await closeBtn.getAttribute('class');
    expect(classAttr).toContain('focus:ring-violet-400');

    // Count tabs before keyboard activation
    const tabsBefore = await page.locator('div[data-testid^="tab-"]').count();

    // Press Enter to activate close button
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    // Assert tab closed
    const tabsAfter = await page.locator('div[data-testid^="tab-"]').count();
    expect(tabsAfter).toBe(tabsBefore - 1);
  });

  test('06: Resizer 1:1 Delta Verification — +20px drag, negative drag, min/max bounds', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('Alt+2');
    await page.waitForTimeout(200);

    const aside = page.locator('aside[aria-label="Contextual Subsystem Workspace"]');
    const initialBox = await aside.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;

    const resizer = page.locator('div[title="Drag to resize panel"]').first();
    await expect(resizer).toBeVisible();
    const resizerBox = await resizer.boundingBox();
    expect(resizerBox).not.toBeNull();

    // 1. Known drag sequence: +5, +5, +5, +5 (+20px total)
    let startX = resizerBox!.x + resizerBox!.width / 2;
    let startY = resizerBox!.y + resizerBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 5, startY);
    await page.mouse.move(startX + 10, startY);
    await page.mouse.move(startX + 15, startY);
    await page.mouse.move(startX + 20, startY);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const postBox = await aside.boundingBox();
    expect(postBox).not.toBeNull();
    const delta = postBox!.width - initialWidth;
    // Must be +20px (±2px allowance for layout rounding), NOT +50px runaway acceleration
    expect(Math.round(delta)).toBe(20);

    // 2. Negative movement: drag left -20px
    const currentResizerBox = (await resizer.boundingBox())!;
    startX = currentResizerBox.x + currentResizerBox.width / 2;
    startY = currentResizerBox.y + currentResizerBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 10, startY);
    await page.mouse.move(startX - 20, startY);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const returnedBox = (await aside.boundingBox())!;
    expect(Math.round(returnedBox.width)).toBe(Math.round(initialWidth));

    // 3. Min bound clamp (280px)
    await page.mouse.move(startX - 20, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 300, startY);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const minBox = (await aside.boundingBox())!;
    expect(Math.round(minBox.width)).toBe(280);

    // 4. Max bound clamp (600px)
    const minResizerBox = (await resizer.boundingBox())!;
    startX = minResizerBox.x + minResizerBox.width / 2;
    startY = minResizerBox.y + minResizerBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 600, startY);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const maxBox = (await aside.boundingBox())!;
    expect(Math.round(maxBox.width)).toBe(600);
  });

  test('07: Engineering Console Height Protection at 1024x768 and 768x1024', async ({ page }) => {
    for (const heightVp of [{ w: 1024, h: 768 }, { w: 768, h: 1024 }]) {
      await page.setViewportSize({ width: heightVp.w, height: heightVp.h });
      await page.keyboard.press('Alt+2');
      await page.waitForTimeout(150);

      const maximizeBtn = page.locator('button[title="Toggle Maximize"]');
      if (await maximizeBtn.isVisible()) {
        await maximizeBtn.click();
        await page.waitForTimeout(150);

        const editorSection = page.locator('section[aria-label="Code Editor Workspace"]');
        const box = await editorSection.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          // Assert vertical code editing area is preserved (>= 250px, never starved to 152px)
          expect(box.height).toBeGreaterThanOrEqual(250);
        }
      }
    }
  });
});
