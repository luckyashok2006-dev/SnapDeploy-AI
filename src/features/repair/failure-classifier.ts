import { ExecutionEvidence, Diagnosis, DiagnosisCategory, RecommendedRepair } from '../../types/workspace';

export interface ClassificationResult extends Diagnosis {
  category: DiagnosisCategory;
  severity: 'low' | 'medium' | 'high';
  rootCause: string;
  explanation: string;
  suggestedFix: string;
  affectedFiles: string[];
  affectedPath?: string;
  confidence: number;
  confidenceReason: string;
  isHypothesis: boolean;
  evidenceSummary: string;
  evidence: string[];
  recommendedRepair: RecommendedRepair;
  expectedVerification: string[];
  errorContext?: string;
}

/**
 * Extracts line, column, and diagnostic context from error logs.
 */
export function extractErrorContext(evidence: ExecutionEvidence): {
  filePath?: string;
  line?: number;
  column?: number;
  errorContext?: string;
} {
  const logs = `${evidence.stderr}\n${evidence.stdout}\n${evidence.stackTrace || ''}`;

  // Match pattern: src/App.tsx:14:5 or /src/App.tsx(14,5)
  const locMatch = logs.match(/(?:(?:\/)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+))[:\(](\d+)[:,\s](\d+)\)?/);
  if (locMatch) {
    const rawPath = locMatch[1].startsWith('/') ? locMatch[1] : `/${locMatch[1]}`;
    const line = parseInt(locMatch[2], 10);
    const column = parseInt(locMatch[3], 10);
    return {
      filePath: rawPath,
      line,
      column,
      errorContext: `Line ${line}, Col ${column} in ${rawPath}`
    };
  }

  // Fallback: search for simple file mention
  const fileMatch = logs.match(/(?:(?:\/)?(src\/[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+))/);
  if (fileMatch) {
    const rawPath = fileMatch[1].startsWith('/') ? fileMatch[1] : `/${fileMatch[1]}`;
    return {
      filePath: rawPath,
      errorContext: `Referenced in ${rawPath}`
    };
  }

  return {};
}

/**
 * Classifies runtime failure evidence using deterministic heuristics.
 * Adheres strictly to the primary principle: Never invent certainty.
 * If logs are empty or ambiguous, returns UNKNOWN with low confidence and isHypothesis: true.
 */
function _classifyInternal(
  evidence: ExecutionEvidence,
  projectFiles?: Record<string, { content: string }>
): Omit<ClassificationResult, 'evidence'> {
  const combinedLogs = `${evidence.stderr}\n${evidence.stdout}\n${evidence.stackTrace || ''}`.trim();
  const context = extractErrorContext(evidence);
  const affectedPath = context.filePath || evidence.affectedPath || '/src/App.tsx';

  // 1. INSUFFICIENT EVIDENCE / EMPTY LOGS
  if (!combinedLogs || combinedLogs.length < 5) {
    return {
      category: 'UNKNOWN',
      severity: 'medium',
      rootCause: 'Unspecified process failure (command exited with non-zero status without diagnostic log output)',
      explanation: 'The process terminated with exit code ' + (evidence.exitCode ?? 1) + ', but no detailed compiler or runtime error stream was captured. Evidence is insufficient for a definitive diagnosis.',
      suggestedFix: 'Inspect terminal output or rerun the command with verbose logging.',
      affectedFiles: projectFiles && projectFiles[affectedPath] ? [affectedPath] : [],
      affectedPath: undefined,
      confidence: 0.35,
      confidenceReason: 'No diagnostic error stream was emitted; root cause is an unverified hypothesis',
      isHypothesis: true,
      evidenceSummary: `Command '${evidence.command}' exited with code ${evidence.exitCode ?? 'unknown'} with empty stderr/stdout`,
      recommendedRepair: {
        approach: 'Re-run build check in debug mode or review entry points',
        targetFiles: [],
        rationale: 'Cannot construct a reliable patch without compiler diagnostic output'
      },
      expectedVerification: ['TypeScript Compilation', 'Production Build'],
      errorContext: undefined
    };
  }

  // 2. SYNTAX ERROR
  if (/SyntaxError|Unexpected token|Unexpected identifier|Parsing error|Expected corresponding JSX closing tag/i.test(combinedLogs)) {
    return {
      category: 'SYNTAX',
      severity: 'high',
      rootCause: 'Syntax error or malformed language token in source code',
      explanation: `Syntax parsing failure detected: ${combinedLogs.split('\n')[0].slice(0, 180)}`,
      suggestedFix: 'Correct the syntax tokens, close unclosed brackets/tags, or remove invalid characters.',
      affectedFiles: [affectedPath],
      affectedPath,
      confidence: 0.90,
      confidenceReason: 'Compiler diagnostic explicitly reported a SyntaxError with file and token position',
      isHypothesis: false,
      evidenceSummary: combinedLogs.slice(0, 200),
      recommendedRepair: {
        approach: 'Surgical token correction',
        targetFiles: [affectedPath],
        rationale: 'Fix malformed syntax tokens without modifying surrounding logic'
      },
      expectedVerification: ['TypeScript Compilation', 'Production Build'],
      errorContext: context.errorContext
    };
  }

  // 3. TYPESCRIPT TYPE ERROR
  if (/error TS\d+|TS\d{4,5}:|Type '.*?' is not assignable|Cannot find name '.*?'|Property '.*?' does not exist on type|has no exported member/i.test(combinedLogs)) {
    const isMissingName = /Cannot find name '([^']+)'/i.exec(combinedLogs);
    const isMissingMember = /has no exported member '([^']+)'/i.exec(combinedLogs);
    const nameMention = isMissingName ? `'${isMissingName[1]}'` : (isMissingMember ? `'${isMissingMember[1]}'` : null);

    return {
      category: 'TYPE',
      severity: 'high',
      rootCause: nameMention
        ? `Undeclared or missing member/identifier: ${nameMention}`
        : 'TypeScript compilation type mismatch or invalid property access',
      explanation: `TypeScript compiler rejected type annotations or identifiers: ${combinedLogs.split('\n')[0].slice(0, 180)}`,
      suggestedFix: nameMention
        ? `Import, declare, or export ${nameMention} before referencing it.`
        : 'Align the expression type with the declared interface or add necessary type declarations.',
      affectedFiles: [affectedPath],
      affectedPath,
      confidence: 0.88,
      confidenceReason: 'TypeScript compiler emitted a deterministic diagnostic code (tsc --noEmit)',
      isHypothesis: false,
      evidenceSummary: combinedLogs.slice(0, 200),
      recommendedRepair: {
        approach: 'Add missing type import or harmonize interface properties',
        targetFiles: [affectedPath],
        rationale: 'Satisfies TypeScript type contracts without altering runtime functionality'
      },
      expectedVerification: ['TypeScript Compilation'],
      errorContext: context.errorContext
    };
  }

  // 4. DEPENDENCY / MODULE RESOLUTION ERROR
  if (/Cannot find module|Module not found|ERR_MODULE_NOT_FOUND|Failed to resolve import|npm ERR! 404|Could not resolve/i.test(combinedLogs)) {
    const moduleMatch = /(?:Cannot find module|Could not resolve|Failed to resolve import)\s+['"]([^'"]+)['"]/i.exec(combinedLogs);
    const moduleName = moduleMatch ? moduleMatch[1] : 'unresolved module';
    const isLocalRelative = moduleName.startsWith('.') || moduleName.startsWith('/');

    return {
      category: 'DEPENDENCY',
      severity: 'high',
      rootCause: isLocalRelative
        ? `Broken local import path: '${moduleName}' cannot be resolved`
        : `Missing or unregistered npm package dependency: '${moduleName}'`,
      explanation: `Module resolution failure: ${moduleName} is referenced but not available in the project.`,
      suggestedFix: isLocalRelative
        ? `Correct the relative path in the import statement to match the actual file location.`
        : `Add '${moduleName}' to package.json dependencies and run install.`,
      affectedFiles: isLocalRelative ? [affectedPath] : [affectedPath, '/package.json'],
      affectedPath,
      confidence: 0.86,
      confidenceReason: 'Module bundler or Node runtime directly identified an unresolvable module path',
      isHypothesis: false,
      evidenceSummary: `Unresolvable import: ${moduleName}`,
      recommendedRepair: {
        approach: isLocalRelative ? 'Fix relative file path' : 'Declare dependency in package.json',
        targetFiles: isLocalRelative ? [affectedPath] : ['/package.json', affectedPath],
        rationale: 'Restores module resolution graph'
      },
      expectedVerification: ['TypeScript Compilation', 'Production Build'],
      errorContext: context.errorContext
    };
  }

  // 5. BUILD / BUNDLER ERROR
  if (/RollupError|vite:esbuild|Transform failed with \d+ error|Build failed with \d+ error/i.test(combinedLogs)) {
    return {
      category: 'BUILD',
      severity: 'high',
      rootCause: 'Vite/Rollup production build bundler compilation failure',
      explanation: `Build pipeline failed to assemble production assets: ${combinedLogs.split('\n')[0].slice(0, 180)}`,
      suggestedFix: 'Resolve conflicting imports, circular references, or unsupported build options.',
      affectedFiles: [affectedPath],
      affectedPath,
      confidence: 0.82,
      confidenceReason: 'Build bundler terminated with explicit transform errors',
      isHypothesis: false,
      evidenceSummary: combinedLogs.slice(0, 200),
      recommendedRepair: {
        approach: 'Harmonize build inputs and export formats',
        targetFiles: [affectedPath],
        rationale: 'Allows production Vite build to produce clean distribution bundle'
      },
      expectedVerification: ['Production Build'],
      errorContext: context.errorContext
    };
  }

  // 6. CONFIGURATION ERROR
  if (/tsconfig\.json|vite\.config|postcss\.config|tailwind\.config|Invalid configuration/i.test(combinedLogs)) {
    return {
      category: 'CONFIGURATION',
      severity: 'medium',
      rootCause: 'Project configuration manifest or tool configuration error',
      explanation: `Build tooling configuration syntax or setting error: ${combinedLogs.split('\n')[0].slice(0, 180)}`,
      suggestedFix: 'Fix invalid options in configuration files (vite.config.ts, tsconfig.json).',
      affectedFiles: ['/vite.config.ts'],
      affectedPath: '/vite.config.ts',
      confidence: 0.80,
      confidenceReason: 'Configuration parser flagged an invalid property or schema mismatch',
      isHypothesis: false,
      evidenceSummary: combinedLogs.slice(0, 200),
      recommendedRepair: {
        approach: 'Correct configuration settings',
        targetFiles: ['/vite.config.ts'],
        rationale: 'Aligns build tool config with supported options'
      },
      expectedVerification: ['Production Build'],
      errorContext: context.errorContext
    };
  }

  // 7. RUNTIME ERROR
  if (/TypeError:|ReferenceError:|RangeError:|Uncaught (?:in promise )?Error/i.test(combinedLogs)) {
    return {
      category: 'RUNTIME',
      severity: 'high',
      rootCause: 'Uncaught runtime exception thrown during component execution',
      explanation: `Execution runtime threw an unhandled exception: ${combinedLogs.split('\n')[0].slice(0, 180)}`,
      suggestedFix: 'Add null-checks, verify object property existence before access, or initialize default state.',
      affectedFiles: [affectedPath],
      affectedPath,
      confidence: 0.78,
      confidenceReason: 'Stack trace captured an active runtime error',
      isHypothesis: false,
      evidenceSummary: combinedLogs.slice(0, 200),
      recommendedRepair: {
        approach: 'Defensive state initialization and optional chaining',
        targetFiles: [affectedPath],
        rationale: 'Prevents null dereference or undefined call during render'
      },
      expectedVerification: ['TypeScript Compilation', 'Production Build'],
      errorContext: context.errorContext
    };
  }

  // 8. UNKNOWN / AMBIGUOUS FALLBACK
  return {
    category: 'UNKNOWN',
    severity: 'medium',
    rootCause: 'Unclassified execution error',
    explanation: `An error occurred during execution: ${combinedLogs.split('\n')[0].slice(0, 150)}. Cause is not definitively determined from error patterns.`,
    suggestedFix: 'Examine logs in the terminal and verify recent code changes.',
    affectedFiles: [affectedPath],
    affectedPath,
    confidence: 0.42,
    confidenceReason: 'Diagnostic logs do not match known compiler or runtime signatures; root cause is a hypothesis',
    isHypothesis: true,
    evidenceSummary: combinedLogs.slice(0, 150),
    recommendedRepair: {
      approach: 'Manual code inspection and targeted logging',
      targetFiles: [affectedPath],
      rationale: 'Gather further diagnostics before applying code mutations'
    },
    expectedVerification: ['TypeScript Compilation', 'Production Build'],
    errorContext: context.errorContext
  };
}

export function classifyFailureEvidence(
  evidence: ExecutionEvidence,
  projectFiles?: Record<string, { content: string }>
): ClassificationResult {
  const result = _classifyInternal(evidence, projectFiles);
  const combinedLogs = `${evidence.stderr}\n${evidence.stdout}\n${evidence.stackTrace || ''}`.trim();
  return {
    ...result,
    evidence: [combinedLogs.slice(0, 300)]
  };
}
