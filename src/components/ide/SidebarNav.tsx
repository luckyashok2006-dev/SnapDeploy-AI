import React from 'react';
import { 
  Sparkles, 
  Code2,
  Play,
  Bug,
  Database,
  Rocket,
  Terminal,
  FolderTree,
  History,
  Bot
} from 'lucide-react';
import { useRuntimeStore } from '../../store/runtimeStore';

export type WorkspaceActivity = 'build' | 'edit' | 'run' | 'debug' | 'data' | 'ship';

interface SidebarNavProps {
  activeActivity: WorkspaceActivity;
  onSelectActivity: (activity: WorkspaceActivity) => void;
  onSelectEditSubView?: (view: 'chat' | 'files' | 'history') => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ 
  activeActivity, 
  onSelectActivity,
  onSelectEditSubView
}) => {
  const { isBottomDrawerOpen, lastEvidence, setActiveBottomTab, setIsBottomDrawerOpen, activeBottomTab } = useRuntimeStore();

  const hasFailure = lastEvidence && (lastEvidence.exitCode !== 0 || lastEvidence.timedOut);

  const handleConsoleClick = () => {
    if (!isBottomDrawerOpen) {
      setActiveBottomTab('terminal');
    } else if (activeBottomTab !== 'terminal') {
      setActiveBottomTab('terminal');
    } else {
      setIsBottomDrawerOpen(false);
    }
  };

  const navItems: {
    id: WorkspaceActivity;
    label: string;
    description: string;
    shortcut: string;
    icon: any;
    testId?: string;
  }[] = [
    {
      id: 'build',
      label: 'Build',
      description: 'AI Project Generator & Blueprints',
      shortcut: 'Alt+1',
      icon: Sparkles,
      testId: 'nav-tab-build'
    },
    {
      id: 'edit',
      label: 'Edit',
      description: 'AI Assistant, Files & Workspace',
      shortcut: 'Alt+2',
      icon: Code2,
      testId: 'nav-edit-tab'
    },
    {
      id: 'run',
      label: 'Run',
      description: 'Live Application Preview & Controls',
      shortcut: 'Alt+3',
      icon: Play,
      testId: 'nav-run-tab'
    },
    {
      id: 'debug',
      label: 'Debug',
      description: 'AI Diagnostics & Fault Recovery',
      shortcut: 'Alt+4',
      icon: Bug,
      testId: 'nav-debug-tab'
    },
    {
      id: 'data',
      label: 'Data',
      description: 'Environment Variables, Database & Auth',
      shortcut: 'Alt+5',
      icon: Database,
      testId: 'nav-data-tab'
    },
    {
      id: 'ship',
      label: 'Ship',
      description: 'Deployments & GitHub Publishing',
      shortcut: 'Alt+6',
      icon: Rocket,
      testId: 'nav-ship-tab'
    }
  ];

  return (
    <nav 
      aria-label="Primary Workspace Navigation"
      className="w-14 border-r border-white/5 bg-[#0B0F17] flex flex-col items-center py-3 shrink-0 select-none z-20"
    >
      {/* Primary 6 Job Activities */}
      <div className="flex flex-col items-center gap-1.5 w-full px-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeActivity === item.id;

          return (
            <button
              key={item.id}
              onClick={() => {
                onSelectActivity(item.id);
              }}
              className={`relative w-11 h-11 rounded-xl transition flex flex-col items-center justify-center group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17] ${
                isActive
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-[0_0_15px_rgba(139,92,246,0.25)] font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              }`}
              title={`${item.label} (${item.shortcut})`}
              aria-label={`${item.label} workspace`}
              aria-current={isActive ? 'page' : undefined}
              data-activity={item.id}
              data-testid={item.testId || `nav-${item.id}-tab`}
            >
              <Icon className="w-4 h-4 transition-transform group-hover:scale-110" />
              <span className={`text-[10px] tracking-tight mt-0.5 leading-none transition-colors ${
                isActive ? 'text-violet-200 font-semibold' : 'text-slate-400 group-hover:text-slate-200 font-medium'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* SYSTEM / UTILITY SECTION: Subtle Divider + Console Toggle */}
      <div className="mt-auto flex flex-col items-center w-full px-1.5 pt-2">
        <div className="w-8 h-px bg-white/10 mb-2.5 shrink-0" role="separator" aria-orientation="horizontal" />
        <button
          onClick={handleConsoleClick}
          data-testid="nav-console-toggle-btn"
          className={`relative w-11 h-11 rounded-xl transition flex flex-col items-center justify-center group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17] ${
            isBottomDrawerOpen
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              : hasFailure
              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 animate-pulse'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
          }`}
          title="Console"
          aria-label="Toggle Engineering Console"
          aria-expanded={isBottomDrawerOpen}
        >
          <Terminal className="w-4 h-4 transition-transform group-hover:scale-110" />
          <span className="text-[10px] font-medium tracking-tight mt-0.5 leading-none transition-colors group-hover:text-slate-200">
            Console
          </span>
        </button>
      </div>
    </nav>
  );
};
