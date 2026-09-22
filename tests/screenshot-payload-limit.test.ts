import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import app from '../server/index';
import { geminiAIProvider } from '../server/providers/GeminiAIProvider';
import { generationService } from '../server/services/generation-service';

describe('Phase 8.1 — Step 6: Screenshot Payload Limit & Route-Specific Parser Hardening', () => {
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

  // 1. Standard Endpoints Enforce 2MB Ceiling
  it('1. Standard endpoint (/api/generate) rejects >2MB payload with HTTP 413 and never invokes service', async () => {
    const genSpy = vi.spyOn(generationService, 'generate');
    const largePrompt = 'A'.repeat(2.2 * 1024 * 1024);
    const body = JSON.stringify({ prompt: largePrompt });

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.201'
      },
      body
    });

    expect(res.status).toBe(413);
    expect(genSpy).not.toHaveBeenCalled();
  });

  // 2. Screenshot Route Accepts Intended Larger Payload (>2MB up to ~15MB)
  it('2. Screenshot endpoint (/api/screenshot/analyze) accepts 5MB base64 image payload (previously rejected with 413) and returns 200', async () => {
    // In test environment, ensure gemini falls back to rule-based analysis
    vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(false);

    // 5MB base64 string
    const base64Data = 'A'.repeat(5 * 1024 * 1024);
    const payload = {
      image: {
        data: base64Data,
        mimeType: 'image/png'
      },
      metadata: {
        name: 'large-dashboard-screenshot.png',
        width: 1920,
        height: 1080
      }
    };

    const res = await fetch(`${baseUrl}/api/screenshot/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.202'
      },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toContain('analysis_');
    expect(json.viewportWidth).toBe(1920);
    expect(json.viewportHeight).toBe(1080);
    expect(Array.isArray(json.sections)).toBe(true);
  });

  // 3. Screenshot Route Internal Limit Enforces 15,000,000 Character Ceiling (HTTP 400 IMAGE_TOO_LARGE)
  it('3. Screenshot endpoint enforces internal image-size validation and rejects >15,000,000 character image with HTTP 400 IMAGE_TOO_LARGE', async () => {
    // 15,000,001 characters base64 string
    const oversizedBase64 = 'B'.repeat(15_000_001);
    const payload = {
      image: {
        data: oversizedBase64,
        mimeType: 'image/png'
      },
      metadata: {
        name: 'oversized-screenshot.png',
        width: 3840,
        height: 2160
      }
    };

    const res = await fetch(`${baseUrl}/api/screenshot/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.203'
      },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('IMAGE_TOO_LARGE');
    expect(json.error).toContain('10MB limit');
  });

  // 4. Screenshot Route Dedicated Parser Enforces 20MB Ceiling (HTTP 413)
  it('4. Screenshot endpoint dedicated parser rejects oversized body (>20MB) with HTTP 413', async () => {
    // 21MB body exceeds the 20MB dedicated parser limit
    const massiveData = 'C'.repeat(21 * 1024 * 1024);
    const payload = {
      image: {
        data: massiveData,
        mimeType: 'image/png'
      }
    };

    const res = await fetch(`${baseUrl}/api/screenshot/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.204'
      },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(413);
  });

  // 5. Screenshot Route Enforces MIME Type Validation
  it('5. Screenshot endpoint enforces MIME validation and rejects unsupported format with HTTP 400 UNSUPPORTED_MIME', async () => {
    const payload = {
      image: {
        data: 'validBase64DataString',
        mimeType: 'image/gif'
      }
    };

    const res = await fetch(`${baseUrl}/api/screenshot/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.205'
      },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('UNSUPPORTED_MIME');
    expect(json.error).toContain('image/gif');
  });

  // 6. Screenshot Route Enforces Image Schema Validation
  it('6. Screenshot endpoint rejects missing image or data with HTTP 400 INVALID_IMAGE', async () => {
    const payload = {
      image: {
        // missing data
        mimeType: 'image/png'
      }
    };

    const res = await fetch(`${baseUrl}/api/screenshot/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.206'
      },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('INVALID_IMAGE');
  });

  // 7. Normal Small Screenshot Analysis Functions Correctly
  it('7. Normal screenshot analysis functions correctly and returns full structured schema', async () => {
    vi.spyOn(geminiAIProvider, 'isConfigured').mockReturnValue(false);

    const normalPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const payload = {
      image: {
        data: normalPngBase64,
        mimeType: 'image/png'
      },
      metadata: {
        name: 'small-icon.png',
        width: 1280,
        height: 800
      }
    };

    const res = await fetch(`${baseUrl}/api/screenshot/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.207'
      },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toContain('analysis_');
    expect(json.pageType).toBe('dashboard');
    expect(json.layoutModel).toBe('sidebar-content');
    expect(json.typography).toBeDefined();
    expect(json.colorPalette).toBeDefined();
    expect(json.sections.length).toBeGreaterThan(0);
  });
});
