import { 
  DesignSystem, 
  DesignSystemValidationResult, 
  DesignSystemValidationError, 
  DesignSystemValidationWarning,
  DesignSystemOperationGuard 
} from './design-system-types';

const COLOR_REGEX = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|var\(--[a-zA-Z0-9_\-]+\)|transparent|currentColor)$/;
const DIMENSION_REGEX = /^(?:-?\d*\.?\d+(?:px|rem|em|%|vh|vw|ch|pt)?|0|auto|var\(--[a-zA-Z0-9_\-]+\))$/;

export class DesignSystemValidator {
  private static instance: DesignSystemValidator;

  private constructor() {}

  public static getInstance(): DesignSystemValidator {
    if (!DesignSystemValidator.instance) {
      DesignSystemValidator.instance = new DesignSystemValidator();
    }
    return DesignSystemValidator.instance;
  }

  /**
   * Validates a DesignSystem against integrity rules and syntax constraints.
   * Guarded by operationId, projectId, and designSystemVersion.
   */
  public validateDesignSystem(
    ds: DesignSystem,
    guard: DesignSystemOperationGuard
  ): DesignSystemValidationResult {
    // Stale guard check
    if (ds.projectId !== guard.projectId) {
      throw new Error(`[Validator] Project mismatch: guard=${guard.projectId}, ds=${ds.projectId}`);
    }
    if (ds.version !== guard.designSystemVersion) {
      throw new Error(`[Validator] Stale version: guard=${guard.designSystemVersion}, ds=${ds.version}`);
    }

    const errors: DesignSystemValidationError[] = [];
    const warnings: DesignSystemValidationWarning[] = [];
    const checkedAt = Date.now();

    // 1. Check duplicate token names / collisions
    const seenTokenNames = new Set<string>();
    for (const [key, token] of Object.entries(ds.tokens || {})) {
      const normalizedName = token.name.toLowerCase().trim();
      if (seenTokenNames.has(normalizedName)) {
        errors.push({
          tokenKey: key,
          category: token.category,
          message: `Duplicate token identifier '${token.name}' detected. Token names must be unique.`,
          severity: 'error',
          code: 'DUPLICATE_TOKEN'
        });
      }
      seenTokenNames.add(normalizedName);

      // Check empty or whitespace values
      if (!token.value || token.value.trim() === '') {
        errors.push({
          tokenKey: key,
          category: token.category,
          message: `Token '${token.name}' has an empty value.`,
          severity: 'error',
          code: 'EMPTY_TOKEN_VALUE'
        });
      }
    }

    // 2. Validate Color Formats
    const colorFields: Array<{ key: keyof typeof ds.colors; val: string }> = [
      { key: 'primary', val: ds.colors.primary },
      { key: 'secondary', val: ds.colors.secondary },
      { key: 'accent', val: ds.colors.accent },
      { key: 'background', val: ds.colors.background },
      { key: 'surface', val: ds.colors.surface },
      { key: 'foreground', val: ds.colors.foreground },
      { key: 'muted', val: ds.colors.muted },
      { key: 'border', val: ds.colors.border },
      { key: 'success', val: ds.colors.success },
      { key: 'warning', val: ds.colors.warning },
      { key: 'danger', val: ds.colors.danger },
    ];

    for (const { key, val } of colorFields) {
      if (!val || typeof val !== 'string') {
        errors.push({
          tokenKey: `color.${key}`,
          category: 'color',
          message: `Required semantic color '${key}' is missing.`,
          severity: 'error',
          code: 'MISSING_COLOR'
        });
      } else if (!COLOR_REGEX.test(val.trim())) {
        errors.push({
          tokenKey: `color.${key}`,
          category: 'color',
          message: `Invalid color format for '${key}': '${val}'. Must be hex (#RGB, #RRGGBB), rgb(), hsl(), or var().`,
          severity: 'error',
          code: 'INVALID_COLOR_FORMAT'
        });
      }
    }

    // Check custom colors
    if (ds.colors.custom) {
      for (const [ckey, cval] of Object.entries(ds.colors.custom)) {
        if (!COLOR_REGEX.test(cval.trim())) {
          errors.push({
            tokenKey: `color.custom.${ckey}`,
            category: 'color',
            message: `Invalid color format for custom color '${ckey}': '${cval}'.`,
            severity: 'error',
            code: 'INVALID_COLOR_FORMAT'
          });
        }
      }
    }

    // 3. Validate Spacing & Radii Values
    for (const [skey, sval] of Object.entries(ds.spacing)) {
      if (skey === 'custom') continue;
      if (typeof sval === 'string' && !DIMENSION_REGEX.test(sval.trim())) {
        errors.push({
          tokenKey: `spacing.${skey}`,
          category: 'spacing',
          message: `Invalid spacing dimension for '${skey}': '${sval}'. Must be a valid CSS dimension (e.g. 8px, 1rem).`,
          severity: 'error',
          code: 'INVALID_DIMENSION'
        });
      }
    }

    for (const [rkey, rval] of Object.entries(ds.radii)) {
      if (rkey === 'custom') continue;
      if (typeof rval === 'string' && !DIMENSION_REGEX.test(rval.trim())) {
        errors.push({
          tokenKey: `radii.${rkey}`,
          category: 'radius',
          message: `Invalid radius dimension for '${rkey}': '${rval}'.`,
          severity: 'error',
          code: 'INVALID_DIMENSION'
        });
      }
    }

    // 4. Broken Token References (e.g. var(--color-xxx) referencing nonexistent token)
    const allCssVarTokens = new Set<string>();
    for (const token of Object.values(ds.tokens || {})) {
      if (token.cssVariable) {
        allCssVarTokens.add(token.cssVariable);
      }
    }

    for (const [key, token] of Object.entries(ds.tokens || {})) {
      if (typeof token.value === 'string' && token.value.startsWith('var(')) {
        const match = token.value.match(/var\((--[a-zA-Z0-9_\-]+)\)/);
        if (match && match[1]) {
          const referencedVar = match[1];
          if (!allCssVarTokens.has(referencedVar)) {
            warnings.push({
              tokenKey: key,
              category: token.category,
              message: `Token '${token.name}' references '${referencedVar}' which is not explicitly defined in the design system.`,
              severity: 'warning',
              code: 'UNRESOLVED_TOKEN_REF'
            });
          }
        }
      }
    }

    // 5. Component Pattern Inconsistencies
    for (const pattern of ds.componentPatterns || []) {
      if (!pattern.name || !pattern.role) {
        errors.push({
          category: 'component',
          message: `Component pattern is missing a required name or role.`,
          severity: 'error',
          code: 'INVALID_COMPONENT_PATTERN'
        });
      }
      if (!pattern.classes && Object.keys(pattern.properties || {}).length === 0) {
        warnings.push({
          category: 'component',
          message: `Component pattern '${pattern.name}' has no defined classes or properties.`,
          severity: 'warning',
          code: 'EMPTY_COMPONENT_PATTERN'
        });
      }
    }

    const isValid = errors.length === 0;
    const summary = isValid 
      ? `Validation passed successfully (${warnings.length} warning${warnings.length === 1 ? '' : 's'}).`
      : `Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'} and ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`;

    return {
      valid: isValid,
      errors,
      warnings,
      summary,
      checkedAt,
      version: ds.version
    };
  }
}

export const designSystemValidator = DesignSystemValidator.getInstance();
