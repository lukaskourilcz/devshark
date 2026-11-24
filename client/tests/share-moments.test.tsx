// Sharing at a moment of success (#239): the invite link after a first
// passed Learn level or a Challenge run, and the result card of the Challenge
// and the typing racer. Invented fixtures; the op=referral shape is the real one.
import { trackAnnouncement } from './announcement';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import ReferralMoment from '../src/components/ReferralMoment';
import ResultShareActions from '../src/components/ResultShareActions';
import TypingRacer from '../src/components/TypingRacer';
import { clearAccountData } from '../src/lib/accountData';
import type { ReferralSummary } from '../src/lib/referral';
import { server } from './mocks/server';

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../src/lib/analytics', async (importOriginal) => ({ ...(await importOriginal<object>()), capture: analytics.capture }));
const card = vi.hoisted(() => ({
  create: vi.fn(async (input: { fileSuffix: string }) => new File(['png'], `devshark-${input.fileSuffix}.png`, { type: 'image/png' })),
  download: vi.fn(),
}));
vi.mock('../src/lib/shareCard', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createShareCardFile: card.create,
  downloadShareFile: card.download,
}));

const SUMMARY: ReferralSummary = { enabled: true, code: 'abcd2345', coins: 100, cap: 20, credited: 0, pending: 0, invited: null };
const referral = (summary: unknown = SUMMARY) => server.use(http.get('*/api/user/referral', () => HttpResponse.json(summary as never)));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}><MemoryRouter><LanguageProvider>{children}</LanguageProvider></MemoryRouter></QueryClientProvider>;
}

const clipboard = { writeText: vi.fn(async (_text: string) => undefined) };
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
  analytics.capture.mockClear();
  card.create.mockClear();
  card.download.mockClear();
});
afterEach(() => {
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

describe('the invite link at a moment of success', () => {
  it('shows nothing while signed out, so the result screen stays about the result', () => {
    const { container } = render(<ReferralMoment signedIn={false} source="challenge" />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when invitations are off', async () => {
    referral({ enabled: false });
    const { container } = render(<ReferralMoment signedIn source="challenge" />, { wrapper });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container).toBeEmptyDOMElement();
  });

  it('copies the link and fires share_initiated with a fixed payload', async () => {
    referral();
    render(<ReferralMoment signedIn source="challenge" />, { wrapper });
    expect(await screen.findByRole('heading', { name: 'Bring a friend along' })).toBeInTheDocument();
    expect(screen.getByText(/you each get 100 coins/)).toBeInTheDocument();
    // No share sheet on this platform: copying is the primary action.
    expect(screen.queryByRole('button', { name: 'Share invite' })).toBeNull();
    const verifyAnnouncement = trackAnnouncement('.ss-share-moment .ss-share-moment__status');
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/?ref=abcd2345`));
    expect(await screen.findByText('Link copied.')).toHaveAttribute('role', 'status');
    verifyAnnouncement('Link copied.');
    expect(analytics.capture).toHaveBeenCalledWith('share_initiated', { kind: 'referral', source: 'challenge', method: 'copy' });
  });

  it('says Link copied again on a second Copy, by emptying the status line first', async () => {
    referral();
    render(<ReferralMoment signedIn source="challenge" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy invite link' }));
    const line = await screen.findByText('Link copied.');
    const heard: string[] = [];
    const watch = new MutationObserver(() => heard.push(line.textContent ?? ''));
    watch.observe(line, { childList: true, characterData: true, subtree: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    await waitFor(() => expect(heard).toEqual(['', 'Link copied.']));
    watch.disconnect();
  });

  it('opens the share sheet where the platform has one', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    referral();
    render(<ReferralMoment signedIn source="learn_level" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Share invite' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}/?ref=abcd2345` })));
    expect(analytics.capture).toHaveBeenCalledWith('share_initiated', { kind: 'referral', source: 'learn_level', method: 'share' });
    expect(await screen.findByText('Invite shared.')).toHaveAttribute('role', 'status');
  });

  it('shows the link selected when the clipboard refuses', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    referral();
    render(<ReferralMoment signedIn source="challenge" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy invite link' }));
    expect(await screen.findByRole('textbox', { name: 'Your invite link' })).toHaveValue(`${window.location.origin}/?ref=abcd2345`);
  });
});

describe('the result card', () => {
  const props = { kind: 'challenge_result', label: 'Biggest Shark Challenge', headline: '14 correct', detail: 'before three strikes', text: 'I got 14 right', path: '/challenge' } as const;

  it('downloads a card made of the numbers and the date alone', async () => {
    render(<ResultShareActions {...props} />, { wrapper });
    const verifyAnnouncement = trackAnnouncement('.ss-share-result .ss-share-moment__status');
    fireEvent.click(screen.getByRole('button', { name: 'Download card' }));
    await waitFor(() => expect(card.download).toHaveBeenCalled());
    const input = card.create.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['accent', 'brand', 'date', 'detail', 'fileSuffix', 'headline', 'label', 'theme']);
    expect(input).toMatchObject({ brand: 'devShark', label: 'Biggest Shark Challenge', headline: '14 correct', detail: 'before three strikes', fileSuffix: 'challenge' });
    expect(await screen.findByText('Card saved to your downloads.')).toHaveAttribute('role', 'status');
    verifyAnnouncement('Card saved to your downloads.');
    expect(analytics.capture).toHaveBeenCalledWith('share_initiated', { kind: 'challenge_result', source: 'challenge', method: 'download' });
  });

  it('attaches the card to a share when the platform accepts files', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    render(<ResultShareActions {...props} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Share result' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const data = share.mock.calls[0][0];
    expect(data.url).toBe(`${window.location.origin}/challenge`);
    expect(data.files?.[0]?.name).toBe('devshark-challenge.png');
  });

  it('leaves sharing off a scored typing race', async () => {
    render(<TypingRacer />, { wrapper });
    const input = await screen.findByRole('textbox', { name: 'Type this' });
    const snippet = document.querySelector('.ss-typing__guide')!.textContent!;
    fireEvent.change(input, { target: { value: snippet } });
    expect(await screen.findByRole('button', { name: 'Race again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share result' })).toBeNull();
  });
});

describe('the typing best', () => {
  /** A clean race that takes `ms` of the clock. */
  async function race(ms: number) {
    const input = await screen.findByRole('textbox', { name: 'Type this' });
    const snippet = document.querySelector('.ss-typing__guide')!.textContent!;
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      fireEvent.change(input, { target: { value: snippet[0] } });
      now.mockReturnValue(1_000_000 + ms);
      fireEvent.change(input, { target: { value: snippet } });
    } finally {
      now.mockRestore();
    }
  }

  it('records a new best over a stored one of another shape', async () => {
    localStorage.setItem('devshark:typing:v1', JSON.stringify({ bestWpm: 'fast' }));
    render(<TypingRacer />, { wrapper });
    await race(6_000);
    expect(await screen.findByText('New personal best')).toBeInTheDocument();
    expect((JSON.parse(localStorage.getItem('devshark:typing:v1')!) as { bestWpm: unknown }).bestWpm).toEqual(expect.any(Number));
  });

  it('reads the outcome from a status that was on the page before the race ended', async () => {
    render(<TypingRacer />, { wrapper });
    await screen.findByRole('textbox', { name: 'Type this' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    await race(6_000);
    await screen.findByRole('button', { name: 'Race again' });
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(/^Race finished\. \d+ WPM at 100% accuracy\. New personal best$/);
  });

  it('leaves with the account that signs out', async () => {
    localStorage.setItem('devshark:typing:v1', JSON.stringify({ bestWpm: 40 }));
    render(<TypingRacer />, { wrapper });
    expect(await screen.findByText('Best: 40 WPM')).toBeInTheDocument();
    act(() => { clearAccountData(); });
    expect(screen.queryByText('Best: 40 WPM')).toBeNull();
  });
});
