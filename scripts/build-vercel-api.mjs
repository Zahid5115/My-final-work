import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const apiDir = path.resolve(process.cwd(), 'api');
const outFile = path.join(apiDir, '_handler.js');
const legacyMjs = path.join(apiDir, 'index.mjs');
fs.mkdirSync(apiDir, { recursive: true });
if (fs.existsSync(legacyMjs)) {
  fs.unlinkSync(legacyMjs);
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
