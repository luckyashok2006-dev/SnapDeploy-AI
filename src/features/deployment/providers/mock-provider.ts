import {
  DeploymentProvider,
  DeploymentRequest,
  DeploymentResult,
  DeploymentStatusResponse,
  ProviderAccountInfo
} from './provider-interface';
import { isProductionEnvironment } from '../../../lib/environment';

export type MockFailureMode = 'none' | 'auth' | 'upload' | 'deploy' | 'timeout';

export class MockDeploymentProvider implements DeploymentProvider {
  public readonly id = 'mock';
  public readonly name = 'Mock Provider (Test/Demo)';
  public readonly description = 'Deterministic in-memory deployment provider for testing and offline development';

  private static failureMode: MockFailureMode = 'none';
  private static latencyMs = 20;

  private connectedToken: string | null = null;
  private accountInfo: ProviderAccountInfo | null = null;

  constructor() {
    if (!isProductionEnvironment()) {
      this.connectedToken = 'mock-test-token';
      this.accountInfo = {
        username: 'snapdeploy-tester',
        email: 'tester@snapdeploy.local',
        avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4'
      };
    }
  }

  public static setFailureMode(mode: MockFailureMode): void {
    MockDeploymentProvider.failureMode = mode;
  }

  public static setLatencyMs(ms: number): void {
    MockDeploymentProvider.latencyMs = ms;
  }

  public async authenticate(token: string): Promise<ProviderAccountInfo> {
    if (isProductionEnvironment()) {
      throw new Error('Mock deployment provider is disabled in production.');
    }

    if (!token || !token.trim()) {
      throw new Error('Authentication failed: token cannot be empty.');
    }

    if (MockDeploymentProvider.failureMode === 'auth') {
      throw new Error('Mock authentication rejected: invalid provider token.');
    }

    this.connectedToken = token.trim();
    this.accountInfo = {
      username: 'snapdeploy-tester',
      email: 'tester@snapdeploy.local',
      avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4'
    };

    return this.accountInfo;
  }

  public isAuthenticated(): boolean {
    if (isProductionEnvironment()) {
      return false;
    }
    return this.connectedToken !== null;
  }

  public async getAccountInfo(): Promise<ProviderAccountInfo | null> {
    if (isProductionEnvironment()) {
      return null;
    }
    return this.accountInfo;
  }

  public async disconnect(): Promise<void> {
    this.connectedToken = null;
    this.accountInfo = null;
  }

  public async deploy(request: DeploymentRequest): Promise<DeploymentResult> {
    if (isProductionEnvironment()) {
      throw new Error('Mock deployment provider is disabled in production.');
    }

    const startTime = Date.now();

    if (!this.isAuthenticated()) {
      throw new Error('Deployment failed: provider is not authenticated.');
    }

    const checkAborted = () => {
      if (request.signal?.aborted) {
        throw new DOMException('Deployment aborted by user.', 'AbortError');
      }
    };

    checkAborted();
    request.onProgress?.('validating', 15);
    await this.sleep(MockDeploymentProvider.latencyMs);

    checkAborted();
    request.onProgress?.('packaging', 35);
    await this.sleep(MockDeploymentProvider.latencyMs);

    checkAborted();
    if (MockDeploymentProvider.failureMode === 'upload') {
      throw new Error('Upload error: Mock provider rejected artifact bundle (HTTP 502 Bad Gateway).');
    }

    request.onProgress?.('uploading', 65);
    await this.sleep(MockDeploymentProvider.latencyMs);

    checkAborted();
    if (MockDeploymentProvider.failureMode === 'timeout') {
      throw new Error('Provider timeout: deployment failed to settle within timeout limit.');
    }

    if (MockDeploymentProvider.failureMode === 'deploy') {
      throw new Error('Deploy error: Remote build/hosting error on mock provider (HTTP 500 Internal Server Error).');
    }

    request.onProgress?.('deploying', 90);
    await this.sleep(MockDeploymentProvider.latencyMs);

    checkAborted();

    const cleanProjectSlug = (request.projectTitle || request.projectId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const siteId = request.siteId || `mock_site_${request.projectId}`;
    const siteName = request.siteName || `snapdeploy-${cleanProjectSlug || 'app'}`;
    const deployId = `mock_dep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const url = `https://snapdeploy-preview-${request.projectId}.netlify.app`;

    request.onProgress?.('live', 100);

    return {
      deployId,
      siteId,
      siteName,
      url,
      adminUrl: `https://app.netlify.com/sites/${siteName}`,
      durationMs: Date.now() - startTime
    };
  }

  public async getDeploymentStatus(deployId: string, siteId?: string): Promise<DeploymentStatusResponse> {
    return {
      status: 'ready',
      url: `https://snapdeploy-preview-${siteId || 'site'}.netlify.app`
    };
  }

  public async cancelDeployment(deployId: string): Promise<void> {
    // No-op for mock provider
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
