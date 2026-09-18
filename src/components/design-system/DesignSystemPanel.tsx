import { useState, useRef, useEffect, FC, ChangeEvent } from 'react';
import { 
  Palette, 
  Type, 
  Layers, 
  Sparkles, 
  Sliders, 
  Download, 
  Upload, 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCw, 
  Check, 
  X, 
  Code, 
  FileCode, 
  Box, 
  Maximize2,
  ExternalLink
} from 'lucide-react';
import { useDesignSystemStore, DesignSystemSubTab } from '../../store/designSystemStore';
import { useProjectStore } from '../../store/projectStore';
import { useAgentStore } from '../../store/agentStore';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { designSystemAnalyzer } from '../../features/design-system/design-system-analyzer';
import { designSystemValidator } from '../../features/design-system/design-system-validator';
import { designSystemDriftEngine } from '../../features/design-system/design-system-drift';
import { designSystemApplier } from '../../features/design-system/design-system-applier';
import { DesignSystem, DesignToken } from '../../features/design-system/design-system-types';

export const DesignSystemPanel: FC = () => {
  const { activeProjectId } = useProjectStore();
  const currentProjectId = activeProjectId || 'default-project';

  const {
    getDesignSystem,
    getDrifts,
    getValidation,
    getCurrentVersion,
    setDesignSystem,
    createDefaultDesignSystem,
    updateTokenValue,
    setDrifts,
    setValidation,
    activeSubTab,
    setActiveSubTab,
    isAnalyzing,
    setIsAnalyzing,
    isGeneratingProposal,
    setIsGeneratingProposal,
    error,
    setError,
    createGuard,
    exportDesignSystem,
    importDesignSystem
  } = useDesignSystemStore();

  const { setPendingPatch, setIsDiffModalOpen } = useAgentStore();

  const activeDs = getDesignSystem(currentProjectId);
  const activeDrifts = getDrifts(currentProjectId);
  const activeValidation = getValidation(currentProjectId);

  const [selectedTokenKey, setSelectedTokenKey] = useState<string>('color.primary');
  const [editingValue, setEditingValue] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize default design system if not present
  useEffect(() => {
    if (!activeDs && currentProjectId) {
      createDefaultDesignSystem(currentProjectId);
    }
  }, [activeDs, currentProjectId, createDefaultDesignSystem]);

  // Sync editing value when selected token changes
  useEffect(() => {
    if (activeDs) {
      if (selectedTokenKey === 'color.primary' || selectedTokenKey === 'primary') {
        setEditingValue(activeDs.colors.primary);
      } else if (selectedTokenKey === 'color.secondary' || selectedTokenKey === 'secondary') {
        setEditingValue(activeDs.colors.secondary);
      } else if (selectedTokenKey === 'color.surface' || selectedTokenKey === 'surface') {
        setEditingValue(activeDs.colors.surface);
      } else if (selectedTokenKey === 'color.background' || selectedTokenKey === 'background') {
        setEditingValue(activeDs.colors.background);
      } else if (activeDs.tokens[selectedTokenKey]) {
        setEditingValue(activeDs.tokens[selectedTokenKey].value);
      }
    }
  }, [selectedTokenKey, activeDs]);

  // 1. Extract from VFS
  const handleExtract = async () => {
    setIsAnalyzing(true);
    setError(null);
    setStatusMessage(null);
    try {
      const files = vfsManager.getFiles(currentProjectId);
      const guard = createGuard(currentProjectId);
      const extracted = await designSystemAnalyzer.analyzeProjectVfs(currentProjectId, files, guard);
      setDesignSystem(currentProjectId, extracted);
      setStatusMessage(`Extracted design system with ${Object.keys(extracted.tokens).length} tokens.`);
    } catch (err: any) {
      setError(err?.message || 'Failed to extract design system from VFS.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 2. Validate
  const handleValidate = () => {
    if (!activeDs) return;
    setError(null);
    try {
      const guard = createGuard(currentProjectId);
      const res = designSystemValidator.validateDesignSystem(activeDs, guard);
      setValidation(currentProjectId, res);
      setStatusMessage(res.summary);
    } catch (err: any) {
      setError(err?.message || 'Validation failed.');
    }
  };

  // 3. Drift Check
  const handleCheckDrift = () => {
    if (!activeDs) return;
    setError(null);
    try {
      const files = vfsManager.getFiles(currentProjectId);
      const guard = createGuard(currentProjectId);
      const detected = designSystemDriftEngine.detectDrift(activeDs, files, guard);
      setDrifts(currentProjectId, detected);
      setStatusMessage(`Drift analysis complete: ${detected.length} hardcoded divergence${detected.length === 1 ? '' : 's'} found.`);
    } catch (err: any) {
      setError(err?.message || 'Drift detection failed.');
    }
  };

  // 4. Save Token Edit
  const handleSaveToken = () => {
    if (!editingValue.trim() || !activeDs) return;
    updateTokenValue(currentProjectId, selectedTokenKey, editingValue.trim());
    setStatusMessage(`Updated ${selectedTokenKey} to ${editingValue.trim()} (v${activeDs.version + 1}).`);
  };

  // 5. Apply Token Update to Source Code via Controlled Pipeline
  const handleApplyToProject = () => {
    if (!activeDs) return;
    setIsGeneratingProposal(true);
    setError(null);
    try {
      const currentFiles = vfsManager.getFiles(currentProjectId);
      const guard = createGuard(currentProjectId);
      const proposal = designSystemApplier.generateApplyProposal(activeDs, currentFiles, guard);

      setPendingPatch({
        id: proposal.id,
        summary: proposal.summary,
        files: proposal.files,
        confidence: proposal.confidence
      }, currentProjectId);
      setIsDiffModalOpen(true);
      setStatusMessage('Generated source change proposal. Reviewing in Unified Diff Modal.');
    } catch (err: any) {
      setError(err?.message || 'Failed to generate apply proposal.');
    } finally {
      setIsGeneratingProposal(false);
    }
  };

  // 6. Fix Drift Proposal
  const handleFixDrift = (driftItem: any) => {
    if (!activeDs) return;
    try {
      const currentFiles = vfsManager.getFiles(currentProjectId);
      const guard = createGuard(currentProjectId);
      const proposal = designSystemDriftEngine.generateDriftCorrectionProposal(activeDs, [driftItem], currentFiles, guard);

      setPendingPatch({
        id: proposal.id,
        summary: proposal.summary,
        files: proposal.files,
        confidence: proposal.confidence
      }, currentProjectId);
      setIsDiffModalOpen(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate drift correction proposal.');
    }
  };

  // 7. Export JSON
  const handleExport = () => {
    try {
      const jsonStr = exportDesignSystem(currentProjectId);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `design-system-${currentProjectId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage('Exported design system JSON successfully.');
    } catch (err: any) {
      setError(err?.message || 'Export failed.');
    }
  };

  // 8. Import JSON
  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importDesignSystem(currentProjectId, content);
      if (res.success) {
        setStatusMessage('Imported design system JSON successfully.');
        setError(null);
      } else {
        setError(res.error || 'Import failed.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!activeDs) {
    return (
      <div className="p-4 text-slate-400 text-xs flex items-center justify-center h-full">
        Loading design system...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden" data-testid="design-system-panel">
      {/* Sub-Tab Navigation Bar */}
      <div className="h-10 px-2.5 border-b border-white/5 flex items-center justify-between bg-slate-950/60 shrink-0 gap-2">
        <div 
          role="tablist" 
          aria-label="Design System sub-views" 
          className="flex items-center gap-1 overflow-x-auto min-w-0 py-1 scrollbar-none"
        >
          {([
            { id: 'overview', label: 'Overview', icon: Box },
            { id: 'tokens', label: 'Tokens', icon: Palette },
            { id: 'components', label: 'Components', icon: Layers },
            { id: 'sources', label: 'Sources', icon: Code },
            { id: 'drift', label: 'Validation & Drift', icon: AlertTriangle },
          ] as const).map(({ id: tab, label, icon: Icon }) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeSubTab === tab}
              data-testid={`ds-subtab-${tab}`}
              onClick={() => setActiveSubTab(tab)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
                activeSubTab === tab
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${
                tab === 'overview' ? 'text-violet-400' :
                tab === 'tokens' ? 'text-indigo-400' :
                tab === 'components' ? 'text-cyan-400' :
                tab === 'sources' ? 'text-emerald-400' :
                'text-amber-400'
              }`} />
              <span className="whitespace-nowrap">{label}</span>
              {tab === 'drift' && activeDrifts.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[9px] shrink-0 font-semibold">
                  {activeDrifts.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pl-1">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 shrink-0">
            v{activeDs.version}
          </span>
        </div>
      </div>

      {/* Messages */}
      {statusMessage && (
        <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-[11px] text-emerald-300 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-emerald-400 hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {error && (
        <div className="px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/20 text-[11px] text-rose-300 flex items-center justify-between" data-testid="ds-error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4 text-slate-100">
        {/* =========================================================================
            TAB 1: OVERVIEW
           ========================================================================= */}
        {activeSubTab === 'overview' && (
          <div className="space-y-4" data-testid="ds-tab-overview">
            {/* Header Card */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <Palette className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                  <h3 className="text-sm font-bold text-white break-words leading-snug min-w-0" data-testid="ds-title">
                    {activeDs.name}
                  </h3>
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 self-start">
                  {activeDs.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed break-words">
                {activeDs.description}
              </p>
            </div>

            {/* Primary Action: Full-width hero card */}
            <button
              type="button"
              data-testid="ds-btn-apply-source"
              onClick={handleApplyToProject}
              disabled={isGeneratingProposal}
              className="w-full p-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 text-white font-semibold flex items-center justify-between transition shadow-md shadow-violet-600/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 group text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 shadow-inner">
                  <Sparkles className="w-4 h-4 text-white shrink-0" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">Apply to Code</div>
                  <div className="text-[10px] text-violet-200/80 font-normal truncate">Review diff proposal & patch source</div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 border border-white/20 shrink-0 ml-2">
                Controlled VFS
              </span>
            </button>

            {/* Quick Action Grid: 2-column text-wrapping layout with zero truncation */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                data-testid="ds-btn-extract"
                onClick={handleExtract}
                disabled={isAnalyzing}
                className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 flex items-center gap-2 text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 shrink-0 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span className="leading-snug text-left">Extract from VFS</span>
              </button>

              <button
                type="button"
                data-testid="ds-btn-validate"
                onClick={handleValidate}
                className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 flex items-center gap-2 text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="leading-snug text-left">Validate System</span>
              </button>

              <button
                type="button"
                data-testid="ds-btn-drift"
                onClick={handleCheckDrift}
                className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 flex items-center gap-2 text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="leading-snug text-left">Check Drift</span>
              </button>

              <button
                type="button"
                data-testid="ds-btn-export"
                onClick={handleExport}
                className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 flex items-center gap-2 text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <Download className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span className="leading-snug text-left">Export JSON</span>
              </button>

              <button
                type="button"
                data-testid="ds-btn-import"
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 flex items-center gap-2 text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 col-span-2"
              >
                <Upload className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="leading-snug text-left">Import JSON System</span>
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept=".json,application/json"
              onChange={handleImportFile}
              className="hidden"
              data-testid="ds-file-input"
            />

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1 text-center">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Colors</span>
                <span className="text-lg font-bold text-white" data-testid="ds-stat-colors">
                  {Object.keys(activeDs.colors).length}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1 text-center">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Patterns</span>
                <span className="text-lg font-bold text-white" data-testid="ds-stat-patterns">
                  {activeDs.componentPatterns.length}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1 text-center">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Tokens</span>
                <span className="text-lg font-bold text-white" data-testid="ds-stat-tokens">
                  {Object.keys(activeDs.tokens).length}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: TOKENS & PALETTE
           ========================================================================= */}
        {activeSubTab === 'tokens' && (
          <div className="space-y-4" data-testid="ds-tab-tokens">
            {/* Semantic Palette Swatches: 2-column grid for comfortable reading */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-violet-400" />
                <span>Semantic Palette</span>
              </h4>
              <div className="grid grid-cols-2 gap-2.5 text-xs" data-testid="ds-palette-grid">
                {Object.entries(activeDs.colors).map(([key, val]) => {
                  if (key === 'custom' || typeof val !== 'string') return null;
                  return (
                    <div
                      key={key}
                      onClick={() => { setSelectedTokenKey(`color.${key}`); setEditingValue(val); }}
                      className={`p-2.5 rounded-xl bg-slate-950/60 border cursor-pointer transition flex items-center gap-2.5 min-w-0 ${
                        selectedTokenKey === `color.${key}` || selectedTokenKey === key
                          ? 'border-violet-500 bg-violet-500/10'
                          : 'border-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-lg border border-white/20 shrink-0 shadow" style={{ backgroundColor: val }} />
                      <div className="min-w-0 flex-1">
                        <span className="text-[11px] text-slate-400 capitalize block font-medium leading-none mb-1">{key}</span>
                        <span className="text-xs font-mono font-bold text-white tracking-wide block leading-none">{val}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Inline Token Editor Card */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-white/10 space-y-3" data-testid="ds-token-editor">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-white/5">
                <span className="font-semibold text-white">Edit Token: <strong className="text-violet-300 font-mono">{selectedTokenKey}</strong></span>
                <span className="text-[10px] font-mono text-slate-400">Target: project source</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  placeholder="e.g. #7c3aed or 12px"
                  data-testid="ds-edit-token-input"
                  className="flex-1 min-w-0 bg-slate-950 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-violet-500"
                />
                <button
                  type="button"
                  data-testid="ds-save-token-btn"
                  onClick={handleSaveToken}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition shrink-0"
                >
                  Save Token
                </button>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">Preview live impact:</span>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded border border-white/20" style={{ backgroundColor: editingValue }} />
                  <span className="text-xs font-mono text-white">{editingValue}</span>
                </div>
              </div>
            </div>

            {/* Typography Scale Preview */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-indigo-400" />
                <span>Typography Scale</span>
              </h4>
              <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-2 text-xs" data-testid="ds-typography-preview">
                <div className="flex items-baseline justify-between border-b border-white/5 pb-1 text-[11px] text-slate-400">
                  <span>Font: <strong className="text-white">{activeDs.typography.fontFamily}</strong></span>
                  <span>Body: <strong className="text-white">{activeDs.typography.bodyFamily}</strong></span>
                </div>
                <div className="space-y-1 font-sans">
                  <div className="text-xl font-bold text-white">Heading 1 (24px)</div>
                  <div className="text-base font-semibold text-slate-200">Heading 2 (18px)</div>
                  <div className="text-sm text-slate-300">Body text: The quick brown fox jumps over the lazy dog.</div>
                  <div className="text-xs text-slate-400">Caption / Metadata label (12px)</div>
                </div>
              </div>
            </div>

            {/* Spacing & Radii Scales */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Spacing Scale</h4>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-2">
                  {Object.entries(activeDs.spacing).map(([k, v]) => {
                    if (k === 'custom') return null;
                    return (
                      <div key={k} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-slate-400 uppercase w-8">{k}</span>
                        <div className="flex-1 mx-2 h-2 bg-slate-800 rounded overflow-hidden">
                          <div className="h-full bg-violet-500/60" style={{ width: `${Math.min(100, parseInt(v as string, 10) * 3)}%` }} />
                        </div>
                        <span className="text-slate-300 w-12 text-right">{v as string}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Radius Scale</h4>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-2">
                  {Object.entries(activeDs.radii).map(([k, v]) => {
                    if (k === 'custom') return null;
                    return (
                      <div key={k} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-slate-400 uppercase w-8">{k}</span>
                        <div className="w-8 h-5 border border-violet-500/40 bg-violet-600/20" style={{ borderRadius: v as string }} />
                        <span className="text-slate-300 w-14 text-right">{v as string}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 3: COMPONENT PATTERNS
           ========================================================================= */}
        {activeSubTab === 'components' && (
          <div className="space-y-4" data-testid="ds-tab-components">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Reusable Component Patterns</span>
            </h4>

            <div className="grid grid-cols-1 gap-3">
              {activeDs.componentPatterns.map((pattern, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{pattern.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {pattern.role}
                      </span>
                    </div>
                  </div>

                  {/* Live Rendered Pattern */}
                  <div className="p-4 rounded-lg bg-slate-900 flex items-center justify-center">
                    {pattern.role === 'action' && (
                      <button className={pattern.classes}>
                        Preview Button
                      </button>
                    )}
                    {pattern.role === 'container' && (
                      <div className={pattern.classes}>
                        <h4 className="text-xs font-bold text-white mb-1">Container Preview</h4>
                        <p className="text-[11px] text-slate-400">Card container styled with active design tokens.</p>
                      </div>
                    )}
                    {pattern.role === 'input' && (
                      <input className={pattern.classes} placeholder="Interactive input preview..." readOnly />
                    )}
                  </div>

                  {/* Tailwind Classes and Tokens */}
                  <div className="text-[11px] font-mono text-slate-400 bg-slate-900/60 p-2 rounded border border-white/5 break-all">
                    {pattern.classes}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 4: SOURCES & PROVENANCE
           ========================================================================= */}
        {activeSubTab === 'sources' && (
          <div className="space-y-4" data-testid="ds-tab-sources">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-emerald-400" />
              <span>Design System Sources & Adapters</span>
            </h4>

            <div className="space-y-3">
              {/* Active VFS Source Card */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-white/10 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <FileCode className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span className="font-bold text-white leading-snug break-words">Project Virtual File System (VFS)</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 shrink-0 self-start">
                    Active
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Extracts CSS variables (--color-primary, etc.) and Tailwind theme configurations directly from project source files.
                </p>
                <div className="text-[10px] font-mono text-slate-500">
                  Confidence: {Math.round(activeDs.sourceMetadata.confidence * 100)}% • Source Files: {activeDs.sourceMetadata.sourceFiles.length || 'None'}
                </div>
              </div>

              {/* Extensible Adapters Cards */}
              <div className="p-3.5 rounded-xl bg-slate-950/40 border border-white/5 space-y-2 text-xs opacity-75">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <Sliders className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                    <span className="font-bold text-slate-300 leading-snug break-words">Storybook Integration Adapter</span>
                  </div>
                  <span className="text-[10px] font-mono text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 shrink-0 self-start">
                    Interface Stub
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Extensible source adapter for storybook-based token catalogs. Ready for external component library connection.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/40 border border-white/5 space-y-2 text-xs opacity-75">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <Maximize2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                    <span className="font-bold text-slate-300 leading-snug break-words">Figma Tokens Integration Adapter</span>
                  </div>
                  <span className="text-[10px] font-mono text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 shrink-0 self-start">
                    Interface Stub
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Extensible source adapter for Figma design token exports and variables.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 5: VALIDATION & DRIFT
           ========================================================================= */}
        {activeSubTab === 'drift' && (
          <div className="space-y-4" data-testid="ds-tab-drift">
            {/* Validation Overview */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-2" data-testid="ds-validation-card">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Validation Status</span>
                </h4>
                <button
                  type="button"
                  onClick={handleValidate}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
                >
                  Re-validate
                </button>
              </div>

              {activeValidation ? (
                <div className="space-y-2 text-xs">
                  <div className={`p-2.5 rounded-lg border text-xs ${
                    activeValidation.valid ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                  }`}>
                    {activeValidation.summary}
                  </div>
                  {activeValidation.errors.map((e, i) => (
                    <div key={i} className="p-2 rounded bg-rose-950/40 text-rose-300 text-[11px]">
                      <strong>[Error: {e.code}]</strong> {e.message}
                    </div>
                  ))}
                  {activeValidation.warnings.map((w, i) => (
                    <div key={i} className="p-2 rounded bg-amber-950/40 text-amber-300 text-[11px]">
                      <strong>[Warning: {w.code}]</strong> {w.message}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Click &quot;Validate System&quot; to run integrity checks on active tokens.</p>
              )}
            </div>

            {/* Drift Detection List */}
            <div className="space-y-2" data-testid="ds-drift-list">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Detected Code Drift ({activeDrifts.length})</span>
                </h4>
                <button
                  type="button"
                  onClick={handleCheckDrift}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
                >
                  Scan Codebase
                </button>
              </div>

              {activeDrifts.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950/40 border border-white/5 text-center text-xs text-slate-400">
                  Zero code drift detected. Source code conforms to active design tokens.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeDrifts.map((drift) => (
                    <div key={drift.id} className="p-3 rounded-xl bg-slate-950/60 border border-amber-500/20 space-y-2 text-xs min-w-0">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="font-mono text-amber-300 font-semibold break-all flex-1 min-w-0">{drift.filePath}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 shrink-0">
                          {Math.round(drift.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">{drift.suggestedCorrection}</p>
                      <button
                        type="button"
                        data-testid="ds-btn-fix-drift"
                        onClick={() => handleFixDrift(drift)}
                        className="px-3 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 shrink-0"
                      >
                        Create Fix Proposal
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
