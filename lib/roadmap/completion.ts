// Learn completion settles its review state, credits and repeat XP.
import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import { logEvent, supabase, optionalAuthSub, PROGRESS_TABLE } from './runtime';
import { roadmapSession, ensureAttempt, attemptMatches, refuseLockedSession, refuseForeignSession } from './session';
import { sanitize } from './progress-state';
import { jsonError, withTimeout, isRpcMissing, lazyExport } from '../http';
import { enforceClassRateLimit, RATE_LIMITS } from '../rate-limit';
import { getEffectiveQuestionsById } from '../questions-store';
import { roadmapEndedOnHearts } from '../../shared/assessment';
import { getGameSettings } from '../settings-store';
import { isScopeSubject } from '../../shared/subject-catalog';
import { contentVersion } from '../curation';
import { loadReviewStates, recordConceptReviews } from '../concept-review';
import { conceptOf } from '../../shared/concepts';
import { creditLearnPass, settleMilestonesAfterPass } from '../rewards/coins';
import { creditReferral } from '../rewards/referral';
import { learnRepeatXpOf, type LearnRepeatXp } from '../../shared/repeat-xp';

const resolveTier = lazyExport(() => import('../access'), 'resolveTier');

/** Whether a verified progress blob records this session's level or part test
 * as passed. */
function progressStepPassed(data: unknown, session: NonNullable<ReturnType<typeof roadmapSession>>): boolean {
  const topic = (data as Record<string, { levels?: Record<string, { passed?: unknown }>; checkpoints?: Record<string, { passed?: unknown }> }> | null)?.[session.topic ?? ''];
  const steps = session.roadmapKind === 'level' ? topic?.levels : topic?.checkpoints;
  return steps?.[String(session.ref)]?.passed === true;
}

/** The account's verified progress row. */
function stepRow(userId: string) {
  return withTimeout(supabase!.from(PROGRESS_TABLE).select('data').eq('user_id', userId).maybeSingle());
}

/** The same question asked of the stored progress, or null when it cannot be
 * read (then nothing is credited: a missed credit beats paying twice for a
 * level passed before coins existed). */
async function stepPassed(userId: string, session: NonNullable<ReturnType<typeof roadmapSession>>): Promise<boolean | null> {
  if (!supabase) return null;
  const row = await stepRow(userId).catch(() => null);
  if (!row || row.error) return null;
  return progressStepPassed(row.data?.data, session);
}

export async function handleComplete(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.roadmapCompleteAddress, RATE_LIMITS.roadmapComplete))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning progress is not configured');
  const body = (req.body || {}) as { sessionId?: unknown };
  const session = roadmapSession(body.sessionId);
  if (!session) return jsonError(res, 400, 'invalid_session', 'Learning session expired or invalid');
  const userId = await optionalAuthSub(req, res);
  if (userId === undefined) return;
  if (refuseForeignSession(res, session, userId)) return;
  // The attempt row, the served question set, the graded answers and, on a
  // code level, the coding rows are independent reads, so they run together
  // once the session's owner is confirmed, and with the tier gate (#587,
  // server item 5: the gate and the coding rows were two more waves). The
  // gate still decides first: an attempt no answer opened is inserted only
  // after it let the session through, and a refused session writes nothing.
  // The answers are used only after the attempt is shown to be this
  // session's, and only when none of its questions was retired.
  const codingUnverified = !userId && (session.codingTaskIds?.length ?? 0) > 0;
  const readsCoding = !codingUnverified && (session.codingTaskIds?.length ?? 0) > 0;
  const locked = refuseLockedSession(res, userId, session);
  // A completion that is recorded settles the milestones, whose every credit
  // sits inside IF is_premium (migration 052): for a Premium account only
  // (#587, server item 8). The plan is read with the first reads (remembered
  // for the request, so a Premium step's gate reads the same answer), and a
  // plan that cannot be read settles: the routine decides.
  const premium = userId ? resolveTier(userId).then((tier) => tier === 'premium') : null;
  premium?.catch(() => {});
  const reads = Promise.all([
    ensureAttempt(session, userId, locked),
    getEffectiveQuestionsById(session.subject),
    withTimeout(
      supabase
        .from('roadmap_attempt_answers')
        .select('question_id,is_correct')
        .eq('attempt_id', session.attemptId!),
    ),
    // Needed only when the questions passed. A failure is kept, and answered
    // below only if they did, as when the rows were read after the grade.
    readsCoding
      ? withTimeout(
        supabase.from('roadmap_attempt_coding').select('task_id,passed,verified,revealed').eq('attempt_id', session.attemptId!),
      ).then((read) => ({ read }), (thrown: unknown) => ({ thrown }))
      : null,
  ]);
  // Read below; a gate that refuses leaves it unread.
  reads.catch(() => {});
  if (await locked) return;
  const [attemptResult, served, answers, codingRead] = await reads;
  if (attemptResult.error || !attemptResult.data) {
    if (isRpcMissing(attemptResult.error)) {
      return jsonError(res, 503, 'migration_required', 'Verified learning migration is not installed');
    }
    return jsonError(res, 500, 'db_error', 'Could not load the learning attempt');
  }
  const attempt = attemptResult.data as Record<string, unknown>;
  if (!attemptMatches(attempt, session, userId)) {
    return jsonError(res, 409, 'attempt_conflict', 'This learning attempt belongs to another session');
  }

  // A question retired while this attempt was open. The verified completion
  // routine grades every sealed question and cannot void one, so the attempt
  // is closed without a verdict instead: nothing is written to the learner's
  // progress, no pass is granted on a flawed item and no fail is recorded for
  // one. The client offers the level again with its current questions.
  const retired = session.questions.filter((q) => !served.has(q.questionId)).map((q) => q.questionId);
  if (retired.length > 0) {
    if (!attempt.completed_at) {
      const closed = await withTimeout(
        supabase
          .from('roadmap_attempts')
          .update({ completed_at: new Date().toISOString(), passed: false })
          .eq('attempt_id', session.attemptId!)
          .is('completed_at', null),
      );
      if (closed.error) return jsonError(res, 500, 'db_error', 'Could not close the learning attempt');
    }
    logEvent({ status: 200, kind: 'invalidated', topic: session.topic, retired: retired.length });
    return res.json({
      correctAnswers: 0,
      totalQuestions: session.questions.length,
      percentage: 0,
      passed: false,
      applied: false,
      codingPending: [],
      invalidated: { reason: 'content_retired', questionIds: retired },
    });
  }
  if (answers.error) return jsonError(res, 500, 'db_error', 'Could not grade the learning attempt');
  const graded = answers.data ?? [];
  const correctAnswers = graded.filter((answer) => answer.is_correct === true).length;
  const totalQuestions = session.questions.length;
  const percentage = Math.round((correctAnswers / totalQuestions) * 100);
  const passPct = Number(attempt.pass_pct);
  let passed = percentage >= passPct;
  // A level ends the moment the learner spends their last heart, which normally
  // leaves the remaining questions unanswered. That lesson is over and failed:
  // the verified RPC only completes a full answer set, so this attempt is closed
  // here instead — otherwise the learner is stuck on an error they cannot clear.
  // The unanswered questions still count against the percentage.
  const endedOnHearts = roadmapEndedOnHearts(
    session.roadmapKind,
    graded.length,
    graded.filter((answer) => answer.is_correct === false).length,
    totalQuestions,
  );
  if (endedOnHearts) passed = false;
  // A level with coding tasks passes only when every one of them passed in
  // this attempt without its solution being revealed, the rule
  // complete_verified_roadmap_attempt applies from migration 047: a reveal
  // ends the attempt, and the task is passed again in a fresh one.
  //
  // A guest's coding passes are never stored, so for a guest that rule could
  // only ever fail the level. A guest's level passes on its questions and the
  // response says the coding was not verified; nothing is recorded for a
  // guest here, and the browser keeps the pass locally until they sign in.
  let codingPending: string[] = [];
  if (passed && session.codingTaskIds && codingRead) {
    if ('thrown' in codingRead) throw codingRead.thrown;
    const codingRows = codingRead.read;
    if (codingRows.error) return jsonError(res, 500, 'db_error', 'Could not grade the coding tasks');
    const passedIds = new Set((codingRows.data ?? [])
      .filter((row) => row.passed === true && row.verified === true && row.revealed !== true)
      .map((row) => String(row.task_id)));
    codingPending = session.codingTaskIds.filter((id) => !passedIds.has(id));
    if (codingPending.length > 0) passed = false;
    const revealed = (codingRows.data ?? []).some(row => session.codingTaskIds!.includes(String(row.task_id)) && row.revealed === true);
    if (codingPending.length > 0 && !revealed && graded.length === totalQuestions && !attempt.completed_at) {
      return res.json({ correctAnswers, totalQuestions, percentage, passed: false, applied: false, waiting: true, codingPending });
    }
  }

  // The concept items this attempt graded, and the learner's review state
  // for them. The state is read while the completion runs: the completion
  // never writes it, and the review is recorded from it at the end.
  const reviewSubject = userId && isScopeSubject(session.subject) ? session.subject : null;
  const reviewItems = reviewSubject
    ? graded.flatMap((answer) => {
      const question = served.get(String(answer.question_id));
      if (!question) return [];
      return [{
        itemId: question.id,
        itemVersion: contentVersion(question),
        category: question.category,
        tags: question.tags,
        correct: answer.is_correct === true,
        kind: 'independent' as const,
      }];
    })
    : [];
  // Most items name no concept, and an attempt whose items name none has
  // nothing to record, so its state is not read at all.
  const reviewStates = userId && reviewSubject && reviewItems.some((item) => conceptOf(item) !== null)
    ? loadReviewStates(supabase, userId, reviewSubject)
    : null;
  // Concept-level review state, from the answers the server itself graded.
  //
  // Levels are where a devShark learner spends most of their time, so leaving
  // this out left spaced practice inert for them: nothing was ever due, and
  // Review had nothing to offer. Recorded here rather than per answer because
  // the interval belongs to the concept and a level asking `reduce` three times
  // is one review of `reduce`, not three; the attempt id makes it idempotent,
  // so a retried completion reports the stored state and changes nothing.
  //
  // Every answer counts as independent retrieval: a level has no hint
  // affordance, so unlike a quiz there is nothing to downgrade. Questions left
  // unanswered when the hearts ran out are simply absent from the graded rows
  // and are not recorded as failures — they were not attempted.
  //
  // Started once the attempt is closed, beside what else follows the close
  // (#587, server item 5), and awaited before the answer, since a function
  // can be frozen the moment it responds.
  let reviewsRecorded: Promise<void> | null = null;
  const recordReviews = (): Promise<void> => {
    reviewsRecorded ??= userId && reviewSubject && reviewStates
      ? reviewStates.then((states) => recordConceptReviews(
        supabase,
        { userId, subject: reviewSubject, eventId: session.attemptId!, items: reviewItems },
        states,
      ))
      : Promise.resolve();
    // Awaited below; this keeps a failure of the request meanwhile from
    // leaving it unhandled.
    reviewsRecorded.catch(() => {});
    return reviewsRecorded;
  };

  let progress: unknown;
  let applied = false;
  let repeatXp: LearnRepeatXp | null = null;
  if (endedOnHearts) {
    const close = userId && !attempt.completed_at
      ? await withTimeout(supabase.rpc('complete_roadmap_attempt_on_hearts', {
        p_user_id: userId,
        p_attempt_id: session.attemptId,
      }))
      : null;
    if (userId && close && close.error?.code !== 'PGRST202') {
      if (/invalid_roadmap_attempt/i.test(close.error?.message ?? '')) {
        return jsonError(res, 409, 'invalid_session', 'This learning attempt expired. Start the lesson again.');
      }
      if (/incomplete_roadmap_attempt/i.test(close.error?.message ?? '')) {
        return jsonError(res, 409, 'incomplete_attempt', 'The learning attempt changed. Try completing it again.');
      }
      if (close.error) return jsonError(res, 503, 'progress_unavailable', 'Could not close the learning attempt. Try again.');
      applied = close.data === true;
      recordReviews();
      if (applied) await settleMilestonesAfterPass(supabase, userId, session.subject!, () => premium!);
    } else if (!attempt.completed_at) {
      // Guests and deployments before migration 076 use the original close.
      const closed = await withTimeout(
        supabase
          .from('roadmap_attempts')
          .update({ completed_at: new Date().toISOString(), score_pct: percentage, passed: false })
          .eq('attempt_id', session.attemptId!),
      );
      if (closed.error) return jsonError(res, 500, 'db_error', 'Could not close the learning attempt');
      applied = true;
      recordReviews();
      // A Learn level counts for the streak whether it was passed, failed or
      // lost on hearts. complete_verified_roadmap_attempt advances the streak
      // for the other two; this attempt closes without it, so the day is
      // counted here, once, by the request that closed it. Before migration
      // 048 the routine does not exist and the level simply does not count.
      if (userId) {
        const streak = await withTimeout(supabase.rpc('advance_verified_streak', { p_user_id: userId })).catch(() => null);
        if (!streak || streak.error) {
          if (!isRpcMissing(streak?.error)) {
            logEvent({ status: 500, kind: 'streak_failed', reason: streak?.error?.code ?? 'timeout' });
          }
        } else {
          await settleMilestonesAfterPass(supabase, userId, session.subject!, () => premium!);
        }
      }
    }
  } else if (userId) {
    // Only a first pass earns a step's learning XP, so only a first pass
    // credits coins (#227). From migration 060 the completion says whether
    // it was the step's first pass, read under the progress lock it holds
    // while recording it; before 060 the record is read here, before the
    // completion writes the pass.
    const completion = {
      p_user_id: userId,
      p_attempt_id: session.attemptId,
      p_coding_task_ids: session.codingTaskIds ?? null,
    };
    // From migration 060 the completion also pays a replayed step its XP
    // again, an hour after the step last paid (owner decision of 9 Oct
    // 2026), and says so. Before 060 the completion of 056 answers alone.
    const { coins: coinSettings } = await getGameSettings();
    let completed = await withTimeout(supabase.rpc('complete_verified_roadmap_attempt_v3', {
      ...completion,
      p_coin_rate: coinSettings.xpRate,
      p_coin_multiplier: coinSettings.premiumMultiplier,
      p_coin_daily_cap: coinSettings.dailyXpCap,
    }));
    // Only a missing entrypoint permits the non-atomic compatibility path.
    const legacyCompletion = completed.error?.code === 'PGRST202';
    let passedBefore: boolean | null = null;
    if (legacyCompletion) {
      completed = await withTimeout(supabase.rpc('complete_verified_roadmap_attempt_v2', completion));
      if (completed.error?.code === 'PGRST202') {
        if (passed) passedBefore = await stepPassed(userId, session);
        completed = await withTimeout(supabase.rpc('complete_verified_roadmap_attempt', completion));
      }
    }
    if (completed.error) {
      if (completed.error.code === 'PGRST202') {
        return jsonError(res, 503, 'migration_required', 'Verified learning migration is not installed');
      }
      if (/incomplete_roadmap_attempt/i.test(completed.error.message ?? '')) {
        return jsonError(res, 409, 'incomplete_attempt', 'Answer every question before completing this lesson');
      }
      if (/roadmap_prerequisite_not_met/i.test(completed.error.message ?? '')) {
        return jsonError(res, 409, 'prerequisite_not_met', 'Complete the preceding learning steps first');
      }
      // The routine refuses an attempt that ran past its two hours (the
      // owner was checked above), which the learner fixes by starting the
      // level again, as the attempt-status check tells them.
      if (/invalid_roadmap_attempt/i.test(completed.error.message ?? '')) {
        return jsonError(res, 409, 'invalid_session', 'This learning attempt expired. Start the lesson again.');
      }
      return jsonError(res, 503, 'progress_unavailable', 'Could not save learning progress. Try again.');
    }
    const outcome = completed.data as { applied?: unknown; repeatXp?: unknown; firstPass?: unknown } | boolean | null;
    applied = typeof outcome === 'object' && outcome !== null ? outcome.applied === true : outcome === true;
    // XP only: a repeat credits no coins and is no first pass.
    repeatXp = typeof outcome === 'object' && outcome !== null ? learnRepeatXpOf(outcome.repeatXp) : null;
    const firstPass = typeof outcome === 'object' && outcome !== null ? outcome.firstPass === true : passedBefore === false;
    // What follows a recorded completion ran one call after another: the
    // reload, the coin credit, the referral, the milestones and the concept
    // reviews (#587, server item 5). Only the reload feeds the answer, and
    // each routine is idempotent under its own event id, so they run as
    // three branches at once: the reload, then the first pass's referral
    // and, before 076, its coins. The milestone settlement and concept reviews
    // run beside the reload. The settlement and the
    // reviews read nothing the credits write that this answer reports.
    //
    // A completed level or part test is a streak day from migration 048, passed
    // or not, and the last level of a topic is a Premium milestone.
    const settled = applied ? settleMilestonesAfterPass(supabase, userId, session.subject!, () => premium!) : null;
    settled?.catch(() => {});
    recordReviews();
    const followers = () => Promise.allSettled([settled, reviewsRecorded]);
    let row: Awaited<ReturnType<typeof stepRow>>;
    try {
      row = await stepRow(userId);
    } catch (error) {
      await followers();
      throw error;
    }
    if (row.error) {
      await followers();
      return jsonError(res, 500, 'db_error', 'Progress saved but could not be reloaded');
    }
    progress = sanitize(row.data?.data);
    if (applied && firstPass && progressStepPassed(row.data?.data, session)) {
      const coins = legacyCompletion ? creditLearnPass(supabase, {
        userId,
        subject: session.subject!,
        topic: session.topic!,
        kind: session.roadmapKind!,
        ref: session.ref!,
      }) : null;
      coins?.catch(() => {});
      try {
        // A friend's first passed Learn level pays both sides of an invitation
        // once; the routine reads the verified progress itself (#228). It
        // runs while the coin credit does.
        await creditReferral(supabase, userId, session.subject!);
        await coins;
      } catch (error) {
        await followers();
        throw error;
      }
    }
    await settled;
  } else if (!attempt.completed_at) {
    const closed = await withTimeout(
      supabase.from('roadmap_attempts').update({ completed_at: new Date().toISOString() }).eq('attempt_id', session.attemptId!),
    );
    if (closed.error) return jsonError(res, 503, 'progress_unavailable', 'Could not close the learning attempt. Try again.');
    applied = true;
  }

  await recordReviews();

  logEvent({ status: 200, kind: 'complete', topic: session.topic, passed, hasUser: !!userId, codingPending: codingPending.length, codingUnverified, outOfHearts: endedOnHearts, repeatXp: repeatXp?.xp ?? null });
  return res.json({
    correctAnswers, totalQuestions, percentage, passed, applied, codingPending,
    ...(codingUnverified ? { codingUnverified: true } : {}),
    ...(progress ? { progress } : {}),
    ...(repeatXp ? { repeatXp } : {}),
  });
}
