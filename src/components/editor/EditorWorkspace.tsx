import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { 
  X, 
  FileCode, 
  Copy, 
  Check,
  Undo2,
  Redo2
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { snapshotService } from '../../lib/snapshots/SnapshotService';
import { runtimeManager } from '../../lib/runtime/runtime-manager';
import { MonacoUndoAdapter } from '../../lib/editor/monaco-undo-adapter';
import { FileType } from '../../types/workspace';
import { ErrorBoundary } from '../common/ErrorBoundary';

export const EditorWorkspace: React.FC = () => {
  const { projects, activeProjectId, writeFile } = useProjectStore();
  const { 
    openTabs, 
    activeFilePath, 
    openFile, 
    closeTab, 
    markDirty,
    dirtyFiles,
    savedBaselines,
    setSavedBaseline,
    getSavedBaseline,
    modelEpoch
  } = useEditorStore();
  const { addTerminalLog } = useRuntimeStore();

  const [copied, setCopied] = useState(false);
  const [savedBadge, setSavedBadge] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const commandPaletteDisposableRef = useRef<monaco.IDisposable | null>(null);

  useEffect(() => {
    return () => {
      commandPaletteDisposableRef.current?.dispose();
      commandPaletteDisposableRef.current = null;
    };
  }, []);

  const currentProject = projects[activeProjectId];
  const currentTabs = openTabs[activeProjectId] ?? [];
  const rawActivePath = activeFilePath[activeProjectId] || '';
  // The active file must always correspond to an open tab.
  // Invariant: activeFilePath !== '' ONLY IF activeFilePath exists in openTabs.
  // If the last tab closes, activePath becomes '', with no silent fallback to arbitrary files.
  const activePath = currentTabs.includes(rawActivePath)
    ? rawActivePath
    : currentTabs[0] || '';
  const activeFile = activePath ? currentProject?.files[activePath] : undefined;

  // Sync undo / redo state helper
  const updateUndoRedo = useCallback(() => {
    if (!editorRef.current) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const state = MonacoUndoAdapter.getUndoRedoState(editorRef.current);
    setCanUndo(state.canUndo);
    setCanRedo(state.canRedo);
  }, []);

  // Initialize saved baseline on first load of an active file if not yet tracked
  useEffect(() => {
    if (activeFile && activeProjectId) {
      const existing = getSavedBaseline(activeProjectId, activeFile.path);
      if (existing === undefined) {
        setSavedBaseline(activeProjectId, activeFile.path, activeFile.content);
      }
    }
  }, [activeFile?.path, activeProjectId, activeFile?.content, getSavedBaseline, setSavedBaseline]);

  // Execute Undo
  const handleUndo = useCallback(() => {
    if (!editorRef.current || !canUndo) return;
    MonacoUndoAdapter.triggerUndo(editorRef.current);
    editorRef.current.focus();
    setTimeout(updateUndoRedo, 20);
  }, [canUndo, updateUndoRedo]);

  // Execute Redo
  const handleRedo = useCallback(() => {
    if (!editorRef.current || !canRedo) return;
    MonacoUndoAdapter.triggerRedo(editorRef.current);
    editorRef.current.focus();
    setTimeout(updateUndoRedo, 20);
  }, [canRedo, updateUndoRedo]);

  // Keyboard shortcut listener (Cmd+S / Ctrl+S, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y)
  useEffect(() => {
    const isTextInput = (target: HTMLElement | null): boolean => {
      if (!target) return false;
      const tagName = target.tagName.toUpperCase();
      return (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        Boolean(target.closest('[role="dialog"]')) ||
        Boolean(target.closest('.modal'))
      );
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      // 1. Cmd+S / Ctrl+S save
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activeFile && currentProject) {
          await snapshotService.createSnapshot(activeProjectId, `Manual save: ${activeFile.path}`);
          await runtimeManager.syncFile(activeFile.path, activeFile.content);
          markDirty(activeProjectId, activeFile.path, false);
          setSavedBaseline(activeProjectId, activeFile.path, activeFile.content);
          addTerminalLog(`\x1b[32m[VFS Saved]\x1b[0m Synced ${activeFile.path} to sandbox runtime.`);
          setSavedBadge(true);
          setTimeout(() => setSavedBadge(false), 1500);
        }
        return;
      }

      // 2. Undo / Redo shortcuts when not typing in modal/input/textarea
      const target = e.target as HTMLElement | null;
      if (isTextInput(target)) return;

      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      const isRedo =
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        (!isMac && e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'y');

      const inMonaco = Boolean(target?.closest('.monaco-editor'));

      if (isUndo) {
        if (!inMonaco) {
          e.preventDefault();
          handleUndo();
        } else {
          setTimeout(updateUndoRedo, 20);
        }
      } else if (isRedo) {
        if (!inMonaco) {
          e.preventDefault();
          handleRedo();
        } else {
          setTimeout(updateUndoRedo, 20);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFile, activeProjectId, currentProject, addTerminalLog, markDirty, setSavedBaseline, handleUndo, handleRedo, updateUndoRedo]);

  if (!currentProject) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-[#0B0F17] select-none text-slate-500">
        <FileCode className="w-10 h-10 mb-3 stroke-[1.5] text-slate-600" />
        <p className="text-xs font-semibold text-slate-400">No Project Active</p>
        <p className="text-[11px] text-slate-600 mt-1">Select or create a project to start coding</p>
      </div>
    );
  }

  const getMonacoLanguage = (lang?: FileType, path?: string): string => {
    if (!path) return 'typescript';
    if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
    if (path.endsWith('.jsx') || path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.md')) return 'markdown';
    return 'plaintext';
  };

  const handleCopyCode = () => {
    if (activeFile) {
      navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const cleanFilePath = activeFile?.path
    ? (activeFile.path.startsWith('/') ? activeFile.path : `/${activeFile.path}`)
    : '';

  return (
    <ErrorBoundary fallbackTitle="Monaco Editor Workspace Error">
      <div className="h-full w-full min-w-0 flex flex-col bg-[#0B0F17] overflow-hidden select-none">
        {/* 1. File Tabs Bar */}
        <div className="h-9 bg-slate-950 border-b border-white/5 flex items-center px-2 gap-1 overflow-x-auto shrink-0 custom-scrollbar">
          {currentTabs.map((tabPath: string) => {
            const isActive = tabPath === activePath;
            const fileName = tabPath.split('/').pop() || tabPath;
            const isDirty = dirtyFiles[`${activeProjectId}:${tabPath}`] === true;

            return (
              <div
                key={tabPath}
                onClick={() => openFile(activeProjectId, tabPath)}
                data-testid={`tab-${tabPath}`}
                className={`group h-7 px-3 rounded-t-md flex items-center gap-2 text-xs font-mono transition cursor-pointer border-t-2 ${
                  isActive
                    ? 'bg-[#0B0F17] text-violet-300 border-violet-500 font-semibold'
                    : 'bg-slate-900/40 text-slate-400 border-transparent hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <span className="truncate max-w-[140px]">{fileName}</span>

                {isDirty && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
                    title="Unsaved changes"
                    data-testid={`tab-dirty-indicator-${tabPath}`}
                  />
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(activeProjectId, tabPath);
                  }}
                  aria-label={`Close ${fileName}`}
                  data-testid={`tab-close-${tabPath}`}
                  className={`p-1 -mr-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition focus:outline-none focus:ring-1 focus:ring-violet-400 focus:opacity-100 ${
                    isActive
                      ? 'opacity-70 hover:opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* 2. Breadcrumb Toolbar */}
        {activeFile && (
          <div className="h-7 px-4 bg-slate-900/40 border-b border-white/5 flex items-center justify-between text-xs text-slate-400 shrink-0">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="text-slate-500">Path:</span>
              <span className="text-violet-300">{activeFile.path}</span>
              {savedBadge && (
                <span className="text-[10px] text-emerald-400 font-sans flex items-center gap-1">
                  <Check className="w-3 h-3" /> Saved (⌘S)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Undo & Redo buttons */}
              <div className="flex items-center gap-1 mr-1">
                <button
                  data-testid="editor-undo-btn"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="Undo (Ctrl+Z / ⌘Z)"
                  aria-label="Undo editor change"
                  className={`px-2 py-0.5 rounded flex items-center gap-1 text-[11px] font-medium transition ${
                    canUndo
                      ? 'text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer'
                      : 'text-slate-600 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Undo</span>
                </button>

                <button
                  data-testid="editor-redo-btn"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title="Redo (Ctrl+Shift+Z / ⌘Shift+Z / Ctrl+Y)"
                  aria-label="Redo editor change"
                  className={`px-2 py-0.5 rounded flex items-center gap-1 text-[11px] font-medium transition ${
                    canRedo
                      ? 'text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer'
                      : 'text-slate-600 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <Redo2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Redo</span>
                </button>
              </div>

              <div className="h-3.5 w-px bg-white/10 mx-0.5" />

              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1 hover:text-slate-200 transition text-[11px]"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* 3. Monaco Editor Viewport */}
        <div className="flex-1 w-full min-h-0 bg-[#0B0F17] overflow-hidden">
          {activeFile ? (
            <Editor
              key={`${activeProjectId}:${cleanFilePath}:${modelEpoch}`}
              path={`file:///${activeProjectId}${cleanFilePath}`}
              height="100%"
              language={getMonacoLanguage(activeFile.language, activeFile.path)}
              value={activeFile.content}
              theme="vs-dark"
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                updateUndoRedo();
                editor.onDidChangeModelContent(() => {
                  updateUndoRedo();
                });
                editor.onDidChangeModel(() => {
                  updateUndoRedo();
                });

                // UX-03: Register Ctrl/Cmd+K via Monaco action API with disposable cleanup
                commandPaletteDisposableRef.current?.dispose();
                const disposable = editor.addAction({
                  id: 'snapdeploy.openCommandPalette',
                  label: 'Open Command Palette',
                  keybindings: [
                    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
                    monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyK
                  ],
                  run: () => {
                    window.dispatchEvent(new CustomEvent('snapdeploy:open-command-palette'));
                  }
                });
                commandPaletteDisposableRef.current = disposable;

                editor.onDidDispose(() => {
                  disposable.dispose();
                  if (commandPaletteDisposableRef.current === disposable) {
                    commandPaletteDisposableRef.current = null;
                  }
                });
              }}
              onChange={(val) => {
                const newContent = val || '';
                writeFile(activeProjectId, activeFile.path, newContent);
                const baseline = getSavedBaseline(activeProjectId, activeFile.path) ?? activeFile.content;
                markDirty(activeProjectId, activeFile.path, newContent !== baseline);
                updateUndoRedo();
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
                fontLigatures: true,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                bracketPairColorization: { enabled: true },
                cursorBlinking: 'smooth',
                padding: { top: 8, bottom: 8 }
              }}
            />
          ) : (
            <div
              data-testid="editor-empty-state"
              className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-[#0B0F17] select-none text-slate-500"
            >
              <FileCode className="w-10 h-10 mb-3 stroke-[1.5] text-slate-600" />
              <p className="text-sm font-semibold text-slate-400">No file open</p>
              <p className="text-[11px] text-slate-600 mt-1">Select a file from the Explorer to start editing</p>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};
