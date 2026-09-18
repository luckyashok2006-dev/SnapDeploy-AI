import React from 'react';
import { Key, X } from 'lucide-react';
import { EnvironmentVariablesManager } from '../env/EnvironmentVariablesManager';

interface EnvironmentVariablesModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
}

export const EnvironmentVariablesModal: React.FC<EnvironmentVariablesModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectTitle
}) => {
  if (!isOpen || !projectId) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      data-testid="environment-variables-modal"
    >
      <div className="relative w-full max-w-2xl bg-[#0B0F17] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-[#111827]/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 text-violet-400 flex items-center justify-center border border-violet-500/30">
              <Key className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Environment Variables & Secrets
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-semibold">
                  PROJECT SCOPED
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Project: <span className="text-slate-200 font-medium">{projectTitle}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition"
            data-testid="env-modal-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          <EnvironmentVariablesManager projectId={projectId} mode="standalone" />
        </div>

        {/* Modal Footer */}
        <div className="p-4 px-6 border-t border-white/5 flex items-center justify-between bg-[#111827]/40 shrink-0 text-xs">
          <span className="text-slate-500 text-[11px]">
            Secrets remain memory-only and are wiped on page close.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
