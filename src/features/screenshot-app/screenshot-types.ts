import { ProjectPlan, AffectedFilePlan, PatchFileChange, EditProposal } from '../../types/workspace';

export type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/jpg' | 'image/webp';

export interface ScreenshotImage {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  dataUrl: string; // Base64 data URL for UI rendering & multimodal API
  uploadedAt: number;
}

export interface LayoutSection {
  name: string;
  heading?: string;
  supportingText?: string;
  cta?: string;
  alignment: 'left' | 'center' | 'right';
  spacing: string;
  background: string;
  components: string[];
}

export interface TypographySystem {
  headingFont?: string;
  bodyFont?: string;
  scale: {
    h1: string;
    h2: string;
    h3: string;
    body: string;
    caption: string;
  };
}

export interface ColorPalette {
  primary: string;
  secondary: string;
  surface: string;
  background: string;
  text: string;
  muted: string;
  border: string;
  accent?: string;
}

export interface AssetPlaceholder {
  id: string;
  type: 'logo' | 'avatar' | 'banner' | 'chart' | 'icon' | 'image';
  alt: string;
  aspectRatio: string;
  isResolved: boolean; // false indicates placeholder requires replacement
  placeholderUrl: string;
}

export interface InteractiveElement {
  type: 'button' | 'input' | 'tab' | 'dropdown' | 'checkbox' | 'link';
  label: string;
  variant?: string;
}

export interface ResponsiveObservations {
  observed: string[]; // Rules seen in current viewport
  inferred: string[]; // Inferred rules for other viewports
}

export interface ScreenshotAnalysis {
  id: string;
  viewportWidth: number;
  viewportHeight: number;
  pageType: 'dashboard' | 'landing' | 'ecommerce' | 'form' | 'portfolio' | 'generic';
  layoutModel: 'sidebar-content' | 'topbar-grid' | 'single-column' | 'multi-column';
  sections: LayoutSection[];
  hierarchy: string[];
  typography: TypographySystem;
  colorPalette: ColorPalette;
  spacing: {
    scale: string[];
    containerWidth: string;
  };
  borders: {
    defaultWidth: string;
    style: string;
  };
  radii: {
    small: string;
    medium: string;
    large: string;
  };
  shadows: {
    card: string;
    modal?: string;
  };
  images: AssetPlaceholder[];
  interactiveElements: InteractiveElement[];
  responsiveObservations: ResponsiveObservations;
  confidence: number; // 0.0 to 1.0
  unresolvedElements: string[];
  extractedText: string[];
}

export type ScreenshotGenerationMode = 'new_project' | 'existing_project';

export interface ScreenshotGenerationProposal {
  id: string;
  projectId: string;
  operationId: string;
  mode: ScreenshotGenerationMode;
  summary: string;
  explanation: string;
  analysis: ScreenshotAnalysis;
  plan?: ProjectPlan;
  affectedFiles?: AffectedFilePlan[];
  files: Record<string, string>; // For new project
  patchFiles?: PatchFileChange[]; // For existing project
  designTokens: Record<string, string>;
  estimatedDiffSize?: { additions: number; deletions: number };
  status: 'idle' | 'generating' | 'ready' | 'approved' | 'rejected' | 'applied';
}

export interface VisualComparisonBox {
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface VisualComparisonResult {
  id: string;
  timestamp: number;
  imageDimensions: {
    source: { width: number; height: number };
    preview: { width: number; height: number };
  };
  similarityScore: number; // 0 to 100 percentage (deterministic calculation)
  changedRegions: VisualComparisonBox[];
  unmatchedRegions: VisualComparisonBox[];
  majorDifferences: string[];
  diffMetrics: {
    layoutDelta: number;
    colorDelta: number;
    dimensionDelta: number;
  };
  refinementPrompt?: string;
}
