import React from 'react';
import { 
  Layers, 
  Palette, 
  Smartphone, 
  Image as ImageIcon, 
  Sparkles, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle 
} from 'lucide-react';
import { ScreenshotAnalysis } from '../../features/screenshot-app/screenshot-types';

export interface ScreenshotAnalysisPanelProps {
  analysis: ScreenshotAnalysis;
  isGenerating?: boolean;
  onGenerate: () => void;
}

export const ScreenshotAnalysisPanel: React.FC<ScreenshotAnalysisPanelProps> = ({
  analysis,
  isGenerating = false,
  onGenerate
}) => {
  return (
    <div className="space-y-4 bg-slate-900/60 border border-white/10 rounded-xl p-4" data-testid="screenshot-analysis-panel">
      {/* Header Info & Confidence */}
      <div className="flex items-center justify-between pb-3 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              {analysis.pageType} Application
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
              {analysis.layoutModel}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Viewport: {analysis.viewportWidth}x{analysis.viewportHeight}px • {analysis.sections.length} layout sections
          </p>
        </div>

        <div className="flex items-center gap-1.5" data-testid="analysis-confidence-badge">
          <span className="text-[10px] text-slate-400">Confidence:</span>
          <span className="text-xs font-mono font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
            {Math.round(analysis.confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Extracted Design Tokens (Palette) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
          <Palette className="w-3.5 h-3.5 text-violet-400" />
          <span>Extracted Design Tokens</span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-[10px] font-mono">
          <div className="p-2 rounded-lg bg-slate-950/60 border border-white/5 flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: analysis.colorPalette.primary }} />
            <div className="truncate">
              <span className="text-slate-500 block text-[9px]">Primary</span>
              <span className="text-slate-200">{analysis.colorPalette.primary}</span>
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-950/60 border border-white/5 flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: analysis.colorPalette.secondary }} />
            <div className="truncate">
              <span className="text-slate-500 block text-[9px]">Secondary</span>
              <span className="text-slate-200">{analysis.colorPalette.secondary}</span>
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-950/60 border border-white/5 flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: analysis.colorPalette.surface }} />
            <div className="truncate">
              <span className="text-slate-500 block text-[9px]">Surface</span>
              <span className="text-slate-200">{analysis.colorPalette.surface}</span>
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-950/60 border border-white/5 flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: analysis.colorPalette.background }} />
            <div className="truncate">
              <span className="text-slate-500 block text-[9px]">Background</span>
              <span className="text-slate-200">{analysis.colorPalette.background}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Structured Sections */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Layout Sections ({analysis.sections.length})</span>
        </div>
        <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
          {analysis.sections.map((sec, i) => (
            <div key={i} className="p-2 rounded-lg bg-slate-950/60 border border-white/5 flex items-center justify-between text-xs">
              <div className="min-w-0 pr-2">
                <span className="font-semibold text-slate-200 block truncate">{sec.name}</span>
                {sec.heading && <span className="text-[10px] text-slate-400 block truncate">{sec.heading}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {sec.components.slice(0, 2).map((c, ci) => (
                  <span key={ci} className="text-[9px] font-mono px-1 py-0.5 rounded bg-slate-800 text-slate-300">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Responsive Observations (Observed vs Inferred) */}
      <div className="space-y-1.5" data-testid="inferred-responsive-rules">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
          <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
          <span>Responsive Rules</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
          <div className="p-2 rounded-lg bg-slate-950/40 border border-white/5 space-y-1">
            <span className="text-[9px] uppercase font-bold text-slate-500 block">Observed Viewport Rules</span>
            <ul className="space-y-0.5 text-slate-300 list-disc list-inside">
              {analysis.responsiveObservations.observed.slice(0, 2).map((r, i) => (
                <li key={i} className="truncate">{r}</li>
              ))}
            </ul>
          </div>
          <div className="p-2 rounded-lg bg-slate-950/40 border border-white/5 space-y-1">
            <span className="text-[9px] uppercase font-bold text-violet-400 block">Inferred Mobile Rules</span>
            <ul className="space-y-0.5 text-slate-300 list-disc list-inside">
              {analysis.responsiveObservations.inferred.slice(0, 2).map((r, i) => (
                <li key={i} className="truncate">{r}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Asset Placeholders Warning */}
      {analysis.images.length > 0 && (
        <div className="p-2 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-[10px] text-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{analysis.images.length} assets represented as safe placeholders (zero external downloads)</span>
          </div>
          <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[9px]">
            Unresolved
          </span>
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500 hover:brightness-110 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
        data-testid="generate-from-analysis-btn"
      >
        {isGenerating ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Synthesizing Application Code...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate Application Code</span>
          </>
        )}
      </button>
    </div>
  );
};
