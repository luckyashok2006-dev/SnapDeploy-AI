import { ExecutionEvidence } from '../../types/workspace';

/**
 * Classifies whether an execution failure is eligible for automated AI Self-Healing.
 * 
 * Rules:
 * - Must be an actual failure (nonzero exitCode or timedOut === true).
 * - Application/runtime/build/verification commands are eligible:
 *   - npm run build, npm run dev, npm start, npm test, npm install, etc.
 *   - tsc, npx tsc, typescript compilation
 *   - vite, vitest, webpack, rollup, esbuild
 *   - node <script> runtime errors
 *   - test/build timeouts
 * - Developer exploration and non-application commands are strictly INELIGIBLE:
 *   - git (status, log, diff, etc.)
 *   - shell utilities (ls, dir, cat, echo, grep, find, pwd, cd, rm, mkdir, curl, etc.)
 *   - arbitrary typos or unknown commands (e.g. 'asdf', 'foo')
 */
export function isEligibleForAutoRepair(
  command: string,
  args: string[] = [],
  exitCode: number | null = null,
  timedOut: boolean = false,
  _evidence?: ExecutionEvidence
): boolean {
  // If exitCode is 0 and not timedOut, it is not a failure
  const isFailure = (exitCode !== null && exitCode !== 0) || timedOut;
  if (!isFailure) return false;

  const cmd = (command || '').trim().toLowerCase();
  const argString = (args || []).join(' ').toLowerCase();
  const fullCmd = `${cmd} ${argString}`.trim();

  // 1. Explicitly blacklist standard CLI developer inspection/filesystem/vcs tools
  const blacklistedCommands = [
    'git', 'ls', 'dir', 'cat', 'echo', 'grep', 'find', 'pwd', 'cd',
    'which', 'where', 'clear', 'cls', 'rm', 'rmdir', 'mkdir', 'touch',
    'curl', 'wget', 'ping', 'whoami', 'man', 'less', 'more', 'head', 'tail'
  ];
  if (blacklistedCommands.includes(cmd)) {
    return false;
  }

  // 2. npm script invocations
  if (cmd === 'npm') {
    const eligibleNpmArgs = [
      'run build', 'run dev', 'run start', 'run test', 'run check',
      'run lint', 'run typecheck', 'start', 'test', 'build', 'install', 'ci'
    ];
    if (eligibleNpmArgs.some((arg) => argString.includes(arg))) {
      return true;
    }
    // Arbitrary unknown npm command (e.g. npm config, npm login, npm whoami)
    return false;
  }

  // 3. npx invocations
  if (cmd === 'npx') {
    const eligibleNpxArgs = [
      'tsc', 'vite', 'vitest', 'typescript', 'eslint', 'jest', 'webpack'
    ];
    if (eligibleNpxArgs.some((arg) => argString.includes(arg))) {
      return true;
    }
    return false;
  }

  // 4. Standalone tool and runtime runners
  const eligibleStandaloneRunners = [
    'tsc', 'vite', 'vitest', 'node', 'webpack', 'rollup', 'esbuild', 'jest'
  ];
  if (eligibleStandaloneRunners.includes(cmd)) {
    return true;
  }

  // 5. Explicit verification pipeline commands
  if (fullCmd.includes('tsc') || fullCmd.includes('build') || fullCmd.includes('test')) {
    return true;
  }

  // Arbitrary typos (asdf, unknown binaries) are not eligible
  return false;
}
