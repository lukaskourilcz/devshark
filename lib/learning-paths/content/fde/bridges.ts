/** Bridges — the optional practice a diagnostic gap points at.
 *
 * Every activity here carries purpose 'diagnostic': a bridge closes a gap the
 * placement check reported, and it never gates module or path completion. The
 * module is optional and holds no requirements, so a learner who already works
 * across the backend, the operator screen, delivery and Python can skip it
 * whole and lose nothing.
 *
 * The original activities cover each bridge in `fde.ts`: a TypeScript mapping exercise
 * for Backend and data, a reducer for Operator interface, an incident case for
 * Delivery operations, and five Python reading questions for Python
 * interoperability. Two added readings and checks cover API clients and async loaders.
 *
 * Every payload, timeline and snippet is a fixture written for this exercise.
 * No customer data, no live system, no vendor account, and no Python runs on
 * the server — the Python questions grade reading, and anything a learner runs
 * locally stays their own self-reviewed note. */

import type { ModuleSource } from '../../types';

/** Builds one raw CRM record from a base fixture plus overrides, so a test
 * says only what it changes. Setting a key to `undefined` removes it, which is
 * how the missing-field cases are written. Appended after the learner's code,
 * so a submission cannot shadow it. */
const ACCOUNT_FIXTURES = `
var __raw = function (overrides) {
  var base = {
    account_id: 4821,
    company_name: 'Brightpier Freight',
    owner_email: 'ops@brightpier.example',
    signed_up_at: '2026-03-04',
    plan: 'growth',
  };
  var out = {};
  for (var key in base) out[key] = base[key];
  for (var patch in overrides) {
    if (overrides[patch] === undefined) delete out[patch];
    else out[patch] = overrides[patch];
  }
  return out;
};
`.trim();

/** Folds a list of actions from the learner's initial state and projects the
 * five fields the grade compares, so an extra bookkeeping field a learner adds
 * does not fail an otherwise correct reducer. */
const OPERATOR_FIXTURES = `
var __proposal = { ticketId: 'BP-4821', action: 'refund', amountCents: 12500 };
var __run = function (actions) {
  var state = initialOperatorState;
  for (var index = 0; index < actions.length; index++) state = operatorReducer(state, actions[index]);
  return state;
};
var __view = function (state) {
  return {
    status: state.status,
    requestId: state.requestId,
    proposal: state.proposal,
    error: state.error,
    abandoned: state.abandoned,
  };
};
`.trim();

/** One incident, read four ways. The same timeline sits in every question's
 * context so each can be answered on its own, in any order. */
const INCIDENT_TIMELINE = `Service: triage-api (Brightpier support triage assistant)
Change 41c7, released 2026-06-11: "cache resolved knowledge-base article lookups in memory"

09:02  41c7 rolled out to 3 of 12 instances (canary).
09:05  Canary p95 latency 410 ms, unchanged. Error rate 0.2%, unchanged.
09:20  Rollout completed on all 12 instances.
11:40  The support lead reports two tickets from tenant NORTHWIND showing an
       article that belongs to tenant CALDERA. No alert has fired.
11:52  On-call opens the dashboards: request rate, error rate, p95 latency and
       CPU are all inside the normal range for a Thursday.
12:05  Traces show the article-lookup span returning in 1 ms for a repeated
       query and 90 ms for a first-time query, for every tenant.
12:14  The cache key is read off the span attributes. It is the article slug.
       The tenant id is not part of it.
12:20  41c7 rolled back on all instances. Repeated lookups return to 90 ms.
12:26  New cross-tenant reads stop. Two support replies quoting the CALDERA
       article were already sent; one of them went out by email.`;

export const FDE_BRIDGES: ModuleSource = {
  id: 'fde-v1-bridges',
  title: 'Bridges',
  outcomes: [
    'Turn a dirty external payload into a validated internal record, or into the full list of reasons it cannot become one.',
    'Write the state logic behind an operator approval screen, including a cancel that a late response cannot undo.',
    'Read an incident timeline and separate the signal that would have caught it, the change that caused it, the safe first action and the damage a rollback leaves behind.',
    'Read typed and asynchronous Python well enough to work with a data team. Reading is what is graded here: no Python runs on the server, and any Python you run locally is your own note, recorded as self-reviewed.',
  ],
  competencies: ['integration', 'boundaries', 'handoff', 'operations', 'python-reading'],
  dependsOn: [],
  estimatedMinutes: 156,
  lessons: [
  {
    "id": "fde-v1-bridge-python-api-lesson",
    "title": "Read an asynchronous API boundary",
    "summary": "Follow await, HTTP status handling and JSON reshaping in a FastAPI-shaped client.",
    "estimatedMinutes": 12,
    "sources": [
      {
        "label": "FastAPI: concurrency and async / await",
        "url": "https://fastapi.tiangolo.com/async/",
        "reviewedOn": "2026-10-22"
      },
      {
        "label": "HTTPX: asynchronous clients",
        "url": "https://www.python-httpx.org/async/",
        "reviewedOn": "2026-10-22"
      },
      {
        "label": "HTTPX: network timeout phases",
        "url": "https://www.python-httpx.org/advanced/timeouts/",
        "reviewedOn": "2026-10-22"
      },
      {
        "label": "HTTPX: status checks and JSON responses",
        "url": "https://www.python-httpx.org/quickstart/",
        "reviewedOn": "2026-10-22"
      }
    ],
    "sections": [
      {
        "kind": "callout",
        "tone": "note",
        "body": "These are original Python 3.10+ reading fixtures. The .invalid host cannot supply a real customer record. devShark does not run this Python fixture or start its API server. No network call or vendor account is needed. The check grades reading only; optional local experiments are self-reviewed."
      },
      {
        "kind": "prose",
        "body": "Calling an async def function creates a coroutine. Await it from asynchronous code to obtain its result. FastAPI invokes its async route function; the ordinary helper it calls still needs an explicit await. An async declaration does not turn synchronous HTTP or CPU work into nonblocking work."
      },
      {
        "kind": "code",
        "language": "python",
        "caption": "Authored API client and route: assume the response body has id and display_name on a successful request.",
        "code": "from fastapi import FastAPI\nimport httpx\n\napp = FastAPI()\n\nasync def read_account(client: httpx.AsyncClient, account_id: int) -> dict:\n    response = await client.get(f\"/accounts/{account_id}\")\n    response.raise_for_status()\n    return response.json()\n\n@app.get(\"/accounts/{account_id}\")\nasync def account(account_id: int):\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        record = await read_account(client, account_id)\n    return {\"id\": record[\"id\"], \"name\": record[\"display_name\"]}\n"
      },
      {
        "kind": "prose",
        "body": "The request is awaited; status validation and JSON decoding follow it. raise_for_status rejects a non-success status instead of letting this route treat an error payload as an account. JSON decoding still does not validate the expected keys or types. A 200 body without display_name therefore fails at the final mapping; a real boundary needs a stated schema policy."
      },
      {
        "kind": "prose",
        "body": "The async context owns the client and closes it on exit. The route maps display_name to name and forwards only the selected fields. A five-second HTTPX timeout controls network timeout phases; it is not proof of a five-second end-to-end route deadline. Retries, an overall budget and the error response policy would need explicit design."
      }
    ]
  },
  {
    "id": "fde-v1-bridge-python-loader-lesson",
    "title": "Read a bounded asynchronous loader",
    "summary": "Distinguish concurrency limits, result order and failure behavior in an authored batch.",
    "estimatedMinutes": 15,
    "sources": [
      {
        "label": "Python: coroutines, tasks and gather",
        "url": "https://docs.python.org/3/library/asyncio-task.html",
        "reviewedOn": "2026-10-22"
      },
      {
        "label": "Python: asyncio semaphores",
        "url": "https://docs.python.org/3/library/asyncio-sync.html",
        "reviewedOn": "2026-10-22"
      },
      {
        "label": "HTTPX: asynchronous clients",
        "url": "https://www.python-httpx.org/async/",
        "reviewedOn": "2026-10-22"
      }
    ],
    "sections": [
      {
        "kind": "callout",
        "tone": "note",
        "body": "This Python 3.10+ batch is an authored reading fixture. It makes no real requests here. Each question supplies its ids list. Successful bodies have the requested id, and request completion order may differ from input order."
      },
      {
        "kind": "code",
        "language": "python",
        "caption": "One client for the batch, with at most two entries in the guarded request/parse region at a time.",
        "code": "import asyncio\nimport httpx\n\nasync def load_accounts(ids: list[int]) -> list[dict]:\n    limit = asyncio.Semaphore(2)\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        async def read_one(account_id: int) -> dict:\n            async with limit:\n                response = await client.get(f\"/accounts/{account_id}\")\n                response.raise_for_status()\n                return response.json()\n        return await asyncio.gather(*(read_one(i) for i in ids))\n"
      },
      {
        "kind": "prose",
        "body": "gather schedules the supplied coroutines. The semaphore allows at most two read_one calls into the guarded region at once for this invocation. That is a concurrency bound, not a requests-per-second rate limit. Another invocation creates a separate semaphore; this code establishes no process-wide or tenant-wide limit. One batch client avoids creating a fresh connection pool inside each iteration."
      },
      {
        "kind": "prose",
        "body": "On success, gather returns results in the order of its input awaitables, even when responses finish in a different order. This code keeps duplicates: ids [7, 3, 7] schedules three reads. The semaphore does not deduplicate records, authorize tenant access, paginate results or decide how a retry is safe."
      },
      {
        "kind": "prose",
        "body": "With the default return_exceptions=False, gather propagates the first raised exception to its caller. It does not automatically cancel the other submitted awaitables; they may still be running as this function unwinds and its client scope exits. Do not infer a settled partial-result list, atomic rollback or guaranteed sibling cancellation from this code. A production loader needs explicit failure, cancellation and cleanup policy. TaskGroup, available in Python 3.11+, has different sibling-cancellation semantics and is not used here."
      }
    ]
  }
],
  activities: [
    {
      id: 'fde-v1-bridge-backend-mapping',
      kind: 'code',
      purpose: 'diagnostic',
      verification: 'machine_verified',
      title: 'Map a dirty payload to a validated record',
      summary: 'Turn one messy CRM export record into a validated account, or into every reason it cannot become one.',
      competencies: ['integration'],
      estimatedMinutes: 35,
      code: {
        language: 'typescript',
        prompt:
          'Brightpier Freight exports account records to your integration. The export has the shape real exports have: fields go missing, a date arrives as an empty string, the id is sometimes a number and sometimes a string of digits, and a plan name turns up that your system has never heard of.\n\nWrite `mapAccount(raw)`. It takes one raw record and returns a discriminated result: `{ ok: true, record }` when every field survives validation, and `{ ok: false, problems }` when one or more do not. Never both, and never a half-filled record sitting next to a problem list.\n\nTrim every string field before you check it. The rules:\n\n- `account_id` becomes `record.id`, a non-negative safe integer (0 through Number.MAX_SAFE_INTEGER). A safe numeric integer passes as it is; a trimmed ASCII digit string is converted only if its result is in that range, and anything else is the problem `account_id must be a whole number`.\n- `company_name` becomes `record.companyName` and must be non-empty after trimming, or the problem is `company_name must not be empty`.\n- `owner_email` becomes `record.ownerEmail`, trimmed and lowercased, and must contain `@`, or the problem is `owner_email must contain @`.\n- `signed_up_at` becomes `record.signedUpAt`. Missing, `null` and an empty string all mean `null` — this export uses those values for an unknown sign-up date; do not infer why it is missing or invent today’s date. Any other value must be a string matching the digit pattern `YYYY-MM-DD` after trimming (shape only, not calendar-date validation), or the problem is `signed_up_at must be YYYY-MM-DD`.\n- `plan` becomes `record.plan` and must be exactly `starter`, `growth` or `enterprise`. Anything else, `Growth` included, is the problem `plan must be one of starter, growth or enterprise`.\n\nCollect every problem rather than returning the first one: whoever fixes the export wants the whole list in one pass. Sort the list alphabetically using the default string order before returning it. A fixed field-check order can also be deterministic, but this contract requires canonical alphabetical order.\n\nTarget: O(n) time, where n is the total input string length, under a character-processing model.\n\nThe records here are fixtures written for this exercise. They are not live CRM traffic, and nothing calls out to a network.',
        contract: [
          'Return `{ ok: true, record }` or `{ ok: false, problems }`, never a record and a problem list together.',
          'Collect every problem in one pass and sort the list alphabetically before returning it.',
          'Keep the supplied `RawAccount`, `Account` and `MapResult` type names and the `mapAccount` signature; the type assertions call them by name.',
          'No imports, no network and no clock. Input is an ordinary raw object with optional unknown-valued fields, no getters or proxies; do not mutate it. String fields have at most 1,000 UTF-16 code units. The email check is deliberately only the presence of @, not full email validation.',
        ],
        starter: `type Plan = 'starter' | 'growth' | 'enterprise';

interface RawAccount {
  account_id?: unknown;
  company_name?: unknown;
  owner_email?: unknown;
  signed_up_at?: unknown;
  plan?: unknown;
}

interface Account {
  id: number;
  companyName: string;
  ownerEmail: string;
  signedUpAt: string | null;
  plan: Plan;
}

type MapResult = { ok: true; record: Account } | { ok: false; problems: string[] };

const mapAccount = (raw: RawAccount): MapResult => {

};

// Scratch pad — change this before submitting.
console.log(mapAccount({ account_id: '4821', company_name: 'Brightpier Freight', owner_email: 'ops@brightpier.example', signed_up_at: '', plan: 'growth' }));
`,
        skeleton: `type Plan = 'starter' | 'growth' | 'enterprise';

interface RawAccount {
  account_id?: unknown;
  company_name?: unknown;
  owner_email?: unknown;
  signed_up_at?: unknown;
  plan?: unknown;
}

interface Account {
  id: number;
  companyName: string;
  ownerEmail: string;
  signedUpAt: string | null;
  plan: Plan;
}

type MapResult = { ok: true; record: Account } | { ok: false; problems: string[] };

const mapAccount = (raw: RawAccount): MapResult => {
  const problems: string[] = [];

  /* account_id: an integer, or a string of digits, or a problem */

  /* company_name: non-empty after trimming, or a problem */

  /* owner_email: trimmed, lowercased, has to contain @ */

  /* signed_up_at: missing, null and '' all mean null; anything else matches YYYY-MM-DD or is a problem */

  /* plan: exactly one of the three, or a problem */

  if (problems.length > 0) return { ok: false, problems: /* sorted */ problems };
  return { ok: true, record: /* the five converted fields */ };
};`,
        hints: [
          'Keep one `problems` array, push into it as each field fails, and decide at the very end which half of the result to return. A field that fails still gets checked, because whoever reads the list wants every problem at once.',
          '`typeof value === "string" && /^\\d+$/.test(value.trim())` separates "4821" from "48a" and from an empty string, and `Number(...)` then converts it. Check `Number.isSafeInteger` and the non-negative range after conversion, including numeric input.',
          'The narrowing the type assertions look for comes from the literal `ok` field. With `{ ok: true; record: Account } | { ok: false; problems: string[] }`, TypeScript rules out `record` on the failing branch by itself.',
        ],
        approach: [
          'Start an empty `problems` array.',
          'Check the fields one at a time, pushing the exact problem string on a failure and keeping the converted value on a pass.',
          'Treat a missing, null or empty `signed_up_at` as `null` rather than as a problem.',
          'Sort `problems` and return `{ ok: false, problems }` when the array is not empty.',
          'Otherwise assemble the five converted fields and return `{ ok: true, record }`.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'The record and the problem list are both correct',
            critical: true,
            weight: 3,
            detail: 'Check the empty-string date, the string id, the unknown plan, a record missing several fields at once, and that a rejected payload carries no partial record.',
          },
          {
            id: 'deterministic-problems',
            label: 'Problems come back sorted, every time',
            critical: true,
            weight: 2,
            detail: 'The problem list came back in the order the fields were checked rather than alphabetically. A fixed field-check order can be deterministic too, but it does not satisfy the required alphabetical order.',
          },
        ],
        tests: [
          {
            call: 'mapAccount(__raw({}))',
            expected: {
              ok: true,
              record: {
                id: 4821,
                companyName: 'Brightpier Freight',
                ownerEmail: 'ops@brightpier.example',
                signedUpAt: '2026-03-04',
                plan: 'growth',
              },
            },
            label: 'a clean record maps straight through',
          },
          {
            call: "mapAccount(__raw({ account_id: '4821' }))",
            expected: {
              ok: true,
              record: {
                id: 4821,
                companyName: 'Brightpier Freight',
                ownerEmail: 'ops@brightpier.example',
                signedUpAt: '2026-03-04',
                plan: 'growth',
              },
            },
            label: 'a numeric id arriving as a string becomes a number',
          },
          {
            call: "mapAccount(__raw({ signed_up_at: '' }))",
            expected: {
              ok: true,
              record: {
                id: 4821,
                companyName: 'Brightpier Freight',
                ownerEmail: 'ops@brightpier.example',
                signedUpAt: null,
                plan: 'growth',
              },
            },
            label: 'an empty-string date becomes null, not today',
            edge: true,
          },
          {
            call: "mapAccount(__raw({ company_name: '  Brightpier Freight  ', owner_email: ' OPS@Brightpier.Example ' }))",
            expected: {
              ok: true,
              record: {
                id: 4821,
                companyName: 'Brightpier Freight',
                ownerEmail: 'ops@brightpier.example',
                signedUpAt: '2026-03-04',
                plan: 'growth',
              },
            },
            label: 'string fields are trimmed and the email is lowercased',
          },
          {
            call: "mapAccount(__raw({ plan: 'platinum' }))",
            expected: { ok: false, problems: ['plan must be one of starter, growth or enterprise'] },
            label: 'an unknown plan is rejected by name',
            edge: true,
          },
          {
            call: 'mapAccount({})',
            expected: {
              ok: false,
              problems: [
                'account_id must be a whole number',
                'company_name must not be empty',
                'owner_email must contain @',
                'plan must be one of starter, growth or enterprise',
              ],
            },
            label: 'an empty payload reports four problems, and a missing date is not one of them',
            edge: true,
          },
          {
            call: "'record' in mapAccount({})",
            expected: false,
            label: 'a rejected payload carries no partial record',
            edge: true,
          },
          {
            call: "mapAccount(__raw({ plan: 'platinum', account_id: 'four thousand', signed_up_at: '04/03/2026' }))",
            expected: {
              ok: false,
              problems: [
                'account_id must be a whole number',
                'plan must be one of starter, growth or enterprise',
                'signed_up_at must be YYYY-MM-DD',
              ],
            },
            label: 'three problems at once, alphabetical rather than field order',
            criterion: 'deterministic-problems',
          },
        ],
        typeTests: [
          {
            code: "const __id: number = ((): number => { const result = mapAccount({ account_id: '4821', company_name: 'Brightpier Freight', owner_email: 'ops@brightpier.example', signed_up_at: '2026-03-04', plan: 'growth' }); return result.ok ? result.record.id : -1; })();",
            label: 'the ok branch narrows to a record with a numeric id',
          },
          {
            code: "const __plan: 'starter' | 'growth' | 'enterprise' = ((): 'starter' | 'growth' | 'enterprise' => { const result = mapAccount({ plan: 'starter' }); return result.ok ? result.record.plan : 'starter'; })();",
            label: 'plan is the three-value union, not a bare string',
          },
          {
            code: 'const __leak = mapAccount({}).record;',
            label: 'the record cannot be read before the result narrows',
            rejects: true,
          },
          {
            code: 'const __both = ((): string[] => { const result = mapAccount({}); return result.ok ? result.problems : []; })();',
            label: 'the ok branch carries no problem list',
            rejects: true,
          },
        ],
        harness: ACCOUNT_FIXTURES,
      },
    },
    {
      id: 'fde-v1-bridge-operator-state',
      kind: 'code',
      purpose: 'diagnostic',
      verification: 'machine_verified',
      title: 'The operator approval state machine',
      summary: 'A reducer for the screen an operator approves work on, including a cancel that a late response cannot undo.',
      competencies: ['handoff'],
      estimatedMinutes: 35,
      code: {
        language: 'javascript',
        prompt:
          'An operator at Brightpier reviews a proposed refund before it happens: the screen loads a proposal, the operator approves it, and the approval goes back to the ticket service. This exercise is the state logic behind that screen. You write the reducer and the grade drives it with action lists directly, rather than rendering a component, because transition bugs are one possible production failure and they are testable on their own.\n\nExport two things. `initialOperatorState` is the starting state: `{ status: \'idle\', requestId: null, proposal: null, error: null, abandoned: [] }`. `operatorReducer(state, action)` returns the next state and never mutates the one it was given.\n\nThe transitions:\n\n- `{ type: \'load\', requestId }` from any status except `loading` and `approving` goes to `loading`, stores `requestId`, and clears `proposal` and `error`. While a request is in flight, a second load is ignored.\n- `{ type: \'loaded\', requestId, proposal }` goes to `ready` and clears `requestId`, but only when the status is `loading` and `requestId` matches the one in state.\n- `{ type: \'approve\', requestId }` from `ready` goes to `approving`, stores the new `requestId`, and keeps the proposal on screen.\n- `{ type: \'approved\', requestId }` goes to `approved` and clears `requestId`, but only from `approving` with a matching id.\n- `{ type: \'failed\', requestId, message }` goes to `error` with `error` set to the message, but only from `loading` or `approving` with a matching id.\n- `{ type: \'cancel\' }` from `loading` or `approving` goes back to `idle`, clears `requestId`, `proposal` and `error`, and appends the abandoned request id to `abandoned`.\n\nThe part that matters: after a cancel, the response for that request can still arrive. It has to change nothing. The same goes for a response whose `requestId` does not match the one in flight, which is what a superseded request looks like.\n\nDomain: state is the initial state or a prior valid reducer result, with at most 100 prior actions/abandoned ids. Actions are ordinary data with no getters/proxies; a missing/null action or a missing/nonstring type is ignored. Accepted request ids are positive safe integers allocated uniquely for the entire session by the caller, never reused after cancel. Response ids refer to those allocated requests. Proposal data is opaque and read-only, error messages are strings including empty, and all state/action arrays may be frozen. Do not mutate any input or nested abandoned list. This bounded state machine has no single input-size target.\n\nAny action the current status does not allow — an unknown type included — returns the state object it was given, unchanged and identical. React can skip committing updates to children when the next state is Object.is-equal to the current state, though it may still call the component before bailing out. A fresh object can cause unnecessary work; it does not necessarily repaint the browser. Same-object no-ops are part of this exercise contract.',
        contract: [
          'Keep the names `initialOperatorState` and `operatorReducer`; the grade drives them by name.',
          'Never mutate the state passed in. Build a new object for a real transition.',
          'For an action the status does not allow, return the same state object, not a copy of it.',
          'No timers, no network and no randomness: the reducer is a pure function of state and action.',
        ],
        starter: `const initialOperatorState = {
  status: 'idle',
  requestId: null,
  proposal: null,
  error: null,
  abandoned: [],
};

const operatorReducer = (state, action) => {

};

// Scratch pad — change this before submitting.
console.log(operatorReducer(initialOperatorState, { type: 'load', requestId: 1 }));
`,
        skeleton: `const initialOperatorState = {
  status: 'idle',
  requestId: null,
  proposal: null,
  error: null,
  abandoned: [],
};

const operatorReducer = (state, action) => {
  switch (action.type) {
    case 'load':
      /* ignore while a request is in flight, otherwise go to loading */
    case 'loaded':
      /* only from loading, and only when the id matches */
    case 'approve':
      /* only from ready */
    case 'approved':
      /* only from approving, and only when the id matches */
    case 'failed':
      /* only from loading or approving, and only when the id matches */
    case 'cancel':
      /* back to idle, and record the abandoned request id */
    default:
      return state;
  }
};`,
        hints: [
          'Write each case as a guard first and a transition second: check the status and the request id, `return state` when either is wrong, and only then build the next object.',
          'Clearing `requestId` on cancel is what makes a late response harmless. Every response case compares `action.requestId` against `state.requestId`, and also checks the in-flight status. Valid request ids are positive and never reused, so null is not an accepted response id.',
          'Ignoring an action means `return state` — the same reference, not `{ ...state }`. One of the assertions compares the returned object against the one it passed in.',
        ],
        approach: [
          'Start with a switch on `action.type` whose default returns `state` unchanged.',
          'Handle `load`: ignore it while the status is `loading` or `approving`, otherwise move to `loading` with the new request id and a cleared proposal and error.',
          'Handle the two responses, `loaded` and `approved`, each guarded by both the status and a matching request id.',
          'Handle `failed` from either in-flight status, storing the message and clearing the request id.',
          'Handle `cancel` from either in-flight status: back to `idle`, everything cleared, and the abandoned id appended to `abandoned`.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'The transitions the operator sees are correct',
            critical: true,
            weight: 3,
            detail: 'Check idle to loading to ready, ready through approving to approved, and a failure that lands in error with the message.',
          },
          {
            id: 'stale-responses',
            label: 'A cancelled or superseded request cannot change the state',
            critical: true,
            weight: 2,
            detail: 'A response arriving after a cancel, or carrying a request id that is not the one in flight, has to leave the state exactly as it was — the same object, not a copy.',
          },
        ],
        tests: [
          {
            call: '__view(__run([]))',
            expected: { status: 'idle', requestId: null, proposal: null, error: null, abandoned: [] },
            label: 'the screen starts idle with nothing in flight',
          },
          {
            call: "__view(__run([{ type: 'load', requestId: 1 }]))",
            expected: { status: 'loading', requestId: 1, proposal: null, error: null, abandoned: [] },
            label: 'load moves to loading and records the request id',
          },
          {
            call: "__view(__run([{ type: 'load', requestId: 1 }, { type: 'loaded', requestId: 1, proposal: __proposal }]))",
            expected: {
              status: 'ready',
              requestId: null,
              proposal: { ticketId: 'BP-4821', action: 'refund', amountCents: 12500 },
              error: null,
              abandoned: [],
            },
            label: 'the matching response makes the proposal ready',
          },
          {
            call: "__view(__run([{ type: 'load', requestId: 1 }, { type: 'loaded', requestId: 1, proposal: __proposal }, { type: 'approve', requestId: 2 }, { type: 'approved', requestId: 2 }]))",
            expected: {
              status: 'approved',
              requestId: null,
              proposal: { ticketId: 'BP-4821', action: 'refund', amountCents: 12500 },
              error: null,
              abandoned: [],
            },
            label: 'approve then approved, with the proposal still on screen',
          },
          {
            call: "__view(__run([{ type: 'load', requestId: 1 }, { type: 'failed', requestId: 1, message: 'ticket service timed out' }]))",
            expected: { status: 'error', requestId: null, proposal: null, error: 'ticket service timed out', abandoned: [] },
            label: 'a failure keeps the message the operator has to read',
          },
          {
            call: "__view(__run([{ type: 'load', requestId: 1 }, { type: 'cancel' }]))",
            expected: { status: 'idle', requestId: null, proposal: null, error: null, abandoned: [1] },
            label: 'cancel while loading returns to idle and abandons the request',
          },
          {
            call: "__view(__run([{ type: 'load', requestId: 1 }, { type: 'cancel' }, { type: 'loaded', requestId: 1, proposal: __proposal }]))",
            expected: { status: 'idle', requestId: null, proposal: null, error: null, abandoned: [1] },
            label: 'the cancelled response arrives late and changes nothing',
            edge: true,
            criterion: 'stale-responses',
          },
          {
            call: "__view(__run([{ type: 'load', requestId: 1 }, { type: 'loaded', requestId: 1, proposal: __proposal }, { type: 'approve', requestId: 2 }, { type: 'cancel' }, { type: 'approved', requestId: 2 }]))",
            expected: { status: 'idle', requestId: null, proposal: null, error: null, abandoned: [2] },
            label: 'a cancelled approval cannot come back as approved',
            edge: true,
            criterion: 'stale-responses',
          },
          {
            call: "(function () { var state = __run([{ type: 'load', requestId: 1 }]); return operatorReducer(state, { type: 'refresh' }) === state; })()",
            expected: true,
            label: 'an action the status does not allow returns the same object',
            edge: true,
          },
        ],
        harness: OPERATOR_FIXTURES,
      },
    },
    {
      id: 'fde-v1-bridge-incident-case',
      kind: 'check',
      purpose: 'diagnostic',
      verification: 'machine_verified',
      title: 'Read an incident from its timeline',
      summary: 'One cross-tenant cache incident: the direct correctness signal, the missing key scope, containment under stated rollback conditions, and consequences already outside the service.',
      competencies: ['operations'],
      estimatedMinutes: 15,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-bridge-incident-q1',
          prompt: 'Latency, 5xx rate and CPU stayed normal during the cross-tenant reads. Which additional signal directly tests the failure shown in the timeline?',
          context: { language: 'text', code: INCIDENT_TIMELINE },
          options: [
            'Alert when a cached article’s tenant differs from the request’s authorized tenant.',
            'A high-latency threshold alert on the article-lookup span, set just above its usual 90 ms.',
            'An error-rate alert on triage-api 5xx responses, paged when the rate rises above the 0.2% baseline.',
            'A CPU saturation alert on the 12 instances, where a growing in-memory cache would show first.',
          ],
          correct: 0,
          explanation:
            'The returned article can be fast and have a successful HTTP response while violating tenant isolation. Comparing its tenant against the authorized request tenant directly detects that invariant violation and should also block the response. A high-latency threshold would not catch the drop from 90 ms to 1 ms. The timeline reports no increased 5xx rate or CPU saturation. Other security signals could help; these choices do not establish which alert would fire first in every deployment.',
          competencies: ['operations'],
        },
        {
          id: 'fde-v1-bridge-incident-q2',
          prompt: 'Which explanation fits the whole timeline?',
          context: { language: 'text', code: INCIDENT_TIMELINE },
          options: [
            'A slug-only cache can reuse one tenant’s article for another tenant requesting that slug on the same instance.',
            'The knowledge base has NORTHWIND and CALDERA sharing an article namespace, so the lookup returned an article both tenants were entitled to.',
            'The canary at 09:02 covered 3 of 12 instances, too few for the fault to appear.',
            'Cached entries outlived their time to live and were served after the tenant session that created them had ended.',
          ],
          correct: 0,
          explanation:
            'The 12:14 entry names the defect: the key is the slug, with no tenant id in it, so one tenant’s article answers another tenant’s lookup. A shared namespace would not have been fixed by rolling back 41c7 at 12:20, and nothing in the timeline touched the knowledge base. The canary size affects how fast a fault is noticed, not whether it exists; the fault was on all 12 instances from 09:20 and still fired no alert. The timeline supplies no TTL change. Its explicit missing tenant dimension explains cross-tenant reuse without inventing expiration behavior; stale permissions can create other authorization problems, but are not the stated evidence here.',
          competencies: ['operations'],
        },
        {
          id: 'fde-v1-bridge-incident-q3',
          prompt: 'It is 11:52 and cross-tenant reads continue. A tested, schema-compatible previous release is ready for immediate rollback, with no cache kill switch. Before diagnosing the exact cause, which listed action best contains the active disclosure?',
          context: { language: 'text', code: INCIDENT_TIMELINE },
          options: [
            'Restore the known-good release, verify disclosure has stopped, and investigate replies already sent.',
            'Add the tenant id to the cache key, have the change reviewed, and deploy the fix forward to all 12 instances.',
            'Flush the in-memory cache on all 12 instances and keep 41c7 running while the cause is diagnosed.',
            'Cut the cache time to live to 30 seconds so wrong entries expire quickly, and watch the reports.',
          ],
          correct: 0,
          explanation:
            'Under the stated conditions, restoring the tested compatible release is the available immediate containment; verify the cross-tenant responses stop rather than assuming deployment success proves it. At 11:52 the exact cache-key defect is not yet known, and writing/reviewing a forward fix would leave the disclosure active. Once the defect is established, flushing or shortening TTL still allows the same unsafe key to refill. Preserve incident evidence and investigate earlier disclosures alongside containment. A rollback is not automatically the right choice when compatibility or its ability to contain a fault is unknown.',
          competencies: ['operations'],
        },
        {
          id: 'fde-v1-bridge-incident-q4',
          prompt: 'The rollback finished at 12:20 and new cross-tenant reads stopped at 12:26. What has the rollback not undone?',
          context: { language: 'text', code: INCIDENT_TIMELINE },
          options: [
            'The two replies already sent, including the email; changing deployed code cannot retract them.',
            'Nothing. All 12 instances are back on the previous release, so the incident is closed.',
            'The 90 ms repeated-lookup latency, which the rollback has now made permanent.',
            'The cached entries themselves, which survive the rollback and keep answering with CALDERA’s article.',
          ],
          correct: 0,
          explanation:
            'The two replies are already outside the service, one in a customer inbox. Restoring code does not recall them. Assess the scope, preserve evidence and coordinate the appropriate incident and tenant follow-up; stopping new reads alone does not settle those consequences. The 90 ms figure is the behaviour from before 41c7 rather than a new regression, so the rollback restored it instead of making it permanent. The timeline says new cross-tenant reads stopped at 12:26, which contradicts the claim that those entries keep answering afterward. It does not specify the exact process-replacement or cache-cleanup mechanism, so do not infer one.',
          competencies: ['operations'],
        },
      ],
    },
    {
      id: 'fde-v1-bridge-python-reading',
      kind: 'check',
      purpose: 'diagnostic',
      verification: 'machine_verified',
      title: 'Read typed and asynchronous Python',
      summary:
        'Five Python reading questions: an Optional hint, a coroutine, a dict reshape, environment defaults and an HTTPX response. Multiple-choice reading is graded; the server does not execute Python. Running snippets locally is optional practice, not a separately recorded verified result. The HTTPX example uses Python 3.10 or newer.',
      competencies: ['python-reading'],
      estimatedMinutes: 20,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-bridge-python-q1',
          prompt: 'According to the return annotation, which values must a caller be prepared to handle? This is a static type contract; Python does not validate input or return types from annotations at runtime.',
          context: {
            language: 'python',
            code: `from typing import Optional


def owner_email(account: dict, fallback: Optional[str] = None) -> Optional[str]:
    email = account.get("owner_email")
    if email is None:
        return fallback
    return email.strip().lower()`,
          },
          options: [
            'It is a string or None, so the caller has to handle None before using it as a string.',
            'It is always a string. `Optional` marks the argument as having a default, not the return.',
            'It is a string unless the function raises; `Optional[str]` means "a str or an exception".',
            'It is None only when `fallback` was passed explicitly.',
          ],
          correct: 0,
          explanation:
            '`Optional[str]` is `str | None`, and the two returns show both: `fallback` when the key is missing, a lowercased string otherwise. The default value on the parameter is the `= None`, which is a separate thing from the annotation. `Optional` says nothing about exceptions. A missing key or a value of None returns fallback. Its default is None, and passing None explicitly still permits None; passing a string fallback supplies that string. An existing blank string instead becomes a blank string after strip/lower. These annotations do not validate arbitrary values inside the unparameterized dict; a non-string email can raise when strip is called.',
          competencies: ['python-reading'],
        },
        {
          id: 'fde-v1-bridge-python-q2',
          prompt: 'A colleague calls `collect(client, "northwind")` from ordinary synchronous code. What comes back?',
          context: {
            language: 'python',
            code: `async def fetch_tickets(client, tenant_id: str) -> list[dict]:
    response = await client.get(f"/tenants/{tenant_id}/tickets")
    return response.json()["items"]


def collect(client, tenant_id: str) -> list[dict]:
    return fetch_tickets(client, tenant_id)`,
          },
          options: [
            'A coroutine object; the body has not run at this point despite the list return annotation.',
            'The list of ticket dicts. Python runs the coroutine to completion when a synchronous function calls it.',
            'An empty list, because the awaits inside it have not resolved yet.',
            'A RuntimeError, because an async function cannot be called from a synchronous one.',
          ],
          correct: 0,
          explanation:
            'Calling an `async def` builds a coroutine and runs none of its body; the work starts at `await` or when something like `asyncio.run` drives it. The annotation on `collect` says `list[dict]` and is wrong, which is exactly the kind of thing a type checker catches and the interpreter does not. This call does not drive the coroutine and returns its object without running the body. Awaiting or scheduling it later can produce the list. Discarding it unawaited can produce a RuntimeWarning when finalized; warning filters and collection timing affect whether and when it is seen.',
          competencies: ['python-reading'],
        },
        {
          id: 'fde-v1-bridge-python-q3',
          prompt: 'What is `record` after this runs?',
          context: {
            language: 'python',
            code: `raw = {
    "id": "4821",
    "company": {"name": "Brightpier Freight", "plan": "growth"},
    "contacts": [
        {"email": "billing@brightpier.example", "primary": False},
        {"email": "ops@brightpier.example", "primary": True},
    ],
}

record = {
    "id": int(raw["id"]),
    "name": raw["company"]["name"],
    "plan": raw["company"].get("plan", "starter"),
    "primary_email": next(
        (c["email"] for c in raw["contacts"] if c["primary"]),
        None,
    ),
}`,
          },
          options: [
            '{"id": 4821, "name": "Brightpier Freight", "plan": "growth", "primary_email": "ops@brightpier.example"}',
            '{"id": "4821", "name": "Brightpier Freight", "plan": "growth", "primary_email": "ops@brightpier.example"}',
            '{"id": 4821, "name": "Brightpier Freight", "plan": "starter", "primary_email": "ops@brightpier.example"}',
            '{"id": 4821, "name": "Brightpier Freight", "plan": "growth", "primary_email": "billing@brightpier.example"}',
          ],
          correct: 0,
          explanation:
            '`int("4821")` converts the id, so it is a number and not the original string. `.get("plan", "starter")` returns the stored value and falls back to `"starter"` only when the key is absent, and here it is present. The generator inside `next` skips the contact whose `primary` is False and stops at the first one that is True, which is the ops address rather than the first contact in the list; the `None` is the default `next` returns when nothing matches at all.',
          competencies: ['python-reading'],
        },
        {
          id: 'fde-v1-bridge-python-q4',
          prompt: 'The deployment sets `TRIAGE_API_TOKEN` and neither of the other two variables. What happens when this module is imported?',
          context: {
            language: 'python',
            code: `import os

BATCH_SIZE = int(os.environ.get("TRIAGE_BATCH_SIZE", "25"))
API_TOKEN = os.environ["TRIAGE_API_TOKEN"]
TIMEOUT = float(os.getenv("TRIAGE_TIMEOUT_SECONDS", "5"))`,
          },
          options: [
            'It imports cleanly, with `BATCH_SIZE` the integer 25 and `TIMEOUT` the float 5.0, both from the defaults.',
            'It raises KeyError on the first line, because reading a variable that is not set is always a KeyError.',
            'It imports, but `BATCH_SIZE` is the string "25" and `TIMEOUT` the string "5", since environment values are always strings.',
            'It imports, and `BATCH_SIZE` and `TIMEOUT` are None until something assigns them.',
          ],
          correct: 0,
          explanation:
            '`os.environ.get(name, default)` and `os.getenv(name, default)` both return the default when the variable is missing, and the `int(...)` and `float(...)` calls around them convert the string. Subscripting, `os.environ["TRIAGE_API_TOKEN"]`, is the line that would raise KeyError, and it is the one variable the deployment does set. Environment values do arrive as strings, which is why the conversions are there. Nothing here can produce None: `get` was given a default, so it never falls back to one.',
          competencies: ['python-reading'],
        },
        {
          id: 'fde-v1-bridge-python-q5',
          prompt: 'With Python 3.10+ and a synchronous HTTPX Client using its default redirect behavior, what does client.get return and what does raise_for_status check?',
          context: {
            language: 'python',
            code: `import httpx


def fetch_page(client: httpx.Client, cursor: str | None) -> dict:
    response = client.get("/v1/tickets", params={"cursor": cursor} if cursor else None)
    response.raise_for_status()
    return response.json()`,
          },
          options: [
            'A Response; raise_for_status raises for a non-2xx status, while json parses the body separately.',
            'The parsed JSON body. `raise_for_status()` then re-inspects that body for an "error" key and raises if it finds one.',
            'A Response. `raise_for_status()` raises for any status other than exactly 200, so a 204 or a 301 would raise as well.',
            'A coroutine that has to be awaited, because httpx is an asynchronous library.',
          ],
          correct: 0,
          explanation:
            'HTTPX Client is synchronous and returns a Response with status, headers and content. For a response attached to its request, raise_for_status returns that response for a 2xx status and raises HTTPStatusError for non-2xx, including 1xx and 3xx as well as 4xx/5xx. A 204 passes this status check; a 301 does not. With default redirect behavior the 301 is not automatically followed. A later json call parses the content and can still fail on invalid or empty JSON, including a typical empty 204. AsyncClient uses await; this example uses Client.',
          competencies: ['python-reading'],
        },
      ],
    },
    {
  "id": "fde-v1-bridge-python-api-lesson-read",
  "kind": "lesson",
  "purpose": "diagnostic",
  "verification": "self_reviewed",
  "title": "Read: asynchronous API boundary",
  "summary": "Follow await, HTTP status handling and JSON reshaping in a FastAPI-shaped client.",
  "competencies": [
    "python-reading"
  ],
  "estimatedMinutes": 12,
  "lessonId": "fde-v1-bridge-python-api-lesson"
},

    {
  "id": "fde-v1-bridge-python-loader-lesson-read",
  "kind": "lesson",
  "purpose": "diagnostic",
  "verification": "self_reviewed",
  "title": "Read: bounded asynchronous loader",
  "summary": "Distinguish concurrency limits, result order and failure behavior in an authored batch.",
  "competencies": [
    "python-reading"
  ],
  "estimatedMinutes": 15,
  "lessonId": "fde-v1-bridge-python-loader-lesson"
},

    {
  "id": "fde-v1-bridge-python-api-client",
  "kind": "check",
  "purpose": "diagnostic",
  "verification": "machine_verified",
  "title": "Read an API client boundary",
  "summary": "Four authored Python reading questions. At the 80% threshold, all four must pass; no Python is executed.",
  "competencies": [
    "python-reading"
  ],
  "estimatedMinutes": 12,
  "passThreshold": 0.8,
  "questions": [
    {
      "id": "fde-v1-bridge-python-api-q1",
      "prompt": "Assume a successful JSON object with id and display_name. Which step obtains the dictionary returned by read_account?",
      "context": {
        "language": "python",
        "code": "from fastapi import FastAPI\nimport httpx\n\napp = FastAPI()\n\nasync def read_account(client: httpx.AsyncClient, account_id: int) -> dict:\n    response = await client.get(f\"/accounts/{account_id}\")\n    response.raise_for_status()\n    return response.json()\n\n@app.get(\"/accounts/{account_id}\")\nasync def account(account_id: int):\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        record = await read_account(client, account_id)\n    return {\"id\": record[\"id\"], \"name\": record[\"display_name\"]}\n"
      },
      "options": [
        "The annotation -> dict runs the helper and validates its result.",
        "Calling read_account alone executes all of its requests immediately.",
        "Awaiting read_account runs the coroutine and receives its returned value.",
        "The route decorator replaces every helper coroutine with a dictionary."
      ],
      "correct": 2,
      "explanation": "The explicit await obtains the helper result. A return annotation does not run or validate the body. Calling the async helper creates a coroutine; the FastAPI route decorator does not replace ordinary helper calls with their results.",
      "competencies": [
        "python-reading"
      ]
    },
    {
      "id": "fde-v1-bridge-python-api-q2",
      "prompt": "The upstream request returns HTTP 404. Which behavior follows from the displayed helper?",
      "context": {
        "language": "python",
        "code": "from fastapi import FastAPI\nimport httpx\n\napp = FastAPI()\n\nasync def read_account(client: httpx.AsyncClient, account_id: int) -> dict:\n    response = await client.get(f\"/accounts/{account_id}\")\n    response.raise_for_status()\n    return response.json()\n\n@app.get(\"/accounts/{account_id}\")\nasync def account(account_id: int):\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        record = await read_account(client, account_id)\n    return {\"id\": record[\"id\"], \"name\": record[\"display_name\"]}\n"
      },
      "options": [
        "It returns the error JSON and the route maps it as a normal account.",
        "raise_for_status raises before the helper returns a decoded account.",
        "HTTPX retries until the endpoint returns a successful account.",
        "FastAPI automatically turns this upstream response into the same HTTP 404 response."
      ],
      "correct": 1,
      "explanation": "Status validation raises before response.json is returned. This snippet has no retry loop or explicit upstream-to-route error mapping. You cannot infer the outward HTTP status without the application’s exception policy.",
      "competencies": [
        "python-reading"
      ]
    },
    {
      "id": "fde-v1-bridge-python-api-q3",
      "prompt": "The upstream returns 200 and JSON {\"id\": 7, \"name\": \"Cedar\"}, with no display_name. Which statement is supported?",
      "context": {
        "language": "python",
        "code": "from fastapi import FastAPI\nimport httpx\n\napp = FastAPI()\n\nasync def read_account(client: httpx.AsyncClient, account_id: int) -> dict:\n    response = await client.get(f\"/accounts/{account_id}\")\n    response.raise_for_status()\n    return response.json()\n\n@app.get(\"/accounts/{account_id}\")\nasync def account(account_id: int):\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        record = await read_account(client, account_id)\n    return {\"id\": record[\"id\"], \"name\": record[\"display_name\"]}\n"
      },
      "options": [
        "The -> dict annotation rejects the payload before read_account returns it.",
        "raise_for_status guarantees that every key the route reads exists in the body.",
        "HTTPX maps name to display_name to match the shape the route returns.",
        "The record[\"display_name\"] lookup fails; the snippet has no shape validation."
      ],
      "correct": 3,
      "explanation": "JSON decoding produces a value but does not enforce the dictionary shape expected by this route. The missing-key lookup fails. Neither the annotation nor HTTP status checking establishes the required keys, and HTTPX does not invent the rename.",
      "competencies": [
        "python-reading"
      ]
    },
    {
      "id": "fde-v1-bridge-python-api-q4",
      "prompt": "Which ownership and timing claim is justified by the displayed async-with block?",
      "context": {
        "language": "python",
        "code": "from fastapi import FastAPI\nimport httpx\n\napp = FastAPI()\n\nasync def read_account(client: httpx.AsyncClient, account_id: int) -> dict:\n    response = await client.get(f\"/accounts/{account_id}\")\n    response.raise_for_status()\n    return response.json()\n\n@app.get(\"/accounts/{account_id}\")\nasync def account(account_id: int):\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        record = await read_account(client, account_id)\n    return {\"id\": record[\"id\"], \"name\": record[\"display_name\"]}\n"
      },
      "options": [
        "The context closes the client on exit; timeout=5.0 does not set a whole-route deadline.",
        "The client stays open after the block so later requests to this route reuse its connection pool.",
        "A five-second network timeout bounds every failure, so retries and JSON validation are unnecessary.",
        "Declaring the route async def makes FastAPI run its synchronous work in a worker thread."
      ],
      "correct": 0,
      "explanation": "The context owns cleanup. HTTPX network timeouts do not by themselves establish a whole-route budget or validate payloads. This locally created client is not a persistent application-wide pool, and async does not move ordinary synchronous work to a thread.",
      "competencies": [
        "python-reading"
      ]
    }
  ]
},

    {
  "id": "fde-v1-bridge-python-async-loader",
  "kind": "check",
  "purpose": "diagnostic",
  "verification": "machine_verified",
  "title": "Read an asynchronous data loader",
  "summary": "Four authored Python reading questions on a bounded batch. At 80%, all four must pass; no Python is executed.",
  "competencies": [
    "python-reading"
  ],
  "estimatedMinutes": 12,
  "passThreshold": 0.8,
  "questions": [
    {
      "id": "fde-v1-bridge-python-loader-q1",
      "prompt": "For one invocation with ids [7, 3, 9, 4], what exactly does Semaphore(2) bound?",
      "context": {
        "language": "python",
        "code": "import asyncio\nimport httpx\n\nasync def load_accounts(ids: list[int]) -> list[dict]:\n    limit = asyncio.Semaphore(2)\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        async def read_one(account_id: int) -> dict:\n            async with limit:\n                response = await client.get(f\"/accounts/{account_id}\")\n                response.raise_for_status()\n                return response.json()\n        return await asyncio.gather(*(read_one(i) for i in ids))\n"
      },
      "options": [
        "All requests from every concurrent caller to at most two per second.",
        "At most two read_one calls in this invocation’s guarded region at a time.",
        "The total number of records returned, so two ids are discarded.",
        "The number of scheduled coroutines, so gather creates only two results."
      ],
      "correct": 1,
      "explanation": "The shared local semaphore bounds entry into its region. All four awaitables are submitted and can produce results. It does not establish a rate per second or share a limit with separate invocations.",
      "competencies": [
        "python-reading"
      ]
    },
    {
      "id": "fde-v1-bridge-python-loader-q2",
      "prompt": "All four reads succeed for ids [7, 3, 9, 4], but finish in order 3, 9, 4, 7. In which id order does gather return their bodies?",
      "context": {
        "language": "python",
        "code": "import asyncio\nimport httpx\n\nasync def load_accounts(ids: list[int]) -> list[dict]:\n    limit = asyncio.Semaphore(2)\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        async def read_one(account_id: int) -> dict:\n            async with limit:\n                response = await client.get(f\"/accounts/{account_id}\")\n                response.raise_for_status()\n                return response.json()\n        return await asyncio.gather(*(read_one(i) for i in ids))\n"
      },
      "options": [
        "3, 9, 4, 7, matching completion order.",
        "3, 4, 7, 9, because gather sorts numeric ids.",
        "7, 3, 9, 4, matching the input awaitables.",
        "7, 9 only, because the concurrency limit drops the others."
      ],
      "correct": 2,
      "explanation": "On success gather preserves the ordering of its supplied awaitables. Scheduling and completion order can differ. Neither sorting nor dropping work is present in this code.",
      "competencies": [
        "python-reading"
      ]
    },
    {
      "id": "fde-v1-bridge-python-loader-q3",
      "prompt": "One read raises while other submitted reads are still pending. Which guarantee must a reviewer refuse to infer from this default gather call?",
      "context": {
        "language": "python",
        "code": "import asyncio\nimport httpx\n\nasync def load_accounts(ids: list[int]) -> list[dict]:\n    limit = asyncio.Semaphore(2)\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        async def read_one(account_id: int) -> dict:\n            async with limit:\n                response = await client.get(f\"/accounts/{account_id}\")\n                response.raise_for_status()\n                return response.json()\n        return await asyncio.gather(*(read_one(i) for i in ids))\n"
      },
      "options": [
        "Every sibling is cancelled and settled before gather raises.",
        "The first raised exception is propagated to the awaiting caller.",
        "A request can fail at raise_for_status before it returns its body.",
        "The function needs a stated policy for unfinished work and cleanup."
      ],
      "correct": 0,
      "explanation": "Default gather propagates the first exception without automatically cancelling its other awaitables. Siblings may still be pending as the client context unwinds, so guaranteed cancellation and settlement need an explicit policy. The other statements follow from the displayed status check and failure behavior.",
      "competencies": [
        "python-reading"
      ]
    },
    {
      "id": "fde-v1-bridge-python-loader-q4",
      "prompt": "For ids [7, 3, 7], assuming all requests succeed, which property still needs a separate policy?",
      "context": {
        "language": "python",
        "code": "import asyncio\nimport httpx\n\nasync def load_accounts(ids: list[int]) -> list[dict]:\n    limit = asyncio.Semaphore(2)\n    async with httpx.AsyncClient(\n        base_url=\"https://crm.example.invalid\", timeout=5.0\n    ) as client:\n        async def read_one(account_id: int) -> dict:\n            async with limit:\n                response = await client.get(f\"/accounts/{account_id}\")\n                response.raise_for_status()\n                return response.json()\n        return await asyncio.gather(*(read_one(i) for i in ids))\n"
      },
      "options": [
        "The same id must be removed because a semaphore deduplicates inputs.",
        "The output must be sorted because AsyncClient normalizes result order.",
        "The second 7 must fail because HTTPX forbids repeated URLs in one client.",
        "Duplicate handling: the code schedules three reads and keeps both 7 results."
      ],
      "correct": 3,
      "explanation": "The generator creates one coroutine per input occurrence. Neither the semaphore nor the client deduplicates ids. A consumer must decide whether repeated records are wanted or need a separate identity and reconciliation policy.",
      "competencies": [
        "python-reading"
      ]
    }
  ]
},
  ],
  requires: [],
  optional: true,
};
