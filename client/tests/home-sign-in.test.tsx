// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Home from '../src/components/Home';
import { server } from './mocks/server';
import { settingsHandler } from './mocks/handlers';
import { http, HttpResponse } from 'msw';

beforeEach(() => server.use(http.get('*/api/quiz/roadmap', ({ request }) => new URL(request.url).searchParams.get('resource') === 'learning-path-catalog' ? HttpResponse.json({ paths: [] }) : undefined)));

const auth = vi.hoisted(() => ({
  value: { user: null, isAuthenticated: false, isLoading: false },
}));
const freeEntitlementHandler = http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'entitlement'
  ? HttpResponse.json({ tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null })
  : undefined);
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
const openSignIn = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/signInDialog', async (importOriginal) => ({ ...(await importOriginal<object>()), openSignIn }));
vi.mock('../src/lib/billing', () => ({ useBilling: () => ({ known: true, enabled: false, launchOffer: false }) }));
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('../src/lib/motion', async (importOriginal) => ({ ...(await importOriginal<object>()), useReducedMotion: () => motion.reduce }));

// The hero's sign-in link opens the sign-in dialog, where Google comes first
// and an email and password follow. The dialog's Google button keeps the
// Back-from-Google recovery (tests/sign-in-dialog.test.tsx).
it('opens the sign-in dialog from the hero link', () => {
  server.use(settingsHandler, freeEntitlementHandler);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
  const link = screen.getByRole('button', { name: 'Sign in' });
  expect(link).toHaveAttribute('aria-haspopup', 'dialog');
  fireEvent.click(link);
  expect(openSignIn).toHaveBeenCalledTimes(1);
  expect(link).toBeEnabled();
});

// The tile says "Daily challenge": one question set for everyone a day, which
// is the quiz's daily mode, not the survival Challenge it used to open.
it('opens the daily challenge from the Daily challenge tile', async () => {
  server.use(settingsHandler, freeEntitlementHandler);
  function Where() {
    const location = useLocation();
    return <p data-testid="location">{location.pathname + location.search}</p>;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <LanguageProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /^Daily challenge/ }));
  expect(await screen.findByTestId('location')).toHaveTextContent('/quiz?mode=daily');
});

// The homepage focuses on choosing a path; progress-storage details live in Learn.
it('keeps progress-storage copy off the homepage for guests and accounts', async () => {
  server.use(settingsHandler, freeEntitlementHandler);
  const renderHome = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
  };
  const guest = renderHome();
  expect(screen.queryByText(/stays on this device only/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Start learning JavaScript' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'What does this return?' })).toHaveTextContent('2 ** 3;');
  expect(screen.queryByRole('textbox', { name: 'Your code' })).toBeNull();
  expect(screen.queryByText('Progress saves to your account.')).toBeNull();
  expect(screen.getByText('Loops, array methods, types and components with real tests.')).toBeInTheDocument();
  expect(screen.queryByText(/GitHub garden/)).toBeNull();
  guest.unmount();

  const signedOut = auth.value;
  auth.value = { ...signedOut, user: { id: 'user-1' } as never, isAuthenticated: true };
  try {
    renderHome();
    expect(screen.queryByText('Progress saves to your account.')).toBeNull();
    expect(screen.queryByText(/stays on this device only/)).toBeNull();
  } finally {
    auth.value = signedOut;
  }
});

// Topic selection changes both the preview and the destination of its action.
it('starts the selected learning path from its renamed action', async () => {
  server.use(settingsHandler, freeEntitlementHandler);
  function Where() {
    const location = useLocation();
    return <p data-testid="location">{location.pathname + location.search}</p>;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/']}><LanguageProvider><Routes>
    <Route path="/" element={<Home />} /><Route path="/learn/:section" element={<Where />} />
  </Routes></LanguageProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Learn TypeScript' }));
  const path = screen.getByRole('list', { name: 'Learn path for TypeScript' });
  expect(within(path).getAllByRole('listitem')).toHaveLength(6);
  expect(within(path).getByText('Basic Types')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'What does this return?' })).toHaveTextContent('2 ** 3;');
  expect(screen.queryByRole('button', { name: 'Start learning JavaScript' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start learning TypeScript' }));
  expect(await screen.findByTestId('location')).toHaveTextContent('/learn/web-developer?topic=typescript');
});

it.each([
  ['B 8', 'Correct.'],
  ['A 6', 'Incorrect. The answer is 8.'],
])('answers the restored JavaScript sample once: %s', (answer, feedback) => {
  server.use(settingsHandler, freeEntitlementHandler);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
  const sample = screen.getByRole('group', { name: 'What does this return?' });
  expect(within(sample).getAllByRole('button')).toHaveLength(4);
  const card = within(sample.parentElement!);
  expect(card.queryByRole('status')).toBeNull();
  fireEvent.click(within(sample).getByRole('button', { name: answer }));
  expect(card.getByRole('status')).toHaveTextContent(feedback);
  expect(card.getByRole('status')).toHaveTextContent('The ** operator is exponentiation');
  for (const option of within(sample).getAllByRole('button')) expect(option).toBeDisabled();
  expect(screen.queryByRole('region', { name: 'devShark product video' })).toBeNull();
});

// Answering disables every option, the pressed one too, so keyboard focus
// would fall to the page body: the verdict takes it instead.
it('moves focus to the sample verdict once an answer disables the options', () => {
  server.use(settingsHandler, freeEntitlementHandler);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
  const sample = screen.getByRole('group', { name: 'What does this return?' });
  const option = within(sample).getByRole('button', { name: 'B 8' });
  option.focus();
  fireEvent.click(option);
  expect(option).toBeDisabled();
  expect(within(sample.parentElement!).getByRole('status')).toHaveFocus();
});

// A topic card's fin school swims 140px across the card on hover; under
// reduced motion it only fades in where it rests.
it.each([
  [false, true],
  [true, false],
])('keeps the topic card fins still under reduced motion (%s)', (reduce, swims) => {
  server.use(settingsHandler, freeEntitlementHandler);
  motion.reduce = reduce;
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
    const card = screen.getByRole('button', { name: 'Learn Next.js' });
    fireEvent.mouseEnter(card);
    const fins = [...card.querySelectorAll<HTMLElement>(':scope > span[aria-hidden]')].filter((span) => span.style.transform);
    expect(fins.length).toBeGreaterThan(0);
    for (const fin of fins) {
      expect(fin.style.opacity).toBe('1');
      expect(/translateX\((?!0px)/.test(fin.style.transform)).toBe(swims);
      expect(fin.style.transform.includes('rotate')).toBe(swims);
    }
  } finally {
    motion.reduce = false;
  }
});

// "Choose a topic" scrolls to the picker and takes keyboard focus with it, so
// the next Tab reaches the topic cards rather than the hero links.
it('moves focus to the topic picker from the hero call to action', () => {
  server.use(settingsHandler, freeEntitlementHandler);
  const original = Element.prototype.scrollIntoView;
  const scrolled: Element[] = [];
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
    const cta = screen.getByRole('button', { name: 'Choose a topic' });
    cta.focus();
    fireEvent.click(cta);
    const picker = screen.getByRole('region', { name: 'Pick a topic.' });
    expect(scrolled).toEqual([picker]);
    expect(within(picker).getByRole('heading', { level: 2 })).toHaveFocus();
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

// The FDE outline is the whole public manifest and sits far below the fold:
// the landing fetches it only once the section comes near.
it('fetches the FDE path outline only when its section comes near', async () => {
  const requests: string[] = [];
  server.use(settingsHandler, freeEntitlementHandler, http.get('*/api/quiz/roadmap', ({ request }) => {
    const resource = new URL(request.url).searchParams.get('resource');
    if (resource !== 'learning-path-catalog') return undefined;
    requests.push(resource);
    return HttpResponse.json({ paths: [] });
  }));
  const observed: { callback: IntersectionObserverCallback; nodes: Element[] }[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    nodes: Element[] = [];
    constructor(callback: IntersectionObserverCallback) { observed.push({ callback, nodes: this.nodes }); }
    observe(node: Element) { this.nodes.push(node); }
    disconnect() { this.nodes.length = 0; }
    unobserve() {}
    takeRecords() { return []; }
  });
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
    const section = screen.getByRole('region', { name: 'Forward Deployed Engineer' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toEqual([]);
    const watcher = observed.find((one) => one.nodes.includes(section));
    expect(watcher).toBeDefined();
    act(() => watcher!.callback([{ isIntersecting: true, target: section } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(requests).toEqual(['learning-path-catalog']));
    expect(await within(section).findByText('The path outline could not load here. Try opening it in Learn.')).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

// The hero counts are English copy: a browser set to German must not turn
// 2,134 questions into "2.134".
it('writes the hero counts with English digit grouping in any browser locale', () => {
  server.use(settingsHandler, freeEntitlementHandler);
  const original = Number.prototype.toLocaleString;
  const spy = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    return original.call(this, locales ?? 'de-DE', options);
  });
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
    const hero = screen.getByRole('region', { name: screen.getByRole('heading', { level: 1 }).closest('section')!.getAttribute('aria-label')! });
    const questions = within(hero).getByText('questions').previousElementSibling;
    expect(questions?.textContent).toMatch(/^\d{1,3}(,\d{3})+$/);
  } finally {
    spy.mockRestore();
  }
});
