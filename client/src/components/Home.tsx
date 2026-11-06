import { learnTopicHref } from '../../../shared/learn-sections';
import { captureActivation } from '../lib/analytics';
// The landing page at "/" — the editorial "Deep End v2" redesign. Instead of a
// generic hero + three feature cards, it opens with a product-forward pitch: an
// interactive JavaScript sample question, a topic picker
// whose cards host schools of shark fins on hover, a live "Inside <Topic>"
// roadmap preview, the everything-else feature strip, the plan table and the
// pricing pledge. The accent comes from var(--brand-accent). The app shell
// (App.tsx) supplies the header and the ocean footer.
//
// See DESIGN_RULES.md for the fin baseline, wave-variation and accent rules
// this file is the reference implementation of.

import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SharkFin, Waterline } from './SharkFin';
import { CategoryGlyph } from './ui/techIcons';
import { TrophyIcon } from './ui/icons';
import { useLanguage, useT } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { useAuth } from '../lib/auth';
import { openSignIn } from '../lib/signInDialog';
import { useActiveSubject } from '../lib/subjects';
import { useReducedMotion } from '../lib/motion';
import { LANDING_TOPICS, type LandingTopic, type FinSpec } from '../lib/landingTopics';
import { Kicker, StatItem, FadeFinCta, SwimCta, SampleCard, PathStrip, CheckpointNode, pathWave, type StatSpec } from './landing/LandingKit';
import { CURRENT_PRODUCT } from '../lib/products';
import { SUBJECT_SCOPE_CATALOG } from '../../../shared/subject-catalog';
import { LaunchOfferBanner } from './LaunchOffer';
import ComparisonTable from './landing/ComparisonTable';
import { FDE_SECTION_VISIBLE } from '../../../shared/learn-section-ids';
import { FdePathFeature } from './landing/FdePathFeature';
import './landing/landingSections.css';

// ─────────────────────────────── Topic card ───────────────────────────────

function TopicIcon({ topic }: { topic: LandingTopic }) {
  return (
    <span className="ss-float" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <CategoryGlyph category={topic.id} color="var(--brand-accent)" size={30} />
    </span>
  );
}

function TopicCard({
  topic, selected, onSelect,
}: {
  topic: LandingTopic; selected: boolean; onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const t = useT();
  // Under reduced motion the school fades in where it rests instead of
  // swimming 140px across the card (the CTAs in LandingKit do the same).
  const reduce = useReducedMotion();
  const swim = hover && !reduce;
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`${t('nav.learn')} ${topic.name}`}
      aria-pressed={selected}
      className="ss-topic-card"
      style={{
        position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
        background: selected ? 'var(--brand-accent-soft)' : 'var(--ss-card-bg)',
        border: `1px solid ${selected ? 'var(--brand-accent)' : 'var(--ss-card-line)'}`,
        borderBottom: '2px solid var(--ss-card-edge)',
        boxShadow: hover
          ? `var(--shadow-med)${selected ? ', inset 0 0 0 1px var(--brand-accent)' : ''}`
          : selected ? 'inset 0 0 0 1px var(--brand-accent)' : 'var(--shadow-low)',
        borderRadius: 'var(--radius-container)', padding: '14px 16px 18px', cursor: 'pointer',
        transition: 'box-shadow 0.25s ease, background 0.2s ease, border-color 0.2s ease',
      }}
    >
      {/* Waterline that fades in near the card bottom on hover. */}
      <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 3, opacity: hover ? 0.85 : 0, transition: 'opacity 0.35s ease', pointerEvents: 'none' }}>
        <Waterline />
      </span>
      {/* The card's fin school gliding across the waterline. */}
      {topic.fins.map((f: FinSpec, i) => {
        // The V9 fin faces right: mirror it only when it travels left.
        const flip = f.dir;
        const rock = f.rock && swim ? ` rotate(${f.dir * -4}deg)` : '';
        return (
          <span
            key={i}
            aria-hidden
            style={{
              position: 'absolute', left: f.left, bottom: Math.round(5 - f.size * 0.25) + 'px', lineHeight: 0,
              opacity: hover ? 1 : 0,
              transform: `translateX(${swim ? f.dir * 140 : 0}px) scaleX(${flip})${rock}`,
              transition: reduce ? 'opacity 0.3s ease' : `transform ${f.dur}s ease-in-out ${f.delay}s, opacity 0.3s ease`,
              pointerEvents: 'none',
            }}
          >
            <SharkFin size={f.size} />
          </span>
        );
      })}
      <TopicIcon topic={topic} />
      <span style={{ fontFamily: 'var(--font-family-heading)', fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em', color: 'var(--color-text-primary)', minWidth: 0 }}>
        {topic.name}
      </span>
      {/* The tick sits on the selected card's accent tint, so it takes the
          derived on-tint accent rather than the plain one. */}
      <span aria-hidden className="ss-topic-card__tick" style={{ marginLeft: 'auto', fontSize: 'var(--ss-type-compact)', fontWeight: 700, color: 'var(--brand-accent-on-soft)', opacity: selected ? 1 : 0 }}>✓</span>
    </button>
  );
}

// ───────────────────────────── Roadmap preview ────────────────────────────

function RoadmapPreview({ topic, onStart }: { topic: LandingTopic; onStart: () => void }) {
  const t = useT();
  return (
    <section
      aria-label={t('home.insideTopic', { name: topic.name })}
      className="ss-panel ss-home-roadmap"
      style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 22, position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-page)' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', position: 'relative' }}>
        <h2 className="ss-section-title">
          {t('home.insideTopic', { name: topic.name })}
        </h2>
      </div>
      <p style={{ margin: 0, fontSize: 'var(--ss-type-compact)', color: 'var(--color-text-secondary)', maxWidth: '70ch', position: 'relative' }}>{topic.blurb}</p>
      <PathStrip label={t('home.pathRegion', { name: topic.name })}>
        {topic.levels.map((label, i) => {
          // Each connector gets its own swell (see DESIGN_RULES §4).
          const wavePath = pathWave(i);
          const first = i === 0;
          return (
            <div key={label} role="listitem" className="ss-home-path__step">
              <div className="ss-home-path__node">
                <span style={{
                  display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: '50%',
                  background: first ? 'var(--brand-accent)' : 'var(--brand-accent-soft)',
                  color: first ? 'var(--brand-on-accent)' : 'var(--brand-accent-on-soft)',
                  border: `2px solid ${first ? 'var(--brand-accent)' : 'transparent'}`,
                  fontFamily: 'var(--font-family-heading)', fontWeight: 800, fontSize: 'var(--ss-type-compact)',
                }}>{i + 1}</span>
                <span style={{ fontSize: 'var(--ss-type-label)', fontWeight: 600, color: 'var(--color-text-primary)', textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
              </div>
              <svg aria-hidden className="ss-home-path__connector" viewBox="0 0 40 8" preserveAspectRatio="none">
                <path d={wavePath} fill="none" stroke="var(--ss-ink)" strokeWidth={1.6} strokeLinecap="round" />
              </svg>
            </div>
          );
        })}
        <CheckpointNode label={t('home.checkpoint')} />
      </PathStrip>
      <div className="ss-home-path__actions">
        <SwimCta label={t('home.startLearning', { name: topic.name })} onClick={onStart} dir={-1} />
      </div>
    </section>
  );
}

// ─────────────────────────────── Feature strip ────────────────────────────

interface StripItem { titleKey: TranslationKey; textKey: TranslationKey; icon: ReactNode; to: string; }
const STRIP_ICON = (path: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

// ───────────────────────────────── Landing ────────────────────────────────

export default function Home() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const subject = useActiveSubject();
  const { isAuthenticated } = useAuth();
  const topicsRef = useRef<HTMLElement>(null);
  const topicsHeadingRef = useRef<HTMLHeadingElement>(null);

  const featured = LANDING_TOPICS[subject.id] ?? [];
  const [selectedId, setSelectedId] = useState<string>(featured[0]?.id ?? '');
  const selected = featured.find((x) => x.id === selectedId) ?? featured[0];

  const sample = featured.find((topic) => topic.id === 'javascript');

  const heroTitle = t('home.title');
  const heroSubtitle = t('home.subtitle');
  const moreCount = subject.topics.length - featured.length;

  // Public inventory counts from the subject registry, checked against the
  // server's deliverable question bank and active coding catalogue at release.
  // English digits whatever the browser's locale ("2,134", never "2.134").
  const stats: StatSpec[] = [
    { value: String(subject.topics.length), label: t('home.statTracks') },
    { value: SUBJECT_SCOPE_CATALOG[subject.id].questionCount.toLocaleString('en-GB'), label: t('home.statQuestions') },
    { value: SUBJECT_SCOPE_CATALOG[subject.id].codingChallengeCount.toLocaleString('en-GB'), label: t('home.statCodingChallenges') },
  ];


  // Scrolling alone left keyboard focus on the hero button, so the next Tab
  // went back to the hero links instead of the topics. Focus follows.
  const scrollToTopics = () => {
    topicsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    topicsHeadingRef.current?.focus({ preventScroll: true });
  };

  const strip: StripItem[] = [
    { titleKey: 'today.title', textKey: 'today.subtitle', to: '/today', icon: STRIP_ICON(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><path d="m9 16 2 2 4-4" /></>) },
    { titleKey: 'home.stripCareerTitle', textKey: 'home.stripCareerText', to: '/roadmap', icon: STRIP_ICON(<><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></>) },
    { titleKey: 'home.stripCodingTitle', textKey: 'home.stripCodingText', to: '/coding', icon: STRIP_ICON(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /><line x1="14" y1="4" x2="10" y2="20" /></>) },
    { titleKey: 'home.stripDailyTitle', textKey: 'home.stripDailyText', to: '/quiz?mode=daily', icon: STRIP_ICON(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />) },
    { titleKey: 'home.stripLiveTitle', textKey: 'home.stripLiveText', to: '/play', icon: STRIP_ICON(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>) },
    { titleKey: 'home.stripXpTitle', textKey: 'home.stripXpText', to: '/leaderboard', icon: <TrophyIcon size={20} /> },
  ];

  return (
    <div className="ss-pop ss-home" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 56 }}>
      {/* ── Hero ── */}
      <section aria-label={t('home.introAria')} className="ss-hero-grid">
        <div className="ss-hero-copy" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 20 }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-family-heading)', fontWeight: 800, fontSize: 'var(--ss-type-display)', lineHeight: 1.06, letterSpacing: '-0.02em' }}>
            {heroTitle}
          </h1>
          <p style={{ margin: 0, fontSize: '1.125rem', color: 'var(--color-text-secondary)', maxWidth: '46ch' }}>{heroSubtitle}</p>
          {/* One call to action; signing in (or going on) is a text link beside it. */}
          <div style={{ display: 'flex', gap: '8px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
            <FadeFinCta label={t('home.chooseTopic')} primary onClick={scrollToTopics} finLeft="-2px" finSize={58} accent={subject.accent} />
            <span className="ss-text-links" style={{ margin: 0 }}>
              {isAuthenticated ? (
                <Link to={learnTopicHref(selected?.id ?? '')}>{t('home.ctaLearn')}</Link>
              ) : (
                <button type="button" aria-haspopup="dialog" onClick={() => openSignIn()}>
                  {t('home.signIn')}
                </button>
              )}
            </span>
          </div>
          <div className="ss-hero-stats">
            {stats.map((s) => <StatItem key={s.label} {...s} />)}
          </div>
        </div>
        {sample && (
          <div className="ss-home-sample">
            <SampleCard
              showTeaser={false}
              chip={`${sample.name} · ${t('home.sampleChip', { level: sample.levels[0] })}`}
              question={sample.question}
              onAnswered={() => captureActivation('landing_sample_completed', { product: CURRENT_PRODUCT.id, source: 'home', category: sample.id })}
            />
          </div>
        )}
      </section>

      {/* ── Topic picker ── */}
      <section id="topics" ref={topicsRef} aria-label={t('home.topicsTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 20, scrollMarginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Kicker>{t('home.topicsKicker')}</Kicker>
          <h2 ref={topicsHeadingRef} tabIndex={-1} className="ss-section-title" style={{ marginTop: 6 }}>
            {t('home.topicsTitle')}
          </h2>
        </div>
        <div className="ss-topic-grid">
          {featured.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              selected={topic.id === selected?.id}
              onSelect={() => setSelectedId(topic.id)}
            />
          ))}
          {moreCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/learn')}
              aria-label={t('home.seeAllTopics')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', background: 'var(--color-background-muted)', border: '1px dashed var(--ss-card-edge)', borderRadius: 'var(--radius-container)', padding: '14px 16px', cursor: 'pointer' }}
            >
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: 'var(--font-family-heading)', fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em', color: 'var(--brand-accent)' }}>
                  {t('home.andMore', { n: String(moreCount) })}
                </span>
                <span style={{ fontSize: 'var(--ss-type-label)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('home.seeAllTopics')}</span>
              </span>
            </button>
          )}
        </div>
      </section>

      {/* ── Roadmap preview ── */}
      {selected && <RoadmapPreview topic={selected} onStart={() => { captureActivation('learning_cta_clicked', { product: CURRENT_PRODUCT.id, source: 'home', category: selected.id }); navigate(learnTopicHref(selected.id)); }} />}

      {FDE_SECTION_VISIBLE && <FdePathFeature />}

      {/* ── Everything-else feature strip (no hover) ── */}
      <section aria-label={t('home.moreKicker')} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Kicker>{t('home.moreKicker')}</Kicker>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '12px 28px' }}>
          {strip.map((item) => (
            <button
              key={item.titleKey}
              type="button"
              className="ss-strip-tile"
              onClick={() => navigate(item.to)}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
            >
              <span aria-hidden style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 'var(--radius-inner)', color: 'var(--color-text-secondary)', background: 'var(--color-background-muted)', boxShadow: 'inset 0 0 0 1px var(--ss-card-line)', flexShrink: 0 }}>
                {item.icon}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: 'var(--font-family-heading)', fontWeight: 700, fontSize: 'var(--ss-type-compact)', color: 'var(--color-text-primary)' }}>{t(item.titleKey)}</span>
                <span style={{ fontSize: 'var(--ss-type-compact)', color: 'var(--color-text-secondary)' }}>{t(item.textKey)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Free and Premium plan table. Its footnote says what Premium pays
          for; its CTA opens Learn. ── */}
      <ComparisonTable showOfferNote={false} afterTable={<LaunchOfferBanner />} />

    </div>
  );
}
