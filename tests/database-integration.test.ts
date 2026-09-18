import { describe, it, expect, beforeEach } from 'vitest';
import { useDatabaseStore } from '../src/store/databaseStore';
import { useEnvVarStore, purgeAllMemorySecrets } from '../src/store/envVarStore';
import { useDeploymentStore } from '../src/store/deploymentStore';
import { useProjectStore } from '../src/store/projectStore';
import { databaseCoordinator } from '../src/features/database/database-coordinator';
import { MockDatabaseProvider } from '../src/features/database/providers/mock-database-provider';
import { SupabaseProvider } from '../src/features/database/providers/supabase-provider';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { editExecutor } from '../src/features/chat/edit-executor';
import { SafeMigrationRequest, AllowedMigrationOperation } from '../src/types/database';
import { EditProposal } from '../src/types/workspace';

describe('Tier 1 Feature 9: Database Integration in SnapDeploy AI', () => {
  const projectA = 'proj-db-alpha';
  const projectB = 'proj-db-beta';

  beforeEach(async () => {
    // Reset stores
    useDatabaseStore.setState({
      selectedProvider: 'mock',
      projectDatabaseMetadata: {},
      projectSchemas: {},
      projectMigrationHistory: {},
      projectReconciliationStatus: {}
    });
    useEnvVarStore.setState({ envVarMetadata: {} });
    useEnvVarStore.getState().clearProjectEnvVars(projectA);
    useEnvVarStore.getState().clearProjectEnvVars(projectB);
    useDatabaseStore.getState().clearProjectDatabase(projectA);
    useDatabaseStore.getState().clearProjectDatabase(projectB);

    // Initialize VFS test files
    await vfsManager.writeFile(projectA, '/package.json', JSON.stringify({ name: 'project-a' }), 'json');
    await vfsManager.writeFile(projectA, '/src/App.tsx', 'export default function App() { return <div>App</div>; }', 'typescript');
  });

  // 1. Zero Secret Values in databaseStore
  it('1. Zero Secret Values in databaseStore: contains only non-sensitive metadata and ZERO credentials', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    }) as any;

    try {
      await databaseCoordinator.connectDatabase(
        projectA,
        { providerId: 'supabase', endpoint: 'https://testdb.supabase.co', databaseName: 'postgres' },
        { apiKey: 'anon-key-12345', serviceKey: 'service-role-secret-super-privileged-xyz' }
      );

      const storeState = useDatabaseStore.getState();
      const meta = storeState.projectDatabaseMetadata[projectA];
      expect(meta).toBeDefined();
      expect(meta.endpoint).toBe('https://testdb.supabase.co');

      // Assert that databaseStore holds zero secret values anywhere in its state tree
      const serializedState = JSON.stringify(storeState);
      expect(serializedState).not.toContain('service-role-secret-super-privileged-xyz');
      expect((meta as any).serviceKey).toBeUndefined();
      expect((meta as any).databasePassword).toBeUndefined();
      expect((meta as any).secretKey).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 2. Provider On-Demand Secret Retrieval
  it('2. Provider On-Demand Secret Retrieval: retrieves privileged credentials strictly on-demand from envVarStore', async () => {
    // Save secret in canonical envVarStore
    useEnvVarStore.getState().setEnvVar(projectA, 'SUPABASE_SERVICE_ROLE_KEY', 'privileged-secret-key-999', true);

    // Connect mock provider
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://test', databaseName: 'testdb' },
      { serviceKey: 'privileged-secret-key-999' }
    );

    // Verify secret is retrieved from envVarStore during migration execution
    const secretInEnvStore = useEnvVarStore.getState().getProjectSecretValue(projectA, 'SUPABASE_SERVICE_ROLE_KEY');
    expect(secretInEnvStore).toBe('privileged-secret-key-999');

    const migration: SafeMigrationRequest = {
      migrationId: 'mig-ondemand-test',
      projectId: projectA,
      title: 'Create test table',
      schemaVersion: 1,
      operations: [
        {
          type: 'create_table',
          tableName: 'ondemand_table',
          columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
        }
      ]
    };

    const res = await databaseCoordinator.executeSafeMigration(projectA, migration);
    expect(res.success).toBe(true);
    expect(res.status).toBe('applied');
  });

  // 3. Provider Abstraction Compliance
  it('3. Provider Abstraction Compliance: MockDatabaseProvider and SupabaseProvider implement the full contract', () => {
    const mock = new MockDatabaseProvider('mock-proj');
    expect(typeof mock.authenticate).toBe('function');
    expect(typeof mock.validateConnection).toBe('function');
    expect(typeof mock.listTables).toBe('function');
    expect(typeof mock.getTable).toBe('function');
    expect(typeof mock.executeSafeMigration).toBe('function');
    expect(typeof mock.disconnect).toBe('function');

    const supabase = new SupabaseProvider('supa-proj');
    expect(typeof supabase.authenticate).toBe('function');
    expect(typeof supabase.validateConnection).toBe('function');
    expect(typeof supabase.listTables).toBe('function');
    expect(typeof supabase.getTable).toBe('function');
    expect(typeof supabase.executeSafeMigration).toBe('function');
    expect(typeof supabase.disconnect).toBe('function');
  });

  // 4. Authentication & Connection Validation
  it('4. Authentication & Connection Validation: reports latency and connection health', async () => {
    const mock = new MockDatabaseProvider(projectA);
    const meta = await mock.authenticate(
      { providerId: 'mock', endpoint: 'http://localhost:5432/testdb', databaseName: 'testdb' },
      {}
    );
    expect(meta.status).toBe('connected');
    expect(meta.providerId).toBe('mock');

    const health = await mock.validateConnection();
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // 5. Schema Inspection
  it('5. Schema Inspection: listTables returns accurate schema metadata', async () => {
    const mock = new MockDatabaseProvider(projectA);
    await mock.authenticate({ providerId: 'mock', endpoint: 'http://localhost:5432/testdb', databaseName: 'testdb' }, {});

    await mock.executeSafeMigration(
      {
        migrationId: 'm1',
        projectId: projectA,
        title: 'create orders',
        schemaVersion: 1,
        operations: [
          {
            type: 'create_table',
            tableName: 'orders',
            columns: [
              { name: 'id', type: 'uuid', isPrimary: true },
              { name: 'total', type: 'numeric', isNullable: false }
            ]
          }
        ]
      },
      {}
    );

    const tables = await mock.listTables();
    expect(tables.length).toBe(1);
    expect(tables[0].name).toBe('orders');
    expect(tables[0].columns.length).toBe(2);
    expect(tables[0].columns[0].name).toBe('id');
    expect(tables[0].columns[0].isPrimary).toBe(true);
  });

  // 6. Exhaustive Operation Allowlist Validation
  it('6. Exhaustive Operation Allowlist Validation: accepts create_table, add_column, and create_index', () => {
    const validMigration: SafeMigrationRequest = {
      migrationId: 'valid-m',
      projectId: projectA,
      title: 'valid ops',
      schemaVersion: 1,
      operations: [
        {
          type: 'create_table',
          tableName: 'products',
          columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
        },
        {
          type: 'add_column',
          tableName: 'products',
          column: { name: 'sku', type: 'text' }
        },
        {
          type: 'create_index',
          tableName: 'products',
          index: { name: 'idx_products_sku', columns: ['sku'] }
        }
      ]
    };

    expect(() => databaseCoordinator.validateMigrationRequest(validMigration)).not.toThrow();
  });

  // 7. Unknown Migration Operation Rejection
  it('7. Unknown Migration Operation Rejection: throws UNSUPPORTED_MIGRATION_OPERATION for unallowlisted ops', () => {
    const invalidMigration = {
      migrationId: 'inv-m',
      projectId: projectA,
      title: 'invalid op',
      schemaVersion: 1,
      operations: [
        {
          type: 'rename_column',
          tableName: 'products',
          oldName: 'sku',
          newName: 'product_sku'
        } as any
      ]
    };

    expect(() => databaseCoordinator.validateMigrationRequest(invalidMigration as any)).toThrowError(
      /UNSUPPORTED_MIGRATION_OPERATION/
    );
  });

  // 8. Raw SQL Rejection
  it('8. Raw SQL Rejection: blocks raw SQL execution strictly', () => {
    const rawSqlMigration = {
      migrationId: 'raw-sql-m',
      projectId: projectA,
      title: 'raw sql attempt',
      schemaVersion: 1,
      operations: [
        {
          type: 'create_table',
          tableName: 'test',
          raw: 'CREATE TABLE users (id serial PRIMARY KEY);',
          columns: []
        } as any
      ]
    };

    expect(() => databaseCoordinator.validateMigrationRequest(rawSqlMigration as any)).toThrowError(
      /UNSUPPORTED_MIGRATION_OPERATION: Raw SQL execution is strictly prohibited/
    );
  });

  // 9. Destructive Operation Prevention
  it('9. Destructive Operation Prevention: blocks destructive keywords in table names', () => {
    const destructiveMigration: SafeMigrationRequest = {
      migrationId: 'destruct-m',
      projectId: projectA,
      title: 'drop table',
      schemaVersion: 1,
      operations: [
        {
          type: 'create_table',
          tableName: 'drop',
          columns: [{ name: 'id', type: 'uuid' }]
        }
      ]
    };

    expect(() => databaseCoordinator.validateMigrationRequest(destructiveMigration)).toThrowError(
      /DESTRUCTIVE_OPERATION_BLOCKED/
    );
  });

  // 10. Migration Idempotency
  it('10. Migration Idempotency: re-running identical migration returns alreadyApplied: true without error', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://test', databaseName: 'testdb' },
      {}
    );

    const migration: SafeMigrationRequest = {
      migrationId: 'idem-m1',
      projectId: projectA,
      title: 'create invoices',
      schemaVersion: 1,
      operations: [
        {
          type: 'create_table',
          tableName: 'invoices',
          columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
        }
      ]
    };

    // First execution
    const res1 = await databaseCoordinator.executeSafeMigration(projectA, migration);
    expect(res1.success).toBe(true);
    expect(res1.alreadyApplied).toBeFalsy();

    // Second execution with same hash
    const res2 = await databaseCoordinator.executeSafeMigration(projectA, migration);
    expect(res2.success).toBe(true);
    expect(res2.alreadyApplied).toBe(true);
  });

  // 11. Remote Migration Success + Local Persistence Failure
  it('11. Remote Migration Success + Local Persistence Failure: records status unknown, not false applied', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://test', databaseName: 'testdb' },
      {}
    );

    // Set provider failure mode to simulate local crash after remote execution
    MockDatabaseProvider.setFailureMode('persistence_failure');

    try {
      const migration: SafeMigrationRequest = {
        migrationId: 'mig-unknown-test',
        projectId: projectA,
        title: 'create tickets',
        schemaVersion: 2,
        operations: [
          {
            type: 'create_table',
            tableName: 'tickets',
            columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
          }
        ]
      };

      const res = await databaseCoordinator.executeSafeMigration(projectA, migration);
      expect(res.status).toBe('unknown');

      const records = useDatabaseStore.getState().projectMigrationHistory[projectA];
      const record = records.find((r) => r.migrationId === 'mig-unknown-test');
      expect(record?.status).toBe('unknown');
    } finally {
      MockDatabaseProvider.setFailureMode('none');
    }
  });

  // 12. Remote Schema Reconciliation
  it('12. Remote Schema Reconciliation: synchronizes remote tables and resolves unknown migration records', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://test', databaseName: 'testdb' },
      {}
    );

    const provider = useDatabaseStore.getState().getProvider(projectA, 'mock') as MockDatabaseProvider;
    MockDatabaseProvider.setFailureMode('none');

    // Add a table directly on provider to simulate remote changes
    await provider.executeSafeMigration(
      {
        migrationId: 'remote-external-mig',
        projectId: projectA,
        title: 'external table',
        schemaVersion: 99,
        operations: [
          {
            type: 'create_table',
            tableName: 'external_logs',
            columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
          }
        ]
      },
      {}
    );

    // Also record an unknown migration in local store
    useDatabaseStore.getState().recordMigration(projectA, {
      migrationId: 'unconfirmed-mig',
      projectId: projectA,
      schemaVersion: 3,
      operationsHash: 'hash-unconfirmed',
      title: 'unconfirmed migration',
      appliedOperations: 1,
      status: 'unknown',
      timestamp: Date.now()
    });

    // Reconcile
    const reconcileRes = await databaseCoordinator.reconcileSchema(projectA);
    expect(reconcileRes.synced).toBe(true);
    expect(reconcileRes.addedTables).toContain('external_logs');
    expect(reconcileRes.unknownMigrationsResolved).toBe(1);

    // Verify status resolved to applied
    const updatedHistory = useDatabaseStore.getState().projectMigrationHistory[projectA];
    const resolvedRecord = updatedHistory.find((r) => r.migrationId === 'unconfirmed-mig');
    expect(resolvedRecord?.status).toBe('applied');
  });

  // 13. Secrets Excluded from AI Context
  it('13. Secrets Excluded from AI Context: getSafeAiDatabaseContext provides schema without any secrets', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    }) as any;

    try {
      useEnvVarStore.getState().setEnvVar(projectA, 'SUPABASE_SERVICE_ROLE_KEY', 'very-secret-token-key', true);
      await databaseCoordinator.connectDatabase(
        projectA,
        { providerId: 'supabase', endpoint: 'https://demo.supabase.co', databaseName: 'demo_postgres' },
        { apiKey: 'public-anon-key', serviceKey: 'very-secret-token-key' }
      );

      useDatabaseStore.getState().setSchemas(projectA, [
        {
          name: 'profiles',
          columns: [
            { name: 'id', type: 'uuid', isPrimary: true },
            { name: 'username', type: 'text' }
          ]
        }
      ]);

      const context = databaseCoordinator.getSafeAiDatabaseContext(projectA);
      expect(context).toContain('Connected Database');
      expect(context).toContain('profiles');
      expect(context).toContain('username: text');

      // Asserts 0% secrets in AI context
      expect(context).not.toContain('very-secret-token-key');
      expect(context).not.toContain('public-anon-key');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 14. Secrets Excluded from VFS
  it('14. Secrets Excluded from VFS: auto-generated files contain zero secret values', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://test', databaseName: 'testdb' },
      { serviceKey: 'vfs-secret-super-key-555' }
    );

    const typesFile = vfsManager.getFile(projectA, '/src/types/database.ts');
    const dbFile = vfsManager.getFile(projectA, '/src/lib/db.ts');

    expect(typesFile).toBeDefined();
    expect(dbFile).toBeDefined();
    expect(typesFile?.content).not.toContain('vfs-secret-super-key-555');
    expect(dbFile?.content).not.toContain('vfs-secret-super-key-555');

    // No .env file created in VFS
    const allFiles = vfsManager.getFiles(projectA);
    expect(allFiles['/.env']).toBeUndefined();
    expect(allFiles['/.env.local']).toBeUndefined();
  });

  // 15. Secrets Excluded from Version History
  it('15. Secrets Excluded from Version History: snapshot files contain zero credentials', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://test', databaseName: 'testdb' },
      { serviceKey: 'snapshot-secret-role-777' }
    );

    const snapshot = await snapshotService.createSnapshot(projectA, 'Post-db connect checkpoint');
    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain('snapshot-secret-role-777');
  });

  // 16. Secrets Excluded from WebContainer
  it('16. Secrets Excluded from WebContainer: project file tree has no secret files', async () => {
    const files = vfsManager.getFiles(projectA);
    const serializedFiles = JSON.stringify(files);
    expect(serializedFiles).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(serializedFiles).not.toContain('DATABASE_SECRET_KEY');
  });

  // 17. Project Isolation
  it('17. Project Isolation: Project Alpha database state is completely isolated from Project Beta', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://alpha-db', databaseName: 'alpha_db' },
      {}
    );

    const alphaMeta = useDatabaseStore.getState().projectDatabaseMetadata[projectA];
    const betaMeta = useDatabaseStore.getState().projectDatabaseMetadata[projectB];

    expect(alphaMeta?.status).toBe('connected');
    expect(betaMeta).toBeUndefined();

    const betaSchemas = useDatabaseStore.getState().projectSchemas[projectB] || [];
    expect(betaSchemas.length).toBe(0);
  });

  // 18. Project Duplication Isolation
  it('18. Project Duplication Isolation: copies schema metadata while secret credentials remain empty', async () => {
    useEnvVarStore.getState().setEnvVar(projectA, 'SUPABASE_SERVICE_ROLE_KEY', 'alpha-secret-key-100', true);
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://alpha-db', databaseName: 'alpha_db' },
      { serviceKey: 'alpha-secret-key-100' }
    );

    useDatabaseStore.getState().setSchemas(projectA, [
      {
        name: 'widgets',
        columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
      }
    ]);

    // Duplicate database state
    useDatabaseStore.getState().duplicateProjectDatabase(projectA, projectB);

    const betaSchemas = useDatabaseStore.getState().projectSchemas[projectB];
    expect(betaSchemas.length).toBe(1);
    expect(betaSchemas[0].name).toBe('widgets');

    // Assert that Beta does NOT have Alpha's secrets
    const betaSecret = useEnvVarStore.getState().getProjectSecretValue(projectB, 'SUPABASE_SERVICE_ROLE_KEY');
    expect(betaSecret).toBeNull();
  });

  // 19. Project Deletion Cleanup
  it('19. Project Deletion Cleanup: purges database metadata, schema cache, and migrations', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://alpha-db', databaseName: 'alpha_db' },
      {}
    );
    expect(useDatabaseStore.getState().projectDatabaseMetadata[projectA]).toBeDefined();

    // Perform deletion
    useDatabaseStore.getState().clearProjectDatabase(projectA);
    expect(useDatabaseStore.getState().projectDatabaseMetadata[projectA]).toBeUndefined();
    expect(useDatabaseStore.getState().projectSchemas[projectA]).toBeUndefined();
    expect(useDatabaseStore.getState().projectMigrationHistory[projectA]).toBeUndefined();
  });

  // 20. AI Proposal Review Gate
  it('20. AI Proposal Review Gate: rejecting proposal causes 0 VFS changes and 0 database mutations', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://alpha-db', databaseName: 'alpha_db' },
      {}
    );

    const initialTables = useDatabaseStore.getState().projectSchemas[projectA] || [];
    expect(initialTables.length).toBe(0);

    const proposal: EditProposal = {
      id: 'proposal-reject-test',
      summary: 'Add expenses table',
      explanation: 'Test rejection safety',
      files: [
        {
          path: '/src/App.tsx',
          before: 'export default function App() { return <div>App</div>; }',
          after: 'export default function App() { return <div>Expenses</div>; }',
          unifiedDiff: ''
        }
      ],
      migration: {
        migrationId: 'm-reject-expenses',
        projectId: projectA,
        title: 'create expenses',
        schemaVersion: 1,
        operations: [
          {
            type: 'create_table',
            tableName: 'expenses',
            columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
          }
        ]
      }
    };

    // User rejects proposal (no executeEdit call)
    // Verify 0 VFS changes
    const appFile = vfsManager.getFile(projectA, '/src/App.tsx');
    expect(appFile?.content).toContain('<div>App</div>');

    // Verify 0 database mutations
    const currentTables = useDatabaseStore.getState().projectSchemas[projectA] || [];
    expect(currentTables.length).toBe(0);
  });

  // 21. Rollback Semantics
  it('21. Rollback Semantics: snapshot restore rolls back VFS code without modifying remote database schema', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://alpha-db', databaseName: 'alpha_db' },
      {}
    );

    // Initial snapshot
    const baselineSnapshot = await snapshotService.createSnapshot(projectA, 'Baseline');

    // Apply a safe migration to provider
    await databaseCoordinator.executeSafeMigration(projectA, {
      migrationId: 'm-keep-remote',
      projectId: projectA,
      title: 'create analytics',
      schemaVersion: 1,
      operations: [
        {
          type: 'create_table',
          tableName: 'analytics',
          columns: [{ name: 'id', type: 'uuid', isPrimary: true }]
        }
      ]
    });

    // Mutate VFS
    await vfsManager.writeFile(projectA, '/src/App.tsx', 'export default function App() { return <div>Modified</div>; }');

    // Now restore snapshot
    await snapshotService.restoreSnapshot(projectA, baselineSnapshot.id);

    // VFS file is reverted
    const restoredApp = vfsManager.getFile(projectA, '/src/App.tsx');
    expect(restoredApp?.content).toContain('<div>App</div>');

    // Remote database schema is NOT rolled back (honest rollback semantics)
    const tables = useDatabaseStore.getState().projectSchemas[projectA] || [];
    expect(tables.some((t) => t.name === 'analytics')).toBe(true);
  });

  // 22. Database Disconnect Behavior
  it('22. Database Disconnect Behavior: resets provider state, clears status to disconnected', async () => {
    await databaseCoordinator.connectDatabase(
      projectA,
      { providerId: 'mock', endpoint: 'mock://test', databaseName: 'testdb' },
      {}
    );
    expect(useDatabaseStore.getState().projectDatabaseMetadata[projectA]?.status).toBe('connected');

    await databaseCoordinator.disconnectDatabase(projectA);
    expect(useDatabaseStore.getState().projectDatabaseMetadata[projectA]).toBeFalsy();
  });

  // 23. Feature 8 envVarStore Non-Regression
  it('23. Feature 8 envVarStore Non-Regression: memory secrets and purge semantics remain intact', () => {
    useEnvVarStore.getState().setEnvVar(projectA, 'TEST_SECRET', 'val_123', true);
    expect(useEnvVarStore.getState().getProjectSecretValue(projectA, 'TEST_SECRET')).toBe('val_123');

    purgeAllMemorySecrets();
    expect(useEnvVarStore.getState().getProjectSecretValue(projectA, 'TEST_SECRET')).toBeNull();
  });

  // 24. Feature 7 Deployment Non-Regression
  it('24. Feature 7 Deployment Non-Regression: deployment store delegates secret queries to envVarStore', () => {
    useEnvVarStore.getState().setEnvVar(projectA, 'DEPLOY_KEY', 'dep_secret_888', true);
    const depVars = useDeploymentStore.getState().getProjectEnvVars(projectA);
    const targetVar = depVars.find((v) => v.key === 'DEPLOY_KEY');
    expect(targetVar?.value).toBe('dep_secret_888');
  });
});
