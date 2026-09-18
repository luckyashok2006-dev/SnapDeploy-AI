/**
 * Shared Editor Boundary Reset Helper
 * 
 * Safely synchronizes Monaco and Zustand editor state across transactional boundaries
 * (AI Edit, AI Repair, Snapshot Restore). Clears dirty flags, updates authoritative
 * saved baselines, increments modelEpoch, and disposes Monaco models to guarantee
 * that previous undo stacks cannot resurrect stale pre-mutation/pre-rollback code.
 */
export async function resetEditorBoundary(
  projectId: string,
  postFiles: Record<string, { content: string }>
): Promise<void> {
  const { useEditorStore } = await import('../../store/editorStore');
  useEditorStore.getState().clearDirty(projectId);

  const baselineMap: Record<string, string> = {};
  for (const [p, f] of Object.entries(postFiles)) {
    baselineMap[p] = f.content;
  }
  useEditorStore.getState().resetProjectBaselines(projectId, baselineMap);
  useEditorStore.getState().incrementModelEpoch();

  if (typeof window !== 'undefined' && (window as any).monaco) {
    const { MonacoUndoAdapter } = await import('./monaco-undo-adapter');
    MonacoUndoAdapter.disposeProjectModels((window as any).monaco, projectId);
  }
}
