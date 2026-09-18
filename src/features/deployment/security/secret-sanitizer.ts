/**
 * Dynamic secret & token sanitizer for deployment workflows.
 * Ensures credentials, tokens, and sensitive env var values never leak
 * into logs, error messages, UI banners, or persisted metadata.
 */

// Memory-only set of active secrets registered during the session
const registeredSecrets = new Set<string>();

/**
 * Registers a secret value to be scrubbed from all logs, errors, and metadata.
 */
export function registerSecret(value: string): void {
  if (value && value.trim().length >= 3) {
    registeredSecrets.add(value.trim());
  }
}

/**
 * Unregisters a secret when disconnected or purged.
 */
export function unregisterSecret(value: string): void {
  registeredSecrets.delete(value.trim());
}

/**
 * Clears all registered secrets from memory.
 */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/**
 * Known token pattern regexes for automatic redaction.
 */
const TOKEN_PATTERNS = [
  // AWS Access Key ID
  /AKIA[0-9A-Z]{16}/g,
  // Private Key Headers
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  // Netlify personal access tokens
  /nfp_[a-zA-Z0-9_]{32,64}/g,
  // GitHub Personal Access Tokens
  /ghp_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{82}/g,
  // Generic Authorization: Bearer tokens
  /Bearer\s+[A-Za-z0-9_\-\.]{16,}/gi,
  // Supabase Personal Access Tokens & JWTs
  /sbp_[a-zA-Z0-9_]{32,64}/g,
  /eyJhbGciOi[a-zA-Z0-9_\-\.]{40,}/g,
  // Sensitive environment variable assignments
  /(AWS_SECRET_ACCESS_KEY|SECRET_KEY|API_KEY|PRIVATE_KEY|DATABASE_PASSWORD|PASSWORD)\s*[:=]\s*["']?([^\s"';&]+)["']?/gi,
  // Basic Auth or API keys in query parameters / assignments
  /(token|secret|key|api_key|access_token|password)=([^&\s]+)/gi
];

/**
 * Scrubs all registered secrets and known token patterns from a string.
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let sanitized = input;

  // 1. Scrub dynamically registered secret values (specific values take precedence)
  for (const secret of registeredSecrets) {
    if (secret && secret.length >= 3) {
      sanitized = sanitized.split(secret).join('[REDACTED_SECRET]');
    }
  }

  // 2. Scrub known token patterns
  for (const pattern of TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith('bearer ')) {
        return 'Bearer [REDACTED_TOKEN]';
      }
      if (match.startsWith('AKIA')) {
        return '[REDACTED_AWS_KEY]';
      }
      if (match.startsWith('-----BEGIN')) {
        return '[REDACTED_PRIVATE_KEY]';
      }
      if (match.includes('=')) {
        const [k] = match.split('=');
        return `${k}=[REDACTED_VALUE]`;
      }
      if (match.includes(':')) {
        const [k] = match.split(':');
        return `${k}: [REDACTED_VALUE]`;
      }
      return '[REDACTED_TOKEN]';
    });
  }

  return sanitized;
}

/**
 * Sanitizes an error object, extracting a safe, non-leaking message string.
 */
export function sanitizeDeploymentError(err: any): string {
  if (!err) return 'An unknown deployment error occurred.';

  const rawMessage = typeof err === 'string'
    ? err
    : err.message || err.statusText || 'Deployment operation failed.';

  return sanitizeString(rawMessage);
}

/**
 * Validates an environment variable key name.
 * Must begin with a letter or underscore, followed by alphanumeric or underscores.
 */
export function validateEnvVarKey(key: string): { valid: boolean; error?: string } {
  const trimmed = (key || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Environment variable name cannot be empty.' };
  }

  if (trimmed.length > 64) {
    return { valid: false, error: 'Environment variable name exceeds 64 characters.' };
  }

  const validIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!validIdentifier.test(trimmed)) {
    return {
      valid: false,
      error: 'Environment variable name must contain only letters, numbers, and underscores, and cannot start with a number.'
    };
  }

  return { valid: true };
}

/**
 * Checks if a key represents a client-side Vite variable (VITE_*).
 * Vite bundles all VITE_* variables into the client-side JavaScript, making them public.
 */
export function isViteClientVariable(key: string): boolean {
  return key.trim().startsWith('VITE_');
}

/**
 * Returns a uniform masked bullet string for sensitive secret values.
 */
export function maskSecretValue(val?: string): string {
  if (!val || val.length === 0) return '••••••••';
  return '••••••••••••';
}

/**
 * Normalizes an environment variable key (trimmed and uppercase standard).
 */
export function normalizeEnvKey(key: string): string {
  return (key || '').trim().toUpperCase();
}

/**
 * Checks if a candidate key collides with any existing keys in the project.
 * Uses case-insensitive comparison to avoid accidental near-duplicate confusion.
 */
export function isDuplicateKey(
  existingKeys: string[],
  candidateKey: string,
  currentKey?: string
): boolean {
  const normCandidate = normalizeEnvKey(candidateKey);
  const normCurrent = currentKey ? normalizeEnvKey(currentKey) : null;

  return existingKeys.some((k) => {
    const norm = normalizeEnvKey(k);
    if (normCurrent && norm === normCurrent) return false;
    return norm === normCandidate;
  });
}
