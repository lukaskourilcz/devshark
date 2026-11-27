/** Original synthetic learning-round fixtures; timings are suggestions only. */
import type { ModuleSource } from '../../types';
import { LEDGER_FIXTURE } from './ip01-asset-ledger';
import { ROUTER_FIXTURE } from './ip01-policy-router';
import { RATE_CARD_FIXTURE } from './ip01-rate-card';
export const FDE_IP01: ModuleSource = {
  "id": "fde-v1-ip01",
  "title": "Interview practice: learning round",
  "optional": true,
  "shelf": "interview-prep",
  "outcomes": [
    "Extend an unfamiliar typed codebase while preserving its existing contract.",
    "Explain the path from incoming shape through validation to observable behavior."
  ],
  "competencies": [
    "integration",
    "operations",
    "boundaries",
    "data-plumbing"
  ],
  "dependsOn": [],
  "estimatedMinutes": 210,
  "lessons": [
    {
      "id": "fde-v1-ip01-l1",
      "title": "Map an unfamiliar code path",
      "summary": "Find entry points, data ownership, variants and the tests before extending a service.",
      "estimatedMinutes": 15,
      "sources": [
        {
          "label": "TypeScript handbook: narrowing and exhaustiveness",
          "url": "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "prose",
          "body": "Read the public entry point and trace one input to its output. Mark where shape parsing ends, value validation begins and state changes happen. A new variant often needs more than a new calculation: the parser, union, exhaustive branches, human description and downstream summary must agree. Preserve existing behavior while changing the smallest coherent boundary."
        },
        {
          "kind": "prose",
          "body": "Use the supplied visible checks to understand the contract, then write a counterexample for a boundary or invalid input. Inspect the failing observation before changing code. TypeScript narrowing can keep discriminated variants coherent, but a type annotation does not validate an incoming JSON payload. The authored fixtures use no live service or real customer data."
        }
      ]
    },
    {
      "id": "fde-v1-ip01-l2",
      "title": "Prove the extension without a speed claim",
      "summary": "Check boundaries, regressions and the limits of a bounded practice grade.",
      "estimatedMinutes": 15,
      "sources": [
        {
          "label": "TypeScript handbook: discriminated unions and never",
          "url": "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
          "reviewedOn": "2026-10-22"
        }
      ],
      "sections": [
        {
          "kind": "table",
          "caption": "A small extension review",
          "headers": [
            "Check",
            "What to inspect"
          ],
          "rows": [
            [
              "New variant",
              "Shape, ranges, optional/missing fields, all branches and its downstream output."
            ],
            [
              "Boundary behavior",
              "Just below, at and above each threshold; zero versus absence; tenant or zone scopes."
            ],
            [
              "Earlier behavior",
              "At least one earlier variant and its rounding/order/error policy."
            ],
            [
              "Ownership",
              "Frozen caller inputs remain unchanged; only declared output/state may change."
            ]
          ]
        },
        {
          "kind": "prose",
          "body": "Suggested rehearsal times are copy only. You can read and retry without a server countdown. Passing proves the bounded authored checks on this fixture; it does not prove a live service is safe, that an employer would accept the solution or that you worked within a measured interview time. These optional drills do not count toward guided path completion."
        }
      ]
    }
  ],
  "activities": [
    {
      "id": "fde-v1-ip01-l1-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Read: map an unfamiliar code path",
      "summary": "Find entry points, data ownership, variants and the tests before extending a service.",
      "competencies": [
        "integration",
        "operations"
      ],
      "estimatedMinutes": 15,
      "lessonId": "fde-v1-ip01-l1"
    },
    {
      "id": "fde-v1-ip01-l2-read",
      "kind": "lesson",
      "purpose": "exercise",
      "verification": "self_reviewed",
      "title": "Read: prove the extension without a speed claim",
      "summary": "Check boundaries, regressions and the limits of a bounded practice grade.",
      "competencies": [
        "integration",
        "operations"
      ],
      "estimatedMinutes": 15,
      "lessonId": "fde-v1-ip01-l2"
    },
    {
      "id": "fde-v1-ip01-rate-card",
      "kind": "code",
      "purpose": "exercise",
      "verification": "machine_verified",
      "title": "Extend the freight rate-card engine",
      "summary": "Add a weight-band rule across a complete TypeScript parser, validator, price calculator and description.",
      "competencies": [
        "integration",
        "operations"
      ],
      "estimatedMinutes": 60,
      "fixtureNote": "Deliberately unfamiliar TypeScript: 401 lines from an invented freight-pricing service. Read its existing call path before extending it. Done means the new rule parses, validates, prices, describes and discounts correctly while earlier rules still work. Suggested rehearsal: 60 minutes; no timer or speed grade runs.",
      "code": {
        "language": "typescript",
        "starter": RATE_CARD_FIXTURE,
        "skeleton": RATE_CARD_FIXTURE,
        "prompt": "Extend the supplied fictional rate-card engine with a new Rule member `WeightBandRule`: kind `weightBand`, id, label, `baseAmount` (whole nonnegative cents), `includedGrams` (positive whole grams), `centsPerExtraKg` (whole nonnegative cents), and optional `zones: ZoneId[]`.\n\nUpdate the Rule union, DISCOUNTABLE, priceRule, describeRule, ruleProblems and readRule together. Do not replace the established public functions or rename their fields. A weight-band rule is discountable. For an applicable zone, charge `baseAmount + ceil(max(0, weightGrams - includedGrams) / 1000) * centsPerExtraKg`. One extra gram starts another kilogram. An excluded zone returns no line; a zero charge that applies still produces a line.\n\nreadRule must read only the named fields with the existing shape policy. ruleProblems must refuse a non-safe-integer/negative baseAmount or centsPerExtraKg, a non-safe-integer/zero/negative includedGrams, and an explicitly empty zones list. Keep the existing error accumulation and ordering; use `baseAmount must be whole cents`, `includedGrams must be positive whole grams`, `centsPerExtraKg must be whole cents` and `zones must not be empty`, each after the existing `rule <id>: ` prefix. Missing/wrong JSON types use the existing shape helper errors before value validation. New parser fields must retain their exact supplied numeric values.\n\nThe description is exactly `<label>: <baseAmount>c includes <includedGrams>g, then <centsPerExtraKg>c per extra started kg` plus the existing zoneSuffix. Card discount applies to the weight-band amount using the existing basis-point rounding. Keep every previous rule’s behavior and leave caller inputs unchanged.\n\nDomain: ordinary JSON-shaped inputs (possibly frozen); card/shipment fields other than the new rule obey the existing declared types. Valid amounts/weights in the exercise are at most 1,000,000, there are at most 50 rules, and invalid new-rule fields include NaN/infinity, fractional, missing and wrong-type values. No I/O, real shipment, price quote or network runs. This is a bounded reading/extension exercise, not a production billing engine.",
        "hints": [
          "Trace cardFromJson → readRule → validateCard → priceRule before changing the union.",
          "An optional zones list differs from an explicitly empty list; preserve that distinction.",
          "Apply the discount to the new rule’s base-plus-extra charge using the existing rounding. Review the union branches: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking"
        ],
        "criteria": [
          {
            "id": "schema",
            "label": "Parse and validate every new field",
            "critical": true,
            "weight": 1
          },
          {
            "id": "band-pricing",
            "label": "Price applicable weight bands and discounts",
            "critical": true,
            "weight": 1
          },
          {
            "id": "description",
            "label": "Describe the new rule without losing its zone scope",
            "critical": true,
            "weight": 1
          },
          {
            "id": "regression",
            "label": "Preserve earlier rules and caller inputs",
            "critical": true,
            "weight": 1
          }
        ],
        "tests": [
          {
            "call": "__bandTotals(2000)",
            "expected": {
              "subtotal": 500,
              "discount": 0,
              "total": 500,
              "lines": 1
            },
            "criterion": "core",
            "label": "included weight pays only the base"
          },
          {
            "call": "__bandTotals(2001)",
            "expected": {
              "subtotal": 580,
              "discount": 0,
              "total": 580,
              "lines": 1
            },
            "criterion": "band-pricing",
            "label": "one extra gram starts an extra kilogram"
          },
          {
            "call": "__bandTotals(4000, {}, 1000)",
            "expected": {
              "subtotal": 660,
              "discount": 66,
              "total": 594,
              "lines": 1
            },
            "criterion": "band-pricing",
            "label": "the complete weight-band charge is discountable"
          },
          {
            "call": "__bandTotals(2001, { zones: ['local'] }, 0, 'national')",
            "expected": {
              "subtotal": 0,
              "discount": 0,
              "total": 0,
              "lines": 0
            },
            "criterion": "band-pricing",
            "label": "an excluded zone adds no line"
          },
          {
            "call": "__bandCard({ includedGrams: 0 }).ok && validateCard(__bandCard({ includedGrams: 0 }).card)",
            "expected": [
              "rule band: includedGrams must be positive whole grams"
            ],
            "criterion": "schema",
            "label": "zero included grams is not valid"
          },
          {
            "call": "__bandCard({ includedGrams: 75, baseAmount: 100, centsPerExtraKg: 23 }).card.rules[0]",
            "expected": {
              "kind": "weightBand",
              "id": "band",
              "label": "Band",
              "baseAmount": 100,
              "includedGrams": 75,
              "centsPerExtraKg": 23
            },
            "criterion": "schema",
            "label": "JSON fields keep their identity and values"
          },
          {
            "call": "describeRule(__bandCard({ zones: ['local'] }).card.rules[0])",
            "expected": "Band: 500c includes 2000g, then 80c per extra started kg (local)",
            "criterion": "description",
            "label": "the operator sees the band and its zone"
          },
          {
            "call": "priceRule({ kind: 'perKg', id: 'old', label: 'Old', centsPerKg: 25 }, { ...SAMPLE_SHIPMENT, weightGrams: 1 })",
            "expected": 25,
            "criterion": "regression",
            "label": "an earlier per-kilogram rule keeps started-unit rounding"
          }
        ],
        "contract": [
          "Keep the existing names `cardFromJson`, `validateCard`, `quote`, `priceRule` and `describeRule`. The tests call them directly and through the harness, so a renamed or replaced function fails every case that uses it.",
          "`__bandRaw`, `__bandCard`, `__bandQuote` and `__bandTotals` come from the task harness and are appended after your code. Read from them; do not define names that start with `__`.",
          "Error strings, line counts and the description text are compared exactly. Inputs may be frozen: never mutate a card, rule or shipment."
        ],
        "harness": "var __bandRaw = function (patch) {\n  return Object.assign({ kind: 'weightBand', id: 'band', label: 'Band', baseAmount: 500, includedGrams: 2000, centsPerExtraKg: 80 }, patch || {});\n};\nvar __bandCard = function (patch, discount) {\n  var loaded = cardFromJson({ id: 'CARD-TEST', carrier: 'Harrowgate', currency: 'EUR', version: 1, discountBasisPoints: discount || 0, rules: [__bandRaw(patch)] });\n  return loaded;\n};\nvar __bandQuote = function (weight, patch, discount, zone) {\n  var loaded = __bandCard(patch, discount);\n  if (!loaded.ok) return loaded;\n  return quote({ id: 'S-TEST', zone: zone || 'regional', weightGrams: weight, declaredValueCents: 10000, flags: [] }, loaded.card);\n};\nvar __bandTotals = function (weight, patch, discount, zone) {\n  var result = __bandQuote(weight, patch, discount, zone);\n  return result.ok ? { subtotal: result.quote.subtotal, discount: result.quote.discount, total: result.quote.total, lines: result.quote.lines.length } : result;\n};"
      }
    },
    {
  "id": "fde-v1-ip01-policy-router",
  "kind": "code",
  "purpose": "exercise",
  "verification": "machine_verified",
  "title": "Extend the event subscription selector",
  "summary": "Add an all-tags selector through parsing, matching and operator descriptions without widening tenant authority.",
  "competencies": [
    "integration",
    "boundaries"
  ],
  "estimatedMinutes": 60,
  "fixtureNote": "Deliberately unfamiliar TypeScript: 332 lines from a fictional delivery planner. It sends nothing. Done means an all-tags selector parses and matches correctly, its description is visible, and tenant/replay boundaries and earlier selectors remain intact. Suggested rehearsal: 60 minutes; no timer or speed grade runs.",
  "code": {
    "language": "typescript",
    "starter": ROUTER_FIXTURE,
    "skeleton": ROUTER_FIXTURE,
    "prompt": "Extend `Selector` with `{ kind: 'allTags'; values: string[] }` in the supplied fictional planner. Add it to parseSelector, selectorMatches and selectorDescription. Keep the existing public function names and all earlier selector behavior.\n\nparseSelector accepts raw `values` only as an array of 1 to 8 entries. Check array shape and raw count first: errors are `<at>.values: must be a list` or `<at>.values: must have 1 to 8 tags` using the existing ParseError shape. Then use the existing readTags rules: every entry is nonempty text, trimmed, case-sensitive and unique after trimming. Retain its per-entry errors and order. Return only `{kind:'allTags', values: normalizedValues}`. Do not modify the input.\n\nAn allTags selector matches only when every configured tag occurs in the event’s tags. One matching tag is insufficient. Its description is exactly `all tags: ` followed by the configured values joined with comma-space, in configuration order. Valid typed selectors have passed parsing.\n\nThe existing planner still checks enabled status and exact tenant identity before matching. Replay identity remains tenant plus event id, and output order remains event order then subscription order. Every earlier selector and summary keeps its behavior. Leave caller events, subscriptions, arrays and previousSeen unchanged, including frozen inputs.\n\nDomain: ordinary JSON-shaped parser input and valid typed planner inputs, at most 100 events, 50 subscriptions and 16 tags per event. No delivery, customer data or network runs. These bounded checks do not establish a production notification system’s safety.",
    "hints": [
      "Trace previewJson into parseSubscription and parseSelector before editing the matching switch.",
      "Validate count before readTags, then preserve its trimmed duplicate handling.",
      "A selector is not authorization; keep the existing tenant and replay checks around it. Review discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions"
    ],
    "criteria": [
      {
        "id": "parsing",
        "label": "Validate and normalize the selector",
        "critical": true,
        "weight": 1
      },
      {
        "id": "selection",
        "label": "Require every configured tag",
        "critical": true,
        "weight": 1
      },
      {
        "id": "tenant-replay",
        "label": "Preserve tenant and replay boundaries",
        "critical": true,
        "weight": 1
      },
      {
        "id": "description",
        "label": "Describe the complete selector",
        "critical": true,
        "weight": 1
      }
    ],
    "tests": [
      {
        "call": "__route(['customer','priority'],['priority','customer'])",
        "expected": [
          "SUB-4"
        ],
        "criterion": "core",
        "label": "tag order in the event does not matter"
      },
      {
        "call": "__route(['customer','priority'],['customer'])",
        "expected": [],
        "criterion": "selection",
        "label": "one matching tag is insufficient"
      },
      {
        "call": "__route(['customer'],['Customer'])",
        "expected": [],
        "criterion": "selection",
        "label": "tag matching remains case-sensitive"
      },
      {
        "call": "parseSelector({kind:'allTags',values:[' customer ','priority']})",
        "expected": {
          "ok": true,
          "value": {
            "kind": "allTags",
            "values": [
              "customer",
              "priority"
            ]
          }
        },
        "criterion": "parsing",
        "label": "configuration values normalize once"
      },
      {
        "call": "parseSelector({kind:'allTags',values:['customer',' customer ']}).errors",
        "expected": [
          {
            "at": "selector.values[1]",
            "message": "duplicate tag"
          }
        ],
        "criterion": "parsing",
        "label": "duplicate identity is checked after trimming"
      },
      {
        "call": "__route(['customer'],['customer'],{tenantId:'TEN-SOUTH'})",
        "expected": [],
        "criterion": "tenant-replay",
        "label": "a matching selector cannot widen the tenant"
      },
      {
        "call": "selectorDescription({kind:'allTags',values:['customer','priority']})",
        "expected": "all tags: customer, priority",
        "criterion": "description",
        "label": "the operator sees every configured tag"
      },
      {
        "call": "planEvents([__event(),__event()],[__subscription({kind:'all'})],[]).duplicates",
        "expected": 1,
        "criterion": "tenant-replay",
        "label": "a replay is not delivered twice"
      }
    ],
    "contract": [
      "Keep the existing names `parseSelector`, `selectorMatches`, `selectorDescription`, `planEvents`, `SAMPLE_EVENT` and `SAMPLE_SUBSCRIPTION`. The tests and the harness call them, so a renamed or replaced one fails every case that uses it.",
      "`__event`, `__subscription` and `__route` come from the task harness and are appended after your code. Read from them; do not define names that start with `__`.",
      "Parse errors and descriptions are compared exactly. Inputs may be frozen: never mutate an event, subscription or previousSeen list."
    ],
    "harness": "var __event = function (patch) { return Object.assign({}, SAMPLE_EVENT, {tags: SAMPLE_EVENT.tags.slice()}, patch || {}); };\nvar __subscription = function (selector, patch) { return Object.assign({}, SAMPLE_SUBSCRIPTION, {selector: selector}, patch || {}); };\nvar __route = function (values, tags, patch) {\n  var parsed = parseSelector({kind:'allTags', values:values});\n  if (!parsed.ok) return { errors:parsed.errors };\n  var plan = planEvents([__event({tags:tags})],[__subscription(parsed.value,patch)],[]);\n  return plan.deliveries.map(function (delivery) { return delivery.subscriptionId; });\n};"
  }
},
    {
  "id": "fde-v1-ip01-asset-ledger",
  "kind": "code",
  "purpose": "exercise",
  "verification": "machine_verified",
  "title": "Extend the asset-change ledger",
  "summary": "Add a rename command through CSV parsing, identity, staged application and human audit output.",
  "competencies": [
    "integration",
    "data-plumbing",
    "boundaries"
  ],
  "estimatedMinutes": 60,
  "fixtureNote": "Deliberately unfamiliar TypeScript: 308 lines from an invented asset ledger. Done means rename changes only the named tenant/item label, preserves revision/replay rules and leaves the whole input snapshot untouched on failure. Suggested rehearsal: 60 minutes; no timer or speed grade runs.",
  "code": {
    "language": "typescript",
    "starter": LEDGER_FIXTURE,
    "skeleton": LEDGER_FIXTURE,
    "prompt": "Extend the fictional asset ledger with `RenameCommand extends CommandBase`, carrying kind `rename` and label. Add it to Command and every applicable switch: parseCommand, changeKey, describeCommand and applyCommand. Keep all public names and earlier behavior.\n\nThe CSV header/dialect stays unchanged. A rename row is `tenant_id,item_id,revision,rename,,label`: location must be empty, and label must pass the existing token rule after trimming. Report location before label when both are invalid, using `location:must-be-empty` and `label:invalid` with the original row number. Common tenant/item/revision errors keep their existing precedence.\n\nFor a newer valid rename, the named asset must exist and be active. Otherwise return `rename:not-found` or `rename:retired`. Return a fresh record with the new revision, label and lastChange, preserving tenantId, itemId, location and status. The change fingerprint is exactly JSON.stringify of `[kind,tenantId,itemId,revision,label]`; the human description is `<tenantId>/<itemId>: rename to <label>`.\n\nPreserve applyCsv’s existing version policy before application: older revisions are stale; equal revision and equal normalized command is a duplicate; equal revision with different content rejects the whole batch as `revision:conflict`. A rename never creates, moves, revives or crosses tenants. The entire batch stages atomically: any parse/application error returns errors without a partially applied result, and caller snapshots are never changed, including frozen records/arrays. Existing create/move/retire, exports, row order and counts remain as supplied.\n\nDomain: ordinary strings in the stated six-unquoted-field CSV dialect, typed valid snapshots (possibly frozen), at most 100 change rows and 500 snapshot records. Label length is at most 100 after trimming; commas/newlines are not valid field data. This exercise does no I/O or actual asset operation.",
    "hints": [
      "Follow the existing move command through the union, parser, fingerprint and application. Rename changes a different field.",
      "Fingerprint the normalized label so an exact retry differs from a conflicting same-revision change.",
      "Do not move the version checks out of applyCsv or mutate its caller snapshot. Review discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions"
    ],
    "criteria": [
      {
        "id": "parsing",
        "label": "Read the rename row and its validation errors",
        "critical": true,
        "weight": 1
      },
      {
        "id": "replay",
        "label": "Preserve revision and replay identity",
        "critical": true,
        "weight": 1
      },
      {
        "id": "tenant-state",
        "label": "Preserve tenant, location and retirement boundaries",
        "critical": true,
        "weight": 1
      },
      {
        "id": "atomic",
        "label": "Keep errors atomic and inputs unchanged",
        "critical": true,
        "weight": 1
      },
      {
        "id": "audit",
        "label": "Describe the applied rename",
        "critical": true,
        "weight": 1
      }
    ],
    "tests": [
      {
        "call": "__assetView(__rename('New label'))",
        "expected": {
          "records": [
            [
              "TEN-WEST",
              "EQ-8",
              2,
              "Depot-A",
              "New label",
              "active"
            ]
          ],
          "counts": {
            "applied": 1,
            "stale": 0,
            "duplicate": 0
          },
          "changes": [
            "TEN-WEST/EQ-8: rename to New label"
          ]
        },
        "criterion": "core",
        "label": "rename keeps the location and status"
      },
      {
        "call": "parseCommand(['TEN-WEST','EQ-8','2','rename','','  New label  '],7)",
        "expected": {
          "ok": true,
          "value": {
            "tenantId": "TEN-WEST",
            "itemId": "EQ-8",
            "revision": 2,
            "kind": "rename",
            "label": "New label"
          }
        },
        "criterion": "parsing",
        "label": "normalization happens before the command is stored"
      },
      {
        "call": "parseCommand(['TEN-WEST','EQ-8','2','rename','Other depot',''],7)",
        "expected": {
          "ok": false,
          "errors": [
            {
              "row": 7,
              "code": "location:must-be-empty"
            },
            {
              "row": 7,
              "code": "label:invalid"
            }
          ]
        },
        "criterion": "parsing",
        "label": "both rename-specific errors keep their row and order"
      },
      {
        "call": "(() => { var first=__rename('New label'); return __rename('New label','TEN-WEST',2,first.records).counts; })()",
        "expected": {
          "applied": 0,
          "stale": 0,
          "duplicate": 1
        },
        "criterion": "replay",
        "label": "an exact replay has no second effect"
      },
      {
        "call": "(() => { var first=__rename('New label'); return __rename('Changed again','TEN-WEST',2,first.records); })()",
        "expected": {
          "ok": false,
          "errors": [
            {
              "row": 2,
              "code": "revision:conflict"
            }
          ]
        },
        "criterion": "replay",
        "label": "same revision with a different label conflicts"
      },
      {
        "call": "__rename('New label','TEN-EAST')",
        "expected": {
          "ok": false,
          "errors": [
            {
              "row": 2,
              "code": "rename:not-found"
            }
          ]
        },
        "criterion": "tenant-state",
        "label": "another tenant’s asset is not the target"
      },
      {
        "call": "(() => { var previous=__asset(); var before=JSON.stringify(previous); var out=applyCsv(previous,__csv(['TEN-WEST,EQ-8,2,rename,,New label','TEN-WEST,UNKNOWN,1,move,Depot-B,'])); return [out,JSON.stringify(previous)===before]; })()",
        "expected": [
          {
            "ok": false,
            "errors": [
              {
                "row": 3,
                "code": "move:not-found"
              }
            ]
          },
          true
        ],
        "criterion": "atomic",
        "label": "a later application error exposes no partial result"
      },
      {
        "call": "describeCommand({tenantId:'T',itemId:'I',revision:3,kind:'rename',label:'Gauge'})",
        "expected": "T/I: rename to Gauge",
        "criterion": "audit",
        "label": "the audit describes the new label"
      }
    ],
    "harness": "var __csv = function (rows) { return [INPUT_HEADER].concat(rows).join('\\n'); };\nvar __asset = function () { return applyCsv([], __csv(['TEN-WEST,EQ-8,1,create,Depot-A,Old label'])).records; };\nvar __rename = function (label, tenant, revision, snapshot) {\n  return applyCsv(snapshot || __asset(), __csv([(tenant || 'TEN-WEST') + ',EQ-8,' + (revision || 2) + ',rename,,' + label]));\n};\nvar __assetView = function (result) {\n  if (!result.ok) return result;\n  return { records: result.records.map(function (row) { return [row.tenantId,row.itemId,row.revision,row.location,row.label,row.status]; }), counts: result.counts, changes:result.changes };\n};"
  }
}
  ],
  "requires": []
};
