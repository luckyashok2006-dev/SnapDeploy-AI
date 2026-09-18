import React, { useState } from 'react';
import {
  Lock,
  Globe,
  Eye,
  EyeOff,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  FileCode,
  Upload,
  Download,
  ShieldAlert,
  Info
} from 'lucide-react';
import { useEnvVarStore } from '../../store/envVarStore';
import { isViteClientVariable, validateEnvVarKey, normalizeEnvKey } from '../../features/deployment/security/secret-sanitizer';
import { saveAs } from 'file-saver';

interface EnvironmentVariablesManagerProps {
  projectId: string;
  mode?: 'standalone' | 'embedded';
}

const EMPTY_METADATA: any[] = [];

export const EnvironmentVariablesManager: React.FC<EnvironmentVariablesManagerProps> = ({
  projectId,
  mode = 'standalone'
}) => {
  const metadata = useEnvVarStore((s) => s.envVarMetadata[projectId] || EMPTY_METADATA);
  const setEnvVar = useEnvVarStore((s) => s.setEnvVar);
  const removeEnvVar = useEnvVarStore((s) => s.removeEnvVar);
  const getProjectSecretValue = useEnvVarStore((s) => s.getProjectSecretValue);
  const clearProjectEnvVars = useEnvVarStore((s) => s.clearProjectEnvVars);
  const importEnvString = useEnvVarStore((s) => s.importEnvString);
  const exportEnvExampleTemplate = useEnvVarStore((s) => s.exportEnvExampleTemplate);

  // Form State
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [showFormValue, setShowFormValue] = useState(false);

  // Per-variable revealed state: Record<varKey, boolean>
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  // Per-variable copy feedback: Record<varKey, boolean>
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Manual .env Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importSummary, setImportSummary] = useState<string | null>(null);

  // Calculate dynamic classification
  const trimmedKey = newKey.trim();
  const isViteVar = isViteClientVariable(trimmedKey);
  const publicCount = metadata.filter((m) => m.isClientVisible).length;
  const secretCount = metadata.filter((m) => m.isSecret).length;

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validateEnvVarKey(newKey);
    if (!validation.valid) {
      setFormError(validation.error || 'Invalid variable key.');
      return;
    }

    const normKey = normalizeEnvKey(newKey);
    const existing = metadata.find((m) => normalizeEnvKey(m.key) === normKey);
    if (existing) {
      setFormError(`An environment variable named "${normKey}" already exists.`);
      return;
    }

    const res = setEnvVar(projectId, newKey, newValue, !isViteVar, newDesc.trim() || undefined);
    if (!res.success) {
      setFormError(res.error || 'Failed to save variable.');
      return;
    }

    setNewKey('');
    setNewValue('');
    setNewDesc('');
    setShowFormValue(false);
  };

  const toggleRevealSecret = (key: string) => {
    setRevealedKeys((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleCopyValue = async (key: string, isSecret: boolean) => {
    const val = isSecret ? (getProjectSecretValue(projectId, key) || '') : (getProjectSecretValue(projectId, key) || '');
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Clipboard error fallback
    }
  };

  const handleExportTemplate = () => {
    const templateContent = exportEnvExampleTemplate(projectId);
    const blob = new Blob([templateContent], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, '.env.example');
  };

  const handleImportSubmit = () => {
    if (!importText.trim()) return;
    const res = importEnvString(projectId, importText);
    setImportSummary(
      `Imported ${res.successCount} variable(s). Ignored ${res.ignoredCount} line(s).${
        res.errors.length > 0 ? ` Errors: ${res.errors.join('; ')}` : ''
      }`
    );
    if (res.successCount > 0) {
      setImportText('');
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportSummary(null);
      }, 1500);
    }
  };

  return (
    <div className="space-y-5 select-none" data-testid="env-var-manager">
      {/* Security Banner */}
      <div className="p-3.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-200 leading-relaxed space-y-1">
        <div className="font-semibold flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-violet-400" />
            <span>Environment Variable & Secrets Security Model</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-600/30 text-violet-300 border border-violet-500/30">
            Memory-Only Secrets
          </span>
        </div>
        <p className="text-[11px] text-violet-300/90 leading-normal">
          Variables starting with <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-violet-200">VITE_*</code> are bundled into client-side code and are public. All other variables are treated as runtime secrets, held strictly in memory, and <strong>NEVER</strong> written to disk, VFS, Version History, or local build files.
        </p>
      </div>

      {/* Summary Stat Counters & Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/40 border border-white/5 text-xs">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <div>
            <span className="text-slate-500 text-[10px] uppercase font-semibold tracking-wider block">Total</span>
            <span className="font-mono font-bold text-slate-200 text-sm">{metadata.length}</span>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div>
            <span className="text-blue-400 text-[10px] uppercase font-semibold tracking-wider block">Public (Vite)</span>
            <span className="font-mono font-bold text-blue-300 text-sm">{publicCount}</span>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div>
            <span className="text-amber-400 text-[10px] uppercase font-semibold tracking-wider block">Runtime Secrets</span>
            <span className="font-mono font-bold text-amber-300 text-sm">{secretCount}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs font-medium border border-white/5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            title="Import variables from .env text"
            data-testid="import-env-btn"
          >
            <Upload className="w-3 h-3 text-slate-400" />
            <span>Import .env</span>
          </button>
          <button
            type="button"
            onClick={handleExportTemplate}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition text-xs font-medium border border-white/5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            title="Download safe .env.example template (no secret values)"
            data-testid="export-env-example-btn"
          >
            <Download className="w-3 h-3 text-slate-400" />
            <span>.env.example</span>
          </button>
        </div>
      </div>

      {/* Manual .env Import Dialog */}
      {isImportModalOpen && (
        <div className="p-4 rounded-xl bg-slate-900 border border-violet-500/40 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
            <span className="flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-violet-400" />
              <span>Import Variables from .env</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setIsImportModalOpen(false);
                setImportSummary(null);
              }}
              className="text-slate-400 hover:text-white"
            >
              &times;
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Paste key-value pairs (e.g. <code>KEY=value</code>). Comments (#) and blank lines are ignored. Parsed secret values enter memory-only storage directly.
          </p>
          <textarea
            rows={4}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'VITE_API_URL=https://api.example.com\nDATABASE_URL=postgres://...\nSTRIPE_SECRET_KEY=sk_test_...'}
            className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-violet-500"
            data-testid="import-env-textarea"
          />
          {importSummary && (
            <div className="text-[11px] font-mono text-emerald-300 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
              {importSummary}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(false)}
              className="px-3 py-1 text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImportSubmit}
              disabled={!importText.trim()}
              className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
              data-testid="confirm-import-env-btn"
            >
              Import Variables
            </button>
          </div>
        </div>
      )}

      {/* Add Variable Form */}
      <form
        onSubmit={handleAddSubmit}
        className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3"
      >
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
          <span>Add Environment Variable</span>
          {trimmedKey && (
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                isViteVar
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
            >
              {isViteVar ? 'Public (Client Bundle)' : 'Provider Secret (Runtime)'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            type="text"
            placeholder="KEY (e.g. VITE_API_URL or DB_PASS)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-violet-500 uppercase"
            data-testid="env-key-input"
          />
          <div className="relative">
            <input
              type={showFormValue ? 'text' : 'password'}
              placeholder="VALUE"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-violet-500 pr-8"
              data-testid="env-value-input"
            />
            <button
              type="button"
              onClick={() => setShowFormValue(!showFormValue)}
              className="absolute right-2 top-2.5 text-slate-500 hover:text-slate-300 transition"
              title={showFormValue ? 'Hide value' : 'Show value'}
            >
              {showFormValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <input
          type="text"
          placeholder="Optional description (e.g. Production database connection string)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500"
          data-testid="env-desc-input"
        />

        {formError && (
          <div className="text-xs text-rose-400 flex items-center gap-1.5" data-testid="env-error-msg">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-slate-500">
            {isViteVar
              ? 'VITE_* variables are bundled into client code and visible in the browser.'
              : 'Sensitive runtime secrets are held memory-only and never saved to disk.'}
          </span>
          <button
            type="submit"
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold transition"
            data-testid="add-env-btn"
          >
            Add Variable
          </button>
        </div>
      </form>

      {/* Configured Variables List */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
          <span>Configured Variables ({metadata.length})</span>
          {metadata.length > 0 && (
            <button
              type="button"
              onClick={() => clearProjectEnvVars(projectId)}
              className="text-[10px] text-slate-500 hover:text-rose-400 transition"
              title="Purge all memory secrets and variable metadata for this project"
              data-testid="clear-all-env-btn"
            >
              Clear All
            </button>
          )}
        </div>

        {metadata.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-xl space-y-1">
            <p className="font-medium text-slate-400">No environment variables configured</p>
            <p className="text-[11px]">Add project configuration or runtime secrets above.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5 border border-white/10 rounded-xl overflow-hidden bg-slate-900/40">
            {metadata.map((item) => {
              const isRevealed = Boolean(revealedKeys[item.key]);
              const secretVal = getProjectSecretValue(projectId, item.key);
              const hasSecret = Boolean(secretVal && secretVal.length > 0);
              const displayVal = item.isSecret
                ? (isRevealed ? (secretVal || '(empty)') : (hasSecret ? '••••••••••••' : '(empty)'))
                : (secretVal || '(empty)');

              return (
                <div
                  key={item.id}
                  className="p-3 flex items-center justify-between text-xs gap-3"
                  data-testid={`env-row-${item.key}`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-slate-200">{item.key}</span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                          item.isClientVisible
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {item.isClientVisible ? 'Public (Vite Bundle)' : 'Provider Secret'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-400 text-[11px] truncate max-w-[160px] sm:max-w-[280px]" data-testid={`env-val-${item.key}`}>
                        {displayVal}
                      </span>

                      {item.isSecret && (
                        <button
                          type="button"
                          onClick={() => toggleRevealSecret(item.key)}
                          className="text-slate-500 hover:text-slate-300 transition p-0.5"
                          title={isRevealed ? 'Hide secret' : 'Reveal secret'}
                          data-testid={`reveal-secret-${item.key}`}
                        >
                          {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleCopyValue(item.key, item.isSecret)}
                        className="text-slate-500 hover:text-slate-300 transition p-0.5"
                        title="Copy variable value to clipboard"
                        data-testid={`copy-secret-${item.key}`}
                      >
                        {copiedKey === item.key ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {item.description && (
                      <p className="text-[10px] text-slate-500 truncate">{item.description}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeEnvVar(projectId, item.id)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition rounded-md hover:bg-white/5 shrink-0"
                    title={`Delete ${item.key}`}
                    data-testid={`delete-env-${item.key}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
