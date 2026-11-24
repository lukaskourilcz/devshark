# GitHub Packages

This repository publishes two packages to GitHub Packages. Both come from the
same sources the app ships, and `.github/workflows/packages.yml` publishes
them. Production is not affected: devShark still deploys from `main` to Vercel.

| Package | Registry | Built from | Published on |
| --- | --- | --- | --- |
| [`@lukaskourilcz/coding-evaluator`](../packages/coding-evaluator/README.md) | npm (`npm.pkg.github.com`) | `shared/coding-evaluate.ts`, `coding-console.ts`, `coding-failure.ts`, `coding-mini-jest.ts` | a `coding-evaluator-v<version>` tag |
| `ghcr.io/lukaskourilcz/devshark` | container (`ghcr.io`) | `Dockerfile`, `docker/` | a `docker-v<version>` tag |

Either job can also be started from the `main` branch in Actions → Packages → Run workflow.

## Runtime dependencies

The React grading snapshot installs the root lockfile with `npm ci --omit=dev --ignore-scripts`. The container also installs production dependencies. When an update changes the grader’s runtime packages, prepare a snapshot from the new lockfile and verify a real Sandbox run and a Preview submission before production. Retain the previous snapshot ID for rollback. [React grading operations](./react-grading-operations.md)

| Package | Manifest section | Runtime consumer |
| --- | --- | --- |
| `jsdom`, `react`, `react-dom`, `@testing-library/react`, `@testing-library/dom`, `sucrase` | Root dependencies | The React grading guest creates a DOM, renders learner components and runs the authored assertions. Sucrase transforms the suite. Testing Library React requires Testing Library DOM as a peer. [Grader](../lib/coding/react-runner.ts) |
| `quickjs-emscripten`, `@jitl/quickjs-singlefile-cjs-release-sync` | Root dependencies | The grader loads the vendored WebAssembly with this SDK and variant. Both versions must match `build.abiSdk` in the provenance manifest. An upgrade requires rebuilding and verifying the vendored module with `npm run check:quickjs-build`. [Variant](../lib/coding/quickjs-variant.ts) · [Provenance](../lib/coding/vendor/provenance.json) |
| `@vercel/sandbox` | Root dependency | The React grading host loads a CommonJS bundle of the SDK to run the guest in a Sandbox. [Build](../scripts/build-react-runner.mjs) |
| `@supabase/supabase-js`, `@upstash/redis`, `@upstash/ratelimit`, `stripe` | Root dependencies | API handlers use the Supabase client, Redis-backed rate limits and Stripe billing. The container bundles the handlers with external npm packages. [API client](../lib/http.ts) · [Rate limits](../lib/rate-limit.ts) · [Billing](../lib/billing/stripe.ts) · [Handler build](../docker/build-handlers.mjs) |
| `typescript` | Root devDependency, client dependency | The server grader also needs the compiler at runtime. Vercel includes its files in the roadmap function and Docker installs the exact locked compiler separately. The browser compiler loads TypeScript and its standard library declarations. [Vercel configuration](../vercel.json) · [Docker install](../docker/install-runtime-typescript.mjs) · [Browser compiler](../client/src/coding/runner/ts-compiler.ts) |
| `react`, `react-dom`, `@testing-library/react`, `@testing-library/dom`, `sucrase` | Client dependencies | The browser sandbox renders components and exposes Testing Library for exercises. It transforms code before running it. Testing Library DOM is the required peer. [Sandbox entry](../client/sandbox/main.tsx) |
| `prettier`, `react-syntax-highlighter`, `qrcode`, `@supabase/supabase-js` | Client dependencies | The formatter loads Prettier’s standalone build with Babel and ESTree. The code block, Play QR and Supabase client also load their packages on demand. [Format](../client/src/coding/runner/format.ts) · [Code block](../client/src/components/CodeBlock.tsx) · [Play](../client/src/components/Play.tsx) · [Supabase client](../client/src/lib/supabaseClient.ts) |
| `@tanstack/react-query-devtools` | Client devDependency | The app imports the panel inside Vite’s development-only branch. [Client entry](../client/src/main.tsx) |

`npm run check:unused` checks the client’s runtime imports, server externals, required peers and advisory explanations. The client’s `//overrides` entries record the scoped fixes for Satori’s `fflate` and Storybook’s TypeScript docgen plugin. Each entry states the parent dependency change that permits its removal. [Placement check](../scripts/check-dependency-placement.mjs) · [Client manifest](../client/package.json)

## The npm package

`packages/coding-evaluator` re-exports the Run-button evaluator from `shared/`
and bundles it into ESM and CommonJS with type declarations. Its README covers
installing and using it. It is MIT licensed, for the files in that package
only; the rest of this repository is not licensed for reuse.

To release a version:

1. Bump `version` in `packages/coding-evaluator/package.json`.
2. Run `npm run build && npm test` in that folder.
3. Merge, then tag `main`: `git tag coding-evaluator-v0.1.1 && git push origin coding-evaluator-v0.1.1`.

The job fails when the tag and the package version differ.

## The container image

The image runs the whole product in one Node 24 process: the built client from
`client/dist` and the twelve `api/` handlers, bundled by
`docker/build-handlers.mjs` and served by `docker/server.mjs`. The server reads
the headers, redirects and rewrites from `vercel.json`, so the routing matches
production, though it only approximates Vercel's router. It does not proxy
PostHog (`/ingest/*` answers 404), so analytics stay off.

The client bakes its Supabase URL and anon key in at build time. The published
image uses a local Supabase (`http://127.0.0.1:54321` and the Supabase CLI's
demo anon key). For another project, build your own:

```sh
docker build -t devshark \
  --build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=<anon key> .
```

### Run it against a local Supabase

```sh
supabase start                       # prints the API URL, keys and DB URL
DB=postgres://postgres:postgres@127.0.0.1:54322/postgres
psql "$DB" -f supabase/supabase-schema.sql
for f in $(ls supabase/supabase-schema-*.sql | sort -V); do psql "$DB" -v ON_ERROR_STOP=1 -f "$f"; done

docker run --rm -p 3000:3000 --add-host=host.docker.internal:host-gateway \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_ANON_KEY=<anon key from supabase start> \
  -e SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start> \
  ghcr.io/lukaskourilcz/devshark:latest
```

Open <http://localhost:3000>. The browser reaches Supabase on `127.0.0.1:54321`
and the container on `host.docker.internal:54321`, so both names point at the
same instance. `CSP_CONNECT_EXTRA` (set from `VITE_SUPABASE_URL` in the image)
adds that origin to the Content-Security-Policy's `connect-src`.

Without Supabase the image still starts. Public pages and the daily question
work, `/api/health` answers 503 with the database reported as unavailable (so
the container's health check says `unhealthy`), and signed-in features answer
503.

### Environment

| Variable | Needed for |
| --- | --- |
| `SESSION_SECRET` | Required: at least 32 characters. Without it every handler that signs a session answers 500 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Accounts, progress, grading records |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared rate limits (an in-memory limiter is used without them) |
| `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` | Premium checkout |
| `PORT` | The listening port (default `3000`) |
| `CSP_CONNECT_EXTRA` | Extra `connect-src` sources, separated by spaces |

To release a version, tag `main` with `docker-v<version>`. The job pushes
`<version>`, `latest` and `sha-<commit>` for `linux/amd64` and `linux/arm64`.
