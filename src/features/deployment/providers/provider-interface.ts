import { DeploymentProviderId } from '../../../types/workspace';

export interface DeploymentRequest {
  projectId: string;
  projectTitle: string;
  artifactZip: Uint8Array;
  siteId?: string;
  siteName?: string;
  providerEnvironmentVariables?: Record<string, string>; // Sent to provider API only, NOT injected into local build
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
}

// Strictly sanitized result — NO rawResponse or credentials
export interface DeploymentResult {
  deployId: string;
  siteId: string;
  siteName: string;
  url: string;
  adminUrl?: string;
  durationMs: number;
}

export interface ProviderAccountInfo {
  username: string;
  email?: string;
  avatarUrl?: string;
}

export interface DeploymentStatusResponse {
  status: 'building' | 'uploading' | 'deploying' | 'ready' | 'error' | 'cancelled';
  url?: string;
  errorMessage?: string;
}

export interface DeploymentProvider {
  readonly id: DeploymentProviderId;
  readonly name: string;
  readonly description: string;

  authenticate(token: string): Promise<ProviderAccountInfo>;
  isAuthenticated(): boolean;
  getAccountInfo(): Promise<ProviderAccountInfo | null>;
  disconnect(): Promise<void>;

  deploy(request: DeploymentRequest): Promise<DeploymentResult>;
  getDeploymentStatus(deployId: string, siteId?: string): Promise<DeploymentStatusResponse>;
  cancelDeployment?(deployId: string): Promise<void>;
}
