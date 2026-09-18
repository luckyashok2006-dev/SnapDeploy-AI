import { EditProposal, PatchFileChange } from './workspace';

export type SourceMappingStrategy =
  | 'fiber_marker'
  | 'data_attribute'
  | 'component_identifier'
  | 'structural_jsx'
  | 'unresolved';

export interface SourceMappingResult {
  filePath: string;
  componentName?: string;
  lineNumber?: number;
  columnNumber?: number;
  confidence: number; // 0.0 to 1.0
  strategy: SourceMappingStrategy;
  canRefuseSpeculativePatch: boolean; // true if confidence < 0.40
  unresolvedReason?: string;
  candidateFiles?: string[];
}

export interface ElementBoundingRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom?: number;
  right?: number;
}

export interface ElementAncestor {
  tagName: string;
  className?: string;
  id?: string;
}

export interface VisualSelection {
  id: string;
  projectId: string;
  selector: string;
  tagName: string;
  role?: string;
  textContent: string; // sanitized & truncated <= 500 chars
  classNames: string[];
  boundingRect: ElementBoundingRect;
  ancestors: ElementAncestor[];
  sourceMapping: SourceMappingResult;
  computedStyles: Record<string, string>;
  timestamp: number;
  runtimeIdentity?: string;
}

export interface VisualEditContext {
  selection: VisualSelection;
  prompt: string;
  projectId: string;
  relevantFiles: Record<string, string>;
  safeEnvContext?: string;
  safeDbContext?: string;
  safeAuthContext?: string;
  screenshotContext?: any;
  designSystemContext?: string;
}

export interface VisualEditProposal extends EditProposal {
  visualEditSummary: string;
  visualConfidence: number;
  visualSelection?: VisualSelection;
}
