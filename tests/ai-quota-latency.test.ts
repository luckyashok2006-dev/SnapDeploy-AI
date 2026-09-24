import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app, {
  getDailyAiQuotaState,
  resetDailyAiQuotaForTesting,
  setDailyAiQuotaLimitForTesting,
  DEFAULT_DAILY_AI_REQUEST_LIMIT,
  resolveDailyAiRequestLimit,
  clearRateLimitMap,
  RATE_LIMIT_WINDOW_MS
} from '../server/index';
import {
  geminiAIProvider,
  RollingLatencyTracker,
  RollingLatencyMetrics
} from '../server/providers/GeminiAIProvider';
import { generationService } from '../server/services/generation-service';

describe('Phase 8.2.7: Global Daily AI Quota Circuit Breaker & Rolling Latency Metrics', () => {
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
    resetDailyAiQuotaForTesting();
    setDailyAiQuotaLimitForTesting(null);
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
    resetDailyAiQuotaForTesting();
    setDailyAiQuotaLimitForTesting(null);
    geminiAIProvider.clearLatencyMetricsForTesting();
  });

  // =========================================================================
  // 1. Global Daily AI Request Circuit Breaker
  // =========================================================================
  describe('A. Global Daily AI Request Circuit Breaker', () => {
    it('1. Defaults to 1000 daily requests or uses DAILY_AI_REQUEST_LIMIT', () => {
      expect(DEFAULT_DAILY_AI_REQUEST_LIMIT).toBe(1000);
      expect(resolveDailyAiRequestLimit()).toBe(1000);

      const initial = getDailyAiQuotaState();
      expect(initial.limit).toBe(1000);
      expect(initial.count).toBe(0);
      expect(initial.remaining).toBe(1000);
      expect(initial.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(initial.resetTime).toBeGreaterThan(Date.now());
    });

    it('2. Allows requests below the limit and tracks count up to the limit boundary', async () => {
      // Configure test limit of 3
      resetDailyAiQuotaForTesting(0, undefined, 3);

      vi.spyOn(generationService, 'generate').mockResolvedValue({
        plan: { name: 'test-app', framework: 'vite-react', files: [], dependencies: [], scripts: { dev: 'vite', build: 'vite build' } },
        files: {}
      });

      // Request 1: allowed (count becomes 1)
      const res1 = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create an app 1' })
      });
      expect(res1.status).toBe(200);
      expect(res1.headers.get('x-ratelimit-limit-daily')).toBe('3');
      expect(res1.headers.get('x-ratelimit-remaining-daily')).toBe('2');
      expect(getDailyAiQuotaState().count).toBe(1);

      // Request 2: allowed (count becomes 2)
      const res2 = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create an app 2' })
      });
      expect(res2.status).toBe(200);
      expect(res2.headers.get('x-ratelimit-remaining-daily')).toBe('1');
      expect(getDailyAiQuotaState().count).toBe(2);

      // Request 3 (boundary): allowed (count becomes 3)
      const res3 = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create an app 3' })
      });
      expect(res3.status).toBe(200);
      expect(res3.headers.get('x-ratelimit-remaining-daily')).toBe('0');
      expect(getDailyAiQuotaState().count).toBe(3);
    });

    it('3. Rejects requests exceeding the daily quota with HTTP 429 and DAILY_QUOTA_EXCEEDED', async () => {
      resetDailyAiQuotaForTesting(3, undefined, 3);

      const generateSpy = vi.spyOn(generationService, 'generate');

      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'quota-exceeded-trace-1'
        },
        body: JSON.stringify({ prompt: 'This request should be blocked' })
      });

      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBeTruthy();
      const retryAfter = Number(res.headers.get('retry-after'));
      expect(retryAfter).toBeGreaterThan(0);
      expect(res.headers.get('x-ratelimit-limit-daily')).toBe('3');
      expect(res.headers.get('x-ratelimit-remaining-daily')).toBe('0');

      const body = await res.json();
      expect(body.code).toBe('DAILY_QUOTA_EXCEEDED');
      expect(body.error).toContain('Daily global AI request quota of 3 exceeded');

      // Crucial: AI generation service must not have been invoked
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it('4. Resets the quota counter deterministically when UTC date changes', async () => {
      // Simulate quota filled to 10 on a past date
      resetDailyAiQuotaForTesting(10, '2026-01-01', 5);

      vi.spyOn(generationService, 'generate').mockResolvedValue({
        plan: { name: 'new-day-app', framework: 'vite-react', files: [], dependencies: [], scripts: { dev: 'vite', build: 'vite build' } },
        files: {}
      });

      // When today's request arrives, it detects rollover from 2026-01-01 to current date
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'First request of new day' })
      });

      expect(res.status).toBe(200);
      const state = getDailyAiQuotaState();
      expect(state.count).toBe(1); // Reset to 0 then incremented to 1
      expect(state.remaining).toBe(4);
    });

    it('5. Per-IP rate limiting (30/min) still operates independently of daily quota', async () => {
      // Set daily quota high
      resetDailyAiQuotaForTesting(0, undefined, 1000);

      vi.spyOn(generationService, 'generate').mockResolvedValue({
        plan: { name: 'app', framework: 'vite-react', files: [], dependencies: [], scripts: { dev: 'vite', build: 'vite build' } },
        files: {}
      });

      // Send 30 requests rapidly from same client
      for (let i = 0; i < 30; i++) {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: `Prompt ${i}` })
        });
        expect(res.status).toBe(200);
      }

      // Request 31 trips per-IP rate limit with RATE_LIMIT_EXCEEDED, NOT DAILY_QUOTA_EXCEEDED
      const res31 = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Prompt 31' })
      });

      expect(res31.status).toBe(429);
      const body = await res31.json();
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(getDailyAiQuotaState().count).toBe(30); // Request 31 did not increment daily AI count
    });

    it('6. Validation failures do not increment the daily AI request counter', async () => {
      resetDailyAiQuotaForTesting(0, undefined, 100);
      const initialCount = getDailyAiQuotaState().count;

      // 1. Missing prompt
      const res1 = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '' })
      });
      expect(res1.status).toBe(400);

      // 2. Oversized prompt
      const res2 = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'A'.repeat(10_001) })
      });
      expect(res2.status).toBe(400);

      // 3. Invalid diagnosis payload
      const res3 = await fetch(`${baseUrl}/api/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(res3.status).toBe(400);

      // Verify daily AI invocation count remained untouched
      expect(getDailyAiQuotaState().count).toBe(initialCount);
    });
  });

  // =========================================================================
  // 2. Rolling AI Latency Telemetry (p50 / p95 / p99)
  // =========================================================================
  describe('B. Rolling AI Latency Metrics', () => {
    it('1. Bounded ring buffer records samples and caps size at fixed capacity', () => {
      const capacity = 5;
      const tracker = new RollingLatencyTracker(capacity);

      // Record 8 samples: [10, 20, 30, 40, 50, 60, 70, 80]
      for (let i = 1; i <= 8; i++) {
        tracker.record(i * 10);
      }

      const samples = tracker.getSamples();
      expect(samples.length).toBe(capacity);
      // Older items [10, 20, 30] overwritten; remaining are [40, 50, 60, 70, 80]
      expect(samples).toEqual([40, 50, 60, 70, 80]);

      const metrics = tracker.getMetrics();
      expect(metrics.sampleCount).toBe(5);
      expect(metrics.maxMs).toBe(80);
      expect(metrics.avgMs).toBe(60); // (40+50+60+70+80) / 5 = 60
    });

    it('2. Correctly computes deterministic p50, p95, and p99 percentiles across 100 samples', () => {
      const tracker = new RollingLatencyTracker(100);

      // Record 100 durations exactly: 1ms, 2ms, ..., 100ms
      for (let i = 1; i <= 100; i++) {
        tracker.record(i);
      }

      const metrics = tracker.getMetrics();
      expect(metrics.sampleCount).toBe(100);
      expect(metrics.p50Ms).toBe(50);
      expect(metrics.p95Ms).toBe(95);
      expect(metrics.p99Ms).toBe(99);
      expect(metrics.maxMs).toBe(100);
      expect(metrics.avgMs).toBe(50.5);
    });

    it('3. Safely handles empty history with zero metrics', () => {
      const tracker = new RollingLatencyTracker(100);
      const metrics = tracker.getMetrics();

      expect(metrics.sampleCount).toBe(0);
      expect(metrics.p50Ms).toBe(0);
      expect(metrics.p95Ms).toBe(0);
      expect(metrics.p99Ms).toBe(0);
      expect(metrics.avgMs).toBe(0);
      expect(metrics.maxMs).toBe(0);
    });

    it('4. Exposes latency metrics and daily quota state in /api/ai/status while preserving backward compatibility', async () => {
      // Record sample executions via geminiAIProvider
      (geminiAIProvider as any).recordExecution({
        id: 'test-exec-1',
        operation: 'generate',
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 250,
        success: true
      });

      (geminiAIProvider as any).recordExecution({
        id: 'test-exec-2',
        operation: 'diagnose',
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 750,
        success: true
      });

      const res = await fetch(`${baseUrl}/api/ai/status`);
      expect(res.status).toBe(200);

      const data = await res.json();

      // Backward compatible fields
      expect(data.provider).toBe('gemini');
      expect(typeof data.model).toBe('string');
      expect(typeof data.configured).toBe('boolean');
      expect(typeof data.recentExecutionsCount).toBe('number');
      expect(data.recentExecutionsCount).toBeGreaterThanOrEqual(2);

      // Latency telemetry fields
      expect(data.latency).toBeDefined();
      expect(data.latency.sampleCount).toBe(2);
      expect(data.latency.avgMs).toBe(500); // (250 + 750) / 2
      expect(data.latency.maxMs).toBe(750);
      expect(data.latency.p50Ms).toBe(250);
      expect(data.latency.p95Ms).toBe(750);
      expect(data.latency.p99Ms).toBe(750);

      // Daily quota fields
      expect(data.dailyQuota).toBeDefined();
      expect(typeof data.dailyQuota.used).toBe('number');
      expect(typeof data.dailyQuota.limit).toBe('number');
      expect(typeof data.dailyQuota.remaining).toBe('number');
      expect(data.dailyQuota.resetsAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
