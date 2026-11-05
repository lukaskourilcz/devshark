# Review artifact validation

This is validation of the review document and its screenshot concepts. It is not acceptance of a product redesign, a complete usability study or a WCAG conformance claim.

## Screen evidence

- Baseline: live product #599 / `2ff184bc`; #600 / `bba113ce` adds documentation only.
- Initial mapping: 37 requested route targets, 63 production guest cells. All have zero recorded page errors and no document overflow. One non-read envelope request was blocked; none was sent. Auth redirects and gates are recorded as such in `observations.json`.
- Authenticated visual evidence: 12 current-build cells using the existing local fake-session fixture, fictional Test Learner and locally intercepted APIs. Profile, Today, active Quiz, Quiz result, Challenge active and FDE module each cover light and dark. The two first result-capture attempts reused an active Quiz context; the capture setup was corrected to isolate every scene. Final captures have no capture error or page error. Optional fixture reads are listed in `fixture-observations.json`; these are not production failures.
- Matched concepts: 33 before/after pairs across 16 representative scenes, 66 lossless WebP images. Every pair uses the same viewport, input data and source UI. All recorded before/after document-overflow flags are false; page-error arrays are empty. Two non-read envelope requests were blocked in the guest pair run. The one fixture Quiz Submit was fulfilled locally, without a production result or receipt.
- Viewports: 1280×800 throughout; representative 1440×900 and 390×844 variants. Both themes cover the principal workspace, catalogue, Learn, Quiz, Today, Profile and FDE concepts. Source and concept contact sheets were visually inspected, with full-size inspection of core editor, evolving, Learn, Quiz, Today, Profile, FDE and mobile changes.
- Public pages were observed read-only in production. After concepts were applied only in a disposable browser context with Playwright's CSP bypass enabled for the review injection. No deployed CSP, application code or server setting changed. The local account, API responses, XP, streak, score and enrollment are fictional and labelled in the HTML.
- Mobile workbench: Before is the current small-screen desktop-editor offer. After explicitly selects the existing “Use the editor here” route before arranging the visual concept. Description and editor stack; this is not a claim that two desktop panes fit simultaneously on a phone.

## Interactive document

`review-qa.json` records 25 passing checks, the browser/Node versions and the SHA-256 of the tested `index.html`:

- All 27 stable cards and deep links; search, area, priority and decision filters.
- Czech multiline comment and decision persistence across reload, without rebuilding the focused textarea.
- Before/after, side-by-side and theme/viewport switching; all 66 embedded screenshot dimensions decode correctly.
- Native zoom dialog, Escape and focus restoration.
- JSON export; validated import with confirmation; Cancel; rejection of unknown IDs and invalid values; HTML-like comment text remains inert.
- Clear with confirmation and Cancel; blocked-storage fallback; standalone `file://` loading.
- Document reflow at 320, 390, 640, 1280 and 1440 CSS px in both themes. The 640 CSS-pixel case is a reflow stress case, not a physical browser zoom or Safari test.
- Axe WCAG 2 A/AA and 2.1 AA tagged checks on the review DOM in desktop light and dark: zero violations. This does not inspect accessibility inside raster screenshots.
- No runtime page errors or outbound runtime dependencies. Images and reference thumbnails are embedded; CSP denies network connections.

A first deep-link check exposed additive scroll-padding and scroll-margin spacing in the report. The duplicated offset and an empty summary grid row were removed before the passing run. This affected the review UI only.

## Rebuild and use

`python3 docs/ux-review-platform-2026-11-05/build-review.py` rebuilds the standalone HTML with the Python standard library from committed JSON, the template and WebP images. It makes no network request. Comment state is separate in the browser, keyed by date and stable finding ID; rebuilding the HTML does not rewrite it.

Open `index.html` directly, or serve this directory on loopback port 4182. Comments are local to the browser/origin. Export/import JSON to move between devices, browsers or `file://` and localhost. The download contains decisions and comments, not images or credentials. Comments are never sent automatically.

The prototype source is `prototype/after-transform.js`. It is not imported by the application and is a visual transform, not working navigation, grading or persistence. References and scene limitations are explicit in the document. Authenticated production acceptance, physical Safari/phone testing, multiplayer reconnect, admin internals and the full negative-state matrix remain implementation work for approved changes.
