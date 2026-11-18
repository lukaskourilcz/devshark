// The learner's open challenge run, as a Today card: a planned run with the
// moment it was planned for and a Start button, or an active run with how far
// it has got and a link to the next challenge. Renders nothing without a run.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAdvanceSession, usePracticeSession } from '../../coding/practice';
import { accountEpoch } from '../../lib/accountData';
import { currentRunTask, formatWhen, runSummary, taskHref, usePracticeRunDue } from './ChallengeRunPlanner';

const RunGlyph = ({ size = 20 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </svg>
);
const ArrowGlyph = ({ size = 16 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export function ChallengeRunSection() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const query = usePracticeSession(true);
  const advance = useAdvanceSession();
  const session = query.data?.session ?? null;
  const due = usePracticeRunDue(session?.status === 'scheduled' ? session.scheduledFor : null);
  // One start at a time: the button turns busy only once advance.isPending
  // reaches React, a task after the press, and a second press in that gap sent
  // a second status change. Declared before the early returns below.
  const starting = useRef(false);
  // This section stays mounted while the account changes, so a start answered
  // after a Log out or another account's sign-in neither moves the next
  // learner to the previous learner's run nor tells them it failed. The
  // failure is this press's, not the mutation's isError, which outlives the
  // account that pressed, and it belongs to the run that failed to start.
  const [failedRun, setFailedRun] = useState<string | null>(null);
  if (!session) return null;
  const scheduled = session.status === 'scheduled';
  const current = scheduled ? null : currentRunTask(session);
  if (!scheduled && !current) return null;
  const meta = runSummary(session, t);
  const reason = scheduled
    ? t(due ? 'today.runDue' : 'today.runPlanned', { when: formatWhen(session.scheduledFor ?? '') })
    : t('today.runActive', { done: Math.min(session.position, session.queue.length), total: session.queue.length });
  const actionLabel = scheduled ? t('today.runStart') : t('coding.run.continue');
  const body = (
    <>
      <span className="today-card__glyph" aria-hidden="true" style={{ color: 'var(--brand-accent)' }}><RunGlyph size={22} /></span>
      <span className="today-card__body">
        <span className="today-card__meta">{meta}</span>
        <span className="today-card__reason">{reason}</span>
      </span>
      <span className="today-card__action" aria-hidden="true">
        <span className="today-card__action-label">{actionLabel}</span>
        <ArrowGlyph />
      </span>
    </>
  );
  const begin = () => {
    if (starting.current) return;
    starting.current = true;
    setFailedRun(null);
    const epoch = accountEpoch();
    const run = session.sessionId;
    advance.mutate({ sessionId: run, status: 'active' }, {
      onSuccess: (data) => {
        if (accountEpoch() !== epoch) return;
        const first = data.session ? currentRunTask(data.session) : null;
        navigate(first ? taskHref(first) : '/coding');
      },
      onError: () => { if (accountEpoch() === epoch) setFailedRun(run); },
      onSettled: () => { starting.current = false; },
    });
  };

  return (
    <section className="today-section" aria-label={t('today.runSection')}>
      <h2 className="today-section__title">{t('today.runSection')}</h2>
      <ul className="today-list">
        <li>
          {scheduled
            ? <button type="button" className="today-card ss-panel ss-lift today-card--button" data-start-here={due ? '' : undefined} aria-label={`${actionLabel}: ${meta}`} disabled={advance.isPending} onClick={begin}>{body}</button>
            : <Link to={taskHref(current!)} className="today-card ss-panel ss-lift" aria-label={`${actionLabel}: ${meta}`}>{body}</Link>}
        </li>
      </ul>
      {failedRun === session.sessionId && <p className="today-summary" role="alert">{t('coding.run.failed')}</p>}
    </section>
  );
}

export default ChallengeRunSection;
