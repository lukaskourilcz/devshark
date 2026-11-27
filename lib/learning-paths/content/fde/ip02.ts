/** Original fictional debugging practice; no employer question or live service. */
import type { ModuleSource } from '../../types';
import { TENANT_QUOTES_STARTER } from './ip02-tenant-quotes';
import { ACTOR_PAGE_STARTER } from './ip02-actor-page';
import { TENANT_LEDGER_STARTER } from './ip02-tenant-ledger';
export const FDE_IP02: ModuleSource = {
  "id": "fde-v1-ip02",
  "title": "Interview practice: re-engineering round",
  "optional": true,
  "shelf": "interview-prep",
  "outcomes": [
    "Repair a reported defect by tracing its observable contract.",
    "Preserve authority, identity and atomic output when changing foreign code."
  ],
  "competencies": [
    "integration",
    "operations",
    "boundaries"
  ],
  "dependsOn": [],
  "estimatedMinutes": 180,
  "lessons": [
    {
      "id": "fde-v1-ip02-l1",
      "title": "Find a defect from its observable contract",
      "summary": "Reproduce the failure, reduce the input and trace the state/authority boundary.",
      "estimatedMinutes": 15,
      "sources": [
        {
          "label": "TypeScript handbook: narrowing",
          "url": "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "prose",
          "body": "Start with a reported observation and the intended contract. Reduce the example until you can say which input, state or authority boundary changes the result. Trace the entry point into helpers before replacing a large section. A type-correct program can still select another tenant’s state, misidentify a retry or report partial work as complete."
        },
        {
          "kind": "prose",
          "body": "These original fictional v2 services reuse some helpers from the learning round, so those parts may already be familiar. Their new entry points have different contracts and authored defects. You may compare versions, but copying an earlier starter does not implement the new entry point. No money, message or physical operation is performed."
        }
      ]
    },
    {
      "id": "fde-v1-ip02-l2",
      "title": "Keep the fix bounded",
      "summary": "Test the repaired behavior and a nearby counterexample without changing the contract to fit the code.",
      "estimatedMinutes": 15,
      "sources": [
        {
          "label": "TypeScript handbook: discriminated unions",
          "url": "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "table",
          "caption": "A repair that another engineer can review",
          "headers": [
            "Step",
            "Evidence"
          ],
          "rows": [
            [
              "Reproduce",
              "The smallest ordinary fixture that shows the reported wrong result."
            ],
            [
              "Locate",
              "The state, identity, validation or output decision responsible for it."
            ],
            [
              "Repair",
              "A change preserving the intended public API and all earlier valid behavior."
            ],
            [
              "Guard",
              "A counterexample for the fixed boundary and a nearby non-failing case."
            ]
          ]
        },
        {
          "kind": "prose",
          "body": "A whole-batch failure is different from a successful partial result. A stable operation identity is different from a bare row id. Authorization must remain outside untrusted payload decisions. Explain the difference in the repaired code. Suggested times are optional rehearsal guidance; the grade uses authored checks, and this shelf never counts toward guided completion."
        }
      ]
    }
  ],
  "activities": [
    {
      "id": "fde-v1-ip02-l1-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Read: find a defect from its observable contract",
      "summary": "Reproduce the failure, reduce the input and trace the state/authority boundary.",
      "competencies": [
        "integration",
        "operations",
        "boundaries"
      ],
      "estimatedMinutes": 15,
      "lessonId": "fde-v1-ip02-l1"
    },
    {
      "id": "fde-v1-ip02-l2-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Read: keep the fix bounded",
      "summary": "Test the repaired behavior and a nearby counterexample without changing the contract to fit the code.",
      "competencies": [
        "integration",
        "operations",
        "boundaries"
      ],
      "estimatedMinutes": 15,
      "lessonId": "fde-v1-ip02-l2"
    },
    {
      "id": "fde-v1-ip02-tenant-quotes",
      "kind": "code",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Repair tenant quote batching",
      "summary": "Diagnose cross-tenant selection, conflicting replay identity and partial-success reporting in a changed codebase.",
      "competencies": [
        "boundaries",
        "integration",
        "operations"
      ],
      "estimatedMinutes": 50,
      "fixtureNote": "This 457-line fictional v2 fixture has authored defects. Earlier pricing helpers may be familiar from the learning round; the tenant batch entry point and contract are different. Done means all three observed failures are repaired without changing earlier pricing behavior. Suggested rehearsal: 50 minutes; no timer runs.",
      "code": {
        "language": "typescript",
        "starter": TENANT_QUOTES_STARTER,
        "skeleton": TENANT_QUOTES_STARTER,
        "prompt": "Repair planTenantQuotes in this fictional v2 pricing service. Three reports are reproducible: a card from another tenant can influence a quote, a repeated request id with changed shipment data is silently ignored, and a batch containing an invalid request can still report successful quotes. Inspect the full call path before changing it; preserve the existing public functions.\n\nContract: process requests in input order. Before pricing a request, require request.tenantId equal to actorTenantId; otherwise append `request:<id>:wrong-tenant` and continue. Card lookup uses both the actor tenant and request.cardId. No match appends `request:<id>:unknown-card`; multiple matching cards append `request:<id>:ambiguous-card`. Other tenants’ same-named cards do not create ambiguity or supply a price.\n\nFor authorized requests, identity is requestId plus the exact values of cardId and shipment id, zone, weightGrams, declaredValueCents and flags in input order. The first occurrence claims that id even if pricing later fails. An exact repeated payload counts one duplicate and is not priced again. A changed payload under that id appends `request:<id>:conflict`. Identity comparison must use those field values rather than object property insertion order.\n\nCall the existing quote() for each unique authorized request with exactly one own-tenant card. Prefix each returned error with `request:<id>:`. Success plans exactly `{requestId,cardId,currency,total}`. Accumulate errors in request order. If any error exists, return only `{ok:false,errors}`: no partial quotes or duplicate count. Otherwise return `{ok:true,quotes,duplicates}`. No caller object or array may change, including frozen inputs. Empty requests succeed with empty output.\n\nDomain: valid typed request/card wrappers, ordinary data, nonempty actor/request/card ids, at most 100 requests/cards, and the existing bounded pricing fields. This preview performs no actual billing, external delivery or I/O.",
        "hints": [
          "Trace which tenant constrains card selection before quote() reads its amounts.",
          "An operation id identifies a payload; it does not make changed data an exact replay.",
          "Review the final return separately from the work accumulated in the loop. TypeScript narrowing reference: https://www.typescriptlang.org/docs/handbook/2/narrowing.html"
        ],
        "criteria": [
          {
            "id": "tenant-boundary",
            "label": "Keep card selection inside the actor tenant",
            "critical": true,
            "weight": 1,
            "detail": "Check request authority and own-tenant card lookup, including missing and ambiguous matches."
          },
          {
            "id": "request-identity",
            "label": "Distinguish exact replay from conflicting data",
            "critical": true,
            "weight": 1,
            "detail": "Check every stated payload field, first-occurrence identity and exact-repeat classification."
          },
          {
            "id": "all-or-nothing",
            "label": "Report no partial success after an error",
            "critical": true,
            "weight": 1,
            "detail": "Check ordered errors, rejected output shape and caller-input preservation."
          }
        ],
        "tests": [
          {
            "call": "__quotePlan([__quoteRequest()],[__tenantCard('TEN-NORTH',100)])",
            "expected": {
              "ok": true,
              "quotes": [
                {
                  "requestId": "REQ-1",
                  "cardId": "C-1",
                  "currency": "EUR",
                  "total": 100
                }
              ],
              "duplicates": 0
            },
            "criterion": "core",
            "label": "one authorized request keeps the existing price"
          },
          {
            "call": "__quotePlan([__quoteRequest()],[__tenantCard('TEN-SOUTH',900)])",
            "expected": {
              "ok": false,
              "errors": [
                "request:REQ-1:unknown-card"
              ]
            },
            "criterion": "tenant-boundary",
            "label": "a foreign card is not a fallback"
          },
          {
            "call": "__quotePlan([__quoteRequest()],[__tenantCard('TEN-SOUTH',900),__tenantCard('TEN-NORTH',100)])",
            "expected": {
              "ok": true,
              "quotes": [
                {
                  "requestId": "REQ-1",
                  "cardId": "C-1",
                  "currency": "EUR",
                  "total": 100
                }
              ],
              "duplicates": 0
            },
            "criterion": "tenant-boundary",
            "label": "same card ids in other tenants do not create ambiguity"
          },
          {
            "call": "__quotePlan([__quoteRequest(),__quoteRequest()],[__tenantCard('TEN-NORTH',100)])",
            "expected": {
              "ok": true,
              "quotes": [
                {
                  "requestId": "REQ-1",
                  "cardId": "C-1",
                  "currency": "EUR",
                  "total": 100
                }
              ],
              "duplicates": 1
            },
            "criterion": "request-identity",
            "label": "an exact retry is counted once"
          },
          {
            "call": "__quotePlan([__quoteRequest(),__quoteRequest({shipment:{id:'S-1',zone:'national',weightGrams:1000,declaredValueCents:0,flags:[]}})],[__tenantCard('TEN-NORTH',100)])",
            "expected": {
              "ok": false,
              "errors": [
                "request:REQ-1:conflict"
              ]
            },
            "criterion": "request-identity",
            "label": "changed shipment data conflicts under the same id"
          },
          {
            "call": "__quotePlan([__quoteRequest(),__quoteRequest({requestId:'REQ-2',cardId:'missing'})],[__tenantCard('TEN-NORTH',100)])",
            "expected": {
              "ok": false,
              "errors": [
                "request:REQ-2:unknown-card"
              ]
            },
            "criterion": "all-or-nothing",
            "label": "later failure rejects earlier planned quotes"
          }
        ],
        "contract": [
          "Keep the signature `planTenantQuotes(actorTenantId, requests, cards)` and the existing `quote()`. The harness calls `planTenantQuotes` with the actor `TEN-NORTH`, so a renamed entry point fails every case.",
          "`__tenantCard`, `__quoteRequest` and `__quotePlan` come from the task harness and are appended after your code. Read from them; do not define names that start with `__`.",
          "Error strings and the success shape are compared exactly. Inputs may be frozen: never mutate a request, card or array."
        ],
        "harness": "var __tenantCard = function (tenant, amount, id) { return {tenantId:tenant,card:{id:id||'C-1',carrier:'Fixture',currency:'EUR',version:1,discountBasisPoints:0,rules:[{kind:'flat',id:'flat',label:'Base',amount:amount}]}}; };\nvar __quoteRequest = function (patch) { return Object.assign({requestId:'REQ-1',tenantId:'TEN-NORTH',cardId:'C-1',shipment:{id:'S-1',zone:'local',weightGrams:1000,declaredValueCents:0,flags:[]}},patch||{}); };\nvar __quotePlan = function (requests,cards) { return planTenantQuotes('TEN-NORTH',requests,cards); };"
      }
    },
    {
      "id": "fde-v1-ip02-actor-page",
      "kind": "code",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Repair actor-scoped event paging",
      "summary": "Keep caller authority, page consumption and persisted replay state consistent.",
      "competencies": [
        "boundaries",
        "integration",
        "operations"
      ],
      "estimatedMinutes": 50,
      "fixtureNote": "This 345-line fictional v2 service contains authored defects. Earlier helpers may be familiar; the new entry-point contract is different. Suggested rehearsal: 50 minutes; no timer runs.",
      "code": {
        "language": "typescript",
        "starter": ACTOR_PAGE_STARTER,
        "skeleton": ACTOR_PAGE_STARTER,
        "prompt": "Repair planActorPage. Reports say an actor can consume another tenant’s event, one page consumes more owned events than requested, and previously seen events can be delivered again. Preserve all existing readers, selectors and planEvents behavior.\n\nThe eventLimit must be an integer from 1 through 50 inclusive; otherwise return {ok:false,errors:['event-limit:1-to-50']}. First select only events whose tenantId equals actorTenantId, keeping their input order. Take the first eventLimit of these owned events BEFORE replay classification or subscription selection. Feed that page and the unchanged subscriptions/previousSeen into planEvents. Return {ok:true,remaining,...plan}, where remaining is the number of owned events outside that page. An unmatched or already-seen event still consumes one page slot; other tenants consume none. Keep the existing Plan fields and ordering, including previousSeen entries and newly consumed event keys. Do not mutate inputs or send anything.\n\nDomain: valid typed events/subscriptions, nonempty actor tenant, up to 100 events/subscriptions, and valid persisted eventKey strings. No timestamps, cursor database or external deliveries are involved.",
        "hints": [
          "Separate the actor-owned input sequence from subscription selection.",
          "A replay or unmatched event still occupies a slot; remaining counts owned events outside that page.",
          "Trace which persisted identities enter and leave planEvents. TypeScript narrowing reference: https://www.typescriptlang.org/docs/handbook/2/narrowing.html"
        ],
        "criteria": [
          {
            "id": "tenant-boundary",
            "label": "Consume only actor-owned events",
            "critical": true,
            "weight": 1,
            "detail": "Check that foreign events consume neither a page slot nor a seen identity."
          },
          {
            "id": "page-boundary",
            "label": "Apply the limit before routing and replay checks",
            "critical": true,
            "weight": 1,
            "detail": "Check valid size bounds and page consumption before routing or replay classification."
          },
          {
            "id": "replay-state",
            "label": "Preserve and honor persisted replay identities",
            "critical": true,
            "weight": 1,
            "detail": "Check that previous seen keys survive and suppress repeated delivery."
          }
        ],
        "tests": [
          {
            "call": "__view(__page([__ev()],[__sub()]))",
            "expected": {
              "ok": true,
              "remaining": 0,
              "events": [
                "E1"
              ],
              "duplicates": 0,
              "unmatched": [],
              "seen": [
                "[\"TEN-NORTH\",\"E1\"]"
              ]
            },
            "criterion": "core",
            "label": "one owned event keeps the existing plan"
          },
          {
            "call": "__page([__ev()],[__sub()],[],0)",
            "expected": {
              "ok": false,
              "errors": [
                "event-limit:1-to-50"
              ]
            },
            "criterion": "page-boundary",
            "label": "invalid page size refuses"
          },
          {
            "call": "__view(__page([__ev(\"foreign\",\"TEN-SOUTH\"),__ev()],[__sub(),__sub(\"TEN-SOUTH\")]))",
            "expected": {
              "ok": true,
              "remaining": 0,
              "events": [
                "E1"
              ],
              "duplicates": 0,
              "unmatched": [],
              "seen": [
                "[\"TEN-NORTH\",\"E1\"]"
              ]
            },
            "criterion": "tenant-boundary",
            "label": "foreign events do not consume a page slot"
          },
          {
            "call": "__view(__page([__ev(\"E1\"),__ev(\"E2\")],[__sub()]))",
            "expected": {
              "ok": true,
              "remaining": 1,
              "events": [
                "E1"
              ],
              "duplicates": 0,
              "unmatched": [],
              "seen": [
                "[\"TEN-NORTH\",\"E1\"]"
              ]
            },
            "criterion": "page-boundary",
            "label": "only the first owned event is consumed"
          },
          {
            "call": "__page([__ev()],[__sub()],[eventKey(__ev())],1).duplicates",
            "expected": 1,
            "criterion": "replay-state",
            "label": "persisted seen identity prevents a fresh delivery"
          }
        ],
        "contract": [
          "Keep the signature `planActorPage(actorTenantId, events, subscriptions, previousSeen, eventLimit)`, the existing `planEvents` and `eventKey`. The harness calls them, so a renamed entry point fails every case.",
          "`__ev`, `__sub`, `__page` and `__view` come from the task harness and are appended after your code. Read from them; do not define names that start with `__`.",
          "The returned plan keeps the existing field names; the tests read `deliveries`, `duplicates`, `unmatched`, `nextSeen` and `remaining`. Inputs may be frozen: never mutate them."
        ],
        "harness": "var __ev=function(id,tenant,tags){return {id:id||'E1',tenantId:tenant||'TEN-NORTH',kind:'ticket.opened',severity:'info',tags:tags||[],subject:'A ticket'};};\nvar __sub=function(tenant,selector){return {id:'S1',tenantId:tenant||'TEN-NORTH',enabled:true,channel:'audit',destination:'local',selector:selector||{kind:'all'}};};\nvar __page=function(events,subscriptions,seen,limit){return planActorPage('TEN-NORTH',events,subscriptions,seen||[],limit===undefined?1:limit);};\nvar __view=function(p){return p.ok?{ok:true,remaining:p.remaining,events:p.deliveries.map(function(d){return d.eventId;}),duplicates:p.duplicates,unmatched:p.unmatched,seen:p.nextSeen}:p;};"
      }
    },
    {
      "id": "fde-v1-ip02-tenant-ledger",
      "kind": "code",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Repair tenant ledger previews",
      "summary": "Trace authority, dry-run output and optimistic revision identity through a changed service.",
      "competencies": [
        "boundaries",
        "integration",
        "operations"
      ],
      "estimatedMinutes": 50,
      "fixtureNote": "This 322-line fictional v2 service contains authored defects. Earlier helpers may be familiar; the new entry-point contract is different. Suggested rehearsal: 50 minutes; no timer runs.",
      "code": {
        "language": "typescript",
        "starter": TENANT_LEDGER_STARTER,
        "skeleton": TENANT_LEDGER_STARTER,
        "prompt": "Repair applyTenantCsv and the revision branch it calls. Reports say a caller can submit another tenant’s command, preview mode returns records as if changes were committed, and equal-revision changed payloads are silently classified as stale. Preserve earlier CSV parsing, application errors, output ordering and atomic batch behavior.\n\nParse the entire CSV first; return its parser errors unchanged if malformed. Before applying any row, refuse EVERY row whose command.tenantId differs from actorTenantId with {ok:false,errors:[{row:<CSV row>,code:'tenant:forbidden'}, ...]}, in row order. The snapshot may contain records from other tenants; preserve those records unchanged. Invoke applyCsv only after authorization succeeds. If it rejects, return that rejection without partial records. On success, commit mode returns its staged records. Preview mode instead returns copies of the original snapshot in original order, while counts and changes describe the hypothetical application. Both modes leave caller inputs unchanged; neither writes to any store.\n\nWithin applyCsv, lower revision means stale, exact equal-revision fingerprint means duplicate, and equal revision with a different fingerprint means revision:conflict. These rules apply in both modes. Domain: the existing valid snapshot and bounded CSV grammar, nonempty actor tenant, mode 'preview' or 'commit'. The helpers intentionally support create/move/retire only; no rename extension is required.",
        "hints": [
          "Parse the whole file before checking authority, then refuse every unauthorized row before staging.",
          "Compare the records returned by preview with its hypothetical counts and changes.",
          "Separate lower revisions, identical equal revisions and conflicting equal revisions. TypeScript narrowing reference: https://www.typescriptlang.org/docs/handbook/2/narrowing.html"
        ],
        "criteria": [
          {
            "id": "tenant-boundary",
            "label": "Authorize every command before application",
            "critical": true,
            "weight": 1,
            "detail": "Check every parsed command against actor authority while preserving unrelated snapshot records."
          },
          {
            "id": "preview-output",
            "label": "Keep hypothetical changes out of returned preview records",
            "critical": true,
            "weight": 1,
            "detail": "Check original preview records, hypothetical evidence and atomic refusal on application failure."
          },
          {
            "id": "revision-identity",
            "label": "Separate stale, exact duplicate and conflicting revisions",
            "critical": true,
            "weight": 1,
            "detail": "Check strict revision ordering and command identity in both preview and commit."
          }
        ],
        "tests": [
          {
            "call": "__ledger([\"TEN-NORTH,A1,1,create,R1,Monitor\"]).counts.applied",
            "expected": 1,
            "criterion": "core",
            "label": "authorized create retains existing behavior"
          },
          {
            "call": "__ledger([\"TEN-SOUTH,A1,1,create,R1,Monitor\"])",
            "expected": {
              "ok": false,
              "errors": [
                {
                  "row": 2,
                  "code": "tenant:forbidden"
                }
              ]
            },
            "criterion": "tenant-boundary",
            "label": "foreign command refuses before application"
          },
          {
            "call": "__ledger([\"TEN-NORTH,A1,1,create,R1,Monitor\"],\"preview\").records",
            "expected": [],
            "criterion": "preview-output",
            "label": "preview returns the original empty snapshot"
          },
          {
            "call": "(() => {var a=__ledger([\"TEN-NORTH,A1,1,create,R1,Monitor\"]);return __ledger([\"TEN-NORTH,A1,1,move,R2,\"],\"commit\",a.records);})()",
            "expected": {
              "ok": false,
              "errors": [
                {
                  "row": 2,
                  "code": "revision:conflict"
                }
              ]
            },
            "criterion": "revision-identity",
            "label": "changed equal revision refuses"
          },
          {
            "call": "(() => {var a=__ledger([\"TEN-NORTH,A1,1,create,R1,Monitor\"]);return __ledger([\"TEN-NORTH,A1,1,create,R1,Monitor\"],\"commit\",a.records).counts;})()",
            "expected": {
              "applied": 0,
              "stale": 0,
              "duplicate": 1
            },
            "criterion": "revision-identity",
            "label": "exact equal revision is duplicate"
          }
        ],
        "contract": [
          "Keep the signature `applyTenantCsv(actorTenantId, snapshot, csv, mode)` and the existing `applyCsv`. The harness calls `applyTenantCsv` with the actor `TEN-NORTH`, so a renamed entry point fails every case.",
          "`__csv`, `__ledger` and `__record` come from the task harness and are appended after your code. Read from them; do not define names that start with `__`.",
          "Error objects, records and counts are compared exactly. Snapshots may be frozen: never mutate a record or array you were handed."
        ],
        "harness": "var __csv=function(rows){return 'tenant_id,item_id,revision,kind,location,label\\n'+rows.join('\\n');};\nvar __ledger=function(rows,mode,snapshot){return applyTenantCsv('TEN-NORTH',snapshot||[],__csv(rows),mode||'commit');};\nvar __record=function(){return {tenantId:'TEN-NORTH',itemId:'A1',revision:1,location:'R1',label:'Monitor',status:'active',lastChange:'[\"create\",\"TEN-NORTH\",\"A1\",1,\"R1\",\"Monitor\"]'};};"
      }
    }
  ],
  "requires": []
};
