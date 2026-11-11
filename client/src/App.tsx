import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Link, Navigate, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { IconButton as AxIconButton } from '@astryxdesign/core/IconButton';
import { AppToast } from './components/ui/AppToast';
import { useIsMobile } from './lib/useMediaQuery';
import './styles/app-shell.css';
import LoadingScreen from './components/LoadingScreen';
import { SwimmingFin, Waterline } from './components/SharkFin';
import BrandLogo from './components/BrandLogo';
import { useT, useLanguage } from './i18n/LanguageContext';
import { preferredTrackOf } from './lib/trackPref';
import { setTrackValue } from './lib/tracks';
import type { TranslationKey } from './i18n/translations';
import { useGameConfig, type GameConfig } from './lib/gameConfig';
import { primeRankMarker } from './lib/xp';
import { syncProgressWithServer } from './lib/roadmap';
import XpToaster from './components/XpToaster';
import RegisterPromptSnackbar from './components/RegisterPromptSnackbar';
import ReferralBinder from './components/ReferralBinder';
import PendingQuizResults from './components/PendingQuizResults';
import SignInButton from './components/SignInButton';
import { useAuth } from './lib/auth';
import { useEntitlement } from './lib/entitlement';
import { useWallet } from './lib/rewards';
import { capturePageview, identifyUser, resetAnalytics } from './lib/analytics';
import { m, AnimatePresence, useReducedMotion } from './lib/motion';
import BrandFooter, { SettingsToggles } from './components/BrandFooter';
import CookieConsent from './components/CookieConsent';
import { CURRENT_PRODUCT } from './lib/products';
import { CloseIcon, CoinsIcon, TrophyIcon } from './components/ui/icons';
import ConnectionStatus from './components/ui/ConnectionStatus';
import UpgradeSheetHost from './components/UpgradeSheetHost';
import SignInDialogHost from './components/auth/SignInDialogHost';
import { useAuthLanding } from './lib/authLanding';
import { installIntentPreloading, routeBoxKey, routeChunk, useFirstPageTransition } from './lib/routePreload';
import { lazyPage, lazyShellPart } from './lib/routeRecovery';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { pageMaxWidth } from './components/ui/pageWidth';
import { ShellPartBoundary } from './components/ShellPartBoundary';

// AuthButton subscribes to multiple stores and pulls in the leveling/shop
// modules — heavy for the initial bundle. Lazy-load it so the app shell
// (logo, nav, theme/sound toggles) paints first. Only a session needs it: a
// signed-out visitor gets SignInButton, which ships with the shell.
// `lazyShellPart`, not `lazy`: its boundary in the header can ask for it again
// (lib/routeRecovery.ts).
const AuthButton = lazyShellPart(() => import('./components/AuthButton'));

// Each page's chunk, registered with the paths that render it so a link can
// start loading its page before the click lands (lib/routePreload.ts). Pages
// are `lazyPage`, not `lazy`: React.lazy keeps a failed load for good, and a
// page whose code failed must be able to ask again (lib/routeRecovery.ts).
const exact = (...paths: string[]) => (pathname: string) => paths.includes(pathname);
// The paths of the <Route>s below that render a chunk, in their own syntax:
// `:name` is one segment and a last `:name?` may be left out; a trailing slash
// is the same route, as React Router reads it. A prefix matcher also took the
// deeper paths no route serves (/play/a/b, /coding/a/b/c), which draw the 404
// page and so loaded a chunk for nothing.
const routes = (...patterns: string[]) => {
  const shapes = patterns.map((pattern) => pattern.split('/').slice(1));
  return (pathname: string) => {
    const parts = (pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname).split('/').slice(1);
    return shapes.some((shape) => {
      const optional = shape[shape.length - 1].endsWith('?');
      if (parts.length !== shape.length && !(optional && parts.length === shape.length - 1)) return false;
      return parts.every((part, i) => (shape[i].startsWith(':') ? part.length > 0 : part === shape[i]));
    });
  };
};
const loadHome = routeChunk(exact('/'), () => import('./components/Home'));
const loadQuiz = routeChunk(exact('/quiz'), () => import('./components/Quiz'));
// The FDE path's pages sit inside its Learn section (#489) but load the path
// screens, not the Learn page. lib/learningPaths.ts names the same address.
const FDE_PATH = '/learn/forward-deployed-engineer/path';
// /learn/big-o is not a section: its page is a module of its own
// (learn/BigOIntroduction.tsx) that loads without the map's chunk (#587 C17).
const BIG_O_INTRODUCTION = /^\/learn\/big-o\/?$/;
const learnSection = routes('/learn/:section?');
const loadRoadmap = routeChunk((pathname) => learnSection(pathname) && !BIG_O_INTRODUCTION.test(pathname), () => import('./components/Roadmap'));
const loadBigOIntroduction = routeChunk((pathname) => BIG_O_INTRODUCTION.test(pathname), () => import('./components/learn/BigOIntroduction'));
const loadBigO = routeChunk(exact('/big-o'), () => import('./components/BigOPage'));
const loadCareerRoadmap = routeChunk(exact('/roadmap'), () => import('./components/CareerRoadmap'));
const loadProfile = routeChunk(exact('/profile'), () => import('./components/Profile'));
const loadLeaderboard = routeChunk(exact('/leaderboard'), () => import('./components/Leaderboard'));
const loadFlashcards = routeChunk(exact('/cards'), () => import('./components/Flashcards'));
const loadShop = routeChunk(exact('/shop'), () => import('./components/Shop'));
const loadPlay = routeChunk(routes('/play/:code?'), () => import('./components/Play'));
const loadChallenge = routeChunk(exact('/challenge'), () => import('./components/Challenge'));
const loadAdmin = routeChunk(routes('/admin/:section?'), () => import('./components/admin/AdminPage'));
const loadDev = routeChunk(routes('/dev'), () => import('./components/dev/DevPage'));
const loadLegal = routeChunk(exact('/privacy', '/terms'), () => import('./components/LegalPages'));
const loadPublicInfo = routeChunk(exact('/classroom'), () => import('./components/PublicInfoPages'));
const loadTopic = routeChunk(routes('/topics/:slug'), () => import('./components/TopicLandingPage'));
const loadToday = routeChunk(exact('/today'), () => import('./components/Today'));
const loadCollection = routeChunk(exact('/collection'), () => import('./components/Collection'));
const loadTyping = routeChunk(exact('/typing'), () => import('./components/TypingRacer'));
const loadCoding = routeChunk(routes('/coding/:track?', '/coding/:track/:taskId'), () => import('./components/coding/CodingSection'));
const loadGithubSettings = routeChunk(exact('/settings/github'), () => import('./components/coding/GithubSettingsPage'));
// Only the FDE path's own pages: /roadmap/paths/* now only redirects to Learn.
const loadPaths = routeChunk((pathname) => FDE_SECTION_VISIBLE && routes(FDE_PATH, `${FDE_PATH}/:moduleId`)(pathname), () => import('./components/paths/LearningPathScreens'));
const loadPremium = routeChunk(exact('/premium'), () => import('./components/PremiumPage'));
const loadBilling = routeChunk(exact('/premium/checkout', '/premium/success', '/premium/cancel'), () => import('./components/PremiumBillingPages'));
const loadDaily = routeChunk(routes('/daily/:date?'), () => import('./components/DailyQuestionPage'));
const loadAuthPages = routeChunk(exact('/auth/confirmed', '/reset-password'), () => import('./components/auth/AuthPages'));

const Home = lazyPage(loadHome);
const Quiz = lazyPage(loadQuiz);
const Roadmap = lazyPage(loadRoadmap);
const BigOPage = lazyPage(loadBigO);
const BigOIntroduction = lazyPage(() => loadBigOIntroduction().then((m) => ({ default: m.BigOIntroduction })));
const CareerRoadmap = lazyPage(loadCareerRoadmap);
const Profile = lazyPage(loadProfile);
const Leaderboard = lazyPage(loadLeaderboard);
const Flashcards = lazyPage(loadFlashcards);
const Shop = lazyPage(loadShop);
const PlayLanding = lazyPage(() => loadPlay().then((m) => ({ default: m.PlayLanding })));
const PlayMatch = lazyPage(() => loadPlay().then((m) => ({ default: m.PlayMatch })));
const Challenge = lazyPage(loadChallenge);
const DevPage = lazyPage(loadDev);
const AdminPage = lazyPage(loadAdmin);
const PrivacyPage = lazyPage(() => loadLegal().then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazyPage(() => loadLegal().then((m) => ({ default: m.TermsPage })));
const ClassroomPage = lazyPage(() => loadPublicInfo().then((m) => ({ default: m.ClassroomPage })));
const TopicLandingPage = lazyPage(loadTopic);
const Today = lazyPage(loadToday);
const Collection = lazyPage(loadCollection);
const TypingRacer = lazyPage(loadTyping);
const CodingHome = lazyPage(() => loadCoding().then((m) => ({ default: m.CodingHome })));
const CodingTrackScreen = lazyPage(() => loadCoding().then((m) => ({ default: m.CodingTrackScreen })));
const FullStackScreen = lazyPage(() => loadCoding().then((m) => ({ default: m.FullStackScreen })));
const CodingTaskScreen = lazyPage(() => loadCoding().then((m) => ({ default: m.CodingTaskScreen })));
const CodingReviewScreen = lazyPage(() => loadCoding().then((m) => ({ default: m.CodingReviewScreen })));
const GithubSettingsPage = lazyPage(() => loadGithubSettings().then((m) => ({ default: m.GithubSettingsPage })));
const FdeOverview = lazyPage(() => loadPaths().then((m) => ({ default: m.FdeOverview })));
const FdeModule = lazyPage(() => loadPaths().then((m) => ({ default: m.FdeModule })));

/** The FDE path's old addresses, /roadmap/specializations/fde and
 * /roadmap/specializations/fde/<module>, land on its section's with the
 * module, the query (?activity=) and the hash kept. vercel.json answers a
 * crawler with a 308 to the same place. */
function OldFdePathRedirect() {
  const { '*': rest = '' } = useParams();
  const { search, hash } = useLocation();
  const moduleId = rest.split('/')[0];
  return <Navigate to={`${FDE_PATH}${moduleId ? `/${encodeURIComponent(moduleId)}` : ''}${search}${hash}`} replace />;
}
const NotFoundPage = lazyPage(() => loadPublicInfo().then((m) => ({ default: m.NotFoundPage })));
const PremiumPage = lazyPage(loadPremium);
const DailyQuestionPage = lazyPage(loadDaily);
const PremiumSuccessPage = lazyPage(() => loadBilling().then((m) => ({ default: m.PremiumSuccessPage })));
const PremiumCheckoutPage = lazyPage(() => loadBilling().then((m) => ({ default: m.PremiumCheckoutPage })));
const PremiumCancelPage = lazyPage(() => loadBilling().then((m) => ({ default: m.PremiumCancelPage })));
const EmailConfirmedPage = lazyPage(() => loadAuthPages().then((m) => ({ default: m.EmailConfirmedPage })));
const ResetPasswordPage = lazyPage(() => loadAuthPages().then((m) => ({ default: m.ResetPasswordPage })));

// Route-transition variants, hoisted so the m.div props keep a stable identity
// across App re-renders (App re-renders on every navigation — hottest path).
// Enter-only fade: the previous AnimatePresence mode="wait" exit pass left a
// blank beat between routes that read as flicker; pages supply their own
// subtle entrance motion on top of this.
const ROUTE_ANIM = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
} as const;
const ROUTE_TRANSITION = { duration: 0.14, ease: 'easeOut' } as const;

// The route box. flex-basis auto (not 0): the box must GROW with tall pages so
// the wrapper's bottom reserve lands below the content. With basis 0 the box
// stayed viewport-sized, tall cards overflowed straight through every padding,
// and page ends slid under the waterline overlay. The first-load fallback gets
// the same box, so the loader has the page's room.
// The route box's width is the route's page width (.ss-route in app-shell.css).
const ROUTE_BOX_STYLE = { flex: '1 0 auto', minWidth: 0, display: 'flex', flexDirection: 'column' } as const;

// The document head of each route (lib/routeHead.ts, with the public pages'
// metadata and the topic catalogue it needs, ~3 KB gzip) loads as its own
// chunk, started as this module evaluates, instead of inside the shell's
// first download (perf audit #587). The head a coding task or a dated question
// of the day arrived with (vite.config.ts) is read as the chunk arrives, before
// any route writes its own; a load that fails is asked again on the next
// navigation.
type RouteHead = { apply: typeof import('./lib/routeHead').applyRouteHead; share: ReturnType<typeof import('./lib/routeHead').readShareHead> };
let routeHead: Promise<RouteHead> | null = null;
const loadRouteHead = (): Promise<RouteHead> => (routeHead ??= import('./lib/routeHead').then(
  (head) => ({ apply: head.applyRouteHead, share: head.readShareHead() }),
  (error: unknown) => {
    routeHead = null;
    throw error;
  },
));
void loadRouteHead().catch(() => undefined);

const MenuIcon = () => (
  <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

// Premium: a cut gem, the one plan mark in the header. Decorative; the
// button carries the word "Premium" as its accessible name and tooltip.
const PremiumNavIcon = ({ member }: { member: boolean }) => (
  <svg className={member ? 'ss-premium-nav-icon--member' : undefined} aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h12l4 6-10 12L2 9z" />
    <path d="M2 9h20M12 21 8 9l2-6M12 21l4-12-2-6" />
  </svg>
);

// `feature` ties a nav item to a toggle in /dev → Settings; when that feature is
// off, the item is hidden from the nav (quiz is always available). `signedIn`
// items are empty without an account, so a visitor without a session never
// sees them. `drawerOnly` items stay out of the desktop centre row (design
// audit P0.6): signed out it reads Learn · Quiz · Coding · Challenge · Play ·
// Premium, signed in Today · Learn · Quiz · Coding · Challenge · Play.
const NAV_ITEMS: {
  to: string;
  key: TranslationKey;
  isActive: (path: string) => boolean;
  feature?: keyof GameConfig['features'];
  signedIn?: true;
  drawerOnly?: true;
  /** In the mobile drawer's second group, 'You' (UX audit shell-public-15):
   * the learner's own pages and the purchase ones, as the desktop header
   * splits them from the learning destinations. */
  you?: true;
}[] = [
  { to: '/today', key: 'nav.today', isActive: (p) => p === '/today', signedIn: true },
  { to: '/learn', key: 'nav.learn', isActive: (p) => p.startsWith('/learn') },
  { to: '/quiz', key: 'nav.quiz', isActive: (p) => p === '/quiz' },
  { to: '/coding', key: 'nav.coding', isActive: (p) => p.startsWith('/coding') },
  { to: '/challenge', key: 'nav.challenge', isActive: (p) => p.startsWith('/challenge') },
  { to: '/play', key: 'nav.play', isActive: (p) => p.startsWith('/play'), feature: 'multiplayer' },
  { to: '/roadmap', key: 'nav.roadmap', isActive: (p) => p === '/roadmap', drawerOnly: true, you: true },
  { to: '/collection', key: 'nav.cards', isActive: (p) => p === '/collection' || p === '/cards', signedIn: true, drawerOnly: true, you: true },
  { to: '/leaderboard', key: 'nav.leaderboard', isActive: (p) => p === '/leaderboard', feature: 'leaderboard', signedIn: true, you: true },
  { to: '/shop', key: 'nav.shop', isActive: (p) => p === '/shop', signedIn: true, you: true },
  { to: '/premium', key: 'nav.premium', isActive: (p) => p === '/premium' || p.startsWith('/premium/'), you: true },
];

// Shown only while the first page of a visit loads: a navigation keeps the
// current page until the next one can render (see the route Suspense below).
const RouteLoader = () => {
  const { t } = useLanguage();
  // Show nothing for the first beat: most lazy chunks resolve in well under
  // 200ms (or are already cached), and flashing a spinner for that instant
  // reads as glitching. The shark only surfaces on genuinely slow loads.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(id);
  }, []);
  if (!visible) return null;
  return <LoadingScreen label={t('common.loading')} size={28} sx={{ minHeight: 'auto', py: 6 }} />;
};

// The approved bold wordmark and centred V9 fin, 22px tall. The fin and
// “dev” inherit the readable theme accent; “Shark” is ink in light mode and
// white in dark mode. The header link keeps its accessible home label.
function HeaderBrand() {
  const t = useT();
  return (
    <Link
      to="/"
      aria-label={t('nav.home', { brand: CURRENT_PRODUCT.brand })}
      className="ss-header-brand"
      style={{ color: 'var(--brand-accent)' }}
    >
      <BrandLogo height={22} />
    </Link>
  );
}

// The account widget's place when its code did not load: a quiet retry with
// the Log in button's size and style (44px on a touch screen, like every
// Astryx button), centred in the widget's 56px row so the header keeps its
// height. Its name says what failed; the text is the app's Try again.
function AccountRetry({ retry, busy }: { retry: () => void; busy: boolean }) {
  const t = useT();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 56, flexShrink: 0 }}>
      <Button
        variant="secondary"
        size="md"
        label={t('auth.accountRetry')}
        tooltip={t('auth.accountRetry')}
        isLoading={busy}
        // Interruptible: busy but not disabled, so it keeps keyboard focus.
        isInterruptible
        onClick={retry}
      >
        {t('error.tryAgain')}
      </Button>
    </span>
  );
}

function App() {
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const startupGuidePath = useRef(/^\/topics\//.test(location.pathname) ? location.pathname : null);
  const navigate = useNavigate();
  const { t } = useLanguage();
  const config = useGameConfig();
  const membership = useEntitlement();
  // An active quiz or a live Challenge run: the route hides the chrome (focus mode).
  const [quizActive, setQuizActive] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const { user, isLoading: authLoading, signInResumeFailed, passwordRecovery, draftsKept, dismissDraftsKept } = useAuth();
  const [signupBonusOpen, setSignupBonusOpen] = useState(false);
  // A sign-in pressed before a reload (lib/auth.tsx) failed in this document,
  // where the button that was pressed is gone: the shell says so.
  const [resumeFailedOpen, setResumeFailedOpen] = useState(false);
  useEffect(() => {
    if (signInResumeFailed) setResumeFailedOpen(true);
  }, [signInResumeFailed]);
  const closeResumeFailed = useCallback(() => setResumeFailedOpen(false), []);
  const mobile = useIsMobile();
  const analyticsIdentified = useRef(false);

  // Remember the learner's current rank on load so we don't re-celebrate a
  // rank-up earned in a previous session.
  useEffect(() => primeRankMarker(), []);

  // A pointer resting on a link, a focus or a first touch starts loading the
  // page behind it, so most clicks find their page ready.
  useEffect(() => installIntentPreloading(), []);

  // A click pushes the new address at once, while the router renders the next
  // page in a transition that keeps this one on screen until the next can
  // render whole. While the address is ahead of the page, the nav already marks
  // where the learner is going and the page is busy (app-shell.css fades it
  // back if the wait outlasts a beat). The listener runs after the router's own
  // click handling, so the address it reads is the new one.
  const [clickedPath, setClickedPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setClickedPath(window.location.pathname);
    document.addEventListener('click', sync);
    window.addEventListener('popstate', sync);
    return () => {
      document.removeEventListener('click', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  const navigating = clickedPath !== location.pathname && clickedPath === window.location.pathname;
  const navPath = navigating ? clickedPath : location.pathname;

  // Every page opens at its top. The scroll container is <main>, which the
  // browser never resets; the page used to blank while the next one loaded,
  // which reset it by accident on a first visit and never on a return.
  const firstPathname = useRef(true);
  useLayoutEffect(() => {
    if (firstPathname.current) {
      firstPathname.current = false;
      return;
    }
    const main = document.getElementById('main-content');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  // The drawer is modal while open: focus moves in, Tab cycles inside, Escape
  // closes, and focus returns to whatever opened it (the hamburger). Every
  // other overlay gets this from Astryx's Dialog; the drawer is hand-rolled
  // for the slide-in layout, so it implements the same contract here.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const panel = drawerRef.current;
    if (!panel) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null);
    (focusables()[0] ?? panel).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMobileNavOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [mobileNavOpen]);

  // Tie analytics events to the signed-in learner (and drop the identity on
  // sign-out). No-op unless PostHog is configured.
  useEffect(() => {
    if (user?.id) {
      identifyUser(user.id);
      analyticsIdentified.current = true;
    } else if (analyticsIdentified.current) {
      resetAnalytics();
      analyticsIdentified.current = false;
    }
  }, [user]);

  // Apply the account's saved learning track on sign-in, so the chosen path
  // follows the learner across devices. The account wins over anything cached
  // on this device: a guest may draft a choice, but signing in never silently
  // replaces what the account already says.
  useEffect(() => {
    const pref = preferredTrackOf(user);
    if (pref) setTrackValue(pref);
  }, [user]);

  // Pull the account's verified progress and unlocks once per sign-in. Today,
  // the maps and the header read the browser's copy; on a new device, or after
  // playing signed out, that copy is not the account's.
  const signedInId = user?.id ?? null;
  useEffect(() => {
    if (signedInId) syncProgressWithServer().catch(() => {});
  }, [signedInId]);

  // Sign-out drops every cached account response before the next account
  // draws (lib/auth.tsx, through beforeAccountChange).

  // Back to the page that asked for the sign-in, and to the new-password
  // form after a reset link (lib/authLanding.ts).
  useAuthLanding(user, passwordRecovery);

  // The welcome coins: the server pays them on the account's first wallet
  // read (the header reads the wallet for the crown) and says so once, on the
  // read that paid them (#227). The ledger event is derived from the account,
  // so no device can pay them twice.
  const wallet = useWallet(Boolean(user));
  const welcomeGranted = wallet.data?.welcome?.granted === true;
  useEffect(() => {
    if (welcomeGranted) setSignupBonusOpen(true);
  }, [welcomeGranted]);

  // Nav items for features that are currently enabled in /dev → Settings.
  // A stored session is still being restored on the first render: treat it
  // as signed in, as the account slot does, so the nav does not draw the
  // signed-out row and then jump when the session lands.
  const signedIn = !!user || authLoading;
  const navItems = NAV_ITEMS.filter((item) => (!item.feature || config.features[item.feature]) && (!item.signedIn || signedIn));
  // Leaderboard, Premium & Shop aren't learning surfaces, so with a session
  // they get compact icon buttons in the right slot instead of crowding the
  // centre nav (and stay in the mobile drawer via navItems). A visitor without
  // one gets Premium as the last text link and no icon buttons.
  const SECONDARY_ROUTES = signedIn ? ['/leaderboard', '/premium', '/shop'] : [];
  const primaryNavItems = navItems.filter((item) => !item.drawerOnly && !SECONDARY_ROUTES.includes(item.to));
  const showLeaderboardIcon = navItems.some((item) => item.to === '/leaderboard');

  useEffect(() => {
    // Only the latest route writes, however the loads finish.
    let current = true;
    loadRouteHead().then(({ apply, share }) => {
      if (current) apply(location.pathname, t, share);
    }, () => undefined);
    return () => {
      current = false;
    };
  }, [location.pathname, t]);

  // Route focus follows the route box (lib/routePreload.ts), not the
  // pathname: a Learn section switch keeps focus on the switcher.
  const boxKey = routeBoxKey(location.pathname);
  // A nav link to the box on screen (Learn on /learn/<section>) only names
  // the page already shown: replace, so it adds no history entry and no view.
  const inBox = (to: string) => boxKey === to && location.pathname !== to;
  useEffect(() => {
    // Route focus is intentionally box-only, so a change that only rewrites
    // the head does not pull focus away from the current control.
    if (startupGuidePath.current !== location.pathname) startupGuidePath.current = null;
    const preserveStartupFocus = startupGuidePath.current !== null;
    // The visit's first location (React Router keys it 'default').
    const firstPage = location.key === 'default';
    const previousFocus = document.activeElement;
    const timer = window.setTimeout(() => {
      // The public guide's native interaction owns focus during cold startup.
      // Once navigation leaves it, ordinary route focus resumes.
      if (preserveStartupFocus) return;
      // The first page of a visit can draw inside this delay now that it
      // renders in a transition and a level opens without a minimum loader
      // (perf baseline #587 C04, C05): a control the learner or the page has
      // focused by then keeps the focus, as it did when the page drew later.
      const active = document.activeElement;
      const main = document.getElementById('main-content');
      // A control the learner reached during navigation, or the destination
      // focused as it mounted, owns focus even after the first page.
      if (active && active !== document.body &&
          (firstPage || active !== previousFocus || main?.contains(active))) return;
      // A page that focused the target its hash names keeps that focus.
      if (location.hash && active?.id === location.hash.slice(1)) return;
      // Silent focus: clear the skip-link flag first so this move never paints
      // the page-wide ring (see #main-content rules in app-shell.css).
      main?.removeAttribute('data-skip-target');
      main?.focus({ preventScroll: true });
    }, 230);
    return () => window.clearTimeout(timer);
  }, [boxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual SPA pageview (capture_pageview is off in the SDK). No-op unless
  // PostHog is configured. A replace inside one route box only names the page
  // the visitor already sees (/learn resolving to /learn/<section>), so it
  // logs nothing; a section switch is a push and logs its own view.
  const navigationType = useNavigationType();
  const viewedBox = useRef<string | null>(null);
  useEffect(() => {
    const sameBox = viewedBox.current === boxKey;
    viewedBox.current = boxKey;
    if (sameBox && navigationType === 'REPLACE') return;
    capturePageview(location.pathname);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // The /dev console is a standalone admin surface — no app chrome, full width.
  const isDev = location.pathname.startsWith('/dev') || /^\/admin(?:\/|$)/.test(location.pathname);
  // The quiz setup screen gets tighter padding and vertical centering so it fits
  // one viewport.
  const isQuiz = location.pathname === '/quiz';
  // A live Challenge run takes the same focus mode as an active quiz (UX
  // audit U2, questions-07).
  const isChallenge = location.pathname === '/challenge';
  // A Learn level's questions (on a Learn section or Big O) take it too.
  const isLearn = location.pathname.startsWith('/learn');

  // One page width per route (UX audit U1, #573), from the one map in
  // components/ui/pageWidth.ts: home, /profile and /play 1000px, /coding/*
  // 1200px, /dev uncapped and every other route 800px. Pages never set their
  // own page max-width. A part that needs the wide page while it is mounted (a
  // Learn or FDE coding phase, coding-03) carries the class ss-wide-page, and
  // the route box widens through CSS (.ss-route:has(.ss-wide-page)).
  const pageWidth = pageMaxWidth(location.pathname);

  // 1–5 shark fins on the footer ocean line, at random (non-overlapping) spots
  // each page load, each independently facing left or right so the school
  // isn't all swimming the same way. Each fin also drifts sideways extremely
  // slowly (a whole crossing takes 1–2 minutes), with a random duration and
  // phase so no two fins ever move in sync.
  const fins = useMemo<{ left: number; flip: boolean; driftS: number; delayS: number }[]>(() => {
    const count = 1 + Math.floor(Math.random() * 5); // 1..5 inclusive
    const minGap = 10;
    const out: { left: number; flip: boolean; driftS: number; delayS: number }[] = [];
    let tries = 0;
    while (out.length < count && tries < 400) {
      tries += 1;
      const pos = 6 + Math.random() * 88;
      if (out.every((f) => Math.abs(f.left - pos) >= minGap)) {
        out.push({
          left: pos,
          flip: Math.random() < 0.5,
          driftS: 70 + Math.random() * 50, // 70–120s per crossing
          delayS: -Math.random() * 60, // negative = start mid-swim
        });
      }
    }
    return out;
  }, []);
  const showChrome = !isDev && !(quizActive && (isQuiz || isChallenge || isLearn));

  // The first page of a visit renders in a transition, so it draws as soon as
  // its code and data are in, without React's 300 ms reveal throttle
  // (lib/routePreload.ts). What shows is the same: nothing for 200 ms, then
  // the loader, then the page.
  const booted = useFirstPageTransition();

  return (
    // One-screen shell: the app is exactly one viewport tall. Pages scroll
    // INSIDE <main>, so the header and the ocean footer (waterline + fins) are
    // always visible. `dvh` tracks the collapsing mobile URL bar.
    <div className="ss-app-root" data-chrome={showChrome}>
      <a
        href="#main-content"
        className="ss-skip-link"
        // Arriving by skip link is the one case where <main> should show a focus
        // ring; route-change focus (below) clears the flag so the ring never
        // appears on plain page loads.
        onClick={() => document.getElementById('main-content')?.setAttribute('data-skip-target', 'true')}
      >
        {t('common.skipToContent')}
      </a>

      {showChrome && (
        <>
        <header className="ss-header">
          <div className="ss-toolbar">
            {/* Left slot: mobile menu + logo. Flex-basis 0 so all three slots
                share width equally, keeping the centre slot truly centred. */}
            <div className="ss-slot">
              {/* Nav links appear from 760px (tablets), not MUI's 900px `md`,
                  so a 768px iPad doesn't get a mostly-empty toolbar. */}
              <span className="ss-show-mobile" style={{ marginRight: 4 }}>
                <AxIconButton
                  variant="ghost"
                  size="lg"
                  label={t('nav.menu')}
                  onClick={() => setMobileNavOpen(true)}
                  icon={<MenuIcon />}
                />
              </span>
              <HeaderBrand />
            </div>

            {/* Centre slot: primary nav links, perfectly centred between logo
                and auth widget from 760px up. Below that, the drawer. */}
            <nav className="ss-nav-center">
              {primaryNavItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  replace={inBox(item.to)}
                  className="ss-navlink"
                  data-active={item.isActive(navPath)}
                  aria-current={item.isActive(location.pathname) ? 'page' : undefined}
                >
                  {t(item.key)}
                </Link>
              ))}
            </nav>

            {/* Right slot: Leaderboard + Premium + Shop icons, sound/theme toggles, and
                the auth widget. On mobile the sound/theme toggles live in the
                nav drawer (not here), so they never crowd the account avatar. */}
            <div className="ss-slot ss-slot-end">
              {/* Icon links to the non-learning surfaces. Hidden below 760px —
                  the drawer covers them there. 44×44 like every other page
                  control, with 20px glyphs and 4px apart (UX audit
                  shell-public-10): they were 28px ghost buttons 2px apart
                  beside a 56px account widget. */}
              {signedIn && (
                <span className="ss-show-desktop" style={{ alignItems: 'center', gap: 4 }}>
                  {showLeaderboardIcon && (
                    <AxIconButton
                      variant="ghost"
                      size="lg"
                      label={t('nav.leaderboard')}
                      tooltip={t('nav.leaderboard')}
                      onClick={() => navigate('/leaderboard')}
                      data-route="/leaderboard"
                      icon={<TrophyIcon size={20} />}
                    />
                  )}
                  <AxIconButton
                    variant="ghost"
                    size="lg"
                    label={t(membership.tier === 'premium' ? 'nav.premiumMember' : 'nav.premium')}
                    tooltip={t('nav.premium')}
                    onClick={() => navigate('/premium')}
                    data-route="/premium"
                    icon={<PremiumNavIcon member={membership.tier === 'premium'} />}
                  />
                  <AxIconButton
                    variant="ghost"
                    size="lg"
                    label={t('nav.shop')}
                    tooltip={t('nav.shop')}
                    onClick={() => navigate('/shop')}
                    data-route="/shop"
                    icon={<CoinsIcon />}
                  />
                </span>
              )}
              {/* The header draws at its final height in its first frame. A
                  signed-out visitor, known at the first render, gets the
                  sign-in button with the shell. The 56px placeholder, the
                  height of the avatar row and of the widget's own skeleton,
                  is only for a session: under it a signed-out header stood
                  73px tall and shrank to 57px (61px on touch) when the chunk
                  landed, pulling <main> up with it. A widget whose chunk
                  fails leaves a retry in the same 56px row, and the header
                  stays. On a desktop the account's slot is as wide as the
                  widget can grow (.ss-account-slot), so the centred nav stands
                  still when the placeholder, the skeleton and the name arrive
                  one after another. */}
              {user || authLoading ? (
                <span className="ss-account-slot">
                  <Suspense fallback={<span aria-hidden style={{ width: 56, height: 56, flexShrink: 0 }} />}>
                    <ShellPartBoundary fallback={(retry, busy) => <AccountRetry retry={retry} busy={busy} />}>
                      <AuthButton />
                    </ShellPartBoundary>
                  </Suspense>
                </span>
              ) : (
                <SignInButton />
              )}
            </div>
          </div>
        </header>
        <AnimatePresence>
        {mobileNavOpen && (
          <m.div className="ss-show-mobile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <div className="ss-drawer-backdrop" onClick={() => setMobileNavOpen(false)} />
            <m.div
              ref={drawerRef}
              className="ss-drawer-panel"
              initial={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
              animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
              transition={reduceMotion ? { duration: 0.12 } : { type: 'spring', stiffness: 440, damping: 42 }}
              role="dialog"
              aria-modal="true"
              aria-label={t('nav.menuTitle')}
              tabIndex={-1}
              onClick={() => setMobileNavOpen(false)}
            >
              <button
                type="button"
                className="ss-drawer-close"
                aria-label={t('common.dismiss')}
                onClick={(event) => {
                  event.stopPropagation();
                  setMobileNavOpen(false);
                }}
              >
                <CloseIcon size={20} />
              </button>
              <Link
                to="/"
                aria-label={t('nav.home', { brand: CURRENT_PRODUCT.brand })}
                className="ss-drawer-brand"
                style={{ color: 'var(--brand-accent)' }}
              >
                <BrandLogo height={20} />
              </Link>
              <div style={{ height: 1, background: 'var(--color-border)' }} />
              {/* Practice, then You, each under a small label (UX audit
                  shell-public-15). Both always hold links: Learn and Quiz,
                  Career and Premium are shown to everyone. */}
              {[0, 1].map((you) => {
                const label = t(you ? 'nav.groupYou' : 'nav.groupPractice');
                return (
                <div key={you} className="ss-drawer-group" role="group" aria-label={label}>
                  <p className="ss-drawer-group__label" aria-hidden="true">{label}</p>
                  {navItems.filter((item) => !item.you === !you).map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      replace={inBox(item.to)}
                      className="ss-drawer-link"
                      data-active={item.isActive(navPath)}
                      aria-current={item.isActive(location.pathname) ? 'page' : undefined}
                    >
                      {t(item.key)}
                    </Link>
                  ))}
                </div>
                );
              })}
              {/* The appearance and sound toggles, pinned to the drawer's
                  bottom: below the nav breakpoint the footer's pair hides,
                  so they are not buried under a long page behind the open
                  drawer. Pressing one keeps the drawer open. */}
              <div className="ss-drawer-settings" role="group" aria-label={t('profile.preferences')} onClick={(event) => event.stopPropagation()}>
                <SettingsToggles className="ss-drawer-link" />
              </div>
            </m.div>
          </m.div>
        )}
        </AnimatePresence>
        </>
      )}

      {/* The cookie banner sits right before <main> in the document: the
          page focuses <main> on load, so one Shift+Tab reaches the banner,
          and a screen reader reads it before the page. CSS shows it under
          <main>. */}
      <CookieConsent showBanner={showChrome} />

      <main
        id="main-content"
        tabIndex={-1}
        onBlur={(e) => e.currentTarget.removeAttribute('data-skip-target')}
        style={{
          // The ONLY scroll container in the app: pages taller than the
          // viewport scroll here, keeping the chrome + ocean footer in place.
          flex: 1,
          minHeight: 0,
          // WebKit does not consistently reserve a stable gutter with auto.
          // Keep the lane present as question heights change within a run.
          overflowY: 'scroll',
          overflowX: 'hidden',
          // Reserve the scrollbar lane even on short pages, so content never
          // shifts sideways when navigating between scrolling and
          // one-viewport sections.
          scrollbarGutter: 'stable',
          display: 'flex',
          justifyContent: 'center',
          // Every route keeps the contract's 16px gutter on phones; the
          // Quiz, the Challenge and a live Learn level only trim their desktop top padding, where
          // their focus mode hides the header (UX audit U2, questions-18 and
          // questions-07), so a question starts at one y in both.
          padding: isDev
            ? (mobile ? '0.5rem' : '0.5rem 1rem')
            : '1.5rem var(--ss-page-gutter)',
          boxSizing: 'border-box',
        }}
      >
        {/* minHeight 100% + flex column: normal pages take their natural height
            (and scroll within <main>); question screens (quiz/challenge/lesson)
            set flex:1 on their root to fill EXACTLY one viewport, keeping the
            answers anchored in a stable position with no page scroll.
            The bottom reserve that clears the floating ocean overlay (30px of
            waterline + fins, plus ≥12px of air) lives HERE and not as the
            scroll container's padding: a scroll container's own bottom padding
            is not preserved below overflowing children, so tall centred cards
            used to end up underneath the waterline. This wrapper grows with
            its content, so the reserve always sits below the last card. */}
        <div
          style={{
            // Full width: the route box and the footer below it each set
            // their own box (the route's page width, read by .ss-route, and
            // the header's 1168px), so the footer no longer moves with the
            // route width.
            ['--ss-page-width' as string]: pageWidth,
            width: '100%',
            minWidth: 0,
            minHeight: '100%',
            // flex-start, not the default stretch: stretch pins the wrapper to
            // the viewport height as a DEFINITE size, so tall pages overflowed
            // it and the bottom reserve never ended up below the content.
            alignSelf: 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            paddingBottom: isDev ? undefined : '2.75rem',
          }}
        >
          {/* Route transition: the new view fades in over a stable backdrop —
              no exit phase, so navigation never shows a blank beat. A page
              that opens with reduced motion loads no motion features, so its
              routes appear without the fade (lib/motion.tsx).
              The Suspense boundary sits OUTSIDE the keyed route box on
              purpose. Inside it, every pathname mounted a fresh boundary, and
              React shows a fresh boundary's fallback at once even in a
              transition: each first visit to a section blanked the page, pulled
              the footer up into view, flashed the loader for at least React's
              300ms reveal throttle and only then drew the page. Outside it, the
              boundary has already revealed content, so the router's transition
              keeps the current page until the next one can render whole. The
              first page of a visit gets the same: the box first draws the
              loader as content (`booted` false), and the page follows in a
              transition (useFirstPageTransition). The fallback is left for
              an update outside a transition that suspends.
              RouteErrorBoundary catches a page that fails, whether its code
              did not load or it threw. It sits inside this Suspense so that
              catching never unmounts the Suspense: a remounted one shows its
              fallback at once (the blank beat above), while this revealed one
              lets a transition keep the error panel up until Try again or the
              next page can draw. It sits inside the keyed box so that each
              path mounts a fresh boundary, and leaving a failed page needs no
              retry. It renders no element of its own, so the route box stays
              this wrapper's first child; the header, the nav and the footer
              stay outside it.
              The footer sits inside this Suspense too, after the keyed box, so
              it arrives with the first page. It keeps its own box, the
              header's (--ss-width-chrome), so it stands still from route to
              route whatever the page width (shell-public-01). Under the
              fallback it sat at the
              bottom of the empty box, and the landing page threw it below the
              fold: a move longer than the viewport, which scored 0.05 of CLS on
              a desktop and 0.15 on a phone, and 0.98 when the header settled in
              the same frame. */}
          <Suspense fallback={<div style={ROUTE_BOX_STYLE}><RouteLoader /></div>}>
            {!booted ? <div style={ROUTE_BOX_STYLE}><RouteLoader /></div> : <>
            <m.div
              key={boxKey}
              className="ss-route"
              // The page waiting for its successor (see `navigating` above).
              aria-busy={navigating || undefined}
              style={ROUTE_BOX_STYLE}
              {...ROUTE_ANIM}
              transition={ROUTE_TRANSITION}
            >
              {/* An active quiz or Challenge run hides the chrome; a page that fails brings it back. */}
              <RouteErrorBoundary onError={() => setQuizActive(false)}>
                <Routes location={location}>
                  <Route path="/" element={<Home />} />
                  <Route path="/quiz" element={<Quiz onActiveChange={setQuizActive} />} />
                  <Route path="/learn/:section?" element={<Roadmap onActiveChange={setQuizActive} />} />
                  <Route path="/big-o" element={<BigOPage />} />
                  <Route path="/learn/big-o" element={<BigOIntroduction onActiveChange={setQuizActive} />} />
                  <Route path="/today" element={<Today />} />
                  <Route path="/collection" element={<Collection />} />
                  <Route path="/typing" element={<TypingRacer />} />
                  <Route path="/roadmap" element={<CareerRoadmap />} />
                  <Route path="/coding" element={<CodingHome />} />
                  <Route path="/coding/review" element={<CodingReviewScreen />} />
                  <Route path="/coding/fullstack" element={<FullStackScreen />} />
                  <Route path="/coding/:track" element={<CodingTrackScreen />} />
                  <Route path="/coding/:track/:taskId" element={<CodingTaskScreen />} />
                  {/* Learning paths are devShark-only, like /coding and /roadmap.
                      The FDE path lives in its Learn section (#489); its old
                      addresses redirect. E5 (#496) retired the DSA Foundations
                      path: its old addresses land on the DSA topic of Software
                      Engineer, as vercel.json's 308 does for crawlers. */}
                  <Route path={FDE_PATH} element={FDE_SECTION_VISIBLE ? <FdeOverview /> : <Navigate to="/learn/web-developer" replace />} />
                  <Route path={`${FDE_PATH}/:moduleId`} element={FDE_SECTION_VISIBLE ? <FdeModule /> : <Navigate to="/learn/web-developer" replace />} />
                  {!FDE_SECTION_VISIBLE && <Route path="/learn/forward-deployed-engineer/*" element={<Navigate to="/learn/web-developer" replace />} />}
                  <Route path="/roadmap/specializations/fde/*" element={<OldFdePathRedirect />} />
                  <Route path="/roadmap/paths/dsa-foundations/*" element={<Navigate to="/learn/software-engineer?topic=dsa" replace />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/settings/github" element={<GithubSettingsPage />} />
                  <Route path="/leaderboard" element={<Leaderboard />} />
                  <Route path="/cards" element={<Flashcards />} />
                  <Route path="/shop" element={<Shop />} />
                  <Route path="/play" element={<PlayLanding />} />
                  <Route path="/play/:code" element={<PlayMatch />} />
                  <Route path="/challenge" element={<Challenge onActiveChange={setQuizActive} />} />
                  {/* The voluntary-support page is retired (#222): Premium replaced it. */}
                  <Route path="/support" element={<Navigate to="/premium" replace />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/premium" element={<PremiumPage />} />
                  <Route path="/premium/success" element={<PremiumSuccessPage />} />
                  <Route path="/premium/checkout" element={<PremiumCheckoutPage />} />
                  <Route path="/premium/cancel" element={<PremiumCancelPage />} />
                  {/* Where the confirmation and password-reset emails land. */}
                  <Route path="/auth/confirmed" element={<EmailConfirmedPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/daily" element={<DailyQuestionPage />} />
                  <Route path="/daily/:date" element={<DailyQuestionPage />} />
                  <Route path="/classroom" element={<ClassroomPage />} />
                  <Route path="/topics/:slug" element={<TopicLandingPage />} />
                  <Route path="/admin/:section?" element={<AdminPage />} />
                  <Route path="/dev" element={<DevPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </RouteErrorBoundary>
            </m.div>
            {showChrome && <BrandFooter />}
            </>}
          </Suspense>
        </div>
      </main>

      {/* The ocean: pinned to the bottom of the fixed-height shell, so the
          waterline + surfacing fins are visible on every page, always. Hidden
          only in the /dev admin console. */}
      {!isDev && (
        <div
          aria-hidden
          // Transparent overlay pinned to the shell bottom (not a layout band):
          // the wave + fins float over whatever is behind them, so there is no
          // solid background strip. Content scrolls beneath; pointer-events off.
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 30, zIndex: 1, overflow: 'hidden', pointerEvents: 'none' }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8 }}>
            <Waterline />
          </div>
          {fins.map((fin, i) => (
            <div
              key={i}
              style={{ position: 'absolute', bottom: 7, left: `${fin.left}%`, transform: 'translateX(-50%)', lineHeight: 0 }}
            >
              {/* Slow sideways drift — ±22px over 70–120s, so the motion sits
                  right at the edge of perception (keyframes in app-shell.css). */}
              <div
                className="ss-fin-drift"
                style={{
                  animation: `ssFinDrift ${fin.driftS}s ease-in-out ${fin.delayS}s infinite alternate`,
                  lineHeight: 0,
                }}
              >
                {/* scaleX(-1) mirrors the fin so it swims the other way. */}
                <div style={{ transform: fin.flip ? 'scaleX(-1)' : 'none', lineHeight: 0 }}>
                  <SwimmingFin size={20} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <XpToaster />
      <ConnectionStatus />
      <UpgradeSheetHost />
      <SignInDialogHost />
      <RegisterPromptSnackbar />
      <ReferralBinder />
      <PendingQuizResults />
      <AppToast
        open={signupBonusOpen}
        onClose={() => setSignupBonusOpen(false)}
        severity="success"
        autoHideDuration={6000}
        message={t('auth.signupBonusToast', { tokens: wallet.data?.welcome?.coins ?? 0, brand: CURRENT_PRODUCT.brand })}
      />
      <AppToast open={draftsKept} onClose={dismissDraftsKept} autoHideDuration={10000} message={t('auth.signedOutKept')} />
      <AppToast
        open={resumeFailedOpen}
        onClose={closeResumeFailed}
        severity="error"
        autoHideDuration={8000}
        message={t('auth.signInFailed')}
      />
    </div>
  );
}

export default App;
