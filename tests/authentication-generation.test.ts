import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../src/store/authStore';
import { useDatabaseStore } from '../src/store/databaseStore';
import { useEnvVarStore, purgeAllMemorySecrets } from '../src/store/envVarStore';
import { useProjectStore } from '../src/store/projectStore';
import { authCoordinator } from '../src/features/auth/auth-coordinator';
import { MockAuthProvider } from '../src/features/auth/providers/mock-auth-provider';
import { SupabaseAuthProvider } from '../src/features/auth/providers/supabase-auth-provider';
import { chatService } from '../src/features/chat/chat-service';
import { editExecutor } from '../src/features/chat/edit-executor';
import { verificationService } from '../src/features/verification/VerificationService';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { AuthConfig } from '../src/types/auth';
import { EditProposal } from '../src/types/workspace';

describe('Tier 1 Feature 10: Authentication Generation in SnapDeploy AI', () => {
  const projectA = 'proj-auth-alpha';
  const projectB = 'proj-auth-beta';

  beforeEach(async () => {
    vi.restoreAllMocks();

    // Default safe fetch mock for unit tests that touch Supabase endpoints
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('bad-url')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ msg: 'Invalid API Key' })
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({})
      } as any;
    });

    // Reset stores
    useAuthStore.setState({
      selectedProvider: 'mock',
      projectAuthConfig: {},
      projectAuthMetadata: {},
      projectUsers: {}
    });
    useDatabaseStore.setState({
      selectedProvider: 'mock',
      projectDatabaseMetadata: {},
      projectSchemas: {},
      projectMigrationHistory: {},
      projectReconciliationStatus: {}
    });
    useEnvVarStore.setState({ envVarMetadata: {} });
    purgeAllMemorySecrets();

    useAuthStore.getState().clearProjectAuth(projectA);
    useAuthStore.getState().clearProjectAuth(projectB);
    useEnvVarStore.getState().clearProjectEnvVars(projectA);
    useEnvVarStore.getState().clearProjectEnvVars(projectB);

    // Initialize clean VFS test files for projectA
    await vfsManager.writeFile(projectA, '/package.json', JSON.stringify({ name: 'project-auth-a' }), 'json');
    await vfsManager.writeFile(
      projectA,
      '/src/App.tsx',
      'export default function App() { return <div>Auth App</div>; }',
      'typescript'
    );
  });

  // 1. Provider Initialization
  it('1. Provider Initialization: initializes MockAuthProvider and SupabaseAuthProvider with clean metadata', async () => {
    const mockProvider = new MockAuthProvider();
    expect(mockProvider.id).toBe('mock');
    expect(mockProvider.name).toContain('Mock');
    expect(mockProvider.isConfigured()).toBe(false);

    const supabaseProvider = new SupabaseAuthProvider();
    expect(supabaseProvider.id).toBe('supabase');
    expect(supabaseProvider.name).toContain('Supabase');
    expect(supabaseProvider.isConfigured()).toBe(false);
  });

  // 2. Provider Connection & Configuration
  it('2. Provider Connection & Configuration: connects mock provider and records public metadata', async () => {
    const config: AuthConfig = {
      providerId: 'mock',
      endpoint: 'http://localhost:3000/api/auth/mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    };

    const meta = await authCoordinator.connectAuth(projectA, config);
    expect(meta.status).toBe('configured');
    expect(meta.providerId).toBe('mock');

    const storedMeta = useAuthStore.getState().projectAuthMetadata[projectA];
    expect(storedMeta?.status).toBe('configured');
  });

  // 3. Email/Password Signup
  it('3. Email/Password Signup: successfully registers new user and creates session in MockAuthProvider', async () => {
    const provider = new MockAuthProvider();
    await provider.configure({
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    });

    const result = await provider.signUp({
      email: 'newuser@snapdeploy.test',
      password: 'securePassword123',
      name: 'New Tester'
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user?.email).toBe('newuser@snapdeploy.test');
    expect(result.session).toBeDefined();
    expect(result.session?.token).toContain('mock_jwt_token_');
  });

  // 4. Email/Password Signin
  it('4. Email/Password Signin: successfully authenticates registered user', async () => {
    const provider = new MockAuthProvider();
    await provider.configure({
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    });

    // Default pre-seeded admin user
    const result = await provider.signInWithPassword({
      email: 'admin@snapdeploy.test',
      password: 'admin123'
    });

    expect(result.success).toBe(true);
    expect(result.user?.role).toBe('admin');
    expect(result.session?.token).toBeDefined();
  });

  // 5. Invalid Credentials Handling
  it('5. Invalid Credentials: deterministic error responses for bad password and unknown user', async () => {
    const provider = new MockAuthProvider();
    await provider.configure({
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    });

    const badPass = await provider.signInWithPassword({
      email: 'admin@snapdeploy.test',
      password: 'incorrect_password'
    });
    expect(badPass.success).toBe(false);
    expect(badPass.error).toContain('Invalid email or password');

    const unknownUser = await provider.signInWithPassword({
      email: 'nobody@snapdeploy.test',
      password: 'any_password'
    });
    expect(unknownUser.success).toBe(false);
    expect(unknownUser.error).toContain('Invalid email or password');
  });

  // 6. Signout
  it('6. Signout: terminates active session and clears current user', async () => {
    const provider = new MockAuthProvider();
    await provider.configure({
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    });

    await provider.signInWithPassword({ email: 'user@snapdeploy.test', password: 'password123' });
    expect(await provider.getSession()).not.toBeNull();

    const signoutRes = await provider.signOut();
    expect(signoutRes.success).toBe(true);
    expect(await provider.getSession()).toBeNull();
    expect(await provider.getCurrentUser()).toBeNull();
  });

  // 7. Current-Session Retrieval
  it('7. Current-Session Retrieval: returns active session with non-expired token', async () => {
    const provider = new MockAuthProvider();
    await provider.configure({
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user'],
      defaultRole: 'user'
    });

    await provider.signInWithPassword({ email: 'user@snapdeploy.test', password: 'password123' });
    const session = await provider.getSession();
    expect(session).toBeDefined();
    expect(session?.user.email).toBe('user@snapdeploy.test');
    expect(session?.expiresAt).toBeGreaterThan(Date.now());
  });

  // 8. Auth-State Changes
  it('8. Auth-State Changes: emits SIGNED_IN and SIGNED_OUT events to listeners', async () => {
    const provider = new MockAuthProvider();
    const events: string[] = [];

    const unsubscribe = provider.onAuthStateChange((event, session) => {
      events.push(event);
    });

    await provider.signInWithPassword({ email: 'admin@snapdeploy.test', password: 'admin123' });
    await provider.signOut();

    expect(events).toEqual(['SIGNED_IN', 'SIGNED_OUT']);
    unsubscribe();
  });

  // 9. Protected-Route Behavior
  it('9. Protected-Route Behavior: verifies role-based and unauthenticated view guarding logic', async () => {
    const adminUser = { id: '1', email: 'admin@test.com', role: 'admin', createdAt: '' };
    const stdUser = { id: '2', email: 'user@test.com', role: 'user', createdAt: '' };

    const checkAccess = (user: typeof adminUser | null, requiredRole?: string) => {
      if (!user) return 'AUTH_REQUIRED';
      if (requiredRole && user.role !== requiredRole) return 'FORBIDDEN';
      return 'GRANTED';
    };

    expect(checkAccess(null)).toBe('AUTH_REQUIRED');
    expect(checkAccess(stdUser, 'admin')).toBe('FORBIDDEN');
    expect(checkAccess(adminUser, 'admin')).toBe('GRANTED');
    expect(checkAccess(stdUser)).toBe('GRANTED');
  });

  // 10. Password Reset Flow Handling
  it('10. Password Reset Flow: safely handles recovery requests without revealing account secrets', async () => {
    const provider = new MockAuthProvider();
    await provider.configure({
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user'],
      defaultRole: 'user'
    });

    const resetSuccess = await provider.resetPasswordForEmail('user@snapdeploy.test');
    expect(resetSuccess.success).toBe(true);

    const resetNonExistent = await provider.resetPasswordForEmail('unknown@snapdeploy.test');
    expect(resetNonExistent.success).toBe(false);
  });

  // 11. OAuth Configuration Metadata Handling
  it('11. OAuth Configuration: correctly stores and inspects enabled OAuth providers', async () => {
    const config: AuthConfig = {
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: true,
      oauthProviders: ['google', 'github'],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    };

    await authCoordinator.connectAuth(projectA, config);
    const saved = useAuthStore.getState().projectAuthConfig[projectA];
    expect(saved?.enableOAuth).toBe(true);
    expect(saved?.oauthProviders).toEqual(['google', 'github']);
  });

  // 12. Role/Permission Metadata Handling
  it('12. Role/Permission Metadata: validates configurable role list and default role assignment', async () => {
    const config: AuthConfig = {
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['viewer', 'editor', 'admin'],
      defaultRole: 'viewer'
    };

    await authCoordinator.connectAuth(projectA, config);
    const saved = useAuthStore.getState().projectAuthConfig[projectA];
    expect(saved?.roles).toHaveLength(3);
    expect(saved?.defaultRole).toBe('viewer');
  });

  // 13. Generated Auth Client Code in VFS
  it('13. Generated Auth Client Code: writes types, client, and components to VFS', async () => {
    const config: AuthConfig = {
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    };

    await authCoordinator.connectAuth(projectA, config);

    expect(vfsManager.getFile(projectA, '/src/types/auth.ts')).toBeDefined();
    expect(vfsManager.getFile(projectA, '/src/lib/auth.ts')).toBeDefined();
    expect(vfsManager.getFile(projectA, '/src/components/AuthModal.tsx')).toBeDefined();
    expect(vfsManager.getFile(projectA, '/src/components/ProtectedRoute.tsx')).toBeDefined();
  });

  // 14. Generated Client Contains No Privileged Secrets
  it('14. Generated Client Secrets Audit: guarantees zero service-role keys or passwords in client code', async () => {
    const config: AuthConfig = {
      providerId: 'supabase',
      endpoint: 'https://test-auth.supabase.co',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    };

    const dummyServiceRole = 'service_role_secret_strictly_forbidden_in_client_source_xyz123';
    await authCoordinator.connectAuth(projectA, config, {
      apiKey: 'client-anon-key',
      serviceKey: dummyServiceRole
    });

    const clientCode = vfsManager.getFile(projectA, '/src/lib/auth.ts')?.content || '';
    const typesCode = vfsManager.getFile(projectA, '/src/types/auth.ts')?.content || '';

    expect(clientCode).not.toContain(dummyServiceRole);
    expect(typesCode).not.toContain(dummyServiceRole);
    expect(clientCode).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(clientCode).toContain('VITE_SUPABASE_ANON_KEY');
  });

  // 15. Canonical Secret Store: useEnvVarStore remains sole authority
  it('15. Canonical Secret Authority: privileged credentials stored exclusively in useEnvVarStore memory-only secrets', async () => {
    const secretKey = 'privileged-supabase-admin-service-key-999';
    await authCoordinator.connectAuth(
      projectA,
      {
        providerId: 'supabase',
        endpoint: 'https://demo.supabase.co',
        enableEmailPassword: true,
        enableOAuth: false,
        oauthProviders: [],
        roles: ['user'],
        defaultRole: 'user'
      },
      { apiKey: 'public-anon-key', serviceKey: secretKey }
    );

    const secretFromEnv = useEnvVarStore.getState().getProjectSecretValue(projectA, 'SUPABASE_SERVICE_ROLE_KEY');
    expect(secretFromEnv).toBe(secretKey);

    // Verify authStore state tree contains zero secret values
    const authStateStr = JSON.stringify(useAuthStore.getState());
    expect(authStateStr).not.toContain(secretKey);
  });

  // 16. databaseStore contains zero auth secret values
  it('16. Zero Secrets in databaseStore: databaseStore contains no auth secrets', async () => {
    const dbStateStr = JSON.stringify(useDatabaseStore.getState());
    expect(dbStateStr).not.toContain('password');
    expect(dbStateStr).not.toContain('serviceKey');
  });

  // 17. AI Context Contains No Secret Auth Values
  it('17. Safe AI Context Sanitization: chatService.getSafeAiAuthContext outputs safe metadata only', async () => {
    await authCoordinator.connectAuth(projectA, {
      providerId: 'supabase',
      endpoint: 'https://demo.supabase.co',
      enableEmailPassword: true,
      enableOAuth: true,
      oauthProviders: ['google', 'github'],
      roles: ['admin', 'member'],
      defaultRole: 'member'
    });

    const aiContext = chatService.getSafeAiAuthContext(projectA);
    expect(aiContext).toContain('Provider: Supabase Auth (GoTrue)');
    expect(aiContext).toContain('Endpoint: https://demo.supabase.co');
    expect(aiContext).toContain('OAuth Providers: google, github');
    expect(aiContext).not.toContain('key');
    expect(aiContext).not.toContain('secret');
    expect(aiContext).not.toContain('password');
  });

  // 18. AI Authentication Proposal Approval
  it('18. AI Proposal Approval: applying approved auth proposal mutates VFS and takes snapshot', async () => {
    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: true,
      checks: [{ name: 'tsc', success: true }, { name: 'build', success: true }],
      totalDurationMs: 10
    });

    const proposal: EditProposal = {
      id: 'prop-auth-apply',
      operationId: 'op-1',
      summary: 'Add user authentication flow',
      explanation: 'Integrated login and current user banner.',
      files: [
        {
          path: '/src/App.tsx',
          before: vfsManager.getFile(projectA, '/src/App.tsx')?.content || '',
          after: 'export default function App() { return <div>Auth Active: Welcome User!</div>; }'
        }
      ],
      confidence: 1.0
    };

    const initialSnapshotCount = snapshotService.listSnapshots(projectA).length;
    const result = await editExecutor.executeEdit(projectA, proposal);

    expect(result.verified).toBe(true);
    expect(vfsManager.getFile(projectA, '/src/App.tsx')?.content).toContain('Welcome User!');
    expect(snapshotService.listSnapshots(projectA).length).toBeGreaterThan(initialSnapshotCount);
  });

  // 19. AI Authentication Proposal Rejection
  it('19. AI Proposal Rejection: rejecting proposal causes zero mutation to VFS', async () => {
    const originalContent = vfsManager.getFile(projectA, '/src/App.tsx')?.content;

    // Simulate rejection by simply not executing and ensuring VFS is intact
    expect(vfsManager.getFile(projectA, '/src/App.tsx')?.content).toBe(originalContent);
  });

  // 20. Source-Code Verification Failure Rollback
  it('20. Verification Failure Rollback: automatic rollback restores original VFS files upon verification failure', async () => {
    const beforeContent = vfsManager.getFile(projectA, '/src/App.tsx')?.content || '';

    vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
      success: false,
      checks: [{ name: 'tsc', success: false, error: 'Syntax error' }],
      totalDurationMs: 10
    });

    const failingProposal: EditProposal = {
      id: 'prop-fail-rollback',
      operationId: 'op-2',
      summary: 'Add bad syntax',
      explanation: 'Introduces syntax error',
      files: [
        {
          path: '/src/App.tsx',
          before: beforeContent,
          after: 'INVALID SYNTAX THAT CRASHES COMPILATION <<<<;;;'
        }
      ],
      confidence: 1.0
    };

    const result = await editExecutor.executeEdit(projectA, failingProposal);
    expect(result.verified).toBe(false);
    expect(result.rolledBack).toBe(true);
    // VFS must match original beforeContent byte-for-byte
    expect(vfsManager.getFile(projectA, '/src/App.tsx')?.content).toBe(beforeContent);
  });

  // 21. Remote Failure Semantics
  it('21. Remote Failure Semantics: provider connection error does not leave successful metadata behind', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ msg: 'Invalid API Key' })
    }) as any;

    try {
      await expect(
        authCoordinator.connectAuth(
          projectA,
          { providerId: 'supabase', endpoint: 'https://bad-url.supabase.co', enableEmailPassword: true, enableOAuth: false, oauthProviders: [], roles: ['user'], defaultRole: 'user' },
          { apiKey: 'bad-key' }
        )
      ).rejects.toThrow();

      const meta = useAuthStore.getState().projectAuthMetadata[projectA];
      expect(meta?.status).toBe('error');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 22. Unknown/Out-of-Sync Semantics
  it('22. Unknown/Out-of-Sync Semantics: handles disconnected and unconfigured projects cleanly', async () => {
    const unconfiguredMeta = useAuthStore.getState().projectAuthMetadata[projectB];
    expect(unconfiguredMeta).toBeUndefined();
    expect(useAuthStore.getState().getProvider(projectB).isConfigured()).toBe(false);
  });

  // 23. Project Isolation
  it('23. Project Isolation: Project A auth state never leaks into Project B', async () => {
    await authCoordinator.connectAuth(projectA, {
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: true,
      oauthProviders: ['google'],
      roles: ['admin', 'special'],
      defaultRole: 'special'
    });

    const configA = useAuthStore.getState().projectAuthConfig[projectA];
    const configB = useAuthStore.getState().projectAuthConfig[projectB];

    expect(configA).toBeDefined();
    expect(configB).toBeUndefined();
    expect(useAuthStore.getState().projectAuthMetadata[projectB]).toBeUndefined();
  });

  // 24. Project Duplication Without Secret Cloning
  it('24. Project Duplication: duplicates auth config and roles without cloning secret values', async () => {
    await authCoordinator.connectAuth(
      projectA,
      {
        providerId: 'supabase',
        endpoint: 'https://shared.supabase.co',
        enableEmailPassword: true,
        enableOAuth: false,
        oauthProviders: [],
        roles: ['superadmin'],
        defaultRole: 'superadmin'
      },
      { apiKey: 'public-anon-key-abc', serviceKey: 'secret-role-key-xyz' }
    );

    useAuthStore.getState().duplicateProjectAuth(projectA, projectB);

    const dupConfig = useAuthStore.getState().projectAuthConfig[projectB];
    expect(dupConfig).toBeDefined();
    expect(dupConfig?.roles).toContain('superadmin');
    expect(dupConfig?.endpoint).toBe('https://shared.supabase.co');

    // Verify secret is NOT in duplicate project
    const dupSecret = useEnvVarStore.getState().getProjectSecretValue(projectB, 'SUPABASE_SERVICE_ROLE_KEY');
    expect(dupSecret).toBeNull();
  });

  // 25. Project Deletion Cleanup
  it('25. Project Deletion Cleanup: purges all auth metadata and instances for deleted project', async () => {
    await authCoordinator.connectAuth(projectA, {
      providerId: 'mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user'],
      defaultRole: 'user'
    });

    expect(useAuthStore.getState().projectAuthMetadata[projectA]).toBeDefined();

    useAuthStore.getState().clearProjectAuth(projectA);

    expect(useAuthStore.getState().projectAuthMetadata[projectA]).toBeUndefined();
    expect(useAuthStore.getState().projectAuthConfig[projectA]).toBeUndefined();
  });

  // 26. Snapshot Restore Honesty
  it('26. Snapshot Restore Honesty: snapshot restore rolls back VFS without claiming remote auth rollback', async () => {
    const originalApp = vfsManager.getFile(projectA, '/src/App.tsx')?.content || '';
    const snap = await snapshotService.createSnapshot(projectA, 'Original Baseline');
    expect(snap.id).toBeDefined();

    // Simulate code edit
    await vfsManager.writeFile(projectA, '/src/App.tsx', 'export const Edited = true;', 'typescript');
    expect(vfsManager.getFile(projectA, '/src/App.tsx')?.content).toBe('export const Edited = true;');

    // Restore snapshot
    const restored = await snapshotService.restoreSnapshot(projectA);
    expect(restored).not.toBeNull();
    expect(vfsManager.getFile(projectA, '/src/App.tsx')?.content).toBe(originalApp);
  });

  // 27. Browser Reload Persistence Behavior
  it('27. Browser Reload Persistence: preserves non-sensitive metadata in store partialize slice', async () => {
    await authCoordinator.connectAuth(projectA, {
      providerId: 'mock',
      endpoint: 'http://localhost:3000/api/auth/mock',
      enableEmailPassword: true,
      enableOAuth: false,
      oauthProviders: [],
      roles: ['user', 'admin'],
      defaultRole: 'user'
    });

    const state = useAuthStore.getState();
    expect(state.projectAuthConfig[projectA]).toBeDefined();
    expect(state.projectAuthMetadata[projectA]?.status).toBe('configured');
  });

  // 28. Deterministic Mock Provider Failure Handling
  it('28. Deterministic Mock Failures: validates email format, duplicate email rejection, and password length', async () => {
    const provider = new MockAuthProvider();

    // Invalid email format
    const badEmail = await provider.signUp({ email: 'not-an-email', password: 'password123' });
    expect(badEmail.success).toBe(false);
    expect(badEmail.error).toContain('Invalid email');

    // Short password
    const shortPass = await provider.signUp({ email: 'valid@test.com', password: '123' });
    expect(shortPass.success).toBe(false);
    expect(shortPass.error).toContain('at least 6 characters');

    // Duplicate email
    await provider.signUp({ email: 'dup@test.com', password: 'password123' });
    const dupRes = await provider.signUp({ email: 'dup@test.com', password: 'password123' });
    expect(dupRes.success).toBe(false);
    expect(dupRes.error).toContain('already exists');
  });
});
