import React, { useState, useEffect } from 'react';
import { 
  History, 
  Clock, 
  Plus, 
  RotateCcw, 
  ChevronRight, 
  CheckCircle2, 
  FileText, 
  X, 
  FilePlus, 
  FileMinus, 
  FileDiff,
  Layers,
  Copy,
  Check
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { snapshotService, SnapshotDiffSummary } from '../../lib/snapshots/SnapshotService';
import { Snapshot } from '../../types/workspace';
import { RestoreSnapshotModal } from '../modals/RestoreSnapshotModal';

interface VersionHistoryPanelProps {
  onClose?: () => void;
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 45) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently';
  }
}

export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({ onClose }) => {
  const { projects, activeProjectId, createSnapshot, restoreSnapshot } = useProjectStore();
  const currentProject = projects[activeProjectId];

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [newSnapshotDesc, setNewSnapshotDesc] = useState('');
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Refresh snapshots for active project
  const reloadSnapshots = () => {
    if (!activeProjectId) {
      setSnapshots([]);
      setSelectedSnapshotId(null);
      return;
    }
    const list = snapshotService.listSnapshots(activeProjectId);
    setSnapshots(list);
    if (list.length > 0 && (!selectedSnapshotId || !list.some(s => s.id === selectedSnapshotId))) {
      setSelectedSnapshotId(list[0].id);
    }
  };

  useEffect(() => {
    reloadSnapshots();
  }, [activeProjectId]);

  const selectedSnapshot = snapshots.find(s => s.id === selectedSnapshotId) || snapshots[0] || null;

  // Compute diff against predecessor in chronological timeline
  const selectedIndex = selectedSnapshot ? snapshots.indexOf(selectedSnapshot) : -1;
  const predecessorSnapshot = selectedIndex >= 0 && selectedIndex < snapshots.length - 1 ? snapshots[selectedIndex + 1] : null;

  let diffSummary: SnapshotDiffSummary | null = null;
  if (selectedSnapshot) {
    if (predecessorSnapshot) {
      diffSummary = snapshotService.compareSnapshots(selectedSnapshot.files, predecessorSnapshot.files);
    } else {
      // First / initial baseline snapshot: all files are considered added
      diffSummary = {
        addedFiles: Object.keys(selectedSnapshot.files),
        removedFiles: [],
        modifiedFiles: []
      };
    }
  }

  const handleCreateSnapshotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId) return;
    const desc = newSnapshotDesc.trim() || 'Manual checkpoint';
    setIsSavingSnapshot(true);
    setActionError(null);
    try {
      await createSnapshot(activeProjectId, desc);
      setNewSnapshotDesc('');
      setIsCreatingSnapshot(false);
      reloadSnapshots();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to create snapshot.');
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleConfirmRestore = async (snapshotId: string) => {
    if (!activeProjectId) return;
    setActionError(null);
    await restoreSnapshot(activeProjectId, snapshotId);
    reloadSnapshots();
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-[#0B0F17] select-none text-slate-500">
        <History className="w-8 h-8 mb-2 stroke-[1.5] text-slate-600" />
        <p className="text-xs font-medium text-slate-400">No Project Selected</p>
        <p className="text-[11px] text-slate-600 mt-1">Select a project to view version history</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden border-r border-white/5" data-testid="version-history-panel">
      {/* 1. Header Toolbar */}
      <div className="h-10 px-3 border-b border-white/5 flex items-center justify-between bg-slate-950/60 shrink-0">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-semibold text-slate-200 tracking-wide font-sans">
            Version History
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 font-mono border border-violet-500/20">
            {snapshots.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsCreatingSnapshot(!isCreatingSnapshot)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
            title="Create new checkpoint snapshot"
            data-testid="toggle-create-snapshot-btn"
          >
            <Plus className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
              title="Close version history"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. New Snapshot Inline Creator Form */}
      {isCreatingSnapshot && (
        <form onSubmit={handleCreateSnapshotSubmit} className="p-3 border-b border-white/5 bg-[#111827] space-y-2 shrink-0 animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-300">Create Checkpoint</span>
            <button
              type="button"
              onClick={() => setIsCreatingSnapshot(false)}
              className="text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Version description (e.g., Finished checkout form)..."
            value={newSnapshotDesc}
            onChange={(e) => setNewSnapshotDesc(e.target.value)}
            autoFocus
            className="w-full bg-slate-950 border border-violet-500/40 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setIsCreatingSnapshot(false)}
              className="px-2.5 py-1 rounded text-[11px] text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingSnapshot}
              data-testid="create-snapshot-submit"
              className="px-3 py-1 rounded text-[11px] bg-violet-600 hover:bg-violet-500 text-white font-medium shadow transition disabled:opacity-50"
            >
              {isSavingSnapshot ? 'Saving...' : 'Save Checkpoint'}
            </button>
          </div>
        </form>
      )}

      {actionError && (
        <div className="p-2.5 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-300 flex items-center justify-between shrink-0">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Main Workspace Area: Timeline List & Selected Details */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {snapshots.length === 0 ? (
          /* Empty State */
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 space-y-3" data-testid="empty-version-history">
            <div className="p-3 rounded-2xl bg-slate-900 border border-white/5 text-slate-400">
              <Clock className="w-8 h-8 stroke-[1.5]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-300">No Checkpoints Saved Yet</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-[220px] leading-relaxed">
                Save snapshots to track your project progress and restore any previous version safely.
              </p>
            </div>
            <button
              onClick={async () => {
                setIsSavingSnapshot(true);
                try {
                  await createSnapshot(activeProjectId, 'Initial baseline snapshot');
                  reloadSnapshots();
                } finally {
                  setIsSavingSnapshot(false);
                }
              }}
              disabled={isSavingSnapshot}
              data-testid="create-first-snapshot-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium shadow-lg shadow-violet-600/20 transition disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Initial Checkpoint</span>
            </button>
          </div>
        ) : (
          /* Timeline Content */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top Half: Timeline Snapshot List (Newest first) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5 border-b border-white/5">
              <div className="px-2 py-1 flex items-center justify-between text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                <span>Timeline (Newest First)</span>
                <span>{snapshots.length} / 15</span>
              </div>

              {snapshots.map((snap, idx) => {
                const isSelected = snap.id === selectedSnapshot?.id;
                const isLatest = idx === 0;
                const fileCount = Object.keys(snap.files).length;
                const timeRelative = formatRelativeTime(snap.timestamp);

                return (
                  <div
                    key={snap.id}
                    onClick={() => setSelectedSnapshotId(snap.id)}
                    data-testid={`snapshot-item-${snap.id}`}
                    data-snapshot-id={snap.id}
                    className={`p-2.5 rounded-xl transition cursor-pointer border flex items-start gap-2.5 ${
                      isSelected
                        ? 'bg-violet-600/15 border-violet-500/40 text-slate-200 shadow-sm'
                        : 'bg-slate-900/40 border-white/5 text-slate-400 hover:bg-slate-800/40 hover:text-slate-300'
                    }`}
                  >
                    <div className="mt-0.5">
                      {isLatest ? (
                        <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" />
                        </div>
                      ) : (
                        <div className="p-1 rounded-full bg-slate-800 text-slate-400">
                          <Clock className="w-3 h-3" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-medium text-slate-200 truncate">
                          {snap.description || 'Checkpoint'}
                        </span>
                        {isLatest && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-emerald-500/20 text-emerald-300 shrink-0">
                            Current
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                        <span>{timeRelative}</span>
                        <span>{fileCount} files</span>
                      </div>
                    </div>

                    <ChevronRight className={`w-3.5 h-3.5 text-slate-600 self-center transition ${isSelected ? 'text-violet-400 translate-x-0.5' : ''}`} />
                  </div>
                );
              })}
            </div>

            {/* Bottom Half: Selected Snapshot Details & Action Pane */}
            {selectedSnapshot && (
              <div className="p-3 bg-slate-950/80 space-y-3 shrink-0 border-t border-white/5" data-testid="snapshot-details-pane">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      Version Details
                    </span>
                    <button
                      onClick={() => handleCopyId(selectedSnapshot.id)}
                      className="flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-300 transition"
                      title="Copy snapshot ID"
                    >
                      {copiedId === selectedSnapshot.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{selectedSnapshot.id.slice(0, 16)}...</span>
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400 truncate">
                    {selectedSnapshot.description || 'Manual checkpoint'}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono pt-1">
                    <span>{new Date(selectedSnapshot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span>{Object.keys(selectedSnapshot.files).length} files</span>
                  </div>
                </div>

                {/* Diff Summary vs Predecessor */}
                {diffSummary && (
                  <div className="p-2 rounded-lg bg-[#111827] border border-white/5 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between text-slate-400 font-medium">
                      <span>File Changes</span>
                      <div className="flex items-center gap-2 font-mono text-[10px]">
                        {diffSummary.addedFiles.length > 0 && (
                          <span className="text-emerald-400">+{diffSummary.addedFiles.length}</span>
                        )}
                        {diffSummary.removedFiles.length > 0 && (
                          <span className="text-rose-400">-{diffSummary.removedFiles.length}</span>
                        )}
                        {diffSummary.modifiedFiles.length > 0 && (
                          <span className="text-amber-400">~{diffSummary.modifiedFiles.length}</span>
                        )}
                        {diffSummary.addedFiles.length === 0 && diffSummary.removedFiles.length === 0 && diffSummary.modifiedFiles.length === 0 && (
                          <span className="text-slate-500">Identical</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Restore Version Action Button */}
                <button
                  onClick={() => setIsRestoreModalOpen(true)}
                  data-testid="restore-snapshot-btn"
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-slate-950 shadow-md shadow-amber-600/20 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore This Version</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Restore Confirmation Modal */}
      <RestoreSnapshotModal
        isOpen={isRestoreModalOpen}
        project={currentProject}
        snapshot={selectedSnapshot}
        onClose={() => setIsRestoreModalOpen(false)}
        onConfirm={handleConfirmRestore}
      />
    </div>
  );
};
