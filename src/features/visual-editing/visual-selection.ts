import { 
  VisualSelection, 
  ElementBoundingRect, 
  ElementAncestor, 
  SourceMappingResult 
} from '../../types/visual-editing';

/**
 * Secret & credential regex patterns to strip from visual text & attributes
 */
const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{30,}/gi,
  /github_pat_[A-Za-z0-9_]{40,}/gi,
  /-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+PRIVATE KEY-----/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"][^'"]+['"]/gi,
  /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s'"]+/gi,
  /sk-[A-Za-z0-9]{32,}/gi,
];

/**
 * Prompt injection patterns to neutralize from DOM contents
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/gi,
  /disregard\s+(?:all\s+)?previous\s+instructions/gi,
  /disregard\s+above/gi,
  /system\s+prompt/gi,
  /you\s+are\s+now\s+(?:an?\s+)?/gi,
  /new\s+instructions\s*:/gi,
  /override\s+(?:all\s+)?instructions/gi,
];

/**
 * Whitelist of visual styles to inspect for AI context
 */
export const VISUAL_STYLE_PROPERTIES = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'padding',
  'margin',
  'borderRadius',
  'border',
  'display',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'gap',
  'width',
  'height',
  'boxShadow',
  'opacity',
  'lineHeight'
] as const;

/**
 * Sanitizes untrusted text extracted from DOM elements before feeding into AI context.
 * Strips tokens/credentials, neutralizes prompt injection attempts, and enforces length cap.
 */
export function sanitizeVisualText(rawText: string, maxLength = 500): string {
  if (!rawText) return '';

  let sanitized = rawText;

  // 1. Strip secrets and credentials
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }

  // 2. Neutralize prompt injection phrases
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[FILTERED_INSTRUCTION]');
  }

  // 3. Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // 4. Enforce strict character cap
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

/**
 * Extracts only visual/layout computed styles for an element, ignoring non-visual attributes.
 */
export function extractComputedStyles(element: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (!element) return result;

  try {
    let computed: any = null;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' && element instanceof Element) {
      computed = window.getComputedStyle(element);
    } else if (element.computedStyles) {
      computed = element.computedStyles;
    } else if (element.style) {
      computed = element.style;
    }

    if (!computed) return result;

    for (const prop of VISUAL_STYLE_PROPERTIES) {
      const val = typeof computed.getPropertyValue === 'function'
        ? computed.getPropertyValue(prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)) || computed[prop]
        : computed[prop];

      if (val && typeof val === 'string' && val.trim() !== '') {
        result[prop] = val.trim();
      }
    }
  } catch {
    // Fallback gracefully in non-DOM/mock environments
  }

  return result;
}

/**
 * Generates a stable, reproducible CSS selector for a DOM element.
 */
export function buildStableSelector(element: any): string {
  if (!element) return '';

  // 1. Priority: data-testid attribute
  if (typeof element.getAttribute === 'function') {
    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
  } else if (element.dataset?.testid) {
    return `[data-testid="${element.dataset.testid}"]`;
  }

  // 2. Priority: unique ID
  if (element.id && typeof element.id === 'string' && !element.id.match(/^[0-9]/)) {
    return `#${element.id}`;
  }

  // 3. Fallback: Tag and class hierarchy
  const tag = (element.tagName || 'div').toLowerCase();
  let classPart = '';
  if (typeof element.className === 'string' && element.className.trim()) {
    const firstClass = element.className.trim().split(/\s+/)[0];
    if (firstClass && !firstClass.includes(':') && !firstClass.includes('/')) {
      classPart = `.${firstClass}`;
    }
  }

  // If element has a parentElement, build breadcrumb
  if (element.parentElement && element.parentElement.tagName && element.parentElement.tagName.toLowerCase() !== 'body') {
    const parentSelector = buildStableSelector(element.parentElement);
    return `${parentSelector} > ${tag}${classPart}`;
  }

  return `${tag}${classPart}`;
}

/**
 * Extracts ancestors chain for an element.
 */
export function extractAncestors(element: any, maxDepth = 5): ElementAncestor[] {
  const ancestors: ElementAncestor[] = [];
  let current = element?.parentElement;
  let depth = 0;

  while (current && depth < maxDepth) {
    const tag = (current.tagName || '').toLowerCase();
    if (!tag || tag === 'html' || tag === 'body') break;

    ancestors.push({
      tagName: tag,
      className: typeof current.className === 'string' ? current.className.trim() : undefined,
      id: current.id || undefined
    });

    current = current.parentElement;
    depth++;
  }

  return ancestors;
}

/**
 * Creates a normalized VisualSelection from an element and source mapping result.
 */
export function createVisualSelection(
  projectId: string,
  element: any,
  sourceMapping: SourceMappingResult,
  customBoundingRect?: ElementBoundingRect
): VisualSelection {
  const tagName = (element?.tagName || 'div').toLowerCase();
  const rawText = typeof element?.textContent === 'string' ? element.textContent : (element?.innerText || '');
  const sanitizedText = sanitizeVisualText(rawText, 500);

  let classNames: string[] = [];
  if (typeof element?.className === 'string') {
    classNames = element.className.trim().split(/\s+/).filter(Boolean);
  } else if (Array.isArray(element?.classNames)) {
    classNames = element.classNames;
  }

  let role: string | undefined = undefined;
  if (typeof element?.getAttribute === 'function') {
    role = element.getAttribute('role') || undefined;
  } else if (element?.role) {
    role = element.role;
  }

  let boundingRect: ElementBoundingRect = customBoundingRect || {
    top: 0,
    left: 0,
    width: 100,
    height: 40
  };

  if (!customBoundingRect && typeof element?.getBoundingClientRect === 'function') {
    try {
      const rect = element.getBoundingClientRect();
      boundingRect = {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        bottom: Math.round(rect.bottom),
        right: Math.round(rect.right)
      };
    } catch {}
  }

  const selector = buildStableSelector(element);
  const ancestors = extractAncestors(element);
  const computedStyles = extractComputedStyles(element);

  return {
    id: `vsel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    projectId,
    selector,
    tagName,
    role,
    textContent: sanitizedText,
    classNames,
    boundingRect,
    ancestors,
    sourceMapping,
    computedStyles,
    timestamp: Date.now()
  };
}
