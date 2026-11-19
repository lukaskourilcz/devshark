// Measure an isolated build-only bank filter; never change repository banks.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
if (process.argv.length !== 4 || process.argv[2] !== '--out') {
  console.error('Usage: node scripts/measure-handler-banks.mjs --out <empty directory outside the repository>');
  process.exit(2);
}
const out = realpathSync(process.argv[3]);
const fromRoot = path.relative(root, out);
if (!fromRoot || (!fromRoot.startsWith('..' + path.sep) && !path.isAbsolute(fromRoot))) {
  console.error('Measurement output must be outside the repository.');
  process.exit(2);
}
if (readdirSync(out).length) {
  console.error('Measurement output directory must be empty.');
  process.exit(2);
}
const requireInstalled = createRequire(path.join(root, 'package.json'));
const esbuild = requireInstalled('esbuild');
const ts = requireInstalled('typescript');
const sha = (body) => createHash('sha256').update(body).digest('hex');
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
const snapshot = new Map();
const read = (file) => {
  const absolute = path.resolve(file);
  if (!snapshot.has(absolute)) snapshot.set(absolute, readFileSync(absolute, 'utf8'));
  return snapshot.get(absolute);
};
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : entry.name.endsWith('.ts') ? [file] : [];
});
const handlers = walk(path.join(root, 'api')).sort();
assert.equal(handlers.length, 12);

const config = {
  entryPoints: handlers, outbase: path.join(root, 'api'), outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', packages: 'external', logLevel: 'warning',
  metafile: true, write: false, absWorkingDir: root,
};
let replacement;
let transformedLoads = 0;
function snapshotPlugin(prototype) {
  return { name: 'external-measurement-source-snapshot', setup(build) {
    build.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, (args) => {
      const original = read(args.path);
      if (prototype && rel(args.path) === 'lib/quiz-data.ts') transformedLoads++;
      const contents = prototype && rel(args.path) === 'lib/quiz-data.ts' ? replacement : original;
      const extension = path.extname(args.path).slice(1);
      const loader = extension === 'json' ? 'json' : extension === 'tsx' ? 'tsx' : extension === 'jsx' ? 'jsx'
        : extension === 'ts' || extension === 'mts' || extension === 'cts' ? 'ts' : 'js';
      return { contents, loader, resolveDir: path.dirname(args.path) };
    });
  } };
}

mkdirSync(out, { recursive: true });
const started = performance.now();
const baseline = await esbuild.build({ ...config, outdir: path.join(out, 'baseline/handlers'), plugins: [snapshotPlugin(false)] });
const baselineMs = performance.now() - started;

const quizPath = path.join(root, 'lib/quiz-data.ts');
const quizText = read(quizPath);
const ast = ts.createSourceFile(quizPath, quizText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let core;
let coreReferences = 0;
function find(node) {
  if (ts.isIdentifier(node) && node.text === 'coreQuestions') coreReferences++;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'coreQuestions') core = node.initializer;
  ts.forEachChild(node, find);
}
find(ast);
assert.ok(core && ts.isArrayLiteralExpression(core));
assert.equal(coreReferences, 2, 'the core bank must remain private to its one existing assembly filter');
assert.match(quizText, /coreQuestions\.filter\(\(question\) => question\.category === 'code-snippets'\)/);
const retained = [];
const removed = [];
for (const node of core.elements) {
  assert.ok(ts.isObjectLiteralExpression(node), 'prototype only handles authored literal core questions');
  const property = (name) => node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(ast) === name)?.initializer;
  const category = property('category');
  const id = property('id');
  assert.ok(category && ts.isStringLiteral(category));
  assert.ok(id && ts.isStringLiteral(id));
  (category.text === 'code-snippets' ? retained : removed).push({ id: id.text, node });
}
replacement = quizText.slice(0, core.getStart(ast)) + '[\n' + retained.map((x) => x.node.getText(ast)).join(',\n') + '\n]'
  + quizText.slice(core.end);
writeFileSync(path.join(out, 'prototype-quiz-data.ts'), replacement);
const candidateStarted = performance.now();
const prototype = await esbuild.build({ ...config, outdir: path.join(out, 'prototype/handlers'), plugins: [snapshotPlugin(true)] });
const prototypeMs = performance.now() - candidateStarted;
assert.ok(transformedLoads > 0, 'the prototype must actually transform the canonical quiz-data source path');
assert.equal(prototype.metafile.inputs['lib/quiz-data.ts'].bytes, Buffer.byteLength(replacement));

// Evaluate only pure bank/registry/policy modules. This loader rejects Auth,
// API, database, environment and network modules; it executes no handler.
function dataLoader(candidate) {
  const cache = new Map();
  const load = (file) => {
    const absolute = path.resolve(file);
    const name = rel(absolute);
    assert.match(name, /^(?:lib\/(?:webdev-bank|quiz-data|roadmap-build|roadmap-questions[^/]*|curation-registry)|shared\/(?:curation|subject-catalog|retired-content))\.ts$/);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = candidate && name === 'lib/quiz-data.ts' ? replacement : read(absolute);
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    cache.set(absolute, module);
    const localRequire = (specifier) => {
      assert.ok(specifier.startsWith('.'), 'pure data import must be relative: ' + specifier);
      return load(path.resolve(path.dirname(absolute), specifier + (path.extname(specifier) ? '' : '.ts')));
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  };
  return (name) => load(path.join(root, name));
}
const originalData = dataLoader(false);
const candidateData = dataLoader(true);
const bank = await originalData('lib/webdev-bank.ts').loadWebdevQuestions();
const candidateBank = await candidateData('lib/webdev-bank.ts').loadWebdevQuestions();
assert.deepEqual(candidateBank, bank, 'full raw bank, history inputs, order, answer fields and external importer shape must match');
const { REVIEW_REGISTRY, AUDITED_CATEGORIES } = originalData('lib/curation-registry.ts');
const { eligibilityFrom } = originalData('shared/curation.ts');
const { subjectForCategory, deliveryCategories } = originalData('shared/subject-catalog.ts');
const registry = new Map(REVIEW_REGISTRY.map((row) => [row.id, row]));
const curationAst = ts.createSourceFile('curation.ts', read(path.join(root, 'lib/curation.ts')), ts.ScriptTarget.Latest, true);
const contentHashDeclaration = curationAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'contentHash');
assert.ok(contentHashDeclaration);
const contentHashCode = ts.transpileModule(contentHashDeclaration.getText(curationAst), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const hashExports = {};
new Function('exports', 'createHash', contentHashCode)(hashExports, createHash);
const contentHash = hashExports.contentHash;
const eligibility = (q) => eligibilityFrom(registry.get(q.id), contentHash(q), subjectForCategory(q.category) === 'webdev' && AUDITED_CATEGORIES.has(q.category));
const eligible = bank.filter((q) => eligibility(q).active);
const withheld = bank.filter((q) => !eligibility(q).active);
const deliveredCategories = new Set(deliveryCategories('webdev'));
const deliverable = eligible.filter((q) => deliveredCategories.has(q.category));
const versionTuple = (q) => [q.id, q.question, q.options, q.correctAnswer, q.explanation ?? '', q.introduction ?? '', q.tags ?? []];
assert.deepEqual(candidateBank.map(contentHash), bank.map(contentHash));
assert.deepEqual(candidateBank.map(versionTuple), bank.map(versionTuple));
assert.deepEqual(candidateBank.map(eligibility), bank.map(eligibility));

function saveBuild(label, build) {
  const directory = path.join(out, label);
  mkdirSync(path.join(directory, 'metafiles'), { recursive: true });
  for (const file of build.outputFiles) { mkdirSync(path.dirname(file.path), { recursive: true }); writeFileSync(file.path, file.contents); }
  writeFileSync(path.join(directory, 'metafile.json'), JSON.stringify(build.metafile, null, 2) + '\n');
  const sizes = [];
  for (const [file, output] of Object.entries(build.metafile.outputs)) {
    if (!output.entryPoint) continue;
    const id = output.entryPoint.replace(/^api\//, '').replace(/\.ts$/, '');
    const bankInputs = Object.entries(output.inputs).filter(([name]) => /^lib\/(?:quiz-data|roadmap-questions[^/]*)\.ts$/.test(name));
    const item = { handler: id, bytes: output.bytes, bankBytesInOutput: bankInputs.reduce((sum, [, row]) => sum + row.bytesInOutput, 0), bankInputs: Object.fromEntries(bankInputs) };
    sizes.push(item);
    writeFileSync(path.join(directory, 'metafiles', id.replaceAll('/', '--') + '.json'), JSON.stringify({ output, inputs: Object.fromEntries(Object.keys(output.inputs).map((name) => [name, build.metafile.inputs[name]])) }, null, 2) + '\n');
  }
  sizes.sort((a, b) => a.handler.localeCompare(b.handler));
  writeFileSync(path.join(directory, 'handler-sizes.json'), JSON.stringify(sizes, null, 2) + '\n');
  return sizes;
}
const before = saveBuild('baseline', baseline);
const after = saveBuild('prototype', prototype);
const comparisons = before.map((row) => {
  const candidate = after.find((next) => next.handler === row.handler);
  return { handler: row.handler, baselineBytes: row.bytes, prototypeBytes: candidate.bytes,
    savedBytes: row.bytes - candidate.bytes, percentSaved: 100 * (row.bytes - candidate.bytes) / row.bytes,
    baselineBankBytesInOutput: row.bankBytesInOutput, prototypeBankBytesInOutput: candidate.bankBytesInOutput };
});
const sourceInputs = [...snapshot].map(([name, body]) => ({ path: rel(name), bytes: Buffer.byteLength(body), sha256: sha(body) })).sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(path.join(out, 'source-inputs.json'), JSON.stringify(sourceInputs, null, 2) + '\n');
const oldSourceNames = ['lib/roadmap-questions-html.ts', 'lib/roadmap-questions-css.ts', 'lib/roadmap-questions-cool-stuff.ts', 'lib/roadmap-questions-testing.ts', 'lib/roadmap-questions-abbreviations.ts'];
const attribution = oldSourceNames.map((name) => ({ source: name, inputPresent: Boolean(baseline.metafile.inputs[name]),
  bytesAcrossHandlerOutputs: Object.values(baseline.metafile.outputs).reduce((sum, output) => sum + (output.inputs[name]?.bytesInOutput ?? 0), 0) }));
const summary = { recorded: new Date().toISOString(), root, headAtStart: head, headAtEnd: git('rev-parse', 'HEAD'), dirtyAtStart: dirty.split('\n').filter(Boolean),
  snapshot: 'onLoad source cache reused byte-for-byte between baseline and prototype; no repository source write',
  sourceInputCount: sourceInputs.length, sourceFingerprint: sha(JSON.stringify(sourceInputs)),
  node: process.version, esbuild: esbuild.version, typescript: ts.version,
  config: { bundle: true, platform: 'node', format: 'cjs', target: 'node24', packages: 'external', minify: false, splitting: false, sourceMap: false, handlers: 12 },
  seconds: { baseline: baselineMs / 1000, prototype: prototypeMs / 1000 },
  prototype: { transform: 'literal coreQuestions pruned by exact existing category === code-snippets private assembly filter', transformedLoads, coreBefore: core.elements.length, coreRetained: retained.length, coreRemovedFromOutput: removed.length, originalSourceBytes: Buffer.byteLength(quizText), prototypeSourceBytes: Buffer.byteLength(replacement), sourceBankDeletion: false },
  equivalence: { rawBankQuestions: bank.length, fullRawBankDeepEqual: true, orderedIdsHash: sha(JSON.stringify(bank.map((q) => q.id))), rawBankHash: sha(JSON.stringify(bank)), contentHashesEqual: true, versionInputsEqual: true, eligibilityEqual: true, eligibleQuestions: eligible.length, deliverableQuestions: deliverable.length, withheldHistoryQuestionsPreserved: withheld.length, registryUnchanged: true, codingSourcesUnmodified: true, runtimeGradingSuiteRun: false },
  aggressiveEligibilityFilter: { built: false, wouldRemoveRawHistoryQuestions: withheld.length, validCandidate: false, reason: 'question-store historyById/admin/override workflows deliberately retain withheld raw questions' },
  retiredSourceAttribution: attribution, comparisons,
  totals: { baselineBytes: before.reduce((sum, row) => sum + row.bytes, 0), prototypeBytes: after.reduce((sum, row) => sum + row.bytes, 0) },
  limitations: ['Bundled handler bytes are not Vercel deployment trace bytes, runtime image size or cold-start latency.', 'No handler, grader, production API or database was executed.', 'Current source includes recorded shared export-cleanup edits; paired source contents are captured in source-inputs.json.', 'No bank, content registry or repository build configuration was changed.'] };
summary.totals.savedBytes = summary.totals.baselineBytes - summary.totals.prototypeBytes;
summary.totals.percentSaved = 100 * summary.totals.savedBytes / summary.totals.baselineBytes;
writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ out, totals: summary.totals, comparisons, equivalence: summary.equivalence, retiredSourceAttribution: attribution, seconds: summary.seconds }, null, 2));
