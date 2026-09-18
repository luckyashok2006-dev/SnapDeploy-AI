import { create } from 'zustand';
import { VisualSelection, ElementBoundingRect } from '../types/visual-editing';

export interface HoveredElementInfo {
  selector: string;
  tagName: string;
  boundingRect?: ElementBoundingRect;
}

export interface VisualEditState {
  isInspectMode: boolean;
  activeSelection: Record<string, VisualSelection | null>;
  hoveredElement: HoveredElementInfo | null;
  isSynthesizing: boolean;

  toggleInspectMode: () => void;
  setInspectMode: (active: boolean) => void;
  setSelection: (projectId: string, selection: VisualSelection | null) => void;
  getSelection: (projectId: string) => VisualSelection | null;
  clearSelection: (projectId: string) => void;
  setHoveredElement: (info: HoveredElementInfo | null) => void;
  setIsSynthesizing: (isGenerating: boolean) => void;
  clearProjectVisualState: (projectId: string) => void;
  clearAllVisualState: () => void;
}

export const useVisualEditStore = create<VisualEditState>((set, get) => ({
  isInspectMode: false,
  activeSelection: {},
  hoveredElement: null,
  isSynthesizing: false,

  toggleInspectMode: () => {
    set((state) => ({
      isInspectMode: !state.isInspectMode,
      hoveredElement: null
    }));
  },

  setInspectMode: (active: boolean) => {
    set({
      isInspectMode: active,
      hoveredElement: active ? get().hoveredElement : null
    });
  },

  setSelection: (projectId: string, selection: VisualSelection | null) => {
    set((state) => ({
      activeSelection: {
        ...state.activeSelection,
        [projectId]: selection
      },
      // Disable inspect mode once an element is selected so user can interact with card
      isInspectMode: false,
      hoveredElement: null
    }));
  },

  getSelection: (projectId: string) => {
    return get().activeSelection[projectId] || null;
  },

  clearSelection: (projectId: string) => {
    set((state) => {
      const updated = { ...state.activeSelection };
      delete updated[projectId];
      return {
        activeSelection: updated,
        hoveredElement: null
      };
    });
  },

  setHoveredElement: (info: HoveredElementInfo | null) => {
    set({ hoveredElement: info });
  },

  setIsSynthesizing: (isGenerating: boolean) => {
    set({ isSynthesizing: isGenerating });
  },

  clearProjectVisualState: (projectId: string) => {
    set((state) => {
      const updated = { ...state.activeSelection };
      delete updated[projectId];
      return {
        activeSelection: updated,
        isInspectMode: false,
        hoveredElement: null,
        isSynthesizing: false
      };
    });
  },

  clearAllVisualState: () => {
    set({
      activeSelection: {},
      isInspectMode: false,
      hoveredElement: null,
      isSynthesizing: false
    });
  }
}));
