// Bundles src/index.ts (and the shared/ modules it re-exports) into ESM and
// CommonJS, then writes matching TypeScript declarations for each format.
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
// Node's TypeScript resolution needs matching extensions for the entry
// and every relative import within its declaration graph.
function writeDeclarationFormats(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      writeDeclarationFormats(file);
      continue;
    }
    if (!entry.name.endsWith('.d.ts')) continue;
    const source = readFileSync(file, 'utf8');
    const withExtension = (ext) => source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(?:\.js)?(['"])/g, `$1$2.${ext}$3`);
    writeFileSync(file, withExtension('js'));
    writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), withExtension('cjs'));
  }
}
writeDeclarationFormats(path.join(dist, 'types'));
const entry = './types/packages/coding-evaluator/src/index';
writeFileSync(path.join(dist, 'index.d.ts'), `export * from '${entry}.js';\n`);
writeFileSync(path.join(dist, 'index.d.cts'), `export * from '${entry}.cjs';\n`);
console.log('built', readFileSync(path.join(dist, 'index.js')).length, 'bytes (esm)');
