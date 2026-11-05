// The Coding lists' reserved layout (UX audit U3, #575). jsdom draws no CSS,
// so these pin the rules that give the lists their shape: four tracks in one
// row, hairline task rows in two columns, a planner row without a card, no
// scroll box inside the page and one filter row.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/coding/Coding.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector is exactly `selector`,
 * optionally inside the media query that starts with `media`. */
function rule(selector: string, media?: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const find = (scope: string) => scope.match(new RegExp(`(?:^|[{}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1];
  const scopes: string[] = [];
  if (!media) scopes.push(css);
  else {
    // Every block of that media query, each cut at its own closing brace.
    for (let at = css.indexOf(media); at >= 0; at = css.indexOf(media, at + 1)) {
      let depth = 0;
      let end = css.indexOf('{', at);
      for (; end < css.length; end += 1) {
        if (css[end] === '{') depth += 1;
        else if (css[end] === '}' && --depth === 0) break;
      }
      scopes.push(css.slice(css.indexOf('{', at) + 1, end));
    }
  }
  for (const scope of scopes) {
    const found = find(scope);
    if (found !== undefined) return found;
  }
  throw new Error(`no rule for ${selector}${media ? ` in ${media}` : ''}`);
}

describe('the Coding lists', () => {
  it('put the four tracks in one row from 1051px and 2x2 below (coding-07)', () => {
    expect(rule('.cd-track-directory')).toContain('repeat(4, minmax(0, 1fr))');
    expect(rule('.cd-track-directory', '@media (max-width: 1050px)')).toContain('repeat(2, minmax(0, 1fr))');
    expect(rule('.cd-discovery .cd-techniques', '@media (min-width: 1051px)')).toContain('repeat(3, minmax(0, 1fr))');
  });

  it('draw task rows as 48px hairline lines in two columns from 1024px (coding-06)', () => {
    const row = rule('.cd-row');
    expect(row).toContain('min-height: 48px');
    expect(row).toContain('border: 0');
    expect(row).toContain('border-radius: 0');
    expect(rule('.cd-row-item')).toContain('border-bottom: 1px solid var(--ss-card-line)');
    expect(rule('.cd-catalogue')).toContain('repeat(2, minmax(0, 1fr))');
    // A phone drops the meta's separator, so a wrapped meta line never opens with '·'.
    expect(rule('.cd-row__meta > [aria-hidden]', '@media (max-width: 599px)')).toContain('display: none');
  });

  it('keep the planner a hairline row of at least 44px, not a card (coding-08)', () => {
    expect(rule('.cd-run')).toContain('border-block: 1px solid var(--ss-card-line)');
    expect(rule('.cd-run__head')).toContain('min-height: 44px');
    // 64px collapsed: two 9px paddings, the 44px head and two hairlines, with
    // the title and lead set tight enough to fit beside the 44px button.
    expect(rule('.cd-run')).toContain('padding-block: 9px');
    expect(rule('.cd-page .cd-run__title')).toContain('line-height: 1.3');
    expect(rule('.cd-run__lead')).toContain('line-height: 1.4');
    // A phone keeps the button beside the title, with the lead under both.
    expect(rule('.cd-run__head', '@media (max-width: 560px)')).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(rule('.cd-run__intro', '@media (max-width: 560px)')).toContain('display: contents');
    expect(rule('.cd-run__toggle', '@media (max-width: 560px)')).toContain('grid-row: 1; grid-column: 2');
    expect(rule('.cd-run__lead', '@media (max-width: 560px)')).toContain('grid-column: 1 / -1');
  });

  it('never scroll a project list inside the page (coding-09)', () => {
    expect(css).not.toMatch(/cd-project-list--scroll/);
    expect(css).not.toMatch(/--cd-project-list-height/);
  });

  it('keep the filters to one row from 1024px and a 2-column grid under 760px (coding-16)', () => {
    expect(rule('.cd-search', '@media (min-width: 1024px)')).toContain('flex-wrap: nowrap');
    expect(rule('.cd-search', '@media (max-width: 759px)')).toContain('repeat(2, minmax(0, 1fr))');
    expect(css).not.toMatch(/cd-technique-chips|cd-technique-select/);
  });
});
