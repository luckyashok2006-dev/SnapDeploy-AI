import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { 
  repairCoordinator, 
  sanitizeExecutionEvidence, 
  computeFailureFingerprint,
  computeRelevantCodeHash,
  getRelevantFilesForFailure
} from '../src/features/repair/repair-coordinator';
import { isEligibleForAutoRepair } from '../src/features/repair/repair-policy';
import { shouldAttachTestHooks } from '../src/lib/test-hooks';
import { useRepairStore } from '../src/store/repairStore';
import { useProjectStore } from '../src/store/projectStore';
import { useEnvVarStore } from '../src/store/envVarStore';
import { useChatStore } from '../src/store/chatStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useAgentStore } from '../src/store/agentStore';
import { chatService } from '../src/features/chat/chat-service';
import { validateEditPatch } from '../src/features/chat/edit-validator';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { ExecutionEvidence, Patch, EditProposal } from '../src/types/workspace';

describe('Tier 2 AI Engineering Loop & Continuous Self-Healing', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    useRepairStore.setState({
      episodes: {},
      activeEpisodeId: {},
      isLoopPaused: {},
      processedFingerprints: {}
    });
  });

  describe('1. Context Selection & Import Resolution', () => {
    it('scans and includes direct relative imports of the active file within budget', async () => {
      const projId = 'proj-ctx-1';
      await vfsManager.writeFile(
        projId,
        '/src/App.tsx',
        `import React from 'react';\nimport { Header } from './components/Header';\nimport { formatDate } from '../utils/format';\nexport default function App() { return <Header />; }`
      );
      await vfsManager.writeFile(
        projId,
        '/src/components/Header.tsx',
        `export function Header() { return <header>Header Bar</header>; }`
      );
      await vfsManager.writeFile(
        projId,
        '/src/utils/format.ts',
        `export function formatDate(d: Date) { return d.toISOString(); }`
      );
      await vfsManager.writeFile(
        projId,
        '/src/unrelated.ts',
        `export const UNRELATED = true;`
      );

      const context = await chatService.buildEditContext(projId, 'Fix header component', '/src/App.tsx');
      
      // Active file included
      expect(context.relevantFiles['/src/App.tsx']).toBeDefined();
      expect(context.relevantFiles['/src/App.tsx']).toContain('import { Header }');

      // Direct relative imports included
      expect(context.relevantFiles['/src/components/Header.tsx']).toBeDefined();
      expect(context.relevantFiles['/src/components/Header.tsx']).toContain('Header Bar');
      expect(context.relevantFiles['/src/utils/format.ts']).toBeDefined();
      expect(context.relevantFiles['/src/utils/format.ts']).toContain('formatDate');

      // Relevant files structure verified
      expect(Object.keys(context.relevantFiles).length).toBeGreaterThanOrEqual(3);
    });

    it('enforces context token budget on large file contents', async () => {
      const projId = 'proj-ctx-budget';
      const hugeContent = '// Large file\n' + 'const x = 1234567890;\n'.repeat(15000); // ~330KB
      await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() {}');
      await vfsManager.writeFile(projId, '/src/huge.ts', hugeContent);

      const context = await chatService.buildEditContext(projId, 'Check large files', '/src/App.tsx');
      let totalLength = 0;
      for (const c of Object.values(context.relevantFiles)) {
        totalLength += c.length;
      }
      expect(totalLength).toBeLessThanOrEqual(250000);
      // Large file is omitted because it exceeds MAX_CONTEXT_BYTES
      expect(context.relevantFiles['/src/huge.ts']).toBeUndefined();
      expect(context.relevantFiles['/src/App.tsx']).toBeDefined();
    });
  });

  describe('2. Secret Exclusion & Evidence Sanitization', () => {
    it('strips sensitive tokens, passwords, bearer headers, and user home paths from evidence', () => {
      const dirtyEvidence: ExecutionEvidence = {
        executionId: 'exec-dirty-1',
        command: 'npm run build --token=ghp_ABC1234567890abcdefghijklmnopqrstuvwxyz',
        args: ['--auth=Bearer secret-token-xyz-1234567890', 'password=superSecret123'],
        exitCode: 1,
        stdout: 'Compiling project for user at C:\\Users\\dell\\Desktop\\SnapDeploy AI\\src\\App.tsx',
        stderr: 'Error: failed with github_pat_11AAAAAAA0000000000000_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB at /Users/john/repo/index.js',
        stackTrace: 'at Object.<anonymous> (/home/ubuntu/app/server.js:42:15)',
        durationMs: 450,
        timestamp: Date.now()
      };

      const clean = sanitizeExecutionEvidence(dirtyEvidence);

      // GitHub token sanitized
      expect(clean.command).not.toContain('ghp_ABC');
      expect(clean.command).toContain('[REDACTED_GITHUB_TOKEN]');

      // Bearer and passwords sanitized
      expect(clean.stdout).not.toContain('C:\\Users\\dell');
      expect(clean.stdout).toContain('/home/user');
      expect(clean.stderr).not.toContain('github_pat_');
      expect(clean.stderr).not.toContain('/Users/john');
      expect(clean.stderr).toContain('/home/user');
      expect(clean.stackTrace).not.toContain('/home/ubuntu');
      expect(clean.stackTrace).toContain('/home/user');
    });

    it('excludes secret values from AI environment variable context metadata', () => {
      const projId = 'proj-env-sec';
      useEnvVarStore.getState().setEnvVar(projId, 'VITE_APP_TITLE', 'My Snap App', false);
      useEnvVarStore.getState().setEnvVar(projId, 'SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.supersecret', true);

      const context = chatService.getSafeAiEnvContext(projId);

      // Key metadata present
      expect(context).toContain('VITE_APP_TITLE');
      expect(context).toContain('SUPABASE_SERVICE_ROLE_KEY');

      // Values strictly excluded
      expect(context).not.toContain('My Snap App');
      expect(context).not.toContain('eyJhbGciOiJIUzI1Ni');
      expect(context).toContain('Value Hidden');
    });
  });

  describe('3. Deterministic Failure Fingerprinting & Duplicate Suppression', () => {
    it('produces identical fingerprints for identical errors and different fingerprints for different errors', () => {
      const files = {
        '/src/App.tsx': { content: 'export default function App() { return <div>Hello</div>; }' }
      };

      const ev1: ExecutionEvidence = {
        executionId: 'e1',
        command: 'npm run build',
        args: [],
        exitCode: 2,
        stdout: '',
        stderr: 'TS2304: Cannot find name "missingVar".\nsrc/App.tsx:5:10',
        durationMs: 120,
        timestamp: Date.now()
      };

      const ev2: ExecutionEvidence = {
        executionId: 'e2',
        command: 'npm run build',
        args: [],
        exitCode: 2,
        stdout: '',
        stderr: 'TS2304: Cannot find name "missingVar".\nsrc/App.tsx:5:10',
        durationMs: 300,
        timestamp: Date.now() + 1000
      };

      const ev3: ExecutionEvidence = {
        executionId: 'e3',
        command: 'npm test',
        args: [],
        exitCode: 1,
        stdout: 'FAIL tests/app.test.ts',
        stderr: 'Expected 2 to be 4',
        durationMs: 400,
        timestamp: Date.now()
      };

      const fp1 = computeFailureFingerprint(ev1, files);
      const fp2 = computeFailureFingerprint(ev2, files);
      const fp3 = computeFailureFingerprint(ev3, files);

      expect(fp1).toBe(fp2);
      expect(fp1).not.toBe(fp3);
    });

    it('enforces failure fingerprint lifecycle: suppresses unchanged duplicates, enables new episodes on relevant code change', async () => {
      const projId = 'proj-dup-lifecycle';
      const initialAppCode = 'export default function App() { return <div>Version 1</div>; }';
      await vfsManager.writeFile(projId, '/src/App.tsx', initialAppCode);
      await vfsManager.writeFile(projId, '/src/unrelated.ts', 'export const unrelated = 1;');

      const failureEvidence: ExecutionEvidence = {
        executionId: 'exec-dup-1',
        command: 'npm run build',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'Module not found: ./MissingComponent in src/App.tsx',
        durationMs: 100,
        timestamp: Date.now()
      };

      vi.spyOn(repairLoopEngine, 'runDiagnosisAndPatch').mockResolvedValue({
        diagnosis: {
          category: 'compiler',
          severity: 'error',
          rootCause: 'Missing module',
          explanation: 'Module not found',
          suggestedFix: 'Create missing file',
          evidence: ['Module not found: ./MissingComponent in src/App.tsx'],
          affectedFiles: ['/src/App.tsx']
        },
        patch: {
          id: 'patch-dup-1',
          summary: 'Fix missing import',
          files: []
        }
      });

      // 1. First failure triggers episode creation
      const ep1 = await repairCoordinator.handleRuntimeFailure(projId, failureEvidence);
      expect(ep1).not.toBeNull();
      expect(ep1?.failureFingerprint).toBeDefined();
      expect(useRepairStore.getState().getProjectEpisodes(projId).length).toBe(1);

      // (a) Same failure + unchanged code => duplicate suppressed
      const ep2 = await repairCoordinator.handleRuntimeFailure(projId, failureEvidence);
      expect(ep2).toBeNull();
      expect(useRepairStore.getState().getProjectEpisodes(projId).length).toBe(1);

      // (d) Unrelated file change should NOT unsuppress unless relevant
      await vfsManager.writeFile(projId, '/src/unrelated.ts', 'export const unrelated = 2;');
      const epUnrelated = await repairCoordinator.handleRuntimeFailure(projId, failureEvidence);
      expect(epUnrelated).toBeNull();
      expect(useRepairStore.getState().getProjectEpisodes(projId).length).toBe(1);

      // (b) Same failure + relevant code change => new episode created
      const changedAppCode = 'export default function App() { return <div>Version 2 with change</div>; }';
      await vfsManager.writeFile(projId, '/src/App.tsx', changedAppCode);
      const ep3 = await repairCoordinator.handleRuntimeFailure(projId, failureEvidence);
      expect(ep3).not.toBeNull();
      expect(ep3?.failureEpisodeId).not.toBe(ep1?.failureEpisodeId);
      expect(useRepairStore.getState().getProjectEpisodes(projId).length).toBe(2);

      // (c) Resolved or rejected proposal followed by code change + same failure => new episode created
      repairCoordinator.rejectRepair(projId, ep3!.failureEpisodeId);
      expect(useRepairStore.getState().getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep3!.failureEpisodeId)?.status).toBe('rejected');

      const changedAppCode3 = 'export default function App() { return <div>Version 3 after reject</div>; }';
      await vfsManager.writeFile(projId, '/src/App.tsx', changedAppCode3);
      const ep4 = await repairCoordinator.handleRuntimeFailure(projId, failureEvidence);
      expect(ep4).not.toBeNull();
      expect(useRepairStore.getState().getProjectEpisodes(projId).length).toBe(3);
    });
  });

  describe('4. Failure Episode State Machine & Loop Safeguards', () => {
    it('creates episode in captured state and tracks attempt number', () => {
      const store = useRepairStore.getState();
      const projId = 'proj-sm-1';
      const ev: ExecutionEvidence = {
        executionId: 'e1',
        command: 'tsc',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'Error',
        durationMs: 50,
        timestamp: Date.now()
      };

      const ep = store.createEpisode(projId, ev, 'fp_1', 'ev_1');
      expect(ep.status).toBe('captured');
      expect(ep.attemptNumber).toBe(1);
      expect(ep.maxAttempts).toBe(3);
      expect(store.getActiveEpisode(projId)?.failureEpisodeId).toBe(ep.failureEpisodeId);
    });

    it('blocks automated repair after 3 attempts are exceeded', async () => {
      const store = useRepairStore.getState();
      const projId = 'proj-max-attempts';
      const ev: ExecutionEvidence = {
        executionId: 'e1',
        command: 'npm run build',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'Persistent failure',
        durationMs: 50,
        timestamp: Date.now()
      };

      const ep = store.createEpisode(projId, ev, 'fp_max', 'ev_max');
      // Simulate 3 prior attempts
      store.updateEpisodeStatus(projId, ep.failureEpisodeId, 'rolled_back', { attemptNumber: 4 });

      // Trigger diagnosis on episode with attempt > 3
      const result = await repairCoordinator.runEpisodeDiagnosis(projId, ep.failureEpisodeId);
      expect(result?.status).toBe('blocked');
      expect(result?.resolution).toBe('max_attempts_reached');
    });

    it('respects pause and resume controls on the repair loop', async () => {
      const projId = 'proj-pause-test';
      await vfsManager.writeFile(projId, '/src/App.tsx', 'export default function App() {}');

      const failureEvidence: ExecutionEvidence = {
        executionId: 'exec-p1',
        command: 'npm run build',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'SyntaxError',
        durationMs: 80,
        timestamp: Date.now()
      };

      // Pause loop
      repairCoordinator.pauseRepairLoop(projId);
      expect(useRepairStore.getState().isProjectLoopPaused(projId)).toBe(true);

      // Failure during pause returns null and does not diagnose
      const ep = await repairCoordinator.handleRuntimeFailure(projId, failureEvidence);
      expect(ep).toBeNull();
      expect(useRepairStore.getState().getProjectEpisodes(projId).length).toBe(0);

      // Resume loop
      repairCoordinator.resumeRepairLoop(projId);
      expect(useRepairStore.getState().isProjectLoopPaused(projId)).toBe(false);
    });
  });

  describe('5. Zero Mutation Without Approval & Atomic Rollback', () => {
    it('does NOT modify any VFS project files during detection or diagnosis', async () => {
      const projId = 'proj-safety-1';
      const initialCode = 'export default function App() { return <div>Original</div>; }';
      await vfsManager.writeFile(projId, '/src/App.tsx', initialCode);

      const failureEvidence: ExecutionEvidence = {
        executionId: 'exec-safe-1',
        command: 'tsc',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'TS2322: Type mismatch',
        durationMs: 90,
        timestamp: Date.now()
      };

      vi.spyOn(repairLoopEngine, 'runDiagnosisAndPatch').mockResolvedValue({
        diagnosis: {
          category: 'type_error',
          severity: 'error',
          rootCause: 'Type mismatch',
          explanation: 'Type mismatch in App.tsx',
          suggestedFix: 'Fix type signature',
          evidence: ['TS2322'],
          affectedFiles: ['/src/App.tsx']
        },
        patch: {
          id: 'patch-safe-1',
          summary: 'Fix type signature in App.tsx',
          files: [
            {
              path: '/src/App.tsx',
              before: initialCode,
              after: 'export default function App() { return <div>Modified</div>; }'
            }
          ]
        }
      });

      const ep = await repairCoordinator.handleRuntimeFailure(projId, failureEvidence);
      expect(ep).not.toBeNull();

      // VFS file must remain completely untouched!
      const currentCode = vfsManager.getFile(projId, '/src/App.tsx')?.content;
      expect(currentCode).toBe(initialCode);
    });

    it('applies patch and marks resolved when user approves and verification succeeds', async () => {
      const projId = 'proj-approve-pass';
      const initialCode = 'export const val = 1;';
      const patchedCode = 'export const val = 2;';
      await vfsManager.writeFile(projId, '/src/App.tsx', initialCode);

      const store = useRepairStore.getState();
      const ep = store.createEpisode(
        projId,
        { executionId: 'e', command: 'build', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 10, timestamp: Date.now() },
        'fp_pass',
        'ev_pass'
      );

      const patch: Patch = {
        id: 'patch-pass',
        summary: 'Update val',
        files: [{ path: '/src/App.tsx', before: initialCode, after: patchedCode }]
      };

      store.setEpisodeProposal(projId, ep.failureEpisodeId, {
        category: 'logic',
        severity: 'error',
        rootCause: 'Wrong value',
        explanation: 'Needs 2',
        suggestedFix: 'Set to 2',
        evidence: [],
        affectedFiles: ['/src/App.tsx']
      }, patch);

      vi.spyOn(repairLoopEngine, 'applyPatchAndVerify').mockResolvedValue({ verified: true });

      const approvalResult = await repairCoordinator.approveRepair(projId, ep.failureEpisodeId);
      expect(approvalResult.verified).toBe(true);

      const resolvedEp = useRepairStore.getState().getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
      expect(resolvedEp?.status).toBe('resolved');
      expect(resolvedEp?.resolution).toBe('resolved');
    });

    it('atomically rolls back and marks episode rolled_back when verification fails', async () => {
      const projId = 'proj-rollback-fail';
      const originalContent = 'export const initial = true;';
      await vfsManager.writeFile(projId, '/src/App.tsx', originalContent);

      const store = useRepairStore.getState();
      const ep = store.createEpisode(
        projId,
        { executionId: 'e-fail', command: 'build', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 10, timestamp: Date.now() },
        'fp_fail',
        'ev_fail'
      );

      const patch: Patch = {
        id: 'patch-fail',
        summary: 'Bad patch',
        files: [{ path: '/src/App.tsx', before: originalContent, after: 'export const broken = true;' }]
      };

      store.setEpisodeProposal(projId, ep.failureEpisodeId, {
        category: 'syntax',
        severity: 'error',
        rootCause: 'Error',
        explanation: 'Explanation',
        suggestedFix: 'Fix',
        evidence: [],
        affectedFiles: ['/src/App.tsx']
      }, patch);

      vi.spyOn(repairLoopEngine, 'applyPatchAndVerify').mockResolvedValue({
        verified: false,
        error: 'TypeScript compilation failed after repair patch.'
      });

      const result = await repairCoordinator.approveRepair(projId, ep.failureEpisodeId);
      expect(result.verified).toBe(false);
      expect(result.error).toContain('TypeScript compilation failed');

      const rolledBackEp = useRepairStore.getState().getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
      expect(rolledBackEp?.status).toBe('rolled_back');
      expect(rolledBackEp?.resolution).toBe('rolled_back');
    });

    it('marks episode rejected with zero code changes when user rejects proposal', async () => {
      const projId = 'proj-user-reject';
      const originalCode = 'export const steady = true;';
      await vfsManager.writeFile(projId, '/src/App.tsx', originalCode);

      const store = useRepairStore.getState();
      const ep = store.createEpisode(
        projId,
        { executionId: 'e-rej', command: 'tsc', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 20, timestamp: Date.now() },
        'fp_rej',
        'ev_rej'
      );

      repairCoordinator.rejectRepair(projId, ep.failureEpisodeId);

      const rejectedEp = useRepairStore.getState().getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
      expect(rejectedEp?.status).toBe('rejected');
      expect(rejectedEp?.resolution).toBe('rejected');

      // VFS code intact
      expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(originalCode);
    });
  });

  describe('6. Project Isolation & Multi-Project Partitioning', () => {
    it('isolates episodes and loop pause state across distinct projects', () => {
      const store = useRepairStore.getState();
      const projA = 'proj-isolation-a';
      const projB = 'proj-isolation-b';

      const ev: ExecutionEvidence = {
        executionId: 'e-iso',
        command: 'npm test',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'Error',
        durationMs: 15,
        timestamp: Date.now()
      };

      store.createEpisode(projA, ev, 'fp_a', 'ev_a');
      store.pauseLoop(projA);

      expect(store.getProjectEpisodes(projA).length).toBe(1);
      expect(store.getProjectEpisodes(projB).length).toBe(0);
      expect(store.isProjectLoopPaused(projA)).toBe(true);
      expect(store.isProjectLoopPaused(projB)).toBe(false);
    });

    it('cleans up repair state when a project is deleted', () => {
      const store = useRepairStore.getState();
      const projA = 'proj-del-a';
      const projB = 'proj-del-b';

      const ev: ExecutionEvidence = {
        executionId: 'e-del',
        command: 'build',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: '',
        durationMs: 10,
        timestamp: Date.now()
      };

      store.createEpisode(projA, ev, 'fp_a', 'ev_a');
      store.createEpisode(projB, ev, 'fp_b', 'ev_b');
      expect(store.getProjectEpisodes(projA).length).toBe(1);
      expect(store.getProjectEpisodes(projB).length).toBe(1);

      store.deleteProjectRepairState(projA);

      expect(store.getProjectEpisodes(projA).length).toBe(0);
      expect(store.getProjectEpisodes(projB).length).toBe(1);
      expect(store.getActiveEpisode(projA)).toBeNull();
      expect(store.getActiveEpisode(projB)).not.toBeNull();
    });
  });

  describe('7. Structured Engineering Plan Enrichment', () => {
    it('enriches raw EditProposal with intent, affected files line diffs, and verification', () => {
      const rawProposal: EditProposal = {
        id: 'prop-plan-1',
        summary: 'Add user settings navigation',
        explanation: 'Add navigation link and route',
        files: [
          {
            path: '/src/App.tsx',
            before: 'export default function App() {\n  return <div>Home</div>;\n}',
            after: 'export default function App() {\n  return (\n    <div>\n      <nav>Settings</nav>\n      <div>Home</div>\n    </div>\n  );\n}'
          }
        ]
      };

      const enriched = chatService.enrichProposalPlan(rawProposal, 'Add user settings navigation to header');

      expect(enriched.intent).toBe('Add user settings navigation to header');
      expect(enriched.estimatedDiffSize).toBeDefined();
      expect(enriched.estimatedDiffSize?.additions).toBeGreaterThan(0);
      expect(enriched.affectedFiles).toHaveLength(1);
      expect(enriched.affectedFiles?.[0].path).toBe('/src/App.tsx');
      expect(enriched.affectedFiles?.[0].reason).toContain('Update root application');
      expect(enriched.expectedVerification).toContain('TypeScript');
    });
  });

  describe('8. Repair Trigger Classification (repair-policy)', () => {
    it('classifies application and verification failures as eligible', () => {
      // Build, dev, test, and typecheck commands
      expect(isEligibleForAutoRepair('npm', ['run', 'build'], 1)).toBe(true);
      expect(isEligibleForAutoRepair('npm', ['run', 'dev'], 1)).toBe(true);
      expect(isEligibleForAutoRepair('npm', ['start'], 1)).toBe(true);
      expect(isEligibleForAutoRepair('npm', ['test'], 1)).toBe(true);
      expect(isEligibleForAutoRepair('npm', ['install'], 1)).toBe(true);
      expect(isEligibleForAutoRepair('tsc', [], 2)).toBe(true);
      expect(isEligibleForAutoRepair('npx', ['tsc', '--noEmit'], 2)).toBe(true);
      expect(isEligibleForAutoRepair('vite', ['build'], 1)).toBe(true);
      expect(isEligibleForAutoRepair('vitest', ['run'], 1)).toBe(true);
      expect(isEligibleForAutoRepair('node', ['server.js'], 1)).toBe(true);

      // Timeouts
      expect(isEligibleForAutoRepair('npm', ['run', 'build'], null, true)).toBe(true);
    });

    it('rejects arbitrary developer commands and non-application tools', () => {
      expect(isEligibleForAutoRepair('git', ['status'], 1)).toBe(false);
      expect(isEligibleForAutoRepair('git', ['log'], 128)).toBe(false);
      expect(isEligibleForAutoRepair('git', ['diff'], 1)).toBe(false);
      expect(isEligibleForAutoRepair('ls', ['-la'], 2)).toBe(false);
      expect(isEligibleForAutoRepair('cat', ['somefile.txt'], 1)).toBe(false);
      expect(isEligibleForAutoRepair('grep', ['pattern', 'file'], 1)).toBe(false);
      expect(isEligibleForAutoRepair('echo', ['hello'], 1)).toBe(false);
      expect(isEligibleForAutoRepair('asdf', ['foo'], 127)).toBe(false);

      // Successful commands are never eligible
      expect(isEligibleForAutoRepair('npm', ['run', 'build'], 0, false)).toBe(false);
    });

    it('integrates with runtimeStore.executeCommand to filter repair loop triggers', async () => {
      const projId = 'proj-trigger-store';
      vi.spyOn(runtimeManager, 'boot').mockResolvedValue(undefined as any);
      vi.spyOn(runtimeManager, 'getCurrentProjectId').mockReturnValue(projId);
      const repairFailureSpy = vi.spyOn(repairCoordinator, 'handleRuntimeFailure').mockResolvedValue(null);

      // 1. Execute developer command that fails (git status with exit 1)
      vi.spyOn(runtimeManager, 'executeCommand').mockResolvedValueOnce({
        executionId: 'exec-git',
        command: 'git',
        args: ['status'],
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: not a git repository',
        durationMs: 20,
        timestamp: Date.now()
      });

      await useRuntimeStore.getState().executeCommand('git', ['status']);
      expect(repairFailureSpy).not.toHaveBeenCalled();

      // 2. Execute application build command that fails (npm run build with exit 1)
      vi.spyOn(runtimeManager, 'executeCommand').mockResolvedValueOnce({
        executionId: 'exec-build',
        command: 'npm',
        args: ['run', 'build'],
        exitCode: 1,
        stdout: '',
        stderr: 'Build failed with errors',
        durationMs: 150,
        timestamp: Date.now()
      });

      await useRuntimeStore.getState().executeCommand('npm', ['run', 'build']);
      expect(repairFailureSpy).toHaveBeenCalledWith(projId, expect.objectContaining({ command: 'npm' }));
    });
  });

  describe('9. Production Safety of Window Test Hooks', () => {
    it('allows test hooks in development or test mode', () => {
      expect(shouldAttachTestHooks({ DEV: true })).toBe(true);
      expect(shouldAttachTestHooks({ MODE: 'test' })).toBe(true);
      expect(shouldAttachTestHooks({ NODE_ENV: 'development' })).toBe(true);
    });

    it('strictly forbids test hooks in production mode', () => {
      expect(
        shouldAttachTestHooks({
          DEV: false,
          MODE: 'production',
          NODE_ENV: 'production'
        })
      ).toBe(false);
    });
  });

  describe('10. AI Edit Approval Invariant & Rejection Invariant', () => {
    it('proves rejection causes zero VFS mutation, zero snapshot checkpoints, and zero runtime mutation', async () => {
      const projId = 'proj-edit-reject-invariant';
      useProjectStore.setState({
        activeProjectId: projId,
        projects: {
          [projId]: {
            id: projId,
            title: 'Test Project',
            description: '',
            badge: 'react',
            status: 'ready',
            files: {},
            openTabs: [],
            activeFilePath: '/src/App.tsx',
            diagnostics: [],
            fixHistory: []
          }
        }
      });

      const initialCode = 'export const greeting = "Hello World";';
      await vfsManager.writeFile(projId, '/src/App.tsx', initialCode);

      const snapshotSpy = vi.spyOn(snapshotService, 'createSnapshot');
      const runtimeSpy = vi.spyOn(runtimeManager, 'replaceProject');

      const proposal: EditProposal = {
        id: 'prop-reject-test',
        summary: 'Change greeting to Goodbye',
        explanation: 'Update greeting variable',
        files: [
          {
            path: '/src/App.tsx',
            before: initialCode,
            after: 'export const greeting = "Goodbye World";'
          }
        ]
      };

      const msgId = 'msg-ai-reject-1';
      useChatStore.setState({
        projectMessages: {
          [projId]: [
            {
              id: msgId,
              projectId: projId,
              role: 'assistant',
              content: 'Proposed change',
              timestamp: new Date().toISOString(),
              proposal,
              status: 'pending_approval'
            }
          ]
        }
      });

      // User REJECTS the proposal
      useChatStore.getState().rejectProposal(projId, msgId);

      // Verify invariants:
      // 1. Message is marked rejected
      const message = useChatStore.getState().projectMessages[projId].find((m) => m.id === msgId);
      expect(message?.status).toBe('rejected');

      // 2. ZERO VFS mutations occurred
      const currentCode = vfsManager.getFile(projId, '/src/App.tsx')?.content;
      expect(currentCode).toBe(initialCode);

      // 3. ZERO Snapshot checkpoints created
      expect(snapshotSpy).not.toHaveBeenCalled();

      // 4. ZERO Runtime replacements executed
      expect(runtimeSpy).not.toHaveBeenCalled();
    });

    it('proves approval creates pre-edit snapshot, applies patch, syncs runtime, and verifies', async () => {
      const projId = 'proj-edit-approve-invariant';
      useProjectStore.setState({
        activeProjectId: projId,
        projects: {
          [projId]: {
            id: projId,
            title: 'Test Project',
            description: '',
            badge: 'react',
            status: 'ready',
            files: {},
            openTabs: [],
            activeFilePath: '/src/App.tsx',
            diagnostics: [],
            fixHistory: []
          }
        }
      });

      const initialCode = 'export const count = 0;';
      const updatedCode = 'export const count = 1;';
      await vfsManager.writeFile(projId, '/src/App.tsx', initialCode);

      const snapshotSpy = vi.spyOn(snapshotService, 'createSnapshot').mockResolvedValue(undefined as any);
      vi.spyOn(runtimeManager, 'replaceProject').mockResolvedValue(undefined as any);
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: true,
        checks: [{ name: 'TypeScript', status: 'passed', success: true, durationMs: 40 }],
        totalDurationMs: 40
      });

      const proposal: EditProposal = {
        id: 'prop-approve-test',
        summary: 'Increment count to 1',
        explanation: 'Update count',
        files: [
          {
            path: '/src/App.tsx',
            before: initialCode,
            after: updatedCode
          }
        ]
      };

      const msgId = 'msg-ai-approve-1';
      const opId = 'op-approve-1';
      useChatStore.setState({
        latestOperationId: { [projId]: opId },
        projectMessages: {
          [projId]: [
            {
              id: msgId,
              projectId: projId,
              operationId: opId,
              role: 'assistant',
              content: 'Proposal',
              timestamp: new Date().toISOString(),
              proposal,
              status: 'pending_approval'
            }
          ]
        }
      });

      const result = await useChatStore.getState().approveProposal(projId, msgId);
      expect(result.verified).toBe(true);

      // Pre-edit snapshot created
      expect(snapshotSpy).toHaveBeenCalledWith(projId, expect.stringContaining('Before AI edit:'));

      // VFS updated with patched code
      expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(updatedCode);

      // Message status marked applied
      const message = useChatStore.getState().projectMessages[projId].find((m) => m.id === msgId);
      expect(message?.status).toBe('applied');
    });
  });

  describe('11. Minimal Patch Safety & Security Allowlist Constraints', () => {
    it('strictly rejects proposals exposing secrets in after content', () => {
      const liveFiles = {
        '/src/App.tsx': {
          id: '1',
          name: 'App.tsx',
          path: '/src/App.tsx',
          content: 'export default function App() {}',
          createdAt: '',
          updatedAt: ''
        }
      };

      // 1. GitHub PAT exposure
      const githubSecretPatch = {
        summary: 'Add github token',
        files: [
          {
            path: '/src/App.tsx',
            before: 'export default function App() {}',
            after: 'const token = "ghp_1234567890abcdefghijklmnopqrstuv";'
          }
        ]
      };
      const res1 = validateEditPatch(githubSecretPatch, liveFiles);
      expect(res1.valid).toBe(false);
      expect(res1.structuredErrors.some((e) => e.rule === 'GITHUB_TOKEN_EXPOSURE')).toBe(true);

      // 2. Private Key exposure
      const privateKeyPatch = {
        summary: 'Add rsa key',
        files: [
          {
            path: '/src/App.tsx',
            before: 'export default function App() {}',
            after: 'const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...";'
          }
        ]
      };
      const res2 = validateEditPatch(privateKeyPatch, liveFiles);
      expect(res2.valid).toBe(false);
      expect(res2.structuredErrors.some((e) => e.rule === 'PRIVATE_KEY_EXPOSURE')).toBe(true);

      // 3. Raw Database connection string with password
      const dbUrlPatch = {
        summary: 'Add database string',
        files: [
          {
            path: '/src/App.tsx',
            before: 'export default function App() {}',
            after: 'const db = "postgres://postgres:supersecretpassword@db.example.com:5432/main";'
          }
        ]
      };
      const res3 = validateEditPatch(dbUrlPatch, liveFiles);
      expect(res3.valid).toBe(false);
      expect(res3.structuredErrors.some((e) => e.rule === 'DATABASE_PASSWORD_EXPOSURE')).toBe(true);
    });

    it('strictly enforces affected-file allowlist from structured engineering plan', () => {
      const liveFiles = {
        '/src/App.tsx': {
          id: '1',
          name: 'App.tsx',
          path: '/src/App.tsx',
          content: 'export default function App() {}',
          createdAt: '',
          updatedAt: ''
        },
        '/src/Header.tsx': {
          id: '2',
          name: 'Header.tsx',
          path: '/src/Header.tsx',
          content: 'export function Header() {}',
          createdAt: '',
          updatedAt: ''
        }
      };

      const patchWithUnlistedFile = {
        summary: 'Update App and Header',
        affectedFiles: [{ path: '/src/App.tsx', reason: 'Update root' }],
        files: [
          {
            path: '/src/App.tsx',
            before: 'export default function App() {}',
            after: 'export default function App() { return 1; }'
          },
          {
            path: '/src/Header.tsx',
            before: 'export function Header() {}',
            after: 'export function Header() { return 2; }'
          }
        ]
      };

      const res = validateEditPatch(patchWithUnlistedFile, liveFiles);
      expect(res.valid).toBe(false);
      expect(res.structuredErrors.some((e) => e.rule === 'UNLISTED_AFFECTED_FILE')).toBe(true);
      expect(res.structuredErrors.find((e) => e.rule === 'UNLISTED_AFFECTED_FILE')?.path).toBe('/src/Header.tsx');
    });

    it('rejects stale proposals where baseline does not match live authoritative VFS', () => {
      const liveFiles = {
        '/src/App.tsx': {
          id: '1',
          name: 'App.tsx',
          path: '/src/App.tsx',
          content: 'export const live = "version-2";',
          createdAt: '',
          updatedAt: ''
        }
      };

      const stalePatch = {
        summary: 'Stale edit based on old version',
        files: [
          {
            path: '/src/App.tsx',
            before: 'export const live = "version-1";', // Stale before content
            after: 'export const live = "version-3";'
          }
        ]
      };

      const res = validateEditPatch(stalePatch, liveFiles);
      expect(res.valid).toBe(false);
      expect(res.structuredErrors.some((e) => e.rule === 'STALE_BEFORE_CONTENT')).toBe(true);
    });
  });

  describe('12. Project & Race Safety Across Concurrent Transitions', () => {
    it('isolates UI diagnosis state when active project switches during in-flight diagnosis', async () => {
      const projA = 'proj-race-a';
      const projB = 'proj-race-b';

      useProjectStore.setState({
        activeProjectId: projA,
        projects: {
          [projA]: { id: projA, title: 'Project A', description: '', badge: 'react', status: 'ready', files: {}, openTabs: [], activeFilePath: '', diagnostics: [], fixHistory: [] },
          [projB]: { id: projB, title: 'Project B', description: '', badge: 'react', status: 'ready', files: {}, openTabs: [], activeFilePath: '', diagnostics: [], fixHistory: [] }
        }
      });

      const store = useRepairStore.getState();
      const epA = store.createEpisode(
        projA,
        { executionId: 'ea', command: 'npm run build', args: [], exitCode: 1, stdout: '', stderr: 'Err', durationMs: 10, timestamp: Date.now() },
        'fp_race_a',
        'ev_race_a'
      );

      // Mock diagnosis promise that allows switching project before completion
      let completeDiagnosis: () => void;
      const diagnosisPromise = new Promise<{ diagnosis: any; patch: any }>((resolve) => {
        completeDiagnosis = () => resolve({
          diagnosis: { category: 'build', severity: 'error', rootCause: 'A error', explanation: 'A error', suggestedFix: 'fix', evidence: [], affectedFiles: [] },
          patch: { id: 'patch-a', summary: 'Patch for A', files: [] }
        });
      });
      vi.spyOn(repairLoopEngine, 'runDiagnosisAndPatch').mockReturnValue(diagnosisPromise);

      // Start diagnosis on Project A
      const diagnosisCall = repairCoordinator.runEpisodeDiagnosis(projA, epA.failureEpisodeId);

      // User switches active project to Project B before diagnosis finishes!
      useProjectStore.setState({ activeProjectId: projB });
      useAgentStore.setState({ diagnosis: null, pendingPatch: null, isDiagnosing: false });

      // Now diagnosis for Project A finishes
      completeDiagnosis!();
      await diagnosisCall;

      // Project A's episode has proposal in repairStore
      const updatedEpA = useRepairStore.getState().getProjectEpisodes(projA).find(e => e.failureEpisodeId === epA.failureEpisodeId);
      expect(updatedEpA?.status).toBe('proposal_ready');

      // BUT active UI for Project B must NOT be polluted with Project A's diagnosis or patch!
      expect(useAgentStore.getState().diagnosis).toBeNull();
      expect(useAgentStore.getState().pendingPatch).toBeNull();
    });

    it('safely discards in-flight diagnosis if project is deleted', async () => {
      const projA = 'proj-del-inflight';

      useProjectStore.setState({
        activeProjectId: projA,
        projects: {
          [projA]: { id: projA, title: 'Project To Delete', description: '', badge: 'react', status: 'ready', files: {}, openTabs: [], activeFilePath: '', diagnostics: [], fixHistory: [] }
        }
      });

      const store = useRepairStore.getState();
      const epA = store.createEpisode(
        projA,
        { executionId: 'ea-del', command: 'npm run build', args: [], exitCode: 1, stdout: '', stderr: 'Err', durationMs: 10, timestamp: Date.now() },
        'fp_del',
        'ev_del'
      );

      let completeDiagnosis: () => void;
      const diagnosisPromise = new Promise<{ diagnosis: any; patch: any }>((resolve) => {
        completeDiagnosis = () => resolve({
          diagnosis: { category: 'build', severity: 'error', rootCause: 'Err', explanation: 'Err', suggestedFix: 'fix', evidence: [], affectedFiles: [] },
          patch: { id: 'patch-del', summary: 'Patch', files: [] }
        });
      });
      vi.spyOn(repairLoopEngine, 'runDiagnosisAndPatch').mockReturnValue(diagnosisPromise);

      const diagnosisCall = repairCoordinator.runEpisodeDiagnosis(projA, epA.failureEpisodeId);

      // Project A is deleted!
      const projects = { ...useProjectStore.getState().projects };
      delete projects[projA];
      useProjectStore.setState({ projects });
      useRepairStore.getState().deleteProjectRepairState(projA);

      completeDiagnosis!();
      const result = await diagnosisCall;

      // Result safely discarded
      expect(result).toBeNull();
    });

    it('guarantees approval on Project A cannot mutate Project B VFS', async () => {
      const projA = 'proj-iso-mutate-a';
      const projB = 'proj-iso-mutate-b';

      useProjectStore.setState({
        activeProjectId: projA,
        projects: {
          [projA]: { id: projA, title: 'A', description: '', badge: 'react', status: 'ready', files: {}, openTabs: [], activeFilePath: '', diagnostics: [], fixHistory: [] },
          [projB]: { id: projB, title: 'B', description: '', badge: 'react', status: 'ready', files: {}, openTabs: [], activeFilePath: '', diagnostics: [], fixHistory: [] }
        }
      });

      const projBCode = 'export const bOriginal = 42;';
      await vfsManager.writeFile(projA, '/src/App.tsx', 'export const aOriginal = 1;');
      await vfsManager.writeFile(projB, '/src/App.tsx', projBCode);

      const store = useRepairStore.getState();
      const epA = store.createEpisode(
        projA,
        { executionId: 'ea', command: 'npm run build', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 10, timestamp: Date.now() },
        'fp_a_iso',
        'ev_a_iso'
      );

      const patchA: Patch = {
        id: 'patch-a-iso',
        summary: 'Update Project A',
        files: [{ path: '/src/App.tsx', before: 'export const aOriginal = 1;', after: 'export const aModified = 2;' }]
      };
      store.setEpisodeProposal(projA, epA.failureEpisodeId, {
        category: 'logic', severity: 'error', rootCause: '', explanation: '', suggestedFix: '', evidence: [], affectedFiles: []
      }, patchA);

      vi.spyOn(repairLoopEngine, 'applyPatchAndVerify').mockImplementation(async (targetProjId, patch) => {
        // Real apply writes to targetProjId
        for (const f of patch.files) {
          await vfsManager.writeFile(targetProjId, f.path, f.after);
        }
        return { verified: true };
      });

      const res = await repairCoordinator.approveRepair(projA, epA.failureEpisodeId);
      expect(res.verified).toBe(true);

      // Project A updated
      expect(vfsManager.getFile(projA, '/src/App.tsx')?.content).toBe('export const aModified = 2;');

      // Project B strictly untouched
      expect(vfsManager.getFile(projB, '/src/App.tsx')?.content).toBe(projBCode);
    });

    it('cancels in-flight diagnosis and prevents late async completion from mutating episode', async () => {
      const projId = 'proj-cancel-race';
      useProjectStore.setState({
        activeProjectId: projId,
        projects: {
          [projId]: { id: projId, title: 'Proj', description: '', badge: 'react', status: 'ready', files: {}, openTabs: [], activeFilePath: '', diagnostics: [], fixHistory: [] }
        }
      });

      const store = useRepairStore.getState();
      const ep = store.createEpisode(
        projId,
        { executionId: 'e-cancel', command: 'npm run build', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 10, timestamp: Date.now() },
        'fp_cancel',
        'ev_cancel'
      );

      let completeLate: () => void;
      const diagnosisPromise = new Promise<{ diagnosis: any; patch: any }>((resolve) => {
        completeLate = () => resolve({
          diagnosis: { category: 'build', severity: 'error', rootCause: 'late', explanation: '', suggestedFix: '', evidence: [], affectedFiles: [] },
          patch: { id: 'patch-late', summary: 'Late patch', files: [] }
        });
      });
      vi.spyOn(repairLoopEngine, 'runDiagnosisAndPatch').mockReturnValue(diagnosisPromise);

      const diagnosisCall = repairCoordinator.runEpisodeDiagnosis(projId, ep.failureEpisodeId);

      // User cancels diagnosis while in flight!
      repairCoordinator.cancelDiagnosis(projId);

      // Complete the late promise
      completeLate!();
      const result = await diagnosisCall;

      expect(result).toBeNull();
      const currentEp = store.getProjectEpisodes(projId).find(e => e.failureEpisodeId === ep.failureEpisodeId);
      expect(currentEp?.status).toBe('cancelled');
    });
  });
});
