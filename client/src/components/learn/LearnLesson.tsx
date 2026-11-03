// Optional reading before Learn starts an attempt. Only the questions write progress.
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { learnLessonQuery } from './lessonQuery';
import { learnText } from '../../i18n/translations.learn';
import { useT } from '../../i18n/LanguageContext';
import { LessonView } from './LessonBody';
import { SwimCta } from '../landing/LandingKit';
import LoadingScreen from '../LoadingScreen';
import ErrorRetry from '../ErrorRetry';
import '../paths/LearningPaths.css';

// The route shell sets the page width (narrow, 800px); the article caps itself
// at 72ch. Back sits at the top-left at its own width and names where it goes
// (the caller passes the place: the topic's map, the Big O introduction). The
// one primary ends the article's column (UX audit learn-05), without an
// extra notice or a second action to skip the reading.
export function LearnLesson({ lessonId, backLabel, onStart, onBack }: { lessonId: string; backLabel: string; onStart: () => void; onBack: () => void }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  // The opener has usually started this read already (lessonQuery.ts).
  const query = useQuery(learnLessonQuery(lessonId));
  // The reading takes focus without the browser's own scroll and, only when
  // its top is out of sight, opens at its top under the site header, as the
  // level runner's screens do (LessonRunner openAtTop, UX audit learn-02).
  // focus() alone scrolled a reading taller than the window to its first line
  // and hid Back under the header whenever the lesson was already in as the
  // reader drew (#587 C19 follow-up: the press now asks for it).
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const clearance = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    if (element.getBoundingClientRect().top < clearance) element.scrollIntoView?.({ block: 'start' });
  }, [lessonId]);
  return (
    // The root takes focus by script so a screen reader starts at the lesson;
    // Tab never reaches it, so it draws no ring, as #main-content does not
    // (app-shell.css). A lesson opened straight from /big-o (?lesson=1, UX
    // audit learn-19) otherwise drew the browser's ring round the whole page.
    <div ref={root} tabIndex={-1} className="de-page lp-page" style={{ outline: 'none', scrollMarginTop: '6rem' }}>
      <Button
        className="lp-lesson-back"
        variant="ghost"
        icon={<span aria-hidden="true">←</span>}
        label={backLabel}
        onClick={onBack}
      />
      {query.data ? <LessonView lesson={query.data.lesson} headingLevel={1} />
        : query.isPending ? <LoadingScreen label={t('common.loading')} />
          : <ErrorRetry message={learnText('learn.lesson.error')} onRetry={() => void query.refetch()} />}
      <div className="lp-lesson-start">
        <SwimCta label={learnText('learn.lesson.startQuestions')} onClick={onStart} />
      </div>
    </div>
  );
}
