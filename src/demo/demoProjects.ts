import canonicalPackageLock from './canonical-package-lock.json';
import { ProjectWorkspace } from '../types/workspace';

export const INITIAL_DEMO_PROJECTS: Record<string, ProjectWorkspace> = {
  'saas-dashboard': {
    id: 'saas-dashboard',
    title: 'FinTech SaaS Invoice Dashboard',
    description: 'Real-time billing, metrics, and customer invoices built with React and Tailwind CSS.',
    badge: 'Vite + React 19',
    status: 'ready',
    openTabs: ['/src/App.tsx', '/src/components/InvoiceList.tsx', '/package.json'],
    activeFilePath: '/src/App.tsx',
    diagnostics: [],
    fixHistory: [],
    files: {
      '/package.json': {
        id: 'saas-dashboard:/package.json',
        projectId: 'saas-dashboard',
        path: '/package.json',
        language: 'json',
        hash: 'h_pkg',
        updatedAt: new Date().toISOString(),
        content: JSON.stringify(
          {
            name: 'saas-invoice-dashboard',
            private: true,
            version: '1.0.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'npx tsc --noEmit && npx vite build',
              preview: 'vite preview'
            },
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
              autoprefixer: '^10.4.20',
              postcss: '^8.5.2',
              tailwindcss: '^3.4.17',
              typescript: '^5.4.5',
              vite: '^5.2.11'
            }
          },
          null,
          2
        )
      },
      '/package-lock.json': {
        id: 'saas-dashboard:/package-lock.json',
        projectId: 'saas-dashboard',
        path: '/package-lock.json',
        language: 'json',
        hash: 'h_pkg_lock',
        updatedAt: new Date().toISOString(),
        content: JSON.stringify(canonicalPackageLock, null, 2)
      },
      '/tsconfig.json': {
        id: 'saas-dashboard:/tsconfig.json',
        projectId: 'saas-dashboard',
        path: '/tsconfig.json',
        language: 'json',
        hash: 'h_tsconfig',
        updatedAt: new Date().toISOString(),
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2020',
              useDefineForClassFields: true,
              lib: ['ES2020', 'DOM', 'DOM.Iterable'],
              module: 'ESNext',
              skipLibCheck: true,
              moduleResolution: 'bundler',
              allowImportingTsExtensions: true,
              resolveJsonModule: true,
              isolatedModules: true,
              noEmit: true,
              jsx: 'react-jsx',
              strict: true,
              noUnusedLocals: true,
              noUnusedParameters: true,
              noFallthroughCasesInSwitch: true
            },
            include: ['src']
          },
          null,
          2
        )
      },
      '/vite.config.ts': {
        id: 'saas-dashboard:/vite.config.ts',
        projectId: 'saas-dashboard',
        path: '/vite.config.ts',
        language: 'typescript',
        hash: 'h_vite',
        updatedAt: new Date().toISOString(),
        content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  }
});
`
      },
      '/postcss.config.js': {
        id: 'saas-dashboard:/postcss.config.js',
        projectId: 'saas-dashboard',
        path: '/postcss.config.js',
        language: 'javascript',
        hash: 'h_postcss',
        updatedAt: new Date().toISOString(),
        content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`
      },
      '/tailwind.config.js': {
        id: 'saas-dashboard:/tailwind.config.js',
        projectId: 'saas-dashboard',
        path: '/tailwind.config.js',
        language: 'javascript',
        hash: 'h_tailwind',
        updatedAt: new Date().toISOString(),
        content: `/** @type {import('tailwindcss').Config} */
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
`
      },
      '/src/index.css': {
        id: 'saas-dashboard:/src/index.css',
        projectId: 'saas-dashboard',
        path: '/src/index.css',
        language: 'css',
        hash: 'h_css',
        updatedAt: new Date().toISOString(),
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`
      },
      '/README.md': {
        id: 'saas-dashboard:/README.md',
        projectId: 'saas-dashboard',
        path: '/README.md',
        language: 'markdown',
        hash: 'h_readme',
        updatedAt: new Date().toISOString(),
        content: `# FinTech SaaS Invoice Dashboard

Real-time billing, metrics, and customer invoices built with React and Tailwind CSS.

## Tech Stack
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite 5
- **Styling:** Tailwind CSS (v3.4.17), PostCSS, and Autoprefixer (locally compiled, zero external CDNs)
- **Icons:** Lucide React

## Development
\`\`\`bash
npm install
npm run dev
\`\`\`

## Production Build
\`\`\`bash
npm run build
\`\`\`
`
      },
      '/index.html': {
        id: 'saas-dashboard:/index.html',
        projectId: 'saas-dashboard',
        path: '/index.html',
        language: 'html',
        hash: 'h_html',
        updatedAt: new Date().toISOString(),
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SaaS Invoice Dashboard</title>
  </head>
  <body class="bg-slate-950 text-slate-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
      },
      '/src/main.tsx': {
        id: 'saas-dashboard:/src/main.tsx',
        projectId: 'saas-dashboard',
        path: '/src/main.tsx',
        language: 'typescript',
        hash: 'h_main',
        updatedAt: new Date().toISOString(),
        content: `import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`
      },
      '/src/App.tsx': {
        id: 'saas-dashboard:/src/App.tsx',
        projectId: 'saas-dashboard',
        path: '/src/App.tsx',
        language: 'typescript',
        hash: 'h_app',
        updatedAt: new Date().toISOString(),
        content: `import { useState } from 'react';
import { InvoiceList } from './components/InvoiceList';

export default function App() {
  const [revenue] = useState(128450);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">ApexPay Metrics & Billing</h1>
            <p className="text-xs text-slate-400">Real-time revenue telemetry and billing automation</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl text-right">
            <span className="text-[10px] text-slate-400 block uppercase">Monthly Run Rate</span>
            <span className="text-xl font-bold text-emerald-400 font-mono">\${revenue.toLocaleString()}</span>
          </div>
        </header>

        <InvoiceList />
      </div>
    </div>
  );
}
`
      },
      '/src/components/InvoiceList.tsx': {
        id: 'saas-dashboard:/src/components/InvoiceList.tsx',
        projectId: 'saas-dashboard',
        path: '/src/components/InvoiceList.tsx',
        language: 'typescript',
        hash: 'h_inv',
        updatedAt: new Date().toISOString(),
        content: `import type { FC } from 'react';

interface Invoice {
  id: string;
  client: string;
  amount: number;
  status: 'PAID' | 'PENDING';
  date: string;
}

const INVOICES: Invoice[] = [
  { id: 'INV-101', client: 'Acme Corp', amount: 4200, status: 'PAID', date: '2026-08-20' },
  { id: 'INV-102', client: 'Linear Labs', amount: 1850, status: 'PENDING', date: '2026-08-22' },
  { id: 'INV-103', client: 'Vercel Edge', amount: 12400, status: 'PAID', date: '2026-08-24' }
];

export const InvoiceList: FC = () => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">Recent Client Invoices</h2>
        <span className="text-xs font-mono text-slate-400">{INVOICES.length} Total</span>
      </div>

      <div className="divide-y divide-slate-800">
        {INVOICES.map((inv) => (
          <div key={inv.id} className="py-3 flex justify-between items-center text-xs">
            <div>
              <span className="font-semibold text-slate-200 block">{inv.client}</span>
              <span className="text-[10px] text-slate-500 font-mono">{inv.id} &bull; {inv.date}</span>
            </div>
            <div className="text-right">
              <span className="font-mono font-bold text-white block">\${inv.amount.toLocaleString()}</span>
              <span className={\`text-[9px] font-mono px-2 py-0.5 rounded \${
                inv.status === 'PAID' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
              }\`}>
                {inv.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
`
      }
    }
  }
};
