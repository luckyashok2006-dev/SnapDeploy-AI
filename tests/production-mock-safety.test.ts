import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setProductionOverride } from '../src/lib/environment';
import { useDeploymentStore, sanitizeDeploymentPersistedState } from '../src/store/deploymentStore';
import { useAuthStore, sanitizeAuthPersistedState } from '../src/store/authStore';
import { useDatabaseStore, sanitizeDatabasePersistedState } from '../src/store/databaseStore';
import { useProjectStore } from '../src/store/projectStore';
import { MockDeploymentProvider } from '../src/features/deployment/providers/mock-provider';
import { NetlifyProvider } from '../src/features/deployment/providers/netlify-provider';
import { executeDeployment } from '../src/features/deployment/deployment-coordinator';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { clearRegisteredSecrets } from '../src/features/deployment/security/secret-sanitizer';

describe('Phase 8.1 - Production Mock-Provider Safety Tests', () => {
  const testProjectId = 'prod-safety-test-proj';

  beforeEach(async () => {
    // Clean up secrets and stores
    clearRegisteredSecrets();
    setProductionOverride(null);

    // Setup basic VFS project
    await vfsManager.writeFile(
      testProjectId,
      '/package.json',
      JSON.stringify({
        name: 'prod-safety-app',
        scripts: { build: 'vite build' },
        dependencies: { react: '^18.2.0' }
      })
    );

    await vfsManager.writeFile(
      testProjectId,
      '/index.html',
      '<!DOCTYPE html><html><body><div id="root"></div></body></html>'
    );

    await vfsManager.writeFile(
      testProjectId,
      '/src/App.tsx',
      'export default function App() { return <h1>Prod Safety</h1>; }'
    );

    useProjectStore.setState((state) => ({
      projects: {
        ...state.projects,
        [testProjectId]: {
          id: testProjectId,
          title: 'Prod Safety App',
          status: 'ready',
          files: vfsManager.getFiles(testProjectId),
          openTabs: ['/src/App.tsx'],
          activeFilePath: '/src/App.tsx',
          diagnostics: [],
          fixHistory: []
        }
      },
      activeProjectId: testProjectId
    }));
  });

  afterEach(async () => {
    setProductionOverride(null);
    await vfsManager.deleteProject(testProjectId);
    useDeploymentStore.getState().clearProjectDeployments(testProjectId);
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Production Deployment Store Credentials
  // -------------------------------------------------------------------------
  describe('1. Production deployment store credentials', () => {
    it('does not preload mock credentials in production', () => {
      setProductionOverride(true);

      const store = useDeploymentStore.getState();
      expect(store.getCredentials('mock')).toBeNull();

      const provider = new MockDeploymentProvider();
      expect(provider.isAuthenticated()).toBe(false);
      expect(provider.getAccountInfo()).resolves.toBeNull();
    });

    it('rejects authenticate attempts on mock provider in production', async () => {
      setProductionOverride(true);

      const provider = new MockDeploymentProvider();
      await expect(provider.authenticate('any-test-token')).rejects.toThrow(
        /Mock deployment provider is disabled in production/i
      );
    });

    it('ignores setCredentials for mock provider in production', () => {
      setProductionOverride(true);

      const store = useDeploymentStore.getState();
      store.setCredentials('mock', 'custom-token');
      expect(store.getCredentials('mock')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Production Silent Mock Deployment Prevention
  // -------------------------------------------------------------------------
  describe('2. Production cannot silently use mock deployment', () => {
    it('throws error if MockDeploymentProvider.deploy is directly invoked in production', async () => {
      setProductionOverride(true);

      const provider = new MockDeploymentProvider();
      await expect(
        provider.deploy({
          projectId: testProjectId,
          projectTitle: 'Prod Safety App',
          artifactZip: new Uint8Array([1, 2, 3])
        })
      ).rejects.toThrow(/Mock deployment provider is disabled in production/i);
    });

    it('blocks executeDeployment with explicit mock provider in production', async () => {
      setProductionOverride(true);

      await expect(
        executeDeployment(testProjectId, { providerId: 'mock' })
      ).rejects.toThrow(/Mock deployment provider is disabled in production/i);

      // Deployment progress should reflect failed status
      const progress = useDeploymentStore.getState().activeDeployments[testProjectId];
      expect(progress.status).toBe('failed');
      expect(progress.error).toContain('Mock deployment provider is disabled in production');
    });

    it('blocks executeDeployment when store selectedProvider is mock in production', async () => {
      setProductionOverride(true);

      // Force state to mock as if corrupted
      useDeploymentStore.setState({ selectedProvider: 'mock' });

      await expect(executeDeployment(testProjectId)).rejects.toThrow(
        /Mock deployment provider is disabled in production/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Persisted State Compatibility & Overrides in Production
  // -------------------------------------------------------------------------
  describe('3. Persisted selectedProvider mock is rejected/overridden in production', () => {
    it('disallows setSelectedProvider to set mock in production and overrides rehydrated mock', () => {
      setProductionOverride(true);

      const store = useDeploymentStore.getState();
      store.setSelectedProvider('netlify');
      expect(useDeploymentStore.getState().selectedProvider).toBe('netlify');

      // Attempt to switch to mock in production
      store.setSelectedProvider('mock');
      expect(useDeploymentStore.getState().selectedProvider).toBe('netlify');

      // Verify rehydration overrides persisted mock to netlify
      const mockState = { selectedProvider: 'mock' };
      sanitizeDeploymentPersistedState(mockState);
      expect(mockState.selectedProvider).toBe('netlify');
    });

    it('authStore rejects mock in production, overrides rehydrated mock, and falls back to supabase', () => {
      setProductionOverride(true);

      // Verify rehydration overrides persisted mock to supabase
      const mockState = { selectedProvider: 'mock' };
      sanitizeAuthPersistedState(mockState);
      expect(mockState.selectedProvider).toBe('supabase');

      // Set to supabase and verify switching to mock is rejected
      useAuthStore.getState().setSelectedProvider('supabase');
      expect(useAuthStore.getState().selectedProvider).toBe('supabase');

      useAuthStore.getState().setSelectedProvider('mock');
      expect(useAuthStore.getState().selectedProvider).toBe('supabase');

      // Even if state had mock, getProvider in production returns SupabaseAuthProvider
      useAuthStore.setState({ selectedProvider: 'mock' });
      const provider = useAuthStore.getState().getProvider(testProjectId);
      expect(provider.id).toBe('supabase');
    });

    it('databaseStore rejects mock in production, overrides rehydrated mock, and falls back to supabase', () => {
      setProductionOverride(true);

      // Verify rehydration overrides persisted mock to supabase
      const mockState = { selectedProvider: 'mock' };
      sanitizeDatabasePersistedState(mockState);
      expect(mockState.selectedProvider).toBe('supabase');

      // Set to supabase and verify switching to mock is rejected
      useDatabaseStore.getState().setSelectedProvider('supabase');
      expect(useDatabaseStore.getState().selectedProvider).toBe('supabase');

      useDatabaseStore.getState().setSelectedProvider('mock');
      expect(useDatabaseStore.getState().selectedProvider).toBe('supabase');

      // Even if state had mock, getProvider in production returns SupabaseProvider
      useDatabaseStore.setState({ selectedProvider: 'mock' });
      const provider = useDatabaseStore.getState().getProvider(testProjectId);
      expect(provider.id).toBe('supabase');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Development / Test Behavior Intact
  // -------------------------------------------------------------------------
  describe('4. Development/test mock behavior still works deterministically', () => {
    it('preloads mock credentials in development/test mode', () => {
      setProductionOverride(false);

      const provider = new MockDeploymentProvider();
      expect(provider.isAuthenticated()).toBe(true);

      const store = useDeploymentStore.getState();
      expect(store.getCredentials('mock')).toBe('mock-test-token');
    });

    it('allows successful deployment through mock provider in dev/test', async () => {
      setProductionOverride(false);

      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValueOnce({
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: 'Build clean',
        stderr: '',
        durationMs: 150,
        timedOut: false
      });

      const record = await executeDeployment(testProjectId, { providerId: 'mock' });
      expect(record.status).toBe('live');
      expect(record.url).toContain('https://snapdeploy-preview-');
    });

    it('authStore and databaseStore allow mock provider in dev/test', () => {
      setProductionOverride(false);

      useAuthStore.getState().setSelectedProvider('mock');
      expect(useAuthStore.getState().selectedProvider).toBe('mock');
      const authProv = useAuthStore.getState().getProvider(testProjectId);
      expect(authProv.id).toBe('mock');

      useDatabaseStore.getState().setSelectedProvider('mock');
      expect(useDatabaseStore.getState().selectedProvider).toBe('mock');
      const dbProv = useDatabaseStore.getState().getProvider(testProjectId);
      expect(dbProv.id).toBe('mock');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Existing Real-Provider Configuration Paths Not Broken
  // -------------------------------------------------------------------------
  describe('5. Existing real-provider configuration paths not broken', () => {
    it('NetlifyProvider authenticates and operates normally in production', async () => {
      setProductionOverride(true);

      const netlify = new NetlifyProvider();
      expect(netlify.isAuthenticated()).toBe(false);

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('/user')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ slug: 'real-user', email: 'real@example.com' })
          });
        }
        return originalFetch(url);
      });

      const account = await netlify.authenticate('nfp_realProdToken1234567890');
      expect(account.username).toBe('real-user');
      expect(netlify.isAuthenticated()).toBe(true);

      useDeploymentStore.getState().setCredentials('netlify', 'nfp_realProdToken1234567890');
      expect(useDeploymentStore.getState().getCredentials('netlify')).toBe('nfp_realProdToken1234567890');

      global.fetch = originalFetch;
    });

    it('fails closed when Netlify token is missing in production deployment', async () => {
      setProductionOverride(true);

      // Disconnect netlify to ensure no token exists
      useDeploymentStore.getState().disconnect('netlify');
      useDeploymentStore.setState({ selectedProvider: 'netlify' });

      await expect(
        executeDeployment(testProjectId, { providerId: 'netlify' })
      ).rejects.toThrow(/not authenticated/i);
    });
  });
});
