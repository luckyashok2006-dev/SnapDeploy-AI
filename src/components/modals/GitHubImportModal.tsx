import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Github,
  GitBranch,
  FolderGit2,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Layers,
  FileCode,
  ShieldCheck,
  LogOut,
  Search,
  ExternalLink,
  Lock,
  Globe
} from 'lucide-react';
import { gitHubClient, sanitizeGitHubError } from '../../features/github/github-client';
import { useGitHubAuthStore } from '../../store/gitHubAuthStore';
import { projectImporter } from '../../features/import/project-importer';
import {
  GitHubRepo,
  GitHubBranch,
  GitHubInspectResult,
  DetectedProjectConfig
} from '../../types/workspace';
import { useRuntimeStore } from '../../store/runtimeStore';

interface GitHubImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (projectId: string) => void;
}

export const GitHubImportModal: React.FC<GitHubImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess
}) => {
  const { token, user, isAuthenticated, setCredentials, disconnect } = useGitHubAuthStore();
  const { addTerminalLog } = useRuntimeStore();

  // Auth form state
  const [tokenInput, setTokenInput] = useState('');
  const [authMode, setAuthMode] = useState<'token' | 'public'>('token');
  const [publicRepoUrl, setPublicRepoUrl] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Repo selection state
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  // Branch state
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  // Inspection & Import state
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<GitHubInspectResult | null>(null);
  const [detectedConfig, setDetectedConfig] = useState<DetectedProjectConfig | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (isAuthenticated && token) {
        fetchRepos(token);
      }
    } else {
      // Clear transient form state when modal closes
      setTokenInput('');
      setPublicRepoUrl('');
      setError(null);
      setIsInspecting(false);
      setIsImporting(false);
    }
  }, [isOpen, isAuthenticated]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isImporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isImporting, onClose]);

  const fetchRepos = async (authToken: string) => {
    setIsLoadingRepos(true);
    setError(null);
    try {
      const userRepos = await gitHubClient.listUserRepos(authToken, 1, 50);
      setRepos(userRepos);
    } catch (err: any) {
      setError(sanitizeGitHubError(err));
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const handleConnectToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setError('Please enter a valid GitHub Personal Access Token.');
      return;
    }

    setIsAuthenticating(true);
    setError(null);
    try {
      const validatedUser = await gitHubClient.validateToken(tokenInput.trim());
      setCredentials(tokenInput.trim(), validatedUser);
      setTokenInput('');
      await fetchRepos(tokenInput.trim());
    } catch (err: any) {
      setError(sanitizeGitHubError(err));
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLoadPublicRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = publicRepoUrl.trim();
    if (!input) {
      setError('Please enter a GitHub repository name or URL (e.g. owner/repo).');
      return;
    }

    let owner = '';
    let repo = '';

    // Handle full URL: https://github.com/owner/repo
    const match = input.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) {
      owner = match[1];
      repo = match[2].replace(/\.git$/i, '');
    } else if (input.includes('/')) {
      const parts = input.split('/');
      owner = parts[0].trim();
      repo = parts[1].replace(/\.git$/i, '').trim();
    } else {
      setError('Invalid format. Please specify repository as "owner/repo" or provide full GitHub URL.');
      return;
    }

    setIsLoadingRepos(true);
    setError(null);
    try {
      const repoDetails = await gitHubClient.getRepoDetails(owner, repo, token);
      setSelectedRepo(repoDetails);
      setCustomTitle(repoDetails.name);
      await loadBranchesForRepo(repoDetails);
    } catch (err: any) {
      setError(sanitizeGitHubError(err));
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const loadBranchesForRepo = async (repo: GitHubRepo) => {
    setIsLoadingBranches(true);
    setError(null);
    setInspectResult(null);
    setDetectedConfig(null);
    try {
      const { branches: repoBranches, defaultBranch } = await gitHubClient.listBranches(
        repo.owner.login,
        repo.name,
        token
      );
      setBranches(repoBranches);
      setSelectedBranch(defaultBranch || (repoBranches[0]?.name ?? 'main'));
    } catch (err: any) {
      setError(sanitizeGitHubError(err));
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const handleSelectRepo = async (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setCustomTitle(repo.name);
    await loadBranchesForRepo(repo);
  };

  const handleInspect = async () => {
    if (!selectedRepo) return;

    setIsInspecting(true);
    setError(null);
    try {
      const result = await gitHubClient.inspectTree(
        selectedRepo.owner.login,
        selectedRepo.name,
        selectedBranch,
        token
      );

      setInspectResult(result);
      if (!result.safe && result.error) {
        setError(result.error);
      }
    } catch (err: any) {
      setError(sanitizeGitHubError(err));
    } finally {
      setIsInspecting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedRepo) return;

    setIsImporting(true);
    setError(null);

    const projectTitle = customTitle.trim() || selectedRepo.name;
    const initialSnapshotTitle = `Initial GitHub import: ${selectedRepo.name}@${selectedBranch}`;

    addTerminalLog(
      `\x1b[36m[GitHub Import]\x1b[0m Downloading ${selectedRepo.full_name}@${selectedBranch}...`
    );

    try {
      // Step 1: Download & extract archive securely
      const { files, config, warnings } = await gitHubClient.fetchRepositoryArchive(
        selectedRepo.owner.login,
        selectedRepo.name,
        selectedBranch,
        token
      );

      for (const warning of warnings) {
        addTerminalLog(`\x1b[33m[Import Warning]\x1b[0m ${warning}`);
      }

      // Step 2: Atomic commit to authoritative VFS, Version History snapshot & Project Store
      const newProjectId = await projectImporter.commitImport(files, config, {
        customTitle: projectTitle,
        customDescription: selectedRepo.description || `Imported from GitHub: ${selectedRepo.full_name}`,
        initialSnapshotTitle,
        sourceType: 'github',
        gitHubMetadata: {
          owner: selectedRepo.owner.login,
          repo: selectedRepo.name,
          ref: selectedBranch
        }
      });

      addTerminalLog(
        `\x1b[32m[GitHub Import Complete]\x1b[0m Project '${projectTitle}' initialized (${Object.keys(files).length} files, ${config.badge}).`
      );
      onImportSuccess?.(newProjectId);
      onClose();
    } catch (err: any) {
      const sanitized = sanitizeGitHubError(err);
      setError(sanitized);
      addTerminalLog(`\x1b[31m[GitHub Import Error]\x1b[0m ${sanitized}`);
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-black/80 backdrop-blur-sm animate-fadeIn select-none"
      data-testid="github-import-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="github-import-title"
    >
      <div className="relative w-full max-w-2xl bg-[#0F172A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[min(90vh,calc(100dvh-2.5rem))]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/10 bg-[#1E293B]/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-white/5 border border-white/10 text-white">
              <Github className="w-5 h-5" />
            </div>
            <div>
              <h2 id="github-import-title" className="text-base font-semibold text-white">Import from GitHub</h2>
              <p className="text-xs text-slate-400">
                Clone and load a repository directly into authoritative VFS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated && user && (
              <div
                className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-800 border border-white/10 text-xs text-slate-300"
                data-testid="github-user-badge"
              >
                {user.avatar_url && (
                  <img
                    src={user.avatar_url}
                    alt={user.login}
                    className="w-4 h-4 rounded-full"
                  />
                )}
                <span className="font-mono font-medium text-slate-200">@{user.login}</span>
                <button
                  onClick={disconnect}
                  className="p-0.5 text-slate-400 hover:text-rose-400 transition"
                  title="Disconnect GitHub credentials"
                  data-testid="github-disconnect-btn"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              disabled={isImporting}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition disabled:opacity-50"
              data-testid="github-close-btn"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar space-y-6 flex-1 min-h-0 text-sm text-slate-300">
          {/* Error Banner */}
          {error && (
            <div
              className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
              data-testid="github-error-banner"
            >
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Section 1: Authentication or Public Selector */}
          {!isAuthenticated ? (
            <div className="space-y-4">
              <div className="flex rounded-lg bg-slate-900/60 p-1 border border-white/5">
                <button
                  type="button"
                  onClick={() => setAuthMode('token')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                    authMode === 'token'
                      ? 'bg-violet-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Personal Access Token (Private & Public)
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('public')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                    authMode === 'public'
                      ? 'bg-violet-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Public Repository URL (No Auth)
                </button>
              </div>

              {authMode === 'token' ? (
                <form onSubmit={handleConnectToken} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      GitHub Personal Access Token (PAT)
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        placeholder="ghp_... or github_pat_..."
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white placeholder-slate-500 text-xs font-mono focus:outline-none focus:border-violet-500"
                        data-testid="github-token-input"
                      />
                      <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-2.5 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Tokens are held <strong>strictly in memory</strong> and never saved to disk or VFS. Minimum scope: <code className="text-violet-400 font-mono">public_repo</code> or <code className="text-violet-400 font-mono">repo</code>.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isAuthenticating || !tokenInput.trim()}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition disabled:opacity-50"
                    data-testid="github-connect-btn"
                  >
                    {isAuthenticating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Verifying Token...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Connect Securely</span>
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleLoadPublicRepo} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Public Repository URL or owner/repo
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="e.g. facebook/react or https://github.com/vitejs/vite"
                        value={publicRepoUrl}
                        onChange={(e) => setPublicRepoUrl(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white placeholder-slate-500 text-xs font-mono focus:outline-none focus:border-violet-500"
                        data-testid="github-public-repo-input"
                      />
                      <Globe className="w-4 h-4 text-slate-500 absolute right-3 top-2.5 pointer-events-none" />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoadingRepos || !publicRepoUrl.trim()}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs border border-white/10 transition disabled:opacity-50"
                    data-testid="github-load-public-btn"
                  >
                    {isLoadingRepos ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Finding Repository...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        <span>Load Repository</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* Section 2: Authenticated Repository Picker */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300">
                  Select Repository
                </label>
                <div className="relative w-48">
                  <input
                    type="text"
                    placeholder="Search repos..."
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    className="w-full pl-7 pr-2.5 py-1 rounded-lg bg-slate-900 border border-white/10 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                  />
                  <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2 pointer-events-none" />
                </div>
              </div>

              {isLoadingRepos ? (
                <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-violet-400" />
                  <span>Loading repositories from GitHub...</span>
                </div>
              ) : (
                <div
                  className="max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-slate-900/50 divide-y divide-white/5"
                  data-testid="github-repo-select"
                >
                  {filteredRepos.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No repositories found
                    </div>
                  ) : (
                    filteredRepos.map((repo) => (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => handleSelectRepo(repo)}
                        className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-800/60 transition ${
                          selectedRepo?.id === repo.id ? 'bg-violet-600/20 border-l-2 border-violet-500' : ''
                        }`}
                        data-testid={`repo-item-${repo.name}`}
                      >
                        <div className="truncate">
                          <div className="font-medium text-slate-200 text-xs flex items-center gap-1.5 truncate">
                            <FolderGit2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                            <span className="truncate">{repo.name}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                            {repo.full_name} &bull; {(repo.size / 1024).toFixed(1)}MB
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                              repo.private
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {repo.private ? 'Private' : 'Public'}
                          </span>
                          {selectedRepo?.id === repo.id && (
                            <CheckCircle2 className="w-4 h-4 text-violet-400" />
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Section 3: Selected Repo, Branch, Title & Pre-flight Inspection */}
          {selectedRepo && (
            <div className="space-y-4 pt-2 border-t border-white/10">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Branch Selection */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Branch / Ref
                  </label>
                  <div className="relative">
                    <select
                      value={selectedBranch}
                      onChange={(e) => {
                        setSelectedBranch(e.target.value);
                        setInspectResult(null);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-xs font-mono appearance-none focus:outline-none focus:border-violet-500"
                      data-testid="github-branch-select"
                    >
                      {branches.length > 0 ? (
                        branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name} {b.isDefault ? '(default)' : ''}
                          </option>
                        ))
                      ) : (
                        <option value="main">main</option>
                      )}
                    </select>
                    <GitBranch className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-3 pointer-events-none" />
                  </div>
                </div>

                {/* Custom Title */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Project Workspace Title
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-xs focus:outline-none focus:border-violet-500"
                    placeholder={selectedRepo.name}
                    data-testid="github-title-input"
                  />
                </div>
              </div>

              {/* Pre-Flight Inspection Banner */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Pre-flight Security Inspection</span>
                <button
                  type="button"
                  onClick={handleInspect}
                  disabled={isInspecting}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-white/5 transition disabled:opacity-50"
                  data-testid="github-inspect-btn"
                >
                  {isInspecting ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin text-violet-400" />
                      <span>Inspecting...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      <span>Inspect Tree</span>
                    </>
                  )}
                </button>
              </div>

              {inspectResult && (
                <div
                  className="p-3.5 rounded-xl bg-slate-900 border border-white/10 space-y-2.5"
                  data-testid="github-inspection-summary"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Valid Source Files:</span>
                    <span className="font-mono font-medium text-slate-200">
                      {inspectResult.fileCount} files
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Estimated Size:</span>
                    <span className="font-mono font-medium text-slate-200">
                      {(inspectResult.estimatedBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  {inspectResult.warnings && inspectResult.warnings.length > 0 && (
                    <div className="text-[11px] text-amber-300/80 space-y-1 pt-1 border-t border-white/5">
                      {inspectResult.warnings.map((w, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#1E293B]/50 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-white/5 transition disabled:opacity-50"
            data-testid="github-cancel-btn"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={!selectedRepo || isImporting || isInspecting}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition disabled:opacity-40"
            data-testid="github-confirm-import-btn"
          >
            {isImporting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Importing Project...</span>
              </>
            ) : (
              <>
                <Github className="w-3.5 h-3.5" />
                <span>Import Repository</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
