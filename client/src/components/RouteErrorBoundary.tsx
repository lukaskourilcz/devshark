import { Component, createRef, startTransition, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ErrorPanel } from './ErrorBoundary';
import { translateShell } from '../i18n/LanguageContext';
import { reportError } from '../lib/sentry';
import {
  RELOAD_GRACE_MS,
  browserRecovery,
  isChunkLoadError,
  isOnline,
  isStylesheetLoadError,
  reloadPage,
  renewFailedPages,
  takeBuildCheck,
  type Recovery,
} from '../lib/routeRecovery';

/** What rendered the page when it failed: a visit, the learner's Try again,
 * or the connection coming back. */
type Attempt = 'visit' | 'retry' | 'online';

interface Props {
  children: ReactNode;
  /** Told when the error replaces the page. */
  onError?: () => void;
  /** The build check and the reload; tests pass their own. */
  recovery?: Recovery;
}

interface State {
  failed: boolean;
  error: unknown;
  /** Checking the server, rendering the page again, or reloading. */
  busy: boolean;
}

// One report per failed chunk per page load: a learner pressing Try again, or
// a connection that keeps dropping, is still one failure. A preload started
// by a hover never reaches this boundary, so it is never reported. The shell's
// own boundary (ShellPartBoundary) reports through this too.
const reportedChunkFailures = new Set<string>();

export function reportBoundaryError(error: unknown, componentStack: string | null | undefined, chunk: boolean) {
  if (chunk) {
    const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (reportedChunkFailures.has(key)) return;
    reportedChunkFailures.add(key);
  }
  reportError(error, chunk ? { componentStack, chunkLoad: true } : { componentStack });
}

/**
 * The error state of the routed page, drawn inside the shell: the header, the
 * nav and the footer stay, and the learner can go anywhere else. App.tsx
 * places it inside the keyed route box, so each path starts with a fresh
 * boundary.
 *
 * A page whose code failed to load gets it back three ways. A newer build on
 * the server reloads at once (lib/routeRecovery.ts checks before the error
 * shows). Try again renders the page again in place; when the same failure
 * comes straight back, as it does in a browser that remembers failed module
 * fetches, Try again reloads the address. Offline, the panel waits and tries
 * again when the connection returns. Any other error keeps the root screen's
 * two choices: render again, or reload.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null, busy: false };
  private attempt: Attempt = 'visit';
  private panel = createRef<HTMLDivElement>();
  private disposed = false;
  private graceTimer = 0;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error, busy: false };
  }

  componentDidMount() {
    this.disposed = false;
  }

  componentWillUnmount() {
    this.disposed = true;
    window.removeEventListener('online', this.onOnline);
    window.clearTimeout(this.graceTimer);
  }

  componentDidUpdate(_props: Props, previous: State) {
    // A retry drew the page: whatever fails next is a new failure.
    if (previous.failed && !this.state.failed) this.attempt = 'visit';
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const attempt = this.attempt;
    this.attempt = 'visit';
    const chunk = isChunkLoadError(error);
    reportBoundaryError(error, info.componentStack, chunk);
    // The failed page is off screen now, so it can be asked for afresh the
    // next time it renders: a retry, or a later visit.
    renewFailedPages();
    this.props.onError?.();
    this.keepFocus();
    if (!chunk) return;
    window.addEventListener('online', this.onOnline);
    void this.recover(error, attempt);
  }

  private get recovery(): Recovery {
    return this.props.recovery ?? browserRecovery;
  }

  /**
   * After a chunk failed. A visit reloads only when the server has a newer
   * build; otherwise the panel offers Try again. A retry, pressed or made
   * because the connection came back, has already asked again in place and
   * failed, so the browser remembers the failure or the file is gone: a
   * reload is what is left, as long as the server answers. The learner's
   * press reloads every time; the automatic ones are rationed.
   */
  private async recover(error: unknown, attempt: Attempt) {
    if (!isOnline()) return;
    let check = takeBuildCheck(error);
    if (!check) {
      this.setState({ busy: true });
      check = await this.recovery.checkServedBuild();
      if (this.disposed || this.state.error !== error) return;
    }
    const reloading =
      check !== 'unreachable' &&
      (attempt === 'retry'
        ? reloadPage(false, this.recovery.reload)
        : (check === 'newer' || attempt === 'online') && reloadPage(true, this.recovery.reload));
    this.setState({ busy: reloading });
    if (!reloading) return;
    // Busy until the new document replaces this one. A refused reload (the
    // leave-page prompt) gives the button back.
    window.clearTimeout(this.graceTimer);
    this.graceTimer = window.setTimeout(() => {
      if (!this.disposed) this.setState({ busy: false });
    }, RELOAD_GRACE_MS);
  }

  /** Render the page again. In a transition, so the panel stays until the page
   * can draw whole or fails again. */
  private renderAgain(attempt: Attempt) {
    window.removeEventListener('online', this.onOnline);
    renewFailedPages();
    this.attempt = attempt;
    this.setState({ busy: true });
    startTransition(() => this.setState({ failed: false, error: null, busy: false }));
  }

  private retry = () => {
    const { error, busy } = this.state;
    if (busy) return;
    // Rendered again, the page would draw without its stylesheet.
    if (isStylesheetLoadError(error)) void this.recover(error, 'retry');
    else this.renderAgain('retry');
  };

  private onOnline = () => {
    const { failed, error, busy } = this.state;
    if (!failed || busy || !isChunkLoadError(error)) return;
    if (isStylesheetLoadError(error)) void this.recover(error, 'online');
    else this.renderAgain('online');
  };

  /** The page that held focus is gone: continue from the panel. A navigation
   * still moves focus to <main> after it (App.tsx), as on every route. */
  private keepFocus() {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) this.panel.current?.focus({ preventScroll: true });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { error, busy } = this.state;
    const chunk = isChunkLoadError(error);
    return (
      <ErrorPanel
        ref={this.panel}
        busy={busy}
        title={translateShell('error.somethingWrong')}
        body={translateShell(chunk ? 'error.network' : 'error.boundaryBody')}
        // The route box is a flex column; the panel takes the page's place.
        style={{ flex: 1, minHeight: 'auto', padding: '24px 0' }}
        actions={
          chunk ? (
            // Interruptible: busy but not disabled, so it keeps keyboard focus.
            <Button variant="primary" label={translateShell('error.tryAgain')} isLoading={busy} isInterruptible onClick={this.retry} />
          ) : (
            <>
              <Button variant="secondary" label={translateShell('error.tryAgain')} onClick={this.retry} />
              <Button variant="primary" label={translateShell('error.reloadPage')} onClick={() => this.recovery.reload()} />
            </>
          )
        }
      />
    );
  }
}
