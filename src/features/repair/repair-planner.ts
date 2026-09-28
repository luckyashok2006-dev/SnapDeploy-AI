import { Diagnosis, RepairPlan, RepairPlanStep } from '../../types/workspace';

/**
 * Creates a structured Repair Plan from a Diagnosis before patch synthesis.
 * The plan is purely declarative and does NOT mutate project state.
 */
export function createRepairPlan(
  diagnosis: Diagnosis,
  projectFiles: Record<string, { content: string }>
): RepairPlan {
  const steps: RepairPlanStep[] = [];
  const affectedFiles = diagnosis.affectedFiles.length > 0
    ? diagnosis.affectedFiles
    : (diagnosis.affectedPath ? [diagnosis.affectedPath] : ['/src/App.tsx']);

  for (const filePath of affectedFiles) {
    const normPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const fileExists = Boolean(
      projectFiles[normPath] ||
      projectFiles[normPath.replace(/^\/+/, '')] ||
      projectFiles[`/${normPath.replace(/^\/+/, '')}`]
    );

    let intendedModification = '';
    let reason = '';
    let expectedOutcome = '';

    const cat = String(diagnosis.category).toUpperCase();

    switch (cat) {
      case 'SYNTAX':
        intendedModification = 'Remove invalid tokens, close open syntax delimiters, or correct malformed JSX syntax.';
        reason = diagnosis.rootCause || 'Source file contains syntax or tokenization errors that prevent parsing.';
        expectedOutcome = 'File parses successfully without syntax errors.';
        break;

      case 'TYPE':
        intendedModification = 'Add missing type import, declare missing identifier, or align component prop types.';
        reason = diagnosis.rootCause || 'TypeScript compiler identified type mismatches or unresolved identifiers.';
        expectedOutcome = 'TypeScript compiler passes with 0 type errors (tsc --noEmit).';
        break;

      case 'DEPENDENCY':
        if (normPath === '/package.json') {
          intendedModification = 'Declare required package in dependencies or devDependencies.';
          reason = diagnosis.rootCause || 'Runtime requires a missing external module.';
          expectedOutcome = 'Package dependencies are resolvable and installed.';
        } else {
          intendedModification = 'Update import statement to point to the correct file path or export.';
          reason = diagnosis.rootCause || 'Import statement points to a nonexistent module or path.';
          expectedOutcome = 'All local module imports resolve cleanly.';
        }
        break;

      case 'BUILD':
        intendedModification = 'Harmonize build input exports, remove incompatible bundler transforms.';
        reason = diagnosis.rootCause || 'Vite/Rollup build pipeline failed to bundle assets.';
        expectedOutcome = 'Production build completes and generates dist bundles.';
        break;

      case 'CONFIGURATION':
        intendedModification = 'Update build configuration options to supported values.';
        reason = diagnosis.rootCause || 'Configuration file contains invalid options.';
        expectedOutcome = 'Tooling recognizes valid configuration settings.';
        break;

      case 'RUNTIME':
        intendedModification = 'Add safe null checks, optional chaining, or provide initial fallback values.';
        reason = diagnosis.rootCause || 'Component encounters runtime exception during lifecycle execution.';
        expectedOutcome = 'Component executes and renders cleanly without unhandled exceptions.';
        break;

      case 'UNKNOWN':
      default:
        intendedModification = diagnosis.suggestedFix || 'Review code changes and align with project architecture.';
        reason = diagnosis.rootCause || 'Diagnostic logs indicate an unresolved execution error.';
        expectedOutcome = 'Execution completes cleanly.';
        break;
    }

    if (!fileExists && normPath !== '/package.json') {
      intendedModification = `Create missing file or redirect import to an existing component.`;
      reason = `Target file '${normPath}' does not exist in the project VFS.`;
      expectedOutcome = `File exists and exports required symbols.`;
    }

    steps.push({
      targetFile: normPath,
      intendedModification,
      reason,
      expectedOutcome
    });
  }

  const verificationPlan = diagnosis.expectedVerification && diagnosis.expectedVerification.length > 0
    ? diagnosis.expectedVerification
    : ['TypeScript Compilation', 'Production Build'];

  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: diagnosis.projectId,
    summary: `Repair ${diagnosis.category} issue: ${diagnosis.rootCause || diagnosis.explanation.slice(0, 100)}`,
    steps,
    expectedOutcome: `Resolve ${diagnosis.category} failure and verify clean status via ${verificationPlan.join(' and ')}.`,
    verificationPlan,
    createdAt: new Date().toISOString()
  };
}
