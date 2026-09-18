import { PatchFileChange, ProjectFile } from '../../types/workspace';
import { normalizePath } from '../../lib/vfs/project-files';

export const MAX_EDIT_FILES = 5;
export const MAX_EDIT_DIFF_BYTES = 100_000;

export interface EditValidationError {
  path: string;
  rule: string;
  reason: string;
}

export interface EditValidationResult {
  valid: boolean;
  errors: string[];
  structuredErrors: EditValidationError[];
}

/**
 * Deterministic diff byte-counting method using standard UTF-8 encoding.
 * Consistent across both server (Node.js) and client (Chromium/browsers).
 */
export function calculateDiffBytes(files: { before?: string; after: string }[]): number {
  const encoder = new TextEncoder();
  return files.reduce((total, f) => {
    const beforeBytes = f.before ? encoder.encode(f.before).length : 0;
    const afterBytes = f.after ? encoder.encode(f.after).length : 0;
    return total + beforeBytes + afterBytes;
  }, 0);
}

function isValidProjectPath(rawPath: string): { valid: boolean; reason?: string } {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return { valid: false, reason: 'Path is empty or whitespace only' };
  }
  if (rawPath.includes('\0')) {
    return { valid: false, reason: `Null byte in path rejected: ${rawPath}` };
  }
  if (rawPath.startsWith('\\\\') || rawPath.startsWith('//') || rawPath.replace(/\\/g, '/').startsWith('//')) {
    return { valid: false, reason: `UNC / network path rejected: ${rawPath}` };
  }
  if (/^[a-zA-Z]:/.test(rawPath)) {
    return { valid: false, reason: `Absolute OS filesystem path rejected: ${rawPath}` };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawPath)) {
    return { valid: false, reason: `URI path scheme rejected: ${rawPath}` };
  }
  const segments = rawPath.replace(/\\/g, '/').split('/');
  for (const seg of segments) {
    if (seg === '..') {
      return { valid: false, reason: `Path traversal '..' rejected: ${rawPath}` };
    }
  }
  const normalized = normalizePath(rawPath).toLowerCase();
  if (
    normalized.startsWith('/etc') ||
    normalized.startsWith('/root') ||
    normalized.startsWith('/proc') ||
    normalized.startsWith('/sys') ||
    normalized.startsWith('/windows') ||
    normalized.startsWith('/system32')
  ) {
    return { valid: false, reason: `System directory access rejected: ${rawPath}` };
  }
  return { valid: true };
}

/**
 * Validates an AI Edit proposal against live VFS authoritative files.
 */
export function validateEditPatch(
  patch: { summary: string; files: PatchFileChange[] },
  liveFiles: Record<string, ProjectFile>
): EditValidationResult {
  const errors: string[] = [];
  const structuredErrors: EditValidationError[] = [];

  const addError = (path: string, rule: string, reason: string) => {
    errors.push(reason);
    structuredErrors.push({ path, rule, reason });
  };

  if (!patch || !patch.files || patch.files.length === 0) {
    addError('', 'NO_FILES', 'Proposal contains no file changes');
    return { valid: false, errors, structuredErrors };
  }

  // 1. File count boundary check
  if (patch.files.length > MAX_EDIT_FILES) {
    addError(
      '',
      'TOO_MANY_FILES',
      `Proposal modifies ${patch.files.length} files, which exceeds maximum limit of ${MAX_EDIT_FILES}`
    );
    return { valid: false, errors, structuredErrors };
  }

  // 2. Diff size boundary check
  const diffBytes = calculateDiffBytes(patch.files);
  if (diffBytes > MAX_EDIT_DIFF_BYTES) {
    addError(
      '',
      'DIFF_TOO_LARGE',
      `Proposal diff size (${diffBytes} bytes) exceeds maximum limit of ${MAX_EDIT_DIFF_BYTES} bytes`
    );
    return { valid: false, errors, structuredErrors };
  }

  const seenPaths = new Set<string>();

  for (const change of patch.files) {
    // 3. Path safety & traversal checks
    const pathCheck = isValidProjectPath(change.path);
    if (!pathCheck.valid) {
      addError(change.path || '', 'INVALID_PATH', pathCheck.reason || 'Invalid path');
      continue;
    }

    const normPath = normalizePath(change.path);
    const unslashedPath = normPath.replace(/^\/+/, '');

    // 4. Duplicate path check
    if (seenPaths.has(normPath)) {
      addError(change.path, 'DUPLICATE_PATH', `Duplicate patch entry for path: ${change.path}`);
      continue;
    }
    seenPaths.add(normPath);

    // 5. Check after content presence and reject delete
    if (change.after === undefined || change.after === null) {
      addError(change.path, 'UNSUPPORTED_ACTION', `File deletion is not supported in AI Edit Mode for '${change.path}'`);
      continue;
    }

    // 5b. Secret exposure security check
    const SECRET_PATTERNS = [
      { rule: 'GITHUB_TOKEN_EXPOSURE', regex: /(?:ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})/ },
      { rule: 'PRIVATE_KEY_EXPOSURE', regex: /-----BEGIN\s+[A-Z\s]+PRIVATE\s+KEY-----/ },
      { rule: 'STRIPE_KEY_EXPOSURE', regex: /sk_live_[a-zA-Z0-9]{20,}/ },
      { rule: 'DATABASE_PASSWORD_EXPOSURE', regex: /(?:postgres|mysql|mongodb\+srv):\/\/[^:\s]+:[^@\s]+@[^\s]+/ }
    ];
    let hasSecret = false;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(change.after)) {
        addError(
          change.path,
          pattern.rule,
          `Security rejection: Proposal contains exposed sensitive secret matching ${pattern.rule}`
        );
        hasSecret = true;
      }
    }
    if (hasSecret) {
      continue;
    }

    // 5c. Affected-file allowlist check (if specified by structured engineering plan)
    if ((patch as any).affectedFiles && Array.isArray((patch as any).affectedFiles) && (patch as any).affectedFiles.length > 0) {
      const allowedList = (patch as any).affectedFiles;
      const isAllowed = allowedList.some((af: any) => {
        const allowedPath = typeof af === 'string' ? af : af?.path;
        if (!allowedPath) return false;
        const normAllowed = normalizePath(allowedPath);
        return normPath === normAllowed || unslashedPath === normAllowed.replace(/^\/+/, '');
      });
      if (!isAllowed) {
        addError(
          change.path,
          'UNLISTED_AFFECTED_FILE',
          `Proposal attempts to modify '${change.path}' which is not in the approved affected files list`
        );
        continue;
      }
    }

    // Look up in live authoritative VFS
    const existingFile = liveFiles[normPath] || liveFiles[unslashedPath] || liveFiles[`/${unslashedPath}`];
    const isNewFile = change.before === undefined || change.before === '';

    if (isNewFile) {
      // 6. Create collision safety: file must NOT already exist in live VFS
      if (existingFile) {
        addError(
          change.path,
          'FILE_ALREADY_EXISTS',
          `Cannot create new file: '${change.path}' already exists in project`
        );
        continue;
      }
    } else {
      // 7. Existing file validation: target must exist in live VFS
      if (!existingFile) {
        addError(
          change.path,
          'TARGET_FILE_MISSING',
          `Target file does not exist in live VFS: ${change.path}`
        );
        continue;
      }

      // 8. Rejection of unchanged files
      if (change.before === change.after) {
        addError(
          change.path,
          'UNCHANGED_FILE_MODIFICATION',
          `Proposal contains no actual changes for '${change.path}' (before === after)`
        );
        continue;
      }

      // 9. Strict live VFS byte-for-byte equality check (Stale rejection)
      if (change.before !== existingFile.content) {
        addError(
          change.path,
          'STALE_BEFORE_CONTENT',
          `Stale proposal: live content for '${change.path}' does not match baseline. Code may have been modified.`
        );
        continue;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    structuredErrors
  };
}
