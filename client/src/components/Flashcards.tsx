// Shark Cards (owner decision 12): the questions a learner did not know, saved
// where their explanation was shown, reviewed one card at a time.
//
//   front   the question and its topic
//   back    the correct answer, the explanation the server's grading gave,
//           and a link to learn the topic (its Learn level, its Learn topic,
//           or a quiz on it for a topic Learn does not teach)
//   review  turn the card, Previous / Next (also ← and →), and Got it, which
//           takes the card out of the deck with an Undo
//
// The deck is the shared question parts where they fit a card (UX audit U2,
// questions-14): the Page header on /cards (h1 and one lead line, no kicker),
// the card's position in its meta row, and the one QuestionActions row under
// it, Previous and Next together on the left and Got it on the right.
// Face down the card's Show the answer is the one filled primary; turned, Got
// it is (social-account-19).
//
// Rendered at /cards and as the first tab of /collection (`embedded`). The
// collectible card packs this name once meant are retired; nothing here opens
// a pack.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { useAuth } from '../lib/auth';
import { accountEpoch } from '../lib/accountData';
import { useT } from '../i18n/LanguageContext';
import { CATEGORY_LOOKUP, categoryLabelKey } from '../lib/categories';
import type { CategoryType } from '../types/quiz';
import type { Flashcard } from '../lib/flashcards';
import { friendlyError } from '../lib/api';
import { useFlashcards } from '../lib/queries';
import { useRemoveSharkCard, useSaveSharkCard } from '../lib/sharkCards';
import { sharkCardStudyLink } from '../../../shared/shark-cards';
import { renderQuestion } from './CodeBlock';
import LoadingScreen from './LoadingScreen';
import ErrorRetry from './ErrorRetry';
import { AppToast } from './ui/AppToast';
import { BookmarkIcon, BookIcon } from './ui/icons';
import { QuestionActions } from './question';
import { StatePanel } from './ui/StatePanel';
import { PageHeader } from './ui/PageHeader';
import './DeepEndScreens.css';
import './SharkCards.css';

type TFn = ReturnType<typeof useT>;

const topicLabel = (category: string | null, t: TFn): string | null =>
  category && CATEGORY_LOOKUP.has(category as CategoryType) ? t(categoryLabelKey(category)) : category;

/** "Learn this topic", pointed at the most specific place that teaches it. */
function StudyLink({ card, t }: { card: Flashcard; t: TFn }) {
  const link = sharkCardStudyLink(card.question_id, card.category);
  if (!link) return null;
  const topic = topicLabel(link.topic, t) ?? link.topic;
  const label = link.kind === 'level'
    ? t('sharkCards.learnLevel', { topic, level: link.level })
    : link.kind === 'topic'
      ? t('sharkCards.learnTopic', { topic })
      : t('sharkCards.practiceTopic', { topic });
  return (
    <Link className="sc-card__study" to={link.to}>
      <BookIcon size={18} />
      <span>{label}</span>
    </Link>
  );
}

function Flashcards({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [index, setIndex] = useState(0);
  const [turned, setTurned] = useState(false);
  const [toast, setToast] = useState<{ kind: 'removed'; card: Flashcard } | { kind: 'error'; message: string } | null>(null);
  // The deck stays mounted while the account changes (a Log out, or another
  // account's sign-in), so a Got it toast of the account that left goes with
  // it before the next deck draws: its Undo would post that account's card
  // into the next account's deck.
  const userId = user?.id ?? null;
  const [toastOwner, setToastOwner] = useState(userId);
  if (toastOwner !== userId) {
    setToastOwner(userId);
    setToast(null);
  }
  const flipRef = useRef<HTMLButtonElement>(null);
  // After Got it, the next card's turn button takes the focus.
  const focusNext = useRef(false);
  const backId = useId();
  const positionId = useId();
  const hintId = useId();

  const enabled = !authLoading && isAuthenticated;
  // Inside /collection the page's hold read the cards (Collection.tsx).
  const deck = useFlashcards(enabled, { held: embedded });
  const remove = useRemoveSharkCard();
  const restore = useSaveSharkCard();
  const cards = deck.data ?? [];
  const count = cards.length;
  const at = Math.min(index, Math.max(0, count - 1));
  const card = cards[at] ?? null;

  // A card that left the deck (Got it, or another device) never leaves the
  // position past the end.
  useEffect(() => {
    if (index > 0 && index >= count) setIndex(Math.max(0, count - 1));
  }, [count, index]);
  const shown = card?.question_id ?? null;
  // A move to another card redraws the card, so focus on its turn button
  // fell to the page, and the arrow keys, which the deck hears, stopped after
  // one card; Previous and Next drop it too as they disable at either end.
  // The new card's turn button takes it then.
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    const moved = lastShown.current !== null && shown !== lastShown.current;
    lastShown.current = shown;
    if (!shown) return;
    const active = document.activeElement;
    const dropped = !active || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
    if (!focusNext.current && !(moved && dropped)) return;
    focusNext.current = false;
    flipRef.current?.focus();
  }, [shown]);

  const go = useCallback((to: number) => {
    if (to < 0 || to >= count || to === at) return;
    setIndex(to);
    setTurned(false);
  }, [at, count]);

  // A press answered after the account changed says nothing on the next
  // account's deck (lib/accountData.ts).
  const gotIt = () => {
    if (!card) return;
    const removed = card;
    const epoch = accountEpoch();
    remove.mutate(removed.question_id, {
      onSuccess: () => { if (accountEpoch() === epoch) setToast({ kind: 'removed', card: removed }); },
      onError: (error) => { if (accountEpoch() === epoch) setToast({ kind: 'error', message: `${t('sharkCards.removeFailed')} ${friendlyError(error)}` }); },
    });
    setTurned(false);
    focusNext.current = true;
  };

  const undo = (removed: Flashcard) => {
    setToast(null);
    const epoch = accountEpoch();
    restore.mutate(removed, {
      onError: (error) => { if (accountEpoch() === epoch) setToast({ kind: 'error', message: `${t('sharkCards.saveFailed')} ${friendlyError(error)}` }); },
    });
  };

  const onDeckKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); go(at + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(at - 1); }
  };

  const heading = embedded ? 2 : 1;

  if (authLoading || (enabled && deck.isPending)) {
    return <LoadingScreen label={t('sharkCards.loading')} />;
  }

  if (!isAuthenticated) {
    return (
      <StatePanel level={heading} icon={<BookmarkIcon size={22} />} title={t('sharkCards.signInTitle')} body={t('sharkCards.signInBody')} signIn />
    );
  }

  if (deck.isError && !deck.data) {
    return <ErrorRetry message={friendlyError(deck.error)} onRetry={() => void deck.refetch()} sx={{ maxWidth: 'var(--ss-width-task)', mx: 'auto' }} />;
  }

  const toastNode = (
    <AppToast
      open={!!toast}
      onClose={() => setToast(null)}
      severity={toast?.kind === 'error' ? 'error' : 'success'}
      autoHideDuration={toast?.kind === 'removed' ? 8000 : 5000}
      message={toast?.kind === 'removed' ? (
        <span className="sc-toast">
          <span>{t('sharkCards.removed')}</span>
          <button type="button" className="sc-toast__undo" onClick={() => undo(toast.card)}>{t('sharkCards.undo')}</button>
        </span>
      ) : toast?.kind === 'error' ? toast.message : ''}
    />
  );

  if (!card) {
    return (
      <>
        <StatePanel level={heading} icon={<BookmarkIcon size={22} />} title={t('sharkCards.emptyTitle')} body={t('sharkCards.emptyBody')}>
          <Button variant="primary" label={t('sharkCards.emptyQuiz')} onClick={() => navigate('/quiz')} />
          <Button variant="secondary" label={t('sharkCards.emptyLearn')} onClick={() => navigate('/learn')} />
        </StatePanel>
        {toastNode}
      </>
    );
  }

  const topic = topicLabel(card.category, t);
  return (
    <div className="sc-deck">
      {!embedded && (
        <PageHeader title={t('sharkCards.title')} lead={t('sharkCards.lead')} />
      )}

      <section className="sc-deck__body" aria-labelledby={positionId} onKeyDown={onDeckKey}>
        {/* Not keyed by card: the position is a live region, and one that is
            drawn again with each card is not read out. */}
        <article className={`sc-card ss-raised${turned ? ' is-turned' : ''}`} data-side={turned ? 'back' : 'front'}>
          <div className="sc-card__meta">
            {topic ? <Badge variant="cyan" label={topic} /> : <span />}
            <span id={positionId} className="sc-card__position" aria-live="polite">
              {t('sharkCards.position', { n: at + 1, total: count })}
            </span>
          </div>
          <div className="sc-card__question">{renderQuestion(card.question)}</div>

          {turned && (
            <div id={backId} className="sc-card__back">
              <p className="sc-card__label">{t('sharkCards.answerLabel')}</p>
              <p className="sc-card__answer">{card.correct_answer}</p>
              {card.explanation && (
                <>
                  <p className="sc-card__label">{t('sharkCards.explanationLabel')}</p>
                  <p className="sc-card__explanation">{card.explanation}</p>
                </>
              )}
              <StudyLink card={card} t={t} />
            </div>
          )}

          <button
            ref={flipRef}
            type="button"
            className="sc-card__turn"
            aria-expanded={turned}
            aria-controls={turned ? backId : undefined}
            onClick={() => setTurned((value) => !value)}
          >
            {t(turned ? 'sharkCards.turnBack' : 'sharkCards.turn')}
          </button>
        </article>

        {/* One filled primary (UX audit social-account-19): face down it is
            Show the answer, in the card, and Got it is a secondary; turned, Got
            it is the SwimCta. Got it keeps one place, on the right of the row
            (a full-width last row on a phone), so only its fill changes. */}
        <QuestionActions
          className="sc-deck__actions"
          secondary={(
            <>
              <Button variant="secondary" label={t('sharkCards.previous')} isDisabled={at === 0} onClick={() => go(at - 1)} />
              <Button variant="secondary" label={t('sharkCards.next')} isDisabled={at >= count - 1} onClick={() => go(at + 1)} />
              {!turned && (
                <Button
                  variant="secondary"
                  className="sc-deck__got-it"
                  label={t('sharkCards.gotIt')}
                  isDisabled={remove.isPending}
                  aria-describedby={hintId}
                  onClick={gotIt}
                />
              )}
            </>
          )}
          primary={turned ? { label: t('sharkCards.gotIt'), onClick: gotIt, disabled: remove.isPending, describedBy: hintId } : undefined}
        />
        <p id={hintId} className="sc-deck__hint">{t('sharkCards.gotItHint')}</p>
      </section>
      {toastNode}
    </div>
  );
}

export default Flashcards;
