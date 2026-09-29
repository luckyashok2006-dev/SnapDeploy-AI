import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useDeploymentStore } from '../src/store/deploymentStore';
import { useAuthStore } from '../src/store/authStore';
import { useProjectStore } from '../src/store/projectStore';
import { setProductionOverride } from '../src/lib/environment';
import { DeploymentModal } from '../src/components/modals/DeploymentModal';
import { ShipManagerPanel } from '../src/components/panels/ShipManagerPanel';
import { AuthManager } from '../src/components/auth/AuthManager';
import { authCoordinator } from '../src/features/auth/auth-coordinator';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { AuthConfig } from '../src/types/auth';

describe('UI/UX Functional Correction: Mock Provider & Add Role', () => {
  const testProjectId = 'saas-dashboard';

  beforeEach(async () => {
    vi.restoreAllMocks();
    setProductionOverride(false);

    // Reset deployment store
    useDeploymentStore.setState({
      selectedProvider: 'mock',
      deployments: {},
      envVarMetadata: {},
      activeDeployments: {}
    });

    // Reset auth store
    useAuthStore.setState({
      selectedProvider: 'mock',
      projectAuthConfig: {},
      projectAuthMetadata: {},
      projectUsers: {}
    });
  });

  afterEach(() => {
    setProductionOverride(null);
  });

  // =========================================================================
  // PART 1: MOCK PROVIDER BEHAVIOR & PARITY
  // =========================================================================
  describe('Part 1: Mock Provider Deployment UI', () => {
    const deploymentModalPath = path.resolve(__dirname, '../src/components/modals/DeploymentModal.tsx');
    const shipPanelPath = path.resolve(__dirname, '../src/components/panels/ShipManagerPanel.tsx');
    const modalSrc = fs.readFileSync(deploymentModalPath, 'utf-8');
    const shipSrc = fs.readFileSync(shipPanelPath, 'utf-8');

    it('source contracts: enforce disabled state, accessible aria attributes, and tooltip in production', () => {
      // DeploymentModal contracts
      expect(modalSrc).toContain('disabled={isProd}');
      expect(modalSrc).toContain('aria-disabled={isProd}');
      expect(modalSrc).toContain("isProd ? 'Mock Provider (Unavailable in production)' : 'Mock Provider (Test/Offline)'");
      expect(modalSrc).toContain('opacity-40 cursor-not-allowed text-slate-500');
      expect(modalSrc).toContain('Mock Provider is unavailable in production. Live deployment uses Netlify.');

      // ShipManagerPanel contracts
      expect(shipSrc).toContain('disabled={isProd}');
      expect(shipSrc).toContain('aria-disabled={isProd}');
      expect(shipSrc).toContain("isProd ? 'Mock Provider (Unavailable in production)' : 'Mock Provider (Test/Offline)'");
      expect(shipSrc).toContain('opacity-40 cursor-not-allowed text-slate-500');
      expect(shipSrc).toContain('Mock Provider is disabled in production. Use Netlify for live deployment.');
    });

    it('LOCAL: allows Mock Provider selection and renders it visibly enabled', () => {
      setProductionOverride(false);

      const store = useDeploymentStore.getState();
      store.setSelectedProvider('mock');
      expect(useDeploymentStore.getState().selectedProvider).toBe('mock');

      // Static render of DeploymentModal in local dev
      const modalHtml = renderToStaticMarkup(
        <DeploymentModal
          isOpen={true}
          projectId={testProjectId}
          onClose={() => {}}
        />
      );

      // Verify Mock Provider button is enabled, selectable, and has no disabled attributes
      expect(modalHtml).toContain('data-testid="select-provider-mock"');
      expect(modalHtml).toContain('data-testid="select-provider-netlify"');
      expect(modalHtml).toContain('bg-violet-600 text-white shadow-sm'); // Selected state
      expect(modalHtml).not.toContain('Mock Provider (Unavailable in production)');
      expect(modalHtml).toContain('Mock Provider Active'); // Active status badge in dev

      // Static render of ShipManagerPanel in local dev
      const shipHtml = renderToStaticMarkup(
        <ShipManagerPanel
          projectId={testProjectId}
          projectTitle="UI Correction Test Project"
          onOpenGitHubModal={() => {}}
          onOpenDeployModal={() => {}}
        />
      );

      expect(shipHtml).toContain('data-testid="ship-select-provider-mock"');
      expect(shipHtml).not.toContain('disabled=""');
    });

    it('PRODUCTION: disables Mock Provider visibly, prevents selection, and keeps Netlify selectable', () => {
      setProductionOverride(true);

      const store = useDeploymentStore.getState();
      // In production, setSelectedProvider('mock') must not change selectedProvider
      store.setSelectedProvider('netlify');
      store.setSelectedProvider('mock');
      expect(useDeploymentStore.getState().selectedProvider).toBe('netlify');

      // Static render of DeploymentModal in production
      const modalHtml = renderToStaticMarkup(
        <DeploymentModal
          isOpen={true}
          projectId={testProjectId}
          onClose={() => {}}
        />
      );

      // Verify Mock Provider button is explicitly disabled, has clear accessible label and tooltip
      expect(modalHtml).toContain('data-testid="select-provider-mock"');
      expect(modalHtml).toContain('disabled=""');
      expect(modalHtml).toContain('aria-disabled="true"');
      expect(modalHtml).toContain('Mock Provider (Unavailable in production)');
      expect(modalHtml).toContain('opacity-40 cursor-not-allowed');
      expect(modalHtml).toContain('Mock Provider is unavailable in production. Live deployment uses Netlify.');

      // Netlify remains selected and fully functional
      expect(modalHtml).toContain('data-testid="select-provider-netlify"');

      // Static render of ShipManagerPanel in production
      const shipHtml = renderToStaticMarkup(
        <ShipManagerPanel
          projectId={testProjectId}
          projectTitle="UI Correction Test Project"
          onOpenGitHubModal={() => {}}
          onOpenDeployModal={() => {}}
        />
      );

      expect(shipHtml).toContain('data-testid="ship-select-provider-mock"');
      expect(shipHtml).toContain('disabled=""');
      expect(shipHtml).toContain('aria-disabled="true"');
      expect(shipHtml).toContain('opacity-40 cursor-not-allowed');
    });

    it('Netlify remains selectable and switches selectedProvider cleanly', () => {
      setProductionOverride(false);
      const store = useDeploymentStore.getState();

      store.setSelectedProvider('mock');
      expect(useDeploymentStore.getState().selectedProvider).toBe('mock');

      store.setSelectedProvider('netlify');
      expect(useDeploymentStore.getState().selectedProvider).toBe('netlify');
    });
  });

  // =========================================================================
  // PART 2: ADD ROLE BEHAVIOR & PERSISTENCE
  // =========================================================================
  describe('Part 2: Add Role in Authentication UI', () => {
    const authManagerPath = path.resolve(__dirname, '../src/components/auth/AuthManager.tsx');
    const authCoordinatorPath = path.resolve(__dirname, '../src/features/auth/auth-coordinator.ts');
    const authSrc = fs.readFileSync(authManagerPath, 'utf-8');
    const coordSrc = fs.readFileSync(authCoordinatorPath, 'utf-8');

    it('source contracts: prevent accidental form submit on Enter, trim/normalize, and provide accessibility', () => {
      // Enter key prevention
      expect(authSrc).toContain("if (e.key === 'Enter')");
      expect(authSrc).toContain('e.preventDefault()');
      expect(authSrc).toContain('e.stopPropagation()');
      expect(authSrc).toContain('handleAddRole(e)');

      // Trimming and lowercase normalization
      expect(authSrc).toContain('const trimmed = newRole.trim().toLowerCase()');
      expect(authSrc).toContain('!roles.includes(trimmed)');

      // Accessibility & Test IDs
      expect(authSrc).toContain('data-testid="auth-role-input"');
      expect(authSrc).toContain('data-testid="auth-add-role-btn"');
      expect(authSrc).toContain('aria-label="Add custom application role"');
      expect(authSrc).toContain('aria-label="Add role"');
      expect(authSrc).toContain('disabled={!newRole.trim()}');

      // Generated types contract
      expect(coordSrc).toContain('export type AppRole');
      expect(coordSrc).toContain('Configured Application Roles');
    });

    it('renders accessible role input and Add Role button with correct initial attributes', () => {
      const authHtml = renderToStaticMarkup(<AuthManager projectId={testProjectId} />);

      expect(authHtml).toContain('data-testid="auth-role-input"');
      expect(authHtml).toContain('data-testid="auth-add-role-btn"');
      expect(authHtml).toContain('aria-label="Add custom application role"');
      expect(authHtml).toContain('aria-label="Add role"');
      expect(authHtml).toContain('data-testid="auth-role-chip-user"');
      expect(authHtml).toContain('data-testid="auth-role-chip-admin"');
      // Initially button is disabled because input is empty
      expect(authHtml).toContain('disabled=""');
    });

    it('connectAuth persists new custom roles in AuthConfig and writes them to VFS /src/types/auth.ts', async () => {
      const authConfigWithRoles: AuthConfig = {
        providerId: 'mock',
        enableEmailPassword: true,
        enableOAuth: false,
        oauthProviders: [],
        roles: ['user', 'admin', 'editor'],
        defaultRole: 'user'
      };

      await authCoordinator.connectAuth(testProjectId, authConfigWithRoles);

      // Verify persisted in authStore
      const savedConfig = useAuthStore.getState().projectAuthConfig[testProjectId];
      expect(savedConfig).toBeDefined();
      expect(savedConfig.roles).toEqual(['user', 'admin', 'editor']);

      // Verify generated /src/types/auth.ts in VFS includes configured roles
      const generatedTypes = vfsManager.getFile(testProjectId, '/src/types/auth.ts')?.content;
      expect(generatedTypes).toBeDefined();
      expect(generatedTypes).toContain('editor');
      expect(generatedTypes).toContain('export type AppRole');
      expect(generatedTypes).toContain('export interface User');
    });
  });
});
