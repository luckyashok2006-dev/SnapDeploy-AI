import { ProjectFile, Snapshot, FileType } from '../../types/workspace';
import { createProjectFile, normalizePath, computeFileHash, detectLanguage } from './project-files';

export interface WebContainerTreeEntry {
  file?: {
    contents: string;
  };
  directory?: Record<string, WebContainerTreeEntry>;
}

export type WebContainerFileSystemTree = Record<string, WebContainerTreeEntry>;

const DB_NAME = 'SnapDeployVFS_DB_v2';
const DB_VERSION = 1;
const STORE_FILES = 'project_files';
const STORE_SNAPSHOTS = 'project_snapshots';

export class ProjectScopedVFSManager {
  private static instance: ProjectScopedVFSManager;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  // In-memory project files: Map<projectId, Map<normalizedPath, ProjectFile>>
  private projectFiles: Map<string, Map<string, ProjectFile>> = new Map();
  // In-memory snapshots: Map<projectId, Snapshot[]>
  private projectSnapshots: Map<string, Snapshot[]> = new Map();
  private maxSnapshotsPerProject = 15;
  private _isHydrated = false;
  private hydrationPromise: Promise<void> | null = null;

  private constructor() {
    // Start background hydration if IndexedDB is available
    this.init().catch(() => {});
  }

  public static getInstance(): ProjectScopedVFSManager {
    const globalObj = typeof window !== 'undefined' ? (window as any) : (typeof globalThis !== 'undefined' ? (globalThis as any) : null);
    if (globalObj && globalObj.__GLOBAL_VFS_INSTANCE__) {
      return globalObj.__GLOBAL_VFS_INSTANCE__;
    }
    if (!ProjectScopedVFSManager.instance) {
      ProjectScopedVFSManager.instance = new ProjectScopedVFSManager();
    }
    if (globalObj) {
      globalObj.__GLOBAL_VFS_INSTANCE__ = ProjectScopedVFSManager.instance;
      globalObj.__SNAPDEPLOY_VFS_MANAGER__ = ProjectScopedVFSManager.instance;
    }
    return ProjectScopedVFSManager.instance;
  }

  private getIndexedDBFactory(): IDBFactory | null {
    if (typeof globalThis !== 'undefined' && globalThis.indexedDB) {
      return globalThis.indexedDB;
    }
    if (typeof window !== 'undefined' && window.indexedDB) {
      return window.indexedDB;
    }
    return null;
  }

  private initIndexedDB(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    const idbFactory = this.getIndexedDBFactory();
    if (!idbFactory) {
      return Promise.resolve(null);
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = idbFactory.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_FILES)) {
            const fileStore = db.createObjectStore(STORE_FILES, { keyPath: 'id' });
            fileStore.createIndex('projectId', 'projectId', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
            const snapshotStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
            snapshotStore.createIndex('projectId', 'projectId', { unique: false });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null); // graceful fallback to memory
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  public async init(): Promise<void> {
    if (this.hydrationPromise) {
      return this.hydrationPromise;
    }

    this.hydrationPromise = (async () => {
      const db = await this.initIndexedDB();
      if (!db) {
        this._isHydrated = true;
        return;
      }

      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction([STORE_FILES, STORE_SNAPSHOTS], 'readonly');
          const fileStore = tx.objectStore(STORE_FILES);
          const snapStore = tx.objectStore(STORE_SNAPSHOTS);

          const fileReq = fileStore.getAll();
          fileReq.onsuccess = () => {
            const files: ProjectFile[] = fileReq.result || [];
            for (const file of files) {
              if (!file || !file.projectId || !file.path) continue;
              const normPath = normalizePath(file.path);
              let projectMap = this.projectFiles.get(file.projectId);
              if (!projectMap) {
                projectMap = new Map();
                this.projectFiles.set(file.projectId, projectMap);
              }
              projectMap.set(normPath, { ...file, path: normPath });
            }
          };

          const snapReq = snapStore.getAll();
          snapReq.onsuccess = () => {
            const snapshots: Snapshot[] = snapReq.result || [];
            for (const snap of snapshots) {
              if (!snap || !snap.projectId) continue;
              let stack = this.projectSnapshots.get(snap.projectId);
              if (!stack) {
                stack = [];
                this.projectSnapshots.set(snap.projectId, stack);
              }
              stack.push(snap);
            }
            // Sort each stack descending by timestamp
            for (const stack of this.projectSnapshots.values()) {
              stack.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            }
          };

          tx.oncomplete = () => {
            this._isHydrated = true;
            resolve();
          };
          tx.onerror = () => {
            this._isHydrated = true;
            resolve();
          };
          tx.onabort = () => {
            this._isHydrated = true;
            resolve();
          };
        });
      } catch {
        this._isHydrated = true;
      }
    })();

    return this.hydrationPromise;
  }

  public async waitUntilHydrated(): Promise<void> {
    return this.init();
  }

  public isHydrated(): boolean {
    return this._isHydrated;
  }

  private getProjectMap(projectId: string): Map<string, ProjectFile> {
    let map = this.projectFiles.get(projectId);
    if (!map) {
      map = new Map();
      this.projectFiles.set(projectId, map);
    }
    return map;
  }

  // --- CRUD Operations ---

  public getFiles(projectId: string): Record<string, ProjectFile> {
    const map = this.getProjectMap(projectId);
    const result: Record<string, ProjectFile> = {};
    map.forEach((file, path) => {
      result[path] = { ...file };
    });
    return result;
  }

  public getFile(projectId: string, path: string): ProjectFile | null {
    const normPath = normalizePath(path);
    const map = this.getProjectMap(projectId);
    const file = map.get(normPath);
    return file ? { ...file } : null;
  }

  public async writeFile(
    projectId: string,
    path: string,
    content: string,
    language?: FileType
  ): Promise<ProjectFile> {
    const normPath = normalizePath(path);
    const map = this.getProjectMap(projectId);
    const existing = map.get(normPath);

    const file: ProjectFile = {
      id: `${projectId}:${normPath}`,
      projectId,
      path: normPath,
      content,
      hash: computeFileHash(content),
      updatedAt: new Date().toISOString(),
      language: language || existing?.language || createProjectFile(projectId, normPath, content).language,
      isModified: existing ? existing.content !== content : true
    };

    map.set(normPath, file);

    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_FILES, 'readwrite');
          tx.objectStore(STORE_FILES).put(file);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to save file to IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        } catch {
          resolve();
        }
      });
    }

    return { ...file };
  }

  public async writeFilesBulk(
    projectId: string,
    files: Record<string, string | { content: string; language?: FileType }>
  ): Promise<Record<string, ProjectFile>> {
    const written: Record<string, ProjectFile> = {};
    const map = this.getProjectMap(projectId);
    const fileList: ProjectFile[] = [];

    for (const [path, val] of Object.entries(files)) {
      const normPath = normalizePath(path);
      const content = typeof val === 'string' ? val : val.content;
      const language = typeof val === 'string' ? undefined : val.language;
      const existing = map.get(normPath);

      const file: ProjectFile = {
        id: `${projectId}:${normPath}`,
        projectId,
        path: normPath,
        content,
        hash: computeFileHash(content),
        updatedAt: new Date().toISOString(),
        language: language || existing?.language || createProjectFile(projectId, normPath, content).language,
        isModified: existing ? existing.content !== content : true
      };

      map.set(normPath, file);
      fileList.push(file);
      written[file.path] = { ...file };
    }

    const db = await this.initIndexedDB();
    if (db && fileList.length > 0) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_FILES, 'readwrite');
          const store = tx.objectStore(STORE_FILES);
          for (const file of fileList) {
            store.put(file);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to write bulk files to IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB bulk write aborted'));
        } catch {
          resolve();
        }
      });
    }

    return written;
  }

  public async deleteFile(projectId: string, path: string): Promise<boolean> {
    const normPath = normalizePath(path);
    const map = this.getProjectMap(projectId);
    const exists = map.delete(normPath);

    if (exists) {
      const db = await this.initIndexedDB();
      if (db) {
        await new Promise<void>((resolve, reject) => {
          try {
            const tx = db.transaction(STORE_FILES, 'readwrite');
            tx.objectStore(STORE_FILES).delete(`${projectId}:${normPath}`);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to delete file from IndexedDB'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB delete transaction aborted'));
          } catch {
            resolve();
          }
        });
      }
    }
    return exists;
  }

  public async renameFile(projectId: string, oldPath: string, newPath: string): Promise<ProjectFile | null> {
    const normOld = normalizePath(oldPath);
    const normNew = normalizePath(newPath);
    const map = this.getProjectMap(projectId);
    const existing = map.get(normOld);
    if (!existing) return null;

    map.delete(normOld);
    const file: ProjectFile = {
      id: `${projectId}:${normNew}`,
      projectId,
      path: normNew,
      content: existing.content,
      hash: existing.hash,
      updatedAt: new Date().toISOString(),
      language: existing.language,
      isModified: true
    };
    map.set(normNew, file);

    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_FILES, 'readwrite');
          const store = tx.objectStore(STORE_FILES);
          store.delete(`${projectId}:${normOld}`);
          store.put(file);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to rename file in IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB rename transaction aborted'));
        } catch {
          resolve();
        }
      });
    }

    return { ...file };
  }

  public async clearProjectFiles(projectId: string): Promise<void> {
    this.projectFiles.delete(projectId);
    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_FILES, 'readwrite');
          const store = tx.objectStore(STORE_FILES);
          const index = store.index('projectId');
          const req = index.getAllKeys(projectId);
          req.onsuccess = () => {
            const keys = req.result || [];
            for (const key of keys) {
              store.delete(key);
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to clear project files from IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB clear transaction aborted'));
        } catch {
          resolve();
        }
      });
    }
  }

  public async clearProjectSnapshots(projectId: string): Promise<void> {
    this.projectSnapshots.delete(projectId);
    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
          const store = tx.objectStore(STORE_SNAPSHOTS);
          const index = store.index('projectId');
          const req = index.getAllKeys(projectId);
          req.onsuccess = () => {
            const keys = req.result || [];
            for (const key of keys) {
              store.delete(key);
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to clear snapshots from IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB clear snapshots transaction aborted'));
        } catch {
          resolve();
        }
      });
    }
  }

  public async deleteProject(projectId: string): Promise<void> {
    const backupFiles = this.projectFiles.get(projectId);
    const backupSnapshots = this.projectSnapshots.get(projectId);

    this.projectFiles.delete(projectId);
    this.projectSnapshots.delete(projectId);

    const db = await this.initIndexedDB();
    if (db) {
      try {
        await new Promise<void>((resolve, reject) => {
          try {
            const tx = db.transaction([STORE_FILES, STORE_SNAPSHOTS], 'readwrite');
            const filesStore = tx.objectStore(STORE_FILES);
            const snapshotsStore = tx.objectStore(STORE_SNAPSHOTS);

            const fileIndex = filesStore.index('projectId');
            const fileReq = fileIndex.getAllKeys(projectId);
            fileReq.onsuccess = () => {
              const keys = fileReq.result || [];
              for (const key of keys) {
                filesStore.delete(key);
              }
            };

            const snapIndex = snapshotsStore.index('projectId');
            const snapReq = snapIndex.getAllKeys(projectId);
            snapReq.onsuccess = () => {
              const keys = snapReq.result || [];
              for (const key of keys) {
                snapshotsStore.delete(key);
              }
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error(`Failed to delete project '${projectId}' from IndexedDB`));
            tx.onabort = () => reject(tx.error || new Error(`IndexedDB transaction aborted for project '${projectId}'`));
          } catch (err) {
            reject(err);
          }
        });
      } catch (err) {
        if (backupFiles) this.projectFiles.set(projectId, backupFiles);
        if (backupSnapshots) this.projectSnapshots.set(projectId, backupSnapshots);
        throw err;
      }
    }
  }

  public async duplicateProject(
    sourceProjectId: string,
    newProjectId: string,
    copySnapshots = true
  ): Promise<void> {
    await this.waitUntilHydrated();

    const sourceFiles = this.getFiles(sourceProjectId);
    const newFilesMap = new Map<string, ProjectFile>();

    for (const [normPath, file] of Object.entries(sourceFiles)) {
      const clonedFile: ProjectFile = {
        id: `${newProjectId}:${normPath}`,
        projectId: newProjectId,
        path: normPath,
        content: file.content,
        hash: file.hash || computeFileHash(file.content),
        updatedAt: new Date().toISOString(),
        language: file.language,
        isModified: false
      };
      newFilesMap.set(normPath, clonedFile);
    }

    this.projectFiles.set(newProjectId, newFilesMap);

    let clonedSnapshots: Snapshot[] = [];
    if (copySnapshots) {
      const sourceSnapshots = this.getSnapshots(sourceProjectId);
      clonedSnapshots = sourceSnapshots.map((snap) => {
        const clonedSnapshotFiles: Record<string, ProjectFile> = {};
        for (const [p, f] of Object.entries(snap.files)) {
          const np = normalizePath(p);
          clonedSnapshotFiles[np] = {
            id: `${newProjectId}:${np}`,
            projectId: newProjectId,
            path: np,
            content: f.content,
            hash: f.hash || computeFileHash(f.content),
            updatedAt: f.updatedAt,
            language: f.language,
            isModified: false
          };
        }
        return {
          id: `snap_${newProjectId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          projectId: newProjectId,
          timestamp: snap.timestamp,
          description: snap.description,
          files: clonedSnapshotFiles,
          hash: snap.hash
        };
      });
    }

    this.projectSnapshots.set(newProjectId, clonedSnapshots);

    // Persist new files and snapshots to IndexedDB
    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction([STORE_FILES, STORE_SNAPSHOTS], 'readwrite');
          const fileStore = tx.objectStore(STORE_FILES);
          const snapStore = tx.objectStore(STORE_SNAPSHOTS);

          for (const file of newFilesMap.values()) {
            fileStore.put(file);
          }
          for (const snap of clonedSnapshots) {
            snapStore.put(snap);
          }

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error(`Failed to persist duplicated project '${newProjectId}' to IndexedDB`));
          tx.onabort = () => reject(tx.error || new Error(`IndexedDB transaction aborted while duplicating project '${newProjectId}'`));
        } catch (err) {
          reject(err);
        }
      });
    }
  }

  // --- Snapshot Management ---

  public async createSnapshot(projectId: string, description: string): Promise<Snapshot> {
    const rawFiles = this.getFiles(projectId);
    const snapshotFiles: Record<string, ProjectFile> = {};
    for (const [path, file] of Object.entries(rawFiles)) {
      const norm = normalizePath(path);
      snapshotFiles[norm] = {
        id: file.id || `${projectId}:${norm}`,
        projectId,
        path: norm,
        content: file.content,
        hash: file.hash || computeFileHash(file.content),
        updatedAt: file.updatedAt,
        language: file.language,
        isModified: false
      };
    }

    const sortedKeys = Object.keys(snapshotFiles).sort();
    const manifest = sortedKeys.map(k => `${k}:${snapshotFiles[k].hash}`).join('|');
    const snapshotHash = `snap_fp_${computeFileHash(manifest)}`;

    const snapshot: Snapshot = {
      id: `snap_${projectId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      projectId,
      timestamp: new Date().toISOString(),
      description,
      files: snapshotFiles,
      hash: snapshotHash
    };

    let stack = this.projectSnapshots.get(projectId);
    if (!stack) {
      stack = [];
      this.projectSnapshots.set(projectId, stack);
    }
    stack.unshift(snapshot);
    let prunedSnapshot: Snapshot | undefined;
    if (stack.length > this.maxSnapshotsPerProject) {
      prunedSnapshot = stack.pop();
    }

    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
          const store = tx.objectStore(STORE_SNAPSHOTS);
          store.put(snapshot);
          if (prunedSnapshot) {
            store.delete(prunedSnapshot.id);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to save snapshot to IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB snapshot transaction aborted'));
        } catch {
          resolve();
        }
      });
    }

    return snapshot;
  }

  public async rollbackSnapshot(projectId: string): Promise<Record<string, ProjectFile> | null> {
    const stack = this.projectSnapshots.get(projectId);
    if (!stack || stack.length === 0) return null;

    const snapshot = stack.shift();
    if (!snapshot) return null;

    // Restore files in memory
    const restoredMap = new Map<string, ProjectFile>();
    const restoredRecord: Record<string, ProjectFile> = {};
    for (const [path, file] of Object.entries(snapshot.files)) {
      const norm = normalizePath(path);
      const clonedFile: ProjectFile = {
        id: file.id || `${projectId}:${norm}`,
        projectId,
        path: norm,
        content: file.content,
        hash: file.hash || computeFileHash(file.content),
        updatedAt: new Date().toISOString(),
        language: file.language,
        isModified: false
      };
      restoredMap.set(norm, clonedFile);
      restoredRecord[norm] = { ...clonedFile };
    }
    this.projectFiles.set(projectId, restoredMap);

    // Sync zustand store if available
    try {
      const { useProjectStore } = await import('../../store/projectStore');
      useProjectStore.setState((state) => {
        const project = state.projects[projectId];
        if (!project) return state;
        return {
          projects: {
            ...state.projects,
            [projectId]: {
              ...project,
              files: { ...restoredRecord }
            }
          }
        };
      });
    } catch {
      // Store sync fallback
    }

    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction([STORE_FILES, STORE_SNAPSHOTS], 'readwrite');
          const filesStore = tx.objectStore(STORE_FILES);
          const snapshotStore = tx.objectStore(STORE_SNAPSHOTS);

          // Clear existing files for this project in DB before restoring
          const index = filesStore.index('projectId');
          const req = index.getAllKeys(projectId);
          req.onsuccess = () => {
            const keys = req.result || [];
            for (const key of keys) {
              filesStore.delete(key);
            }
            // Re-write all restored files
            for (const file of restoredMap.values()) {
              filesStore.put(file);
            }
          };

          snapshotStore.delete(snapshot.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to execute rollback transaction in IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB rollback transaction aborted'));
        } catch {
          resolve();
        }
      });
    }

    return this.getFiles(projectId);
  }

  public getSnapshots(projectId: string): Snapshot[] {
    return [...(this.projectSnapshots.get(projectId) || [])];
  }

  public getSnapshotById(projectId: string, snapshotId: string): Snapshot | undefined {
    const stack = this.projectSnapshots.get(projectId);
    if (!stack) return undefined;
    return stack.find((s) => s.id === snapshotId);
  }

  public async restoreSnapshotById(
    projectId: string,
    snapshotId: string
  ): Promise<{ restoredFiles: Record<string, ProjectFile>; preRestoreCheckpoint: Snapshot }> {
    const stack = this.projectSnapshots.get(projectId);
    if (!stack || stack.length === 0) {
      throw new Error(`No snapshots found for project '${projectId}'.`);
    }

    const targetSnapshot = stack.find((s) => s.id === snapshotId);
    if (!targetSnapshot) {
      throw new Error(`Snapshot '${snapshotId}' not found for project '${projectId}'.`);
    }

    // Step A: Deep clone target snapshot files BEFORE creating the pre-restore checkpoint.
    // This strictly guarantees that even if stack.length === maxSnapshotsPerProject (15) and
    // targetSnapshot is the oldest entry (index 14), creating the checkpoint will NOT destroy
    // or corrupt the target files!
    const filesToRestore: Record<string, ProjectFile> = {};
    for (const [path, file] of Object.entries(targetSnapshot.files)) {
      const norm = normalizePath(path);
      filesToRestore[norm] = {
        id: `${projectId}:${norm}`,
        projectId,
        path: norm,
        content: file.content,
        hash: file.hash || computeFileHash(file.content),
        updatedAt: new Date().toISOString(),
        language: file.language,
        isModified: false
      };
    }

    // Step B: Backup current working files in memory for rollback if restore fails
    const preRestoreMap = new Map(this.projectFiles.get(projectId) || new Map());

    // Step C: Create pre-restore safety checkpoint
    const checkpointDescription = `Pre-restore checkpoint: before restoring "${targetSnapshot.description || targetSnapshot.id}"`;
    const preRestoreCheckpoint = await this.createSnapshot(projectId, checkpointDescription);

    // Step D: Apply target snapshot files to VFS memory and IndexedDB
    try {
      await this.applyRestoredFiles(projectId, filesToRestore);
    } catch (restoreErr) {
      // Step E: If restore fails, rollback to preRestoreMap to guarantee atomicity
      this.projectFiles.set(projectId, preRestoreMap);
      throw new Error(`Failed to apply restored files to storage: ${restoreErr}`);
    }

    return {
      restoredFiles: this.getFiles(projectId),
      preRestoreCheckpoint
    };
  }

  private async applyRestoredFiles(
    projectId: string,
    restoredFiles: Record<string, ProjectFile>
  ): Promise<void> {
    const restoredMap = new Map<string, ProjectFile>();
    for (const [path, file] of Object.entries(restoredFiles)) {
      const norm = normalizePath(path);
      restoredMap.set(norm, { ...file, path: norm });
    }

    this.projectFiles.set(projectId, restoredMap);

    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_FILES, 'readwrite');
          const filesStore = tx.objectStore(STORE_FILES);
          const index = filesStore.index('projectId');
          const req = index.getAllKeys(projectId);

          req.onsuccess = () => {
            const keys = req.result || [];
            for (const key of keys) {
              filesStore.delete(key);
            }
            for (const file of restoredMap.values()) {
              filesStore.put(file);
            }
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed to update restored files in IndexedDB'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted during restore'));
        } catch (err) {
          reject(err);
        }
      });
    }
  }

  // --- WebContainer Conversion ---

  public convertToWebContainerTree(projectId: string): WebContainerFileSystemTree {
    const files = this.getFiles(projectId);
    const root: WebContainerFileSystemTree = {};

    for (const [rawPath, file] of Object.entries(files)) {
      const cleanPath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
      const segments = cleanPath.split('/');

      let current = root;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isFile = i === segments.length - 1;

        if (isFile) {
          current[segment] = {
            file: {
              contents: file.content
            }
          };
        } else {
          if (!current[segment]) {
            current[segment] = {
              directory: {}
            };
          }
          current = current[segment].directory!;
        }
      }
    }

    return root;
  }

  public async resetForTesting(): Promise<void> {
    this.projectFiles.clear();
    this.projectSnapshots.clear();
    this._isHydrated = false;
    this.hydrationPromise = null;
    const db = await this.initIndexedDB();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction([STORE_FILES, STORE_SNAPSHOTS], 'readwrite');
          tx.objectStore(STORE_FILES).clear();
          tx.objectStore(STORE_SNAPSHOTS).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  }
}

export const vfsManager = ProjectScopedVFSManager.getInstance();

if (typeof window !== 'undefined') {
  (window as any).__SNAPDEPLOY_VFS_MANAGER__ = vfsManager;
}
