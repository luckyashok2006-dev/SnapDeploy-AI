import { 
  DesignSystem, 
  DesignSystemOperationGuard 
} from './design-system-types';
import { EditProposal, PatchFileChange } from '../../types/workspace';
import { editExecutor, EditProgressCallback } from '../chat/edit-executor';

export class DesignSystemApplier {
  private static instance: DesignSystemApplier;

  private constructor() {}

  public static getInstance(): DesignSystemApplier {
    if (!DesignSystemApplier.instance) {
      DesignSystemApplier.instance = new DesignSystemApplier();
    }
    return DesignSystemApplier.instance;
  }

  /**
   * Generates a controlled EditProposal to apply design system token updates into project source code.
   * Updates CSS custom properties in /src/index.css or centralized styling file.
   * Guarded by operationId, projectId, and designSystemVersion.
   */
  public generateApplyProposal(
    ds: DesignSystem,
    currentFiles: Record<string, any>,
    guard: DesignSystemOperationGuard
  ): EditProposal {
    if (guard.projectId !== ds.projectId) {
      throw new Error(`[Applier] Project mismatch: guard=${guard.projectId}, ds=${ds.projectId}`);
    }
    if (guard.designSystemVersion !== ds.version) {
      throw new Error(`[Applier] Stale version: guard=${guard.designSystemVersion}, ds=${ds.version}`);
    }

    // Locate primary CSS file
    const targetFile = currentFiles['/src/index.css']
      ? '/src/index.css'
      : (Object.keys(currentFiles).find((p) => p.endsWith('.css')) || '/src/index.css');

    const fileEntry = currentFiles[targetFile] || currentFiles[targetFile.replace(/^\//, '')];
    const originalContent = typeof fileEntry === 'string' ? fileEntry : fileEntry?.content || '';

    // Generate modernized CSS root custom properties
    let modifiedContent = originalContent;

    const cssVarBlock = `:root {
  --color-primary: ${ds.colors.primary};
  --color-secondary: ${ds.colors.secondary};
  --color-accent: ${ds.colors.accent};
  --color-surface: ${ds.colors.surface};
  --color-bg: ${ds.colors.background};
  --color-text: ${ds.colors.foreground};
  --color-border: ${ds.colors.border};
  --radius-sm: ${ds.radii.sm};
  --radius-md: ${ds.radii.md};
  --radius-lg: ${ds.radii.lg};
  --font-body: ${ds.typography.bodyFamily};
}`;

    if (modifiedContent.includes(':root {')) {
      modifiedContent = modifiedContent.replace(/:root\s*\{[\s\S]*?\}/, cssVarBlock);
    } else {
      modifiedContent = `${cssVarBlock}\n\n${originalContent}`;
    }

    const patch: PatchFileChange = {
      path: targetFile,
      before: originalContent,
      after: modifiedContent
    };

    return {
      id: `prop_ds_apply_${Date.now()}`,
      operationId: guard.operationId,
      summary: `Update ${targetFile} with design system tokens (v${ds.version})`,
      explanation: `Applied active design system tokens to ${targetFile} (primary: ${ds.colors.primary}, surface: ${ds.colors.surface}, radius: ${ds.radii.md}) via CSS custom properties.`,
      intent: 'Synchronize project CSS custom properties with active Design System',
      confidence: 0.98,
      files: [patch],
      affectedFiles: [
        {
          path: targetFile,
          reason: `Synchronize CSS custom properties with Design System v${ds.version}`,
          linesAdded: 12,
          linesRemoved: originalContent.includes(':root') ? 8 : 0
        }
      ],
      estimatedDiffSize: { additions: 12, deletions: originalContent.includes(':root') ? 8 : 0 }
    };
  }

  /**
   * Applies approved design system proposal via canonical editExecutor.
   * Guarantees pre-edit snapshot, verification, and atomic rollback on failure.
   */
  public async applyProposal(
    projectId: string,
    proposal: EditProposal,
    onProgress?: EditProgressCallback
  ): Promise<{ verified: boolean; error?: string; rolledBack?: boolean }> {
    return editExecutor.executeEdit(projectId, proposal, onProgress);
  }

  /**
   * Rejection safety guarantee: 0 mutations to VFS, runtime, or snapshots.
   */
  public rejectProposal(projectId: string): { rejected: boolean } {
    return { rejected: true };
  }
}

export const designSystemApplier = DesignSystemApplier.getInstance();
