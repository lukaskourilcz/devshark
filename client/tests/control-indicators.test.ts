import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/lib/contrast';

// The theme contrast suite checks the actual light/dark composited token.
// These selectors draw the editable region itself or the resize handle.
function declarations(path: string, selector: string): string[] {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src', path), 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(css.matchAll(new RegExp(escaped + '\\s*\\{([^{}]+)\\}', 'g')), match => match[1]);
}

describe('editable fields and resize handles', () => {
  it.each([
    ['styles/app-shell.css', '.ss-input, .ss-select'],
    ['coding/Coding.css', '.cd-search input, .cd-search select'],
    ['components/TypingRacer.css', '.ss-typing__input'],
    ['components/paths/LearningPaths.css', '.lp-field input, .lp-field textarea'],
    ['components/paths/LearningPaths.css', '.lp-example__editor'],
    ['components/admin/AdminPage.css', '.admin-email-editor'],
    ['components/admin/AdminPage.css', '.admin-email-toolbar select'],
  ])('%s uses the control edge for %s', (path, selector) => {
    expect(declarations(path, selector).some(rule =>
      /\bborder:\s*1px solid var\(--color-border-strong\)/.test(rule),
    )).toBe(true);
  });

  it('keeps the empty lesson heart identifiable while its fill drains', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
    const meter = readFileSync(join(src, 'components/learn/LessonRunner.tsx'), 'utf8');
    const palette = readFileSync(join(src, 'theme/MuiTheme.ts'), 'utf8');
    const heart = /coral:\s*'(#[a-f0-9]{6})'/i.exec(palette)?.[1];
    expect(meter).toContain('const HEART_COLOR = BRAND.coral');
    expect(meter).toContain('<HeartShape color="none"');
    expect(meter).toContain('stroke={HEART_COLOR}');
    expect(heart).toBeDefined();
    for (const background of ['#ffffff', '#edf2f1', '#f0f0f3', '#101c24', '#16242d', '#14232c']) {
      expect(contrastRatio(heart!, background)).toBeGreaterThanOrEqual(3);
    }
  });

  it('exposes the desktop resize bar before hover or keyboard focus', () => {
    const handle = declarations('coding/Coding.css', '.cd-splitter').find(rule => rule.includes('col-resize'));
    expect(handle).toContain('linear-gradient(');
    expect(handle?.match(/var\(--color-border-strong\)/g)).toHaveLength(2);
  });
});
