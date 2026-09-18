import { create } from 'zustand';
import { Diagnosis, Patch, VerificationResult, AIEvent } from '../types/workspace';
import { useProjectStore } from './projectStore';

export interface AgentStoreState {
  generationState: 'idle' | 'planning' | 'generating' | 'mounting' | 'installing' | 'starting' | 'ready' | 'error';
  currentPrompt: string;
  generationEvents: AIEvent[];
  
  // Project-Scoped Console State (Canonical source of truth)
  diagnosisByProject: Record<string, Diagnosis | null>;
  pendingPatchByProject: Record<string, Patch | null>;
  verificationByProject: Record<string, VerificationResult | null>;

  // Derived / legacy views
  diagnosis: Diagnosis | null;
  pendingPatch: Patch | null;
  patchProjectId: string | null;
  verificationResult: VerificationResult | null;
  repairAttempts: number;
  maxRepairAttempts: number;
  isDiagnosing: boolean;
  isRepairing: boolean;
  isDiffModalOpen: boolean;
  lastErrorExplanation: string | null;

  // Selectors
  getDiagnosis: (projectId?: string | null) => Diagnosis | null;
  getPendingPatch: (projectId?: string | null) => Patch | null;
  getVerificationResult: (projectId?: string | null) => VerificationResult | null;

  // Actions
  setGenerationState: (state: AgentStoreState['generationState']) => void;
  setCurrentPrompt: (prompt: string) => void;
  addGenerationEvent: (event: AIEvent) => void;
  clearGenerationEvents: () => void;
  setDiagnosis: (diagnosis: Diagnosis | null, projectId?: string | null) => void;
  clearDiagnosis: (projectId?: string | null) => void;
  setPendingPatch: (patch: Patch | null, projectId?: string | null, openModal?: boolean) => void;
  syncActiveProject: (projectId: string) => void;
  setVerificationResult: (result: VerificationResult | null, projectId?: string | null) => void;
  incrementRepairAttempts: () => void;
  resetRepairAttempts: () => void;
  setIsDiagnosing: (isDiagnosing: boolean) => void;
  setIsRepairing: (isRepairing: boolean) => void;
  setIsDiffModalOpen: (isOpen: boolean) => void;
  resetAgentState: () => void;
}

const getActiveId = () => useProjectStore?.getState?.()?.activeProjectId || 'default';

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  generationState: 'idle',
  currentPrompt: '',
  generationEvents: [],

  diagnosisByProject: {},
  pendingPatchByProject: {},
  verificationByProject: {},

  diagnosis: null,
  pendingPatch: null,
  patchProjectId: null,
  verificationResult: null,
  repairAttempts: 0,
  maxRepairAttempts: 3,
  isDiagnosing: false,
  isRepairing: false,
  isDiffModalOpen: false,
  lastErrorExplanation: null,

  getDiagnosis: (projectId?: string | null) => {
    const targetId = projectId || getActiveId();
    return get().diagnosisByProject[targetId] ?? null;
  },

  getPendingPatch: (projectId?: string | null) => {
    const targetId = projectId || getActiveId();
    return get().pendingPatchByProject[targetId] ?? null;
  },

  getVerificationResult: (projectId?: string | null) => {
    const targetId = projectId || getActiveId();
    return get().verificationByProject[targetId] ?? null;
  },

  setGenerationState: (generationState) => set({ generationState }),
  setCurrentPrompt: (currentPrompt) => set({ currentPrompt }),
  addGenerationEvent: (event) => set((s) => ({ generationEvents: [...s.generationEvents, event] })),
  clearGenerationEvents: () => set({ generationEvents: [] }),

  setDiagnosis: (diagnosis, projectId?: string | null) => {
    const targetId = projectId || getActiveId();
    set((state) => {
      const updatedByProject = {
        ...state.diagnosisByProject,
        [targetId]: diagnosis
      };
      const activeId = getActiveId();
      return {
        diagnosisByProject: updatedByProject,
        diagnosis: updatedByProject[activeId] ?? null
      };
    });
  },

  clearDiagnosis: (projectId?: string | null) => {
    const targetId = projectId || getActiveId();
    set((state) => {
      const updatedDiagnosisByProject = {
        ...state.diagnosisByProject,
        [targetId]: null
      };
      const updatedPatchByProject = {
        ...state.pendingPatchByProject,
        [targetId]: null
      };
      const activeId = getActiveId();
      return {
        diagnosisByProject: updatedDiagnosisByProject,
        diagnosis: updatedDiagnosisByProject[activeId] ?? null,
        pendingPatchByProject: updatedPatchByProject,
        pendingPatch: activeId === targetId ? null : (updatedPatchByProject[activeId] ?? null),
        patchProjectId: activeId === targetId ? null : (updatedPatchByProject[activeId] ? activeId : null),
        lastErrorExplanation: activeId === targetId ? null : state.lastErrorExplanation
      };
    });
  },

  setPendingPatch: (pendingPatch, projectId?: string | null, openModal?: boolean) => {
    const targetProjectId = projectId || getActiveId();
    set((state) => {
      const activeId = getActiveId();
      const updatedByProject = {
        ...state.pendingPatchByProject
      };

      if (!pendingPatch) {
        if (targetProjectId) {
          updatedByProject[targetProjectId] = null;
        }
        const activePatch = updatedByProject[activeId] ?? null;
        return {
          pendingPatchByProject: updatedByProject,
          pendingPatch: activePatch,
          patchProjectId: activePatch ? activeId : null,
          isDiffModalOpen: false
        };
      }

      updatedByProject[targetProjectId] = pendingPatch;
      const activePatch = updatedByProject[activeId] ?? null;
      const isTargetActive = targetProjectId === activeId;
      const shouldOpenModal = isTargetActive && (openModal !== undefined ? openModal : true);

      return {
        pendingPatchByProject: updatedByProject,
        pendingPatch: activePatch,
        patchProjectId: activePatch ? activeId : null,
        isDiffModalOpen: shouldOpenModal
      };
    });
  },

  syncActiveProject: (projectId: string) => {
    set((state) => {
      const projPatch = state.pendingPatchByProject[projectId] ?? null;
      const projDiag = state.diagnosisByProject[projectId] ?? null;
      const projVerif = state.verificationByProject[projectId] ?? null;
      return {
        pendingPatch: projPatch,
        patchProjectId: projPatch ? projectId : null,
        diagnosis: projDiag,
        verificationResult: projVerif,
        isDiffModalOpen: false
      };
    });
  },

  setVerificationResult: (verificationResult, projectId?: string | null) => {
    const targetId = projectId || getActiveId();
    set((state) => {
      const updatedByProject = {
        ...state.verificationByProject,
        [targetId]: verificationResult
      };
      const activeId = getActiveId();
      return {
        verificationByProject: updatedByProject,
        verificationResult: updatedByProject[activeId] ?? null
      };
    });
  },

  incrementRepairAttempts: () => set((s) => ({ repairAttempts: s.repairAttempts + 1 })),
  resetRepairAttempts: () => set({ repairAttempts: 0 }),
  setIsDiagnosing: (isDiagnosing) => set({ isDiagnosing }),
  setIsRepairing: (isRepairing) => set({ isRepairing }),
  setIsDiffModalOpen: (isDiffModalOpen) => set({ isDiffModalOpen }),
  resetAgentState: () =>
    set({
      diagnosisByProject: {},
      pendingPatchByProject: {},
      verificationByProject: {},
      diagnosis: null,
      pendingPatch: null,
      patchProjectId: null,
      verificationResult: null,
      repairAttempts: 0,
      isDiagnosing: false,
      isRepairing: false,
      isDiffModalOpen: false,
      lastErrorExplanation: null
    })
}));

if (typeof window !== 'undefined') {
  (window as any).useAgentStore = useAgentStore;
}
