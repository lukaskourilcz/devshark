// devShark typing racer — a fully client-side touch-typing drill. The learner
// reproduces a short, real code snippet; a shark (the shared <WaterlineProgress>
// fin) races along a waterline as they go. Accuracy is the gate — you must
// reproduce the snippet exactly, and keep accuracy at/above the threshold, to
// score — while raw speed (WPM) earns one to three stars. Best WPM is kept
// privately on-device; there are no network calls and no leaderboard.
//
// Deep End v2: ocean-ink tokens, the shared fin/waterline racer, restrained
// motion (the racer respects prefers-reduced-motion via WaterlineProgress), a
// real focusable input for mobile keyboards, and every string via t().

import { type ChangeEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Kicker } from './landing/LandingKit';
import { useT } from '../i18n/LanguageContext';
import { WaterlineProgress, SwimmingShark } from './SharkFin';
import { readJSON, writeJSON } from '../lib/storage';
import { createStore, useStore } from '../lib/store';
import { FlagIcon } from './ui/icons';
import './TypingRacer.css';
import BrandCase from './BrandCase';
import { visuallyHidden } from '../theme/MuiTheme';

const GATE = 95; // accuracy % required to score (the gate)
const STAR_T2 = 35; // WPM that earns a 2nd star
const STAR_T3 = 55; // WPM that earns a 3rd star
const BEST_KEY = 'devshark:typing:v1';

interface TypingStats {
  bestWpm: number;
}
const DEFAULT_STATS: TypingStats = { bestWpm: 0 };

// The best is the account's (lib/accountData.ts clears it at sign-out), so it
// lives in a store the sign-out refreshes: read once at mount, the leaving
// account's best stayed on screen and decided the next "New personal best".
// A copy of another shape counts as none: a best that was not a number never
// let a race beat it, so no best was recorded again.
function readBest(): TypingStats {
  const raw = readJSON<unknown>(BEST_KEY, null);
  const wpm = raw && typeof raw === 'object' ? (raw as { bestWpm?: unknown }).bestWpm : undefined;
  return typeof wpm === 'number' && Number.isFinite(wpm) && wpm > 0 ? { bestWpm: Math.round(wpm) } : DEFAULT_STATS;
}
const bestStore = createStore<TypingStats>(readBest);

// Short, real, single-line dev snippets across a handful of languages. Kept
// inline on purpose — this surface needs no server and no content pipeline.
const SNIPPETS: readonly string[] = [
  'const sum = (a, b) => a + b;',
  "import { useState } from 'react';",
  'arr.filter((n) => n > 0);',
  'const [open, setOpen] = useState(false);',
  'SELECT id FROM users WHERE age >= 18;',
  'export default function App() {}',
  'type User = { id: number; name: string };',
  '.btn:hover { color: teal; }',
  "print('hello, world')",
  'git switch -c feature/login',
];

type Phase = 'ready' | 'running' | 'finished';
interface RaceResult {
  wpm: number;
  accuracy: number;
  passed: boolean;
  stars: number;
  isBest: boolean;
}

/** A reward star. Decorative — the WPM/accuracy text carries the real result. */
function Star({ on }: { on: boolean }) {
  return (
    <svg
      className={on ? 'ss-typing__star--on' : 'ss-typing__star--off'}
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill={on ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/** Small warning glyph for the "clean it up to score" line (non-colour cue). */
function AlertGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Check glyph for the passing result line. */
function CheckGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const pickIndex = (exclude?: number): number => {
  if (SNIPPETS.length <= 1) return 0;
  let i = Math.floor(Math.random() * SNIPPETS.length);
  if (exclude != null) while (i === exclude) i = Math.floor(Math.random() * SNIPPETS.length);
  return i;
};

export default function TypingRacer() {
  const t = useT();
  const guideId = useId();

  const [snippetIndex, setSnippetIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [typed, setTyped] = useState('');
  const [errors, setErrors] = useState(0);
  const [keystrokes, setKeystrokes] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const best = useStore(bestStore);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);

  // Pick the first snippet on mount — a genuine (if brief) loading beat.
  useEffect(() => {
    setSnippetIndex(pickIndex());
  }, []);

  const snippet = snippetIndex != null ? SNIPPETS[snippetIndex] : '';

  // On finish, move focus off the (now read-only) field to the primary next
  // action — which also dismisses the mobile keyboard.
  useEffect(() => {
    if (phase === 'finished') retryRef.current?.focus();
  }, [phase]);

  const resetCounters = useCallback(() => {
    setTyped('');
    setErrors(0);
    setKeystrokes(0);
    setStartedAt(null);
    setResult(null);
  }, []);

  // Focusing synchronously inside the click keeps mobile keyboards opening (a
  // deferred/programmatic focus does not on iOS). The clock starts on the first
  // keystroke, so "Start" just brings the field up; the input stays focusable
  // (read-only when finished) so re-focus always works.
  const start = () => inputRef.current?.focus();
  const restart = () => {
    resetCounters();
    setPhase('ready');
    inputRef.current?.focus();
  };
  const raceAgain = () => {
    setSnippetIndex(pickIndex(snippetIndex ?? undefined));
    resetCounters();
    setPhase('ready');
    inputRef.current?.focus();
  };

  const finish = useCallback(
    (finalKeystrokes: number, finalErrors: number, startTs: number | null) => {
      const elapsedMs = startTs != null ? Date.now() - startTs : 0;
      const minutes = elapsedMs / 60000;
      const wpm = minutes > 0 ? Math.round(snippet.length / 5 / minutes) : 0;
      const accuracy = finalKeystrokes > 0 ? Math.round((100 * (finalKeystrokes - finalErrors)) / finalKeystrokes) : 100;
      const passed = accuracy >= GATE;
      const stars = passed ? 1 + (wpm >= STAR_T2 ? 1 : 0) + (wpm >= STAR_T3 ? 1 : 0) : 0;
      const isBest = passed && wpm > best.bestWpm;
      if (isBest) {
        const nextStats: TypingStats = { bestWpm: wpm };
        writeJSON(BEST_KEY, nextStats);
        bestStore.emit();
      }
      setResult({ wpm, accuracy, passed, stars, isBest });
      setPhase('finished');
    },
    [snippet, best.bestWpm],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (phase === 'finished' || !snippet) return;
    const next = e.target.value.slice(0, snippet.length);
    let addKeys = 0;
    let addErrors = 0;
    if (next.length > typed.length) {
      for (let i = typed.length; i < next.length; i++) {
        addKeys += 1;
        if (next[i] !== snippet[i]) addErrors += 1;
      }
    }
    // First keystroke starts the clock and flips ready → running.
    const firstKey = startedAt == null && next.length > 0;
    const startTs = startedAt ?? (firstKey ? Date.now() : null);
    if (firstKey) {
      setStartedAt(startTs);
      if (phase === 'ready') setPhase('running');
    }
    const nextKeystrokes = keystrokes + addKeys;
    const nextErrors = errors + addErrors;
    if (addKeys) {
      setKeystrokes(nextKeystrokes);
      setErrors(nextErrors);
    }
    setTyped(next);
    if (next === snippet) finish(nextKeystrokes, nextErrors, startTs);
  };

  const total = snippet.length;
  const progressPct = total > 0 ? Math.round((typed.length / total) * 100) : 0;
  const liveAccuracy = keystrokes > 0 ? Math.round((100 * (keystrokes - errors)) / keystrokes) : 100;

  const header = (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Kicker><BrandCase text={t('typing.kicker')} /></Kicker>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-family-heading)', fontWeight: 800, fontSize: 'clamp(1.9rem, 4vw, 2.4rem)', letterSpacing: '-0.02em' }}>
        {t('typing.title')}
      </h1>
      <p style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-secondary)', maxWidth: '60ch' }}>{t('typing.subtitle')}</p>
    </header>
  );

  // Loading beat before the first snippet is chosen.
  if (snippetIndex == null) {
    return (
      <div className="ss-typing ss-pop">
        {header}
        <div className="ss-typing__fallback">
          <SwimmingShark />
          <p style={{ margin: 0 }}>{t('typing.loading')}</p>
        </div>
      </div>
    );
  }

  // Defensive empty/error state (no snippets available).
  if (!snippet) {
    return (
      <div className="ss-typing ss-pop">
        {header}
        <div className="ss-typing__fallback">
          <p style={{ margin: 0 }}>{t('typing.error')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ss-typing ss-pop" data-activity={phase === 'running' ? 'active' : undefined}>
      {header}

      {/* Snippet with live per-character state. Readable by assistive tech, so
          it doubles as the input's description. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
          {t('typing.snippetLabel')}
        </span>
        <div className="ss-typing__guide" id={guideId}>
          {snippet.split('').map((ch, i) => {
            let state: 'done' | 'error' | 'current' | 'pending';
            if (i < typed.length) state = typed[i] === ch ? 'done' : 'error';
            else if (i === typed.length && phase !== 'finished') state = 'current';
            else state = 'pending';
            return (
              <span key={i} className={`ss-typing__ch--${state}`}>
                {ch}
              </span>
            );
          })}
        </div>
        <input
          ref={inputRef}
          className="ss-typing__input"
          type="text"
          inputMode="text"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          aria-label={t('typing.snippetLabel')}
          aria-describedby={guideId}
          value={typed}
          readOnly={phase === 'finished'}
          placeholder={phase !== 'finished' ? t('typing.go') : undefined}
          onChange={onChange}
          onPaste={(e) => e.preventDefault()}
        />
      </div>

      {/* Live stats (progress lives on the race header below). */}
      <div className="ss-typing__stats">
        <span className="ss-typing__stat">
          <b>{t('typing.accuracy', { pct: liveAccuracy })}</b>
        </span>
        <span className="ss-typing__stat">{t('typing.errors', { n: errors })}</span>
        <span
          className={`ss-typing__badge${phase === 'finished' && result && !result.passed ? ' ss-typing__badge--fail' : ''}`}
          title={t('typing.accuracyGate', { pct: GATE })}
        >
          {t('typing.gateBadge')} · {GATE}%
        </span>
      </div>

      {/* The race track: a waterline the shark fin swims along. */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
            {t('typing.race')}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {t('typing.progress', { done: typed.length, total })}
          </span>
        </div>
        <div className="ss-typing__track">
          <span className="ss-typing__flag" aria-hidden>
            <FlagIcon size={18} />
          </span>
          <WaterlineProgress value={progressPct} label={t('typing.trackAria')} />
        </div>
      </div>

      {/* Ready helper. */}
      {phase === 'ready' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-family-heading)', fontWeight: 700, fontSize: '1.05rem' }}>{t('typing.ready')}</span>
          <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{t('typing.readyBody')}</span>
          {best.bestWpm > 0 && <span className="ss-typing__best">{t('typing.best', { wpm: best.bestWpm })}</span>}
        </div>
      )}

      {/* The outcome, read out from a status that is always on the page: the
          result card below was the status, and one drawn together with its
          words is not read. Focus goes to Race again, which says nothing of
          the race. */}
      <span role="status" style={visuallyHidden}>
        {phase === 'finished' && result
          ? [
              t('typing.finished'),
              result.passed ? t('typing.result', { wpm: result.wpm, pct: result.accuracy }) : t('typing.accuracyGateFail', { pct: GATE }),
              result.isBest ? t('typing.newBest') : '',
            ].filter(Boolean).join('. ')
          : ''}
      </span>

      {phase === 'finished' && result && (
        <div className="ss-typing__result ss-pop">
          <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
            {t('typing.finished')}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span className="ss-typing__wpm">{result.wpm}</span>
            <span style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>{t('typing.wpmLabel')}</span>
            <span className="ss-typing__stars" aria-hidden>
              {[0, 1, 2].map((i) => (
                <Star key={i} on={i < result.stars} />
              ))}
            </span>
          </div>
          <span className={`ss-typing__resultline ss-typing__resultline--${result.passed ? 'pass' : 'fail'}`}>
            {result.passed ? <CheckGlyph /> : <AlertGlyph />}
            {result.passed ? t('typing.result', { wpm: result.wpm, pct: result.accuracy }) : t('typing.accuracyGateFail', { pct: GATE })}
          </span>
          {result.isBest && (
            <span className="ss-typing__newbest">
              <Star on />
              {t('typing.newBest')}
            </span>
          )}
          {best.bestWpm > 0 && <span className="ss-typing__best">{t('typing.best', { wpm: best.bestWpm })}</span>}
        </div>
      )}

      {/* Actions — one clear primary per phase, all ≥44px. */}
      <div className="ss-typing__actions">
        {phase === 'ready' && (
          <button type="button" className="ss-typing__btn" onClick={start}>
            {t('typing.start')}
          </button>
        )}
        {phase === 'running' && (
          <button type="button" className="ss-typing__btn ss-typing__btn--secondary" onClick={restart}>
            {t('typing.restart')}
          </button>
        )}
        {phase === 'finished' && (
          <button ref={retryRef} type="button" className="ss-typing__btn" onClick={raceAgain}>
            {t('typing.retry')}
          </button>
        )}
      </div>
    </div>
  );
}
