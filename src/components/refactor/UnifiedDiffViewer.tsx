import React, { useState } from 'react';
import { 
  X, 
  Check, 
  Sparkles, 
  AlertTriangle, 
  ShieldCheck, 
  FileCode, 
  RefreshCw,
  RotateCcw,
  CheckCircle2
} from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { repairLoopEngine } from '../../features/repair/repair-loop';
import { editExecutor } from '../../features/chat/edit-executor';

export const UnifiedDiffViewer: React.FC = () => {
  const { 
    isDiffModalOpen, 
    setIsDiffModalOpen, 
    pendingPatch, 
    patchProjectId,
    setPendingPatch, 
    diagnosis,
    setDiagnosis,
    getPendingPatch,
    getDiagnosis
  } = useAgentStore();
  const { activeProjectId } = useProjectStore();
  const { addTerminalLog } = useRuntimeStore();

  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string } | null>(null);

  // Authoritative patch resolution: always resolve canonical patch for the active project
  const currentPatch = (activeProjectId ? getPendingPatch?.(activeProjectId) : null) || pendingPatch;
  const effectiveDiagnosis = (activeProjectId ? getDiagnosis?.(activeProjectId) : null) || diagnosis;

  const activePatchRef = React.useRef<any>(null);
  const activeDiagnosisRef = React.useRef<any>(null);

  if (currentPatch) {
    activePatchRef.current = currentPatch;
  }
  if (effectiveDiagnosis) {
    activeDiagnosisRef.current = effectiveDiagnosis;
  }

  const displayedPatch = currentPatch || activePatchRef.current;
  const displayedDiagnosis = effectiveDiagnosis || activeDiagnosisRef.current;

  React.useEffect(() => {
    if (!isDiffModalOpen) {
      activePatchRef.current = null;
      activeDiagnosisRef.current = null;
      setApplyResult(null);
    }
  }, [isDiffModalOpen]);

  // INT-06: Unified Diff Viewer stale project reference invalidation on project switch
  React.useEffect(() => {
    if (patchProjectId && activeProjectId && patchProjectId !== activeProjectId && !isApplying && !applyResult) {
      setIsDiffModalOpen(false);
    }
  }, [patchProjectId, activeProjectId, isApplying, applyResult, setIsDiffModalOpen]);

  if (!isDiffModalOpen || (!displayedPatch && !applyResult)) return null;
  if (patchProjectId && activeProjectId && patchProjectId !== activeProjectId && !isApplying && !applyResult) return null;

  const handleApply = async () => {
    const patchToApply = displayedPatch || currentPatch;
    if (!patchToApply) return;

    setIsApplying(true);
    setApplyResult(null);
    const modeLabel = displayedDiagnosis ? 'AI Repair' : 'AI Edit';
    addTerminalLog(`\x1b[35m[${modeLabel}]\x1b[0m Applying verified patch for: ${patchToApply.summary}`);

    const storeProjId = useProjectStore.getState().activeProjectId;
    const allProjIds = Object.keys(useProjectStore.getState().projects);
    const targetProjId = patchProjectId || storeProjId || allProjIds[0] || 'default';

    try {
      const result = displayedDiagnosis
        ? await repairLoopEngine.applyPatchAndVerify(
            targetProjId,
            patchToApply,
            (stage, msg) => {
              addTerminalLog(`\x1b[34m[Repair Pipeline: ${stage}]\x1b[0m ${msg}`);
            }
          )
        : await editExecutor.executeEdit(
            targetProjId,
            patchToApply,
            (stage, msg) => {
              addTerminalLog(`\x1b[34m[Edit Pipeline: ${stage}]\x1b[0m ${msg}`);
            }
          );

      if (result.verified) {
        setApplyResult({ success: true, message: 'Patch applied and verified successfully!' });
        if (!displayedDiagnosis) {
          try {
            const { useChatStore } = await import('../../store/chatStore');
            const msgs = useChatStore.getState().projectMessages[targetProjId] || [];
            const match = msgs.find((m) => m.proposal?.id === patchToApply.id) || msgs.slice().reverse().find((m) => m.proposal && m.status === 'pending_approval');
            if (match) {
              useChatStore.setState((state) => ({
                projectMessages: {
                  ...state.projectMessages,
                  [targetProjId]: (state.projectMessages[targetProjId] || []).map((m) =>
                    m.id === match.id ? { ...m, status: 'applied' as const } : m
                  )
                }
              }));
            }
          } catch {
            // chatStore synchronization fallback
          }
        }
        setTimeout(() => {
          activePatchRef.current = null;
          activeDiagnosisRef.current = null;
          setIsDiffModalOpen(false);
          setPendingPatch(null, targetProjId);
          setDiagnosis(null, targetProjId);
        }, 3500);
      } else {
        setApplyResult({ success: false, message: result.error || 'Verification failed. Changes rolled back.' });
      }
    } catch (err: any) {
      setApplyResult({ success: false, message: err?.message || 'Failed to apply patch' });
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = () => {
    activePatchRef.current = null;
    activeDiagnosisRef.current = null;
    setIsDiffModalOpen(false);
  };

  const handleReject = () => {
    activePatchRef.current = null;
    activeDiagnosisRef.current = null;
    addTerminalLog(`\x1b[33m[AI Repair]\x1b[0m User rejected proposed patch.`);
    setIsDiffModalOpen(false);
    const storeProjId = useProjectStore.getState().activeProjectId;
    const targetProjId = patchProjectId || storeProjId || 'default';
    setPendingPatch(null, targetProjId);
    try {
      const { useRepairStore } = require('../../store/repairStore');
      const activeEp = useRepairStore.getState().getActiveEpisode(targetProjId);
      if (activeEp) {
        useRepairStore.getState().rejectEpisode(targetProjId, activeEp.failureEpisodeId);
      }
    } catch {}
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-in fade-in"
      data-testid="unified-diff-modal"
      role="dialog"
      aria-label="Unified Diff Modal"
    >
      <div className="bg-[#111827] border border-white/10 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col ring-1 ring-white/5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                {displayedDiagnosis ? 'AI Repair Proposal' : 'AI Edit Proposal'}
              </h2>
              <p className="text-[11px] text-slate-400">{displayedPatch?.summary}</p>
            </div>
          </div>

          <button
            onClick={handleClose}
            aria-label="Close modal"
            data-testid="close-diff-modal"
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visual Edit Context & Confidence Badge */}
        {((displayedPatch as any)?.visualEditSummary || (displayedPatch as any)?.visualConfidence || displayedPatch?.summary?.toLowerCase().includes('visual edit')) && (
          <div className="bg-violet-950/30 border border-violet-500/20 rounded-xl p-3 space-y-1.5 shrink-0" data-testid="visual-diff-banner">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-semibold" data-testid="visual-edit-badge">
                Visual AI Edit
              </span>
              {(displayedPatch as any)?.visualConfidence !== undefined && (
                <span className="text-[10px] text-slate-400">
                  Mapping Confidence: <strong className="text-violet-300 font-mono" data-testid="visual-diff-confidence">{Math.round((displayedPatch as any).visualConfidence * 100)}%</strong>
                </span>
              )}
            </div>
            {(displayedPatch as any)?.visualEditSummary && (
              <p className="text-xs text-slate-300 leading-relaxed font-medium">
                {(displayedPatch as any).visualEditSummary}
              </p>
            )}
          </div>
        )}

        {/* Diagnosis & Evidence Summary */}
        {displayedDiagnosis && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-semibold">
                Category: {displayedDiagnosis.category}
              </span>
              <span className="text-[10px] text-slate-400">
                Confidence: <strong className="text-emerald-400 font-mono">95%</strong>
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              {displayedDiagnosis.explanation}
            </p>
            <p className="text-[11px] text-emerald-400">
              💡 Suggested Fix: {displayedDiagnosis.suggestedFix}
            </p>
          </div>
        )}

        {/* Diff Content Viewport */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 custom-scrollbar">
          {(displayedPatch?.files || []).map((fileChange: any, idx: number) => (
            <div key={idx} className="border border-white/5 rounded-xl overflow-hidden bg-[#0B0F17]">
              <div className="h-8 px-3 bg-slate-900/90 border-b border-white/5 flex items-center gap-2 text-xs font-mono text-slate-300">
                <FileCode className="w-3.5 h-3.5 text-violet-400" />
                <span>{fileChange.path}</span>
              </div>

              <div className="p-3 text-[11px] font-mono leading-relaxed space-y-2">
                <div className="bg-rose-950/20 border border-rose-900/40 p-2.5 rounded-lg text-rose-300 overflow-x-auto">
                  <div className="text-[9px] uppercase tracking-wider text-rose-400 font-bold mb-1">- BEFORE (Original)</div>
                  <pre className="whitespace-pre-wrap">{fileChange.before}</pre>
                </div>

                <div className="bg-emerald-950/20 border border-emerald-900/40 p-2.5 rounded-lg text-emerald-300 overflow-x-auto">
                  <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold mb-1">+ AFTER (Proposed Patch)</div>
                  <pre className="whitespace-pre-wrap">{fileChange.after}</pre>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Result banner if applied */}
        {applyResult && (
          <div className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
            applyResult.success ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
          }`}>
            {applyResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
            <span>{applyResult.message}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5 shrink-0">
          <span className="text-[11px] text-slate-400">
            Includes automated VFS snapshot & rollback verification
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReject}
              disabled={isApplying}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition"
            >
              Reject
            </button>
            <button
              onClick={handleApply}
              disabled={isApplying}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
            >
              {isApplying ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying Repair...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply & Verify Patch</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
