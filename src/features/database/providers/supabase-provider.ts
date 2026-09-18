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

export class SupabaseProvider implements DatabaseProvider {
  public readonly id: DatabaseProviderId = 'supabase';
  public readonly name = 'Supabase (PostgreSQL)';
  public readonly description = 'Managed PostgreSQL database with real-time REST API (PostgREST)';

  private config: DatabaseConnectionConfig | null = null;
  private metadata: DatabaseMetadata | null = null;
  private cachedTables: TableSchema[] = [];

  public async authenticate(
    config: DatabaseConnectionConfig,
    credentials: { apiKey?: string; serviceKey?: string }
  ): Promise<DatabaseMetadata> {
    if (!config.endpoint || !config.endpoint.trim()) {
      throw new Error('Supabase connection failed: URL/endpoint is required.');
    }

    const cleanUrl = config.endpoint.trim().replace(/\/+$/, '');
    const authHeader = credentials.apiKey || credentials.serviceKey;

    try {
      const resp = await fetch(`${cleanUrl}/rest/v1/`, {
        method: 'GET',
        headers: {
          apikey: authHeader || '',
          Authorization: authHeader ? `Bearer ${authHeader}` : '',
          Accept: 'application/openapi+json'
        }
      });

      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Supabase authentication failed: Invalid API key or unauthorized project.');
      }

      if (!resp.ok && resp.status !== 404) {
        throw new Error(`Supabase returned HTTP ${resp.status}`);
      }

      this.config = { ...config, endpoint: cleanUrl };
      this.metadata = {
        providerId: 'supabase',
        endpoint: cleanUrl,
        databaseName: config.databaseName || cleanUrl.split('//')[1]?.split('.')[0] || 'supabase_db',
        serverVersion: 'PostgreSQL 15+ (Supabase Managed)',
        connectedAt: Date.now(),
        status: 'connected'
      };

      return this.metadata;
    } catch (err: any) {
      this.metadata = {
        providerId: 'supabase',
        endpoint: cleanUrl,
        databaseName: config.databaseName || 'supabase_db',
        connectedAt: Date.now(),
        status: 'error',
        errorMessage: err?.message || 'Connection handshake failed.'
      };
      throw new Error(`Supabase connection error: ${err?.message || err}`);
    }
  }

  public isAuthenticated(): boolean {
    return this.config !== null && this.metadata?.status === 'connected';
  }

  public async validateConnection(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    if (!this.isAuthenticated() || !this.config) {
      return { healthy: false, latencyMs: 0, message: 'Supabase is not connected.' };
    }

    const startTime = Date.now();
    try {
      const resp = await fetch(`${this.config.endpoint}/rest/v1/`, {
        method: 'HEAD'
      });
      const latencyMs = Date.now() - startTime;
      return {
        healthy: resp.ok || resp.status === 401, // 401 means server is up and responsive
        latencyMs,
        message: resp.ok ? 'Connection verified.' : 'Endpoint responsive.'
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: err?.message || 'Connection test failed.'
      };
    }
  }

  public async getMetadata(): Promise<DatabaseMetadata | null> {
    return this.metadata ? { ...this.metadata } : null;
  }

  public async listTables(): Promise<TableSchema[]> {
    if (!this.isAuthenticated() || !this.config) {
      return [];
    }

    try {
      const resp = await fetch(`${this.config.endpoint}/rest/v1/`, {
        headers: { Accept: 'application/openapi+json' }
      });

      if (!resp.ok) {
        return this.cachedTables;
      }

      const openapi = await resp.json();
      const paths = openapi.paths || {};
      const tables: TableSchema[] = [];

      for (const [pathKey, pathObj] of Object.entries<any>(paths)) {
        if (pathKey === '/' || pathKey.startsWith('/rpc/')) continue;
        const tableName = pathKey.replace(/^\//, '');
        const getDef = pathObj.get || {};
        const columns: TableColumn[] = [];

        if (getDef.parameters) {
          for (const param of getDef.parameters) {
            if (param.name && !param.name.startsWith('select') && !param.name.startsWith('order')) {
              columns.push({
                name: param.name,
                type: (param.type as any) || 'text',
                isPrimary: param.name === 'id',
                isNullable: true
              });
            }
          }
        }

        tables.push({
          name: tableName,
          description: pathObj.description || `Table ${tableName}`,
          columns,
          rowCount: 0
        });
      }

      this.cachedTables = tables;
      return tables;
    } catch {
      return this.cachedTables;
    }
  }

  public async getTable(tableName: string): Promise<TableSchema | null> {
    const tables = await this.listTables();
    return tables.find((t) => t.name.toLowerCase() === tableName.toLowerCase()) || null;
  }

  public async executeSafeMigration(
    migration: SafeMigrationRequest,
    credentials: { serviceKey?: string }
  ): Promise<MigrationResult> {
    if (!this.isAuthenticated() || !this.config) {
      throw new Error('Migration failed: Supabase provider is not connected.');
    }

    if (!credentials.serviceKey) {
      throw new Error('Migration failed: SUPABASE_SERVICE_ROLE_KEY is required to perform schema migrations.');
    }

    // Validate allowlist
    const validOperationTypes = ['create_table', 'add_column', 'create_index'];
    for (const op of migration.operations as any[]) {
      if (typeof op.sql === 'string' || typeof op.query === 'string' || typeof op.raw === 'string') {
        throw new Error('UNSUPPORTED_MIGRATION_OPERATION: Raw SQL execution is strictly prohibited.');
      }
      if (!validOperationTypes.includes(op.type)) {
        throw new Error(`UNSUPPORTED_MIGRATION_OPERATION: Operation type "${op.type}" is prohibited.`);
      }
    }

    // Supabase pgmeta/management call with service role key
    const cleanUrl = this.config.endpoint;
    let appliedCount = 0;

    for (const op of migration.operations) {
      if (op.type === 'create_table') {
        const resp = await fetch(`${cleanUrl}/pgmeta/default/tables`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: credentials.serviceKey,
            Authorization: `Bearer ${credentials.serviceKey}`
          },
          body: JSON.stringify({
            name: op.tableName,
            comment: op.description
          })
        });

        if (resp.ok || resp.status === 409) {
          appliedCount++;
        }
      } else if (op.type === 'add_column') {
        const resp = await fetch(`${cleanUrl}/pgmeta/default/columns`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: credentials.serviceKey,
            Authorization: `Bearer ${credentials.serviceKey}`
          },
          body: JSON.stringify({
            table: op.tableName,
            name: op.column.name,
            type: op.column.type
          })
        });

        if (resp.ok || resp.status === 409) {
          appliedCount++;
        }
      }
    }

    await this.listTables(); // Refresh schema cache

    return {
      success: true,
      appliedOperations: appliedCount,
      status: 'applied'
    };
  }

  public async disconnect(): Promise<void> {
    this.config = null;
    this.metadata = null;
    this.cachedTables = [];
  }
}
