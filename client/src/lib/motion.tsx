// Motion (motion.dev, MIT) primitives - shared, bundle-conscious, and
// reduced-motion aware.
//
// Bundle discipline: we use the `m` component + LazyMotion in `strict` mode so
// the heavy DOM-animation feature set is *code-split and fetched lazily* on
// first paint rather than shipped in the initial bundle. `strict` bans the full
// `motion.*` components (which would silently pull the whole engine back in), so
// the whole app stays on the lean `m.*` path.
//
// Accessibility: every helper honours `prefers-reduced-motion` - transforms are
// dropped and only a short opacity fade remains (or nothing), so vestibular
// users don't get movement they didn't ask for. A page that opens with reduced
// motion loads no animation features at all, and its elements simply appear.

import { LazyMotion, m as motionM, AnimatePresence, useReducedMotion } from 'motion/react';
import { createElement, useCallback, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { reportError } from './sentry';

// Fetch only the DOM animation features, and only when needed. The `m`
// component + LazyMotion core are tiny; the feature bundle loads in the
// background so it's off the critical path. Imported via a dedicated wrapper
// module (not 'motion/react' directly) so Rollup actually code-splits it out;
// see lib/motion-features for why.
//
// When that chunk does not load, no `m` element ever leaves its `initial`
// style, and every one here starts at opacity 0: the page would stay
// invisible under a working header. So a failed load marks the document
// (`<html data-motion="off">`), and app-shell.css shows each `m` element as
// its animation ends, without the animation. Every `m` element in the app
// enters to full opacity and no transform, and this module gives each a
// `data-m` attribute for that rule. Reduced motion at page load takes the
// same path without loading the chunk (motionFeaturesFor below).
type Features = typeof import('./motion-features').default;

/** Load the features, or mark the document when their chunk does not load.
 * The failure is reported once and never reaches LazyMotion, which has no
 * handler for it; the load then stays pending and nothing animates. */
export function loadMotionFeatures(
  load: () => Promise<Features> = () => import('./motion-features').then((mod) => mod.default),
): Promise<Features> {
  return load().catch((error: unknown) => {
    document.documentElement.dataset.motion = 'off';
    reportError(error, { chunkLoad: true, motionFeatures: true });
    return new Promise<Features>(() => undefined);
  });
}

/**
 * The features for this page load. A reader who asked for reduced motion
 * when the page opened gets none (perf baseline #587 C18): the 14 KB chunk
 * stayed in every page's boot window only to run 120 ms fades. The document
 * is marked as when the chunk fails, so app-shell.css shows every `m` element
 * at once, at its final opacity and without a transform, and an exiting one
 * leaves at once. A preference changed later takes effect on the next load.
 */
export function motionFeaturesFor(
  reduced: boolean,
  load?: () => Promise<Features>,
): Promise<Features> {
  if (!reduced) return loadMotionFeatures(load);
  document.documentElement.dataset.motion = 'off';
  return new Promise<Features>(() => undefined);
}

/** Lazy consumers own their features. A cold modal can stay static and usable
 * until the loader signals readiness instead of waiting in an initial pose. */
export function MotionProvider({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  const loadFeatures = useCallback(() => motionFeaturesFor(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).then((features) => {
    onReady?.();
    return features;
  }), [onReady]);
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}

// `m.div`, `m.span`, … with a `data-m` attribute (see above). One component
// per tag, kept, so an element never changes type between renders. React 19
// passes `ref` as a prop, so it reaches Motion's element unchanged.
const marked = new Map<string, ComponentType<Record<string, unknown>>>();
const m = new Proxy(motionM, {
  get(target, key, receiver) {
    const Base = Reflect.get(target, key, receiver) as unknown;
    // `m.create()` is a factory, not an element.
    if (typeof key !== 'string' || key === 'create' || Base == null) return Base;
    let Marked = marked.get(key);
    if (!Marked) {
      const Element = Base as ComponentType<Record<string, unknown>>;
      Marked = (props) => createElement(Element, { ...props, 'data-m': '' });
      Marked.displayName = `m.${key}`;
      marked.set(key, Marked);
    }
    return Marked;
  },
}) as typeof motionM;

/** The variant keys that move something. Opacity is deliberately not among
 * them: a toast still has to arrive and leave, and fading is not what motion
 * sensitivity is about. */
const MOVEMENT_KEYS = new Set(['x', 'y', 'z', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY']);

/**
 * Take the movement out of a motion variant when the reader has asked for less
 * of it, and leave it alone otherwise.
 *
 * The shared primitives below each do this inline. This is the same rule for
 * the places that need a variant of their own — a toast sliding in from the
 * right, say — so the next one does not have to remember the rule to follow it.
 */
export function stillIfReduced<T extends Record<string, unknown>>(
  reduce: boolean | null | undefined,
  variant: T,
): T {
  if (!reduce) return variant;
  return Object.fromEntries(
    Object.entries(variant).filter(([key]) => !MOVEMENT_KEYS.has(key)),
  ) as T;
}

/**
 * Fade + slide a block in on mount. Pass an `index` to stagger a list of
 * stacked siblings (the delay is capped so a long list never crawls in).
 */
export function MotionItem({
  children,
  index = 0,
  className,
  style,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const delay = Math.min(index * 0.06, 0.4);
  return (
    <m.div
      className={className}
      style={style}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 400, damping: 40, delay }}
    >
      {children}
    </m.div>
  );
}

/** Spring-pop a small element in (score reveal, XP toast). */
export function MotionPop({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 440, damping: 42 }}
    >
      {children}
    </m.div>
  );
}

export { m, AnimatePresence, useReducedMotion };
