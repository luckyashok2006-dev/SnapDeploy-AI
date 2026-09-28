import { ExecutionEvidence, DiagnosisCategory } from '../../types/workspace';

export interface CorpusTestCase {
  id: string;
  name: string;
  evidence: ExecutionEvidence;
  projectFiles: Record<string, { content: string }>;
  expectedCategory: DiagnosisCategory;
  expectedAffectedFile: string;
  expectedDiagnosis: {
    rootCauseSubstring: string;
    isHypothesis: boolean;
    minConfidence: number;
  };
  expectedRepair: {
    intendedAction: string;
  };
  expectedVerification: string[];
  expectedFinalState: 'REPAIRED' | 'ROLLED_BACK';
}

export const FAILURE_CORPUS: CorpusTestCase[] = [
  // 1. Syntax Error
  {
    id: 'case_01_syntax_error',
    name: 'Syntax Error: Malformed token in App.tsx',
    evidence: {
      executionId: 'exec_corp_01',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/App.tsx:14:5: SyntaxError: Unexpected token \';\'\n  const val = (;;;',
      durationMs: 310,
      projectId: 'corpus-proj-1'
    },
    projectFiles: {
      '/src/App.tsx': {
        content: `export default function App() {\n  const val = (;;;\n  return <div>App</div>;\n}`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'SYNTAX',
    expectedAffectedFile: '/src/App.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: 'Syntax error',
      isHypothesis: false,
      minConfidence: 0.85
    },
    expectedRepair: {
      intendedAction: 'Remove invalid semicolon syntax'
    },
    expectedVerification: ['TypeScript Compilation', 'Production Build'],
    expectedFinalState: 'REPAIRED'
  },

  // 2. Missing Import
  {
    id: 'case_02_missing_import',
    name: 'Missing Import: useState referenced without React import',
    evidence: {
      executionId: 'exec_corp_02',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 2,
      stdout: '',
      stderr: 'src/components/Counter.tsx(4,22): error TS2304: Cannot find name \'useState\'.',
      durationMs: 420,
      projectId: 'corpus-proj-2'
    },
    projectFiles: {
      '/src/components/Counter.tsx': {
        content: `export function Counter() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}>{count}</button>;\n}`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'TYPE',
    expectedAffectedFile: '/src/components/Counter.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: 'useState',
      isHypothesis: false,
      minConfidence: 0.80
    },
    expectedRepair: {
      intendedAction: 'Import useState from react'
    },
    expectedVerification: ['TypeScript Compilation'],
    expectedFinalState: 'REPAIRED'
  },

  // 3. Incorrect Import Path
  {
    id: 'case_03_incorrect_import_path',
    name: 'Incorrect Import Path: Broken relative module reference',
    evidence: {
      executionId: 'exec_corp_03',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/App.tsx:2:24: RollupError: Failed to resolve import "./comp/Button" from "src/App.tsx". Does the file exist?',
      durationMs: 280,
      projectId: 'corpus-proj-3'
    },
    projectFiles: {
      '/src/App.tsx': {
        content: `import React from 'react';\nimport { Button } from './comp/Button';\nexport default function App() { return <Button />; }`
      },
      '/src/components/Button.tsx': {
        content: `export function Button() { return <button>Click</button>; }`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'DEPENDENCY',
    expectedAffectedFile: '/src/App.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: './comp/Button',
      isHypothesis: false,
      minConfidence: 0.80
    },
    expectedRepair: {
      intendedAction: 'Fix import path to ./components/Button'
    },
    expectedVerification: ['TypeScript Compilation', 'Production Build'],
    expectedFinalState: 'REPAIRED'
  },

  // 4. TypeScript Type Mismatch
  {
    id: 'case_04_type_mismatch',
    name: 'Type Mismatch: Passing number to string property',
    evidence: {
      executionId: 'exec_corp_04',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 2,
      stdout: '',
      stderr: 'src/App.tsx(6,16): error TS2322: Type \'number\' is not assignable to type \'string\'.',
      durationMs: 390,
      projectId: 'corpus-proj-4'
    },
    projectFiles: {
      '/src/App.tsx': {
        content: `interface Props { title: string; }\nfunction Heading({ title }: Props) { return <h1>{title}</h1>; }\nexport default function App() { return <Heading title={123} />; }`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'TYPE',
    expectedAffectedFile: '/src/App.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: 'type',
      isHypothesis: false,
      minConfidence: 0.85
    },
    expectedRepair: {
      intendedAction: 'Change title={123} to title="123"'
    },
    expectedVerification: ['TypeScript Compilation'],
    expectedFinalState: 'REPAIRED'
  },

  // 5. Undefined Identifier
  {
    id: 'case_05_undefined_identifier',
    name: 'Undefined Identifier: TS2304 Cannot find name',
    evidence: {
      executionId: 'exec_corp_05',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 2,
      stdout: '',
      stderr: 'src/utils/calc.ts(3,10): error TS2304: Cannot find name \'multiplier\'.',
      durationMs: 310,
      projectId: 'corpus-proj-5'
    },
    projectFiles: {
      '/src/utils/calc.ts': {
        content: `export function calculateTotal(base: number): number {\n  return base * multiplier;\n}`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'TYPE',
    expectedAffectedFile: '/src/utils/calc.ts',
    expectedDiagnosis: {
      rootCauseSubstring: 'multiplier',
      isHypothesis: false,
      minConfidence: 0.85
    },
    expectedRepair: {
      intendedAction: 'Declare or import multiplier constant'
    },
    expectedVerification: ['TypeScript Compilation'],
    expectedFinalState: 'REPAIRED'
  },

  // 6. Runtime Exception
  {
    id: 'case_06_runtime_exception',
    name: 'Runtime Exception: TypeError reading null property',
    evidence: {
      executionId: 'exec_corp_06',
      command: 'npm run test',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/components/Profile.tsx:18:9: TypeError: Cannot read properties of undefined (reading \'avatar\')\n    at Profile (src/components/Profile.tsx:18:9)',
      durationMs: 450,
      projectId: 'corpus-proj-6'
    },
    projectFiles: {
      '/src/components/Profile.tsx': {
        content: `export function Profile({ user }: any) {\n  return <div><img src={user.details.avatar} /></div>;\n}`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build","test":"vitest run"}}`
      }
    },
    expectedCategory: 'RUNTIME',
    expectedAffectedFile: '/src/components/Profile.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: 'runtime exception',
      isHypothesis: false,
      minConfidence: 0.75
    },
    expectedRepair: {
      intendedAction: 'Add optional chaining user?.details?.avatar'
    },
    expectedVerification: ['TypeScript Compilation', 'Production Build'],
    expectedFinalState: 'REPAIRED'
  },

  // 7. Missing Dependency
  {
    id: 'case_07_missing_dependency',
    name: 'Missing Dependency: Module not installed in package.json',
    evidence: {
      executionId: 'exec_corp_07',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'src/App.tsx:1:28: Cannot find module \'lucide-react\' or its corresponding type declarations.',
      durationMs: 330,
      projectId: 'corpus-proj-7'
    },
    projectFiles: {
      '/src/App.tsx': {
        content: `import { Sparkles } from 'lucide-react';\nexport default function App() { return <Sparkles />; }`
      },
      '/package.json': {
        content: `{"name":"test","dependencies":{"react":"^18.0.0"}}`
      }
    },
    expectedCategory: 'DEPENDENCY',
    expectedAffectedFile: '/src/App.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: 'lucide-react',
      isHypothesis: false,
      minConfidence: 0.80
    },
    expectedRepair: {
      intendedAction: 'Declare lucide-react in package.json'
    },
    expectedVerification: ['TypeScript Compilation', 'Production Build'],
    expectedFinalState: 'REPAIRED'
  },

  // 8. Configuration/Build Error
  {
    id: 'case_08_config_error',
    name: 'Configuration Error: Invalid setting in vite.config.ts',
    evidence: {
      executionId: 'exec_corp_08',
      command: 'npm run build',
      args: [],
      exitCode: 1,
      stdout: '',
      stderr: 'vite.config.ts:3:5: error: Invalid configuration option "invalidPluginMode" in defineConfig',
      durationMs: 250,
      projectId: 'corpus-proj-8'
    },
    projectFiles: {
      '/vite.config.ts': {
        content: `import { defineConfig } from 'vite';\nexport default defineConfig({ invalidPluginMode: true });`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'CONFIGURATION',
    expectedAffectedFile: '/vite.config.ts',
    expectedDiagnosis: {
      rootCauseSubstring: 'configuration',
      isHypothesis: false,
      minConfidence: 0.80
    },
    expectedRepair: {
      intendedAction: 'Remove or correct invalid option in vite.config.ts'
    },
    expectedVerification: ['Production Build'],
    expectedFinalState: 'REPAIRED'
  },

  // 9. Multi-file Inconsistency
  {
    id: 'case_09_multifile_inconsistency',
    name: 'Multi-file Inconsistency: Component export renamed',
    evidence: {
      executionId: 'exec_corp_09',
      command: 'npx tsc --noEmit',
      args: [],
      exitCode: 2,
      stdout: '',
      stderr: 'src/App.tsx(2,10): error TS2305: Module \'"./components/Card"\' has no exported member \'Card\'. Did you mean \'CardComponent\'?',
      durationMs: 380,
      projectId: 'corpus-proj-9'
    },
    projectFiles: {
      '/src/App.tsx': {
        content: `import { Card } from './components/Card';\nexport default function App() { return <Card />; }`
      },
      '/src/components/Card.tsx': {
        content: `export function CardComponent() { return <div>Card</div>; }`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'TYPE',
    expectedAffectedFile: '/src/App.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: 'Card',
      isHypothesis: false,
      minConfidence: 0.85
    },
    expectedRepair: {
      intendedAction: 'Update export in Card.tsx or import in App.tsx'
    },
    expectedVerification: ['TypeScript Compilation'],
    expectedFinalState: 'REPAIRED'
  },

  // 10. Unrepairable Failure (Insufficient evidence -> Rollback)
  {
    id: 'case_10_unrepairable_failure',
    name: 'Unrepairable Failure: Empty logs with nonzero exit code',
    evidence: {
      executionId: 'exec_corp_10',
      command: 'npm run build',
      args: [],
      exitCode: 137,
      stdout: '',
      stderr: '',
      durationMs: 120,
      projectId: 'corpus-proj-10'
    },
    projectFiles: {
      '/src/App.tsx': {
        content: `export default function App() { return <div>Ok</div>; }`
      },
      '/package.json': {
        content: `{"name":"test","scripts":{"build":"vite build"}}`
      }
    },
    expectedCategory: 'UNKNOWN',
    expectedAffectedFile: '/src/App.tsx',
    expectedDiagnosis: {
      rootCauseSubstring: 'Unspecified process failure',
      isHypothesis: true,
      minConfidence: 0.35
    },
    expectedRepair: {
      intendedAction: 'Cannot construct reliable patch without diagnostic stream'
    },
    expectedVerification: ['TypeScript Compilation', 'Production Build'],
    expectedFinalState: 'ROLLED_BACK'
  }
];
