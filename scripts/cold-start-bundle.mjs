// One CommonJS/packages-external compiler boundary for contracts and the lab.
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

/**
 * @param {string} entry
 * @param {string} outfile
 * @param {readonly string[]} [markers]
 * @param {string} [sourceRoot]
 * @param {boolean} [quiet]
 */
export async function bundleColdEntry(entry, outfile, markers = [], sourceRoot = process.cwd(), quiet = false) {
  // esbuild resolves source symlinks before onLoad (including macOS /var).
  const canonicalRoot = realpathSync(sourceRoot);
  await build({
    entryPoints: [join(canonicalRoot, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    outfile,
    logLevel: quiet ? 'silent' : 'warning',
    absWorkingDir: canonicalRoot,
    plugins: markers.length ? [{
      name: 'evaluation-markers',
      setup(plugin) {
        const wanted = new Set(markers.map(file => join(canonicalRoot, file)));
        plugin.onLoad({ filter: /\.ts$/ }, async args => {
          if (!wanted.has(args.path)) return undefined;
          const marker = `(globalThis.__evaluated ??= []).push(${JSON.stringify(args.path.slice(canonicalRoot.length + 1))});\n`;
          return { contents: marker + await readFile(args.path, 'utf8'), loader: 'ts' };
        });
      },
    }] : [],
  });
}
