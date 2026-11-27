/** FDE — the optional placement diagnostic.
 *
 * Twelve authored scenarios and two short debugging exercises, arranged so a
 * learner finds out where they already stand before committing forty hours.
 * It is skippable by design: the module carries no requirements, no activity
 * here gates anything, and passing it grants no exemption from a bridge or a
 * module. What it produces is a recommendation.
 *
 * The scenarios split four ways, three items each: APIs and data, security
 * and operations, the operator's screen, and evaluating an AI-assisted
 * result. Every question tags the competencies it touches, because the
 * per-competency report is built from those tags. A competency no question
 * carries comes back as `not_assessed` — never as a zero, which would claim a
 * measurement nobody made.
 *
 * Both coding exercises hand the learner code that is already broken and say
 * so. Every page, delay and outcome they meet is a synthetic in-memory
 * fixture built in the task harness. No network, no vendor, no live model.
 */

import type { ModuleSource } from '../../types';

/** A paginated source, a caller-owned array and a record of what the
 * submission actually asked for. Appended after the learner's code, so the
 * probe cannot be shadowed by a same-named declaration in the submission. */
const PAGE_PROBE = `
var __collect = function (pages, known) {
  var requested = [];
  var before = JSON.stringify(known);
  var fetchPage = function (page) {
    requested.push(page);
    var entry = pages[page - 1] || [];
    return new Promise(function (resolve) {
      setTimeout(function () { resolve({ items: entry.slice(), pageCount: pages.length }); }, 20);
    });
  };
  return Promise.resolve(collectAll(fetchPage, known)).then(function (result) {
    return {
      result: result,
      requested: requested,
      callerUnchanged: JSON.stringify(known) === before,
      sameArray: result === known,
    };
  });
};
`.trim();

export const FDE_DIAGNOSTIC: ModuleSource = {
  id: 'fde-v1-diagnostic',
  title: 'Where you already are',
  optional: true,
  outcomes: [
    'See which FDE competencies you can already show, and which this diagnostic never looked at.',
    'Get bridge recommendations aimed at the gaps, with nothing locked or unlocked by the result.',
    'Skip the whole thing: it is optional, it grants no exemption, and on its own it completes nothing.',
    'Read a competency no question here touched as not assessed rather than as a zero.',
  ],
  competencies: ['integration', 'boundaries', 'handoff', 'evaluation'],
  dependsOn: [],
  estimatedMinutes: 40,
  lessons: [],
  activities: [
    {
      id: 'fde-v1-diagnostic-check',
      kind: 'check',
      purpose: 'diagnostic',
      verification: 'machine_verified',
      title: 'Twelve situations',
      summary:
        'Twelve scenarios across APIs/data, boundaries/operations, operator state and evaluation. The latest accepted answers determine each tagged competency separately, including questions with multiple tags. An overall pass can still leave an area to practise. Older aggregate-only results and uncovered areas are not assessed; retake to record current evidence. Optional and retryable: no unlock, exemption or path completion.',
      competencies: ['integration', 'boundaries', 'operations', 'handoff', 'evaluation'],
      estimatedMinutes: 16,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-diagnostic-q1',
          prompt:
            'A nightly job pulls contacts from a vendor API. The vendor accepts page_size 500 and null as the initial cursor. It may return a short page after filtering, even when more contacts remain; next_cursor is null only on the last page. The expected total across all returned pages is 11000 contacts. The job finishes without an error and stores about 4,000 of the 11,000 contacts. Which line explains it?',
          context: {
            language: 'javascript',
            code: 'const pullContacts = async () => {\n  const contacts = [];\n  let cursor = null;\n\n  while (true) {\n    const page = await vendor.contacts({ cursor, page_size: 500 });\n    contacts.push(...page.items);\n    if (page.items.length < 500) break;\n    cursor = page.next_cursor;\n  }\n\n  return contacts;\n};',
          },
          options: [
            '`if (page.items.length < 500) break;` — a short page can arrive mid-collection; only `next_cursor === null` marks the end.',
            '`contacts.push(...page.items)` — spreading 500 entries onto the argument list overflows it and drops the tail.',
            '`let cursor = null;` — a null cursor starts the scan from an undefined position, so the first request skips ahead in the list.',
            '`page_size: 500` is above the vendor maximum, so every response is truncated to the vendor default.',
          ],
          correct: 0,
          explanation:
            'The vendor says a short page is normal and marks the end with `next_cursor: null`. Breaking on a short page stops at the first filtered page and reports success, which is the symptom: no error, most of the records missing. The shown push calls completed without an error; argument-limit failures would throw, not silently drop a tail. The documented initial cursor is null and the documented page size is accepted, so neither explains this successful but incomplete scan. Check page.next_cursor === null to stop, otherwise carry that cursor into the next request. An empty nonfinal page must also continue.',
          competencies: ['integration'],
        },
        {
          id: 'fde-v1-diagnostic-q2',
          prompt:
            'A connector posts one invoice per approved order. When the invoice service answers 504, the connector retries the same POST up to three times. Finance reports that roughly one order in two hundred produced two invoices. Which change prevents duplicate invoices while preserving automatic retries, including concurrent attempts for the same order?',
          options: [
            'Retry at most once after a 504, so an order can produce no more than one extra invoice.',
            'Add exponential backoff with jitter, giving the invoice service time to finish before the next attempt.',
            'Persist one idempotency key per order; the service atomically returns the stored result on repeats.',
            'Stop retrying on 504 and send the timed-out order to an operator, who checks for an invoice before resending.',
          ],
          correct: 2,
          explanation:
            'A 504 says the gateway stopped waiting, not that the write failed, so the invoice may already exist. Reuse one persisted key for the same order and payload, with a server-side atomic claim/result record covering the retry window; concurrent attempts must not both create invoices. A fresh key on every retry would not help. Reducing retries can reduce exposure but does not make a retry safe, and backoff changes timing rather than write identity. Stopping retries can prevent that second automatic write, but fails the requirement to retry safely and leaves the first outcome unknown.',
          competencies: ['integration'],
        },
        {
          id: 'fde-v1-diagnostic-q3',
          prompt:
            'The nightly CSV export leaves `vat_id` blank for customers who have none, and the CSV reader hands blanks over as `""`. The same field arrives as `null` from the vendor JSON API. Assume a nullable text field with no extra validation. What does this mapper store for a CSV blank, and what does an empty-string lookup match?',
          context: {
            language: 'javascript',
            code: 'const toCustomer = row => ({\n  externalId: row.customer_id,\n  name: row.name,\n  vatId: row.vat_id !== null ? row.vat_id : null,\n});\n\nconst findByVat = (customers, vatId) =>\n  customers.filter(one => one.vatId === vatId);',
          },
          options: [
            'The mapper stores null because the empty string is falsy; a lookup for the empty string finds none of those rows.',
            'The mapper stores `""`; `findByVat(customers, "")` returns all customers whose mapped vatId is the empty string.',
            'The mapper receives null because the CSV reader converts blanks; the two source formats therefore agree.',
            'The nullable text field rejects the empty string, so no mapped customer can be stored.',
          ],
          correct: 1,
          explanation:
            '`row.vat_id !== null` is a null check, and `""` passes it, so a CSV blank becomes a value equal to every other empty string. A JSON null remains null and is not matched by an empty-string lookup. Nothing raises an error; a lookup by VAT id just starts matching a whole class of customers at once. The empty string is falsy, but the code tests `!== null` rather than truthiness, so a falsiness argument describes code that is not on the screen. The reader hands the raw column over, which is exactly why the two sources disagree. And a nullable column accepts `""` without complaint: the empty string is a value, not the absence of one.',
          competencies: ['integration'],
        },
        {
          id: 'fde-v1-diagnostic-q4',
          prompt:
            'The authenticated session authorizes only tenant A. The server database client can read every tenant, with no row policy or other authorization check. A user knows an existing tenant-B case id and can edit the request body. What can this handler expose?',
          context: {
            language: 'javascript',
            code: 'export default async function handler(req, res) {\n  const session = await requireSession(req);\n  const { tenantId, caseId } = req.body;\n\n  const record = await db.cases.findOne({ tenantId, id: caseId });\n  return res.json(record);\n}',
          },
          options: [
            'Tenant B’s requested case, because the server trusts the caller’s tenant and case ids.',
            'Nothing. The query is still filtered by tenant, so a user of tenant A gets no rows belonging to tenant B.',
            'Nothing, as long as the body is validated against a schema that requires `tenantId` to be a well-formed UUID.',
            'Nothing on reads. The pattern only matters for writes, where a wrong tenant id corrupts another tenant’s data.',
          ],
          correct: 0,
          explanation:
            'Authentication proves who called; this unrestricted database query still filters by the caller’s tenant claim rather than their authorized tenant. With both valid B ids supplied, the stated absence of another authorization layer lets the B record through. Derive `tenantId` from the session and ignore the body field; a row-level policy scoped to the session tenant is the second layer, in the database rather than in the handler. Arguing that the filter protects the row assumes the attacker cannot change the filter, and changing it is the attack. A schema check proves the value is a well-formed UUID and never that it belongs to this user. Reads are not the lesser case either: the case body is the data, so reading tenant B’s case is the breach.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-diagnostic-q5',
          prompt:
            'A Vite-built operator dashboard calls a vendor API from the browser with a secret server API key read from `import.meta.env.VITE_VENDOR_KEY`. The value lives in the hosting provider’s encrypted environment settings and is never committed. Who can read the key?',
          options: [
            'Nobody outside the build. The value exists only in the encrypted settings and is injected at build time.',
            'Only someone with access to the hosting dashboard, because minification renames the variable in the output.',
            'Anyone who loads the dashboard: the key ships to their browser in the client bundle.',
            'Anyone on the same network, unless the request is sent over TLS.',
          ],
          correct: 2,
          explanation:
            'Injected at build time means injected into the artifact. Vite exposes VITE-prefixed values to client code. A user who loads this dashboard can inspect the compiled value or the vendor request carrying it; encryption in the hosting settings does not hide it from that browser. The repair is structural: move the call behind a server route that holds the key, then rotate the key that already shipped. Encrypted settings protect the value at rest inside the provider, not after a build copied it into the output. Minification or obfuscation does not make a credential secret from the client that must use it. TLS protects the request in flight and does nothing about a secret the client already holds.',
          competencies: ['boundaries', 'operations'],
        },
        {
          id: 'fde-v1-diagnostic-q6',
          prompt:
            'Release 42 completes a migration that copies legacy_owner into owner_id and drops legacy_owner. Release 41 still reads legacy_owner. The team redeploys only release 41’s application artifact, without restoring data, changing schema or running migrations. What is the resulting compatibility problem?',
          options: [
            'A working system: redeploying release 41 also reverts the migrations release 42 applied.',
            'Release 41 expects the removed legacy_owner column; redeploying its code leaves the changed schema in place.',
            'A working system, because release 41 recreates any column it needs from its own migration history when it starts.',
            'A working system, as long as the backfill is replayed in reverse from the application log first.',
          ],
          correct: 1,
          explanation:
            'This code-only rollback changes the application artifact, not the schema. Release 41 still reads legacy_owner, so those reads now fail because that column is absent. Some values may still exist in owner_id, but redeploying old code does not reconstruct its expected column or prove a safe reverse migration. Migration tools do not run down-migrations because an older build started; a down-migration is a deliberate, separately tested step, and a drop is frequently not reversible at all. Replaying from the application log assumes the log holds every value and is complete, which describes a restore rather than a rollback. The way out is not to arrive here: add `owner_id`, write both columns, move readers across, and drop `legacy_owner` in a later release once no rollback target still needs it.',
          competencies: ['operations'],
        },
        {
          id: 'fde-v1-diagnostic-q7',
          prompt:
            'The triage queue shows a spinner while cases load, then the list. When the case service answers 503 the component keeps its `loading` flag set and the spinner stays up. What is the minimum fix?',
          options: [
            'Keep the spinner and add a header line saying results may be delayed while the service recovers.',
            'Show the empty-queue message, since an operator with no cases and an operator with a failed fetch both have nothing to work on.',
            'Give the failure its own state, distinct from loading, that names what failed and offers a retry.',
            'Log the error and retry every five seconds in the background until the case service answers.',
          ],
          correct: 2,
          explanation:
            'An operator must be able to tell "still working" from "this did not work", with a way to retry. Automatic retries can supplement that control, but must not conceal a completed failure. A delay notice leaves the two states looking identical, which is the defect being described. The empty-queue message is worse than silence: an operator who reads "no cases waiting" stops looking, and the queue may be full. Silent retries hide the failure from the one person who could escalate it, and they keep hitting a service that is already failing. Retry if you like, with backoff, and still show the state.',
          competencies: ['handoff'],
        },
        {
          id: 'fde-v1-diagnostic-q8',
          prompt:
            'Pressing Approve shows a green "Case approved" toast immediately, then sends the POST. About one POST in fifty fails, and nothing on the screen changes when it does. Which fix addresses the operator being told that a failed approval succeeded?',
          options: [
            'Wait for confirmation, or visibly reverse the optimistic approval and report its failure.',
            'Nothing. Optimistic updates are the standard pattern, and a 2% failure rate sits inside normal tolerance for a background write.',
            'Nothing, as long as the failed request is retried in the background until it goes through.',
            'The toast should stay on screen longer, so the operator is still looking when the error arrives.',
          ],
          correct: 0,
          explanation:
            'A success message is a claim about the system, and this screen makes it before anything has confirmed it. Optimistic updates are fine when the reversal is real: the row goes back, the operator is told, and the work returns to the queue. A failure rate is a reason to design the failure path, not a budget for false claims. A background retry can fail too, and by then the operator has moved on, so the correction still has to reach them. Toast duration matters for a message that does arrive; here none does.',
          competencies: ['handoff'],
        },
        {
          id: 'fde-v1-diagnostic-q9',
          prompt:
            'Delete case sits directly under Duplicate case and deletes immediately and permanently. Wrong-row clicks recur, and a defined recovery window is allowed. Which change both reduces those slips and lets operators recover a mistaken deletion?',
          options: [
            'Add a confirmation dialog. A second deliberate click is what separates an accident from an intention.',
            'Make the operator type the case number to confirm the deletion.',
            'Restrict deleting to supervisors and have operators request a deletion instead.',
            'Use recoverable deletion with a visible undo window, and separate Delete from Duplicate.',
          ],
          correct: 3,
          explanation:
            'The stated goal needs both prevention and recovery: separate the adjacent actions and allow reversal during the permitted window. A confirmation or typed case number can help prevent mistakes, but neither alone recovers a deletion after the operator confirms the wrong case. Restricting permissions may fit other risk models, but does not supply the recovery required here. Retain records only for the permitted recovery window and apply the actual retention policy.',
          competencies: ['handoff'],
        },
        {
          id: 'fde-v1-diagnostic-q10',
          prompt:
            'A routing model labels 940 of 1000 held-out cases correctly, passing a 90% overall bar. Billing accounts for 60 cases, with only 24 correct (40%). Which conclusion should guide readiness?',
          options: [
            'Ship it. The model clears the agreed 90% bar, and billing is only 6% of the held-out traffic.',
            'The overall pass hides poor billing routing; report slices and set billing readiness criteria.',
            'Hold the release and label more billing cases until the billing slice reaches 90% on its own.',
            'Re-weight the average so small slices count for more, then hold the weighted number to the same bar.',
          ],
          correct: 1,
          explanation:
            'The counts are consistent: billing contributes 24 correct cases, and the other 940 contribute 916, for 940 correct overall. The 90% aggregate bar passes despite the observed 40% billing accuracy. A stricter aggregate threshold could reject this particular run, but this bar does not enforce a minimum for each slice. Report slice counts and quality, define their acceptance criteria, and address the billing failures before automating them. More labelled billing examples can reduce uncertainty; collecting them alone does not repair the model or guarantee a higher score. A weighted aggregate can be useful, but should not replace the slice results. These finite held-out results are evidence, not an exact forecast of future traffic.',
          competencies: ['evaluation'],
        },
        {
          id: 'fde-v1-diagnostic-q11',
          prompt:
            'The team wrote 120 labelled cases, then spent two weeks adjusting prompts, routing rules and thresholds until the score on those 120 went from 0.71 to 0.93. The report gives 0.93 as expected quality in production. What is wrong with the claim?',
          options: [
            'Those cases guided tuning; estimate unseen-case quality on an untouched test set.',
            'Nothing, provided the 120 cases were sampled at random from production traffic.',
            'Nothing, provided no case text was copied into the prompts.',
            'Nothing a split does not fix: score the finished design again on 24 of the 120 and report that number.',
          ],
          correct: 0,
          explanation:
            'Tuning against a score is what leaks the set, whatever the prompt text contains. Every threshold that got nudged was nudged because of those cases, so the number that came out describes the fit rather than the future. Random sampling can improve representativeness, but it does not remove this tuning leak: a representative set you optimised against is still a set you optimised against. Copying case text is one way to leak and not the one that happened here. A split made afterwards splits cases that all shaped the design already; the hold-out has to be set aside before the tuning starts, and scored as rarely as you can manage.',
          competencies: ['evaluation'],
        },
        {
          id: 'fde-v1-diagnostic-q12',
          prompt:
            'A twelve-minute live demo handles three cases the engineer picked, all three correctly. The sponsor asks whether it is ready for the 400-case daily queue. What does the demo support?',
          options: [
            'That the workflow is covered end to end, and the remaining cases are variations on the same path.',
            'A yes, with a caveat in the notes that quality will vary once real traffic arrives.',
            'It worked on those three chosen cases; readiness for the wider queue has not been measured.',
            'Nothing yet. Put it on the live queue for a week and count the complaints.',
          ],
          correct: 2,
          explanation:
            'Three self-selected cases demonstrate that this workflow can work on those cases. They do not estimate its success rate on unselected traffic. Readiness also needs representative quality checks, failure handling and operational evidence. Calling the remaining cases variations assumes coverage that the demo did not measure. A caveat is not a measurement; it turns an unsupported yes into a hedged unsupported yes. Running it on the live queue does produce real data, but with no labels, no baseline and no hold-out it measures customer patience: complaints arrive late, come from a biased slice, and cannot separate a routing error from a busy Monday.',
          competencies: ['evaluation'],
        },
      ],
    },
    {
      id: 'fde-v1-diagnostic-debug-js',
      kind: 'code',
      purpose: 'diagnostic',
      verification: 'machine_verified',
      title: 'The page that never arrives',
      summary: 'Two defects in a paginated collector: the last page is never fetched, and the caller’s array is written into.',
      competencies: ['integration'],
      estimatedMinutes: 12,
      code: {
        language: 'javascript',
        prompt:
          'The starter is broken. Read it before you change it.\n\n`collectAll(fetchPage, known)` reads every page of a paginated source and returns `known` followed by all the items, in page order. `fetchPage(pageNumber)` takes a page number starting at 1 and resolves to `{ items, pageCount }`, where `pageCount` is the total number of pages and is the same on every page. `known` is the array of ids the caller already had.\n\nThere are two defects, and both are the quiet kind:\n\n- The last page is never fetched. The collection comes back short and nothing reports an error.\n- `known` is pushed into rather than copied, so the caller’s array changes underneath them.\n\nFix both. `fetchPage` is a synthetic in-memory fixture the grader builds, with a simulated delay that the sandbox’s virtual clock resolves instantly. There is no network here and no vendor API.\n\nThe source has 1 through 100 pages, with 0 through 100 entries per page. known has at most 1000 entries. These are ordinary dense arrays of opaque JavaScript values: preserve each value/reference, its order and duplicates. known, page item arrays and their objects may be frozen; do not change their fields, links, own properties, descriptors or prototypes. Fetch pages sequentially, each once in increasing order, awaiting one before starting the next. The supplied calls all resolve successfully. Return a fresh array without changing earlier outputs. Target: O(n) time, where n is known.length + pageCount + the total number of page entries under constant-cost reference operations and amortized append, excluding external wait time. Output space is linear in the number of returned entries; even empty pages require fetch work.',
        contract: [
          'Fetch every page through the `fetchPage` you are given; nothing else reaches a page.',
          'Read `pageCount` from the first page, then read pages 1 through `pageCount` in order, each one once.',
          'Return a new array. The `known` array the caller passed in must come back exactly as it went in.',
        ],
        starter: `// Broken on purpose: the last page goes missing and the caller's array is
// modified. Run it, read the output, then fix both.
const collectAll = async (fetchPage, known) => {
  const out = known;
  const first = await fetchPage(1);
  out.push(...first.items);

  let page = 2;
  while (page < first.pageCount) {
    const next = await fetchPage(page);
    out.push(...next.items);
    page += 1;
  }

  return out;
};

// Scratch pad — change this before submitting.
const pages = [['a', 'b'], ['c', 'd'], ['e']];
const fixture = n => Promise.resolve({ items: pages[n - 1], pageCount: pages.length });
const seen = ['seed'];
collectAll(fixture, seen).then(result => console.log(result, seen));
`,
        skeleton: `const collectAll = async (fetchPage, known) => {
  const out = /* a copy of known, not known itself */;
  const first = await fetchPage(1);
  out.push(...first.items);

  let page = 2;
  while (/* pages 2 through first.pageCount, inclusive */) {
    const next = await fetchPage(page);
    out.push(...next.items);
    page += 1;
  }

  return out;
};`,
        hints: [
          'Run the starter unchanged and print `seen` after the result. Two things are wrong with what comes out: `e` is missing, and `seen` is no longer `["seed"]`.',
          'With a `pageCount` of 3, a loop that starts at page 2 has to run for 2 and for 3. Work out which comparison does that.',
          '`const out = known` binds a second name to the same array, so every `push` writes into the caller’s. Copying the entries into a fresh array is the whole fix.',
        ],
        approach: [
          'Copy `known` into a fresh array and push into the copy from then on.',
          'Fetch page 1 and read `pageCount` off it.',
          'Loop from page 2 while the page number is still at most `pageCount`, awaiting each fetch and appending its items.',
          'Return the copy. The array the caller handed in is untouched.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'Every page collected, in order',
            critical: true,
            weight: 3,
            detail: 'The last page is the one to check. Also check a single-page source and pages that come back empty.',
          },
          {
            id: 'no-mutation',
            label: 'The caller’s array is left alone',
            critical: true,
            weight: 2,
            detail: 'The `known` array changed during the call, or the array you returned is the same object the caller passed in. Copy it before you push.',
          },
        ],
        tests: [
          {
            call: "__collect([['a', 'b'], ['c', 'd'], ['e']], []).then(function (r) { return r.result; })",
            expected: ['a', 'b', 'c', 'd', 'e'],
            label: 'all three pages, including the last one',
            async: true,
          },
          {
            call: "__collect([['a']], []).then(function (r) { return r.result; })",
            expected: ['a'],
            label: 'a single page still works',
            async: true,
            edge: true,
          },
          {
            call: "__collect([['a'], ['b'], ['c'], ['d']], []).then(function (r) { return r.result; })",
            expected: ['a', 'b', 'c', 'd'],
            label: 'four pages, none skipped',
            async: true,
          },
          {
            call: "__collect([[], [], ['z']], []).then(function (r) { return r.result; })",
            expected: ['z'],
            label: 'empty pages before the page that has the item',
            async: true,
            edge: true,
          },
          {
            call: "__collect([['a', 'b'], ['c']], ['seed']).then(function (r) { return r.result; })",
            expected: ['seed', 'a', 'b', 'c'],
            label: 'what the caller already had comes first',
            async: true,
          },
          {
            call: "__collect([['a', 'b'], ['c']], ['seed']).then(function (r) { return r.callerUnchanged; })",
            expected: true,
            label: 'the caller’s array is the same afterwards',
            async: true,
            criterion: 'no-mutation',
          },
          {
            call: "__collect([['a']], ['seed']).then(function (r) { return r.sameArray; })",
            expected: false,
            label: 'the result is a new array, not the one that was passed in',
            async: true,
            criterion: 'no-mutation',
          },
        ],
        harness: PAGE_PROBE,
      },
    },
    {
      id: 'fde-v1-diagnostic-debug-ts',
      kind: 'code',
      purpose: 'diagnostic',
      verification: 'machine_verified',
      title: 'The branch that swallows a failure',
      summary: 'A union of three sync outcomes, narrowed by the wrong test, so a rejected record is reported as applied.',
      competencies: ['integration'],
      estimatedMinutes: 12,
      code: {
        language: 'typescript',
        prompt:
          'The starter is broken. It compiles, the tests fail, and the reason is the narrowing.\n\n`SyncOutcome` has three members: an `applied` record, a `queued` record with a `retryAfterMs` delay, and a `rejected` record with an `error`. `describeOutcome` turns one into a line of text:\n\n- applied → `applied r-1`\n- queued → `queued r-2 in 500ms`\n- rejected → `rejected r-3: MISSING_VAT`\n\nThe starter tests `outcome.state !== \'queued\'`, which is true for `applied` and for `rejected` alike, so every rejected record is described as an applied one. A failure reported as a success is the defect: nothing throws, and the sync log reads clean.\n\nFix the narrowing so each state is decided by its own name. The compiler is graded too, so the types have to stay clean.\n\nInputs have ordinary data properties and one of the three declared states. recordId and error are strings of at most 10000 UTF-16 code units, possibly empty; queued delay is a whole Number from 0 through Number.MAX_SAFE_INTEGER. Extra unrelated fields may exist at runtime and do not choose the branch. Preserve all input fields, own properties, descriptors and prototypes, including on frozen input. Keep string contents exactly, with no trimming or normalization. Target: O(n) time in the output-character model, where n is the total number of UTF-16 code units materialized in the result. State dispatch itself uses constant work; this goal counts the returned text and does not predict rope allocation or engine timing.',
        contract: [
          'Decide each branch from `outcome.state`, not from which properties happen to be present.',
          'Keep the `SyncOutcome` union and the `(outcome: SyncOutcome) => string` signature. Widening either to `any` is not a fix.',
          'Return the exact text the examples show, including the `ms` suffix and the `: ` before an error.',
        ],
        starter: `type SyncOutcome =
  | { state: 'applied'; recordId: string }
  | { state: 'queued'; recordId: string; retryAfterMs: number }
  | { state: 'rejected'; recordId: string; error: string };

// Broken on purpose: a rejected outcome comes back described as an applied
// one. Read the narrowing, run it, then fix it.
const describeOutcome = (outcome: SyncOutcome): string => {
  if (outcome.state !== 'queued') {
    return 'applied ' + outcome.recordId;
  }
  return 'queued ' + outcome.recordId + ' in ' + outcome.retryAfterMs + 'ms';
};

// Scratch pad — change this before submitting.
console.log(describeOutcome({ state: 'rejected', recordId: 'r-3', error: 'MISSING_VAT' }));
`,
        skeleton: `type SyncOutcome =
  | { state: 'applied'; recordId: string }
  | { state: 'queued'; recordId: string; retryAfterMs: number }
  | { state: 'rejected'; recordId: string; error: string };

const describeOutcome = (outcome: SyncOutcome): string => {
  if (/* the state is exactly 'applied' */) {
    return 'applied ' + outcome.recordId;
  }

  if (/* the state is exactly 'queued' */) {
    return 'queued ' + outcome.recordId + ' in ' + outcome.retryAfterMs + 'ms';
  }

  /* only 'rejected' is left, and the compiler knows it */
  return 'rejected ' + outcome.recordId + ': ' + outcome.error;
};`,
        hints: [
          'Run the starter on a rejected outcome. It prints an applied line, because `state !== \'queued\'` covers `applied` and `rejected` together.',
          'Three states need three answers. Test for `\'applied\'` by name, then for `\'queued\'` by name, and let the last return handle `\'rejected\'`.',
          'Comparing `outcome.state` against a string literal is what narrows the union: inside the rejected branch, `outcome.error` is a `string` with no cast and no non-null assertion.',
        ],
        approach: [
          'Read the union first: three states, each carrying its own extra field.',
          'Compare `outcome.state` against `\'applied\'` and return that description.',
          'Compare against `\'queued\'` and return that one, reading `retryAfterMs` inside the branch where it exists.',
          'Return the rejected description last, where the compiler has narrowed the union to the only member left.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'Every state described, with clean types',
            critical: true,
            weight: 3,
            detail: 'Check an applied, a queued and a rejected outcome, and make sure the compiler reports nothing on your code.',
          },
          {
            id: 'discriminant',
            label: 'The branch is chosen by `state`',
            critical: true,
            weight: 2,
            detail: 'An outcome came back described as a different state. Compare `outcome.state` against each literal instead of testing which properties exist.',
          },
        ],
        tests: [
          {
            call: "describeOutcome({ state: 'applied', recordId: 'r-1' })",
            expected: 'applied r-1',
            label: 'an applied record',
          },
          {
            call: "describeOutcome({ state: 'queued', recordId: 'r-2', retryAfterMs: 500 })",
            expected: 'queued r-2 in 500ms',
            label: 'a queued record carries its delay',
          },
          {
            call: "describeOutcome({ state: 'rejected', recordId: 'r-3', error: 'MISSING_VAT' })",
            expected: 'rejected r-3: MISSING_VAT',
            label: 'a rejected record is not reported as applied',
            edge: true,
            criterion: 'discriminant',
          },
          {
            call: "describeOutcome({ state: 'rejected', recordId: 'r-4', error: 'TENANT_MISMATCH' })",
            expected: 'rejected r-4: TENANT_MISMATCH',
            label: 'the error travels with the description',
            criterion: 'discriminant',
          },
          {
            call: "describeOutcome({ state: 'queued', recordId: 'r-5', retryAfterMs: 0 })",
            expected: 'queued r-5 in 0ms',
            label: 'a zero delay is still a delay',
            edge: true,
          },
          {
            call: "[{ state: 'applied', recordId: 'a' }, { state: 'rejected', recordId: 'b', error: 'E' }].map(function (one) { return describeOutcome(one); })",
            expected: ['applied a', 'rejected b: E'],
            label: 'a mixed batch keeps each outcome distinct',
          },
          {
            call: "describeOutcome({ state: 'applied', recordId: 'r-6' }) === describeOutcome({ state: 'rejected', recordId: 'r-6', error: 'DUPLICATE' })",
            expected: false,
            label: 'the same record id in two states never describes the same',
            edge: true,
            criterion: 'discriminant',
          },
        ],
        typeTests: [
          {
            code: "const __sig: (outcome: SyncOutcome) => string = describeOutcome;",
            label: 'the union and the signature are both still there',
          },
          {
            code: "const __label: string = describeOutcome({ state: 'applied', recordId: 'r-1' });",
            label: 'an applied outcome describes to text',
          },
          {
            code: "const __count: number = describeOutcome({ state: 'applied', recordId: 'r-1' });",
            label: 'the description is text, not a number',
            rejects: true,
          },
          {
            code: "describeOutcome({ state: 'queued', recordId: 'r-2' });",
            label: 'a queued outcome without its delay is not a SyncOutcome',
            rejects: true,
          },
          {
            code: "describeOutcome({ state: 'rejected', recordId: 'r-3' });",
            label: 'a rejected outcome without its error is not a SyncOutcome',
            rejects: true,
          },
          {
            code: "describeOutcome({ state: 'lost', recordId: 'r-4' });",
            label: 'an unknown state is not a SyncOutcome',
            rejects: true,
          },
        ],
      },
    },
  ],
  requires: [],
};
