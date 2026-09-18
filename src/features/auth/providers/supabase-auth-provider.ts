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
import { AuthProvider } from './auth-provider-interface';

export class SupabaseAuthProvider implements AuthProvider {
  public readonly id: AuthProviderId = 'supabase';
  public readonly name = 'Supabase Auth (GoTrue)';
  public readonly description = 'Managed authentication service with JWT sessions, OAuth, and RLS integration';

  private config: AuthConfig | null = null;
  private metadata: AuthMetadata | null = null;
  private currentSession: AuthSession | null = null;
  private anonKey: string | null = null;
  private listeners: Set<AuthStateChangeCallback> = new Set();

  public async configure(
    config: AuthConfig,
    credentials?: { apiKey?: string; serviceKey?: string }
  ): Promise<AuthMetadata> {
    if (!config.endpoint || !config.endpoint.trim()) {
      throw new Error('Supabase Auth configuration failed: endpoint URL is required.');
    }

    const cleanUrl = config.endpoint.trim().replace(/\/+$/, '');
    this.anonKey = credentials?.apiKey || null;

    try {
      // Test connectivity against Supabase GoTrue settings endpoint
      const headers: Record<string, string> = {
        Accept: 'application/json'
      };
      if (this.anonKey) {
        headers['apikey'] = this.anonKey;
        headers['Authorization'] = `Bearer ${this.anonKey}`;
      }

      const resp = await fetch(`${cleanUrl}/auth/v1/settings`, {
        method: 'GET',
        headers
      });

      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Supabase Auth authentication failed: Invalid Anon Key or unauthorized project.');
      }

      this.config = { ...config, endpoint: cleanUrl };
      this.metadata = {
        providerId: 'supabase',
        status: 'configured',
        endpoint: cleanUrl,
        connectedAt: Date.now(),
        userCount: 0,
        activeSessions: 0
      };

      return { ...this.metadata };
    } catch (err: any) {
      this.metadata = {
        providerId: 'supabase',
        status: 'error',
        endpoint: cleanUrl,
        connectedAt: Date.now(),
        errorMessage: err?.message || 'Connection to Supabase Auth failed.'
      };
      throw new Error(`Supabase Auth error: ${err?.message || err}`);
    }
  }

  public isConfigured(): boolean {
    return this.config !== null && this.metadata?.status === 'configured';
  }

  public async getMetadata(): Promise<AuthMetadata | null> {
    return this.metadata ? { ...this.metadata } : null;
  }

  public async signUp(credentials: SignUpCredentials): Promise<AuthResult> {
    if (!this.config || !this.config.endpoint) {
      return { success: false, error: 'Supabase Auth is not configured.' };
    }

    try {
      const resp = await fetch(`${this.config.endpoint}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.anonKey || '',
          Authorization: this.anonKey ? `Bearer ${this.anonKey}` : ''
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
          data: {
            name: credentials.name,
            role: credentials.role || this.config.defaultRole || 'user'
          }
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        return { success: false, error: data.msg || data.error_description || 'Signup failed' };
      }

      const user: AuthUser = {
        id: data.id || data.user?.id || `user_${Date.now()}`,
        email: credentials.email,
        name: credentials.name,
        role: credentials.role || this.config.defaultRole || 'user',
        createdAt: new Date().toISOString()
      };

      if (data.access_token) {
        const session: AuthSession = {
          user,
          token: data.access_token,
          expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
          provider: 'supabase'
        };
        this.currentSession = session;
        this.notifyListeners('SIGNED_IN', session);
        return { success: true, user, session };
      }

      return { success: true, user };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error during signup' };
    }
  }

  public async signInWithPassword(credentials: SignInCredentials): Promise<AuthResult> {
    if (!this.config || !this.config.endpoint) {
      return { success: false, error: 'Supabase Auth is not configured.' };
    }

    try {
      const resp = await fetch(`${this.config.endpoint}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.anonKey || '',
          Authorization: this.anonKey ? `Bearer ${this.anonKey}` : ''
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        return { success: false, error: data.error_description || data.msg || 'Invalid login credentials' };
      }

      const user: AuthUser = {
        id: data.user?.id || `user_${Date.now()}`,
        email: data.user?.email || credentials.email,
        name: data.user?.user_metadata?.name,
        role: data.user?.user_metadata?.role || this.config.defaultRole || 'user',
        createdAt: data.user?.created_at || new Date().toISOString()
      };

      const session: AuthSession = {
        user,
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        provider: 'supabase'
      };

      this.currentSession = session;
      this.notifyListeners('SIGNED_IN', session);

      return { success: true, user, session };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error during signin' };
    }
  }

  public async signOut(): Promise<{ success: boolean; error?: string }> {
    this.currentSession = null;
    this.notifyListeners('SIGNED_OUT', null);
    return { success: true };
  }

  public async getSession(): Promise<AuthSession | null> {
    if (this.currentSession && this.currentSession.expiresAt < Date.now()) {
      this.currentSession = null;
      this.notifyListeners('SIGNED_OUT', null);
      return null;
    }
    return this.currentSession ? { ...this.currentSession } : null;
  }

  public async getCurrentUser(): Promise<AuthUser | null> {
    const session = await this.getSession();
    return session ? { ...session.user } : null;
  }

  public async resetPasswordForEmail(email: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config || !this.config.endpoint) {
      return { success: false, error: 'Supabase Auth is not configured.' };
    }

    try {
      const resp = await fetch(`${this.config.endpoint}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.anonKey || '',
          Authorization: this.anonKey ? `Bearer ${this.anonKey}` : ''
        },
        body: JSON.stringify({ email })
      });

      if (!resp.ok) {
        const data = await resp.json();
        return { success: false, error: data.msg || 'Password recovery request failed' };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error during recovery' };
    }
  }

  public onAuthStateChange(callback: AuthStateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(event: 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED', session: AuthSession | null): void {
    for (const listener of this.listeners) {
      try {
        listener(event, session);
      } catch (err) {
        console.error('[SupabaseAuthProvider] listener error:', err);
      }
    }
  }

  public async listUsers(): Promise<AuthUser[]> {
    return this.currentSession ? [{ ...this.currentSession.user }] : [];
  }

  public async disconnect(): Promise<void> {
    this.currentSession = null;
    this.config = null;
    this.metadata = null;
    this.anonKey = null;
    this.listeners.clear();
  }
}
