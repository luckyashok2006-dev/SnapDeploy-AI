import React, { useState } from 'react';
import { Database, Key, Shield, ExternalLink } from 'lucide-react';
import { EnvironmentVariablesManager } from '../env/EnvironmentVariablesManager';
import { DatabaseManager } from '../database/DatabaseManager';
import { AuthManager } from '../auth/AuthManager';
import { useEnvVarStore } from '../../store/envVarStore';
import { useDatabaseStore } from '../../store/databaseStore';
import { useAuthStore } from '../../store/authStore';

interface DataManagerPanelProps {
  projectId: string;
  projectTitle: string;
  initialSubTab?: 'env' | 'database' | 'auth';
}

export const DataManagerPanel: React.FC<DataManagerPanelProps> = ({
  projectId,
  projectTitle,
  initialSubTab = 'env'
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'env' | 'database' | 'auth'>(initialSubTab);

  const envVarCount = useEnvVarStore((s) => s.envVarMetadata[projectId]?.length || 0);
  const dbStatus = useDatabaseStore((s) => s.projectDatabaseMetadata[projectId]?.status || 'unconfigured');
  const authStatus = useAuthStore((s) => s.projectAuthMetadata[projectId]?.status || 'unconfigured');

  return (
    <div className="h-full flex flex-col bg-[#0B0F17] select-none overflow-hidden">
      {/* Header with Sub-Tabs */}
      <div className="h-11 px-3 border-b border-white/5 flex items-center justify-between bg-slate-950/60 shrink-0 gap-2">
        <div role="tablist" aria-label="Data workspace views" className="flex items-center gap-1 overflow-x-auto min-w-0">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'env'}
            data-testid="data-tab-env"
            onClick={() => setActiveSubTab('env')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeSubTab === 'env'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>Environment</span>
            {envVarCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-300">
                {envVarCount}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'database'}
            data-testid="data-tab-database"
            onClick={() => setActiveSubTab('database')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeSubTab === 'database'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span>Database</span>
            {dbStatus === 'connected' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'auth'}
            data-testid="data-tab-auth"
            onClick={() => setActiveSubTab('auth')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeSubTab === 'auth'
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-violet-400" />
            <span>Auth</span>
            {authStatus === 'configured' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* Body Area */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeSubTab === 'env' && (
          <EnvironmentVariablesManager projectId={projectId} mode="standalone" />
        )}
        {activeSubTab === 'database' && (
          <DatabaseManager projectId={projectId} />
        )}
        {activeSubTab === 'auth' && (
          <AuthManager projectId={projectId} />
        )}
      </div>
    </div>
  );
};
