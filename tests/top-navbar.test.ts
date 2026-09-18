import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('TopNavbar UX Refinement Contract', () => {
  const topNavbarFile = path.resolve(__dirname, '../src/components/navbar/TopNavbar.tsx');
  const shipPanelFile = path.resolve(__dirname, '../src/components/panels/ShipManagerPanel.tsx');
  const dataPanelFile = path.resolve(__dirname, '../src/components/panels/DataManagerPanel.tsx');

  const navbarContent = fs.readFileSync(topNavbarFile, 'utf-8');
  const shipContent = fs.readFileSync(shipPanelFile, 'utf-8');
  const dataContent = fs.readFileSync(dataPanelFile, 'utf-8');

  it('declares the 4 intentional layout groups with strict test IDs', () => {
    expect(navbarContent).toContain('data-testid="nav-left-group"');
    expect(navbarContent).toContain('data-testid="nav-center-group"');
    expect(navbarContent).toContain('data-testid="nav-ai-status-group"');
    expect(navbarContent).toContain('data-testid="nav-right-group"');
  });

  it('completely removes the redundant deploy button from TopNavbar', () => {
    expect(navbarContent).not.toContain('data-testid="nav-deploy-btn"');
    expect(navbarContent).not.toContain('aria-label="Deploy project"');
  });

  it('completely removes the 7 small utility shortcut buttons from TopNavbar', () => {
    expect(navbarContent).not.toContain('data-testid="nav-env-btn"');
    expect(navbarContent).not.toContain('data-testid="nav-database-btn"');
    expect(navbarContent).not.toContain('data-testid="nav-auth-btn"');
    expect(navbarContent).not.toContain('data-testid="open-history-btn"');
    expect(navbarContent).not.toContain('data-testid="import-zip-btn"');
    expect(navbarContent).not.toContain('data-testid="import-github-btn"');
    expect(navbarContent).not.toContain('data-testid="command-palette-btn"');
  });

  it('provides dedicated interactive command palette in center group', () => {
    expect(navbarContent).toContain('data-testid="nav-command-palette-btn"');
    expect(navbarContent).toContain('aria-label="Open Command Palette (Cmd+K)"');
    expect(navbarContent).toContain('⌘K');
  });

  it('separates passive AI telemetry from Command Palette into nav-ai-status-group', () => {
    expect(navbarContent).toContain('data-testid="nav-gemini-status"');
    expect(navbarContent).toContain('Google Gemini');
    expect(navbarContent).toContain('data-testid="nav-runtime-badge"');
    expect(navbarContent).toContain('Runtime:');
  });

  it('places Run Dev as the sole primary action in nav-right-group', () => {
    expect(navbarContent).toContain('data-testid="nav-run-dev-btn"');
    expect(navbarContent).toContain('aria-label="Run Dev Server"');
  });

  it('retains canonical deployment workflow in SHIP activity', () => {
    expect(shipContent).toContain('data-testid="ship-open-deploy-modal-btn"');
    expect(shipContent).toContain('Publish to Live Hosting');
  });

  it('retains canonical data services workflow in DATA activity', () => {
    expect(dataContent).toContain('EnvironmentVariablesManager');
    expect(dataContent).toContain('DatabaseManager');
    expect(dataContent).toContain('AuthManager');
  });

  it('configures intentional responsive compaction classes', () => {
    // AI status hidden on narrow screens (< 1024px) to prevent horizontal collision
    expect(navbarContent).toContain('hidden lg:flex');
    // Runtime badge hidden on < 1280px
    expect(navbarContent).toContain('hidden xl:flex');
  });
});
