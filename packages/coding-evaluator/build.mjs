// Bundles src/index.ts (and the shared/ modules it re-exports) into ESM and
// CommonJS, then writes one flat declaration file with the TypeScript API.
import { build } from 'esbuild';
import { rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

const common = { entryPoints: [path.join(here, 'src/index.ts')], bundle: true, platform: 'neutral', target: 'es2022', logLevel: 'warning' };
await build({ ...common, format: 'esm', outfile: path.join(dist, 'index.js') });
await build({ ...common, format: 'cjs', outfile: path.join(dist, 'index.cjs') });

// Declarations: tsc emits the entry and the shared modules it re-exports
// under dist/types, keeping their relative layout so every path resolves.
const program = ts.createProgram([path.join(here, 'src/index.ts')], {
  declaration: true, emitDeclarationOnly: true, outDir: path.join(dist, 'types'), rootDir: path.resolve(here, '../..'),
  strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
});
const emitted = program.emit();
const errors = ts.getPreEmitDiagnostics(program).concat(emitted.diagnostics);
if (errors.length) {
  console.error(ts.formatDiagnostics(errors, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => here, getNewLine: () => '\n' }));
  process.exit(1);
}
// NodeNext consumers need explicit extensions on relative specifiers.
const addExtensions = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { addExtensions(file); continue; }
    writeFileSync(file, readFileSync(file, 'utf8').replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(?<!\.js)(['"])/g, '$1$2.js$3'));
  }
};
addExtensions(path.join(dist, 'types'));
const entry = './types/packages/coding-evaluator/src/index';
writeFileSync(path.join(dist, 'index.d.ts'), `export * from '${entry}.js';\n`);
console.log('built', readFileSync(path.join(dist, 'index.js')).length, 'bytes (esm)');
