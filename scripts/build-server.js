import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function buildServer() {
  const startTime = Date.now();
  console.log('[build:server] Compiling production server with esbuild...');

  // Ensure output directory exists
  const distServerDir = path.resolve(rootDir, 'dist-server');
  if (!fs.existsSync(distServerDir)) {
    fs.mkdirSync(distServerDir, { recursive: true });
  }

  // 1. Bundle TypeScript server code into single Node ESM JavaScript entrypoint
  await build({
    entryPoints: [path.resolve(rootDir, 'server/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    packages: 'external',
    outfile: path.resolve(distServerDir, 'index.js'),
    sourcemap: true,
    banner: {
      js: '// SnapDeploy AI Production Server Runtime\n'
    }
  });

  // 2. Copy static template files if present
  const srcTemplates = path.resolve(rootDir, 'server/templates');
  const destTemplates = path.resolve(distServerDir, 'templates');
  if (fs.existsSync(srcTemplates)) {
    fs.cpSync(srcTemplates, destTemplates, { recursive: true });
    console.log('[build:server] Copied server templates to dist-server/templates');
  }

  const duration = Date.now() - startTime;
  console.log(`[build:server] Server compiled successfully to dist-server/index.js in ${duration}ms`);
}

buildServer().catch((err) => {
  console.error('[build:server] Fatal error during server compilation:', err);
  process.exit(1);
});
