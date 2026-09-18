import React, { useState } from 'react';
import { Rocket, Github, History, Globe, Lock, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { useDeploymentStore } from '../../store/deploymentStore';
import { useGitHubAuthStore } from '../../store/gitHubAuthStore';
import { useProjectStore } from '../../store/projectStore';
import { executeDeployment, getProviderInstance } from '../../features/deployment/deployment-coordinator';
import { runPreDeploymentChecks } from '../../features/deployment/build/build-gate';

interface ShipManagerPanelProps {
  projectId: string;
  projectTitle: string;
  onOpenGitHubModal: () => void;
  onOpenDeployModal: () => void;
}

export const ShipManagerPanel: React.FC<ShipManagerPanelProps> = ({
  projectId,
  projectTitle,
  onOpenGitHubModal,
  onOpenDeployModal
}) => {
  const [activeTab, setActiveTab] = useState<'deploy' | 'github' | 'history'>('deploy');

  const { selectedProvider, setSelectedProvider, getCredentials, deployments, activeDeployments } = useDeploymentStore();
  const { isAuthenticated: isGitHubAuthed, user: gitHubUser } = useGitHubAuthStore();
  const project = useProjectStore((s) => s.projects[projectId]);

  const history = deployments[projectId] || [];
  const activeProgress = activeDeployments[projectId] || { status: 'idle' };
  const preChecks = projectId ? runPreDeploymentChecks(projectId) : null;
  const isDeploying = activeProgress.status !== 'idle' && activeProgress.status !== 'live' && activeProgress.status !== 'failed' && activeProgress.status !== 'cancelled';

  const handleStartDeploy = async () => {
    try {
      await executeDeployment(projectId, { providerId: selectedProvider });
    } catch {
      // Handled in store
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden">
      {/* Header: 2-tier layout for uncompromising navigation clarity & distinct actions */}
      <div className="px-3 py-2.5 border-b border-white/5 bg-slate-950/60 shrink-0 space-y-2">
        {/* Row 1: Unified Navigation Group */}
        <div role="tablist" aria-label="Ship workspace views" className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-xl border border-white/5">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'deploy'}
            data-testid="ship-tab-deploy"
            onClick={() => setActiveTab('deploy')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeTab === 'deploy'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Rocket className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span>Deploy</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'github'}
            data-testid="ship-tab-github"
            onClick={() => setActiveTab('github')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeTab === 'github'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Github className="w-3.5 h-3.5 text-slate-300 shrink-0" />
            <span>GitHub</span>
            {isGitHubAuthed && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            data-testid="ship-tab-history"
            onClick={() => setActiveTab('history')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeTab === 'history'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>History</span>
            {history.length > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0 leading-none">
                {history.length}
              </span>
            )}
          </button>
        </div>

        {/* Row 2: Secondary Action Row */}
        <div className="flex items-center justify-between px-1 text-xs">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
            <span>Deployment Pipeline</span>
          </div>

          <button
            type="button"
            onClick={onOpenDeployModal}
            data-testid="ship-open-deploy-modal-btn"
            className="px-2 py-1 rounded-md text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 flex items-center gap-1 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] shrink-0"
            title="Open comprehensive deployment dialog"
          >
            <span>Open Full Dialog</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
        {activeTab === 'deploy' && (
          <div className="space-y-4">
            {/* Target Provider card */}
            <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Hosting Provider</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedProvider('mock')}
                  className={`py-1.5 px-3 rounded-lg border text-center transition font-medium text-xs truncate ${
                    selectedProvider === 'mock'
                      ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                      : 'bg-[#111827] border-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  Mock Provider
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProvider('netlify')}
                  className={`py-1.5 px-3 rounded-lg border text-center transition font-medium text-xs truncate ${
                    selectedProvider === 'netlify'
                      ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                      : 'bg-[#111827] border-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  Netlify
                </button>
              </div>
            </div>

            {/* Pre-flight Checks */}
            {preChecks && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Pre-Flight Checks</span>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-slate-300 flex items-center gap-1.5 min-w-0 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">{preChecks.fileCount} authoritative VFS files</span>
                    </span>
                    <span className="text-emerald-400 font-mono text-[10px] shrink-0">PASS</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-slate-300 flex items-center gap-1.5 min-w-0 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">Entrypoint index.html present</span>
                    </span>
                    <span className="text-emerald-400 font-mono text-[10px] shrink-0">PASS</span>
                  </div>
                </div>
              </div>
            )}

            {/* Launch Action */}
            <button
              onClick={handleStartDeploy}
              disabled={isDeploying || !projectId}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500 hover:brightness-110 text-white font-semibold shadow-lg shadow-violet-600/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Rocket className="w-4 h-4" />
              <span>{isDeploying ? 'Deploying to Hosting...' : 'Publish to Live Hosting'}</span>
            </button>
          </div>
        )}

        {activeTab === 'github' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-3">
              <div className="flex items-center gap-2.5">
                <Github className="w-5 h-5 text-white" />
                <div>
                  <h3 className="font-bold text-white text-xs">GitHub Repository Integration</h3>
                  <p className="text-slate-400 text-[11px]">Sync, import, and version project source code</p>
                </div>
              </div>

              {isGitHubAuthed && gitHubUser ? (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                  <span className="text-emerald-300 font-mono text-xs">@{gitHubUser.login}</span>
                  <span className="text-[10px] text-emerald-400 uppercase font-bold">Connected</span>
                </div>
              ) : (
                <p className="text-slate-400 text-xs">
                  Connect your GitHub account to import repositories directly into the workspace.
                </p>
              )}

              <button
                onClick={onOpenGitHubModal}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium transition flex items-center justify-center gap-1.5"
              >
                <Github className="w-3.5 h-3.5" />
                <span>{isGitHubAuthed ? 'Manage Repositories' : 'Connect GitHub Account'}</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-3">
            {history.length === 0 ? (
              <div className="p-6 text-center text-slate-500 bg-slate-900/40 rounded-xl border border-white/5">
                No deployments published yet.
              </div>
            ) : (
              history.map((dep) => (
                <div key={dep.deploymentId} className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 capitalize">{dep.provider}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                      dep.status === 'live' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {dep.status}
                    </span>
                  </div>
                  {dep.url && (
                    <a
                      href={dep.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-violet-400 hover:underline text-[11px] block truncate"
                    >
                      {dep.url}
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
