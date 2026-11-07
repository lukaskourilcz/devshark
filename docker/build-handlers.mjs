// Bundles each of the twelve api/ handlers into docker/dist/api/<path>.cjs for
// docker/server.mjs. Dependencies stay in node_modules, as on Vercel.
import { build } from 'esbuild';
import { readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = 'docker/dist/api';
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : entry.name.endsWith('.ts') ? [file] : [];
});
const handlers = walk('api').sort();
if (handlers.length !== 12) throw new Error(`expected twelve handlers under api/, found ${handlers.length}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: handlers, outdir: out, outbase: 'api', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', packages: 'external', logLevel: 'warning',
});
const manifest = handlers.map((file) => path.relative('api', file).split(path.sep).join('/').replace(/\.ts$/, '.cjs'));
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`bundled ${manifest.length} handlers into ${out}`);
