import React, { useState, useEffect } from 'react';
import { 
  Terminal as TerminalIcon, 
  Sparkles, 
  ShieldCheck, 
  ChevronUp, 
  ChevronDown, 
  Maximize2, 
  Minimize2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Wrench,
  RotateCcw
} from 'lucide-react';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { useRepairStore } from '../../store/repairStore';
import { runtimeManager } from '../../lib/runtime/runtime-manager';
import { InteractiveTerminal } from '../runtime/InteractiveTerminal';
import { repairLoopEngine } from '../../features/repair/repair-loop';
import { computeFailureFingerprint } from '../../features/repair/repair-coordinator';
import { verificationService } from '../../features/verification/VerificationService';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ExecutionEvidence } from '../../types/workspace';

export const WorkspaceBottomDrawer: React.FC = () => {
  const { activeProjectId } = useProjectStore();

  const { 
    isBottomDrawerOpen, 
    toggleBottomDrawer, 
    setIsBottomDrawerOpen,
    activeBottomTab, 
    setActiveBottomTab,
    bottomDrawerHeight,
    setBottomDrawerHeight,
    pendingEvidencePromise,
    addTerminalLog,
    executeCommand
  } = useRuntimeStore();

  const lastEvidence = useRuntimeStore((s) => s.getLastEvidence(activeProjectId));
  const diagnosis = useAgentStore((s) => s.getDiagnosis(activeProjectId));
  const verificationResult = useAgentStore((s) => s.getVerificationResult(activeProjectId));

  const { 
    setDiagnosis, 
    clearDiagnosis,
    setPendingPatch, 
    setIsDiffModalOpen,
    setVerificationResult,
    isDiagnosing,
    setIsDiagnosing
  } = useAgentStore();

  const [isVerifying, setIsVerifying] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 900;
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  });

  useEffect(() => {
    const handleResize = () => {
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      setViewportHeight(vh);
    };
    window.addEventListener('resize', handleResize);
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  // INT-07: Strict 50% visual viewport ceiling: bottom drawer never exceeds 50% of visual viewport height
  const maxAllowedConsoleHeight = Math.floor(viewportHeight * 0.5);
  const effectiveDrawerHeight = Math.min(bottomDrawerHeight, maxAllowedConsoleHeight);

  // EC-01: Distinguish active failure from resolved/historical failure
  const isResolvedByVerification = verificationResult?.success === true;
  const activeDiagnosis = isResolvedByVerification ? null : diagnosis;

  // UX-01: Runtime-synchronized Terminal badge
  const runtimeStatus = useRuntimeStore((s) => s.status);
  const getTerminalBadge = (status: string): string | null => {
    switch (status) {
      case 'running': return 'Live';
      case 'ready': return 'Ready';
      case 'booting': return 'Starting';
      case 'error': return 'Error';
      case 'idle': default: return null;
    }
  };
  const terminalBadge = getTerminalBadge(runtimeStatus);

  const diagnosticsBadge = activeDiagnosis 
    ? '1 Error' 
    : (lastEvidence && (lastEvidence.exitCode !== 0 || lastEvidence.timedOut) && !isResolvedByVerification
      ? 'Failure Captured' 
      : pendingEvidencePromise 
      ? 'Checking...' 
      : null);

  const tabs: { id: 'terminal' | 'diagnostics' | 'verification'; label: string; shortLabel: string; icon: any; badge?: string | null }[] = [
    {
      id: 'terminal',
      label: 'WebContainer Terminal',
      shortLabel: 'Terminal',
      icon: TerminalIcon,
      badge: terminalBadge
    },
    {
      id: 'diagnostics',
      label: 'AI Diagnostics & Repair',
      shortLabel: 'Issues',
      icon: Sparkles,
      badge: diagnosticsBadge
    },
    {
      id: 'verification',
      label: 'Verification Pipeline',
      shortLabel: 'Checks',
      icon: ShieldCheck,
      badge: verificationResult ? (verificationResult.success ? 'Verified' : 'Failed') : null
    }
  ];

  // EC-07A: WAI-ARIA tab navigation (ArrowLeft / ArrowRight / Home / End)
  const tabIds: ('terminal' | 'diagnostics' | 'verification')[] = ['terminal', 'diagnostics', 'verification'];
  const handleTabKeyDown = (e: React.KeyboardEvent, currentId: 'terminal' | 'diagnostics' | 'verification') => {
    const currentIndex = tabIds.indexOf(currentId);
    let nextIndex = -1;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % tabIds.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = tabIds.length - 1;
    }

    if (nextIndex !== -1) {
      const nextId = tabIds[nextIndex];
      setActiveBottomTab(nextId);
      setIsBottomDrawerOpen(true);
      const nextTabEl = document.getElementById(`tab-${nextId}`);
      nextTabEl?.focus();
    }
  };

  const handleRunDiagnosis = async () => {
    console.log('[Diagnostics] handleRunDiagnosis called');
    if (isDiagnosing) return;

    const targetProjId = activeProjectId || 'default';

    setIsDiagnosing(true);
    setIsBottomDrawerOpen(true);
    setActiveBottomTab('diagnostics');

    try {
      const runtimeState = useRuntimeStore.getState();
      let targetEvidence: ExecutionEvidence | null = null;

      // 1. If an execution check is actively in-flight, await it
      if (runtimeState.pendingEvidencePromise) {
        addTerminalLog(`\x1b[34m[AI Diagnostics]\x1b[0m Awaiting in-flight execution check...`, targetProjId);
        try {
          targetEvidence = await runtimeState.pendingEvidencePromise;
        } catch (err: any) {
          console.error('[Diagnostics] Pending evidence collection failed:', err);
        }
      }

      // 2. If no in-flight promise or promise yielded nothing, check store/runtime for fresh failure evidence
      if (!targetEvidence) {
        const currentLast = useRuntimeStore.getState().getLastEvidence(targetProjId) || runtimeManager.getLastEvidence();
        if (currentLast && (currentLast.exitCode !== 0 || currentLast.timedOut)) {
          targetEvidence = currentLast;
        }
      }

      // 3. If still no failure evidence, run canonical TypeScript verification on the active project
      if (!targetEvidence) {
        const runtimeStatus = useRuntimeStore.getState().status;
        if (runtimeStatus !== 'ready') {
          addTerminalLog(`\x1b[31m[Diagnostics Error]\x1b[0m Runtime is not ready (status: '${runtimeStatus}'). Please wait for project initialization to complete before running diagnostics.`, targetProjId);
          setIsDiagnosing(false);
          return;
        }

        console.log('[Diagnostics] No failure evidence in store, running canonical tsc check...');
        addTerminalLog(`\x1b[34m[AI Diagnostics]\x1b[0m Running verification check to capture fresh execution evidence...`, targetProjId);
        try {
          const evidence = await runtimeManager.runTypeScriptCheck(
            (data) => addTerminalLog(data, targetProjId),
            targetProjId
          );
          targetEvidence = evidence;
          useRuntimeStore.getState().recordEvidence(evidence, targetProjId);
        } catch (execErr: any) {
          console.error('[Diagnostics] Failed to execute compiler check:', execErr);
          addTerminalLog(`\x1b[31m[Diagnostics Error]\x1b[0m No execution evidence available: ${execErr?.message || 'Execution failed'}`, targetProjId);
          setIsDiagnosing(false);
          return;
        }
      }

      // 4. Guard against exitCode 0 / no failure
      if (!targetEvidence || (targetEvidence.exitCode === 0 && !targetEvidence.timedOut)) {
        addTerminalLog('\x1b[33m[AI Diagnostics]\x1b[0m No execution failure or compiler errors detected to diagnose.', targetProjId);
        setIsDiagnosing(false);
        return;
      }

      addTerminalLog(`\x1b[35m[AI Diagnostics]\x1b[0m Diagnosing execution failure (Exit code: ${targetEvidence?.exitCode})...`, targetProjId);

      const { diagnosis: diag, patch } = await repairLoopEngine.runDiagnosisAndPatch(
        targetProjId,
        targetEvidence,
        (stage, msg) => {
          console.log(`[Diagnostic Engine: ${stage}]`, msg);
          addTerminalLog(`\x1b[34m[Diagnostic Engine: ${stage}]\x1b[0m ${msg}`, targetProjId);
        }
      );

      setDiagnosis(diag, targetProjId);
      // Canonical project-scoped patch storage; keep modal closed so result card is visible first with CTA
      setPendingPatch(patch, targetProjId, false);

      try {
        const repairState = useRepairStore.getState();
        let episode = repairState.getActiveEpisode(targetProjId);
        if (!episode && targetEvidence) {
          const fp = computeFailureFingerprint(targetEvidence);
          episode = repairState.createEpisode(targetProjId, targetEvidence, fp, `ev_${Date.now()}`);
        }
        if (episode) {
          repairState.setEpisodeProposal(targetProjId, episode.failureEpisodeId, diag, patch);
        }
      } catch (err) {
        console.warn('[Diagnostics] Could not synchronize repairStore episode:', err);
      }

      console.log('[Diagnostics] Diagnosis and patch set successfully:', diag, patch);
    } catch (err: any) {
      console.error('[Diagnostics Error]', err);
      addTerminalLog(`\x1b[31m[Diagnostic Error]\x1b[0m ${err?.message || 'Failed'}`, targetProjId);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleReviewPatchDiff = () => {
    const targetProjId = activeProjectId || 'default';

    // 1. Authoritative resolution: read from canonical getPendingPatch
    let patch = useAgentStore.getState().getPendingPatch(targetProjId);

    // 2. Fallback to repairStore episode patch if available
    if (!patch) {
      const activeEp = useRepairStore.getState().getActiveEpisode(targetProjId);
      if (activeEp?.patch) {
        patch = activeEp.patch;
      }
    }

    // 3. Fallback to any project episode with a patch
    if (!patch) {
      const episodes = useRepairStore.getState().getProjectEpisodes(targetProjId);
      const epWithPatch = episodes.find((e) => e.patch);
      if (epWithPatch?.patch) {
        patch = epWithPatch.patch;
      }
    }

    if (patch) {
      // Ensure canonical project-scoped binding and open modal
      setPendingPatch(patch, targetProjId, true);
      if (activeDiagnosis) {
        setDiagnosis(activeDiagnosis, targetProjId);
      }
      setIsDiffModalOpen(true);
    } else {
      console.warn('[Diagnostics] No patch proposal available to review for project:', targetProjId);
    }
  };

  const handleRunVerification = async () => {
    setIsVerifying(true);
    addTerminalLog('\x1b[35m[Verification Engine]\x1b[0m Running full verification suite...', activeProjectId);

    try {
      const result = await verificationService.runFullVerification({ projectId: activeProjectId });
      setVerificationResult(result, activeProjectId);
      if (result.success) {
        // EC-01: Explicitly clear prior diagnosis when verification succeeds
        clearDiagnosis(activeProjectId);
        addTerminalLog(`\x1b[32m[Verification Succeeded]\x1b[0m All ${result.checks.length} checks passed (${result.totalDurationMs}ms).`, activeProjectId);
      } else {
        addTerminalLog(`\x1b[31m[Verification Failed]\x1b[0m One or more checks failed.`, activeProjectId);
        setIsBottomDrawerOpen(true);
        setActiveBottomTab('verification');
      }
    } catch (err: any) {
      addTerminalLog(`\x1b[31m[Verification Error]\x1b[0m ${err?.message || 'Failed'}`, activeProjectId);
    } finally {
      setIsVerifying(false);
    }
  };

  const renderDiagnosticsContent = () => (
    <div className="h-full overflow-y-auto p-4 space-y-4 bg-[#0B0F17] custom-scrollbar text-xs">
      <div className="flex items-center justify-between pb-3 border-b border-white/5">
        <div>
          <h3 className="font-bold text-white text-sm">AI Execution Diagnosis & Repair</h3>
          <p className="text-slate-400 text-[11px]">Reasoning from real runtime output, exit codes, and compiler stack traces</p>
        </div>

        <button
          onClick={handleRunDiagnosis}
          disabled={isDiagnosing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold shadow-sm transition disabled:opacity-50"
        >
          {isDiagnosing ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Diagnosing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Diagnose Latest Evidence</span>
            </>
          )}
        </button>
      </div>

      {activeDiagnosis ? (
        <div className="bg-[#111827] border border-violet-500/30 rounded-xl p-4 space-y-3" data-testid="active-diagnosis-card">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold uppercase border border-rose-500/30">
              {activeDiagnosis.category} &bull; Severity: {activeDiagnosis.severity}
            </span>
            <span className="text-slate-400 text-[11px]">
              Target: <strong className="text-violet-300 font-mono">{activeDiagnosis.affectedFiles.join(', ')}</strong>
            </span>
          </div>

          <div className="space-y-1">
            <h4 className="font-semibold text-slate-200">Root Cause Explanation:</h4>
            <p className="text-slate-300 leading-relaxed">{activeDiagnosis.explanation}</p>
          </div>

          <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-2.5 font-mono text-[11px] text-slate-400">
            <span className="text-[10px] text-slate-500 block uppercase font-sans mb-1 font-bold">Execution Evidence:</span>
            <pre className="whitespace-pre-wrap text-rose-300">{activeDiagnosis.evidence.join('\n')}</pre>
          </div>

          <div className="flex justify-between items-center pt-2">
            <span className="text-[11px] text-emerald-400 font-medium">
              Suggested Action: {activeDiagnosis.suggestedFix}
            </span>
            <button
              onClick={handleReviewPatchDiff}
              data-testid="review-ai-patch-diff-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Review AI Patch Diff</span>
            </button>
          </div>
        </div>
      ) : isResolvedByVerification ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center space-y-2" data-testid="resolved-diagnosis-banner">
          <div className="flex items-center justify-center gap-2 text-emerald-400 font-semibold text-sm">
            <CheckCircle2 className="w-5 h-5" />
            <span>All Issues Resolved</span>
          </div>
          <p className="text-slate-300 text-xs">
            Previous diagnostic failures were resolved and verified clean. Verification pipeline passed with zero regressions.
          </p>
        </div>
      ) : (
        <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-8 text-center space-y-2">
          <p className="text-slate-400 text-xs">
            {pendingEvidencePromise
              ? "Capturing execution evidence from compiler... Click 'Diagnose Latest Evidence' to await and analyze."
              : lastEvidence && (lastEvidence.exitCode !== 0 || lastEvidence.timedOut)
              ? `Latest failure '${lastEvidence.command} ${lastEvidence.args.join(' ')}' (Exit code: ${lastEvidence.exitCode}). Click 'Diagnose Latest Evidence' to analyze.`
              : lastEvidence
              ? `Latest command '${lastEvidence.command} ${lastEvidence.args.join(' ')}' (Exit code: ${lastEvidence.exitCode}). Click 'Diagnose Latest Evidence' to verify codebase.`
              : 'No execution evidence recorded yet. Run a command from the terminal or devtools to capture logs.'}
          </p>
        </div>
      )}
    </div>
  );

  const renderVerificationContent = () => (
    <div className="h-full overflow-y-auto p-4 space-y-4 bg-[#0B0F17] custom-scrollbar text-xs">
      <div className="flex items-center justify-between pb-3 border-b border-white/5">
        <div>
          <h3 className="font-bold text-white text-sm">Automated Verification Pipeline</h3>
          <p className="text-slate-400 text-[11px]">Deterministic checks running inside the real WebContainer</p>
        </div>

        <button
          onClick={handleRunVerification}
          disabled={isVerifying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm transition disabled:opacity-50"
        >
          {isVerifying ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Running Checks...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Run Verification</span>
            </>
          )}
        </button>
      </div>

      {verificationResult ? (
        <div className="space-y-3">
          <div className={`p-3.5 rounded-xl border flex items-center justify-between font-semibold ${
            verificationResult.success
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}>
            <span>{verificationResult.success ? '✓ All Verification Checks Passed' : '✗ Verification Failed'}</span>
            <span className="font-mono text-xs">{verificationResult.totalDurationMs}ms</span>
          </div>

          <div className="space-y-2">
            {verificationResult.checks.map((c, idx) => (
              <div key={idx} className="bg-[#111827] border border-white/5 rounded-xl p-3 flex items-start justify-between">
                <div className="space-y-1 flex-1 mr-4">
                  <div className="flex items-center gap-2">
                    {c.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span className="font-semibold text-slate-200">{c.name}</span>
                  </div>
                  {c.output && (
                    <pre className="text-[10px] font-mono text-slate-400 bg-[#0B0F17] p-2 rounded max-h-20 overflow-y-auto whitespace-pre-wrap">
                      {c.output}
                    </pre>
                  )}
                </div>
                {c.durationMs && (
                  <span className="font-mono text-[10px] text-slate-500 shrink-0">{c.durationMs}ms</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-8 text-center text-slate-400">
          Click 'Run Verification' to test TypeScript types, production build, and runtime health.
        </div>
      )}
    </div>
  );

  return (
    <ErrorBoundary fallbackTitle="Bottom Workspace Drawer Error">
      <div 
        data-testid="workspace-bottom-drawer"
        className={`border-t border-white/5 bg-[#0B0F17] flex flex-col shrink-0 select-none transition-all duration-200 z-20 ${
          isBottomDrawerOpen ? '' : 'h-9'
        }`}
        style={isBottomDrawerOpen ? { height: `${effectiveDrawerHeight}px` } : { height: '36px' }}
      >
        {/* Drawer Header Tabs */}
        <div className="h-9 px-3 bg-slate-950/90 border-b border-white/5 flex items-center justify-between shrink-0">
          {/* EC-07: Tablist Container */}
          <div 
            role="tablist" 
            aria-label="Engineering Console Tabs"
            className="flex items-center gap-1 overflow-x-auto"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeBottomTab === tab.id && isBottomDrawerOpen;

              return (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
                  onClick={() => {
                    setActiveBottomTab(tab.id);
                    setIsBottomDrawerOpen(true);
                  }}
                  className={`min-h-[30px] h-7 px-3 rounded-md text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap touch-manipulation ${
                    isActive
                      ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.shortLabel}</span>

                  {tab.badge && (
                    <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      tab.badge.includes('Error') || tab.badge.includes('Failure') || tab.badge === 'Failed'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                        : tab.badge === 'Verified' || tab.badge === 'Live' || tab.badge === 'Ready'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : tab.badge === 'Starting'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 text-slate-400">
            <button
              onClick={() => setBottomDrawerHeight(bottomDrawerHeight > 350 ? 280 : 500)}
              className="p-1 hover:text-slate-200 hover:bg-slate-900 rounded transition"
              title={bottomDrawerHeight > 350 ? 'Restore console height' : 'Maximize console height'}
              aria-label={bottomDrawerHeight > 350 ? 'Restore console height' : 'Maximize console height'}
            >
              {bottomDrawerHeight > 350 ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={toggleBottomDrawer}
              className="p-1 hover:text-slate-200 hover:bg-slate-900 rounded transition"
              title={isBottomDrawerOpen ? 'Collapse console drawer' : 'Expand console drawer'}
              aria-label={isBottomDrawerOpen ? 'Collapse console drawer' : 'Expand console drawer'}
            >
              {isBottomDrawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Tab Viewports: EC-03: Keep InteractiveTerminal permanently mounted to prevent instance destruction */}
        <div 
          className={`flex-1 min-h-0 overflow-hidden bg-[#0B0F17] ${isBottomDrawerOpen ? 'flex flex-col' : 'hidden'}`}
          style={{ display: isBottomDrawerOpen ? 'flex' : 'none' }}
        >
          {/* Terminal Panel */}
          <div
            id="panel-terminal"
            role="tabpanel"
            aria-labelledby="tab-terminal"
            tabIndex={0}
            className={`h-full w-full ${activeBottomTab === 'terminal' ? 'flex flex-col' : 'hidden'}`}
            style={{ display: activeBottomTab === 'terminal' ? 'flex' : 'none' }}
          >
            <InteractiveTerminal isVisible={isBottomDrawerOpen && activeBottomTab === 'terminal'} />
          </div>

          {/* Diagnostics Panel */}
          <div
            id="panel-diagnostics"
            role="tabpanel"
            aria-labelledby="tab-diagnostics"
            tabIndex={0}
            className={`h-full w-full ${activeBottomTab === 'diagnostics' ? 'block' : 'hidden'}`}
            style={{ display: activeBottomTab === 'diagnostics' ? 'block' : 'none' }}
          >
            {renderDiagnosticsContent()}
          </div>

          {/* Verification Panel */}
          <div
            id="panel-verification"
            role="tabpanel"
            aria-labelledby="tab-verification"
            tabIndex={0}
            className={`h-full w-full ${activeBottomTab === 'verification' ? 'block' : 'hidden'}`}
            style={{ display: activeBottomTab === 'verification' ? 'block' : 'none' }}
          >
            {renderVerificationContent()}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};
