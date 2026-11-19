// The mobile drawer after UX audit shell-public-15: two labelled groups and
// the appearance and sound toggles pinned to its bottom, while the footer's
// pair hides below the nav breakpoint so the toggles live in one place. The
// browser spec (tests/browser/navigation.spec.ts) opens the drawer itself.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addSheet, declared, mediaRules } from './css';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('the mobile drawer', () => {
  const shell = addSheet('appShell');
  const menu = addSheet('mobileNavigation');
  const top = [...menu.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);

  it('splits Practice from You in the desktop header’s order', () => {
    // You: Career, Shark Cards, Leaderboard, Coins, Premium, in that order.
    const you = [...app.matchAll(/\{ to: '([^']+)'[^\n]*you: true \}/g)].map((match) => match[1]);
    expect(you).toEqual(['/roadmap', '/collection', '/leaderboard', '/shop', '/premium']);
    expect(app).toMatch(/className="ss-drawer-group" role="group" aria-label=\{label\}/);
    expect(declared(top, '.ss-drawer-group + .ss-drawer-group', 'border-top')).toBe('1px solid var(--color-border)');
  });

  it('pins the toggles to the bottom as 44px rows and hides the footer pair below 1024px', () => {
    expect(app).toMatch(/className="ss-drawer-settings"[\s\S]{0,200}<SettingsToggles className="ss-drawer-link" \/>/);
    expect(declared(top, '.ss-drawer-settings', 'margin-top')).toBe('auto');
    expect(declared(top, '.ss-drawer-link', 'min-height')).toBe('var(--ss-control-height)');
    // Scoped to the footer, so it outranks the footer's own display: flex below it.
    expect(declared(mediaRules(shell, 'max-width: 1023px'), '.ss-brand-footer .ss-footer-settings', 'display')).toBe('none');
  });
});
