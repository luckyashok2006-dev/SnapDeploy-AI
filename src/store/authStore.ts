import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AuthProviderId,
  AuthConfig,
  AuthMetadata,
  AuthUser
} from '../types/auth';
import { AuthProvider } from '../features/auth/providers/auth-provider-interface';
import { MockAuthProvider } from '../features/auth/providers/mock-auth-provider';
import { SupabaseAuthProvider } from '../features/auth/providers/supabase-auth-provider';
import { isProductionEnvironment } from '../lib/environment';

// ---------------------------------------------------------------------------
// Ephemeral Runtime Auth Provider Instances (Memory-Only, Zero Secrets)
// Map: projectId -> AuthProvider
// ---------------------------------------------------------------------------
const activeAuthProviders: Record<string, AuthProvider> = {};

// Clean up provider connections and sessions on window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const pId of Object.keys(activeAuthProviders)) {
      activeAuthProviders[pId].disconnect().catch(() => {});
      delete activeAuthProviders[pId];
    }
  });
}

export interface AuthState {
  // Persisted Slice (Strictly non-sensitive configuration & metadata; ZERO secret values)
  selectedProvider: AuthProviderId;
  projectAuthConfig: Record<string, AuthConfig>;
  projectAuthMetadata: Record<string, AuthMetadata>;
  projectUsers: Record<string, AuthUser[]>;

  // Store Actions
  setSelectedProvider: (providerId: AuthProviderId) => void;
  setAuthConfig: (projectId: string, config: AuthConfig) => void;
  setAuthMetadata: (projectId: string, metadata: AuthMetadata | null) => void;
  setUsers: (projectId: string, users: AuthUser[]) => void;

  // Provider Accessor
  getProvider: (projectId: string, providerId?: AuthProviderId) => AuthProvider;

  // Project Lifecycle Management
  duplicateProjectAuth: (sourceProjectId: string, targetProjectId: string) => void;
  clearProjectAuth: (projectId: string) => void;
}

export function sanitizeAuthPersistedState(state: any): void {
  if (state && isProductionEnvironment() && state.selectedProvider === 'mock') {
    state.selectedProvider = 'supabase';
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      selectedProvider: isProductionEnvironment() ? 'supabase' : 'mock',
      projectAuthConfig: {},
      projectAuthMetadata: {},
      projectUsers: {},

      setSelectedProvider: (providerId) => {
        if (isProductionEnvironment() && providerId === 'mock') {
          return;
        }
        set({ selectedProvider: providerId });
      },

      setAuthConfig: (projectId, config) => {
        set((state) => ({
          projectAuthConfig: {
            ...state.projectAuthConfig,
            [projectId]: config
          }
        }));
      },

      setAuthMetadata: (projectId, metadata) => {
        set((state) => {
          const next = { ...state.projectAuthMetadata };
          if (metadata) {
            next[projectId] = metadata;
          } else {
            delete next[projectId];
          }
          return { projectAuthMetadata: next };
        });
      },

      setUsers: (projectId, users) => {
        set((state) => ({
          projectUsers: {
            ...state.projectUsers,
            [projectId]: users
          }
        }));
      },

      getProvider: (projectId: string, providerId?: AuthProviderId): AuthProvider => {
        let targetProviderId =
          providerId ||
          get().projectAuthConfig[projectId]?.providerId ||
          get().selectedProvider ||
          (isProductionEnvironment() ? 'supabase' : 'mock');

        if (isProductionEnvironment() && targetProviderId === 'mock') {
          targetProviderId = 'supabase';
        }

        const existing = activeAuthProviders[projectId];
        if (existing && existing.id === targetProviderId) {
          return existing;
        }

        // Clean up previous provider instance if switching
        if (existing) {
          existing.disconnect().catch(() => {});
          delete activeAuthProviders[projectId];
        }

        const newInstance: AuthProvider =
          targetProviderId === 'supabase'
            ? new SupabaseAuthProvider()
            : new MockAuthProvider();

        activeAuthProviders[projectId] = newInstance;
        return newInstance;
      },

      duplicateProjectAuth: (sourceProjectId: string, targetProjectId: string) => {
        set((state) => {
          const sourceConfig = state.projectAuthConfig[sourceProjectId];
          const sourceMeta = state.projectAuthMetadata[sourceProjectId];
          const sourceUsers = state.projectUsers[sourceProjectId] || [];

          if (!sourceConfig && !sourceMeta) {
            return state;
          }

          return {
            projectAuthConfig: sourceConfig
              ? { ...state.projectAuthConfig, [targetProjectId]: { ...sourceConfig } }
              : state.projectAuthConfig,
            projectAuthMetadata: sourceMeta
              ? {
                  ...state.projectAuthMetadata,
                  [targetProjectId]: {
                    ...sourceMeta,
                    connectedAt: Date.now()
                  }
                }
              : state.projectAuthMetadata,
            // Clone non-sensitive user metadata without passwords
            projectUsers: {
              ...state.projectUsers,
              [targetProjectId]: sourceUsers.map((u) => ({ ...u }))
            }
          };
        });
      },

      clearProjectAuth: (projectId: string) => {
        // Disconnect ephemeral runtime provider
        const existing = activeAuthProviders[projectId];
        if (existing) {
          existing.disconnect().catch(() => {});
          delete activeAuthProviders[projectId];
        }

        set((state) => {
          const nextConfig = { ...state.projectAuthConfig };
          const nextMeta = { ...state.projectAuthMetadata };
          const nextUsers = { ...state.projectUsers };

          delete nextConfig[projectId];
          delete nextMeta[projectId];
          delete nextUsers[projectId];

          return {
            projectAuthConfig: nextConfig,
            projectAuthMetadata: nextMeta,
            projectUsers: nextUsers
          };
        });
      }
    }),
    {
      name: 'snapdeploy_auth_v1',
      partialize: (state) => ({
        selectedProvider: state.selectedProvider,
        projectAuthConfig: state.projectAuthConfig,
        projectAuthMetadata: state.projectAuthMetadata,
        projectUsers: state.projectUsers
      }),
      onRehydrateStorage: () => (state) => {
        sanitizeAuthPersistedState(state);
      }
    }
  )
);

if (typeof window !== 'undefined') {
  (window as any).__SNAPDEPLOY_AUTH_STORE__ = useAuthStore;
}
