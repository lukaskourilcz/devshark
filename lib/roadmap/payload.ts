// One answer-free projection for level issuance and adaptive placement.
import { secureShuffle, type Question } from '../quiz-runtime';
import { itemReview } from '../curation';

// Build a playable payload without answer keys. Options are shuffled on the
// server and the answer indices are kept only inside the encrypted session.
export function buildQuestions(ids: string[], byId: Map<string, Question>) {
  const answerKey: { questionId: string; correctAnswer: number }[] = [];
  const questions = ids
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => {
      const correctText = q.options[q.correctAnswer];
      const options = secureShuffle(q.options);
      answerKey.push({ questionId: q.id, correctAnswer: options.indexOf(correctText) });
      return {
        id: q.id,
        // No tags before grading: some name the correct option.
        introduction: q.introduction,
        question: q.question,
        options,
        category: q.category,
        difficulty: q.difficulty,
        review: itemReview(q),
      };
    });
  return { questions, answerKey };
}
