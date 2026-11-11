// Shark Cards (owner decision 12): a question the learner did not know, saved
// where its explanation was shown, reviewed later as a card that explains the
// topic. Invented cards; the wire shape is the real /api/flashcards one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Flashcards from '../src/components/Flashcards';
import Collection from '../src/components/Collection';
import { SaveSharkCard } from '../src/components/SaveSharkCard';
import type { Flashcard } from '../src/lib/flashcards';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ ...auth.value, signInWithGoogle: async () => {} }),
}));
const signIn = () => { auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false }; };
afterEach(() => { auth.value = { user: null, isAuthenticated: false, isLoading: false }; });

const LEARN_CARD: Flashcard = {
  question_id: 'rm-js-17', question: 'What does typeof null return?', category: 'javascript',
  correct_answer: '"object"', explanation: 'A quirk kept from the first JavaScript engine.', created_at: '2026-10-01T09:00:00Z',
};
const QUIZ_CARD: Flashcard = {
  question_id: '42', question: 'Which hook keeps a value between renders without re-rendering?', category: 'react',
  correct_answer: 'useRef', explanation: 'A ref changes without asking React to render again.', created_at: '2026-10-01T08:00:00Z',
};

/** The deck as the server keeps it, with the requests it was sent. */
function serveDeck(initial: Flashcard[]) {
  const deck = [...initial];
  const sent: { method: string; body?: Record<string, unknown>; questionId?: string | null }[] = [];
  server.use(
    http.get('*/api/flashcards', () => HttpResponse.json({ cards: deck })),
    http.post('*/api/flashcards', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      sent.push({ method: 'POST', body });
      const card = { ...(body as unknown as Flashcard), created_at: '2026-10-01T10:00:00Z' };
      deck.unshift(card);
      return HttpResponse.json({ card });
    }),
    http.delete('*/api/flashcards', ({ request }) => {
      const questionId = new URL(request.url).searchParams.get('question_id');
      sent.push({ method: 'DELETE', questionId });
      deck.splice(0, deck.length, ...deck.filter((card) => card.question_id !== questionId));
      return HttpResponse.json({ ok: true });
    }),
  );
  return { deck, sent };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}><MemoryRouter><LanguageProvider>{children}</LanguageProvider></MemoryRouter></QueryClientProvider>;
}
const mount = (node: ReactNode) => act(async () => { render(node, { wrapper }); });

describe('the Shark Cards deck', () => {
  it('shows the question and its topic first, and no answer', async () => {
    signIn();
    serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Shark Cards' })).toBeInTheDocument();
    const card = screen.getByRole('article');
    // One label before the question (UX audit questions-14): the position sits
    // in the card's meta row beside the topic, and no kicker or 'Question'
    // side label repeats what the page and the card already say.
    expect(within(card).getByText('Card 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Card 1 of 2' })).toContainElement(card);
    expect(screen.queryByText('Saved questions')).toBeNull();
    expect(within(card).queryByText('Question')).toBeNull();
    expect(within(card).getByText('What does typeof null return?')).toBeInTheDocument();
    expect(within(card).getByText('JavaScript')).toBeInTheDocument();
    expect(within(card).queryByText('"object"')).toBeNull();
    expect(within(card).queryByText(/quirk/)).toBeNull();
    expect(within(card).getByRole('button', { name: 'Show the answer' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('turns over to the correct answer, the explanation and a link to the Learn level it came from', async () => {
    signIn();
    serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    const turn = await screen.findByRole('button', { name: 'Show the answer' });
    fireEvent.click(turn);
    const card = screen.getByRole('article');
    expect(within(card).getByRole('button', { name: 'Hide the answer' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByText('Correct answer')).toBeInTheDocument();
    expect(within(card).getByText('"object"')).toBeInTheDocument();
    expect(within(card).getByText('A quirk kept from the first JavaScript engine.')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Learn this topic: JavaScript, level 3' })).toHaveAttribute('href', '/learn?topic=javascript&level=3');

    // A quiz question links to its Learn topic.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Card 2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(screen.getByRole('link', { name: 'Learn this topic: React' })).toHaveAttribute('href', '/learn?topic=react');
  });

  it('draws Previous and Next together on the left of the one action row, and Got it on its right (questions-14)', async () => {
    signIn();
    serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    const previous = await screen.findByRole('button', { name: 'Previous' });
    const row = previous.closest('.ss-question-actions');
    expect(row).not.toBeNull();
    const left = row!.querySelector('.ss-question-actions__secondary')!;
    expect(left).toContainElement(previous);
    expect(left).toContainElement(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveAccessibleDescription(
      'Got it takes the card out of your deck. The arrow keys move between cards.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(row!.querySelector('.ss-question-actions__primary')).toContainElement(screen.getByRole('button', { name: 'Got it' }));
  });

  it('makes Show the answer the one filled primary face down, and Got it the one turned (social-account-19)', async () => {
    signIn();
    serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    const card = await screen.findByRole('article');
    // Face down: the card's turn button is the next step; Got it is a
    // secondary at the right end of the row, and no SwimCta is drawn.
    expect(card).toHaveAttribute('data-side', 'front');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(0);
    const gotIt = screen.getByRole('button', { name: 'Got it' });
    expect(gotIt).toHaveClass('sc-deck__got-it');
    expect(gotIt).not.toHaveClass('ss-swim-cta');
    expect(screen.getAllByRole('button', { name: 'Got it' })).toHaveLength(1);

    // Turned: Got it is the one SwimCta, still described by the hint.
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(card).toHaveAttribute('data-side', 'back');
    const primaries = document.querySelectorAll('.ss-swim-cta');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveAccessibleName('Got it');
    expect(primaries[0]).toHaveAccessibleDescription('Got it takes the card out of your deck. The arrow keys move between cards.');
    expect(screen.getAllByRole('button', { name: 'Got it' })).toHaveLength(1);

    // Got it from the turned card takes it out and the next card opens face down.
    fireEvent.click(primaries[0]);
    expect(await screen.findByText('Card 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('data-side', 'front');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show the answer' })).toHaveFocus());
  });

  it('announces the new position from the card as the deck steps (questions-14)', async () => {
    signIn();
    serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    const position = await screen.findByText('Card 1 of 2');
    expect(position).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // The same live region, so a screen reader reads the change.
    expect(position).toHaveTextContent('Card 2 of 2');
  });

  it('steps with Previous, Next and the arrow keys, and turns each new card face down', async () => {
    signIn();
    serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    const previous = await screen.findByRole('button', { name: 'Previous' });
    expect(previous).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Hide the answer' }), { key: 'ArrowRight' });
    expect(screen.getByText('Card 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the answer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Show the answer' }), { key: 'ArrowLeft' });
    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
  });

  it('keeps the focus on the turn button as the arrow keys step through the deck', async () => {
    signIn();
    serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    const turn = await screen.findByRole('button', { name: 'Show the answer' });
    turn.focus();
    fireEvent.keyDown(turn, { key: 'ArrowRight' });
    expect(screen.getByText('Card 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the answer' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
  });

  it('takes a card out with Got it, moves to the next one, and puts it back with Undo', async () => {
    signIn();
    const { sent } = serveDeck([LEARN_CARD, QUIZ_CARD]);
    await mount(<Flashcards />);
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }));
    expect(await screen.findByText('Card 1 of 1')).toBeInTheDocument();
    expect(screen.getByText(QUIZ_CARD.question)).toBeInTheDocument();
    await waitFor(() => expect(sent).toContainEqual({ method: 'DELETE', questionId: 'rm-js-17' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show the answer' })).toHaveFocus());
    expect(await screen.findByText('Card taken out of your Shark Cards.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent.filter((one) => one.method === 'POST')).toHaveLength(1));
    expect(sent.find((one) => one.method === 'POST')?.body).toMatchObject({
      question_id: 'rm-js-17', question: LEARN_CARD.question, correct_answer: '"object"', explanation: LEARN_CARD.explanation, category: 'javascript',
    });
    expect(await screen.findByText('Card 1 of 2')).toBeInTheDocument();
  });

  it('puts a card back and says so when Got it fails', async () => {
    signIn();
    serveDeck([LEARN_CARD]);
    server.use(http.delete('*/api/flashcards', () => HttpResponse.json({ error: { code: 'db_error', message: 'Could not delete card' } }, { status: 500 })));
    await mount(<Flashcards />);
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove the card.');
    expect(screen.getByText(LEARN_CARD.question)).toBeInTheDocument();
  });

  it('explains how to get cards when there are none', async () => {
    signIn();
    serveDeck([]);
    await mount(<Flashcards />);
    expect(await screen.findByRole('heading', { level: 1, name: 'No Shark Cards yet' })).toBeInTheDocument();
    expect(screen.getByText(/choose Save as Shark Card under its explanation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a quiz' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Learn' })).toBeInTheDocument();
  });

  it('says the last card is gone when Got it empties the deck', async () => {
    signIn();
    serveDeck([QUIZ_CARD]);
    await mount(<Flashcards />);
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }));
    expect(await screen.findByRole('heading', { name: 'No Shark Cards yet' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in, and reads nothing', async () => {
    await mount(<Flashcards />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to save questions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('offers a retry when the cards cannot load', async () => {
    signIn();
    let fail = true;
    server.use(http.get('*/api/flashcards', () => (fail
      ? HttpResponse.json({ error: { code: 'db_error', message: 'Could not load cards' } }, { status: 500 })
      : HttpResponse.json({ cards: [QUIZ_CARD] }))));
    await mount(<Flashcards />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText(QUIZ_CARD.question)).toBeInTheDocument();
  });
});

describe('the Shark Card layout', () => {
  const css = readFileSync(new URL('../src/components/SharkCards.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => css.match(new RegExp(`(?:^|[}\\s])${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';

  it('hugs its content with no 300px floor, and keeps three lines for the question so a short one leaves the actions at one y (questions-14)', () => {
    expect(rule('.sc-card')).not.toMatch(/min-height/);
    // The card takes .ss-raised's edge like every card, with no accent top edge.
    expect(rule('.sc-card')).not.toMatch(/border-top/);
    expect(css).not.toMatch(/\.sc-card\.is-turned\s*\{/);
    expect(css).not.toMatch(/min-height:\s*(300|260)px/);
    expect(rule('.sc-card__question')).toContain('min-height: calc(3 * 1.55em)');
  });

  it('fills the face-down turn button with the accent and quiets it once turned (social-account-19)', () => {
    expect(rule('.sc-card__turn')).toContain('background: var(--brand-accent)');
    expect(rule('.sc-card__turn')).toContain('color: var(--brand-on-accent)');
    expect(rule('.sc-card.is-turned .sc-card__turn')).toContain('background: transparent');
    expect(rule('.sc-deck__actions .sc-deck__got-it')).toContain('margin-inline-start: auto');
  });

  it('darkens the filled turn button toward the ink on hover, never to the light accent under the dark label', () => {
    // --brand-accent-hover is the light accent in dark mode as well, where the
    // label is the dark --brand-on-accent: that pair falls below 4.5:1.
    expect(rule('.sc-card__turn:hover')).toContain('color-mix(in srgb, var(--brand-accent) 85%, var(--ss-ink))');
    expect(css).not.toContain('--brand-accent-hover');
  });
});

describe('/collection', () => {
  it('opens on Shark Cards, named so in the heading and the tab', async () => {
    signIn();
    serveDeck([QUIZ_CARD]);
    await mount(<Collection />);
    expect(screen.getByRole('heading', { level: 1, name: 'Shark Cards' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shark Cards' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText(QUIZ_CARD.question)).toBeInTheDocument();
    // The deck inside the page does not repeat the page heading.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('asks nobody to sign in on the saved challenges while the session is still being restored', async () => {
    auth.value = { user: null, isAuthenticated: false, isLoading: true };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: '/collection', search: '?tab=challenges', key: 'restoring-session' }]}>
            <LanguageProvider><Collection /></LanguageProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Saved coding challenges' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('names the open shelf once: the h1 and its tab, with no kicker and no repeat in the sign-in panel (social-account-10)', async () => {
    const { container } = render(<Collection />, { wrapper });
    expect(screen.getByRole('heading', { level: 1, name: 'Shark Cards' })).toBeInTheDocument();
    expect(container.querySelector('.ss-kicker')).toBeNull();
    expect(screen.getByText('Questions you missed and saved. Turn a card for the answer.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sign in to save questions' })).toBeInTheDocument();
    expect(screen.getByText('Your cards stay with your account on every device.')).toBeInTheDocument();
    // The h1 and the selected tab; nothing else on the screen says it.
    expect(screen.getAllByText(/Shark Cards/)).toHaveLength(2);
  });

  it('keeps one filled primary: the open tab is secondary with aria-current, the other ghost, and the gate owns the primary', async () => {
    const { container } = render(<Collection />, { wrapper });
    const open = screen.getByRole('button', { name: 'Shark Cards' });
    expect(open).toHaveAttribute('aria-current', 'page');
    expect(open).toHaveAttribute('data-variant', 'secondary');
    const other = screen.getByRole('button', { name: 'Coding challenges' });
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).toHaveAttribute('data-variant', 'ghost');
    const primaries = container.querySelectorAll('button[data-variant="primary"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Sign in');
  });

  it('gives both tabs the same sign-in panel under the page header, with one primary Sign in (social-account-16)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/collection?tab=challenges']}>
          <LanguageProvider><Collection /></LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Saved coding challenges' })).toBeInTheDocument();
    expect(screen.getByText('From the task pages, with your last code.')).toBeInTheDocument();
    const panel = container.querySelector('.ss-state-panel')!;
    expect(within(panel as HTMLElement).getByRole('heading', { level: 2, name: 'Sign in to save challenges' })).toBeInTheDocument();
    const signIn = within(panel as HTMLElement).getByRole('button', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('aria-haspopup', 'dialog');
    expect(panel.querySelector('.ss-state-panel__actions')?.firstElementChild).toBe(signIn);
    // The body does not name the shelf a fourth time (social-account-10).
    expect(within(panel as HTMLElement).getByText('Your list stays with your account on every device.')).toBeInTheDocument();
  });
});

describe('a wrong Learn answer', () => {
  const QUESTION = { id: 'rm-html-3', tags: [], introduction: '', question: 'Which element holds the page title?', options: ['<header>', '<title>'], category: 'html', difficulty: 1 };
  const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1 as const, questionCount: 8 });
  const STRUCTURE = { topics: ['html'], structure: { html: { levels: Array.from({ length: 15 }, (_, i) => level(i + 1)), checkpoints: [] } } };

  it('offers Save as Shark Card under the explanation, and saves the graded answer', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    signIn();
    server.use(
      http.get('*/api/quiz/roadmap', ({ request }) => {
        const params = new URL(request.url).searchParams;
        const resource = params.get('resource');
        if (resource === 'progress') return HttpResponse.json({ data: {}, extra: { unlocked: [] } });
        if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
        if (params.get('level')) {
          return HttpResponse.json({ kind: 'level', topic: 'html', ref: 1, title: 'Level 1 title', passPct: 75, sessionId: 'session-1', questions: [QUESTION] });
        }
        return HttpResponse.json(STRUCTURE);
      }),
      http.post('*/api/quiz/roadmap', () => HttpResponse.json({ selectedIndex: 0, correctAnswer: 1, isCorrect: false, explanation: 'The title element names the page.' })),
      http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'learning-path-enrollment'
        ? HttpResponse.json({ enrollments: [] })
        : HttpResponse.json({ tier: 'premium', source: 'manual', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null })),
      http.all('*/api/*', () => HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
    );
    // Registered last, so the deck answers ahead of the catch-all above.
    const { sent } = serveDeck([]);
    window.history.replaceState({}, '', '/learn?topic=html&level=1');
    try {
      const { default: Roadmap } = await import('../src/components/Roadmap');
      await mount(<Roadmap />);
      const start = await screen.findByRole('button', { name: 'Start the level' }, { timeout: 5000 }).catch(() => null);
      if (start) fireEvent.click(start);
      fireEvent.click(await screen.findByRole('radio', { name: /<header>/ }, { timeout: 5000 }));
      expect(await screen.findByText('Incorrect')).toBeInTheDocument();
      expect(screen.getByText('The title element names the page.')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Save as a Shark Card' }));
      await waitFor(() => expect(sent.filter((one) => one.method === 'POST')).toHaveLength(1));
      expect(sent[0].body).toEqual({
        question_id: 'rm-html-3', question: QUESTION.question, category: 'html',
        correct_answer: '<title>', explanation: 'The title element names the page.', subject: 'webdev',
      });
      const savedButton = await screen.findByRole('button', { name: 'Saved as Shark Card' });
      await waitFor(() => expect(savedButton).toBeEnabled());
      expect(savedButton).toHaveAttribute('aria-pressed', 'true');
    } finally {
      window.history.replaceState({}, '', '/');
      vi.unstubAllGlobals();
    }
  });
});

describe('Save as Shark Card', () => {
  const question = { id: 'rm-css-9', question: 'Which property stacks positioned boxes?', category: 'css', options: ['z-index', 'order', 'float'] };

  it('saves the graded answer and explanation, shows it saved, and takes it out when pressed again', async () => {
    signIn();
    const { sent } = serveDeck([]);
    await mount(<SaveSharkCard question={question} correctIndex={0} explanation="z-index orders positioned boxes." />);
    const save = await screen.findByRole('button', { name: 'Save as a Shark Card' });
    fireEvent.click(save);
    const savedButton = await screen.findByRole('button', { name: 'Saved as Shark Card' });
    await waitFor(() => expect(savedButton).toBeEnabled());
    expect(savedButton).toHaveAttribute('aria-pressed', 'true');
    expect(sent[0]).toEqual({
      method: 'POST',
      body: { question_id: 'rm-css-9', question: question.question, category: 'css', correct_answer: 'z-index', explanation: 'z-index orders positioned boxes.', subject: 'webdev' },
    });
    expect(screen.queryByRole('link', { name: 'Open Shark Cards' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Saved as Shark Card' }));
    expect(await screen.findByRole('button', { name: 'Save as a Shark Card' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(sent).toContainEqual({ method: 'DELETE', questionId: 'rm-css-9' }));
  });

  it('starts saved for a question in the deck this visit read, and reads nothing itself', async () => {
    signIn();
    let reads = 0;
    serveDeck([{ question_id: 'rm-css-9', question: question.question, category: 'css', correct_answer: 'z-index', explanation: null, created_at: '2026-10-01T09:00:00Z' }]);
    const alone = await act(async () => render(<SaveSharkCard question={question} correctIndex={0} explanation="" />, { wrapper }));
    server.events.on('request:start', ({ request }) => { if (new URL(request.url).pathname === '/api/flashcards') reads += 1; });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.getByRole('button', { name: 'Save as a Shark Card' })).toBeInTheDocument();
    expect(reads).toBe(0);
    server.events.removeAllListeners();
    alone.unmount();
    // With the deck read (here by the deck itself), the button knows.
    await mount(<><Flashcards embedded /><SaveSharkCard question={question} correctIndex={0} explanation="" /></>);
    expect(await screen.findByRole('button', { name: 'Saved as Shark Card' })).toBeInTheDocument();
  });

  it('keeps another card removed when a concurrent save fails', async () => {
    signIn();
    const { sent } = serveDeck([QUIZ_CARD]);
    let release!: () => void;
    server.use(http.post('*/api/flashcards', () => new Promise<Response>((resolve) => {
      release = () => resolve(HttpResponse.json({ error: { code: 'db_error', message: 'Could not save card' } }, { status: 500 }));
    })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['flashcards', 'webdev'], [QUIZ_CARD]);
    const alreadySaved = { id: QUIZ_CARD.question_id, question: QUIZ_CARD.question, category: 'react', options: ['useRef'] };
    render(<QueryClientProvider client={client}><LanguageProvider>
      <section aria-label="First card"><SaveSharkCard question={question} correctIndex={0} explanation="Why" /></section>
      <section aria-label="Second card"><SaveSharkCard question={alreadySaved} correctIndex={0} explanation="Why" /></section>
    </LanguageProvider></QueryClientProvider>);
    const first = within(screen.getByRole('region', { name: 'First card' }));
    const second = within(screen.getByRole('region', { name: 'Second card' }));
    fireEvent.click(first.getByRole('button', { name: 'Save as a Shark Card' }));
    await waitFor(() => expect(release).toBeDefined());
    fireEvent.click(second.getByRole('button', { name: 'Saved as Shark Card' }));
    await waitFor(() => expect(sent).toContainEqual({ method: 'DELETE', questionId: QUIZ_CARD.question_id }));
    await waitFor(() => expect(second.getByRole('button', { name: 'Save as a Shark Card' })).toBeEnabled());
    await act(async () => { release(); });
    await first.findByRole('alert');
    expect(second.getByRole('button', { name: 'Save as a Shark Card' })).toBeEnabled();
    expect(client.getQueryData(['flashcards', 'webdev'])).toEqual([]);
  });

  it('says so and stays unsaved when the save fails', async () => {
    signIn();
    serveDeck([]);
    server.use(http.post('*/api/flashcards', () => HttpResponse.json({ error: { code: 'db_error', message: 'Could not save card' } }, { status: 500 })));
    await mount(<SaveSharkCard question={question} correctIndex={0} explanation="Why" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save as a Shark Card' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the card.');
    expect(screen.getByRole('button', { name: 'Save as a Shark Card' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders nothing for a signed-out visitor', async () => {
    await mount(<SaveSharkCard question={question} correctIndex={0} explanation="Why" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
