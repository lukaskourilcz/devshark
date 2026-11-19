import { ROADMAP_TOPICS, ROADMAP_LEVELS, CHECKPOINT_COUNT } from '../roadmap';

interface Entry {
  passed: boolean;
  bestPct: number;
  // Spaced mastery (migration 024), written by the completion routine on
  // levels only. Optional: older rows and part tests have none.
  passDays?: string[];
  mastered?: boolean;
  masteredAt?: string;
  lastPassDay?: string;
}
type TopicProgress = { levels: Record<string, Entry>; checkpoints: Record<string, Entry> };
export type ProgressBlob = Record<string, TopicProgress>;

const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** The completion routine keeps at most twelve distinct passing days. */
const MAX_PASS_DAYS = 12;

/** A level entry's spaced-mastery fields, validated. The client reads them for
 * the map's mastered/due states and Today's review list, so a response that
 * carries progress must keep them exactly as the GET does. */
function masteryFields(e: Record<string, unknown>): Pick<Entry, 'passDays' | 'mastered' | 'masteredAt' | 'lastPassDay'> {
  return {
    ...(Array.isArray(e.passDays) ? { passDays: e.passDays.filter(isDayKey).slice(0, MAX_PASS_DAYS) } : {}),
    ...(typeof e.mastered === 'boolean' ? { mastered: e.mastered } : {}),
    ...(isDayKey(e.masteredAt) ? { masteredAt: e.masteredAt } : {}),
    ...(isDayKey(e.lastPassDay) ? { lastPassDay: e.lastPassDay } : {}),
  };
}

const clampPct = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v < 0 ? 0 : v > 100 ? 100 : v;
};

// Rebuild a clean blob from untrusted input: only known topics, valid level /
// checkpoint numbers, and bounded values are kept. This bounds the stored size
// and shape regardless of what the client sends. Exported for tests.
export function sanitize(input: unknown): ProgressBlob {
  const out: ProgressBlob = {};
  if (!input || typeof input !== 'object') return out;
  const root = input as Record<string, unknown>;

  for (const topic of ROADMAP_TOPICS) {
    const t = root[topic];
    if (!t || typeof t !== 'object') continue;
    const levelsIn = (t as Record<string, unknown>).levels;
    const checkpointsIn = (t as Record<string, unknown>).checkpoints;
    const levels: Record<string, Entry> = {};
    const checkpoints: Record<string, Entry> = {};

    if (levelsIn && typeof levelsIn === 'object') {
      for (const [k, v] of Object.entries(levelsIn as Record<string, unknown>)) {
        const n = parseInt(k, 10);
        if (!Number.isInteger(n) || n < 1 || n > ROADMAP_LEVELS) continue;
        if (!v || typeof v !== 'object') continue;
        const e = v as Record<string, unknown>;
        levels[String(n)] = { passed: e.passed === true, bestPct: clampPct(e.bestPct), ...masteryFields(e) };
      }
    }
    if (checkpointsIn && typeof checkpointsIn === 'object') {
      for (const [k, v] of Object.entries(checkpointsIn as Record<string, unknown>)) {
        const n = parseInt(k, 10);
        if (!Number.isInteger(n) || n < 1 || n > CHECKPOINT_COUNT) continue;
        if (!v || typeof v !== 'object') continue;
        const e = v as Record<string, unknown>;
        checkpoints[String(n)] = { passed: e.passed === true, bestPct: clampPct(e.bestPct) };
      }
    }
    if (Object.keys(levels).length > 0 || Object.keys(checkpoints).length > 0) {
      out[topic] = { levels, checkpoints };
    }
  }
  return out;
}
