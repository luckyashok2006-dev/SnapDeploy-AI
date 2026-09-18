import React, { useState, useEffect } from 'react';
import { 
  FileCode, 
  FileJson, 
  FileText, 
  Database, 
  Trash2, 
  Edit3, 
  FilePlus2
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { FileType } from '../../types/workspace';
import { vfsManager } from '../../lib/vfs/vfs-manager';

export const FileExplorer: React.FC = () => {
  const { 
    projects, 
    activeProjectId, 
    writeFile, 
    deleteFile, 
    renameFile 
  } = useProjectStore();

  const { openFile, activeFilePath } = useEditorStore();

  useEffect(() => {
    if (activeProjectId) {
      vfsManager.waitUntilHydrated().then(() => {
        useProjectStore.getState().syncProjectFilesFromVFS(activeProjectId);
      }).catch(() => {});
    }
  }, [activeProjectId]);

  const currentProject = projects[activeProjectId];
  const [newFileInputOpen, setNewFileInputOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingFilePath, setDeletingFilePath] = useState<string | null>(null);

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-[#0B0F17] select-none text-slate-500">
        <FileCode className="w-8 h-8 mb-2 stroke-[1.5] text-slate-600" />
        <p className="text-xs font-medium text-slate-400">No Project Selected</p>
        <p className="text-[11px] text-slate-600 mt-1">Select or create a project to explore files</p>
      </div>
    );
  }

  const files = Object.values(currentProject.files);
  const activePath = activeFilePath[activeProjectId];

  const getFileIcon = (path: string, language?: FileType) => {
    if (path.endsWith('.prisma')) return <Database className="w-4 h-4 text-emerald-400" />;
    if (language === 'json' || path.endsWith('.json')) return <FileJson className="w-4 h-4 text-amber-400" />;
    if (language === 'markdown' || path.endsWith('.md')) return <FileText className="w-4 h-4 text-sky-400" />;
    if (path.endsWith('.tsx') || path.endsWith('.jsx')) return <FileCode className="w-4 h-4 text-cyan-400" />;
    if (path.endsWith('.ts') || path.endsWith('.js')) return <FileCode className="w-4 h-4 text-violet-400" />;
    return <FileCode className="w-4 h-4 text-slate-400" />;
  };

  const handleCreateNewFile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newFilePath.trim()) return;

    let path = newFilePath.trim();
    if (!path.startsWith('/')) path = '/' + path;

    await writeFile(activeProjectId, path, `// ${path}\nexport {};\n`);
    openFile(activeProjectId, path);
    setNewFilePath('');
    setNewFileInputOpen(false);
  };

  const handleRenameSubmit = async (oldPath: string) => {
    if (!editName.trim()) {
      setEditingPath(null);
      return;
    }
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = `${dir}/${editName.trim()}`;
    if (newPath !== oldPath) {
      await renameFile(activeProjectId, oldPath, newPath);
    }
    setEditingPath(null);
  };

  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden border-r border-white/5">
      {/* Header */}
      <div className="h-10 px-3 border-b border-white/5 flex items-center justify-between bg-slate-950/60">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-sans">
          Project Files
        </span>
        <button
          onClick={() => setNewFileInputOpen(!newFileInputOpen)}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          title="New File"
        >
          <FilePlus2 className="w-4 h-4" />
        </button>
      </div>

      {/* New file input prompt */}
      {newFileInputOpen && (
        <form onSubmit={handleCreateNewFile} className="p-2.5 border-b border-white/10 bg-slate-900/90 space-y-2">
          <div className="text-[11px] font-medium text-slate-300">New File</div>
          <input
            type="text"
            placeholder="/src/components/MyComponent.tsx"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNewFileInputOpen(false);
                setNewFilePath('');
              }
            }}
            autoFocus
            className="w-full bg-slate-950 border border-violet-500/50 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <div className="flex items-center justify-end gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => {
                setNewFileInputOpen(false);
                setNewFilePath('');
              }}
              className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newFilePath.trim()}
              className="px-2.5 py-1 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create File
            </button>
          </div>
        </form>
      )}

      {/* File List Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
        {sortedFiles.map((file) => {
          const isActive = file.path === activePath;
          const isEditing = editingPath === file.path;

          if (isEditing) {
            return (
              <div
                key={file.path}
                onClick={(e) => e.stopPropagation()}
                className="p-2.5 bg-slate-900 border border-violet-500/40 rounded-lg space-y-2 my-1 shadow-lg"
              >
                <div className="text-[11px] font-medium text-slate-300">Rename File</div>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRenameSubmit(file.path);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingPath(null);
                    }
                  }}
                  autoFocus
                  className="w-full bg-slate-950 text-slate-100 px-2 py-1 rounded border border-violet-500/50 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPath(null);
                    }}
                    className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!editName.trim()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameSubmit(file.path);
                    }}
                    className="px-2.5 py-1 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Rename
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={file.path}
              onClick={() => openFile(activeProjectId, file.path)}
              className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-mono transition cursor-pointer ${
                isActive
                  ? 'bg-violet-600/20 text-violet-200 border border-violet-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center gap-2 truncate flex-1 mr-2">
                {getFileIcon(file.path, file.language)}
                <span className="truncate">{file.path}</span>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingPath(file.path);
                    setEditName(file.path.split('/').pop() || '');
                  }}
                  className="p-1 hover:text-violet-400 text-slate-500"
                  title="Rename"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingFilePath(file.path);
                  }}
                  className="p-1 hover:text-rose-400 text-slate-500"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete File Confirmation Modal */}
      {deletingFilePath && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={() => setDeletingFilePath(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDeletingFilePath(null);
          }}
          tabIndex={-1}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-xl p-4 max-w-sm w-full shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
              <Trash2 className="w-4 h-4" />
              <span>Delete File?</span>
            </div>
            <div className="bg-slate-950/80 rounded-md p-2 border border-white/5">
              <p className="text-xs font-mono text-slate-200 break-all">{deletingFilePath}</p>
            </div>
            <p className="text-xs text-slate-400">
              This will remove the file from the active project.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeletingFilePath(null)}
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const targetPath = deletingFilePath;
                  setDeletingFilePath(null);
                  await deleteFile(activeProjectId, targetPath);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition"
              >
                Delete File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
