import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  ArrowRight, 
  CheckCircle2, 
  CircleDot, 
  Layers, 
  Cpu, 
  Terminal, 
  RefreshCw,
  FileCode,
  Laptop,
  Image as ImageIcon,
  AlertTriangle,
  Plus
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useAgentStore } from '../../store/agentStore';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { generateProject } from './generation-client';
import { deriveProjectName } from './project-name-utils';
import { ScreenshotToAppPanel } from '../../components/build/ScreenshotToAppPanel';

export type BuildStudioLifecycle = 'ready' | 'generating' | 'success' | 'error';

interface GenerationPanelProps {
  onOpenProject?: () => void;
  initialLifecycleState?: BuildStudioLifecycle;
  initialSuccessProject?: {
    id: string;
    name: string;
    fileCount: number;
    isExistingEmptyTarget?: boolean;
  } | null;
}

export const GenerationPanel: React.FC<GenerationPanelProps> = ({ 
  onOpenProject,
  initialLifecycleState = 'ready',
  initialSuccessProject = null
}) => {
  const [prompt, setPrompt] = useState('');
  const [stepStage, setStepStage] = useState<string>('');
  const [studioTab, setStudioTab] = useState<'prompt' | 'screenshot'>('prompt');
  // Lifecycle state machine initialized with useState<BuildStudioLifecycle>('ready') by default
  const [lifecycleState, setLifecycleState] = useState<BuildStudioLifecycle>(initialLifecycleState || 'ready');
  const [lastCreatedProject, setLastCreatedProject] = useState<{
    id: string;
    name: string;
    fileCount: number;
    isExistingEmptyTarget?: boolean;
  } | null>(initialSuccessProject);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Synchronous submission lock to prevent duplicate submissions
  const isSubmittingRef = useRef<boolean>(false);

  // Responsive panel container measurement
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number>(360);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const measure = () => {
      if (el) {
        const w = el.clientWidth || el.getBoundingClientRect().width;
        if (w > 0) setPanelWidth(w);
      }
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 0) setPanelWidth(w);
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, []);

  const isWideLayout = panelWidth >= 440;

  const { 
    createProject, 
    deleteProject, 
    setActiveProjectId, 
    writeFilesBulk, 
    activeProjectId, 
    projects 
  } = useProjectStore();
  const { openFile } = useEditorStore();
  const { mountAndStartProject, addTerminalLog } = useRuntimeStore();
  const { generationState, setGenerationState, setCurrentPrompt } = useAgentStore();

  const presets = [
    { title: 'SaaS Invoicing & Metrics Dashboard', prompt: 'Build a SaaS invoice dashboard with customers, invoices, revenue metrics and a responsive sidebar.' },
    { title: 'AI Workflow Pipeline Canvas', prompt: 'Build an AI workflow node builder with step execution, token telemetry, and run controls.' },
    { title: 'E-Commerce Storefront & Cart', prompt: 'Build a responsive modern e-commerce storefront with product catalog, filter tabs, and interactive cart.' }
  ];

  const handleGenerate = async (e?: React.FormEvent, overridePrompt?: string) => {
    if (e) e.preventDefault();
    const activePrompt = (overridePrompt !== undefined ? overridePrompt : prompt).trim();
    if (!activePrompt) return;

    // Guard: Prevent double-click or concurrent generation
    if (isSubmittingRef.current || lifecycleState === 'generating') return;
    isSubmittingRef.current = true;

    const previousProjectId = activeProjectId;
    const currentActiveProject = previousProjectId ? projects[previousProjectId] : null;

    // Check authoritative files to determine if active project has zero files (CASE A)
    const vfsFiles = previousProjectId ? vfsManager.getFiles(previousProjectId) : {};
    const storeFiles = currentActiveProject?.files || {};
    const totalFileCount = Object.keys(vfsFiles).length > 0
      ? Object.keys(vfsFiles).length
      : Object.keys(storeFiles).length;

    const isPopulatingEmptyActiveProject = Boolean(
      previousProjectId &&
      currentActiveProject &&
      totalFileCount === 0
    );

    let createdProjectId: string | null = null;
    let targetProjectId: string;
    let targetProjectName: string;

    setLifecycleState('generating');
    setErrorMessage(null);
    setGenerationState('planning');
    setCurrentPrompt(activePrompt);
    setStepStage('Planning application architecture...');
    addTerminalLog(`\x1b[35m[AI Generator]\x1b[0m Ingesting user requirement: "${activePrompt}"`);

    try {
      // 1. AI Generation (Abstract blueprint synthesis)
      setStepStage('Synthesizing structured project files...');
      setGenerationState('generating');
      const payload = await generateProject({ prompt: activePrompt });

      // 2. Derive clean, meaningful project name from plan or prompt
      const projectName = deriveProjectName(payload.plan?.name, activePrompt);

      if (isPopulatingEmptyActiveProject && previousProjectId && currentActiveProject) {
        // CASE A: Active project exists and has zero authoritative files -> populate CURRENT active project.
        // User-created project name remains the project identity. Do NOT rename to AI-derived name.
        targetProjectId = previousProjectId;
        targetProjectName = currentActiveProject.title;
        addTerminalLog(`\x1b[35m[AI Generator]\x1b[0m Populating existing empty project '${targetProjectName}' (${targetProjectId})`);
      } else {
        // CASE B & C: Active project is non-empty or nonexistent -> create exactly ONE new project
        createdProjectId = createProject(projectName, activePrompt);
        targetProjectId = createdProjectId;
        targetProjectName = projectName;
        addTerminalLog(`\x1b[35m[AI Generator]\x1b[0m Created new isolated project '${targetProjectName}' (${targetProjectId})`);
      }

      try {
        // 4. Mount files into target project's VFS
        setStepStage('Mounting files into Virtual File System...');
        setGenerationState('mounting');
        await writeFilesBulk(targetProjectId, payload.files);

        // 5. Open primary entry file in editor for the target project
        openFile(targetProjectId, '/src/App.tsx');
        addTerminalLog(`\x1b[32m[VFS Created]\x1b[0m Generated ${Object.keys(payload.files).length} files for '${targetProjectId}'`);

        // 6. Mount into Real WebContainer & Start Dev Server for the target project
        setStepStage('Mounting WebContainer & installing dependencies...');
        setGenerationState('installing');
        await mountAndStartProject(targetProjectId);
      } catch (subsequentErr: any) {
        // Transactional Rollback: clean up the newly created project or revert empty project files
        if (createdProjectId) {
          addTerminalLog(`\x1b[31m[Rollback]\x1b[0m Reverting project creation for '${createdProjectId}' due to error: ${subsequentErr?.message || subsequentErr}`);
          try {
            await deleteProject(createdProjectId);
          } catch {
            // Best-effort cleanup
          }
          if (previousProjectId && projects[previousProjectId]) {
            setActiveProjectId(previousProjectId);
          }
        } else if (isPopulatingEmptyActiveProject && targetProjectId) {
          addTerminalLog(`\x1b[31m[Rollback]\x1b[0m Reverting files for existing empty project '${targetProjectId}' due to error: ${subsequentErr?.message || subsequentErr}`);
          try {
            await vfsManager.deleteProject(targetProjectId);
            useProjectStore.setState((state) => {
              const p = state.projects[targetProjectId];
              if (!p) return state;
              return {
                projects: {
                  ...state.projects,
                  [targetProjectId]: {
                    ...p,
                    files: {},
                    openTabs: [],
                    activeFilePath: '',
                  },
                },
              };
            });
            const { useEditorStore } = await import('../../store/editorStore');
            useEditorStore.getState().clearProject(targetProjectId);
          } catch (cleanupErr) {
            console.warn('[GenerationPanel] Rollback cleanup warning:', cleanupErr);
          }
          if (previousProjectId && projects[previousProjectId]) {
            setActiveProjectId(previousProjectId);
          }
        }
        throw subsequentErr;
      }

      // 7. Success state transition
      setStepStage('Application is live in preview.');
      setGenerationState('ready');
      setLastCreatedProject({
        id: targetProjectId,
        name: targetProjectName,
        fileCount: Object.keys(payload.files).length,
        isExistingEmptyTarget: isPopulatingEmptyActiveProject,
      });
      // Clear editable prompt so it is no longer an unsent draft
      setPrompt('');
      setLifecycleState('success');
    } catch (err: any) {
      setGenerationState('error');
      setLifecycleState('error');
      const errorText = err?.message || 'Unknown generation error';
      setErrorMessage(errorText);
      setStepStage(`Generation failed: ${errorText}`);
      addTerminalLog(`\x1b[31m[Generation Error]\x1b[0m ${errorText}`);
      // User prompt in textarea is preserved for retry
    } finally {
      // Submission lock is ALWAYS reset in finally block on every execution path
      isSubmittingRef.current = false;
    }
  };

  const [nextPrompt, setNextPrompt] = useState<string>('');

  const handleCreateAnother = () => {
    setLifecycleState('ready');
    setLastCreatedProject(null);
    setErrorMessage(null);
    setPrompt('');
    setNextPrompt('');
    setGenerationState('idle');
  };

  const handleCreateNextProject = () => {
    const trimmed = nextPrompt.trim();
    if (!trimmed) return;
    setNextPrompt('');
    setLastCreatedProject(null);
    setErrorMessage(null);
    handleGenerate(undefined, trimmed);
  };

  const isGenerating = lifecycleState === 'generating';

  return (
    <div ref={panelRef} className="flex flex-col h-full bg-[#0B0F17] overflow-hidden select-none border-r border-white/5 min-w-0">
      {/* Header */}
      <div className="h-11 px-3 border-b border-white/5 flex items-center justify-between shrink-0 bg-slate-950/60 gap-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-100 uppercase tracking-wider font-sans">
            BUILD Studio
          </span>
        </div>

        <div role="tablist" aria-label="Build Studio views" className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-white/5 shrink-0">
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'prompt'}
            onClick={() => setStudioTab('prompt')}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              studioTab === 'prompt' ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
            data-testid="tab-prompt-studio"
          >
            Blueprint
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'screenshot'}
            onClick={() => setStudioTab('screenshot')}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              studioTab === 'screenshot' ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
            data-testid="tab-screenshot-studio"
          >
            <ImageIcon className="w-3 h-3" />
            <span>Screenshot → App</span>
          </button>
        </div>
      </div>

      {studioTab === 'screenshot' ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <ScreenshotToAppPanel />
        </div>
      ) : lifecycleState === 'success' && lastCreatedProject ? (
        /* STATE 3 — SUCCESS VIEW */
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3.5 sm:p-4 space-y-4 custom-scrollbar animate-in fade-in duration-200 min-w-0">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-4 overflow-hidden">
            {/* Success Header */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block truncate">
                  {lastCreatedProject.isExistingEmptyTarget ? 'Application Built' : 'Application Created'}
                </span>
                <h3
                  className="text-sm font-bold text-slate-100 truncate block"
                  title={lastCreatedProject.isExistingEmptyTarget ? `${lastCreatedProject.name} is Ready` : lastCreatedProject.name}
                  aria-label={`Project: ${lastCreatedProject.name}`}
                  data-testid="generated-project-title"
                >
                  {lastCreatedProject.isExistingEmptyTarget ? `${lastCreatedProject.name} is Ready` : lastCreatedProject.name}
                </h3>
              </div>
            </div>

            {/* Success Metadata Card */}
            <div className="bg-slate-950/80 rounded-xl p-3 border border-white/5 space-y-2 text-xs text-slate-300 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
                <span className="text-slate-400 shrink-0">Project ID</span>
                <span
                  className="font-mono text-slate-300 text-[10px] truncate max-w-[200px] text-right"
                  title={lastCreatedProject.id}
                >
                  {lastCreatedProject.id}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
                <span className="text-slate-400 shrink-0">Generated Artifacts</span>
                <span className="text-emerald-400 font-semibold shrink-0">
                  {lastCreatedProject.fileCount} files
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
                <span className="text-slate-400 shrink-0">Stack</span>
                <span className="text-slate-300 text-right break-words">
                  Vite + React 19 + Tailwind
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
                <span className="text-slate-400 shrink-0">Status</span>
                <span className="text-emerald-400 font-medium inline-flex items-center gap-1.5 text-right flex-wrap justify-end">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="break-words">Live in Preview & WebContainer</span>
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className={`pt-1 gap-2 ${isWideLayout ? 'grid grid-cols-2' : 'flex flex-col'}`}>
              <button
                type="button"
                data-testid="open-project-btn"
                onClick={() => {
                  if (onOpenProject) {
                    onOpenProject();
                  } else {
                    openFile(lastCreatedProject.id, '/src/App.tsx');
                  }
                }}
                aria-label="Open Project in Editor"
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500 hover:brightness-110 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 shrink-0"
              >
                <span className="truncate">Open Project in Editor</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
              <button
                type="button"
                data-testid="create-another-btn"
                onClick={handleCreateAnother}
                aria-label="Create Another Project"
                className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold text-violet-200 hover:text-white bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 transition flex items-center justify-center gap-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span className="truncate">Create Another</span>
              </button>
            </div>

            {/* Quick Prompt Entry for Immediate Next Generation (ISSUE-02 UX Solution) */}
            <div className="pt-2 border-t border-emerald-500/20 space-y-2 overflow-hidden">
              <label
                htmlFor="quick-next-prompt-input"
                className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block truncate"
              >
                Or Start Another Project Immediately
              </label>
              <div className={`gap-2 ${isWideLayout ? 'flex flex-row items-center' : 'flex flex-col'}`}>
                <input
                  id="quick-next-prompt-input"
                  type="text"
                  placeholder="Describe your next application..."
                  value={nextPrompt}
                  onChange={(e) => setNextPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nextPrompt.trim()) {
                      e.preventDefault();
                      handleCreateNextProject();
                    }
                  }}
                  aria-label="Describe your next application"
                  className="w-full min-w-0 flex-1 bg-slate-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition focus-visible:ring-1 focus-visible:ring-violet-500"
                  data-testid="quick-next-prompt-input"
                />
                <button
                  type="button"
                  data-testid="quick-generate-next-btn"
                  disabled={!nextPrompt.trim()}
                  onClick={handleCreateNextProject}
                  aria-label="Build next application"
                  className={`rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-violet-600/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    isWideLayout ? 'px-3.5 py-2 shrink-0' : 'w-full py-2.5'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>Build</span>
                </button>
              </div>
            </div>
          </div>

          {/* Generated Project Files preview */}
          {lastCreatedProject && (Object.keys(projects[lastCreatedProject.id]?.files || {}).length > 0 || Object.keys(vfsManager.getFiles(lastCreatedProject.id) || {}).length > 0) && (
            <div className="space-y-2 pt-2 border-t border-white/5 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <span className="shrink-0">Generated Project Files</span>
                <span className="text-violet-400 font-mono text-[10px] truncate max-w-[160px]" title={lastCreatedProject.id}>
                  {lastCreatedProject.id}
                </span>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
                {Object.values(
                  Object.keys(projects[lastCreatedProject.id]?.files || {}).length > 0
                    ? projects[lastCreatedProject.id].files
                    : vfsManager.getFiles(lastCreatedProject.id)
                ).map((f) => (
                  <div
                    key={f.path}
                    onClick={() => openFile(lastCreatedProject.id, f.path)}
                    title={f.path}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/40 hover:bg-slate-900 border border-white/5 text-xs font-mono text-slate-300 cursor-pointer transition min-w-0"
                  >
                    <span className="truncate min-w-0 mr-2 flex-1">{f.path}</span>
                    <span className="text-[9px] uppercase text-slate-500 px-1 py-0.5 rounded bg-slate-950 shrink-0 font-sans">
                      {f.language || 'code'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* STATE 1 (READY), STATE 2 (GENERATING), STATE 4 (ERROR) */
        <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
          {/* Error Banner if in error state */}
          {lifecycleState === 'error' && errorMessage && (
            <div className="bg-rose-950/80 border border-rose-500/50 rounded-xl p-3.5 text-xs text-rose-300 flex items-start gap-2.5 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="font-semibold text-rose-200">Generation Failed</div>
                <div className="text-[11px] text-rose-300 leading-relaxed break-words">{errorMessage}</div>
                <div className="text-[10px] text-rose-400/80 pt-0.5">Your prompt has been preserved below. You can adjust it and retry.</div>
              </div>
            </div>
          )}

          {/* Input Form */}
          <form onSubmit={handleGenerate} className="space-y-3">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Describe Application to Generate
            </label>
            <div className="relative">
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isGenerating}
                title={isGenerating ? "Generation in progress. Input is temporarily paused until project setup completes." : undefined}
                placeholder="e.g. Build a SaaS invoice dashboard with customers, invoices, revenue metrics and a responsive sidebar..."
                className="w-full bg-[#111827] border border-white/10 rounded-xl p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition resize-none leading-relaxed disabled:opacity-60"
              />
            </div>

            {/* In-Flight / Installing Status Explanation (ISSUE-03 UX Solution) */}
            {isGenerating && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-950/40 border border-violet-500/30 text-xs text-violet-300 animate-in fade-in"
                data-testid="generation-busy-status"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-violet-400 shrink-0" />
                <span className="truncate">
                  {generationState === 'mounting' || generationState === 'installing' || generationState === 'starting'
                    ? 'Preparing WebContainer preview & installing dependencies… Input temporarily paused.'
                    : 'Synthesizing application blueprint with Gemini AI… Input temporarily paused.'}
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500 hover:brightness-110 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    {generationState === 'mounting' || generationState === 'installing' || generationState === 'starting'
                      ? 'Preparing Preview...'
                      : 'Building Application...'}
                  </span>
                </>
              ) : lifecycleState === 'error' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Generation</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate Application</span>
                </>
              )}
            </button>
          </form>

          {/* Real Progress Stepper */}
          {isGenerating && (
            <div className="bg-[#111827] border border-violet-500/30 rounded-xl p-4 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-semibold text-violet-400">
                <span className="flex items-center gap-2">
                  <CircleDot className="w-3.5 h-3.5 animate-pulse" />
                  {stepStage}
                </span>
              </div>

              <div className="space-y-2 text-[11px] font-mono text-slate-400 pt-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Structured Project Plan</span>
                </div>
                <div className="flex items-center gap-2">
                  {generationState === 'planning' ? (
                    <CircleDot className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>Vite + React 19 Source Code</span>
                </div>
                <div className="flex items-center gap-2">
                  {generationState === 'mounting' || generationState === 'installing' || generationState === 'starting' ? (
                    <CircleDot className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>WebContainer Sandbox Mount</span>
                </div>
              </div>
            </div>
          )}

          {/* Quick Presets */}
          <div className="space-y-2.5 pt-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Instant Blueprints
            </span>
            <div className="space-y-2">
              {presets.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => {
                    setPrompt(p.prompt);
                  }}
                  className="w-full text-left p-3 rounded-xl bg-[#111827]/60 hover:bg-[#111827] border border-white/5 hover:border-violet-500/40 transition group disabled:opacity-50"
                >
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-violet-300 transition">
                    {p.title}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {p.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Active Project Files for reference */}
          {projects[activeProjectId] && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <span>Active Workspace Context</span>
                <span className="text-violet-400 font-mono text-[10px] lowercase">{projects[activeProjectId].title}</span>
              </div>
              <div className="space-y-1">
                {Object.values(projects[activeProjectId].files).map((f) => (
                  <div
                    key={f.path}
                    onClick={() => openFile(activeProjectId, f.path)}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/40 hover:bg-slate-900 border border-white/5 text-xs font-mono text-slate-300 cursor-pointer transition"
                  >
                    <span className="truncate">{f.path}</span>
                    <span className="text-[9px] uppercase text-slate-500 px-1 py-0.2 rounded bg-slate-950">
                      {f.language || 'code'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
