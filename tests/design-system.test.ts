import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  DesignSystem, 
  DesignSystemOperationGuard 
} from '../src/features/design-system/design-system-types';
import { designSystemAnalyzer } from '../src/features/design-system/design-system-analyzer';
import { designSystemValidator } from '../src/features/design-system/design-system-validator';
import { designSystemDriftEngine } from '../src/features/design-system/design-system-drift';
import { designSystemApplier } from '../src/features/design-system/design-system-applier';
import { designSystemContextBuilder } from '../src/features/design-system/design-system-context';
import { useDesignSystemStore } from '../src/store/designSystemStore';
import { useProjectStore } from '../src/store/projectStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { runtimeManager } from '../src/lib/runtime/runtime-manager';
import { verificationService } from '../src/features/verification/VerificationService';
import { visualEditService } from '../src/features/visual-editing/visual-edit-service';
import { chatService } from '../src/features/chat/chat-service';
import { createVisualSelection } from '../src/features/visual-editing/visual-selection';

describe('Tier 2.5 — Design Systems Test Suite', () => {
  const projectIdA = 'test-proj-ds-a';
  const projectIdB = 'test-proj-ds-b';

  const sampleCss = `
    :root {
      --color-primary: #6366f1;
      --color-secondary: #10b981;
      --color-bg: #0f172a;
      --color-surface: #1e293b;
      --font-body: Inter, sans-serif;
      --radius-sm: 4px;
      --radius-md: 12px;
    }
  `;

  const sampleTailwindConfig = `
    module.exports = {
      theme: {
        extend: {
          colors: {
            brand: '#6366f1',
            accent: '#8b5cf6'
          }
        }
      }
    };
  `;

  const sampleAppTsx = `
    import React from 'react';
    export const App = () => (
      <div className="min-h-screen bg-[#0f172a] text-white p-6">
        <button className="px-4 py-2 bg-[#6366f1] rounded-xl">Action</button>
        <div className="p-4 bg-[#ff0000]">Divergent Box</div>
      </div>
    );
  `;

  beforeEach(async () => {
    vi.restoreAllMocks();
    useDesignSystemStore.getState().clearAllDesignSystems();

    // Populate VFS for test projects
    await vfsManager.writeFile(projectIdA, '/src/index.css', sampleCss);
    await vfsManager.writeFile(projectIdA, '/tailwind.config.js', sampleTailwindConfig);
    await vfsManager.writeFile(projectIdA, '/src/App.tsx', sampleAppTsx);

    await vfsManager.writeFile(projectIdB, '/src/index.css', sampleCss);
    await vfsManager.writeFile(projectIdB, '/src/App.tsx', sampleAppTsx);
  });

  // ===========================================================================
  // SECTION A: Schema & Data Model
  // ===========================================================================
  describe('Section A: Schema & Data Model', () => {
    it('1. valid DesignSystem model contains all required semantic categories and metadata', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA, 'Alpha DS');

      expect(ds.projectId).toBe(projectIdA);
      expect(ds.name).toBe('Alpha DS');
      expect(ds.version).toBe(1);
      expect(ds.colors.primary).toBe('#6366f1');
      expect(ds.typography.fontFamily).toBeDefined();
      expect(ds.spacing.md).toBe('16px');
      expect(ds.radii.lg).toBe('12px');
      expect(ds.shadows.md).toBeDefined();
      expect(ds.borders.defaultWidth).toBe('1px');
      expect(ds.breakpoints.md).toBe('768px');
      expect(ds.componentPatterns.length).toBeGreaterThan(0);
      expect(ds.status).toBe('active');
    });

    it('2. invalid token values and empty tokens are detected during validation', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      // Corrupt a color token with malformed format
      const corrupted: DesignSystem = {
        ...ds,
        colors: {
          ...ds.colors,
          primary: 'not-a-color-12345'
        }
      };

      const result = designSystemValidator.validateDesignSystem(corrupted, guard);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_COLOR_FORMAT')).toBe(true);
    });

    it('3. schema version is monotonically tracked and validated', () => {
      const store = useDesignSystemStore.getState();
      const ds1 = store.createDefaultDesignSystem(projectIdA);
      expect(ds1.version).toBe(1);

      store.updateTokenValue(projectIdA, 'color.primary', '#7c3aed');
      const ds2 = store.getDesignSystem(projectIdA);
      expect(ds2?.version).toBe(2);
      expect(ds2?.colors.primary).toBe('#7c3aed');
    });
  });

  // ===========================================================================
  // SECTION B: VFS Extraction
  // ===========================================================================
  describe('Section B: Extraction', () => {
    it('4. extracts CSS variables from project stylesheets', async () => {
      const files = vfsManager.getFiles(projectIdA);
      const guard: DesignSystemOperationGuard = {
        operationId: 'op_test_extract',
        projectId: projectIdA,
        designSystemVersion: 1
      };

      const ds = await designSystemAnalyzer.analyzeProjectVfs(projectIdA, files, guard);
      expect(ds.tokens['token_css_color-primary']).toBeDefined();
      expect(ds.tokens['token_css_color-primary'].value).toBe('#6366f1');
      expect(ds.tokens['token_css_color-surface'].value).toBe('#1e293b');
    });

    it('5. extracts Tailwind tokens from tailwind.config file', async () => {
      const files = vfsManager.getFiles(projectIdA);
      const guard: DesignSystemOperationGuard = {
        operationId: 'op_test_tw',
        projectId: projectIdA,
        designSystemVersion: 1
      };

      const ds = await designSystemAnalyzer.analyzeProjectVfs(projectIdA, files, guard);
      expect(ds.tokens['token_tw_brand']).toBeDefined();
      expect(ds.tokens['token_tw_brand'].value).toBe('#6366f1');
    });

    it('6. extracts typography scale and font families', async () => {
      const files = vfsManager.getFiles(projectIdA);
      const guard: DesignSystemOperationGuard = {
        operationId: 'op_test_typo',
        projectId: projectIdA,
        designSystemVersion: 1
      };

      const ds = await designSystemAnalyzer.analyzeProjectVfs(projectIdA, files, guard);
      expect(ds.typography.fontFamily).toContain('Inter');
      expect(ds.typography.sizes.base).toBe('16px');
      expect(ds.typography.weights.bold).toBe('700');
    });

    it('7. extracts spacing and radius conventions', async () => {
      const files = vfsManager.getFiles(projectIdA);
      const guard: DesignSystemOperationGuard = {
        operationId: 'op_test_spacing',
        projectId: projectIdA,
        designSystemVersion: 1
      };

      const ds = await designSystemAnalyzer.analyzeProjectVfs(projectIdA, files, guard);
      expect(ds.spacing.sm).toBe('8px');
      expect(ds.radii.lg).toBe('12px');
    });

    it('8. extracts reusable component patterns (Button, Card, Input)', async () => {
      const files = vfsManager.getFiles(projectIdA);
      const guard: DesignSystemOperationGuard = {
        operationId: 'op_test_components',
        projectId: projectIdA,
        designSystemVersion: 1
      };

      const ds = await designSystemAnalyzer.analyzeProjectVfs(projectIdA, files, guard);
      expect(ds.componentPatterns.length).toBeGreaterThanOrEqual(2);
      expect(ds.componentPatterns.some(p => p.role === 'action')).toBe(true);
      expect(ds.componentPatterns.some(p => p.role === 'container')).toBe(true);
    });

    it('9. records extraction source metadata and confidence scores', async () => {
      const files = vfsManager.getFiles(projectIdA);
      const guard: DesignSystemOperationGuard = {
        operationId: 'op_test_meta',
        projectId: projectIdA,
        designSystemVersion: 1
      };

      const ds = await designSystemAnalyzer.analyzeProjectVfs(projectIdA, files, guard);
      expect(ds.sourceMetadata.sourceType).toBe('project_vfs');
      expect(ds.sourceMetadata.confidence).toBeGreaterThanOrEqual(0.85);
      expect(ds.sourceMetadata.sourceFiles).toContain('/src/index.css');
    });
  });

  // ===========================================================================
  // SECTION C: Normalization & Precedence
  // ===========================================================================
  describe('Section C: Normalization & Precedence', () => {
    it('10. normalizes raw CSS variable keys into standard semantic categories', async () => {
      const files = {
        '/src/vars.css': ':root { --primary: #4f46e5; --spacing-large: 24px; --rounded-box: 8px; }'
      };
      const guard: DesignSystemOperationGuard = { operationId: 'op_norm', projectId: projectIdA, designSystemVersion: 1 };
      const ds = await designSystemAnalyzer.analyzeProjectVfs(projectIdA, files, guard);

      expect(ds.tokens['token_css_primary'].category).toBe('color');
      expect(ds.tokens['token_css_spacing-large'].category).toBe('spacing');
      expect(ds.tokens['token_css_rounded-box'].category).toBe('radius');
    });

    it('11. explicit user tokens outrank inferred values and are preserved', () => {
      const store = useDesignSystemStore.getState();
      store.createDefaultDesignSystem(projectIdA);
      store.updateTokenValue(projectIdA, 'color.primary', '#9333ea');

      const ds = store.getDesignSystem(projectIdA)!;
      expect(ds.colors.primary).toBe('#9333ea');
      expect(ds.tokens['color.primary'].source).toBe('user_explicit');
      expect(ds.tokens['color.primary'].confidence).toBe(1.0);
    });

    it('12. screenshot-derived candidate tokens cannot silently overwrite user explicit tokens', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      // Explicitly set primary
      store.updateTokenValue(projectIdA, 'color.primary', '#4338ca');
      const explicitDs = store.getDesignSystem(projectIdA)!;

      // Simulate incoming screenshot candidate trying to overwrite primary
      const screenshotCandidates = { 'color.primary': '#ef4444', 'color.accent': '#ec4899' };
      const merged = designSystemAnalyzer.mergeScreenshotCandidates(explicitDs, screenshotCandidates, guard);

      // Explicit token preserved
      expect(merged.tokens['color.primary'].value).toBe('#4338ca');
      expect(merged.tokens['color.primary'].source).toBe('user_explicit');

      // Non-conflicting candidate added
      expect(merged.tokens['token_screenshot_color.accent'].value).toBe('#ec4899');
      expect(merged.tokens['token_screenshot_color.accent'].source).toBe('screenshot_derived');
    });
  });

  // ===========================================================================
  // SECTION D: AI Context
  // ===========================================================================
  describe('Section D: AI Context', () => {
    it('13. design system context generation formats compact structured rules', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      const aiContext = designSystemContextBuilder.buildCompactAIContext(ds, guard);
      expect(aiContext).toContain('[PROJECT DESIGN SYSTEM:');
      expect(aiContext).toContain('primary: #6366f1');
      expect(aiContext).toContain('Typography: Heading="Inter');
      expect(aiContext).toContain('Spacing Scale:');
    });

    it('14. compact context serializes efficiently without dumping massive raw CSS', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      const aiContext = designSystemContextBuilder.buildCompactAIContext(ds, guard);
      expect(aiContext.length).toBeLessThan(1000);
    });

    it('15. secrets and sensitive credentials are never included in design system context', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      const aiContext = designSystemContextBuilder.buildCompactAIContext(ds, guard);
      expect(aiContext).not.toMatch(/ghp_/);
      expect(aiContext).not.toMatch(/sk-/);
      expect(aiContext).not.toMatch(/postgres:\/\//);
    });

    it('16. AI Chat Service includes active design system in getSafeAiDesignSystemContext', () => {
      const store = useDesignSystemStore.getState();
      store.createDefaultDesignSystem(projectIdA);

      const context = chatService.getSafeAiDesignSystemContext(projectIdA);
      expect(context).toContain('[PROJECT DESIGN SYSTEM:');
      expect(context).toContain('#6366f1');
    });

    it('17. Visual AI Edit context includes designSystemContext', () => {
      const store = useDesignSystemStore.getState();
      store.createDefaultDesignSystem(projectIdA);

      const selection = createVisualSelection(projectIdA, { tagName: 'button' }, {
        filePath: '/src/App.tsx',
        confidence: 0.9,
        strategy: 'data_attribute' as const,
        canRefuseSpeculativePatch: false
      });

      const context = visualEditService.buildVisualEditContext(projectIdA, 'Make blue', selection);
      expect(context.designSystemContext).toBeDefined();
      expect(context.designSystemContext).toContain('primary: #6366f1');
    });

    it('18. Visual AI Edit proposal synthesis incorporates design system constraints into prompt', async () => {
      const store = useDesignSystemStore.getState();
      store.createDefaultDesignSystem(projectIdA);

      const selection = createVisualSelection(projectIdA, { tagName: 'button' }, {
        filePath: '/src/App.tsx',
        confidence: 0.9,
        strategy: 'data_attribute' as const,
        canRefuseSpeculativePatch: false
      });

      const context = visualEditService.buildVisualEditContext(projectIdA, 'Harmonize button style', selection);
      const proposal = await visualEditService.synthesizeVisualEditProposal(context);

      expect(proposal.files.length).toBeGreaterThan(0);
      expect(proposal.files[0].path).toBe('/src/App.tsx');
    });

    it('19. Screenshot candidate tokens integrate into design system without overwriting user rules', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      const candidates = { 'color.custom-accent': '#d946ef' };
      const updated = designSystemAnalyzer.mergeScreenshotCandidates(ds, candidates, guard);

      expect(updated.tokens['token_screenshot_color.custom-accent']).toBeDefined();
      expect(updated.tokens['token_screenshot_color.custom-accent'].value).toBe('#d946ef');
    });
  });

  // ===========================================================================
  // SECTION E: Controlled Editing & Pipeline
  // ===========================================================================
  describe('Section E: Controlled Editing & Pipeline', () => {
    it('20. token edit creates an EditProposal targeting CSS custom properties', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);
      const files = vfsManager.getFiles(projectIdA);

      const proposal = designSystemApplier.generateApplyProposal(ds, files, guard);

      expect(proposal.files.length).toBe(1);
      expect(proposal.files[0].path).toBe('/src/index.css');
      expect(proposal.files[0].after).toContain('--color-primary: #6366f1');
    });

    it('21. rejection of design system proposal causes zero VFS, runtime, or snapshot mutations', () => {
      const beforeFiles = vfsManager.getFiles(projectIdA);
      const snapshotSpy = vi.spyOn(snapshotService, 'createSnapshot');
      const runtimeSpy = vi.spyOn(runtimeManager, 'replaceProject');

      const res = designSystemApplier.rejectProposal(projectIdA);
      expect(res.rejected).toBe(true);

      const afterFiles = vfsManager.getFiles(projectIdA);
      expect(afterFiles).toEqual(beforeFiles);
      expect(snapshotSpy).not.toHaveBeenCalled();
      expect(runtimeSpy).not.toHaveBeenCalled();
    });

    it('22. approval applies proposal via canonical editExecutor pipeline', async () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);
      const files = vfsManager.getFiles(projectIdA);

      const proposal = designSystemApplier.generateApplyProposal(ds, files, guard);

      const snapshotSpy = vi.spyOn(snapshotService, 'createSnapshot');
      vi.spyOn(runtimeManager, 'replaceProject').mockResolvedValue(undefined as any);
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: true,
        checks: [{ name: 'Build check', success: true }],
        totalDurationMs: 50
      });

      const res = await designSystemApplier.applyProposal(projectIdA, proposal);
      expect(res.verified).toBe(true);
      expect(snapshotSpy).toHaveBeenCalledWith(projectIdA, expect.stringContaining('Before AI edit'));

      const modifiedCss = vfsManager.getFile(projectIdA, '/src/index.css');
      expect(modifiedCss?.content).toContain('--color-primary: #6366f1');
    });

    it('23. pre-edit snapshot is recorded prior to applying design system source code modifications', async () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);
      const files = vfsManager.getFiles(projectIdA);

      const proposal = designSystemApplier.generateApplyProposal(ds, files, guard);
      const snapshotSpy = vi.spyOn(snapshotService, 'createSnapshot');
      vi.spyOn(runtimeManager, 'replaceProject').mockResolvedValue(undefined as any);
      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: true,
        checks: [{ name: 'TS check', success: true }],
        totalDurationMs: 40
      });

      await designSystemApplier.applyProposal(projectIdA, proposal);
      expect(snapshotSpy).toHaveBeenCalled();
    });

    it('24. verification failure safely triggers automatic rollback', async () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);
      const files = vfsManager.getFiles(projectIdA);

      const proposal = designSystemApplier.generateApplyProposal(ds, files, guard);

      vi.spyOn(verificationService, 'runFullVerification').mockResolvedValue({
        success: false,
        checks: [{ name: 'Compile check', success: false, error: 'Simulated CSS syntax error' }],
        totalDurationMs: 90
      });
      const rollbackSpy = vi.spyOn(snapshotService, 'restoreSnapshot');

      const res = await designSystemApplier.applyProposal(projectIdA, proposal);
      expect(res.verified).toBe(false);
      expect(res.rolledBack).toBe(true);
      expect(rollbackSpy).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // SECTION F: Drift Detection
  // ===========================================================================
  describe('Section F: Drift Detection', () => {
    it('25. detects hardcoded divergent values in components (e.g. #ff0000 in App.tsx)', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);
      const files = vfsManager.getFiles(projectIdA);

      const drifts = designSystemDriftEngine.detectDrift(ds, files, guard);
      expect(drifts.length).toBeGreaterThan(0);
      expect(drifts.some(d => d.currentValue === '#ff0000')).toBe(true);
      expect(drifts[0].filePath).toBe('/src/App.tsx');
    });

    it('26. matching design tokens do not create false positive drift', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      // Clean files matching only design tokens
      const cleanFiles = {
        '/src/App.tsx': '<div className="bg-[#6366f1] text-[#f8fafc]">Clean Component</div>'
      };

      const drifts = designSystemDriftEngine.detectDrift(ds, cleanFiles, guard);
      expect(drifts.length).toBe(0);
    });

    it('27. drift correction generates a reviewable EditProposal without auto-mutating source', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);
      const files = vfsManager.getFiles(projectIdA);

      const drifts = designSystemDriftEngine.detectDrift(ds, files, guard);
      const proposal = designSystemDriftEngine.generateDriftCorrectionProposal(ds, drifts, files, guard);

      expect(proposal.files.length).toBe(1);
      expect(proposal.files[0].path).toBe('/src/App.tsx');
      expect(proposal.files[0].after).toContain('#6366f1'); // Replaced #ff0000 with primary
      expect(proposal.files[0].after).not.toContain('#ff0000');

      // Check VFS is untouched before approval
      const vfsContent = vfsManager.getFile(projectIdA, '/src/App.tsx')?.content;
      expect(vfsContent).toContain('#ff0000');
    });
  });

  // ===========================================================================
  // SECTION G: Validation Engine
  // ===========================================================================
  describe('Section G: Validation Engine', () => {
    it('28. detects duplicate token names across categories', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      const withDupes: DesignSystem = {
        ...ds,
        tokens: {
          token_1: { name: 'primary-color', category: 'color', value: '#6366f1', type: 'color', source: 'manual', confidence: 1.0 },
          token_2: { name: 'primary-color', category: 'color', value: '#4f46e5', type: 'color', source: 'manual', confidence: 1.0 }
        }
      };

      const res = designSystemValidator.validateDesignSystem(withDupes, guard);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.code === 'DUPLICATE_TOKEN')).toBe(true);
    });

    it('29. detects malformed CSS dimensions and units', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      const withInvalidDim: DesignSystem = {
        ...ds,
        spacing: {
          ...ds.spacing,
          md: 'invalid_dimension_xyz'
        }
      };

      const res = designSystemValidator.validateDesignSystem(withInvalidDim, guard);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.code === 'INVALID_DIMENSION')).toBe(true);
    });

    it('30. detects broken / unresolved CSS variable token references', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);
      const guard = store.createGuard(projectIdA);

      const withBrokenRef: DesignSystem = {
        ...ds,
        tokens: {
          test_token: {
            name: 'button-bg',
            category: 'color',
            value: 'var(--nonexistent-variable-123)',
            type: 'color',
            source: 'manual',
            confidence: 1.0
          }
        }
      };

      const res = designSystemValidator.validateDesignSystem(withBrokenRef, guard);
      expect(res.warnings.some(w => w.code === 'UNRESOLVED_TOKEN_REF')).toBe(true);
    });
  });

  // ===========================================================================
  // SECTION H: Import / Export
  // ===========================================================================
  describe('Section H: Import / Export', () => {
    it('31. exports portable JSON and round-trips correctly on import', () => {
      const store = useDesignSystemStore.getState();
      store.createDefaultDesignSystem(projectIdA, 'Exportable DS');
      store.updateTokenValue(projectIdA, 'color.primary', '#06b6d4');

      const jsonStr = store.exportDesignSystem(projectIdA);
      expect(jsonStr).toContain('schemaVersion');
      expect(jsonStr).toContain('#06b6d4');

      // Import into project B
      const res = store.importDesignSystem(projectIdB, jsonStr);
      expect(res.success).toBe(true);

      const importedDs = store.getDesignSystem(projectIdB);
      expect(importedDs?.colors.primary).toBe('#06b6d4');
      expect(importedDs?.importSources.length).toBeGreaterThan(0);
    });

    it('32. malformed or truncated JSON import is rejected safely', () => {
      const store = useDesignSystemStore.getState();
      const res = store.importDesignSystem(projectIdA, '{"schemaVersion": "1.0", truncated...');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Malformed JSON payload');
    });

    it('33. prototype pollution attempts in imported JSON are blocked', () => {
      const store = useDesignSystemStore.getState();
      const maliciousJson = JSON.stringify({
        schemaVersion: '1.0.0',
        ['__proto__']: { admin: true },
        designSystem: {
          name: 'Evil DS',
          colors: { primary: '#000000' },
          typography: {}
        }
      });

      const res = store.importDesignSystem(projectIdA, maliciousJson);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Illegal property detected');
    });

    it('34. imported design system never mutates VFS source code automatically', () => {
      const store = useDesignSystemStore.getState();
      const vfsBefore = vfsManager.getFile(projectIdA, '/src/index.css')?.content;

      const validJson = JSON.stringify({
        schemaVersion: '1.0.0',
        designSystem: {
          name: 'Imported Theme',
          colors: { primary: '#e11d48', secondary: '#10b981' },
          typography: { fontFamily: 'Geist, sans-serif' }
        }
      });

      const res = store.importDesignSystem(projectIdA, validJson);
      expect(res.success).toBe(true);

      const vfsAfter = vfsManager.getFile(projectIdA, '/src/index.css')?.content;
      expect(vfsAfter).toBe(vfsBefore);
    });
  });

  // ===========================================================================
  // SECTION I: Project Isolation & Race Safety
  // ===========================================================================
  describe('Section I: Project Isolation & Race Safety', () => {
    it('35. Project A design system state is strictly isolated from Project B', () => {
      const store = useDesignSystemStore.getState();
      store.createDefaultDesignSystem(projectIdA, 'DS A');
      store.createDefaultDesignSystem(projectIdB, 'DS B');

      store.updateTokenValue(projectIdA, 'color.primary', '#123456');
      store.updateTokenValue(projectIdB, 'color.primary', '#abcdef');

      expect(store.getDesignSystem(projectIdA)?.colors.primary).toBe('#123456');
      expect(store.getDesignSystem(projectIdB)?.colors.primary).toBe('#abcdef');
    });

    it('36. project deletion in projectStore cleans up design system state automatically', async () => {
      const projectStore = useProjectStore.getState();
      const dsStore = useDesignSystemStore.getState();

      const tempId = projectStore.createProject('DS Cleanup Proj', 'Test');
      dsStore.createDefaultDesignSystem(tempId, 'Temp DS');

      expect(dsStore.getDesignSystem(tempId)).not.toBeNull();

      await projectStore.deleteProject(tempId);

      expect(dsStore.getDesignSystem(tempId)).toBeNull();
    });

    it('37. stale operation guards reject results from superseded operations', () => {
      const store = useDesignSystemStore.getState();
      store.createDefaultDesignSystem(projectIdA);

      const guard1 = store.createGuard(projectIdA);
      expect(store.isGuardActive(guard1)).toBe(true);

      // Newer operation starts
      const guard2 = store.createGuard(projectIdA);
      expect(store.isGuardActive(guard1)).toBe(false); // guard1 is now stale!
      expect(store.isGuardActive(guard2)).toBe(true);
    });

    it('38. concurrent project safety: operation guard rejects mismatched project or version', () => {
      const store = useDesignSystemStore.getState();
      const ds = store.createDefaultDesignSystem(projectIdA);

      const mismatchedGuard: DesignSystemOperationGuard = {
        operationId: 'op_mismatch',
        projectId: projectIdB, // Mismatched projectId!
        designSystemVersion: 1
      };

      expect(() => {
        designSystemValidator.validateDesignSystem(ds, mismatchedGuard);
      }).toThrow(/Project mismatch/);
    });
  });
});
