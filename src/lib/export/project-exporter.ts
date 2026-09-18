import JSZip from 'jszip';
import { vfsManager } from '../vfs/vfs-manager';

export interface ExportZipOptions {
  projectId: string;
  projectTitle?: string;
  projectDescription?: string;
}

/**
 * Checks whether a relative path is excluded from export.
 * Excludes: node_modules, dist, build, .env, .env.*, .git, and machine-specific files.
 */
export function isExcludedFromExport(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/g, '');
  const lower = normalized.toLowerCase();

  // Exclude node_modules, dist, build, .git
  if (
    lower.startsWith('node_modules/') ||
    lower === 'node_modules' ||
    lower.startsWith('dist/') ||
    lower === 'dist' ||
    lower.startsWith('build/') ||
    lower === 'build' ||
    lower.startsWith('.git/') ||
    lower === '.git'
  ) {
    return true;
  }

  // Exclude .env and environment files
  const filename = lower.split('/').pop() || '';
  if (filename === '.env' || filename.startsWith('.env.')) {
    return true;
  }

  // Exclude OS/machine specific files
  if (filename === '.ds_store' || filename === 'thumbs.db') {
    return true;
  }

  return false;
}

/**
 * Generates a truthful, accurate README from actual project files and metadata.
 */
export function generateTruthfulReadme(
  title: string,
  description: string,
  pkgJson?: Record<string, any>
): string {
  const scripts = pkgJson?.scripts || {};
  const deps = Object.keys(pkgJson?.dependencies || {});
  const devDeps = Object.keys(pkgJson?.devDependencies || {});

  const techStack: string[] = [];
  if (deps.includes('react')) techStack.push('React');
  if (devDeps.includes('typescript') || devDeps.includes('tsc')) techStack.push('TypeScript');
  if (devDeps.includes('vite') || deps.includes('vite')) techStack.push('Vite');
  if (deps.includes('tailwindcss') || devDeps.includes('tailwindcss')) techStack.push('Tailwind CSS');
  if (deps.includes('lucide-react')) techStack.push('Lucide Icons');

  return `# ${title}

${description ? `${description}\n\n` : ''}Built and exported with **SnapDeploy AI**.

## Tech Stack
${techStack.length > 0 ? techStack.map((t) => `- ${t}`).join('\n') : '- Vite + React'}

## Getting Started

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Development Server
\`\`\`bash
npm run dev
\`\`\`

### 3. Production Build
\`\`\`bash
${scripts.build ? 'npm run build' : 'npm run build'}
\`\`\`
`;
}

/**
 * Packs the authoritative VFS project files into a JSZip archive.
 */
export async function createProjectZip(options: ExportZipOptions): Promise<JSZip> {
  const { projectId, projectTitle, projectDescription } = options;
  const zip = new JSZip();
  const folderName = (projectTitle || projectId).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const projectFolder = zip.folder(folderName) || zip;

  // 1. Authoritative VFS files
  const vfsFiles = vfsManager.getFiles(projectId);

  let hasReadme = false;
  let pkgJsonObj: Record<string, any> | undefined;

  for (const [vfsPath, file] of Object.entries(vfsFiles)) {
    const cleanPath = vfsPath.replace(/\\/g, '/').replace(/^\/+/g, '');

    // Check exclusions
    if (isExcludedFromExport(cleanPath)) {
      continue;
    }

    if (cleanPath.toLowerCase() === 'readme.md') {
      hasReadme = true;
    }

    if (cleanPath === 'package.json') {
      try {
        pkgJsonObj = JSON.parse(file.content);
      } catch {}
    }

    projectFolder.file(cleanPath, file.content);
  }

  // 2. Add truthful README if not already in VFS
  if (!hasReadme) {
    const readmeContent = generateTruthfulReadme(
      projectTitle || projectId,
      projectDescription || '',
      pkgJsonObj
    );
    projectFolder.file('README.md', readmeContent);
  }

  return zip;
}
