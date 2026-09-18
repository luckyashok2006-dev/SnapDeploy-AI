/**
 * SnapDeploy AI - Core Domain Types
 */
import { SafeMigrationRequest } from './database';

export type ProjectFramework = 'vite-react';

export interface Project {
  id: string;
  name: string;
  description?: string;
  framework: ProjectFramework;
  createdAt: string;
  updatedAt: string;
}

export type FileType =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'css'
  | 'html'
  | 'markdown'
  | 'prisma'
  | 'plaintext';

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string; // e.g. '/src/App.tsx' or 'src/App.tsx'
  content: string;
  hash: string;
  updatedAt: string;
  language?: FileType;
  isModified?: boolean;
}

export interface Snapshot {
  id: string;
  projectId: string;
  timestamp: string;
  description: string;
  files: Record<string, ProjectFile>;
  hash: string;
}

export interface Execution {
  id: string;
  projectId: string;
  command: string;
  args: string[];
  status: 'running' | 'completed' | 'failed' | 'killed';
  exitCode: number | null;
  startedAt: string;
  completedAt?: string;
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
  timedOut?: boolean;
}

export type DiagnosisCategory =
  | 'syntax'
  | 'type'
  | 'dependency'
  | 'runtime'
  | 'test'
  | 'configuration';

export interface Diagnosis {
  category: DiagnosisCategory;
  severity: 'low' | 'medium' | 'high';
  explanation: string;
  affectedFiles: string[];
  evidence: string[];
  suggestedFix: string;
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
}

export interface VerificationCheck {
  name: string;
  success: boolean;
  status?: string;
  command?: string;
  exitCode?: number | null;
  output?: string;
  durationMs?: number;
  timedOut?: boolean;
}

export interface VerificationResult {
  success: boolean;
  checks: VerificationCheck[];
  totalDurationMs: number;
  summary?: string;
}

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
}

export interface DiagnosticInput {
  evidence: ExecutionEvidence;
  relevantFiles: Record<string, string>;
  userRequirement?: string;
}

export interface RepairInput {
  diagnosis: Diagnosis;
  evidence: ExecutionEvidence;
  relevantFiles: Record<string, string>;
  originalRequirement?: string;
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
  migration?: SafeMigrationRequest;
  affectedFiles?: AffectedFilePlan[];
  estimatedDiffSize?: { additions: number; deletions: number };
  expectedVerification?: string;
  dependenciesChange?: { added: string[]; removed: string[] };
  visualEditSummary?: string;
  visualConfidence?: number;
}

export type RepairEpisodeStatus =
  | 'captured'
  | 'diagnosing'
  | 'proposal_ready'
  | 'awaiting_approval'
  | 'applying'
  | 'verifying'
  | 'resolved'
  | 'rejected'
  | 'rolled_back'
  | 'blocked'
  | 'paused'
  | 'cancelled';

export interface RepairEpisode {
  failureEpisodeId: string;
  projectId: string;
  attemptNumber: number;
  maxAttempts: number;
  failureFingerprint: string;
  evidenceFingerprint: string;
  proposalFingerprint?: string;
  status: RepairEpisodeStatus;
  evidence: ExecutionEvidence;
  diagnosis?: Diagnosis | null;
  patch?: Patch | null;
  createdAt: string;
  lastAttemptAt: string;
  error?: string | null;
  resolution?: 'resolved' | 'rejected' | 'rolled_back' | 'max_attempts_reached' | 'cancelled' | null;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  operationId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  proposal?: EditProposal;
  status?: 'idle' | 'pending_approval' | 'applied' | 'rejected' | 'failed_rolled_back' | 'cancelled';
  error?: string;
}

export type AIEvent =
  | { type: 'status'; status: string }
  | { type: 'token'; text: string }
  | { type: 'file_created'; path: string }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'diagnosis'; data: Diagnosis }
  | { type: 'patch'; data: Patch }
  | { type: 'verification'; data: VerificationResult }
  | { type: 'complete' }
  | { type: 'error'; message: string };

// Backward compatibility types where needed for smooth UI transition
export type VirtualFile = ProjectFile;
export type DiagnosticError = {
  id: string;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  stackTrace?: string;
  resolved: boolean;
};

export type AgentFixStep = {
  id: string;
  timestamp: string;
  stage: 'idle' | 'intercepting' | 'analyzing' | 'locating' | 'patching' | 'verifying' | 'resolved';
  toolCall?: string;
  description: string;
  targetFile?: string;
  diffContent?: string;
  logsOutput?: string;
};

export type ProjectWorkspace = {
  id: string;
  title: string;
  description: string;
  badge: string;
  status: 'ready' | 'running' | 'error';
  files: Record<string, ProjectFile>;
  openTabs: string[];
  activeFilePath: string;
  diagnostics: DiagnosticError[];
  fixHistory: AgentFixStep[];
};

export interface DetectedProjectConfig {
  framework: string;
  badge: string;
  title: string;
  description: string;
  hasPackageJson: boolean;
  hasTypeScript: boolean;
  hasLockfile: boolean;
  lockfileType?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  primaryEntryFile: string;
  scripts: {
    dev?: string;
    build?: string;
    test?: string;
    start?: string;
  };
  warnings: string[];
}

export interface ImportValidationResult {
  valid: boolean;
  extractedFiles: Record<string, string>;
  totalUncompressedBytes: number;
  fileCount: number;
  ignoredPaths: string[];
  warnings: string[];
  error?: string;
  detectedConfig?: DetectedProjectConfig;
}

export interface ImportExecutionOptions {
  customTitle?: string;
  customDescription?: string;
  skipRuntimeStart?: boolean;
  initialSnapshotTitle?: string;
  sourceType?: 'zip' | 'github';
  gitHubMetadata?: {
    owner: string;
    repo: string;
    ref: string;
  };
}

export interface GitHubUser {
  login: string;
  id?: number;
  name?: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    avatar_url?: string;
  };
  private: boolean;
  default_branch: string;
  description?: string;
  size: number; // In KB from GitHub API
  updated_at: string;
  stargazers_count?: number;
  html_url?: string;
}

export interface GitHubBranch {
  name: string;
  commitSha: string;
  isDefault: boolean;
}

export interface GitHubInspectResult {
  safe: boolean;
  fileCount: number;
  estimatedBytes: number;
  detectedFiles: string[];
  warnings: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Tier 1 Feature 7: One-Click Deployment Types
// ---------------------------------------------------------------------------

export type DeploymentStatus =
  | 'idle'
  | 'validating'
  | 'building'
  | 'packaging'
  | 'uploading'
  | 'deploying'
  | 'live'
  | 'failed'
  | 'cancelled';

export type DeploymentProviderId = 'netlify' | 'mock' | string;

// ---------------------------------------------------------------------------
// Tier 1 Feature 8: Canonical Environment Variable & Secrets Manager Types
// ---------------------------------------------------------------------------

export interface EnvVarMetadata {
  id: string;
  key: string;              // Normalized identifier (e.g. "VITE_API_URL" or "DATABASE_URL")
  isSecret: boolean;        // True for sensitive credentials/keys; false for public Vite bundle variables
  isClientVisible: boolean; // True for VITE_* variables bundled into client code
  description?: string;     // Optional developer documentation of the variable's purpose
  updatedAt: number;        // Epoch timestamp of last update
}

export interface ProjectEnvVar extends EnvVarMetadata {
  value: string;            // Ephemeral memory-only value (never stored in persisted metadata)
}

export interface EnvImportResult {
  successCount: number;
  ignoredCount: number;
  errors: string[];
  importedKeys: string[];
}

export interface DeploymentEnvVar {
  id: string;
  key: string;       // e.g. "DATABASE_URL" or "VITE_API_ENDPOINT"
  value: string;     // Memory-only value
  isSecret: boolean; // Flags whether value is sensitive provider secret vs public config
}

// Whitelisted non-sensitive metadata persisted in history
export interface DeploymentRecord {
  deploymentId: string;
  projectId: string;
  timestamp: number;
  status: 'live' | 'failed' | 'cancelled';
  provider: DeploymentProviderId;
  url?: string;
  deployId?: string;
  siteId?: string;
  durationMs: number;
  buildDurationMs?: number;
  fileCount: number;
  artifactSizeBytes: number;
  commitSummary?: string;
  errorMessage?: string; // Sanitized, redacted error string only
}

export interface DeploymentConfig {
  provider: DeploymentProviderId;
  siteName?: string;
  siteId?: string;
  envVarKeys: string[];
  customBuildDir?: string;
}

export interface ArtifactPackageResult {
  zipBuffer: Uint8Array;
  fileCount: number;
  uncompressedBytes: number;
  compressedBytes: number;
  entryFile: string;
}

export * from './database';

