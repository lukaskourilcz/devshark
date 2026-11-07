# devShark in one container: the built client plus the twelve API handlers,
# served by docker/server.mjs. Production runs on Vercel; this image is for
# local demos and self-hosting. See docs/packages.md.
#
# The client bakes its Supabase URL and anon key in at build time. The defaults
# point at a local `supabase start`; pass --build-arg to use another project.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --no-audit --no-fund && npm ci --no-audit --no-fund --prefix client
COPY . .
ARG VITE_SUPABASE_URL=http://127.0.0.1:54321
ARG VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
ARG VITE_STRIPE_PUBLISHABLE_KEY=
ENV VITE_PRODUCT=devshark VITE_LOCK_SUBJECT=webdev \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
RUN npm run build && node docker/build-handlers.mjs

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# typescript is a devDependency, but the grader's type checker loads it at run
# time (Vercel ships it through includeFiles), so install the locked version.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save --no-package-lock --no-audit --no-fund \
      "typescript@$(node -p "require('./package-lock.json').packages['node_modules/typescript'].version")"

FROM node:24-bookworm-slim
ARG VITE_SUPABASE_URL=http://127.0.0.1:54321
WORKDIR /app
ENV NODE_ENV=production PORT=3000 \
    CSP_CONNECT_EXTRA="${VITE_SUPABASE_URL}"
COPY --from=deps /app/node_modules ./node_modules
COPY package.json vercel.json ./
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/lib/coding/generated ./lib/coding/generated
COPY --from=build /app/docker/dist ./docker/dist
COPY docker/server.mjs ./docker/server.mjs
LABEL org.opencontainers.image.source="https://github.com/lukaskourilcz/react-express-app" \
      org.opencontainers.image.description="devShark: the React client and the twelve API handlers in one Node container." \
      org.opencontainers.image.title="devShark"
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "docker/server.mjs"]
