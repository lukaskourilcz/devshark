import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse, delay } from 'msw';
import { server } from './mocks/server';
import { RouteErrorBoundary } from '../src/components/RouteErrorBoundary';
import {
  RELOAD_COOLDOWN_MS,
  checkServedBuild,
  installChunkErrorTracking,
  isChunkLoadError,
  lazyPage,
  reloadOnPress,
  reloadPage,
  type BuildCheck,
  type Recovery,
} from '../src/lib/routeRecovery';
import { reportError } from '../src/lib/sentry';

vi.mock('../src/lib/sentry', () => ({ reportError: vi.fn(), initSentry: vi.fn() }));

// A page whose code did not load stays inside the shell, and gets its page
// back: in place where the browser asks the network again, by a reload where
// it remembers the failure, never by a reload offline or in a loop.

const STAMP = 'devshark:route-reload';
let online = true;

beforeEach(() => {
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  delete (window.navigator as { onLine?: boolean }).onLine;
  window.sessionStorage.clear();
  vi.mocked(reportError).mockClear();
});

/** What Chromium throws when a page chunk does not load. Each test names its
 * own chunk, because the boundary reports a failure once per page load. */
const chunkError = (name: string) => new TypeError(`Failed to fetch dynamically imported module: http://localhost:3000/assets/${name}.js`);

function fakeRecovery(check: BuildCheck = 'same') {
  const recovery = { checkServedBuild: vi.fn(async () => check), reload: vi.fn() };
  return recovery satisfies Recovery;
}

describe('which errors are chunk failures', () => {
  it('remembers what Vite announced, without cancelling it, and reads the browsers’ own words', () => {
    const uninstall = installChunkErrorTracking();
    const announced = new Error('an unfamiliar message');
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: announced });
    window.dispatchEvent(event);
    // Cancelling it would make Vite resolve the import to undefined.
    expect(event.defaultPrevented).toBe(false);
    expect(isChunkLoadError(announced)).toBe(true);
    uninstall();
    const later = new Error('another unfamiliar message');
    window.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: later }));
    expect(isChunkLoadError(later)).toBe(false);

    expect(isChunkLoadError(chunkError('Chromium'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://devshark.app/assets/A.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/A.css'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloading', () => {
  it('reloads by itself at most once a minute, and always when the learner asks', () => {
    const reload = vi.fn();
    const start = 1_000_000;
    expect(reloadPage(true, reload, start)).toBe(true);
    expect(reloadPage(true, reload, start + 1_000)).toBe(false);
    expect(reloadPage(false, reload, start + 2_000)).toBe(true);
    // The learner's reload stamps too, so an automatic one does not follow it.
    expect(reloadPage(true, reload, start + 2_000 + RELOAD_COOLDOWN_MS - 1)).toBe(false);
    expect(reloadPage(true, reload, start + 2_000 + RELOAD_COOLDOWN_MS)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(3);
    // A stamp from the future means the clock moved: treated as recent.
    window.sessionStorage.setItem(STAMP, String(start + 10 * RELOAD_COOLDOWN_MS));
    expect(reloadPage(true, reload, start + 5 * RELOAD_COOLDOWN_MS)).toBe(false);
  });

  it('never reloads offline, and never by itself without storage to count with', () => {
    const reload = vi.fn();
    online = false;
    expect(reloadPage(true, reload)).toBe(false);
    expect(reloadPage(false, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    online = true;
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(reloadPage(true, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(reloadPage(false, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });
});

describe('reloading on a press', () => {
  it('does not reload a successor page while an older retry checks the build', async () => {
    let answer!: (value: BuildCheck) => void;
    const recovery = { checkServedBuild: () => new Promise<BuildCheck>((resolve) => { answer = resolve; }), reload: vi.fn() };
    const original = window.location.href;
    try {
      window.history.replaceState(null, '', '/coding');
      const retry = reloadOnPress(recovery);
      window.history.replaceState(null, '', '/quiz');
      answer('same');
      await expect(retry).resolves.toBe(false);
      expect(recovery.reload).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(STAMP)).toBeNull();
    } finally {
      window.history.replaceState(null, '', original);
    }
  });

  it('reloads while the server answers, whatever the automatic guard says, and never offline', async () => {
    // An automatic reload a moment ago rations the automatic ones only.
    window.sessionStorage.setItem(STAMP, String(Date.now()));
    const recovery = fakeRecovery();
    await expect(reloadOnPress(recovery)).resolves.toBe(true);
    expect(recovery.reload).toHaveBeenCalledTimes(1);

    const unreachable = fakeRecovery('unreachable');
    await expect(reloadOnPress(unreachable)).resolves.toBe(false);
    expect(unreachable.reload).not.toHaveBeenCalled();

    online = false;
    const offline = fakeRecovery();
    await expect(reloadOnPress(offline)).resolves.toBe(false);
    expect(offline.checkServedBuild).not.toHaveBeenCalled();
    expect(offline.reload).not.toHaveBeenCalled();
  });
});

describe('the served build', () => {
  const page = (entry: string) => `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script></head><body></body></html>`;
  let script: HTMLScriptElement;
  beforeEach(() => {
    script = document.createElement('script');
    script.type = 'module';
    script.setAttribute('src', '/assets/main-AAAA.js');
    document.head.append(script);
  });
  afterEach(() => script.remove());

  it('compares the entry script of a fresh index.html with this page’s', async () => {
    let requests = 0;
    let body = page('/assets/main-AAAA.js');
    server.use(http.get('http://localhost:3000/', ({ request }) => {
      requests += 1;
      expect(request.cache).toBe('no-store');
      return new HttpResponse(body, { headers: { 'content-type': 'text/html' } });
    }));
    await expect(checkServedBuild()).resolves.toBe('same');
    body = page('/assets/main-BBBB.js');
    await expect(checkServedBuild()).resolves.toBe('newer');
    expect(requests).toBe(2);
  });

  it('does not reload into a successful response that is not an app shell', async () => {
    server.use(http.get('http://localhost:3000/', () => new HttpResponse('<h1>Temporarily unavailable</h1>', {
      headers: { 'content-type': 'text/html' },
    })));
    await expect(checkServedBuild()).resolves.toBe('unreachable');
  });

  it('calls a failed, refused or slow answer unreachable', async () => {
    server.use(http.get('http://localhost:3000/', () => HttpResponse.error()));
    await expect(checkServedBuild()).resolves.toBe('unreachable');
    server.use(http.get('http://localhost:3000/', () => new HttpResponse('down', { status: 503 })));
    await expect(checkServedBuild()).resolves.toBe('unreachable');
    server.use(http.get('http://localhost:3000/', async () => {
      await delay(500);
      return new HttpResponse(page('/assets/main-BBBB.js'), { headers: { 'content-type': 'text/html' } });
    }));
    await expect(checkServedBuild(50)).resolves.toBe('unreachable');
  });
});

describe('the route error boundary', () => {
  // App.tsx's arrangement: the Suspense outside, a box keyed by the path, the
  // boundary inside it, and the chrome around all of it.
  function Shell({ recovery, pages }: { recovery: Recovery; pages: Record<string, React.ComponentType> }) {
    const location = useLocation();
    return (
      <>
        <nav>
          {Object.keys(pages).map((path) => <Link key={path} to={path}>{`go ${path}`}</Link>)}
        </nav>
        <Suspense fallback={<p>loading</p>}>
          <div key={location.pathname}>
            <RouteErrorBoundary recovery={recovery}>
              <Routes location={location}>
                {Object.entries(pages).map(([path, Page]) => <Route key={path} path={path} element={<Page />} />)}
              </Routes>
            </RouteErrorBoundary>
          </div>
        </Suspense>
        <footer>the footer</footer>
      </>
    );
  }
  const mount = async (recovery: Recovery, pages: Record<string, React.ComponentType>, at: string) => {
    await act(async () => {
      render(<MemoryRouter initialEntries={[at]}><Shell recovery={recovery} pages={pages} /></MemoryRouter>);
    });
  };
  const panel = () => screen.findByRole('alert');
  const tryAgain = async () => {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
  };
  const loads = (name: string, outcomes: ('fail' | 'load')[]) => vi.fn(async () => {
    const outcome = outcomes.length > 1 ? outcomes.shift() : outcomes[0];
    if (outcome === 'fail') throw chunkError(name);
    return { default: () => <p>{`${name} page`}</p> };
  });

  it('ignores a lazy route failure that arrives after leaving that address', async () => {
    let fail!: (error: Error) => void;
    const load = vi.fn(() => new Promise<{ default: React.ComponentType }>((_, reject) => { fail = reject; }));
    const recovery = fakeRecovery('newer');
    const original = window.location.href;
    try {
      window.history.replaceState(null, '', '/coding');
      await mount(recovery, { '/coding': lazyPage(load, recovery), '/quiz': () => <p>the quiz</p> }, '/coding');
      expect(load).toHaveBeenCalledTimes(1);
      window.history.replaceState(null, '', '/quiz');
      await act(async () => fireEvent.click(screen.getByText('go /quiz')));
      await act(async () => fail(chunkError('RetiredRoute')));
      expect(await screen.findByText('the quiz')).toBeInTheDocument();
      expect(recovery.checkServedBuild).not.toHaveBeenCalled();
      expect(recovery.reload).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, '', original);
    }
  });

  it('keeps the shell, says what happened and reports the failure once', async () => {
    const recovery = fakeRecovery();
    const load = loads('Shell', ['fail']);
    await mount(recovery, { '/coding': lazyPage(load, recovery) }, '/coding');
    expect(await panel()).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('alert')).toHaveTextContent('Network error. Check your connection and try again.');
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('the footer')).toBeInTheDocument();
    // The build was checked once, before the error showed, and it is the same.
    expect(recovery.checkServedBuild).toHaveBeenCalledTimes(1);
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.any(TypeError), expect.objectContaining({ chunkLoad: true }));
  });

  it('draws the page in place when asking again works, as in browsers that forget a failed fetch', async () => {
    const recovery = fakeRecovery();
    const load = loads('InPlace', ['fail', 'load']);
    await mount(recovery, { '/coding': lazyPage(load, recovery) }, '/coding');
    await panel();
    await tryAgain();
    expect(await screen.findByText('InPlace page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('reloads the address when the same failure comes straight back, and reports it once', async () => {
    // A reload a moment ago rations the automatic ones, not the learner's press.
    window.sessionStorage.setItem(STAMP, String(Date.now()));
    const recovery = fakeRecovery();
    const load = loads('Remembered', ['fail']);
    await mount(recovery, { '/coding': lazyPage(load, recovery) }, '/coding');
    await panel();
    await tryAgain();
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(2);
    // Busy until the new document arrives, and still a button to keep focus on.
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('opens another page without a retry, and asks again on the next visit', async () => {
    const recovery = fakeRecovery();
    const load = loads('Leave', ['fail', 'load']);
    const Other = () => <p>other page</p>;
    await mount(recovery, { '/coding': lazyPage(load, recovery), '/quiz': Other }, '/coding');
    await panel();
    await act(async () => fireEvent.click(screen.getByText('go /quiz')));
    expect(await screen.findByText('other page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => fireEvent.click(screen.getByText('go /coding')));
    expect(await screen.findByText('Leave page')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('offline, checks nothing and reloads nothing; the connection coming back tries again', async () => {
    online = false;
    const recovery = fakeRecovery();
    const load = loads('Offline', ['fail', 'fail']);
    await mount(recovery, { '/coding': lazyPage(load, recovery) }, '/coding');
    await panel();
    await tryAgain();
    await panel();
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    expect(recovery.reload).not.toHaveBeenCalled();

    // Back online the page is asked for again. It still fails here, as in a
    // browser that remembers the failure, so the tab reloads, once.
    online = true;
    await act(async () => window.dispatchEvent(new Event('online')));
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(3);
    expect(window.sessionStorage.getItem(STAMP)).not.toBeNull();
  });

  it('does not reload by itself twice within a minute when the connection returns', async () => {
    window.sessionStorage.setItem(STAMP, String(Date.now()));
    online = false;
    const recovery = fakeRecovery();
    const load = loads('Guarded', ['fail']);
    await mount(recovery, { '/coding': lazyPage(load, recovery) }, '/coding');
    await panel();
    online = true;
    await act(async () => window.dispatchEvent(new Event('online')));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await panel();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveAttribute('aria-busy'));
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('reloads for a newer build before any error shows, and not again within a minute', async () => {
    const recovery = fakeRecovery('newer');
    const load = loads('Deployed', ['fail']);
    await mount(recovery, { '/coding': lazyPage(load, recovery) }, '/coding');
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    // The page waits for the reload to replace the document.
    expect(screen.queryByRole('alert')).toBeNull();

    // The same tab a moment later, still on the old build: the guard holds.
    const again = fakeRecovery('newer');
    await mount(again, { '/coding': lazyPage(loads('DeployedAgain', ['fail']), again) }, '/coding');
    expect(await panel()).toHaveTextContent('Something went wrong');
    expect(again.reload).not.toHaveBeenCalled();
  });

  it('reloads for a failed stylesheet without drawing the page again', async () => {
    const recovery = fakeRecovery();
    const load = vi.fn(async (): Promise<{ default: React.ComponentType }> => {
      throw new Error('Unable to preload CSS for /assets/Stylesheet.css');
    });
    await mount(recovery, { '/coding': lazyPage(load, recovery) }, '/coding');
    await panel();
    await tryAgain();
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the root screen’s two choices for a page that threw, and checks nothing', async () => {
    const recovery = fakeRecovery();
    let broken = true;
    const Throws = () => {
      if (broken) throw new Error('a bug in the page');
      return <p>fixed page</p>;
    };
    await mount(recovery, { '/coding': Throws }, '/coding');
    expect(await panel()).toHaveTextContent('The page hit an unexpected error. Reloading usually fixes it.');
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.not.objectContaining({ chunkLoad: true }));
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    broken = false;
    await tryAgain();
    expect(await screen.findByText('fixed page')).toBeInTheDocument();

    broken = true;
    await mount(recovery, { '/other': Throws }, '/other');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reload page' })));
    expect(recovery.reload).toHaveBeenCalledTimes(1);
  });
});
