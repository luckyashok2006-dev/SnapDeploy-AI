import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/screenshots/final_ux_verification');
fs.mkdirSync(outDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop 1440x900 - Edit AI Assistant default entry & clean positive flow
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '01_desktop_1440_ai_assistant_flow.png') });
    await page.close();
  }

  // 2. Desktop 1440x900 - Sidebar Console Button clicked -> Terminal opens deterministically
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(300);
    // Click Console toggle button
    await page.locator('[data-testid="nav-console-toggle-btn"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '02_desktop_1440_console_terminal_open.png') });
    await page.close();
  }

  // 3. Desktop 1440x900 - Design System Overview: full-width Apply to Code + 2-col wrapping grid
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[data-testid="nav-design-system-tab"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '03_desktop_1440_design_overview_grid.png') });
    await page.close();
  }

  // 4. Desktop 1440x900 - Design System Tokens: 2-col palette swatches with clear token name and hex
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[data-testid="nav-design-system-tab"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="ds-subtab-tokens"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '04_desktop_1440_design_tokens_palette_2col.png') });
    await page.close();
  }

  // 5. Desktop 1440x900 - Ship Workspace: 2-tier header (Row 1: [ Deploy ] [ GitHub ] [ History ], Row 2: [ Open Full Dialog ? ])
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="ship"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '05_desktop_1440_ship_2tier_header.png') });
    await page.close();
  }

  // 6. Compact Desktop 1024x768 - Ship Workspace: 2-tier header maintains equal width tabs and distinct dialog button
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="ship"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '06_compact_1024_ship_2tier_header.png') });
    await page.close();
  }

  // 7. Tablet 768x1024 - Ship Workspace
  {
    const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="ship"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '07_tablet_768_ship_workspace.png') });
    await page.close();
  }

  // 8. Mobile 390x844 - iPhone 14/15
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="ship"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '08_mobile_390_ship_workspace.png') });
    await page.close();
  }

  // 9. Mobile 375x812 - iPhone X/Mini
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '09_mobile_375_edit_workspace.png') });
    await page.close();
  }

  await browser.close();
  console.log('ALL VERIFICATION SCREENSHOTS CAPTURED SUCCESSFULLY in ' + outDir);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
