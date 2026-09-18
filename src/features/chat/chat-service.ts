import { vfsManager } from '../../lib/vfs/vfs-manager';
import { EditInput, EditProposal } from '../../types/workspace';
import { useEnvVarStore } from '../../store/envVarStore';
import { databaseCoordinator } from '../database/database-coordinator';
import { authCoordinator } from '../auth/auth-coordinator';
import { useDesignSystemStore } from '../../store/designSystemStore';
import { designSystemContextBuilder } from '../design-system/design-system-context';

export class ChatService {
  /**
   * Assembles a bounded, deterministic proposal baseline context for an AI Edit request.
   */
  public buildEditContext(
    projectId: string,
    prompt: string,
    activeFilePath?: string
  ): EditInput {
    const allFiles = vfsManager.getFiles(projectId);
    const filePaths = Object.keys(allFiles);

    const relevantFiles: Record<string, string> = {};
    let totalBytes = 0;
    const MAX_CONTEXT_BYTES = 250_000;
    const MAX_CONTEXT_FILES = 25;

    const addFile = (path: string) => {
      const norm = path.startsWith('/') ? path : '/' + path;
      const file = allFiles[norm] || allFiles[path];
      if (!file) return;
      if (relevantFiles[norm]) return;
      if (Object.keys(relevantFiles).length >= MAX_CONTEXT_FILES) return;

      const fileBytes = new TextEncoder().encode(file.content).length;
      if (totalBytes + fileBytes > MAX_CONTEXT_BYTES) return;

      relevantFiles[norm] = file.content;
      totalBytes += fileBytes;
    };

    // 1. Critical project entry & configuration files
    const priorityFiles = [
      '/package.json',
      '/index.html',
      '/src/App.tsx',
      '/src/main.tsx',
      '/src/types/database.ts',
      '/src/lib/db.ts',
      '/src/types/auth.ts',
      '/src/lib/auth.ts',
      '/src/components/AuthModal.tsx',
      '/src/components/ProtectedRoute.tsx',
      '/src/index.css',
      '/vite.config.ts'
    ];
    for (const p of priorityFiles) {
      addFile(p);
    }

    // 2. Currently active open file in Monaco editor and its direct imports
    if (activeFilePath) {
      addFile(activeFilePath);
      const activeContent = allFiles[activeFilePath]?.content || allFiles['/' + activeFilePath.replace(/^\/+/, '')]?.content;
      if (activeContent) {
        // Scan relative imports
        const importRegex = /import\s+.*?\s+from\s+['"](\.[^'"]+)['"]/g;
        let match: RegExpExecArray | null;
        const activeDir = activeFilePath.substring(0, activeFilePath.lastIndexOf('/')) || '/src';
        while ((match = importRegex.exec(activeContent)) !== null) {
          let relPath = match[1];
          if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx') && !relPath.endsWith('.js') && !relPath.endsWith('.jsx')) {
            const candidateTsx = `${activeDir}/${relPath.replace(/^\.\//, '')}.tsx`;
            const candidateTs = `${activeDir}/${relPath.replace(/^\.\//, '')}.ts`;
            if (allFiles[candidateTsx] || allFiles[candidateTsx.replace(/^\/+/, '')]) {
              addFile(candidateTsx);
            } else if (allFiles[candidateTs] || allFiles[candidateTs.replace(/^\/+/, '')]) {
              addFile(candidateTs);
            }
          } else {
            addFile(`${activeDir}/${relPath.replace(/^\.\//, '')}`);
          }
        }
      }
    }

    // 3. Keyword / filename matching from user prompt
    const promptLower = prompt.toLowerCase();
    for (const p of filePaths) {
      const baseName = p.split('/').pop()?.toLowerCase() || '';
      const nameWithoutExt = baseName.replace(/\.[^.]+$/, '');
      if (nameWithoutExt && promptLower.includes(nameWithoutExt)) {
        addFile(p);
      }
    }

    // 4. Fill remaining source files under src/ within budget
    for (const p of filePaths) {
      if (p.startsWith('/src/') || p.startsWith('src/')) {
        addFile(p);
      }
    }

    return {
      prompt,
      projectId,
      activeFilePath: activeFilePath ? (activeFilePath.startsWith('/') ? activeFilePath : '/' + activeFilePath) : undefined,
      relevantFiles,
      projectSummary: {
        name: projectId,
        framework: 'vite-react',
        fileList: filePaths
      }
    };
  }

  /**
   * Dispatches the edit request to the server /api/edit endpoint with AbortController support.
   */
  public async requestEdit(
    input: EditInput,
    signal?: AbortSignal
  ): Promise<EditProposal> {
    const response = await fetch('/api/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input),
      signal
    });

    if (!response.ok) {
      let errorMsg = `Server returned HTTP ${response.status}`;
      try {
        const errorJson = await response.json();
        if (errorJson.error) {
          errorMsg = errorJson.error;
        }
      } catch {}
      throw new Error(errorMsg);
    }

    const rawProposal: EditProposal = await response.json();
    return this.enrichProposalPlan(rawProposal, input.prompt);
  }

  /**
   * Enriches proposal with structured engineering plan, diff estimations, and verification requirements.
   */
  public enrichProposalPlan(proposal: EditProposal, prompt?: string): EditProposal {
    let totalAdditions = 0;
    let totalDeletions = 0;

    const affected = (proposal.files || []).map((file) => {
      const beforeLines = file.before ? file.before.split('\n').length : 0;
      const afterLines = file.after ? file.after.split('\n').length : 0;
      const added = Math.max(0, afterLines - beforeLines);
      const removed = Math.max(0, beforeLines - afterLines);
      totalAdditions += added;
      totalDeletions += removed;

      let reason = 'Apply requested modifications';
      if (file.path.endsWith('App.tsx')) reason = 'Update root application layout and state';
      else if (file.path.includes('/components/')) reason = `Update component logic in ${file.path.split('/').pop()}`;
      else if (file.path.includes('/types/')) reason = 'Update TypeScript interfaces and type definitions';
      else if (file.path.includes('/lib/')) reason = 'Update client utility and service helpers';
      else if (file.path.endsWith('.css')) reason = 'Update stylesheet styling and theme classes';

      return {
        path: file.path,
        reason,
        linesAdded: added,
        linesRemoved: removed
      };
    });

    return {
      ...proposal,
      intent: proposal.intent || (prompt ? prompt.slice(0, 80) : proposal.summary),
      affectedFiles: proposal.affectedFiles && proposal.affectedFiles.length > 0 ? proposal.affectedFiles : affected,
      estimatedDiffSize: proposal.estimatedDiffSize || { additions: totalAdditions, deletions: totalDeletions },
      expectedVerification: proposal.expectedVerification || 'TypeScript strict check (`tsc --noEmit`) + production build (`vite build`)'
    };
  }

  /**
   * Returns safe environment variable metadata for AI prompt context.
   * Strictly EXCLUDES all secret values.
   */
  public getSafeAiEnvContext(projectId: string): string {
    try {
      const metadata = useEnvVarStore.getState().getProjectEnvVarMetadata(projectId);
      if (!metadata || metadata.length === 0) return '';

      const lines = metadata.map((m) =>
        `- ${m.key}: ${m.isClientVisible ? 'Public Client Variable (Vite Bundle)' : 'Provider Secret (Runtime - Value Hidden)'}`
      );
      return `Configured Environment Variables (Metadata Only):\n${lines.join('\n')}`;
    } catch {
      return '';
    }
  }

  /**
   * Returns safe database metadata for AI prompt context.
   * Strictly EXCLUDES all secret credentials and connection strings.
   */
  public getSafeAiDatabaseContext(projectId: string): string {
    try {
      return databaseCoordinator.getSafeAiDatabaseContext(projectId);
    } catch {
      return '';
    }
  }

  /**
   * Returns safe authentication metadata for AI prompt context.
   * Strictly EXCLUDES all secrets, passwords, tokens, and private keys.
   */
  public getSafeAiAuthContext(projectId: string): string {
    try {
      return authCoordinator.getSafeAiAuthContext(projectId);
    } catch {
      return '';
    }
  }

  /**
   * Returns safe active design system metadata for AI prompt context.
   * Strictly formatted as compact structured constraints.
   */
  public getSafeAiDesignSystemContext(projectId: string): string {
    try {
      const ds = useDesignSystemStore.getState().getDesignSystem(projectId);
      if (!ds) return '';
      const guard = useDesignSystemStore.getState().createGuard(projectId);
      return designSystemContextBuilder.buildCompactAIContext(ds, guard);
    } catch {
      return '';
    }
  }
}

export const chatService = new ChatService();
