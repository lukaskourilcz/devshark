// The lazy parts of the shell outside the route boundary (the account button,
// the upgrade sheet) used to take a failed chunk to the root error screen, and
// the header, the nav and the page went with it. Each now has its own boundary
// with a quiet fallback, and asks again on the learner's press.
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShellPartBoundary } from '../src/components/ShellPartBoundary';
import { lazyShellPart, type BuildCheck, type Recovery } from '../src/lib/routeRecovery';
import { reportError } from '../src/lib/sentry';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { closeUpgradeSheet, openUpgradeSheet, takeUpgradeResume } from '../src/lib/upgradeSheet';
import UpgradeSheetHost from '../src/components/UpgradeSheetHost';

vi.mock('../src/lib/sentry', () => ({ reportError: vi.fn(), initSentry: vi.fn() }));
// The sheet's code "does not load": rendering it throws the error Chromium
// reports for a chunk, which is what the lazy part throws when its import fails.
const sheet = vi.hoisted(() => ({ fails: true }));
vi.mock('../src/components/UpgradeSheet', () => ({
  default: () => {
    if (sheet.fails) throw new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/UpgradeSheet-AAAA.js');
    return <div role="dialog" aria-label="Premium opens this">the sheet</div>;
  },
}));

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
  closeUpgradeSheet();
});

const chunkError = (name: string) => new TypeError(`Failed to fetch dynamically imported module: http://localhost:3000/assets/${name}.js`);
function fakeRecovery(check: BuildCheck = 'same') {
  return { checkServedBuild: vi.fn(async () => check), reload: vi.fn() } satisfies Recovery;
}
/** Each load takes the next outcome; the last one repeats. */
const loads = (name: string, outcomes: ('fail' | 'load')[]) => vi.fn(async () => {
  const outcome = outcomes.length > 1 ? outcomes.shift() : outcomes[0];
  if (outcome === 'fail') throw chunkError(name);
  return { default: () => <button type="button">{`${name} part`}</button> };
});

// App.tsx's arrangement in the header: the Suspense outside, the boundary
// inside it, and the rest of the shell around it.
async function mountHeader(Part: React.ComponentType, recovery: Recovery) {
  await act(async () => {
    render(
      <>
        <nav>the nav</nav>
        <Suspense fallback={<span>placeholder</span>}>
          <ShellPartBoundary recovery={recovery} fallback={(retry, busy) => <button type="button" onClick={retry} aria-busy={busy || undefined}>Try again</button>}>
            <Part />
          </ShellPartBoundary>
        </Suspense>
        <main>the page</main>
      </>,
    );
  });
}
const retry = async () => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
};

describe('a shell part whose code did not load', () => {
  it('keeps the shell and the page, reports once, and checks or reloads nothing by itself', async () => {
    const recovery = fakeRecovery();
    await mountHeader(lazyShellPart(loads('Quiet', ['fail'])), recovery);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('the nav')).toBeInTheDocument();
    expect(screen.getByText('the page')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.any(TypeError), expect.objectContaining({ chunkLoad: true }));
  });

  it('draws the part in place when asking again works, and focus moves into it', async () => {
    const recovery = fakeRecovery();
    const load = loads('InPlace', ['fail', 'load']);
    await mountHeader(lazyShellPart(load), recovery);
    screen.getByRole('button', { name: 'Try again' }).focus();
    await retry();
    const part = await screen.findByRole('button', { name: 'InPlace part' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(part);
  });

  it('reloads on the press when the same failure comes straight back, and stays busy for it', async () => {
    const recovery = fakeRecovery();
    const load = loads('Remembered', ['fail']);
    await mountHeader(lazyShellPart(load), recovery);
    await retry();
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('does not reload offline or while the server does not answer', async () => {
    const unreachable = fakeRecovery('unreachable');
    await mountHeader(lazyShellPart(loads('Unreachable', ['fail'])), unreachable);
    await retry();
    await vi.waitFor(() => expect(unreachable.checkServedBuild).toHaveBeenCalledTimes(1));
    expect(unreachable.reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveAttribute('aria-busy'));
  });

  it('renders a part that threw again on retry, without checking or reloading', async () => {
    const recovery = fakeRecovery();
    let broken = true;
    const Throws = () => {
      if (broken) throw new Error('a bug in the part');
      return <button type="button">fixed part</button>;
    };
    await mountHeader(Throws, recovery);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.not.objectContaining({ chunkLoad: true }));
    await retry();
    await screen.findByRole('button', { name: 'Try again' });
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    broken = false;
    await retry();
    expect(await screen.findByRole('button', { name: 'fixed part' })).toBeInTheDocument();
    expect(recovery.reload).not.toHaveBeenCalled();
  });
});

describe('a shell part whose stylesheet did not load', () => {
  const styledPart = (name: string) => {
    let first = true;
    return vi.fn(async () => {
      if (first) {
        first = false;
        throw new Error(`Unable to preload CSS for /assets/${name}.css`);
      }
      // Vite remembers the failed CSS dependency and may resolve the next
      // import without requesting it. Rendering this part would be unstyled.
      return { default: () => <button type="button">{`${name} unstyled part`}</button> };
    });
  };

  it('keeps its fallback until a pressed reload can fetch its stylesheet afresh', async () => {
    const recovery = fakeRecovery();
    const load = styledPart('StyledMenu');
    await mountHeader(lazyShellPart(load), recovery);
    await screen.findByRole('button', { name: 'Try again' });
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    expect(recovery.reload).not.toHaveBeenCalled();
    await retry();
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'StyledMenu unstyled part' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('the nav')).toBeInTheDocument();
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it.each(['offline', 'unreachable'] as const)('keeps the fallback usable while %s, then allows another pressed recovery', async (condition) => {
    const recovery = fakeRecovery();
    if (condition === 'unreachable') recovery.checkServedBuild.mockResolvedValueOnce('unreachable');
    const load = styledPart(`StyledMenu-${condition}`);
    await mountHeader(lazyShellPart(load), recovery);
    await screen.findByRole('button', { name: 'Try again' });
    if (condition === 'offline') online = false;
    await retry();
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveAttribute('aria-busy'));
    online = true;
    await retry();
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('the upgrade sheet', () => {
  async function mountHost(recovery: Recovery = fakeRecovery()) {
    let unmount = () => undefined as void;
    await act(async () => {
      ({ unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <LanguageProvider>
              <main>the page</main>
              <UpgradeSheetHost recovery={recovery} />
            </LanguageProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      ));
    });
    return unmount;
  }

  it('closes when its code does not load and says so, and opens on the next request', async () => {
    sheet.fails = true;
    await mountHost();
    await act(async () => openUpgradeSheet({ kind: 'learn-level', ref: 'react:13' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error. Check your connection and try again.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('the page')).toBeInTheDocument();

    sheet.fails = false;
    await act(async () => openUpgradeSheet({ kind: 'learn-level', ref: 'react:13' }));
    expect(await screen.findByRole('dialog', { name: 'Premium opens this' })).toBeInTheDocument();
  });

  // Chromium up to 155 and Safari answer a second import of a failed module
  // from memory, so asking again in place fails at once without a request.
  it('reloads on a press that meets the failure again, and the next document opens the sheet', async () => {
    sheet.fails = true;
    const recovery = fakeRecovery();
    const unmount = await mountHost(recovery);
    await act(async () => openUpgradeSheet({ kind: 'coding-task', ref: 'js-double-numbers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error.');
    expect(recovery.reload).not.toHaveBeenCalled();

    await act(async () => openUpgradeSheet({ kind: 'coding-task', ref: 'js-double-numbers' }));
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(JSON.parse(window.sessionStorage.getItem('devshark:upgrade-resume') ?? '{}')).toMatchObject({ kind: 'coding-task', ref: 'js-double-numbers' });

    // The next document: the sheet's code loads, and the sheet opens by itself.
    unmount();
    sheet.fails = false;
    await mountHost();
    expect(await screen.findByRole('dialog', { name: 'Premium opens this' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('devshark:upgrade-resume')).toBeNull();
  });

  it('never reloads for a 402 nobody pressed for', async () => {
    sheet.fails = true;
    const recovery = fakeRecovery();
    await mountHost(recovery);
    await act(async () => openUpgradeSheet({ kind: 'coding-task', ref: 'a', fromResponse: true }));
    await screen.findByRole('alert');
    await act(async () => openUpgradeSheet({ kind: 'coding-task', ref: 'a', fromResponse: true }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('devshark:upgrade-resume')).toBeNull();
  });

  it('does not reload while the server does not answer, and says why', async () => {
    sheet.fails = true;
    const recovery = fakeRecovery('unreachable');
    await mountHost(recovery);
    await act(async () => openUpgradeSheet({}));
    await screen.findByRole('alert');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })));
    await act(async () => openUpgradeSheet({}));
    await vi.waitFor(() => expect(recovery.checkServedBuild).toHaveBeenCalledTimes(1));
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error.');
    expect(window.sessionStorage.getItem('devshark:upgrade-resume')).toBeNull();
  });

  it('ignores a stale or foreign mark', async () => {
    sheet.fails = false;
    window.sessionStorage.setItem('devshark:upgrade-resume', JSON.stringify({ kind: 'coding-task', at: Date.now() - 61_000 }));
    await mountHost();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(takeUpgradeResume()).toBeNull();
    window.sessionStorage.setItem('devshark:upgrade-resume', JSON.stringify({ kind: 'not-a-kind', ref: 7, at: Date.now() }));
    expect(takeUpgradeResume()).toEqual({ kind: undefined, ref: undefined });
  });
});
