/** IP03: two readings and twelve four-question original fictional design cases.
 * Optional interview practice; no model or external service runs. */
import type { ModuleSource } from "../../types";

export const FDE_IP03: ModuleSource = {
  "id": "fde-v1-ip03",
  "title": "Interview practice: LLM system design",
  "optional": true,
  "shelf": "interview-prep",
  "outcomes": [
    "Explain a bounded design under explicit customer constraints.",
    "Keep authority, evaluation and recovery evidence separate from a plausible model response."
  ],
  "competencies": [
    "discovery",
    "integration",
    "boundaries",
    "ai-architecture",
    "retrieval",
    "tools",
    "evaluation",
    "ai-security",
    "deployment",
    "operations",
    "handoff"
  ],
  "dependsOn": [],
  "estimatedMinutes": 180,
  "lessons": [
    {
      "id": "fde-v1-ip03-l1",
      "title": "Frame the boundary before the model",
      "summary": "Separate authority, evidence, state and runtime choice in a design review.",
      "estimatedMinutes": 18,
      "sources": [
        {
          "label": "Anthropic: workflow and agent architecture principles (tooling details change)",
          "url": "https://www.anthropic.com/research/building-effective-agents",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "OWASP: prompt injection and privilege boundaries",
          "url": "https://genai.owasp.org/llmrisk/llm01-prompt-injection/",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "OWASP: excessive agency",
          "url": "https://genai.owasp.org/llmrisk/llm062025-excessive-agency/",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "Google SRE: handling overload",
          "url": "https://sre.google/sre-book/handling-overload/",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "callout",
          "tone": "note",
          "body": "All twelve cases are original fictional design exercises. No model, provider account, network or customer system runs here. The answer key follows each stated contract and devShark’s teaching rubric; it reproduces no employer interview question or scoring key."
        },
        {
          "kind": "prose",
          "body": "Start with the operator’s decision and the hard requirements. Draw where authorized data enters, who may propose an action, who may approve it and which trusted component executes it. A generated answer or retrieved passage cannot grant a permission. Use a fixed workflow when the decision path is known; add model-directed choices only where their value and failure handling justify the complexity."
        },
        {
          "kind": "table",
          "caption": "Boundaries the cases ask you to preserve",
          "headers": [
            "Boundary",
            "Evidence a reviewer can inspect"
          ],
          "rows": [
            [
              "Private knowledge",
              "Filter by current actor/tenant before context; keep scope/version-aware caches and test revocation through warm paths."
            ],
            [
              "Generated claims",
              "Link substantive claims to permitted source versions; a resolvable citation alone does not prove an entire answer is supported. Refuse unsupported answers under the stated policy."
            ],
            [
              "Privileged actions",
              "Validate current authority and bind human approval to exact arguments/version. Reconcile uncertain mutations using their documented operation identity."
            ],
            [
              "Explicit controls",
              "Map the approved data flow, scoped identity and retention across copies. The control owner resolves exceptions; an exercise provides no legal certification."
            ],
            [
              "Runtime choice",
              "Compare hosted/self-hosted candidates on the same requirements and held-out cases, including people, operations, refusal, cost and tail latency."
            ],
            [
              "Operator screen",
              "Expose pending/failure/refusal states. Preserve request identity after cancellation and enforce the current decision on the server."
            ]
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-l2",
      "title": "Budget failure, change and evidence",
      "summary": "Make overload, partial effects and rollout decisions explicit instead of hiding them in an average.",
      "estimatedMinutes": 18,
      "sources": [
        {
          "label": "Anthropic: workflow and agent architecture principles (tooling details change)",
          "url": "https://www.anthropic.com/research/building-effective-agents",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "OWASP: prompt injection and privilege boundaries",
          "url": "https://genai.owasp.org/llmrisk/llm01-prompt-injection/",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "OWASP: excessive agency",
          "url": "https://genai.owasp.org/llmrisk/llm062025-excessive-agency/",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "Google SRE: handling overload",
          "url": "https://sre.google/sre-book/handling-overload/",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "prose",
          "body": "A queue is part of a request’s elapsed time. Admit work against its remaining budget, keep concurrency and retries bounded, and show refused or deferred work in the measurements. A tenfold request increase does not prove a tenfold resource need when the work mix changes. Preserve tenant safety while degrading only the work the case explicitly permits."
        },
        {
          "kind": "table",
          "caption": "Questions that turn a design into a bounded decision",
          "headers": [
            "Area",
            "What to state"
          ],
          "rows": [
            [
              "Batching",
              "Per-item authority and routing, maximum wait, remaining deadline and end-to-end measurements rather than execution time alone."
            ],
            [
              "Partial effects",
              "Which steps succeeded, which outcomes are unknown, stable operation identities, status lookup, and authorized compensation/reconciliation. A timeout or code rollback does not undo external effects."
            ],
            [
              "Evaluation",
              "A shared untouched holdout, blocking failure slices, separate quality/refusal/cost/latency measures, and an inspected grader contract. Repeated tuning exposes the holdout."
            ],
            [
              "Deployment",
              "The workload’s actual private route and scoped identity, secrets outside image layers, and verified state recovery before a data-bearing replacement or migration."
            ],
            [
              "Rollout",
              "An accountable owner, bounded exposure, observable acceptance/stop thresholds, reversal limits and reconciliation of already affected state."
            ],
            [
              "Reusable patterns",
              "Core invariants versus validated adapters; a source-shaped synthetic reproduction; evidence limits, an alternative, an owner and a bounded next decision."
            ]
          ]
        },
        {
          "kind": "prose",
          "body": "For these four-question checks, the 80% threshold requires four correct answers. Retry and read the authored explanations. Passing records decisions on the supplied cases; it does not establish production operation, an employer outcome or an independent review of a real architecture. This optional interview-practice module does not contribute to guided-path completion."
        }
      ]
    }
  ],
  "activities": [
    {
      "id": "fde-v1-ip03-l1-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Read: frame the boundary before the model",
      "summary": "Separate authority, evidence, state and runtime choice in a design review.",
      "competencies": [
        "boundaries",
        "ai-architecture",
        "retrieval",
        "tools",
        "ai-security",
        "deployment",
        "handoff"
      ],
      "estimatedMinutes": 18,
      "lessonId": "fde-v1-ip03-l1"
    },
    {
      "id": "fde-v1-ip03-l2-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Read: budget failure, change and evidence",
      "summary": "Make overload, partial effects and rollout decisions explicit instead of hiding them in an average.",
      "competencies": [
        "discovery",
        "integration",
        "tools",
        "evaluation",
        "deployment",
        "operations",
        "handoff"
      ],
      "estimatedMinutes": 18,
      "lessonId": "fde-v1-ip03-l2"
    },
    {
      "id": "fde-v1-ip03-private-kb",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Private knowledge base",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "boundaries",
        "retrieval",
        "evaluation"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Northline support assistant serves two tenants. The signed-in actor may read only current documents in their tenant and approved shared documents. A pilot answered accurately on public documents, but private permissions can change during a session. Retrieved text is untrusted data. Answers need support from permitted evidence; otherwise the assistant declines and offers human review. No live retrieval or model runs in this exercise.",
      "questions": [
        {
          "id": "fde-v1-ip03-private-kb-q1",
          "prompt": "Which retrieval boundary meets the stated permission rule?",
          "options": [
            "Apply actor/tenant authorization to candidates before their text can enter model context.",
            "Retrieve across both tenants and instruct the model to ignore documents the actor should not see.",
            "Retrieve globally, generate the answer, then strip citation ids that point at documents outside scope.",
            "Treat the pilot’s accurate public-document results as evidence that permission filtering works."
          ],
          "correct": 0,
          "explanation": "Authorization must constrain the material made available. Prompt instructions and citation cleanup operate after forbidden text has already crossed that boundary. Public accuracy tests establish neither private permission handling nor isolation.",
          "competencies": [
            "boundaries",
            "retrieval"
          ]
        },
        {
          "id": "fde-v1-ip03-private-kb-q2",
          "prompt": "Which cache key is defensible for an answer that depends on private documents?",
          "options": [
            "Normalized query text alone, because the wording of the question determines which answer is requested.",
            "Query plus authorized tenant/scope and relevant permission and document versions, invalidated on change.",
            "Query plus model name and temperature, shared across actors because those settings shape the output.",
            "Query plus document count, so tenants whose corpora are the same size can share one cached result."
          ],
          "correct": 1,
          "explanation": "The result depends on the question, authorized scope and versions. Query wording alone, model settings and document counts do not identify which private material the current actor may read. A key still needs a change policy; adding fields alone does not handle revocation.",
          "competencies": [
            "boundaries",
            "retrieval"
          ]
        },
        {
          "id": "fde-v1-ip03-private-kb-q3",
          "prompt": "The authorized candidate set contains no support for the requested answer. Which response fits?",
          "options": [
            "Answer from a high-scoring document outside the actor’s scope and leave its citation out of the reply.",
            "Give the most probable answer based on the public pilot and label it verified because the pilot was accurate.",
            "Refuse or offer the stated human-review path instead of borrowing another tenant’s evidence.",
            "Retry with the tenant filter relaxed, since an empty first search usually means the filter was too strict."
          ],
          "correct": 2,
          "explanation": "An empty permitted set does not authorize another tenant’s data or turn a plausible guess into supported evidence. A safe refusal or defined review path preserves the stated boundary. Retrying with weaker authorization violates the same rule.",
          "competencies": [
            "retrieval"
          ]
        },
        {
          "id": "fde-v1-ip03-private-kb-q4",
          "prompt": "Which additional acceptance case addresses the session-change risk?",
          "options": [
            "Repeat the same public prompt at a different model temperature and confirm the answer stays consistent.",
            "Measure average answer length across the original public pilot and flag answers that grow much longer.",
            "Check that each citation label in a private answer is well formatted and resolves to a document title.",
            "Revoke a previously allowed document and verify it cannot reappear through retrieval or cached answers."
          ],
          "correct": 3,
          "explanation": "Revocation tests whether the current authorization survives retrieval and cache paths. Temperature, answer length and citation formatting do not establish that removed private access actually stops influencing the answer.",
          "competencies": [
            "boundaries",
            "retrieval",
            "evaluation"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-batching",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Batching under a deadline",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "integration",
        "boundaries",
        "evaluation",
        "operations"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Cedar search receives small read-only lookups. Each request has an actor scope and a 400 ms end-to-end deadline. A proposed batcher waits up to 300 ms and takes another 180 ms to run a full batch. The product requires per-request authorization and refusal on deadline exhaustion. These durations are authored fixtures.",
      "questions": [
        {
          "id": "fde-v1-ip03-batching-q1",
          "prompt": "What does the proposed full-batch path show about the deadline?",
          "options": [
            "A 180 ms execution time proves every request stays below 400 ms.",
            "Its stated wait plus execution can take 480 ms before other overhead, so the 400 ms budget is not protected.",
            "A 300 ms wait proves requests always finish at the first deadline.",
            "Batching removes the need to budget time spent waiting in a queue."
          ],
          "correct": 1,
          "explanation": "The oldest waiting request can spend 300 + 180 ms on the described path. Looking only at execution or waiting omits the other cost, and batching does not erase queue time. The fixture does not provide a measured production latency distribution.",
          "competencies": [
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-batching-q2",
          "prompt": "Which batch boundary preserves the authorization requirement?",
          "options": [
            "Authorize the batch as the most privileged actor it contains.",
            "Authorize only the first item and reuse its scope for later items.",
            "Keep each item’s actor scope through retrieval and result routing, even when transport shares a batch.",
            "Remove actor metadata before batching to make cache hits more likely."
          ],
          "correct": 2,
          "explanation": "Sharing transport must not merge authority. The most privileged or first actor does not represent the rest, and removing scope loses the information needed to enforce isolation and deliver each result to its authorized caller.",
          "competencies": [
            "integration",
            "boundaries"
          ]
        },
        {
          "id": "fde-v1-ip03-batching-q3",
          "prompt": "Which change directly protects each request’s stated budget?",
          "options": [
            "Increase maximum batch size until average throughput is highest.",
            "Retry an expired request in a new batch with a fresh deadline.",
            "Report only execution latency and omit the batching wait.",
            "Bound batching wait by remaining request time and refuse work that cannot finish within the admitted budget."
          ],
          "correct": 3,
          "explanation": "Admission must account for remaining time. Maximum throughput may worsen tail wait, resetting the deadline changes the contract, and dropping queue time from reporting hides the breach rather than protecting the request.",
          "competencies": [
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-batching-q4",
          "prompt": "Which measurement tests the user-facing effect of batching?",
          "options": [
            "Measure end-to-end latency and refusal rate per request, sliced by batch wait and actor workload.",
            "Measure only average model execution time after each batch starts.",
            "Compare the number of successful batches without recording item counts.",
            "Measure only the total number of requests accepted into the queue."
          ],
          "correct": 0,
          "explanation": "Users experience the complete request path. Execution averages omit waiting and tails; batch counts obscure differing item counts; accepted-queue volume says nothing about completion within the deadline or who is refused.",
          "competencies": [
            "evaluation",
            "operations"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-spike",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "A tenfold traffic spike",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "integration",
        "evaluation",
        "operations"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Rivet has measured a bounded worker pool under its current query mix. A campaign raises offered work tenfold. Queue length grows and old requests miss their deadlines. The customer permits deferring an optional report, but tenant isolation and the interactive refusal contract are mandatory.",
      "questions": [
        {
          "id": "fde-v1-ip03-spike-q1",
          "prompt": "Which first control addresses the growing queue within those constraints?",
          "options": [
            "Accept all work into an unlimited queue to avoid visible refusals.",
            "Disable tenant checks until the campaign load returns to normal.",
            "Apply bounded admission and shed or defer the optional report before weakening interactive safety checks.",
            "Retry every queued request immediately on every available worker."
          ],
          "correct": 2,
          "explanation": "Bounded admission keeps overload from accumulating without limit, and the optional report is the stated degradable work. Unlimited queues hide delay; disabling tenant checks violates a mandatory boundary; immediate duplicate retries add load.",
          "competencies": [
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-spike-q2",
          "prompt": "What evidence best supports a new capacity decision?",
          "options": [
            "Multiply the old average request count by ten and assume equal work.",
            "Use successful-request latency after removing all rejected requests.",
            "Use the campaign’s visitor count as a substitute for backend demand.",
            "Measure resource demand and tail behavior for the new mix, including queue time and rejected work."
          ],
          "correct": 3,
          "explanation": "The new mix can change request cost and rejection patterns. A fixed multiplier assumes equal cost, success-only latency hides overload outcomes, and visitor counts do not establish the work or resource demand each request produces.",
          "competencies": [
            "evaluation",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-spike-q3",
          "prompt": "How should a retrying client avoid amplifying this overload?",
          "options": [
            "Use bounded retries with backoff and remaining-deadline checks for operations whose retry semantics are known.",
            "Retry without delay until the service acknowledges the request.",
            "Increase concurrency whenever a previous retry was rejected.",
            "Retry mutations under a fresh identity so the server treats them as new work."
          ],
          "correct": 0,
          "explanation": "A bounded retry policy can avoid immediate retry storms while respecting time and operation semantics. The alternatives add work, increase pressure or risk duplicate effects. Backoff alone does not make an unsafe mutation replay-safe.",
          "competencies": [
            "integration",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-spike-q4",
          "prompt": "Which acceptance result can look healthy while hiding a tenant-specific overload failure?",
          "options": [
            "Recorded per-tenant refusal rates alongside global latency.",
            "A good global average while one small tenant’s requests are consistently refused.",
            "A separate count of deferred optional reports.",
            "End-to-end measurements that include queued and rejected requests."
          ],
          "correct": 1,
          "explanation": "A global average can conceal a tenant’s persistent failure. Sliced refusal rates, deferred-work counts and complete-path measurements expose that behavior rather than hide it; they do not by themselves decide the customer’s fairness policy.",
          "competencies": [
            "evaluation",
            "operations"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-regulated",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "A customer with explicit controls",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "boundaries",
        "deployment",
        "operations",
        "handoff"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Elmbridge’s approved requirements forbid customer text leaving its private network, require scoped workload identities and limit audit retention to 30 days. Legal/Security owns interpretation and exceptions. A model-assisted prototype works on synthetic inputs; no legal conclusion, compliance attestation or live deployment is supplied.",
      "questions": [
        {
          "id": "fde-v1-ip03-regulated-q1",
          "prompt": "Which action follows from the no-egress requirement before choosing a provider?",
          "options": [
            "Send a small sample to a public endpoint because it is only a pilot.",
            "Treat a provider’s general security marketing as an exception approval.",
            "Rely on a prompt that tells the model not to retain customer text.",
            "Map data flows and reject any proposed path that sends customer text outside the approved boundary unless its owner changes the requirement."
          ],
          "correct": 3,
          "explanation": "The explicit approved boundary governs this case. A pilot, marketing claim or prompt does not authorize an exception or change where data travels. The designated owner must resolve an exception; the exercise does not decide what a law requires.",
          "competencies": [
            "boundaries",
            "deployment"
          ]
        },
        {
          "id": "fde-v1-ip03-regulated-q2",
          "prompt": "What should the workload identity be allowed to do?",
          "options": [
            "Only the operations and resources this workflow needs, using the approved identity boundary.",
            "All project operations so future extensions require no identity changes.",
            "The combined privileges of every user who may ask a question.",
            "A shared administrator token embedded in the container image."
          ],
          "correct": 0,
          "explanation": "The requirement calls for scoped identity. Broad future permissions, combined user authority and embedded administrator secrets enlarge access beyond the workflow and make the boundary harder to control or revoke.",
          "competencies": [
            "boundaries",
            "deployment"
          ]
        },
        {
          "id": "fde-v1-ip03-regulated-q3",
          "prompt": "Which audit design fits the stated retention constraint?",
          "options": [
            "Keep complete prompts forever because audit data is operational.",
            "Record the necessary decision metadata, minimize sensitive payloads and define deletion across audit copies within the approved policy.",
            "Delete the primary log after 30 days but leave exports outside the inventory.",
            "Claim the model’s refusal message proves that every audit copy was deleted."
          ],
          "correct": 1,
          "explanation": "The approved policy includes copies, not just the primary log. Indefinite payload retention and untracked exports contradict it; a model response cannot establish backend deletion. The precise required metadata still needs the control owner’s decision.",
          "competencies": [
            "boundaries",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-regulated-q4",
          "prompt": "A stakeholder asks whether passing this check makes the system compliant. What is accurate?",
          "options": [
            "The check certifies the system against all relevant regulation.",
            "Private hosting makes every other control optional.",
            "It demonstrates the authored control decisions in this exercise; the designated owners still assess the actual system and requirements.",
            "A successful synthetic prototype replaces the need for an approved data-flow review."
          ],
          "correct": 2,
          "explanation": "Exercise performance is bounded evidence. It is neither a legal assessment nor a certification, and private hosting or synthetic success does not establish all other controls. Actual scope, operation and evidence remain for the named owners.",
          "competencies": [
            "boundaries",
            "handoff"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-hosting",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Hosted or self-hosted",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "ai-architecture",
        "evaluation",
        "deployment",
        "operations"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Beacon compares two candidates. Hosted H satisfies its approved data boundary and needs little platform operation; self-hosted S gives deployment control but requires the customer to patch and operate it. Both pass the same small pilot. The team has not measured their tail latency, full operating cost or held-out quality.",
      "questions": [
        {
          "id": "fde-v1-ip03-hosting-q1",
          "prompt": "What decision is supported before those measurements exist?",
          "options": [
            "Treat both as candidates and compare them against the stated requirements and missing operational evidence.",
            "Choose S because deployment control establishes higher answer quality.",
            "Choose H because a low operations burden proves lower total cost at every scale.",
            "Declare the pilot sufficient evidence for a full customer rollout."
          ],
          "correct": 0,
          "explanation": "The pilot does not settle quality, cost or tail behavior. Deployment control is not a quality measurement, lower operations burden does not prove every-scale total cost, and a small pilot does not establish rollout readiness.",
          "competencies": [
            "ai-architecture"
          ]
        },
        {
          "id": "fde-v1-ip03-hosting-q2",
          "prompt": "Which cost belongs in S’s comparison?",
          "options": [
            "Only the accelerator rental price because staff are already employed.",
            "The people and processes for patching, capacity, incident response and upgrades, beside infrastructure cost.",
            "Only the license fee, assuming the customer handles the rest for free.",
            "Only the cost of successful requests, excluding failures and idle capacity."
          ],
          "correct": 1,
          "explanation": "Operating S is part of the stated responsibility. Existing salaries or customer ownership do not make that work free; success-only accounting omits failure and capacity costs. These are comparison categories, not invented cost figures.",
          "competencies": [
            "ai-architecture",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-hosting-q3",
          "prompt": "Which quality comparison is most useful for this choice?",
          "options": [
            "Let each candidate use a different easier demonstration set.",
            "Compare only the longest answer each candidate can produce.",
            "Use the same held-out cases and report relevant failure slices, refusal, cost and latency for both candidates.",
            "Choose the winner from training-set accuracy without checking unsupported answers."
          ],
          "correct": 2,
          "explanation": "A shared held-out evaluation gives comparable evidence and exposes important tradeoffs. Different easy demos, answer length and training-set accuracy can hide the failures the customer actually needs the design to handle.",
          "competencies": [
            "ai-architecture",
            "evaluation"
          ]
        },
        {
          "id": "fde-v1-ip03-hosting-q4",
          "prompt": "Which rollout plan respects the remaining uncertainty?",
          "options": [
            "Move all tenants at once and define acceptable errors afterwards.",
            "Remove the previous path before measuring the new one.",
            "Treat model selection as permanent so the team need not plan rollback.",
            "Use a bounded rollout with an owner, monitored acceptance thresholds and an explicit reversal/reconciliation plan."
          ],
          "correct": 3,
          "explanation": "A bounded rollout can test assumptions while retaining a controlled response to failure. Removing the prior path or deciding thresholds after exposure limits that control. Selection alone does not remove the need to handle changed or failed behavior.",
          "competencies": [
            "deployment",
            "operations"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-approval",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "An agent proposes a privileged action",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "integration",
        "boundaries",
        "tools",
        "ai-security"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Arbor’s assistant may propose a refund but cannot execute one without current server-side authorization and a human approval tied to the exact account, amount and plan version. Retrieved notes and model output are untrusted. The payment service accepts an idempotency key and records its outcome.",
      "questions": [
        {
          "id": "fde-v1-ip03-approval-q1",
          "prompt": "Which component must enforce the refund boundary?",
          "options": [
            "The model’s system prompt alone because it names the approval rule.",
            "Trusted server code that validates the current actor, exact proposal and required approval before calling the payment service.",
            "A client badge saying Approved without binding it to the submitted arguments.",
            "A retrieved note that says this customer always approves refunds."
          ],
          "correct": 1,
          "explanation": "The stated boundary requires trusted authorization and a bound approval. Prompt text, an unbound badge and untrusted retrieved notes cannot establish that the exact current refund is permitted.",
          "competencies": [
            "boundaries",
            "tools",
            "ai-security"
          ]
        },
        {
          "id": "fde-v1-ip03-approval-q2",
          "prompt": "The amount changes after approval. What should the executor do?",
          "options": [
            "Reuse the approval because the account id did not change.",
            "Execute the new amount if the model explains why it changed.",
            "Reject the stale approval and obtain approval for the changed proposal under the current authority.",
            "Copy the old approval timestamp into the changed request."
          ],
          "correct": 2,
          "explanation": "Approval is tied to the amount and version, so the changed proposal is not covered. Account identity alone, a model explanation or a copied timestamp does not authorize the new action.",
          "competencies": [
            "boundaries",
            "tools"
          ]
        },
        {
          "id": "fde-v1-ip03-approval-q3",
          "prompt": "The refund call times out after it may have executed. Which next step respects replay safety?",
          "options": [
            "Create a new idempotency key immediately so the retry is accepted.",
            "Assume the timeout proves that no refund happened.",
            "Issue a compensating charge automatically before checking the outcome.",
            "Reconcile the recorded outcome and retry only under the same operation identity according to the payment contract."
          ],
          "correct": 3,
          "explanation": "A timeout leaves the effect uncertain. Reconciliation and the stipulated identity prevent treating the retry as a new refund. Fresh keys, assuming no effect and automatic compensation can create new unauthorized effects.",
          "competencies": [
            "integration",
            "tools"
          ]
        },
        {
          "id": "fde-v1-ip03-approval-q4",
          "prompt": "A retrieved note instructs the agent to skip approval. How should it be treated?",
          "options": [
            "As untrusted content that cannot change the executor’s authority or approval checks.",
            "As an updated policy because it arrived through retrieval.",
            "As authorization if its wording includes the customer’s name.",
            "As a reason to enable an administrator tool for this request."
          ],
          "correct": 0,
          "explanation": "Retrieved text is explicitly untrusted in the case. Its origin or personalization does not let it modify trusted policy, and granting a broader tool would weaken the very boundary under attack.",
          "competencies": [
            "tools",
            "ai-security"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-freshness",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Freshness and removal",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "boundaries",
        "retrieval",
        "evaluation",
        "operations"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Alder answers from a versioned knowledge base. A policy document was replaced at 09:00; one user’s access was revoked at 09:05. Product requires answers to use current authorized material. Indexes, answer caches and exported evaluation snapshots are separately stored copies.",
      "questions": [
        {
          "id": "fde-v1-ip03-freshness-q1",
          "prompt": "Which information makes an answer’s evidence inspectable?",
          "options": [
            "Only a confidence percentage produced by the model.",
            "Only the fact that the generated answer contains a citation-shaped string.",
            "The authorized source identity/version and retrieval time, with the supported claim linked to that evidence.",
            "Only the document’s title, reused across all of its versions."
          ],
          "correct": 2,
          "explanation": "Versioned provenance helps identify the actual permitted evidence. Confidence, citation shape and a reused title do not establish which version supported the claim or whether the current actor could read it.",
          "competencies": [
            "retrieval"
          ]
        },
        {
          "id": "fde-v1-ip03-freshness-q2",
          "prompt": "What must a removal plan inventory?",
          "options": [
            "Only the original source file because derived stores are automatic.",
            "Only the visible answer cache because the index contains vectors.",
            "Only the browser history of users who previously saw the answer.",
            "The index, caches and exported snapshots, with an owner and the stated policy for each copy."
          ],
          "correct": 3,
          "explanation": "The scenario names separately stored copies; removal must address their lifecycle explicitly. Deleting one source does not prove those copies disappeared, and a vector index or snapshot still needs a stated policy.",
          "competencies": [
            "boundaries",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-freshness-q3",
          "prompt": "Which test addresses the 09:05 permission change?",
          "options": [
            "Query as the revoked user after the change, including a warm answer-cache path, and verify the removed material cannot be used.",
            "Query only as an administrator who retains access.",
            "Clear all caches and test only the new empty-cache path.",
            "Check only that the policy title still appears in the index."
          ],
          "correct": 0,
          "explanation": "The revoked actor and warm path exercise the relevant boundary. Administrator access, a forced-cold path and title presence cannot establish that cached evidence respects the changed permission.",
          "competencies": [
            "boundaries",
            "retrieval",
            "evaluation"
          ]
        },
        {
          "id": "fde-v1-ip03-freshness-q4",
          "prompt": "Which claim exceeds what a valid citation establishes?",
          "options": [
            "That the cited source can be inspected by an authorized reviewer.",
            "That the whole generated answer is current, authorized and semantically supported merely because one citation id resolves.",
            "That source-version metadata can help reproduce a retrieval decision.",
            "That each substantive claim still needs support from the permitted evidence."
          ],
          "correct": 1,
          "explanation": "A resolvable id is only part of the evidence chain. It does not by itself validate every claim, freshness or authorization. The other statements describe bounded uses of provenance rather than a complete guarantee.",
          "competencies": [
            "retrieval",
            "evaluation"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-evaluation",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Choose a candidate with held-out evidence",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "evaluation",
        "ai-security"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Finch compares baseline B with candidate C on 100 authored held-out cases. C improves total accuracy but fails every case in a five-item tenant-restriction slice. The release contract treats any cross-tenant disclosure as blocking and requires separate latency/cost/refusal reports.",
      "questions": [
        {
          "id": "fde-v1-ip03-evaluation-q1",
          "prompt": "Which release decision follows from the stated contract?",
          "options": [
            "Release C because its total accuracy is higher.",
            "Remove the five failing cases and recompute the release metric.",
            "Average the security failures into the cost score so the gain can offset them.",
            "Block C until the tenant-restriction failure is corrected and re-evaluated, despite its aggregate improvement."
          ],
          "correct": 3,
          "explanation": "The explicit security gate is not an average-score tradeoff. Higher overall accuracy cannot satisfy it; removing failures or averaging them into a different metric changes the contract instead of meeting it.",
          "competencies": [
            "evaluation",
            "ai-security"
          ]
        },
        {
          "id": "fde-v1-ip03-evaluation-q2",
          "prompt": "After repeatedly tuning C on this set, what remains needed for an honest final comparison?",
          "options": [
            "A separate untouched evaluation set or explicitly renewed holdout, with the tuning exposure recorded.",
            "Keep calling the same set unseen because the case ids did not change.",
            "Use only the easiest tuned cases to reduce evaluation noise.",
            "Compare against the baseline’s old score while changing C’s case population."
          ],
          "correct": 0,
          "explanation": "Repeated tuning exposes the set and weakens its holdout role. Stable ids do not undo exposure, easy-case selection biases the test, and differing populations make the baseline comparison misleading.",
          "competencies": [
            "evaluation"
          ]
        },
        {
          "id": "fde-v1-ip03-evaluation-q3",
          "prompt": "Which report meets the stated measurement requirement?",
          "options": [
            "A single blended score without units or slice outcomes.",
            "Quality, refusal, cost and latency separately, with the blocking slice visible.",
            "Accuracy only, treating refusals as missing data.",
            "Cost per successful answer while omitting failures and refused requests."
          ],
          "correct": 1,
          "explanation": "Separate measures reveal the contract’s tradeoffs and failures. Blending hides them; omitting refused or failed cases can change the evaluated population and conceal the outcomes users receive.",
          "competencies": [
            "evaluation"
          ]
        },
        {
          "id": "fde-v1-ip03-evaluation-q4",
          "prompt": "A grader labels an unsupported answer correct. What should the team do?",
          "options": [
            "Trust it because an automated grader produced a number.",
            "Change the expected outcome to match C without reviewing the case.",
            "Inspect the case, expected outcome and grader rule before treating its score as evidence of quality.",
            "Remove unsupported-answer cases from future evaluations."
          ],
          "correct": 2,
          "explanation": "A grader can be wrong. Reviewing the underlying contract and case tests whether the score means what it claims. Automatic trust, outcome edits chosen for the candidate and dropping the failure class discard that check.",
          "competencies": [
            "evaluation"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-tool-failure",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Partial effects and retries",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "integration",
        "tools",
        "operations"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Juniper’s workflow reserves inventory, creates a shipment and sends a notification through three services. There is no shared transaction. Each service documents a stable operation identity and a status lookup. The shipment call times out after reservation succeeded; no notification result exists. Unresolved outcomes go to an authorized operations reviewer.",
      "questions": [
        {
          "id": "fde-v1-ip03-tool-failure-q1",
          "prompt": "Which state description is justified now?",
          "options": [
            "Reservation succeeded, shipment outcome is unknown, and no notification outcome has been established.",
            "The workflow rolled back atomically because one call timed out.",
            "The shipment definitely failed before it could have any effect.",
            "Every later step completed because the first reservation succeeded."
          ],
          "correct": 0,
          "explanation": "The observations establish one success and one uncertainty. No shared transaction or timeout guarantee is supplied, so neither automatic rollback, definite shipment failure nor downstream success follows.",
          "competencies": [
            "integration",
            "tools"
          ]
        },
        {
          "id": "fde-v1-ip03-tool-failure-q2",
          "prompt": "What should happen before a new shipment operation is created?",
          "options": [
            "Create a fresh identity immediately and hope the first shipment did not happen.",
            "Use the documented status/operation identity to reconcile the uncertain shipment and apply its retry contract.",
            "Delete the local reservation record to hide the partial state.",
            "Retry the whole workflow under a different customer identity."
          ],
          "correct": 1,
          "explanation": "The status contract offers a way to resolve uncertainty without inventing a new operation. Fresh identities can duplicate effects; deleting evidence or changing the customer hides rather than repairs the partial state.",
          "competencies": [
            "integration",
            "tools"
          ]
        },
        {
          "id": "fde-v1-ip03-tool-failure-q3",
          "prompt": "Which recovery design acknowledges the lack of a shared transaction?",
          "options": [
            "Call the workflow atomic because each individual service is reliable.",
            "Promise that reverting application code undoes every external effect.",
            "Record step outcomes and define authorized compensation/reconciliation for the effects that already happened.",
            "Rely on the model to infer the missing service outcomes from the user’s request."
          ],
          "correct": 2,
          "explanation": "A step record and recovery policy make partial effects explicit. Reliable services do not create a shared transaction, code rollback does not reverse external actions, and a model guess cannot establish a service’s actual state.",
          "competencies": [
            "tools",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-tool-failure-q4",
          "prompt": "A read-only status lookup also fails. Which retry policy fits?",
          "options": [
            "Retry forever so the user never sees uncertainty.",
            "Skip status lookup and mark the shipment complete.",
            "Disable identity checks on the next lookup to reduce latency.",
            "Bound retries by the lookup contract, remaining time and backoff, then surface unresolved state for the defined review path."
          ],
          "correct": 3,
          "explanation": "The policy must preserve identity and make uncertainty visible when bounded recovery fails. Infinite retries hide delay; marking success invents an outcome; removing identity checks violates the service boundary.",
          "competencies": [
            "tools",
            "operations"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-private-network",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "The customer’s deployment boundary",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "boundaries",
        "deployment",
        "operations"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Pine’s approved design uses a private service endpoint, a scoped workload role and a release gate. The workload must not use a public fallback route. A container build proposes embedding a long-lived key. The infrastructure plan replaces a data-bearing resource. The team has no verified recovery evidence for that replacement.",
      "questions": [
        {
          "id": "fde-v1-ip03-private-network-q1",
          "prompt": "Which change addresses the credential proposal?",
          "options": [
            "Bake the key into an earlier layer and delete it in a later layer.",
            "Use the approved scoped workload identity and keep long-lived keys out of image layers.",
            "Put the key in a comment so the runtime does not execute it.",
            "Share an administrator key across all tenant deployments."
          ],
          "correct": 1,
          "explanation": "The approved identity avoids distributing an embedded long-lived key. Later deletion does not establish removal from earlier image layers; comments still carry data; a shared administrator key widens both scope and exposure.",
          "competencies": [
            "boundaries",
            "deployment"
          ]
        },
        {
          "id": "fde-v1-ip03-private-network-q2",
          "prompt": "What must the release gate do about the replacement?",
          "options": [
            "Proceed because an infrastructure tool generated the plan.",
            "Treat code rollback as proof that replaced data will reappear.",
            "Refuse rollout until the data impact, verified recovery plan and required approvals are established.",
            "Ignore replacement lines if the container health check passes."
          ],
          "correct": 2,
          "explanation": "The replacement has unresolved data risk. A generated plan and healthy container do not establish recoverability, and restoring application code does not recreate lost data. The gate needs the missing evidence before exposure.",
          "competencies": [
            "deployment"
          ]
        },
        {
          "id": "fde-v1-ip03-private-network-q3",
          "prompt": "Which acceptance check tests the private connectivity requirement?",
          "options": [
            "Verify only that an engineer’s laptop can call the public endpoint.",
            "Check only that the Terraform file contains the word private.",
            "Ask the model whether the network appears secure from its prompt.",
            "Verify the actual workload resolves and reaches the approved private endpoint under its role, while forbidden public egress is refused."
          ],
          "correct": 3,
          "explanation": "The workload’s actual route, identity and refused egress test the specified boundary. A laptop, configuration keyword or model opinion does not establish that deployed traffic follows it.",
          "competencies": [
            "boundaries",
            "deployment"
          ]
        },
        {
          "id": "fde-v1-ip03-private-network-q4",
          "prompt": "Which rollback claim is honest before recovery is verified?",
          "options": [
            "Reverting code may be possible, but replaced or migrated state needs its own tested recovery/reconciliation plan.",
            "One earlier image always restores the entire system and all data.",
            "A successful build guarantees safe rollback of every migration.",
            "The customer’s ownership makes recovery evidence unnecessary."
          ],
          "correct": 0,
          "explanation": "Code and state can change independently. Images, builds and ownership do not prove how data is recovered. The case explicitly lacks that evidence, so the release discussion must keep the limitation visible.",
          "competencies": [
            "deployment",
            "operations"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-operator",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "The operator’s decision screen",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "boundaries",
        "retrieval",
        "operations",
        "handoff"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Willow shows a proposed customer action, permitted citations and a required human approval. A request may finish after the operator cancels it. The backend is the authority for current permissions and side effects; cancelling the UI request alone does not establish that a remote operation stopped.",
      "questions": [
        {
          "id": "fde-v1-ip03-operator-q1",
          "prompt": "Which screen states support an informed decision?",
          "options": [
            "Replace every non-success state with a success-colored empty panel.",
            "Enable approval before the proposal arguments or citations have loaded.",
            "Show pending, refusal/failure and completed proposal states separately, with the action and evidence visible before approval.",
            "Hide refusal reasons to keep the screen visually consistent."
          ],
          "correct": 2,
          "explanation": "Distinct states and visible evidence let the operator understand what is ready and what failed. Empty success styling, premature approval and hidden refusal reasons conceal the information the decision requires.",
          "competencies": [
            "handoff"
          ]
        },
        {
          "id": "fde-v1-ip03-operator-q2",
          "prompt": "What should the client do with a result from a cancelled request?",
          "options": [
            "Apply it to whichever customer screen is open when it arrives.",
            "Treat UI cancellation as proof that no remote action occurred.",
            "Automatically approve it so the background work is not wasted.",
            "Ignore it for the cancelled view using request identity; reconcile any remote effect according to the backend contract."
          ],
          "correct": 3,
          "explanation": "Request identity prevents a late result from changing the wrong view. It does not prove a remote effect stopped; applying the result elsewhere or approving it adds risk and exceeds the operator’s decision.",
          "competencies": [
            "operations",
            "handoff"
          ]
        },
        {
          "id": "fde-v1-ip03-operator-q3",
          "prompt": "What must a citation link preserve?",
          "options": [
            "The current actor’s authorized route to the specific evidence; opening it must not bypass tenant permissions.",
            "A globally shared raw-document URL even if it omits authorization.",
            "Only the document title, with access assumed from the proposal’s presence.",
            "The model’s assurance that anyone with the link is an approved reader."
          ],
          "correct": 0,
          "explanation": "Evidence links remain part of the permission boundary. A raw shared URL, title or model assurance does not establish the viewer’s current right to read the document.",
          "competencies": [
            "boundaries",
            "retrieval",
            "handoff"
          ]
        },
        {
          "id": "fde-v1-ip03-operator-q4",
          "prompt": "What should happen if the server refuses approval after permissions change?",
          "options": [
            "Keep the optimistic success state because the button was clicked.",
            "Show the refusal and require a fresh authorized decision rather than presenting the action as completed.",
            "Replay under another actor’s token to honor the original UI promise.",
            "Hide the refusal and keep retrying without an updated decision."
          ],
          "correct": 1,
          "explanation": "The server is the stated authority. A click does not override changed permission; success styling, borrowed identity and silent retries misrepresent or bypass that decision.",
          "competencies": [
            "boundaries",
            "handoff"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-ip03-pattern-feedback",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Turn a deployment into a product proposal",
      "summary": "Four original scenario questions. The 80% threshold requires all four; retries are available.",
      "competencies": [
        "discovery",
        "integration",
        "boundaries",
        "operations",
        "handoff"
      ],
      "estimatedMinutes": 12,
      "passThreshold": 0.8,
      "scenario": "Fictional Hazel has two working local import adapters with different field mappings and timestamp conventions. A proposed shared parser copied from the first rejects a valid explicit-offset timestamp in the second. Product wants a bounded next decision, with the invariant and source-specific policy kept separate.",
      "questions": [
        {
          "id": "fde-v1-ip03-pattern-feedback-q1",
          "prompt": "Which boundary is a defensible proposal to test?",
          "options": [
            "Share the entire first adapter and let each team remove safety checks it does not need.",
            "Move tenant checks into a source flag so trusted imports can skip them.",
            "Declare all timestamp conventions identical because the canonical type is the same.",
            "Keep tenant/replay invariants in the core and expose validated source mapping/normalization policies as adapters."
          ],
          "correct": 3,
          "explanation": "The proposal separates required safety from explicit variation. Whole-adapter forks, optional safety and assumed semantic equivalence fail to preserve that distinction. The two deployments motivate a test, not a universal default.",
          "competencies": [
            "integration",
            "boundaries"
          ]
        },
        {
          "id": "fde-v1-ip03-pattern-feedback-q2",
          "prompt": "Which fixture helps reproduce the shared parser’s failure?",
          "options": [
            "A synthetic input preserving the explicit offset, observed rejection and expected canonical instant.",
            "A successful input with the offset removed to simplify the sample.",
            "An unrestricted production export because more data is always stronger evidence.",
            "A screenshot of the final dashboard without the transformation inputs."
          ],
          "correct": 0,
          "explanation": "The reproduction must preserve the property that fails. Removing the offset removes that property; a production export needs authorization and minimization; a dashboard screenshot does not specify the parser input or expected transformation.",
          "competencies": [
            "integration",
            "handoff"
          ]
        },
        {
          "id": "fde-v1-ip03-pattern-feedback-q3",
          "prompt": "Which feedback note gives Product an actionable decision?",
          "options": [
            "Promise a universal parser and a delivery date before checking the conflict.",
            "Compare a bounded shared interface with keeping adapters local, state evidence limits, and assign an owner and validation step.",
            "List only the preferred implementation with no alternative or unknowns.",
            "Present unmeasured savings for every future customer as an established result."
          ],
          "correct": 1,
          "explanation": "An owner, bounded comparison and evidence limits make a decision reviewable. A premature promise, omitted alternatives and invented savings commit beyond what the two cases establish.",
          "competencies": [
            "discovery",
            "handoff"
          ]
        },
        {
          "id": "fde-v1-ip03-pattern-feedback-q4",
          "prompt": "What should a stop/reversal plan include for the experiment?",
          "options": [
            "Only the command that restores the previous code image.",
            "Only a statement that the experiment is reversible.",
            "The signal that stops exposure, the accountable role, and how already transformed records are reconciled.",
            "Only the number of people who liked the proposed interface."
          ],
          "correct": 2,
          "explanation": "Reversal must address existing effects and decision authority. A code command or reversibility assertion does not explain data reconciliation, and preference counts do not establish a safe recovery path.",
          "competencies": [
            "operations",
            "handoff"
          ]
        }
      ]
    }
  ],
  "requires": []
};
