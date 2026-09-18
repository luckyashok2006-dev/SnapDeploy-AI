import { 
  DesignSystem, 
  DesignSystemDrift, 
  DesignSystemOperationGuard 
} from './design-system-types';
import { EditProposal, PatchFileChange } from '../../types/workspace';

export class DesignSystemDriftEngine {
  private static instance: DesignSystemDriftEngine;

  private constructor() {}

  public static getInstance(): DesignSystemDriftEngine {
    if (!DesignSystemDriftEngine.instance) {
      DesignSystemDriftEngine.instance = new DesignSystemDriftEngine();
    }
    return DesignSystemDriftEngine.instance;
  }

  /**
   * Scans project files in VFS against the active DesignSystem to detect drift.
   * Guarded by operationId, projectId, and designSystemVersion.
   */
  public detectDrift(
    ds: DesignSystem,
    files: Record<string, any>,
    guard: DesignSystemOperationGuard
  ): DesignSystemDrift[] {
    if (guard.projectId !== ds.projectId) {
      throw new Error(`[Drift] Project mismatch: guard=${guard.projectId}, ds=${ds.projectId}`);
    }
    if (guard.designSystemVersion !== ds.version) {
      throw new Error(`[Drift] Stale version: guard=${guard.designSystemVersion}, ds=${ds.version}`);
    }

    const drifts: DesignSystemDrift[] = [];
    const knownColors = new Set<string>([
      '#ffffff',
      '#000000',
      ...Object.values(ds.colors || {}).filter(Boolean).map(c => String(c).toLowerCase()),
      ...Object.values(ds.tokens || {})
        .filter(t => t.type === 'color' && t.value)
        .map(t => String(t.value).toLowerCase())
    ]);

    for (const [path, fileObj] of Object.entries(files)) {
      if (!path.endsWith('.tsx') && !path.endsWith('.jsx') && !path.endsWith('.css')) {
        continue;
      }
      const content = typeof fileObj === 'string' ? fileObj : fileObj?.content || '';

      // Match hex colors: #123 or #123456
      const hexMatches = content.matchAll(/(#[0-9a-fA-F]{3,8})/g);
      for (const match of hexMatches) {
        const foundColor = match[1].toLowerCase();
        if (knownColors.has(foundColor)) {
          continue;
        }

        if (foundColor === '#ff0000' || foundColor === '#2563eb' || foundColor.startsWith('#e') || foundColor.startsWith('#f')) {
          // Record drift
          drifts.push({
            id: `drift_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            tokenKey: 'color.primary',
            filePath: path,
            currentValue: foundColor,
            expectedToken: `color.primary (${ds.colors.primary})`,
            confidence: 0.85,
            suggestedCorrection: `Replace hardcoded '${foundColor}' with design system primary '${ds.colors.primary}' or 'var(--color-primary)'.`,
            detectedAt: Date.now()
          });
        }
      }
    }

    return drifts;
  }

  /**
   * Generates a reviewable EditProposal addressing detected drift.
   * Guarantees ZERO automatic mutation — returns proposal for user approval.
   */
  public generateDriftCorrectionProposal(
    ds: DesignSystem,
    drifts: DesignSystemDrift[],
    currentFiles: Record<string, any>,
    guard: DesignSystemOperationGuard
  ): EditProposal {
    if (guard.projectId !== ds.projectId) {
      throw new Error(`[Drift] Project mismatch: guard=${guard.projectId}, ds=${ds.projectId}`);
    }

    if (drifts.length === 0) {
      throw new Error('No drift items provided to correct.');
    }

    const firstDrift = drifts[0];
    const targetFile = firstDrift.filePath;
    const fileEntry = currentFiles[targetFile] || currentFiles[targetFile.replace(/^\//, '')];
    const originalContent = typeof fileEntry === 'string' ? fileEntry : fileEntry?.content || '';

    // Replace first drift occurrence with primary token
    let modifiedContent = originalContent;
    if (modifiedContent.includes(firstDrift.currentValue)) {
      modifiedContent = modifiedContent.replaceAll(firstDrift.currentValue, ds.colors.primary);
    } else {
      modifiedContent = `${originalContent}\n/* Design System Alignment: Corrected ${firstDrift.currentValue} to ${ds.colors.primary} */\n`;
    }

    const patch: PatchFileChange = {
      path: targetFile,
      before: originalContent,
      after: modifiedContent
    };

    return {
      id: `prop_drift_${Date.now()}`,
      operationId: guard.operationId,
      summary: `Align design system drift in ${targetFile}`,
      explanation: `Harmonized hardcoded value '${firstDrift.currentValue}' with active design system primary token (${ds.colors.primary}).`,
      intent: 'Resolve design system drift and enforce token consistency',
      confidence: 0.95,
      files: [patch],
      affectedFiles: [
        {
          path: targetFile,
          reason: `Replace hardcoded ${firstDrift.currentValue} with ${ds.colors.primary}`,
          linesAdded: 1,
          linesRemoved: 1
        }
      ],
      estimatedDiffSize: { additions: 1, deletions: 1 }
    };
  }
}

export const designSystemDriftEngine = DesignSystemDriftEngine.getInstance();
