// Check explicit includes and the declaration trace ceiling using Node 24's
// glob engines. This config contract is not a deployed Lambda inventory.
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

  // Includes are additive: NFT can trace the entire compiler lib directory
  // through filesystem reads or its TypeScript special case. Protect both
  // applicable rules against that observed input, not just the worker trace.
  const declarations = readdirSync(libDir).filter((name) => name.endsWith('.d.ts')).sort();
  const nonreader = declarations.filter((name) => !expected.includes(name));
  const assertTraceCeiling = (rule, explicit = []) => {
    const excluded = rule?.excludeFiles;
    assert.equal(typeof excluded, 'string', 'each function rule excludes traced nonreader declarations');
    assert.ok(excluded.length <= 256, 'excludeFiles fits the provider schema');
    const excludedOnDisk = globSync(excluded, { cwd: root }).map((name) => name.replaceAll('\\', '/')).sort();
    assert.deepEqual(excludedOnDisk, nonreader.map((name) => `${libPrefix}${name}`),
      'exclusions select exactly the nonreader declarations');
    const remaining = declarations.filter((name) => !matchesGlob(`${libPrefix}${name}`, excluded));
    assert.deepEqual([...new Set([...remaining, ...explicit])].sort(), expected,
      'traced declarations plus additive includes match the reader selection');
    for (const name of ['typescript.js', 'tsc.js', '_tsc.js', 'package.json']) {
      assert.equal(matchesGlob(`${libPrefix}${name}`, excluded), false, `${name}: compiler runtime is retained`);
    }
    for (const name of ['node_modules/typescript/package.json', 'lib/coding/generated/ts-check-worker.cjs', 'lib/coding/generated/quickjs-sandbox.cjs']) {
      assert.equal(matchesGlob(name, excluded), false, `${name}: runtime metadata/bundles are retained`);
    }
  };
  for (const key of ['api/quiz/roadmap.ts', 'api/**/*.ts']) {
    assertTraceCeiling(config.functions[key], key === 'api/quiz/roadmap.ts' ? included : []);
  }

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
  assert.throws(() => assertTraceCeiling({}), /each function rule excludes/);
  assert.throws(() => assertTraceCeiling({ excludeFiles: `${libPrefix}lib.*.d.ts` }), /exclusions select exactly/);
  assert.throws(() => assertTraceCeiling({ excludeFiles: `${libPrefix}lib.{dom*,webworker*,scripthost}.d.ts` }), /exclusions select exactly/);
  assert.throws(() => assertTraceCeiling(config.functions['api/quiz/roadmap.ts'], declarations), /traced declarations plus additive includes/);
  console.log(`PASS cold start: config retains ${included.size} checker declarations with a closed ${reachable.size}-file root graph and excludes ${nonreader.length} nonreader declarations from both trace rules`);
}
