import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  EnvVarMetadata,
  ProjectEnvVar,
  EnvImportResult
} from '../types/workspace';
import {
  registerSecret,
  unregisterSecret,
  clearRegisteredSecrets,
  validateEnvVarKey,
  isViteClientVariable,
  normalizeEnvKey,
  isDuplicateKey
} from '../features/deployment/security/secret-sanitizer';

// ---------------------------------------------------------------------------
// Ephemeral Memory-Only Secrets Storage (Strictly excluded from persistence)
// Map: projectId -> { [key]: secretValue }
// ---------------------------------------------------------------------------
const inMemorySecrets: Record<string, Record<string, string>> = {};

export function purgeAllMemorySecrets(): void {
  for (const pId of Object.keys(inMemorySecrets)) {
    delete inMemorySecrets[pId];
  }
  clearRegisteredSecrets();
}

// Clean all memory-only secrets on tab close or window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', purgeAllMemorySecrets);
}

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------
export interface EnvVarState {
  // Persisted Slice (Strictly non-sensitive metadata only; NO secret values)
  envVarMetadata: Record<string, EnvVarMetadata[]>;

  // Safe Accessors (Separate metadata and secret queries)
  getProjectEnvVarMetadata: (projectId: string) => EnvVarMetadata[];
  getProjectSecretValue: (projectId: string, key: string) => string | null;
  getProjectEnvVars: (projectId: string) => ProjectEnvVar[];

  // Mutations
  setEnvVar: (
    projectId: string,
    key: string,
    value: string,
    isSecret?: boolean,
    description?: string
  ) => { success: boolean; error?: string };

  updateEnvVar: (
    projectId: string,
    varId: string,
    updates: { key?: string; value?: string; isSecret?: boolean; description?: string }
  ) => { success: boolean; error?: string };

  removeEnvVar: (projectId: string, varId: string) => void;

  // Project Lifecycle Management
  duplicateProjectEnvVars: (sourceProjectId: string, targetProjectId: string) => void;
  clearProjectEnvVars: (projectId: string) => void;

  // Manual .env Import & Safe .env.example Export
  importEnvString: (projectId: string, rawContent: string) => EnvImportResult;
  exportEnvExampleTemplate: (projectId: string) => string;
}

export const useEnvVarStore = create<EnvVarState>()(
  persist(
    (set, get) => ({
      envVarMetadata: {},

      /**
       * Safe Accessor 1: Returns project variable metadata ONLY.
       * Contains no sensitive values. Safe for general UI, lists, and summaries.
       */
      getProjectEnvVarMetadata: (projectId: string): EnvVarMetadata[] => {
        return get().envVarMetadata[projectId] || [];
      },

      /**
       * Safe Accessor 2: Returns the secret value for a specific key on demand.
       * Called strictly at the point of provider deployment or intentional user reveal.
       */
      getProjectSecretValue: (projectId: string, key: string): string | null => {
        const normKey = normalizeEnvKey(key);
        return inMemorySecrets[projectId]?.[normKey] ?? null;
      },

      /**
       * Combined accessor for deployment providers and edit workflows.
       * Assembles metadata with memory-only values on demand.
       */
      getProjectEnvVars: (projectId: string): ProjectEnvVar[] => {
        const metadata = get().envVarMetadata[projectId] || [];
        const secrets = inMemorySecrets[projectId] || {};

        return metadata.map((item) => ({
          ...item,
          value: secrets[item.key] || ''
        }));
      },

      /**
       * Creates or updates an environment variable with key validation and duplicate prevention.
       */
      setEnvVar: (projectId, key, value, isSecret, description) => {
        const validation = validateEnvVarKey(key);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        const normKey = normalizeEnvKey(key);
        const cleanValue = value || '';

        // Vite client variables are inherently public/client-visible
        const isClientVar = isViteClientVariable(normKey);
        const resolvedIsSecret = isClientVar ? false : (isSecret ?? true);

        // Check for duplicate key collision
        const currentMeta = get().envVarMetadata[projectId] || [];
        const existingItem = currentMeta.find((item) => normalizeEnvKey(item.key) === normKey);

        // Store value strictly in memory
        if (!inMemorySecrets[projectId]) {
          inMemorySecrets[projectId] = {};
        }

        // Clean up previous secret from scrubber if updating
        if (existingItem) {
          const oldVal = inMemorySecrets[projectId][existingItem.key];
          if (oldVal) {
            unregisterSecret(oldVal);
          }
        }

        inMemorySecrets[projectId][normKey] = cleanValue;

        if (resolvedIsSecret && cleanValue) {
          registerSecret(cleanValue);
        }

        // Update metadata slice (persisted to storage with NO values)
        set((state) => {
          const list = state.envVarMetadata[projectId] || [];
          let updatedList: EnvVarMetadata[];

          if (existingItem) {
            updatedList = list.map((item) =>
              item.id === existingItem.id
                ? {
                    ...item,
                    key: normKey,
                    isSecret: resolvedIsSecret,
                    isClientVisible: isClientVar,
                    description: description ?? item.description,
                    updatedAt: Date.now()
                  }
                : item
            );
          } else {
            const newItem: EnvVarMetadata = {
              id: `env_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              key: normKey,
              isSecret: resolvedIsSecret,
              isClientVisible: isClientVar,
              description: description || '',
              updatedAt: Date.now()
            };
            updatedList = [...list, newItem];
          }

          return {
            envVarMetadata: {
              ...state.envVarMetadata,
              [projectId]: updatedList
            }
          };
        });

        return { success: true };
      },

      /**
       * Updates an existing environment variable by ID.
       */
      updateEnvVar: (projectId, varId, updates) => {
        const currentMeta = get().envVarMetadata[projectId] || [];
        const existing = currentMeta.find((item) => item.id === varId);
        if (!existing) {
          return { success: false, error: 'Environment variable not found.' };
        }

        const targetKey = updates.key ? normalizeEnvKey(updates.key) : existing.key;

        // If key is being modified, validate syntax and duplicate collisions
        if (updates.key && targetKey !== existing.key) {
          const validation = validateEnvVarKey(targetKey);
          if (!validation.valid) {
            return { success: false, error: validation.error };
          }

          const existingKeys = currentMeta.map((m) => m.key);
          if (isDuplicateKey(existingKeys, targetKey, existing.key)) {
            return { success: false, error: `An environment variable named "${targetKey}" already exists.` };
          }
        }

        const isClientVar = isViteClientVariable(targetKey);
        const resolvedIsSecret = isClientVar
          ? false
          : (updates.isSecret !== undefined ? updates.isSecret : existing.isSecret);

        // Update memory value
        if (!inMemorySecrets[projectId]) {
          inMemorySecrets[projectId] = {};
        }

        const oldVal = inMemorySecrets[projectId][existing.key];
        if (oldVal) {
          unregisterSecret(oldVal);
        }

        if (updates.key && targetKey !== existing.key) {
          delete inMemorySecrets[projectId][existing.key];
        }

        const nextVal = updates.value !== undefined ? updates.value : (oldVal || '');
        inMemorySecrets[projectId][targetKey] = nextVal;

        if (resolvedIsSecret && nextVal) {
          registerSecret(nextVal);
        }

        // Update metadata
        set((state) => {
          const list = state.envVarMetadata[projectId] || [];
          const updatedList = list.map((item) =>
            item.id === varId
              ? {
                  ...item,
                  key: targetKey,
                  isSecret: resolvedIsSecret,
                  isClientVisible: isClientVar,
                  description: updates.description !== undefined ? updates.description : item.description,
                  updatedAt: Date.now()
                }
              : item
          );

          return {
            envVarMetadata: {
              ...state.envVarMetadata,
              [projectId]: updatedList
            }
          };
        });

        return { success: true };
      },

      /**
       * Deletes an environment variable by ID. Cleans up metadata, memory secrets, and scrubbing registry.
       */
      removeEnvVar: (projectId, varId) => {
        const currentMeta = get().envVarMetadata[projectId] || [];
        const itemToRemove = currentMeta.find((item) => item.id === varId);

        if (itemToRemove && inMemorySecrets[projectId]) {
          const secretVal = inMemorySecrets[projectId][itemToRemove.key];
          if (secretVal) {
            unregisterSecret(secretVal);
            delete inMemorySecrets[projectId][itemToRemove.key];
          }
        }

        set((state) => ({
          envVarMetadata: {
            ...state.envVarMetadata,
            [projectId]: (state.envVarMetadata[projectId] || []).filter((item) => item.id !== varId)
          }
        }));
      },

      /**
       * Project Duplication Lifecycle:
       * Clones variable metadata (keys, types, descriptions) to targetProjectId,
       * but strictly ensures secret values are NOT cloned (remains empty).
       */
      duplicateProjectEnvVars: (sourceProjectId, targetProjectId) => {
        const sourceMeta = get().envVarMetadata[sourceProjectId] || [];
        if (sourceMeta.length === 0) return;

        // Construct cloned metadata with new unique IDs and fresh timestamps
        const clonedMeta: EnvVarMetadata[] = sourceMeta.map((item) => ({
          id: `env_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          key: item.key,
          isSecret: item.isSecret,
          isClientVisible: item.isClientVisible,
          description: item.description,
          updatedAt: Date.now()
        }));

        // Initialize target project in memory secrets with EMPTY values (never clone secrets)
        inMemorySecrets[targetProjectId] = {};

        set((state) => ({
          envVarMetadata: {
            ...state.envVarMetadata,
            [targetProjectId]: clonedMeta
          }
        }));
      },

      /**
       * Project Deletion Lifecycle:
       * Completely purges all metadata, memory secrets, and scrubbing entries for projectId.
       */
      clearProjectEnvVars: (projectId) => {
        if (inMemorySecrets[projectId]) {
          for (const key of Object.keys(inMemorySecrets[projectId])) {
            const secretVal = inMemorySecrets[projectId][key];
            if (secretVal) {
              unregisterSecret(secretVal);
            }
          }
          delete inMemorySecrets[projectId];
        }

        set((state) => {
          const newMeta = { ...state.envVarMetadata };
          delete newMeta[projectId];
          return { envVarMetadata: newMeta };
        });
      },

      /**
       * Manual .env Input Parser:
       * Parses KEY=VALUE format directly into memory-only storage.
       * Never writes to VFS, Version History, Monaco, or logs.
       */
      importEnvString: (projectId, rawContent) => {
        const lines = (rawContent || '').split(/\r?\n/);
        const result: EnvImportResult = {
          successCount: 0,
          ignoredCount: 0,
          errors: [],
          importedKeys: []
        };

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          // Skip empty lines and comment lines
          if (!line || line.startsWith('#')) {
            result.ignoredCount++;
            continue;
          }

          const eqIdx = line.indexOf('=');
          if (eqIdx === -1) {
            result.errors.push(`Line ${i + 1}: Missing "=" delimiter.`);
            continue;
          }

          const rawKey = line.slice(0, eqIdx).trim();
          let rawVal = line.slice(eqIdx + 1).trim();

          // Strip surrounding quotes if matching
          if (
            (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
            (rawVal.startsWith("'") && rawVal.endsWith("'"))
          ) {
            rawVal = rawVal.slice(1, -1);
          }

          const validation = validateEnvVarKey(rawKey);
          if (!validation.valid) {
            result.errors.push(`Line ${i + 1}: ${validation.error || 'Invalid key name'}`);
            continue;
          }

          const res = get().setEnvVar(projectId, rawKey, rawVal);
          if (res.success) {
            result.successCount++;
            result.importedKeys.push(normalizeEnvKey(rawKey));
          } else {
            result.errors.push(`Line ${i + 1} (${rawKey}): ${res.error}`);
          }
        }

        return result;
      },

      /**
       * Safe .env.example Export:
       * Generates a safe metadata-only template file containing variable names
       * and empty placeholders (NO secret values ever exported).
       */
      exportEnvExampleTemplate: (projectId) => {
        const metadata = get().envVarMetadata[projectId] || [];
        if (metadata.length === 0) {
          return '# SnapDeploy AI — Environment Configuration Template\n# No environment variables configured for this project.\n';
        }

        const header = [
          '# SnapDeploy AI — Environment Configuration Template',
          '# This file contains variable names and placeholder keys only.',
          '# Sensitive secret values are strictly excluded.',
          ''
        ];

        const lines = metadata.map((item) => {
          const comment = item.description ? `\n# ${item.description}` : '';
          const typeBadge = item.isClientVisible
            ? '# Type: Public (Vite Client Bundle)'
            : '# Type: Provider Secret (Runtime)';
          return `${comment}\n${typeBadge}\n${item.key}=`;
        });

        return `${header.join('\n')}${lines.join('\n')}\n`;
      }
    }),
    {
      name: 'snapdeploy_env_vars_v1',
      // Strictly whitelist only non-sensitive metadata for localStorage persistence
      partialize: (state) => ({
        envVarMetadata: state.envVarMetadata
      })
    }
  )
);
