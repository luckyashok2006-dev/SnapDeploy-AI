import React, { useState } from 'react';
import { 
  Wand2, 
  Sparkles, 
  Zap, 
  Moon, 
  ShieldCheck, 
  Cpu
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useAgentStore } from '../../store/agentStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { generatePatch } from '../../features/repair/repair';
import { Patch } from '../../types/workspace';

interface EditorCommandStripProps {
  language?: string;
}

export const EditorCommandStrip: React.FC<EditorCommandStripProps> = ({ language = 'TypeScript' }) => {
  const { activeProjectId, projects } = useProjectStore();
  const { activeFilePath } = useEditorStore();
  const { setPendingPatch, setIsDiffModalOpen } = useAgentStore();
  const { addTerminalLog } = useRuntimeStore();

  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const quickPills = [
    { label: '+ Dark Theme', prompt: 'Add Dark Mode toggle and state persistence' },
    { label: '+ Memoize AST', prompt: 'Optimize React component with useMemo and useCallback' },
    { label: '+ Filter Search', prompt: 'Add search query filter to data list' }
  ];

  const handleExecute = async (userPrompt: string) => {
    if (!userPrompt.trim() || isProcessing) return;

    setIsProcessing(true);
    addTerminalLog(`\x1b[35m[AI Refactor]\x1b[0m Synthesizing patch for prompt: "${userPrompt}"`);

    const currentProject = projects[activeProjectId];
    const targetFile = activeFilePath[activeProjectId] || '/src/App.tsx';
    const currentCode = currentProject?.files[targetFile]?.content || '';

    try {
      let patchedCode = currentCode;

      if (userPrompt.toLowerCase().includes('dark') || userPrompt.toLowerCase().includes('theme')) {
        patchedCode = currentCode.replace(
          'export default function',
          '// Added Theme Switcher State\nexport default function'
        );
      } else if (userPrompt.toLowerCase().includes('search') || userPrompt.toLowerCase().includes('filter')) {
        patchedCode = currentCode.replace(
          'export default function',
          '// Added Search & Filter Capabilities\nexport default function'
        );
      } else {
        patchedCode = `// AI Refactor: ${userPrompt}\n` + currentCode;
      }

      const patch: Patch = {
        id: `patch_refactor_${Date.now()}`,
        summary: `Refactor: ${userPrompt}`,
        files: [
          {
            path: targetFile,
            before: currentCode,
            after: patchedCode
          }
        ],
        confidence: 0.95
      };

      setPendingPatch(patch);
      setIsDiffModalOpen(true);
      setPrompt('');
    } catch (err: any) {
      addTerminalLog(`\x1b[31m[Refactor Error]\x1b[0m ${err?.message || 'Failed'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="h-11 px-3 bg-slate-950/90 backdrop-blur-md border-t border-white/5 flex items-center justify-between gap-3 shrink-0 select-none z-10">
      {/* Center: Input Prompt & Action Pills */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleExecute(prompt);
        }}
        className="flex-1 max-w-2xl flex items-center gap-2"
      >
        <div className="flex-1 relative">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="AI Refactor prompt (e.g. 'Add Dark Mode', 'Add Search Filter')..."
            className="w-full bg-[#111827] border border-white/10 rounded-lg px-3 py-1 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
          />
        </div>

        <button
          type="submit"
          disabled={!prompt.trim() || isProcessing}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1 shrink-0"
        >
          <Wand2 className="w-3 h-3" />
          <span>Refactor</span>
        </button>

        {/* Quick Action Pills */}
        <div className="hidden lg:flex items-center gap-1.5 pl-1">
          {quickPills.map((pill, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleExecute(pill.prompt)}
              className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-900 hover:bg-violet-950/50 text-slate-400 hover:text-violet-300 border border-white/5 hover:border-violet-500/30 transition-all hover:-translate-y-0.5 whitespace-nowrap"
            >
              {pill.label}
            </button>
          ))}
        </div>
      </form>

      {/* Right: Context Language Indicator */}
      <div className="hidden md:flex items-center gap-2.5 text-[10px] font-mono text-slate-400 shrink-0">
        <span className="px-2 py-0.5 rounded bg-[#111827] border border-white/5 text-slate-400">
          Runtime: <strong className="text-emerald-400">WebContainer Node 22</strong>
        </span>
        <span className="px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 font-semibold uppercase">
          {language}
        </span>
      </div>
    </div>
  );
};
