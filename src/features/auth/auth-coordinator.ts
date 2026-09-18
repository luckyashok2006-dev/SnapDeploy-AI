import {
  AuthProviderId,
  AuthConfig,
  AuthMetadata,
  AuthUser
} from '../../types/auth';
import { useAuthStore } from '../../store/authStore';
import { useEnvVarStore } from '../../store/envVarStore';
import { vfsManager } from '../../lib/vfs/vfs-manager';

export class AuthCoordinator {
  private static instance: AuthCoordinator;

  public static getInstance(): AuthCoordinator {
    if (!AuthCoordinator.instance) {
      AuthCoordinator.instance = new AuthCoordinator();
    }
    return AuthCoordinator.instance;
  }

  public getProvider(projectId: string) {
    return useAuthStore.getState().getProvider(projectId);
  }

  /**
   * Connects and configures an authentication provider for a project.
   * Public variables are stored in canonical envVarStore (marked isClientVisible=true).
   * Privileged credentials (e.g. service role keys) are stored in envVarStore as memory-only secrets.
   * authStore stores ZERO secret values.
   */
  public async connectAuth(
    projectId: string,
    config: AuthConfig,
    credentials?: { apiKey?: string; serviceKey?: string }
  ): Promise<AuthMetadata> {
    const authStore = useAuthStore.getState();
    const envStore = useEnvVarStore.getState();

    // 1. Register public and secret configuration in canonical envVarStore
    if (config.providerId === 'supabase') {
      if (config.endpoint) {
        envStore.setEnvVar(projectId, 'VITE_SUPABASE_URL', config.endpoint, false, 'Supabase Public REST & Auth URL');
      }
      if (credentials?.apiKey) {
        envStore.setEnvVar(projectId, 'VITE_SUPABASE_ANON_KEY', credentials.apiKey, false, 'Supabase Public Anon Key (RLS Enforced)');
      }
      if (credentials?.serviceKey) {
        // Privileged secret — 100% memory-only!
        envStore.setEnvVar(projectId, 'SUPABASE_SERVICE_ROLE_KEY', credentials.serviceKey, true, 'Supabase Service Role Secret (Admin Only)');
      }
    } else {
      // Mock / Local Auth
      envStore.setEnvVar(projectId, 'VITE_AUTH_PROVIDER', 'mock', false, 'Client Auth Provider Identification');
    }

    // 2. Configure provider instance
    let metadata: AuthMetadata;
    try {
      const provider = authStore.getProvider(projectId, config.providerId);
      metadata = await provider.configure(config, credentials);
    } catch (err: any) {
      const errorMeta: AuthMetadata = {
        providerId: config.providerId,
        status: 'error',
        endpoint: config.endpoint,
        connectedAt: Date.now(),
        errorMessage: err?.message || 'Configuration failed'
      };
      authStore.setAuthMetadata(projectId, errorMeta);
      throw err;
    }

    // 3. Save non-sensitive metadata in authStore
    authStore.setAuthConfig(projectId, config);
    authStore.setAuthMetadata(projectId, metadata);
    authStore.setSelectedProvider(config.providerId);

    // 4. Generate or update client auth files in VFS
    await this.generateAuthSourceFiles(projectId, config);

    return metadata;
  }

  /**
   * Disconnects authentication provider for a project.
   */
  public async disconnectAuth(projectId: string): Promise<void> {
    const authStore = useAuthStore.getState();
    const meta = authStore.projectAuthMetadata[projectId];
    if (meta) {
      const provider = authStore.getProvider(projectId, meta.providerId);
      await provider.disconnect();
    }
    authStore.setAuthMetadata(projectId, null);
  }

  /**
   * Returns clean, structured authentication metadata for AI prompt context.
   * Strictly EXCLUDES all secret keys, passwords, tokens, and client secrets.
   */
  public getSafeAiAuthContext(projectId: string): string {
    const authStore = useAuthStore.getState();
    const config = authStore.projectAuthConfig[projectId];
    const meta = authStore.projectAuthMetadata[projectId];

    if (!config || !meta || meta.status !== 'configured') {
      return '';
    }

    const lines = [
      `Configured Authentication (Metadata Only - Safe Context):`,
      `Provider: ${config.providerId === 'supabase' ? 'Supabase Auth (GoTrue)' : 'Mock Authentication Provider'}`,
      `Endpoint: ${meta.endpoint || 'Internal Mock API'}`,
      `Email/Password Auth: ${config.enableEmailPassword ? 'Enabled' : 'Disabled'}`,
      `OAuth Providers: ${config.enableOAuth && config.oauthProviders.length > 0 ? config.oauthProviders.join(', ') : 'None'}`,
      `Roles: ${config.roles.join(', ')} (Default: ${config.defaultRole})`
    ];

    return lines.join('\n');
  }

  /**
   * Generates type-safe TypeScript auth client code, hook, and components in VFS.
   * Strictly uses public client configuration only. Zero secrets are ever embedded.
   */
  public async generateAuthSourceFiles(projectId: string, config: AuthConfig): Promise<void> {
    // 1. Generate /src/types/auth.ts in VFS
    const typesContent = `// ---------------------------------------------------------------------------
// Auto-generated Authentication Types for SnapDeploy AI
// Source of truth: Connected Auth Configuration
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  createdAt: string;
}

export interface Session {
  user: User;
  token: string;
  expiresAt: number;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}
`;
    await vfsManager.writeFile(projectId, '/src/types/auth.ts', typesContent, 'typescript');

    // 2. Generate /src/lib/auth.ts in VFS
    const isSupabase = config.providerId === 'supabase';
    const authClientContent = isSupabase
      ? `// ---------------------------------------------------------------------------
// Type-safe Client Auth for SnapDeploy AI (Supabase Provider)
// Uses public client configuration (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
// Privileged service-role keys are strictly forbidden here.
// ---------------------------------------------------------------------------
import { User, Session, AuthState } from '../types/auth';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

export class AuthClient {
  private currentSession: Session | null = null;
  private listeners: Set<(state: AuthState) => void> = new Set();

  public async signUp(email: string, password?: string, name?: string): Promise<{ user?: User; error?: string }> {
    try {
      const resp = await fetch(\`\${SUPABASE_URL}/auth/v1/signup\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: \`Bearer \${SUPABASE_ANON_KEY}\`
        },
        body: JSON.stringify({ email, password, data: { name } })
      });
      const data = await resp.json();
      if (!resp.ok) return { error: data.msg || data.error_description || 'Signup failed' };
      const user: User = { id: data.id || data.user?.id || 'u_1', email, name, createdAt: new Date().toISOString() };
      return { user };
    } catch (err: any) {
      return { error: err?.message || 'Network error during signup' };
    }
  }

  public async signIn(email: string, password?: string): Promise<{ session?: Session; error?: string }> {
    try {
      const resp = await fetch(\`\${SUPABASE_URL}/auth/v1/token?grant_type=password\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: \`Bearer \${SUPABASE_ANON_KEY}\`
        },
        body: JSON.stringify({ email, password })
      });
      const data = await resp.json();
      if (!resp.ok) return { error: data.error_description || data.msg || 'Login failed' };
      const user: User = {
        id: data.user?.id || 'u_1',
        email: data.user?.email || email,
        name: data.user?.user_metadata?.name,
        role: data.user?.user_metadata?.role || 'user',
        createdAt: data.user?.created_at || new Date().toISOString()
      };
      const session: Session = { user, token: data.access_token, expiresAt: Date.now() + 3600 * 1000 };
      this.currentSession = session;
      this.notifyListeners();
      return { session };
    } catch (err: any) {
      return { error: err?.message || 'Network error during signin' };
    }
  }

  public async signOut(): Promise<void> {
    this.currentSession = null;
    this.notifyListeners();
  }

  public getSession(): Session | null {
    return this.currentSession;
  }

  public getUser(): User | null {
    return this.currentSession?.user || null;
  }

  public subscribe(cb: (state: AuthState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyListeners(): void {
    const state: AuthState = {
      user: this.getUser(),
      session: this.getSession(),
      loading: false,
      error: null
    };
    for (const l of this.listeners) l(state);
  }
}

export const auth = new AuthClient();
`
      : `// ---------------------------------------------------------------------------
// Type-safe Client Auth for SnapDeploy AI (Deterministic Mock Provider)
// In-memory authentication client with session persistence and predictable state.
// ---------------------------------------------------------------------------
import { User, Session, AuthState } from '../types/auth';

const STORAGE_KEY = 'snapdeploy_client_session_v1';

export class AuthClient {
  private currentSession: Session | null = null;
  private listeners: Set<(state: AuthState) => void> = new Set();

  constructor() {
    this.hydrateSession();
  }

  private hydrateSession(): void {
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.expiresAt > Date.now()) {
            this.currentSession = parsed;
          }
        }
      } catch {}
    }
  }

  public async signUp(email: string, password?: string, name?: string): Promise<{ user?: User; session?: Session; error?: string }> {
    if (!email || !email.includes('@')) {
      return { error: 'Valid email address is required.' };
    }
    const user: User = {
      id: \`usr_\${Date.now()}\`,
      email,
      name: name || email.split('@')[0],
      role: 'user',
      createdAt: new Date().toISOString()
    };
    const session: Session = {
      user,
      token: \`mock_tok_\${Date.now()}\`,
      expiresAt: Date.now() + 3600 * 1000
    };
    this.currentSession = session;
    this.saveSession();
    this.notifyListeners();
    return { user, session };
  }

  public async signIn(email: string, password?: string): Promise<{ user?: User; session?: Session; error?: string }> {
    if (!email || !password) {
      return { error: 'Email and password are required.' };
    }
    if (password === 'wrong_password') {
      return { error: 'Invalid email or password.' };
    }
    const isAdmin = email.includes('admin');
    const user: User = {
      id: isAdmin ? 'usr_admin_1' : 'usr_std_2',
      email,
      name: isAdmin ? 'Admin User' : (email.split('@')[0]),
      role: isAdmin ? 'admin' : 'user',
      createdAt: '2026-09-01T00:00:00.000Z'
    };
    const session: Session = {
      user,
      token: \`mock_tok_\${Date.now()}\`,
      expiresAt: Date.now() + 3600 * 1000
    };
    this.currentSession = session;
    this.saveSession();
    this.notifyListeners();
    return { user, session };
  }

  public async signOut(): Promise<void> {
    this.currentSession = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    this.notifyListeners();
  }

  public getSession(): Session | null {
    return this.currentSession;
  }

  public getUser(): User | null {
    return this.currentSession?.user || null;
  }

  public subscribe(cb: (state: AuthState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private saveSession(): void {
    if (typeof window !== 'undefined' && this.currentSession) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentSession));
      } catch {}
    }
  }

  private notifyListeners(): void {
    const state: AuthState = {
      user: this.getUser(),
      session: this.getSession(),
      loading: false,
      error: null
    };
    for (const l of this.listeners) l(state);
  }
}

export const auth = new AuthClient();
`;
    await vfsManager.writeFile(projectId, '/src/lib/auth.ts', authClientContent, 'typescript');

    // 3. Generate /src/components/AuthModal.tsx in VFS
    const authModalComponent = `// ---------------------------------------------------------------------------
// Auto-generated Client Authentication Dialog for SnapDeploy AI
// ---------------------------------------------------------------------------
import React, { useState } from 'react';
import { auth } from '../lib/auth';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = isSignUp
      ? await auth.signUp(email, password, name)
      : await auth.signIn(email, password);

    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else {
      if (onSuccess) onSuccess();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" data-testid="client-auth-modal">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm" data-testid="client-auth-close-btn">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs" data-testid="client-auth-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignUp && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                data-testid="client-auth-name-input"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
              data-testid="client-auth-email-input"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
              data-testid="client-auth-password-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 mt-2"
            data-testid="client-auth-submit-btn"
          >
            {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-white/5 text-center">
          <button
            type="button"
            onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition"
            data-testid="client-auth-toggle-mode-btn"
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
};
`;
    await vfsManager.writeFile(projectId, '/src/components/AuthModal.tsx', authModalComponent, 'typescript');

    // 4. Generate /src/components/ProtectedRoute.tsx in VFS
    const protectedRouteComponent = `// ---------------------------------------------------------------------------
// Auto-generated Protected Route / View Guard for SnapDeploy AI
// ---------------------------------------------------------------------------
import React from 'react';
import { auth } from '../lib/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requiredRole?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, fallback, requiredRole }) => {
  const user = auth.getUser();

  if (!user) {
    return fallback ? <>{fallback}</> : (
      <div className="p-6 text-center text-slate-400" data-testid="auth-required-banner">
        <p className="text-sm font-medium">Authentication required to view this content.</p>
      </div>
    );
  }

  if (requiredRole && user.role !== requiredRole) {
    return (
      <div className="p-6 text-center text-rose-400" data-testid="auth-forbidden-banner">
        <p className="text-sm font-medium">Insufficient permissions. Role '{requiredRole}' required.</p>
      </div>
    );
  }

  return <>{children}</>;
};
`;
    await vfsManager.writeFile(projectId, '/src/components/ProtectedRoute.tsx', protectedRouteComponent, 'typescript');
    try {
      const { useProjectStore } = await import('../../store/projectStore');
      useProjectStore.getState().syncProjectFilesFromVFS(projectId);
    } catch {}
  }
}

export const authCoordinator = AuthCoordinator.getInstance();
