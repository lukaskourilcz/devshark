# #641 client regression history replay

On 24 November 2026, we checked out each original parent, introduced the test alone, observed its behavioural failure, restored the original changed runtime files, and repeated the same test. Original commit dates and original release history are preserved. Each red commit has the historical source as its direct parent. Its green child changes only the original implementation files. Byte-level comparisons with the historical fixes pass for every file listed in pairs.json.

## F12-04

After span.end(), old production configuration retained 1 timer. Restoring the pinned transform gave 0. A genuinely open span still ended at 30,000 ms.

Historical parent `044ef6a13b4a6118324bd7ca4208d11e888dd63c`, test-only commit `333c4513139262765522d793a8bf0ed1d30d5ed0`, child with the historical fix `b4225cb6f40fcb6836dbe65422904694b6648dd6`. Original source `b74d835c894d37e339eff3e51a0e762bd3338360`. [Before](sentry-confirmed-red.log) · [After](sentry-confirmed-green.log).

## F12-06 offline retry

Old code graded once while offline instead of 0, stored no pending actor, and did not report a changed owner on restore. Both regressions passed after the original runtime files were restored.

Historical parent `7991a3577086ac3a372fda5fd74afcb407c6020e`, test-only commit `8bff606d430718038bcf3a1c5e798ebb837d8e75`, child with the historical fix `d85046aae29ff953d120bceaca4ffcdcc47a6456`. Original source `044ef6a13b4a6118324bd7ca4208d11e888dd63c`. [Before](offline-confirmed-red.log) · [After](offline-confirmed-green.log).

## F12-06 manual clock

After the client clock crossed the deadline the old code made 0 requests. Corrected behavior made one manual request carrying the original chosen answer for server adjudication.

Historical parent `b74d835c894d37e339eff3e51a0e762bd3338360`, test-only commit `41a969bb4c1d798182ef1f18f2d5191d0b85273c`, child with the historical fix `f8869caea3531fa2a4484554fb7353cebd2fae16`. Original source `ec91ede8a80f0bcb7f80e054adfde4e7437e75f6`. [Before](clock-red.log) · [After](clock-green.log).

## Finding inventory

| F12 | Behaviour or acceptance | Regression and fix commits |
|---|---|---|
| 01 | Context-wide Playwright console fixture | 321eba01, verification tooling |
| 02 | Quiz logging after a refused save | c0f7a915 → 4984840d |
| 03 | Playwright import enforcement | 831dfd24, bf4dcbea, f6cd04346, verification tooling |
| 04 | Finished tracing span retained the deadline | 333c4513 → b4225cb6, measured above |
| 05 | Stale hash reload contract on existing runtime | 355d57ee, additional browser test |
| 06 | Explicit Submit offline, account change and manual server verdict | 8bff606d → d85046aa and 41a969bb → f8869cae, measured above. cdc58d37 covers the earlier post-grade receipt. |
| 07 | Account-specific query inventory | 5e80e1e5, additional Vitest |
| 08 | Delayed Shark Card writes across accounts | 32766292 → 60f0c381 |
| 09 | Delayed practice session and saved tasks across accounts | 5151cf39 → 444b7454 |
| 10 | Undo from the previous account | a7c5a22c → f84490ca |
| 11 | Challenge completion after switching accounts | bfc7caa9 → f04735d1 |
| 12 | Profile streak across UTC midnight | ea1f1750 → f0b017c2 |
| 13 | Sign-in briefly appears during auth restoration | 8c11e884 → a1efd7ae |
| 14 | Selected Home topic loses its border | 4bc4db6a → 2dc76089 |
| 15 | Idle Learn/Today cache observers lacked a query function | 7f5b7a70 → eb3d9ac7 |
| 16 | Duplicate planned-run Start action | a02c0929 → ff589353 |
| 17 | Presenter polls outlive the active question | b73da419 → cfbf7a48 |
| 18 | Product architecture update | 7940443f7, documentation |
| 19 | Release acceptance entry | 7940443f7, documentation |
| 20 | Saved track reset across live account updates | 430b74c2 → 8a30d866, cross-package |
| 21 | Public suite uses shared console fixture | f6cd04346, verification tooling |
| 22 | Run offline and memory in CI and parity | f6cd04346, CI wiring |
| 23 | Late planned-run start from a retired account | 31d85408 → bf4136d0, additional original finding |

The 19 numbered findings include 13 individual runtime defects and six verification or documentation items. Eleven of those 13 runtime defects already had original separated red and green commits. The remaining two now have the archive receipts above. The four additional package items contain two more historical runtime pairs and two verification changes.

[Structured commits and tested file provenance](pairs.json).

The six-minute Chromium control used the production bundle at 444807aeb. All five laps returned 504 listeners, 0 intervals and 15 long timers. The positive control returned to baseline after removing 12 listeners, one interval and one long timer. At +305 seconds two long timers remained. [Raw observations](route-memory-444807aeb.json).
