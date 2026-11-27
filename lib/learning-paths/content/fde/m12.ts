/** M12 — Production delivery.
 *
 * M07 produced a number that says whether the change helped. M08 produced a
 * handler that refuses to act on text it cannot trust. This module is the
 * week after both of them ship: the signal that shows the failure before a
 * customer does, the rollout that can be stopped, the trace that says which
 * dependency ate the request, and the rollback that leaves three things
 * behind.
 *
 * Two lessons, one four-question check, one graded retry-and-circuit helper.
 * The first lesson is about what logs, metrics and traces each answer, and
 * about working backwards from the failure you expect to the one signal that
 * would catch it. The second is about the incident: mitigate before you
 * diagnose, read the trace to the span holding the latency, and know what
 * redeploying the old build does not undo.
 *
 * One claim runs through both lessons and lands in the check: a health probe
 * that asserts a 200 proves the service answers, not that the answers are
 * right. The router failure this module keeps returning to is a 200 with a
 * shrug in it; the stated upper-latency/error monitors do not detect it.
 *
 * Everything the exercise touches is an authored fixture. `__dependency` in
 * the task harness replays a scripted list of outcomes and `sleep` runs on
 * the sandbox's virtual clock, so a 2 000 ms cooldown resolves instantly and
 * the recorded gaps still read 100, 200, 300. Nothing here opens a socket,
 * needs a key or calls a provider. Marlbrook Systems, its endpoints, its
 * release numbers and its trace ids are invented for this path; no real
 * customer data, credential or company appears in any of them. A fixture
 * dependency that fails on cue is evidence about this code on these inputs,
 * never a measurement of how a live service degrades. */

import type { ModuleSource } from '../../types';

/** The scripted dependency, the circuit builder and the two probes the
 * assertions read. Immutable helpers are supplied before learner declarations;
 * deferred instrumentation initializes before graded calls.
 *
 * A plan is one entry per call — `'o'` resolves, `'5'` rejects 503, `'t'`
 * rejects 429, `'4'` rejects 422, `'x'` rejects with no status at all, and a
 * number rejects with that status. When the plan runs out its last entry
 * repeats, so `'5'` alone means a dependency that never recovers and `'444o'`
 * means three refusals and then a working probe. `sleep` schedules through
 * `setTimeout`, which the sandbox runs on a virtual clock: the cooldown
 * finishes in microseconds and the recorded call times still show the gap, so
 * the same submission grades the same way on every run. */
const CIRCUIT_FIXTURES = `
var sleep = function (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

var __dependency = function (plan) {
  var steps = typeof plan === 'string' ? plan.split('') : plan;
  var dep = { calls: [], startedAt: Date.now() };
  dep.call = function (request) {
    var step = steps[Math.min(dep.calls.length, steps.length - 1)];
    dep.calls.push({ request: request, at: Date.now() - dep.startedAt, step: step });
    if (step === 'o') return Promise.resolve({ echo: request });
    if (step === 'x') return Promise.reject({ message: 'socket hang up' });
    if (step === 't') return Promise.reject({ status: 429, message: 'slow down' });
    if (step === '4') return Promise.reject({ status: 422, message: 'unprocessable entity' });
    if (step === '5') return Promise.reject({ status: 503, message: 'upstream unavailable' });
    return Promise.reject({ status: Number(step), message: 'status ' + step });
  };
  return dep;
};

var __circuit = function (dep, overrides) {
  var options = {
    call: dep.call,
    failureThreshold: 3,
    windowMs: 10000,
    cooldownMs: 2000,
    retries: 2,
    baseDelayMs: 100,
    maxDelayMs: 400
  };
  var extra = overrides || {};
  for (var key in extra) options[key] = extra[key];
  return createCircuit(options);
};

var __gaps = function (dep) {
  return dep.calls.map(function (entry, index) {
    return index === 0 ? 0 : entry.at - dep.calls[index - 1].at;
  });
};

var __drive = function (circuit, count, request) {
  var out = [];
  var step = function (index) {
    if (index >= count) return Promise.resolve(out);
    return circuit.send(request === undefined ? { id: 'R-' + index } : request).then(function (result) {
      out.push(result);
      return step(index + 1);
    });
  };
  return step(0);
};
`.trim();

export const FDE_M12: ModuleSource = {
  id: 'fde-v1-m12',
  title: 'Production delivery',
  outcomes: [
    'Say which of logs, metrics and traces answers a given question, and name what each one cannot tell you.',
    'Work backwards from the failure you expect to the one signal that would show it before a customer does, and say why a health probe asserting a 200 is not that signal.',
    'Write the abort condition for a staged rollout before the first stage opens, and give a stage enough traffic that it could fail.',
    'Read a trace down to the span holding the latency, and mitigate before you have the cause.',
    'Name what redeploying the old build leaves behind — a dropped column, a sent message, a consumed idempotency key — and run the review as a list of owned actions rather than a document.',
  ],
  competencies: ['operations'],
  dependsOn: ['fde-v1-m09', 'fde-v1-m10'],
  estimatedMinutes: 110,
  lessons: [
    {
      id: 'fde-v1-m09-l1',
      title: 'Observability and rollout',
      summary:
        'What logs, metrics and traces each answer, how to pick the one signal that would catch your own failure, and how to stage a release behind an abort condition you wrote down first.',
      estimatedMinutes: 25,
      sources: [
        {
          label: 'OpenTelemetry — Traces',
          url: 'https://opentelemetry.io/docs/concepts/signals/traces/',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'Google SRE Book — Service level objectives',
          url: 'https://sre.google/sre-book/service-level-objectives/',
          reviewedOn: '2026-09-08',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'Marlbrook’s triage router went out on a Tuesday. It answered every request, returned a 200 every time, and kept its p95 under half a second. Nine days later an operations lead mentioned that returns tickets had stopped landing in the returns queue. Nobody on the team could say when that started, because nothing they collected would have shown it. Three kinds of signal were available to them, and each answers a different question; picking the wrong one is how a team ends up with four dashboards and no answer.',
        },
        {
          kind: 'table',
          caption: 'The three signals, and the question each one is bad at.',
          headers: ['Signal', 'The question it answers', 'What it cannot tell you'],
          rows: [
            [
              'Logs',
              'What happened inside this one request, in whatever words the handler chose',
              'Whether it is happening more often than yesterday, until a query or log-based aggregation counts matching events',
            ],
            [
              'Metrics',
              'How often, how slow and how many, aggregated over the chosen instrumented population',
              'Usually not an individual request payload; exemplars/trace links can connect selected observations',
            ],
            [
              'Traces',
              'Where one request spent its time, span by span, across the services that propagated and recorded it',
              'Not necessarily the underlying cause; attributes/events and correlated telemetry may help',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            "Use structured event fields that answer operational questions: a request/trace correlation id, authorized tenant reference, release, actual flag branch, outcome and duration. Free-text logs can be searched, but stable fields make aggregation less ambiguous. Record outcome on failure paths too. IDs and tenant references can themselves be sensitive: minimize, restrict access and retention, and avoid high-cardinality metric labels unless the backend and cost policy support them.",
        },
        {
          kind: 'code',
          language: 'javascript',
          code: "// One line per request, emitted whatever the outcome was.\nlog.info({\n  event: 'triage.completed',\n  requestId: ctx.requestId,   // the same id the trace carries\n  tenantId: ctx.tenantId,\n  release: '2026-09-08.3',\n  variant: 'kb-lookup:on',    // which branch of the flag produced this row\n  outcome: 'abstained',       // routed | abstained | failed\n  slice: 'returns',\n  durationMs: 412,\n});",
          caption: 'What is missing matters as much as what is there: no ticket body, no retrieved article, no model output.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            "Logs can widen access and retention beyond the source system. This workbench policy excludes raw ticket bodies, retrieved article text and generated answers from routine operational logs. Use protected references and fetch content through authorized paths when needed. Other systems may retain carefully redacted content under an explicit approved policy; logging an id alone does not establish privacy.",
        },
        {
          kind: 'prose',
          body:
            "Metrics include counters, gauges and distributions. Label combinations drive time-series cardinality and cost; there is no universal tenant-count cutoff. Keep request ids out of ordinary metric labels and budget tenant/slice dimensions against the actual backend. Report relevant latency distributions alongside volume and errors. A mean of 400 ms cannot include 5% of requests taking 9 seconds with nonnegative remaining latencies: that tail alone contributes 450 ms. A valid comparison is all requests at 400 ms versus 95 at 0 ms and five at 8,000 ms per 100 requests. Both means are 400 ms but the tails differ. Define the SLI, target, window and error-budget policy before rollout; it is not unrestricted permission to spend reliability.",
        },
        {
          kind: 'prose',
          body:
            "A trace groups related spans under a trace id, often with parent-child relationships across instrumented services. Missing instrumentation, sampling or propagation can leave gaps. Durations and attributes help locate waiting and work, but nesting alone does not establish exclusive time: children can overlap or run asynchronously. Correlated logs and dependency metrics can also identify slow operations. Keep attributes purposeful and protect tenant and request identifiers.",
        },
        {
          kind: 'prose',
          body:
            "Name the failure and the signals that could reveal it. In this authored router incident, 40% of returns tickets receive a no-confident-queue response and go to manual review while HTTP responses remain 200. The stated upper latency/error/CPU monitors stay healthy. Abstention is not generally cheaper or faster; its cost and latency depend on work already done and the handoff. This case stipulates healthy operational monitors, not universal invisibility to every other monitor.",
        },
        {
          kind: 'prose',
          body:
            "A returns-slice abstention rate compared with a relevant baseline directly tracks this symptom. Define numerator, eligible denominator, observation window, minimum volume, threshold and alert delivery. A counter/division can implement the rate, but one hour of guaranteed detection cannot be inferred without traffic and evaluation timing. Investigate traffic and policy changes as well as code; abstention can be appropriate.",
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            "A fixture request returning HTTP 200 confirms that sampled endpoint response, not all service availability or semantic correctness. This failure also returned 200. An explicit expected-answer probe can test a bounded correctness case, while broader quality needs representative evidence. Detection cost and coverage depend on the actual check; correctness is not inherently the expensive half.",
        },
        {
          kind: 'prose',
          body:
            'Rollout is the other half. Send the change to 1% of traffic, then 5%, then 25%, then everything, and read the signal between stages. The value is not the caution; it is that each stage is a decision point where somebody can say no while the blast radius is still small.',
        },
        {
          kind: 'prose',
          body:
            'Write the abort condition down before the first stage opens, in numbers, with the baseline next to it. “Roll back if returns abstention passes 12%” is a sentence anybody on call can act on at two in the morning. “Roll back if it looks bad” is an argument you will have while the queue backs up, with the person who shipped the change in the room.',
        },
        {
          kind: 'trace',
          caption: 'Four stages, one abort condition written down in advance, and the stage that trips it.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['baseline · 2 weeks', 'error rate 0.3%', 'returns abstention 6%', 'abort above 12%'],
                marks: [{ index: 3, role: 'settled' }],
                note: 'Before anything ships, the team records the fortnight’s numbers and writes the abort condition beside them: roll back if returns abstention passes 12%. Nobody has to interpret that later.',
                counter: { label: 'Tickets on the new path', value: 0 },
              },
              {
                cells: ['stage 1% · 31 tickets', 'error rate 0.0%', 'returns abstention 3%', 'abort above 12%'],
                marks: [{ index: 0, role: 'active' }, { index: 2, role: 'excluded' }],
                note: 'All 31 first-stage tickets are returns tickets in this fixture; one abstention is 3.23%, displayed as 3%. One event moves the rate by about three points, so the displayed rounded rate is coarse. It is evidence about those requests, not enough by itself to establish release safety; the slice denominator must be retained with its rate.',
                counter: { label: 'Tickets on the new path', value: 31 },
              },
              {
                cells: ['stage 5% · 156 tickets', 'error rate 0.6%', 'returns abstention 7%', 'abort above 12%'],
                marks: [{ index: 0, role: 'active' }, { index: 2, role: 'compare' }],
                note: 'At this stage seven of 100 returns tickets abstain, among 156 total tickets; one overall error is about 0.6%. The 7% is below the agreed 12% operational threshold. Continuing is a policy decision, not proof of statistical equivalence to 6%; the total request count alone would not establish the slice sample size.',
                counter: { label: 'Tickets on the new path', value: 156 },
              },
              {
                cells: ['stage 25% · 790 tickets', 'error rate 0.5%', 'returns abstention 14%', 'abort above 12%'],
                marks: [{ index: 2, role: 'active' }, { index: 3, role: 'compare' }],
                note: 'At 25%, fourteen of 100 returns tickets abstain among 790 total tickets. The returns rate reaches 14% and crosses the line. The displayed error rate is still below its separate policy threshold and the latency is still fine, which is exactly why the abort condition was written against abstention instead.',
                counter: { label: 'Tickets on the new path', value: 790 },
              },
              {
                cells: ['flag off · 0 tickets', 'error rate 0.3%', 'returns abstention 6%', 'aborted at 14:52'],
                marks: [{ index: 3, role: 'settled' }],
                note: 'The flag goes off twelve minutes after the stage opened, the rates return to the baseline, and the investigation starts with 790 tickets of evidence and the prior workflow restored in this stipulated example. Re-check queued work and downstream impact; flag state alone does not prove recovery.',
                counter: { label: 'Tickets on the new path', value: 0 },
              },
            ],
          },
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            "At 1% of 200 requests per day, expected volume is only two requests per day, and a particular slice may have fewer. One abstention in two observations is 50% and can cross a 12% threshold; zero is 0%. Such small samples are coarse and highly uncertain, not unable to cross the line. Specify per-slice minimum counts, observation time and a response policy. Treat early stages as smoke tests when volume cannot support the intended quality inference.",
        },
      ],
    },
    {
      id: 'fde-v1-m09-l2',
      title: 'Incidents and rollback',
      summary:
        'Mitigating before you have the cause, reading a trace down to the dependency holding the latency, what a rollback cannot undo, and running the review as a mechanism instead of a document.',
      estimatedMinutes: 25,
      sources: [
        {
          label: 'Google SRE Book — Postmortem culture: learning from failure',
          url: 'https://sre.google/sre-book/postmortem-culture/',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'RFC 9110 — HTTP Semantics',
          url: 'https://www.rfc-editor.org/rfc/rfc9110',
          reviewedOn: '2026-09-08',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'Twenty minutes after release 2026-09-08.3, p95 on `POST /tickets/triage` goes from 400 ms to 8.9 seconds. Operators are watching a spinner, the queue is growing, and somebody has already asked in the channel whether it might be the database. You have two jobs and they compete: get the service working, and find out what broke it.',
        },
        {
          kind: 'prose',
          body:
            "Prioritize reducing current impact using a tested, authorized mitigation with understood consequences. A safe flag bypass may be preferable to redeploying incompatible old code. Preserve useful evidence when feasible and verify recovery in latency, errors and the fallback workflow. Some investigation may be needed to choose a safe mitigation; do not wait for a complete explanation when a suitable response is available. Changing state can remove reproduction opportunities even when retained logs and traces remain.",
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            "A longer timeout may reduce timeout errors while increasing resource occupancy; it does not itself reduce dependency latency and can be appropriate only with a capacity/deadline policy. Restarting may mitigate some failures but loses in-process evidence and may not address the cause. Neither recurrence within minutes nor worsening every incident is established by these actions alone. Choose from the actual failure and verify the effect.",
        },
        {
          kind: 'prose',
          body:
            "Inspect a representative slow trace and its span relationships. Under explicitly sequential, non-overlapping, fully observed synchronous children, subtract their durations from their parent to find time outside those children. Otherwise use timestamps and intervals, not a naive sum. A dominant duration identifies where this request waited; it need not reveal the root cause or explain the whole incident.",
        },
        {
          kind: 'trace',
          caption: 'A fixture with synchronous non-overlapping shown children. Durations locate waiting; omitted children and individual attempt timings remain unknown.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: [
                  'POST /tickets/triage · 8 940 ms',
                  'auth.verify · 12 ms',
                  'tickets.load · 31 ms',
                  'kb.search · 8 610 ms',
                  'kb.vector-query · 8 540 ms · 3 attempts',
                  'router.classify · 180 ms',
                  'tickets.write · 88 ms',
                ],
                note: 'One request, trace 7f21. The root took 8 940 ms and its children account for almost all of it. Read them, do not guess between them.',
              },
              {
                cells: [
                  'POST /tickets/triage · 8 940 ms',
                  'auth.verify · 12 ms',
                  'tickets.load · 31 ms',
                  'kb.search · 8 610 ms',
                  'kb.vector-query · 8 540 ms · 3 attempts',
                  'router.classify · 180 ms',
                  'tickets.write · 88 ms',
                ],
                marks: [{ index: 1, role: 'excluded' }, { index: 2, role: 'excluded' }],
                note: 'Auth and the ticket read cost 12 ms and 31 ms. Being first in the request does not make a span the cause; 43 ms cannot produce a nine-second page.',
              },
              {
                cells: [
                  'POST /tickets/triage · 8 940 ms',
                  'auth.verify · 12 ms',
                  'tickets.load · 31 ms',
                  'kb.search · 8 610 ms',
                  'kb.vector-query · 8 540 ms · 3 attempts',
                  'router.classify · 180 ms',
                  'tickets.write · 88 ms',
                ],
                marks: [{ index: 1, role: 'excluded' }, { index: 2, role: 'excluded' }, { index: 5, role: 'excluded' }, { index: 6, role: 'excluded' }],
                note: 'The model call is 180 ms and the write is 88 ms. Both are ruled out by arithmetic rather than by intuition, which matters because the model call is where everyone looks first.',
              },
              {
                cells: [
                  'POST /tickets/triage · 8 940 ms',
                  'auth.verify · 12 ms',
                  'tickets.load · 31 ms',
                  'kb.search · 8 610 ms',
                  'kb.vector-query · 8 540 ms · 3 attempts',
                  'router.classify · 180 ms',
                  'tickets.write · 88 ms',
                ],
                marks: [{ index: 3, role: 'active' }],
                note: 'That leaves kb.search at 8 610 ms, which is 96% of the request. It is not a leaf, so it is a location and not yet an answer.',
              },
              {
                cells: [
                  'POST /tickets/triage · 8 940 ms',
                  'auth.verify · 12 ms',
                  'tickets.load · 31 ms',
                  'kb.search · 8 610 ms',
                  'kb.vector-query · 8 540 ms · 3 attempts',
                  'router.classify · 180 ms',
                  'tickets.write · 88 ms',
                ],
                marks: [{ index: 3, role: 'compare' }, { index: 4, role: 'active' }],
                note: 'The displayed vector child holds 8,540 of 8,610 ms. Under the stated synchronous non-overlap model, 70 ms lies outside this shown child, which can include unshown work; it is not proven wrapper self-time.',
              },
              {
                cells: [
                  'POST /tickets/triage · 8 940 ms',
                  'auth.verify · 12 ms',
                  'tickets.load · 31 ms',
                  'kb.search · 8 610 ms',
                  'kb.vector-query · 8 540 ms · 3 attempts',
                  'router.classify · 180 ms',
                  'tickets.write · 88 ms',
                ],
                marks: [{ index: 4, role: 'settled' }],
                note: 'Three attempts are recorded. Their individual durations and waits are not shown, so the 8,540 ms total cannot establish three equal 2.8-second calls. Retries add dependency calls; aggregate traffic amplification depends on affected requests and concurrent callers.',
              },
              {
                cells: [
                  'POST /tickets/triage · 8 940 ms',
                  'auth.verify · 12 ms',
                  'tickets.load · 31 ms',
                  'kb.search · 8 610 ms',
                  'kb.vector-query · 8 540 ms · 3 attempts',
                  'router.classify · 180 ms',
                  'tickets.write · 88 ms',
                ],
                marks: [{ index: 4, role: 'settled' }],
                note: 'The trace names where the time went. It does not say why the vector store slowed down, and the mitigation did not wait for that answer.',
              },
            ],
          },
        },
        {
          kind: 'code',
          language: 'javascript',
          code: "// Separate assumed failure scenario, not the trace timings.\nconst attemptMs = 2800; // every attempt fails after 2.8 seconds\nconst backoffMs = [0, 400, 800]; // waits before attempts 1, 2 and 3\nconst spent = backoffMs.reduce((total, wait) => total + wait, 0) + attemptMs * 3;\n// 1,200 + 8,400 = 9,600 ms. Each affected request makes three calls.\n// This is not a measured global traffic rate or a policy for unsafe replay.",
          caption: 'A separate three-total-attempt illustration: 3 × 2,800 + 400 + 800 = 9,600 ms. It is not the 8,540 ms operation in the trace; retries must be triggered by failures, not slowness alone.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            "The exercise combines a bounded retry policy and a circuit breaker. Backoff spaces attempts but does not by itself enforce a global rate/concurrency budget. An open circuit refuses new sends through that instance; already in-flight calls and other instances may still reach the dependency. This fixture admits one half-open probe, while real systems can choose other policies. Opening can reduce load but does not guarantee recovery.",
        },
        {
          kind: 'prose',
          body:
            "Retry only when the operation can safely be repeated and the deadline/load budget permits it. RFC 9110 distinguishes status classes and idempotent methods; it does not say every 4xx will always repeat unchanged. For example, authentication can change and 408 permits repeating a request. A 429 can include Retry-After. A 5xx or transport failure does not by itself make a non-idempotent effect safe to replay. The exercise uses an explicitly synthetic status-only policy over a safe replay fixture; production needs the actual operation/provider contract, timeout handling, jitter and deadline budgets.",
        },
        {
          kind: 'prose',
          body:
            "In this scenario rollback redeploys only the previous application artifact. No schema rollback, data restore or compensating external operation runs automatically. Other deployment systems can include those steps explicitly. Verify old-code compatibility before using this mitigation.",
        },
        {
          kind: 'table',
          caption: 'Release 2026-09-08.3, and what redeploying the previous build does to each part of it.',
          headers: ['What the release did', 'What the rollback restores', 'What is still there afterwards'],
          rows: [
            [
              'Deployed new handler code',
              'The previous artifact on instances once rollout completes; in-flight/new-version work may remain',
              'Nothing. This is the part a rollback is for',
            ],
            [
              'Ran a migration that dropped `tickets.legacy_queue`',
              'Nothing about the schema',
              'The column is gone, and the old build queries a table that no longer has it',
            ],
            [
              'Wrote 6 200 rows in the new shape',
              'The old writer',
              'Every row already written, which the old reader may not parse',
            ],
            [
              'Sent 4 100 “your ticket has moved” emails',
              'Nothing',
              'Delivered emails are not recalled by code rollback; further communication follows the incident policy',
            ],
            [
              'Consumed idempotency keys at the billing partner',
              'Nothing',
              'Under this stipulated retained-key contract the partner replays the recorded result; real matching/retention rules vary',
            ],
          ],
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            "An expand/migrate/contract sequence can preserve compatibility: add fields, make readers/writers compatible, backfill and validate, then retire old fields only after deployed and rollback-supported versions no longer require them. Dual writing needs consistency/failure handling. Dropping a column is not automatically reversible, and preserving schema shape does not guarantee that old readers understand new data.",
        },
        {
          kind: 'prose',
          body:
            'Then the review. The SRE Book’s postmortem chapter makes two demands that are easy to quote and hard to keep: write it without blaming a person, and give it a life beyond the document. The first is not politeness. An engineer who expects to be named as the cause will describe what happened less precisely, and you lose the detail you called the meeting for.',
        },
        {
          kind: 'prose',
          body:
            "Turn the review into tracked actions with a specific owner, due date, priority and verification of completion. A short list can be easier to deliver, but neither three completed actions nor failure of a twelve-item list follows from list length alone. Consider detection, mitigation and prevention, and check whether each action reduces the observed risk.",
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'The check and the exercise in this module grade decisions and code against fixtures written for them. A passing circuit here says your implementation handles these scripted failures; it is not a statement about your service, and no exercise on this path can make one. What it does give you is a helper whose behaviour you can describe precisely when somebody asks what happens when the dependency goes away.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m09-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: observability and rollout',
      summary: 'Signal coverage and privacy, metric denominators, slice volume and a staged rollout governed by explicit response policy.',
      competencies: ['operations'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m09-l1',
    },
    {
      id: 'fde-v1-m09-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: incidents and rollback',
      summary: 'Choose and verify a safe mitigation, interpret span timing assumptions and distinguish code-only rollback from external recovery.',
      competencies: ['operations'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m09-l2',
    },
    {
      id: 'fde-v1-m09-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Incident and rollout checks',
      summary: 'Four bounded incident decisions: interpret inclusive trace timing, use a tested mitigation, identify code-only rollback limits and monitor slice abstention.',
      competencies: ['operations'],
      estimatedMinutes: 15,
      passThreshold: 0.8,
      questions: [
        {
          id: "fde-v1-m09-q1",
          prompt: "This triage trace shows total elapsed durations, including children. Assume the shown synchronous children run sequentially without overlap and the endpoint waits for each. Which shown operation dominates this request?",
          context: {"language": "text", "code": "POST /tickets/triage            trace 7f21        8 940 ms\n├─ auth.verify                                        12 ms\n├─ tickets.load                                       31 ms\n├─ kb.search                                       8 610 ms\n│  ├─ kb.embed                                        44 ms\n│  └─ kb.vector-query          3 attempts          8 540 ms\n├─ router.classify                                   180 ms\n└─ tickets.write                                      88 ms"},
          options: [
            "kb.vector-query: its 8,540 ms covers most of the 8,940 ms request.",
            "router.classify: every external model call must dominate retrieval time.",
            "auth.verify: running first makes its duration include all later work.",
            "tickets.write: running last makes its duration include all earlier work.",
          ],
          correct: 0,
          explanation: "The vector-query operation accounts for about 95.5% of this request under the stated timing model. Its three attempts show retrying, not the duration or cause of any individual attempt. The search span includes its 44 ms embed child and 8,540 ms vector child: 8,610 − 44 − 8,540 = 26 ms remains outside those children. The endpoint children sum to 8,921 ms, leaving 19 ms outside them. Total span duration includes children, not time spent before a span started. One trace identifies where this request waited; broader traces and dependency telemetry are needed to diagnose the incident.",
          competencies: ['operations'],
        },
        {
          id: "fde-v1-m09-q2",
          prompt: "Triage p95 is 8.9 s after a release added a knowledge-base lookup. Operators are waiting. A tested flag safely bypasses this lookup and restores the prior manual workflow; incident policy allows using it. Traces and logs from the affected window are retained. What is the best immediate mitigation?",
          options: [
            "Wait for a complete root-cause explanation before changing the affected workflow.",
            "Disable the lookup, verify service recovery, then investigate the retained evidence.",
            "Raise the client timeout to 15 s and assume the long-running dependency is repaired.",
            "Restart every instance and assume the release no longer needs investigation.",
          ],
          correct: 1,
          explanation: "The stated safe bypass offers a bounded way to reduce current impact. Verify latency, errors and the manual workflow after disabling it; recovery is not guaranteed merely because the flag changed. Retained evidence supports later diagnosis, but mitigation can change live state or remove opportunities to reproduce the fault, so preserve useful evidence when feasible. A longer timeout does not itself shorten dependency work. Restarting may sometimes help, but this scenario provides no reason to prefer it to the tested bypass, and does not establish that symptoms must return within minutes.",
          competencies: ['operations'],
        },
        {
          id: "fde-v1-m09-q3",
          prompt: "A release dropped tickets.legacy_queue, delivered 4,100 notification emails and recorded billing-partner idempotency keys. The partner retains those keys through this incident. You now redeploy only the prior application artifact: no migration rollback, data restore or compensating partner operation runs. Which state is reversed automatically by this action?",
          options: [
            "The missing column is restored because the prior code predates its removal.",
            "The delivered messages are recalled because their sending code no longer runs.",
            "None of these three external effects is automatically reversed.",
            "The partner keys are released because the application artifact changed.",
          ],
          correct: 2,
          explanation: "This explicitly code-only deployment does not restore the dropped column, recall delivered messages or clear retained partner records. Old code that still requires the removed column can fail; whether it does depends on what it executes. Delivery does not prove that all 4,100 messages were read. A partner may replay a recorded response according to its own idempotency contract; key lifetime and request-matching rules are not universal. Other deployment systems can include explicit migration or compensation steps, but none runs in this scenario.",
          competencies: ['operations'],
        },
        {
          id: "fde-v1-m09-q4",
          prompt: "Returns-ticket abstention rises from a stable 10% baseline to 40% after release. Each daily slice has enough reviewed volume for the agreed alert rule: alert above 20%. Responses remain HTTP 200, p95 stays below its upper limit, and CPU is unchanged. Which monitor directly detects this quality regression?",
          options: [
            "An alert only when triage 5xx responses exceed their existing limit.",
            "An alert only when triage p95 exceeds its existing upper limit.",
            "A probe that checks only whether a fixture request returns HTTP 200.",
            "The daily returns-slice abstention rate against the agreed 20% limit.",
          ],
          correct: 3,
          explanation: "The stated 40% abstention exceeds the 20% rule, while the other monitors check conditions that remain healthy here. This identifies a relevant quality signal, not a guaranteed earliest detector across every possible monitor. Abstention may be appropriate for difficult inputs; a change requires investigation of traffic, labels and policy rather than assuming every handoff is an error. Faster responses do not generally imply abstention is cheaper, and HTTP 200 alone establishes neither routing correctness nor useful automation.",
          competencies: ['operations'],
        },
      ],
    },
    {
      id: 'fde-v1-m09-retry-circuit',
      kind: 'code',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Bounded retries and a circuit that opens',
      summary:
        'Wrap a scripted dependency in capped exponential backoff and a circuit that opens after consecutive failures, refuses without calling through, and admits exactly one probe after the cooldown.',
      competencies: ['operations'],
      estimatedMinutes: 45,
      code: {
        language: 'javascript',
        prompt:
          'In this synthetic scenario, each affected dependency request fails repeatedly and can be called three times in total. Retries add load while the store is struggling. Write the bounded retry/circuit helper; it does not by itself establish a global traffic limit or service recovery.\n\n`createCircuit(options)` returns `{ send, state }`. `options` carries `call`, `failureThreshold`, `windowMs`, `cooldownMs`, `retries`, `baseDelayMs` and `maxDelayMs`. `call(request)` may throw synchronously or return a settling promise; a rejection may carry a numeric `status`.\n\n**`send(request)`** returns a promise that always resolves, never rejects, with one of three shapes:\n\n- `{ ok: true, value, attempts }` — `value` is what `call` resolved with.\n- `{ ok: false, reason: \'failed\', status, attempts }` — `status` is the numeric `status` of the last rejection, or `null` when it carried none.\n- `{ ok: false, reason: \'circuit-open\', attempts: 0 }` — refused without calling through.\n\n`attempts` counts the calls this `send` made to `call`.\n\n**Retrying, while the circuit is closed.** A rejection is retryable when its `status` is 429, when its `status` is 500 or above, or when it carries no numeric `status` at all. This exercise’s policy does not retry any other numeric status: one call, then give up. That is a fixture rule, not a universal HTTP retry rule. A retryable failure waits `Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)` milliseconds with `await sleep(...)` and tries again, for at most `retries` retries — so `retries: 2` means three calls at most, with waits of `baseDelayMs` and `2 × baseDelayMs`, each capped at `maxDelayMs`.\n\n**Opening.** A whole `send` that ends `ok: false, reason: \'failed\'` counts as one failure, however many attempts it made. Count consecutive failures: when a failure arrives more than `windowMs` after the previous one, the streak restarts at 1 instead of continuing. A successful `send` clears the count. Reaching `failureThreshold` opens the circuit and starts the cooldown. A refused `send` is not a failure and never touches the count.\n\n**Open, and the probe.** While the circuit is open, `send` returns `circuit-open` immediately and `call` is not invoked at all. Once `cooldownMs` has passed since it opened, the circuit is half-open: the next `send` is the probe, and it is exactly one call with no retries. Any other `send` arriving while that probe is in flight is refused. A probe that resolves closes the circuit and clears the failure count; a probe that rejects re-opens it and restarts the cooldown from that moment.\n\nDomain: options are trusted immutable configuration: failureThreshold is an integer from 1 to 100; retries is an integer from 0 to 8; windowMs, cooldownMs, baseDelayMs and maxDelayMs are integer durations from 0 to 100,000. Status values, when present, are finite integers from 100 to 599; errors can also be null, primitives or ordinary objects with no numeric status. call may throw synchronously or settle a promise, and settles within the sandbox budget; sleep resolves. Requests/results are opaque values forwarded unchanged. Closed-state sends are sequential: only half-open sends overlap in this exercise. Do not mutate configuration or requests. Multiple already in-flight closed sends, cancellation, distributed coordination and real request deadlines are outside this contract. There is no single input-size target for this stateful helper; its per-send attempt budget is explicit.\n\n**`state()`** returns `\'closed\'`, `\'open\'` or `\'half-open\'` — `\'half-open\'` meaning the cooldown has passed and the next `send` will be the probe.\n\nThe helper sleep and __dependency/__circuit/__gaps/__drive APIs are immutable harness helpers available before declarations, with deferred instrumentation initialized before graded calls. Do not redefine them.\n\nThe dependency is a fixture written for this exercise, not a live service. `sleep` runs on the sandbox’s virtual clock, so a 2 000 ms cooldown finishes instantly and the recorded gaps between calls still read 100, 200 and 300. Nothing here opens a network connection, and a fixture that fails on cue tells you about this code on these inputs rather than about how a real store degrades.',
        contract: [
          '`options.call` is the only way to reach the dependency, and it must not be called at all while the circuit is open.',
          'The half-open probe is exactly one call. It does not retry, whatever the rejection says.',
          'Retry only a rejection with `status` 429, `status` 500 or above, or no numeric `status`. Every other 4xx gets one call.',
          'Wait with `await sleep(ms)` from the task harness. Do not define your own and do not use real timers.',
          'Keep every counter, timestamp and flag inside `createCircuit`, so two circuits over the same dependency stay independent.',
          '`send` always resolves. Report a failure in the returned object rather than rejecting.',
        ],
        starter: `const createCircuit = options => {

};

// Scratch pad — change this before submitting.
const demo = createCircuit({
  call: () => Promise.resolve('routed'),
  failureThreshold: 3,
  windowMs: 10000,
  cooldownMs: 2000,
  retries: 2,
  baseDelayMs: 100,
  maxDelayMs: 400,
});
console.log(demo ? 'built' : 'createCircuit has not returned anything yet');
`,
        skeleton: `const createCircuit = options => {
  let phase = 'closed';
  let failures = 0;
  let lastFailureAt = null;
  let openedAt = 0;
  let probeInFlight = false;

  const statusOf = error => /* the numeric status, or null */;
  const retryable = error => /* 429, 5xx, or no status at all */;

  const state = () => {
    // 'half-open' once the cooldown has passed, otherwise whatever phase holds
  };

  const recordFailure = () => {
    // restart the streak when the previous failure is older than windowMs
    // open, and stamp openedAt, once the streak reaches failureThreshold
  };

  const send = async request => {
    const current = state();
    if (current === 'open') return { ok: false, reason: 'circuit-open', attempts: 0 };

    if (current === 'half-open') {
      // refuse when a probe is already in flight, otherwise claim the slot
      // exactly one call: resolve closes the circuit, reject re-opens it
    }

    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        /* call through, clear the failure count, return the value */
      } catch (error) {
        // stop on a non-retryable error or a spent budget
        // otherwise await sleep(the capped backoff) and go round again
      }
    }
  };

  return { send, state };
};`,
        hints: [
          'Keep the phase in one variable and let `state()` do the cooldown arithmetic: if the phase is `open` and `Date.now() - openedAt >= cooldownMs`, report `half-open`. Then `send` reads `state()` once at the top and never has to check the clock again.',
          'Claim the probe slot synchronously. Set `probeInFlight = true` before the `await`, so a second `send` that starts while the probe is still running sees the flag and is refused. If the first thing your half-open branch does is await, both sends get through.',
          'Backoff for attempt `n` is `Math.min(baseDelayMs * 2 ** (n - 1), maxDelayMs)`: 100, 200, 400, 400 with a base of 100 and a cap of 400. Compute it after the failure, using the attempt that just failed.',
        ],
        approach: [
          'Write `statusOf(error)` returning `error.status` when it is a number and `null` otherwise, then `retryable(error)` on top of it: true for `null`, true for 429, true for 500 and above, false for everything else.',
          'Write `state()` so it reports `half-open` when the phase is `open` and the cooldown has elapsed, and write a small `open()` that sets the phase, stamps `openedAt` and clears the failure count.',
          'Give `send` the three branches in order: refuse when `state()` is `open`; run the single probe when it is `half-open` and no probe is in flight; otherwise fall through to the retry loop.',
          'In the retry loop, count the attempt, call through, and on a rejection stop when the error is not retryable or the attempt has used the budget. Otherwise `await sleep(...)` with the capped delay.',
          'On the way out, clear the failure count after a success and call `recordFailure()` after a failure, comparing `Date.now() - lastFailureAt` against `windowMs` to decide whether the streak continues or restarts.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'Correct outcomes, attempt counts and capped backoff',
            critical: true,
            weight: 3,
            detail:
              'The result shape, the retry budget or the delay is off. Check that `send` always resolves, that `attempts` counts the calls this send made, that `retries: 2` means three calls at most, that the delay is `Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)` and stops growing at the cap, and that a rejection carrying no numeric status reports `status: null`.',
          },
          {
            id: 'open-refuses-fast',
            label: 'An open circuit refuses without calling the dependency',
            critical: true,
            weight: 2,
            detail:
              'A call reached the dependency while the circuit was open. The whole point of opening is to take load off something that is already failing, so the refusal has to happen before `options.call` is invoked: check the state at the top of `send`, return `{ ok: false, reason: \'circuit-open\', attempts: 0 }`, and leave the failure count untouched.',
          },
          {
            id: 'single-probe',
            label: 'Half-open admits exactly one probe',
            critical: true,
            weight: 2,
            detail:
              'More than one call went through after the cooldown, or the probe retried. A half-open circuit is asking one question of a dependency that just failed, so it is one call with no retries: claim the slot synchronously before the first `await`, refuse anything that arrives while it is in flight, close on a resolve, and re-open with a fresh `openedAt` on a reject.',
          },
          {
            id: 'no-retry-on-4xx',
            label: 'Fixture statuses outside the retryable set are called once',
            critical: true,
            weight: 2,
            detail:
              'A 4xx that is not 429 was retried, or a retryable rejection was not. Under this synthetic status policy, retry only the stated set; real HTTP retry safety depends on request semantics and current conditions. Retry only 429, 500 and above, and rejections with no numeric status; give every other 4xx exactly one call.',
          },
        ],
        tests: [
          {
            call:
              "(function () { var d = __dependency('o'); var c = __circuit(d); return c.send({ id: 'R-1' }).then(function (out) { return { ok: out.ok, value: out.value, attempts: out.attempts, calls: d.calls.length, state: c.state() }; }); })()",
            expected: { ok: true, value: { echo: { id: 'R-1' } }, attempts: 1, calls: 1, state: 'closed' },
            label: 'a healthy call passes straight through',
            async: true,
          },
          {
            call:
              "(function () { var d = __dependency('5o'); var c = __circuit(d); return c.send({ id: 'R-2' }).then(function (out) { return { ok: out.ok, attempts: out.attempts, calls: d.calls.length }; }); })()",
            expected: { ok: true, attempts: 2, calls: 2 },
            label: 'a 503 recovers on the second attempt',
            async: true,
          },
          {
            call:
              "(function () { var d = __dependency('5'); var c = __circuit(d); return c.send({ id: 'R-3' }).then(function (out) { return { ok: out.ok, reason: out.reason, status: out.status, attempts: out.attempts, calls: d.calls.length }; }); })()",
            expected: { ok: false, reason: 'failed', status: 503, attempts: 3, calls: 3 },
            label: 'two retries and no more: three calls, then it gives up',
            async: true,
          },
          {
            call:
              "(function () { var d = __dependency('5'); var c = __circuit(d, { retries: 4, baseDelayMs: 100, maxDelayMs: 300 }); return c.send({ id: 'R-4' }).then(function () { return __gaps(d); }); })()",
            expected: [0, 100, 200, 300, 300],
            label: 'the backoff doubles and then stops at the cap',
            async: true,
          },
          {
            call:
              "(function () { var d = __dependency('4'); var c = __circuit(d); return c.send({ id: 'R-5' }).then(function (out) { return { ok: out.ok, status: out.status, attempts: out.attempts, calls: d.calls.length }; }); })()",
            expected: { ok: false, status: 422, attempts: 1, calls: 1 },
            label: 'the fixture policy calls a 422 once',
            edge: true,
            async: true,
            criterion: 'no-retry-on-4xx',
          },
          {
            call:
              "(function () { var d = __dependency('tto'); var c = __circuit(d); return c.send({ id: 'R-6' }).then(function (out) { return { ok: out.ok, attempts: out.attempts, calls: d.calls.length }; }); })()",
            expected: { ok: true, attempts: 3, calls: 3 },
            label: '429 is the 4xx that is retried',
            edge: true,
            async: true,
            criterion: 'no-retry-on-4xx',
          },
          {
            call:
              "(function () { var d = __dependency('4'); var c = __circuit(d); return __drive(c, 4).then(function (out) { return { state: c.state(), reason: out[3].reason, attempts: out[3].attempts, calls: d.calls.length }; }); })()",
            expected: { state: 'open', reason: 'circuit-open', attempts: 0, calls: 3 },
            label: 'three failed sends open the circuit, and the fourth never reaches the dependency',
            async: true,
            criterion: 'open-refuses-fast',
          },
          {
            call:
              "(function () { var d = __dependency('444o'); var c = __circuit(d); return __drive(c, 3).then(function () { return sleep(2000); }).then(function () { return Promise.all([c.send({ id: 'P' }), c.send({ id: 'Q' })]); }).then(function (out) { return { probe: out[0].ok, beside: out[1].reason, calls: d.calls.length, state: c.state() }; }); })()",
            expected: { probe: true, beside: 'circuit-open', calls: 4, state: 'closed' },
            label: 'half-open admits the probe and refuses the send beside it',
            async: true,
            criterion: 'single-probe',
          },
          {
            call:
              "(function () { var d = __dependency('4445'); var c = __circuit(d); return __drive(c, 3).then(function () { return sleep(2000); }).then(function () { return c.send({ id: 'P' }); }).then(function (probe) { return c.send({ id: 'Q' }).then(function (after) { return { probeAttempts: probe.attempts, state: c.state(), afterReason: after.reason, calls: d.calls.length }; }); }); })()",
            expected: { probeAttempts: 1, state: 'open', afterReason: 'circuit-open', calls: 4 },
            label: 'a failed probe is one call, re-opens the circuit and restarts the cooldown',
            edge: true,
            async: true,
            criterion: 'single-probe',
          },
        ],
        harness: CIRCUIT_FIXTURES,
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m09-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m09-retry-circuit', state: 'verified_pass' },
  ],
};
