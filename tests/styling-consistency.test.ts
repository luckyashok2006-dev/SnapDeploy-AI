import { describe, it, expect } from 'vitest';
import { ruleBasedAIProvider } from '../server/providers/dev/RuleBasedAIProvider';
import { geminiAIProvider } from '../server/providers/GeminiAIProvider';
import { INITIAL_DEMO_PROJECTS } from '../src/demo/demoProjects';

describe('SnapDeploy AI — 9-Point Styling Consistency Contract', () => {
  describe('RuleBasedAIProvider (SaaS Dashboard & E-Commerce Archetypes)', () => {
    const archetypes = [
      { name: 'SaaS Dashboard', prompt: 'Build a FinTech SaaS Invoice Dashboard with live metrics and charts' },
      { name: 'E-Commerce Storefront', prompt: 'Build a modern e-commerce storefront with shopping cart and product catalog' }
    ];

    archetypes.forEach(({ name, prompt }) => {
      it(`guarantees all 9 styling consistency points for ${name}`, async () => {
        const { plan, files } = await ruleBasedAIProvider.generateProject({ prompt });

        // Point 1: package.json declares required styling packages in devDependencies
        expect(files['/package.json']).toBeDefined();
        const pkg = JSON.parse(files['/package.json']);
        expect(pkg.devDependencies).toBeDefined();
        expect(pkg.devDependencies.tailwindcss).toBeDefined();
        expect(pkg.devDependencies.postcss).toBeDefined();
        expect(pkg.devDependencies.autoprefixer).toBeDefined();
        expect(pkg.scripts.build).toContain('vite build');

        // Point 2: package-lock.json matches package.json with pre-resolved packages & integrity hashes
        expect(files['/package-lock.json']).toBeDefined();
        const lock = JSON.parse(files['/package-lock.json']);
        expect(lock.lockfileVersion).toBe(3);
        expect(lock.packages).toBeDefined();
        expect(lock.packages['node_modules/tailwindcss']).toBeDefined();
        expect(lock.packages['node_modules/tailwindcss'].integrity).toMatch(/^sha512-/);
        expect(lock.packages['node_modules/postcss']).toBeDefined();
        expect(lock.packages['node_modules/postcss'].integrity).toMatch(/^sha512-/);
        expect(lock.packages['node_modules/autoprefixer']).toBeDefined();
        expect(lock.packages['node_modules/autoprefixer'].integrity).toMatch(/^sha512-/);

        // Point 3: Required config files exist (tailwind.config.js, postcss.config.js)
        expect(files['/tailwind.config.js']).toBeDefined();
        expect(files['/tailwind.config.js']).toContain('content:');
        expect(files['/tailwind.config.js']).toContain('./src/**/*.{js,ts,jsx,tsx}');
        expect(files['/postcss.config.js']).toBeDefined();
        expect(files['/postcss.config.js']).toContain('tailwindcss:');
        expect(files['/postcss.config.js']).toContain('autoprefixer:');

        // Point 4: Required CSS entry file exists (src/index.css with @tailwind directives)
        expect(files['/src/index.css']).toBeDefined();
        expect(files['/src/index.css']).toContain('@tailwind base;');
        expect(files['/src/index.css']).toContain('@tailwind components;');
        expect(files['/src/index.css']).toContain('@tailwind utilities;');

        // Point 5: src/main.tsx imports the CSS entry
        expect(files['/src/main.tsx']).toBeDefined();
        expect(files['/src/main.tsx']).toContain("import './index.css';");

        // Point 6: index.html does NOT depend on external CDN
        expect(files['/index.html']).toBeDefined();
        expect(files['/index.html']).not.toContain('cdn.tailwindcss.com');
        expect(files['/index.html']).toContain('<div id="root"></div>');
        expect(files['/index.html']).toContain('/src/main.tsx');

        // Point 7: Project plan scripts specify valid build command
        expect(plan.scripts.build).toContain('vite build');
        const planFilePaths = plan.files.map(f => f.path);
        expect(planFilePaths).toContain('/postcss.config.js');
        expect(planFilePaths).toContain('/tailwind.config.js');
        expect(planFilePaths).toContain('/src/index.css');
        expect(planFilePaths).toContain('/package-lock.json');
        expect(planFilePaths).toContain('/README.md');

        // Point 8: Cross-origin isolation friendly (no external network script loads in host HTML)
        expect(files['/index.html']).not.toMatch(/<script[^>]+src=["']https?:\/\//i);

        // Point 9: README.md correctly describes the actual styling stack
        expect(files['/README.md']).toBeDefined();
        expect(files['/README.md']).toContain('Tailwind CSS');
        expect(files['/README.md']).toContain('PostCSS');
        expect(files['/README.md']).toContain('Autoprefixer');
      });
    });
  });

  describe('GeminiAIProvider Normalization, Lockfile Binding & Final Validation Gate', () => {
    it('normalizePackageJson() injects tailwindcss, postcss, and autoprefixer into devDependencies', () => {
      const normalized = geminiAIProvider.normalizePackageJson(
        JSON.stringify({
          name: 'gemini-test-app',
          dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }
        })
      );
      const pkg = JSON.parse(normalized);
      expect(pkg.devDependencies.tailwindcss).toBe('^3.4.17');
      expect(pkg.devDependencies.postcss).toBe('^8.5.2');
      expect(pkg.devDependencies.autoprefixer).toBe('^10.4.20');
      expect(pkg.devDependencies['@vitejs/plugin-react']).toBe('^4.3.0');
    });

    it('normalizePackageJson() relocates styling packages from dependencies to devDependencies', () => {
      const normalized = geminiAIProvider.normalizePackageJson(
        JSON.stringify({
          name: 'gemini-test-app',
          dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
            tailwindcss: '^3.4.17',
            postcss: '^8.5.2',
            autoprefixer: '^10.4.20'
          }
        })
      );
      const pkg = JSON.parse(normalized);
      expect(pkg.dependencies.tailwindcss).toBeUndefined();
      expect(pkg.dependencies.postcss).toBeUndefined();
      expect(pkg.dependencies.autoprefixer).toBeUndefined();
      expect(pkg.devDependencies.tailwindcss).toBe('^3.4.17');
      expect(pkg.devDependencies.postcss).toBe('^8.5.2');
      expect(pkg.devDependencies.autoprefixer).toBe('^10.4.20');
    });

    it('isCanonicalBaselineCompatible() verifies all required packages including Tailwind styling', () => {
      const compatiblePkg = {
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
      expect(geminiAIProvider.isCanonicalBaselineCompatible(compatiblePkg)).toBe(true);

      // Incompatible if tailwindcss is missing
      const missingTailwind = JSON.parse(JSON.stringify(compatiblePkg));
      delete missingTailwind.devDependencies.tailwindcss;
      expect(geminiAIProvider.isCanonicalBaselineCompatible(missingTailwind)).toBe(false);

      // Incompatible if postcss is missing
      const missingPostcss = JSON.parse(JSON.stringify(compatiblePkg));
      delete missingPostcss.devDependencies.postcss;
      expect(geminiAIProvider.isCanonicalBaselineCompatible(missingPostcss)).toBe(false);
    });

    it('validateFinalGeneratedProject() enforces all styling invariants', () => {
      const validProject: Record<string, string> = {
        '/package.json': JSON.stringify({
          name: 'valid-app',
          scripts: { dev: 'vite', build: 'npx tsc --noEmit && npx vite build' },
          dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
          devDependencies: {
            tailwindcss: '^3.4.17',
            postcss: '^8.5.2',
            autoprefixer: '^10.4.20'
          }
        }),
        '/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020' } }),
        '/vite.config.ts': 'export default {};',
        '/postcss.config.js': 'export default { plugins: {} };',
        '/tailwind.config.js': 'export default { content: [] };',
        '/src/index.css': '@tailwind base;\\n@tailwind components;\\n@tailwind utilities;',
        '/index.html': '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
        '/src/main.tsx': "import './index.css';\nexport default {};",
        '/src/App.tsx': 'export default function App() { return <div>Hello</div>; }',
        '/README.md': '# App\nStyled with Tailwind CSS.'
      };

      // Valid project passes with zero throws
      expect(() => geminiAIProvider.validateFinalGeneratedProject(validProject)).not.toThrow();

      // Fails if cdn.tailwindcss.com is present in index.html
      const withCdn = { ...validProject, '/index.html': '<script src="https://cdn.tailwindcss.com"></script>' };
      expect(() => geminiAIProvider.validateFinalGeneratedProject(withCdn)).toThrow(/cdn\.tailwindcss\.com/);

      // Fails if main.tsx lacks index.css import
      const noCssImport = { ...validProject, '/src/main.tsx': 'export default {};' };
      expect(() => geminiAIProvider.validateFinalGeneratedProject(noCssImport)).toThrow(/import '\.\/index\.css'/);

      // Fails if src/index.css lacks @tailwind directives
      const emptyCss = { ...validProject, '/src/index.css': 'body { margin: 0; }' };
      expect(() => geminiAIProvider.validateFinalGeneratedProject(emptyCss)).toThrow(/@tailwind/);

      // Fails if README.md lacks Tailwind documentation
      const unstyledReadme = { ...validProject, '/README.md': '# App\nPlain documentation.' };
      expect(() => geminiAIProvider.validateFinalGeneratedProject(unstyledReadme)).toThrow(/document Tailwind CSS/);

      // Fails if tailwind.config.js is missing
      const noTailwindConfig = { ...validProject };
      delete noTailwindConfig['/tailwind.config.js'];
      expect(() => geminiAIProvider.validateFinalGeneratedProject(noTailwindConfig)).toThrow(/'\/tailwind\.config\.js' is missing/);

      // Fails if postcss.config.js is missing
      const noPostcssConfig = { ...validProject };
      delete noPostcssConfig['/postcss.config.js'];
      expect(() => geminiAIProvider.validateFinalGeneratedProject(noPostcssConfig)).toThrow(/'\/postcss\.config\.js' is missing/);
    });

    it('normalizeIndexHtml() sanitizes malformed URIs, strips CDN scripts, and ensures root mount', () => {
      // Test HTML with double percent signs (e.g. SVG viewBox) and %PUBLIC_URL%
      const rawHtml = `<!DOCTYPE html>
<html>
  <head>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%%22><text y=%22.9em%22 font-size=%2290%22>📊</text></svg>" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body></body>
</html>`;

      const normalized = geminiAIProvider.normalizeIndexHtml(rawHtml, 'Test App');
      expect(normalized).not.toContain('cdn.tailwindcss.com');
      expect(normalized).toContain('<div id="root"></div>');
      expect(normalized).toContain('<script type="module" src="/src/main.tsx"></script>');
      expect(normalized).not.toContain('100%%22');
      expect(normalized).not.toContain('%PUBLIC_URL%');

      // Verify all href and src attributes pass decodeURI without throwing
      const uriMatches = normalized.matchAll(/<(?:link|script|img)\b[^>]*\b(?:href|src)=["']([^"']*)["'][^>]*>/gi);
      for (const match of uriMatches) {
        expect(() => decodeURI(match[1])).not.toThrow();
      }
    });
  });

  describe('Demo Projects (INITIAL_DEMO_PROJECTS) Styling Contract', () => {
    it('saas-dashboard conforms to all 9 points of the styling consistency contract', () => {
      const demo = INITIAL_DEMO_PROJECTS['saas-dashboard'];
      expect(demo).toBeDefined();

      const files = demo.files;

      // 1. package.json devDependencies
      const pkg = JSON.parse(files['/package.json'].content);
      expect(pkg.devDependencies.tailwindcss).toBeDefined();
      expect(pkg.devDependencies.postcss).toBeDefined();
      expect(pkg.devDependencies.autoprefixer).toBeDefined();

      // 2. package-lock.json canonical packages
      const lock = JSON.parse(files['/package-lock.json'].content);
      expect(lock.lockfileVersion).toBe(3);
      expect(lock.packages['node_modules/tailwindcss']).toBeDefined();
      expect(lock.packages['node_modules/postcss']).toBeDefined();
      expect(lock.packages['node_modules/autoprefixer']).toBeDefined();

      // 3. Configs
      expect(files['/tailwind.config.js']).toBeDefined();
      expect(files['/postcss.config.js']).toBeDefined();

      // 4. CSS entry
      expect(files['/src/index.css']).toBeDefined();
      expect(files['/src/index.css'].content).toContain('@tailwind');

      // 5. Main.tsx import
      expect(files['/src/main.tsx']).toBeDefined();
      expect(files['/src/main.tsx'].content).toContain("import './index.css';");

      // 6. Index.html clean
      expect(files['/index.html']).toBeDefined();
      expect(files['/index.html'].content).not.toContain('cdn.tailwindcss.com');

      // 9. README.md
      expect(files['/README.md']).toBeDefined();
      expect(files['/README.md'].content).toContain('Tailwind CSS');
    });
  });
});
