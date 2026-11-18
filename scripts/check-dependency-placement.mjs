// Checks that each package sits in the package.json section its deploy needs.
// `npm run check:unused` runs it after knip.
//
// 1. Client: every package the browser loads (a value import in client/src,
//    client/sandbox or a CSS @import there, an `import.meta.glob` of
//    /node_modules/<pkg>, a node_modules/<pkg> href in client/index.html) is
//    a client `dependencies` entry, and every client `dependencies` entry is
//    loaded that way or is a declared peer of one that is. client/src/og is
//    left out: vite.config.ts runs it at build time.
// 2. Root: every package the deployed server loads from node_modules (the
//    externals of the twelve handlers, as docker/build-handlers.mjs bundles
//    them, of the React guest bundle, as scripts/build-react-runner.mjs
//    builds it, and of the TypeScript checker's worker), plus their required
//    peers, is a root `dependencies` entry. The React grader's snapshot
//    (scripts/prepare-react-snapshot.mjs) and the Docker image install
//    `npm ci --omit=dev`, so a runtime package moved to devDependencies
//    passes CI and breaks grading or the container at start.
// 3. Overrides: every key of `overrides` in either package.json has an entry
//    in a sibling `//overrides` object that names the GHSA advisory it answers.
import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';

const failures = [];
const notes = [];
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const packageName = spec => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
const isBare = spec => !/^(?:\.{1,2}\/|\/|[a-z]+:)/i.test(spec) && !builtins.has(spec);

function walk(dir, accept, skip = () => false) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (skip(file)) return [];
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(file, accept, skip);
    return accept(file) ? [file] : [];
  });
}

const addUse = (uses, name, where) => {
  if (!uses.has(name)) uses.set(name, new Set());
  uses.get(name).add(where);
};

// Bundles the entry points with every package left external and returns the
// packages they load, each with the files that load it. esbuild drops
// type-only imports, so only what runs counts.
async function externals(options) {
  const result = await build({
    bundle: true, write: false, metafile: true, logLevel: 'silent',
    // Nothing is written; hashed names keep an entry and a file it imports
    // (a component and its CSS) from claiming the same output path.
    outdir: 'dependency-placement-out', entryNames: '[dir]/[name]-[hash]',
    ...options,
  });
  const uses = new Map();
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    for (const entry of input.imports) {
      const spec = (entry.original || entry.path).split('?')[0];
      if (entry.external && isBare(spec)) addUse(uses, packageName(spec), file);
    }
  }
  return uses;
}

const usedBy = (uses, name) => [...uses.get(name)].sort().slice(0, 3).join(', ');

// The names plus their required (non-optional) peers, followed until nothing
// new turns up. Maps each name to the package that declares it as a peer.
function withPeers(names, modulesDir) {
  const all = new Map(names.map(name => [name, null]));
  const queue = [...names];
  while (queue.length) {
    const name = queue.pop();
    const manifestPath = path.join(modulesDir, name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    for (const peer of Object.keys(manifest.peerDependencies || {})) {
      if (manifest.peerDependenciesMeta?.[peer]?.optional || all.has(peer)) continue;
      all.set(peer, name);
      queue.push(peer);
    }
  }
  return all;
}

const section = (manifest, name) =>
  manifest.dependencies?.[name] ? 'dependencies' : manifest.devDependencies?.[name] ? 'devDependencies' : 'no section';

// Rule 1: the client.
const CLIENT_ALLOWED = {
  '@tanstack/react-query-devtools': 'devDependency on purpose: src/main.tsx imports it only inside an import.meta.env.DEV branch, which the production build drops',
};
const client = readJson('client/package.json');
const sourceFile = file => /\.(?:[cm]?[jt]sx?|css)$/.test(file) && !file.endsWith('.d.ts');
const clientEntries = [
  ...walk('client/src', sourceFile, file => file === path.join('client', 'src', 'og')),
  ...walk('client/sandbox', sourceFile),
].map(file => path.relative('client', file)).sort();
const assetLoaders = Object.fromEntries(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.md', '.txt', '.html', '.wasm']
  .map(extension => [extension, 'empty']));
const clientUses = await externals({
  absWorkingDir: path.resolve('client'), entryPoints: clientEntries,
  platform: 'browser', format: 'esm', packages: 'external', jsx: 'automatic', loader: assetLoaders,
});
for (const file of clientEntries) {
  for (const match of readFileSync(path.join('client', file), 'utf8').matchAll(/import\.meta\.glob\(\s*['"]\/node_modules\/((?:@[^/'"]+\/)?[^/'"]+)/g)) {
    addUse(clientUses, match[1], file);
  }
}
for (const match of readFileSync('client/index.html', 'utf8').matchAll(/(?:href|src)="(?:\.?\/)?node_modules\/((?:@[^/"]+\/)?[^/"]+)/g)) {
  addUse(clientUses, match[1], 'index.html');
}
for (const name of [...clientUses.keys()].sort()) {
  if (client.dependencies?.[name]) continue;
  if (CLIENT_ALLOWED[name]) { notes.push(`client ${name}: ${CLIENT_ALLOWED[name]}`); continue; }
  failures.push(`client: ${name} ships to the browser (imported by ${usedBy(clientUses, name)}) but sits in ${section(client, name)} of client/package.json; move it to dependencies.`);
}
const clientNeeded = withPeers([...clientUses.keys()].filter(name => client.dependencies?.[name]), 'client/node_modules');
for (const name of Object.keys(client.dependencies || {}).sort()) {
  if (clientNeeded.has(name)) continue;
  failures.push(`client: ${name} is a client dependency, but nothing in client/src, client/sandbox or client/index.html loads it and no loaded package names it as a peer; move it to devDependencies.`);
}

// Rule 2: the root, as Vercel, the React grader's snapshot and the Docker
// image load it at run time.
const ROOT_ALLOWED = {
  typescript: 'devDependency on purpose: Vercel ships node_modules/typescript to the roadmap function through includeFiles in vercel.json, and the Dockerfile installs the locked version beside `npm ci --omit=dev`',
};
const root = readJson('package.json');
const resolveFromRoot = createRequire(path.resolve('package.json'));
const handlers = walk('api', file => file.endsWith('.ts')).sort();
if (handlers.length !== 12) failures.push(`root: expected twelve handlers under api/, found ${handlers.length}.`);
const bundleQuickJs = {
  name: 'bundle-quickjs-runtime',
  setup(builder) {
    builder.onResolve({ filter: /^(?:quickjs-emscripten(?:-core)?|@jitl\/quickjs-[^/]+)(?:\/.*)?$/ }, args => ({
      path: resolveFromRoot.resolve(args.path, { paths: [args.resolveDir || process.cwd()] }),
      external: false,
    }));
  },
};
const serverBuild = { platform: 'node', format: 'cjs', target: 'node24', packages: 'external' };
const rootUses = new Map();
for (const uses of await Promise.all([
  externals({ ...serverBuild, entryPoints: handlers }),
  externals({ ...serverBuild, entryPoints: ['scripts/react-sandbox-entry.ts'], plugins: [bundleQuickJs] }),
  externals({ ...serverBuild, entryPoints: ['scripts/ts-check-worker-entry.ts'] }),
])) {
  for (const [name, files] of uses) for (const file of files) addUse(rootUses, name, file);
}
for (const [name, declaredBy] of withPeers([...rootUses.keys()], 'node_modules')) {
  if (declaredBy) addUse(rootUses, name, `a required peer of ${declaredBy}`);
}
for (const name of [...rootUses.keys()].sort()) {
  if (root.dependencies?.[name]) continue;
  if (ROOT_ALLOWED[name]) { notes.push(`root ${name}: ${ROOT_ALLOWED[name]}`); continue; }
  failures.push(`root: ${name} loads at run time (from ${usedBy(rootUses, name)}) but sits in ${section(root, name)} of package.json; \`npm ci --omit=dev\` would leave it out of the React snapshot and the Docker image. Move it to dependencies.`);
}

// Rule 3: overrides name their advisory.
const GHSA = /GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}/i;
for (const [file, manifest] of [['package.json', root], ['client/package.json', client]]) {
  for (const key of Object.keys(manifest.overrides || {})) {
    const reason = manifest['//overrides']?.[key];
    if (typeof reason === 'string' && GHSA.test(reason)) continue;
    failures.push(`${file}: overrides "${key}" needs a "//overrides" entry with the same key that names the GHSA advisory it answers.`);
  }
}

for (const note of notes) console.log(`Allowed: ${note}.`);
if (failures.length) {
  console.error(`Dependency placement: ${failures.length} problem${failures.length === 1 ? '' : 's'}:\n${failures.map(line => `- ${line}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Dependency placement: ${clientUses.size} client and ${rootUses.size} root runtime packages sit in dependencies; every override names its advisory.`);
}
