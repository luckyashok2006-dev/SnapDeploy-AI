// ---------------------------------------------------------------------------
// Canonical Authentication Type Definitions for SnapDeploy AI
// Governs Feature 10: Authentication Generation
// ---------------------------------------------------------------------------

export type AuthProviderId = 'mock' | 'supabase' | 'custom';

export type AuthRole = 'user' | 'admin' | 'editor' | string;

export interface AuthUser {
  id: string;
  email: string;
  role?: AuthRole;
  name?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: number;
  provider: AuthProviderId;
}

export interface AuthConfig {
  providerId: AuthProviderId;
  endpoint?: string;
  enableEmailPassword: boolean;
  enableOAuth: boolean;
  oauthProviders: ('google' | 'github' | string)[];
  roles: string[];
  defaultRole: string;
}

export interface AuthMetadata {
  providerId: AuthProviderId;
  status: 'configured' | 'unconfigured' | 'error';
  endpoint?: string;
  connectedAt?: number;
  userCount?: number;
  activeSessions?: number;
  errorMessage?: string;
}

export interface SignUpCredentials {
  email: string;
  password?: string;
  name?: string;
  role?: string;
}

export interface SignInCredentials {
  email: string;
  password?: string;
}

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  session?: AuthSession;
  error?: string;
}

export type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED';

export type AuthStateChangeCallback = (
  event: AuthChangeEvent,
  session: AuthSession | null
) => void;
