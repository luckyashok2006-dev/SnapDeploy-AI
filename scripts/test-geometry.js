import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 1024, height: 500 },
    { width: 900, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 375, height: 812 },
    { width: 375, height: 500 }
  ];

  for (const vp of viewports) {
    console.log(`\n================ VIEWPORT ${vp.width}x${vp.height} ================`);
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button[data-activity="edit"]', { timeout: 10000 });
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => {
      const scrollableBody = document.querySelector('[data-testid="chat-messages-container"]') || document.querySelector('[data-testid="ai-chat-panel"] > div.overflow-y-auto');
      const sparklesIcon = document.querySelector('[data-testid="chat-empty-icon"]') || scrollableBody?.querySelector('svg');
      const heroH3 = document.querySelector('[data-testid="chat-empty-heading"]') || scrollableBody?.querySelector('h3');
      const panelHeader = document.querySelector('[data-testid="ai-chat-panel"] > div:first-child');
      const contextualTabBar = document.querySelector('[role="tablist"][aria-label="Edit workspace views"]');
      const promptInput = document.querySelector('[data-testid="chat-prompt-input"]');
      const emptyState = document.querySelector('[data-testid="chat-empty-state"]');

      function b(el, name) {
        if (!el) return { name, exists: false };
        const r = el.getBoundingClientRect();
        return {
          name,
          exists: true,
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          left: r.left,
          right: r.right,
          width: r.width,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight
        };
      }

      return {
        contextualTabBar: b(contextualTabBar, 'contextualTabBar'),
        panelHeader: b(panelHeader, 'panelHeader'),
        scrollableBody: b(scrollableBody, 'scrollableBody'),
        emptyState: b(emptyState, 'emptyState'),
        sparklesIcon: b(sparklesIcon, 'sparklesIcon'),
        heroH3: b(heroH3, 'heroH3'),
        promptInput: b(promptInput, 'promptInput'),
        isIconInsideUsableBody: sparklesIcon && scrollableBody
          ? sparklesIcon.getBoundingClientRect().top >= scrollableBody.getBoundingClientRect().top
            && sparklesIcon.getBoundingClientRect().bottom <= scrollableBody.getBoundingClientRect().bottom
          : false,
        iconTopMargin: sparklesIcon && scrollableBody ? sparklesIcon.getBoundingClientRect().top - scrollableBody.getBoundingClientRect().top : 0
      };
    });

    console.log('Contextual TabBar:    ', res.contextualTabBar.top, '->', res.contextualTabBar.bottom);
    console.log('Panel Header:         ', res.panelHeader.top, '->', res.panelHeader.bottom);
    console.log('Scrollable Body:      ', res.scrollableBody.top, '->', res.scrollableBody.bottom, 'scrollTop:', res.scrollableBody.scrollTop, 'scrollHeight:', res.scrollableBody.scrollHeight, 'clientHeight:', res.scrollableBody.clientHeight);
    console.log('Sparkles Icon:        ', res.sparklesIcon.top, '->', res.sparklesIcon.bottom);
    console.log('Hero H3:              ', res.heroH3.top, '->', res.heroH3.bottom);
    console.log('Prompt Input:         ', res.promptInput.top, '->', res.promptInput.bottom);
    console.log('Icon Top vs Body Top: ', res.iconTopMargin.toFixed(1), 'px margin');
    console.log('Is Icon visible/safe? ', res.isIconInsideUsableBody ? 'YES, SAFE & VISIBLE!' : 'CHECK');

    await page.close();
  }

  // Check Design System Overview Card badge geometry across multiple viewports!
  console.log('\n================ DESIGN SYSTEM BADGE GEOMETRY ================');
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button[data-activity="edit"]', { timeout: 10000 });
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[data-testid="nav-design-system-tab"]').click();
    await page.waitForTimeout(400);

    const dsRes = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="ds-tab-overview"] > div:first-child');
      const title = document.querySelector('[data-testid="ds-title"]');
      const badge = card ? card.querySelector('span.uppercase') : null;

      function b(el, name) {
        if (!el) return { name, exists: false };
        const r = el.getBoundingClientRect();
        return { name, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
      }

      const cardRect = card ? card.getBoundingClientRect() : null;
      const badgeRect = badge ? badge.getBoundingClientRect() : null;

      return {
        card: b(card, 'card'),
        title: b(title, 'title'),
        badge: b(badge, 'badge'),
        badgeInsideCard: badgeRect && cardRect ? badgeRect.right <= cardRect.right && badgeRect.left >= cardRect.left : false,
        marginFromRight: badgeRect && cardRect ? cardRect.right - badgeRect.right : 0
      };
    });

    console.log(`[${vp.width}x${vp.height}] Overview Card right: ${dsRes.card.right.toFixed(1)}, Badge right: ${dsRes.badge.right.toFixed(1)}, Padding from right: ${dsRes.marginFromRight.toFixed(1)}px, Fully Inside: ${dsRes.badgeInsideCard ? 'YES' : 'NO'}`);
    await page.close();
  }

  await browser.close();
}

run().catch(console.error);
