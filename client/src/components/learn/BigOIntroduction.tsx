// /learn/big-o: the first two reviewed DSA lessons, open before placement
// (isBigOIntroduction in shared/tiers.ts), through the same lesson read and
// level runner as the Learn map.
//
// It lives apart from the map (Roadmap.tsx) so its route can load this page
// without the map's chunk (perf baseline #587 C17): the page is the Learn
// header and two buttons, and the reader and the runner load when a lesson
// is reached for (lessonParts.tsx).
// The reader and the runner draw with the map's styles (`de-page`, the
// result's `rm-*` classes), which the map's chunk used to bring along; first,
// so the page's own styles still come after them, as they did then.
import '../Roadmap.css';
import '../DeepEndScreens.css';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../lib/auth';
import { friendlyError } from '../../lib/api';
import { fetchRoadmapLevel, getRoadmapProgress, recordLevelResult } from '../../lib/roadmap';
import { announceLearnRepeat, awardLearningOutcome } from '../../lib/xp';
import { computeLearningXp } from '../../lib/leveling';
import { getCategoryHexColor } from '../../lib/categories';
import { BigOLessons } from './BigOLessons';
import { DelayedQuoteLoader, revealWhenReady } from './LevelLoader';
import { prefetchLearnLesson } from './lessonQuery';
import { LessonError, LessonReader, LessonRunner, LessonStage, loadLessonRunner, preloadLessonReader, preloadLessonRunner } from './lessonParts';

const savesData = (): boolean => (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
/** A lesson's reading and its runner start loading when the learner reaches
 * for a lesson: a mouse resting on its button, keyboard focus or a press (a
 * visitor who asked the browser to save data, on the press only). */
function warmOnIntent(event: { type: string; target: EventTarget | null; nativeEvent: Event }): void {
  if (!(event.target instanceof Element) || !event.target.closest('button')) return;
  const press = event.type === 'pointerdown' || event.type === 'touchstart';
  if (event.type === 'pointerover' && (event.nativeEvent as PointerEvent).pointerType !== 'mouse') return;
  if (!press && savesData()) return;
  preloadLessonReader();
  preloadLessonRunner();
}

/** The same reviewed DSA lessons, with an entry point open before placement. */
export function BigOIntroduction({ onActiveChange }: { onActiveChange?: (active: boolean) => void } = {}) {
  const { t } = useLanguage();
  const { isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();
  // /big-o's "Start lesson 1" opens a lesson directly (?lesson=1, UX audit
  // learn-19): the lesson's reading is the first screen, and the parameter is
  // dropped so Back and a reload land on the introduction.
  const location = useLocation();
  const navigate = useNavigate();
  const asked = new URLSearchParams(location.search).get('lesson');
  const [level, setLevel] = useState<1 | 2 | null>(() => (asked === '1' ? 1 : asked === '2' ? 2 : null));
  const [generation, setGeneration] = useState(0);
  const [reading, setReading] = useState(true);
  // When the questions were asked for: the level's loader and the runner's
  // code loader after it are one wait (learn/LevelLoader.tsx).
  const [since, setSince] = useState(0);
  const startQuestions = () => {
    setSince(Date.now());
    setGeneration((value) => value + 1);
    setReading(false);
  };
  const before = useRef(0);
  useEffect(() => {
    if (asked === null) return;
    if (level !== null) {
      preloadLessonReader();
      prefetchLearnLesson(queryClient, `dsa-v1-d01-l${level}`);
      preloadLessonRunner();
      before.current = computeLearningXp(getRoadmapProgress());
    }
    navigate({ pathname: location.pathname, hash: location.hash }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival
  const lesson = useQuery({
    queryKey: ['big-o-introduction', level, generation, user?.id ?? null],
    enabled: level !== null && !reading,
    // As on the map (Roadmap.tsx open()): the questions open once the
    // runner's code is in too, and an answer that came after the loader
    // showed keeps it up LOADER_MIN_SHOWN_MS, so it never flickers (#587 C05).
    queryFn: async ({ signal }) => {
      const runner = loadLessonRunner().then(() => undefined, () => undefined);
      const data = await fetchRoadmapLevel('dsa', level!, signal);
      await runner;
      await revealWhenReady(since);
      return data;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const open = (next: 1 | 2) => {
    preloadLessonReader();
    // The lesson is asked for with the press, beside the reader's code.
    prefetchLearnLesson(queryClient, `dsa-v1-d01-l${next}`);
    preloadLessonRunner();
    before.current = computeLearningXp(getRoadmapProgress());
    setReading(true);
    setLevel(next);
  };
  if (level !== null) {
    if (reading) return <LessonReader lessonId={`dsa-v1-d01-l${level}`} backLabel={t('bigO.pathTitle')} onStart={startQuestions} onBack={() => setLevel(null)} />;
    if (lesson.isPending) return <DelayedQuoteLoader since={since} quote={t('quiz.loadingQuote')} label={t('common.loading')} />;
    if (lesson.error || !lesson.data) return <LessonError message={friendlyError(lesson.error)} onRetry={startQuestions} onExit={() => setLevel(null)} t={t} />;
    return <LessonStage since={since} onExit={() => setLevel(null)} t={t}><LessonRunner key={`${level}-${generation}-${user?.id ?? 'guest'}`} playable={lesson.data} skipIntro
      topicColor={getCategoryHexColor('dsa')} hasNext={level === 1} nextLabel={t('roadmap.nextLevel')}
      onExit={() => setLevel(null)} onNext={() => open(2)} onReplay={() => open(level)} onActiveChange={onActiveChange} t={t}
      onFinished={(pct, repeatXp) => {
        recordLevelResult('dsa', level, pct, lesson.data!.passPct);
        awardLearningOutcome(computeLearningXp(getRoadmapProgress()) - before.current, isAuthenticated);
        if (isAuthenticated && repeatXp) void announceLearnRepeat(repeatXp);
      }} /></LessonStage>;
  }
  // The route shell sets the width. The Learn header, then lesson 1 as the one
  // SwimCta md and lesson 2 a secondary, both 44px (UX audit learn-04, -15, -19).
  return (
    <div style={{ display: 'contents' }} onPointerOver={warmOnIntent} onFocus={warmOnIntent} onPointerDown={warmOnIntent} onTouchStart={warmOnIntent}>
      <BigOLessons onOpen={open} />
    </div>
  );
}
