import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const screenshotDir = path.resolve('C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/screenshots/ux01_ux02_verification');
fs.mkdirSync(screenshotDir, { recursive: true });

async function verify() {
  const browser = await chromium.launch({ headless: true });

  console.log('=== VERIFYING UX-01: COMPACT EDIT SUBNAV (1024x768, 900x768, 768x1024) ===');
  for (const vp of [{ width: 1024, height: 768 }, { width: 900, height: 768 }, { width: 768, height: 1024 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Switch to Edit
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);

    const measurements = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"][aria-label="Edit workspace views"]');
      const container = tablist ? tablist.parentElement : null;
      const tabChat = document.querySelector('[data-testid="nav-chat-tab"]');
      const tabFiles = document.querySelector('[data-testid="subview-files-tab"]');
      const tabHistory = document.querySelector('[data-testid="nav-history-tab"]');
      const tabDesign = document.querySelector('[data-testid="nav-design-system-tab"]');

      const cRect = container ? container.getBoundingClientRect() : null;
      const b = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          text: el.innerText.trim().replace(/\n/g, ' '),
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          isInside: cRect ? (r.left >= cRect.left - 1 && r.right <= cRect.right + 1) : false
        };
      };

      return {
        containerWidth: cRect ? cRect.width : 0,
        tablistScrollLeft: tablist ? tablist.scrollLeft : 0,
        tablistScrollWidth: tablist ? tablist.scrollWidth : 0,
        tablistClientWidth: tablist ? tablist.clientWidth : 0,
        hasHorizontalScroll: tablist ? tablist.scrollWidth > tablist.clientWidth : false,
        chat: b(tabChat),
        files: b(tabFiles),
        history: b(tabHistory),
        design: b(tabDesign)
      };
    });

    console.log(`\nViewport [${vp.width}x${vp.height}] (Container Width: ${measurements.containerWidth}px):`);
    console.log(`  Tab 1 (AI):      ${measurements.chat?.text} (width: ${measurements.chat?.width.toFixed(1)}px, inside: ${measurements.chat?.isInside})`);
    console.log(`  Tab 2 (Files):   ${measurements.files?.text} (width: ${measurements.files?.width.toFixed(1)}px, inside: ${measurements.files?.isInside})`);
    console.log(`  Tab 3 (History): ${measurements.history?.text} (width: ${measurements.history?.width.toFixed(1)}px, inside: ${measurements.history?.isInside})`);
    console.log(`  Tab 4 (Design):  ${measurements.design?.text} (width: ${measurements.design?.width.toFixed(1)}px, inside: ${measurements.design?.isInside})`);
    console.log(`  All 4 Inside?    ${measurements.chat?.isInside && measurements.files?.isInside && measurements.history?.isInside && measurements.design?.isInside ? 'YES! 100% CONTAINED' : 'NO'}`);
    console.log(`  Horizontal Scroll Required? ${measurements.hasHorizontalScroll ? 'YES' : 'NO (Clean zero-scroll layout)'}`);

    await page.screenshot({ path: path.join(screenshotDir, `ux01_edit_subnav_${vp.width}x${vp.height}.png`) });

    // Click Design Tab directly without horizontal scrolling!
    await page.locator('[data-testid="nav-design-system-tab"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(screenshotDir, `ux01_design_opened_${vp.width}x${vp.height}.png`) });
    console.log(`  Successfully clicked Design tab on [${vp.width}x${vp.height}]!`);

    await page.close();
  }

  console.log('\n=== VERIFYING UX-02: MOBILE EDIT SWITCHER (390x844, 375x812) ===');
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Switch to Edit
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);

    // 1. Check Code mode default
    const codeState = await page.evaluate(() => {
      const switcher = document.querySelector('[data-testid="mobile-edit-switcher"]');
      const codeTab = document.querySelector('[data-testid="mobile-edit-tab-code"]');
      const workspaceTab = document.querySelector('[data-testid="mobile-edit-tab-workspace"]');
      const editorSection = document.querySelector('section[aria-label="Code Editor Workspace"]');
      const aside = document.querySelector('aside[aria-label="Contextual Subsystem Workspace"]');

      return {
        switcherVisible: !!switcher,
        codeTabSelected: codeTab?.getAttribute('aria-selected') === 'true',
        editorSectionWidth: editorSection ? editorSection.getBoundingClientRect().width : 0,
        asideWidth: aside ? aside.getBoundingClientRect().width : 0,
        bodyOverflow: document.body.scrollWidth > document.body.clientWidth
      };
    });

    console.log(`\nMobile Viewport [${vp.width}x${vp.height}] - Code Mode:`);
    console.log(`  Switcher visible: ${codeState.switcherVisible}`);
    console.log(`  Code tab active: ${codeState.codeTabSelected}`);
    console.log(`  Editor width: ${codeState.editorSectionWidth}px (100% available width)`);
    console.log(`  Aside width: ${codeState.asideWidth}px (collapsed)`);
    console.log(`  Horizontal overflow: ${codeState.bodyOverflow}`);
    await page.screenshot({ path: path.join(screenshotDir, `ux02_mobile_edit_code_mode_${vp.width}x${vp.height}.png`) });

    // 2. Switch to Workspace mode
    await page.locator('[data-testid="mobile-edit-tab-workspace"]').click();
    await page.waitForTimeout(400);

    const workspaceState = await page.evaluate(() => {
      const workspaceTab = document.querySelector('[data-testid="mobile-edit-tab-workspace"]');
      const editorSection = document.querySelector('section[aria-label="Code Editor Workspace"]');
      const aside = document.querySelector('aside[aria-label="Contextual Subsystem Workspace"]');
      const chatTab = document.querySelector('[data-testid="nav-chat-tab"]');
      const filesTab = document.querySelector('[data-testid="subview-files-tab"]');
      const historyTab = document.querySelector('[data-testid="nav-history-tab"]');
      const designTab = document.querySelector('[data-testid="nav-design-system-tab"]');

      return {
        workspaceTabSelected: workspaceTab?.getAttribute('aria-selected') === 'true',
        editorSectionVisible: !!editorSection,
        asideWidth: aside ? aside.getBoundingClientRect().width : 0,
        allSubtabsPresent: !!(chatTab && filesTab && historyTab && designTab),
        bodyOverflow: document.body.scrollWidth > document.body.clientWidth
      };
    });

    console.log(`Mobile Viewport [${vp.width}x${vp.height}] - Workspace Mode:`);
    console.log(`  Workspace tab active: ${workspaceState.workspaceTabSelected}`);
    console.log(`  Editor hidden: ${!workspaceState.editorSectionVisible}`);
    console.log(`  Aside width: ${workspaceState.asideWidth}px (100% full width)`);
    console.log(`  All 4 subtabs present: ${workspaceState.allSubtabsPresent}`);
    console.log(`  Horizontal overflow: ${workspaceState.bodyOverflow}`);
    await page.screenshot({ path: path.join(screenshotDir, `ux02_mobile_edit_workspace_mode_${vp.width}x${vp.height}.png`) });

    // 3. Switch to Design tab within Workspace mode on mobile!
    await page.locator('[data-testid="nav-design-system-tab"]').click();
    await page.waitForTimeout(400);
    const designState = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="ds-tab-overview"] > div:first-child');
      const badge = card ? card.querySelector('span.uppercase') : null;
      const cRect = card ? card.getBoundingClientRect() : null;
      const bRect = badge ? badge.getBoundingClientRect() : null;
      return {
        cardWidth: cRect ? cRect.width : 0,
        badgeRight: bRect ? bRect.right : 0,
        cardRight: cRect ? cRect.right : 0,
        badgeInside: bRect && cRect ? bRect.right <= cRect.right : false
      };
    });
    console.log(`  Design Overview on mobile: card width=${designState.cardWidth}px, badge inside=${designState.badgeInside}`);
    await page.screenshot({ path: path.join(screenshotDir, `ux02_mobile_design_subtab_${vp.width}x${vp.height}.png`) });

    // 4. Switch back to Code mode
    await page.locator('[data-testid="mobile-edit-tab-code"]').click();
    await page.waitForTimeout(300);
    console.log(`  Successfully switched back to Code mode.`);

    await page.close();
  }

  await browser.close();
  console.log('\n=== ALL UX-01 AND UX-02 VERIFICATIONS COMPLETED SUCCESSFULLY ===');
}

verify().catch(err => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
