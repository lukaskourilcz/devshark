// Trusted compiler thread. Learner source is syntax-converted, never evaluated.
import { parentPort } from 'node:worker_threads';
import { compileReactLearner } from '../lib/coding/react-transpile';
const port = parentPort;
if (!port) throw new Error('react-compile-worker-entry requires a worker thread');
port.on('message', (message: { type?: unknown; source?: unknown }) => {
  if (message?.type !== 'compile' || typeof message.source !== 'string') return;
  port.postMessage({ type: 'start' });
  try {
    const js = compileReactLearner(message.source);
    port.postMessage({ type: 'done', outcome: { js } });
  } catch (error) {
    if (error instanceof RangeError) port.postMessage({ type: 'done', outcome: { nested: true } });
    else port.postMessage({ type: 'fail' });
  }
});
