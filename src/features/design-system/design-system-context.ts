import { 
  DesignSystem, 
  DesignSystemOperationGuard 
} from './design-system-types';

export class DesignSystemContextBuilder {
  private static instance: DesignSystemContextBuilder;

  private constructor() {}

  public static getInstance(): DesignSystemContextBuilder {
    if (!DesignSystemContextBuilder.instance) {
      DesignSystemContextBuilder.instance = new DesignSystemContextBuilder();
    }
    return DesignSystemContextBuilder.instance;
  }

  /**
   * Formats a compact, structured representation of the active Design System for AI prompts.
   * Guarded by operationId, projectId, and designSystemVersion.
   */
  public buildCompactAIContext(
    ds: DesignSystem,
    guard: DesignSystemOperationGuard
  ): string {
    if (guard.projectId !== ds.projectId) {
      throw new Error(`[ContextBuilder] Project mismatch: guard=${guard.projectId}, ds=${ds.projectId}`);
    }
    if (guard.designSystemVersion !== ds.version) {
      throw new Error(`[ContextBuilder] Stale version: guard=${guard.designSystemVersion}, ds=${ds.version}`);
    }

    const colorList = [
      `primary: ${ds.colors.primary}`,
      `secondary: ${ds.colors.secondary}`,
      `surface: ${ds.colors.surface}`,
      `background: ${ds.colors.background}`,
      `foreground: ${ds.colors.foreground}`,
      `muted: ${ds.colors.muted}`,
      `border: ${ds.colors.border}`
    ].join(', ');

    const spacingList = `xs=${ds.spacing.xs}, sm=${ds.spacing.sm}, md=${ds.spacing.md}, lg=${ds.spacing.lg}, xl=${ds.spacing.xl}`;
    const radiusList = `sm=${ds.radii.sm}, md=${ds.radii.md}, lg=${ds.radii.lg}, xl=${ds.radii.xl}`;

    const patterns = (ds.componentPatterns || []).slice(0, 3).map((p) => {
      return `  - ${p.name} (${p.role}): "${p.classes}"`;
    }).join('\n');

    return [
      `[PROJECT DESIGN SYSTEM: ${ds.name} (v${ds.version})]`,
      `Colors: { ${colorList} }`,
      `Typography: Heading="${ds.typography.headingFamily}", Body="${ds.typography.bodyFamily}", BaseSize=${ds.typography.sizes.base}`,
      `Spacing Scale: { ${spacingList} }`,
      `Radii: { ${radiusList} }`,
      `Component Patterns:`,
      patterns || '  - Default modern Tailwind card and button conventions',
      `Constraint: Respect these design tokens and patterns. Prefer semantic CSS variables or matching Tailwind tokens.`
    ].join('\n');
  }
}

export const designSystemContextBuilder = DesignSystemContextBuilder.getInstance();
