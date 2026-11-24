# Production handler errors, 25 October to 24 November 2026

This covers the 30 complete UTC days from 25 October 00:00 up to 24 November 00:00. Vercel recorded one 5xx response across production. `/api/quiz/questions` answered 503 between 04:40 and 04:45 UTC on 27 October. The request summary recorded status and timing and the platform error code was empty. The available evidence leaves its cause open. [Incident #689](https://github.com/lukaskourilcz/devshark/issues/689)

## Dated production log counts

A project-scoped Vercel request query grouped 500–599 responses by route and status. Separate runtime log queries grouped by level, then counted the structured stdout text `"level":"error"` by request path. Every window had positive retained-log counts. The date at the right of each interval is exclusive.

| UTC dates | Info | Warn | Error/fatal | Structured stdout errors |
|---|---:|---:|---:|---:|
| 2026-10-25 to 2026-10-29 | 298 | 6 | 37 | 0 |
| 2026-10-29 to 2026-11-01 | 291 | 6 | 47 | 0 |
| 2026-11-01 to 2026-11-05 | 276 | 6 | 48 | 0 |
| 2026-11-05 to 2026-11-08 | 624 | 14 | 93 | 0 |
| 2026-11-08 to 2026-11-12 | 358 | 6 | 52 | 0 |
| 2026-11-12 to 2026-11-19 | 611 | 13 | 16 | 0 |
| 2026-11-19 to 2026-11-24 | 265 | 5 | 0 | 0 |
| **Total** | **2723** | **56** | **293** | **0** |

## Provider error-level records

The `DEP0169` warning text accounted for every error/fatal log record on every route. Shorter searches recovered counts where the wider query timed out. All 16 records for 12–19 November appeared in the first three days. The prior runtime investigation tracks the warning, and the HTTP 503 above has its own investigation. [Warning #477](https://github.com/lukaskourilcz/devshark/issues/477)

| Handler | DEP0169 records |
|---|---:|
| `/api/admin/settings` | 2 |
| `/api/leaderboard` | 5 |
| `/api/play/create` | 1 |
| `/api/play/heartbeat` | 1 |
| `/api/quiz/challenge` | 10 |
| `/api/quiz/daily` | 11 |
| `/api/quiz/questions` | 10 |
| `/api/quiz/roadmap` | 143 |
| `/api/quiz/submit` | 4 |
| `/api/user/[op]` | 95 |
| `/api/user/advisor` | 1 |
| `/api/user/freezes` | 3 |
| `/api/user/friends-handle` | 1 |
| `/api/user/identity` | 1 |
| `/api/user/stats` | 1 |
| `/api/user/xp` | 4 |

