import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  geminiAIProvider,
  DEFAULT_GENERATION_MAX_OUTPUT_TOKENS,
  DEFAULT_BOUNDED_MAX_OUTPUT_TOKENS,
  resolveGenerationMaxOutputTokens
} from '../server/providers/GeminiAIProvider';
import {
  getDailyAiQuotaState,
  resetDailyAiQuotaForTesting,
  setDailyAiQuotaLimitForTesting,
  checkAndIncrementDailyQuota
} from '../server/index';
import { GenerationPanel } from '../src/features/generation/GenerationPanel';
import { useProjectStore } from '../src/store/projectStore';
import { useAgentStore } from '../src/store/agentStore';
import { useRuntimeStore } from '../src/store/runtimeStore';

describe('Phase 8.2.9: Controlled Beta Blocker Repair Verification Suite', () => {
  const panelPath = path.resolve(__dirname, '../src/features/generation/GenerationPanel.tsx');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  beforeEach(() => {
    vi.restoreAllMocks();
    resetDailyAiQuotaForTesting();
    setDailyAiQuotaLimitForTesting(null);
  });

  afterEach(() => {
    resetDailyAiQuotaForTesting();
    setDailyAiQuotaLimitForTesting(null);
  });

  // =========================================================================
  // 1. Generation Token Configuration & Bounds
  // =========================================================================
  describe('1. Generation Token Configuration', () => {
    it('defaults to 32768 tokens and resolves safely across valid/invalid env inputs', () => {
      expect(DEFAULT_GENERATION_MAX_OUTPUT_TOKENS).toBe(32768);
      expect(DEFAULT_BOUNDED_MAX_OUTPUT_TOKENS).toBe(8192);

      const savedEnv = process.env.GENERATION_MAX_OUTPUT_TOKENS;
      try {
        delete process.env.GENERATION_MAX_OUTPUT_TOKENS;
        expect(resolveGenerationMaxOutputTokens()).toBe(32768);

        process.env.GENERATION_MAX_OUTPUT_TOKENS = '16384';
        expect(resolveGenerationMaxOutputTokens()).toBe(16384);

        process.env.GENERATION_MAX_OUTPUT_TOKENS = '65536';
        expect(resolveGenerationMaxOutputTokens()).toBe(65536);

        // Negative or below 1024 fallback
        process.env.GENERATION_MAX_OUTPUT_TOKENS = '256';
        expect(resolveGenerationMaxOutputTokens()).toBe(32768);

        // Above 65536 fallback
        process.env.GENERATION_MAX_OUTPUT_TOKENS = '100000';
        expect(resolveGenerationMaxOutputTokens()).toBe(32768);

        // Non-numeric fallback
        process.env.GENERATION_MAX_OUTPUT_TOKENS = 'unlimited';
        expect(resolveGenerationMaxOutputTokens()).toBe(32768);
      } finally {
        if (savedEnv !== undefined) {
          process.env.GENERATION_MAX_OUTPUT_TOKENS = savedEnv;
        } else {
          delete process.env.GENERATION_MAX_OUTPUT_TOKENS;
        }
      }
    });
  });

  // =========================================================================
  // 2. Generation Can Exceed the Previous 8192 Limit
  // =========================================================================
  describe('2. Generation Exceeding Previous 8192 Token Limit', () => {
    it('dispatches generateContent with maxOutputTokens: 32768 and accepts large token candidates', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          name: 'complex-app',
          framework: 'vite-react',
          dependencies: [],
          scripts: { dev: 'vite', build: 'vite build' },
          files: [
            { path: '/src/main.tsx', purpose: 'Entry', content: "import App from './App'; export default App;" },
            { path: '/src/App.tsx', purpose: 'App', content: 'export default function App() { return <div>App</div>; }' }
          ]
        }),
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 500,
          candidatesTokenCount: 12450, // Far exceeds previous 8192 cap
          totalTokenCount: 12950
        }
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      const result = await geminiAIProvider.generateProject({
        prompt: 'Build comprehensive SaaS application with large state',
        requestId: 'exceed-cap-req'
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callConfig = mockGenerateContent.mock.calls[0][0].config;
      expect(callConfig.maxOutputTokens).toBe(32768);
      expect(result.plan.name).toBe('complex-app');

      // Telemetry captures >8192 candidate tokens
      const history = geminiAIProvider.getExecutionHistory();
      const rec = history.find((h) => h.requestId === 'exceed-cap-req');
      expect(rec?.candidatesTokens).toBe(12450);
    });
  });

  // =========================================================================
  // 3. Truncated & Malformed Generation Responses
  // =========================================================================
  describe('3. Truncated & Malformed Generation Responses', () => {
    it('explicitly identifies truncation when finishReason is MAX_TOKENS', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: '{"name":"truncated-kanban","files":[{"path":"/src/App.tsx","content":"export default fu',
        candidates: [{ finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 32768, totalTokenCount: 32968 }
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      await expect(
        geminiAIProvider.generateProject({
          prompt: 'Massive prompt causing token exhaustion',
          requestId: 'trunc-req-1'
        })
      ).rejects.toThrow(/finishReason: MAX_TOKENS/);
    });

    it('identifies generic JSON syntax errors when not caused by token truncation', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'Invalid non-JSON response from model',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 }
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      await expect(
        geminiAIProvider.generateProject({
          prompt: 'Bad output test',
          requestId: 'malformed-req-1'
        })
      ).rejects.toThrow(/Failed to parse Gemini structured JSON/);
    });
  });

  // =========================================================================
  // 4, 5, 6. Diagnose, Repair, and Edit Remain Bounded at 8192
  // =========================================================================
  describe('4, 5, 6. Diagnose, Repair, and Edit Token Boundaries', () => {
    it('keeps diagnoseError strictly bounded at 8192 tokens', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: 'syntax',
          severity: 'high',
          explanation: 'Syntax error',
          affectedFiles: ['/src/App.tsx'],
          evidence: ['Unexpected token'],
          suggestedFix: 'Fix syntax'
        }),
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 40, totalTokenCount: 60 }
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      await geminiAIProvider.diagnoseError({
        evidence: { executionId: 'e-1', command: 'npm', args: ['run', 'build'], exitCode: 1, stdout: '', stderr: 'Err', durationMs: 20 },
        relevantFiles: { '/src/App.tsx': 'const a = ' },
        requestId: 'diag-req'
      });

      expect(mockGenerateContent.mock.calls[0][0].config.maxOutputTokens).toBe(8192);
    });

    it('keeps generateRepairPatch strictly bounded at 8192 tokens', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          summary: 'Fix syntax error',
          confidence: 0.95,
          files: [{ path: '/src/App.tsx', after: 'const a = 1;' }]
        }),
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 30, totalTokenCount: 50 }
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      await geminiAIProvider.generateRepairPatch({
        diagnosis: { category: 'syntax', severity: 'high', explanation: 'Syntax error', affectedFiles: ['/src/App.tsx'], evidence: [], suggestedFix: 'Fix' },
        evidence: { executionId: 'e-1', command: 'npm', args: ['run', 'build'], exitCode: 1, stdout: '', stderr: '', durationMs: 20 },
        relevantFiles: { '/src/App.tsx': 'const a = ' },
        requestId: 'repair-req'
      });

      expect(mockGenerateContent.mock.calls[0][0].config.maxOutputTokens).toBe(8192);
    });

    it('keeps proposeEdit strictly bounded at 8192 tokens', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: JSON.stringify({
          summary: 'Add button',
          explanation: 'Added button',
          files: [{ path: '/src/App.tsx', action: 'modify', after: 'export default function App() { return <button>Click</button>; }' }]
        }),
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 40, totalTokenCount: 70 }
      });

      (geminiAIProvider as any).ai = {
        models: { generateContent: mockGenerateContent }
      };

      await geminiAIProvider.proposeEdit({
        prompt: 'Add button',
        relevantFiles: { '/src/App.tsx': 'export default function App() { return null; }' },
        requestId: 'edit-req'
      });

      expect(mockGenerateContent.mock.calls[0][0].config.maxOutputTokens).toBe(8192);
    });
  });

  // =========================================================================
  // 7 & 8. Generation Telemetry & Quota Accounting
  // =========================================================================
  describe('7 & 8. Telemetry and Daily Quota Accounting', () => {
    it('records token usage and updates daily quota accurately', () => {
      resetDailyAiQuotaForTesting(0, undefined, 100);
      const initial = getDailyAiQuotaState();
      expect(initial.count).toBe(0);
      expect(initial.remaining).toBe(100);

      // Simulate allowed quota increments
      const mockReq = { headers: {} } as any;
      const mockRes = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      const allowed = checkAndIncrementDailyQuota(mockReq, mockRes);
      expect(allowed).toBe(true);
      expect(getDailyAiQuotaState().count).toBe(1);
      expect(getDailyAiQuotaState().remaining).toBe(99);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining-Daily', 99);
    });
  });

  // =========================================================================
  // 9. GenerationPanel: Success Card & Create Another Transition (ISSUE-02)
  // =========================================================================
  describe('9. GenerationPanel Success Card & Create Another Transition', () => {
    it('includes prominent Create Another action and instant next prompt entry in source contract', () => {
      expect(panelSrc).toContain('data-testid="create-another-btn"');
      expect(panelSrc).toContain('data-testid="quick-next-prompt-input"');
      expect(panelSrc).toContain('data-testid="quick-generate-next-btn"');
      expect(panelSrc).toContain('handleCreateNextProject');
      expect(panelSrc).toContain('Start Another Project Immediately');
    });

    it('renders ready state with editable prompt input and disabled submit button when empty', () => {
      useAgentStore.setState({ generationState: 'idle' });
      useProjectStore.setState({ projects: {}, activeProjectId: '' });

      const html = renderToStaticMarkup(<GenerationPanel />);
      expect(html).toContain('Describe Application to Generate');
      expect(html).toContain('Generate Application');
      expect(html).not.toContain('Application Created');
    });
  });

  // =========================================================================
  // 10. GenerationPanel: Installation & Disabled-State Messaging (ISSUE-03)
  // =========================================================================
  describe('10. GenerationPanel Installation & Disabled-State Messaging', () => {
    it('contains generation-busy-status explanation and dynamic button labels', () => {
      expect(panelSrc).toContain('data-testid="generation-busy-status"');
      expect(panelSrc).toContain('Preparing WebContainer preview & installing dependencies');
      expect(panelSrc).toContain('Synthesizing application blueprint with Gemini AI');
      expect(panelSrc).toContain('Preparing Preview...');
      expect(panelSrc).toContain('title={isGenerating ? "Generation in progress.');
    });
  });
});
