import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

import { shouldAttachTestHooks } from './lib/test-hooks';
export { shouldAttachTestHooks } from './lib/test-hooks';

const currentEnv = {
  DEV: import.meta.env?.DEV,
  MODE: import.meta.env?.MODE,
  NODE_ENV: typeof process !== 'undefined' && process.env ? process.env.NODE_ENV : undefined
};

if (typeof window !== 'undefined' && shouldAttachTestHooks(currentEnv)) {
  import('./store/projectStore').then((m) => { (window as any).useProjectStore = m.useProjectStore; });
  import('./store/chatStore').then((m) => { (window as any).useChatStore = m.useChatStore; });
  import('./store/repairStore').then((m) => { (window as any).useRepairStore = m.useRepairStore; });
  import('./store/runtimeStore').then((m) => { (window as any).useRuntimeStore = m.useRuntimeStore; });
  import('./store/agentStore').then((m) => { (window as any).useAgentStore = m.useAgentStore; });
  import('./store/previewStore').then((m) => { (window as any).usePreviewStore = m.usePreviewStore; });
  import('./store/editorStore').then((m) => { (window as any).useEditorStore = m.useEditorStore; });
  import('./lib/editor/editor-boundary').then((m) => { (window as any).resetEditorBoundary = m.resetEditorBoundary; });
  import('./features/verification/VerificationService').then((m) => { (window as any).verificationService = m.verificationService; });
  import('./lib/runtime/runtime-manager').then((m) => { (window as any).runtimeManager = m.runtimeManager; });
  import('./features/repair/repair-loop').then((m) => { (window as any).repairLoopEngine = m.repairLoopEngine; });
}
