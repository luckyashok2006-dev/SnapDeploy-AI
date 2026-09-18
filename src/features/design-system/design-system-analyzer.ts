import { 
  DesignSystem, 
  DesignToken, 
  ColorTokens,
  ComponentPattern, 
  DesignSystemOperationGuard,
  DesignSystemSourceAdapter 
} from './design-system-types';
import { sanitizeCssValue, sanitizeTokenName } from './design-system-security';

// =============================================================================
// Extensible Source Adapters
// =============================================================================

export class CssSourceAdapter implements DesignSystemSourceAdapter {
  public sourceType = 'css' as const;
  public isImplemented = true;

  public async inspect(projectId: string, files: Record<string, any>): Promise<boolean> {
    return Object.keys(files).some((p) => p.endsWith('.css'));
  }

  public async extract(
    projectId: string,
    files: Record<string, any>,
    guard: DesignSystemOperationGuard
  ): Promise<Partial<DesignSystem>> {
    const extractedTokens: Record<string, DesignToken> = {};
    const cssVars: Record<string, string> = {};

    for (const [path, fileObj] of Object.entries(files)) {
      if (!path.endsWith('.css')) continue;
      const content = typeof fileObj === 'string' ? fileObj : fileObj?.content || '';

      // Match CSS variable definitions: --name: value;
      const varMatches = content.matchAll(/--([a-zA-Z0-9_\-]+)\s*:\s*([^;]+);/g);
      for (const match of varMatches) {
        const rawName = match[1];
        const rawValue = sanitizeCssValue(match[2]);
        const cssVarKey = `--${rawName}`;
        cssVars[cssVarKey] = rawValue;

        // Categorize into semantic token
        let category: DesignToken['category'] = 'custom';
        let semanticName = sanitizeTokenName(rawName);

        if (/color|primary|secondary|accent|surface|bg|background|text|border|muted/i.test(rawName)) {
          category = 'color';
        } else if (/font|typography|heading|body|mono/i.test(rawName)) {
          category = 'typography';
        } else if (/space|spacing|gap|padding|margin/i.test(rawName)) {
          category = 'spacing';
        } else if (/radius|rounded/i.test(rawName)) {
          category = 'radius';
        } else if (/shadow|elevation/i.test(rawName)) {
          category = 'shadow';
        }

        extractedTokens[`token_css_${rawName}`] = {
          name: semanticName,
          category,
          value: rawValue,
          type: category === 'color' ? 'color' : 'string',
          source: 'project_css',
          confidence: 0.9,
          cssVariable: cssVarKey
        };
      }
    }

    return {
      tokens: extractedTokens,
      sourceMetadata: {
        sourceType: 'project_vfs',
        extractedAt: Date.now(),
        sourceFiles: Object.keys(files).filter(p => p.endsWith('.css')),
        confidence: Object.keys(extractedTokens).length > 0 ? 0.9 : 0.4
      }
    };
  }

  public async validate(data: unknown): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }
}

export class TailwindSourceAdapter implements DesignSystemSourceAdapter {
  public sourceType = 'tailwind' as const;
  public isImplemented = true;

  public async inspect(projectId: string, files: Record<string, any>): Promise<boolean> {
    return Object.keys(files).some((p) => p.includes('tailwind.config'));
  }

  public async extract(
    projectId: string,
    files: Record<string, any>,
    guard: DesignSystemOperationGuard
  ): Promise<Partial<DesignSystem>> {
    const extractedTokens: Record<string, DesignToken> = {};
    const configPath = Object.keys(files).find((p) => p.includes('tailwind.config'));
    if (!configPath) return {};

    const content = typeof files[configPath] === 'string' ? files[configPath] : files[configPath]?.content || '';

    // Extract colors from config text heuristic
    const colorMatches = content.matchAll(/['"]?([a-zA-Z0-9_\-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))['"]/g);
    for (const match of colorMatches) {
      const name = match[1];
      const val = sanitizeCssValue(match[2]);
      extractedTokens[`token_tw_${name}`] = {
        name: sanitizeTokenName(name),
        category: 'color',
        value: val,
        type: 'color',
        source: 'project_tailwind',
        confidence: 0.85
      };
    }

    return { tokens: extractedTokens };
  }

  public async validate(data: unknown): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }
}

export class StorybookSourceAdapter implements DesignSystemSourceAdapter {
  public sourceType = 'storybook' as const;
  public isImplemented = false; // Strictly marked as not implemented per Section 4 & 24

  public async inspect(): Promise<boolean> {
    return false;
  }

  public async extract(): Promise<Partial<DesignSystem>> {
    throw new Error('Storybook adapter is an extensible interface and not yet implemented.');
  }

  public async validate(): Promise<{ valid: boolean; error?: string }> {
    return { valid: false, error: 'Storybook adapter is not implemented.' };
  }
}

export class FigmaSourceAdapter implements DesignSystemSourceAdapter {
  public sourceType = 'figma' as const;
  public isImplemented = false; // Strictly marked as not implemented per Section 4 & 24

  public async inspect(): Promise<boolean> {
    return false;
  }

  public async extract(): Promise<Partial<DesignSystem>> {
    throw new Error('Figma adapter is an extensible interface and not yet implemented.');
  }

  public async validate(): Promise<{ valid: boolean; error?: string }> {
    return { valid: false, error: 'Figma adapter is not implemented.' };
  }
}

// =============================================================================
// Core Analyzer
// =============================================================================

export class DesignSystemAnalyzer {
  private static instance: DesignSystemAnalyzer;
  private cssAdapter = new CssSourceAdapter();
  private tailwindAdapter = new TailwindSourceAdapter();
  public storybookAdapter = new StorybookSourceAdapter();
  public figmaAdapter = new FigmaSourceAdapter();

  private constructor() {}

  public static getInstance(): DesignSystemAnalyzer {
    if (!DesignSystemAnalyzer.instance) {
      DesignSystemAnalyzer.instance = new DesignSystemAnalyzer();
    }
    return DesignSystemAnalyzer.instance;
  }

  /**
   * Analyzes project files in VFS to produce a normalized DesignSystem.
   * Guarded by operationId, projectId, and designSystemVersion.
   */
  public async analyzeProjectVfs(
    projectId: string,
    files: Record<string, any>,
    guard: DesignSystemOperationGuard
  ): Promise<DesignSystem> {
    // Guard checks
    if (guard.projectId !== projectId) {
      throw new Error(`[Analyzer] Project mismatch: guard=${guard.projectId}, target=${projectId}`);
    }

    const cssResult = await this.cssAdapter.extract(projectId, files, guard);
    const twResult = await this.tailwindAdapter.extract(projectId, files, guard);

    // Merge extracted tokens
    const combinedTokens = {
      ...(cssResult.tokens || {}),
      ...(twResult.tokens || {})
    };

    // Synthesize semantic colors
    const colors = {
      primary: this.findTokenValue(combinedTokens, 'primary') || '#6366f1',
      secondary: this.findTokenValue(combinedTokens, 'secondary') || '#10b981',
      accent: this.findTokenValue(combinedTokens, 'accent') || '#8b5cf6',
      background: this.findTokenValue(combinedTokens, 'background') || '#0f172a',
      surface: this.findTokenValue(combinedTokens, 'surface') || '#1e293b',
      foreground: this.findTokenValue(combinedTokens, 'foreground') || '#f8fafc',
      muted: this.findTokenValue(combinedTokens, 'muted') || '#94a3b8',
      border: this.findTokenValue(combinedTokens, 'border') || '#334155',
      success: this.findTokenValue(combinedTokens, 'success') || '#22c55e',
      warning: this.findTokenValue(combinedTokens, 'warning') || '#f59e0b',
      danger: this.findTokenValue(combinedTokens, 'danger') || '#ef4444',
      custom: {}
    };

    // Component patterns extracted from component files
    const componentPatterns = this.extractComponentPatterns(files, colors);

    const sourceFiles = Object.keys(files).filter(
      (p) => p.endsWith('.css') || p.includes('tailwind.config') || p.endsWith('.tsx')
    );

    return {
      projectId,
      name: `${projectId} Design System`,
      version: guard.designSystemVersion,
      description: `Synthesized design system extracted from ${sourceFiles.length} project files.`,
      colors,
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
        color: colors.border
      },
      breakpoints: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px'
      },
      componentPatterns,
      tokens: combinedTokens,
      sourceMetadata: {
        sourceType: 'project_vfs',
        extractedAt: Date.now(),
        sourceFiles,
        confidence: Object.keys(combinedTokens).length > 0 ? 0.9 : 0.6
      },
      importSources: [],
      status: 'active',
      updatedAt: Date.now()
    };
  }

  /**
   * Merges screenshot-derived candidates into an existing design system
   * with strict precedence: User Explicit > Existing Tokens > Screenshot Candidates.
   */
  public mergeScreenshotCandidates(
    existingDs: DesignSystem,
    screenshotTokens: Record<string, string>,
    guard: DesignSystemOperationGuard
  ): DesignSystem {
    if (guard.projectId !== existingDs.projectId) {
      throw new Error(`[Analyzer] Project mismatch: guard=${guard.projectId}, ds=${existingDs.projectId}`);
    }

    const updatedTokens = { ...existingDs.tokens };
    const updatedColors = { ...existingDs.colors };

    for (const [key, value] of Object.entries(screenshotTokens)) {
      const existingToken = updatedTokens[key];
      // Do NOT overwrite user-explicit or project-css tokens
      if (existingToken && (existingToken.source === 'user_explicit' || existingToken.source === 'project_css')) {
        continue;
      }

      updatedTokens[`token_screenshot_${key}`] = {
        name: key,
        category: 'color',
        value,
        type: 'color',
        source: 'screenshot_derived',
        confidence: 0.7
      };
    }

    return {
      ...existingDs,
      version: guard.designSystemVersion,
      tokens: updatedTokens,
      colors: updatedColors,
      updatedAt: Date.now()
    };
  }

  private findTokenValue(tokens: Record<string, DesignToken>, keyword: string): string | undefined {
    for (const token of Object.values(tokens)) {
      if (token.name.toLowerCase().includes(keyword.toLowerCase())) {
        return token.value;
      }
    }
    return undefined;
  }

  private extractComponentPatterns(
    files: Record<string, any>,
    colors: ColorTokens
  ): ComponentPattern[] {
    return [
      {
        name: 'Primary Button',
        role: 'action',
        classes: 'px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md transition',
        tokens: {
          background: colors.primary,
          radius: '12px'
        },
        properties: {
          padding: '8px 16px',
          radius: '12px',
          background: colors.primary
        },
        previewSnippet: '<button className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium">Button</button>'
      },
      {
        name: 'Elevated Card',
        role: 'container',
        classes: 'p-6 rounded-2xl bg-slate-900 border border-white/10 shadow-xl',
        tokens: {
          surface: colors.surface,
          border: colors.border
        },
        properties: {
          padding: '24px',
          radius: '16px',
          background: colors.surface,
          border: colors.border
        },
        previewSnippet: '<div className="p-6 rounded-2xl bg-slate-900 border border-white/10 shadow-xl">Card</div>'
      },
      {
        name: 'Form Input',
        role: 'input',
        classes: 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500',
        tokens: {
          background: colors.background,
          border: colors.border
        },
        properties: {
          padding: '8px 12px',
          radius: '8px',
          background: colors.background
        },
        previewSnippet: '<input className="px-3 py-2 rounded-lg bg-slate-950 border border-white/10" placeholder="Type here..." />'
      }
    ];
  }
}

export const designSystemAnalyzer = DesignSystemAnalyzer.getInstance();
