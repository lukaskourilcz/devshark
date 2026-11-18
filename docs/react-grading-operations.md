# React grading operations

Learner React code never runs in the application server. Coding submissions and
path activities use a fresh Vercel Sandbox without credentials, outbound network
or another learner's files. Infrastructure failures return an error; there is no
in-process fallback. The suite and learner also have separate JavaScript engines
inside the Sandbox.

## Authority inside the VM

The API converts learner TypeScript/JSX to ES2015 CommonJS without evaluating it
(`react-transpile.ts`). The two fetch fixture modules are converted once per
API instance and reused by every Submit. Downlevelled async functions use the private learner
Promise kernel. The API uploads the guest bundle and an input containing compiled
learner/fixture modules, trusted visible/hidden suite and random run nonce.
It reads the guest bundle from the deployment once per instance and uploads
it unchanged on every run. The VM's stop call is sent the moment the verdict
is read and runs after the answer (`waitUntil`, `lib/coding/after-response.ts`).

1. The guest reads and deletes its input before learner execution. It prepares
   jsdom, development React and Testing Library, freezes host intrinsics and
   prints the nonce-bound started marker.
2. Only the trusted suite runs in the Node page realm (`react-runner.ts`). Its
   matchers, assertions, DOM observations, case promises and result are never
   supplied to the learner.
3. The learner runs in QuickJS/WASM (`react-learner.ts`). React hooks, JSX,
   events, refs, timers, deterministic fetch fixtures and selected web APIs are
   capabilities. Only serialized primitive values and private identity records
   cross the boundary; no host JavaScript references cross it. DOM reads/writes
   use explicit allowlists. Prototype chains, implementation symbols, React
   owners/fibers and internal fields are absent. Public values/functions retain
   identity across calls and renders. JSX props are copied into trusted renderer
   data, so React does not freeze learner-owned proxy objects.
4. Learner imports resolve only the React facade, JSX runtime and authored
   training fixtures. Testing Library, tests, assertions, Node modules and result
   functions are unavailable. Dynamic code generation is disabled. Learner
   intrinsics used by the bridge/kernel are frozen; their prototypes belong to
   QuickJS and cannot affect suite intrinsics. Consoles are silent.
5. All learner async work uses a controlled Promise constructor. Host promises
   become controlled deferred values; subscriptions use a private closure rather
   than a replaceable public `then`. The FIFO scheduler observes detached
   rejections, later handling, cancellation and thenable assimilation. Unhandled
   rejections are forwarded to the trusted page's `window` for suites that check
   them. Fixture and suite overrides remain observable. Fetch never defaults to
   the process's real network client.
6. UTC is shared with the browser runners (`coding-utc-time.ts`). Learner local
   dates read UTC regardless of process zone; formatting uses UTC unless a zone
   is explicit. The trusted suite may control clocks/timers; learner changes
   cannot replace that authority.
7. The guest serializes its result from own data descriptors using captured
   functions (`react-guest.ts`). It prints one nonce-bound line. The API accepts
   only that line, verifies shape/size/case count, recomputes counts and rejects
   missing or duplicate results. Files and component logs are never verdicts.

A form that submits without preventing its default fails its case, matching the
browser harness. Thrown values, including empty or unreadable errors, fail rather
than become passes. A crash after the started marker is a learner error; failure
before it remains an infrastructure outage. Code nested too deeply for the
compiler to convert fails as a learner compile error before any VM is requested
(`NESTED_TOO_DEEPLY` in `react-isolated.ts`), so the learner is not told to retry
an outage. Learner components can of course
change their rendered DOM, as any component under test can. The boundary prevents
access to assertion/result authority; it is not a claim that every authored suite
covers every possible incorrect solution or a platform penetration-test claim.

## Resource bounds

- Fresh non-persistent VM per submission, outbound network denied.
- Node heap 256 MB; QuickJS heap 64 MB and stack 1 MB.
- QuickJS bytecode interrupts after 2.5 seconds per synchronous engine call and
  promise flushes stop after 10,000 jobs. Native allocation/GC paths may require
  the external command deadline; internal interrupts are not the only bound.
- Command 10 seconds; request work 22 seconds; VM expiry 25 seconds; cleanup has
  its own 2-second budget. Timers and listeners are cleared on engine disposal.
- The existing roadmap handler allows 45 seconds; Submit waits up to 50 seconds.
  Exactly twelve physical API handlers remain.

## Upload per Submit

Measured 18 November 2026 (Epic F, F11) on the branch point of
`claude/f11-grading-sandbox-limits`, after `node scripts/build-react-runner.mjs`.
Every React Submit writes two files into a fresh VM. The SDK packs them into one
gzipped tar stream, so the gzip column is close to what crosses the network.

| File in the VM | Bytes | gzip |
|---|---:|---:|
| `runner.cjs` (`lib/coding/generated/react-sandbox.cjs`) | 2,100,887 | 691,960 |
| `input.json`, median of the 183 React tasks' reference solutions | 22,224 | 5,680 |
| `input.json`, largest of the 183 | 55,113 | 11,672 |

The API also loads `lib/coding/generated/vercel-sandbox.cjs` (2,306,351 bytes),
the bundled SDK. It runs in the function and never enters the VM.
`lib/coding/generated/quickjs-sandbox.cjs` (1,676,943 bytes, gzip 607,983) is the
QuickJS grader's worker thread for JavaScript and TypeScript, also never uploaded.

What `runner.cjs` carries, by esbuild's `bytesInOutput`:

| Input | Bytes | Used at run time |
|---|---:|---|
| `@jitl/quickjs-singlefile-cjs-release-sync/dist/index.js` | 844,280 | Its loader and FFI only. 819,611 bytes of it are one template literal holding the upstream wasm, which never runs: `quickjs-variant.ts` always supplies `wasmModule`. |
| `lib/coding/vendor/quickjs-node24.cjs` | 670,988 | Yes: the pinned Node 24 wasm, base64. |
| Four `@jitl/quickjs-wasmfile-*` variants (debug and release, sync and asyncify), module and index files | 345,671 | No. `quickjs-emscripten`'s index imports them; nothing calls them. |
| `quickjs-emscripten-core` | 78,126 | Yes. |
| `sandbox-web-apis.ts`, `coding-locale.ts`, `grader-capacity.ts`, `sandbox.ts` | 44,771 | No. At the baseline `react-learner.ts` imported two error helpers from `sandbox.ts`, and the QuickJS preludes came with them. The first trim below removed these four files. |
| `coding-console.ts` | 3,543 | No. `coding-evaluate.ts` imports it for Run's console, and esbuild keeps `CONSOLE_SOURCE` because the template interpolates a constant. |
| Everything else (the learner engine, the runner, mini-jest, UTC time, realm lockdown, the guest) | 110,302 | Yes. |
| esbuild module wrappers and the `"use strict"` banner | 3,206 | Yes. |

Reproduce the table from the repository root:

```sh
node --input-type=module -e "
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const req = createRequire(process.cwd() + '/package.json');
const { metafile } = await build({
  entryPoints: ['scripts/react-sandbox-entry.ts'], outfile: 'guest.cjs', write: false, metafile: true,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', target: 'node24', banner: { js: '\"use strict\";' },
  plugins: [{ name: 'quickjs', setup(b) { b.onResolve({ filter: /^(?:quickjs-emscripten(?:-core)?|@jitl\/quickjs-[^/]+)(?:\/.*)?$/ }, (a) => ({ path: req.resolve(a.path, { paths: [a.resolveDir] }) })); } }],
});
const [output] = Object.values(metafile.outputs);
console.log(output.bytes, 'guest.cjs');
for (const [file, { bytesInOutput }] of Object.entries(output.inputs).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)) console.log(bytesInOutput, file);
"
```

The input sizes come from `JSON.stringify` of the `GuestInput` that
`runIsolatedReactSuite` writes, built for each React task's reference solution
with its hidden suite, both compiled fixtures and a 48-character nonce.

### Trims since the baseline

| Change | `runner.cjs` bytes | gzip |
|---|---:|---:|
| Baseline above | 2,100,887 | 691,960 |
| Error helpers moved to `shared/coding-error-text.ts` and `lib/coding/vm-errors.ts`, so the guest no longer imports `sandbox.ts` | 2,056,252 | 679,802 |

## Configuration and rollout

1. Authenticate the Sandbox SDK with Vercel OIDC, or local operator credentials
   `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`.
2. `npm run prepare:react-snapshot` installs locked production dependencies with
   lifecycle scripts disabled. The snapshot contains only dependencies/Node 24,
   no application code, environment files, submissions or credentials.
3. Configure `REACT_RUNNER_SNAPSHOT_ID` for Production and Preview. Build creates
   the guest and CommonJS SDK bundles and checks packaging with require(ESM) off.
4. Run `npm run test:react-isolation` with that snapshot; without it the suite
   runs its local guest part and prints SKIP for the VM part. Verify a preview Submit
   before production promotion. Runtime dependency changes require a fresh
   snapshot; code-only changes are uploaded with each run and use the current one.
   Retain the previous snapshot for rollback. No billing/plan settings change.

## Verification

`npm run test:react-engine` checks the 183 issued React tasks and every
reference, junior and senior solution they carry, visible and hidden cases
together. CI does not run it. `npm run test:coding` additionally checks untouched
starters, wrong/static variants, time budgets and the rest of the catalogue.

`npm run test:react-authority` checks the private Promise kernel and attacks on
DOM getters/symbols, React internals/exports, imports, intrinsics and synchronous
or asynchronous assertions. It also verifies detached async rejection reporting.
It pins the learner engine's 85 globals (22 from the host) and the keys of each
capability it hands out: `window`, `document`, elements, events, storage, the URL,
abort and header objects, `Intl`, `crypto`, `performance` and React. A name added
to `react-learner.ts` fails it until the list is updated. It runs in CI.

`npm run test:grading-integrity` records every function the host hands a QuickJS
context: `url` in the JavaScript grader, `capability`, `schedule` and `report` in
the React learner engine, and no host reference or module loader in either. A new
one fails the suite. It also pins the vendored wasm's 20 imports (19 host
functions and its memory) and 75 exports beside the provenance hash, and checks
that learner `import()` of `node:fs`, `std` or `os` rejects in both engines.
Learner code that changes `Object.prototype`, `Array.prototype`,
`Function.prototype.constructor` or the globals changes only its own run: in the
JavaScript grader its results still compare right and the hidden run and the
next run start clean; in the React engine each attempt throws, and the page
realm, the guest's reporter and the next reference run are unchanged. `npm run test:launch` starts the actual guest bundle with production
flags, checks deletion/nonce/count/serialization, resource exhaustion, UTC in
multiple process zones and representative suites. `npm run test:react-isolation`
builds the guest and starts it the same way, with a local HTTP server standing in
for the network: learner code reaches no `XMLHttpRequest`, `WebSocket`,
`EventSource`, worker, `navigator`, `require`, `process` or `WebAssembly`, bare or
on `window`; its `fetch` refuses without a fixture; and markup that names an image,
stylesheet, script, frame, media or object loads nothing and runs no inline script
or handler. Its VM part runs only with `REACT_RUNNER_SNAPSHOT_ID` set. These local
checks do not replace the real microVM integration check.

`.github/workflows/grading-monitor.yml` checks signed-out production reference and
wrong submissions for `react-counter` and `js-double-numbers` every six hours and
on demand. Missing snapshots/credentials and broken engines fail the workflow.
Anonymous submissions record nothing. `LIVE_GRADING_BASE_URL` selects a preview.
