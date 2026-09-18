import React, { useState, useEffect } from 'react';
import {
  Database,
  Server,
  Layers,
  History,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Key,
  Eye,
  EyeOff,
  Trash2,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  Clock,
  Activity
} from 'lucide-react';
import { useDatabaseStore } from '../../store/databaseStore';
import { databaseCoordinator } from '../../features/database/database-coordinator';
import {
  DatabaseProviderId,
  AllowedColumnType,
  TableColumn,
  TableSchema,
  SafeMigrationRequest
} from '../../types/database';

interface DatabaseManagerProps {
  projectId: string;
}

const EMPTY_SCHEMAS: TableSchema[] = [];
const EMPTY_MIGRATIONS: any[] = [];

export const DatabaseManager: React.FC<DatabaseManagerProps> = ({ projectId }) => {
  const metadata = useDatabaseStore((s) => s.projectDatabaseMetadata[projectId]);
  const schemas = useDatabaseStore((s) => s.projectSchemas[projectId] || EMPTY_SCHEMAS);
  const migrations = useDatabaseStore((s) => s.projectMigrationHistory[projectId] || EMPTY_MIGRATIONS);
  const reconciliation = useDatabaseStore((s) => s.projectReconciliationStatus[projectId]);

  // Tab State
  const [activeTab, setActiveTab] = useState<'schema' | 'connect' | 'migrations'>('schema');

  // Connection Form State
  const [providerId, setProviderId] = useState<DatabaseProviderId>(metadata?.providerId || 'mock');
  const [endpoint, setEndpoint] = useState<string>(
    metadata?.endpoint || (providerId === 'mock' ? 'http://localhost:5432/testdb' : 'https://xyz.supabase.co')
  );
  const [databaseName, setDatabaseName] = useState<string>(metadata?.databaseName || 'production_db');
  const [anonKey, setAnonKey] = useState<string>('');
  const [serviceKey, setServiceKey] = useState<string>('');
  const [showServiceKey, setShowServiceKey] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  // Schema Table Creator State
  const [isCreatingTable, setIsCreatingTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newColumns, setNewColumns] = useState<TableColumn[]>([
    { name: 'id', type: 'uuid', isPrimary: true, isNullable: false }
  ]);
  const [colName, setColName] = useState('');
  const [colType, setColType] = useState<AllowedColumnType>('text');
  const [colIsPrimary, setColIsPrimary] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  // Reconciliation State
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

  const isConnected = metadata?.status === 'connected';
  const hasUnknownMigration = migrations.some((m) => m.status === 'unknown');
  const needsReconciliation = hasUnknownMigration || (reconciliation && !reconciliation.inSync);

  // Keep endpoint default sensible when provider changes
  const handleProviderChange = (newProvider: DatabaseProviderId) => {
    setProviderId(newProvider);
    if (newProvider === 'mock') {
      setEndpoint('http://localhost:5432/testdb');
      setDatabaseName('mock_test_db');
    } else {
      setEndpoint('https://xyz.supabase.co');
      setDatabaseName('postgres');
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true);
    setConnError(null);

    try {
      await databaseCoordinator.connectDatabase(
        projectId,
        {
          providerId,
          endpoint: endpoint.trim(),
          databaseName: databaseName.trim()
        },
        {
          apiKey: anonKey.trim() || undefined,
          serviceKey: serviceKey.trim() || undefined
        }
      );
      setActiveTab('schema');
    } catch (err: any) {
      setConnError(err?.message || 'Failed to connect to database provider.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsConnecting(true);
    try {
      await databaseCoordinator.disconnectDatabase(projectId);
      setActiveTab('connect');
    } catch (err: any) {
      setConnError(err?.message || 'Error disconnecting.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleReconcile = async () => {
    setIsReconciling(true);
    setReconcileResult(null);
    try {
      const res = await databaseCoordinator.reconcileSchema(projectId);
      setReconcileResult(
        `Reconciled: ${res.addedTables.length} new tables found, ${res.unknownMigrationsResolved} unknown migrations resolved.`
      );
    } catch (err: any) {
      setReconcileResult(`Reconciliation failed: ${err?.message || 'Error'}`);
    } finally {
      setIsReconciling(false);
    }
  };

  const handleAddColumn = () => {
    const trimmed = colName.trim().toLowerCase();
    if (!trimmed) return;
    if (newColumns.some((c) => c.name === trimmed)) return;

    setNewColumns((prev) => [
      ...prev,
      {
        name: trimmed,
        type: colType,
        isPrimary: colIsPrimary,
        isNullable: !colIsPrimary
      }
    ]);
    setColName('');
    setColType('text');
    setColIsPrimary(false);
  };

  const handleRemoveColumn = (name: string) => {
    setNewColumns((prev) => prev.filter((c) => c.name !== name));
  };

  const handleCreateTableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTableName = newTableName.trim().toLowerCase();
    if (!cleanTableName || newColumns.length === 0) return;

    setIsMigrating(true);
    setMigrationError(null);

    try {
      const migrationRequest: SafeMigrationRequest = {
        migrationId: `mig_${Date.now()}_create_${cleanTableName}`,
        projectId,
        title: `Create table ${cleanTableName}`,
        schemaVersion: (migrations.length || 0) + 1,
        operations: [
          {
            type: 'create_table',
            tableName: cleanTableName,
            columns: [...newColumns]
          }
        ]
      };

      await databaseCoordinator.executeSafeMigration(projectId, migrationRequest);
      setIsCreatingTable(false);
      setNewTableName('');
      setNewColumns([{ name: 'id', type: 'uuid', isPrimary: true, isNullable: false }]);
    } catch (err: any) {
      setMigrationError(err?.message || 'Failed to create table migration.');
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="flex flex-col space-y-5 text-slate-100">
      {/* Sub-Header Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
        <div role="tablist" aria-label="Database tabs" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'schema'}
            onClick={() => setActiveTab('schema')}
            data-testid="db-tab-schema"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeTab === 'schema'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Schema Explorer</span>
            {schemas.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
                {schemas.length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'migrations'}
            onClick={() => setActiveTab('migrations')}
            data-testid="db-tab-migrations"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeTab === 'migrations'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Migrations</span>
            {migrations.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
                {migrations.length}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'connect'}
            onClick={() => setActiveTab('connect')}
            data-testid="db-tab-connect"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0B0F17] ${
              activeTab === 'connect'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Connection</span>
          </button>
        </div>

        {/* Global Connection Pill */}
        <div className="flex items-center gap-2 shrink-0">
          {isConnected ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-medium"
              data-testid="db-status-connected"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Connected</span>
              <span className="text-emerald-500/60 font-mono">({metadata.providerId})</span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-white/5 text-slate-400 text-[11px]"
              data-testid="db-status-disconnected"
            >
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span>Disconnected</span>
            </div>
          )}
        </div>
      </div>

      {/* Out of Sync / Reconciliation Notice Banner */}
      {needsReconciliation && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Remote schema mutated, but local state unconfirmed. Reconcile on reconnect.
            </span>
          </div>
          <button
            type="button"
            onClick={handleReconcile}
            disabled={isReconciling}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[11px] font-semibold transition flex items-center gap-1 shrink-0 disabled:opacity-50"
            data-testid="db-reconcile-btn"
          >
            <RefreshCw className={`w-3 h-3 ${isReconciling ? 'animate-spin' : ''}`} />
            <span>Reconcile Now</span>
          </button>
        </div>
      )}

      {/* Feedback Message */}
      {reconcileResult && (
        <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs flex items-center justify-between">
          <span>{reconcileResult}</span>
          <button
            type="button"
            onClick={() => setReconcileResult(null)}
            className="text-indigo-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: SCHEMA EXPLORER */}
      {activeTab === 'schema' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Database Tables ({schemas.length})
              </h3>
              <p className="text-[11px] text-slate-400 break-words">
                Authoritative schema mirrored in generated TypeScript types (src/types/database.ts)
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleReconcile}
                disabled={isReconciling || !isConnected}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 border border-white/5 text-slate-300 hover:text-white text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50"
                data-testid="db-reconcile-btn"
                title="Sync live remote schema"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
                <span>Reconcile</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCreatingTable(!isCreatingTable)}
                disabled={!isConnected}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition flex items-center gap-1.5 disabled:opacity-50"
                data-testid="db-new-table-btn"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Table</span>
              </button>
            </div>
          </div>

          {/* New Table Form (Safe Creator) */}
          {isCreatingTable && (
            <form
              onSubmit={handleCreateTableSubmit}
              className="p-4 rounded-xl bg-[#111827]/70 border border-indigo-500/30 space-y-4 animate-in fade-in"
            >
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Create New Table (Safe Migration)</span>
                </span>
                <span className="text-[10px] text-slate-400">Additive create_table only</span>
              </div>

              {migrationError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {migrationError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Table Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. customers, expenses, products"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  data-testid="db-table-name-input"
                  required
                />
              </div>

              {/* Column Builder */}
              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-300 block">Table Columns</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="column_name"
                    value={colName}
                    onChange={(e) => setColName(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                    data-testid="db-col-name-input"
                  />
                  <select
                    value={colType}
                    onChange={(e) => setColType(e.target.value as AllowedColumnType)}
                    className="px-2.5 py-1.5 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    data-testid="db-col-type-select"
                  >
                    <option value="text">text</option>
                    <option value="integer">integer</option>
                    <option value="numeric">numeric</option>
                    <option value="boolean">boolean</option>
                    <option value="timestamp">timestamp</option>
                    <option value="uuid">uuid</option>
                    <option value="jsonb">jsonb</option>
                  </select>
                  <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={colIsPrimary}
                      onChange={(e) => setColIsPrimary(e.target.checked)}
                      className="rounded bg-slate-900 border-white/20 text-indigo-600 focus:ring-0"
                      data-testid="db-col-pk-checkbox"
                    />
                    <span>PK</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddColumn}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition"
                    data-testid="db-add-col-btn"
                  >
                    Add
                  </button>
                </div>

                {/* Column Chips List */}
                <div className="space-y-1 pt-1">
                  {newColumns.map((col) => (
                    <div
                      key={col.name}
                      className="flex items-center justify-between px-2.5 py-1 rounded bg-slate-900/50 border border-white/5 text-[11px] font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-300 font-semibold">{col.name}</span>
                        <span className="text-slate-400">({col.type})</span>
                        {col.isPrimary && (
                          <span className="px-1 py-0.2 bg-amber-500/20 text-amber-300 text-[9px] font-bold rounded">
                            PRIMARY KEY
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(col.name)}
                        className="text-slate-500 hover:text-rose-400 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsCreatingTable(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isMigrating || newColumns.length === 0}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-md shadow-indigo-600/30 transition flex items-center gap-1.5 disabled:opacity-50"
                  data-testid="db-create-table-confirm-btn"
                >
                  {isMigrating ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Execute Migration</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Tables List */}
          {!isConnected ? (
            <div className="p-8 text-center bg-slate-900/40 border border-white/5 rounded-2xl space-y-2">
              <Database className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs font-medium text-slate-300">No Database Connected</p>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                Connect a database provider to explore schemas, run safe migrations, and enable typed queries.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('connect')}
                className="mt-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition inline-flex items-center gap-1.5"
              >
                <span>Go to Connection</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ) : schemas.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/40 border border-white/5 rounded-2xl space-y-2">
              <Layers className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs font-medium text-slate-300">No tables found in connected database.</p>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                Create a table using the Safe Creator or request a schema from AI Chat.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {schemas.map((table) => (
                <div
                  key={table.name}
                  className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 hover:border-white/10 transition space-y-2.5"
                  data-testid={`table-row-${table.name}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                        <Database className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white font-mono">{table.name}</h4>
                        <p className="text-[10px] text-slate-400">
                          {table.columns.length} columns • {table.rowCount || 0} records
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Columns Detail */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
                    {table.columns.map((col) => (
                      <div
                        key={col.name}
                        className="px-2 py-1 rounded bg-slate-950/60 border border-white/5 text-[10px] font-mono flex items-center justify-between"
                      >
                        <span className="text-slate-300 truncate">{col.name}</span>
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          <span className="text-slate-500 text-[9px]">{col.type}</span>
                          {col.isPrimary && (
                            <span className="text-[8px] px-1 py-0.2 bg-amber-500/20 text-amber-300 font-bold rounded">
                              PK
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MIGRATIONS HISTORY */}
      {activeTab === 'migrations' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Migration History ({migrations.length})
              </h3>
              <p className="text-[11px] text-slate-400">
                Safe, additive, idempotent operations recorded for this project
              </p>
            </div>
          </div>

          {migrations.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/40 border border-white/5 rounded-2xl space-y-2">
              <History className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs font-medium text-slate-300">No migrations recorded yet.</p>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                Migrations are logged when new tables or columns are applied.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {migrations.map((mig) => (
                <div
                  key={mig.migrationId}
                  className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{mig.title}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        v{mig.schemaVersion}
                      </span>
                    </div>

                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        mig.status === 'applied'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : mig.status === 'unknown'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30'
                      }`}
                    >
                      {mig.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span>Hash: {mig.operationsHash}</span>
                    <span>{new Date(mig.timestamp).toLocaleTimeString()}</span>
                  </div>

                  {mig.status === 'unknown' && (
                    <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px]">
                      Remote schema mutated on provider, but local persistence was unconfirmed. Use Reconcile to verify.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CONNECTION CONFIGURATION */}
      {activeTab === 'connect' && (
        <form onSubmit={handleConnect} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Database Provider Connection
              </h3>
              <p className="text-[11px] text-slate-400">
                Credentials are stored in canonical envVarStore and never committed to VFS
              </p>
            </div>
          </div>

          {connError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              {connError}
            </div>
          )}

          {/* Provider Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Select Database Provider
            </label>
            <select
              value={providerId}
              onChange={(e) => handleProviderChange(e.target.value as DatabaseProviderId)}
              className="w-full px-3 py-2 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              data-testid="db-provider-select"
            >
              <option value="mock">Mock Database Provider (Test/Demo)</option>
              <option value="supabase">Supabase (PostgreSQL)</option>
            </select>
          </div>

          {/* Endpoint URL */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Endpoint URL (Public)
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="e.g. https://your-ref.supabase.co"
              className="w-full px-3 py-2 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              data-testid="db-endpoint-input"
              required
            />
          </div>

          {/* Database Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Database / Project Name
            </label>
            <input
              type="text"
              value={databaseName}
              onChange={(e) => setDatabaseName(e.target.value)}
              placeholder="e.g. postgres or my_app_db"
              className="w-full px-3 py-2 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Supabase Specific Keys */}
          {providerId === 'supabase' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Public Anon Key (Client-Safe, RLS Enforced)
                </label>
                <input
                  type="text"
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                  className="w-full px-3 py-2 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  data-testid="db-anon-key-input"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>Service Role Secret Key (Ephemeral, Management Only)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowServiceKey(!showServiceKey)}
                    className="text-[11px] text-slate-400 hover:text-white transition flex items-center gap-1"
                  >
                    {showServiceKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{showServiceKey ? 'Hide' : 'Reveal'}</span>
                  </button>
                </div>
                <input
                  type={showServiceKey ? 'text' : 'password'}
                  value={serviceKey}
                  onChange={(e) => setServiceKey(e.target.value)}
                  placeholder="Secret key for schema management"
                  className="w-full px-3 py-2 bg-slate-900/80 border border-white/10 rounded-lg text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  data-testid="db-service-key-input"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Stored strictly in memory-only envVarStore. Never exported or written to VFS.
                </p>
              </div>
            </>
          )}

          {/* Connected Details / Actions */}
          <div className="pt-3 border-t border-white/5 flex items-center justify-between">
            {isConnected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isConnecting}
                className="px-3 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition"
                data-testid="db-disconnect-btn"
              >
                Disconnect Provider
              </button>
            ) : (
              <div />
            )}

            <button
              type="submit"
              disabled={isConnecting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/30 transition flex items-center gap-1.5 disabled:opacity-50"
              data-testid="db-connect-btn"
            >
              {isConnecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Server className="w-3.5 h-3.5" />
                  <span>{isConnected ? 'Update Connection' : 'Connect Provider'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
