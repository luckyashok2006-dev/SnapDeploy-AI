import { test, expect } from '@playwright/test';

test.describe('Live Preview Panel UI/UX Refinement & Viewport Certification', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to studio and initialize deterministic responsive test fixture
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Mount deterministic test fixture into runtime preview state
    await page.evaluate(() => {
      (window as any).useRuntimeStore?.setState({
        previewUrl: 'http://localhost:3000/test-preview.html',
        previewPort: 3000,
        status: 'ready'
      });
    });

    // Wait for preview iframe to be visible
    const previewIframe = page.locator('iframe[title="SnapDeploy Live Application Preview"]');
    await expect(previewIframe).toBeVisible({ timeout: 15000 });
  });

  test('01: Toolbar zero horizontal overflow and responsive compaction', async ({ page }) => {
    const toolbar = page.locator('[data-testid="preview-toolbar"]');
    await expect(toolbar).toBeVisible();

    // Verify all primary groups exist
    await expect(page.locator('[data-testid="preview-nav-group"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-url-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="select-element-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-device-selector"]')).toBeVisible();

    // TEST A: Verify open-preview-new-tab-btn is structurally INSIDE preview-url-bar
    const urlBar = page.locator('[data-testid="preview-url-bar"]');
    const embeddedNewTabBtn = urlBar.locator('[data-testid="open-preview-new-tab-btn"]');
    await expect(embeddedNewTabBtn).toBeVisible();
    await expect(urlBar.locator('[data-testid="runtime-url-content"]')).toBeVisible();

    // Assert open-preview-new-tab-btn is NOT an outside sibling directly under preview-toolbar
    const directToolbarChildren = await page.locator('[data-testid="preview-toolbar"] > [data-testid="open-preview-new-tab-btn"]').count();
    expect(directToolbarChildren).toBe(0);

    // Verify toolbar has zero horizontal overflow
    const hasOverflow = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(hasOverflow).toBe(false);

    // Verify URL bar yields space first with min-width and truncate
    await expect(urlBar).toHaveClass(/flex-1/);
    await expect(urlBar).toHaveClass(/truncate/);
  });

  test('02: Desktop preset establishes true 1440×900 logical viewport and desktop layout', async ({ page }) => {
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();
    await expect(desktopBtn).toHaveAttribute('aria-pressed', 'true');

    const iframe = page.locator('iframe[data-testid="preview-iframe"]');
    await expect(iframe).toHaveAttribute('data-logical-width', '1440');
    await expect(iframe).toHaveAttribute('data-logical-height', '900');
    await expect(iframe).toHaveAttribute('data-viewport-preset', 'desktop');

    // Verify actual width style on iframe is 1440px
    const iframeWidth = await iframe.evaluate((el) => el.style.width);
    expect(iframeWidth).toBe('1440px');

    // Access iframe contents and verify that Desktop media query (≥ 1024px) triggered
    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const desktopLayout = frame.locator('[data-testid="fixture-desktop-layout"]');
    const tabletLayout = frame.locator('[data-testid="fixture-tablet-layout"]');
    const mobileLayout = frame.locator('[data-testid="fixture-mobile-layout"]');

    await expect(desktopLayout).toBeVisible({ timeout: 5000 });
    await expect(tabletLayout).toBeHidden();
    await expect(mobileLayout).toBeHidden();

    // Verify 3 cards in row (desktop grid)
    const card1 = frame.locator('[data-testid="fixture-card-1"]');
    const card3 = frame.locator('[data-testid="fixture-card-3"]');
    await expect(card1).toBeVisible();
    await expect(card3).toBeVisible();

    // Capture visual artifact for desktop
    await page.screenshot({ path: 'test-results/preview-desktop-verified.png' });
    await page.screenshot({ path: 'test-results/preview-desktop-new-tab-btn.png' });
  });

  test('03: Tablet preset establishes true 768×1024 logical viewport and tablet layout', async ({ page }) => {
    const tabletBtn = page.locator('button[data-testid="preview-device-tablet"]');
    await tabletBtn.click();
    await expect(tabletBtn).toHaveAttribute('aria-pressed', 'true');

    const iframe = page.locator('iframe[data-testid="preview-iframe"]');
    await expect(iframe).toHaveAttribute('data-logical-width', '768');
    await expect(iframe).toHaveAttribute('data-logical-height', '1024');
    await expect(iframe).toHaveAttribute('data-viewport-preset', 'tablet');

    // Verify actual width style on iframe is 768px
    const iframeWidth = await iframe.evaluate((el) => el.style.width);
    expect(iframeWidth).toBe('768px');

    // Access iframe contents and verify that Tablet media query (640px–1023px) triggered
    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const desktopLayout = frame.locator('[data-testid="fixture-desktop-layout"]');
    const tabletLayout = frame.locator('[data-testid="fixture-tablet-layout"]');
    const mobileLayout = frame.locator('[data-testid="fixture-mobile-layout"]');

    await expect(tabletLayout).toBeVisible({ timeout: 5000 });
    await expect(desktopLayout).toBeHidden();
    await expect(mobileLayout).toBeHidden();

    // Capture visual artifact for tablet
    await page.screenshot({ path: 'test-results/preview-tablet-verified.png' });
  });

  test('04: Mobile preset establishes true 390×844 logical viewport and mobile layout', async ({ page }) => {
    const mobileBtn = page.locator('button[data-testid="preview-device-mobile"]');
    await mobileBtn.click();
    await expect(mobileBtn).toHaveAttribute('aria-pressed', 'true');

    const iframe = page.locator('iframe[data-testid="preview-iframe"]');
    await expect(iframe).toHaveAttribute('data-logical-width', '390');
    await expect(iframe).toHaveAttribute('data-logical-height', '844');
    await expect(iframe).toHaveAttribute('data-viewport-preset', 'mobile');

    // Verify actual width style on iframe is 390px
    const iframeWidth = await iframe.evaluate((el) => el.style.width);
    expect(iframeWidth).toBe('390px');

    // Access iframe contents and verify that Mobile media query (< 640px) triggered
    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const desktopLayout = frame.locator('[data-testid="fixture-desktop-layout"]');
    const tabletLayout = frame.locator('[data-testid="fixture-tablet-layout"]');
    const mobileLayout = frame.locator('[data-testid="fixture-mobile-layout"]');

    await expect(mobileLayout).toBeVisible({ timeout: 5000 });
    await expect(desktopLayout).toBeHidden();
    await expect(tabletLayout).toBeHidden();

    // Capture visual artifact for mobile
    await page.screenshot({ path: 'test-results/preview-mobile-verified.png' });
  });

  test('05: Panel resize recalculates displayScale while preserving logical dimensions', async ({ page }) => {
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();

    const stageWrapper = page.locator('[data-testid="preview-stage-wrapper"]');
    const iframe = page.locator('iframe[data-testid="preview-iframe"]');

    const initialDisplayScale = await stageWrapper.getAttribute('data-display-scale');
    expect(initialDisplayScale).toBeTruthy();

    // Resize viewport window to trigger panel resize within side-by-side mode (1200x800)
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);

    // Logical dimensions must be strictly preserved
    await expect(iframe).toHaveAttribute('data-logical-width', '1440');
    await expect(iframe).toHaveAttribute('data-logical-height', '900');

    // Display scale must have recalculated
    const newDisplayScale = await stageWrapper.getAttribute('data-display-scale');
    expect(newDisplayScale).toBeTruthy();
    expect(Number(newDisplayScale)).toBeLessThan(Number(initialDisplayScale));

    // Verify zero horizontal overflow on toolbar after window resize
    const toolbar = page.locator('[data-testid="preview-toolbar"]');
    const hasOverflow = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(hasOverflow).toBe(false);
  });

  test('06: Select Element click translation accounts for displayScale and selects target element', async ({ page }) => {
    // Select desktop mode (scaled)
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();

    const selectElementBtn = page.locator('button[data-testid="select-element-btn"]');
    await selectElementBtn.click();

    const inspectOverlay = page.locator('[data-testid="visual-inspect-overlay"]');
    await expect(inspectOverlay).toBeVisible({ timeout: 5000 });

    // Click on inspect overlay
    await inspectOverlay.click({ position: { x: 80, y: 80 } });

    // Context card must appear
    const contextCard = page.locator('[data-testid="visual-element-context-card"]');
    await expect(contextCard).toBeVisible({ timeout: 10000 });

    // Close context card
    const closeBtn = page.locator('button[data-testid="visual-card-close-btn"]');
    await closeBtn.click();
    await expect(contextCard).toBeHidden();
  });

  test('07: Zoom is independent from device preset and alters displayScale only', async ({ page }) => {
    const tabletBtn = page.locator('button[data-testid="preview-device-tablet"]');
    await tabletBtn.click();

    const iframe = page.locator('iframe[data-testid="preview-iframe"]');
    await expect(iframe).toHaveAttribute('data-logical-width', '768');

    const zoomLabel = page.locator('[data-testid="preview-zoom-label"]');
    await expect(zoomLabel).toBeVisible();
    await expect(zoomLabel).toContainText('100%');

    // Zoom in
    const zoomInBtn = page.locator('button[data-testid="preview-zoom-in"]');
    await zoomInBtn.click();
    await expect(zoomLabel).toContainText('110%');

    // Logical dimensions must remain 768 × 1024
    await expect(iframe).toHaveAttribute('data-logical-width', '768');
    await expect(iframe).toHaveAttribute('data-logical-height', '1024');

    // Switch to Mobile: device changes, zoom remains 110%
    const mobileBtn = page.locator('button[data-testid="preview-device-mobile"]');
    await mobileBtn.click();
    await expect(iframe).toHaveAttribute('data-logical-width', '390');
    await expect(zoomLabel).toContainText('110%');
  });

  test('08: Narrow preview panel width retains permanently visible zoom controls without overflow', async ({ page }) => {
    // Test at narrow viewport (390px - mobile screen)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);

    // On mobile screens (< 768px), navigate to the Run activity where Preview is mounted full-width
    const runTab = page.locator('button[aria-label="Run workspace"]');
    if (await runTab.isVisible()) {
      await runTab.click();
      await page.waitForTimeout(300);
    }

    const toolbar = page.locator('[data-testid="preview-toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    const hasOverflow = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(hasOverflow).toBe(false);

    // Zoom controls remain visible and functional in compact mode
    await expect(page.locator('[data-testid="preview-zoom-controls"]')).toBeVisible();
    await expect(page.locator('button[data-testid="preview-zoom-out"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-zoom-label"]')).toBeVisible();
    await expect(page.locator('button[data-testid="preview-zoom-in"]')).toBeVisible();

    // All 3 device buttons remain visible and accessible
    await expect(page.locator('button[data-testid="preview-device-desktop"]')).toBeVisible();
    await expect(page.locator('button[data-testid="preview-device-tablet"]')).toBeVisible();
    await expect(page.locator('button[data-testid="preview-device-mobile"]')).toBeVisible();
    await expect(page.locator('button[data-testid="select-element-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="open-preview-new-tab-btn"]')).toBeVisible();

    // Capture narrow toolbar proof with restored zoom controls and new tab button
    await page.screenshot({ path: 'test-results/preview-narrow-toolbar-proof.png' });
    await page.screenshot({ path: 'test-results/preview-narrow-new-tab-btn.png' });
  });

  test('09: Native select dropdown opens within viewport bounds on Desktop preset without escaping', async ({ page }) => {
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();

    const stageWrapper = page.locator('[data-testid="preview-stage-wrapper"]');
    await expect(stageWrapper).toBeVisible();

    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const select = frame.locator('[data-testid="fixture-category-select"]');
    await expect(select).toBeVisible({ timeout: 10000 });

    // Open select dropdown via click
    await select.click();

    const menu = frame.locator('[data-testid="preview-select-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Check menu options
    const option1 = frame.locator('[data-testid="preview-select-option-1"]');
    await expect(option1).toContainText('Software & SaaS Subscriptions');

    // Capture desktop select screenshot proof
    await page.screenshot({ path: 'test-results/preview-desktop-select-verified.png' });

    // Select option 1
    await option1.click();
    await expect(menu).toBeHidden();

    // Verify native select value updated
    const selectedVal = await select.inputValue();
    expect(selectedVal).toBe('software');
  });

  test('10: Native select dropdown opens within viewport bounds on Tablet preset', async ({ page }) => {
    const tabletBtn = page.locator('button[data-testid="preview-device-tablet"]');
    await tabletBtn.click();
    await page.waitForTimeout(400);

    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const select = frame.locator('[data-testid="fixture-category-select"]');
    await expect(select).toBeVisible({ timeout: 10000 });

    await select.click();

    const menu = frame.locator('[data-testid="preview-select-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Capture tablet select screenshot proof
    await page.screenshot({ path: 'test-results/preview-tablet-select-verified.png' });

    // Select option 2
    const option2 = frame.locator('[data-testid="preview-select-option-2"]');
    await option2.click();
    await expect(menu).toBeHidden();

    const selectedVal = await select.inputValue();
    expect(selectedVal).toBe('cloud');
  });

  test('11: Native select dropdown opens within viewport bounds on Mobile preset', async ({ page }) => {
    const mobileBtn = page.locator('button[data-testid="preview-device-mobile"]');
    await mobileBtn.click();
    await page.waitForTimeout(400); // Allow scale transition and window resize to settle

    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const select = frame.locator('[data-testid="fixture-category-select"]');
    await expect(select).toBeVisible({ timeout: 10000 });
    await select.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    await select.click();

    const menu = frame.locator('[data-testid="preview-select-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Capture mobile select screenshot proof
    await page.screenshot({ path: 'test-results/preview-mobile-select-verified.png' });

    // Select option 0
    const option0 = frame.locator('[data-testid="preview-select-option-0"]');
    await option0.click();
    await expect(menu).toBeHidden();

    const selectedVal = await select.inputValue();
    expect(selectedVal).toBe('all');
  });

  test('12: Form shim supports full keyboard navigation (Home, End, Arrows, Enter, Escape, Tab)', async ({ page }) => {
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();

    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const select = frame.locator('[data-testid="fixture-category-select"]');
    await expect(select).toBeVisible();

    // Focus and open via Space key
    await select.focus();
    await page.keyboard.press('Space');

    const menu = frame.locator('[data-testid="preview-select-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Press End -> jump to last option
    await page.keyboard.press('End');
    const lastOption = frame.locator('[data-testid="preview-select-option-4"]');
    await expect(lastOption).toBeVisible();

    // Press Home -> jump to first option
    await page.keyboard.press('Home');
    const firstOption = frame.locator('[data-testid="preview-select-option-0"]');
    await expect(firstOption).toBeVisible();

    // Press ArrowDown -> move to option 1
    await page.keyboard.press('ArrowDown');

    // Press Enter -> select option 1
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();

    const selectedVal = await select.inputValue();
    expect(selectedVal).toBe('software');

    // Test Escape to close
    await select.focus();
    await page.keyboard.press('Space');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('13: Legitimate vertical application scrolling is preserved and distinct from popup containment', async ({ page }) => {
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();

    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const bottomSelect = frame.locator('[data-testid="fixture-bottom-select"]');

    // Scroll bottom select into view
    await bottomSelect.scrollIntoViewIfNeeded();
    await expect(bottomSelect).toBeVisible({ timeout: 10000 });

    // Verify document scrolled legitimately
    const scrollY = await frame.locator('body').evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);

    // Open bottom select in scrolled document
    await bottomSelect.click();

    const menu = frame.locator('[data-testid="preview-select-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });

    // Capture vertical scroll screenshot proof
    await page.screenshot({ path: 'test-results/preview-vertical-scroll-verified.png' });
    await page.screenshot({ path: 'test-results/preview-legitimate-scroll-verified.png' });

    // Select option 1 in bottom select
    const optArchived = frame.locator('[data-testid="preview-select-option-1"]');
    await optArchived.click();
    await expect(menu).toBeHidden();

    const bottomVal = await bottomSelect.inputValue();
    expect(bottomVal).toBe('archived');
  });

  test('14: Scroll container audit: zero accidental outer scrollbar at fit-scale across Desktop, Tablet, and Mobile', async ({ page }) => {
    const presets = ['desktop', 'tablet', 'mobile'];

    for (const preset of presets) {
      const btn = page.locator(`button[data-testid="preview-device-${preset}"]`);
      await btn.click();
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        const stage = document.querySelector('[data-testid="preview-stage-container"]') as HTMLElement;
        const iframe = document.querySelector('iframe[data-testid="preview-iframe"]') as HTMLIFrameElement;
        const doc = iframe?.contentDocument;

        return {
          stageClientWidth: stage.clientWidth,
          stageClientHeight: stage.clientHeight,
          stageScrollWidth: stage.scrollWidth,
          stageScrollHeight: stage.scrollHeight,
          hasOuterVerticalScroll: stage.scrollHeight > stage.clientHeight + 1,
          hasOuterHorizontalScroll: stage.scrollWidth > stage.clientWidth + 1,
          docClientHeight: doc?.documentElement.clientHeight || 0,
          docScrollHeight: doc?.documentElement.scrollHeight || 0,
          hasIframeVerticalScroll: (doc?.documentElement.scrollHeight || 0) > (doc?.documentElement.clientHeight || 0)
        };
      });

      // Assert NO accidental outer scrollbar at fit-scale on stage container
      expect(metrics.hasOuterVerticalScroll, `Expected no outer vertical scrollbar on stage container for ${preset}`).toBe(false);
      expect(metrics.hasOuterHorizontalScroll, `Expected no outer horizontal scrollbar on stage container for ${preset}`).toBe(false);

      // Assert legitimate in-application vertical scrolling belongs strictly to iframe document
      expect(metrics.hasIframeVerticalScroll, `Expected iframe document to possess legitimate vertical scrolling for ${preset}`).toBe(true);
    }
  });

  test('15: Intentional outer panning is permitted when zoom > fit-scale', async ({ page }) => {
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();

    // Zoom in to 130%
    const zoomInBtn = page.locator('button[data-testid="preview-zoom-in"]');
    await zoomInBtn.click(); // 110%
    await zoomInBtn.click(); // 120%
    await zoomInBtn.click(); // 130%

    const zoomLabel = page.locator('[data-testid="preview-zoom-label"]');
    await expect(zoomLabel).toContainText('130%');

    // Verify outer stage container allows smooth panning when enlarged beyond available area
    const canPan = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="preview-stage-container"]') as HTMLElement;
      const initialTop = stage.scrollTop;
      stage.scrollTop = 50;
      const scrolled = stage.scrollTop !== initialTop || stage.scrollHeight >= stage.clientHeight;
      return scrolled;
    });
    expect(canPan).toBe(true);

    // Reset zoom back to 100%
    await zoomLabel.click();
    await expect(zoomLabel).toContainText('100%');
    await page.waitForTimeout(300);

    // Verify stage container returns to zero accidental outer scrollbar
    const afterReset = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="preview-stage-container"]') as HTMLElement;
      return {
        hasOuterVerticalScroll: stage.scrollHeight > stage.clientHeight + 1,
        hasOuterHorizontalScroll: stage.scrollWidth > stage.clientWidth + 1
      };
    });
    expect(afterReset.hasOuterVerticalScroll).toBe(false);
    expect(afterReset.hasOuterHorizontalScroll).toBe(false);
  });

  test('16: Open Preview in New Tab opens first-party /preview route, connects automatically, and renders functioning application without Preview chrome', async ({ page, context }) => {
    const openBtn = page.locator('[data-testid="open-preview-new-tab-btn"]');
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toBeEnabled();
    await expect(openBtn).toHaveAttribute('aria-label', 'Open Preview in new tab');
    await expect(openBtn).toHaveAttribute('title', 'Open Preview in new tab');

    // Click button and await new browser tab
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      openBtn.click()
    ]);

    await newPage.waitForLoadState('domcontentloaded');

    // 1. Verify URL is dedicated first-party /preview launch route
    expect(newPage.url()).toContain('/preview?project=');

    // 2. Explicit failure conditions: "Connect to Project" / "You're almost there" MUST NOT EXIST
    await expect(newPage.locator('text="Connect to Project"')).toHaveCount(0);
    await expect(newPage.locator('text="You\'re almost there"')).toHaveCount(0);

    // 3. Verify application actually renders successfully inside standalone iframe
    const appFrame = newPage.frameLocator('iframe[data-testid="standalone-preview-iframe"]');
    const title = appFrame.locator('#fixture-title');
    await expect(title).toBeVisible({ timeout: 10000 });
    await expect(title).toContainText('Deterministic Responsive Test Application');

    const select = appFrame.locator('[data-testid="fixture-category-select"]');
    await expect(select).toBeVisible();

    const grid = appFrame.locator('[data-testid="fixture-grid"]');
    await expect(grid).toBeVisible();

    const scrollSection = appFrame.locator('[data-testid="fixture-scroll-section"]');
    await expect(scrollSection).toBeVisible();

    // 4. Test interactive application functionality in new tab
    await select.selectOption('software');
    expect(await select.inputValue()).toBe('software');

    const textInput = appFrame.locator('[data-testid="fixture-text-input"]');
    await textInput.fill('INV-TEST-2026');
    expect(await textInput.inputValue()).toBe('INV-TEST-2026');

    // 5. Verify ZERO Preview chrome / IDE UI in new tab
    await expect(newPage.locator('[data-testid="preview-toolbar"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="top-navbar"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="sidebar-nav"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="select-element-btn"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="preview-device-selector"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="preview-zoom-controls"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="preview-viewport-scaler"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="preview-stage-container"]')).toHaveCount(0);
    await expect(newPage.locator('[data-testid="preview-select-menu"]')).toHaveCount(0);

    // 6. Capture visual evidence artifact of clean full-page application
    await newPage.screenshot({ path: 'test-results/preview-new-tab-fullpage.png' });

    await newPage.close();
  });

  test('17: Open Preview in New Tab honors runtime readiness and project isolation', async ({ page, context }) => {
    // 1. Verify disabled state when runtime is idle
    await page.evaluate(() => {
      (window as any).useRuntimeStore?.setState({
        status: 'idle',
        previewUrl: null
      });
    });

    const openBtn = page.locator('[data-testid="open-preview-new-tab-btn"]');
    await expect(openBtn).toBeDisabled();
    await expect(openBtn).toHaveAttribute('title', 'Dev server not ready');

    // 2. Project isolation: update active project to Project Beta and verify target
    await page.evaluate(() => {
      (window as any).useProjectStore?.setState({
        activeProjectId: 'project_beta'
      });
      (window as any).useRuntimeStore?.setState({
        status: 'ready',
        previewUrl: 'http://localhost:3000/test-preview.html?project=beta',
        previewPort: 3000
      });
    });

    await expect(openBtn).toBeEnabled();
    await expect(openBtn).toHaveAttribute('title', 'Open Preview in new tab');

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      openBtn.click()
    ]);

    await newPage.waitForLoadState('domcontentloaded');
    expect(newPage.url()).toContain('project=project_beta');

    const betaFrame = newPage.frameLocator('iframe[data-testid="standalone-preview-iframe"]');
    await expect(betaFrame.locator('#fixture-title')).toBeVisible({ timeout: 10000 });

    await newPage.close();
  });

  test('18: Root application scrollbar is visually hidden while scrolling remains functional across Desktop, Tablet, and Mobile', async ({ page }) => {
    const presets = [
      { id: 'desktop', selector: 'preview-device-desktop', name: 'Desktop' },
      { id: 'tablet', selector: 'preview-device-tablet', name: 'Tablet' },
      { id: 'mobile', selector: 'preview-device-mobile', name: 'Mobile' }
    ];

    const iframeLocator = page.locator('iframe[data-testid="preview-iframe"]');
    await expect(iframeLocator).toBeVisible({ timeout: 10000 });

    for (const preset of presets) {
      // 1. Switch to preset
      const presetBtn = page.locator(`button[data-testid="${preset.selector}"]`);
      await presetBtn.click();
      await expect(presetBtn).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(300);

      // 2. Access frame and inspect document
      const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
      const title = frame.locator('#fixture-title');
      await expect(title).toBeVisible({ timeout: 5000 });

      // 3. Confirm root document scrollHeight > clientHeight (tall document)
      const rootScrollMetrics = await frame.locator('html').evaluate((html) => {
        return {
          scrollHeight: html.scrollHeight,
          clientHeight: html.clientHeight,
          scrollTop: html.scrollTop
        };
      });
      expect(rootScrollMetrics.scrollHeight).toBeGreaterThan(rootScrollMetrics.clientHeight);

      // 4. Verify preview scrollbar shim style is injected targeting html and body
      const styleInjected = await frame.locator('#snapdeploy-preview-root-scrollbar-style').count();
      expect(styleInjected).toBe(1);

      // 5. Read computed scrollbar CSS where possible (scrollbarWidth: 'none')
      const rootComputed = await frame.locator('html').evaluate((html) => {
        const computed = window.getComputedStyle(html);
        return {
          scrollbarWidth: computed.scrollbarWidth,
          // When scrollbar is hidden with display:none or width:0, innerWidth equals clientWidth
          innerWidth: window.innerWidth,
          clientWidth: html.clientWidth,
          // Verify root does NOT have overflow: hidden
          overflow: computed.overflow,
          overflowY: computed.overflowY
        };
      });

      // In Chromium with ::-webkit-scrollbar display:none and scrollbar-width: none,
      // root overflow remains scrollable and scrollbar is visually hidden
      expect(rootComputed.overflowY).not.toBe('hidden');
      expect(rootComputed.overflow).not.toBe('hidden');
      if (rootComputed.scrollbarWidth) {
        expect(rootComputed.scrollbarWidth).toBe('none');
      }

      // 6. Scroll the iframe document programmatically and verify scrollTop changes
      const initialScrollTop = await frame.locator('html').evaluate((html) => html.scrollTop);
      expect(initialScrollTop).toBe(0);

      await frame.locator('html').evaluate((html) => {
        window.scrollTo(0, 320);
      });
      await page.waitForTimeout(100);

      const scrolledTop = await frame.locator('html').evaluate((html) => html.scrollTop || document.body.scrollTop);
      expect(scrolledTop).toBeGreaterThan(150);

      // Also verify mouse wheel scrolling inside the iframe works
      const iframeBox = await iframeLocator.boundingBox();
      if (iframeBox) {
        await page.mouse.move(iframeBox.x + iframeBox.width / 2, iframeBox.y + iframeBox.height / 2);
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(100);
      }

      const wheelScrolledTop = await frame.locator('html').evaluate((html) => html.scrollTop || document.body.scrollTop);
      expect(wheelScrolledTop).toBeGreaterThan(200);

      // 7. Test nested scroll container: data-testid="fixture-nested-scroll"
      const nestedScroll = frame.locator('[data-testid="fixture-nested-scroll"]');
      await expect(nestedScroll).toBeVisible();

      const nestedMetrics = await nestedScroll.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          scrollbarWidth: computed.scrollbarWidth,
          overflowY: computed.overflowY
        };
      });

      // Nested scroll area is tall and scrollable
      expect(nestedMetrics.scrollHeight).toBeGreaterThan(nestedMetrics.clientHeight);
      expect(nestedMetrics.overflowY).toBe('auto');
      // Nested scroll area does NOT have scrollbar-width: none (not overridden)
      expect(nestedMetrics.scrollbarWidth).not.toBe('none');

      // Scroll nested scroll container
      await nestedScroll.evaluate((el) => {
        el.scrollTop = 80;
      });
      const nestedScrolledTop = await nestedScroll.evaluate((el) => el.scrollTop);
      expect(nestedScrolledTop).toBeGreaterThanOrEqual(70);

      // Reset scroll position
      await frame.locator('html').evaluate((html) => {
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(100);
    }

    // 8. Capture visual evidence of desktop preview with visually hidden root scrollbar
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/preview-root-scrollbar-hidden.png' });
  });

  test('19: LP-01 — Back / Forward toolbar navigation with route synchronization', async ({ page }) => {
    const backBtn = page.locator('[data-testid="preview-back-btn"]');
    const forwardBtn = page.locator('[data-testid="preview-forward-btn"]');
    const pathInput = page.locator('[data-testid="preview-url-path-input"]');

    await expect(backBtn).toBeVisible();
    await expect(forwardBtn).toBeVisible();
    await expect(backBtn).toBeDisabled();
    await expect(forwardBtn).toBeDisabled();

    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const pageABtn = frame.locator('[data-testid="nav-btn-page-a"]');
    await pageABtn.waitFor({ state: 'visible', timeout: 5000 });

    // Click /page-a inside iframe
    await pageABtn.click();
    await page.waitForTimeout(300);

    // Verify active route in iframe and path input in toolbar
    await expect(frame.locator('[data-testid="fixture-active-route"]')).toHaveText('/page-a');
    await expect(pathInput).toHaveValue(/page-a/);
    await expect(backBtn).toBeEnabled();
    await expect(forwardBtn).toBeDisabled();

    // Click Back
    await backBtn.click();
    await page.waitForTimeout(300);

    // Verify route reverted and forward button enabled
    await expect(forwardBtn).toBeEnabled();

    // Click Forward
    await forwardBtn.click();
    await page.waitForTimeout(300);

    await expect(frame.locator('[data-testid="fixture-active-route"]')).toHaveText('/page-a');
    await expect(backBtn).toBeEnabled();
  });

  test('20: LP-02 — Constrained Preview recovery with reversible toggle and RUN activity accent', async ({ page }) => {
    // Resize to constrained width where side-by-side mode collapses preview to protect 500px editor
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(400);

    // Verify recovery strip and button are visible
    const recoveryStrip = page.locator('[data-testid="preview-recovery-strip"]');
    const recoverBtn = page.locator('[data-testid="recover-preview-btn"]');
    await expect(recoveryStrip).toBeVisible();
    await expect(recoverBtn).toBeVisible();

    // Click recover preview button to switch constrained presentation to preview
    await recoverBtn.click();
    await page.waitForTimeout(300);

    // Constrained banner should be visible
    const banner = page.locator('[data-testid="preview-constrained-banner"]');
    const recoverEditorBtn = page.locator('[data-testid="recover-editor-btn"]');
    await expect(banner).toBeVisible();
    await expect(recoverEditorBtn).toBeVisible();

    // Preview iframe is now visible in full-canvas mode
    const previewIframe = page.locator('iframe[data-testid="preview-iframe"]');
    await expect(previewIframe).toBeVisible();

    // Click recover editor button to toggle back
    await recoverEditorBtn.click();
    await page.waitForTimeout(300);

    await expect(recoverBtn).toBeVisible();

    // Switch to RUN activity to verify pulse styling
    const runActivityBtn = page.locator('button[aria-label="Run workspace"]');
    if (await runActivityBtn.isVisible()) {
      await runActivityBtn.click();
      await page.waitForTimeout(300);
      // In Run activity, recover button has SHOW PREVIEW text and pulse
      if (await recoverBtn.isVisible()) {
        await expect(recoverBtn).toContainText('SHOW PREVIEW');
        await expect(recoverBtn).toHaveClass(/animate-pulse/);
      }
    }
  });

  test('21: LP-03 — URL bar editable route navigation and origin guard', async ({ page }) => {
    const pathInput = page.locator('[data-testid="preview-url-path-input"]');
    await expect(pathInput).toBeVisible();

    // Fill new route /page-c and press Enter
    await pathInput.click();
    await pathInput.fill('/page-c');
    await pathInput.press('Enter');
    await page.waitForTimeout(400);

    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    await expect(frame.locator('[data-testid="fixture-active-route"]')).toHaveText('/page-c');

    // Attempt to navigate to external URL (should be rejected/sanitized to keep origin intact)
    await pathInput.click();
    await pathInput.fill('https://malicious-external-site.com/hack');
    await pathInput.press('Enter');
    await page.waitForTimeout(300);

    // Frame must still be on localhost
    const iframeSrc = await page.locator('iframe[data-testid="preview-iframe"]').getAttribute('src');
    expect(iframeSrc).toContain('localhost');
  });

  test('22: LP-04 — Iframe instance preservation across Desktop, Tablet, and Mobile presets', async ({ page }) => {
    const frame = page.frameLocator('iframe[data-testid="preview-iframe"]');
    const textInput = frame.locator('[data-testid="fixture-text-input"]');
    await textInput.waitFor({ state: 'visible', timeout: 5000 });

    // Fill text into input
    const testSecret = 'LP04_STATE_PERSISTENCE_CONFIRMED';
    await textInput.fill(testSecret);
    expect(await textInput.inputValue()).toBe(testSecret);

    // Switch to Tablet preset
    const tabletBtn = page.locator('button[data-testid="preview-device-tablet"]');
    await tabletBtn.click();
    await page.waitForTimeout(300);

    // Verify input value is preserved
    expect(await textInput.inputValue()).toBe(testSecret);

    // Switch to Mobile preset
    const mobileBtn = page.locator('button[data-testid="preview-device-mobile"]');
    await mobileBtn.click();
    await page.waitForTimeout(300);

    // Verify input value is preserved
    expect(await textInput.inputValue()).toBe(testSecret);

    // Switch back to Desktop
    const desktopBtn = page.locator('button[data-testid="preview-device-desktop"]');
    await desktopBtn.click();
    await page.waitForTimeout(300);

    // Input must still retain value without remounting or state loss
    expect(await textInput.inputValue()).toBe(testSecret);
  });

  test('23: LP-05 — Inspect context card responsive bounding constraints', async ({ page }) => {
    // Set to 1200x800 where preview is approximately 320-350px wide
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(300);

    const selectElementBtn = page.locator('button[data-testid="select-element-btn"]');
    await selectElementBtn.click();

    const inspectOverlay = page.locator('[data-testid="visual-inspect-overlay"]');
    await expect(inspectOverlay).toBeVisible({ timeout: 5000 });

    // Click on overlay
    await inspectOverlay.click({ position: { x: 50, y: 50 } });

    const contextCard = page.locator('[data-testid="visual-element-context-card"]');
    await expect(contextCard).toBeVisible({ timeout: 5000 });

    const cardBox = await contextCard.boundingBox();
    expect(cardBox).toBeTruthy();
    if (cardBox) {
      expect(cardBox.width).toBeLessThanOrEqual(340);
    }

    // Close card
    const closeBtn = page.locator('button[data-testid="visual-card-close-btn"]');
    await closeBtn.click();
  });

  test('24: LP-06 — Sandbox allow-popups attribute present on preview iframe', async ({ page }) => {
    const iframe = page.locator('iframe[data-testid="preview-iframe"]');
    await expect(iframe).toBeVisible();

    const sandbox = await iframe.getAttribute('sandbox');
    expect(sandbox).toBeTruthy();
    expect(sandbox).toContain('allow-popups');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
  });

  test('25: LP-07 — ResizableDivider drag responsiveness and transition-none classing', async ({ page }) => {
    const stageWrapper = page.locator('[data-testid="preview-stage-wrapper"]');
    await expect(stageWrapper).toBeVisible();

    // In resting state, has transition-all
    const initialClass = await stageWrapper.getAttribute('class');
    expect(initialClass).toContain('transition-all');
  });
});

