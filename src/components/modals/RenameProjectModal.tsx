import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X, AlertCircle } from 'lucide-react';
import { ProjectWorkspace } from '../../types/workspace';
import { useProjectStore } from '../../store/projectStore';
import { useRuntimeStore } from '../../store/runtimeStore';

interface RenameProjectModalProps {
  project: ProjectWorkspace | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newTitle: string) => void;
}

export const RenameProjectModal: React.FC<RenameProjectModalProps> = ({
  project,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { renameProject } = useProjectStore();
  const { addTerminalLog } = useRuntimeStore();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (project && isOpen) {
      setName(project.title);
      setError(null);
      setIsSubmitting(false);
      // Auto-focus and select text after rendering
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [project, isOpen]);

  if (!isOpen || !project) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    onClose();
  };

  const validate = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Project name cannot be empty or whitespace only.';
    }
    if (trimmed.length > 60) {
      return 'Project name cannot exceed 60 characters.';
    }
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
      return 'Project name contains invalid control characters.';
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const validationError = validate(name);
    if (validationError) {
      setError(validationError);
      return;
    }

    const trimmed = name.trim();
    if (trimmed === project.title) {
      // Unchanged: cleanly close without re-writing
      onClose();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      renameProject(project.id, trimmed);
      addTerminalLog(`\x1b[32m[Project Renamed]\x1b[0m Renamed project '${project.title}' to '${trimmed}'`);
      onSuccess?.(trimmed);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to rename project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  const isInvalid = Boolean(validate(name));

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-project-title"
      data-testid="rename-project-modal"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in select-none"
    >
      <div className="bg-[#111827] border border-white/10 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[min(90vh,calc(100dvh-2.5rem))]">
        {/* Header */}
        <div className="flex items-start justify-between p-5 sm:p-6 pb-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h2 id="rename-project-title" className="text-base font-bold text-slate-100">
                Rename Project
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Update the display name for this project.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <div>
              <label htmlFor="rename-project-input" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Project Name
              </label>
              <input
                id="rename-project-input"
                data-testid="rename-project-input"
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                maxLength={60}
                disabled={isSubmitting}
                placeholder="e.g. My Awesome App"
                className={`w-full bg-slate-900 border rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition ${
                  error
                    ? 'border-red-500 focus:border-red-500 ring-1 ring-red-500/30'
                    : 'border-white/10 focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30'
                }`}
              />
              <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                <span>{name.length} / 60 characters</span>
                <span className="font-mono text-slate-400">ID: {project.id}</span>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Actions Footer */}
          <div className="flex items-center justify-end gap-3 p-5 sm:p-6 pt-3 border-t border-white/5 shrink-0">
            <button
              type="button"
              data-testid="cancel-rename-project"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="confirm-rename-project"
              disabled={isSubmitting || isInvalid}
              className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 transition shadow-lg shadow-violet-600/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <span>Saving...</span>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
