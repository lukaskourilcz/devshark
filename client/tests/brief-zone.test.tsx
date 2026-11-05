// The capped brief at the top of the coding frame (UX audit coding-01): a
// body that fits gets no toggle; one that does not scrolls as a named,
// focusable region with a "Show full brief" toggle that lifts the cap.
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { BriefZone } from '../src/coding/BriefZone';

const sizes = (scroll: number, client: number) => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('cd-brief__body') ? scroll : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('cd-brief__body') ? client : 0; } });
};

afterEach(() => {
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

const mount = () => render(
  <LanguageProvider>
    <BriefZone labelledBy="task-title" head={<h1 id="task-title">Digit sum</h1>} after={<p>Premium task</p>}>
      <p>Write digitSum(n).</p>
    </BriefZone>
  </LanguageProvider>,
);

describe('BriefZone', () => {
  it('shows a brief that fits without a toggle, a fade or a tab stop', () => {
    sizes(80, 120);
    const { container } = mount();
    const body = container.querySelector('.cd-brief__body')!;
    expect(body).toHaveAttribute('data-capped', 'true');
    expect(body).not.toHaveAttribute('data-fade');
    expect(body).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button', { name: 'Show full brief' })).toBeNull();
    expect(screen.getByText('Premium task')).toBeInTheDocument();
  });

  it('scrolls a long brief inside the cap as a region named by the title, and the toggle lifts the cap', () => {
    sizes(400, 120);
    const { container } = mount();
    const body = container.querySelector('.cd-brief__body')!;
    const region = screen.getByRole('region', { name: 'Digit sum' });
    expect(region).toBe(body);
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('data-fade', 'true');
    const toggle = screen.getByRole('button', { name: 'Show full brief' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', body.id);
    sizes(400, 400);
    fireEvent.click(toggle);
    expect(body).toHaveAttribute('data-capped', 'false');
    expect(body).not.toHaveAttribute('tabindex');
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    sizes(400, 120);
    fireEvent.click(less);
    expect(body).toHaveAttribute('data-capped', 'true');
    expect(body).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Show full brief' })).toBe(less);
  });

  it('caps the body with one token and fixes the frame height from 1024px', () => {
    const css = readFileSync(resolve(__dirname, '../src/coding/Coding.css'), 'utf8');
    expect(css).toContain("--cd-frame-h: clamp(360px, calc(100dvh - 160px), 640px);");
    expect(css).toContain(".cd-brief__body[data-capped='true'] { max-height: var(--cd-brief-cap);");
    expect(css).toMatch(/\.cd-workbench--section \.cd-workbench__grid,\s*\.cd-workbench--lesson \.cd-workbench__grid,\s*\.cd-workbench--activity \.cd-workbench__grid \{ grid-template-rows: var\(--cd-frame-h\); \}/);
  });

  it('puts the editor toolbar in the toggle row when the brief ends with its toggle, without covering it', () => {
    const css = readFileSync(resolve(__dirname, '../src/coding/Coding.css'), 'utf8');
    // 44px toggle + the brief's 4px margin + the pane's 12px gap.
    expect(css).toContain('.cd-pane--editor > .cd-brief:has(> .cd-brief__toggle:last-child) + .cd-editor-slot > .cd-editor-bar { align-self: flex-end; align-items: center; min-height: 44px; margin-top: -60px; }');
    expect(css).toMatch(/\.cd-brief \{[^}]*margin-bottom: 4px;/);
    expect(css).toMatch(/\.cd-pane \{[^}]*gap: 12px;/);
    // A capped brief ends with its toggle; a lock note under it comes last
    // instead, and then the toolbar keeps its own row.
    sizes(400, 120);
    const { unmount } = render(<LanguageProvider><BriefZone label="Brief"><p>Prompt</p></BriefZone></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Show full brief' }).nextElementSibling).toBeNull();
    unmount();
    render(<LanguageProvider><BriefZone label="Brief" after={<p>Lock note</p>}><p>Prompt</p></BriefZone></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Show full brief' }).nextElementSibling).toBe(screen.getByText('Lock note'));
  });
});

it('keeps a full brief that still runs past the frame scrollable from the keyboard', () => {
  sizes(900, 120);
  const { container } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show full brief' }));
  sizes(900, 300);
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show full brief' }));
  const body = container.querySelector('.cd-brief__body')!;
  expect(body).toHaveAttribute('data-capped', 'false');
  expect(body).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('region', { name: 'Digit sum' })).toBe(body);
});

it('measures again when a note joins the brief, without re-subscribing on every render', async () => {
  sizes(80, 120);
  const view = (extra: boolean) => (
    <LanguageProvider>
      <BriefZone labelledBy="task-title" head={<h1 id="task-title">Digit sum</h1>}>
        <p>Write digitSum(n).</p>
        {extra && <p>Sign in to keep your progress.</p>}
      </BriefZone>
    </LanguageProvider>
  );
  const { rerender } = render(view(false));
  expect(screen.queryByRole('button', { name: 'Show full brief' })).toBeNull();
  sizes(200, 120);
  rerender(view(true));
  expect(await screen.findByRole('button', { name: 'Show full brief' })).toBeInTheDocument();
});

it('keeps the action bar reachable when the brief outgrows the frame: the pane scrolls and the editor keeps its floor', () => {
  const css = readFileSync(resolve(__dirname, '../src/coding/Coding.css'), 'utf8');
  expect(css).toMatch(/\.cd-workbench--activity \.cd-pane--editor \{ min-height: 0; overflow-x: hidden; overflow-y: auto;/);
  // The slot no longer shrinks below its content (min-height: 0 let the
  // editor's floor spill over the action bar); CodeMirror's zero basis keeps
  // long code from growing it.
  expect(css).toMatch(/\.cd-workbench--activity \.cd-pane--editor > \.cd-editor-slot \{ flex: 1 1 0; \}/);
  expect(css).toMatch(/\.cd-workbench--activity \.cd-editor--fill > \.cd-editor__cm \{ flex-basis: 0; \}/);
});
