import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DatabaseProviderId,
  DatabaseMetadata,
  TableSchema,
  MigrationRecord,
  MigrationStatus
} from '../types/database';
import { DatabaseProvider } from '../features/database/providers/database-provider-interface';
import { MockDatabaseProvider } from '../features/database/providers/mock-database-provider';
import { SupabaseProvider } from '../features/database/providers/supabase-provider';

// ---------------------------------------------------------------------------
// Ephemeral Runtime Provider Instances (Memory-Only, Zero Secrets)
// Map: projectId -> DatabaseProvider
// ---------------------------------------------------------------------------
const activeProviders: Record<string, DatabaseProvider> = {};

// Clean up provider connections on window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const pId of Object.keys(activeProviders)) {
      activeProviders[pId].disconnect().catch(() => {});
      delete activeProviders[pId];
    }
  });
}

export interface DatabaseState {
  // Persisted Slice (Strictly non-sensitive metadata only; ZERO secret values)
  selectedProvider: DatabaseProviderId;
  projectDatabaseMetadata: Record<string, DatabaseMetadata>;
  projectSchemas: Record<string, TableSchema[]>;
  projectMigrationHistory: Record<string, MigrationRecord[]>;
  projectReconciliationStatus: Record<string, { inSync: boolean; lastReconciledAt: number }>;

  // Store Actions
  setSelectedProvider: (providerId: DatabaseProviderId) => void;
  setConnectionMetadata: (projectId: string, metadata: DatabaseMetadata | null) => void;
  setSchemas: (projectId: string, schemas: TableSchema[]) => void;
  recordMigration: (projectId: string, record: MigrationRecord) => void;
  updateMigrationStatus: (projectId: string, migrationId: string, status: MigrationStatus, error?: string) => void;
  setReconciliationStatus: (projectId: string, inSync: boolean) => void;

  // Provider Accessor
  getProvider: (projectId: string, providerId?: DatabaseProviderId) => DatabaseProvider;

  // Project Lifecycle Management
  duplicateProjectDatabase: (sourceProjectId: string, targetProjectId: string) => void;
  clearProjectDatabase: (projectId: string) => void;
}

export const useDatabaseStore = create<DatabaseState>()(
  persist(
    (set, get) => ({
      selectedProvider: 'mock',
      projectDatabaseMetadata: {},
      projectSchemas: {},
      projectMigrationHistory: {},
      projectReconciliationStatus: {},

      setSelectedProvider: (providerId) => set({ selectedProvider: providerId }),

      setConnectionMetadata: (projectId, metadata) => {
        set((state) => {
          const next = { ...state.projectDatabaseMetadata };
          if (metadata) {
            next[projectId] = metadata;
          } else {
            delete next[projectId];
          }
          return { projectDatabaseMetadata: next };
        });
      },

      setSchemas: (projectId, schemas) => {
        set((state) => ({
          projectSchemas: {
            ...state.projectSchemas,
            [projectId]: schemas
          }
        }));
      },

      recordMigration: (projectId, record) => {
        set((state) => {
          const history = state.projectMigrationHistory[projectId] || [];
          // Avoid duplicate entries with same migrationId
          const filtered = history.filter((m) => m.migrationId !== record.migrationId);
          return {
            projectMigrationHistory: {
              ...state.projectMigrationHistory,
              [projectId]: [...filtered, record]
            }
          };
        });
      },

      updateMigrationStatus: (projectId, migrationId, status, error) => {
        set((state) => {
          const history = state.projectMigrationHistory[projectId] || [];
          const updated = history.map((m) =>
            m.migrationId === migrationId
              ? { ...m, status, errorMessage: error || m.errorMessage }
              : m
          );
          return {
            projectMigrationHistory: {
              ...state.projectMigrationHistory,
              [projectId]: updated
            }
          };
        });
      },

      setReconciliationStatus: (projectId, inSync) => {
        set((state) => ({
          projectReconciliationStatus: {
            ...state.projectReconciliationStatus,
            [projectId]: { inSync, lastReconciledAt: Date.now() }
          }
        }));
      },

      getProvider: (projectId, providerId) => {
        const id = providerId || get().selectedProvider || 'mock';
        const key = `${projectId}:${id}`;
        if (!activeProviders[key]) {
          if (id === 'supabase') {
            activeProviders[key] = new SupabaseProvider();
          } else {
            activeProviders[key] = new MockDatabaseProvider();
          }
        }
        return activeProviders[key];
      },

      duplicateProjectDatabase: (sourceProjectId, targetProjectId) => {
        set((state) => {
          const sourceMeta = state.projectDatabaseMetadata[sourceProjectId];
          const sourceSchemas = state.projectSchemas[sourceProjectId];
          const sourceHistory = state.projectMigrationHistory[sourceProjectId];

          const nextMeta = { ...state.projectDatabaseMetadata };
          const nextSchemas = { ...state.projectSchemas };
          const nextHistory = { ...state.projectMigrationHistory };

          if (sourceMeta) {
            nextMeta[targetProjectId] = {
              ...sourceMeta,
              connectedAt: Date.now()
            };
          }
          if (sourceSchemas) {
            nextSchemas[targetProjectId] = JSON.parse(JSON.stringify(sourceSchemas));
          }
          if (sourceHistory) {
            nextHistory[targetProjectId] = JSON.parse(JSON.stringify(sourceHistory));
          }

          // Note: Privileged credentials are in envVarStore and NOT cloned!
          return {
            projectDatabaseMetadata: nextMeta,
            projectSchemas: nextSchemas,
            projectMigrationHistory: nextHistory
          };
        });
      },

      clearProjectDatabase: (projectId) => {
        // Disconnect active provider instances for this project
        for (const key of Object.keys(activeProviders)) {
          if (key.startsWith(`${projectId}:`)) {
            activeProviders[key].disconnect().catch(() => {});
            delete activeProviders[key];
          }
        }

        set((state) => {
          const nextMeta = { ...state.projectDatabaseMetadata };
          const nextSchemas = { ...state.projectSchemas };
          const nextHistory = { ...state.projectMigrationHistory };
          const nextRecon = { ...state.projectReconciliationStatus };

          delete nextMeta[projectId];
          delete nextSchemas[projectId];
          delete nextHistory[projectId];
          delete nextRecon[projectId];

          return {
            projectDatabaseMetadata: nextMeta,
            projectSchemas: nextSchemas,
            projectMigrationHistory: nextHistory,
            projectReconciliationStatus: nextRecon
          };
        });
      }
    }),
    {
      name: 'snapdeploy_database_v1',
      // Whitelist only non-sensitive metadata for localStorage persistence
      partialize: (state) => ({
        selectedProvider: state.selectedProvider,
        projectDatabaseMetadata: state.projectDatabaseMetadata,
        projectSchemas: state.projectSchemas,
        projectMigrationHistory: state.projectMigrationHistory,
        projectReconciliationStatus: state.projectReconciliationStatus
      })
    }
  )
);

if (typeof window !== 'undefined') {
  (window as any).__SNAPDEPLOY_DATABASE_STORE__ = useDatabaseStore;
}
