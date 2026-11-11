// First: clears the environment the handlers below read when imported.
import './launch-test-env';
import { createCodingSession as encodeCodingSession } from '../lib/coding/session';
import assert from 'node:assert/strict';
import { complexityContracts } from './coding-complexity-contract';
import { codingBoardContracts } from './coding-board-contract';
import { codingFetchContracts } from './coding-fetch-contract';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { constants as osConstants, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MERCH_SHOP,
  PRODUCT_CATALOG,
  SOCIAL_PROFILES,
  TRADER,
  resolveCatalogProductId,
} from '../client/product-catalog';
import {
  SUBJECT_SCOPE_CATALOG,
  allowedDeploymentSubjects,
  deliveryCategories,
  subjectForCategory,
  subjectForTopic,
} from '../shared/subject-catalog';
import {
  decodeChallengeRun,
  decodeQuizResultReceipt,
  decodeSession,
  encodeQuizResultReceipt,
  encodeSession,
  encodeScoreProof,
  createChallengeRun,
  stableAttemptId,
} from '../lib/quiz-tokens';
import { addressKey, checkRateLimit, enforcePerItemRateLimit, enterInFlight, isDistributedRateLimitEnabled, RATE_LIMITS, SHARED_NETWORK_SEATS } from '../lib/rate-limit';
import { buildQueue, handleCodingSkip, handlePracticeSession, nextAfterSkip, parseScheduledFor, skipPostpones } from '../lib/coding/practice-handlers';
import { forgetWalletSettlements, handleCosmetic, handlePaymentWebhook, handleWallet, referralFinal, webhookDecision } from '../lib/rewards/handlers';
import healthHandler from '../api/health';
import settingsHandler from '../api/settings';
import roadmapHandler from '../api/quiz/roadmap';
import { selectPersonalizedReview, selectDueItems, DUE_SHARE } from '../lib/review-selection';
import { defaultDeploymentCategories, validateCategoryScope } from '../lib/product-scope';
import { playable as playableCodingTask, CODING_TASKS } from '../lib/coding/catalog';
import { codingTaskById, levelCodingTasks } from '../lib/coding/active';
import { solutionFor } from '../lib/coding/solutions';
import { approachesFor } from '../lib/coding/approaches';
import { puzzleFor } from '../lib/coding/puzzles';
import { gradeDesign, prepareDesign, codeOutcome, giveUpAfter, ladderLength } from '../lib/coding/grade';
import { giveUpAfter as clientGiveUpAfter } from '../client/src/coding/hint-ladder';
import { runInSandbox, SANDBOX_WORKER_FILE } from '../lib/coding/sandbox';
import { TS_CHECK_WORKER_FILE } from '../lib/coding/ts-check-pool';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';
import { runReactSuite } from '../lib/coding/react-runner';
import { compileReactLearner } from '../lib/coding/react-transpile';
import { FETCH_STUB_SOURCE } from '../shared/coding-react-support';
import { LOCAL_FETCH_SOURCE } from '../shared/coding-fullstack-support';
import { splitHiddenCases, withHiddenCases } from '../lib/coding/react-hidden';
import { GUEST_CRASHED_MESSAGE, GUEST_ENV, GUEST_NODE_FLAGS, readGuestResult, readGuestRun, serializeGuestResult } from '../lib/coding/react-guest';
import { UTC_REACT_APP, UTC_REACT_SUITE } from './fixtures/utc-react';
import { decodeCodingSession, encodeCodingSession as encodeLegacyCodingSession, decodeGithubConnectState, encodeGithubConnectState } from '../lib/quiz-tokens';
import { decodeLearningPathSession, encodeLearningPathSession } from '../lib/quiz-tokens';
import { LEARNING_PATHS, publicManifest, pathEnabledInEnv, availabilityFor, pathById } from '../lib/learning-paths/catalog';
import { contentVersion, contentHash, taskHash, itemReview, codingTaskReview, codingTaskEligibility, questionEligibility, isAuditedCategory } from '../lib/curation';
import { AUDITED_CATEGORIES, CODING_TASKS_AUDITED, REVIEW_REGISTRY } from '../lib/curation-registry';
import { readLedger, registryFromLedger, renderCurationRegistry, REGISTRY_PATH } from './build-curation-registry';
import { webdevBankContracts } from './webdev-bank-contract';
import { vercelRoutingContracts } from './vercel-routing-contract';
import { learnLessonContracts } from './learn-lesson-contract';
import { codingBriefContracts } from './coding-brief-contract';
import { learnCodeTopicsContracts } from './learn-code-topics-contract';
import { dsaAdvancedContracts } from './dsa-advanced-contracts';
import { applyEligibility, getEffectiveQuestions, getEffectiveQuestionsById, getQuestionsForHistoryById } from '../lib/questions-store';
import { buildLiveTopic, liveAvailability, MIN_LEVEL_QUESTIONS, unavailablePartsOf, partRanges as roadmapPartRanges } from '../lib/roadmap';
import { isSegmentCleared, firstUnfinishedLevel, isCheckpointUnlocked, partRanges } from '../shared/progression';
import { eligibilityFrom, registryEntryConsistent, type RegistryEntry } from '../shared/curation';
import submitHandler from '../api/quiz/submit';
import dailyHandler from '../api/quiz/daily';
import questionsHandler from '../api/quiz/questions';
import challengeHandler from '../api/quiz/challenge';
import flashcardsHandler from '../api/flashcards';
import { handleCodingDraft, handleCodingTask } from '../lib/coding/handlers';
import { decodeSessionEnvelope } from '../lib/quiz-tokens';
import { dailySeededShuffle, pickQuestionOfTheDay, UNBIASED_SHUFFLE_FROM } from '../lib/daily-question';
import { addDays, qotdAvailability, qotdTrack, utcToday, QOTD_EPOCH, QOTD_TRACKS } from '../shared/daily-question';
import { CODING_INDEX } from '../shared/coding-index';
import { freeCodingCounts } from '../shared/tiers';
import {
  LAUNCH_COUPON_ENV,
  LAUNCH_OFFER,
  LAUNCH_REDEEM_BY,
  activeLaunchCoupon,
  discountedPrice,
  launchCouponId,
  launchOfferDisplay,
  launchWindowOpen,
} from '../shared/launch-offer';
import { encodePlacementRun } from '../lib/quiz-tokens';
import {
  itemClaim,
  publicItemReview,
  reviewStatusFor,
  summarizeCoverage,
  coverageClaim,
  passesBothGates,
  RELEVANCE_MARKERS,
  RELEVANCE_MAX,
  RELEVANCE_MIN,
  QUALITY_MAX,
  QUALITY_MIN,
  MARKER_MAX,
  type ReviewRecord,
} from '../shared/curation';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  CONCEPT_IDS,
  areContrastable,
  conceptById,
  conceptOf,
  validateConcepts,
} from '../shared/concepts';
import {
  DEFAULT_INTERVAL_HOURS,
  RELEARN_HOURS,
  RETRIEVAL_KINDS,
  dueConcepts,
  nextReviewState,
  sessionSize,
} from '../shared/spaced-practice';
import { arrangePractice, arrangementProblems } from '../shared/interleave';
import { questions } from '../lib/quiz-data';
import { LESSON_FIGURES, figuresFor, visibleFigures, validateFigures } from '../shared/lesson-figures';
import { LEVEL_INTROS } from '../client/src/lib/levelIntros';
import { FAILURE_CATEGORIES, classifyFailure, failureHint } from '../shared/coding-failure';
import { RETIRED_TOPIC_IDS, retirementOf } from '../shared/retired-content';
import { GLOSSARY, termsIn } from '../shared/glossary';
import {
  DEFAULT_MERCH_SETTINGS,
  merchRedemptionOpen,
  MERCH_SKUS,
  merchAvailability,
  merchMarginMinor,
  tokensForVerifiedXp,
  validateAddress,
} from '../shared/rewards';
import { DEFAULT_SETTINGS, normalizeSettings, setGameSettingsForTests } from '../lib/settings-store';
import { taskResources, CODING_DOC_LINKS } from '../shared/coding-docs';
import { STREAK_PROTECTION_CAP } from '../shared/rewards';
import {
  everyPlanHasAFirstStep,
  stepAlreadyPassed,
  SPECIALIZATION_BRIDGE_TOPICS,
  TOPIC_PREREQS,
  WEBDEV_PLAN_STAGES,
  isLevelUnlocked,
  isTopicInPlan,
  planTopics,
  validateProgressionGraph,
} from '../shared/progression';
import { LEARN_SECTION_IDS, LEARN_SECTIONS, OPT_IN_SECTIONS, learnerSections, sectionsForTopic } from '../shared/learn-sections';
import { OPT_IN_SECTIONS as INITIAL_OPT_IN_SECTIONS } from '../shared/learn-section-ids';
import {
  EXPERIENCE_LEVELS,
  LEARNER_GOALS,
  STUDY_TIMES,
  isLearnerProfileComplete,
  missingProfileFields,
  parseLearnerProfile,
  profileFromPreference,
  type BaseTrack,
} from '../shared/learning-paths';
import { gradeCheck } from '../lib/learning-paths/grade';
import {
  LEARNING_PATH_IDS,
  ROLE_SPECIALIZATION_IDS,
  isLearningPathId,
  isRoleSpecializationId,
  parseLearningPreference,
  pathGuidedComplete,
  pathInventory,
  isOffLoopModule,
} from '../shared/learning-paths';
import { gardenPathFor, tierUnlocked, eligibleCodingBadges, CODING_TASK_XP, CODING_BADGE_IDS, CODING_TRACKS, formatOf, isCodingSectionTrack, isDifficulty } from '../shared/coding-catalog';
import { CODING_BADGES } from '../shared/badges';
import { inspectQuestionQuality } from '../lib/question-quality';
import { assessmentUnlocks, roadmapEndedOnHearts, ROADMAP_MAX_HEARTS } from '../shared/assessment';
import { grantedTopicsFor, withGrantedTopics } from '../lib/topic-grants';
import { ROADMAP_TOPICS, isRoadmapTopic, topicLevelCount, ROADMAP_LEVELS } from '../lib/roadmap';
import type { Question } from '../lib/quiz-runtime';
import type { CodingTaskResponse, CodingVerdictResponse } from '../shared/coding-api';
import {
  FREE_CODING_SHARE,
  FREE_CODING_TASK_IDS,
  FREE_LEARN_LEVELS,
  FREE_LEARN_TOPICS,
  PREMIUM_REQUIRED,
  codingContent,
  contentTier,
  freeStageCount,
  isFreeCodingTask,
  isOpenTo,
} from '../shared/tiers';
import { EVOLVING_CHALLENGES, evolvingStage, evolvingUnlocked, isEvolvingCheckpoint } from '../shared/evolving';
import { techniqueGroup, CODING_FOUNDATION_LEVELS, CODING_SECTION_TRACKS, hasLearnLevel, tierLockReason } from '../shared/coding-catalog';
import { CODING_SUMMARIES } from '../lib/coding/active';
import { serverContentIndex } from '../lib/access';
import { loadReviewStates, recordConceptReviews } from '../lib/concept-review';
import { isRpcMissing, jsonPremiumRequired, PremiumRequiredError, requestMemo, requireAuthSub, verifiedCallerId, withRequestContext } from '../lib/http';
import { handleLeaderboardVisibility, limitUserWrite } from '../api/user/[op]';
import { handleFriends, handleIdentity } from '../lib/friends-handlers';
import { isValidHandle } from '../shared/handles';
import { accountExists, handleAdminEntitlements, handleEntitlement, parseValidUntil, toEntitlementResponse } from '../lib/entitlements';
import { DEFAULT_PUBLIC_ORIGIN, publicBillingSettings } from '../lib/billing/config';
import { WAIVER_TEXT } from '../lib/billing/sync';
import { en as ENGLISH } from '../client/src/i18n/translations';
import { privacyEn as PRIVACY_ENGLISH } from '../client/src/i18n/translations.privacy';
import { learnEn as LEARN_ENGLISH } from '../client/src/i18n/translations.learn';
import { pickerEn as PICKER_ENGLISH } from '../client/src/i18n/translations.picker';
import { NOINDEX_PATHS, PUBLIC_PAGES, premiumSchema } from '../client/src/lib/publicMetadata';
import {
  DEFAULT_COIN_SETTINGS,
  SOCIAL_PLATFORMS,
  coinsForVerifiedXp,
  coinsUnderDailyCap,
} from '../shared/rewards';
import { learnCheckpointXp, learnLevelXp } from '../shared/progression';
import { accountKey, codingAwardId, learnAwardId, milestoneConfig, previousMonth } from '../lib/rewards/coins';
import { REFERRAL_SIGNUP_WINDOW_HOURS, isReferralCode } from '../shared/rewards';
import { accountCreatedAt, handleReferral } from '../lib/rewards/referral';
import { getMerchPromo, parseSpreadshopPromotion, resetMerchPromoCache, spreadshopConfig } from '../lib/rewards/spreadshop';
import { MERCH_CATALOGUE, SHIRT_SIZES } from '../shared/rewards';
import { generateVoucherCode, handleAdminVouchers, handleVoucherRedeem, parseVoucherForm, toAdminVoucher, voucherHash } from '../lib/vouchers';
import { VOUCHER_ALPHABET, formatVoucherCode, normalizeVoucherCode, voucherHint, voucherState } from '../shared/vouchers';
import adminHandler from '../api/admin/[op]';
import { productCleanupContracts } from './product-cleanup-contracts';

function apiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? apiFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function mockResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), String(value)); },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
    end() { return this; },
    headers,
  };
}

/** Every script and source file under `dir` (relative to the repository),
 * node_modules left out. */
function codeFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : codeFiles(path);
    return /\.(ts|tsx|mjs|js)$/.test(entry.name) ? [path] : [];
  });
}

/** Corrupt a sealed token in a way that always changes its authentication tag,
 * so a "must fail closed" assertion cannot pass or fail by luck. */
function tamperToken(token: string): string {
  const tail = token.slice(-4);
  return token.slice(0, -4) + (tail === 'AAAA' ? 'BBBB' : 'AAAA');
}

/* ── the content-audit gate (#176) ────────────────────────────────────────
 *
 * Every rule here is one the audit's retirement policy depends on: the two
 * gates never stand in for each other, a record applies only to the exact
 * content it was made about, a withheld item is absent from every selector
 * at once, a retired item leaves a level thin or unavailable rather than
 * sliding its neighbours across titles, the unlock rules step over what
 * cannot be opened, and an answer to a retired item is void. */
async function auditGateContracts() {
  const markers = (n: number) => ({ presentDay: Math.min(2, n), practicalUtility: Math.min(2, Math.max(0, n - 2)), transferable: Math.min(2, Math.max(0, n - 4)), audienceFit: Math.min(2, Math.max(0, n - 6)), riskOutcome: Math.min(2, Math.max(0, n - 8)) });
  const dims = (floor: number) => ({ topicRelevance: 5, learningValue: 5, technicalCorrectness: 5, wording: 5, answerOptions: 5, hint: floor, explanation: 5 });
  const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
    id: 'rm-js-1', kind: 'question', hash: 'h1',
    relevance: 8, quality: 4, markers: markers(8), dimensions: dims(4),
    decision: 'retain', reviewedAt: '2026-09-09', revision: 1, ...over,
  });

  // The boundaries the audit names, one by one.
  assert.equal(eligibilityFrom(entry(), 'h1', true).active, true, 'a current passing record is served');
  assert.equal(eligibilityFrom(entry({ relevance: 3, markers: markers(3) }), 'h1', true).reason, 'failed-gate', 'relevance 3 retires');
  assert.equal(eligibilityFrom(entry({ relevance: 4, markers: markers(4) }), 'h1', true).active, true, 'relevance 4 alone does not retire');
  assert.equal(eligibilityFrom(entry({ relevance: 4, markers: markers(4), quality: 2, dimensions: dims(2) }), 'h1', true).reason, 'failed-gate', 'relevance 4 with quality 2 still retires');
  assert.equal(eligibilityFrom(entry({ relevance: 10, markers: markers(10), quality: 2, dimensions: dims(2) }), 'h1', true).reason, 'failed-gate', 'relevance 10 with a wrong key (quality capped at 2) still retires');
  assert.equal(eligibilityFrom(entry({ decision: 'retire' }), 'h1', true).reason, 'retired', 'a retire decision withholds whatever the scores say');
  assert.equal(eligibilityFrom(entry({ decision: 'quarantine' }), 'h1', true).reason, 'quarantined', 'unverified correctness is held, not passed');
  assert.equal(eligibilityFrom(null, 'h1', true).reason, 'unreviewed', 'no record means not served');
  assert.equal(eligibilityFrom(entry(), 'h2', true).reason, 'superseded', 'a record for other content does not apply — an edit invalidates approval');
  assert.equal(eligibilityFrom(entry({ hash: 'h2', revision: 2 }), 'h2', true).active, true, 'a re-reviewed rewrite returns on its new hash');
  assert.equal(eligibilityFrom(entry({ relevance: 9 }), 'h1', true).reason, 'invalid-record', 'a row whose totals disagree with its markers is no record at all');
  assert.equal(eligibilityFrom(null, 'h1', false).active, true, 'outside the audited scope an unreviewed item is served as before');
  assert.equal(eligibilityFrom(null, 'h1', false).reason, 'not-in-scope');
  // A recorded decision holds wherever the item lives; the scope only decides
  // what happens to content with no applicable record.
  assert.equal(eligibilityFrom(entry({ decision: 'retire' }), 'h1', false).reason, 'retired', 'a retirement recorded for a category still in progress withholds the item now');
  assert.equal(eligibilityFrom(entry({ relevance: 3, markers: markers(3) }), 'h1', false).reason, 'failed-gate', 'a failing row withholds outside the scope too');
  assert.equal(eligibilityFrom(entry(), 'h1', false).reason, 'reviewed', 'a passing row serves, and claims, outside the scope');
  assert.deepEqual(eligibilityFrom(entry(), 'h2', false), { active: true, reason: 'not-in-scope', entry: null }, 'a superseded row outside the scope neither withholds nor claims');
  assert.equal(eligibilityFrom(entry({ relevance: 9 }), 'h1', false).active, true, 'a broken row outside the scope is no record, so the item is served as before');
  assert.equal(registryEntryConsistent(entry({ quality: 5 })), false, 'the quality score must be the floor of its dimensions');

  // The registry is the ledger, exactly.
  const ledger = readLedger();
  assert.equal(
    readFileSync(join(process.cwd(), REGISTRY_PATH), 'utf8'),
    renderCurationRegistry(registryFromLedger(ledger), ledger),
    'lib/curation-registry.ts is stale: run npm run build:curation-registry',
  );
  for (const row of REVIEW_REGISTRY) assert.ok(registryEntryConsistent(row), `registry row ${row.id} is inconsistent`);
  assert.equal(CODING_TASKS_AUDITED, true, 'completed coding review must also withhold future unreviewed or changed tasks');
  const reviewedCoding = CODING_TASKS.filter(task => isCodingSectionTrack(task.track));
  assert.equal(reviewedCoding.length, 769, 'all currently issued coding identities are included in the completed wave');
  for (const task of reviewedCoding) {
    assert.equal(codingTaskEligibility(task, solutionFor(task.id)).reason, 'reviewed', `${task.id}: current coding content requires a passing review`);
    assert.ok(codingTaskById(task.id), `${task.id}: the completed gate must preserve current availability`);
  }
  const codingFixture = reviewedCoding[0];
  const codingSolution = solutionFor(codingFixture.id);
  assert.equal(codingTaskEligibility({ ...codingFixture, id: 'unreviewed-coding-gate-fixture' }, codingSolution).reason, 'unreviewed');
  assert.equal(codingTaskEligibility({ ...codingFixture, title: 'Changed unreviewed task' }, codingSolution).reason, 'superseded');
  assert.equal(codingTaskEligibility(codingFixture, { ...codingSolution!, solution: 'changed unreviewed solution' }).reason, 'superseded');
  for (const task of CODING_TASKS.filter(task => !isCodingSectionTrack(task.track))) {
    assert.equal(codingTaskEligibility(task, solutionFor(task.id)).reason, 'unreviewed', `${task.id}: hidden system design is not approved by this wave`);
    assert.equal(codingTaskById(task.id), undefined);
  }
  // Content this audit rewrote is served only after a second reader checked
  // the rewrite: revision 2 without an accepted verdict is a process failure,
  // not a wording preference.
  for (const item of ledger.items as unknown as { id: string; revision: number; decision: string; verification?: { verdict?: string } }[]) {
    if (item.revision > 1 && (item.decision === 'retain' || item.decision === 'rewrite')) {
      const verdict = item.verification?.verdict;
      assert.ok(verdict === 'accept' || verdict === 'amend', `${item.id} was rewritten and is served without an accepted second reading`);
    }
  }
  for (const category of AUDITED_CATEGORIES) assert.ok(isAuditedCategory(category), `${category} must resolve to devShark`);

  // Reconciliation: every served item of an audited category has a decision
  // for its exact current content, and every registry row names a real item.
  // The served set is read with the gate applied, so a withheld item is
  // proven absent rather than assumed.
  const served = await getEffectiveQuestions('webdev');
  const history = await getQuestionsForHistoryById('webdev');
  const byId = new Map(REVIEW_REGISTRY.map((row) => [row.id, row]));
  for (const q of served) {
    const row = byId.get(q.id);
    if (!row) {
      assert.ok(!AUDITED_CATEGORIES.has(q.category), `${q.id} is served from audited category ${q.category} without a review record`);
      continue;
    }
    // A served item with a row is served on that row's terms wherever it lives:
    // current content, live decision, both gates.
    if (row.hash !== contentHash(q)) {
      assert.ok(!AUDITED_CATEGORIES.has(q.category), `${q.id} is served on content its record was not made about`);
      continue;
    }
    assert.ok(row.decision === 'retain' || row.decision === 'rewrite', `${q.id} is served with decision ${row.decision}`);
    assert.ok(passesBothGates(row.relevance, row.quality), `${q.id} is served while failing a gate`);
  }
  const withheldByDecision = REVIEW_REGISTRY.filter((row) => row.decision === 'retire' || row.decision === 'quarantine' || !passesBothGates(row.relevance, row.quality));
  const servedIds = new Set(served.map((q) => q.id));
  for (const row of withheldByDecision) assert.ok(!servedIds.has(row.id), `${row.id} was retired or quarantined and is still served`);
  // The landing's question count is what a learner can be served from the
  // static bank: the gated set without the retired sections, whose categories
  // stay in the catalogue only so old rows resolve (#230).
  const deliverable = served.filter((q) => deliveryCategories('webdev').includes(q.category)).length;
  assert.equal(SUBJECT_SCOPE_CATALOG.webdev.questionCount, deliverable, `questionCount must be the ${deliverable} questions the bank can serve`);
  assert.equal(SUBJECT_SCOPE_CATALOG.webdev.codingChallengeCount, CODING_SUMMARIES.length,
    'the landing coding challenge count must match the active, visible coding catalogue');
  for (const row of REVIEW_REGISTRY) {
    if (row.kind !== 'question') continue;
    const item = history.get(row.id);
    assert.ok(item, `registry row ${row.id} names no devShark question`);
    if (row.hash === contentHash(item!) && (row.decision === 'retain' || row.decision === 'rewrite') && passesBothGates(row.relevance, row.quality)) {
      assert.ok(servedIds.has(row.id), `${row.id} has a current passing record and is not served`);
    }
  }

  // The store applies the rule once, to the merged set, so an edit in the
  // override layer supersedes a review with no code path able to forget it.
  const audited = served.find((q) => AUDITED_CATEGORIES.has(q.category));
  if (audited) {
    const edited = { ...audited, explanation: `${audited.explanation} (edited in /dev)` };
    const gated = applyEligibility([audited, edited, { ...audited, id: 'rm-js-never-reviewed' }]);
    assert.deepEqual(gated.list.map((q) => q.id), [audited.id], 'the edited copy and the unreviewed id are withheld');
    assert.equal(gated.withheld.get(audited.id), 'superseded');
    assert.equal(gated.withheld.get('rm-js-never-reviewed'), 'unreviewed');
    assert.equal(questionEligibility(audited).active, true);
  }
  // In a category the wave has reached only in part, the recorded decisions
  // hold and everything else is served as before.
  const partial = served.find((q) => !AUDITED_CATEGORIES.has(q.category) && byId.has(q.id));
  if (partial) {
    const edited = { ...partial, explanation: `${partial.explanation} (edited in /dev)` };
    const gated = applyEligibility([partial, edited, { ...partial, id: 'rm-js-never-reviewed' }]);
    assert.deepEqual(gated.list.map((q) => q.id), [partial.id, partial.id, 'rm-js-never-reviewed'], 'outside the completed scope an edit or a missing record serves the item as before');
    assert.equal(questionEligibility(edited).reason, 'not-in-scope');
    assert.equal(questionEligibility(partial).reason, 'reviewed', 'the recorded review still applies to the unedited wording');
  }
  const retiredRow = REVIEW_REGISTRY.find((row) => row.kind === 'question' && row.decision === 'retire' && !AUDITED_CATEGORIES.has(history.get(row.id)?.category ?? ''));
  if (retiredRow) {
    const item = history.get(retiredRow.id)!;
    assert.equal(questionEligibility(item).reason, retiredRow.hash === contentHash(item) ? 'retired' : 'not-in-scope');
    assert.ok(!servedIds.has(retiredRow.id) || retiredRow.hash !== contentHash(item), `${retiredRow.id} was retired in a category still in progress and is still served`);
  }
  const firstServed = (await getEffectiveQuestions('webdev'))[0];
  assert.ok(firstServed, 'the webdev bank serves questions');

  // Levels keep their authored membership. A retired question thins its own
  // level; it never slides a neighbour under another title. Below the floor a
  // level is unavailable, and its part follows when every level in it is.
  const all = new Set(Array.from({ length: 200 }, (_, i) => `rm-js-${i + 1}`));
  const intact = buildLiveTopic('javascript', (id) => all.has(id));
  assert.equal(intact.levels.length, 25);
  assert.ok(intact.levels.every((level) => level.questionCount === 8 && !level.unavailable));
  const thinned = new Set(all);
  for (const n of [9, 10]) thinned.delete(`rm-js-${n}`); // two from level 2
  for (let n = 17; n <= 22; n++) thinned.delete(`rm-js-${n}`); // six from level 3 → two left
  const live = buildLiveTopic('javascript', (id) => thinned.has(id));
  assert.equal(live.levels[1].questionCount, 6, 'level 2 is served with its six survivors');
  assert.deepEqual(live.levelIds[1], ['rm-js-11', 'rm-js-12', 'rm-js-13', 'rm-js-14', 'rm-js-15', 'rm-js-16'], 'the survivors are level 2 questions, not level 3 ones pulled forward');
  assert.equal(live.levels[2].unavailable, true, `fewer than ${MIN_LEVEL_QUESTIONS} survivors makes a level unavailable`);
  assert.deepEqual(live.levelIds[2], [], 'an unavailable level contributes nothing to a test');
  assert.equal(live.levels[3].questionCount, 8, 'level 4 is untouched');
  assert.equal(live.levels.length, 25, 'the topic keeps its length');
  assert.deepEqual([...live.unavailableLevels], [3]);
  assert.deepEqual([...live.unavailableParts], [], 'a part with any available level is available');
  assert.deepEqual(unavailablePartsOf(live.levels), []);
  const emptyPart = buildLiveTopic('javascript', (id) => { const n = Number(id.slice(6)); return n > 72; }); // levels 1–9 gone: part 1 empty
  assert.deepEqual([...emptyPart.unavailableParts], [1], 'a part with no available level is unavailable');
  assert.deepEqual(roadmapPartRanges(25).map((r) => r.size), [9, 8, 8]);

  // The unlock rules follow the parts the learner actually meets, and step
  // over what cannot be opened. Level 6 of a 25-level topic needs level 5,
  // not a checkpoint that is recorded only after level 9.
  const availability = liveAvailability(live);
  const passed = (...levels: number[]) => ({ javascript: { levels: Object.fromEntries(levels.map((l) => [String(l), { passed: true }])) } });
  assert.equal(isLevelUnlocked(passed(1, 2, 3, 4, 5), 'javascript', 6, { levelCount: 25 }), true, 'level 6 needs level 5 on a 25-level topic');
  assert.equal(isLevelUnlocked(passed(1, 2, 3, 4, 5, 6, 7, 8, 9), 'javascript', 10, { levelCount: 25 }), false, 'level 10 opens part 2 and needs the part-1 test');
  assert.equal(isLevelUnlocked({ javascript: { levels: passed(1, 2, 3, 4, 5, 6, 7, 8, 9).javascript.levels, checkpoints: { '1': { passed: true } } } }, 'javascript', 10, { levelCount: 25 }), true);
  assert.equal(isLevelUnlocked(passed(1, 2), 'javascript', 3, availability), false, 'an unavailable level cannot be opened');
  assert.equal(isLevelUnlocked(passed(1, 2), 'javascript', 4, availability), true, 'the level after an unavailable one opens on the nearest available level');
  assert.equal(firstUnfinishedLevel(passed(1, 2), 'javascript', availability), 4, 'the next step skips an unavailable level');
  assert.equal(isCheckpointUnlocked(passed(1, 2, 4, 5, 6, 7, 8), 'javascript', 1, availability), false, 'a part test needs its last available level');
  assert.equal(isCheckpointUnlocked(passed(1, 2, 4, 5, 6, 7, 8, 9), 'javascript', 1, availability), true);
  const emptyAvailability = liveAvailability(emptyPart);
  assert.equal(isSegmentCleared({}, 'javascript', 1, emptyAvailability), true, 'an empty part is cleared, not a dead end');
  assert.equal(isLevelUnlocked({}, 'javascript', 10, emptyAvailability), true, 'the next part opens past an empty one');
  assert.equal(partRanges(6).map((r) => r.size).join(','), '2,2,2');

  // An answer to a question that is no longer served is void: neither for nor
  // against, no proof minted, and reported so the result screen can say why.
  const sample = firstServed;
  const session = encodeSession(
    [{ questionId: sample.id, correctAnswer: 1 }, { questionId: 'retired-while-open', correctAnswer: 2 }],
    { subject: 'webdev' },
  );
  const submitRes = mockResponse();
  await submitHandler({ method: 'POST', headers: {}, query: {}, body: { sessionId: session, answers: { [sample.id]: 1, 'retired-while-open': 2 } } } as never, submitRes as never);
  assert.equal(submitRes.statusCode, 200, JSON.stringify(submitRes.body));
  const graded = submitRes.body as { totalQuestions: number; correctAnswers: number; voided?: string[]; results: { questionId: string }[] };
  assert.deepEqual(graded.voided, ['retired-while-open']);
  assert.equal(graded.totalQuestions, 1, 'the void item is left out of the total');
  assert.equal(graded.correctAnswers, 1, 'the served item still counts');
  assert.ok(graded.results.every((r) => r.questionId !== 'retired-while-open'), 'no proof is minted for a void item');
  // Each graded answer used to carry a sealed answerProof that nothing ever
  // opened: up to fifty AES-GCM seals per submit, for bytes the client dropped.
  assert.ok(graded.results.every((r) => !('answerProof' in r)), 'a graded answer carries no unread answer proof');

  // A placement round voids a retired item and tops the run up instead of
  // ending it short of the budget.
  const pool = (await getEffectiveQuestions('webdev')).slice(0, 3);
  const placementToken = encodePlacementRun({
    subject: 'webdev', attemptId: 'placement-void-contract-1234', round: 1, difficulty: 3, history: [],
    items: [
      { questionId: pool[0].id, correctAnswer: 0, category: pool[0].category },
      { questionId: 'retired-while-open', correctAnswer: 0, category: pool[0].category },
    ],
  });
  const roundRes = mockResponse();
  await roadmapHandler({ method: 'POST', headers: {}, query: { resource: 'placement' }, body: { placementToken, answers: { [pool[0].id]: 0, 'retired-while-open': 0 } } } as never, roundRes as never);
  assert.equal(roundRes.statusCode, 200, JSON.stringify(roundRes.body));
  const round = roundRes.body as { done: boolean; voided?: number; lastRoundSize?: number; lastRoundCorrect?: number; asked?: number; review?: import('../shared/assessment').PlacementReview[] };
  assert.equal(round.done, false);
  assert.equal(round.voided, 1, 'the retired item is reported as void');
  assert.equal(round.lastRoundSize, 1, 'the void item does not count in the round');
  assert.equal(round.lastRoundCorrect, 1);
  assert.equal(round.asked, 1, 'the run continues from what was actually graded');
  assert.deepEqual(round.review, [{ questionId: pool[0].id, selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: pool[0].explanation }], 'accepted review keeps the sealed shuffled answer index and omits retired items');
  // A round is graded once. Submitted again with other answers it would report
  // a different score, and a few dozen replays would find every key and mint a
  // perfect, verified placement receipt.
  const replayRes = mockResponse();
  await roadmapHandler({ method: 'POST', headers: {}, query: { resource: 'placement' }, body: { placementToken, answers: { [pool[0].id]: 1, 'retired-while-open': 1 } } } as never, replayRes as never);
  assert.equal(replayRes.statusCode, 409, 'a placement round cannot be submitted twice');
  assert.equal((replayRes.body as { error: { code: string } }).error.code, 'placement_round_used');
  assert.equal(JSON.stringify(replayRes.body).includes('lastRoundCorrect'), false, 'the refusal reports no score');
  assert.equal(JSON.stringify(replayRes.body).includes('correctAnswer'), false, 'a replay never receives review keys');
  // The last round names the account its receipt is for. A sign-in refused on
  // that round must not spend it: the same round, sent again with a working
  // sign-in, is graded and mints the receipt instead of answering 409.
  const finalPool = await getEffectiveQuestions('webdev');
  const finalToken = encodePlacementRun({
    subject: 'webdev', attemptId: 'placement-final-auth-contract-1234', round: 4, difficulty: 3,
    history: finalPool.slice(1, 20).map((q) => ({ questionId: q.id, category: q.category, isCorrect: true })),
    items: [{ questionId: finalPool[0].id, correctAnswer: 0, category: finalPool[0].category }],
  });
  const refusedFinal = mockResponse();
  await roadmapHandler({ method: 'POST', headers: { authorization: 'Bearer expired-contract-token' }, query: { resource: 'placement' }, body: { placementToken: finalToken, answers: { [finalPool[0].id]: 0 } } } as never, refusedFinal as never);
  assert.equal(refusedFinal.statusCode, 401, `a broken sign-in on the last round is refused (${JSON.stringify(refusedFinal.body)})`);
  const retriedFinal = mockResponse();
  await roadmapHandler({ method: 'POST', headers: { authorization: 'Bearer expired-contract-token' }, query: { resource: 'placement' }, body: { placementToken: finalToken, answers: { [finalPool[0].id]: 0 }, user_id: 'placement-final-contract-user' } } as never, retriedFinal as never);
  assert.equal(retriedFinal.statusCode, 200, `the refused last round is still unspent (${JSON.stringify(retriedFinal.body)})`);
  assert.equal((retriedFinal.body as { done?: boolean }).done, true);
  assert.equal(typeof (retriedFinal.body as { resultReceipt?: unknown }).resultReceipt, 'string', 'and mints the receipt for the account');

  // A Learn session lives as long as the attempt the answer routine opens for
  // it (two hours), so a level whose coding tasks run past an hour can still
  // be completed. Review still has its one-hour session.
  const realNow = Date.now;
  try {
    const opened = realNow();
    const learnSession = encodeSession([{ questionId: sample.id, correctAnswer: 0 }], {
      scope: 'roadmap', subject: 'webdev', topic: 'javascript', roadmapKind: 'level', ref: 1, userId: null,
    });
    const reviewSession = encodeSession([{ questionId: sample.id, correctAnswer: 0 }], { scope: 'review', subject: 'webdev' });
    Date.now = () => opened + 61 * 60_000;
    assert.ok(decodeSession(learnSession), 'a Learn session is still open after an hour');
    assert.equal(decodeSession(reviewSession), null, 'a Review session still ends after an hour');
    Date.now = () => opened + 121 * 60_000;
    assert.equal(decodeSession(learnSession), null, 'a Learn session ends after two hours');
  } finally {
    Date.now = realNow;
  }
}

/* ── the free tier and Premium (#220) ─────────────────────────────────────
 *
 * shared/tiers.ts is the one contract for what each tier opens, the server
 * refuses locked content with 402, and Premium changes which content a
 * learner may start and nothing else. Each assertion below checks one of those
 * rules. */
async function tierContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  // 1. The contract is pure: the browser and the server import the same file.
  const tiersSource = read('shared/tiers.ts');
  const tiersImports = [...tiersSource.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((match) => match[1]);
  assert.ok(tiersImports.length > 0);
  for (const specifier of tiersImports) {
    assert.ok(specifier.startsWith('./'), `shared/tiers.ts may import only from shared/, not ${specifier}`);
  }

  // 2. The free coding share stays inside its bounds, and 3. every free task exists.
  const index = serverContentIndex();
  const indexIds = new Set(CODING_INDEX.map((task) => task.id));
  for (const id of FREE_CODING_TASK_IDS) assert.ok(indexIds.has(id), `free task ${id} is not in the coding index`);
  assert.equal(new Set(FREE_CODING_TASK_IDS).size, FREE_CODING_TASK_IDS.length, 'the free pick lists each task once');
  const freeCount = CODING_INDEX.filter((task) => task.free === true).length;
  const share = freeCount / CODING_INDEX.length;
  assert.ok(
    share >= FREE_CODING_SHARE.min && share <= FREE_CODING_SHARE.max,
    `the free coding share is ${(share * 100).toFixed(1)} %, outside ${FREE_CODING_SHARE.min * 100}-${FREE_CODING_SHARE.max * 100} %`,
  );
  // The browser's flags are the server's flags: both are the projection of one list.
  for (const task of CODING_INDEX) {
    assert.equal(task.free === true, isFreeCodingTask(task.id), `${task.id}: the index flag disagrees with shared/tiers.ts`);
  }
  assert.deepEqual(
    CODING_SUMMARIES.filter((task) => task.free).map((task) => task.id),
    CODING_INDEX.filter((task) => task.free).map((task) => task.id),
    'the server summaries and the browser index open the same tasks',
  );
  // The opening stages of every evolving project and short path are open:
  // stage one, the checkpoint and the first milestone in a project with
  // checkpoints (owner decision 6, 9 Oct 2026), and then the checkpoint after
  // it that opens the next milestone (the owner's follow-up that afternoon).
  // In the stage numbers a learner sees: 1, 2 and 3 of a ten-stage project,
  // 1 and 2 of a FullStack app, level 1 of a short path. They are always the
  // head of the list, and the Terms name them from this rule.
  const freeStages = (stages: readonly string[]) => stages.flatMap((id, at) => (contentTier({ kind: 'coding-task', taskId: id }, index) === 'free' ? [at + 1] : []));
  const shapeOf = (challenge: (typeof EVOLVING_CHALLENGES)[number]) => (challenge.short ? 'short' : challenge.stages.length === 10 ? 'ten-stage' : challenge.stages.length === 12 ? 'fullstack' : null);
  const ownerStages: Record<string, readonly number[]> = { short: [1], 'ten-stage': [1, 2, 3], fullstack: [1, 2] };
  for (const challenge of EVOLVING_CHALLENGES) {
    const shape = shapeOf(challenge);
    assert.ok(shape, `${challenge.id}: a project length the copy names`);
    const firstMilestone = challenge.stages.findIndex((id) => !isEvolvingCheckpoint(id)) + 1;
    const opensNext = isEvolvingCheckpoint(challenge.stages[firstMilestone] ?? '');
    assert.equal(freeStageCount(challenge.stages), firstMilestone + (opensNext ? 1 : 0), `${challenge.id}: the free stages end at the first milestone, or at the checkpoint right after it`);
    assert.deepEqual(freeStages(challenge.stages), Array.from({ length: freeStageCount(challenge.stages) }, (_, at) => at + 1), `${challenge.id}: the free stages are the head of the list`);
    assert.deepEqual(freeStages(challenge.stages), ownerStages[shape], `${challenge.id}: the free stages`);
    // The stage after the free ones is Premium, by kind and by the tier rule.
    const next = challenge.stages[freeStageCount(challenge.stages)];
    assert.equal(contentTier({ kind: 'evolving-stage', challengeId: challenge.id, stage: freeStageCount(challenge.stages) + 1 }, index), 'premium', `${challenge.id}: the stage after the free ones`);
    assert.equal(isFreeCodingTask(next), false, `${challenge.id}: ${next} is Premium`);
    for (const [at, id] of challenge.stages.entries()) {
      assert.equal(contentTier({ kind: 'evolving-stage', challengeId: challenge.id, stage: at + 1 }, index), contentTier({ kind: 'coding-task', taskId: id }, index), `${id}: a stage and its task agree`);
    }
  }
  // The Terms list the stages this rule opens, in the words the stage list
  // uses ("1, 2 and 3"), read from one project of each shape.
  const named = (numbers: readonly number[]) => (numbers.length > 1 ? `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}` : String(numbers[0]));
  const freeOf = (shape: string) => freeStages(EVOLVING_CHALLENGES.find((challenge) => shapeOf(challenge) === shape)!.stages);
  const termsStages = `stages ${named(freeOf('ten-stage'))} of every ten-stage coding project, stages ${named(freeOf('fullstack'))} of every twelve-stage FullStack app, level ${named(freeOf('short'))} of every short path`;
  assert.ok(ENGLISH['legal.terms.plans.free'].includes(termsStages), `the Terms name the free stages the rule opens: ${termsStages}`);
  // Reachable (the owner, 9 Oct 2026 afternoon: "give other, reachable
  // stages"). Walk every project in order as a free account: pass each stage
  // it may open once the stages before it are passed, and stop at the first
  // it may not. By then it has passed every free stage of the project and
  // nothing else. The fourteen last checkpoints that were free before failed
  // this: each sat behind Premium stages.
  for (const challenge of EVOLVING_CHALLENGES) {
    const passed = new Set<string>();
    for (const id of challenge.stages) {
      if (!isOpenTo('free', { kind: 'coding-task', taskId: id }, index) || !evolvingUnlocked(id, passed)) break;
      passed.add(id);
    }
    assert.deepEqual([...passed], challenge.stages.filter((id) => isFreeCodingTask(id)), `${challenge.id}: a free account reaches every free stage by passing free stages only`);
  }
  // The fourteen checkpoints opened beyond stage one: in each project that
  // has checkpoints, the one right after the first milestone, a five-minute
  // tier-2 step that reads Easy. They replace the last checkpoint of each
  // (stage 9 or 11), which a free account could not reach; those are Premium.
  const byTask = new Map(CODING_TASKS.map((task) => [task.id, task]));
  const checkpointed = EVOLVING_CHALLENGES.filter((one) => one.stages.some(isEvolvingCheckpoint));
  assert.equal(checkpointed.length, 14, 'fourteen projects have checkpoints');
  for (const challenge of checkpointed) {
    const id = challenge.stages[freeStageCount(challenge.stages) - 1];
    const firstMilestone = challenge.stages.find((one) => !isEvolvingCheckpoint(one))!;
    assert.equal(id, evolvingStage(firstMilestone)!.next, `${challenge.id}: the last free stage is the one after the first milestone`);
    assert.ok(isEvolvingCheckpoint(id), `${id} is a checkpoint`);
    const task = byTask.get(id)!;
    assert.ok(task && indexIds.has(id), `${id} is issued`);
    assert.equal(task.estimatedMinutes, 5, `${id}: a five-minute checkpoint`);
    assert.equal(task.tier, 2, `${id}: tier 2`);
    assert.equal(CODING_INDEX.find((one) => one.id === id)?.difficulty, 'easy', `${id}: reads Easy`);
    const last = challenge.stages.filter(isEvolvingCheckpoint).at(-1)!;
    assert.equal(isFreeCodingTask(last), false, `${challenge.id}: its last checkpoint, ${last}, is Premium`);
  }
  assert.deepEqual(FREE_CODING_TASK_IDS.filter((id) => evolvingStage(id)), [], 'the starter set lists standalone tasks only');
  // Every free task reads Easy, except a level whose authors set its label
  // (two debugging paths open on a Medium level 1). It replaces "every listed
  // free task is Easy", which the opened milestones and checkpoints keep.
  for (const task of CODING_INDEX.filter((one) => one.free)) {
    if (byTask.get(task.id)?.difficulty) continue;
    assert.equal(task.difficulty, 'easy', `${task.id}: a free task with a derived label reads Easy`);
  }
  // Each tier-1 technique group of every section track has its first task open.
  for (const track of ['javascript', 'typescript', 'react', 'algorithms'] as const) {
    const seen = new Set<string>();
    for (const task of CODING_INDEX.filter((one) => one.track === track && one.tier === 1 && !codingContent(one.id).kind.startsWith('evolving'))) {
      for (const tag of task.focus) {
        const group = techniqueGroup(tag);
        if (!group || seen.has(group)) continue;
        seen.add(group);
        assert.equal(task.free, true, `${task.id} is the first ${track} tier-1 task in ${group} and must be free`);
      }
    }
  }

  // What the free tier opens, and what it does not.
  for (const topic of FREE_LEARN_TOPICS) {
    for (let level = 1; level <= topicLevelCount(topic); level++) {
      assert.equal(contentTier({ kind: 'learn-level', topic, level }, index), 'free', `${topic} ${level}`);
    }
    for (let part = 1; part <= 3; part++) assert.equal(contentTier({ kind: 'learn-part-test', topic, part }, index), 'free');
  }
  assert.equal(FREE_LEARN_LEVELS.react, 12);
  assert.equal(FREE_LEARN_LEVELS.dsa, 5);
  assert.equal(contentTier({ kind: 'learn-level', topic: 'dsa', level: 1 }, index), 'free');
  assert.equal(contentTier({ kind: 'learn-level', topic: 'dsa', level: 2 }, index), 'free');
  assert.equal(contentTier({ kind: 'learn-level', topic: 'dsa', level: 5 }, index), 'free');
  assert.equal(contentTier({ kind: 'learn-level', topic: 'dsa', level: 6 }, index), 'premium');
  assert.equal(contentTier({ kind: 'learn-part-test', topic: 'dsa', part: 1 }, index), 'free');
  assert.equal(contentTier({ kind: 'learn-part-test', topic: 'dsa', part: 2 }, index), 'premium');
  assert.equal(contentTier({ kind: 'learn-level', topic: 'react', level: 12 }, index), 'free');
  assert.equal(contentTier({ kind: 'learn-level', topic: 'react', level: 13 }, index), 'premium');
  assert.equal(contentTier({ kind: 'learn-part-test', topic: 'react', part: 1 }, index), 'free', "React's first part is open");
  assert.equal(contentTier({ kind: 'learn-part-test', topic: 'react', part: 2 }, index), 'premium', "React's second part ends above level 12");
  assert.equal(contentTier({ kind: 'learn-level', topic: 'typescript', level: 1 }, index), 'premium');
  assert.equal(contentTier({ kind: 'learning-path', pathId: 'fde' }, index), 'free');
  assert.equal(contentTier({ kind: 'coding-task', taskId: 'js-no-such-task' }, index), 'premium', 'unknown content can only lock');
  assert.equal(isOpenTo('premium', { kind: 'learning-path', pathId: 'fde' }, index), true);
  for (const path of LEARNING_PATHS) {
    const tasterIndex = { ...index, learningPaths: [publicManifest(path)] };
    const first = path.modules.find(module => !isOffLoopModule(module))!;
    const diagnostic = path.modules.find(module => module.activities.some(activity => activity.id === path.diagnosticActivityId));
    for (const module of path.modules) for (const activity of module.activities) {
      assert.equal(contentTier({ kind: 'learning-path-activity', pathId: path.id, activityId: activity.id }, tasterIndex), module === first || module === diagnostic ? 'free' : 'premium', `${activity.id}: the taster follows the manifest`);
    }
    assert.equal(contentTier({ kind: 'learning-path-activity', pathId: path.id, activityId: 'unknown-activity' }, tasterIndex), 'premium');
  }

  assert.equal(isOpenTo('free', { kind: 'learn-level', topic: 'html', level: 3 }, index), true);

  // 4. The entitlement routines read no learning, score or streak table, and
  //    5. a grant writes none. Comments are stripped so the header may name them.
  const migration = read('supabase/supabase-schema-039.sql').replace(/--[^\n]*/g, '').toLowerCase();
  for (const table of ['user_xp', 'user_stats', 'user_category_stats', 'user_streak', 'roadmap_progress', 'coding_progress', 'token_ledger', 'token_balances']) {
    assert.ok(!migration.includes(table), `migration 039 must not touch ${table}`);
  }
  for (const routine of [
    'is_premium', 'entitlement_summary', 'upsert_provider_entitlement', 'grant_manual_entitlement', 'revoke_manual_entitlement',
    'record_billing_event', 'finish_billing_event', 'link_billing_customer', 'delete_entitlement_data',
    // Billing (step D2, #221).
    'release_billing_event', 'billing_account', 'billing_customer_owner', 'record_checkout_consent',
    // The review's billing rules (step FIX).
    'claim_voluntary_refund', 'create_billing_cancel_request', 'review_billing_cancel_request',
    'consume_billing_cancel_request', 'release_billing_cancel_request',
  ]) {
    const start = migration.indexOf(`function public.${routine}(`);
    assert.ok(start >= 0, `migration 039 defines ${routine}`);
    const body = migration.slice(start, migration.indexOf('grant execute', start));
    assert.match(body, /security definer/, `${routine} is SECURITY DEFINER`);
    assert.match(body, /set search_path = ''/, `${routine} pins an empty search_path`);
    assert.match(migration, new RegExp(`grant execute on function public\\.${routine}\\([^)]*\\) to service_role;`), `${routine} is executable by service_role`);
    assert.match(migration, new RegExp(`revoke all on function public\\.${routine}\\([^)]*\\) from public, anon, authenticated;`), `${routine} is revoked from browsers`);
  }
  assert.doesNotMatch(migration, /create or replace function public\.delete_user_data/, 'migration 039 redefines no earlier routine');
  for (const table of ['billing_customers', 'entitlement_grants', 'billing_events', 'billing_checkout_consents', 'billing_cancel_requests']) {
    assert.match(migration, new RegExp(`alter table public\\.${table}\\s+enable row level security`), `${table} has RLS`);
    assert.match(migration, new RegExp(`revoke all on public\\.${table}\\s+from public, anon, authenticated`), `${table} revokes browser privileges`);
  }
  assert.doesNotMatch(migration, /grant select on public\.billing_events/, 'billing_events is service-role only');
  assert.doesNotMatch(migration, /grant [a-z, ]+ on public\.billing_cancel_requests/, 'the cancellation links are service-role only');
  // The grace of a failed renewal runs from the failure, never from a period
  // end the provider has already moved on (review finding product-3).
  assert.match(migration, /p_past_due_since is not null\s+and p_past_due_since \+ interval '7 days' > now\(\)/);
  assert.doesNotMatch(migration, /p_current_period_end \+ interval '7 days'/, 'no grace is counted from the period end');
  assert.doesNotMatch(migration, /to anon/, 'anon holds nothing');

  // Premium changes which content a learner may start and nothing else:
  // grading, XP, scores, streaks, ranks and matchmaking never read a tier.
  const tierReaders = new Set([
    'lib/access.ts', 'lib/http.ts', 'lib/entitlements.ts', 'lib/coding/catalog.ts', 'lib/coding/handlers.ts',
    'lib/learning-paths/handlers.ts', 'api/quiz/roadmap.ts',
    // Redeeming coins for shipped merchandise is Premium only (#227).
    'lib/rewards/handlers.ts',
    // A challenge run and a skip's next suggestion offer only what the plan
    // opens, so a free run never stops at a Premium challenge's 402.
    'lib/coding/practice-handlers.ts',
  ]);
  const serverFiles = [...apiFiles(join(process.cwd(), 'api')), ...apiFiles(join(process.cwd(), 'lib'))]
    .map((path) => path.slice(process.cwd().length + 1));
  for (const file of serverFiles) {
    const source = read(file);
    if (/from '[^']*shared\/tiers'|from '[^']*lib\/access'|from '\.\.?\/access'|refuseLocked|resolveTier/.test(source)) {
      assert.ok(tierReaders.has(file), `${file} reads the tier; only the content gates may`);
    }
  }
  for (const file of ['lib/coding/grade.ts', 'api/leaderboard.ts', 'api/quiz/submit.ts', 'api/play/[action].ts', 'api/quiz/daily.ts', 'api/quiz/challenge.ts']) {
    assert.doesNotMatch(read(file), /shared\/tiers|\/access'|is_premium|resolveTier|premium_required/, `${file} grades or ranks and must not read a tier`);
  }

  // 7. The 402 body: the standard envelope, the code, what was refused.
  {
    const res = mockResponse();
    jsonPremiumRequired(res as never, new PremiumRequiredError({ kind: 'learn-level', topic: 'react', level: 13 }));
    assert.equal(res.statusCode, 402);
    assert.deepEqual(
      res.body,
      { error: { code: PREMIUM_REQUIRED, message: 'Premium opens this', kind: 'learn-level', ref: 'react:13' } },
    );
    assert.equal(PREMIUM_REQUIRED, 'premium_required');
  }
  assert.deepEqual(toEntitlementResponse(null), {
    tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null,
    billingAccount: false, subscriptionLive: false,
  });
  // A lapsed subscriber and a complimentary grant over a subscription keep
  // Manage billing (review finding product-10).
  assert.equal(toEntitlementResponse({ premium: false, billingAccount: true }).billingAccount, true);
  assert.deepEqual(
    (({ tier, source, billingAccount, subscriptionLive }) => ({ tier, source, billingAccount, subscriptionLive }))(
      toEntitlementResponse({ premium: true, source: 'manual', validUntil: null, billingAccount: true, subscriptionLive: true })),
    { tier: 'premium', source: 'manual', billingAccount: true, subscriptionLive: true },
  );
  assert.equal(toEntitlementResponse({ premium: true, source: 'manual', validUntil: null }).tier, 'premium');
  assert.equal(toEntitlementResponse({ premium: 'yes' }).tier, 'free', 'only a literal true opens Premium');
  const now = Date.parse('2026-09-25T12:00:00Z');
  assert.deepEqual(parseValidUntil(undefined, now), { ok: true, value: null }, 'no end date means open-ended');
  assert.equal(parseValidUntil('2026-09-24', now).ok, false, 'a grant cannot end in the past');
  assert.equal(parseValidUntil('2040-01-01', now).ok, false, 'a grant is at most five years long');
  assert.deepEqual(parseValidUntil('2026-10-25T12:00:00Z', now), { ok: true, value: '2026-10-25T12:00:00.000Z' });

  // A routine that is not installed reads as missing whichever layer says so
  // (review finding data-1). PostgREST 12, which every .rpc() goes through,
  // answers PGRST202; Postgres answers 42883 when an installed routine calls a
  // missing one. The first object is PostgREST 12.2.12's body, verbatim.
  const pgrst202 = {
    code: 'PGRST202',
    details: 'Searched for the function public.is_premium with parameter p_user or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
    hint: null,
    message: 'Could not find the function public.is_premium(p_user) in the schema cache',
  };
  assert.equal(isRpcMissing(pgrst202), true, 'PostgREST reports a missing routine as PGRST202');
  assert.equal(isRpcMissing({ message: pgrst202.message }), true, 'the message alone is enough');
  assert.equal(isRpcMissing({ code: '42883', message: 'function public.is_premium(text) does not exist' }), true);
  assert.equal(isRpcMissing({ message: 'function public.window_leaderboard(integer) does not exist' }), true);
  for (const other of [
    { code: '42501', message: 'permission denied for function is_premium' },
    { code: 'PGRST203', message: 'Could not choose the best candidate function between: public.x(a => text), public.x(a => integer)' },
    { code: '42P01', message: 'relation "public.entitlement_grants" does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.entitlement_grants' in the schema cache" },
    // Same code as a missing function, but a bug inside an installed routine.
    { code: '42883', message: 'operator does not exist: text = uuid' },
    null,
  ]) {
    assert.equal(isRpcMissing(other), false, `${other?.code ?? 'no error'} is not a missing routine`);
  }

  // The handlers themselves, where they can run without a database: a signed-in
  // account with no grant is free, and a guest holds the free tier.
  {
    const signedIn = (query: Record<string, string>) => ({
      method: 'GET', headers: { authorization: 'Bearer contract' }, query: { ...query, user_id: 'contract-free-account' },
    });
    const lockedTask = CODING_INDEX.find((task) => task.track === 'javascript' && !task.free && !codingContent(task.id).kind.startsWith('evolving'))!;
    const freeTask = CODING_INDEX.find((task) => task.free && task.track === 'javascript')!;
    const locked = mockResponse();
    await roadmapHandler(signedIn({ resource: 'coding-task', id: lockedTask.id }) as never, locked as never);
    assert.equal(locked.statusCode, 402, 'a free account is refused a Premium task');
    assert.deepEqual(
      { code: (locked.body as { error: { code: string } }).error.code, kind: (locked.body as { error: { kind: string } }).error.kind, ref: (locked.body as { error: { ref: string } }).error.ref },
      { code: PREMIUM_REQUIRED, kind: 'coding-task', ref: lockedTask.id },
    );
    const lockedStage = mockResponse();
    await roadmapHandler(signedIn({ resource: 'coding-task', id: EVOLVING_CHALLENGES[0].stages[1] }) as never, lockedStage as never);
    assert.equal(lockedStage.statusCode, 402, 'a free account is refused stage two');
    assert.equal((lockedStage.body as { error: { kind: string } }).error.kind, 'evolving-stage');
    const open = mockResponse();
    await roadmapHandler(signedIn({ resource: 'coding-task', id: freeTask.id }) as never, open as never);
    assert.equal(open.statusCode, 200, 'a free account opens a free task');
    // A guest holds the free tier and nothing more (review finding
    // integrity-4): signing out, or leaving the token off a request, must not
    // open Premium content.
    const guest = (query: Record<string, string>) => ({ method: 'GET', headers: {}, query });
    const guestTask = mockResponse();
    await roadmapHandler(guest({ resource: 'coding-task', id: lockedTask.id }) as never, guestTask as never);
    assert.equal(guestTask.statusCode, 402, 'a guest is refused a Premium task');
    assert.equal((guestTask.body as { error: { kind: string } }).error.kind, 'coding-task');
    const guestStage = mockResponse();
    await roadmapHandler(guest({ resource: 'coding-task', id: EVOLVING_CHALLENGES[0].stages[1] }) as never, guestStage as never);
    assert.equal(guestStage.statusCode, 402, 'a guest is refused stage two');
    const guestStageOne = mockResponse();
    await roadmapHandler(guest({ resource: 'coding-task', id: EVOLVING_CHALLENGES[0].stages[0] }) as never, guestStageOne as never);
    assert.equal(guestStageOne.statusCode, 200, 'stage one of a project stays open to a guest');
    const guestFree = mockResponse();
    await roadmapHandler(guest({ resource: 'coding-task', id: freeTask.id }) as never, guestFree as never);
    assert.equal(guestFree.statusCode, 200, 'a free task stays open to a guest');
    const guestLevel = mockResponse();
    await roadmapHandler(guest({ topic: 'react', level: '13' }) as never, guestLevel as never);
    assert.equal(guestLevel.statusCode, 402, 'a guest is refused a Premium Learn level');
    const guestTest = mockResponse();
    await roadmapHandler(guest({ topic: 'react', test: '2' }) as never, guestTest as never);
    assert.equal(guestTest.statusCode, 402, 'a guest is refused a Premium part test');
    const guestTs = mockResponse();
    await roadmapHandler(guest({ topic: 'typescript', level: '1' }) as never, guestTs as never);
    assert.equal(guestTs.statusCode, 402, 'a guest is refused a Premium topic');
    const guestFreeLevel = mockResponse();
    await roadmapHandler(guest({ topic: 'react', level: '12' }) as never, guestFreeLevel as never);
    assert.notEqual(guestFreeLevel.statusCode, 402, 'a free Learn level stays open to a guest');
    // Grading and the solution follow the same rule. A guest's session for a
    // Premium task, or for a coding task inside a Premium Learn level, is
    // refused before anything is graded or revealed.
    const post = (resource: string, body: Record<string, unknown>) => ({ method: 'POST', headers: {}, query: { resource }, body });
    const levelTask = CODING_TASKS.find((task) => task.topic === 'typescript' && task.level > 0)!;
    assert.ok(levelTask, 'a coding task inside a TypeScript Learn level exists');
    for (const [label, session] of [
      ['a Premium task', encodeCodingSession({ taskId: lockedTask.id, track: lockedTask.track, userId: null })],
      ['a Premium Learn level', encodeCodingSession({ taskId: levelTask.id, track: levelTask.track, userId: null, roadmapAttemptId: 'guest-attempt-0123456789' })],
    ] as const) {
      const submitted = mockResponse();
      await roadmapHandler(post('coding-submit', { session, code: 'function solve() { return 1; }' }) as never, submitted as never);
      assert.equal(submitted.statusCode, 402, `a guest submit for ${label} is refused`);
      const revealed = mockResponse();
      await roadmapHandler(post('coding-reveal', { session, hintsUsed: 20 }) as never, revealed as never);
      assert.equal(revealed.statusCode, 402, `a guest reveal for ${label} is refused`);
      assert.equal(JSON.stringify(revealed.body ?? {}).includes('solution'), false, 'nothing of the solution comes back');
    }

    // Owner decision 6 and its follow-up (9 Oct 2026) at the server's gate: a
    // free account and a guest open the stages that became free after stage
    // one alone was (the first milestone of every ten-stage project and the
    // checkpoint after stage one of every project with checkpoints), and are
    // refused with 402 the first stage after the free ones and the last
    // checkpoint, which was free until the follow-up. The gate is
    // refuseLocked over shared/tiers.ts; nothing else decides it.
    // Each request is its own caller, so no rate-limit bucket fills up.
    let caller = 0;
    const opens = async (id: string, as: 'account' | 'guest') => {
      const out = mockResponse();
      caller += 1;
      const headers = { 'x-forwarded-for': `198.18.${caller >> 8}.${caller & 255}`, ...(as === 'account' ? { authorization: 'Bearer contract' } : {}) };
      await roadmapHandler({ method: 'GET', headers, query: { resource: 'coding-task', id, ...(as === 'account' ? { user_id: `contract-free-${caller}` } : {}) } } as never, out as never);
      return out;
    };
    const tenStage = EVOLVING_CHALLENGES.filter((one) => one.stages.length === 10 && !one.short);
    assert.equal(tenStage.length, 11, 'eleven ten-stage projects');
    const newlyFree = [...tenStage.map((one) => one.stages[1]), ...checkpointed.map((one) => one.stages[freeStageCount(one.stages) - 1])];
    for (const id of newlyFree) {
      for (const as of ['account', 'guest'] as const) {
        const opened = await opens(id, as);
        assert.equal(opened.statusCode, 200, `${as}: ${id} opens on the free tier (${JSON.stringify(opened.body)})`);
      }
    }
    for (const challenge of checkpointed) {
      const refusedIds = [challenge.stages[freeStageCount(challenge.stages)], challenge.stages.filter(isEvolvingCheckpoint).at(-1)!];
      for (const id of refusedIds) {
        for (const as of ['account', 'guest'] as const) {
          const refused = await opens(id, as);
          assert.equal(refused.statusCode, 402, `${as}: ${id} stays Premium`);
          assert.deepEqual((refused.body as { error: { kind: string; ref: string } }).error, {
            ...(refused.body as { error: object }).error, kind: 'evolving-stage', ref: `${challenge.id}:${challenge.stages.indexOf(id) + 1}`,
          });
        }
      }
    }
    // Opened is not a session: stages still unlock in order, so with nothing
    // passed the first milestone is held until its checkpoint is.
    assert.equal(((await opens('js-evolving-calculator-1', 'account')).body as CodingTaskResponse).locked, 'evolving');
    // Submit follows the same gate: a guest's session for a free stage is
    // graded (its reference passes), and one for the stage after the free
    // ones, or for the last checkpoint, is refused. The graded bodies carry
    // the stray `lang` an old cached client may still send (#485): the
    // server ignores it rather than refusing the request.
    for (const id of ['js-evolving-calculator-1', 'js-evolving-calculator-2-start']) {
      const graded = mockResponse();
      const session = encodeCodingSession({ taskId: id, track: 'javascript', userId: null });
      await roadmapHandler({ ...post('coding-submit', { session, code: solutionFor(id)!.solution, lang: 'cs' }), headers: { 'x-forwarded-for': `198.19.0.${caller += 1}` } } as never, graded as never);
      assert.equal(graded.statusCode, 200, `${id}: a guest submit is graded (${JSON.stringify(graded.body)})`);
      assert.equal((graded.body as CodingVerdictResponse).verdict, 'passed', `${id}: its reference passes`);
    }
    for (const id of ['js-evolving-calculator-2', 'js-evolving-calculator-5-start']) {
      const refused = mockResponse();
      await roadmapHandler({ ...post('coding-submit', { session: encodeCodingSession({ taskId: id, track: 'javascript', userId: null }), code: solutionFor(id)!.solution }), headers: { 'x-forwarded-for': `198.19.0.${caller += 1}` } } as never, refused as never);
      assert.equal(refused.statusCode, 402, `${id}: a guest submit is refused`);
    }
    // The reachability walk through the task page: a free account whose
    // stand-in database holds a pass of every stage before the one it asks
    // for. Each free stage answers 200 and unlocked, after free passes only;
    // the first stage after them answers 402 with every free stage passed.
    const walkDb = (passedIds: ReadonlySet<string>) => {
      const from = (table: string) => {
        const chain = {
          select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (value: unknown) => unknown) => resolve({ data: table === 'coding_progress' ? [...passedIds].map((task_id) => ({ task_id, status: 'passed' })) : [], error: null }),
        };
        return chain;
      };
      return { from, rpc: () => Promise.resolve({ data: null, error: null }) };
    };
    const asFreeAccount = async (id: string, passedIds: ReadonlySet<string>) => {
      caller += 1;
      const learner = `contract-walker-${caller}`;
      const req = { method: 'GET', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': `198.18.${caller >> 8}.${caller & 255}` }, query: { resource: 'coding-task', id, user_id: learner } };
      const res = mockResponse();
      await withRequestContext(req as never, res as never, async () => {
        await requestMemo(`tier:${learner}`, async () => 'free');
        await handleCodingTask(req as never, res as never, walkDb(passedIds) as never);
      });
      return res;
    };
    for (const challenge of EVOLVING_CHALLENGES) {
      const passed = new Set<string>();
      const free = challenge.stages.slice(0, freeStageCount(challenge.stages));
      for (const id of free) {
        const page = await asFreeAccount(id, passed);
        assert.equal(page.statusCode, 200, `${id}: a free account opens it after ${passed.size} free passes (${JSON.stringify(page.body)})`);
        assert.equal((page.body as CodingTaskResponse).locked, null, `${id}: unlocked by the free stages before it`);
        passed.add(id);
      }
      const after = challenge.stages[free.length];
      if (after) assert.equal((await asFreeAccount(after, passed)).statusCode, 402, `${after}: Premium with every free stage of ${challenge.id} passed`);
    }

    // A task travels with its puzzle, and a failed verdict carries its hint.
    const reverse = codingTaskById('js-reverse-string')!;
    const opened = mockResponse();
    await roadmapHandler(guest({ resource: 'coding-task', id: reverse.id }) as never, opened as never);
    assert.equal(opened.statusCode, 200, 'a guest opens js-reverse-string');
    const openedBody = opened.body as CodingTaskResponse;
    assert.ok(openedBody.task.puzzle && openedBody.session, 'the task travels with its puzzle and a session');
    assert.equal(typeof openedBody.task.prompt, 'string', 'the task prompt is plain English copy');
    const failed = mockResponse();
    await roadmapHandler(post('coding-submit', { session: openedBody.session, code: 'throw new Error("not yet");' }) as never, failed as never);
    assert.equal((failed.body as CodingVerdictResponse).failureHint?.category, 'runtime', 'a throwing submit gets the runtime hint');
    // V4-3: code that never parsed got the runtime hint, "check the values you
    // index into". The error names the line; no hint follows it.
    const unparsed = mockResponse();
    await roadmapHandler(post('coding-submit', { session: openedBody.session, code: 'function reverseString(s) { return s +; }' }) as never, unparsed as never);
    assert.match((unparsed.body as CodingVerdictResponse).codeError ?? '', /^SyntaxError: /, 'the sandbox names code that does not parse');
    assert.equal((unparsed.body as CodingVerdictResponse).failureHint, null, 'a syntax error gets no hint about values');

    // A deploy that lands before migration 039, against a PostgREST that has
    // none of its routines: the plan reads free instead of failing, and the
    // admin grant names the missing migration instead of answering 500.
    const before039 = {
      rpc: async (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } }),
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id } }, error: null }) } },
    };
    const plan = mockResponse();
    await handleEntitlement({ method: 'GET', headers: { authorization: 'Bearer contract' }, query: { user_id: 'contract-free-account' } } as never, plan as never, before039 as never);
    assert.equal(plan.statusCode, 200, 'op=entitlement answers before 039');
    assert.equal((plan.body as { tier: string }).tier, 'free');
    // A plan the database cannot read is unknown, not free and not a fault.
    const planDown = mockResponse();
    await handleEntitlement(
      { method: 'GET', headers: { authorization: 'Bearer contract' }, query: { user_id: 'contract-free-account' } } as never,
      planDown as never,
      { rpc: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) } as never,
    );
    assert.equal(planDown.statusCode, 503, 'a failed plan read answers 503, which the client retries');
    assert.equal((planDown.body as { error: { code: string } }).error.code, 'entitlement_unavailable');
    const grant = mockResponse();
    await handleAdminEntitlements(
      { method: 'POST', headers: {}, query: {}, body: { action: 'grant', userId: '0c0ffee0-0000-4000-8000-00000000c039', validUntil: null, note: 'contract' } } as never,
      grant as never,
      before039 as never,
    );
    assert.equal(grant.statusCode, 503);
    assert.equal((grant.body as { error: { code: string } }).error.code, 'migration_required', 'the admin grant names the missing migration');
    // A mistyped id is no account. supabase-js throws for an id that is not a
    // UUID before it asks Auth; that must not read as "the account exists".
    let granted = false;
    const mistyped = mockResponse();
    await handleAdminEntitlements(
      { method: 'POST', headers: {}, query: {}, body: { action: 'grant', userId: '0c0ffee0-0000-4000-8000', validUntil: null, note: 'contract' } } as never,
      mistyped as never,
      {
        rpc: async () => { granted = true; return { data: 'grant-id', error: null }; },
        auth: { admin: { getUserById: async () => { throw new Error('@supabase/auth-js: Expected parameter to be UUID but is not'); } } },
      } as never,
    );
    assert.equal(mistyped.statusCode, 404, `a grant to an id that is not an account is refused (${JSON.stringify(mistyped.body)})`);
    assert.equal(granted, false, 'nothing is granted to a mistyped id');
    // An Auth that does not answer cannot say the account exists: the grant
    // has no foreign key, so it waits instead of opening Premium for nobody.
    for (const [label, getUserById] of [
      ['an Auth 503', async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' } })],
      ['no answer at all', async () => { throw new Error('fetch failed'); }],
    ] as const) {
      const outage = mockResponse();
      await handleAdminEntitlements(
        { method: 'POST', headers: {}, query: {}, body: { action: 'grant', userId: '0c0ffee0-0000-4000-8000-00000000c040', validUntil: null, note: 'contract' } } as never,
        outage as never,
        { rpc: async () => { granted = true; return { data: 'grant-id', error: null }; }, auth: { admin: { getUserById } } } as never,
      );
      assert.equal(outage.statusCode, 503, `${label}: the grant waits for Auth (${JSON.stringify(outage.body)})`);
      assert.equal((outage.body as { error: { code: string } }).error.code, 'auth_unavailable');
      assert.equal(granted, false, `${label}: nothing is granted while Auth cannot answer`);
    }
    // The billing webhook keeps reading an Auth outage as "exists", so a paid
    // subscription is never dropped for it.
    assert.equal(await accountExists({ auth: { admin: { getUserById: async () => { throw new Error('fetch failed'); } } } } as never, '0c0ffee0-0000-4000-8000-00000000c040'), true);
    assert.equal(await accountExists({ auth: { admin: { getUserById: async () => ({ data: { user: null }, error: { status: 404, message: 'User not found' } }) } } } as never, '0c0ffee0-0000-4000-8000-00000000c040'), false);
    // The owner's view of one account: a plan that could not be read is not
    // shown as "not Premium".
    const grantRows: Record<string, unknown> = {
      select: () => grantRows, order: () => grantRows, limit: () => grantRows, eq: () => grantRows,
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    const accountView = mockResponse();
    await handleAdminEntitlements(
      { method: 'GET', headers: {}, query: { userId: 'contract-owner-account' } } as never,
      accountView as never,
      { from: () => grantRows, rpc: async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) } as never,
    );
    assert.equal(accountView.statusCode, 503, `an unreadable plan is not shown as free (${JSON.stringify(accountView.body)})`);
    assert.equal((accountView.body as { error: { code: string } }).error.code, 'entitlement_unavailable');
  }
}

/** Billing (#221). The behaviour itself is proven by
 * `npm run test:billing`; these are the structural rules around it. */
function billingContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const listFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
  // Checkout is off unless the deployment says otherwise, and only the server
  // holds a Stripe key.
  assert.deepEqual(publicBillingSettings({}), { enabled: false, cancellable: false, cancelByEmail: false, seller: null, launchOffer: false }, 'billing defaults to off');
  assert.equal(publicBillingSettings({ BILLING_ENABLED: 'true' }).enabled, false, 'BILLING_ENABLED alone sells nothing');
  assert.equal(
    DEFAULT_PUBLIC_ORIGIN,
    read('client/src/lib/publicMetadata.ts').match(/PUBLIC_ORIGIN = '([^']+)'/)?.[1],
    'Stripe returns buyers to the canonical origin',
  );
  const userOps = read('api/user/[op].ts');
  for (const op of ['billing-checkout', 'billing-portal', 'billing-webhook', 'billing-cancel']) {
    assert.match(userOps, new RegExp(`op === '${op}'`), `${op} is a branch of api/user/[op].ts, not a new handler`);
  }
  assert.match(userOps, /if \(req\.method === 'GET' \|\| op === 'billing-webhook' \|\|[^)]*\) return true;/, 'the signed webhook skips the write limiter');
  // Hosted Checkout and Portal only: no Stripe.js, no iframe, the CSP untouched.
  const clientPackage = read('client/package.json');
  assert.doesNotMatch(clientPackage, /stripe/i, 'the browser bundle carries no Stripe library');
  for (const file of listFiles(join(process.cwd(), 'client/src')).filter((path) => /\.(tsx?|css|html)$/.test(path))) {
    if (file.endsWith('/stripeCheckoutForm.ts')) continue;
    assert.doesNotMatch(read(file.slice(process.cwd().length + 1)), /js\.stripe\.com|@stripe\//, `${file} loads no Stripe script outside the checkout loader`);
  }
  const csp = read('vercel.json');
  assert.match(csp, /https:\/\/js\.stripe\.com/, 'Stripe.js is allowed by CSP');
  assert.match(csp, /https:\/\/checkout\.stripe\.com/, 'the hosted payment iframe is allowed');
  assert.match(read('client/src/lib/stripeCheckoutForm.ts'), /document\.head\.append\(script\)/, 'Stripe.js loads directly into the head');
  assert.match(read('lib/billing/handlers.ts'), /consent !== true/, 'the server requires explicit checkout consent');
  // Billing changes entitlements and nothing else.
  for (const file of listFiles(join(process.cwd(), 'lib/billing'))) {
    const source = read(file.slice(process.cwd().length + 1));
    assert.doesNotMatch(source, /user_xp|user_stats|user_category_stats|user_streak|roadmap_progress|coding_progress|token_ledger|token_balances|creditVerifiedXp|coding\/grade/, `${file} touches no learning, score or wallet data`);
  }
  for (const file of ['lib/coding/grade.ts', 'api/leaderboard.ts', 'api/quiz/submit.ts', 'api/play/[action].ts']) {
    assert.doesNotMatch(read(file), /lib\/billing/, `${file} grades or ranks and never reads billing`);
  }
}

/** Public copy, /premium and the legal pages (#222). */
function publicCopyContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  // devShark is freemium: no shipped English string may still promise that
  // everything is free.
  for (const [key, value] of Object.entries({ ...ENGLISH, ...LEARN_ENGLISH })) {
    assert.doesNotMatch(value, /free forever|\bis free\b|free, forever|\$0\b|charges for none/i, `${key} still says devShark is free`);
  }
  // The sentence the buyer ticks in Checkout is the one /premium and the
  // Terms quote, word for word.
  assert.equal(ENGLISH['premium.page.waiver'], WAIVER_TEXT, 'the waiver on /premium and in the Terms matches Checkout');
  // Every price the pages print says before VAT next to it.
  for (const key of ['landing.compare.premiumCaption', 'premium.page.monthlyRenews', 'premium.page.annualRenews', 'premium.sheet.price'] as const) {
    assert.match(ENGLISH[key], /before VAT/, `${key} states the price with VAT`);
  }
  // Redemption ships closed (DEFAULT_MERCH_SETTINGS.enabled is false), so
  // every place that sells Premium with merchandise says it depends on
  // redemption opening, and the Terms name the coin and merchandise benefit
  // (review finding product-6).
  assert.equal(DEFAULT_MERCH_SETTINGS.enabled, false);
  for (const key of ['premium.sheet.include6', 'landing.compare.premiumCoins'] as const) {
    assert.match(ENGLISH[key], /once redemption opens/, `${key} qualifies the merchandise claim`);
  }
  assert.match(read('client/src/components/landing/ComparisonTable.tsx'), /labelKey: 'landing\.compare\.rowCoins', free: NO, premium: \{ mark: 'yes', key: 'landing\.compare\.premiumCoins' \}/);
  // Merchandise is paused until next quarter (owner decision 10), so the
  // Terms name the coin benefit and no merchandise.
  assert.match(ENGLISH['legal.terms.plans.premium'], /doubles the coins verified learning earns and pays milestone coins\.$/);
  assert.doesNotMatch(ENGLISH['legal.terms.plans.premium'], /merchandise/);
  // Design audit P0.4: grading and end states are stated, not cheered. No
  // exclamation mark and no "Well done" in any verdict, result or end key.
  // The Learn page's own dictionary states results the same way.
  for (const [key, value] of Object.entries(LEARN_ENGLISH)) {
    assert.doesNotMatch(value, /!|Well done/i, `${key} cheers instead of stating the result`);
  }
  for (const [key, value] of Object.entries(ENGLISH)) {
    // Round two added the Learn end states (design review 2 R2-P1.13).
    if (!/\.(correct|wrong|verdict\.|gameOver|scoreSubmitted|finished)|roadmap\.(levelComplete|levelFailed|outOfHeartsTitle|checkpointComplete|allDone)/.test(key)) continue;
    assert.doesNotMatch(value, /!|Well done/i, `${key} cheers instead of stating the result`);
  }
  // Design audit P0.6: the header a visitor without a session sees. Today,
  // Collection, Leaderboard and Coins need an account; Premium is a text link
  // until there is one; Roadmap reads Career.
  {
    const app = read('client/src/App.tsx');
    const navBlock = app.slice(app.indexOf('const NAV_ITEMS'), app.indexOf('\n];', app.indexOf('const NAV_ITEMS')));
    const order = [...navBlock.matchAll(/\{ to: '([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(order.slice(0, 6), ['/today', '/learn', '/quiz', '/coding', '/challenge', '/play']);
    for (const route of ['/today', '/collection', '/leaderboard', '/shop']) {
      assert.match(navBlock, new RegExp(`to: '${route}'[^\\n]*signedIn: true`), `${route} needs a session`);
    }
    assert.match(app, /const SECONDARY_ROUTES = signedIn \? \['\/leaderboard', '\/premium', '\/shop'\] : \[\];/);
    assert.match(app, /\{signedIn && \(\n\s+<span className="ss-show-desktop"/);
    assert.equal(ENGLISH['nav.roadmap'], 'Career');
  }
  // Design audit P0.1: what does not exist yet is not shown. The coin and path
  // rows render only while their switch is on, the Premium list drops the
  // merchandise line until redemption opens, and production never shows the
  // shop's test-mode banner.
  {
    const table = read('client/src/components/landing/ComparisonTable.tsx');
    assert.match(table, /premiumCoins' \}, when: 'redemption' \}/);
    assert.match(table, /premiumPaths' \}, when: 'paths' \}/);
    assert.doesNotMatch(table, /rowNoAds/);
    assert.match(ENGLISH['landing.compare.footnote'], /No ads on either plan\./);
    assert.match(read('client/src/components/PremiumFacts.tsx'), /\(MERCH_ENABLED && redemptionOpen\) \|\| key !== 'premium\.sheet\.include6'/);
    assert.match(read('api/settings.ts'), /merch: \{ redemptionOpen: merchRedemptionOpen\(s\.merch\) \}/);
    assert.equal(merchRedemptionOpen(DEFAULT_MERCH_SETTINGS), false, 'redemption ships closed');
    const shop = read('client/src/components/Shop.tsx');
    assert.match(shop, /!import\.meta\.env\.PROD && shop\.data\?\.testMode/);
    assert.match(shop, /\{merchOpen && \(\n\s+<section className="rw-section" aria-labelledby="rw-merch-title">/);
    assert.match(shop, /\{merchOpen && checkout && \(/);
  }
  // Coding hints are authored text that nobody has reviewed yet; the privacy
  // policy must not say people wrote them by hand (review finding product-8).
  assert.doesNotMatch(PRIVACY_ENGLISH['legal.privacy.ai.body'], /by hand|people write/i);
  assert.match(PRIVACY_ENGLISH['legal.privacy.ai.body'], /no AI feature/);
  // The cancellation page stores the address typed there with its request,
  // and the privacy policy says how long (review finding integrity-1): the
  // next request purges every row a day past its expiry.
  assert.match(PRIVACY_ENGLISH['legal.privacy.email.body'], /single-use link that confirms a request, to the address typed on the page/);
  assert.match(PRIVACY_ENGLISH['legal.privacy.email.body'], /deletes both with the first request made on the page once the link has been expired for a day/);
  assert.match(read('supabase/supabase-schema-039.sql'), /DELETE FROM public\.billing_cancel_requests WHERE expires_at < NOW\(\) - INTERVAL '1 day';/, 'the purge the privacy policy promises');
  // No urgency, countdowns or fake scarcity on the pages that sell.
  for (const [key, value] of Object.entries(ENGLISH)) {
    if (!/^(premium\.|landing\.compare\.|billing\.checkout\.)/.test(key)) continue;
    assert.doesNotMatch(value, /\b(hurry|only \d+ left|limited time|ends soon|last chance|act now|today only)\b/i, `${key} uses urgency copy`);
  }
  // The routes exist, the public ones have static HTML on Vercel, and the
  // Stripe return page stays out of search.
  const app = read('client/src/App.tsx');
  for (const path of ['/premium', '/premium/success', '/premium/cancel']) {
    assert.match(app, new RegExp(`<Route path="${path}" element=`), `${path} is a route`);
  }
  assert.match(app, /<Route path="\/support" element={<Navigate to="\/premium" replace \/>} \/>/, '/support redirects to /premium');
  // The voluntary-support page is retired (#222), and the quiz prompt that
  // sent learners to it went too (#230): no screen links to /support.
  const clientSources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? clientSources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
  for (const file of clientSources(join(process.cwd(), 'client/src'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /navigate\(\s*['"]\/support['"]|\bto[=:]\s*\{?\s*['"]\/support['"]|href=["']\/support["']/, `${file} links to the retired /support page`);
  }
  assert.match(app, /to: '\/premium', key: 'nav\.premium'/, 'Premium sits in the navigation');
  const rewrites = (JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[] }).rewrites;
  for (const page of PUBLIC_PAGES) {
    assert.ok(rewrites.some((rule) => rule.source === page.path && rule.destination === `${page.path}/index.html`), `${page.path} serves its static HTML`);
  }
  assert.deepEqual([...NOINDEX_PATHS], ['/admin', '/admin/users', '/admin/vouchers', '/admin/emails', '/premium/success', '/premium/checkout', '/auth/confirmed', '/reset-password']);
  // The pages the confirmation and reset emails open are client routes (no
  // handler of their own), and the catch-all rewrite serves them the app.
  const catchAll = rewrites.find((rule) => rule.destination === '/index.html');
  for (const path of ['/auth/confirmed', '/reset-password']) {
    assert.match(app, new RegExp(`<Route path="${path}" element=`), `${path} is a route`);
    assert.ok(catchAll && new RegExp(`^${catchAll.source}$`).test(path), `${path} opens the app on Vercel`);
  }
  const schema = premiumSchema('Premium', 'Premium', 'https://devshark.app/premium');
  assert.equal(schema.isAccessibleForFree, false, 'Premium is not free to access');
  assert.ok(schema.offers.every((offer) => offer.priceSpecification.valueAddedTaxIncluded === false), 'the offers exclude VAT');
  // The trader is either unset or set, never a placeholder the page would print.
  for (const [field, value] of Object.entries(TRADER)) {
    assert.ok(value === null || (typeof value === 'string' && value.trim().length > 2 && !/todo|tbd|xxx|example|\[/i.test(value)), `TRADER.${field} is null or a real value`);
  }
  // The EU ODR platform closed on 20 July 2025; linking to it now misleads.
  assert.doesNotMatch(read('client/src/components/LegalPages.tsx'), /ec\.europa\.eu\/consumers\/odr/, 'no link to the closed ODR platform');
}

/* ── the retired support settings (#222, #230) ────────────────────────────
 *
 * The voluntary-support page and the quiz prompt are gone, and so are the
 * settings behind them: the SUPPORT_ENABLED flag, the `support` block of the
 * game settings and its fields in /dev → Settings. Rows saved before
 * 2026-09-26 may still carry the block, so reading one drops it and a save
 * from /dev writes the row without it. */
async function retiredSupportContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const legacy = {
    enabled: true, kofiUrl: 'https://ko-fi.com/devshark', githubSponsorsUrl: 'https://github.com/sponsors/devshark',
    monthlyTarget: 40, amountCovered: 12, lastUpdatedAt: '2026-09-01', costBreakdown: [{ label: 'Hosting', amount: 20 }],
    publicThanksEnabled: true,
  };
  assert.equal('support' in DEFAULT_SETTINGS, false, 'the game settings have no support block');
  const stored = normalizeSettings({ ...DEFAULT_SETTINGS, support: legacy });
  assert.equal('support' in stored, false, 'a stored support block is dropped when the row is read');
  assert.deepEqual(stored, normalizeSettings(DEFAULT_SETTINGS), 'a row with the old block reads exactly like one without it');
  assert.deepEqual(normalizeSettings({ ...stored, support: legacy }), stored, 'a save that still sends the block stores the row without it');

  const publicSettings = mockResponse();
  await settingsHandler({ method: 'GET', headers: {}, query: {} } as never, publicSettings as never);
  assert.equal(publicSettings.statusCode, 200);
  assert.equal('support' in (publicSettings.body as Record<string, unknown>), false, '/api/settings answers without a support block');
  // tests/fixtures/api-settings.json is the body the client tests and the
  // responsive sweep answer /api/settings with: this handler's own body at
  // default settings, except that checkout is on, as it is after launch.
  const settingsFixture = JSON.parse(read('tests/fixtures/api-settings.json')) as Record<string, unknown>;
  const liveSettings = publicSettings.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(settingsFixture).sort(), Object.keys(liveSettings).sort(), 'the settings fixture has the keys the handler sends');
  for (const key of Object.keys(liveSettings).filter((one) => one !== 'billing')) {
    assert.deepEqual(settingsFixture[key], liveSettings[key], `the settings fixture's ${key} is what the handler sends`);
  }
  assert.deepEqual(Object.keys(settingsFixture.billing as object).sort(), Object.keys(liveSettings.billing as object).sort(), 'the fixture\'s billing has the handler\'s keys');

  // The files that held the flag, the block and the /dev fields keep none of them.
  for (const file of ['api/settings.ts', 'lib/settings-store.ts', 'client/src/lib/gameConfig.ts', 'client/src/lib/devApi.ts',
                      'client/src/components/dev/DevSettings.tsx', 'client/.env.example', 'README.md']) {
    const source = read(file);
    assert.doesNotMatch(source, /SUPPORT_ENABLED/, `${file} still names SUPPORT_ENABLED`);
    assert.doesNotMatch(source, /^\s*support\s*[:?]/m, `${file} still declares a support block`);
    assert.doesNotMatch(source, /kofi|githubSponsors|publicThanks|costBreakdown|monthlyTarget|amountCovered/i, `${file} still has a support field`);
    assert.doesNotMatch(source, /Enable public support links|Voluntary support \(disabled by default\)/, `${file} still shows the /dev support fields`);
  }
  // And no other server or client source reads the switch.
  for (const file of ['api', 'lib', 'shared', 'client/src'].flatMap(codeFiles)) {
    assert.doesNotMatch(read(file), /SUPPORT_ENABLED|\bsupportEnabled\b|\.support\.enabled/, `${file} reads the retired support switch`);
  }
}

/** Coins (#227). Replays credit nothing, only
 * service-role routines credit, Premium doubles at credit time, and the
 * four streak-protection bounds still hold. The behaviour against a real
 * database is proven by the migration 041 proof (docs/release-acceptance.md). */
function coinsContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const listFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

  // 1. The default rates, and the social grant pays nothing.
  assert.deepEqual(DEFAULT_COIN_SETTINGS, {
    xpRate: 0.1,
    premiumMultiplier: 2,
    dailyXpCap: 400,
    welcomeGrant: 200,
    streakMilestones: [{ days: 7, coins: 25 }, { days: 30, coins: 100 }, { days: 100, coins: 300 }],
    topicComplete: 100,
    projectComplete: 150,
    shortPathComplete: 50,
    monthTop: [300, 200, 100],
    socialVisitGrant: 0,
    referralGrant: 100,
    referralCap: 20,
  });
  assert.equal(coinsForVerifiedXp(100, false), 10, 'every account earns 10 % of verified XP');
  assert.equal(coinsForVerifiedXp(100, true), 20, 'Premium doubles it');
  assert.equal(coinsUnderDailyCap(200, 300), 100, 'the daily cap applies after the doubling');
  assert.equal(coinsUnderDailyCap(50, 400), 0);
  // The game settings mirror the rates; a missing or bad social grant is 0.
  assert.deepEqual(normalizeSettings({}).coins, DEFAULT_COIN_SETTINGS);
  assert.equal(normalizeSettings({ coins: { socialVisitGrant: 'lots' } }).coins.socialVisitGrant, 0);
  assert.equal(normalizeSettings({ coins: { socialVisitGrant: 5, xpRate: 7, premiumMultiplier: 50 } }).coins.socialVisitGrant, 5);
  assert.equal(normalizeSettings({ coins: { xpRate: 7 } }).coins.xpRate, 0.1, 'a rate above 100 % is refused');
  assert.equal(normalizeSettings({ coins: { premiumMultiplier: 50 } }).coins.premiumMultiplier, 5, 'the multiplier is clamped');
  assert.deepEqual(
    normalizeSettings({ coins: { streakMilestones: [{ days: 7 }] } }).coins.streakMilestones,
    DEFAULT_COIN_SETTINGS.streakMilestones,
    'a malformed milestone list falls back as a whole',
  );

  // 2. Replaying any award, milestone or grant credits nothing: every event id
  // is derived from what the server verified, never drawn at random.
  const user = '00000000-0000-0000-0000-0000000000aa';
  assert.equal(learnAwardId(user, 'html', 'level', 3), learnAwardId(user, 'html', 'level', 3));
  assert.equal(learnAwardId(user, 'html', 'level', 3), `learn:${user}:html:L3`);
  assert.notEqual(learnAwardId(user, 'html', 'level', 3), learnAwardId(user, 'html', 'checkpoint', 3));
  assert.equal(codingAwardId(user, 'js-digit-sum'), `coding:${user}:js-digit-sum`);
  assert.match(accountKey('x'.repeat(100)), /^[0-9a-f]{32}$/, 'a long account id is hashed, as token_account_key does');
  assert.equal(learnLevelXp(1), 50);
  assert.equal(learnLevelXp(25), 250);
  assert.equal(learnCheckpointXp(3), 900);
  assert.equal(previousMonth(new Date('2026-01-03T00:00:00Z')), '2025-12');
  assert.equal(previousMonth(new Date('2026-09-25T12:00:00Z')), '2026-08');
  const migration = read('supabase/supabase-schema-041.sql');
  const routine = (name: string) => {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, `migration 041 defines ${name}`);
    return migration.slice(start, migration.indexOf('$$;', start));
  };
  const credit = routine('credit_verified_xp_tokens');
  assert.match(credit, /FROM public\.token_xp_credits WHERE event_id = v_event;\s*IF FOUND THEN RETURN 0;/, 'a replayed award returns 0');
  assert.match(credit, /FROM public\.token_ledger WHERE event_id = v_event;\s*IF FOUND THEN RETURN 0;/, 'an award credited before 041 is not credited again');
  assert.match(credit, /v_event := 'xp:' \|\| p_award_id;/, 'the ledger event is the award id, as before');
  assert.match(credit, /pg_advisory_xact_lock/, 'one account credits one at a time, so the cap cannot be raced');
  // Premium doubles at credit time, inside the routine and nowhere else.
  assert.match(credit, /IF public\.is_premium\(p_user_id\) THEN v_mult := p_premium_multiplier;/);
  assert.match(credit, /LEAST\(v_base \* v_mult, p_daily_cap - v_used\)/, 'the cap applies after the doubling');
  const milestones = routine('settle_coin_milestones');
  for (const key of ["'streak:' || v_days || ':' || v_key", "'topic:' || v_topic || ':' || v_key", "'project:' || v_id || ':' || v_key"]) {
    assert.ok(milestones.includes(key), `milestone event ${key} is one per account`);
  }
  assert.match(milestones, /v_premium := public\.is_premium\(p_user_id\);/, 'milestones read the plan in the database');
  // The month's top three are its learners with the most XP (migration 056,
  // owner decision 8), ties sharing the place: 056 restates 041's routine,
  // which ranked correct answers and gave each place one holder.
  const migration056 = read('supabase/supabase-schema-056.sql');
  const monthStart = migration056.indexOf('CREATE OR REPLACE FUNCTION public.settle_month_top3(');
  assert.ok(monthStart >= 0, 'migration 056 restates settle_month_top3');
  const month = migration056.slice(monthStart, migration056.indexOf('$$;', monthStart));
  assert.match(month, /ON CONFLICT \(month\) DO NOTHING;[\s\S]*IF v_inserted = 0 THEN/, 'a month settles once');
  assert.ok(month.includes("'month-top:' || p_month || ':' || v_row.rank || ':' || public.token_account_key(v_row.user_id)"),
    'one event per month, place and learner, so learners sharing a place are each paid once');
  assert.match(month, /FROM public\.month_xp_ranks\(p_subject, v_start\) r\s+WHERE r\.rank <= LEAST\(3,/, 'the month is ranked by its XP, and nobody below third is paid');
  const ranks = migration056.slice(migration056.indexOf('CREATE OR REPLACE FUNCTION public.month_xp_ranks('));
  assert.match(ranks.slice(0, ranks.indexOf('$$;')), /RANK\(\) OVER \(ORDER BY SUM\(d\.xp\) DESC\)/, 'equal XP shares a place (1, 1, 3)');
  assert.doesNotMatch(month, /streak/i, 'the month never ranks by streak');
  assert.match(migration056, /REVOKE ALL ON FUNCTION public\.settle_month_top3\(TEXT, TEXT, INTEGER\[\], INTEGER\) FROM PUBLIC, anon, authenticated;/);
  assert.match(migration056, /GRANT EXECUTE ON FUNCTION public\.settle_month_top3\(TEXT, TEXT, INTEGER\[\], INTEGER\) TO service_role;/);
  assert.match(routine('credit_social_visit'), /IF p_amount = 0 THEN RETURN FALSE;/, 'a zero grant credits nothing');
  assert.match(routine('record_coding_verdict'), /'coding:' \|\| public\.token_account_key\(p_user_id\) \|\| ':' \|\| p_task_id/,
    'coding XP is awarded once per account and task, not once per task');
  // Every credit goes through the ledger routine whose event id is its key.
  const ledger = read('supabase/supabase-schema-028.sql');
  assert.match(ledger, /ON CONFLICT \(event_id\) DO NOTHING;\s*GET DIAGNOSTICS v_applied = ROW_COUNT;\s*IF v_applied = 0 THEN RETURN FALSE;/);

  // 3. Only service-role routines credit, and they write no learning table.
  for (const name of ['credit_verified_xp_tokens', 'settle_coin_milestones', 'settle_month_top3', 'credit_social_visit', 'delete_coin_data', 'record_coding_verdict', 'revoke_premium_benefits']) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*\\)\\s*FROM PUBLIC, anon, authenticated;`), `${name} is revoked from browsers`);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*\\)\\s*TO service_role;`), `${name} is service-role only`);
    assert.match(routine(name), /SECURITY DEFINER\s*SET search_path = ''/, `${name} pins its search_path`);
  }
  for (const name of ['credit_verified_xp_tokens', 'settle_coin_milestones', 'settle_month_top3', 'credit_social_visit', 'revoke_premium_benefits']) {
    assert.doesNotMatch(routine(name), /(INSERT INTO|UPDATE|DELETE FROM) public\.(user_xp|user_stats|user_streak|roadmap_progress|coding_progress|user_category_stats|user_activity_days)/,
      `${name} reads progress and never writes it`);
  }
  // A revoked subscription takes back only what Premium paid while it was live
  // (review finding integrity-3): redemptions still waiting, through the
  // routine that returns their coins, and one debit with a fixed event id.
  const takeBack = routine('revoke_premium_benefits');
  assert.match(takeBack, /IF NOT FOUND OR v_grant\.status <> 'revoked' THEN/, 'only a revoked grant takes anything back');
  assert.match(takeBack, /IF public\.is_premium\(v_grant\.user_id\) THEN/, 'nothing while another grant keeps the account Premium');
  assert.match(takeBack, /o\.created_at >= v_grant\.created_at/, 'only orders placed while the grant existed');
  assert.match(takeBack, /public\.cancel_merch_order\(v_order, v_grant\.user_id, p_subject\)/);
  assert.match(takeBack, /NOT EXISTS \(SELECT 1 FROM public\.path_reward_claims c WHERE c\.order_id = o\.order_id\)/, 'a path package stays');
  assert.match(takeBack, /o\.payment_kind = 'tokens'/, 'an order paid with money stays');
  assert.match(takeBack, /v_debit := LEAST\(v_owed, COALESCE\(v_balance, 0\)\)/, 'the debit never drives a balance below zero');
  assert.ok(takeBack.includes("v_event := 'revoke:' || replace(v_grant.id::TEXT, '-', '');"), 'one debit per revoked grant');
  assert.match(read('lib/billing/sync.ts'), /await takeBackPremiumBenefits\(deps, result\.subscriptionId\);/, 'every revocation takes the benefits back');
  assert.match(migration, /ALTER TABLE public\.token_xp_credits\s+ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /REVOKE ALL ON public\.token_xp_credits\s+FROM PUBLIC, anon, authenticated;/);
  // The browser cannot post a credit: no client file names a credit routine,
  // and the wallet's POST takes a platform, never an amount.
  for (const file of listFiles(join(process.cwd(), 'client/src')).filter((path) => /\.tsx?$/.test(path))) {
    assert.doesNotMatch(read(file.slice(process.cwd().length + 1)),
      /credit_tokens|credit_verified_xp_tokens|settle_coin_milestones|settle_month_top3|credit_social_visit|grant_signup_tokens/,
      `${file} calls no credit routine`);
  }
  const rewardsHandlers = read('lib/rewards/handlers.ts');
  const walletPost = rewardsHandlers.slice(rewardsHandlers.indexOf("if (req.method === 'POST') {", rewardsHandlers.indexOf('export async function handleWallet')));
  assert.doesNotMatch(walletPost.slice(0, walletPost.indexOf('res.setHeader(\'Allow\'')), /body\.(amount|coins|tokens|xp)/, 'the wallet POST never reads an amount');
  // Opening a social profile pays nothing any more (design audit P0.3): the
  // server answers the old claim without crediting, the browser never sends
  // it, and the profiles are linked once, from the footer.
  assert.match(walletPost, /body\.claim === 'social'\) \{\n\s+res\.setHeader\('Cache-Control', 'private, no-store'\);\n\s+return res\.json\(\{ granted: false, coins: 0 \}\);/);
  assert.doesNotMatch(read('lib/rewards/coins.ts'), /credit_social_visit/);
  assert.doesNotMatch(read('client/src/lib/rewards.ts'), /claim: 'social'/);
  assert.match(read('client/src/components/BrandFooter.tsx'), /SOCIAL_PROFILES\[platform\]/);
  for (const screen of ['Profile.tsx', 'Shop.tsx']) {
    assert.doesNotMatch(read(`client/src/components/${screen}`), /SocialProfiles/, `${screen} no longer lists the social profiles`);
  }

  // 4. Merchandise is Premium only, and the refusal comes before the address.
  const orders = rewardsHandlers.slice(rewardsHandlers.indexOf('export async function handleOrders'));
  const gate = orders.indexOf("refuseLocked(res, userId, { kind: 'merch-redemption'");
  assert.ok(gate > 0 && gate < orders.indexOf('validateAddress(body.address)'), 'a free account gets 402 before it is asked for an address');
  assert.equal(contentTier({ kind: 'merch-redemption', sku: 'mug' }, serverContentIndex()), 'premium');
  // The crown and streak protection stay open to every account.
  for (const handler of ['handleCosmetic', 'handleStreakProtection']) {
    const body = rewardsHandlers.slice(rewardsHandlers.indexOf(`export async function ${handler}`));
    assert.doesNotMatch(body.slice(0, body.indexOf('\n}\n')), /refuseLocked|resolveTier/, `${handler} is not Premium only`);
  }

  // 5. The browser wallet is retired, and the welcome coins are the server's.
  const tokens = read('client/src/lib/tokens.ts');
  assert.doesNotMatch(tokens, /export function (awardTokens|spendTokens|grantRegistrationBonusIfNew|useTokens|getTokens)/);
  assert.doesNotMatch(read('client/src/lib/xp.ts'), /awardTokens|tokensFromXp/, 'XP gains award no browser tokens');
  assert.doesNotMatch(read('client/src/App.tsx'), /grantRegistrationBonusIfNew/);
  assert.match(rewardsHandlers, /supabase\.rpc\('grant_signup_tokens'/, 'the wallet read pays the welcome coins');

  // 6. The UI says coins, and the page is named Coins (design audit P1.3);
  // the code keeps `token`.
  assert.equal(ENGLISH['nav.shop'], 'Coins');
  assert.equal(ENGLISH['shop.title'], 'Coins');
  assert.equal(ENGLISH['shop.tokensUnit'], 'coins');
  for (const [key, value] of Object.entries(ENGLISH)) {
    if (!/^(shop\.|rewards\.|register\.|auth\.signupBonus)/.test(key)) continue;
    assert.doesNotMatch(value.replace(/\{\w+\}/g, ''), /\btokens?\b/i, `${key} says tokens; the product says coins`);
  }
  assert.match(read('docs/product-architecture.md'), /the UI calls it \*\*Coins\*\*/, 'the naming rule is written down');

  // 7. The social links reward nothing by default and never ask for a follow.
  assert.deepEqual(Object.keys(SOCIAL_PROFILES).sort(), [...SOCIAL_PLATFORMS].sort(), 'one URL per platform, in the catalogue');
  for (const [key, value] of Object.entries(ENGLISH)) {
    assert.doesNotMatch(value, /follow (us )?to earn|follow .* (for|to get) (coins|a reward)/i, `${key} pays for a follow`);
  }

  // 8. Milestones cover every evolving project and short path, priced by kind.
  const config = milestoneConfig(DEFAULT_COIN_SETTINGS) as { projects: { id: string; coins: number }[] };
  assert.equal(config.projects.length, EVOLVING_CHALLENGES.length);
  for (const challenge of EVOLVING_CHALLENGES) {
    const entry = config.projects.find((one) => one.id === challenge.id);
    assert.equal(entry?.coins, challenge.short ? 50 : 150, `${challenge.id} pays ${challenge.short ? 'a short path' : 'a project'}`);
  }

  // 9. Streak protection keeps its four bounds with coins in place of tokens:
  // the cap is two, there is no cash price, a protection changes the day count
  // only, and no board ranks by streak. (The bounds themselves are asserted
  // above; this checks the coin work did not reopen them.)
  assert.equal(STREAK_PROTECTION_CAP, 2);
  assert.doesNotMatch(read('shared/rewards.ts'), /streakProtection(Price|Cash|Minor)/);
  assert.match(read('shared/rewards.ts'), /No money buys a\s+\*\s+protection/);
}

/** Invitations (#228). 100 coins to each side, once,
 * after the friend's first Learn level; self-referral and a second completion
 * credit nothing; the cap holds; the grant routine writes only ledger tables;
 * the inviter never learns who a friend is. The behaviour against a real
 * database is proven by the migration 042 proof (docs/release-acceptance.md). */
async function referralContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const listFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

  // 1. The rules: 100 to each side, 20 friends per inviter, a 48-hour sign-up
  // window, and the settings mirror clamps them.
  assert.equal(DEFAULT_COIN_SETTINGS.referralGrant, 100);
  assert.equal(DEFAULT_COIN_SETTINGS.referralCap, 20);
  assert.equal(REFERRAL_SIGNUP_WINDOW_HOURS, 48);
  assert.equal(normalizeSettings({ coins: { referralGrant: 'lots' } }).coins.referralGrant, 100, 'a malformed grant falls back');
  assert.equal(normalizeSettings({ coins: { referralGrant: -5 } }).coins.referralGrant, 0, 'a negative grant clamps to off');
  assert.equal(normalizeSettings({ coins: { referralCap: 5000 } }).coins.referralCap, 1000, 'the cap is clamped');
  assert.equal(normalizeSettings({ coins: { referralGrant: 0 } }).coins.referralGrant, 0, '0 turns invitations off');
  assert.ok(isReferralCode('ge04xtw4'));
  for (const bad of ['GE04XTW4', 'ge04xtw', 'ge04xtwil', 'ge04xtwl', 'ge04-tw4', '', null]) {
    assert.equal(isReferralCode(bad), false, `${String(bad)} is not a code`);
  }

  // 2. The migration: service-role routines, RLS on, no browser read of who
  // invited whom, and the ledger reasons of 041 kept.
  const migration = read('supabase/supabase-schema-042.sql');
  const routine = (name: string) => {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, `migration 042 defines ${name}`);
    return migration.slice(start, migration.indexOf('$$;', start));
  };
  // The reason check is rebuilt from what it already allows plus 042's list,
  // so no order of re-running 041 and 042 narrows it (review finding data-3).
  for (const [file, reasons] of [
    ['supabase/supabase-schema-041.sql', "'signup', 'verified-xp', 'purchase', 'refund', 'adjustment', 'milestone', 'social'"],
    ['supabase/supabase-schema-042.sql', "'signup', 'verified-xp', 'purchase', 'refund', 'adjustment', 'milestone', 'social', 'referral'"],
  ] as const) {
    const source = read(file);
    assert.ok(source.includes(`v_reasons TEXT[] := ARRAY[${reasons}];`), `${file} names its reasons`);
    assert.match(source, /SELECT pg_get_constraintdef\(c\.oid\) INTO v_current[\s\S]*?regexp_matches\(COALESCE\(v_current, ''\)/, `${file} keeps the reasons the check already allows`);
    assert.doesNotMatch(source, /ADD CONSTRAINT token_ledger_reason_check\s+CHECK \(reason IN \('/, `${file} never restates the check from a fixed list alone`);
  }
  for (const name of ['referral_summary', 'record_referral', 'credit_referral', 'delete_referral_data']) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*\\) FROM PUBLIC, anon, authenticated;`), `${name} is revoked from browsers`);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*\\) TO service_role;`), `${name} is service-role only`);
    assert.match(routine(name), /SECURITY DEFINER\s*SET search_path = ''/, `${name} pins its search_path`);
  }
  assert.match(migration, /ALTER TABLE public\.referrals\s+ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /ALTER TABLE public\.referral_codes ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(migration, /CREATE POLICY[^;]*ON public\.referrals\b/, 'no browser policy reads who invited whom');
  assert.doesNotMatch(migration, /GRANT [A-Z, ]+ ON public\.referrals TO/, 'no browser grant on referrals');
  assert.match(migration, /CHECK \(invitee_user_id <> referrer_user_id\)/, 'a row can never refer an account to itself');

  // 3. The grant routine writes only ledger tables: the referral row, and the
  // wallet through credit_tokens, which writes token_ledger and token_balances.
  const credit = routine('credit_referral');
  const writes = (body: string) => [...new Set([...body.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.([a-z_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(writes(credit), ['referrals'], 'credit_referral writes only the referral row directly');
  assert.deepEqual([...new Set([...credit.slice(credit.indexOf('AS $$')).matchAll(/public\.([a-z_]+)\(/g)].map((m) => m[1]))].sort(), ['credit_tokens', 'token_account_key'],
    'credit_referral calls only the ledger routine');
  const ledger = read('supabase/supabase-schema-028.sql');
  const creditTokens = ledger.slice(ledger.indexOf('CREATE OR REPLACE FUNCTION public.credit_tokens('), ledger.indexOf('$$;', ledger.indexOf('CREATE OR REPLACE FUNCTION public.credit_tokens(')));
  assert.deepEqual(writes(creditTokens), ['token_balances', 'token_ledger'], 'credit_tokens writes the wallet and nothing else');
  assert.deepEqual(writes(routine('record_referral')), ['referrals']);
  assert.deepEqual(writes(routine('referral_summary')), ['referral_codes']);
  // Once per friend, both sides; nothing before a passed Learn level.
  assert.match(credit, /FROM public\.referrals WHERE invitee_user_id = p_invitee FOR UPDATE;/, 'the friend\'s row is locked while it settles');
  assert.match(credit, /IF v_row\.credited_at IS NOT NULL THEN RETURN 'already';/, 'a second completion credits nothing');
  assert.match(credit, /jsonb_path_exists\(v_data, '\$\.\*\.levels\.\*\.passed \? \(@ == true\)'\)/, 'the grant waits for a passed Learn level');
  assert.ok(credit.includes("'referral:' || public.token_account_key(p_invitee)"), 'the friend\'s event is referral:<invitee>');
  assert.ok(credit.includes("'referral:friend:' || v_row.credit_key"), 'the inviter\'s event carries a random key, never the friend\'s id');
  // The cap counts the inviter's own ledger, one friend at a time.
  assert.match(credit, /pg_advisory_xact_lock\(hashtextextended\('referral:' \|\| v_row\.referrer_user_id, 0\)\)/);
  assert.match(credit, /IF v_paid < p_cap THEN/, 'the inviter is paid only under the cap');
  // Self-referral and a sign-up window are decided when the code is bound.
  const record = routine('record_referral');
  assert.match(record, /IF v_referrer = p_invitee THEN RETURN 'self';/, 'the account\'s own code binds nothing');
  // Two accounts offering each other's code at once run one after the other
  // (review finding integrity-6): the unordered pair is locked before the
  // reverse-pair check.
  const pairLock = record.indexOf("'referral-pair:' || LEAST(p_invitee, v_referrer) || ':' || GREATEST(p_invitee, v_referrer)");
  assert.ok(pairLock > 0, 'record_referral locks the unordered pair');
  assert.ok(pairLock < record.indexOf('WHERE invitee_user_id = v_referrer AND referrer_user_id = p_invitee'), 'the lock comes before the reverse-pair check');
  assert.match(record, /p_account_created_at < NOW\(\) - make_interval\(hours => p_window_hours\)/, 'only a new account binds a code');

  // 4. The server: credits ride on verified work, and the code's creation time
  // comes from the verified token.
  assert.match(read('api/user/[op].ts'), /if \(op === 'referral'\) return handleReferral\(req, res, supabase\);/);
  assert.match(read('supabase/supabase-schema-044.sql'), /DELETE FROM public\.referral_codes WHERE user_id = p_user_id;/, 'account deletion removes the referral data');
  assert.match(read('api/quiz/roadmap.ts'), /await creditReferral\(supabase, userId, session\.subject!\);/, 'a first Learn pass settles an invitation');
  assert.match(read('lib/rewards/handlers.ts'), /creditReferral\(supabase, userId, subject\)/, 'the wallet read settles an invitation');
  assert.equal(accountCreatedAt({ created_at: '2026-09-25T10:00:00Z' }), '2026-09-25T10:00:00.000Z');
  assert.equal(accountCreatedAt({}), null);
  assert.equal(accountCreatedAt({ created_at: 'yesterday' }), null);
  for (const file of listFiles(join(process.cwd(), 'client/src')).filter((path) => /\.tsx?$/.test(path))) {
    assert.doesNotMatch(read(file.slice(process.cwd().length + 1)), /credit_referral|record_referral|referral_summary/, `${file} calls no referral routine`);
  }
  assert.match(read('client/src/lib/referral.ts'), /body: JSON\.stringify\(\{ code \}\)/, 'the browser sends the code and nothing else');

  // 5. The handler, against a stand-in database: the GET sends counts and no
  // account id, the POST takes the creation time from the token and never from
  // the body, and it asks for no amount.
  {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const fake = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === 'referral_summary') {
          return { data: { code: 'abcd2345', credited: 3, pending: 1, invited: null, invitee_user_id: 'leak', friends: ['someone'] }, error: null };
        }
        if (fn === 'record_referral') return { data: 'recorded', error: null };
        if (fn === 'credit_referral') return { data: 'waiting', error: null };
        return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
      },
    };
    const request = (method: string, body?: Record<string, unknown>) => ({
      method, headers: {}, query: { op: 'referral', user_id: 'contract-referral-account' },
      body: body ? { ...body, user_id: 'contract-referral-account' } : undefined,
    });
    const get = mockResponse();
    await handleReferral(request('GET') as never, get as never, fake as never);
    assert.equal(get.statusCode, 200);
    assert.deepEqual(get.body, { enabled: true, code: 'abcd2345', coins: 100, cap: 20, credited: 3, pending: 1, invited: null },
      'the invite summary carries counts and no account id');
    calls.length = 0;
    const post = mockResponse();
    await handleReferral(request('POST', { code: ' ABCD2345 ', created_at: new Date().toISOString(), amount: 5000 }) as never, post as never, fake as never);
    assert.equal(post.statusCode, 200);
    assert.deepEqual(post.body, { status: 'recorded', coins: 100 });
    const recorded = calls.find((call) => call.fn === 'record_referral');
    assert.equal(recorded?.args.p_code, 'abcd2345');
    assert.equal(recorded?.args.p_account_created_at, null, 'a creation time in the body is ignored');
    assert.equal(recorded?.args.p_window_hours, 48);
    const settled = calls.find((call) => call.fn === 'credit_referral');
    assert.deepEqual(settled?.args, { p_invitee: 'contract-referral-account', p_subject: 'webdev', p_amount: 100, p_cap: 20 },
      'the amount comes from settings, never from the request');
    calls.length = 0;
    const bad = mockResponse();
    await handleReferral(request('POST', { code: 'nope' }) as never, bad as never, fake as never);
    assert.equal(bad.statusCode, 400);
    assert.equal(calls.length, 0, 'a malformed code reaches no routine');
  }

  // 6. Copy: the ledger line the issue names, and the unit is coins.
  assert.equal(ENGLISH['rewards.ledger.referralFriend'], 'Referral: a friend finished their first level');
  assert.equal(ENGLISH['shop.reason.referral'], 'Referral');
  assert.match(read('client/src/components/Shop.tsx'), /reference === 'referral:friend' \? t\('rewards\.ledger\.referralFriend'\)/);
}

/** Merchandise through Spreadshop (#229). */
async function merchContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const listFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

  // 1. The catalogue: a hoodie in the t-shirt sizes, the cap kept and unpriced,
  // nothing priced by default and cash checkout off.
  assert.ok(MERCH_SKUS.includes('hoodie'), 'the hoodie is a SKU');
  assert.deepEqual(MERCH_CATALOGUE.find((item) => item.sku === 'hoodie')?.variants, SHIRT_SIZES);
  assert.ok(MERCH_SKUS.includes('cap'), 'the cap stays in the catalogue');
  assert.deepEqual(normalizeSettings({}).merch.pricing, {}, 'no item ships with a price, the cap included');
  assert.equal(DEFAULT_MERCH_SETTINGS.cashCheckoutEnabled, false, 'cash is paid in the Spreadshop checkout');
  assert.equal(normalizeSettings({}).merch.cashCheckoutEnabled, false);

  // 2. Migration 043: both SKU checks name exactly the catalogue, the stock
  // routine takes the catalogue's sizes, and every routine is service-role only.
  const migration = read('supabase/supabase-schema-043.sql');
  const checks = [...migration.matchAll(/ADD CONSTRAINT (merch_stock_sku_check|merch_order_items_sku_check)\s+CHECK \(sku IN \(([^)]*)\)\)/g)];
  assert.equal(checks.length, 2, 'migration 043 restates both SKU checks');
  for (const [, name, list] of checks) {
    assert.deepEqual(list.split(',').map((one) => one.trim().replace(/'/g, '')), [...MERCH_SKUS], `${name} lists exactly MERCH_SKUS`);
  }
  assert.match(migration, /v_variant NOT IN \('S', 'M', 'L', 'XL', 'XXL'\)/);
  assert.deepEqual([...SHIRT_SIZES], ['S', 'M', 'L', 'XL', 'XXL'], 'set_merch_stock and the catalogue agree on sizes');
  for (const name of ['set_merch_stock', 'advance_merch_order', 'cancel_merch_order']) {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, `migration 043 defines ${name}`);
    const body = migration.slice(start, migration.indexOf('$$;', start));
    assert.match(body, /SECURITY DEFINER\s+SET search_path = ''/, `${name} is a definer routine with an empty search_path`);
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`), `${name} is revoked from browsers`);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`), `${name} runs as the service role`);
  }
  assert.match(migration, /IF FOUND AND p_on_hand < v_reserved THEN\s+RAISE EXCEPTION 'below_reserved'/, 'a cap never drops below paid orders');
  assert.match(migration, /path_reward_claims c WHERE c\.order_id = p_order_id/, 'a package is known by its claim, not by its id');
  assert.doesNotMatch(migration, /CREATE POLICY|user_xp|roadmap_progress|coding_progress|token_ledger/, '043 adds no policy and touches no learning table or wallet row');

  // 3. The shop links live in client/product-catalog.ts alone, empty until the
  // owner sets them, https when set, and nothing embeds Spreadshop.
  assert.deepEqual(Object.keys(MERCH_SHOP.products).sort(), [...MERCH_SKUS].sort(), 'one product URL per SKU, in the catalogue');
  for (const url of [MERCH_SHOP.shopUrl, ...Object.values(MERCH_SHOP.products)]) {
    if (url !== null) assert.match(url, /^https:\/\/[^\s"'<>]+$/, `${url} must be an https URL`);
  }
  const clientFiles = [
    ...listFiles(join(process.cwd(), 'client/src')).filter((path) => /\.(tsx?|css|html)$/.test(path)),
    join(process.cwd(), 'client/index.html'),
  ];
  for (const file of clientFiles) {
    const source = read(file.slice(process.cwd().length + 1));
    assert.doesNotMatch(source, /https?:\/\/[^\s"'`]*(spreadshop|spreadshirt|sprd\.net)/i, `${file} defines no Spreadshop URL; client/product-catalog.ts does`);
    assert.doesNotMatch(source, /currentPromotion|SPREADSHOP_API_KEY/, `${file} never calls the Spreadshop API`);
  }
  assert.doesNotMatch(read('vercel.json'), /spread|sprd/i, 'the CSP names no Spreadshop host');
  assert.match(read('client/src/lib/merchImages.ts'), /: \{\};/, 'a SKU without a mockup gets no image, not a placeholder');
  let merchFiles: string[] = [];
  try { merchFiles = readdirSync(join(process.cwd(), 'client/public/merch')); } catch { merchFiles = []; }
  for (const file of merchFiles) {
    assert.match(file, new RegExp(`^(${MERCH_SKUS.join('|')})\\.(webp|avif|png|jpe?g)$`), `client/public/merch/${file} must be named <sku>.<ext>`);
  }

  // 4. Spreadshop's promotion: read on the server only, parsed defensively,
  // cached, and absent without configuration.
  const now = new Date('2026-09-25T12:00:00Z');
  assert.equal(parseSpreadshopPromotion(404, null, now), null, 'no promotion running');
  assert.deepEqual(
    parseSpreadshopPromotion(200, { description: '15% off everything', validUntil: '2026-09-30T23:59:59', code: 'SHARK15' }, now),
    { description: '15% off everything', code: 'SHARK15', validUntil: '2026-09-30T23:59:59.000Z' },
    'Spreadshop sends UTC without a zone',
  );
  assert.equal(parseSpreadshopPromotion(200, { description: 'Old', validUntil: '2026-09-01T00:00:00', code: 'X1' }, now), null, 'an expired promotion is dropped');
  assert.equal(parseSpreadshopPromotion(200, { description: '', validUntil: '2026-09-30T23:59:59' }, now), null);
  assert.equal(parseSpreadshopPromotion(200, { description: 'x'.repeat(200), validUntil: '2026-09-30T23:59:59' }, now), null);
  assert.equal(parseSpreadshopPromotion(200, { description: 'Deal', validUntil: 'soon' }, now), null);
  assert.equal(parseSpreadshopPromotion(200, { description: 'Deal', validUntil: '2026-09-30T23:59:59', code: '<b>x</b>' }, now)?.code, null);
  assert.equal(spreadshopConfig({}), null);
  assert.equal(spreadshopConfig({ SPREADSHOP_API_KEY: 'dd30b4db-8cd6-4fb8-86b3-e680984b9e18', SPREADSHOP_SHOP_ID: 'not-a-number' }), null);
  const config = spreadshopConfig({
    SPREADSHOP_API_KEY: 'dd30b4db-8cd6-4fb8-86b3-e680984b9e18', SPREADSHOP_SHOP_ID: '100488332', SPREADSHOP_CONTACT_EMAIL: 'shop@example.com',
  });
  assert.equal(config?.url, 'https://api.spreadshirt.net/api/v1/shops/100488332/currentPromotion?mediaType=json');
  assert.equal(config?.headers.Authorization, 'SprdAuth apiKey="dd30b4db-8cd6-4fb8-86b3-e680984b9e18"');
  assert.equal(config?.headers['User-Agent'], 'devShark/1.0 ( https://devshark.app ; shop@example.com )');
  let calls = 0;
  const env = { SPREADSHOP_API_KEY: 'dd30b4db-8cd6-4fb8-86b3-e680984b9e18', SPREADSHOP_SHOP_ID: '100488332' };
  const fakeFetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ description: '15% off everything', validUntil: '2026-09-30T23:59:59', code: 'SHARK15' }), { status: 200 });
  }) as typeof fetch;
  resetMerchPromoCache();
  assert.equal(await getMerchPromo({ env: {}, fetchImpl: fakeFetch }), null);
  assert.equal(calls, 0, 'nothing is fetched without a key and a shop id');
  const clock = { at: now.getTime() };
  const first = await getMerchPromo({ env, fetchImpl: fakeFetch, now: () => new Date(clock.at) });
  const second = await getMerchPromo({ env, fetchImpl: fakeFetch, now: () => new Date(clock.at) });
  assert.equal(first?.code, 'SHARK15');
  assert.deepEqual(second, first);
  assert.equal(calls, 1, 'the answer is cached');
  clock.at += 31 * 60 * 1000;
  await getMerchPromo({ env, fetchImpl: fakeFetch, now: () => new Date(clock.at) });
  assert.equal(calls, 2, 'and refreshed after 30 minutes');
  resetMerchPromoCache();
  const failing = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.equal(await getMerchPromo({ env, fetchImpl: failing }), null, 'an unreachable Spreadshop means no promotion, never an error');
  resetMerchPromoCache();
  assert.match(read('api/settings.ts'), /merchPromo,/, '/api/settings reports the promotion');

  // 5. Copy: coins redeem items, never discounts. Only Spreadshop's own offer
  // may speak of one, and its note says coins never do.
  for (const [key, value] of Object.entries(ENGLISH)) {
    if (!/^(shop|rewards)\./.test(key) || key.startsWith('shop.promo')) continue;
    assert.doesNotMatch(value, /discount|coupon|voucher|promo code|% off/i, `${key} must not promise a discount`);
  }
  assert.match(ENGLISH['shop.promoNote'], /Coins redeem a whole item, never a discount\./);
  assert.match(ENGLISH['shop.addressNote'], /sprd\.net AG/, 'the form says where the address goes');
  assert.match(ENGLISH['shop.addressNote'], /Deleting your account deletes them/, 'and that it goes with the account');
  assert.equal(ENGLISH['shop.availability.unconfigured'], 'Not on sale yet');
  for (const sku of MERCH_SKUS) {
    assert.ok(ENGLISH[`shop.merch.${sku}.name` as keyof typeof ENGLISH], `${sku} has a name`);
    assert.ok(ENGLISH[`shop.merch.${sku}.alt` as keyof typeof ENGLISH], `${sku} has alt text for its mockup`);
  }

  // 6. The handlers: the 402 still comes before the address, a size is the
  // item's own, and the fulfilment op stays admin-only.
  const handlers = read('lib/rewards/handlers.ts');
  assert.match(handlers, /if \(!item\.variants\.includes\(variant\)\) return null;/, 'a size must be one the item has');
  const fulfilment = handlers.slice(handlers.indexOf('export async function handleFulfilment('));
  // The admin bucket, then the admin: a GET skips the route's write limit
  // (SEC-9), so the gate takes the bucket api/admin takes.
  assert.match(
    fulfilment.slice(0, 300),
    /\{\n  if \(!\(await enforceRateLimit\(req, res, RATE_LIMITS\.admin\)\)\) return;\n  if \(!\(await requireAdmin\(req, res\)\)\) return;/,
    'op=fulfilment takes the admin bucket, then checks the admin, before anything else',
  );
  assert.match(fulfilment, /supabase\.rpc\('set_merch_stock'/, 'the cap is written by the 043 routine');
}

/* ── Premium vouchers (migration 045) ────────────────────────────────────
 *
 * A signed-in learner redeems a code the owner created, and Premium opens as
 * a promo grant. The migration itself is proven against a real Postgres (the
 * VOUCHER section of docs/release-acceptance.md); these are the structural
 * rules, the code format and the handlers against a stand-in database. */
async function voucherContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const listFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
  const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

  // 1. Migration 045: service-role routines, both tables closed to browsers,
  // no plain code anywhere, and nothing but entitlements touched.
  const sql = read('supabase/supabase-schema-045.sql');
  const code = sql.replace(/--[^\n]*/g, '');
  const routine = (name: string) => {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, `migration 045 defines ${name}`);
    return sql.slice(start, sql.indexOf('$$;', sql.indexOf('AS $$', start)));
  };
  for (const name of ['premium_voucher_json', 'create_premium_voucher', 'list_premium_vouchers', 'revoke_premium_voucher', 'redeem_premium_voucher', 'delete_user_data']) {
    assert.match(routine(name), /SECURITY DEFINER\s+SET search_path = ''/, `${name} is a definer routine with an empty search_path`);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*\\) FROM PUBLIC, anon, authenticated;`), `${name} is revoked from browsers`);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*\\) TO service_role;`), `${name} runs as the service role`);
  }
  for (const table of ['premium_vouchers', 'premium_voucher_redemptions']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`), `${table} has RLS`);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM PUBLIC, anon, authenticated;`), `${table} revokes browser privileges`);
  }
  assert.doesNotMatch(code, /CREATE POLICY/, 'no browser policy reads a voucher or a redemption');
  assert.doesNotMatch(code, /GRANT [A-Z, ]+ ON (TABLE )?public\.premium_/, 'no browser grant on the voucher tables');
  assert.doesNotMatch(code, /TO (anon|authenticated)\b/, 'anon and authenticated hold nothing');
  const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.premium_vouchers ('), sql.indexOf('\n);', sql.indexOf('CREATE TABLE IF NOT EXISTS public.premium_vouchers (')));
  assert.match(table, /code_hash\s+TEXT NOT NULL UNIQUE CHECK \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, 'only a SHA-256 in hex fits code_hash');
  assert.match(table, /code_hint\s+TEXT NOT NULL CHECK \(code_hint ~ '\^\[0-9A-Z\]\{4\}\$'\)/, 'the hint is four characters');
  assert.doesNotMatch(table.replace(/--[^\n]*/g, '').replace(/code_(hash|hint)/g, ''), /\bcode\b/, 'no column holds the plain code');
  // The redemption: the row is locked, "already" is told apart, and the grant
  // is a promo grant named by the hint.
  const redeem = routine('redeem_premium_voucher');
  assert.match(redeem, /WHERE code_hash = p_code_hash\s+FOR UPDATE;/, 'the voucher row is locked before its count is read');
  assert.ok(redeem.indexOf("'already'") < redeem.indexOf('v_voucher.redeemed_count >= v_voucher.max_redemptions'), 'an account that redeemed the voucher hears so first');
  assert.match(redeem, /NOT v_voucher\.active\s+OR \(v_voucher\.redeemable_until IS NOT NULL AND v_voucher\.redeemable_until <= NOW\(\)\)\s+OR v_voucher\.redeemed_count >= v_voucher\.max_redemptions THEN\s+RETURN jsonb_build_object\('status', 'invalid'\);/,
    'inactive, expired and used-up codes get the answer an unknown code gets');
  assert.match(redeem, /VALUES \(p_user_id, 'promo', 'active', v_valid_until, 'Voucher ' \|\| v_voucher\.code_hint\)/, 'a promo grant, noted by the hint');
  const writes = (body: string) => [...new Set([...body.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.([a-z_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(writes(redeem), ['entitlement_grants', 'premium_voucher_redemptions', 'premium_vouchers'], 'a redemption writes the grant, the count and its row, nothing else');
  assert.deepEqual(writes(routine('create_premium_voucher')), ['premium_vouchers']);
  assert.deepEqual(writes(routine('revoke_premium_voucher')), ['premium_vouchers']);
  // Premium changes which content a learner may start and nothing else: from
  // the tables to the redemption, nothing names a learning, score, streak or
  // wallet table (the guard before them only checks that tables exist, and
  // the erasure after them deletes the account's rows).
  const vouchersPart = code.slice(code.indexOf('CREATE TABLE IF NOT EXISTS public.premium_vouchers ('), code.indexOf('CREATE OR REPLACE FUNCTION public.delete_user_data('));
  for (const learning of ['user_xp', 'user_stats', 'user_category_stats', 'user_streak', 'roadmap_progress', 'coding_progress', 'token_ledger', 'token_balances', 'user_activity_days']) {
    assert.ok(!vouchersPart.includes(learning), `migration 045 must not touch ${learning}`);
  }
  // One erasure routine: 044's body word for word, then the redemptions, and
  // a voucher an erased admin created loses the person.
  const body044 = read('supabase/supabase-schema-044.sql');
  const erasure044 = body044.slice(body044.indexOf('AS $$', body044.indexOf('FUNCTION public.delete_user_data(')), body044.indexOf('$$;', body044.indexOf('FUNCTION public.delete_user_data(')));
  const erasure045 = routine('delete_user_data').slice(routine('delete_user_data').indexOf('AS $$'));
  assert.ok(erasure045.startsWith(erasure044.slice(0, erasure044.lastIndexOf('END;'))), "045 restates 044's delete_user_data unchanged before its own lines");
  assert.match(erasure045, /DELETE FROM public\.premium_voucher_redemptions WHERE user_id = p_user_id;/, 'erasure removes the redemptions');
  assert.match(erasure045, /UPDATE public\.premium_vouchers SET created_by = 'deleted-account' WHERE created_by = p_user_id;/, "and anonymises a voucher's creator");
  assert.match(sql, /grant_id\s+UUID NOT NULL UNIQUE REFERENCES public\.entitlement_grants \(id\) ON DELETE CASCADE/, "erasing an account's grants also removes the voucher redemptions that opened them");

  // 2. The code: Crockford base32, twelve characters, normalised the same way
  // everywhere, and stored only as its SHA-256.
  assert.equal(VOUCHER_ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  assert.equal(normalizeVoucherCode(' k7q2-abcd 1234 '), 'K7Q2ABCD1234', 'upper case, no spaces or hyphens');
  assert.equal(normalizeVoucherCode('K7Q2\u2013ABCD\u00a01234'), 'K7Q2ABCD1234', 'an en dash and a no-break space from a copy');
  assert.equal(normalizeVoucherCode('ＫＹＱ２ＡＢＣＤ１２３４'), 'KYQ2ABCD1234', 'full-width characters fold to ASCII');
  assert.equal(normalizeVoucherCode('devshark-2026'), 'DEVSHARK2026', 'a custom campaign code');
  for (const bad of ['abc12', 'x'.repeat(33), 'K7Q2!ABCD', 'K7Q2_ABCD', 'čau-2026', '', '      ', 42, null, 'a'.repeat(65)]) {
    assert.equal(normalizeVoucherCode(bad), null, `${JSON.stringify(bad)} is not a code`);
  }
  assert.equal(formatVoucherCode('K7Q2ABCD1234'), 'K7Q2-ABCD-1234');
  assert.equal(voucherHint('K7Q2ABCD1234'), 'K7Q2');
  assert.equal(voucherHash('K7Q2ABCD1234'), '60d3dfedc46956b067ee7e73187990ace1b714c43e5550a5151315ac6cb35e05', "the SHA-256 Postgres's sha256() gives (release acceptance, VOUCHER)");
  const generated = Array.from({ length: 2000 }, () => generateVoucherCode());
  assert.equal(new Set(generated).size, generated.length, 'two thousand generated codes are all different');
  const counts = new Map<string, number>();
  for (const one of generated) {
    assert.match(one, /^[0-9A-HJKMNP-TV-Z]{12}$/, `${one} is twelve Crockford characters`);
    assert.equal(normalizeVoucherCode(formatVoucherCode(one)), one, 'a formatted code normalises back to itself');
    for (const char of one) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  assert.equal(counts.size, 32, 'every character of the alphabet occurs');
  assert.ok(Math.max(...counts.values()) / Math.min(...counts.values()) < 1.35, 'and about equally often');
  const now = Date.parse('2026-09-26T12:00:00Z');
  const base = { active: true, redeemedCount: 0, maxRedemptions: 1, redeemableUntil: null };
  assert.equal(voucherState(base, now), 'open');
  assert.equal(voucherState({ ...base, redeemedCount: 1 }, now), 'used');
  assert.equal(voucherState({ ...base, redeemableUntil: '2026-09-26T12:00:00Z' }, now), 'expired');
  assert.equal(voucherState({ ...base, active: false, redeemedCount: 1 }, now), 'revoked', 'revoked wins');
  assert.equal(toAdminVoucher({ id: 'x', hint: 'K7Q2', codeHash: 'leak', maxRedemptions: 1, redeemedCount: 0, active: true }, now)!.state, 'open');
  assert.equal('codeHash' in toAdminVoucher({ id: 'x', hint: 'K7Q2', codeHash: 'leak' }, now)!, false, 'the admin shape drops anything else');
  const form = (extra: Record<string, unknown>) => parseVoucherForm({ note: 'For Pavel', ...extra }, now);
  assert.deepEqual(form({}), { ok: true, value: { note: 'For Pavel', premiumDays: null, maxRedemptions: 1, redeemableUntil: null, code: null } }, 'no days means no end; one use by default');
  assert.equal(form({ premiumDays: 30, maxRedemptions: 25, code: 'shark-camp-2026' }).ok, true);
  for (const bad of [{ note: '' }, { note: 'x'.repeat(501) }, { premiumDays: 0 }, { premiumDays: 1831 }, { premiumDays: '30' }, { maxRedemptions: 0 }, { maxRedemptions: 10001 },
    { redeemableUntil: '2026-09-25' }, { redeemableUntil: '2040-01-01' }, { code: 'abc' }, { code: 'no_underscores' }, { note: 'For\u0000Pavel' }]) {
    assert.equal(form(bad).ok, false, `${JSON.stringify(bad)} is refused`);
  }

  // 3. The routes: a branch of each existing handler, the admin one behind
  // the admin check, and the browser sends the typed code and nothing else.
  const userOps = read('api/user/[op].ts');
  assert.match(userOps, /if \(op === 'voucher'\) return handleVoucherRedeem\(req, res, supabase\);/, 'op=voucher is a branch of api/user/[op].ts');
  const adminOps = read('api/admin/[op].ts');
  assert.ok(adminOps.indexOf('await requireAdmin(req, res)') < adminOps.indexOf("case 'vouchers':"), 'op=vouchers sits behind requireAdmin');
  assert.match(adminOps, /case 'vouchers':\s+return await handleAdminVouchers\(req, res, supabase\);/);
  for (const file of listFiles(join(process.cwd(), 'client/src')).filter((path) => /\.tsx?$/.test(path))) {
    assert.doesNotMatch(read(file.slice(process.cwd().length + 1)), /redeem_premium_voucher|create_premium_voucher|list_premium_vouchers|revoke_premium_voucher/, `${file} calls no voucher routine`);
  }
  assert.match(read('client/src/lib/voucher.ts'), /body: JSON\.stringify\(\{ code \}\)/, 'the browser sends the code and nothing else');
  // While checkout is off, /premium leads with the voucher (#voucher).
  assert.match(read('client/src/components/PremiumPage.tsx'), /const voucherLeads = !billing\.enabled;/);
  for (const [key, value] of Object.entries(ENGLISH)) {
    if (!key.startsWith('premium.voucher.')) continue;
    assert.doesNotMatch(value, /\b(hurry|limited time|ends soon|last chance|act now|today only)\b/i, `${key} uses urgency copy`);
  }
  assert.equal(ENGLISH['premium.voucher.invalid'], 'This code does not open Premium. Check it and try again.', 'the page says what the server says, once, for every refused code');
  // The Terms name vouchers among the grants without payment; the privacy
  // policy says what a redemption stores, and that erasure deletes it.
  assert.match(ENGLISH['legal.terms.grants.body'], /through a voucher code you redeem on the Premium page/);
  assert.match(ENGLISH['legal.terms.grants.body'], /counted from the day you redeem it, or with no end date, and an account can redeem each voucher once/);
  assert.match(PRIVACY_ENGLISH['legal.privacy.voucher.body'], /stores your account identifier, the voucher you redeemed and the time you redeemed it/);
  assert.match(PRIVACY_ENGLISH['legal.privacy.voucher.body'], /does not store the code you type/);
  assert.match(PRIVACY_ENGLISH['legal.privacy.deletion.body'], /your voucher redemptions/);
  assert.match(read('client/src/components/LegalPages.tsx'), /id: 'vouchers', title: 'legal\.privacy\.voucher\.title'/);

  // 4. The redemption against a stand-in database. Log lines are captured to
  // prove that no code, hash or hint is ever written to them.
  const logged: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  try {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const answers = new Map<string, unknown>([
      [voucherHash('K7Q2ABCD1234'), { status: 'redeemed', grantId: '05443e8e-0bd9-4ee3-8674-312a1d317ca0', validUntil: '2026-10-26T13:43:28.520132+00:00', redeemedAt: '2026-09-26T13:43:28.520132+00:00' }],
      [voucherHash('OPENOPEN0001'), { status: 'redeemed', grantId: '15443e8e-0bd9-4ee3-8674-312a1d317ca0', validUntil: null, redeemedAt: '2026-09-26T13:43:28.520132+00:00' }],
      [voucherHash('AGAINAGAIN01'), { status: 'already' }],
      [voucherHash('USEDUSEDUSED'), { status: 'invalid' }],
    ]);
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn !== 'redeem_premium_voucher') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
        return { data: answers.get(String(args.p_code_hash)) ?? { status: 'invalid' }, error: null };
      },
    };
    let account = 0;
    const redeemAs = async (codeText: unknown, options: { user?: string | null; ip?: string; method?: string; database?: unknown } = {}) => {
      const user = options.user === undefined ? `contract-voucher-${++account}` : options.user;
      const res = mockResponse();
      await handleVoucherRedeem({
        method: options.method ?? 'POST',
        headers: { 'x-forwarded-for': options.ip ?? `10.45.${account % 250}.${(account * 7) % 250}` },
        query: { op: 'voucher', ...(user ? { user_id: user } : {}) },
        body: { code: codeText, ...(user ? { user_id: user } : {}) },
      } as never, res as never, (options.database ?? db) as never);
      return res;
    };
    const envelope = (res: ReturnType<typeof mockResponse>) => ({ status: res.statusCode, body: res.body });

    const get = await redeemAs('K7Q2ABCD1234', { method: 'GET' });
    assert.equal(get.statusCode, 405, 'redeeming is POST only');
    const guest = await redeemAs('K7Q2ABCD1234', { user: null });
    assert.equal(guest.statusCode, 401, 'a guest must sign in first');

    calls.length = 0;
    const ok = await redeemAs(' k7q2-abcd 1234 ', { user: 'contract-voucher-owner' });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.body, { status: 'redeemed', validUntil: '2026-10-26T13:43:28.520Z' }, 'the answer names the end and nothing else');
    assert.equal(ok.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(calls, [{ fn: 'redeem_premium_voucher', args: { p_user_id: 'contract-voucher-owner', p_code_hash: sha256('K7Q2ABCD1234') } }],
      'the routine gets the account and the hash of the normalised code, never the code');
    assert.deepEqual((await redeemAs('OPENOPEN0001')).body, { status: 'redeemed', validUntil: null }, 'a voucher with no end says so');

    const already = await redeemAs('AGAINAGAIN01');
    assert.equal(already.statusCode, 409);
    assert.equal((already.body as { error: { code: string } }).error.code, 'voucher_already_redeemed', '"already redeemed" is the one answer told apart');

    const unknown = envelope(await redeemAs('NOSUCHCODE01'));
    const usedUp = envelope(await redeemAs('USEDUSEDUSED'));
    calls.length = 0;
    const malformed = envelope(await redeemAs('K7Q2!'));
    assert.equal(calls.length, 0, 'a code that cannot exist reaches no routine');
    assert.equal(unknown.status, 400);
    assert.deepEqual(unknown.body, { error: { code: 'voucher_invalid', message: 'This code does not open Premium. Check it and try again.' } });
    assert.deepEqual(usedUp, unknown, 'a used-up code (and an expired or revoked one, which the routine answers alike) gets the answer an unknown code gets');
    assert.deepEqual(malformed, unknown, 'and so does a code that cannot exist');
    const missing = await redeemAs('K7Q2ABCD1234', { database: { rpc: async (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } }) } });
    assert.equal(missing.statusCode, 503);
    assert.equal((missing.body as { error: { code: string } }).error.code, 'voucher_unavailable', 'before migration 045 a redemption says vouchers are unavailable');
    const failing = await redeemAs('K7Q2ABCD1234', { database: { rpc: async () => ({ data: null, error: { code: '23514', message: 'check violation' } }) } });
    assert.equal(failing.statusCode, 500, 'a database error is a 500, not a refusal');

    // Five attempts an hour per account, a success included, and ten per address.
    const limited = 'contract-voucher-limited';
    for (let attempt = 1; attempt <= 5; attempt++) {
      assert.equal((await redeemAs('NOSUCHCODE01', { user: limited, ip: `10.46.0.${attempt}` })).statusCode, 400, `attempt ${attempt} is answered`);
    }
    const sixth = await redeemAs('K7Q2ABCD1234', { user: limited, ip: '10.46.0.6' });
    assert.equal(sixth.statusCode, 429, 'the sixth attempt of one account in an hour is refused, even with a good code');
    assert.ok(Number(sixth.headers.get('retry-after')) > 0, 'with Retry-After');
    for (let attempt = 1; attempt <= 10; attempt++) {
      assert.equal((await redeemAs('NOSUCHCODE01', { ip: '10.46.1.1' })).statusCode, 400, `address attempt ${attempt} is answered`);
    }
    assert.equal((await redeemAs('K7Q2ABCD1234', { ip: '10.46.1.1' })).statusCode, 429, 'the eleventh attempt from one address in an hour is refused, whichever account');
    assert.equal((await redeemAs('K7Q2ABCD1234', { ip: '10.46.1.2' })).statusCode, 200, 'another address is not');

    // 5. The owner's routes: created codes are random, shown once and stored
    // as a hash; a taken custom code is refused; the list carries no hash.
    const adminCalls: { fn: string; args: Record<string, unknown> }[] = [];
    let conflicts = 0;
    const row = (hint: string, extra: Record<string, unknown> = {}) => ({
      id: '5d6a8a4e-1f59-4d6a-9f56-0f7b6c1e2a3b', hint, note: 'For Pavel', premiumDays: 30, maxRedemptions: 1, redeemedCount: 0,
      redeemableUntil: null, active: true, createdAt: '2026-09-26T12:00:00+00:00', revokedAt: null, ...extra,
    });
    const adminDb = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        adminCalls.push({ fn, args });
        if (fn === 'create_premium_voucher') {
          if (conflicts > 0) { conflicts -= 1; return { data: null, error: null }; }
          return { data: row(String(args.p_code_hint)), error: null };
        }
        if (fn === 'list_premium_vouchers') return { data: [row('K7Q2', { codeHash: 'leak' }), row('OPEN', { active: false, revokedAt: '2026-09-26T12:30:00+00:00' })], error: null };
        if (fn === 'revoke_premium_voucher') return { data: args.p_voucher_id === '5d6a8a4e-1f59-4d6a-9f56-0f7b6c1e2a3b' ? row('K7Q2', { active: false, revokedAt: '2026-09-26T12:30:00+00:00' }) : null, error: null };
        return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
      },
    };
    const admin = async (method: string, body?: Record<string, unknown>, database: unknown = adminDb) => {
      const res = mockResponse();
      await handleAdminVouchers({ method, headers: {}, query: { op: 'vouchers' }, body } as never, res as never, database as never);
      return res;
    };
    const created = await admin('POST', { action: 'create', note: 'For Pavel', premiumDays: 30, maxRedemptions: 1 });
    assert.equal(created.statusCode, 200);
    const shown = (created.body as { code: string }).code;
    assert.match(shown, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, 'a generated code is XXXX-XXXX-XXXX in Crockford base32');
    const plain = normalizeVoucherCode(shown)!;
    const createArgs = adminCalls.find((call) => call.fn === 'create_premium_voucher')!.args;
    assert.equal(createArgs.p_code_hash, sha256(plain), 'the routine stores the SHA-256 of the code');
    assert.equal(createArgs.p_code_hint, plain.slice(0, 4));
    assert.ok(!JSON.stringify(createArgs).includes(plain), 'and never receives the code');
    assert.deepEqual({ ...createArgs, p_code_hash: 'hash', p_code_hint: 'hint' }, {
      p_code_hash: 'hash', p_code_hint: 'hint', p_note: 'For Pavel', p_premium_days: 30, p_max_redemptions: 1, p_redeemable_until: null, p_created_by: null,
    }, 'a request that passed with the legacy password records no creator');
    assert.equal(JSON.stringify(created.body).split(shown).length - 1, 1, 'the answer carries the code once');
    assert.ok(!JSON.stringify(created.body).includes(plain) && !JSON.stringify(created.body).includes(sha256(plain)), 'and neither its bare form nor its hash');
    assert.equal(created.headers.get('cache-control'), 'no-store');

    adminCalls.length = 0;
    const custom = await admin('POST', { action: 'create', note: 'Camp', premiumDays: null, maxRedemptions: 40, code: 'shark-camp-2026' });
    assert.equal((custom.body as { code: string }).code, 'SHAR-KCAM-P202-6', 'a custom code comes back normalised');
    assert.equal(adminCalls[0].args.p_code_hash, sha256('SHARKCAMP2026'));
    conflicts = 1;
    const taken = await admin('POST', { action: 'create', note: 'Camp', code: 'shark-camp-2026' });
    assert.equal(taken.statusCode, 409, 'a custom code in use is refused');
    assert.equal((taken.body as { error: { code: string } }).error.code, 'voucher_exists');
    conflicts = 2;
    adminCalls.length = 0;
    assert.equal((await admin('POST', { action: 'create', note: 'Retry' })).statusCode, 200, 'a generated code that is taken is replaced');
    assert.equal(adminCalls.length, 3);
    assert.equal(new Set(adminCalls.map((call) => call.args.p_code_hash)).size, 3, 'by a fresh one each time');
    conflicts = 3;
    assert.equal((await admin('POST', { action: 'create', note: 'Retry' })).statusCode, 500, 'three taken codes in a row stop');
    conflicts = 0;
    assert.equal((await admin('POST', { action: 'create', note: '' })).statusCode, 400);
    assert.equal((await admin('POST', { action: 'create', note: 'x', code: 'no' })).statusCode, 400);
    // An end date a moment ahead passes this server's clock and fails the
    // database's: the routine's raise is a bad request, not a server error.
    const skewed = await admin('POST', { action: 'create', note: 'Skew', redeemableUntil: new Date(Date.now() + 60_000).toISOString() }, {
      rpc: async () => ({ data: null, error: { code: 'P0001', message: 'premium_voucher_in_past' } }),
    });
    assert.equal(skewed.statusCode, 400, 'a voucher end date the database finds past answers 400');

    const list = await admin('GET');
    assert.equal(list.statusCode, 200);
    const vouchers = (list.body as { vouchers: Record<string, unknown>[] }).vouchers;
    assert.deepEqual(vouchers.map((one) => [one.hint, one.state]), [['K7Q2', 'open'], ['OPEN', 'revoked']]);
    assert.ok(vouchers.every((one) => !('codeHash' in one)), 'the list carries no hash');
    assert.equal((await admin('POST', { action: 'revoke', voucherId: 'nope' })).statusCode, 400);
    assert.equal((await admin('POST', { action: 'revoke', voucherId: '00000000-0000-4000-8000-000000000000' })).statusCode, 404);
    const revoked = await admin('POST', { action: 'revoke', voucherId: '5d6a8a4e-1f59-4d6a-9f56-0f7b6c1e2a3b' });
    assert.equal((revoked.body as { voucher: { state: string } }).voucher.state, 'revoked');
    assert.equal((await admin('POST', { action: 'burn' })).statusCode, 400);
    assert.equal((await admin('DELETE')).statusCode, 405);
    const before045 = { rpc: async (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } }) };
    for (const [method, body] of [['GET', undefined], ['POST', { action: 'create', note: 'x' }], ['POST', { action: 'revoke', voucherId: '5d6a8a4e-1f59-4d6a-9f56-0f7b6c1e2a3b' }]] as const) {
      const res = await admin(method, body as Record<string, unknown> | undefined, before045);
      assert.equal(res.statusCode, 503, `${method} ${body?.action ?? 'list'} before 045`);
      assert.equal((res.body as { error: { code: string } }).error.code, 'migration_required');
    }

    // Only an admin reaches op=vouchers: a signed-in learner is refused
    // before any database call.
    for (const method of ['GET', 'POST']) {
      const res = mockResponse();
      await adminHandler({
        method, url: '/api/admin/vouchers', headers: { 'x-forwarded-for': `10.47.0.${method.length}` },
        query: { op: 'vouchers', user_id: 'contract-learner' }, body: { action: 'create', note: 'x', user_id: 'contract-learner' },
      } as never, res as never);
      assert.ok([401, 403].includes(res.statusCode), `a learner's ${method} to op=vouchers is refused (${res.statusCode})`);
    }

    // No log line carries a code, its hash or its hint.
    const secrets = [plain, shown, sha256(plain), 'K7Q2ABCD1234', sha256('K7Q2ABCD1234'), 'SHARKCAMP2026', 'SHAR-KCAM-P202-6', sha256('SHARKCAMP2026'), 'NOSUCHCODE01', 'USEDUSEDUSED', 'AGAINAGAIN01'];
    assert.ok(logged.length > 10, 'the handlers logged their outcomes');
    for (const line of logged) {
      for (const secret of secrets) assert.ok(!line.includes(secret), `a log line carries ${secret}: ${line}`);
      assert.doesNotMatch(line, /"(hint|code|codeHash)"/, `a log line names a code field: ${line}`);
    }
  } finally {
    console.log = realLog;
  }
}

/* ── one erasure routine (migration 044) ──────────────────────────────────
 *
 * delete_user_data erases every table that holds an account id, including the
 * ones later migrations added with routines of their own, and question_edits
 * carries the importance check migration 014 meant to add. */
function erasureContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const migrations = readdirSync(join(process.cwd(), 'supabase'))
    .filter((name) => /^supabase-schema-\d{3}\.sql$/.test(name))
    .sort();
  const bodyOf = (sql: string) => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.delete_user_data(');
    return start < 0 ? '' : sql.slice(start, sql.indexOf('$$;', sql.indexOf('AS $$', start)));
  };
  const erased = (body: string) => new Set([...body.matchAll(/\bpublic\.([a-z_]+)\b/g)].map((match) => match[1]));

  // The newest restatement is the one that runs, so it is the one checked.
  const latest = [...migrations].reverse().find((name) => bodyOf(read(`supabase/${name}`)));
  assert.ok(latest && latest >= 'supabase-schema-044.sql', 'delete_user_data was last restated by 044 or later');
  const latestSql = read(`supabase/${latest}`);
  const body = bodyOf(latestSql);
  const covered = erased(body);

  // It keeps every table migration 033's body erased.
  for (const table of erased(bodyOf(read('supabase/supabase-schema-033.sql')))) {
    assert.ok(covered.has(table), `delete_user_data still erases ${table}`);
  }
  // Every table a later migration created with an account column is erased or anonymised.
  // And the restating file refuses to run until each of those tables exists:
  // plpgsql resolves a table only when the routine runs, so an early copy
  // would install cleanly and then fail every deletion (review finding data-4).
  const guard = latestSql.slice(0, latestSql.indexOf('CREATE OR REPLACE FUNCTION public.delete_user_data('));
  assert.match(guard, /IF to_regclass\('public\.' \|\| v_table\) IS NULL THEN/, 'the restating migration checks its tables first');
  assert.match(guard, new RegExp(`RAISE EXCEPTION 'migration ${latest!.slice(16, 19)} needs 035 and 039 to 04\\d first; missing: %'`),
    'the guard names the migration that restates delete_user_data');
  for (const name of migrations.filter((one) => one > 'supabase-schema-033.sql' && one < latest!)) {
    const sql = read(`supabase/${name}`);
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z_]+) \(([\s\S]*?)\n\);/g)) {
      if (!/\b(user_id|invitee_user_id|referrer_user_id)\b/.test(match[2])) continue;
      assert.ok(covered.has(match[1]), `${name} created ${match[1]} with an account column and delete_user_data does not erase it`);
      assert.ok(guard.includes(`'${match[1]}'`), `${latest} checks that ${match[1]} (${name}) exists before it restates delete_user_data`);
    }
  }
  // A settled month keeps its ranks and loses the person.
  assert.ok(covered.has('token_month_settlements'), 'a month settlement loses the deleted account');
  assert.match(body, /SECURITY DEFINER\s+SET search_path = ''/, 'delete_user_data is a definer with an empty search_path');
  assert.match(latestSql, /REVOKE ALL ON FUNCTION public\.delete_user_data\(TEXT\) FROM PUBLIC, anon, authenticated;/);
  assert.match(latestSql, /GRANT EXECUTE ON FUNCTION public\.delete_user_data\(TEXT\) TO service_role;/);
  assert.doesNotMatch(body, /\b(INSERT INTO|user_xp SET|user_stats SET)\b/, 'erasure only deletes and anonymises');

  // The importance check is added once, whatever 014 left behind.
  const migration044 = read('supabase/supabase-schema-044.sql');
  assert.match(migration044, /IF NOT EXISTS \([\s\S]*?conname = 'question_edits_importance_check'/, 'the importance check is guarded');
  assert.match(migration044, /ADD CONSTRAINT question_edits_importance_check\s+CHECK \(importance IS NULL OR importance BETWEEN 1 AND 10\)/);

  // The four routines 039 to 042 shipped do nothing the newest
  // delete_user_data does not: each of their statements is in its body, word
  // for word. So the API calls delete_user_data alone, and 046 drops the four.
  const FOLDED_FROM: Array<[string, string]> = [
    ['delete_entitlement_data', '039'], ['delete_user_activity_days', '040'], ['delete_coin_data', '041'], ['delete_referral_data', '042'],
  ];
  const FOLDED = FOLDED_FROM.map(([name]) => name);
  const squash = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const flatBody = squash(body);
  const foldedTables = new Set<string>();
  for (const [name, number] of FOLDED_FROM) {
    const file = `supabase/supabase-schema-${number}.sql`;
    const sql = read(file);
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(p_user_id TEXT)`);
    assert.ok(start >= 0, `${file} defines ${name}`);
    const routineBody = sql.slice(sql.indexOf('BEGIN', start), sql.indexOf('$$;', start));
    const statements = squash(routineBody).split(';').map((one) => one.trim().replace(/^BEGIN /, ''))
      .filter((one) => /^(DELETE|UPDATE)\b/.test(one));
    assert.ok(statements.length > 0, `${name} erases something`);
    for (const statement of statements) {
      assert.ok(flatBody.includes(`${statement};`), `${latest}'s delete_user_data does what ${name} did: ${statement}`);
      for (const match of statement.matchAll(/\bpublic\.([a-z_]+)\b/g)) foldedTables.add(match[1]);
    }
  }
  assert.deepEqual([...foldedTables].sort(), ['billing_checkout_consents', 'billing_customers', 'entitlement_grants', 'referral_codes',
    'referrals', 'token_month_settlements', 'token_xp_credits', 'user_activity_days'], 'the tables the four routines touched');

  // The API ends billing first, then calls delete_user_data and nothing else.
  const userOps = read('api/user/[op].ts');
  const deletionStart = userOps.indexOf('async function deleteAccount(');
  const deletion = userOps.slice(deletionStart, userOps.indexOf('\nasync function ', deletionStart + 1));
  assert.ok(deletion.includes('supabase!.auth.admin.deleteUser(auth.sub)'), 'the deleteAccount slice reaches the sign-in identity');
  assert.ok(deletion.indexOf('endBillingForDeletedAccount') < deletion.indexOf("rpc('delete_user_data'"), 'billing ends before the data goes');
  assert.deepEqual([...new Set([...deletion.matchAll(/\.rpc\(\s*([^,)]+)/g)].map((match) => match[1]))], ["'delete_user_data'"],
    'deleting an account calls delete_user_data and no other routine');
  assert.ok(deletion.indexOf("rpc('delete_user_data'") < deletion.indexOf('auth.admin.deleteUser'), 'the data goes before the sign-in identity');
  assert.ok(deletion.lastIndexOf("rpc('delete_user_data'") > deletion.indexOf('auth.admin.deleteUser'), 'and is erased once more after it (PROF-4)');
  // No code calls a dropped routine.
  for (const file of ['api', 'lib', 'shared', 'client/src'].flatMap(codeFiles)) {
    const source = read(file);
    for (const name of FOLDED) assert.doesNotMatch(source, new RegExp(`\\b${name}\\b`), `${file} still names ${name}, which 046 drops`);
  }

  // Migration 046 drops the four, and refuses to until 045's delete_user_data
  // erases every table they touched and nothing else calls them.
  const migration046 = read('supabase/supabase-schema-046.sql');
  const guard046 = migration046.slice(0, migration046.indexOf('DROP FUNCTION'));
  for (const name of FOLDED) {
    assert.match(migration046, new RegExp(`\\nDROP FUNCTION IF EXISTS public\\.${name}\\(TEXT\\);`), `046 drops ${name}`);
    assert.doesNotMatch(guard046, new RegExp(`DROP FUNCTION[^;]*${name}`), `046 drops ${name} only after its guard`);
  }
  assert.doesNotMatch(migration046, /\bCASCADE\b/, '046 drops nothing that depends on a routine');
  assert.doesNotMatch(migration046, /CREATE OR REPLACE FUNCTION public\.delete_user_data/, '046 keeps 045\'s delete_user_data');
  assert.match(guard046, /RAISE EXCEPTION 'migration 046 needs 045 first; missing: %'/, 'the guard names the migration it needs');
  for (const table of [...foldedTables, 'premium_voucher_redemptions']) {
    assert.ok(guard046.includes(`'${table}'`), `046 checks that delete_user_data erases ${table} before it drops anything`);
  }
  for (const table of ['premium_vouchers', 'premium_voucher_redemptions']) assert.ok(guard046.includes(`'${table}'`), `046 checks that 045 created ${table}`);
  assert.match(guard046, /WHERE p\.prosrc ~ v_pattern/, '046 refuses while another routine names one of the four');
  assert.match(guard046, /FROM cron\.job WHERE command ~ \$1/, '046 refuses while a cron job names one of the four');
  for (const name of migrations.filter((one) => one > 'supabase-schema-046.sql')) {
    for (const routine of FOLDED) {
      assert.doesNotMatch(read(`supabase/${name}`), new RegExp(`FUNCTION public\\.${routine}\\(`), `${name} brings back ${routine}`);
    }
  }
}

/** The public question of the day (#239): a track a day from served, deep
 * pools; the same question for the same date; no answer before a check; a
 * check that records nothing for anyone; and no question before its day. */
async function qotdContracts() {
  const served = await getEffectiveQuestions('webdev');
  const deliverable = new Set(deliveryCategories('webdev'));
  for (const track of QOTD_TRACKS) {
    assert.ok(deliverable.has(track), `${track} is served`);
    assert.ok(served.filter((q) => q.category === track).length >= 40, `${track} has a deep enough pool for a question a day`);
  }
  const cycle = Array.from({ length: QOTD_TRACKS.length }, (_, day) => qotdTrack(addDays(QOTD_EPOCH, day)));
  assert.equal(new Set(cycle).size, QOTD_TRACKS.length, 'every track comes up once per cycle');
  assert.equal(qotdTrack(addDays(QOTD_EPOCH, QOTD_TRACKS.length)), qotdTrack(QOTD_EPOCH));
  assert.equal(qotdAvailability(addDays(utcToday(), 1)), 'not-yet');
  assert.equal(qotdAvailability(addDays(QOTD_EPOCH, -1)), 'before-start');

  const date = addDays(QOTD_EPOCH, 3);
  const picked = pickQuestionOfTheDay(served, date);
  assert.ok(picked, 'a day has a question');
  assert.deepEqual(pickQuestionOfTheDay(served, date), picked, 'the same date gives the same question and order');
  assert.equal(picked!.track, qotdTrack(date));
  assert.equal(picked!.question.category, picked!.track);
  const original = served.find((q) => q.id === picked!.question.id)!;
  assert.equal(picked!.question.options[picked!.correctAnswer], original.options[original.correctAnswer], 'the sealed index follows the shuffle');

  const today = mockResponse();
  await dailyHandler({ method: 'GET', headers: {}, query: { qotd: 'today' } } as never, today as never);
  assert.equal(today.statusCode, 200, JSON.stringify(today.body));
  const body = today.body as { date: string; track: string; sessionId: string; question: { id: string; options: string[] } };
  assert.equal(body.date, utcToday());
  const wire = JSON.stringify({ ...body, sessionId: '' });
  assert.doesNotMatch(wire, /correctAnswer|explanation/, 'no answer or explanation before a check');
  assert.match(today.headers.get('cache-control') ?? '', /private/, 'the sealed session stays out of shared caches');
  // One check claims the session, so a reload must reach the server for a
  // fresh one: a browser that kept this for five minutes answered "Load it
  // again" after a 409 with the claimed session.
  assert.match(today.headers.get('cache-control') ?? '', /no-store/, 'and out of the browser cache');
  assert.doesNotMatch(today.headers.get('cache-control') ?? '', /max-age/);
  const again = mockResponse();
  await dailyHandler({ method: 'GET', headers: {}, query: { qotd: 'today' } } as never, again as never);
  assert.notEqual((again.body as { sessionId: string }).sessionId, body.sessionId, 'each read seals a fresh session');
  assert.equal((again.body as { question: { id: string } }).question.id, body.question.id, 'for the same question');

  const future = mockResponse();
  await dailyHandler({ method: 'GET', headers: {}, query: { qotd: addDays(utcToday(), 1) } } as never, future as never);
  assert.equal(future.statusCode, 404, 'tomorrow is not readable today');
  const realNow = Date.now;
  const nextDate = addDays(utcToday(), 1);
  const opensAt = Date.parse(`${nextDate}T00:00:00Z`);
  try {
    for (const [remainingMs, status, cache] of [
      [61_000, 404, 'public, max-age=60'],
      [9_000, 404, 'public, max-age=9'],
      [100, 404, 'public, max-age=0'],
      [0, 200, 'private, no-store'],
    ] as const) {
      Date.now = () => opensAt - remainingMs;
      const response = mockResponse();
      await dailyHandler(quizRequest('GET', { qotd: nextDate }), response as never);
      assert.equal(response.statusCode, status);
      assert.equal(response.headers.get('cache-control'), cache);
    }
  } finally {
    Date.now = realNow;
  }
  const garbage = mockResponse();
  await dailyHandler({ method: 'GET', headers: {}, query: { qotd: '2026-02-30' } } as never, garbage as never);
  assert.equal(garbage.statusCode, 400);

  // Checked by a signed-in learner, it is still practice: no receipt, no proof.
  const check = mockResponse();
  await submitHandler({
    method: 'POST', headers: { authorization: 'Bearer contract' }, query: {},
    body: { sessionId: body.sessionId, answers: { [body.question.id]: 0 }, user_id: 'qotd-contract-learner' },
  } as never, check as never);
  assert.equal(check.statusCode, 200, JSON.stringify(check.body));
  const checked = check.body as { resultReceipt?: string; results: { correctAnswer: number; explanation: string; answerProof?: string }[] };
  assert.equal(checked.resultReceipt, undefined, 'a question of the day mints no receipt, so no XP, streak or leaderboard entry');
  assert.equal(checked.results[0].answerProof, undefined);
  assert.ok(checked.results[0].explanation.length > 0, 'the check explains the answer');

  // The share images' count is the tier rule over the catalogue.
  const counts = freeCodingCounts(CODING_INDEX.map((task) => task.id));
  assert.equal(counts.total, CODING_INDEX.length);
  assert.equal(counts.free, CODING_INDEX.filter((task) => task.free === true).length);
}

/** The daily challenge and the question of the day draw with a seeded shuffle
 * that favours no position, and the days already published keep their draw. */
function seededShuffleContracts() {
  const ten = Array.from({ length: 10 }, (_, i) => i);
  // Golden orders from the shuffle those days were published with.
  assert.deepEqual(dailySeededShuffle(ten, 'qotd::2026-09-15', '2026-09-15'), [0, 8, 2, 6, 3, 7, 5, 1, 4, 9]);
  assert.deepEqual(dailySeededShuffle(ten, '2026-09-29::3', '2026-09-29'), [2, 7, 8, 1, 3, 0, 4, 6, 5, 9]);

  const pool = Array.from({ length: 571 }, (_, i) => i);
  const once = dailySeededShuffle(pool, 'qotd::2026-12-01', '2026-12-01');
  assert.deepEqual(once, dailySeededShuffle(pool, 'qotd::2026-12-01', '2026-12-01'), 'the same seed gives the same order');
  assert.deepEqual([...once].sort((a, b) => a - b), pool, 'a shuffle is a permutation');
  // The old draw took one hash byte per swap: in a 571-question pool it put a
  // question from past position 255 first on 1 day in 2000. Uniform is 55 %.
  let late = 0;
  for (let day = 0; day < 2000; day++) {
    if (dailySeededShuffle(pool, `seed-${day}`, UNBIASED_SHUFFLE_FROM)[0] >= 256) late++;
  }
  assert.ok(late > 2000 * 0.5 && late < 2000 * 0.6, `a question past position 255 comes first on ${late} of 2000 days`);
}

/** A caller with its own address, so the per-address limits of the quiz
 * handlers never decide an assertion here; signed in through the development
 * fallback when `user` is given. */
let quizCallerSeq = 0;
function quizRequest(method: 'GET' | 'POST', query: Record<string, string>, body?: Record<string, unknown>, user?: string) {
  quizCallerSeq++;
  return {
    method,
    headers: { 'x-forwarded-for': `198.51.100.${quizCallerSeq % 250}`, ...(user ? { authorization: 'Bearer contract' } : {}) },
    query: { ...query, ...(user && method === 'GET' ? { user_id: user } : {}) },
    body: body && user ? { ...body, user_id: user } : body,
  } as never;
}

/** Guests playing the Challenge behind one school address. Each run is
 * bounded by the run id sealed in its token rather than by the address, so
 * thirteen guests (one past the old twelve) all answer, complete and post a
 * score; one run is still bounded; and a guest's quiz keeps the address rate. */
async function guestChallengeLimitContracts() {
  const stamp = Date.now();
  const school = `203.0.113.${stamp % 200}`;
  const fromSchool = (method: 'GET' | 'POST', query: Record<string, string>, body: Record<string, unknown>) =>
    ({ method, headers: { 'x-forwarded-for': school }, query, body, socket: {} }) as never;
  const GUESTS = 13;

  // Answers: one question from each guest's own batch, all from the school.
  for (let n = 0; n < GUESTS; n += 1) {
    const batch = mockResponse();
    await challengeHandler(quizRequest('GET', { categories: deliveryCategories('webdev').join(',') }), batch as never);
    assert.equal(batch.statusCode, 200, JSON.stringify(batch.body));
    const sessionId = (batch.body as { sessionId: string }).sessionId;
    const question = decodeSessionEnvelope(sessionId)!.questions[0];
    const answered = mockResponse();
    await submitHandler(fromSchool('POST', {}, { sessionId, answers: { [question.questionId]: question.correctAnswer } }), answered as never);
    assert.equal(answered.statusCode, 200, `guest ${n + 1}'s Challenge answer is graded (${answered.statusCode} ${JSON.stringify(answered.body)})`);
  }

  // Completion and the Hall of Fame, a run each.
  const strikes = (runId: string) => ['a', 'b', 'c'].map((q) => encodeScoreProof(runId, `guest-strike-${q}`, 'webdev', false));
  const post = async (query: Record<string, string>, body: Record<string, unknown>) => {
    const res = mockResponse();
    await challengeHandler(fromSchool('POST', query, body), res as never);
    return res;
  };
  for (let n = 0; n < GUESTS; n += 1) {
    const run = createChallengeRun(true, 'webdev');
    const completed = await post({ resource: 'complete' }, { runToken: run.runToken, proofs: strikes(run.runId) });
    assert.equal(completed.statusCode, 200, `guest ${n + 1}'s run completes (${completed.statusCode} ${JSON.stringify(completed.body)})`);
    const scored = await post({}, { name: `Guest ${n + 1}`, runToken: run.runToken, proofs: strikes(run.runId) });
    assert.notEqual(scored.statusCode, 429, `guest ${n + 1}'s score is not refused by a bucket the class shares`);
  }

  // One guest run has the budget an account has, and no more.
  const one = createChallengeRun(true, 'webdev');
  const statuses: number[] = [];
  for (let n = 0; n <= RATE_LIMITS.challengeCompletePerUser.capacity; n += 1) {
    statuses.push((await post({ resource: 'complete' }, { runToken: one.runToken, proofs: strikes(one.runId) })).statusCode);
  }
  assert.deepEqual(statuses.slice(0, -1).filter((status) => status !== 200), [], 'a guest run completes within its budget');
  assert.equal(statuses.at(-1), 429, 'one guest run is bounded like one account');

  // A guest's quiz is not a Challenge: its submits share the address rate.
  const quizStatuses: number[] = [];
  for (let n = 0; n <= RATE_LIMITS.quizSubmitAnonymous.capacity; n += 1) {
    const quiz = mockResponse();
    await questionsHandler(quizRequest('GET', { count: '1', difficulty: 'mixed', categories: 'javascript' }), quiz as never);
    assert.equal(quiz.statusCode, 200, JSON.stringify(quiz.body));
    const sessionId = (quiz.body as { sessionId: string }).sessionId;
    const answers = Object.fromEntries(decodeSessionEnvelope(sessionId)!.questions.map((q) => [q.questionId, q.correctAnswer]));
    const graded = mockResponse();
    await submitHandler(fromSchool('POST', {}, { sessionId, answers }), graded as never);
    quizStatuses.push(graded.statusCode);
  }
  assert.deepEqual(quizStatuses.slice(0, -1).filter((status) => status !== 200), [], 'a guest quiz is graded within the address rate');
  assert.equal(quizStatuses.at(-1), 429, 'guest quizzes behind one address keep sharing its rate');
}

async function challengeSelectionContracts() {
  const all = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: deliveryCategories('webdev').join(',') }), all as never);
  assert.equal(all.statusCode, 200);
  assert.equal(decodeChallengeRun((all.body as { runToken: string }).runToken)?.allTopics, true, 'the default selection earns the all-topics evidence');
  const batch = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: 'javascript,typescript' }), batch as never);
  assert.equal(batch.statusCode, 200, JSON.stringify(batch.body));
  const opened = batch.body as { runToken: string; questions: { category: string }[] };
  const run = decodeChallengeRun(opened.runToken)!;
  assert.deepEqual(run.topics, ['javascript','typescript']);
  assert.equal(run.allTopics, false);
  assert.equal(run.userId, null);
  assert.ok(opened.questions.every(question => run.topics!.includes(question.category)));
  const changed = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: 'javascript', runToken: opened.runToken }), changed as never);
  assert.equal(changed.statusCode, 400, 'a refill cannot drop a sealed topic');
  assert.equal((changed.body as { error: { code: string } }).error.code, 'invalid_run_scope');
  const same = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: 'typescript,javascript', runToken: opened.runToken }), same as never);
  assert.equal(same.statusCode, 200, 'a reordered identical selection refills the same run');
  const relaxed = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: 'javascript', ranked: '0' }), relaxed as never);
  assert.equal(relaxed.statusCode, 400, 'there is only one Challenge mode');
  const legacy = decodeChallengeRun(createChallengeRun(true, 'webdev').runToken)!;
  assert.equal(legacy.topics, null, 'legacy runs without evidence get no invented categories');
  assert.equal(legacy.allTopics, null);
}

async function challengeAnswerClaimContracts() {
  const learner = 'challenge-claim-owner';
  const batch = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: 'javascript' }, undefined, learner), batch as never);
  assert.equal(batch.statusCode, 200, JSON.stringify(batch.body));
  const opened = batch.body as { sessionId: string; questions: { options: string[] }[] };
  const session = decodeSessionEnvelope(opened.sessionId)!;
  const question = session.questions[0];
  const wrongPick = (question.correctAnswer + 1) % opened.questions[0].options.length;
  const submit = async (sessionId: string, user: string | null = learner, pick = wrongPick, questionId = question.questionId) => {
    const response = mockResponse();
    await submitHandler(quizRequest('POST', {}, { sessionId, answers: { [questionId]: pick } }, user ?? undefined), response as never);
    return response;
  };

  // Another batch in the same run can re-deal this question with the same
  // selected index now correct. Only the original deal may replay its grade.
  const context = { scope: 'challenge', runId: session.runId!, subject: 'webdev', attemptId: session.attemptId! } as const;
  const redealt = encodeSession([{ questionId: question.questionId, correctAnswer: wrongPick }], {
    ...context, userId: learner, gradingVersion: session.gradingVersion,
  });
  const first = await submit(opened.sessionId);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal((first.body as { correctAnswers: number }).correctAnswers, 0);
  const changed = await submit(redealt);
  assert.equal(changed.statusCode, 409, 're-dealing the same question cannot turn a wrong pick into a point');
  assert.equal((changed.body as { error: { code: string } }).error.code, 'attempt_already_graded');
  const retry = await submit(opened.sessionId);
  assert.equal(retry.statusCode, 200, 'a retry of the original deal still works');
  assert.equal((retry.body as { correctAnswers: number }).correctAnswers, 0);
  assert.equal((await submit(opened.sessionId, learner, question.correctAnswer)).statusCode, 409, 'changing the original pick remains a conflict');

  assert.equal(session.userId, learner, 'a new signed-in batch names its account');
  assert.equal((await submit(opened.sessionId, 'challenge-other-user')).statusCode, 409, 'another account cannot submit this batch');
  assert.equal((await submit(opened.sessionId, null)).statusCode, 401, 'a signed-in batch still needs the session on submit');

  const guestBatch = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: 'javascript' }), guestBatch as never);
  assert.equal(guestBatch.statusCode, 200, JSON.stringify(guestBatch.body));
  const guestToken = (guestBatch.body as { sessionId: string }).sessionId;
  const guestSession = decodeSessionEnvelope(guestToken)!;
  assert.equal(guestSession.userId, null, 'a new guest batch explicitly belongs to a guest');
  const guestQuestion = guestSession.questions[0];
  assert.equal((await submit(guestToken, learner, guestQuestion.correctAnswer, guestQuestion.questionId)).statusCode, 409, 'a signed-in submit cannot take a guest batch');
  assert.equal((await submit(guestToken, null, guestQuestion.correctAnswer, guestQuestion.questionId)).statusCode, 200, 'the guest can still submit it');

  const legacyRun = createChallengeRun(true, 'webdev');
  const legacy = encodeSession([question], { ...context, runId: legacyRun.runId, attemptId: legacyRun.runId });
  assert.equal((await submit(legacy)).statusCode, 200, 'an in-flight legacy batch can finish');
  assert.equal((await submit(legacy)).statusCode, 200, 'an in-flight legacy retry can finish');
}

async function challengeStrikeContracts() {
  const categories = 'javascript';
  const batch = mockResponse();
  await challengeHandler(quizRequest('GET', { categories }), batch as never);
  assert.equal(batch.statusCode, 200, JSON.stringify(batch.body));
  const { sessionId, runToken } = batch.body as { sessionId: string; runToken: string };
  const session = decodeSessionEnvelope(sessionId)!;
  const run = decodeChallengeRun(runToken)!;
  const submit = async (questionId: string, pick: number, token = sessionId) => {
    const response = mockResponse();
    await submitHandler(quizRequest('POST', {}, { sessionId: token, answers: { [questionId]: pick } }), response as never);
    return response;
  };
  const wrong = (question: { questionId: string; correctAnswer: number }) => submit(question.questionId, (question.correctAnswer + 1) % 2);
  const proof = (response: ReturnType<typeof mockResponse>) => (response.body as { results: { scoreProof: string }[] }).results[0].scoreProof;
  const [first, second, last, late] = session.questions;
  const strikes = [await wrong(first), await wrong(second)];
  const retiredId = 'retired-while-open';
  const retired = encodeSession([{ questionId: retiredId, correctAnswer: 0 }], {
    scope: 'challenge', runId: run.runId, attemptId: run.runId, subject: 'webdev', userId: null, gradingVersion: run.gradingVersion,
  });
  const voided = await submit(retiredId, -1, retired);
  assert.equal(voided.statusCode, 200);
  assert.deepEqual((voided.body as { voided: string[] }).voided, [retiredId]);
  strikes.push(await submit(last.questionId, -1));
  assert.deepEqual(strikes.map((response) => response.statusCode), [200, 200, 200], 'an unanswered question counts as the third strike, a void does not');

  const after = await submit(late.questionId, late.correctAnswer);
  assert.equal(after.statusCode, 409, 'a fourth new answer cannot add a score proof after the third strike');
  assert.equal((after.body as { error: { code: string } }).error.code, 'challenge_finished');
  const retry = await submit(last.questionId, -1);
  assert.equal(retry.statusCode, 200, 'the terminal strike itself can be retried');
  assert.equal((retry.body as { correctAnswers: number }).correctAnswers, 0);
  assert.equal((await submit(last.questionId, last.correctAnswer)).statusCode, 409, 'a changed terminal answer stays a conflict');

  const complete = async (proofs: string[]) => {
    const response = mockResponse();
    await challengeHandler(quizRequest('POST', { resource: 'complete' }, { runToken, proofs }), response as never);
    return response;
  };
  assert.equal((await complete(strikes.map(proof))).statusCode, 200, 'three server-recorded strikes can complete the run');
  const legacyProof = encodeScoreProof(run.runId, last.questionId, 'webdev', false);
  assert.equal((await complete([...strikes.slice(0, 2).map(proof), legacyProof])).statusCode, 400, 'a new run cannot use a proof from the old grading path');

  const legacy = createChallengeRun(true, 'webdev', { topics: [categories], allTopics: false, userId: null });
  const refill = mockResponse();
  await challengeHandler(quizRequest('GET', { categories, runToken: legacy.runToken }), refill as never);
  assert.equal(refill.statusCode, 200, 'a legacy run can still get a refill');
  const refilled = decodeSessionEnvelope((refill.body as { sessionId: string }).sessionId);
  assert.equal(refilled?.gradingVersion, undefined, 'a refill keeps its original grading rules');
}

/** A class behind one school address (review round 3: SEC-1, QUIZ-2, PLAY-3,
 * CODE-8, PROF-7). Each route below charged one person's budget to the whole
 * address, so the pupil past it got 429: a quiz, the due list, the daily
 * challenge, the question of the day, a Challenge batch or answer, placement,
 * a Learn answer or completion, a coding task, Submit, reveal
 * or draft save, a flashcard, a question report. Each now takes a class-sized address bucket,
 * then the caller's own. Run through the real handlers: thirty signed-in
 * pupils behind one address all get through, one pupil hammering is still
 * refused while a classmate is not, and guests still share their address's
 * budget. */
async function classroomLimitContracts() {
  const stamp = Date.now();
  const PUPILS = 30;
  let schools = 0;
  const school = () => `class-${stamp}-${++schools}`;
  type Handler = (req: never, res: never) => unknown;
  type Route = {
    name: string;
    handler: Handler;
    method: 'GET' | 'POST';
    query: Record<string, string>;
    body?: Record<string, unknown>;
    /** What one person may do in a full bucket; before the split, the whole address. */
    perPerson: number;
    own: keyof typeof RATE_LIMITS;
    address: keyof typeof RATE_LIMITS;
  };
  const call = async (route: Route, address: string, user?: string) => {
    const res = mockResponse();
    const signedIn = user !== undefined;
    await route.handler({
      method: route.method,
      headers: { 'x-forwarded-for': address, ...(signedIn ? { authorization: 'Bearer contract' } : {}) },
      query: { ...route.query, ...(signedIn && route.method === 'GET' ? { user_id: user } : {}) },
      body: route.method === 'GET' ? undefined : { ...(route.body ?? {}), ...(signedIn ? { user_id: user } : {}) },
      socket: {},
    } as never, res as never);
    return res;
  };
  const webdev = deliveryCategories('webdev').join(',');
  const freeTask = CODING_INDEX.find((task) => task.free && task.track === 'javascript')!;
  const quiz = { perPerson: 20, own: 'quizSession', address: 'quizSessionAddress' } as const;
  const learnAnswer = { perPerson: 80, own: 'roadmapAnswer', address: 'roadmapAnswerAddress' } as const;
  const learnComplete = { perPerson: 12, own: 'roadmapComplete', address: 'roadmapCompleteAddress' } as const;
  const routes: Route[] = [
    { name: 'a quiz', handler: questionsHandler, method: 'GET', query: { categories: 'javascript', count: '1', difficulty: 'mixed' }, ...quiz },
    { name: 'the due list', handler: questionsHandler, method: 'GET', query: { resource: 'due', categories: 'javascript' }, ...quiz },
    { name: 'the daily challenge', handler: dailyHandler, method: 'GET', query: { categories: webdev }, ...quiz },
    { name: 'the question of the day', handler: dailyHandler, method: 'GET', query: { qotd: 'today' }, ...quiz },
    { name: 'a Challenge batch', handler: challengeHandler, method: 'GET', query: { categories: webdev }, ...quiz },
    { name: 'a placement start', handler: roadmapHandler, method: 'GET', query: { resource: 'placement', subject: 'webdev' }, ...quiz },
    { name: 'a placement round', handler: roadmapHandler, method: 'POST', query: { resource: 'placement' }, body: { placementToken: 'x', answers: {} }, ...learnAnswer },
    { name: 'a Learn answer', handler: roadmapHandler, method: 'POST', query: { resource: 'answer' }, body: { sessionId: 'x' }, ...learnAnswer },
    { name: 'a Learn completion', handler: roadmapHandler, method: 'POST', query: { resource: 'complete' }, body: { sessionId: 'x' }, ...learnComplete },
    { name: 'a skill check', handler: roadmapHandler, method: 'POST', query: { resource: 'skill-check' }, body: {}, ...learnComplete },
    { name: 'a coding task', handler: roadmapHandler, method: 'GET', query: { resource: 'coding-task', id: freeTask.id }, perPerson: 20, own: 'codingTask', address: 'codingTaskAddress' },
    // The caller's part of a task page alone (#587 C23) keeps the page's limits.
    { name: 'a coding task state', handler: roadmapHandler, method: 'GET', query: { resource: 'coding-state', id: freeTask.id }, perPerson: 20, own: 'codingTask', address: 'codingTaskAddress' },
    // A Submit's own budget is per task (owner decision 9), so it carries a
    // session for one; with no code it is refused after the limits.
    { name: 'a coding Submit', handler: roadmapHandler, method: 'POST', query: { resource: 'coding-submit' }, body: { session: encodeCodingSession({ taskId: freeTask.id, track: freeTask.track, userId: null }) }, perPerson: 30, own: 'codingSubmit', address: 'codingSubmitAddress' },
    { name: 'a coding reveal', handler: roadmapHandler, method: 'POST', query: { resource: 'coding-reveal' }, body: { session: 'x' }, perPerson: 10, own: 'codingReveal', address: 'codingRevealAddress' },
    { name: 'a flashcard write', handler: flashcardsHandler, method: 'POST', query: {}, body: { subject: 'webdev', question_id: 'q1', question: 'Q?', correct_answer: 'A' }, perPerson: 20, own: 'flashcardMutation', address: 'flashcardMutationAddress' },
    // A class reporting a confusing question shared three reports, and the
    // fourth pupil got 429. With no reason it is refused after the limits.
    { name: 'a question report', handler: submitHandler, method: 'POST', query: { resource: 'report' }, body: { question_id: 'q1' }, perPerson: 3, own: 'questionReport', address: 'questionReportAddress' },
  ];

  // 1. Thirty pupils behind one address, each with an account, together send
  //    more than one person's budget, and none is refused.
  const refused: Record<string, number> = {};
  for (const [r, route] of routes.entries()) {
    const address = school();
    const each = Math.floor(route.perPerson / PUPILS) + 1;
    refused[route.name] = 0;
    for (let round = 0; round < each; round += 1) {
      for (let n = 0; n < PUPILS; n += 1) {
        if ((await call(route, address, `pupil-${stamp}-${r}-${n}`)).statusCode === 429) refused[route.name] += 1;
      }
    }
  }
  assert.deepEqual(refused, Object.fromEntries(routes.map((route) => [route.name, 0])),
    'no pupil in a class behind one address is refused a route a class uses together');

  /** Calls until the first 429: how many got through. A slow run may refill a
   * token or two, so the bound past `capacity` allows for that. */
  const throughUntilRefused = async (send: () => Promise<number>, capacity: number, refillPerSecond: number) => {
    const started = Date.now();
    for (let passed = 0; ; passed += 1) {
      if ((await send()) === 429) return passed;
      const slack = Math.ceil(((Date.now() - started) / 1000) * refillPerSecond) + 1;
      assert.ok(passed < capacity + slack, `refused within ${capacity} calls and the refill`);
    }
  };
  for (const [r, route] of routes.entries()) {
    const own = RATE_LIMITS[route.own];
    const address = RATE_LIMITS[route.address];
    // 2. One person's budget is what the address carried before the split,
    //    and the address holds a class at that rate.
    assert.equal(own.capacity, route.perPerson, `${route.name}: one person keeps ${route.perPerson} in a full bucket`);
    assert.equal(address.capacity, SHARED_NETWORK_SEATS * own.capacity, `${route.name}: the address holds a class`);
    assert.ok(Math.abs(address.refillPerSecond - SHARED_NETWORK_SEATS * own.refillPerSecond) < 1e-9, `${route.name}: and refills at a class's rate`);
    assert.notEqual(address.key, own.key, `${route.name}: the two tiers are separate buckets`);

    // 3. One pupil hammering is refused at their own budget, while a
    //    classmate on the same address is not.
    const shared = school();
    const hammer = `hammer-${stamp}-${r}`;
    const passed = await throughUntilRefused(async () => (await call(route, shared, hammer)).statusCode, own.capacity, own.refillPerSecond);
    assert.ok(passed >= own.capacity, `${route.name}: one pupil gets their whole budget (${passed})`);
    assert.notEqual((await call(route, shared, `classmate-${stamp}-${r}`)).statusCode, 429, `${route.name}: a classmate is not refused`);

    // 4. Guests share their address's budget, the rate the route had before.
    const guests = school();
    const guestsThrough = await throughUntilRefused(async () => (await call(route, guests)).statusCode, own.capacity, own.refillPerSecond);
    assert.ok(guestsThrough >= own.capacity, `${route.name}: guests get the address's budget (${guestsThrough})`);
  }

  // 5. A flood of accounts from one address meets the address bucket.
  {
    const route = routes.find((one) => one.name === 'a Learn completion')!;
    const address = RATE_LIMITS.roadmapCompleteAddress;
    const flood = school();
    let account = 0;
    const passed = await throughUntilRefused(async () => (await call(route, flood, `flood-${stamp}-${++account}`)).statusCode, address.capacity, address.refillPerSecond);
    assert.ok(passed >= address.capacity, `a class's worth of accounts gets through (${passed})`);
  }

  // 6. A guest's Challenge refill is charged to the run its sealed token
  //    names: once new runs have spent the address's guest budget, a run
  //    already under way still refills, one run is bounded, and a token that
  //    does not verify is charged to the spent address.
  {
    const batch = routes.find((one) => one.name === 'a Challenge batch')!;
    const address = school();
    let runToken = '';
    let sessionId = '';
    let started = 0;
    for (;;) {
      const res = await call(batch, address);
      if (res.statusCode === 429) break;
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      ({ runToken, sessionId } = res.body as { runToken: string; sessionId: string });
      started += 1;
      assert.ok(started <= RATE_LIMITS.quizSession.capacity + 2, 'guests starting runs share the address rate');
    }
    const refill = { ...batch, query: { ...batch.query, runToken } };
    const refills = await throughUntilRefused(async () => (await call(refill, address)).statusCode, RATE_LIMITS.quizSession.capacity, RATE_LIMITS.quizSession.refillPerSecond);
    assert.ok(refills >= RATE_LIMITS.quizSession.capacity, `a run under way refills after the address's guest budget is spent (${refills})`);
    const forged = { ...batch, query: { ...batch.query, runToken: tamperToken(runToken) } };
    assert.equal((await call(forged, address)).statusCode, 429, 'a run token that does not verify is charged to the address');
    assert.ok(decodeSessionEnvelope(sessionId)?.runId, 'the batch was sealed to its run');
  }

  // 7. The limiter and the handler verify a caller once between them.
  for (const route of routes.filter((one) => ['the due list', 'the daily challenge', 'a coding task'].includes(one.name))) {
    const verifications: string[] = [];
    const warn = console.warn;
    console.warn = (line: unknown) => { if (String(line).includes('requireAuth_dev_fallback')) verifications.push(String(line)); };
    try {
      const res = await call(route, school(), `once-${stamp}`);
      assert.equal(res.statusCode, 200, `${route.name}: ${JSON.stringify(res.body)}`);
    } finally {
      console.warn = warn;
    }
    assert.equal(verifications.length, 1, `${route.name}: one request verifies its credentials once`);
  }

  // 8. In the source: every class route takes both tiers; no handler charges
  //    one of these per-person budgets to an address alone; and the one
  //    sealed guest identity is the Challenge run a refill's token names.
  const perPersonOnly = new RegExp(`enforceRateLimit\\(\\s*req,\\s*res,\\s*RATE_LIMITS\\.(${[...new Set(routes.map((route) => route.own))].join('|')})\\s*\\)`);
  for (const file of ['api', 'lib'].flatMap(codeFiles)) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, perPersonOnly, `${file} charges a per-person budget to a whole address`);
    for (const tiers of source.matchAll(/enforceClassRateLimit\(\s*req,\s*res,\s*RATE_LIMITS\.(\w+),\s*RATE_LIMITS\.(\w+)(?:,\s*([^)]+?))?\s*\)/g)) {
      assert.equal(tiers[1], `${tiers[2]}Address`, `${file}: ${tiers[2]} is paired with its own address bucket`);
      if (tiers[3] === undefined) continue;
      assert.equal(file, 'api/quiz/challenge.ts', `${file} passes a guest identity`);
      assert.equal(tiers[3], 'refill ? `run:${refill.runId}` : undefined', 'a guest refill is charged to its sealed run');
      assert.match(source, /const refill = [^;]*\? decodeChallengeRun\(req\.query\.runToken\) : null;/, 'the run is the one the token seals');
    }
  }

  // 9. Challenge answers (PLAY-3). Every pupil answers at their own full
  //    Challenge rate for a minute, through the real grading handler.
  {
    const address = school();
    const perPupil = RATE_LIMITS.challengeSubmitPerUser.capacity;
    const statuses: Record<number, number> = {};
    const seats: Array<{ user: string; questions: Array<{ sessionId: string; questionId: string; correctAnswer: number }> }> = [];
    for (let n = 0; n < PUPILS; n += 1) {
      const user = `answers-${stamp}-${n}`;
      const questions: Array<{ sessionId: string; questionId: string; correctAnswer: number }> = [];
      let runToken = '';
      while (questions.length < perPupil) {
        const query: Record<string, string> = { categories: webdev, ...(runToken ? { runToken, exclude: questions.map((q) => q.questionId).join(',') } : {}) };
        const res = await call({ ...routes.find((one) => one.name === 'a Challenge batch')!, query }, address, user);
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        const body = res.body as { sessionId: string; runToken: string };
        runToken = body.runToken;
        for (const q of decodeSessionEnvelope(body.sessionId)!.questions) questions.push({ sessionId: body.sessionId, ...q });
      }
      seats.push({ user, questions: questions.slice(0, perPupil) });
    }
    for (let answer = 0; answer < perPupil; answer += 1) {
      for (const seat of seats) {
        const q = seat.questions[answer];
        const res = mockResponse();
        await submitHandler({
          method: 'POST',
          headers: { 'x-forwarded-for': address, authorization: 'Bearer contract' },
          query: {},
          body: { sessionId: q.sessionId, answers: { [q.questionId]: q.correctAnswer }, user_id: seat.user },
          socket: {},
        } as never, res as never);
        statuses[res.statusCode] = (statuses[res.statusCode] ?? 0) + 1;
      }
    }
    assert.deepEqual(statuses, { 200: PUPILS * perPupil }, 'every Challenge answer from a class behind one address is graded');
    assert.equal(RATE_LIMITS.quizSubmit.capacity, SHARED_NETWORK_SEATS * perPupil, 'grading\'s address bucket holds a class answering the Challenge');
  }

  // 11. A coding Submit is limited per task (owner decision 9, 9 October
  //     2026), beneath a ceiling per caller across every task: an account,
  //     or a guest's address. A caller who spent one task's budget still
  //     submits on the next task, and nobody submits past the ceiling by
  //     spreading submits over many tasks.
  {
    const tasks = CODING_INDEX.filter((task) => task.free && task.track === 'javascript').slice(0, 6);
    const { codingSubmit: perTask, codingSubmitCeiling: ceiling } = RATE_LIMITS;
    assert.ok(tasks.length * perTask.capacity > ceiling.capacity + tasks.length, 'enough tasks to reach the ceiling without spending any one task');
    const submitOn = (taskId: string): Route => ({ ...routes.find((one) => one.name === 'a coding Submit')!, body: { session: encodeCodingSession({ taskId, track: 'javascript', userId: null }) } });
    for (const user of [`per-task-${stamp}`, undefined]) {
      const who = user ? 'an account' : 'a guest';
      const address = school();
      const spent = await throughUntilRefused(async () => (await call(submitOn(tasks[0].id), address, user)).statusCode, perTask.capacity, perTask.refillPerSecond);
      assert.ok(spent >= perTask.capacity, `${who} gets one task's whole budget (${spent})`);
      assert.notEqual((await call(submitOn(tasks[1].id), address, user)).statusCode, 429, `${who}: one task's spent budget does not refuse the next task`);
    }
    for (const user of [`ceiling-${stamp}`, undefined]) {
      const who = user ? 'an account' : 'a guest';
      const address = school();
      let sent = 0;
      const through = await throughUntilRefused(async () => (await call(submitOn(tasks[sent++ % tasks.length].id), address, user)).statusCode, ceiling.capacity, ceiling.refillPerSecond);
      assert.ok(through >= ceiling.capacity, `${who} submits up to the ceiling across tasks (${through})`);
      assert.ok(Math.ceil(sent / tasks.length) < perTask.capacity, `${who}: the ceiling refused it, not one task's budget`);
    }
    assert.ok(ceiling.capacity >= 4 * perTask.capacity, 'the ceiling holds four tasks\' whole budgets');
    assert.equal(RATE_LIMITS.codingSubmitAddress.capacity, SHARED_NETWORK_SEATS * perTask.capacity, 'the address holds a class at the per-task rate');
  }

  // 10. A coding draft save is a write to api/user/[op].ts and takes its two
  //     tiers there; the handler holds no bucket of its own keyed by address.
  {
    const saved: number[] = [];
    const database = { rpc: async () => ({ data: null, error: null }) } as never;
    const address = school();
    for (let save = 0; save < 3; save += 1) {
      for (let n = 0; n < PUPILS; n += 1) {
        const res = mockResponse();
        const req = { method: 'POST', headers: { 'x-forwarded-for': address }, query: { op: 'coding-draft' }, body: { user_id: `draft-${stamp}-${n}`, id: freeTask.id, code: 'let x = 1;' }, socket: {} };
        if (await limitUserWrite(req as never, res as never, 'coding-draft')) await handleCodingDraft(req as never, res as never, database);
        saved.push(res.statusCode);
      }
    }
    assert.deepEqual(saved.filter((status) => status !== 200), [], 'thirty pupils behind one address each save their draft three times');
    assert.equal('codingDraft' in RATE_LIMITS, false, 'codingDraft is gone: limitUserWrite bounds a draft save');
  }
}

/** POST /api/quiz/submit grades only the sessions it serves, each checked
 * through the handler that really issues it. */
async function quizSubmitScopeContracts() {
  const learner = 'scope-contract-learner-01';
  const submitAll = async (sessionId: string, user?: string) => {
    const session = decodeSessionEnvelope(sessionId)!;
    const answers = Object.fromEntries(session.questions.map((q) => [q.questionId, q.correctAnswer]));
    const response = mockResponse();
    await submitHandler(quizRequest('POST', {}, { sessionId, answers }, user), response as never);
    return { session, response, body: response.body as { resultReceipt?: string; correctAnswers?: number; error?: { code: string } } };
  };

  // A Learn level: /api/quiz/roadmap?resource=answer reveals every correct
  // option before the level is finished, so this session must not be
  // gradable as a quiz.
  const level = mockResponse();
  await roadmapHandler(quizRequest('GET', { topic: 'javascript', level: '1' }), level as never);
  assert.equal(level.statusCode, 200, JSON.stringify(level.body));
  const learn = await submitAll((level.body as { sessionId: string }).sessionId, learner);
  assert.equal(learn.session.scope, 'roadmap');
  assert.equal(learn.response.statusCode, 400, 'a Learn level session is refused by the quiz grader');
  assert.equal(learn.body.error?.code, 'invalid_session');
  assert.equal(learn.body.resultReceipt, undefined, 'no quiz receipt, XP, streak day or board entry for a Learn level');

  // A standard quiz.
  const quiz = mockResponse();
  await questionsHandler(quizRequest('GET', { count: '2', difficulty: 'mixed', categories: 'javascript' }), quiz as never);
  assert.equal(quiz.statusCode, 200, JSON.stringify(quiz.body));
  const graded = await submitAll((quiz.body as { sessionId: string }).sessionId, learner);
  assert.equal(graded.response.statusCode, 200, JSON.stringify(graded.body));
  assert.equal(decodeQuizResultReceipt(graded.body.resultReceipt!)?.purpose, 'quiz');
  assert.equal(graded.session.scope, 'quiz');
  assert.equal((quiz.body as { expiresAt?: number }).expiresAt, undefined, 'standard quizzes expose no gameplay deadline');

  // The daily challenge, fetched and submitted signed in.
  const daily = mockResponse();
  await dailyHandler(quizRequest('GET', {}, undefined, learner), daily as never);
  assert.equal(daily.statusCode, 200, JSON.stringify(daily.body));
  const dailyGraded = await submitAll((daily.body as { sessionId: string }).sessionId, learner);
  assert.equal(dailyGraded.response.statusCode, 200, JSON.stringify(dailyGraded.body));
  assert.ok((daily.body as { expiresAt: number }).expiresAt <= dailyGraded.session.issuedAt + 60 * 60_000);
  assert.equal(decodeQuizResultReceipt(dailyGraded.body.resultReceipt!)?.purpose, 'daily');
  // Each outcome carries its question's XP (2 + 2 × difficulty when correct),
  // and the receipt's total, which migration 056 pays whole, repeats
  // included, is their sum. The daily's 20 XP minimum is in that total.
  for (const [what, body] of [['quiz', graded.body], ['daily', dailyGraded.body]] as const) {
    const receipt = decodeQuizResultReceipt(body.resultReceipt!)!;
    const perQuestion = receipt.outcomes.map((outcome) => outcome.xp);
    assert.ok(perQuestion.every((xp) => Number.isInteger(xp) && xp! >= 4 && xp! <= 100), `${what}: every correct outcome carries its XP (${perQuestion})`);
    const sum = perQuestion.reduce((total, xp) => total! + xp!, 0)!;
    assert.equal(receipt.questXp, what === 'daily' ? Math.max(20, sum) : sum, `${what}: the receipt's XP is the sum of its questions'`);
  }

  // The 20-question assessment.
  const assessment = mockResponse();
  await challengeHandler(quizRequest('GET', { resource: 'assessment', categories: deliveryCategories('webdev').join(',') }), assessment as never);
  assert.equal(assessment.statusCode, 200, JSON.stringify(assessment.body));
  const assessed = await submitAll((assessment.body as { sessionId: string }).sessionId, learner);
  assert.equal(assessed.response.statusCode, 200, JSON.stringify(assessed.body));
  assert.equal(decodeQuizResultReceipt(assessed.body.resultReceipt!)?.purpose, 'assessment');

  // A Biggest Shark Challenge batch, one answer at a time.
  const batch = mockResponse();
  await challengeHandler(quizRequest('GET', { categories: deliveryCategories('webdev').join(',') }, undefined, learner), batch as never);
  assert.equal(batch.statusCode, 200, JSON.stringify(batch.body));
  const batchSession = decodeSessionEnvelope((batch.body as { sessionId: string }).sessionId)!;
  const one = batchSession.questions[0];
  const challenged = mockResponse();
  await submitHandler(quizRequest('POST', {}, { sessionId: (batch.body as { sessionId: string }).sessionId, answers: { [one.questionId]: one.correctAnswer } }, learner), challenged as never);
  assert.equal(challenged.statusCode, 200, JSON.stringify(challenged.body));
  assert.equal((challenged.body as { resultReceipt?: string }).resultReceipt, undefined);

  // The question of the day is graded here too, as practice.
  const qotd = mockResponse();
  await dailyHandler(quizRequest('GET', { qotd: 'today' }), qotd as never);
  assert.equal(qotd.statusCode, 200, JSON.stringify(qotd.body));
  const checked = await submitAll((qotd.body as { sessionId: string }).sessionId, learner);
  assert.equal(checked.response.statusCode, 200, JSON.stringify(checked.body));
  assert.equal(checked.body.resultReceipt, undefined);

  // Nothing handed out before grading carries the question's tags: a dozen
  // served questions have a tag that is their correct option (rm-db-19
  // WHERE, rm-db-37 HAVING, rm-react-183 useCallback).
  const payloads: [string, unknown][] = [
    ['quiz', (quiz.body as { questions: unknown[] }).questions],
    ['daily', (daily.body as { questions: unknown[] }).questions],
    ['Learn level', (level.body as { questions: unknown[] }).questions],
    ['assessment', (assessment.body as { questions: unknown[] }).questions],
    ['challenge batch', (batch.body as { questions: unknown[] }).questions],
    ['question of the day', [(qotd.body as { question: unknown }).question]],
  ];
  // An allowlist rather than one blocked key: a question handed out before
  // grading carries what the learner needs to answer it and nothing else, so
  // a new field (correctAnswer, explanation, tags, a hint) fails here until it
  // is reviewed and added.
  const PRE_GRADING_KEYS = new Set(['id', 'introduction', 'question', 'options', 'category', 'difficulty', 'review']);
  for (const [label, questions] of payloads) {
    assert.ok((questions as unknown[]).length > 0, `${label} hands out questions`);
    for (const question of questions as Record<string, unknown>[]) {
      assert.equal('tags' in question, false, `${label} sends ${String(question.id)} with its tags before grading`);
      const extra = Object.keys(question).filter((key) => !PRE_GRADING_KEYS.has(key));
      assert.deepEqual(extra, [], `${label} sends ${String(question.id)} with ${extra.join(', ')} before grading`);
    }
  }
  const placement = mockResponse();
  await roadmapHandler(quizRequest('GET', { resource: 'placement', subject: 'webdev' }), placement as never);
  assert.equal(placement.statusCode, 200, JSON.stringify(placement.body));
  for (const question of (placement.body as { questions: Record<string, unknown>[] }).questions) {
    assert.equal('tags' in question, false, 'a placement round sends no tags');
    const extra = Object.keys(question).filter((key) => !PRE_GRADING_KEYS.has(key));
    assert.deepEqual(extra, [], `a placement round sends ${String(question.id)} with ${extra.join(', ')} before grading`);
  }
}

/** devShark ships English only (#485), and no request carries `lang` any
 * more. An old cached client may still send one for a while, so a stray
 * `lang` in the query or the body is ignored rather than refused: a Learn
 * level, a placement round, a quiz and its grading all answer 200 in English. */
async function strayLangContracts() {
  const english = await getEffectiveQuestionsById('webdev');
  const assertEnglish = (label: string, questions: { id: string; question: string; options: string[] }[]) => {
    assert.ok(questions.length > 0, `${label} hands out questions`);
    for (const served of questions) {
      const source = english.get(served.id);
      assert.ok(source, `${label}: ${served.id} is a served question`);
      assert.equal(served.question, source!.question, `${label}: ${served.id} is served in English`);
      assert.deepEqual([...served.options].sort(), [...source!.options].sort(), `${label}: ${served.id} offers its English options`);
    }
  };

  const level = mockResponse();
  await roadmapHandler(quizRequest('GET', { topic: 'javascript', level: '1', lang: 'cs' }), level as never);
  assert.equal(level.statusCode, 200, `a Learn level with a stray lang is served (${JSON.stringify(level.body)})`);
  assertEnglish('Learn level', (level.body as { questions: { id: string; question: string; options: string[] }[] }).questions);

  const placement = mockResponse();
  await roadmapHandler(quizRequest('GET', { resource: 'placement', subject: 'webdev', lang: 'cs' }), placement as never);
  assert.equal(placement.statusCode, 200, `a placement round with a stray lang is served (${JSON.stringify(placement.body)})`);
  assertEnglish('placement', (placement.body as { questions: { id: string; question: string; options: string[] }[] }).questions);

  const quiz = mockResponse();
  await questionsHandler(quizRequest('GET', { count: '3', difficulty: 'mixed', categories: 'javascript', lang: 'cs' }), quiz as never);
  assert.equal(quiz.statusCode, 200, `a quiz with a stray lang is served (${JSON.stringify(quiz.body)})`);
  const quizBody = quiz.body as { sessionId: string; questions: { id: string; question: string; options: string[] }[] };
  assertEnglish('quiz', quizBody.questions);
  const session = decodeSessionEnvelope(quizBody.sessionId)!;
  const answers = Object.fromEntries(session.questions.map((q) => [q.questionId, q.correctAnswer]));
  const graded = mockResponse();
  await submitHandler(quizRequest('POST', {}, { sessionId: quizBody.sessionId, answers, lang: 'cs' }), graded as never);
  assert.equal(graded.statusCode, 200, `a quiz submit with a stray lang is graded (${JSON.stringify(graded.body)})`);
  const results = (graded.body as { results: { questionId: string; isCorrect: boolean; explanation: string }[] }).results;
  assert.equal(results.length, session.questions.length);
  for (const result of results) {
    assert.equal(result.isCorrect, true, `${result.questionId} is graded on its sealed key`);
    assert.equal(result.explanation, english.get(result.questionId)!.explanation, `${result.questionId} is explained in English`);
  }
}

/** devShark ships English only (#485). No second-language file is left in
 * the code, no client fetcher puts `lang` on a request (not as a query
 * parameter, not as a body field and not through URLSearchParams), and every
 * code file that mentions Czech is on a reasoned list. */
function englishOnlyContracts() {
  const sources = ['api', 'lib', 'shared', 'scripts', 'tests', 'client/src', 'client/tests', 'client/.storybook'].flatMap(codeFiles);
  const overlays = sources.filter((file) => /\.cs\.(ts|tsx)$/.test(file));
  assert.deepEqual(overlays, [], 'no second-language overlay file remains');
  const SENDS_LANG = [
    /[?&]lang=/,
    /\b(?:set|append)\(\s*['"]lang['"]/,
    /(?<![\w.-])lang\s*:/,
    /[{,]\s*lang\s*[,}]/,
    /\bgetStoredLang\b/,
  ];
  const offenders = codeFiles('client/src').flatMap((file) =>
    readFileSync(join(process.cwd(), file), 'utf8').split('\n').flatMap((line, index) =>
      /^\s*(\/\/|\*|\/\*)/.test(line) || !SENDS_LANG.some((pattern) => pattern.test(line)) ? [] : [`${file}:${index + 1}`]));
  assert.deepEqual(offenders, [], 'no client fetcher sends lang');

  // The #485 acceptance grep (`grep -rli czech` over .ts, .tsx and .mjs) may
  // match only these files, each for a reason other than a second interface
  // language. A new match fails here until it is removed or listed with its
  // reason, and a listed file that stops matching must leave the list.
  const CZECH_MENTIONS: Record<string, string> = {
    'client/product-catalog.ts': 'the trader ID (IČO) and registered address',
    'client/src/components/LegalPages.tsx': 'the Czech out-of-court dispute body',
    'client/src/i18n/translations.privacy.ts': 'the Czech data protection office',
    'client/src/i18n/translations.ts': 'Czech law and the Czech Trade Inspection Authority',
    'client/tests/merch.test.tsx': 'Czechia as a shipping region',
    'client/tests/premium-page.test.tsx': 'the trader address',
    'lib/billing/handlers.ts': 'the Czech Civil Code',
    'lib/roadmap-questions-ai.ts': 'quiz content on how a Czech sentence tokenizes',
    'lib/roadmap-questions-cool-stuff.ts': "quiz content about the word 'robot'",
    'scripts/product-cleanup-contracts.ts': 'Czechia as a shipping region',
    'scripts/test-launch-contracts.ts': 'this list',
    'shared/coding-locale.ts': 'the Czech koruna currency name',
    'shared/coding-utc-time.ts': 'the Czechia Time zone label',
    'shared/launch-offer.ts': 'the Czech price indication law',
  };
  const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'test-results', 'playwright-report', '.vercel']);
  const walk = (dir: string): string[] => readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : walk(path);
    return /\.(ts|tsx|mjs)$/.test(entry.name) ? [path] : [];
  });
  const mentions = walk('.').filter((file) => /czech/i.test(readFileSync(join(process.cwd(), file), 'utf8'))).sort();
  assert.deepEqual(mentions, Object.keys(CZECH_MENTIONS).sort(), 'every file that mentions Czech is listed with its reason');
}

/** Advanced asked of a topic with nothing above difficulty 2 is served its
 * hardest questions, and says so, instead of a 404 that Retry repeats. */
async function quizDifficultyContracts() {
  const served = await getEffectiveQuestions('webdev');
  const hardestHtml = Math.max(...served.filter((q) => q.category === 'html').map((q) => q.difficulty));
  assert.ok(hardestHtml < 3, 'this contract needs a topic with no advanced questions');
  const html = mockResponse();
  await questionsHandler(quizRequest('GET', { count: '5', difficulty: 'advanced', categories: 'html' }), html as never);
  assert.equal(html.statusCode, 200, JSON.stringify(html.body));
  const htmlBody = html.body as { questions: { difficulty: number }[]; hardestAvailable?: boolean };
  assert.equal(htmlBody.hardestAvailable, true);
  assert.ok(htmlBody.questions.length > 0 && htmlBody.questions.every((q) => q.difficulty === hardestHtml));

  const js = mockResponse();
  await questionsHandler(quizRequest('GET', { count: '5', difficulty: 'advanced', categories: 'javascript,html' }), js as never);
  assert.equal(js.statusCode, 200, JSON.stringify(js.body));
  const jsBody = js.body as { questions: { difficulty: number }[]; hardestAvailable?: boolean };
  assert.equal(jsBody.hardestAvailable, undefined, 'a selection with advanced questions is served those');
  assert.ok(jsBody.questions.every((q) => q.difficulty >= 3));

  // A repeated categories parameter arrives as an array: it is not a list to
  // split, and must not throw into a 500.
  const repeated = mockResponse();
  await questionsHandler({ ...(quizRequest('GET', { count: '3', difficulty: 'mixed' }) as object), query: { count: '3', difficulty: 'mixed', categories: ['javascript', 'html'] } } as never, repeated as never);
  assert.equal(repeated.statusCode, 200, `a repeated categories parameter is read as none given (${JSON.stringify(repeated.body)})`);
}

/** The /dev "Daily challenge" switch turns the challenge off on the server;
 * the question of the day is its own feature and stays open. */
async function dailySwitchContracts() {
  setGameSettingsForTests({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, dailyChallenge: false } });
  try {
    const off = mockResponse();
    await dailyHandler(quizRequest('GET', {}), off as never);
    assert.equal(off.statusCode, 503, JSON.stringify(off.body));
    assert.equal((off.body as { error: { code: string } }).error.code, 'feature_disabled');
    const qotd = mockResponse();
    await dailyHandler(quizRequest('GET', { qotd: 'today' }), qotd as never);
    assert.equal(qotd.statusCode, 200, JSON.stringify(qotd.body));
  } finally {
    setGameSettingsForTests(null);
  }
  const on = mockResponse();
  await dailyHandler(quizRequest('GET', {}), on as never);
  assert.equal(on.statusCode, 200, JSON.stringify(on.body));

  const invalid = mockResponse();
  await dailyHandler(quizRequest('GET', { date: '2026-11-31' }), invalid as never);
  assert.equal(invalid.statusCode, 400, 'November 31 cannot start a Daily attempt');
  assert.equal((invalid.body as { error: { message: string } }).error.message, 'date must be YYYY-MM-DD');

  const repeated = mockResponse();
  await dailyHandler({ ...(quizRequest('GET', {}) as object), query: { date: [utcToday()] } } as never, repeated as never);
  assert.equal(repeated.statusCode, 400, 'a date query must be a single string');
}

/** A signed-in learner has one ranked daily attempt, timed from the first
 * time they were handed the day's questions. */
async function dailyIntegrityContracts() {
  const learner = 'daily-contract-learner-01';
  const fetchDaily = async (user?: string, query: Record<string, string> = {}) => {
    const response = mockResponse();
    await dailyHandler(quizRequest('GET', query, undefined, user), response as never);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    return response;
  };
  const submitAll = async (sessionId: string, user?: string) => {
    const session = decodeSessionEnvelope(sessionId)!;
    const answers = Object.fromEntries(session.questions.map((q) => [q.questionId, q.correctAnswer]));
    const response = mockResponse();
    await submitHandler(quizRequest('POST', {}, { sessionId, answers }, user), response as never);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    return response.body as { resultReceipt?: string; correctAnswers: number };
  };

  const first = await fetchDaily(learner);
  // Never cached: a response fetched signed out must not be served again
  // once the learner signs in.
  assert.match(first.headers.get('cache-control') ?? '', /no-store/);
  assert.match(first.headers.get('vary') ?? '', /Authorization/i);

  // Fetched signed out, the day's questions carry a random attempt id.
  // Submitted signed in with every answer right, they are practice: no
  // receipt, so no daily result, XP or streak day, and nothing to replace
  // the learner's own attempt with.
  const anonymous = await fetchDaily();
  const practised = await submitAll((anonymous.body as { sessionId: string }).sessionId, learner);
  assert.equal(practised.correctAnswers > 0, true);
  assert.equal(practised.resultReceipt, undefined, 'a daily fetched signed out never ranks a signed-in learner');

  // Fetching again just before submitting does not restart the clock.
  await new Promise((resolve) => setTimeout(resolve, 60));
  type DailyBody = { sessionId: string; questions: { category: string }[] };
  const firstBody = first.body as DailyBody;
  // A valid category subset that excludes a question already dealt must
  // still get the same ranked challenge, with the same option order.
  const subset = deliveryCategories('webdev').find((category) => category !== firstBody.questions[0].category)!;
  const again = await fetchDaily(learner, { categories: subset });
  const againBody = again.body as DailyBody;
  assert.deepEqual(againBody.questions, firstBody.questions, 'topic filters cannot change the ranked daily questions');
  const firstSession = decodeSessionEnvelope(firstBody.sessionId)!;
  const againSession = decodeSessionEnvelope(againBody.sessionId)!;
  assert.equal(againSession.attemptId, firstSession.attemptId, 'one attempt a day');
  assert.equal(againSession.startedAt, firstSession.startedAt, 'the start is the first fetch of the day');
  const ranked = await submitAll(againBody.sessionId, learner);
  const receipt = decodeQuizResultReceipt(ranked.resultReceipt!);
  assert.equal(receipt?.purpose, 'daily');
  assert.ok((receipt?.daily?.durationMs ?? 0) >= 60, `the time runs from the first fetch, got ${receipt?.daily?.durationMs} ms`);
}

/** A daily fetched signed in names its account (PROF-1). A submit of it that
 * arrives without the token (a client that could not read its session) is
 * refused with 401 before anything is claimed, so the same answers still rank
 * when they come back signed in; another account's submit is refused too. */
async function dailyOwnerContracts() {
  const learner = 'daily-owner-learner-001';
  const other = 'daily-owner-learner-002';
  const fetched = mockResponse();
  await dailyHandler(quizRequest('GET', {}, undefined, learner), fetched as never);
  assert.equal(fetched.statusCode, 200, JSON.stringify(fetched.body));
  const sessionId = (fetched.body as { sessionId: string }).sessionId;
  const session = decodeSessionEnvelope(sessionId)!;
  assert.equal(session.userId, learner, 'the daily session names the account it was fetched for');
  const answers = Object.fromEntries(session.questions.map((q) => [q.questionId, q.correctAnswer]));
  const submit = async (user?: string) => {
    const response = mockResponse();
    await submitHandler(quizRequest('POST', {}, { sessionId, answers }, user), response as never);
    return { status: response.statusCode, body: response.body as { resultReceipt?: string; error?: { code: string } } };
  };

  const tokenless = await submit();
  assert.equal(tokenless.status, 401, `a signed-in daily sent without the token is refused (${JSON.stringify(tokenless.body)})`);
  assert.equal(tokenless.body.error?.code, 'sign_in_required');
  const stranger = await submit(other);
  assert.equal(stranger.status, 409, `another account's submit is refused (${JSON.stringify(stranger.body)})`);
  assert.equal(stranger.body.error?.code, 'session_owner_mismatch');
  const ranked = await submit(learner);
  assert.equal(ranked.status, 200, `the same answers rank once they come back signed in (${JSON.stringify(ranked.body)})`);
  assert.equal(decodeQuizResultReceipt(ranked.body.resultReceipt!)?.purpose, 'daily');

  // Fetched signed out, the daily names nobody and stays open to a guest.
  const anonymous = mockResponse();
  await dailyHandler(quizRequest('GET', {}), anonymous as never);
  const guestSessionId = (anonymous.body as { sessionId: string }).sessionId;
  const guestSession = decodeSessionEnvelope(guestSessionId)!;
  assert.equal(guestSession.userId, null);
  const guest = mockResponse();
  await submitHandler(quizRequest('POST', {}, {
    sessionId: guestSessionId,
    answers: Object.fromEntries(guestSession.questions.map((q) => [q.questionId, q.correctAnswer])),
  }), guest as never);
  assert.equal(guest.statusCode, 200, JSON.stringify(guest.body));
}

/** The launch price (shared/launch-offer.ts): 4 Oct 2026 00:00 to 30 Nov 2026
 * 23:59:59 in Prague, inert without billing and the coupon. */
function launchOfferContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const prague = (instant: number) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).format(instant);
  // The edges, read back in Prague time: CEST at the start, CET at the end.
  assert.equal(prague(LAUNCH_OFFER.startsAt), '04/10/2026, 00:00:00 CEST');
  assert.equal(prague(LAUNCH_OFFER.endsBefore - 1), '30/11/2026, 23:59:59 CET');
  assert.equal(prague(LAUNCH_OFFER.endsBefore), '01/12/2026, 00:00:00 CET');
  assert.equal(LAUNCH_REDEEM_BY, 1796079599, 'the coupon redeem_by: 30 Nov 2026 23:59:59 CET');
  assert.equal(prague(LAUNCH_REDEEM_BY * 1000), '30/11/2026, 23:59:59 CET');
  // The window, edge instants included and excluded.
  assert.equal(launchWindowOpen(LAUNCH_OFFER.startsAt - 1), false, '3 Oct 23:59:59.999 Prague: closed');
  assert.equal(launchWindowOpen(LAUNCH_OFFER.startsAt), true, '4 Oct 00:00 Prague: open');
  assert.equal(launchWindowOpen(Date.parse('2026-10-03T23:59:59+02:00')), false, '3 Oct 23:59:59 Prague (UTC 21:59:59): closed');
  assert.equal(launchWindowOpen(Date.parse('2026-10-04T01:59:59+02:00')), true, '4 Oct 01:59:59 Prague (still 3 Oct in UTC): open');
  assert.equal(launchWindowOpen(LAUNCH_OFFER.endsBefore - 1), true, '30 Nov 23:59:59.999 Prague: open');
  assert.equal(launchWindowOpen(LAUNCH_OFFER.endsBefore), false, '1 Dec 00:00 Prague: closed');
  assert.equal(launchWindowOpen(Date.parse('2026-09-28T12:00:00Z')), false, 'today, 28 Sep: closed');
  assert.equal(launchWindowOpen(Number.NaN), false);
  // 25 Oct 2026: clocks go back from 03:00 CEST to 02:00 CET, so 02:30 happens
  // twice. Both are inside, as are the hours around the change.
  for (const iso of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-24T23:59:59Z', '2026-10-25T02:00:00Z']) {
    assert.equal(launchWindowOpen(Date.parse(iso)), true, `${iso} (${prague(Date.parse(iso))}) is inside the window`);
  }
  assert.equal(prague(Date.parse('2026-10-25T00:30:00Z')), '25/10/2026, 02:30:00 CEST');
  assert.equal(prague(Date.parse('2026-10-25T01:30:00Z')), '25/10/2026, 02:30:00 CET');
  // Inert unless billing is on and the coupon is set.
  const inside = Date.parse('2026-10-10T10:00:00Z');
  assert.equal(activeLaunchCoupon({ now: inside, checkoutEnabled: true, coupon: 'launch55' }), 'launch55');
  assert.equal(activeLaunchCoupon({ now: inside, checkoutEnabled: true, coupon: null }), null, 'env missing: inactive');
  assert.equal(activeLaunchCoupon({ now: inside, checkoutEnabled: false, coupon: 'launch55' }), null, 'billing off: inactive');
  assert.equal(activeLaunchCoupon({ now: LAUNCH_OFFER.endsBefore, checkoutEnabled: true, coupon: 'launch55' }), null, 'after the window: inactive');
  assert.equal(launchCouponId(undefined), null);
  assert.equal(launchCouponId('  '), null);
  assert.equal(launchCouponId(' launch55 '), 'launch55');
  assert.equal(launchCouponId('launch 55'), null);
  assert.equal(LAUNCH_COUPON_ENV, 'STRIPE_COUPON_LAUNCH');
  assert.equal(publicBillingSettings({ BILLING_ENABLED: 'true', STRIPE_COUPON_LAUNCH: 'launch55' }, inside).launchOffer, false, 'an incomplete Stripe setup sells nothing, offer or not');
  // The prices: 55 % off, rounded to the cent the way Stripe rounds a
  // percentage coupon, derived from PREMIUM_PRICE.
  assert.equal(discountedPrice('4.99'), '2.25');
  assert.equal(discountedPrice('59.88'), '26.95');
  assert.equal(discountedPrice('10.00', 50), '5.00');
  assert.throws(() => discountedPrice('3.9'));
  const display = launchOfferDisplay();
  assert.deepEqual(
    { percent: display.percent, symbol: display.symbol, monthly: display.monthly, annual: display.annual, offerMonthly: display.offerMonthly, offerAnnual: display.offerAnnual },
    { percent: 55, symbol: '€', monthly: '4.99', annual: '59.88', offerMonthly: '2.25', offerAnnual: '26.95' },
  );
  assert.equal(display.startDate, '4 October 2026');
  assert.equal(display.endDate, '30 November 2026');
  assert.equal(display.endDateShort, '30 Nov 2026');
  assert.equal(display.regularFrom, '1 Dec 2026');
  assert.equal(display.regularFromLong, '1 December 2026');
  // The module is pure and the copy carries no price or date of its own.
  assert.doesNotMatch(read('shared/launch-offer.ts'), /from '\.\.\/lib\//, 'shared/launch-offer.ts imports nothing from lib/');
  const offerKeys = Object.entries(ENGLISH).filter(([key]) => /^(premium\.offer\.|premium\.page\.titleOffer|premium\.page\.faq\.offer|landing\.compare\.premiumCaptionOffer|legal\.terms\.price\.(launch|discount))/.test(key));
  assert.ok(offerKeys.length >= 10);
  for (const [key, value] of offerKeys) {
    assert.doesNotMatch(value, /\d+\.\d{2}|\b20\d\d\b|\b55\b/, `${key} reads prices, dates and the percentage from shared/launch-offer.ts`);
    // Launch-price framing: Premium was never sold before, so no page may
    // cite a lowest earlier price (EU Price Indication Directive art. 6a).
    assert.doesNotMatch(value, /lowest price|last 30 days|was \{/i, `${key} cites no earlier price`);
    assert.doesNotMatch(value, /\b(hurry|only \d+ left|limited time|ends soon|last chance|act now|today only|countdown)\b/i, `${key} uses urgency copy`);
  }
  for (const key of ['premium.offer.price', 'landing.compare.premiumCaptionOffer', 'legal.terms.price.launch'] as const) {
    assert.match(ENGLISH[key], /before VAT/, `${key} states the price with VAT`);
  }
  // The struck regular price is always named as the regular price from 1 Dec.
  assert.match(ENGLISH['premium.offer.regular'], /regular price of .* which applies from \{regularFrom\}/);
  assert.match(ENGLISH['premium.offer.srPrice'], /regular price from \{regularFrom\}/);
}

/** op=leaderboard-visibility (migration 049): a signed-in learner reads and
 * sets whether the public boards show their name and photo. Run against a
 * stand-in user_stats table. */
async function leaderboardVisibilityContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  // A branch of the existing handler, behind the route's write limit.
  const route = read('api/user/[op].ts');
  const limited = route.indexOf('if (!(await limitUserWrite(req, res, op))) return;');
  const branch = route.indexOf("if (op === 'leaderboard-visibility') return handleLeaderboardVisibility(req, res, supabase);");
  assert.ok(limited > 0 && branch > limited, 'op=leaderboard-visibility is a branch of api/user/[op].ts after the write limit');

  // The stand-in: one row per account, the supabase-js calls the op makes.
  const rows = new Map<string, Record<string, unknown>>();
  const writes: { row: Record<string, unknown>; onConflict?: string }[] = [];
  let missingColumn = false;
  const db = {
    from(table: string) {
      assert.equal(table, 'user_stats');
      let userId = '';
      let written: Record<string, unknown> | null = null;
      const answer = () => missingColumn
        ? { data: null, error: { code: '42703', message: 'column user_stats.show_on_leaderboards does not exist' } }
        : { data: rows.has(userId) ? { show_on_leaderboards: rows.get(userId)!.show_on_leaderboards } : null, error: null };
      const query = {
        select(columns: string) { assert.equal(columns, 'show_on_leaderboards'); return query; },
        eq(column: string, value: string) { assert.equal(column, 'user_id'); userId = value; return query; },
        upsert(row: Record<string, unknown>, options?: { onConflict?: string }) {
          writes.push({ row, onConflict: options?.onConflict });
          written = row;
          userId = String(row.user_id);
          return query;
        },
        async maybeSingle() { return answer(); },
        async single() {
          if (written && !missingColumn) rows.set(userId, { ...(rows.get(userId) ?? { show_on_leaderboards: false }), ...written });
          return answer();
        },
      };
      return query;
    },
  };
  const call = async (method: string, options: { user?: string | null; body?: unknown } = {}) => {
    const user = options.user === undefined ? 'contract-visibility-1' : options.user;
    const res = mockResponse();
    await handleLeaderboardVisibility({
      method,
      headers: {},
      query: { op: 'leaderboard-visibility', ...(user ? { user_id: user } : {}) },
      body: options.body,
    } as never, res as never, db as never);
    return res;
  };

  // Signed in only, GET and PUT only.
  assert.equal((await call('GET', { user: null })).statusCode, 401, 'a guest cannot read it');
  assert.equal((await call('PUT', { user: null, body: { visible: true } })).statusCode, 401, 'a guest cannot set it');
  const post = await call('POST', { body: { visible: true } });
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.get('allow'), 'GET, PUT');

  // Off until the learner switches it on; a learner without a row is off.
  const first = await call('GET');
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { visible: false });
  assert.equal(first.headers.get('cache-control'), 'private, no-store');

  // The body is `{ visible: boolean }` and nothing else is read from it.
  for (const body of [undefined, null, {}, { visible: 'true' }, { visible: 1 }, { visible: null }, [true]]) {
    const refused = await call('PUT', { body });
    assert.equal(refused.statusCode, 400, `${JSON.stringify(body)} is refused`);
    assert.equal((refused.body as { error?: { code?: string } }).error?.code, 'bad_request');
  }
  assert.equal(writes.length, 0, 'a refused body writes nothing');

  const on = await call('PUT', { body: { visible: true, name: 'Someone Else', picture: 'https://example.com/me.png', user_id: 'contract-visibility-1' } });
  assert.equal(on.statusCode, 200);
  assert.deepEqual(on.body, { visible: true });
  assert.equal(on.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(writes.at(-1), {
    row: { user_id: 'contract-visibility-1', email: null, name: null, picture: null, show_on_leaderboards: true },
    onConflict: 'user_id',
  }, 'the row is the verified account\'s, created if missing, with the verified name and picture and never the body\'s');
  assert.deepEqual((await call('GET')).body, { visible: true }, 'the choice is stored');
  assert.deepEqual((await call('GET', { user: 'contract-visibility-2' })).body, { visible: false }, 'and it is that account\'s alone');
  assert.deepEqual((await call('PUT', { body: { visible: false } })).body, { visible: false }, 'switching it off');
  assert.deepEqual((await call('GET')).body, { visible: false });

  // Before migration 049 the column is missing: say so rather than 500.
  missingColumn = true;
  const missing = await call('GET');
  assert.equal(missing.statusCode, 503);
  assert.equal((missing.body as { error?: { code?: string } }).error?.code, 'migration_required');
  missingColumn = false;

  // Each PUT is charged to the account by the route's write limit; a GET is not.
  const stamp = Date.now();
  const limit = async (method: string, userId: string) => {
    const res = mockResponse();
    const req = { method, headers: { 'x-forwarded-for': `visibility-${stamp}` }, query: { op: 'leaderboard-visibility' }, body: { user_id: userId, visible: true }, socket: {} };
    return (await limitUserWrite(req as never, res as never, 'leaderboard-visibility')) ? 200 : res.statusCode;
  };
  for (let n = 0; n < RATE_LIMITS.userMutation.capacity; n += 1) {
    assert.equal(await limit('PUT', `visibility-${stamp}-a`), 200, `switch ${n + 1} is allowed`);
  }
  assert.equal(await limit('PUT', `visibility-${stamp}-a`), 429, 'one account is bounded at the per-account write rate');
  assert.equal(await limit('PUT', `visibility-${stamp}-b`), 200, 'which spends nobody else\'s budget');
  assert.equal(await limit('GET', `visibility-${stamp}-a`), 200, 'reading it is not a write');
}

/** A classroom question closes on "Reveal answer", and a running classroom's
 * scoreboard counts only closed questions (migration 056, owner decision 6).
 * The behaviour runs in scripts/test-play-rooms.ts and
 * supabase/tests/190-classroom-scoreboard-closed-questions.test.sql; these are
 * the wiring between the migration, the handler and the screen. */
function classroomRevealContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const migration = read('supabase/supabase-schema-056.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS revealed_idx INTEGER/, '056 adds the closed question to the room');
  const dropped = migration.indexOf('DROP FUNCTION IF EXISTS public.match_scoreboard(UUID);');
  const created = migration.indexOf('CREATE OR REPLACE FUNCTION public.match_scoreboard(');
  assert.ok(dropped >= 0 && dropped < created, 'the one-argument scoreboard goes first, so a call by name is never ambiguous');
  const scoreboard = migration.slice(created, migration.indexOf('$$;', created));
  assert.match(scoreboard, /p_before_idx INTEGER DEFAULT NULL/, 'the new argument has a default, so the code in production keeps calling it');
  assert.match(scoreboard, /AND \(p_before_idx IS NULL OR a\.question_idx < p_before_idx\)/, 'the filter sits in the join, so a pupil with nothing counted keeps a row');
  assert.match(scoreboard, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.match_scoreboard\(UUID, INTEGER\) FROM PUBLIC, anon, authenticated;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.match_scoreboard\(UUID, INTEGER\) TO service_role;/);

  const play = read('api/play/[action].ts');
  assert.match(play, /const STATE_COLUMNS =\s+'[^']*\brevealed_idx\b/, 'state reads the closed question');
  assert.match(play, /body\.action !== 'reveal'/, 'reveal is a control action');
  const answer = play.slice(play.indexOf('async function answer('), play.indexOf('async function distribution('));
  const replay = answer.indexOf('if (existing) return res.json(reply(existing, false));');
  const closed = answer.indexOf("'question_closed'");
  const timeUp = answer.indexOf("'time_up'");
  assert.ok(replay > 0 && replay < closed && closed < timeUp,
    'an answer to a closed question is refused after a retry of an earlier answer is replayed, like a late one');
  // A classroom answer is acknowledged, never graded back: every reply goes
  // through the one function, whose classroom branch carries no result.
  assert.match(answer, /classroom\s+\? \{ ok: true, accepted: true, advanced: false \}/, 'a classroom reply carries no is_correct or speed bonus');
  assert.equal(answer.match(/res\.json\(\{ ok: true, is_correct/g), null, 'no reply grades an answer outside reply()');
  const state = play.slice(play.indexOf('async function state('), play.indexOf('async function control('));
  assert.match(state, /p_before_idx: beforeIdx/, 'a running classroom asks for its closed questions only');
  assert.match(state, /beforeIdx === null \? \{ p_match_id: match\.id \}/, 'every other room makes the call it always made');

  const client = read('client/src/lib/play.ts');
  assert.match(client, /action: 'start' \| 'advance' \| 'finish' \| 'reveal'/, 'the presenter sends the reveal to the server');
  const screen = read('client/src/components/Play.tsx');
  assert.doesNotMatch(screen, /setRevealedIdx/, 'the key no longer shows on a local click alone');
  assert.match(screen, /onClick=\{onReveal\}/);
}

/** The month's XP ledger and the top three it pays (migration 056, owner
 * decision 8). user_xp_days must hear of every verified award, so every
 * routine whose newest definition adds to user_xp also adds to the ledger,
 * except merge_user_xp: guest XP merged at sign-in was never verified. The
 * behaviour runs in supabase/tests/191 to 194. */
function monthlyXpContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const files = readdirSync(join(process.cwd(), 'supabase'))
    .filter((name) => /^supabase-schema-\d{3}\.sql$/.test(name))
    .sort();
  // The newest definition of every routine.
  const newest = new Map<string, { file: string; body: string }>();
  for (const file of files) {
    const sql = read(`supabase/${file}`);
    for (const match of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/g)) {
      const start = match.index!;
      const bodyStart = sql.indexOf('$$', start);
      const body = sql.slice(start, sql.indexOf('$$', bodyStart + 2));
      newest.set(match[1], { file, body });
    }
  }
  const writers = [...newest.entries()].filter(([, { body }]) => /INSERT INTO public\.user_xp \(/.test(body));
  assert.deepEqual(writers.map(([name]) => name).sort(), ['merge_user_xp', 'record_verified_activity_xp', 'record_verified_quiz_result_v2'],
    'the routines that add XP to an account');
  for (const [name, { file, body }] of writers) {
    if (name === 'merge_user_xp') {
      assert.doesNotMatch(body, /add_xp_day/, 'merged guest XP is not verified and does not count toward a month');
      continue;
    }
    assert.match(body, /PERFORM public\.add_xp_day\(p_user_id, p_subject, /, `${name} (${file}) adds its award to the month's XP`);
  }
  // Learning XP lives in verified progress, not in user_xp: a first pass adds it.
  const learn = newest.get('complete_verified_roadmap_attempt')!;
  assert.equal(learn.file, 'supabase-schema-062.sql', 'the Learn completion that credits the month and leaves coding pending is the one that runs');
  assert.match(learn.body, /IF p_user_id IS NOT NULL AND v_passed AND NOT v_was_passed THEN\s+PERFORM public\.add_xp_day\(p_user_id, v_attempt\.subject, public\.learn_step_xp\(v_attempt\.kind, v_attempt\.ref\)\);/,
    'only a first pass earns a step its learning XP');
  // A Learn replay pays its XP again an hour after the step last paid (060),
  // through the award routine, so the month counts it too, and only the new
  // code calls it: the completion production calls keeps 056's body.
  const repeat = newest.get('complete_verified_roadmap_attempt_v2')!;
  assert.equal(repeat.file, 'supabase-schema-060.sql');
  assert.match(repeat.body, /v_applied := public\.complete_verified_roadmap_attempt\(p_user_id, p_attempt_id, p_coding_task_ids\);/,
    'the replay wraps the completion of 056');
  assert.match(repeat.body, /AND last_xp_at <= NOW\(\) - INTERVAL '60 minutes'/, 'an hour after the step last paid');
  assert.match(repeat.body, /public\.record_verified_activity_xp\(p_user_id, 'learn-repeat:' \|\| p_attempt_id, v_attempt\.subject, v_xp\)/,
    'under the attempt\'s own award id, into the balance and the month');
  const atomic = newest.get('complete_verified_roadmap_attempt_v3')!;
  assert.equal(atomic.file, 'supabase-schema-076.sql');
  assert.match(atomic.body, /v_result := public\.complete_verified_roadmap_attempt_v2\(p_user_id, p_attempt_id, p_coding_task_ids\);/);
  assert.match(atomic.body, /IF v_result->'firstPass' = 'true'::JSONB THEN[\s\S]+PERFORM public\.credit_verified_xp_tokens\(/,
    'the first-pass coin receipt is part of the completion transaction');
  const hearts = newest.get('complete_roadmap_attempt_on_hearts')!;
  assert.equal(hearts.file, 'supabase-schema-076.sql');
  assert.match(hearts.body, /UPDATE public\.roadmap_attempts[\s\S]+PERFORM public\.advance_verified_streak\(p_user_id\)/,
    'losing the last heart closes the level and records the streak together');
  const roadmapHandler = read('api/quiz/roadmap.ts');
  assert.match(roadmapHandler, /let completed = await withTimeout\(supabase\.rpc\('complete_verified_roadmap_attempt_v3',/);
  assert.match(roadmapHandler, /const legacyCompletion = completed\.error\?\.code === 'PGRST202';[\s\S]+if \(legacyCompletion\) \{\s+completed = await withTimeout\(supabase\.rpc\('complete_verified_roadmap_attempt_v2', completion\)\);/,
    'only a missing atomic entrypoint permits 060');
  assert.match(roadmapHandler, /if \(completed\.error\?\.code === 'PGRST202'\) \{\s+if \(passed\) passedBefore = await stepPassed\(userId, session\);\s+completed = await withTimeout\(supabase\.rpc\('complete_verified_roadmap_attempt', completion\)\);/,
    'a database without 060 still completes as before');
  // learn_step_xp is shared/progression.ts in SQL.
  const progression = read('shared/progression.ts');
  assert.match(progression, /export const LEVEL_XP_PER_DIFFICULTY = 50;/);
  assert.match(progression, /export const CHECKPOINT_XP_PER_PART = 300;/);
  assert.match(progression, /Math\.min\(5, Math\.max\(1, Math\.ceil\(level \/ 5\)\)\)/);
  const stepXp = newest.get('learn_step_xp')!.body;
  assert.match(stepXp, /WHEN p_kind = 'level' THEN 50 \* LEAST\(5, GREATEST\(1, CEIL\(p_ref \/ 5\.0\)::INTEGER\)\)/, 'a level is 50 × its tier, as learnLevelXp says');
  assert.match(stepXp, /WHEN p_kind = 'checkpoint' THEN 300 \* p_ref/, 'part test n is 300 × n, as learnCheckpointXp says');
  // Nothing else writes the ledger, and the browser cannot.
  for (const [name, { body }] of newest) {
    if (name === 'add_xp_day') continue;
    assert.doesNotMatch(body, /(INSERT INTO|UPDATE) public\.user_xp_days/, `${name} writes the ledger only through add_xp_day`);
  }
  const migration = read('supabase/supabase-schema-056.sql');
  assert.match(migration, /ALTER TABLE public\.user_xp_days ENABLE ROW LEVEL SECURITY;/);
  assert.match(migration, /REVOKE ALL ON public\.user_xp_days FROM PUBLIC, anon, authenticated;\s+GRANT SELECT ON public\.user_xp_days TO authenticated;/);
  assert.match(migration, /ON public\.user_xp_days FOR SELECT TO authenticated\s+USING \(user_id = \(SELECT auth\.uid\(\)::TEXT\)\);/);
  for (const routine of ['add_xp_day(TEXT, TEXT, INTEGER)', 'learn_step_xp(TEXT, INTEGER)', 'month_xp_ranks(TEXT, DATE)',
    'month_xp_leaderboard(TEXT, INTEGER, TEXT, TEXT)', 'month_xp_leaderboard_rank(TEXT, TEXT, TEXT)']) {
    const escaped = routine.replace(/[()]/g, '\\$&');
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon, authenticated;`), `${routine} is revoked from browsers`);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role;`), `${routine} is service-role only`);
  }
  // Erasure takes the ledger with the account.
  const erasure = newest.get('delete_user_data')!;
  assert.match(erasure.body, /DELETE FROM public\.user_xp_days WHERE user_id = p_user_id;/, 'deleting an account deletes its month XP');
  // The board names a learner as every board does (board_display_name, 055),
  // and shows the photo only behind the consent switch (049).
  const board = newest.get('month_xp_leaderboard')!.body;
  assert.match(board, /public\.board_display_name\(r\.user_id\)/, 'one naming rule for every board');
  assert.doesNotMatch(board, /u\.name/, 'the name is never projected here');
  assert.match(board, /CASE WHEN u\.show_on_leaderboards THEN u\.picture END/, 'the photo only behind the switch');
  assert.match(board, /FROM public\.month_xp_ranks\(/, 'the board ranks as the settlement pays');
  // The API serves it like the other boards.
  const handler = read('api/leaderboard.ts');
  const month = handler.slice(handler.indexOf('async function monthBoard('), handler.indexOf('async function verifiedViewer('));
  assert.match(month, /RATE_LIMITS\.leaderboardPersonal/);
  assert.match(month, /'private, no-store'/);
  assert.match(month, /'public, s-maxage=60'/);
  assert.match(month, /validateCategoryScope\(/, 'the month board is one subject\'s');
  // The Shop says what the month pays.
  assert.match(read('client/src/i18n/translations.ts'),
    /'rewards\.earn\.monthTopDetail': 'Finish a calendar month with the most XP — top three earn \{first\}, \{second\} and \{third\} coins; ties share the place\.'/);
}

/** op=identity (migration 055): what friends see of a learner, the sharkname
 * or the Google name, and an initials avatar or the Google photo. Plus the
 * 32-character handle rule and the display name the friends ops pass on. Run
 * against stand-ins for the tables and routines. */
async function identityContracts() {
  const route = readFileSync(join(process.cwd(), 'api/user/[op].ts'), 'utf8');
  const limited = route.indexOf('if (!(await limitUserWrite(req, res, op))) return;');
  const branch = route.indexOf("if (op === 'identity') return handleIdentity(req, res, supabase, verifiedProfile);");
  assert.ok(limited > 0 && branch > limited, 'op=identity is a branch of api/user/[op].ts after the write limit, given the verified Google profile');
  assert.ok(branch < route.indexOf("if (op.startsWith('friends-'))"), 'and it is reached before the friends- prefix');

  // Google gave Ada a name and a photo; Bo signed up with an email and has neither.
  const profiles: Record<string, { name: string | null; picture: string | null }> = {
    'contract-identity-ada': { name: 'Ada Lovelace', picture: 'https://lh3.googleusercontent.com/a/ada' },
    'contract-identity-bo': { name: null, picture: null },
  };
  const handles = new Map<string, { show_real_name: boolean; show_photo_to_friends: boolean }>([
    ['contract-identity-ada', { show_real_name: false, show_photo_to_friends: false }],
    ['contract-identity-bo', { show_real_name: false, show_photo_to_friends: false }],
  ]);
  const statsWrites: { row: Record<string, unknown>; onConflict?: string }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let missingColumn = false;
  const db = {
    from(table: string) {
      if (table === 'user_stats') {
        return {
          async upsert(row: Record<string, unknown>, options?: { onConflict?: string }) {
            statsWrites.push({ row, onConflict: options?.onConflict });
            return { data: null, error: null };
          },
        };
      }
      assert.equal(table, 'user_handles');
      let userId = '';
      const query = {
        select(columns: string) { assert.equal(columns, 'show_real_name, show_photo_to_friends'); return query; },
        eq(column: string, value: string) { assert.equal(column, 'user_id'); userId = value; return query; },
        async maybeSingle() {
          return missingColumn
            ? { data: null, error: { code: '42703', message: 'column user_handles.show_real_name does not exist' } }
            : { data: handles.get(userId) ?? null, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      assert.equal(name, 'set_friend_display');
      const row = handles.get(String(args.p_user_id));
      if (!row) return { data: null, error: { message: 'no_handle' } };
      if (typeof args.p_show_real_name === 'boolean') row.show_real_name = args.p_show_real_name;
      if (typeof args.p_show_photo === 'boolean') row.show_photo_to_friends = args.p_show_photo;
      return { data: [{ ...row }], error: null };
    },
  };
  const call = async (method: string, options: { user?: string | null; body?: unknown } = {}) => {
    const user = options.user === undefined ? 'contract-identity-ada' : options.user;
    const res = mockResponse();
    await handleIdentity({
      method,
      headers: {},
      query: { op: 'identity', ...(user ? { user_id: user } : {}) },
      body: options.body,
    } as never, res as never, db as never, async (auth) => profiles[auth.sub] ?? { name: null, picture: null });
    return res;
  };
  const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;

  // Signed in only, GET and PUT only.
  assert.equal((await call('GET', { user: null })).statusCode, 401, 'a guest cannot read it');
  assert.equal((await call('PUT', { user: null, body: { showRealName: true } })).statusCode, 401, 'a guest cannot set it');
  const post = await call('POST', { body: { showRealName: true } });
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.get('allow'), 'GET, PUT');

  // Both off by default; the learner's own Google name and photo come along
  // so the Profile can offer them, and nothing is cached.
  const first = await call('GET');
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { showRealName: false, showPhoto: false, realName: 'Ada Lovelace', photo: 'https://lh3.googleusercontent.com/a/ada' });
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await call('GET', { user: 'contract-identity-none' })).body,
    { showRealName: false, showPhoto: false, realName: null, photo: null }, 'an account without a handle reads as off');

  // The body is `{ showRealName?, showPhoto? }` with booleans, at least one.
  for (const body of [undefined, null, {}, [true], { showRealName: 'true' }, { showPhoto: 1 }, { showRealName: null }, { showRealName: true, showPhoto: 'no' }]) {
    const refused = await call('PUT', { body });
    assert.equal(refused.statusCode, 400, `${JSON.stringify(body)} is refused`);
    assert.equal(code(refused), 'bad_request');
  }
  assert.equal(statsWrites.length + rpcCalls.length, 0, 'a refused body writes nothing');

  // An email account has no Google name or photo to show: refused, nothing written.
  const noName = await call('PUT', { user: 'contract-identity-bo', body: { showRealName: true } });
  assert.equal(noName.statusCode, 409);
  assert.equal(code(noName), 'no_real_name');
  const noPhoto = await call('PUT', { user: 'contract-identity-bo', body: { showPhoto: true } });
  assert.equal(noPhoto.statusCode, 409);
  assert.equal(code(noPhoto), 'no_photo');
  assert.equal(statsWrites.length + rpcCalls.length, 0, 'nothing is written for a name or photo the account does not have');
  // Choosing the sharkname needs nothing from Google.
  const bo = await call('PUT', { user: 'contract-identity-bo', body: { showRealName: false } });
  assert.deepEqual(bo.body, { showRealName: false, showPhoto: false, realName: null, photo: null });

  // Ada shows her name: the verified name and photo are copied to the stats
  // row first, never anything from the body.
  const on = await call('PUT', { body: { showRealName: true, name: 'Someone Else', picture: 'https://example.com/me.png' } });
  assert.equal(on.statusCode, 200);
  assert.deepEqual(on.body, { showRealName: true, showPhoto: false, realName: 'Ada Lovelace', photo: 'https://lh3.googleusercontent.com/a/ada' });
  assert.deepEqual(statsWrites.at(-1), {
    row: { user_id: 'contract-identity-ada', name: 'Ada Lovelace', picture: 'https://lh3.googleusercontent.com/a/ada' },
    onConflict: 'user_id',
  });
  assert.deepEqual(rpcCalls.at(-1), { name: 'set_friend_display', args: { p_user_id: 'contract-identity-ada', p_show_real_name: true, p_show_photo: null } },
    'only the switch sent changes; the other is NULL, which the routine leaves alone');

  // Turning the photo on and then off: off writes no stats row.
  assert.deepEqual((await call('PUT', { body: { showPhoto: true } })).body,
    { showRealName: true, showPhoto: true, realName: 'Ada Lovelace', photo: 'https://lh3.googleusercontent.com/a/ada' });
  const writesBefore = statsWrites.length;
  assert.deepEqual((await call('PUT', { body: { showPhoto: false } })).body,
    { showRealName: true, showPhoto: false, realName: 'Ada Lovelace', photo: 'https://lh3.googleusercontent.com/a/ada' });
  assert.equal(statsWrites.length, writesBefore, 'switching off copies nothing');
  assert.deepEqual((await call('GET')).body,
    { showRealName: true, showPhoto: false, realName: 'Ada Lovelace', photo: 'https://lh3.googleusercontent.com/a/ada' }, 'the choice is stored');

  // No sharkname yet: the routine says no_handle and the learner is told to choose one.
  profiles['contract-identity-new'] = { name: 'New Person', picture: null };
  const noHandle = await call('PUT', { user: 'contract-identity-new', body: { showRealName: true } });
  assert.equal(noHandle.statusCode, 409);
  assert.equal(code(noHandle), 'no_handle');

  // Before migration 055 the columns are missing: say so rather than 500.
  missingColumn = true;
  const missing = await call('GET');
  assert.equal(missing.statusCode, 503);
  assert.equal(code(missing), 'migration_required');
  missingColumn = false;

  // Each PUT is charged to the account by the route's write limit; a GET is not.
  const stamp = Date.now();
  const limit = async (method: string, userId: string) => {
    const res = mockResponse();
    const req = { method, headers: { 'x-forwarded-for': `identity-${stamp}` }, query: { op: 'identity' }, body: { user_id: userId, showPhoto: false }, socket: {} };
    return (await limitUserWrite(req as never, res as never, 'identity')) ? 200 : res.statusCode;
  };
  for (let n = 0; n < RATE_LIMITS.userMutation.capacity; n += 1) {
    assert.equal(await limit('PUT', `identity-${stamp}-a`), 200, `switch ${n + 1} is allowed`);
  }
  assert.equal(await limit('PUT', `identity-${stamp}-a`), 429, 'one account is bounded at the per-account write rate');
  assert.equal(await limit('PUT', `identity-${stamp}-b`), 200, 'which spends nobody else\'s budget');
  assert.equal(await limit('GET', `identity-${stamp}-a`), 200, 'reading it is not a write');

  // The handle rule is 3–32 characters (it was 24), the same in the API and
  // the client, and the friends ops pass the display name on.
  const friendCalls: { name: string; args: Record<string, unknown> }[] = [];
  const friendsDb = {
    async rpc(name: string, args: Record<string, unknown>) {
      friendCalls.push({ name, args });
      if (name === 'allocate_shark_name') return { data: { handle: `${args.p_base}9007199254740993`, ordinal: '9007199254740993', base: args.p_base }, error: null };
      if (name === 'friend_lookup') return { data: [{ handle: 'thirsty-sharkie', state: 'accepted', display_name: 'Ada Lovelace' }], error: null };
      if (name === 'friend_list') return { data: [{ handle: 'thirsty-sharkie', display_name: 'Ada Lovelace', picture: null, current_streak: 3 }], error: null };
      if (name === 'friend_requests') return { data: [{ handle: 'fin-de-fiesta', direction: 'incoming', display_name: 'Dee Example' }], error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const friends = async (op: string, method: string, options: { body?: unknown; query?: Record<string, string> } = {}) => {
    const res = mockResponse();
    await handleFriends(op, { method, headers: {}, query: { op, user_id: 'contract-identity-ada', ...options.query }, body: options.body } as never, res as never, friendsDb as never);
    return res;
  };
  const longest = 'sharkSoFatItCantSwim';
  assert.deepEqual((await friends('friends-handle', 'PUT', { body: { base: longest } })).body,
    { handle: `${longest}9007199254740993`, ordinal: '9007199254740993', base: longest }, 'the suffix is a server-owned decimal string');
  for (const handle of [`${longest}42`, 'ab', '-sharkie', 'Shark', 'thirsty sharkie']) {
    const refused = await friends('friends-handle', 'PUT', { body: { handle } });
    assert.equal(refused.statusCode, 400, `${handle} is refused before the database`);
    assert.equal(code(refused), 'invalid_handle');
    assert.match((refused.body as { error: { message: string } }).error.message, /number is added automatically/);
  }
  assert.equal(friendCalls.filter((one) => one.name === 'allocate_shark_name').length, 1, 'only the approved base reaches the atomic allocator');
  assert.match(readFileSync(join(process.cwd(), 'client/src/lib/friends.ts'), 'utf8'), /from '\.\.\/\.\.\/\.\.\/shared\/handles'/, 'the client checks the same rule as the API, from shared/handles.ts');
  assert.ok(isValidHandle(longest));

  assert.deepEqual((await friends('friends-lookup', 'GET', { query: { handle: 'thirsty-sharkie' } })).body,
    { found: true, handle: 'thirsty-sharkie', state: 'accepted', displayName: 'Ada Lovelace' });
  const list = (await friends('friends-list', 'GET')).body as { friends: { handle: string; displayName: string; picture: string | null }[]; requests: unknown[] };
  assert.deepEqual([list.friends[0].handle, list.friends[0].displayName, list.friends[0].picture], ['thirsty-sharkie', 'Ada Lovelace', null]);
  assert.deepEqual(list.requests, [{ handle: 'fin-de-fiesta', displayName: 'Dee Example', direction: 'incoming' }]);

  // Answering a request and blocking are decisions: a value that is not a
  // real true or false is refused before the database, never read as "no".
  friendCalls.length = 0;
  for (const [op, body] of [
    ['friends-respond', { handle: 'fin-de-fiesta', accept: 'yes' }],
    ['friends-respond', { handle: 'fin-de-fiesta' }],
    ['friends-remove', { handle: 'fin-de-fiesta', block: 'true' }],
  ] as const) {
    const refused = await friends(op, 'POST', { body });
    assert.equal(refused.statusCode, 400, `${op} ${JSON.stringify(body)} is refused (${JSON.stringify(refused.body)})`);
  }
  assert.deepEqual(friendCalls, [], 'and nothing is answered or removed');
}

async function practiceRunTransitionContracts() {
  const learner = 'practice-learner-0001';
  const sessionId = 'practice-session-0001';
  const call = async (storedStatus: 'active' | 'abandoned', position?: number) => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: { session_id: sessionId, status: storedStatus, position }, error: null }),
    };
    const db = {
      from: () => query,
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: name === 'begin_scheduled_practice_session' ? true : null, error: null };
      },
    };
    const req = {
      method: 'PUT', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '198.51.100.82' },
      query: {}, body: { sessionId, user_id: learner, status: 'active', position },
    };
    const res = mockResponse();
    await handlePracticeSession(req as never, res as never, db as never);
    return { res, calls };
  };

  const began = await call('active');
  assert.equal(began.res.statusCode, 200);
  assert.deepEqual(began.calls.map(({ name }) => name), ['begin_scheduled_practice_session'], 'activation does not send a second status write');
  const combined = await call('active', 1);
  assert.equal(combined.res.statusCode, 200);
  assert.deepEqual(combined.calls[1], {
    name: 'advance_practice_session',
    args: { p_session_id: sessionId, p_user_id: learner, p_position: 1, p_status: null },
  }, 'a caller can begin with a position without setting active twice');
  const replaced = await call('abandoned');
  assert.equal(replaced.res.statusCode, 409, 'a start response cannot direct the learner back to a replaced run');
}

async function main() {
  await practiceRunTransitionContracts();
  codingBoardContracts();
  await codingFetchContracts();
  complexityContracts();
  // Code graded below runs on the grader's worker thread, built fresh from the
  // sources under test.
  await buildSandboxWorker();
  assert.equal(apiFiles(join(process.cwd(), 'api')).length, 12, 'Vercel function budget must remain exactly 12');

  // devShark is the only product this repository builds. An unset identity
  // resolves to it; any other product or subject lock fails the build instead
  // of shipping devShark under someone else's name.
  assert.deepEqual(Object.keys(PRODUCT_CATALOG), ['devshark']);
  assert.equal(resolveCatalogProductId({ product: 'devshark' }), 'devshark');
  assert.equal(resolveCatalogProductId({ lockSubject: 'webdev' }), 'devshark');
  assert.equal(resolveCatalogProductId({}), 'devshark');
  for (const input of [{ product: 'studyshark' }, { product: 'geoshark' }, { lockSubject: 'geography' }]) {
    assert.throws(() => resolveCatalogProductId(input), /builds devShark only/, `${JSON.stringify(input)} must fail`);
  }
  assert.deepEqual(Object.keys(SUBJECT_SCOPE_CATALOG), ['webdev']);
  assert.deepEqual(allowedDeploymentSubjects(), ['webdev']);

  const session = encodeSession([{ questionId: 'private-answer-check', correctAnswer: 3 }]);
  assert.match(session, /^v2\./);
  assert.ok(!session.includes('private-answer-check'), 'encrypted token must not expose question ids');
  assert.deepEqual(decodeSession(session), [{ questionId: 'private-answer-check', correctAnswer: 3 }]);
  const parts = session.split('.');
  const middle = Math.floor(parts[2].length / 2);
  parts[2] = `${parts[2].slice(0, middle)}${parts[2][middle] === 'A' ? 'B' : 'A'}${parts[2].slice(middle + 1)}`;
  assert.equal(decodeSession(parts.join('.')), null, 'tampered token must fail closed');

  const dailyAttempt = stableAttemptId('daily', 'user-0001', 'webdev', '2026-07-21');
  assert.match(dailyAttempt, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(
    stableAttemptId('daily', 'user-0001', 'webdev', '2026-07-21'),
    dailyAttempt,
    'the same server-defined daily attempt must receive the same claim id',
  );
  assert.notEqual(stableAttemptId('daily', 'user-0002', 'webdev', '2026-07-21'), dailyAttempt);
  assert.notEqual(stableAttemptId('daily', 'user-0001', 'webdev', '2026-07-22'), dailyAttempt);

  const run = createChallengeRun();
  assert.equal(decodeChallengeRun(run.runToken)?.runId, run.runId);
  const receipt = encodeQuizResultReceipt({
    userId: 'user-0001', correct: 1, total: 2,
    breakdown: { javascript: { correct: 1, total: 2 } },
    outcomes: [{ questionId: 'closure-1', category: 'javascript', isCorrect: true }],
    subject: 'webdev',
    questXp: 6,
    purpose: 'quiz',
  });
  assert.deepEqual(decodeQuizResultReceipt(receipt)?.breakdown, { javascript: { correct: 1, total: 2 } });
  assert.equal(decodeQuizResultReceipt(receipt)?.subject, 'webdev');
  // A receipt from before 052 has no per-question XP and still decodes; one
  // with it keeps it, and an XP out of range is refused.
  assert.deepEqual(decodeQuizResultReceipt(receipt)?.outcomes, [{ questionId: 'closure-1', category: 'javascript', isCorrect: true }]);
  const withXp = (xp: number) => encodeQuizResultReceipt({
    userId: 'user-0001', correct: 1, total: 1,
    breakdown: { javascript: { correct: 1, total: 1 } },
    outcomes: [{ questionId: 'closure-1', category: 'javascript', isCorrect: true, xp }],
    subject: 'webdev', questXp: 6, purpose: 'quiz',
  });
  assert.equal(decodeQuizResultReceipt(withXp(6))?.outcomes[0].xp, 6);
  assert.equal(decodeQuizResultReceipt(withXp(101)), null);
  assert.equal(decodeQuizResultReceipt(withXp(2.5)), null);

  const now = Date.UTC(2026, 6, 21);
  const reviewQuestions = [
    { id: 'weak-high', category: 'javascript', difficulty: 2, importance: 10 },
    { id: 'strong-low', category: 'css', difficulty: 2, importance: 3 },
    { id: 'weak-recent', category: 'javascript', difficulty: 3, importance: 8 },
  ].map((item) => ({
    ...item, tags: [item.category], introduction: '', question: item.id,
    options: ['a', 'b'], correctAnswer: 0, explanation: '',
  })) as Question[];
  const review = selectPersonalizedReview(
    reviewQuestions,
    [
      { category: 'javascript', total_correct: 2, total_questions: 10 },
      { category: 'css', total_correct: 9, total_questions: 10 },
    ],
    [{
      question_id: 'weak-recent', category: 'javascript', times_seen: 2, times_missed: 2,
      last_seen_at: new Date(now - 5 * 86400000).toISOString(),
      last_missed_at: new Date(now - 5 * 86400000).toISOString(),
    }],
    2,
    now,
  );
  assert.equal(review.questions.length, 2);
  assert.equal(review.weakAreas[0]?.category, 'javascript');
  assert.ok(review.questions.every((question) => question.category === 'javascript'));
  assert.ok(assessmentUnlocks('webdev', 18).every((topic) => ROADMAP_TOPICS.includes(topic as never)));

  // Retired paths must be gone from every catalog, so no skill-check tier,
  // level map, or picker can offer a path with no questions behind it.
  for (const retired of ['internet', 'rhf-zod']) {
    assert.ok(!ROADMAP_TOPICS.includes(retired as never), `${retired} must not be a roadmap topic`);
    assert.ok(!SUBJECT_SCOPE_CATALOG.webdev.topics.includes(retired as never));
    assert.ok(!SUBJECT_SCOPE_CATALOG.webdev.categories.includes(retired as never));
    assert.ok(!assessmentUnlocks('webdev', 20).includes(retired));
  }

  // Named-account path grants: the owner's address gets them, nobody else does.
  const owner = 'owner@example.com';
  assert.deepEqual(grantedTopicsFor('learner@example.com', owner), []);
  assert.deepEqual(grantedTopicsFor(null, owner), []);
  assert.deepEqual(grantedTopicsFor('', owner), []);
  assert.ok(grantedTopicsFor('OWNER@Example.com', owner).includes('system-design'), 'grants are case-insensitive');
  assert.ok(grantedTopicsFor(owner, owner).every((topic) => ROADMAP_TOPICS.includes(topic)));
  assert.deepEqual(withGrantedTopics(['git'], 'learner@example.com', owner), ['git']);
  assert.deepEqual(withGrantedTopics(['git'], owner, owner), ['git', 'system-design']);
  assert.deepEqual(
    withGrantedTopics(['system-design'], owner, owner),
    ['system-design'],
    'an already-unlocked grant must not be duplicated',
  );

  // devShark ships no AI feature: no provider module and no explanation or
  // hint route on the quiz submit handler.
  assert.ok(!readdirSync(join(process.cwd(), 'lib')).includes('ai-provider.ts'), 'devShark carries no AI provider');
  const submitHandlerSource = readFileSync(join(process.cwd(), 'api', 'quiz', 'submit.ts'), 'utf8');
  assert.ok(!/resource === '(explanation|hint)'/.test(submitHandlerSource), 'the quiz submit handler routes no AI resource');

  // Coding challenges: sealed sessions, answer-free payloads, server grading.
  const codingSession = encodeCodingSession({ taskId: 'js-double-numbers', track: 'javascript', userId: 'user-0001', roadmapAttemptId: 'attempt-0123456789abcd' });
  assert.match(codingSession, /^v2\./);
  assert.ok(!codingSession.includes('js-double-numbers'), 'coding session must not expose the task id in clear');
  const decodedCoding = decodeCodingSession(codingSession);
  assert.equal(decodedCoding?.taskId, 'js-double-numbers');
  assert.equal(decodedCoding?.roadmapAttemptId, 'attempt-0123456789abcd');
  assert.match(decodedCoding?.attemptId ?? '', /^[A-Za-z0-9_-]{16,64}$/);
  // Tamper the last FOUR characters, not the last one. A 16-byte GCM tag is
  // 128 bits, which is not a multiple of 6, so the final base64url character
  // carries only 2 significant bits and 4 ignored ones — its value is always
  // A, Q, g or w. Flipping just that character changes nothing about a quarter
  // of the time, and the assertion then fails for no security reason.
  assert.equal(decodeCodingSession(tamperToken(codingSession)), null, 'tampered coding session must fail closed');
  assert.equal(decodeSession(codingSession), null, 'a coding session is never a quiz session');
  const connectState = encodeGithubConnectState('user-0001');
  assert.equal(decodeGithubConnectState(connectState)?.userId, 'user-0001');
  assert.equal(decodeCodingSession(connectState), null);
  // Every track a task can belong to must survive the round trip. The decoder
  // once carried its own list of four, so the Algorithms track sealed its
  // sessions and then refused to open them: every submit on it read as an
  // expired session, and nothing here noticed, because this block only ever
  // tried JavaScript.
  for (const track of CODING_TRACKS) {
    const sealed = encodeLegacyCodingSession({ taskId: 'alg-two-sum', track, userId: 'user-0001' });
    assert.equal(decodeCodingSession(sealed)?.track, track, `a coding session on the ${track} track must decode`);
  }

  const doubleTask = codingTaskById('js-double-numbers');
  assert.ok(doubleTask && doubleTask.tests && doubleTask.tests.length >= 4);
  const doubleSolution = solutionFor('js-double-numbers');
  assert.ok(doubleSolution?.solution.includes('double'));
  const playableDouble = JSON.stringify(playableCodingTask(doubleTask!));
  assert.ok(!playableDouble.includes(doubleSolution!.solution.trim().slice(0, 30)), 'playable task must not carry the solution');
  // The grader runs on a worker thread the host can stop (CODE-5). Its bundle
  // is built with the React runner and shipped with the roadmap function; a
  // deployment without it would fall back to running on the request thread.
  assert.match(readFileSync(join(process.cwd(), 'scripts', 'build-react-runner.mjs'), 'utf8'), /await buildSandboxWorker\(\)/, 'the build writes the grader worker bundle');
  const roadmapFunction = (JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { functions: Record<string, { includeFiles?: string }> }).functions['api/quiz/roadmap.ts'];
  assert.ok(roadmapFunction?.includeFiles?.includes('lib/coding/generated/*.cjs') && SANDBOX_WORKER_FILE.startsWith('lib/coding/generated/') && SANDBOX_WORKER_FILE.endsWith('.cjs'), 'the roadmap function ships the grader worker bundle');
  // So does the type checker's thread (CODE-2); the compiler it loads is the
  // roadmap function's own node_modules/typescript.
  assert.ok(TS_CHECK_WORKER_FILE.startsWith('lib/coding/generated/') && TS_CHECK_WORKER_FILE.endsWith('.cjs'), 'the roadmap function ships the type checker worker bundle');
  assert.match(readFileSync(join(process.cwd(), 'scripts', 'build-sandbox-worker.mjs'), 'utf8'), /scripts\/ts-check-worker-entry\.ts/, 'the build writes the type checker worker bundle');
  const graded = await runInSandbox({ code: doubleSolution!.solution, calls: doubleTask!.tests!.map((t) => t.call), expectations: doubleTask!.tests!.map((t) => t.expected) });
  assert.equal(codeOutcome({ visible: graded, hidden: null, check: null }), 'passed', 'the reference solution passes in the sandbox');
  const wrong = await runInSandbox({ code: 'const double = ns => ns;', calls: doubleTask!.tests!.map((t) => t.call), expectations: doubleTask!.tests!.map((t) => t.expected) });
  assert.equal(codeOutcome({ visible: wrong, hidden: null, check: null }), 'failed');
  const exactValues = await runInSandbox({ code: '', calls: ['undefined', 'null', '({a:undefined,b:[undefined,NaN,Infinity,-0]})', 'null'], expectations: [undefined, null, {a:undefined,b:[undefined,NaN,Infinity,-0]}, undefined] });
  assert.deepEqual(exactValues.results.map(result => result.pass), [true,true,true,false], 'server expectations preserve undefined and special numbers without confusing null');
  const hung = await runInSandbox({ code: 'const double = () => { while (true) {} };', calls: ['double([1])'], expectations: [[2]], deadlineMs: 300 });
  assert.equal(hung.timedOut, true, 'an infinite loop is cut off by the deadline');
  const escaped = await runInSandbox({ code: 'const peek = () => typeof process + typeof require + typeof fetch + typeof globalThis.Deno;', calls: ['peek()'], expectations: ['undefinedundefinedundefinedundefined'] });
  assert.equal(escaped.results[0]?.pass, true, 'the sandbox exposes no host globals');

  const designTask = CODING_TASKS.find((task) => task.verify === 'guided');
  assert.ok(designTask?.design, 'a guided design task exists');
  const prepared = prepareDesign(designTask!, (list) => [...list].reverse());
  assert.ok(prepared.key.steps?.length === 5);
  const shuffledPlayable = JSON.stringify({ ...playableCodingTask(designTask!), design: { steps: prepared.design!.steps.map((step) => ({ options: step.options })) } });
  assert.ok(!shuffledPlayable.includes('"correct"'), 'the shuffled design payload carries no answer');
  const allRight = gradeDesign(designTask!, prepared.key, prepared.key.steps!);
  assert.equal(allRight.outcome, 'passed');
  assert.equal(gradeDesign(designTask!, prepared.key, prepared.key.steps!.map((i) => (i + 1) % 3)).outcome, 'failed');
  const drillTask = CODING_TASKS.find((task) => task.drill?.format === 'sequence');
  const preparedDrill = prepareDesign(drillTask!, (list) => [...list].reverse());
  assert.equal(gradeDesign(drillTask!, preparedDrill.key, [preparedDrill.key.order!]).outcome, 'passed', 'a sequence drill grades the shuffled order');
  assert.equal(gradeDesign(drillTask!, preparedDrill.key, [[...preparedDrill.key.order!].reverse()]).outcome, 'failed');
  // A failed or partly right submission says which steps were right and echoes
  // the learner's answers, nothing more: the explanations name the right
  // option, so a failed attempt read for the key could be passed for full XP
  // under the next shuffle. The whole walkthrough travels with a pass.
  const onlyRightOrWrong = (verdicts: { correct: boolean }[]) => verdicts.every((step) => Object.keys(step).sort().join() === 'correct,given');
  const shortOfPass = gradeDesign(designTask!, prepared.key, prepared.key.steps!.map((i, step) => (step < designTask!.design!.passMark - 1 ? i : (i + 1) % 3)));
  assert.equal(shortOfPass.outcome, 'failed');
  assert.equal(shortOfPass.verdicts.filter((step) => step.correct).length, designTask!.design!.passMark - 1, 'a failed walkthrough still marks the right steps');
  assert.ok(onlyRightOrWrong(shortOfPass.verdicts) && shortOfPass.reference === null, 'a failed walkthrough carries no key, explanation or reference');
  assert.ok(allRight.verdicts.every((step, index) => step.correctIndex === prepared.key.steps![index] && step.explanation) && allRight.reference, 'a passed walkthrough carries the key, the explanations and the reference');
  const failedDrill = gradeDesign(drillTask!, preparedDrill.key, [[...preparedDrill.key.order!].reverse()]);
  assert.ok(onlyRightOrWrong(failedDrill.verdicts), 'a failed drill carries no key or explanation');
  assert.deepEqual(failedDrill.verdicts[0].given, [...preparedDrill.key.order!].reverse(), 'and echoes the order the learner gave');
  // The Learn lesson view and the learning paths run coding tasks in the code
  // workbench only: no Learn level and no path activity may embed a design task.
  assert.ok(CODING_TASKS.filter((task) => task.track === 'system-design').every((task) => task.level === 0), 'no system-design task sits in a Learn level');
  for (const path of LEARNING_PATHS) {
    for (const activity of path.modules.flatMap((module) => module.activities)) {
      if (activity.reuseTaskId) assert.notEqual(codingTaskById(activity.reuseTaskId)?.track, 'system-design', `${activity.id} reuses no system-design task`);
    }
  }
  // System design is hidden (owner decision, 9 Oct 2026). Its tasks and graders
  // stay authored, and the walkthrough and drill grading above still runs
  // against them, but nothing issues one: no summary, no browser index, no
  // Learn level, no run, no skip suggestion; the task resource answers 404 (as
  // for an id that never existed, not 410), and Submit and the reveal refuse a
  // sealed session for one before anything is graded.
  {
    const hidden = CODING_TASKS.filter((task) => task.track === 'system-design');
    assert.equal(hidden.length, 45, 'the 45 system design tasks stay in the repository for their review');
    assert.ok(hidden.every((task) => solutionFor(task.id) !== undefined || task.design || task.drill), 'with their answer keys');
    assert.deepEqual(CODING_SUMMARIES.filter((task) => !isCodingSectionTrack(task.track)).map((task) => task.id), [], 'no summary is on a hidden track');
    assert.deepEqual(CODING_INDEX.filter((task) => !isCodingSectionTrack(task.track)).map((task) => task.id), [], 'the browser index holds no hidden task');
    let caller = 0;
    const guestAsk = (resource: string, query: Record<string, unknown>, body?: Record<string, unknown>) => {
      caller += 1;
      return { method: body ? 'POST' : 'GET', headers: { 'x-forwarded-for': `198.20.${caller >> 8}.${caller & 255}` }, query: { resource, ...query }, ...(body ? { body } : {}) };
    };
    for (const task of hidden) {
      assert.equal(codingTaskById(task.id), undefined, `${task.id} is not issued`);
      const asked = mockResponse();
      await roadmapHandler(guestAsk('coding-task', { id: task.id }) as never, asked as never);
      assert.equal(asked.statusCode, 404, `${task.id}: the task resource answers 404`);
      assert.equal((asked.body as { error: { code: string } }).error.code, 'not_found');
      assert.equal(nextAfterSkip(task.id, new Set(), 'premium'), null, `${task.id}: a skip suggests nothing from it`);
    }
    const sealed = encodeCodingSession({ taskId: designTask!.id, track: 'system-design', userId: null, key: prepared.key });
    const submitted = mockResponse();
    await roadmapHandler(guestAsk('coding-submit', {}, { session: sealed, answers: prepared.key.steps }) as never, submitted as never);
    assert.equal(submitted.statusCode, 400, `a sealed system design session is refused at Submit (${JSON.stringify(submitted.body)})`);
    assert.equal((submitted.body as { error: { code: string } }).error.code, 'invalid_session');
    assert.ok(!JSON.stringify(submitted.body).includes(designTask!.design!.reference.slice(0, 40)), 'and nothing of the key comes back');
    const revealed = mockResponse();
    await roadmapHandler(guestAsk('coding-reveal', {}, { session: sealed, hintsUsed: 20 }) as never, revealed as never);
    assert.equal(revealed.statusCode, 400, 'and at the reveal');
    for (const plan of ['free', 'premium'] as const) {
      const run = buildQueue({ minutes: 120, topic: null, plan, passed: new Set<string>(), due: new Set<string>(), count: 20, order: 'sequential' });
      assert.ok(run.every((id) => isCodingSectionTrack(codingTaskById(id)?.track)), `a ${plan} run holds no hidden task`);
    }
  }
  // The solution opens once half the ladder is spent, never before two rungs
  // (or the whole ladder, when it is shorter). The browser shows the same number.
  assert.equal(ladderLength(doubleTask!), 5, 'js-double-numbers offers five rungs: a hint, two approach steps, the skeleton and the docs link');
  for (const [rungs, opensAfter] of [[1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [6, 3], [7, 4], [9, 5]]) {
    assert.equal(giveUpAfter(rungs), opensAfter, `a ${rungs}-rung ladder opens the solution after ${opensAfter}`);
    assert.equal(clientGiveUpAfter(rungs), opensAfter, `the workbench says the same for ${rungs} rungs`);
  }

  assert.ok(levelCodingTasks('javascript', 6).length >= 1, 'javascript level 6 carries a coding task');
  assert.ok(levelCodingTasks('javascript', 6).length <= 2);

  // A repair task is a format a learner chooses, never a gate they must pass.
  // It carries a `level` so it sorts into the Coding ladder, and the level quota
  // takes the first N in catalogue order — so without this, adding a repair task
  // silently REPLACES the implementation task its level was asking for. That is
  // exactly what happened when they were added: javascript level 3 (quota 1)
  // swapped js-fizz-values for js-debug-average, and level 10 dropped
  // js-activate-user.
  for (const codeTopic of ['javascript', 'typescript', 'react', 'dsa'] as const) {
    for (let level = 1; level <= (codeTopic === 'dsa' ? 15 : ROADMAP_LEVELS); level++) {
      for (const task of levelCodingTasks(codeTopic, level)) {
        assert.notEqual(
          formatOf(task),
          'debug',
          `${codeTopic} level ${level} must not gate on the repair task ${task.id}`,
        );
      }
    }
  }
  // DSA Foundations (#493): the retired DSA path's exercises fill the DSA Learn
  // levels through the same parent-attempt flow. Level 3 seals its one task;
  // every Foundations level now aligns with its task. The Coding section
  // lists all 29 under Algorithms, and only
  // they name a Learn level there.
  const foundationsById = await getEffectiveQuestionsById('webdev');
  for (const level of buildLiveTopic('dsa', id => foundationsById.has(id)).levels) {
    assert.equal(level.questionCount, 8, `Foundations level ${level.level} serves exactly eight reviewed questions`);
  }
  assert.deepEqual(levelCodingTasks('dsa', 3).map((task) => task.id), ['alg-dsa-reverse-in-place'], 'DSA level 3 seals the reverse-in-place task');
  assert.deepEqual(levelCodingTasks('dsa', 9).map((task) => task.id), ['alg-dsa-factorial', 'alg-dsa-recursive-list-sum'], 'DSA level 9 seals factorial and the recursive sum');
  for (const level of [1, 2, 10, 11, 14]) assert.ok(levelCodingTasks('dsa', level).length > 0, `DSA level ${level} seals its aligned coding tasks`);
  assert.deepEqual(levelCodingTasks('dsa', 15), [], 'the closing Foundations review has no coding task');
  assert.deepEqual(levelCodingTasks('algorithms', 1), [], 'the algorithms topic is never sealed into a Learn level');
  const dsaRows = CODING_INDEX.filter((row) => row.topic === 'dsa');
  assert.equal(dsaRows.length, 29, 'the index lists the 29 DSA Foundations tasks');
  assert.ok(dsaRows.every((row) => row.track === 'algorithms' && row.id.startsWith('alg-dsa-')), 'DSA Foundations tasks are listed under Algorithms');
  // Each DSA task names its matching Learn level after the E3 re-sequence.
  for (const row of CODING_INDEX.filter((one) => one.track === 'algorithms')) {
    assert.equal(hasLearnLevel(row), row.topic === 'dsa' || row.topic === 'dsa-advanced', `${row.id}: only a Foundations or Advanced Learn task names its curriculum level`);
  }
  for (const id of ['alg-dsa-linear-search', 'alg-dsa-selection-sort', 'alg-dsa-record-index', 'alg-dsa-sum-of-evens']) {
    const row = CODING_INDEX.find((one) => one.id === id);
    assert.ok(row && hasLearnLevel(row), `${id}: names its aligned Foundations level`);
  }
  assert.ok(hasLearnLevel(CODING_INDEX.find((one) => one.id === 'alg-dsa-reverse-in-place')!), 'alg-dsa-reverse-in-place names DSA level 3, which seals it');
  assert.equal(CODING_INDEX.filter((row) => row.topic !== undefined && row.topic !== 'dsa' && row.topic !== 'dsa-advanced').length, 0, 'the index carries a topic only where it differs from the track');
  // And the fix must not be to delete them: they still exist and stay reachable
  // through the Coding section, which is what made debugging discoverable.
  const repairTasks = CODING_TASKS.filter((task) => formatOf(task) === 'debug');
  assert.ok(repairTasks.length >= 4, 'the authored repair tasks are still in the catalogue');
  assert.ok(
    repairTasks.every((task) => isCodingSectionTrack(task.track)),
    'every repair task stays reachable in the Coding section',
  );
  assert.equal(gardenPathFor({ id: 'js-double-numbers', track: 'javascript', level: 6 }), 'javascript/06-double-numbers.js');
  assert.equal(gardenPathFor({ id: 'dd-requests-per-second', track: 'system-design', level: 0 }), 'system-design/00-requests-per-second.md');
  assert.ok(CODING_INDEX.length > 0, 'the browser index exists (freshness is enforced by npm run test:coding)');
  assert.ok(CODING_INDEX.every((row) => !('tests' in row) && !('prompt' in row)), 'the browser index carries no task bodies');
  assert.ok(CODING_INDEX.every((row) => typeof row.title === 'string' && row.title.length > 0), 'the browser index carries one English title per task (#485)');
  const ladderBase = { track: 'javascript' as const, progress: { passed: new Set<string>() }, tasks: CODING_INDEX, javascriptLevelsCleared: 0 };
  assert.equal(tierUnlocked({ ...ladderBase, tier: 1 }), true);
  assert.equal(tierUnlocked({ ...ladderBase, tier: 3 }), false);
  assert.equal(tierUnlocked({ ...ladderBase, tier: 3, javascriptLevelsCleared: 10 }), true, 'the Learn foundations open tier 3');
  assert.equal(tierUnlocked({ ...ladderBase, track: 'system-design', tier: 5 }), true, 'system design has no ladder');
  assert.deepEqual(eligibleCodingBadges(new Set(), CODING_INDEX), []);
  assert.deepEqual(CODING_BADGES.map((badge) => badge.id), [...CODING_BADGE_IDS], 'every coding badge has display metadata');
  assert.ok(Object.values(CODING_TASK_XP).every(xp => xp === 25), 'coding pass XP does not depend on difficulty');
  // Easy, Medium and Hard are labels projected from the tier ladder (#224).
  // Every listed challenge carries one, and nothing that opens, locks or pays
  // reads it: the ladder and the XP table stay keyed by tier.
  assert.ok(CODING_INDEX.every((row) => isDifficulty(row.difficulty)), 'every indexed challenge carries Easy, Medium or Hard');
  assert.deepEqual(CODING_TASK_XP, { 1: 25, 2: 25, 3: 25, 4: 25, 5: 25 }, 'coding tasks share the base reward');
  const codingCatalogSource = readFileSync(join(process.cwd(), 'shared', 'coding-catalog.ts'), 'utf8');
  const ladderSource = codingCatalogSource.slice(codingCatalogSource.indexOf('export function tierUnlocked'), codingCatalogSource.indexOf('/** Cosmetic badge ids'));
  assert.ok(ladderSource.includes('tierPassRatio') && !/difficulty/i.test(ladderSource.replace(/\/\*\*[\s\S]*?\*\//g, '')), 'the tier ladder never reads the difficulty label');

  // React tasks are graded on the server like every other track: the reference
  // solution passes, a component that renders nothing fails, and a case that
  // never settles is a timeout rather than a hang. This runs with the same
  // module the API loads, under whatever NODE_ENV the check runs in.
  const reactTask = CODING_TASKS.find((one) => one.track === 'react' && one.verify === 'tests' && one.suite);
  assert.ok(reactTask, 'the catalogue has a React task with a suite');
  const reactSolution = solutionFor(reactTask!.id)?.solution;
  assert.ok(reactSolution, 'that React task has a reference solution');
  const reactPass = await runReactSuite({ suite: reactTask!.suite!, appSource: reactSolution! });
  assert.equal(reactPass.failed, 0, 'the reference React solution passes on the server');
  assert.ok(reactPass.total > 0, 'the React suite registered cases');
  assert.equal(reactPass.compileError, null);
  const reactFail = await runReactSuite({ suite: reactTask!.suite!, appSource: 'function App() { return null; }' });
  assert.ok(reactFail.failed > 0, 'a component that renders nothing fails the suite');
  const reactStuck = await runReactSuite({
    suite: "test('never settles', async () => { await new Promise(() => {}); });",
    appSource: 'function App() { return null; }',
  });
  assert.equal(reactStuck.timedOut, true, 'a case that never settles is reported as a timeout');
  // Hidden React cases (#226) decide the verdict but reach the learner only as
  // a count: Submit appends them to the visible suite and splits them out.
  const reactHidden = await runReactSuite({
    suite: withHiddenCases(reactTask!.suite!, "test('a hidden case', () => { expect(1).toBe(2); });"),
    appSource: reactSolution!,
  });
  const reactSplit = splitHiddenCases(reactHidden.cases);
  assert.equal(reactSplit.hidden.length, 1, 'the hidden case runs after the visible suite');
  assert.ok(reactSplit.visible.length === reactPass.total && reactSplit.visible.every((one) => one.status === 'pass'), 'the visible cases keep their names and verdicts');
  assert.ok(reactHidden.failed > 0, 'a failing hidden case fails the run');
  const codingHandlersSource = readFileSync(join(process.cwd(), 'lib', 'coding', 'handlers.ts'), 'utf8');
  const gradeReactSource = codingHandlersSource.slice(codingHandlersSource.indexOf('async function gradeReact'), codingHandlersSource.indexOf('function gradeDesignTask'));
  assert.match(gradeReactSource, /withHiddenCases\(task\.suite, solutionFor\(task\.id\)\?\.hiddenSuite\)/, 'Submit runs the hidden React cases');
  assert.match(gradeReactSource, /const results = visible\.map/, 'only the visible React cases go back with names and errors');
  // A rejection the component leaves unhandled only logs in the browser; the
  // server runner must reach a verdict too instead of ending the process.
  const reactRejected = await runReactSuite({
    suite: "import React from 'react';\nimport { render } from '@testing-library/react';\nimport App from './App';\ntest('renders', async () => { render(<App />); await new Promise((resolve) => setTimeout(resolve, 20)); });",
    appSource: "const App = () => { useEffect(() => { Promise.reject(new Error('left unhandled')); }, []); return null; };",
  });
  assert.equal(reactRejected.failed, 0, 'an unhandled rejection in the component does not end the React runner');
  // The preview runs a solution against the fetch stub, not a suite's fake
  // fetch. The stub answered /api/photos with its weather object, so the
  // load-more solution threw "next is not iterable" in every preview and the
  // browser harness failed. Photos now come three to a page.
  const loadMore = solutionFor('react-mh-load-more')?.solution;
  assert.ok(loadMore, 'the load-more challenge has a reference solution');
  const previewRun = await runReactSuite({
    suite: [
      "import './fetchStub';",
      "import React from 'react';",
      "import { render, screen, fireEvent, waitFor } from '@testing-library/react';",
      "import App from './App';",
      "test('the stub pages the photos', async () => {",
      '  render(<App />);',
      "  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));",
      "  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));",
      "  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(6));",
      "  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));",
      "  await waitFor(() => expect(screen.getByText('That’s everything')).toBeTruthy());",
      "  expect(screen.getAllByRole('listitem')).toHaveLength(7);",
      '});',
    ].join('\n'),
    appSource: loadMore!,
  });
  assert.equal(previewRun.failed, 0, `the load-more preview pages through the stub's photos (${previewRun.cases.map((one) => one.error).filter(Boolean).join('; ')})`);

  // Learner code runs in a page realm with nothing in it that leads to Node.
  // With `process` in reach, a component wrote its own verdict file, ended the
  // grader before the hidden cases ran, and was graded a pass.
  const pageRealm = await runReactSuite({
    suite: [
      "import { reach } from './App';",
      "test('the component reaches nothing of Node, nor Testing Library', async () => { expect(await reach()).toEqual({ process: 'undefined', global: 'undefined', require: 'blocked', thisGlobal: 'blocked', constructor: 'blocked', eval: 'blocked', dynamicImport: 'blocked', testingLibrary: 'blocked' }); });",
    ].join('\n'),
    appSource: [
      "const attempt = (run) => { try { run(); return 'reached'; } catch { return 'blocked'; } };",
      'export const reach = async () => ({',
      '  process: typeof process,',
      '  global: typeof globalThis.global,',
      "  require: attempt(() => require('fs')),",
      "  thisGlobal: attempt(() => Function('return this')()),",
      "  constructor: attempt(() => globalThis.constructor.constructor('return process')()),",
      "  eval: attempt(() => (0, eval)('1')),",
      "  dynamicImport: await import('fs').then(() => 'reached', () => 'blocked'),",
      // With Testing Library, a component set asyncWrapper to skip every waitFor.
      "  testingLibrary: attempt(() => require('@testing-library/react').configure({ asyncWrapper: async () => undefined })),",
      '});',
      'export default function App() { return null; }',
    ].join('\n'),
  });
  assert.equal(pageRealm.compileError, null, JSON.stringify(pageRealm));
  assert.equal(pageRealm.failed, 0, `learner code reached the host: ${pageRealm.cases.map((one) => one.error).filter(Boolean).join('; ')}`);
  // The suite hands Testing Library, in the host realm, regular expressions
  // and functions made in the page realm. And Node reports an unhandled
  // rejection on `process`, which the page does not have, so it arrives on
  // window the way a browser reports it.
  const crossRealm = await runReactSuite({
    suite: [
      "import React from 'react';",
      "import { render, screen } from '@testing-library/react';",
      "import App from './App';",
      "test('regex and function matchers', () => { render(<App />); expect(screen.getByText(/^Slide \\d of 4$/).tagName).toBe('P'); expect(screen.getByRole('button', { name: /^next/i })).toBeTruthy(); expect(screen.getByText((text) => text.startsWith('Slide 1')).tagName).toBe('P'); });",
      "test('an unhandled rejection reaches window', async () => { const seen = []; const onWindow = (event) => { seen.push(event.reason && event.reason.message); event.preventDefault(); }; window.addEventListener('unhandledrejection', onWindow); try { Promise.reject(new Error('left')); await new Promise((resolve) => setTimeout(resolve, 20)); } finally { window.removeEventListener('unhandledrejection', onWindow); } expect(seen).toEqual(['left']); });",
    ].join('\n'),
    appSource: 'export default function App() { return <main><p>Slide 1 of 4</p><button>Next slide</button></main>; }',
  });
  assert.equal(crossRealm.failed, 0, `a page-realm matcher or rejection went astray: ${crossRealm.cases.map((one) => one.error).filter(Boolean).join('; ')}`);
  // A case that threw has failed, whatever the message: a component that
  // threw an error with an empty message passed every case that rendered it.
  const emptyThrow = await runReactSuite({
    suite: "import React from 'react';\nimport { render } from '@testing-library/react';\nimport App from './App';\ntest('renders', () => { render(<App />); });",
    appSource: "export default function App() { throw new Error(''); }",
  });
  assert.ok(emptyThrow.passed === 0 && emptyThrow.failed === 1, JSON.stringify(emptyThrow));
  // C1-6: so has a case that threw a value with no message to read. Reading
  // `message` from Object.create(null), or through a getter that throws,
  // threw out of the runner's catch and ended the whole run, which the
  // learner read as a grader outage.
  for (const thrown of ['Object.create(null)', "new (class extends Error { get message() { throw new Error('no message'); } })()"]) {
    const unreadable = await runReactSuite({
      suite: "import React from 'react';\nimport { render } from '@testing-library/react';\nimport App from './App';\ntest('renders', () => { render(<App />); });\ntest('runs', () => { expect(1).toBe(1); });",
      appSource: `export default function App() { throw ${thrown}; }`,
    });
    assert.equal(unreadable.compileError, null, JSON.stringify(unreadable));
    assert.deepEqual(unreadable.cases.map((one) => one.status), ['fail', 'pass'], `${thrown}: the case that threw fails and the run goes on: ${JSON.stringify(unreadable)}`);
    assert.ok(unreadable.cases[0].error, `${thrown}: the failure says something`);
  }

  // The real guest bundle, started with the flags the API passes, outside any
  // VM. It deletes its input before learner code runs, only the stdout line
  // with this run's nonce counts, and the case count has to match the suite.
  execFileSync(process.execPath, ['scripts/build-react-runner.mjs'], { stdio: 'ignore' });
  const guest = (suite: string, appSource: string, env: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'react-guest-'));
    const input = join(dir, 'input.json');
    const nonce = randomBytes(24).toString('hex');
    writeFileSync(input, JSON.stringify({ suite, appSource, nonce, compiledApp:compileReactLearner(appSource),compiledFixtures:{'./fetchStub':compileReactLearner(FETCH_STUB_SOURCE,false),'./localFetch':compileReactLearner(LOCAL_FETCH_SOURCE,false)} }));
    const command = spawnSync(process.execPath, [...GUEST_NODE_FLAGS, join(process.cwd(), 'lib/coding/generated/react-sandbox.cjs'), input], {
      cwd: dir, encoding: 'utf8', timeout: 10_000, env: { ...process.env, ...GUEST_ENV, ...env },
    });
    const left = readdirSync(dir);
    rmSync(dir, { recursive: true, force: true });
    // The exit code a shell, and the Sandbox, reports for a signal: 128 + its number.
    const exitCode = command.status ?? (command.signal ? 128 + osConstants.signals[command.signal] : null);
    return { status: command.status, exitCode, stdout: command.stdout, nonce, left };
  };
  const guestTask = codingTaskById('react-easy2-disclosure')!;
  const guestSuite = withHiddenCases(guestTask.suite!, solutionFor(guestTask.id)!.hiddenSuite);
  const honest = guest(guestSuite, solutionFor(guestTask.id)!.solution);
  assert.equal(honest.status, 0);
  assert.deepEqual(honest.left, [], 'the guest deletes its input before learner code runs');
  const honestResult = readGuestResult(honest.stdout, honest.nonce, guestSuite);
  assert.equal(honestResult.failed, 0, JSON.stringify(honestResult));
  const sortSuite = "import React from 'react';\nimport { render, screen } from '@testing-library/react';\nimport App from './App';\ntest('sort keeps Node24 writeback behavior in the learner VM', () => { render(<App />); expect(screen.getByText('blocked:1:0')).toBeInTheDocument(); });";
  const sortGuest = guest(sortSuite, "export default function App() { let status='missed'; try { Object.freeze([0,1]).sort((a,b)=>a-b); } catch (error) { if (error.name==='TypeError') status='blocked'; } let writes=0; const value={length:2,1:2}; Object.defineProperty(value,0,{get(){return 1},set(){writes++}}); Array.prototype.sort.call(value,(a,b)=>a-b); let reads=0; Array.prototype.sort.call({length:1,get 0(){reads++;return 1}}); return <p>{status+':'+writes+':'+reads}</p>; }");
  assert.equal(sortGuest.status, 0);
  assert.deepEqual(sortGuest.left, []);
  const sortGuestResult = readGuestResult(sortGuest.stdout, sortGuest.nonce, sortSuite);
  assert.equal(sortGuestResult.failed, 0, JSON.stringify(sortGuestResult));
  assert.equal(sortGuestResult.passed, 1, JSON.stringify(sortGuestResult));
  assert.deepEqual(splitHiddenCases(honestResult.cases).hidden.map(one => one.name), [
    '[hidden] closing again hides the details',
    '[hidden] the button never submits a form',
    '[hidden] two disclosures on one page use different ids',
    '[hidden] stable relationship survives repeated actions and ordinary parent renders',
    '[hidden] eight disclosures have distinct stable ids and independent panels',
    '[hidden] a fresh disclosure starts closed with a working target',
  ], 'the original and B107 disclosure cases all ran in the actual guest');
  assert.throws(() => readGuestResult(honest.stdout, randomBytes(24).toString('hex'), guestSuite), /no result/, 'a line without this run\'s nonce is not a result');
  assert.throws(() => readGuestResult(`${honest.stdout}${honest.stdout}`, honest.nonce, guestSuite), /no result/, 'two result lines are refused');
  assert.throws(() => readGuestResult(honest.stdout, honest.nonce, guestTask.suite!), /wrong number of cases/, 'a run reporting other cases than the suite declares is refused');
  // The reported forgery: write result.json and exit before the suite runs.
  const forged = guest(guestSuite, [
    "process.getBuiltinModule('fs').writeFileSync('/vercel/sandbox/result.json', JSON.stringify({ cases: [{ name: 'ok', status: 'pass', error: null, durationMs: 0 }], passed: 1, failed: 0, total: 1, compileError: null, timedOut: false }));",
    'process.exit(0);',
    'export default function App() { return null; }',
  ].join('\n'));
  assert.deepEqual(forged.left, [], 'the forged component wrote nothing');
  const forgedResult = readGuestResult(forged.stdout, forged.nonce, guestSuite);
  assert.ok(forgedResult.passed === 0 && /'?process'? is not defined/.test(forgedResult.compileError ?? ''), JSON.stringify(forgedResult));
  // A host function the component can reach compiles nothing either, and a
  // verdict line printed through the page's window.console is ignored.
  const escape = guest(guestSuite, [
    "window.console.log('\\n' + 'f'.repeat(48) + ' ' + JSON.stringify({ cases: [{ name: 'ok', status: 'pass', error: null, durationMs: 0 }], compileError: null, timedOut: false }));",
    "const proc = document.createElement.constructor('return process')();",
    "proc.getBuiltinModule('fs').writeFileSync('result.json', '{}');",
    'export default function App() { return null; }',
  ].join('\n'));
  assert.deepEqual(escape.left, [], 'a host function gave the component nothing to write with');
  const escapeResult = readGuestResult(escape.stdout, escape.nonce, guestSuite);
  assert.ok(escapeResult.passed === 0 && /Dynamic code generation is disabled/.test(escapeResult.compileError ?? ''), JSON.stringify(escapeResult));

  // C1-6: a guest the learner's code ended is that code's error, not a grader
  // outage. A component that throws a value with no readable message now
  // fails its cases; one that uses up the heap still ends the guest, after
  // the line the guest prints before any learner code runs, so the API reads
  // an error verdict, recorded like any other. A guest that ends before that
  // line is still a runner failure: the Submit is not recorded.
  assert.deepEqual(readGuestRun(honest.exitCode, honest.stdout, honest.nonce, guestSuite), honestResult, 'a clean run reads as before');
  const nullThrow = guest(guestSuite, 'export default function App() { throw Object.create(null); }');
  assert.equal(nullThrow.status, 0, 'a thrown null-prototype object no longer ends the guest');
  const nullThrowResult = readGuestRun(nullThrow.exitCode, nullThrow.stdout, nullThrow.nonce, guestSuite);
  assert.ok(nullThrowResult.passed === 0 && nullThrowResult.compileError === null, JSON.stringify(nullThrowResult));
  const exhausted = guest(guestSuite, 'export default function App() { const held = []; for (;;) held.push(new Array(1e6).fill(0)); }');
  assert.notEqual(exhausted.exitCode, 0, 'a component exhausting resources is stopped by the external guest deadline');
  const exhaustedResult = readGuestRun(exhausted.exitCode, exhausted.stdout, exhausted.nonce, guestSuite);
  assert.ok(exhaustedResult.passed === 0 && exhaustedResult.failed > 0, JSON.stringify(exhaustedResult));
  assert.equal(exhaustedResult.compileError, GUEST_CRASHED_MESSAGE, 'resource exhaustion never becomes a passing result');
  // The guest reads UTC: the API starts it with TZ=UTC, and its page realm
  // installs UTC whatever the process zone is.
  for (const env of [{}, { TZ: 'America/Los_Angeles' }, { TZ: 'Asia/Tokyo' }, { TZ: 'Australia/Lord_Howe' }] as Record<string, string>[]) {
    const utcGuest = guest(UTC_REACT_SUITE, UTC_REACT_APP, env);
    const utcResult = readGuestRun(utcGuest.exitCode, utcGuest.stdout, utcGuest.nonce, UTC_REACT_SUITE);
    assert.ok(utcResult.compileError === null && utcResult.failed === 0 && utcResult.passed === 2, `the React guest reads UTC (${JSON.stringify(env)}): ${JSON.stringify(utcResult.cases)}`);
  }
  // TZ=UTC is what puts the dates jsdom makes in the guest's own realm, such
  // as a date input's valueAsDate, in UTC too: in Los Angeles the same input
  // reads the day before.
  const inputSuite = "import React from 'react';\nimport { render, screen } from '@testing-library/react';\nimport App from './App';\ntest('a date input reads its day in UTC', () => { render(<App />); const day = screen.getByLabelText('Day').valueAsDate; expect([day.getTimezoneOffset(), day.getDate(), day.getHours()]).toEqual([0, 29, 0]); });";
  const inputApp = 'export default function App() { return <label>Day <input type="date" defaultValue="2026-03-29" /></label>; }';
  const inputRun = (env: Record<string, string>) => {
    const run = guest(inputSuite, inputApp, env);
    return readGuestRun(run.exitCode, run.stdout, run.nonce, inputSuite);
  };
  assert.deepEqual(inputRun({}).cases.map((one) => one.error), [null], 'started as the API starts it, the guest reads a date input in UTC');
  assert.equal(inputRun({ TZ: 'America/Los_Angeles' }).failed, 1, 'without TZ=UTC, the date input reads the host zone');
  const missingInput = spawnSync(process.execPath, [...GUEST_NODE_FLAGS, join(process.cwd(), 'lib/coding/generated/react-sandbox.cjs'), join(tmpdir(), 'no-such-guest-input.json')], { encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(missingInput.status, 0);
  assert.throws(() => readGuestRun(missingInput.status, missingInput.stdout, randomBytes(24).toString('hex'), guestSuite), /exited unsuccessfully/, 'a guest that ended before learner code ran is a runner failure');

  // CODE-1: the component reaches the grader realm's built-ins through
  // React's exports. With a toJSON on Object.prototype it rewrote the printed
  // verdict and passed every case, hidden ones included; with String.prototype
  // .split or Object.is it could pass them before the verdict was printed.
  // The guest freezes those built-ins before the component loads, so each
  // attempt throws and nothing passes.
  const hostBuiltIns = [
    "import React from 'react';",
    'const HostObject = Object.getPrototypeOf(React).constructor;',
    'const hostObjectPrototype = Object.getPrototypeOf(React);',
    'const hostArrayPrototype = Object.getPrototypeOf(HostObject.keys(React));',
    "const hostStringPrototype = Object.getPrototypeOf(HostObject('x'));",
  ].join('\n');
  const passAll = "function () { if (this && Array.isArray(this.cases) && 'timedOut' in this) { const cases = this.cases.map((one) => ({ name: one.name, status: 'pass', error: null, durationMs: 0 })); return { cases, passed: cases.length, failed: 0, total: cases.length, compileError: null, timedOut: false }; } return this; }";
  const hostForgeries: [string, string][] = [
    ['Object.prototype.toJSON', `Object.defineProperty(hostObjectPrototype, 'toJSON', { configurable: true, writable: true, value: ${passAll} });`],
    ['Array.prototype.toJSON', "Object.defineProperty(hostArrayPrototype, 'toJSON', { configurable: true, writable: true, value: function () { return this.map((one) => (one && typeof one === 'object' && 'status' in one ? { name: one.name, status: 'pass', error: null, durationMs: 0 } : one)); } });"],
    ['Object.prototype getters', "Object.defineProperty(hostObjectPrototype, 'status', { configurable: true, get() { return 'pass'; } }); Object.defineProperty(hostObjectPrototype, 'compileError', { configurable: true, get() { return null; } });"],
    ['String.prototype.split', 'hostStringPrototype.split = function () { return [null]; };'],
    ['Object.is', 'HostObject.is = () => true;'],
  ];
  for (const [name, attack] of hostForgeries) {
    const attempt = guest(guestSuite, `${hostBuiltIns}\n${attack}\nexport default function App() { return null; }`);
    assert.equal(attempt.status, 0, `${name}: the guest printed a verdict`);
    const verdict = readGuestResult(attempt.stdout, attempt.nonce, guestSuite);
    assert.equal(verdict.passed, 0, `${name}: forged ${verdict.passed} passing case(s): ${JSON.stringify(verdict)}`);
    assert.match(verdict.compileError ?? '', /not extensible|read[- ]only|Cannot (?:define|redefine|assign|add)/, `${name}: the built-in refused the change: ${verdict.compileError}`);
  }
  // In its own realm the component may replace Promise.prototype.then. The
  // runner follows a case's promise with the then it captured before the
  // suite ran, so an async case that fails still fails.
  const asyncSuite = [
    "import React from 'react';",
    "import { render } from '@testing-library/react';",
    "import App from './App';",
    "test('an async case that fails', async () => { render(<App />); await Promise.resolve(); throw new Error('the async case failed'); });",
    "test('an async case that passes', async () => { render(<App />); await new Promise((resolve) => setTimeout(resolve, 5)); expect(1).toBe(1); });",
  ].join('\n');
  const pageThen = guest(asyncSuite, 'Promise.prototype.then = function (resolve) { if (typeof resolve === \'function\') resolve(); return this; };\nexport default function App() { return null; }');
  const pageThenResult = readGuestResult(pageThen.stdout, pageThen.nonce, asyncSuite);
  assert.deepEqual(pageThenResult.cases.map((one) => one.status), ['fail', 'pass'], `a replaced then passes no failing case: ${JSON.stringify(pageThenResult)}`);
  assert.match(pageThenResult.cases[0].error ?? '', /the async case failed/);
  // The verdict is written from the result's own data: no toJSON, getter or
  // inherited field is consulted, and a result of any other shape is refused.
  const poisonedCases = Object.setPrototypeOf(
    [{ name: 'visible', status: 'fail', error: 'expected 1 to be 2', durationMs: 3 }],
    Object.create(Array.prototype, { toJSON: { value: () => [] } }),
  );
  const poisonedResult = Object.create(
    { toJSON: () => ({ cases: [], passed: 1, failed: 0, total: 1, compileError: null, timedOut: false }) },
    { cases: { value: poisonedCases, enumerable: true }, compileError: { value: null, enumerable: true }, timedOut: { value: false, enumerable: true } },
  );
  assert.deepEqual(JSON.parse(serializeGuestResult(poisonedResult)), {
    cases: [{ name: 'visible', status: 'fail', error: 'expected 1 to be 2', durationMs: 3 }],
    passed: 0, failed: 1, total: 1, compileError: null, timedOut: false,
  }, 'no toJSON rewrites the verdict');
  const withGetter = { cases: [Object.defineProperty({ name: 'visible', error: null, durationMs: 0 }, 'status', { get: () => 'pass', enumerable: true })], compileError: null, timedOut: false };
  assert.throws(() => serializeGuestResult(withGetter), /Malformed/, 'a status read through a getter is refused');
  assert.throws(() => serializeGuestResult(Object.create({ timedOut: false }, { cases: { value: [], enumerable: true }, compileError: { value: null, enumerable: true } })), /Malformed/, 'an inherited field is refused');
  const holed = Object.setPrototypeOf([, { name: 'b', status: 'fail', error: null, durationMs: 0 }], Object.create(Array.prototype, { 0: { value: { name: 'a', status: 'pass', error: null, durationMs: 0 } } }));
  assert.throws(() => serializeGuestResult({ cases: holed, compileError: null, timedOut: false }), /Malformed/, 'a case read from the prototype chain is refused');

  const qualityIssues = inspectQuestionQuality([{
    ...reviewQuestions[0],
    source: 'base', deleted: false,
    options: ['Always correct', 'Always correct'],
    review: { active: true, reason: 'reviewed' },
  }]);
  assert.ok(qualityIssues.some((issue) => issue.kind === 'weak_distractor'));
  // English only (#485): the checks never raise a second-language issue.
  assert.ok(qualityIssues.every((issue) => !/translation|parity/.test(issue.kind)), 'no second-language quality issue kinds');

  const migration = readFileSync(join(process.cwd(), 'supabase', 'supabase-schema-022.sql'), 'utf8');
  assert.match(migration, /record_verified_quiz_result_v2/);
  assert.match(migration, /complete_verified_roadmap_attempt/);
  assert.match(migration, /apply_verified_skill_check/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_verified_activity_xp/);
  assert.match(migration, /claim_ai_generation_budget/);

  const hardening = readFileSync(join(process.cwd(), 'supabase', 'supabase-schema-023.sql'), 'utf8');
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS public\.quiz_submissions/);
  assert.match(hardening, /claim_quiz_submission/);
  assert.match(hardening, /record_roadmap_answer/);
  assert.match(hardening, /incomplete_roadmap_attempt/);
  assert.match(hardening, /ADD COLUMN IF NOT EXISTS subject TEXT/);
  assert.match(hardening, /REVOKE ALL ON FUNCTION public\.match_question_distribution/);
  assert.match(hardening, /purge_expired_learning_data/);
  assert.ok(
    hardening.indexOf('CREATE OR REPLACE FUNCTION public.subject_leaderboard') <
      hardening.indexOf('REVOKE ALL ON FUNCTION public.subject_leaderboard'),
    'Migration 023 must create subject_leaderboard before revoking its privileges',
  );
  assert.match(hardening, /REVOKE ALL ON FUNCTION public\.global_leaderboard\(INTEGER\)/);
  assert.match(hardening, /REVOKE ALL ON FUNCTION public\.daily_leaderboard\(DATE, INTEGER\)/);
  const multiplayerMigration = readFileSync(join(process.cwd(), 'supabase', 'supabase-schema-005.sql'), 'utf8');
  assert.match(multiplayerMigration, /DROP FUNCTION IF EXISTS public\.match_scoreboard\(UUID\)/);

  const coding = readFileSync(join(process.cwd(), 'supabase', 'supabase-schema-025.sql'), 'utf8');
  for (const table of ['coding_progress', 'coding_attempts', 'coding_drafts', 'roadmap_attempt_coding', 'github_connections', 'github_commits']) {
    assert.match(coding, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`), `migration 025 must create ${table}`);
    assert.match(coding, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} needs RLS`);
  }
  for (const fn of ['record_coding_verdict', 'record_coding_reveal', 'save_coding_draft', 'complete_verified_roadmap_attempt', 'delete_user_data', 'purge_expired_learning_data']) {
    assert.match(coding, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `migration 025 must define ${fn}`);
    assert.match(coding, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be service-role only`);
  }
  assert.match(coding, /p_coding_task_ids JSONB DEFAULT NULL/, 'level completion must accept the sealed coding task ids');
  assert.match(coding, /DROP FUNCTION IF EXISTS public\.complete_verified_roadmap_attempt\(TEXT, TEXT\)/);
  // Coding XP once per account and task is run against the built schema by
  // supabase/tests/030-coding-xp-once.test.sql (npm run test:sql); 041
  // replaced the award id this file used to pin here.
  assert.match(coding, /DELETE FROM public\.coding_progress WHERE user_id = p_user_id/);
  assert.match(coding, /DELETE FROM public\.github_connections WHERE user_id = p_user_id/);
  assert.doesNotMatch(coding, /access_token|refresh_token|provider_token/, 'the garden must never store a user token');

  /* ── learning paths ─────────────────────────────────────────────────── */
  // FDE is the only role specialization and, since E5 (#496) retired DSA
  // Foundations, the only learning path. The retired id names nothing: no
  // path, no role, no attempt session. Its Coding tasks and Learn readings
  // stay (scripts/test-coding-content.ts, lib/learn-lessons).
  const RETIRED_PATH_ID = 'dsa-foundations';
  assert.deepEqual([...ROLE_SPECIALIZATION_IDS], ['fde'], 'FDE must remain the only role specialization');
  assert.deepEqual([...LEARNING_PATH_IDS], ['fde']);
  assert.equal(isLearningPathId(RETIRED_PATH_ID), false, 'the retired DSA path id is no learning path');
  assert.equal(pathById(RETIRED_PATH_ID), undefined, 'the retired DSA path is not published');
  assert.ok(!isRoleSpecializationId(RETIRED_PATH_ID), 'the retired DSA path id is no role');
  const fdePath = LEARNING_PATHS.find((path) => path.id === 'fde');
  assert.ok(fdePath, 'the FDE learning path must be published');
  assert.deepEqual(LEARNING_PATHS.map((path) => path.id), ['fde'], 'FDE is the only published path');
  assert.equal(fdePath!.kind, 'role_specialization');

  // A path opens only when the deployment switch is on, the content validates
  // and the storage is installed. Each is checked separately so an operator
  // can tell a half-written curriculum from a closed one.
  assert.equal(pathEnabledInEnv('fde', {}), false, 'a path is off unless the deployment says otherwise');
  assert.equal(pathEnabledInEnv('fde', { LEARNING_PATH_FDE_ENABLED: 'true' }), true);
  assert.equal(pathEnabledInEnv('fde', { LEARNING_PATH_DSA_ENABLED: 'true' }), false,
    'the retired DSA switch opens nothing');
  assert.equal(availabilityFor({ path: fdePath!, enabled: false, storageInstalled: true }), 'disabled');
  assert.equal(availabilityFor({ path: fdePath!, enabled: true, storageInstalled: false }), 'storage_missing');
  assert.equal(availabilityFor({ path: fdePath!, enabled: true, storageInstalled: true }), 'available');
  // The content verdict is cached per merged path; a different, broken path
  // must still get its own verdict rather than the published one's.
  assert.equal(availabilityFor({ path: { ...fdePath!, modules: [] }, enabled: true, storageInstalled: true }), 'content_incomplete');

  // The published manifest is answer-free. Every option a learner might be
  // shown arrives shuffled with the key sealed in the attempt session, so the
  // manifest must not contain the correct option text or its explanation.
  for (const path of LEARNING_PATHS) {
    const manifestJson = JSON.stringify(publicManifest(path));
    assert.doesNotMatch(manifestJson, /"correct"\s*:/, `${path.id}: the manifest carries a correct index`);
    assert.doesNotMatch(manifestJson, /"harness"\s*:/, `${path.id}: the manifest carries a grading harness`);
    for (const module of path.modules) {
      for (const activity of module.activities) {
        for (const question of activity.questions ?? []) {
          assert.ok(!manifestJson.includes(question.explanation), `${question.id}: explanation leaked into the manifest`);
        }
      }
    }
    // No path awards XP in v1, so no manifest may name one.
    assert.doesNotMatch(manifestJson, /"xp"/i, `${path.id}: a learning path awards no XP in v1`);
  }

  // An objective check cannot be passed without the sealed key, which is what
  // stops a forged or replayed session from minting a verified pass.
  const checkActivity = LEARNING_PATHS
    .flatMap((path) => path.modules.flatMap((module) => module.activities))
    .find((activity) => activity.kind === 'check' && (activity.questions?.length ?? 0) > 0);
  assert.ok(checkActivity, 'at least one objective check must exist');
  const checkKey = checkActivity!.questions!.map((question) => question.correct);
  assert.equal(gradeCheck(checkActivity!, checkKey, checkKey).state, 'verified_pass');
  assert.notEqual(gradeCheck(checkActivity!, undefined, checkKey).state, 'verified_pass',
    'a check graded without a sealed key must never pass');

  // A path with unmet requirements is not complete, and an optional
  // placement module never counts toward completion.
  assert.equal(pathGuidedComplete(publicManifest(fdePath!), new Map()), false);
  const fdeInventory = pathInventory(publicManifest(fdePath!));
  assert.ok(fdeInventory.modules > 0, 'FDE must publish required modules');

  // The account preference is validated on read: a malformed record degrades
  // to null rather than blocking a learner or granting a role.
  assert.equal(parseLearningPreference({ schemaVersion: 1, baseTrack: 'frontend', specialization: null })?.baseTrack, 'frontend');
  assert.equal(parseLearningPreference({ schemaVersion: 1, baseTrack: 'wizard', specialization: null }), null,
    'an unrecognised base track makes the preference unusable');
  assert.equal(parseLearningPreference({ schemaVersion: 2, baseTrack: 'frontend' }), null,
    'a future schema version is not guessed at');
  // A bad specialization costs the specialization, not the track: the learner
  // keeps the career choice they made instead of being sent back to the picker.
  const salvaged = parseLearningPreference({ schemaVersion: 1, baseTrack: 'frontend', specialization: RETIRED_PATH_ID });
  assert.equal(salvaged?.baseTrack, 'frontend', 'a valid base track survives a bad specialization');
  assert.equal(salvaged?.specialization, null, 'the retired DSA path can never be stored as a role specialization');

  // The attempt session binds owner, enrollment, activity, purpose and both
  // versions, so a submit handler never has to trust any of them from the body.
  const pathSession = encodeLearningPathSession({
    attemptId: 'attempt-0123456789abcd',
    enrollmentId: 'enroll-0123456789abcd',
    userId: 'user-0001-abcdef',
    pathId: 'fde',
    activityId: 'fde-v1-m01-checks',
    activityKind: 'check',
    purpose: 'exercise',
    curriculumVersion: 1,
    rubricVersion: 1,
    answerKey: [2, 0, 1, 3],
  });
  const decodedPath = decodeLearningPathSession(pathSession.token);
  assert.equal(decodedPath?.userId, 'user-0001-abcdef');
  assert.deepEqual(decodedPath?.answerKey, [2, 0, 1, 3]);
  assert.equal(decodeLearningPathSession('v2.not.a.token'), null);
  assert.equal(decodeLearningPathSession(tamperToken(pathSession.token)), null,
    'a tampered attempt session must not decode');
  const retiredSession = encodeLearningPathSession({
    attemptId: 'attempt-0123456789abcd', enrollmentId: 'enroll-0123456789abcd', userId: 'user-0001-abcdef',
    pathId: RETIRED_PATH_ID as never, activityId: 'retired-activity', activityKind: 'check', purpose: 'exercise',
    curriculumVersion: 1, rubricVersion: 1, answerKey: [0],
  });
  assert.equal(decodeLearningPathSession(retiredSession.token), null, 'an attempt session for the retired DSA path no longer decodes');

  const paths026 = readFileSync(join(process.cwd(), 'supabase', 'supabase-schema-026.sql'), 'utf8');
  for (const table of ['learning_path_enrollments', 'learning_path_attempts', 'learning_path_evidence', 'learning_path_progress', 'learning_path_drafts']) {
    assert.match(paths026, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`), `migration 026 must create ${table}`);
    assert.match(paths026, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} needs RLS`);
  }
  for (const fn of ['upsert_learning_path_enrollment', 'open_learning_path_attempt', 'accept_learning_path_result', 'save_learning_path_draft', 'delete_learning_path_data', 'delete_user_data', 'purge_expired_learning_data']) {
    assert.match(paths026, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `migration 026 must define ${fn}`);
    assert.match(paths026, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be service-role only`);
  }
  // learning_path_attempts holds grading material. Owning the row is not a
  // reason to read it, so it must have RLS on and no SELECT policy or grant.
  assert.doesNotMatch(paths026, /CREATE POLICY "learning_path_attempts_select_own"/,
    'learning_path_attempts must not expose grading material to its owner');
  assert.doesNotMatch(paths026, /GRANT SELECT ON public\.learning_path_attempts/,
    'learning_path_attempts must not be granted to a browser role');
  for (const table of ['learning_path_enrollments', 'learning_path_evidence', 'learning_path_progress', 'learning_path_drafts']) {
    assert.match(paths026, new RegExp(`GRANT SELECT ON public\\.${table} TO authenticated`), `${table} owner reads need the grant as well as the policy`);
  }
  assert.match(paths026, /user_id = \(SELECT auth\.uid\(\)\)::text/, 'owner policies must compare against the verified caller');
  for (const table of ['learning_path_drafts', 'learning_path_progress', 'learning_path_evidence', 'learning_path_attempts', 'learning_path_enrollments']) {
    assert.match(paths026, new RegExp(`DELETE FROM public\\.${table} WHERE user_id = p_user_id`), `account deletion must reach ${table}`);
  }
  // A learning path awards no XP in v1: none of its write paths may touch the
  // XP ledger or coding progress, so a task reused from the coding catalogue is
  // never paid twice. Scoped to the learning-path functions — account erasure
  // further down the file deletes XP and coding rows, and must keep doing so.
  const pathWritePaths = paths026.slice(0, paths026.indexOf('CREATE OR REPLACE FUNCTION public.delete_user_data'));
  assert.ok(pathWritePaths.length > 1000, 'expected the learning-path functions before delete_user_data');
  assert.doesNotMatch(pathWritePaths, /record_verified_activity_xp/, 'no learning path awards XP in v1');
  assert.doesNotMatch(pathWritePaths, /public\.user_xp/, 'no learning path writes the XP table');
  assert.doesNotMatch(pathWritePaths, /public\.coding_progress/, 'a path pass must not write ordinary coding progress');
  // Account erasure still reaches the older tables it always did.
  assert.match(paths026, /DELETE FROM public\.user_xp WHERE user_id = p_user_id/);
  assert.match(paths026, /DELETE FROM public\.coding_progress WHERE user_id = p_user_id/);

  // Reference solutions and hidden tests never ship: nothing under client/
  // may import lib/coding, and the catalogue keeps solutions in their own module.
  const clientFiles = readdirSync(join(process.cwd(), 'client', 'src'), { recursive: true }) as string[];
  for (const file of clientFiles) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = readFileSync(join(process.cwd(), 'client', 'src', file), 'utf8');
    assert.doesNotMatch(text, /lib\/coding/, `client/src/${file} must not import lib/coding`);
    assert.doesNotMatch(text, /lib\/learning-paths/, `client/src/${file} must not import lib/learning-paths`);
  }
  // The sandbox frame's own headers (Access-Control-Allow-Origin for its CORS
  // module load, its network-less CSP) are asserted with the rest of
  // vercel.json in vercelRoutingContracts() (scripts/vercel-routing-contract.ts).

  const sandboxDir = join(process.cwd(), 'client', 'sandbox');
  if (statSync(sandboxDir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const file of readdirSync(sandboxDir, { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      assert.doesNotMatch(readFileSync(join(sandboxDir, file), 'utf8'), /lib\/coding/, `client/sandbox/${file} must not import lib/coding`);
    }
  }
  const catalogSource = readFileSync(join(process.cwd(), 'lib/coding/catalog.ts'), 'utf8');
  assert.doesNotMatch(catalogSource, /from '\.\/solutions/, 'the catalogue loader must not import the solutions');
  const pathCatalogSource = readFileSync(join(process.cwd(), 'lib/learning-paths/catalog.ts'), 'utf8');
  assert.doesNotMatch(pathCatalogSource, /from '\.\/solutions/, 'the learning-path catalogue must not import the solutions');
  for (const key of ['codingSubmit', 'codingSubmitCeiling', 'codingReveal', 'githubConnect', 'githubSync',
                     'learningPathStart', 'learningPathSubmit', 'learningPathSubmitCeiling', 'learningPathDraft', 'learningPathEnroll']) {
    assert.ok(key in RATE_LIMITS, `rate limit ${key} must exist`);
  }

  const shopSource = readFileSync(join(process.cwd(), 'client/src/lib/shop.ts'), 'utf8');
  const catalogueSource = shopSource.match(/const STATIC_CATALOGUE:[^=]+= \[([\s\S]*?)\n\];/)?.[1];
  assert.ok(catalogueSource, 'shop catalogue must remain statically inspectable');
  assert.match(shopSource, /type ProductKind = 'ring' \| 'flair'/);
  assert.doesNotMatch(catalogueSource, /kind:\s*['"](?:path|booster|boost|xp)['"]/, 'shop catalogue must remain cosmetic-only');
  assert.doesNotMatch(shopSource, /\bconsumeDoubleXpCharge\b/, 'shop must never influence XP awards');
  const xpSource = readFileSync(join(process.cwd(), 'client/src/lib/xp.ts'), 'utf8');
  assert.doesNotMatch(xpSource, /\bconsumeDoubleXpCharge\b/, 'XP awards must remain independent of shop inventory');

  // Streak protection is the one thing the shop sells that touches learning at
  // all, and the exception is only defensible while it stays bounded. Each of
  // these is one of the four bounds, asserted rather than promised.
  {
    const rewardsSource = readFileSync(join(process.cwd(), 'shared/rewards.ts'), 'utf8');
    // 1. Capped, and the cap is two.
    assert.equal(STREAK_PROTECTION_CAP, 2, 'the protection cap is what stops a purchase buying a deeper reserve');
    // 2. Priced in tokens, which are earned. There is no money price for it.
    assert.match(rewardsSource, /streakProtectionTokenPrice: number/);
    assert.doesNotMatch(
      rewardsSource,
      /streakProtection(Price|Cash|Minor)/,
      'streak protection must have no cash price — the currency is earned tokens',
    );
    // 3. The database restores toward the cap and never past it.
    const migration = readFileSync(join(process.cwd(), 'supabase/supabase-schema-035.sql'), 'utf8');
    assert.match(
      migration,
      /LEAST\(COALESCE\(v_row\.remaining, 0\) \+ 1, 2\)/,
      'buying a protection must never raise the budget above the cap',
    );
    // 4. It buys a protection and nothing else. If any of these words ever
    //    appear in the purchase routine, the exception has stopped being bounded.
    const routine = migration.slice(
      migration.indexOf('FUNCTION public.purchase_streak_protection'),
      migration.indexOf('GRANT EXECUTE ON FUNCTION public.purchase_streak_protection'),
    );
    for (const forbidden of ['user_xp', 'user_stats', 'quest_xp', 'badge', 'leaderboard', 'roadmap_progress']) {
      assert.ok(
        !routine.toLowerCase().includes(forbidden),
        `buying a protection must not touch ${forbidden}`,
      );
    }
  }

  // The dated boards (migration 040, #223). Every board ranks correct answers,
  // then accuracy: never XP and never a streak. Answers are dated only inside
  // the three verified answer routines, and a coding pass is not an answer.
  {
    const migration = readFileSync(join(process.cwd(), 'supabase/supabase-schema-040.sql'), 'utf8');
    const routineOf = (name: string) => {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      assert.ok(start >= 0, `migration 040 must define ${name}`);
      return migration.slice(start, migration.indexOf('$$;', migration.indexOf('AS $$', start)));
    };
    for (const name of ['window_leaderboard', 'window_leaderboard_rank']) {
      const body = routineOf(name).toLowerCase();
      assert.ok(!body.includes('streak'), `${name} must never read a streak column`);
      assert.ok(!/\bxp\b|quest_xp|user_xp/.test(body), `${name} must never read XP`);
    }
    assert.match(
      routineOf('window_leaderboard'),
      /RANK\(\) OVER \(ORDER BY t\.correct DESC, t\.answered ASC\)/,
      'the window ranks correct answers, then fewer answers for the same number correct',
    );
    const friendOrder = routineOf('friend_list').split('ORDER BY').pop() ?? '';
    assert.ok(!/streak/i.test(friendOrder), 'friend_list must never order by a streak');
    assert.match(friendOrder, /total_correct/, 'friend_list orders by correct answers first');

    assert.equal(migration.match(/INSERT INTO public\.user_activity_days/g)?.length, 1, 'one upsert writes dated activity');
    assert.equal(
      migration.match(/PERFORM public\.add_activity_day\(/g)?.length,
      3,
      'only the quiz, Learn and challenge routines date answers',
    );
    for (const name of ['record_verified_quiz_result_v2', 'record_roadmap_answer_v2', 'record_challenge_completion']) {
      assert.match(routineOf(name), /PERFORM public\.add_activity_day\(/, `${name} must date its answers`);
    }
    // A replayed Learn level is review, not new answers (review finding
    // integrity-5): a passed step adds nothing, and a question counts at most
    // once per learner and UTC day across attempts.
    const learnAnswer = routineOf('record_roadmap_answer_v2');
    const dating = learnAnswer.indexOf('PERFORM public.add_activity_day(');
    const passedCheck = learnAnswer.indexOf("CASE WHEN v_attempt.kind = 'level' THEN 'levels' ELSE 'checkpoints' END");
    const sameDay = learnAnswer.indexOf('AND a.question_id = p_question_id');
    assert.ok(passedCheck > 0 && passedCheck < dating, 'a Learn answer on a passed step is not dated');
    assert.ok(sameDay > 0 && sameDay < dating, 'a question answered in another attempt today is not dated again');
    assert.match(learnAnswer, /AND t\.attempt_id <> p_attempt_id/);
    assert.match(learnAnswer, /AND a\.answered_at >= v_day_start;/);
    assert.doesNotMatch(migration, /FUNCTION public\.record_coding/, 'a coding pass must not reach the dated boards');
    for (const file of apiFiles(join(process.cwd(), 'api'))) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /from\(['"]user_activity_days/, `${file} must not write dated activity directly`);
      assert.doesNotMatch(source, /rpc\(['"]add_activity_day/, `${file} must not date answers outside a verified routine`);
    }

    assert.match(migration, /ALTER TABLE public\.user_activity_days ENABLE ROW LEVEL SECURITY/);
    for (const fn of [
      'add_activity_day', 'record_verified_quiz_result_v2', 'record_roadmap_answer_v2', 'record_challenge_completion',
      'window_leaderboard', 'window_leaderboard_rank', 'friend_list', 'delete_user_activity_days',
    ]) {
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+FROM PUBLIC, anon, authenticated`),
        `${fn} must be service-role only`,
      );
    }

    // The shared board stays cacheable; a personal one never is.
    const boardHandler = readFileSync(join(process.cwd(), 'api/leaderboard.ts'), 'utf8');
    assert.match(boardHandler, /'private, no-store'/);
    assert.match(boardHandler, /'public, s-maxage=60'/);
    // Never served stale past the minute: a name switched off leaves every
    // shared board within about a minute (review finding RANK-5).
    assert.doesNotMatch(boardHandler, /stale-while-revalidate/, 'the shared boards are not served stale');
    assert.match(boardHandler, /RATE_LIMITS\.leaderboardPersonal/);

    // The screen: a rank is a number, never a medal colour, and the
    // multi-subject pill is gone.
    const screen = ['client/src/components/Leaderboard.tsx', 'client/src/components/Leaderboard.css']
      .map((file) => readFileSync(join(process.cwd(), file), 'utf8'))
      .join('\n')
      .toLowerCase();
    for (const hex of ['#f5b301', '#9aa4b2', '#cd7f32']) {
      assert.ok(!screen.includes(hex), `the leaderboard must not use the medal colour ${hex}`);
    }
    assert.ok(!screen.includes('subjectnamekey'), 'the leaderboard must not show a subject pill');
  }

  const profileSource = readFileSync(join(process.cwd(), 'client/src/components/Profile.tsx'), 'utf8');
  const profileStreakIndex = profileSource.indexOf('<StreakCard stats={stats}');
  const profileSectionsIndex = profileSource.indexOf('<Grid columns={{ minWidth: 360, max: 2 }}');
  assert.ok(
    profileStreakIndex >= 0 && profileSectionsIndex >= 0 && profileStreakIndex < profileSectionsIndex,
    'Profile must keep the streak ahead of the secondary progress sections',
  );
  assert.doesNotMatch(
    profileSource,
    /profile\.backToQuiz/,
    'Profile is an overview and must not end with a contextless Back to quiz action',
  );
  // Design audit P1.5: the rotating consistency tip is gone, and the four quiz
  // figures sit in the career card as one neutral row, not a card of their own.
  assert.doesNotMatch(profileSource, /CONSISTENCY_TIPS|profile\.tip\.|profile\.statistics|profile\.xpBreakdown|MetaPill/);
  assert.match(profileSource, /<StatTile label=\{t\('profile\.averageScore'\)\} value=\{`\$\{totals\.average\}%`\} \/>/);
  // And the last-quiz date is gone: it is a fact nobody acts on.
  assert.doesNotMatch(profileSource, /profile\.lastQuiz/, 'the last-quiz date should not come back');
  // UX audit social-account-08: appearance and sound live in the footer on
  // every route, the Profile included, so the identity banner does not repeat
  // them beside the learner's name.
  assert.doesNotMatch(
    profileSource,
    /IdentitySettings|useColorMode|useSettings\(/,
    'the Profile banner must not repeat the footer\'s appearance and sound controls',
  );
  const footerSource = readFileSync(join(process.cwd(), 'client/src/components/BrandFooter.tsx'), 'utf8');
  assert.match(footerSource, /className="ss-footer-settings" role="group"/);
  assert.match(footerSource, /onClick=\{toggle\}/, 'the footer switches appearance on every route');
  assert.match(footerSource, /updateSettings\(\{ soundEffects: !settings\.soundEffects \}\)/, 'the footer switches sound on every route');

  // A Learn level ends on the third wrong answer, which normally leaves later
  // questions unanswered. That attempt must still complete — as a fail — because
  // the learner cannot answer questions the lesson stopped showing them.
  assert.equal(roadmapEndedOnHearts('level', 5, ROADMAP_MAX_HEARTS, 8), true);
  assert.equal(
    roadmapEndedOnHearts('level', 8, ROADMAP_MAX_HEARTS, 8),
    false,
    'a full answer set still goes through the verified completion RPC',
  );
  assert.equal(
    roadmapEndedOnHearts('level', 5, ROADMAP_MAX_HEARTS - 1, 8),
    false,
    'stopping short with hearts left is a real incomplete attempt',
  );
  assert.equal(
    roadmapEndedOnHearts('test', 5, ROADMAP_MAX_HEARTS, 8),
    false,
    'checkpoints and part tests have no hearts',
  );

  const rateReq = { headers: { 'x-forwarded-for': `contract-${Date.now()}` }, socket: {} } as never;
  const rateRes = mockResponse();
  const policy = { key: `contract-${Date.now()}`, capacity: 2, refillPerSecond: 0.0001 };
  assert.equal(checkRateLimit(rateReq, rateRes as never, policy), true);
  assert.equal(checkRateLimit(rateReq, rateRes as never, policy), true);
  assert.equal(checkRateLimit(rateReq, rateRes as never, policy), false);
  assert.equal(rateRes.statusCode, 429);
  assert.ok(rateRes.headers.has('retry-after'));
  assert.equal(isDistributedRateLimitEnabled(), false, 'test environment exercises the safe local fallback');

  // The idle sweep drops only buckets that have refilled completely. It used
  // to drop any bucket idle ten minutes with a token left, which started it
  // full again: four voucher guesses every ten minutes instead of five an hour.
  {
    const realNow = Date.now;
    const start = realNow();
    const voucher = { key: `sweep-${start}`, capacity: 5, refillPerSecond: 5 / 3600 };
    const guesser = { headers: { 'x-forwarded-for': `sweep-${start}` }, socket: {} } as never;
    try {
      Date.now = () => start;
      for (let n = 0; n < 4; n += 1) assert.equal(checkRateLimit(guesser, mockResponse() as never, voucher), true);
      Date.now = () => start + 11 * 60_000;
      assert.equal(checkRateLimit(guesser, mockResponse() as never, voucher), true, 'the token left, plus what eleven minutes refilled');
      assert.equal(checkRateLimit(guesser, mockResponse() as never, voucher), false, 'the idle sweep must not refill a bucket that is not full');
    } finally {
      Date.now = realNow;
    }
  }

  // One IPv6 subscriber holds a whole /64 and may send from any address in
  // it, so the address buckets count a /64 as one caller, as an IPv4 NAT is.
  {
    const stamp = Date.now();
    const gate = { key: `ipv6-${stamp}`, capacity: 1, refillPerSecond: 0.0001 };
    const from = (address: string) => ({ headers: { 'x-forwarded-for': address }, socket: {} }) as never;
    assert.equal(checkRateLimit(from('2001:db8:aa:1::1'), mockResponse() as never, gate), true);
    assert.equal(checkRateLimit(from('2001:db8:aa:1:ffff:1234:5678:9abc'), mockResponse() as never, gate), false,
      'another address in the same /64 must not get a bucket of its own');
    assert.equal(checkRateLimit(from('2001:db8:aa:2::1'), mockResponse() as never, gate), true, 'another /64 is another caller');
    assert.equal(checkRateLimit(from('192.0.2.77'), mockResponse() as never, gate), true);
    assert.equal(checkRateLimit(from('::ffff:192.0.2.77'), mockResponse() as never, gate), false, 'an IPv4 address written as IPv6 is that address');
    assert.equal(addressKey('2001:0DB8:00aa:0001:0:0:0:1'), '2001:db8:aa:1::/64');
    assert.equal(addressKey('::1'), '0:0:0:0::/64');
    assert.equal(addressKey('64:ff9b::192.0.2.1'), '64:ff9b:0:0::/64');
    assert.equal(addressKey(`contract-${stamp}`), `contract-${stamp}`, 'a value that is no address is kept as it is');
  }

  // Grader limits are per task (owner decision 9, 9 October 2026). A Submit
  // takes its task's bucket, then a ceiling across every task; a refusal on
  // one task spends nothing of the ceiling. Grading in flight is counted the
  // same way: per task, beneath a ceiling, and an ended submit frees exactly
  // its own slot.
  {
    const stamp = Date.now();
    const perItem = { key: `item-${stamp}`, capacity: 2, refillPerSecond: 0.0001 };
    const ceiling = { key: `item-ceiling-${stamp}`, capacity: 3, refillPerSecond: 0.0001 };
    const guest = { headers: { 'x-forwarded-for': `per-item-${stamp}` }, socket: {} } as never;
    const take = async (item: string, req = guest) => {
      const res = mockResponse();
      return { ok: await enforcePerItemRateLimit(req, res as never, perItem, ceiling, item), status: res.statusCode };
    };
    assert.ok((await take('task:a')).ok && (await take('task:a')).ok, 'one task takes its whole budget');
    assert.deepEqual(await take('task:a'), { ok: false, status: 429 }, 'and is then refused');
    assert.ok((await take('task:b')).ok, 'one task\'s spent budget does not refuse another task, and its refusal spent none of the ceiling');
    assert.deepEqual(await take('task:c'), { ok: false, status: 429 }, 'the ceiling holds across tasks');
    assert.ok((await take('task:c', { headers: { 'x-forwarded-for': `per-item-other-${stamp}` }, socket: {} } as never)).ok, 'another caller keeps its own buckets');

    const scope = `grading-${stamp}`;
    const on = (item: string) => ({ item, perItem: 2, perCaller: 3 });
    const a1 = enterInFlight(guest, scope, on('task:a'));
    const a2 = enterInFlight(guest, scope, on('task:a'));
    assert.ok(a1 && a2, 'two of one caller\'s submits grade at once on one task');
    assert.equal(enterInFlight(guest, scope, on('task:a')), null, 'a third waits');
    const b1 = enterInFlight(guest, scope, on('task:b'));
    assert.ok(b1, 'a full task holds up no other task');
    assert.equal(enterInFlight(guest, scope, on('task:c')), null, 'the ceiling holds across tasks');
    const elsewhere = enterInFlight(guest, scope, on('task:c'), `user:in-flight-${stamp}`);
    assert.ok(elsewhere, 'another caller has counts of its own');
    elsewhere();
    a1();
    a1();
    const c1 = enterInFlight(guest, scope, on('task:c'));
    assert.ok(c1, 'an ended submit frees its slot');
    assert.equal(enterInFlight(guest, scope, on('task:d')), null, 'and only its own: ending it twice freed nothing more');
    for (const done of [a2, b1, c1]) done();
    const again = ['task:a', 'task:b', 'task:a'].map((item) => enterInFlight(guest, scope, on(item)));
    assert.ok(again.every(Boolean), 'once every submit has ended the caller has its whole count back');
    for (const done of again) done?.();
  }

  // A classroom round is thirty pupils joining one room from one school
  // address. Every `play` bucket used to be keyed by address alone and sized
  // for one person, so the feature 429'd its own participants. These are the
  // five assertions of fa884b7, ported onto this tree's `user:<id>` identities.
  {
    const stamp = Date.now();
    const playSource = readFileSync(join(process.cwd(), 'api/play/[action].ts'), 'utf8');
    const playClient = readFileSync(join(process.cwd(), 'client/src/components/Play.tsx'), 'utf8');
    const perMinute = (ms: string | undefined) => 60_000 / Number(ms);
    const statePollsPerSeat = perMinute(/const POLL_FALLBACK_MS = (\d+);/.exec(playClient)?.[1]);
    const presenterPolls = perMinute(/window\.setInterval\(load, (\d+)\)/.exec(playClient)?.[1]);
    assert.ok(statePollsPerSeat > 0 && presenterPolls > 0, 'Play.tsx still names its state and distribution polls');

    // 1. Two people behind one address do not share a budget, and an identity
    //    is still bounded once its own budget is spent.
    const sharedAddress = { headers: { 'x-forwarded-for': `class-${stamp}` }, socket: {} } as never;
    const perUser = { key: `class-user-${stamp}`, capacity: 1, refillPerSecond: 0.0001 };
    assert.equal(checkRateLimit(sharedAddress, mockResponse() as never, perUser, 'user:pupil-a'), true);
    assert.equal(checkRateLimit(sharedAddress, mockResponse() as never, perUser, 'user:pupil-b'), true,
      'a second identity on the same address must have its own budget, or one NAT breaks a class');
    const spent = mockResponse();
    assert.equal(checkRateLimit(sharedAddress, spent as never, perUser, 'user:pupil-a'), false,
      'an identity must still be bounded once its own budget is spent');
    assert.equal(spent.statusCode, 429);

    // 2. An account's bucket and an address's never meet, even when the
    //    address header reads like an account; and every identity a handler
    //    passes is `user:` and a verified id, or, for a Challenge played
    //    without an account, `run:` and the run id sealed in a token the
    //    server signed.
    const collide = { key: `class-ns-${stamp}`, capacity: 1, refillPerSecond: 0.0001 };
    const asAddress = { headers: { 'x-forwarded-for': 'user:pupil-c' }, socket: {} } as never;
    assert.equal(checkRateLimit(asAddress, mockResponse() as never, collide), true);
    assert.equal(checkRateLimit(asAddress, mockResponse() as never, collide, 'user:pupil-c'), true,
      'the identity and address namespaces must not collide');
    for (const file of ['api', 'lib'].flatMap(codeFiles)) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      for (const call of source.matchAll(/enforceRateLimit\(\s*req,\s*res,\s*RATE_LIMITS\.\w+,\s*([^)]+?)\s*\)/g)) {
        const sealedRun = /^api\/quiz\/(submit|challenge)\.ts$/.test(file) && /^`run:\$\{(session|run)\.runId\}`$/.test(call[1]);
        assert.ok(sealedRun || /^`user:\$\{[\w.]+\}`$/.test(call[1]),
          `${file} passes ${call[1]} as an identity; an identity is user:<verified id>, or run:<sealed run id> for a guest's Challenge`);
      }
    }

    // 3. No individual gained anything from the wider address buckets: each
    //    per-identity limit is what its address bucket carried before the
    //    split, and a signed-out `state` caller keeps that address rate.
    const preSplit = { playCreatePerUser: 5, playJoinPerUser: 12, playStatePerUser: 60, playMutationPerUser: 30, playStateAnonymous: 60 } as const;
    for (const [key, perMinuteBefore] of Object.entries(preSplit) as Array<[keyof typeof preSplit, number]>) {
      assert.ok(key in RATE_LIMITS, `rate limit ${key} must exist`);
      assert.equal(RATE_LIMITS[key].capacity, perMinuteBefore, `${key} holds the pre-split ${perMinuteBefore} a minute`);
      assert.equal(RATE_LIMITS[key].refillPerSecond, perMinuteBefore / 60, `${key} refills at the pre-split rate`);
    }
    // The presenter's distribution poll had no limit; its bucket holds two
    // presenter windows and is not shared with the host's state reads.
    assert.ok(RATE_LIMITS.playDistributionPerUser.capacity >= 2 * presenterPolls, 'two presenter windows fit the distribution bucket');
    assert.notEqual(RATE_LIMITS.playDistributionPerUser.key, RATE_LIMITS.playStatePerUser.key, 'distribution polls do not spend the host\'s state budget');

    // 4. A whole class fits in the address buckets.
    assert.ok(RATE_LIMITS.playJoin.capacity >= SHARED_NETWORK_SEATS, 'every seat must be able to join inside one window');
    assert.ok(RATE_LIMITS.playState.capacity >= SHARED_NETWORK_SEATS * statePollsPerSeat,
      'every seat must survive the Realtime fallback poll in Play.tsx');
    assert.ok(RATE_LIMITS.playMutation.capacity >= SHARED_NETWORK_SEATS, 'every seat must be able to answer one question');
    // Run it: a class behind one address joins, polls state for a minute and
    // answers, through both tiers as the handler takes them.
    const classroom = { headers: { 'x-forwarded-for': `classroom-${stamp}` }, socket: {} } as never;
    const seat = (n: number) => `user:seat-${stamp}-${n}`;
    const through = (address: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS], account: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS], n: number) =>
      checkRateLimit(classroom, mockResponse() as never, address) && checkRateLimit(classroom, mockResponse() as never, account, seat(n));
    for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
      assert.ok(through(RATE_LIMITS.playJoin, RATE_LIMITS.playJoinPerUser, n), `seat ${n + 1} of ${SHARED_NETWORK_SEATS} joins`);
    }
    for (let poll = 0; poll < statePollsPerSeat; poll += 1) {
      for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
        assert.ok(through(RATE_LIMITS.playState, RATE_LIMITS.playStatePerUser, n), `seat ${n + 1} reads state, poll ${poll + 1}`);
      }
    }
    for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
      assert.ok(through(RATE_LIMITS.playMutation, RATE_LIMITS.playMutationPerUser, n), `seat ${n + 1} answers`);
    }
    // One pupil retrying a join is stopped by the account bucket, while the
    // address still has room for the class.
    for (let retry = 1; retry < RATE_LIMITS.playJoinPerUser.capacity; retry += 1) {
      assert.ok(through(RATE_LIMITS.playJoin, RATE_LIMITS.playJoinPerUser, 0), `seat 1 joins again, try ${retry + 1}`);
    }
    const stopped = mockResponse();
    assert.equal(checkRateLimit(classroom, mockResponse() as never, RATE_LIMITS.playJoin), true, 'the address bucket still has room');
    assert.equal(checkRateLimit(classroom, stopped as never, RATE_LIMITS.playJoinPerUser, seat(0)), false, 'one account is bounded at 12 joins a minute');
    assert.equal(stopped.statusCode, 429);

    // 5. The handler takes each per-account token with a verified subject,
    //    after verifying it and before any database read.
    for (const [cfg, subject] of [['playCreatePerUser', 'hostSub'], ['playJoinPerUser', 'sub'], ['playStatePerUser', 'sub'],
                                  ['playMutationPerUser', 'sub'], ['playDistributionPerUser', 'sub']] as const) {
      assert.ok(playSource.includes(`RATE_LIMITS.${cfg}, \`user:\${${subject}}\``), `play must consume ${cfg} keyed by a verified ${subject}`);
    }
    assert.match(playSource, /RATE_LIMITS\.playStateAnonymous\)/, 'the anonymous state branch must keep its own address bucket');
    // create and join verify with requireAuthResult: they name the player
    // from the verified identity (lib/public-identity.ts).
    for (const [fn, cfg, verify] of [['create', 'playCreatePerUser', 'requireAuthResult'], ['join', 'playJoinPerUser', 'requireAuthResult'],
                                     ['state', 'playStatePerUser', 'tryAuth'], ['state', 'playStateAnonymous', 'tryAuth'],
                                     ['control', 'playMutationPerUser', 'requireAuthSub'], ['answer', 'playMutationPerUser', 'requireAuthSub'],
                                     ['distribution', 'playDistributionPerUser', 'requireAuthSub'], ['heartbeat', 'playMutationPerUser', 'requireAuthSub']] as const) {
      const start = playSource.indexOf(`async function ${fn}(`);
      const end = playSource.indexOf('\nasync function ', start + 1);
      const body = playSource.slice(start, end < 0 ? undefined : end);
      const reads = ['supabase!', 'getGameSettings(', 'getEffectiveQuestions('].map((needle) => body.indexOf(needle)).filter((at) => at >= 0);
      const verified = body.indexOf(`await ${verify}(req`);
      const limited = body.indexOf(`RATE_LIMITS.${cfg}`);
      assert.ok(start >= 0 && verified >= 0 && verified < limited && limited < Math.min(...reads),
        `${fn} takes its ${cfg} token after ${verify} and before it reads the database`);
    }
  }

  // The Biggest Shark Challenge sends one grading request per answer, so a
  // class playing it from one school address spent the old twelve-a-minute
  // address budget in seconds and pupils 13 onwards got 429 (review PLAY-4).
  // Grading, the completion step and the Hall of Fame now have the play
  // shape: a class-sized address bucket, then the caller's own bucket, per
  // account when signed in and, without an account, per run sealed in the
  // Challenge's session or run token, at the same budget. Any other caller
  // without an account keeps the old address rate.
  {
    const stamp = Date.now();
    const school = { headers: { 'x-forwarded-for': `challenge-class-${stamp}` }, socket: {} } as never;
    const pupil = (n: number) => `user:challenge-${stamp}-${n}`;
    type Limit = (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];
    const through = (address: Limit, account: Limit, n: number) =>
      checkRateLimit(school, mockResponse() as never, address) && checkRateLimit(school, mockResponse() as never, account, pupil(n));
    for (let question = 0; question < 4; question += 1) {
      for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
        assert.ok(through(RATE_LIMITS.quizSubmit, RATE_LIMITS.challengeSubmitPerUser, n), `seat ${n + 1} answers Challenge question ${question + 1}`);
      }
    }
    for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
      assert.ok(through(RATE_LIMITS.challengeComplete, RATE_LIMITS.challengeCompletePerUser, n), `seat ${n + 1} completes a run`);
      assert.ok(through(RATE_LIMITS.challengeScore, RATE_LIMITS.challengeScorePerUser, n), `seat ${n + 1} saves a score`);
    }
    // One account is still bounded while the address has room for the class.
    for (let answer = 4; answer < RATE_LIMITS.challengeSubmitPerUser.capacity; answer += 1) {
      assert.ok(through(RATE_LIMITS.quizSubmit, RATE_LIMITS.challengeSubmitPerUser, 0), `seat 1 answers again, ${answer + 1}`);
    }
    assert.equal(checkRateLimit(school, mockResponse() as never, RATE_LIMITS.quizSubmit), true, 'the address bucket still has room');
    assert.equal(checkRateLimit(school, mockResponse() as never, RATE_LIMITS.challengeSubmitPerUser, pupil(0)), false, 'one account is bounded');
    // A person's own limits: a quiz and the Hall of Fame keep the rates the
    // address buckets carried before the split; the Challenge answer and
    // completion budgets were the finding and are larger. A guest's Challenge
    // run gets the same three budgets as an account, so no per-address
    // Challenge bucket for guests is left, while a guest's other submits keep
    // the old address rate.
    const intended = {
      quizSubmitPerUser: [12, 12 / 60], quizSubmitAnonymous: [12, 12 / 60],
      challengeSubmitPerUser: [30, 30 / 60],
      challengeScorePerUser: [3, 10 / 3600],
      challengeCompletePerUser: [30, 30 / 3600],
    } as const;
    for (const [key, [capacity, refill]] of Object.entries(intended) as Array<[keyof typeof intended, readonly [number, number]]>) {
      assert.equal(RATE_LIMITS[key].capacity, capacity, `${key} holds ${capacity}`);
      assert.equal(RATE_LIMITS[key].refillPerSecond, refill, `${key} refills at ${refill} a second`);
    }
    for (const retired of ['challengeScoreAnonymous', 'challengeCompleteAnonymous']) {
      assert.equal(retired in RATE_LIMITS, false, `${retired} is gone: a guest's Challenge is bounded per run`);
    }
    // Thirty-two guests behind one school address each play a run: every
    // answer, completion and score lands, and one run is still bounded.
    const guestRun = (n: number) => `run:guest-${stamp}-${n}`;
    const guestThrough = (address: Limit, own: Limit, n: number) =>
      checkRateLimit(school, mockResponse() as never, address) && checkRateLimit(school, mockResponse() as never, own, guestRun(n));
    for (let question = 0; question < 4; question += 1) {
      for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
        assert.ok(guestThrough(RATE_LIMITS.quizSubmit, RATE_LIMITS.challengeSubmitPerUser, n), `guest ${n + 1} answers Challenge question ${question + 1}`);
      }
    }
    for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
      assert.ok(guestThrough(RATE_LIMITS.challengeComplete, RATE_LIMITS.challengeCompletePerUser, n), `guest ${n + 1} completes a run`);
      assert.ok(guestThrough(RATE_LIMITS.challengeScore, RATE_LIMITS.challengeScorePerUser, n), `guest ${n + 1} saves a score`);
    }
    // Each handler verifies the caller, then takes the caller's token, then
    // writes: grading claims the answer, completion credits XP, the Hall of
    // Fame inserts a row.
    const submitSource = readFileSync(join(process.cwd(), 'api/quiz/submit.ts'), 'utf8');
    const challengeSource = readFileSync(join(process.cwd(), 'api/quiz/challenge.ts'), 'utf8');
    const bodyOf = (source: string, fn: string) => {
      const start = source.indexOf(`async function ${fn}(`);
      const end = source.indexOf('\nasync function ', start + 1);
      assert.ok(start >= 0, `${fn} exists`);
      return source.slice(start, end < 0 ? undefined : end);
    };
    for (const [body, verify, limits, write] of [
      [bodyOf(submitSource, 'routeHandler'), 'await tryAuth(req)', ['quizSubmitPerUser', 'challengeSubmitPerUser', 'quizSubmitAnonymous'], 'await claimSubmission('],
      [bodyOf(challengeSource, 'handleCompleteRun'), 'await tryAuth(req)', ['challengeCompletePerUser'], "rpc('record_challenge_completion'"],
      [bodyOf(challengeSource, 'handleCompleteRun'), 'await tryAuth(req)', ['challengeCompletePerUser'], 'await recordChallengeScore('],
    ] as const) {
      const verified = body.indexOf(verify);
      const written = body.indexOf(write);
      for (const limit of limits) {
        const at = body.indexOf(`RATE_LIMITS.${limit}`);
        assert.ok(verified >= 0 && verified < at && at < written, `${limit} is taken after the caller is verified and before the write`);
        if (limit.endsWith('PerUser')) assert.match(body, new RegExp(`RATE_LIMITS\\.${limit}, \`user:\\$\\{\\w+\\.sub\\}\``), `${limit} is keyed by the verified account`);
      }
    }
    // A question's XP waits an hour (owner decision of 9 Oct 2026, migration
    // 058). A finished run names each answer's XP, so record_challenge_completion
    // can leave out the answers whose question paid XP less than an hour ago,
    // and the coins and the XP the learner is told follow what was awarded.
    const complete = bodyOf(challengeSource, 'handleCompleteRun');
    assert.match(complete, /creditVerifiedXp\(supabase, \{[^\n]*xp: awardedXp \}\)/, 'coins follow the XP the run was awarded');
    assert.match(complete, /const awarded = data === true;/, 'only a new award is announced');
    assert.match(complete, /xp: awarded \? awardedXp : xp/, 'the learner is told the XP the run was awarded');
    assert.match(bodyOf(challengeSource, 'runAnswers'), /xp: outcome\.isCorrect \? challengeRunXp\(1\) : 0/, 'each answer carries its XP to the routine');
  }

  // Writes to api/user/[op].ts take the same two tiers. Thirty pupils behind
  // one school address each post a quiz result in the same minute, and every
  // one lands: the per-address bucket used to stop the class at twenty, and a
  // refused result's receipt expires, so the XP was lost.
  {
    const stamp = Date.now();
    const school = `school-${stamp}`;
    const write = async (op: string, userId: string | null, address = school) => {
      const res = mockResponse();
      const req = { method: 'POST', headers: { 'x-forwarded-for': address }, query: { op }, body: userId ? { user_id: userId } : {}, socket: {} };
      return (await limitUserWrite(req as never, res as never, op)) ? 200 : res.statusCode;
    };
    const pupils: number[] = [];
    for (let n = 0; n < 30; n += 1) pupils.push(await write('stats', `pupil-${stamp}-${n}`));
    assert.deepEqual(pupils, Array(30).fill(200), 'thirty pupils behind one address each record a result');
    // One account is still bounded at the rate the address bucket carried.
    for (let n = 1; n < RATE_LIMITS.userMutation.capacity; n += 1) {
      assert.equal(await write('stats', `pupil-${stamp}-0`), 200, `pupil 1 writes again, try ${n + 1}`);
    }
    assert.equal(await write('stats', `pupil-${stamp}-0`), 429, 'one account is bounded at its own rate');
    assert.equal(await write('stats', `pupil-${stamp}-1`), 200, 'and that spends nobody else\'s budget');
    // A caller without an account keeps the per-address rate it had.
    const lone = `lone-${stamp}`;
    for (let n = 0; n < RATE_LIMITS.userMutation.capacity; n += 1) assert.equal(await write('payment-webhook', null, lone), 200);
    assert.equal(await write('payment-webhook', null, lone), 429, 'a caller without an account keeps the per-address rate');
    // The signed webhook and a path draft autosave are not charged here.
    assert.equal(await write('billing-webhook', null, lone), 200);
    assert.equal(await write('learning-path-draft', null, lone), 200);
    // The address backstop holds a class at the per-account rate.
    assert.ok(RATE_LIMITS.userMutationAddress.capacity >= SHARED_NETWORK_SEATS * RATE_LIMITS.userMutation.capacity);
    // The route's limiter and the op's own check verify the token once.
    const verifications: string[] = [];
    const seen: (string | null)[] = [];
    const warn = console.warn;
    console.warn = (line: unknown) => { if (String(line).includes('requireAuth_dev_fallback')) verifications.push(String(line)); };
    try {
      const req = { method: 'POST', headers: {}, query: { op: 'stats' }, body: { user_id: `pupil-${stamp}-once` }, socket: {} };
      await withRequestContext(req as never, mockResponse() as never, async () => {
        seen.push(await verifiedCallerId(req as never));
        seen.push(await requireAuthSub(req as never, mockResponse() as never));
      });
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(seen, [`pupil-${stamp}-once`, `pupil-${stamp}-once`], 'the limiter and the op see the same caller');
    assert.equal(verifications.length, 1, 'one request verifies its credentials once');
  }

  // Quizzes, Learn, coding and flashcards take the same two tiers.
  await classroomLimitContracts();

  const healthRes = mockResponse();
  await healthHandler({ method: 'POST', headers: {}, query: {} } as never, healthRes as never);
  assert.equal(healthRes.statusCode, 405);
  assert.equal(healthRes.headers.get('allow'), 'GET');
  assert.ok(healthRes.headers.has('x-request-id'));

  // Learn must be browsable without a database write. This exercises the same
  // structure and first-level GET the client uses, and catches an accidental
  // subject lock or a question-bank failure.
  const structureRes = mockResponse();
  await roadmapHandler({ method: 'GET', headers: {}, query: {} } as never, structureRes as never);
  assert.equal(structureRes.statusCode, 200);
  const structure = structureRes.body as { topics?: string[] };
  assert.ok(Array.isArray(structure.topics));
  assert.ok(SUBJECT_SCOPE_CATALOG.webdev.topics.every((topic) => structure.topics?.includes(topic)), 'the structure lists every webdev topic');
  {
    const lessonRes = mockResponse();
    await roadmapHandler({
      method: 'GET', headers: {}, query: { topic: 'javascript', level: '1' },
    } as never, lessonRes as never);
    assert.equal(lessonRes.statusCode, 200, 'the first JavaScript Learn level must load');
    const lesson = lessonRes.body as { sessionId?: string; questions?: Array<Record<string, unknown>> };
    assert.match(lesson.sessionId ?? '', /^v2\./);
    assert.ok((lesson.questions?.length ?? 0) > 0);
    assert.ok(lesson.questions?.every((question) => !('correctAnswer' in question)));
  }

  // ── progression graph (#152) ────────────────────────────────────────────
  // A curriculum edit that strands a learner — a cycle, a prerequisite on a
  // topic that no longer exists, a plan whose first stage nothing can open —
  // fails here rather than in front of the learner.
  const graphProblems = validateProgressionGraph(ROADMAP_TOPICS, LEARN_SECTIONS);
  assert.deepEqual(
    graphProblems,
    [],
    `progression graph must be complete, acyclic and reachable: ${JSON.stringify(graphProblems)}`,
  );
  assert.deepEqual(everyPlanHasAFirstStep(), [], 'every plan needs a first step a new learner can take');

  // Every deployable devShark topic must be in at least one base track's plan.
  // A topic that is in none is authored content no learner can reach: `ai` was
  // exactly that — twenty levels and a hundred and sixty questions, present only
  // in the FDE bridge, so every learner who did not take the specialisation was
  // refused it as "not in your plan".
  {
    const withTrack = (baseTrack: string, sections: readonly string[] = []) => ({
      schemaVersion: 2, baseTrack, specialization: null, sections,
      goals: ['job'], experience: 'some', studyTime: 15,
    } as unknown as Parameters<typeof isTopicInPlan>[0]);
    const tracks = Object.keys(WEBDEV_PLAN_STAGES);
    const stranded = [...SUBJECT_SCOPE_CATALOG.webdev.topics].filter(
      (topic) => !tracks.some((track) => isTopicInPlan(withTrack(track), 'webdev', topic)
        || OPT_IN_SECTIONS.some((section) => isTopicInPlan(withTrack(track, [section.id]), 'webdev', topic))),
    );
    assert.deepEqual(stranded, [], `every deployable topic needs a base track or joined section that plans it: ${stranded.join(', ')}`);
  }

  // TypeScript is a late topic, deliberately. It used to sit one stage after a
  // learner's first JavaScript, which put a type system in front of people who
  // had not written enough code for one to help yet. It now comes after the
  // work it pays off against, and this fails if it drifts back to the front.
  {
    for (const [track, stages] of Object.entries(WEBDEV_PLAN_STAGES)) {
      const indexOf = (topic: string) => stages.findIndex((stage) => stage.includes(topic));
      const ts = indexOf('typescript');
      assert.ok(ts >= 0, `${track} must still plan typescript`);
      assert.ok(
        ts >= Math.ceil(stages.length / 2),
        `typescript is stage ${ts + 1} of ${stages.length} on ${track}; it belongs in the second half`,
      );
      // And after the thing it is types *for*: components on the browser tracks,
      // handlers on the server one.
      const after = track === 'backend' ? 'nodejs' : 'react';
      assert.ok(
        indexOf(after) >= 0 && indexOf(after) < ts,
        `typescript must come after ${after} on ${track}`,
      );
    }
  }

  // Editing a plan narrows what is offered next; it never withdraws what was
  // earned. A learner who passed Next.js levels on the frontend track and then
  // moved to backend — where Next.js is not in the plan — must still be able to
  // open the levels they already passed.
  {
    const backend = {
      schemaVersion: 2, baseTrack: 'backend', specialization: null,
      goals: ['job'], experience: 'some', studyTime: 15,
    } as unknown as Parameters<typeof isTopicInPlan>[0];
    assert.equal(isTopicInPlan(backend, 'webdev', 'nextjs'), false, 'the premise: backend does not plan nextjs');
    const passedNext = { nextjs: { levels: { '1': { passed: true }, '2': { passed: true } } } };
    // The carve-out stepRefusal applies before the plan check.
    assert.equal(stepAlreadyPassed(passedNext, 'nextjs', { kind: 'level', level: 2 }), true,
      'a level already passed is served whatever the plan now says');
    assert.equal(stepAlreadyPassed(passedNext, 'nextjs', { kind: 'level', level: 3 }), false,
      'a level never passed is still gated by the plan and its prerequisites');
    const passedCheckpoint = { nextjs: { checkpoints: { '1': { passed: true } } } };
    assert.equal(stepAlreadyPassed(passedCheckpoint, 'nextjs', { kind: 'checkpoint', checkpoint: 1 }), true);
    assert.equal(stepAlreadyPassed(passedCheckpoint, 'nextjs', { kind: 'checkpoint', checkpoint: 2 }), false);
    // A part test is recorded under `checkpoints` by its part number, so a
    // passed one takes the carve-out on `?test=` as it does on `?checkpoint=`.
    // Before, `?test=` refused it with not_in_plan while `?checkpoint=` served
    // the same test, and the map offered it as passed and clickable.
    assert.equal(stepAlreadyPassed(passedCheckpoint, 'nextjs', { kind: 'test', part: 1, from: 1, to: 5 }), true,
      'a passed part test is already passed under its ?test= name');
    assert.equal(stepAlreadyPassed(passedCheckpoint, 'nextjs', { kind: 'test', part: 2, from: 6, to: 10 }), false,
      'a part test never passed still takes the ordinary check');
    assert.equal(stepAlreadyPassed(passedNext, 'nextjs', { kind: 'test', part: 1, from: 1, to: 2 }), false,
      'passing the levels a part test spans is not passing the test');
  }

  // ── Learn sections (#487) ────────────────────────────────────────────────
  // The membership matrix the owner approved (plan section 5.1), opt-in
  // sections append to the plan with their prerequisites, and a profile without
  // `sections` plans exactly what it planned before.
  {
    const section = (id: string) => LEARN_SECTIONS.find((one) => one.id === id)!;
    assert.deepEqual([...LEARN_SECTION_IDS], ['web-developer', 'software-engineer', 'forward-deployed-engineer']);
    assert.deepEqual(section('web-developer').topics,
      ['html', 'css', 'javascript', 'typescript', 'react', 'nextjs', 'nodejs', 'databases', 'git', 'general']);
    assert.deepEqual(section('software-engineer').topics,
      ['dsa', 'dsa-advanced', 'algorithms', 'system-design', 'devops', 'security', 'databases', 'git', 'general']);
    assert.deepEqual(section('forward-deployed-engineer').topics,
      ['ai', 'nodejs', 'databases', 'general', 'devops', 'security']);
    assert.deepEqual(LEARN_SECTIONS.map((one) => [one.id, one.membership, [...one.paths]]), [
      ['web-developer', 'base-track', []],
      ['software-engineer', 'opt-in', []],
      ['forward-deployed-engineer', 'specialization', ['fde']],
    ]);
    assert.deepEqual(OPT_IN_SECTIONS, LEARN_SECTIONS.filter((one) => one.membership === 'opt-in'),
      'planTopics appends exactly the opt-in sections');
    assert.equal(INITIAL_OPT_IN_SECTIONS, OPT_IN_SECTIONS, 'learn-sections re-exports the opt-in list of learn-section-ids');
    // The initial bundle plans (shared/progression.ts) and parses profiles
    // (shared/learning-paths.ts) but renders no section. Neither may import
    // the full registry, or every section's topic list ships to every visitor.
    for (const file of ['shared/progression.ts', 'shared/learning-paths.ts']) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /from '\.\/learn-sections'/,
        `${file} imports from ./learn-section-ids, never the full ./learn-sections registry`);
    }
    // Shared topics: one id, listed in several sections.
    assert.deepEqual(sectionsForTopic('databases'), ['web-developer', 'software-engineer', 'forward-deployed-engineer']);
    assert.deepEqual(sectionsForTopic('git'), ['web-developer', 'software-engineer']);
    assert.deepEqual(sectionsForTopic('ai'), ['forward-deployed-engineer']);
    assert.ok(SPECIALIZATION_BRIDGE_TOPICS.fde.includes('ai'), 'the FDE bridge brings AI & LLMs into the plan');
    // A section a learner belongs to never lists a topic their plan lacks:
    // FDE comes with the specialization, so its bridge carries every FDE topic.
    for (const track of Object.keys(WEBDEV_PLAN_STAGES) as BaseTrack[]) {
      const fde = planTopics({
        schemaVersion: 2, baseTrack: track, specialization: 'fde',
        goals: ['level-up'], experience: 'some', studyTime: '15-30', updatedAt: null,
      });
      for (const topic of section('forward-deployed-engineer').topics) {
        assert.ok(fde.includes(topic), `an FDE learner on ${track} plans the FDE section topic ${topic}`);
      }
    }

    const frontend = {
      schemaVersion: 2 as const, baseTrack: 'frontend' as const, specialization: null,
      goals: ['level-up' as const], experience: 'some' as const, studyTime: '15-30' as const, updatedAt: null,
    };
    const joined = { ...frontend, sections: ['software-engineer' as const] };
    const base = planTopics(frontend);
    const withSection = planTopics(joined);
    assert.deepEqual(withSection.slice(0, base.length), base, 'a joined section appends after the track stages');
    // The acceptance order: the section's topics in section order (those the
    // track already plans keep their stage position), then Node.js, the
    // prerequisite of System Design, DevOps & Cloud and Databases.
    assert.deepEqual(withSection.slice(base.length), ['dsa-advanced', 'algorithms', 'system-design', 'devops', 'security', 'databases', 'nodejs']);
    for (const topic of ['dsa', 'dsa-advanced', 'algorithms', 'system-design', 'devops', 'security', 'databases', 'git', 'general', 'nodejs']) {
      assert.ok(withSection.includes(topic), `a Frontend learner in Software Engineer plans ${topic}`);
    }
    for (const topic of withSection) {
      for (const prereq of TOPIC_PREREQS[topic] ?? []) {
        assert.ok(withSection.includes(prereq), `${topic} is planned, so its prerequisite ${prereq} must be too`);
      }
    }
    // The server's plan check (`stepRefusal` → 403 not_in_plan) reads the same rule.
    assert.equal(isTopicInPlan(joined, 'webdev', 'dsa-advanced'), true);
    assert.equal(isTopicInPlan(frontend, 'webdev', 'dsa-advanced'), false);
    assert.equal(isTopicInPlan(joined, 'webdev', 'system-design'), true);
    assert.equal(isTopicInPlan(frontend, 'webdev', 'system-design'), false);
    assert.equal(isTopicInPlan(joined, 'webdev', 'cool-stuff'), false);

    // Without `sections`, and with only implied sections, nothing changes.
    for (const track of Object.keys(WEBDEV_PLAN_STAGES) as BaseTrack[]) {
      for (const specialization of [null, 'fde' as const]) {
        const plain = { ...frontend, baseTrack: track, specialization };
        assert.deepEqual(planTopics({ ...plain, sections: [] }), planTopics(plain));
        assert.deepEqual(planTopics({ ...plain, sections: ['web-developer', 'forward-deployed-engineer'] }), planTopics(plain),
          'Web Developer and FDE follow the track and the specialization, not the saved list');
      }
    }
    assert.deepEqual(learnerSections(frontend), ['web-developer']);
    assert.deepEqual(learnerSections({ ...frontend, specialization: 'fde' }), ['web-developer', 'forward-deployed-engineer']);
    assert.deepEqual(learnerSections(joined), ['web-developer', 'software-engineer']);
    assert.deepEqual(learnerSections(null), []);

    // The profile parser keeps known sections, drops the rest, and leaves a
    // missing list missing.
    assert.deepEqual(parseLearnerProfile({ ...frontend, sections: ['software-engineer', 'nope', 'software-engineer'] })?.sections, ['software-engineer']);
    assert.equal(parseLearnerProfile(frontend)?.sections, undefined);
    assert.equal(parseLearnerProfile({ ...frontend, sections: 'software-engineer' })?.sections, undefined);

    // The graph validator catches a broken registry.
    const broken = LEARN_SECTIONS.map((one) => one.id === 'software-engineer'
      ? { ...one, topics: [...one.topics, 'quantum'], paths: ['nope' as never] }
      : one.id === 'forward-deployed-engineer' ? { ...one, topics: one.topics.filter((topic) => topic !== 'ai') } : one);
    const kinds = validateProgressionGraph(ROADMAP_TOPICS, broken).map((problem) => `${problem.kind}:${problem.topic}`).sort();
    assert.deepEqual(kinds, ['unknown-section-path:nope', 'unknown-section-topic:quantum', 'unsectioned-topic:ai']);
    assert.ok(
      validateProgressionGraph(ROADMAP_TOPICS, [...LEARN_SECTIONS, { id: 'web-developer', topics: ['abbreviations'], paths: [], membership: 'base-track' }])
        .some((problem) => problem.kind === 'unknown-section-topic' && problem.topic === 'abbreviations'),
      'a retired topic may not sit in a section',
    );
  }

  // No plan may be empty, and every plan topic must belong to devShark.
  for (const track of Object.keys(WEBDEV_PLAN_STAGES) as BaseTrack[]) {
    const profile = {
      schemaVersion: 2 as const,
      baseTrack: track,
      specialization: null,
      goals: ['level-up' as const],
      experience: 'some' as const,
      studyTime: '15-30' as const,
      updatedAt: null,
    };
    assert.ok(planTopics(profile).length > 0, `${track} plan must contain topics`);
    assert.equal(isLearnerProfileComplete(profile), true, 'a fully answered profile is complete');
    // A plan excludes what the learner did not choose, and a subject without
    // plans keeps everything it owns.
    assert.equal(isTopicInPlan(profile, 'webdev', 'cool-stuff'), false);
    assert.equal(isTopicInPlan(profile, 'legacy-subject', 'anything'), true);
  }

  // Experience is advisory: the most experienced answer opens nothing.
  const senior = {
    schemaVersion: 2 as const,
    baseTrack: 'fullstack' as const,
    specialization: null,
    goals: ['interview-prep' as const],
    experience: 'professional' as const,
    studyTime: '60-plus' as const,
    updatedAt: null,
  };
  assert.equal(isLevelUnlocked({}, 'javascript', 2), false, 'level 2 needs level 1, whatever the learner reports');
  assert.equal(isLevelUnlocked({}, 'javascript', 1), true);
  assert.equal(isLevelUnlocked({ javascript: { levels: { '1': { passed: true } } } }, 'javascript', 2), true);
  assert.equal(isLevelUnlocked({ javascript: { levels: { '5': { passed: true } } } }, 'javascript', 6), false,
    'a new segment needs its checkpoint, not just the level before it');
  assert.ok(planTopics(senior).includes('javascript'));

  // A profile that fails to parse asks for what is missing instead of
  // inventing answers, and never reads as complete.
  const partial = parseLearnerProfile({ schemaVersion: 2, baseTrack: 'frontend', goals: ['nope'] });
  assert.ok(partial);
  assert.equal(isLearnerProfileComplete(partial), false);
  assert.deepEqual(missingProfileFields(partial).sort(), ['experience', 'goals', 'studyTime']);
  assert.equal(parseLearnerProfile({ schemaVersion: 2, baseTrack: 'nope' }), null);
  const fromV1 = profileFromPreference({ schemaVersion: 1, baseTrack: 'backend', specialization: 'fde' });
  assert.equal(fromV1?.baseTrack, 'backend');
  assert.equal(fromV1?.specialization, 'fde');
  assert.equal(isLearnerProfileComplete(fromV1), false, 'a v1 preference still owes the newer answers');

  // ── retired sections and the glossary (#177, #178, #179) ───────────────
  // A retired section leaves the topic list and stays in the category list:
  // nothing serves it, and every historical row still resolves to devShark.
  for (const topic of RETIRED_TOPIC_IDS) {
    assert.ok(!ROADMAP_TOPICS.includes(topic as never), `${topic} must not be a served roadmap topic`);
    assert.equal(subjectForTopic(topic), undefined, `${topic} must not resolve as a topic`);
    assert.equal(subjectForCategory(topic), 'webdev', `${topic} must still resolve as a category for history`);
    assert.ok(retirementOf(topic), `${topic} needs a recorded destination`);
    // Discovery no longer offers it, and an explicit request cannot rebuild
    // the pool either.
    assert.ok(!defaultDeploymentCategories().includes(topic), `${topic} must not be drawn by default`);
    assert.equal(
      validateCategoryScope([topic], { forDelivery: true }).ok,
      false,
      `${topic} must not be requestable for delivery`,
    );
  }
  // Requests for questions are built from `deliveryCategories`, and the server
  // must accept that list whole: one retired category refuses a request, which
  // is how the challenge and the daily set failed from 2026-09-08 to 2026-09-25.
  // Reads over history still accept the full catalogue.
  assert.deepEqual(defaultDeploymentCategories(), deliveryCategories('webdev'));
  assert.equal(validateCategoryScope(deliveryCategories('webdev'), { forDelivery: true }).ok, true, 'the delivery list must be requestable');
  assert.equal(
    validateCategoryScope([...SUBJECT_SCOPE_CATALOG.webdev.categories], { forDelivery: true }).ok,
    false,
    'the full catalogue names retired sections, so it must not be sent for delivery',
  );
  assert.equal(validateCategoryScope([...SUBJECT_SCOPE_CATALOG.webdev.categories]).ok, true, 'a read may name a retired category');

  // The skill-check cannot grant a retired topic, however well the learner did.
  for (const correct of [10, 14, 18, 20]) {
    for (const granted of assessmentUnlocks('webdev', correct)) {
      assert.ok(!RETIRED_TOPIC_IDS.includes(granted), `the skill check must not unlock ${granted}`);
    }
  }

  // The glossary matches on word boundaries and exact case, and never invents
  // an expansion for a name that is not an acronym.
  assert.deepEqual(termsIn('rapid apiary').map((one) => one.term), [], 'lowercase fragments are not terms');
  assert.deepEqual(termsIn('The API returns JSON.').map((one) => one.term), ['API', 'JSON']);
  assert.deepEqual(termsIn('Two APIs disagree.').map((one) => one.term), ['API'], 'a plural still matches');
  const npmEntry = GLOSSARY.find((one) => one.term === 'npm');
  assert.ok(npmEntry && npmEntry.expansion === undefined, 'npm is a name, not initials');
  for (const entry of GLOSSARY) {
    assert.ok(entry.meaning.length > 20, `${entry.term} needs a meaning`);
    assert.ok(entry.domains.length > 0, `${entry.term} must say where it means this`);
    assert.match(entry.reviewed, /^\d{4}-\d{2}-\d{2}$/);
  }

  // ── rewards (#167-#173) ────────────────────────────────────────────────
  // The shop ships unconfigured and cannot be talked into selling anything.
  // Nothing about a reward may reach a learning table, and the separation is
  // asserted here rather than described in a comment.
  const bareMerch = { ...DEFAULT_MERCH_SETTINGS, pricing: {} };
  for (const sku of MERCH_SKUS) {
    assert.equal(
      merchAvailability({ sku, settings: bareMerch }),
      'unconfigured',
      `${sku} must be unconfigured until a real quote is entered`,
    );
  }
  // Enabling the shop does not price anything: an item with no quote stays
  // unconfigured however many switches are flipped.
  assert.equal(
    merchAvailability({ sku: 'mug', settings: { ...bareMerch, enabled: true, testMode: false } }),
    'unconfigured',
  );
  const quoted = {
    ...bareMerch,
    enabled: true,
    pricing: {
      mug: {
        unitCostMinor: 300, printCostMinor: 150, shippingCostMinor: 400, packagingCostMinor: 60,
        priceMinor: 1400, currency: 'CZK', taxIncluded: true, regions: ['CZ'],
        vendor: 'example', effectiveFrom: '2026-09-08',
      },
    },
  };
  assert.equal(merchAvailability({ sku: 'mug', settings: quoted, region: 'CZ', stock: 3 }), 'available');
  assert.equal(merchAvailability({ sku: 'mug', settings: quoted, region: 'DE', stock: 3 }), 'out_of_region');
  assert.equal(merchAvailability({ sku: 'mug', settings: quoted, region: 'CZ', stock: 0 }), 'out_of_stock');
  assert.equal(merchMarginMinor(quoted.pricing.mug), 1400 - 300 - 150 - 400 - 60);

  // A settings blob missing any commercial field is dropped rather than
  // half-applied: half a quote is not a quote.
  const halfQuote = normalizeSettings({
    merch: { enabled: true, pricing: { mug: { priceMinor: 1400, currency: 'CZK' } } },
  });
  assert.equal(halfQuote.merch.pricing.mug, undefined, 'an incomplete quote must not price an item');
  assert.equal(halfQuote.merch.testMode, true, 'test mode stays on unless explicitly turned off');

  // Addresses: bounded, and refused when the obviously required parts are
  // missing, before anything is charged.
  assert.equal(validateAddress({}).ok, false);
  const lowerCase = validateAddress({ name: 'A', line1: 'B', city: 'C', postalCode: 'D', country: 'cz' });
  assert.equal(lowerCase.ok && lowerCase.address.country, 'CZ', 'a country code is read in capitals');
  assert.equal(validateAddress({ name: 'A', line1: 'B', city: 'C', postalCode: 'D', country: 'ZZZ' }).ok, false);
  // Two letters are not enough: the code has to be an assigned ISO 3166-1 one.
  for (const country of ['ZZ', 'UK', 'EU', 'XK']) {
    assert.equal(validateAddress({ name: 'A', line1: 'B', city: 'C', postalCode: 'D', country }).ok, false, `${country} is not an ISO 3166-1 code`);
  }
  assert.equal(validateAddress({ name: 'x'.repeat(200), line1: 'B', city: 'C', postalCode: 'D', country: 'CZ' }).ok, false);
  // Postgres text refuses U+0000, so a field holding it made the order a 500.
  for (const field of ['name', 'line1', 'line2', 'city', 'postalCode']) {
    const nul = validateAddress({ name: 'A', line1: 'B', city: 'C', postalCode: 'D', country: 'CZ', [field]: 'X\u0000Y' });
    assert.deepEqual(nul, { ok: false, field }, `U+0000 in ${field} is refused`);
  }

  // Tokens follow verified XP only, and the rate is the documented one.
  assert.equal(tokensForVerifiedXp(100), 10);
  assert.equal(tokensForVerifiedXp(0), 0);
  assert.equal(tokensForVerifiedXp(-5), 0);

  // ── task resources (#155) ───────────────────────────────────────────────
  // Every documented technique is a real reference page with a title, both
  // blurbs and a review date, and a task lists all of its techniques, not one.
  for (const link of CODING_DOC_LINKS) {
    assert.ok(link.url.startsWith('https://'), `${link.tag} must link over https`);
    assert.ok(link.title.length > 0, `${link.tag} needs the page's title`);
    assert.ok(link.blurb.length > 10, `${link.tag} needs a blurb`);
    assert.match(link.reviewed, /^\d{4}-\d{2}-\d{2}$/, `${link.tag} needs a review date`);
  }
  assert.equal(taskResources(['map', 'filter', 'reduce']).length, 3, 'a task lists every technique it declares');
  assert.deepEqual(taskResources(['not-a-technique']), [], 'an undocumented technique yields an empty panel, not a filler link');

  // ── failure hints (#156) ────────────────────────────────────────────────
  // The classifier sees only the learner's own output and facts about the
  // task's shape, and returns a category name plus authored text. Nothing it
  // returns may contain an input, an expected value or a raw error.
  assert.equal(classifyFailure({ timedOut: true }), 'timeout');
  assert.equal(classifyFailure({ typeErrors: true }), 'types');
  assert.equal(classifyFailure({ threw: true }), 'runtime');
  assert.equal(
    classifyFailure({ results: [{ pass: false, actual: 'undefined' }, { pass: false, actual: 'undefined' }] }),
    'missing-return',
  );
  assert.equal(
    classifyFailure({
      results: [{ pass: false, actual: '"abc"' }],
      expectedKinds: ['array'],
    }),
    'output-shape',
  );
  assert.equal(
    classifyFailure({
      results: [{ pass: true, actual: '2' }, { pass: false, actual: '0' }],
      edge: [false, true],
      expectedKinds: ['number', 'number'],
    }),
    'boundary',
  );
  assert.equal(classifyFailure({ results: [{ pass: false, actual: '3' }], expectedKinds: ['number'] }), 'tests');
  // A declared pitfall is used only when nothing more specific was proven.
  assert.equal(classifyFailure({ results: [{ pass: false, actual: '3' }], pitfall: 'mutation' }), 'mutation');
  assert.equal(classifyFailure({ timedOut: true, pitfall: 'mutation' }), 'timeout');
  // Every category the classifier can return either has curated text or falls
  // through to the ladder; none of that text mentions a value or a test.
  for (const category of FAILURE_CATEGORIES) {
    const hint = failureHint(category, undefined);
    if (!hint) {
      assert.equal(category, 'tests', 'only the generic category may fall through to the hint ladder');
      continue;
    }
    assert.ok(hint.body.length > 20, `${category} hint must say something`);
    assert.ok(!/expected|hidden test/i.test(hint.body), `${category} hint must not mention expectations or hidden tests`);
  }

  // ── curation claims never outrun their evidence (#181) ─────────────────
  //
  // Every one of these is a sentence the product would otherwise be able to
  // show a learner without anything behind it.
  {
    // A synthetic id, never in the registry: this block tests what the product
    // says about an item nobody has reviewed, so it must not borrow the id of
    // a real one. Borrowing `rm-js-1` made the fixture read as `superseded`
    // once the audit recorded a decision for that id, which is the right
    // answer to a different question.
    const sampleQuestion = {
      id: 'rm-js-contract-fixture',
      tags: ['Roadmap'],
      introduction: '',
      question: 'What does this return?',
      options: ['a', 'b', 'c', 'd'],
      correctAnswer: 2,
      category: 'javascript' as const,
      explanation: 'Because.',
      difficulty: 1 as const,
    };

    // The version covers the answer, so editing it invalidates the approval —
    // and the version is keyed, so holding the options does not let anyone
    // recover which one is right by hashing the four candidates.
    const base = contentVersion(sampleQuestion);
    assert.notEqual(base, contentVersion({ ...sampleQuestion, correctAnswer: 0 }));
    assert.notEqual(base, contentVersion({ ...sampleQuestion, explanation: 'Different.' }));
    assert.notEqual(base, contentVersion({ ...sampleQuestion, question: 'What now?' }));
    assert.equal(base, contentVersion({ ...sampleQuestion }), 'the same content must give the same version');
    assert.ok(
      !createHash('sha256')
        .update(JSON.stringify(sampleQuestion))
        .digest('base64url')
        .startsWith(base),
      'the version must not be a plain digest of the content',
    );

    // Nothing is reviewed until a record exists for the exact version.
    assert.equal(itemReview(sampleQuestion).status, 'unreviewed');
    assert.equal(itemClaim(itemReview(sampleQuestion)), 'not-yet-reviewed');
    assert.equal(reviewStatusFor(undefined, base), 'unavailable', 'a metadata failure is not a review');
    assert.equal(itemClaim({ version: base, status: 'unavailable' }), 'none', 'unavailable metadata says nothing');

    const record = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
      itemId: sampleQuestion.id,
      version: base,
      relevance: 8,
      quality: 5,
      events: [{ kind: 'human', at: '2026-01-02' }],
      ...over,
    });
    assert.equal(reviewStatusFor(record(), base), 'reviewed');
    assert.equal(reviewStatusFor(record(), 'a-different-version'), 'superseded', 'an edit invalidates approval');
    assert.equal(reviewStatusFor(record({ quality: 2 }), base), 'superseded', 'a failed gate is not reviewed');
    assert.equal(reviewStatusFor(record({ relevance: 3 }), base), 'superseded', 'a failed gate is not reviewed');
    assert.equal(itemClaim(publicItemReview(record(), 'a-different-version')), 'not-yet-reviewed');

    // "Reviewed more than once" needs more than one recorded human review, and
    // automated or execution evidence never counts toward it.
    assert.equal(itemClaim(publicItemReview(record(), base)), 'reviewed-once');
    assert.equal(
      itemClaim(publicItemReview(record({ events: [
        { kind: 'human', at: '2026-01-02' },
        { kind: 'automated', at: '2026-02-02' },
        { kind: 'execution', at: '2026-02-02' },
      ] }), base)),
      'reviewed-once',
      'a script running is not a second human review',
    );
    assert.equal(
      itemClaim(publicItemReview(record({ events: [
        { kind: 'human', at: '2026-01-02' },
        { kind: 'human', at: '2026-03-02' },
      ] }), base)),
      'reviewed-repeatedly',
    );

    // Machine evidence stands on its own and is never called a review.
    const codingReview = codingTaskReview({ ...CODING_TASKS[0], id: 'unreviewed-contract-fixture' });
    assert.equal(codingReview.status, 'unreviewed');
    assert.equal((codingReview.executionChecks ?? 0) > 0, true, 'a proven solution is recorded evidence');
    assert.equal(itemClaim(codingReview), 'checked-automatically');
    assert.ok(codingReview.version.length >= 8, 'a coding task carries a version to report against');

    const authoredTask = CODING_TASKS.find(task => task.id === 'js-word-count')!;
    const authoredSolution = solutionFor(authoredTask.id)!;
    const reviewedHash = taskHash(authoredTask, authoredSolution);
    const reviewedVersion = codingTaskReview(authoredTask, authoredSolution).version;
    const changedSolution = { ...authoredSolution, hiddenTests: authoredSolution.hiddenTests!.map((row, index) => index === 0 ? { ...row, expected: 'changed-contract-value' } : row) };
    assert.notEqual(taskHash(authoredTask, changedSolution), reviewedHash);
    assert.notEqual(codingTaskReview(authoredTask, changedSolution).version, reviewedVersion, 'a grader edit changes the keyed public version');
    assert.notEqual(taskHash(authoredTask, { ...authoredSolution, junior: 'changed authored variant' }), reviewedHash, 'each revealed solution variant participates in approval');
    assert.notEqual(taskHash(authoredTask, { ...authoredSolution, hiddenSuite: 'changed trusted suite' }), reviewedHash, 'hidden React grader material participates in approval');
    assert.notEqual(taskHash({ ...authoredTask, references: [{ title: 'Changed reference', url: 'https://example.test/reference' }] }, authoredSolution), reviewedHash, 'authored documentation references participate in approval');
    const comparison = approachesFor(authoredTask.id)[0];
    const previousCode = comparison.code;
    try {
      comparison.code += '\n// changed authored comparison';
      assert.notEqual(taskHash(authoredTask, authoredSolution), reviewedHash, 'comparison code participates in approval');
      assert.notEqual(codingTaskReview(authoredTask, authoredSolution).version, reviewedVersion, 'comparison code participates in the report version');
    } finally { comparison.code = previousCode; }
    const puzzle = puzzleFor(authoredTask.id)!;
    const previousOrders = puzzle.accepted;
    try {
      puzzle.accepted = [...previousOrders, [...previousOrders[0]].reverse()];
      assert.notEqual(taskHash(authoredTask, authoredSolution), reviewedHash, 'accepted puzzle orders participate in approval');
      assert.notEqual(codingTaskReview(authoredTask, authoredSolution).version, reviewedVersion, 'a puzzle-key edit changes the report version');
    } finally { puzzle.accepted = previousOrders; }

    // The public shape carries no scores unless a current record exists, and
    // never a reviewer, a report or anything resembling an answer.
    const unreviewedShape = Object.keys(itemReview(sampleQuestion));
    for (const key of ['relevance', 'quality', 'reviewedAt', 'humanReviews']) {
      assert.ok(!unreviewedShape.includes(key), `an unreviewed item must not carry ${key}`);
    }
    const reviewedShape = JSON.stringify(publicItemReview(record(), base));
    assert.ok(!/reviewer|report|answer|correct/i.test(reviewedShape), 'review metadata must not name a reviewer or an answer');

    // A bank-wide claim needs every source counted, and no claim at all is the
    // answer to both "nothing reviewed" and "a source we cannot count".
    assert.equal(coverageClaim(summarizeCoverage([{ id: 'bank', items: 100, reviewed: 0 }])), 'none');
    assert.equal(coverageClaim(summarizeCoverage([{ id: 'bank', items: 100, reviewed: 40 }])), 'partial');
    assert.equal(coverageClaim(summarizeCoverage([{ id: 'bank', items: 100, reviewed: 100 }])), 'complete');
    assert.equal(
      coverageClaim(summarizeCoverage([
        { id: 'bank', items: 100, reviewed: 100 },
        { id: 'overrides', items: null, reviewed: null },
      ])),
      'none',
      'one uncountable source means no bank-wide claim',
    );

    // The gates are separate: passing one never stands in for the other.
    assert.equal(passesBothGates(RELEVANCE_MAX, QUALITY_MIN - 1), false);
    assert.equal(passesBothGates(RELEVANCE_MIN - 1, QUALITY_MAX), false);
    assert.equal(passesBothGates(RELEVANCE_MIN, QUALITY_MIN), true);
    assert.equal(RELEVANCE_MARKERS.length * MARKER_MAX, RELEVANCE_MAX, 'five markers of two points make ten');
  }

  // ── concepts, spacing and interleaving (#182, #184) ─────────────────────
  {
    assert.deepEqual(validateConcepts(), [], 'the concept groups must be structurally sound');

    // Every authored concept must actually match questions in the live bank,
    // or it is a group that can never be practised.
    const bankByConcept = new Map<string, number>();
    for (const question of questions) {
      const concept = conceptOf(question);
      if (concept) bankByConcept.set(concept, (bankByConcept.get(concept) ?? 0) + 1);
    }
    for (const id of CONCEPT_IDS) {
      assert.ok((bankByConcept.get(id) ?? 0) > 0, `concept ${id} matches no question in the bank`);
    }
    // And a concept only ever resolves inside its own topic, so a mix can never
    // reach across a product or into a topic the learner has not unlocked.
    for (const question of questions) {
      const concept = conceptOf(question);
      if (!concept) continue;
      assert.equal(conceptById(concept)?.topic, question.category, `${question.id} resolved outside its topic`);
    }

    // Spacing: only independent retrieval lengthens an interval.
    const t0 = Date.UTC(2026, 0, 1);
    const start = { conceptId: 'js-map', stage: 1, dueAt: null, streak: 1, lastItemId: null };
    const hours = (state: { dueAt: string | null }) =>
      state.dueAt ? Math.round((Date.parse(state.dueAt) - t0) / 3600_000) : null;

    const independent = nextReviewState(start, { conceptId: 'js-map', correct: true, kind: 'independent', itemId: 'a' }, t0);
    assert.equal(independent.stage, 2);
    assert.equal(hours(independent), DEFAULT_INTERVAL_HOURS[2]);
    for (const kind of ['hinted', 'revealed', 'assisted'] as const) {
      const held = nextReviewState(start, { conceptId: 'js-map', correct: true, kind, itemId: 'a' }, t0);
      assert.equal(held.stage, 1, `a ${kind} answer must not climb the ladder`);
      assert.equal(held.streak, 1, `a ${kind} answer must not extend the streak`);
    }
    // Wrong is wrong whatever the kind, and comes back soon rather than never.
    for (const kind of RETRIEVAL_KINDS) {
      const failed = nextReviewState({ ...start, stage: 4 }, { conceptId: 'js-map', correct: false, kind, itemId: 'a' }, t0);
      assert.equal(failed.stage, 0);
      assert.equal(failed.streak, 0);
      assert.equal(hours(failed), RELEARN_HOURS);
    }
    // The ladder is bounded at the top: nothing is pushed past its last rung.
    let climbed: ReturnType<typeof nextReviewState> = { ...start, stage: 0 };
    for (let i = 0; i < 20; i++) {
      climbed = nextReviewState(climbed, { conceptId: 'js-map', correct: true, kind: 'independent', itemId: `q${i}` }, t0);
    }
    assert.equal(climbed.stage, DEFAULT_INTERVAL_HOURS.length - 1);
    assert.ok(DEFAULT_INTERVAL_HOURS.every((h, i) => i === 0 || h > DEFAULT_INTERVAL_HOURS[i - 1]), 'intervals must lengthen');

    // Due selection: overdue first, capped, and never outside eligibility.
    const states = [
      { conceptId: 'js-map', stage: 1, dueAt: new Date(t0 - 50 * 3600_000).toISOString(), streak: 1, lastItemId: 'x' },
      { conceptId: 'js-filter', stage: 2, dueAt: new Date(t0 - 2 * 3600_000).toISOString(), streak: 2, lastItemId: null },
      { conceptId: 'js-reduce', stage: 0, dueAt: new Date(t0 + 5 * 3600_000).toISOString(), streak: 0, lastItemId: null },
      { conceptId: 'css-grid', stage: 0, dueAt: new Date(t0 - 99 * 3600_000).toISOString(), streak: 0, lastItemId: null },
    ];
    const eligible = (id: string) => conceptById(id)?.topic === 'javascript';
    const due = dueConcepts(states, eligible, t0);
    assert.deepEqual(due.map((one) => one.conceptId), ['js-map', 'js-filter'], 'most overdue first, ineligible excluded');
    assert.equal(dueConcepts(states, eligible, t0, 1).length, 1, 'the cap bounds the queue');
    assert.equal(dueConcepts(states, () => true, t0, 0).length, 0);
    // Nothing due, nothing owed — a fresh learner gets ordinary practice.
    assert.deepEqual(dueConcepts([], () => true, t0), []);

    // A review state that cannot be read is not an empty one. Each record
    // sets the stage, so a write built on an empty list after a failed read
    // sent every practised concept back to its first stage.
    {
      const writes: unknown[] = [];
      const query = { select: () => query, eq: () => query, then: (done: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'down' } }).then(done) };
      const database = { from: () => query, rpc: async (_name: string, args: unknown) => { writes.push(args); return { data: null, error: null }; } } as never;
      const read = await loadReviewStates(database, 'review-reader', 'webdev');
      assert.equal(read, null, 'an unreadable review state is reported as unreadable');
      await recordConceptReviews(database, {
        userId: 'review-reader', subject: 'webdev', eventId: 'event-1',
        items: [{ itemId: 'map-1', category: 'javascript', tags: ['map'], correct: true, kind: 'independent' }],
      }, read, t0);
      assert.deepEqual(writes, [], 'nothing is recorded over states that could not be read');
      await recordConceptReviews(database, {
        userId: 'review-reader', subject: 'webdev', eventId: 'event-2',
        items: [{ itemId: 'map-1', category: 'javascript', tags: ['map'], correct: true, kind: 'independent' }],
      }, [], t0);
      assert.equal(writes.length, 1, 'a learner with no states yet still records the first review');

      const attempts: Array<{ name: string; args: Record<string, unknown> }> = [];
      const input = {
        userId: 'review-reader', subject: 'webdev' as const, eventId: 'event-3',
        items: [{ itemId: 'map-1', category: 'javascript', tags: ['map'], correct: true, kind: 'independent' as const }],
      };
      const racing = { rpc: async (name: string, args: Record<string, unknown>) => {
        attempts.push({ name, args });
        if (attempts.length === 1) return { data: { state: 'stale', reviews: 3, stage: 2, dueAt: null, streak: 2, lastItemId: 'other' }, error: null };
        return { data: { applied: true }, error: null };
      } } as never;
      await recordConceptReviews(racing, input, [], t0);
      assert.deepEqual(attempts.map(({ name, args }) => [name, args.p_expected_reviews, args.p_stage, args.p_streak]), [
        ['record_concept_review_v2', 0, 1, 1], ['record_concept_review_v2', 3, 3, 3],
      ], 'a raced review recomputes the pure transition against the newer row');
      assert.equal(attempts[0].args.p_event_id, attempts[1].args.p_event_id, 'the retry uses the same receipt');

      attempts.length = 0;
      const before072 = { rpc: async (name: string, args: Record<string, unknown>) => {
        attempts.push({ name, args });
        return name.endsWith('_v2') ? { error: { code: 'PGRST202' } } : { data: { applied: true }, error: null };
      } } as never;
      await recordConceptReviews(before072, input, [], t0);
      assert.deepEqual(attempts.map(({ name }) => name), ['record_concept_review_v2', 'record_concept_review']);
      assert.equal('p_expected_reviews' in attempts[1].args, false, 'the compatibility call uses the original signature');
    }

    // A due concept must reach the session, not merely be preferred in a list
    // the ranking is free to re-sort. It was: the handler built a due-first
    // pool and handed it to selectPersonalizedReview, which sorts by its own
    // total order, so the ordering was discarded and a learner told two
    // concepts were due got a session containing neither. The two assertions
    // below are the regression and the fix, side by side.
    {
      const q = (id: string, category: string, tags: string[], importance = 5) =>
        ({
          id, category, tags, difficulty: 2, importance, introduction: '', question: id,
          options: ['a', 'b'], correctAnswer: 0, explanation: '',
        }) as unknown as Question;
      // Two questions per due concept, plus filler the ranking scores higher
      // (weak category, high importance) so preference alone loses.
      const duePool = [
        q('map-1', 'javascript', ['map']), q('map-2', 'javascript', ['map']),
        q('filter-1', 'javascript', ['filter']), q('filter-2', 'javascript', ['filter']),
      ];
      const filler = Array.from({ length: 12 }, (_, i) => q(`filler-${i}`, 'weak', ['Terminology'], 10));
      const dueOrder = ['js-map', 'js-filter'];
      const concept = (question: Question) =>
        question.tags.includes('map') ? 'js-map' : question.tags.includes('filter') ? 'js-filter' : null;
      const dueIdSet = new Set(duePool.map((one) => one.id));

      // The regression: ordering the input does nothing.
      const ordered = selectPersonalizedReview(
        [...duePool, ...filler],
        [{ category: 'weak', total_correct: 0, total_questions: 20 }],
        [],
        10,
        t0,
      );
      assert.equal(
        ordered.questions.filter((one) => dueIdSet.has(one.id)).length,
        0,
        'the ranking discards input order, which is why reserved slots are the only thing that works',
      );

      // The fix: slots are taken out of the count before the ranking runs.
      const count = 10;
      const limit = Math.min(duePool.length, Math.max(0, Math.min(count - 1, Math.round(count * DUE_SHARE))));
      const taken = selectDueItems(duePool, dueOrder, concept, new Set(['map-1']), limit);
      assert.equal(taken.length, 4, 'four due items fill four of the six reserved slots');
      assert.equal(taken[0].id, 'map-2', 'the item just used for a concept goes last within it');
      assert.deepEqual(
        taken.slice(0, 2).map(concept),
        ['js-map', 'js-filter'],
        'round-robin, so several due concepts are covered before any is asked twice',
      );
      assert.equal(new Set(taken.map((one) => one.id)).size, taken.length, 'no item twice');

      const rest = selectPersonalizedReview(
        filler,
        [{ category: 'weak', total_correct: 0, total_questions: 20 }],
        [],
        count - taken.length,
        t0,
      );
      const session = [...taken, ...rest.questions].slice(0, count);
      assert.equal(session.length, count, 'the session is still the size the learner asked for');
      assert.equal(
        session.filter((one) => dueIdSet.has(one.id)).length,
        4,
        'every due item reaches the session',
      );
      assert.ok(session.some((one) => !dueIdSet.has(one.id)), 'a review is never only a drill');

      // One due concept must not take the whole session.
      const oneConcept = selectDueItems(
        [q('map-1', 'javascript', ['map']), q('map-2', 'javascript', ['map'])],
        ['js-map'], concept, new Set(), 6,
      );
      assert.equal(oneConcept.length, 2, 'a concept contributes only the items it has');
      assert.deepEqual(selectDueItems(duePool, dueOrder, concept, new Set(), 0), [], 'no slots, no items');
      assert.deepEqual(selectDueItems([], dueOrder, concept, new Set(), 6), [], 'nothing due, nothing reserved');
    }

    // Hashed asset filenames are what make a long cache safe: a new build is a
    // new URL, so an old URL can be cached forever. Production was serving them
    // `max-age=0, must-revalidate` instead — a round trip per chunk on every
    // visit, for files that cannot change. The entry documents are the opposite
    // case and must stay revalidated, or a deploy would never reach anyone. A
    // URL with no file behind it is the third case: it answers 404 and no cache
    // keeps it (HARDEN).
    vercelRoutingContracts();

  // The app ships one dictionary, English, and it must not look truncated.
  {
    const source = readFileSync(join(process.cwd(), 'client/src/i18n/translations.ts'), 'utf8');
    const en = new Set((source.match(/^ {2}'[^']+':/gm) ?? []).map((line) => line.trim().slice(1, -2)));
    assert.ok(en.size > 1500, `the English dictionary looks truncated: ${en.size} keys`);
  }

  // The pre-paint bootstrap has to run before anything that can block it.
    // A pending stylesheet suspends every script after it, so a webfont link
    // above this one leaves the page in the default theme until a third-party
    // host answers — verified in a browser: with fonts.googleapis.com
    // unreachable and the link first, the theme was never applied at all.
    {
      const html = readFileSync(join(process.cwd(), 'client', 'index.html'), 'utf8');
      const bootstrap = html.indexOf("devquiz:color-mode");
      assert.ok(bootstrap > 0, 'index.html must set the colour mode before first paint');
      assert.ok(
        html.includes("root.lang = 'en'"),
        'index.html fixes English before first paint',
      );
      assert.ok(!html.includes('devquiz.lang') && !html.includes('navigator.language'), 'obsolete preferences never change the document language');
      const firstBlocking = html.search(/<link[^>]+rel="stylesheet"/);
      if (firstBlocking >= 0) {
        assert.ok(
          bootstrap < firstBlocking,
          'the pre-paint bootstrap must come before any stylesheet link; a pending stylesheet blocks every script after it',
        );
      }
    }

    // Interleaving: bounded runs, no duplicates, focused block for new material.
    const item = (id: string, tags: string[], format?: string) =>
      ({ id, category: 'javascript', tags, format });
    const mixable = [
      item('m1', ['map']), item('m2', ['map']), item('m3', ['map']), item('m4', ['map']),
      item('f1', ['filter']), item('f2', ['filter']), item('f3', ['filter']), item('f4', ['filter']),
      item('r1', ['reduce']), item('r2', ['reduce']), item('r3', ['reduce']), item('r4', ['reduce']),
    ];
    const practised = { 'js-map': 9, 'js-filter': 9, 'js-reduce': 9 };
    const arranged = arrangePractice({ items: mixable, practised });
    assert.equal(arranged.items.length, mixable.length, 'every item is placed exactly once');
    assert.deepEqual(arrangementProblems(arranged.items), [], 'no duplicates and no long runs');
    assert.equal(arranged.mixed, true);
    assert.deepEqual(arranged.contrasted, ['js-filter', 'js-map', 'js-reduce']);
    // Deterministic: the same input and seed always give the same order.
    assert.deepEqual(
      arrangePractice({ items: mixable, practised }).items.map((one) => one.id),
      arranged.items.map((one) => one.id),
    );
    // Not so mechanical that the sequence itself is a hint: an A-B-A-B-A-B
    // arrangement of three concepts would never repeat a concept at all.
    const conceptSequence = arranged.items.map((one) => conceptOf(one));
    assert.ok(
      conceptSequence.some((concept, i) => i > 0 && concept === conceptSequence[i - 1]),
      'runs of two are used, so the order is not a strict rotation',
    );

    // A concept the learner has barely met is taught in a block before it is
    // mixed with anything.
    const fresh = arrangePractice({ items: mixable, practised: { 'js-map': 9, 'js-filter': 9, 'js-reduce': 0 } });
    const reduceRun = fresh.items.slice(0, 4).map((one) => conceptOf(one));
    assert.deepEqual(reduceRun, ['js-reduce', 'js-reduce', 'js-reduce', 'js-reduce'], 'new material comes as a block');

    // One eligible concept is ordinary focused practice, not a fake mix.
    const single = arrangePractice({ items: mixable.slice(0, 4), practised });
    assert.equal(single.mixed, false);
    assert.deepEqual(single.contrasted, []);

    // Items with no concept never block a mix and are never dropped.
    const withLoose = arrangePractice({ items: [...mixable, item('x1', ['Hoisting'])], practised });
    assert.equal(withLoose.items.length, mixable.length + 1);
    assert.equal(withLoose.mixed, true);

    // Contrast is only ever within a group: nothing pairs Flexbox with reduce.
    assert.equal(areContrastable('css-flexbox', 'css-grid'), true);
    assert.equal(areContrastable('css-flexbox', 'js-reduce'), false);
    assert.equal(areContrastable('js-map', 'js-map'), false);

    // Session sizing stays inside something a person will finish.
    assert.equal(sessionSize(null), 8);
    assert.ok(sessionSize(5) >= 4 && sessionSize(300) <= 20);
  }

  // ── challenge runs (migration 037) ─────────────────────────────────────
  // The queue is chosen server-side from what the learner can already open.
  // Shaping it — a count, a track, a shuffle, a moment — only reorders or
  // trims that set; it never reaches past the tier gate, and a shuffled run
  // is a permutation of the sequential one.
  {
    const base = { minutes: 20, topic: null, plan: 'free' as const, passed: new Set<string>(), due: new Set<string>() };
    const sequential = buildQueue({ ...base, count: 5, order: 'sequential' });
    assert.equal(sequential.length, 5, 'a run sized by count holds that many challenges');
    assert.deepEqual(buildQueue({ ...base, count: 5, order: 'sequential' }), sequential, 'sequential runs are deterministic');
    const pool = buildQueue({ ...base, count: 20, order: 'sequential' });
    const reversed = <T>(list: T[]) => [...list].reverse();
    const shuffled = buildQueue({ ...base, count: 20, order: 'random', shuffle: reversed });
    assert.deepEqual([...shuffled].sort(), [...buildQueue({ ...base, count: 20, order: 'random', shuffle: reversed })].sort());
    assert.ok(shuffled.every((id) => codingTaskById(id)), 'a shuffled run holds only issuable tasks');
    assert.notDeepEqual(shuffled, pool, 'the shuffle is applied');
    const react = buildQueue({ ...base, count: 3, topic: 'react', order: 'sequential' });
    assert.ok(react.length === 3 && react.every((id) => codingTaskById(id)?.track === 'react'), 'three from React means three React challenges');
    assert.ok(buildQueue({ ...base, count: 3, topic: 'react', order: 'random' }).every((id) => codingTaskById(id)?.track === 'react'), 'a shuffled track run stays inside the track');
    for (const id of [...sequential, ...react]) {
      const task = codingTaskById(id)!;
      assert.ok(task.tier <= 2, 'a fresh learner is only ever offered the open tiers');
    }
    assert.equal(buildQueue({ ...base, count: 200, order: 'sequential' }).length, 20, 'a count is capped');
    assert.ok(buildQueue({ ...base, order: 'sequential' }).length >= 1, 'a run sized by minutes still offers something');
    // The plan is a gate too: a free account's run holds only what the free
    // plan opens, or the run stops at the first Premium challenge with a 402.
    for (const topic of [null, ...CODING_SECTION_TRACKS]) {
      const free = buildQueue({ ...base, count: 10, topic, order: 'sequential' });
      assert.ok(free.length > 0 && free.every(isFreeCodingTask), `a free ${topic ?? 'mixed'} run holds only free challenges: ${free.filter((id) => !isFreeCodingTask(id)).join(', ')}`);
    }
    const premiumRun = buildQueue({ ...base, plan: 'premium', count: 10, topic: 'algorithms', order: 'sequential' });
    assert.ok(premiumRun.some((id) => !isFreeCodingTask(id)), 'Premium opens the rest of the catalogue to a run');

    const now = Date.parse('2026-09-18T12:00:00Z');
    assert.deepEqual(parseScheduledFor(undefined, now), { at: null }, 'no moment means now');
    assert.deepEqual(parseScheduledFor('2026-09-18T11:00:00Z', now), { at: null }, 'a moment already past means now');
    assert.deepEqual(parseScheduledFor('2026-09-18T12:00:30Z', now), { at: null }, 'a moment within the next minute means now');
    const later = parseScheduledFor('2026-09-20T18:00:00Z', now);
    assert.ok('at' in later && later.at?.toISOString() === '2026-09-20T18:00:00.000Z', 'a future moment is kept');
    assert.ok('error' in parseScheduledFor('2027-01-01T00:00:00Z', now), 'a moment past the horizon is refused');
    assert.ok('error' in parseScheduledFor('not a time', now) && 'error' in parseScheduledFor(12345, now), 'a non-time is refused');

    // CODE-10: Skip told the learner a task "is part of your level, so it
    // will come back" for every task with a level number, 392 of which no
    // Learn level issues. Only a task in its level's quota comes back.
    const inQuota = levelCodingTasks('javascript', 1)[0];
    assert.ok(inQuota && skipPostpones(inQuota.id), `${inQuota?.id}: a task its level issues comes back after a skip`);
    const outside = codingTaskById('js-count-multiples');
    assert.ok(outside && outside.level > 0 && !levelCodingTasks(outside.topic, outside.level).some((one) => one.id === outside.id), 'js-count-multiples has a level number but no level issues it');
    assert.equal(skipPostpones('js-count-multiples'), false, 'a task outside every quota is optional');
    // A DSA task its level issues comes back; an Algorithms task with no
    // Learn level stays optional.
    assert.equal(skipPostpones('alg-dsa-reverse-in-place'), true, 'a DSA task DSA level 3 issues comes back');
    assert.equal(skipPostpones('alg-dsa-linear-search'), true, 'DSA level 10 now issues linear search');
    assert.equal(skipPostpones('alg-easy2-count-jewels'), false, 'an Algorithms task is optional');

    // C1-8: ten cleared JavaScript Learn levels open tier 3 on the task page
    // (handleCodingTask reads them from the roadmap row). A practice run and
    // a skip's suggestion passed 0, so a learner who had them saw tier 3 open
    // there and never met it in a run. Both now read the same count. The
    // learner has passed every JavaScript task of tiers 1 and 2 but one, so
    // the sweep that also opens tier 3 is not complete.
    const jsTiers = CODING_SUMMARIES.filter((task) => task.track === 'javascript' && !evolvingStage(task.id));
    const left = jsTiers.find((task) => task.tier === 2)!;
    const swept = new Set(jsTiers.filter((task) => task.tier <= 2 && task.id !== left.id).map((task) => task.id));
    const tierOf = (id: string) => codingTaskById(id)!.tier;
    const laddered = { ...base, plan: 'premium' as const, topic: 'javascript', passed: swept, count: 5, order: 'sequential' as const };
    assert.deepEqual(buildQueue(laddered), [left.id], 'without the Learn levels only the last tier-2 task is open');
    const opened = buildQueue({ ...laddered, javascriptLevelsCleared: CODING_FOUNDATION_LEVELS });
    assert.ok(opened.length === 5 && opened.includes(left.id) && opened.filter((id) => id !== left.id).every((id) => tierOf(id) === 3), `cleared Learn levels open tier 3 to a run: ${opened.join(', ')}`);
    assert.ok(opened.every((id) => tierLockReason({ track: 'javascript', tier: tierOf(id), progress: { passed: swept }, tasks: CODING_SUMMARIES, javascriptLevelsCleared: CODING_FOUNDATION_LEVELS }) === null), 'a run offers what the task page opens');
    // Through the handlers, against a stand-in database whose roadmap row has
    // the ten levels cleared. The plan is Premium for this request.
    const learner = 'practice-learner-0001';
    const practiceDb = (passedIds: ReadonlySet<string> = swept) => {
      const levels = Object.fromEntries(Array.from({ length: CODING_FOUNDATION_LEVELS }, (_, index) => [String(index + 1), { passed: true }]));
      const started: Record<string, unknown>[] = [];
      const from = (table: string) => {
        let columns = '';
        const chain = {
          select: (asked: string) => { columns = asked; return chain; }, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
          // As PostgREST answers: the whole blob for `data`, the levels alone
          // for the JSON path the coding handlers ask for (#587 item 9).
          maybeSingle: () => Promise.resolve({ data: table === 'roadmap_progress' ? (columns === 'levels:data->javascript->levels' ? { levels } : { data: { javascript: { levels } } }) : null, error: null }),
          then: (resolve: (value: unknown) => unknown) => resolve({ data: table === 'coding_progress' ? [...passedIds].map((task_id) => ({ task_id, status: 'passed' })) : [], error: null }),
        };
        return chain;
      };
      const rpc = (name: string, args: Record<string, unknown>) => {
        if (name === 'start_practice_session_v2') started.push(args);
        return Promise.resolve({ data: name === 'start_practice_session_v2' ? 'active' : null, error: null });
      };
      return { client: { from, rpc }, started };
    };
    const asPremium = async (handler: typeof handlePracticeSession, body: Record<string, unknown>, db: ReturnType<typeof practiceDb>) => {
      const req = { method: 'POST', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '198.51.100.81' }, query: {}, body: { ...body, user_id: learner } };
      const res = mockResponse();
      await withRequestContext(req as never, res as never, async () => {
        await requestMemo(`tier:${learner}`, async () => 'premium');
        await handler(req as never, res as never, db.client as never);
      });
      return res;
    };
    const runDb = practiceDb();
    const run = await asPremium(handlePracticeSession, { count: 5, order: 'sequential', topic: 'javascript' }, runDb);
    assert.equal(run.statusCode, 200, JSON.stringify(run.body));
    assert.deepEqual(runDb.started[0]?.p_queue, opened, 'the run the handler starts holds the tier-3 tasks the Learn levels opened');
    const skipped = await asPremium(handleCodingSkip, { taskId: left.id, reason: 'too-hard' }, practiceDb());
    assert.equal(skipped.statusCode, 200, JSON.stringify(skipped.body));
    const next = (skipped.body as { next?: string | null }).next;
    assert.ok(next && tierOf(next) === 3, `a skip suggests a tier-3 task the Learn levels opened, not nothing: ${next}`);
    // A skip note is cut to the 280 characters coding_skips holds by code
    // point: cut by UTF-16 unit, an emoji at the edge left half of itself.
    {
      const notes: unknown[] = [];
      const noteDb = practiceDb();
      const recording = { from: noteDb.client.from, rpc: (name: string, args: Record<string, unknown>) => {
        if (name === 'record_coding_skip') notes.push(args.p_note);
        return noteDb.client.rpc(name, args);
      } };
      const noted = await asPremium(handleCodingSkip, { taskId: left.id, reason: 'unclear', note: `${'a'.repeat(279)}\u{1F600}\u{1F600}` }, { ...noteDb, client: recording as never });
      assert.equal(noted.statusCode, 200, JSON.stringify(noted.body));
      const kept = String(notes[0]);
      assert.equal(Buffer.from(kept, 'utf8').toString('utf8'), kept, 'the note sent to record_coding_skip splits no character');
      assert.equal(Array.from(kept).length, 280, 'the note keeps 280 characters');
    }

    // A run's place is a Postgres integer: a number past it failed the
    // routine's call with a 500. The routine clamps the place to the queue,
    // so the handler sends one the column can hold.
    {
      const moves: unknown[] = [];
      const advanceDb = {
        from: practiceDb().client.from,
        rpc: (name: string, args: Record<string, unknown>) => {
          if (name === 'advance_practice_session') moves.push(args.p_position);
          return Promise.resolve({ data: null, error: null });
        },
      };
      for (const position of [3, 1e12, -5]) {
        const req = { method: 'PUT', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '198.51.100.82' }, query: {}, body: { sessionId: 'practice-session-0001', position, user_id: learner } };
        const res = mockResponse();
        await handlePracticeSession(req as never, res as never, advanceDb as never);
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      }
      assert.deepEqual(moves, [3, 40, 0], 'a place is sent within what a run can hold');
      // The run is read back after the move. A read that fails is an error,
      // not a run that does not exist.
      const unreadable = {
        rpc: advanceDb.rpc,
        from: () => {
          const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) };
          return chain;
        },
      };
      const req = { method: 'PUT', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '198.51.100.82' }, query: {}, body: { sessionId: 'practice-session-0001', position: 1, user_id: learner } };
      const res = mockResponse();
      await handlePracticeSession(req as never, res as never, unreadable as never);
      assert.equal(res.statusCode, 500, `a run that could not be read back is not answered as no run: ${JSON.stringify(res.body)}`);
    }
    // A run is built from what the learner has not passed. Passed tasks that
    // could not be read were an empty set, and the run offered every task the
    // learner had already done as new work.
    {
      const blind = practiceDb();
      const from = (table: string) => {
        const chain = blind.client.from(table) as Record<string, unknown>;
        return table === 'coding_progress'
          ? { ...chain, select: () => blinded, eq: () => blinded }
          : chain;
      };
      const blinded = { eq: () => blinded, then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { code: '57014', message: 'statement timeout' } }) };
      const refused = await asPremium(handlePracticeSession, { count: 5, order: 'sequential', topic: 'javascript' }, { ...blind, client: { ...blind.client, from } } as never);
      assert.equal(refused.statusCode, 503, `a run is not built without the passed tasks: ${JSON.stringify(refused.body)}`);
      assert.equal(blind.started.length, 0, 'no run starts');
    }

    // The task page agrees: it opens the tier-3 task the run holds.
    const taskPage = async (id: string, db: ReturnType<typeof practiceDb>) => {
      const req = { method: 'GET', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '198.51.100.81' }, query: { resource: 'coding-task', id, user_id: learner } };
      const res = mockResponse();
      await withRequestContext(req as never, res as never, async () => {
        await requestMemo(`tier:${learner}`, async () => 'premium');
        await handleCodingTask(req as never, res as never, db.client as never);
      });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      return res.body as { locked?: string | null; session?: string | null };
    };
    assert.equal((await taskPage(opened.find((id) => tierOf(id) === 3)!, practiceDb())).locked, null, 'the task page opens the tier-3 task the run holds');

    // Owner decision 7 (9 October 2026): the ten JavaScript Learn levels open
    // tier 3 of JavaScript only. `tierUnlocked` asked for them whatever the
    // track, so they opened TypeScript's and React's tier 3 too. The same
    // learner, with TypeScript or React passed but for one task of tiers 1
    // and 2, finds that tier 3 locked, with the reason that names the sweep
    // alone, in a run, in a skip's suggestion and on the task page. The
    // browser asks the same rule (client/tests/coding-learn-unlock.test.tsx).
    for (const track of ['typescript', 'react'] as const) {
      const tiers = CODING_SUMMARIES.filter((task) => task.track === track && !evolvingStage(task.id));
      const last = tiers.find((task) => task.tier === 2)!;
      const almost = new Set(tiers.filter((task) => task.tier <= 2 && task.id !== last.id).map((task) => task.id));
      const ladder = { track, tier: 3 as const, progress: { passed: almost }, tasks: CODING_SUMMARIES, javascriptLevelsCleared: CODING_FOUNDATION_LEVELS };
      assert.equal(tierUnlocked(ladder), false, `${track}: the JavaScript Learn levels leave tier 3 locked`);
      assert.equal(tierLockReason(ladder), 'sweep', `${track}: the lock names the sweep alone, not the Learn levels`);
      assert.equal(tierUnlocked({ ...ladder, progress: { passed: new Set([...almost, last.id]) }, javascriptLevelsCleared: 0 }), true, `${track}: its own sweep opens tier 3`);
      assert.deepEqual(buildQueue({ ...laddered, topic: track, passed: almost, javascriptLevelsCleared: CODING_FOUNDATION_LEVELS }), [last.id], `${track}: a run offers no tier 3 for the Learn levels`);
      const trackDb = practiceDb(almost);
      const trackRun = await asPremium(handlePracticeSession, { count: 5, order: 'sequential', topic: track }, trackDb);
      assert.equal(trackRun.statusCode, 200, JSON.stringify(trackRun.body));
      assert.deepEqual(trackDb.started[0]?.p_queue, [last.id], `${track}: the run the handler starts holds no tier 3`);
      const trackSkip = await asPremium(handleCodingSkip, { taskId: last.id, reason: 'too-hard' }, practiceDb(almost));
      assert.equal(trackSkip.statusCode, 200, JSON.stringify(trackSkip.body));
      assert.equal((trackSkip.body as { next?: string | null }).next, null, `${track}: a skip suggests no tier-3 task`);
      const page = await taskPage(tiers.find((task) => task.tier === 3)!.id, practiceDb(almost));
      assert.equal(page.locked, 'sweep', `${track}: the task page locks tier 3 and says the sweep opens it`);
      assert.equal(page.session, null, `${track}: and seals no session for it`);
    }
    assert.equal(tierLockReason({ track: 'javascript', tier: 3, progress: { passed: new Set() }, tasks: CODING_SUMMARIES, javascriptLevelsCleared: 0 }), 'foundations', 'JavaScript tier 3 names both ways in');

    // Audit C3-18: the next challenge after a skip came from the top of the
    // track, so skipping js-count-multiples offered js-digit-sum, a task
    // before it. It is the next open one after the skipped task, wrapping.
    const jsSection = CODING_SUMMARIES.filter((one) => one.track === 'javascript');
    const skippedAt = jsSection.findIndex((one) => one.id === 'js-count-multiples');
    const offered = nextAfterSkip('js-count-multiples', new Set(), 'premium');
    assert.ok(offered && offered !== 'js-count-multiples', 'a skip offers another challenge');
    assert.ok(jsSection.findIndex((one) => one.id === offered) > skippedAt, `the offer comes after the skipped task, not ${offered}`);
    assert.ok(offered !== 'js-digit-sum', 'the offer is not a task the learner walked past');
    const wrapped = nextAfterSkip('js-count-multiples', new Set(jsSection.slice(skippedAt + 1).map((one) => one.id)), 'premium');
    assert.ok(wrapped && jsSection.findIndex((one) => one.id === wrapped) < skippedAt, `with every later task passed, the offer wraps to the start (${wrapped})`);
    assert.equal(nextAfterSkip('js-count-multiples', new Set(jsSection.map((one) => one.id).filter((id) => id !== 'js-count-multiples')), 'premium'), null, 'nothing left to offer is said as nothing');
  }

  // ── the payment webhook believes the order, not the event ───────────────
  {
    const awaiting = { state: 'awaiting_payment', totalMinor: 2490, currency: 'EUR' };
    const paid = { ...awaiting, state: 'paid' };
    assert.deepEqual(webhookDecision({ type: 'payment.succeeded', amountMinor: 2490, currency: 'EUR' }, awaiting), { action: 'paid' });
    assert.equal(webhookDecision({ type: 'payment.succeeded' }, awaiting).action, 'refuse', 'an unreadable amount is refused, not waved through');
    assert.equal(webhookDecision({ type: 'payment.succeeded', amountMinor: 2490 }, awaiting).action, 'refuse', 'a missing currency is refused');
    assert.equal(webhookDecision({ type: 'payment.succeeded', amountMinor: 1, currency: 'EUR' }, awaiting).action, 'refuse', 'a forged amount is refused');
    assert.equal(webhookDecision({ type: 'payment.succeeded', amountMinor: 2490, currency: 'CZK' }, awaiting).action, 'refuse', 'another currency is refused');
    assert.equal(webhookDecision({ type: 'payment.succeeded', amountMinor: 0, currency: 'EUR' }, { ...awaiting, totalMinor: null }).action, 'refuse', 'an order with no cash total cannot be paid for');
    assert.deepEqual(webhookDecision({ type: 'payment.failed' }, awaiting), { action: 'cancel' });
    assert.deepEqual(webhookDecision({ type: 'payment.failed' }, paid), { action: 'ignore', reason: 'stale' }, 'a late failure never cancels a paid order');
    assert.deepEqual(webhookDecision({ type: 'checkout.expired' }, paid), { action: 'ignore', reason: 'stale' });
    assert.deepEqual(webhookDecision({ type: 'payment.refunded' }, paid), { action: 'cancel' }, 'a refund may cancel a paid order');
    assert.deepEqual(webhookDecision({ type: 'payment.refunded' }, { ...paid, state: 'shipped' }), { action: 'ignore', reason: 'stale' });
    assert.deepEqual(webhookDecision({ type: 'something.else' }, awaiting), { action: 'ignore', reason: 'unhandled' });
  }

  // ── the payment webhook itself, against a stand-in database ─────────────
  {
    const realEnv = { secret: process.env.PAYMENT_WEBHOOK_SECRET, provider: process.env.PAYMENT_PROVIDER };
    process.env.PAYMENT_WEBHOOK_SECRET = 'contract-webhook-secret';
    process.env.PAYMENT_PROVIDER = 'contract-pay';
    const touched: string[] = [];
    let orderRow: Record<string, unknown> | null = null;
    let paidAnswer: { data: unknown; error: { code?: string; message?: string } | null } = { data: true, error: null };
    const db = {
      from: (table: string) => {
        touched.push(`from:${table}`);
        const link = { select: () => link, eq: () => link, maybeSingle: async () => ({ data: orderRow, error: null }) };
        return link;
      },
      rpc: async (fn: string) => { touched.push(`rpc:${fn}`); return fn === 'mark_merch_order_paid' ? paidAnswer : { data: true, error: null }; },
    };
    const deliver = async (body: unknown, signature: string) => {
      const res = mockResponse();
      await handlePaymentWebhook({ method: 'POST', headers: { 'x-payment-signature': signature }, query: {}, body } as never, res as never, db as never);
      return res;
    };
    try {
      // 64 characters, as long as the hex digest, but 128 bytes: the
      // constant-time comparison threw on the unequal buffers.
      const wide = await deliver({ type: 'payment.succeeded', orderId: 'order-0123456789abcdef', providerRef: 'ref' }, 'é'.repeat(64));
      assert.equal(wide.statusCode, 401, 'a signature with the digest length in characters but not in bytes is refused, not a 500');
      assert.deepEqual(touched, [], 'and nothing is read');
      // A body the provider signed but that is not a JSON object is a bad
      // event (400), not a parse error answered 500 and retried forever.
      const sign = (raw: string) => createHmac('sha256', 'contract-webhook-secret').update(raw).digest('hex');
      for (const raw of ['not json', 'null', '[1]', '7']) {
        const res = await deliver(raw, sign(raw));
        assert.equal(res.statusCode, 400, `a signed body of ${raw} answers 400`);
      }
      const nul = { type: 'payment.succeeded', orderId: 'order-0123456789abcdef', providerRef: 'ref\u0000' };
      assert.equal((await deliver(nul, sign(JSON.stringify(nul)))).statusCode, 400, 'a provider reference with U+0000 is refused before Postgres sees it');
      assert.deepEqual(touched, [], 'none of them reads the order');
      // A provider reference already recorded on another order trips the
      // unique index (23505): refused with 409 like any mismatch, not a 500.
      orderRow = { state: 'awaiting_payment', total_minor: 2490, currency: 'EUR' };
      paidAnswer = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "merch_orders_provider_ref_idx"' } };
      const reused = { type: 'payment.succeeded', orderId: 'order-0123456789abcdef', providerRef: 'pi_reused', amountMinor: 2490, currency: 'EUR' };
      const conflict = await deliver(reused, sign(JSON.stringify(reused)));
      assert.equal(conflict.statusCode, 409, 'a reused provider reference is a refusal, not a 500');
      assert.equal((conflict.body as { error: { code: string } }).error.code, 'provider_ref_conflict');
      paidAnswer = { data: true, error: null };
      const paidNow = await deliver(reused, sign(JSON.stringify(reused)));
      assert.deepEqual([paidNow.statusCode, paidNow.body], [200, { applied: true }], 'a matching event marks the order paid');
    } finally {
      if (realEnv.secret === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET; else process.env.PAYMENT_WEBHOOK_SECRET = realEnv.secret;
      if (realEnv.provider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = realEnv.provider;
    }
  }

  // ── the wallet read, against a stand-in database ────────────────────────
  {
    const failing = new Set<string>();
    const rows: Record<string, unknown> = {
      token_balances: { balance: 1300 },
      token_ledger: [],
      cosmetic_entitlements: [{ cosmetic_id: 'crown', equipped: true }],
    };
    const db = {
      rpc: async () => ({ data: null, error: null }),
      from: (table: string) => {
        const answer = () => (failing.has(table)
          ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
          : { data: rows[table] ?? null, error: null });
        const link = {
          select: () => link, eq: () => link, order: () => link, limit: () => link,
          maybeSingle: async () => answer(),
          then: <A>(resolve: (value: ReturnType<typeof answer>) => A) => resolve(answer()),
        };
        return link;
      },
    };
    const read = async () => {
      const res = mockResponse();
      await handleWallet({ method: 'GET', headers: {}, query: { op: 'wallet', user_id: 'contract-wallet-reader' } } as never, res as never, db as never);
      return res;
    };
    const ok = await read();
    assert.equal(ok.statusCode, 200);
    assert.deepEqual((ok.body as { cosmetics: unknown }).cosmetics, [{ id: 'crown', equipped: true }]);
    // A cosmetics read that failed is not an account that owns nothing: the
    // screen would offer the crown again and take it off the avatar.
    failing.add('cosmetic_entitlements');
    const broken = await read();
    assert.equal(broken.statusCode, 500, 'a failed cosmetics read is an error, not an empty list');
  }

  // ── the wallet read skips the settlements it has seen final ──────────────
  // #587, server item 7: once grant_signup_tokens has answered (the
  // `signup:<account>` event is in the ledger) and credit_referral has
  // answered a state no later call can change, a warm instance skips them for
  // that account. Every other answer, and every error, is asked again, and
  // the milestone settlement (whose report the screen shows) always runs.
  {
    const called: { fn: string; user: unknown }[] = [];
    const answers: Record<string, (user: string) => { data: unknown; error: unknown }> = {
      grant_signup_tokens: (user) => (user.endsWith('broken') ? { data: null, error: { code: '57014', message: 'timeout' } } : { data: !user.endsWith('again'), error: null }),
      credit_referral: (user) => ({ data: user.includes('waiting') ? 'waiting' : user.includes('uninvited') ? 'none' : 'already', error: null }),
    };
    const db = {
      rpc: async (fn: string, params: Record<string, unknown>) => {
        const user = String(params.p_user_id ?? params.p_invitee ?? '');
        called.push({ fn, user });
        return answers[fn]?.(user) ?? { data: null, error: null };
      },
      from: () => {
        const link = {
          select: () => link, eq: () => link, order: () => link, limit: () => link,
          maybeSingle: async () => ({ data: { balance: 0 }, error: null }),
          then: <A>(resolve: (value: { data: unknown[]; error: null }) => A) => resolve({ data: [], error: null }),
        };
        return link;
      },
    };
    const read = async (user: string) => {
      called.length = 0;
      const res = mockResponse();
      await handleWallet({ method: 'GET', headers: {}, query: { op: 'wallet', user_id: user } } as never, res as never, db as never);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      return { body: res.body as { welcome: { granted: boolean } }, fns: called.map((one) => one.fn) };
    };
    forgetWalletSettlements();
    const first = await read('contract-wallet-settled');
    assert.ok(first.fns.includes('grant_signup_tokens') && first.fns.includes('credit_referral'), `the first read settles: ${first.fns.join(', ')}`);
    assert.equal(first.body.welcome.granted, true, 'the read that granted says so');
    const second = await read('contract-wallet-settled');
    assert.ok(!second.fns.includes('grant_signup_tokens'), 'a granted welcome is not asked again on this instance');
    assert.ok(!second.fns.includes('credit_referral'), 'a settled invitation is not asked again on this instance');
    assert.ok(second.fns.includes('settle_coin_milestones'), 'the milestones still settle on every read');
    assert.equal(second.body.welcome.granted, false, 'and a later read reports nothing granted, as the routine would');
    // "Already granted" is as final as "granted now".
    await read('contract-wallet-again');
    assert.ok(!(await read('contract-wallet-again')).fns.includes('grant_signup_tokens'), 'an already-granted welcome is not asked again');
    // An error, and an invitation still waiting for a passed level, are asked again.
    await read('contract-wallet-waiting-broken');
    const retried = await read('contract-wallet-waiting-broken');
    assert.ok(retried.fns.includes('grant_signup_tokens'), 'a welcome grant that failed is asked again');
    assert.ok(retried.fns.includes('credit_referral'), 'an invitation still waiting is asked again');
    forgetWalletSettlements('contract-wallet-settled');
    assert.ok((await read('contract-wallet-settled')).fns.includes('grant_signup_tokens'), 'a forgotten account is asked again');
    // `none` is final only when record_referral could no longer bind an
    // invitation: the account is past the sign-up window (with an hour of
    // margin), or Auth reported no creation time.
    const now = Date.parse('2026-10-24T12:00:00Z');
    const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
    assert.equal(referralFinal('none', hoursAgo(1), now), false, 'a new account can still be invited');
    assert.equal(referralFinal('none', hoursAgo(48.5), now), false, 'the margin keeps the window open a little longer');
    assert.equal(referralFinal('none', hoursAgo(50), now), true, 'an account past the window cannot be invited any more');
    assert.equal(referralFinal('none', null, now), true, 'nor one Auth reported no creation time for');
    for (const status of ['already', 'credited', 'capped', 'orphaned'] as const) assert.equal(referralFinal(status, hoursAgo(1), now), true, status);
    for (const status of ['waiting', 'off', null] as const) assert.equal(referralFinal(status, hoursAgo(100), now), false, String(status));
    forgetWalletSettlements();
  }

  // ── the crown: only no op buys it ───────────────────────────────────────
  {
    const called: string[] = [];
    const db = { rpc: async (fn: string) => { called.push(fn); return { data: true, error: null }; } };
    const post = async (body: Record<string, unknown>) => {
      const res = mockResponse();
      await handleCosmetic({ method: 'POST', headers: {}, query: { op: 'cosmetic', user_id: 'contract-crown' }, body: { ...body, user_id: 'contract-crown' } } as never, res as never, db as never);
      return res;
    };
    const typo = await post({ id: 'crown', op: 'equipp' });
    assert.equal(typo.statusCode, 400, 'a misspelt op is refused');
    assert.deepEqual(called, [], 'and spends nothing');
    assert.equal((await post({ id: 'crown', op: 'equip' })).statusCode, 200);
    assert.deepEqual(called, ['equip_cosmetic']);
    called.length = 0;
    assert.deepEqual((await post({ id: 'crown' })).body, { owned: true, alreadyOwned: false }, 'no op buys the crown, as the browser asks');
    assert.deepEqual(called, ['purchase_cosmetic']);
  }

  // ── the crown bought from two tabs at once ──────────────────────────────
  {
    // The second purchase waits on the wallet lock, then sees the balance the
    // first one spent and raises insufficient_tokens. The crown is owned.
    let owned: { cosmetic_id: string } | null = { cosmetic_id: 'crown' };
    const db = {
      rpc: async () => ({ data: null, error: { code: 'P0001', message: 'insufficient_tokens' } }),
      from: (table: string) => {
        assert.equal(table, 'cosmetic_entitlements');
        const link = { select: () => link, eq: () => link, maybeSingle: async () => ({ data: owned, error: null }) };
        return link;
      },
    };
    const post = async () => {
      const res = mockResponse();
      await handleCosmetic({ method: 'POST', headers: {}, query: { op: 'cosmetic', user_id: 'contract-crown-race' }, body: { id: 'crown', user_id: 'contract-crown-race' } } as never, res as never, db as never);
      return res;
    };
    const raced = await post();
    assert.equal(raced.statusCode, 200, 'a purchase that lost the race to the same account is not "not enough coins"');
    assert.deepEqual(raced.body, { owned: true, alreadyOwned: true });
    owned = null;
    const poor = await post();
    assert.equal(poor.statusCode, 409, 'a wallet that cannot pay and owns nothing still answers insufficient_tokens');
    assert.equal((poor.body as { error: { code: string } }).error.code, 'insufficient_tokens');
  }

  // ── lesson figures (#183) ───────────────────────────────────────────────
  {
    assert.deepEqual(
      validateFigures((topic) => (isRoadmapTopic(topic) ? topicLevelCount(topic) : 0)),
      [],
      'every figure must name a real level and carry its content in words',
    );
    assert.ok(LESSON_FIGURES.length >= 15, 'the authored coverage should not silently shrink');
    // NaN fails no comparison and 1.5 passes both, so a level or a mark like
    // that matched nothing and the figure or its mark never showed, unreported.
    {
      const levelCount = (topic: string) => (isRoadmapTopic(topic) ? topicLevelCount(topic) : 0);
      const base = LESSON_FIGURES[0];
      const trace = (index: number): typeof base => ({
        ...base, id: `synthetic-trace-${index}`,
        body: { kind: 'steps', frames: [{ cells: ['1', '2'], marks: [{ index, role: 'here' }], note: 'One.' }, { cells: ['1', '2'], note: 'Two.' }] },
      });
      const table = (row: number): typeof base => ({
        ...base, id: `synthetic-table-${row}`,
        body: { kind: 'table', columns: ['a'], rows: [['1'], ['2']], marks: [{ row, role: 'here' }] },
      });
      for (const level of [Number.NaN, 1.5]) {
        assert.equal(validateFigures(levelCount, [{ ...base, level }]).length, 1, `level ${level} is refused`);
      }
      for (const index of [Number.NaN, 0.5]) {
        assert.equal(validateFigures(levelCount, [trace(index)]).length, 1, `trace mark ${index} is refused`);
        assert.equal(validateFigures(levelCount, [table(index)]).length, 1, `table mark ${index} is refused`);
      }
      assert.deepEqual(validateFigures(levelCount, [trace(1), table(1)]), [], 'whole positions in range pass');
    }

    // A figure only reaches a level it was authored for.
    for (const figure of LESSON_FIGURES) {
      assert.ok(
        figuresFor(figure.topic, figure.level, 'after').some((one) => one.id === figure.id),
        `${figure.id} is not returned for its own level`,
      );
      assert.deepEqual(figuresFor(figure.topic, figure.level + 100), [], 'no figure leaks to another level');
    }

    // A figure held until after the assessment is not shown before it. None of
    // the authored figures is marked today, so the rule is exercised against a
    // synthetic one: the mechanism has to work the first time an author uses it.
    const held = { ...LESSON_FIGURES[0], id: 'synthetic-held', afterSubmission: true };
    const pair = [LESSON_FIGURES[0], held];
    assert.deepEqual(
      visibleFigures(pair, 'before').map((one) => one.id),
      [LESSON_FIGURES[0].id],
      'a held figure is not shown before submission',
    );
    assert.deepEqual(visibleFigures(pair, 'after').map((one) => one.id), pair.map((one) => one.id));

    // Figures cover the areas the curriculum actually needs them for, rather
    // than clustering in whichever topic was easiest to author.
    const topics = new Set(LESSON_FIGURES.map((one) => one.topic));
    for (const topic of ['html', 'css', 'javascript', 'react', 'dsa', 'databases', 'general']) {
      assert.ok(topics.has(topic), `no figure covers ${topic}`);
    }
  }

  // ── level intros ────────────────────────────────────────────────────────
  // A level opens with the intro at its own index. When a curriculum changed
  // its levels and the intros stayed, every level after the first change
  // opened with another level's text (CSS "Flexbox" with the box model), so
  // each served topic carries exactly one intro per level.
  for (const topic of SUBJECT_SCOPE_CATALOG.webdev.topics) {
    assert.ok(isRoadmapTopic(topic), `${topic} is a Learn topic`);
    assert.equal(
      LEVEL_INTROS[topic as keyof typeof LEVEL_INTROS]?.length,
      topicLevelCount(topic),
      `${topic}: one intro per level`,
    );
  }

  await auditGateContracts();
  await tierContracts();
  billingContracts();
  launchOfferContracts();
  publicCopyContracts();
  await retiredSupportContracts();
  coinsContracts();
  await referralContracts();
  await merchContracts();
  erasureContracts();
  await voucherContracts();
  await qotdContracts();
  await quizSubmitScopeContracts();
  await strayLangContracts();
  englishOnlyContracts();
  await guestChallengeLimitContracts();
  await challengeSelectionContracts();
  await challengeAnswerClaimContracts();
  await challengeStrikeContracts();
  await dailyIntegrityContracts();
  await dailyOwnerContracts();
  seededShuffleContracts();
  await quizDifficultyContracts();
  await dailySwitchContracts();
  await webdevBankContracts();
  await leaderboardVisibilityContracts();
  await learnLessonContracts();
  await codingBriefContracts();
  learnCodeTopicsContracts();
  await dsaAdvancedContracts();
  consentContracts();
  classroomRevealContracts();
  monthlyXpContracts();
  await identityContracts();
  await productCleanupContracts();

  console.log('Launch contracts passed: product identity, scope, token confidentiality, stable attempts, fairness-neutral rewards, rate limiting, health, 12-function budget, the free tier and Premium, billing, the launch price, the public Premium copy, the retired support settings, the progression graph, failure hints, retired sections, curation claims, the content-audit gate, spaced practice, interleaving, challenge runs, lesson figures, an unconfigured shop, coins, invitations, merchandise through Spreadshop, one erasure routine, Premium vouchers, the question of the day, and the webdev-bank contract BoardlessAI imports.');
}

/** Cookie consent and the privacy policy (round 4, owner decisions 2 and 4).
 * PostHog loads only behind analytics consent, no marketing tag ships, and
 * the retention the policy states is the one the database runs. */
function consentContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const main = read('client/src/main.tsx');
  const analytics = read('client/src/lib/analytics.ts');
  // posthog-js comes in through lib/posthogClient.ts alone, which the
  // consent gate imports dynamically.
  assert.doesNotMatch(main, /posthog-js|posthogClient/, 'main.tsx must not import PostHog');
  assert.doesNotMatch(analytics, /^import (?!type)[^;]*'posthog-js'/m, 'analytics.ts must not import posthog-js at run time');
  assert.equal(analytics.match(/import\('\.\/posthogClient'\)/g)?.length, 1, 'one dynamic import of the PostHog client');
  assert.doesNotMatch(analytics, /^import [^;]*'\.\/posthogClient'/m, 'the PostHog client is never imported statically');
  assert.match(read('client/src/lib/posthogClient.ts'), /opt_out_capturing_by_default: true,\s+opt_out_persistence_by_default: true/);
  assert.match(analytics, /if \(!active \|\| !key\) return Promise\.resolve\(null\);/, 'PostHog loads only while analytics consent holds');
  // No marketing tag, ID or host ships until the owner connects one.
  assert.match(read('client/src/lib/marketingTags.ts'), /export const MARKETING_LOADERS: readonly MarketingLoader\[\] = \[\];/);
  const csp = read('vercel.json');
  assert.doesNotMatch(csp, /googletagmanager|google-analytics|connect\.facebook\.net|facebook\.com\/tr/, 'no marketing host in the CSP yet');
  // The footer reopens the choice; the banner offers Reject all beside Accept all.
  assert.match(read('client/src/components/BrandFooter.tsx'), /onClick=\{openConsentSettings\}/);
  assert.equal(ENGLISH['consent.rejectAll'], 'Reject all');
  assert.equal(ENGLISH['footer.cookieSettings'], 'Cookie settings');
  // The sign-in log's 12 months is the purge in migration 057.
  assert.match(PRIVACY_ENGLISH['legal.privacy.account.log'], /deletes each record after 12 months/);
  assert.match(read('supabase/supabase-schema-057.sql'), /DELETE FROM public\.auth_events\s+WHERE created_at < NOW\(\) - INTERVAL '12 months';/, 'the purge the privacy policy promises');
  // Merchandise is hidden: the policy names no shop that receives data.
  // The policy's own dictionary obeys the copy rules the app's does, and
  // only the legal pages load it.
  for (const [key, value] of Object.entries(PRIVACY_ENGLISH)) {
    assert.doesNotMatch(value, /sprd\.net/, `${key} still names Spreadshop as a recipient`);
    assert.doesNotMatch(value, /free forever|\bis free\b|free, forever|\$0\b|charges for none/i, `${key} still says devShark is free`);
    assert.doesNotMatch(value, /\{\w+\}/, `${key} takes a placeholder, which LegalPages does not fill`);
  }
  assert.ok(!Object.keys(ENGLISH).some((key) => key.startsWith('legal.privacy.')), 'privacy keys live in translations.privacy.ts alone');
  const legalImporters = ['client/src/App.tsx', 'client/src/main.tsx', 'client/src/i18n/LanguageContext.tsx', 'client/src/components/BrandFooter.tsx', 'client/src/components/CookieConsent.tsx'];
  for (const file of legalImporters) assert.doesNotMatch(read(file), /translations\.privacy/, `${file} pulls the privacy policy into the shell`);
  // The Learn page's section and placement copy ships with the Learn chunk
  // (translations.learn.ts), never with the shell.
  assert.ok(!Object.keys(ENGLISH).some((key) => key.startsWith('learn.') || key.startsWith('placement.')),
    'learn.* and placement.* keys live in translations.learn.ts alone');
  const shellFiles = ['client/src/App.tsx', 'client/src/main.tsx', 'client/src/i18n/LanguageContext.tsx', 'client/src/lib/routePreload.ts', 'client/src/lib/routeHead.ts'];
  for (const file of shellFiles) assert.doesNotMatch(read(file), /translations\.learn/, `${file} pulls the Learn copy into the shell`);
  for (const id of LEARN_SECTION_IDS) {
    assert.ok(`learn.section.${id}` in LEARN_ENGLISH, `section ${id} has a name in translations.learn.ts`);
    assert.ok(`learn.section.line.${id}` in LEARN_ENGLISH, `section ${id} has a line in translations.learn.ts`);
  }

  // The path picker's words (#490) ride in the Profile chunk the same way:
  // no key in both dictionaries, no shell import, and the app's copy rules.
  for (const key of Object.keys(PICKER_ENGLISH)) {
    assert.ok(!(key in ENGLISH), `${key} lives in translations.picker.ts alone`);
  }
  for (const file of legalImporters) assert.doesNotMatch(read(file), /translations\.picker/, `${file} pulls the path picker's copy into the shell`);
  // The picker and the card build these keys from the option ids, so every
  // id needs its words here or the option reads as its raw key.
  for (const id of LEARN_SECTION_IDS) {
    assert.ok(`profile.section.${id}` in PICKER_ENGLISH, `the Profile card names the ${id} section`);
  }
  for (const goal of LEARNER_GOALS) assert.ok(`profile.goal.${goal}` in PICKER_ENGLISH, `the picker names the ${goal} goal`);
  for (const level of EXPERIENCE_LEVELS) assert.ok(`profile.experience.${level}` in PICKER_ENGLISH, `the picker names the ${level} experience level`);
  for (const band of STUDY_TIMES) assert.ok(`profile.studyTime.${band}` in PICKER_ENGLISH, `the picker names the ${band} study time`);
  for (const [key, value] of Object.entries(PICKER_ENGLISH)) {
    assert.doesNotMatch(value, /free forever|\bis free\b|free, forever|\$0\b|charges for none/i, `${key} still says devShark is free`);
    assert.doesNotMatch(value, /certif|hired|hiring|job[- ]ready|guaranteed?|AI[- ]powered|AI tutor/i, `${key} makes a certification, hiring or AI claim`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
