import { Component, createRef, startTransition, type ErrorInfo, type ReactNode } from 'react';
import { reportBoundaryError } from './RouteErrorBoundary';
import {
  RELOAD_GRACE_MS,
  browserRecovery,
  isChunkLoadError,
  isStylesheetLoadError,
  reloadOnPress,
  renewFailedPages,
  type Recovery,
} from '../lib/routeRecovery';

interface Props {
  children: ReactNode;
  /** Drawn in the part's place after it failed. `retry` renders the part
   * again; `busy` is true while that press reloads the page. */
  fallback: (retry: () => void, busy: boolean) => ReactNode;
  /** Told once per failure. */
  onError?: (error: unknown) => void;
  /** The build check and the reload; tests pass their own. */
  recovery?: Recovery;
}

interface State {
  failed: boolean;
  error: unknown;
  /** The learner's retry is reloading the page. */
  busy: boolean;
}

/**
 * A boundary for one lazy part of the shell outside the route boundary: the
 * account widget, the upgrade sheet. Without it a part whose code did not
 * load took the whole app to the root error screen. Place it inside the
 * part's Suspense, as App.tsx places the route boundary, so a retry renders
 * in a transition and the fallback stays until the part can draw.
 *
 * Retry renders the part again with a fresh lazy component (lazyShellPart).
 * When the same chunk failure comes straight back, as it does in a browser
 * that remembers failed module fetches, that press reloads the page
 * (reloadOnPress). Nothing reloads without a press, and a part that threw is
 * only rendered again.
 */
export class ShellPartBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null, busy: false };
  private retried = false;
  private restoreFocus = false;
  private disposed = false;
  private graceTimer = 0;
  private box = createRef<HTMLSpanElement>();

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error, busy: false };
  }

  componentDidMount() {
    this.disposed = false;
  }

  componentWillUnmount() {
    this.disposed = true;
    window.clearTimeout(this.graceTimer);
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const retried = this.retried;
    this.retried = false;
    this.restoreFocus = false;
    const chunk = isChunkLoadError(error);
    reportBoundaryError(error, info.componentStack, chunk);
    // The failed part is off screen now, so it can be asked for afresh.
    renewFailedPages();
    this.props.onError?.(error);
    if (retried && chunk) void this.reload();
  }

  componentDidUpdate(_props: Props, previous: State) {
    // A retry drew the part: the retry button that held focus is gone, so
    // focus moves to the part's first control.
    if (!previous.failed || this.state.failed || !this.restoreFocus) return;
    this.restoreFocus = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    this.box.current?.querySelector<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')?.focus();
  }

  private async reload() {
    this.setState({ busy: true });
    const reloading = await reloadOnPress(this.props.recovery ?? browserRecovery);
    if (this.disposed) return;
    if (!reloading) {
      this.setState({ busy: false });
      return;
    }
    // Busy until the new document replaces this one; a refused reload (the
    // leave-page prompt) gives the button back.
    window.clearTimeout(this.graceTimer);
    this.graceTimer = window.setTimeout(() => {
      if (!this.disposed) this.setState({ busy: false });
    }, RELOAD_GRACE_MS);
  }

  private retry = () => {
    if (this.state.busy) return;
    // Vite retains failed CSS links. An in-place import could draw unstyled.
    if (isStylesheetLoadError(this.state.error)) {
      void this.reload();
      return;
    }
    renewFailedPages();
    this.retried = true;
    this.restoreFocus = Boolean(this.box.current?.contains(document.activeElement));
    startTransition(() => this.setState({ failed: false, error: null }));
  };

  render() {
    // `display: contents`: the box only lets the boundary find its part's
    // controls; the layout is the parent's, as without it.
    return (
      <span ref={this.box} style={{ display: 'contents' }}>
        {this.state.failed ? this.props.fallback(this.retry, this.state.busy) : this.props.children}
      </span>
    );
  }
}
