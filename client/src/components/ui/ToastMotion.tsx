import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { reportError } from '../../lib/sentry';

type Animation = typeof import('./toastAnimation');
type Kind = 'app' | 'xp';
let animation: Animation | undefined;
let requested: Promise<void> | undefined;

function requestAnimation() {
  requested ??= import('./toastAnimation')
    .then((module) => { animation = module; })
    .catch((error: unknown) => { reportError(error, { chunkLoad: true, toastMotion: true }); });
}

function animateSafely(run: () => () => void, card: HTMLElement, pop?: HTMLElement | null) {
  try {
    return run();
  } catch (error) {
    card.style.opacity = '1';
    card.style.transform = 'none';
    if (pop) {
      pop.style.opacity = '1';
      pop.style.transform = 'none';
    }
    reportError(error, { toastMotion: true });
  }
}

/** The message stays in the same DOM node while optional animation code loads.
 * A cold card stays static; later cards can animate without replacing content
 * or stealing focus from a dismiss button. Timers never depend on this chunk. */
export function ToastMotion({ open, kind, onExited, style, children }: {
  open: boolean;
  kind: Kind;
  onExited?: () => void;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const card = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const latest = useRef({ reduce, onExited });
  useLayoutEffect(() => { latest.current = { reduce, onExited }; }, [reduce, onExited]);

  useLayoutEffect(() => {
    if (!open || !card.current) return;
    if (reduce) {
      card.current.style.transform = 'none';
      if (pop.current) pop.current.style.transform = 'none';
    }
    // Never hide an already visible cold card when its import resolves.
    if (animation) {
      const element = card.current;
      return animateSafely(() => animation!.enter(element, pop.current, kind, reduce), element, pop.current);
    }
    if (!reduce) requestAnimation();
  }, [open, kind, reduce]);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const element = card.current;
    const stop = element && animation && animateSafely(() => animation!.exit(element, kind, latest.current.reduce), element);
    // Keep the original exit gap even if loading or animation fails.
    const timer = window.setTimeout(() => {
      setPresent(false);
      latest.current.onExited?.();
    }, kind === 'app' ? 220 : 200);
    return () => {
      window.clearTimeout(timer);
      stop?.();
    };
  }, [open, present, kind]);

  if (!open && !present) return null;
  return <div ref={card} style={style}>{kind === 'xp' ? <div ref={pop}>{children}</div> : children}</div>;
}
