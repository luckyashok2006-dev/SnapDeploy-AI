import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('SnapDeploy AI v1.0.0-rc.1 — Workspace Interior UI/UX Forensic Contracts', () => {
  const sidebarFile = path.resolve(__dirname, '../src/components/ide/SidebarNav.tsx');
  const appLayoutFile = path.resolve(__dirname, '../src/components/layout/AppLayout.tsx');
  const editSubsystemFile = path.resolve(__dirname, '../src/components/panels/EditSubsystemPanel.tsx');
  const aiChatFile = path.resolve(__dirname, '../src/components/chat/AIChatPanel.tsx');
  const designSystemFile = path.resolve(__dirname, '../src/components/design-system/DesignSystemPanel.tsx');
  const authManagerFile = path.resolve(__dirname, '../src/components/auth/AuthManager.tsx');
  const shipManagerFile = path.resolve(__dirname, '../src/components/panels/ShipManagerPanel.tsx');

  const sidebarSrc = fs.readFileSync(sidebarFile, 'utf-8');
  const appLayoutSrc = fs.readFileSync(appLayoutFile, 'utf-8');
  const editSubsystemSrc = fs.readFileSync(editSubsystemFile, 'utf-8');
  const aiChatSrc = fs.readFileSync(aiChatFile, 'utf-8');
  const designSystemSrc = fs.readFileSync(designSystemFile, 'utf-8');
  const authManagerSrc = fs.readFileSync(authManagerFile, 'utf-8');
  const shipManagerSrc = fs.readFileSync(shipManagerFile, 'utf-8');

  describe('1. Sidebar Tooltip System & Keyboard Traversal', () => {
    it('1. Uses native browser title attribute on all rail navigation buttons and console', () => {
      expect(sidebarSrc).toContain('title={`${item.label} (${item.shortcut})`}');
      expect(sidebarSrc).toContain('title="Console"');
    });

    it('2. Completely eliminates custom in-DOM floating tooltip pill elements to prevent UI collision', () => {
      expect(sidebarSrc).not.toContain('role="tooltip"');
      expect(sidebarSrc).not.toContain('pointer-events-none whitespace-nowrap z-50');
    });

    it('3. Retains accessible aria-label and aria-current semantics', () => {
      expect(sidebarSrc).toContain('aria-label={`${item.label} workspace`}');
      expect(sidebarSrc).toContain('aria-current={isActive ? \'page\' : undefined}');
      expect(sidebarSrc).toContain('aria-label="Toggle Engineering Console"');
    });

    it('4. Eliminates legacy hidden shortcut stubs to prevent click interception and duplicate selectors', () => {
      expect(sidebarSrc).not.toContain('pointer-events-none overflow-hidden');
      expect(sidebarSrc).not.toContain('tabIndex={-1}');
    });
  });

  describe('2. Edit Entry State & Session Persistence', () => {
    it('5. Edit defaults to AI Assistant on clean entry', () => {
      expect(appLayoutSrc).toContain("useState<'chat' | 'files' | 'history' | 'design'>('chat')");
      expect(editSubsystemSrc).toContain("initialSubView = 'chat'");
    });

    it('6. Switching primary activities does NOT overwrite editSubView to files', () => {
      expect(sidebarSrc).not.toContain("onSelectEditSubView('files')");
      expect(appLayoutSrc).not.toContain("if (item.id === 'edit') setEditSubView('files')");
    });

    it('7. Reset clean default subview to AI Assistant on project switch', () => {
      expect(appLayoutSrc).toContain('previousProjectIdRef');
      expect(appLayoutSrc).toContain("setEditSubView('chat')");
    });

    it('7b. Compact Edit Subnav (UX-01): uses layout-aware compact representation without generic sm breakpoint', () => {
      expect(editSubsystemSrc).toContain('isCompact');
      expect(editSubsystemSrc).toContain("isCompact ? 'AI' : 'AI Assistant'");
      expect(editSubsystemSrc).toContain('title="AI Chat & Assistant"');
      expect(editSubsystemSrc).toContain('aria-label="AI Chat & Assistant"');
      expect(editSubsystemSrc).toContain('data-testid="nav-design-system-tab"');
      expect(appLayoutSrc).toContain('isCompactSidebar');
      expect(appLayoutSrc).toContain('effectiveSidebarWidth <= 280');
    });

    it('7c. Mobile Edit Switcher (UX-02): provides [Code] / [Workspace] switcher and full width access on mobile', () => {
      expect(appLayoutSrc).toContain('data-testid="mobile-edit-switcher"');
      expect(appLayoutSrc).toContain('data-testid="mobile-edit-tab-code"');
      expect(appLayoutSrc).toContain('data-testid="mobile-edit-tab-workspace"');
      expect(appLayoutSrc).toContain("mobileEditMode === 'code'");
      expect(appLayoutSrc).toContain("mobileEditMode === 'workspace'");
    });
  });

  describe('3. AI Assistant Positive-Space Safe Layout & Hierarchy', () => {
    it('8. Empty state flows naturally in positive scroll space with safe centering', () => {
      expect(aiChatSrc).toContain('my-auto');
      expect(aiChatSrc).not.toContain('min-h-full flex flex-col items-center justify-center');
      expect(aiChatSrc).toContain('my-auto flex flex-col items-center text-center py-3 px-3 sm:px-4 space-y-4 max-w-sm mx-auto shrink-0 w-full');
    });

    it('9. Panel header avoids redundant AI Assistant repetition', () => {
      expect(aiChatSrc).toContain('Code Assistant');
      expect(aiChatSrc).not.toMatch(/AI Development Chat/);
      expect(aiChatSrc).toContain('data-testid="chat-active-project-name"');
    });

    it('10. Preserves all quick action suggestions and chat interactions', () => {
      expect(aiChatSrc).toContain('quickPrompts');
      expect(aiChatSrc).toContain('Suggested Prompts');
      expect(aiChatSrc).toContain('data-testid="ai-chat-panel"');
    });
  });

  describe('4. Design System Complete Accessibility & Interior Polish', () => {
    it('11. All 5 existing subviews remain defined and reachable in the navigation', () => {
      expect(designSystemSrc).toContain("id: 'overview', label: 'Overview'");
      expect(designSystemSrc).toContain("id: 'tokens', label: 'Tokens'");
      expect(designSystemSrc).toContain("id: 'components', label: 'Components'");
      expect(designSystemSrc).toContain("id: 'sources', label: 'Sources'");
      expect(designSystemSrc).toContain("id: 'drift', label: 'Validation & Drift'");
    });

    it('12. Sub-tab strip handles constrained widths with overflow-x-auto and shrink-0', () => {
      expect(designSystemSrc).toContain('overflow-x-auto min-w-0');
      expect(designSystemSrc).toContain('shrink-0');
      expect(designSystemSrc).toContain('role="tablist"');
      expect(designSystemSrc).toContain('role="tab"');
    });

    it('13. Validation & Drift retains full meaningful label and drift count badge', () => {
      expect(designSystemSrc).toContain('Validation & Drift');
      expect(designSystemSrc).toContain('activeDrifts.length');
    });

    it('14. Overview actions use full-width Apply to Code card and 2-column wrapping grid without truncation', () => {
      expect(designSystemSrc).toContain('data-testid="ds-btn-apply-source"');
      expect(designSystemSrc).toContain('data-testid="ds-btn-extract"');
      expect(designSystemSrc).toContain('data-testid="ds-btn-validate"');
      expect(designSystemSrc).toContain('data-testid="ds-btn-drift"');
      expect(designSystemSrc).toContain('data-testid="ds-btn-export"');
      expect(designSystemSrc).toContain('data-testid="ds-btn-import"');
      expect(designSystemSrc).toContain('leading-snug text-left');
      expect(designSystemSrc).not.toMatch(/<span className="truncate">Extract from VFS<\/span>/);
    });

    it('15. Semantic Palette Swatches uses 2-column grid to fit token key and hex value cleanly', () => {
      expect(designSystemSrc).toContain('data-testid="ds-palette-grid"');
      expect(designSystemSrc).toContain('grid grid-cols-2 gap-2.5 text-xs');
    });
  });

  describe('5. Auth Manager Responsive Layout & Overflow Protection', () => {
    it('16. Status bar allows long endpoint URLs to break-all safely with min-w-0', () => {
      expect(authManagerSrc).toContain('min-w-0 flex-1');
      expect(authManagerSrc).toContain('break-all');
      expect(authManagerSrc).toContain('shrink-0');
      expect(authManagerSrc).toContain('data-testid="auth-status-pill"');
    });

    it('17. Users & Directory truncates long emails and preserves role badge with shrink-0', () => {
      expect(authManagerSrc).toContain('truncate');
      expect(authManagerSrc).toContain('shrink-0');
      expect(authManagerSrc).toContain('data-testid="auth-users-list"');
    });

    it('18. Generated client code blocks use max-w-full and overflow-x-auto without Copy Snippet button', () => {
      expect(authManagerSrc).toContain('max-w-full');
      expect(authManagerSrc).toContain('overflow-x-auto');
      expect(authManagerSrc).not.toContain('Copy Snippet');
    });
  });

  describe('6. Ship Workspace Distinction & Responsive Layout', () => {
    it('19. Header uses 2-tier layout: Row 1 unified 3-column navigation pill, Row 2 secondary action', () => {
      expect(shipManagerSrc).toContain('role="tablist" aria-label="Ship workspace views" className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-xl border border-white/5"');
      expect(shipManagerSrc).toContain('data-testid="ship-tab-deploy"');
      expect(shipManagerSrc).toContain('data-testid="ship-tab-github"');
      expect(shipManagerSrc).toContain('data-testid="ship-tab-history"');
      expect(shipManagerSrc).toContain('data-testid="ship-open-deploy-modal-btn"');
    });

    it('20. Open Full Dialog action has dedicated row with full label visible on all widths', () => {
      expect(shipManagerSrc).toContain('<span>Open Full Dialog</span>');
      expect(shipManagerSrc).not.toContain('hidden sm:inline');
    });

    it('21. Provider selection controls use responsive grid layout and preflight badges have shrink-0', () => {
      expect(shipManagerSrc).toContain('grid grid-cols-2 gap-2');
      expect(shipManagerSrc).toContain('shrink-0');
      expect(shipManagerSrc).toContain('PASS');
    });
  });
});
