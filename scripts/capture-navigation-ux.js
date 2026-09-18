import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = path.resolve('C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/screenshots/navigation_ux');
fs.mkdirSync(outDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop 1440x900 - BUILD (default)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, '01_desktop_1440_build_rail.png') });
    await page.close();
  }

  // 2. Desktop 1440x900 - EDIT activity (contextual header h-11, tabs, focus)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '02_desktop_1440_edit_workspace.png') });
    await page.close();
  }

  // 3. Desktop 1280x800 - DATA workspace (Environment variables, zero horizontal scrollbar)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="data"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '03_desktop_1280_data_env_no_overflow.png') });
    await page.close();
  }

  // 4. Desktop 1024x768 - DATA workspace (Database Manager, zero horizontal scrollbar)
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="data"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="data-tab-database"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '04_desktop_1024_data_database_no_overflow.png') });
    await page.close();
  }

  // 5. Desktop 1440x900 - SHIP workspace (tabs + vertical divider + Open Full Dialog action button)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="ship"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '05_desktop_1440_ship_nav_action_distinction.png') });
    await page.close();
  }

  // 6. Mobile 390x844 - iPhone 14/15 (mobile bottom navigation bar replacing rail)
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '06_mobile_390_bottom_navigation.png') });
    await page.close();
  }

  // 7. Mobile 375x812 - iPhone X/Mini (mobile bottom navigation bar)
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '07_mobile_375_edit_bottom_navigation.png') });
    await page.close();
  }

  await browser.close();
  console.log('ALL SCREENSHOTS CAPTURED SUCCESSFULLY in ' + outDir);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
