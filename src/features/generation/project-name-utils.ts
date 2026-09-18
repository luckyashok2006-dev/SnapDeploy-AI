/**
 * Derives a clean, meaningful project name from an AI generation plan name or prompt.
 * Replaces generic provider defaults such as "web-app" with meaningful, human-readable titles.
 */
export function deriveProjectName(planName?: string, prompt?: string): string {
  // 1. Check if planName is specific and meaningful
  if (planName && typeof planName === 'string') {
    const trimmed = planName.trim();
    const lower = trimmed.toLowerCase();
    const isGeneric = ['web-app', 'webapp', 'app', 'my-app', 'vite-app', 'react-app', 'project'].includes(lower);

    if (!isGeneric && trimmed.length >= 3) {
      // If it looks like kebab-case or snake_case, format into Title Case
      if (/^[a-zA-Z0-9_\-\s]+$/.test(trimmed)) {
        const words = trimmed
          .split(/[-_\s]+/)
          .filter(Boolean)
          .map((w) => {
            const upper = w.toUpperCase();
            if (['SAAS', 'AI', 'CRM', 'API', 'CSS', 'UI', 'UX', 'VFS', 'VITE'].includes(upper)) {
              return upper === 'SAAS' ? 'SaaS' : upper;
            }
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
          });
        if (words.length > 0) {
          return words.join(' ').slice(0, 60);
        }
      }
      return trimmed.slice(0, 60);
    }
  }

  // 2. Derive from prompt if available
  if (prompt && typeof prompt === 'string') {
    let clean = prompt.trim();
    // Strip common leading creation verbs
    clean = clean.replace(/^(build|create|generate|make|develop|design)\s+(a|an|the)?\s*/i, '');

    // Stop at sentence punctuation or connective clauses
    const clauseMatch = clean.match(/^([^,.;]+?)(?:\s+(?:with|that|for|including|having|featuring|and\s+a)|[,.;]|$)/i);
    const candidate = (clauseMatch ? clauseMatch[1] : clean).trim();

    if (candidate.length >= 3) {
      const words = candidate
        .split(/\s+/)
        .slice(0, 5)
        .map((w) => {
          const upper = w.toUpperCase();
          if (['SAAS', 'AI', 'CRM', 'API', 'CSS', 'UI', 'UX', 'VFS', 'VITE'].includes(upper)) {
            return upper === 'SAAS' ? 'SaaS' : upper;
          }
          return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        });

      const title = words.join(' ').replace(/[^a-zA-Z0-9\s-]/g, '').trim();
      if (title.length >= 3) {
        return title.slice(0, 60);
      }
    }
  }

  // 3. Technical fallback
  return 'Web Application';
}
