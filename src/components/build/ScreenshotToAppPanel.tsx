import React, { useState, useRef } from 'react';
import { 
  UploadCloud, 
  Image as ImageIcon, 
  Sparkles, 
  X, 
  FileCode, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Split, 
  SlidersHorizontal 
} from 'lucide-react';
import { useScreenshotAppStore } from '../../store/screenshotAppStore';
import { useProjectStore } from '../../store/projectStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useAgentStore } from '../../store/agentStore';
import { useEditorStore } from '../../store/editorStore';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { validateScreenshotFile, validateImageDimensions } from '../../features/screenshot-app/screenshot-security';
import { screenshotAnalyzer } from '../../features/screenshot-app/screenshot-analyzer';
import { screenshotGenerator } from '../../features/screenshot-app/screenshot-generator';
import { screenshotComparator } from '../../features/screenshot-app/screenshot-comparator';
import { ScreenshotImage, ScreenshotGenerationMode } from '../../features/screenshot-app/screenshot-types';
import { ScreenshotAnalysisPanel } from './ScreenshotAnalysisPanel';
import { VisualComparisonPanel } from './VisualComparisonPanel';

export const ScreenshotToAppPanel: React.FC = () => {
  const { activeProjectId, createProject, writeFilesBulk, projects } = useProjectStore();
  const { mountAndStartProject, addTerminalLog, previewUrl } = useRuntimeStore();
  const { setPendingPatch, setIsDiffModalOpen } = useAgentStore();
  const { openFile } = useEditorStore();

  const currentProjectId = activeProjectId || 'default-project';

  const {
    getScreenshot,
    getAnalysis,
    getProposal,
    getComparison,
    getMode,
    setScreenshot,
    clearScreenshot,
    setAnalysis,
    setProposal,
    setComparison,
    setMode,
    isProcessing,
    setIsProcessing,
    error,
    setError
  } = useScreenshotAppStore();

  const activeImage = getScreenshot(currentProjectId);
  const activeAnalysis = getAnalysis(currentProjectId);
  const activeProposal = getProposal(currentProjectId);
  const activeComparison = getComparison(currentProjectId);
  const currentMode = getMode(currentProjectId);

  const [isDragging, setIsDragging] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File Upload & Validation
  const handleFileChange = (file: File) => {
    setError(null);

    const validation = validateScreenshotFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file format.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) {
        setError('Failed to read image data.');
        return;
      }

      // Read image dimensions
      const img = new Image();
      img.onload = () => {
        const dimValidation = validateImageDimensions(img.width, img.height);
        if (!dimValidation.valid) {
          setError(dimValidation.error || 'Invalid image dimensions.');
          return;
        }

        const screenshotObj: ScreenshotImage = {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          mimeType: file.type || 'image/png',
          sizeBytes: file.size,
          width: img.width,
          height: img.height,
          dataUrl,
          uploadedAt: Date.now()
        };

        setScreenshot(currentProjectId, screenshotObj);
        addTerminalLog(`\x1b[35m[Screenshot Studio]\x1b[0m Ingested visual reference "${file.name}" (${img.width}x${img.height}px)`);
      };
      img.onerror = () => {
        setError('Corrupted image file: unable to decode pixel dimensions.');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Analysis Step
  const handleAnalyze = async () => {
    if (!activeImage) return;
    setIsProcessing(true);
    setError(null);
    addTerminalLog(`\x1b[34m[Screenshot Studio]\x1b[0m Analyzing visual structure and extracting design system...`);

    try {
      const currentFiles = vfsManager.getFiles(currentProjectId);
      const analysis = await screenshotAnalyzer.analyzeScreenshot(activeImage, currentFiles);
      setAnalysis(currentProjectId, analysis);
      addTerminalLog(`\x1b[32m[Screenshot Studio]\x1b[0m Analysis complete: ${analysis.pageType} (${analysis.layoutModel}), confidence ${Math.round(analysis.confidence * 100)}%`);
    } catch (err: any) {
      setError(err?.message || 'Screenshot analysis failed.');
      addTerminalLog(`\x1b[31m[Screenshot Studio Error]\x1b[0m ${err?.message || 'Analysis failed'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Generation Step
  const handleGenerateApplication = async () => {
    if (!activeAnalysis) return;
    setIsProcessing(true);
    setError(null);

    try {
      const currentFiles = vfsManager.getFiles(currentProjectId);
      const proposal = await screenshotGenerator.generateFromScreenshot(
        activeAnalysis,
        currentProjectId,
        currentMode,
        currentFiles
      );
      setProposal(currentProjectId, proposal);

      if (currentMode === 'new_project') {
        // Mode A: Create new project in VFS & launch runtime
        addTerminalLog(`\x1b[35m[Screenshot Studio]\x1b[0m Synthesizing new application from screenshot...`);
        const newProjId = createProject(
          proposal.plan?.name || `app-${activeAnalysis.pageType}`,
          `Generated from screenshot: ${activeImage?.name || activeAnalysis.pageType}`
        );

        // Associate screenshot and analysis with the new project
        if (activeImage) {
          setScreenshot(newProjId, activeImage);
        }
        setAnalysis(newProjId, activeAnalysis);
        setMode(newProjId, 'new_project');

        await writeFilesBulk(newProjId, proposal.files);
        openFile(newProjId, '/src/App.tsx');
        addTerminalLog(`\x1b[32m[VFS Created]\x1b[0m Populated ${Object.keys(proposal.files).length} files for '${newProjId}'`);

        // Run initial visual comparison
        const comparison = screenshotComparator.compareScreenshots(
          { dataUrl: activeImage?.dataUrl, width: activeAnalysis.viewportWidth, height: activeAnalysis.viewportHeight },
          { width: 1280, height: 800 }
        );
        setComparison(newProjId, comparison);

        // Mount and start WebContainer runtime in background
        mountAndStartProject(newProjId).catch((err) => {
          console.warn('[Screenshot Studio] Runtime mount notice:', err);
        });
      } else {
        // Mode B: Existing project adaptation -> Open Unified Diff Review
        addTerminalLog(`\x1b[35m[Screenshot Studio]\x1b[0m Generated minimal adaptation patch for active project.`);
        if (proposal.patchFiles) {
          setPendingPatch({
            id: proposal.id,
            summary: proposal.summary,
            files: proposal.patchFiles,
            confidence: activeAnalysis.confidence
          });
          setIsDiffModalOpen(true);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Generation from screenshot failed.');
      addTerminalLog(`\x1b[31m[Screenshot Studio Error]\x1b[0m ${err?.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Refinement Step
  const handleRefine = async () => {
    if (!activeComparison) return;
    setIsRefining(true);
    try {
      const currentFiles = vfsManager.getFiles(currentProjectId);
      const refinementProposal = screenshotComparator.generateRefinementProposal(
        currentProjectId,
        activeComparison,
        currentFiles
      );
      setPendingPatch(refinementProposal);
      setIsDiffModalOpen(true);
      addTerminalLog(`\x1b[35m[Screenshot Studio]\x1b[0m Formulated visual refinement patch (${activeComparison.similarityScore}% match). Reviewing diff...`);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate visual refinement.');
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="space-y-4 p-4 text-slate-100 select-none custom-scrollbar" data-testid="screenshot-to-app-panel">
      {/* Upload Drop Zone / Active Screenshot Thumbnail */}
      {!activeImage ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-3 ${
            isDragging
              ? 'border-violet-500 bg-violet-600/10'
              : 'border-white/10 hover:border-violet-500/40 bg-slate-900/40 hover:bg-slate-900/70'
          }`}
          data-testid="screenshot-drop-zone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            className="hidden"
            data-testid="screenshot-file-input"
          />

          <div className="w-12 h-12 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
            <UploadCloud className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <h4 className="text-xs font-bold text-white tracking-tight">
              Upload Web Application Screenshot
            </h4>
            <p className="text-[11px] text-slate-400">
              Drag & drop or click to browse. Supports PNG, JPEG, WebP (max 10MB).
            </p>
          </div>

          <button
            type="button"
            className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-white/5 transition"
            data-testid="upload-screenshot-btn"
          >
            Select Image
          </button>
        </div>
      ) : (
        <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 space-y-3" data-testid="active-screenshot-card">
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="w-4 h-4 text-violet-400 shrink-0" />
              <span className="text-xs font-semibold text-white truncate">{activeImage.name}</span>
            </div>
            <button
              onClick={() => clearScreenshot(currentProjectId)}
              className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
              title="Remove Screenshot"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-24 h-16 rounded-lg bg-slate-950 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
              <img
                src={activeImage.dataUrl}
                alt={activeImage.name}
                className="w-full h-full object-cover"
                data-testid="screenshot-thumbnail"
              />
            </div>
            <div className="space-y-1 text-xs">
              <div className="text-[11px] font-mono text-slate-300">
                Resolution: <strong className="text-white">{activeImage.width}x{activeImage.height}px</strong>
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                Size: {(activeImage.sizeBytes / 1024).toFixed(1)} KB ({activeImage.mimeType})
              </div>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs">
            <span className="text-[11px] text-slate-400 font-medium">Generation Mode:</span>
            <div className="flex items-center gap-1 bg-slate-950/60 p-0.5 rounded-lg border border-white/5">
              <button
                type="button"
                onClick={() => setMode(currentProjectId, 'new_project')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition ${
                  currentMode === 'new_project' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                data-testid="mode-new-project"
              >
                New App
              </button>
              <button
                type="button"
                onClick={() => setMode(currentProjectId, 'existing_project')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition ${
                  currentMode === 'existing_project' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                data-testid="mode-existing-project"
              >
                Adapt Active
              </button>
            </div>
          </div>

          {/* Trigger Analysis Button */}
          {!activeAnalysis && (
            <button
              onClick={handleAnalyze}
              disabled={isProcessing}
              className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
              data-testid="analyze-screenshot-btn"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Analyzing Visual Structure...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Analyze Screenshot</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div 
          className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2"
          data-testid="screenshot-upload-error"
        >
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Analysis Panel */}
      {activeAnalysis && (
        <ScreenshotAnalysisPanel
          analysis={activeAnalysis}
          isGenerating={isProcessing}
          onGenerate={handleGenerateApplication}
        />
      )}

      {/* Visual Comparison Panel */}
      {activeComparison && (
        <VisualComparisonPanel
          comparison={activeComparison}
          sourceDataUrl={activeImage?.dataUrl}
          onRefine={handleRefine}
          isRefining={isRefining}
        />
      )}
    </div>
  );
};
