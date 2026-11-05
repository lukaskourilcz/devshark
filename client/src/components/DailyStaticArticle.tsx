// The static HTML body of /daily and /daily/<date> (#239), written by the
// build (vite.config.ts). It names the day and its track and holds no
// question: the question, its options and its answer come from the server
// when the page runs, so nothing of it sits in the HTML. Pure: no hooks.
import type { ReactNode } from 'react';
import type { TranslationKey } from '../i18n/translations';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * The page header of /daily, shared by the running page and the build's
 * static body so the swap does not move it (UX audit U2, questions-11): the
 * day as the kicker, the h1 and a one-sentence lead. The kicker line is drawn
 * even without a day, so the h1 sits at one y.
 */
export function DailyHeader({ t, track, dateLabel, date, context }: { t: Translate; track?: string; dateLabel?: string; date?: string; context?: ReactNode }) {
  return (
    <header className="ss-info-page__header">
      <span className="ss-info-page__kicker" aria-hidden={date && dateLabel ? undefined : true}>
        {date && dateLabel && <time dateTime={date}>{dateLabel}</time>}
      </span>
      <h1>{track ? t('daily.title', { track }) : t('daily.titlePlain')}</h1>
      {context && <div className="ss-daily__context">{context}</div>}
      <p className="ss-daily__practice">{t('daily.lead')}</p>
    </header>
  );
}

export function DailyStaticArticle({ t, track, dateLabel, date }: { t: Translate; track?: string; dateLabel?: string; date?: string }) {
  return (
    <article className="ss-info-page ss-daily">
      <DailyHeader t={t} track={track} dateLabel={dateLabel} date={date} />
      {/* The app replaces this page when it starts; until then, or without
          JavaScript, this line says where the question is. */}
      <p className="ss-daily__noscript">{t('daily.noScript')}</p>
    </article>
  );
}
