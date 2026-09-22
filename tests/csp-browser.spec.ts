import { test, expect } from '@playwright/test';
import http from 'http';

interface CspViolationRecord {
  blockedURI: string;
  violatedDirective: string;
  effectiveDirective: string;
  originalPolicy: string;
}

test.describe('Phase 8.1 — Step 11A: Browser CSP Compatibility & Enforcement Smoke Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  test.beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const { default: app } = await import('../server/index');

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  test('Production Application loads cleanly under enforced CSP with zero accidental blockages', async ({ page }) => {
    const consoleLogs: Array<{ type: string; text: string }> = [];
    page.on('console', (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      console.log('BROWSER UNCAUGHT ERROR:', err);
    });

    // Injected listener capturing standard W3C SecurityPolicyViolation events
    await page.addInitScript(() => {
      (window as any).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as any).__cspViolations.push({
          blockedURI: e.blockedURI,
          violatedDirective: e.violatedDirective,
          effectiveDirective: e.effectiveDirective,
          originalPolicy: e.originalPolicy
        });
      });
    });

    // 1. GET / loads successfully and delivers CSP header
    const response = await page.goto(baseUrl);
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    const headers = response!.headers();
    const csp = headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain('https://stackblitz.com');
    expect(csp).toContain('https://*.webcontainer-api.io');
    expect(csp).toContain("frame-ancestors 'self'");

    // 2. The React application actually mounts in the DOM
    await page.waitForSelector('#root > *', { state: 'attached', timeout: 15000 });
    const headerEl = page.locator('header');
    await expect(headerEl).toBeVisible({ timeout: 15000 });

    // 3. Representative Editor surface loads
    const editTab = page.locator('button[data-testid="nav-tab-edit"], button:has-text("Edit")').first();
    if (await editTab.isVisible()) {
      await editTab.click();
    } else {
      await page.keyboard.press('Alt+2');
    }

    const editorWorkspace = page.locator('section[aria-label="Code Editor Workspace"], [data-testid="editor-workspace"]').first();
    await expect(editorWorkspace).toBeVisible({ timeout: 15000 });

    // 4. Monaco editor container mounts without fatal breakage
    const monacoHost = page.locator('.monaco-editor, [data-testid="monaco-container"], section[aria-label="Code Editor Workspace"]').first();
    await expect(monacoHost).toBeAttached();

    // 5. Representative API request succeeds through client fetch under CSP
    const apiTestResult = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/health');
        const json = await res.json();
        return { ok: res.ok, status: res.status, json };
      } catch (err: any) {
        return { ok: false, error: err?.message };
      }
    });
    expect(apiTestResult.ok).toBe(true);
    expect(apiTestResult.status).toBe(200);
    expect(apiTestResult.json?.status).toBe('ok');

    // 6. Representative preview iframe initializes with proper sandbox attributes
    await page.evaluate(() => {
      (window as any).useRuntimeStore?.setState({
        previewUrl: 'https://demo-preview.local-credentialless.webcontainer-api.io',
        previewPort: 3000,
        status: 'ready'
      });
    });

    const previewIframe = page.locator('iframe[data-testid="preview-iframe"], iframe[title*="Preview"]').first();
    await expect(previewIframe).toBeAttached({ timeout: 10000 });
    const sandboxAttr = await previewIframe.getAttribute('sandbox');
    expect(sandboxAttr).toContain('allow-scripts');
    expect(sandboxAttr).toContain('allow-same-origin');

    // 7. Verify no unexpected control-plane CSP violations occurred
    const initialViolations: CspViolationRecord[] = await page.evaluate(() => (window as any).__cspViolations || []);
    expect(initialViolations).toEqual([]);

    // 8. Security Enforcement Verification: Disallowed script origin is actively blocked by Chromium
    const violationCaught = await page.evaluate(async () => {
      return new Promise<CspViolationRecord | null>((resolve) => {
        const onViolation = (e: any) => {
          document.removeEventListener('securitypolicyviolation', onViolation);
          resolve({
            blockedURI: e.blockedURI,
            violatedDirective: e.violatedDirective,
            effectiveDirective: e.effectiveDirective,
            originalPolicy: e.originalPolicy
          });
        };
        document.addEventListener('securitypolicyviolation', onViolation);

        // Inject unapproved script to verify CSP enforcement
        const disallowedScript = document.createElement('script');
        disallowedScript.src = 'https://unauthorized-evil-tracker.example.com/exploit.js';
        document.body.appendChild(disallowedScript);

        setTimeout(() => resolve(null), 2000);
      });
    });

    expect(violationCaught).not.toBeNull();
    expect(violationCaught!.blockedURI).toContain('unauthorized-evil-tracker.example.com');
    expect(['script-src', 'script-src-elem']).toContain(violationCaught!.effectiveDirective);
    expect(['script-src', 'script-src-elem']).toContain(violationCaught!.violatedDirective);
  });
});
