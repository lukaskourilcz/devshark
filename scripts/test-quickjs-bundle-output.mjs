// F11-20/32: inspect both artifacts from the actual normal builder.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

execFileSync(process.execPath, ['scripts/build-react-runner.mjs'], { stdio: 'inherit' });
const payloadSource = readFileSync('lib/coding/vendor/quickjs-node24.cjs', 'utf8');
const encoded = payloadSource.match(/module\.exports = ("[A-Za-z0-9+/=]+");/);
assert.ok(encoded);
const customPayload = JSON.parse(encoded[1]);
// Exact reviewed data slice, independent of the future transform helper.
// Pin both full source and literal so a different package cannot become a
// false green merely by moving or changing the fallback representation.
const dependency = createRequire(import.meta.url);
const retainedSource = readFileSync(dependency.resolve('@jitl/quickjs-singlefile-cjs-release-sync'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(retainedSource), '027f256c48f7f4c74e0d1b2fe4e104827222f83219ecda3d7687c5009d9dc890');
const unusedFallback = retainedSource.slice(16474, 836085);
assert.equal(Buffer.byteLength(unusedFallback), 819611);
assert.equal(hash(unusedFallback), 'c328202744daa3858533edbe71705f27f4fe7aaedc19858bb0f671efe03b5db5');
for (const file of ['react-sandbox.cjs', 'quickjs-sandbox.cjs']) {
  const output = readFileSync(`lib/coding/generated/${file}`, 'utf8');
  test(`${file} retains the actual reviewed custom wasm payload`, () => {
    assert.ok(output.includes(customPayload), 'the active pinned payload must survive the bundle change');
  });
  test(`${file} excludes all unused default wasmfile variants`, () => {
    assert.equal(/node_modules\/@jitl\/quickjs-wasmfile-(?:debug|release)-(?:sync|asyncify)\//.test(output),false,'unused wasmfile variants are absent');
    assert.equal(/node_modules\/quickjs-emscripten\/dist\//.test(output),false,'default SDK registry is absent');
  });
  test(`${file} excludes the reviewed unused singlefile fallback`, () => {
    assert.equal(output.includes(unusedFallback), false, 'the inactive upstream wasm fallback is absent');
  });
}
