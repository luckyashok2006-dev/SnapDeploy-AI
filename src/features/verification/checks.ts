import { VerificationCheck, CheckStatus } from './types';
import { runtimeManager } from '../../lib/runtime/runtime-manager';

export function evaluateCheck(
  name: string,
  command: string,
  evidence: { exitCode: number | null; stdout: string; stderr: string; timedOut?: boolean; durationMs: number },
  start: number
): VerificationCheck {
  const isTimedOut = !!evidence.timedOut;
  const isPassed = evidence.exitCode === 0 && !isTimedOut;
  const status: CheckStatus = isTimedOut ? 'timeout' : isPassed ? 'passed' : 'failed';
  const rawOutput = (evidence.stdout + '\n' + evidence.stderr).trim();
  const output = isTimedOut
    ? `[TIMEOUT] Process timed out after ${evidence.durationMs}ms: ${command}\n${rawOutput}`.trim()
    : rawOutput;

  return {
    name,
    command,
    exitCode: evidence.exitCode,
    success: isPassed,
    status,
    timedOut: isTimedOut,
    output,
    durationMs: evidence.durationMs || (Date.now() - start)
  };
}

export async function checkTypeScript(): Promise<VerificationCheck> {
  const start = Date.now();
  const command = 'npx --no-install tsc --noEmit';
  try {
    const evidence = await runtimeManager.runTypeScriptCheck();
    return evaluateCheck('TypeScript Compilation', command, evidence, start);
  } catch (err: any) {
    return {
      name: 'TypeScript Compilation',
      command,
      exitCode: 1,
      success: false,
      status: 'failed',
      timedOut: false,
      output: err?.message || 'Failed to run TypeScript check',
      durationMs: Date.now() - start
    };
  }
}

export async function checkBuild(): Promise<VerificationCheck> {
  const start = Date.now();
  const command = 'npm run build';
  try {
    const evidence = await runtimeManager.runBuild();
    return evaluateCheck('Production Build', command, evidence, start);
  } catch (err: any) {
    return {
      name: 'Production Build',
      command,
      exitCode: 1,
      success: false,
      status: 'failed',
      timedOut: false,
      output: err?.message || 'Failed to run production build',
      durationMs: Date.now() - start
    };
  }
}

export async function checkDependencies(): Promise<VerificationCheck> {
  const start = Date.now();
  const command = 'npm install';
  try {
    const evidence = await runtimeManager.installDependencies();
    return evaluateCheck('Dependency Installation', command, evidence, start);
  } catch (err: any) {
    return {
      name: 'Dependency Installation',
      command,
      exitCode: 1,
      success: false,
      status: 'failed',
      timedOut: false,
      output: err?.message || 'Failed to install dependencies',
      durationMs: Date.now() - start
    };
  }
}

export async function checkTests(): Promise<VerificationCheck> {
  const start = Date.now();
  const command = 'npm test';
  try {
    const evidence = await runtimeManager.runTests();
    return evaluateCheck('Automated Tests', command, evidence, start);
  } catch (err: any) {
    return {
      name: 'Automated Tests',
      command,
      exitCode: 1,
      success: false,
      status: 'failed',
      timedOut: false,
      output: err?.message || 'Failed to run automated tests',
      durationMs: Date.now() - start
    };
  }
}

