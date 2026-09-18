import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AIProvider,
  GeneratedProjectPayload
} from '../AIProvider';
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
} from '../../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CANONICAL_LOCK_PATH = path.resolve(__dirname, '../../templates/canonical-package-lock.json');
let cachedCanonicalLock: string | null = null;

/**
 * DEVELOPMENT & OFFLINE TEST ONLY PROVIDER
 * Clearly labeled: RULE_BASED_DEMO
 * Not used in production when live AI provider is configured.
 */
export class RuleBasedAIProvider implements AIProvider {
  public name = 'RULE_BASED_DEMO';

  public async generateProject(input: GenerationInput): Promise<GeneratedProjectPayload> {
    const prompt = input.prompt.trim();
    const slug = (input.name || prompt.slice(0, 30))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'snapdeploy-app';

    const plan: ProjectPlan = {
      name: slug,
      framework: 'vite-react',
      files: [
        { path: '/package.json', purpose: 'NPM package dependencies and scripts' },
        { path: '/package-lock.json', purpose: 'Pre-resolved deterministic dependency lockfile' },
        { path: '/tsconfig.json', purpose: 'TypeScript compiler options and path resolution' },
        { path: '/vite.config.ts', purpose: 'Vite build and dev server config' },
        { path: '/postcss.config.js', purpose: 'PostCSS configuration for Tailwind CSS' },
        { path: '/tailwind.config.js', purpose: 'Tailwind CSS utility styling configuration' },
        { path: '/index.html', purpose: 'Clean HTML shell with local Tailwind CSS' },
        { path: '/src/index.css', purpose: 'Global stylesheet with Tailwind CSS directives' },
        { path: '/src/main.tsx', purpose: 'React root application mount' },
        { path: '/src/App.tsx', purpose: 'Main interactive application layout and state' },
        { path: '/src/components/Dashboard.tsx', purpose: 'Metrics and data visualization cards' },
        { path: '/src/components/DataTable.tsx', purpose: 'Interactive records table with filters' },
        { path: '/README.md', purpose: 'Project documentation and styling stack guide' }
      ],
      dependencies: [
        { name: 'react', version: '^18.3.1' },
        { name: 'react-dom', version: '^18.3.1' },
        { name: 'lucide-react', version: '^0.344.0' },
        { name: 'clsx', version: '^2.1.0' }
      ],
      scripts: {
        dev: 'vite',
        build: 'tsc --noEmit && vite build',
        test: 'vitest run'
      }
    };

    const isInvoiceOrBilling = prompt.toLowerCase().includes('invoice') || prompt.toLowerCase().includes('saas') || prompt.toLowerCase().includes('metric') || prompt.toLowerCase().includes('billing');

    const appTitle = isInvoiceOrBilling ? 'ApexPay SaaS Metrics & Invoicing' : 'SnapDeploy App Studio';
    const subTitle = isInvoiceOrBilling ? 'Real-time billing telemetry, revenue run-rate, and customer invoices' : 'Modern responsive application built with React and Tailwind CSS';

    const files: Record<string, string> = {
      '/package.json': JSON.stringify(
        {
          name: slug,
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'tsc --noEmit && vite build',
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
      ),
      '/package-lock.json': this.getCanonicalPackageLock(),
      '/tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            useDefineForClassFields: true,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            skipLibCheck: true,
            moduleResolution: 'bundler',
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: 'react-jsx',
            strict: true,
            noUnusedLocals: false,
            noUnusedParameters: false,
            noFallthroughCasesInSwitch: true
          },
          include: ['src']
        },
        null,
        2
      ),
      '/vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  }
});
`,
      '/postcss.config.js': `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
      '/tailwind.config.js': `/** @type {import('tailwindcss').Config} */
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
`,
      '/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appTitle}</title>
  </head>
  <body class="bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      '/src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      '/src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
      '/README.md': `# ${appTitle}

A modern responsive web application generated by **SnapDeploy AI**.

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
`,
      '/src/App.tsx': `import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { DataTable } from './components/DataTable';

export default function App() {
  const [filter, setFilter] = useState('all');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-600/30">
            ⚡
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">${appTitle}</h1>
            <p className="text-[11px] text-slate-400">${subTitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/30 font-medium">
            ● Live Runtime
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        <Dashboard />
        <DataTable filter={filter} onFilterChange={setFilter} />
      </main>
    </div>
  );
}
`,
      '/src/components/Dashboard.tsx': `import React from 'react';

export const Dashboard: React.FC = () => {
  const metrics = [
    { label: 'Monthly Recurring Revenue', value: '$128,450', change: '+14.2%', positive: true },
    { label: 'Active Subscriptions', value: '1,420', change: '+8.4%', positive: true },
    { label: 'Avg Revenue Per Account', value: '$90.45', change: '+3.1%', positive: true },
    { label: 'Churn Rate', value: '1.24%', change: '-0.4%', positive: true }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((m, idx) => (
        <div key={idx} className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition">
          <span className="text-xs text-slate-400 font-medium">{m.label}</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-xl font-bold font-mono text-white">{m.value}</span>
            <span className="text-xs font-semibold text-emerald-400">{m.change}</span>
          </div>
        </div>
      ))}
    </div>
  );
};
`,
      '/src/components/DataTable.tsx': `import React, { useState } from 'react';

interface RecordItem {
  id: string;
  title: string;
  category: string;
  amount: number;
  status: 'PAID' | 'PENDING' | 'OVERDUE';
  date: string;
}

const INITIAL_RECORDS: RecordItem[] = [
  { id: 'REC-001', title: 'Acme Enterprise License', category: 'Enterprise', amount: 4800, status: 'PAID', date: '2026-08-25' },
  { id: 'REC-002', title: 'Linear Team Subscription', category: 'Team', amount: 1850, status: 'PENDING', date: '2026-08-24' },
  { id: 'REC-003', title: 'Vercel Edge Gateway', category: 'Infrastructure', amount: 12400, status: 'PAID', date: '2026-08-22' },
  { id: 'REC-004', title: 'Stripe Global Connector', category: 'Payment API', amount: 3200, status: 'OVERDUE', date: '2026-08-18' }
];

interface DataTableProps {
  filter: string;
  onFilterChange: (f: string) => void;
}

export const DataTable: React.FC<DataTableProps> = ({ filter, onFilterChange }) => {
  const [search, setSearch] = useState('');

  const filtered = INITIAL_RECORDS.filter(r => {
    const matchesSearch = r.title.toLowerCase().includes(search.toLowerCase()) || r.id.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || r.status.toLowerCase() === filter.toLowerCase();
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Active Records</h2>
          <p className="text-xs text-slate-400">Total {filtered.length} entries matching criteria</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search records..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />

          <select
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
              <th className="py-2.5 px-3">ID</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3">Category</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3 text-right">Status</th>
              <th className="py-2.5 px-3 text-right">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {filtered.map((item) => (
              <tr key={item.id} className="hover:bg-slate-800/30 transition">
                <td className="py-3 px-3 font-mono text-slate-400">{item.id}</td>
                <td className="py-3 px-3 font-medium text-white">{item.title}</td>
                <td className="py-3 px-3 text-slate-400">{item.category}</td>
                <td className="py-3 px-3 text-right font-mono font-bold text-white">\${item.amount.toLocaleString()}</td>
                <td className="py-3 px-3 text-right">
                  <span className={\`text-[10px] font-mono px-2 py-0.5 rounded font-semibold \${
                    item.status === 'PAID'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : item.status === 'PENDING'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }\`}>
                    {item.status}
                  </span>
                </td>
                <td className="py-3 px-3 text-right text-slate-400 font-mono text-[11px]">{item.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
`
    };

    return { plan, files };
  }

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

  public async diagnoseFailure(input: DiagnosticInput): Promise<Diagnosis> {
    const { evidence, relevantFiles } = input;
    const combinedOutput = `${evidence.stdout}\n${evidence.stderr}\n${evidence.stackTrace || ''}`;

    // 1. Check for Missing Import / ReferenceError
    const refMatch = combinedOutput.match(/ReferenceError:\s*(\w+)\s*is not defined/i) ||
      combinedOutput.match(/Cannot find name\s*'(\w+)'/i) ||
      combinedOutput.match(/is not defined/i);

    if (refMatch) {
      const symbol = refMatch[1] || 'symbol';
      const file = Object.keys(relevantFiles).find(f => (relevantFiles[f] || '').includes(symbol)) || Object.keys(relevantFiles)[0] || '/src/App.tsx';
      return {
        category: 'syntax',
        severity: 'high',
        explanation: `Undefined reference '${symbol}' encountered during runtime execution in ${file}.`,
        affectedFiles: [file],
        evidence: [combinedOutput.trim().slice(0, 300)],
        suggestedFix: `Define or import '${symbol}' properly before referencing it in ${file}.`
      };
    }

    // 2. Check for Type Mismatch (TS2322)
    if (combinedOutput.includes('TS2322') || combinedOutput.includes('is not assignable to type')) {
      const file = Object.keys(relevantFiles)[0] || '/src/App.tsx';
      return {
        category: 'type',
        severity: 'medium',
        explanation: `TypeScript type mismatch detected in ${file}. Value type does not match prop definition.`,
        affectedFiles: [file],
        evidence: [combinedOutput.trim().slice(0, 300)],
        suggestedFix: `Cast or convert the variable to match expected TypeScript interface types.`
      };
    }

    // 3. Check for Missing Module (ModuleNotFoundError)
    const modMatch = combinedOutput.match(/Cannot find module\s*['"]([^'"]+)['"]/i) ||
      combinedOutput.match(/Failed to resolve import\s*['"]([^'"]+)['"]/i);

    if (modMatch) {
      const moduleName = modMatch[1];
      const file = Object.keys(relevantFiles).find(f => (relevantFiles[f] || '').includes(moduleName)) || '/package.json';
      return {
        category: 'dependency',
        severity: 'high',
        explanation: `Required dependency '${moduleName}' is imported in ${file} but missing from package.json or node_modules.`,
        affectedFiles: [file, '/package.json'],
        evidence: [combinedOutput.trim().slice(0, 300)],
        suggestedFix: `Add '${moduleName}' to package.json dependencies or replace with standard module.`
      };
    }

    // 4. Default runtime error
    return {
      category: 'runtime',
      severity: 'medium',
      explanation: `Execution exited with code ${evidence.exitCode}: ${combinedOutput.slice(0, 200) || 'Unknown runtime termination'}.`,
      affectedFiles: Object.keys(relevantFiles).slice(0, 2),
      evidence: [combinedOutput.slice(0, 300)],
      suggestedFix: 'Review error stack trace and correct invalid expressions.'
    };
  }

  public async generatePatch(input: RepairInput): Promise<Patch> {
    const { diagnosis, relevantFiles } = input;
    const targetPath = diagnosis.affectedFiles[0] || Object.keys(relevantFiles)[0];
    const currentCode = relevantFiles[targetPath] || '';

    let patchedCode = currentCode;
    const fileChanges: PatchFileChange[] = [];

    if (diagnosis.category === 'syntax' || diagnosis.explanation.includes('ReferenceError') || diagnosis.explanation.includes('undefined')) {
      if (patchedCode.includes('calcTax_UNDEFINED_CALL')) {
        patchedCode = patchedCode.replace(/calcTax_UNDEFINED_CALL/g, '((amt: number) => amt * 0.085)');
      } else if (patchedCode.includes('undefined_variable_fault')) {
        patchedCode = patchedCode.replace(/undefined_variable_fault/g, '100');
      } else {
        patchedCode = `// Auto-repaired reference\n` + patchedCode;
      }
    } else if (diagnosis.category === 'type') {
      if (patchedCode.includes(`amount="string_type_error"`)) {
        patchedCode = patchedCode.replace(`amount="string_type_error"`, `amount={4200}`);
      } else if (patchedCode.includes(`'string_instead_of_number'`)) {
        patchedCode = patchedCode.replace(`'string_instead_of_number'`, `4200`);
      }
    } else if (diagnosis.category === 'dependency') {
      if (patchedCode.includes(`import '@uninstalled/fake-pkg';`)) {
        patchedCode = patchedCode.replace(`import '@uninstalled/fake-pkg';`, `// Removed missing dependency`);
      }
    }

    fileChanges.push({
      path: targetPath,
      before: currentCode,
      after: patchedCode
    });

    return {
      id: `patch_${Date.now()}`,
      summary: `Fixed ${diagnosis.category} issue in ${targetPath}: ${diagnosis.suggestedFix}`,
      files: fileChanges,
      confidence: 0.95
    };
  }

  public async editProject(input: EditInput): Promise<EditProposal> {
    const prompt = (input.prompt || '').trim().toLowerCase();
    const { relevantFiles, activeFilePath, operationId } = input;

    let targetPath = activeFilePath && (relevantFiles[activeFilePath] !== undefined || relevantFiles['/' + activeFilePath.replace(/^\/+/, '')] !== undefined)
      ? (activeFilePath.startsWith('/') ? activeFilePath : '/' + activeFilePath)
      : Object.keys(relevantFiles).find(p => p.includes('App.tsx')) || Object.keys(relevantFiles)[0] || '/src/App.tsx';

    let currentCode = relevantFiles[targetPath] !== undefined ? relevantFiles[targetPath] : relevantFiles[targetPath.replace(/^\/+/, '')] || '';
    let patchedCode = currentCode;
    let summary = 'Updated application source code';
    let explanation = 'Applied requested modifications to project files.';

    if (prompt.includes('dark') || prompt.includes('theme')) {
      summary = 'Switch to dark theme styling';
      explanation = 'Updated container and text colors to slate-900 and slate-50.';
      patchedCode = patchedCode
        .replace(/bg-white/g, 'bg-slate-900')
        .replace(/bg-slate-50/g, 'bg-slate-900')
        .replace(/text-slate-900/g, 'text-slate-50')
        .replace(/text-slate-950/g, 'text-slate-50');
      if (!patchedCode.includes('dark-theme-active')) {
        patchedCode = `// dark-theme-active\n` + patchedCode;
      }
    } else if (prompt.includes('search') || prompt.includes('filter')) {
      summary = 'Add search and filter controls';
      explanation = 'Added search query state and filtered record set in UI.';
      if (!patchedCode.includes('searchTerm')) {
        patchedCode = patchedCode.replace('function App() {', 'function App() {\n  const [searchTerm, setSearchTerm] = React.useState("");');
      }
    } else if (prompt.includes('button')) {
      summary = 'Update button styling and interaction';
      explanation = 'Modified button labels and accent colors.';
      patchedCode = patchedCode.replace(/px-4 py-2/g, 'px-6 py-2.5 font-bold shadow-lg');
    } else if (prompt.includes('expense') || prompt.includes('table') || prompt.includes('database')) {
      summary = 'Add expenses table and connect dashboard to database';
      explanation = 'Created expenses table schema migration, updated database types, and integrated client data fetching in dashboard.';

      const dbTypesContent = `// Auto-generated Database Types for SnapDeploy AI
export interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string;
  created_at: string;
}
`;
      const dbClientContent = `// Type-safe Database Client for SnapDeploy AI
import { Expense } from '../types/database';

export class DatabaseClient {
  public async getExpenses(): Promise<Expense[]> {
    return [
      { id: '1', amount: 149.50, category: 'Cloud Infrastructure', description: 'Monthly server hosting', created_at: '2026-09-12' },
      { id: '2', amount: 89.00, category: 'Software Subscriptions', description: 'Analytics tooling', created_at: '2026-09-11' }
    ];
  }
}

export const db = new DatabaseClient();
`;

      const appFile = Object.keys(relevantFiles).find(p => p.includes('App.tsx')) || '/src/App.tsx';
      const currentApp = relevantFiles[appFile] || '';
      let patchedApp = currentApp;
      if (!patchedApp.includes('getExpenses')) {
        patchedApp = `// Database integration: Expenses\n` + patchedApp;
      }

      const fileChanges: PatchFileChange[] = [
        {
          path: '/src/types/database.ts',
          before: relevantFiles['/src/types/database.ts'] || '',
          after: dbTypesContent
        },
        {
          path: '/src/lib/db.ts',
          before: relevantFiles['/src/lib/db.ts'] || '',
          after: dbClientContent
        },
        {
          path: appFile,
          before: currentApp,
          after: patchedApp
        }
      ];

      const migration = {
        migrationId: `mig_expenses_${Date.now()}`,
        projectId: input.projectId || 'active-project',
        title: 'Create expenses table',
        description: 'Auto-generated migration for expenses tracking',
        schemaVersion: 1,
        operations: [
          {
            type: 'create_table',
            tableName: 'expenses',
            description: 'Customer and infrastructure expenses',
            columns: [
              { name: 'id', type: 'uuid', isPrimary: true, isNullable: false },
              { name: 'amount', type: 'numeric', isNullable: false },
              { name: 'category', type: 'text', isNullable: false },
              { name: 'description', type: 'text', isNullable: true },
              { name: 'created_at', type: 'timestamp', isNullable: false }
            ]
          }
        ]
      };

      return {
        id: `edit_rule_${Date.now()}`,
        operationId,
        summary,
        explanation,
        files: fileChanges,
        migration,
        confidence: 0.95
      };
    } else if (
      prompt.includes('auth') ||
      prompt.includes('login') ||
      prompt.includes('signup') ||
      prompt.includes('protect')
    ) {
      summary = 'Add authentication, login/signup flows, and session state';
      explanation = 'Generated type-safe auth client, login/signup modal, protected route wrapper, and user session indicators.';

      const authTypesContent = `// Auto-generated Authentication Types for SnapDeploy AI
export interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  createdAt: string;
}

export interface Session {
  user: User;
  token: string;
  expiresAt: number;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}
`;

      const authClientContent = `// Type-safe Client Auth for SnapDeploy AI
import { User, Session, AuthState } from '../types/auth';

const STORAGE_KEY = 'snapdeploy_client_session_v1';

export class AuthClient {
  private currentSession: Session | null = null;
  private listeners: Set<(state: AuthState) => void> = new Set();

  constructor() {
    this.hydrateSession();
  }

  private hydrateSession(): void {
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.expiresAt > Date.now()) {
            this.currentSession = parsed;
          }
        }
      } catch {}
    }
  }

  public async signUp(email: string, password?: string, name?: string): Promise<{ user?: User; session?: Session; error?: string }> {
    if (!email || !email.includes('@')) {
      return { error: 'Valid email address is required.' };
    }
    const user: User = {
      id: \`usr_\${Date.now()}\`,
      email,
      name: name || email.split('@')[0],
      role: 'user',
      createdAt: new Date().toISOString()
    };
    const session: Session = {
      user,
      token: \`mock_tok_\${Date.now()}\`,
      expiresAt: Date.now() + 3600 * 1000
    };
    this.currentSession = session;
    this.saveSession();
    this.notifyListeners();
    return { user, session };
  }

  public async signIn(email: string, password?: string): Promise<{ user?: User; session?: Session; error?: string }> {
    if (!email || !password) {
      return { error: 'Email and password are required.' };
    }
    if (password === 'wrong_password') {
      return { error: 'Invalid email or password.' };
    }
    const isAdmin = email.includes('admin');
    const user: User = {
      id: isAdmin ? 'usr_admin_1' : 'usr_std_2',
      email,
      name: isAdmin ? 'Admin User' : (email.split('@')[0]),
      role: isAdmin ? 'admin' : 'user',
      createdAt: '2026-09-01T00:00:00.000Z'
    };
    const session: Session = {
      user,
      token: \`mock_tok_\${Date.now()}\`,
      expiresAt: Date.now() + 3600 * 1000
    };
    this.currentSession = session;
    this.saveSession();
    this.notifyListeners();
    return { user, session };
  }

  public async signOut(): Promise<void> {
    this.currentSession = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    this.notifyListeners();
  }

  public getSession(): Session | null {
    return this.currentSession;
  }

  public getUser(): User | null {
    return this.currentSession?.user || null;
  }

  public subscribe(cb: (state: AuthState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private saveSession(): void {
    if (typeof window !== 'undefined' && this.currentSession) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentSession));
      } catch {}
    }
  }

  private notifyListeners(): void {
    const state: AuthState = {
      user: this.getUser(),
      session: this.getSession(),
      loading: false,
      error: null
    };
    for (const l of this.listeners) l(state);
  }
}

export const auth = new AuthClient();
`;

      const appFile = Object.keys(relevantFiles).find(p => p.includes('App.tsx')) || '/src/App.tsx';
      const currentApp = relevantFiles[appFile] || '';
      let patchedApp = currentApp;
      if (!patchedApp.includes('auth.getUser')) {
        patchedApp = `// Authentication integration: User session\n` + patchedApp;
      }

      const fileChanges: PatchFileChange[] = [
        {
          path: '/src/types/auth.ts',
          before: relevantFiles['/src/types/auth.ts'] || '',
          after: authTypesContent
        },
        {
          path: '/src/lib/auth.ts',
          before: relevantFiles['/src/lib/auth.ts'] || '',
          after: authClientContent
        },
        {
          path: appFile,
          before: currentApp,
          after: patchedApp
        }
      ];

      return {
        id: `edit_rule_${Date.now()}`,
        operationId,
        summary,
        explanation,
        files: fileChanges,
        confidence: 0.95
      };
    } else {
      summary = `Custom update: ${input.prompt.slice(0, 40)}`;
      explanation = 'Applied targeted changes based on user prompt.';
      patchedCode = `// AI Edit: ${input.prompt.slice(0, 30)}\n` + patchedCode;
    }

    const fileChanges: PatchFileChange[] = [{
      path: targetPath,
      before: currentCode,
      after: patchedCode
    }];

    return {
      id: `edit_rule_${Date.now()}`,
      operationId,
      summary,
      explanation,
      files: fileChanges,
      confidence: 0.95
    };
  }
}

export const ruleBasedAIProvider = new RuleBasedAIProvider();
