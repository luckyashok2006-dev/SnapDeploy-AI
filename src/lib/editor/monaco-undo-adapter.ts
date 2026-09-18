import type * as monaco from 'monaco-editor';

export interface MonacoUndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Clean adapter for Monaco editor undo/redo operations.
 * Isolates runtime version/method checks to this single module.
 */
export class MonacoUndoAdapter {
  /**
   * Determine if undo and redo are currently available for the editor's active model.
   */
  static getUndoRedoState(editor: monaco.editor.IStandaloneCodeEditor | null): MonacoUndoRedoState {
    if (!editor) {
      return { canUndo: false, canRedo: false };
    }

    try {
      const model = editor.getModel();
      if (!model || model.isDisposed()) {
        return { canUndo: false, canRedo: false };
      }

      // Monaco 0.52.x textModel defines canUndo() and canRedo() on TextModel instance
      const modelWithUndo = model as unknown as {
        canUndo?: () => boolean;
        canRedo?: () => boolean;
      };

      const canUndo = typeof modelWithUndo.canUndo === 'function' 
        ? Boolean(modelWithUndo.canUndo()) 
        : false;
      const canRedo = typeof modelWithUndo.canRedo === 'function' 
        ? Boolean(modelWithUndo.canRedo()) 
        : false;

      return { canUndo, canRedo };
    } catch {
      return { canUndo: false, canRedo: false };
    }
  }

  /**
   * Trigger undo on the Monaco editor or model.
   * Returns true if triggered successfully.
   */
  static triggerUndo(editor: monaco.editor.IStandaloneCodeEditor | null): boolean {
    if (!editor) return false;

    try {
      const model = editor.getModel();
      if (!model || model.isDisposed()) return false;

      const modelWithUndo = model as unknown as { undo?: () => void };
      if (typeof modelWithUndo.undo === 'function') {
        modelWithUndo.undo();
        return true;
      }

      editor.trigger('toolbar', 'undo', null);
      return true;
    } catch (err) {
      console.warn('[MonacoUndoAdapter] Failed to execute undo:', err);
      return false;
    }
  }

  /**
   * Trigger redo on the Monaco editor or model.
   * Returns true if triggered successfully.
   */
  static triggerRedo(editor: monaco.editor.IStandaloneCodeEditor | null): boolean {
    if (!editor) return false;

    try {
      const model = editor.getModel();
      if (!model || model.isDisposed()) return false;

      const modelWithUndo = model as unknown as { redo?: () => void };
      if (typeof modelWithUndo.redo === 'function') {
        modelWithUndo.redo();
        return true;
      }

      editor.trigger('toolbar', 'redo', null);
      return true;
    } catch (err) {
      console.warn('[MonacoUndoAdapter] Failed to execute redo:', err);
      return false;
    }
  }

  /**
   * Reset the model's undo/redo history by calling setValue, or disposing/recreating.
   * In Monaco, calling setValue() flushes the undo/redo stack completely.
   */
  static resetModelHistory(model: monaco.editor.ITextModel | null, newContent?: string): void {
    if (!model || model.isDisposed()) return;
    try {
      const content = newContent !== undefined ? newContent : model.getValue();
      model.setValue(content);
    } catch (err) {
      console.warn('[MonacoUndoAdapter] Error resetting model history:', err);
    }
  }

  /**
   * Disposes all models associated with a specific project to prevent memory leaks,
   * stale undo resurrection, or cross-project contamination.
   */
  static disposeProjectModels(monacoInstance: typeof monaco | null, projectId: string): void {
    if (!monacoInstance || !monacoInstance.editor) return;
    try {
      const models = monacoInstance.editor.getModels();
      for (const model of models) {
        if (model.isDisposed()) continue;
        const uriStr = model.uri.toString();
        // Check if model belongs to this project
        if (
          uriStr.includes(`/${projectId}/`) || 
          uriStr.includes(`/${projectId}%2F`) ||
          uriStr.includes(`//${projectId}/`)
        ) {
          model.dispose();
        }
      }
    } catch (err) {
      console.warn('[MonacoUndoAdapter] Error disposing project models:', err);
    }
  }
}
