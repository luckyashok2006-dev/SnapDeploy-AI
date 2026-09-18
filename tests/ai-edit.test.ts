import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { useChatStore } from '../src/store/chatStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { validateEditPatch, calculateDiffBytes, MAX_EDIT_FILES, MAX_EDIT_DIFF_BYTES } from '../src/features/chat/edit-validator';
import { chatService } from '../src/features/chat/chat-service';
import { editExecutor } from '../src/features/chat/edit-executor';
import { verificationService } from '../src/features/verification/VerificationService';
import { repairLoopEngine } from '../src/features/repair/repair-loop';
import { ruleBasedAIProvider } from '../server/providers/dev/RuleBasedAIProvider';

describe('SnapDeploy AI — Tier 1 Feature 4: AI Development Chat / Edit Mode', () => {
  beforeEach(async () => {
    await vfsManager.resetForTesting();
    useProjectStore.setState({
      projects: {},
      activeProjectId: '',
      deletedProjectIds: []
    });
    useEditorStore.setState({
      openTabs: {},
      activeFilePath: {},
      dirtyFiles: {},
      savedBaselines: {},
      modelEpoch: 0
    });
    useChatStore.setState({
      projectMessages: {},
      latestOperationId: {},
      isGenerating: false,
      isApplying: false,
      applyingStage: null,
      error: null,
      diagnosticHistory: []
    });
    vi.restoreAllMocks();
  });

  describe('1. Context Assembly & Bounded Sizing', () => {
    it('assembles bounded proposal baseline context including core files and active file', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Context Proj');

      await writeFile(projId, '/package.json', JSON.stringify({ name: 'test-app' }));
      await writeFile(projId, '/index.html', '<!doctype html><html><body><div id="root"></div></body></html>');
      await writeFile(projId, '/src/App.tsx', 'export function App() { return <div>App</div>; }');
      await writeFile(projId, '/src/main.tsx', 'import "./index.css";');
      await writeFile(projId, '/src/components/Header.tsx', 'export const Header = () => <header>Nav</header>;');

      const context = chatService.buildEditContext(projId, 'Change header color', '/src/components/Header.tsx');

      expect(context.projectId).toBe(projId);
      expect(context.activeFilePath).toBe('/src/components/Header.tsx');
      expect(context.relevantFiles['/package.json']).toBeDefined();
      expect(context.relevantFiles['/src/App.tsx']).toBeDefined();
      expect(context.relevantFiles['/src/components/Header.tsx']).toBeDefined();
      expect(context.projectSummary?.fileList).toContain('/src/App.tsx');
    });
  });

  describe('2. Validation Rules & Boundaries', () => {
    it('rejects path traversal, null bytes, absolute paths, and URI schemes', () => {
      const liveFiles = {
        '/src/App.tsx': { id: '1', projectId: 'p1', path: '/src/App.tsx', content: 'export const App = 1;', hash: 'h1', updatedAt: '' }
      };

      const traversalPatch = {
        summary: 'Invalid path test',
        files: [{ path: '/../etc/passwd', before: '', after: 'root:x:0:0' }]
      };
      const result = validateEditPatch(traversalPatch, liveFiles as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Path traversal'))).toBe(true);

      const nullBytePatch = {
        summary: 'Null byte test',
        files: [{ path: '/src/file\0.ts', before: '', after: 'malicious' }]
      };
      expect(validateEditPatch(nullBytePatch, liveFiles as any).valid).toBe(false);

      const drivePathPatch = {
        summary: 'Drive path test',
        files: [{ path: 'C:\\Windows\\system32', before: '', after: 'bad' }]
      };
      expect(validateEditPatch(drivePathPatch, liveFiles as any).valid).toBe(false);
    });

    it('rejects unsupported delete actions and missing after content', () => {
      const liveFiles = {
        '/src/App.tsx': { id: '1', projectId: 'p1', path: '/src/App.tsx', content: 'hello', hash: 'h1', updatedAt: '' }
      };

      const deletePatch: any = {
        summary: 'Delete test',
        files: [{ path: '/src/App.tsx', before: 'hello', after: null }]
      };
      const result = validateEditPatch(deletePatch, liveFiles as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('deletion is not supported'))).toBe(true);
    });

    it('rejects proposals modifying more than MAX_EDIT_FILES (5)', () => {
      const liveFiles: Record<string, any> = {};
      const files: any[] = [];
      for (let i = 1; i <= 6; i++) {
        const path = `/src/file${i}.ts`;
        liveFiles[path] = { id: `${i}`, projectId: 'p1', path, content: 'original', hash: 'h', updatedAt: '' };
        files.push({ path, before: 'original', after: 'modified' });
      }

      const oversizedPatch = { summary: 'Oversized files test', files };
      const result = validateEditPatch(oversizedPatch, liveFiles);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum limit of 5'))).toBe(true);
    });

    it('rejects proposals exceeding MAX_EDIT_DIFF_BYTES (100,000)', () => {
      const path = '/src/huge.ts';
      const liveFiles = {
        [path]: { id: '1', projectId: 'p1', path, content: 'small', hash: 'h', updatedAt: '' }
      };

      const largeContent = 'X'.repeat(100_001);
      const hugeDiffPatch = {
        summary: 'Huge diff test',
        files: [{ path, before: 'small', after: largeContent }]
      };

      expect(calculateDiffBytes(hugeDiffPatch.files)).toBeGreaterThan(MAX_EDIT_DIFF_BYTES);
      const result = validateEditPatch(hugeDiffPatch, liveFiles as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum limit of 100000'))).toBe(true);
    });

    it('rejects unchanged files where before === after', () => {
      const path = '/src/App.tsx';
      const liveFiles = {
        [path]: { id: '1', projectId: 'p1', path, content: 'identical', hash: 'h', updatedAt: '' }
      };

      const unchangedPatch = {
        summary: 'Unchanged test',
        files: [{ path, before: 'identical', after: 'identical' }]
      };

      const result = validateEditPatch(unchangedPatch, liveFiles as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('no actual changes'))).toBe(true);
    });

    it('rejects duplicate path entries in the same proposal', () => {
      const path = '/src/App.tsx';
      const liveFiles = {
        [path]: { id: '1', projectId: 'p1', path, content: 'original', hash: 'h', updatedAt: '' }
      };

      const duplicatePatch = {
        summary: 'Duplicate test',
        files: [
          { path, before: 'original', after: 'first change' },
          { path, before: 'original', after: 'second change' }
        ]
      };

      const result = validateEditPatch(duplicatePatch, liveFiles as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate patch entry'))).toBe(true);
    });

    it('create-action collision safety: rejects action=create for a path that already exists in live VFS', () => {
      const path = '/src/Existing.tsx';
      const liveFiles = {
        [path]: { id: '1', projectId: 'p1', path, content: 'already exists here', hash: 'h', updatedAt: '' }
      };

      const collisionPatch = {
        summary: 'Create collision test',
        files: [{ path, before: '', after: 'new created content' }]
      };

      const result = validateEditPatch(collisionPatch, liveFiles as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('already exists in project'))).toBe(true);
      // Verify existing file is unchanged
      expect(liveFiles[path].content).toBe('already exists here');
    });

    it('stale before check: rejects proposal when live VFS does not match proposal baseline byte-for-byte', () => {
      const path = '/src/App.tsx';
      const liveFiles = {
        [path]: { id: '1', projectId: 'p1', path, content: 'User edited this live in Monaco!', hash: 'h', updatedAt: '' }
      };

      const stalePatch = {
        summary: 'Stale test',
        files: [{ path, before: 'Old baseline code', after: 'Proposed AI code' }]
      };

      const result = validateEditPatch(stalePatch, liveFiles as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('does not match baseline'))).toBe(true);
    });
  });

  describe('3. Async Race Safety & Concurrency', () => {
    it('out-of-order response safety: discards stale response from Request A when Request B has superseded it', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Race Proj');
      useProjectStore.setState({ activeProjectId: projId });
      await writeFile(projId, '/src/App.tsx', 'export const App = () => <div>V1</div>;');

      let resolveA: any;
      const promiseA = new Promise((res) => { resolveA = res; });
      let resolveB: any;
      const promiseB = new Promise((res) => { resolveB = res; });

      let callCount = 0;
      vi.spyOn(chatService, 'requestEdit').mockImplementation(async (input) => {
        callCount++;
        if (callCount === 1) {
          await promiseA;
          return {
            id: 'proposal_A',
            operationId: input.operationId,
            summary: 'Proposal A (stale)',
            explanation: 'Stale A',
            files: [{ path: '/src/App.tsx', before: 'export const App = () => <div>V1</div>;', after: 'export const App = () => <div>A</div>;' }]
          };
        } else {
          await promiseB;
          return {
            id: 'proposal_B',
            operationId: input.operationId,
            summary: 'Proposal B (current)',
            explanation: 'Current B',
            files: [{ path: '/src/App.tsx', before: 'export const App = () => <div>V1</div>;', after: 'export const App = () => <div>B</div>;' }]
          };
        }
      });

      // User sends Request A
      const sendPromiseA = useChatStore.getState().sendMessage(projId, 'Prompt A');
      // User immediately sends Request B (superseding A)
      const sendPromiseB = useChatStore.getState().sendMessage(projId, 'Prompt B');

      // Request B finishes FIRST
      resolveB();
      await sendPromiseB;

      const messagesAfterB = useChatStore.getState().getProjectMessages(projId);
      const assistantMsgAfterB = messagesAfterB.find(m => m.proposal?.summary === 'Proposal B (current)');
      expect(assistantMsgAfterB).toBeDefined();
      expect(assistantMsgAfterB?.status).toBe('pending_approval');

      // Request A finishes LATER (out-of-order)
      resolveA();
      await sendPromiseA;

      // Verify Proposal A was discarded and did not overwrite Proposal B
      const messagesFinal = useChatStore.getState().getProjectMessages(projId);
      const staleAProposal = messagesFinal.find(m => m.proposal?.summary === 'Proposal A (stale)');
      expect(staleAProposal).toBeUndefined();

      // Diagnostic check: STALE_OPERATION_DISCARDED recorded
      const diagnostics = useChatStore.getState().diagnosticHistory;
      expect(diagnostics.some(d => d.reason === 'STALE_OPERATION_DISCARDED')).toBe(true);
    });

    it('project switch safety: proposal generated for Project Alpha cannot be approved when Project Beta is active', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projAlpha = createProject('Alpha');
      const projBeta = createProject('Beta');

      useProjectStore.setState({ activeProjectId: projAlpha });
      await writeFile(projAlpha, '/src/App.tsx', 'Alpha App');
      await writeFile(projBeta, '/src/App.tsx', 'Beta App');

      vi.spyOn(chatService, 'requestEdit').mockResolvedValue({
        id: 'prop_alpha',
        summary: 'Edit Alpha',
        explanation: 'Modifies Alpha',
        files: [{ path: '/src/App.tsx', before: 'Alpha App', after: 'Alpha Modified' }]
      });

      await useChatStore.getState().sendMessage(projAlpha, 'Modify Alpha');
      const alphaMessages = useChatStore.getState().getProjectMessages(projAlpha);
      const proposalMsg = alphaMessages.find(m => m.proposal);
      expect(proposalMsg).toBeDefined();

      // User switches active project to Beta
      useProjectStore.setState({ activeProjectId: projBeta });

      // User attempts to approve Alpha's proposal while Beta is active
      const approvalResult = await useChatStore.getState().approveProposal(projAlpha, proposalMsg!.id);
      expect(approvalResult.verified).toBe(false);
      expect(approvalResult.error).toContain('does not match proposal project');

      // Verify Beta's VFS was untouched
      const betaFile = vfsManager.getFile(projBeta, '/src/App.tsx');
      expect(betaFile?.content).toBe('Beta App');

      // Diagnostic check: PROJECT_MISMATCH_BLOCKED recorded
      const diagnostics = useChatStore.getState().diagnosticHistory;
      expect(diagnostics.some(d => d.reason === 'PROJECT_MISMATCH_BLOCKED')).toBe(true);
    });

    it('project deletion safety: deleting project prunes chat messages, operationId, and aborts in-flight request', async () => {
      const { createProject, deleteProject } = useProjectStore.getState();
      const projId = createProject('Delete Me Proj');
      useProjectStore.setState({ activeProjectId: projId });

      let aborted = false;
      vi.spyOn(chatService, 'requestEdit').mockImplementation(async (_input, signal) => {
        signal?.addEventListener('abort', () => { aborted = true; });
        await new Promise(r => setTimeout(r, 500));
        return { id: 'p', summary: 'test', explanation: 'test', files: [] };
      });

      // Start in-flight request
      useChatStore.getState().sendMessage(projId, 'Slow edit prompt');
      expect(useChatStore.getState().isGenerating).toBe(true);

      // Delete project while request is in-flight
      await deleteProject(projId);

      // Verify abort controller was fired
      expect(aborted).toBe(true);
      // Verify chat state was completely pruned
      expect(useChatStore.getState().getProjectMessages(projId)).toEqual([]);
      expect(useChatStore.getState().latestOperationId[projId]).toBeUndefined();
    });

    it('cancellation safety: user cancellation aborts request via AbortController and transitions status to cancelled', async () => {
      const { createProject } = useProjectStore.getState();
      const projId = createProject('Cancel Proj');
      useProjectStore.setState({ activeProjectId: projId });

      let aborted = false;
      vi.spyOn(chatService, 'requestEdit').mockImplementation(async (_input, signal) => {
        signal?.addEventListener('abort', () => { aborted = true; });
        await new Promise(r => setTimeout(r, 500));
        throw new DOMException('Aborted', 'AbortError');
      });

      // Start request
      const sendPromise = useChatStore.getState().sendMessage(projId, 'Prompt to cancel');
      expect(useChatStore.getState().isGenerating).toBe(true);

      // User clicks Stop/Cancel
      useChatStore.getState().cancelRequest(projId);

      await sendPromise;

      expect(aborted).toBe(true);
      expect(useChatStore.getState().isGenerating).toBe(false);
      const messages = useChatStore.getState().getProjectMessages(projId);
      const cancelledMsg = messages.find(m => m.status === 'cancelled');
      expect(cancelledMsg).toBeDefined();
      expect(cancelledMsg?.content).toContain('cancelled by user');
    });
  });

  describe('4. Version History Checkpoint & Execution Lifecycle', () => {
    it('approved AI edit creates real Version History checkpoint named "Before AI edit: <summary>" visible in timeline', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('History Checkpoint Proj');
      useProjectStore.setState({ activeProjectId: projId });

      const initialCode = 'export const App = () => <div className="bg-white">Light</div>;';
      await writeFile(projId, '/src/App.tsx', initialCode);

      // Mock verification service success
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: true,
        checks: [{ name: 'tsc', success: true }, { name: 'build', success: true }],
        totalDurationMs: 1200
      });

      const proposal = {
        id: 'prop_dark',
        summary: 'Change dashboard to dark theme',
        explanation: 'Updated background to bg-slate-900',
        files: [{
          path: '/src/App.tsx',
          before: initialCode,
          after: 'export const App = () => <div className="bg-slate-900">Dark</div>;'
        }]
      };

      const result = await editExecutor.executeEdit(projId, proposal);
      expect(result.verified).toBe(true);

      // Check authentic Version History snapshot in snapshotService
      const snapshots = snapshotService.listSnapshots(projId);
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
      const editCheckpoint = snapshots.find(s => s.description.startsWith('Before AI edit:'));
      expect(editCheckpoint).toBeDefined();
      expect(editCheckpoint?.description).toBe('Before AI edit: Change dashboard to dark theme');
      // Verify snapshot files contain pre-edit code
      expect(editCheckpoint?.files['/src/App.tsx']?.content).toBe(initialCode);

      // Verify live VFS updated to new code
      const currentVfsFile = vfsManager.getFile(projId, '/src/App.tsx');
      expect(currentVfsFile?.content).toContain('bg-slate-900');
    });

    it('rejected proposal leaves project files and Version History completely unchanged', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Reject Proj');
      useProjectStore.setState({ activeProjectId: projId });

      const code = 'export const Code = "original";';
      await writeFile(projId, '/src/App.tsx', code);

      vi.spyOn(chatService, 'requestEdit').mockResolvedValue({
        id: 'prop_reject',
        summary: 'Unwanted change',
        explanation: 'Will be rejected',
        files: [{ path: '/src/App.tsx', before: code, after: 'rejected edit' }]
      });

      await useChatStore.getState().sendMessage(projId, 'Change something');
      const messages = useChatStore.getState().getProjectMessages(projId);
      const proposalMsg = messages.find(m => m.proposal);

      // User rejects proposal
      useChatStore.getState().rejectProposal(projId, proposalMsg!.id);

      const updatedMsgs = useChatStore.getState().getProjectMessages(projId);
      expect(updatedMsgs.find(m => m.id === proposalMsg!.id)?.status).toBe('rejected');

      // Verify VFS unchanged
      expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toBe(code);
      // Verify no Version History snapshots were created
      expect(snapshotService.listSnapshots(projId).length).toBe(0);
    });

    it('verification failure automatically rolls back VFS to pre-edit state and reports failure', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Failure Rollback Proj');
      useProjectStore.setState({ activeProjectId: projId });

      const initialCode = 'export const Safe = 100;';
      await writeFile(projId, '/src/App.tsx', initialCode);

      // Mock verification service FAILURE
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: false,
        checks: [{ name: 'tsc', success: false, output: 'Syntax error in App.tsx', status: 'failed' }],
        totalDurationMs: 800
      });

      const badProposal = {
        id: 'prop_bad',
        summary: 'Introduce syntax error',
        explanation: 'Fails compiler',
        files: [{
          path: '/src/App.tsx',
          before: initialCode,
          after: initialCode + '\nconst syntax_err = undeclared();'
        }]
      };

      const result = await editExecutor.executeEdit(projId, badProposal);
      expect(result.verified).toBe(false);
      expect(result.error).toContain('failed');

      // Verify VFS was rolled back byte-for-byte
      const postRollbackFile = vfsManager.getFile(projId, '/src/App.tsx');
      expect(postRollbackFile?.content).toBe(initialCode);
    });

    it('post-edit undo/redo isolation: resets model epoch and baselines preventing stale undo resurrection', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Epoch Proj');
      useProjectStore.setState({ activeProjectId: projId });

      const initialCode = 'export const Version1 = true;';
      await writeFile(projId, '/src/App.tsx', initialCode);
      useEditorStore.getState().setSavedBaseline(projId, '/src/App.tsx', initialCode);
      const initialEpoch = useEditorStore.getState().modelEpoch;

      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: true,
        checks: [{ name: 'tsc', success: true }],
        totalDurationMs: 500
      });

      const newCode = 'export const Version2_AI = true;';
      const proposal = {
        id: 'prop_epoch',
        summary: 'Update to Version 2',
        explanation: 'Clean epoch update',
        files: [{ path: '/src/App.tsx', before: initialCode, after: newCode }]
      };

      await editExecutor.executeEdit(projId, proposal);

      // Model epoch must have incremented
      expect(useEditorStore.getState().modelEpoch).toBe(initialEpoch + 1);
      // Saved baseline must now match the post-edit code
      expect(useEditorStore.getState().getSavedBaseline(projId, '/src/App.tsx')).toBe(newCode);
      // Dirty state must be clean
      expect(useEditorStore.getState().checkIsDirty(projId, '/src/App.tsx', newCode)).toBe(false);
    });
  });

  describe('5. Existing AI Repair Regression Safety Gate', () => {
    it('existing AI Repair loop and rollback behavior remain completely intact and unaffected by AI Edit', async () => {
      const { createProject, writeFile } = useProjectStore.getState();
      const projId = createProject('Repair Regression Proj');
      useProjectStore.setState({ activeProjectId: projId });

      const initialApp = 'export function App() { return <div>Original</div>; }';
      await writeFile(projId, '/src/App.tsx', initialApp);

      // Mock verification service success for repair
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: true,
        checks: [{ name: 'TypeScript Compilation', success: true }, { name: 'Production Build', success: true }],
        totalDurationMs: 1500
      });

      const repairPatch = {
        id: 'patch_repair_123',
        summary: 'Fix undefined reference in App.tsx',
        files: [{
          path: '/src/App.tsx',
          before: initialApp,
          after: 'export function App() { return <div>Repaired</div>; }'
        }]
      };

      // Execute existing repairLoopEngine method
      const repairResult = await repairLoopEngine.applyPatchAndVerify(projId, repairPatch);
      expect(repairResult.verified).toBe(true);

      // Verify VFS file updated
      expect(vfsManager.getFile(projId, '/src/App.tsx')?.content).toContain('Repaired');
      // Verify pre-repair snapshot created
      const snapshots = snapshotService.listSnapshots(projId);
      expect(snapshots.some(s => s.description.includes('Before applying patch'))).toBe(true);
    });
  });

  describe('6. Offline RuleBased Provider Tests', () => {
    it('ruleBasedAIProvider generates valid, bounded EditProposal for dark theme prompt', async () => {
      const relevantFiles = {
        '/src/App.tsx': 'export function App() { return <div className="bg-white text-slate-900">App</div>; }'
      };

      const proposal = await ruleBasedAIProvider.editProject({
        prompt: 'Change dashboard to a dark theme',
        relevantFiles,
        activeFilePath: '/src/App.tsx'
      });

      expect(proposal.summary).toContain('dark theme');
      expect(proposal.files.length).toBe(1);
      expect(proposal.files[0].path).toBe('/src/App.tsx');
      expect(proposal.files[0].after).toContain('bg-slate-900');
      expect(proposal.files[0].after).toContain('text-slate-50');
    });
  });
});
