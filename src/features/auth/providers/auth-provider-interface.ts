import {
  AuthProviderId,
  AuthConfig,
  AuthMetadata,
  SignUpCredentials,
  SignInCredentials,
  AuthResult,
  AuthSession,
  AuthUser,
  AuthStateChangeCallback
} from '../../../types/auth';

export interface AuthProvider {
  readonly id: AuthProviderId;
  readonly name: string;
  readonly description: string;

  configure(
    config: AuthConfig,
    credentials?: { apiKey?: string; serviceKey?: string }
  ): Promise<AuthMetadata>;

  isConfigured(): boolean;
  getMetadata(): Promise<AuthMetadata | null>;

  signUp(credentials: SignUpCredentials): Promise<AuthResult>;
  signInWithPassword(credentials: SignInCredentials): Promise<AuthResult>;
  signOut(): Promise<{ success: boolean; error?: string }>;

  getSession(): Promise<AuthSession | null>;
  getCurrentUser(): Promise<AuthUser | null>;

  resetPasswordForEmail(email: string): Promise<{ success: boolean; error?: string }>;
  onAuthStateChange(callback: AuthStateChangeCallback): () => void;

  listUsers(): Promise<AuthUser[]>;
  disconnect(): Promise<void>;
}
