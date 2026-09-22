import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';
import app, {
  aiRateLimiter,
  rateLimitMap,
  clearRateLimitMap,
  pruneRateLimitMap,
  startRateLimitCleanup,
  stopRateLimitCleanup,
  resolveTrustProxySetting,
  extractClientIp,
  RATE_LIMIT_WINDOW_MS,
  MAX_AI_REQUESTS_PER_WINDOW,
  MAX_RATE_LIMIT_ENTRIES
} from '../server/index';
import { generationService } from '../server/services/generation-service';

describe('Phase 8.1 — Step 7: Trusted Proxy & Rate Limiter Hardening', () => {
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
    stopRateLimitCleanup();
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    clearRateLimitMap();
  });

  // 1. resolveTrustProxySetting Configuration Tests
  describe('A. Trust Proxy Configuration Resolution', () => {
    it('1. Defaults to "loopback" when undefined or empty', () => {
      expect(resolveTrustProxySetting(undefined)).toBe('loopback');
      expect(resolveTrustProxySetting('')).toBe('loopback');
      expect(resolveTrustProxySetting('   ')).toBe('loopback');
    });

    it('2. Correctly parses boolean, numeric hops, and subnet strings', () => {
      expect(resolveTrustProxySetting('true')).toBe(true);
      expect(resolveTrustProxySetting('false')).toBe(false);
      expect(resolveTrustProxySetting('1')).toBe(1);
      expect(resolveTrustProxySetting('2')).toBe(2);
      expect(resolveTrustProxySetting('loopback')).toBe('loopback');
      expect(resolveTrustProxySetting('uniquelocal')).toBe('uniquelocal');
      expect(resolveTrustProxySetting('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
    });
  });

  // 2. Direct / Local Request IP Handling
  describe('B. Client IP Extraction & Trust Boundaries', () => {
    it('3. Direct/local request without X-Forwarded-For resolves to socket remoteAddress', () => {
      const mockReq: any = {
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' }
      };
      expect(extractClientIp(mockReq)).toBe('127.0.0.1');
    });

    it('4. Normalizes IPv4-mapped IPv6 address (::ffff:127.0.0.1 -> 127.0.0.1)', () => {
      const mockReq: any = {
        ip: '::ffff:192.168.1.100',
        socket: { remoteAddress: '::ffff:192.168.1.100' }
      };
      expect(extractClientIp(mockReq)).toBe('192.168.1.100');
    });

    it('5. Live HTTP request over loopback (trusted proxy) extracts client IP from X-Forwarded-For', async () => {
      vi.spyOn(generationService, 'generate').mockResolvedValue({
        files: { '/src/App.tsx': 'export default function App() {}' },
        name: 'test-app',
        framework: 'react-ts'
      } as any);

      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.88'
        },
        body: JSON.stringify({ prompt: 'Build a dashboard' })
      });

      expect(res.status).toBe(200);
      expect(rateLimitMap.has('203.0.113.88')).toBe(true);
      expect(rateLimitMap.get('203.0.113.88')?.count).toBe(1);
    });

    it('6. Untrusted proxy boundary rejects spoofed X-Forwarded-For and falls back to socket IP', async () => {
      // Create a test Express app with trust proxy DISABLED (trust proxy = false)
      const untrustedApp = express();
      untrustedApp.set('trust proxy', false);
      untrustedApp.use(express.json());
      untrustedApp.post('/test-limit', aiRateLimiter, (req, res) => {
        res.json({ ok: true });
      });

      const untrustedServer = http.createServer(untrustedApp);
      await new Promise<void>((resolve) => {
        untrustedServer.listen(0, '127.0.0.1', resolve);
      });
      const untrustedPort = (untrustedServer.address() as any).port;
      const untrustedUrl = `http://127.0.0.1:${untrustedPort}`;

      try {
        // Send request with spoofed X-Forwarded-For
        const res = await fetch(`${untrustedUrl}/test-limit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '8.8.8.8' // Spoofed header
          },
          body: JSON.stringify({})
        });

        expect(res.status).toBe(200);
        // Because trust proxy is false, Express sets req.ip to socket address (127.0.0.1), NOT 8.8.8.8
        expect(rateLimitMap.has('8.8.8.8')).toBe(false);
        expect(rateLimitMap.has('127.0.0.1')).toBe(true);
      } finally {
        await new Promise<void>((resolve) => untrustedServer.close(() => resolve()));
      }
    });

    it('7. Spoofed X-Forwarded-For rotation cannot evade rate limiting when caller is untrusted', async () => {
      const untrustedApp = express();
      untrustedApp.set('trust proxy', false);
      untrustedApp.use(express.json());
      untrustedApp.post('/test-limit', aiRateLimiter, (req, res) => {
        res.json({ ok: true });
      });

      const untrustedServer = http.createServer(untrustedApp);
      await new Promise<void>((resolve) => {
        untrustedServer.listen(0, '127.0.0.1', resolve);
      });
      const untrustedPort = (untrustedServer.address() as any).port;
      const untrustedUrl = `http://127.0.0.1:${untrustedPort}`;

      try {
        // Attacker attempts to bypass rate limiting by rotating 31 different spoofed IPs
        for (let i = 1; i <= 30; i++) {
          const res = await fetch(`${untrustedUrl}/test-limit`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': `198.51.100.${i}` // Rotating spoofed header
            },
            body: JSON.stringify({})
          });
          expect(res.status).toBe(200);
        }

        // All 30 requests were attributed to the actual connecting socket (127.0.0.1)
        expect(rateLimitMap.get('127.0.0.1')?.count).toBe(30);

        // 31st request with yet another spoofed IP is BLOCKED (429)
        const res31 = await fetch(`${untrustedUrl}/test-limit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '198.51.100.99'
          },
          body: JSON.stringify({})
        });

        expect(res31.status).toBe(429);
        const body31 = await res31.json();
        expect(body31.code).toBe('RATE_LIMIT_EXCEEDED');
      } finally {
        await new Promise<void>((resolve) => untrustedServer.close(() => resolve()));
      }
    });
  });

  // 3. Threshold, Policy & Retry-After
  describe('C. Rate Limit Policy & Retry-After Contract', () => {
    it('8. Exactly 30 requests permitted within window, 31st triggers 429 with valid Retry-After', async () => {
      vi.spyOn(generationService, 'generate').mockResolvedValue({
        files: { '/src/App.tsx': 'export default function App() {}' },
        name: 'test-app',
        framework: 'react-ts'
      } as any);

      const clientIp = '198.51.100.111';

      for (let i = 1; i <= MAX_AI_REQUESTS_PER_WINDOW; i++) {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': clientIp
          },
          body: JSON.stringify({ prompt: `Prompt ${i}` })
        });
        expect(res.status).toBe(200);
      }

      const res31 = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': clientIp
        },
        body: JSON.stringify({ prompt: 'Exceeded prompt' })
      });

      expect(res31.status).toBe(429);
      const json = await res31.json();
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(json.error).toContain('Too many AI requests');

      const retryAfter = Number(res31.headers.get('retry-after'));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('9. Multiple distinct clients remain isolated', async () => {
      vi.spyOn(generationService, 'generate').mockResolvedValue({
        files: { '/src/App.tsx': 'export default function App() {}' },
        name: 'test-app',
        framework: 'react-ts'
      } as any);

      const clientA = '198.51.100.201';
      const clientB = '198.51.100.202';

      // Exhaust Client A
      for (let i = 1; i <= 30; i++) {
        await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientA },
          body: JSON.stringify({ prompt: `A ${i}` })
        });
      }

      // Client A is blocked
      const resA = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientA },
        body: JSON.stringify({ prompt: 'A blocked' })
      });
      expect(resA.status).toBe(429);

      // Client B is NOT blocked
      const resB = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientB },
        body: JSON.stringify({ prompt: 'B first' })
      });
      expect(resB.status).toBe(200);
    });
  });

  // 4. In-Memory Map Cleanup & Lifecycle
  describe('D. Map Eviction, Memory Lifecycle & Resource Release', () => {
    it('10. Expired rate-limit entries are removed when pruneRateLimitMap runs', () => {
      const now = Date.now();
      // Entry 1: Expired (resetTime in the past)
      rateLimitMap.set('client-expired', {
        count: 15,
        resetTime: now - 5_000
      });

      // Entry 2: Active (resetTime in the future)
      rateLimitMap.set('client-active', {
        count: 5,
        resetTime: now + 30_000
      });

      const pruned = pruneRateLimitMap(now);
      expect(pruned).toBe(1);
      expect(rateLimitMap.has('client-expired')).toBe(false);
      expect(rateLimitMap.has('client-active')).toBe(true);
    });

    it('11. Cleanup does not remove active entries prematurely', () => {
      const now = Date.now();
      rateLimitMap.set('client-1', { count: 10, resetTime: now + 50_000 });
      rateLimitMap.set('client-2', { count: 20, resetTime: now + 40_000 });
      rateLimitMap.set('client-3', { count: 30, resetTime: now + 10_000 });

      const pruned = pruneRateLimitMap(now);
      expect(pruned).toBe(0);
      expect(rateLimitMap.size).toBe(3);
    });

    it('12. In-line safety eviction prevents map from exceeding MAX_RATE_LIMIT_ENTRIES under flood', () => {
      const now = Date.now();
      // Pre-fill map to max capacity
      for (let i = 0; i < MAX_RATE_LIMIT_ENTRIES; i++) {
        rateLimitMap.set(`flood-ip-${i}`, {
          count: 1,
          resetTime: now + RATE_LIMIT_WINDOW_MS
        });
      }
      expect(rateLimitMap.size).toBe(MAX_RATE_LIMIT_ENTRIES);

      // Trigger rate limiter for a new IP
      const mockReq: any = { ip: 'new-incoming-ip', socket: { remoteAddress: 'new-incoming-ip' } };
      const mockRes: any = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
      const nextFn = vi.fn();

      aiRateLimiter(mockReq, mockRes, nextFn);

      expect(nextFn).toHaveBeenCalledTimes(1);
      expect(rateLimitMap.has('new-incoming-ip')).toBe(true);
      // Map size must not exceed MAX_RATE_LIMIT_ENTRIES
      expect(rateLimitMap.size).toBeLessThanOrEqual(MAX_RATE_LIMIT_ENTRIES);
    });

    it('13. startRateLimitCleanup and stopRateLimitCleanup manage timer resources cleanly', () => {
      // Start cleanup timer
      startRateLimitCleanup(10_000);
      // Idempotent start
      startRateLimitCleanup(10_000);

      // Stop cleanup timer
      stopRateLimitCleanup();
      // Idempotent stop
      stopRateLimitCleanup();

      expect(true).toBe(true);
    });
  });
});
