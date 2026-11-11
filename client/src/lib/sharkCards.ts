// Shark Cards (owner decision 12): a question the learner did not know, saved
// where its explanation was shown, and reviewed later on /collection as a card
// that explains the topic. A card is a row of /api/flashcards; the old
// collectible card packs are retired.
//
// What a card holds comes from the server's grading of the learner's own
// answer: the correct option and the explanation it returned. Nothing here
// asks the server for an answer, so saving a card never reveals one.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import { addFlashcard, removeFlashcard, type Flashcard } from './flashcards';
import { flashcardsQuery } from './queries';
import { useSubject } from './subjects';
import { addBookmark, removeBookmark, useBookmarks } from './bookmarks';

/** A graded question, as every surface that shows an explanation has it. */
export interface GradedQuestion {
  id: string;
  question: string;
  category: string;
  options: readonly string[];
}

/** The card a graded question becomes. */
export function toSharkCard(question: GradedQuestion, correctIndex: number, explanation: string): Flashcard {
  return {
    question_id: question.id,
    question: question.question,
    category: question.category,
    correct_answer: question.options[correctIndex] ?? '',
    explanation: explanation || null,
    created_at: new Date().toISOString(),
  };
}

/** Roll back one card without overwriting other changes to the same deck. */
function restoreCard(deck: Flashcard[] | undefined, previous: Flashcard[], id: string): Flashcard[] | undefined {
  if (!deck) return deck;
  const position = previous.findIndex((card) => card.question_id === id);
  const next = deck.filter((card) => card.question_id !== id);
  if (position >= 0) next.splice(position, 0, previous[position]);
  return next;
}

/** Save a card, optimistically: it is in the deck at once, and back out if
 * the server refuses. The device's own bookmark list follows, so Profile and
 * the bookmark badge agree with the deck. */
export function useSaveSharkCard() {
  const queryClient = useQueryClient();
  const [subject] = useSubject();
  const key = flashcardsQuery(subject).queryKey;
  return useMutation({
    mutationFn: (card: Flashcard & { options?: readonly string[]; correctIndex?: number }) => addFlashcard({
      question_id: card.question_id,
      question: card.question,
      category: card.category,
      correct_answer: card.correct_answer,
      explanation: card.explanation,
    }),
    onMutate: async (card) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Flashcard[]>(key);
      // Only a deck that was read is updated: a guess at an unread deck would
      // stand in for the real one.
      if (previous) {
        queryClient.setQueryData<Flashcard[]>(key, [
          { question_id: card.question_id, question: card.question, category: card.category, correct_answer: card.correct_answer, explanation: card.explanation, created_at: card.created_at },
          ...previous.filter((one) => one.question_id !== card.question_id),
        ]);
      }
      return { previous };
    },
    onSuccess: (_data, card) => {
      addBookmark({
        id: card.question_id,
        question: card.question,
        category: card.category ?? '',
        options: card.options ? [...card.options] : [card.correct_answer],
        correctIndex: typeof card.correctIndex === 'number' ? card.correctIndex : 0,
        explanation: card.explanation ?? '',
      });
    },
    onError: (_error, card, context) => {
      if (context?.previous) {
        const previous = context.previous;
        queryClient.setQueryData<Flashcard[]>(key, (deck) => restoreCard(deck, previous, card.question_id));
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Remove a card ("Got it" in the deck, or un-saving where it was saved),
 * optimistically, putting it back if the server refuses. */
export function useRemoveSharkCard() {
  const queryClient = useQueryClient();
  const [subject] = useSubject();
  const key = flashcardsQuery(subject).queryKey;
  return useMutation({
    mutationFn: (questionId: string) => removeFlashcard(questionId),
    onMutate: async (questionId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Flashcard[]>(key);
      if (previous) queryClient.setQueryData<Flashcard[]>(key, previous.filter((one) => one.question_id !== questionId));
      return { previous };
    },
    onSuccess: (_data, questionId) => removeBookmark(questionId),
    onError: (_error, id, context) => {
      if (context?.previous) {
        const previous = context.previous;
        queryClient.setQueryData<Flashcard[]>(key, (deck) => restoreCard(deck, previous, id));
      }
    },
  });
}

/** Whether a question is saved as a card: the account's deck when this visit
 * has read it, this device's list otherwise. A review screen does not read
 * the deck for this: saving a card that is already saved changes nothing, so
 * one more request per result is not worth it. `null` while signed out, since
 * cards belong to an account. */
export function useSharkCardSaved(questionId: string): boolean | null {
  const { isAuthenticated, isLoading } = useAuth();
  const [subject] = useSubject();
  const deck = useQuery({ ...flashcardsQuery(subject), enabled: false });
  const { ids } = useBookmarks();
  if (!isAuthenticated || isLoading) return null;
  if (deck.data) return deck.data.some((card) => card.question_id === questionId);
  return Boolean(ids[questionId]);
}
