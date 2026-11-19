// Sealed Learn sessions are shared by issuance, answers, status and completion.
import type { VercelResponse } from '../vercel-types.js';
import { logEvent, supabase, PROGRESS_TABLE } from './runtime';
import { jsonError, withTimeout, lazyExport } from '../http';
import { decodeSessionEnvelope } from '../quiz-tokens';
import { isDeploymentTopic } from '../product-scope';
import { subjectForTopic } from '../../shared/subject-catalog';
import { isRoadmapTopic, LEVEL_PASS, PART_TEST_PASS } from '../roadmap';
import { stepAlreadyPassed, type ProgressStep, type VerifiedProgress } from '../../shared/progression';
import type { GatedContent } from '../../shared/tiers';

// The tier check reads an index over the coding catalogue (lib/access.ts).
export const refuseLocked = lazyExport(() => import('../access'), 'refuseLocked');

export function roadmapSession(raw: unknown) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 16_384) return null;
  const session = decodeSessionEnvelope(raw);
  if (
    !session || session.scope !== 'roadmap' || !session.subject || !session.topic ||
    !session.roadmapKind || !session.ref || !session.attemptId ||
    !isRoadmapTopic(session.topic) || !isDeploymentTopic(session.topic) ||
    subjectForTopic(session.topic) !== session.subject
  ) return null;
  return session;
}

/** The attempt row of a session, inserted when no answer opened it yet.
 * `refused`, when given, is a tier gate that runs at the same time: the read
 * goes ahead, but nothing is inserted until the gate let the session through,
 * and nothing at all when it refused it. `minted` says the attempt id was
 * generated for this request, so there is no row to read before the insert. */
export async function ensureAttempt(
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  userId: string | null,
  refused?: Promise<boolean>,
  { minted = false }: { minted?: boolean } = {},
) {
  const existing = minted
    ? { data: null, error: null }
    : await withTimeout(
      supabase!
        .from('roadmap_attempts')
        .select('attempt_id,user_id,subject,topic,kind,ref,total_questions,pass_pct,required_level_start,required_level_end,completed_at')
        .eq('attempt_id', session.attemptId!)
        .maybeSingle(),
    );
  if (existing.error) return { error: existing.error, data: null };
  if (!existing.data && refused && (await refused)) return existing;
  if (!existing.data) {
    const passPct = session.roadmapKind === 'level' ? LEVEL_PASS : PART_TEST_PASS;
    const inserted = await withTimeout(
      supabase!
        .from('roadmap_attempts')
        .insert({
          attempt_id: session.attemptId,
          user_id: userId,
          subject: session.subject,
          topic: session.topic,
          kind: session.roadmapKind,
          ref: session.ref,
          total_questions: session.questions.length,
          pass_pct: passPct,
          required_level_start: session.requiredLevelStart ?? null,
          required_level_end: session.requiredLevelEnd ?? null,
          coding_task_ids: session.codingTaskIds ?? null,
          expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        })
        .select('attempt_id,user_id,subject,topic,kind,ref,total_questions,pass_pct,required_level_start,required_level_end,completed_at')
        .single(),
    );
    if (!inserted.error) return inserted;
    // A simultaneous first answer can win the insert. Re-read the row and
    // verify it below instead of turning a harmless race into a failed lesson.
    const raced = await withTimeout(
      supabase!
        .from('roadmap_attempts')
        .select('attempt_id,user_id,subject,topic,kind,ref,total_questions,pass_pct,required_level_start,required_level_end,completed_at')
        .eq('attempt_id', session.attemptId!)
        .maybeSingle(),
    );
    return raced;
  }
  return existing;
}

export function attemptMatches(
  attempt: Record<string, unknown>,
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  userId: string | null,
): boolean {
  return (
    (attempt.user_id ?? null) === userId &&
    attempt.subject === session.subject &&
    attempt.topic === session.topic &&
    attempt.kind === session.roadmapKind &&
    Number(attempt.ref) === session.ref &&
    Number(attempt.total_questions) === session.questions.length
    && (attempt.required_level_start == null ? undefined : Number(attempt.required_level_start)) === session.requiredLevelStart
    && (attempt.required_level_end == null ? undefined : Number(attempt.required_level_end)) === session.requiredLevelEnd
  );
}

/** What a sealed Learn session starts, for the tier gate: a level, or the
 * part test a checkpoint session stands for. */
function sessionContent(session: NonNullable<ReturnType<typeof roadmapSession>>): { content: GatedContent; step: ProgressStep } {
  return session.roadmapKind === 'level'
    ? { content: { kind: 'learn-level', topic: session.topic!, level: session.ref! }, step: { kind: 'level', level: session.ref! } }
    : { content: { kind: 'learn-part-test', topic: session.topic!, part: session.ref! }, step: { kind: 'checkpoint', checkpoint: session.ref! } };
}

/** The tier gate for answering and completing a Learn session. The seal
 * already refused locked content when the session was issued; this catches a
 * session issued while the account was Premium and used after it lapsed. A
 * step the learner already passed stays open for review. */
export async function refuseLockedSession(
  res: VercelResponse,
  userId: string | null,
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  /** For an answer: a Premium tier this instance read in the last minute
   * stands (lib/access.ts, #587 server item 6). A completion asks again. */
  recentPremium = false,
): Promise<boolean> {
  const { content, step } = sessionContent(session);
  return refuseLocked(res, userId, content, {
    recentPremium,
    cleared: async () => {
      if (!userId || !supabase) return false;
      const row = await withTimeout(supabase.from(PROGRESS_TABLE).select('data').eq('user_id', userId).maybeSingle());
      // A failed read is not "never passed": refuseLocked answers it with 503
      // entitlement_unavailable, not the upgrade sheet for a passed level.
      if (row.error) throw new Error(`progress_unavailable: ${row.error.message}`);
      return stepAlreadyPassed((row.data?.data as VerifiedProgress) ?? {}, session.topic!, step);
    },
  });
}

/** A Learn session answers only to the account it was issued to. The
 * progression guard runs when a step is issued, and only for a signed-in
 * request, so a session fetched without a token (or under another account)
 * must not be answered or completed with one: that would record a level the
 * guard never checked. Signing in or out mid-level lands here too; the client
 * restarts the step under the current sign-in. A session sealed before the
 * owner was recorded reads as a guest's. */
export function refuseForeignSession(
  res: VercelResponse,
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  userId: string | null,
): boolean {
  if ((session.userId ?? null) === userId) return false;
  logEvent({ status: 409, kind: 'session_owner_mismatch', topic: session.topic, hasUser: Boolean(userId) });
  jsonError(res, 409, 'session_owner_mismatch', 'This lesson was opened under a different sign-in. Start it again.');
  return true;
}
