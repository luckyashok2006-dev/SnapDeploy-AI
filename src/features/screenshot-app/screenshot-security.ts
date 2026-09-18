/**
 * Security & Input Validation utilities for Screenshot-to-App subsystem
 */

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MIN_IMAGE_DIMENSION = 10; // 10px
export const MAX_IMAGE_DIMENSION = 4096; // 4096px

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{30,}/gi,
  /github_pat_[A-Za-z0-9_]{40,}/gi,
  /-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+PRIVATE KEY-----/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"][^'"]+['"]/gi,
  /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s'"]+/gi,
  /sk-[A-Za-z0-9_\-]{20,}/gi,
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions/gi,
  /disregard\s+(?:all\s+)?previous\s+instructions/gi,
  /disregard\s+above/gi,
  /system\s+prompt/gi,
  /you\s+are\s+now\s+(?:an?\s+)?/gi,
  /new\s+instructions\s*:/gi,
  /override\s+(?:all\s+)?instructions/gi,
];

export interface FileValidationTarget {
  name: string;
  type: string;
  size: number;
}

/**
 * Validates screenshot file format and size limits.
 */
export function validateScreenshotFile(file: FileValidationTarget): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }

  // Normalize MIME
  const lowerType = (file.type || '').toLowerCase();
  const lowerName = (file.name || '').toLowerCase();

  const isMimeAllowed = ALLOWED_IMAGE_MIME_TYPES.some((m) => lowerType === m);
  const isExtensionAllowed =
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.webp');

  if (!isMimeAllowed && !isExtensionAllowed) {
    return {
      valid: false,
      error: `Unsupported image format (${file.type || 'unknown'}). Supported formats: PNG, JPEG/JPG, WebP.`
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: 'File is empty (0 bytes).'
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${sizeMb}MB) exceeds maximum limit of 10MB.`
    };
  }

  return { valid: true };
}

/**
 * Validates image pixel dimensions.
 */
export function validateImageDimensions(
  width: number,
  height: number
): { valid: boolean; error?: string } {
  if (typeof width !== 'number' || typeof height !== 'number' || isNaN(width) || isNaN(height)) {
    return { valid: false, error: 'Invalid image dimensions.' };
  }

  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    return {
      valid: false,
      error: `Image dimensions (${width}x${height}px) are below minimum resolution of ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px.`
    };
  }

  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return {
      valid: false,
      error: `Image dimensions (${width}x${height}px) exceed maximum resolution of ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}px.`
    };
  }

  return { valid: true };
}

/**
 * Validates base64 data URL for corruption or malformed header.
 */
export function validateImageDataUrl(dataUrl: string): { valid: boolean; error?: string } {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { valid: false, error: 'Image data URL is missing or invalid.' };
  }

  const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!matches) {
    return { valid: false, error: 'Corrupted image data: invalid Data URL format.' };
  }

  const mimeType = matches[1].toLowerCase();
  const base64Data = matches[2];

  if (!ALLOWED_IMAGE_MIME_TYPES.some((m) => mimeType === m)) {
    return { valid: false, error: `Invalid image MIME type in data URL: ${mimeType}` };
  }

  if (base64Data.length < 32) {
    return { valid: false, error: 'Corrupted image data: base64 payload is truncated or empty.' };
  }

  return { valid: true };
}

/**
 * Sanitizes untrusted OCR or visual text extracted from screenshots.
 * Strips credentials, neutralizes prompt-injection keywords, and enforces character cap.
 */
export function sanitizeScreenshotText(rawText: string, maxLength = 500): string {
  if (!rawText) return '';

  let sanitized = rawText;

  // 1. Redact secrets
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }

  // 2. Neutralize prompt injections
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[FILTERED_INSTRUCTION]');
  }

  // 3. Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // 4. Enforce max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitizes an array of extracted text strings.
 */
export function sanitizeExtractedTextList(textList: string[]): string[] {
  if (!Array.isArray(textList)) return [];
  return textList
    .map((t) => sanitizeScreenshotText(t, 200))
    .filter((t) => t.length > 0);
}
