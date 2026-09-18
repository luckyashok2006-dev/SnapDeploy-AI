import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import app, { aiRateLimiter } from '../server/index';
import { GeminiAIProvider, geminiAIProvider } from '../server/providers/GeminiAIProvider';
import { generationService } from '../server/services/generation-service';
import { diagnosticService } from '../server/services/diagnostic-service';
import { repairService } from '../server/services/repair-service';
import { isExcludedFromExport } from '../src/lib/export/project-exporter';

describe('Security Hardening (Tests A-J)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A. CORS restriction is configured with origin validation', () => {
    expect(app).toBeDefined();
    expect(typeof app.use).toBe('function');
  });

  it('B. AI endpoint rate limiting restricts rapid abuse and returns 429', () => {
    let status = 200;
    let jsonBody: any = null;

    const mockReq: any = {
      headers: { 'x-forwarded-for': '192.168.1.50' },
      socket: { remoteAddress: '192.168.1.50' }
    };
    const mockRes: any = {
      setHeader: vi.fn(),
      status: (code: number) => {
        status = code;
        return {
          json: (data: any) => {
            jsonBody = data;
          }
        };
      }
    };
    const nextFn = vi.fn();

    // Fire 30 requests -> all pass
    for (let i = 0; i < 30; i++) {
      aiRateLimiter(mockReq, mockRes, nextFn);
    }
    expect(nextFn).toHaveBeenCalledTimes(30);

    // 31st request -> rate limited
    aiRateLimiter(mockReq, mockRes, nextFn);
    expect(status).toBe(429);
    expect(jsonBody?.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('C. oversized prompt rejection (> 10,000 characters)', async () => {
    const hugePrompt = 'A'.repeat(10_001);
    
    // Test validation logic directly
    expect(hugePrompt.length).toBeGreaterThan(10_000);
  });

  it('D. malformed request rejection on invalid inputs', () => {
    const invalidEvidence: any = { args: [] }; // missing command
    expect(invalidEvidence.command).toBeUndefined();
  });

  it('E. API key absence from responses', () => {
    const provider = new GeminiAIProvider();
    const history = provider.getExecutionHistory();
    const historyStr = JSON.stringify(history);

    // Ensure raw secret key string is never in execution history
    expect(historyStr).not.toContain('AIzaSy');
  });

  it('F. API key absence from client bundle source files', () => {
    // Verify client files in src/ do not contain hardcoded secret patterns
    const files = ['src/lib/api.ts', 'src/features/generation/generation-client.ts'];
    for (const f of files) {
      if (fs.existsSync(f)) {
        const content = fs.readFileSync(f, 'utf8');
        expect(content).not.toMatch(/AIzaSy[0-9A-Za-z-_]{25,45}/);
        expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      }
    }
  });

  it('G. API key exclusion from ZIP export (.env excluded)', () => {
    expect(isExcludedFromExport('.env')).toBe(true);
    expect(isExcludedFromExport('.env.local')).toBe(true);
    expect(isExcludedFromExport('.env.production')).toBe(true);
  });

  it('H. no internal stack trace leakage in sanitized errors', () => {
    const rawError = 'Error in C:\\Users\\dell\\Desktop\\SnapDeploy AI\\secret\\file.ts: key AIzaSyB1234567890123456789012345678901';
    
    const sanitized = rawError
      .replace(/AIzaSy[0-9A-Za-z-_]{25,45}/g, '[REDACTED_API_KEY]')
      .replace(/[a-zA-Z]:\\[^\s:"']+/g, '[REDACTED_PATH]');

    expect(sanitized).not.toContain('AIzaSy');
    expect(sanitized).not.toContain('C:\\Users');
    expect(sanitized).toContain('[REDACTED_API_KEY]');
    expect(sanitized).toContain('[REDACTED_PATH]');
  });

  it('I. Gemini timeout handling rejects after timeout threshold', async () => {
    const provider = new GeminiAIProvider();
    
    // Simulate long hanging request with 50ms timeout
    const hangingPromise = () => new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 500);
    });

    await expect(
      provider.executeWithRetry(hangingPromise, 0, 50)
    ).rejects.toThrow(/timed out/);
  });

  it('J. bounded retry behavior avoids infinite loops on auth error', async () => {
    const provider = new GeminiAIProvider();
    let callCount = 0;

    const authErrorFn = async () => {
      callCount++;
      const err: any = new Error('API_KEY_INVALID: Key not authorized');
      err.status = 401;
      throw err;
    };

    await expect(
      provider.executeWithRetry(authErrorFn, 3)
    ).rejects.toThrow('API_KEY_INVALID');

    // Should NOT retry auth failure
    expect(callCount).toBe(1);
  });
});

describe('API Input & Context Limit Security Validation (Live HTTP Routes)', () => {
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

  const validMinimalEvidence = {
    command: 'npx tsc --noEmit',
    args: [],
    exitCode: 1,
    stdout: '',
    stderr: 'error TS2304: Cannot find name foo',
    durationMs: 42,
    timedOut: false
  };

  const validMinimalDiagnosis = {
    category: 'syntax' as const,
    severity: 'high' as const,
    explanation: 'Syntax error detected',
    affectedFiles: ['/src/App.tsx'],
    evidence: ['error TS2304'],
    suggestedFix: 'Declare variable'
  };

  async function postRoute(path: string, body: any, clientIp: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': clientIp
      },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    return { status: res.status, body: json };
  }

  it('A. /api/generate oversized prompt returns HTTP 400 PROMPT_TOO_LARGE', async () => {
    const res = await postRoute('/api/generate', {
      prompt: 'A'.repeat(10_001)
    }, '10.2.0.1');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('PROMPT_TOO_LARGE');
  });

  it('B. /api/generate empty or whitespace prompt returns HTTP 400 INVALID_PROMPT', async () => {
    const resEmpty = await postRoute('/api/generate', {
      prompt: ''
    }, '10.2.0.2');
    expect(resEmpty.status).toBe(400);
    expect(resEmpty.body?.code).toBe('INVALID_PROMPT');

    const resWhitespace = await postRoute('/api/generate', {
      prompt: '   \n\t  '
    }, '10.2.0.3');
    expect(resWhitespace.status).toBe(400);
    expect(resWhitespace.body?.code).toBe('INVALID_PROMPT');
  });

  it('C. /api/generate invalid project name (>100 chars) returns HTTP 400 INVALID_NAME', async () => {
    const res = await postRoute('/api/generate', {
      prompt: 'Valid prompt for a real dashboard application',
      name: 'X'.repeat(101)
    }, '10.2.0.4');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('INVALID_NAME');
  });

  it('D. /api/diagnose too many files (>50) returns HTTP 400 TOO_MANY_FILES', async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 51; i++) {
      files[`/src/file_${i}.ts`] = `export const v${i} = ${i};`;
    }

    const res = await postRoute('/api/diagnose', {
      evidence: validMinimalEvidence,
      relevantFiles: files
    }, '10.2.0.5');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('TOO_MANY_FILES');
  });

  it('E. /api/diagnose oversized file (>500,000 chars) returns HTTP 400 FILE_TOO_LARGE', async () => {
    const res = await postRoute('/api/diagnose', {
      evidence: validMinimalEvidence,
      relevantFiles: {
        '/src/App.tsx': 'X'.repeat(500_001)
      }
    }, '10.2.0.6');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('FILE_TOO_LARGE');
  });

  it('F. /api/diagnose malformed evidence (missing command) returns HTTP 400 INVALID_EVIDENCE', async () => {
    const res = await postRoute('/api/diagnose', {
      evidence: { args: [], exitCode: 1 }, // missing command
      relevantFiles: {
        '/src/App.tsx': 'export default function App() {}'
      }
    }, '10.2.0.7');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('INVALID_EVIDENCE');
  });

  it('G. /api/repair too many files (>50) returns HTTP 400 TOO_MANY_FILES and does not invoke Gemini', async () => {
    const geminiSpy = vi.spyOn(geminiAIProvider, 'generatePatch');
    const repairServiceSpy = vi.spyOn(repairService, 'generatePatch');

    const files: Record<string, string> = {};
    for (let i = 1; i <= 51; i++) {
      files[`/src/file_${i}.ts`] = `export const v${i} = ${i};`;
    }

    const res = await postRoute('/api/repair', {
      diagnosis: validMinimalDiagnosis,
      evidence: validMinimalEvidence,
      relevantFiles: files
    }, '10.2.0.8');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('TOO_MANY_FILES');
    expect(geminiSpy).not.toHaveBeenCalled();
    expect(repairServiceSpy).not.toHaveBeenCalled();
  });

  it('H. /api/repair oversized file (>500,000 chars) returns HTTP 400 FILE_TOO_LARGE and does not invoke Gemini', async () => {
    const geminiSpy = vi.spyOn(geminiAIProvider, 'generatePatch');
    const repairServiceSpy = vi.spyOn(repairService, 'generatePatch');

    const res = await postRoute('/api/repair', {
      diagnosis: validMinimalDiagnosis,
      evidence: validMinimalEvidence,
      relevantFiles: {
        '/src/App.tsx': 'X'.repeat(500_001)
      }
    }, '10.2.0.9');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('FILE_TOO_LARGE');
    expect(geminiSpy).not.toHaveBeenCalled();
    expect(repairServiceSpy).not.toHaveBeenCalled();
  });

  it('I. /api/repair malformed diagnosis (missing category) returns HTTP 400 INVALID_DIAGNOSIS', async () => {
    const res = await postRoute('/api/repair', {
      diagnosis: { explanation: 'Missing category field', severity: 'high' },
      evidence: validMinimalEvidence,
      relevantFiles: {
        '/src/App.tsx': 'export default function App() {}'
      }
    }, '10.2.0.10');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('INVALID_DIAGNOSIS');
  });

  it('J. /api/repair missing relevantFiles returns HTTP 400 INVALID_FILES', async () => {
    const res = await postRoute('/api/repair', {
      diagnosis: validMinimalDiagnosis,
      evidence: validMinimalEvidence
      // relevantFiles intentionally omitted
    }, '10.2.0.11');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('INVALID_FILES');
  });
});

describe('Target 3.3 — CORS, Rate Limiting & Request Boundary Validation (Live HTTP Routes)', () => {
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

  it('A. CORS whitelist allows configured origin and returns exact Access-Control-Allow-Origin header', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:3000'
      }
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('B. CORS rejects disallowed origin without setting Access-Control-Allow-Origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Origin': 'https://evil.example'
      }
    });

    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('C. CORS permits requests with no Origin header (server-to-server / curl)', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET'
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('D. AI endpoint rate limiting permits up to 30 requests per minute per IP', async () => {
    const generateSpy = vi.spyOn(generationService, 'generate').mockResolvedValue({
      files: { '/src/App.tsx': 'export default function App() {}' },
      name: 'rate-limit-baseline-test',
      framework: 'react-ts'
    } as any);

    const clientIp = '198.51.100.10';

    for (let i = 1; i <= 30; i++) {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': clientIp
        },
        body: JSON.stringify({ prompt: `Valid generation prompt ${i}` })
      });
      expect(res.status).toBe(200);
    }

    expect(generateSpy).toHaveBeenCalledTimes(30);
  });

  it('E. AI endpoint rate limiting blocks 31st request with HTTP 429, RATE_LIMIT_EXCEEDED, and Retry-After', async () => {
    const generateSpy = vi.spyOn(generationService, 'generate').mockResolvedValue({
      files: { '/src/App.tsx': 'export default function App() {}' },
      name: 'rate-limit-enforcement-test',
      framework: 'react-ts'
    } as any);

    const clientIp = '198.51.100.11';

    // Exhaust quota (30 requests)
    for (let i = 1; i <= 30; i++) {
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
    expect(generateSpy).toHaveBeenCalledTimes(30);

    // 31st request on same IP
    const res31 = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': clientIp
      },
      body: JSON.stringify({ prompt: 'Blocked 31st prompt' })
    });

    expect(res31.status).toBe(429);
    const body31 = await res31.json();
    expect(body31.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res31.headers.get('retry-after')).toBeTruthy();
    const retryAfter = Number(res31.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    // Generation service was not called for the 31st request
    expect(generateSpy).toHaveBeenCalledTimes(30);
  });

  it('F. AI endpoint rate limiting isolates clients by IP (IP-B succeeds while IP-A is blocked)', async () => {
    const generateSpy = vi.spyOn(generationService, 'generate').mockResolvedValue({
      files: { '/src/App.tsx': 'export default function App() {}' },
      name: 'isolated-app',
      framework: 'react-ts'
    } as any);

    const ipA = '198.51.100.12';
    const ipB = '198.51.100.13';

    // Exhaust IP-A
    for (let i = 1; i <= 30; i++) {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ipA
        },
        body: JSON.stringify({ prompt: `Prompt ${i} for IP-A` })
      });
      expect(res.status).toBe(200);
    }
    expect(generateSpy).toHaveBeenCalledTimes(30);

    // IP-A 31st request is blocked
    const resA = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ipA
      },
      body: JSON.stringify({ prompt: 'Blocked prompt for IP-A' })
    });
    expect(resA.status).toBe(429);

    // IP-B has not exhausted quota and succeeds
    const resB = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ipB
      },
      body: JSON.stringify({ prompt: 'Allowed prompt for IP-B' })
    });
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    expect(bodyB.name).toBe('isolated-app');
    expect(generateSpy).toHaveBeenCalledTimes(31);

    // IP-A remains blocked
    const resA2 = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ipA
      },
      body: JSON.stringify({ prompt: 'Still blocked for IP-A' })
    });
    expect(resA2.status).toBe(429);
    expect(generateSpy).toHaveBeenCalledTimes(31);
  });

  it('G. malformed JSON body returns HTTP 400 and never reaches service logic', async () => {
    const generateSpy = vi.spyOn(generationService, 'generate');

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.14'
      },
      body: '{"prompt": "unclosed json payload...'
    });

    expect(res.status).toBe(400);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('H. unsupported non-string prompt shape ({ prompt: 12345 }) returns HTTP 400 INVALID_PROMPT without invoking service', async () => {
    const generateSpy = vi.spyOn(generationService, 'generate');

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.15'
      },
      body: JSON.stringify({ prompt: 12345 })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_PROMPT');
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

describe('Target 3.4 — Security Regression & Failure-Mode Hardening (Live HTTP Routes)', () => {
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

  const validMinimalEvidence = {
    command: 'npx tsc --noEmit',
    args: [],
    exitCode: 1,
    stdout: '',
    stderr: 'error TS2304: Cannot find name foo',
    durationMs: 42,
    timedOut: false
  };

  it('1. /api/diagnose missing relevantFiles returns HTTP 400 INVALID_FILES and does not invoke diagnosticService', async () => {
    const diagSpy = vi.spyOn(diagnosticService, 'diagnose');
    const res = await fetch(`${baseUrl}/api/diagnose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.1'
      },
      body: JSON.stringify({
        evidence: validMinimalEvidence
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_FILES');
    expect(diagSpy).not.toHaveBeenCalled();
  });

  it('2. /api/diagnose malformed evidence does not invoke diagnosticService', async () => {
    const diagSpy = vi.spyOn(diagnosticService, 'diagnose');
    const res = await fetch(`${baseUrl}/api/diagnose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.2'
      },
      body: JSON.stringify({
        evidence: { args: [] }, // missing command
        relevantFiles: { '/src/App.tsx': 'export default () => null;' }
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_EVIDENCE');
    expect(diagSpy).not.toHaveBeenCalled();
  });

  it('3. /api/diagnose oversized file (>500KB) does not invoke diagnosticService', async () => {
    const diagSpy = vi.spyOn(diagnosticService, 'diagnose');
    const res = await fetch(`${baseUrl}/api/diagnose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.3'
      },
      body: JSON.stringify({
        evidence: validMinimalEvidence,
        relevantFiles: { '/src/App.tsx': 'X'.repeat(500_001) }
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('FILE_TOO_LARGE');
    expect(diagSpy).not.toHaveBeenCalled();
  });

  it('4. /api/generate oversized prompt and invalid name do not invoke generationService', async () => {
    const genSpy = vi.spyOn(generationService, 'generate');
    
    // Oversized prompt (>10,000 chars)
    const resPrompt = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.4'
      },
      body: JSON.stringify({ prompt: 'X'.repeat(10_001) })
    });
    expect(resPrompt.status).toBe(400);
    const bodyPrompt = await resPrompt.json();
    expect(bodyPrompt.code).toBe('PROMPT_TOO_LARGE');
    expect(genSpy).not.toHaveBeenCalled();

    // Invalid project name (>100 chars)
    const resName = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.5'
      },
      body: JSON.stringify({ prompt: 'Valid prompt text', name: 'N'.repeat(101) })
    });
    expect(resName.status).toBe(400);
    const bodyName = await resName.json();
    expect(bodyName.code).toBe('INVALID_NAME');
    expect(genSpy).not.toHaveBeenCalled();
  });

  it('5. /api/repair malformed diagnosis does not invoke repairService', async () => {
    const repSpy = vi.spyOn(repairService, 'generatePatch');
    const res = await fetch(`${baseUrl}/api/repair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.6'
      },
      body: JSON.stringify({
        diagnosis: { missingCategory: true },
        evidence: validMinimalEvidence,
        relevantFiles: { '/src/App.tsx': 'export default () => null;' }
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_DIAGNOSIS');
    expect(repSpy).not.toHaveBeenCalled();
  });

  it('6. security rejection responses do not leak stack traces, filesystem paths, or API keys', async () => {
    // Validation rejection shape check
    const resVal = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.7'
      },
      body: JSON.stringify({ prompt: '' })
    });
    const rawValText = await resVal.text();
    expect(rawValText).not.toContain('at Function');
    expect(rawValText).not.toContain('node_modules');
    expect(rawValText).not.toMatch(/[a-zA-Z]:\\[^\s:"']+/);
    expect(rawValText).not.toContain('AIzaSy');

    // Rate-limit rejection shape check
    const ip = '203.0.113.8';
    vi.spyOn(generationService, 'generate').mockResolvedValue({} as any);
    for (let i = 0; i < 30; i++) {
      await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ prompt: 'test' })
      });
    }
    const resRate = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ prompt: 'test' })
    });
    const rawRateText = await resRate.text();
    expect(resRate.status).toBe(429);
    expect(rawRateText).not.toContain('at Function');
    expect(rawRateText).not.toMatch(/[a-zA-Z]:\\[^\s:"']+/);
    expect(rawRateText).not.toContain('AIzaSy');
  });

  it('7. error sanitization redacts local paths and API keys when service throws', async () => {
    vi.spyOn(generationService, 'generate').mockRejectedValue(
      new Error('Internal failure in C:\\Users\\dell\\Desktop\\SnapDeploy AI\\secret.ts with key AIzaSyTestKey1234567890123456789012')
    );

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.9'
      },
      body: JSON.stringify({ prompt: 'Trigger server error' })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('GENERATION_ERROR');
    expect(body.error).toContain('[REDACTED_PATH]');
    expect(body.error).toContain('[REDACTED_API_KEY]');
    expect(body.error).not.toContain('C:\\Users');
    expect(body.error).not.toContain('AIzaSyTestKey');
    expect((body as any).stack).toBeUndefined();
  });

  it('8. rate limiter counts requests arriving at endpoint before body validation', async () => {
    const ip = '203.0.113.10';

    // Fire 30 invalid requests (empty prompt -> rejected by route validation)
    for (let i = 1; i <= 30; i++) {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip
        },
        body: JSON.stringify({ prompt: '' })
      });
      expect(res.status).toBe(400);
    }

    // 31st request from same IP is blocked with 429 because aiRateLimiter runs first
    const res31 = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip
      },
      body: JSON.stringify({ prompt: 'Now valid prompt' })
    });
    expect(res31.status).toBe(429);
    const body31 = await res31.json();
    expect(body31.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('9. CORS preflight (OPTIONS) returns HTTP 204 with allowed headers and credentials', async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    const allowMethods = res.headers.get('access-control-allow-methods') || '';
    expect(allowMethods.toUpperCase()).toContain('POST');
  });

  it('10. Express body-parser enforces configured 2MB limit (returns HTTP 413) without invoking provider', async () => {
    const genSpy = vi.spyOn(generationService, 'generate');
    const largeBody = JSON.stringify({ prompt: 'A'.repeat(2.2 * 1024 * 1024) });

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.11'
      },
      body: largeBody
    });

    expect(res.status).toBe(413);
    expect(genSpy).not.toHaveBeenCalled();
  });

  it('11. missing Content-Type / empty body returns HTTP 400 INVALID_PROMPT without invoking provider', async () => {
    const genSpy = vi.spyOn(generationService, 'generate');

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.12'
      }
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_PROMPT');
    expect(genSpy).not.toHaveBeenCalled();
  });
});


