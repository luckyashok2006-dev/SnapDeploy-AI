import React, { useState } from 'react';
import { 
  Split, 
  Layers, 
  Sparkles, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Sliders 
} from 'lucide-react';
import { VisualComparisonResult } from '../../features/screenshot-app/screenshot-types';

export interface VisualComparisonPanelProps {
  comparison: VisualComparisonResult;
  sourceDataUrl?: string;
  onRefine: () => void;
  isRefining?: boolean;
}

export const VisualComparisonPanel: React.FC<VisualComparisonPanelProps> = ({
  comparison,
  sourceDataUrl,
  onRefine,
  isRefining = false
}) => {
  const [viewMode, setViewMode] = useState<'side-by-side' | 'overlay'>('side-by-side');
  const [overlayOpacity, setOverlayOpacity] = useState(50);

  return (
    <div className="space-y-4 bg-slate-900/60 border border-white/10 rounded-xl p-4" data-testid="visual-comparison-panel">
      {/* Header & Score Metric */}
      <div className="flex items-center justify-between pb-3 border-b border-white/5">
        <div className="space-y-0.5">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Split className="w-3.5 h-3.5 text-violet-400" />
            <span>Visual Comparison Analysis</span>
          </h3>
          <p className="text-[11px] text-slate-400">
            Deterministic layout, aspect-ratio, and color distribution metric
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-medium">Similarity:</span>
          <span 
            className={`text-sm font-mono font-bold px-2.5 py-0.5 rounded-lg border ${
              comparison.similarityScore >= 85
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : comparison.similarityScore >= 65
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}
            data-testid="visual-similarity-score"
          >
            {comparison.similarityScore}%
          </span>
        </div>
      </div>

      {/* Comparison View Controls */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1 bg-slate-950/60 p-0.5 rounded-lg border border-white/5">
          <button
            type="button"
            onClick={() => setViewMode('side-by-side')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
              viewMode === 'side-by-side' ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Side-by-Side
          </button>
          <button
            type="button"
            onClick={() => setViewMode('overlay')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
              viewMode === 'overlay' ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Overlay
          </button>
        </div>

        {viewMode === 'overlay' && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
            <Sliders className="w-3 h-3 text-slate-500" />
            <span>Opacity: {overlayOpacity}%</span>
            <input
              type="range"
              min={10}
              max={90}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseInt(e.target.value, 10))}
              className="w-20 accent-violet-500 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Viewport Comparison Previews */}
      {viewMode === 'side-by-side' ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-[10px] font-mono uppercase text-slate-400 block font-semibold">
              Source Reference ({comparison.imageDimensions.source.width}x{comparison.imageDimensions.source.height})
            </span>
            <div className="h-28 rounded-lg bg-slate-950 border border-white/10 overflow-hidden flex items-center justify-center relative">
              {sourceDataUrl ? (
                <img src={sourceDataUrl} alt="Source screenshot" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] text-slate-500">Source Image</span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-mono uppercase text-slate-400 block font-semibold">
              Live Preview ({comparison.imageDimensions.preview.width}x{comparison.imageDimensions.preview.height})
            </span>
            <div className="h-28 rounded-lg bg-slate-950 border border-white/10 overflow-hidden flex items-center justify-center relative">
              <div className="w-full h-full p-2 bg-[#0B0F17] flex flex-col justify-between text-[8px] font-mono text-slate-400">
                <div className="h-4 bg-slate-900 rounded flex items-center px-1">Header</div>
                <div className="h-10 bg-indigo-950/40 border border-indigo-500/20 rounded p-1">Hero Canvas</div>
                <div className="grid grid-cols-3 gap-1">
                  <div className="h-4 bg-slate-900 rounded" />
                  <div className="h-4 bg-slate-900 rounded" />
                  <div className="h-4 bg-slate-900 rounded" />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-32 rounded-lg bg-slate-950 border border-white/10 overflow-hidden relative flex items-center justify-center">
          {sourceDataUrl && (
            <img src={sourceDataUrl} alt="Source reference" className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div 
            className="absolute inset-0 bg-violet-950 mix-blend-difference"
            style={{ opacity: overlayOpacity / 100 }}
          />
        </div>
      )}

      {/* Major Visual Differences List */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>Detected Visual Discrepancies ({comparison.majorDifferences.length})</span>
          </span>
        </div>
        <ul className="space-y-1 text-xs text-slate-300" data-testid="visual-major-differences">
          {comparison.majorDifferences.map((diff, idx) => (
            <li key={idx} className="p-2 rounded-lg bg-slate-950/60 border border-white/5 flex items-start gap-2 text-[11px] leading-relaxed">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
              <span>{diff}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Action Button: Request Visual Refinement */}
      <button
        onClick={onRefine}
        disabled={isRefining}
        className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
        data-testid="request-visual-refinement-btn"
      >
        {isRefining ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Formulating Visual Refinement Patch...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            <span>Request Visual Refinement</span>
          </>
        )}
      </button>
    </div>
  );
};
