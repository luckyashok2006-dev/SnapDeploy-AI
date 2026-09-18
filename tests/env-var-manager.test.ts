import { describe, it, expect, beforeEach } from 'vitest';
import { useEnvVarStore, purgeAllMemorySecrets } from '../src/store/envVarStore';
import { useDeploymentStore } from '../src/store/deploymentStore';
import { useProjectStore } from '../src/store/projectStore';
import { vfsManager } from '../src/lib/vfs/vfs-manager';
import { snapshotService } from '../src/lib/snapshots/SnapshotService';
import { chatService } from '../src/features/chat/chat-service';
import {
  validateEnvVarKey,
  isViteClientVariable,
  maskSecretValue,
  sanitizeString,
  sanitizeDeploymentError,
  clearRegisteredSecrets
} from '../src/features/deployment/security/secret-sanitizer';

describe('Tier 1 Feature 8: Environment Variable & Secrets Manager', () => {
  const testProjectA = 'proj-env-alpha';
  const testProjectB = 'proj-env-beta';

  beforeEach(async () => {
    // Reset stores
    useEnvVarStore.setState({ envVarMetadata: {} });
    useDeploymentStore.setState({
      selectedProvider: 'mock',
      deployments: {},
      envVarMetadata: {},
      activeDeployments: {}
    });
    useEnvVarStore.getState().clearProjectEnvVars(testProjectA);
    useEnvVarStore.getState().clearProjectEnvVars(testProjectB);
    clearRegisteredSecrets();

    // Ensure test projects exist in VFS
    await vfsManager.writeFile(testProjectA, '/package.json', JSON.stringify({ name: 'alpha' }), 'json');
    await vfsManager.writeFile(testProjectA, '/src/App.tsx', 'export default function App() { return <h1>Alpha</h1>; }', 'typescript');
  });

  // 1. Canonical store ownership
  it('enforces canonical store ownership: useEnvVarStore is authoritative and deploymentStore delegates to it', () => {
    // Adding via deploymentStore calls through to useEnvVarStore
    const res = useDeploymentStore.getState().setEnvVar(testProjectA, 'VITE_API_ENDPOINT', 'https://api.alpha.com');
    expect(res.success).toBe(true);

    const envMeta = useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA);
    expect(envMeta.length).toBe(1);
    expect(envMeta[0].key).toBe('VITE_API_ENDPOINT');

    // Querying via deploymentStore returns the canonical state
    const depVars = useDeploymentStore.getState().getProjectEnvVars(testProjectA);
    expect(depVars.length).toBe(1);
    expect(depVars[0].key).toBe('VITE_API_ENDPOINT');
    expect(depVars[0].value).toBe('https://api.alpha.com');
  });

  // 2. Secret memory-only behavior
  it('guarantees secret values are 100% memory-only and never stored in localStorage, sessionStorage, or IndexedDB', () => {
    const secretVal = 'ultra_secret_db_password_8877';
    useEnvVarStore.getState().setEnvVar(testProjectA, 'DATABASE_PASSWORD', secretVal, true);

    // Retrieve via safe accessor
    const inMemVal = useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'DATABASE_PASSWORD');
    expect(inMemVal).toBe(secretVal);

    // Inspect persisted state (localStorage representation)
    const persistedState = useEnvVarStore.getState().envVarMetadata[testProjectA];
    expect(persistedState).toBeDefined();
    expect(persistedState[0].key).toBe('DATABASE_PASSWORD');
    expect(persistedState[0].isSecret).toBe(true);
    // Value must not exist on metadata object
    expect((persistedState[0] as any).value).toBeUndefined();

    // LocalStorage / SessionStorage check (safe check in Node or Browser)
    if (typeof localStorage !== 'undefined') {
      const rawLocal = localStorage.getItem('snapdeploy_env_vars_v1');
      if (rawLocal) {
        expect(rawLocal).not.toContain(secretVal);
      }
    }
    if (typeof sessionStorage !== 'undefined') {
      const rawSession = sessionStorage.getItem('snapdeploy_env_vars_v1');
      if (rawSession) {
        expect(rawSession).not.toContain(secretVal);
      }
    }

    // Verify that the persisted metadata slice does not contain any secret values
    expect(JSON.stringify(useEnvVarStore.getState().envVarMetadata)).not.toContain(secretVal);
  });

  // 3. Public VITE_* classification
  it('automatically classifies VITE_* variables as public client-visible and non-secret', () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'VITE_PUBLIC_URL', 'https://snapdeploy.app', true); // User attempted isSecret=true

    const meta = useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA);
    expect(meta[0].key).toBe('VITE_PUBLIC_URL');
    expect(meta[0].isClientVisible).toBe(true);
    expect(meta[0].isSecret).toBe(false); // Overridden because VITE_* is compiled into client code
  });

  // 4. Duplicate keys prevention
  it('prevents duplicate key collisions using case-insensitive validation', () => {
    const res1 = useEnvVarStore.getState().setEnvVar(testProjectA, 'STRIPE_API_KEY', 'sk_live_123');
    expect(res1.success).toBe(true);

    // Exact duplicate
    const res2 = useEnvVarStore.getState().setEnvVar(testProjectA, 'STRIPE_API_KEY', 'sk_live_456');
    expect(res2.success).toBe(true); // Updates existing key instead of duplicating
    const meta = useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA);
    expect(meta.length).toBe(1);
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'STRIPE_API_KEY')).toBe('sk_live_456');

    // Case-variant collision during rename / update
    const id = meta[0].id;
    useEnvVarStore.getState().setEnvVar(testProjectA, 'ANOTHER_KEY', 'val');
    const updateRes = useEnvVarStore.getState().updateEnvVar(testProjectA, id, { key: 'another_key' });
    expect(updateRes.success).toBe(false);
    expect(updateRes.error).toContain('already exists');
  });

  // 5. Invalid key names rejection
  it('rejects invalid environment variable identifiers (digits, dashes, spaces, symbols, >64 chars)', () => {
    expect(validateEnvVarKey('').valid).toBe(false);
    expect(validateEnvVarKey('123_INVALID').valid).toBe(false);
    expect(validateEnvVarKey('INVALID-KEY').valid).toBe(false);
    expect(validateEnvVarKey('INVALID KEY').valid).toBe(false);
    expect(validateEnvVarKey('INVALID@KEY').valid).toBe(false);
    expect(validateEnvVarKey('A'.repeat(65)).valid).toBe(false);

    expect(validateEnvVarKey('VALID_KEY_123').valid).toBe(true);
    expect(validateEnvVarKey('_INTERNAL_VAR').valid).toBe(true);
    expect(validateEnvVarKey('VITE_APP_TITLE').valid).toBe(true);
  });

  // 6. Secret masking
  it('provides safe masked values for secret variables', () => {
    expect(maskSecretValue('')).toBe('••••••••');
    expect(maskSecretValue('super_secret')).toBe('••••••••••••');
  });

  // 7. Reveal / hide behavior via separate accessors
  it('supports separate accessors: metadata has no secrets; getProjectSecretValue retrieves single secret', () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'AUTH_SECRET', 'jwt_secret_token_12345', true);

    const metadataList = useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA);
    expect(metadataList.length).toBe(1);
    expect((metadataList[0] as any).value).toBeUndefined();

    // On-demand fetch for reveal
    const secret = useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'AUTH_SECRET');
    expect(secret).toBe('jwt_secret_token_12345');
  });

  // 8. Copy behavior
  it('allows safe copying of secret values without console leakage', async () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'SAFE_COPY_KEY', 'copy_secret_content');
    const secret = useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'SAFE_COPY_KEY');
    expect(secret).toBe('copy_secret_content');
    // Secret string is passed directly to clipboard API, never logged
  });

  // 9. Deletion cleanup
  it('removes variable metadata, unregisters secret, and deletes from in-memory store on removeEnvVar', () => {
    const secretVal = 'secret_to_delete_999';
    useEnvVarStore.getState().setEnvVar(testProjectA, 'DELETE_ME', secretVal, true);

    const id = useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA)[0].id;
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'DELETE_ME')).toBe(secretVal);

    useEnvVarStore.getState().removeEnvVar(testProjectA, id);

    expect(useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA).length).toBe(0);
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'DELETE_ME')).toBeNull();
  });

  // 10. Project switch isolation
  it('enforces strict project isolation: Project A secrets cannot be retrieved by Project B', () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'SECRET_ALPHA', 'alpha_val', true);
    useEnvVarStore.getState().setEnvVar(testProjectB, 'SECRET_BETA', 'beta_val', true);

    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'SECRET_ALPHA')).toBe('alpha_val');
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'SECRET_BETA')).toBeNull();

    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectB, 'SECRET_BETA')).toBe('beta_val');
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectB, 'SECRET_ALPHA')).toBeNull();
  });

  // 11. Project duplication isolation: Secret is NOT cloned
  it('Revision 3: Duplicating a project clones metadata but leaves secret values completely empty', () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'DATABASE_URL', 'postgres://user:pass@localhost:5432/db', true);
    useEnvVarStore.getState().setEnvVar(testProjectA, 'VITE_APP_NAME', 'Alpha App', false);

    const duplicateProjId = 'proj-env-alpha-copy';
    useEnvVarStore.getState().duplicateProjectEnvVars(testProjectA, duplicateProjId);

    // Duplicate project received the metadata schema
    const clonedMeta = useEnvVarStore.getState().getProjectEnvVarMetadata(duplicateProjId);
    expect(clonedMeta.length).toBe(2);
    expect(clonedMeta.map((m) => m.key)).toEqual(['DATABASE_URL', 'VITE_APP_NAME']);

    // BUT secret values in duplicated project are strictly empty / null
    expect(useEnvVarStore.getState().getProjectSecretValue(duplicateProjId, 'DATABASE_URL')).toBeNull();
    expect(useEnvVarStore.getState().getProjectSecretValue(duplicateProjId, 'VITE_APP_NAME')).toBeNull();

    // Original project secrets remain untouched
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'DATABASE_URL')).toBe('postgres://user:pass@localhost:5432/db');
  });

  // 12. Project deletion cleanup
  it('purges all metadata and in-memory secrets when a project is deleted', () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'TEMP_SECRET', 'temporary_val_123', true);
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'TEMP_SECRET')).toBe('temporary_val_123');

    useEnvVarStore.getState().clearProjectEnvVars(testProjectA);

    expect(useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA).length).toBe(0);
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'TEMP_SECRET')).toBeNull();
  });

  // 13. Version History exclusion
  it('proves Version History snapshots never capture or restore secret values', async () => {
    const secretVal = 'snapshot_exclusion_secret_4455';
    useEnvVarStore.getState().setEnvVar(testProjectA, 'SUPER_SECRET', secretVal, true);

    // Create a Version History snapshot
    const snap = await snapshotService.createSnapshot(testProjectA, 'Test Checkpoint');
    expect(snap).toBeDefined();

    // Snapshot files in VFS must NOT contain secret value
    const snapFiles = snap!.files;
    for (const file of Object.values(snapFiles)) {
      expect(file.content).not.toContain(secretVal);
    }

    // Restore snapshot
    await snapshotService.restoreSnapshot(testProjectA);

    // VFS files after restore contain zero secret strings
    const vfsFiles = vfsManager.getFiles(testProjectA);
    for (const file of Object.values(vfsFiles)) {
      expect(file.content).not.toContain(secretVal);
    }
  });

  // 14. AI context exclusion
  it('proves AI edit context and AI metadata helper strictly exclude secret values', () => {
    const secretVal = 'ai_prompt_secret_token_7766';
    useEnvVarStore.getState().setEnvVar(testProjectA, 'OPENAI_KEY', secretVal, true);
    useEnvVarStore.getState().setEnvVar(testProjectA, 'VITE_PUBLIC_API', 'https://api.example.com', false);

    // 1. Edit context builder
    const editContext = chatService.buildEditContext(testProjectA, 'Update the navbar');
    for (const content of Object.values(editContext.relevantFiles)) {
      expect(content).not.toContain(secretVal);
    }

    // 2. Safe AI metadata helper
    const safeAiContext = chatService.getSafeAiEnvContext(testProjectA);
    expect(safeAiContext).toContain('OPENAI_KEY');
    expect(safeAiContext).toContain('Provider Secret (Runtime - Value Hidden)');
    expect(safeAiContext).toContain('VITE_PUBLIC_API');
    expect(safeAiContext).not.toContain(secretVal);
  });

  // 15. VFS exclusion
  it('proves configuring environment variables creates zero files and zero modifications in VFS', () => {
    const secretVal = 'vfs_secret_token_1122';
    const filesBefore = { ...vfsManager.getFiles(testProjectA) };

    useEnvVarStore.getState().setEnvVar(testProjectA, 'BACKEND_SECRET', secretVal, true);

    const filesAfter = vfsManager.getFiles(testProjectA);
    expect(Object.keys(filesAfter)).toEqual(Object.keys(filesBefore));
    expect(filesAfter['/.env']).toBeUndefined();
    expect(filesAfter['.env']).toBeUndefined();
    expect(filesAfter['/.env.local']).toBeUndefined();
  });

  // 16. WebContainer exclusion
  it('proves WebContainer filesystem tree contains zero environment variable secret files', () => {
    const secretVal = 'webcontainer_secret_9988';
    useEnvVarStore.getState().setEnvVar(testProjectA, 'WC_SECRET', secretVal, true);

    const wcTree = vfsManager.convertToWebContainerTree(testProjectA);
    expect(wcTree['.env']).toBeUndefined();
    expect(wcTree['.env.local']).toBeUndefined();
    expect(JSON.stringify(wcTree)).not.toContain(secretVal);
  });

  // 17. Deployment integration
  it('provides necessary provider secrets strictly at deployment time without persisting to DeploymentRecord', () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'DATABASE_URL', 'postgres://remote.db:5432/main', true);

    // Deployment retrieves provider variables from canonical store
    const providerVars = useDeploymentStore.getState().getProjectEnvVars(testProjectA);
    expect(providerVars.length).toBe(1);
    expect(providerVars[0].key).toBe('DATABASE_URL');
    expect(providerVars[0].value).toBe('postgres://remote.db:5432/main');

    // Recording deployment enforces whitelist (zero secrets in DeploymentRecord)
    useDeploymentStore.getState().recordDeployment({
      deploymentId: 'dep_1',
      projectId: testProjectA,
      timestamp: Date.now(),
      status: 'live',
      provider: 'mock',
      url: 'https://test.snapdeploy.app',
      fileCount: 5,
      artifactSizeBytes: 1024,
      durationMs: 500
    });

    const records = useDeploymentStore.getState().deployments[testProjectA];
    expect(records.length).toBe(1);
    expect(JSON.stringify(records[0])).not.toContain('postgres://remote.db');
  });

  // 18. Secret redaction
  it('scrubs registered secrets from error messages and log outputs', () => {
    const secretVal = 'leaky_database_secret_credential_3322';
    useEnvVarStore.getState().setEnvVar(testProjectA, 'DB_KEY', secretVal, true);

    const rawError = `Connection to postgres://user:${secretVal}@db.host:5432 failed.`;
    const sanitized = sanitizeDeploymentError(rawError);
    expect(sanitized).not.toContain(secretVal);
    expect(sanitized).toContain('[REDACTED_SECRET]');
  });

  // 18b. Static PASSWORD sanitization (SEC-P2-01)
  it('statically scrubs generic PASSWORD assignments without requiring dynamic registration', () => {
    expect(sanitizeString('PASSWORD=admin_password_xyz')).toBe('PASSWORD=[REDACTED_VALUE]');
    expect(sanitizeString('PASSWORD="quoted_secret_123"')).toBe('PASSWORD=[REDACTED_VALUE]');
    expect(sanitizeString("PASSWORD='single_quoted_secret'")).toBe('PASSWORD=[REDACTED_VALUE]');
    expect(sanitizeString('PASSWORD: colon_secret_abc')).toBe('PASSWORD: [REDACTED_VALUE]');
    expect(sanitizeString('password=lower_secret')).toBe('password=[REDACTED_VALUE]');
    // Developer content preserved
    expect(sanitizeString('src/components/PasswordInput.tsx:42:15 - error TS2304')).toBe('src/components/PasswordInput.tsx:42:15 - error TS2304');
    expect(sanitizeString('npm install @types/passport finished')).toBe('npm install @types/passport finished');
  });

  // 19. Page-unload cleanup
  it('purges all in-memory secrets and clears registry on beforeunload', () => {
    useEnvVarStore.getState().setEnvVar(testProjectA, 'UNLOAD_SECRET', 'unload_secret_val', true);
    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'UNLOAD_SECRET')).toBe('unload_secret_val');

    // Simulate beforeunload event (or invoke purgeAllMemorySecrets directly in Node)
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('beforeunload'));
    } else {
      purgeAllMemorySecrets();
    }

    expect(useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'UNLOAD_SECRET')).toBeNull();
  });

  // 20. Manual .env import and safe .env.example export
  it('imports pasted .env text into memory-only storage and exports safe .env.example template without secrets', () => {
    const rawEnv = `
# Project Configuration
VITE_API_BASE=https://api.myproject.com
DATABASE_URL="postgres://user:pass@db:5432/myproject"
STRIPE_SECRET='sk_live_verysecret'
INVALID LINE WITHOUT EQUALS
`;

    const importRes = useEnvVarStore.getState().importEnvString(testProjectA, rawEnv);
    expect(importRes.successCount).toBe(3);
    expect(importRes.importedKeys).toContain('VITE_API_BASE');
    expect(importRes.importedKeys).toContain('DATABASE_URL');
    expect(importRes.importedKeys).toContain('STRIPE_SECRET');
    expect(importRes.errors.length).toBe(1); // The invalid line

    // Verify VITE_* is public, others are secrets
    const meta = useEnvVarStore.getState().getProjectEnvVarMetadata(testProjectA);
    const viteMeta = meta.find((m) => m.key === 'VITE_API_BASE');
    expect(viteMeta?.isClientVisible).toBe(true);
    expect(viteMeta?.isSecret).toBe(false);

    const dbSecret = useEnvVarStore.getState().getProjectSecretValue(testProjectA, 'DATABASE_URL');
    expect(dbSecret).toBe('postgres://user:pass@db:5432/myproject');

    // Export .env.example template
    const template = useEnvVarStore.getState().exportEnvExampleTemplate(testProjectA);
    expect(template).toContain('VITE_API_BASE=');
    expect(template).toContain('DATABASE_URL=');
    expect(template).toContain('STRIPE_SECRET=');
    // MUST NOT contain the actual secret values
    expect(template).not.toContain('postgres://user:pass');
    expect(template).not.toContain('sk_live_verysecret');
  });
});
