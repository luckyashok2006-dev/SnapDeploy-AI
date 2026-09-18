import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X, RefreshCw } from 'lucide-react';
import { ProjectWorkspace } from '../../types/workspace';
import { useProjectStore } from '../../store/projectStore';
import { useRuntimeStore } from '../../store/runtimeStore';

interface DeleteProjectModalProps {
  project: ProjectWorkspace | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const DeleteProjectModal: React.FC<DeleteProjectModalProps> = ({
  project,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { deleteProject } = useProjectStore();
  const { addTerminalLog } = useRuntimeStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !project) return null;

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      addTerminalLog(`\x1b[33m[Project Deletion]\x1b[0m Initiating deletion of project '${project.title}' (${project.id})...`);
      const success = await deleteProject(project.id);
      if (success) {
        addTerminalLog(`\x1b[32m[Project Deleted]\x1b[0m Successfully deleted project '${project.title}'.`);
        onSuccess?.();
        onClose();
      } else {
        setErrorMessage('Project deletion did not complete.');
        addTerminalLog(`\x1b[31m[Deletion Error]\x1b[0m Failed to delete project '${project.title}'.`);
      }
    } catch (err: any) {
      const msg = err?.message || 'An unexpected error occurred during project deletion.';
      setErrorMessage(msg);
      addTerminalLog(`\x1b[31m[Deletion Error]\x1b[0m ${msg}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
      data-testid="delete-project-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in select-none"
    >
      <div className="bg-[#111827] border border-red-500/30 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[min(90vh,calc(100dvh-2.5rem))]">
        {/* Header */}
        <div className="flex items-start justify-between p-5 sm:p-6 pb-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="delete-project-title" className="text-base font-bold text-slate-100">
                Delete Project
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                This action is permanent and cannot be undone.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning Body */}
        <div className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3.5 space-y-2 text-xs text-slate-300">
            <p>
              Are you sure you want to delete <span className="font-semibold text-white">"{project.title}"</span>?
            </p>
            <ul className="list-disc list-inside text-slate-400 space-y-1 text-[11px]">
              <li>All files in the Virtual File System will be removed</li>
              <li>All snapshot checkpoints will be deleted</li>
              <li>Associated editor tabs and dirty states will be cleared</li>
              <li>Runtime environment and running servers will be stopped</li>
            </ul>
          </div>

          {/* Error message banner if any */}
          {errorMessage && (
            <div className="bg-red-950/80 border border-red-500/50 rounded-lg p-2.5 text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span className="truncate">{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 p-5 sm:p-6 pt-3 border-t border-white/5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            data-testid="cancel-delete-project"
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 border border-white/10 transition disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            data-testid="confirm-delete-project"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 transition disabled:opacity-50 disabled:pointer-events-none"
          >
            {isDeleting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Deleting Project...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Project</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
