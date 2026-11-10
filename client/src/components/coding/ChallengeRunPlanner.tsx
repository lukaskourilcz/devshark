// A challenge run: the learner picks a track, a size and an order, then
// starts it now or plans it for a moment they choose. The server chooses the
// queue from what the learner can already open; this screen only asks.
//
// One run at a time. While a run is open — active, or planned for later —
// the planner shows that run instead of a form: where it stands, when it is
// due, and the way to continue, start, cancel, or put it in a calendar.
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';
import type { TranslationKey } from '../../i18n/translations';
import { codingListCopy } from '../../i18n/translations.codingLists';
import { useAdvanceSession, usePracticeSession, useStartSession } from '../../coding/practice';
import { ApiError } from '../../lib/api';
import { CODING_INDEX } from '../../../../shared/coding-index';
import { CODING_SECTION_TRACKS, type CodingTrack } from '../../../../shared/coding-catalog';
import { PRACTICE_RUN_COUNTS, type PracticeOrder, type PracticeSession } from '../../../../shared/coding-api';
import { Button } from '@astryxdesign/core/Button';

const trackOf = (taskId: string): CodingTrack | null => CODING_INDEX.find((task) => task.id === taskId)?.track ?? null;

/** The route of a queued task, or the Coding home when the id is unknown. */
export const taskHref = (taskId: string): string => {
  const track = trackOf(taskId);
  return track ? `/coding/${track}/${taskId}` : '/coding';
};

/** The task the run is on, or null once every queued task is done. */
export const currentRunTask = (session: PracticeSession): string | null =>
  session.queue[Math.min(session.position, session.queue.length)] ?? null;

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short' }).format(date);
}

/** A one-event calendar file for a planned run, built here and offered as a
 * download. It names the run and links back to Coding; nothing is sent. */
export function calendarHref(session: PracticeSession, title: string): string {
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const start = new Date(session.scheduledFor ?? Date.now());
  const end = new Date(start.getTime() + Math.max(15, session.estimatedMinutes) * 60_000);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//devShark//Challenge run//EN', 'BEGIN:VEVENT',
    `UID:${session.sessionId}@devshark`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${title}`, `DESCRIPTION:${origin}/coding`, `URL:${origin}/coding`, 'END:VEVENT', 'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

/** What the picker sends as `datetime-local`, as a value the server reads. */
const localToIso = (value: string): string | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const nowLocal = (): string => {
  const date = new Date(Date.now() + 5 * 60_000);
  date.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function runSummary(session: PracticeSession, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const track = session.topic ? t(`coding.track.${session.topic}` as TranslationKey) : t('coding.run.anyTrack');
  return t('coding.run.summary', { n: session.queue.length, track, order: t(session.order === 'random' ? 'coding.run.random' : 'coding.run.sequential') });
}

/** The open run, with its own actions. */
function RunCard({ session, onDone, resumeInPrimary = false }: { session: PracticeSession; onDone: () => void; resumeInPrimary?: boolean }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const advance = useAdvanceSession();
  const transitioning = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const scheduled = session.status === 'scheduled';
  const due = scheduled && Boolean(session.scheduledFor) && new Date(session.scheduledFor!).getTime() <= Date.now();
  const current = currentRunTask(session);
  const finished = !scheduled && current === null;
  const done = Math.min(session.position, session.queue.length);

  const changeStatus = (status: 'active' | 'finished' | 'abandoned') => {
    if (transitioning.current) return;
    transitioning.current = true;
    setError(null);
    advance.mutate({ sessionId: session.sessionId, status }, {
      onSuccess: (data) => {
        if (status === 'active') {
          const first = data.session ? currentRunTask(data.session) : null;
          if (first) navigate(taskHref(first));
        } else {
          onDone();
        }
      },
      onError: () => setError(t('coding.run.failed')),
      onSettled: () => { transitioning.current = false; },
    });
  };

  return (
    <div className="cd-run__card" role="group" aria-labelledby="cd-run-card-title">
      <h3 className={scheduled ? 'ss-kicker' : 'ss-sr-only'} id="cd-run-card-title">{t(scheduled ? 'coding.run.planned' : 'coding.run.active')}</h3>
      <p className="cd-run__summary">{runSummary(session, t)}</p>
      {scheduled && session.scheduledFor && (
        <p className="cd-run__when" role="status">
          {t('coding.run.plannedFor', { when: formatWhen(session.scheduledFor) })}
          {due && <> {t('coding.run.due')}</>}
        </p>
      )}
      {!scheduled && (
        <p className="cd-run__when" role="status">
          {finished ? t('coding.run.finished') : t('coding.run.progress', { done, total: session.queue.length, minutes: session.estimatedMinutes })}
        </p>
      )}
      <div className="cd-actions">
        {/* Secondary: the Coding home's one SwimCta is its next challenge. */}
        {scheduled && <Button variant="secondary" isDisabled={advance.isPending} onClick={() => changeStatus('active')} label={t('coding.run.startNow')} />}
        {!scheduled && current && !resumeInPrimary && <Button variant="secondary" as={Link} href={taskHref(current)} label={t('coding.run.continue')} />}
        {scheduled && (
          <span className="ss-text-links" style={{ margin: 0 }}>
            <a href={calendarHref(session, t('coding.run.calendarTitle'))} download="devshark-challenge-run.ics">{t('coding.run.calendar')}</a>
          </span>
        )}
        <span className="cd-run__ending">
          {!finished && <span>{codingListCopy('coding.run.saved')}</span>}
          <Button variant="ghost" isDisabled={advance.isPending} onClick={() => changeStatus(finished ? 'finished' : 'abandoned')} label={t(finished ? 'coding.run.close' : scheduled ? 'coding.run.cancel' : 'coding.run.end')} />
        </span>
      </div>
      {error && <p className="cd-note cd-note--error" role="alert">{error}</p>}
    </div>
  );
}

/** `collapsible` renders the planner as one row that opens on click (design
 * audit P1.6): a hairline disclosure, not a card (UX audit coding-08), with
 * the title, one line on what a run is, and "Plan a run" at its end. A run
 * already open or scheduled keeps the planner open, so its card is never
 * hidden behind the toggle. */
export function ChallengeRunPlanner({ signedIn, collapsible = false, resumeInPrimary = false }: { signedIn: boolean; collapsible?: boolean; resumeInPrimary?: boolean }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(!collapsible);
  const bodyId = useId();
  const navigate = useNavigate();
  const session = usePracticeSession(signedIn);
  const start = useStartSession();
  const [track, setTrack] = useState<CodingTrack | null>(null);
  const [count, setCount] = useState<number>(PRACTICE_RUN_COUNTS[0]);
  const [order, setOrder] = useState<PracticeOrder>('sequential');
  const [later, setLater] = useState(false);
  const [at, setAt] = useState<string>(nowLocal);
  const [error, setError] = useState<string | null>(null);
  const minLocal = useMemo(nowLocal, []);
  const open = session.data?.session ?? null;
  // One start at a time. The button turns busy only once the mutation's
  // state reaches React, a task or two later, and a second press in that gap
  // started a second run that replaced the first.
  const starting = useRef(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (starting.current) return;
    setError(null);
    const scheduledFor = later ? localToIso(at) : null;
    if (later && !scheduledFor) { setError(t('coding.run.badTime')); return; }
    starting.current = true;
    start.mutate({ count, order, ...(track ? { topic: track } : {}), ...(scheduledFor ? { scheduledFor } : {}) }, {
      onSettled: () => { starting.current = false; },
      onSuccess: (data) => {
        const run = data.session;
        if (!run) return;
        if (run.status === 'active') { const first = currentRunTask(run); if (first) navigate(taskHref(first)); }
      },
      onError: (failure) => {
        const code = failure instanceof ApiError ? failure.code : '';
        setError(t(code === 'nothing_eligible' ? 'coding.run.nothing' : code === 'migration_required' ? 'coding.run.unavailable' : 'coding.run.failed'));
      },
    });
  };

  const showBody = expanded || !!open;
  return (
    <section className={`cd-run${showBody ? '' : ' cd-run--collapsed'}`} aria-labelledby="cd-run-title">
      <div className="cd-run__head">
        <div className="cd-run__intro">
          <h2 id="cd-run-title" className="cd-run__title">{t('coding.run.title')}</h2>
          {!open && <p className="cd-run__lead">{codingListCopy('coding.run.lead')}</p>}
        </div>
        {collapsible && !open && (
          <Button
            variant="secondary"
            className="cd-run__toggle"
            aria-expanded={showBody}
            aria-controls={bodyId}
            onClick={() => setExpanded((value) => !value)}
            label={codingListCopy(showBody ? 'coding.run.hide' : 'coding.run.open')}
          />
        )}
      </div>
      {showBody && (<div id={bodyId} className="cd-run__body">
      {!signedIn && <p className="cd-note">{t('coding.run.signIn')}</p>}
      {signedIn && session.isError && (
        <p className="cd-note cd-note--error" role="alert">
          {t('coding.run.loadFailed')} <Button variant="secondary" onClick={() => void session.refetch()} label={t('coding.retry')} />
        </p>
      )}
      {signedIn && open && <RunCard session={open} onDone={() => void session.refetch()} resumeInPrimary={resumeInPrimary} />}
      {/* Until the open run is known there is no Start: a run started now
          would replace one the learner already has, unseen. */}
      {signedIn && !open && !session.isError && session.isPending && <p className="cd-note" role="status">{t('common.loading')}</p>}
      {signedIn && !open && !session.isError && !session.isPending && (
        <form className="cd-run__form" onSubmit={submit} aria-busy={start.isPending}>
          <div className="cd-run__field">
            <span className="cd-run__label" id="cd-run-track">{t('coding.run.track')}</span>
            <div className="cd-chips" role="group" aria-labelledby="cd-run-track">
              <button type="button" className="cd-chip" aria-pressed={track === null} onClick={() => setTrack(null)}>{t('coding.run.anyTrack')}</button>
              {CODING_SECTION_TRACKS.map((one) => (
                <button key={one} type="button" className="cd-chip" aria-pressed={track === one} onClick={() => setTrack(one)}>{t(`coding.track.${one}` as TranslationKey)}</button>
              ))}
            </div>
          </div>
          <div className="cd-run__field">
            <span className="cd-run__label" id="cd-run-count">{t('coding.run.count')}</span>
            <div className="cd-chips" role="group" aria-labelledby="cd-run-count">
              {PRACTICE_RUN_COUNTS.map((n) => (
                <button key={n} type="button" className="cd-chip" aria-pressed={count === n} onClick={() => setCount(n)}>{t('coding.run.countOption', { n })}</button>
              ))}
            </div>
          </div>
          <fieldset className="cd-run__options">
            <legend>{t('coding.run.order')}</legend>
            {(['sequential', 'random'] as const).map((one) => (
              <label key={one} className="cd-run__option">
                <input type="radio" name="cd-run-order" value={one} checked={order === one} onChange={() => setOrder(one)} />
                <span><strong>{t(`coding.run.${one}`)}</strong><br /><small>{t(`coding.run.${one}Note`)}</small></span>
              </label>
            ))}
          </fieldset>
          <fieldset className="cd-run__options">
            <legend>{t('coding.run.when')}</legend>
            <label className="cd-run__option">
              <input type="radio" name="cd-run-when" value="now" checked={!later} onChange={() => setLater(false)} />
              <span><strong>{t('coding.run.now')}</strong></span>
            </label>
            <label className="cd-run__option">
              <input type="radio" name="cd-run-when" value="later" checked={later} onChange={() => setLater(true)} />
              <span><strong>{t('coding.run.later')}</strong><br /><small>{t('coding.run.laterNote')}</small></span>
            </label>
            {later && (
              <div className="cd-run__time">
                <label htmlFor="cd-run-at">{t('coding.run.at')}</label>
                <input id="cd-run-at" type="datetime-local" value={at} min={minLocal} required onChange={(event) => setAt(event.target.value)} />
              </div>
            )}
          </fieldset>
          <div className="cd-actions">
            <Button type="submit" variant="secondary" label={start.isPending ? t('coding.submitting') : t(later ? 'coding.run.plan' : 'coding.run.start')} isDisabled={start.isPending} />
          </div>
          {error && <p className="cd-note cd-note--error" role="alert">{error}</p>}
        </form>
      )}
      </div>)}
    </section>
  );
}
