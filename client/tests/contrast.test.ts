import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_OPTIONS, getCategoryHexColor, onCategoryColorText } from '../src/lib/categories';
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

describe('wallet entries and leaderboard visibility captions', () => {
  const theme = readFileSync(new URL('../src/styles/astryx-theme.css', import.meta.url), 'utf8');
  const wallet = readFileSync(new URL('../src/components/Rewards.css', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/components/LeaderboardVisibilitySwitch.css', import.meta.url), 'utf8');
  const colours = (token: string) => {
    const match = new RegExp('--' + token + ': light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)').exec(theme);
    if (!match) throw new Error('Missing theme colours for ' + token);
    return [match[1], match[2]];
  };
  it('uses a readable gain on the wallet surface in both themes', () => {
    expect(wallet).toMatch(/\.ss-ledger__in\s*\{\s*color:\s*var\(--ss-success-strong\)/);
    for (const mode of [0, 1]) expect(contrastRatio(colours('ss-success-strong')[mode], colours('color-background-muted')[mode])).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps the group caption readable while the preferences are loading or unavailable', () => {
    expect(settings).toMatch(/\.lb-visibility \.astryx-field-label\s*\{\s*--color-text-disabled:\s*var\(--color-text-secondary\)/);
    for (const mode of [0, 1]) expect(contrastRatio(colours('color-text-secondary')[mode], colours('color-background-surface')[mode])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('authored text and control colours', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const css = (file: string) => readFileSync(join(root, file), 'utf8');
  const theme = css('styles/astryx-theme.css');
  const apple = theme.match(/:root\[data-design='apple'\]\s*\{([^}]+)\}/)![1];
  const editor = css('coding/Coding.css');
  const editorApple = editor.slice(editor.lastIndexOf('--cd-editor-bg:'));
  const tokens = (sheet: string, name: string) => new RegExp('(?:^|[;{\\s])--' + name + ':\\s*([^;]+);').exec(sheet)?.[1]?.trim();
  const foregrounds = [
    'brand-accent', 'brand-accent-on-soft', 'brand-on-accent', 'cd-editor-fg', 'color-background-surface',
    'color-text-accent', 'color-text-disabled', 'color-text-primary', 'color-text-secondary', 'rm-on-accent',
    'ss-danger', 'ss-error', 'ss-error-text', 'ss-info', 'ss-ink', 'ss-on-avatar', 'ss-on-error-text',
    'ss-success', 'ss-success-strong', 'ss-warning',
  ];
  it('requires a reviewed colour family for every directly used CSS text token', () => {
    const seen = new Set<string>();
    for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.css'))) {
      const sheet = css(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of sheet.matchAll(/(?:^|[;{])\s*color\s*:\s*var\(\s*--([\w-]+)/g)) seen.add(match[1]);
    }
    expect([...seen].sort()).toEqual([...foregrounds].sort());
  });

  it('checks the actual completed-stage label against the tint it uses', () => {
    const rule = editor.match(/\.cd-stage-nav \.cd-stage--complete\s*\{([^}]+)\}/)![1];
    const foreground = /(?:^|;)\s*color:\s*var\(--([\w-]+)\)/.exec(rule)![1];
    expect(rule).toMatch(/background:\s*var\(--brand-accent-soft\)/);
    for (const mode of ['light', 'dark'] as const) {
      const accent = mode === 'light' ? SUBJECTS.webdev.accent : SUBJECTS.webdev.accentBright;
      expect(['brand-accent', 'brand-accent-on-soft']).toContain(foreground);
      const ink = foreground === 'brand-accent-on-soft' ? accentOnSoft(accent, accent, mode) : accent;
      expect(accentSoftContrast(ink, accent, mode)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it('keeps active labels separate from topic decoration, inactive controls and table fills', () => {
    const roadmap = css('components/Roadmap.tsx');
    const tree = css('components/RoadmapTree.tsx');
    const play = css('components/Play.tsx');
    const questions = css('components/dev/DevQuestions.tsx');
    const triage = css('components/dev/DevTriage.tsx');
    expect(roadmap).toContain("color: passed ? passedLine : unlocked ? 'var(--color-text-primary)'");
    expect(roadmap).toContain("color: passed ? '#3a2c00' : unlocked ? 'var(--color-text-primary)'");
    expect(roadmap).toMatch(/color: 'var\(--ss-success-strong\)'[^}]*}}>[\s\S]{0,70}t\('roadmap\.allDone'\)/);
    expect(tree).toContain("color: unlocked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'");
    expect(tree).not.toMatch(/opacity:\s*unlocked\s*\?/);
    expect(play).toMatch(/remainingS <= 5\s*\? 'var\(--ss-error-text\)'/);
    expect(play).toMatch(/remainingS <= 5\s*\? 'var\(--ss-error-soft\)'/);
    expect(play).toMatch(/color: 'var\(--brand-accent-on-soft\)',\s*background: 'var\(--brand-accent-soft\)'/);
    expect(css('components/Challenge.tsx')).toMatch(/color: 'var\(--brand-accent\)' }}>[\s\S]{0,30}{score}/);
    expect(questions).toContain("danger ? 'var(--ss-error-text)'");
    expect(questions).toMatch(/correct \? 'var\(--ss-success-strong\)'/);
    expect(triage).toMatch(/i === q.correctAnswer \? 'var\(--ss-success-strong\)'/);
    for (const palette of ['REVIEW_COLOR', 'SOURCE_PILL_COLOR']) {
      const entries = questions.match(new RegExp('const ' + palette + '[^=]+= \\{([^}]+)\\}'))![1];
      for (const swatch of entries.matchAll(/:\s*'([^']+)'/g)) {
        expect(swatch[1]).toMatch(/^var\(--(?:ss-(?:success-strong|error-text|warning)|color-text-secondary)\)$/);
      }
    }
  });

  for (const design of ['brand', 'apple']) for (const mode of [0, 1] as const) {
    it(`checks text, focus and control surfaces in ${design} ${mode ? 'dark' : 'light'}`, () => {
      const sheets = design === 'apple' ? [apple, editorApple, theme, editor] : [theme, editor];
      function raw(name: string): string {
        for (const sheet of sheets) {
          const value = tokens(sheet, name);
          if (value !== undefined) return value;
        }
        throw new Error('Missing theme colour ' + name);
      }
      function solid(name: string): string {
        if (name === 'brand-accent') return mode ? SUBJECTS.webdev.accentBright : SUBJECTS.webdev.accent;
        const value = raw(name).replace(/var\(--([\w-]+)(?:,\s*#[\da-f]+)?\)/gi, (_, key: string) => solid(key));
        const pair = /^light-dark\((#[\da-f]+),\s*(#[\da-f]+)\)$/i.exec(value);
        const result = pair ? pair[mode + 1] : value;
        if (!/^#[\da-f]{6}$/i.test(result)) throw new Error('Unsupported colour ' + name + ': ' + result);
        return result;
      }
      function tinted(name: string, background: string) {
        const stops = [...raw(name).matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)];
        const stop = stops[mode];
        if (!stop) throw new Error('Missing tint ' + name);
        const fill = '#' + stop.slice(1, 4).map(v => Number(v).toString(16).padStart(2, '0')).join('');
        return compositeOver(fill, Number(stop[4]), background);
      }
      const check = (ink: string, background: string, minimum = 4.5) =>
        expect(contrastRatio(ink, background), ink + ' on ' + background).toBeGreaterThanOrEqual(minimum);
      const surfaces = ['body', 'surface', 'muted', 'elevated'].map(s => solid('color-background-' + s));
      const brand = solid('brand-accent');
      const focusAmount = /var\(--brand-accent\) (\d+)%/.exec(raw('ss-focus'))!;
      const border = raw('color-border-strong').replace('var(--ss-ink-rgb)', raw('ss-ink-rgb'));
      const borderStop = [...border.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)][mode];
      const borderInk = '#' + borderStop.slice(1, 4).map(c => Number(c).toString(16).padStart(2, '0')).join('');
      for (const background of surfaces) {
        for (const text of ['color-text-primary', 'color-text-secondary', 'color-text-accent', 'ss-ink',
          'ss-success', 'ss-success-strong', 'ss-error', 'ss-error-text', 'ss-warning', 'ss-info']) {
          check(solid(text), background);
        }
        // The danger class falls back to normal foreground in both product themes.
        check(solid('color-text-primary'), background);
        check(compositeOver(brand, Number(focusAmount[1]) / 100, solid('ss-ink')), background, 3);
        check(compositeOver(borderInk, Number(borderStop[4]), background), background, 3);
        for (const status of ['success', 'error', 'warning', 'info'] as const) {
          const fill = tinted('ss-' + status + '-soft', background);
          check(solid('ss-' + status), fill, 3);
          check(solid('color-text-primary'), fill);
          // Roadmap swatches and Today's completed mark contain glyphs; their labels sit outside.
          check(solid({ success: 'ss-success-strong', error: 'ss-error-text', warning: 'ss-warning', info: 'color-text-primary' }[status]!), fill);
        }
      }
      for (const surface of surfaces) {
        // Play's winner uses the same tint as the active level marker. The countdown
        // changes to the semantic error tint in its final five seconds.
        const baseAccent = SUBJECTS.webdev.accent;
        const activeLevel = compositeOver(baseAccent, ACCENT_SOFT_ALPHA, surface);
        check(accentOnSoft(brand, baseAccent, mode ? 'dark' : 'light'), activeLevel);
        check(solid('color-text-primary'), activeLevel);
        check(solid('ss-error-text'), tinted('ss-error-soft', surface));
        // An open checkpoint uses a gradient. The trophy must be visible at both ends.
        for (const [gold, alpha] of [['#ffd54f', 0x38 / 255], ['#f5a623', 0x24 / 255]] as const) {
          check(solid('color-text-primary'), compositeOver(gold, alpha, surface), 3);
          check('#3a2c00', gold, 3);
        }
      }
      const guide = css('components/TypingRacer.css');
      expect(guide).toContain('.ss-typing__ch--pending { color: var(--color-text-secondary); }');
      expect(guide).toMatch(/\.ss-typing__ch--error\s*\{\s*color:\s*var\(--ss-error-text\)/);
      const clock = css('components/Challenge.css');
      expect(clock).toMatch(/\.challenge-run__clock\[data-low\]\s*\{\s*color:\s*var\(--ss-error-text\)/);
      const tintPercent = /color-mix\(in srgb, var\(--ss-error\) (\d+)%, transparent\)/.exec(clock);
      expect(tintPercent).not.toBeNull();
      check(solid('ss-error-text'), compositeOver(solid('ss-error'), Number(tintPercent![1]) / 100, solid('color-background-muted')));
      const onBrand = mode ? tokens(theme.slice(theme.indexOf(":root[data-theme='dark']")), 'brand-on-accent')! : raw('brand-on-accent');
      check(onBrand, brand);
      check(solid('color-background-surface'), solid('ss-ink'));
      check(solid('ss-on-error-text'), solid('ss-error-text'));
      check(solid('ss-on-success-strong'), solid('ss-success-strong'));
      check(solid('cd-editor-gutter-fg'), solid('cd-editor-gutter'));
      check(solid('cd-editor-fg'), solid('cd-editor-bg'));
      for (const name of ['keyword', 'name', 'function', 'constant', 'type', 'operator', 'comment', 'string']) {
        check(solid('cd-syntax-' + name), solid('cd-editor-bg'));
      }
      // Semantic topic fills on the roadmap choose their own white or dark ink.
      for (const option of CATEGORY_OPTIONS) {
        const foreground = onCategoryColorText(option.value);
        check(foreground === '#fff' ? '#ffffff' : foreground === '#000' ? '#000000' : foreground, getCategoryHexColor(option.value));
      }
    });
  }
});
