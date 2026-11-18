# CSP experiments, 18 November 2026 (Epic F, F10)

Issue #639 asks for two experiments on the app document's policy: `style-src`
without `'unsafe-inline'`, and `require-trusted-types-for 'script'` in
report-only mode. This file records both, per component, with the decision
taken. It also records which responses carry `Access-Control-Allow-Origin`
when `vercel.json` sets none. The F10 section of `docs/release-acceptance.md`
should link here.

## Method

A Chrome 157 (157.0.8103.80) session loaded each route with the app
document's `Content-Security-Policy` rewritten in flight through the Chrome
DevTools Protocol (`Fetch.requestPaused`, then `Fetch.fulfillRequest`):
`style-src` became `'self'`, every other directive stayed as the server sent
it, and a `Content-Security-Policy-Report-Only: require-trusted-types-for
'script'` header was added. The sandbox frame (`/sandbox/*`) and the coding
worker (`/assets/coding-worker/*`) kept their own policies. A listener in
every frame collected `securitypolicyviolation` events, and the console of
the page and its workers was read for CSP reports.

The session visited each route, scrolled to the end, and on `/` opened the
cookie settings, refused analytics and opened the sign-in dialog. On
`/coding/javascript/js-double-numbers` and
`/coding/react/react-easy2-focus-the-search` it typed into the editor, pressed
Run, waited for the result and read the editor's computed `display`.

| Run | Target | Routes | Requests |
| --- | --- | --- | --- |
| Local, wide | `docker/server.mjs` on `client/dist`, built with the CI build env (`docs/quality/bundle-budget.json`), 1280 px, light | 31 routes: `/`, `/learn`, both paths, `/coding` and its track pages, both tasks above, `/quiz`, `/daily`, `/premium`, `/leaderboard`, `/topics/javascript-closures`, `/play`, `/challenge`, `/today`, `/privacy`, `/terms`, `/support`, `/big-o`, `/roadmap`, `/cards`, `/shop`, `/auth/confirmed`, `/reset-password`, `/profile`, `/typing`, `/collection`, `/classroom`, `/admin` | local |
| Local, narrow | the same server, 390 px, dark, menu drawer opened on `/` | `/`, `/learn/web-developer`, `/premium`, `/topics/javascript-closures`, `/daily`, `/quiz`, `/play`, `/typing` | local |
| Deployed | production, `https://devshark.app` (main chunk `main-d4tr-P-B.js`) | `/`, `/premium`, `/topics/javascript-closures`, both tasks above | 119 GET requests let through to devshark.app, 117 of them from the network |

This branch has no preview deployment yet, so the deployed run used
production under the audit's read-only rule: one browser context with its
HTTP cache on, GET requests to devshark.app only, and images, fonts and media
refused before the network (CSP checks a request before it leaves, so a
refused image still reports). The session refused 7 POST requests (Sentry
envelopes) and 15 image and font requests, and sent nothing to another host.

## style-src without 'unsafe-inline'

| Component | Local | Production | What happens |
| --- | --- | --- | --- |
| CodeMirror editor (`Editor-CNzwt4Q_.js`; `@codemirror/view` 6.43.10, `style-mod` 4.1.3) | 2 violations | 2 violations | `style-src-elem` refuses the `<style>` element that `style-mod` adds to the document head on both task pages. The editor loses its base theme: `.cm-editor` computes `display: block` instead of `flex`. Run still reaches a result (0 of 5 and 0 of 4 passing on the starter code). |
| Astryx components: buttons, cookie banner and settings dialog, sign-in dialog, menu drawer | 0 | 0 | No `<style>` element and no `style` attribute in markup. |
| Motion animations and React `style` props | 0 | 0 | Both write through the CSSOM (`element.style`), which `style-src` does not govern. |
| Prerendered pages (`/premium`, `/topics/javascript-closures`) | 0 | 0 | None of the 912 prerendered `index.html` files in `client/dist` outside `/sandbox/` holds a `style` attribute or a `<style>` element. |
| Satori share cards | not applicable | not applicable | Satori and resvg run in Node at build time and ship PNG files; no browser policy applies to them. |

The narrow dark run found no `style-src` violation.

**Decision: keep `'unsafe-inline'` in `style-src`.** CodeMirror mounts its
styles as a `<style>` element in the document. `EditorView.cspNonce` would
let a nonce through, but a nonce needs HTML generated per request, and
devshark.app serves its pages as static files. A hash would change with
every editor extension, theme and CodeMirror upgrade. Scripts stay locked to
`'self'`, Stripe and the one bootstrap hash, so an injected style can restyle
the page but cannot run code. A CSP report endpoint (F10-31, an owner item)
would let us see violations in production.

## require-trusted-types-for 'script', report-only

| Sink | Chunk | Routes | Reports |
| --- | --- | --- | --- |
| `Worker` constructor with a URL string (the Run worker) | `run-tests-BYZQNoaC.js` | `/coding/javascript/js-double-numbers` | 2 per Run, locally and in production |
| `HTMLScriptElement.textContent` (the JSON-LD block the route head writes) | `routeHead-RQuUwTJq.js` locally, `routeHead-BfnMWNKS.js` in production | `/premium` and `/topics/javascript-closures` in both runs, `/support` locally | 1 per page |

The React Run reported nothing: it hands code to the sandbox frame, which no
Trusted Types sink sees. Two script loaders did not run: Stripe.js (checkout
is off) and the PostHog loader (no analytics consent).

**Decision: ship no Trusted Types header** until a report endpoint exists
(F10-31). Enforcing it first needs a Trusted Types policy for the worker URL
and for the JSON-LD text, and a check of Stripe.js and PostHog once they load.

## Access-Control-Allow-Origin where vercel.json sets none

Production, GET, 18 November 2026:

| Path | Status | `Access-Control-Allow-Origin` |
| --- | --- | --- |
| `/` | 200 | `*` |
| `/topics/javascript-closures` | 200 | `*` |
| `/coding/javascript/js-double-numbers` | 200 | `*` |
| `/sandbox/index.html` | 200 | `*` |
| `/topics/a/b` (Vercel's own 404) | 404 | none |
| `/api/settings` | 200 | none |

No rule in `vercel.json` targets `/` or a rewritten page, so Vercel adds `*`
to every static file on its own. The `/assets/*` rule therefore changes
nothing; F10-21 replaces it with a rule that names the site origin.
