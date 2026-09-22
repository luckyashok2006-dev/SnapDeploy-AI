import React, { useState, useEffect } from 'react';
import {
  Shield,
  Key,
  Users,
  Code2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  EyeOff,
  LogOut,
  ExternalLink,
  Lock,
  Globe,
  Plus,
  Trash2
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { authCoordinator } from '../../features/auth/auth-coordinator';
import {
  AuthProviderId,
  AuthConfig,
  AuthUser,
  AuthMetadata
} from '../../types/auth';
import { isProductionEnvironment } from '../../lib/environment';

interface AuthManagerProps {
  projectId: string;
}

export const AuthManager: React.FC<AuthManagerProps> = ({ projectId }) => {
  const metadata = useAuthStore((s) => s.projectAuthMetadata[projectId]);
  const config = useAuthStore((s) => s.projectAuthConfig[projectId]);

  // Tab State
  const [activeTab, setActiveTab] = useState<'config' | 'users' | 'code'>('config');

  // Configuration Form State
  const [providerId, setProviderId] = useState<AuthProviderId>(
    config?.providerId || (isProductionEnvironment() ? 'supabase' : 'mock')
  );
  const [endpoint, setEndpoint] = useState<string>(
    config?.endpoint || (providerId === 'mock' ? 'http://localhost:3000/api/auth/mock' : 'https://xyz.supabase.co')
  );
  const [anonKey, setAnonKey] = useState<string>('');
  const [serviceKey, setServiceKey] = useState<string>('');
  const [showServiceKey, setShowServiceKey] = useState(false);
  const [enableEmailPassword, setEnableEmailPassword] = useState<boolean>(
    config?.enableEmailPassword ?? true
  );
  const [enableOAuth, setEnableOAuth] = useState<boolean>(config?.enableOAuth ?? false);
  const [oauthGoogle, setOauthGoogle] = useState<boolean>(
    config?.oauthProviders?.includes('google') ?? true
  );
  const [oauthGithub, setOauthGithub] = useState<boolean>(
    config?.oauthProviders?.includes('github') ?? true
  );
  const [roles, setRoles] = useState<string[]>(config?.roles || ['user', 'admin']);
  const [newRole, setNewRole] = useState<string>('');

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Users State
  const [usersList, setUsersList] = useState<AuthUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  const isConfigured = metadata?.status === 'configured';

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const provider = useAuthStore.getState().getProvider(projectId, providerId);
      const users = await provider.listUsers();
      setUsersList(users);
    } catch {
      setUsersList([]);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'users' && isConfigured) {
      loadUsers();
    }
  }, [activeTab, isConfigured]);

  const handleProviderChange = (newProvider: AuthProviderId) => {
    setProviderId(newProvider);
    if (newProvider === 'mock') {
      setEndpoint('http://localhost:3000/api/auth/mock');
    } else if (newProvider === 'supabase') {
      setEndpoint('https://xyz.supabase.co');
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const selectedOAuth: string[] = [];
    if (oauthGoogle) selectedOAuth.push('google');
    if (oauthGithub) selectedOAuth.push('github');

    const authConfig: AuthConfig = {
      providerId,
      endpoint,
      enableEmailPassword,
      enableOAuth,
      oauthProviders: selectedOAuth,
      roles: roles.length > 0 ? roles : ['user', 'admin'],
      defaultRole: roles[0] || 'user'
    };

    try {
      await authCoordinator.connectAuth(projectId, authConfig, {
        apiKey: anonKey.trim() || undefined,
        serviceKey: serviceKey.trim() || undefined
      });
      setSuccessMsg('Authentication provider configured and client files generated successfully!');
      // Wipe ephemeral input fields
      setAnonKey('');
      setServiceKey('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to configure authentication provider.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await authCoordinator.disconnectAuth(projectId);
      setSuccessMsg('Authentication provider disconnected.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to disconnect authentication provider.');
    }
  };

  const handleAddRole = () => {
    const trimmed = newRole.trim().toLowerCase();
    if (trimmed && !roles.includes(trimmed)) {
      setRoles([...roles, trimmed]);
      setNewRole('');
    }
  };

  const handleRemoveRole = (roleToRemove: string) => {
    if (roles.length > 1) {
      setRoles(roles.filter((r) => r !== roleToRemove));
    }
  };

  return (
    <div className="space-y-6" data-testid="auth-manager">
      {/* Top Status Bar */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`w-3 h-3 rounded-full shrink-0 ${
              isConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white">
                {isConfigured ? 'Authentication Active' : 'No Provider Configured'}
              </span>
              <span
                data-testid="auth-status-pill"
                className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold shrink-0 ${
                  isConfigured
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-white/10'
                }`}
              >
                {metadata?.status || 'unconfigured'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 break-all">
              Provider: <span className="text-slate-300 font-medium">{metadata?.providerId || providerId}</span>
              {metadata?.endpoint && ` • ${metadata.endpoint}`}
            </p>
          </div>
        </div>

        {isConfigured && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 hover:border-rose-500/30 border border-white/10 text-slate-300 hover:text-rose-300 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            data-testid="auth-disconnect-btn"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Disconnect</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Auth tabs" className="flex flex-wrap border-b border-white/10 gap-4">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'config'}
          onClick={() => setActiveTab('config')}
          className={`pb-3 text-xs font-medium transition flex items-center gap-2 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            activeTab === 'config'
              ? 'border-indigo-500 text-indigo-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
          data-testid="auth-tab-config"
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Provider & Features</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'users'}
          onClick={() => setActiveTab('users')}
          className={`pb-3 text-xs font-medium transition flex items-center gap-2 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            activeTab === 'users'
              ? 'border-indigo-500 text-indigo-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
          data-testid="auth-tab-users"
        >
          <Users className="w-3.5 h-3.5" />
          <span>Users & Directory</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'code'}
          onClick={() => setActiveTab('code')}
          className={`pb-3 text-xs font-medium transition flex items-center gap-2 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            activeTab === 'code'
              ? 'border-indigo-500 text-indigo-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
          data-testid="auth-tab-code"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Generated Client</span>
        </button>
      </div>

      {/* Feedback Alerts */}
      {errorMsg && (
        <div
          className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2"
          data-testid="auth-error-banner"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div
          className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2"
          data-testid="auth-success-banner"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tab 1: Configuration */}
      {activeTab === 'config' && (
        <form onSubmit={handleSaveConfig} className="space-y-4" data-testid="auth-config-form">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Authentication Provider
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleProviderChange('mock')}
                className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                  providerId === 'mock'
                    ? 'bg-indigo-600/15 border-indigo-500 text-white'
                    : 'bg-slate-900 border-white/10 text-slate-400 hover:border-white/20'
                }`}
                data-testid="provider-select-mock"
              >
                <div>
                  <div className="font-semibold text-xs text-white">Mock Auth Provider</div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Deterministic offline test provider with pre-seeded users.
                  </div>
                </div>
                <span className="text-[10px] font-mono mt-2 text-indigo-400 font-medium">
                  Recommended for Testing
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleProviderChange('supabase')}
                className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                  providerId === 'supabase'
                    ? 'bg-indigo-600/15 border-indigo-500 text-white'
                    : 'bg-slate-900 border-white/10 text-slate-400 hover:border-white/20'
                }`}
                data-testid="provider-select-supabase"
              >
                <div>
                  <div className="font-semibold text-xs text-white">Supabase Auth (GoTrue)</div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Managed PostgreSQL auth with JWT sessions, OAuth, & RLS.
                  </div>
                </div>
                <span className="text-[10px] font-mono mt-2 text-indigo-400 font-medium">
                  Production Cloud
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Auth Endpoint / URL
            </label>
            <input
              type="text"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-project.supabase.co"
              className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              data-testid="auth-endpoint-input"
            />
          </div>

          {providerId === 'supabase' && (
            <div className="space-y-3 p-4 rounded-xl bg-slate-900/40 border border-white/5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    Public Anon Key (<code className="text-emerald-400 font-mono text-[11px]">VITE_SUPABASE_ANON_KEY</code>)
                  </label>
                  <span className="text-[10px] text-emerald-400 font-medium">Client Safe</span>
                </div>
                <input
                  type="text"
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  data-testid="auth-anon-key-input"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    Service Role Key (<code className="text-rose-400 font-mono text-[11px]">SUPABASE_SERVICE_ROLE_KEY</code>)
                  </label>
                  <span className="text-[10px] text-rose-400 font-medium">Admin Secret (100% Memory-Only)</span>
                </div>
                <div className="relative">
                  <input
                    type={showServiceKey ? 'text' : 'password'}
                    value={serviceKey}
                    onChange={(e) => setServiceKey(e.target.value)}
                    placeholder="Optional: Admin management key (never saved in authStore)"
                    className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-indigo-500 pr-10"
                    data-testid="auth-service-key-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowServiceKey(!showServiceKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showServiceKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Authentication Features */}
          <div className="p-4 rounded-xl bg-slate-900/40 border border-white/5 space-y-3">
            <h4 className="text-xs font-semibold text-white">Authentication Capabilities</h4>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableEmailPassword}
                onChange={(e) => setEnableEmailPassword(e.target.checked)}
                className="rounded border-white/10 bg-slate-800 text-indigo-600 focus:ring-0"
                data-testid="auth-enable-email-checkbox"
              />
              <span className="text-xs text-slate-300">Enable Email & Password Signup / Login</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableOAuth}
                onChange={(e) => setEnableOAuth(e.target.checked)}
                className="rounded border-white/10 bg-slate-800 text-indigo-600 focus:ring-0"
                data-testid="auth-enable-oauth-checkbox"
              />
              <span className="text-xs text-slate-300">Enable OAuth Providers</span>
            </label>

            {enableOAuth && (
              <div className="ml-6 space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={oauthGoogle}
                    onChange={(e) => setOauthGoogle(e.target.checked)}
                    className="rounded border-white/10 bg-slate-800 text-indigo-600 focus:ring-0"
                    data-testid="oauth-google-checkbox"
                  />
                  <span className="text-xs text-slate-400">Google OAuth</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={oauthGithub}
                    onChange={(e) => setOauthGithub(e.target.checked)}
                    className="rounded border-white/10 bg-slate-800 text-indigo-600 focus:ring-0"
                    data-testid="oauth-github-checkbox"
                  />
                  <span className="text-xs text-slate-400">GitHub OAuth</span>
                </label>
              </div>
            )}
          </div>

          {/* Roles & Permissions */}
          <div className="p-4 rounded-xl bg-slate-900/40 border border-white/5 space-y-3">
            <h4 className="text-xs font-semibold text-white">Application Roles</h4>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <span
                  key={r}
                  className="px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-mono flex items-center gap-1.5"
                >
                  <span>{r}</span>
                  {roles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRole(r)}
                      className="text-indigo-400 hover:text-rose-400"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="Add custom role (e.g. editor, viewer)"
                className="flex-1 px-3 py-1.5 bg-slate-900 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddRole}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition"
              >
                Add Role
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
            data-testid="auth-connect-btn"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Configuring & Generating Client...</span>
              </>
            ) : (
              <span>Save Configuration & Generate Client</span>
            )}
          </button>
        </form>
      )}

      {/* Tab 2: Users & Directory */}
      {activeTab === 'users' && (
        <div className="space-y-4" data-testid="auth-users-directory">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Active User Directory ({usersList.length} users registered)
            </span>
            <button
              onClick={loadUsers}
              disabled={isLoadingUsers}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingUsers ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {usersList.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-white/10 rounded-xl">
              <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-400">
                {isConfigured ? 'No users registered yet.' : 'Configure authentication provider to view users.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="auth-users-list">
              {usersList.map((u) => (
                <div
                  key={u.id}
                  className="p-3 rounded-xl bg-slate-900/80 border border-white/5 flex items-center justify-between gap-3 min-w-0"
                  data-testid={`user-row-${u.email}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white truncate" title={u.email}>{u.email}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      Name: {u.name || 'Not set'} • ID: <span className="font-mono">{u.id}</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold shrink-0">
                    {u.role || 'user'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Generated Client Code Preview */}
      {activeTab === 'code' && (
        <div className="space-y-4" data-testid="auth-code-preview">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/10 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 min-w-0">
              <span className="text-xs font-mono text-indigo-400 font-medium truncate">/src/lib/auth.ts</span>
              <span className="text-[10px] text-slate-400 shrink-0">Client Auth Interface</span>
            </div>
            <pre className="text-[11px] font-mono text-slate-300 bg-[#0B0F17] p-3 rounded-lg overflow-x-auto border border-white/5 max-h-48 custom-scrollbar max-w-full">
{`import { auth } from './lib/auth';

// Sign In
await auth.signIn(email, password);

// Sign Up
await auth.signUp(email, password, name);

// Current User & Session
const user = auth.getUser();
const session = auth.getSession();

// Sign Out
await auth.signOut();`}
            </pre>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/10 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 min-w-0">
              <span className="text-xs font-mono text-indigo-400 font-medium truncate">/src/components/ProtectedRoute.tsx</span>
              <span className="text-[10px] text-slate-400 shrink-0">Route / View Guard</span>
            </div>
            <pre className="text-[11px] font-mono text-slate-300 bg-[#0B0F17] p-3 rounded-lg overflow-x-auto border border-white/5 max-h-48 custom-scrollbar max-w-full">
{`import { ProtectedRoute } from './components/ProtectedRoute';

<ProtectedRoute requiredRole="admin">
  <AdminDashboard />
</ProtectedRoute>`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
