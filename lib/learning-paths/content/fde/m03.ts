/** M03 — Integration and data.
 *
 * The first module that runs code. It takes the scope written in M01 and
 * points it at an external system that does not behave the way its
 * documentation says: fields that are documented as present and are not,
 * pages behind a cursor, the same ticket delivered twice, and a throttled
 * response that has to be waited out rather than dropped.
 *
 * Two lessons, one four-question check, one graded connector adapter. The
 * adapter is the vertical slice this path is proved with, so its criteria are
 * split three ways — correctness, replay, throttling — and each failure
 * detail names the mistake rather than the missing line.
 *
 * The ticket API is a fixture. `client.listTickets` is an object literal
 * declared in the task harness, `sleep` runs on the sandbox's virtual clock,
 * and nothing here opens a socket or needs a vendor account. Marlbrook
 * Systems, its ticket ids and its customer ids are invented for this module.
 * No real customer data appears anywhere in it. */

import type { ModuleSource } from '../../types';

/** The synthetic ticket API the adapter is graded against, plus the probes
 * the assertions read. Appended after the learner's code, so `sleep` and the
 * client builders cannot be shadowed by a same-named declaration.
 *
 * `sleep` schedules through `setTimeout`, which the sandbox runs on a virtual
 * clock: a 500 ms wait finishes in microseconds and the recorded request
 * times still show the gap, so the same submission grades the same way every
 * run. */
const TICKET_CLIENT = `
var sleep = function (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

var __PAGES = [
  {
    cursor: null,
    nextCursor: 'p2',
    tickets: [
      { id: 'TCK-1004', customerId: 'CUS-88', subject: 'Export fails at 02:00', channel: 'email', openedAt: '2026-03-02T02:14:00Z' },
      { id: 'TCK-1001', customerId: 'CUS-12', subject: 'Cannot add a warehouse', channel: 'portal', openedAt: '2026-03-01T09:12:00Z' },
      { id: 'TCK-1007', customerId: '', subject: 'Invoice question', channel: 'email', openedAt: '2026-03-02T08:40:00Z' }
    ]
  },
  {
    cursor: 'p2',
    nextCursor: 'p3',
    tickets: [
      { id: 'TCK-1002', customerId: 'CUS-12', subject: 'Duplicate stock rows', channel: 'portal', openedAt: '2026-03-01T14:02:00Z' },
      { id: 'TCK-1004', customerId: 'CUS-88', subject: 'Export fails at 02:00', channel: 'email', openedAt: '2026-03-02T02:14:00Z' }
    ]
  },
  {
    cursor: 'p3',
    nextCursor: null,
    tickets: [
      { id: 'TCK-1009', customerId: 'CUS-40', subject: 'Rename a location', channel: 'portal', openedAt: '2026-03-03T11:20:00Z' },
      { id: 'TCK-1003', customerId: null, subject: 'Password reset', channel: 'email', openedAt: '2026-03-03T07:55:00Z' }
    ]
  }
];

var __makeClient = function (pages, options) {
  var opts = options || {};
  var throttleCursor = Object.prototype.hasOwnProperty.call(opts, 'throttleCursor') ? opts.throttleCursor : 'p2';
  var retryAfterMs = opts.retryAfterMs === undefined ? 500 : opts.retryAfterMs;
  var throttles = opts.throttles === undefined ? 1 : opts.throttles;
  var failWith = opts.failWith || null;
  var budget = {};
  var started = Date.now();
  var client = {
    requests: [],
    listTickets: function (cursor) {
      var key = cursor === undefined ? null : cursor;
      client.requests.push({ cursor: key, at: Date.now() - started });
      if (failWith && failWith.cursor === key) {
        return Promise.reject({ status: failWith.status, message: failWith.message });
      }
      if (throttleCursor === '*' || throttleCursor === key) {
        var slot = String(key);
        if (budget[slot] === undefined) budget[slot] = throttles;
        if (budget[slot] > 0) {
          budget[slot] -= 1;
          return Promise.reject({ status: 429, retryAfterMs: retryAfterMs });
        }
      }
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].cursor === key) {
          return Promise.resolve({
            tickets: pages[i].tickets.map(function (ticket) { return JSON.parse(JSON.stringify(ticket)); }),
            nextCursor: pages[i].nextCursor
          });
        }
      }
      return Promise.reject({ status: 404, message: 'unknown cursor ' + String(key) });
    }
  };
  return client;
};

var __client = function () { return __makeClient(__PAGES, {}); };
var __ids = function (out) { return out.records.map(function (record) { return record.id; }); };
var __attempts = function (client, cursor) {
  return client.requests.filter(function (request) { return request.cursor === cursor; });
};
`.trim();

export const FDE_M03: ModuleSource = {
  id: 'fde-v1-m03',
  title: 'Integration and data',
  outcomes: [
    'Read a payload against its documentation and say which fields are actually guaranteed, then check them at the boundary instead of trusting the schema.',
    'Say what your code does with a record it cannot use, and count those records instead of dropping them silently.',
    'Decide which failures a client may retry on its own, and which need an idempotency key or a person.',
    'Wait the delay a throttled server asked for, and back off with jitter when it asked for nothing.',
    'Write a sync that survives duplicate delivery and paged reads, and returns the same result when you run it a second time.',
  ],
  competencies: ['integration'],
  dependsOn: ['fde-v1-m01'],
  estimatedMinutes: 110,
  lessons: [
    {
      id: 'fde-v1-m02-l1',
      title: 'Contracts and the data you actually get',
      summary:
        'The documented shape against the shape on the wire, fields that are nullable in practice and not in the docs, encoding surprises, and where the validation belongs.',
      estimatedMinutes: 25,
      sources: [
        { label: 'RFC 9110 — HTTP Semantics', url: 'https://www.rfc-editor.org/rfc/rfc9110', reviewedOn: '2026-09-08' },
        {
          label: 'MDN — JSON.parse',
          url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'MDN — String.prototype.normalize',
          url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize',
          reviewedOn: '2026-09-08',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'A customer hands you API documentation and a key. The documentation describes the system somebody intended to build. The wire shows you the one they run. Your first job on any integration is to find the distance between the two, before you have written code that assumes the first one.',
        },
        {
          kind: 'prose',
          body:
            'The gap is rarely dramatic. Marlbrook’s ticket API documents `customerId` as a string, required. Pull a thousand tickets and eleven of them carry an empty string, because tickets opened from the public web form have no account attached until an agent links one. Nobody lied. The field was required when the endpoint was written in 2021, the web form shipped in 2024, and the documentation was never the thing that enforced it.',
        },
        {
          kind: 'table',
          caption: 'Four hypothetical contract mismatches and possible downstream failures if validation does not catch them.',
          headers: ['The documentation says', 'What arrives', 'What it costs you later'],
          rows: [
            [
              '`customerId`: string, required',
              'An empty string on tickets opened through the public form',
              'A join against the customer table returns nothing, and the sync writes rows with no owner',
            ],
            [
              '`priority`: one of low, normal, high',
              '`urgent`, from a workflow rule added last quarter',
              'An unhandled priority can be rejected, dropped or misclassified depending on the implementation',
            ],
            [
              '`openedAt`: ISO 8601 timestamp',
              '`2026-03-02 02:14:00`, no `T`, no offset, in the desk’s local time',
              'An unspecified timezone or ambiguous local time can produce incorrect instants and inconsistent reports',
            ],
            [
              '`tags`: array of strings',
              '`null` on tickets migrated from the old system',
              '`tags.map` throws inside the loop and the sync dies on record 4,113 of 9,000',
            ],
          ],
        },
        {
          kind: 'code',
          language: 'json',
          code: '{\n  "id": "TCK-1007",\n  "customerId": "",\n  "subject": "Invoice question",\n  "priority": "urgent",\n  "openedAt": "2026-03-02 08:40:00",\n  "tags": null,\n  "assignee": { "id": null, "name": null }\n}',
          caption: 'A hypothetical ticket with present fields that violate the stated usable-record contract. A complete schema can reject these values.',
        },
        {
          kind: 'prose',
          body:
            'A presence/type-only check can accept an empty customerId. A richer schema can enforce non-empty values, nullable alternatives and enum constraints. The issue is the actual validation contract, not an inherent inability of schemas to express useful rules. Missing offsets also require an explicit timestamp interpretation policy; do not silently guess the desk timezone.',
        },
        {
          kind: 'prose',
          body:
            'Validate external data at the boundary and return a clearly defined usable record or rejection. Downstream code can then rely on the validated fields within that scope. It still needs authorization, current-state checks and any additional invariants required for the effect it performs. Avoid inconsistent duplicate input checks across callers.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            'const text = value => (typeof value === \'string\' ? value.trim() : \'\');\n\n// One place decides. Downstream code gets a record or a reason, never a maybe.\nconst toRecord = ticket => {\n  const id = text(ticket.id);\n  const customerId = text(ticket.customerId);\n  if (id === \'\') return { ok: false, reason: \'no ticket id\' };\n  if (customerId === \'\') return { ok: false, reason: \'no customer id\' };\n  return { ok: true, record: { id, customerId, subject: text(ticket.subject) } };\n};',
          caption: 'A deliberately partial boundary for ordinary ticket objects: it validates only ids and normalizes subject text. It does not validate the full ticket, authorization or ownership.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'A record you cannot use is a decision, not a crash. Count it, keep the reason, and report the count beside the successes. “412 tickets synced” hides the eleven that were dropped; “412 synced, 11 skipped: no customer id” is the sentence the support lead can act on, and it is the one that tells you when the eleven becomes ninety.',
        },
        {
          kind: 'prose',
          body:
            'Visually similar strings can differ in code points and fail exact equality. Decide normalization rules from the identifier contract before changing keys: trimming or Unicode normalization can merge values a source intended to keep distinct. NFC handles canonical Unicode equivalence, not every visually similar character or identifier ambiguity.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            'const a = \'Jos\\u00e9\';\nconst b = \'Jose\\u0301\';\na === b; // false\na.normalize(\'NFC\') === b.normalize(\'NFC\'); // true\n\n\'CUS-12\\u00a0\'.trim(); // \'CUS-12\': ECMAScript trim removes NBSP\n\'CUS-12\\u200b\'.trim(); // keeps U+200B ZERO WIDTH SPACE',
          caption: 'Test the exact characters and the source contract. NBSP is trimmed; zero-width space is not. Normalization is not a general identity or authorization check.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'JavaScript JSON.parse normally represents JSON numbers as binary64 Number values. Integers beyond Number.MAX_SAFE_INTEGER are not all exactly representable: parsing 9007199254740993 produces 9007199254740992. Some larger integers are exactly representable, so digit count alone is not the precise boundary. Preserve opaque or potentially large identifiers as JSON strings end to end; validate numeric ranges before converting any identifier to Number.',
        },
        {
          kind: 'prose',
          body:
            'Write down the contract you actually got, next to the one you were given. Two columns, one row per field: what the documentation claims, and what a thousand records showed. That document is what you hand the customer when you ask them to fix the source, and it is what stops the next engineer from re-discovering the empty `customerId` in production.',
        },
      ],
    },
    {
      id: 'fde-v1-m02-l2',
      title: 'Retries, duplicates and idempotency',
      summary:
        'Why at-least-once delivery is the normal case, what an idempotency key buys you, which failures are safe to retry, and how to honour a Retry-After instead of guessing.',
      estimatedMinutes: 25,
      sources: [
        { label: 'RFC 9110 — HTTP Semantics', url: 'https://www.rfc-editor.org/rfc/rfc9110', reviewedOn: '2026-09-08' },
        { label: 'RFC 6585 — Additional HTTP Status Codes', url: 'https://www.rfc-editor.org/rfc/rfc6585', reviewedOn: '2026-09-08' },
        {
          label: 'MDN — HTTP response status codes',
          url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status',
          reviewedOn: '2026-11-27',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'A sender can lose the acknowledgement after the receiver processes a request. Retrying can then duplicate the effect. Delivery guarantees depend on the queue, webhook or client: some systems use at-most-once delivery, while bounded retries can still fail to deliver. Do not assume every transport delivers at least once. Design for the documented loss, duplication and ordering behavior.',
        },
        {
          kind: 'prose',
          body:
            'For a service with an idempotency contract, reuse a stable operation key across attempts. The receiver must scope it to the caller or tenant and operation, bind it to the intended request, and coordinate the claim, effect and result against concurrent requests and crashes. Document replay behavior, mismatched payloads, failures and retention. A fresh key per attempt defeats deduplication; a key alone does not implement it.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            '// Illustrative APIs. Trusted server code derives tenantId and fingerprint,\n// checks current actor authorization before this call, and keeps all writes local\n// to one transactional database; lockOperation serializes the scoped key.\nconst applyRefund = (tenantId, key, request) =>\n  database.transaction(async tx => {\n    await tx.lockOperation(tenantId, key);\n    const prior = await tx.operations.get(tenantId, key);\n    if (prior) {\n      if (prior.fingerprint !== request.fingerprint) throw new Error(\'key reused\');\n      return prior.result;\n    }\n    // This assumed operation enforces current authorization, approval and balance.\n    const result = await tx.ledger.applyApprovedRefund(tenantId, request);\n    await tx.operations.insert({ tenantId, key, fingerprint: request.fingerprint, result });\n    return result;\n  });',
          caption: 'A transaction/lock sketch for a local ledger, with an assumed unique scoped operation key. It cannot make an external payment-provider effect atomic with this database; that requires the provider contract and recovery design.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'For current-state sync, use a stable tenant-scoped ticket id as the upsert identity, not a permanent reason to discard all future updates. An immutable update feed may use tenant, ticket id and version as its event identity. Event ids are another common contract. The connector exercise deliberately keeps the first delivery within one unchanged fixture run; it does not implement persistent current-state synchronization.',
        },
        {
          kind: 'prose',
          body:
            'RFC 9110 defines safe methods by their requested read-only semantics; logging and other incidental effects can still occur. Idempotence concerns the intended effect of repeated identical requests, not identical responses or an absence of logs. GET is safe and idempotent; DELETE is idempotent but not safe under standard semantics. POST is not inherently idempotent, but a documented application contract or other reliable knowledge may justify retries. Bound retries and recheck the specific service contract.',
        },
        {
          kind: 'table',
          caption: 'Retry considerations for an API following standard HTTP semantics. These are not unconditional promises about every service.',
          headers: ['Failure', 'Retry without asking?', 'Why'],
          rows: [
            ['GET returned 429 or 503', 'Usually eligible for bounded retry', 'Respect a valid Retry-After when supplied; read-only requested semantics do not forbid incidental effects'],
            ['GET timed out with no response', 'Usually eligible for bounded retry', 'The representation may change; retry with an appropriate budget and cancellation policy'],
            ['POST timed out, no deduplication contract', 'Do not assume it is safe to replay', 'The effect may have happened before the acknowledgement was lost'],
            ['POST returned 500, key supplied', 'Inspect the actual idempotency contract', 'A header alone does not establish atomicity, stored failure behavior or successful replay'],
            ['400 or 422 with unchanged invalid input', 'Usually fix the input before retrying', 'Status alone is not a universal claim that all future attempts fail forever'],
            ['401 or 403', 'Resolve credentials or authorization first', 'Avoid blind loops; documented token refresh may permit a later request'],
          ],
        },
        {
          kind: 'prose',
          body:
            '429 indicates rate limiting. RFC 6585 permits, but does not require, a Retry-After header; its value may be seconds or an HTTP date. The status alone does not establish that nothing was read or changed. For this exercise, the synthetic read rejection returns no page and preserves the cursor. Follow the documented contract, respect a valid delay and stop or defer when the retry budget is exhausted.',
        },
        {
          kind: 'trace',
          caption:
            'One sync across three pages, with the second page throttled. Step through it: the retry goes back to the same cursor, not to the start.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['GET (no cursor)', 'GET cursor=p2', 'wait 2 s', 'GET cursor=p2', 'GET cursor=p3'],
                note: 'The sync starts with no cursor, no records and no requests sent. Five steps are ahead of it.',
                counter: { label: 'Requests sent', value: 0 },
              },
              {
                cells: ['GET (no cursor)', 'GET cursor=p2', 'wait 2 s', 'GET cursor=p2', 'GET cursor=p3'],
                marks: [{ index: 0, role: 'active' }],
                note: 'The first request returns 200 with three tickets and nextCursor p2. Two tickets are kept; one has an empty customerId and is counted as skipped.',
                counter: { label: 'Requests sent', value: 1 },
              },
              {
                cells: ['GET (no cursor)', 'GET cursor=p2', 'wait 2 s', 'GET cursor=p2', 'GET cursor=p3'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'excluded' },
                ],
                note: 'In this synthetic read, cursor p2 rejects with a two-second delay and no page. No record is added and the cursor stays at p2; that is the fixture contract, not a universal 429 guarantee.',
                counter: { label: 'Requests sent', value: 2 },
              },
              {
                cells: ['GET (no cursor)', 'GET cursor=p2', 'wait 2 s', 'GET cursor=p2', 'GET cursor=p3'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'excluded' },
                  { index: 2, role: 'active' },
                ],
                note: 'The client waits the supplied two seconds. An earlier retry would violate this delay; whether it receives another 429 or extends a limiter window depends on the service.',
                counter: { label: 'Requests sent', value: 2 },
              },
              {
                cells: ['GET (no cursor)', 'GET cursor=p2', 'wait 2 s', 'GET cursor=p2', 'GET cursor=p3'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'excluded' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'active' },
                ],
                note: 'The same cursor is requested again and returns 200. One new ticket is kept; the other is a second delivery of TCK-1004, which the set of kept ids already holds, so it is counted as a duplicate.',
                counter: { label: 'Requests sent', value: 3 },
              },
              {
                cells: ['GET (no cursor)', 'GET cursor=p2', 'wait 2 s', 'GET cursor=p2', 'GET cursor=p3'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'excluded' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'active' },
                ],
                note: 'The last page returns nextCursor null and the walk stops: four records, two skipped, one duplicate, from four requests for three pages.',
                counter: { label: 'Requests sent', value: 4 },
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'When the service supplies no usable delay, capped exponential backoff with jitter is a common policy. Choose it alongside the service contract, total deadline and retry budget; exponential timing is not universally optimal. What exponential backoff alone does not fix is synchronisation. If fifty clients were throttled by the same overload, all fifty wake up at the same instant and the next wave is identical to the one that caused the problem. Jitter breaks that up by spreading each client’s wait randomly across its window.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            'const nextDelay = (attempt, retryAfterMs) => {\n  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return retryAfterMs;\n  const ceiling = Math.min(1000 * 2 ** attempt, 30_000);\n  return Math.random() * ceiling;\n};',
          caption: 'This helper receives an already parsed finite nonnegative delay, including zero, or null. Attempt is an integer 0–30. Parse HTTP dates elsewhere; apply the total deadline and retry limit outside this helper.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Give every retry loop a budget. A client that retries forever turns a five-minute dependency blip into a self-inflicted outage, and it does it while reporting that everything is fine. Choose a documented attempt/deadline budget, stop when exhausted and surface useful recovery context. Resuming later requires a persisted valid checkpoint and the source cursor contract; a cursor alone may expire or omit state needed for a consistent resume.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m02-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: contracts and the data you actually get',
      summary: 'Documented and observed field contracts, boundary validation, explicit identifier normalization and safe numeric ranges.',
      competencies: ['integration'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m02-l1',
    },
    {
      id: 'fde-v1-m02-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: retries, duplicates and idempotency',
      summary: 'Documented delivery semantics, atomic scoped idempotency, retry eligibility, optional Retry-After delays and bounded recovery.',
      competencies: ['integration'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m02-l2',
    },
    {
      id: 'fde-v1-m02-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Integration decisions',
      summary: 'Four integration decisions: justified retry semantics, rate-limit instructions, a documented stable keyset boundary, and tenant-scoped ticket-version deduplication.',
      competencies: ['integration'],
      estimatedMinutes: 15,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-m02-q1',
          prompt:
            'Which retry is justified by standard HTTP method semantics and the supplied header alone, without an extra application-specific idempotency guarantee? Assume the API follows those semantics and the client has a bounded retry budget.',
          options: [
            '`GET /v1/tickets?cursor=p2`, which returned 429 with `Retry-After: 2`.',
            '`POST /v1/tickets/TCK-1002/replies`, which timed out with no response and no idempotency key.',
            '`POST /v1/refunds` with an amount and no idempotency key, which returned 500.',
            '`PATCH /v1/customers/CUS-12` with a partial body, which returned 503 while a nightly job was editing the same record.',
          ],
          correct: 0,
          explanation:
            'GET is defined as safe: its requested effect is read-only, though logging, accounting or other incidental effects can occur and the representation can change between requests. Respect Retry-After and the bounded retry policy. Idempotent methods can also justify retries; safety is not the only possible basis. The timed-out POST is the hard case: no response means you cannot tell whether the reply was written, so a retry risks a second message to the customer, and no deduplication contract is supplied, so the client cannot assume two writes will collapse. The refund is that same ambiguity with money attached, and a 500 tells you the server failed somewhere, not that it failed before the ledger write. PATCH is not inherently idempotent. Its operation semantics and preconditions matter; conditional requests can protect against lost updates. This option supplies no such guarantee, and the concurrent edit makes an unconditional replay especially unsafe to assume.',
          competencies: ['integration'],
        },
        {
          id: 'fde-v1-m02-q2',
          prompt: 'The ticket API answers `HTTP/1.1 429 Too Many Requests` with `Retry-After: 2`. What has the server told you?',
          options: [
            'The caller hit a rate limit; wait at least two seconds before a permitted retry. The response does not define account-wide scope.',
            'The request was processed but the response was truncated, so re-reading the page in two seconds gets you the rest of it.',
            'Your whole account is rate limited for two seconds, so every other request you have in flight will fail during that window too.',
            'The server has queued the request and will answer it within two seconds, so sending it again would create a second copy of the work.',
          ],
          correct: 0,
          explanation:
            '429 reports too many requests in a time window. Retry-After: 2 asks for at least a two-second wait; other responses may use an HTTP date instead. It does not promise the next attempt will succeed, prove a transaction was rolled back, or identify the limiter’s scope. Retry only operations whose semantics make that safe. The truncation answer describes a partial response, which is what ranged requests and 206 are for; a 429 may include an explanatory error body rather than a successful page. The account-wide answer invents a scope the header never states, because the limit may be per key, per endpoint or per tenant and the response does not say which, so assuming the widest one stalls work that would have succeeded. Nothing in 429 or this header promises queued work or a later response; treating it as a successful fetch can leave a sync incomplete.',
          competencies: ['integration'],
        },
        {
          id: 'fde-v1-m02-q3',
          prompt:
            'The API sorts open tickets by unique immutable ticket id. Its documented cursor resumes strictly after the last returned id, without a snapshot guarantee; offset skips a current row count. Agents open and close tickets during the sync. Which advantage does this keyset cursor have?',
          options: [
            'Removing an earlier row shifts offset positions; the stable last-id boundary still resumes after the same key.',
            'A cursor lets the server use an index, while an offset always forces a full scan, so only the cursor finishes within the sync window.',
            'A cursor guarantees you see every ticket exactly once, including the ones created after the sync started.',
            'An offset cannot be resumed after a crash, because the client has no way of knowing how far it got.',
          ],
          correct: 0,
          explanation:
            'Skipping 300 rows means skipping 300 rows of whatever the result set holds at that moment. Close a ticket that sorted into page one and everything after it shifts down by one, so the first row of page four moves to the last row of page three and your sync never sees it. This documented keyset cursor resumes after an immutable unique id, so removing earlier rows does not shift that boundary. An arbitrary API token called a cursor need not have these semantics. Both approaches can use indexes; actual performance depends on the query and implementation, so the always-full-scan claim is false. The exactly-once claim overreaches: a record becoming eligible behind the current key can be missed in this run, while one ahead may appear. This is not a consistent snapshot of the initial open-ticket set; reconciliation, deduplication or change tracking may still be needed. The resume answer is simply wrong, since an offset is a number the client already has and can store.',
          competencies: ['integration'],
        },
        {
          id: 'fde-v1-m02-q4',
          prompt:
            'For one tenant, ticket ids are unique and each logical ticket version has a stable version number. The webhook delivers at least once and generates a fresh deliveryId per attempt. You store one row per ticket version. Which key deduplicates that row?',
          context: {
            language: 'json',
            code: '{\n  "deliveryId": "dlv-7c1f",\n  "deliveredAt": "2026-03-02T02:14:07Z",\n  "ticket": {\n    "id": "TCK-1004",\n    "version": 3,\n    "customerId": "CUS-88",\n    "subject": "Export fails at 02:00",\n    "updatedAt": "2026-03-02T02:14:00Z"\n  }\n}',
          },
          options: [
            '`ticket.id` together with `ticket.version`.',
            '`deliveryId`, since it is unique for every delivery.',
            'A SHA-256 hash of the whole payload.',
            '`ticket.id` on its own.',
          ],
          correct: 0,
          explanation:
            'A row means one version of one ticket, so the key has to name exactly that: the id says which ticket, the version says which state of it. A redelivery of version 3 matches the row you already wrote, and a genuine edit arrives as version 4 and does not. `deliveryId` is unique per attempt rather than per update, which is the opposite of what you need — every redelivery looks new and you store version 3 as many times as the webhook retries. Hashing the whole payload fails for the same reason one level down, because `deliveryId` and `deliveredAt` differ between attempts, so the hash differs too; a canonical content hash can sometimes help under a documented content-deduplication policy, but is not a general replacement for stable event/version identity when separate updates can have equal content. The id alone collapses every version of a ticket into one row, so the second real update is discarded as a duplicate and the ticket is frozen at whatever state arrived first.',
          competencies: ['integration'],
        },
      ],
    },
    {
      id: 'fde-v1-m02-connector-adapter',
      kind: 'code',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Connector adapter: pages, duplicates and a throttled read',
      summary:
        'Sync three cursor-paged ticket pages from a synthetic client that skips a customer id, delivers one ticket twice and throttles a page once. Graded on correctness, on replay and on honouring the wait.',
      competencies: ['integration'],
      estimatedMinutes: 45,
      code: {
        language: 'javascript',
        prompt:
          'Write `syncTickets(client)`, returning a promise for `{ records, skipped, duplicates }`.\n\n`client.listTickets(cursor)` is the only way in. Call it with `null` for the first page. It resolves with `{ tickets, nextCursor }`; keep calling with the `nextCursor` it hands you until that is `null`. Each ticket carries `id`, `customerId`, `subject` and fields you do not need.\n\nFour things go wrong on the way, and all four are graded:\n\n1. **A ticket you cannot use.** Trim `id` and `customerId`. If either is not a string or is empty after trimming, do not keep the ticket: add one to `skipped` and move on. A ticket you skipped never becomes a record, so a second delivery of it is skipped again rather than counted as a duplicate.\n2. **The same ticket twice.** One id arrives on two different pages. Keep the first copy exactly as it was, add one to `duplicates`, and do not overwrite anything.\n3. **Three pages behind a cursor.** An empty `tickets` array does not mean the walk is over. Only a `nextCursor` of `null` does.\n4. **A throttled page.** One call rejects with `{ status: 429, retryAfterMs }`. In this fixture no page was returned, so the page still has to be fetched: `await sleep(retryAfterMs)`, then request the same cursor again. Give a page at most three retries; if it is still throttled after that, let the rejection reach your caller. A rejection whose status is not 429 is never retried and always propagates.\n\nA kept record is exactly `{ id, customerId, subject }` with the trimmed id and customer id, and `subject` copied through unchanged. Sort `records` by `id` ascending, comparing their UTF-16 code units with ordinary < and > (not locale collation), so `TCK-10` sorts before `TCK-9`.\n\nRun `syncTickets` twice on the same client and it must return the same thing both times, with the same counts. Keep every array, set and counter inside the function.\n\nInput bounds: 1–20 finite cursor-linked pages, at most 50 ordinary ticket objects per page; no cycles, getters or proxies. Non-null cursors are strings. Subjects are strings copied unchanged; string fields have at most 1,000 UTF-16 code units. A throttle delay is finite and nonnegative. Do not mutate the returned page or ticket objects.\n\nTarget: O(n log n) time, where n is the total page and ticket count, using bounded-length text comparisons and the usual hash-set cost model; network/virtual waiting is excluded.\n\nThe client is a fixture written for this exercise, not a live API. `sleep` runs on the sandbox’s virtual clock, so a 500 ms wait finishes instantly and still records as a 500 ms gap. Nothing here opens a network connection, and no real customer data appears in the pages.',
        contract: [
          '`client.listTickets(cursor)` is the only source of tickets. Start at `null` and follow `nextCursor` until it is `null`.',
          'Request each page once, plus its retries. Do not restart the walk from the first page after a failure.',
          'Retry only a rejection whose `status` is 429, at most three times per page, and `await sleep(retryAfterMs)` before each retry. Let every other rejection propagate.',
          'Keep records, counters and the set of seen ids inside `syncTickets`, so a second call on the same client starts from zero.',
          '`sleep(ms)` comes from the task harness. Do not define your own and do not use real timers.',
        ],
        starter: `const syncTickets = async client => {

};

// Scratch pad — change this before submitting.
const demoPage = cursor => ({
  tickets: [
    { id: 'TCK-1', customerId: cursor === null ? 'CUS-1' : '', subject: 'Demo', channel: 'email' },
  ],
  nextCursor: cursor === null ? 'p2' : null,
});
const demoClient = { listTickets: cursor => Promise.resolve(demoPage(cursor)) };
syncTickets(demoClient).then(out => console.log(JSON.stringify(out)));
`,
        skeleton: `const syncTickets = async client => {
  const records = [];
  const seen = /* the ids already kept */;
  let skipped = 0;
  let duplicates = 0;

  const fetchPage = async cursor => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await client.listTickets(cursor);
      } catch (error) {
        // rethrow anything that is not a 429, and anything past the retry budget
        // otherwise: await sleep(error.retryAfterMs) and go round again
      }
    }
  };

  let cursor = null;
  for (;;) {
    const page = await fetchPage(cursor);

    for (const ticket of page.tickets) {
      // trim id and customerId; count a skip when either is unusable
      // count a duplicate when the id is already in \`seen\`
      // otherwise remember the id and push { id, customerId, subject }
    }

    if (/* nextCursor is null */) break;
    cursor = page.nextCursor;
  }

  /* sort records by id, ascending, as text */
  return { records, skipped, duplicates };
};`,
        hints: [
          'Put the retry in its own helper that fetches one page. Then the walk stays a plain loop over cursors and the retry logic lives in exactly one place.',
          '`client.listTickets` rejects with a plain object, not an Error. Catch it, check `error.status === 429`, `await sleep(error.retryAfterMs)`, then call `client.listTickets` again with the same cursor. Rethrow everything else.',
          'A `Set` of the ids you have kept answers both questions: `seen.has(id)` means duplicate, and adding to it after you push keeps the first copy. Declare it inside `syncTickets` so the second run starts empty.',
        ],
        approach: [
          'Write `fetchPage(cursor)`: call `client.listTickets(cursor)`, and on a rejection with `status === 429` await `sleep(error.retryAfterMs)` and try the same cursor again, up to three retries. Rethrow anything else and anything past the budget.',
          'Declare `records`, a `Set` of kept ids and the two counters inside `syncTickets`.',
          'Walk from `cursor = null`, fetching a page and then following `page.nextCursor` until it is `null`. An empty page still has a next cursor to follow.',
          'For each ticket, trim the id and the customer id: count a skip when either is empty, count a duplicate when the id is already in the set, otherwise add the id and push `{ id, customerId, subject }`.',
          'Sort `records` by id with a text comparison and return `{ records, skipped, duplicates }`.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'Correct records, skips and duplicates',
            critical: true,
            weight: 3,
            detail:
              'The walk, the boundary check or the record shape is off. Check that you follow `nextCursor` through all three pages, that a record is exactly `{ id, customerId, subject }` with both ids trimmed, that a whitespace-only customer id counts as a skip, that a repeat of an id you kept counts as a duplicate without overwriting the first copy, and that `records` is sorted by id as text.',
          },
          {
            id: 'idempotent',
            label: 'The same result when the sync is replayed',
            critical: true,
            weight: 2,
            detail:
              'A second `syncTickets(client)` on the same client returned something different from the first. The usual cause is state that outlives one call: an array, a `Set` or a counter declared outside the function, so the replay appends to the first run instead of starting fresh. Move every one of them inside `syncTickets`.',
          },
          {
            id: 'throttling',
            label: 'The throttled page is retried and the wait is honoured',
            critical: true,
            weight: 2,
            detail:
              'The 429 was mishandled. Either the page was dropped instead of retried, or the retry went out sooner than `retryAfterMs`, or the whole walk restarted from the first page instead of re-requesting the same cursor. Catch the rejection, `await sleep(error.retryAfterMs)`, then call `client.listTickets` again with the cursor you were already on.',
          },
        ],
        tests: [
          {
            call: '(function () { return syncTickets(__client()).then(__ids); })()',
            expected: ['TCK-1001', 'TCK-1002', 'TCK-1004', 'TCK-1009'],
            label: 'four usable tickets across three pages, sorted by id',
            async: true,
          },
          {
            call: '(function () { return syncTickets(__client()).then(function (out) { return out.records[0]; }); })()',
            expected: { id: 'TCK-1001', customerId: 'CUS-12', subject: 'Cannot add a warehouse' },
            label: 'a record carries id, customerId and subject, and nothing else',
            async: true,
          },
          {
            call:
              '(function () { return syncTickets(__client()).then(function (out) { return { skipped: out.skipped, duplicates: out.duplicates }; }); })()',
            expected: { skipped: 2, duplicates: 1 },
            label: 'two tickets have no usable customer id, one ticket arrives twice',
            async: true,
          },
          {
            call:
              "(function () { var pages = [{ cursor: null, nextCursor: null, tickets: [{ id: ' TCK-2001 ', customerId: ' CUS-77 ', subject: 'Padded' }, { id: 'TCK-2002', customerId: '   ', subject: 'Blank customer' }] }]; return syncTickets(__makeClient(pages, { throttleCursor: '__none' })).then(function (out) { return { records: out.records, skipped: out.skipped, duplicates: out.duplicates }; }); })()",
            expected: { records: [{ id: 'TCK-2001', customerId: 'CUS-77', subject: 'Padded' }], skipped: 1, duplicates: 0 },
            label: 'ids are trimmed, and a whitespace-only customer id is a skip',
            edge: true,
            async: true,
          },
          {
            call:
              "(function () { return syncTickets(__client()).then(function (out) { return out.records.some(function (record) { return record.id === 'TCK-1002'; }); }); })()",
            expected: true,
            label: 'the ticket behind the throttled page survives',
            edge: true,
            async: true,
            criterion: 'throttling',
          },
          {
            call:
              "(function () { var c = __client(); return syncTickets(c).then(function () { var tries = __attempts(c, 'p2'); return tries.length === 2 && tries[1].at - tries[0].at >= 500; }); })()",
            expected: true,
            label: 'the retry waits the retryAfterMs the rejection carried',
            async: true,
            criterion: 'throttling',
          },
          {
            call:
              '(function () { var c = __client(); return syncTickets(c).then(function () { return c.requests.map(function (request) { return request.cursor; }); }); })()',
            expected: [null, 'p2', 'p2', 'p3'],
            label: 'three pages and one retry: four requests, and the retry repeats the same cursor',
            async: true,
            criterion: 'throttling',
          },
          {
            call:
              '(function () { var c = __client(); return syncTickets(c).then(function (first) { return syncTickets(c).then(function (second) { return JSON.stringify(first) === JSON.stringify(second); }); }); })()',
            expected: true,
            label: 'replaying the sync on the same client returns the same result',
            async: true,
            criterion: 'idempotent',
          },
          {
            call:
              '(function () { var c = __client(); return syncTickets(c).then(function () { return syncTickets(c); }).then(function (out) { return { records: out.records.length, skipped: out.skipped, duplicates: out.duplicates }; }); })()',
            expected: { records: 4, skipped: 2, duplicates: 1 },
            label: 'the replay does not double-count records, skips or duplicates',
            edge: true,
            async: true,
            criterion: 'idempotent',
          },
        ],
        harness: TICKET_CLIENT,
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m02-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m02-connector-adapter', state: 'verified_pass' },
  ],
};
