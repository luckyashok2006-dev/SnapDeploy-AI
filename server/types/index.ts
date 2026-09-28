export type ProjectFramework = 'vite-react';

export interface ProjectPlanFile {
  path: string;
  purpose: string;
}

export interface ProjectPlanDependency {
  name: string;
  version?: string;
}

export interface ProjectPlan {
  name: string;
  framework: ProjectFramework;
  files: ProjectPlanFile[];
  dependencies: ProjectPlanDependency[];
  scripts: {
    dev: string;
    build: string;
    test?: string;
  };
}

export interface GenerationInput {
  prompt: string;
  name?: string;
  framework?: ProjectFramework;
  requestId?: string;
}

export interface ExecutionEvidence {
  executionId: string;
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  stackTrace?: string;
}

export type DiagnosisCategory =
  | 'SYNTAX'
  | 'TYPE'
  | 'RUNTIME'
  | 'DEPENDENCY'
  | 'BUILD'
  | 'CONFIGURATION'
  | 'UNKNOWN'
  | 'syntax'
  | 'type'
  | 'dependency'
  | 'runtime'
  | 'test'
  | 'configuration'
  | 'unknown';

export interface RecommendedRepair {
  approach: string;
  targetFiles: string[];
  rationale: string;
}

export interface Diagnosis {
  category: DiagnosisCategory;
  severity: 'low' | 'medium' | 'high';
  projectId?: string;
  explanation: string;
  rootCause?: string;
  affectedFiles: string[];
  affectedPath?: string;
  evidence: string[];
  evidenceSummary?: string;
  suggestedFix: string;
  confidence?: number;
  confidenceReason?: string;
  recommendedRepair?: RecommendedRepair;
  expectedVerification?: string[];
  errorContext?: string;
  isHypothesis?: boolean;
}

export interface RepairPlanStep {
  targetFile: string;
  intendedModification: string;
  reason: string;
  expectedOutcome: string;
}

export interface RepairPlan {
  id: string;
  projectId?: string;
  summary: string;
  steps: RepairPlanStep[];
  expectedOutcome: string;
  verificationPlan: string[];
  createdAt: string;
}

export interface PatchFileChange {
  path: string;
  before: string;
  after: string;
}

export interface Patch {
  id: string;
  summary: string;
  files: PatchFileChange[];
  confidence?: number;
  planId?: string;
  isMinimal?: boolean;
  minimalityNotes?: string;
}

export interface DiagnosticInput {
  evidence: ExecutionEvidence;
  relevantFiles: Record<string, string>;
  userRequirement?: string;
  requestId?: string;
  projectId?: string;
}

export interface RepairInput {
  diagnosis: Diagnosis;
  plan?: RepairPlan;
  evidence: ExecutionEvidence;
  relevantFiles: Record<string, string>;
  originalRequirement?: string;
  requestId?: string;
  projectId?: string;
}

export interface EditInput {
  prompt: string;
  projectId?: string;
  operationId?: string;
  activeFilePath?: string;
  relevantFiles: Record<string, string>;
  projectSummary?: {
    name: string;
    framework: string;
    fileList: string[];
  };
  requestId?: string;
}

export interface AffectedFilePlan {
  path: string;
  reason: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface EditProposal {
  id: string;
  operationId?: string;
  summary: string;
  explanation: string;
  intent?: string;
  confidence?: number;
  files: PatchFileChange[];
  migration?: any;
  affectedFiles?: AffectedFilePlan[];
  estimatedDiffSize?: { additions: number; deletions: number };
  expectedVerification?: string;
  dependenciesChange?: { added: string[]; removed: string[] };
}
