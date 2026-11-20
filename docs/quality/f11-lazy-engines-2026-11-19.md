# F11-34/37: acquire grading engines on use

19 November 2026. Real test `bc7af72d`, fixture correction `eca6edd6`, product
fix `9bd237dc`. The adjacent JSON records actual commands, source state,
hashes and preservation proof. Full composed acceptance remains pending.

Sandbox acquires QuickJS and its variant inside its existing shared module
Promise. Concurrent first operations still share one engine, boot rejection
stays cached, and actual disposal failure retains the existing reset. React
and system-design complexity return their complete unknown reports without
loading TypeScript; JS/TS load failures remain loud, retry and then reuse the
compiler. The existing F7 Coding operation test observes its evaluated handler
and separately requires QuickJS absent while preserving the 401/network refusal.

## Actual regression and fixture correction

The focused real red took 1.201 s: four positive controls passed and five target
assertions failed. The independent unmocked import loaded QuickJS too early;
React/design attempted the refused compiler twice. Other assertions observed
an already-loaded before state and the expected CJS-to-ESM acquisition route.
The latter route failures do not establish newly broken cache/disposal results.

First postfix run passed eight controls but failed its before-state marker
(1.180 s). The fixture itself reads SDK package.json; its broad require.cache
check counted metadata as an evaluated engine. The test-only correction now
observes canonical CJS index.js identity or actual native ESM load count.
It keeps the independent unmocked import regression, both real factory routes,
boot faults, the disabled-ESM-seam negative and all result/cache assertions.
The corrected focused entry passed 9/9 in 1.170 s. Both original red and first
postfix fixture-failure receipts remain intact.

The normal React runner build passed 0.522 s with 20/32 retained-graph guards,
strict guest banner, 19 final passive digest and 09 compiler-worker wiring.
Full test:performance passed 77.457 s, including 36 printed PASS groups and
nine Node test cohorts (28/8/42/5/15/4/37/72/8), all with zero failures. This
includes the actual F7 cold operation marker and all nine lazy-runtime probes.
API types passed 7.366 s and scripts 9.958 s. These checks ran against the exact
subsequently committed source; the receipt keeps their original dirty/head
state rather than relabeling them as a later clean-head run.

Reversing only sandbox imports/getModule restores the whole previous 36
sandbox byte for byte. Encoded/display boundaries, private disposal health,
actual-exit leases, strict watchdog and 09/11 runtime files remain unchanged.
The disposer fault here runs in-thread; the earlier 36 actual-worker producer
and observer negative remain separate evidence.

Markers prove deferred acquisition. They do not measure provider boot latency,
retained memory or platform artifact size. Trusted fixtures/local fallback
still use host TypeScript. Final clean-head fast (including the first complete
Launch) plus one additional same-head Launch, remote CI and merge are pending.
No extra broad suite was repeated here.
