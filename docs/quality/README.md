# Developer quality tools

These checks run on the existing Vite, Astryx, TanStack Query and PostHog stack. None needs a paid service, a production mock server or another UI system.

| Area | Run / entry point | What it checks or changes |
| --- | --- | --- |
| Performance | `npm run audit:performance -- --url=https://devshark.app`; `ANALYZE=true npm run build`; `npm run check:bundle` | Mobile and desktop Lighthouse JSON and HTML in `artifacts/performance`, the bundle treemap, and a gzip budget for what a first visit downloads (below). The system-font first visit downloads no font files; OG generation keeps its separate build-time fonts. |
| MSW | `npm run test:client` | Real API transport, authentication failures, timeout and cancellation, offline responses, and the leaderboard's retry and empty states. No live API or user record is used. |
| Knip | `npm run check:unused`; `npm run audit:unused` | CI rejects new and stale findings and enforces value exports in `lib/` and `shared/`. Client and type-only export reports stay advisory. It never deletes code. |
| Public SEO | `npm run check:public` | The topic guides include real HTML, canonical URLs, internal links and truthful LearningResource JSON-LD. The build emits the sitemap and robots file. |
| Copy and activation | `client/src/lib/analytics.ts`; [activation notes](activation.md) | English positioning and a sample → learning call to action → quiz or path funnel, with explicit property allow-lists. |
| Storybook | `npm run storybook`; `npm run build:storybook` | Real Astryx sample, retry, toast and confirmation components, and a real leaderboard in populated, empty, loading, server-error and offline states. The toolbar switches light and dark. |
| Typography and accessibility | `npm run test:browser`; `npm run check:responsive` | Shared fluid typography and spacing, 44px guide targets, keyboard disclosure and focus, reduced-motion checks and axe WCAG A/AA tests. |
| Security | `npm run check:security -- --url=https://devshark.app` | The exact-hash theme bootstrap, the main document CSP, HTTPS and security headers, and the separate coding sandbox policy. |

## Install and CI

Use Node 24, `npm ci` and `npm ci --prefix client`, then install Chromium once with `npx playwright install chromium` for browser and Lighthouse work. In the Claude Code cloud environment the browser is preinstalled under `/opt/pw-browsers` and `npx playwright install` is disabled: set `CHROME_BIN=/opt/pw-browsers/chromium` (and `CHROME_PATH` for Lighthouse), because the preinstalled build is not the one Playwright 1.63 would download. `CHROME_BIN` and `CHROME_PATH` can point to any compatible browser. After a build, start `npm run preview --prefix client -- --host 0.0.0.0 --port 4173`.

The Product quality workflow (`.github/workflows/quality.yml`) has the jobs `sql`, `quickjs`, `client-build`, `static`, `tests`, `coding`, `browser` and `container`, plus `verify`, which passes only when the seven non-SQL jobs pass. Branch protection requires `verify` and `sql`. The shared client-build job builds devShark once and packages all output, including hidden manifests and source maps. Static and browser jobs verify the artifact head and file hashes. The browser job runs the explicit Playwright selection in one two-worker invocation, the responsive checks in both themes and the harness test, then builds Storybook and records Lighthouse results; reports go up as the `quality` artifact. `npm run ci:parity` runs the same jobs locally (`--list`, `--only`, `--fast`). The Vercel Git integration owns deployment; the workflow deploys nothing.

Do not add MSW initialization to `src/main.tsx` or copy its worker into `client/public`: the worker lives only in `client/.storybook/public`. The workshop's own Vite config keeps app build hooks away from Storybook output and clears service credentials. Browser tests that need Storybook skip unless `STORYBOOK_URL` is set; the workflow sets it in a separate step.

## Knip

`check:unused` rejects new findings and stale reviewed-baseline entries. Value exports in `lib/` and `shared/` must have actual readers or a source-documented `@public` contract for a concrete dynamic-test, authoring or package API. Client exports and type-only exports remain advisory. The F14 cleanup leaves the reviewed baseline empty and adds no path ignores. Check actual readers before changing a documented contract.

The Knip config declares the Vercel handlers, maintenance scripts, the isolated sandbox, stories and tests as entries. It does not execute the Vite and Storybook configs, because the build config imports a TSX renderer; their sources are still entries and are typechecked and built on their own. The explicit dependency exceptions are the Astryx CSS theme, the Astryx CLI, Babel's Vite peer, the Storybook accessibility addon and the Lighthouse executable; `vercel` is an externally installed development CLI.

## SEO and deployment

Guides live at `/topics/:slug`. React renders the same `TopicArticle` the build prerenders. They are public explanations and examples, never scored-session answers. Static topic rewrites precede the SPA fallback. An unknown static guide resolves to a missing file on Vercel, and an unknown guide rendered in the client carries `noindex`. Leaving a guide clears its metadata, so a quiz never inherits a guide's canonical URL or schema.

The canonical origin is the production domain in `client/src/lib/publicMetadata.ts`, never a request host or a preview URL; if the domain changes, update it and rebuild. LearningResource describes what the page contains and promises no rich result. Submitting the sitemap in Search Console is an owner action outside the deployment.

## Reading the measurements

Lighthouse is lab evidence for one run, not field Core Web Vitals or a promise about conversion. Keep the complete JSON and HTML reports, and compare runs of the same product, route, device profile and build configuration. The bundle check leaves out lazy routes, font files and the coding sandbox; Lighthouse and the treemap show their cost.

`npm run check:bundle` builds its own copy of the client into `client/dist-budget` (removed after the run) with the build-time variables production sets, then gzips the entry script, the modulepreload links and the stylesheets that `index.html` requests. Client code depends on those variables: without the Supabase pair, a build leaves out code production serves. `docs/quality/bundle-budget.json` lists them under `measuredBuild.env`, as placeholders with the real values' length and alphabet, and the check prints which configuration it measured. Add a variable there when client code starts to depend on a new one. CI's main build reads the Supabase pair from the same file, so the browser checks run against a build that signs in the way production does.

The budget, `initialGzipBytes`, is **218,615 gzip bytes** in four initial requests, measured on 19 November 2026 for F3 (#632). The production-shaped main `6c85886c` baseline measured 235,416 (the earlier `d0e96b88` snapshot measured 235,427). Entry CSS fell from 25,784 to 24,720 gzip bytes after route-only styles moved to their consumers. Two useful modulepreloads remain, for React/Router and TanStack, down from three before the vendor groups combined. There are four initial files, so the ten-largest-chunks report also includes lazy chunks; those are not extra initial requests.

| Initial file group | Gzip bytes | Why it is requested |
|---|---:|---|
| Main | 106,099 | App shell, route registry, shared controls and state hosts |
| React/Router | 74,807 | Renderer, React core, JSX runtime, scheduler and navigation |
| TanStack | 12,989 | The shared query client/provider and shell reads |
| Main CSS | 24,720 | Reset, tokens, shared controls, shell and public guide styles |

The first visit previously preloaded 73,092 bytes of Manrope and Inter although the active design uses system fonts and emitted no font-face rule. It now preloads no fonts. The browser regression checks the requested chunks' source maps, including dynamic requests, for Motion, editor, rich-text, highlighting, QR, PostHog and Supabase packages. Drawer and toast animations load on use; the drawer closes at the 1024px desktop boundary without retaining hidden focus or replaying a pending request. Account-track synchronization keys on account id and the validated track rather than user-object identity. the eager hosts keep focus, live regions and XP events usable while code loads or fails. The route fade uses CSS. Account, Shop, Terms and lesson figure styles load with their components; public guides retain their no-JavaScript styles.

The check also measures the Sentry SDK against `monitoringGzipBytes` (60,000). It fell from 49,565 to 46,800 gzip bytes after production debug branches were disabled; tracing stays enabled at its existing 0.1 sample rate. This is not an initial request: it loads after the page's load event, at the browser's next idle moment, or on the first error. `lib/supabaseClient.ts` loads `@supabase/supabase-js` on demand, as a lazy `supabase-*.js` chunk of about 55 kB gzipped. A visitor downloads it when a session is stored (a returning, signed-in learner, whose requests meanwhile carry the stored token while it is more than 90 seconds from expiry, and whose public reads carry none), when the URL carries an OAuth return, on a sign-in click, or when another open tab signs in; a visitor who never signs in never downloads it, and `tests/browser/lazy-auth.spec.ts` checks both sides. A second chunk of about 400 gzip bytes, the app's own `lib/supabase.ts` API helpers, also starts with `supabase-`. It is not an initial request: the lazy chunks that call the API load it, among them Learn, Quiz, the Challenge, Today, Profile, the leaderboard, Cards and the coding pages.

Never remove sandbox isolation or development React from the exercise frame to improve the main application's score.

References: [Lighthouse](https://developer.chrome.com/docs/lighthouse/overview/), [MSW](https://mswjs.io/docs/), [Knip](https://knip.dev/), [Storybook](https://storybook.js.org/docs), [Utopia](https://utopia.fyi/type/calculator/), [MDN Observatory](https://developer.mozilla.org/en-US/observatory), [OWASP secure headers](https://owasp.org/www-project-secure-headers/).

The container gate compares the published F14 baseline and candidate on one Linux/amd64 runner. It records image bytes and installed packages and runs the same current authored JavaScript, TypeScript and React reference harness against each image's dependencies and generated workers, without publishing either image. The docs-archive fixture suite verifies restoration behavior with temporary Git repositories; it does not freeze future ledger updates or fetch the historical archive on every CI run.

Responsive sweeps use two isolated Chrome sessions over disjoint viewport groups and aggregate every requested probe. Strict route fixtures, touch targets, reflow geometry and the settling interval remain unchanged. Local parity accepts `--preview-port` for a second checkout; it refuses a server already listening there and sets both browser and responsive base URLs. Storybook keeps its separate port 6006.
