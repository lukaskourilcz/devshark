/** M08: Tools, agents and MCP (curriculum v2 numbers it M08; the id stays
 * `fde-v1-m06` until B9 renumbers the manifest).
 *
 * M03 established that the tenant comes from the session and never from the
 * arguments. M04 established that a model response is untrusted text until
 * your own code has checked it. This module puts the two together in the one
 * place where a model's output turns into an effect: the tool call, and then
 * the loop of tool calls an agent makes.
 *
 * Two lessons, one six-question check, one graded dispatcher. The first
 * lesson is about the tool definition and the MCP boundary: the schema as a
 * gate rather than a description, one permission per tool, the two kinds of
 * MCP error, and what a client does with a protocol version it has never
 * seen. The second is about the loop: when a fixed workflow beats an agent,
 * the stopping rule, the approval a person can deny, and a sub-agent that
 * works under a smaller grant and its own call budget.
 *
 * Everything the dispatcher talks to is an authored fixture. `__fixture` in
 * the task harness builds a registry of three synthetic tools whose handlers
 * push to an array; nothing calls a provider, needs a key or opens a socket,
 * and no timer is involved. Every model proposal the lessons show is an
 * authored line, not model output. Marlbrook Systems, its order ids and its
 * refund figures are invented for this path. No real customer data appears
 * in it. */

import type { ModuleSource } from '../../types';

/** The registry, session and call log the dispatcher is graded against.
 * Appended after the learner's code so the fixtures cannot be shadowed.
 *
 * Three tools, chosen so each grading criterion has something to bite on:
 * `orders.read` takes only optional arguments and gets no retry budget,
 * `refunds.create` requires approval and three validated arguments, and
 * `ledger.sync` is allowed three attempts. `readFails` and `syncFails` say
 * how many times those two handlers throw before they succeed, and `log`
 * records every handler invocation, so a test can prove a refusal never
 * reached the handler at all. */
const TOOL_FIXTURE = `
var __fixture = function (options) {
  var opts = options || {};
  var log = [];
  var readFails = opts.readFails || 0;
  var syncFails = opts.syncFails || 0;
  var reads = 0;
  var syncs = 0;
  var refunds = 0;
  var registry = {
    'orders.read': {
      scope: 'orders.read',
      schema: {
        status: { type: 'string', required: false, enum: ['open', 'closed'] },
        limit: { type: 'number', required: false }
      },
      handler: function (args) {
        log.push({ tool: 'orders.read', args: args });
        reads += 1;
        if (reads <= readFails) throw new Error('orders backend unavailable');
        return { count: args.status === 'closed' ? 1 : 2 };
      }
    },
    'refunds.create': {
      scope: 'refunds.write',
      approval: true,
      schema: {
        orderId: { type: 'string', required: true },
        amountCents: { type: 'number', required: true },
        currency: { type: 'string', required: true, enum: ['USD', 'EUR', 'GBP'] }
      },
      handler: function (args) {
        log.push({ tool: 'refunds.create', args: args });
        refunds += 1;
        return { refundId: 'RFD-' + refunds, amountCents: args.amountCents };
      }
    },
    'ledger.sync': {
      scope: 'ledger.write',
      maxAttempts: 3,
      schema: { batchId: { type: 'string', required: true } },
      handler: function (args) {
        log.push({ tool: 'ledger.sync', args: args });
        syncs += 1;
        if (syncs <= syncFails) throw new Error('gateway timeout');
        return { batchId: args.batchId, synced: true };
      }
    }
  };
  var session = {
    operatorId: 'USR-31',
    scopes: opts.scopes || ['orders.read', 'refunds.write', 'ledger.write']
  };
  return { registry: registry, session: session, log: log };
};
var __tools = function (log) {
  return log.map(function (entry) { return entry.tool; });
};
`.trim();

export const FDE_M08: ModuleSource = {
  id: 'fde-v1-m08',
  title: 'Tools, agents and MCP',
  outcomes: [
    'Say what a tool schema enforces inside your process and what it only suggests to the model, and put each argument check on the right side of that line.',
    'Give every tool one permission scope, and read an MCP tool definition, its two kinds of error and its protocol version without guessing.',
    'Choose a fixed workflow over an agent when the steps are known in advance, and say what an agent adds when they are not.',
    'Bound an agent loop with a call budget, a retry budget held in one place, and an idempotency key that returns the first result instead of repeating the effect.',
    'Hold a high-impact call in an approval state a person can approve or reject, and say what the dispatcher must re-check when an approved call finally runs.',
    'Give a sub-agent only the scopes the session already holds and a call budget of its own, and keep its approvals in the operator’s queue.',
  ],
  competencies: ['tools'],
  dependsOn: ['fde-v1-m04', 'fde-v1-m06'],
  estimatedMinutes: 145,
  lessons: [
    {
      id: 'fde-v1-m06-l1',
      title: 'Tool schemas and the MCP boundary',
      summary:
        'The tool definition is where the boundary gets written down. What the schema has to enforce in your own process, why a tool that does two things should usually be two tools, what MCP’s two kinds of error are for, and what a client does with a protocol version it has never seen.',
      estimatedMinutes: 30,
      sources: [
        {
          label: 'Model Context Protocol specification 2026-07-28, Tools: inputSchema, untrusted annotations, protocol versus tool execution errors, security considerations',
          url: 'https://modelcontextprotocol.io/specification/2026-07-28/server/tools',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Model Context Protocol specification 2026-07-28, Versioning and Compatibility: per-request version and UnsupportedProtocolVersionError',
          url: 'https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Model Context Protocol specification 2025-11-25, Lifecycle: the legacy initialize version negotiation',
          url: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'MDN: typeof, including typeof null',
          url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'Adding a refund tool needs a declared input contract, current authorization, specific approval and safe effect handling. The tool definition helps describe these decisions, but it is not the only place policy exists and is not sufficient authority to move money.',
        },
        {
          kind: 'prose',
          body:
            'A tool definition describes what callers may request; the application must enforce the relevant contract at execution. A decoder or framework may enforce some structure, but cannot establish current permission, balance or consent from a schema alone. Validate the actual arguments before passing them to an effectful handler, then enforce its live business invariants.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Know which checks the chosen decoder, framework and server actually perform. Do not assume every schema is merely a hint or that external structured decoding enforces nothing. Server-side validation and authorization still guard the effect, including cases where a call reaches the handler through another path.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code: "const registry = {\n  'refunds.create': {\n    scope: 'refunds.write',\n    approval: true,\n    schema: {\n      orderId: { type: 'string', required: true },\n      amountCents: { type: 'number', required: true },\n      currency: { type: 'string', required: true, enum: ['USD', 'EUR', 'GBP'] },\n    },\n    handler: args => ledger.refund(args),\n  },\n};",
          caption: 'An illustrative custom registry, not an MCP inputSchema or full JSON Schema. Type-only amountCents accepts more than a valid financial amount; the real handler must enforce numeric/range, authorization, approval and atomic balance rules.',
        },
        {
          kind: 'prose',
          body:
            'This exercise uses a small argument-only schema language: own-field presence, JavaScript typeof and fixed enum membership. Here null is present and typeof null is object, so null for a string field is a type failure. Other schema languages define required/nullability differently and can express more than these three checks. Stateful validation still needs trusted external context.',
        },
        {
          kind: 'table',
          caption: 'Two gates, one refund. Which checks run on the arguments alone, and which need something the arguments do not carry.',
          headers: ['Check', 'Where it runs', 'Why it belongs there'],
          rows: [
            ['`currency` is one of USD, EUR, GBP', 'Schema', 'The list is fixed when the tool is registered, and the argument carries everything the check needs.'],
            ['`amountCents` is a number, not the string "24050"', 'Schema', 'One `typeof` test on one value, with no lookup behind it.'],
            ['`orderId` is present at all', 'Schema', 'Presence is structural. Whether that id names a real order is not.'],
            ['The amount is within the order’s remaining refundable balance', 'Handler', 'It needs the order, which the argument only names.'],
            ['The operator’s session holds `refunds.write`', 'Handler', 'It needs the session. No argument supplies it, and no argument may override it.'],
            ['This scenario’s refund policy requires checking current order/refund state', 'Handler', 'It needs authoritative state, and potentially a trusted clock; an arbitrary one-hour ban is not a universal refund rule.'],
          ],
        },
        {
          kind: 'trace',
          caption: 'One refund call through the gates: orderId is valid, but amountCents has the wrong type and currency is outside the enum.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Known tool', 'Scope', 'Arguments', 'Handler'],
                note: 'The assistant proposes refunds.create with { orderId: "ORD-4471", amountCents: "24050", currency: "CZK" }. The proposal is an authored fixture line, and nothing has run yet.',
              },
              {
                cells: ['Known tool', 'Scope', 'Arguments', 'Handler'],
                marks: [{ index: 0, role: 'active' }],
                note: 'refunds.create is in the registry, so the dispatcher now has a scope, a schema and a handler to work with. A name that is not registered stops here.',
              },
              {
                cells: ['Known tool', 'Scope', 'Arguments', 'Handler'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'active' },
                ],
                note: 'The session holds refunds.write, so this operator may use the tool. Authorization is answered before the arguments are read, so this response does not disclose argument-validation details to an unauthorized caller. Other discovery, timing or error channels require separate controls.',
              },
              {
                cells: ['Known tool', 'Scope', 'Arguments', 'Handler'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'active' },
                ],
                note: 'The schema runs in declaration order. orderId is a present string and passes. amountCents arrived as the string "24050" where a number was declared, so the check fails on that field.',
              },
              {
                cells: ['Known tool', 'Scope', 'Arguments', 'Handler'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'compare' },
                  { index: 3, role: 'excluded' },
                ],
                note: 'The dispatcher returns invalid_arguments for amountCents and the handler never runs. The check stops at the first failing field, so it never reaches currency. CZK would have failed too.',
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'Refuse known-invalid calls before the effect. The handler must still validate current authority, approval and business state atomically with execution; reaching a handler is not automatically the point after which all validation is impossible. Recovery or compensation depends on what actually completed.',
        },
        {
          kind: 'prose',
          body:
            'Give each tool one permission name and check it against the session. The session’s scopes come from whatever authenticated the operator; an argument called `scope` or `tenantId` is a value the model chose, and a value the model chose can never widen what the operator may do. That is the same rule M04 applied to the tenant, applied here to the verb.',
        },
        {
          kind: 'prose',
          body:
            'Marlbrook’s combined orders.manage tool used one broad grant for read and refund. Splitting the tools/scopes makes least-privilege grants easier to express. A combined tool can also be safe if it enforces distinct operation permissions correctly; a mode argument does not inherently require granting every branch.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Separate tool definitions when they make authority, approval, input contracts and audit clearer. Shared implementation code can remain behind them. If operations need different permissions, enforce those distinctions whether the public interface is split or combined; tool count alone does not prove least privilege.',
        },
        {
          kind: 'prose',
          body:
            'MCP standardizes how a client discovers and calls a server’s tools. In the 2026-07-28 revision a tool definition carries a `name`, a `description` and an `inputSchema`, and that schema MUST be a valid JSON Schema object. This exercise uses a smaller in-process registry instead. Its per-field type objects are not an MCP `inputSchema`, and a real `inputSchema` can express ranges, patterns and nested objects that this one cannot.',
        },
        {
          kind: 'prose',
          body:
            'The same page puts enforcement on the server’s side of the wire. Servers MUST validate all tool inputs, implement access controls, rate limit tool invocations and sanitize tool outputs. Clients MUST treat tool annotations as untrusted unless they come from a trusted server, and SHOULD show tool inputs to the user before calling the server. A published schema tells your client what to send. It does not prove that the server checks it.',
        },
        {
          kind: 'table',
          caption: 'The two kinds of failure in the MCP 2026-07-28 tools page, and the dispatcher result that plays the same role in this exercise.',
          headers: ['MCP failure', 'What it covers', 'How it comes back', 'The dispatcher’s counterpart'],
          rows: [
            ['Protocol error', 'An unknown tool, a malformed request, a server error', 'A JSON-RPC error. Clients MAY pass it to the model, though the model is less likely to recover', '`unknown_tool`'],
            ['Tool execution error', 'An API failure, an input validation error, a business-logic error', 'A normal result with `isError: true`. Clients SHOULD pass it to the model so it can correct the call', '`invalid_arguments`, `tool_failed`'],
          ],
        },
        {
          kind: 'prose',
          body:
            'Read the revision your client implements. In 2026-07-28 every request declares its protocol version in `_meta`. A server that does not implement that version MUST answer with an UnsupportedProtocolVersionError, code -32022, listing the versions it supports, and the client SHOULD retry with a mutually supported version or surface an error to the user. Legacy revisions, 2025-11-25 and earlier, open with an `initialize` handshake instead; there, a client that does not support the version the server chose SHOULD disconnect. Neither flow lets you read an unknown version as one you know.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Unknown fields and unknown protocol versions need their documented compatibility rules. Ignoring a field is safe only when the contract permits it; authorization, required semantics or extensions may depend on that field. Parsing bytes successfully does not establish protocol support.',
        },
      ],
    },
    {
      id: 'fde-v1-m06-l2',
      title: 'The agent loop, approval and sub-agents',
      summary:
        'When a fixed workflow beats an agent, how a call budget stops the loop, why an approval step needs a reject path, and what a sub-agent may hold. Retry budgets and idempotency keys close the lesson.',
      estimatedMinutes: 35,
      sources: [
        {
          label: 'Anthropic, “Building effective agents” (19 December 2024): workflows versus agents, the simplest solution first, stopping conditions, human checkpoints, orchestrator-workers',
          url: 'https://www.anthropic.com/research/building-effective-agents',
          reviewedOn: '2026-11-27',
        },
        {
          label: 'Model Context Protocol specification 2026-07-28, Tools: a human in the loop with the ability to deny tool invocations',
          url: 'https://modelcontextprotocol.io/specification/2026-07-28/server/tools',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'OWASP GenAI Security Project, LLM06:2025 Excessive Agency: human approval for high-impact actions, minimum extensions and permissions',
          url: 'https://genai.owasp.org/llmrisk/llm062025-excessive-agency/',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Snowflake, Staff Applied AI Engineer (FDE) posting: safety guardrails, observability and human-review workflows',
          url: 'https://jobs.ashbyhq.com/snowflake/12455179-f3ff-4739-b8c0-c21f3c116b87',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Harvey, Founding Forward Deployed Engineer posting on Built In (listing removed 9 February 2026): tool use/agents and guardrails',
          url: 'https://builtin.com/job/forward-deployment-engineer/7406694',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'RFC 9110, HTTP Semantics, section 9.2.2: idempotent methods',
          url: 'https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'FDE postings name this work in plain terms. Snowflake’s Staff Applied AI Engineer (FDE) posting asks you to build “the safety guardrails, observability, and human-review workflows” that keep AI applications reliable. Harvey’s founding FDE posting listed “tool use/agents, prompts, and guardrails” among the parts you customize for a client. This lesson covers the loop that lets a model act, the approval that can stop it, and the sub-agent that does part of the work under a smaller grant.',
        },
        {
          kind: 'prose',
          body:
            'Anthropic’s “Building effective agents” draws the line this module uses. A workflow orchestrates the model and its tools “through predefined code paths”. An agent lets the model “dynamically direct” its own process and tool use. The essay advises the simplest solution that works, and more complexity only when it pays: workflows give predictability for well-defined tasks, and agents fit when the task needs model-driven decisions at scale.',
        },
        {
          kind: 'table',
          caption: 'Four Marlbrook requests and the build each one needs. Start from the top row and move down only when the task forces you to.',
          headers: ['Request', 'Build', 'Why'],
          rows: [
            [
              'Sync 4,000 ledger rows every night',
              'Deterministic code, no model',
              'Nothing in the job needs language. A model adds cost, latency and a failure mode.',
            ],
            [
              'Put each incoming ticket in one of four queues',
              'One model call inside a workflow',
              'One decision with one output you can validate, as in M06.',
            ],
            [
              'Refund an order the customer named: read it, check the balance, propose the refund',
              'A fixed workflow that may call a model for one step',
              'You know the steps and their order before the request arrives, so you can test every branch.',
            ],
            [
              'Find out why an invoice disagrees across three systems whose records you cannot predict',
              'An agent with a call budget and an approval step',
              'The next lookup depends on what the last one returned. You cannot write the path down first.',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'An agent loop repeats four steps. The model proposes a tool call. Your dispatcher runs the gates from the first lesson. The result, a success or a refusal, goes back to the model. The model proposes again or says it is done. The model chooses the next call; your code chooses whether that call runs, how many calls the loop gets and when a person must decide. Anthropic’s essay names stopping conditions “such as a maximum number of iterations” as the way to keep control, and describes agents that “pause for human feedback at checkpoints”.',
        },
        {
          kind: 'trace',
          caption: 'An authored agent run whose loop allows three calls. The loop counts them, not the dispatcher. Every proposal in it is a fixture line written for this lesson.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Call 1', 'Call 2', 'Call 3', 'Approval', 'Call 4'],
                marks: [{ index: 0, role: 'active' }],
                note: 'The proposal is orders.read with { status: "open" }. The dispatcher runs it and returns { count: 2 } to the loop.',
                counter: { label: 'Calls left in the budget', value: 2 },
              },
              {
                cells: ['Call 1', 'Call 2', 'Call 3', 'Approval', 'Call 4'],
                marks: [{ index: 0, role: 'settled' }, { index: 1, role: 'active' }],
                note: 'The proposal is refunds.create with amountCents "24050", a string. The dispatcher returns invalid_arguments for amountCents. That refusal is a correctable error, so the loop hands it back to the model.',
                counter: { label: 'Calls left in the budget', value: 1 },
              },
              {
                cells: ['Call 1', 'Call 2', 'Call 3', 'Approval', 'Call 4'],
                marks: [{ index: 1, role: 'settled' }, { index: 2, role: 'active' }],
                note: 'The corrected proposal passes every gate and stops at approval: pending_approval, CALL-1. The loop pauses. Nothing has been refunded.',
                counter: { label: 'Calls left in the budget', value: 0 },
              },
              {
                cells: ['Call 1', 'Call 2', 'Call 3', 'Approval', 'Call 4'],
                marks: [{ index: 2, role: 'settled' }, { index: 3, role: 'active' }],
                note: 'The operator reads the pending call: refunds.create, ORD-4471, 24050 cents, USD. They approve it, and the refund runs once. Approving spends nothing from the model’s budget.',
                counter: { label: 'Calls left in the budget', value: 0 },
              },
              {
                cells: ['Call 1', 'Call 2', 'Call 3', 'Approval', 'Call 4'],
                marks: [{ index: 3, role: 'settled' }, { index: 4, role: 'excluded' }],
                note: 'The next proposal is a second refund for ORD-4472. The loop’s budget is spent, so the loop never sends it to the dispatcher and hands the task back to the operator. In the exercise, a sub-agent created with maxCalls: 3 returns budget_exhausted at this point.',
                counter: { label: 'Calls left in the budget', value: 0 },
              },
            ],
          },
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Every model proposal in this lesson and in the exercise is an authored fixture. No model runs anywhere in this module. A live model would not reproduce this sequence: it might skip the correction, repeat a call or stop early. Your gates have to hold for every sequence a model could send, not for this one.',
        },
        {
          kind: 'prose',
          body:
            'The MCP specification says there SHOULD always be a human in the loop with the ability to deny tool invocations. OWASP’s LLM06:2025 Excessive Agency entry says to use human-in-the-loop control “to require a human to approve high-impact actions before they are taken”. Read “deny” as a requirement: an approval step needs a reject path that ends the call. The dispatcher in the exercise keeps each held call in one of three states: pending, approved (it ran once) or rejected (it never runs, and approving it later finds nothing).',
        },
        {
          kind: 'prose',
          body:
            'Approval is the last bound, and the easiest one to fake. An approval means a person agreed to a specific effect, which is only true if they saw the effect: the tool name, the validated arguments the dispatcher will actually pass, the record it lands on, and the amount. "Approve this refund?" with no number on the screen is a button, not an approval.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Show the actual validated action, order, amount and currency in understandable terms; a rendered raw object alone is not necessarily usable consent. Bind an immutable snapshot or trusted server reference to that exact request. Model wording cannot alter the approved effect, and the server still enforces authority and current business rules.',
        },
        {
          kind: 'trace',
          caption: 'A hypothetical approval for the full 24050-cent remaining balance, reserving nothing. A colleague refunds it fully before execution; compare unchecked versus atomically checked execution.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Approval shown', 'Operator approves', 'Order changes', 'Call executes'],
                marks: [{ index: 0, role: 'active' }],
                note: '09:12. The dispatcher holds refunds.create for ORD-4471, 24050 cents, USD, and shows the operator those exact arguments. Nothing has run, and nothing has been refunded.',
                counter: { label: 'Refunded on ORD-4471, cents', value: 0 },
              },
              {
                cells: ['Approval shown', 'Operator approves', 'Order changes', 'Call executes'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'active' },
                ],
                note: '09:12. The operator approves. The dispatcher records that a person agreed to this effect and holds the call in a pending state.',
                counter: { label: 'Refunded on ORD-4471, cents', value: 0 },
              },
              {
                cells: ['Approval shown', 'Operator approves', 'Order changes', 'Call executes'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'active' },
                ],
                note: '09:15. A colleague refunds the same order by hand in the billing tool. ORD-4471 now carries 24050 cents of refund, and the pending approval knows nothing about it.',
                counter: { label: 'Refunded on ORD-4471, cents', value: 24050 },
              },
              {
                cells: ['Approval shown', 'Operator approves', 'Order changes', 'Call executes'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'active' },
                ],
                note: '09:17, with no re-check. The dispatcher runs the approved call because a person approved it, and the customer is refunded twice for one charge.',
                counter: { label: 'Refunded on ORD-4471, cents', value: 48100 },
              },
              {
                cells: ['Approval shown', 'Operator approves', 'Order changes', 'Call executes'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'excluded' },
                ],
                note: '09:17, with the re-check in place. The handler atomically checks current authorization/approval and remaining balance with the effect. It sees zero remaining after the full manual refund and refuses; a separate earlier read would still leave a race. The operator gets the call back with the reason and the new balance instead of a second refund.',
                counter: { label: 'Refunded on ORD-4471, cents', value: 24050 },
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'At execution, enforce approval identity and relevant current state together with the effect, using a transaction, conditional write or the provider’s equivalent safe contract. A version/ETag/fingerprint can support this binding but does not by itself enforce authority or prevent a check-then-write race. If changed state invalidates the approved effect, refuse or request a fresh decision under policy. The memory exercise snapshots primitive arguments but does not implement these external-state controls.',
        },
        {
          kind: 'prose',
          body:
            'Anthropic’s orchestrator-workers pattern has a central model break a task down, delegate the parts to worker models and combine their results. This module calls each worker a sub-agent. The scope rule from the first lesson carries over: a sub-agent holds only the scopes it asked for that the operator’s session already holds, so asking for more grants nothing. The call budget from the loop above applies per sub-agent: each one gets its own, counted per call, so a worker stuck in a loop stops at its cap.',
        },
        {
          kind: 'table',
          caption: 'One delegation in the exercise: the session holds orders.read and ledger.write, and the orchestrator calls delegate({ scopes: ["ledger.write", "refunds.write"], maxCalls: 4 }).',
          headers: ['Question', 'Answer in the exercise', 'Why'],
          rows: [
            ['Which scopes does the sub-agent hold?', 'ledger.write only', 'refunds.write is not in the session, and a request is not a grant. OWASP LLM06 calls this excess “excessive permissions”.'],
            ['What does its fifth call return?', 'budget_exhausted, before any gate runs', 'Every call counts, refused or not. Retries inside one call count once.'],
            ['Who settles a refund it proposes?', 'Nobody here: it holds no refunds.write, so refunds.create returns scope_denied', 'A sub-agent whose grant does include refunds.write gets pending_approval instead. That call joins the operator’s queue with the next CALL number, and the operator settles it through the parent dispatcher’s approve or reject. The sub-agent has neither.'],
            ['Can it replay the parent’s idempotency key?', 'No: its keys live in its own store', 'A shared store would hand it a result its own scopes could not have produced.'],
          ],
        },
        {
          kind: 'prose',
          body:
            'Two more bounds keep a single call honest. Nested retry layers multiply attempts: three retries means four total attempts at a layer, and three such layers can issue 4×4×4=64 underlying attempts, not 27. Coordinate retry eligibility, counts, deadlines and delay policy across layers instead of assuming a dispatcher count sees hidden client retries.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'A retry budget bounds how many times you try. It says nothing about what each try did. Retrying `refunds.create` after a timeout can refund the order twice, because a timeout tells you the response never arrived, not that the effect never happened.',
        },
        {
          kind: 'prose',
          body:
            'RFC 9110 calls a method idempotent when the intended effect of several identical requests equals the effect of one. The definition covers the intended effect on the server; two responses may still differ. A stable key enables deduplication only when the receiver enforces the documented scoped operation contract against concurrency and crashes. Bind request identity and result, state which failures are retained and define the retention window. Merely sending a key does not make arbitrary repeated financial effects safe.',
        },
        {
          kind: 'table',
          caption: 'What the key has to do, and four ways teams lose the property they thought they had.',
          headers: ['Rule', 'What it means', 'What breaks without it'],
          rows: [
            [
              'One key per intended effect',
              'The caller mints it once, before the first attempt, and reuses it for every retry of that effect.',
              'A key generated per attempt makes every retry a new call, which is exactly the duplicate you were preventing.',
            ],
            [
              'Define the replay response',
              'Retain enough state or a reference to provide the promised replay response.',
              'A seen marker can support a duplicate acknowledgement, but cannot reconstruct the original response unless that response is stored or resolvable.',
            ],
            [
              'Define pending, success, rejection and failure retention explicitly',
              'The toy dispatcher keeps success, pending and rejected results and clears failed execution; real services may retain some failures or in-progress claims.',
              'A retry must follow the service’s key/payload contract; a changed intended operation may require a new key rather than overwriting old meaning.',
            ],
            [
              'Keys use an explicitly authorized namespace',
              'Authorize the namespace before lookup; a shared table can safely enforce a tenant/caller/operation boundary.',
              'Without a trusted namespace and access check, cross-tenant key collisions can expose another caller’s result.',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'The exercise deliberately uses one immutable trusted session per dispatcher instance and replays its cached key before new gates, even if the later tool/arguments differ. This is a bounded toy contract, not a recommended production authorization order. A real service must authorize cached-result access, bind the intended operation/payload, handle concurrency durably and define failure/expiry semantics. Clearing a failed key is unsafe if the effect may already have happened without a recorded result.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'An approval is not a permission grant. Approving one refund does not add `refunds.write` to a session that lacked it, and it does not authorize the next refund. Production execution must check relevant current authority even for approved operations. The exercise instead assumes a fixed trusted session for its entire short lifetime.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m06-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: tool schemas and the MCP boundary',
      summary: 'Custom schema limits, operation permissions, MCP’s two kinds of tool error and revision-specific version handling.',
      competencies: ['tools'],
      estimatedMinutes: 30,
      lessonId: 'fde-v1-m06-l1',
    },
    {
      id: 'fde-v1-m06-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: the agent loop, approval and sub-agents',
      summary: 'Workflow or agent, a call budget as the stopping rule, approve and reject, sub-agent grants, and retry and idempotency limits.',
      competencies: ['tools'],
      estimatedMinutes: 35,
      lessonId: 'fde-v1-m06-l2',
    },
    {
      id: 'fde-v1-m06-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Tool and agent boundary checks',
      summary: 'Six decisions: static argument validation, documented version compatibility, policy-required approval, current preconditions enforced with the effect, workflow versus agent, and a sub-agent’s grant.',
      competencies: ['tools'],
      estimatedMinutes: 20,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-m06-q1',
          prompt: "This tool uses a static argument-only JSON Schema with a fixed currency allowlist; it performs no stateful lookups. Before refunds.create can move money, which check can that schema decide from {orderId, amountCents, currency} alone?",
          options: [
            "currency is one of the fixed allowed values USD, EUR or GBP.",
            '`amountCents` must not exceed the order’s remaining refundable balance.',
            'The operator’s session must hold the `refunds.write` scope.',
            'The order must have no refund recorded against it in the last hour.',
          ],
          correct: 0,
          explanation: "The fixed enum can be checked from the submitted currency alone. Remaining balance, current session scope and recent refunds require trusted live state and separate operation checks. A custom validator could be supplied such context, but that is outside this stated argument-only schema; it does not make model-chosen claims authoritative. All required checks still apply before the effect, with mutable preconditions protected against races. Structural validity is not permission or a guarantee of available funds.",
          competencies: ['tools'],
        },
        {
          id: 'fde-v1-m06-q2',
          prompt: "A tool response declares a protocol version your client cannot interpret. Which condition must hold before the client uses that versioned tool list or invokes its tools?",
          options: [
            "Establish a mutually supported version through the protocol’s documented flow; otherwise stop with a compatibility error.",
            'Read the tool list and ignore any field it does not recognise, since protocol changes are additive by convention.',
            'Read the tool list under the newest version the client implements and log a warning, since the server will reject anything it cannot handle.',
            'Fall back automatically to the oldest version the client still supports, so the widest range of servers keeps working.',
          ],
          correct: 0,
          explanation: "Do not treat an unsupported payload version as compatible because its JSON parses or some fields look familiar. Follow the protocol revision actually in use. In modern MCP 2026-07-28, requests declare their version; an UnsupportedProtocolVersionError lists supported versions so the client can select a common one and retry, or report no compatible version. Legacy initialization-based revisions say the client SHOULD disconnect when the server-selected version is unsupported. Neither flow licenses guessing the oldest/newest version or silently reinterpreting unknown semantics. Any retry must also respect the normal operation and retry policy.",
          competencies: ['tools'],
        },
        {
          id: 'fde-v1-m06-q3',
          prompt: "Company policy allows the listed scoped reads and unsent local drafts automatically, but requires human approval for transfers of money. All four calls already pass current session-scope checks. Which call additionally needs the policy’s approval?",
          options: [
            "refunds.create, which moves money and is not undone by simply rerunning the assistant.",
            '`orders.read`, which returns orders the operator can already open in the admin console.',
            '`tickets.search`, which searches the operator’s own tenant and returns ticket summaries.',
            '`draft.compose`, which writes a reply into the operator’s editor that nobody sends until they press send.',
          ],
          correct: 0,
          explanation: "The explicit money-transfer policy adds approval for refunds.create; session authorization remains a separate requirement. The listed reads and unsent local draft are permitted automatically in this scenario. That does not make every read harmless or establish a universal rule that reads never need approval: sensitive exports and other policies may differ. Keep the draft visible and reversible before its separate send action. An approval should cover the actual effect/parameters and must not replace current authorization or live business checks.",
          competencies: ['tools'],
        },
        {
          id: 'fde-v1-m06-q4',
          prompt: "Approval records intent but reserves no balance. At 09:12 an operator approved a 24050-cent refund, equal to the remaining refundable balance. A colleague fully refunded that order at 09:15; the dispatcher reaches the approved call at 09:17. Why must it revalidate before the effect?",
          options: [
            "Approval reserved nothing, so check authorization, balance and replay atomically with the refund, and refuse it.",
            'The approval has gone stale: approvals must expire in under five minutes, and 09:12 to 09:17 is five.',
            'The dispatcher cannot rely on the operator’s judgement, so it re-evaluates the decision itself before acting.',
            'The retry budget resets when a call is approved, so the call has to be re-validated to avoid a duplicate attempt.',
          ],
          correct: 0,
          explanation: "The approval refers to the described effect, not a guarantee that its mutable preconditions remain true. Here the refundable balance is now zero, so the approved amount is no longer allowed. Enforce the live checks together with the effect using the appropriate transaction/conditional operation so another change cannot race between checking and writing. Approval expiry can be an additional policy control, but no universal five-minute limit follows from this example. Revalidation is not replacing the operator’s judgement; it applies current facts and permission. A retry budget alone does not prevent duplicate writes or reserve funds.",
          competencies: ['tools'],
        },
        {
          id: 'fde-v1-m06-q5',
          prompt: 'Marlbrook’s finance team wants refunds handled faster. Every request names an order id, and the steps never change: read the order, check the remaining balance, then propose the refund for a person to approve. Which build fits this task?',
          options: [
            'A fixed workflow: code runs the three steps in order and calls a model only for a step that needs language, such as reading a free-text reason.',
            'An agent holding all three tools with a ten-call budget, so the model picks the order of the steps for each request.',
            'An orchestrator that hands the read, the balance check and the refund proposal to three sub-agents and merges their answers.',
            'An agent holding all three tools with no call budget, because the approval at the end already stops any wrong refund.',
          ],
          correct: 0,
          explanation: 'You know the steps and their order before the request arrives, which is the case Anthropic’s essay gives to workflows: they “offer predictability and consistency for well-defined tasks”. A fixed path also lets you test each step on its own. The ten-call agent is bounded, but it spends model calls choosing an order you already know and creates call sequences you now have to test. Three sub-agents turn a three-step path with nothing to decide into three model contexts, adding cost and latency and three more grants to scope. The agent with no budget asks approval to do a job it cannot do: the operator sees the final refund proposal, not the reads and loops that ran before it, and only a budget bounds those.',
          competencies: ['tools'],
        },
        {
          id: 'fde-v1-m06-q6',
          prompt: 'The operator’s session holds orders.read and ledger.write. An orchestrator calls delegate({ scopes: ["ledger.write", "refunds.write"], maxCalls: 4 }), and on its third call the sub-agent proposes refunds.create for 900 cents with valid arguments. What does the dispatcher return?',
          options: [
            'scope_denied for refunds.write, because the sub-agent holds only the requested scopes the session already has, which is ledger.write.',
            'pending_approval with the next CALL id, because the sub-agent requested refunds.write and a person approves every refund anyway.',
            'budget_exhausted, because a sub-agent that reaches for a tool outside its task loses the rest of its calls.',
            'A completed refund of 900 cents, because the sub-agent has calls left in its budget of four and the arguments validate.',
          ],
          correct: 0,
          explanation: 'A sub-agent’s grant is the intersection of what it asked for and what the session holds. refunds.write is not in the session, so the request grants nothing, and the scope gate refuses before the arguments or the approval step run. Returning pending_approval would let a sub-agent widen the operator’s permissions and then ask the operator to approve the result; approval never adds a scope. budget_exhausted is wrong: this is only the third of four calls, and no rule takes calls away for reaching outside the grant. The refused call uses one unit and leaves one. A completed refund skips both the scope gate and the approval that refunds.create requires.',
          competencies: ['tools'],
        },
      ],
    },
    {
      id: 'fde-v1-m06-tool-dispatcher',
      kind: 'code',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'The tool dispatcher with approval and sub-agents',
      summary: 'One dispatcher that refuses an unknown tool, an unheld scope and an invalid argument, bounds retries, replays an idempotency key, holds a refund until a person approves or rejects it, and gives a sub-agent a narrower grant and its own call budget.',
      competencies: ['tools'],
      estimatedMinutes: 60,
      code: {
        language: 'javascript',
        prompt:
          'Write `createDispatcher(registry, session)`, returning `{ call, approve, reject, pending, delegate }`. It is the single place where a proposed tool call turns into an effect, so every boundary in this module lands in it.\n\n`registry` maps a tool name to `{ scope, schema, handler, approval?, maxAttempts? }`. A `schema` maps an argument name to `{ type, required, enum? }`, where `type` is compared with `typeof`. `session` is `{ operatorId, scopes }`, and `scopes` is the only place a permission may come from.\n\n`call(name, args, options)` works through the gates in this order and stops at the first refusal.\n\n1. **Idempotency replay.** When `options.idempotencyKey` is a key this dispatcher has already recorded, return the recorded result immediately and do nothing else, whatever name and arguments arrived with it.\n2. **Unknown tool.** A name that is not in `registry` gives `{ ok: false, reason: \'unknown_tool\', tool: name }`.\n3. **Scope.** When `session.scopes` does not contain the tool’s `scope` exactly, give `{ ok: false, reason: \'scope_denied\', scope: <the tool’s scope> }`. Match the whole string: a session holding `refunds` does not hold `refunds.write`.\n4. **Arguments.** Walk the schema fields in declaration order. A required field that is absent gives `problem: \'missing\'`; a present value whose `typeof` is not the declared `type` gives `\'type\'`; a present value outside a declared `enum` gives `\'enum\'`. Then walk the supplied arguments: any key the schema does not declare gives `\'unknown\'`. The first failure returns `{ ok: false, reason: \'invalid_arguments\', field, problem }` and the handler never runs. An absent optional field is fine, and `null` where a string was declared is a type failure, not a missing one.\n5. **Approval.** A tool with `approval: true` does not run. Store a private shallow snapshot of the validated primitive arguments and return `{ ok: false, reason: \'pending_approval\', callId }`, where `callId` is `\'CALL-1\'` for the first pending call this dispatcher creates, `\'CALL-2\'` for the second, and so on.\n6. **Execute.** Call `handler(args)`, retrying while it throws until `maxAttempts` attempts in total have been made. Missing `maxAttempts` means one attempt. Success gives `{ ok: true, value, attempts }`; exhausting the budget gives `{ ok: false, reason: \'tool_failed\', attempts, error }`, where `error` is the `message` of the last error thrown.\n\n**The approval state.** Every held call is pending until a person settles it, once.\n\n- `approve(callId)` runs a pending call under the same retry rules and returns the same shapes.\n- `reject(callId)` removes a pending call without running it and returns `{ ok: false, reason: \'rejected\', callId }`.\n- `pending()` returns `[{ callId, tool, args }]` for every call still pending, oldest first, where `tool` is the registry name and `args` is a fresh copy of the stored snapshot. Changing what `pending()` returned changes nothing inside the dispatcher.\n- A `callId` that is unknown, or already approved or rejected, gives `{ ok: false, reason: \'unknown_call\' }` from `approve` and `reject` alike, and runs nothing.\n\nAn idempotency key records a call that produced a result: an `ok: true` execution, a pending approval or a rejection. A replayed key therefore returns the same `callId` instead of queuing a second refund, and a rejected refund stays rejected under its key. A gate refusal and a `tool_failed` are not recorded, so the caller can correct the call and use the same key again, and an approval that ran and failed clears its key.\n\n**Sub-agents.** `delegate({ scopes, maxCalls })` returns a sub-agent `{ call }` and nothing else: a sub-agent cannot approve or reject.\n\n- The sub-agent holds only the entries of `scopes` that `session.scopes` already contains, compared as whole strings. A `scopes` value that is not an array grants nothing.\n- `maxCalls` is the number of calls the sub-agent may make. Missing, or anything other than a positive integer, means `0`.\n- Each `call(name, args, options)` first checks the budget: when the sub-agent has already made `maxCalls` calls, return `{ ok: false, reason: \'budget_exhausted\', maxCalls }` and do nothing else. Otherwise the call uses one unit, whatever happens next, and then runs the same six gates with the sub-agent’s scopes. Retries inside one call do not use more units.\n- A sub-agent keeps its idempotency keys in its own store, separate from the dispatcher’s and from other sub-agents’.\n- A sub-agent’s held call joins the dispatcher’s queue, takes the next `CALL-n` number from the same sequence, and is settled through the dispatcher’s `approve` or `reject`. When it settles, the result is recorded under the sub-agent’s own key.\n\nDomain: one immutable trusted tenant/operator authorization context per dispatcher. Registry, session and schema stay fixed; at most 10 tools/scopes/schema fields, 5 sub-agents and 50 calls are used. Tool names, argument names and idempotency keys are strings of at most 100 UTF-16 units. Schemas use string/number/boolean typeof rules and primitive enums. Arguments are ordinary own enumerable flat primitive fields, optionally missing/null as a whole; no getters, proxies, nested mutable values or prototype tricks. maxAttempts is absent or an integer 1–3. Handlers are synchronous, return bounded JSON-like values, and throw Error objects on the authored transient failures. Treat returned results as read-only.\n\nThe early replay path is valid only for this fixed trusted instance; it is not production authentication, durable/concurrent idempotency or authorization of cached results. approve and reject represent already trusted decisions, not verification of a human identity. The exercise has no current-order store, provider transaction, approval expiry or revocation mechanism. Its unconditional throw-retry and failed-key clearing are fixture contracts, not safe defaults for real financial effects.\n\nEvery tool here is a synthetic fixture, and so is every proposed call the tests send: no model writes them. The handlers push to an array and return authored values; nothing calls a provider, opens a socket or waits on a timer, so a failing handler is a thrown `Error` rather than real network behaviour.',
        contract: [
          'Read permissions only from `session.scopes`, and compare whole scope strings. No argument and no sub-agent request may widen what the session holds.',
          'No handler runs until the tool is known, the scope is held and the arguments have validated, and a tool with `approval: true` runs only through `approve`.',
          'Count attempts once, in the dispatcher. Do not add a second retry loop inside the argument checks or around `approve`.',
          'Check a sub-agent’s call budget before anything else it does, and count every call it makes.',
          'Do not mutate `registry` or `session`, and keep the recorded keys, pending calls and sub-agent budgets inside the dispatcher you return.',
          'Everything is in memory: no network, no timers, no imports.',
        ],
        starter: `const createDispatcher = (registry, session) => {

  return {
    call: (name, args, options) => {

    },
    approve: callId => {

    },
    reject: callId => {

    },
    pending: () => {

    },
    delegate: spec => {

    },
  };
};

// Scratch pad: change this before submitting.
const demoRegistry = {
  'orders.read': {
    scope: 'orders.read',
    schema: { status: { type: 'string', required: false, enum: ['open', 'closed'] } },
    handler: args => ({ count: args.status === 'closed' ? 1 : 2 }),
  },
};
const demoSession = { operatorId: 'USR-31', scopes: ['orders.read'] };
const demo = createDispatcher(demoRegistry, demoSession);

console.log(JSON.stringify(demo.call('orders.read', { status: 'open' })));
console.log(JSON.stringify(demo.call('refunds.create', { orderId: 'ORD-4471' })));
`,
        skeleton: `const createDispatcher = (registry, session) => {
  const held = /* the scopes the session was issued */;
  const completed = Object.create(null); // idempotency key -> the result already returned
  const waiting = Object.create(null);   // callId -> the call waiting for a person
  const queue = [];     // callIds still waiting, oldest first
  let nextId = 1;

  const validate = (schema, args) => {
    for (const name of Object.keys(schema || {})) {
      // absent: 'missing' when required, otherwise skip
      // present: 'type' when typeof disagrees, then 'enum' when a list excludes it
    }
    // any supplied key the schema does not declare is 'unknown'
    return null;
  };

  const run = (tool, args) => {
    const budget = /* maxAttempts, or one */;
    // call the handler, catching a throw, until the budget is spent
  };

  const gate = (scopes, keys, name, args, options) => {
    // 1 replay from keys  2 unknown tool  3 scope against scopes
    // 4 arguments  5 approval: remember which key store to settle later  6 execute
  };

  const approve = callId => {
    // take the call out of waiting and queue so it cannot settle twice, then run it
  };

  const reject = callId => {
    // take the call out the same way, run nothing, record the rejection under its key
  };

  const pending = () => /* a fresh { callId, tool, args } per waiting call */;

  const delegate = spec => {
    const scopes = /* the requested scopes the session already holds */;
    const maxCalls = /* a positive integer, otherwise 0 */;
    const keys = Object.create(null);
    let used = 0;
    return {
      call: (name, args, options) => {
        // budget first, then one unit used, then the same gates with these scopes
      },
    };
  };

  return { call: (name, args, options) => gate(held, completed, name, args, options), approve, reject, pending, delegate };
};`,
        hints: [
          'Do the idempotency lookup first, before you even look the tool up. `Object.prototype.hasOwnProperty.call(completed, key)` is the test you want, because a key like `"constructor"` is truthy on a plain object without ever having been stored. Keep the stores as `Object.create(null)` maps too: on a plain object, assigning a key named `"__proto__"` replaces the prototype instead of storing the result.',
          'Validation has two passes over one object. The first walks `Object.keys(schema)` and checks presence, then `typeof`, then `enum`. The second walks `Object.keys(args)` and rejects any name the schema does not declare. Return the first failure you find and let the caller turn it into a result.',
          'Write the gates once, as a helper that takes the scopes and the key store to use, so the dispatcher and every sub-agent share the same code. A sub-agent then differs only in what it passes in and in the budget check it runs first.',
          'Store the key store and the key with each waiting call. `approve` and `reject` can then record the outcome where the original caller will replay it, whether that caller was the dispatcher or a sub-agent.',
        ],
        approach: [
          'Capture `session.scopes` and set up the dispatcher state: the recorded results by idempotency key, the waiting calls by callId, the queue order and the next callId number.',
          'Write `validate(schema, args)` so it returns `{ field, problem }` for the first failure or `null`, covering missing, type, enum and undeclared keys in that order.',
          'Write `run(tool, args)` so it attempts the handler up to `maxAttempts` times, returning the value and the attempt count on success and `tool_failed` with the last message when the budget runs out.',
          'Write `gate(scopes, keys, name, args, options)` as the six gates in order, recording an `ok: true` result or a pending approval under the idempotency key and recording nothing else.',
          'Write `approve` and `reject` so each removes the waiting call before doing anything, then settles the key the call was made under; write `pending` to copy what is still waiting.',
          'Write `delegate` so it intersects the requested scopes with the session’s, fixes the budget, and returns a `call` that checks and spends the budget before it hands over to `gate`.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'The dispatcher returns the right shapes and numbers its calls',
            critical: true,
            weight: 3,
            detail:
              'Something outside the security gates is off. Check that a valid in-scope call returns `{ ok: true, value, attempts }`, that an unknown name returns `unknown_tool` with the name attached and touches no handler, and that pending calls are numbered `CALL-1`, `CALL-2` and so on per dispatcher.',
          },
          {
            id: 'scope-enforced',
            label: 'A tool outside the session’s scopes never executes, for the dispatcher or a sub-agent',
            critical: true,
            weight: 3,
            detail:
              'The permission gate did not hold. Either a tool ran for a session that did not hold its scope, or the comparison matched something it should not: a scope check that uses a prefix, a substring or a joined string will let `refunds` stand in for `refunds.write`. The scope refusal also has to come before the argument checks. A sub-agent must hold only the requested scopes the session already holds, and must not replay a key the dispatcher recorded.',
          },
          {
            id: 'validated-before-effect',
            label: 'Invalid arguments never reach a handler',
            critical: true,
            weight: 3,
            detail:
              'An argument check ran too late or too loosely. Confirm that a missing required field, a wrong `typeof`, a value outside an `enum` and an undeclared key each refuse with the right `field` and `problem`, that the handler log stays empty when they do, that an absent optional field passes, that `amountCents: 0` passes, and that `null` where a string was declared is a `type` failure rather than a `missing` one.',
          },
          {
            id: 'approval-held',
            label: 'A call that needs approval runs only after a person approves it, and never after a rejection',
            critical: true,
            weight: 3,
            detail:
              'The approval state did not hold. A tool with `approval: true` must return `pending_approval` and leave the handler log empty until `approve`, including when a sub-agent proposed it. `approve` must run the stored snapshot exactly once, `reject` must end the call without running it, and either one on a settled or unknown callId must return `unknown_call`. `pending()` must list what is still waiting with a copy of the validated arguments. A sub-agent’s approved or rejected call must be recorded under that sub-agent’s key, not the dispatcher’s.',
          },
          {
            id: 'subagent-budget',
            label: 'A sub-agent stops at its call budget',
            critical: true,
            weight: 3,
            detail:
              'A sub-agent made more calls than it was given. Check that the budget is tested before any other gate, that every call uses one unit whether it succeeds or is refused, that retries inside one call use one unit, that a missing, zero, negative, fractional, infinite or string budget refuses the first call, that a replayed idempotency key still spends the budget first, and that two sub-agents keep separate budgets.',
          },
          {
            id: 'retry-budget',
            label: 'A failing tool is attempted at most maxAttempts times',
            critical: false,
            weight: 2,
            detail:
              'The attempt count is wrong. Check that a tool declaring three attempts is called three times and no more when it always throws, that it stops as soon as one attempt succeeds, that the returned `attempts` matches how often the handler actually ran, and that a tool with no `maxAttempts` gets exactly one attempt.',
          },
          {
            id: 'idempotent-calls',
            label: 'A repeated idempotency key returns the first result without re-executing',
            critical: false,
            weight: 2,
            detail:
              'The replay path is not returning the stored call. Check that a second call with a seen key returns the identical result and leaves the handler log unchanged, that it does so even when the tool name and arguments differ, and that replaying the key of a pending approval hands back the same `callId` instead of creating a second pending refund.',
          },
        ],
        tests: [
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); return d.call('orders.read', { status: 'open' }); })()",
            expected: { ok: true, value: { count: 2 }, attempts: 1 },
            label: 'an in-scope call with valid arguments runs once and returns its value',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var out = d.call('orders.purge', {}); return { out: out, ran: f.log.length }; })()",
            expected: { out: { ok: false, reason: 'unknown_tool', tool: 'orders.purge' }, ran: 0 },
            label: 'an unregistered tool name refuses and reaches no handler',
            edge: true,
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var a = d.call('refunds.create', { amountCents: 24050, currency: 'USD' }); var b = d.call('refunds.create', { orderId: 'ORD-4471', amountCents: '24050', currency: 'USD' }); var c = d.call('refunds.create', { orderId: 'ORD-4471', amountCents: 24050, currency: 'CZK' }); return { a: a, b: b, c: c, ran: f.log.length }; })()",
            expected: {
              a: { ok: false, reason: 'invalid_arguments', field: 'orderId', problem: 'missing' },
              b: { ok: false, reason: 'invalid_arguments', field: 'amountCents', problem: 'type' },
              c: { ok: false, reason: 'invalid_arguments', field: 'currency', problem: 'enum' },
              ran: 0,
            },
            label: 'a missing field, a wrong type and a value outside the enum all refuse before the handler',
            criterion: 'validated-before-effect',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var out = d.call('orders.read', { status: 'open', tenantId: 'TEN-7788' }); return { out: out, ran: f.log.length }; })()",
            expected: { out: { ok: false, reason: 'invalid_arguments', field: 'tenantId', problem: 'unknown' }, ran: 0 },
            label: 'an argument the schema does not declare is refused rather than passed through',
            edge: true,
            criterion: 'validated-before-effect',
          },
          {
            call: "(function () { var f = __fixture({ scopes: ['orders.read'] }); var d = createDispatcher(f.registry, f.session); var out = d.call('refunds.create', { orderId: 'ORD-4471', amountCents: 24050, currency: 'USD' }); return { out: out, ran: f.log.length }; })()",
            expected: { out: { ok: false, reason: 'scope_denied', scope: 'refunds.write' }, ran: 0 },
            label: 'a session without refunds.write cannot refund, however good the arguments are',
            criterion: 'scope-enforced',
          },
          {
            call: "(function () { var f = __fixture({ syncFails: 2 }); var d = createDispatcher(f.registry, f.session); var out = d.call('ledger.sync', { batchId: 'BAT-9' }); return { out: out, ran: f.log.length }; })()",
            expected: { out: { ok: true, value: { batchId: 'BAT-9', synced: true }, attempts: 3 }, ran: 3 },
            label: 'two failures then a success: three attempts, reported as three',
            criterion: 'retry-budget',
          },
          {
            call: "(function () { var f = __fixture({ syncFails: 99 }); var d = createDispatcher(f.registry, f.session); var out = d.call('ledger.sync', { batchId: 'BAT-9' }); return { out: out, ran: f.log.length }; })()",
            expected: { out: { ok: false, reason: 'tool_failed', attempts: 3, error: 'gateway timeout' }, ran: 3 },
            label: 'a tool that always throws stops at its budget of three',
            edge: true,
            criterion: 'retry-budget',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var a = d.call('orders.read', { status: 'open' }, { idempotencyKey: 'IDK-1' }); var b = d.call('orders.read', { status: 'open' }, { idempotencyKey: 'IDK-1' }); return { a: a, b: b, ran: f.log.length }; })()",
            expected: { a: { ok: true, value: { count: 2 }, attempts: 1 }, b: { ok: true, value: { count: 2 }, attempts: 1 }, ran: 1 },
            label: 'the same key twice: the same result, and the handler ran once',
            criterion: 'idempotent-calls',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var waiting = d.call('refunds.create', { orderId: 'ORD-4471', amountCents: 24050, currency: 'USD' }); var before = f.log.length; var done = d.approve(waiting.callId); return { waiting: waiting, before: before, done: done, ran: f.log.length }; })()",
            expected: {
              waiting: { ok: false, reason: 'pending_approval', callId: 'CALL-1' },
              before: 0,
              done: { ok: true, value: { refundId: 'RFD-1', amountCents: 24050 }, attempts: 1 },
              ran: 1,
            },
            label: 'a refund waits as CALL-1 and runs only once a person approves it',
            criterion: 'approval-held',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var waiting = d.call('refunds.create', { orderId: 'ORD-4471', amountCents: 24050, currency: 'USD' }); var no = d.reject(waiting.callId); var late = d.approve(waiting.callId); return { no: no, late: late, left: d.pending(), ran: f.log.length }; })()",
            expected: {
              no: { ok: false, reason: 'rejected', callId: 'CALL-1' },
              late: { ok: false, reason: 'unknown_call' },
              left: [],
              ran: 0,
            },
            label: 'a rejected refund never runs, and approving it afterwards finds nothing',
            edge: true,
            criterion: 'approval-held',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var args = { orderId: 'ORD-4471', amountCents: 24050, currency: 'USD' }; d.call('refunds.create', args); args.amountCents = 99999; return d.pending(); })()",
            expected: [{ callId: 'CALL-1', tool: 'refunds.create', args: { orderId: 'ORD-4471', amountCents: 24050, currency: 'USD' } }],
            label: 'the operator sees the validated arguments, not what the caller changed afterwards',
            criterion: 'approval-held',
          },
          {
            call: "(function () { var f = __fixture({ scopes: ['orders.read', 'ledger.write'] }); var d = createDispatcher(f.registry, f.session); var sub = d.delegate({ scopes: ['ledger.write', 'refunds.write'], maxCalls: 4 }); var out = sub.call('refunds.create', { orderId: 'ORD-4471', amountCents: 900, currency: 'USD' }); return { out: out, ran: f.log.length }; })()",
            expected: { out: { ok: false, reason: 'scope_denied', scope: 'refunds.write' }, ran: 0 },
            label: 'a sub-agent that asks for refunds.write does not get a scope the session lacks',
            criterion: 'scope-enforced',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var sub = d.delegate({ scopes: ['orders.read'], maxCalls: 2 }); var a = sub.call('orders.read', { status: 'open' }); var b = sub.call('orders.read', { status: 'closed' }); var c = sub.call('orders.read', { status: 'open' }); return { a: a, b: b, c: c, ran: f.log.length }; })()",
            expected: {
              a: { ok: true, value: { count: 2 }, attempts: 1 },
              b: { ok: true, value: { count: 1 }, attempts: 1 },
              c: { ok: false, reason: 'budget_exhausted', maxCalls: 2 },
              ran: 2,
            },
            label: 'a sub-agent with two calls makes two and is refused the third',
            criterion: 'subagent-budget',
          },
          {
            call: "(function () { var f = __fixture(); var d = createDispatcher(f.registry, f.session); var sub = d.delegate({ scopes: ['refunds.write'], maxCalls: 3 }); var waiting = sub.call('refunds.create', { orderId: 'ORD-4471', amountCents: 24050, currency: 'USD' }); var before = f.log.length; var queued = d.pending().map(function (p) { return p.callId; }); var done = d.approve(waiting.callId); return { waiting: waiting, before: before, queued: queued, done: done, ran: f.log.length }; })()",
            expected: {
              waiting: { ok: false, reason: 'pending_approval', callId: 'CALL-1' },
              before: 0,
              queued: ['CALL-1'],
              done: { ok: true, value: { refundId: 'RFD-1', amountCents: 24050 }, attempts: 1 },
              ran: 1,
            },
            label: 'a sub-agent’s refund waits in the operator’s queue until the operator approves it',
            edge: true,
            criterion: 'approval-held',
          },
        ],
        harness: TOOL_FIXTURE,
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m06-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m06-tool-dispatcher', state: 'verified_pass' },
  ],
};
