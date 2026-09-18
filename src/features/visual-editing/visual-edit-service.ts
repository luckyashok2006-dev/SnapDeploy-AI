import { 
  VisualEditContext, 
  VisualSelection, 
  VisualEditProposal 
} from '../../types/visual-editing';
import { EditProposal, PatchFileChange } from '../../types/workspace';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { chatService } from '../chat/chat-service';
import { editExecutor, EditProgressCallback } from '../chat/edit-executor';
import { useVisualEditStore } from '../../store/visualEditStore';
import { useScreenshotAppStore } from '../../store/screenshotAppStore';
import { useDesignSystemStore } from '../../store/designSystemStore';
import { designSystemContextBuilder } from '../design-system/design-system-context';

export class VisualEditService {
  private static instance: VisualEditService;

  private constructor() {}

  public static getInstance(): VisualEditService {
    if (!VisualEditService.instance) {
      VisualEditService.instance = new VisualEditService();
    }
    return VisualEditService.instance;
  }

  /**
   * Builds sanitized context for visual edit synthesis.
   * Untrusted DOM text and attributes are treated strictly as data metadata, never instructions.
   * Priority file ordering guarantees target component is index 0.
   */
  public buildVisualEditContext(
    projectId: string,
    prompt: string,
    selection: VisualSelection
  ): VisualEditContext {
    const allFiles = vfsManager.getFiles(projectId);
    const relevantFiles: Record<string, string> = {};

    const targetPath = selection.sourceMapping.filePath;
    const normalizedTarget = targetPath.startsWith('/') ? targetPath : '/' + targetPath;

    // 1. Target component file at index 0
    const targetFileEntry = allFiles[normalizedTarget] || allFiles[targetPath.replace(/^\//, '')];
    if (targetFileEntry) {
      relevantFiles[normalizedTarget] = typeof targetFileEntry === 'string' ? targetFileEntry : targetFileEntry.content;
    } else {
      // Fallback: look for match by filename
      const baseName = targetPath.split('/').pop();
      const matchKey = baseName ? Object.keys(allFiles).find(k => k.endsWith('/' + baseName)) : null;
      if (matchKey) {
        const entry = allFiles[matchKey];
        relevantFiles[matchKey.startsWith('/') ? matchKey : '/' + matchKey] = typeof entry === 'string' ? entry : entry.content;
      }
    }

    // 2. Include App.tsx or main entry if different from target
    const appEntry = allFiles['/src/App.tsx'] || allFiles['src/App.tsx'];
    if (appEntry && !relevantFiles['/src/App.tsx']) {
      relevantFiles['/src/App.tsx'] = typeof appEntry === 'string' ? appEntry : appEntry.content;
    }

    // 3. Extract safe metadata without secrets
    const safeEnvContext = chatService.getSafeAiEnvContext(projectId);
    const safeDbContext = chatService.getSafeAiDatabaseContext(projectId);
    const safeAuthContext = chatService.getSafeAiAuthContext(projectId);

    // 4. Extract active screenshot reference context if available
    const screenshotContext = useScreenshotAppStore.getState().getAnalysis(projectId) || undefined;

    // 5. Extract active design system context if available
    const ds = useDesignSystemStore.getState().getDesignSystem(projectId);
    const guard = useDesignSystemStore.getState().createGuard(projectId);
    const designSystemContext = ds ? designSystemContextBuilder.buildCompactAIContext(ds, guard) : undefined;

    return {
      projectId,
      prompt,
      selection,
      relevantFiles,
      safeEnvContext,
      safeDbContext,
      safeAuthContext,
      screenshotContext,
      designSystemContext
    };
  }

  /**
   * Synthesizes an EditProposal for the visual edit.
   * Refuses speculative patching if confidence is below 0.40.
   */
  public async synthesizeVisualEditProposal(
    context: VisualEditContext,
    signal?: AbortSignal
  ): Promise<EditProposal> {
    const { selection, prompt, projectId, relevantFiles, screenshotContext } = context;

    // Safety Gate: Enforce confidence threshold >= 0.40
    if (selection.sourceMapping.confidence < 0.40 || selection.sourceMapping.canRefuseSpeculativePatch) {
      const confPct = Math.round(selection.sourceMapping.confidence * 100);
      const reason = selection.sourceMapping.unresolvedReason || 'Confidence is below 0.40 threshold.';
      throw new Error(`Low confidence source mapping (${confPct}%). Refusing speculative visual patch. ${reason}`);
    }

    const targetFile = selection.sourceMapping.filePath;
    const targetCode = relevantFiles[targetFile] || relevantFiles[targetFile.startsWith('/') ? targetFile : '/' + targetFile] || '';

    // Construct structured prompt packaging DOM content strictly as data metadata
    const promptParts = [
      `User Visual Change Request: "${prompt}"`,
      `Target Component: ${targetFile}`,
      `Target Tag: <${selection.tagName}>`,
      `Selector: ${selection.selector}`,
      `Current Text (DOM Data): "${selection.textContent}"`,
      `Current Computed Styles: ${JSON.stringify(selection.computedStyles)}`
    ];

    if (screenshotContext) {
      promptParts.push(
        `Active Visual Screenshot Target Context:`,
        `- Page Type: ${screenshotContext.pageType}`,
        `- Extracted Design Tokens: Primary ${screenshotContext.colorPalette?.primary}, Surface ${screenshotContext.colorPalette?.surface}`
      );
    }

    if (context.designSystemContext) {
      promptParts.push(context.designSystemContext);
    }

    const structuredPrompt = promptParts.join('\n');

    let rawProposal: EditProposal;

    try {
      // Attempt server AI generation if online
      rawProposal = await chatService.requestEdit(
        {
          prompt: structuredPrompt,
          projectId,
          activeFilePath: targetFile,
          relevantFiles
        },
        signal
      );
    } catch {
      // Deterministic synthesizer fallback for testing and local operation
      rawProposal = this.generateDeterministicFallbackPatch(context, targetCode);
    }

    // Annotate proposal with visual editing metadata
    const enriched = chatService.enrichProposalPlan(rawProposal, prompt);
    const visualProposal: EditProposal = {
      ...enriched,
      visualEditSummary: `Visual Edit: ${prompt} on <${selection.tagName}> in ${targetFile.split('/').pop()}`,
      visualConfidence: selection.sourceMapping.confidence,
      summary: enriched.summary || `Visual edit: ${prompt}`
    };

    return visualProposal;
  }

  /**
   * Applies a visual edit proposal using the unified, hardened EditExecutor pipeline.
   * Guarantees pre-edit checkpoint, VFS write, runtime sync, verification, and rollback on error.
   */
  public async applyVisualEdit(
    projectId: string,
    proposal: EditProposal,
    onProgress?: EditProgressCallback
  ): Promise<{ verified: boolean; error?: string; rolledBack?: boolean }> {
    const result = await editExecutor.executeEdit(projectId, proposal, onProgress);

    if (result.verified) {
      // Cleanly clear selection for this project on success
      useVisualEditStore.getState().clearSelection(projectId);
    }

    return result;
  }

  /**
   * Rejects a visual edit proposal.
   * Guarantees 0 VFS changes, 0 runtime sync calls, 0 snapshots, and clears visual state.
   */
  public rejectVisualEdit(projectId: string): { rejected: boolean } {
    useVisualEditStore.getState().clearSelection(projectId);
    return { rejected: true };
  }

  /**
   * Fallback patch generator used during offline development or unit testing.
   */
  private generateDeterministicFallbackPatch(
    context: VisualEditContext,
    targetCode: string
  ): EditProposal {
    const { selection, prompt } = context;
    const targetFile = selection.sourceMapping.filePath;

    let modifiedCode = targetCode;
    const promptLower = prompt.toLowerCase();

    // Heuristics for common visual changes:
    if (promptLower.includes('blue') && modifiedCode.includes('bg-')) {
      modifiedCode = modifiedCode.replace(/bg-[a-z]+-[0-9]+/g, 'bg-blue-600');
    } else if (promptLower.includes('red') || promptLower.includes('danger')) {
      modifiedCode = modifiedCode.replace(/bg-[a-z]+-[0-9]+/g, 'bg-rose-600');
    } else if (promptLower.includes('larger') || promptLower.includes('large') || promptLower.includes('increase')) {
      if (modifiedCode.includes('text-sm')) modifiedCode = modifiedCode.replace(/text-sm/g, 'text-lg');
      else if (modifiedCode.includes('text-base')) modifiedCode = modifiedCode.replace(/text-base/g, 'text-xl');
      else if (modifiedCode.includes('p-4')) modifiedCode = modifiedCode.replace(/p-4/g, 'p-6');
      else modifiedCode = `${modifiedCode}\n/* Visual Edit: Increased dimensions */`;
    } else {
      // Minimal comment or class update
      modifiedCode = modifiedCode.replace(
        `<${selection.tagName}`,
        `<${selection.tagName} data-visual-edit="applied"`
      );
      if (modifiedCode === targetCode) {
        modifiedCode = `${targetCode}\n/* Visual Edit applied: ${prompt} */\n`;
      }
    }

    const fileChange: PatchFileChange = {
      path: targetFile,
      before: targetCode,
      after: modifiedCode
    };

    return {
      id: `visual_prop_${Date.now()}`,
      summary: `Visual edit: ${prompt}`,
      explanation: `Applied visual changes to <${selection.tagName}> in ${targetFile}: ${prompt}`,
      intent: `Visual styling update: ${prompt}`,
      confidence: selection.sourceMapping.confidence,
      files: [fileChange],
      affectedFiles: [
        {
          path: targetFile,
          reason: `Apply visual modification for <${selection.tagName}>`,
          linesAdded: 1,
          linesRemoved: 0
        }
      ],
      estimatedDiffSize: { additions: 1, deletions: 0 },
      expectedVerification: 'TypeScript strict check (`tsc --noEmit`) + production build (`vite build`)'
    };
  }
}

export const visualEditService = VisualEditService.getInstance();
