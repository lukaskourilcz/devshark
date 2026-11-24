import { trackAnnouncement } from './announcement';
import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import SharknameCard from '../src/components/SharknameCard';
import { hasSharkWord, numberedSharkname } from '../../shared/sharkname';
import { isValidHandle } from '../../shared/handles';
import { server } from './mocks/server';

// "Your name" on the Profile (SharknameCard): the sharkname friends add you
// by, rolled with Generate (shared/sharkname.ts) and saved through
// op=friends-handle, what friends see of you, saved through op=identity
// (migration 055), and beside it what leaderboards show
// (tests/leaderboard-visibility.test.tsx covers that column).

const ADA = { realName: 'Ada Lovelace', photo: 'https://lh3.googleusercontent.com/a/ada' };
const LATER = new Date(Date.now() + 20 * 86_400_000).toISOString();
const EARLIER = new Date(Date.now() - 86_400_000).toISOString();

interface HandleRow { handle: string | null; ordinal?: string; base?: string; discoverable: boolean; country: string | null; canChangeAt: string | null }
interface IdentityRow { showRealName: boolean; showPhoto: boolean; realName: string | null; photo: string | null }

/** A stand-in for the two ops, holding one learner's rows. */
function serve(options: {
  handle?: Partial<HandleRow>;
  identity?: Partial<IdentityRow>;
  taken?: string[];
  identityFails?: boolean;
} = {}) {
  const handle: HandleRow = { handle: 'thirsty-sharkie', discoverable: true, country: null, canChangeAt: EARLIER, ...options.handle };
  const identity: IdentityRow = { showRealName: false, showPhoto: false, ...ADA, ...options.identity };
  const handlePuts: unknown[] = [];
  const identityPuts: unknown[] = [];
  server.use(
    http.get('*/api/user/friends-handle', () => HttpResponse.json(handle)),
    http.put('*/api/user/friends-handle', async ({ request }) => {
      const body = (await request.json()) as { base: string };
      handlePuts.push(body);
      if (options.taken?.some(name => name.toLowerCase() === body.base.toLowerCase())) {
        return HttpResponse.json({ error: { code: 'handle_taken', message: 'That sharkname is already taken' } }, { status: 409 });
      }
      handle.handle = body.base;
      handle.canChangeAt = LATER;
      return HttpResponse.json({ handle: body.base });
    }),
    http.get('*/api/user/identity', () => HttpResponse.json(identity)),
    http.put('*/api/user/identity', async ({ request }) => {
      const body = (await request.json()) as { showRealName?: boolean; showPhoto?: boolean };
      identityPuts.push(body);
      if (options.identityFails) {
        return HttpResponse.json({ error: { code: 'db_error', message: 'Could not save what friends see' } }, { status: 500 });
      }
      if (body.showRealName !== undefined) identity.showRealName = body.showRealName;
      if (body.showPhoto !== undefined) identity.showPhoto = body.showPhoto;
      return HttpResponse.json(identity);
    }),
  );
  return { handlePuts, identityPuts, handle, identity };
}

function renderCard(props: { focus?: boolean; onFocused?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LanguageProvider><SharknameCard {...props} /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const field = () => screen.findByRole('textbox', { name: 'Sharkname' });
const reducedMotion = (reduce: boolean) => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
};
afterEach(() => reducedMotion(false));

describe('your sharkname', () => {
  it('previews a changed base with the same server number without allocating anything', async () => {
    reducedMotion(true);
    const { handlePuts } = serve({ handle: { handle: 'sleepySharkie9007199254740993', base: 'sleepySharkie', ordinal: '9007199254740993' } });
    const { container } = renderCard();
    const input = await field();
    expect(input).toHaveValue('sleepySharkie');
    // The number follows the field, once, and describes it.
    const number = container.querySelector('.sn-field__number')!;
    expect(number).toHaveTextContent('9007199254740993');
    expect(input.getAttribute('aria-describedby')).toContain(number.id);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const base = (input as HTMLInputElement).value;
    expect(screen.getByText(`New sharkname: ${numberedSharkname(base, '9007199254740993')}. Save to keep it.`)).toBeInTheDocument();
    expect(number).toHaveTextContent('9007199254740993');
    expect(handlePuts).toEqual([]);
  });
  it('shows the current sharkname in the field', async () => {
    serve();
    renderCard();
    expect(await field()).toHaveValue('thirsty-sharkie');
    expect(screen.getByRole('heading', { name: 'Your name' })).toBeInTheDocument();
    // The field shows the name; nothing prints it again above it, and the
    // sharkname option does not repeat it either (social-account-04).
    expect(screen.queryAllByText('thirsty-sharkie').map((node) => node.closest('.sn-preview'))).not.toContain(null);
    expect(screen.getByText('Friends add you by your sharkname. You can change it once every 30 days.')).toBeInTheDocument();
    // Nothing changed yet, so there is nothing to save.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('rolls a new shark name with Generate, says so, and saves it only on Save', async () => {
    reducedMotion(true);
    const { handlePuts } = serve();
    renderCard();
    const input = await field();
    const verifyAnnouncement = trackAnnouncement('p.ss-sr-only[aria-live]');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const rolled = (input as HTMLInputElement).value;
    expect(rolled).not.toBe('thirsty-sharkie');
    expect(isValidHandle(rolled) && hasSharkWord(rolled)).toBe(true);
    expect(screen.getByText(`New sharkname: ${rolled}. Save to keep it.`)).toBeInTheDocument();
    verifyAnnouncement(`New sharkname: ${rolled}. Save to keep it.`);
    expect(handlePuts).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(`Saved. Your sharkname is ${rolled}.`)).toBeInTheDocument();
    expect(handlePuts).toEqual([{ base: rolled }]);
  });

  it('saves once when Enter is pressed twice', async () => {
    const { handlePuts } = serve();
    renderCard();
    const input = await field();
    fireEvent.change(input, { target: { value: 'finDeFiesta' } });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(await screen.findByText('Saved. Your sharkname is finDeFiesta.')).toBeInTheDocument();
    expect(handlePuts).toEqual([{ base: 'finDeFiesta' }]);
  });

  it('flips through names in the field before it lands when motion is allowed, and Generate waits for it', async () => {
    serve();
    renderCard();
    const input = await field();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(input).toHaveAttribute('data-rolling', 'true');
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    await waitFor(() => expect(input).not.toHaveAttribute('data-rolling'));
    const landed = (input as HTMLInputElement).value;
    expect(landed).not.toBe('thirsty-sharkie');
    expect(isValidHandle(landed)).toBe(true);
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });

  it('lands the name at once under reduced motion, with no flip and no animation', async () => {
    reducedMotion(true);
    serve();
    renderCard();
    const input = await field();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(input).not.toHaveAttribute('data-rolling');
    expect(input).not.toHaveValue('thirsty-sharkie');
    expect(readSheet()).not.toMatch(/animation|@keyframes/);
  });

  it('keeps the field, Generate and Save on one row, and gives the buttons half a row each below 600px', () => {
    const css = readSheet();
    expect(css).toMatch(/\.sn-row \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto auto;/);
    expect(css).toMatch(/@media \(max-width: 600px\) \{\s*\.sn-row \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}\s*\.sn-row > \.sn-field \{ grid-column: 1 \/ -1; \}/);
  });

  it('offers another name when the one sent is taken', async () => {
    reducedMotion(true);
    const { handlePuts } = serve({ taken: ['finDeFiesta'] });
    renderCard();
    const input = await field();
    fireEvent.change(input, { target: { value: 'finDeFiesta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('finDeFiesta is taken.');
    const offer = within(alert).getByRole('button', { name: /^Try / });
    const suggestion = offer.textContent!.replace(/^Try /, '');
    expect(suggestion).not.toBe('finDeFiesta');
    expect(isValidHandle(suggestion) && hasSharkWord(suggestion)).toBe(true);

    fireEvent.click(offer);
    expect(input).toHaveValue(suggestion);
    expect(input).toHaveFocus();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(`Saved. Your sharkname is ${suggestion}.`)).toBeInTheDocument();
    expect(handlePuts).toEqual([{ base: 'finDeFiesta' }, { base: suggestion }]);
  });

  it('refuses a name the database would refuse, without asking it', async () => {
    const { handlePuts } = serve();
    renderCard();
    const input = await field();
    fireEvent.change(input, { target: { value: 'no spaces-shark' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Your number is added automatically.');
    expect(handlePuts).toEqual([]);
    // 32 characters fit; the field stops at 32.
    expect(input).toHaveAttribute('maxLength', '31');
  });

  it('says until when a recent sharkname is fixed, and offers no Generate meanwhile', async () => {
    serve({ handle: { canChangeAt: LATER } });
    renderCard();
    const input = await field();
    const date = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(LATER));
    expect(screen.getByText(`You can change your sharkname again on ${date}.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('starts a learner without a sharkname at Generate, and opens what friends see once one is saved', async () => {
    reducedMotion(true);
    serve({ handle: { handle: null, canChangeAt: null } });
    renderCard();
    const input = await field();
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'e.g. thirstySharkie');
    expect(screen.getByText('Save a sharkname first, then choose what friends see.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /Friends see/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const rolled = (input as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const friends = await screen.findByRole('radiogroup', { name: /Friends see/ });
    expect(within(friends).getByRole('radio', { name: /Sharkname/ })).toBeChecked();
    expect(screen.getByText(`Saved. Your sharkname is ${rolled}.`)).toBeInTheDocument();
  });

  it('loads under StrictMode, which the app renders in', async () => {
    serve();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <LanguageProvider><SharknameCard /></LanguageProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(await field()).toHaveValue('thirsty-sharkie');
  });

  it('puts the cursor in the field when the Friends tab sends the learner here', async () => {
    serve();
    const onFocused = vi.fn();
    renderCard({ focus: true, onFocused });
    const input = await field();
    await waitFor(() => expect(input).toHaveFocus());
    expect(onFocused).toHaveBeenCalledTimes(1);
  });

  it('says so and retries when the card cannot load', async () => {
    let fail = true;
    serve();
    server.use(http.get('*/api/user/identity', () => (fail
      ? HttpResponse.json({ error: { code: 'db_error', message: 'Could not load what friends see' } }, { status: 500 })
      : HttpResponse.json({ showRealName: false, showPhoto: false, ...ADA }))));
    renderCard();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your sharkname couldn’t be loaded.');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(await field()).toHaveValue('thirsty-sharkie');
  });
});

describe('what friends see', () => {
  it('starts at the sharkname and initials, and switches to the name and photo', async () => {
    const { identityPuts } = serve();
    const { container } = renderCard();
    const friends = await screen.findByRole('radiogroup', { name: /Friends see/ });
    const sharkname = within(friends).getByRole('radio', { name: /Sharkname/ });
    expect(sharkname).toBeChecked();
    const preview = container.querySelector('.sn-preview')!;
    expect(preview).toHaveTextContent('Friends see you as');
    expect(preview.querySelector('.sn-preview__name')).toHaveTextContent('thirsty-sharkie');
    expect(preview.querySelector('.ss-initials-avatar')).toHaveTextContent('TS');

    fireEvent.click(within(friends).getByRole('radio', { name: /Account name/ }));
    await waitFor(() => expect(identityPuts).toEqual([{ showRealName: true }]));
    await waitFor(() => expect(within(friends).getByRole('radio', { name: /Account name/ })).toBeChecked());
    expect(preview.querySelector('.sn-preview__name')).toHaveTextContent('Ada Lovelace');
    expect(preview.querySelector('.ss-initials-avatar')).toHaveTextContent('AL');

    const photo = screen.getByRole('switch', { name: 'Show my photo to friends' });
    expect(photo).not.toBeChecked();
    fireEvent.click(photo);
    await waitFor(() => expect(identityPuts).toEqual([{ showRealName: true }, { showPhoto: true }]));
    await waitFor(() => expect(photo).toBeChecked());
    expect(preview.querySelector('.ss-initials-avatar')).toBeNull();
    expect(preview.querySelector('img')).toHaveAttribute('src', ADA.photo);
  });

  it('offers only the sharkname and initials to an account with no Google name or photo', async () => {
    serve({ identity: { realName: null, photo: null } });
    renderCard();
    const friends = await screen.findByRole('radiogroup', { name: /Friends see/ });
    const name = within(friends).getByRole('radio', { name: /Account name/ });
    expect(name).toBeDisabled();
    expect(screen.getByText('Your account has no Google name.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show my photo to friends' })).toBeDisabled();
    expect(screen.getByText('Your account has no photo, so friends see your initials.')).toBeInTheDocument();
  });

  it('puts the two name columns side by side only when the panel itself is 400px wide, and stacks them below 600px', () => {
    const css = readSheet();
    // The panel is the container; inside one of the Profile's two columns it
    // is too narrow for two readable columns, whatever the viewport.
    expect(css).toMatch(/\.sn-card \{[^}]*container: sn-card \/ inline-size;/);
    expect(css).toMatch(/\.sn-columns \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@container sn-card \(min-width: 400px\) \{\s*\.sn-columns \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    const container = css.indexOf('@container sn-card');
    const phone = css.indexOf('@media (max-width: 600px) {\n  .sn-columns');
    expect(phone).toBeGreaterThan(container);
  });

  it('gives the photo switch the same 44px hit area as the leaderboard column beside it', () => {
    const square = /top: -10px !important; left: -2px !important; width: 44px !important; height: 44px !important;/;
    const rule = (css: string, selector: string) => css.split('\n').find((line) => line.startsWith(selector)) ?? '';
    expect(rule(readSheet(), ".sn-see input[role='switch']")).toMatch(square);
    const board = readFileSync(new URL('../src/components/LeaderboardVisibilitySwitch.css', import.meta.url), 'utf8');
    expect(rule(board, ".lb-photo input[role='switch']")).toMatch(square);
  });

  it('keeps each radio and photo switch on its label line, in both columns', () => {
    expect(readSheet()).toContain('.sn-card .astryx-radio-list-item,\n.sn-card .astryx-radio-list-item > .astryx-item,\n.sn-card .astryx-switch-field > div { align-items: flex-start; }');
  });

  it('puts a switch back and says so when the save fails', async () => {
    const { identityPuts } = serve({ identityFails: true });
    renderCard();
    const photo = await screen.findByRole('switch', { name: 'Show my photo to friends' });
    fireEvent.click(photo);
    expect(await screen.findByRole('alert')).toHaveTextContent('That setting wasn’t saved. Try again.');
    expect(identityPuts).toEqual([{ showPhoto: true }]);
    await waitFor(() => expect(photo).not.toBeChecked());
  });
});

function readSheet(): string {
  return readFileSync(new URL('../src/components/SharknameCard.css', import.meta.url), 'utf8');
}
