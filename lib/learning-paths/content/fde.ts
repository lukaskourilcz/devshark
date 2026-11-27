/** Forward Deployed Engineer: the optional role specialization.
 *
 * It sits above the existing Fullstack, Frontend and Backend tracks rather
 * than beside them — one shared curriculum, with the base track changing only
 * which bridges get recommended. Completion describes performance in
 * devShark's exercises. It is not a certification, not evidence of production
 * experience, and not a hiring claim.
 *
 * This file carries the path metadata and assembles the modules. Module
 * bodies live one file per module under `./fde/`; reference solutions and
 * hidden assertions live under `lib/learning-paths/solutions/`.
 *
 * The core path needs no paid API, no vendor account and no live model. Model
 * responses, retrieval results and tool traffic are synthetic fixtures, and
 * every module says so where a learner might otherwise assume a live system. */

import type { PathSource } from '../types';
import { FDE_DIAGNOSTIC } from './fde/diagnostic';
import { FDE_BRIDGES } from './fde/bridges';
import { FDE_M01 } from './fde/m01';
import { FDE_M02 } from './fde/m02';
import { FDE_M03 } from './fde/m03';
import { FDE_M04 } from './fde/m04';
import { FDE_M05 } from './fde/m05';
import { FDE_M06 } from './fde/m06';
import { FDE_M07 } from './fde/m07';
import { FDE_M08 } from './fde/m08';
import { FDE_M09 } from './fde/m09';
import { FDE_M10 } from './fde/m10';
import { FDE_M11 } from './fde/m11';
import { FDE_M12 } from './fde/m12';
import { FDE_M13 } from './fde/m13';
import { FDE_M14 } from './fde/m14';
import { FDE_IP02 } from './fde/ip02';
import { FDE_IP01 } from './fde/ip01';
import { FDE_IP04 } from './fde/ip04';
import { FDE_IP03 } from './fde/ip03';
import { FDE_C01 } from './fde/c01';

export const FDE_PATH: PathSource = {
  id: 'fde',
  kind: 'role_specialization',
  version: 1,
  title: 'Forward Deployed Engineer',
  summary:
    'Modules and a staged capstone on the work that sits between a customer’s messy problem and a system that survives contact with it: scoping, integration, bounded AI, evaluation, security, deployment, operations and handoff. It assumes you can already build software, and it grades the judgement rather than the syntax.',
  outcomes: [
    'Turn an ambiguous customer request into a scope with a baseline, a measurable success condition and stated non-goals.',
    'Integrate a real-shaped external system: dirty records, pagination, throttling, duplicate delivery and identity boundaries.',
    'Decide where deterministic code is the right answer and where a model earns its place, then bound what the model is allowed to do.',
    'Evaluate a solution against a held-out set, separating retrieval failure from generation failure and quality from cost and latency.',
    'Deploy into a cloud account the customer owns, and refuse a rollout the health, configuration and migration evidence has not cleared.',
    'Handle a rollout, an incident and a handoff without inventing certainty you do not have.',
  ],
  nonGoals: [
    'A certification. Finishing produces a record of what you passed in these exercises, nothing more.',
    'Evidence of production experience or any claim about employment. Completion says what you did here.',
    'A vendor course. No provider account, paid API or specific framework is required, and none is taught as the answer.',
    'Server-verified Python execution. Python appears as reading practice; anything you run locally is self-reviewed.',
    'A prompt-engineering course. Prompt wording alone never passes a security or evaluation exercise here.',
  ],
  entryRequirement:
    'You should be comfortable building and shipping software in at least one of the Fullstack, Frontend or Backend tracks: HTTP, a database or an API you have integrated, and JavaScript or TypeScript you can debug. The optional diagnostic measures the rest and recommends bridges; it never blocks anything and grants no exemption on its own.',
  competencies: [
    { id: 'discovery', title: 'Customer discovery', summary: 'Turn a vague request into a scoped problem with a baseline and acceptance conditions.' },
    { id: 'integration', title: 'Integration and data', summary: 'Consume an external system whose data is incomplete, duplicated, paginated and rate limited.' },
    { id: 'data-plumbing', title: 'Data plumbing', summary: 'Read the SQL that moves customer data, and load legacy exports and APIs so every row is counted and a replay in either order lands the same result.' },
    { id: 'boundaries', title: 'Enterprise boundaries', summary: 'Keep tenants, identities, permissions and data lifecycles apart under pressure.' },
    { id: 'ai-architecture', title: 'AI system choices', summary: 'Choose between deterministic code, a single model call, a workflow and an agent, under stated constraints.' },
    { id: 'retrieval', title: 'Retrieval and grounding', summary: 'Ground an answer in retrieved material, enforce access filters and refuse when the evidence is not there.' },
    { id: 'tools', title: 'Tools and boundaries', summary: 'Give a model tools with checked arguments, scoped permissions, a retry budget and an approval step.' },
    { id: 'evaluation', title: 'Evaluation', summary: 'Measure a change against a baseline on held-out cases, and notice when an average is hiding the failure.' },
    { id: 'ai-security', title: 'AI security', summary: 'Treat retrieved and generated content as untrusted, and keep agency bounded when it lies to you.' },
    { id: 'deployment', title: 'Deployment in the customer’s environment', summary: 'Ship into a cloud account you do not own: read the image and the plan, keep the workload’s identity and network narrow, and refuse a rollout the evidence has not cleared.' },
    { id: 'operations', title: 'Production delivery', summary: 'Roll out, observe, diagnose from traces and roll back without guessing.' },
    { id: 'handoff', title: 'Adoption and handoff', summary: 'Get an operator to accept the thing, and leave behind what the next person needs.' },
    { id: 'python-reading', title: 'Python comprehension', summary: 'Read typed, asynchronous Python and API-client code well enough to work with a data team.' },
  ],
  modules: [
    FDE_DIAGNOSTIC,
    FDE_BRIDGES,
    { ...FDE_M01, deliveryPhase: 'discover-scope' },
    { ...FDE_M02, deliveryPhase: 'discover-scope' },
    { ...FDE_M03, deliveryPhase: 'integrate' },
    { ...FDE_M04, deliveryPhase: 'integrate' },
    { ...FDE_M05, deliveryPhase: 'integrate' },
    { ...FDE_M06, deliveryPhase: 'build-models' },
    { ...FDE_M07, deliveryPhase: 'build-models' },
    { ...FDE_M08, deliveryPhase: 'build-models' },
    { ...FDE_M09, deliveryPhase: 'build-models' },
    { ...FDE_M10, deliveryPhase: 'harden-ship' },
    { ...FDE_M11, deliveryPhase: 'harden-ship' },
    { ...FDE_M12, deliveryPhase: 'harden-ship' },
    { ...FDE_M13, deliveryPhase: 'enable-codify' },
    { ...FDE_M14, deliveryPhase: 'enable-codify' },
    FDE_C01,
    FDE_IP01,
    FDE_IP02,
    FDE_IP03,
    FDE_IP04,
  ],
  bridges: [
    {
      id: 'fde-bridge-backend-data',
      title: 'Backend and data',
      summary:
        'For engineers who have mostly worked in the browser. Trace an authenticated request end to end, validate input at the boundary, reshape dirty data, and know what a join, a transaction and an idempotent write actually promise.',
      suggestedFor: ['frontend'],
      competencies: ['integration', 'boundaries'],
      references: [
        { kind: 'roadmap-topic', ref: 'nodejs', label: 'Node.js Learn levels: modules, async, HTTP' },
        { kind: 'roadmap-topic', ref: 'databases', label: 'Databases Learn levels: schema, indexing, transactions' },
        { kind: 'path-activity', ref: 'fde-v1-bridge-backend-mapping', label: 'Bridge exercise: map a dirty payload to a validated record' },
        {
          kind: 'doc',
          ref: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status',
          label: 'MDN — HTTP response status codes',
        },
      ],
      estimatedMinutes: 180,
    },
    {
      id: 'fde-bridge-operator-interface',
      title: 'Operator interface',
      summary:
        'For engineers who have mostly worked behind the API. The screen an operator approves work on has states a happy-path demo never shows: loading, partial failure, retry, a citation they can check, and a cancel that actually stops the work.',
      suggestedFor: ['backend'],
      competencies: ['handoff', 'retrieval'],
      references: [
        { kind: 'roadmap-topic', ref: 'react', label: 'React Learn levels: state, effects, rendering' },
        // Testing stopped being a path of its own (#179); its foundations are
        // the last four General levels, which is where this bridge now points.
        { kind: 'roadmap-topic', ref: 'general', label: 'General Learn levels: Testing Foundations — what to assert on a UI' },
        { kind: 'path-activity', ref: 'fde-v1-bridge-operator-state', label: 'Bridge exercise: the operator approval state machine' },
        {
          kind: 'doc',
          ref: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-live',
          label: 'MDN — aria-live, for status that changes while you watch',
        },
      ],
      estimatedMinutes: 150,
    },
    {
      id: 'fde-bridge-delivery-operations',
      title: 'Delivery operations',
      summary:
        'For anyone the diagnostic did not measure here. Environments and secrets, what CI is actually protecting, the difference between logs, metrics and traces, and what a rollback costs when the schema moved.',
      suggestedFor: ['fullstack', 'frontend', 'backend'],
      competencies: ['operations'],
      references: [
        { kind: 'roadmap-topic', ref: 'devops', label: 'DevOps Learn levels: CI/CD, containers, observability' },
        { kind: 'roadmap-topic', ref: 'security', label: 'Security Learn levels: secrets and secure defaults' },
        { kind: 'path-activity', ref: 'fde-v1-bridge-incident-case', label: 'Bridge case: read an incident from its traces' },
      ],
      estimatedMinutes: 150,
    },
    {
      id: 'fde-bridge-python',
      title: 'Python interoperability',
      summary:
        'For anyone who does not read Python daily. The data team will hand you notebooks and API clients; you need to read type hints, async functions, JSON reshaping and environment handling well enough to work with them. Reading is graded here. Anything you run locally is your own note, recorded as self-reviewed.',
      suggestedFor: ['fullstack', 'frontend', 'backend'],
      competencies: ['python-reading', 'integration'],
      references: [
        { kind: 'path-activity', ref: 'fde-v1-bridge-python-reading', label: 'Bridge check: read typed and asynchronous Python' },
        { kind: 'path-activity', ref: 'fde-v1-bridge-python-api-client', label: 'Bridge check: read an API client boundary' },
        { kind: 'path-activity', ref: 'fde-v1-bridge-python-async-loader', label: 'Bridge check: read an asynchronous data loader' },
        { kind: 'doc', ref: 'https://docs.python.org/3/library/typing.html', label: 'Python docs — typing' },
        { kind: 'doc', ref: 'https://docs.python.org/3/library/asyncio-task.html', label: 'Python docs — asyncio tasks and coroutines' },
      ],
      estimatedMinutes: 120,
    },
  ],
  rubric: {
    version: 1,
    dimensions: [
      {
        id: 'problem-framing',
        title: 'Problem framing',
        levels: {
          missing: 'Restates the request without identifying who does the work today or what it costs them.',
          partial: 'Names the operator and the pain, but has no measurable baseline and no stated exclusion.',
          adequate: 'Identifies the operator, the current pain, a measurable baseline, what is out of scope, and the condition that would count as success.',
          strong: 'As adequate, plus a tradeoff argued rather than asserted, and a coherent response when a requirement changes.',
        },
      },
      {
        id: 'technical-correctness',
        title: 'Technical correctness',
        levels: {
          missing: 'The described approach cannot work as specified.',
          partial: 'Works on the happy path; a named failure mode in the brief is unhandled.',
          adequate: 'Handles every failure mode the brief names, with the behaviour on each stated.',
          strong: 'As adequate, plus a failure mode the brief did not name, found from the fixtures.',
        },
      },
      {
        id: 'integration-data-quality',
        title: 'Integration and data quality',
        levels: {
          missing: 'Assumes clean, complete, singular records.',
          partial: 'Handles missing fields, but not duplicates, pagination or repeated delivery.',
          adequate: 'Handles missing fields, duplicates, pagination, throttling and repeated delivery, and says what it does with a record it cannot use.',
          strong: 'As adequate, and the reconciliation is idempotent under replay in either order.',
        },
      },
      {
        id: 'evaluation',
        title: 'Evaluation',
        levels: {
          missing: 'No measurement, or a demo presented as evidence.',
          partial: 'A single aggregate number over cases the design was built against.',
          adequate: 'A held-out set, a baseline to compare against, and quality reported separately from cost and latency.',
          strong: 'As adequate, plus a slice where the average hides a failure, and an abstention rate reported alongside accuracy.',
        },
      },
      {
        id: 'security',
        title: 'Security',
        levels: {
          missing: 'Retrieved or generated content is treated as trusted input.',
          partial: 'Injection is mentioned, but a tool call can still act on unverified content.',
          adequate: 'Untrusted content cannot authorize an action, cross a tenant boundary or widen a permission, and the check is in code rather than in wording.',
          strong: 'As adequate, plus an adversarial case the brief did not supply, and a stated blast radius for the worst outcome.',
        },
      },
      {
        id: 'operability',
        title: 'Operability',
        levels: {
          missing: 'No signal to watch and no way back.',
          partial: 'Logs, but nothing that would show the failure before a customer does.',
          adequate: 'A signal that would catch the named failure, a rollback that is safe to run, and an owner for the service.',
          strong: 'As adequate, plus what the rollback cannot undo, and how the state left behind is reconciled.',
        },
      },
      {
        id: 'communication',
        title: 'Communication',
        levels: {
          missing: 'The reader cannot tell what was decided or why.',
          partial: 'Decisions are listed; the reasoning behind them is not.',
          adequate: 'Decisions, the reason for each, the open questions, and what the reader has to do next.',
          strong: 'As adequate, written for a named audience, with uncertainty stated rather than smoothed over.',
        },
      },
    ],
  },
  diagnosticActivityId: 'fde-v1-diagnostic-check',
  estimatedHours: { min: 40, max: 60 },
  sources: [
    {
      label: 'OWASP Top 10 for Large Language Model Applications',
      url: 'https://owasp.org/projects/top-10-for-large-language-model-applications',
      reviewedOn: '2026-11-27',
    },
    {
      label: 'NIST AI Risk Management Framework',
      url: 'https://www.nist.gov/itl/ai-risk-management-framework',
      reviewedOn: '2026-09-08',
    },
    {
      label: 'Model Context Protocol specification',
      url: 'https://modelcontextprotocol.io/specification',
      reviewedOn: '2026-09-08',
    },
    {
      label: 'Google SRE Book — Postmortem culture',
      url: 'https://sre.google/sre-book/postmortem-culture/',
      reviewedOn: '2026-09-08',
    },
  ],
  reviewedOn: '2026-11-27',
  completionLabel: 'FDE guided path completed',
};
