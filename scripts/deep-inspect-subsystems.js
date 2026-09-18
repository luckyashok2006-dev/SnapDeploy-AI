import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const screenshotDir = path.resolve('C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/screenshots/deep_audit');
fs.mkdirSync(screenshotDir, { recursive: true });

async function deepAudit() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = {};

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // A. TOP NAVIGATION
  console.log('--- Checking Top Navigation ---');
  // Project dropdown
  const projectDropdownBtn = page.locator('button[aria-haspopup="listbox"]');
  const projectDropdownExists = await projectDropdownBtn.count() > 0;
  if (projectDropdownExists) {
    await projectDropdownBtn.click();
    await page.waitForTimeout(200);
    const dropdownMenu = page.locator('[role="listbox"]');
    report.projectDropdown = {
      exists: true,
      menuVisible: await dropdownMenu.isVisible(),
      itemCount: await page.locator('[role="option"]').count()
    };
    await page.screenshot({ path: path.join(screenshotDir, '01_top_project_dropdown.png') });
    // Click outside to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Command Palette
  console.log('--- Checking Command Palette ---');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  const commandPaletteModal = page.locator('[role="dialog"][aria-label="Command Palette"]');
  const cpVisible = await commandPaletteModal.isVisible();
  report.commandPalette = {
    opensWithCtrlK: cpVisible,
    inputFocused: await page.evaluate(() => document.activeElement?.getAttribute('placeholder')?.includes('Type a command') || false)
  };
  await page.screenshot({ path: path.join(screenshotDir, '02_command_palette.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // B. PRIMARY NAVIGATION & CONSOLE
  console.log('--- Checking Primary Navigation & Console ---');
  const consoleBtn = page.locator('[data-testid="nav-console-toggle-btn"]');
  await consoleBtn.click();
  await page.waitForTimeout(300);
  const bottomDrawer = page.locator('footer[aria-label="Engineering Console Drawer"]');
  report.consoleDrawer = {
    openedOnClick: await bottomDrawer.isVisible(),
    terminalTabVisible: await page.locator('[data-testid="bottom-tab-terminal"]').isVisible(),
    issuesTabVisible: await page.locator('[data-testid="bottom-tab-issues"]').isVisible(),
    checksTabVisible: await page.locator('[data-testid="bottom-tab-checks"]').isVisible()
  };
  await page.screenshot({ path: path.join(screenshotDir, '03_console_drawer_open.png') });
  // Close console
  await consoleBtn.click();
  await page.waitForTimeout(200);

  // C. EDIT WORKSPACE: 4 Contextual Subviews
  console.log('--- Checking Edit Subviews ---');
  await page.locator('button[data-activity="edit"]').click();
  await page.waitForTimeout(300);

  // Subview 1: Chat
  await page.locator('button[data-testid="nav-chat-tab"]').click();
  await page.waitForTimeout(300);
  report.editChat = {
    panelVisible: await page.locator('[data-testid="ai-chat-panel"]').isVisible(),
    emptyStateVisible: await page.locator('[data-testid="chat-empty-state"]').isVisible(),
    promptInputVisible: await page.locator('[data-testid="chat-prompt-input"]').isVisible()
  };
  await page.screenshot({ path: path.join(screenshotDir, '04_edit_chat.png') });

  // Subview 2: Files
  await page.locator('button[data-testid="subview-files-tab"]').click();
  await page.waitForTimeout(300);
  const fileExplorer = page.locator('[data-testid="file-explorer-tree"]') || page.locator('aside');
  report.editFiles = {
    fileListCount: await page.locator('[data-testid^="file-item-"]').count()
  };
  await page.screenshot({ path: path.join(screenshotDir, '05_edit_files.png') });

  // Subview 3: History
  await page.locator('button[data-testid="nav-history-tab"]').click();
  await page.waitForTimeout(300);
  report.editHistory = {
    historyPanelVisible: await page.locator('button:has-text("Create Checkpoint")').isVisible()
  };
  await page.screenshot({ path: path.join(screenshotDir, '06_edit_history.png') });

  // Subview 4: Design System - ALL 5 SUBTABS
  console.log('--- Checking Design System 5 Subtabs ---');
  await page.locator('button[data-testid="nav-design-system-tab"]').click();
  await page.waitForTimeout(300);

  // Design Tab 1: Overview
  report.designOverview = {
    cardVisible: await page.locator('[data-testid="ds-tab-overview"]').isVisible(),
    applyToCodeHeroVisible: await page.locator('button:has-text("Apply to Code")').isVisible(),
    actionsGridVisible: await page.locator('[data-testid="ds-tab-overview"] button').count()
  };
  await page.screenshot({ path: path.join(screenshotDir, '07_design_subtab_overview.png') });

  // Design Tab 2: Tokens
  await page.locator('[data-testid="ds-subtab-tokens"]').click();
  await page.waitForTimeout(300);
  report.designTokens = {
    tabVisible: await page.locator('[data-testid="ds-tab-tokens"]').isVisible(),
    swatchesCount: await page.locator('[data-testid="ds-tab-tokens"] .rounded-lg').count()
  };
  await page.screenshot({ path: path.join(screenshotDir, '08_design_subtab_tokens.png') });

  // Design Tab 3: Components
  await page.locator('[data-testid="ds-subtab-components"]').click();
  await page.waitForTimeout(300);
  report.designComponents = {
    tabVisible: await page.locator('[data-testid="ds-tab-components"]').isVisible(),
    componentCount: await page.locator('[data-testid="ds-tab-components"] > div').count()
  };
  await page.screenshot({ path: path.join(screenshotDir, '09_design_subtab_components.png') });

  // Design Tab 4: Sources
  await page.locator('[data-testid="ds-subtab-sources"]').click();
  await page.waitForTimeout(300);
  report.designSources = {
    tabVisible: await page.locator('[data-testid="ds-tab-sources"]').isVisible(),
    sourcesCount: await page.locator('[data-testid="ds-tab-sources"] .rounded-xl').count()
  };
  await page.screenshot({ path: path.join(screenshotDir, '10_design_subtab_sources.png') });

  // Design Tab 5: Validation & Drift
  await page.locator('[data-testid="ds-subtab-drift"]').click();
  await page.waitForTimeout(300);
  report.designDrift = {
    tabVisible: await page.locator('[data-testid="ds-tab-drift"]').isVisible(),
    validationCardVisible: await page.locator('[data-testid="ds-validation-card"]').isVisible()
  };
  await page.screenshot({ path: path.join(screenshotDir, '11_design_subtab_drift.png') });

  // E. DATA WORKSPACE (3 tabs: Environment, Database, Auth)
  console.log('--- Checking Data Workspace ---');
  await page.locator('button[data-activity="data"]').click();
  await page.waitForTimeout(300);
  // Check 3 subtabs
  report.dataWorkspace = {
    panelVisible: await page.locator('aside[aria-label="Contextual Subsystem Workspace"]').isVisible(),
    envTabVisible: await page.locator('button:has-text("Environment")').isVisible(),
    dbTabVisible: await page.locator('button:has-text("Database")').isVisible(),
    authTabVisible: await page.locator('button:has-text("Auth")').isVisible()
  };
  await page.screenshot({ path: path.join(screenshotDir, '12_data_env.png') });

  // Switch to Database
  await page.locator('button:has-text("Database")').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotDir, '13_data_db.png') });

  // Switch to Auth
  await page.locator('button:has-text("Auth")').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotDir, '14_data_auth.png') });

  // F. SHIP WORKSPACE (Deploy, GitHub, History)
  console.log('--- Checking Ship Workspace ---');
  await page.locator('button[data-activity="ship"]').click();
  await page.waitForTimeout(300);
  report.shipWorkspace = {
    deployTabVisible: await page.locator('button:has-text("Deploy")').first().isVisible(),
    githubTabVisible: await page.locator('button:has-text("GitHub")').isVisible(),
    historyTabVisible: await page.locator('button:has-text("History")').isVisible(),
    openDialogBtnVisible: await page.locator('[data-testid="open-full-deploy-dialog-btn"]').isVisible()
  };
  await page.screenshot({ path: path.join(screenshotDir, '15_ship_deploy.png') });

  // G. RUN WORKSPACE
  console.log('--- Checking Run Workspace ---');
  await page.locator('button[data-activity="run"]').click();
  await page.waitForTimeout(300);
  report.runWorkspace = {
    previewVisible: await page.locator('section[aria-label="Live Application Preview"]').isVisible()
  };
  await page.screenshot({ path: path.join(screenshotDir, '16_run_workspace.png') });

  // H. DEBUG WORKSPACE
  console.log('--- Checking Debug Workspace ---');
  await page.locator('button[data-activity="debug"]').click();
  await page.waitForTimeout(300);
  report.debugWorkspace = {
    panelVisible: await page.locator('aside[aria-label="Contextual Subsystem Workspace"]').isVisible(),
    diagnosticsScoreVisible: await page.locator('span:has-text("Health Score")').count() > 0
  };
  await page.screenshot({ path: path.join(screenshotDir, '17_debug_workspace.png') });

  fs.writeFileSync(
    'C:/Users/dell/.gemini/antigravity/brain/3e35e182-de4d-4e4f-880f-ed74d9a344e3/subsystems_audit_report.json',
    JSON.stringify(report, null, 2)
  );
  console.log('Deep audit completed successfully.');
  await browser.close();
}

deepAudit().catch(err => {
  console.error('Deep audit failed:', err);
  process.exit(1);
});
