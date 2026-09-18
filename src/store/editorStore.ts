import { create } from 'zustand';

export interface EditorStoreState {
  openTabs: Record<string, string[]>; // projectId -> array of file paths
  activeFilePath: Record<string, string>; // projectId -> active file path
  dirtyFiles: Record<string, boolean>; // `${projectId}:${path}` -> isDirty
  savedBaselines: Record<string, string>; // `${projectId}:${path}` -> baseline content
  modelEpoch: number;

  openFile: (projectId: string, path: string) => void;
  closeTab: (projectId: string, path: string) => void;
  setActiveFile: (projectId: string, path: string) => void;
  markDirty: (projectId: string, path: string, isDirty: boolean) => void;
  setSavedBaseline: (projectId: string, path: string, content: string) => void;
  getSavedBaseline: (projectId: string, path: string) => string | undefined;
  checkIsDirty: (projectId: string, path: string, currentContent: string) => boolean;
  resetProjectBaselines: (projectId: string, files: Record<string, string>) => void;
  incrementModelEpoch: () => void;
  clearProject: (projectId: string) => void;
  cloneProjectTabs: (sourceProjectId: string, targetProjectId: string) => void;
  hasDirtyFiles: (projectId: string) => boolean;
  getDirtyFiles: (projectId: string) => string[];
  clearDirty: (projectId: string) => void;
  syncTabsWithFiles: (projectId: string, existingFilePaths: string[]) => void;
}

export const useEditorStore = create<EditorStoreState>((set, get) => ({
  openTabs: {
    'saas-dashboard': ['/src/App.tsx', '/src/components/InvoiceList.tsx', '/package.json']
  },
  activeFilePath: {
    'saas-dashboard': '/src/App.tsx'
  },
  dirtyFiles: {},
  savedBaselines: {},
  modelEpoch: 0,

  openFile: (projectId, path) => {
    set((state) => {
      const currentTabs = state.openTabs[projectId] || [];
      const newTabs = currentTabs.includes(path) ? currentTabs : [...currentTabs, path];
      return {
        openTabs: {
          ...state.openTabs,
          [projectId]: newTabs
        },
        activeFilePath: {
          ...state.activeFilePath,
          [projectId]: path
        }
      };
    });
  },

  closeTab: (projectId, path) => {
    set((state) => {
      const currentTabs = state.openTabs[projectId] || [];
      const newTabs = currentTabs.filter((p) => p !== path);
      const currentActive = state.activeFilePath[projectId];
      let newActive = currentActive;
      if (currentActive === path) {
        newActive = newTabs[newTabs.length - 1] || '';
      } else if (!newTabs.includes(currentActive)) {
        newActive = newTabs[0] || '';
      }
      if (newTabs.length === 0) {
        newActive = '';
      }

      return {
        openTabs: {
          ...state.openTabs,
          [projectId]: newTabs
        },
        activeFilePath: {
          ...state.activeFilePath,
          [projectId]: newActive
        }
      };
    });
  },

  setActiveFile: (projectId, path) => {
    set((state) => ({
      activeFilePath: {
        ...state.activeFilePath,
        [projectId]: path
      }
    }));
  },

  markDirty: (projectId, path, isDirty) => {
    set((state) => ({
      dirtyFiles: {
        ...state.dirtyFiles,
        [`${projectId}:${path}`]: isDirty
      }
    }));
  },

  setSavedBaseline: (projectId, path, content) => {
    set((state) => ({
      savedBaselines: {
        ...state.savedBaselines,
        [`${projectId}:${path}`]: content
      }
    }));
  },

  getSavedBaseline: (projectId, path) => {
    return get().savedBaselines[`${projectId}:${path}`];
  },

  checkIsDirty: (projectId, path, currentContent) => {
    const baseline = get().savedBaselines[`${projectId}:${path}`];
    if (baseline === undefined) return false;
    return currentContent !== baseline;
  },

  resetProjectBaselines: (projectId, files) => {
    set((state) => {
      const nextBaselines = { ...state.savedBaselines };
      const prefix = `${projectId}:`;
      for (const k of Object.keys(nextBaselines)) {
        if (k.startsWith(prefix)) delete nextBaselines[k];
      }
      for (const [path, content] of Object.entries(files)) {
        nextBaselines[`${projectId}:${path}`] = content;
      }
      return { savedBaselines: nextBaselines };
    });
  },

  incrementModelEpoch: () => {
    set((state) => ({ modelEpoch: state.modelEpoch + 1 }));
  },

  clearProject: (projectId) => {
    set((state) => {
      const nextOpenTabs = { ...state.openTabs };
      delete nextOpenTabs[projectId];

      const nextActiveFilePath = { ...state.activeFilePath };
      delete nextActiveFilePath[projectId];

      const nextDirtyFiles = { ...state.dirtyFiles };
      const prefix = `${projectId}:`;
      for (const key of Object.keys(nextDirtyFiles)) {
        if (key.startsWith(prefix)) {
          delete nextDirtyFiles[key];
        }
      }

      const nextBaselines = { ...state.savedBaselines };
      for (const key of Object.keys(nextBaselines)) {
        if (key.startsWith(prefix)) {
          delete nextBaselines[key];
        }
      }

      return {
        openTabs: nextOpenTabs,
        activeFilePath: nextActiveFilePath,
        dirtyFiles: nextDirtyFiles,
        savedBaselines: nextBaselines
      };
    });
  },

  cloneProjectTabs: (sourceProjectId, targetProjectId) => {
    set((state) => {
      const nextBaselines = { ...state.savedBaselines };
      const srcPrefix = `${sourceProjectId}:`;
      const tgtPrefix = `${targetProjectId}:`;
      for (const [k, v] of Object.entries(state.savedBaselines)) {
        if (k.startsWith(srcPrefix)) {
          const path = k.slice(srcPrefix.length);
          nextBaselines[`${tgtPrefix}${path}`] = v;
        }
      }

      return {
        openTabs: {
          ...state.openTabs,
          [targetProjectId]: [...(state.openTabs[sourceProjectId] || [])]
        },
        activeFilePath: {
          ...state.activeFilePath,
          [targetProjectId]: state.activeFilePath[sourceProjectId] || ''
        },
        savedBaselines: nextBaselines
      };
    });
  },

  hasDirtyFiles: (projectId: string): boolean => {
    const prefix = `${projectId}:`;
    const dirty = get().dirtyFiles;
    return Object.entries(dirty).some(([k, v]) => k.startsWith(prefix) && v === true);
  },

  getDirtyFiles: (projectId: string): string[] => {
    const prefix = `${projectId}:`;
    const dirty = get().dirtyFiles;
    return Object.entries(dirty)
      .filter(([k, v]) => k.startsWith(prefix) && v === true)
      .map(([k]) => k.slice(prefix.length));
  },

  clearDirty: (projectId: string) => {
    set((state) => {
      const nextDirty = { ...state.dirtyFiles };
      const prefix = `${projectId}:`;
      for (const k of Object.keys(nextDirty)) {
        if (k.startsWith(prefix)) delete nextDirty[k];
      }
      return { dirtyFiles: nextDirty };
    });
  },

  syncTabsWithFiles: (projectId: string, existingFilePaths: string[]) => {
    set((state) => {
      const currentTabs = state.openTabs[projectId] || [];
      const validTabs = currentTabs.filter((tab) => existingFilePaths.includes(tab));
      let currentActive = state.activeFilePath[projectId];
      if (!existingFilePaths.includes(currentActive)) {
        currentActive = validTabs[0] || existingFilePaths[0] || '';
      }
      return {
        openTabs: {
          ...state.openTabs,
          [projectId]: validTabs
        },
        activeFilePath: {
          ...state.activeFilePath,
          [projectId]: currentActive
        }
      };
    });
  }
}));
