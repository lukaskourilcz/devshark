# Coding and Quiz implementation · 5 November 2026

The owner selected the task-first Coding and Quiz concepts, with these exceptions: keep the existing logo, keep Quiz topic pills and their logos, leave Learn unchanged, and preserve the bottom waterline with sharks throughout the app. The earlier HTML is the original design study; those exceptions govern the implementation.

## Coding

- Section tasks use one frame. Task information stays on the right; Results, Console and Types/Preview sit below code. Each tab strip has its own selection and keyboard navigation. Running code leaves the selected reference open.
- Feedback can be collapsed and resized. Run/Submit restore it before executing, including React focus checks. The editor and preview stay mounted across panel changes and resizing. Existing narrow-screen editor opt-in and puzzles remain, and every public test stays inspectable before opting into the editor.
- Description retains the complete authored prompt, previous requirements, glossary and one Desired complexity. Short examples reuse at most three existing public calls and expected values; large fixtures remain in Results. No prompt, hidden check or answer-access rule changed.
- The editor uses the existing theme tokens and syntax system, a filename toolbar and the existing Format/Reset controls. Run stays secondary, Submit is the primary on the right, and hints, reveal, skip, report and save retain their behavior. The Coding home uses the operational PageHeader; automatic latest unfinished continuation is retained.
- Learn, path activities and the landing sample retain their existing layout. New pane topology and editor colors are scoped to `mode="section"` / `.cd-workbench--section`.

## Quiz

- Setup uses divided settings, the selected-topic count and a start summary. An empty selection explains the missing topic before interaction; Start remains keyboard reachable and attempted-start errors are announced.
- `TopicPill`, `CategoryGlyph` and their shared styles are unchanged. All five difficulties and the count choices remain visible; hidden selected topics survive bulk actions. The guest notice and sign-in action share one subordinate row.
- Question navigation, grading, results, recovery and account-save behavior are unchanged.

## Preserved boundaries

No changes to `App.tsx`, `BrandLogo`, brand geometry/assets, Roadmap or Learn components. The shared bottom ocean remains visible, including during a quiz. No API handler, schema, migration, reward, progress, entitlement or server-grading changes.

## Local verification before release

Node 24.22.2. API/scripts/tooling types, unused/security, build, public/design contracts, bundle and launch checks pass. Both production dependency audits report zero vulnerabilities. The final source build measures 231,750 initial gzip bytes against 241,651; monitoring 49,500/60,000.

- Initial full client run: 187 files / 1,802 tests pass. The added mobile regression subsequently passes with all 26 narrow/output-tab tests; 47 output/state tests and all 46 isolated Learn-plan tests also pass. A full final run with two workers is being recorded separately.
- Final affected browser run: all 83 Coding workbench/pages/drafts, evolving and navigation cases pass. This covers real editor/runner/React harness behavior using local API fixtures, seven widths across both themes, independent tabs, collapsed output reopening, keyboard resizing, original logo and the ocean.
- Quiz flow and Learn-reading regression subset: all 22 browser cases pass. Four setup cases also exercise topic logos, keyboard selection, live summary, question start and axe checks in both themes at 360/1280px.
- Responsive harness: 14 Coding/Quiz route-width cells in light and 14 in dark, widths 360–1440px, zero issues or unprobed cells, including ocean clearance.

The first broad browser run passed 81/83: it found inaccessible mobile checks, fixed by keeping feedback available before editor opt-in; a navigation-opacity timing assertion also failed while other browser sweeps ran. The complete 83-case rerun passes without changing that timing assertion. A full client run concurrent with a build timed out waiting for the Learn level loader (1/1,803); the unchanged 46-test Learn-plan suite passes in isolation. No Learn implementation or timeout threshold was changed.

These are local, unmerged results. Required GitHub verify/SQL, the production deployment and guest smoke checks remain release gates; actual release evidence belongs in `docs/release-acceptance.md` after READY. Authenticated production acceptance, physical devices and independent human review are not claimed.
