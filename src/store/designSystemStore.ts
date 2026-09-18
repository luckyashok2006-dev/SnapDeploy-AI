import { create } from 'zustand';
import { 
  DesignSystem, 
  DesignSystemDrift, 
  DesignSystemValidationResult,
  DesignSystemOperationGuard,
  DesignSystemExportPayload 
} from '../features/design-system/design-system-types';
import { validateNoPrototypePollution, sanitizeDescription, sanitizeTokenName } from '../features/design-system/design-system-security';

export type DesignSystemSubTab = 'overview' | 'tokens' | 'components' | 'sources' | 'drift';

export interface DesignSystemState {
  projectDesignSystems: Record<string, DesignSystem | null>;
  projectDrifts: Record<string, DesignSystemDrift[]>;
  projectValidations: Record<string, DesignSystemValidationResult | null>;
  projectOperations: Record<string, string>; // Tracks current active operationId per project
  activeSubTab: DesignSystemSubTab;
  isAnalyzing: boolean;
  isGeneratingProposal: boolean;
  error: string | null;

  getDesignSystem: (projectId: string) => DesignSystem | null;
  getDrifts: (projectId: string) => DesignSystemDrift[];
  getValidation: (projectId: string) => DesignSystemValidationResult | null;
  getCurrentVersion: (projectId: string) => number;

  setDesignSystem: (projectId: string, ds: DesignSystem | null) => void;
  createDefaultDesignSystem: (projectId: string, name?: string) => DesignSystem;
  updateTokenValue: (projectId: string, tokenKey: string, newValue: string) => void;
  setDrifts: (projectId: string, drifts: DesignSystemDrift[]) => void;
  setValidation: (projectId: string, validation: DesignSystemValidationResult | null) => void;
  setActiveSubTab: (tab: DesignSystemSubTab) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
  setIsGeneratingProposal: (generating: boolean) => void;
  setError: (err: string | null) => void;

  createGuard: (projectId: string) => DesignSystemOperationGuard;
  isGuardActive: (guard: DesignSystemOperationGuard) => boolean;

  clearProjectDesignSystem: (projectId: string) => void;
  clearAllDesignSystems: () => void;

  exportDesignSystem: (projectId: string) => string;
  importDesignSystem: (projectId: string, jsonContent: string) => { success: boolean; error?: string };
}

export const useDesignSystemStore = create<DesignSystemState>((set, get) => ({
  projectDesignSystems: {},
  projectDrifts: {},
  projectValidations: {},
  projectOperations: {},
  activeSubTab: 'overview',
  isAnalyzing: false,
  isGeneratingProposal: false,
  error: null,

  getDesignSystem: (projectId) => get().projectDesignSystems[projectId] || null,
  getDrifts: (projectId) => get().projectDrifts[projectId] || [],
  getValidation: (projectId) => get().projectValidations[projectId] || null,
  getCurrentVersion: (projectId) => get().projectDesignSystems[projectId]?.version || 1,

  setDesignSystem: (projectId, ds) =>
    set((state) => ({
      projectDesignSystems: { ...state.projectDesignSystems, [projectId]: ds },
      error: null
    })),

  createDefaultDesignSystem: (projectId, name) => {
    const ds: DesignSystem = {
      projectId,
      name: name || `${projectId} Design System`,
      version: 1,
      description: 'Default project design system foundation.',
      colors: {
        primary: '#6366f1',
        secondary: '#10b981',
        accent: '#8b5cf6',
        background: '#0f172a',
        surface: '#1e293b',
        foreground: '#f8fafc',
        muted: '#94a3b8',
        border: '#334155',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444'
      },
      typography: {
        fontFamily: 'Inter, system-ui, sans-serif',
        headingFamily: 'Inter, system-ui, sans-serif',
        bodyFamily: 'system-ui, sans-serif',
        monoFamily: 'JetBrains Mono, monospace',
        sizes: {
          xs: '12px',
          sm: '14px',
          base: '16px',
          lg: '18px',
          xl: '20px',
          '2xl': '24px',
          '3xl': '30px'
        },
        weights: {
          normal: '400',
          medium: '500',
          semibold: '600',
          bold: '700'
        },
        lineHeights: {
          tight: '1.25',
          normal: '1.5',
          relaxed: '1.75'
        }
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        '2xl': '48px'
      },
      radii: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        full: '9999px'
      },
      shadows: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
        xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)'
      },
      borders: {
        defaultWidth: '1px',
        style: 'solid',
        color: '#334155'
      },
      breakpoints: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px'
      },
      componentPatterns: [
        {
          name: 'Primary Button',
          role: 'action',
          classes: 'px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md transition',
          tokens: { background: '#6366f1', radius: '12px' },
          properties: { padding: '8px 16px', radius: '12px', background: '#6366f1' }
        },
        {
          name: 'Elevated Card',
          role: 'container',
          classes: 'p-6 rounded-2xl bg-slate-900 border border-white/10 shadow-xl',
          tokens: { surface: '#1e293b', border: '#334155' },
          properties: { padding: '24px', radius: '16px', background: '#1e293b' }
        }
      ],
      tokens: {
        'color.primary': {
          name: 'primary',
          category: 'color',
          value: '#6366f1',
          type: 'color',
          source: 'user_explicit',
          confidence: 1.0,
          cssVariable: '--color-primary'
        },
        'color.secondary': {
          name: 'secondary',
          category: 'color',
          value: '#10b981',
          type: 'color',
          source: 'user_explicit',
          confidence: 1.0,
          cssVariable: '--color-secondary'
        }
      },
      sourceMetadata: {
        sourceType: 'manual',
        extractedAt: Date.now(),
        sourceFiles: [],
        confidence: 1.0
      },
      importSources: [],
      status: 'active',
      updatedAt: Date.now()
    };

    set((state) => ({
      projectDesignSystems: { ...state.projectDesignSystems, [projectId]: ds },
      error: null
    }));

    return ds;
  },

  updateTokenValue: (projectId, tokenKey, newValue) => {
    const ds = get().projectDesignSystems[projectId];
    if (!ds) return;

    const newVersion = ds.version + 1;
    const updatedColors = { ...ds.colors };
    const updatedTokens = { ...ds.tokens };

    if (tokenKey === 'primary' || tokenKey === 'color.primary') {
      updatedColors.primary = newValue;
    } else if (tokenKey === 'secondary' || tokenKey === 'color.secondary') {
      updatedColors.secondary = newValue;
    } else if (tokenKey === 'surface' || tokenKey === 'color.surface') {
      updatedColors.surface = newValue;
    } else if (tokenKey === 'background' || tokenKey === 'color.background') {
      updatedColors.background = newValue;
    }

    if (updatedTokens[tokenKey]) {
      updatedTokens[tokenKey] = {
        ...updatedTokens[tokenKey],
        value: newValue,
        source: 'user_explicit',
        confidence: 1.0
      };
    } else {
      updatedTokens[tokenKey] = {
        name: sanitizeTokenName(tokenKey),
        category: 'color',
        value: newValue,
        type: 'color',
        source: 'user_explicit',
        confidence: 1.0
      };
    }

    const updatedDs: DesignSystem = {
      ...ds,
      version: newVersion,
      colors: updatedColors,
      tokens: updatedTokens,
      updatedAt: Date.now()
    };

    set((state) => ({
      projectDesignSystems: { ...state.projectDesignSystems, [projectId]: updatedDs }
    }));
  },

  setDrifts: (projectId, drifts) =>
    set((state) => ({
      projectDrifts: { ...state.projectDrifts, [projectId]: drifts }
    })),

  setValidation: (projectId, validation) =>
    set((state) => ({
      projectValidations: { ...state.projectValidations, [projectId]: validation }
    })),

  setActiveSubTab: (tab) => set({ activeSubTab: tab }),
  setIsAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),
  setIsGeneratingProposal: (generating) => set({ isGeneratingProposal: generating }),
  setError: (error) => set({ error }),

  createGuard: (projectId) => {
    const operationId = `op_ds_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const designSystemVersion = get().getCurrentVersion(projectId);

    set((state) => ({
      projectOperations: { ...state.projectOperations, [projectId]: operationId }
    }));

    return { operationId, projectId, designSystemVersion };
  },

  isGuardActive: (guard) => {
    const currentOp = get().projectOperations[guard.projectId];
    const currentVer = get().getCurrentVersion(guard.projectId);
    return currentOp === guard.operationId && currentVer === guard.designSystemVersion;
  },

  clearProjectDesignSystem: (projectId) =>
    set((state) => {
      const pds = { ...state.projectDesignSystems };
      const pd = { ...state.projectDrifts };
      const pv = { ...state.projectValidations };
      const po = { ...state.projectOperations };
      delete pds[projectId];
      delete pd[projectId];
      delete pv[projectId];
      delete po[projectId];
      return {
        projectDesignSystems: pds,
        projectDrifts: pd,
        projectValidations: pv,
        projectOperations: po,
        error: null
      };
    }),

  clearAllDesignSystems: () =>
    set({
      projectDesignSystems: {},
      projectDrifts: {},
      projectValidations: {},
      projectOperations: {},
      isAnalyzing: false,
      isGeneratingProposal: false,
      error: null
    }),

  exportDesignSystem: (projectId) => {
    const ds = get().projectDesignSystems[projectId];
    if (!ds) {
      throw new Error(`No active design system found for project '${projectId}'`);
    }

    const { projectId: _, ...dsWithoutProject } = ds;
    const payload: DesignSystemExportPayload = {
      schemaVersion: '1.0.0',
      exportedAt: Date.now(),
      designSystem: dsWithoutProject,
      provenance: {
        source: 'SnapDeploy AI Studio',
        exportedBy: 'SnapDeploy Design System Engine'
      }
    };

    return JSON.stringify(payload, null, 2);
  },

  importDesignSystem: (projectId, jsonContent) => {
    try {
      if (!jsonContent || typeof jsonContent !== 'string') {
        return { success: false, error: 'Empty or invalid import payload.' };
      }

      // Pre-parse guard for prototype pollution strings
      if (/"(?:__proto__|constructor|prototype)"\s*:/i.test(jsonContent)) {
        return { success: false, error: "Illegal property detected in design system import: '__proto__'" };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonContent);
      } catch (err: any) {
        return { success: false, error: 'Malformed JSON payload.' };
      }

      // 1. Prototype pollution guard
      const protoCheck = validateNoPrototypePollution(parsed);
      if (!protoCheck.valid) {
        return { success: false, error: protoCheck.error };
      }

      // 2. Schema validation
      if (!parsed.schemaVersion) {
        return { success: false, error: 'Invalid design system payload: missing schemaVersion.' };
      }

      const rawDs = parsed.designSystem || parsed;
      if (!rawDs.colors || !rawDs.typography) {
        return { success: false, error: 'Invalid design system payload: missing essential colors or typography.' };
      }

      const existingVer = get().getCurrentVersion(projectId);
      const newVersion = existingVer + 1;

      const importedDs: DesignSystem = {
        projectId,
        name: sanitizeTokenName(rawDs.name || `${projectId} Design System`),
        version: newVersion,
        description: sanitizeDescription(rawDs.description || 'Imported design system'),
        colors: {
          primary: rawDs.colors.primary || '#6366f1',
          secondary: rawDs.colors.secondary || '#10b981',
          accent: rawDs.colors.accent || '#8b5cf6',
          background: rawDs.colors.background || '#0f172a',
          surface: rawDs.colors.surface || '#1e293b',
          foreground: rawDs.colors.foreground || '#f8fafc',
          muted: rawDs.colors.muted || '#94a3b8',
          border: rawDs.colors.border || '#334155',
          success: rawDs.colors.success || '#22c55e',
          warning: rawDs.colors.warning || '#f59e0b',
          danger: rawDs.colors.danger || '#ef4444',
          custom: rawDs.colors.custom || {}
        },
        typography: rawDs.typography,
        spacing: rawDs.spacing || { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', '2xl': '48px' },
        radii: rawDs.radii || { sm: '4px', md: '8px', lg: '12px', xl: '16px', full: '9999px' },
        shadows: rawDs.shadows || { sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)', md: '0 4px 6px -1px rgb(0 0 0 / 0.1)', lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)', xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)' },
        borders: rawDs.borders || { defaultWidth: '1px', style: 'solid', color: '#334155' },
        breakpoints: rawDs.breakpoints || { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
        componentPatterns: rawDs.componentPatterns || [],
        tokens: rawDs.tokens || {},
        sourceMetadata: {
          sourceType: 'imported',
          extractedAt: Date.now(),
          sourceFiles: [],
          confidence: 0.95
        },
        importSources: [
          ...(rawDs.importSources || []),
          {
            id: `import_${Date.now()}`,
            name: rawDs.name || 'External Design System',
            importedAt: Date.now(),
            format: 'snapdeploy.design-system.json',
            version: parsed.schemaVersion
          }
        ],
        status: 'active',
        updatedAt: Date.now()
      };

      set((state) => ({
        projectDesignSystems: { ...state.projectDesignSystems, [projectId]: importedDs },
        error: null
      }));

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to import design system.' };
    }
  }
}));
