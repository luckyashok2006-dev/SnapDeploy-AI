import {
  GitHubBranch,
  GitHubInspectResult,
  GitHubRepo,
  GitHubUser,
  DetectedProjectConfig
} from '../../types/workspace';
import {
  validateAndExtractArchive,
  isExcludedPath,
  isSensitiveEnvFile,
  isAllowedSourceFile,
  sanitizeArchivePath,
  MAX_SINGLE_FILE_BYTES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  MAX_EXTRACTED_FILES
} from '../import/import-validator';
import { detectProjectConfiguration } from '../import/project-detector';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Redacts any GitHub tokens or sensitive authorization headers from error messages.
 */
export function sanitizeGitHubError(error: any): string {
  const msg = typeof error === 'string' ? error : error?.message || 'GitHub API request failed';
  return msg
    .replace(/ghp_[a-zA-Z0-9]+/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
    .replace(/token\s+[a-zA-Z0-9_.-]+/gi, 'token [REDACTED]');
}

interface GitTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

export class GitHubClient {
  private static instance: GitHubClient;

  private constructor() {}

  public static getInstance(): GitHubClient {
    if (!GitHubClient.instance) {
      GitHubClient.instance = new GitHubClient();
    }
    return GitHubClient.instance;
  }

  private buildHeaders(token?: string | null): HeadersInit {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token && token.trim()) {
      headers['Authorization'] = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  /**
   * Validates a GitHub Personal Access Token directly against api.github.com/user.
   */
  public async validateToken(token: string): Promise<GitHubUser> {
    if (!token || !token.trim()) {
      throw new Error('TOKEN_REQUIRED: GitHub token cannot be empty.');
    }

    try {
      const res = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: this.buildHeaders(token)
      });

      if (res.status === 401 || res.status === 403) {
        const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
        if (rateLimitRemaining === '0') {
          const resetTime = res.headers.get('x-ratelimit-reset');
          const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000).toLocaleTimeString() : 'soon';
          throw new Error(`GITHUB_RATE_LIMITED: GitHub API rate limit exceeded. Resets at ${resetDate}.`);
        }
        throw new Error('GITHUB_CREDENTIALS_INVALID: Invalid or expired GitHub Personal Access Token.');
      }

      if (!res.ok) {
        throw new Error(`GITHUB_API_ERROR: GitHub API responded with HTTP ${res.status}.`);
      }

      const data = await res.json();
      return {
        login: data.login,
        id: data.id,
        name: data.name || data.login,
        avatar_url: data.avatar_url,
        html_url: data.html_url
      };
    } catch (err: any) {
      throw new Error(sanitizeGitHubError(err));
    }
  }

  /**
   * Lists repositories for the authenticated user or a specific public owner.
   */
  public async listUserRepos(token?: string | null, page = 1, perPage = 30): Promise<GitHubRepo[]> {
    try {
      const url = token
        ? `${GITHUB_API_BASE}/user/repos?sort=updated&per_page=${perPage}&page=${page}`
        : `${GITHUB_API_BASE}/repositories?per_page=${perPage}&page=${page}`;

      const res = await fetch(url, {
        headers: this.buildHeaders(token)
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('GITHUB_CREDENTIALS_INVALID: GitHub authentication required or token expired.');
        }
        throw new Error(`GITHUB_API_ERROR: Failed to list repositories (${res.status}).`);
      }

      const data = await res.json();
      return (Array.isArray(data) ? data : []).map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        owner: {
          login: repo.owner?.login || '',
          avatar_url: repo.owner?.avatar_url
        },
        private: !!repo.private,
        default_branch: repo.default_branch || 'main',
        description: repo.description || '',
        size: repo.size || 0,
        updated_at: repo.updated_at,
        stargazers_count: repo.stargazers_count || 0,
        html_url: repo.html_url
      }));
    } catch (err: any) {
      throw new Error(sanitizeGitHubError(err));
    }
  }

  /**
   * Retrieves repository metadata (public or authenticated).
   */
  public async getRepoDetails(owner: string, repo: string, token?: string | null): Promise<GitHubRepo> {
    try {
      const res = await fetch(`${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        headers: this.buildHeaders(token)
      });

      if (res.status === 404) {
        throw new Error(`GITHUB_REPO_NOT_FOUND: Repository "${owner}/${repo}" was not found or is private.`);
      }

      if (!res.ok) {
        throw new Error(`GITHUB_API_ERROR: Failed to get repository metadata (${res.status}).`);
      }

      const data = await res.json();
      return {
        id: data.id,
        name: data.name,
        full_name: data.full_name,
        owner: {
          login: data.owner?.login || '',
          avatar_url: data.owner?.avatar_url
        },
        private: !!data.private,
        default_branch: data.default_branch || 'main',
        description: data.description || '',
        size: data.size || 0,
        updated_at: data.updated_at,
        stargazers_count: data.stargazers_count || 0,
        html_url: data.html_url
      };
    } catch (err: any) {
      throw new Error(sanitizeGitHubError(err));
    }
  }

  /**
   * Retrieves branches for a repository.
   */
  public async listBranches(
    owner: string,
    repo: string,
    token?: string | null
  ): Promise<{ branches: GitHubBranch[]; defaultBranch: string }> {
    try {
      const repoDetails = await this.getRepoDetails(owner, repo, token);
      const res = await fetch(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
        {
          headers: this.buildHeaders(token)
        }
      );

      if (!res.ok) {
        throw new Error(`GITHUB_API_ERROR: Failed to list branches (${res.status}).`);
      }

      const data = await res.json();
      const branches: GitHubBranch[] = (Array.isArray(data) ? data : []).map((b: any) => ({
        name: b.name,
        commitSha: b.commit?.sha || '',
        isDefault: b.name === repoDetails.default_branch
      }));

      return {
        branches,
        defaultBranch: repoDetails.default_branch
      };
    } catch (err: any) {
      throw new Error(sanitizeGitHubError(err));
    }
  }

  /**
   * Pre-flight recursive inspection of a repository Git tree before downloading any archive.
   */
  public async inspectTree(
    owner: string,
    repo: string,
    ref: string,
    token?: string | null
  ): Promise<GitHubInspectResult> {
    const warnings: string[] = [];

    try {
      // 1. Check repo size in KB from metadata
      const repoDetails = await this.getRepoDetails(owner, repo, token);
      if (repoDetails.size * 1024 > MAX_ZIP_UNCOMPRESSED_BYTES) {
        return {
          safe: false,
          fileCount: 0,
          estimatedBytes: repoDetails.size * 1024,
          detectedFiles: [],
          warnings,
          error: `REPOSITORY_TOO_LARGE: Repository size (${(repoDetails.size / 1024).toFixed(1)}MB) exceeds limit of ${MAX_ZIP_UNCOMPRESSED_BYTES / 1024 / 1024}MB.`
        };
      }

      // 2. Fetch recursive Git Tree
      const treeUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
      const res = await fetch(treeUrl, {
        headers: this.buildHeaders(token)
      });

      if (!res.ok) {
        if (res.status === 404) {
          return {
            safe: false,
            fileCount: 0,
            estimatedBytes: 0,
            detectedFiles: [],
            warnings,
            error: `GITHUB_REF_NOT_FOUND: Branch or ref "${ref}" not found in "${owner}/${repo}".`
          };
        }
        throw new Error(`GITHUB_API_ERROR: Failed to fetch Git tree (${res.status}).`);
      }

      const treeData = await res.json();
      if (treeData.truncated) {
        return {
          safe: false,
          fileCount: 0,
          estimatedBytes: 0,
          detectedFiles: [],
          warnings,
          error: `REPOSITORY_TOO_LARGE: Repository exceeds GitHub maximum tree size limit (truncated).`
        };
      }

      const items: GitTreeItem[] = Array.isArray(treeData.tree) ? treeData.tree : [];
      let validFileCount = 0;
      let totalEstimatedBytes = 0;
      const detectedFiles: string[] = [];

      for (const item of items) {
        // Skip directory objects
        if (item.type === 'tree') continue;

        // Check symlinks (Git filemode 120000)
        if (item.mode === '120000') {
          return {
            safe: false,
            fileCount: 0,
            estimatedBytes: 0,
            detectedFiles: [],
            warnings,
            error: `SYMLINK_NOT_ALLOWED: Repository contains symlink entry "${item.path}". Symlinks are not permitted.`
          };
        }

        // Check submodules (Git filemode 160000)
        if (item.mode === '160000') {
          warnings.push(`Submodule ignored: ${item.path}`);
          continue;
        }

        // Sanitize path for traversal & drive letters
        const { sanitized, error } = sanitizeArchivePath(item.path);
        if (error) {
          return {
            safe: false,
            fileCount: 0,
            estimatedBytes: 0,
            detectedFiles: [],
            warnings,
            error: `${error}: Invalid file path "${item.path}".`
          };
        }
        if (!sanitized) continue;

        // Check excluded directories (node_modules, .git, dist, etc.)
        if (isExcludedPath(sanitized)) continue;

        // Check sensitive environment files
        if (isSensitiveEnvFile(sanitized)) {
          warnings.push(`Excluded sensitive environment file: ${sanitized}`);
          continue;
        }

        // Check permitted source file extension
        if (!isAllowedSourceFile(sanitized)) continue;

        const fileSize = item.size || 0;
        if (fileSize > MAX_SINGLE_FILE_BYTES) {
          return {
            safe: false,
            fileCount: validFileCount,
            estimatedBytes: totalEstimatedBytes,
            detectedFiles,
            warnings,
            error: `FILE_TOO_LARGE: File "${sanitized}" size (${(fileSize / 1024 / 1024).toFixed(1)}MB) exceeds limit of ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB.`
          };
        }

        totalEstimatedBytes += fileSize;
        validFileCount++;
        detectedFiles.push(sanitized.startsWith('/') ? sanitized : `/${sanitized}`);

        if (totalEstimatedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          return {
            safe: false,
            fileCount: validFileCount,
            estimatedBytes: totalEstimatedBytes,
            detectedFiles,
            warnings,
            error: `UNCOMPRESSED_SIZE_EXCEEDED: Total size exceeds limit of ${MAX_ZIP_UNCOMPRESSED_BYTES / 1024 / 1024}MB.`
          };
        }

        if (validFileCount > MAX_EXTRACTED_FILES) {
          return {
            safe: false,
            fileCount: validFileCount,
            estimatedBytes: totalEstimatedBytes,
            detectedFiles,
            warnings,
            error: `TOO_MANY_FILES: Repository contains more than ${MAX_EXTRACTED_FILES} extractable source files.`
          };
        }
      }

      return {
        safe: true,
        fileCount: validFileCount,
        estimatedBytes: totalEstimatedBytes,
        detectedFiles,
        warnings
      };
    } catch (err: any) {
      return {
        safe: false,
        fileCount: 0,
        estimatedBytes: 0,
        detectedFiles: [],
        warnings,
        error: sanitizeGitHubError(err)
      };
    }
  }

  /**
   * Downloads repository zipball, normalizes and validates using ImportValidator,
   * and runs ProjectDetector.
   */
  public async fetchRepositoryArchive(
    owner: string,
    repo: string,
    ref: string,
    token?: string | null
  ): Promise<{
    files: Record<string, string>;
    config: DetectedProjectConfig;
    warnings: string[];
    totalUncompressedBytes: number;
    fileCount: number;
  }> {
    try {
      const zipballUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`;
      const res = await fetch(zipballUrl, {
        headers: this.buildHeaders(token)
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('GITHUB_CREDENTIALS_INVALID: Access denied or token invalid.');
        }
        if (res.status === 404) {
          throw new Error(`GITHUB_REPO_NOT_FOUND: Repository or ref "${owner}/${repo}@${ref}" not found.`);
        }
        throw new Error(`GITHUB_API_ERROR: Failed to download archive (${res.status}).`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const validation = await validateAndExtractArchive(arrayBuffer);

      if (!validation.valid) {
        throw new Error(validation.error || 'Failed to extract and validate repository archive.');
      }

      const detectedConfig = detectProjectConfiguration(validation.extractedFiles, repo);

      return {
        files: validation.extractedFiles,
        config: detectedConfig,
        warnings: [...validation.warnings],
        totalUncompressedBytes: validation.totalUncompressedBytes,
        fileCount: validation.fileCount
      };
    } catch (err: any) {
      throw new Error(sanitizeGitHubError(err));
    }
  }
}

export const gitHubClient = GitHubClient.getInstance();
