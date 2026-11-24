import { Component, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { reportError } from '../lib/sentry';
// The boundary may catch a crash inside the LanguageProvider itself, so it
// uses the non-React translateShell (shared dictionaries, no context).
import { translateShell } from '../i18n/LanguageContext';

interface PanelProps {
  title: string;
  body: string;
  /** The buttons under the text. */
  actions: ReactNode;
  /** While the panel is working for the learner (a check, a retry), so the
   * alert is announced once it settles. */
  busy?: boolean;
  /** Merged onto the outer box: the root screen takes 60% of the viewport,
   * the route panel the space the page would have taken. */
  style?: CSSProperties;
  /** The card, focusable from script so focus can land on it. */
  ref?: Ref<HTMLDivElement>;
}

/** The error card: a heading, one line of text and its actions, announced as
 * an alert. The root screen below and the route boundary share it. */
export function ErrorPanel({ title, body, actions, busy, style, ref }: PanelProps) {
  return (
    <div
      role="alert"
      aria-busy={busy || undefined}
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        ...style,
      }}
    >
      <div
        ref={ref}
        tabIndex={ref ? -1 : undefined}
        style={{
          padding: 32,
          maxWidth: 480,
          textAlign: 'center',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--color-background-surface)',
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <Heading level={3} justify="center">
            {title}
          </Heading>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Text type="body" color="secondary">
            {body}
          </Text>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>{actions}</div>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    reportError(error, { componentStack: info.componentStack });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <ErrorPanel
        title={translateShell('error.somethingWrong')}
        body={translateShell('error.boundaryBody')}
        actions={
          <>
            <Button onClick={this.handleReset} variant="secondary" label={translateShell('error.tryAgain')} />
            <Button onClick={() => window.location.reload()} variant="primary" label={translateShell('error.reloadPage')} />
          </>
        }
      />
    );
  }
}
