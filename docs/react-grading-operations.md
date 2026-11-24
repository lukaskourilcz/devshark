# React grading operations

Learner React code never runs in the application server. Coding submissions and
path activities use a fresh Vercel Sandbox without credentials, outbound network
or another learner's files. Infrastructure failures return an error; there is no
in-process fallback. The suite and learner also have separate JavaScript engines
inside the Sandbox.

## Authority inside the VM

The API asks the dedicated React compiler worker to convert learner
TypeScript/JSX to ES2015 CommonJS without evaluating it (`react-transpile.ts`).
The compiler has one live/idle worker, a first-start 4 s deadline and a 256 MB
old-generation heap; stopped or excessively nested conversion returns the
existing learner compile error before any VM starts. Capacity or compiler
infrastructure failure keeps the existing unrecorded 503/Retry-After response. The two fetch fixture modules are converted once per
API instance and reused by every Submit. Downlevelled async functions use the private learner
Promise kernel. The API uploads the guest bundle and an input containing compiled
learner/fixture modules, trusted visible/hidden suite and random run nonce.
Before starting a VM, it reads the guest bundle and the passive
`react-sandbox.sha256.cjs` record from the deployment and checks SHA-256 against
the exact guest bytes. The build writes the record as JSON string data; neither
the API nor the archive verifier evaluates it. A missing, malformed or mismatched
pair is an unrecorded infrastructure failure. Failed reads/checks are not cached,
so a repaired copy can retry. Successful runs reuse the same verified Buffer and
upload it unchanged; the sidecar stays in the API deployment. This is copy
integrity, not proof of build freshness or authentication against replacement of
both files. Shared-build pack/restore also require a valid pair before writing
the archive or replacing destination files. The VM's stop call is sent when the verdict
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

Runtime grading rules now use `coding-attempt:v3` and `path-code-attempt:v3`.
Genuine encrypted v2 OPEN sessions answer 409 `task_changed` before grading or
writes. Latest brief renewal preserves Coding-linked attempt/parent and saved
draft; native path renewal intentionally opens a new attempt under the same
enrollment/activity and preserves its draft. Previously accepted native results
retain the existing read-only replay/idempotency contract and award no XP again.
A runtime rollback also needs fresh version tags; do not reuse v2.

## Resource bounds

These values are checked against the current source, 19 November 2026.
Worker heap limits are Node old-generation MB; QuickJS memory/stack are MiB.
They are different layers, not process RSS or provider memory guarantees.

| Server worker pool | Live / retained idle | Waiting / slot wait | Boot / work deadline | Node heap |
| --- | --- | --- | --- | --- |
| JavaScript/TypeScript QuickJS (`sandbox.ts`) | 4 / 2 | 160 / 5,000 ms | 10,000 ms boot; 2,500 ms run plus 1,500 ms parent grace | 192 MB per worker |
| TypeScript check/transpile (`ts-check-pool.ts`) | 2 / 1 | 64 / 8,000 ms | 20,000 ms boot; 4,000 ms from start | 512 MB per worker |
| React syntax conversion (`react-compile-pool.ts`) | 1 / 1 | 32 / 4,000 ms | 6,000 ms boot; 4,000 ms from first start | 256 MB per worker |

Queues refuse overflow or an expired wait with unrecorded 503 `grader_busy`
and Retry-After. Worker startup failure uses the shared 1 s doubling backoff,
capped at 30 s and reset by a successful start. Deployment grading has no
request-thread fallback. One caller is limited to two simultaneous submissions
per task/activity and three across them; those gates answer 429 `grader_busy`.

QuickJS reported timeout/fixed stack/OOM outcomes, exact per-call `out of memory`
or `stack overflow`, and actual disposal failure retire the worker. Exact
forged reports may also cause conservative retirement; ordinary wrong answers,
neutral throws, size errors and successful data keep healthy reuse. The private
health flag comes from the actual finally/disposer, not learner output. Acquired
retirement capacity releases only on physical exit; failed termination keeps it
quarantined under the existing queue/503 policy. This is reported-outcome cleanup,
not unforgeable native-cause detection or detection of learner-caught limits.
React compiler retirement also holds its capacity until actual exit.

| Boundary | Current limit and consequence |
| --- | --- |
| Learner code received by Coding Submit | 20 × 1,024 = 20,480 UTF8 bytes; excess is HTTP 413 before grading. Type-test sources are authored server data. |
| Non-React QuickJS run | 64 MiB heap, 1 MiB stack, 10,000 rounds of jobs/timers; actual interrupt or unfinished/tick exhaustion returns a timeout. Native work can require the parent stop at deadline plus grace. |
| Returned values | Depth through 40, at most 10,000 array entries/object keys; a deeper/wider/circular or uncloneable value fails that call. |
| Non-React encoded result | 900,000 UTF16 JSON units across complete packets, framing, escaped keys/values and errors. Each call reserves a size-error packet; failed partial encoding rolls back. Excess fails the call with `Result size limit exceeded`; both VM pre-transfer and host retain the independent 1,000,000-unit backstop. |
| Error/display text | VM thrown text is first cut to 2,001 units. Submit compares the complete value before cutting displayed actual/error/codeError to 2,000 plus the line marker; surrogate boundaries and null are preserved. Run cuts outgoing display fields but preserves compile-only JavaScript. |
| Run and non-React Submit console | 100 lines, 2,000 units per line, 64,000 stored text units; cut markers may add a line/units beyond the nominal cap. Table rendering shows 50 rows. Discarded output skips argument serialization after the cap. |
| URL bridge | Each input string is limited to 65,536 units; oversized arguments are refused before host URL parsing. |
| React learner engine | 64 MiB heap, 1 MiB stack; only the outermost independent entry renews the existing 2,500 ms deadline. Reentry shares it and the first actual interrupt latches, so retries/later learner entries fail immediately. Promise draining stops past 10,000 jobs. |
| React capability bridge | Capability/prop nesting through 50, at most 1,000 call arguments, request text at most 1,000,000 units; host capability errors are cut to 2,000. |
| Trusted React case | 5,000 ms asynchronous case-body race. Hooks/cleanup are outside it, and it cannot interrupt synchronous native work; it is not a whole-suite deadline. |
| React VM and command | Fresh VM, deny-all outbound policy, 1 vCPU, 256 MB guest Node old-generation heap; command 10,000 ms, request signal 22,000 ms after compile, VM expiry 25,000 ms and stop cleanup 2,000 ms. |
| React reply | Exactly one nonce-bound reply; at most 256,000 UTF16 units and 500 cases, with the exact authored case count and recomputed totals. The 900,000 budget above is not a React reply limit. |
| Browser Run | Download/compile wait 45,000 ms; loaded TypeScript check 8,000 ms; execution 2,000 ms synchronous or 6,000 ms async. These are preview bounds, not server authority. |

The roadmap function remains 45 s and the client Submit wait 50 s. Component
arithmetic is not an end-to-end promise: visible and hidden QuickJS programs
run serially (a visible code error/timeout skips hidden). With warm workers,
two queue/run phases give 2 × (5 + 4) = 18 s; adding a warm TypeScript
queue/check gives 8 + 4 + 18 = 30 s. A cold QuickJS worker can add 10 s boot
and a cold checker 20 s; serial exhaustion can therefore exceed the outer
limits. A single cold queued QuickJS phase is 5 + 10 + 4 = 19 s. React
compile admission/boot/work plus its 22 s signal gives 4 + 6 + 4 + 22 = 36 s,
excluding auth, artifact reads and other outer work. No timer was raised to
make these sums fit. Record the actual phase that stopped a request.

Each function instance admits three simultaneous React VMs across all callers.
A fourth VM gets `503 grader_busy` with `Retry-After` and records no result.
There is no queue. A slot is held until the provider confirms stop. An uncertain
create or stop holds it for the VM's 25-second expiry. The existing 2-per-task
and 3-per-caller limits remain independent. Three VMs support the documented
concurrency-3 rehearsal while bounding each instance to 3 grading vCPUs.
The provider can start multiple function instances; this limit applies to each one.

## Upload per Submit

Current normal build at `dbfde6ad`, 19 November 2026: the uploaded
`react-sandbox.cjs` is **887,989 raw bytes / 346,774 gzip bytes** (Python gzip
level 9, mtime 0), SHA-256
`e8fbce059948a41c72c5ca6cb0c591d8c0ff03be495e3fa1a799cb1332a4bae1`.
It matches that build's complete shared-artifact inventory. The 67-byte passive
sidecar stays in the API, as do the 10,395-byte compiler worker and 2,340,572-byte
bundled Sandbox SDK. Each VM still receives the current guest plus its variable
input. These are file/local-codec sizes, not a measured SDK tar transfer or
upload duration. Current receipts are in
[`quality/f11-final-documentation-2026-11-19.json`](quality/f11-final-documentation-2026-11-19.json).

### Historical 18 November baseline

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

The following historical exploratory projection bypasses the current normal
trim helper; it is not the current builder or an exact baseline retake. Use
`npm run build:react-runner` for current generated artifacts:

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
| Actual normal20/32 trim checkpoint `c55ba3c4` | 887,329 | 346,595 |
| Actual composed build `dbfde6ad`, including later deadline fixes | 887,989 | 346,774 |

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

For an approved temporary Preview rehearsal, set `REACT_SNAPSHOT_TTL_HOURS=1` when preparing the snapshot. The SDK measures expiry from the last use. Bind the new ID to that Preview alone and delete the temporary snapshot after the smoke. Omitting the variable keeps the release snapshot indefinitely. Creating a VM and retaining a snapshot use metered resources.

## Verification

The learner's cleanup attempts timer/listener and engine-handle disposal
without replacing its original failure or completed verdict. Failed disposal
invalidates only that captured wasm module's cache, so a later learner in the
same process can start a fresh engine. Upstream may still print a caught abort
diagnostic; it must not become the learner's compile/case error. Real recursion,
later cases and subsequent learner runs are covered by `test:react-authority`.

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

The trusted page has no native Node `fetch`; its Headers, Request, Response,
FormData and Blob data APIs remain. The learner's existing fetch guard still
refuses without a training fixture and delegates to a trusted suite's current
fixture when installed. Local checks cover delegation/override/restoration,
real jsdom XHR success and socket refusal against a controlled server, and an
authored reference/starter pair. The optional real-VM probe sends jsdom XHR
under unchanged deny-all. Cross-origin refusal can also be caused by CORS or
other transport failure, so it alone does not establish the policy's cause.

Required CI and local parity run `test:sandbox-limits` and the local guest
checks through `test:grading-integrity`. That umbrella clears
`REACT_RUNNER_SNAPSHOT_ID` only for the isolation child. The standalone
`test:react-isolation` command keeps its optional VM probes when a snapshot
and Sandbox credentials are configured.

The isolation suite also runs fresh-process artifact controls with a fabricated
local Sandbox SDK: invalid copies (a tampered runner, a well-formed digest of
other bytes, a missing, malformed or non-string record, a missing runner) must
fail before create/upload, a repaired
pair must retry in the same process, and verified bytes must remain cached. The
real builder's record and actual Vercel include glob are checked separately.
These controls do not start a VM or establish deployed tracing/container
acceptance. The container comparison checks the actual candidate image's pair
with networking disabled; its historical baseline predates the sidecar.

The browser bridge cuts compile, preview and non-null case errors on receipt
with the same shared text cut as the grader. Structured values become strings;
unconvertible values use a safe fallback. Null case errors remain null. The
frame/source, run token and restart-generation controls remain in force.

`.github/workflows/grading-monitor.yml` checks signed-out production reference and
wrong submissions for `react-counter` and `js-double-numbers` every six hours and
on demand. Missing snapshots/credentials and broken engines fail the workflow.
Anonymous submissions record nothing. `LIVE_GRADING_BASE_URL` selects a preview.
