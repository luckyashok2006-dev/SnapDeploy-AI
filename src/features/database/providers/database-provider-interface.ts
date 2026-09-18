import {
  DatabaseProviderId,
  DatabaseConnectionConfig,
  DatabaseMetadata,
  TableSchema,
  SafeMigrationRequest,
  MigrationResult
} from '../../../types/database';

export interface DatabaseProvider {
  readonly id: DatabaseProviderId;
  readonly name: string;
  readonly description: string;

  /**
   * Authenticates and connects using configuration and ephemeral credentials from envVarStore.
   * Credential values are used for connection handshake and never held in persistent state.
   */
  authenticate(
    config: DatabaseConnectionConfig,
    credentials: { apiKey?: string; serviceKey?: string }
  ): Promise<DatabaseMetadata>;

  isAuthenticated(): boolean;
  validateConnection(): Promise<{ healthy: boolean; latencyMs: number; message?: string }>;
  getMetadata(): Promise<DatabaseMetadata | null>;
  listTables(): Promise<TableSchema[]>;
  getTable(tableName: string): Promise<TableSchema | null>;

  /**
   * Executes an allowlisted, safe, non-destructive migration.
   * Credential values are fetched on-demand from envVarStore and never persisted.
   */
  executeSafeMigration(
    migration: SafeMigrationRequest,
    credentials: { serviceKey?: string }
  ): Promise<MigrationResult>;

  disconnect(): Promise<void>;
}
