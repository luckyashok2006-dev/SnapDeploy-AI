import { create } from 'zustand';
import { PreviewDevicePresetId } from '../types/preview';

export interface PreviewStoreState {
  projectDevicePreset: Record<string, PreviewDevicePresetId>;
  projectZoomScale: Record<string, number>;

  // Getters
  getDevicePreset: (projectId: string) => PreviewDevicePresetId;
  getZoomScale: (projectId: string) => number;

  // Actions
  setDevicePreset: (projectId: string, preset: PreviewDevicePresetId) => void;
  setZoomScale: (projectId: string, zoom: number) => void;
  resetZoom: (projectId: string) => void;
  resetProjectPreview: (projectId: string) => void;
  clearAllPreviewState: () => void;
}

export const usePreviewStore = create<PreviewStoreState>((set, get) => ({
  projectDevicePreset: {},
  projectZoomScale: {},

  getDevicePreset: (projectId: string) => {
    return get().projectDevicePreset[projectId] || 'desktop';
  },

  getZoomScale: (projectId: string) => {
    return get().projectZoomScale[projectId] ?? 100;
  },

  setDevicePreset: (projectId: string, preset: PreviewDevicePresetId) => {
    set((state) => ({
      projectDevicePreset: {
        ...state.projectDevicePreset,
        [projectId]: preset
      }
    }));
  },

  setZoomScale: (projectId: string, zoom: number) => {
    const clamped = Math.max(50, Math.min(150, Math.round(zoom)));
    set((state) => ({
      projectZoomScale: {
        ...state.projectZoomScale,
        [projectId]: clamped
      }
    }));
  },

  resetZoom: (projectId: string) => {
    set((state) => ({
      projectZoomScale: {
        ...state.projectZoomScale,
        [projectId]: 100
      }
    }));
  },

  resetProjectPreview: (projectId: string) => {
    set((state) => {
      const presets = { ...state.projectDevicePreset };
      const zooms = { ...state.projectZoomScale };
      delete presets[projectId];
      delete zooms[projectId];
      return {
        projectDevicePreset: presets,
        projectZoomScale: zooms
      };
    });
  },

  clearAllPreviewState: () => {
    set({
      projectDevicePreset: {},
      projectZoomScale: {}
    });
  }
}));
