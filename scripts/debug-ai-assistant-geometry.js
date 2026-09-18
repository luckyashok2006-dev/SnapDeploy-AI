import { chromium } from 'playwright';

async function audit() {
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 1024, height: 600 },
    { width: 390, height: 844 },
    { width: 375, height: 600 }
  ];

  for (const vp of viewports) {
    console.log(`\n================ VIEWPORT ${vp.width}x${vp.height} ================`);
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-activity="edit"]').click();
    await page.waitForTimeout(400);

    const data = await page.evaluate(() => {
      const editContainer = document.querySelector('[data-testid="edit-workspace"]') || document.querySelector('div.h-full.flex.flex-col.bg-\\[\\#0B0F17\\]') || document.querySelector('nav[aria-label="Edit workspace views"]')?.parentElement;
      const contextualTabBar = document.querySelector('[role="tablist"][aria-label="Edit workspace views"]');
      const aiPanel = document.querySelector('[data-testid="ai-chat-panel"]');
      const panelHeader = aiPanel ? aiPanel.firstElementChild : null;
      const scrollableBody = aiPanel ? aiPanel.children[1] : null; // or document.querySelector('.custom-scrollbar')
      const emptyStateWrapper = scrollableBody ? scrollableBody.querySelector('.space-y-4') || scrollableBody.firstElementChild : null;
      const sparklesIcon = emptyStateWrapper ? emptyStateWrapper.querySelector('svg') || emptyStateWrapper.firstElementChild : null;
      const heroHeading = emptyStateWrapper ? emptyStateWrapper.querySelector('h3') : null;
      const promptInput = document.querySelector('[data-testid="chat-input-textarea"]') || document.querySelector('textarea');

      function getBox(el, name) {
        if (!el) return { name, exists: false };
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          name,
          exists: true,
          tagName: el.tagName,
          className: el.className,
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflowY: style.overflowY,
          position: style.position,
          display: style.display
        };
      }

      // Trace all ancestors of sparklesIcon
      const hierarchy = [];
      let curr = sparklesIcon;
      while (curr && curr !== document.body) {
        const r = curr.getBoundingClientRect();
        const style = window.getComputedStyle(curr);
        hierarchy.push({
          tag: curr.tagName,
          id: curr.id,
          testId: curr.getAttribute('data-testid'),
          className: curr.className,
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          overflowY: style.overflowY,
          overflow: style.overflow
        });
        curr = curr.parentElement;
      }

      return {
        contextualTabBar: getBox(contextualTabBar, 'contextualTabBar'),
        aiPanel: getBox(aiPanel, 'aiPanel'),
        panelHeader: getBox(panelHeader, 'panelHeader'),
        scrollableBody: getBox(scrollableBody, 'scrollableBody'),
        emptyStateWrapper: getBox(emptyStateWrapper, 'emptyStateWrapper'),
        sparklesIcon: getBox(sparklesIcon, 'sparklesIcon'),
        heroHeading: getBox(heroHeading, 'heroHeading'),
        promptInput: getBox(promptInput, 'promptInput'),
        hierarchy
      };
    });

    console.log('DOM Hierarchy from Icon to Body:');
    data.hierarchy.forEach((h, i) => {
      console.log(`  ${i}: <${h.tag}> [${h.testId || h.className.slice(0, 30)}] top=${h.top.toFixed(1)}, bottom=${h.bottom.toFixed(1)}, height=${h.height.toFixed(1)}, overflowY=${h.overflowY}`);
    });

    console.log('\nKey Elements Boxes:');
    console.log('Contextual Tab Bar:', data.contextualTabBar.top, 'to', data.contextualTabBar.bottom);
    console.log('AI Panel:', data.aiPanel.top, 'to', data.aiPanel.bottom);
    console.log('Panel Header:', data.panelHeader.top, 'to', data.panelHeader.bottom);
    console.log('Scrollable Body:', data.scrollableBody.top, 'to', data.scrollableBody.bottom, 'scrollTop:', data.scrollableBody.scrollTop, 'scrollHeight:', data.scrollableBody.scrollHeight, 'clientHeight:', data.scrollableBody.clientHeight);
    console.log('Empty State Wrapper:', data.emptyStateWrapper.top, 'to', data.emptyStateWrapper.bottom);
    console.log('Sparkles Icon:', data.sparklesIcon.top, 'to', data.sparklesIcon.bottom);
    console.log('Hero Heading:', data.heroHeading.top, 'to', data.heroHeading.bottom);
    console.log('Prompt Input:', data.promptInput.top, 'to', data.promptInput.bottom);

    await page.close();
  }

  await browser.close();
}

audit().catch(console.error);
