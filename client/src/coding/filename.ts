import { evolvingStage } from '../../../shared/evolving';
import type { PlayableCodingTask } from '../../../shared/coding-catalog';

/** A display filename, independent of the runner's actual virtual module path. */
export function codingFilename(task: Pick<PlayableCodingTask, 'id' | 'title' | 'track'>): string {
  const stage = evolvingStage(task.id);
  const title = stage?.challenge.title ?? task.title;
  const words = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[A-Za-z0-9]+/g) ?? ['challenge'];
  const name = words.map(word => word === word.toUpperCase() ? word.toLowerCase() : word).map((word, index) => index === 0 ? word[0].toLowerCase() + word.slice(1) : word[0].toUpperCase() + word.slice(1)).join('');
  const safe = /^\d/.test(name) ? `challenge${name}` : name;
  return `${safe}${stage ? stage.index + 1 : ''}.${task.track === 'typescript' ? 'ts' : 'js'}`;
}
