import { create } from 'zustand';
import { GitHubUser } from '../types/workspace';

export interface GitHubAuthState {
  token: string | null;
  user: GitHubUser | null;
  isAuthenticated: boolean;
  setCredentials: (token: string, user: GitHubUser) => void;
  disconnect: () => void;
}

/**
 * Strictly MEMORY-ONLY GitHub authentication store.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. Tokens exist ONLY in Javascript memory (heap).
 * 2. Never persisted to localStorage, sessionStorage, IndexedDB, or Cookies.
 * 3. Never exposed to VFS, Monaco models, AI prompts, or WebContainer runtime.
 * 4. Cleared immediately on disconnect or page unload.
 */
export const useGitHubAuthStore = create<GitHubAuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  setCredentials: (token: string, user: GitHubUser) => {
    set({
      token: token.trim(),
      user,
      isAuthenticated: true
    });
  },

  disconnect: () => {
    set({
      token: null,
      user: null,
      isAuthenticated: false
    });
  }
}));

// Ensure credentials are instantly purged if the browser window unloads
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    useGitHubAuthStore.getState().disconnect();
  });
}
