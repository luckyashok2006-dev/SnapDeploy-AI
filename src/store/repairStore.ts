import { create } from 'zustand';
import { RepairEpisode, RepairEpisodeStatus, CanonicalRepairState, Diagnosis, Patch, ExecutionEvidence } from '../types/workspace';

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
    proposalFingerprint?: string,
    plan?: any | null
  ) => void;

  resolveEpisode: (projectId: string, episodeId: string, verificationResult?: any | null) => void;
  rejectEpisode: (projectId: string, episodeId: string) => void;
  rollbackEpisode: (projectId: string, episodeId: string, error?: string, verificationResult?: any | null) => void;
  blockEpisode: (projectId: string, episodeId: string, reason?: string) => void;

  // Explicit Failure Branch Mutations (Phase B)
  markDiagnosisFailed: (projectId: string, episodeId: string, error: string) => void;
  markRepairFailed: (projectId: string, episodeId: string, error: string) => void;
  markVerificationFailed: (projectId: string, episodeId: string, error: string) => void;

  // Loop Controls
  pauseLoop: (projectId: string) => void;
  resumeLoop: (projectId: string) => void;
  recordFingerprint: (projectId: string, fingerprint: string, codeHash?: string) => void;
  hasFingerprint: (projectId: string, fingerprint: string, codeHash?: string) => boolean;

  // Project Isolation & Lifecycle
  clearProjectEpisodes: (projectId: string) => void;
  deleteProjectRepairState: (projectId: string) => void;
}

export function getCanonicalState(ep?: Partial<RepairEpisode> | null): CanonicalRepairState {
  if (!ep || !ep.status) return 'IDLE';
  if (ep.canonicalState) return ep.canonicalState;
  switch (ep.status) {
    case 'captured':
    case 'ERROR_DETECTED':
      return 'ERROR_DETECTED';
    case 'diagnosing':
    case 'DIAGNOSING':
      return 'DIAGNOSING';
    case 'DIAGNOSIS_READY':
      return 'DIAGNOSIS_READY';
    case 'REPAIRING':
      return 'REPAIRING';
    case 'proposal_ready':
    case 'PATCH_READY':
      return 'PATCH_READY';
    case 'awaiting_approval':
    case 'AWAITING_APPROVAL':
      return 'AWAITING_APPROVAL';
    case 'applying':
    case 'APPLYING':
      return 'APPLYING';
    case 'verifying':
    case 'VERIFYING':
      return 'VERIFYING';
    case 'resolved':
    case 'REPAIRED':
      return 'REPAIRED';
    case 'rejected':
    case 'PATCH_REJECTED':
      return 'PATCH_REJECTED';
    case 'rolled_back':
    case 'ROLLED_BACK':
      return 'ROLLED_BACK';
    case 'DIAGNOSIS_FAILED':
      return 'DIAGNOSIS_FAILED';
    case 'REPAIR_FAILED':
      return 'REPAIR_FAILED';
    case 'VERIFICATION_FAILED':
      return 'VERIFICATION_FAILED';
    default:
      return 'IDLE';
  }
}

export function isEpisodeAwaitingApproval(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'proposal_ready' || ep.status === 'PATCH_READY' || ep.status === 'AWAITING_APPROVAL' || ep.canonicalState === 'PATCH_READY' || ep.canonicalState === 'AWAITING_APPROVAL';
}

export function isEpisodeDiagnosing(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'diagnosing' || ep.status === 'DIAGNOSING' || ep.status === 'REPAIRING' || ep.canonicalState === 'DIAGNOSING' || ep.canonicalState === 'REPAIRING';
}

export function isEpisodeApplying(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'applying' || ep.status === 'APPLYING' || ep.canonicalState === 'APPLYING';
}

export function isEpisodeVerifying(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'verifying' || ep.status === 'VERIFYING' || ep.canonicalState === 'VERIFYING';
}

export function isEpisodeResolved(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'resolved' || ep.status === 'REPAIRED' || ep.canonicalState === 'REPAIRED';
}

export function isEpisodeRolledBack(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'rolled_back' || ep.status === 'ROLLED_BACK' || ep.status === 'VERIFICATION_FAILED' || ep.canonicalState === 'ROLLED_BACK' || ep.canonicalState === 'VERIFICATION_FAILED';
}

export function isEpisodeRejected(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'rejected' || ep.status === 'PATCH_REJECTED' || ep.canonicalState === 'PATCH_REJECTED';
}

export function isEpisodeBlocked(ep?: RepairEpisode | null): boolean {
  if (!ep) return false;
  return ep.status === 'blocked';
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
      canonicalState: 'ERROR_DETECTED',
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
          const canonicalState = updates.canonicalState || getCanonicalState({ ...ep, status, ...updates });
          return {
            ...ep,
            ...updates,
            status,
            canonicalState,
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

  setEpisodeProposal: (projectId, episodeId, diagnosis, patch, proposalFingerprint, plan) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          return {
            ...ep,
            status: 'proposal_ready' as const,
            canonicalState: 'PATCH_READY' as const,
            diagnosis,
            patch,
            plan: plan !== undefined ? plan : (ep.plan || null),
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

  resolveEpisode: (projectId, episodeId, verificationResult) => {
    set((state) => {
      const projectEpisodes = state.episodes[projectId] || [];
      const updated = projectEpisodes.map((ep) => {
        if (ep.failureEpisodeId === episodeId) {
          return {
            ...ep,
            status: 'resolved' as const,
            canonicalState: 'REPAIRED' as const,
            resolution: 'resolved' as const,
            verificationResult: verificationResult !== undefined ? verificationResult : (ep.verificationResult || null),
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
            canonicalState: 'PATCH_REJECTED' as const,
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

  rollbackEpisode: (projectId, episodeId, error, verificationResult) => {
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
            canonicalState: isBlocked ? ('ROLLED_BACK' as const) : ('ROLLED_BACK' as const),
            resolution: isBlocked ? ('max_attempts_reached' as const) : ('rolled_back' as const),
            error: error || ep.error,
            verificationResult: verificationResult !== undefined ? verificationResult : (ep.verificationResult || null),
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
            canonicalState: 'ROLLED_BACK' as const,
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

  markDiagnosisFailed: (projectId, episodeId, error) => {
    get().updateEpisodeStatus(projectId, episodeId, 'DIAGNOSIS_FAILED', {
      error,
      canonicalState: 'DIAGNOSIS_FAILED'
    });
  },

  markRepairFailed: (projectId, episodeId, error) => {
    get().updateEpisodeStatus(projectId, episodeId, 'REPAIR_FAILED', {
      error,
      canonicalState: 'REPAIR_FAILED'
    });
  },

  markVerificationFailed: (projectId, episodeId, error) => {
    get().updateEpisodeStatus(projectId, episodeId, 'VERIFICATION_FAILED', {
      error,
      canonicalState: 'VERIFICATION_FAILED'
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
