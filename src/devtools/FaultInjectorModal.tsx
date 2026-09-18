import React, { useState } from 'react';
import { 
  AlertTriangle, 
  X, 
  Bug, 
  FileCode, 
  Zap, 
  Cpu,
  RefreshCw
} from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { useEditorStore } from '../store/editorStore';
import { runtimeManager } from '../lib/runtime/runtime-manager';

interface FaultInjectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function injectFaultIntoCode(
  currentCode: string,
  type: 'syntax' | 'type' | 'missing_module' | 'undefined_fn',
  targetPath: string = '/src/App.tsx'
): { brokenCode: string; desc: string } {
  let brokenCode = currentCode;
  let desc = '';

  if (type === 'syntax' || type === 'undefined_fn') {
    const faultSnippet = '// Fault Injected: Undefined Reference\nconst _val = calcTax_UNDEFINED_CALL(100);\n';
    if (currentCode.includes('export default function')) {
      brokenCode = currentCode.replace('export default function', `${faultSnippet}export default function`);
    } else if (currentCode.includes('export function')) {
      brokenCode = currentCode.replace('export function', `${faultSnippet}export function`);
    } else if (currentCode.includes('export default')) {
      brokenCode = currentCode.replace('export default', `${faultSnippet}export default`);
    } else {
      brokenCode = `${faultSnippet}${currentCode}`;
    }

    // Explicit guarantee: brokenCode !== currentCode
    if (brokenCode === currentCode) {
      brokenCode = `${faultSnippet}${currentCode}`;
    }

    desc = "Injected undefined reference 'calcTax_UNDEFINED_CALL' into " + targetPath;
  } else if (type === 'type') {
    brokenCode = currentCode.replace(
      '<InvoiceList />',
      '// Fault Injected: Type Mismatch\n<InvoiceList amount="string_type_error" />'
    );
    if (brokenCode === currentCode) {
      brokenCode = `// Fault Injected: Type Mismatch\nconst _typeMismatchError: number = "string_type_error";\n${currentCode}`;
    }
    desc = "Injected TypeScript type mismatch into " + targetPath;
  } else if (type === 'missing_module') {
    brokenCode = `import '@uninstalled/fake-pkg';\n` + currentCode;
    desc = "Injected missing module import into " + targetPath;
  }

  return { brokenCode, desc };
}

export const FaultInjectorModal: React.FC<FaultInjectorModalProps> = ({ isOpen, onClose }) => {
  const { activeProjectId, projects, writeFile } = useProjectStore();
  const { addTerminalLog } = useRuntimeStore();
  const { openFile } = useEditorStore();
  const [isInjecting, setIsInjecting] = useState(false);

  if (!isOpen) return null;

  const currentProject = projects[activeProjectId];

  const handleInject = async (type: 'syntax' | 'type' | 'missing_module' | 'undefined_fn') => {
    if (!currentProject || isInjecting) return;

    const runtimeStatus = useRuntimeStore.getState().status;
    if (runtimeStatus !== 'ready') {
      addTerminalLog(`\x1b[31m[Fault Injector Error]\x1b[0m Runtime is not ready (status: '${runtimeStatus}'). Please wait for project initialization to complete.`);
      return;
    }

    let targetPath = '/src/App.tsx';
    let currentCode = currentProject.files[targetPath]?.content;
    if (!currentCode) {
      targetPath = Object.keys(currentProject.files)[0] || '/src/App.tsx';
      currentCode = currentProject.files[targetPath]?.content || '';
    }

    const { brokenCode, desc } = injectFaultIntoCode(currentCode, type, targetPath);

    setIsInjecting(true);
    try {
      // Write real broken code into VFS & sync to runtime
      await writeFile(activeProjectId, targetPath, brokenCode);
      await runtimeManager.syncFile(targetPath, brokenCode);
      openFile(activeProjectId, targetPath);

      // Once writeFile() and syncFile() succeed, close modal immediately
      onClose();

      addTerminalLog(`\x1b[31m[DevTools: Fault Injected]\x1b[0m ${desc}`);
      addTerminalLog(`\x1b[34m[DevTools]\x1b[0m Running real TypeScript check to capture authentic execution evidence...`);

      // Execute the canonical compiler verification check and capture authentic evidence
      const checkPromise = runtimeManager.runTypeScriptCheck(
        (data) => addTerminalLog(data),
        activeProjectId
      );

      useRuntimeStore.setState({
        pendingEvidencePromise: checkPromise,
        lastEvidence: null
      });

      const evidence = await checkPromise;

      useRuntimeStore.setState((state) => ({
        lastEvidence: evidence,
        executionHistory: [...state.executionHistory, evidence],
        activeBottomTab: 'diagnostics',
        isBottomDrawerOpen: true,
        pendingEvidencePromise: null
      }));

      if (evidence.stderr) {
        addTerminalLog(`\x1b[31m[TypeScript Compiler Output]\x1b[0m\n${evidence.stderr}`);
      }
    } catch (err: any) {
      useRuntimeStore.setState({ pendingEvidencePromise: null });
      addTerminalLog(`\x1b[31m[Execution Error]\x1b[0m Failed to capture execution evidence: ${err?.message || 'Compiler check failed'}`);
    } finally {
      setIsInjecting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-in fade-in">
      <div className="bg-[#111827] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 ring-1 ring-white/5">
        <div className="flex items-center justify-between pb-3 border-b border-white/5">
          <div className="flex items-center gap-2 text-rose-400">
            <Bug className="w-5 h-5" />
            <h2 className="text-sm font-bold text-white tracking-tight">Development Fault Injector</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isInjecting}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Inject a controlled real-world fault into the active project files to test the genuine AI diagnosis, patch generation, and verification rollback pipeline.
        </p>

        <div className="space-y-2.5">
          <button
            onClick={() => handleInject('syntax')}
            disabled={isInjecting}
            className="w-full text-left p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-white/5 hover:border-rose-500/40 transition group disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white group-hover:text-rose-300 transition">
                1. TypeScript Undefined Identifier (TS2304)
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                TS2304
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Calls an undefined tax calculation function <code className="text-rose-300 font-mono">calcTax_UNDEFINED_CALL</code>.
            </p>
          </button>

          <button
            onClick={() => handleInject('type')}
            disabled={isInjecting}
            className="w-full text-left p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-white/5 hover:border-amber-500/40 transition group disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white group-hover:text-amber-300 transition">
                2. TypeScript Type Mismatch (TS2322)
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                TS2322
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Passes invalid string to prop expecting number type.
            </p>
          </button>

          <button
            onClick={() => handleInject('missing_module')}
            disabled={isInjecting}
            className="w-full text-left p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-white/5 hover:border-violet-500/40 transition group disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white group-hover:text-violet-300 transition">
                3. Missing Dependency Import (TS2307)
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                TS2307
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Imports uninstalled npm package <code className="text-violet-300 font-mono">@uninstalled/fake-pkg</code>.
            </p>
          </button>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            disabled={isInjecting}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
