# F11-36: reported-limit worker retirement

19 November 2026. Local test commit `d71ac4e1`, fix `cbf4bdc5`. The adjacent
JSON pins the actual red/green commands, source state, complete cost samples
and limits. The package remains unmerged.

Two independent actual reds preceded the fix. The owned real-worker SDK
disposal probe passed its ordinary healthy control, then failed because the
faulty worker remained alive (1.589 s). The limits entry passed seven groups,
including the strict actual-parent positive and disabled-timer negative, then
failed on one retained thread instead of zero after an exact reported call
limit (10.606 s). A test label alone is not the red evidence.

The fix retires after existing reported timeout/stack/OOM outcomes or actual
host disposal failure. Exact forged limit reports may retire; wrong answers,
neutral throws, size errors and successful limit-looking data retain healthy
reuse. Grading/classification, encoded 900k budget, display cuts, all clocks and
pool limits stay unchanged. The private done health flag comes from the real
finally observer, not learner data. A retiring acquired slot releases only on
actual exit. Throwing/rejected termination returns the completed result but
quarantines capacity under the existing queue/503 policy.

The affected resource entry then passed 66 printed groups in 58.948 s. It covers
real/forged/ordinary outcomes, genuine resource failures, 16/17 boundaries,
strict watchdog positive/negative, six runs within four live threads (5,077 ms),
three actual-worker disposal controls and both warm/run termination-failure
modes. The disposal negative disables only the actual observer, keeps the same
real disposer fault and correct result, and fails the same retirement oracle.

## Local recovery cost

Each of six fixed pairs ran three times per stage in fresh serial children.
The middle sample reversed stage/row order. The baseline uses pinned pre36
host source and an archived actual normal 20 worker with identical tracked
inputs; the candidate uses actual cbf4 source/artifact. No checkout or canonical
worker file was rolled back. All 36 rows passed, including exact deterministic
public-result hashes, physical exit within the unchanged 1s observation and
correct next grades. The collection took 11.841 s.

| Outcome before next correct grade | Before next median ms | After next median ms | Extra recovery worker starts after fix |
| --- | ---: | ---: | --- |
| Correct | 9.790 | 10.081 | 0 in all samples |
| Ordinary wrong answer | 10.880 | 10.574 | 0 in all samples |
| Neutral learner error | 10.317 | 10.995 | 0 in all samples |
| Exact forged limit report | 10.401 | 54.394 | 1 in all samples |
| Recursive stack-limit fixture | 9.839 | 53.843 | 1 in all samples |
| Allocation-limit fixture | 7.651 | 54.023 | 1 in all samples |

Candidate reported-limit rows observed physical retirement after about 22 ms
with 20 ms polling; that is an observation bound, not exact termination latency.
The next-grade figures start after that observation. This records the added
worker-start cost rather than assuming the old warm path is preserved after
limits. Three samples establish no distribution/p95 or provider guarantee.

This reported-result policy makes no unforgeable native-cause or caught-success
claim. Capacity fault tests cover acquired run/warm retirement, not every idle
error/exit event race or a fulfilled termination promise without exit. Full
composed integration and merge acceptance remain pending. Raw logs and the
measurement tool remain under
`/tmp/devshark-epic-f-handoff/f11-remaining-execution-3fa8f8ed/36/` with the
complete 36-row JSON capture pinned by the adjacent file.
