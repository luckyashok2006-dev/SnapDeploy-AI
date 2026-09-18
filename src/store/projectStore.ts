import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ProjectWorkspace, ProjectFile, FileType, Snapshot } from "../types/workspace";
import { INITIAL_DEMO_PROJECTS } from "../demo/demoProjects";
import { vfsManager } from "../lib/vfs/vfs-manager";

export interface ProjectStoreState {
  projects: Record<string, ProjectWorkspace>;
  activeProjectId: string;
  deletedProjectIds: string[];

  // Actions
  setActiveProjectId: (id: string) => void;
  switchProject: (id: string) => Promise<void>;
  createProject: (name: string, description?: string) => string;
  deleteProject: (id: string) => Promise<boolean>;
  renameProject: (id: string, newTitle: string) => boolean;
  duplicateProject: (sourceProjectId: string, customTitle?: string) => Promise<string>;
  createSnapshot: (projectId: string, description: string) => Promise<Snapshot>;
  restoreSnapshot: (projectId: string, snapshotId: string) => Promise<boolean>;
  getProjectFiles: (projectId: string) => Record<string, ProjectFile>;
  syncProjectFilesFromVFS: (projectId: string) => void;

  // File operations (routed through VFS)
  writeFile: (
    projectId: string,
    path: string,
    content: string,
    language?: FileType,
  ) => Promise<ProjectFile>;
  writeFilesBulk: (
    projectId: string,
    files: Record<string, string>,
  ) => Promise<void>;
  deleteFile: (projectId: string, path: string) => Promise<void>;
  renameFile: (
    projectId: string,
    oldPath: string,
    newPath: string,
  ) => Promise<void>;
  setProjectStatus: (
    projectId: string,
    status: "ready" | "running" | "error",
  ) => void;
}

const inFlightDeletions = new Set<string>();
const inFlightDuplications = new Set<string>();
const inFlightRestores = new Set<string>();

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    (set, get) => ({
      projects: INITIAL_DEMO_PROJECTS,
      activeProjectId: "saas-dashboard",
      deletedProjectIds: [],

      setActiveProjectId: (id) => {
        if (get().projects[id]) {
          set({ activeProjectId: id });
          get().syncProjectFilesFromVFS(id);
          try {
            const { useAgentStore } = require('./agentStore');
            useAgentStore.getState().syncActiveProject?.(id);
          } catch {}
        }
      },

      switchProject: async (id) => {
        if (!get().projects[id]) return;
        set({ activeProjectId: id });
        get().syncProjectFilesFromVFS(id);
        try {
          const { useAgentStore } = await import('./agentStore');
          useAgentStore.getState().syncActiveProject?.(id);
        } catch {}
        // Forward to runtime store canonical initialization
        const { useRuntimeStore } = await import("./runtimeStore");
        await useRuntimeStore.getState().initializeProject(id);
      },

      createProject: (name, description = "") => {
        const id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const newProject: ProjectWorkspace = {
          id,
          title: name,
          description: description || "AI-generated Vite + React application",
          badge: "Vite + React",
          status: "ready",
          files: {},
          openTabs: [],
          activeFilePath: "",
          diagnostics: [],
          fixHistory: [],
        };

        set((state) => ({
          projects: {
            ...state.projects,
            [id]: newProject,
          },
          activeProjectId: id,
        }));

        return id;
      },

      deleteProject: async (id: string): Promise<boolean> => {
        // Step 1: Validate project exists
        const currentProjects = get().projects;
        const projectToDelete = currentProjects[id];
        if (!projectToDelete) {
          throw new Error(`Project with ID '${id}' does not exist.`);
        }

        // Step 2: Prevent concurrent deletion of the same project
        if (inFlightDeletions.has(id)) {
          throw new Error(`Project deletion is already in progress for '${id}'.`);
        }
        inFlightDeletions.add(id);

        try {
          // Step 3: Determine active/next project
          const isActive = get().activeProjectId === id;
          const remainingIds = Object.keys(currentProjects).filter((projId) => projId !== id);
          const nextProjectId = remainingIds[0] || "";

          // Step 4: Stop active runtime safely
          const { runtimeManager } = await import("../lib/runtime/runtime-manager");
          if (isActive) {
            if (runtimeManager.isDevServerRunning()) {
              await runtimeManager.stopDevServer();
            }
          }

          // Step 5: Clear runtime/project execution state
          const { useRuntimeStore } = await import("./runtimeStore");
          if (isActive) {
            await runtimeManager.cleanProject(id);
            useRuntimeStore.setState({
              previewUrl: null,
              previewPort: null,
              lastEvidence: null,
              pendingEvidencePromise: null,
              status: nextProjectId ? "booting" : "idle",
            });
          }

          // Step 6: Remove project-scoped editor/agent state
          const { useEditorStore } = await import("./editorStore");
          useEditorStore.getState().clearProject(id);
          if (typeof window !== 'undefined') {
            const { MonacoUndoAdapter } = await import('../lib/editor/monaco-undo-adapter');
            const monaco = (window as any).monaco;
            if (monaco) {
              MonacoUndoAdapter.disposeProjectModels(monaco, id);
            }
          }

          if (isActive) {
            const { useAgentStore } = await import("./agentStore");
            useAgentStore.getState().resetAgentState();
          }

          // Clean up project chat state and abort any in-flight edit requests
          const { useChatStore } = await import("./chatStore");
          useChatStore.getState().deleteProjectChat(id);

          // Clean up deployment records, in-flight deployment, and memory secrets
          const { useDeploymentStore } = await import("./deploymentStore");
          useDeploymentStore.getState().clearProjectDeployments(id);

          // Clean up project-scoped environment variables & secrets
          const { useEnvVarStore } = await import("./envVarStore");
          useEnvVarStore.getState().clearProjectEnvVars(id);

          // Clean up project-scoped database metadata, schemas, and migrations
          const { useDatabaseStore } = await import("./databaseStore");
          useDatabaseStore.getState().clearProjectDatabase(id);

          // Clean up project-scoped authentication metadata & active sessions
          const { useAuthStore } = await import("./authStore");
          useAuthStore.getState().clearProjectAuth(id);

          // Clean up project-scoped repair loop episodes & fingerprint history
          const { useRepairStore } = await import("./repairStore");
          useRepairStore.getState().deleteProjectRepairState(id);

          // Clean up project-scoped visual editing selection and inspect state
          const { useVisualEditStore } = await import("./visualEditStore");
          useVisualEditStore.getState().clearProjectVisualState(id);

          // Clean up project-scoped screenshot-to-app state
          const { useScreenshotAppStore } = await import("./screenshotAppStore");
          useScreenshotAppStore.getState().clearProjectScreenshotState(id);

          // Clean up project-scoped design system state
          const { useDesignSystemStore } = await import("./designSystemStore");
          useDesignSystemStore.getState().clearProjectDesignSystem(id);

          // Step 7: Delete VFS files and snapshots from memory + IndexedDB
          await vfsManager.deleteProject(id);

          // Step 8: Remove project metadata and persist deletedProjectIds
          // Step 9: Transition to next project or valid empty state
          set((state) => {
            const newProjects = { ...state.projects };
            delete newProjects[id];
            const prevDeleted = state.deletedProjectIds || [];
            return {
              projects: newProjects,
              deletedProjectIds: prevDeleted.includes(id) ? prevDeleted : [...prevDeleted, id],
              activeProjectId: isActive ? nextProjectId : state.activeProjectId,
            };
          });

          // Step 10: Rehydrate/initialize the next project only after deletion cleanup succeeds
          if (isActive && nextProjectId) {
            get().syncProjectFilesFromVFS(nextProjectId);
            useRuntimeStore.getState().initializeProject(nextProjectId).catch((err) => {
              console.warn('[ProjectStore] Next project initialization warning after deletion:', err);
            });
          }

          return true;
        } finally {
          inFlightDeletions.delete(id);
        }
      },

      renameProject: (id: string, newTitle: string): boolean => {
        const trimmed = (newTitle || '').trim();
        if (!trimmed) {
          throw new Error('Project name cannot be empty or whitespace only.');
        }
        if (trimmed.length > 60) {
          throw new Error('Project name cannot exceed 60 characters.');
        }
        if (/[\x00-\x1F\x7F]/.test(trimmed)) {
          throw new Error('Project name contains invalid control characters.');
        }

        const project = get().projects[id];
        if (!project) {
          throw new Error(`Project with ID '${id}' does not exist.`);
        }

        set((state) => ({
          projects: {
            ...state.projects,
            [id]: {
              ...state.projects[id],
              title: trimmed,
            },
          },
        }));

        return true;
      },

      duplicateProject: async (sourceProjectId: string, customTitle?: string): Promise<string> => {
        const currentProjects = get().projects;
        const sourceProject = currentProjects[sourceProjectId];
        if (!sourceProject) {
          throw new Error(`Source project with ID '${sourceProjectId}' does not exist.`);
        }

        if (inFlightDuplications.has(sourceProjectId)) {
          throw new Error(`Duplication of project '${sourceProjectId}' is already in progress.`);
        }
        inFlightDuplications.add(sourceProjectId);

        try {
          // Generate unique ID that doesn't collide with existing or deleted projects
          let newId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          while (get().projects[newId] || get().deletedProjectIds.includes(newId)) {
            newId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          }

          // Determine duplicate title
          let targetTitle = (customTitle || '').trim();
          if (!targetTitle) {
            targetTitle = `${sourceProject.title} Copy`;
            const existingTitles = new Set(Object.values(get().projects).map((p) => p.title));
            if (existingTitles.has(targetTitle)) {
              let counter = 2;
              while (existingTitles.has(`${sourceProject.title} Copy ${counter}`)) {
                counter++;
              }
              targetTitle = `${sourceProject.title} Copy ${counter}`;
            }
          }

          // Clone committed authoritative VFS files and snapshots independently
          await vfsManager.duplicateProject(sourceProjectId, newId, true);
          const clonedVFSFiles = vfsManager.getFiles(newId);

          // Clone editor tab layout as UI metadata with clean dirtyFiles
          const { useEditorStore } = await import('./editorStore');
          useEditorStore.getState().cloneProjectTabs(sourceProjectId, newId);

          // Clone environment variable metadata (secret values are explicitly NOT cloned)
          const { useEnvVarStore } = await import('./envVarStore');
          useEnvVarStore.getState().duplicateProjectEnvVars(sourceProjectId, newId);

          // Clone database metadata (schemas, etc. Zero secrets exist in databaseStore)
          const { useDatabaseStore } = await import('./databaseStore');
          useDatabaseStore.getState().duplicateProjectDatabase(sourceProjectId, newId);

          // Clone authentication metadata (public config only; zero secrets exist in authStore)
          const { useAuthStore } = await import('./authStore');
          useAuthStore.getState().duplicateProjectAuth(sourceProjectId, newId);

          // Construct isolated project state starting in clean 'ready' status
          const newProject: ProjectWorkspace = {
            id: newId,
            title: targetTitle,
            description: sourceProject.description,
            badge: sourceProject.badge,
            status: 'ready',
            files: { ...clonedVFSFiles },
            openTabs: [...(sourceProject.openTabs || [])],
            activeFilePath: sourceProject.activeFilePath || '',
            diagnostics: [],
            fixHistory: [],
          };

          set((state) => ({
            projects: {
              ...state.projects,
              [newId]: newProject,
            },
          }));

          // Cloned duplicate starts with clean, isolated chat history
          const { useChatStore } = await import('./chatStore');
          useChatStore.getState().clearProjectMessages(newId);

          return newId;
        } finally {
          inFlightDuplications.delete(sourceProjectId);
        }
      },

      createSnapshot: async (projectId: string, description: string): Promise<Snapshot> => {
        const project = get().projects[projectId];
        if (!project) {
          throw new Error(`Project with ID '${projectId}' does not exist.`);
        }
        const { snapshotService } = await import('../lib/snapshots/SnapshotService');
        const snapshot = await snapshotService.createSnapshot(projectId, description);
        return snapshot;
      },

      restoreSnapshot: async (projectId: string, snapshotId: string): Promise<boolean> => {
        const currentProjects = get().projects;
        const project = currentProjects[projectId];
        if (!project) {
          throw new Error(`Project with ID '${projectId}' does not exist.`);
        }

        if (inFlightRestores.has(projectId)) {
          throw new Error(`Restore operation already in progress for project '${projectId}'.`);
        }
        inFlightRestores.add(projectId);

        try {
          // Step 1: Restore files via VFS manager (handles pre-restore checkpoint + atomic storage)
          const { snapshotService } = await import('../lib/snapshots/SnapshotService');
          const { restoredFiles, preRestoreCheckpoint } = await snapshotService.restoreSnapshotById(projectId, snapshotId);

          // Step 2: Synchronize editor store (clear dirty files, prune closed tabs if file deleted, reset baselines)
          const { useEditorStore } = await import('./editorStore');
          useEditorStore.getState().clearDirty(projectId);
          useEditorStore.getState().syncTabsWithFiles(projectId, Object.keys(restoredFiles));

          const baselineMap: Record<string, string> = {};
          for (const [filePath, file] of Object.entries(restoredFiles)) {
            baselineMap[filePath] = file.content;
          }
          useEditorStore.getState().resetProjectBaselines(projectId, baselineMap);
          useEditorStore.getState().incrementModelEpoch();

          if (typeof window !== 'undefined') {
            const { MonacoUndoAdapter } = await import('../lib/editor/monaco-undo-adapter');
            const monaco = (window as any).monaco;
            if (monaco) {
              MonacoUndoAdapter.disposeProjectModels(monaco, projectId);
            }
          }

          // Step 3: Invalidate stale diagnostics & repair history
          set((state) => {
            const p = state.projects[projectId];
            if (!p) return state;
            return {
              projects: {
                ...state.projects,
                [projectId]: {
                  ...p,
                  files: { ...restoredFiles },
                  diagnostics: [],
                  fixHistory: [],
                }
              }
            };
          });

          // INT-02 & INT-06: Invalidate active agentStore diagnosis, verification state, and pending patch
          try {
            const { useAgentStore } = await import('./agentStore');
            const agentStore = useAgentStore.getState();
            agentStore.clearDiagnosis(projectId);
            agentStore.setVerificationResult(null, projectId);
            if (!agentStore.patchProjectId || agentStore.patchProjectId === projectId) {
              agentStore.setPendingPatch(null);
            }
          } catch (agentErr) {
            console.warn('[ProjectStore] Agent state invalidation warning after restore:', agentErr);
          }

          // Step 4: Synchronize WebContainer runtime if active
          const { runtimeManager } = await import('../lib/runtime/runtime-manager');
          if (runtimeManager.isBooted() && runtimeManager.getCurrentProjectId() === projectId) {
            try {
              await runtimeManager.replaceProject(restoredFiles, projectId);
            } catch (runtimeErr) {
              console.warn('[ProjectStore] Runtime synchronization warning after restore:', runtimeErr);
            }
          }

          // Step 5: Add terminal log
          const { useRuntimeStore } = await import('./runtimeStore');
          useRuntimeStore.getState().addTerminalLog(
            `\x1b[32m[Version History]\x1b[0m Successfully restored snapshot (${Object.keys(restoredFiles).length} files). Safety checkpoint "${preRestoreCheckpoint.id}" preserved.`
          );

          // If database is connected, log honest notice that remote schema was NOT rolled back
          try {
            const { useDatabaseStore } = await import('./databaseStore');
            const dbMeta = useDatabaseStore.getState().projectDatabaseMetadata[projectId];
            if (dbMeta && dbMeta.status === 'connected') {
              useRuntimeStore.getState().addTerminalLog(
                `\x1b[33m[Database Notice]\x1b[0m Version History rolled back local project files. Remote database schema was not modified.`
              );
            }
          } catch {}

          return true;
        } finally {
          inFlightRestores.delete(projectId);
        }
      },

      getProjectFiles: (projectId) => {
        return vfsManager.getFiles(projectId);
      },

      syncProjectFilesFromVFS: (projectId) => {
        const vfsFiles = vfsManager.getFiles(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                files: { ...vfsFiles }
              }
            }
          };
        });
      },

      writeFile: async (projectId, path, content, language) => {
        // vfsManager.writeFile updates memory map synchronously on invocation
        const writePromise = vfsManager.writeFile(
          projectId,
          path,
          content,
          language,
        );
        const vfsFiles = vfsManager.getFiles(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                files: { ...vfsFiles },
              },
            },
          };
        });
        const file = await writePromise;
        return file;
      },

      writeFilesBulk: async (projectId, files) => {
        await vfsManager.writeFilesBulk(projectId, files);
        const vfsFiles = vfsManager.getFiles(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                files: { ...vfsFiles },
              },
            },
          };
        });
      },

      deleteFile: async (projectId, path) => {
        await vfsManager.deleteFile(projectId, path);
        const vfsFiles = vfsManager.getFiles(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project) return state;
          const newTabs = project.openTabs.filter((t) => t !== path);
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                files: { ...vfsFiles },
                openTabs: newTabs,
                activeFilePath:
                  project.activeFilePath === path
                    ? newTabs[0] || ""
                    : project.activeFilePath,
              },
            },
          };
        });
      },

      renameFile: async (projectId, oldPath, newPath) => {
        const updated = await vfsManager.renameFile(
          projectId,
          oldPath,
          newPath,
        );
        if (!updated) return;
        const vfsFiles = vfsManager.getFiles(projectId);
        set((state) => {
          const project = state.projects[projectId];
          if (!project) return state;
          const newTabs = project.openTabs.map((t) =>
            t === oldPath ? newPath : t,
          );
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                files: { ...vfsFiles },
                openTabs: newTabs,
                activeFilePath:
                  project.activeFilePath === oldPath
                    ? newPath
                    : project.activeFilePath,
              },
            },
          };
        });
      },

      setProjectStatus: (projectId, status) => {
        set((state) => {
          const project = state.projects[projectId];
          if (!project) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                status,
              },
            },
          };
        });
      },
    }),
    {
      name: "snapdeploy-projects-v1",
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        deletedProjectIds: state.deletedProjectIds || [],
        projects: Object.fromEntries(
          Object.entries(state.projects).map(([id, p]) => [
            id,
            {
              ...p,
              files: {}, // Authoritative files are owned and persisted by VFS (IndexedDB), not localStorage
            },
          ]),
        ),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          vfsManager.waitUntilHydrated().then(() => {
            for (const projId of Object.keys(state.projects || {})) {
              state.syncProjectFilesFromVFS(projId);
            }
          }).catch(() => {});
        }
      },
    },
  ),
);

/**
 * Non-destructively seeds initial demo project files into VFS only if empty.
 * Does NOT overwrite existing user/persisted project files.
 * Skips projects that have been deleted by the user.
 */
export async function seedDemoProjectsIfEmpty(): Promise<void> {
  await vfsManager.waitUntilHydrated();
  const state = useProjectStore.getState();
  const deletedIds = state.deletedProjectIds || [];

  for (const [projId, proj] of Object.entries(INITIAL_DEMO_PROJECTS)) {
    if (deletedIds.includes(projId)) {
      continue;
    }
    // If the projects store has been loaded and does not include this demo project,
    // do not resurrect it.
    if (state.projects && Object.keys(state.projects).length > 0 && !state.projects[projId]) {
      continue;
    }

    const existing = vfsManager.getFiles(projId);
    if (Object.keys(existing).length === 0) {
      for (const [filePath, file] of Object.entries(proj.files)) {
        await vfsManager.writeFile(projId, filePath, file.content);
      }
    }
    useProjectStore.getState().syncProjectFilesFromVFS(projId);
  }

  // Ensure all projects in the store have their files synchronized from VFS
  const allProjects = useProjectStore.getState().projects || {};
  for (const projId of Object.keys(allProjects)) {
    useProjectStore.getState().syncProjectFilesFromVFS(projId);
  }
}

seedDemoProjectsIfEmpty().catch(() => {});

if (typeof window !== 'undefined') {
  (window as any).__SNAPDEPLOY_PROJECT_STORE__ = useProjectStore;
}
