import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const outFile = path.resolve(process.cwd(), 'api', 'index.mjs');
fs.mkdirSync(path.dirname(outFile), { recursive: true });

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
