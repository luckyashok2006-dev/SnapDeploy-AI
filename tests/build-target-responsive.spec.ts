import { test, expect } from '@playwright/test';

test.describe('BUILD Studio Generation Target & Responsive UX (Chromium)', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept /api/generate to return deterministic, fast mock payloads
    await page.route('**/api/generate', async (route) => {
      const postData = route.request().postData() || '';

      if (postData.includes('Netflix')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            plan: { name: 'netflix-clone-streaming-app' },
            files: {
              '/package.json': JSON.stringify({ name: 'netflix-clone', scripts: { dev: 'vite' } }),
              '/src/App.tsx': 'export default function App() { return <h1>Netflix Clone</h1>; }'
            }
          })
        });
        return;
      }

      // Default mock generation for Amazon
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          plan: { name: 'clone-of-amazon-ecommerce-app' },
          files: {
            '/package.json': JSON.stringify({ name: 'amazon-clone', scripts: { dev: 'vite' } }),
            '/index.html': '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
            '/src/main.tsx': 'import React from "react";\nimport App from "./App";',
            '/src/App.tsx': 'export default function App() { return <h1>Amazon Storefront</h1>; }'
          }
        })
      });
    });

    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Attach stores to window and mock WebContainer mount to resolve instantly in focused browser tests
    await page.evaluate(async () => {
      const { useRuntimeStore } = await import('/src/store/runtimeStore.ts');
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const { vfsManager } = await import('/src/lib/vfs/vfs-manager.ts');
      (window as any).useRuntimeStore = useRuntimeStore;
      (window as any).useProjectStore = useProjectStore;
      (window as any).vfsManager = vfsManager;
      (window as any).__FAIL_MOUNT__ = false;

      useRuntimeStore.setState({
        mountAndStartProject: async (projectId: string) => {
          if ((window as any).__FAIL_MOUNT__) {
            throw new Error('Simulated WebContainer boot failure');
          }
          useRuntimeStore.setState({ status: 'ready', previewUrl: 'http://localhost:3000/preview-mock' });
        }
      });
    });
  });

  test('SCENARIO A: Empty active project ("Amazon") is populated in-place without creating duplicate project', async ({ page }) => {
    test.setTimeout(45000);

    // 1. Open project menu and create project named "Amazon"
    const projectTrigger = page.locator('[data-testid="project-dropdown-trigger"]');
    await expect(projectTrigger).toBeVisible();
    await projectTrigger.click();

    const newBtn = page.locator('[data-testid="dropdown-new-btn"]');
    await expect(newBtn).toBeVisible();
    await newBtn.click();

    const input = page.locator('[data-testid="new-project-input"]');
    await expect(input).toBeVisible();
    await input.fill('Amazon');
    await input.press('Enter');

    // Verify "Amazon" is active and currently has 0 files
    await expect(projectTrigger).toContainText('Amazon');
    const projectCountBefore = await page.evaluate(() => {
      const state = (window as any).useProjectStore.getState();
      const activeId = state.activeProjectId;
      const proj = state.projects[activeId];
      return {
        totalProjects: Object.keys(state.projects || {}).length,
        fileCount: Object.keys(proj?.files || {}).length,
        title: proj?.title
      };
    });
    expect(projectCountBefore.title).toBe('Amazon');
    expect(projectCountBefore.fileCount).toBe(0);

    // 2. Switch to BUILD Studio
    const buildNavTab = page.locator('[data-testid="nav-tab-build"]');
    await expect(buildNavTab).toBeVisible();
    await buildNavTab.click();

    // 3. Fill in prompt and generate
    const promptInput = page.locator('textarea').first();
    await expect(promptInput).toBeVisible();
    await promptInput.fill('Build a clone of Amazon e-commerce app.');

    const generateBtn = page.locator('button:has-text("Generate Application")');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // 4. Wait for success state
    const titleEl = page.locator('[data-testid="generated-project-title"]');
    await expect(titleEl).toBeVisible({ timeout: 20000 });

    // 5. Verify success copy: "Application Built" and "Amazon is Ready"
    await expect(page.locator('text=Application Built')).toBeVisible();
    await expect(titleEl).toContainText('Amazon is Ready');

    // 6. Verify Store and Project Identity: NO duplicate project created!
    const projectCountAfter = await page.evaluate(() => {
      const state = (window as any).useProjectStore.getState();
      const activeId = state.activeProjectId;
      const proj = state.projects[activeId];
      return {
        totalProjects: Object.keys(state.projects || {}).length,
        fileCount: Object.keys(proj?.files || {}).length,
        title: proj?.title,
        hasAppTsx: Boolean(proj?.files['/src/App.tsx'])
      };
    });

    // Total projects must still equal the exact count before (NO second project!)
    expect(projectCountAfter.totalProjects).toBe(projectCountBefore.totalProjects);
    expect(projectCountAfter.title).toBe('Amazon');
    expect(projectCountAfter.fileCount).toBeGreaterThanOrEqual(4);
    expect(projectCountAfter.hasAppTsx).toBe(true);

    // 7. Verify action buttons are visible and accessible
    const openInEditorBtn = page.locator('[data-testid="open-project-btn"]');
    const createAnotherBtn = page.locator('[data-testid="create-another-btn"]');
    await expect(openInEditorBtn).toBeVisible();
    await expect(createAnotherBtn).toBeVisible();
  });

  test('SCENARIO B: Populated active project generates into an isolated new project', async ({ page }) => {
    test.setTimeout(45000);

    // Setup: Populate the active project with files
    const setupInfo = await page.evaluate(async () => {
      const store = (window as any).useProjectStore;
      const amazonId = store.getState().createProject('Amazon');
      store.getState().setActiveProjectId(amazonId);
      await store.getState().writeFilesBulk(amazonId, {
        '/src/App.tsx': 'export default function App() { return <div>Original Amazon</div>; }',
        '/package.json': '{"name": "amazon"}'
      });
      return {
        amazonId,
        projectsBefore: Object.keys(store.getState().projects).length
      };
    });

    // Switch to BUILD Studio
    const buildNavTab = page.locator('[data-testid="nav-tab-build"]');
    await buildNavTab.click();

    // Enter prompt for Netflix
    const promptInput = page.locator('textarea').first();
    await promptInput.fill('Build a Netflix clone streaming app.');

    const generateBtn = page.locator('button:has-text("Generate Application")');
    await generateBtn.click();

    // Wait for success card
    const titleEl = page.locator('[data-testid="generated-project-title"]');
    await expect(titleEl).toBeVisible({ timeout: 20000 });

    // Verify copy for CASE B: "Application Created"
    await expect(page.locator('text=Application Created')).toBeVisible();

    // Verify a new project was created and Amazon was preserved untouched
    const afterInfo = await page.evaluate((amazonId) => {
      const store = (window as any).useProjectStore;
      const state = store.getState();
      const activeProj = state.projects[state.activeProjectId];
      const amazonProj = state.projects[amazonId];
      return {
        projectsAfter: Object.keys(state.projects).length,
        activeTitle: activeProj?.title,
        amazonFileContent: amazonProj?.files['/src/App.tsx']?.content,
        isNewProjectActive: state.activeProjectId !== amazonId
      };
    }, setupInfo.amazonId);

    expect(afterInfo.projectsAfter).toBe(setupInfo.projectsBefore + 1);
    expect(afterInfo.isNewProjectActive).toBe(true);
    expect(afterInfo.amazonFileContent).toContain('Original Amazon');
  });

  test('SCENARIO C: Generation failure in empty project rolls back cleanly', async ({ page }) => {
    test.setTimeout(45000);

    // Create empty project "Amazon" and inject failure into mount step
    const emptyProjId = await page.evaluate(() => {
      const store = (window as any).useProjectStore;
      const id = store.getState().createProject('Amazon');
      store.getState().setActiveProjectId(id);

      // Instruct mountAndStartProject to fail after files have been written
      (window as any).__FAIL_MOUNT__ = true;

      return id;
    });

    // Switch to BUILD Studio
    await page.locator('[data-testid="nav-tab-build"]').click();

    // Enter prompt
    const promptInput = page.locator('textarea').first();
    await promptInput.fill('Build a clone of Amazon e-commerce app.');

    const generateBtn = page.locator('button:has-text("Generate Application")');
    await generateBtn.click();

    // Verify error state is reached in UI
    await expect(page.locator('text=Simulated WebContainer boot failure')).toBeVisible({ timeout: 20000 });

    // Verify empty project was preserved, title is intact, and rollback cleared all files
    const rollbackState = await page.evaluate((id) => {
      const store = (window as any).useProjectStore;
      const vfs = (window as any).vfsManager;
      const state = store.getState();
      const proj = state.projects[id];
      const vfsFiles = vfs.getFiles(id);
      return {
        projectExists: Boolean(proj),
        title: proj?.title,
        storeFileCount: Object.keys(proj?.files || {}).length,
        vfsFileCount: Object.keys(vfsFiles || {}).length,
        activeProjectId: state.activeProjectId
      };
    }, emptyProjId);

    expect(rollbackState.projectExists).toBe(true);
    expect(rollbackState.title).toBe('Amazon');
    expect(rollbackState.storeFileCount).toBe(0);
    expect(rollbackState.vfsFileCount).toBe(0);
    expect(rollbackState.activeProjectId).toBe(emptyProjId);
  });

  test('RESPONSIVE: Success panel at 560px, 480px, 420px, 380px, 360px, 320px container widths', async ({ page }) => {
    test.setTimeout(45000);

    // Switch to BUILD and generate Amazon
    await page.locator('[data-testid="nav-tab-build"]').click();
    const promptInput = page.locator('textarea').first();
    await promptInput.fill('Build Amazon clone');
    await page.locator('button:has-text("Generate Application")').click();

    const titleEl = page.locator('[data-testid="generated-project-title"]');
    await expect(titleEl).toBeVisible({ timeout: 20000 });

    const widths = [560, 480, 420, 380, 360, 320];

    for (const width of widths) {
      // Set panel container width dynamically via DOM style
      await page.evaluate((w) => {
        const aside = document.querySelector('aside[aria-label="Contextual Subsystem Workspace"]') as HTMLElement;
        if (aside) {
          aside.style.width = `${w}px`;
          aside.style.maxWidth = `${w}px`;
          aside.style.minWidth = `${w}px`;
        }
      }, width);

      await page.waitForTimeout(200);

      // Verify NO horizontal overflow: scrollWidth must be <= clientWidth
      const overflowMetrics = await page.evaluate(() => {
        const aside = document.querySelector('aside[aria-label="Contextual Subsystem Workspace"]') as HTMLElement;
        const successContainer = aside?.querySelector('.bg-emerald-500\\/10') as HTMLElement;
        return {
          asideScrollWidth: aside?.scrollWidth || 0,
          asideClientWidth: aside?.clientWidth || 0,
          cardScrollWidth: successContainer?.scrollWidth || 0,
          cardClientWidth: successContainer?.clientWidth || 0,
          hasHorizontalScroll: (aside?.scrollWidth || 0) > (aside?.clientWidth || 0) + 1
        };
      });

      expect(overflowMetrics.hasHorizontalScroll).toBe(false);
      expect(overflowMetrics.cardScrollWidth).toBeLessThanOrEqual(overflowMetrics.cardClientWidth + 1);

      // Verify controls are visible and readable at this width
      const openInEditorBtn = page.locator('[data-testid="open-project-btn"]');
      const createAnotherBtn = page.locator('[data-testid="create-another-btn"]');
      const quickInput = page.locator('[data-testid="quick-next-prompt-input"]');
      const quickBuildBtn = page.locator('[data-testid="quick-generate-next-btn"]');

      await expect(openInEditorBtn).toBeVisible();
      await expect(createAnotherBtn).toBeVisible();
      await expect(quickInput).toBeVisible();
      await expect(quickBuildBtn).toBeVisible();
    }
  });
});
