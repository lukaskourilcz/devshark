# FDE curriculum v1

The Forward Deployed Engineer path (`fde`, version 1) is a role specialization above the Fullstack, Frontend and Backend tracks. The manifest is `lib/learning-paths/content/fde.ts`, with one file per module under `lib/learning-paths/content/fde/` and the reference solutions and hidden assertions under `lib/learning-paths/solutions/`. Learn shows it in the Forward Deployed Engineer section at `/learn/forward-deployed-engineer/path`.

The path is built and merged. It reaches learners only where `LEARNING_PATH_FDE_ENABLED=true` is set (`pathEnabledInEnv` in `lib/learning-paths/catalog.ts`); without it the path is previewable and nothing else changes.

## Learning contract

The learner scopes an ambiguous customer workflow, integrates data and services, builds a bounded AI-assisted solution where one is justified, evaluates it, handles an operational change, and explains deployment and handoff decisions. Completion describes performance in devShark's exercises. It is not a certification, evidence of production experience or a hiring claim.

All three base tracks reach the same outcomes; the base track only changes which bridges are recommended. The core path needs no paid API, vendor account or live model: model responses, retrieval results and tool traffic are synthetic fixtures. TypeScript is the executable language because the platform grades it. Python appears as reading practice, and nothing claims server-verified Python execution.

## Diagnostic and bridges

The optional diagnostic (`fde-v1-diagnostic`) has twelve scenario questions across APIs and data, boundaries and operations, operator state and evaluation, plus two short debugging exercises, one in JavaScript and one in TypeScript. It records evidence per competency, and an area it did not cover reads "not assessed". It has no time limit, unlocks nothing and grants no exemption, completion or XP. A learner can skip it and still receives bridge recommendations.

Wrong or skipped answers recommend specific learning and block nothing. Core tasks can be attempted directly against the same grading criteria as the ordinary route.

| Bridge | Suggested for | Outcomes and assessment |
|---|---|---|
| Backend and data | Frontend engineers | Trace an authenticated request; validate input; transform dirty data; explain joins, transactions and idempotency. Points at the Node.js and Databases Learn levels plus a TypeScript mapping exercise. |
| Operator interface | Backend engineers | Accessible forms, loading, error and retry, human approval, citations and streaming cancellation. Points at the React and General Learn levels plus an operator-state exercise. |
| Delivery operations | Any base track | Environments, secrets, CI, logs, metrics and traces, rollback and service ownership. A structured incident case and runbook analysis. |
| Python interoperability | Anyone new to Python | Read typing, async, JSON transformations, environments, FastAPI-shaped API clients and bounded async loaders. Two sourced readings teach its eight questions. Checks grade reading only; local Python work is self-reviewed. |

## Modules and deliverables

| ID | Module and lessons | Practical evidence | Depends on |
|---|---|---|---|
| M01 | Customer discovery: workflow and stakeholders; baseline, scope and the executive update | Turn "add AI to support" into a one-page scope (workflow, five questions, baseline, success metric, in scope, sequencing, non-goals, risks, acceptance) and an executive update in four capped fields (audience 200, decisions 600, open questions 600, next step 300 characters; 1,700 in all). Bounded decision cases are graded; both written pieces are required and self-reviewed. | None |
| M02 | Decomposition cases: decompose the customer's decision (operator, decision, source authority, baseline and a bounded first slice); two worked decompositions | Twelve fictional cases, each one check of four ordered questions on a shared scenario. Completion needs both lessons plus any nine of the twelve cases passed at 80% (four of four), retryable with explanatory feedback. Migration 066 (`accept_learning_path_quota_result`) counts the any-nine quota under the enrollment lock. The visible rubric is devShark practice, not an employer's scoring key. | M01 |
| M03 | Integration and data: contracts and messy inputs; retries and idempotency | A TypeScript connector adapter handles missing fields, duplicates, pagination, throttling and repeated delivery using synthetic fixtures. | M01 |
| M04 | Enterprise boundaries and identity: identity and tenant access; delegated access (OAuth 2.0 authorization code with PKCE, token handling), SSO through SAML assertions and OIDC ID tokens, signed webhooks with replay protection, audit, and the retention and deletion of every copy the integration makes | Repair a tenant-scoped webhook receiver in TypeScript. Hidden cases include a bad signature, a replayed delivery, a cross-tenant ticket id and an expired or revoked grant, each under its own critical criterion. Its check has ten questions. | M03 |
| M05 | Data plumbing: SQL for integration (joins, dedupe, incremental loads, idempotent upserts); pipelines, schema migration, CSV and SOAP legacy sources, backfills | Six SQL reading questions on fixture tables (what a query returns, which index it needs, what breaks on a replay); no SQL runs. A TypeScript reconciliation loads a CSV export and a paginated API into one validated ledger, counts every row as applied, stale or rejected, lands the same ledger when the batches replay in either order, and writes nothing when a page fails. Lesson 1 names the Databases Learn topic (levels 5 to 11) as the prerequisite; lesson sections have no link field, so the name is not a link. | M03 |
| M06 | AI system choices: deterministic code, model, workflow or agent; structured outputs and failure modes | Select an architecture under explicit accuracy, latency and budget constraints, then validate malformed model responses. | M03 |
| M07 | Retrieval: ingestion, chunking and provenance; retrieval quality and access filters | Rank supplied retrieval results, enforce access filters, reject unsupported answers, and trace citations to source ids. Embeddings and results are fixtures. | M04, M06 |
| M08 | Tools, agents and MCP: tool schemas and the MCP 2026-07-28 boundary; the agent loop, approval and sub-agents, and when a fixed workflow beats an agent | A simulated tool dispatcher with argument checks, scoped permissions, a retry budget, idempotency, an approval state a person can approve or reject, and sub-agents with a narrowed grant and their own call budget. Six scenario checks, including versioned MCP protocol reading, workflow versus agent and a sub-agent's grant. | M04, M06 |
| M09 | Evaluation: golden sets, reference cases and leakage; failure modes, cost and latency beside quality | A metrics function over a held-out synthetic golden set reports cost per request and p95 latency beside accuracy and coverage, sorts each wrong answer into retrieval miss, tool misuse, hallucination or unclassified from its trace, compares two candidates against a baseline, and detects a candidate that wins on average while a slice regresses. Six scenario checks. | M07, M08 |
| M10 | AI security: injection and untrusted outputs; excessive agency, sandboxes and the security review | Fix unsafe tool and output handling in a sandbox fixture; prove malicious documents cannot authorize actions or leak another tenant's records. A second check grades sandboxed execution of generated code and what SOC 2, the HIPAA Security Rule and FedRAMP each ask of a deployment, as review questions rather than law. | M07, M08 |
| M11 | Deploy in the customer's environment: containers, cloud primitives and the private network; infrastructure as code, release gates and rollback cost | Read Dockerfiles and Terraform plans in a six-question check; write a TypeScript release gate that holds a rollout on failed health, configuration or migration evidence and records why. Competency `deployment`. Prerequisite: the DevOps Learn topic. | M04, M10 |
| M12 | Production delivery: observability and rollout; incident handling and rollback | Diagnose supplied traces, identify a failing dependency, propose a rollback, and implement a bounded retry and circuit-state helper. | M09, M10 |
| M13 | Adoption and handoff: operator UX and acceptance; communication, enablement and reusable product feedback | An operator-state exercise plus a structured UAT decision, and three required self-reviewed artifacts with their rubric dimensions: a runbook (trigger, owner, steps, rollback), a handover workshop outline, and a push-back email to a customer asking for the wrong feature. | M12 |
| M14 | Codify the pattern: reusable contracts and source adapters; evidence-backed product feedback | Four scenario questions plus a required self-reviewed pattern note covering invariants, what stays bespoke, reproduction, counterexample, proposal, owner and stop condition. Two sourced lessons teach the import fixture. | M13 |
| C01 | Capstone: customer support operations workbench | The scenario below; verified task results plus a labelled portfolio packet. | M01 to M14 |

## Capstone brief

A fictional B2B software company wants to spend less time triaging support cases. It has a ticket API, a CSV customer export and a knowledge base with stale and tenant-restricted articles. An operator must review proposed actions. The learner decides where deterministic routing is enough and where model assistance adds value.

Fixtures include two tenants, duplicate tickets, missing customer ids, outdated articles, forbidden documents, malformed model output, a throttled API and an indirect injection attempt. No real customer data, credential or production action is involved.

1. **Discovery:** workflow map, five stakeholder questions, baseline metric, scope, non-goals, risk register and acceptance conditions.
2. **Build:** pass bounded adapter, authorization, retrieval, validation and operator-interaction tasks in the existing sandbox. These are linked components; devShark deploys no service.
3. **Evaluate:** compare a deterministic baseline with supplied model-result candidates on at least 30 synthetic cases, failures included. Hold out a labelled evaluation slice. Define quality, abstention, cost and latency measures, and explain how fixture results differ from live model behaviour.
4. **Change request:** the customer adds a restricted tenant and tightens latency requirements. Update the design and pass the changed fixture checks without breaking earlier acceptance cases. This stage also requires a self-reviewed executive update: audience and decision, changed constraints, evidence and uncertainty, recommendation and alternative, and owner, next step and stop condition.
5. **Incident and handoff:** explain a failed rollout from traces; submit the rollback, runbook and UAT checklist, a demo outline and one reusable product improvement, plus a self-reviewed five-minute walkthrough script that names what to show, in order, and states the fixture, timing and evidence limits.

The capstone's `dependsOn` lists the fourteen teaching modules and no interview-prep module; the schema contracts in `npm run test:paths` fail when that list drifts from the manifest.

The path overview exports the learner's latest online writing as Markdown or JSON, the executive update and walkthrough included. Each entry keeps its recorded state and saved revision; saved text may have changed after its last submission. An export starts no attempt and changes no completion, and unsaved local edits are left out. Markdown writes learner text as literal fenced text. A failed read produces no partial file, and switching account or enrollment cancels pending reads. The export uses the existing owner-checked draft GET; it adds no handler or schema. A saved repository URL is optional, earns no verified badge, and is never fetched or run. Local projects, Python practice and real-model experiments carry no XP, access or completion requirement.

## Assessment

Criteria are fixed before the learner starts. The rubric dimensions are problem framing, technical correctness, integration and data quality, evaluation, security, operability and communication. Open artifacts use four levels (missing, partial, adequate, strong) with observable descriptors, and they stay self-reviewed: devShark has no independent-review workflow. For example, adequate problem framing names the operator, the current pain, a measurable baseline, exclusions and acceptance conditions; strong adds a justified tradeoff and handles a changed requirement. A length check can reject an empty or oversized submission. It cannot establish quality.

An automated practical passes on every critical assertion plus at least 80% of the weighted noncritical checks; the manifest defines the weights. A security-critical failure cannot be averaged away. Scenario checks pass at 80% and are retryable with explanatory feedback. An infrastructure timeout is a retryable error, not a learner failure.

Completion states are `not_started`, `in_progress`, `verified_pass`, `self_reviewed` and `needs_revision`, and each module says which evidence counts. The server says **"FDE guided path completed"** only after every required verified check and required portfolio submission, and shows **"Portfolio self-reviewed"** separately. No "Certified FDE", hiring guarantee or automatic Senior rank.

Multiple-choice options are plausible and comparably specific, and the keyed option is never clearly the longest: `test:paths` fails a question whose key is more than 1.15 times the distractors' mean length or 5 % longer than the longest distractor; the scenario's constraints make the preferred choice defensible, and the feedback says why each alternative fails here and when it could work. Exercises accept equivalent working code, include hidden edge cases and keep solutions sealed. Authors review both false passes and unfair failures, and avoid vendor trivia, obscure syntax and keyword-matching essays.

## Inventory and numbering

`npm run content:snapshot` derives the counts from the manifest through `pathInventory`. Today it reports 15 required modules (M01 to M14 plus C01), 28 lessons, 120 module check questions (48 of them in M02's twelve cases), 19 code exercises and 10 artifacts (four in C01), 13 competencies and 4 bridges. The optional diagnostic and bridge checks add 29 questions. `pathInventory` counts C01 in `requiredModules` and leaves out the diagnostic, the bridges and the interview shelf.

Module file names, exported constants, module ids and dependency references follow the M01 to M14 numbering. Lesson, activity, check-question and solution-map keys keep the slug they were authored under, so recorded evidence is never renamed: M02's items start `fde-v1-m02-cases-`, M03's start `fde-v1-m02-`, M05's start `fde-v1-m05-data-` and M11's start `fde-v1-m11-deploy-`. M14 has its own ids. Bridge references point at those activities, and the Python bridge also points at its two reading checks.

## Content upkeep

The reviewed source files are the publishing authority; `/dev` → Learning paths reports content readiness and inventory. The catalog validator (`lib/learning-paths/validate.ts`) rejects duplicate ids, dependency cycles, missing sources, invalid task references and public answer leakage. It also refuses a lesson trace with no frames, a runnable example with a blank caption or note, a pass threshold or criterion weight that is not a finite number in range, an answer key or artifact field cap that is not a whole number, and a diagnostic that is not an objective check. Each server instance validates a path once and caches the verdict. Every critical task has a passing reference and deliberately flawed variants.

Provider specifics live in versioned reference notes. Authors verify current official Python, SQL, provider and protocol documentation when they write or revise a module, and review sources each quarter or at once after a broken API example or a reported grading defect.

## Optional interview practice

Four modules sit on the interview-prep shelf after the required loop. They have no completion requirements and add nothing to guided progress, phase counts, the guided time estimate or completion rewards.

| Module | Practice |
| --- | --- |
| IP01 Learning round | Two lessons and three original 300 to 500-line TypeScript services to extend: a freight rate card, an event subscription selector and an asset-change ledger. |
| IP02 Re-engineering round | Two lessons and three changed services to repair: tenant quote batching, actor-scoped event paging and tenant ledger previews. Earlier helpers may look familiar; the contracts differ. |
| IP03 System design | Two lessons and twelve fictional customer scenarios, each with four objective questions and authored feedback. |
| IP04 Case bank and reflections | Two lessons linking the twelve M02 cases, plus five capped STAR-style self-review artifacts. |

Suggested rehearsal times are guidance; no timer runs. Exercises run only in the existing sandbox and call no customer system. Machine checks establish the authored assertions, not engineering or interview readiness. Reflection fields are checked for presence and length only; their quality stays self-reviewed. Fictional rehearsal is labelled, and nothing asks for fabricated work history or measured results. The exercises are original, with no employer question, scoring key or hiring guarantee.
