import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import ts from 'typescript';
import {
  AIProvider,
  GeneratedProjectPayload
} from './AIProvider';
import {
  GenerationInput,
  ProjectPlan,
  DiagnosticInput,
  Diagnosis,
  RepairInput,
  Patch,
  PatchFileChange,
  EditInput,
  EditProposal
} from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CANONICAL_LOCK_PATH = path.resolve(__dirname, '../templates/canonical-package-lock.json');
let cachedCanonicalLock: string | null = null;

export interface AIExecutionRecord {
  id: string;
  projectId?: string;
  operation: 'generate' | 'diagnose' | 'repair' | 'edit';
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export class GeminiAIProvider implements AIProvider {
  public readonly name = 'gemini';
  private ai: GoogleGenAI | null = null;
  private modelName: string = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  private executionHistory: AIExecutionRecord[] = [];

  constructor() {
    this.modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    this.initClient();
  }

  private initClient(): void {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.trim() !== '' && apiKey !== 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
      try {
        this.ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      } catch (err: any) {
        console.error('[Gemini Provider] Failed to initialize GoogleGenAI client:', err?.message);
        this.ai = null;
      }
    }
  }

  public isConfigured(): boolean {
    if (!this.ai) {
      this.initClient();
    }
    const apiKey = process.env.GEMINI_API_KEY;
    return !!(apiKey && apiKey.trim() !== '' && apiKey !== 'PASTE_YOUR_GEMINI_API_KEY_HERE' && this.ai !== null);
  }

  public getModelName(): string {
    return this.modelName;
  }

  public getExecutionHistory(): AIExecutionRecord[] {
    return [...this.executionHistory];
  }

  private ensureClient(): GoogleGenAI {
    // Re-check environment variable in case .env was loaded or updated
    if (!this.ai) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey.trim() !== '' && apiKey !== 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
        this.ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      }
    }

    if (!this.ai) {
      const err: any = new Error('GEMINI_PROVIDER_UNAVAILABLE: Gemini API key is not configured. Please set a valid GEMINI_API_KEY in .env on the server.');
      err.code = 'GEMINI_PROVIDER_UNAVAILABLE';
      throw err;
    }
    return this.ai;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs = 90_000): Promise<T> {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err: any = new Error(`Gemini request timed out after ${timeoutMs}ms`);
        err.code = 'GEMINI_TIMEOUT';
        reject(err);
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  public async executeWithRetry<T>(fn: () => Promise<T>, maxRetries = 2, timeoutMs = 90_000): Promise<T> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await this.withTimeout(fn(), timeoutMs);
      } catch (err: any) {
        attempt++;

        // Never retry authentication / authorization / client validation failures
        const isAuthError = err?.message?.includes('API_KEY_INVALID') ||
                            err?.message?.includes('401') ||
                            err?.message?.includes('403') ||
                            err?.code === 'GEMINI_PROVIDER_UNAVAILABLE';
        if (isAuthError) {
          throw err;
        }

        // Only retry transient rate-limits (429) or transient server errors (503/500)
        const isTransient = err?.message?.includes('429') ||
                            err?.message?.includes('RESOURCE_EXHAUSTED') ||
                            err?.message?.includes('quota') ||
                            err?.status === 'RESOURCE_EXHAUSTED' ||
                            err?.message?.includes('503') ||
                            err?.message?.includes('500');

        if (isTransient && attempt <= maxRetries) {
          const delaySec = Math.min(attempt * 2, 5); // Bounded backoff
          console.log(`[Gemini Provider] Transient error encountered. Retrying in ${delaySec}s (Attempt ${attempt}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
        } else {
          throw err;
        }
      }
    }
    throw new Error('Exceeded maximum retry attempts');
  }

  public async generateProject(input: GenerationInput): Promise<GeneratedProjectPayload> {
    const client = this.ensureClient();
    const startTime = Date.now();
    const execId = `exec_gen_${Date.now()}`;

    const promptText = input.prompt.trim();
    if (!promptText) {
      throw new Error('Generation prompt cannot be empty');
    }

    const systemInstruction = `You are the code-generation engine for SnapDeploy AI.
Generate a complete, production-ready, fully functional Vite + React 18 + TypeScript web application.

CRITICAL REQUIREMENTS:
1. Return ONLY a valid JSON object matching the requested schema. Do not wrap in markdown or prose.
2. Must contain all required setup files:
   - "/package.json" (with dependencies: react ^18.3.1, react-dom ^18.3.1, lucide-react ^0.344.0, clsx ^2.1.0; devDependencies: tailwindcss ^3.4.17, postcss ^8.5.2, autoprefixer ^10.4.20; and scripts: "dev": "vite", "build": "npx tsc --noEmit && npx vite build")
   - "/tsconfig.json" (compilerOptions with target ES2020, jsx react-jsx, skipLibCheck true, moduleResolution bundler)
   - "/vite.config.ts" (using @vitejs/plugin-react and server port 3000)
   - "/postcss.config.js" (export default with tailwindcss and autoprefixer plugins)
   - "/tailwind.config.js" (export default with content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'])
   - "/src/index.css" (with @tailwind base; @tailwind components; @tailwind utilities;)
   - "/index.html" (clean standard HTML shell with <div id="root"></div> and <script type="module" src="/src/main.tsx"></script>; do NOT use %PUBLIC_URL%, and NEVER use external CDN scripts like cdn.tailwindcss.com)
   - "/src/main.tsx" (importing './index.css' and mounting App with createRoot)
   - "/src/App.tsx" (interactive, complete React application UI with state)
   - "/src/components/..." (clean modular components fulfilling user requirement)
3. Every file must contain 100% COMPLETE, non-placeholder source code.
4. No fake APIs, no hardcoded secrets, no unresolved dependencies.
5. All file paths must be relative to root starting with "/" (e.g. "/src/App.tsx"). Never use ".." path traversal.
6. ZERO TYPESCRIPT COMPILATION ERRORS:
   - All TypeScript files must compile cleanly under "npx tsc --noEmit" with 0 errors.
   - Every component in /src/components/ that is passed props from /src/App.tsx MUST declare all of those props in its Props interface AND destructure them in the function parameters.
   - Any callback function called in a component (e.g. onAddCustomer, onSelectInvoice, onDeleteInvoice, onNavigate, onClose) MUST be declared in props with optional typing (e.g. onAddCustomer?: (item: any) => void) and destructured in parameters ({ ..., onAddCustomer }).
   - NEVER reference an undeclared identifier.`;

    try {
      const response = await this.executeWithRetry(() => client.models.generateContent({
        model: this.modelName,
        contents: `User Prompt: ${promptText}\nProject Framework: ${input.framework || 'vite-react'}\nSuggested Name: ${input.name || 'web-app'}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              framework: { type: 'string', enum: ['vite-react'] },
              dependencies: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    version: { type: 'string' }
                  },
                  required: ['name']
                }
              },
              scripts: {
                type: 'object',
                properties: {
                  dev: { type: 'string' },
                  build: { type: 'string' }
                },
                required: ['dev', 'build']
              },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    purpose: { type: 'string' },
                    content: { type: 'string' }
                  },
                  required: ['path', 'purpose', 'content']
                }
              }
            },
            required: ['name', 'framework', 'dependencies', 'scripts', 'files']
          }
        }
      }), 2, 180_000);

      const responseText = response.text || '';
      if (!responseText.trim()) {
        throw new Error('Gemini returned an empty generation response');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(responseText);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse Gemini structured JSON: ${parseErr?.message}`);
      }

      // Security Validation of Generated Plan & Files
      if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
        throw new Error('Generated project contains no files');
      }

      const filesMap: Record<string, string> = {};

      for (const fileObj of parsed.files) {
        if (!fileObj.path || typeof fileObj.path !== 'string') {
          throw new Error('Generated file is missing valid path string');
        }

        let normalizedPath = fileObj.path.trim();
        if (!normalizedPath.startsWith('/')) {
          normalizedPath = '/' + normalizedPath;
        }

        // Reject path traversal attacks
        if (normalizedPath.includes('..') || normalizedPath.startsWith('/etc') || normalizedPath.startsWith('/root')) {
          throw new Error(`Rejected unsafe generated file path: ${normalizedPath}`);
        }

        if (filesMap[normalizedPath]) {
          throw new Error(`Duplicate file path generated: ${normalizedPath}`);
        }

        if (typeof fileObj.content !== 'string' || fileObj.content.length === 0) {
          throw new Error(`Generated file content is empty for ${normalizedPath}`);
        }

        filesMap[normalizedPath] = this.sanitizeSourceCode(fileObj.content, normalizedPath);
      }

      // Ensure and validate critical entry points exist
      filesMap['/package.json'] = this.normalizePackageJson(filesMap['/package.json'], parsed.name);
      const pkgJsonObj = JSON.parse(filesMap['/package.json']);

      // Attach canonical package-lock.json only when compatible with baseline and not already provided
      const existingLock = filesMap['/package-lock.json'] || filesMap['package-lock.json'];
      if (!existingLock && this.isCanonicalBaselineCompatible(pkgJsonObj)) {
        filesMap['/package-lock.json'] = this.getCanonicalPackageLock();
      }

      // Ensure and normalize /tsconfig.json
      let tsconfigObj: any = null;
      if (filesMap['/tsconfig.json']) {
        try {
          tsconfigObj = JSON.parse(filesMap['/tsconfig.json']);
        } catch {
          tsconfigObj = null;
        }
      }

      if (!tsconfigObj || typeof tsconfigObj !== 'object') {
        tsconfigObj = {
          compilerOptions: {},
          include: ['src']
        };
      }

      const compilerOpts = tsconfigObj.compilerOptions || {};
      if ('fallthroughCasesInSwitch' in compilerOpts) {
        delete compilerOpts.fallthroughCasesInSwitch;
        compilerOpts.noFallthroughCasesInSwitch = true;
      }

      tsconfigObj.compilerOptions = {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
        noFallthroughCasesInSwitch: true,
        ...compilerOpts,
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true
      };
      if ('fallthroughCasesInSwitch' in tsconfigObj.compilerOptions) {
        delete tsconfigObj.compilerOptions.fallthroughCasesInSwitch;
      }
      tsconfigObj.include = tsconfigObj.include || ['src'];

      filesMap['/tsconfig.json'] = JSON.stringify(tsconfigObj, null, 2);

      // Ensure /src/App.tsx has default export if referenced by main.tsx
      if (filesMap['/src/App.tsx'] && !filesMap['/src/App.tsx'].includes('export default') && filesMap['/src/App.tsx'].includes('function App')) {
        filesMap['/src/App.tsx'] += '\nexport default App;\n';
      }

      // Ensure /postcss.config.js
      if (!filesMap['/postcss.config.js']) {
        filesMap['/postcss.config.js'] = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
      }

      // Ensure /tailwind.config.js
      if (!filesMap['/tailwind.config.js']) {
        filesMap['/tailwind.config.js'] = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
`;
      }

      // Ensure /src/index.css
      if (!filesMap['/src/index.css']) {
        filesMap['/src/index.css'] = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
      } else {
        let cssContent = filesMap['/src/index.css'];
        if (!cssContent.includes('@tailwind')) {
          filesMap['/src/index.css'] = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${cssContent}`;
        }
      }

      // Ensure /src/main.tsx imports ./index.css
      if (filesMap['/src/main.tsx']) {
        let mainContent = filesMap['/src/main.tsx'];
        if (!mainContent.includes('./index.css') && !mainContent.includes('/index.css')) {
          filesMap['/src/main.tsx'] = `import './index.css';\n${mainContent}`;
        }
      }

      // Ensure and normalize /index.html (never rely on cdn.tailwindcss.com, sanitize URIs for Vite build)
      filesMap['/index.html'] = this.normalizeIndexHtml(filesMap['/index.html'], parsed.name);

      // Ensure /vite.config.ts
      if (!filesMap['/vite.config.ts']) {
        filesMap['/vite.config.ts'] = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  }
});`;
      }

      // Ensure /README.md documenting the tech and styling stack
      if (!filesMap['/README.md']) {
        const title = parsed.name || 'SnapDeploy Application';
        filesMap['/README.md'] = `# ${title}

A modern, production-grade web application generated with **SnapDeploy AI**.

## Tech Stack
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite 5
- **Styling:** Tailwind CSS (v3.4.17), PostCSS, and Autoprefixer (locally compiled, zero external CDNs)
- **Icons:** Lucide React

## Development
To start the local development server:
\`\`\`bash
npm install
npm run dev
\`\`\`

## Production Build
To verify type safety and produce a production build:
\`\`\`bash
npm run build
\`\`\`
`;
      } else {
        let readme = filesMap['/README.md'];
        if (!readme.toLowerCase().includes('tailwind')) {
          readme += `\n\n## Styling\nStyled with Tailwind CSS, PostCSS, and Autoprefixer (locally compiled).\n`;
          filesMap['/README.md'] = readme;
        }
      }

      // Ensure /src/vite-env.d.ts exists
      if (!filesMap['/src/vite-env.d.ts']) {
        filesMap['/src/vite-env.d.ts'] = '/// <reference types="vite/client" />\n';
      }

      // Reconcile passed JSX props and callback handlers across components
      this.reconcileComponentProps(filesMap);

      // Perform final generation validation on the complete project file tree
      this.validateFinalGeneratedProject(filesMap);

      // Build the final ProjectPlan.files strictly from the final normalized filesMap
      const finalPlanFiles = Object.keys(filesMap).map((path) => ({
        path,
        purpose: path.includes('components')
          ? 'Modular UI component'
          : path.endsWith('.html')
          ? 'HTML entry point'
          : path.endsWith('.json')
          ? 'Project configuration'
          : path.endsWith('.config.ts')
          ? 'Vite build configuration'
          : 'Application source file'
      }));

      const plan: ProjectPlan = {
        name: parsed.name || 'gemini-generated-app',
        framework: 'vite-react',
        files: finalPlanFiles,
        dependencies: [
          { name: 'react', version: '^18.3.1' },
          { name: 'react-dom', version: '^18.3.1' },
          { name: 'lucide-react', version: '^0.344.0' },
          { name: 'clsx', version: '^2.1.0' }
        ],
        scripts: pkgJsonObj.scripts
      };

      this.recordExecution({
        id: execId,
        operation: 'generate',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: true
      });

      return { plan, files: filesMap };
    } catch (err: any) {
      this.recordExecution({
        id: execId,
        operation: 'generate',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: false,
        error: err?.message
      });
      throw err;
    }
  }

  /**
   * Normalizes /index.html: ensures root mount, entry script import, strips external CDN styling,
   * and sanitizes malformed URIs (e.g. data:image/svg+xml with unescaped % or %PUBLIC_URL%)
   * to guarantee Vite's build-html plugin never crashes with decodeURI() errors.
   */
  public normalizeIndexHtml(html?: string, fallbackTitle = 'SnapDeploy App'): string {
    if (!html || typeof html !== 'string' || html.trim().length === 0) {
      return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${fallbackTitle}</title>
  </head>
  <body class="bg-slate-950 text-slate-50 min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
    }

    let sanitized = html.replace(/<%=\s*'<'\s*%>/g, '<').replace(/<%=\s*'>'\s*%>/g, '>');
    sanitized = sanitized.replace(/<doctype\s+html>/gi, '<!doctype html>');
    sanitized = sanitized.replace(/="+"([^"]*?)"+"/g, '="$1"');
    sanitized = sanitized.replace(/='+'([^']*?)'+'/g, '="$1"');
    sanitized = sanitized.replace(/<script[^>]*src=["']https:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi, '');

    // Sanitize any malformed href/src attributes (e.g. data:image/svg+xml with unescaped % or %PUBLIC_URL%)
    // that cause Vite's build-html plugin to crash with "URI malformed" in decodeURI()
    sanitized = sanitized.replace(/<(link|script|img)\b[^>]*\b(href|src)=["']([^"']*)["'][^>]*>/gi, (match, tag, attr, val) => {
      try {
        decodeURI(val);
        return match;
      } catch {
        try {
          const repaired = val.replace(/%PUBLIC_URL%/g, '').replace(/%%+/g, '%');
          decodeURI(repaired);
          return match.replace(val, repaired);
        } catch {
          if (tag.toLowerCase() === 'link' && /rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/i.test(match)) {
            return '';
          }
          return match.replace(val, '#');
        }
      }
    });

    if (!sanitized.includes('id="root"')) {
      sanitized = sanitized.replace('</body>', '  <div id="root"></div>\n  <script type="module" src="/src/main.tsx"></script>\n</body>');
    }
    if (!sanitized.includes('/src/main.tsx')) {
      sanitized = sanitized.replace('</body>', '  <script type="module" src="/src/main.tsx"></script>\n</body>');
    }

    return sanitized;
  }

  /**
   * Normalizes and validates /package.json, ensuring canonical dependencies and stripping redundant styling packages.
   */
  public normalizePackageJson(rawPackageJsonStr?: string, parsedProjectName?: string): string {
    let pkgJsonObj: any = null;
    if (rawPackageJsonStr) {
      try {
        pkgJsonObj = JSON.parse(rawPackageJsonStr);
      } catch {
        throw new Error('Generated /package.json contains invalid JSON syntax');
      }
    } else {
      pkgJsonObj = {
        name: parsedProjectName || 'snapdeploy-app',
        private: true,
        version: '1.0.0',
        type: 'module'
      };
    }

    // Normalize and validate scripts for WebContainer execution
    pkgJsonObj.scripts = pkgJsonObj.scripts || {};
    pkgJsonObj.scripts.dev = pkgJsonObj.scripts.dev || 'vite';

    let buildCmd = (pkgJsonObj.scripts.build || '').trim();
    if (!buildCmd) {
      buildCmd = 'npx tsc --noEmit && npx vite build';
    } else {
      // Ensure explicit executable resolution (npx tsc & npx vite) for WebContainer jsh
      buildCmd = buildCmd.replace(/\btsc\b/g, 'npx tsc').replace(/npx\s+npx\s+tsc/g, 'npx tsc');
      buildCmd = buildCmd.replace(/\bvite\s+build\b/g, 'npx vite build').replace(/npx\s+npx\s+vite/g, 'npx vite');
    }

    if (!buildCmd.includes('vite build') && !buildCmd.includes('tsc')) {
      throw new Error(`Generation validation failed: /package.json contains an unresolvable build script: "${buildCmd}"`);
    }

    pkgJsonObj.scripts.build = buildCmd;

    // Ensure essential dependencies and devDependencies are declared
    pkgJsonObj.dependencies = {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'lucide-react': '^0.344.0',
      clsx: '^2.1.0',
      ...(pkgJsonObj.dependencies || {})
    };
    pkgJsonObj.devDependencies = {
      '@types/react': '^18.3.3',
      '@types/react-dom': '^18.3.0',
      '@vitejs/plugin-react': '^4.3.0',
      autoprefixer: '^10.4.20',
      postcss: '^8.5.2',
      tailwindcss: '^3.4.17',
      typescript: '^5.4.5',
      vite: '^5.2.11',
      ...(pkgJsonObj.devDependencies || {})
    };

    // Remove conflicting duplicates between dependencies and devDependencies
    for (const depKey of Object.keys(pkgJsonObj.dependencies)) {
      if (depKey in pkgJsonObj.devDependencies) {
        delete pkgJsonObj.devDependencies[depKey];
      }
    }

    // Ensure local styling packages are guaranteed in devDependencies
    const stylingPkgs = ['tailwindcss', 'postcss', 'autoprefixer'];
    for (const pkg of stylingPkgs) {
      if (pkg in pkgJsonObj.dependencies) {
        pkgJsonObj.devDependencies[pkg] = pkgJsonObj.dependencies[pkg];
        delete pkgJsonObj.dependencies[pkg];
      }
    }
    pkgJsonObj.devDependencies.tailwindcss = pkgJsonObj.devDependencies.tailwindcss || '^3.4.17';
    pkgJsonObj.devDependencies.postcss = pkgJsonObj.devDependencies.postcss || '^8.5.2';
    pkgJsonObj.devDependencies.autoprefixer = pkgJsonObj.devDependencies.autoprefixer || '^10.4.20';

    return JSON.stringify(pkgJsonObj, null, 2);
  }

  /**
   * Retrieves the pre-computed canonical package-lock.json template.
   */
  public getCanonicalPackageLock(): string {
    if (!cachedCanonicalLock) {
      if (fs.existsSync(CANONICAL_LOCK_PATH)) {
        cachedCanonicalLock = fs.readFileSync(CANONICAL_LOCK_PATH, 'utf-8');
      } else {
        throw new Error(`Canonical package-lock.json template not found at ${CANONICAL_LOCK_PATH}`);
      }
    }
    return cachedCanonicalLock;
  }

  /**
   * Determines whether a package.json manifest is compatible with the canonical baseline lockfile.
   */
  public isCanonicalBaselineCompatible(pkgJson: any): boolean {
    if (!pkgJson || typeof pkgJson !== 'object') return false;
    const deps = pkgJson.dependencies || {};
    const devDeps = pkgJson.devDependencies || {};

    // Must contain all core baseline packages
    if (!deps.react || !deps['react-dom'] || !deps['lucide-react'] || !deps.clsx) {
      return false;
    }
    if (
      !devDeps['@types/react'] ||
      !devDeps['@types/react-dom'] ||
      !devDeps['@vitejs/plugin-react'] ||
      !devDeps.typescript ||
      !devDeps.vite ||
      !devDeps.tailwindcss ||
      !devDeps.postcss ||
      !devDeps.autoprefixer
    ) {
      return false;
    }

    // Must be semver-compatible with React 18, Vite 5, TS 5, Plugin-React 4, Tailwind 3
    const reactVer = String(deps.react).trim();
    if (!reactVer.includes('18')) return false;

    const reactDomVer = String(deps['react-dom']).trim();
    if (!reactDomVer.includes('18')) return false;

    const viteVer = String(devDeps.vite).trim();
    if (!viteVer.includes('5')) return false;

    const tsVer = String(devDeps.typescript).trim();
    if (!tsVer.includes('5')) return false;

    const pluginReactVer = String(devDeps['@vitejs/plugin-react']).trim();
    if (!pluginReactVer.includes('4')) return false;

    const tailwindVer = String(devDeps.tailwindcss).trim();
    if (!tailwindVer.includes('3')) return false;

    return true;
  }

  /**
   * Generation validation step: verifies structural completeness and safety before returning.
   */
  public validateFinalGeneratedProject(filesMap: Record<string, string>): void {
    const requiredCoreFiles = [
      '/package.json',
      '/tsconfig.json',
      '/vite.config.ts',
      '/index.html',
      '/src/main.tsx',
      '/src/App.tsx'
    ];

    for (const req of requiredCoreFiles) {
      if (!filesMap[req] || filesMap[req].trim().length === 0) {
        throw new Error(`Generation validation failed: required file '${req}' is missing or empty`);
      }
    }

    // Validate package.json
    let pkg: any;
    try {
      pkg = JSON.parse(filesMap['/package.json']);
      if (!pkg.scripts || !pkg.scripts.build || pkg.scripts.build.trim().length === 0) {
        throw new Error("Generation validation failed: package.json missing non-empty 'build' script");
      }
      if (!pkg.scripts.dev || pkg.scripts.dev.trim().length === 0) {
        throw new Error("Generation validation failed: package.json missing non-empty 'dev' script");
      }
      if (!pkg.dependencies || !pkg.dependencies.react || !pkg.dependencies['react-dom']) {
        throw new Error("Generation validation failed: package.json missing required React dependencies");
      }
    } catch (err: any) {
      throw new Error(`Generation validation failed: invalid package.json (${err?.message})`);
    }

    // Validate tsconfig.json
    try {
      const tsconfig = JSON.parse(filesMap['/tsconfig.json']);
      if (!tsconfig.compilerOptions) {
        throw new Error("Generation validation failed: tsconfig.json missing compilerOptions");
      }
    } catch (err: any) {
      throw new Error(`Generation validation failed: invalid tsconfig.json (${err?.message})`);
    }

    // Validate all file paths and secret protection (prevent traversal & credential leakage)
    for (const [path, content] of Object.entries(filesMap)) {
      if (!path.startsWith('/') || path.includes('..')) {
        throw new Error(`Generation validation failed: invalid file path '${path}'`);
      }
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error(`Generation validation failed: file content is empty for '${path}'`);
      }
      if (/AIzaSy[0-9A-Za-z-_]{25,45}/.test(content) || /sk-[a-zA-Z0-9]{20,}/.test(content) || /ghp_[a-zA-Z0-9]{20,}/.test(content)) {
        throw new Error(`Generation validation failed: potential secret or API key detected in '${path}'`);
      }
    }

    // Validate 9-Point Styling Consistency Contract (local Tailwind CSS pipeline)
    const requiredStylingFiles = [
      '/postcss.config.js',
      '/tailwind.config.js',
      '/src/index.css',
      '/README.md'
    ];

    for (const req of requiredStylingFiles) {
      if (!filesMap[req] || filesMap[req].trim().length === 0) {
        throw new Error(`Generation validation failed: required file '${req}' is missing or empty`);
      }
    }

    if (!pkg.devDependencies || !pkg.devDependencies.tailwindcss || !pkg.devDependencies.postcss || !pkg.devDependencies.autoprefixer) {
      throw new Error("Generation validation failed: package.json missing required Tailwind CSS devDependencies");
    }

    // Validate index.html does not rely on external CDN styling
    if (filesMap['/index.html'].includes('cdn.tailwindcss.com')) {
      throw new Error("Generation validation failed: /index.html must not contain external CDN styling script 'cdn.tailwindcss.com'");
    }

    // Validate src/main.tsx imports index.css
    if (!filesMap['/src/main.tsx'].includes('index.css')) {
      throw new Error("Generation validation failed: /src/main.tsx must import './index.css'");
    }

    // Validate src/index.css contains @tailwind directives
    if (!filesMap['/src/index.css'].includes('@tailwind')) {
      throw new Error("Generation validation failed: /src/index.css must contain @tailwind directives");
    }

    // Validate README.md documents styling stack
    if (!filesMap['/README.md'].toLowerCase().includes('tailwind')) {
      throw new Error("Generation validation failed: /README.md must document Tailwind CSS styling");
    }
  }

  /**
   * Reconciles passed JSX props from caller components (e.g. /src/App.tsx) with
   * callee component declarations in /src/components/*.
   * If a parent passes a prop (e.g. `onAddCustomer={handleAddCustomer}`) and the
   * child component uses `onAddCustomer(...)` in its body but forgot to include
   * `onAddCustomer` in its destructured props or Props interface, this ensures
   * the prop is properly declared and destructured so `tsc --noEmit` compiles with 0 errors.
   */
  public reconcileComponentProps(filesMap: Record<string, string>): void {
    const passedPropsByComponent: Record<string, Set<string>> = {};
    const jsxRegex = /<([A-Z][a-zA-Z0-9_]*)\b([^>]*?)(?:\/?>|>)/g;

    for (const [filePath, content] of Object.entries(filesMap)) {
      if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) continue;
      let match: RegExpExecArray | null;
      while ((match = jsxRegex.exec(content)) !== null) {
        const compName = match[1];
        const attrsStr = match[2];
        if (!passedPropsByComponent[compName]) {
          passedPropsByComponent[compName] = new Set();
        }
        const attrRegex = /\b([a-zA-Z0-9_]+)\s*=/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
          passedPropsByComponent[compName].add(attrMatch[1]);
        }
      }
    }

    for (const [filePath, content] of Object.entries(filesMap)) {
      if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) continue;

      const baseNameMatch = filePath.match(/\/([A-Z][a-zA-Z0-9_]*)\.[jt]sx?$/);
      if (!baseNameMatch) continue;
      const compName = baseNameMatch[1];

      let updatedContent = content;
      const passedProps = passedPropsByComponent[compName] || new Set<string>();

      const callbackCalls = new Set<string>();
      const callRegex = /\b((?:on|handle)[A-Z][a-zA-Z0-9_]*)\s*\(/g;
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRegex.exec(updatedContent)) !== null) {
        callbackCalls.add(callMatch[1]);
      }

      const candidateIdentifiers = new Set<string>([...passedProps, ...callbackCalls]);
      const missingProps: string[] = [];

      for (const id of candidateIdentifiers) {
        if (id === 'key' || id === 'ref' || id === 'children' || id === 'className') continue;

        const isImported = new RegExp(`\\bimport\\s+[^;]*?\\b${id}\\b`, 'm').test(updatedContent);
        if (isImported) continue;

        const isLocallyDeclared = new RegExp(`\\b(?:const|let|var|function)\\s+${id}\\b`, 'm').test(updatedContent);
        if (isLocallyDeclared) continue;

        const isDestructured = new RegExp(`\\(\\s*\\{[^}]*?\\b${id}\\b[^}]*?\\}`, 'm').test(updatedContent);
        if (isDestructured) continue;

        const isUsedInBody = new RegExp(`\\b${id}\\b`, 'm').test(updatedContent);
        if (isUsedInBody) {
          missingProps.push(id);
        }
      }

      if (missingProps.length > 0) {
        // Check for inline type annotation: ({ a, b }: { a: string; b: string })
        const inlineTypeRegex = /(\b(?:export\s+(?:default\s+)?)?(?:function\s+(?:[A-Z][a-zA-Z0-9_]*\s*)?|const\s+[A-Z][a-zA-Z0-9_]*\s*=\s*(?:async\s*)?)\(\s*\{)([^}]*)(\}\s*:\s*\{)([^}]*)(\})/m;
        if (inlineTypeRegex.test(updatedContent)) {
          updatedContent = updatedContent.replace(inlineTypeRegex, (_m, prefix, params, mid, typeBody, suffix) => {
            const cleanParams = params.trim();
            const cleanType = typeBody.trim();
            const paramAdditions = missingProps
              .filter(p => !new RegExp(`\\b${p}\\b`).test(cleanParams))
              .map(p => `${p} = () => {}`)
              .join(', ');
            const typeAdditions = missingProps
              .filter(p => !new RegExp(`\\b${p}\\b`).test(cleanType))
              .map(p => `${p}?: any;`)
              .join(' ');
            const newParams = cleanParams.length > 0 && paramAdditions ? `${cleanParams}, ${paramAdditions}` : (cleanParams || paramAdditions);
            const newType = cleanType.length > 0 && typeAdditions ? `${cleanType} ${typeAdditions}` : (cleanType || typeAdditions);
            return `${prefix} ${newParams} ${mid} ${newType} ${suffix}`;
          });
        } else {
          // Standard destructuring: ({ a, b }: SomeProps) or ({ a, b })
          const paramDestructureRegex = /(\b(?:export\s+(?:default\s+)?)?(?:function\s+(?:[A-Z][a-zA-Z0-9_]*\s*)?|const\s+[A-Z][a-zA-Z0-9_]*\s*=\s*(?:async\s*)?)\(\s*\{)([^}]*)(\})/m;
          if (paramDestructureRegex.test(updatedContent)) {
            updatedContent = updatedContent.replace(paramDestructureRegex, (_m, prefix, existingParams, suffix) => {
              const cleanParams = existingParams.trim();
              const additions = missingProps
                .filter(p => !new RegExp(`\\b${p}\\b`).test(cleanParams))
                .map(p => `${p} = () => {}`)
                .join(', ');
              if (!additions) return `${prefix}${existingParams}${suffix}`;
              return cleanParams.length > 0
                ? `${prefix} ${cleanParams}, ${additions} ${suffix}`
                : `${prefix} ${additions} ${suffix}`;
            });
          } else {
            // Single parameter object: function View(props: ViewProps) { ... }
            const singleParamRegex = /(\b(?:export\s+(?:default\s+)?)?(?:function\s+(?:[A-Z][a-zA-Z0-9_]*\s*)?|const\s+[A-Z][a-zA-Z0-9_]*\s*=\s*(?:async\s*)?)\(\s*([a-zA-Z0-9_]+)(?:\s*:[^{)]*)?\s*\)\s*(?:=>)?\s*\{)/m;
            if (singleParamRegex.test(updatedContent)) {
              updatedContent = updatedContent.replace(singleParamRegex, (_m, prefix, paramName) => {
                const helperDeclarations = missingProps
                  .map(p => `  const ${p} = (${paramName} as any)?.${p} || (() => {});`)
                  .join('\n');
                return `${prefix}\n${helperDeclarations}`;
              });
            }
          }
        }

        const interfaceRegex = new RegExp(`((?:interface|type)\\s+${compName}Props\\b[^{]*\\{)([\\s\\S]*?)(\\})`, 'm');
        if (interfaceRegex.test(updatedContent)) {
          updatedContent = updatedContent.replace(interfaceRegex, (_m, prefix, body, suffix) => {
            const additions = missingProps
              .filter(p => !new RegExp(`\\b${p}\\b`).test(body))
              .map(p => `  ${p}?: any;`)
              .join('\n');
            if (!additions) return `${prefix}${body}${suffix}`;
            return `${prefix}${body}\n${additions}\n${suffix}`;
          });
        }

        filesMap[filePath] = updatedContent;
      }
    }
  }

  /**
   * Sanitizes common LLM code-generation artifacts and syntax glitches in source files:
   * 1. Stray JSX fragment typos: `<|` or `< |` or `<|>` -> `<>` and `</|>` -> `</>`
   * 2. Stray markdown codeblocks inside file contents
   * 3. Fixes any parseDiagnostics caused by unescaped fragment tokens
   */
  public sanitizeSourceCode(content: string, filePath: string): string {
    let sanitized = content;

    // Remove stray markdown codeblock wrappers if present inside file content
    sanitized = sanitized.replace(/^```[a-zA-Z0-9_-]*\s*\n/m, '');
    sanitized = sanitized.replace(/\n```\s*$/m, '');

    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      // Fix LLM fragment tokenization glitches: `<|` or `< |` or `<|>` -> `<>`
      sanitized = sanitized.replace(/<\s*\|\s*>/g, '<>');
      sanitized = sanitized.replace(/<\s*\|\s*(?=[{\s<"'a-zA-Z])/g, '<>');
      sanitized = sanitized.replace(/<\s*\/\s*\|\s*>/g, '</>');
      if (sanitized.includes('<|')) {
        sanitized = sanitized.replace(/<\s*\|/g, '<>');
      }
    }

    return sanitized;
  }

  public async diagnoseFailure(input: DiagnosticInput): Promise<Diagnosis> {
    const client = this.ensureClient();
    const startTime = Date.now();
    const execId = `exec_diag_${Date.now()}`;

    const { evidence, relevantFiles, userRequirement } = input;
    const combinedOutput = `${evidence.stdout}\n${evidence.stderr}\n${evidence.stackTrace || ''}`.trim();

    const systemInstruction = `You are the diagnostic reasoning engine for SnapDeploy AI.
Analyze the provided execution evidence, error output, and source code.
Distinguish observed facts from inference. Do not invent stack traces or nonexistent files.

Return ONLY a structured JSON diagnosis matching the requested schema.`;

    const prompt = `User Requirement: ${userRequirement || 'Vite React Web Application'}
Execution Command: ${evidence.command} ${evidence.args.join(' ')}
Exit Code: ${evidence.exitCode}
Error Output / Stderr:
"""
${combinedOutput || 'Process exited with error code'}
"""

Source Code Files:
${Object.entries(relevantFiles).map(([path, code]) => `File: ${path}\n\`\`\`tsx\n${code}\n\`\`\``).join('\n\n')}`;

    try {
      const response = await this.executeWithRetry(() => client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: ['syntax', 'type', 'dependency', 'runtime', 'test', 'configuration']
              },
              severity: {
                type: 'string',
                enum: ['low', 'medium', 'high']
              },
              explanation: { type: 'string' },
              rootCause: { type: 'string' },
              affectedFiles: {
                type: 'array',
                items: { type: 'string' }
              },
              evidence: {
                type: 'array',
                items: { type: 'string' }
              },
              suggestedFix: { type: 'string' }
            },
            required: ['category', 'severity', 'explanation', 'affectedFiles', 'evidence', 'suggestedFix']
          }
        }
      }));

      const responseText = response.text || '';
      if (!responseText.trim()) {
        throw new Error('Gemini returned an empty diagnosis response');
      }

      const parsed = JSON.parse(responseText);

      const normalizedAffectedFiles = (parsed.affectedFiles && parsed.affectedFiles.length > 0 ? parsed.affectedFiles : Object.keys(relevantFiles))
        .map((p: string) => p.startsWith('/') ? p : '/' + p);

      const diagnosis: Diagnosis = {
        category: parsed.category || 'runtime',
        severity: parsed.severity || 'medium',
        explanation: parsed.explanation || 'An execution error occurred in the project.',
        affectedFiles: normalizedAffectedFiles,
        evidence: parsed.evidence && parsed.evidence.length > 0 ? parsed.evidence : [combinedOutput.slice(0, 300)],
        suggestedFix: parsed.suggestedFix || 'Review error logs and apply suggested fix.'
      };

      this.recordExecution({
        id: execId,
        operation: 'diagnose',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: true
      });

      return diagnosis;
    } catch (err: any) {
      this.recordExecution({
        id: execId,
        operation: 'diagnose',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: false,
        error: err?.message
      });
      throw err;
    }
  }

  public async generatePatch(input: RepairInput): Promise<Patch> {
    const client = this.ensureClient();
    const startTime = Date.now();
    const execId = `exec_patch_${Date.now()}`;

    const { diagnosis, evidence, relevantFiles, originalRequirement } = input;

    const systemInstruction = `You are the code repair engine for SnapDeploy AI.
Generate a targeted, minimal, safe code repair patch to resolve the diagnosed issue.

CONSTRAINTS:
1. Never modify files that are not necessary for the fix.
2. Do not rewrite the entire project unless absolutely required.
3. Preserve existing behavior and unrelated existing code.
4. Generate a targeted repair.
5. Return ONLY path and the complete repaired "after" content for each modified file.
6. Do NOT return "before" content (authoritative baseline content is paired automatically).
7. Return ONLY valid JSON matching the requested schema.`;

    const prompt = `Original Requirement: ${originalRequirement || 'Vite React Web Application'}
Diagnosis Category: ${diagnosis.category}
Diagnosis Explanation: ${diagnosis.explanation}
Suggested Fix: ${diagnosis.suggestedFix}
Affected Files: ${diagnosis.affectedFiles.join(', ')}

Current Source Files:
${Object.entries(relevantFiles).map(([path, code]) => `=== FILE: ${path} ===\n${code}\n=== END FILE ===`).join('\n\n')}`;

    try {
      const response = await this.executeWithRetry(() => client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              confidence: { type: 'number' },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    after: { type: 'string' }
                  },
                  required: ['path', 'after']
                }
              }
            },
            required: ['summary', 'files']
          }
        }
      }));

      const responseText = response.text || '';
      if (!responseText.trim()) {
        throw new Error('Gemini returned an empty patch response');
      }

      const parsed = JSON.parse(responseText);

      if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
        throw new Error('Gemini returned a patch with no file changes');
      }

      const patchFiles: PatchFileChange[] = parsed.files.map((f: any) => {
        if (!f || typeof f !== 'object') {
          throw new Error('Gemini returned an invalid patch file entry');
        }
        const rawPath = typeof f.path === 'string' ? f.path.trim() : '';
        if (!rawPath) {
          throw new Error('Gemini patch file entry is missing a valid path');
        }

        const normalizedPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;

        // Path safety & traversal check
        if (normalizedPath.includes('..')) {
          throw new Error(`Security validation failed: invalid patch path '${normalizedPath}'`);
        }

        // Authoritative "before" content MUST come from the exact relevantFiles map
        const beforeContent = relevantFiles[normalizedPath] !== undefined
          ? relevantFiles[normalizedPath]
          : relevantFiles[normalizedPath.replace(/^\/+/, '')];

        if (beforeContent === undefined) {
          throw new Error(`Gemini patch target '${normalizedPath}' does not exist in relevantFiles`);
        }

        if (typeof f.after !== 'string') {
          throw new Error(`Gemini patch file '${normalizedPath}' is missing valid 'after' content`);
        }

        return {
          path: normalizedPath,
          before: beforeContent,
          after: normalizedPath === '/index.html'
            ? this.normalizeIndexHtml(f.after)
            : this.sanitizeSourceCode(f.after, normalizedPath)
        };
      });

      const patch: Patch = {
        id: `patch_gemini_${Date.now()}`,
        summary: parsed.summary || `Fix for ${diagnosis.category} issue`,
        files: patchFiles,
        confidence: parsed.confidence || 0.95
      };

      this.recordExecution({
        id: execId,
        operation: 'repair',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: true
      });

      return patch;
    } catch (err: any) {
      this.recordExecution({
        id: execId,
        operation: 'repair',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: false,
        error: err?.message
      });
      throw err;
    }
  }

  public async editProject(input: EditInput): Promise<EditProposal> {
    const client = this.ensureClient();
    const startTime = Date.now();
    const execId = `exec_edit_${Date.now()}`;
    const { prompt, relevantFiles, activeFilePath, projectSummary, operationId } = input;

    const promptText = (prompt || '').trim();
    if (!promptText) {
      throw new Error('Edit prompt cannot be empty');
    }

    const systemInstruction = `You are the AI code modification engine for SnapDeploy AI.
Your task is to modify an EXISTING Vite + React 18 + TypeScript application based on the user's request.

CRITICAL CONSTRAINTS:
1. Return ONLY valid JSON matching the requested schema. Do not include markdown codeblocks or conversational text.
2. Make TARGETED, MINIMAL modifications. Only modify the specific files necessary to fulfill the request.
3. DO NOT rewrite the entire project. Maximum 5 files may be modified or created.
4. Supports ONLY "modify" or "create" actions. NEVER delete files.
5. Preserve existing working features, imports, styles, and file structure unless the user explicitly asks to change them.
6. All file paths must be exact project paths starting with "/" (e.g. "/src/components/Header.tsx").
7. Provide the 100% COMPLETE, non-placeholder source code for the "after" version of each modified or created file.
8. If editing an existing file, ensure it is fully compatible with the existing codebase and TypeScript types.
9. Never introduce external CDN scripts in HTML (e.g. cdn.tailwindcss.com).
10. Ensure all imported packages already exist in package.json.
11. ONLY modify files that are present in the provided Current Source Files list below. Prioritize modifying the Active Open File. For action 'modify', the path MUST match an existing file in Current Source Files.
12. If the user request requires creating or updating database tables, include an optional 'migration' object with title and safe operations ('create_table', 'add_column', 'create_index'). Destructive changes (DROP, DELETE) and raw SQL are forbidden.`;

    const projectContextStr = Object.entries(relevantFiles || {})
      .map(([filePath, code]) => `=== FILE: ${filePath} ===\n${code}\n=== END FILE ===`)
      .join('\n\n');

    const contents = `User Request: ${promptText}
Active Open File: ${activeFilePath || 'None'}
Project Manifest: ${projectSummary?.fileList?.join(', ') || Object.keys(relevantFiles || {}).join(', ')}

Current Source Files (Proposal Baseline):
${projectContextStr}`;

    try {
      const response = await this.executeWithRetry(() => client.models.generateContent({
        model: this.modelName,
        contents,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              explanation: { type: 'string' },
              confidence: { type: 'number' },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    action: { type: 'string', enum: ['modify', 'create'] },
                    after: { type: 'string' }
                  },
                  required: ['path', 'action', 'after']
                }
              },
              migration: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  operations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['create_table', 'add_column', 'create_index'] },
                        tableName: { type: 'string' },
                        columns: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              name: { type: 'string' },
                              type: { type: 'string' },
                              isPrimary: { type: 'boolean' },
                              isNullable: { type: 'boolean' }
                            },
                            required: ['name', 'type']
                          }
                        }
                      },
                      required: ['type', 'tableName']
                    }
                  }
                },
                required: ['title', 'operations']
              }
            },
            required: ['summary', 'explanation', 'files']
          }
        }
      }));

      const responseText = response.text || '';
      if (!responseText.trim()) {
        throw new Error('Gemini returned an empty edit response');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(responseText);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse Gemini structured JSON: ${parseErr?.message}`);
      }

      if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
        throw new Error('Gemini returned an edit proposal with no file changes');
      }

      if (parsed.files.length > 5) {
        throw new Error(`Edit proposal rejected: changed files count (${parsed.files.length}) exceeds maximum limit of 5`);
      }

      const seenPaths = new Set<string>();
      const patchFiles: PatchFileChange[] = [];

      for (const f of parsed.files) {
        if (!f || typeof f !== 'object') {
          throw new Error('Gemini returned an invalid edit file entry');
        }

        const action = f.action;
        if (action !== 'modify' && action !== 'create') {
          throw new Error(`Unsupported edit action '${action}'. Only 'modify' and 'create' are supported.`);
        }

        const rawPath = typeof f.path === 'string' ? f.path.trim() : '';
        if (!rawPath) {
          throw new Error('Edit file entry is missing a valid path');
        }

        const normalizedPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;

        if (
          normalizedPath.includes('..') ||
          normalizedPath.includes('\0') ||
          /^[a-zA-Z]:/.test(normalizedPath) ||
          normalizedPath.startsWith('//') ||
          normalizedPath.startsWith('\\\\') ||
          normalizedPath.startsWith('/etc') ||
          normalizedPath.startsWith('/root')
        ) {
          throw new Error(`Security validation failed: invalid file path '${normalizedPath}'`);
        }

        if (seenPaths.has(normalizedPath)) {
          throw new Error(`Duplicate file path in proposal: '${normalizedPath}'`);
        }
        seenPaths.add(normalizedPath);

        if (typeof f.after !== 'string') {
          throw new Error(`Edit file '${normalizedPath}' is missing valid 'after' content`);
        }

        let afterContent = normalizedPath === '/index.html'
          ? this.normalizeIndexHtml(f.after)
          : this.sanitizeSourceCode(f.after, normalizedPath);

        let targetPath = normalizedPath;
        let beforeContent = '';
        if (action === 'create') {
          if (relevantFiles[targetPath] !== undefined || relevantFiles[targetPath.replace(/^\/+/, '')] !== undefined) {
            throw new Error(`Cannot create new file: '${targetPath}' already exists in baseline context`);
          }
          beforeContent = '';
        } else {
          let existing = relevantFiles[targetPath] !== undefined
            ? relevantFiles[targetPath]
            : relevantFiles[targetPath.replace(/^\/+/, '')];

          if (existing === undefined) {
            const active = activeFilePath ? (activeFilePath.startsWith('/') ? activeFilePath : '/' + activeFilePath) : null;
            if (active && (relevantFiles[active] !== undefined || relevantFiles[active.replace(/^\/+/, '')] !== undefined)) {
              console.log(`[GeminiAIProvider] Remapping non-existent modify path '${targetPath}' to active file '${active}'`);
              targetPath = active;
              existing = relevantFiles[targetPath] !== undefined ? relevantFiles[targetPath] : relevantFiles[targetPath.replace(/^\/+/, '')];
            } else if (Object.keys(relevantFiles).length === 1) {
              const onlyKey = Object.keys(relevantFiles)[0];
              const normalizedOnly = onlyKey.startsWith('/') ? onlyKey : '/' + onlyKey;
              console.log(`[GeminiAIProvider] Remapping non-existent modify path '${targetPath}' to sole baseline file '${normalizedOnly}'`);
              targetPath = normalizedOnly;
              existing = relevantFiles[onlyKey];
            }
          }

          if (existing === undefined) {
            throw new Error(`Target file to modify '${normalizedPath}' does not exist in baseline context`);
          }
          beforeContent = existing;

          if (beforeContent === afterContent) {
            throw new Error(`Proposal rejected: file '${targetPath}' has unchanged content (before === after)`);
          }
        }

        patchFiles.push({
          path: targetPath,
          before: beforeContent,
          after: afterContent
        });
      }

      const encoder = new TextEncoder();
      const totalDiffBytes = patchFiles.reduce((acc, f) => {
        const beforeBytes = f.before ? encoder.encode(f.before).length : 0;
        const afterBytes = f.after ? encoder.encode(f.after).length : 0;
        return acc + beforeBytes + afterBytes;
      }, 0);

      if (totalDiffBytes > 100_000) {
        throw new Error(`Edit proposal rejected: total diff size (${totalDiffBytes} bytes) exceeds maximum limit of 100,000 bytes`);
      }

      let safeMigration: any = undefined;
      if (parsed.migration && typeof parsed.migration === 'object' && Array.isArray(parsed.migration.operations)) {
        const allowedOps = parsed.migration.operations.filter((op: any) =>
          op && (op.type === 'create_table' || op.type === 'add_column' || op.type === 'create_index')
        );
        if (allowedOps.length > 0) {
          safeMigration = {
            migrationId: `mig_${Date.now()}`,
            projectId: input.projectId || 'active-project',
            title: parsed.migration.title || 'Safe Database Migration',
            description: parsed.migration.description || 'Database migration operation',
            schemaVersion: 1,
            operations: allowedOps
          };
        }
      }

      const proposal: EditProposal = {
        id: `edit_gemini_${Date.now()}`,
        operationId,
        summary: parsed.summary || 'Project edit proposal',
        explanation: parsed.explanation || 'Proposed code changes',
        files: patchFiles,
        migration: safeMigration,
        confidence: parsed.confidence || 0.95
      };

      this.recordExecution({
        id: execId,
        projectId: input.projectId,
        operation: 'edit',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: true
      });

      return proposal;
    } catch (err: any) {
      this.recordExecution({
        id: execId,
        projectId: input.projectId,
        operation: 'edit',
        provider: this.name,
        model: this.modelName,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        success: false,
        error: err?.message
      });
      throw err;
    }
  }

  private recordExecution(record: AIExecutionRecord) {
    this.executionHistory.push(record);
    if (this.executionHistory.length > 50) {
      this.executionHistory.shift();
    }
  }
}

export const geminiAIProvider = new GeminiAIProvider();
