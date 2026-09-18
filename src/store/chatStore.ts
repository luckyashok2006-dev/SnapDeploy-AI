import { create } from 'zustand';
import { ChatMessage, EditProposal } from '../types/workspace';
import { chatService } from '../features/chat/chat-service';
import { editExecutor } from '../features/chat/edit-executor';
import { useProjectStore } from './projectStore';

export interface DiagnosticRecord {
  timestamp: string;
  projectId: string;
  reason: 'STALE_OPERATION_DISCARDED' | 'REQUEST_CANCELLED' | 'PROJECT_MISMATCH_BLOCKED';
  operationId?: string;
  details?: any;
}

export interface ChatStoreState {
  projectMessages: Record<string, ChatMessage[]>;
  latestOperationId: Record<string, string>;
  isGenerating: boolean;
  isApplying: boolean;
  applyingStage: string | null;
  error: string | null;
  diagnosticHistory: DiagnosticRecord[];

  // Actions
  sendMessage: (projectId: string, prompt: string, activeFilePath?: string) => Promise<void>;
  cancelRequest: (projectId: string) => void;
  approveProposal: (projectId: string, messageId: string) => Promise<{ verified: boolean; error?: string }>;
  rejectProposal: (projectId: string, messageId: string) => void;
  clearProjectMessages: (projectId: string) => void;
  deleteProjectChat: (projectId: string) => void;
  getProjectMessages: (projectId: string) => ChatMessage[];
}

const activeAbortControllers: Record<string, AbortController> = {};

export const useChatStore = create<ChatStoreState>((set, get) => ({
  projectMessages: {},
  latestOperationId: {},
  isGenerating: false,
  isApplying: false,
  applyingStage: null,
  error: null,
  diagnosticHistory: [],

  getProjectMessages: (projectId: string) => {
    return get().projectMessages[projectId] || [];
  },

  sendMessage: async (projectId: string, prompt: string, activeFilePath?: string) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    // Check project existence
    const project = useProjectStore.getState().projects[projectId];
    if (!project) {
      set({ error: `Project '${projectId}' does not exist.` });
      return;
    }

    // Cancel any previous in-flight request for this project
    if (activeAbortControllers[projectId]) {
      activeAbortControllers[projectId].abort();
      delete activeAbortControllers[projectId];
    }

    const controller = new AbortController();
    activeAbortControllers[projectId] = controller;

    // Unique per-project operationId
    const operationId = `op_${projectId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({
      latestOperationId: {
        ...state.latestOperationId,
        [projectId]: operationId
      },
      isGenerating: true,
      error: null
    }));

    const userMessageId = `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const assistantMessageId = `msg_ai_${Date.now() + 1}_${Math.random().toString(36).slice(2, 7)}`;

    const userMessage: ChatMessage = {
      id: userMessageId,
      projectId,
      operationId,
      role: 'user',
      content: trimmedPrompt,
      timestamp: new Date().toISOString()
    };

    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      projectId,
      operationId,
      role: 'assistant',
      content: 'Analyzing project and synthesizing edit proposal...',
      timestamp: new Date().toISOString(),
      status: 'idle'
    };

    set((state) => {
      const existing = state.projectMessages[projectId] || [];
      return {
        projectMessages: {
          ...state.projectMessages,
          [projectId]: [...existing, userMessage, assistantMessage]
        }
      };
    });

    try {
      const editInput = chatService.buildEditContext(projectId, trimmedPrompt, activeFilePath);
      editInput.operationId = operationId;

      const proposal = await chatService.requestEdit(editInput, controller.signal);

      // Async Race & Stale Check: Verify operation is still the latest for this project
      const currentOp = get().latestOperationId[projectId];
      if (currentOp !== operationId) {
        console.warn('[AI Edit: Diagnostic] STALE_OPERATION_DISCARDED:', {
          projectId,
          responseOperationId: operationId,
          activeOperationId: currentOp
        });
        set((state) => ({
          diagnosticHistory: [
            ...state.diagnosticHistory,
            {
              timestamp: new Date().toISOString(),
              projectId,
              reason: 'STALE_OPERATION_DISCARDED',
              operationId,
              details: { activeOperationId: currentOp }
            }
          ]
        }));
        return; // Ignore stale / out-of-order response in UI
      }

      // Check project wasn't deleted while request was in flight
      if (!useProjectStore.getState().projects[projectId]) {
        return;
      }

      // Attach proposal to the assistant message
      set((state) => {
        const messages = state.projectMessages[projectId] || [];
        const updated = messages.map((m) => {
          if (m.id === assistantMessageId) {
            return {
              ...m,
              content: proposal.explanation || 'I have generated a proposed change for your review.',
              proposal,
              status: 'pending_approval' as const
            };
          }
          return m;
        });
        return {
          projectMessages: {
            ...state.projectMessages,
            [projectId]: updated
          },
          isGenerating: false
        };
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.log('[ChatStore] Request cancelled via AbortController for project:', projectId);
        return;
      }

      // Check if stale
      if (get().latestOperationId[projectId] !== operationId) {
        return;
      }

      set((state) => {
        const messages = state.projectMessages[projectId] || [];
        const updated = messages.map((m) => {
          if (m.id === assistantMessageId) {
            return {
              ...m,
              content: `Failed to generate edit proposal: ${err?.message || 'Unknown error'}`,
              status: 'failed_rolled_back' as const,
              error: err?.message
            };
          }
          return m;
        });
        return {
          projectMessages: {
            ...state.projectMessages,
            [projectId]: updated
          },
          isGenerating: false,
          error: err?.message || 'Failed to generate proposal'
        };
      });
    } finally {
      if (activeAbortControllers[projectId] === controller) {
        delete activeAbortControllers[projectId];
      }
      set({ isGenerating: false });
    }
  },

  cancelRequest: (projectId: string) => {
    if (activeAbortControllers[projectId]) {
      activeAbortControllers[projectId].abort();
      delete activeAbortControllers[projectId];
    }

    const currentOp = get().latestOperationId[projectId];
    set((state) => {
      const messages = state.projectMessages[projectId] || [];
      const updated = messages.map((m) => {
        if (m.operationId === currentOp && m.status === 'idle') {
          return {
            ...m,
            content: 'Edit request was cancelled by user.',
            status: 'cancelled' as const
          };
        }
        return m;
      });

      return {
        projectMessages: {
          ...state.projectMessages,
          [projectId]: updated
        },
        isGenerating: false,
        diagnosticHistory: [
          ...state.diagnosticHistory,
          {
            timestamp: new Date().toISOString(),
            projectId,
            reason: 'REQUEST_CANCELLED',
            operationId: currentOp
          }
        ]
      };
    });
  },

  approveProposal: async (projectId: string, messageId: string) => {
    const activeProject = useProjectStore.getState().activeProjectId;
    if (activeProject !== projectId) {
      const errorMsg = `Cannot approve proposal: active project '${activeProject}' does not match proposal project '${projectId}'.`;
      console.warn('[ChatStore]', errorMsg);
      set((state) => ({
        diagnosticHistory: [
          ...state.diagnosticHistory,
          {
            timestamp: new Date().toISOString(),
            projectId,
            reason: 'PROJECT_MISMATCH_BLOCKED',
            details: { activeProject }
          }
        ]
      }));
      return { verified: false, error: errorMsg };
    }

    const messages = get().projectMessages[projectId] || [];
    const targetMessage = messages.find((m) => m.id === messageId);
    if (!targetMessage || !targetMessage.proposal) {
      return { verified: false, error: 'Proposal message not found.' };
    }

    // Verify operation is not superseded
    if (targetMessage.operationId && targetMessage.operationId !== get().latestOperationId[projectId]) {
      return { verified: false, error: 'Cannot approve stale proposal: a newer request has been made.' };
    }

    set({ isApplying: true, applyingStage: 'Initializing edit execution...', error: null });

    try {
      const result = await editExecutor.executeEdit(
        projectId,
        targetMessage.proposal,
        (stage, msg) => {
          set({ applyingStage: msg });
        }
      );

      set((state) => {
        const msgs = state.projectMessages[projectId] || [];
        const updated = msgs.map((m) => {
          if (m.id === messageId) {
            return {
              ...m,
              status: (result.verified ? 'applied' : 'failed_rolled_back') as any,
              error: result.error
            };
          }
          return m;
        });

        return {
          projectMessages: {
            ...state.projectMessages,
            [projectId]: updated
          },
          isApplying: false,
          applyingStage: null
        };
      });

      return result;
    } catch (err: any) {
      set((state) => {
        const msgs = state.projectMessages[projectId] || [];
        const updated = msgs.map((m) => {
          if (m.id === messageId) {
            return {
              ...m,
              status: 'failed_rolled_back' as const,
              error: err?.message
            };
          }
          return m;
        });

        return {
          projectMessages: {
            ...state.projectMessages,
            [projectId]: updated
          },
          isApplying: false,
          applyingStage: null,
          error: err?.message
        };
      });
      return { verified: false, error: err?.message || 'Execution error' };
    }
  },

  rejectProposal: (projectId: string, messageId: string) => {
    set((state) => {
      const messages = state.projectMessages[projectId] || [];
      const updated = messages.map((m) => {
        if (m.id === messageId) {
          return {
            ...m,
            status: 'rejected' as const
          };
        }
        return m;
      });

      return {
        projectMessages: {
          ...state.projectMessages,
          [projectId]: updated
        }
      };
    });
  },

  clearProjectMessages: (projectId: string) => {
    set((state) => ({
      projectMessages: {
        ...state.projectMessages,
        [projectId]: []
      }
    }));
  },

  deleteProjectChat: (projectId: string) => {
    if (activeAbortControllers[projectId]) {
      activeAbortControllers[projectId].abort();
      delete activeAbortControllers[projectId];
    }

    set((state) => {
      const { [projectId]: _p, ...restMessages } = state.projectMessages;
      const { [projectId]: _op, ...restOps } = state.latestOperationId;
      return {
        projectMessages: restMessages,
        latestOperationId: restOps
      };
    });
  }
}));
