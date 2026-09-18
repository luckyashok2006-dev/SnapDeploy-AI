import fs from 'fs';
import path from 'path';

const patterns = [
  'setTimeout',
  'setInterval',
  'simulate',
  'simulation',
  'mock',
  'fake',
  'demo',
  'hard-coded',
  'PASS',
  'server ready',
  '0 errors',
  'success: true',
  'tokensUsed',
  'latency',
  'vulnerabilities',
  'GitHub URL'
];

function searchDir(dir: string): { file: string; line: number; pattern: string; snippet: string }[] {
  let matches: { file: string; line: number; pattern: string; snippet: string }[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git' && entry.name !== 'scratch') {
        matches = matches.concat(searchDir(fullPath));
      }
    } else if (/\.(ts|tsx|js|json|css|html)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        for (const p of patterns) {
          if (lineText.toLowerCase().includes(p.toLowerCase())) {
            matches.push({
              file: path.relative(process.cwd(), fullPath).replace(/\\/g, '/'),
              line: idx + 1,
              pattern: p,
              snippet: lineText.trim().slice(0, 100)
            });
          }
        }
      });
    }
  }

  return matches;
}

const results = searchDir(process.cwd());
console.log(`Total suspicious occurrences found: ${results.length}`);
results.forEach((r) => {
  console.log(`[${r.pattern}] ${r.file}:${r.line} -> ${r.snippet}`);
});
