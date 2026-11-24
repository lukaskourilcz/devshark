// The GitHub garden card on the profile. The garden stays hidden until the
// deployment has the GitHub App configured: github-connection answers
// `available: false` until then, and the card renders nothing rather than a
// "not enabled on this deployment" notice on every learner's profile.
import { checkEscapeReturn, installNativeDialog } from './dialog-escape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { en } from '../src/i18n/translations';
import { GithubGardenCard } from '../src/components/coding/GithubGardenCard';
import { codingKeys } from '../src/coding/api';
import { clearAccountData } from '../src/lib/accountData';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({ value: { user: { id: 'user-1' } as { id: string } | null, isAuthenticated: true, isLoading: false } }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
afterEach(() => { auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false }; });

// What api/user/[op].ts answers for github-connection (lib/github-handlers.ts).
const UNAVAILABLE = { available: false, status: 'not_connected', accountLogin: null, repoFullName: null, defaultBranch: null, lastCommitAt: null, queued: 0, lastError: null };
const NOT_CONNECTED = { ...UNAVAILABLE, available: true };

function answer(body: () => Promise<Response> | Response) {
  server.use(http.get('*/api/user/*', ({ request }) => {
    if (new URL(request.url).searchParams.get('op') !== 'github-connection') return HttpResponse.json({ error: { code: 'unknown_op', message: 'Unknown user op' } }, { status: 404 });
    return body();
  }));
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LanguageProvider><GithubGardenCard /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const ACTIVE = { ...NOT_CONNECTED, status: 'active', accountLogin: 'garden-owner', repoFullName: 'garden-owner/garden', defaultBranch: 'main', queued: 2 };
const PENDING = { ...NOT_CONNECTED, status: 'pending_repo', accountLogin: 'garden-owner', repositories: [{ fullName: 'garden-owner/garden', defaultBranch: 'main', private: false, fork: false }] };

/** Answers every POST op with `answer(op)` and records each op sent. */
function posts(answer: (op: string) => Promise<Response> | Response) {
  const sent: string[] = [];
  server.use(http.post('*/api/user/*', ({ request }) => {
    const op = new URL(request.url).searchParams.get('op') ?? '';
    sent.push(op);
    return answer(op);
  }));
  return sent;
}

describe('GitHub garden card', () => {
  it('returns focus to Disconnect after an Escape without changing the connection', async () => {
    installNativeDialog();
    answer(() => HttpResponse.json(ACTIVE));
    const sent = posts(() => HttpResponse.json({}));
    mount();
    await checkEscapeReturn(await screen.findByRole('button', { name: en['github.disconnect'] }), 'alertdialog', /^Cancel$/);
    expect(sent).toEqual([]);
  });

  it('renders nothing on a deployment without the GitHub App', async () => {
    answer(() => HttpResponse.json(UNAVAILABLE));
    const { client, container } = mount();
    await waitFor(() => expect(client.getQueryState(codingKeys.github())?.status).toBe('success'));
    expect(screen.queryByRole('heading', { name: en['github.title'] })).not.toBeInTheDocument();
    expect(screen.queryByText(en['github.unavailable'])).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing while it does not know yet, so the card never flashes and vanishes', async () => {
    answer(async () => { await delay('infinite'); return HttpResponse.json(NOT_CONNECTED); });
    const { client, container } = mount();
    await waitFor(() => expect(client.getQueryState(codingKeys.github())?.fetchStatus).toBe('fetching'));
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to connect on a deployment that has the GitHub App', async () => {
    answer(() => HttpResponse.json(NOT_CONNECTED));
    mount();
    expect(await screen.findByRole('button', { name: en['github.connect'] })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en['github.title'] })).toBeInTheDocument();
  });

  it('says what connecting does once, puts Connect right under it, and keeps the detail in a disclosure (social-account-22)', async () => {
    answer(() => HttpResponse.json(NOT_CONNECTED));
    const { container } = mount();
    const connect = await screen.findByRole('button', { name: en['github.connect'] });
    expect(screen.getByText(en['github.tagline'])).toBeInTheDocument();
    const short = screen.getByText(en['github.introShort']);
    // Connect follows the one line, on the left, before the disclosure.
    expect(short.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const details = container.querySelector('details.de-disclosure') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(connect.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.querySelector('summary')).toHaveTextContent(en['github.howItWorks']);
    expect(details).toHaveTextContent(en['github.introTwo']);
  });

  it('sends one sync for a double click, before the busy state has rendered', async () => {
    answer(() => HttpResponse.json(ACTIVE));
    const sent = posts(async () => { await delay(50); return HttpResponse.json({ committed: 2, failed: 0, remaining: 0 }); });
    mount();
    const sync = await screen.findByRole('button', { name: en['github.syncNow'] });
    act(() => { fireEvent.click(sync); fireEvent.click(sync); });
    await waitFor(() => expect(sent).toEqual(['github-sync']));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sent).toEqual(['github-sync']);
  });

  it('keeps an answer that lands after a sign-out out of the next account\'s screen', async () => {
    answer(() => HttpResponse.json(PENDING));
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    posts(async () => { await held; return HttpResponse.json({ ...ACTIVE, queued: 0 }); });
    const { client } = mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'garden-owner/garden' }));
    fireEvent.click(screen.getByRole('button', { name: en['github.useRepo'] }));
    // The learner signs out while the choice is on its way.
    act(() => { clearAccountData(); client.setQueryData(codingKeys.github(), NOT_CONNECTED); });
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(client.getQueryData(codingKeys.github())).toEqual(NOT_CONNECTED);
    expect(screen.queryByText(en['github.repoSaved'].replace('{repo}', 'garden-owner/garden'))).not.toBeInTheDocument();
  });

  it('offers Connect again when Back brings the page back from the browser cache', async () => {
    answer(() => HttpResponse.json(NOT_CONNECTED));
    posts(() => HttpResponse.json({ url: 'https://github.com/apps/devshark-garden/installations/new?state=s' }));
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, origin: original.origin, hash: '', assign } });
    try {
      mount();
      fireEvent.click(await screen.findByRole('button', { name: en['github.connect'] }));
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: en['github.connecting'] })).toBeDisabled();
      act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      expect(screen.getByRole('button', { name: en['github.connect'] })).toBeEnabled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('forgets a repository choice the re-read list no longer offers, so Use is not sent for it', async () => {
    answer(() => HttpResponse.json(PENDING));
    const sent = posts(() => HttpResponse.json({ error: { code: 'bad_repo', message: 'Pick a repository you own that the app is installed on' } }, { status: 400 }));
    const { client } = mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'garden-owner/garden' }));
    expect(screen.getByRole('button', { name: en['github.useRepo'] })).toBeEnabled();
    // The learner narrowed the installation on GitHub: the list read again
    // offers another repository only.
    act(() => { client.setQueryData(codingKeys.github(), { ...PENDING, repositories: [{ fullName: 'garden-owner/other', defaultBranch: 'main', private: false, fork: false }] }); });
    const use = await screen.findByRole('button', { name: en['github.useRepo'] });
    expect(use).toBeDisabled();
    fireEvent.click(use);
    expect(sent).toEqual([]);
  });

  it('still says when the connection could not be read', async () => {
    answer(() => HttpResponse.json({ error: { code: 'internal_error', message: 'Could not handle the GitHub request' } }, { status: 500 }));
    mount();
    expect(await screen.findByText(en['github.loadFailed'])).toBeInTheDocument();
  });
});
