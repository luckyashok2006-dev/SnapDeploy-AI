import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DeploymentStatus,
  DeploymentProviderId,
  DeploymentRecord,
  DeploymentEnvVar
} from '../types/workspace';
import {
  registerSecret,
  unregisterSecret,
  clearRegisteredSecrets
} from '../features/deployment/security/secret-sanitizer';
import { useEnvVarStore } from './envVarStore';
import { isProductionEnvironment } from '../lib/environment';

// ---------------------------------------------------------------------------
// Ephemeral, memory-only storage (Strictly forbidden from persistence)
// ---------------------------------------------------------------------------
const inMemoryCredentials: Record<string, string> = isProductionEnvironment()
  ? {}
  : {
      // Default mock token for instant test/offline use (dev/test only)
      mock: 'mock-test-token'
    };

// Map: projectId -> AbortController
const inFlightAbortControllers: Record<string, AbortController> = {};

// Clean all memory on tab close or window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const key of Object.keys(inMemoryCredentials)) {
      delete inMemoryCredentials[key];
    }
    clearRegisteredSecrets();
  });
}

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------
export interface ActiveDeploymentProgress {
  status: DeploymentStatus;
  progressStage?: string;
  percent?: number;
  error?: string;
}

interface DeploymentState {
  // Persisted Slice (Strictly Whitelisted Non-Sensitive Metadata Only)
  selectedProvider: DeploymentProviderId;
  deployments: Record<string, DeploymentRecord[]>; // projectId -> records
  envVarMetadata: Record<string, { id: string; key: string; isSecret: boolean }[]>; // projectId -> metadata (NO values)

  // Transient/Ephemeral UI State
  activeDeployments: Record<string, ActiveDeploymentProgress>;

  // Actions
  setSelectedProvider: (provider: DeploymentProviderId) => void;
  setCredentials: (provider: DeploymentProviderId, token: string) => void;
  disconnect: (provider: DeploymentProviderId) => void;
  getCredentials: (provider: DeploymentProviderId) => string | null;

  setEnvVar: (projectId: string, key: string, value: string, isSecret?: boolean) => { success: boolean; error?: string };
  removeEnvVar: (projectId: string, varId: string) => void;
  getProjectEnvVars: (projectId: string) => DeploymentEnvVar[];

  setActiveProgress: (projectId: string, progress: ActiveDeploymentProgress) => void;
  recordDeployment: (record: DeploymentRecord) => void;
  clearProjectDeployments: (projectId: string) => void;

  setAbortController: (projectId: string, controller: AbortController | null) => void;
  cancelActiveDeployment: (projectId: string) => void;
}

export function sanitizeDeploymentPersistedState(state: any): void {
  if (state && isProductionEnvironment() && state.selectedProvider === 'mock') {
    state.selectedProvider = 'netlify';
  }
}

export const useDeploymentStore = create<DeploymentState>()(
  persist(
    (set, get) => ({
      selectedProvider: isProductionEnvironment() ? 'netlify' : 'mock',
      deployments: {},
      envVarMetadata: {},
      activeDeployments: {},

      setSelectedProvider: (provider) => {
        if (isProductionEnvironment() && provider === 'mock') {
          return;
        }
        set({ selectedProvider: provider });
      },

      setCredentials: (provider, token) => {
        if (isProductionEnvironment() && provider === 'mock') {
          return;
        }
        const trimmed = (token || '').trim();
        if (trimmed) {
          inMemoryCredentials[provider] = trimmed;
          registerSecret(trimmed);
        }
      },

      disconnect: (provider) => {
        const oldToken = inMemoryCredentials[provider];
        if (oldToken) {
          unregisterSecret(oldToken);
          delete inMemoryCredentials[provider];
        }
      },

      getCredentials: (provider) => {
        if (isProductionEnvironment() && provider === 'mock') {
          return null;
        }
        return inMemoryCredentials[provider] || null;
      },

      setEnvVar: (projectId, key, value, isSecret) => {
        return useEnvVarStore.getState().setEnvVar(projectId, key, value, isSecret);
      },

      removeEnvVar: (projectId, varId) => {
        useEnvVarStore.getState().removeEnvVar(projectId, varId);
      },

      getProjectEnvVars: (projectId) => {
        return useEnvVarStore.getState().getProjectEnvVars(projectId);
      },

      setActiveProgress: (projectId, progress) => {
        set((state) => ({
          activeDeployments: {
            ...state.activeDeployments,
            [projectId]: progress
          }
        }));
      },

      recordDeployment: (record) => {
        // Enforce whitelist: only non-sensitive metadata is accepted
        const sanitizedRecord: DeploymentRecord = {
          deploymentId: record.deploymentId,
          projectId: record.projectId,
          timestamp: record.timestamp,
          status: record.status,
          provider: record.provider,
          url: record.url,
          deployId: record.deployId,
          siteId: record.siteId,
          durationMs: record.durationMs,
          buildDurationMs: record.buildDurationMs,
          fileCount: record.fileCount,
          artifactSizeBytes: record.artifactSizeBytes,
          commitSummary: record.commitSummary,
          errorMessage: record.errorMessage
        };

        set((state) => {
          const currentRecords = state.deployments[record.projectId] || [];
          return {
            deployments: {
              ...state.deployments,
              [record.projectId]: [sanitizedRecord, ...currentRecords]
            }
          };
        });
      },

      clearProjectDeployments: (projectId) => {
        // Abort in-flight deployment if active
        if (inFlightAbortControllers[projectId]) {
          inFlightAbortControllers[projectId].abort();
          delete inFlightAbortControllers[projectId];
        }

        // Clean memory-only secrets and metadata via canonical store
        useEnvVarStore.getState().clearProjectEnvVars(projectId);

        // Clean store metadata
        set((state) => {
          const newDeployments = { ...state.deployments };
          delete newDeployments[projectId];

          const newEnvMeta = { ...state.envVarMetadata };
          delete newEnvMeta[projectId];

          const newActive = { ...state.activeDeployments };
          delete newActive[projectId];

          return {
            deployments: newDeployments,
            envVarMetadata: newEnvMeta,
            activeDeployments: newActive
          };
        });
      },

      setAbortController: (projectId, controller) => {
        if (controller) {
          inFlightAbortControllers[projectId] = controller;
        } else {
          delete inFlightAbortControllers[projectId];
        }
      },

      cancelActiveDeployment: (projectId) => {
        const controller = inFlightAbortControllers[projectId];
        if (controller) {
          controller.abort();
          delete inFlightAbortControllers[projectId];
        }
        get().setActiveProgress(projectId, {
          status: 'cancelled',
          progressStage: 'Cancelled',
          percent: 0,
          error: 'Deployment cancelled by user.'
        });
      }
    }),
    {
      name: 'snapdeploy-deployments-v1',
      // Strictly whitelist only non-sensitive metadata for localStorage persistence
      partialize: (state) => ({
        selectedProvider: state.selectedProvider,
        deployments: state.deployments,
        envVarMetadata: state.envVarMetadata
      }),
      onRehydrateStorage: () => (state) => {
        sanitizeDeploymentPersistedState(state);
      }
    }
  )
);
