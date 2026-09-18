import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApiUrl, apiRequest } from '../src/lib/api';
import { generateProject } from '../src/features/generation/generation-client';
import { diagnoseFailure } from '../src/features/repair/diagnosis';
import { generatePatch } from '../src/features/repair/repair';

describe('Frontend/Backend API Plumbing (Tests A-F)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A. API helper builds correct URL', () => {
    expect(buildApiUrl('/api/generate')).toBe('/api/generate');
    expect(buildApiUrl('api/health')).toBe('/api/health');
    expect(buildApiUrl('/api/custom/route')).toBe('/api/custom/route');
  });

  it('B. development /api proxy works with relative URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', proxy: true })
    } as any);

    const result = await apiRequest('/api/test-proxy');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/test-proxy',
      expect.objectContaining({
        headers: expect.any(Headers)
      })
    );
    expect(result.proxy).toBe(true);
  });

  it('C. backend errors propagate correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid generation parameters' }),
      text: async () => 'Invalid generation parameters'
    } as any);

    await expect(apiRequest('/api/generate', { body: {} })).rejects.toThrow(
      'Invalid generation parameters'
    );
  });

  it('D. generation still reaches /api/generate', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        plan: { name: 'gen-app', framework: 'vite-react', files: [], dependencies: [], scripts: {} },
        files: { '/package.json': '{}' }
      })
    } as any);

    const input = { prompt: 'Create todo app', framework: 'vite-react' as const };
    const res = await generateProject(input);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input)
      })
    );
    expect(res.plan.name).toBe('gen-app');
  });

  it('E. diagnosis still reaches /api/diagnose', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        category: 'syntax',
        severity: 'high',
        explanation: 'Syntax error detected',
        affectedFiles: ['/src/App.tsx'],
        evidence: ['error TS2304'],
        suggestedFix: 'Fix undefined var'
      })
    } as any);

    const diagInput = {
      evidence: {
        executionId: 'e1',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: 'TS2304',
        durationMs: 100,
        timedOut: false
      },
      relevantFiles: { '/src/App.tsx': 'code' }
    };

    const diag = await diagnoseFailure(diagInput);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/diagnose',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(diagInput)
      })
    );
    expect(diag.category).toBe('syntax');
  });

  it('F. repair still reaches /api/repair', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'patch-1',
        summary: 'Fixed syntax error',
        files: [{ path: '/src/App.tsx', before: 'old', after: 'new' }]
      })
    } as any);

    const repairInput = {
      diagnosis: {
        category: 'syntax',
        severity: 'high' as const,
        explanation: 'Syntax error',
        affectedFiles: ['/src/App.tsx'],
        evidence: [],
        suggestedFix: 'Fix error'
      },
      evidence: {
        executionId: 'e2',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: false
      },
      relevantFiles: { '/src/App.tsx': 'old' }
    };

    const patch = await generatePatch(repairInput);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/repair',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(repairInput)
      })
    );
    expect(patch.id).toBe('patch-1');
  });
});
