// The QuickJS grader's worker thread. `npm run build:react-runner` bundles
// this file, QuickJS included, into lib/coding/generated/quickjs-sandbox.cjs;
// lib/coding/sandbox.ts starts it and stops it when a run overstays its
// deadline. One run at a time: it says when it starts, then answers.
import { parentPort } from 'node:worker_threads';
import { runInQuickJS, type SandboxInput } from '../lib/coding/sandbox';

const port = parentPort;
if (!port) throw new Error('sandbox-worker-entry runs as a worker thread');

port.on('message', (message: { type?: unknown; input?: SandboxInput }) => {
  if (message?.type !== 'run' || !message.input) return;
  port.postMessage({ type: 'start' });
  let healthy = true;
  runInQuickJS(message.input, () => { healthy = false; }).then(
    (result) => port.postMessage({ type: 'done', result, healthy }),
    (error: unknown) => port.postMessage({ type: 'fail', message: String((error as Error)?.message ?? error) }),
  );
});
