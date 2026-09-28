import { ExecutionEvidence, RepairEpisode, Diagnosis, Patch, RepairPlan, VerificationResult } from '../../types/workspace';
import { useRepairStore } from '../../store/repairStore';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { repairLoopEngine } from './repair-loop';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { isEligibleForAutoRepair } from './repair-policy';
import { classifyFailureEvidence } from './failure-classifier';
import { createRepairPlan } from './repair-planner';

export { isEligibleForAutoRepair } from './repair-policy';
export { classifyFailureEvidence } from './failure-classifier';
export { createRepairPlan } from './repair-planner';

/**
 * Sanitizes runtime execution evidence before it can enter AI context or telemetry.
 * Strips secret tokens, passwords, bearer headers, and user home directory paths.
 */
export function sanitizeExecutionEvidence(evidence: ExecutionEvidence): ExecutionEvidence {
  const sanitizeText = (text?: string | null): string => {
    if (!text) return '';
    return text
      .replace(/AIza[0-9A-Za-z-_]{30,40}/g, '[REDACTED_GEMINI_KEY]')
      .replace(/(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/g, '[REDACTED_API_KEY]')
      .replace(/ghp_[a-zA-Z0-9]+/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/token\s+[a-zA-Z0-9_.-]+/gi, 'token [REDACTED]')
      .replace(/password\s*[:=]\s*["']?[^"'\s\n]+/gi, 'password=[REDACTED]')
      .replace(/([A-Za-z0-9+/]{40,}=*)/g, '[REDACTED_SECRET]')
      .replace(/([a-zA-Z]:)?[\\\/]Users[\\\/][^\\\/]+/gi, '/home/user')
      .replace(/\/Users\/[^\/\s]+/gi, '/home/user')
      .replace(/\/home\/[^\/\s]+/gi, '/home/user');
  };

  return {
    ...evidence,
    command: sanitizeText(evidence.command),
    stdout: sanitizeText(evidence.stdout),
    stderr: sanitizeText(evidence.stderr),
    stackTrace: evidence.stackTrace ? sanitizeText(evidence.stackTrace) : undefined,
    errorContext: evidence.errorContext ? sanitizeText(evidence.errorContext) : undefined
  };
}

/**
 * Computes a deterministic failure fingerprint from sanitized evidence.
 */
export function computeFailureFingerprint(
  evidence: ExecutionEvidence,
  _files?: Record<string, { content: string }>
): string {
  const cmdKey = `${evidence.command}_${evidence.exitCode ?? 'null'}`;
  
  // Extract primary error signature lines (e.g. TS2304, Module not found, SyntaxError)
  const combinedLogs = `${evidence.stderr}\n${evidence.stdout}\n${evidence.stackTrace || ''}`;
  const lines = combinedLogs
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes('SnapDeploy') && !l.includes('vite') && !l.includes('node_modules'));
  
  const errorSignature = lines.slice(0, 3).join('|').replace(/\s+/g, ' ');

  return `fp_${cmdKey}#${errorSignature.slice(0, 100)}`;
}

/**
 * Detects files relevant to the failure using the Phase C evidence-first hierarchy:
 * 1. Exact compiler/runtime diagnostic path with line:col
 * 2. Stack-trace referenced file
 * 3. Direct import/dependency relationship
 * 4. Related configuration file
 * 5. Project entry file
 * 6. Broader project context only when necessary
 * All returned paths are guaranteed to exist in the target project VFS.
 */
export function getRelevantFilesForFailure(
  evidence: ExecutionEvidence,
  files: Record<string, { content: string }>
): string[] {
  const logs = `${evidence.stderr}\n${evidence.stdout}\n${evidence.stackTrace || ''}`;
  const foundPaths = new Set<string>();

  // 1. Diagnostic path with line:col (e.g. src/App.tsx:14:5 or /src/App.tsx(14,5))
  const locMatches = logs.match(/(?:(?:\/)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+))[:\(](\d+)[:,\s](\d+)\)?/g) || [];
  for (const match of locMatches) {
    const clean = match.replace(/[:\(].*$/, '').replace(/\\/g, '/').replace(/^.*?(src\/)/, 'src/');
    const candidates = [clean, `/${clean}`, clean.startsWith('/') ? clean.slice(1) : `/${clean}`];
    for (const c of candidates) {
      if (files[c]) foundPaths.add(c.startsWith('/') ? c : `/${c}`);
    }
  }

  // 2. Stack trace references (e.g. at ... (/path/file.tsx:12:3) or at App (src/App.tsx:24:1))
  const stackMatches = logs.match(/at\s+.*?\((?:.*?\/)?(src\/[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+):\d+:\d+\)/g) || [];
  for (const match of stackMatches) {
    const fileExtract = match.match(/(src\/[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/);
    if (fileExtract) {
      const clean = fileExtract[1];
      const candidates = [clean, `/${clean}`, clean.startsWith('/') ? clean.slice(1) : `/${clean}`];
      for (const c of candidates) {
        if (files[c]) foundPaths.add(c.startsWith('/') ? c : `/${c}`);
      }
    }
  }

  // 3. General file path mentions in error text (e.g. src/components/Card.tsx)
  const pathMatches = logs.match(/(?:[a-zA-Z0-9_\-./\\]+\.(?:tsx|ts|jsx|js|css|json|html|mjs|cjs))/gi) || [];
  for (const rawMatch of pathMatches) {
    const clean = rawMatch.replace(/\\/g, '/').replace(/^.*?(src\/)/, 'src/');
    const candidates = [clean, `/${clean}`, clean.startsWith('/') ? clean.slice(1) : `/${clean}`];
    for (const cand of candidates) {
      if (files[cand]) {
        foundPaths.add(cand.startsWith('/') ? cand : `/${cand}`);
      }
    }
  }

  // 4. Import / dependency relationship search
  const unresolvedMatch = logs.match(/(?:Cannot find module|Could not resolve|Failed to resolve import|Cannot find name)\s+['"]([^'"]+)['"]/i);
  if (unresolvedMatch) {
    const term = unresolvedMatch[1];
    for (const [path, f] of Object.entries(files)) {
      if (f.content.includes(term) && !path.includes('node_modules')) {
        foundPaths.add(path.startsWith('/') ? path : `/${path}`);
      }
    }
  }

  // 5. Relevant configuration files based on failure nature
  if (/Cannot find module|Module not found|ERR_MODULE_NOT_FOUND|npm ERR! 404/i.test(logs)) {
    if (files['/package.json'] || files['package.json']) {
      foundPaths.add('/package.json');
    }
  }
  if (/error TS\d+|tsconfig/i.test(logs)) {
    if (files['/tsconfig.json'] || files['tsconfig.json']) {
      foundPaths.add('/tsconfig.json');
    }
  }
  if (/RollupError|vite:esbuild|vite\.config/i.test(logs)) {
    if (files['/vite.config.ts'] || files['vite.config.ts']) {
      foundPaths.add('/vite.config.ts');
    }
  }

  if (foundPaths.size > 0) {
    return Array.from(foundPaths).slice(0, 8).sort();
  }

  // 6. Project entry files fallback
  for (const defaultPath of ['/src/App.tsx', 'src/App.tsx', '/src/index.tsx', '/src/main.tsx']) {
    if (files[defaultPath]) {
      return [defaultPath.startsWith('/') ? defaultPath : `/${defaultPath}`];
    }
  }

  // 7. First source file fallback
  const firstSrc = Object.keys(files).find((k) => k.includes('src/'));
  if (firstSrc) {
    return [firstSrc.startsWith('/') ? firstSrc : `/${firstSrc}`];
  }

  return Object.keys(files).slice(0, 3).sort();
}

/**
 * Computes a deterministic hash of the contents of relevant files.
 */
export function computeRelevantCodeHash(
  files: Record<string, { content: string }>,
  relevantPaths: string[]
): string {
  let hash = 0;
  const sorted = [...relevantPaths].sort();
  for (const p of sorted) {
    const unslashed = p.replace(/^\/+/, '');
    const f = files[p] || files[unslashed] || files[`/${unslashed}`];
    const content = f ? f.content : '';
    const str = `${p}:${content}`;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
  }
  return `hash_${hash}`;
}

export class RepairCoordinator {
  private static instance: RepairCoordinator;
  private activeControllers: Record<string, AbortController> = {};

  private constructor() {}

  public static getInstance(): RepairCoordinator {
    if (!RepairCoordinator.instance) {
      RepairCoordinator.instance = new RepairCoordinator();
    }
    return RepairCoordinator.instance;
  }

  /**
   * Main runtime entry point when a command or process encounters an error.
   */
  public async handleRuntimeFailure(
    projectId: string,
    rawEvidence: ExecutionEvidence
  ): Promise<RepairEpisode | null> {
    if (!projectId) return null;

    // 1. Only process real, eligible failures
    const isEligible = isEligibleForAutoRepair(
      rawEvidence.command,
      rawEvidence.args,
      rawEvidence.exitCode,
      rawEvidence.timedOut,
      rawEvidence
    );
    if (!isEligible) {
      console.log(`[RepairCoordinator] Command '${rawEvidence.command}' is not eligible for automated self-healing.`);
      return null;
    }

    // 2. Sanitize evidence
    const sanitizedEvidence = sanitizeExecutionEvidence(rawEvidence);

    // 3. Check if loop is paused for this project
    const store = useRepairStore.getState();
    if (store.isProjectLoopPaused(projectId)) {
      console.log(`[RepairCoordinator] Repair loop paused for project '${projectId}'. Skipping automated diagnosis.`);
      return null;
    }

    // 4. Compute deterministic failure fingerprint and relevant code-state hash
    const currentFiles = vfsManager.getFiles(projectId);
    const relevantPaths = getRelevantFilesForFailure(sanitizedEvidence, currentFiles);
    const codeHash = computeRelevantCodeHash(currentFiles, relevantPaths);
    const fingerprint = computeFailureFingerprint(sanitizedEvidence, currentFiles);
    const evidenceFingerprint = `ev_${sanitizedEvidence.executionId}_${Date.now()}`;

    // 5. Duplicate failure suppression: Check if already processed on THIS code state or actively in flight
    const activeEpisode = store.getActiveEpisode(projectId);
    // 5. Duplicate failure suppression: Check if already processed on THIS code state or actively in flight
    if (store.hasFingerprint(projectId, fingerprint, codeHash)) {
      console.log(`[RepairCoordinator] Duplicate failure suppressed: Error fingerprint already processed for this code state: ${fingerprint.slice(0, 40)}`);
      return null;
    }

    // Record fingerprint with code state hash in store
    store.recordFingerprint(projectId, fingerprint, codeHash);

    // 6. Create new episode
    sanitizedEvidence.projectId = projectId;
    const episode = store.createEpisode(projectId, sanitizedEvidence, fingerprint, evidenceFingerprint);
    console.log(`[RepairCoordinator] Captured new failure episode: '${episode.failureEpisodeId}' (Attempt 1 of ${episode.maxAttempts})`);

    // 7. Trigger diagnosis & proposal generation
    this.runEpisodeDiagnosis(projectId, episode.failureEpisodeId).catch((err) => {
      console.error(`[RepairCoordinator] Automated diagnosis failed for episode '${episode.failureEpisodeId}':`, err);
    });

    return episode;
  }

  /**
   * Executes AI diagnosis and repair proposal synthesis for an episode.
   */
  public async runEpisodeDiagnosis(
    projectId: string,
    episodeId: string
  ): Promise<RepairEpisode | null> {
    const store = useRepairStore.getState();
    const episode = store.getProjectEpisodes(projectId).find((ep) => ep.failureEpisodeId === episodeId);
    if (!episode) return null;

    // Enforce max repair attempts limit
    if (episode.attemptNumber > episode.maxAttempts) {
      store.blockEpisode(projectId, episodeId, `Maximum repair attempts (${episode.maxAttempts}) exceeded.`);
      return store.getProjectEpisodes(projectId).find((ep) => ep.failureEpisodeId === episodeId) || null;
    }

    // Cancel any existing in-flight diagnosis controller for this project
    if (this.activeControllers[projectId]) {
      this.activeControllers[projectId].abort();
      delete this.activeControllers[projectId];
    }

    const controller = new AbortController();
    this.activeControllers[projectId] = controller;

    store.updateEpisodeStatus(projectId, episodeId, 'diagnosing');
    useAgentStore.getState().setIsDiagnosing(true);

    try {
      const { diagnosis, patch, plan } = await repairLoopEngine.runDiagnosisAndPatch(
        projectId,
        episode.evidence
      );

      // Verify controller wasn't aborted
      if (controller.signal.aborted) {
        console.log(`[RepairCoordinator] Diagnosis for episode '${episodeId}' was cancelled.`);
        store.updateEpisodeStatus(projectId, episodeId, 'cancelled', { error: 'Diagnosis cancelled by user.' });
        return null;
      }

      // Check episode status wasn't cancelled or superseded or project deleted
      const currentEpisode = store.getProjectEpisodes(projectId).find((ep) => ep.failureEpisodeId === episodeId);
      if (!currentEpisode || (currentEpisode.status !== 'diagnosing' && currentEpisode.status !== 'DIAGNOSING')) {
        console.log(`[RepairCoordinator] Episode '${episodeId}' was cancelled or deleted.`);
        return null;
      }

      const proposalFingerprint = `patch_${patch.id}_${patch.files.length}`;
      store.setEpisodeProposal(projectId, episodeId, diagnosis, patch, proposalFingerprint, plan);

      // Synchronize canonical project-scoped state to agentStore
      useAgentStore.getState().setDiagnosis(diagnosis, projectId);
      useAgentStore.getState().setPendingPatch(patch, projectId, false);

      const activeProjId = useProjectStore.getState().activeProjectId;
      if (!activeProjId || activeProjId === projectId) {
        useAgentStore.getState().setIsDiagnosing(false);
      }

      console.log(`[RepairCoordinator] Repair proposal ready for review for episode '${episodeId}'. Awaiting user approval.`);
      return store.getProjectEpisodes(projectId).find((ep) => ep.failureEpisodeId === episodeId) || null;
    } catch (err: any) {
      if (controller.signal.aborted) return null;

      useAgentStore.getState().setIsDiagnosing(false);
      const errorMsg = err?.message || 'AI Diagnosis failed.';
      store.markDiagnosisFailed(projectId, episodeId, errorMsg);
      console.warn(`[RepairCoordinator] Diagnosis error for episode '${episodeId}':`, errorMsg);
      throw err;
    } finally {
      if (this.activeControllers[projectId] === controller) {
        delete this.activeControllers[projectId];
      }
    }
  }

  /**
   * User approves the repair proposal: executes patch application, runtime sync, and verification.
   */
  public async approveRepair(
    projectId: string,
    episodeId: string,
    onProgress?: (stage: string, message: string) => void
  ): Promise<{ verified: boolean; error?: string; verificationResult?: VerificationResult }> {
    const store = useRepairStore.getState();
    const episode = store.getProjectEpisodes(projectId).find((ep) => ep.failureEpisodeId === episodeId);
    if (!episode || !episode.patch) {
      return { verified: false, error: 'No repair proposal found for this episode.' };
    }
    if (episode.status !== 'proposal_ready' && episode.status !== 'PATCH_READY' && episode.status !== 'AWAITING_APPROVAL') {
      return { verified: false, error: `Cannot approve episode in '${episode.status}' status.` };
    }

    store.updateEpisodeStatus(projectId, episodeId, 'applying');
    useAgentStore.getState().setIsRepairing(true);

    try {
      store.updateEpisodeStatus(projectId, episodeId, 'verifying');
      const result = await repairLoopEngine.applyPatchAndVerify(projectId, episode.patch, onProgress);

      useAgentStore.getState().setIsRepairing(false);

      // Stale verification check: ensure episode wasn't cancelled or superseded during verification
      const verifyEpisode = store.getProjectEpisodes(projectId).find((ep) => ep.failureEpisodeId === episodeId);
      if (!verifyEpisode || (verifyEpisode.status !== 'verifying' && verifyEpisode.status !== 'VERIFYING')) {
        return { verified: false, error: 'Episode state was superseded or cancelled during verification.' };
      }

      if (result.verified) {
        store.resolveEpisode(projectId, episodeId, result.verificationResult);
        useAgentStore.getState().setPendingPatch(null, projectId);
        useAgentStore.getState().setIsDiffModalOpen(false);
        try {
          const { useRuntimeStore } = await import('../../store/runtimeStore');
          useRuntimeStore.getState().clearEvidence(projectId);
        } catch {}
        console.log(`[RepairCoordinator] Episode '${episodeId}' resolved and verified successfully!`);
        return { verified: true, verificationResult: result.verificationResult };
      } else {
        const errorMsg = result.error || 'Verification checks failed.';
        store.markVerificationFailed(projectId, episodeId, errorMsg);
        store.rollbackEpisode(projectId, episodeId, errorMsg, result.verificationResult);
        console.warn(`[RepairCoordinator] Episode '${episodeId}' verification failed. Rolled back.`);
        return { verified: false, error: errorMsg, verificationResult: result.verificationResult };
      }
    } catch (err: any) {
      useAgentStore.getState().setIsRepairing(false);
      const errorMsg = err?.message || 'Failed to apply repair patch.';
      store.markVerificationFailed(projectId, episodeId, errorMsg);
      store.rollbackEpisode(projectId, episodeId, errorMsg);
      return { verified: false, error: errorMsg };
    }
  }

  /**
   * User rejects the repair proposal: marks episode rejected with zero code mutation.
   */
  public rejectRepair(projectId: string, episodeId: string): void {
    const store = useRepairStore.getState();
    store.rejectEpisode(projectId, episodeId);
    useAgentStore.getState().setPendingPatch(null, projectId);
    useAgentStore.getState().setIsDiffModalOpen(false);
    console.log(`[RepairCoordinator] Episode '${episodeId}' rejected by user. Zero project files mutated.`);
  }

  /**
   * Cancels in-flight diagnosis.
   */
  public cancelDiagnosis(projectId: string): void {
    if (this.activeControllers[projectId]) {
      this.activeControllers[projectId].abort();
      delete this.activeControllers[projectId];
    }
    useAgentStore.getState().setIsDiagnosing(false);
    const store = useRepairStore.getState();
    const episodes = store.getProjectEpisodes(projectId);
    for (const ep of episodes) {
      if (ep.status === 'diagnosing' || ep.status === 'captured') {
        store.updateEpisodeStatus(projectId, ep.failureEpisodeId, 'cancelled', { error: 'Diagnosis cancelled by user.' });
      }
    }
  }

  public pauseRepairLoop(projectId: string): void {
    useRepairStore.getState().pauseLoop(projectId);
    this.cancelDiagnosis(projectId);
  }

  public resumeRepairLoop(projectId: string): void {
    useRepairStore.getState().resumeLoop(projectId);
  }
}

export const repairCoordinator = RepairCoordinator.getInstance();
