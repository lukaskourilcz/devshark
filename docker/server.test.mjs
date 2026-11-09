import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

async function startAdapter(t) {
  const scratch = await mkdtemp(join(tmpdir(), 'devshark-docker-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const handlers = join(scratch, 'docker/dist/api');
  await Promise.all([
    mkdir(join(scratch, 'client/dist'), { recursive: true }),
    mkdir(handlers, { recursive: true }),
  ]);
  await Promise.all([
    ...['docker/server.mjs', 'package.json', 'vercel.json'].map((file) =>
      copyFile(join(root, file), join(scratch, file))),
    writeFile(join(handlers, 'manifest.json'), '["probe.cjs"]'),
    build({
      stdin: {
        contents: `
          import { checkRateLimit } from './lib/rate-limit.ts';
          export default (req, res) => {
            if (req.method === 'POST') return res.json({ size: req.body.length });
            if (checkRateLimit(req, res, { key: 'fixture', capacity: 2, refillPerSecond: 1 / 3600 })) {
              res.json({ ok: true });
            }
          };
        `,
        resolveDir: root,
      },
      platform: 'node',
      format: 'cjs',
      bundle: true,
      packages: 'external',
      outfile: join(handlers, 'probe.cjs'),
    }),
  ]);

  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));

  const server = spawn(process.execPath, ['docker/server.mjs'], {
    cwd: scratch,
    env: { NODE_PATH: join(root, 'node_modules'), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: server.stdout });
  const closed = once(server, 'close');
  t.after(async () => {
    lines.close();
    server.kill();
    await closed;
  });
  await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(5_000) }),
    closed.then(([code]) => { throw new Error(`Docker adapter exited with code ${code}`); }),
  ]);
  return `http://127.0.0.1:${port}/api/probe`;
}

test('Docker API uses the peer address even when a client spoofs proxy headers', async (t) => {
  const url = await startAdapter(t);
  const statuses = [];
  for (const headers of [
    { 'x-forwarded-for': '192.0.2.1' },
    { 'x-forwarded-for': '192.0.2.1' },
    { 'x-forwarded-for': '192.0.2.1' },
    { 'x-forwarded-for': '192.0.2.2' },
    { 'x-real-ip': '192.0.2.3' },
    {},
  ]) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    statuses.push(response.status);
    await response.arrayBuffer();
  }
  assert.deepEqual(statuses, [200, 200, 429, 429, 429, 429]);
});

test('Docker API answers 413 as soon as a body crosses the limit', async (t) => {
  const url = await startAdapter(t);
  const limit = 4.5 * 1024 * 1024;
  const atLimit = await fetch(url, {
    method: 'POST',
    body: Buffer.alloc(limit),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(atLimit.status, 200);
  assert.deepEqual(await atLimit.json(), { size: limit });

  const oversized = Buffer.alloc(limit + 1);
  const knownLength = await fetch(url, {
    method: 'POST',
    body: oversized,
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(knownLength.status, 413);
  assert.equal(knownLength.headers.get('connection'), 'close');
  await knownLength.arrayBuffer();

  // Leave the chunked request open: the server must answer without waiting
  // for the sender to finish an oversized body.
  const chunked = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', signal: AbortSignal.timeout(5_000) }, (res) => {
      res.once('end', () => resolve([res.statusCode, res.headers.connection]));
      res.once('error', reject);
      res.resume();
    });
    req.once('error', reject);
    req.write(oversized);
  });
  assert.deepEqual(chunked, [413, 'close']);
});
