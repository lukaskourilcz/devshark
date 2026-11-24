// The bridge to the sandboxed React harness (client/sandbox). One iframe, one
// run at a time, every message tagged with the run's token: a late message
// from an earlier run is dropped, a run that says nothing within the budget
// is reported as timed out and the frame is reloaded.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MiniJestCase } from '../../../shared/coding-mini-jest';
import { cutErrorText } from '../../../shared/coding-error-text';

export const HARNESS_URL = '/sandbox/index.html';
const RUN_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 20_000;
/** Console lines are drawn at most this often. Each line arrives as its own
 * message, and a preview that logs in a loop or on every render would
 * otherwise redraw the whole workbench once per line. */
export const LOG_FLUSH_MS = 100;
/** The Console keeps the latest lines of a run. */
const MAX_HARNESS_LOGS = 200;

export interface HarnessRun {
  token: string;
  status: 'running' | 'compile-error' | 'done' | 'timeout';
  compileError: string | null;
  previewError: string | null;
  cases: MiniJestCase[];
  logs: { level: string; text: string }[];
  passed: number;
  failed: number;
  total: number;
  /** false when the run was preview-only. */
  ran: boolean;
}

export interface HarnessHandle {
  ready: boolean;
  /** The requested frame did not finish its readiness handshake in time. */
  loadFailed: boolean;
  run: HarnessRun | null;
  /** Compiles, optionally runs the suite, and renders the preview. */
  start: (files: Record<string, string>, options: { tests: boolean; preview: boolean }) => Promise<HarnessRun>;
  reload: () => void;
  iframeRef: (node: HTMLIFrameElement | null) => void;
  /** Changes on reload; use it as the iframe's React key so the frame remounts. */
  frameKey: number;
}

const newToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Frame messages are structured data, including objects with an unusable
// own toString. Keep errors displayable and use the grader's existing cut.
const frameErrorText = (value: unknown, fallback: string): string => {
  try { return cutErrorText(String(value ?? fallback)); }
  catch { return fallback; }
};

export function useReactHarness(): HarnessHandle {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [run, setRun] = useState<HarnessRun | null>(null);
  const pending = useRef<{ token: string; resolve: (run: HarnessRun) => void; timer: number } | null>(null);
  const current = useRef<HarnessRun | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const readyWaiters = useRef<((ready: boolean) => void)[]>([]);
  const readyRef = useRef(false);
  const readyTimer = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const logFlush = useRef<number | undefined>(undefined);

  // Draws the run as it stands, unless a terminal message drew it first.
  const flushLogs = useCallback(() => {
    if (logFlush.current === undefined) return;
    window.clearTimeout(logFlush.current);
    logFlush.current = undefined;
    if (current.current) setRun(current.current);
  }, []);

  // Every caller must settle, including callers waiting for the frame to boot.
  const cancel = useCallback(() => {
    flushLogs();
    window.clearTimeout(readyTimer.current);
    readyTimer.current = undefined;
    generation.current++;
    readyRef.current = false;
    readyWaiters.current.splice(0).forEach(resolve => resolve(false));
    if (pending.current) {
      window.clearTimeout(pending.current.timer);
      pending.current.resolve({ ...current.current!, token: pending.current.token, status: 'timeout' });
      pending.current = null;
    }
    current.current = null;
  }, [flushLogs]);

  const settle = useCallback((next: HarnessRun) => {
    window.clearTimeout(logFlush.current);
    logFlush.current = undefined;
    current.current = next;
    setRun(next);
    if (pending.current && pending.current.token === next.token && (next.status === 'done' || next.status === 'compile-error' || next.status === 'timeout')) {
      window.clearTimeout(pending.current.timer);
      pending.current.resolve(next);
      pending.current = null;
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: string; token?: string } & Record<string, unknown>;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'ready') {
        window.clearTimeout(readyTimer.current);
        readyTimer.current = undefined;
        setLoadFailed(false);
        readyRef.current = true;
        setReady(true);
        readyWaiters.current.splice(0).forEach((resolve) => resolve(true));
        return;
      }
      const active = current.current;
      if (!active || data.token !== active.token) return;
      switch (data.type) {
        case 'compiled':
          return;
        case 'compile-error':
          settle({ ...active, status: 'compile-error', compileError: frameErrorText(data.message, 'Compile error') });
          return;
        case 'test':
          settle({
            ...active,
            cases: [...active.cases, { name: String(data.name), status: data.status === 'pass' ? 'pass' : 'fail', error: data.error == null ? null : frameErrorText(data.error, 'Error'), durationMs: Number(data.durationMs ?? 0) }],
          });
          return;
        case 'console':
          // Kept at once, so a result that settles next carries the line;
          // drawn with the lines that follow it.
          current.current = { ...active, logs: [...active.logs, { level: String(data.level), text: String(data.text) }].slice(-MAX_HARNESS_LOGS) };
          if (logFlush.current === undefined) logFlush.current = window.setTimeout(flushLogs, LOG_FLUSH_MS);
          return;
        case 'preview-error': {
          const previewError = frameErrorText(data.message, 'Render error');
          // WebKit can report an opaque ErrorEvent after the frame has already
          // sent a detailed error for this run.
          if (previewError === 'Script error.' && active.previewError) return;
          settle({ ...active, previewError });
          return;
        }
        case 'done':
          // The frame closes a build error with an empty `done`; the error is
          // the result, so the count of no cases must not replace it.
          if (active.status === 'compile-error') return;
          settle({ ...active, status: 'done', passed: Number(data.passed ?? 0), failed: Number(data.failed ?? 0), total: Number(data.total ?? 0), ran: data.ran !== false });
          return;
        default:
      }
    };
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); cancel(); };
  }, [cancel, settle, flushLogs]);

  const restart = useCallback((clearRun: boolean) => {
    cancel();
    setReady(false);
    setLoadFailed(false);
    if (clearRun) setRun(null);
    setFrameKey((k) => k + 1);
  }, [cancel]);
  const reload = useCallback(() => restart(true), [restart]);

  const waitReady = useCallback(() => new Promise<boolean>((resolve) => {
    if (readyRef.current && frame.current?.contentWindow) return resolve(true);
    const finish = (value: boolean) => {
      window.clearTimeout(timer);
      readyWaiters.current = readyWaiters.current.filter(waiter => waiter !== finish);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(false), READY_TIMEOUT_MS);
    readyWaiters.current.push(finish);
  }), []);

  const start = useCallback(async (files: Record<string, string>, options: { tests: boolean; preview: boolean }): Promise<HarnessRun> => {
    const token = newToken();
    const epoch = ++generation.current;
    readyWaiters.current.splice(0).forEach(resolve => resolve(false));
    const base: HarnessRun = { token, status: 'running', compileError: null, previewError: null, cases: [], logs: [], passed: 0, failed: 0, total: 0, ran: options.tests };
    current.current = base;
    setRun(base);
    if (pending.current) {
      window.clearTimeout(pending.current.timer);
      pending.current.resolve({ ...base, token: pending.current.token, status: 'timeout' });
      pending.current = null;
    }
    // Give an already mounted test frame focus during Run or Submit. In
    // Chromium an opaque child cannot move focus from the workbench into
    // its fields on its own. The caller restores the originating control.
    if (options.tests && readyRef.current) frame.current?.focus({ preventScroll: true });
    const isReady = await waitReady();
    if (epoch !== generation.current) return { ...base, status: 'timeout' };
    const target = frame.current?.contentWindow;
    if (!isReady || !target) {
      const timedOut: HarnessRun = { ...base, status: 'timeout' };
      settle(timedOut);
      return timedOut;
    }
    return new Promise<HarnessRun>((resolve) => {
      const timer = window.setTimeout(() => {
        const timedOut: HarnessRun = { ...(current.current ?? base), status: 'timeout' };
        settle(timedOut);
        // The new frame is a recovery step; retain the completed result so
        // the workbench still explains why the code stopped.
        restart(false);
      }, RUN_TIMEOUT_MS);
      pending.current = { token, resolve, timer };
      target.postMessage({ type: 'run', token, files, preview: options.preview, tests: options.tests }, '*');
    });
  }, [restart, settle, waitReady]);

  const iframeRef = useCallback((node: HTMLIFrameElement | null) => {
    window.clearTimeout(readyTimer.current);
    readyTimer.current = undefined;
    frame.current = node;
    readyRef.current = false;
    setReady(false);
    setLoadFailed(false);
    if (node) {
      readyTimer.current = window.setTimeout(() => {
        readyTimer.current = undefined;
        if (frame.current === node && !readyRef.current) setLoadFailed(true);
      }, READY_TIMEOUT_MS);
    }
  }, []);

  return useMemo(() => ({ ready, loadFailed, run, start, reload, iframeRef, frameKey }), [ready, loadFailed, run, start, reload, iframeRef, frameKey]);
}
