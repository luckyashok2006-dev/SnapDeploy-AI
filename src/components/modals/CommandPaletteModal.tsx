import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Search, 
  Layers, 
  FileCode, 
  Terminal, 
  Sparkles, 
  Wrench, 
  ShieldCheck, 
  RotateCcw, 
  Download, 
  Play, 
  Bug,
  ArrowLeft,
  X
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useAgentStore } from '../../store/agentStore';
import { snapshotService } from '../../lib/snapshots/SnapshotService';
import { repairLoopEngine } from '../../features/repair/repair-loop';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFaultModal: () => void;
  onNavigateActivity?: (activity: 'build' | 'edit' | 'run' | 'debug' | 'data' | 'ship') => void;
  onOpenHistory?: () => void;
}

interface PaletteItem {
  id: string;
  title: string;
  category: 'Projects' | 'Runtime' | 'AI & Diagnostics' | 'Files' | 'VFS';
  icon: any;
  shortcut?: string;
  handler: () => void | Promise<void>;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({ 
  isOpen, 
  onClose,
  onOpenFaultModal,
  onNavigateActivity,
  onOpenHistory
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { projects, activeProjectId, setActiveProjectId } = useProjectStore();
  const { openFile } = useEditorStore();
  const { 
    mountAndStartProject, 
    runBuild, 
    runTypeScriptCheck, 
    clearTerminalLogs, 
    lastEvidence, 
    addTerminalLog,
    setIsBottomDrawerOpen,
    setActiveBottomTab
  } = useRuntimeStore();
  const { setDiagnosis, setPendingPatch, setIsDiffModalOpen, pendingPatch } = useAgentStore();

  const currentProject = projects[activeProjectId];
  const filesList = currentProject ? Object.values(currentProject.files) : [];

  const baseActions: PaletteItem[] = [
    {
      id: 'act-run-dev',
      title: 'Runtime: Start WebContainer Dev Server',
      category: 'Runtime',
      icon: Play,
      handler: async () => {
        onNavigateActivity?.('run');
        setIsBottomDrawerOpen(true);
        setActiveBottomTab('terminal');
        await mountAndStartProject(activeProjectId);
      }
    },
    {
      id: 'act-build',
      title: 'Runtime: Run Production Build (`npm run build`)',
      category: 'Runtime',
      icon: Terminal,
      handler: async () => {
        onNavigateActivity?.('debug');
        setIsBottomDrawerOpen(true);
        setActiveBottomTab('terminal');
        addTerminalLog(`\x1b[36m[Build]\x1b[0m Running production build (npm run build)...`);
        await runBuild();
      }
    },
    {
      id: 'act-tsc',
      title: 'Runtime: Run TypeScript Strict Check (`npx tsc --noEmit`)',
      category: 'Runtime',
      icon: ShieldCheck,
      handler: async () => {
        onNavigateActivity?.('debug');
        setIsBottomDrawerOpen(true);
        setActiveBottomTab('terminal');
        addTerminalLog(`\x1b[36m[TypeCheck]\x1b[0m Running TypeScript strict check (npx tsc --noEmit)...`);
        await runTypeScriptCheck();
      }
    },
    {
      id: 'act-diagnose',
      title: 'AI: Diagnose Latest Execution Failure',
      category: 'AI & Diagnostics',
      icon: Sparkles,
      handler: async () => {
        onNavigateActivity?.('debug');
        setIsBottomDrawerOpen(true);
        setActiveBottomTab('diagnostics');
        if (!lastEvidence) {
          addTerminalLog('\x1b[33m[Diagnostics]\x1b[0m No execution failure captured yet. Run a command or check to capture telemetry.');
          return;
        }
        addTerminalLog(`\x1b[35m[AI Diagnostics]\x1b[0m Diagnosing latest failure for project '${activeProjectId}'...`);
        const { diagnosis, patch } = await repairLoopEngine.runDiagnosisAndPatch(activeProjectId, lastEvidence);
        setDiagnosis(diagnosis, activeProjectId);
        setPendingPatch(patch, activeProjectId);
      }
    },
    {
      id: 'act-diff',
      title: 'AI: Open AI Repair Diff Review',
      category: 'AI & Diagnostics',
      icon: Wrench,
      handler: () => {
        const patch = useAgentStore.getState().getPendingPatch(activeProjectId) || pendingPatch;
        if (patch) {
          setPendingPatch(patch, activeProjectId, true);
          setIsDiffModalOpen(true);
        } else {
          addTerminalLog('\x1b[33m[AI Repair]\x1b[0m No active repair proposal to review. Run diagnostics from the Debug tab to generate a fix.');
          onNavigateActivity?.('debug');
          setIsBottomDrawerOpen(true);
          setActiveBottomTab('diagnostics');
        }
      }
    },
    {
      id: 'act-rollback',
      title: 'VFS: Restore Last Stable Checkpoint',
      category: 'VFS',
      icon: RotateCcw,
      handler: async () => {
        onOpenHistory?.();
        await snapshotService.restoreSnapshot(activeProjectId);
        addTerminalLog('\x1b[32m[VFS Restore]\x1b[0m Restored last stable checkpoint.');
      }
    },
    {
      id: 'act-export',
      title: 'Export: Download Active Project as .ZIP',
      category: 'Projects',
      icon: Download,
      handler: async () => {
        if (!currentProject) return;
        addTerminalLog(`\x1b[36m[Export]\x1b[0m Downloading ${currentProject.title} as ZIP...`);
        const zip = new JSZip();
        const folder = zip.folder(currentProject.id) || zip;
        for (const file of Object.values(currentProject.files)) {
          folder.file(file.path.replace(/^\//, ''), file.content);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `${currentProject.id}.zip`);
        addTerminalLog(`\x1b[32m[Export Complete]\x1b[0m Successfully downloaded ${currentProject.id}.zip`);
      }
    },
    {
      id: 'act-inject-fault',
      title: 'DevTools: Inject Controlled Error to Test Repair',
      category: 'AI & Diagnostics',
      icon: Bug,
      handler: () => {
        onNavigateActivity?.('debug');
        onOpenFaultModal();
      }
    },
    {
      id: 'act-clear-term',
      title: 'Terminal: Clear Terminal Buffer',
      category: 'Runtime',
      icon: Terminal,
      handler: () => {
        setIsBottomDrawerOpen(true);
        setActiveBottomTab('terminal');
        clearTerminalLogs();
      }
    }
  ];

  // Dynamic file list items
  const fileItems: PaletteItem[] = filesList.map((f) => ({
    id: `file_${f.path}`,
    title: `File: ${f.path}`,
    category: 'Files',
    icon: FileCode,
    handler: () => openFile(activeProjectId, f.path)
  }));

  // Dynamic project list items
  const projectItems: PaletteItem[] = Object.values(projects)
    .filter((p) => p.id !== activeProjectId)
    .map((p) => ({
      id: `proj_${p.id}`,
      title: `Switch Project: ${p.title}`,
      category: 'Projects',
      icon: Layers,
      handler: () => {
        setActiveProjectId(p.id);
        onNavigateActivity?.('edit');
      }
    }));

  const allItems = [...baseActions, ...projectItems, ...fileItems];
  const categories: PaletteItem['category'][] = ['Runtime', 'AI & Diagnostics', 'Projects', 'Files', 'VFS'];

  const itemsToFilter = selectedCategory
    ? allItems.filter((item) => item.category === selectedCategory)
    : allItems;

  const filteredItems = itemsToFilter.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.category.toLowerCase().includes(query.toLowerCase())
  );

  const selectedCategoryRef = useRef(selectedCategory);
  selectedCategoryRef.current = selectedCategory;

  useEffect(() => {
    if (isOpen) {
      const previouslyFocused = document.activeElement as HTMLElement | null;
      setQuery('');
      setSelectedIndex(0);
      setSelectedCategory(null);
      setTimeout(() => inputRef.current?.focus(), 40);

      return () => {
        if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
          setTimeout(() => previouslyFocused.focus(), 20);
        }
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedCategoryRef.current) {
          setSelectedCategory(null);
          setQuery('');
          setSelectedIndex(0);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isOpen, onClose]);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredItems.length > 0 ? (prev + 1) % filteredItems.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredItems.length > 0 ? (prev - 1 + filteredItems.length) % filteredItems.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filteredItems[selectedIndex];
      if (item) {
        onClose();
        await item.handler();
      }
    } else if (e.key === 'Escape') {
      if (selectedCategory) {
        setSelectedCategory(null);
        setQuery('');
        setSelectedIndex(0);
      } else {
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div 
      data-testid="command-palette-modal" 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto z-50 select-none animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div 
        className="bg-[#111827] border border-white/10 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[min(85vh,calc(100dvh-2.5rem))] ring-1 ring-white/5"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="h-14 px-4 border-b border-white/5 flex items-center gap-3 bg-[#0B0F17]/60 shrink-0">
          {selectedCategory ? (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(null);
                setQuery('');
                setSelectedIndex(0);
              }}
              data-testid="palette-back-btn"
              aria-label="Back to all commands"
              className="flex items-center gap-1.5 px-2.5 py-1 -ml-1 rounded-lg text-xs font-semibold text-violet-300 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <Search className="w-5 h-5 text-violet-400 shrink-0" />
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            data-testid="command-palette-input"
            placeholder={
              selectedCategory
                ? `Filter within ${selectedCategory}...`
                : "Type command, file, or action (e.g. 'App.tsx', 'Run Dev', 'Diagnose')..."
            }
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />

          <div className="flex items-center gap-2 shrink-0">
            <kbd className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#0B0F17] text-slate-400 border border-white/10 hidden sm:inline">
              ESC
            </kbd>
            <button
              type="button"
              onClick={onClose}
              data-testid="palette-close-btn"
              aria-label="Close command palette"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Category Filter Pills (when in root view) */}
        {!selectedCategory && (
          <div className="px-4 py-1.5 border-b border-white/5 bg-[#0B0F17]/30 flex items-center gap-1.5 overflow-x-auto custom-scrollbar text-[11px] shrink-0">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-1 shrink-0">Filter:</span>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                data-testid={`category-filter-${cat.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                onClick={() => {
                  setSelectedCategory(cat);
                  setQuery('');
                  setSelectedIndex(0);
                }}
                className="px-2 py-0.5 rounded-md font-mono text-[10px] bg-slate-800/80 hover:bg-violet-600/30 text-slate-400 hover:text-violet-300 border border-white/5 transition shrink-0 cursor-pointer"
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-0.5 custom-scrollbar flex-1 min-h-0">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              No matching actions found for "{query}"
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = selectedIndex === idx;

              return (
                <button
                  key={item.id}
                  data-testid={`palette-item-${item.id}`}
                  onClick={async () => {
                    onClose();
                    await item.handler();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition flex items-center justify-between text-xs font-medium cursor-pointer ${
                    isSelected
                      ? 'bg-violet-600/20 text-violet-200 border-l-2 border-violet-500 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <div className={`p-1.5 rounded-lg ${isSelected ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="truncate">{item.title}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCategory(item.category);
                        setQuery('');
                        setSelectedIndex(0);
                      }}
                      title={`Filter by ${item.category}`}
                      aria-label={`Filter by category ${item.category}`}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0B0F17] hover:bg-violet-500/20 hover:text-violet-300 text-slate-400 border border-white/5 transition cursor-pointer"
                    >
                      {item.category}
                    </button>
                    {item.shortcut && (
                      <span className="text-[10px] font-mono text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="h-9 px-4 bg-slate-950 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500 font-mono shrink-0">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Execute</span>
            <span>ESC {selectedCategory ? 'Back' : 'Dismiss'}</span>
          </div>
          <span className="text-violet-400 font-semibold">SnapDeploy AI MVP</span>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
