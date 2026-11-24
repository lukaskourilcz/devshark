// Response bodies for the responsive sweep (scripts/check-responsive.mjs),
// built from the same modules the handlers read, so a fixture cannot drift
// from what production sends. The sweep bundles this file with esbuild when
// it starts; nothing here touches a database or the network.
export { qotdTrack } from '../shared/daily-question';
import { ROADMAP_TOPICS, topicCheckpoints, topicLevels } from '../lib/roadmap';
import { CODING_TASKS, playable } from '../lib/coding/catalog';
import { LEARNING_PATHS, availabilityFor, inventoryFor, publicManifest } from '../lib/learning-paths/catalog';

/** GET /api/quiz/roadmap: every topic's levels and checkpoints, all open. */
export function roadmapStructure() {
  return {
    topics: ROADMAP_TOPICS,
    structure: Object.fromEntries(ROADMAP_TOPICS.map((topic) => [topic, { levels: topicLevels(topic), checkpoints: topicCheckpoints(topic) }])),
  };
}

/** GET /api/quiz/roadmap?resource=learning-path-catalog, for a deployment
 * whose paths are switched off, as the launched settings say. `enabled`
 * switches them on, for a spec of the open FDE path. */
export function pathCatalog({ enabled = false }: { enabled?: boolean } = {}) {
  return {
    paths: LEARNING_PATHS.map((path) => {
      const manifest = publicManifest(path);
      return { manifest, availability: availabilityFor({ path, enabled, storageInstalled: true }), inventory: inventoryFor(path.id) };
    }),
    versions: Object.fromEntries(LEARNING_PATHS.map((path) => [path.id, path.version])),
  };
}

/** GET /api/quiz/roadmap?resource=coding-task&id=<id>, to a visitor who is
 * not signed in; null for an id the catalog does not hold. */
export function codingTask(id: string) {
  const task = CODING_TASKS.find((one) => one.id === id);
  if (!task) return null;
  return { task: playable(task), session: task.id, locked: null, progress: null, draft: null, signedIn: false };
}

/** A task page's read by its resource: the combined `coding-task`, or the
 * brief (`coding-brief`) and the visitor's part (`coding-state`) a free task
 * reads apart (#587 C23); null for an id the catalog does not hold. */
export function codingTaskRead(resource: string, id: string) {
  const whole = codingTask(id);
  if (!whole) return null;
  const { puzzle, design, drill, ...task } = whole.task;
  if (resource === 'coding-brief') return { task, version: 'responsive-sweep' };
  if (resource === 'coding-state') {
    const { session, locked, progress, draft, signedIn } = whole;
    return { session, locked, progress, draft, draftUpdatedAt: null, signedIn, dealt: { ...(puzzle ? { puzzle } : {}), ...(design ? { design } : {}), ...(drill ? { drill } : {}) }, briefVersion: 'responsive-sweep' };
  }
  return resource === 'coding-task' ? whole : null;
}
