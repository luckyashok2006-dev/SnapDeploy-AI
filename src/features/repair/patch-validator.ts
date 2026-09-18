import { Patch, ProjectFile } from '../../types/workspace';
import { normalizePath } from '../../lib/vfs/project-files';

export interface ValidationError {
  path: string;
  rule: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  structuredErrors: ValidationError[];
}

function isValidProjectPath(rawPath: string): { valid: boolean; reason?: string } {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return { valid: false, reason: 'Path is empty or whitespace only' };
  }

  // Reject embedded null bytes
  if (rawPath.includes('\0')) {
    return { valid: false, reason: `Null byte in path rejected: ${rawPath}` };
  }

  // Reject Windows UNC or network paths (e.g. \\server\share or //server/share)
  if (rawPath.startsWith('\\\\') || rawPath.startsWith('//') || rawPath.replace(/\\/g, '/').startsWith('//')) {
    return { valid: false, reason: `UNC / network path rejected: ${rawPath}` };
  }

  // Reject Windows drive paths (e.g. C:\..., D:/...)
  if (/^[a-zA-Z]:/.test(rawPath)) {
    return { valid: false, reason: `Absolute OS filesystem path rejected: ${rawPath}` };
  }

  // Reject URL/URI schemes (e.g. file://, http://)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawPath)) {
    return { valid: false, reason: `URI path scheme rejected: ${rawPath}` };
  }

  // Reject path traversal '..'
  const segments = rawPath.replace(/\\/g, '/').split('/');
  for (const seg of segments) {
    if (seg === '..') {
      return { valid: false, reason: `Path traversal '..' rejected: ${rawPath}` };
    }
  }

  // Reject system root directories
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

export function validatePatch(
  patch: Patch,
  projectFiles: Record<string, ProjectFile>
): ValidationResult {
  const errors: string[] = [];
  const structuredErrors: ValidationError[] = [];

  const addError = (path: string, rule: string, reason: string) => {
    errors.push(reason);
    structuredErrors.push({ path, rule, reason });
  };

  if (!patch || !patch.files || patch.files.length === 0) {
    addError('', 'NO_FILES', 'Patch contains no file changes');
    return { valid: false, errors, structuredErrors };
  }

  const seenPaths = new Set<string>();

  for (const change of patch.files) {
    // 1. Path Safety & Traversal Checks
    const pathCheck = isValidProjectPath(change.path);
    if (!pathCheck.valid) {
      addError(change.path || '', 'INVALID_PATH', pathCheck.reason || 'Invalid path');
      continue;
    }

    const normPath = normalizePath(change.path);
    const unslashedPath = normPath.replace(/^\/+/, '');

    // 2. Duplicate Patch Entry Check
    if (seenPaths.has(normPath)) {
      addError(change.path, 'DUPLICATE_PATH', `Duplicate patch entry for path: ${change.path}`);
      continue;
    }
    seenPaths.add(normPath);

    // Look up file in VFS project files (handling both '/src/...' and 'src/...' conventions)
    const existingFile = projectFiles[normPath] || projectFiles[unslashedPath] || projectFiles[`/${unslashedPath}`];
    const isNewFile = change.before === undefined || change.before === '';

    if (isNewFile) {
      // 3. New File Validation: target file must NOT already exist
      if (existingFile) {
        addError(
          change.path,
          'FILE_ALREADY_EXISTS',
          `Cannot create new file: '${change.path}' already exists in project`
        );
        continue;
      }
    } else {
      // 4. Existing File Validation: target file must exist in VFS
      if (!existingFile) {
        addError(
          change.path,
          'TARGET_FILE_MISSING',
          `Target file does not exist in VFS: ${change.path}`
        );
        continue;
      }

      // 5. Strict Exact Content Matching (Strict byte-for-byte equality, no trimming, no substrings)
      if (change.before !== existingFile.content) {
        addError(
          change.path,
          'STALE_BEFORE_CONTENT',
          `Stale patch: file content for '${change.path}' does not match patch baseline exactly`
        );
        continue;
      }
    }

    // 6. After content presence check
    if (change.after === undefined || change.after === null) {
      addError(
        change.path,
        'NULL_AFTER_CONTENT',
        `Patch after content is null or undefined for '${change.path}'`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    structuredErrors
  };
}
