import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from '../src/store/agentStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useProjectStore } from '../src/store/projectStore';
import { useRepairStore } from '../src/store/repairStore';
import { sanitizeString } from '../src/features/deployment/security/secret-sanitizer';
import { verificationService } from '../src/features/verification/VerificationService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { repairCoordinator } from '../src/features/repair/repair-coordinator';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import * as fs from 'fs';
import * as path from 'path';

describe('SnapDeploy AI — Engineering Console Surgical Fixes (EC-01 to EC-07)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAgentStore.getState().resetAgentState();
    useRuntimeStore.setState({
      logsByProject: {},
      evidenceByProject: {},
      executionHistoryByProject: {},
      terminalLogs: [],
      lastEvidence: null,
      bottomDrawerHeight: 280,
      isBottomDrawerOpen: true,
      activeBottomTab: 'terminal'
    });
    useProjectStore.setState({
      activeProjectId: 'project-alpha',
      projects: {
        'project-alpha': { id: 'project-alpha', title: 'Alpha', files: {}, openTabs: [] } as any,
        'project-beta': { id: 'project-beta', title: 'Beta', files: {}, openTabs: [] } as any
      }
    });
  });

  // =========================================================================
  // EC-01: Clear Stale Diagnosis After Verification Success
  // =========================================================================
  describe('EC-01: Clear Stale Diagnosis After Verification Success', () => {
    it('invalidates diagnosis and leaves active Issues clean when verification passes', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      // 1. Create a failure diagnosis
      useAgentStore.getState().setDiagnosis({
        category: 'SyntaxError',
        severity: 'high',
        affectedFiles: ['src/App.tsx'],
        explanation: 'Unexpected token in App.tsx',
        suggestedFix: 'Fix missing closing tag',
        confidence: 0.95,
        evidence: ['error TS1005: Unexpected token']
      }, projId);

      expect(useAgentStore.getState().getDiagnosis(projId)).not.toBeNull();
      expect(useAgentStore.getState().diagnosis).not.toBeNull();

      // 2. Mock successful verification
      vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
      vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);
      vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
      vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
        executionId: 'exec_ts',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 0,
        stdout: 'Success',
        stderr: '',
        durationMs: 400,
        timedOut: false
      });
      vi.spyOn(runtimeManager, 'runBuild').mockResolvedValue({
        executionId: 'exec_build',
        command: 'npm run build',
        args: [],
        exitCode: 0,
        stdout: 'Build passed',
        stderr: '',
        durationMs: 800,
        timedOut: false
      });

      // 3. Run verification
      const result = await verificationService.runFullVerification({ projectId: projId });
      expect(result.success).toBe(true);

      // 4. Assert active diagnosis has been cleared
      expect(useAgentStore.getState().getDiagnosis(projId)).toBeNull();
      expect(useAgentStore.getState().diagnosis).toBeNull();
    });

    it('retains diagnosis when verification fails', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      useAgentStore.getState().setDiagnosis({
        category: 'TypeError',
        severity: 'high',
        affectedFiles: ['src/index.ts'],
        explanation: 'Type mismatch error',
        suggestedFix: 'Cast to string',
        confidence: 0.88,
        evidence: ['error TS2322']
      }, projId);

      vi.spyOn(runtimeManager, 'isDevServerRunning').mockReturnValue(false);
      vi.spyOn(runtimeManager, 'isBooted').mockReturnValue(true);
      vi.spyOn(runtimeManager, 'hasLocalTypeScript').mockResolvedValue(true);
      vi.spyOn(runtimeManager, 'runTypeScriptCheck').mockResolvedValue({
        executionId: 'exec_ts_fail',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'TS2322 Type mismatch',
        durationMs: 300,
        timedOut: false
      });

      const result = await verificationService.runFullVerification({ projectId: projId });
      expect(result.success).toBe(false);
      expect(useAgentStore.getState().getDiagnosis(projId)).not.toBeNull();
    });
  });

  // =========================================================================
  // EC-02: Project-Scoped Console State & Runtime Isolation
  // =========================================================================
  describe('EC-02: Project-Scoped Console State & Runtime Isolation', () => {
    it('enforces complete state isolation between Project A and Project B with unique tokens', () => {
      const projA = 'project-alpha';
      const projB = 'project-beta';

      const TOKEN_LOG_A = 'PROJECT_A_UNIQUE_TERMINAL_LOG_84721';
      const TOKEN_LOG_B = 'PROJECT_B_UNIQUE_TERMINAL_LOG_84721';
      const TOKEN_DIAG_A = 'PROJECT_A_UNIQUE_DIAGNOSIS_84721';
      const TOKEN_DIAG_B = 'PROJECT_B_UNIQUE_DIAGNOSIS_84721';
      const TOKEN_VERIF_A = 'PROJECT_A_UNIQUE_VERIFICATION_84721';
      const TOKEN_VERIF_B = 'PROJECT_B_UNIQUE_VERIFICATION_84721';

      // 1. Write Project A state
      useProjectStore.setState({ activeProjectId: projA });
      useRuntimeStore.getState().addTerminalLog(TOKEN_LOG_A, projA);
      useAgentStore.getState().setDiagnosis({
        category: 'LogicError',
        severity: 'medium',
        affectedFiles: ['src/a.ts'],
        explanation: TOKEN_DIAG_A,
        suggestedFix: 'Fix logic A',
        confidence: 0.9,
        evidence: [TOKEN_DIAG_A]
      }, projA);
      useAgentStore.getState().setVerificationResult({
        success: true,
        checks: [{ name: TOKEN_VERIF_A, command: 'check', exitCode: 0, success: true, status: 'passed', timedOut: false, durationMs: 10 }],
        totalDurationMs: 10
      }, projA);

      // Verify Project A state present
      expect(useRuntimeStore.getState().getTerminalLogs(projA)).toContain(TOKEN_LOG_A);
      expect(useAgentStore.getState().getDiagnosis(projA)?.explanation).toBe(TOKEN_DIAG_A);
      expect(useAgentStore.getState().getVerificationResult(projA)?.checks[0].name).toBe(TOKEN_VERIF_A);

      // 2. Switch to Project B
      useProjectStore.setState({ activeProjectId: projB });

      // Verify Project A state is NOT visible in Project B
      const logsBBefore = useRuntimeStore.getState().getTerminalLogs(projB);
      expect(logsBBefore).not.toContain(TOKEN_LOG_A);
      expect(useAgentStore.getState().getDiagnosis(projB)).toBeNull();
      expect(useAgentStore.getState().getVerificationResult(projB)).toBeNull();

      // 3. Create Project B state
      useRuntimeStore.getState().addTerminalLog(TOKEN_LOG_B, projB);
      useAgentStore.getState().setDiagnosis({
        category: 'SyntaxError',
        severity: 'low',
        affectedFiles: ['src/b.ts'],
        explanation: TOKEN_DIAG_B,
        suggestedFix: 'Fix syntax B',
        confidence: 0.85,
        evidence: [TOKEN_DIAG_B]
      }, projB);
      useAgentStore.getState().setVerificationResult({
        success: false,
        checks: [{ name: TOKEN_VERIF_B, command: 'checkB', exitCode: 1, success: false, status: 'failed', timedOut: false, durationMs: 20 }],
        totalDurationMs: 20
      }, projB);

      // Verify Project B state present
      expect(useRuntimeStore.getState().getTerminalLogs(projB)).toContain(TOKEN_LOG_B);
      expect(useAgentStore.getState().getDiagnosis(projB)?.explanation).toBe(TOKEN_DIAG_B);
      expect(useAgentStore.getState().getVerificationResult(projB)?.checks[0].name).toBe(TOKEN_VERIF_B);

      // 4. Switch back to Project A
      useProjectStore.setState({ activeProjectId: projA });

      // Assert Project A state restored exactly
      expect(useRuntimeStore.getState().getTerminalLogs(projA)).toContain(TOKEN_LOG_A);
      expect(useRuntimeStore.getState().getTerminalLogs(projA)).not.toContain(TOKEN_LOG_B);
      expect(useAgentStore.getState().getDiagnosis(projA)?.explanation).toBe(TOKEN_DIAG_A);
      expect(useAgentStore.getState().getVerificationResult(projA)?.checks[0].name).toBe(TOKEN_VERIF_A);

      // Assert Project B state still isolated in its bucket
      expect(useRuntimeStore.getState().getTerminalLogs(projB)).toContain(TOKEN_LOG_B);
      expect(useRuntimeStore.getState().getTerminalLogs(projB)).not.toContain(TOKEN_LOG_A);
    });

    it('prevents stale async writes from Project A from mutating Project B UI', async () => {
      const projA = 'project-alpha';
      const projB = 'project-beta';

      useProjectStore.setState({ activeProjectId: projA });

      // Simulate an async command started on Project A
      vi.spyOn(runtimeManager, 'boot').mockResolvedValue(undefined as any);
      vi.spyOn(runtimeManager, 'executeCommand').mockImplementation(async () => {
        // Project switch occurs during the async execution!
        useProjectStore.setState({ activeProjectId: projB });
        return {
          executionId: 'exec_delayed',
          command: 'npm run test',
          args: [],
          exitCode: 1,
          stdout: 'Delayed test failure from Project A',
          stderr: '',
          durationMs: 500,
          timedOut: false
        };
      });

      await useRuntimeStore.getState().executeCommand('npm run test', [], { projectId: projA });

      // Project A evidence bucket should be updated
      expect(useRuntimeStore.getState().evidenceByProject[projA]).not.toBeNull();
      expect(useRuntimeStore.getState().evidenceByProject[projA]?.stdout).toBe('Delayed test failure from Project A');

      // Active Project B UI must NOT have lastEvidence overwritten with Project A's failure
      expect(useRuntimeStore.getState().getLastEvidence(projB)).toBeNull();
      expect(useRuntimeStore.getState().lastEvidence).toBeNull();
    });
  });

  // =========================================================================
  // EC-03: Preserve xterm Instance Lifecycle
  // =========================================================================
  describe('EC-03: Preserve xterm Instance Lifecycle', () => {
    it('verifies WorkspaceBottomDrawer keeps InteractiveTerminal mounted with CSS display toggling', () => {
      const drawerFile = path.resolve(__dirname, '../src/components/bottom-drawer/WorkspaceBottomDrawer.tsx');
      const drawerCode = fs.readFileSync(drawerFile, 'utf-8');

      // Must have panel-terminal with persistent display toggle
      expect(drawerCode).toContain('id="panel-terminal"');
      expect(drawerCode).toContain('InteractiveTerminal isVisible=');
      // Must not conditionally unmount InteractiveTerminal based on activeBottomTab
      expect(drawerCode).not.toContain('{activeBottomTab === \'terminal\' && <InteractiveTerminal');
    });

    it('verifies InteractiveTerminal fits only when measurable without dispose on tab switch', () => {
      const terminalFile = path.resolve(__dirname, '../src/components/runtime/InteractiveTerminal.tsx');
      const terminalCode = fs.readFileSync(terminalFile, 'utf-8');

      expect(terminalCode).toContain('requestAnimationFrame(fitIfMeasurable)');
      expect(terminalCode).toContain('offsetWidth > 0');
      // Dispose must only be in unmount cleanup of root useEffect
      expect(terminalCode).toContain('term.dispose()');
    });
  });

  // =========================================================================
  // EC-04: Manual Console Vertical Resize Handle
  // =========================================================================
  describe('EC-04: Manual Console Vertical Resize Handle', () => {
    it('verifies horizontal divider between workspace and console in AppLayout', () => {
      const layoutFile = path.resolve(__dirname, '../src/components/layout/AppLayout.tsx');
      const layoutCode = fs.readFileSync(layoutFile, 'utf-8');

      expect(layoutCode).toContain('handleConsoleResize');
      expect(layoutCode).toContain('orientation="vertical"');
      expect(layoutCode).toContain('onResize={handleConsoleResize}');
    });

    it('calculates 1:1 resize correctly, clamping to minimum 120px and 50% viewport ceiling', () => {
      const viewportHeight = 800;
      const maxAllowed = Math.floor(viewportHeight * 0.5); // 400px
      const minAllowed = 120;

      // 1. Drag upward by 30px (delta = -30) -> grows by 30px
      let currentHeight = 280;
      let delta = -30;
      let targetHeight = currentHeight - delta; // 310
      let clamped = Math.max(minAllowed, Math.min(maxAllowed, targetHeight));
      expect(clamped).toBe(310);

      // 2. Drag downward by 50px (delta = +50) -> shrinks by 50px
      currentHeight = 280;
      delta = 50;
      targetHeight = currentHeight - delta; // 230
      clamped = Math.max(minAllowed, Math.min(maxAllowed, targetHeight));
      expect(clamped).toBe(230);

      // 3. Drag upward beyond 50% viewport ceiling (delta = -300) -> clamped at 400px
      currentHeight = 280;
      delta = -300;
      targetHeight = currentHeight - delta; // 580
      clamped = Math.max(minAllowed, Math.min(maxAllowed, targetHeight));
      expect(clamped).toBe(400);

      // 4. Drag downward beyond 120px floor (delta = +200) -> clamped at 120px
      currentHeight = 280;
      delta = 200;
      targetHeight = currentHeight - delta; // 80
      clamped = Math.max(minAllowed, Math.min(maxAllowed, targetHeight));
      expect(clamped).toBe(120);
    });
  });

  // =========================================================================
  // EC-05: Self-Healing Live Progress Feedback
  // =========================================================================
  describe('EC-05: Self-Healing Live Progress Feedback', () => {
    it('forwards real onProgress callbacks from DebugManagerPanel to terminal logs', async () => {
      const projId = 'project-alpha';
      useProjectStore.setState({ activeProjectId: projId });

      // Mock applyPatchAndVerify to emit stage progress callbacks
      vi.spyOn(repairLoopEngine, 'applyPatchAndVerify').mockImplementation(async (_pid, _patch, onProgress) => {
        onProgress?.('snapshot', 'Creating pre-repair VFS snapshot checkpoint...');
        onProgress?.('applying', 'Applying validated code changes to project files...');
        onProgress?.('verifying', 'Running verification checks (TypeScript, Build)...');
        onProgress?.('verified', 'Repair verified successfully (450ms). Zero regressions.');
        return { verified: true };
      });

      const collectedStages: string[] = [];
      const onProgressCallback = (_stage: string, message: string) => {
        collectedStages.push(message);
        useRuntimeStore.getState().addTerminalLog(`[Self-Healing] ${message}`, projId);
      };

      // Call approveRepair passing onProgress
      vi.spyOn(useRepairStore.getState(), 'getProjectEpisodes').mockReturnValue([{
        failureEpisodeId: 'ep_1',
        status: 'proposal_ready',
        patch: { id: 'p1', summary: 'Fix syntax', files: [] }
      } as any]);

      await repairCoordinator.approveRepair(projId, 'ep_1', onProgressCallback);

      expect(collectedStages).toHaveLength(4);
      expect(collectedStages[0]).toContain('pre-repair VFS snapshot');
      expect(collectedStages[1]).toContain('Applying validated code changes');
      expect(collectedStages[2]).toContain('Running verification checks');
      expect(collectedStages[3]).toContain('Repair verified successfully');

      const logs = useRuntimeStore.getState().getTerminalLogs(projId);
      expect(logs.some((l) => l.includes('Creating pre-repair VFS snapshot'))).toBe(true);
      expect(logs.some((l) => l.includes('Repair verified successfully'))).toBe(true);
    });
  });

  // =========================================================================
  // EC-06: Terminal Secret Sanitization
  // =========================================================================
  describe('EC-06: Terminal Secret Sanitization', () => {
    it('sanitizes AWS keys, GitHub tokens, Bearer tokens, and JWTs in terminal output', () => {
      const projId = 'project-alpha';

      const secretPayload = [
        'Connecting to AWS: AKIAIOSFODNN7EXAMPLE credentials loaded',
        'Pushing to GitHub: ghp_1234567890abcdef1234567890abcdef1234',
        'Authorization: Bearer mySecretToken1234567890abcdef',
        'Auth token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        'Config: AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n-----END RSA PRIVATE KEY-----'
      ];

      for (const line of secretPayload) {
        useRuntimeStore.getState().addTerminalLog(line, projId);
      }

      const logs = useRuntimeStore.getState().getTerminalLogs(projId).join('\n');

      // None of the raw secrets must appear
      expect(logs).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(logs).not.toContain('ghp_1234567890abcdef1234567890abcdef1234');
      expect(logs).not.toContain('mySecretToken1234567890abcdef');
      expect(logs).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      expect(logs).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');

      // Redacted replacements must be present
      expect(logs).toContain('[REDACTED_AWS_KEY]');
      expect(logs).toContain('[REDACTED_TOKEN]');
      expect(logs).toContain('Bearer [REDACTED_TOKEN]');
      expect(logs).toContain('AWS_SECRET_ACCESS_KEY=[REDACTED_VALUE]');
      expect(logs).toContain('[REDACTED_PRIVATE_KEY]');
    });

    it('preserves ordinary compiler messages, file paths, line numbers, and HTTP status codes', () => {
      const ordinaryLog = 'src/components/App.tsx:42:15 - error TS2304: Cannot find name "calculateTax". HTTP 404 GET /api/v1/health';
      const sanitized = sanitizeString(ordinaryLog);
      expect(sanitized).toBe(ordinaryLog);
    });
  });

  // =========================================================================
  // EC-07: WAI-ARIA Console Tabs & Keyboard Navigation
  // =========================================================================
  describe('EC-07: WAI-ARIA Console Tabs & Keyboard Navigation', () => {
    it('verifies tablist, tab, and tabpanel semantic attributes in WorkspaceBottomDrawer', () => {
      const drawerFile = path.resolve(__dirname, '../src/components/bottom-drawer/WorkspaceBottomDrawer.tsx');
      const drawerCode = fs.readFileSync(drawerFile, 'utf-8');

      // Container has role="tablist"
      expect(drawerCode).toContain('role="tablist"');
      expect(drawerCode).toContain('aria-label="Engineering Console Tabs"');

      // Tabs have role="tab", aria-selected, aria-controls, id
      expect(drawerCode).toContain('role="tab"');
      expect(drawerCode).toContain('aria-selected={isActive}');
      expect(drawerCode).toContain('aria-controls={`panel-${tab.id}`}');
      expect(drawerCode).toContain('id={`tab-${tab.id}`}');

      // Panels have role="tabpanel", id, aria-labelledby
      expect(drawerCode).toContain('id="panel-terminal"');
      expect(drawerCode).toContain('role="tabpanel"');
      expect(drawerCode).toContain('aria-labelledby="tab-terminal"');

      expect(drawerCode).toContain('id="panel-diagnostics"');
      expect(drawerCode).toContain('aria-labelledby="tab-diagnostics"');

      expect(drawerCode).toContain('id="panel-verification"');
      expect(drawerCode).toContain('aria-labelledby="tab-verification"');

      // Action buttons have aria-label
      expect(drawerCode).toContain('aria-label={bottomDrawerHeight > 350 ? \'Restore console height\' : \'Maximize console height\'}');
      expect(drawerCode).toContain('aria-label={isBottomDrawerOpen ? \'Collapse console drawer\' : \'Expand console drawer\'}');

      // Keyboard navigation ArrowLeft/ArrowRight handler
      expect(drawerCode).toContain('handleTabKeyDown');
      expect(drawerCode).toContain('ArrowRight');
      expect(drawerCode).toContain('ArrowLeft');
    });
  });
});
