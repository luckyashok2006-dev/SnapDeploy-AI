import {
  DeploymentProvider,
  DeploymentRequest,
  DeploymentResult,
  DeploymentStatusResponse,
  ProviderAccountInfo
} from './provider-interface';
import { sanitizeDeploymentError, sanitizeString } from '../security/secret-sanitizer';

const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';

export class NetlifyProvider implements DeploymentProvider {
  public readonly id = 'netlify';
  public readonly name = 'Netlify';
  public readonly description = 'Direct static and Single-Page Application deployment to Netlify global edge network';

  private token: string | null = null;
  private accountInfo: ProviderAccountInfo | null = null;

  public async authenticate(token: string): Promise<ProviderAccountInfo> {
    const trimmed = (token || '').trim();
    if (!trimmed) {
      throw new Error('Netlify authentication failed: Personal Access Token cannot be empty.');
    }

    try {
      const res = await fetch(`${NETLIFY_API_BASE}/user`, {
        headers: {
          Authorization: `Bearer ${trimmed}`,
          'User-Agent': 'SnapDeploy-AI-Deployer'
        }
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Netlify authentication rejected (HTTP 401): Invalid or expired Personal Access Token.');
        }
        throw new Error(`Netlify user verification failed: HTTP ${res.status} ${res.statusText}`);
      }

      const user = await res.json();
      this.token = trimmed;
      this.accountInfo = {
        username: user.slug || user.full_name || user.email || 'Netlify User',
        email: user.email,
        avatarUrl: user.avatar_url
      };

      return this.accountInfo;
    } catch (err: any) {
      throw new Error(sanitizeDeploymentError(err));
    }
  }

  public isAuthenticated(): boolean {
    return this.token !== null;
  }

  public async getAccountInfo(): Promise<ProviderAccountInfo | null> {
    return this.accountInfo;
  }

  public async disconnect(): Promise<void> {
    this.token = null;
    this.accountInfo = null;
  }

  public async deploy(request: DeploymentRequest): Promise<DeploymentResult> {
    const startTime = Date.now();

    if (!this.token) {
      throw new Error('Netlify deployment failed: provider is not authenticated.');
    }

    const checkAborted = () => {
      if (request.signal?.aborted) {
        throw new DOMException('Netlify deployment aborted by user.', 'AbortError');
      }
    };

    try {
      checkAborted();
      request.onProgress?.('validating', 15);

      // Step 1: Ensure site exists or create a new site
      let siteId = request.siteId;
      let siteName = request.siteName;

      if (!siteId) {
        request.onProgress?.('creating_site', 25);
        const cleanProjectSlug = (request.projectTitle || request.projectId)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

        const desiredSiteName = `snapdeploy-${cleanProjectSlug}-${Math.random().toString(36).substring(2, 6)}`;

        const createSiteRes = await fetch(`${NETLIFY_API_BASE}/sites`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'SnapDeploy-AI-Deployer'
          },
          body: JSON.stringify({ name: desiredSiteName }),
          signal: request.signal
        });

        if (!createSiteRes.ok) {
          throw new Error(`Failed to initialize Netlify site: HTTP ${createSiteRes.status} ${createSiteRes.statusText}`);
        }

        const newSite = await createSiteRes.json();
        siteId = newSite.id || newSite.site_id;
        siteName = newSite.name;
      }

      checkAborted();

      // Step 2: Configure provider-side environment variables if provided
      if (request.providerEnvironmentVariables && Object.keys(request.providerEnvironmentVariables).length > 0) {
        request.onProgress?.('configuring_env', 40);
        try {
          // Netlify environment variable API
          const envPayload = Object.entries(request.providerEnvironmentVariables).map(([key, val]) => ({
            key,
            values: [{ value: val, context: 'all' }]
          }));

          await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/env`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'SnapDeploy-AI-Deployer'
            },
            body: JSON.stringify(envPayload),
            signal: request.signal
          });
        } catch (envErr) {
          console.warn('[NetlifyProvider] Optional env configuration note:', sanitizeDeploymentError(envErr));
        }
      }

      checkAborted();
      request.onProgress?.('uploading', 60);

      // Step 3: Deploy ZIP artifact to Netlify
      // Netlify requires application/zip binary body
      const deployRes = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/deploys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/zip',
          'User-Agent': 'SnapDeploy-AI-Deployer'
        },
        body: request.artifactZip as any,
        signal: request.signal
      });

      if (!deployRes.ok) {
        throw new Error(`Netlify artifact upload failed: HTTP ${deployRes.status} ${deployRes.statusText}`);
      }

      const initialDeploy = await deployRes.json();
      const deployId = initialDeploy.id;

      checkAborted();
      request.onProgress?.('deploying', 80);

      // Step 4: Poll status until ready or timeout (max 2 minutes)
      const maxPollMs = 120_000;
      const pollIntervalMs = 2_000;
      const pollStart = Date.now();
      let liveUrl = initialDeploy.ssl_url || initialDeploy.url || `https://${siteName}.netlify.app`;
      let adminUrl = initialDeploy.admin_url;

      while (Date.now() - pollStart < maxPollMs) {
        checkAborted();

        const statusRes = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/deploys/${deployId}`, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'User-Agent': 'SnapDeploy-AI-Deployer'
          },
          signal: request.signal
        });

        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.state === 'ready') {
            liveUrl = statusData.ssl_url || statusData.url || liveUrl;
            adminUrl = statusData.admin_url || adminUrl;
            break;
          } else if (statusData.state === 'error') {
            throw new Error(`Netlify deployment failed remotely: ${statusData.error_message || 'Deploy error'}`);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      request.onProgress?.('live', 100);

      return {
        deployId,
        siteId: siteId!,
        siteName: siteName || 'netlify-site',
        url: liveUrl,
        adminUrl,
        durationMs: Date.now() - startTime
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw err;
      }
      throw new Error(sanitizeDeploymentError(err));
    }
  }

  public async getDeploymentStatus(deployId: string, siteId?: string): Promise<DeploymentStatusResponse> {
    if (!this.token || !siteId) {
      return { status: 'error', errorMessage: 'Provider not authenticated or site missing.' };
    }

    try {
      const res = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/deploys/${deployId}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'SnapDeploy-AI-Deployer'
        }
      });

      if (!res.ok) {
        return { status: 'error', errorMessage: `Failed to fetch status: HTTP ${res.status}` };
      }

      const data = await res.json();
      const statusMap: Record<string, 'building' | 'uploading' | 'deploying' | 'ready' | 'error'> = {
        new: 'building',
        uploading: 'uploading',
        uploaded: 'deploying',
        processing: 'deploying',
        ready: 'ready',
        error: 'error'
      };

      return {
        status: statusMap[data.state] || 'building',
        url: data.ssl_url || data.url,
        errorMessage: data.error_message ? sanitizeString(data.error_message) : undefined
      };
    } catch (err: any) {
      return { status: 'error', errorMessage: sanitizeDeploymentError(err) };
    }
  }
}
