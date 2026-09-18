import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Layers, 
  Plus, 
  ChevronDown, 
  CheckCircle2, 
  Trash2, 
  Upload, 
  Download, 
  Play, 
  RefreshCw, 
  Bug, 
  Copy, 
  Pencil, 
  Github, 
  Boxes 
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { snapshotService } from '../../lib/snapshots/SnapshotService';
import { createProjectZip } from '../../lib/export/project-exporter';
import { saveAs } from 'file-saver';
import { ProjectWorkspace } from '../../types/workspace';
import { apiRequest } from '../../lib/api';
import { ImportProjectModal } from '../modals/ImportProjectModal';
import { DeleteProjectModal } from '../modals/DeleteProjectModal';
import { RenameProjectModal } from '../modals/RenameProjectModal';
import { GitHubImportModal } from '../modals/GitHubImportModal';

interface TopNavbarProps {
  onOpenFaultModal: () => void;
  onOpenCommandPalette: () => void;
  onOpenHistory?: () => void;
  onOpenAICommand?: () => void;
  onNavigateActivity?: (activity: 'build' | 'edit' | 'run' | 'debug' | 'data' | 'ship') => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  onOpenFaultModal,
  onOpenCommandPalette,
  onOpenHistory,
  onOpenAICommand,
  onNavigateActivity
}) => {
  const { 
    projects, 
    activeProjectId, 
    createProject, 
    switchProject, 
    duplicateProject 
  } = useProjectStore();

  const { 
    status: runtimeStatus, 
    previewPort, 
    mountAndStartProject, 
    addTerminalLog 
  } = useRuntimeStore();

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [newProjectInput, setNewProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<ProjectWorkspace | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [projectToRename, setProjectToRename] = useState<ProjectWorkspace | null>(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [duplicatingProjectId, setDuplicatingProjectId] = useState<string | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setProjectMenuOpen(false);
        setNewProjectInput(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectMenuOpen(false);
        setNewProjectInput(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [projectMenuOpen]);

  const [aiStatus, setAiStatus] = useState<{ provider: string; model: string; configured: boolean }>({
    provider: 'Google Gemini',
    model: 'gemini-2.5-flash',
    configured: false
  });

  useEffect(() => {
    apiRequest('/api/health')
      .then((data: any) => {
        if (data?.ai) {
          setAiStatus({
            provider: 'Google Gemini',
            model: data.ai.model || 'gemini-2.5-flash',
            configured: !!data.ai.configured
          });
        }
      })
      .catch(() => {});
  }, []);

  const activeProject = projects[activeProjectId];
  const snapshots = snapshotService.listSnapshots(activeProjectId);

  const handleCreateProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    const id = createProject(newProjectName.trim());
    setNewProjectName('');
    setNewProjectInput(false);
    setProjectMenuOpen(false);
    addTerminalLog(`\x1b[32m[Project Created]\x1b[0m Initialized new project '${id}'`);
    if (id && onNavigateActivity) {
      onNavigateActivity('edit');
    }
  };

  const handleDuplicateProject = async (proj: ProjectWorkspace) => {
    if (duplicatingProjectId) return;
    setDuplicatingProjectId(proj.id);
    addTerminalLog(`\x1b[36m[Project Duplicate]\x1b[0m Duplicating '${proj.title}'...`);
    try {
      const newId = await duplicateProject(proj.id);
      addTerminalLog(`\x1b[32m[Project Duplicated]\x1b[0m Successfully created duplicate project '${newId}'`);
      if (newId && onNavigateActivity) {
        onNavigateActivity('edit');
      }
    } catch (err: any) {
      addTerminalLog(`\x1b[31m[Duplicate Error]\x1b[0m Failed to duplicate project: ${err?.message || err}`);
    } finally {
      setDuplicatingProjectId(null);
    }
  };

  const handleExportZip = async () => {
    if (!activeProject) return;
    addTerminalLog(`\x1b[36m[Export]\x1b[0m Packaging ${activeProject.title} source files from VFS into ZIP...`);
    try {
      const zip = await createProjectZip({
        projectId: activeProjectId,
        projectTitle: activeProject.title,
        projectDescription: activeProject.description
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const filename = `${activeProject.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'project'}.zip`;
      saveAs(blob, filename);
      addTerminalLog(`\x1b[32m[Export Complete]\x1b[0m Successfully downloaded ${filename}`);
    } catch (err: any) {
      addTerminalLog(`\x1b[31m[Export Error]\x1b[0m Failed to export project: ${err?.message || err}`);
    }
  };

  return (
    <header className="h-14 border-b border-white/5 bg-[#0B0F17]/95 backdrop-blur-md px-4 flex items-center justify-between select-none z-30 shrink-0 gap-3">
      {/* LEFT: Brand Logo & Project Context Selector */}
      <div data-testid="nav-left-group" className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20 ring-1 ring-white/20 shrink-0">
            <Boxes className="w-4 h-4 text-white" />
          </div>
          <div className="hidden sm:block">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-slate-100 tracking-tight font-sans">SnapDeploy</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-300 font-semibold border border-violet-500/30">
                AI STUDIO
              </span>
            </div>
          </div>
        </div>

        <div className="h-4 w-px bg-white/10 hidden sm:block" />

        {/* Project Context Menu Dropdown */}
        <div className="relative" ref={projectDropdownRef}>
          <button
            data-testid="project-dropdown-trigger"
            onClick={() => setProjectMenuOpen(!projectMenuOpen)}
            title={activeProject?.title}
            aria-label="Select or manage active project"
            className="flex items-center justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#111827] border border-white/10 hover:border-white/20 text-xs font-medium text-slate-200 transition max-w-[130px] xs:max-w-[170px] sm:max-w-[220px] md:max-w-[260px]"
          >
            <div className="flex items-center gap-2 truncate">
              <Layers className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="truncate">{activeProject?.title || 'Select Project'}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {projectMenuOpen && (
            <div data-testid="project-dropdown-menu" className="absolute top-full mt-1.5 left-0 w-80 bg-[#111827] border border-white/10 rounded-xl shadow-2xl p-2 z-50 animate-in fade-in space-y-1">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                <span>Projects ({Object.keys(projects).length})</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      setIsImportModalOpen(true);
                    }}
                    className="text-violet-400 hover:text-violet-300 flex items-center gap-1"
                    title="Import project from .zip"
                    data-testid="dropdown-import-btn"
                  >
                    <Upload className="w-3 h-3" /> Import
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      setIsGitHubModalOpen(true);
                    }}
                    className="text-violet-400 hover:text-violet-300 flex items-center gap-1"
                    title="Import project from GitHub"
                    data-testid="dropdown-github-btn"
                  >
                    <Github className="w-3 h-3" /> GitHub
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewProjectInput(true)}
                    className="text-violet-400 hover:text-violet-300 flex items-center gap-1"
                    data-testid="dropdown-new-btn"
                  >
                    <Plus className="w-3 h-3" /> New
                  </button>
                </div>
              </div>

              {newProjectInput && (
                <form onSubmit={handleCreateProjectSubmit} className="p-2 bg-[#0B0F17] rounded-lg border border-violet-500/30 space-y-2 mt-1">
                  <input
                    type="text"
                    placeholder="Project name..."
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    autoFocus
                    data-testid="new-project-input"
                    className="w-full bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
                  />
                  <div className="flex items-center justify-end gap-2 pt-0.5">
                    <button
                      type="button"
                      data-testid="cancel-new-project-btn"
                      onClick={() => {
                        setNewProjectInput(false);
                        setNewProjectName('');
                      }}
                      className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="create-new-project-btn"
                      disabled={!newProjectName.trim()}
                      className="px-3 py-1 rounded-md text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm cursor-pointer"
                    >
                      Create Project
                    </button>
                  </div>
                </form>
              )}

              <div className="max-h-60 overflow-y-auto space-y-0.5 custom-scrollbar">
                {Object.values(projects).length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-500">
                    No projects available. Click + New to create one.
                  </div>
                ) : (
                  Object.values(projects).map((proj) => (
                    <div
                      key={proj.id}
                      data-testid={`project-row-${proj.id}`}
                      data-project-title={proj.title}
                      onClick={async () => {
                        setProjectMenuOpen(false);
                        await switchProject(proj.id);
                        if (onNavigateActivity) {
                          onNavigateActivity('edit');
                        }
                      }}
                      className={`w-full text-left p-1.5 px-2 rounded-lg text-xs transition flex items-center justify-between group cursor-pointer ${
                        proj.id === activeProjectId
                          ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30 font-semibold'
                          : 'hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`select-project-${proj.id}`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setProjectMenuOpen(false);
                          await switchProject(proj.id);
                          if (onNavigateActivity) {
                            onNavigateActivity('edit');
                          }
                        }}
                        className="flex-1 text-left truncate mr-2 flex items-center justify-between py-0.5 cursor-pointer"
                      >
                        <div className="truncate">
                          <div className="font-medium text-slate-200 truncate">{proj.title}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {Object.keys(proj.files).length} files &bull; {proj.badge}
                          </div>
                        </div>
                        {proj.id === activeProjectId && (
                          <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0 ml-2" />
                        )}
                      </button>

                      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition">
                        <button
                          type="button"
                          title={`Duplicate ${proj.title}`}
                          aria-label={`Duplicate project ${proj.title}`}
                          data-testid={`duplicate-project-${proj.id}`}
                          disabled={duplicatingProjectId === proj.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            await handleDuplicateProject(proj);
                          }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-violet-400 hover:bg-violet-500/20 transition disabled:opacity-40"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          title={`Rename ${proj.title}`}
                          aria-label={`Rename project ${proj.title}`}
                          data-testid={`rename-project-${proj.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToRename(proj);
                            setIsRenameModalOpen(true);
                            setProjectMenuOpen(false);
                          }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 hover:bg-amber-500/20 transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          title={`Delete ${proj.title}`}
                          aria-label={`Delete project ${proj.title}`}
                          data-testid={`delete-project-${proj.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToDelete(proj);
                            setIsDeleteModalOpen(true);
                            setProjectMenuOpen(false);
                          }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/20 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Quick Actions Footer inside Project Menu */}
              <div className="pt-1.5 border-t border-white/5 flex items-center justify-between text-[11px] px-1">
                <button
                  type="button"
                  onClick={() => {
                    setProjectMenuOpen(false);
                    handleExportZip();
                  }}
                  className="text-slate-400 hover:text-white flex items-center gap-1 py-1"
                >
                  <Download className="w-3 h-3" /> Export ZIP
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProjectMenuOpen(false);
                    onOpenFaultModal();
                  }}
                  className="text-rose-400 hover:text-rose-300 flex items-center gap-1 py-1"
                  title="Developer tool: Inject controlled faults"
                >
                  <Bug className="w-3 h-3" /> Fault Injector
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. CENTER: Dedicated Command Palette */}
      <div data-testid="nav-center-group" className="flex-1 min-w-0 max-w-[200px] xs:max-w-[240px] sm:max-w-xs md:max-w-sm lg:max-w-md mx-1 sm:mx-2 flex items-center">
        <button
          onClick={() => {
            if (onOpenAICommand) onOpenAICommand();
            else onOpenCommandPalette();
          }}
          data-testid="nav-command-palette-btn"
          className="w-full flex items-center justify-between px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#111827] hover:bg-slate-800 border border-white/10 hover:border-violet-500/40 text-xs text-slate-400 hover:text-slate-200 transition shadow-inner group cursor-pointer"
          aria-label="Open Command Palette (Cmd+K)"
          title="Open Command Palette (Cmd+K)"
        >
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 truncate mr-1.5 sm:mr-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-400 group-hover:scale-110 transition-transform shrink-0" />
            <span className="text-slate-300 truncate hidden lg:inline">Ask SnapDeploy to build or change something...</span>
            <span className="text-slate-300 truncate hidden sm:inline lg:hidden">Ask SnapDeploy...</span>
            <span className="text-slate-300 truncate sm:hidden">Ask AI...</span>
          </div>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0B0F17] text-slate-400 border border-white/10 shrink-0">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* 3. AI STATUS: Telemetry & Runtime Status */}
      <div data-testid="nav-ai-status-group" className="hidden lg:flex items-center gap-2 shrink-0">
        {/* Compact Live Status Badge (preserving 'Google Gemini' text for E2E) */}
        <div data-testid="nav-gemini-status" className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#111827] border border-white/5 text-xs font-mono text-slate-400 shrink-0 select-text">
          <span className={`w-2 h-2 rounded-full ${aiStatus.configured ? 'bg-violet-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-violet-300 font-semibold">{aiStatus.provider}</span>
          <span className="text-slate-500">&bull;</span>
          <span className="text-[11px] text-slate-300">{aiStatus.model}</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${aiStatus.configured ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
            {aiStatus.configured ? 'Live' : 'No Key'}
          </span>
        </div>

        {/* Compact Runtime Port Badge (preserving 'Runtime: Port' text for E2E) */}
        <div data-testid="nav-runtime-badge" className="hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#111827] border border-white/5 text-xs font-mono text-slate-400 shrink-0 select-text">
          <span className={`w-2 h-2 rounded-full ${runtimeStatus === 'ready' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          <span>Runtime: {runtimeStatus === 'ready' ? `Port ${previewPort || 3000}` : runtimeStatus}</span>
        </div>
      </div>

      {/* 4. RIGHT: Primary Action CTA (Run Dev) */}
      <div data-testid="nav-right-group" className="flex items-center gap-2 shrink-0">
        {/* Start Dev Server / Run CTA */}
        <button
          onClick={() => mountAndStartProject(activeProjectId)}
          disabled={runtimeStatus === 'running' || runtimeStatus === 'booting'}
          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-emerald-500 hover:brightness-110 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition disabled:opacity-50 cursor-pointer"
          title="Start Live Application Preview"
          aria-label="Run Dev Server"
          data-testid="nav-run-dev-btn"
        >
          {runtimeStatus === 'running' || runtimeStatus === 'booting' ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span className="hidden xs:inline">Booting...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span className="hidden xs:inline">Run Dev</span>
            </>
          )}
        </button>
      </div>

      {/* Project Modals Mounted from TopNavbar */}
      <ImportProjectModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={() => {
          if (onNavigateActivity) {
            onNavigateActivity('edit');
          }
        }}
      />

      <GitHubImportModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        onImportSuccess={() => {
          if (onNavigateActivity) {
            onNavigateActivity('edit');
          }
        }}
      />

      <DeleteProjectModal
        project={projectToDelete}
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setProjectToDelete(null);
        }}
        onSuccess={() => {
          if (onNavigateActivity) {
            onNavigateActivity('edit');
          }
        }}
      />

      <RenameProjectModal
        project={projectToRename}
        isOpen={isRenameModalOpen}
        onClose={() => {
          setIsRenameModalOpen(false);
          setProjectToRename(null);
        }}
      />
    </header>
  );
};
