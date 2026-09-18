import {
  DatabaseProviderId,
  DatabaseConnectionConfig,
  DatabaseMetadata,
  TableSchema,
  TableColumn,
  SafeMigrationRequest,
  MigrationResult,
  AllowedMigrationOperation
} from '../../../types/database';
import { DatabaseProvider } from './database-provider-interface';

export type MockDatabaseFailureMode = 'none' | 'auth' | 'timeout' | 'network' | 'persistence_failure';

// Deterministic in-memory mock database state per project
interface MockTableData {
  schema: TableSchema;
  rows: Record<string, any>[];
}

export class MockDatabaseProvider implements DatabaseProvider {
  public readonly id: DatabaseProviderId = 'mock';
  public readonly name = 'Mock Database Provider (Test/Demo)';
  public readonly description = 'Deterministic in-memory database provider for testing and offline development';

  private static failureMode: MockDatabaseFailureMode = 'none';
  private static latencyMs = 15;

  private connectedConfig: DatabaseConnectionConfig | null = null;
  private metadata: DatabaseMetadata | null = null;
  private tables: Map<string, MockTableData> = new Map();
  private appliedHashes: Set<string> = new Set();

  public static setFailureMode(mode: MockDatabaseFailureMode): void {
    MockDatabaseProvider.failureMode = mode;
  }

  public static setLatencyMs(ms: number): void {
    MockDatabaseProvider.latencyMs = ms;
  }

  public async authenticate(
    config: DatabaseConnectionConfig,
    _credentials: { apiKey?: string; serviceKey?: string }
  ): Promise<DatabaseMetadata> {
    if (MockDatabaseProvider.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, MockDatabaseProvider.latencyMs));
    }

    if (MockDatabaseProvider.failureMode === 'auth') {
      throw new Error('Authentication failed: invalid database credentials.');
    }

    if (!config.endpoint || !config.endpoint.trim()) {
      throw new Error('Connection failed: database endpoint cannot be empty.');
    }

    this.connectedConfig = { ...config };
    this.metadata = {
      providerId: 'mock',
      endpoint: config.endpoint.trim(),
      databaseName: config.databaseName || 'snapdeploy_mock_db',
      serverVersion: 'PostgreSQL 16.2 (Mock In-Memory)',
      connectedAt: Date.now(),
      status: 'connected'
    };

    return this.metadata;
  }

  public isAuthenticated(): boolean {
    return this.connectedConfig !== null && this.metadata?.status === 'connected';
  }

  public async validateConnection(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    if (MockDatabaseProvider.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, MockDatabaseProvider.latencyMs));
    }

    if (!this.isAuthenticated()) {
      return { healthy: false, latencyMs: 0, message: 'Database provider is not connected.' };
    }

    if (MockDatabaseProvider.failureMode === 'timeout') {
      return { healthy: false, latencyMs: 5000, message: 'Connection timed out.' };
    }

    if (MockDatabaseProvider.failureMode === 'network') {
      return { healthy: false, latencyMs: 50, message: 'Network error: unreachable host.' };
    }

    return {
      healthy: true,
      latencyMs: MockDatabaseProvider.latencyMs,
      message: 'Connection verified. In-memory database ready.'
    };
  }

  public async getMetadata(): Promise<DatabaseMetadata | null> {
    return this.metadata ? { ...this.metadata } : null;
  }

  public async listTables(): Promise<TableSchema[]> {
    if (MockDatabaseProvider.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, MockDatabaseProvider.latencyMs));
    }
    return Array.from(this.tables.values()).map((t) => ({ ...t.schema }));
  }

  public async getTable(tableName: string): Promise<TableSchema | null> {
    const table = this.tables.get(tableName.toLowerCase());
    return table ? { ...table.schema } : null;
  }

  public async executeSafeMigration(
    migration: SafeMigrationRequest,
    _credentials: { serviceKey?: string }
  ): Promise<MigrationResult> {
    if (MockDatabaseProvider.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, MockDatabaseProvider.latencyMs));
    }

    if (!this.isAuthenticated()) {
      throw new Error('Migration failed: database provider is not connected.');
    }

    // Idempotency check via operationsHash / migrationId
    const operationsHash = this.computeOperationsHash(migration.operations);
    if (this.appliedHashes.has(operationsHash) || this.appliedHashes.has(migration.migrationId)) {
      return {
        success: true,
        alreadyApplied: true,
        appliedOperations: 0,
        status: 'applied'
      };
    }

    if (!migration.operations || !Array.isArray(migration.operations) || migration.operations.length === 0) {
      throw new Error('Migration failed: operations array cannot be empty.');
    }

    // Strict validation of each operation against the allowlist
    const validOperationTypes = ['create_table', 'add_column', 'create_index'];
    for (const op of migration.operations as any[]) {
      if (!op || typeof op !== 'object') {
        throw new Error('UNSUPPORTED_MIGRATION_OPERATION: Malformed operation object.');
      }

      if (typeof op.sql === 'string' || typeof op.query === 'string' || typeof op.raw === 'string') {
        throw new Error('UNSUPPORTED_MIGRATION_OPERATION: Raw SQL execution is strictly prohibited.');
      }

      if (!validOperationTypes.includes(op.type)) {
        throw new Error(`UNSUPPORTED_MIGRATION_OPERATION: Operation type "${op.type}" is prohibited. Only create_table, add_column, and create_index are permitted.`);
      }

      // Validate identifier safety
      if (op.tableName) {
        this.validateIdentifier(op.tableName, 'Table name');
      }
      if (op.type === 'create_table' && Array.isArray(op.columns)) {
        for (const col of op.columns) {
          this.validateIdentifier(col.name, 'Column name');
        }
      }
      if (op.type === 'add_column' && op.column) {
        this.validateIdentifier(op.column.name, 'Column name');
      }
    }

    // Execute operations in-memory
    let appliedCount = 0;
    for (const op of migration.operations) {
      if (op.type === 'create_table') {
        const normName = op.tableName.toLowerCase();
        if (this.tables.has(normName)) {
          // Idempotent: table already exists
          continue;
        }

        const cols: TableColumn[] = (op.columns || []).map((c) => ({ ...c }));
        // Ensure an 'id' primary key exists if not specified
        if (!cols.some((c) => c.isPrimary)) {
          cols.unshift({ name: 'id', type: 'uuid', isPrimary: true, isNullable: false });
        }

        this.tables.set(normName, {
          schema: {
            name: normName,
            description: op.description || `Table ${normName}`,
            columns: cols,
            indexes: op.indexes ? [...op.indexes] : [],
            rowCount: 0
          },
          rows: []
        });
        appliedCount++;
      } else if (op.type === 'add_column') {
        const normName = op.tableName.toLowerCase();
        const table = this.tables.get(normName);
        if (!table) {
          throw new Error(`Migration failed: table "${op.tableName}" does not exist.`);
        }

        const colExists = table.schema.columns.some((c) => c.name.toLowerCase() === op.column.name.toLowerCase());
        if (!colExists) {
          table.schema.columns.push({ ...op.column });
          appliedCount++;
        }
      } else if (op.type === 'create_index') {
        const normName = op.tableName.toLowerCase();
        const table = this.tables.get(normName);
        if (table) {
          table.schema.indexes = table.schema.indexes || [];
          const idxExists = table.schema.indexes.some((i) => i.name.toLowerCase() === op.index.name.toLowerCase());
          if (!idxExists) {
            table.schema.indexes.push({ ...op.index });
            appliedCount++;
          }
        }
      }
    }

    if (MockDatabaseProvider.failureMode === 'persistence_failure') {
      // Remote mutation succeeded, but caller local persistence will fail
      this.appliedHashes.add(operationsHash);
      this.appliedHashes.add(migration.migrationId);
      return {
        success: true,
        appliedOperations: appliedCount,
        status: 'unknown',
        error: 'Remote migration succeeded on mock provider, but local synchronization failed.'
      };
    }

    this.appliedHashes.add(operationsHash);
    this.appliedHashes.add(migration.migrationId);

    return {
      success: true,
      appliedOperations: appliedCount,
      status: 'applied'
    };
  }

  public async disconnect(): Promise<void> {
    this.connectedConfig = null;
    this.metadata = null;
    this.tables.clear();
    this.appliedHashes.clear();
  }

  // Helper: Computes deterministic hash for operations
  private computeOperationsHash(operations: AllowedMigrationOperation[]): string {
    const raw = JSON.stringify(operations);
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return `hash_${Math.abs(hash).toString(16)}`;
  }

  private validateIdentifier(name: string, label: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error(`Validation error: ${label} must be a non-empty string.`);
    }
    const clean = name.trim();
    if (!/^[a-z][a-z0-9_]{1,62}$/i.test(clean)) {
      throw new Error(`Validation error: ${label} "${name}" contains invalid characters. Must start with a letter and contain only alphanumeric characters and underscores.`);
    }
    const forbidden = ['drop', 'truncate', 'delete', 'alter', 'grant', 'revoke'];
    if (forbidden.includes(clean.toLowerCase())) {
      throw new Error(`DESTRUCTIVE_OPERATION_BLOCKED: ${label} cannot be a reserved SQL command.`);
    }
  }
}
