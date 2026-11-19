// Keep a viewport's routes together so each worker owns one independent CDP
// session. This same partition is printed by the CLI before any browser starts.
export function viewportShards(viewports, workers) {
  const shards = Array.from({ length: Math.min(workers, viewports.length) }, (_, index) => ({ worker: index + 1, viewports: [] }));
  viewports.forEach((viewport, index) => shards[index % shards.length].viewports.push(viewport));
  return shards;
}

const message = (error) => error instanceof Error ? error.message : String(error);
const aborted = () => new Error('Responsive sweep aborted');

// Dependencies are supplied by the real CLI, and by fixtures which exercise
// renderer restarts and signals without a browser. A failed route always has a
// result; one failed worker cannot turn the other worker's coverage into a gap.
export async function runViewportWorkers({ routes, viewports, workers, openSession, reference, probe, onResult, onRestart, signal }) {
  const sessions = new Set();
  const rows = [];
  const cleanupErrors = [];
  const release = (session) => {
    if (!sessions.delete(session)) return;
    try { session.close(); }
    catch (error) { cleanupErrors.push(message(error)); }
  };
  const closeAll = () => { for (const session of sessions) release(session); };
  signal?.addEventListener('abort', closeAll, { once: true });
  try {
    await Promise.all(viewportShards(viewports, workers).map(async ({ worker, viewports: assigned }) => {
      let session;
      let heading;
      const close = () => { if (session) release(session); session = undefined; };
      try {
        for (const viewport of assigned) {
          for (const route of routes) {
            const row = { route, viewport, worker };
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                if (signal?.aborted) throw aborted();
                if (!session) {
                  const opened = await openSession(worker, signal);
                  sessions.add(opened);
                  session = opened;
                  if (signal?.aborted) throw aborted();
                  heading = await reference(session, viewport);
                }
                row.result = await probe(session, route, viewport, heading);
                if (signal?.aborted) throw aborted();
                break;
              } catch (error) {
                close();
                if (signal?.aborted || attempt === 1) {
                  row.error = message(signal?.aborted ? aborted() : error);
                  break;
                }
                try { onRestart?.({ worker, route, viewport, error }); }
                catch (error) { row.error = `Restart reporting failed: ${message(error)}`; break; }
              }
            }
            rows.push(row);
            try { await onResult?.(row, session); }
            catch (error) { row.error = [row.error, `Result artifact failed: ${message(error)}`].filter(Boolean).join('; '); }
          }
        }
      } finally { close(); }
    }));
    if (cleanupErrors.length && rows.length) rows[0].error = [rows[0].error, `Browser cleanup failed: ${cleanupErrors.join('; ')}`].filter(Boolean).join('; ');
    return rows.sort((left, right) => viewports.indexOf(left.viewport) - viewports.indexOf(right.viewport) || routes.indexOf(left.route) - routes.indexOf(right.route));
  } finally {
    signal?.removeEventListener('abort', closeAll);
    closeAll();
  }
}
