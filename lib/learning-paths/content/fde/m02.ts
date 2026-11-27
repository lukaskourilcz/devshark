/** M02 — Decomposition cases.
 *
 * The second module of the discover-and-scope phase. Two lessons teach how to
 * decompose a customer request (operator, decision, source authority,
 * baseline, a bounded first slice, the trade-off and a revised plan when a
 * constraint moves); twelve scenario checks of four ordered questions each
 * drill it. Completion needs both lessons and any nine of the twelve cases at
 * `verified_pass` (`requiresAtLeast`, completed atomically by migration 066).
 *
 * Authored under the temporary module id `fde-v1-m02-cases` (B3, #499) and
 * placed here by B9 (#505). Lesson, activity and question ids keep the
 * `fde-v1-m02-cases-` slug: activity ids are permanent.
 *
 * Twelve original fictional customer cases. No real customer data or live
 * model. */
import type { ModuleSource } from "../../types";

export const FDE_M02: ModuleSource = {
  "id": "fde-v1-m02",
  "title": "Decomposition cases",
  "outcomes": [
    "Clarify the operator, source authority and missing constraints before choosing a solution.",
    "Define a repeatable baseline and a bounded first delivery with explicit exclusions.",
    "Explain the tradeoff and revise the plan when a constraint changes.",
    "Apply the visible case rubric: both lessons acknowledged and any nine of twelve four-question cases passed at 80%."
  ],
  "competencies": [
    "discovery"
  ],
  "dependsOn": [
    "fde-v1-m01"
  ],
  "lessons": [
    {
      "id": "fde-v1-m02-cases-l1",
      "title": "Decompose the customer’s decision",
      "summary": "Clarify the operator, baseline, authority and scope before choosing a mechanism.",
      "estimatedMinutes": 20,
      "sources": [
        {
          "label": "NIST AI Risk Management Framework: Map function",
          "url": "https://airc.nist.gov/airmf-resources/airmf/5-sec-core/#map",
          "reviewedOn": "2026-10-21"
        },
        {
          "label": "Google SRE Book: Service Level Objectives",
          "url": "https://sre.google/sre-book/service-level-objectives/",
          "reviewedOn": "2026-10-21"
        },
        {
          "label": "Palantir careers: customer workflows and deployed engineering",
          "url": "https://www.palantir.com/careers/",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "OpenAI Forward Deployed Software Engineer: iterative customer delivery",
          "url": "https://openai.com/careers/forward-deployed-software-engineer-sf-san-francisco/",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "prose",
          "body": "These original fictional cases practise customer-workflow decomposition and iterative scoping, informed by the cited employer role descriptions. The rubric below is devShark’s practice rubric, not an employer’s scoring key or a claim about its current interview process. They reproduce no employer’s interview questions. Every organisation, observation, model response and record is an authored fixture; no external system or live model runs."
        },
        {
          "kind": "prose",
          "body": "Start with the person making a decision. Ask for a recent disputed example and follow it through the current workflow. A request for a dashboard, model or automation names a mechanism; establish the outcome and its constraints before accepting that mechanism as the requirement. Record what you know, what you assume and the evidence that could overturn the assumption."
        },
        {
          "kind": "table",
          "caption": "A decomposition that a reviewer can inspect",
          "headers": [
            "Step",
            "Evidence to name"
          ],
          "rows": [
            [
              "Clarify",
              "Operator, decision, source authority and explicit constraints."
            ],
            [
              "Baseline",
              "Quantity, population, observation window and repeatable measurement method."
            ],
            [
              "Bound the first slice",
              "One workflow and acceptance conditions, with exclusions and a fallback."
            ],
            [
              "Compare tradeoffs",
              "Quality, access, latency, operating effort and cost against the actual workload."
            ],
            [
              "Handle change",
              "Name which assumption changed and revise scope, evidence or promise explicitly."
            ]
          ]
        },
        {
          "kind": "prose",
          "body": "Preserve authority at each boundary. A read-only pilot cannot repair source data. A request timeout proves neither success nor failure; stable operation ids and reconciliation protect side effects. Received order is not necessarily source order. A fixture result establishes only the behaviour the fixture tests. For evidence-backed answers, check permitted sources and freshness, and abstain when the required support is absent."
        },
        {
          "kind": "prose",
          "body": "Bounded capacity and disconnected work require visible promises. More workers do not remove a downstream limit. A local cache does not establish a final shared-stock reservation. State what may queue, what remains provisional and which human or system may resolve the uncertainty. Reusable components keep common mechanics separate from customer-specific identity and retention rules."
        },
        {
          "kind": "callout",
          "tone": "note",
          "body": "devShark’s practice rubric: clarify the operator and constraints; define a repeatable baseline; choose a useful bounded slice; explain the tradeoff; revise the plan when evidence changes. Each case has four ordered questions and passes at 80%, so all four must pass. Retry after reading the feedback. Finish any nine of twelve cases and acknowledge both lessons; the remaining cases stay available for practice."
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-l2",
      "title": "Two worked decompositions",
      "summary": "Follow the dashboard and employee-sync cases from uncertainty to a bounded test and a changed constraint.",
      "estimatedMinutes": 20,
      "sources": [
        {
          "label": "NIST AI Risk Management Framework: Map function",
          "url": "https://airc.nist.gov/airmf-resources/airmf/5-sec-core/#map",
          "reviewedOn": "2026-10-21"
        },
        {
          "label": "Google SRE Book: Service Level Objectives",
          "url": "https://sre.google/sre-book/service-level-objectives/",
          "reviewedOn": "2026-10-21"
        },
        {
          "label": "Palantir careers: customer workflows and deployed engineering",
          "url": "https://www.palantir.com/careers/",
          "reviewedOn": "2026-10-22"
        },
        {
          "label": "OpenAI Forward Deployed Software Engineer: iterative customer delivery",
          "url": "https://openai.com/careers/forward-deployed-software-engineer-sf-san-francisco/",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "prose",
          "body": "Dashboard example: the operator chooses late shipments to investigate, while two source totals disagree. Trace disputed shipments before replacing the interface. A one-shift reconciliation can expose definitions and missing records without claiming write authority. Measure minutes per investigation over a named population and shift with a saved observation method. A delayed billing export changes the recency of the evidence: show its timestamp and restrict the pilot to decisions that tolerate that delay."
        },
        {
          "kind": "prose",
          "body": "Employee-sync example: immutable employee ids join the records; payroll owns employment status and Facilities owns badge groups. Ask how lifecycle events are versioned and how a termination is represented. Propose a reviewed change set for twenty employees before enabling writes. A late active event must not undo a newer termination, while a genuine rehire needs a distinguishable newer lifecycle event. A last-arrival-wins merge cannot establish either fact."
        },
        {
          "kind": "table",
          "caption": "The worked examples use the same reasoning without assuming the same implementation",
          "headers": [
            "Question",
            "Dashboard",
            "Employee sync"
          ],
          "rows": [
            [
              "Whose decision?",
              "Operations chooses an investigation.",
              "Facilities controls badge access."
            ],
            [
              "Unknown authority?",
              "Which status definition each total uses.",
              "Which source owns each field and lifecycle version."
            ],
            [
              "First safe slice?",
              "Read-only reconciliation for one shift.",
              "Reviewed proposed changes for twenty employees."
            ],
            [
              "Changed constraint?",
              "A source becomes a day old.",
              "A stale active event follows termination."
            ]
          ]
        },
        {
          "kind": "prose",
          "body": "Use the remaining cases to transfer the reasoning. A shorter deadline changes scope rather than erasing acceptance. A requested feature may conflict with an approval policy even when a useful lookup is permitted. Tail failures require slices and traces rather than a favourable mean. Hosting choices need task evidence and approved data controls, with operating cost included. Workflow adoption, queueing, offline promises and reusable abstractions each need a bounded test of their own uncertainty."
        }
      ]
    }
  ],
  "activities": [
    {
      "id": "fde-v1-m02-cases-l1-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Decompose the customer’s decision",
      "summary": "Clarify the operator, baseline, authority and scope before choosing a mechanism.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 20,
      "lessonId": "fde-v1-m02-cases-l1"
    },
    {
      "id": "fde-v1-m02-cases-l2-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Two worked decompositions",
      "summary": "Follow the dashboard and employee-sync cases from uncertainty to a bounded test and a changed constraint.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 20,
      "lessonId": "fde-v1-m02-cases-l2"
    },
    {
      "id": "fde-v1-m02-cases-dashboard",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "The dashboard nobody trusts",
      "summary": "Trace disputed shipment totals without writing to either source.",
      "scenario": "A fictional operations desk uses a dashboard to choose which late shipments to investigate. Its totals differ from the billing export. The sponsor asks for a new dashboard in two weeks; the operator still compares CSV files by hand. You have read-only access to both sources and can observe one morning shift. No source has been declared authoritative for shipment status.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-dashboard-q1",
          "prompt": "What evidence should you gather before choosing a dashboard replacement?",
          "options": [
            "Trace several disputed shipments through both sources with the operator.",
            "Compare dashboard libraries using the current screenshot as the specification.",
            "Ask the sponsor to pick one total and use it as the reporting baseline.",
            "Copy the billing export into the dashboard and compare the new colours."
          ],
          "correct": 0,
          "explanation": "Tracing disputed records shows which decisions the totals affect and where the definitions diverge. Library selection assumes presentation is the problem. Picking a total supplies authority without evidence. Copying the export hides the disagreement before anyone explains it.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-dashboard-q2",
          "prompt": "Which first deliverable tests the main uncertainty within the access you have?",
          "options": [
            "A read-only reconciliation for one shift, with unmatched records and definitions.",
            "A replacement status service that writes corrections into both source systems.",
            "A complete reporting warehouse that replaces every operational export.",
            "A new dashboard using one source, with the discrepancy left out of the pilot."
          ],
          "correct": 0,
          "explanation": "The reconciliation exposes the disagreement without requiring write access and gives the desk something it can inspect. A correction service exceeds the access boundary. A whole warehouse exceeds the narrow uncertainty. Hiding the second source prevents the pilot from testing trust.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-dashboard-q3",
          "prompt": "Which baseline can support a later comparison of investigation time?",
          "options": [
            "Median minutes per late-shipment investigation during a named shift, from saved observations.",
            "The sponsor’s target of a fifty-percent cut in investigation time after the dashboard launch.",
            "The total number of late shipments the dashboard displayed during this morning’s shift.",
            "Daily page views of the current dashboard, taken from its analytics over the last month."
          ],
          "correct": 0,
          "explanation": "The observed investigation times define the work, population, window and measurement method. The reduction is a target rather than a starting value. Shipment count measures volume, while page views measure visits; neither measures time spent investigating.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-dashboard-q4",
          "prompt": "The billing export is now delayed by a day. What should change in the pilot?",
          "options": [
            "Show source timestamps and test decisions that tolerate the known delay.",
            "Treat the delayed export as current because its totals are more complete.",
            "Estimate missing shipments and write those estimates back as confirmed status.",
            "Remove the export timestamp so operators judge only the reconciled total."
          ],
          "correct": 0,
          "explanation": "The new constraint changes what decisions the evidence can support. Treating old data as current or hiding its age conceals that limit. Writing estimates as confirmed facts changes source data without evidence or permission.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-employee-sync",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Synchronise two employee systems",
      "summary": "Define field ownership and ordering before synchronising employee records.",
      "scenario": "A fictional company keeps payroll details in one service and office access in another. Names and email addresses can change; both systems expose an immutable employee identifier. Payroll owns employment status, Facilities owns badge groups. The requested pilot covers twenty employees, runs nightly and must not grant access to a person whose employment has ended.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-employee-sync-q1",
          "prompt": "Which unresolved question most affects the synchronisation contract?",
          "options": [
            "Which source owns each employee field and how changes, deletions and conflicting updates are ordered.",
            "Which shared email address can join records, assuming every account keeps it unchanged.",
            "Which export arrived most recently, using arrival time to resolve every conflicting field.",
            "Which source contains the most populated fields, making that source authoritative for the entire record."
          ],
          "correct": 0,
          "explanation": "Field ownership and change semantics define the sync contract. Email may change or be reused, so it is not a safe identity assumption. Arrival order can differ from source order. Completeness does not establish authority for every field.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-employee-sync-q2",
          "prompt": "Which ownership rule follows the stated source responsibilities?",
          "options": [
            "Match immutable ids; payroll supplies status and Facilities supplies badge groups.",
            "Match current email; whichever system replies last supplies every field.",
            "Match full name; payroll supplies badge groups because it owns employment status.",
            "Match immutable ids; copy all Facilities fields over the payroll record nightly."
          ],
          "correct": 0,
          "explanation": "Stable ids survive name changes, and field ownership follows the stated contract. Email and names are mutable identifiers. Last response is not authority. Payroll does not own badge groups, and Facilities does not own payroll status.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-employee-sync-q3",
          "prompt": "What is the smallest pilot that can expose dangerous differences before granting access?",
          "options": [
            "Generate a proposed change set and have Facilities review status conflicts before writes.",
            "Replace both employee directories after one successful end-to-end API request.",
            "Send every differing field to both APIs and inspect failures the next morning.",
            "Synchronise active records only and ignore termination events during the pilot."
          ],
          "correct": 0,
          "explanation": "A reviewed proposal tests mapping and lifecycle behaviour before its side effect. Replacing directories exceeds the pilot. Blind writes discover mistakes after they affect access. Ignoring termination removes the explicit safety requirement.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-employee-sync-q4",
          "prompt": "A late active-status event arrives after a confirmed termination. What should the design do?",
          "options": [
            "Use the agreed source version or lifecycle order so stale data cannot restore access.",
            "Restore access because the most recently received event is always the freshest fact.",
            "Discard every later status update, including a confirmed rehire with a newer version.",
            "Resolve the conflict from the employee’s current display name in the office directory."
          ],
          "correct": 0,
          "explanation": "Source versions or an explicit lifecycle order distinguish a stale event from a genuine rehire. Arrival time alone cannot. Discarding every later change also blocks valid rehiring. A display name establishes neither status nor event order.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-deadline",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Two weeks or two months",
      "summary": "Negotiate a useful delivery within a fixed deadline and access boundary.",
      "scenario": "A fictional support team asks for ticket classification, knowledge search, automatic replies and reporting. A review with operators identifies classification as their largest repetitive task. The sponsor needs usable evidence in two weeks; a full integration is estimated at two months. Existing policy requires a person to approve customer messages. The pilot can read one ticket queue but cannot send messages.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-deadline-q1",
          "prompt": "Which question should settle the first release’s purpose?",
          "options": [
            "What operator decision must improve, and what evidence can the sponsor review in two weeks?",
            "Which four requested features should receive equal engineering time in the pilot?",
            "Which launch date should be announced before the integration estimate is checked?",
            "Which model should generate replies despite the pilot having no send permission?"
          ],
          "correct": 0,
          "explanation": "A decision and measurable evidence anchor the short release. Equal feature allocation ignores the observed bottleneck. An unchecked announcement creates a promise without a plan. Reply generation chooses a mechanism that the pilot cannot deliver safely.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-deadline-q2",
          "prompt": "Which scope fits the evidence and permissions?",
          "options": [
            "Classify one queue for operator review and measure correction effort against a baseline.",
            "Implement all four features with reduced testing to preserve the two-week date.",
            "Launch automatic replies first and add human approval after the pilot.",
            "Wait two months without testing whether classification helps the operators."
          ],
          "correct": 0,
          "explanation": "A reviewed classification slice tests the known repetitive task with read access. Reducing tests to fit every feature increases uncertainty. Automatic replies violate approval and access constraints. Waiting for everything gives up the chance to test value earlier.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-deadline-q3",
          "prompt": "Which exclusion belongs in the written pilot agreement?",
          "options": [
            "No automatic customer messages; the pilot ends with a measured go-or-stop review.",
            "No operator feedback until the complete integration reaches production.",
            "No limitations in the sponsor update because they could weaken confidence.",
            "No named population because the classifier should eventually cover every queue."
          ],
          "correct": 0,
          "explanation": "The exclusion makes the permissions and decision point explicit. Removing operator feedback prevents learning. Hiding limitations misrepresents the evidence. A pilot needs a defined population even if a later release broadens it.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-deadline-q4",
          "prompt": "The sponsor adds a second queue after the first week. What should you do?",
          "options": [
            "Estimate the added work and trade a named scope item or move the review date explicitly.",
            "Add it without changing the agreement because queues are the same kind of input.",
            "Keep the date by dropping the operator review that made the pilot measurable.",
            "Promise the additional queue and leave the original acceptance conditions unchanged."
          ],
          "correct": 0,
          "explanation": "The change needs a visible tradeoff in scope, evidence or time. Similar inputs can have different labels and permissions. Dropping review removes the value test. An unchanged promise does not remove the additional work.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-wrong-feature",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "The requested feature conflicts with the workflow",
      "summary": "Check the operator’s decision before accepting a requested feature.",
      "scenario": "A fictional account team asks for automatic approval of refund requests. Observation shows that most time goes into finding the purchase and checking an existing eligibility policy. The finance owner requires a person to approve each payment. You may prototype a read-only purchase lookup and eligibility summary, but you cannot change the approval policy.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-wrong-feature-q1",
          "prompt": "Which response best reframes the request using the observed workflow?",
          "options": [
            "Confirm the delay to remove, then test whether lookup and evidence preparation reduce it.",
            "Accept automatic approval as the requirement and treat the finance rule as a later detail.",
            "Reject the entire project because one requested mechanism conflicts with policy.",
            "Build a refund-writing API before asking how eligibility is decided today."
          ],
          "correct": 0,
          "explanation": "The observed delay may be reduced without changing the approval boundary. Accepting the mechanism ignores that boundary. Rejecting the whole project misses a permitted improvement. A payment API starts implementation before the decision contract exists.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-wrong-feature-q2",
          "prompt": "Which prototype fits the authority you have?",
          "options": [
            "A purchase lookup with an eligibility explanation and an explicit handoff to the approver.",
            "An automatic refund for amounts below a threshold chosen by the prototype author.",
            "A summary page that quietly marks the refund approved after showing its evidence.",
            "A payment screen that sends the refund when the operator opens the ticket."
          ],
          "correct": 0,
          "explanation": "The lookup prepares the decision while leaving payment approval with its owner. An invented threshold grants authority nobody supplied. Marking approval or paying on page view crosses the same boundary through a different interface.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-wrong-feature-q3",
          "prompt": "What should the sponsor update make explicit?",
          "options": [
            "The measured lookup improvement and the approval-policy change still outside this project.",
            "A claim that faster summaries prove autonomous refunds are safe for every request.",
            "A promise to remove the approver once operators become familiar with the prototype.",
            "A statement that policy compliance is guaranteed because no model provider is named."
          ],
          "correct": 0,
          "explanation": "Report what the prototype measures and which decision remains with Finance. Faster lookup does not prove refund correctness. Familiarity does not change approval authority. Omitting a provider name establishes no compliance result.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-wrong-feature-q4",
          "prompt": "Finance authorises a limited payment pilot. What must happen before adding writes?",
          "options": [
            "Agree the eligible cases, approval evidence, audit trail and rollback or compensation procedure.",
            "Reuse the read-only pilot’s acceptance unchanged because its lookup already worked.",
            "Enable writes for every request and use complaints to identify exceptional cases.",
            "Remove the operator confirmation so the limited pilot demonstrates full automation."
          ],
          "correct": 0,
          "explanation": "Write authority introduces side effects that need bounded cases, evidence and recovery. Read-only acceptance does not cover payments. Complaint-driven discovery exposes customers to avoidable mistakes. A limited pilot does not authorise removing confirmation.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-timeouts",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Intermittent production API timeouts",
      "summary": "Resolve uncertain side effects without treating timeouts as proof of failure.",
      "scenario": "A fictional integration times out on roughly one request in a hundred. Operators report that large exports are affected more often. The customer asks for a database rewrite. You have request ids, latency traces and a read-only log sample; the external API has a documented rate limit. Retrying a write can create duplicate jobs unless its idempotency key is reused.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-timeouts-q1",
          "prompt": "What should you inspect first?",
          "options": [
            "Correlate timed-out request ids with payload size and dependency timings.",
            "Choose a replacement database based on the overall average latency.",
            "Increase every timeout before separating external and local processing time.",
            "Compare frontend bundle sizes without tracing the export requests."
          ],
          "correct": 0,
          "explanation": "Correlated traces can locate the delay and test the large-export hypothesis. An average hides the slow tail. Raising all deadlines can increase saturation without identifying the cause. Bundle size does not locate the server-side export timeout.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-timeouts-q2",
          "prompt": "Which first intervention best respects the known write contract?",
          "options": [
            "Trial bounded retries with the same idempotency key for a defined transient failure.",
            "Retry every failed write immediately with a fresh key until it succeeds.",
            "Send duplicate export jobs to several workers and keep the earliest response.",
            "Remove the external rate limit in the client configuration for the pilot."
          ],
          "correct": 0,
          "explanation": "Bounded retries preserve the write identity and should apply only to an agreed transient class. Fresh keys and duplicate jobs can repeat side effects. Client configuration cannot remove a provider-enforced rate limit.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-timeouts-q3",
          "prompt": "Which result would justify a claim about the affected users?",
          "options": [
            "Tail latency and failure rate by export-size slice over a comparable observation window.",
            "A lower mean latency after excluding all timed-out exports from the sample.",
            "One small export that succeeds after the retry change reaches a staging server.",
            "The total number of retries performed without a count of completed jobs."
          ],
          "correct": 0,
          "explanation": "Comparable slices include the affected large exports and failures. Excluding timeouts changes the population. One staging success cannot establish production improvement. Retry count alone says nothing about completion or duplicate writes.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-timeouts-q4",
          "prompt": "The external API reduces its rate limit. What should change first?",
          "options": [
            "Recalculate retry and concurrency budgets and expose a bounded queue or backpressure policy.",
            "Double retry concurrency so each export has more chances before its deadline.",
            "Preserve the old retry rate and describe new rejections as random network failures.",
            "Rewrite the database before measuring whether the external limit now binds."
          ],
          "correct": 0,
          "explanation": "A tighter dependency limit changes how much work can safely enter. More retries can amplify overload. Relabelling rejections hides the new constraint. A local database rewrite does not remove an external throughput ceiling.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-hosting",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "A regulated customer considers model hosting",
      "summary": "Compare a hosting plan against workload and operating constraints.",
      "scenario": "A fictional customer’s written data policy permits sensitive document processing only in an approved private network. No hosted model endpoint is approved yet. The customer has a small platform team and an eight-week pilot window. A deterministic rules baseline solves a narrow subset of requests. You must compare options without treating a hosting label as evidence of security.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-hosting-q1",
          "prompt": "Which question belongs before provider or deployment selection?",
          "options": [
            "Which data classes, network paths and retention controls must the approval review verify?",
            "Which hosted provider has the most persuasive public demonstration?",
            "Which model has the highest general benchmark score without the customer’s data?",
            "Which self-hosted model can be deployed before an operator workflow is chosen?"
          ],
          "correct": 0,
          "explanation": "The explicit policy determines which options can be considered. Demonstrations and general benchmarks do not establish permitted data flow. A self-hosted deployment also needs a defined workflow and security review.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-hosting-q2",
          "prompt": "Which pilot can start within the stated approval boundary?",
          "options": [
            "Evaluate the rules baseline and approved-network fixtures while the endpoint review proceeds.",
            "Send sensitive documents to an unapproved endpoint and delete them after evaluation.",
            "Declare self-hosting approved because the customer owns the virtual machines.",
            "Remove sensitive fields by hand and assume the remaining text cannot contain them."
          ],
          "correct": 0,
          "explanation": "The baseline and fixtures permit progress without bypassing the data gate. Deleting later does not authorise initial disclosure. Ownership does not prove network, access or retention controls. Ad hoc redaction does not establish that sensitive content is absent.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-hosting-q3",
          "prompt": "Which comparison exposes a real hosting tradeoff for this team?",
          "options": [
            "Task quality, reviewable data controls, operating effort and cost at the expected workload.",
            "The model’s public rank alone, with security and operation deferred until purchase.",
            "A claim that private machines eliminate the need for monitoring and patching.",
            "The lowest token price, with retries and platform staffing left out of the estimate."
          ],
          "correct": 0,
          "explanation": "Quality, controls, workload and operating responsibility make the alternatives comparable. Public rank alone omits the customer constraints. Self-hosting retains operational obligations. Unit token price omits significant parts of delivery cost.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-hosting-q4",
          "prompt": "The hosted endpoint gains approval with a strict request cap. What follows?",
          "options": [
            "Re-evaluate the bounded use case and fallback against that cap before expanding the pilot.",
            "Send all queued requests because approval implies unlimited authorised capacity.",
            "Discard the deterministic baseline because approval proves the model is more accurate.",
            "Move all sensitive work off the private network without reading the approval’s conditions."
          ],
          "correct": 0,
          "explanation": "Approval has conditions; capacity and fallback must fit the actual use case. It is neither an unlimited quota nor quality evidence. A network exception cannot be inferred beyond the approved data flow.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-invoices",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Duplicate invoice events",
      "summary": "Reconcile an uncertain payment and prevent a duplicate external effect.",
      "scenario": "A fictional accounts team receives payment events from a provider. Delivery is at least once; each event has a stable event id and each invoice has its own id. The team wants an internal settlement workflow. A timeout can occur after the provider commits a payment. The pilot must never pay an invoice twice and may keep a reconciliation queue for uncertain outcomes.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-invoices-q1",
          "prompt": "Which distinction must the integration contract make first?",
          "options": [
            "The identity of a delivery, an invoice and an individual payment operation.",
            "Which local timeout duration should trigger a new payment operation with a fresh id.",
            "Which database transaction can cover both the local write and the external provider without provider cooperation.",
            "Which provider error status can be treated as proof that no payment occurred."
          ],
          "correct": 0,
          "explanation": "First establish operation identity, the provider’s idempotency contract and how to reconcile uncertain outcomes. A timeout does not prove absence of a payment. A local transaction cannot atomically commit a separate provider’s side effect. An error response alone may follow an applied operation and must be interpreted using the provider contract.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-invoices-q2",
          "prompt": "What should happen when a payment request times out with an unknown outcome?",
          "options": [
            "Look up the original operation or reconcile it before retrying with its stable identity.",
            "Create a new payment operation because a timeout proves no payment committed.",
            "Mark the invoice paid because any timeout implies the provider accepted it.",
            "Delete the failed request so the next nightly run treats the invoice as new."
          ],
          "correct": 0,
          "explanation": "A timeout does not prove success or failure. Looking up or reconciling the original operation resolves uncertainty without creating a second identity. Assuming either outcome can misstate payment state, and deleting the record loses the evidence needed to reconcile.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-invoices-q3",
          "prompt": "Which pilot acceptance test probes the named safety requirement?",
          "options": [
            "Replay the uncertain operation and verify one provider payment with the expected settled amount and one reconciled local record.",
            "Replay the same operation and verify one local invoice record, without checking the provider’s payment ledger.",
            "Send many distinct fresh invoices and verify their throughput and provider settlement totals.",
            "Replay with a new operation id after each timeout and verify that each request receives a success response."
          ],
          "correct": 0,
          "explanation": "An uncertain-outcome replay must establish one external payment and its settled amount as well as stable identity and the local record. One local record does not exclude duplicate provider charges. Fresh-invoice throughput avoids the ambiguous retry branch. A fresh operation id can create another charge; individual success responses do not prove one payment for the original operation.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-invoices-q4",
          "prompt": "The provider cannot look up an operation by key. What tradeoff should you present?",
          "options": [
            "Hold uncertain payments for reconciliation until an agreed source can establish the outcome.",
            "Repeat uncertain payments with new keys because manual review slows settlement.",
            "Treat every timeout as a permanent failure without reconciling the invoice later.",
            "Remove idempotency keys because the provider cannot search them directly."
          ],
          "correct": 0,
          "explanation": "Holding uncertainty costs time but avoids pretending the outcome is known. Fresh-key retries can duplicate a payment. Permanent failure without reconciliation can leave financial records wrong. Removing keys does not add outcome visibility.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-knowledge",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Answers from a private knowledge base",
      "summary": "Bound evidence-backed answers by source access and freshness.",
      "scenario": "A fictional support desk wants faster answers from a knowledge base. Documents have tenant access rules and revision dates; some articles are superseded. The pilot uses fixed retrieval results and authored model responses, not a live model. Every suggested answer must cite an accessible current source, or abstain for human review.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-knowledge-q1",
          "prompt": "Which first question most affects whether an answer is permitted?",
          "options": [
            "How the caller’s tenant and permissions limit the documents it may retrieve.",
            "Which embedding index offers the highest benchmark recall before testing document-level access rules.",
            "Which global confidence threshold should publish answers before defining acceptable source freshness.",
            "Which shared cache key maximises reuse across users before examining their document permissions."
          ],
          "correct": 0,
          "explanation": "Permitted sources, document access and freshness determine whether an answer may be given. Retrieval benchmarks alone do not prove authorised retrieval. A confidence threshold does not establish freshness. A shared cache needs permission-aware boundaries before reuse.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-knowledge-q2",
          "prompt": "Which first slice fits the pilot’s stated evidence contract?",
          "options": [
            "One tenant and document family, with current citations, inaccessible-source tests and abstention.",
            "All tenants at once, relying on answer wording to conceal restricted source names.",
            "A search across old and new articles, with whichever result has the highest raw score.",
            "A live model demonstration that omits sources because the pilot uses fixtures."
          ],
          "correct": 0,
          "explanation": "A bounded tenant slice can test freshness, access and refusal explicitly. Hiding source names does not prevent leakage. A high similarity score does not establish current authority. Fixture work cannot establish live-model performance or remove the citation requirement.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-knowledge-q3",
          "prompt": "Which evaluation distinguishes better answers from more confident guesses?",
          "options": [
            "Correct, supported answers and justified abstentions, broken down by access and freshness cases.",
            "The fraction of requests receiving any answer, with abstention counted as a defect.",
            "The average response length, with longer answers treated as more complete.",
            "The number of retrieved documents, without checking which documents support a claim."
          ],
          "correct": 0,
          "explanation": "The evaluation must cover support and warranted refusal on the named failure slices. Answer rate alone rewards guessing. Length and retrieval count do not establish whether a claim is supported.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-knowledge-q4",
          "prompt": "The current policy document disappears from the fixture results. What should happen?",
          "options": [
            "Abstain and identify the missing current evidence for human review.",
            "Use the superseded policy because a citation is better than no citation.",
            "Infer the new policy from the titles of the remaining documents.",
            "Return the draft answer unchanged and omit its broken source link."
          ],
          "correct": 0,
          "explanation": "Missing required evidence triggers the agreed abstention. A superseded policy can contradict the current one. Titles do not supply the missing terms, and removing a link hides the reason the answer cannot be supported.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-adoption",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "The pilot is fast but unused",
      "summary": "Measure an operational outcome and plan for adoption.",
      "scenario": "A fictional operations pilot passes its offline checks and reduces a demonstrated lookup from ninety seconds to ten. Two weeks later, operators rarely open it. They explain that it lives outside their main ticket tool and loses their current ticket context. The sponsor asks for a larger model. You can modify a browser link and a read-only lookup, but not the ticket vendor’s core interface.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-adoption-q1",
          "prompt": "What should you clarify before accepting the model request?",
          "options": [
            "Where the lookup fits in a live ticket and what causes the operator to abandon it.",
            "Which larger model has the highest published score for general reasoning.",
            "Whether the pilot can advertise the ninety-to-ten-second demo result more prominently.",
            "Which operator has the lowest login count and should receive a reminder."
          ],
          "correct": 0,
          "explanation": "The observed barrier is workflow friction, so inspect context loss and abandonment. Model scores do not explain that barrier. Promoting a demo or targeting a person does not establish why the workflow is unused.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-adoption-q2",
          "prompt": "Which intervention tests that adoption hypothesis within your control?",
          "options": [
            "Open the read-only lookup with the current ticket context through an agreed browser link.",
            "Replace the ticket vendor’s interface and migrate all operator shortcuts immediately.",
            "Require operators to copy each ticket into the pilot before continuing their work.",
            "Increase model size while keeping the separate login and manual context transfer."
          ],
          "correct": 0,
          "explanation": "A contextual link changes the suspected friction without replacing the vendor system. A full migration exceeds control and scope. Mandatory copying adds the same friction. A larger model leaves the stated adoption barrier unchanged.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-adoption-q3",
          "prompt": "Which observation can support a claim about useful adoption?",
          "options": [
            "Use in eligible tickets, successful returns to the workflow and operator correction effort.",
            "The number of operators who received and opened the email announcing the new pilot link.",
            "The number of pilot logins recorded in the week after a compulsory training session.",
            "The number of tokens the lookup consumed each day after the larger model was switched on."
          ],
          "correct": 0,
          "explanation": "Eligible-workflow use and correction effort connect adoption to actual work. Emails measure reach, compulsory logins can measure attendance, and token use measures consumption. None alone establishes usefulness.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-adoption-q4",
          "prompt": "The link cannot carry sensitive ticket data in a URL. What should you change?",
          "options": [
            "Pass an opaque permitted identifier and resolve authorised context on the server.",
            "Put the full ticket text in a fragment and assume every environment keeps it private.",
            "Encode the ticket text as base64 and send it as a query parameter.",
            "Remove access checks from the lookup so operators need not sign in again."
          ],
          "correct": 0,
          "explanation": "An opaque identifier avoids copying content into the URL while server authorisation still controls the read. Fragments and base64 do not establish permission or reliable privacy. Removing access checks crosses a security boundary to solve a workflow problem.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-surge",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "A tenfold traffic spike",
      "summary": "Plan burst traffic around a shared downstream request budget.",
      "scenario": "A fictional service handles fifty jobs a minute under a two-minute completion objective. A launch may send five hundred jobs a minute. The downstream API accepts at most one hundred requests a minute; some jobs are urgent and others may wait. Repeating an accepted job must not repeat its customer notification. The sponsor asks to scale every worker tenfold.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-surge-q1",
          "prompt": "Which question most changes the capacity plan?",
          "options": [
            "Which jobs are urgent, what may queue and how the downstream cap applies to each job.",
            "Which worker instance type has the highest thread count for absorbing tenfold load.",
            "Which chart makes the five-hundred-job launch forecast easiest for the sponsor to approve.",
            "Which notification template the urgent and deferred job classes should share at launch."
          ],
          "correct": 0,
          "explanation": "Priority, queue tolerance and dependency demand determine the admitted workload. Instance size cannot remove the external cap. Presentation and wording do not determine how many downstream requests a job needs.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-surge-q2",
          "prompt": "Which initial design respects the hard dependency limit?",
          "options": [
            "Share one 100-per-minute budget across workers and retries, plus a bounded queue and an urgent-work policy.",
            "Limit each worker to 100 downstream requests per minute and add workers whenever urgent jobs start to queue.",
            "Cap concurrent calls at 100 and retry every rejection immediately, without a shared time-based budget.",
            "Apply a shared 100-per-minute budget to first attempts, while retries draw on a separate unbounded pool."
          ],
          "correct": 0,
          "explanation": "A shared request-rate budget includes retries and respects the dependency’s time-based limit. A per-worker budget multiplies the total. Concurrency bounds in-flight work rather than requests per minute, and immediate retries add load. Excluding retries from the shared budget can still exceed the cap. The bounded queue and urgent policy define what users may expect when demand exceeds capacity.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-surge-q3",
          "prompt": "Which test is needed beside raw throughput?",
          "options": [
            "A sustained burst with queue growth, priority, rate-limit handling and duplicate-notification checks.",
            "The peak arrival rate with retries disabled and no priority classes in the generated workload.",
            "The full priority mix with an unlimited dependency stub that never rate-limits requests.",
            "The real dependency limit at steady average traffic without the launch-sized burst."
          ],
          "correct": 0,
          "explanation": "The acceptance must combine the burst, bounded queue, priority, retries and duplicate-notification checks. Disabling retries and priority removes relevant load and scheduling behaviour. An unlimited stub bypasses the bottleneck. Average traffic does not establish burst behaviour.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-surge-q4",
          "prompt": "Sustained urgent work now requires more than 100 downstream requests per minute. What should you tell the sponsor?",
          "options": [
            "The current objective cannot cover all urgent work; choose a bounded fallback or change the promise.",
            "Every urgent job can retain its deadline if the queue is moved to a faster database.",
            "The cap can be ignored temporarily because urgent jobs have a higher business value.",
            "The objective still holds if unfinished urgent jobs are omitted from the report."
          ],
          "correct": 0,
          "explanation": "The constraint forces a visible product tradeoff. A faster queue cannot create downstream capacity. Business value does not remove a provider limit. Omitting unfinished jobs hides the objective’s failure.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-offline",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Two warehouses with intermittent connectivity",
      "summary": "Keep disconnected reservations honest about shared-stock authority.",
      "scenario": "A fictional inventory pilot spans two warehouses. Scanners can be offline for an hour. Each scan has a device-generated operation id; the same operation can upload again after reconnection. The central inventory service owns available-to-sell quantities. The customer asks both sites to promise stock immediately even while offline.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-offline-q1",
          "prompt": "Which question must precede an offline stock promise?",
          "options": [
            "Which offline actions are permitted and how conflicting reservations are reconciled centrally.",
            "Whether last-write-wins on device timestamps can settle conflicts while both sites make final promises.",
            "Whether each site can reserve against the full cached central quantity until its next reconnect.",
            "Whether duplicate-operation suppression alone can prevent two different reservations spending the same stock."
          ],
          "correct": 0,
          "explanation": "The permission and reconciliation contract comes first. Device timestamps cannot make mutually incompatible final promises valid. Letting both sites spend the full cached quantity can oversell. Deduplication protects one operation from replay, not distinct operations competing for stock.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-offline-q2",
          "prompt": "Which pilot preserves the central authority the scenario names?",
          "options": [
            "Queue uniquely identified scans locally and show reservations as provisional until confirmed.",
            "Let each scanner issue final stock promises from its last cached quantity.",
            "Overwrite central inventory with each device’s full snapshot on reconnection.",
            "Discard offline scans so reconnection never encounters duplicate operations."
          ],
          "correct": 0,
          "explanation": "Provisional state makes the lack of central confirmation visible while stable ids support replay. Final promises from stale caches can oversell. Snapshot overwrite can lose other work, and discarding scans loses actual operations.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-offline-q3",
          "prompt": "What must the replay acceptance cover?",
          "options": [
            "Repeated uploads of one operation and conflicting work from both sites in different arrival orders.",
            "Repeated uploads from one site with no overlapping stock or operations from the other site.",
            "Conflicting reservations from both sites delivered once each in their original order only.",
            "Equal final totals after reconnect without checking whether individual reservations were accepted twice."
          ],
          "correct": 0,
          "explanation": "Duplicates and cross-site conflicts must both be exercised under reordered delivery. A one-site replay omits conflict. One ordered delivery omits replay and reordering. Matching totals can conceal compensating duplicate effects, so inspect operation outcomes as well as inventory.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-offline-q4",
          "prompt": "The sponsor insists that every offline reservation be final. What should you do?",
          "options": [
            "Explain the conflict with shared central stock and negotiate a bounded per-site allocation or a provisional promise.",
            "Guarantee both final reservations because each device has a unique operation id.",
            "Accept the promise and reconcile any overselling without changing the written scope.",
            "Treat the last reconnected site as correct and erase reservations from the other site."
          ],
          "correct": 0,
          "explanation": "A bounded allocation can change the constraint; a provisional promise exposes it. Unique ids prevent duplicate operations but do not create stock. Quietly accepting or erasing conflicting reservations hides the tradeoff from the people who must own it.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    },
    {
      "id": "fde-v1-m02-cases-patterns",
      "kind": "check",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Turn repeated custom work into a product proposal",
      "summary": "Separate reusable mechanics from customer-specific boundaries.",
      "scenario": "A fictional delivery team has integrated three customers’ ticket exports. Each adapter repeats pagination, tenant-scoped configuration and field validation, while the customers use different status vocabularies and retention policies. Product has one planning slot next month. The sponsor wants to copy the most recent customer’s adapter for everyone.",
      "competencies": [
        "discovery"
      ],
      "estimatedMinutes": 15,
      "passThreshold": 0.8,
      "questions": [
        {
          "id": "fde-v1-m02-cases-patterns-q1",
          "prompt": "What evidence should the product proposal distinguish?",
          "options": [
            "Repeated technical behaviour, customer-specific rules and the cost or failure history of each.",
            "The newest customer’s terminology, presented as the common vocabulary for every account.",
            "The total line count of the newest adapter without its operational history.",
            "The number of features competitors advertise without checking these customer workflows."
          ],
          "correct": 0,
          "explanation": "Generalisation needs evidence about both the repeated behaviour and its variation. Recent terminology is not automatically common. Line count and competitor lists do not show which abstraction would help these integrations.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-patterns-q2",
          "prompt": "Which first reusable boundary fits the observed repetition?",
          "options": [
            "A tenant-scoped pagination and validation core with explicit status and retention adapters.",
            "One global status map and retention setting shared across every customer.",
            "A copy of the latest adapter with its customer identifiers replaced in comments.",
            "A generic platform that supports every possible connector before the next planning slot."
          ],
          "correct": 0,
          "explanation": "The common mechanics can be reused while domain rules remain explicit per customer. Global settings conflate distinct policies. Comment edits do not remove embedded assumptions. An unlimited platform exceeds the evidence and the immediate scope.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-patterns-q3",
          "prompt": "Which proposal can Product evaluate in the available planning slot?",
          "options": [
            "One bounded common component, evidence from three integrations and explicit adoption and support costs.",
            "A declaration that three deployments prove the component will fit every future customer.",
            "A long backlog of optional connector features without a proposed first user.",
            "A request to rewrite the product before estimating migration or maintenance effort."
          ],
          "correct": 0,
          "explanation": "A bounded component with users, evidence and cost supports a decision. Three integrations do not prove universal fit. An unprioritised feature list and an uncosted rewrite leave the decision undefined.",
          "competencies": [
            "discovery"
          ]
        },
        {
          "id": "fde-v1-m02-cases-patterns-q4",
          "prompt": "A fourth customer needs a different identity boundary. What should change?",
          "options": [
            "Test that boundary explicitly and revise or decline the reuse claim where it does not fit.",
            "Keep the adapter API unchanged and map the new roles to the nearest existing roles before testing isolation.",
            "Include the new identity model in the common core immediately, then estimate the impact on existing tenants.",
            "Build a separate connector and claim the common core fits all four customers based on the first three."
          ],
          "correct": 0,
          "explanation": "The new boundary needs explicit access cases before the reuse claim can extend. Nearest-role mapping may broaden permissions. Expanding the core before checking existing tenants assumes compatibility. A separate connector may be appropriate, but it cannot substantiate a claim that the common core covers that fourth identity model.",
          "competencies": [
            "discovery"
          ]
        }
      ]
    }
  ],
  "requires": [
    {
      "activityId": "fde-v1-m02-cases-l1-read",
      "state": "self_reviewed"
    },
    {
      "activityId": "fde-v1-m02-cases-l2-read",
      "state": "self_reviewed"
    }
  ],
  "requiresAtLeast": {
    "count": 9,
    "of": [
      "fde-v1-m02-cases-dashboard",
      "fde-v1-m02-cases-employee-sync",
      "fde-v1-m02-cases-deadline",
      "fde-v1-m02-cases-wrong-feature",
      "fde-v1-m02-cases-timeouts",
      "fde-v1-m02-cases-hosting",
      "fde-v1-m02-cases-invoices",
      "fde-v1-m02-cases-knowledge",
      "fde-v1-m02-cases-adoption",
      "fde-v1-m02-cases-surge",
      "fde-v1-m02-cases-offline",
      "fde-v1-m02-cases-patterns"
    ],
    "state": "verified_pass"
  },
  "estimatedMinutes": 220
};
