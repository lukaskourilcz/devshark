# F11-11/12/14: React deadline ownership and classification

19 November 2026. Real test commit `609002e7`, fix `e18dcf8f`. These are local
focused results; composed integration and merge remain pending. The adjacent
JSON retains exact commands, source states, hashes and diagnostic limitations.

Nested host callbacks now share the existing outer learner deadline. Only an
independent entry can renew it, and an actual engine interrupt latches for that
learner so retries and later learner calls cannot receive fresh deadlines.
A private callback preserves that event even when authored suite setup later
fails. Timeout classification uses the engine event or the existing canonical
mini-jest case-clock prefix. Ordinary rendered/thrown words such as interrupted
or timed out remain ordinary failures. Memory, stack, 2.5s learner/5s case clocks,
command budgets, network policy and public grading shapes are unchanged.

## Actual red and green

The real authority red failed four false-timeout assertions in 6.922 s; its
actual mini-jest clock positive passed. The local guest red failed six new
probes in 69.573 s while the finite nested callback positive passed. Four
render/module callback loops returned the existing stopped-child envelope,
without named case results; the saved wrapper does not identify a native OOM
cause or terminal signal. Module-loop observations were 17,671/8,938 ms. A
real module interrupt was lost when authored setup failed. Busy render and
later learner durations were 7,517/2,501 ms, violating the unchanged bounds;
a later trusted authored case still passed.

After the committed test regression, authority passed in 12.547 s with all
five classification controls and the existing promise/spread/record/authority
coverage. The actual local guest passed in 33.157 s: seven new probes, nine
existing local groups and seven artifact/cache groups. Render callback loops
reported interrupted named cases in 2,518 ms each; module-loop process
observations were 3,251/3,295 ms. Busy render/later learner/later trusted case
were 2,513/0/1 ms, with the last case passing. The snapshot was explicitly blank;
credentialed VM acceptance printed SKIP.

## Visible upstream disposal diagnostics

Authority green still prints two identical 112-byte LF diagnostic lines:
`Aborted(Assertion failed: list_empty(&rt->gc_obj_list), at: ../../vendor/quickjs/quickjs.c,2036,JS_FreeRuntime)`.
They are bracketed between the prior DOM/intrinsics PASS and the quiet-disposal
PASS, in the unchanged intentional render/module recursion block followed by
healthy-learner recovery and forged-text controls. The same two exact lines
already appear in successful F11-10 logs. Its original pre-disposal-fix red
has the first diagnostic and an uncaught disposer RuntimeError. Current14 red
stops before this block, so its absence there is not a baseline control.

The SDK's Emscripten abort path prints through captured console.error before
throwing; quiet disposal contains that throw and invalidates poisoned cached
wasm. Saved command output merges streams and contains no per-recursion
markers. It proves the block/context and successful recovery, not independent
line-to-case mapping, clean stderr, ordinary reference-flow silence, removal
of the upstream assertion or native OOM provenance. Raw line and historical
log hashes are retained in the adjacent JSON. No diagnostic rerun was made.

Independent review at the frozen fix found no actionable issue and verified
source preservation plus all four actual log hashes. Final composed types,
Coding/reference, launch and parity checks remain to run after the remaining
F11 groups; no package checkbox is completed by this local record.
