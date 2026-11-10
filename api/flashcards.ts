import type { VercelRequest, VercelResponse } from '../lib/vercel-types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient, jsonError, withTimeout, requireAuthSub, withRequestContext, ServiceUnavailableError } from '../lib/http';
import { enforceClassRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { deploymentSubjectIds } from '../lib/product-scope';
import { isScopeSubject, subjectForCategory } from '../shared/subject-catalog';
import { getEffectiveQuestionsById } from '../lib/questions-store';

const supabase = createServiceClient();

const FIELDS = 'question_id,question,category,correct_answer,explanation,created_at,subject';
const MAX = { id: 64, short: 128, text: 4000, answer: 2000 };

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/**
 * Shark Cards (owner decision 12): the questions a learner saved where the
 * explanation of their own graded answer was shown, one row per question.
 *
 * What a card holds is what the grading already showed the learner: the
 * question, its correct option and the server's explanation, sent back by the
 * browser. The bank is read only to check that the question exists in this
 * subject and to take its category. Nothing here ever reads an answer or an
 * explanation out of the bank, so saving a card for a question nobody
 * answered reveals nothing, and a learner only ever reads, changes or deletes
 * their own cards. `db` is the service client, a parameter so the contracts
 * can run the handler against a stand-in.
 */
export async function handleFlashcards(req: VercelRequest, res: VercelResponse, db: SupabaseClient | null) {
  // A write takes a class-sized address bucket, then the account's own; the
  // token is verified once, and `requireAuthSub` below reads the result.
  if (req.method !== 'GET' && !(await enforceClassRateLimit(req, res, RATE_LIMITS.flashcardMutationAddress, RATE_LIMITS.flashcardMutation))) return;
  if (!db) return jsonError(res, 503, 'not_configured', 'Backend is not configured');

  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  const rawSubject = req.method === 'POST'
    ? (req.body as { subject?: unknown } | undefined)?.subject
    : req.query.subject;
  if (!isScopeSubject(rawSubject) || !deploymentSubjectIds().includes(rawSubject)) {
    return jsonError(res, 400, 'invalid_subject_scope', 'A subject from this deployment is required');
  }
  const subject = rawSubject;

  try {
    if (req.method === 'GET') {
      const { data, error } = await withTimeout(
        db
          .from('flashcards')
          .select(FIELDS)
          .eq('user_id', userId)
          .eq('subject', subject)
          .order('created_at', { ascending: false }),
      );
      if (error) return jsonError(res, 500, 'db_error', 'Could not load cards');
      return res.json({ cards: data ?? [] });
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as Record<string, unknown>;
      const question_id = str(body.question_id, MAX.id);
      const question = str(body.question, MAX.text);
      const correct_answer = str(body.correct_answer, MAX.answer);
      if (!question_id || !question || !correct_answer) {
        return jsonError(res, 400, 'bad_request', 'question_id, question and correct_answer are required');
      }
      // Postgres text cannot hold U+0000, so a card carrying one would fail
      // the write and answer 500. It is the browser's text, refused as such.
      if ([body.question_id, body.question, body.correct_answer, body.explanation].some((value) => typeof value === 'string' && value.includes('\u0000'))) {
        return jsonError(res, 400, 'bad_request', 'Card text cannot contain a null character');
      }
      const bank = await getEffectiveQuestionsById(subject);
      const source = bank.get(question_id);
      if (!source || subjectForCategory(source.category) !== subject) {
        return jsonError(res, 400, 'invalid_question', 'Question does not belong to this subject');
      }
      const row = {
        user_id: userId,
        subject,
        question_id,
        question,
        category: source.category,
        correct_answer,
        explanation: str(body.explanation, MAX.text),
      };
      const { data, error } = await withTimeout(
        db.from('flashcards').upsert(row, { onConflict: 'user_id,question_id' }).select(FIELDS).single(),
      );
      if (error?.code === '23503' && error.message === 'flashcard_account_missing') {
        return jsonError(res, 401, 'invalid_token', 'This account is no longer available. Sign in again.');
      }
      if (error?.code === '55P03') {
        return jsonError(res, 503, 'flashcard_busy', 'The account is being updated. Try again in a moment.');
      }
      if (error) return jsonError(res, 500, 'db_error', 'Could not save card');
      return res.json({ card: data });
    }

    if (req.method === 'DELETE') {
      // Bounded as a saved card's id is, so an id no card can have is refused
      // here rather than sent to the database.
      const qid =
        str(req.query.question_id, MAX.id) ??
        str((req.body as { question_id?: unknown } | undefined)?.question_id, MAX.id);
      if (!qid || qid.includes('\u0000')) return jsonError(res, 400, 'bad_request', 'question_id is required');
      const { error } = await withTimeout(
        db.from('flashcards').delete().eq('user_id', userId).eq('subject', subject).eq('question_id', qid),
      );
      if (error) return jsonError(res, 500, 'db_error', 'Could not delete card');
      return res.json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (error) {
    // A Supabase call that timed out is the service being down for a moment,
    // which the client may retry: 503, as every other handler answers it.
    if (error instanceof ServiceUnavailableError) return jsonError(res, 503, error.code, error.message);
    return jsonError(res, 500, 'internal_error', 'Internal error');
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => handleFlashcards(req, res, supabase));
}
