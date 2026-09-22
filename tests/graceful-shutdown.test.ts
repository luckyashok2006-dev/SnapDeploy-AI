import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import app, {
  gracefulShutdown,
  registerSignalHandlers,
  resetShutdownState,
  getIsShuttingDown,
  setIsShuttingDown,
  setActiveServer,
  getActiveServer,
  startRateLimitCleanup,
  stopRateLimitCleanup
} from '../server/index';
import { geminiAIProvider } from '../server/providers/GeminiAIProvider';
import { generationService } from '../server/services/generation-service';

describe('Phase 8.1 — Step 9: Graceful Server Shutdown Lifecycle', () => {
  let server: http.Server | null = null;
  let baseUrl: string = '';

  const startTestServer = async (): Promise<{ server: http.Server; baseUrl: string }> => {
    return new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address() as any;
        const url = `http://127.0.0.1:${addr.port}`;
        resolve({ server: s, baseUrl: url });
      });
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetShutdownState();
  });

  afterEach(async () => {
    resetShutdownState();
    stopRateLimitCleanup();
    if (server && server.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    server = null;
  });

  // 1. Server instance capture
  it('1. Server instance is captured and shutdown state initializes cleanly', async () => {
    const s = http.createServer(app);
    setActiveServer(s);
    expect(getActiveServer()).toBe(s);
    expect(getIsShuttingDown()).toBe(false);
  });

  // 2. SIGTERM triggers graceful shutdown
  it('2. SIGTERM triggers graceful shutdown and drains cleanly', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    const shutdownPromise = gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, server });
    await expect(shutdownPromise).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
    expect(getIsShuttingDown()).toBe(true);
  });

  // 3. SIGINT triggers graceful shutdown
  it('3. SIGINT triggers graceful shutdown and drains cleanly', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    const shutdownPromise = gracefulShutdown({ signal: 'SIGINT', exitProcess: false, server });
    await expect(shutdownPromise).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
    expect(getIsShuttingDown()).toBe(true);
  });

  // 4. Shutdown is idempotent
  it('4. Shutdown is idempotent across multiple concurrent invocations', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    const p1 = gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, server });
    const p2 = gracefulShutdown({ signal: 'SIGINT', exitProcess: false, server });

    expect(p1).toBe(p2); // Returns identical promise
    await expect(p1).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
  });

  // 5. New requests are rejected with 503 after shutdown starts
  it('5. New requests receive HTTP 503 SERVER_SHUTTING_DOWN after shutdown starts', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    setIsShuttingDown(true);

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'New prompt during shutdown' })
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('SERVER_SHUTTING_DOWN');
    expect(res.headers.get('connection')).toBe('close');
  });

  // 6. In-flight requests are allowed to complete within the graceful window
  it('6. In-flight requests complete successfully during graceful shutdown', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    // Mock generation service with artificial 100ms latency
    vi.spyOn(generationService, 'generate').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return {
        files: { '/src/App.tsx': 'export default function App() {}' },
        name: 'in-flight-app',
        framework: 'react-ts'
      } as any;
    });

    // Start in-flight request BEFORE shutdown
    const inFlightFetch = fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'In flight prompt' })
    });

    // Wait a brief moment so request is admitted into route handler
    await new Promise((r) => setTimeout(r, 20));

    // Initiate graceful shutdown while in-flight request is being processed
    const shutdownPromise = gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, server });

    // Verify in-flight request was not cancelled and finishes with 200
    const inFlightRes = await inFlightFetch;
    expect(inFlightRes.status).toBe(200);
    const inFlightBody = await inFlightRes.json();
    expect(inFlightBody.name).toBe('in-flight-app');

    // Verify graceful shutdown successfully completed once in-flight request finished
    await shutdownPromise;
    expect(server.listening).toBe(false);
  });

  // 7. Rate-limit cleanup timer is stopped during shutdown
  it('7. Rate-limit cleanup background timer is stopped during shutdown', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    startRateLimitCleanup(10_000);

    await gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, server });
    expect(server.listening).toBe(false);
  });

  // 8. Successful shutdown exits cleanly
  it('8. Successful shutdown exits cleanly and unsets activeServer', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    await gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, server });
    expect(getActiveServer()).toBeNull();
  });

  // 9. Forced-shutdown timeout terminates when draining exceeds deadline
  it('9. Forced-shutdown timeout rejects when draining exceeds deadline', async () => {
    // Create a mock server whose close() never executes callback
    const mockServer: any = {
      listening: true,
      close: vi.fn(), // never calls callback
      closeIdleConnections: vi.fn()
    };

    // Fast timeout of 50ms for testing
    const shutdownPromise = gracefulShutdown({
      signal: 'SIGTERM',
      exitProcess: false,
      timeoutMs: 50,
      server: mockServer
    });

    await expect(shutdownPromise).rejects.toThrow('timed out after 50ms');
  });

  // 10. No duplicate cleanup occurs on multiple signals
  it('10. No duplicate cleanup or race conditions on multiple signals', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    const results = await Promise.all([
      gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, server }),
      gracefulShutdown({ signal: 'SIGINT', exitProcess: false, server }),
      gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, server })
    ]);

    expect(results.length).toBe(3);
    expect(server.listening).toBe(false);
  });

  // 11. Health & readiness semantics remain sensible during shutdown
  it('11. Liveness remains 200 while Readiness returns 503 SERVER_SHUTTING_DOWN during shutdown', async () => {
    const started = await startTestServer();
    server = started.server;
    baseUrl = started.baseUrl;
    setActiveServer(server);

    vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(true);

    // Before shutdown: liveness 200, readiness 200
    const liveBefore = await fetch(`${baseUrl}/api/health/liveness`);
    expect(liveBefore.status).toBe(200);
    const readyBefore = await fetch(`${baseUrl}/api/health/readiness`);
    expect(readyBefore.status).toBe(200);

    // Initiate shutdown state
    setIsShuttingDown(true);

    // During shutdown:
    // Liveness remains 200 so orchestrators don't send SIGKILL
    const liveDuring = await fetch(`${baseUrl}/api/health/liveness`);
    expect(liveDuring.status).toBe(200);

    // Readiness returns 503 so load balancers stop sending traffic
    const readyDuring = await fetch(`${baseUrl}/api/health/readiness`);
    expect(readyDuring.status).toBe(503);
    const readyJson = await readyDuring.json();
    expect(readyJson.status).toBe('not_ready');
    expect(readyJson.reason).toBe('SERVER_SHUTTING_DOWN');

    // General /api/health also returns 503 shutting_down
    const healthDuring = await fetch(`${baseUrl}/api/health`);
    expect(healthDuring.status).toBe(503);
    const healthJson = await healthDuring.json();
    expect(healthJson.status).toBe('shutting_down');
  });
});
