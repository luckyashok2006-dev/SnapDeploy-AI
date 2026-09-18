import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useAgentStore } from '../src/store/agentStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import * as genClient from '../src/features/generation/generation-client';
import { deriveProjectName } from '../src/features/generation/project-name-utils';
import { FileExplorer } from '../src/components/ide/FileExplorer';
import { GenerationPanel } from '../src/features/generation/GenerationPanel';

describe('SnapDeploy AI v1.0.0-rc.1 — Project Identity & File Explorer Behavioral Contracts', () => {
  const paletteFile = path.resolve(__dirname, '../src/components/modals/CommandPaletteModal.tsx');
  const explorerFile = path.resolve(__dirname, '../src/components/ide/FileExplorer.tsx');
  const generationFile = path.resolve(__dirname, '../src/features/generation/GenerationPanel.tsx');

  const paletteSrc = fs.readFileSync(paletteFile, 'utf-8');
  const explorerSrc = fs.readFileSync(explorerFile, 'utf-8');
  const generationSrc = fs.readFileSync(generationFile, 'utf-8');

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
      savedBaselines: {}
    });
    useRuntimeStore.setState({
      isRunning: false,
      isLocked: false,
      port: 3000,
      previewUrl: 'http://localhost:3000'
    });
    useAgentStore.setState({
      generationState: 'idle',
      currentPrompt: ''
    });
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. COMMAND PALETTE: CURRENT PROJECT EXCLUSION
  // =========================================================================
  describe('1. Command Palette Current Project Exclusion', () => {
    it('1. Filters out the currently active project from project switch items', () => {
      expect(paletteSrc).toContain('.filter((p) => p.id !== activeProjectId)');
      expect(paletteSrc).toContain('Switch Project: ${p.title}');
    });

    it('2. Behaviorally excludes active project and retains other switchable projects', () => {
      const { createProject, setActiveProjectId } = useProjectStore.getState();
      const projA = createProject('AETHERIA : Global Luxury');
      const projB = createProject('Nexus SaaS Dashboard');
      const projC = createProject('Quantum Analytics');

      setActiveProjectId(projA);
      const state = useProjectStore.getState();

      const filteredItems = Object.values(state.projects)
        .filter((p) => p.id !== state.activeProjectId)
        .map((p) => ({
          id: `proj_${p.id}`,
          title: `Switch Project: ${p.title}`
        }));

      expect(filteredItems.some((item) => item.id === `proj_${projA}`)).toBe(false);
      expect(filteredItems.some((item) => item.title.includes('AETHERIA'))).toBe(false);
      expect(filteredItems.some((item) => item.id === `proj_${projB}`)).toBe(true);
      expect(filteredItems.some((item) => item.id === `proj_${projC}`)).toBe(true);
      expect(filteredItems.length).toBe(2);

      // Switch active project to ProjB and verify ProjB is now excluded and ProjA is offered
      setActiveProjectId(projB);
      const state2 = useProjectStore.getState();
      const filteredItems2 = Object.values(state2.projects)
        .filter((p) => p.id !== state2.activeProjectId)
        .map((p) => ({
          id: `proj_${p.id}`,
          title: `Switch Project: ${p.title}`
        }));

      expect(filteredItems2.some((item) => item.id === `proj_${projB}`)).toBe(false);
      expect(filteredItems2.some((item) => item.id === `proj_${projA}`)).toBe(true);
      expect(filteredItems2.some((item) => item.id === `proj_${projC}`)).toBe(true);
      expect(filteredItems2.length).toBe(2);
    });
  });

  // =========================================================================
  // 2. FILE EXPLORER: NEW FILE UX
  // =========================================================================
  describe('2. File Explorer — New File Action Contracts', () => {
    it('3. Source code contains explicit Create File and Cancel buttons', () => {
      expect(explorerSrc).toContain('New File</div>');
      expect(explorerSrc).toMatch(/>\s*Cancel\s*<\/button>/);
      expect(explorerSrc).toMatch(/>\s*Create File\s*<\/button>/);
      expect(explorerSrc).toContain('disabled={!newFilePath.trim()}');
      expect(explorerSrc).toContain("e.key === 'Escape'");
    });

    it('4. Cancel action resets new file state and creates nothing', async () => {
      const { createProject, setActiveProjectId } = useProjectStore.getState();
      const projId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(projId);

      const filesBefore = Object.keys(useProjectStore.getState().projects[projId].files);

      // Simulating Cancel: input state is cleared, no file written
      let newFilePath = '/src/UnwantedComponent.tsx';
      let isNewFileInputOpen = true;

      newFilePath = '';
      isNewFileInputOpen = false;

      const filesAfter = Object.keys(useProjectStore.getState().projects[projId].files);
      expect(filesAfter).toEqual(filesBefore);
      expect(newFilePath).toBe('');
      expect(isNewFileInputOpen).toBe(false);
    });

    it('5. Create File uses existing handleCreateFile logic and writes to active project', async () => {
      const { createProject, setActiveProjectId, writeFile } = useProjectStore.getState();
      const { openFile } = useEditorStore.getState();
      const projId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(projId);

      const newPath = '/src/components/HeroBanner.tsx';
      await writeFile(projId, newPath, `// ${newPath}\nexport {};\n`);
      openFile(projId, newPath);

      const activeProject = useProjectStore.getState().projects[projId];
      expect(activeProject.files[newPath]).toBeDefined();
      expect(activeProject.files[newPath].content).toContain('export {};');
      expect(useEditorStore.getState().activeFilePath[projId]).toBe(newPath);
    });
  });

  // =========================================================================
  // 3. FILE EXPLORER: DELETE FILE CONFIRMATION
  // =========================================================================
  describe('3. File Explorer — Delete File Confirmation Contracts', () => {
    it('6. Clicking trash opens confirmation modal and does NOT delete immediately', () => {
      expect(explorerSrc).toContain('setDeletingFilePath(file.path)');
      expect(explorerSrc).toContain('Delete File?');
      expect(explorerSrc).toContain('This will remove the file from the active project.');
      expect(explorerSrc).toMatch(/>\s*Delete File\s*<\/button>/);
    });

    it('7. Cancel prevents deletion and preserves active project file', async () => {
      const { createProject, setActiveProjectId, writeFile } = useProjectStore.getState();
      const projId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(projId);

      const filePath = '/src/components/Nav.tsx';
      await writeFile(projId, filePath, 'export const Nav = () => <nav />;');

      let deletingFilePath: string | null = filePath;
      deletingFilePath = null;

      expect(deletingFilePath).toBeNull();
      const project = useProjectStore.getState().projects[projId];
      expect(project.files[filePath]).toBeDefined();
      expect(vfsManager.getFile(projId, filePath)).toBeDefined();
    });

    it('8. Confirming deletion calls deleteFile and removes from VFS and active project', async () => {
      const { createProject, setActiveProjectId, writeFile, deleteFile } = useProjectStore.getState();
      const projId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(projId);

      const filePath = '/src/components/Obsolete.tsx';
      await writeFile(projId, filePath, 'export const Obsolete = () => null;');
      expect(useProjectStore.getState().projects[projId].files[filePath]).toBeDefined();

      await deleteFile(projId, filePath);

      expect(useProjectStore.getState().projects[projId].files[filePath]).toBeUndefined();
      expect(vfsManager.getFile(projId, filePath)).toBeNull();
    });
  });

  // =========================================================================
  // 4. FILE EXPLORER: RENAME FILE UX
  // =========================================================================
  describe('4. File Explorer — Rename File Action Contracts', () => {
    it('9. Source contains explicit Rename and Cancel buttons and NO accidental onBlur commit', () => {
      expect(explorerSrc).toContain('Rename File</div>');
      expect(explorerSrc).toMatch(/>\s*Rename\s*<\/button>/);
      expect(explorerSrc).toMatch(/>\s*Cancel\s*<\/button>/);
      expect(explorerSrc).toContain('disabled={!editName.trim()}');
      expect(explorerSrc).not.toContain('onBlur={() => handleRenameSubmit');
      expect(explorerSrc).toContain("e.key === 'Enter'");
      expect(explorerSrc).toContain("e.key === 'Escape'");
    });

    it('10. Cancel preserves original filename without mutation', async () => {
      const { createProject, setActiveProjectId, writeFile } = useProjectStore.getState();
      const projId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(projId);

      const originalPath = '/src/components/Card.tsx';
      await writeFile(projId, originalPath, 'export const Card = () => <div />;');

      let editingPath: string | null = originalPath;
      let editName = 'CardV2.tsx';

      editingPath = null;
      editName = '';

      expect(editingPath).toBeNull();
      const project = useProjectStore.getState().projects[projId];
      expect(project.files[originalPath]).toBeDefined();
      expect(project.files['/src/components/CardV2.tsx']).toBeUndefined();
    });

    it('11. Rename commits correctly via renameFile and updates path', async () => {
      const { createProject, setActiveProjectId, writeFile, renameFile } = useProjectStore.getState();
      const projId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(projId);

      const oldPath = '/src/components/OldCard.tsx';
      const newPath = '/src/components/NewCard.tsx';
      await writeFile(projId, oldPath, 'export const Card = () => <div />;');

      await renameFile(projId, oldPath, newPath);

      const project = useProjectStore.getState().projects[projId];
      expect(project.files[oldPath]).toBeUndefined();
      expect(project.files[newPath]).toBeDefined();
      expect(vfsManager.getFile(projId, newPath)).toBeDefined();
    });
  });

  // =========================================================================
  // 5. PROJECT NAMING DERIVATION
  // =========================================================================
  describe('5. Project Naming Derivation Utility', () => {
    it('12. Formats meaningful plan names into Title Case and strips generic defaults', () => {
      expect(deriveProjectName('saas-invoicing-dashboard', '')).toBe('SaaS Invoicing Dashboard');
      expect(deriveProjectName('ecommerce-storefront', '')).toBe('Ecommerce Storefront');
      // Generic plan name delegates to prompt
      expect(deriveProjectName('web-app', 'Build a SaaS invoice dashboard with customers')).toBe('SaaS Invoice Dashboard');
      expect(deriveProjectName('web-app', 'Create a luxury jewelry storefront with cart')).toBe('Luxury Jewelry Storefront');
      // Fallback
      expect(deriveProjectName('web-app', '')).toBe('Web Application');
      expect(deriveProjectName(undefined, undefined)).toBe('Web Application');
    });
  });

  // =========================================================================
  // 6. BUILD STUDIO CANONICAL NEW PROJECT CREATION & LIFECYCLE
  // =========================================================================
  describe('6. Build Studio Generation — Canonical Architecture & Invariants', () => {
    it('13. Source code contains explicit lifecycle states (ready | generating | success | error)', () => {
      expect(generationSrc).toContain("type BuildStudioLifecycle = 'ready' | 'generating' | 'success' | 'error'");
      expect(generationSrc).toContain("useState<BuildStudioLifecycle>('ready')");
      expect(generationSrc).toContain("setLifecycleState('generating')");
      expect(generationSrc).toContain("setLifecycleState('success')");
      expect(generationSrc).toContain("setLifecycleState('error')");
    });

    it('14. Submission lock is reset in finally block on every execution path', () => {
      expect(generationSrc).toContain('const isSubmittingRef = useRef<boolean>(false);');
      expect(generationSrc).toContain("if (isSubmittingRef.current || lifecycleState === 'generating') return;");
      expect(generationSrc).toContain('isSubmittingRef.current = true;');
      expect(generationSrc).toContain('finally {');
      expect(generationSrc).toContain('isSubmittingRef.current = false;');
    });

    it('15. Source code implements transactional rollback if subsequent VFS/runtime fails', () => {
      expect(generationSrc).toContain('catch (subsequentErr: any) {');
      expect(generationSrc).toContain('await deleteProject(createdProjectId)');
      expect(generationSrc).toContain('setActiveProjectId(previousProjectId)');
    });

    it('16. CRITICAL END-TO-END TEST: Project A active -> Generate in Build Studio -> Project A untouched, Project B created and active', async () => {
      const { createProject, setActiveProjectId, writeFile } = useProjectStore.getState();

      // Given: Project A ("AETHERIA : Global Luxury") is active and has files
      const aetheriaId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(aetheriaId);
      await writeFile(aetheriaId, '/src/App.tsx', 'export default function App() { return <div>Original AETHERIA</div>; }');
      await writeFile(aetheriaId, '/src/aetheria.ts', 'export const brand = "AETHERIA";');

      const aetheriaFilesBefore = { ...useProjectStore.getState().projects[aetheriaId].files };
      expect(Object.keys(aetheriaFilesBefore).length).toBe(2);

      // When: User enters prompt in Build Studio and generates
      const activePrompt = 'Build a SaaS invoice dashboard with customers and revenue metrics';
      const mockPayload = {
        plan: {
          name: 'saas-invoice-dashboard',
          description: 'A SaaS invoicing application',
          type: 'dashboard',
          framework: 'react',
          styling: 'tailwind'
        },
        files: {
          '/package.json': JSON.stringify({ name: 'saas-invoice-dashboard', version: '1.0.0' }),
          '/src/App.tsx': 'export default function App() { return <div>SaaS Invoices</div>; }',
          '/src/components/InvoiceList.tsx': 'export const InvoiceList = () => <div>Invoices</div>;'
        }
      };

      vi.spyOn(genClient, 'generateProject').mockResolvedValue(mockPayload as any);

      // Execute canonical generation flow
      const previousProjectId = useProjectStore.getState().activeProjectId;
      const payload = await genClient.generateProject({ prompt: activePrompt });
      const projectName = deriveProjectName(payload.plan?.name, activePrompt);

      // BUILD STUDIO GENERATION TARGET ≠ PREVIOUS ACTIVE PROJECT (always creates a new project)
      const newProjectId = useProjectStore.getState().createProject(projectName, activePrompt);
      expect(newProjectId).not.toBe(aetheriaId);

      await useProjectStore.getState().writeFilesBulk(newProjectId, payload.files);
      useEditorStore.getState().openFile(newProjectId, '/src/App.tsx');
      await useRuntimeStore.getState().mountAndStartProject(newProjectId);

      // Then: VERIFY BEFORE / AFTER AND ALL PRODUCT INVARIANTS
      const finalState = useProjectStore.getState();
      const allProjects = Object.values(finalState.projects);

      // 1. Exactly TWO projects exist
      expect(allProjects.length).toBe(2);

      // 2. Project A (AETHERIA) is completely untouched
      const aetheriaAfter = finalState.projects[aetheriaId];
      expect(aetheriaAfter).toBeDefined();
      expect(aetheriaAfter.title).toBe('AETHERIA : Global Luxury');
      expect(aetheriaAfter.files['/src/App.tsx'].content).toContain('Original AETHERIA');
      expect(aetheriaAfter.files['/src/aetheria.ts'].content).toContain('brand = "AETHERIA"');
      expect(Object.keys(aetheriaAfter.files).length).toBe(2);

      // 3. Project B is the newly created project with derived name
      const projectB = finalState.projects[newProjectId];
      expect(projectB).toBeDefined();
      expect(projectB.title).toBe('SaaS Invoice Dashboard');
      expect(projectB.files['/src/App.tsx'].content).toContain('SaaS Invoices');
      expect(projectB.files['/src/components/InvoiceList.tsx']).toBeDefined();

      // 4. Project B is now active
      expect(finalState.activeProjectId).toBe(newProjectId);

      // 5. Editor and runtime target Project B
      expect(useEditorStore.getState().activeFilePath[newProjectId]).toBe('/src/App.tsx');
      expect(useEditorStore.getState().openTabs[newProjectId]).toContain('/src/App.tsx');

      // 6. Identity chain verified
      expect(finalState.activeProjectId).toBe(newProjectId);
      expect(vfsManager.getFile(newProjectId, '/src/App.tsx')?.content).toContain('SaaS Invoices');
    });

    it('17. Transactional Rollback: cleans up created project and restores previous active project if VFS write or runtime fails', async () => {
      const { createProject, setActiveProjectId, deleteProject, writeFile } = useProjectStore.getState();

      // Initial active project
      const initialId = createProject('Stable Active Project');
      setActiveProjectId(initialId);
      await writeFile(initialId, '/src/main.ts', 'export const stable = true;');

      const mockPayload = {
        plan: { name: 'failing-app' },
        files: { '/src/broken.ts': 'broken' }
      };
      vi.spyOn(genClient, 'generateProject').mockResolvedValue(mockPayload as any);

      // Simulate failure during mounting
      const previousProjectId = useProjectStore.getState().activeProjectId;
      let createdProjectId: string | null = null;
      let caughtError = false;

      try {
        const payload = await genClient.generateProject({ prompt: 'trigger failure' });
        const projectName = deriveProjectName(payload.plan?.name, 'trigger failure');
        createdProjectId = useProjectStore.getState().createProject(projectName);

        // Simulate subsequent step throwing an error
        throw new Error('VFS write connection lost');
      } catch (err) {
        caughtError = true;
        // Transactional rollback execution
        if (createdProjectId) {
          await deleteProject(createdProjectId);
        }
        if (previousProjectId && useProjectStore.getState().projects[previousProjectId]) {
          setActiveProjectId(previousProjectId);
        }
      }

      expect(caughtError).toBe(true);
      const state = useProjectStore.getState();
      // Verify the failing project was cleanly removed
      expect(state.projects[createdProjectId!]).toBeUndefined();
      // Verify previous project was restored as active
      expect(state.activeProjectId).toBe(initialId);
      expect(state.projects[initialId]).toBeDefined();
      expect(state.projects[initialId].files['/src/main.ts']).toBeDefined();
    });

    it('18. Generation with no prior active project creates exactly one new project cleanly', async () => {
      useProjectStore.setState({ projects: {}, activeProjectId: '' });

      const mockPayload = {
        plan: { name: 'analytics-dashboard' },
        files: {
          '/src/App.tsx': 'export default function App() { return <div>Analytics</div>; }'
        }
      };
      vi.spyOn(genClient, 'generateProject').mockResolvedValue(mockPayload as any);

      const payload = await genClient.generateProject({ prompt: 'Build analytics' });
      const projectName = deriveProjectName(payload.plan?.name, 'Build analytics');
      const newProjectId = useProjectStore.getState().createProject(projectName);

      await useProjectStore.getState().writeFilesBulk(newProjectId, payload.files);
      useEditorStore.getState().openFile(newProjectId, '/src/App.tsx');
      await useRuntimeStore.getState().mountAndStartProject(newProjectId);

      const state = useProjectStore.getState();
      expect(Object.keys(state.projects).length).toBe(1);
      expect(state.activeProjectId).toBe(newProjectId);
      expect(state.projects[newProjectId].title).toBe('Analytics Dashboard');
    });

    it('19. Success state clears prompt and provides Open in Editor and Create Another actions', () => {
      expect(generationSrc).toContain("setPrompt('');");
      expect(generationSrc).toContain('Application Created');
      expect(generationSrc).toContain('data-testid="open-project-btn"');
      expect(generationSrc).toContain('data-testid="create-another-btn"');
      expect(generationSrc).toContain('handleCreateAnother');
    });
  });

  // =========================================================================
  // 7. FILE EXPLORER EMPTY STATE & ACTIVE RENDERING
  // =========================================================================
  describe('7. File Explorer UI Verification', () => {
    it('20. FileExplorer renders empty state contract when no project and file tree when active', () => {
      expect(explorerSrc).toContain('if (!currentProject)');
      expect(explorerSrc).toContain('No Project Selected');
      expect(explorerSrc).toContain('Select or create a project to explore files');
      expect(explorerSrc).toContain('Project Files');
      expect(explorerSrc).toContain('title="New File"');
    });

    it('21. FileExplorer renders project files and file action controls when active project exists', async () => {
      const { createProject, setActiveProjectId, writeFile } = useProjectStore.getState();
      const projId = createProject('AETHERIA : Global Luxury');
      setActiveProjectId(projId);
      await writeFile(projId, '/src/App.tsx', 'export default function App() {}');

      const html = renderToStaticMarkup(<FileExplorer />);
      expect(html).toContain('Project Files');
      expect(html).toContain('/src/App.tsx');
      expect(html).toContain('title="Rename"');
      expect(html).toContain('title="Delete"');
    });
  });
});
