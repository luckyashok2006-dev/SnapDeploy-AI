import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { 
  Terminal as TerminalIcon, 
  Trash2, 
  Play
} from 'lucide-react';
import { useRuntimeStore } from '../../store/runtimeStore';
import { useProjectStore } from '../../store/projectStore';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { formatBoundarySafeLog } from '../../lib/terminal/ansi-utils';

interface InteractiveTerminalProps {
  isVisible?: boolean;
}

export const InteractiveTerminal: React.FC<InteractiveTerminalProps> = ({ isVisible = true }) => {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);

  const { activeProjectId } = useProjectStore();
  const currentLogs = useRuntimeStore((s) => s.getTerminalLogs(activeProjectId));
  const { clearTerminalLogs, executeCommand } = useRuntimeStore();
  const renderedLogsCount = useRef(0);
  const currentInput = useRef('');
  const lastProjectId = useRef(activeProjectId);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0B0F17',
        foreground: '#f8fafc',
        cursor: '#8b5cf6',
        selectionBackground: 'rgba(139, 92, 246, 0.3)',
        black: '#0B0F17',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#6366f1',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f8fafc'
      },
      fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 1000
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    try {
      fitAddon.fit();
    } catch (e) {}

    xtermInstance.current = term;
    fitAddonInstance.current = fitAddon;

    term.writeln('\x1b[1;36m=== SnapDeploy WebContainer Terminal ===\x1b[0m');
    term.writeln('\x1b[90mExecute real npm, tsc, and test commands in real WebContainer runtime.\x1b[0m\r\n');

    const prompt = () => term.write('\x1b[1;32msnapdeploy@webcontainer\x1b[0m:\x1b[1;34m~$\x1b[0m ');
    prompt();

    term.onData(async (data) => {
      const code = data.charCodeAt(0);
      if (code === 13) {
        term.writeln('');
        const cmdLine = currentInput.current.trim();
        currentInput.current = '';

        if (cmdLine === 'clear') {
          term.clear();
          clearTerminalLogs(activeProjectId);
          renderedLogsCount.current = 0;
        } else if (cmdLine === 'help') {
          term.writeln('Real WebContainer Commands:');
          term.writeln('  \x1b[33mnpm install\x1b[0m           - Installs dependencies from VFS package.json');
          term.writeln('  \x1b[33mnpm run dev\x1b[0m           - Boots Vite dev server and binds live preview');
          term.writeln('  \x1b[33mnpm run build\x1b[0m         - Compiles production distribution');
          term.writeln('  \x1b[33mnpx tsc --noEmit\x1b[0m      - Executes TypeScript strict typecheck');
          term.writeln('  \x1b[33mclear\x1b[0m                 - Clears terminal output');
        } else if (cmdLine) {
          const parts = cmdLine.split(' ');
          const cmd = parts[0];
          const args = parts.slice(1);
          await executeCommand(cmd, args, { projectId: activeProjectId });
        }

        prompt();
      } else if (code === 127) {
        if (currentInput.current.length > 0) {
          currentInput.current = currentInput.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (code >= 32) {
        currentInput.current += data;
        term.write(data);
      }
    });

    const handleResize = () => {
      const el = terminalRef.current;
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        try {
          fitAddon.fit();
        } catch (e) {}
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  // EC-03: When terminal becomes visible again, fit only after container is measurable
  useEffect(() => {
    if (!isVisible) return;
    const el = terminalRef.current;
    if (!el) return;

    const fitIfMeasurable = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        try {
          fitAddonInstance.current?.fit();
        } catch (e) {}
      }
    };

    const animId = requestAnimationFrame(fitIfMeasurable);
    return () => cancelAnimationFrame(animId);
  }, [isVisible]);

  // EC-02 & EC-03: Synchronize logs for active project without rebuilding xterm on tab switch
  useEffect(() => {
    const term = xtermInstance.current;
    if (!term) return;

    // Check if project switched
    if (lastProjectId.current !== activeProjectId) {
      lastProjectId.current = activeProjectId;
      term.clear();
      term.writeln('\x1b[1;36m=== SnapDeploy WebContainer Terminal ===\x1b[0m');
      term.writeln(`\x1b[90mActive Project: ${activeProjectId}\x1b[0m\r\n`);
      for (const log of currentLogs) {
        term.writeln(formatBoundarySafeLog(log));
      }
      renderedLogsCount.current = currentLogs.length;
      term.write('\x1b[1;32msnapdeploy@webcontainer\x1b[0m:\x1b[1;34m~$\x1b[0m ');
      return;
    }

    // New logs in current project
    if (currentLogs.length > renderedLogsCount.current) {
      for (let i = renderedLogsCount.current; i < currentLogs.length; i++) {
        term.writeln(formatBoundarySafeLog(currentLogs[i]));
      }
      renderedLogsCount.current = currentLogs.length;
      term.write('\x1b[1;32msnapdeploy@webcontainer\x1b[0m:\x1b[1;34m~$\x1b[0m ');
    } else if (currentLogs.length === 0 && renderedLogsCount.current > 0) {
      term.clear();
      renderedLogsCount.current = 0;
      term.write('\x1b[1;32msnapdeploy@webcontainer\x1b[0m:\x1b[1;34m~$\x1b[0m ');
    }
  }, [currentLogs, activeProjectId]);

  return (
    <ErrorBoundary fallbackTitle="xterm.js Terminal Error">
      <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden">
        {/* Header */}
        <div className="h-9 px-3 bg-slate-950 border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-sans">
              WebContainer Terminal (xterm.js)
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Live Process
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                clearTerminalLogs(activeProjectId);
                if (xtermInstance.current) {
                  xtermInstance.current.clear();
                  renderedLogsCount.current = 0;
                }
              }}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition"
              title="Clear terminal"
              aria-label="Clear terminal"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal View */}
        <div className="flex-1 p-2 bg-[#0B0F17] overflow-hidden">
          <div ref={terminalRef} className="h-full w-full" />
        </div>
      </div>
    </ErrorBoundary>
  );
};
