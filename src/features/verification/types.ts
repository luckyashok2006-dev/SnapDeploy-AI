import { VerificationCheck as BaseVerificationCheck, VerificationResult } from '../../types/workspace';

export type CheckStatus = 'passed' | 'failed' | 'timeout';

export interface VerificationCheck extends BaseVerificationCheck {
  name: string;
  success: boolean;
  status?: CheckStatus;
  command?: string;
  exitCode?: number | null;
  output?: string;
  durationMs?: number;
  timedOut?: boolean;
}

export type { VerificationResult };

export interface CheckRunner {
  name: string;
  run(): Promise<VerificationCheck>;
}
