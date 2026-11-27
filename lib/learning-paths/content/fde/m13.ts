/** M13 — Adoption and handoff.
 *
 * M09 got the thing running and gave you a way back when it broke. This
 * module is about the two people who inherit it: the operator who has to
 * press Approve on something a model proposed, and the on-call engineer who
 * opens your runbook at three in the morning having never seen the service.
 *
 * Two lessons, one four-question check, one graded exercise and three written
 * artifacts. The first lesson is the operator's screen: the four questions
 * an approval has to answer, and the states a happy-path demo never shows.
 * The second is acceptance, the demo, the runbook, the workshop that leaves
 * the customer's team able to maintain the thing, the written push-back on a
 * feature that will not move the customer's number, and the one recurring
 * need worth taking back to a product team.
 *
 * The three artifacts (runbook, workshop outline, push-back email) are
 * recorded as self-reviewed: the server confirms each required field is
 * present and inside its cap, nothing more. The module requires all three,
 * so guided completion waits for them. Their scenarios are fixtures stated in
 * each brief. The practitioner sources (Qureshi, The Pragmatic Engineer,
 * PostHog, and the Vercel posting) were read in October 2026 and
 * are cited for what they say, never as a hiring standard.
 *
 * This file becomes M13 when B9 renumbers the manifest; its id stays
 * `fde-v1-m10` until then, and every activity id keeps the v1 prefix.
 *
 * Two claims are repeated on purpose. A cancel stops the screen from acting
 * on an answer; it does not un-send a request that already left the browser,
 * and pretending otherwise is where the reconciliation bugs come from. And a
 * length check on a status message proves the message exists, which is not
 * the same as proving an operator can act on it — the exercise says so in the
 * criterion detail rather than letting the pass imply more than it earned.
 *
 * Everything the exercise touches is an authored fixture. `__fixture` in the
 * task harness builds a ticket proposal, two citations, a recording approval
 * endpoint and a recording live region; nothing calls a provider, needs a key
 * or opens a socket. Marlbrook Systems, ticket MB-3312, Northgate Dairy and
 * the `marlbrook.example` hostnames are invented for this path. No real
 * customer data, credential, company or person appears in any of it. */

import type { ModuleSource } from '../../types';

/** The proposal, the citations and the two recording dependencies the
 * operator-session exercise is graded against. Immutable helpers are provided
 * before learner declarations; deferred instrumentation initializes before calls.
 *
 * Delays run on the sandbox's virtual clock, so a 300 ms answer that arrives
 * after a 50 ms one finishes instantly and orders the same way on every run.
 * `__drain` waits past every fixture delay, which is how an assertion can ask
 * what the screen looked like once a late answer had its chance to land.
 * `__view` reads only the fields the grade covers, so a learner may keep
 * extra state without failing; `__voice` grades the live-region messages on
 * their own, because that criterion is not critical and must not be able to
 * drag the rest of the state down with it. */
const OPERATOR_FIXTURE = `
var __CITATIONS = [
  { id: 'KB-118', title: 'Refunds for duplicated invoices', url: 'https://kb.marlbrook.example/KB-118' },
  { id: 'TCK-3312-note-2', title: 'Operator note, 4 March', url: 'https://desk.marlbrook.example/TCK-3312#note-2' }
];
var __fixture = function (options) {
  var opts = options || {};
  var announcements = [];
  var submissions = [];
  var loads = [];
  var delayFor = function (index) {
    if (opts.loadDelays && opts.loadDelays.length > index) return opts.loadDelays[index];
    return opts.loadDelay === undefined ? 50 : opts.loadDelay;
  };
  var deps = {
    loadProposal: function (ticketId) {
      var index = loads.length;
      loads.push(ticketId);
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (opts.loadFails) { reject(new Error(opts.loadFails)); return; }
          resolve({
            proposal: {
              ticketId: ticketId,
              revision: opts.revision === undefined ? 7 : opts.revision,
              action: 'refund',
              amountCents: 4200,
              summary: 'Refund the duplicated March invoice for Northgate Dairy.'
            },
            citations: __CITATIONS.map(function (one) { return { id: one.id, title: one.title, url: one.url }; }),
            warnings: (opts.warnings || []).slice()
          });
        }, delayFor(index));
      });
    },
    submitApproval: function (request) {
      submissions.push(request);
      var receipt = 'RCP-' + submissions.length;
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (opts.approveFails) { reject(new Error(opts.approveFails)); return; }
          resolve({ receiptId: receipt });
        }, opts.approveDelay === undefined ? 50 : opts.approveDelay);
      });
    },
    announce: function (message) { announcements.push(message); }
  };
  return { deps: deps, announcements: announcements, submissions: submissions, loads: loads };
};
var __drain = function () { return new Promise(function (resolve) { setTimeout(resolve, 1000); }); };
var __go = function (value) {
  if (value && typeof value.then === 'function') value.then(function () {}, function () {});
  return value;
};
var __view = function (state) {
  var current = state || {};
  var proposal = current.proposal || null;
  return {
    status: current.status === undefined ? null : current.status,
    ticketId: current.ticketId === undefined ? null : current.ticketId,
    proposalTicket: proposal ? proposal.ticketId : null,
    revision: proposal ? proposal.revision : null,
    citations: (current.citations || []).map(function (one) { return one.id; }),
    warnings: (current.warnings || []).slice(),
    superseded: current.superseded === true,
    receiptId: current.receiptId === undefined ? null : current.receiptId,
    error: current.error === undefined ? null : current.error
  };
};
var __voice = function (fixture, session) {
  var spoken = fixture.announcements;
  var message = session.getState().statusMessage;
  return {
    count: spoken.length,
    allText: spoken.every(function (one) { return typeof one === 'string' && one.trim().length > 0; }),
    matchesState: typeof message === 'string' && message.trim().length > 0 && message === spoken[spoken.length - 1]
  };
};
`.trim();

export const FDE_M13: ModuleSource = {
  id: 'fde-v1-m13',
  title: 'Adoption and handoff',
  outcomes: [
    'Build an approval screen around the four questions an operator has to answer before pressing the button: what will happen, what it rests on, whether that basis is still current, and how to stop it.',
    'Handle loading, partial failure, retry, an openable citation and a cancel that abandons the in-flight request, so a late answer cannot overwrite a newer state.',
    'Announce every change of state where a screen reader will read it, and say what a check on those messages proves and what it leaves to your own review.',
    'Run a UAT that can end in a rejection, against acceptance conditions written before anybody sat down, and record accept, accept-with-conditions or reject with the numbers behind it.',
    'Write the runbook an on-call engineer can follow at three in the morning: the trigger, the steps with a signal after each, the rollback and what it cannot undo, and the owner.',
    'Plan a workshop backwards from one task the customer’s team must do alone after you leave, with a hands-on exercise and a check you can both observe.',
    'Push back in writing on a feature that will not move the customer’s number: restate the request, name the need behind it with evidence, offer the alternative and ask for one decision.',
    'Turn one recurring customer need into product input you can state without naming the customer.',
  ],
  competencies: ['handoff'],
  dependsOn: ['fde-v1-m12'],
  estimatedMinutes: 230,
  lessons: [
    {
      id: 'fde-v1-m10-l1',
      title: 'The operator’s screen',
      summary:
        'What an operator needs before an approval means anything, the states a happy-path demo never shows, and why the status message is part of the build rather than a later accessibility pass.',
      estimatedMinutes: 25,
      sources: [
        {
          label: 'MDN — aria-live',
          url: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-live',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'MDN — AbortController',
          url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
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
            'An operator presses Approve and a refund leaves Marlbrook’s account. For that press to mean anything, four questions have to be answered on the screen in front of them: what is about to happen, what it was drawn from, whether that basis is still true, and how to stop it. Miss any one and you have a button that transfers responsibility without transferring the information that responsibility needs.',
        },
        {
          kind: 'table',
          caption: 'The four questions, what answers each on the screen, and the shortcut a demo usually takes instead.',
          headers: ['Question', 'What answers it', 'The demo shortcut'],
          rows: [
            [
              'What will happen?',
              'The action and its parameters in the operator’s own words: refund, EUR 42.00, invoice INV-2291, Northgate Dairy',
              'A paragraph of generated prose that describes the action without committing to the numbers',
            ],
            [
              'What is it based on?',
              'Citations they can open: the article id, its title, and a link that lands on the passage',
              'A list of document ids with nothing behind them',
            ],
            [
              'Is that still true?',
              'The revision the proposal was built from, and a visible mark when the ticket has moved since',
              'Nothing, because the demo takes four minutes and nothing moves in four minutes',
            ],
            [
              'How do I stop it?',
              'A cancel that abandons the in-flight request, and an honest statement of what it cannot undo',
              'A disabled button and a spinner',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'The screen has more states than a demo shows. Idle before anything is asked for. Loading while the proposal is being built. Ready when it is there. Approving while the approval is in flight. Approved, rejected, and error. Each one is a different sentence for the operator, and each one is a different set of controls: you cannot approve what has not loaded, and you cannot cancel what was never started.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            "// The shape the screen renders from. Every field answers something the\n// operator asked, and statusMessage is what the live region reads out.\nconst state = {\n  status: 'ready', // idle | loading | ready | approving | approved | rejected | error\n  ticketId: 'MB-3312',\n  proposal: { action: 'refund', amountCents: 4200, revision: 7 },\n  citations: [{ id: 'KB-118', title: 'Refunds for duplicated invoices', url: '/kb/KB-118' }],\n  warnings: ['The customer record could not be read; the address is from a cached copy.'],\n  superseded: false, // the ticket moved after this proposal was built\n  receiptId: null,\n  error: null,\n  statusMessage: 'Proposal ready for MB-3312, with 1 warning to read before you approve.',\n};",
          caption: 'One object, and every field in it is something the operator asked or something they have to be told.',
        },
        {
          kind: 'prose',
          body:
            "Preserve partial-failure warnings and distinguish them from a clean success. This exercise permits approval after a load with warnings, under its stated policy. In a real refund workflow, missing required evidence or a stale amount may instead block approval. The operator should not be asked to waive a mandatory server-side rule simply because a warning was displayed.",
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            "Do not conceal a failed dependency behind an unqualified success. Show the affected field, freshness/uncertainty and permitted next action. Whether the proposal remains usable depends on policy and the missing information; an explicit blocking error can be safer than an actionable warning.",
        },
        {
          kind: 'prose',
          body:
            "AbortController supplies a signal accepted by APIs such as fetch. Aborting before completion can reject pending fetch/body work with the supplied reason, or AbortError by default; it can also stop client transport work. It does not guarantee the server stopped or reverse an accepted side effect. In this exercise cancellation invalidates local request ids without aborting the dependency promise. Reconcile any submitted approval through an authorized server workflow.",
        },
        {
          kind: 'trace',
          caption: 'An approval cancelled mid-flight, and the receipt that turns up afterwards.',
          trace: {
            shape: 'array',
            legend: ['status', 'in flight', 'proposal', 'abandoned', 'announced'],
            frames: [
              {
                cells: ['ready', 'none', 'MB-3312 rev 7', 'none', 'Proposal ready, 2 citations'],
                marks: [{ index: 2, role: 'settled' }],
                note: 'The proposal is on screen with its two citations, and nothing is in flight. The operator is reading.',
              },
              {
                cells: ['approving', 'req 2', 'MB-3312 rev 7', 'none', 'Sending your approval for MB-3312'],
                marks: [{ index: 0, role: 'active' }, { index: 1, role: 'active' }],
                note: 'The operator presses Approve. Request 2 leaves the browser and the proposal stays on screen, because they should still be able to read what they just approved.',
              },
              {
                cells: ['idle', 'none', 'none', 'req 2', 'Cancelled. The answer to request 2 will be ignored'],
                marks: [{ index: 3, role: 'excluded' }],
                note: 'They press Cancel a second later. The screen goes back to idle, clears the proposal, and records request 2 as abandoned.',
              },
              {
                cells: ['idle', 'none', 'none', 'req 2', 'Cancelled. The answer to request 2 will be ignored'],
                marks: [{ index: 3, role: 'excluded' }],
                note: 'The ticket service answers request 2 with receipt RCP-1. The session sees that request 2 is abandoned and changes nothing: no status, no receipt, no announcement.',
              },
              {
                cells: ['idle', 'none', 'none', 'req 2', 'Cancelled. The answer to request 2 will be ignored'],
                marks: [{ index: 1, role: 'compare' }, { index: 3, role: 'excluded' }],
                note: 'The approval still left the browser, so the ticket service may hold it. The screen does not claim to know. A production workflow needs separate authorized reconciliation under its real request/effect identity. This state-only fixture does not implement or display that reconciliation.',
              },
            ],
          },
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            "Guard local UI updates by request identity so an abandoned response cannot overwrite a newer view. Reconciliation can still record the actual server outcome separately. Safe replay of a state-changing approval requires the operation\u2019s real idempotency/transaction contract; RFC 9110 defines method semantics but does not require every safe retry to carry a universal idempotency key. A key without server-enforced matching and atomic effect handling is insufficient.",
        },
        {
          kind: 'prose',
          body:
            "This exercise exposes retry through an explicit operator load action. Other interfaces can use bounded automatic retries for safe operations with deadlines, backoff and visible status. A silent unbounded loop can hide failure and add load, but automation does not inherently turn every slow call into three. Distinguish a failed load from an approval whose server outcome is unknown.",
        },
        {
          kind: 'prose',
          body:
            "Expose meaningful status changes through persistent accessible status UI. aria-live polite normally waits for an opportunity to announce; assertive requests interruption and should be reserved for urgent information. Not every error needs assertive behavior. Screen-reader/browser behavior can vary, and focusable content can be discovered without a live announcement. Test the actual controls, announcement timing, focus order and wording rather than assuming a string guarantees delivery.",
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            "// The live region exists from the first render, empty. Adding the element\n// and text together can miss an announcement in some browser/AT combinations.\n// Test actual delivery; element presence alone is not proof.\n// <p id=\"workbench-status\" aria-live=\"polite\" />\n\nconst announce = message => {\n  state.statusMessage = message;\n  document.getElementById('workbench-status').textContent = message;\n};\n\n// One call per transition, from the state logic, not from the click handler.\n// A refused click announces too: an operator who pressed a button and heard\n// nothing does not know whether it worked.",
          caption: 'The live region is a render target the state logic writes to, which is why the message belongs in the state.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'An automated check on those messages can count them and confirm each one is a non-empty string tied to a transition. That is all it establishes. Whether "Proposal ready, 2 citations, 1 warning" is a sentence an operator can act on at speed is a judgement, and it stays a judgement you make and record separately from the passing check.',
        },
        {
          kind: 'prose',
          body:
            "Use native button elements with accessible names and appropriate disabled states; enabled buttons support keyboard activation. Do not rely on color alone. A 44-by-44 CSS-pixel target is this workbench\u2019s design goal, not a universal minimum for every WCAG conformance level. Check spacing, zoom, focus and pointer/keyboard use with the actual interface. Including accessibility in implementation reduces rework, but cost and behavior still need testing.",
        },
      ],
    },
    {
      id: 'fde-v1-m10-l2',
      title: 'Acceptance, communication and what you leave behind',
      summary:
        'A UAT with three possible endings, a demo that shows the failure mode, the runbook somebody reads at three in the morning, a workshop that hands the system over, a written push-back on the wrong feature, and the difference between one customer’s request and product input.',
      estimatedMinutes: 40,
      sources: [
        {
          label: 'Vercel, Forward-Deployed Engineer job posting',
          url: 'https://vercel.com/careers/forward-deployed-engineer-5752684004',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Nabeel S. Qureshi, “Reflections on Palantir” (October 2024)',
          url: 'https://nabeelqu.co/reflections-on-palantir',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostHog, “WTF is a forward deployed engineer? (and why everyone is hiring them)” (February 2026)',
          url: 'https://posthog.com/blog/forward-deployed-engineer',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'The Pragmatic Engineer, “What are Forward Deployed Engineers, and why are they so in demand?” (August 2025)',
          url: 'https://newsletter.pragmaticengineer.com/p/forward-deployed-engineers',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Google SRE Book — Postmortem culture',
          url: 'https://sre.google/sre-book/postmortem-culture/',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'Google SRE Book — Service level objectives',
          url: 'https://sre.google/sre-book/service-level-objectives/',
          reviewedOn: '2026-09-08',
        },
        {
          label: 'OpenTelemetry — Traces',
          url: 'https://opentelemetry.io/docs/concepts/signals/traces/',
          reviewedOn: '2026-09-08',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            "Agree acceptance conditions, authority, representative inputs and measurement methods before evaluating the result. UAT can accept, conditionally accept under authorized policy, or reject. Conditions written in the same week are not inherently invalid; the problem is silently fitting them to a known outcome rather than documenting the intended requirement and any authorized change.",
        },
        {
          kind: 'prose',
          body:
            "Record each observed criterion separately from the release decision. Accept when required conditions are satisfied and the authorized owner agrees. Reject or delay when a required gate fails without an authorized exception. Conditional acceptance requires explicit waiver authority, rollout scope, risks, remedy, owner, date and a response if unresolved. It is not automatically the commonest outcome or permission to deploy every passing part independently.",
        },
        {
          kind: 'table',
          caption: 'The three UAT outcomes, what each one has to record, and who owns the next move.',
          headers: ['Outcome', 'What gets written down', 'Who owns the next step'],
          rows: [
            [
              'Accept',
              'Each condition, the measured result against it, and the fixture or dataset it was measured on',
              'The named acceptance and operational owners under the agreed handoff',
            ],
            [
              'Accept with conditions',
              'The conditions met, the miss stated as a number against its target, the remedy, a date and a named owner',
              'Named remedy and acceptance owners, including the response if the deadline is missed',
            ],
            [
              'Reject',
              'Which condition failed, by how much, what you now believe the cause is, and what changes before the next session',
              'The named delivery and acceptance owners; any requirement change must be explicit',
            ],
          ],
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Watch for the condition that gets quietly rewritten after the result is known. A median of six minutes twenty against a four-minute target is not a pass because the sponsor is pleased; it is a miss with a happy sponsor, and recording it that way is what lets you find out in October whether the number ever came down.',
        },
        {
          kind: 'prose',
          body:
            'Orosz’s account of OpenAI’s forward deployed engineers in The Pragmatic Engineer ends their validation phase with a final report showing eval performance compared to the objectives. A UAT record does the same job for an operator workflow: each measured result sits beside the condition agreed before the session, including the ones that missed.',
        },
        {
          kind: 'prose',
          body:
            "Include a relevant failure or abstention path in a demo and explain its consequence. A happy-path-only demo does not prove there are no failures. Showing a bounded no-evidence response helps set expectations, but the time required and the audience\u2019s understanding need observation. Abstention is useful under the actual quality and escalation policy.",
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            "Identify canned responses, synthetic inputs and live dependencies before presenting results. A demo can measure an observed duration or demonstrate chosen behavior, but it is not automatically a representative accuracy/reliability evaluation. Keep those measurements and their sampling limits explicit; a recording alone does not establish current live behavior.",
        },
        {
          kind: 'prose',
          body:
            "Write for the actual on-call audience and access context. Provide an alert-to-runbook link, symptom checks, a permitted mitigation, verification window, failure response and escalation. Commands need prerequisites, scope and safe execution instructions; do not encourage pasting unknown effects. Architecture context can help when concise, alongside an actionable sequence.",
        },
        {
          kind: 'code',
          language: 'text',
          code:
            "# Runbook: proposals stop appearing\n\nAlert: workbench_proposal_latency_high\nOwner: integrations rota. Escalation: platform rota after 15 minutes.\n\n## Symptom\nWhat the operator sees, in their words, and the alert that fires with it.\n\n## Check\nThe two signals that tell the likely causes apart, and the dashboard they live on.\n\n## Action\nThe smallest change that addresses the likely cause, written as a command\nsomebody can paste.\n\n## Verify\nThe number that has to move, which direction, and how long to wait for it.\n\n## If it does not work\nThe next action, and the rota to wake.\n\n## Afterwards\nWhat to put back, what to record, and where the postmortem goes.",
          caption: 'Six headings. The last three are the ones that get left out, and they are the ones the reader at 03:00 needs most.',
        },
        {
          kind: 'trace',
          caption: '03:12, one on-call engineer walking that runbook.',
          trace: {
            shape: 'array',
            legend: ['symptom', 'check', 'action', 'verify', 'escalate'],
            frames: [
              {
                cells: ['queue stuck on loading', 'not yet', 'not yet', 'not yet', 'not yet'],
                marks: [{ index: 0, role: 'active' }],
                note: 'The alert names the runbook page. The engineer matches what the operator reported to the symptom at the top: proposals stop appearing.',
              },
              {
                cells: ['queue stuck on loading', 'ticket API 429 rate at 31%', 'not yet', 'not yet', 'not yet'],
                marks: [{ index: 1, role: 'active' }],
                note: 'Two signals on one dashboard. Latency is high and the ticket API is returning 429 for nearly a third of calls, which shows throttled responses, not their full cause. Workbench concurrency or retry behavior can contribute; inspect scope and supporting evidence.',
              },
              {
                cells: ['queue stuck on loading', 'ticket API 429 rate at 31%', 'concurrency 6 to 2', 'not yet', 'not yet'],
                marks: [{ index: 2, role: 'active' }],
                note: 'The runbook gives one command: drop TICKET_API_CONCURRENCY to 2 and redeploy. This assumes the engineer has the required access and the change is authorized and tested; record scope and verify the queue response.',
              },
              {
                cells: ['queue stuck on loading', 'ticket API 429 rate at 31%', 'concurrency 6 to 2', 'still rising after 10 min', 'not yet'],
                marks: [{ index: 3, role: 'excluded' }],
                note: 'The verify step names the number and the wait: queue depth, falling, within ten minutes. It is still rising, so the action did not work and the engineer stops guessing.',
              },
              {
                cells: ['queue stuck on loading', 'ticket API 429 rate at 31%', 'concurrency 6 to 2', 'still rising after 10 min', 'platform rota paged 03:27'],
                marks: [{ index: 4, role: 'active' }],
                note: 'The escalation names a team rota rather than a particular person. Fifteen minutes after the 03:12 alert, the platform rota is paged under the stated rule. A rota still needs tested delivery, permissions and coverage; its name alone does not ensure help arrives.',
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'Two things the runbook must not pretend. It cannot promise that the action fixes the cause, only that it is the first thing to try and here is how you will know. And it cannot undo effects that have already left: a rollback restores your code, not the refunds that were approved while the bad version was live, and the reconciliation for those belongs in the runbook as its own step with its own owner.',
        },
        {
          kind: 'prose',
          body:
            'Give the rollback its own heading rather than leaving it inside “If it does not work”. Say what it restores (the previous build, the previous value of one setting), where the engineer runs it and with which access, how long it takes, the signal that confirms it worked, and what it leaves behind. The runbook you write at the end of this module asks for four parts in that spirit: the trigger, the steps, the rollback and the owner.',
        },
        {
          kind: 'prose',
          body:
            'A handoff made of a document and a farewell call leaves the customer’s team owning code they have never changed. Vercel’s forward-deployed engineer posting puts teaching inside the job. It lists running workshops and pair programming sessions so customer teams can maintain what you ship, and describes success as customer teams able to extend the work on their own.',
        },
        {
          kind: 'prose',
          body:
            'Plan the workshop backwards from one task the customer’s team must do alone after you leave. At Marlbrook that task could be adding a routing rule and shipping it behind the existing tests. Put their engineer at the keyboard for one hands-on exercise on that task, against fixtures or a staging copy, and keep your own hands off it. End with a check you can both observe: they make the change and roll it back without your help, or you write down what stopped them and who fixes that.',
        },
        {
          kind: 'table',
          caption: 'A fixture outline for a ninety-minute Marlbrook handover workshop. Most of the time goes to the customer’s team doing the work.',
          headers: ['Block', 'Minutes', 'What the customer’s team does'],
          rows: [
            ['The system on one page', '10', 'Marks where data enters, where an operator approves, and who can change each part'],
            ['Walk the runbook', '15', 'One engineer reads it aloud while another follows the signals on the dashboard'],
            ['Hands-on: add a routing rule', '40', 'Their engineer writes the rule and its test and ships it to staging; you answer questions only'],
            ['Drill: roll the change back', '15', 'They run the rollback from the runbook and confirm the verify signal moved'],
            ['What is still yours', '10', 'They list what they could not yet do alone, with an owner and a date for each'],
          ],
        },
        {
          kind: 'prose',
          body:
            'Some requests will not move the number the customer cares about, and some arrive with conviction and a deadline attached. Answer those in writing, so the reasoning outlives the meeting where it was argued. Restate the request in the customer’s words. Name the need you think sits behind it and the evidence for that. Recommend what you would build instead and what it costs. Say what would have to be true before you would build what they asked, the way a non-goal carries the condition that reopens it. Ask for one decision, from a named role, by a date.',
        },
        {
          kind: 'code',
          language: 'text',
          code: `Subject: Confidence scores on proposals: a different fix for the same worry

You asked for a confidence percentage on every proposal, so operators
know which ones to check closely.

What we saw in UAT: operators opened the cited article on 9 of 10
proposals before approving. The two wrong proposals both cited a
superseded article. A score from the model is not calibrated against
your tickets, so 90% would not mean nine in ten are right.

What I recommend: mark a citation as superseded on the proposal itself,
and show the warnings the screen already receives. About three days.

What would change my mind: a labelled set of 200 of your tickets that
shows a score separating right from wrong proposals.

Decision: may we build the superseded marker instead? Support lead,
by Thursday.`,
          caption: 'A fixture push-back to a different request than the one in the exercise. One page, evidence before the recommendation, one decision at the end.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'The customer can still overrule you. When they do, record the decision, who made it and the evidence you gave, the same way the UAT record keeps a waiver apart from the measurement. A push-back that leaves no record gets argued again next month.',
        },
        {
          kind: 'prose',
          body:
            'What you learn in one deployment is also the raw material for the product. Nabeel Qureshi describes the split at Palantir: the forward deployed engineer solves the customer’s problem without worrying about generality, and product development takes what was built and generalises it so it can be sold elsewhere. Jina Yoon’s PostHog explainer describes the same loop, with core product teams taking the field learnings and generalising them for other customers. Vercel’s posting asks the same engineer to share repeatable patterns with Product and Engineering. Your part of that loop is evidence the product team can assess.',
        },
        {
          kind: 'prose',
          body:
            "Turn customer observations into evidence the product team can assess. State the underlying need, where it occurred, frequency, impact and alternatives without disclosing unnecessary identity. Repeated independent workarounds can strengthen a hypothesis, but one urgent request can also matter. Three sites of one customer do not prove demand across customers.",
        },
        {
          kind: 'table',
          caption: 'Four observations from one customer; repeated behavior strengthens a hypothesis without proving cross-customer demand.',
          headers: ['What came back', 'One customer or a pattern', 'Why'],
          rows: [
            [
              'Move the approve button left of the citation panel',
              'One customer',
              'It may reflect familiarity or a broader usability problem; investigate rather than inferring no other user needs it',
            ],
            [
              'Read our warehouse schema so proposals can include stock levels',
              'One customer',
              'A specific integration request that may reveal a reusable need; prevalence and product fit have not been established',
            ],
            [
              'Operators at three sites reload before approving to see whether the ticket moved',
              'A within-customer pattern',
              'Three sites of this one customer show a recurring freshness problem; cross-customer demand and solution choice remain unvalidated',
            ],
            [
              'Give us the audit export in our own CSV column order',
              'One customer',
              'It fits their spreadsheet. A configurable column order is a product feature; this specific order is not',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            "Write the need, observed contexts/frequency, current workaround and measured or explicitly estimated cost. Name what remains unknown and what additional research would test broader applicability. Explain what a proposed feature could replace without treating a specific solution as already validated. Prioritization depends on user impact, cost and product strategy, not a single mandatory memo sentence.",
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Finishing this path records what you passed in these exercises. It is not a certification, not evidence of production experience, and not a claim about employment. Your runbook, your workshop outline and your push-back email are your own work, self-reviewed: the server checks that each part is present and inside its limit, and you judge the rest against the rubric. They are worth more to the next reader than any completion label attached to them. The postings cited in this lesson were open when they were read in October 2026; they show what a few employers asked for then, and nothing here claims that finishing the path qualifies you for any role.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m10-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: the operator’s screen',
      summary: 'Informed approval, policy-dependent warnings, local cancellation, stale responses and accessible status feedback.',
      competencies: ['handoff'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m10-l1',
    },
    {
      id: 'fde-v1-m10-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: acceptance, communication and what you leave behind',
      summary: 'Authorized acceptance decisions, bounded demo evidence, runbooks with a rollback, a handover workshop, a written push-back, and customer observations for product research.',
      competencies: ['handoff'],
      estimatedMinutes: 40,
      lessonId: 'fde-v1-m10-l2',
    },
    {
      id: 'fde-v1-m10-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Acceptance, runbooks and feedback',
      summary: 'Four decisions on documented acceptance exceptions, runbook verification and escalation, informed approval of irreversible effects, and evidence of recurring usability needs.',
      competencies: ['handoff'],
      estimatedMinutes: 15,
      passThreshold: 0.8,
      questions: [
        {
          id: "fde-v1-m10-q1",
          prompt: "UAT requires ten cases completed unaided, citations on every proposal and median decision time below four minutes. Observed results are ten completed, citations on all, and a 6 min 20 s median versus an eight-minute baseline. The authorized acceptance owner may explicitly waive the timing gate for a limited rollout and has agreed to do so. What record preserves both the evidence and that decision?",
          options: [
            "Mark all original criteria as passed because 6 min 20 s improves on the eight-minute baseline.",
            "Record the missed timing target, the explicit waiver, rollout scope, owner and dated follow-up.",
            "Record a passing UAT but omit the measured timing because the owner waived that gate.",
            "Record no result because a median cannot be calculated from a sample of ten cases.",
          ],
          correct: 1,
          explanation: "Two observed criteria pass and the timing criterion misses: 6 min 20 s exceeds four minutes. The authorized waiver changes the release decision, not the measured outcome. Record the miss and the limited conditional acceptance, including scope, risk, owner and follow-up date. Without waiver authority or an agreed exception, do not silently bypass a required gate; rejecting or delaying can be appropriate. Ten observations have a calculable median but may give limited evidence about wider performance. Improvement over baseline is not satisfaction of the original target.",
          competencies: ['handoff'],
        },
        {
          id: "fde-v1-m10-q2",
          prompt: "This runbook names a symptom, dashboard checks, an owner rota and a concurrency change, but no success criteria or response if that change fails. Which addition directly closes that verification and escalation gap?",
          context: {"language": "text", "code": "# Runbook: proposals stop appearing\n\nAlert: workbench_proposal_latency_high\nOwner: integrations rota\n\n## Symptom\nCase proposals stop appearing. The operator queue shows \"loading\" for more\nthan 30 seconds.\n\n## Check\n1. Open the workbench dashboard and read proposal_latency_p95 for the last\n   15 minutes.\n2. Read the ticket-api error rate on the same dashboard. A 429 rate above 5%\n   means the ticket API is throttling us.\n\n## Action\n3. Set TICKET_API_CONCURRENCY to 2 in the workbench environment and redeploy.\n\n## Afterwards\n4. Post the incident in the ops channel with the timestamps and the dashboard\n   link."},
          options: [
            "An architecture diagram showing how the workbench, the ticket API and its rate limiter depend on each other.",
            "A narrative of the previous throttling incident that explains its root cause and how the team resolved it.",
            "A reminder to set TICKET_API_CONCURRENCY back to its normal value once the incident is closed.",
            "Expected recovery metrics, an observation window, and a reachable escalation route if recovery fails.",
          ],
          correct: 3,
          explanation: "The operator needs a defined way to judge recovery, a bounded period to observe it and a concrete route for help when it fails. The actual runbook must also make access, safe execution, change reversal and relevant cleanup clear. An architecture diagram and root-cause knowledge can help during an incident; they are not inherently inappropriate. Restoring concurrency is not automatically correct without checking why it changed. This answer closes the named gap rather than certifying that the rest of the page is ready for handoff.",
          competencies: ['handoff'],
        },
        {
          id: "fde-v1-m10-q3",
          prompt: "A refund becomes irreversible once the payment provider accepts it; the application cannot promise a later undo. Which confirmation screen best supports an informed operator decision before submission?",
          options: [
            "Show order, amount, currency, current evidence and effects; allow decline and say when it becomes irreversible.",
            "Show only the model’s confidence score and a generated explanation of why it proposed this refund.",
            "Show every retrieved document in full so the operator can judge the evidence, without restating amount or order.",
            "Show a thirty-second undo button for operator mistakes, even though the provider may accept the refund first.",
          ],
          correct: 0,
          explanation: "The operator must understand the specific action and its evidence before agreeing. Show relevant accessible citations, freshness limits and the point after which cancellation is unavailable. Server-side execution still rechecks authorization, approval and current refundable state: a screen is not enforcement. Calibrated scores may help when properly evaluated, and generated explanations can be useful context, but neither substitutes for evidence or explicit parameters. A later compensating action, if supported, is different from undoing an accepted irreversible refund.",
          competencies: ['handoff'],
        },
        {
          id: "fde-v1-m10-q4",
          prompt: "Which observation gives the strongest evidence here for investigating a recurring usability problem, rather than specifying only a requested implementation? All observations come from one Marlbrook customer; no cross-customer validation has yet been done.",
          options: [
            "One manager requests moving the approve button to match where it sat in the tool the team used before.",
            "One integration lead asks the workbench to read stock levels nightly from a named internal warehouse schema.",
            "Operators at three of four sites independently reload proposals because they cannot tell if the ticket changed.",
            "One security team requests a fixed audit-export column order so the file loads into its own spreadsheet.",
          ],
          correct: 2,
          explanation: "The repeated workaround supplies observed evidence of a freshness/approval problem across several sites. It is useful product input to investigate, not proof of demand across customers or automatic priority. The other requests are also valid product input and may reveal broader needs after research; a request need not recur before it matters. Discover the underlying need, cost and alternatives before deciding on a reusable feature or customer-specific change. This observation does not provide a measured reload cost or demonstrate a particular solution.",
          competencies: ['handoff'],
        },
      ],
    },
    {
      id: 'fde-v1-m10-operator-state',
      kind: 'code',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'The operator session',
      summary:
        'The state behind an approval screen: the proposal with its citations, an approve that refuses stale and in-flight cases, a cancel a late answer cannot undo, and a status message on every transition.',
      competencies: ['handoff'],
      estimatedMinutes: 45,
      code: {
        language: 'javascript',
        prompt:
          'Marlbrook’s triage workbench proposes a refund and an operator approves it. This exercise is the state logic behind that screen. The grade drives it directly rather than through a rendered component: transition bugs are one possible production failure, they are testable on their own, and every dependency here is an authored fixture on a virtual clock, not a live service.\n\nWrite `createOperatorSession(deps)`. It returns an object with `getState()`, `load(ticketId)`, `approve()`, `reject()`, `cancel()` and `noteRevision(revision)`.\n\n`deps` comes from the screen and holds three things. `deps.loadProposal(ticketId)` returns a promise for `{ proposal, citations, warnings }`, where `proposal` carries a `ticketId` and a `revision`. `deps.submitApproval(request)` returns a promise for `{ receiptId }`. `deps.announce(message)` records the status sentence for the interface to present accessibly. Either promise can reject with an `Error`, whose message can be empty.\n\n`getState()` returns the screen as it is now: `status`, `ticketId`, `proposal`, `citations`, `warnings`, `superseded`, `receiptId`, `error`, `statusMessage` and `abandoned`. It starts at `{ status: \'idle\', ticketId: null, proposal: null, citations: [], warnings: [], superseded: false, receiptId: null, error: null, statusMessage: \'\', abandoned: [] }`. Build a fresh object each call or hand back a copy; the grade reads fields and checks that repeated snapshots are distinct.\n\nThe transitions:\n\n- `load(ticketId)` from any status except `loading` and `approving` clears the proposal, citations, warnings, `superseded`, `receiptId` and `error`, sets `ticketId`, goes to `loading` and calls `deps.loadProposal(ticketId)`. While a request is in flight it is refused, and `deps.loadProposal` is not called at all.\n- A load that resolves goes to `ready` with the proposal, its citations and its warnings. Under this exercise’s permissive warning policy, warnings are a partial failure: the status is still `ready`, the array is carried through unchanged, and approving stays possible. Dropping the warnings renders a clean success that is not true.\n- A load that rejects goes to `error`, keeps `ticketId`, clears the proposal and citations, and stores the rejection’s `message` in `error`.\n- `approve()` runs only from `ready` and only while `superseded` is false. It goes to `approving`, keeps the proposal and citations on screen, and calls `deps.submitApproval({ ticketId, revision })` with the loaded ticket id and the loaded proposal’s revision, and nothing else in the object. Resolving goes to `approved` with `receiptId`. Rejecting goes to `error` with the message, and the proposal stays on screen.\n- `reject()` runs only from `ready`. It goes to `rejected`, keeps the proposal and citations, and calls nothing.\n- `cancel()` runs only from `loading` or `approving`. It goes back to `idle`, clears everything, and pushes the in-flight request’s id onto `abandoned`.\n- `noteRevision(revision)` is the ticket service telling the screen the ticket has moved. From `ready`, when the number is greater than the loaded proposal’s revision, set `superseded` to true. If already superseded, or in any other case, it changes nothing.\n\nThe part that matters most: after a cancel, or after the screen has moved on to another request, the answer to the abandoned request can still arrive. It has to change nothing at all — no status, no proposal, no receipt, no announcement. Give every request an id, remember which id you are still willing to accept an answer from, and have both handlers return early when the id they carry is not that one.\n\nAnnounce on every state change and on every refused operator action, by setting `statusMessage` and calling `deps.announce(message)` with the same string. A `noteRevision` that changes nothing announces nothing. The selected checks count announcements and compare the last message; they establish those tested transitions, not every possible path or real assistive-technology delivery. Wording and accessibility need separate review.\n\nDomain: dependencies and results are trusted ordinary data. load/approval return settling promises without synchronous throws, announce is a nonthrowing recorder, revisions are nonnegative safe integers, ticket/receipt ids are nonempty strings and error messages are strings including empty. Each session receives at most 100 actions and arrays contain at most 100 entries. getState returns a fresh top-level snapshot; callers read nested data without mutating it. Request ids start at 1, increase for each accepted load/approval and are never reused; refused actions do not allocate ids. The immutable fixture helpers are available before declarations, with deferred instrumentation before graded calls. This stateful contract has an explicit action budget rather than a single input-size complexity target.\n\nCancelling stops the screen from acting on the answer. It does not un-send a request that already left, and one of the assertions holds you to that: the approval still reaches `deps.submitApproval`, and the screen simply refuses to claim it knows the outcome.',
        contract: [
          'Keep the name `createOperatorSession`; the grade builds sessions by name and drives them through the object you return.',
          'Use only what arrives in `deps`: `loadProposal`, `submitApproval` and `announce`. No timers of your own, no network, no globals.',
          'An answer belonging to an abandoned or superseded request leaves every field exactly as it is, `statusMessage` included.',
          '`approve` sends `{ ticketId, revision }` and nothing else, only from a `ready` proposal that has not been superseded.',
          'Announce on every state change and on every refused operator action. A `noteRevision` that changes nothing announces nothing.',
        ],
        starter: `const createOperatorSession = (deps) => {

};

// Scratch pad — change this before submitting.
const demoDeps = {
  loadProposal: ticketId => Promise.resolve({
    proposal: { ticketId, revision: 7, action: 'refund', amountCents: 4200 },
    citations: [{ id: 'KB-118', title: 'Refunds for duplicated invoices' }],
    warnings: [],
  }),
  submitApproval: request => Promise.resolve({ receiptId: 'RCP-1' }),
  announce: message => console.log('live region:', message),
};
console.log(createOperatorSession(demoDeps));
`,
        skeleton: `const createOperatorSession = (deps) => {
  const state = {
    status: 'idle',
    ticketId: null,
    proposal: null,
    citations: [],
    warnings: [],
    superseded: false,
    receiptId: null,
    error: null,
    statusMessage: '',
    abandoned: [],
  };
  let nextRequest = 0;
  let inFlight = null;

  const announce = message => {
    /* set state.statusMessage and hand the same string to deps.announce */
  };

  const load = ticketId => {
    /* refused while loading or approving: announce and return without calling deps */
    /* otherwise clear, take the next request id, go to loading, call deps.loadProposal */
    /* both answers start with: is this still the request in flight? */
  };

  const approve = () => {
    /* only from ready, only while superseded is false */
    /* send { ticketId, revision } and nothing else */
  };

  const reject = () => {
    /* only from ready; the proposal stays on screen */
  };

  const cancel = () => {
    /* only from loading or approving: push the in-flight id onto abandoned, clear, go idle */
  };

  const noteRevision = revision => {
    /* from ready, when the number is past the loaded revision, mark superseded */
  };

  return { getState: () => ({ ...state }), load, approve, reject, cancel, noteRevision };
};`,
        hints: [
          'One counter and one variable carry the whole stale-answer problem. `nextRequest` hands out ids; `inFlight` holds the id whose answer you are still willing to accept. Cancel sets it to null, a finished request sets it to null, and every handler starts with a comparison against it.',
          'Write `approve` as two guards and then a transition: refuse when the status is not `ready`, refuse when `superseded` is true, and only then move to `approving` and call `deps.submitApproval`. Announce the refusal too — an operator who pressed a button and heard nothing has no idea whether it worked.',
          '`warnings` is the difference between a load that half worked and one that worked. Carry the array through to the state, leave the status at `ready`, and let the operator decide with what you know.',
        ],
        approach: [
          'Build the state object and the two request variables, then write `announce` so every call sets `state.statusMessage` and passes the same string to `deps.announce`.',
          'Write `load`: refuse while `loading` or `approving`, otherwise clear the previous proposal, take the next request id, go to `loading` and call `deps.loadProposal`.',
          'Handle both answers to a load in one place, each starting with an early return when the request is no longer the one in flight, then either `ready` with proposal, citations and warnings, or `error` with the rejection’s message.',
          'Write `approve` the same shape, guarded by `ready` and by `superseded`, sending `{ ticketId, revision }` and landing on `approved` with the receipt or `error` with the message.',
          'Write `cancel`, `reject` and `noteRevision`, and check that cancel pushes the in-flight id onto `abandoned` and clears it so the late answer finds nothing to match.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'The seven states, and what the operator sees in each',
            critical: true,
            weight: 3,
            detail:
              'Check idle, loading, ready with the proposal and its citations, ready with warnings carried through, approving, approved with the receipt, rejected, and the message from a failed load or a failed approval.',
          },
          {
            id: 'no-stale-overwrite',
            label: 'A late answer from an abandoned request changes nothing',
            critical: true,
            weight: 2,
            detail:
              'An answer arriving after a cancel, or belonging to a request the screen has moved on from, has to leave every field as it was, including `abandoned` and `statusMessage`.',
          },
          {
            id: 'approval-guarded',
            label: 'Approval is refused while loading and on a superseded proposal',
            critical: true,
            weight: 2,
            detail:
              'Nothing reaches `deps.submitApproval` from `idle`, from `loading`, from a proposal `noteRevision` has marked out of date, or from a second press after the approval already went through.',
          },
          {
            id: 'status-announced',
            label: 'Every transition sets a status message',
            critical: false,
            weight: 2,
            detail:
              'The check counts announcements and confirms `statusMessage` holds the last one. It establishes the tested transitions and nonempty matching strings, not all possible paths or assistive-technology delivery. Wording and actual accessible behavior need separate review.',
          },
        ],
        tests: [
          {
            call: '(function () { var f = __fixture(); var s = createOperatorSession(f.deps); return __view(s.getState()); })()',
            expected: {
              status: 'idle',
              ticketId: null,
              proposalTicket: null,
              revision: null,
              citations: [],
              warnings: [],
              superseded: false,
              receiptId: null,
              error: null,
            },
            label: 'the screen starts idle with nothing loaded',
          },
          {
            call: '(async function () { var f = __fixture(); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); await __drain(); return __view(s.getState()); })()',
            expected: {
              status: 'ready',
              ticketId: 'MB-3312',
              proposalTicket: 'MB-3312',
              revision: 7,
              citations: ['KB-118', 'TCK-3312-note-2'],
              warnings: [],
              superseded: false,
              receiptId: null,
              error: null,
            },
            label: 'a loaded proposal arrives with its citations',
            async: true,
          },
          {
            call: '(async function () { var f = __fixture(); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); await __drain(); __go(s.approve()); await __drain(); return __view(s.getState()); })()',
            expected: {
              status: 'approved',
              ticketId: 'MB-3312',
              proposalTicket: 'MB-3312',
              revision: 7,
              citations: ['KB-118', 'TCK-3312-note-2'],
              warnings: [],
              superseded: false,
              receiptId: 'RCP-1',
              error: null,
            },
            label: 'approving keeps the proposal on screen and records the receipt',
            async: true,
          },
          {
            call: '(async function () { var f = __fixture({ warnings: ["The customer record could not be read.", "The invoice total came from a cached copy."] }); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); await __drain(); return __view(s.getState()); })()',
            expected: {
              status: 'ready',
              ticketId: 'MB-3312',
              proposalTicket: 'MB-3312',
              revision: 7,
              citations: ['KB-118', 'TCK-3312-note-2'],
              warnings: ['The customer record could not be read.', 'The invoice total came from a cached copy.'],
              superseded: false,
              receiptId: null,
              error: null,
            },
            label: 'a partial failure is ready with warnings, not a clean success',
            edge: true,
            async: true,
          },
          {
            call: '(async function () { var f = __fixture({ loadDelay: 100 }); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); s.cancel(); await __drain(); var st = s.getState(); return { view: __view(st), abandoned: st.abandoned }; })()',
            expected: {
              view: {
                status: 'idle',
                ticketId: null,
                proposalTicket: null,
                revision: null,
                citations: [],
                warnings: [],
                superseded: false,
                receiptId: null,
                error: null,
              },
              abandoned: [1],
            },
            label: 'cancel during a load abandons the request and the late answer changes nothing',
            edge: true,
            async: true,
            criterion: 'no-stale-overwrite',
          },
          {
            call: '(async function () { var f = __fixture({ approveDelay: 100 }); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); await __drain(); __go(s.approve()); s.cancel(); await __drain(); var st = s.getState(); return { view: __view(st), abandoned: st.abandoned, submitted: f.submissions.length }; })()',
            expected: {
              view: {
                status: 'idle',
                ticketId: null,
                proposalTicket: null,
                revision: null,
                citations: [],
                warnings: [],
                superseded: false,
                receiptId: null,
                error: null,
              },
              abandoned: [2],
              submitted: 1,
            },
            label: 'a cancelled approval never comes back as approved, though the request did leave',
            edge: true,
            async: true,
            criterion: 'no-stale-overwrite',
          },
          {
            call: '(async function () { var f = __fixture({ loadDelay: 100 }); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); __go(s.approve()); var during = s.getState().status; await __drain(); return { during: during, after: s.getState().status, submitted: f.submissions.length }; })()',
            expected: { during: 'loading', after: 'ready', submitted: 0 },
            label: 'approving while the proposal is still loading is refused',
            edge: true,
            async: true,
            criterion: 'approval-guarded',
          },
          {
            call: '(async function () { var f = __fixture(); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); await __drain(); s.noteRevision(9); var flagged = __view(s.getState()); __go(s.approve()); await __drain(); return { flagged: flagged.superseded, status: s.getState().status, submitted: f.submissions.length }; })()',
            expected: { flagged: true, status: 'ready', submitted: 0 },
            label: 'a proposal the ticket has moved past cannot be approved',
            edge: true,
            async: true,
            criterion: 'approval-guarded',
          },
          {
            call: '(async function () { var f = __fixture(); var s = createOperatorSession(f.deps); __go(s.load("MB-3312")); await __drain(); __go(s.approve()); await __drain(); return __voice(f, s); })()',
            expected: { count: 4, allText: true, matchesState: true },
            label: 'four transitions, four announcements, and statusMessage holds the last',
            async: true,
            criterion: 'status-announced',
          },
        ],
        harness: OPERATOR_FIXTURE,
      },
    },
    {
      id: 'fde-v1-m10-runbook',
      kind: 'artifact',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Runbook: approvals stuck after a release',
      summary:
        'Write the runbook for a fixture incident on the Marlbrook workbench: the trigger, the steps with a signal after each, the rollback and what it cannot undo, and the owner. Recorded as self-reviewed.',
      competencies: ['handoff'],
      estimatedMinutes: 40,
      artifact: {
        brief:
          'The Marlbrook triage workbench shipped release 2026.10.3 on Tuesday. It turned on a setting, APPROVAL_BATCHING, that groups operator approvals into one call to the ticket service every five seconds. Since then the fixture dashboard shows approval_latency_p95 rising from 1.2 seconds to 14 seconds during the morning peak, the ticket service logging lock-wait timeouts on its refunds table, and operators reporting proposals that sit on “Sending your approval” and then show an error. Release 2026.10.2 is still deployable. The integrations rota owns the workbench; the platform rota owns the ticket service. Approvals that reached the ticket service before a timeout may have been applied even though the screen showed an error.\n\nWrite the runbook the next on-call engineer opens when this happens again. Four fields, all required, each with a character limit you can see before you type: the trigger (800), the owner and escalation (300), the steps (2,000) and the rollback (1,200). You review it against two rows of the path rubric, shown beside the form: operability and communication.\n\nThe release, the setting, the dashboard and the numbers are fixtures written for this module. There is no live system to inspect, so write commands and dashboard names as the fixture states them, and mark anything you would have to confirm with the platform rota as a question rather than a fact.\n\nThis submission is recorded as self-reviewed. The automated check confirms that each field is present and inside its limit, and nothing more: it cannot tell whether a stranger could follow your steps at three in the morning. Read it as that stranger, against the rubric, before you submit.',
        fields: [
          {
            id: 'trigger',
            label: 'Trigger',
            help:
              'The alert or report that sends someone to this page: its name, its threshold, and what the operator sees on screen in their own words. Say how the engineer tells this incident apart from a ticket-service outage. The check confirms the field is filled and inside 800 characters.',
            kind: 'long-text',
            required: true,
            maxLength: 800,
          },
          {
            id: 'owner',
            label: 'Owner and escalation',
            help:
              'The rota that owns this page, the rota to page next, and after how many minutes. Name rotas, not people. The check confirms the field is filled and inside 300 characters; it cannot tell whether the rota answers.',
            kind: 'short-text',
            required: true,
            maxLength: 300,
          },
          {
            id: 'steps',
            label: 'Steps',
            help:
              'One step per line, in order. Each check names the signal and where to read it; each action names what to change, the access it needs and its scope; each is followed by the number that should move, which way, and how long to wait. Include the point where the engineer stops and escalates. The check tests non-empty content and a total of 2,000 characters; it cannot run your steps.',
            kind: 'list',
            required: true,
            maxLength: 2000,
          },
          {
            id: 'rollback',
            label: 'Rollback',
            help:
              'What to roll back (the setting, the release, or both, and in which order), where it is run, how long it takes, and the signal that confirms it worked. Then say what it cannot undo: approvals the ticket service applied while the screen showed an error stay applied. Name who reconciles them and how. The check confirms the field is filled and inside 1,200 characters.',
            kind: 'long-text',
            required: true,
            maxLength: 1200,
          },
        ],
        rubricDimensions: ['operability', 'communication'],
      },
    },
    {
      id: 'fde-v1-m10-workshop-outline',
      kind: 'artifact',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Workshop outline: hand the workbench over',
      summary:
        'Outline a handover workshop for Marlbrook’s engineers, planned backwards from one task they must do alone after you leave: audience and goal, prerequisites, a timed agenda, the hands-on exercise and the check that shows it worked. Recorded as self-reviewed.',
      competencies: ['handoff'],
      estimatedMinutes: 35,
      artifact: {
        brief:
          'Your engagement at Marlbrook ends in three weeks. Two Marlbrook engineers will own the triage workbench after you leave: one has maintained the ticket service for years, the other joined last month and has never deployed the workbench. The support lead will attend for the first half hour. You have one session of at most two hours, a staging copy of the workbench with fixture tickets, and the runbook from the previous exercise.\n\nOutline the workshop. Five fields, all required, each with a character limit you can see before you type: the audience and the one task they must do alone afterwards (600), the prerequisites (600), a timed agenda that fits in two hours (1,500), the hands-on exercise (1,200), and the check that tells you and them whether it worked (600). You review it against two rows of the path rubric, shown beside the form: communication and operability.\n\nThe engineers, the staging copy and the timeline are fixtures written for this module. Nobody will attend a real session, so state what you would ask the attendees beforehand rather than inventing what they know.\n\nThis submission is recorded as self-reviewed. The automated check confirms that each field is present and inside its limit; it does not add up your agenda minutes and cannot tell whether two hours is enough. Check the timing yourself and read the outline against the rubric before you submit.',
        fields: [
          {
            id: 'audience-goal',
            label: 'Audience and goal',
            help:
              'Who attends, by role, what each already knows, and the one task the team must do without you after the session. Make the task concrete enough to observe, such as shipping a routing rule and rolling it back. The check confirms the field is filled and inside 600 characters.',
            kind: 'long-text',
            required: true,
            maxLength: 600,
          },
          {
            id: 'prerequisites',
            label: 'Prerequisites',
            help:
              'One line per thing that must be ready before the session: access to the staging copy, accounts, anything to read beforehand, and who sets each one up. The check tests non-empty content and a total of 600 characters.',
            kind: 'list',
            required: true,
            maxLength: 600,
          },
          {
            id: 'agenda',
            label: 'Agenda',
            help:
              'One block per line with its minutes and what the customer’s team does in it. Give most of the time to their hands on the keyboard. Keep the total at two hours or less; the check counts characters (1,500 in total), not minutes.',
            kind: 'list',
            required: true,
            maxLength: 1500,
          },
          {
            id: 'exercise',
            label: 'Hands-on exercise',
            help:
              'The task the attendees perform, who is at the keyboard, which fixtures or staging data they use, what you do while they work, and what you do if they get stuck. The check confirms the field is filled and inside 1,200 characters.',
            kind: 'long-text',
            required: true,
            maxLength: 1200,
          },
          {
            id: 'success-check',
            label: 'How you will know it worked',
            help:
              'The observable result at the end of the session, and what you record and who owns each gap if the team could not finish the task alone. The check confirms the field is filled and inside 600 characters; it cannot tell whether the team learned anything.',
            kind: 'long-text',
            required: true,
            maxLength: 600,
          },
        ],
        rubricDimensions: ['communication', 'operability'],
      },
    },
    {
      id: 'fde-v1-m10-pushback-email',
      kind: 'artifact',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Push-back email: the wrong feature',
      summary:
        'Answer a sponsor who asks you to remove the approval step for small refunds: restate the request, name the need with the fixture evidence, recommend the alternative and ask for one decision. Recorded as self-reviewed.',
      competencies: ['handoff'],
      estimatedMinutes: 30,
      artifact: {
        brief:
          'After the UAT, Marlbrook’s VP of Customer Operations writes to you: “Operators are too slow. UAT says six minutes twenty against a four-minute target. Turn off the approval step for refunds under EUR 50 and let the workbench send them. Can it be live next week?”\n\nWhat the fixtures give you. The UAT ran ten cases. In seven of them the operator reloaded the ticket before approving, to check whether it had changed since the proposal was built; the session notes put the median time spent on those reloads at two minutes ten seconds per case. The UAT build tracked the ticket-moved state from this module’s exercise, but Marlbrook’s ticket service was not yet sending it revision events, so the screen never marked a ticket as moved. The screen also does not show when a proposal was built. Refunds become irreversible once the payment provider accepts them. Since discovery, finance has named an approver and an amount limit for refunds an operator approves, and nobody for refunds sent without a person. Use only these facts; where you would need a number you do not have, say so.\n\nWrite the email. Five fields, all required, each with a character limit you can see before you type: the subject line (120), the request restated in the VP’s words (400), the need behind it and your evidence (1,000), your recommendation with its cost and the condition that would make you build what they asked (1,000), and the one decision you ask for, from whom and by when (300). You review it against two rows of the path rubric, shown beside the form: communication and problem framing.\n\nMarlbrook, its VP and its numbers are fixtures written for this module, and no email is sent. This submission is recorded as self-reviewed. The automated check confirms that each field is present and inside its limit; it cannot tell whether the VP would agree or whether your tone would keep the conversation open. Read it as the VP would, against the rubric, before you submit.',
        fields: [
          {
            id: 'subject',
            label: 'Subject line',
            help:
              'A subject that tells the VP what the email asks of them. The check confirms the field is filled and inside 120 characters.',
            kind: 'short-text',
            required: true,
            maxLength: 120,
          },
          {
            id: 'request',
            label: 'Their request, restated',
            help:
              'What the VP asked for and why, in their terms, so they can see you understood it before you disagree. The check confirms the field is filled and inside 400 characters.',
            kind: 'short-text',
            required: true,
            maxLength: 400,
          },
          {
            id: 'need-evidence',
            label: 'The need behind it, and the evidence',
            help:
              'The problem you think the request is meant to solve, and the fixture numbers that support your reading. Separate what was measured from what you infer. The check confirms the field is filled and inside 1,000 characters.',
            kind: 'long-text',
            required: true,
            maxLength: 1000,
          },
          {
            id: 'recommendation',
            label: 'Recommendation',
            help:
              'What you would build instead, roughly what it costs, and what you expect it to change. Then the condition that would make you build what they asked, such as finance naming, in writing, an owner and an amount limit for refunds sent without an operator’s approval. The check confirms the field is filled and inside 1,000 characters.',
            kind: 'long-text',
            required: true,
            maxLength: 1000,
          },
          {
            id: 'decision',
            label: 'Decision requested',
            help:
              'The one decision you need, answerable with a yes, a no or a name, the role that makes it and the date. The check confirms the field is filled and inside 300 characters.',
            kind: 'short-text',
            required: true,
            maxLength: 300,
          },
        ],
        rubricDimensions: ['communication', 'problem-framing'],
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m10-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m10-operator-state', state: 'verified_pass' },
    { activityId: 'fde-v1-m10-runbook', state: 'self_reviewed' },
    { activityId: 'fde-v1-m10-workshop-outline', state: 'self_reviewed' },
    { activityId: 'fde-v1-m10-pushback-email', state: 'self_reviewed' },
  ],
};
