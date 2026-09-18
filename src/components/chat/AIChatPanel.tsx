import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Send, 
  Square, 
  FileCode, 
  Check, 
  X, 
  AlertTriangle, 
  CheckCircle2, 
  RotateCcw, 
  FilePlus, 
  FileEdit,
  Bot,
  User,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Database,
  MousePointer
} from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useProjectStore } from '../../store/projectStore';
import { useAgentStore } from '../../store/agentStore';
import { useVisualEditStore } from '../../store/visualEditStore';
import { calculateDiffBytes } from '../../features/chat/edit-validator';

export const AIChatPanel: React.FC = () => {
  const { 
    getProjectMessages, 
    sendMessage, 
    cancelRequest, 
    approveProposal, 
    rejectProposal, 
    clearProjectMessages,
    isGenerating, 
    isApplying,
    applyingStage,
    error 
  } = useChatStore();

  const { activeProjectId, projects } = useProjectStore();
  const currentProject = activeProjectId ? projects[activeProjectId] : null;
  const activeFilePath = currentProject?.activeFilePath || undefined;

  const { setPendingPatch, setIsDiffModalOpen } = useAgentStore();

  const visualSelection = useVisualEditStore((state) => activeProjectId ? state.activeSelection[activeProjectId] : null);
  const clearVisualSelection = useVisualEditStore((state) => state.clearSelection);

  const [inputPrompt, setInputPrompt] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = activeProjectId ? getProjectMessages(activeProjectId) : [];

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isGenerating, isApplying]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeProjectId || !inputPrompt.trim() || isGenerating || isApplying) return;
    const promptToSend = inputPrompt.trim();
    setInputPrompt('');

    if (visualSelection) {
      const targetFile = visualSelection.sourceMapping.filePath;
      const visualPrompt = `Visual change for <${visualSelection.tagName}>: ${promptToSend}`;
      await sendMessage(activeProjectId, visualPrompt, targetFile);
    } else {
      await sendMessage(activeProjectId, promptToSend, activeFilePath);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleOpenDiffModal = (proposal: any) => {
    setPendingPatch(proposal);
    setIsDiffModalOpen(true);
  };

  const quickPrompts = [
    'Change dashboard to a dark theme',
    'Add search and filtering to invoices',
    'Improve mobile responsive layout',
    'Update button styles with accent borders'
  ];

  return (
    <div className="h-full flex flex-col bg-[#111827]/40 text-slate-100 select-none overflow-hidden" data-testid="ai-chat-panel">
      {/* Header */}
      <div className="p-3.5 border-b border-white/5 flex items-center justify-between shrink-0 bg-[#0B0F17]/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-600/20 text-violet-400 flex items-center justify-center border border-violet-500/30">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
              <span>Code Assistant</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                Edit Mode
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 truncate max-w-[200px]" data-testid="chat-active-project-name">
              Project: <span className="text-slate-200 font-medium">{currentProject?.title || activeProjectId || 'None'}</span>
            </p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            onClick={() => activeProjectId && clearProjectMessages(activeProjectId)}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
            title="Clear Chat History"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Active Context Chip */}
      {activeFilePath && (
        <div className="px-3.5 py-1.5 bg-slate-900/60 border-b border-white/5 flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0">
          <FileCode className="w-3 h-3 text-violet-400 shrink-0" />
          <span className="truncate">Context file: <strong className="text-slate-300 font-mono">{activeFilePath}</strong></span>
        </div>
      )}

      {/* Visual Element Context Chip */}
      {visualSelection && (
        <div className="px-3.5 py-1.5 bg-violet-950/40 border-b border-violet-500/20 flex items-center justify-between gap-2 text-[11px] text-violet-300 shrink-0" data-testid="visual-selection-chip">
          <div className="flex items-center gap-1.5 min-w-0">
            <MousePointer className="w-3 h-3 text-violet-400 shrink-0" />
            <span className="truncate">
              Element: <code className="px-1 py-0.5 rounded bg-violet-500/20 text-white font-mono">&lt;{visualSelection.tagName}&gt;</code> in <strong className="text-slate-200 font-mono">{visualSelection.sourceMapping.filePath}</strong>
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200 shrink-0">
              {Math.round(visualSelection.sourceMapping.confidence * 100)}%
            </span>
          </div>
          <button
            onClick={() => activeProjectId && clearVisualSelection(activeProjectId)}
            className="p-1 hover:bg-violet-800/40 rounded text-slate-400 hover:text-white transition shrink-0"
            title="Deselect Element"
            data-testid="clear-visual-selection-btn"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Message List */}
      <div 
        className="flex-1 min-h-0 overflow-y-auto p-3.5 custom-scrollbar flex flex-col"
        data-testid="chat-messages-container"
      >
        {messages.length === 0 ? (
          <div 
            className="my-auto flex flex-col items-center text-center py-3 px-3 sm:px-4 space-y-4 max-w-sm mx-auto shrink-0 w-full"
            data-testid="chat-empty-state"
          >
            <div 
              className="w-12 h-12 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shadow-inner shrink-0"
              data-testid="chat-empty-icon"
            >
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-[280px]">
              <h3 className="text-xs font-semibold text-white" data-testid="chat-empty-heading">Modify Application with AI</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Describe desired changes to the active project. SnapDeploy AI will inspect the files, generate a proposal, and let you review the diff before applying.
              </p>
            </div>

            {/* Quick Prompts */}
            <div className="w-full space-y-1.5 pt-2">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block text-left">
                Suggested Prompts
              </span>
              {quickPrompts.map((qp, idx) => (
                <button
                  key={idx}
                  onClick={() => setInputPrompt(qp)}
                  className="w-full text-left px-2.5 py-2 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-white/5 hover:border-violet-500/30 text-xs text-slate-300 hover:text-white transition flex items-center justify-between group"
                >
                  <span className="truncate">{qp}</span>
                  <Sparkles className="w-3 h-3 text-slate-500 group-hover:text-violet-400 opacity-0 group-hover:opacity-100 transition" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col space-y-1.5 ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
                {msg.role === 'user' ? (
                  <>
                    <span>You</span>
                    <User className="w-3 h-3" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-violet-400" />
                    <span className="text-violet-400 font-semibold">SnapDeploy AI</span>
                  </>
                )}
              </div>

              <div
                className={`max-w-[92%] rounded-xl p-3 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-600/20'
                    : 'bg-slate-900/90 border border-white/10 text-slate-200'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>

                {/* Loading / Generating State */}
                {msg.role === 'assistant' && msg.status === 'idle' && isGenerating && (
                  <div className="mt-2.5 flex items-center gap-2 text-[11px] text-violet-400">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Synthesizing minimal patch...</span>
                  </div>
                )}

                {/* Cancelled State */}
                {msg.status === 'cancelled' && (
                  <div className="mt-2 text-[10px] text-amber-400 flex items-center gap-1">
                    <X className="w-3 h-3" />
                    <span>Operation cancelled.</span>
                  </div>
                )}

                {/* Proposal Card */}
                {msg.proposal && (
                  <div className="mt-3 p-3 rounded-lg bg-[#0B0F17] border border-white/10 space-y-2.5" data-testid="ai-proposal-card">
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                        <FileEdit className="w-3.5 h-3.5 text-violet-400" />
                        <span>{msg.proposal.summary}</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        {msg.proposal.estimatedDiffSize ? (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-white/10" data-testid="diff-size-estimate">
                            <span className="text-emerald-400">+{msg.proposal.estimatedDiffSize.additions}</span>
                            <span className="text-slate-500 mx-0.5">/</span>
                            <span className="text-rose-400">-{msg.proposal.estimatedDiffSize.deletions}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {calculateDiffBytes(msg.proposal.files)}B diff
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Structured Intent */}
                    {msg.proposal.intent && (
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20 uppercase font-semibold" data-testid="proposal-intent-badge">
                          Intent
                        </span>
                        <span className="truncate text-slate-300">{msg.proposal.intent}</span>
                      </div>
                    )}

                    {/* Visual Edit Metadata */}
                    {(msg.proposal.visualEditSummary || msg.proposal.visualConfidence !== undefined || msg.proposal.summary?.toLowerCase().includes('visual edit')) && (
                      <div className="p-2 rounded bg-violet-950/30 border border-violet-500/20 flex items-center justify-between gap-2 text-[10px]" data-testid="chat-visual-edit-meta">
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase font-semibold">
                          Visual AI Edit
                        </span>
                        {msg.proposal.visualConfidence !== undefined && (
                          <span className="text-slate-400">
                            Confidence: <strong className="text-violet-300 font-mono">{Math.round(msg.proposal.visualConfidence * 100)}%</strong>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Affected Files Plan */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-slate-500">
                        <span>Affected Files ({msg.proposal.files.length} {msg.proposal.files.length === 1 ? 'file' : 'files'})</span>
                      </div>
                      <div className="space-y-1">
                        {msg.proposal.files.map((f, i) => {
                          const plan = msg.proposal?.affectedFiles?.find((af) => af.path === f.path);
                          return (
                            <div key={i} className="py-1 px-2 bg-slate-900/60 rounded border border-white/5 space-y-0.5">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="text-slate-300 truncate font-medium">{f.path}</span>
                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                  {plan && (plan.linesAdded !== undefined || plan.linesRemoved !== undefined) && (
                                    <span className="text-[10px] font-mono text-slate-400">
                                      <span className="text-emerald-400">+{plan.linesAdded || 0}</span>
                                      <span className="text-slate-600 mx-0.5">/</span>
                                      <span className="text-rose-400">-{plan.linesRemoved || 0}</span>
                                    </span>
                                  )}
                                  <span className={`text-[9px] px-1 py-0.5 rounded font-bold uppercase ${
                                    f.before ? 'text-amber-400 bg-amber-500/10' : 'text-emerald-400 bg-emerald-500/10'
                                  }`}>
                                    {f.before ? 'modify' : 'create'}
                                  </span>
                                </div>
                              </div>
                              {plan?.reason && (
                                <p className="text-[10px] text-slate-400 font-sans line-clamp-1">{plan.reason}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Expected Verification Check */}
                    {msg.proposal.expectedVerification && (
                      <div className="p-2 rounded bg-slate-900/80 border border-white/5 flex items-center gap-2 text-[10px]" data-testid="expected-verification-plan">
                        <ShieldCheck className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        <div className="truncate">
                          <span className="text-slate-500 font-semibold uppercase tracking-wider mr-1">Verification:</span>
                          <span className="text-violet-300 font-mono">{msg.proposal.expectedVerification}</span>
                        </div>
                      </div>
                    )}

                    {/* Database Migration Preview (if proposal contains schema changes) */}
                    {msg.proposal.migration && (
                      <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 space-y-1.5" data-testid="db-migration-preview">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-300">
                          <span className="flex items-center gap-1.5">
                            <Database className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Database Migration</span>
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            v{msg.proposal.migration.schemaVersion || 1}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 font-medium">{msg.proposal.migration.title}</p>
                        <div className="space-y-1">
                          {msg.proposal.migration.operations.map((op: any, opIdx: number) => (
                            <div key={opIdx} className="flex items-center justify-between text-[10px] font-mono py-0.5 px-1.5 bg-slate-900/60 rounded border border-indigo-500/20">
                              <span className="text-indigo-200 truncate">
                                {op.type === 'create_table' && `create table: ${op.tableName}`}
                                {op.type === 'add_column' && `add column: ${op.tableName}.${op.column?.name} (${op.column?.type})`}
                                {op.type === 'create_index' && `create index: ${op.tableName} (${op.index?.name})`}
                              </span>
                              <span className="text-[9px] px-1 py-0.5 rounded uppercase font-bold text-indigo-400 bg-indigo-500/10 shrink-0 ml-1">
                                {op.type}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Proposal Status or Controls */}
                    {msg.status === 'pending_approval' && (
                      <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                        <button
                          onClick={() => handleOpenDiffModal(msg.proposal)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-[11px] font-medium text-slate-300 hover:text-white transition flex items-center gap-1"
                          data-testid="chat-review-diff-btn"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Review Diff</span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => activeProjectId && rejectProposal(activeProjectId, msg.id)}
                            disabled={isApplying}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
                            data-testid="reject-edit-proposal-btn"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => activeProjectId && approveProposal(activeProjectId, msg.id)}
                            disabled={isApplying}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow-md shadow-emerald-600/30 transition flex items-center gap-1.5 disabled:opacity-50"
                            data-testid="apply-edit-proposal-btn"
                          >
                            {isApplying ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Applying...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Approve & Apply</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Applied Success Outcome */}
                    {msg.status === 'applied' && (
                      <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-2 font-medium" data-testid="chat-applied-badge">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>Changes verified & applied • Checkpoint saved to Version History</span>
                      </div>
                    )}

                    {/* Rejected Outcome */}
                    {msg.status === 'rejected' && (
                      <div className="p-2 rounded-lg bg-slate-800/80 border border-white/5 text-[11px] text-slate-400 flex items-center gap-1.5" data-testid="chat-rejected-badge">
                        <X className="w-3 h-3 text-slate-500 shrink-0" />
                        <span>Proposal rejected • No project files were modified</span>
                      </div>
                    )}

                    {/* Failed / Rolled Back Outcome */}
                    {msg.status === 'failed_rolled_back' && (
                      <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 space-y-1 font-medium" data-testid="chat-rollback-badge">
                        <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Verification failed — Rollback executed</span>
                        </div>
                        <p className="text-[10px] text-slate-300 font-mono leading-tight">
                          {msg.error || 'Project was automatically restored to the pre-edit checkpoint.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {messages.length > 0 && <div ref={messagesEndRef} />}
      </div>

      {/* Applying Progress Indicator */}
      {isApplying && applyingStage && (
        <div className="px-3.5 py-2 bg-emerald-950/40 border-t border-emerald-500/30 flex items-center gap-2 text-[11px] text-emerald-300 shrink-0 animate-pulse">
          <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
          <span className="truncate">{applyingStage}</span>
        </div>
      )}

      {/* Input Footer */}
      <div className="p-3 border-t border-white/5 bg-[#0B0F17]/80 shrink-0">
        <form onSubmit={handleSend} className="space-y-2">
          <div className="relative rounded-xl border border-white/10 bg-slate-900/90 focus-within:border-violet-500/50 transition">
            <textarea
              ref={textareaRef}
              rows={3}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating || isApplying || !activeProjectId}
              placeholder={activeProjectId ? "Describe changes to make to this project (e.g. Add dark theme, add search bar)..." : "Select or create a project first"}
              className="w-full bg-transparent px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none resize-none custom-scrollbar disabled:opacity-50"
              data-testid="chat-prompt-input"
            />

            <div className="flex items-center justify-between px-2.5 pb-2">
              <span className="text-[10px] text-slate-500 font-mono">
                {inputPrompt.length}/10,000
              </span>

              <div className="flex items-center gap-1.5">
                {isGenerating ? (
                  <button
                    type="button"
                    onClick={() => activeProjectId && cancelRequest(activeProjectId)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 text-[11px] font-medium transition"
                    data-testid="chat-cancel-btn"
                  >
                    <Square className="w-3 h-3 fill-rose-400" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!inputPrompt.trim() || !activeProjectId || isApplying}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold shadow-md shadow-violet-600/30 transition disabled:opacity-40"
                    data-testid="chat-send-btn"
                  >
                    <span>Send</span>
                    <Send className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
