import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { spawnSync } from 'child_process';
import app, {
  gracefulShutdown,
  registerProcessErrorHandlers,
  startServer,
  getIsShuttingDown,
  setIsShuttingDown,
  getActiveServer,
  setActiveServer,
  getShutdownExitCode,
  resetShutdownState,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_FATAL_SHUTDOWN_TIMEOUT_MS,
  startRateLimitCleanup,
  stopRateLimitCleanup,
  logger,
  sanitizeErrorMessage
} from '../server/index';
import { StructuredLogEvent } from '../server/logger';

describe('Phase 8.1 — Step 13: Fatal Process Error Handling & Request Isolation', () => {
  let server: http.Server | null = null;
  let baseUrl: string = '';
  let capturedLogs: StructuredLogEvent[] = [];
  let removeLogListener: () => void;

  const startTestServer = async (): Promise<{ server: http.Server; baseUrl: string; port: number }> => {
    return new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address() as any;
        const url = `http://127.0.0.1:${addr.port}`;
        resolve({ server: s, baseUrl: url, port: addr.port });
      });
    });
  };

  beforeAll(() => {
    removeLogListener = logger.addListener((event) => {
      capturedLogs.push(event);
    });
  });

  afterAll(() => {
    if (removeLogListener) {
      removeLogListener();
    }
  });

  beforeEach(() => {
    capturedLogs = [];
    vi.restoreAllMocks();
    resetShutdownState();
  });

  afterEach(async () => {
    resetShutdownState();
    stopRateLimitCleanup();
    if (server && server.listening) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    }
    server = null;
    baseUrl = '';
  });

  // =========================================================================
  // 1. Centralized Express Request Error Handling (Request-Scoped Safety)
  // =========================================================================
  describe('1. Centralized Express Request Error Middleware', () => {
    it('catches malformed JSON payloads, returns HTTP 400 with correlation ID, and does NOT crash or initiate shutdown', async () => {
      const started = await startTestServer();
      server = started.server;
      baseUrl = started.baseUrl;
      setActiveServer(server);

      const clientRequestId = 'client-req-malformed-json-test';
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': clientRequestId
        },
        body: '{"invalidJson": ... broken syntax ...'
      });

      expect(res.status).toBe(400);
      expect(res.headers.get('x-request-id')).toBe(clientRequestId);

      const body = await res.json();
      expect(body.code).toBe('BAD_REQUEST');
      expect(body.error).toBeDefined();

      // Verify structured log was emitted with correlation ID and statusCode 400
      const errorLog = capturedLogs.find((l) => l.level === 'error' && l.requestId === clientRequestId);
      expect(errorLog).toBeDefined();
      expect(errorLog?.statusCode).toBe(400);
      expect(errorLog?.errorCode).toBe('BAD_REQUEST');

      // Crucial: Server process must NOT enter shutdown state
      expect(getIsShuttingDown()).toBe(false);

      // Server continues serving subsequent traffic normally
      const healthRes = await fetch(`${baseUrl}/api/health/readiness`);
      expect(healthRes.status).toBe(200);
    });

    it('handles non-existent routes cleanly without process-level failure', async () => {
      const started = await startTestServer();
      server = started.server;
      baseUrl = started.baseUrl;
      setActiveServer(server);

      const res = await fetch(`${baseUrl}/api/nonexistent-endpoint-test-12345`);
      expect([404, 500]).toContain(res.status);
      expect(getIsShuttingDown()).toBe(false);
    });
  });

  // =========================================================================
  // 2. Fatal Process Error Handlers Lifecycle & Cleanup
  // =========================================================================
  describe('2. Process Error Handler Registration & Lifecycle', () => {
    it('returns an unregister function that cleans up process listeners', () => {
      const uncaughtCountBefore = process.listenerCount('uncaughtException');
      const rejectionCountBefore = process.listenerCount('unhandledRejection');

      const unregister = registerProcessErrorHandlers(null, { exitProcess: false });

      expect(process.listenerCount('uncaughtException')).toBe(uncaughtCountBefore + 1);
      expect(process.listenerCount('unhandledRejection')).toBe(rejectionCountBefore + 1);

      unregister();

      expect(process.listenerCount('uncaughtException')).toBe(uncaughtCountBefore);
      expect(process.listenerCount('unhandledRejection')).toBe(rejectionCountBefore);
    });

    it('automatically unregisters prior handler when re-registered to prevent listener leaks', () => {
      const uncaughtCountBefore = process.listenerCount('uncaughtException');

      const unregister1 = registerProcessErrorHandlers(null, { exitProcess: false });
      expect(process.listenerCount('uncaughtException')).toBe(uncaughtCountBefore + 1);

      const unregister2 = registerProcessErrorHandlers(null, { exitProcess: false });
      // Should not double count because previous was deregistered
      expect(process.listenerCount('uncaughtException')).toBe(uncaughtCountBefore + 1);

      unregister2();
      expect(process.listenerCount('uncaughtException')).toBe(uncaughtCountBefore);
    });
  });

  // =========================================================================
  // 3. Uncaught Exception Handling Semantics
  // =========================================================================
  describe('3. Uncaught Exception Handling', () => {
    it('emits structured fatal log, initiates emergency shutdown with exitCode 1, and marks server shutting down', async () => {
      const started = await startTestServer();
      server = started.server;
      baseUrl = started.baseUrl;

      let unregister: (() => void) | null = null;
      try {
        // Register without passing active server so server remains listening for HTTP assertion
        unregister = registerProcessErrorHandlers(null, { exitProcess: false, timeoutMs: 2000 });

        const rawSecretKey = 'AIzaSyFakeSecretKey123456789012345678';
        const testError = new Error(`Fatal database connection pool explosion in C:\\Users\\secret\\code.ts with key ${rawSecretKey}`);

        // Simulate uncaughtException
        process.emit('uncaughtException', testError);

        // Check structured fatal log
        const fatalLog = capturedLogs.find((l) => l.level === 'error' && (l as any).fatal === true);
        expect(fatalLog).toBeDefined();
        expect((fatalLog as any).errorType).toBe('uncaughtException');
        expect(fatalLog?.message).toContain('Fatal uncaughtException');

        // Assert sanitization: path and API key should be redacted
        expect((fatalLog as any).error).not.toContain('C:\\Users\\secret\\code.ts');
        expect((fatalLog as any).error).not.toContain(rawSecretKey);
        expect((fatalLog as any).error).toContain('[REDACTED_API_KEY]');

        // Shutdown state must be active with exit code 1
        expect(getIsShuttingDown()).toBe(true);
        expect(getShutdownExitCode()).toBe(1);

        // Readiness endpoint must now report 503
        const readyRes = await fetch(`${baseUrl}/api/health/readiness`);
        expect(readyRes.status).toBe(503);
        const readyBody = await readyRes.json();
        expect(readyBody.reason).toBe('SERVER_SHUTTING_DOWN');

        // Liveness probe continues returning 200 during drain
        const liveRes = await fetch(`${baseUrl}/api/health/liveness`);
        expect(liveRes.status).toBe(200);

        // New traffic is rejected with 503 and Connection: close
        const postRes = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'test' })
        });
        expect(postRes.status).toBe(503);
        expect(postRes.headers.get('connection')).toBe('close');
      } finally {
        if (unregister) {
          unregister();
        }
      }
    });

    it('closes active HTTP server when emergency shutdown is initiated with an active server', async () => {
      const started = await startTestServer();
      server = started.server;
      baseUrl = started.baseUrl;

      let unregister: (() => void) | null = null;
      try {
        unregister = registerProcessErrorHandlers(server, { exitProcess: false, timeoutMs: 2000 });

        process.emit('uncaughtException', new Error('Uncaught error closing server'));

        // Allow microtasks/event loop to run server.close
        await new Promise((r) => setTimeout(r, 50));

        expect(server.listening).toBe(false);
        expect(getIsShuttingDown()).toBe(true);
        expect(getShutdownExitCode()).toBe(1);
      } finally {
        if (unregister) {
          unregister();
        }
      }
    });
  });

  // =========================================================================
  // 4. Unhandled Rejection Handling Semantics
  // =========================================================================
  describe('4. Unhandled Rejection Handling', () => {
    it('emits structured fatal log, initiates emergency shutdown with exitCode 1', async () => {
      const started = await startTestServer();
      server = started.server;
      baseUrl = started.baseUrl;

      let unregister: (() => void) | null = null;
      try {
        unregister = registerProcessErrorHandlers(server, { exitProcess: false, timeoutMs: 2000 });

        const rejectionReason = new Error('Fatal unhandled rejection in background task /Users/secret/token.json');

        // Simulate unhandledRejection
        process.emit('unhandledRejection', rejectionReason, Promise.resolve());

        const fatalLog = capturedLogs.find((l) => l.level === 'error' && (l as any).fatal === true);
        expect(fatalLog).toBeDefined();
        expect((fatalLog as any).errorType).toBe('unhandledRejection');
        expect((fatalLog as any).error).not.toContain('/Users/secret/token.json');

        expect(getIsShuttingDown()).toBe(true);
        expect(getShutdownExitCode()).toBe(1);
      } finally {
        if (unregister) {
          unregister();
        }
      }
    });
  });

  // =========================================================================
  // 5. Fatal Shutdown Timeout & Idempotency Guard
  // =========================================================================
  describe('5. Fatal Shutdown Timeout & Idempotency Guard', () => {
    it('defaults to 5000ms timeout on fatal error vs 25000ms on normal shutdown', () => {
      expect(DEFAULT_FATAL_SHUTDOWN_TIMEOUT_MS).toBe(5000);
      expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(25000);
    });

    it('ignores subsequent fatal errors once first fatal shutdown has started (idempotent)', async () => {
      let unregister: (() => void) | null = null;
      try {
        unregister = registerProcessErrorHandlers(null, { exitProcess: false, timeoutMs: 1000 });

        process.emit('uncaughtException', new Error('First fatal crash'));
        process.emit('uncaughtException', new Error('Second fatal crash'));
        process.emit('unhandledRejection', new Error('Third fatal rejection'), Promise.resolve());

        const fatalLogs = capturedLogs.filter((l) => l.level === 'error' && (l as any).fatal === true);
        // Only one fatal shutdown should be initiated
        expect(fatalLogs.length).toBe(1);
        expect(getShutdownExitCode()).toBe(1);
      } finally {
        if (unregister) {
          unregister();
        }
      }
    });

    it('maintains non-zero exit code (1) if a normal signal arrives after fatal error', async () => {
      let unregister: (() => void) | null = null;
      try {
        unregister = registerProcessErrorHandlers(null, { exitProcess: false, timeoutMs: 1000 });

        // Fatal crash triggers shutdown with exit code 1
        process.emit('uncaughtException', new Error('Fatal crash'));
        expect(getShutdownExitCode()).toBe(1);

        // Subsequent SIGTERM arrives
        await gracefulShutdown({ signal: 'SIGTERM', exitProcess: false, exitCode: 0 });

        // Exit code must remain 1
        expect(getShutdownExitCode()).toBe(1);
      } finally {
        if (unregister) {
          unregister();
        }
      }
    });
  });

  // =========================================================================
  // 6. Server Startup Failure Interception
  // =========================================================================
  describe('6. Server Startup Failure Interception (EADDRINUSE)', () => {
    it('intercepts port binding conflicts with structured fatal log and promise rejection', async () => {
      const started = await startTestServer();
      server = started.server;
      baseUrl = started.baseUrl;
      const conflictPort = started.port;

      await expect(
        startServer({
          port: conflictPort,
          host: '127.0.0.1',
          exitOnFailure: false,
          registerHandlers: false
        })
      ).rejects.toThrow();

      const startupFatalLog = capturedLogs.find((l) => l.level === 'error' && (l as any).fatal === true && (l as any).port === conflictPort);
      expect(startupFatalLog).toBeDefined();
      expect((startupFatalLog as any).code).toBe('EADDRINUSE');
    });
  });

  // =========================================================================
  // 7. Isolated Child Process Real Process Exit (Exit Code 1)
  // =========================================================================
  describe('7. Isolated Child Process Real Exit Code Verification', () => {
    it('exits with code 1 and outputs structured fatal JSON on uncaughtException', () => {
      const script = `
        import { registerProcessErrorHandlers, logger } from './server/index.ts';
        logger.setForceOutput(true);
        registerProcessErrorHandlers(null, { exitProcess: true, timeoutMs: 100 });
        setTimeout(() => {
          throw new Error('ChildProcessFatalUncaught');
        }, 20);
      `;

      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx/esm', '-e', script],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 25000
        }
      );

      expect(result.status).toBe(1);
      const combinedOutput = (result.stdout || '') + (result.stderr || '');
      expect(combinedOutput).toContain('Fatal uncaughtException');
      expect(combinedOutput).toContain('ChildProcessFatalUncaught');
      expect(combinedOutput).toContain('"fatal":true');
    }, 30000);

    it('exits with code 1 and outputs structured fatal JSON on unhandledRejection', () => {
      const script = `
        import { registerProcessErrorHandlers, logger } from './server/index.ts';
        logger.setForceOutput(true);
        registerProcessErrorHandlers(null, { exitProcess: true, timeoutMs: 100 });
        setTimeout(() => {
          Promise.reject(new Error('ChildProcessFatalRejection'));
        }, 20);
      `;

      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx/esm', '-e', script],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 25000
        }
      );

      expect(result.status).toBe(1);
      const combinedOutput = (result.stdout || '') + (result.stderr || '');
      expect(combinedOutput).toContain('Fatal unhandledRejection');
      expect(combinedOutput).toContain('ChildProcessFatalRejection');
      expect(combinedOutput).toContain('"fatal":true');
    }, 30000);
  });
});
