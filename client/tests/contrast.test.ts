import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_SOFT_ALPHA,
  accentOnSoft,
  accentSoft,
  accentSoftContrast,
  compositeOver,
  contrastRatio,
} from '../src/lib/contrast';
import { SUBJECTS, SUBJECT_ORDER } from '../src/lib/subjects';

// --brand-accent-soft is composited at runtime from the active accent, so
// "does the chip text pass 4.5:1" cannot be checked by reading one hex. Web
// Dev green #2d7a2d measures 4.06:1 on its own tint over the muted light
// surface. These tests are the arithmetic behind the derived token, so a
// nudged brand hex fails here rather than in a manual audit.

/** WCAG 2.2 AA, 1.4.3 Contrast (Minimum), text below 18.66px bold. */
const AA_SMALL_TEXT = 4.5;

describe('WCAG primitives', () => {
  it('matches the reference ratios for black, white and mid grey', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 is the canonical "smallest grey that passes on white".
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.55);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#2d7a2d', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#2d7a2d'), 10);
  });

  it('composites the soft tint over an opaque surface', () => {
    expect(compositeOver('#2d7a2d', ACCENT_SOFT_ALPHA, '#ffffff')).toBe('#e6efe6');
    expect(compositeOver('#2d7a2d', ACCENT_SOFT_ALPHA, '#edf2f1')).toBe('#d6e4d9');
    expect(compositeOver('#2d7a2d', 0, '#ffffff')).toBe('#ffffff');
    expect(compositeOver('#2d7a2d', 1, '#ffffff')).toBe('#2d7a2d');
  });

  it('writes the soft token with the alpha it measures against', () => {
    expect(accentSoft('#2d7a2d')).toBe('rgba(45, 122, 45, 0.12)');
  });
});

describe('--brand-accent-on-soft', () => {
  it('reproduces the violation: the plain light accent misses the bar', () => {
    // If --brand-accent alone ever cleared 4.5:1 in both modes, the derived
    // token would be dead weight, so assert the problem is real first.
    const failing = SUBJECT_ORDER.flatMap((id) => {
      const s = SUBJECTS[id];
      return ([['light', s.accent], ['dark', s.accentBright]] as const)
        .filter(([mode, text]) => accentSoftContrast(text, s.accent, mode) < AA_SMALL_TEXT)
        .map(([mode]) => `${id}/${mode}`);
    });
    expect(failing).toEqual(['webdev/light']);
  });

  for (const id of SUBJECT_ORDER) {
    const s = SUBJECTS[id];
    for (const [mode, text] of [['light', s.accent], ['dark', s.accentBright]] as const) {
      it(`clears 4.5:1 for ${id} in ${mode} mode`, () => {
        const derived = accentOnSoft(text, s.accent, mode);
        expect(accentSoftContrast(derived, s.accent, mode)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }
  }

  it('leaves an accent that already passes exactly as it is', () => {
    // The dark-mode accent clears the bar on its own and must keep its hex.
    const webdev = SUBJECTS.webdev;
    expect(accentOnSoft(webdev.accentBright, webdev.accent, 'dark')).toBe(webdev.accentBright);
  });

  it('keeps the accent hue and moves lightness in the readable direction', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      if (max === r) return (((g - b) / d + (g < b ? 6 : 0)) / 6) * 360;
      if (max === g) return (((b - r) / d + 2) / 6) * 360;
      return (((r - g) / d + 4) / 6) * 360;
    };
    const lightness = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    };

    const webdev = SUBJECTS.webdev;
    const darker = accentOnSoft(webdev.accent, webdev.accent, 'light');
    // Within one 1/255 rounding step of the source hue: no colour shift the
    // brand did not ask for.
    expect(Math.abs(hue(darker) - hue(webdev.accent))).toBeLessThan(1);
    expect(lightness(darker)).toBeLessThan(lightness(webdev.accent));

    // The walk also works upward for a bright accent that fails on a dark tint.
    const lighter = accentOnSoft('#1f5f1f', webdev.accent, 'dark');
    expect(Math.abs(hue(lighter) - hue('#1f5f1f'))).toBeLessThan(1);
    expect(lightness(lighter)).toBeGreaterThan(lightness('#1f5f1f'));
    expect(accentSoftContrast(lighter, webdev.accent, 'dark')).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it('moves no further than it has to', () => {
    // One 0.5%-lightness step is worth well under 0.2 of a ratio point at
    // these luminances, so a minimal result sits just above the bar.
    for (const id of SUBJECT_ORDER) {
      const s = SUBJECTS[id];
      for (const [mode, text] of [['light', s.accent], ['dark', s.accentBright]] as const) {
        const derived = accentOnSoft(text, s.accent, mode);
        if (derived === text) continue;
        expect(accentSoftContrast(derived, s.accent, mode)).toBeLessThan(AA_SMALL_TEXT + 0.2);
      }
    }
  });

  it('agrees with the pre-paint default baked into reset.css', () => {
    // styles/reset.css hard-codes the Web Dev values so the first paint is not
    // a failing chip. They have to be the same numbers.
    const webdev = SUBJECTS.webdev;
    expect(accentOnSoft(webdev.accent, webdev.accent, 'light')).toBe('#2a712a');
    expect(accentOnSoft(webdev.accentBright, webdev.accent, 'dark')).toBe('#4caf50');
  });
});

describe('initials avatars (--ss-avatar-1 … 8)', () => {
  // ui/InitialsAvatar.tsx paints initials in --ss-on-avatar on one of eight
  // inks from astryx-theme.css. Every pair is small bold text: 4.5:1.
  const theme = readFileSync(new URL('../src/styles/astryx-theme.css', import.meta.url), 'utf8');
  const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(theme)?.[1];

  it('defines eight inks and the text colour', () => {
    expect(Array.from({ length: 8 }, (_, i) => token(`ss-avatar-${i + 1}`)).every(Boolean)).toBe(true);
    expect(token('ss-on-avatar')).toBe('#ffffff');
  });

  for (let i = 1; i <= 8; i += 1) {
    it(`clears 4.5:1 on ink ${i}`, () => {
      expect(contrastRatio(token('ss-on-avatar')!, token(`ss-avatar-${i}`)!)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }
});

describe('practice verdict text and the outline around its tinted panel', () => {
  const css = readFileSync(new URL('../src/styles/astryx-theme.css', import.meta.url), 'utf8');
  const pair = (name: string): [string, string] => {
    const match = new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`).exec(css);
    if (!match) throw new Error('Missing light and dark colours for ' + name);
    return [match[1], match[2]];
  };
  const tint = (name: string): [number, number] => {
    const match = new RegExp(`--${name}: light-dark\\(rgba\\([^)]*, ([.0-9]+)\\), rgba\\([^)]*, ([.0-9]+)\\)\\)`).exec(css);
    if (!match) throw new Error('Missing light and dark alpha for ' + name);
    return [Number(match[1]), Number(match[2])];
  };
  for (const severity of ['success', 'error'] as const) for (const mode of [0, 1] as const) {
    it(`${severity} feedback in ${mode ? 'dark' : 'light'} mode`, () => {
      const surface = pair('color-background-surface')[mode];
      const outline = pair('ss-' + severity)[mode];
      const background = compositeOver(outline, tint('ss-' + severity + '-soft')[mode], surface);
      const text = pair(severity === 'error' ? 'ss-error-text' : 'ss-success-strong')[mode];
      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(outline, background)).toBeGreaterThanOrEqual(3);
    });
  }
});
