# Review of the 45 hidden system-design tasks (#391)

> **Status of this document.** This is a model review plus grader probes (one reader, Claude), not ledger-grade acceptance. No ledger row was written and no task was issued. The system-design track stays hidden (`CODING_SECTION_TRACKS` in `shared/coding-catalog.ts` still leaves it out) pending the owner's decision and a fresh review pass of the edited tasks. Line numbers in the review refer to the file at `c1d1c1dd`, before the fixes. Each task carries a **Fixes applied** note beneath its verdict.

- Date: 2026-10-22. Reviewer: model (Claude), one reading plus grader probes. No second reader and no human review.
- Source: `lib/coding/tasks/system-design.ts` at main `c1d1c1dd` (last changed in `75808c38`, sha256 `f70385a9…0fbaa9e68ba637f767d0bc8c4a58`). All line numbers below refer to this file unless another file is named.
- The review itself was read-only: nothing was restored, unhidden or edited. The fixes noted under each task came afterwards, in the change that added this file.

## Scope and how the track is hidden

- There are 45 tasks: 5 guided walkthroughs (`sd-*`, `verify: "guided"`, five steps each, `passMark: 4`) and 40 drills (`dd-*`, `verify: "drill"`). The drills split into 10 `estimate`, 15 `tradeoff`, 10 `bottleneck` and 5 `sequence`.
- The answer keys live inline in the task file. There is no `lib/coding/solutions/system-design.ts`. `prepareDesign`/`gradeDesign` in `lib/coding/grade.ts:17-111` shuffle the options, seal the key in the session and grade against it. An estimate passes when `min <= value <= max`, inclusive (`grade.ts:78-85`). A sequence must match the whole order exactly (`grade.ts:86-89`). Explanations and the reference are returned only after a pass (`grade.ts:106-111`).
- Two separate mechanisms keep the track hidden:
  1. `CODING_SECTION_TRACKS` leaves out `system-design` (`shared/coding-catalog.ts:44`). `ACTIVE_CODING_TASKS` filters on that list (`lib/coding/active.ts:36-38`), and `isHiddenCodingTask` makes the task resource answer 404.
  2. The ledger has no rows for them: `docs/audit/devshark-content-ledger.json` has 0 `sd-`/`dd-` ids. With the coding scope gate on, they would also be withheld as unreviewed.
- `scripts/test-coding-content.ts:645-667` proves only that each key passes and that one mechanically wrong answer fails. It does not test how wide the bands are, length clues or ambiguity. I added those probes myself (below).

## What the tasks were reviewed against

This is the repo's own bar from `.claude/skills/coding-task-authoring/SKILL.md`, the ledger-row template (`.claude/skills/learn-question-authoring/references/ledger-row.md`) and `docs/curation-claims.md`:

- Seven quality dimensions, each needing at least 3/5: topicRelevance, learningValue, technicalCorrectness, wording, answerOptions, hint and explanation.
- Five relevance markers that must total at least 4/10.
- Correctness must be verified, and the key must be the only right answer.
- Longest-answer clues count as defects. The question bank revised "all 64 eligible answer-length candidates" (#391), and NEEDED.md tracked that clue class when this review was written.

## Verdict rules

- **pass**: can return as written. Any nits listed are optional.
- **needs-fix**: at least one change is required before the task returns. That covers a wrong or misleading key, band or explanation, real ambiguity, or a strong length clue. For a single-question drill, a strong length clue means the correct option is strictly the longest at 1.2× or more of the next-longest option. For a walkthrough, it means picking the longest option passes the whole task, or a step reaches 1.5× or more.
- **withdraw**: the task cannot be repaired within the format.

## Grader probes (Node 24.22.1, copied sources, read-only)

| Probe | Result | Meaning |
|---|---|---|
| `dd-rows-in-two-years` answered with one year (182,500) | **passed** | Wrong answer passes |
| `dd-a-year-of-photos` ignoring the 2 MB size (365) | **passed** | Wrong answer passes |
| `dd-requests-per-second` at the 2× peak (232) / 3× peak (347) | passed / failed | Inconsistent tolerance for a misread prompt |
| `dd-sizing-for-the-peak` with headroom (450, 600) | passed | Band quietly accepts up to 2× headroom |
| `dd-how-much-cache` using 1024 KB per MB (97.66) | passed | OK |
| `dd-a-day-of-messages` answered per year (73,000) | failed | OK |
| `dd-reading-through-a-cache` with "return" before "put in cache" | **failed** | A defensible order is rejected |
| "Always pick the longest option" strategy | **passes 25/30 choice tasks** (23/25 choice drills, 2/5 walkthroughs) | Systemic length clue |

The correct option is strictly the longest in 39 of the 50 choice items: 17 of 25 walkthrough steps, 12 of 15 tradeoffs and 10 of 10 bottlenecks. One more item is a tie. In the bottleneck drills the correct option is often about 2× the length of any distractor (1.57–2.11×). It is usually the only option that explains a mechanism ("…so X happens") against bare noun-phrase distractors.

## Problems that run across the track

- **S1. Length clue (most serious).** See the probe table. Shuffling hides the position of the correct option but not its length. For a one-question drill, the clue alone decides pass or fail. The fix is to give every distractor a mechanism clause of similar length, or trim the correct option.
- **S2. The briefs give away walkthrough answers.** `DesignRunner.tsx:207-209` shows `design.scenario` and `design.brief` before the learner answers. Several briefs state the keys outright:
  - `sd-to-do-list-api` (134): "server-enforced rule… a row… authorize inside the query… keep large lists bounded" covers 4 of 5 steps, and the pass mark is 4.
  - `sd-photo-sharing` (241) gives away 3 of 5 steps: data, design and scale.
  - `sd-url-shortener` (25), `sd-accounts-and-login` (349) and `sd-small-online-shop` (458) each give away 2 steps.
- **S3. The hints are inert and generic.** `DesignRunner.tsx` never renders `hints`, although `playable()` ships them (`lib/coding/catalog.ts:171`). All 40 drills carry one of four boilerplate hints:
  - "A rough number is fine — you are not expected to be exact." (estimates)
  - "Pick the option that fits this situation best." (tradeoffs)
  - "Name the first thing that breaks." (bottlenecks)
  - "Put the steps in the order they happen." (sequences)

  Against the ledger's `hint` dimension these score 1–2. That dimension failed 2,126 bank questions. Before scoring, decide: either write and render real hints, or record hint as N/A with a reason.
- **S4. Tasks contradict each other.**
  - `sd-small-online-shop` stores `orders.total` (530), but `dd-store-the-total-or-add-it-up` marks storing the total wrong.
  - `dd-where-uploaded-files-go` says the file "never travels through your app" (846), but `dd-uploading-a-file` step 1 sends the file to the server (1632).
  - `dd-what-is-worth-caching` says a stale stock count oversells (1098), but the shop design prevents overselling in the checkout transaction and allows stock to be cached "for seconds at most" (523, 546).
- **S5. Many near-duplicates.** If the whole track returns, these overlap:
  - photo-sharing data/scale ≈ `dd-where-uploaded-files-go` / `dd-resizing-during-upload` (almost the same option text)
  - accounts design ≈ `dd-where-a-login-lives` ≈ `dd-sessions-and-a-second-server`
  - `dd-a-query-that-got-slow` ≈ `dd-a-table-with-no-index`
  - `dd-a-list-that-keeps-growing` ≈ `dd-returning-everything` ≈ to-do scale
  - `dd-images-loading-slowly` ≈ `dd-serving-images-yourself`
  - `dd-answering-for-a-missing-thing` ≈ url-shortener deepdive
  - `dd-storing-passwords` ≈ accounts requirements/data
- **S6. Estimate band rule.** The bands run from about 0.4× to 2.5× of the key. That is fine unless a single-step mistake lands inside the band, such as dropping a given factor of 2 or 3 or using the wrong period. Suggested rule: every band must exclude the result of each one-factor omission or doubling. Only two bands break this rule today.
- **S7. Walkthrough reference diagrams.** The diagrams are ASCII art in `.cd-reference { white-space: pre-wrap }` (`client/src/coding/Coding.css:487`) with a proportional font. The `|`/`v` connectors will misalign and wrap at phone width. A monospace `<pre>` or a figure would fix it. This needs a visual check before the track returns.

---

## Walkthroughs (guided)

### 1. `sd-url-shortener` — URL shortener — **needs-fix**
- **Deepdive explanation does not match its options (77 vs 70-75).** The options are 404, 410-for-every-miss, a 302 to a search page, and 204. The explanation argues against a **500**, a **homepage** redirect and an **empty 200**, none of which are offered. A learner who passes reads reasoning about options they never saw. Rewrite it to address 410 (only right when you know the code once existed and was deleted), a 302 to search (hides a broken campaign, and monitoring sees success) and 204.
- **Requirements step (31-38).** The key is an assertion, not something to "find out", and the task prompt (16), the hint (19) and the brief (25) all state it. The correct option is 1.85× the next-longest. Rephrase it as a question ("How many redirects per created link?") and balance the lengths.
- Optional: the scale explanation (90) and the reference (112) are sound. The reference's 301-vs-302 trade-off is a good point.

**Fixes applied**
- Removed the read/write ratio from the task prompt, the brief and the hint; the brief now names the five decisions without answering them.
- Requirements step: every option is now a question to find out; the key reads "How many times a link is followed for each link that is created" and is no longer the longest.
- Deepdive explanation rewritten against the options offered: 404 versus 410 (only for codes known to be deleted), a 302 to a search page (looks healthy to monitoring) and 204 (reports success on a blank page).
- Design and scale steps: one distractor each lengthened with a mechanism, so the key is not the longest.

### 2. `sd-to-do-list-api` — To-do list API — **needs-fix**
- **The brief (134) gives away 4 of 5 answers** (ownership, row model, authorize in the query, bounded lists), and the pass mark is 4 (S2).
- **Scale step (192-197):** the correct option is 81 characters against at most 40 (2.02×).
- Requirements key (141) restates the task prompt (125) "must see only their own data".
- Optional: "reads outnumber writes heavily in this kind of app" (221) is doubtful for a to-do app, where ticking items off is constant writing. Soften it.

**Fixes applied**
- Brief rewritten: it names the decisions (first rule, tables, list request, errors, long lists) and states none of the keys. The prompt and scenario no longer say "see only their own data" (and the scenario no longer calls the app "shared").
- Requirements key rephrased as "Who owns each task, and whether anybody else may ever see it"; the explanation now says what the team agrees.
- Scale step: distractors carry mechanisms (spread over two machines, refresh on change, stop sharing resources); the key is 80 characters against 80 to 82.
- Design step: the URL distractor now covers the request body too.
- Reference: "reads outnumber writes heavily in this kind of app" softened to "if reads come to dominate".

### 3. `sd-photo-sharing` — Photo sharing — **needs-fix**
- **Picking the longest option passes the walkthrough** (4 of 5 steps longest). The scale option (300) is 1.83× the next.
- The brief (241) gives away the data, design and scale answers.
- The data and scale steps are near-copies of `dd-where-uploaded-files-go` and `dd-resizing-during-upload` (S5).
- Content is correct. The deepdive explanation (293) rightly accepts a pending-row alternative, and that alternative is not one of the options.

**Fixes applied**
- Brief and prompt rewritten so they no longer give away the data, design and scale answers.
- All five steps rebalanced; picking the longest option now scores 0 of 5 (was 4 of 5). The scale distractors carry mechanisms and the explanation now says why each is wrong.
- Open: the near-duplication with `dd-where-uploaded-files-go` and `dd-resizing-during-upload` (S5) is an owner decision about track size and stays as it was.

### 4. `sd-accounts-and-login` — Accounts and login — **pass**
- Keys, explanations and reference are correct. Picking the longest option scores 3/5 and fails. The largest length ratio is 1.38 (scale, 408).
- Optional nits for the reference (417-436):
  - Mention SameSite/CSRF next to HttpOnly and Secure (430), and regenerating the session id at login (session fixation).
  - Note that sign-up and reset must not reveal account existence either; otherwise the uniform login message (395, 401) achieves nothing. This also bears on `dd-signing-somebody-up`.
  - Argon2id is the current OWASP first choice; bcrypt is still acceptable.

**Fixes applied**
- No change. Open nits: SameSite/CSRF, session-id regeneration, enumeration through sign-up and reset, Argon2id. The brief still gives away two steps (S2); left because the task passed and the brief edit was not required.

### 5. `sd-small-online-shop` — Small online shop — **needs-fix**
- **Picking the longest option passes the walkthrough** (4 of 5 longest). The design step's correct option (491) is the only one with technical vocabulary ("Atomically", "idempotency key") and is 1.28× the next.
- The reference stores `orders.total` (530), which `dd-store-the-total-or-add-it-up` teaches is wrong (S4). The shop is the more realistic side; fix the drill, not the shop.
- Content is otherwise strong: stock constraint, reserve/charge/settle states, idempotency key per checkout, reconciliation (540-543).

**Fixes applied**
- Brief and prompt rewritten so they no longer give away the requirements and scale answers.
- Design step: all four options now use the same vocabulary (transaction, unique key, cached count); the key is 107 characters against 105 to 108. The explanation covers each distractor.
- Requirements, deepdive and scale steps rebalanced; picking the longest option now scores 0 of 5 (was 4 of 5).
- The reference still stores `orders.total`; the drill (#30) moved instead, as the review recommended.

## Estimates

For each drill I redid the arithmetic and tried the common one-step mistakes against the band.

### 6. `dd-requests-per-second` — **pass**
1,000,000 × 10 / 86,400 = 115.7, so key 116 is right (570). The band of 50–300 (571-572) accepts the ÷100,000 shortcut (100) and rejects dropping the ×10 (11.6) and per-hour mistakes. Optional: answering the 2× peak (232) passes while the 3× peak (347) fails. The prompt says "evenly", so this is acceptable.

**Fixes applied**
- Hint replaced with a task-specific one. No other change.

### 7. `dd-a-year-of-photos` — **needs-fix (band)**
1,000 × 2 MB × 365 = 730,000 MB = 730 GB, so the key (595) is right. **The band of 350–1,500 (596-597) passes 365, the answer you get by ignoring the 2 MB photo size**, and nearly passes the double count (1,460). **Corrected band: min 500, max 1,100.** It still accepts 713 (base 1024), 720 (30-day months) and 800 (rounding to 400 days).

**Fixes applied**
- Band changed from 350–1,500 to **500–1,100**. Arithmetic redone: 1,000 × 2 MB × 365 = 730,000 MB = 730 GB (key unchanged). Rejected: 365 (2 MB ignored), 1,460 (2 MB counted twice), 2 (one day). Accepted: 713 (÷1,024), 720 (360 days), 800 (400 days).
- Hint replaced with a task-specific one. The contract test now asserts that 365 and 1,460 fail and 713 passes.

### 8. `dd-how-much-cache` — **pass**
100,000 × 1 KB = 100 MB, so the key (620) and the band of 40–250 are right. Optional: 1 KB for a whole built page is unrealistically small (real pages are usually 10–100 KB). The conclusion that caching is cheap (618) holds even at 10 KB (1 GB). Consider 10 KB with key 1,000 MB and band 400–2,500.

**Fixes applied**
- Hint replaced with a task-specific one. Open nit: 1 KB per built page is small; not changed.

### 9. `dd-rows-in-two-years` — **needs-fix (band)**
500 × 365 × 2 = 365,000, so the key (645) is right. **The band of 150,000–800,000 (646-647) passes 182,500, the one-year answer**, which skips the question's main parameter. **Corrected band: min 250,000, max 550,000.** It still accepts 360,000 (500 × 30 × 12 × 2) and 400,000 (500 × 400 × 2).

**Fixes applied**
- Band changed from 150,000–800,000 to **250,000–550,000**. Arithmetic redone: 500 × 365 × 2 = 365,000 (key unchanged). Rejected: 182,500 (one year), 730,000 (four years or a doubled rate). Accepted: 360,000 (30-day months), 400,000 (400-day years).
- Hint replaced with a task-specific one. The contract test now asserts that 182,500 fails and 360,000 passes.

### 10. `dd-people-online-at-once` — **pass**
5% of 100,000 = 5,000, so the key (670) and the band of 2,000–12,000 are right. Getting the percentage wrong by 10× (500 or 50,000) fails.

**Fixes applied**
- Hint replaced with a task-specific one. No other change.

### 11. `dd-a-day-of-messages` — **pass**
1,000,000 × 200 B = 200 MB, so the key (695) and the band of 80–500 are right. The yearly figure of 73 GB is consistent with "well under a hundred gigabytes" (693), though "well" is a stretch.

**Fixes applied**
- Hint replaced with a task-specific one. No other change.

### 12. `dd-a-month-of-backups` — **pass**
50 GB × 30 = 1,500 GB, so the key (720) and the band of 700–3,000 are right. Dropping the ×30 (50) fails.

**Fixes applied**
- Hint replaced with a task-specific one. No other change.

### 13. `dd-sizing-for-the-peak` — **pass**
100 × 3 = 300, so the key (745) and the band of 200–600 are right. Using the average (100) fails. Optional: the question "should the servers be able to handle?" (734) invites headroom, and the explanation recommends it (743). The band accepts up to 2× headroom (600) without saying so. Suggest wording such as "…handle at the busiest hour, before any headroom?"

**Fixes applied**
- Optional nit applied: the question now asks for the busiest hour "before any headroom". Band unchanged (100 × 3 = 300; 200–600). Hint replaced with a task-specific one.

### 14. `dd-the-size-of-an-index` — **pass**
1,000,000 × 20 B = 20 MB, so the key (770) and the band of 8–50 are right. Optional: "update every one of them on every write" (768) overstates it. Inserts and deletes touch every index; an update touches only the indexes on the changed columns.

**Fixes applied**
- Optional nit applied: the explanation now says inserts and deletes update every index and an update touches the indexes on the changed columns. Hint replaced with a task-specific one.

### 15. `dd-data-leaving-per-day` — **pass**
10,000 × 1 MB = 10 GB, so the key (795) and the band of 4–25 are right. Optional: browser caching means repeat views pull less than 1 MB, but the prompt fixes the number.

**Fixes applied**
- Hint replaced with a task-specific one. No other change.

## Tradeoffs

### 16. `dd-which-kind-of-database` — **pass**
The key (820) is right, and the explanation (818) covers every distractor. The correct and longest options are a tie at 69 characters, which is a minor risk.

**Fixes applied**
- Hint replaced with a task-specific one. The key still ties for longest (69 characters); left as it was.

### 17. `dd-where-uploaded-files-go` — **needs-fix**
- The explanation says "so the picture never travels through your app" (846). That is true only for direct, pre-signed uploads, and `dd-uploading-a-file` (1632) teaches the opposite (S4). Reword it: "object storage can serve the file straight to browsers (and, with a pre-signed URL, accept the upload directly)".
- Near-copy of the photo-sharing data step (S5).
- No length clue (1.08).

**Fixes applied**
- Explanation reworded: object storage serves files straight to browsers "and with a pre-signed upload URL it can accept the upload directly too". It no longer contradicts `dd-uploading-a-file`.
- Options rebalanced; the key is no longer the longest. Hint replaced. The S5 overlap with photo sharing stays open.

### 18. `dd-where-a-login-lives` — **needs-fix (length)**
The key (876) is right. It is 1.48× the next-longest option and the only one naming concrete technology ("Redis or a database table"). Optional: signed stateless tokens and sticky sessions are real alternatives that the explanation never mentions. A single sentence would cover them.

**Fixes applied**
- Key shortened to "In a shared store that every server reads, such as Redis or a table"; each distractor now carries a reason of similar length. Ratio 1.48 → 0.84.
- Explanation now names the two other working designs (a signed token, sticky sessions) and their limit. Hint replaced.

### 19. `dd-storing-passwords` — **needs-fix (length)**
The key (904) and the explanation (902) are correct. The key is 1.44× the next-longest and the only option with a justification clause. Optional: mention per-password salts (bcrypt includes one) and Argon2id.

**Fixes applied**
- Options rebalanced: every distractor now carries a justification clause, and the fast-hash example is SHA-256. Ratio 1.44 → 0.96.
- Explanation now mentions Argon2id and a per-password salt. Hint replaced.

### 20. `dd-where-to-check-input` — **needs-fix (ambiguity)**
The prompt asks "Where does the checking have to happen for it to be **safe**?" (921, 929). Option 3, "On the server only, and drop the browser check" (934), is also safe. The explanation (930) rejects it only for usability. A learner can be marked wrong for a correct answer to the question as asked. Reword the question to "What should the team do?" or "…to be safe and usable?"

**Fixes applied**
- Question reworded to "What should the team do to keep the data safe and the form easy to use?", so the server-only option is wrong for a stated reason (usability) and not marked wrong for being unsafe.
- Options rewritten as actions of similar length; the explanation now says server-only is safe but worse. Hint replaced.

### 21. `dd-the-slow-email` — **pass**
The key (960) is right (length ratio 1.16). Optional: you could note the outbox pattern, saving the job in the same transaction as the account, but it is beyond tier 1.

**Fixes applied**
- Hint replaced with a task-specific one. No other change (key still longest at 1.16).

### 22. `dd-a-query-that-got-slow` — **needs-fix (minor)**
- The prompt (977, 984) never says the customer-id column has no index. The key "Add an index" (988) assumes it, and MySQL/InnoDB indexes foreign-key columns automatically. Add "there is no index on customer_id" to the scenario, as `dd-a-table-with-no-index` (1229) does.
- "usually turning seconds into milliseconds" (986) overstates the effect for a few hundred thousand rows; a full scan there typically costs tens of ms. Soften it to "turns a scan of the whole table into a few page reads".

**Fixes applied**
- Scenario and prompt now state "There is no index on the customer id column."
- Explanation softened to "turning a scan of the whole table into a few page reads". Hint replaced.

### 23. `dd-answering-for-a-missing-thing` — **pass**
The key (1016) and the explanation (1014) match the options exactly. Optional: 410 for products known to be deleted could be one sentence.

**Fixes applied**
- Hint replaced with a task-specific one. No other change.

### 24. `dd-plain-http-or-https` — **needs-fix (length)**
The key (1044) is right, 1.29× the next-longest and the only option with a qualifying clause. Optional: "Certificates are free and automated now" (1042) is less simple for internal-only hostnames, which need DNS-01 on a public domain or an internal CA.

**Fixes applied**
- Options rebalanced: the key lost its em-dash clause and every distractor carries a reason. Ratio 1.29 → 0.87.
- Explanation: "Certificates are free and automated now" replaced with public certificates for hostnames under a domain you own and an internal certificate authority for internal-only names. Hint replaced.

### 25. `dd-a-list-that-keeps-growing` — **pass**
The key (1072) is right (length ratio 1.11). Optional: notification retention or expiry is a legitimate product practice. "throwing away the product" (1070) is too strong; "changes the product to avoid the fix" would be fairer.

**Fixes applied**
- Hint replaced with a task-specific one. Open nit: "throwing away the product" wording not changed.

### 26. `dd-what-is-worth-caching` — **needs-fix**
- "A stock count that is a minute out of date sells something you do not have" (1098) mixes up displaying stock with enforcing it. The shop walkthrough enforces stock at checkout and allows a few seconds of caching (523, 546). Reword: a stale count misleads customers and shows sold-out items as available; the checkout must still check stock itself.
- The key (1100) is 1.33× the next-longest.

**Fixes applied**
- Explanation reworded: a stale stock count shows sold-out items as available and misleads customers; read it fresh or cache it for a few seconds; the checkout still checks stock itself. This now matches the shop walkthrough.
- The "Both" distractor now says a one-hour expiry, so it stays wrong under the shop's seconds-long stock caching. Options rebalanced; ratio 1.33 → 0.93. Hint replaced.

### 27. `dd-one-big-server-or-several` — **needs-fix (contested key)**
- The explanation's first sentence (1126) says a bigger machine "is genuinely simpler and is often the right first move", which supports option 2 (1129), a wrong answer.
- The prompt (1117) states no availability or growth requirement, so vertical scaling is a defensible answer, and a learner who chooses it with that reasoning fails.
- The key (1128) is 102 characters against 72 (1.42×).
- Fix: add the requirement to the scenario ("must stay up when one machine fails or is redeployed, and traffic keeps growing") and balance the lengths.

**Fixes applied**
- Scenario and prompt now state the requirement: "The site must stay up when one machine fails or is redeployed, and traffic keeps growing every month."
- Explanation's first sentence no longer backs the distractor; it says a bigger machine is fine only without those needs, and why the cost and single-point-of-failure distractors are wrong.
- Options rebalanced; ratio 1.42 → 0.97. Hint replaced.

### 28. `dd-images-loading-slowly` — **needs-fix (length)**
The key (1156) is right, 1.25× the next-longest, and the only option carrying a definition. Optional: "never trouble your servers at all" (1154) overstates it, because CDN cache misses still reach the origin.

**Fixes applied**
- Options rebalanced: the key lost its definition clause and each distractor carries a mechanism. Ratio 1.25 → 0.90.
- Explanation: "never trouble your servers at all" → "only a cache miss reaches your servers". Hint replaced.

### 29. `dd-when-a-call-fails` — **needs-fix (length)**
The key (1184) is 1.37× the next-longest. Add jitter to the explanation (1182): with synchronised exponential backoff, many workers still retry in waves.

**Fixes applied**
- Options rebalanced; the key now mentions randomness and each distractor carries a reason. Ratio 1.37 → 0.95.
- Explanation now explains jitter. Hint replaced.

### 30. `dd-store-the-total-or-add-it-up` — **needs-fix**
- It contradicts the track's own shop design, which stores `orders.total` (530) (S4).
- For a placed order, the total actually charged is a historical fact (with tax, discounts, shipping and rounding), and the order lines are immutable afterwards. Storing it is standard, and "drift" (1210) does not arise.
- The scenario's "just the sum of those lines" (1201) saves the key only for a draft or mutable basket.
- Fix: set the scenario explicitly on a basket being edited, or move the key to "store the charged total once the order is placed" and reconcile with the shop.
- The key (1212) is 1.35× the next-longest.

**Fixes applied**
- Scenario moved to a basket the customer is still editing, as the review recommended. The explanation now says to store the total actually charged once the order is placed, which matches the shop walkthrough's `orders.total`.
- Options rebalanced; ratio 1.35 → 0.82. Hint replaced.

## Bottlenecks

All ten have the correct option strictly longest, and nine of them are at 1.2× or more. Without fixes, the format can be passed by length alone.

### 31. `dd-a-table-with-no-index` — **needs-fix (length)**
The key (1240) and the explanation (1238) are correct. Length ratio 1.23. Overlaps #22.

**Fixes applied**
- Distractors carry mechanisms; ratio 1.23 → 0.99. Explanation now also rules out the network. Hint replaced.

### 32. `dd-sessions-and-a-second-server` — **needs-fix (length)**
The key (1268) and the explanation (1266) are correct. Length ratio 1.57. Third copy of the shared-session lesson (S5); consider dropping one copy.

**Fixes applied**
- Distractors carry mechanisms; ratio 1.57 → 0.97. Explanation now also rules out the load balancer. Hint replaced. Open: duplicate of the shared-session lesson (S5).

### 33. `dd-emailing-inside-a-request` — **needs-fix (length)**
The key (1296) is correct: 2,000 sequential calls at about 0.1–0.3 s each take 200–600 s, far beyond a 30–60 s request limit. Length ratio 1.91. Optional: provider rate limits (429) are a plausible second failure.

**Fixes applied**
- Distractors carry mechanisms; ratio 1.91 → 0.97. Explanation now rules out the connection and memory distractors and mentions provider rate limits. Hint replaced.

### 34. `dd-serving-images-yourself` — **needs-fix (length)**
The key (1324) is correct, but its length ratio is 1.70. Optional: "thousands of times larger" (1322) should be "hundreds to thousands" against a 1–10 KB JSON response.

**Fixes applied**
- Distractors carry mechanisms; ratio 1.70 → 0.99. "thousands of times larger" → "hundreds to thousands of times larger". Explanation now rules out each distractor. Hint replaced.

### 35. `dd-everything-on-one-database` — **needs-fix (factual)**
The key (1352) is correct, and there is no length clue (1.04). But "a read replica: a synchronised copy" (1350) is misleading: replicas are usually asynchronous and lag behind the primary. Replication lag is the caveat a learner needs before sending reads there. Reword: "a continuously updated copy, usually slightly behind".

**Fixes applied**
- Explanation: "a synchronised copy" → "a continuously updated copy, usually a moment behind the original", plus the consequence: a read that must see the user's own latest write still goes to the original.
- Distractors lengthened a little; the key is no longer the longest. Hint replaced.

### 36. `dd-filtering-in-the-app` — **needs-fix (length)**
The key (1380) and the explanation (1378) are correct. Length ratio 1.98.

**Fixes applied**
- Options rebalanced; ratio 1.98 → 1.00 (a tie with one distractor). Hint replaced.

### 37. `dd-querying-in-a-loop` — **needs-fix (length)**
The key (1408) and the explanation (1406) are correct (N+1, 51 queries reduced to 2, or 1 with a join). Length ratio 2.11, the highest in the track.

**Fixes applied**
- Distractors carry mechanisms; ratio 2.11 → 1.01 (the key is longest by one character, which is no clue). Explanation now rules out the index and memory distractors. Hint replaced.

### 38. `dd-a-call-with-no-timeout` — **needs-fix (length)**
The key (1436) is correct, with a length ratio of 1.91. Optional: in stacks that hold a database connection per request, option 3, "connection pool exhausted first" (1438), can be literally true. The scenario has no database, so the key stands; a "no database involved" clause would close the gap.

**Fixes applied**
- Scenario and prompt now say the page uses no database, which closes the connection-pool gap.
- Distractors carry mechanisms; ratio 1.91 → 0.97. Explanation now rules out the rejecting-service and instant-error distractors. Hint replaced.

### 39. `dd-resizing-during-upload` — **needs-fix (length)**
The key (1464) is correct, with a length ratio of 1.68. It is a near-copy of the photo-sharing scale step: same answer, nearly the same wording (300 vs 1464).

**Fixes applied**
- Options reworded away from the photo-sharing scale step and rebalanced; ratio 1.68 → 0.96. Explanation now rules out each distractor. Hint replaced. Open: still the same lesson as the photo-sharing scale step (S5).

### 40. `dd-returning-everything` — **needs-fix (length)**
The key (1492) is correct, with a length ratio of 2.02. Overlaps #25 and the to-do scale step.

**Fixes applied**
- Options rebalanced; ratio 2.02 → 0.99. The "runs out of endpoints" distractor became "runs out of connections". Explanation now rules out each distractor. Hint replaced.

## Sequences

### 41. `dd-typing-a-web-address` — **needs-fix (factual wording)**
The order is unambiguous. Step 5, "Browser renders the page, then fetches the images and scripts it refers to" (1524), is wrong: the preload scanner fetches CSS and scripts while parsing, and render-blocking CSS/JS must arrive *before* the first render. The explanation (1518) repeats the idea. Reword: "Browser parses the HTML, fetches the styles, scripts and images it refers to, and renders the page".

**Fixes applied**
- Step 5 now reads "Browser parses the HTML, fetches the styles, scripts and images it refers to, and renders the page". The explanation says the browser draws once the HTML, styles and blocking scripts arrive while images keep loading. Hint replaced.

### 42. `dd-one-request-through-the-system` — **pass**
The order (1548-1552) is the only sensible one. Optional: the response normally returns through the load balancer, not straight "back to the browser" (1552).

**Fixes applied**
- Hint replaced with a task-specific one. Open nit: the response returns through the load balancer.

### 43. `dd-signing-somebody-up` — **pass**
The order (1576-1580) is defensible and explained (1574), including the unique-constraint race. Optional: the duplicate-email check is where sign-up leaks account existence. Say how the reply avoids that, consistent with `sd-accounts-and-login`.

**Fixes applied**
- Hint replaced with a task-specific one. Open nit: say how the duplicate-email reply avoids revealing account existence.

### 44. `dd-reading-through-a-cache` — **needs-fix (ambiguity)**
- Steps 3 and 4 (1606-1607), "put in cache with expiry" and "return the record", can validly happen in either order (async fill), and my probe confirms that the swapped order **fails**. Merge them, or make step 4 depend on step 3.
- The prompt says "one cached read" (1593, 1601), but the steps describe a cache **miss**. Say "the first read, when the cache is empty".
- The explanation (1602) is correct on delete-versus-update invalidation.

**Fixes applied**
- The drill now declares `acceptedOrders: [[0, 1, 3, 2, 4]]`, and the grader (`lib/coding/grade.ts`) accepts the authored order or any declared order. Returning the record before filling the cache now passes; reading the database first or removing the entry early still fails (pinned in the contract test).
- Prompt now says "the first read, when the cache is empty". The explanation says both orders pass. Hint replaced.

### 45. `dd-uploading-a-file` — **pass**
The order (1632-1636) is unambiguous and the explanation (1630) is consistent with photo-sharing. The fix for the contradiction with #17 belongs in #17. Optional: add the pre-signed direct-upload variant, and note that size can be refused before the body arrives (Content-Length).

**Fixes applied**
- Hint replaced with a task-specific one. Open nits: pre-signed direct upload variant, Content-Length check.

---

## Summary table

| # | id | format | verdict | main defect |
|---|---|---|---|---|
| 1 | sd-url-shortener | guided | needs-fix | deepdive explanation addresses options that do not exist; requirements key given away and 1.85× long |
| 2 | sd-to-do-list-api | guided | needs-fix | brief gives away 4/5 steps; scale step 2.02× long |
| 3 | sd-photo-sharing | guided | needs-fix | longest-option strategy passes; brief gives away 3/5 |
| 4 | sd-accounts-and-login | guided | pass | nits only (CSRF/SameSite, fixation, enumeration via sign-up) |
| 5 | sd-small-online-shop | guided | needs-fix | longest-option strategy passes; design key the only technical option |
| 6 | dd-requests-per-second | estimate | pass | — |
| 7 | dd-a-year-of-photos | estimate | needs-fix | band passes 365 (ignores 2 MB); use 500–1,100 |
| 8 | dd-how-much-cache | estimate | pass | nit: 1 KB per page unrealistic |
| 9 | dd-rows-in-two-years | estimate | needs-fix | band passes the one-year answer; use 250,000–550,000 |
| 10 | dd-people-online-at-once | estimate | pass | — |
| 11 | dd-a-day-of-messages | estimate | pass | — |
| 12 | dd-a-month-of-backups | estimate | pass | — |
| 13 | dd-sizing-for-the-peak | estimate | pass | nit: headroom ambiguity |
| 14 | dd-the-size-of-an-index | estimate | pass | nit: "every write" |
| 15 | dd-data-leaving-per-day | estimate | pass | — |
| 16 | dd-which-kind-of-database | tradeoff | pass | — |
| 17 | dd-where-uploaded-files-go | tradeoff | needs-fix | "never travels through your app" contradicts #45 |
| 18 | dd-where-a-login-lives | tradeoff | needs-fix | length 1.48 |
| 19 | dd-storing-passwords | tradeoff | needs-fix | length 1.44 |
| 20 | dd-where-to-check-input | tradeoff | needs-fix | "server only" is also safe: right answer fails |
| 21 | dd-the-slow-email | tradeoff | pass | — |
| 22 | dd-a-query-that-got-slow | tradeoff | needs-fix | missing index not stated; timing overstated |
| 23 | dd-answering-for-a-missing-thing | tradeoff | pass | — |
| 24 | dd-plain-http-or-https | tradeoff | needs-fix | length 1.29 |
| 25 | dd-a-list-that-keeps-growing | tradeoff | pass | nit: retention is legitimate |
| 26 | dd-what-is-worth-caching | tradeoff | needs-fix | overselling claim conflicts with shop; length 1.33 |
| 27 | dd-one-big-server-or-several | tradeoff | needs-fix | own explanation backs a distractor; no requirement given |
| 28 | dd-images-loading-slowly | tradeoff | needs-fix | length 1.25 |
| 29 | dd-when-a-call-fails | tradeoff | needs-fix | length 1.37; add jitter |
| 30 | dd-store-the-total-or-add-it-up | tradeoff | needs-fix | contradicts shop reference; placed-order totals are normally stored |
| 31 | dd-a-table-with-no-index | bottleneck | needs-fix | length 1.23 |
| 32 | dd-sessions-and-a-second-server | bottleneck | needs-fix | length 1.57; duplicate |
| 33 | dd-emailing-inside-a-request | bottleneck | needs-fix | length 1.91 |
| 34 | dd-serving-images-yourself | bottleneck | needs-fix | length 1.70 |
| 35 | dd-everything-on-one-database | bottleneck | needs-fix | "synchronised" replica; lag omitted |
| 36 | dd-filtering-in-the-app | bottleneck | needs-fix | length 1.98 |
| 37 | dd-querying-in-a-loop | bottleneck | needs-fix | length 2.11 |
| 38 | dd-a-call-with-no-timeout | bottleneck | needs-fix | length 1.91 |
| 39 | dd-resizing-during-upload | bottleneck | needs-fix | length 1.68; duplicate of photo-sharing scale |
| 40 | dd-returning-everything | bottleneck | needs-fix | length 2.02 |
| 41 | dd-typing-a-web-address | sequence | needs-fix | step 5 misstates render/subresource order |
| 42 | dd-one-request-through-the-system | sequence | pass | — |
| 43 | dd-signing-somebody-up | sequence | pass | nit: enumeration |
| 44 | dd-reading-through-a-cache | sequence | needs-fix | valid swapped order fails; "cached read" is a miss |
| 45 | dd-uploading-a-file | sequence | pass | — |

## Counts

| Format | Tasks | pass | needs-fix | withdraw |
|---|---|---|---|---|
| guided | 5 | 1 | 4 | 0 |
| estimate | 10 | 8 | 2 | 0 |
| tradeoff | 15 | 4 | 11 | 0 |
| bottleneck | 10 | 0 | 10 | 0 |
| sequence | 5 | 3 | 2 | 0 |
| **Total** | **45** | **16** | **29** | **0** |

The 29 needs-fix tasks split into two groups:

- **13 with content defects:** #1, #7, #9, #17, #20, #22, #26, #27, #30, #35, #41 and #44, plus #2 for its answer-revealing brief.
- **16 only for length clues or a walkthrough passable by length:** #3, #5, #18, #19, #24, #28, #29, #31-34 and #36-40.

No task needs withdrawing. #32 and #39 are candidates for dropping as duplicates if the owner wants a smaller track. The systemic items S2 (briefs), S3 (hints) and S7 (diagram rendering) apply across the track whatever the per-task verdicts.

## Fixes applied across the track (22 October 2026)

| Item | State after the fixes |
|---|---|
| S1 length clue | Fixed. The key is strictly the longest option in **8 of 50** choice items (was 39; chance with four options is 12.5) and strictly the shortest in 7. "Always pick the longest option", with ties counted as a pass, passes **6 of 30** choice tasks (was 25; 4 of 30 with ties counted as a miss, was 24), and 0 of 5 walkthroughs. The remaining longest keys are in tasks that passed (`sd-accounts-and-login` ×3, `dd-the-slow-email`, `dd-answering-for-a-missing-thing`, `dd-a-list-that-keeps-growing`) or longer by one or two characters (`sd-to-do-list-api` design, `dd-querying-in-a-loop`). |
| S2 briefs | Fixed for the four needs-fix walkthroughs (URL shortener, to-do API, photo sharing, shop). Open for `sd-accounts-and-login`, which passed. |
| S3 hints | All 40 drill hints and the URL-shortener hint are now task-specific. Open: `DesignRunner.tsx` still does not render `hints`; rendering them is a UI change for the owner's decision on the track. |
| S4 contradictions | Fixed: #17 (pre-signed upload), #26 (stock display versus enforcement), #30 (basket, not placed order). |
| S5 near-duplicates | Open. Dropping #32 or #39 is an owner decision about track size. |
| S6 band rule | Applied to the two bands that broke it (#7, #9); the other eight were already consistent. |
| S7 reference diagrams | Open. The reference is one string that mixes prose and an ASCII diagram, rendered in `<p className="cd-reference">` with `white-space: pre-wrap`. A monospace font for the whole block would make the prose monospace too, and splitting the diagram out needs new parsing or a data-shape change, so this is not a pure CSS or markup change already used for code blocks. It needs a visual check before the track returns. |

The contract in `scripts/test-coding-content.ts` (hidden-tracks block) now also asserts that the corrected bands refuse 182,500, 365 and 1,460 and accept 360,000 and 713; that the swapped cache order passes and two other swaps fail; that "always pick the longest option" passes fewer than half of the choice tasks; and that the key is strictly the longest in no more items than chance. Against the file before these fixes, every one of those assertions fails.

## Question for the owner

The 45 hidden system-design tasks are now reviewed. 16 could return as they are, 29 need fixes and none needs withdrawing. The main problems are:

- Choosing the longest option passes 25 of the 30 multiple-choice tasks.
- Two estimate bands accept a wrong answer.
- Several explanations contradict their own options or other tasks in the track.

Do you want this format (5-step walkthroughs plus quick estimate, tradeoff, bottleneck and sequence drills, graded by a sealed key) to come back once those fixes are made and a fresh review passes? Or should the track stay hidden or be retired? The track stays hidden until you decide.

## Second reading, 26 November 2026

Three independent model readers (Claude) re-read all 45 tasks in the edited file at `origin/main` `769142b1`, one batch of 15 each, and recomputed every estimate. They applied the verdict rules above, including the length-clue rule, and recorded for each task whether they agree with the first reading. The rows are in [`wip/system-design/`](wip/system-design/) as one JSON line per task. The coordinating reader checked every proposed edit in context before applying it, one commit per task.

- Result: 33 pass, 12 needed a fix. No key, estimate band or sequence order is wrong. The fixes rebut distractors that the explanations left unanswered, correct three small facts and stop one brief and three hints from giving away step answers.
- Length clues: none. The ratio of the correct option to the longest other option is 0.82 to 1.16 in the 25 choice drills. In walkthroughs the longest option is correct in at most 3 of 5 steps (`sd-accounts-and-login`), which is below the pass mark of 4, and no step reaches 1.5×.
- Estimate bands: each of the ten bands contains the key and rejects a 10× error. Their width is 2.2× to 6.3×.
- Disagreements with the first reading: `sd-accounts-and-login` (the brief gave away two answers), `sd-url-shortener` (the hint still stated the requirements answer), `dd-the-slow-email`, `dd-serving-images-yourself` and `dd-emailing-inside-a-request` (distractors left unrebutted).
- Still a model review only. It is not ledger-grade acceptance, and there is no human reader. The track stays hidden until the owner decides whether the reviewed format returns.

| Task | Format | Verdict | Length ratio | Fix |
| --- | --- | --- | ---: | --- |
| `sd-url-shortener` | design | fix | 1.00 | The hint states the requirements step key almost verbatim (count creators vs clickers), although the first review records the read/write ratio as removed from the hint |
| `sd-to-do-list-api` | design | pass | 1.01 |  |
| `sd-photo-sharing` | design | pass | 0.99 |  |
| `sd-accounts-and-login` | design | fix | 1.38 | The brief, shown before any step, states the requirements key and the design key outright; The deepdive explanation does not say why the 'Wrong password regardless' option is worse, and 'The friendlier wording is a real cost' reads as the opposite of what is meant; The hint states the requirements step key |
| `sd-small-online-shop` | design | fix | 0.99 | The hint names the requirements step key (the stock count) and the scale insight (browsing is most traffic) |
| `dd-requests-per-second` | estimate | pass | n/a |  |
| `dd-a-year-of-photos` | estimate | pass | n/a |  |
| `dd-how-much-cache` | estimate | pass | n/a |  |
| `dd-rows-in-two-years` | estimate | pass | n/a |  |
| `dd-people-online-at-once` | estimate | pass | n/a |  |
| `dd-a-day-of-messages` | estimate | pass | n/a |  |
| `dd-a-month-of-backups` | estimate | pass | n/a |  |
| `dd-sizing-for-the-peak` | estimate | pass | n/a |  |
| `dd-the-size-of-an-index` | estimate | pass | n/a |  |
| `dd-data-leaving-per-day` | estimate | pass | n/a |  |
| `dd-which-kind-of-database` | tradeoff | pass | 1.00 |  |
| `dd-where-uploaded-files-go` | tradeoff | pass | 0.93 |  |
| `dd-where-a-login-lives` | tradeoff | pass | 0.84 |  |
| `dd-storing-passwords` | tradeoff | fix | 0.96 | Explanation says slow hashes make guessing millions of candidates impractical |
| `dd-where-to-check-input` | tradeoff | pass | 0.91 |  |
| `dd-the-slow-email` | tradeoff | fix | 1.16 | Explanation does not rebut the 'Send the email during the request, as now, but with a shorter timeout' distractor |
| `dd-a-query-that-got-slow` | tradeoff | pass | 0.93 |  |
| `dd-answering-for-a-missing-thing` | tradeoff | pass | 1.07 |  |
| `dd-plain-http-or-https` | tradeoff | pass | 0.87 |  |
| `dd-a-list-that-keeps-growing` | tradeoff | pass | 1.11 |  |
| `dd-what-is-worth-caching` | tradeoff | pass | 0.93 |  |
| `dd-one-big-server-or-several` | tradeoff | fix | 0.97 | Explanation says managed load balancers run as redundant pairs |
| `dd-images-loading-slowly` | tradeoff | pass | 0.90 |  |
| `dd-when-a-call-fails` | tradeoff | pass | 0.95 |  |
| `dd-store-the-total-or-add-it-up` | tradeoff | pass | 0.82 |  |
| `dd-a-table-with-no-index` | bottleneck | pass | 0.99 |  |
| `dd-sessions-and-a-second-server` | bottleneck | pass | 0.97 |  |
| `dd-emailing-inside-a-request` | bottleneck | fix | 0.97 | The explanation never says why the spam distractor is wrong, though it rebuts the other two |
| `dd-serving-images-yourself` | bottleneck | fix | 0.99 | The explanation does not address the database distractor |
| `dd-everything-on-one-database` | bottleneck | fix | 0.97 | The explanation does not say why the load balancer and network distractors are wrong |
| `dd-filtering-in-the-app` | bottleneck | fix | 1.00 | The explanation does not address the connection-pool or browser distractors |
| `dd-querying-in-a-loop` | bottleneck | fix | 1.01 | The explanation says that both remedies, an id-list query or a join, turn 51 trips into two |
| `dd-a-call-with-no-timeout` | bottleneck | pass | 0.97 |  |
| `dd-resizing-during-upload` | bottleneck | pass | 0.96 |  |
| `dd-returning-everything` | bottleneck | pass | 0.99 |  |
| `dd-typing-a-web-address` | sequence | pass | n/a |  |
| `dd-one-request-through-the-system` | sequence | pass | n/a |  |
| `dd-signing-somebody-up` | sequence | pass | n/a |  |
| `dd-reading-through-a-cache` | sequence | pass | n/a |  |
| `dd-uploading-a-file` | sequence | pass | n/a |  |
