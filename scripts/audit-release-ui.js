import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const screenshotDir = path.resolve('C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/screenshots/release_audit');
fs.mkdirSync(screenshotDir, { recursive: true });

const MATRIX_VIEWPORTS = [
  { width: 1440, height: 900, name: '1440x900' },
  { width: 1280, height: 800, name: '1280x800' },
  { width: 1200, height: 800, name: '1200x800' },
  { width: 1100, height: 768, name: '1100x768' },
  { width: 1024, height: 768, name: '1024x768' },
  { width: 900, height: 768, name: '900x768' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 390, height: 844, name: '390x844' },
  { width: 375, height: 812, name: '375x812' }
];

async function runAudit() {
  const browser = await chromium.launch({ headless: true });
  const auditResults = {
    designOverview: {},
    aiAssistantLayoutTrace: {},
    aiAssistantCases: {},
    surfaces: {},
    overflowChecks: {}
  };

  console.log('=== STEP 1: AUDITING DESIGN OVERVIEW BADGE & CONTAINMENT ===');
  const designVps = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 900, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 375, height: 812 }
  ];

  for (const vp of designVps) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Switch to edit mode
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(300);

    // Switch to design system subtab
    await page.evaluate(() => {
      const btn = document.querySelector('button[data-testid="nav-design-system-tab"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);

    const dsData = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="ds-tab-overview"] > div:first-child');
      const title = document.querySelector('[data-testid="ds-title"]');
      const badge = card ? (card.querySelector('span.uppercase') || card.querySelector('span.font-mono')) : null;
      const overviewContainer = document.querySelector('[data-testid="ds-tab-overview"]');
      const aside = document.querySelector('aside[aria-label="Contextual Subsystem Workspace"]');

      const bodyOverflow = document.body.scrollWidth > document.body.clientWidth;
      const htmlOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;

      if (!card) {
        return {
          exists: false,
          asideVisible: aside ? aside.getBoundingClientRect().width > 0 : false,
          asideWidth: aside ? aside.getBoundingClientRect().width : 0,
          bodyOverflow,
          htmlOverflow
        };
      }

      const cardRect = card.getBoundingClientRect();
      const badgeRect = badge ? badge.getBoundingClientRect() : null;
      const titleRect = title ? title.getBoundingClientRect() : null;

      return {
        exists: true,
        asideVisible: aside ? aside.getBoundingClientRect().width > 0 : false,
        asideWidth: aside ? aside.getBoundingClientRect().width : 0,
        card: { top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom, left: cardRect.left, width: cardRect.width },
        badge: badgeRect ? { top: badgeRect.top, right: badgeRect.right, bottom: badgeRect.bottom, left: badgeRect.left, width: badgeRect.width } : null,
        title: titleRect ? { top: titleRect.top, right: titleRect.right, bottom: titleRect.bottom, left: titleRect.left, width: titleRect.width } : null,
        badgeInsideCard: badgeRect ? (badgeRect.right <= cardRect.right + 0.5 && badgeRect.left >= cardRect.left - 0.5) : false,
        badgeMarginRight: badgeRect ? (cardRect.right - badgeRect.right) : 0,
        badgeMarginLeft: badgeRect ? (badgeRect.left - cardRect.left) : 0,
        bodyOverflow,
        htmlOverflow
      };
    });

    auditResults.designOverview[`${vp.width}x${vp.height}`] = dsData;
    console.log(`Design Overview [${vp.width}x${vp.height}]: exists=${dsData.exists}, card width=${dsData.card?.width?.toFixed(1) || 'N/A'}, badgeInside=${dsData.badgeInsideCard}, badgeMarginRight=${dsData.badgeMarginRight?.toFixed(1)}px, asideWidth=${dsData.asideWidth}`);
    await page.screenshot({ path: path.join(screenshotDir, `ds_overview_${vp.width}x${vp.height}.png`) });
    await page.close();
  }

  console.log('\n=== STEP 2: AI ASSISTANT LAYOUT TRACE & THREE SIZING CASES ===');
  // Complete layout trace on 1440x900
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);

    const trace = await page.evaluate(() => {
      const getStyles = (el) => {
        if (!el) return null;
        const s = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          className: el.className,
          id: el.id,
          role: el.getAttribute('role'),
          testId: el.getAttribute('data-testid'),
          rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height },
          computed: {
            height: s.height,
            minHeight: s.minHeight,
            maxHeight: s.maxHeight,
            overflowY: s.overflowY,
            overflowX: s.overflowX,
            display: s.display,
            flexDirection: s.flexDirection,
            flexGrow: s.flexGrow,
            flexShrink: s.flexShrink,
            flexBasis: s.flexBasis,
            padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
            margin: `${s.marginTop} ${s.marginRight} ${s.marginBottom} ${s.marginLeft}`,
            position: s.position
          },
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight
        };
      };

      const contextualTabs = document.querySelector('[role="tablist"][aria-label="Edit workspace views"]')?.parentElement;
      const chatPanel = document.querySelector('[data-testid="ai-chat-panel"]');
      const panelHeader = chatPanel?.querySelector('div:first-child');
      const scrollContainer = document.querySelector('[data-testid="chat-messages-container"]');
      const emptyState = document.querySelector('[data-testid="chat-empty-state"]');
      const icon = document.querySelector('[data-testid="chat-empty-icon"]');
      const heroText = document.querySelector('[data-testid="chat-empty-heading"]');
      const suggestedPrompts = emptyState?.querySelector('.space-y-1\\.5') || emptyState?.querySelector('div.w-full');
      const promptInputContainer = chatPanel?.querySelector('form')?.parentElement;

      return {
        contextualTabs: getStyles(contextualTabs),
        chatPanel: getStyles(chatPanel),
        panelHeader: getStyles(panelHeader),
        scrollContainer: getStyles(scrollContainer),
        emptyState: getStyles(emptyState),
        icon: getStyles(icon),
        heroText: getStyles(heroText),
        suggestedPrompts: getStyles(suggestedPrompts),
        promptInputContainer: getStyles(promptInputContainer)
      };
    });

    auditResults.aiAssistantLayoutTrace = trace;
    await page.close();
  }

  // Now test Case A (Content shorter than available height), Case B (Content equal), Case C (Content taller)
  console.log('Testing AI Assistant 3 Cases: A (shorter), B (equal), C (taller)...');
  for (const h of [900, 700, 500, 380]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: h } });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => {
      const scrollable = document.querySelector('[data-testid="chat-messages-container"]');
      const icon = document.querySelector('[data-testid="chat-empty-icon"]');
      const emptyState = document.querySelector('[data-testid="chat-empty-state"]');
      const header = document.querySelector('[data-testid="ai-chat-panel"] > div:first-child');
      const contextualTabs = document.querySelector('[role="tablist"][aria-label="Edit workspace views"]')?.parentElement;

      if (!scrollable || !icon) return { exists: false };
      const sRect = scrollable.getBoundingClientRect();
      const iRect = icon.getBoundingClientRect();
      const hRect = header ? header.getBoundingClientRect() : null;
      const tabRect = contextualTabs ? contextualTabs.getBoundingClientRect() : null;

      return {
        viewportHeight: window.innerHeight,
        scrollContainer: { top: sRect.top, bottom: sRect.bottom, height: sRect.height, clientHeight: scrollable.clientHeight, scrollHeight: scrollable.scrollHeight, scrollTop: scrollable.scrollTop },
        icon: { top: iRect.top, bottom: iRect.bottom, height: iRect.height },
        headerBottom: hRect ? hRect.bottom : 0,
        tabsBottom: tabRect ? tabRect.bottom : 0,
        iconMarginFromScrollTop: iRect.top - sRect.top,
        iconVisibleInViewport: iRect.top >= 0 && iRect.bottom <= window.innerHeight,
        iconClippedByScrollContainer: iRect.top < sRect.top,
        isContentTaller: scrollable.scrollHeight > scrollable.clientHeight
      };
    });

    auditResults.aiAssistantCases[`height_${h}`] = res;
    console.log(`Height ${h}px: scrollHeight=${res.scrollContainer?.scrollHeight}, clientHeight=${res.scrollContainer?.clientHeight}, isContentTaller=${res.isContentTaller}, iconTopMargin=${res.iconMarginFromScrollTop}px, iconClipped=${res.iconClippedByScrollContainer}`);
    await page.screenshot({ path: path.join(screenshotDir, `ai_assistant_height_${h}.png`) });
    await page.close();
  }

  console.log('\n=== STEP 3: AUDITING ALL 6 ACTIVITIES ACROSS RESPONSIVE MATRIX ===');
  for (const vp of MATRIX_VIEWPORTS) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const vpAudit = {
      activities: {},
      overflow: {}
    };

    // Check horizontal page overflow
    vpAudit.overflow = await page.evaluate(() => ({
      windowInnerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      hasBodyHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth + 1,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      hasDocHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    }));

    // Check each activity
    const activities = ['build', 'edit', 'run', 'debug', 'data', 'ship'];
    for (const act of activities) {
      await page.evaluate((a) => {
        const btn = document.querySelector(`button[data-activity="${a}"]`) || document.querySelector(`[data-testid="nav-${a}-tab"]`);
        if (btn) btn.click();
      }, act);
      await page.waitForTimeout(300);

      const actData = await page.evaluate((a) => {
        const aside = document.querySelector('aside[aria-label="Contextual Subsystem Workspace"]');
        const asideRect = aside ? aside.getBoundingClientRect() : null;
        return {
          activity: a,
          asideWidth: asideRect ? asideRect.width : 0,
          asideVisible: asideRect ? asideRect.width > 0 && asideRect.height > 0 : false,
          bodyScrollWidth: document.body.scrollWidth,
          bodyClientWidth: document.body.clientWidth,
          hasOverflow: document.body.scrollWidth > document.body.clientWidth + 1
        };
      }, act);

      vpAudit.activities[act] = actData;
    }

    auditResults.surfaces[vp.name] = vpAudit;
    await page.close();
  }

  // Save audit results to JSON file
  const reportPath = path.resolve('C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/release_audit_data.json');
  fs.writeFileSync(reportPath, JSON.stringify(auditResults, null, 2));
  console.log(`Audit data written to ${reportPath}`);

  await browser.close();
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
