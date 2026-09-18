import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Laptop, 
  Tablet, 
  Smartphone, 
  RotateCw, 
  ShieldCheck, 
  ChevronLeft, 
  ChevronRight, 
  Monitor, 
  Play, 
  RefreshCw, 
  MousePointer, 
  Sparkles, 
  X, 
  FileCode, 
  AlertTriangle,
  ExternalLink 
} from 'lucide-react';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useProjectStore } from '../../store/projectStore';
import { useVisualEditStore } from '../../store/visualEditStore';
import { useAgentStore } from '../../store/agentStore';
import { useEditorStore } from '../../store/editorStore';
import { usePreviewStore } from '../../store/previewStore';
import { PREVIEW_DEVICE_PRESETS, PreviewDevicePresetId } from '../../types/preview';
import { calculatePreviewScale, translateScreenToLogicalCoordinates } from '../../features/preview/preview-scaler';
import { attachPreviewFormShim } from '../../features/preview/preview-form-shim';
import { injectPreviewRootScrollbarStyles } from '../../features/preview/preview-scrollbar';
import { sourceMapper } from '../../features/visual-editing/source-mapper';
import { createVisualSelection } from '../../features/visual-editing/visual-selection';
import { visualEditService } from '../../features/visual-editing/visual-edit-service';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { ErrorBoundary } from '../common/ErrorBoundary';

export interface LivePreviewPaneProps {
  isResizing?: boolean;
}

export const LivePreviewPane: React.FC<LivePreviewPaneProps> = ({ isResizing = false }) => {
  const { 
    previewUrl, 
    previewPort, 
    status, 
    mountAndStartProject, 
    addTerminalLog 
  } = useRuntimeStore();
  const { activeProjectId } = useProjectStore();

  const {
    isInspectMode,
    toggleInspectMode,
    setInspectMode,
    activeSelection,
    setSelection,
    clearSelection,
    hoveredElement,
    setHoveredElement,
    isSynthesizing,
    setIsSynthesizing
  } = useVisualEditStore();

  const { setPendingPatch, setIsDiffModalOpen } = useAgentStore();
  const { openFile } = useEditorStore();

  // Project-scoped viewport and zoom state from previewStore
  const projectPreset = usePreviewStore((s) => s.projectDevicePreset[activeProjectId] || 'desktop');
  const projectZoom = usePreviewStore((s) => s.projectZoomScale[activeProjectId] ?? 100);
  const setDevicePreset = usePreviewStore((s) => s.setDevicePreset);
  const setZoomScale = usePreviewStore((s) => s.setZoomScale);

  const viewport: PreviewDevicePresetId = projectPreset;
  const zoomScale: number = projectZoom;
  const currentPreset = PREVIEW_DEVICE_PRESETS[viewport] || PREVIEW_DEVICE_PRESETS.desktop;

  const currentSelection = activeProjectId ? activeSelection[activeProjectId] || null : null;

  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [quickPrompt, setQuickPrompt] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Application Route Navigation & History State
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const historyStackRef = useRef<string[]>(['/']);
  const historyIndexRef = useRef<number>(0);

  // ResizeObserver state for preview stage container
  const stageRef = useRef<HTMLDivElement>(null);
  const scaledWrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [stageDimensions, setStageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setStageDimensions({ width: Math.round(width), height: Math.round(height) });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute presentation fit-scale and display-scale
  // Guarantee wrapper's TOTAL outer footprint, including borders and breathing margin, fits within available stage dimensions at fit-scale
  const BORDER_TOTAL = 2; // 1px border on each side for box-sizing: border-box
  const MARGIN_TOTAL = 16; // 8px breathing space each side
  const availableInnerWidth = Math.max(50, stageDimensions.width - MARGIN_TOTAL - BORDER_TOTAL);
  const availableInnerHeight = Math.max(50, stageDimensions.height - MARGIN_TOTAL - BORDER_TOTAL);

  const { fitScale, displayScale, scaledWidth, scaledHeight } = calculatePreviewScale(
    currentPreset,
    availableInnerWidth,
    availableInnerHeight,
    zoomScale
  );

  // Wrapper outer footprint exactly encapsulates scaled canvas + borders
  const wrapperWidth = scaledWidth + BORDER_TOTAL;
  const wrapperHeight = scaledHeight + BORDER_TOTAL;

  // Runtime readiness for Open in New Tab
  const isRuntimeReady = status === 'ready' && Boolean(previewUrl);

  const handleOpenInNewTab = () => {
    if (!isRuntimeReady || !previewUrl || !activeProjectId) return;
    const targetUrl = `/preview?project=${encodeURIComponent(activeProjectId)}`;
    window.open(targetUrl, '_blank');
  };

  // WebContainer Host Runtime Broker:
  // Bridges messages between opened standalone preview tabs and the WebContainer runner
  useEffect(() => {
    const handleHostBrokerMessage = (event: MessageEvent) => {
      const headlessIframe = document.querySelector('iframe[src*="stackblitz.com/headless"]') as HTMLIFrameElement;
      if (headlessIframe?.contentWindow && event.source !== headlessIframe.contentWindow && event.source !== window) {
        const transferables: Transferable[] = [];
        if (event.ports && event.ports.length > 0) {
          transferables.push(...event.ports);
        }
        try {
          headlessIframe.contentWindow.postMessage(event.data, '*', transferables);
        } catch {}
      }
    };

    window.addEventListener('message', handleHostBrokerMessage);
    return () => window.removeEventListener('message', handleHostBrokerMessage);
  }, []);

  const updateNavigationState = useCallback((newPath: string) => {
    const stack = historyStackRef.current;
    const currIndex = historyIndexRef.current;

    // If initial stack only has dummy root ['/'] and the first real path is reported, seed it
    if (stack.length === 1 && stack[0] === '/' && newPath !== '/') {
      historyStackRef.current = [newPath];
      historyIndexRef.current = 0;
      setCanGoBack(false);
      setCanGoForward(false);
      return;
    }

    if (stack[currIndex] !== newPath) {
      if (currIndex > 0 && stack[currIndex - 1] === newPath) {
        historyIndexRef.current = currIndex - 1;
      } else if (currIndex < stack.length - 1 && stack[currIndex + 1] === newPath) {
        historyIndexRef.current = currIndex + 1;
      } else {
        const nextStack = stack.slice(0, currIndex + 1);
        nextStack.push(newPath);
        historyStackRef.current = nextStack;
        historyIndexRef.current = nextStack.length - 1;
      }
    }

    setCanGoBack(historyIndexRef.current > 0);
    setCanGoForward(historyIndexRef.current < historyStackRef.current.length - 1);
  }, []);

  const syncRouteFromIframe = useCallback(() => {
    try {
      const iframeWin = iframeRef.current?.contentWindow;
      if (iframeWin && iframeWin.location) {
        const path = (iframeWin.location.pathname || '/') + (iframeWin.location.search || '') + (iframeWin.location.hash || '');
        if (!isEditingPath && path) {
          setCurrentPath(path);
          updateNavigationState(path);
        }
      }
    } catch {}
  }, [isEditingPath, updateNavigationState]);

  const handleBack = () => {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {}
  };

  const handleForward = () => {
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {}
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!iframeRef.current || !previewUrl) return;

    let target = currentPath.trim();
    if (!target) target = '/';
    if (!target.startsWith('/')) target = '/' + target;

    // Security check: block protocol injection or directory traversal
    if (target.startsWith('//') || target.includes('javascript:') || target.includes('data:')) {
      return;
    }

    try {
      const iframeWin = iframeRef.current.contentWindow;
      if (iframeWin) {
        // Attempt SPA client navigation first
        try {
          iframeWin.history.pushState({ path: target }, '', target);
          iframeWin.dispatchEvent(new PopStateEvent('popstate', { state: { path: target } }));
          setCurrentPath(target);
          updateNavigationState(target);
          setIsEditingPath(false);
          return;
        } catch {}

        // Fallback to location navigation scoped to preview origin
        const base = new URL(previewUrl);
        const targetUrl = new URL(target, base.origin);
        if (targetUrl.origin === base.origin) {
          iframeWin.location.href = targetUrl.href;
          setCurrentPath(target);
          updateNavigationState(target);
        }
      }
    } catch (err) {
      console.warn('[Preview Navigation Error]:', err);
    }
    setIsEditingPath(false);
  };

  // Route Synchronization & History Listener Effect
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleIframeNav = () => {
      try {
        const iframeWin = iframe.contentWindow;
        if (iframeWin && iframeWin.location) {
          const path = (iframeWin.location.pathname || '/') + (iframeWin.location.search || '') + (iframeWin.location.hash || '');
          if (!isEditingPath) {
            setCurrentPath(path || '/');
          }
          updateNavigationState(path || '/');
        }
      } catch {}
    };

    iframe.addEventListener('load', handleIframeNav);

    let interval: any = null;
    try {
      const iframeWin = iframe.contentWindow;
      if (iframeWin) {
        iframeWin.addEventListener('popstate', handleIframeNav);
        iframeWin.addEventListener('hashchange', handleIframeNav);
        interval = setInterval(handleIframeNav, 400);
      }
    } catch {}

    return () => {
      iframe.removeEventListener('load', handleIframeNav);
      if (interval) clearInterval(interval);
      try {
        iframe.contentWindow?.removeEventListener('popstate', handleIframeNav);
        iframe.contentWindow?.removeEventListener('hashchange', handleIframeNav);
      } catch {}
    };
  }, [previewUrl, iframeKey, isEditingPath, updateNavigationState]);

  const handleRefresh = () => {
    setIsReloading(true);
    setIframeKey((k) => k + 1);
    historyStackRef.current = ['/'];
    historyIndexRef.current = 0;
    setCanGoBack(false);
    setCanGoForward(false);
    setCurrentPath('/');
    addTerminalLog(`\x1b[35m[Preview]\x1b[0m Reloading live iframe viewport.`);
    setTimeout(() => setIsReloading(false), 300);
  };

  const handleDeviceChange = (presetId: PreviewDevicePresetId) => {
    if (activeProjectId) {
      setDevicePreset(activeProjectId, presetId);
      addTerminalLog(`\x1b[34m[Preview Viewport]\x1b[0m Switched to ${PREVIEW_DEVICE_PRESETS[presetId].description}`);
    }
  };

  const handleZoomChange = (zoom: number) => {
    if (activeProjectId) {
      setZoomScale(activeProjectId, zoom);
    }
  };

  // Preview Form-Control Compatibility Shim & Root Scrollbar Hiding: attaches to iframe document
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const cleanupShim = attachPreviewFormShim(iframe);
    const cleanupScrollbar = injectPreviewRootScrollbarStyles(iframe);
    return () => {
      cleanupShim();
      cleanupScrollbar();
    };
  }, [previewUrl, iframeKey, viewport]);

  const handleIframeLoad = () => {
    if (iframeRef.current) {
      attachPreviewFormShim(iframeRef.current);
      injectPreviewRootScrollbarStyles(iframeRef.current);
    }
  };

  // Inspect Overlay Click Handler: maps physical click coordinates through displayScale to logical iframe elements
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!activeProjectId) return;

    let targetEl: any = null;

    if (iframeRef.current && scaledWrapperRef.current) {
      try {
        const stageRect = scaledWrapperRef.current.getBoundingClientRect();
        const contentRect = {
          left: stageRect.left + 1,
          top: stageRect.top + 1,
          width: stageRect.width - 2,
          height: stageRect.height - 2
        };
        const { logicalX, logicalY } = translateScreenToLogicalCoordinates(
          e.clientX,
          e.clientY,
          contentRect,
          displayScale,
          currentPreset
        );

        const doc = iframeRef.current.contentDocument;
        if (doc) {
          targetEl = doc.elementFromPoint(logicalX, logicalY);
        }
      } catch {
        // Cross-origin iframe fallback
      }
    }

    // If no DOM element was accessible (e.g. cross-origin), create a representative preview target
    if (!targetEl) {
      targetEl = {
        tagName: 'button',
        className: 'bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium shadow-md',
        textContent: 'Submit Invoice',
        id: 'primary-btn',
        dataset: { 
          component: 'ActionButton',
          testid: 'primary-action-btn' 
        },
        computedStyles: {
          backgroundColor: 'rgb(79, 70, 229)',
          color: 'rgb(255, 255, 255)',
          padding: '8px 16px',
          borderRadius: '8px',
          fontSize: '14px'
        }
      };
    }

    const vfsFiles = vfsManager.getFiles(activeProjectId);
    const mapping = sourceMapper.resolveSourceComponent(targetEl, vfsFiles);
    const selection = createVisualSelection(activeProjectId, targetEl, mapping, {
      top: e.clientY - 40,
      left: e.clientX - 60,
      width: 140,
      height: 42
    });

    setSelection(activeProjectId, selection);
    setInspectMode(false);
    setHoveredElement(null);
  };

  const handleGenerateEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeProjectId || !currentSelection || !quickPrompt.trim() || isSynthesizing) return;
    if (currentSelection.sourceMapping.confidence < 0.40) return;

    setIsSynthesizing(true);
    setErrorMsg(null);

    try {
      const context = visualEditService.buildVisualEditContext(
        activeProjectId,
        quickPrompt.trim(),
        currentSelection
      );
      const proposal = await visualEditService.synthesizeVisualEditProposal(context);
      setPendingPatch(proposal);
      setIsDiffModalOpen(true);
      setQuickPrompt('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to synthesize visual edit proposal');
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleOpenInEditor = () => {
    if (activeProjectId && currentSelection?.sourceMapping.filePath) {
      openFile(activeProjectId, currentSelection.sourceMapping.filePath);
    }
  };

  const isCompactToolbar = stageDimensions.width > 0 && stageDimensions.width < 480;

  return (
    <ErrorBoundary fallbackTitle="Live Preview Runtime Error">
      <div className="h-full w-full min-w-0 flex flex-col bg-[#0B0F17] overflow-hidden select-none relative">
        {/* Browser Navigation Toolbar */}
        <div 
          data-testid="preview-toolbar"
          className={`h-10 ${
            isCompactToolbar ? 'px-1.5 gap-1' : 'px-2 gap-1.5'
          } bg-slate-900/90 border-b border-white/5 flex items-center justify-between shrink-0 overflow-hidden select-none w-full`}
        >
          {/* 1. LEFT: Browser Navigation */}
          <div data-testid="preview-nav-group" className="flex items-center gap-0.5 shrink-0 text-slate-500">
            <button 
              onClick={handleBack}
              disabled={!canGoBack}
              className={`p-1 rounded transition ${
                canGoBack 
                  ? 'hover:text-slate-200 cursor-pointer text-slate-400' 
                  : 'text-slate-600 cursor-not-allowed opacity-40'
              }`}
              title="Back" 
              aria-label="Back"
              data-testid="preview-back-btn"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleForward}
              disabled={!canGoForward}
              className={`p-1 rounded transition ${
                canGoForward 
                  ? 'hover:text-slate-200 cursor-pointer text-slate-400' 
                  : 'text-slate-600 cursor-not-allowed opacity-40'
              }`}
              title="Forward" 
              aria-label="Forward"
              data-testid="preview-forward-btn"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleRefresh} 
              className={`p-1 hover:text-slate-200 rounded transition cursor-pointer ${isReloading ? 'animate-spin text-violet-400' : ''}`}
              title="Reload Preview"
              aria-label="Reload Preview"
              data-testid="preview-refresh-btn"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 2. CENTER / FLEXIBLE: Unified URL Bar Container (contains URL Content + Embedded New Tab Arrow) */}
          <div 
            data-testid="preview-url-bar"
            className="relative flex-1 min-w-0 max-w-xs sm:max-w-sm flex items-center justify-between bg-[#0B0F17] border border-white/10 rounded-lg pl-1.5 sm:pl-2 pr-1 py-0.5 text-xs font-mono text-slate-300 shadow-inner overflow-hidden truncate group/urlbar"
          >
            {/* 2.1 URL Content: Secure lock, localhost port, and editable route path input */}
            <div data-testid="runtime-url-content" className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 truncate pr-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-400 text-[11px] truncate min-w-0 select-none" title={`localhost:${previewPort || 3000}`}>
                localhost:{previewPort || 3000}
              </span>
              <form onSubmit={handlePathSubmit} className="flex items-center min-w-0 flex-1">
                <input
                  type="text"
                  value={currentPath}
                  onChange={(e) => setCurrentPath(e.target.value)}
                  onFocus={() => setIsEditingPath(true)}
                  onBlur={() => {
                    setIsEditingPath(false);
                    syncRouteFromIframe();
                  }}
                  placeholder="/"
                  title="Application path route (press Enter to navigate)"
                  aria-label="Application route path"
                  data-testid="preview-url-path-input"
                  className="bg-transparent border-0 outline-none text-violet-300 text-[11px] font-mono w-full min-w-[20px] px-0.5 focus:bg-slate-800/90 focus:text-white rounded transition-colors"
                />
              </form>
            </div>

            {/* 2.2 Embedded Action: Open Preview in New Tab Arrow */}
            <button
              onClick={handleOpenInNewTab}
              disabled={!isRuntimeReady}
              data-testid="open-preview-new-tab-btn"
              title={isRuntimeReady ? 'Open Preview in new tab' : 'Dev server not ready'}
              aria-label="Open Preview in new tab"
              className={`p-1 rounded transition shrink-0 focus:outline-none focus:ring-1 focus:ring-violet-400 ${
                isRuntimeReady
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800/80 cursor-pointer'
                  : 'text-slate-600 cursor-not-allowed opacity-40'
              }`}
            >
              <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>

          {/* 3. RIGHT CONTROLS: Action + Utility + Device Presets */}
          <div data-testid="preview-controls-group" className="flex items-center gap-1 shrink-0">
            {/* Visual Inspect Mode Toggle Button */}
            <button
              onClick={toggleInspectMode}
              data-testid="select-element-btn"
              title="Select element in preview to edit visually with AI"
              aria-label={isInspectMode ? 'Click element in preview' : 'Select element'}
              aria-pressed={isInspectMode}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition shrink-0 cursor-pointer ${
                isInspectMode
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30 ring-1 ring-violet-400'
                  : currentSelection
                  ? 'bg-violet-950/60 text-violet-300 border border-violet-500/30'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-white/5'
              }`}
            >
              <MousePointer className={`w-3.5 h-3.5 ${isInspectMode ? 'animate-pulse text-white' : ''}`} />
              <span className={isCompactToolbar ? 'hidden' : 'hidden 2xl:inline'}>{isInspectMode ? 'Click Element...' : 'Select Element'}</span>
            </button>

            {/* Zoom Controls: Permanently visible with responsive compact sizing */}
            <div 
              data-testid="preview-zoom-controls"
              className={`flex items-center ${
                isCompactToolbar ? 'gap-0.5 px-1 py-0.5 text-[9px]' : 'gap-1 px-1.5 py-0.5 text-[10px]'
              } bg-[#0B0F17] rounded-lg border border-white/5 font-mono text-slate-400 shrink-0`}
            >
              <button 
                onClick={() => handleZoomChange(Math.max(50, zoomScale - 10))} 
                className="hover:text-white px-0.5 cursor-pointer"
                title="Zoom Out"
                aria-label="Zoom Out"
                data-testid="preview-zoom-out"
              >
                -
              </button>
              <button
                onClick={() => handleZoomChange(100)}
                title="Reset Zoom (100%)"
                aria-label="Reset Zoom"
                className="hover:text-violet-300 cursor-pointer"
                data-testid="preview-zoom-label"
              >
                {zoomScale}%
              </button>
              <button 
                onClick={() => handleZoomChange(Math.min(150, zoomScale + 10))} 
                className="hover:text-white px-0.5 cursor-pointer"
                title="Zoom In"
                aria-label="Zoom In"
                data-testid="preview-zoom-in"
              >
                +
              </button>
            </div>

            {/* Device Viewport Selector */}
            <div 
              data-testid="preview-device-selector"
              className="flex items-center gap-0.5 bg-[#0B0F17] p-0.5 rounded-lg border border-white/5 shrink-0"
              role="group"
              aria-label="Viewport Presets"
            >
              <button
                onClick={() => handleDeviceChange('desktop')}
                data-testid="preview-device-desktop"
                className={`p-1 rounded transition cursor-pointer ${
                  viewport === 'desktop' 
                    ? 'bg-violet-600 text-white shadow-sm font-bold' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title="Desktop — 1440 × 900"
                aria-label="Desktop viewport (1440 × 900)"
                aria-pressed={viewport === 'desktop'}
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDeviceChange('tablet')}
                data-testid="preview-device-tablet"
                className={`p-1 rounded transition cursor-pointer ${
                  viewport === 'tablet' 
                    ? 'bg-violet-600 text-white shadow-sm font-bold' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title="Tablet — 768 × 1024"
                aria-label="Tablet viewport (768 × 1024)"
                aria-pressed={viewport === 'tablet'}
              >
                <Tablet className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDeviceChange('mobile')}
                data-testid="preview-device-mobile"
                className={`p-1 rounded transition cursor-pointer ${
                  viewport === 'mobile' 
                    ? 'bg-violet-600 text-white shadow-sm font-bold' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title="Mobile — 390 × 844"
                aria-label="Mobile viewport (390 × 844)"
                aria-pressed={viewport === 'mobile'}
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview Content Area */}
        <div 
          ref={stageRef}
          data-testid="preview-stage-container"
          className="flex-1 w-full min-w-0 bg-[#0B0F17] p-3 flex items-center justify-center overflow-auto relative scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent"
        >
          {previewUrl ? (
            <div 
              ref={scaledWrapperRef}
              data-testid="preview-stage-wrapper"
              data-display-scale={displayScale}
              data-fit-scale={fitScale}
              style={{
                width: `${wrapperWidth}px`,
                height: `${wrapperHeight}px`,
                minWidth: `${wrapperWidth}px`,
                minHeight: `${wrapperHeight}px`
              }}
              className={`relative rounded-xl overflow-hidden border border-white/10 bg-slate-950 shadow-2xl shrink-0 m-auto ${
                isResizing ? 'transition-none' : 'transition-all duration-200'
              }`}
            >
              {/* Scaler: logical dimensions with transform: scale(displayScale) */}
              <div
                data-testid="preview-viewport-scaler"
                style={{
                  width: `${currentPreset.width}px`,
                  height: `${currentPreset.height}px`,
                  transform: `scale(${displayScale})`,
                  transformOrigin: 'top left'
                }}
                className="absolute top-0 left-0"
              >
                <iframe
                  ref={iframeRef}
                  key={iframeKey}
                  src={previewUrl}
                  title="SnapDeploy Live Application Preview"
                  data-testid="preview-iframe"
                  data-viewport-preset={viewport}
                  data-logical-width={String(currentPreset.width)}
                  data-logical-height={String(currentPreset.height)}
                  style={{
                    width: `${currentPreset.width}px`,
                    height: `${currentPreset.height}px`
                  }}
                  className="border-0 bg-slate-950 block"
                  sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
                  onLoad={handleIframeLoad}
                />
              </div>

              {/* Interactive Visual Inspection Overlay */}
              {isInspectMode && (
                <div
                  className="absolute inset-0 z-30 cursor-crosshair bg-violet-600/10 border-2 border-dashed border-violet-500/50 flex items-start justify-center p-3"
                  data-testid="visual-inspect-overlay"
                  onClick={handleOverlayClick}
                >
                  <div className="bg-violet-950/90 text-violet-200 px-3 py-1.5 rounded-full border border-violet-500/40 text-xs font-medium shadow-xl flex items-center gap-2 pointer-events-none">
                    <MousePointer className="w-3.5 h-3.5 animate-bounce text-violet-400" />
                    <span>Click any element in preview to edit visually</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 max-w-sm space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-violet-600/10 border border-violet-500/20 text-violet-400 flex items-center justify-center">
                <Laptop className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  {activeProjectId ? 'Live WebContainer Sandbox' : 'No Project Active'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {activeProjectId 
                    ? 'The application runtime is ready to mount and run project files.' 
                    : 'Create or select a project to start preview.'}
                </p>
              </div>

              <button
                onClick={() => activeProjectId && mountAndStartProject(activeProjectId)}
                disabled={!activeProjectId || status === 'running' || status === 'booting'}
                className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-lg shadow-violet-600/20 transition disabled:opacity-50 cursor-pointer"
              >
                {status === 'running' || status === 'booting' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Booting Runtime...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start Dev Server</span>
                  </>
                )}
              </button>

              {/* In offline/sandbox mode when inspecting without active iframe */}
              {isInspectMode && (
                <div 
                  className="mt-4 p-3 bg-violet-950/60 border border-violet-500/30 rounded-xl cursor-pointer hover:bg-violet-900/60 text-xs text-violet-200 flex items-center gap-2 shadow-lg"
                  data-testid="visual-inspect-overlay"
                  onClick={handleOverlayClick}
                >
                  <MousePointer className="w-4 h-4 text-violet-400 animate-pulse" />
                  <span>Click here to select sample preview component</span>
                </div>
              )}
            </div>
          )}

          {/* Floating Contextual Card for Selected Element */}
          {currentSelection && (
            <div 
              className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-[calc(100%-32px)] max-w-[340px] bg-[#111827]/95 backdrop-blur-md border border-violet-500/30 rounded-2xl p-3.5 sm:p-4 shadow-2xl space-y-3 ring-1 ring-white/10 animate-in fade-in slide-in-from-bottom-2"
              data-testid="visual-element-context-card"
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-violet-600/20 text-violet-300 border border-violet-500/30 shrink-0">
                    &lt;{currentSelection.tagName}&gt;
                  </span>
                  <span 
                    className="text-[11px] font-mono text-slate-300 truncate" 
                    title={currentSelection.sourceMapping.filePath}
                    data-testid="visual-mapped-file"
                  >
                    {currentSelection.sourceMapping.filePath.split('/').pop()}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span 
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border ${
                      currentSelection.sourceMapping.confidence >= 0.70
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : currentSelection.sourceMapping.confidence >= 0.40
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}
                    data-testid="visual-confidence-badge"
                  >
                    {Math.round(currentSelection.sourceMapping.confidence * 100)}%
                  </span>

                  <button
                    onClick={() => activeProjectId && clearSelection(activeProjectId)}
                    className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                    title="Deselect"
                    aria-label="Deselect element"
                    data-testid="visual-card-close-btn"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Low confidence warning & refusal */}
              {currentSelection.sourceMapping.confidence < 0.40 && (
                <div 
                  className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 flex items-center gap-1.5 font-medium"
                  data-testid="visual-low-confidence-warning"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  <span>Low confidence mapping (&lt; 40%) — manual file selection required.</span>
                </div>
              )}

              {/* Quick Edit Input Form */}
              <form onSubmit={handleGenerateEdit} className="space-y-2.5">
                <input
                  type="text"
                  value={quickPrompt}
                  onChange={(e) => setQuickPrompt(e.target.value)}
                  placeholder="Describe change (e.g. Make button blue, larger...)"
                  disabled={isSynthesizing || currentSelection.sourceMapping.confidence < 0.40}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 disabled:opacity-50"
                  data-testid="visual-edit-prompt-input"
                />

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleOpenInEditor}
                    className="text-[11px] text-slate-400 hover:text-violet-300 transition flex items-center gap-1 cursor-pointer"
                    data-testid="visual-open-in-chat-btn"
                  >
                    <FileCode className="w-3 h-3" />
                    <span>Open File</span>
                  </button>

                  <button
                    type="submit"
                    disabled={!quickPrompt.trim() || isSynthesizing || currentSelection.sourceMapping.confidence < 0.40}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/30 transition disabled:opacity-40 cursor-pointer"
                    data-testid="visual-generate-edit-btn"
                  >
                    {isSynthesizing ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Generate Edit</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {errorMsg && (
                <p className="text-[10px] text-rose-400">{errorMsg}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};
