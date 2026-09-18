import JSZip from 'jszip';
import { vfsManager } from '../../../lib/vfs/vfs-manager';
import { runtimeManager } from '../../../lib/runtime/runtime-manager';
import { ArtifactPackageResult } from '../../../types/workspace';

export const ARTIFACT_LIMITS = {
  MAX_COMPRESSED_BYTES: 25 * 1024 * 1024,   // 25MB
  MAX_UNCOMPRESSED_BYTES: 50 * 1024 * 1024, // 50MB
  MAX_FILE_COUNT: 500,
  MAX_SINGLE_FILE_BYTES: 10 * 1024 * 1024   // 10MB
};

const EXCLUDED_PATTERNS = [
  /^\.git\//i,
  /^node_modules\//i,
  /^\.env/i,
  /\.env(\..+)?$/i,
  /\.DS_Store$/i,
  /Thumbs\.db$/i,
  /\.map$/i // Source maps excluded to minimize bundle size
];

function isExcludedPath(path: string): boolean {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(clean));
}

function sanitizeArtifactPath(rawPath: string): string {
  let clean = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (clean.includes('..')) {
    throw new Error(`Security error: path traversal forbidden in artifact: '${rawPath}'`);
  }

  if (/^[A-Za-z]:/i.test(clean) || clean.startsWith('//')) {
    throw new Error(`Security error: absolute path forbidden in artifact: '${rawPath}'`);
  }

  return clean;
}

/**
 * Packages compiled output (dist/ or static VFS files) into an in-memory ZIP archive.
 * Non-negotiable:
 * - Operates strictly in-memory (Uint8Array).
 * - Never mutates project source files in VFS.
 * - Enforces file size, count, and compression limits.
 */
export async function packageDeploymentArtifact(
  projectId: string,
  isStatic = false
): Promise<ArtifactPackageResult> {
  const zip = new JSZip();
  let totalUncompressedBytes = 0;
  let fileCount = 0;
  let hasIndexHtml = false;
  let entryFile = '';

  // Case A: Read from WebContainer compiled output directory if available and not static
  let compiledFiles: Record<string, string | Uint8Array> | null = null;

  if (!isStatic && runtimeManager.isBooted()) {
    try {
      const runtime = (runtimeManager as any).runtime;
      const fs = runtime?.webcontainerInstance?.fs;
      if (fs) {
        const readDirRecursive = async (dir: string, prefix = ''): Promise<Record<string, Uint8Array>> => {
          const result: Record<string, Uint8Array> = {};
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
              const fullPath = `${dir}/${entry.name}`;
              if (entry.isDirectory()) {
                const sub = await readDirRecursive(fullPath, relPath);
                Object.assign(result, sub);
              } else if (entry.isFile()) {
                const content = await fs.readFile(fullPath);
                result[relPath] = content;
              }
            }
          } catch {}
          return result;
        };

        // Try dist first, then build
        let discovered = await readDirRecursive('dist');
        if (Object.keys(discovered).length === 0) {
          discovered = await readDirRecursive('build');
        }
        if (Object.keys(discovered).length > 0) {
          compiledFiles = discovered;
        }
      }
    } catch (readErr) {
      console.warn('[ArtifactPackager] WebContainer filesystem read note:', readErr);
    }
  }

  // Case B: Package from compiled files or authoritative VFS files
  if (compiledFiles && Object.keys(compiledFiles).length > 0) {
    for (const [relPath, content] of Object.entries(compiledFiles)) {
      if (isExcludedPath(relPath)) continue;
      const cleanPath = sanitizeArtifactPath(relPath);

      const byteLength = typeof content === 'string'
        ? new TextEncoder().encode(content).length
        : content.length;

      if (byteLength > ARTIFACT_LIMITS.MAX_SINGLE_FILE_BYTES) {
        throw new Error(
          `Artifact file '${cleanPath}' exceeds single-file limit (${(byteLength / (1024 * 1024)).toFixed(1)}MB > 10MB).`
        );
      }

      totalUncompressedBytes += byteLength;
      fileCount++;

      if (fileCount > ARTIFACT_LIMITS.MAX_FILE_COUNT) {
        throw new Error(`Artifact exceeds maximum file limit of ${ARTIFACT_LIMITS.MAX_FILE_COUNT} files.`);
      }

      if (totalUncompressedBytes > ARTIFACT_LIMITS.MAX_UNCOMPRESSED_BYTES) {
        throw new Error(
          `Total uncompressed artifact size exceeds limit of ${(ARTIFACT_LIMITS.MAX_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0)}MB.`
        );
      }

      if (cleanPath === 'index.html' || cleanPath.endsWith('/index.html')) {
        hasIndexHtml = true;
        entryFile = cleanPath;
      }

      zip.file(cleanPath, content);
    }
  } else {
    // Fallback or Static: bundle authoritative VFS files (excluding source/deps if compiled dist exists in VFS)
    const vfsFiles = vfsManager.getFiles(projectId);
    const hasDistInVfs = Object.keys(vfsFiles).some((p) => p.startsWith('/dist/') || p.startsWith('dist/'));

    for (const [rawPath, file] of Object.entries(vfsFiles)) {
      if (isExcludedPath(rawPath)) continue;

      let cleanPath = sanitizeArtifactPath(rawPath);

      // If dist/ exists in VFS, package only files inside dist/
      if (hasDistInVfs && !isStatic) {
        if (!cleanPath.startsWith('dist/')) continue;
        cleanPath = cleanPath.slice(5); // strip "dist/" prefix
      }

      const byteLength = new TextEncoder().encode(file.content).length;
      if (byteLength > ARTIFACT_LIMITS.MAX_SINGLE_FILE_BYTES) {
        throw new Error(
          `Artifact file '${cleanPath}' exceeds single-file limit (${(byteLength / (1024 * 1024)).toFixed(1)}MB > 10MB).`
        );
      }

      totalUncompressedBytes += byteLength;
      fileCount++;

      if (fileCount > ARTIFACT_LIMITS.MAX_FILE_COUNT) {
        throw new Error(`Artifact exceeds maximum file limit of ${ARTIFACT_LIMITS.MAX_FILE_COUNT} files.`);
      }

      if (totalUncompressedBytes > ARTIFACT_LIMITS.MAX_UNCOMPRESSED_BYTES) {
        throw new Error(
          `Total uncompressed artifact size exceeds limit of ${(ARTIFACT_LIMITS.MAX_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0)}MB.`
        );
      }

      if (cleanPath === 'index.html' || cleanPath.endsWith('/index.html')) {
        hasIndexHtml = true;
        entryFile = cleanPath;
      }

      zip.file(cleanPath, file.content);
    }
  }

  if (fileCount === 0) {
    throw new Error('Deployment artifact is empty: no deployable files found.');
  }

  if (!hasIndexHtml) {
    throw new Error('Deployment artifact missing entry point: index.html was not found.');
  }

  // Generate binary zip buffer
  const zipBuffer = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  if (zipBuffer.byteLength > ARTIFACT_LIMITS.MAX_COMPRESSED_BYTES) {
    throw new Error(
      `Compressed deployment ZIP exceeds limit (${(zipBuffer.byteLength / (1024 * 1024)).toFixed(1)}MB > 25MB).`
    );
  }

  return {
    zipBuffer,
    fileCount,
    uncompressedBytes: totalUncompressedBytes,
    compressedBytes: zipBuffer.byteLength,
    entryFile: entryFile || 'index.html'
  };
}
