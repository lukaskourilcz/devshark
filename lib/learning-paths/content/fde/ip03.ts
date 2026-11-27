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
            "The 180 ms execution time is well under 400 ms, so every request in a full batch meets its deadline.",
            "Wait plus execution can reach 480 ms before other overhead, so the 400 ms budget is not protected.",
            "The 300 ms maximum wait is under 400 ms, so requests always finish before the deadline expires.",
            "Batching amortizes the queue, so time spent waiting does not need to count against the budget."
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
            "Authorize the batch once as its most privileged actor so every item can read what it needs.",
            "Authorize the first item and reuse its scope for the rest, since every item is a read-only lookup.",
            "Keep each item’s actor scope through retrieval and result routing, even when items share a batch.",
            "Strip actor metadata before batching so identical lookups share cache hits, then route results by order."
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
            "Increase maximum batch size until average throughput peaks, so the queue drains faster for everyone.",
            "Retry an expired request in a new batch with a fresh 400 ms deadline so it still gets an answer.",
            "Report only execution latency and treat batching wait as tuning noise outside the budget.",
            "Cap batching wait by each request’s remaining time and refuse work that cannot finish in its budget."
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
            "Measure average model execution time after each batch starts, the stage batching is meant to speed up.",
            "Compare the count of successful batches before and after the change, without recording item counts.",
            "Measure the total number of requests accepted into the queue as the throughput the batcher delivers."
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
            "Accept all work into an unbounded queue so interactive users never see a refusal during the campaign.",
            "Pause tenant checks until campaign load returns to normal, then re-enable them once queues drain.",
            "Apply bounded admission and shed or defer the optional report before weakening interactive safety checks.",
            "Retry every queued request immediately on any free worker so old requests finish before their deadlines."
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
            "Multiply the old average request count by ten and size the pool on the measured per-request cost.",
            "Use latency of successful requests only, after removing rejected ones that would skew the percentiles.",
            "Use the campaign’s projected visitor count, converted at the old ratio, as backend demand.",
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
            "Bounded retries with backoff and a remaining-deadline check, for operations with known retry semantics.",
            "Retry without delay until the service acknowledges, so each request reaches a worker as early as possible.",
            "Raise client concurrency after each rejected retry so more attempts get through while capacity frees up.",
            "Retry mutations under a fresh identity so the server treats them as new work rather than duplicates."
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
            "Per-tenant refusal rates recorded for each tenant alongside the global latency figure.",
            "A good global average while one small tenant’s requests are consistently refused.",
            "A separate count of deferred optional reports, kept apart from interactive requests.",
            "End-to-end measurements that include queued and rejected requests for every tenant."
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
            "Send a small masked sample to a public endpoint, since a short pilot on masked text is not production use.",
            "Treat a provider’s published security and data-retention claims as approval for an exception to the rule.",
            "Use a hosted endpoint and rely on a system prompt telling the model never to store or retain customer text.",
            "Map data flows and reject any path that sends customer text past the boundary unless its owner changes the rule."
          ],
          "correct": 3,
          "explanation": "The explicit approved boundary governs this case. A pilot, a provider’s claims or a prompt does not authorize an exception or change where data travels. The designated owner must resolve an exception; the exercise does not decide what a law requires.",
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
            "All project operations, so future workflow extensions do not need new identity reviews or grants.",
            "The combined privileges of every user who may ask a question, so any request can be served.",
            "A shared administrator token stored in the container image so every replica authenticates the same way."
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
            "Keep complete prompts indefinitely, since audit data is operational and falls outside the retention limit.",
            "Record needed decision metadata, minimize sensitive payloads and define deletion for all audit copies.",
            "Delete the primary log after 30 days and treat exports to the analytics store as a separate system.",
            "Accept the model’s confirmation that audit copies were deleted as evidence that the 30-day limit holds."
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
            "The check covers the case’s stated controls, so passing it certifies the system against the relevant regulation.",
            "Private hosting keeps data inside the network, which makes the remaining controls optional.",
            "It shows the authored control decisions in this exercise; the named owners still assess the real system.",
            "A successful synthetic prototype replaces the approved data-flow review before live deployment."
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
            "Choose S, because control over deployment and tuning lets the team reach higher answer quality.",
            "Choose H, because a low operations burden proves lower total cost at every scale the customer may reach.",
            "Declare the shared pilot sufficient evidence, since both candidates passed it, and begin a full rollout."
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
            "Only the accelerator rental price, because the platform staff are already employed and paid anyway.",
            "The people and processes for patching, capacity, incident response and upgrades, plus infrastructure.",
            "Only the license fee, since the customer agreed to patch and operate S with its own people.",
            "Only the cost of successful requests, treating failures and idle capacity as overhead outside the comparison."
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
            "Let each candidate use its own demonstration set, chosen to show the strengths of that deployment.",
            "Compare the longest complete answer each candidate can produce on the same pilot prompts.",
            "Run the same held-out cases and report failure slices, refusal, cost and latency for both candidates.",
            "Pick the winner by training-set accuracy, without separately checking unsupported answers."
          ],
          "correct": 2,
          "explanation": "A shared held-out evaluation gives comparable evidence and exposes important tradeoffs. Separate showcase sets, answer length and training-set accuracy can hide the failures the customer actually needs the design to handle.",
          "competencies": [
            "ai-architecture",
            "evaluation"
          ]
        },
        {
          "id": "fde-v1-ip03-hosting-q4",
          "prompt": "Which rollout plan respects the remaining uncertainty?",
          "options": [
            "Move all tenants at once, since both passed the pilot, and define acceptable error rates afterwards.",
            "Remove the previous path before measuring the new one, so traffic cannot split between two systems.",
            "Treat the model selection as permanent, so the team can skip planning a rollback for this change.",
            "Run a bounded rollout with an owner, monitored acceptance thresholds and a reversal/reconciliation plan."
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
            "The model’s system prompt, because it states the approval rule and the model follows it each turn.",
            "Trusted server code that checks the current actor, exact proposal and bound approval before paying.",
            "A client-side Approved badge set by the reviewer, without binding it to the submitted arguments.",
            "A retrieved account note stating that refunds for this customer are pre-approved by support."
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
            "Reuse the existing approval, because the account id and plan version did not change.",
            "Execute the new amount if the model explains the change and the difference is small.",
            "Reject the stale approval and get a new one for the changed proposal under current authority.",
            "Carry the original approval timestamp into the changed request so the audit trail stays continuous."
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
            "Create a new idempotency key so the payment service accepts the retry instead of rejecting a duplicate.",
            "Treat the timeout as proof that no refund happened and ask the operator to approve it again.",
            "Issue a compensating charge right away, before checking the outcome, in case the refund went through.",
            "Reconcile the recorded outcome, then retry only under the same idempotency key per the payment contract."
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
            "As an updated policy, because it arrived through the approved retrieval index.",
            "As authorization, if its wording names the customer and the exact refund amount.",
            "As a reason to enable an administrator tool so the request can finish without delay."
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
            "A model-reported confidence score for each answer, stored with the response so reviewers can sort by certainty.",
            "A citation marker in the answer text, checked by a pattern match that confirms each paragraph has a source tag.",
            "The authorized source id and version plus retrieval time, with each supported claim linked to that evidence.",
            "The document title and folder path, kept stable across revisions so links survive when the policy is replaced."
          ],
          "correct": 2,
          "explanation": "Versioned provenance identifies the permitted evidence an answer used. A confidence score, a citation-shaped marker and a title reused across versions do not establish which version supported the claim or whether the current actor could read it.",
          "competencies": [
            "retrieval"
          ]
        },
        {
          "id": "fde-v1-ip03-freshness-q2",
          "prompt": "What must a removal plan inventory?",
          "options": [
            "The original source file, since the index and caches rebuild from it on their next scheduled refresh.",
            "The answer cache users see, since the index stores only vectors and holds no readable policy text.",
            "The browser history and local storage of users who saw the answer, so the old text leaves their devices.",
            "The index, caches and exported snapshots, with an owner and the stated policy for each copy."
          ],
          "correct": 3,
          "explanation": "The scenario names separately stored copies, so the plan must address the lifecycle of each one. A scheduled rebuild does not prove those copies disappeared, a vector index or snapshot still needs a stated policy, and user browsers are not among the copies Alder stores.",
          "competencies": [
            "boundaries",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-freshness-q3",
          "prompt": "Which test addresses the 09:05 permission change?",
          "options": [
            "Query as the revoked user after 09:05, including a warm answer-cache path, and confirm the removed material is not used.",
            "Query as an administrator after 09:05 and confirm the answer cites the replaced policy version, since admins see every document.",
            "Clear all caches first, then query as the revoked user so the test runs on a clean, repeatable cold path.",
            "Check the index access list for the policy document and confirm the revoked user no longer appears on it."
          ],
          "correct": 0,
          "explanation": "The revoked actor and the warm cache path exercise the boundary that changed. An administrator query, a forced cold path and index metadata cannot establish that cached answers respect the revoked permission.",
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
            "That an authorized reviewer can open the cited source and check the passage the answer relied on.",
            "That the whole answer is current, authorized and supported because one of its citation ids resolves.",
            "That stored source-version metadata can help a reviewer reproduce which document a retrieval returned.",
            "That each substantive claim in the answer still needs its own support from the permitted evidence."
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
            "Release C, since its total accuracy beats B on the same 100 held-out cases and the slice is only five items.",
            "Drop the five failing cases as an unrepresentative slice and recompute the release metric on the rest.",
            "Fold the security failures into a weighted overall score so the accuracy gain can offset them.",
            "Block C until the tenant-restriction failures are fixed and re-evaluated, whatever its total accuracy."
          ],
          "correct": 3,
          "explanation": "The explicit security gate is not an average-score tradeoff. Higher total accuracy cannot satisfy it, and dropping the failing slice or weighting it into an overall score changes the contract instead of meeting it.",
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
            "Keep reporting the same set as unseen, since the case ids and expected outputs have not changed.",
            "Rerun only the cases C now passes reliably, so run-to-run noise does not blur the final comparison.",
            "Compare C’s new score with B’s score from the original run, even though C’s case population changed."
          ],
          "correct": 0,
          "explanation": "Repeated tuning exposes the set and weakens its holdout role. Unchanged ids do not undo exposure, keeping only the cases C passes biases the test, and differing populations make the baseline comparison misleading.",
          "competencies": [
            "evaluation"
          ]
        },
        {
          "id": "fde-v1-ip03-evaluation-q3",
          "prompt": "Which report meets the stated measurement requirement?",
          "options": [
            "A single blended score that combines quality, cost and latency, without units or slice outcomes.",
            "Quality, refusal, cost and latency separately, with the blocking slice visible.",
            "Accuracy on answered cases only, with refusals treated as missing data.",
            "Cost per successful answer, leaving out failed and refused requests."
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
            "Accept the label, since the automated grader applies the same rule to every candidate and the baseline.",
            "Update the expected outcome to match C’s answer, since C passed most other cases in that slice.",
            "Inspect the case, expected outcome and grader rule before treating its score as evidence of quality.",
            "Drop unsupported-answer cases from future runs, since the grader cannot score them reliably."
          ],
          "correct": 2,
          "explanation": "A grader can be wrong, and applying the same wrong rule to every candidate stays wrong. Reviewing the case and the grader rule tests whether the score means what it claims. Accepting the label, editing the outcome to fit the candidate and dropping the failure class discard that check.",
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
            "The workflow rolled back as a unit, since the timeout aborted the request before the shipment step committed.",
            "The shipment failed with no effect, since a timed-out call returns before the service processes the request.",
            "The shipment and notification completed, since the reservation succeeded and later steps run in order."
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
            "Create the shipment again under a fresh operation identity, since the first attempt returned no result.",
            "Reconcile the shipment through its status lookup and operation identity, then follow its retry contract.",
            "Delete the local reservation record so the workflow restarts from a clean state with no partial effects.",
            "Rerun the whole workflow under a new customer session so the services treat it as a separate request."
          ],
          "correct": 1,
          "explanation": "The status contract offers a way to resolve uncertainty without inventing a new operation. A fresh identity can duplicate the shipment; deleting the reservation record or rerunning under a new session hides the partial state instead of repairing it.",
          "competencies": [
            "integration",
            "tools"
          ]
        },
        {
          "id": "fde-v1-ip03-tool-failure-q3",
          "prompt": "Which recovery design acknowledges the lack of a shared transaction?",
          "options": [
            "Treat the workflow as atomic, since each of the three services reports high availability and retries itself.",
            "Revert the application code to the last release, which undoes every external effect the workflow made.",
            "Record step outcomes and define authorized compensation/reconciliation for the effects that already happened.",
            "Let the model infer the missing service outcomes from the user’s request and the workflow’s normal order."
          ],
          "correct": 2,
          "explanation": "A step record and recovery policy make partial effects explicit. Reliable services do not create a shared transaction, reverting code does not reverse external actions, and a model guess cannot establish a service’s actual state.",
          "competencies": [
            "tools",
            "operations"
          ]
        },
        {
          "id": "fde-v1-ip03-tool-failure-q4",
          "prompt": "A read-only status lookup also fails. Which retry policy fits?",
          "options": [
            "Retry the lookup until it succeeds, however long it takes, so the user never has to see an uncertain state.",
            "Skip the lookup and mark the shipment complete, since the reservation succeeded and most shipments go through.",
            "Skip the caller identity check on the next lookup to cut latency, since the lookup is read-only anyway.",
            "Bound retries by contract, time budget and backoff, then hand the unresolved state to the operations reviewer."
          ],
          "correct": 3,
          "explanation": "The policy must preserve identity and make uncertainty visible when bounded recovery fails. Unbounded retries hide the delay; marking success invents an outcome; a read-only call still crosses the service boundary, so skipping its identity check violates it.",
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
            "Copy the key into an early build layer and delete it in a later layer so the final image has no key file.",
            "Use the approved scoped workload identity and keep long-lived keys out of image layers.",
            "Store the key in a commented-out line of the config file so the runtime never reads or executes it.",
            "Share one administrator key across all tenant deployments so rotation happens in a single place."
          ],
          "correct": 1,
          "explanation": "The approved identity avoids distributing an embedded long-lived key. Later deletion does not remove the key from earlier image layers; a commented line still ships the data; a shared administrator key widens both scope and exposure.",
          "competencies": [
            "boundaries",
            "deployment"
          ]
        },
        {
          "id": "fde-v1-ip03-private-network-q2",
          "prompt": "What must the release gate do about the replacement?",
          "options": [
            "Proceed, since the infrastructure tool generated the plan and its validation step reported no errors.",
            "Treat a code rollback to the previous release as the recovery path for the replaced data.",
            "Refuse rollout until the data impact, verified recovery plan and required approvals are established.",
            "Proceed if the container health check passes, since replacement lines are routine in generated plans."
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
            "From an engineer’s laptop on the corporate VPN, call the service endpoint and confirm it returns a 200.",
            "Check that the Terraform plan sets the endpoint type to private and declares no public route for the service.",
            "Ask the model to review the network configuration and report whether the setup appears secure.",
            "From the deployed workload under its role, reach the private endpoint and confirm public egress is refused."
          ],
          "correct": 3,
          "explanation": "The workload’s actual route, identity and refused egress test the specified boundary. A laptop call, a planned setting or a model review does not establish that deployed traffic follows it.",
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
            "Redeploying the earlier image restores the system, since the image pins the schema and data version it shipped with.",
            "A green build of the previous release shows that each migration in it can be rolled back safely.",
            "Because the customer owns the data store, their backups cover recovery and Pine needs no evidence of its own."
          ],
          "correct": 0,
          "explanation": "Code and state can change independently. An image, a build and customer ownership do not prove how data is recovered. The case explicitly lacks that evidence, so the release discussion must keep the limitation visible.",
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
            "Render every non-success state as an empty panel in the success color, so the layout never shifts between states.",
            "Enable the approve button as soon as the proposal appears, while its arguments and citations still load.",
            "Show pending, refused/failed and completed states separately, with action and evidence visible before approval.",
            "Show one generic unavailable label for every refusal, without the reasons, so the screen stays visually uniform."
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
            "Apply it to whichever customer screen is open when it arrives, so the finished work still shows up.",
            "Discard it and treat the UI cancellation as proof that the backend never ran the remote action.",
            "Approve it automatically, since the operator started the request and the background work already finished.",
            "Drop it from the cancelled view by request identity, and reconcile any remote effect per the backend contract."
          ],
          "correct": 3,
          "explanation": "Request identity prevents a late result from changing the wrong view. It does not prove a remote effect stopped, so cancellation alone cannot rule one out; applying the result elsewhere or approving it adds risk and exceeds the operator’s decision.",
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
            "A shared raw-document URL that any reviewer can open, even when it skips the authorization check.",
            "The document title alone, with read access assumed because the citation already appears in the proposal.",
            "The model’s assurance, shown beside the link, that anyone holding it is an approved reader of that document."
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
            "Keep the success state shown after the click, since the operator already approved the action.",
            "Show the refusal and require a fresh authorized decision rather than presenting the action as completed.",
            "Replay the approval under another operator’s token so the action the UI promised still goes through.",
            "Hide the refusal and retry the approval in the background until the server accepts it."
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
            "Share the entire first adapter as the core and let each team remove the safety checks it does not need.",
            "Move tenant checks behind a per-source flag so imports from sources the team already trusts can skip them.",
            "Treat all timestamp conventions as identical, since both adapters produce the same canonical timestamp type.",
            "Keep tenant/replay invariants in the core and put validated per-source mapping and normalization in adapters."
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
            "A passing input with the offset stripped, so the sample stays small and parses in both adapters.",
            "A full production export from the second source, since real records show the failure most reliably.",
            "A screenshot of the final dashboard showing the wrong time, without the parser inputs."
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
            "Commit to a universal parser and a delivery date now, and resolve the timestamp conflict during the build.",
            "Compare a bounded shared interface with local adapters, state the evidence limits, and name an owner and test.",
            "Recommend the preferred shared parser in detail and leave out the alternative and the open unknowns.",
            "Report projected savings for all future customers as a measured result of the two deployments."
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
            "The command that restores the previous code image, tested once in staging before the experiment starts.",
            "A statement that the experiment is reversible, signed off by the team that built the shared parser.",
            "The signal that stops exposure, the accountable role, and how already transformed records are reconciled.",
            "A count of reviewers who preferred the new interface, as the threshold for keeping or reverting it."
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
