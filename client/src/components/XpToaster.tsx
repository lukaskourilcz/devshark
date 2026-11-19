import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Text } from '@astryxdesign/core/Text';
import { clockTime, onXpToast, type XpHold, type XpToast } from '../lib/xp';
import { useT } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { useIsMobile } from '../lib/useMediaQuery';
import { BoltIcon, ClockIcon, TrophyIcon } from './ui/icons';
import { ToastMotion } from './ui/ToastMotion';

// A global, self-contained listener for XP events. Mounted once at the app root
// so XP gains and rank-ups toast from anywhere (quiz results, the learning path,
// etc.). Events are queued so a burst (e.g. a gain immediately followed by a
// rank-up) shows one after another instead of clobbering each other.

const GAIN_MS = 2200;
const RANKUP_MS = 4800;
// A sentence with a time in it, read rather than glanced at.
const HELD_MS = 6000;

type GainSource = Extract<XpToast, { kind: 'gain' }>['source'];
const GAIN_KEY: Record<GainSource, TranslationKey> = {
  learn: 'xp.gainLearn',
  quiz: 'xp.gainQuiz',
  practice: 'xp.gainPractice',
  coding: 'xp.gainQuiz',
  again: 'xp.gainAgain',
};

/** What the hour held back, and when it opens again, in the learner's own
 * clock time (migration 060). */
function heldMessage(t: ReturnType<typeof useT>, hold: XpHold): string {
  const { on, availableAt } = hold;
  const key = on === 'questions'
    ? hold.count === 1 ? 'xp.heldAnswer' : 'xp.heldAnswers'
    : on === 'task'
      ? availableAt ? 'xp.heldTask' : 'xp.heldTaskReset'
      : 'xp.heldStep';
  return t(key, {
    n: on === 'questions' ? hold.count : 0,
    time: availableAt ? clockTime(availableAt) : '',
  });
}

export default function XpToaster() {
  const t = useT();
  const isMobile = useIsMobile();
  const [queue, setQueue] = useState<XpToast[]>([]);
  const [current, setCurrent] = useState<XpToast | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => onXpToast((toast) => setQueue((q) => [...q, toast])), []);

  // Pull the next toast when nothing is showing.
  useEffect(() => {
    if (!current && queue.length > 0) {
      setCurrent(queue[0]);
      setQueue((q) => q.slice(1));
      setOpen(true);
    }
  }, [queue, current]);

  // Auto-hide, then let the exit transition run before clearing `current`.
  useEffect(() => {
    if (!open || !current) return;
    const ms = current.kind === 'rankup' ? RANKUP_MS : current.kind === 'held' ? HELD_MS : GAIN_MS;
    const id = window.setTimeout(() => setOpen(false), ms);
    return () => window.clearTimeout(id);
  }, [open, current]);

  // After the exit transition, clear `current` so the next item can show.
  const handleExited = () => setCurrent(null);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        // Above the cookie banner while it shows (CookieConsent.tsx).
        bottom: `calc(${isMobile ? 32 : 40}px + var(--ss-consent-dock, 0px))`,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 1400,
        padding: '0 16px',
      }}
    >
      <div role={current && open ? 'status' : undefined} aria-live="polite">
        {current && (
          <ToastMotion
            open={open}
            kind="xp"
            onExited={handleExited}
            style={{ pointerEvents: 'auto' }}
          >
            {current.kind === 'rankup' ? (
              <div
                className="rm-celebrate"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
                  borderRadius: 'var(--radius-element)',
                  color: '#3a2c00', fontWeight: 700,
                  background: '#fbc94a',
                  boxShadow: 'var(--shadow-med)',
                }}
              >
                <span style={{ display: 'inline-flex' }} aria-hidden>
                  <TrophyIcon size={22} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 800, fontSize: '0.7rem', letterSpacing: 1, textTransform: 'uppercase', opacity: 0.8 }}>
                    {t('xp.rankUpKicker')}
                  </span>
                  <Text as="div" color="inherit" weight="bold">
                    {t('xp.rankUp', { title: t(current.titleKey, current.titleVars) })}
                  </Text>
                </div>
              </div>
            ) : current.kind === 'held' ? (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', maxWidth: 'min(92vw, 460px)',
                  borderRadius: 'var(--radius-element)', fontWeight: 700,
                  color: 'var(--color-text-primary)', background: 'var(--color-background-surface)',
                  border: '1px solid var(--color-border)', borderLeft: '4px solid var(--ss-info)',
                  boxShadow: 'var(--shadow-med)',
                }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ss-info)' }} aria-hidden>
                  <ClockIcon size={18} />
                </span>
                <Text as="span" color="inherit" weight="bold">
                  {heldMessage(t, current.hold)}
                </Text>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 999,
                  color: 'var(--ss-on-success-strong)', fontWeight: 700,
                  background: 'var(--ss-success-strong)',
                  boxShadow: 'var(--shadow-med)',
                }}
              >
                <span style={{ display: 'inline-flex' }} aria-hidden>
                  <BoltIcon size={16} />
                </span>
                <Text as="span" color="inherit" weight="bold">
                  {t(GAIN_KEY[current.source], { xp: current.amount })}
                </Text>
              </div>
            )}
          </ToastMotion>
        )}
      </div>
    </div>,
    document.body,
  );
}
