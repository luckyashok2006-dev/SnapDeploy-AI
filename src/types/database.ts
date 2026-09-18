// ---------------------------------------------------------------------------
// SnapDeploy AI — Tier 1 Feature 9: Database Integration Types
// ---------------------------------------------------------------------------

export type DatabaseProviderId = 'mock' | 'supabase' | 'neon';

export interface DatabaseConnectionConfig {
  providerId: DatabaseProviderId;
  endpoint: string; // e.g. https://xyz.supabase.co or project ref (non-sensitive)
  databaseName?: string;
}

export type AllowedColumnType =
  | 'text'
  | 'integer'
  | 'numeric'
  | 'boolean'
  | 'timestamp'
  | 'uuid'
  | 'jsonb';

export interface TableColumn {
  name: string;
  type: AllowedColumnType;
  isPrimary?: boolean;
  isNullable?: boolean;
  defaultValue?: string;
}

export interface TableIndex {
  name: string;
  columns: string[];
  isUnique?: boolean;
}

export interface TableSchema {
  name: string;
  description?: string;
  columns: TableColumn[];
  indexes?: TableIndex[];
  rowCount?: number;
}

export interface DatabaseMetadata {
  providerId: DatabaseProviderId;
  endpoint: string;
  databaseName: string;
  serverVersion?: string;
  connectedAt: number;
  status: 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Exhaustive Structured Migration Allowlist (Strictly Non-Destructive)
// Only additive operations: create_table, add_column, create_index.
// Raw SQL and destructive operations (DROP, TRUNCATE) are syntactically impossible.
// ---------------------------------------------------------------------------
export type AllowedMigrationOperation =
  | {
      type: 'create_table';
      tableName: string;
      description?: string;
      columns: TableColumn[];
      indexes?: TableIndex[];
    }
  | {
      type: 'add_column';
      tableName: string;
      column: TableColumn;
    }
  | {
      type: 'create_index';
      tableName: string;
      index: TableIndex;
    };

export type MigrationStatus = 'pending' | 'applied' | 'unknown';

export interface SafeMigrationRequest {
  migrationId: string;
  projectId: string;
  title: string;
  description?: string;
  schemaVersion: number;
  operations: AllowedMigrationOperation[];
}

export interface MigrationRecord {
  migrationId: string;
  projectId: string;
  schemaVersion: number;
  operationsHash: string;
  title: string;
  appliedOperations: number;
  status: MigrationStatus;
  timestamp: number;
  errorMessage?: string;
}

export interface MigrationResult {
  success: boolean;
  alreadyApplied?: boolean;
  appliedOperations: number;
  status: MigrationStatus;
  error?: string;
}

export interface SchemaReconciliationResult {
  synced: boolean;
  addedTables: string[];
  modifiedTables: string[];
  unknownMigrationsResolved: number;
}
