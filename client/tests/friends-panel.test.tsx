import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { FriendsPanel } from '../src/components/FriendsPanel';
import { avatarTone, initialsFor } from '../src/components/ui/InitialsAvatar';
import { server } from './mocks/server';

// The Friends tab shows each friend by the name they chose for friends
// (migration 055): their sharkname, or their Google name, followed by the
// sharkname when the two differ. The avatar is their photo only when they
// switched it on, and their initials otherwise.

// jsdom has no modal dialogs; removing a friend confirms in one.
const dialogProto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
dialogProto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
dialogProto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

const friend = (over: Record<string, unknown>) => ({
  handle: 'x', displayName: 'x', picture: null, country: null, crown: false,
  currentStreak: 0, longestStreak: 0, totalCorrect: 0, totalQuestions: 0, accuracyPct: 0, activeToday: false,
  ...over,
});

function serve(options: { handle?: string | null; friends?: unknown[]; requests?: unknown[]; lookup?: unknown } = {}) {
  const answered: unknown[] = [];
  server.use(
    http.get('*/api/user/friends-handle', () => HttpResponse.json({
      handle: options.handle === undefined ? 'thirsty-sharkie' : options.handle,
      discoverable: true, country: null, canChangeAt: null,
    })),
    http.get('*/api/user/friends-list', () => HttpResponse.json({ friends: options.friends ?? [], requests: options.requests ?? [] })),
    http.get('*/api/user/friends-lookup', () => HttpResponse.json(options.lookup ?? { found: false })),
    http.post('*/api/user/friends-respond', async ({ request }) => {
      answered.push(await request.json());
      return HttpResponse.json({ state: 'accepted' });
    }),
  );
  return { answered };
}

const renderPanel = (onEditSharkname?: () => void) =>
  render(<LanguageProvider><FriendsPanel onEditSharkname={onEditSharkname} /></LanguageProvider>);

describe('the friends list', () => {
  it('names each friend as they chose, with initials unless they show their photo', async () => {
    serve({
      friends: [
        friend({ handle: 'el-tiburon-loco', displayName: 'Ada Lovelace', picture: 'https://lh3.googleusercontent.com/a/ada', totalQuestions: 10, accuracyPct: 80 }),
        friend({ handle: 'fin-de-fiesta', displayName: 'fin-de-fiesta', picture: null }),
      ],
    });
    renderPanel();
    const list = await screen.findByRole('heading', { name: 'Friends (2)' });
    const rows = within(list.closest('section')!).getAllByRole('listitem');

    // Ada shows her name and her photo; her sharkname follows, for finding her.
    expect(rows[0].querySelector('.fr-friend__name')).toHaveTextContent('Ada Lovelaceel-tiburon-loco');
    expect(rows[0].querySelector('img')).toHaveAttribute('src', 'https://lh3.googleusercontent.com/a/ada');
    expect(rows[0].querySelector('.ss-initials-avatar')).toBeNull();

    // The second friend shows the sharkname once, and initials.
    expect(rows[1].querySelector('.fr-friend__name')).toHaveTextContent(/^fin-de-fiesta$/);
    const initials = rows[1].querySelector('.ss-initials-avatar')!;
    expect(initials).toHaveTextContent('FD');
    expect(initials).toHaveAttribute('data-tone', String(avatarTone('fin-de-fiesta')));
    // The name is written beside it, so the avatar is not read out again.
    expect(initials).toHaveAttribute('aria-hidden', 'true');

    expect(screen.getByRole('button', { name: 'Remove Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove fin-de-fiesta' })).toBeInTheDocument();
  });

  it('shows who asked by the name they chose, and answers by their sharkname', async () => {
    const { answered } = serve({
      requests: [
        { handle: 'mucho-chomp-shark', displayName: 'Dee Example', direction: 'incoming' },
        { handle: 'gracias-sharkie', displayName: 'gracias-sharkie', direction: 'outgoing' },
      ],
    });
    renderPanel();
    const accept = await screen.findByRole('button', { name: 'Accept Dee Example' });
    expect(screen.getByRole('button', { name: 'Decline Dee Example' })).toBeInTheDocument();
    expect(screen.getByText('Dee Example')).toBeInTheDocument();
    expect(screen.getByText('mucho-chomp-shark')).toBeInTheDocument();
    expect(screen.getByText('gracias-sharkie')).toBeInTheDocument();
    fireEvent.click(accept);
    await waitFor(() => expect(answered).toEqual([{ handle: 'mucho-chomp-shark', accept: true }]));
  });

  it('shows an accepted friend’s chosen name when their sharkname is looked up', async () => {
    serve({ lookup: { found: true, handle: 'el-tiburon-loco', state: 'accepted', displayName: 'Ada Lovelace' } });
    renderPanel();
    const input = await screen.findByRole('textbox', { name: 'Add a friend' });
    expect(input).toHaveAttribute('maxLength', '32');
    fireEvent.change(input, { target: { value: 'el-tiburon-loco' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    const result = await screen.findByText('Already friends.');
    expect(result.closest('.fr-result')).toHaveTextContent('Ada Lovelaceel-tiburon-loco');
  });

  it('does not replace a newer lookup when an earlier friend request finishes', async () => {
    serve();
    const refreshed = vi.fn();
    let release!: () => void;
    server.use(
      http.get('*/api/user/friends-list', () => {
        refreshed();
        return HttpResponse.json({ friends: [], requests: [] });
      }),
      http.get('*/api/user/friends-lookup', ({ request }) => HttpResponse.json({
        found: true, handle: new URL(request.url).searchParams.get('handle'), state: 'none',
      })),
      http.post('*/api/user/friends-request', () => new Promise<Response>((resolve) => {
        release = () => resolve(HttpResponse.json({ state: 'pending_out' }));
      })),
    );
    renderPanel();
    const input = await screen.findByRole('textbox', { name: 'Add a friend' });
    fireEvent.change(input, { target: { value: 'el-tiburon-loco' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() => expect(release).toBeDefined());
    fireEvent.change(input, { target: { value: 'fin-de-fiesta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('fin-de-fiesta');
    await act(async () => { release(); });
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(2));
    expect(screen.getByText('fin-de-fiesta')).toBeInTheDocument();
    expect(screen.queryByText('el-tiburon-loco')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('drops a lookup that answers after the box was edited', async () => {
    serve();
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    server.use(http.get('*/api/user/friends-lookup', async () => {
      await gate;
      return HttpResponse.json({ found: true, handle: 'el-tiburon-loco', state: 'none' });
    }));
    renderPanel();
    const input = await screen.findByRole('textbox', { name: 'Add a friend' });
    fireEvent.change(input, { target: { value: 'el-tiburon-loco' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    // The learner types on before the answer comes back: it no longer
    // answers what the box says, and must not offer an Add for it.
    fireEvent.change(input, { target: { value: 'el-tiburon-lo' } });
    expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();
    release();
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });
});

describe('a friends read that fails', () => {
  it('offers a retry when the tab does not load', async () => {
    let fail = true;
    server.use(
      http.get('*/api/user/friends-handle', () => fail
        ? HttpResponse.json({ error: { code: 'db_error', message: 'Unavailable' } }, { status: 503 })
        : HttpResponse.json({ handle: 'thirsty-sharkie', discoverable: true, country: null, canChangeAt: null })),
      http.get('*/api/user/friends-list', () => HttpResponse.json({ friends: [friend({ handle: 'fin-de-fiesta', displayName: 'fin-de-fiesta' })], requests: [] })),
    );
    renderPanel();
    expect(await screen.findByText('Friends are not available yet on this deployment.')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Friends (1)' })).toBeInTheDocument();
  });

  it('keeps the list on screen when the read after an answer fails', async () => {
    serve({
      friends: [friend({ handle: 'fin-de-fiesta', displayName: 'fin-de-fiesta' })],
      requests: [{ handle: 'mucho-chomp-shark', displayName: 'Dee Example', direction: 'incoming' }],
    });
    renderPanel();
    const accept = await screen.findByRole('button', { name: 'Accept Dee Example' });
    server.use(http.get('*/api/user/friends-list', () => HttpResponse.json({ error: { code: 'db_error', message: 'Unavailable' } }, { status: 503 })));
    fireEvent.click(accept);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Friends (1)' })).toBeInTheDocument();
    expect(screen.queryByText('Friends are not available yet on this deployment.')).toBeNull();
  });
});

describe('removing a friend', () => {
  // Remove sent the request on the first press: one slip of the thumb ended a
  // friendship on both sides, and only a new request brought it back.
  it('asks first, sends nothing on Cancel, and removes on confirm', async () => {
    const removed: string[] = [];
    let friends = [friend({ handle: 'fin-de-fiesta', displayName: 'Fin Example' })];
    serve();
    server.use(
      http.get('*/api/user/friends-list', () => HttpResponse.json({ friends, requests: [] })),
      http.post('*/api/user/friends-remove', async ({ request }) => {
        removed.push((await request.json() as { handle: string }).handle);
        friends = [];
        return HttpResponse.json({ removed: true });
      }),
    );
    renderPanel();
    const opener = await screen.findByRole('button', { name: 'Remove Fin Example' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Fin Example?' });
    expect(dialog).toHaveTextContent('You leave each other’s friends lists.');
    expect(removed).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(removed).toEqual([]);
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removed).toEqual(['fin-de-fiesta']));
    const heading = await screen.findByRole('heading', { name: 'Friends (0)' });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe('answering two requests in a row', () => {
  it('draws the later read, not an older one that lands after it', async () => {
    const pending = [
      { handle: 'mucho-chomp-shark', displayName: 'Dee Example', direction: 'incoming' },
      { handle: 'gracias-sharkie', displayName: 'Gus Example', direction: 'incoming' },
    ];
    let reads = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((done) => { releaseFirst = done; });
    server.use(
      http.get('*/api/user/friends-handle', () => HttpResponse.json({ handle: 'thirsty-sharkie', discoverable: true, country: null, canChangeAt: null })),
      http.get('*/api/user/friends-list', async () => {
        reads += 1;
        const snapshot = { friends: [], requests: [...pending] };
        // The read after the first answer is slow and lands last.
        if (reads === 2) await firstGate;
        return HttpResponse.json(snapshot);
      }),
      http.post('*/api/user/friends-respond', async ({ request }) => {
        const { handle } = await request.json() as { handle: string };
        pending.splice(pending.findIndex((one) => one.handle === handle), 1);
        return HttpResponse.json({ state: 'declined_in' });
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline Dee Example' }));
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Decline Gus Example' }));
    await waitFor(() => expect(screen.queryByText('Gus Example')).toBeNull());
    releaseFirst();
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByText('Gus Example')).toBeNull();
    expect(screen.queryByText('Dee Example')).toBeNull();
  });
});

describe('double presses on a request', () => {
  it('sends one answer for a double click, and keeps a second row busy while its answer runs', async () => {
    const answered: string[] = [];
    let releaseGus!: () => void;
    const gusGate = new Promise<void>((done) => { releaseGus = done; });
    serve({
      requests: [
        { handle: 'mucho-chomp-shark', displayName: 'Dee Example', direction: 'incoming' },
        { handle: 'gracias-sharkie', displayName: 'Gus Example', direction: 'incoming' },
      ],
    });
    server.use(http.post('*/api/user/friends-respond', async ({ request }) => {
      const { handle } = await request.json() as { handle: string };
      answered.push(handle);
      if (handle === 'gracias-sharkie') await gusGate;
      return HttpResponse.json({ state: 'accepted' });
    }));
    renderPanel();
    const accept = await screen.findByRole('button', { name: 'Accept Dee Example' });
    const acceptGus = screen.getByRole('button', { name: 'Accept Gus Example' });
    act(() => { acceptGus.click(); accept.click(); accept.click(); });
    await waitFor(() => expect(answered.sort()).toEqual(['gracias-sharkie', 'mucho-chomp-shark']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept Dee Example' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Accept Gus Example' })).toBeDisabled();
    releaseGus();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept Gus Example' })).toBeEnabled());
    await new Promise((done) => setTimeout(done, 50));
  });
});

describe('a request answered while its re-read is on the way', () => {
  it('keeps the row busy until the read that removes it lands', async () => {
    const answered: string[] = [];
    let reads = 0;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((done) => { releaseRead = done; });
    let pending = [{ handle: 'mucho-chomp-shark', displayName: 'Dee Example', direction: 'incoming' }];
    server.use(
      http.get('*/api/user/friends-handle', () => HttpResponse.json({ handle: 'thirsty-sharkie', discoverable: true, country: null, canChangeAt: null })),
      http.get('*/api/user/friends-list', async () => {
        reads += 1;
        const snapshot = { friends: [], requests: [...pending] };
        if (reads === 2) await readGate;
        return HttpResponse.json(snapshot);
      }),
      http.post('*/api/user/friends-respond', async ({ request }) => {
        answered.push((await request.json() as { handle: string }).handle);
        pending = [];
        return HttpResponse.json({ state: 'accepted' });
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept Dee Example' }));
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => { await new Promise((done) => setTimeout(done, 30)); });
    expect(screen.getByRole('button', { name: 'Accept Dee Example' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept Dee Example' }));
    releaseRead();
    await waitFor(() => expect(screen.queryByText('Dee Example')).toBeNull());
    expect(answered).toEqual(['mucho-chomp-shark']);
  });
});

describe('the discoverable switch', () => {
  it('shows each new value while it saves, and stores the last one', async () => {
    serve();
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const puts: unknown[] = [];
    server.use(http.put('*/api/user/friends-handle', async ({ request }) => {
      const body = await request.json() as { discoverable: boolean };
      puts.push(body);
      if (puts.length === 1) await gate;
      return HttpResponse.json(body);
    }));
    renderPanel();
    const box = await screen.findByRole('checkbox');
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    release();
    await waitFor(() => expect(puts).toEqual([{ discoverable: false }, { discoverable: true }]));
    await new Promise((done) => setTimeout(done, 50));
  });

  it('stores a change made while the read after a save is still on its way', async () => {
    serve();
    let releaseRead!: () => void;
    const readGate = new Promise<void>((done) => { releaseRead = done; });
    let reads = 0;
    const puts: unknown[] = [];
    server.use(
      http.get('*/api/user/friends-list', async () => {
        reads += 1;
        if (reads === 2) await readGate;
        return HttpResponse.json({ friends: [], requests: [] });
      }),
      http.put('*/api/user/friends-handle', async ({ request }) => {
        const body = await request.json() as { discoverable: boolean };
        puts.push(body);
        return HttpResponse.json(body);
      }),
    );
    renderPanel();
    const box = await screen.findByRole('checkbox');
    fireEvent.click(box);
    await waitFor(() => expect(reads).toBe(2));
    // The first save is stored and its re-read is held: this change must
    // still be sent, not wait for some later click.
    fireEvent.click(box);
    releaseRead();
    await waitFor(() => expect(puts).toEqual([{ discoverable: false }, { discoverable: true }]));
    await waitFor(() => expect(reads).toBe(3));
  });
});

describe('a read the next read overtakes', () => {
  it('keeps the value being saved on screen until the newer read draws', async () => {
    let discoverable = true;
    let reads = 0;
    const gates: Array<() => void> = [];
    server.use(
      http.get('*/api/user/friends-handle', () => HttpResponse.json({ handle: 'thirsty-sharkie', discoverable, country: null, canChangeAt: null })),
      http.get('*/api/user/friends-list', async () => {
        reads += 1;
        if (reads > 1) await new Promise<void>((done) => gates.push(done));
        return HttpResponse.json({ friends: [], requests: [{ handle: 'mucho-chomp-shark', displayName: 'Dee Example', direction: 'incoming' }] });
      }),
      http.put('*/api/user/friends-handle', async ({ request }) => {
        ({ discoverable } = await request.json() as { discoverable: boolean });
        return HttpResponse.json({ discoverable });
      }),
      http.post('*/api/user/friends-respond', () => HttpResponse.json({ state: 'declined_in' })),
    );
    renderPanel();
    const box = await screen.findByRole('checkbox');
    fireEvent.click(box);
    await waitFor(() => expect(reads).toBe(2));
    // A second read starts (an answer to a request) and overtakes the first.
    fireEvent.click(screen.getByRole('button', { name: 'Decline Dee Example' }));
    await waitFor(() => expect(reads).toBe(3));
    await act(async () => { gates[0](); await new Promise((done) => setTimeout(done, 30)); });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await act(async () => { gates[1](); await new Promise((done) => setTimeout(done, 30)); });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});

describe('your sharkname on the Friends tab', () => {
  it('says what friends add you by, and sends you to the Overview card to change it', async () => {
    serve();
    const edit = vi.fn();
    renderPanel(edit);
    expect(await screen.findByText('Friends add you by your sharkname, thirsty-sharkie.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change sharkname' }));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it('asks a learner without one to pick a sharkname first', async () => {
    serve({ handle: null });
    const edit = vi.fn();
    renderPanel(edit);
    expect(await screen.findByText('You have no sharkname yet, so nobody can add you.')).toBeInTheDocument();
    expect(screen.getByText('Pick a sharkname first, then add someone by theirs.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add a friend' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pick a sharkname' }));
    expect(edit).toHaveBeenCalledTimes(1);
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words of a name or a sharkname', () => {
    expect(initialsFor('Ada Lovelace')).toBe('AL');
    expect(initialsFor('thirsty-sharkie')).toBe('TS');
    expect(initialsFor('shark-so-fat-it-cant-swim')).toBe('SS');
    expect(initialsFor('Madonna')).toBe('M');
    expect(initialsFor('  ')).toBe('?');
    expect(initialsFor('élodie dupont')).toBe('ÉD');
  });

  it('gives a name one of eight inks, the same every time', () => {
    const tones = ['Ada Lovelace', 'thirsty-sharkie', 'fin-de-fiesta', 'el-tiburon-loco', 'mucho-chomp-shark', 'Dee Example']
      .map(avatarTone);
    for (const tone of tones) expect(tone).toBeGreaterThanOrEqual(1);
    for (const tone of tones) expect(tone).toBeLessThanOrEqual(8);
    expect(avatarTone('Ada Lovelace')).toBe(avatarTone('ada lovelace '));
    expect(new Set(tones).size).toBeGreaterThan(1);
  });
});
