// Check the declarations the roadmap function actually includes, using Node 24's
// glob engines. The caller supplies the real checker selector and root lib.
import assert from 'node:assert/strict';
import { globSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, matchesGlob, posix } from 'node:path';

export function assertTypeScriptLibPackaging({ root, isCheckerLibFile, rootLib }) {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  const pattern = config.functions['api/quiz/roadmap.ts']?.includeFiles;
  assert.equal(typeof pattern, 'string', 'the roadmap includeFiles pattern is present');
  const libPrefix = 'node_modules/typescript/lib/';
  const libDir = join(root, libPrefix);
  const diskNames = readdirSync(libDir).filter((name) => /^lib\..*\.d\.ts$/.test(name));
  const expected = diskNames.filter(isCheckerLibFile).sort();
  assert.ok(expected.includes(rootLib), 'the checker root is in the reader selection');

  const assertSelection = (candidate) => {
    const included = globSync(candidate, { cwd: root }).map((name) => name.replaceAll('\\', '/'));
    const actual = included.filter((name) => name.startsWith(libPrefix)).map((name) => basename(name)).sort();
    assert.deepEqual(actual, expected, 'packaged declarations match the reader selection');
    const matched = diskNames.filter((name) => matchesGlob(`${libPrefix}${name}`, candidate)).sort();
    assert.deepEqual(matched, actual, 'globSync and matchesGlob select the same declarations');
    return new Set(actual);
  };
  const included = assertSelection(pattern);

  // These include nonexistent paths intentionally: they test nested brace
  // semantics, not whether a generated worker happens to exist before a build.
  for (const [name, expectedMatch] of [
    ['lib/coding/generated/quickjs-sandbox.cjs', true],
    [`${libPrefix}lib.es2023.d.ts`, true],
    [`${libPrefix}lib.esnext.disposable.d.ts`, true],
    [`${libPrefix}lib.decorators.d.ts`, true],
    [`${libPrefix}lib.decorators.legacy.d.ts`, true],
    [`${libPrefix}lib.dom.d.ts`, false],
    [`${libPrefix}lib.webworker.d.ts`, false],
    [`${libPrefix}lib.scripthost.d.ts`, false],
    [`${libPrefix}nested/lib.es2023.d.ts`, false],
    ['lib/coding/generated/not-a-worker.txt', false],
  ]) assert.equal(matchesGlob(name, pattern), expectedMatch, `${name}: includeFiles fixture`);

  const sources = new Map(expected.map((name) => [name, readFileSync(join(libDir, name), 'utf8')]));
  const assertClosure = (available) => {
    const pending = [rootLib];
    const seen = new Set();
    while (pending.length) {
      const name = pending.pop();
      if (seen.has(name)) continue;
      assert.ok(available.has(name), `${name}: required checker declaration is packaged`);
      seen.add(name);
      for (const reference of sources.get(name).matchAll(/<reference\b([^>]+)>/g)) {
        const attributes = Object.fromEntries([...reference[1].matchAll(/([\w-]+)=["']([^"']*)["']/g)].map((one) => [one[1], one[2]]));
        assert.equal(attributes.types, undefined, `${name}: external type reference needs an explicit packaging decision`);
        if (attributes.lib) pending.push(`lib.${attributes.lib}.d.ts`);
        if (attributes.path) pending.push(posix.normalize(posix.join(posix.dirname(name), attributes.path)));
      }
    }
    return seen;
  };
  // Only follow the configured root. Unused es*.full wrappers reference host
  // libs that this checker deliberately never supplies.
  const reachable = assertClosure(included);

  // Mutation controls prove that the contract rejects the old over-packaging
  // and a tempting under-packaging, and that reference traversal is effective.
  assert.throws(() => assertSelection('{lib/coding/generated/*.cjs,node_modules/typescript/lib/lib.*.d.ts}'), /packaged declarations match/);
  assert.throws(() => assertSelection('{lib/coding/generated/*.cjs,node_modules/typescript/lib/lib.es*.d.ts}'), /packaged declarations match/);
  assert.throws(() => assertClosure(new Set([...included].filter((name) => name !== 'lib.decorators.d.ts'))), /lib\.decorators\.d\.ts: required checker declaration/);
  console.log(`PASS cold start: the roadmap ships ${included.size} checker declarations with a closed ${reachable.size}-file root graph and no host declarations`);
}
