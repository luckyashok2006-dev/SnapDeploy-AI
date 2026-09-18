import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAIProvider } from '../server/providers/GeminiAIProvider';

describe('Generated Project Consistency & Validation', () => {
  let provider: GeminiAIProvider;

  beforeEach(() => {
    provider = new GeminiAIProvider();
  });

  it('1. validateFinalGeneratedProject passes for a complete, consistent project', () => {
    const validFiles: Record<string, string> = {
      '/package.json': JSON.stringify({
        name: 'test-app',
        scripts: {
          dev: 'vite',
          build: 'npx tsc --noEmit && npx vite build'
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
          'lucide-react': '^0.344.0'
        },
        devDependencies: {
          typescript: '^5.4.5',
          vite: '^5.2.11',
          tailwindcss: '^3.4.17',
          postcss: '^8.5.2',
          autoprefixer: '^10.4.20'
        }
      }),
      '/tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          jsx: 'react-jsx'
        }
      }),
      '/vite.config.ts': 'export default {}',
      '/postcss.config.js': 'export default { plugins: {} };',
      '/tailwind.config.js': 'export default { content: [] };',
      '/src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
      '/index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
      '/src/main.tsx': "import './index.css';\nimport React from 'react';",
      '/src/App.tsx': 'export default function App() { return <div>App</div>; }',
      '/README.md': '# App\nStyled with Tailwind CSS.'
    };

    expect(() => {
      provider.validateFinalGeneratedProject(validFiles);
    }).not.toThrow();
  });

  it('2. rejects project with missing build script', () => {
    const invalidFiles: Record<string, string> = {
      '/package.json': JSON.stringify({
        name: 'test-app',
        scripts: {
          dev: 'vite'
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1'
        }
      }),
      '/tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      '/vite.config.ts': 'export default {}',
      '/index.html': '<html></html>',
      '/src/main.tsx': 'console.log()',
      '/src/App.tsx': 'export default () => null'
    };

    expect(() => {
      provider.validateFinalGeneratedProject(invalidFiles);
    }).toThrow(/package.json missing non-empty 'build' script/);
  });

  it('3. rejects project with missing required React dependencies', () => {
    const invalidFiles: Record<string, string> = {
      '/package.json': JSON.stringify({
        name: 'test-app',
        scripts: {
          dev: 'vite',
          build: 'npm run build'
        },
        dependencies: {}
      }),
      '/tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      '/vite.config.ts': 'export default {}',
      '/index.html': '<html></html>',
      '/src/main.tsx': 'console.log()',
      '/src/App.tsx': 'export default () => null'
    };

    expect(() => {
      provider.validateFinalGeneratedProject(invalidFiles);
    }).toThrow(/missing required React dependencies/);
  });

  it('4. rejects project containing hardcoded secret API key', () => {
    const invalidFiles: Record<string, string> = {
      '/package.json': JSON.stringify({
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }
      }),
      '/tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      '/vite.config.ts': 'export default {}',
      '/index.html': '<html></html>',
      '/src/main.tsx': 'console.log()',
      '/src/App.tsx': 'const apiKey = "AIzaSyB1234567890123456789012345678901";'
    };

    expect(() => {
      provider.validateFinalGeneratedProject(invalidFiles);
    }).toThrow(/potential secret or API key detected/);
  });

  it('5. rejects project with path traversal outside project root', () => {
    const invalidFiles: Record<string, string> = {
      '/package.json': JSON.stringify({
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }
      }),
      '/tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      '/vite.config.ts': 'export default {}',
      '/index.html': '<html></html>',
      '/src/main.tsx': 'console.log()',
      '/src/App.tsx': 'export default () => null',
      '/src/../etc/passwd': 'root:x:0:0'
    };

    expect(() => {
      provider.validateFinalGeneratedProject(invalidFiles);
    }).toThrow(/invalid file path/);
  });

  it('6. normalizePackageJson maintains required tailwindcss, postcss, and autoprefixer in devDependencies', () => {
    const rawPkg = JSON.stringify({
      name: 'web-app',
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'lucide-react': '^0.344.0',
        clsx: '^2.1.0'
      },
      devDependencies: {
        '@types/react': '^18.3.5',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.3.1',
        typescript: '^5.5.3',
        vite: '^5.4.2',
        autoprefixer: '^10.4.20',
        postcss: '^8.4.47',
        tailwindcss: '^3.4.1'
      }
    });

    const normalizedStr = provider.normalizePackageJson(rawPkg, 'web-app');
    const parsed = JSON.parse(normalizedStr);

    expect(parsed.devDependencies.tailwindcss).toBe('^3.4.1');
    expect(parsed.devDependencies.postcss).toBe('^8.4.47');
    expect(parsed.devDependencies.autoprefixer).toBe('^10.4.20');
    expect(parsed.dependencies.tailwindcss).toBeUndefined();
    expect(parsed.devDependencies.typescript).toBe('^5.5.3');
    expect(parsed.devDependencies.vite).toBe('^5.4.2');
    expect(parsed.dependencies.react).toBe('^18.3.1');
  });

  it('7. canonical baseline receives a valid lockfile', () => {
    const canonicalPkg = {
      name: 'web-app',
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'lucide-react': '^0.344.0',
        clsx: '^2.1.0'
      },
      devDependencies: {
        '@types/react': '^18.3.3',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.3.0',
        typescript: '^5.4.5',
        vite: '^5.2.11',
        tailwindcss: '^3.4.17',
        postcss: '^8.5.2',
        autoprefixer: '^10.4.20'
      }
    };

    expect(provider.isCanonicalBaselineCompatible(canonicalPkg)).toBe(true);

    const lockRaw = provider.getCanonicalPackageLock();
    expect(lockRaw).toBeDefined();
    const lockObj = JSON.parse(lockRaw);
    expect(lockObj.lockfileVersion).toBe(3);
    expect(Object.keys(lockObj.packages).length).toBeGreaterThan(50);
  });

  it('8. lockfile is not added incorrectly to a materially different custom manifest', () => {
    // Incompatible React 19
    const react19Pkg = {
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', 'lucide-react': '^0.344.0', clsx: '^2.1.0' },
      devDependencies: { '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', '@vitejs/plugin-react': '^4.3.0', typescript: '^5.4.5', vite: '^5.2.11' }
    };
    expect(provider.isCanonicalBaselineCompatible(react19Pkg)).toBe(false);

    // Missing core dependency
    const missingReactPkg = {
      dependencies: { 'lucide-react': '^0.344.0', clsx: '^2.1.0' },
      devDependencies: { typescript: '^5.4.5', vite: '^5.2.11' }
    };
    expect(provider.isCanonicalBaselineCompatible(missingReactPkg)).toBe(false);

    // Non-Vite framework (e.g. Next.js / Vue)
    const customPkg = {
      dependencies: { vue: '^3.4.0' },
      devDependencies: { vite: '^6.0.0' }
    };
    expect(provider.isCanonicalBaselineCompatible(customPkg)).toBe(false);
  });

  it('9. demo project includes the canonical lockfile', async () => {
    const { INITIAL_DEMO_PROJECTS } = await import('../src/demo/demoProjects');
    const saas = INITIAL_DEMO_PROJECTS['saas-dashboard'];
    expect(saas).toBeDefined();
    expect(saas.files['/package-lock.json']).toBeDefined();
    expect(saas.files['/package-lock.json'].language).toBe('json');

    const lockData = JSON.parse(saas.files['/package-lock.json'].content);
    expect(lockData.lockfileVersion).toBe(3);
    expect(Object.keys(lockData.packages).length).toBeGreaterThan(50);
    expect(lockData.packages[''].dependencies['react']).toBe('^18.3.1');
  });

  it('10. existing package.json remains unchanged apart from approved normalization', () => {
    const customAppPkg = JSON.stringify({
      name: 'custom-app',
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'lucide-react': '^0.344.0',
        clsx: '^2.1.0',
        recharts: '^2.12.7'
      },
      devDependencies: {
        '@types/react': '^18.3.3',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.3.0',
        typescript: '^5.4.5',
        vite: '^5.2.11'
      }
    });

    const normalized = JSON.parse(provider.normalizePackageJson(customAppPkg, 'custom-app'));
    expect(normalized.dependencies.recharts).toBe('^2.12.7');
    expect(normalized.dependencies.react).toBe('^18.3.1');
    expect(normalized.devDependencies.typescript).toBe('^5.4.5');
  });
});
