import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import {
  secureShuffle,
  weightedSample,
  PRIVATE_CATEGORIES,
  type DifficultyMode,
  type CategoryType,
  type Question,
} from '../../lib/quiz-runtime';
import { encodeSession, quizSessionExpiresAt } from '../../lib/quiz-tokens';
import { AuthError, confirmedEmail } from '../../lib/auth';
import { createServiceClient, jsonError, createLogger, withTimeout, withRequestContext, tryAuthOnce } from '../../lib/http';
import { getEffectiveQuestions } from '../../lib/questions-store';
import { getGameSettings } from '../../lib/settings-store';
import { enforceClassRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { SUBJECT_SCOPE_CATALOG } from '../../shared/subject-catalog';
import { defaultDeploymentCategories, validateCategoryScope } from '../../lib/product-scope';
import { selectPersonalizedReview, selectDueItems, DUE_SHARE } from '../../lib/review-selection';
import { curationCoverage, itemReview } from '../../lib/curation';
import { coverageClaim } from '../../shared/curation';
import { loadReviewStates, dueFor, practisedCounts } from '../../lib/concept-review';
import { conceptOf, conceptById } from '../../shared/concepts';
import { estimatedMinutes } from '../../shared/spaced-practice';
import { arrangePractice } from '../../shared/interleave';

const ALL_CATEGORIES = Object.values(SUBJECT_SCOPE_CATALOG)
  .flatMap((subject) => [...subject.categories]) as CategoryType[];
const ALL_DIFFICULTIES: DifficultyMode[] = ['basics', 'easy', 'zero-to-hero', 'advanced', 'mixed'];

const logEvent = createLogger('quiz/questions');
const supabase = createServiceClient();

/** A caller whose credentials did not verify. A refused token is 401, as
 * before; a sign-in service that is down or slow keeps its own 503 or 504,
 * because a 401 tells the client the session is over when it is not. */
function refuseCredentials(res: VercelResponse, error: unknown) {
  if (!(error instanceof AuthError)) throw error;
  if (error.status >= 500) return jsonError(res, error.status, error.code, error.message);
  return jsonError(res, 401, 'unauthorized', 'Invalid sign-in session');
}

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  const started = Date.now();
  const resource = typeof req.query.resource === 'string' ? req.query.resource : '';

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // Owner-controlled integration; its authored answers never reach quiz callers.
  if (resource === 'marketing-source') {
    const { handleMarketingSource } = await import('../../lib/marketing/source');
    return handleMarketingSource(req, res);
  }
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.quizSessionAddress, RATE_LIMITS.quizSession))) return;

  // How much of the deliverable pool has a current review record. Answered
  // before any quiz parameter is parsed, because it selects nothing and needs
  // no categories: it is the evidence the methodology page is allowed to cite,
  // and it is the only thing that decides which coverage sentence is shown.
  if (resource === 'curation') {
    const coverage = await curationCoverage();
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    logEvent({ status: 200, resource, claim: coverageClaim(coverage), latency_ms: Date.now() - started });
    return res.json({ coverage, claim: coverageClaim(coverage) });
  }

  const settings = await getGameSettings();
  const ownerEmail = settings.ownerEmail;

  const countParam = parseInt(req.query.count as string, 10);
  const count = Number.isFinite(countParam)
    ? Math.min(Math.max(countParam, 1), settings.quiz.maxCount)
    : settings.quiz.defaultCount;

  const difficultyRaw = (req.query.difficulty as string) || settings.quiz.defaultDifficulty;
  if (!ALL_DIFFICULTIES.includes(difficultyRaw as DifficultyMode)) {
    return jsonError(res, 400, 'bad_request', 'Invalid difficulty');
  }
  const difficultyMode = difficultyRaw as DifficultyMode;

  // A repeated parameter arrives as an array, which has no split(): read only
  // a single string, as the daily and Challenge handlers do.
  const categoriesParam = typeof req.query.categories === 'string' ? req.query.categories : '';
  const requested = categoriesParam ? categoriesParam.split(',') : defaultDeploymentCategories();
  let selectedCategories = requested.filter((c): c is CategoryType =>
    ALL_CATEGORIES.includes(c as CategoryType),
  );
  if (selectedCategories.length === 0) {
    return jsonError(res, 400, 'bad_request', 'Select at least one category');
  }
  const scope = validateCategoryScope(selectedCategories, { forDelivery: true });
  if (!scope.ok) {
    return jsonError(res, 400, 'invalid_subject_scope', 'Categories must belong to this deployment and one subject');
  }
  selectedCategories = scope.categories as CategoryType[];

  // What the learner owes, without selecting any of it. Answered here because
  // it needs the subject scope and nothing else: no question bank is loaded and
  // no session is issued, so Today can ask cheaply and often.
  if (resource === 'due') {
    res.setHeader('Cache-Control', 'private, no-store');
    let dueAuth;
    try {
      dueAuth = await tryAuthOnce(req);
    } catch (error) {
      return refuseCredentials(res, error);
    }
    // A signed-out visitor owes nothing, because nothing has been recorded for
    // them. That is an empty list, not an error.
    if (!dueAuth) return res.json({ due: [], estimatedMinutes: 0 });
    const states = await loadReviewStates(supabase, dueAuth.sub, scope.subject);
    if (states === null) return jsonError(res, 503, 'review_unavailable', 'Could not load your due reviews. Try again.');
    // Eligibility is the deployment scope the request already resolved: a
    // concept whose topic is not being served here is not due here.
    const servedTopics = new Set(selectedCategories as string[]);
    const due = dueFor(
      states,
      (conceptId) => {
        const concept = conceptById(conceptId);
        return concept !== null && servedTopics.has(concept.topic);
      },
      Date.now(),
    );
    logEvent({ status: 200, resource, count: due.length, latency_ms: Date.now() - started });
    return res.json({ due, estimatedMinutes: estimatedMinutes(due.length) });
  }

  // Private categories (custom, apt) are served only to the owner. Verifying
  // the token costs a round-trip, so only do it when one is actually requested.
  if (selectedCategories.some((c) => PRIVATE_CATEGORIES.includes(c))) {
    let auth;
    try {
      auth = await tryAuthOnce(req);
    } catch (error) {
      return refuseCredentials(res, error);
    }
    // Only a confirmed address is the owner's.
    const email = auth ? confirmedEmail(auth.payload)?.toLowerCase() ?? null : null;
    if (email !== ownerEmail) {
      selectedCategories = selectedCategories.filter((c) => !PRIVATE_CATEGORIES.includes(c));
      if (selectedCategories.length === 0) {
        return jsonError(res, 403, 'forbidden', 'Those categories are private');
      }
    }
  }

  const allQuestions = await getEffectiveQuestions(scope.subject);
  const categoryFiltered = allQuestions.filter((q) => selectedCategories.includes(q.category));
  if (categoryFiltered.length === 0) {
    return jsonError(res, 404, 'no_questions', 'No questions match those filters');
  }

  // Optionally drop low-importance questions entirely (owner-tunable floor), but
  // only when enough remain to still fill the quiz.
  const minImportance = settings.quiz.minImportance ?? 1;
  let pool = categoryFiltered;
  if (minImportance > 1) {
    const aboveFloor = categoryFiltered.filter((q) => (q.importance ?? 5) >= minImportance);
    if (aboveFloor.length >= count) pool = aboveFloor;
  }

  // Selection is importance-weighted so low-scoring "filler" questions surface
  // far less often than the essentials.
  const weight = (q: Question) => q.importance ?? 5;
  let selected: Question[];
  let reviewPlan: ReturnType<typeof selectPersonalizedReview>['weakAreas'] | undefined;
  // Only set when the arrangement actually contrasts related concepts, which
  // is the only case the learner is told anything about it.
  let mixed = false;
  let contrasted: string[] = [];
  let hardestAvailable = false;

  if (resource === 'review') {
    let auth;
    try {
      auth = await tryAuthOnce(req);
    } catch (error) {
      return refuseCredentials(res, error);
    }
    if (!auth) return jsonError(res, 401, 'unauthorized', 'Sign in to build a personalized review');
    if (!supabase) return jsonError(res, 503, 'not_configured', 'Personalized review is not configured');
    // The review states are read with the stats they are ranked beside; none
    // of the three reads depends on another.
    const [stats, history, states] = await Promise.all([
      withTimeout(
        supabase
          .from('user_category_stats')
          .select('category,total_correct,total_questions')
          .eq('user_id', auth.sub)
          .in('category', scope.categories),
      ),
      withTimeout(
        supabase
          .from('user_question_history')
          .select('question_id,category,times_seen,times_missed,last_seen_at,last_missed_at')
          .eq('user_id', auth.sub)
          .eq('subject', scope.subject)
          .order('last_missed_at', { ascending: false, nullsFirst: false })
          .limit(500),
      ),
      loadReviewStates(supabase, auth.sub, scope.subject).then((read) => read ?? []),
    ]);
    if (stats.error || history.error) {
      const migrationMissing = history.error?.message?.includes('user_question_history');
      return jsonError(
        res,
        migrationMissing ? 503 : 500,
        migrationMissing ? 'migration_required' : 'db_error',
        migrationMissing ? 'Run supabase/supabase-schema-022.sql to enable personalized review' : 'Could not build personalized review',
      );
    }
    // Two policies, kept apart on purpose. Spaced practice says which concepts
    // are *due*; the ranking below says which items serve them; interleaving
    // says what order they arrive in. None of them widens the pool: `pool` is
    // already scoped by the same eligibility and plan filters as everything
    // else, so review can never unlock a level or resurrect retired material.
    const poolConcepts = new Map(states.length > 0 ? pool.map((q) => [q.id, conceptOf(q)] as const) : []);
    const conceptForQuestion = (q: Question) => poolConcepts.get(q.id) ?? null;
    const servedConcepts = new Set(poolConcepts.values());
    const due = dueFor(states, (conceptId) => servedConcepts.has(conceptId), Date.now());
    const dueSet = new Set(due.map((one) => one.conceptId));
    // Prefer a *different* item for a due concept than the one last used, so a
    // review tests the objective rather than the memory of one question.
    const lastItems = new Set(due.map((one) => one.lastItemId).filter(Boolean) as string[]);
    const duePool = dueSet.size > 0
      ? pool.filter((q) => {
          const concept = conceptForQuestion(q);
          return concept !== null && dueSet.has(concept);
        })
      : [];
    // Reserved slots, not a preferred ordering. Handing a due-first list to the
    // ranking below does nothing: it re-sorts by its own total order, so the
    // ordering is discarded and a learner told two concepts were due gets a
    // session with neither in it. Taking the slots out of the count first is
    // the only arrangement the ranking cannot undo. One slot is always left
    // for the ranking, so a review is never only a drill.
    const dueLimit = Math.min(duePool.length, Math.max(0, Math.min(count - 1, Math.round(count * DUE_SHARE))));
    const dueItems = selectDueItems(duePool, due.map((one) => one.conceptId), conceptForQuestion, lastItems, dueLimit);
    const dueIds = new Set(dueItems.map((q) => q.id));

    const plan = selectPersonalizedReview(
      // With nothing due this is exactly the previous behaviour: the whole pool
      // and the whole count.
      dueIds.size > 0 ? pool.filter((q) => !dueIds.has(q.id)) : pool,
      stats.data ?? [],
      history.data ?? [],
      count - dueItems.length,
    );
    const questionsForSession = [...dueItems, ...plan.questions].slice(0, count);
    const arrangement = arrangePractice({
      items: questionsForSession.map((q) => ({ ...q, format: q.snippet?.subtype })),
      practised: practisedCounts(states),
      seed: questionsForSession.length,
    });
    selected = arrangement.items;
    reviewPlan = plan.weakAreas;
    mixed = arrangement.mixed;
    contrasted = arrangement.contrasted;
  } else if (resource) {
    return jsonError(res, 404, 'unknown_resource', 'Unknown quiz question resource');
  } else if (difficultyMode === 'easy') {
    selected = weightedSample(pool.filter((q) => q.difficulty <= 2), count, weight);
  } else if (difficultyMode === 'advanced') {
    const advanced = pool.filter((q) => q.difficulty >= 3);
    if (advanced.length > 0) {
      selected = weightedSample(advanced, count, weight);
    } else {
      // HTML, CSS and Algorithms have nothing above difficulty 2 yet. Refusing
      // left the learner with an error that Retry only repeated; serve the
      // hardest difficulty the selection has, and say so.
      const hardest = Math.max(...pool.map((q) => q.difficulty));
      selected = weightedSample(pool.filter((q) => q.difficulty === hardest), count, weight);
      hardestAvailable = true;
    }
  } else if (difficultyMode === 'basics') {
    const basics = pool.filter((q) => q.tags.includes('Terminology'));
    if (basics.length > 0) {
      selected = weightedSample(basics, count, weight);
    } else {
      const sorted = [...pool].sort((a, b) => a.difficulty - b.difficulty);
      const easiest = sorted[0]?.difficulty ?? 1;
      selected = weightedSample(sorted.filter((q) => q.difficulty === easiest), count, weight);
    }
  } else if (difficultyMode === 'mixed') {
    selected = weightedSample(pool, count, weight);
  } else {
    const perBucket = Math.ceil(count / 5);
    const buckets: Question[] = [];
    for (let d = 1; d <= 5; d++) {
      buckets.push(...weightedSample(pool.filter((q) => q.difficulty === d), perBucket, weight));
    }
    if (buckets.length < count) {
      const ids = new Set(buckets.map((q) => q.id));
      buckets.push(...weightedSample(pool.filter((q) => !ids.has(q.id)), count - buckets.length, weight));
    }
    selected = buckets.slice(0, count);
  }

  // A difficulty filter above (e.g. `easy` → difficulty ≤ 2) can empty the
  // pool even though the category had questions — a category with only hard
  // questions yields nothing for `easy`. Never hand the client a 200 with zero
  // questions (it renders a blank screen); surface it as "no questions match
  // those filters" instead.
  if (selected.length === 0) {
    logEvent({ status: 404, reason: 'empty_after_difficulty', difficulty: difficultyMode, latency_ms: Date.now() - started });
    return jsonError(res, 404, 'no_questions', 'No questions match those filters');
  }

  const sessionData: { questionId: string; correctAnswer: number }[] = [];
  const questionsWithShuffledOptions = selected.map((q) => {
    const correctText = q.options[q.correctAnswer];
    const shuffled = secureShuffle(q.options);
    sessionData.push({ questionId: q.id, correctAnswer: shuffled.indexOf(correctText) });
    return {
      id: q.id,
      // No tags before grading: some name the correct option.
      introduction: q.introduction,
      question: q.question,
      options: shuffled,
      category: q.category,
      difficulty: q.difficulty,
      // The version of this exact wording plus whatever review is recorded for
      // it. No scores, no reviewer, no report text — and never a hint at the
      // answer, since the version is a keyed digest.
      review: itemReview(q),
    };
  });

  const issuedAt = Date.now();
  const isReview = resource === 'review';
  const sessionId = encodeSession(sessionData, { scope: isReview ? 'review' : 'quiz', subject: scope.subject });

  // Per-request shuffle differs, so don't CDN-cache the response itself.
  res.setHeader('Cache-Control', 'private, no-store');
  logEvent({ status: 200, count: selected.length, difficulty: difficultyMode, latency_ms: Date.now() - started });

  res.json({
    sessionId,
    ...(isReview ? { expiresAt: quizSessionExpiresAt(issuedAt) } : {}),
    questions: questionsWithShuffledOptions,
    ...(reviewPlan ? { reviewPlan } : {}),
    ...(mixed ? { interleaved: { contrasted } } : {}),
    ...(hardestAvailable ? { hardestAvailable: true } : {}),
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}
