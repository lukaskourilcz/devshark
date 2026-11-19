import { readFileSync } from 'node:fs';
// The app's own stylesheets in the test document. Vitest drops CSS imports,
// so a test that asks what a state looks like adds the sheet itself: jsdom
// then cascades its top-level rules into getComputedStyle. Rules inside an
// @media block are not applied (jsdom matches no media), so those are read
// from the sheet with `mediaRules`.

const SHEETS = {
  appShell: '../src/styles/app-shell.css',
  mobileNavigation: '../src/components/MobileNavigation.css',
  roadmap: '../src/components/Roadmap.css',
  deepEnd: '../src/components/DeepEndScreens.css',
  terms: '../src/components/ui/Terms.css',
} as const;

export function addSheet(name: keyof typeof SHEETS): CSSStyleSheet {
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL(SHEETS[name], import.meta.url), 'utf8');
  document.head.append(style);
  return style.sheet!;
}

/** The style rules inside every @media block of `sheet` whose condition
 * contains `condition`, e.g. "pointer: coarse". */
export function mediaRules(sheet: CSSStyleSheet, condition: string): CSSStyleRule[] {
  return [...sheet.cssRules]
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.media.mediaText.includes(condition))
    .flatMap((rule) => [...rule.cssRules].filter((inner): inner is CSSStyleRule => inner instanceof CSSStyleRule));
}

/** The value `property` gets for `selector` (one entry of a selector list)
 * from the rules given, the last rule winning; '' when none sets it. */
export function declared(rules: CSSStyleRule[], selector: string, property: string): string {
  let value = '';
  for (const rule of rules) {
    const selectors = rule.selectorText.split(',').map((one) => one.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector) && rule.style.getPropertyValue(property)) value = rule.style.getPropertyValue(property);
  }
  return value;
}
