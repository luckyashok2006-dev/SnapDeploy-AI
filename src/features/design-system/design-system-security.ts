/**
 * Security & Sanitization utilities for Tier 2.5 Design Systems
 */

const DANGEROUS_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const DANGEROUS_CSS_PATTERNS = [
  /javascript\s*:/gi,
  /data:\s*text\/html/gi,
  /vbscript\s*:/gi,
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /expression\s*\(/gi,
  /behavior\s*:/gi,
  /-moz-binding\s*:/gi
];

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{30,}/gi,
  /github_pat_[A-Za-z0-9_]{40,}/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s'"]+/gi,
  /sk-[A-Za-z0-9_\-]{20,}/gi,
];

/**
 * Validates that an imported object does not contain prototype pollution keys.
 */
export function validateNoPrototypePollution(obj: unknown, depth = 0): { valid: boolean; error?: string } {
  if (depth > 12) {
    return { valid: false, error: 'Object nesting depth exceeds maximum allowed limit.' };
  }

  if (!obj || typeof obj !== 'object') {
    return { valid: true };
  }

  // Check prototype
  const proto = Object.getPrototypeOf(obj);
  if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
    return { valid: false, error: "Illegal property detected in design system import: '__proto__'" };
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = validateNoPrototypePollution(item, depth + 1);
      if (!res.valid) return res;
    }
    return { valid: true };
  }

  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (DANGEROUS_PROTO_KEYS.has(key)) {
      return { valid: false, error: `Illegal property detected in design system import: '${key}'` };
    }

    const value = (obj as Record<string, unknown>)[key];
    if (value && typeof value === 'object') {
      const res = validateNoPrototypePollution(value, depth + 1);
      if (!res.valid) return res;
    }
  }

  return { valid: true };
}

/**
 * Sanitizes CSS property values to prevent script injection or execution.
 */
export function sanitizeCssValue(raw: string, maxLength = 300): string {
  if (!raw || typeof raw !== 'string') return '';

  let sanitized = raw.trim();

  // Strip dangerous patterns
  for (const pattern of DANGEROUS_CSS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Strip secrets
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitizes token names to ensure valid CSS identifier syntax.
 */
export function sanitizeTokenName(name: string): string {
  if (!name || typeof name !== 'string') return 'token';
  // Allow alphanumeric, dashes, and underscores only
  return name.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 80);
}

/**
 * Sanitizes natural language descriptions in design tokens.
 * Treats imported text strictly as quoted data.
 */
export function sanitizeDescription(desc?: string, maxLength = 300): string {
  if (!desc || typeof desc !== 'string') return '';

  let sanitized = desc.trim();

  // Strip script tags
  sanitized = sanitized.replace(/<[^>]*>?/gm, '');

  // Strip secrets
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}
