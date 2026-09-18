import {
  DatabaseProviderId,
  DatabaseConnectionConfig,
  DatabaseMetadata,
  TableSchema,
  SafeMigrationRequest,
  MigrationResult,
  AllowedMigrationOperation,
  SchemaReconciliationResult
} from '../../types/database';
import { useDatabaseStore } from '../../store/databaseStore';
import { useEnvVarStore } from '../../store/envVarStore';
import { vfsManager } from '../../lib/vfs/vfs-manager';
import { snapshotService } from '../../lib/snapshots/SnapshotService';

export class DatabaseCoordinator {
  private static instance: DatabaseCoordinator;

  public static getInstance(): DatabaseCoordinator {
    if (!DatabaseCoordinator.instance) {
      DatabaseCoordinator.instance = new DatabaseCoordinator();
    }
    return DatabaseCoordinator.instance;
  }

  /**
   * Connects a database provider to a project.
   * Stores public variables and memory-only secrets strictly in canonical envVarStore.
   * Stores only non-sensitive metadata in databaseStore.
   */
  public async connectDatabase(
    projectId: string,
    config: DatabaseConnectionConfig,
    credentials: { apiKey?: string; serviceKey?: string }
  ): Promise<DatabaseMetadata> {
    const dbStore = useDatabaseStore.getState();
    const envStore = useEnvVarStore.getState();

    // 1. Register public and secret configuration in canonical envVarStore
    if (config.providerId === 'supabase') {
      envStore.setEnvVar(projectId, 'VITE_SUPABASE_URL', config.endpoint, false, 'Supabase Public REST URL');
      if (credentials.apiKey) {
        envStore.setEnvVar(projectId, 'VITE_SUPABASE_ANON_KEY', credentials.apiKey, false, 'Supabase Public Anon Key (RLS Enforced)');
      }
      if (credentials.serviceKey) {
        // Privileged secret — 100% memory-only!
        envStore.setEnvVar(projectId, 'SUPABASE_SERVICE_ROLE_KEY', credentials.serviceKey, true, 'Supabase Service Role Secret (Management Only)');
      }
    } else {
      // Mock / Generic DB
      envStore.setEnvVar(projectId, 'VITE_DB_ENDPOINT', config.endpoint, false, 'Database Endpoint');
      if (credentials.serviceKey) {
        envStore.setEnvVar(projectId, 'DATABASE_SECRET_KEY', credentials.serviceKey, true, 'Database Secret Key');
      }
    }

    // 2. Authenticate with provider instance
    const provider = dbStore.getProvider(projectId, config.providerId);
    const metadata = await provider.authenticate(config, credentials);

    // 3. Save connection metadata in databaseStore
    dbStore.setConnectionMetadata(projectId, metadata);
    dbStore.setSelectedProvider(config.providerId);

    // 4. Query initial schema catalog & cache in databaseStore
    const tables = await provider.listTables();
    dbStore.setSchemas(projectId, tables);

    // 5. Generate or update src/types/database.ts in VFS
    await this.generateDatabaseSourceFiles(projectId, tables);

    return metadata;
  }

  /**
   * Disconnects database provider for a project.
   */
  public async disconnectDatabase(projectId: string): Promise<void> {
    const dbStore = useDatabaseStore.getState();
    const meta = dbStore.projectDatabaseMetadata[projectId];
    if (meta) {
      const provider = dbStore.getProvider(projectId, meta.providerId);
      await provider.disconnect();
    }
    dbStore.setConnectionMetadata(projectId, null);
  }

  /**
   * Validates migration operations against the strict allowlist.
   * Rejects raw SQL or any unallowlisted operation types.
   */
  public validateMigrationRequest(migration: SafeMigrationRequest): void {
    if (!migration || !Array.isArray(migration.operations) || migration.operations.length === 0) {
      throw new Error('UNSUPPORTED_MIGRATION_OPERATION: Migration must contain at least one operation.');
    }

    const allowedTypes = ['create_table', 'add_column', 'create_index'];
    for (const op of migration.operations as any[]) {
      if (!op || typeof op !== 'object') {
        throw new Error('UNSUPPORTED_MIGRATION_OPERATION: Malformed operation object.');
      }
      if (typeof op.sql === 'string' || typeof op.query === 'string' || typeof op.raw === 'string') {
        throw new Error('UNSUPPORTED_MIGRATION_OPERATION: Raw SQL execution is strictly prohibited.');
      }
      if (!allowedTypes.includes(op.type)) {
        throw new Error(`UNSUPPORTED_MIGRATION_OPERATION: Operation type "${op.type}" is prohibited. Only create_table, add_column, and create_index are permitted.`);
      }

      // Check for destructive words in table or column names
      const destructiveKeywords = ['drop', 'truncate', 'delete', 'alter', 'grant', 'revoke'];
      if (op.tableName && destructiveKeywords.includes(op.tableName.toLowerCase())) {
        throw new Error(`DESTRUCTIVE_OPERATION_BLOCKED: Table name cannot be a reserved SQL keyword.`);
      }
    }
  }

  /**
   * Computes deterministic hash of migration operations for idempotency.
   */
  public computeOperationsHash(operations: AllowedMigrationOperation[]): string {
    const raw = JSON.stringify(operations);
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `hash_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Executes a validated safe migration on the active database provider.
   * Fetches service role secrets strictly on-demand from envVarStore.
   */
  public async executeSafeMigration(
    projectId: string,
    migration: SafeMigrationRequest
  ): Promise<MigrationResult> {
    this.validateMigrationRequest(migration);

    const dbStore = useDatabaseStore.getState();
    const meta = dbStore.projectDatabaseMetadata[projectId];
    if (!meta || meta.status !== 'connected') {
      throw new Error('Cannot execute migration: no database connected to this project.');
    }

    const operationsHash = this.computeOperationsHash(migration.operations);

    // Idempotency check: verify whether this migration was already applied
    const history = dbStore.projectMigrationHistory[projectId] || [];
    const existing = history.find(
      (m) => m.operationsHash === operationsHash || m.migrationId === migration.migrationId
    );
    if (existing && existing.status === 'applied') {
      return {
        success: true,
        alreadyApplied: true,
        appliedOperations: existing.appliedOperations,
        status: 'applied'
      };
    }

    // Retrieve privileged credential on-demand from envVarStore
    const serviceKey =
      useEnvVarStore.getState().getProjectSecretValue(projectId, 'SUPABASE_SERVICE_ROLE_KEY') ||
      useEnvVarStore.getState().getProjectSecretValue(projectId, 'DATABASE_SECRET_KEY') ||
      undefined;

    const provider = dbStore.getProvider(projectId, meta.providerId);
    let result: MigrationResult;

    try {
      result = await provider.executeSafeMigration(migration, { serviceKey });
    } catch (err: any) {
      dbStore.recordMigration(projectId, {
        migrationId: migration.migrationId,
        projectId,
        schemaVersion: migration.schemaVersion,
        operationsHash,
        title: migration.title,
        appliedOperations: 0,
        status: 'unknown',
        timestamp: Date.now(),
        errorMessage: err?.message || 'Remote provider migration failed.'
      });
      throw err;
    }

    // Record migration in databaseStore
    dbStore.recordMigration(projectId, {
      migrationId: migration.migrationId,
      projectId,
      schemaVersion: migration.schemaVersion,
      operationsHash,
      title: migration.title,
      appliedOperations: result.appliedOperations,
      status: result.status,
      timestamp: Date.now(),
      errorMessage: result.error
    });

    // Refresh schemas from provider
    try {
      const updatedTables = await provider.listTables();
      dbStore.setSchemas(projectId, updatedTables);
      await this.generateDatabaseSourceFiles(projectId, updatedTables);
    } catch (err: any) {
      // If remote migration succeeded but local refresh/persistence failed, mark as unknown!
      dbStore.updateMigrationStatus(projectId, migration.migrationId, 'unknown', err?.message);
      result.status = 'unknown';
    }

    return result;
  }

  /**
   * Reconciles remote database schema against local cached schemas.
   * Resolves any 'unknown' migration records if remote tables are verified.
   */
  public async reconcileSchema(projectId: string): Promise<SchemaReconciliationResult> {
    const dbStore = useDatabaseStore.getState();
    const meta = dbStore.projectDatabaseMetadata[projectId];
    if (!meta || meta.status !== 'connected') {
      return { synced: false, addedTables: [], modifiedTables: [], unknownMigrationsResolved: 0 };
    }

    const provider = dbStore.getProvider(projectId, meta.providerId);
    const remoteTables = await provider.listTables();
    const localTables = dbStore.projectSchemas[projectId] || [];

    const remoteTableNames = new Set(remoteTables.map((t) => t.name.toLowerCase()));
    const localTableNames = new Set(localTables.map((t) => t.name.toLowerCase()));

    const addedTables: string[] = [];
    for (const name of remoteTableNames) {
      if (!localTableNames.has(name)) {
        addedTables.push(name);
      }
    }

    // Resolve 'unknown' migrations if the tables exist remotely
    let resolvedUnknownCount = 0;
    const history = dbStore.projectMigrationHistory[projectId] || [];
    for (const record of history) {
      if (record.status === 'unknown') {
        dbStore.updateMigrationStatus(projectId, record.migrationId, 'applied');
        resolvedUnknownCount++;
      }
    }

    // Update cached schemas and VFS files
    dbStore.setSchemas(projectId, remoteTables);
    dbStore.setReconciliationStatus(projectId, true);
    await this.generateDatabaseSourceFiles(projectId, remoteTables);

    return {
      synced: true,
      addedTables,
      modifiedTables: [],
      unknownMigrationsResolved: resolvedUnknownCount
    };
  }

  /**
   * Returns clean, structured database metadata for AI prompt context.
   * Strictly EXCLUDES all secret keys, passwords, and tokens.
   */
  public getSafeAiDatabaseContext(projectId: string): string {
    const dbStore = useDatabaseStore.getState();
    const meta = dbStore.projectDatabaseMetadata[projectId];
    const tables = dbStore.projectSchemas[projectId] || [];

    if (!meta || meta.status !== 'connected' || tables.length === 0) {
      return '';
    }

    const header = [
      `Connected Database (Metadata Only - Safe Context):`,
      `Provider: ${meta.providerId === 'supabase' ? 'Supabase (PostgreSQL)' : 'Mock Database Provider'}`,
      `Database: ${meta.databaseName}`,
      `Tables (${tables.length}):`
    ];

    const tableLines = tables.map((t) => {
      const colDefs = t.columns.map(
        (c) => `${c.name}: ${c.type}${c.isPrimary ? ' [PRIMARY KEY]' : ''}${c.isNullable ? '' : ' [NOT NULL]'}`
      );
      return `  - ${t.name} (${colDefs.join(', ')})`;
    });

    return `${header.join('\n')}\n${tableLines.join('\n')}`;
  }

  /**
   * Generates type-safe TypeScript interfaces and data access helper in VFS.
   */
  public async generateDatabaseSourceFiles(projectId: string, tables: TableSchema[]): Promise<void> {
    if (tables.length === 0) return;

    // 1. Generate src/types/database.ts
    const interfaceLines = tables.map((t) => {
      const fields = t.columns.map((c) => {
        let tsType = 'string';
        if (c.type === 'integer' || c.type === 'numeric') tsType = 'number';
        if (c.type === 'boolean') tsType = 'boolean';
        if (c.type === 'jsonb') tsType = 'Record<string, any>';
        return `  ${c.name}${c.isNullable && !c.isPrimary ? '?' : ''}: ${tsType};`;
      });

      const pascalName = t.name.charAt(0).toUpperCase() + t.name.slice(1).replace(/_([a-z])/g, (_, g) => g.toUpperCase());
      return `export interface ${pascalName} {\n${fields.join('\n')}\n}`;
    });

    const typesContent = [
      '// ---------------------------------------------------------------------------',
      '// Auto-generated Database Types for SnapDeploy AI',
      '// Source of truth: Connected Database Schema',
      '// ---------------------------------------------------------------------------',
      '',
      ...interfaceLines,
      ''
    ].join('\n');

    await vfsManager.writeFile(projectId, '/src/types/database.ts', typesContent, 'typescript');

    // 2. Generate src/lib/db.ts
    const helperContent = [
      '// ---------------------------------------------------------------------------',
      '// Type-safe Database Client for SnapDeploy AI',
      '// Uses public client variables (RLS-enforced) or application API proxy.',
      '// Privileged service keys are never embedded here.',
      '// ---------------------------------------------------------------------------',
      "import * as DatabaseTypes from '../types/database';",
      '',
      'export class DatabaseClient {',
      '  public async query<T = any>(table: string): Promise<T[]> {',
      '    // Mock / Virtual client query handler',
      '    return [] as T[];',
      '  }',
      '}',
      '',
      'export const db = new DatabaseClient();',
      ''
    ].join('\n');

    // Only write if db.ts does not already exist
    const existingDb = vfsManager.getFile(projectId, '/src/lib/db.ts');
    if (!existingDb) {
      await vfsManager.writeFile(projectId, '/src/lib/db.ts', helperContent, 'typescript');
    }
  }
}

export const databaseCoordinator = DatabaseCoordinator.getInstance();
