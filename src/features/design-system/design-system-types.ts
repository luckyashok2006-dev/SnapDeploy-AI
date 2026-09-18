/**
 * Tier 2.5 — Design System Types & Core Data Models
 */

export type DesignTokenCategory = 
  | 'color'
  | 'typography'
  | 'spacing'
  | 'radius'
  | 'shadow'
  | 'border'
  | 'breakpoint'
  | 'component'
  | 'custom';

export type DesignTokenSource = 
  | 'user_explicit'
  | 'project_css'
  | 'project_tailwind'
  | 'screenshot_derived'
  | 'ai_inferred'
  | 'imported';

export interface DesignToken {
  name: string;
  category: DesignTokenCategory;
  value: string;
  type: 'color' | 'dimension' | 'string' | 'number' | 'composite';
  description?: string;
  source: DesignTokenSource;
  confidence: number; // 0.0 to 1.0
  isCustom?: boolean;
  cssVariable?: string; // e.g. '--color-primary'
}

export interface ColorTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  custom?: Record<string, string>;
}

export interface TypographyTokens {
  fontFamily: string;
  headingFamily: string;
  bodyFamily: string;
  monoFamily: string;
  sizes: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
    '2xl': string;
    '3xl': string;
  };
  weights: {
    normal: string;
    medium: string;
    semibold: string;
    bold: string;
  };
  lineHeights: {
    tight: string;
    normal: string;
    relaxed: string;
  };
  letterSpacing?: {
    normal: string;
    wide: string;
    wider: string;
  };
}

export interface SpacingTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  custom?: Record<string, string>;
}

export interface RadiiTokens {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
  custom?: Record<string, string>;
}

export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  custom?: Record<string, string>;
}

export interface BorderTokens {
  defaultWidth: string;
  style: string;
  color: string;
}

export interface BreakpointTokens {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  custom?: Record<string, string>;
}

export interface ComponentPattern {
  name: string; // e.g. 'Button', 'Card', 'Input'
  role: 'action' | 'container' | 'input' | 'navigation' | 'feedback';
  classes: string;
  tokens: Record<string, string>;
  properties: {
    padding?: string;
    radius?: string;
    background?: string;
    border?: string;
    shadow?: string;
    typography?: string;
  };
  previewSnippet?: string;
}

export interface DesignSystemSourceMetadata {
  sourceType: 'project_vfs' | 'screenshot' | 'manual' | 'imported';
  extractedAt: number;
  sourceFiles: string[];
  confidence: number;
}

export interface DesignSystemImportSource {
  id: string;
  name: string;
  importedAt: number;
  format: string;
  version: string;
}

export interface DesignSystem {
  projectId: string;
  name: string;
  version: number; // Monotonically increasing version counter
  description: string;
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radii: RadiiTokens;
  shadows: ShadowTokens;
  borders: BorderTokens;
  breakpoints: BreakpointTokens;
  componentPatterns: ComponentPattern[];
  tokens: Record<string, DesignToken>;
  sourceMetadata: DesignSystemSourceMetadata;
  importSources: DesignSystemImportSource[];
  status: 'draft' | 'active' | 'synced' | 'drift_detected';
  updatedAt: number;
}

/**
 * Operation Guard to protect all asynchronous operations against race conditions,
 * stale promises, project switching, and version divergence.
 */
export interface DesignSystemOperationGuard {
  operationId: string;
  projectId: string;
  designSystemVersion: number;
}

/**
 * Clean, extensible Source Adapter interface
 */
export interface DesignSystemSourceAdapter {
  sourceType: 'css' | 'tailwind' | 'screenshot' | 'manual' | 'storybook' | 'figma' | 'external_json';
  isImplemented: boolean;
  inspect(projectId: string, files: Record<string, any>): Promise<boolean>;
  extract(
    projectId: string,
    files: Record<string, any>,
    guard: DesignSystemOperationGuard
  ): Promise<Partial<DesignSystem>>;
  validate(data: unknown): Promise<{ valid: boolean; error?: string }>;
}

export interface DesignSystemValidationError {
  tokenKey?: string;
  category?: DesignTokenCategory;
  message: string;
  severity: 'error';
  code: string;
}

export interface DesignSystemValidationWarning {
  tokenKey?: string;
  category?: DesignTokenCategory;
  message: string;
  severity: 'warning';
  code: string;
}

export interface DesignSystemValidationResult {
  valid: boolean;
  errors: DesignSystemValidationError[];
  warnings: DesignSystemValidationWarning[];
  summary: string;
  checkedAt: number;
  version: number;
}

export interface DesignSystemDrift {
  id: string;
  tokenKey: string;
  filePath: string;
  lineNumber?: number;
  currentValue: string;
  expectedToken: string;
  confidence: number;
  suggestedCorrection: string;
  detectedAt: number;
}

export interface DesignSystemExportPayload {
  schemaVersion: string;
  exportedAt: number;
  designSystem: Omit<DesignSystem, 'projectId'>;
  provenance: {
    source: string;
    exportedBy: string;
  };
}
