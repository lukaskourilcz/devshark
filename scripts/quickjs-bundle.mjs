// Narrow build-only removal of unused upstream defaults. Keep the published
// singlefile loader/FFI and the reviewed custom wasm ABI untouched.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const dependency = createRequire(import.meta.url);
const sdkEntry = dependency.resolve('quickjs-emscripten');
const coreEntry = createRequire(sdkEntry).resolve('quickjs-emscripten-core');
const retainedEntry = dependency.resolve('@jitl/quickjs-singlefile-cjs-release-sync');
const PINNED_INDEX_SHA = '027f256c48f7f4c74e0d1b2fe4e104827222f83219ecda3d7687c5009d9dc890';
const PINNED_LITERAL_SHA = 'c328202744daa3858533edbe71705f27f4fe7aaedc19858bb0f671efe03b5db5';
const PINNED_LITERAL_BYTES = 819611;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalized = (value) => value.replaceAll('\\', '/');

/** Data transform only: never execute the upstream package during the build.
 * Byte drift is a review event, even if an upstream version is unchanged. */
export function stripUnusedQuickJSWasm(source) {
  if (hash(source) !== PINNED_INDEX_SHA) throw new Error('Pinned QuickJS singlefile source changed; review the trim.');
  // Escaped backticks belong to the binary literal. Do not match the first
  // convenient pair of backticks or remove every large string in a module.
  const literals = [];
  let open = -1;
  // The full-file fingerprint above pins this source shape. A linear escaped
  // delimiter scan avoids a huge backtracking regex over the binary string.
  for (let cursor = 0; cursor < source.length; cursor++) {
    if (source[cursor] === '\\') { cursor++; continue; }
    if (source[cursor] !== '`') continue;
    if (open < 0) open = cursor;
    else {
      const value = source.slice(open, cursor + 1);
      if (value.startsWith('`\\0asm')) literals.push({ index: open, value });
      open = -1;
    }
  }
  if (literals.length !== 1 || Buffer.byteLength(literals[0].value) !== PINNED_LITERAL_BYTES || hash(literals[0].value) !== PINNED_LITERAL_SHA) {
    throw new Error('Expected exactly the reviewed unused QuickJS wasm literal.');
  }
  const literal = literals[0];
  return source.slice(0, literal.index) + '``' + source.slice(literal.index + literal.value.length);
}

/** Inspect actual esbuild graph/output metadata, not source config strings. */
export function assertQuickJSBundleMetadata(metafile, root = process.cwd()) {
  if (!metafile?.inputs || !metafile?.outputs) throw new Error('QuickJS bundle metadata is required.');
  const keys = Object.keys(metafile.inputs);
  const absolute = (input) => normalized(resolve(root, input));
  const forbidden = keys.filter((input) => /(?:^|\/)node_modules\/(?:quickjs-emscripten\/|@jitl\/quickjs-wasmfile-)/.test(normalized(input)));
  if (forbidden.length) throw new Error('An unused QuickJS default/variant entered the bundle.');
  const required = [realpathSync(coreEntry), realpathSync(retainedEntry), realpathSync(join(root, 'lib/coding/vendor/quickjs-node24.cjs'))].map(normalized);
  for (const expected of required) {
    const input = keys.find((key) => absolute(key) === expected);
    if (!input || !Object.values(metafile.outputs).some((output) => output.inputs?.[input]?.bytesInOutput > 0)) {
      throw new Error('The retained QuickJS core/loader/custom payload is absent from bundle output.');
    }
  }
  for (const output of Object.values(metafile.outputs)) {
    if (output.imports?.some((one) => one.external && /^(?:quickjs-emscripten(?:-core)?|@jitl\/quickjs-)/.test(one.path))) {
      throw new Error('QuickJS runtime packages must stay inside the bundle.');
    }
  }
}

export function pinnedQuickJSBundle() {
  let stripped = 0;
  return {
    name: 'pinned-quickjs-runtime',
    setup(build) {
      build.onStart(() => {
        stripped = 0;
        if (!build.initialOptions.metafile) throw new Error('QuickJS builds must retain graph metadata.');
        const root = process.cwd();
        const manifest = JSON.parse(readFileSync(join(root, 'lib/coding/vendor/provenance.json'), 'utf8'));
        const core = JSON.parse(readFileSync(join(dirname(coreEntry), '..', 'package.json'), 'utf8'));
        const retained = JSON.parse(readFileSync(dependency.resolve('@jitl/quickjs-singlefile-cjs-release-sync/package.json'), 'utf8'));
        if (manifest.build.abiSdk !== '0.32.0' || core.version !== manifest.build.abiSdk || retained.version !== manifest.build.abiSdk) throw new Error('Pinned QuickJS ABI/package versions differ.');
        if (hash(readFileSync(join(root, 'lib/coding/vendor/quickjs-node24.cjs'))) !== manifest.artifact.sha256) throw new Error('Reviewed custom QuickJS payload changed.');
      });
      build.onResolve({ filter: /^(?:quickjs-emscripten(?:-core)?|@jitl\/quickjs-[^/]+)(?:\/.*)?$/ }, (args) => {
        if (args.path === 'quickjs-emscripten') return { path: coreEntry, external: false };
        if (args.path.startsWith('quickjs-emscripten/') || args.path.startsWith('@jitl/quickjs-wasmfile-')) throw new Error('Unused QuickJS registry/variant import is outside the pinned runtime.');
        return { path: dependency.resolve(args.path, { paths: [args.resolveDir || process.cwd()] }), external: false };
      });
      build.onLoad({ filter: /[/\\]@jitl[/\\]quickjs-singlefile-cjs-release-sync[/\\]dist[/\\]index\.js$/ }, (args) => {
        if (realpathSync(args.path) !== realpathSync(retainedEntry)) throw new Error('Unexpected singlefile runtime source.');
        stripped++;
        return { contents: stripUnusedQuickJSWasm(readFileSync(args.path, 'utf8')), loader: 'js', resolveDir: dirname(args.path) };
      });
      build.onEnd((result) => {
        if (result.errors.length) return;
        if (stripped !== 1) throw new Error('The pinned unused wasm literal must be stripped exactly once per runtime build.');
        assertQuickJSBundleMetadata(result.metafile);
      });
    },
  };
}
