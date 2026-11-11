import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
// Global reset (replaces MUI's CssBaseline) + the Astryx design-system
// foundation (component CSS + themed tokens). Reset first so its base layer
// sits under the component styles.
import './styles/reset.css';
import './styles/astryx-theme.css';
// Apply the application design before the first paint.
document.documentElement.dataset.design = 'apple';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { preloadPath } from './lib/routePreload';
import { ColorModeProvider } from './theme/ColorModeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LanguageProvider } from './i18n/LanguageContext';
import { AuthProvider } from './lib/auth';
import { prefetchStoredAccountPlan } from './lib/entitlement';
import { queryClient } from './lib/queryClient';
import { initSentry } from './lib/sentry';
import { initAnalytics } from './lib/analytics';
import { MARKETING_LOADERS } from './lib/marketingTags';
import { MotionProvider } from './lib/motion';
import { captureReferralFromUrl } from './lib/referral';
import { installChunkErrorTracking } from './lib/routeRecovery';
import { capturePublicGuide } from './lib/publicGuideHandoff';
import { flushQuestXpBeacon } from './lib/xp';

// Cosmetic scroll feedback can load after the interactive entry.
const scrollbarReady = import('./lib/scrollbarActivity').then(({ installScrollbarActivity }) => installScrollbarActivity()).catch(() => () => {});
if (import.meta.hot) import.meta.hot.dispose(() => { void scrollbarReady.then(dispose => dispose()); });
// Before anything imports a chunk: the route boundary tells a chunk that did
// not load from a page that threw by the errors Vite announced.
const disposeChunkErrorTracking = installChunkErrorTracking();
if (import.meta.hot) import.meta.hot.dispose(disposeChunkErrorTracking);

// Error/performance reporting (no-op without a DSN). Errors are caught from
// here on; the SDK itself loads once the page is idle, or on the first error
// (lib/sentry.ts).
initSentry();
// PostHog product analytics, only after the visitor's yes to analytics in the
// cookie banner (lib/consent.ts). Before it the SDK is not downloaded and
// nothing is stored or sent; a no removes what an older build stored.
initAnalytics();
// GA4 and the Meta Pixel are not connected. Once a loader exists, its code
// and Google Consent Mode load here and start only after a yes to marketing
// (lib/marketing.ts says how to connect one).
if (MARKETING_LOADERS.length > 0) void import('./lib/marketing').then(({ installMarketing }) => installMarketing());
// Keep an invite code (`/?ref=<code>`, #228) and take it out of the address
// bar before the router reads the URL. The server binds it after sign-in.
captureReferralFromUrl();
// Flush the debounced XP write when the browser hides the document.
window.addEventListener('pagehide', flushQuestXpBeacon);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushQuestXpBeacon();
});

// React Query devtools, dev-only: the dynamic import lives in a DEV-gated branch
// so it (and the dependency) is dropped from the production bundle entirely.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })),
    )
  : null;

capturePublicGuide();
// A returning learner's plan, asked now rather than once the header and the
// page have rendered and auth has restored the user (lib/entitlement.ts).
prefetchStoredAccountPlan();
// The first page's code, asked now: App renders it in a transition after its
// first commit (lib/routePreload.ts useFirstPageTransition), and the import
// it then runs is this one.
void preloadPath(window.location.pathname);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <LanguageProvider>
              <ColorModeProvider>
                <MotionProvider>
                  <App />
                </MotionProvider>
              </ColorModeProvider>
            </LanguageProvider>
          </BrowserRouter>
        </AuthProvider>
        {ReactQueryDevtools && (
          <Suspense fallback={null}>
            <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
          </Suspense>
        )}
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
