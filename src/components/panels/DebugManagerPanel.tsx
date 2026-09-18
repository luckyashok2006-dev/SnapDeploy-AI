import React, { useState } from 'react';
import { 
  Bug, 
  Sparkles, 
  ShieldCheck, 
  Terminal as TerminalIcon, 
  AlertTriangle, 
  Pause, 
  Play, 
  RefreshCw, 
  CheckCircle2, 
  X, 
  ExternalLink,
  Wrench,
  Activity
} from 'lucide-react';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { useRepairStore } from '../../store/repairStore';
import { repairCoordinator } from '../../features/repair/repair-coordinator';

interface DebugManagerPanelProps {
  onOpenFaultModal: () => void;
}

export const DebugManagerPanel: React.FC<DebugManagerPanelProps> = ({ onOpenFaultModal }) => {
  const { lastEvidence, status: runtimeStatus, setIsBottomDrawerOpen, setActiveBottomTab } = useRuntimeStore();
  const { diagnosis, setPendingPatch, setIsDiffModalOpen, isDiagnosing } = useAgentStore();
  const { activeProjectId } = useProjectStore();
  const { isProjectLoopPaused, getActiveEpisode } = useRepairStore();

  const [isActionInProgress, setIsActionInProgress] = useState(false);

  const isPaused = activeProjectId ? isProjectLoopPaused(activeProjectId) : false;
  const activeEpisode = activeProjectId ? getActiveEpisode(activeProjectId) : null;

  const handleToggleLoop = () => {
    if (!activeProjectId) return;
    if (isPaused) {
      repairCoordinator.resumeRepairLoop(activeProjectId);
    } else {
      repairCoordinator.pauseRepairLoop(activeProjectId);
    }
  };

  const handleApproveRepair = async () => {
    if (!activeProjectId || !activeEpisode) return;
    setIsActionInProgress(true);
    try {
      await repairCoordinator.approveRepair(activeProjectId, activeEpisode.failureEpisodeId, (stage, msg) => {
        useRuntimeStore.getState().addTerminalLog(`\x1b[34m[Self-Healing]\x1b[0m ${msg}`, activeProjectId);
      });
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleRejectRepair = () => {
    if (!activeProjectId || !activeEpisode) return;
    repairCoordinator.rejectRepair(activeProjectId, activeEpisode.failureEpisodeId);
  };

  const handleCancelDiagnosis = () => {
    if (!activeProjectId) return;
    repairCoordinator.cancelDiagnosis(activeProjectId);
  };

  const handleReviewPatch = () => {
    if (activeEpisode?.patch) {
      setPendingPatch(activeEpisode.patch);
      setIsDiffModalOpen(true);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden">
      {/* Header */}
      <div className="h-11 px-3 border-b border-white/5 flex items-center justify-between bg-slate-950/60 shrink-0 gap-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-rose-600/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
            <Bug className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-100 uppercase tracking-wider font-sans">
            Debug & Diagnostics
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
        {/* Active Failure Card */}
        {lastEvidence && (lastEvidence.exitCode !== 0 || lastEvidence.timedOut) ? (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
            <div className="flex items-center gap-2 text-rose-400 font-semibold">
              <AlertTriangle className="w-4 h-4" />
              <span>Execution Failure Captured</span>
            </div>
            <p className="text-slate-300 font-mono text-[11px]">
              Command: {lastEvidence.command} {lastEvidence.args.join(' ')} (Exit: {lastEvidence.exitCode})
            </p>
            <button
              onClick={() => {
                setActiveBottomTab('diagnostics');
                setIsBottomDrawerOpen(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium transition flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Inspect in Diagnostics Console</span>
            </button>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>No Active Failures</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Runtime is healthy. Run commands in the terminal or trigger checks to capture telemetry.
            </p>
          </div>
        )}

        {/* Continuous AI Self-Healing Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-violet-400" />
              <span>Continuous AI Self-Healing</span>
            </span>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                isPaused 
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`} data-testid="repair-loop-status">
                {isPaused ? 'Paused' : 'Active'}
              </span>
              <button
                onClick={handleToggleLoop}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1 border border-white/5"
                data-testid={isPaused ? 'resume-repair-loop-btn' : 'pause-repair-loop-btn'}
                title={isPaused ? 'Resume automated repair loop' : 'Pause automated repair loop'}
              >
                {isPaused ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
            </div>
          </div>

          {activeEpisode ? (
            <div className="p-3.5 rounded-xl bg-slate-900/70 border border-violet-500/20 space-y-2.5" data-testid="repair-episode-card">
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase border ${
                  activeEpisode.status === 'diagnosing'
                    ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                    : activeEpisode.status === 'proposal_ready'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : activeEpisode.status === 'resolved'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : activeEpisode.status === 'blocked'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-slate-800 text-slate-300 border-white/10'
                }`} data-testid="repair-status-badge">
                  {activeEpisode.status.replace('_', ' ')}
                </span>
                <span className="text-[10px] font-mono text-slate-400" data-testid="repair-attempt-counter">
                  Attempt {activeEpisode.attemptNumber} of {activeEpisode.maxAttempts}
                </span>
              </div>

              {/* Status Details */}
              {activeEpisode.status === 'diagnosing' && (
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2 text-violet-400">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-[11px]">Diagnosing failure & synthesizing patch...</span>
                  </div>
                  <button
                    onClick={handleCancelDiagnosis}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 transition"
                    data-testid="cancel-repair-btn"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {activeEpisode.status === 'proposal_ready' && activeEpisode.patch && (
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] text-slate-200 font-medium">
                    {activeEpisode.patch.summary}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-white/5 gap-2">
                    <button
                      onClick={handleReviewPatch}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-[11px] text-slate-300 hover:text-white transition flex items-center gap-1"
                      data-testid="review-repair-diff-btn"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Review Diff</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleRejectRepair}
                        disabled={isActionInProgress}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 transition disabled:opacity-50"
                        data-testid="reject-repair-btn"
                      >
                        Reject
                      </button>
                      <button
                        onClick={handleApproveRepair}
                        disabled={isActionInProgress}
                        className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition flex items-center gap-1 shadow-sm disabled:opacity-50"
                        data-testid="approve-repair-btn"
                      >
                        {isActionInProgress ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                        <span>Approve & Apply</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeEpisode.status === 'blocked' && (
                <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300 space-y-1">
                  <div className="font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>Repair Blocked</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Maximum automated attempts reached ({activeEpisode.maxAttempts}/{activeEpisode.maxAttempts}). Manual intervention required.
                  </p>
                </div>
              )}

              {activeEpisode.status === 'resolved' && (
                <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Episode resolved and verified clean.</span>
                </div>
              )}

              {activeEpisode.status === 'rejected' && (
                <div className="p-2 rounded bg-slate-800/80 border border-white/5 text-[11px] text-slate-400 flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Proposal rejected. Zero project files modified.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5 text-[11px] text-slate-400">
              Continuous self-healing is monitoring project execution. Runtime errors will automatically capture episodes and propose deterministic fixes.
            </div>
          )}
        </div>

        {/* Quick Console Actions */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Engineering Console Actions</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setActiveBottomTab('terminal');
                setIsBottomDrawerOpen(true);
              }}
              className="p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-white/5 hover:border-white/20 text-slate-300 transition text-left flex items-center gap-2"
            >
              <TerminalIcon className="w-4 h-4 text-violet-400" />
              <span>Open Terminal</span>
            </button>
            <button
              onClick={() => {
                setActiveBottomTab('verification');
                setIsBottomDrawerOpen(true);
              }}
              className="p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-white/5 hover:border-white/20 text-slate-300 transition text-left flex items-center gap-2"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Run Checks</span>
            </button>
          </div>
        </div>

        {/* Advanced Developer Tools */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Advanced Developer Tools</span>
          <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5 space-y-2">
            <div>
              <h4 className="font-semibold text-slate-200">Controlled Fault Injector</h4>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Inject deterministic syntax, type, or module errors to test SnapDeploy's self-healing repair loop.
              </p>
            </div>
            <button
              onClick={onOpenFaultModal}
              data-testid="inject-fault-btn"
              className="w-full py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 font-medium transition flex items-center justify-center gap-1.5"
            >
              <Bug className="w-3.5 h-3.5 text-rose-400" />
              <span>Inject Fault</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
