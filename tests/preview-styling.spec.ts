import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('SnapDeploy AI — Live WebContainer Tailwind Styling & CDN Independence Verification', () => {
  test('verifies live WebContainer preview compiles and applies Tailwind CSS without cdn.tailwindcss.com', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes timeout for WebContainer boot & dev server

    const networkRequests: string[] = [];
    page.on('request', req => {
      const url = req.url();
      networkRequests.push(url);
      if (url.includes('cdn.tailwindcss.com')) {
        console.error('[CRITICAL SECURITY/INTEGRITY VIOLATION] Detected network request to cdn.tailwindcss.com:', url);
      }
    });

    page.on('console', msg => console.log(`[Browser Console: ${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.error('[Browser PageError]', err.message));

    console.log('>>> [Step 1] Navigating to SnapDeploy AI at http://localhost:3000...');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Confirm TopNavbar
    await expect(page.locator('header')).toContainText('SnapDeploy');
    console.log('>>> [Step 1 Verified] Frontend host shell loaded.');

    // Step 2: Ensure dev server is booted & running with preview iframe visible
    console.log('>>> [Step 2] Checking runtime dev server status and preview iframe...');
    const previewIframeLocator = page.locator('iframe[title="SnapDeploy Live Application Preview"]');
    const isIframeVisible = await previewIframeLocator.isVisible();

    if (!isIframeVisible) {
      console.log('>>> [Step 2] Preview iframe not yet visible. Clicking Run Dev button...');
      const runDevBtn = page.locator('button[data-testid="nav-run-dev-btn"]');
      if (await runDevBtn.isVisible()) {
        await runDevBtn.click();
      }
      await expect(previewIframeLocator).toBeVisible({ timeout: 260000 });
    }

    await expect(previewIframeLocator).toBeVisible({ timeout: 15000 });
    console.log('>>> [Step 2 Verified] WebContainer dev server is running and preview iframe is visible.');

    // Step 3: Access iframe frameLocator and verify DOM contents
    console.log('>>> [Step 3] Inspecting live application preview iframe DOM...');
    const iframe = page.frameLocator('iframe[title="SnapDeploy Live Application Preview"]');
    const rootMount = iframe.locator('#root');
    await expect(rootMount).toBeAttached({ timeout: 20000 });
    await expect(iframe.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });

    // Step 4: Verify ZERO dependency on cdn.tailwindcss.com
    console.log('>>> [Step 4] Confirming zero requests or script elements for cdn.tailwindcss.com...');
    const cdnRequests = networkRequests.filter(url => url.includes('cdn.tailwindcss.com'));
    expect(cdnRequests.length).toBe(0);

    const cdnScriptCount = await iframe.locator('script[src*="cdn.tailwindcss.com"]').count();
    expect(cdnScriptCount).toBe(0);
    console.log('>>> [Step 4 Verified] ZERO network requests and ZERO script tags for cdn.tailwindcss.com.');

    // Step 5: Verify Tailwind CSS is locally compiled and visually active
    console.log('>>> [Step 5] Checking computed CSS styles on rendered elements in preview iframe...');
    
    // Check body or wrapper styling (bg-slate-950 has computed rgb(2, 6, 23))
    const bodyBgColor = await iframe.locator('body').evaluate(el => window.getComputedStyle(el).backgroundColor);
    console.log('>>> Computed body background color:', bodyBgColor);
    expect(bodyBgColor).toBe('rgb(2, 6, 23)');

    // Check card or element with rounded-xl
    const roundedCards = iframe.locator('.rounded-xl').first();
    await expect(roundedCards).toBeVisible({ timeout: 10000 });
    const borderRadius = await roundedCards.evaluate(el => window.getComputedStyle(el).borderRadius);
    console.log('>>> Computed .rounded-xl border-radius:', borderRadius);
    expect(borderRadius).toBe('12px');

    // Check flex layout elements
    const flexElements = iframe.locator('.flex').first();
    await expect(flexElements).toBeVisible();
    const displayStyle = await flexElements.evaluate(el => window.getComputedStyle(el).display);
    console.log('>>> Computed .flex display:', displayStyle);
    expect(displayStyle).toBe('flex');

    // Step 6: Capture screenshot of live styled preview
    const screenshotPath = 'scratch/live_preview_styled.png';
    await previewIframeLocator.screenshot({ path: screenshotPath });
    console.log(`>>> [Step 6 Verified] Saved live preview screenshot to ${screenshotPath}`);

    console.log('>>> [ALL 9 POINTS VERIFIED IN REAL CHROMIUM WEBCONTAINER RUNTIME]');
  });
});
