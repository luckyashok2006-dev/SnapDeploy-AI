import React from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { StandalonePreview } from './components/preview/StandalonePreview';

export default function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  // Defensive WebContainer popup connection endpoint
  if (pathname.startsWith('/webcontainer/connect')) {
    import('@webcontainer/api/connect').then(({ setupConnect }) => {
      try {
        setupConnect();
      } catch (err) {
        console.warn('[WebContainer Connect] Handshake notice:', err);
      }
    });
    return (
      <div className="flex items-center justify-center h-screen bg-[#0B0F17] text-slate-400 font-mono text-xs">
        Connecting to WebContainer session...
      </div>
    );
  }

  // Dedicated first-party standalone preview route
  if (pathname === '/preview' || pathname.startsWith('/preview/')) {
    return <StandalonePreview />;
  }

  return <AppLayout />;
}
