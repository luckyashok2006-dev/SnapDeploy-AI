import React from 'react';
import { Play, RotateCw, Monitor, Tablet, Smartphone, ExternalLink, ShieldCheck, Terminal as TerminalIcon } from 'lucide-react';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useProjectStore } from '../../store/projectStore';

export const RunSubsystemPanel: React.FC = () => {
  const { 
    previewUrl, 
    previewPort, 
    status, 
    mountAndStartProject,
    setIsBottomDrawerOpen,
    setActiveBottomTab
  } = useRuntimeStore();
  const { activeProjectId } = useProjectStore();

  return (
    <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden">
      {/* Header */}
      <div className="h-11 px-3 border-b border-white/5 flex items-center justify-between bg-slate-950/60 shrink-0 gap-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Play className="w-3.5 h-3.5 fill-current" />
          </div>
          <span className="text-xs font-bold text-slate-100 uppercase tracking-wider font-sans">
            Live Preview Runtime
          </span>
        </div>

        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
          status === 'running'
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : status === 'booting'
            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 animate-pulse'
            : 'bg-slate-800 text-slate-400'
        }`}>
          {status}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
        {/* Connection Status Card */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Sandbox State</span>
            <span className="text-emerald-400 font-mono text-xs flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Isolated WebContainer</span>
            </span>
          </div>

          <div className="text-slate-300 space-y-1">
            <p>
              Local Port: <strong className="text-violet-300 font-mono">localhost:{previewPort || 3000}</strong>
            </p>
            <p className="text-[11px] text-slate-400">
              Files are mirrored directly from the authoritative Virtual File System (VFS).
            </p>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <button
              onClick={() => activeProjectId && mountAndStartProject(activeProjectId)}
              disabled={!activeProjectId || status === 'running' || status === 'booting'}
              className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{status === 'running' ? 'Server Active' : 'Start Server'}</span>
            </button>

            <button
              onClick={() => {
                setActiveBottomTab('terminal');
                setIsBottomDrawerOpen(true);
              }}
              className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5"
              title="Inspect WebContainer Terminal"
            >
              <TerminalIcon className="w-3.5 h-3.5" />
              <span>Logs</span>
            </button>
          </div>
        </div>

        {/* Viewport Info */}
        <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 space-y-2 text-slate-400 text-[11px]">
          <span className="text-slate-300 font-semibold block">Responsive Controls</span>
          <p>
            Toggle desktop, tablet, and mobile viewports directly in the right preview pane header to verify responsive layout styling.
          </p>
        </div>
      </div>
    </div>
  );
};
