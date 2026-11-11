// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

// The document head per route (lib/routeHead.ts, applied by App.tsx on every
// navigation): the tab title, the prerendered head of a share page, and the
// not-found page's noindex line.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider, useLanguage } from '../src/i18n/LanguageContext';
import { applyRouteHead, readShareHead, type ShareHead } from '../src/lib/routeHead';
import { NotFoundPage } from '../src/components/PublicInfoPages';
import { codingShareDescription } from '../src/lib/publicMetadata';

const { result: language } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });
const visit = (pathname: string, shareHead: ShareHead | null = null) => {
  applyRouteHead(pathname, language.current.t, shareHead);
};
const meta = (selector: string) => document.querySelector(selector)?.getAttribute('content');
const canonical = () => document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const robots = () => [...document.querySelectorAll('meta[name="robots"]')].map((node) => node.getAttribute('content'));

// The app shell's head (client/index.html), with no page of its own.
const SHELL_HEAD = `
  <title>devShark</title>
  <meta name="description" content="shell description" />
  <meta property="og:title" content="devShark" />
  <meta property="og:description" content="shell description" />
  <meta property="og:image" content="https://devshark.app/og-image.png?v=20261012" />
  <meta property="og:image:alt" content="devShark — Lessons, quizzes and coding challenges" />
  <meta name="twitter:image" content="https://devshark.app/og-image.png?v=20261012" />
  <meta name="twitter:title" content="devShark" />
  <meta name="twitter:description" content="shell description" />`;

beforeEach(() => {
  document.head.innerHTML = SHELL_HEAD;
  window.history.replaceState(null, '', '/');
});

describe('the tab title', () => {
  it.each([
    ['/quiz', 'Quiz · devShark'],
    ['/learn', 'Learn · devShark'],
    ['/learn/software-engineer', 'Software Engineer · devShark'],
    ['/learn/big-o', 'Big O introduction'],
    ['/curation', 'Page not found · devShark'],
    ['/learn/forward-deployed-engineer/path', 'Forward Deployed Engineer · devShark'],
    ['/learn/forward-deployed-engineer/path/m03', 'Forward Deployed Engineer · devShark'],
    ['/play/ABCD', 'Live match · devShark'],
    ['/coding/javascript', 'Coding · devShark'],
    ['/daily', 'Question of the day · devShark'],
    ['/no-such-page', 'Page not found · devShark'],
    ['/roadmap/paths/not-a-path', 'Page not found · devShark'],
    // React Router renders a trailing slash as the page itself.
    ['/quiz/', 'Quiz · devShark'],
    ['/learn/big-o/', 'Big O introduction'],
    ['/learn/software-engineer/', 'Software Engineer · devShark'],
  ])('%s reads "%s"', (pathname, title) => {
    visit(pathname);
    expect(document.title).toBe(title);
    expect(meta('meta[property="og:title"]')).toBe(title);
  });
});

describe('a share page opened directly', () => {
  const TASK = '/coding/javascript/js-double-numbers';
  const TASK_URL = `https://devshark.app${TASK}`;
  const TASK_TITLE = 'Double the numbers · JavaScript coding challenge · devShark';
  const TASK_TEXT = 'An easy JavaScript coding challenge on devShark, graded on the server.';
  // What vite.config.ts writes into that page's index.html.
  const prerendered = (path: string, title: string, description: string) => {
    document.head.innerHTML = SHELL_HEAD
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/content="shell description"/g, `content="${description}"`)
      .replace(/content="devShark"/g, `content="${title}"`)
      + `<link rel="canonical" href="https://devshark.app${path}" /><meta property="og:url" content="https://devshark.app${path}" />`;
    window.history.replaceState(null, '', path);
    return readShareHead();
  };

  it('keeps the head the build wrote for a coding task', () => {
    const head = prerendered(TASK, TASK_TITLE, TASK_TEXT);
    expect(head).not.toBeNull();
    visit(TASK, head);
    expect(document.title).toBe(TASK_TITLE);
    expect(meta('meta[name="description"]')).toBe(TASK_TEXT);
    expect(meta('meta[property="og:title"]')).toBe(TASK_TITLE);
    expect(meta('meta[name="twitter:description"]')).toBe(TASK_TEXT);
    expect(canonical()).toBe(TASK_URL);
    expect(meta('meta[property="og:url"]')).toBe(TASK_URL);
  });

  it('keeps the head of a dated question of the day', () => {
    const head = prerendered('/daily/2026-09-29', 'JavaScript question of the day, 29 September 2026 · devShark', 'One question a day.');
    visit('/daily/2026-09-29', head);
    expect(document.title).toBe('JavaScript question of the day, 29 September 2026 · devShark');
    expect(canonical()).toBe('https://devshark.app/daily/2026-09-29');
  });

  // C4-4: the Coding home and its track pages carry a head of their own, which
  // used to be the home page's until the app replaced it.
  it.each([
    ['/coding', 'Coding challenges · devShark', 'JavaScript, TypeScript, React and algorithm tasks, graded by running tests.'],
    ['/coding/javascript', 'JavaScript coding challenges · devShark', 'Loops, array methods, closures, and promises, including edge cases.'],
    ['/coding/fullstack', 'FullStack coding challenges · devShark', 'A five-level link shortener.'],
  ])('keeps the head the build wrote for %s', (path, title, description) => {
    const head = prerendered(path, title, description);
    expect(head).not.toBeNull();
    visit(path, head);
    expect(document.title).toBe(title);
    expect(meta('meta[name="description"]')).toBe(description);
    expect(canonical()).toBe(`https://devshark.app${path}`);
    expect(meta('meta[property="og:url"]')).toBe(`https://devshark.app${path}`);
  });

  it('does not keep a section head that names another page or none', () => {
    // /coding/review opens /coding, and names it as canonical.
    expect(prerendered('/coding', 'Coding challenges · devShark', 'Tasks.')).not.toBeNull();
    window.history.replaceState(null, '', '/coding/review');
    expect(readShareHead()).toBeNull();
    // Hidden system design is a noindex not-found page with no canonical.
    document.head.innerHTML = SHELL_HEAD + '<meta name="robots" content="noindex" />';
    window.history.replaceState(null, '', '/coding/system-design');
    expect(readShareHead()).toBeNull();
  });

  it('writes other routes as before, and puts the page’s head back on the way back', () => {
    const head = prerendered(TASK, TASK_TITLE, TASK_TEXT);
    visit(TASK, head);
    visit('/quiz', head);
    expect(document.title).toBe('Quiz · devShark');
    expect(canonical()).toBeNull();
    expect(meta('meta[name="description"]')).not.toBe(TASK_TEXT);
    // Another task reached inside the app has no head of its own here.
    visit('/coding/javascript/js-other-task', head);
    expect(document.title).toBe('Coding · devShark');
    visit(TASK, head);
    expect(document.title).toBe(TASK_TITLE);
    expect(canonical()).toBe(TASK_URL);
  });

  it('switches share images with the active route and restores the original card', () => {
    prerendered(TASK, TASK_TITLE, TASK_TEXT);
    const taskImage = 'https://devshark.app/og/coding/js-double-numbers.png';
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      document.querySelector(selector)?.setAttribute('content', taskImage);
    }
    document.querySelector('meta[property="og:image:alt"]')?.setAttribute('content', TASK_TITLE);
    const head = readShareHead();

    visit('/quiz', head);
    expect(meta('meta[property="og:image"]')).toBe('https://devshark.app/og-image.png?v=20261012');
    expect(meta('meta[property="og:image:alt"]')).toBe('devShark — Lessons, quizzes and coding challenges');
    visit('/daily', head);
    expect(meta('meta[property="og:image"]')).toBe('https://devshark.app/og/daily.png');
    expect(meta('meta[name="twitter:image"]')).toBe('https://devshark.app/og/daily.png');
    expect(meta('meta[property="og:image:alt"]')).toBe('Question of the day · devShark');
    visit(TASK, head);
    expect(meta('meta[property="og:image"]')).toBe(taskImage);
    expect(meta('meta[name="twitter:image"]')).toBe(taskImage);
    expect(meta('meta[property="og:image:alt"]')).toBe(TASK_TITLE);
  });

  it('is not read from the plain shell', () => {
    window.history.replaceState(null, '', TASK);
    expect(readShareHead()).toBeNull();
    // A canonical for another address is not this page's head either.
    document.head.insertAdjacentHTML('beforeend', '<link rel="canonical" href="https://devshark.app/" />');
    expect(readShareHead()).toBeNull();
  });
});

describe('a trailing slash', () => {
  it('keeps a Stripe return and an email link out of search results', () => {
    visit('/premium/success/');
    expect(robots()).toEqual(['noindex']);
    visit('/reset-password/');
    expect(robots()).toEqual(['noindex']);
  });
});

describe('the not-found page', () => {
  it('asks search engines not to index it while it shows, and only then', () => {
    visit('/no-such-page');
    expect(robots()).toEqual([]);
    const page = render(<MemoryRouter><LanguageProvider><NotFoundPage /></LanguageProvider></MemoryRouter>);
    expect(robots()).toEqual(['noindex']);
    // The shell rewrites the head after the page has drawn; the line stays.
    visit('/no-such-page');
    expect(robots()).toEqual(['noindex']);
    page.unmount();
    expect(robots()).toEqual([]);
    visit('/quiz');
    expect(robots()).toEqual([]);
  });
});

describe('a guide address', () => {
  it('keeps an unknown guide out of search results with one robots line', () => {
    visit('/topics/no-such-guide');
    expect(robots()).toEqual(['noindex']);
    visit('/topics/no-such-guide/');
    expect(robots()).toEqual(['noindex']);
  });

  it('leaves a deeper missing guide path to the not-found page’s own line', () => {
    visit('/topics/react/extra');
    const page = render(<MemoryRouter><LanguageProvider><NotFoundPage /></LanguageProvider></MemoryRouter>);
    visit('/topics/react/extra');
    expect(robots()).toEqual(['noindex']);
    page.unmount();
    expect(robots()).toEqual([]);
  });
});

describe('the missing page’s Go back', () => {
  it('goes home from a missing page opened in a new tab, where there is nothing to go back to', () => {
    render(
      <MemoryRouter initialEntries={['/no-such-page']}>
        <LanguageProvider>
          <Routes>
            <Route path="/" element={<p>Home page</p>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });
});

describe('a coding task’s share description', () => {
  // 462 Easy task pages used to read "A easy JavaScript coding challenge".
  it.each([['Easy', 'An easy'], ['Medium', 'A medium'], ['Hard', 'A hard']])('%s reads "%s …"', (difficulty, start) => {
    expect(codingShareDescription({ difficulty, track: 'JavaScript', brand: 'devShark', free: 120, total: 770 }))
      .toBe(`${start} JavaScript coding challenge on devShark, graded on the server. 120 of 770 coding tasks are free.`);
  });
});

for (const [section, name] of [['web-developer', 'Web Developer'], ['software-engineer', 'Software Engineer'], ['forward-deployed-engineer', 'Forward Deployed Engineer']]) {
  it(`${section} keeps the same public title, description and canonical on client navigation`, () => {
    visit(`/learn/${section}`);
    expect(document.title).toBe(`${name} · devShark`);
    expect(canonical()).toBe(`https://devshark.app/learn/${section}`);
    // The prerendered page carries og:url beside its canonical; the app kept
    // the canonical and dropped og:url.
    expect(meta('meta[property="og:url"]')).toBe(`https://devshark.app/learn/${section}`);
    expect(meta('meta[name="description"]')).not.toBe('shell description');
    expect(robots()).toEqual([]);
    visit('/quiz');
    expect(canonical()).toBeNull();
    expect(meta('meta[property="og:url"]')).toBeUndefined();
  });
}
