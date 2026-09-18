import JSZip from 'jszip';
import { ImportValidationResult } from '../../types/workspace';

export const MAX_ZIP_COMPRESSED_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_EXTRACTED_FILES = 250;
export const MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_COMPRESSION_RATIO = 50;

/**
 * Text and web source extensions permitted in VFS
 */
const ALLOWED_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'json5', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'md', 'markdown', 'txt', 'svg', 'vue', 'svelte', 'astro',
  'prisma', 'yaml', 'yml', 'toml', 'xml', 'graphql', 'gql', 'sql',
  'env', 'example'
]);

/**
 * Known dotfiles / config files permitted without typical extensions
 */
const ALLOWED_EXACT_FILENAMES = new Set([
  '.gitignore',
  '.prettierrc',
  '.eslintrc',
  '.editorconfig',
  '.npmrc',
  'dockerfile',
  'makefile',
  'license',
  'readme'
]);

/**
 * Explicitly prohibited dangerous or executable extensions
 */
const PROHIBITED_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'bat', 'cmd',
  'sh', 'ps1', 'vbs', 'wasm', 'zip', 'tar', 'gz', '7z', 'rar',
  'mp4', 'mp3', 'wav', 'pdf', 'pyc'
]);

/**
 * Normalizes an archive path and checks for traversal, drive letters, and invalid characters.
 */
export function sanitizeArchivePath(rawPath: string): { sanitized: string; error?: string } {
  // Check for control characters or null bytes
  if (/[\x00-\x1F\x7F]/.test(rawPath)) {
    return { sanitized: '', error: 'INVALID_CHARACTERS' };
  }

  // Check for Windows drive letter (e.g. C:, D:)
  if (/^[a-zA-Z]:/.test(rawPath)) {
    return { sanitized: '', error: 'ABSOLUTE_OR_DRIVE_PATH' };
  }

  // Check for absolute path starting with / or \
  if (rawPath.startsWith('/') || rawPath.startsWith('\\')) {
    return { sanitized: '', error: 'ABSOLUTE_OR_DRIVE_PATH' };
  }

  // Replace backslashes with forward slashes
  const normalized = rawPath.replace(/\\/g, '/');

  // Check for path traversal segments
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      return { sanitized: '', error: 'PATH_TRAVERSAL_DETECTED' };
    }
  }

  // Clean empty and dot segments
  const cleanSegments = segments.filter((s) => s.length > 0 && s !== '.');
  const sanitized = cleanSegments.join('/');

  return { sanitized };
}

/**
 * Checks if a path should be automatically excluded (e.g. node_modules, .git, dist)
 */
export function isExcludedPath(normalizedPath: string): boolean {
  const lower = normalizedPath.toLowerCase();
  const segments = lower.split('/');

  const excludedDirs = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    '.next',
    '.vite',
    '.cache',
    '.svelte-kit',
    '.nuxt',
    'coverage'
  ];

  for (const seg of segments) {
    if (excludedDirs.includes(seg)) {
      return true;
    }
  }

  // Exclude OS junk
  const filename = segments[segments.length - 1] || '';
  if (filename === '.ds_store' || filename === 'thumbs.db' || filename === 'desktop.ini') {
    return true;
  }

  return false;
}

/**
 * Checks if a file is a sensitive environment file
 */
export function isSensitiveEnvFile(normalizedPath: string): boolean {
  const filename = normalizedPath.split('/').pop()?.toLowerCase() || '';
  return filename === '.env' || filename.startsWith('.env.');
}

/**
 * Determines if a file is a permitted text source file.
 */
export function isAllowedSourceFile(normalizedPath: string): boolean {
  const filename = normalizedPath.split('/').pop()?.toLowerCase() || '';
  if (ALLOWED_EXACT_FILENAMES.has(filename)) {
    return true;
  }

  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) {
    return false;
  }

  const ext = filename.slice(dotIdx + 1);
  if (PROHIBITED_EXTENSIONS.has(ext)) {
    return false;
  }

  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Safely extracts and validates a project archive from a Blob, File, or ArrayBuffer.
 */
export async function validateAndExtractArchive(
  archiveData: Blob | File | ArrayBuffer | Uint8Array,
  compressedByteSize?: number
): Promise<ImportValidationResult> {
  const warnings: string[] = [];
  const ignoredPaths: string[] = [];
  const extractedFiles: Record<string, string> = {};
  let totalUncompressedBytes = 0;

  // 1. Verify compressed size if known
  const actualCompressedSize =
    compressedByteSize ??
    (archiveData instanceof Blob || (typeof File !== 'undefined' && archiveData instanceof File)
      ? archiveData.size
      : archiveData.byteLength);

  if (actualCompressedSize > MAX_ZIP_COMPRESSED_BYTES) {
    return {
      valid: false,
      extractedFiles: {},
      totalUncompressedBytes: 0,
      fileCount: 0,
      ignoredPaths: [],
      warnings: [],
      error: `ARCHIVE_TOO_LARGE: Archive compressed size (${(actualCompressedSize / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowed ${MAX_ZIP_COMPRESSED_BYTES / 1024 / 1024}MB.`
    };
  }

  // 2. Load ZIP
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archiveData);
  } catch (err: any) {
    return {
      valid: false,
      extractedFiles: {},
      totalUncompressedBytes: 0,
      fileCount: 0,
      ignoredPaths: [],
      warnings: [],
      error: `INVALID_ARCHIVE: Failed to parse ZIP archive (${err?.message || 'corrupted or not a valid ZIP file'}).`
    };
  }

  // 3. Inspect and extract entries
  const seenPaths = new Set<string>();
  const rawExtracted: Record<string, string> = {};

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    // Skip directories
    if (entry.dir) continue;

    // Check for symlinks if unix permissions are available (0120000 = symlink)
    const unixMode = (entry as any).unixPermissions;
    if (unixMode && (unixMode & 0o170000) === 0o120000) {
      return {
        valid: false,
        extractedFiles: {},
        totalUncompressedBytes: 0,
        fileCount: 0,
        ignoredPaths,
        warnings,
        error: `SYMLINK_NOT_ALLOWED: Archive contains symlink entry "${entry.name}". Symlinks are not permitted.`
      };
    }

    // Sanitize path
    const { sanitized, error } = sanitizeArchivePath(entry.name);
    if (error) {
      return {
        valid: false,
        extractedFiles: {},
        totalUncompressedBytes: 0,
        fileCount: 0,
        ignoredPaths,
        warnings,
        error: `${error}: Invalid archive entry path "${entry.name}".`
      };
    }

    // Skip empty sanitized path
    if (!sanitized) continue;

    // Check duplicate path
    const lowerPath = sanitized.toLowerCase();
    if (seenPaths.has(lowerPath)) {
      return {
        valid: false,
        extractedFiles: {},
        totalUncompressedBytes: 0,
        fileCount: 0,
        ignoredPaths,
        warnings,
        error: `DUPLICATE_ARCHIVE_PATH: Duplicate entry detected for path "${sanitized}".`
      };
    }
    seenPaths.add(lowerPath);

    // Check exclusions (node_modules, .git, dist, etc.)
    if (isExcludedPath(sanitized)) {
      ignoredPaths.push(sanitized);
      continue;
    }

    // Check sensitive environment files
    if (isSensitiveEnvFile(sanitized)) {
      ignoredPaths.push(sanitized);
      warnings.push(`Excluded sensitive environment file: ${sanitized}`);
      continue;
    }

    // Check allowed source file type
    if (!isAllowedSourceFile(sanitized)) {
      ignoredPaths.push(sanitized);
      continue;
    }

    // Read content
    let content: string;
    try {
      content = await entry.async('string');
    } catch {
      ignoredPaths.push(sanitized);
      continue;
    }

    // Compute byte length of uncompressed content
    const uncompressedBytes = new TextEncoder().encode(content).length;

    // Single file limit
    if (uncompressedBytes > MAX_SINGLE_FILE_BYTES) {
      return {
        valid: false,
        extractedFiles: {},
        totalUncompressedBytes: 0,
        fileCount: 0,
        ignoredPaths,
        warnings,
        error: `FILE_TOO_LARGE: File "${sanitized}" size (${(uncompressedBytes / 1024 / 1024).toFixed(1)}MB) exceeds limit of ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB.`
      };
    }

    totalUncompressedBytes += uncompressedBytes;

    // Total uncompressed size limit
    if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      return {
        valid: false,
        extractedFiles: {},
        totalUncompressedBytes,
        fileCount: Object.keys(rawExtracted).length,
        ignoredPaths,
        warnings,
        error: `UNCOMPRESSED_SIZE_EXCEEDED: Total uncompressed size exceeds limit of ${MAX_ZIP_UNCOMPRESSED_BYTES / 1024 / 1024}MB.`
      };
    }

    // File count limit
    if (Object.keys(rawExtracted).length >= MAX_EXTRACTED_FILES) {
      return {
        valid: false,
        extractedFiles: {},
        totalUncompressedBytes,
        fileCount: Object.keys(rawExtracted).length,
        ignoredPaths,
        warnings,
        error: `TOO_MANY_FILES: Archive contains more than ${MAX_EXTRACTED_FILES} extractable files.`
      };
    }

    rawExtracted[sanitized] = content;
  }

  // Check archive bomb ratio
  if (actualCompressedSize > 0 && totalUncompressedBytes / actualCompressedSize > MAX_COMPRESSION_RATIO) {
    return {
      valid: false,
      extractedFiles: {},
      totalUncompressedBytes,
      fileCount: Object.keys(rawExtracted).length,
      ignoredPaths,
      warnings,
      error: `ARCHIVE_BOMB_DETECTED: Decompression ratio (${(totalUncompressedBytes / actualCompressedSize).toFixed(0)}:1) exceeds safe threshold (${MAX_COMPRESSION_RATIO}:1).`
    };
  }

  // 4. Single root directory unwrapping
  // If all files share the exact same top-level folder (e.g. "my-project/..."), unwrap it.
  const rawPaths = Object.keys(rawExtracted);
  let commonPrefix = '';

  if (rawPaths.length > 0) {
    const firstSlash = rawPaths[0].indexOf('/');
    if (firstSlash > 0) {
      const candidatePrefix = rawPaths[0].slice(0, firstSlash + 1);
      const allSharePrefix = rawPaths.every((p) => p.startsWith(candidatePrefix));
      if (allSharePrefix) {
        commonPrefix = candidatePrefix;
      }
    }
  }

  for (const [filePath, content] of Object.entries(rawExtracted)) {
    const unwrapPath = commonPrefix ? filePath.slice(commonPrefix.length) : filePath;
    // Format authoritative VFS path with leading slash
    const vfsPath = unwrapPath.startsWith('/') ? unwrapPath : `/${unwrapPath}`;
    extractedFiles[vfsPath] = content;
  }

  return {
    valid: true,
    extractedFiles,
    totalUncompressedBytes,
    fileCount: Object.keys(extractedFiles).length,
    ignoredPaths,
    warnings
  };
}
