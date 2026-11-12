# Administration UX review, 12 November 2026

The owner asked for an administration that is easy to scan and easy to move around in, like the NAVIGYM
administration: details stay hidden until someone opens them. This review covers `/admin` (Users, Vouchers,
Emails) and the `/dev` control room (nine sections), looked at on production with real data at 1470 px
and at phone width in the test fixtures.

## Findings

| # | Where | Finding | Fix |
|---|---|---|---|
| 1 | Both | Two administrations behind the same lock, with different navigation, headers and styling. Vouchers is in both. Nothing links one to the other. | One administration at `/admin/<section>` with every section. `/dev` and `/dev?section=…` redirect there. |
| 2 | Navigation | A flat list, and the control room adds a description under every item. Nine items read as one block. | Grouped navigation as in NAVIGYM: Learners, Content, Communication, plus a collapsed "More tools" group. Labels only. |
| 3 | Navigation, phone | The section list scrolls sideways under the brand, and the control room switches to a select box. | A "Menu" button that opens the grouped list, closes on Escape and after a choice, and shows the current section. |
| 4 | Sidebar | The control room's "App context" card and "Quick preview" pills take space on every page and are used rarely. | One "Open devShark" link in the footer, with the account, theme and lock kept compact. |
| 5 | Page header | Each page repeats an eyebrow, a lead sentence and, in the control room, "Changes apply to the live app configuration". | Title and one short line. Notes that are always true move into the relevant section. |
| 6 | Users | Each row carries the account ID, verification, providers, join date and every voucher's redeem and end dates, so a row is five lines tall. | A row shows the account, the plan and the last sign-in. The rest opens with "Details" under the row. |
| 7 | Vouchers | A paragraph about hashing and the full creation form come before the vouchers themselves. Every open voucher shows a limit form. | The list comes first. "New voucher" opens the form. "How codes are stored" is a disclosure. "Change limit" opens the limit form. |
| 8 | Emails | The delivery block lists five settings, and each template shows a description, all its variables and a Supabase note above the editor. | Delivery is one status line with "Delivery details" to open. The template description, variables and Supabase note sit under "About this email". |
| 9 | App settings | Long help paragraphs (coins, invitations, career levels, tips) and eight sections in one column make a page several screens long. | Each section is a collapsible group (Quiz open, the rest closed) and every help paragraph sits under "How this works". |
| 10 | Question bank | The red "Delete N fillers" bulk action and its explanation are always visible above the table. | The bulk cleanup sits in a closed "Bulk cleanup" disclosure; it still asks for confirmation when opened. |

## Rules applied

- What someone checks every visit stays visible: names, states, counts and primary actions.
- Explanations, IDs, timestamps and rarely changed settings sit behind a labelled disclosure (`AdminDisclosure`,
  a native `details` element: it works with the keyboard and without JavaScript, and screen readers report it as
  expanded or collapsed).
- A destructive action is never the first thing on a page.
