import { ProjectFile, FileType } from '../../types/workspace';

export function computeFileHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0;
  }
  return `h_${Math.abs(hash).toString(16)}`;
}

export function detectLanguage(path: string): FileType {
  const clean = path.toLowerCase();
  if (clean.endsWith('.tsx') || clean.endsWith('.ts')) return 'typescript';
  if (clean.endsWith('.jsx') || clean.endsWith('.js')) return 'javascript';
  if (clean.endsWith('.json')) return 'json';
  if (clean.endsWith('.css')) return 'css';
  if (clean.endsWith('.html')) return 'html';
  if (clean.endsWith('.md')) return 'markdown';
  if (clean.endsWith('.prisma')) return 'prisma';
  return 'plaintext';
}

export function normalizePath(path: string): string {
  const p = path.replace(/\\/g, '/').trim();
  return p.startsWith('/') ? p : `/${p}`;
}

export function createProjectFile(
  projectId: string,
  path: string,
  content: string,
  language?: FileType
): ProjectFile {
  const normPath = normalizePath(path);
  return {
    id: `${projectId}:${normPath}`,
    projectId,
    path: normPath,
    content,
    hash: computeFileHash(content),
    updatedAt: new Date().toISOString(),
    language: language || detectLanguage(normPath),
    isModified: false
  };
}
