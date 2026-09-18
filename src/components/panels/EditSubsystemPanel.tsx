import React, { useState } from 'react';
import { Bot, FolderTree, History, FileCode, Check, Palette } from 'lucide-react';
import { AIChatPanel } from '../chat/AIChatPanel';
import { FileExplorer } from '../ide/FileExplorer';
import { VersionHistoryPanel } from '../history/VersionHistoryPanel';
import { DesignSystemPanel } from '../design-system/DesignSystemPanel';
import { useProjectStore } from '../../store/projectStore';

interface EditSubsystemPanelProps {
  initialSubView?: 'chat' | 'files' | 'history' | 'design';
  activeSubView?: 'chat' | 'files' | 'history' | 'design';
  onSubViewChange?: (view: 'chat' | 'files' | 'history' | 'design') => void;
  isCompact?: boolean;
}

export const EditSubsystemPanel: React.FC<EditSubsystemPanelProps> = ({ 
  initialSubView = 'chat',
  activeSubView,
  onSubViewChange,
  isCompact: propIsCompact
}) => {
  const [internalSubView, setInternalSubView] = useState<'chat' | 'files' | 'history' | 'design'>(initialSubView);
  const subView = activeSubView !== undefined ? activeSubView : internalSubView;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [measuredCompact, setMeasuredCompact] = useState<boolean>(false);

  React.useEffect(() => {
    if (!containerRef.current || propIsCompact !== undefined) return;
    const el = containerRef.current;
    const checkWidth = () => {
      setMeasuredCompact(el.clientWidth > 0 && el.clientWidth <= 280);
    };
    checkWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(checkWidth);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [propIsCompact]);

  const isCompact = propIsCompact !== undefined ? propIsCompact : measuredCompact;

  const handleSubViewChange = (v: 'chat' | 'files' | 'history' | 'design') => {
    if (onSubViewChange) {
      onSubViewChange(v);
    } else {
      setInternalSubView(v);
    }
  };

  const { activeProjectId, projects } = useProjectStore();
  const currentProject = activeProjectId ? projects[activeProjectId] : null;

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden">
      {/* Sub-navigation pill row */}
      <div className={`h-11 border-b border-white/5 flex items-center justify-between bg-slate-950/60 shrink-0 gap-1 ${
        isCompact ? 'px-1.5' : 'px-3'
      }`}>
        <div 
          role="tablist" 
          aria-label="Edit workspace views" 
          className={`flex items-center min-w-0 ${
            isCompact ? 'w-full gap-1' : 'gap-1 overflow-x-auto'
          }`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={subView === 'chat'}
            title="AI Chat & Assistant"
            aria-label="AI Chat & Assistant"
            data-testid="nav-chat-tab"
            data-subview="chat"
            onClick={() => handleSubViewChange('chat')}
            className={`rounded-lg font-medium transition flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              isCompact 
                ? 'flex-1 min-w-0 justify-center px-1.5 py-1 text-[11px] gap-1' 
                : 'px-2.5 py-1.5 text-xs gap-1.5'
            } ${
              subView === 'chat'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="truncate">{isCompact ? 'AI' : 'AI Assistant'}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subView === 'files'}
            title="File Explorer"
            aria-label="File Explorer"
            data-testid="nav-files-tab"
            data-subview="files"
            onClick={() => handleSubViewChange('files')}
            className={`rounded-lg font-medium transition flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              isCompact 
                ? 'flex-1 min-w-0 justify-center px-1.5 py-1 text-[11px] gap-1' 
                : 'px-2.5 py-1.5 text-xs gap-1.5'
            } ${
              subView === 'files'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>Files</span>
            {currentProject && (
              <span className={`font-mono rounded bg-slate-800 text-slate-400 shrink-0 ${
                isCompact ? 'text-[9px] px-1 py-0.2 leading-none' : 'text-[10px] px-1 py-0.2'
              }`}>
                {Object.keys(currentProject.files).length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subView === 'history'}
            title="Version History & Snapshots"
            aria-label="Version History & Snapshots"
            data-testid="nav-history-tab"
            data-subview="history"
            onClick={() => handleSubViewChange('history')}
            className={`rounded-lg font-medium transition flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              isCompact 
                ? 'flex-1 min-w-0 justify-center px-1.5 py-1 text-[11px] gap-1' 
                : 'px-2.5 py-1.5 text-xs gap-1.5'
            } ${
              subView === 'history'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <History className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>History</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subView === 'design'}
            title="Design System & Tokens"
            aria-label="Design System & Tokens"
            data-testid="nav-design-system-tab"
            data-subview="design"
            onClick={() => handleSubViewChange('design')}
            className={`rounded-lg font-medium transition flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              isCompact 
                ? 'flex-1 min-w-0 justify-center px-1.5 py-1 text-[11px] gap-1' 
                : 'px-2.5 py-1.5 text-xs gap-1.5'
            } ${
              subView === 'design'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Palette className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Design</span>
          </button>
        </div>
      </div>

      {/* Content View */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {subView === 'chat' && <AIChatPanel />}
        {subView === 'files' && <FileExplorer />}
        {subView === 'history' && <VersionHistoryPanel onClose={() => handleSubViewChange('files')} />}
        {subView === 'design' && <DesignSystemPanel />}
      </div>
    </div>
  );
};
