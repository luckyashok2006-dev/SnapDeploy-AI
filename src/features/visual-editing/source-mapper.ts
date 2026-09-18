import { SourceMappingResult, SourceMappingStrategy } from '../../types/visual-editing';

/**
 * Normalizes file path to standard root-slashed path (/src/...)
 */
function normalizePath(p: string): string {
  if (!p) return '';
  let normalized = p.replace(/\\/g, '/');
  // Strip Webpack/Vite loader prefixes or virtual prefixes if present
  if (normalized.includes('/src/')) {
    normalized = normalized.substring(normalized.indexOf('/src/'));
  } else if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  return normalized;
}

/**
 * Converts PascalCase, camelCase, or kebab-case into tokens for fuzzy matching
 */
function tokenizeIdentifier(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((s) => s.length > 2);
}

export class SourceMapper {
  /**
   * Resolves the source component file and location from an inspected element or element descriptor
   * using a 5-tier priority strategy (Priority A to E).
   *
   * @param target Inspected DOM element or serialized element descriptor
   * @param vfsFiles Current VFS files map { [path: string]: string | { content: string } }
   * @returns Deterministic SourceMappingResult with confidence score and refusal flags
   */
  public resolveSourceComponent(
    target: any,
    vfsFiles: Record<string, any> = {}
  ): SourceMappingResult {
    if (!target) {
      return {
        filePath: '',
        confidence: 0.1,
        strategy: 'unresolved',
        canRefuseSpeculativePatch: true,
        unresolvedReason: 'No element target provided for source mapping.',
        candidateFiles: []
      };
    }

    // Build list of all project source file paths (focus on /src/)
    const allFilePaths = Object.keys(vfsFiles).map(normalizePath);
    const srcFilePaths = allFilePaths.filter(
      (p) =>
        (p.startsWith('/src/') || p.startsWith('src/')) &&
        (p.endsWith('.tsx') || p.endsWith('.jsx') || p.endsWith('.vue') || p.endsWith('.svelte'))
    );

    // =========================================================================
    // PRIORITY A: React Fiber / Dev Source Markers (__source / _debugSource)
    // Confidence: 0.95 - 1.0
    // =========================================================================
    const fiberSource = this.extractFiberSource(target);
    if (fiberSource && fiberSource.fileName) {
      const normalizedSourcePath = normalizePath(fiberSource.fileName);
      // Verify file exists or has matching basename in VFS
      const exactMatch = allFilePaths.find((p) => p === normalizedSourcePath);
      const baseName = normalizedSourcePath.split('/').pop();
      const baseMatch = baseName ? allFilePaths.find((p) => p.endsWith('/' + baseName)) : null;

      const matchedFile = exactMatch || baseMatch || normalizedSourcePath;
      return {
        filePath: matchedFile,
        componentName: fiberSource.componentName,
        lineNumber: fiberSource.lineNumber,
        columnNumber: fiberSource.columnNumber,
        confidence: 0.98,
        strategy: 'fiber_marker',
        canRefuseSpeculativePatch: false
      };
    }

    // =========================================================================
    // PRIORITY B: Component Markers & Data Attributes (data-component, data-testid)
    // Confidence: 0.85 - 0.90
    // =========================================================================
    const compAttr = this.extractComponentAttribute(target);
    if (compAttr) {
      const candidates = this.findMatchingFilesByComponentMarker(compAttr, srcFilePaths);
      if (candidates.length === 1) {
        return {
          filePath: candidates[0],
          componentName: compAttr,
          confidence: 0.88,
          strategy: 'data_attribute',
          canRefuseSpeculativePatch: false
        };
      } else if (candidates.length > 1) {
        return {
          filePath: candidates[0],
          componentName: compAttr,
          confidence: 0.85,
          strategy: 'data_attribute',
          canRefuseSpeculativePatch: false,
          candidateFiles: candidates
        };
      }
    }

    // =========================================================================
    // PRIORITY C: Class/ID Component Name Heuristics
    // Confidence: 0.70 - 0.80
    // =========================================================================
    const identifierMatches = this.findMatchesByClassOrId(target, srcFilePaths);
    if (identifierMatches.length === 1) {
      return {
        filePath: identifierMatches[0].path,
        componentName: identifierMatches[0].componentName,
        confidence: 0.78,
        strategy: 'component_identifier',
        canRefuseSpeculativePatch: false
      };
    }

    // =========================================================================
    // PRIORITY D: Structural JSX & Unique Text Content Matching in VFS
    // Confidence: 0.65 - 0.80
    // =========================================================================
    const contentMatches = this.findMatchesByStructuralContent(target, vfsFiles, srcFilePaths);
    if (contentMatches.length === 1) {
      return {
        filePath: contentMatches[0],
        confidence: 0.75,
        strategy: 'structural_jsx',
        canRefuseSpeculativePatch: false
      };
    } else if (contentMatches.length === 2 && contentMatches.some((p) => p.endsWith('App.tsx'))) {
      // One is App.tsx and one is a specific child component
      const nonApp = contentMatches.find((p) => !p.endsWith('App.tsx'));
      if (nonApp) {
        return {
          filePath: nonApp,
          confidence: 0.70,
          strategy: 'structural_jsx',
          canRefuseSpeculativePatch: false,
          candidateFiles: contentMatches
        };
      }
    }

    // =========================================================================
    // PRIORITY E: Ambiguous / Low-Confidence Refusal (< 0.40)
    // =========================================================================
    const allAmbiguousCandidates = Array.from(
      new Set([
        ...identifierMatches.map((m) => m.path),
        ...contentMatches
      ])
    );

    if (allAmbiguousCandidates.length > 1) {
      return {
        filePath: allAmbiguousCandidates[0],
        confidence: 0.35,
        strategy: 'unresolved',
        canRefuseSpeculativePatch: true,
        unresolvedReason: `Ambiguous source mapping: element matches multiple candidate files (${allAmbiguousCandidates.join(', ')}). Confidence is below 0.40 threshold. Manual file selection required.`,
        candidateFiles: allAmbiguousCandidates
      };
    }

    return {
      filePath: srcFilePaths[0] || '/src/App.tsx',
      confidence: 0.25,
      strategy: 'unresolved',
      canRefuseSpeculativePatch: true,
      unresolvedReason: 'Low confidence mapping (< 0.40). Confidence is below 0.40 threshold. Unable to unambiguously determine component source file. Please select the target file manually.',
      candidateFiles: []
    };
  }

  /**
   * Extracts React Dev fiber source metadata from element or target descriptor.
   */
  private extractFiberSource(target: any): { fileName: string; lineNumber?: number; columnNumber?: number; componentName?: string } | null {
    // Check direct target properties
    if (target.fiberSource?.fileName) return target.fiberSource;
    if (target.__source?.fileName) return target.__source;
    if (target._debugSource?.fileName) return target._debugSource;

    // Check data attributes for source file
    const attrSourceFile = typeof target.getAttribute === 'function'
      ? target.getAttribute('data-source-file') || target.getAttribute('data-source')
      : target.attributes?.['data-source-file'] || target.dataset?.sourceFile;

    if (attrSourceFile) {
      const lineStr = typeof target.getAttribute === 'function'
        ? target.getAttribute('data-source-line')
        : target.attributes?.['data-source-line'] || target.dataset?.sourceLine;
      const colStr = typeof target.getAttribute === 'function'
        ? target.getAttribute('data-source-column')
        : target.attributes?.['data-source-column'] || target.dataset?.sourceColumn;

      return {
        fileName: attrSourceFile,
        lineNumber: lineStr ? parseInt(lineStr, 10) : undefined,
        columnNumber: colStr ? parseInt(colStr, 10) : undefined
      };
    }

    // Check React Fiber DOM key
    if (typeof target === 'object' && target !== null) {
      const fiberKey = Object.keys(target).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey) {
        let fiber = target[fiberKey];
        while (fiber) {
          if (fiber._debugSource?.fileName) {
            return {
              fileName: fiber._debugSource.fileName,
              lineNumber: fiber._debugSource.lineNumber,
              columnNumber: fiber._debugSource.columnNumber,
              componentName: typeof fiber.type === 'function' ? fiber.type.name : (fiber.type?.displayName || undefined)
            };
          }
          if (fiber.memoizedProps?.__source?.fileName) {
            return {
              fileName: fiber.memoizedProps.__source.fileName,
              lineNumber: fiber.memoizedProps.__source.lineNumber,
              columnNumber: fiber.memoizedProps.__source.columnNumber,
              componentName: typeof fiber.type === 'function' ? fiber.type.name : undefined
            };
          }
          fiber = fiber.return;
        }
      }
    }

    return null;
  }

  /**
   * Extracts data-component or data-testid attribute from target.
   */
  private extractComponentAttribute(target: any): string | null {
    if (typeof target.getAttribute === 'function') {
      const comp = target.getAttribute('data-component') || target.getAttribute('data-component-name');
      if (comp) return comp;
      const testid = target.getAttribute('data-testid');
      if (testid) return testid;
    }

    if (target.dataset?.component) return target.dataset.component;
    if (target.dataset?.componentName) return target.dataset.componentName;
    if (target.dataset?.testid) return target.dataset.testid;

    if (target.attributes) {
      return (
        target.attributes['data-component'] ||
        target.attributes['data-component-name'] ||
        target.attributes['data-testid'] ||
        null
      );
    }

    return null;
  }

  /**
   * Finds matching VFS files by component marker name.
   */
  private findMatchingFilesByComponentMarker(marker: string, srcFiles: string[]): string[] {
    const cleanMarker = marker.replace(/[-_]/g, '').toLowerCase();
    return srcFiles.filter((p) => {
      const baseName = p.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[-_]/g, '').toLowerCase() || '';
      return baseName === cleanMarker || baseName.includes(cleanMarker);
    });
  }

  /**
   * Finds matching component files by class name or id heuristics.
   */
  private findMatchesByClassOrId(
    target: any,
    srcFiles: string[]
  ): Array<{ path: string; componentName: string }> {
    const results: Array<{ path: string; componentName: string }> = [];

    const id = target.id || (typeof target.getAttribute === 'function' ? target.getAttribute('id') : target.attributes?.id);
    const rawClass = typeof target.className === 'string'
      ? target.className
      : (typeof target.getAttribute === 'function' ? target.getAttribute('class') : target.attributes?.class) || '';

    const tokens: string[] = [];
    if (id) tokens.push(...tokenizeIdentifier(id));
    if (rawClass) {
      for (const cls of rawClass.split(/\s+/)) {
        if (!cls.includes(':') && !cls.includes('/') && !cls.startsWith('text-') && !cls.startsWith('bg-') && !cls.startsWith('p-') && !cls.startsWith('m-')) {
          tokens.push(...tokenizeIdentifier(cls));
        }
      }
    }

    if (tokens.length === 0) return results;

    for (const filePath of srcFiles) {
      const base = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      const baseLower = base.toLowerCase();
      for (const tok of tokens) {
        if (baseLower === tok || baseLower.includes(tok)) {
          results.push({ path: filePath, componentName: base });
          break;
        }
      }
    }

    return results;
  }

  /**
   * Searches VFS file contents for unique structural text or JSX tags.
   */
  private findMatchesByStructuralContent(
    target: any,
    vfsFiles: Record<string, any>,
    srcFiles: string[]
  ): string[] {
    const rawText = (typeof target.textContent === 'string' ? target.textContent : (target.innerText || '')).trim();
    if (!rawText || rawText.length < 4) return [];

    // Clean text to avoid generic strings like 'OK', 'Save', 'Submit'
    const cleanText = rawText.slice(0, 100).replace(/\s+/g, ' ');
    if (['save', 'submit', 'cancel', 'delete', 'edit', 'close'].includes(cleanText.toLowerCase())) {
      return [];
    }

    const matches: string[] = [];

    for (const filePath of srcFiles) {
      const fileEntry = vfsFiles[filePath] || vfsFiles[filePath.replace(/^\//, '')];
      const content = typeof fileEntry === 'string' ? fileEntry : fileEntry?.content;
      if (typeof content === 'string' && content.includes(cleanText)) {
        matches.push(filePath);
      }
    }

    return matches;
  }
}

export const sourceMapper = new SourceMapper();
