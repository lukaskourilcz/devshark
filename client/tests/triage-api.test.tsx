import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { loadTriageVerdicts } from '../src/lib/triageApi';
import { clearDevPassword, setDevPassword } from '../src/lib/devApi';
import { queryClient } from '../src/lib/queryClient';
import { clearAccountData } from '../src/lib/accountData';
import '../src/lib/auth'; // registers the real before-account-change cache clear
import DevTriage from '../src/components/dev/DevTriage';
import { LanguageProvider } from '../src/i18n/LanguageContext';

const overlay = (note: string) => ({
  meta: { total: 1, keep: 0, cut: 1, generatedFrom: 'test', keepRule: 'test' },
  verdicts: { private: { cat: 'react', diff: 2, rel: 2, disc: 2, fit: 2, clar: 2, mean: 2, gate: false,
    greasons: [], dup: false, dec: 'cut', reasons: [], note } },
});
afterEach(() => { queryClient.clear(); clearDevPassword(); });

it('loads triage through the existing authenticated admin client, without a module cache', async () => {
  let privateReads = 0;
  let publicReads = 0;
  const credentials: (string | null)[] = [];
  server.use(
    http.get('*/api/admin/triage', ({ request }) => {
      credentials.push(request.headers.get('x-dev-password'));
      return HttpResponse.json(overlay(`read-${++privateReads}`));
    }),
    http.get('*/triage-verdicts.json', () => { publicReads++; return HttpResponse.json(overlay('public')); }),
  );
  setDevPassword('existing-admin-transport');
  expect((await loadTriageVerdicts()).verdicts.private.note).toBe('read-1');
  expect((await loadTriageVerdicts()).verdicts.private.note).toBe('read-2');
  expect(credentials).toEqual(['existing-admin-transport', 'existing-admin-transport']);
  expect(publicReads).toBe(0);
});

it('forwards cancellation to an in-flight admin request', async () => {
  let seen: AbortSignal | undefined;
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const handler = async ({ request }: { request: Request }) => { seen = request.signal; await held; return HttpResponse.json(overlay('held')); };
  server.use(http.get('*/api/admin/triage', handler), http.get('*/triage-verdicts.json', handler));
  const controller = new AbortController();
  const outcome = loadTriageVerdicts(controller.signal).then(() => null, (error: unknown) => error);
  try {
    await waitFor(() => expect(seen).toBeDefined());
    controller.abort();
    expect(await outcome).toBeTruthy();
    expect(seen?.aborted).toBe(true);
  } finally { release(); }
});

describe('the real account-clear boundary', () => {
  it('aborts both active reads while the view stays mounted and discards their late responses', async () => {
    const seen: Partial<Record<'questions' | 'triage', AbortSignal>> = {};
    const responded = new Set<'questions' | 'triage'>();
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.get('*/api/admin/questions', async ({ request }) => {
        seen.questions = request.signal;
        await held;
        responded.add('questions');
        return HttpResponse.json({ questions: [], categories: ['react'], reportCounts: {} });
      }),
      http.get('*/api/admin/triage', async ({ request }) => {
        seen.triage = request.signal;
        await held;
        responded.add('triage');
        return HttpResponse.json(overlay('late-private-account'));
      }),
    );
    const view = render(<QueryClientProvider client={queryClient}><LanguageProvider><DevTriage /></LanguageProvider></QueryClientProvider>);
    try {
      await waitFor(() => {
        expect(seen.questions).toBeDefined();
        expect(seen.triage).toBeDefined();
      });
      for (const key of [['admin', 'questions'], ['admin', 'triage']]) {
        const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
        expect(query?.getObserversCount()).toBeGreaterThan(0);
        expect(query?.state.fetchStatus).toBe('fetching');
      }

      // No unmount: only the real registered account-clear callback can
      // cancel these still-observed requests and remove their private cache.
      act(() => clearAccountData());
      expect(seen.questions?.aborted).toBe(true);
      expect(seen.triage?.aborted).toBe(true);
      expect(queryClient.getQueryCache().findAll({ queryKey: ['admin'] })).toEqual([]);

      release();
      await waitFor(() => expect([...responded].sort()).toEqual(['questions', 'triage']));
      expect(queryClient.getQueryData(['admin', 'questions'])).toBeUndefined();
      expect(queryClient.getQueryData(['admin', 'triage'])).toBeUndefined();
      expect(screen.queryByText('late-private-account')).toBeNull();
    } finally { release(); view.unmount(); }
  });

  it('aborts the old overlay and never restores it into the next admin view', async () => {
    let seen: AbortSignal | undefined;
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    const handler = async ({ request }: { request: Request }) => {
      if (++reads === 1) { seen = request.signal; await held; return HttpResponse.json(overlay('old-account')); }
      return HttpResponse.json(overlay('new-account'));
    };
    server.use(
      http.get('*/api/admin/questions', () => HttpResponse.json({ questions: [], categories: ['react'], reportCounts: {} })),
      http.get('*/api/admin/triage', handler), http.get('*/triage-verdicts.json', handler),
    );
    const mount = () => render(<QueryClientProvider client={queryClient}><LanguageProvider><DevTriage /></LanguageProvider></QueryClientProvider>);
    const first = mount();
    try {
      await waitFor(() => expect(seen).toBeDefined());
      first.unmount();
      act(() => clearAccountData());
      release();
      await waitFor(() => expect(seen?.aborted).toBe(true));
      expect(queryClient.getQueryData(['admin', 'triage'])).toBeUndefined();
      mount();
      await waitFor(() => expect(queryClient.getQueryData<{ verdicts: { private: { note: string } } }>(['admin', 'triage'])?.verdicts.private.note).toBe('new-account'));
      expect(screen.queryByText('old-account')).toBeNull();
    } finally { release(); first.unmount(); }
  });
});
