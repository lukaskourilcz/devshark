// The route shell's one page-width map (UX audit U1, #573), the page column it
// caps, and the class a mounted part uses to ask for the wide page (a Learn or
// FDE coding phase, coding-03).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pageMaxWidth } from '../src/components/ui/pageWidth';

const token = (width: string) => (width === 'none' ? 'none' : `var(--ss-width-${width})`);

describe('pageMaxWidth: the one route-to-width map', () => {
  it.each([
    ['/', 'standard'],
    ['/profile', 'wide'],
    ['/play', 'wide'],
    ['/play/ABCD', 'wide'],
    ['/coding', 'wide'],
    ['/learn/web-developer', 'wide'],
    ['/quiz', 'wide'],
    ['/today', 'wide'],
    ['/leaderboard', 'wide'],
    ['/cards', 'wide'],
    ['/typing', 'wide'],
    ['/collection', 'wide'],
    ['/shop', 'wide'],
    ['/coding/javascript', 'wide'],
    ['/coding/javascript/js-sum', 'wide'],
    ['/dev', 'none'],
  ])('gives %s the %s width', (path, width) => {
    expect(pageMaxWidth(path)).toBe(token(width));
  });

  // Public, billing and auth keep their existing narrower reading column.
  it.each(['/premium', '/premium/checkout', '/premium/cancel', '/privacy', '/terms', '/classroom', '/auth/confirmed', '/no-such-page'])(
    'keeps %s in the narrow column',
    (path) => {
      expect(pageMaxWidth(path)).toBe('var(--ss-width-narrow)');
    },
  );

  it('does not widen a route that merely starts with a listed name', () => {
    expect(pageMaxWidth('/codingx')).toBe('var(--ss-width-narrow)');
    expect(pageMaxWidth('/players')).toBe('var(--ss-width-narrow)');
    expect(pageMaxWidth('/profiles')).toBe('var(--ss-width-narrow)');
  });
});

describe('the route box', () => {
  const shell = readFileSync(new URL('../src/styles/app-shell.css', import.meta.url), 'utf8');

  it('caps the keyed route box with the width the shell picks', () => {
    expect(shell).toContain('.ss-route { width: 100%; max-width: var(--ss-page-width); margin-inline: auto; }');
  });

  it('widens the route box to the wide page while a part carrying .ss-wide-page is inside it', () => {
    expect(shell).toContain('.ss-route:has(.ss-wide-page) { max-width: var(--ss-width-wide); }');
  });

  it('gives the footer the header\u2019s own box, not the route width', () => {
    expect(shell).toMatch(/\.ss-brand-footer \{[^}]*max-width: var\(--ss-width-chrome\);[^}]*margin-inline: auto;/);
    expect(shell).toMatch(/:root\[data-design='apple'\] \.ss-header \{[^}]*max-width: var\(--ss-width-chrome\);/);
  });
});
