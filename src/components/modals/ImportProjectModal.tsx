import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Upload,
  FolderArchive,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Layers,
  FileText,
  ShieldCheck
} from 'lucide-react';
import { projectImporter } from '../../features/import/project-importer';
import { ImportValidationResult } from '../../types/workspace';
import { useRuntimeStore } from '../../store/runtimeStore';

interface ImportProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (projectId: string) => void;
}

export const ImportProjectModal: React.FC<ImportProjectModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const { addTerminalLog } = useRuntimeStore();

  useEffect(() => {
    if (!isOpen) {
      // Reset state on close
      setSelectedFile(null);
      setValidationResult(null);
      setIsInspecting(false);
      setIsImporting(false);
      setCustomTitle('');
      setError(null);
      setIsDragOver(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isImporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isImporting, onClose]);

  if (!isOpen) return null;

  const handleFileChange = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Please select a valid .zip archive file.');
      setSelectedFile(null);
      setValidationResult(null);
      return;
    }

    setSelectedFile(file);
    setError(null);
    setIsInspecting(true);

    try {
      const result = await projectImporter.inspectArchive(file, file.name);
      setValidationResult(result);
      if (result.valid && result.detectedConfig) {
        setCustomTitle(result.detectedConfig.title);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to inspect archive.');
      setValidationResult(null);
    } finally {
      setIsInspecting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmImport = async () => {
    if (!validationResult || !validationResult.valid || !validationResult.detectedConfig) {
      return;
    }

    setIsImporting(true);
    setError(null);

    const titleToUse = customTitle.trim() || validationResult.detectedConfig.title || 'Imported Project';

    try {
      addTerminalLog(`\x1b[36m[Project Import]\x1b[0m Importing "${titleToUse}" from ZIP into authoritative VFS...`);
      const importedId = await projectImporter.commitImport(
        validationResult.extractedFiles,
        validationResult.detectedConfig,
        { customTitle: titleToUse }
      );

      addTerminalLog(
        `\x1b[32m[Project Imported]\x1b[0m Project "${titleToUse}" (${importedId}) loaded into VFS with initial baseline snapshot.`
      );
      onImportSuccess?.(importedId);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to complete project import.');
    } finally {
      setIsImporting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200 select-none"
      data-testid="import-project-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="bg-[#111827] border border-violet-500/30 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[min(90vh,calc(100dvh-2.5rem))] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-white/10 flex items-center justify-between bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 id="import-modal-title" className="text-sm font-semibold text-slate-100">
                Import Existing Project
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload a ZIP archive to load an existing codebase into VFS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isImporting}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {/* Hidden native input */}
          <input
            type="file"
            ref={fileInputRef}
            data-testid="import-file-input"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileChange(e.target.files[0]);
              }
            }}
          />

          {/* Dropzone */}
          <div
            data-testid="import-dropzone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2.5 ${
              isDragOver
                ? 'border-violet-400 bg-violet-500/10'
                : 'border-white/10 hover:border-violet-500/40 hover:bg-slate-900/50 bg-[#0B0F17]/50'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-violet-500/10 text-violet-400 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-200">
                {selectedFile ? selectedFile.name : 'Choose a ZIP file or drag & drop here'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Supports web projects (.zip up to 25MB)
              </p>
            </div>
          </div>

          {/* Loading Inspection State */}
          {isInspecting && (
            <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/20 flex items-center justify-center gap-2.5 text-violet-300 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin text-violet-400" />
              <span>Validating and inspecting archive structure...</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div
              data-testid="import-error-banner"
              className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-2.5 text-rose-300 text-xs"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div className="flex-1 break-words">{error}</div>
            </div>
          )}

          {/* Validated Project Configuration */}
          {validationResult && validationResult.valid && validationResult.detectedConfig && (
            <div className="space-y-4 pt-1">
              {/* Project Name Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Project Title
                </label>
                <input
                  type="text"
                  data-testid="import-project-title-input"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Project title..."
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500 transition"
                />
              </div>

              {/* Inspection Summary Card */}
              <div className="p-3.5 rounded-xl bg-[#0B0F17] border border-white/5 space-y-2.5">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-white/5">
                  <span className="text-slate-400 font-medium">Framework</span>
                  <span
                    data-testid="import-detected-framework"
                    className="font-mono text-violet-300 font-semibold px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/20"
                  >
                    {validationResult.detectedConfig.badge}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 text-[11px]">Extracted Files</span>
                    <p data-testid="import-file-count" className="font-medium text-slate-200 mt-0.5">
                      {validationResult.fileCount} files
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[11px]">Uncompressed Size</span>
                    <p data-testid="import-total-size" className="font-medium text-slate-200 mt-0.5">
                      {(validationResult.totalUncompressedBytes / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>

                {validationResult.detectedConfig.primaryEntryFile && (
                  <div className="text-xs pt-1">
                    <span className="text-slate-500 text-[11px]">Primary Entry</span>
                    <p data-testid="import-entry-file" className="font-mono text-emerald-400 text-[11px] mt-0.5">
                      {validationResult.detectedConfig.primaryEntryFile}
                    </p>
                  </div>
                )}
              </div>

              {/* Warnings / Ignored files notice */}
              {validationResult.warnings.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 text-[11px] font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Import Warnings</span>
                  </div>
                  <ul className="text-[11px] text-amber-300/80 list-disc list-inside space-y-0.5">
                    {validationResult.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validationResult.ignoredPaths.length > 0 && (
                <div className="text-[10px] text-slate-500 font-mono">
                  Auto-excluded {validationResult.ignoredPaths.length} build/dependency paths (node_modules, .git, etc.)
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-4 border-t border-white/10 bg-slate-900/60 flex items-center justify-end gap-2.5 shrink-0">
          <button
            onClick={onClose}
            data-testid="cancel-import-btn"
            disabled={isImporting}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmImport}
            data-testid="confirm-import-btn"
            disabled={!validationResult?.valid || isImporting || isInspecting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 shadow-lg shadow-violet-600/20 transition disabled:opacity-50"
          >
            {isImporting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Importing Project...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Import Project</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
