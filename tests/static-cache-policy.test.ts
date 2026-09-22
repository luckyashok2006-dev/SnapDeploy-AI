import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import app, {
  distPath,
  CACHE_POLICY_IMMUTABLE,
  CACHE_POLICY_REVALIDATE,
  getStaticAssetCacheControl
} from '../server/index';

describe('Phase 8.1 — Step 10: Production Static-Asset Cache Policy', () => {
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

  // 1. Unit evaluation of cache policy helper
  describe('A. Cache Policy Helper Evaluation', () => {
    it('1. Returns long-lived immutable cache for hashed assets in assets/ directory', () => {
      expect(getStaticAssetCacheControl('dist/assets/index-J67jV7ng.js')).toBe(CACHE_POLICY_IMMUTABLE);
      expect(getStaticAssetCacheControl('/assets/index-i5KWLQYl.css')).toBe(CACHE_POLICY_IMMUTABLE);
      expect(getStaticAssetCacheControl('C:\\app\\dist\\assets\\chunk-xyz123.js')).toBe(CACHE_POLICY_IMMUTABLE);
    });

    it('2. Returns revalidation cache policy for HTML entry point, fallbacks, and root assets', () => {
      expect(getStaticAssetCacheControl('dist/index.html')).toBe(CACHE_POLICY_REVALIDATE);
      expect(getStaticAssetCacheControl('/index.html')).toBe(CACHE_POLICY_REVALIDATE);
      expect(getStaticAssetCacheControl('dist/favicon.ico')).toBe(CACHE_POLICY_REVALIDATE);
    });
  });

  // 2. Live HTTP Static Serving Tests (against built dist/)
  describe('B. Live HTTP Static Serving & Cache Headers', () => {
    it('3. Hashed JS asset receives long-lived immutable Cache-Control header', async () => {
      const assetFiles = fs.readdirSync(path.join(distPath, 'assets'));
      const jsFile = assetFiles.find((f) => f.endsWith('.js'));
      expect(jsFile).toBeDefined();

      const res = await fetch(`${baseUrl}/assets/${jsFile}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(CACHE_POLICY_IMMUTABLE);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    });

    it('4. Hashed CSS asset receives long-lived immutable Cache-Control header', async () => {
      const assetFiles = fs.readdirSync(path.join(distPath, 'assets'));
      const cssFile = assetFiles.find((f) => f.endsWith('.css'));
      expect(cssFile).toBeDefined();

      const res = await fetch(`${baseUrl}/assets/${cssFile}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(CACHE_POLICY_IMMUTABLE);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    });

    it('5. index.html receives revalidation Cache-Control header (max-age=0, must-revalidate)', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(CACHE_POLICY_REVALIDATE);
      const text = await res.text();
      expect(text).toContain('<!doctype html>');
      expect(text).toContain('/assets/');
    });

    it('6. SPA fallback route receives revalidation Cache-Control header', async () => {
      const res = await fetch(`${baseUrl}/projects/test-project-uuid-12345/edit`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(CACHE_POLICY_REVALIDATE);
      const text = await res.text();
      expect(text).toContain('<!doctype html>');
    });

    it('7. API routes do NOT receive static asset cache headers', async () => {
      const res = await fetch(`${baseUrl}/api/health/liveness`);
      expect(res.status).toBe(200);
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).not.toBe(CACHE_POLICY_IMMUTABLE);
    });

    it('8. Security headers remain present on served static assets', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    });

    it('9. Nonexistent static assets under /assets/ return HTTP 404 (no false SPA HTML fallback)', async () => {
      const res = await fetch(`${baseUrl}/assets/nonexistent-chunk-99999.js`);
      expect(res.status).toBe(404);
    });
  });
});
