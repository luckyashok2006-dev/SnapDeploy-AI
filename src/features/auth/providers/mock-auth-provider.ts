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

export class MockAuthProvider implements AuthProvider {
  public readonly id: AuthProviderId = 'mock';
  public readonly name = 'Mock Authentication Provider';
  public readonly description = 'Deterministic, in-memory auth provider for automated tests and sandbox preview';

  private config: AuthConfig | null = null;
  private metadata: AuthMetadata | null = null;
  private users: Map<string, { user: AuthUser; passwordHash: string }> = new Map();
  private currentSession: AuthSession | null = null;
  private listeners: Set<AuthStateChangeCallback> = new Set();

  constructor() {
    this.seedDefaultUsers();
  }

  private seedDefaultUsers(): void {
    // Seed default admin and standard user
    const adminUser: AuthUser = {
      id: 'mock_user_admin_1',
      email: 'admin@snapdeploy.test',
      role: 'admin',
      name: 'Admin User',
      createdAt: '2026-09-01T00:00:00.000Z'
    };
    this.users.set(adminUser.email.toLowerCase(), {
      user: adminUser,
      passwordHash: 'admin123'
    });

    const standardUser: AuthUser = {
      id: 'mock_user_std_2',
      email: 'user@snapdeploy.test',
      role: 'user',
      name: 'Standard User',
      createdAt: '2026-09-02T00:00:00.000Z'
    };
    this.users.set(standardUser.email.toLowerCase(), {
      user: standardUser,
      passwordHash: 'password123'
    });
  }

  public async configure(config: AuthConfig): Promise<AuthMetadata> {
    this.config = { ...config };
    this.metadata = {
      providerId: 'mock',
      status: 'configured',
      endpoint: config.endpoint || 'http://localhost:3000/api/auth/mock',
      connectedAt: Date.now(),
      userCount: this.users.size,
      activeSessions: this.currentSession ? 1 : 0
    };
    return { ...this.metadata };
  }

  public isConfigured(): boolean {
    return this.config !== null && this.metadata?.status === 'configured';
  }

  public async getMetadata(): Promise<AuthMetadata | null> {
    if (!this.metadata) return null;
    return {
      ...this.metadata,
      userCount: this.users.size,
      activeSessions: this.currentSession ? 1 : 0
    };
  }

  public async signUp(credentials: SignUpCredentials): Promise<AuthResult> {
    if (!credentials.email || !credentials.email.trim()) {
      return { success: false, error: 'Email is required for signup.' };
    }
    const cleanEmail = credentials.email.trim().toLowerCase();
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return { success: false, error: 'Invalid email address format.' };
    }
    if (!credentials.password || credentials.password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    if (this.users.has(cleanEmail)) {
      return { success: false, error: 'User already exists with this email address.' };
    }

    const newUser: AuthUser = {
      id: `mock_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      email: cleanEmail,
      name: credentials.name || cleanEmail.split('@')[0],
      role: credentials.role || this.config?.defaultRole || 'user',
      createdAt: new Date().toISOString()
    };

    this.users.set(cleanEmail, {
      user: newUser,
      passwordHash: credentials.password
    });

    // Automatically establish session
    const session: AuthSession = {
      user: newUser,
      token: `mock_jwt_token_${Date.now()}`,
      expiresAt: Date.now() + 3600 * 1000,
      provider: 'mock'
    };
    this.currentSession = session;
    this.notifyListeners('SIGNED_IN', session);

    return {
      success: true,
      user: newUser,
      session
    };
  }

  public async signInWithPassword(credentials: SignInCredentials): Promise<AuthResult> {
    if (!credentials.email || !credentials.password) {
      return { success: false, error: 'Email and password are required.' };
    }

    const cleanEmail = credentials.email.trim().toLowerCase();
    const entry = this.users.get(cleanEmail);

    if (!entry || entry.passwordHash !== credentials.password) {
      return { success: false, error: 'Invalid email or password.' };
    }

    const session: AuthSession = {
      user: entry.user,
      token: `mock_jwt_token_${Date.now()}`,
      expiresAt: Date.now() + 3600 * 1000,
      provider: 'mock'
    };
    this.currentSession = session;
    this.notifyListeners('SIGNED_IN', session);

    return {
      success: true,
      user: entry.user,
      session
    };
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
    if (!email || !email.trim()) {
      return { success: false, error: 'Email is required for password reset.' };
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!this.users.has(cleanEmail)) {
      return { success: false, error: 'No account found with this email address.' };
    }
    return { success: true };
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
        console.error('[MockAuthProvider] listener error:', err);
      }
    }
  }

  public async listUsers(): Promise<AuthUser[]> {
    return Array.from(this.users.values()).map((e) => ({ ...e.user }));
  }

  public async disconnect(): Promise<void> {
    this.currentSession = null;
    this.config = null;
    this.metadata = null;
    this.listeners.clear();
  }
}
