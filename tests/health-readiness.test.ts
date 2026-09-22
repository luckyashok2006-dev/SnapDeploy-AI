import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app from '../server/index';
import { geminiAIProvider } from '../server/providers/GeminiAIProvider';

describe('Phase 8.1 — Step 8: Liveness and Readiness Health Endpoints', () => {
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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Liveness Probe (GET /api/health/liveness)
  // =========================================================================
  describe('A. Process Liveness (GET /api/health/liveness)', () => {
    it('1. Returns HTTP 200 with status "ok" when process is alive', async () => {
      const res = await fetch(`${baseUrl}/api/health/liveness`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });

    it('2. Liveness does not require Gemini configuration (returns 200 even when unconfigured)', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(false);

      const res = await fetch(`${baseUrl}/api/health/liveness`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
    });

    it('3. Liveness does not invoke external Gemini client methods', async () => {
      const clientSpy = vi.spyOn(geminiAIProvider as any, 'ensureClient');

      const res = await fetch(`${baseUrl}/api/health/liveness`);
      expect(res.status).toBe(200);
      expect(clientSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Readiness Probe (GET /api/health/readiness)
  // =========================================================================
  describe('B. Application Readiness (GET /api/health/readiness)', () => {
    it('4. Returns HTTP 503 and "not_ready" when Gemini provider is unconfigured', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(false);

      const res = await fetch(`${baseUrl}/api/health/readiness`);
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data.status).toBe('not_ready');
      expect(data.reason).toBe('GEMINI_PROVIDER_UNCONFIGURED');
      expect(data.error).toContain('Set GEMINI_API_KEY');
      expect(data.checks?.server).toBe('ok');
      expect(data.checks?.aiProvider).toBe('missing_configuration');
    });

    it('5. Returns HTTP 200 and "ready" when Gemini provider is configured', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(true);

      const res = await fetch(`${baseUrl}/api/health/readiness`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ready');
      expect(data.checks?.server).toBe('ok');
      expect(data.checks?.aiProvider).toBe('configured');
    });

    it('6. Readiness does not invoke live generateContent calls merely to probe status', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(true);
      const clientSpy = vi.spyOn(geminiAIProvider as any, 'ensureClient');

      const res = await fetch(`${baseUrl}/api/health/readiness`);
      expect(res.status).toBe(200);
      expect(clientSpy).not.toHaveBeenCalled();
    });

    it('7. Readiness response never exposes API keys, tokens, or filesystem paths', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(false);

      const res = await fetch(`${baseUrl}/api/health/readiness`);
      const text = await res.text();

      // Verify no secrets or sensitive patterns leaked
      expect(text).not.toContain('AIzaSy');
      expect(text).not.toContain('Bearer');
      expect(text).not.toContain('C:\\');
      expect(text).not.toContain('/home/');
    });
  });

  // =========================================================================
  // 3. Backward Compatibility: General Health (GET /api/health)
  // =========================================================================
  describe('C. Backward Compatibility (GET /api/health)', () => {
    it('8. /api/health returns HTTP 200 with AI metadata when unconfigured', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(false);

      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.ai.provider).toBe('gemini');
      expect(data.ai.configured).toBe(false);
      expect(data.ai.model).toBeDefined();
    });

    it('9. /api/health returns HTTP 200 with AI metadata when configured', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(true);

      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.ai.configured).toBe(true);
    });
  });

  // =========================================================================
  // 4. Diagnostic Status (GET /api/ai/status)
  // =========================================================================
  describe('D. Informational Diagnostic Status (GET /api/ai/status)', () => {
    it('10. /api/ai/status retains its intended diagnostic schema', async () => {
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(true);

      const res = await fetch(`${baseUrl}/api/ai/status`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.provider).toBe('gemini');
      expect(data.model).toBeDefined();
      expect(data.configured).toBe(true);
      expect(typeof data.recentExecutionsCount).toBe('number');
    });
  });

  // =========================================================================
  // 5. Unthrottled Probing (Health probes bypass aiRateLimiter)
  // =========================================================================
  describe('E. Health Probing Capacity', () => {
    it('11. Rapid health probes (>30 requests) are not blocked by rate limiting', async () => {
      for (let i = 0; i < 35; i++) {
        const res = await fetch(`${baseUrl}/api/health/liveness`);
        expect(res.status).toBe(200);
      }
    });
  });
});
