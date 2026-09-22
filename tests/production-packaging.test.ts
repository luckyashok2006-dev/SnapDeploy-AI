import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';

describe('Phase 8.1 — Step 14: Production Runtime Packaging & Containerization', () => {
  const rootDir = path.resolve(__dirname, '..');
  const pkgPath = path.join(rootDir, 'package.json');
  const lockPath = path.join(rootDir, 'package-lock.json');
  const dockerfilePath = path.join(rootDir, 'Dockerfile');
  const dockerignorePath = path.join(rootDir, '.dockerignore');
  const distServerDir = path.join(rootDir, 'dist-server');
  const distServerEntry = path.join(distServerDir, 'index.js');
  const distServerTemplates = path.join(distServerDir, 'templates', 'canonical-package-lock.json');
  const distClientDir = path.join(rootDir, 'dist');

  let testServerProcess: ChildProcess | null = null;
  const testPort = 3591;
  const baseUrl = `http://127.0.0.1:${testPort}`;

  beforeAll(async () => {
    // Start compiled server process with explicit test port
    testServerProcess = spawn(process.execPath, [distServerEntry], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(testPort),
        HOST: '127.0.0.1',
        NODE_ENV: 'production'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Wait for server to become reachable
    const maxRetries = 40;
    let ready = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`${baseUrl}/api/health/liveness`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }

    if (!ready) {
      throw new Error(`Compiled server failed to boot on port ${testPort}`);
    }
  });

  afterAll(async () => {
    if (testServerProcess && !testServerProcess.killed) {
      testServerProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  // =========================================================================
  // 1. Server Compilation & Build Artifact Integrity
  // =========================================================================
  describe('1. Server Compilation Artifacts & Build Pipeline', () => {
    it('generates a compiled JavaScript server bundle without requiring tsx at runtime', () => {
      expect(fs.existsSync(distServerEntry)).toBe(true);
      const stat = fs.statSync(distServerEntry);
      expect(stat.size).toBeGreaterThan(10_000); // Verify bundle is populated

      const content = fs.readFileSync(distServerEntry, 'utf8');
      expect(content).toContain('SnapDeploy AI Production Server Runtime');
    });

    it('copies server templates into dist-server/templates for self-contained runtime', () => {
      expect(fs.existsSync(distServerTemplates)).toBe(true);
      const lockStat = fs.statSync(distServerTemplates);
      expect(lockStat.size).toBeGreaterThan(1000);
    });

    it('verifies package.json scripts use plain node for production start and no tsx in dependencies', () => {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      expect(pkg.scripts.start).toBe('node dist-server/index.js');
      expect(pkg.scripts.build).toBe('npm run build:client && npm run build:server');
      expect(pkg.scripts['build:server']).toBe('node scripts/build-server.js');

      // Crucial: tsx must NOT be in runtime dependencies
      expect(pkg.dependencies.tsx).toBeUndefined();
      expect(pkg.devDependencies.tsx).toBeDefined();

      // Core production server dependencies remain in dependencies
      expect(pkg.dependencies.express).toBeDefined();
      expect(pkg.dependencies.cors).toBeDefined();
      expect(pkg.dependencies.dotenv).toBeDefined();
      expect(pkg.dependencies['@google/genai']).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Compiled Server Runtime Verification (Local Execution)
  // =========================================================================
  describe('2. Compiled Server Runtime HTTP Endpoints & Behavior', () => {
    it('honors runtime PORT environment variable and responds 200 on /api/health/liveness', async () => {
      const res = await fetch(`${baseUrl}/api/health/liveness`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ok');
    });

    it('responds on /api/health/readiness matching Gemini configuration status', async () => {
      const res = await fetch(`${baseUrl}/api/health/readiness`);
      expect([200, 503]).toContain(res.status);
      const json = await res.json();
      expect(['ready', 'not_ready']).toContain(json.status);
    });

    it('serves SPA root (index.html) with correct revalidation cache policy', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.toLowerCase()).toContain('<!doctype html>');
      expect(text).toContain('SnapDeploy AI');

      // SPA index.html must revalidate
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('must-revalidate');
    });

    it('serves static hashed assets with immutable long-term cache headers', async () => {
      const assetsDir = path.join(distClientDir, 'assets');
      const files = fs.readdirSync(assetsDir);
      const targetJs = files.find((f) => f.endsWith('.js'));
      expect(targetJs).toBeDefined();

      const res = await fetch(`${baseUrl}/assets/${targetJs}`);
      expect(res.status).toBe(200);
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('immutable');
      expect(cacheControl).toContain('max-age=31536000');
    });

    it('preserves all Phase 8.1 security headers on compiled server responses', async () => {
      const res = await fetch(`${baseUrl}/api/health/liveness`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');

      // Content Security Policy header present
      const csp = res.headers.get('content-security-policy') || res.headers.get('content-security-policy-report-only');
      expect(csp).toBeDefined();
    });

    it('preserves request correlation ID and structured error isolation on compiled server', async () => {
      const clientReqId = 'compiled-server-test-corr-id-123';
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': clientReqId
        },
        body: 'invalid-json-body-syntax'
      });

      expect(res.status).toBe(400);
      expect(res.headers.get('x-request-id')).toBe(clientReqId);
      const body = await res.json();
      expect(body.code).toBe('BAD_REQUEST');
    });
  });

  // =========================================================================
  // 3. Multi-Stage Dockerfile Architecture & Container Security
  // =========================================================================
  describe('3. Dockerfile Multi-Stage & Container Security Architecture', () => {
    it('defines multi-stage builder and runner stages using supported Node 24 LTS image without stale Node 20', () => {
      expect(fs.existsSync(dockerfilePath)).toBe(true);
      const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

      // Multi-stage builder & runner must both use Node 24 LTS
      expect(dockerfile).toMatch(/FROM\s+node:24-alpine\s+AS\s+builder/i);
      expect(dockerfile).toMatch(/FROM\s+node:24-alpine\s+AS\s+runner/i);

      // Verify NO stale Node 20 reference remains
      expect(dockerfile).not.toContain('node:20');

      // Reproducible dependency installation
      expect(dockerfile).toContain('npm ci');
      expect(dockerfile).toContain('npm ci --omit=dev');

      // Runs build
      expect(dockerfile).toContain('npm run build');

      // Copies compiled artifacts
      expect(dockerfile).toContain('COPY --from=builder');
      expect(dockerfile).toContain('/app/dist ./dist');
      expect(dockerfile).toContain('/app/dist-server ./dist-server');

      // Enforces non-root user
      expect(dockerfile).toMatch(/USER\s+node/i);

      // Exposes port conventionally
      expect(dockerfile).toMatch(/EXPOSE\s+3001/i);

      // Runs compiled server with plain node
      expect(dockerfile).toContain('CMD ["node", "dist-server/index.js"]');
    });

    it('verifies production Gemini documentation matches Step 5 mock-provider safety contract', () => {
      const envExamplePath = path.join(rootDir, '.env.example');
      expect(fs.existsSync(envExamplePath)).toBe(true);
      const envContent = fs.readFileSync(envExamplePath, 'utf8');

      // Must document GEMINI_API_KEY
      expect(envContent).toContain('GEMINI_API_KEY');

      // Must document that mock providers remain disabled in production (Step 5 contract)
      expect(envContent).toContain('Production mock providers remain strictly disabled');

      // Must document readiness failure when unconfigured (Step 8 contract)
      expect(envContent).toContain('GEMINI_PROVIDER_UNCONFIGURED');

      // Must NOT claim automatic mock fallback in production
      expect(envContent).not.toContain('falls back to mock');
      expect(envContent).not.toContain('safely uses mock');
    });

    it('includes lightweight liveness HEALTHCHECK targeting /api/health/liveness without Gemini calls', () => {
      const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
      expect(dockerfile).toContain('HEALTHCHECK');
      expect(dockerfile).toContain('/api/health/liveness');
      // Must not check readiness in container-level liveness healthcheck
      expect(dockerfile).not.toContain('/api/health/readiness');
    });

    it('excludes secrets, node_modules, and test files in .dockerignore', () => {
      expect(fs.existsSync(dockerignorePath)).toBe(true);
      const dockerignore = fs.readFileSync(dockerignorePath, 'utf8');

      const expectedExclusions = [
        'node_modules',
        '.git',
        'dist',
        'dist-server',
        'tests',
        'test-results',
        '.env',
        'scratch'
      ];

      for (const exclusion of expectedExclusions) {
        expect(dockerignore).toContain(exclusion);
      }
    });
  });

  // =========================================================================
  // 4. Reproducible Lockfile & Dependency Hygiene
  // =========================================================================
  describe('4. Reproducible Lockfile & Dependency Hygiene', () => {
    it('ensures package-lock.json matches package.json and has valid lockfileVersion', () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      const lockfile = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect([2, 3]).toContain(lockfile.lockfileVersion);

      // Verify express, cors, dotenv, @google/genai are registered in lockfile packages
      expect(lockfile.packages['node_modules/express']).toBeDefined();
      expect(lockfile.packages['node_modules/cors']).toBeDefined();
      expect(lockfile.packages['node_modules/dotenv']).toBeDefined();
      expect(lockfile.packages['node_modules/@google/genai']).toBeDefined();
    });
  });
});
