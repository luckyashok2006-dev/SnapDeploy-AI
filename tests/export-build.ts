import fs from 'fs';
import path from 'path';
import { geminiAIProvider } from '../server/providers/GeminiAIProvider';
import { execSync } from 'child_process';

async function testExportAndBuild() {
  const targetDir = path.resolve(process.cwd(), 'scratch/test-app');
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const payload = await geminiAIProvider.generateProject({
    prompt: 'Build a simple SaaS invoice dashboard with a responsive sidebar, revenue metric cards, a customer table, and an invoice table.'
  });

  for (const [filePath, content] of Object.entries(payload.files)) {
    const fullPath = path.join(targetDir, filePath.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  console.log(`[Export Test] Generated ${Object.keys(payload.files).length} files to ${targetDir}`);
  console.log('[Export Test] Installing dependencies in generated app...');
  execSync('npm install', { cwd: targetDir, stdio: 'inherit' });

  console.log('[Export Test] Running production build in generated app...');
  execSync('npm run build', { cwd: targetDir, stdio: 'inherit' });

  console.log('[Export Test] SUCCESS: Generated project built cleanly with zero errors!');
}

testExportAndBuild().catch(err => {
  console.error('[Export Test] FAILED:', err);
  process.exit(1);
});
