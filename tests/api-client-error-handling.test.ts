import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest } from '../src/lib/api';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopNavbar } from '../src/components/navbar/TopNavbar';

describe('DEF-01: Centralized API Client Error Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly extracts error.message from structured error objects', async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please wait 60 seconds before generating again.'
        }
      }),
      text: vi.fn().mockResolvedValue('')
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(apiRequest('/api/generate')).rejects.toThrow(
      'Too many requests. Please wait 60 seconds before generating again.'
    );
  });

  it('never stringifies structured error objects into "[object Object]"', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Gemini synthesis pipeline failed: model output corrupted'
        }
      }),
      text: vi.fn().mockResolvedValue('')
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    try {
      await apiRequest('/api/generate');
      expect.unreachable('Should have thrown an error');
    } catch (err: any) {
      expect(err.message).not.toContain('[object Object]');
      expect(err.message).toBe('Gemini synthesis pipeline failed: model output corrupted');
      expect(err.status).toBe(500);
    }
  });

  it('handles top-level string error', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Invalid project prompt provided'
      }),
      text: vi.fn().mockResolvedValue('')
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(apiRequest('/api/generate')).rejects.toThrow('Invalid project prompt provided');
  });

  it('handles top-level string message', async () => {
    const mockResponse = {
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({
        message: 'Google Gemini provider is temporarily unavailable'
      }),
      text: vi.fn().mockResolvedValue('')
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(apiRequest('/api/generate')).rejects.toThrow(
      'Google Gemini provider is temporarily unavailable'
    );
  });

  it('handles structured error object with code only', async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({
        error: {
          code: 'FORBIDDEN_OPERATION'
        }
      }),
      text: vi.fn().mockResolvedValue('')
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(apiRequest('/api/generate')).rejects.toThrow('FORBIDDEN_OPERATION');
  });

  it('falls back to raw text when JSON parsing fails', async () => {
    const mockResponse = {
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      text: vi.fn().mockResolvedValue('Bad Gateway from Cloudflare upstream proxy')
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(apiRequest('/api/generate')).rejects.toThrow(
      'Bad Gateway from Cloudflare upstream proxy'
    );
  });

  it('falls back to default endpoint status message when body is empty', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      json: vi.fn().mockRejectedValue(new Error('No JSON')),
      text: vi.fn().mockResolvedValue('')
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

    await expect(apiRequest('/api/unknown')).rejects.toThrow(
      'API request to /api/unknown failed (404)'
    );
  });
});

describe('DEF-02: TopNavbar Initial Model State', () => {
  it('renders initial AI model state as gemini-3.5-flash-lite without flashing legacy model', () => {
    const html = renderToStaticMarkup(
      React.createElement(TopNavbar, {
        onOpenFaultModal: () => {},
        onOpenCommandPalette: () => {}
      })
    );

    expect(html).toContain('gemini-3.5-flash-lite');
    expect(html).not.toContain('gemini-2.5-flash');
  });
});
