import { useDeploymentStore } from '../../store/deploymentStore';
import { useProjectStore } from '../../store/projectStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { DeploymentRecord, DeploymentProviderId, ExecutionEvidence } from '../../types/workspace';
import { DeploymentProvider } from './providers/provider-interface';
import { MockDeploymentProvider } from './providers/mock-provider';
import { NetlifyProvider } from './providers/netlify-provider';
import { runPreDeploymentChecks, executeBuildGate } from './build/build-gate';
import { packageDeploymentArtifact } from './packaging/artifact-packager';
import { sanitizeDeploymentError } from './security/secret-sanitizer';
import { isProductionEnvironment } from '../../lib/environment';

// Single instances of providers
const mockProvider = new MockDeploymentProvider();
const netlifyProvider = new NetlifyProvider();

export function getProviderInstance(providerId: DeploymentProviderId): DeploymentProvider {
  if (providerId === 'netlify') {
    return netlifyProvider;
  }
  return mockProvider;
}

// In-flight deployment lock set
const inFlightDeployments = new Set<string>();

/**
 * Coordinates the full one-click deployment workflow for a project.
 * Enforces:
 * 1. Read-only authoritative VFS consumption (zero source mutation).
 * 2. Strict build gate execution before packaging.
 * 3. In-memory artifact creation with strict limit enforcement.
 * 4. Provider-side environment variable transmission without build injection.
 * 5. Sanitized metadata-only history recording.
 */
export async function executeDeployment(
  projectId: string,
  options?: { providerId?: DeploymentProviderId }
): Promise<DeploymentRecord> {
  const store = useDeploymentStore.getState();
  const projectStore = useProjectStore.getState();
  const runtimeStore = useRuntimeStore.getState();

  const project = projectStore.projects[projectId];
  if (!project) {
    throw new Error(`Cannot deploy: project '${projectId}' does not exist.`);
  }

  if (inFlightDeployments.has(projectId)) {
    throw new Error(`A deployment for project '${project.title}' is already in progress.`);
  }
  inFlightDeployments.add(projectId);

  const abortController = new AbortController();
  store.setAbortController(projectId, abortController);

  const providerId = options?.providerId || store.selectedProvider;
  const provider = getProviderInstance(providerId);

  const startTime = Date.now();
  let buildDurationMs = 0;
  let fileCount = 0;
  let artifactSizeBytes = 0;

  try {
    // Defense-in-depth: independently reject any mock provider invocation in production
    if (isProductionEnvironment() && (providerId === 'mock' || options?.providerId === 'mock')) {
      throw new Error('Mock deployment provider is disabled in production. Please select and configure a live deployment provider (e.g., Netlify).');
    }

    // -----------------------------------------------------------------------
    // Stage 1: Pre-Deployment Validation
    // -----------------------------------------------------------------------
    store.setActiveProgress(projectId, {
      status: 'validating',
      progressStage: 'Validating project configuration',
      percent: 10
    });
    runtimeStore.addTerminalLog(`\x1b[36m[Deploy]\x1b[0m Validating project '${project.title}' for deployment...`, projectId);

    const preChecks = runPreDeploymentChecks(projectId);
    if (!preChecks.canDeploy) {
      throw new Error(preChecks.error || 'Pre-deployment validation failed.');
    }

    if (abortController.signal.aborted) {
      throw new DOMException('Deployment cancelled by user.', 'AbortError');
    }

    // Authenticate provider if needed
    const credToken = store.getCredentials(providerId);
    if (credToken && !provider.isAuthenticated()) {
      await provider.authenticate(credToken);
    }

    if (!provider.isAuthenticated() && providerId !== 'mock') {
      throw new Error(`Deployment provider '${provider.name}' is not authenticated. Please enter a Personal Access Token.`);
    }

    // -----------------------------------------------------------------------
    // Stage 2: Build Gate Execution
    // -----------------------------------------------------------------------
    if (preChecks.requiresBuild) {
      store.setActiveProgress(projectId, {
        status: 'building',
        progressStage: 'Compiling production assets (npm run build)',
        percent: 30
      });
      runtimeStore.addTerminalLog('\x1b[36m[Deploy]\x1b[0m Executing build gate: npm run build...', projectId);

      const buildResult = await executeBuildGate(projectId, (chunk, isErr) => {
        runtimeStore.addTerminalLog(chunk, projectId);
      });

      buildDurationMs = buildResult.buildDurationMs;

      if (!buildResult.success) {
        throw new Error(buildResult.error || 'Production build failed. Deployment aborted.');
      }
    } else {
      runtimeStore.addTerminalLog('\x1b[36m[Deploy]\x1b[0m Static project verified. Bypassing compilation step.', projectId);
    }

    if (abortController.signal.aborted) {
      throw new DOMException('Deployment cancelled by user.', 'AbortError');
    }

    // -----------------------------------------------------------------------
    // Stage 3: Artifact Packaging
    // -----------------------------------------------------------------------
    store.setActiveProgress(projectId, {
      status: 'packaging',
      progressStage: 'Packaging deployment artifact',
      percent: 50
    });
    runtimeStore.addTerminalLog('\x1b[36m[Deploy]\x1b[0m Packaging web assets into in-memory deployment artifact...', projectId);

    const packageResult = await packageDeploymentArtifact(projectId, !preChecks.requiresBuild);
    fileCount = packageResult.fileCount;
    artifactSizeBytes = packageResult.compressedBytes;

    runtimeStore.addTerminalLog(
      `\x1b[32m[Deploy]\x1b[0m Packaged ${fileCount} files (${(artifactSizeBytes / 1024).toFixed(1)} KB) into deployment bundle.`,
      projectId
    );

    if (abortController.signal.aborted) {
      throw new DOMException('Deployment cancelled by user.', 'AbortError');
    }

    // -----------------------------------------------------------------------
    // Stage 4: Provider Upload & Live Deployment
    // -----------------------------------------------------------------------
    store.setActiveProgress(projectId, {
      status: 'uploading',
      progressStage: `Uploading artifact to ${provider.name}`,
      percent: 70
    });

    // Extract provider-side environment variables (NEVER injected into local build)
    const envVars = store.getProjectEnvVars(projectId);
    const providerEnvMap: Record<string, string> = {};
    for (const item of envVars) {
      if (item.value) {
        providerEnvMap[item.key] = item.value;
      }
    }

    // Lookup existing siteId from prior deployments for redeployment continuity
    const priorDeployments = store.deployments[projectId] || [];
    const existingSiteId = priorDeployments.find((d) => d.siteId && d.provider === providerId)?.siteId;

    const deployResult = await provider.deploy({
      projectId,
      projectTitle: project.title,
      artifactZip: packageResult.zipBuffer,
      siteId: existingSiteId,
      providerEnvironmentVariables: providerEnvMap,
      signal: abortController.signal,
      onProgress: (stage, percent) => {
        const stageStatus = stage === 'live' ? 'live' : stage === 'uploading' ? 'uploading' : 'deploying';
        store.setActiveProgress(projectId, {
          status: stageStatus,
          progressStage: `Deploying: ${stage}`,
          percent: percent || 85
        });
      }
    });

    const totalDurationMs = Date.now() - startTime;

    // -----------------------------------------------------------------------
    // Stage 5: Live State & Metadata-Only Record
    // -----------------------------------------------------------------------
    const deployRecord: DeploymentRecord = {
      deploymentId: `dep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      projectId,
      timestamp: Date.now(),
      status: 'live',
      provider: providerId,
      url: deployResult.url,
      deployId: deployResult.deployId,
      siteId: deployResult.siteId,
      durationMs: totalDurationMs,
      buildDurationMs: buildDurationMs || undefined,
      fileCount,
      artifactSizeBytes,
      commitSummary: `Deploy #${priorDeployments.length + 1} (${fileCount} files)`
    };

    store.recordDeployment(deployRecord);

    store.setActiveProgress(projectId, {
      status: 'live',
      progressStage: 'Live on Edge Network',
      percent: 100
    });

    runtimeStore.addTerminalLog(
      `\x1b[32m[Deploy Complete]\x1b[0m Successfully deployed '${project.title}' to ${provider.name} in ${totalDurationMs}ms!`,
      projectId
    );
    runtimeStore.addTerminalLog(`\x1b[35m[Deploy Live URL]\x1b[0m ${deployResult.url}`, projectId);

    return deployRecord;
  } catch (err: any) {
    const isAborted = err.name === 'AbortError' || abortController.signal.aborted;
    const sanitizedMsg = sanitizeDeploymentError(err);

    const failureRecord: DeploymentRecord = {
      deploymentId: `dep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      projectId,
      timestamp: Date.now(),
      status: isAborted ? 'cancelled' : 'failed',
      provider: providerId,
      durationMs: Date.now() - startTime,
      buildDurationMs: buildDurationMs || undefined,
      fileCount,
      artifactSizeBytes,
      commitSummary: isAborted ? 'Cancelled by user' : 'Deployment failed',
      errorMessage: sanitizedMsg
    };

    store.recordDeployment(failureRecord);

    store.setActiveProgress(projectId, {
      status: isAborted ? 'cancelled' : 'failed',
      progressStage: isAborted ? 'Deployment cancelled' : 'Deployment failed',
      percent: 0,
      error: sanitizedMsg
    });

    runtimeStore.addTerminalLog(
      `\x1b[31m[Deploy ${isAborted ? 'Cancelled' : 'Failed'}]\x1b[0m ${sanitizedMsg}`,
      projectId
    );

    if (!isAborted) {
      const deployEvidence: ExecutionEvidence = {
        executionId: `deploy_err_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        command: `deploy:${providerId}`,
        args: [project.title],
        exitCode: 1,
        stdout: '',
        stderr: `[Deploy Error - ${provider.name}]: ${sanitizedMsg}`,
        durationMs: Date.now() - startTime,
        stackTrace: sanitizedMsg,
        timedOut: false
      };
      runtimeStore.recordEvidence(deployEvidence, projectId);

      runtimeStore.addTerminalLog(
        `\x1b[33m[Action Required]\x1b[0m Check token validity in Deploy Settings or verify local build with 'npm run build'`,
        projectId
      );
    }

    throw err;
  } finally {
    inFlightDeployments.delete(projectId);
    store.setAbortController(projectId, null);
  }
}
