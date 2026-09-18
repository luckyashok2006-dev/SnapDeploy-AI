import { describe, it, expect } from 'vitest';
import dotenv from 'dotenv';
dotenv.config();

import { GeminiAIProvider } from '../server/providers/GeminiAIProvider';

describe.sequential('Gemini AI Provider Configuration & Live Integration', () => {
  it('reports configuration error clearly when API key is missing or placeholder', () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = 'PASTE_YOUR_GEMINI_API_KEY_HERE';
      const provider = new GeminiAIProvider();
      expect(provider.isConfigured()).toBe(false);

      expect(() => {
        // @ts-ignore
        provider.ensureClient();
      }).toThrowError(/GEMINI_PROVIDER_UNAVAILABLE/);
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  const isLiveTestEnabled = process.env.RUN_LIVE_AI_TESTS === 'true';

  it.runIf(isLiveTestEnabled)('executes real live Gemini generation request', async () => {
    const provider = new GeminiAIProvider();
    expect(provider.isConfigured()).toBe(true);

    const result = await provider.generateProject({
      prompt: 'Build a minimal counter button in React with Tailwind CSS'
    });

    expect(result.plan.framework).toBe('vite-react');
    expect(result.plan.files.length).toBeGreaterThan(0);
    expect(result.files['/package.json']).toBeDefined();
    expect(result.files['/src/App.tsx']).toBeDefined();

    const history = provider.getExecutionHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].provider).toBe('gemini');
    expect(history[0].success).toBe(true);
  }, 120000);

  it.runIf(isLiveTestEnabled)('executes real live Gemini diagnosis request', async () => {
    const provider = new GeminiAIProvider();
    const diagnosis = await provider.diagnoseFailure({
      evidence: {
        executionId: 'test-exec-1',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: "src/App.tsx(5,10): error TS2304: Cannot find name 'unresolved_symbol'.",
        durationMs: 40
      },
      relevantFiles: {
        '/src/App.tsx': 'export default function App() { return <div>{unresolved_symbol}</div>; }'
      },
      userRequirement: 'Simple React App'
    });

    expect(diagnosis.category).toBeDefined();
    expect(diagnosis.explanation).toBeDefined();
    expect(diagnosis.suggestedFix).toBeDefined();
    expect(diagnosis.affectedFiles).toContain('/src/App.tsx');
  }, 60000);

  it.runIf(isLiveTestEnabled)('executes real live Gemini patch generation request', async () => {
    const provider = new GeminiAIProvider();
    const patch = await provider.generatePatch({
      diagnosis: {
        category: 'syntax',
        severity: 'high',
        explanation: 'The variable unresolved_symbol is not defined.',
        affectedFiles: ['/src/App.tsx'],
        evidence: ["Cannot find name 'unresolved_symbol'"],
        suggestedFix: 'Define unresolved_symbol or replace with static value.'
      },
      evidence: {
        executionId: 'test-exec-2',
        command: 'npx tsc --noEmit',
        args: [],
        exitCode: 1,
        stdout: '',
        stderr: "Cannot find name 'unresolved_symbol'",
        durationMs: 30
      },
      relevantFiles: {
        '/src/App.tsx': 'export default function App() { return <div>{unresolved_symbol}</div>; }'
      },
      originalRequirement: 'Simple React App'
    });

    expect(patch.files.length).toBeGreaterThan(0);
    expect(patch.files[0].path).toBe('/src/App.tsx');
    expect(patch.files[0].after).toBeDefined();
  }, 60000);
});
