// /daily and /daily/:date: the public question of the day (#239).
//
// One question a day, from a track that rotates by date
// (shared/daily-question.ts). The server picks the question and keeps its
// answer sealed in the session until the learner checks one; the check is
// practice and records nothing for anyone. Each day has its own URL and its
// own share image, so a post that links to a day keeps its preview.
//
//   loading            the heading (the track is known from the date) and a
//                      skeleton with a status line
//   not yet / no day   a future date or one before the first question: a line
//                      and a link to today's question
//   expired            the sealed session is over an hour old: load it again
//   offline / failed   an alert with Try again
//   ready              the question, its options and Check answer
//   checked            correct or not in words and colour, the right option
//                      marked, the explanation, practice more and share
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { useT } from '../i18n/LanguageContext';
import { categoryLabelKey } from '../lib/categories';
import { checkDailyAnswer, dailyQuestionQuery, qotdProblem, type QotdProblem, type QotdResult } from '../lib/dailyQuestion';
import { CURRENT_PRODUCT } from '../lib/products';
import { useUtcDay } from '../lib/utcDay';
import { captureShare, canWebShare, copyText, shareLink } from '../lib/share';
import { isIsoDate, qotdAvailability, qotdPath, qotdTrack, utcToday, type QotdResponse } from '../../../shared/daily-question';
import type { CategoryType } from '../types/quiz';
import { renderQuestion } from './CodeBlock';
import { CategoryTag } from './ui/CategoryTag';
import { AnswerOptionList, QuestionActions, QuestionFeedback, QuestionShell } from './question';
import { questionText } from '../i18n/translations.question';
import { SaveSharkCard } from './SaveSharkCard';
import { Breadcrumb } from './ui/Breadcrumb';
import { topicContext } from '../i18n/translations.topicContext';
import { DailyHeader } from './DailyStaticArticle';
import './DailyQuestion.css';

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

type ShareStatus = 'idle' | 'shared' | 'copied' | 'failed';

export default function DailyQuestionPage() {
  const t = useT();
  const { date: dateParam } = useParams<{ date?: string }>();
  const today = useUtcDay(utcToday);
  const date = dateParam ?? today;
  const valid = isIsoDate(date);
  const availability = valid ? qotdAvailability(date, today) : 'before-start';
  const query = useQuery({ ...dailyQuestionQuery(date), enabled: valid && availability === 'open' });
  // "Load it again" after a claimed or expired session starts the question
  // over once the fresh session is here. Counted rather than left to the
  // session id, so the expired banner cannot outlive a reload.
  const [reloads, setReloads] = useState(0);
  const reload = async () => {
    await query.refetch();
    setReloads((count) => count + 1);
  };

  const shownDate = query.data?.date ?? date;
  const track = query.data?.track ?? (valid ? qotdTrack(date) : null);
  const trackName = track ? t(categoryLabelKey(track)) : '';

  return (
    <article className="ss-info-page ss-daily" aria-busy={query.isFetching || undefined}>
      <Breadcrumb items={[{ label: t('nav.today'), href: '/today' }, { label: t('daily.titlePlain') }]} />
      <DailyHeader context={query.data ? <><p>{topicContext[query.data.question.category] ?? topicContext[query.data.track]}</p>{query.data.question.introduction?.trim() && <div>{renderQuestion(query.data.question.introduction)}</div>}</> : undefined} t={t} track={track ? trackName : undefined} date={valid ? shownDate : undefined} dateLabel={valid ? longDate(shownDate) : undefined} />

      {availability !== 'open' ? (
        <Unavailable problem={availability === 'not-yet' ? 'not-yet' : 'before-start'} date={valid ? date : null} />
      ) : query.isPending ? (
        <section className="ss-info-card ss-daily__card" aria-label={t('daily.loading')}>
          <span role="status" className="ss-daily__sr">{t('daily.loading')}</span>
          <Skeleton width={120} height={22} radius={2} />
          <Skeleton width="100%" height={18} radius={2} />
          <Skeleton width="80%" height={18} radius={2} />
          {[0, 1, 2, 3].map((one) => <Skeleton key={one} width="100%" height={48} radius={2} />)}
        </section>
      ) : query.isError ? (
        <Unavailable problem={qotdProblem(query.error)} date={date} onRetry={() => void query.refetch()} />
      ) : (
        <DailyQuestion key={`${query.data.sessionId}:${reloads}`} data={query.data} onReload={() => void reload()} focusQuestion={reloads > 0} />
      )}


    </article>
  );
}

function Unavailable({ problem, date, onRetry, focus = false }: { problem: QotdProblem; date: string | null; onRetry?: () => void; focus?: boolean }) {
  const t = useT();
  // Shown in place of a check whose session was over, it takes the focus the
  // Check answer button had.
  const boxRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focus) boxRef.current?.focus();
  }, [focus]);
  const toToday = <Button variant="secondary" as={Link} href={qotdPath()} label={t('daily.toToday')} />;
  switch (problem) {
    case 'not-yet':
      return (
        <section className="ss-info-card ss-daily__card">
          <p>{t('daily.notYet', { date: date ? longDate(date) : '' })}</p>
          <div className="ss-info-actions">{toToday}</div>
        </section>
      );
    case 'before-start':
      return (
        <section className="ss-info-card ss-daily__card">
          <p>{t('daily.noQuestion')}</p>
          <div className="ss-info-actions">{toToday}</div>
        </section>
      );
    case 'expired':
      return (
        <section className="ss-info-card ss-daily__card" ref={boxRef} tabIndex={focus ? -1 : undefined}>
          <Banner status="info" title={t('daily.expired')} />
          <div className="ss-info-actions"><Button variant="primary" label={t('daily.reload')} onClick={onRetry} /></div>
        </section>
      );
    default:
      return (
        <section className="ss-info-card ss-daily__card">
          <div role="alert">
            <Banner status="error" title={t(problem === 'offline' ? 'daily.offline' : 'daily.failed')} />
          </div>
          <div className="ss-info-actions"><Button variant="primary" label={t('quiz.retry')} onClick={onRetry} /></div>
        </section>
      );
  }
}

function DailyQuestion({ data, onReload, focusQuestion }: { data: QotdResponse; onReload: () => void; focusQuestion: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const questionId = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<QotdResult | null>(null);
  const [problem, setProblem] = useState<QotdProblem | null>(null);
  const [share, setShare] = useState<ShareStatus>('idle');
  const { question, track, date } = data;
  const trackName = t(categoryLabelKey(track));
  const url = useMemo(() => `${window.location.origin}${qotdPath(date)}`, [date]);
  // Loaded again after an expired session, the question takes the focus the
  // Load it again button had.
  const questionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusQuestion) questionRef.current?.focus();
  }, [focusQuestion]);

  const check = async () => {
    if (selected === null || checking || result) return;
    setChecking(true);
    setProblem(null);
    try {
      setResult(await checkDailyAnswer(data.sessionId, question.id, selected));
    } catch (error) {
      setProblem(qotdProblem(error));
    } finally {
      setChecking(false);
    }
  };

  const onShare = async () => {
    const text = t('daily.shareText', { track: trackName });
    if (canWebShare()) {
      captureShare('daily_question', 'daily', 'share');
      const outcome = await shareLink({ title: CURRENT_PRODUCT.brand, text, url });
      if (outcome !== 'cancelled') setShare(outcome);
      return;
    }
    captureShare('daily_question', 'daily', 'copy');
    setShare((await copyText(url)) ? 'copied' : 'failed');
  };

  if (problem === 'expired') return <Unavailable problem="expired" date={date} onRetry={onReload} focus />;

  return (
    // The shared question parts (UX audit U2, questions-01): the 640px shell,
    // the one answer list with the right answer and a wrong pick marked in
    // words, the verdict under it, and the one action row.
    <QuestionShell
      ref={questionRef}
      questionId={questionId}
      labelledBy={questionId}
      stable={false}
      focusable={focusQuestion}
      header={
        <div className="ss-daily__meta">
          <CategoryTag category={question.category as CategoryType} />
          <Badge variant="neutral" label={questionText('question.difficultyLevel', { level: question.difficulty })} />
        </div>
      }
      question={renderQuestion(question.question)}
      actions={
        result ? (
          <>
            <QuestionActions
              secondary={<Button variant="secondary" label={t('daily.share')} onClick={() => void onShare()} />}
              primary={{ label: t('daily.practice', { track: trackName }), onClick: () => navigate(`/quiz?category=${encodeURIComponent(track)}`) }}
            />
            {/* Takes no space until it has something to say (questions-11):
                empty, it kept a 1.4em line and two gaps under the actions. */}
            <p className="ss-daily__status" role="status">
              {share === 'shared' ? t('daily.shared') : share === 'copied' ? t('daily.copied') : share === 'failed' ? t('daily.copyFailed', { url }) : ''}
            </p>
          </>
        ) : (
          <QuestionActions
            primary={{ label: t('daily.check'), onClick: () => void check(), disabled: selected === null || checking }}
          />
        )
      }
    >
      <AnswerOptionList
        options={question.options}
        value={selected}
        onChange={(index) => { if (!result) setSelected(index); }}
        labelledBy={questionId}
        disabled={!!result || checking}
        grade={result ? { correct: result.correctAnswer, picked: result.selectedIndex } : null}
      />

      {problem && (
        <div role="alert">
          <Banner status="error" title={t(problem === 'offline' ? 'daily.offline' : 'daily.checkFailed')} />
        </div>
      )}

      {result && (
        // Takes the focus: Check answer leaves with the check, so focus fell
        // to the page, and a live region drawn with its content is not read.
        <QuestionFeedback
          status={result.isCorrect ? 'success' : 'error'}
          title={result.isCorrect ? t('daily.right') : t('daily.wrong')}
          description={result.explanation || undefined}
        >
          {/* Shark Cards (owner decision 12): signed in, the question can be
              kept with the answer and explanation checked here. */}
          <SaveSharkCard question={question} correctIndex={result.correctAnswer} explanation={result.explanation ?? ''} />
        </QuestionFeedback>
      )}
    </QuestionShell>
  );
}
