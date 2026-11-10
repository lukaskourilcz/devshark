// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

import { Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, onlineManager, queryOptions } from '@tanstack/react-query';
import { installIntentPreloading, preloadPath, routeBoxKey, routeChunk } from '../src/lib/routePreload';
import { FIRST_DATA_WAIT_MS, lazyPart, readOnce, settled, useFirstData } from '../src/lib/routeData';
import { firstDraw, headings } from './firstDraw';
import { RouteErrorBoundary } from '../src/components/RouteErrorBoundary';
import { server } from './mocks/server';

const pathScreens = vi.hoisted(() => ({ loaded: false }));
vi.mock('../src/components/paths/LearningPathScreens', () => {
  pathScreens.loaded = true;
  return { FdeOverview: () => null, FdeModule: () => null };
});
// The pages whose chunk a prefix matcher used to preload for any deeper path.
const pageChunks = vi.hoisted(() => new Set<string>());
vi.mock('../src/components/Roadmap', () => { pageChunks.add('learn'); return { default: () => null, BigOIntroduction: () => null }; });
// /learn/big-o's own module (#587 C17), apart from the Learn map's.
const bigOIntroduction = vi.hoisted(() => ({ loaded: false }));
vi.mock('../src/components/learn/BigOIntroduction', () => { bigOIntroduction.loaded = true; return { BigOIntroduction: () => null }; });
vi.mock('../src/components/Play', () => { pageChunks.add('play'); return { PlayLanding: () => null, PlayMatch: () => null }; });
vi.mock('../src/components/coding/CodingSection', () => {
  pageChunks.add('coding');
  return { CodingHome: () => null, CodingTrackScreen: () => null, FullStackScreen: () => null, CodingTaskScreen: () => null, CodingReviewScreen: () => null };
});
vi.mock('../src/components/dev/DevPage', () => { pageChunks.add('dev'); return { default: () => null }; });
vi.mock('../src/components/TopicLandingPage', () => { pageChunks.add('topics'); return { default: () => null }; });
vi.mock('../src/components/DailyQuestionPage', () => { pageChunks.add('daily'); return { default: () => null }; });

// The two halves of a navigation that draws once: the next page's code starts
// loading on intent, and a page can hold its first render for its data.

describe('route chunks', () => {
  it('imports a page once, however many links and routes ask for it', async () => {
    const load = vi.fn(async () => ({ default: () => null }));
    const loader = routeChunk((path) => path === '/chunk-once', load);
    preloadPath('/chunk-once');
    preloadPath('/chunk-once');
    const first = loader();
    await first;
    expect(loader()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    preloadPath('/not-a-page');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks the network again after a failed fetch', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: () => null });
    const loader = routeChunk((path) => path === '/chunk-retry', load);
    await expect(loader()).rejects.toThrow('Failed to fetch');
    await expect(loader()).resolves.toHaveProperty('default');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('the app\'s route chunks', () => {
  it('loads the path screens for the FDE path\'s pages, not for the old /roadmap/paths redirects', async () => {
    await import('../src/App');
    pathScreens.loaded = false;
    await preloadPath('/roadmap/paths/dsa-foundations');
    expect(pathScreens.loaded).toBe(false);
    await preloadPath('/learn/forward-deployed-engineer/path/m03/extra');
    expect(pathScreens.loaded).toBe(false);
    await preloadPath('/learn/forward-deployed-engineer/path/m03');
    expect(pathScreens.loaded).toBe(true);
  }, 60_000);

  // Perf baseline #587 C17: the two-button /learn/big-o page downloaded the
  // whole Learn map chunk. Before any other test here loads the map, so a
  // map load would register.
  it('loads the Big O introduction’s own module for /learn/big-o, and not the Learn map’s', async () => {
    await import('../src/App');
    pageChunks.clear();
    await preloadPath('/learn/big-o');
    await preloadPath('/learn/big-o/');
    expect(bigOIntroduction.loaded).toBe(true);
    expect(pageChunks.has('learn')).toBe(false);
  }, 60_000);

  // Software Engineer audit item 23: a deeper path no route serves draws the
  // 404 page, so it must not fetch the chunk of the page above it.
  it('preloads a page only for the paths its routes serve', async () => {
    await import('../src/App');
    pageChunks.clear();
    for (const path of ['/learn/web-developer/extra', '/play/ABCD/extra', '/coding/javascript/task/extra', '/dev/extra', '/topics', '/topics/react/extra', '/daily/2026-10-23/extra', '/learning', '/player']) {
      await preloadPath(path);
    }
    expect([...pageChunks]).toEqual([]);
    for (const path of ['/learn/web-developer/', '/learn/big-o', '/play/ABCD', '/coding/javascript/task-1', '/dev', '/topics/react', '/daily/2026-10-23']) {
      await preloadPath(path);
    }
    expect([...pageChunks].sort()).toEqual(['coding', 'daily', 'dev', 'learn', 'play', 'topics']);
  }, 60_000);
});

describe('route box key', () => {
  it('gives every Learn section one box and leaves other pages on their own path', () => {
    expect(routeBoxKey('/learn')).toBe('/learn');
    expect(routeBoxKey('/learn/')).toBe('/learn');
    expect(routeBoxKey('/learn/web-developer')).toBe('/learn');
    expect(routeBoxKey('/learn/software-engineer/')).toBe('/learn');
    expect(routeBoxKey('/learn/big-o')).toBe('/learn/big-o');
    expect(routeBoxKey('/learning')).toBe('/learning');
    expect(routeBoxKey('/learn/x/y')).toBe('/learn/x/y');
    expect(routeBoxKey('/roadmap')).toBe('/roadmap');
  });
});

describe('intent preloading', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });
  const link = (href: string, attrs: Record<string, string> = {}) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = href;
    for (const [name, value] of Object.entries(attrs)) anchor.setAttribute(name, value);
    document.body.append(anchor);
    return anchor;
  };

  it('starts a page on focus and on the first press, before the click', () => {
    const load = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-focus', load);
    uninstall = installIntentPreloading();
    link('/intent-focus').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);

    const pressLoad = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-press', pressLoad);
    const pressed = link('/intent-press');
    pressed.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(pressLoad).toHaveBeenCalledTimes(1);
  });

  it('waits for a resting mouse, not a passing one', () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({}));
    const passing = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-rest', load);
    routeChunk((path) => path === '/intent-pass', passing);
    uninstall = installIntentPreloading();
    const over = (element: Element) => {
      const event = new Event('pointerover', { bubbles: true });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      element.dispatchEvent(event);
    };
    over(link('/intent-pass'));
    over(link('/intent-rest'));
    vi.advanceTimersByTime(100);
    expect(passing).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cancels a hover that leaves the window before showing intent', () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-window-exit', load);
    uninstall = installIntentPreloading();
    const anchor = link('/intent-window-exit');
    anchor.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    vi.advanceTimersByTime(25);
    anchor.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: null }));
    vi.advanceTimersByTime(100);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the hover delay while the mouse moves within the same link', () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-nested-link', load);
    uninstall = installIntentPreloading();
    const anchor = link('/intent-nested-link');
    const icon = document.createElement('span');
    anchor.append(icon);
    anchor.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    vi.advanceTimersByTime(45);
    anchor.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: icon }));
    icon.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', relatedTarget: anchor }));
    vi.advanceTimersByTime(30);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads nothing on intent for a visitor who asked the browser to save data', () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-save-data', load);
    uninstall = installIntentPreloading();
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    try {
      const anchor = link('/intent-save-data');
      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      anchor.dispatchEvent(new Event('touchstart', { bubbles: true }));
      anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      const over = new Event('pointerover', { bubbles: true });
      Object.defineProperty(over, 'pointerType', { value: 'mouse' });
      anchor.dispatchEvent(over);
      vi.advanceTimersByTime(100);
      expect(load).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
  });

  // The click after a left press loads the page anyway, so skipping the press
  // saved no data and only made the page arrive later.
  it('still loads on a left mouse press for a visitor who asked the browser to save data', () => {
    const load = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-save-data-press', load);
    uninstall = installIntentPreloading();
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    try {
      const anchor = link('/intent-save-data-press');
      const press = (button: number) => {
        const down = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(down, 'pointerType', { value: 'mouse' });
        Object.defineProperty(down, 'button', { value: button });
        anchor.dispatchEvent(down);
      };
      press(2);
      expect(load).not.toHaveBeenCalled();
      press(0);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
  });

  it('reads a chrome button’s data-route, and ignores new tabs, other sites and the current page', () => {
    const button = vi.fn(async () => ({}));
    const elsewhere = vi.fn(async () => ({}));
    routeChunk((path) => path === '/intent-button', button);
    routeChunk((path) => path === '/intent-elsewhere', elsewhere);
    uninstall = installIntentPreloading();
    const chrome = document.createElement('button');
    chrome.dataset.route = '/intent-button';
    chrome.innerHTML = '<svg></svg>';
    document.body.append(chrome);
    chrome.firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(button).toHaveBeenCalledTimes(1);

    link('/intent-elsewhere', { target: '_blank' }).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    link('https://example.com/intent-elsewhere').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(elsewhere).not.toHaveBeenCalled();

    const here = vi.fn(async () => ({}));
    routeChunk((path) => path === window.location.pathname, here);
    link(window.location.pathname).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(here).not.toHaveBeenCalled();
  });
});

describe('first data', () => {
  afterEach(() => vi.useRealTimers());

  function Page({ dataKey, load, label }: { dataKey: string | null; load: () => Promise<unknown>; label: string }) {
    useFirstData(dataKey, load);
    return <p>{label}</p>;
  }
  const tree = (page: ReactNode, entry = '/page') => (
    <MemoryRouter initialEntries={[entry]}>
      <Suspense fallback={<p>fallback</p>}>{page}</Suspense>
    </MemoryRouter>
  );
  // A suspending render has to happen inside an awaited act.
  const mount = async (page: ReactNode, entry = '/page') => {
    let view: ReturnType<typeof render> | null = null;
    await act(async () => { view = render(tree(page, entry)); });
    return view as unknown as ReturnType<typeof render>;
  };

  it('reads what the cache holds, stale or not, and fetches the rest once', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 1000 } } });
    const cachedFn = vi.fn(async () => 'fresh');
    const cached = queryOptions({ queryKey: ['cached'], queryFn: cachedFn, staleTime: 0 });
    client.setQueryData(cached.queryKey, 'stale');
    await expect(readOnce(client, cached)).resolves.toBe('stale');
    expect(cachedFn).not.toHaveBeenCalled();

    const failing = vi.fn(async () => { throw new Error('502'); });
    const started = Date.now();
    await expect(readOnce(client, queryOptions({ queryKey: ['failing'], queryFn: failing }))).rejects.toThrow('502');
    expect(failing).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('waits for every read and keeps none of the failures', async () => {
    let late: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => { late = resolve; });
    let done = false;
    const all = settled([Promise.reject(new Error('offline')), null, slow]).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    late();
    await all;
    expect(done).toBe(true);
  });

  it('renders at once when there is nothing to wait for', async () => {
    const load = vi.fn(async () => undefined);
    await mount(<Page dataKey={null} load={load} label="page" />);
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it('renders at once offline, whether the browser or the query client says so', async () => {
    const load = vi.fn(() => new Promise(() => undefined));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      await mount(<Page dataKey="offline-browser" load={load} label="offline page" />, '/offline-browser');
      expect(screen.getByText('offline page')).toBeInTheDocument();
    } finally {
      online.mockRestore();
    }
    // The query client pauses its reads while it believes it is offline, so a
    // read the page waited for would only run out the cap.
    onlineManager.setOnline(false);
    try {
      await mount(<Page dataKey="offline-client" load={load} label="paused page" />, '/offline-client');
      expect(screen.getByText('paused page')).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('holds the first render until the data is in, then never again', async () => {
    let answer: () => void = () => undefined;
    const load = vi.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    const view = await mount(<Page dataKey="account-1" load={load} label="with data" />);
    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(screen.queryByText('with data')).toBeNull();
    await act(async () => answer());
    // React reveals a boundary that showed its fallback no sooner than 300ms
    // after it did; in the app the fallback never shows during a navigation.
    expect(await screen.findByText('with data')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);

    // A later change (another account, a refetch) redraws in place.
    view.rerender(tree(<Page dataKey="account-2" load={load} label="redrawn" />));
    expect(screen.getByText('redrawn')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting after the cap, and a failed load does not block the page', async () => {
    vi.useFakeTimers();
    await mount(<Page dataKey="slow" load={() => new Promise(() => undefined)} label="own loading state" />, '/slow');
    expect(screen.getByText('fallback')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(FIRST_DATA_WAIT_MS - 1); });
    expect(screen.queryByText('own loading state')).toBeNull();
    // The cap, then React's reveal throttle.
    await act(async () => { vi.advanceTimersByTime(1 + 400); });
    expect(screen.getByText('own loading state')).toBeInTheDocument();

    vi.useRealTimers();
    await mount(<Page dataKey="failing" load={() => Promise.reject(new Error('offline'))} label="own error state" />, '/failing');
    expect(await screen.findByText('own error state')).toBeInTheDocument();
  });
});

describe('lazy parts', () => {
  function Section({ label }: { label: string }) {
    return <h2>{label}</h2>;
  }
  function Page({ load, part }: { load: () => Promise<unknown>; part: ReactNode }) {
    useFirstData('parts', load);
    return <main><h1>Page</h1>{part}</main>;
  }

  it('draws a part the hold loaded in the same frame as the page', async () => {
    const part = lazyPart(async () => Section);
    const drawn = firstDraw('h1', headings);
    await act(async () => {
      render(<MemoryRouter initialEntries={['/with-part']}><Page load={part.load} part={<part.Part label="Due today" />} /></MemoryRouter>);
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Due today' })).toBeInTheDocument();
    expect(drawn()).toEqual(['Page', 'Due today']);
  });

  it('loads a part nobody waited for on mount, and draws nothing until it arrives', async () => {
    let arrive: (component: typeof Section) => void = () => undefined;
    const importPart = vi.fn(() => new Promise<typeof Section>((resolve) => { arrive = resolve; }));
    const part = lazyPart(importPart);
    const drawn = firstDraw('h1', headings);
    await act(async () => {
      render(<MemoryRouter><main><h1>Page</h1><part.Part label="Arrives later" /></main></MemoryRouter>);
    });
    expect(drawn()).toEqual(['Page']);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    await act(async () => arrive(Section));
    expect(await screen.findByRole('heading', { level: 2, name: 'Arrives later' })).toBeInTheDocument();
    expect(importPart).toHaveBeenCalledTimes(1);
  });

  it('fails its page as a page chunk does, and Try again asks for it afresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The build check a failed chunk makes before the error shows: the same build.
    server.use(http.get('*/', () => new HttpResponse('<!doctype html><html><head></head><body></body></html>', { headers: { 'content-type': 'text/html' } })));
    const importPart = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/Part.js'))
      .mockResolvedValueOnce(Section);
    const part = lazyPart<{ label: string }>(importPart);
    const recovery = { checkServedBuild: vi.fn(async () => 'same' as const), reload: vi.fn() };
    await act(async () => {
      render(
        <MemoryRouter>
          <RouteErrorBoundary recovery={recovery}>
            <main><h1>Page</h1><part.Part label="Asked again" /></main>
          </RouteErrorBoundary>
        </MemoryRouter>,
      );
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect(await screen.findByRole('heading', { level: 2, name: 'Asked again' })).toBeInTheDocument();
    expect(importPart).toHaveBeenCalledTimes(2);
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('asks the network again after a part failed to load', async () => {
    const importPart = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(Section);
    const part = lazyPart<{ label: string }>(importPart);
    await expect(part.load()).rejects.toThrow('Failed to fetch');
    await expect(part.load()).resolves.toBe(Section);
    expect(part.load()).toBe(part.load());
    expect(importPart).toHaveBeenCalledTimes(2);
  });
});
