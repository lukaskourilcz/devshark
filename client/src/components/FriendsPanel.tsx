/**
 * The Friends tab.
 *
 * Three things, in the order a learner meets them: your own sharkname (without
 * one nobody can find you), anyone waiting for an answer, and the people you
 * have already added. The sharkname is the handle: it is chosen, rolled and
 * saved in the 'Your name' panel on the Overview tab (SharknameCard, its
 * 'Sharkname' field), which this tab links to rather than repeating.
 *
 * There is no directory and no browsing. You reach somebody by typing the
 * handle they chose, exactly. That is the whole discovery model, and the copy
 * says so rather than leaving it to be discovered by a search that finds
 * nothing.
 *
 * A friend is shown by the name they chose for friends (migration 055): their
 * sharkname, or their Google name if they switched that on. Their avatar is
 * their Google photo only if they switched that on too, and their initials on
 * an ocean ink otherwise. Beside it sit their flag and, if they own one, their
 * crown. Where the name shown is not the sharkname, the sharkname follows it,
 * since that is what you would type to find them.
 *
 * Every number on a friend's row comes from the server. The crown is a picture
 * somebody spent earned tokens on: it is shown and it changes nothing, least of
 * all the order of this list, which is by correct answers and then accuracy
 * (migration 040; never by streak). The flag is the same — where somebody is
 * from moves them up nothing.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n/LanguageContext';
import { friendlyError } from '../lib/api';
import { CrownBadge } from './ui/Crown';
import { CountryFlag, countryOptions } from './ui/CountryFlag';
import { InitialsAvatar } from './ui/InitialsAvatar';
import { BrandedConfirmDialog, type ConfirmRequest } from './ui/BrandedConfirmDialog';
import {
  getHandle, setDiscoverable, setCountry,
  lookupFriend, requestFriend, respondFriend, removeFriend, listFriends,
  isValidHandle,
  type Friend, type FriendRequest, type HandleState, type LookupResult,
} from '../lib/friends';
import './Friends.css';
import { Button } from '@astryxdesign/core/Button';
import LoadingScreen from './LoadingScreen';
import { HANDLE_MAX_LENGTH } from '../../../shared/handles';

type Load = 'loading' | 'ready' | 'unavailable';

export function FriendsPanel({ onEditSharkname }: { onEditSharkname?: () => void } = {}) {
  const t = useT();
  const [state, setState] = useState<Load>('loading');
  const [handle, setHandleState] = useState<HandleState | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The tab has drawn the learner's list once. A read after a change that
  // fails then keeps that list on screen, with the error above it.
  const loaded = useRef(false);
  // Two answers in a row start two reads; only the later one may draw, or
  // the earlier, older list brings back a request already answered.
  const readSeq = useRef(0);
  // The newest read. A read a later one overtook settles with that one, so a
  // caller waiting on it (a save showing its value until the read lands)
  // waits for the read that draws, not for one that drew nothing.
  const latestRead = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback((): Promise<void> => {
    const seq = ++readSeq.current;
    const read = (async (): Promise<void> => {
      try {
        const [own, list] = await Promise.all([getHandle(), listFriends()]);
        if (seq !== readSeq.current) return latestRead.current;
        setHandleState(own);
        setFriends(list.friends);
        setRequests(list.requests);
        setError(null);
        loaded.current = true;
        setState('ready');
      } catch (err) {
        if (seq !== readSeq.current) return latestRead.current;
        setError(friendlyError(err));
        // The most likely cause of a first read failing is the migration not
        // being applied yet. Either way the honest thing is to say the tab is
        // not available, not to show an empty friends list that looks like
        // nobody has been added.
        if (!loaded.current) setState('unavailable');
      }
    })();
    latestRead.current = read;
    return read;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const retry = () => {
    setState('loading');
    void refresh();
  };

  if (state === 'loading') {
    return <LoadingScreen label={t('friends.loading')} sx={{ minHeight: 160 }} />;
  }
  if (state === 'unavailable') {
    return (
      <div className="fr-empty ss-panel" style={{ padding: 24 }}>
        <p className="fr-note">{t('friends.unavailable')}</p>
        {error && <p className="fr-note fr-note--error">{error}</p>}
        <div>
          <Button variant="secondary" label={t('quiz.retry')} onClick={retry} />
        </div>
      </div>
    );
  }

  return (
    <div className="fr">
      {error && <p className="fr-note fr-note--error" role="alert">{error}</p>}
      <HandleCard state={handle} onChanged={refresh} onEditSharkname={onEditSharkname} />
      {handle?.handle && <FindFriend onChanged={refresh} ownHandle={handle.handle} />}
      {requests.length > 0 && <Requests requests={requests} onChanged={refresh} />}
      <FriendList friends={friends} hasHandle={Boolean(handle?.handle)} onChanged={refresh} />
    </div>
  );
}

/** The rows with a change in flight. The ref holds a row at the press,
 * because the disabled state reaches its buttons a render later, after a
 * double click has sent its second answer; a set, so one row's answer that
 * ends does not re-enable another row's buttons while that one runs. */
function useInFlight() {
  const running = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const run = async (key: string, work: () => Promise<void>) => {
    if (running.current.has(key)) return;
    running.current.add(key);
    setBusy(new Set(running.current));
    try {
      await work();
    } finally {
      running.current.delete(key);
      setBusy(new Set(running.current));
    }
  };
  return { isBusy: (key: string) => busy.has(key), run };
}

/* ── your own sharkname ─────────────────────────────────────────────────── */

function HandleCard({
  state,
  onChanged,
  onEditSharkname,
}: {
  state: HandleState | null;
  onChanged: () => Promise<void> | void;
  onEditSharkname?: () => void;
}) {
  const t = useT();
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  // The values being saved, shown until the read after the saves lands: the
  // controls are bound to the server's state, so without them the box ticked
  // a moment ago sprang back, and a second click sent the same change again.
  // The controls stay enabled (disabling one drops its focus), and a change
  // made while a save runs follows it, so the last choice is the one stored.
  type Change = { discoverable?: boolean; country?: string };
  const [shown, setShown] = useState<Change>({});
  const queued = useRef<Change | null>(null);
  const sending = useRef(false);

  const send = async () => {
    sending.current = true;
    try {
      // A change made during the re-read is queued too (`sending` is still
      // set), so after each re-read the loop looks again before it stops.
      while (queued.current) {
        while (queued.current) {
          const next = queued.current;
          queued.current = null;
          try {
            if (next.discoverable !== undefined) await setDiscoverable(next.discoverable);
            if (next.country !== undefined) await setCountry(next.country);
          } catch (err) {
            setError(friendlyError(err));
            queued.current = null;
          }
        }
        await onChanged();
      }
    } finally {
      sending.current = false;
      setShown({});
    }
  };
  const save = (change: Change) => {
    setError(null);
    setShown((current) => ({ ...current, ...change }));
    queued.current = { ...queued.current, ...change };
    if (!sending.current) void send();
  };
  const shownCountry = shown.country ?? state?.country ?? '';
  const shownDiscoverable = shown.discoverable ?? state?.discoverable ?? false;

  // 249 codes named and sorted in English. Memoised because that is 249 Intl
  // lookups and a collated sort.
  const countries = useMemo(() => countryOptions(), []);

  return (
    <section className="fr-card ss-panel" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`} className="fr-card__title">{t('friends.handleTitle')}</h3>
      <div className="fr-row fr-row--sharkname">
        <p className="fr-note">
          {state?.handle
            ? t('friends.sharknameIs', { handle: state.handle })
            : t('friends.sharknameNone')}
        </p>
        {onEditSharkname && (
          <Button
            variant={state?.handle ? 'secondary' : 'primary'}
            onClick={onEditSharkname}
            label={state?.handle ? t('friends.sharknameChange') : t('friends.sharknamePick')}
          />
        )}
      </div>
      {error && <p className="fr-note fr-note--error" role="alert">{error}</p>}
      {state?.handle && (
        <>
          <div className="fr-row fr-row--country">
            <label className="fr-label" htmlFor={`${inputId}-country`}>{t('friends.countryLabel')}</label>
            <span className="fr-country">
              <CountryFlag code={shownCountry || null} size={20} />
              <select
                id={`${inputId}-country`}
                className="fr-select"
                value={shownCountry}
                onChange={(event) => save({ country: event.target.value })}
              >
                <option value="">{t('friends.countryNone')}</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>{country.name}</option>
                ))}
              </select>
            </span>
          </div>
          <p className="fr-note">{t('friends.countryHelp')}</p>
          <label className="fr-check">
            <input
              type="checkbox"
              checked={shownDiscoverable}
              onChange={(event) => save({ discoverable: event.target.checked })}
            />
            <span>
              {t('friends.discoverable')}
              <span className="fr-note">{t('friends.discoverableHelp')}</span>
            </span>
          </label>
        </>
      )}
    </section>
  );
}

/* ── finding somebody ───────────────────────────────────────────────────── */

function FindFriend({ ownHandle, onChanged }: { ownHandle: string; onChanged: () => void }) {
  const t = useT();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const look = async () => {
    const handle = query.trim();
    if (!isValidHandle(handle)) { setResult({ found: false }); setError(null); return; }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(null);
    try {
      const found = await lookupFriend(handle, controller.signal);
      if (!controller.signal.aborted) setResult(found);
    } catch (err) {
      if (!controller.signal.aborted) setError(friendlyError(err));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const asking = useInFlight();
  const ask = (handle: string) => asking.run(handle, async () => {
    const lookup = abort.current;
    const stillCurrent = () => abort.current === lookup && !lookup?.signal.aborted;
    setError(null);
    try {
      const { state } = await requestFriend(handle);
      if (stillCurrent()) setResult((current) => current?.handle === handle ? { ...current, state } : current);
      onChanged();
    } catch (err) {
      if (stillCurrent()) setError(friendlyError(err));
    }
  });

  return (
    <section className="fr-card ss-panel" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`} className="fr-card__title">{t('friends.findTitle')}</h3>
      <p className="fr-note">{t('friends.findHelp', { handle: ownHandle })}</p>
      <div className="fr-row">
        <label className="ss-sr-only" htmlFor={inputId}>{t('friends.findTitle')}</label>
        <input
          id={inputId}
          className="fr-input"
          value={query}
          maxLength={HANDLE_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t('friends.findPlaceholder')}
          onChange={(event) => {
            // A lookup still on its way answers a handle the box no longer
            // holds: drop it, or it would offer Add under the edited text.
            abort.current?.abort();
            abort.current = null;
            setBusy(false);
            setQuery(event.target.value);
            setResult(null);
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void look(); } }}
        />
        <Button variant="secondary" isDisabled={busy} onClick={() => void look()} label={busy ? t('friends.searching') : t('friends.find')} />
      </div>

      {result && !result.found && (
        <p className="fr-note" role="status">{t('friends.notFound')}</p>
      )}
      {result?.found && result.handle && (
        <div className="fr-result" role="status">
          <span className="fr-result__handle">
            {result.displayName ?? result.handle}
            {result.displayName && result.displayName !== result.handle && <span className="fr-handle">{result.handle}</span>}
          </span>
          {result.state === 'none' && (
            <Button variant="primary" isDisabled={busy || asking.isBusy(result.handle)} onClick={() => void ask(result.handle!)} label={t('friends.add')} />
          )}
          {result.state === 'self' && <span className="fr-note">{t('friends.isYou')}</span>}
          {result.state === 'accepted' && <span className="fr-note">{t('friends.alreadyFriends')}</span>}
          {result.state === 'pending_out' && <span className="fr-note">{t('friends.requestSent')}</span>}
          {result.state === 'pending_in' && <span className="fr-note">{t('friends.theyAsked')}</span>}
          {result.state === 'declined_out' && <span className="fr-note">{t('friends.wasDeclined')}</span>}
          {result.state === 'declined_in' && (
            <Button variant="primary" isDisabled={busy || asking.isBusy(result.handle)} onClick={() => void ask(result.handle!)} label={t('friends.add')} />
          )}
          {result.state === 'blocked' && <span className="fr-note">{t('friends.blocked')}</span>}
        </div>
      )}
      {error && <p className="fr-note fr-note--error" role="alert">{error}</p>}
    </section>
  );
}

/* ── requests waiting for an answer ─────────────────────────────────────── */

function Requests({ requests, onChanged }: { requests: FriendRequest[]; onChanged: () => Promise<void> }) {
  const t = useT();
  const titleId = useId();
  const answering = useInFlight();
  const [error, setError] = useState<string | null>(null);

  const answer = (handle: string, accept: boolean) => answering.run(handle, async () => {
    setError(null);
    // The row stays busy until the read that removes it lands: re-enabled
    // before, a third press sent the answer again.
    try { await respondFriend(handle, accept); await onChanged(); }
    catch (err) { setError(friendlyError(err)); }
  });

  const incoming = requests.filter((one) => one.direction === 'incoming');
  const outgoing = requests.filter((one) => one.direction === 'outgoing');

  return (
    <section className="fr-card ss-panel" aria-labelledby={titleId}>
      <h3 id={titleId} className="fr-card__title">{t('friends.requestsTitle')}</h3>
      <ul className="fr-list">
        {incoming.map((one) => (
          <li key={one.handle} className="fr-item">
            <span className="fr-item__handle">
              {one.displayName}
              {one.displayName !== one.handle && <span className="fr-handle">{one.handle}</span>}
            </span>
            <span className="fr-item__actions">
              <Button variant="primary" isDisabled={answering.isBusy(one.handle)} aria-label={t('friends.acceptOne', { name: one.displayName })} onClick={() => void answer(one.handle, true)} label={t('friends.accept')} />
              <Button variant="secondary" isDisabled={answering.isBusy(one.handle)} aria-label={t('friends.declineOne', { name: one.displayName })} onClick={() => void answer(one.handle, false)} label={t('friends.decline')} />
            </span>
          </li>
        ))}
        {outgoing.map((one) => (
          <li key={one.handle} className="fr-item">
            <span className="fr-item__handle">{one.displayName}</span>
            <span className="fr-note">{t('friends.requestSent')}</span>
          </li>
        ))}
      </ul>
      {error && <p className="fr-note fr-note--error" role="alert">{error}</p>}
    </section>
  );
}

/* ── the list ───────────────────────────────────────────────────────────── */

function FriendList({ friends, hasHandle, onChanged }: { friends: Friend[]; hasHandle: boolean; onChanged: () => Promise<void> }) {
  const t = useT();
  const titleId = useId();
  const removing = useInFlight();
  const [error, setError] = useState<string | null>(null);
  // Removing a friend is mutual and takes a new request to undo, so it asks
  // first. Once the row is gone its button is too, and focus moves to the
  // list's heading instead of falling to the page.
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [focusList, setFocusList] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (!focusList || confirm) return;
    setFocusList(false);
    headingRef.current?.focus();
  }, [focusList, confirm]);

  const drop = (handle: string) => removing.run(handle, async () => {
    setError(null);
    try { await removeFriend(handle); await onChanged(); setFocusList(true); }
    catch (err) { setError(friendlyError(err)); }
  });

  const askToDrop = (friend: Friend) => setConfirm({
    title: t('friends.removeConfirmTitle', { name: friend.displayName }),
    description: t('friends.removeConfirmBody'),
    actionLabel: t('friends.remove'),
    onConfirm: () => drop(friend.handle),
  });

  return (
    <section className="fr-card ss-panel" aria-labelledby={titleId}>
      <h3 id={titleId} ref={headingRef} tabIndex={-1} className="fr-card__title">{t('friends.listTitle', { n: friends.length })}</h3>
      {friends.length === 0 ? (
        <p className="fr-note">{hasHandle ? t('friends.empty') : t('friends.emptyNoHandle')}</p>
      ) : (
        <ul className="fr-list">
          {friends.map((friend) => (
            <li key={friend.handle} className="fr-friend">
              {/* The name is written beside it, so the avatar is decoration. */}
              <InitialsAvatar name={friend.displayName} src={friend.picture} size={36} />
              <span className="fr-friend__who">
                <span className="fr-friend__identity">
                  <span className="fr-friend__name">
                    {friend.displayName}
                    {friend.displayName !== friend.handle && <span className="fr-handle">{friend.handle}</span>}
                  </span>
                  <span className="fr-friend__marks">
                    <CountryFlag code={friend.country} size={16} />
                    {/* Owned and worn. It says nothing about anybody's learning
                        and it does not move this row: the order is by correct
                        answers, then accuracy. */}
                    {friend.crown && <CrownBadge size={16} />}
                  </span>
                </span>
                <span className="fr-friend__meta">
                  {t('friends.streakDays', { n: friend.currentStreak })}
                  {' · '}
                  {friend.totalQuestions > 0
                    ? t('friends.accuracy', { pct: friend.accuracyPct })
                    : t('friends.noAnswersYet')}
                  {friend.activeToday && <> {' · '}<span className="fr-today">{t('friends.today')}</span></>}
                </span>
              </span>
              <Button variant="secondary" isDisabled={removing.isBusy(friend.handle)} aria-label={t('friends.removeOne', { name: friend.displayName })} onClick={() => askToDrop(friend)} label={t('friends.remove')} />
            </li>
          ))}
        </ul>
      )}
      {error && <p className="fr-note fr-note--error" role="alert">{error}</p>}
      <BrandedConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}

export default FriendsPanel;
