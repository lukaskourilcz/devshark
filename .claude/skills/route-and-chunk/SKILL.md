---
name: route-and-chunk
description: Add or move a devShark route or page with its lazy chunk, document head, route-local copy, public HTML, vercel.json placement, responsive fixtures and browser checks. Use for any change to the `<Routes>` in client/src/App.tsx or to what a first visit downloads.
---

# Route and Chunk

Use with `shark-screen-implementation`, which owns the screen itself. This skill owns how the page is loaded, named, served and checked. Every rule names the file it comes from; read that file before you rely on the rule.

## Register the page

- Register every page's chunk with `routeChunk(matches, load)` from `client/src/lib/routePreload.ts`, using the `exact(...)` or `routes(...)` matchers in `client/src/App.tsx`. Pass `routes` the same patterns as the page's `<Route path>`s (`routes('/play/:code?')`, `routes('/coding/:track?', '/coding/:track/:taskId')`): it matches those shapes only, with a trailing slash read as the same route. Never match a whole prefix, which also preloads the chunk for deeper paths that draw the 404 page. A pointer resting on a link, a focus or a touch then starts the same import the route runs (`installIntentPreloading`), and a failed import is forgotten so the next attempt asks the network again. When the browser asks to save data, only a left mouse press preloads.
- Build the page component with `lazyPage(load)` from `client/src/lib/routeRecovery.ts`, never `React.lazy`. React.lazy keeps a failed load for good; `lazyPage` renews it and checks for a newer build before the error reaches the boundary (the comment above `loadHome` in `App.tsx`). Several pages that share one chunk pick their export: `lazyPage(() => loadPaths().then((m) => ({ default: m.FdeModule })))`.
- A page moved into its own module also needs its own loader in `App.tsx`. `/learn/big-o` first moved into `BigOIntroduction.tsx` but was still loaded through the Learn sections' loader, so it kept fetching the map's chunk until it got `loadBigOIntroduction` (#587 C17). Check the chunk graph or `check:bundle`'s output, not the import alone.
- Add the `<Route>` inside the `<Routes>` in `App.tsx`, before `path="*"`. `RouteErrorBoundary` and the route `Suspense` already wrap every route there.
- Give the path a title key in `ROUTE_TITLE_KEYS` in `client/src/lib/routeHead.ts`. `applyRouteHead` reads `/quiz/` as `/quiz` and writes `og:url` beside the canonical, as the prerendered pages carry it. A page that means something to one person (a checkout return, an email link) goes in `NOINDEX_PATHS` in `client/src/lib/publicMetadata.ts`.

## Parts that fail alone

- A lazy part of the shell outside the route boundary uses `lazyShellPart` and sits inside its own `Suspense` with a `ShellPartBoundary` inside it, as the account widget does in `App.tsx` (`<ShellPartBoundary fallback={(retry, busy) => <AccountRetry … />}>`). The boundary renders the part again on retry and reloads only on the learner's press (`client/src/components/ShellPartBoundary.tsx`).
- A part inside a page that should fail without taking the page down (the Learn level runner and its coding workbench, a path's code editor, the path shelf, the friends tab, the code highlighter) also uses `lazyShellPart` with a `ShellPartBoundary` (the doc comment of `lazyShellPart`).
- A section the page's first-data hold loads with its reads uses `lazyPart` from `client/src/lib/routeData.ts`; it fails with its page.
- React commits a Suspense boundary that leaves its fallback no sooner than 300 ms after the last fallback any boundary showed or hid. A part whose code is often already in when it draws (the coding workbench, the lesson reader, the level runner) loads into state and draws from it (`useWorkbench` in `client/src/coding/loadWorkbench.ts`, `components/learn/lessonParts.tsx`) instead of suspending, and the first page of a visit renders in a transition (`useFirstPageTransition`, `client/src/lib/routePreload.ts`). Start such a part's import on the earliest real signal (a level's last question, a pointer on a task link), not on mount (#587 C04, C19, paths walk).

## Copy and the bundle budget

- `npm run check:bundle` (`scripts/check-bundle.mjs`) builds a production-shaped client with the variables in `measuredBuild.env` of `docs/quality/bundle-budget.json`, then sums the gzip bytes of what `index.html` requests on a first visit: the entry script, its `modulepreload` links and its stylesheets. The total must stay at or under `initialGzipBytes` in that file, and the Sentry chunk under `monitoringGzipBytes`. A lazy page costs nothing here; a static import from the shell (`App.tsx`, `main.tsx`, the header, the footer) costs every visitor.
- `client/src/i18n/translations.ts` ships with the shell. PR #401 failed `verify` at 243182 gzip bytes against 243000 and passed after its route copy moved into a route-local dictionary (`docs/release-acceptance.md`, the 15 October entry "PR #401 initial-load correction").
- Put copy only one route reads in a route-local dictionary: `client/src/i18n/translations.<area>.ts` exporting `<area>En = { … } as const`, with a header comment that says which chunk loads it and why. Import it only from the lazy route's own modules. The models are `translations.privacy.ts` (read by `LegalPages.tsx`, which looks a key up there first and in `translations.ts` otherwise), `translations.learn.ts` (the Learn sections and the skill check, read through `learnText`), `translations.paths.ts` (`LearningPathScreens.tsx`), `translations.drafts.ts` (`coding/DraftNote.tsx`) and `translations.picker.ts` (`PathPickerDialog.tsx` and `paths/LearningPathsCard.tsx`, read through its `pickerCopy`, which fills `{name}` placeholders as `t()` does). `npm run check:bundle` prints the current total; read the headroom from it, not from a figure written here. Leave a one-line pointer in `translations.ts` where the keys would have sat, as its comments for the privacy and draft keys do.
- `consentContracts()` in `scripts/test-launch-contracts.ts` fails when a `legal.privacy.*` key appears in `translations.ts` or when `App.tsx`, `main.tsx`, `LanguageContext.tsx`, `BrandFooter.tsx` or `CookieConsent.tsx` imports `translations.privacy`. It holds `translations.picker.ts` to the same two rules, and `translations.learn.ts` to the same rules for its `learn.*` and `placement.*` keys and the shell files. Add the same two assertions for a new route-local dictionary.
- Write English only. Add no second-language file or overlay (CLAUDE.md, "Protected behavior"; `shark-product-context`).

## Public HTML and the sitemap

- A route the SPA fallback serves needs no `vercel.json` change: the last rewrite, `/((?!api/|assets/|ingest/|sandbox/|topics/).*)` to `/index.html`, answers it.
- A page that must read without JavaScript and appear in search gets prerendered HTML: an entry in `PUBLIC_PAGES` (`client/src/lib/publicMetadata.ts`) with its title and description keys, a body in `STATIC_PAGE_BODIES` (`client/vite.config.ts`), and a rewrite `{ "source": "/<path>", "destination": "/<path>/index.html" }` in `vercel.json` before the SPA fallback. The build writes the page and adds its URL to `sitemap.xml`.
- `scripts/check-public.mjs` asserts `urls.length` is 18 with the message "Home, five English guides, three Learn sections, /premium, /premium/cancel, /daily, /coding and its five track pages", and lists the app pages in `APP_PAGES` (the three Learn sections, `/premium`, `/premium/cancel`, `/daily`). A new sitemap page changes the count, the message and `APP_PAGES` in the same commit. `/premium/success` and `/premium/checkout` must never appear.

## vercel.json placement

`vercelRoutingContracts()` in `scripts/vercel-routing-contract.ts` runs inside `npm run test:launch` and holds these rules:

- Header rules live in `routes`, before `{ "handle": "filesystem" }`, each with `"continue": true`, `headers`, no `dest` and no `status`. A top-level `headers` property is refused: Vercel appends it after the hit phase, where it reaches existing files only.
- The `handle` entries are `filesystem` then `hit`, once each. The `hit` phase may only add headers; the year-long `immutable` cache for `/assets/` lives there.
- The filesystem phase starts with the 404 `no-store` rule for a missing asset. No rewrite may match an `/assets/` or `/sandbox/assets/` path, and the SPA fallback still serves `/`, `/coding` and `/profile`.
- `scripts/check-security.mjs` reads the app's CSP from the one header route whose policy holds `frame-ancestors 'none'`, and fails when no rule or two rules carry it. A new page-wide header rule (COOP, for example) may use any `src` shape as long as it sets no such policy.

A prerender rewrite must sit before the SPA fallback in `vercel.json` `rewrites`: Vercel tries rewrites in order, and the fallback matches almost every path, so a rewrite after it is never reached. The contract checks that order only for `/coding/:track/:taskId` (`taskRewrite`) and the system-design paths. Add an assertion for a new rewrite to `vercelRoutingContracts()` beside `taskRewrite`, or nothing catches a misplaced one.

## Responsive fixtures

- `npm run check:responsive` sweeps `DEFAULT_ROUTES` in `scripts/check-responsive.mjs` at eight widths against a running preview (`http://localhost:4173` by default), signed out. Add the new route there when it renders signed out.
- A measurement counts only when the page draws an `<h1>`, does not land on the not-found page, and every `/api` request it makes has an entry in `API_FIXTURES`. An unanswered request fails the route with "asked the API for data with no fixture in this script". Build fixture bodies from the server's own modules in `scripts/responsive-fixtures.ts` where you can, so they cannot drift from the handler.
- `/api/settings` answers with `tests/fixtures/api-settings.json`, which `retiredSupportContracts()` in `scripts/test-launch-contracts.ts` holds to the handler's real body.
- The sweep needs Chrome: `CHROME_BIN`, or a binary from `CHROME_CANDIDATES`. CI sets `CHROME_BIN` from Playwright's Chromium (`.github/workflows/quality.yml`, "Browser checks").

## Signed-in browser specs

- `tests/browser/fake-session.ts` gives a spec a signed-in visitor without a server: `storeFakeSession(page)` writes a session no server issued under supabase-js's key, and `localAuth(page)` answers `/auth/v1/*` locally. Answer the page's `/api/**` requests with `page.route`, as `tests/browser/profile-leaderboard-preferences.spec.ts` does.
- The session key comes from the placeholder Supabase URL in `docs/quality/bundle-budget.json`, so the preview must be built with that URL and anon key exported, as CI's build step does.
- Playwright reads `TEST_BASE_URL` (default `http://localhost:4173`) and `CHROME_BIN` (`playwright.config.ts`). CI runs only the specs listed in the "Browser checks" step of `.github/workflows/quality.yml`; add a new spec there or it never runs in `verify`.
- `tests/browser/routes-axe.spec.ts` scans whole pages against WCAG 2.2 AA for the routes in its `ROUTES`. Add a public route there.

## Validation

```sh
VITE_PRODUCT=devshark VITE_LOCK_SUBJECT=webdev npm run build
npm run check:public
npm run check:bundle
npm run test:launch
npm run test:client
npm run preview --prefix client -- --port 4173
npm run check:responsive -- --routes /<path> --widths 360,390,768,1280
RESPONSIVE_THEME=dark npm run check:responsive -- --routes /<path> --widths 390,1280
npm run test:browser -- tests/browser/<spec>.spec.ts
git diff --check
```

- `build` runs the client's `tsc -b` and both Vite builds, and writes the prerendered pages and `sitemap.xml` into `client/dist`. Export the placeholder Supabase pair from `bundle-budget.json` first when a browser spec will sign in.
- `check:public` proves the sitemap count, canonicals, share images and the public pages' HTML in `client/dist`.
- `check:bundle` proves the first visit stays inside `initialGzipBytes`; it writes `artifacts/bundle.json` with each file's size.
- `test:launch` proves `vercelRoutingContracts()` and `consentContracts()`.
- `test:client` runs the Vitest suites, `client/tests/route-head.test.tsx`, `route-loading.test.tsx` and `page-headings.test.tsx` among them.
- The preview, `check:responsive` and `test:browser` bind or reach port 4173. Run them only when no other job owns that port, and stop the preview afterwards.

Report each command's real result and the routes and widths the sweep covered. A command you did not run is "not run", never a pass.
