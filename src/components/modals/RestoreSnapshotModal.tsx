import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  RotateCcw, 
  AlertTriangle, 
  X, 
  Clock, 
  FileText, 
  FilePlus, 
  FileMinus, 
  FileDiff,
  ShieldCheck
} from 'lucide-react';
import { Snapshot, ProjectWorkspace } from '../../types/workspace';
import { useEditorStore } from '../../store/editorStore';
import { snapshotService } from '../../lib/snapshots/SnapshotService';

interface RestoreSnapshotModalProps {
  isOpen: boolean;
  project: ProjectWorkspace | null;
  snapshot: Snapshot | null;
  onClose: () => void;
  onConfirm: (snapshotId: string) => Promise<void>;
}

export const RestoreSnapshotModal: React.FC<RestoreSnapshotModalProps> = ({
  isOpen,
  project,
  snapshot,
  onClose,
  onConfirm
}) => {
  const [isRestoring, setIsRestoring] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const hasDirty = project ? useEditorStore.getState().hasDirtyFiles(project.id) : false;
  const dirtyFiles = project ? useEditorStore.getState().getDirtyFiles(project.id) : [];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isRestoring) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRestoring, onClose]);

  if (!isOpen || !project || !snapshot) return null;

  // Calculate file diff vs current working project files
  const currentFiles = project.files || {};
  const diff = snapshotService.compareSnapshots(snapshot.files, currentFiles);

  const formattedDate = new Date(snapshot.timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const handleRestore = async () => {
    setIsRestoring(true);
    setError(null);
    try {
      await onConfirm(snapshot.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to restore snapshot. Current state was preserved.');
    } finally {
      setIsRestoring(false);
    }
  };

  const modalContent = (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200 select-none"
      data-testid="restore-snapshot-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-modal-title"
    >
      <div className="bg-[#111827] border border-violet-500/30 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[min(90vh,calc(100dvh-2.5rem))] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-white/10 flex items-center justify-between bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h2 id="restore-modal-title" className="text-sm font-semibold text-slate-100">
                Restore Project Snapshot
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {project.title} &bull; <span className="font-mono text-violet-400">{snapshot.id.slice(0, 16)}...</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isRestoring}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-50"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {/* Unsaved / Dirty files warning */}
          {hasDirty && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 space-y-1.5" data-testid="dirty-files-warning">
              <div className="flex items-center gap-2 font-semibold text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Unsaved Editor Changes Detected</span>
              </div>
              <p className="text-[11px] text-rose-300/90 leading-relaxed">
                You have unsaved edits in {dirtyFiles.length} file{dirtyFiles.length > 1 ? 's' : ''}:
              </p>
              <ul className="list-disc list-inside font-mono text-[10px] text-rose-200 space-y-0.5 pl-1">
                {dirtyFiles.slice(0, 4).map((f) => (
                  <li key={f} className="truncate">{f}</li>
                ))}
                {dirtyFiles.length > 4 && <li>...and {dirtyFiles.length - 4} more</li>}
              </ul>
              <p className="text-[10px] text-rose-400/90 font-medium">
                Restoring will replace all working files. These uncommitted changes will be discarded.
              </p>
            </div>
          )}

          {/* Snapshot Summary Box */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-violet-400" />
                Snapshot Time:
              </span>
              <span className="font-mono text-slate-300 text-[11px]">{formattedDate}</span>
            </div>

            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-sky-400" />
                Version Description:
              </span>
              <span className="text-slate-300 truncate max-w-[260px]">
                {snapshot.description || 'Manual checkpoint'}
              </span>
            </div>

            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold text-slate-200">Total Snapshot Files:</span>
              <span className="font-mono text-emerald-400 font-medium">
                {Object.keys(snapshot.files).length} files
              </span>
            </div>
          </div>

          {/* File Changes Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Changes Relative to Current State:</span>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                {diff.addedFiles.length > 0 && (
                  <span className="text-emerald-400 flex items-center gap-0.5">
                    <FilePlus className="w-3 h-3" /> +{diff.addedFiles.length}
                  </span>
                )}
                {diff.removedFiles.length > 0 && (
                  <span className="text-rose-400 flex items-center gap-0.5">
                    <FileMinus className="w-3 h-3" /> -{diff.removedFiles.length}
                  </span>
                )}
                {diff.modifiedFiles.length > 0 && (
                  <span className="text-amber-400 flex items-center gap-0.5">
                    <FileDiff className="w-3 h-3" /> ~{diff.modifiedFiles.length}
                  </span>
                )}
              </div>
            </div>

            {diff.removedFiles.length > 0 && (
              <div className="p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-[11px]">
                <span className="text-rose-300 font-medium block mb-1">
                  Files that will be removed (do not exist in this snapshot):
                </span>
                <ul className="list-disc list-inside font-mono text-[10px] text-rose-300/80 space-y-0.5">
                  {diff.removedFiles.slice(0, 5).map((f) => (
                    <li key={f} className="truncate">{f}</li>
                  ))}
                  {diff.removedFiles.length > 5 && (
                    <li>...and {diff.removedFiles.length - 5} more files</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Automatic Safety Checkpoint Notice */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-violet-950/30 border border-violet-500/20 text-xs text-violet-300">
            <ShieldCheck className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
            <p className="text-[11px] leading-relaxed text-violet-200/90">
              <strong className="font-semibold text-violet-200">Safety Guarantee:</strong> SnapDeploy AI will automatically record a pre-restore checkpoint of your current project state before restoring. You can restore earlier checkpoints at any time.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-4 bg-slate-900/60 border-t border-white/5 flex items-center justify-end gap-2.5 shrink-0">
          <button
            onClick={onClose}
            disabled={isRestoring}
            data-testid="cancel-restore-btn"
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleRestore}
            disabled={isRestoring}
            data-testid="confirm-restore-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold shadow-lg shadow-amber-600/20 transition disabled:opacity-50"
          >
            {isRestoring ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                <span>Restoring...</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore This Version</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
