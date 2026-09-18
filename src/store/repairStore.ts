import { create } from 'zustand';
import { RepairEpisode, RepairEpisodeStatus, Diagnosis, Patch, ExecutionEvidence } from '../types/workspace';

export interface ProcessedFailureRecord {
  fingerprint: string;
  codeHash: string;
  timestamp: number;
}

export interface RepairStoreState {
  // Project-scoped state
  episodes: Record<string, RepairEpisode[]>;
  activeEpisodeId: Record<string, string | null>;
  isLoopPaused: Record<string, boolean>;
  processedFingerprints: Record<string, (string | ProcessedFailureRecord)[]>;

  // Accessors
  getProjectEpisodes: (projectId: string) => RepairEpisode[];
  getActiveEpisode: (projectId: string) => RepairEpisode | null;
  isProjectLoopPaused: (projectId: string) => boolean;

  // Episode Lifecycle Mutations
  createEpisode: (
    projectId: string,
    evidence: ExecutionEvidence,
    failureFingerprint: string,
    evidenceFingerprint: string
  ) => RepairEpisode;

  updateEpisodeStatus: (
    projectId: string,
    episodeId: string,
    status: RepairEpisodeStatus,
    updates?: Partial<RepairEpisode>
  ) => void;

  setEpisodeProposal: (
    projectId: string,
    episodeId: string,
    diagnosis: Diagnosis,
    patch: Patch,
    proposalFingerprint?: string
  ) => void;

  resolveEpisode: (projectId: string, episodeId: string) => void;
  rejectEpisode: (projectId: string, episodeId: string) => void;
  rollbackEpisode: (projectId: string, episodeId: string, error?: string) => void;
  blockEpisode: (projectId: string, episodeId: string, reason?: string) => void;

  // Loop Controls
  pauseLoop: (projectId: string) => void;
  resumeLoop: (projectId: string) => void;
  recordFingerprint: (projectId: string, fingerprint: string, codeHash?: string) => void;
  hasFingerprint: (projectId: string, fingerprint: string, codeHash?: string) => boolean;

  // Project Isolation & Lifecycle
  clearProjectEpisodes: (projectId: string) => void;
  deleteProjectRepairState: (projectId: string) => void;
}

export const useRepairStore = create<RepairStoreState>((set, get) => ({
  episodes: {},
  activeEpisodeId: {},
  isLoopPaused: {},
  processedFingerprints: {},

  getProjectEpisodes: (projectId: string): RepairEpisode[] => {
    return get().episodes[projectId] || [];
  },

  getActiveEpisode: (projectId: string): RepairEpisode | null => {
    const activeId = get().activeEpisodeId[projectId];
    if (!activeId) return null;
    const projectEpisodes = get().episodes[projectId] || [];
    return projectEpisodes.find((ep) => ep.failureEpisodeId === activeId) || null;
  },

  isProjectLoopPaused: (projectId: string): boolean => {
    return !!get().isLoopPaused[projectId];
  },

  createEpisode: (projectId, evidence, failureFingerprint, evidenceFingerprint) => {
    const episodeId = `ep_${projectId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newEpisode: RepairEpisode = {
      failureEpisodeId: episodeId,
      projectId,
      attemptNumber: 1,
      maxAttempts: 3,
      failureFingerprint,
      evidenceFingerprint,
      status: 'captured',
      evidence,
      createdAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString()
    };

    set((state) => {
      const existing = state.episodes[projectId] || [];
      return {
        episodes: {
          ...state.episodes,
          [projectId]: [newEpisode, ...existing]
        },
        activeEpisodeId: {
          ...state.activeEpisodeId,
          [projectId]: episodeId
        }
      };
    });

    return newEpisode;
  },

  updateEpisodeStatus: (projectId, episodeId, status, updates = {}) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          return {
            ...ep,
            ...updates,
            status,
            lastAttemptAt: new Date().toISOString()
          };
        }
        return ep;
      });

      return {
        episodes: {
          ...state.episodes,
          [projectId]: updated
        }
      };
    });
  },

  setEpisodeProposal: (projectId, episodeId, diagnosis, patch, proposalFingerprint) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          return {
            ...ep,
            status: 'proposal_ready' as const,
            diagnosis,
            patch,
            proposalFingerprint,
            lastAttemptAt: new Date().toISOString()
          };
        }
        return ep;
      });

      return {
        episodes: {
          ...state.episodes,
          [projectId]: updated
        }
      };
    });
  },

  resolveEpisode: (projectId, episodeId) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          return {
            ...ep,
            status: 'resolved' as const,
            resolution: 'resolved' as const,
            lastAttemptAt: new Date().toISOString()
          };
        }
        return ep;
      });

      return {
        episodes: {
          ...state.episodes,
          [projectId]: updated
        },
        activeEpisodeId: {
          ...state.activeEpisodeId,
          [projectId]: state.activeEpisodeId[projectId] === episodeId ? null : state.activeEpisodeId[projectId]
        }
      };
    });
  },

  rejectEpisode: (projectId, episodeId) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          return {
            ...ep,
            status: 'rejected' as const,
            resolution: 'rejected' as const,
            lastAttemptAt: new Date().toISOString()
          };
        }
        return ep;
      });

      return {
        episodes: {
          ...state.episodes,
          [projectId]: updated
        },
        activeEpisodeId: {
          ...state.activeEpisodeId,
          [projectId]: state.activeEpisodeId[projectId] === episodeId ? null : state.activeEpisodeId[projectId]
        }
      };
    });
  },

  rollbackEpisode: (projectId, episodeId, error) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          const nextAttempt = ep.attemptNumber + 1;
          const isBlocked = nextAttempt > ep.maxAttempts;
          return {
            ...ep,
            attemptNumber: nextAttempt,
            status: isBlocked ? ('blocked' as const) : ('rolled_back' as const),
            resolution: isBlocked ? ('max_attempts_reached' as const) : ('rolled_back' as const),
            error: error || ep.error,
            lastAttemptAt: new Date().toISOString()
          };
        }
        return ep;
      });

      return {
        episodes: {
          ...state.episodes,
          [projectId]: updated
        }
      };
    });
  },

  blockEpisode: (projectId, episodeId, reason) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          return {
            ...ep,
            status: 'blocked' as const,
            resolution: 'max_attempts_reached' as const,
            error: reason || 'Maximum repair attempts reached.',
            lastAttemptAt: new Date().toISOString()
          };
        }
        return ep;
      });

      return {
        episodes: {
          ...state.episodes,
          [projectId]: updated
        }
      };
    });
  },

  pauseLoop: (projectId: string) => {
    set((state) => ({
      isLoopPaused: {
        ...state.isLoopPaused,
        [projectId]: true
      }
    }));
  },

  resumeLoop: (projectId: string) => {
    set((state) => ({
      isLoopPaused: {
        ...state.isLoopPaused,
        [projectId]: false
      }
    }));
  },

  recordFingerprint: (projectId: string, fingerprint: string, codeHash: string = '') => {
    set((state) => {
      const existing = state.processedFingerprints[projectId] || [];
      const alreadyExists = existing.some((item: any) => {
        if (typeof item === 'string') return item === fingerprint;
        return item.fingerprint === fingerprint && (codeHash === '' || item.codeHash === codeHash);
      });
      if (alreadyExists) return state;
      const newEntry: ProcessedFailureRecord = {
        fingerprint,
        codeHash,
        timestamp: Date.now()
      };
      return {
        processedFingerprints: {
          ...state.processedFingerprints,
          [projectId]: [...existing.slice(-50), newEntry]
        }
      };
    });
  },

  hasFingerprint: (projectId: string, fingerprint: string, codeHash?: string): boolean => {
    const list = get().processedFingerprints[projectId] || [];
    return list.some((item: any) => {
      if (typeof item === 'string') {
        return item === fingerprint;
      }
      if (codeHash !== undefined && codeHash !== '') {
        return item.fingerprint === fingerprint && item.codeHash === codeHash;
      }
      return item.fingerprint === fingerprint;
    });
  },

  clearProjectEpisodes: (projectId: string) => {
    set((state) => ({
      episodes: {
        ...state.episodes,
        [projectId]: []
      },
      activeEpisodeId: {
        ...state.activeEpisodeId,
        [projectId]: null
      },
      processedFingerprints: {
        ...state.processedFingerprints,
        [projectId]: []
      }
    }));
  },

  deleteProjectRepairState: (projectId: string) => {
    set((state) => {
      const episodes = { ...state.episodes };
      delete episodes[projectId];

      const activeEpisodeId = { ...state.activeEpisodeId };
      delete activeEpisodeId[projectId];

      const isLoopPaused = { ...state.isLoopPaused };
      delete isLoopPaused[projectId];

      const processedFingerprints = { ...state.processedFingerprints };
      delete processedFingerprints[projectId];

      return {
        episodes,
        activeEpisodeId,
        isLoopPaused,
        processedFingerprints
      };
    });
  }
}));
