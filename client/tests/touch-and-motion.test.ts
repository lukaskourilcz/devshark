// What a phone and a reduced-motion setting get, read from the stylesheets
// themselves: jsdom matches no media query, so the rules inside the
// `(pointer: coarse)` and `(prefers-reduced-motion: reduce)` blocks are
// checked as written. The browser sweeps (check:responsive, routes-axe)
// measure the same screens at phone widths.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addSheet, declared, mediaRules } from './css';

describe('touch targets on a coarse pointer', () => {
  const coarse = mediaRules(addSheet('appShell'), 'pointer: coarse');

  // Measured in the round-3 audit: 40, 36, 31 and 28px.
  it.each([
    ['.rm-node button', 'a Learn map level, locked or Premium'],
    ['.rm-part-pill', 'a career roadmap part'],
    ['.lp-module__title a', 'a learning path link on the career roadmap'],
  ])('raises %s (%s) to 44px', (selector) => {
    expect(declared(coarse, selector, 'min-height')).toBe('44px');
  });

  it('gives a level node 44px of width as well', () => {
    expect(declared(coarse, '.rm-node button', 'min-width')).toBe('44px');
  });

  // UX audit learn-18: the Skill check is a page action, so it is 44px with a
  // mouse as well, set once in Roadmap.css rather than only for touch.
  it('keeps the Learn map’s Skill check at the control height on every pointer', () => {
    const roadmap = [...addSheet('roadmap').cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    expect(declared(roadmap, '.rm-skillcheck-cta', 'min-height')).toBe('var(--ss-control-height)');
    // One line beside the locked-topics note (UX audit learn-07).
    expect(declared(roadmap, '.rm-skillcheck-cta', 'white-space')).toBe('nowrap');
    expect(declared(roadmap, '.rm-skillcheck-cta', 'flex-shrink')).toBe('0');
  });

  // UX audit learn-04: Skill check is a secondary pill with no outline of its
  // own, not a second accent-bordered call to action beside the map's primary.
  it('draws the Skill check as a secondary pill, without the accent border', () => {
    const roadmap = [...addSheet('roadmap').cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    expect(declared(roadmap, '.rm-skillcheck-cta', 'border-radius')).toBe('999px');
    expect(declared(roadmap, '.rm-skillcheck-cta', 'border')).toMatch(/^0/);
  });

  // UX audit learn-04: the level runner's actions are the shared QuestionActions
  // row (44px, one SwimCta md), so its own button and option classes are gone.
  it.each(['.rm-accent-btn', '.rm-outline-btn', '.rm-text-btn', '.rm-option'])(
    'no longer styles the level runner with %s',
    (selector) => {
      const roadmap = [...addSheet('roadmap').cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
      expect(roadmap.some((rule) => rule.selectorText.split(',').some((part) => part.trim().startsWith(selector)))).toBe(false);
    },
  );
});

// UX audit U1 (#573): one control height on every pointer, set once here and
// in the two tokens, not page by page.
describe('control heights on every pointer', () => {
  const sheet = addSheet('appShell');
  const topLevel = [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  const fine = mediaRules(sheet, 'pointer: fine');
  const theme = readFileSync(new URL('../src/styles/astryx-theme.css', import.meta.url), 'utf8');

  it.each([
    ['--ss-width-task', '640px'],
    ['--ss-width-narrow', '800px'],
    ['--ss-width-standard', '1000px'],
    ['--ss-width-wide', '1200px'],
    ['--ss-control-height', '44px'],
    ['--ss-control-height-compact', '36px'],
  ])('defines %s as %s in astryx-theme.css', (token, value) => {
    expect(theme).toMatch(new RegExp(`${token}:\\s*${value};`));
  });

  it.each(['.astryx-button', '.astryx-segmented-control-item'])('floors %s at the control height outside any media query', (selector) => {
    expect(declared(topLevel, selector, 'min-height')).toBe('var(--ss-control-height)');
    expect(declared(topLevel, selector, 'min-width')).toBe('var(--ss-control-height)');
  });

  it('keeps !important on the shared floor, the only way past Astryx\u2019s StyleX specificity', () => {
    // jsdom drops the priority of a var() value, so this reads the source.
    const shell = readFileSync(new URL('../src/styles/app-shell.css', import.meta.url), 'utf8');
    expect(shell).toMatch(/\.astryx-button,\n\.astryx-segmented-control-item \{\n  min-height: var\(--ss-control-height\) !important;\n  min-width: var\(--ss-control-height\) !important;/);
  });

  it('raises the text input itself, not only its box, so a click or tap measures 44px', () => {
    expect(declared(topLevel, '.astryx-text-input', 'min-height')).toBe('var(--ss-control-height)');
    expect(declared(topLevel, '.astryx-text-input > input', 'min-height')).toBe('var(--ss-control-height)');
  });

  it('no longer scopes the shared Astryx floor to coarse pointers', () => {
    const coarse = mediaRules(sheet, 'pointer: coarse');
    expect(declared(coarse, '.astryx-button', 'min-height')).toBe('');
    expect(declared(coarse, '.astryx-text-input', 'min-height')).toBe('');
  });

  it.each(['.astryx-button.ss-action', '.ss-info-actions .astryx-button', '.ss-auth__actions .astryx-button'])(
    'gives %s the page-action type through Astryx\u2019s own variables',
    (selector) => {
      expect(declared(topLevel, selector, '--spacing-3')).toBe('20px');
      expect(declared(topLevel, selector, '--text-label-size')).toBe('1rem');
      expect(declared(topLevel, selector, '--font-weight-medium')).toBe('600');
    },
  );

  it('drops toolbar controls inside .ss-compact to 36px on a fine pointer only', () => {
    expect(declared(fine, '.ss-compact .astryx-button', 'min-height')).toBe('var(--ss-control-height-compact)');
    expect(declared(fine, '.ss-compact .astryx-segmented-control-item', 'min-height')).toBe('var(--ss-control-height-compact)');
    expect(declared(topLevel, '.ss-compact .astryx-button', 'min-height')).toBe('');
  });

  it('draws the footer toggles as compact pills: 36px with a 44px hit area on a mouse, 44px on touch', () => {
    expect(declared(topLevel, '.ss-footer-settings button', 'min-height')).toBe('var(--ss-control-height-compact)');
    expect(declared(topLevel, '.ss-footer-settings button', 'border-radius')).toBe('999px');
    expect(declared(fine, '.ss-footer-settings button::before', 'inset')).toBe(
      'calc((var(--ss-control-height-compact) - var(--ss-control-height)) / 2)',
    );
    expect(declared(mediaRules(sheet, 'pointer: coarse'), '.ss-footer-settings button', 'min-height')).toBe('44px');
  });

  // The glossary chips ("Terms in this question") were 32px on every pointer.
  it('puts the glossary term chips on the button scale: 44px, or 36px with a 44px hit area in .ss-compact', () => {
    const terms = addSheet('terms');
    const termRules = [...terms.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const compactTerms = mediaRules(terms, 'pointer: fine');
    expect(declared(termRules, '.ss-term__button', 'min-height')).toBe('var(--ss-control-height)');
    expect(declared(termRules, '.ss-term__button', 'position')).toBe('relative');
    expect(declared(compactTerms, '.ss-compact .ss-term__button', 'min-height')).toBe('var(--ss-control-height-compact)');
    expect(declared(compactTerms, '.ss-compact .ss-term__button::before', 'inset')).toBe(
      'calc((var(--ss-control-height-compact) - var(--ss-control-height)) / 2)',
    );
  });

  it('keeps a 44px hit area around a compact control', () => {
    expect(declared(fine, '.ss-compact .astryx-button::before', 'position')).toBe('absolute');
    expect(declared(fine, '.ss-compact .astryx-button::before', 'inset')).toBe(
      'calc((var(--ss-control-height-compact) - var(--ss-control-height)) / 2)',
    );
  });

  it('gives the coding workbench’s Submit the row’s 44px as SwimCta md, not SwimCta sm’s 32px (coding-02)', () => {
    const coding = readFileSync(new URL('../src/coding/Coding.css', import.meta.url), 'utf8');
    const workbench = readFileSync(new URL('../src/coding/CodingWorkbench.tsx', import.meta.url), 'utf8');
    expect(coding).not.toContain('--swim-cta-height: 32px');
    expect(coding).not.toContain('ss-swim-cta--sm');
    // Every SwimCta in the workbench takes the md default (44px, 0.95rem text).
    expect(workbench).toMatch(/<SwimCta /);
    expect(workbench).not.toMatch(/<SwimCta[^>]*size="sm"/);
  });
});

describe('reduced motion on the Learn map', () => {
  it('stops the current level’s fin as well as the node under it', () => {
    const reduced = mediaRules(addSheet('roadmap'), 'prefers-reduced-motion: reduce');
    expect(declared(reduced, '.rm-bob', 'animation')).toMatch(/^none/);
    expect(declared(reduced, '.rm-current-fin', 'animation')).toMatch(/^none/);
  });
});
