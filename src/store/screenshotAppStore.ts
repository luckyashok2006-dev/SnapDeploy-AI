import { create } from 'zustand';
import { 
  ScreenshotImage, 
  ScreenshotAnalysis, 
  ScreenshotGenerationProposal, 
  VisualComparisonResult, 
  ScreenshotGenerationMode 
} from '../features/screenshot-app/screenshot-types';

export type ScreenshotWorkflowStage = 
  | 'upload' 
  | 'analyzing' 
  | 'proposal' 
  | 'generating' 
  | 'preview' 
  | 'comparing' 
  | 'refining';

export interface ScreenshotAppState {
  projectScreenshots: Record<string, ScreenshotImage | null>;
  projectAnalyses: Record<string, ScreenshotAnalysis | null>;
  projectProposals: Record<string, ScreenshotGenerationProposal | null>;
  projectComparisons: Record<string, VisualComparisonResult | null>;
  generationModes: Record<string, ScreenshotGenerationMode>;
  activeStages: Record<string, ScreenshotWorkflowStage>;
  isProcessing: boolean;
  error: string | null;

  getScreenshot: (projectId: string) => ScreenshotImage | null;
  getAnalysis: (projectId: string) => ScreenshotAnalysis | null;
  getProposal: (projectId: string) => ScreenshotGenerationProposal | null;
  getComparison: (projectId: string) => VisualComparisonResult | null;
  getMode: (projectId: string) => ScreenshotGenerationMode;
  getStage: (projectId: string) => ScreenshotWorkflowStage;

  setScreenshot: (projectId: string, image: ScreenshotImage | null) => void;
  clearScreenshot: (projectId: string) => void;
  setAnalysis: (projectId: string, analysis: ScreenshotAnalysis | null) => void;
  clearAnalysis: (projectId: string) => void;
  setProposal: (projectId: string, proposal: ScreenshotGenerationProposal | null) => void;
  clearProposal: (projectId: string) => void;
  setComparison: (projectId: string, comparison: VisualComparisonResult | null) => void;
  clearComparison: (projectId: string) => void;
  setMode: (projectId: string, mode: ScreenshotGenerationMode) => void;
  setStage: (projectId: string, stage: ScreenshotWorkflowStage) => void;
  setIsProcessing: (processing: boolean) => void;
  setError: (error: string | null) => void;
  clearProjectScreenshotState: (projectId: string) => void;
  clearAllScreenshotState: () => void;
}

export const useScreenshotAppStore = create<ScreenshotAppState>((set, get) => ({
  projectScreenshots: {},
  projectAnalyses: {},
  projectProposals: {},
  projectComparisons: {},
  generationModes: {},
  activeStages: {},
  isProcessing: false,
  error: null,

  getScreenshot: (projectId) => get().projectScreenshots[projectId] || null,
  getAnalysis: (projectId) => get().projectAnalyses[projectId] || null,
  getProposal: (projectId) => get().projectProposals[projectId] || null,
  getComparison: (projectId) => get().projectComparisons[projectId] || null,
  getMode: (projectId) => get().generationModes[projectId] || 'new_project',
  getStage: (projectId) => get().activeStages[projectId] || 'upload',

  setScreenshot: (projectId, image) =>
    set((state) => ({
      projectScreenshots: { ...state.projectScreenshots, [projectId]: image },
      activeStages: { ...state.activeStages, [projectId]: image ? 'upload' : 'upload' },
      error: null
    })),

  clearScreenshot: (projectId) =>
    set((state) => {
      const copy = { ...state.projectScreenshots };
      delete copy[projectId];
      return { projectScreenshots: copy };
    }),

  setAnalysis: (projectId, analysis) =>
    set((state) => ({
      projectAnalyses: { ...state.projectAnalyses, [projectId]: analysis },
      activeStages: { ...state.activeStages, [projectId]: analysis ? 'proposal' : 'upload' }
    })),

  clearAnalysis: (projectId) =>
    set((state) => {
      const copy = { ...state.projectAnalyses };
      delete copy[projectId];
      return { projectAnalyses: copy };
    }),

  setProposal: (projectId, proposal) =>
    set((state) => ({
      projectProposals: { ...state.projectProposals, [projectId]: proposal }
    })),

  clearProposal: (projectId) =>
    set((state) => {
      const copy = { ...state.projectProposals };
      delete copy[projectId];
      return { projectProposals: copy };
    }),

  setComparison: (projectId, comparison) =>
    set((state) => ({
      projectComparisons: { ...state.projectComparisons, [projectId]: comparison },
      activeStages: { ...state.activeStages, [projectId]: comparison ? 'comparing' : state.activeStages[projectId] || 'upload' }
    })),

  clearComparison: (projectId) =>
    set((state) => {
      const copy = { ...state.projectComparisons };
      delete copy[projectId];
      return { projectComparisons: copy };
    }),

  setMode: (projectId, mode) =>
    set((state) => ({
      generationModes: { ...state.generationModes, [projectId]: mode }
    })),

  setStage: (projectId, stage) =>
    set((state) => ({
      activeStages: { ...state.activeStages, [projectId]: stage }
    })),

  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setError: (error) => set({ error }),

  clearProjectScreenshotState: (projectId) =>
    set((state) => {
      const s = { ...state.projectScreenshots };
      const a = { ...state.projectAnalyses };
      const p = { ...state.projectProposals };
      const c = { ...state.projectComparisons };
      const m = { ...state.generationModes };
      const st = { ...state.activeStages };
      delete s[projectId];
      delete a[projectId];
      delete p[projectId];
      delete c[projectId];
      delete m[projectId];
      delete st[projectId];
      return {
        projectScreenshots: s,
        projectAnalyses: a,
        projectProposals: p,
        projectComparisons: c,
        generationModes: m,
        activeStages: st,
        error: null
      };
    }),

  clearAllScreenshotState: () =>
    set({
      projectScreenshots: {},
      projectAnalyses: {},
      projectProposals: {},
      projectComparisons: {},
      generationModes: {},
      activeStages: {},
      isProcessing: false,
      error: null
    })
}));
