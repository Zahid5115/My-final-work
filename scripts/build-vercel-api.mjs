import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const apiDir = path.resolve(process.cwd(), 'api');
const outFile = path.join(apiDir, 'index.js');
fs.mkdirSync(apiDir, { recursive: true });

for (const legacy of ['index.mjs', 'app.js', '_handler.js', '[...path].js']) {
  const legacyPath = path.join(apiDir, legacy);
  if (fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
  }
}

await build({
  entryPoints: [path.resolve(process.cwd(), 'server', 'vercel-entry.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info'
});
