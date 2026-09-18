import { vfsManager } from '../../lib/vfs/vfs-manager';
import { snapshotService } from '../../lib/snapshots/SnapshotService';
import { resetEditorBoundary } from '../../lib/editor/editor-boundary';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import {
  DetectedProjectConfig,
  ImportExecutionOptions,
  ImportValidationResult,
  ProjectWorkspace
} from '../../types/workspace';
import { validateAndExtractArchive } from './import-validator';
import { detectProjectConfiguration } from './project-detector';

export type ImportFailureInjectionStage =
  | 'fail_before_vfs_write'
  | 'fail_after_vfs_before_snapshot'
  | 'fail_after_snapshot_before_store'
  | 'fail_during_store_registration';

export class ProjectImporterService {
  private static instance: ProjectImporterService;

  private constructor() {}

  public static getInstance(): ProjectImporterService {
    if (!ProjectImporterService.instance) {
      ProjectImporterService.instance = new ProjectImporterService();
    }
    return ProjectImporterService.instance;
  }

  /**
   * Validates archive, extracts files in memory, and detects project configuration without mutating VFS or store.
   */
  public async inspectArchive(
    archiveData: Blob | File | ArrayBuffer | Uint8Array,
    archiveFileName?: string
  ): Promise<ImportValidationResult> {
    const validation = await validateAndExtractArchive(archiveData);
    if (!validation.valid) {
      return validation;
    }

    const defaultTitle = archiveFileName ? archiveFileName.replace(/\.zip$/i, '') : undefined;
    const detectedConfig = detectProjectConfiguration(validation.extractedFiles, defaultTitle);
    validation.detectedConfig = detectedConfig;

    return validation;
  }

  /**
   * Atomically commits an extracted project to VFS, creates the initial snapshot,
   * registers the project workspace, resets the editor boundary, and switches into it.
   */
  public async commitImport(
    files: Record<string, string>,
    config: DetectedProjectConfig,
    options?: ImportExecutionOptions,
    __testFailureHook?: ImportFailureInjectionStage
  ): Promise<string> {
    // Generate unique project ID that doesn't collide with existing or deleted projects
    const state = useProjectStore.getState();
    const existingIds = new Set([
      ...Object.keys(state.projects || {}),
      ...(state.deletedProjectIds || [])
    ]);

    let newProjectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    while (existingIds.has(newProjectId)) {
      newProjectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    }

    const projectTitle = (options?.customTitle || config.title || 'Imported Project').trim();
    const projectDescription = (options?.customDescription || config.description || '').trim();

    // Failure injection check 1
    if (__testFailureHook === 'fail_before_vfs_write') {
      throw new Error('[TestFailure] Simulated failure before VFS write');
    }

    let vfsCommitted = false;
    let snapshotCommitted = false;
    let storeCommitted = false;

    try {
      // Step 1: Write files to VFS (IndexedDB + memory map) atomically
      await vfsManager.writeFilesBulk(newProjectId, files);
      vfsCommitted = true;

      // Failure injection check 2
      if (__testFailureHook === 'fail_after_vfs_before_snapshot') {
        throw new Error('[TestFailure] Simulated failure after VFS write before snapshot');
      }

      // Step 2: Create authentic baseline Version History snapshot
      const snapshotTitle = options?.initialSnapshotTitle || `Initial import: ${projectTitle}`;
      await snapshotService.createSnapshot(newProjectId, snapshotTitle);
      snapshotCommitted = true;

      // Failure injection check 3
      if (__testFailureHook === 'fail_after_snapshot_before_store') {
        throw new Error('[TestFailure] Simulated failure after snapshot before store registration');
      }

      // Step 3: Register in projectStore metadata (commit point for project visibility)
      const vfsFiles = vfsManager.getFiles(newProjectId);
      const openTabs = config.primaryEntryFile ? [config.primaryEntryFile] : Object.keys(vfsFiles).slice(0, 1);
      const activeFilePath = config.primaryEntryFile || openTabs[0] || '';

      const newProject: ProjectWorkspace = {
        id: newProjectId,
        title: projectTitle,
        description: projectDescription || `Imported ${config.badge} application`,
        badge: config.badge,
        status: 'ready',
        files: { ...vfsFiles },
        openTabs,
        activeFilePath,
        diagnostics: [],
        fixHistory: []
      };

      if (__testFailureHook === 'fail_during_store_registration') {
        throw new Error('[TestFailure] Simulated failure during store registration');
      }

      useProjectStore.setState((s) => ({
        projects: {
          ...s.projects,
          [newProjectId]: newProject
        }
      }));
      storeCommitted = true;

      // Step 4: Configure Editor Baselines & Tabs
      await resetEditorBoundary(newProjectId, vfsFiles);
      if (activeFilePath) {
        useEditorStore.getState().openFile(newProjectId, activeFilePath);
      }

      // Step 5: Switch active project & trigger runtime if requested
      useProjectStore.getState().setActiveProjectId(newProjectId);
      if (!options?.skipRuntimeStart) {
        const { useRuntimeStore } = await import('../../store/runtimeStore');
        useRuntimeStore.getState().initializeProject(newProjectId).catch((err) => {
          console.warn('[ProjectImporter] Runtime initialization warning:', err);
        });
      }

      return newProjectId;
    } catch (err) {
      // ATOMIC ROLLBACK:
      // Remove metadata from projectStore if added
      if (storeCommitted) {
        useProjectStore.setState((s) => {
          const next = { ...s.projects };
          delete next[newProjectId];
          return { projects: next };
        });
      }

      // Clean up VFS files and snapshots completely from IndexedDB and memory
      if (vfsCommitted || snapshotCommitted) {
        try {
          await vfsManager.deleteProject(newProjectId);
        } catch (cleanupErr) {
          console.error('[ProjectImporter] Rollback cleanup warning:', cleanupErr);
        }
      }

      throw err;
    }
  }
}

export const projectImporter = ProjectImporterService.getInstance();
