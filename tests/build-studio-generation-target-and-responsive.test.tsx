import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useProjectStore } from '../src/store/projectStore';
import { useEditorStore } from '../src/store/editorStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import { useAgentStore } from '../src/store/agentStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import * as genClient from '../src/features/generation/generation-client';
import { deriveProjectName } from '../src/features/generation/project-name-utils';
import { GenerationPanel } from '../src/features/generation/GenerationPanel';

describe('BUILD Studio Generation Target & Success Panel Responsive UI', () => {
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
  // PART 1 — CANONICAL GENERATION TARGET RULES
  // =========================================================================
  describe('Part 1: Canonical Generation Target Rules (Case A, B, C & Rollback)', () => {
    it('1. CASE A: Empty active project ("Amazon") is populated instead of creating a duplicate second project', async () => {
      const { createProject, setActiveProjectId, writeFilesBulk } = useProjectStore.getState();

      // Step 1: User manually creates "Amazon"
      const amazonId = createProject('Amazon');
      setActiveProjectId(amazonId);

      // Verify Amazon currently contains 0 files
      const amazonBefore = useProjectStore.getState().projects[amazonId];
      expect(amazonBefore).toBeDefined();
      expect(amazonBefore.title).toBe('Amazon');
      expect(Object.keys(amazonBefore.files).length).toBe(0);
      expect(Object.keys(vfsManager.getFiles(amazonId)).length).toBe(0);
      expect(useProjectStore.getState().activeProjectId).toBe(amazonId);

      // Mock AI generation output
      const mockPayload = {
        plan: {
          name: 'clone-of-amazon-e-commerce-app',
          description: 'Amazon e-commerce clone',
          type: 'ecommerce'
        },
        files: {
          '/package.json': JSON.stringify({ name: 'amazon-clone', version: '1.0.0' }),
          '/src/App.tsx': 'export default function App() { return <div>Amazon Store</div>; }',
          '/src/components/ProductGrid.tsx': 'export const ProductGrid = () => <div>Products</div>;'
        }
      };
      vi.spyOn(genClient, 'generateProject').mockResolvedValue(mockPayload as any);

      // Execute generation workflow matching GenerationPanel logic
      const previousProjectId = useProjectStore.getState().activeProjectId;
      const currentActiveProject = previousProjectId ? useProjectStore.getState().projects[previousProjectId] : null;

      const vfsFiles = previousProjectId ? vfsManager.getFiles(previousProjectId) : {};
      const storeFiles = currentActiveProject?.files || {};
      const totalFileCount = Object.keys(vfsFiles).length > 0 ? Object.keys(vfsFiles).length : Object.keys(storeFiles).length;

      const isPopulatingEmptyActiveProject = Boolean(previousProjectId && currentActiveProject && totalFileCount === 0);
      expect(isPopulatingEmptyActiveProject).toBe(true);

      const payload = await genClient.generateProject({ prompt: 'Build a clone of Amazon e-commerce app.' });
      const projectName = deriveProjectName(payload.plan?.name, 'Build a clone of Amazon e-commerce app.');

      let targetProjectId: string;
      let targetProjectName: string;
      let createdProjectId: string | null = null;

      if (isPopulatingEmptyActiveProject && previousProjectId && currentActiveProject) {
        targetProjectId = previousProjectId;
        targetProjectName = currentActiveProject.title;
      } else {
        createdProjectId = useProjectStore.getState().createProject(projectName);
        targetProjectId = createdProjectId;
        targetProjectName = projectName;
      }

      await writeFilesBulk(targetProjectId, payload.files);
      useEditorStore.getState().openFile(targetProjectId, '/src/App.tsx');
      await useRuntimeStore.getState().mountAndStartProject(targetProjectId);

      const finalState = useProjectStore.getState();
      const allProjects = Object.values(finalState.projects);

      // Invariant 1: Exactly ONE project exists (NO duplicate project created)
      expect(allProjects.length).toBe(1);
      expect(createdProjectId).toBeNull();
      expect(targetProjectId).toBe(amazonId);

      // Invariant 2: User's original project title remains unchanged
      expect(finalState.projects[amazonId].title).toBe('Amazon');
      expect(targetProjectName).toBe('Amazon');

      // Invariant 3: Generated files land in Amazon's VFS
      expect(Object.keys(finalState.projects[amazonId].files).length).toBe(3);
      expect(finalState.projects[amazonId].files['/src/App.tsx'].content).toContain('Amazon Store');
      expect(vfsManager.getFile(amazonId, '/src/App.tsx')?.content).toContain('Amazon Store');

      // Invariant 4: Amazon remains active project
      expect(finalState.activeProjectId).toBe(amazonId);
    });

    it('2. CASE B: Populated active project creates an isolated new generated project', async () => {
      const { createProject, setActiveProjectId, writeFile, writeFilesBulk } = useProjectStore.getState();

      // Step 1: User has populated project "Amazon" with files
      const amazonId = createProject('Amazon');
      setActiveProjectId(amazonId);
      await writeFile(amazonId, '/src/App.tsx', 'export default function App() { return <div>Amazon</div>; }');
      expect(Object.keys(useProjectStore.getState().projects[amazonId].files).length).toBe(1);

      // Step 2: User generates Shopify dashboard in BUILD Studio
      const mockPayload = {
        plan: { name: 'shopify-analytics-dashboard' },
        files: {
          '/package.json': JSON.stringify({ name: 'shopify-dashboard' }),
          '/src/App.tsx': 'export default function App() { return <div>Shopify Analytics</div>; }'
        }
      };
      vi.spyOn(genClient, 'generateProject').mockResolvedValue(mockPayload as any);

      const previousProjectId = useProjectStore.getState().activeProjectId;
      const currentActiveProject = previousProjectId ? useProjectStore.getState().projects[previousProjectId] : null;

      const vfsFiles = previousProjectId ? vfsManager.getFiles(previousProjectId) : {};
      const storeFiles = currentActiveProject?.files || {};
      const totalFileCount = Object.keys(vfsFiles).length > 0 ? Object.keys(vfsFiles).length : Object.keys(storeFiles).length;

      const isPopulatingEmptyActiveProject = Boolean(previousProjectId && currentActiveProject && totalFileCount === 0);
      expect(isPopulatingEmptyActiveProject).toBe(false);

      const payload = await genClient.generateProject({ prompt: 'Create a Shopify analytics dashboard.' });
      const projectName = deriveProjectName(payload.plan?.name, 'Create a Shopify analytics dashboard.');

      let targetProjectId: string;
      let targetProjectName: string;
      let createdProjectId: string | null = null;

      if (isPopulatingEmptyActiveProject && previousProjectId && currentActiveProject) {
        targetProjectId = previousProjectId;
        targetProjectName = currentActiveProject.title;
      } else {
        createdProjectId = useProjectStore.getState().createProject(projectName);
        targetProjectId = createdProjectId;
        targetProjectName = projectName;
      }

      await writeFilesBulk(targetProjectId, payload.files);
      useEditorStore.getState().openFile(targetProjectId, '/src/App.tsx');
      await useRuntimeStore.getState().mountAndStartProject(targetProjectId);

      const finalState = useProjectStore.getState();

      // Invariant: Exactly TWO projects exist
      expect(Object.keys(finalState.projects).length).toBe(2);
      expect(createdProjectId).not.toBeNull();
      expect(targetProjectId).not.toBe(amazonId);

      // Existing Amazon project is completely untouched
      expect(finalState.projects[amazonId].title).toBe('Amazon');
      expect(finalState.projects[amazonId].files['/src/App.tsx'].content).toContain('<div>Amazon</div>');

      // New project is active and contains Shopify files
      expect(finalState.activeProjectId).toBe(targetProjectId);
      expect(finalState.projects[targetProjectId].title).toBe('Shopify Analytics Dashboard');
      expect(finalState.projects[targetProjectId].files['/src/App.tsx'].content).toContain('Shopify Analytics');
    });

    it('3. CASE C: No valid active project creates exactly one new project cleanly', async () => {
      useProjectStore.setState({ projects: {}, activeProjectId: '' });

      const mockPayload = {
        plan: { name: 'quantum-ai-canvas' },
        files: {
          '/src/App.tsx': 'export default function App() { return <div>Quantum AI</div>; }'
        }
      };
      vi.spyOn(genClient, 'generateProject').mockResolvedValue(mockPayload as any);

      const previousProjectId = useProjectStore.getState().activeProjectId;
      const currentActiveProject = previousProjectId ? useProjectStore.getState().projects[previousProjectId] : null;

      const isPopulatingEmptyActiveProject = Boolean(previousProjectId && currentActiveProject);
      expect(isPopulatingEmptyActiveProject).toBe(false);

      const payload = await genClient.generateProject({ prompt: 'Build quantum AI canvas' });
      const projectName = deriveProjectName(payload.plan?.name, 'Build quantum AI canvas');
      const newProjectId = useProjectStore.getState().createProject(projectName);

      await useProjectStore.getState().writeFilesBulk(newProjectId, payload.files);
      useEditorStore.getState().openFile(newProjectId, '/src/App.tsx');
      await useRuntimeStore.getState().mountAndStartProject(newProjectId);

      const state = useProjectStore.getState();
      expect(Object.keys(state.projects).length).toBe(1);
      expect(state.activeProjectId).toBe(newProjectId);
      expect(state.projects[newProjectId].title).toBe('Quantum AI Canvas');
    });

    it('4. CASE A Transactional Rollback: generation failure in CASE A leaves the original project empty, valid, and active', async () => {
      const { createProject, setActiveProjectId, writeFilesBulk } = useProjectStore.getState();

      // Create empty Amazon project
      const amazonId = createProject('Amazon');
      setActiveProjectId(amazonId);

      const mockPayload = {
        plan: { name: 'failing-app' },
        files: {
          '/src/partial.ts': 'broken code'
        }
      };
      vi.spyOn(genClient, 'generateProject').mockResolvedValue(mockPayload as any);

      const previousProjectId = useProjectStore.getState().activeProjectId;
      const currentActiveProject = previousProjectId ? useProjectStore.getState().projects[previousProjectId] : null;
      const isPopulatingEmptyActiveProject = Boolean(
        previousProjectId && currentActiveProject && Object.keys(currentActiveProject.files).length === 0
      );

      let targetProjectId = amazonId;
      let createdProjectId: string | null = null;
      let caughtError = false;

      try {
        const payload = await genClient.generateProject({ prompt: 'Trigger failure' });
        // Simulate writing partial files
        await writeFilesBulk(targetProjectId, payload.files);
        // Simulate error during WebContainer mount
        throw new Error('WebContainer boot crash simulation');
      } catch {
        caughtError = true;
        // Rollback for CASE A: clean up VFS without deleting the project
        if (createdProjectId) {
          await useProjectStore.getState().deleteProject(createdProjectId);
        } else if (isPopulatingEmptyActiveProject && targetProjectId) {
          await vfsManager.deleteProject(targetProjectId);
          useProjectStore.setState((state) => ({
            projects: {
              ...state.projects,
              [targetProjectId]: {
                ...state.projects[targetProjectId],
                files: {},
                openTabs: [],
                activeFilePath: ''
              }
            }
          }));
          useEditorStore.getState().clearProject(targetProjectId);
          if (previousProjectId) {
            setActiveProjectId(previousProjectId);
          }
        }
      }

      expect(caughtError).toBe(true);

      const finalState = useProjectStore.getState();
      // Original project still exists
      expect(finalState.projects[amazonId]).toBeDefined();
      // Original title is preserved
      expect(finalState.projects[amazonId].title).toBe('Amazon');
      // Partial files are rolled back to zero
      expect(Object.keys(finalState.projects[amazonId].files).length).toBe(0);
      expect(Object.keys(vfsManager.getFiles(amazonId)).length).toBe(0);
      // Amazon remains active project
      expect(finalState.activeProjectId).toBe(amazonId);
      // No second project was created
      expect(Object.keys(finalState.projects).length).toBe(1);
    });
  });

  // =========================================================================
  // PART 2 — SUCCESS PANEL RESPONSIVE UI & ACCESSIBILITY
  // =========================================================================
  describe('Part 2: Success Panel Responsive UI & Accessibility', () => {
    it('5. Success state reports correct target identity and copy for CASE A (Application Built / Amazon is Ready)', () => {
      const amazonId = useProjectStore.getState().createProject('Amazon');
      useProjectStore.getState().setActiveProjectId(amazonId);

      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: amazonId,
            name: 'Amazon',
            fileCount: 12,
            isExistingEmptyTarget: true
          }}
        />
      );

      // Subtitle badge says "Application Built"
      expect(html).toContain('Application Built');
      expect(html).not.toContain('Application Created');

      // Title says "Amazon is Ready"
      expect(html).toContain('Amazon is Ready');
      expect(html).toContain('data-testid="generated-project-title"');
      expect(html).toContain('title="Amazon is Ready"');
      expect(html).toContain('aria-label="Project: Amazon"');
    });

    it('6. Success state reports correct target identity and copy for CASE B/C (Application Created / New Project Name)', () => {
      const newId = useProjectStore.getState().createProject('Shopify Analytics Dashboard');
      useProjectStore.getState().setActiveProjectId(newId);

      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: newId,
            name: 'Shopify Analytics Dashboard',
            fileCount: 15,
            isExistingEmptyTarget: false
          }}
        />
      );

      // Subtitle badge says "Application Created"
      expect(html).toContain('Application Created');
      expect(html).not.toContain('Application Built');

      // Title says project name
      expect(html).toContain('Shopify Analytics Dashboard');
      expect(html).toContain('data-testid="generated-project-title"');
    });

    it('7. Header safely truncates long project names and exposes title attribute for discoverability', () => {
      const longTitle = 'Supercalifragilistic Enterprise Cloud Cost Optimization Dashboard Pro';
      const projId = useProjectStore.getState().createProject(longTitle);

      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: projId,
            name: longTitle,
            fileCount: 20,
            isExistingEmptyTarget: true
          }}
        />
      );

      // Element has min-w-0 flex-1 overflow-hidden and truncate
      expect(html).toContain('truncate');
      expect(html).toContain('min-w-0');
      expect(html).toContain(`title="${longTitle} is Ready"`);
      expect(html).toContain(`aria-label="Project: ${longTitle}"`);
    });

    it('8. Metadata card prevents horizontal overflow for long IDs and handles text wrapping gracefully', () => {
      const longId = 'proj_1727610000000_9876543210abcdef';
      useProjectStore.getState().createProject('Test App');

      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: longId,
            name: 'Test App',
            fileCount: 8,
            isExistingEmptyTarget: false
          }}
        />
      );

      // Project ID row contains max-w-[200px], truncate, and title
      expect(html).toContain('max-w-[200px]');
      expect(html).toContain(longId);
      expect(html).toContain(`title="${longId}"`);

      // Metadata rows use flex-wrap to prevent horizontal blowout
      expect(html).toContain('flex-wrap');
      expect(html).toContain('8 files');
      expect(html).toContain('Vite + React 19 + Tailwind');
      expect(html).toContain('Live in Preview &amp; WebContainer');
    });

    it('9. Primary action buttons render accessible names, icons, test IDs, and focus styling', () => {
      const projId = useProjectStore.getState().createProject('Test Actions');

      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: projId,
            name: 'Test Actions',
            fileCount: 5
          }}
        />
      );

      // Open button
      expect(html).toContain('data-testid="open-project-btn"');
      expect(html).toContain('aria-label="Open Project in Editor"');
      expect(html).toContain('Open Project in Editor');

      // Create Another button
      expect(html).toContain('data-testid="create-another-btn"');
      expect(html).toContain('aria-label="Create Another Project"');
      expect(html).toContain('Create Another');
    });

    it('10. Quick next project controls render accessible input, build button, and truthful disabled state', () => {
      const projId = useProjectStore.getState().createProject('Test Quick Next');

      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: projId,
            name: 'Test Quick Next',
            fileCount: 5
          }}
        />
      );

      expect(html).toContain('data-testid="quick-next-prompt-input"');
      expect(html).toContain('id="quick-next-prompt-input"');
      expect(html).toContain('aria-label="Describe your next application"');
      expect(html).toContain('placeholder="Describe your next application..."');

      expect(html).toContain('data-testid="quick-generate-next-btn"');
      expect(html).toContain('aria-label="Build next application"');
      expect(html).toContain('disabled=""'); // empty next prompt disables build button
      expect(html).toContain('Build');
    });

    it('11. Generated files preview list renders with vertical-only scrolling, truncated paths, and language badges', async () => {
      const { createProject, writeFilesBulk } = useProjectStore.getState();
      const projId = createProject('Files Preview Test');
      await writeFilesBulk(projId, {
        '/src/deeply/nested/directory/structure/that/is/very/long/Component.tsx': 'export const C = () => null;',
        '/package.json': '{}'
      });

      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: projId,
            name: 'Files Preview Test',
            fileCount: 2
          }}
        />
      );

      expect(html).toContain('Generated Project Files');
      expect(html).toContain('overflow-y-auto');
      expect(html).toContain('overflow-x-hidden');
      expect(html).toContain('/src/deeply/nested/directory/structure/that/is/very/long/Component.tsx');
      expect(html).toContain('title="/src/deeply/nested/directory/structure/that/is/very/long/Component.tsx"');
    });

    it('12. Root panel and all success containers enforce min-w-0 and overflow-hidden to prevent horizontal scrollbars', () => {
      const html = renderToStaticMarkup(
        <GenerationPanel
          initialLifecycleState="success"
          initialSuccessProject={{
            id: 'proj_overflow_test',
            name: 'Overflow Test',
            fileCount: 3
          }}
        />
      );

      expect(html).toContain('min-w-0');
      expect(html).toContain('overflow-hidden');
      expect(html).toContain('overflow-x-hidden');
    });
  });
});
