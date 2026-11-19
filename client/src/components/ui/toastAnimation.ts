import { animate } from 'motion';

type Kind = 'app' | 'xp';
const APP_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function enter(card: HTMLElement, pop: HTMLElement | null, kind: Kind, reduce: boolean) {
  const controls = [kind === 'app'
    ? animate(card, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], y: [16, 0], scale: [0.96, 1] }, { duration: 0.22, ease: APP_EASE })
    : animate(card, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], y: [12, 0] }, { duration: 0.2, ease: 'easeOut' })];
  if (pop) {
    controls.push(animate(pop, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], scale: [0.8, 1] }, reduce
      ? { duration: 0.12 }
      : { type: 'spring', stiffness: 440, damping: 42 }));
  }
  return () => { controls.forEach((control) => control.stop()); };
}

export function exit(card: HTMLElement, kind: Kind, reduce: boolean) {
  const control = kind === 'app'
    ? animate(card, reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }, { duration: 0.22, ease: APP_EASE })
    : animate(card, reduce ? { opacity: 0 } : { opacity: 0, y: 12 }, { duration: 0.2, ease: 'easeOut' });
  return () => { control.stop(); };
}
