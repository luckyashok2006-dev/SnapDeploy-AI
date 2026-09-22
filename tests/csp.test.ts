import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import app, {
  distPath,
  DEFAULT_CSP_DIRECTIVES,
  buildCspHeaderValue,
  getCspHeaderName,
  isCspEnabled,
  isCspReportOnly,
  sanitizeCspSource,
  sanitizeReportUri
} from '../server/index';

describe('Phase 8.1 — Step 11 & 11A: Content Security Policy (CSP) & Tightening', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  // 1. Directives & Tightening Forensic Alignment
  describe('A. Tightened CSP Directives & Forensic Alignment', () => {
    it('1. Contains all required modern directives and excludes obsolete child-src', () => {
      const keys = Object.keys(DEFAULT_CSP_DIRECTIVES);
      expect(keys).toContain('default-src');
      expect(keys).toContain('script-src');
      expect(keys).toContain('style-src');
      expect(keys).toContain('font-src');
      expect(keys).toContain('img-src');
      expect(keys).toContain('connect-src');
      expect(keys).toContain('worker-src');
      expect(keys).toContain('frame-src');
      expect(keys).toContain('object-src');
      expect(keys).toContain('base-uri');
      expect(keys).toContain('form-action');
      expect(keys).toContain('frame-ancestors');

      // child-src is deprecated in CSP3 and superseded by worker-src + frame-src
      expect(keys).not.toContain('child-src');
    });

    it('2. script-src supports WebContainer WASM, Monaco loader, and StackBlitz iframe without unsafe-inline', () => {
      const scriptSrc = DEFAULT_CSP_DIRECTIVES['script-src'];
      expect(scriptSrc).toContain("'self'");
      expect(scriptSrc).toContain("'wasm-unsafe-eval'");
      expect(scriptSrc).toContain("'unsafe-eval'");
      expect(scriptSrc).toContain('https://cdn.jsdelivr.net');
      expect(scriptSrc).toContain('https://stackblitz.com');

      // script-src strictly forbids unsafe-inline
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it('3. style-src permits React/Tailwind inline styles, Google Fonts, and Monaco CSS', () => {
      const styleSrc = DEFAULT_CSP_DIRECTIVES['style-src'];
      expect(styleSrc).toContain("'self'");
      expect(styleSrc).toContain("'unsafe-inline'");
      expect(styleSrc).toContain('https://fonts.googleapis.com');
      expect(styleSrc).toContain('https://cdn.jsdelivr.net');
    });

    it('4. font-src permits Google Fonts, data URIs, and Monaco codicons', () => {
      const fontSrc = DEFAULT_CSP_DIRECTIVES['font-src'];
      expect(fontSrc).toContain("'self'");
      expect(fontSrc).toContain('https://fonts.gstatic.com');
      expect(fontSrc).toContain('https://cdn.jsdelivr.net');
      expect(fontSrc).toContain('data:');
    });

    it('5. img-src is tightened to explicit origins (avatars & placeholders) rather than broad https:', () => {
      const imgSrc = DEFAULT_CSP_DIRECTIVES['img-src'];
      expect(imgSrc).toContain("'self'");
      expect(imgSrc).toContain('data:');
      expect(imgSrc).toContain('blob:');
      expect(imgSrc).toContain('https://avatars.githubusercontent.com');
      expect(imgSrc).toContain('https://placehold.co');

      // Wildcard https: is removed for tighter origin enforcement
      expect(imgSrc).not.toContain('https:');
    });

    it('6. connect-src permits GitHub API, Netlify API, Supabase, and WebContainer endpoints', () => {
      const connectSrc = DEFAULT_CSP_DIRECTIVES['connect-src'];
      expect(connectSrc).toContain("'self'");
      expect(connectSrc).toContain('https://api.github.com');
      expect(connectSrc).toContain('https://api.netlify.com');
      expect(connectSrc).toContain('https://*.supabase.co');
      expect(connectSrc).toContain('https://fonts.googleapis.com');
      expect(connectSrc).toContain('https://fonts.gstatic.com');
      expect(connectSrc).toContain('https://cdn.jsdelivr.net');
      expect(connectSrc).toContain('https://stackblitz.com');
      expect(connectSrc).toContain('https://*.webcontainer-api.io');
      expect(connectSrc).toContain('https://*.webcontainer.io');

      // In production DEFAULT_CSP_DIRECTIVES, unneeded websocket schemes are excluded
      expect(connectSrc).not.toContain('ws:');
      expect(connectSrc).not.toContain('wss:');
    });

    it('7. worker-src permits blob: and Monaco CDN workers', () => {
      const workerSrc = DEFAULT_CSP_DIRECTIVES['worker-src'];
      expect(workerSrc).toContain("'self'");
      expect(workerSrc).toContain('blob:');
      expect(workerSrc).toContain('https://cdn.jsdelivr.net');
    });

    it('8. frame-src permits preview frames and StackBlitz without unneeded blob: frames', () => {
      const frameSrc = DEFAULT_CSP_DIRECTIVES['frame-src'];
      expect(frameSrc).toContain("'self'");
      expect(frameSrc).toContain('https://stackblitz.com');
      expect(frameSrc).toContain('https://*.webcontainer-api.io');
      expect(frameSrc).toContain('https://*.webcontainer.io');

      // blob: is not used for iframes and is removed
      expect(frameSrc).not.toContain('blob:');
    });

    it('9. object-src is strictly none and base-uri/form-action are self', () => {
      expect(DEFAULT_CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
      expect(DEFAULT_CSP_DIRECTIVES['base-uri']).toEqual(["'self'"]);
      expect(DEFAULT_CSP_DIRECTIVES['form-action']).toEqual(["'self'"]);
      expect(DEFAULT_CSP_DIRECTIVES['frame-ancestors']).toEqual(["'self'"]);
    });
  });

  // 2. Sanitization & Configuration Helpers
  describe('B. CSP Sanitization & Directive Injection Prevention', () => {
    it('10. sanitizeCspSource accepts valid keywords, schemes, and domains', () => {
      expect(sanitizeCspSource("'self'")).toBe("'self'");
      expect(sanitizeCspSource("'wasm-unsafe-eval'")).toBe("'wasm-unsafe-eval'");
      expect(sanitizeCspSource('https://my-supabase.example.com')).toBe('https://my-supabase.example.com');
      expect(sanitizeCspSource('https://*.internal.net:8443')).toBe('https://*.internal.net:8443');
    });

    it('11. sanitizeCspSource rejects directive injection attempts and malformed inputs', () => {
      expect(sanitizeCspSource("https://evil.com; script-src 'unsafe-inline'")).toBeNull();
      expect(sanitizeCspSource("https://evil.com\r\nX-Injected: header")).toBeNull();
      expect(sanitizeCspSource("https://evil.com\n")).toBeNull();
      expect(sanitizeCspSource('   ')).toBeNull();
      expect(sanitizeCspSource("javascript:alert(1)")).toBeNull();
    });

    it('12. sanitizeReportUri accepts valid URIs and rejects injections', () => {
      expect(sanitizeReportUri('/api/csp-report')).toBe('/api/csp-report');
      expect(sanitizeReportUri('https://collector.example.com/csp')).toBe('https://collector.example.com/csp');
      expect(sanitizeReportUri('https://collector.example.com; script-src *')).toBeNull();
      expect(sanitizeReportUri('/api/report\r\nBadHeader: 1')).toBeNull();
    });

    it('13. Correctly evaluates isCspEnabled', () => {
      expect(isCspEnabled(undefined)).toBe(true);
      expect(isCspEnabled('true')).toBe(true);
      expect(isCspEnabled('1')).toBe(true);
      expect(isCspEnabled('false')).toBe(false);
      expect(isCspEnabled('FALSE')).toBe(false);
    });

    it('14. Correctly determines Report-Only header name vs Enforced header name', () => {
      expect(getCspHeaderName(undefined)).toBe('Content-Security-Policy');
      expect(getCspHeaderName('false')).toBe('Content-Security-Policy');
      expect(getCspHeaderName('true')).toBe('Content-Security-Policy-Report-Only');
      expect(getCspHeaderName('1')).toBe('Content-Security-Policy-Report-Only');
    });

    it('15. buildCspHeaderValue correctly appends sanitized report-uri', () => {
      const cspWithReport = buildCspHeaderValue(undefined, 'https://csp-report.snapdeploy.ai/report');
      expect(cspWithReport).toContain('report-uri https://csp-report.snapdeploy.ai/report');
    });

    it('16. buildCspHeaderValue safely adds extra origins while dropping invalid injection tokens', () => {
      const customCsp = buildCspHeaderValue(
        undefined,
        undefined,
        "https://my-supabase.internal.com, https://injected.com; script-src *, https://custom-api.example.com"
      );
      expect(customCsp).toContain('https://my-supabase.internal.com');
      expect(customCsp).toContain('https://custom-api.example.com');
      expect(customCsp).not.toContain('injected.com;');
    });
  });

  // 3. Live HTTP Integration & Header Verification
  describe('C. Live HTTP Endpoint CSP Delivery', () => {
    it('17. Root HTML response receives enforced Content-Security-Policy header', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);

      const cspHeader = res.headers.get('content-security-policy');
      expect(cspHeader).toBeDefined();
      expect(cspHeader).not.toBeNull();
      expect(cspHeader).toContain("default-src 'self'");
      expect(cspHeader).toContain("'wasm-unsafe-eval'");
      expect(cspHeader).toContain('https://stackblitz.com');
      expect(cspHeader).toContain('https://*.webcontainer-api.io');
      expect(cspHeader).toContain("frame-ancestors 'self'");
      expect(cspHeader).not.toContain('child-src');
    });

    it('18. API endpoints receive Content-Security-Policy header', async () => {
      const res = await fetch(`${baseUrl}/api/health/liveness`);
      expect(res.status).toBe(200);

      const cspHeader = res.headers.get('content-security-policy');
      expect(cspHeader).toBeDefined();
      expect(cspHeader).toContain("default-src 'self'");
    });

    it('19. Static hashed assets receive Content-Security-Policy header alongside immutable cache', async () => {
      const assetFiles = fs.readdirSync(path.join(distPath, 'assets'));
      const jsFile = assetFiles.find((f) => f.endsWith('.js'));
      expect(jsFile).toBeDefined();

      const res = await fetch(`${baseUrl}/assets/${jsFile}`);
      expect(res.status).toBe(200);

      const cspHeader = res.headers.get('content-security-policy');
      expect(cspHeader).toBeDefined();
      expect(cspHeader).toContain("default-src 'self'");
    });

    it('20. Existing security headers remain active and intact alongside CSP', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);

      expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('x-xss-protection')).toBe('1; mode=block');
    });

    it('21. CSP header does not leak server secrets or environment tokens', async () => {
      const res = await fetch(`${baseUrl}/`);
      const cspHeader = res.headers.get('content-security-policy') || '';

      expect(cspHeader).not.toMatch(/AIzaSy[0-9A-Za-z-_]{25,45}/);
      expect(cspHeader).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(cspHeader).not.toContain('GEMINI_API_KEY');
    });
  });
});
