import React, { useState, useEffect } from 'react';
import {
  Rocket,
  X,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Globe,
  Clock,
  History,
  Trash2,
  Eye,
  EyeOff,
  LogOut
} from 'lucide-react';
import { useDeploymentStore } from '../../store/deploymentStore';
import { useProjectStore } from '../../store/projectStore';
import { useEnvVarStore } from '../../store/envVarStore';
import { runPreDeploymentChecks } from '../../features/deployment/build/build-gate';
import { executeDeployment, getProviderInstance } from '../../features/deployment/deployment-coordinator';
import { DeploymentProviderId } from '../../types/workspace';
import { EnvironmentVariablesManager } from '../env/EnvironmentVariablesManager';

interface DeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

const EMPTY_DEPLOYMENTS: any[] = [];
const DEFAULT_PROGRESS = { status: 'idle' as const };

export const DeploymentModal: React.FC<DeploymentModalProps> = ({
  isOpen,
  onClose,
  projectId
}) => {
  const [activeTab, setActiveTab] = useState<'deploy' | 'env' | 'history'>('deploy');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Copy URL state
  const [copiedUrl, setCopiedUrl] = useState(false);

  const selectedProvider = useDeploymentStore((s) => s.selectedProvider);
  const setSelectedProvider = useDeploymentStore((s) => s.setSelectedProvider);
  const setCredentials = useDeploymentStore((s) => s.setCredentials);
  const disconnect = useDeploymentStore((s) => s.disconnect);
  const getCredentials = useDeploymentStore((s) => s.getCredentials);
  const cancelActiveDeployment = useDeploymentStore((s) => s.cancelActiveDeployment);

  const envVarCount = useEnvVarStore((s) => s.envVarMetadata[projectId]?.length || 0);
  const projectHistory = useDeploymentStore((s) => s.deployments[projectId] || EMPTY_DEPLOYMENTS);
  const activeProgress = useDeploymentStore((s) => s.activeDeployments[projectId] || DEFAULT_PROGRESS);

  const project = useProjectStore((s) => s.projects[projectId]);

  const provider = getProviderInstance(selectedProvider);
  const isAuthenticated = selectedProvider === 'mock' || !!getCredentials(selectedProvider);

  // Pre-deployment checklist
  const preChecks = isOpen && projectId ? runPreDeploymentChecks(projectId) : null;

  // Handle provider token connect
  const handleConnectProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setTokenError('Please enter a valid Personal Access Token.');
      return;
    }

    setIsAuthenticating(true);
    setTokenError(null);
    try {
      await provider.authenticate(tokenInput.trim());
      setCredentials(selectedProvider, tokenInput.trim());
      setTokenInput('');
    } catch (err: any) {
      setTokenError(err?.message || 'Authentication failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Handle start deploy / redeploy
  const handleStartDeploy = async () => {
    try {
      await executeDeployment(projectId, { providerId: selectedProvider });
    } catch {
      // Error handled and rendered via store
    }
  };

  // Handle copy live url
  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (!isOpen || !project) return null;

  const isDeploying =
    activeProgress.status === 'validating' ||
    activeProgress.status === 'building' ||
    activeProgress.status === 'packaging' ||
    activeProgress.status === 'uploading' ||
    activeProgress.status === 'deploying';

  const latestLiveDeploy = projectHistory.find((d) => d.status === 'live');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deploy Project"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn select-none"
      data-testid="deployment-modal"
    >
      <div className="relative w-full max-w-2xl bg-[#0F172A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#1E293B]/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">Deploy Project</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-medium border border-violet-500/30">
                  {project.title}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Package and publish authoritative VFS files to a live hosting environment
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Provider Switcher */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-white/10 rounded-xl text-xs">
              <button
                onClick={() => setSelectedProvider('mock')}
                className={`px-2.5 py-1 rounded-lg transition font-medium ${
                  selectedProvider === 'mock'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Use deterministic mock provider for testing and offline development"
                data-testid="select-provider-mock"
              >
                Mock Provider
              </button>
              <button
                onClick={() => setSelectedProvider('netlify')}
                className={`px-2.5 py-1 rounded-lg transition font-medium ${
                  selectedProvider === 'netlify'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Direct deployment to Netlify"
                data-testid="select-provider-netlify"
              >
                Netlify
              </button>
            </div>

            <button
              onClick={onClose}
              disabled={isDeploying}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition disabled:opacity-50"
              data-testid="deploy-close-btn"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 border-b border-white/5 bg-[#111827]/60 text-xs font-medium shrink-0">
          <button
            onClick={() => setActiveTab('deploy')}
            className={`py-3 px-3 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'deploy'
                ? 'border-violet-500 text-violet-300 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
            data-testid="tab-deploy"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Deploy</span>
          </button>
          <button
            onClick={() => setActiveTab('env')}
            className={`py-3 px-3 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'env'
                ? 'border-violet-500 text-violet-300 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
            data-testid="tab-env"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Environment Variables ({envVarCount})</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-3 border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-violet-500 text-violet-300 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
            data-testid="tab-history"
          >
            <History className="w-3.5 h-3.5" />
            <span>Deployment History ({projectHistory.length})</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-sm text-slate-300">
          {/* TAB 1: DEPLOY */}
          {activeTab === 'deploy' && (
            <div className="space-y-5">
              {/* Unauthenticated Netlify Connector */}
              {!isAuthenticated && selectedProvider === 'netlify' && (
                <form
                  onSubmit={handleConnectProvider}
                  className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Lock className="w-3.5 h-3.5 text-violet-400" />
                    <span>Connect Netlify Account</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Enter a Netlify Personal Access Token to deploy directly from your browser. Tokens remain memory-only and are never saved to disk or VFS.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder="nfp_..."
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-violet-500"
                      data-testid="deploy-token-input"
                    />
                    <button
                      type="submit"
                      disabled={isAuthenticating}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                      data-testid="connect-provider-btn"
                    >
                      {isAuthenticating ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                  {tokenError && (
                    <div className="text-xs text-rose-400 flex items-center gap-1.5 mt-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{tokenError}</span>
                    </div>
                  )}
                </form>
              )}

              {/* Connected Provider Status Badge */}
              {isAuthenticated && selectedProvider === 'netlify' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/40 border border-white/5 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-medium text-slate-200">Connected to Netlify</span>
                    <span className="text-slate-500 font-mono">(Memory-only session)</span>
                  </div>
                  <button
                    onClick={() => disconnect('netlify')}
                    className="flex items-center gap-1 text-slate-400 hover:text-rose-400 transition"
                    title="Disconnect Netlify token"
                    data-testid="deploy-disconnect-btn"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>Disconnect</span>
                  </button>
                </div>
              )}

              {/* Pre-Deployment Status Card */}
              {preChecks && (
                <div className="p-4 rounded-xl bg-slate-900/40 border border-white/5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Pre-Deployment Status</span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                        preChecks.canDeploy
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {preChecks.canDeploy ? 'Ready to Deploy' : 'Blocked'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-black/20 border border-white/5">
                      <span className="text-[10px] text-slate-500 block">Framework</span>
                      <span className="font-medium text-slate-200 uppercase">{preChecks.framework}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/20 border border-white/5">
                      <span className="text-[10px] text-slate-500 block">Build Gate</span>
                      <span className="font-medium text-slate-200">
                        {preChecks.requiresBuild ? 'npm run build' : 'None (Static)'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/20 border border-white/5">
                      <span className="text-[10px] text-slate-500 block">Source Files</span>
                      <span className="font-medium text-slate-200">{preChecks.fileCount} files</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Live Deployment Banner if project is live */}
              {latestLiveDeploy && (
                <div
                  className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5"
                  data-testid="deployment-live-banner"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-300">Application is Live</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Deployed {new Date(latestLiveDeploy.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between bg-black/30 p-2.5 rounded-lg border border-emerald-500/20">
                    <a
                      href={latestLiveDeploy.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-emerald-300 hover:text-emerald-200 hover:underline truncate mr-2"
                      data-testid="deployment-live-url"
                    >
                      {latestLiveDeploy.url}
                    </a>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => latestLiveDeploy.url && handleCopyUrl(latestLiveDeploy.url)}
                        className="p-1 text-slate-400 hover:text-white rounded transition"
                        title="Copy Live URL"
                        data-testid="copy-live-url-btn"
                      >
                        {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <a
                        href={latestLiveDeploy.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-slate-400 hover:text-white rounded transition"
                        title="Open Site in New Tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* In-Progress Stepper */}
              {isDeploying && (
                <div
                  className="p-4 rounded-xl bg-violet-600/10 border border-violet-500/30 space-y-3"
                  data-testid="deployment-progress-stepper"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-violet-400 animate-spin" />
                      <span className="text-xs font-semibold text-violet-300">
                        {activeProgress.progressStage || 'Deploying...'}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-violet-300">{activeProgress.percent || 0}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
                      style={{ width: `${activeProgress.percent || 10}%` }}
                    />
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => cancelActiveDeployment(projectId)}
                      className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-medium transition"
                      data-testid="cancel-deploy-btn"
                    >
                      Cancel Deployment
                    </button>
                  </div>
                </div>
              )}

              {/* Error Banner */}
              {activeProgress.status === 'failed' && activeProgress.error && (
                <div
                  className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
                  data-testid="deployment-error-banner"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold">Deployment Failed</div>
                    <p className="font-mono text-[11px] leading-relaxed">{activeProgress.error}</p>
                  </div>
                </div>
              )}

              {/* Main Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isDeploying}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 transition disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleStartDeploy}
                  disabled={isDeploying || !preChecks?.canDeploy || !isAuthenticated}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-110 text-white font-semibold text-xs shadow-lg shadow-violet-600/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid={latestLiveDeploy ? 'redeploy-btn' : 'start-deploy-btn'}
                >
                  {isDeploying ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{activeProgress.progressStage || 'Deploying...'}</span>
                    </>
                  ) : latestLiveDeploy ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Redeploy Application</span>
                    </>
                  ) : (
                    <>
                      <Rocket className="w-3.5 h-3.5" />
                      <span>Deploy to {provider.name}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: ENVIRONMENT VARIABLES */}
          {activeTab === 'env' && (
            <EnvironmentVariablesManager projectId={projectId} mode="embedded" />
          )}

          {/* TAB 3: DEPLOYMENT HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-3" data-testid="deployment-history-list">
              <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
                <span>Deployments ({projectHistory.length})</span>
                <span className="text-[10px] text-slate-500 font-mono">Metadata-only storage</span>
              </div>
              {projectHistory.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-xl">
                  No deployments recorded yet for this project.
                </div>
              ) : (
                <div className="space-y-2">
                  {projectHistory.map((rec) => (
                    <div
                      key={rec.deploymentId}
                      className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2"
                      data-testid={`history-item-${rec.deploymentId}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                              rec.status === 'live'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : rec.status === 'failed'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {rec.status.toUpperCase()}
                          </span>
                          <span className="font-medium text-slate-200">{rec.commitSummary || 'Deployment'}</span>
                          <span className="text-slate-500">&bull;</span>
                          <span className="text-slate-400 font-mono text-[11px] capitalize">{rec.provider}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(rec.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1 border-t border-white/5">
                        <div className="flex items-center gap-3">
                          <span>{(rec.durationMs / 1000).toFixed(1)}s total</span>
                          {rec.fileCount > 0 && <span>{rec.fileCount} files</span>}
                          {rec.artifactSizeBytes > 0 && <span>{(rec.artifactSizeBytes / 1024).toFixed(1)} KB</span>}
                        </div>
                        {rec.url && (
                          <a
                            href={rec.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-violet-400 hover:text-violet-300 flex items-center gap-1"
                          >
                            <span>Open URL</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      {rec.errorMessage && (
                        <div className="text-[11px] text-rose-400 font-mono bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                          {rec.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
