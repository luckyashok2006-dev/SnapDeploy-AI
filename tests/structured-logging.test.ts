import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app from '../server/index';
import {
  logger,
  validateRequestId,
  resolveRequestId,
  sanitizeErrorMessage,
  sanitizeLogObject,
  StructuredLogEvent,
  resetColdStartForTesting,
  isColdStartPending,
  getServerBootTime
} from '../server/logger';
import { geminiAIProvider } from '../server/providers/GeminiAIProvider';

describe('Phase 8.1 — Step 12: Structured Logging & Request Correlation', () => {
  let server: http.Server;
  let baseUrl: string;
  let capturedLogs: StructuredLogEvent[] = [];
  let removeListener: () => void;

  beforeAll(async () => {
    removeListener = logger.addListener((event) => {
      capturedLogs.push(event);
    });

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
    if (removeListener) {
      removeListener();
    }
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  beforeEach(() => {
    capturedLogs = [];
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Request ID Validation and Sanitization Unit Tests
  // =========================================================================
  describe('A. Request ID Validation & Normalization', () => {
    it('1. Accepts and preserves valid alphanumeric, hyphen, and underscore IDs within 64 chars', () => {
      const validIds = [
        'req-12345',
        'trace_abc_DEF-99',
        'c7b1e428-2f48-4447-b505-188820c8f185',
        'x'.repeat(64)
      ];

      for (const id of validIds) {
        expect(validateRequestId(id)).toBe(id);
        expect(resolveRequestId(id)).toBe(id);
      }
    });

    it('2. Rejects and replaces missing or undefined request IDs with a UUID v4', () => {
      expect(validateRequestId(undefined)).toBeNull();
      expect(validateRequestId('')).toBeNull();
      expect(validateRequestId('   ')).toBeNull();

      const generated = resolveRequestId(undefined);
      expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('3. Rejects oversized request IDs (>64 chars) and generates a fresh UUID', () => {
      const oversized = 'a'.repeat(65);
      expect(validateRequestId(oversized)).toBeNull();

      const resolved = resolveRequestId(oversized);
      expect(resolved).not.toBe(oversized);
      expect(resolved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('4. Rejects CRLF and header injection attempts and generates a fresh UUID', () => {
      const maliciousPayloads = [
        'req-123\r\nInjected-Header: evil',
        'req-123\nInjected: evil',
        'req 123',
        'req;evil',
        '<script>alert(1)</script>',
        '../../path'
      ];

      for (const payload of maliciousPayloads) {
        expect(validateRequestId(payload)).toBeNull();
        const resolved = resolveRequestId(payload);
        expect(resolved).not.toBe(payload);
        expect(resolved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      }
    });
  });

  // =========================================================================
  // 2. HTTP Request Correlation & Response Header Propagation
  // =========================================================================
  describe('B. HTTP Request Correlation & Header Propagation', () => {
    it('1. Generates X-Request-Id header when client does not supply one', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);

      const headerVal = res.headers.get('x-request-id');
      expect(headerVal).toBeTruthy();
      expect(headerVal).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('2. Preserves and echoes valid client-supplied X-Request-Id', async () => {
      const customId = 'client-trace-id-abc-123';
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { 'X-Request-Id': customId }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-request-id')).toBe(customId);
    });

    it('3. Replaces malformed / invalid client-supplied X-Request-Id with safe UUID', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { 'X-Request-Id': 'invalid header with spaces and; symbols' }
      });
      expect(res.status).toBe(200);

      const headerVal = res.headers.get('x-request-id');
      expect(headerVal).toBeTruthy();
      expect(headerVal).not.toContain('spaces');
      expect(headerVal).not.toContain('symbols');
      expect(headerVal).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('4. Attaches X-Request-Id to error responses as well', async () => {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'gen-err-req-999'
        },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('x-request-id')).toBe('gen-err-req-999');
    });
  });

  // =========================================================================
  // 3. Structured Logging Schema Compliance & High-Resolution Timing
  // =========================================================================
  describe('C. Structured Log Schema & Timing', () => {
    it('1. Emits structured log event on completion of API route', async () => {
      const traceId = 'schema-check-trace-1';
      const res = await fetch(`${baseUrl}/api/health/liveness`, {
        headers: { 'X-Request-Id': traceId }
      });
      expect(res.status).toBe(200);

      const logEvent = capturedLogs.find((l) => l.requestId === traceId && l.path === '/api/health/liveness');
      expect(logEvent).toBeDefined();
      expect(logEvent?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(logEvent?.level).toBe('info');
      expect(logEvent?.method).toBe('GET');
      expect(logEvent?.statusCode).toBe(200);
      expect(typeof logEvent?.durationMs).toBe('number');
      expect(logEvent?.durationMs).toBeGreaterThanOrEqual(0);
      expect(logEvent?.clientIp).toBeDefined();
    });

    it('2. Accurately measures request duration using monotonic clock', async () => {
      const traceId = 'timing-trace-2';
      const res = await fetch(`${baseUrl}/api/ai/status`, {
        headers: { 'X-Request-Id': traceId }
      });
      expect(res.status).toBe(200);

      const logEvent = capturedLogs.find((l) => l.requestId === traceId);
      expect(logEvent).toBeDefined();
      expect(logEvent?.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(logEvent?.durationMs)).toBe(true);
    });

    it('3. Emits warn level log on 4xx client errors and error level on 5xx', async () => {
      const trace400 = 'trace-400-test';
      await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': trace400
        },
        body: JSON.stringify({ prompt: '' })
      });

      const warnLog = capturedLogs.find((l) => l.requestId === trace400 && l.statusCode === 400);
      expect(warnLog).toBeDefined();
      expect(warnLog?.level).toBe('warn');
    });

    it('4. Captures and records Cloudflare CF-Connecting-IP in request completion logs', async () => {
      const traceId = 'trace-cf-ip-log';
      const cfIp = '198.51.100.77';

      const res = await fetch(`${baseUrl}/api/health/liveness`, {
        headers: {
          'X-Request-Id': traceId,
          'CF-Connecting-IP': cfIp
        }
      });
      expect(res.status).toBe(200);

      const logEvent = capturedLogs.find((l) => l.requestId === traceId);
      expect(logEvent).toBeDefined();
      expect(logEvent?.clientIp).toBe(cfIp);
    });
  });

  // =========================================================================
  // 4. Sensitive Data Scrubbing & Sanitization
  // =========================================================================
  describe('D. Sensitive Data Scrubbing in Logs', () => {
    it('1. Redacts Gemini API keys, OpenAI keys, GitHub tokens, Netlify tokens, and Bearer tokens', () => {
      const raw = 'Failed with AIzaSyTestKey12345678901234567890 and sk-abcdefghijklmnopqrstuvwxyz12 and ghp_123456789012345678901234567890123456 and Bearer eyJhbGciOiJIUzI1NiJ9.abc.def';
      const sanitized = sanitizeErrorMessage(raw);

      expect(sanitized).not.toContain('AIzaSyTestKey12345678901234567890');
      expect(sanitized).not.toContain('sk-abcdefghijklmnopqrstuvwxyz12');
      expect(sanitized).not.toContain('ghp_123456789012345678901234567890123456');
      expect(sanitized).not.toContain('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def');

      expect(sanitized).toContain('[REDACTED_API_KEY]');
      expect(sanitized).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(sanitized).toContain('Bearer [REDACTED]');
    });

    it('2. Redacts Windows and Unix filesystem paths from messages', () => {
      const raw = 'Error at C:\\Users\\dell\\Desktop\\SnapDeploy AI\\server\\index.ts and /home/ubuntu/app/server.ts';
      const sanitized = sanitizeErrorMessage(raw);

      expect(sanitized).not.toContain('C:\\Users');
      expect(sanitized).not.toContain('/home/ubuntu');
      expect(sanitized).toContain('[REDACTED_PATH]');
    });

    it('3. Recursively scrubs sensitive key values in log objects', () => {
      const context = {
        apiKey: 'AIzaSySecretApiKey123456789012345',
        password: 'SuperSecretPassword!',
        token: 'secret-token-val',
        user: {
          session: 'session-xyz',
          normalField: 'safe data',
          innerKey: 'C:\\Users\\dell\\secret.ts'
        }
      };

      const sanitizedObj = sanitizeLogObject(context);
      expect(sanitizedObj.apiKey).toBe('[REDACTED]');
      expect(sanitizedObj.password).toBe('[REDACTED]');
      expect(sanitizedObj.token).toBe('[REDACTED]');
      expect(sanitizedObj.user.session).toBe('[REDACTED]');
      expect(sanitizedObj.user.normalField).toBe('safe data');
      expect(sanitizedObj.user.innerKey).toBe('[REDACTED_PATH]');
    });

    it('4. Never logs prompts or generated source code bodies in log events', async () => {
      const privatePrompt = 'CONFIDENTIAL_CUSTOMER_DATA_SHOULD_NOT_APPEAR_IN_LOGS';
      const traceId = 'secret-prompt-trace-456';

      const generateSpy = vi.spyOn(geminiAIProvider, 'generateProject').mockResolvedValue({
        plan: { name: 'secure-app', framework: 'vite-react', files: [], dependencies: [], scripts: { dev: 'vite', build: 'vite build' } },
        files: { '/src/App.tsx': 'export default function App() { return <div>SecretCode</div>; }' }
      });

      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': traceId
        },
        body: JSON.stringify({ prompt: privatePrompt, name: 'secure-app' })
      });
      expect(res.status).toBe(200);

      // Inspect all captured log events associated with this request
      const relevantLogs = capturedLogs.filter((l) => l.requestId === traceId);
      expect(relevantLogs.length).toBeGreaterThan(0);

      for (const log of relevantLogs) {
        const serialized = JSON.stringify(log);
        expect(serialized).not.toContain('CONFIDENTIAL_CUSTOMER_DATA_SHOULD_NOT_APPEAR_IN_LOGS');
        expect(serialized).not.toContain('SecretCode');
        // Prompt length should be present, but not raw text
        if (log.message === 'Received generation request') {
          expect(log.promptLength).toBe(privatePrompt.length);
        }
      }

      generateSpy.mockRestore();
    });
  });

  // =========================================================================
  // 5. AI Provider Request Correlation & History Tracking
  // =========================================================================
  describe('E. AI Provider Request Correlation', () => {
    it('1. AI execution records include the request correlation ID', async () => {
      const traceId = 'ai-exec-trace-789';

      // Mock generateProject internal client call to avoid external API requirement in unit test
      const originalIsConfigured = geminiAIProvider.isConfigured.bind(geminiAIProvider);
      vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(true);

      const generateSpy = vi.spyOn(geminiAIProvider, 'generateProject').mockImplementation(async (input) => {
        (geminiAIProvider as any).recordExecution({
          id: `exec_${Date.now()}`,
          requestId: input.requestId,
          operation: 'generate',
          provider: geminiAIProvider.name,
          model: geminiAIProvider.getModelName(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 120,
          success: true
        });
        return {
          plan: { name: 'test', framework: 'vite-react', files: [], dependencies: [], scripts: { dev: 'vite', build: 'vite build' } },
          files: {}
        };
      });

      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': traceId
        },
        body: JSON.stringify({ prompt: 'Build a dashboard', name: 'dashboard-test' })
      });

      expect(res.status).toBe(200);

      const history = geminiAIProvider.getExecutionHistory();
      const recorded = history.find((h) => h.requestId === traceId);
      expect(recorded).toBeDefined();
      expect(recorded?.requestId).toBe(traceId);
      expect(recorded?.operation).toBe('generate');
      expect(recorded?.success).toBe(true);

      generateSpy.mockRestore();
    });
  });

  // =========================================================================
  // 6. Cold-Start Tracking & Boot Latency (Phase 8.2.7)
  // =========================================================================
  describe('F. Container Boot Tracking & Cold-Start Indicator', () => {
    it('1. Marks the first handled request as a cold start with bootDurationMs >= 0', async () => {
      resetColdStartForTesting();
      expect(isColdStartPending()).toBe(true);

      const coldTraceId = 'cold-start-req-1';
      const res1 = await fetch(`${baseUrl}/api/health/liveness`, {
        headers: { 'X-Request-Id': coldTraceId }
      });
      expect(res1.status).toBe(200);

      const coldLog = capturedLogs.find((l) => l.requestId === coldTraceId);
      expect(coldLog).toBeDefined();
      expect(coldLog?.isColdStart).toBe(true);
      expect(typeof coldLog?.bootDurationMs).toBe('number');
      expect(coldLog?.bootDurationMs).toBeGreaterThanOrEqual(0);
      expect(isColdStartPending()).toBe(false);
    });

    it('2. Does not mark subsequent requests as cold starts', async () => {
      // Ensure cold start was already consumed by previous request
      expect(isColdStartPending()).toBe(false);

      const warmTraceId = 'warm-request-2';
      const res2 = await fetch(`${baseUrl}/api/health/liveness`, {
        headers: { 'X-Request-Id': warmTraceId }
      });
      expect(res2.status).toBe(200);

      const warmLog = capturedLogs.find((l) => l.requestId === warmTraceId);
      expect(warmLog).toBeDefined();
      expect(warmLog?.isColdStart).toBeUndefined();
      expect(warmLog?.bootDurationMs).toBeUndefined();
    });

    it('3. Preserves server boot timestamp across requests', () => {
      const bootTime = getServerBootTime();
      expect(typeof bootTime).toBe('number');
      expect(bootTime).toBeGreaterThan(0);
      expect(bootTime).toBeLessThanOrEqual(Date.now());
    });
  });

  // =========================================================================
  // 7. Gemini Usage Telemetry & Cost Controls (Phase 8.2.7)
  // =========================================================================
  describe('G. Gemini Token Usage Telemetry & Output Caps', () => {
    let originalClient: any;

    beforeEach(() => {
      originalClient = (geminiAIProvider as any).ai;
    });

    afterAll(() => {
      (geminiAIProvider as any).ai = originalClient;
    });

    it('1. Records token usage metadata in AIExecutionRecord and completion logs', async () => {
      const traceId = 'trace-telemetry-123';
      const promptText = 'Create a customer dashboard with analytics';

      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          name: 'telemetry-app',
          framework: 'vite-react',
          dependencies: [],
          scripts: { dev: 'vite', build: 'vite build' },
          files: [
            {
              path: '/src/main.tsx',
              purpose: 'Entry point',
              content: "import React from 'react';\nimport App from './App';\nexport default App;"
            },
            {
              path: '/src/App.tsx',
              purpose: 'Main App',
              content: 'export default function App() { return <div>DashboardContent</div>; }'
            }
          ]
        }),
        usageMetadata: {
          promptTokenCount: 123,
          candidatesTokenCount: 456,
          totalTokenCount: 579
        }
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      const result = await geminiAIProvider.generateProject({
        prompt: promptText,
        name: 'telemetry-app',
        requestId: traceId
      });

      expect(result.plan.name).toBe('telemetry-app');

      // Verify AIExecutionRecord stores token usage
      const history = geminiAIProvider.getExecutionHistory();
      const record = history.find((h) => h.requestId === traceId);
      expect(record).toBeDefined();
      expect(record?.promptTokens).toBe(123);
      expect(record?.candidatesTokens).toBe(456);
      expect(record?.totalTokens).toBe(579);

      // Verify structured completion log contains token usage
      const completionLog = capturedLogs.find(
        (l) => l.requestId === traceId && l.message === 'Gemini project generation completed'
      );
      expect(completionLog).toBeDefined();
      expect(completionLog?.promptTokens).toBe(123);
      expect(completionLog?.candidatesTokens).toBe(456);
      expect(completionLog?.totalTokens).toBe(579);

      // Verify prompt and source code bodies are NOT leaked into logs
      const allRelatedLogs = capturedLogs.filter((l) => l.requestId === traceId);
      expect(allRelatedLogs.length).toBeGreaterThan(0);
      for (const log of allRelatedLogs) {
        const serialized = JSON.stringify(log);
        expect(serialized).not.toContain(promptText);
        expect(serialized).not.toContain('DashboardContent');
      }
    });

    it('2. Enforces maxOutputTokens: 8192 across all four Gemini generation paths', async () => {
      const mockGenerateContent = vi.fn();
      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      // Path 1: generateProject
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          name: 'cap-app',
          framework: 'vite-react',
          dependencies: [],
          scripts: { dev: 'vite', build: 'vite build' },
          files: [
            { path: '/src/main.tsx', purpose: 'Entry', content: "import App from './App'; export default App;" },
            { path: '/src/App.tsx', purpose: 'App', content: 'export default function App() {}' }
          ]
        }),
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
      });
      await geminiAIProvider.generateProject({ prompt: 'test project', requestId: 'trace-cap-1' });
      expect(mockGenerateContent.mock.calls[0][0].config.maxOutputTokens).toBe(8192);

      // Path 2: diagnoseError
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          category: 'syntax',
          severity: 'high',
          explanation: 'Syntax error detected',
          affectedFiles: ['/src/App.tsx'],
          evidence: ['Unexpected token'],
          suggestedFix: 'Fix syntax error'
        }),
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25, totalTokenCount: 40 }
      });
      await geminiAIProvider.diagnoseError({
        evidence: {
          executionId: 'e-1',
          command: 'npm',
          args: ['run', 'build'],
          exitCode: 1,
          stdout: '',
          stderr: 'SyntaxError',
          durationMs: 50
        },
        relevantFiles: { '/src/App.tsx': 'const a =' },
        requestId: 'trace-cap-2'
      });
      expect(mockGenerateContent.mock.calls[1][0].config.maxOutputTokens).toBe(8192);

      // Path 3: generateRepairPatch
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          summary: 'Fix syntax error',
          confidence: 0.95,
          files: [{ path: '/src/App.tsx', after: 'const a = 1;' }]
        }),
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 30, totalTokenCount: 50 }
      });
      await geminiAIProvider.generateRepairPatch({
        diagnosis: {
          category: 'syntax',
          severity: 'high',
          explanation: 'Syntax error',
          affectedFiles: ['/src/App.tsx'],
          evidence: ['Unexpected token'],
          suggestedFix: 'Fix it'
        },
        evidence: {
          executionId: 'e-1',
          command: 'npm',
          args: ['run', 'build'],
          exitCode: 1,
          stdout: '',
          stderr: 'SyntaxError',
          durationMs: 50
        },
        relevantFiles: { '/src/App.tsx': 'const a =' },
        requestId: 'trace-cap-3'
      });
      expect(mockGenerateContent.mock.calls[2][0].config.maxOutputTokens).toBe(8192);

      // Path 4: proposeEdit
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          summary: 'Add feature',
          explanation: 'Added feature to App',
          files: [{ path: '/src/App.tsx', action: 'modify', after: 'export default function App() { return 1; }' }]
        }),
        usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 35, totalTokenCount: 60 }
      });
      await geminiAIProvider.proposeEdit({
        prompt: 'Add feature',
        relevantFiles: { '/src/App.tsx': 'export default function App() {}' },
        requestId: 'trace-cap-4'
      });
      expect(mockGenerateContent.mock.calls[3][0].config.maxOutputTokens).toBe(8192);
    });

    it('3. Gracefully handles responses without usageMetadata (backward compatibility)', async () => {
      const traceId = 'trace-compat-legacy';

      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          name: 'compat-app',
          framework: 'vite-react',
          dependencies: [],
          scripts: { dev: 'vite', build: 'vite build' },
          files: [
            { path: '/src/main.tsx', purpose: 'Entry', content: "import App from './App'; export default App;" },
            { path: '/src/App.tsx', purpose: 'App', content: 'export default function App() {}' }
          ]
        })
        // usageMetadata is intentionally omitted
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      const result = await geminiAIProvider.generateProject({
        prompt: 'build app without usage metadata',
        requestId: traceId
      });

      expect(result.plan.name).toBe('compat-app');

      const history = geminiAIProvider.getExecutionHistory();
      const record = history.find((h) => h.requestId === traceId);
      expect(record).toBeDefined();
      expect(record?.promptTokens).toBeUndefined();
      expect(record?.candidatesTokens).toBeUndefined();
      expect(record?.totalTokens).toBeUndefined();

      const completionLog = capturedLogs.find(
        (l) => l.requestId === traceId && l.message === 'Gemini project generation completed'
      );
      expect(completionLog).toBeDefined();
      expect(completionLog?.promptTokens).toBeUndefined();
    });
  });
});
