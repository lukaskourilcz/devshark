import { createHash } from 'node:crypto';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The coding sandbox is built on its own, after the app, for one reason:
// React Testing Library needs `React.act`, and React only exports `act` from
// its DEVELOPMENT build. A production React makes RTL fall back to
// `react-dom/test-utils.act`, whose production shim calls the missing
// `React.act` and throws "act is not a function" on the first `render()` —
// so no React task could pass in a deployed build.
//
// Building this page separately keeps `process.env.NODE_ENV = 'development'`
// (and therefore the development React) inside the iframe, while the app
// itself keeps the production React it should ship. The two never share a
// React tree: the sandbox is a document of its own.
export default defineConfig({
  root: path.resolve(__dirname, 'sandbox'),
  // The page is served from /sandbox/, so its own assets resolve from there
  // and inherit the frame's headers in vercel.json.
  base: '/sandbox/',
  plugins: [
    react(),
    {
      name: 'sandbox-entry-integrity',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(html, { bundle }) {
          const tag = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/sandbox\/([^"]+)"[^>]*>/g;
          const entries = [...html.matchAll(tag)];
          if (entries.length !== 1) throw new Error('Expected one local sandbox module entry.');
          const [script, assetName] = entries[0];
          const asset = bundle?.[assetName];
          if (asset?.type !== 'chunk') throw new Error('Sandbox entry chunk missing from build output.');
          // Safari treats the sandboxed document as an opaque origin. An exact
          // CSP hash permits this external module without admitting another host.
          const integrity = 'sha384-' + createHash('sha384').update(asset.code).digest('base64');
          if (!html.includes(`'${integrity}'`)) {
            throw new Error(`The sandbox module changed. Review it, then update the script-src hash in client/sandbox/index.html and vercel.json to ${integrity}.`);
          }
          return html.replace(script, script.replace('<script ', `<script integrity="${integrity}" `));
        },
      },
    },
  ],
  define: {
    'process.env.NODE_ENV': '"development"',
  },
  build: {
    target: 'es2020',
    sourcemap: 'hidden',
    outDir: path.resolve(__dirname, 'dist/sandbox'),
    // The app build runs first and owns dist/; this one only adds to it.
    emptyOutDir: false,
    // Everything the frame loads sits under /sandbox/, which vercel.json
    // already serves with the frame's own CSP and Access-Control-Allow-Origin
    // (the frame has an opaque origin, so its module script is a CORS load).
    assetsDir: 'assets',
    rollupOptions: {
      input: path.resolve(__dirname, 'sandbox/index.html'),
    },
  },
});
