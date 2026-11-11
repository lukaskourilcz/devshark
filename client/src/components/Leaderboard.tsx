// The leaderboard, Deep End v2.
//
// Four boards share one ranked-rows shape. The 30-day board is the default
// because it is the one a new learner can climb; This month ranks the XP
// earned in the current calendar month (UTC), the board the month's top three
// are paid from (migration 056); the all-time board counts the same answers as
// the 30-day one with no window; Today is the daily challenge. The answer
// boards rank by correct answers, then accuracy (Today: by correct answers
// alone, whatever the time). Nothing here ranks by streak, and nothing here
// reorders a board: the server does. The 30-day and month boards arrive with
// their ranks; the all-time and Today boards arrive in order, and this screen
// numbers them so equal results share a rank, as the others' do.
//
// The server supplies the chosen name (the Sharkname or the account name)
// and the optional photo. The Profile's 'Your name' panel owns those
// preferences ('Leaderboards show'); this screen reads them only to show the
// learner's own row as everybody else sees it.
//
// A rank is always the number as text. The top three get a heavier ink ring,
// never a fill or a medal colour, so the order reads the same without colour. Nothing
// animates, so reduced motion has nothing to switch off.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import ErrorRetry from './ErrorRetry';
import { PageHeader } from './ui/PageHeader';
import { useT } from '../i18n/LanguageContext';
import { useIsMobile, useMediaQuery } from '../lib/useMediaQuery';
import { useAuth } from '../lib/auth';
import { ApiError, friendlyError } from '../lib/api';
import { leaderboardQuery, useLeaderboard, type LeaderboardRequest } from '../lib/queries';
import { leaderboardVisibilityQuery, useLeaderboardVisibility } from '../lib/leaderboardVisibility';
import { readOnce, settled, useFirstData } from '../lib/routeData';
import type {
  CategoryLeaderboardEntry,
  LeaderboardDailyEntry,
  LeaderboardMe,
  LeaderboardResponse,
  MonthLeaderboardEntry,
  MonthLeaderboardMe,
  WindowLeaderboardEntry,
} from '../lib/play';
import { visibleCategoryOptionsFor, categoryLabelKey } from '../lib/categories';
import { useActiveSubject, categoriesForSubject } from '../lib/subjects';
import { useUtcDay } from '../lib/utcDay';
import './Leaderboard.css';

type Tab = '30d' | 'month' | 'all' | 'today';

/** One drawn row, whichever board it came from. */
interface Row {
  key: string;
  rank: number;
  /** The learner's name, or the anonymous label when they are not named. */
  name: string;
  /** No name came with the row: the avatar is the default one, not initials. */
  anonymous: boolean;
  picture: string | null;
  /** The first numeric column: correct answers, today's score, or the month's XP. */
  first: string;
  /** The second numeric column: accuracy, or today's time. The month board has none. */
  second: string;
  /** The line under the name on a phone, where the second column has no room. */
  detail: string;
  isViewer: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The UTC day the Today board is for, moved on when 00:00 UTC passes (as
 * Today's plan day is): read once at mount, a board left open past midnight
 * kept asking for yesterday's board under "Today". */
const useBoardDay = (): string => useUtcDay(today);

// The last board that loaded, per board, so opening this screen offline still
// shows something true with its age beside it. A per-viewer convenience: it
// may be missing or unreadable, and the screen works without it. It belongs to
// the device, not to a person, so it keeps nobody's own line: the learner's
// `me` line and the "You" mark on their row are left out when a board is
// written, and again when one is read, since older caches kept the mark.
const CACHE_PREFIX = 'devshark:leaderboard:v1:';

interface CachedBoard {
  savedAt: number;
  data: LeaderboardResponse;
}

function withoutViewer(data: LeaderboardResponse): LeaderboardResponse {
  const { me: _me, ...board } = data;
  const entries = (board.entries as unknown as Array<Record<string, unknown>>).map(({ is_viewer: _viewer, ...entry }) => entry);
  return { ...board, entries: entries as unknown as LeaderboardResponse['entries'] };
}

function readCachedBoard(key: string, dailyDate?: string): CachedBoard | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedBoard>;
    if (typeof parsed?.savedAt !== 'number' || !parsed.data || !Array.isArray(parsed.data.entries)) return null;
    if (dailyDate !== undefined && (parsed.data.period !== 'daily' || parsed.data.date !== dailyDate)) return null;
    return { savedAt: parsed.savedAt, data: withoutViewer(parsed.data) };
  } catch {
    return null;
  }
}

function writeCachedBoard(key: string, data: LeaderboardResponse): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data: withoutViewer(data) }));
  } catch {
    // Storage full, blocked or absent: the live board is unaffected.
  }
}

function isOffline(error: unknown): boolean {
  if (error instanceof ApiError && error.code === 'network') return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** The board this screen opens on, in the cache before the first render, so
 *  the screen draws the board rather than a skeleton that the board replaces.
 *  Signed in, that board carries the learner's own line, and the learner's
 *  name setting comes with it, so their pinned line and the switch draw once.
 *  Offline the screen draws at once and shows the last board it loaded. */
function useBoardFirstData(request: LeaderboardRequest, viewer: string | null) {
  const queryClient = useQueryClient();
  useFirstData(`leaderboard ${viewer ?? ''} ${request.period}`, () => settled([
    readOnce(queryClient, leaderboardQuery(request, viewer)),
    viewer ? readOnce(queryClient, leaderboardVisibilityQuery(viewer)) : null,
  ]));
}

function Leaderboard() {
  const t = useT();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // Four equal segments leave the full labels too little room below 480px:
  // there the control is the small size, with the short labels.
  const compact = useMediaQuery('(max-width: 479.95px)');
  const subject = useActiveSubject();
  const { user } = useAuth();
  const viewer = user?.id ?? null;
  const topics = visibleCategoryOptionsFor();
  const selectId = useId();

  // /leaderboard?tab=today opens on the daily board (the quiz links there
  // once today's challenge is played), and ?tab=month on this month's XP.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const asked = searchParams.get('tab');
    return asked === 'today' || asked === 'month' ? asked : '30d';
  });
  // '' is "All topics". The filter applies to the 30-day and all-time boards.
  const [category, setCategory] = useState('');
  const [windowUnavailable, setWindowUnavailable] = useState(false);
  const date = useBoardDay();

  const subjectCategories = categoriesForSubject(subject.id);
  const request: LeaderboardRequest =
    tab === '30d'
      ? { period: '30d', category: category || null, viewer }
      : tab === 'month'
      ? { period: 'month', categories: subjectCategories, viewer }
      : tab === 'today'
      ? { period: 'daily', date, categories: subjectCategories }
      : category
      ? { period: 'category', category }
      : { period: 'global', categories: subjectCategories };
  const cacheKey = `${request.period}:${request.period === '30d' || request.period === 'category' ? request.category ?? '' : ''}`;

  useBoardFirstData(request, viewer);
  const { setting } = useLeaderboardVisibility();
  const { data, error, isLoading, isFetching, isPlaceholderData, fetchStatus, dataUpdatedAt, refetch } = useLeaderboard(request, viewer);
  const reload = () => void refetch();

  // While the next board loads, the previous one stays on screen (a
  // placeholder, design review 2 R2-P1.5). It is drawn with the tab it came
  // from, because each tab's rows have their own shape, and it is never
  // cached under the new board's key.
  const settledTab = useRef<Tab>(tab);
  if (data && !isPlaceholderData) settledTab.current = tab;

  // Offline shows up two ways: a request that failed on the network, or one
  // React Query holds back because the browser already reports no connection.
  const offline = fetchStatus === 'paused' || (!!error && isOffline(error));
  // Offline, the previous tab's board is not on its way out: nothing will
  // replace it. The tab picked shows its own last copy, or says it has none,
  // rather than the previous tab's rows under the new tab's name.
  const heldOver = offline && isPlaceholderData;
  const drawTab: Tab = isPlaceholderData && !heldOver ? settledTab.current : tab;
  const refreshing = (isPlaceholderData && !heldOver) || (isFetching && !!data);

  useEffect(() => {
    if (data && !error && !isPlaceholderData) writeCachedBoard(cacheKey, data);
  }, [data, error, isPlaceholderData, cacheKey]);

  // Until migration 040 is applied the 30-day board does not exist. Say so and
  // show the all-time board rather than an error on the default tab.
  const missingWindow = tab === '30d' && error instanceof ApiError && error.code === 'rpc_missing';
  useEffect(() => {
    if (!missingWindow) return;
    setWindowUnavailable(true);
    setTab('all');
  }, [missingWindow]);

  const stale: CachedBoard | null = offline
    ? data && !heldOver
      ? { savedAt: dataUpdatedAt, data }
      : readCachedBoard(cacheKey, request.period === 'daily' ? request.date : undefined)
    : null;
  const board: LeaderboardResponse | null = offline ? stale?.data ?? null : error ? null : data ?? null;
  const me = !error && !offline && (drawTab === '30d' || drawTab === 'month') ? data?.me ?? null : null;

  const rows = board ? toRows(drawTab, board, t) : [];
  const viewerListed = rows.some((row) => row.isViewer);
  // The pinned line uses the server's private name preference. Public photo
  // consent is not inferred from the account's avatar.
  const ownName = setting ? (setting.mode === 'account' ? setting.accountName ?? setting.nickname : setting.nickname) : null;
  const pinned: Row | null =
    me && me.rank !== null && !viewerListed
      ? {
          key: 'you',
          rank: me.rank,
          name: ownName ?? t('leaderboard.anonymous'),
          anonymous: ownName === null,
          picture: setting?.picture ?? null,
          ...(drawTab === 'month' ? monthFigures(me as MonthLeaderboardMe, t) : answerFigures(me as LeaderboardMe, t)),
          isViewer: true,
        }
      : null;
  const showNoActivity = !!me && me.rank === null && rows.length > 0;

  const periodLabel =
    drawTab === '30d'
      ? t('leaderboard.last30')
      : drawTab === 'month'
      ? t('leaderboard.thisMonth')
      : drawTab === 'all'
      ? t('leaderboard.allTime')
      : t('leaderboard.today');
  const topicLabel = category ? t(categoryLabelKey(category)) : t('leaderboard.allTopics');
  const caption = drawTab === 'today' || drawTab === 'month' ? periodLabel : t('leaderboard.caption', { period: periodLabel, topic: topicLabel });
  const headers =
    drawTab === 'today'
      ? [t('leaderboard.scoreHeader'), t('leaderboard.timeHeader')]
      : drawTab === 'month'
      ? [t('leaderboard.xpHeader')]
      : [t('leaderboard.correctHeader'), t('leaderboard.accuracyHeader')];
  const scope =
    tab === '30d'
      ? t('leaderboard.scope30d')
      : tab === 'month'
      ? t('leaderboard.scopeMonth')
      : tab === 'all'
      ? t('leaderboard.scopeAllTime')
      : t('leaderboard.scopeToday');
  // The topic filter narrows the answer boards; XP is not counted per topic.
  const filtered = tab === '30d' || tab === 'all';

  const emptyText =
    tab === '30d'
      ? category
        ? t('leaderboard.empty30dTopic', { label: topicLabel })
        : t('leaderboard.empty30d')
      : tab === 'month'
      ? t('leaderboard.emptyMonth')
      : tab === 'all'
      ? category
        ? t('leaderboard.noCategoryAttempts', { label: topicLabel })
        : t('leaderboard.emptyAllTime')
      : t('leaderboard.emptyToday');

  let body: ReactNode;
  if (missingWindow || (isLoading && !board)) {
    body = <BoardSkeleton label={t('leaderboard.loading')} />;
  } else if ((error || offline) && !board) {
    body = <ErrorRetry message={offline ? t('leaderboard.offline') : friendlyError(error)} onRetry={reload} />;
  } else if (rows.length === 0) {
    body = (
      <div className="lb-board ss-panel lb-empty">
        <p className="lb-empty__text">{emptyText}</p>
        <Button variant="secondary" label={tab === 'today' ? t('quiz.todaysChallenge') : t('leaderboard.emptyCta')} onClick={() => navigate(tab === 'today' ? '/quiz?mode=daily' : '/quiz')} />
      </div>
    );
  } else {
    body = (
      <div className="lb-board ss-panel" aria-busy={refreshing || undefined}>
        {isMobile ? (
          <MobileBoard rows={rows} pinned={pinned} caption={caption} />
        ) : (
          <TableBoard rows={rows} pinned={pinned} caption={caption} headers={headers} />
        )}
        {showNoActivity && <p className="lb-note">{t(drawTab === 'month' ? 'leaderboard.noXpThisMonth' : 'leaderboard.noActivity')}</p>}
      </div>
    );
  }

  return (
    <div className="lb">
      {/* The shared operational header (social-account-11). What the board
          ranks is the page lead, so the controls sit right on the table they
          filter (UX audit social-account-09). */}
      <PageHeader title={t('leaderboard.title')} lead={scope}>
        {windowUnavailable && tab === 'all' && (
          <p className="ss-page-header__lead" role="status">
            {t('leaderboard.windowUnavailable')}
          </p>
        )}
      </PageHeader>

      <div className="lb-controls">
        <SegmentedControl
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          label={t('leaderboard.period')}
          layout={isMobile ? 'fill' : undefined}
          size={compact ? 'sm' : undefined}
        >
          <SegmentedControlItem value="30d" label={compact ? t('leaderboard.last30Short') : t('leaderboard.last30')} />
          <SegmentedControlItem value="month" label={compact ? t('leaderboard.thisMonthShort') : t('leaderboard.thisMonth')} />
          <SegmentedControlItem value="all" label={t('leaderboard.allTime')} />
          <SegmentedControlItem value="today" label={t('leaderboard.today')} />
        </SegmentedControl>
        {filtered && (
          <div className="lb-filter">
            <label className="ss-field-label" htmlFor={selectId}>
              {t('leaderboard.topic')}
            </label>
            <select id={selectId} className="ss-select lb-select" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t('leaderboard.allTopics')}</option>
              {topics.map((topic) => (
                <option key={topic.value} value={topic.value}>
                  {t(categoryLabelKey(topic.value))}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {stale && board && (
        <Banner
          status="warning"
          title={t('leaderboard.offlineStale', {
            time: new Date(stale.savedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
          })}
          endContent={<Button size="sm" variant="ghost" label={t('quiz.retry')} onClick={reload} />}
        />
      )}

      {body}
    </div>
  );
}

/** Ranks for rows that arrive in board order, numbered so equal results share
 *  a rank (1, 1, 3): a row tied with the one above it on every sort key takes
 *  that row's rank. `tie` returns the board's sort keys. */
function sharedRanks<T>(entries: T[], tie: (entry: T) => string): number[] {
  const ranks: number[] = [];
  entries.forEach((entry, index) => {
    ranks.push(index > 0 && tie(entry) === tie(entries[index - 1]) ? ranks[index - 1] : index + 1);
  });
  return ranks;
}

/** The numeric columns of a row on the answer boards. */
function answerFigures(entry: { correct: number; answered: number; accuracy_pct: number }, t: ReturnType<typeof useT>) {
  return {
    first: String(entry.correct),
    second: `${entry.accuracy_pct}%`,
    detail: t('leaderboard.answersDetail', { answered: entry.answered, accuracy: entry.accuracy_pct }),
  };
}

/** The month board's one figure, the XP, and its unit on a phone. */
function monthFigures(entry: { xp: number }, t: ReturnType<typeof useT>) {
  return { first: Number(entry.xp).toLocaleString('en-GB'), second: '', detail: t('leaderboard.xpDetail') };
}

function toRows(tab: Tab, board: LeaderboardResponse, t: ReturnType<typeof useT>): Row[] {
  // A learner who has not switched their name on arrives with none.
  const who = (entry: { display_name: string | null; picture: string | null }) => {
    const name = entry.display_name?.trim() || null;
    return { name: name ?? t('leaderboard.anonymous'), anonymous: name === null, picture: entry.picture ?? null };
  };
  if (tab === 'month') {
    // Ranked by the server, the way the month's top three are paid: equal XP
    // shares a rank (1, 1, 3).
    return (board.entries as MonthLeaderboardEntry[]).map((entry, index) => ({
      key: `${entry.rank}-${index}`,
      rank: typeof entry.rank === 'number' ? entry.rank : index + 1,
      ...who(entry),
      ...monthFigures(entry, t),
      isViewer: entry.is_viewer === true,
    }));
  }
  if (tab === '30d') {
    return (board.entries as WindowLeaderboardEntry[]).map((entry, index) => ({
      key: `${entry.rank}-${index}`,
      rank: typeof entry.rank === 'number' ? entry.rank : index + 1,
      ...who(entry),
      ...answerFigures(entry, t),
      isViewer: entry.is_viewer === true,
    }));
  }
  if (tab === 'today') {
    // Today ranks by correct answers alone: equal scores share a rank however
    // long each took. The time is shown, and decides nothing.
    const daily = board.entries as LeaderboardDailyEntry[];
    const ranks = sharedRanks(daily, (entry) => String(entry.correct));
    return daily.map((entry, index) => ({
      key: String(index),
      rank: ranks[index],
      ...who(entry),
      first: `${entry.correct}/${entry.total}`,
      second: formatMs(entry.duration_ms),
      detail: formatMs(entry.duration_ms),
      isViewer: false,
    }));
  }
  // The subject's all-time board and a single category's board share a shape,
  // and a rule: correct answers, then fewer answers for the same number correct.
  const lifetime = board.entries as CategoryLeaderboardEntry[];
  const ranks = sharedRanks(lifetime, (entry) => `${entry.total_correct}:${entry.total_questions}`);
  return lifetime.map((entry, index) => ({
    key: String(index),
    rank: ranks[index],
    ...who(entry),
    first: String(entry.total_correct),
    second: `${entry.accuracy_pct}%`,
    detail: t('leaderboard.answersDetail', { answered: entry.total_questions, accuracy: entry.accuracy_pct }),
    isViewer: false,
  }));
}

function RankDisc({ rank, label }: { rank: number; label?: string }) {
  return (
    <span className={`lb-rank${rank <= 3 ? ' lb-rank--top' : ''}`}>
      {label && <span className="ss-sr-only">{label} </span>}
      {rank}
    </span>
  );
}

function Who({ row }: { row: Row }) {
  return (
    <span className="lb-who">
      <RowAvatar row={row} />
      <Name row={row} />
    </span>
  );
}

/** The photo, the name's initials, or for an unnamed learner the default
 *  avatar rather than an "L" for "Learner". */
function RowAvatar({ row }: { row: Row }) {
  return <Avatar src={row.picture ?? undefined} name={row.anonymous ? undefined : row.name} size="small" />;
}

/** The name, and "You" beside it on the learner's own row, named or not. */
function Name({ row }: { row: Row }) {
  const t = useT();
  return (
    <>
      <span className="lb-name">{row.name}</span>
      {row.isViewer && <span className="ss-tag">{t('leaderboard.you')}</span>}
    </>
  );
}

function TableBoard({ rows, pinned, caption, headers }: { rows: Row[]; pinned: Row | null; caption: string; headers: string[] }) {
  const t = useT();
  const line = (row: Row) => (
    <tr key={row.key} className={row.isViewer ? 'is-viewer' : undefined} aria-current={row.isViewer ? 'true' : undefined}>
      <td className="lb-col-rank">
        <RankDisc rank={row.rank} />
      </td>
      <td>
        <Who row={row} />
      </td>
      <td className="lb-num lb-score">{row.first}</td>
      {headers.length > 1 && <td className="lb-num">{row.second}</td>}
    </tr>
  );
  return (
    <table className="lb-table">
      <caption className="ss-sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="lb-col-rank">{t('leaderboard.rank')}</th>
          <th scope="col">{t('leaderboard.learner')}</th>
          {headers.map((header) => (
            <th key={header} scope="col" className="lb-num lb-col-num">{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>{rows.map(line)}</tbody>
      {pinned && <tfoot>{line(pinned)}</tfoot>}
    </table>
  );
}

function MobileBoard({ rows, pinned, caption }: { rows: Row[]; pinned: Row | null; caption: string }) {
  const t = useT();
  const card = (row: Row) => (
    <li key={row.key} className={`lb-card${row.isViewer ? ' is-viewer' : ''}`} aria-current={row.isViewer ? 'true' : undefined}>
      <RankDisc rank={row.rank} label={t('leaderboard.rank')} />
      <span className="lb-card__avatar">
        <RowAvatar row={row} />
      </span>
      <span className="lb-card__main">
        <span className="lb-card__name">
          <Name row={row} />
        </span>
        <span className="lb-card__detail">{row.detail}</span>
      </span>
      <span className="lb-card__score">
        <span className="lb-score">{row.first}</span>
      </span>
    </li>
  );
  return (
    <>
      <ol className="lb-cards" aria-label={caption}>
        {rows.map(card)}
      </ol>
      {pinned && (
        <div className="lb-pinned">
          <p className="lb-pinned__label">{t('leaderboard.yourPlace')}</p>
          <ul className="lb-cards">{card(pinned)}</ul>
        </div>
      )}
    </>
  );
}

function BoardSkeleton({ label }: { label: string }) {
  return (
    <div className="lb-board ss-panel" aria-busy="true">
      <span className="ss-sr-only" role="status">
        {label}
      </span>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="lb-skeleton" aria-hidden="true">
          <Skeleton width={32} height={32} radius="rounded" />
          <Skeleton width={32} height={32} radius="rounded" />
          <div className="lb-skeleton__name">
            <Skeleton width="60%" height={16} />
          </div>
          <Skeleton width={48} height={20} />
        </div>
      ))}
    </div>
  );
}

function formatMs(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export default Leaderboard;
