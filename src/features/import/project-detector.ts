import { DetectedProjectConfig } from '../../types/workspace';

/**
 * Formats a kebab-case, snake_case, or slugified package name into Title Case.
 */
export function formatProjectTitle(rawName: string): string {
  const clean = rawName
    .replace(/^@[\w-]+\//, '') // strip npm scope like @scope/
    .replace(/[._-]+/g, ' ')
    .trim();

  if (!clean) return 'Imported Project';

  return clean
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Inspects extracted project files to detect framework, build scripts, entry points, and lockfiles.
 */
export function detectProjectConfiguration(
  files: Record<string, string>,
  defaultTitle?: string
): DetectedProjectConfig {
  const warnings: string[] = [];
  const filePaths = Object.keys(files);

  // 1. Locate package.json
  const pkgPath = filePaths.find((p) => p === '/package.json' || p === 'package.json');
  let pkgJson: Record<string, any> | null = null;

  if (pkgPath && files[pkgPath]) {
    try {
      pkgJson = JSON.parse(files[pkgPath]);
    } catch {
      warnings.push('package.json could not be parsed as valid JSON.');
    }
  }

  // 2. Lockfile detection
  let hasLockfile = false;
  let lockfileType: 'npm' | 'yarn' | 'pnpm' | 'bun' | undefined;

  if (files['/package-lock.json'] !== undefined || files['package-lock.json'] !== undefined) {
    hasLockfile = true;
    lockfileType = 'npm';
  } else if (files['/yarn.lock'] !== undefined || files['yarn.lock'] !== undefined) {
    hasLockfile = true;
    lockfileType = 'yarn';
  } else if (files['/pnpm-lock.yaml'] !== undefined || files['pnpm-lock.yaml'] !== undefined) {
    hasLockfile = true;
    lockfileType = 'pnpm';
  } else if (
    files['/bun.lockb'] !== undefined ||
    files['bun.lockb'] !== undefined ||
    files['/bun.lock'] !== undefined ||
    files['bun.lock'] !== undefined
  ) {
    hasLockfile = true;
    lockfileType = 'bun';
  }

  // 3. TypeScript check
  const hasTsConfig = Boolean(files['/tsconfig.json'] || files['tsconfig.json']);
  const hasTsFiles = filePaths.some((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
  const hasTypeScript = hasTsConfig || hasTsFiles;

  // 4. Framework signatures
  let framework = 'custom';
  let badge = 'Project';

  if (pkgJson) {
    const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
    const depNames = Object.keys(deps);

    const hasVite = depNames.includes('vite');
    const hasReact = depNames.includes('react') || depNames.includes('@vitejs/plugin-react');
    const hasVue = depNames.includes('vue') || depNames.includes('@vitejs/plugin-vue');
    const hasSvelte = depNames.includes('svelte') || depNames.includes('@sveltejs/vite-plugin-svelte');
    const hasNext = depNames.includes('next');

    if (hasVite && hasReact) {
      framework = 'vite-react';
      badge = 'Vite + React';
    } else if (hasVite && hasVue) {
      framework = 'vite-vue';
      badge = 'Vite + Vue';
    } else if (hasVite && hasSvelte) {
      framework = 'vite-svelte';
      badge = 'Vite + Svelte';
    } else if (hasVite) {
      framework = 'vite';
      badge = 'Vite';
    } else if (hasNext) {
      framework = 'nextjs';
      badge = 'Next.js';
    } else if (hasReact) {
      framework = 'react';
      badge = 'React';
    } else if (hasVue) {
      framework = 'vue';
      badge = 'Vue';
    } else if (hasSvelte) {
      framework = 'svelte';
      badge = 'Svelte';
    } else {
      framework = 'node-web';
      badge = 'Node Web';
    }
  } else {
    // No package.json
    const hasHtml = Boolean(files['/index.html'] || files['index.html']);
    if (hasHtml) {
      framework = 'static-web';
      badge = 'Static HTML';
    } else {
      framework = 'custom';
      badge = 'Project';
    }
  }

  // 5. Scripts detection
  const scriptsObj = pkgJson?.scripts || {};
  const scripts = {
    dev: typeof scriptsObj.dev === 'string' ? scriptsObj.dev : undefined,
    build: typeof scriptsObj.build === 'string' ? scriptsObj.build : undefined,
    test: typeof scriptsObj.test === 'string' ? scriptsObj.test : undefined,
    start: typeof scriptsObj.start === 'string' ? scriptsObj.start : undefined
  };

  // 6. Title and Description
  let title = defaultTitle || 'Imported Project';
  if (pkgJson?.name && typeof pkgJson.name === 'string') {
    title = formatProjectTitle(pkgJson.name);
  }

  const description =
    (pkgJson?.description && typeof pkgJson.description === 'string' ? pkgJson.description : '') ||
    `Imported ${badge} application`;

  // 7. Primary entry file detection
  const preferredEntries = [
    '/src/App.tsx',
    '/src/App.jsx',
    '/src/App.vue',
    '/src/App.svelte',
    '/src/main.tsx',
    '/src/main.ts',
    '/src/main.jsx',
    '/src/main.js',
    '/src/index.tsx',
    '/src/index.ts',
    '/src/index.jsx',
    '/src/index.js',
    '/app/page.tsx',
    '/pages/index.tsx',
    '/index.html',
    '/package.json'
  ];

  let primaryEntryFile = preferredEntries.find((entry) => files[entry] !== undefined) || '';

  if (!primaryEntryFile && filePaths.length > 0) {
    // Pick the first non-hidden source file
    const candidate = filePaths.find(
      (p) => !p.startsWith('/.') && (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.html'))
    );
    primaryEntryFile = candidate || filePaths[0] || '';
  }

  return {
    framework,
    badge,
    title,
    description,
    hasPackageJson: Boolean(pkgJson),
    hasTypeScript,
    hasLockfile,
    lockfileType,
    primaryEntryFile,
    scripts,
    warnings
  };
}
