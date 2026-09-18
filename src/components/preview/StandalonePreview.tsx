import React, { useEffect, useState, useRef } from 'react';

export interface RuntimeSessionPayload {
  projectId: string | null;
  status: 'idle' | 'booting' | 'ready' | 'running' | 'error';
  previewUrl: string | null;
  previewPort: number | null;
  updatedAt: number;
}

export const StandalonePreview: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState<RuntimeSessionPayload | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Extract target project from query parameters: /preview?project=<id>
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const targetProjectId = searchParams?.get('project') || null;

  useEffect(() => {
    // 1. Read initial session from localStorage or window store if available
    const readCurrentSession = (): RuntimeSessionPayload | null => {
      try {
        const raw = localStorage.getItem('snapdeploy_runtime_session');
        if (raw) {
          return JSON.parse(raw);
        }
      } catch {}

      // Fallback: check window store if running in same-process test harness
      if (typeof window !== 'undefined' && (window as any).useRuntimeStore) {
        const rStore = (window as any).useRuntimeStore.getState?.();
        const pStore = (window as any).useProjectStore?.getState?.();
        if (rStore) {
          return {
            projectId: pStore?.activeProjectId || targetProjectId,
            status: rStore.status,
            previewUrl: rStore.previewUrl,
            previewPort: rStore.previewPort,
            updatedAt: Date.now()
          };
        }
      }
      return null;
    };

    const initial = readCurrentSession();
    if (initial) {
      setSession(initial);
      setIsInitializing(false);
    }

    // 2. Set up BroadcastChannel to synchronize live session state and request immediate state
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('snapdeploy_preview_channel');
      bc.addEventListener('message', (event) => {
        if (event.data?.type === 'RUNTIME_SESSION_UPDATE' && event.data.session) {
          setSession(event.data.session);
          setIsInitializing(false);
        }
      });
      // Request immediate state from the active SnapDeploy IDE tab
      bc.postMessage({ type: 'REQUEST_PREVIEW_STATE', requestedProjectId: targetProjectId });
    } catch {}

    // 3. Fallback cross-tab storage listener
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'snapdeploy_runtime_session' && event.newValue) {
        try {
          const updated = JSON.parse(event.newValue);
          setSession(updated);
          setIsInitializing(false);
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);

    // Initial timeout to settle initialization
    const timer = setTimeout(() => setIsInitializing(false), 800);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('storage', handleStorage);
      if (bc) bc.close();
    };
  }, [targetProjectId]);

  // 4. WebContainer Runtime Message Broker:
  // Proxies MessagePorts between the preview iframe and window.opener (SnapDeploy host)
  useEffect(() => {
    const handleMessageBroker = (event: MessageEvent) => {
      // Forward messages from our embedded preview iframe to window.opener (host)
      if (event.source === iframeRef.current?.contentWindow) {
        if (window.opener && !window.opener.closed) {
          const transferables: Transferable[] = [];
          if (event.ports && event.ports.length > 0) {
            transferables.push(...event.ports);
          }
          try {
            window.opener.postMessage(event.data, '*', transferables);
          } catch {}
        }
      }
      // Forward messages from window.opener (host) to our preview iframe
      else if (event.source === window.opener) {
        if (iframeRef.current?.contentWindow) {
          const transferables: Transferable[] = [];
          if (event.ports && event.ports.length > 0) {
            transferables.push(...event.ports);
          }
          try {
            iframeRef.current.contentWindow.postMessage(event.data, '*', transferables);
          } catch {}
        }
      }
    };

    window.addEventListener('message', handleMessageBroker);
    return () => window.removeEventListener('message', handleMessageBroker);
  }, []);

  // Strict Project Isolation & Runtime Readiness Guards
  const isProjectMatch = !targetProjectId || (session && session.projectId === targetProjectId);
  const isReady = session?.status === 'ready' && Boolean(session.previewUrl);

  if (isInitializing && !session) {
    return (
      <div 
        data-testid="preview-loading-state"
        className="flex flex-col items-center justify-center min-h-screen bg-[#0B0F17] text-slate-300 font-sans p-6"
      >
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium">Connecting to application preview...</p>
      </div>
    );
  }

  if (!isProjectMatch) {
    return (
      <div 
        data-testid="preview-offline-state"
        className="flex flex-col items-center justify-center min-h-screen bg-[#0B0F17] text-slate-400 font-sans p-6 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4 text-amber-400 text-xl font-bold">
          !
        </div>
        <h1 className="text-lg font-semibold text-slate-200 mb-2">Project Isolation Guard</h1>
        <p className="text-sm max-w-md text-slate-400 mb-4">
          This preview tab was opened for project <span className="font-mono text-violet-400 font-semibold">{targetProjectId}</span>, but the currently active project runtime in SnapDeploy is <span className="font-mono text-violet-400 font-semibold">{session?.projectId || 'none'}</span>.
        </p>
        <p className="text-xs text-slate-500">
          To view this project, activate it in SnapDeploy IDE or start its development server.
        </p>
      </div>
    );
  }

  if (!isReady || !session?.previewUrl) {
    return (
      <div 
        data-testid="preview-offline-state"
        className="flex flex-col items-center justify-center min-h-screen bg-[#0B0F17] text-slate-400 font-sans p-6 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center mb-4 text-slate-400 text-xl font-bold">
          ⚡
        </div>
        <h1 className="text-lg font-semibold text-slate-200 mb-2">Application Offline</h1>
        <p className="text-sm max-w-md text-slate-400 mb-4">
          The development server for project <span className="font-mono text-violet-400 font-semibold">{targetProjectId || 'active'}</span> is currently offline or stopped.
        </p>
        <p className="text-xs text-slate-500">
          Start the development server in the SnapDeploy workspace to resume live preview.
        </p>
      </div>
    );
  }

  // Active Running Application Preview (Zero IDE chrome, zero form shim, native full-viewport application)
  return (
    <div className="w-screen h-screen overflow-hidden bg-white m-0 p-0">
      <iframe
        ref={iframeRef}
        src={session.previewUrl}
        data-testid="standalone-preview-iframe"
        className="w-full h-full border-0 block bg-white"
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
        title="SnapDeploy Standalone Application Preview"
      />
    </div>
  );
};
