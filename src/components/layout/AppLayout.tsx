import React, { useState, useEffect, useRef } from 'react';
import { TopNavbar } from '../navbar/TopNavbar';
import { SidebarNav, WorkspaceActivity } from '../ide/SidebarNav';
import { Sparkles, Code2, Play, Bug, Database, Rocket, Monitor, Bot } from 'lucide-react';
import { GenerationPanel } from '../../features/generation/GenerationPanel';
import { EditSubsystemPanel } from '../panels/EditSubsystemPanel';
import { RunSubsystemPanel } from '../panels/RunSubsystemPanel';
import { DebugManagerPanel } from '../panels/DebugManagerPanel';
import { DataManagerPanel } from '../panels/DataManagerPanel';
import { ShipManagerPanel } from '../panels/ShipManagerPanel';
import { EditorWorkspace } from '../editor/EditorWorkspace';
import { LivePreviewPane } from '../preview/LivePreviewPane';
import { WorkspaceBottomDrawer } from '../bottom-drawer/WorkspaceBottomDrawer';
import { CommandPaletteModal } from '../modals/CommandPaletteModal';
import { UnifiedDiffViewer } from '../refactor/UnifiedDiffViewer';
import { FaultInjectorModal } from '../../devtools/FaultInjectorModal';
import { GitHubImportModal } from '../modals/GitHubImportModal';
import { DeploymentModal } from '../modals/DeploymentModal';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ResizableDivider } from './ResizableDivider';
import { useProjectStore } from '../../store/projectStore';
import { useRuntimeStore } from '../../store/runtimeStore';

export const AppLayout: React.FC = () => {
  const { activeProjectId, projects } = useProjectStore();
  const currentProject = activeProjectId ? projects[activeProjectId] : null;
  const { 
    isBottomDrawerOpen, 
    setIsBottomDrawerOpen, 
    setActiveBottomTab,
    bottomDrawerHeight,
    setBottomDrawerHeight
  } = useRuntimeStore();

  const [activeActivity, setActiveActivity] = useState<WorkspaceActivity>(() => {
    try {
      const stored = localStorage.getItem('snapdeploy_active_activity');
      if (stored && ['build', 'edit', 'run', 'debug', 'data', 'ship'].includes(stored)) {
        if (stored !== 'build') {
          const { activeProjectId, projects } = useProjectStore.getState();
          if (!activeProjectId || !projects[activeProjectId]) {
            return 'build';
          }
        }
        return stored as WorkspaceActivity;
      }
    } catch {}
    return 'build';
  });

  useEffect(() => {
    try {
      localStorage.setItem('snapdeploy_active_activity', activeActivity);
    } catch {}
  }, [activeActivity]);

  const [editSubView, setEditSubView] = useState<'chat' | 'files' | 'history' | 'design'>('chat');
  const [sidebarWidth, setSidebarWidth] = useState<number>(360);
  const [mobileEditMode, setMobileEditMode] = useState<'code' | 'workspace'>('code');

  // Reset clean default subview to AI Assistant ('chat') on project switch
  const previousProjectIdRef = useRef<string | null>(activeProjectId);
  useEffect(() => {
    if (previousProjectIdRef.current !== activeProjectId) {
      previousProjectIdRef.current = activeProjectId;
      if (editSubView !== 'files') {
        setEditSubView('chat');
      }
    }
  }, [activeProjectId, editSubView]);


  const [previewWidth, setPreviewWidth] = useState<number>(460);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isFaultModalOpen, setIsFaultModalOpen] = useState<boolean>(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState<boolean>(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState<boolean>(false);
  const [constrainedPresentation, setConstrainedPresentation] = useState<'editor' | 'preview'>('editor');
  const [isResizingPreview, setIsResizingPreview] = useState<boolean>(false);

  // Responsive mode detection: desktop (>= 1024), tablet (768-1023), mobile (< 768)
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 900
  );

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = viewportWidth < 768;
  const isTablet = viewportWidth >= 768 && viewportWidth < 1024;
  const isIntermediate = viewportWidth >= 768 && viewportWidth < 1280;

  // Responsive layout protection:
  // - Protect a 500px editor minimum whenever the available layout allows it (viewport >= 1024px).
  // - When the viewport physically cannot provide 500px (e.g. tablet portrait 768px),
  //   give the editor the maximum available width and collapse/hide Preview.
  // - Never allow activity switching (BUILD, EDIT, RUN, DEBUG, DATA, SHIP) to cause
  //   a dramatically crushed editor (guaranteeing the editor never shrinks toward 356px or 106px).
  const MIN_USABLE_EDITOR_WIDTH = 500;
  const NAV_RAIL_WIDTH = isMobile ? 0 : 56;

  const effectiveSidebarWidth = isMobile
    ? '100%'
    : isIntermediate
    ? Math.min(sidebarWidth, 260)
    : viewportWidth < 1366
    ? Math.min(sidebarWidth, 310)
    : sidebarWidth;
  const isCompactSidebar = typeof effectiveSidebarWidth === 'number' && effectiveSidebarWidth <= 280;

  const currentSidebarPx = isSidebarCollapsed
    ? 0
    : typeof effectiveSidebarWidth === 'number'
    ? effectiveSidebarWidth
    : 260;

  const candidatePreviewWidth = isMobile
    ? 0
    : isTablet
    ? 340
    : isIntermediate
    ? Math.min(previewWidth, 340)
    : viewportWidth < 1366
    ? Math.min(previewWidth, 390)
    : previewWidth;

  const estimatedEditorWidthWithPreview =
    viewportWidth - NAV_RAIL_WIDTH - currentSidebarPx - candidatePreviewWidth - 8;

  const shouldCollapsePreview = !isMobile && estimatedEditorWidthWithPreview < MIN_USABLE_EDITOR_WIDTH;

  const effectivePreviewWidth = isMobile
    ? '100%'
    : isIntermediate
    ? Math.min(previewWidth, 340)
    : viewportWidth < 1366
    ? Math.min(previewWidth, 390)
    : previewWidth;

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }

      // Cmd+B / Ctrl+B to toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }

      // Alt+1 through Alt+6 for 6 primary job activities
      if (e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          setActiveActivity('build');
          setIsSidebarCollapsed(false);
        } else if (e.key === '2') {
          e.preventDefault();
          setActiveActivity('edit');
          setIsSidebarCollapsed(false);
        } else if (e.key === '3') {
          e.preventDefault();
          setActiveActivity('run');
          setIsSidebarCollapsed(false);
        } else if (e.key === '4') {
          e.preventDefault();
          setActiveActivity('debug');
          setIsSidebarCollapsed(false);
        } else if (e.key === '5') {
          e.preventDefault();
          setActiveActivity('data');
          setIsSidebarCollapsed(false);
        } else if (e.key === '6') {
          e.preventDefault();
          setActiveActivity('ship');
          setIsSidebarCollapsed(false);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    const handleOpenPaletteEvent = () => {
      setIsCommandPaletteOpen(true);
    };

    window.addEventListener('snapdeploy:open-command-palette', handleOpenPaletteEvent);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('snapdeploy:open-command-palette', handleOpenPaletteEvent);
    };
  }, []);

  const handleSidebarResize = (delta: number) => {
    if (isSidebarCollapsed) return;
    setSidebarWidth((prev) => Math.max(280, Math.min(600, prev + delta)));
  };

  const handlePreviewResize = (delta: number) => {
    setPreviewWidth((prev) => Math.max(320, Math.min(800, prev - delta)));
  };

  // EC-04: Manual vertical console resizing with 1:1 mouse movement, 120px floor, and absolute 50% viewport ceiling
  const handleConsoleResize = (delta: number) => {
    // Guardrail 4: Visual horizontal divider with vertical drag tracking (clientY).
    // Dragging upward (delta < 0) grows the console; dragging downward (delta > 0) shrinks it.
    const maxAllowed = Math.floor(viewportHeight * 0.5);
    const minAllowed = 120;
    const currentHeight = bottomDrawerHeight;
    const targetHeight = currentHeight - delta;
    const clampedHeight = Math.max(minAllowed, Math.min(maxAllowed, targetHeight));
    setBottomDrawerHeight(clampedHeight);
  };

  return (
    <ErrorBoundary fallbackTitle="SnapDeploy Studio Core Layout Error">
      <div className="h-screen w-screen flex flex-col bg-[#0B0F17] text-slate-50 overflow-hidden font-sans select-none">
        {/* Top Navbar */}
        <TopNavbar
          onOpenFaultModal={() => setIsFaultModalOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenHistory={() => {
            setActiveActivity('edit');
            setEditSubView('history');
            setIsSidebarCollapsed(false);
          }}
          onOpenAICommand={() => setIsCommandPaletteOpen(true)}
          onNavigateActivity={(act) => {
            setActiveActivity(act);
            setIsSidebarCollapsed(false);
          }}
        />

        {/* Master Workspace Split Area */}
        <main className={`flex-1 flex overflow-hidden ${isMobile ? 'pb-14' : ''}`}>
          {/* Main IDE Columns Area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Mobile Edit Subsystem Switcher (< 768px, activeActivity === 'edit') */}
            {isMobile && activeActivity === 'edit' && (
              <div 
                data-testid="mobile-edit-switcher"
                className="h-10 px-3 bg-slate-950/90 border-b border-white/10 flex items-center justify-between shrink-0 select-none z-30"
              >
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold">
                  <Code2 className="w-3.5 h-3.5 text-violet-400" />
                  <span>Edit</span>
                </div>
                <div 
                  role="tablist" 
                  aria-label="Mobile Edit workspace view switcher"
                  className="flex items-center bg-slate-900 border border-white/10 rounded-lg p-0.5"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobileEditMode === 'code'}
                    data-testid="mobile-edit-tab-code"
                    onClick={() => setMobileEditMode('code')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                      mobileEditMode === 'code'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Code2 className="w-3 h-3" />
                    <span>Code</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobileEditMode === 'workspace'}
                    data-testid="mobile-edit-tab-workspace"
                    onClick={() => setMobileEditMode('workspace')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                      mobileEditMode === 'workspace'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Bot className="w-3 h-3" />
                    <span>Workspace</span>
                  </button>
                </div>
              </div>
            )}

            {/* Top Row: Left Navigation Rail + Subsystem Pane + Resizer + Center Editor + Resizer + Right Preview */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Leftmost Navigation Rail (6 primary jobs) - Desktop/Tablet only */}
              {!isMobile && (
                <SidebarNav 
                  activeActivity={activeActivity} 
                  onSelectActivity={(activity) => {
                    setActiveActivity(activity);
                    setIsSidebarCollapsed(false);
                  }} 
                  onSelectEditSubView={(subView) => {
                    setEditSubView(subView);
                    setActiveActivity('edit');
                    setIsSidebarCollapsed(false);
                  }}
                />
              )}

              {/* Contextual Subsystem Pane (Changes based on Build, Edit, Run, Debug, Data, Ship) */}
              <aside
                aria-label="Contextual Subsystem Workspace"
                className={`border-r border-white/5 bg-[#111827]/40 flex flex-col overflow-hidden shrink-0 transition-all duration-300 ${
                  isSidebarCollapsed || (isMobile && (activeActivity === 'run' || (activeActivity === 'edit' && mobileEditMode === 'code')))
                    ? 'w-0 border-r-0' 
                    : ''
                }`}
                style={
                  !isSidebarCollapsed && !(isMobile && (activeActivity === 'run' || (activeActivity === 'edit' && mobileEditMode === 'code')))
                    ? { width: isMobile ? '100%' : `${effectiveSidebarWidth}px` } 
                    : undefined
                }
              >
                <ErrorBoundary fallbackTitle="Subsystem Activity Error">
                  {activeActivity === 'build' && (
                    <GenerationPanel onOpenProject={() => setActiveActivity('edit')} />
                  )}
                  {activeActivity === 'edit' && (
                    <EditSubsystemPanel 
                      activeSubView={editSubView} 
                      onSubViewChange={setEditSubView} 
                      isCompact={isCompactSidebar}
                    />
                  )}
                  {activeActivity === 'run' && <RunSubsystemPanel />}
                  {activeActivity === 'debug' && (
                    <DebugManagerPanel onOpenFaultModal={() => setIsFaultModalOpen(true)} />
                  )}
                  {activeActivity === 'data' && activeProjectId && (
                    <DataManagerPanel 
                      projectId={activeProjectId} 
                      projectTitle={currentProject?.title || activeProjectId} 
                    />
                  )}
                  {activeActivity === 'ship' && activeProjectId && (
                    <ShipManagerPanel 
                      projectId={activeProjectId} 
                      projectTitle={currentProject?.title || activeProjectId}
                      onOpenGitHubModal={() => setIsGitHubModalOpen(true)}
                      onOpenDeployModal={() => setIsDeployModalOpen(true)}
                    />
                  )}
                </ErrorBoundary>
              </aside>

              {/* Resizable Splitter between Sidebar and Editor (hidden on mobile or when sidebar collapsed) */}
              {!isSidebarCollapsed && !isMobile && (
                <ResizableDivider
                  orientation="horizontal"
                  onResize={handleSidebarResize}
                  className="border-white/5 hover:bg-violet-500/80"
                />
              )}

              {/* Center & Preview Region */}
              {shouldCollapsePreview ? (
                // LP-02: Constrained Viewport Mode — switches between Editor (with explicit recovery strip) and Preview (with reversible banner)
                constrainedPresentation === 'editor' ? (
                  <>
                    <section 
                      aria-label="Code Editor Workspace"
                      className="flex-1 flex flex-col min-w-0 bg-[#0B0F17] overflow-hidden"
                    >
                      <EditorWorkspace />
                    </section>

                    {/* LP-02: Explicit Preview Recovery Strip at Right Editor Boundary */}
                    <div 
                      data-testid="preview-recovery-strip"
                      className="flex flex-col items-center justify-start bg-slate-900 border-l border-white/10 px-1 py-3 shrink-0 select-none z-20 gap-2"
                    >
                      <button
                        onClick={() => setConstrainedPresentation('preview')}
                        data-testid="recover-preview-btn"
                        title="Preview is hidden to protect editor width. Click to show Live Preview."
                        aria-label="Show Live Preview"
                        className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          activeActivity === 'run'
                            ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/40 ring-1 ring-violet-400 animate-pulse'
                            : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-white/10'
                        }`}
                      >
                        <Monitor className="w-4 h-4" />
                        <span className="text-[10px] [writing-mode:vertical-rl] rotate-180 tracking-wider font-mono py-1">
                          {activeActivity === 'run' ? 'SHOW PREVIEW' : 'PREVIEW'}
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <section
                    aria-label="Live Application Preview"
                    className="flex-1 flex flex-col min-w-0 bg-[#0B0F17] overflow-hidden relative"
                  >
                    <div 
                      data-testid="preview-constrained-banner"
                      className="bg-slate-900/90 border-b border-white/10 px-3 py-1.5 flex items-center justify-between text-xs text-slate-300 shrink-0 select-none"
                    >
                      <span className="flex items-center gap-1.5 text-violet-300 font-medium">
                        <Monitor className="w-3.5 h-3.5 text-violet-400" />
                        <span>Preview Mode (Constrained Viewport)</span>
                      </span>
                      <button
                        onClick={() => setConstrainedPresentation('editor')}
                        data-testid="recover-editor-btn"
                        className="px-2.5 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer flex items-center gap-1.5"
                        title="Switch back to code editor"
                        aria-label="Show Code Editor"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Show Editor</span>
                      </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <ErrorBoundary fallbackTitle="Live Preview Error">
                        <LivePreviewPane isResizing={isResizingPreview} />
                      </ErrorBoundary>
                    </div>
                  </section>
                )
              ) : (
                // Unconstrained Viewport Mode: Editor and Preview coexist side-by-side
                <>
                  {(!isMobile || (activeActivity === 'edit' && mobileEditMode === 'code')) && (
                    <section 
                      aria-label="Code Editor Workspace"
                      className="flex-1 flex flex-col min-w-0 bg-[#0B0F17] overflow-hidden"
                    >
                      <EditorWorkspace />
                    </section>
                  )}

                  {!isMobile && !isTablet && (
                    <ResizableDivider
                      orientation="horizontal"
                      onResize={handlePreviewResize}
                      onDragStart={() => setIsResizingPreview(true)}
                      onDragEnd={() => setIsResizingPreview(false)}
                      className="border-white/5 hover:bg-violet-500/80"
                    />
                  )}

                  {(!isMobile || activeActivity === 'run') && (
                    <section
                      aria-label="Live Application Preview"
                      className={`border-l border-white/5 bg-[#111827]/40 flex flex-col shrink-0 overflow-hidden ${
                        isMobile ? 'flex-1 w-full border-l-0' : isTablet ? 'w-[340px]' : ''
                      }`}
                      style={!isMobile && !isTablet ? { width: `${effectivePreviewWidth}px` } : undefined}
                    >
                      <ErrorBoundary fallbackTitle="Live Preview Error">
                        <LivePreviewPane isResizing={isResizingPreview} />
                      </ErrorBoundary>
                    </section>
                  )}
                </>
              )}
            </div>

            {/* EC-04: Horizontal ResizableDivider between workspace and Engineering Console */}
            {isBottomDrawerOpen && (
              <ResizableDivider
                orientation="vertical"
                onResize={handleConsoleResize}
                className="border-white/5 hover:bg-violet-500/80 shrink-0"
              />
            )}

            {/* Bottom Row: Unified Collapsible Engineering Console (Terminal, Issues, Checks) */}
            <WorkspaceBottomDrawer />
          </div>
        </main>

        {/* Global Overlays & Modals */}
        <CommandPaletteModal
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onOpenFaultModal={() => setIsFaultModalOpen(true)}
          onNavigateActivity={(act) => {
            setActiveActivity(act);
            setIsSidebarCollapsed(false);
          }}
          onOpenHistory={() => {
            setActiveActivity('edit');
            setEditSubView('history');
            setIsSidebarCollapsed(false);
          }}
        />
        <UnifiedDiffViewer />
        <FaultInjectorModal
          isOpen={isFaultModalOpen}
          onClose={() => setIsFaultModalOpen(false)}
        />
        <GitHubImportModal
          isOpen={isGitHubModalOpen}
          onClose={() => setIsGitHubModalOpen(false)}
        />
        {isDeployModalOpen && activeProjectId && (
          <DeploymentModal
            isOpen={isDeployModalOpen}
            onClose={() => setIsDeployModalOpen(false)}
            projectId={activeProjectId}
          />
        )}
        {/* Mobile Bottom Navigation Bar (< 768px) - Replaces permanent 56px desktop rail */}
        {isMobile && (
          <nav
            aria-label="Mobile Workspace Navigation"
            className="fixed bottom-0 left-0 right-0 h-14 bg-[#0B0F17]/95 border-t border-white/10 backdrop-blur-md z-40 flex items-center justify-around px-1 select-none"
          >
            {[
              { id: 'build' as WorkspaceActivity, label: 'Build', icon: Sparkles, testId: 'nav-tab-build' },
              { id: 'edit' as WorkspaceActivity, label: 'Edit', icon: Code2, testId: 'nav-edit-tab' },
              { id: 'run' as WorkspaceActivity, label: 'Run', icon: Play, testId: 'nav-run-tab' },
              { id: 'debug' as WorkspaceActivity, label: 'Debug', icon: Bug, testId: 'nav-debug-tab' },
              { id: 'data' as WorkspaceActivity, label: 'Data', icon: Database, testId: 'nav-data-tab' },
              { id: 'ship' as WorkspaceActivity, label: 'Ship', icon: Rocket, testId: 'nav-ship-tab' },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeActivity === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveActivity(item.id);
                  }}
                  data-activity={item.id}
                  data-testid={item.testId || `nav-${item.id}-tab`}
                  aria-label={`${item.label} workspace`}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition ${
                    isActive
                      ? 'text-violet-400 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4 mb-0.5" />
                  <span className="text-[10px] tracking-tight">{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </ErrorBoundary>
  );
};
