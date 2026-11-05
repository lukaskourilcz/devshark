// The shared question shell (UX audit U2, questions-03 and questions-06): one
// 880px question column, one panel, and a question block of one height so the
// answers start at the same y on every question.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { QuestionShell } from '../src/components/question';

const css = readFileSync(new URL('../src/components/question/question.css', import.meta.url), 'utf8');

function addSheet(): CSSStyleSheet {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return style.sheet!;
}

describe('QuestionShell', () => {
  it('draws the header, the question block and the answers inside one panel, and the actions under it', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <QuestionShell
        ref={ref}
        questionId="q-text"
        header={<div data-testid="header" />}
        question={<p>What does typeof null return?</p>}
        actions={<div data-testid="actions" />}
      >
        <div data-testid="answers" />
      </QuestionShell>,
    );
    const panels = container.querySelectorAll('.ss-panel');
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    expect(panel).toContainElement(screen.getByTestId('header'));
    expect(panel).toContainElement(screen.getByTestId('answers'));
    expect(panel).not.toContainElement(screen.getByTestId('actions'));
    // The question block is the focus target and the answer list's name.
    expect(ref.current).toBe(document.getElementById('q-text'));
    expect(ref.current).toHaveAttribute('tabindex', '-1');
    expect(ref.current).toHaveTextContent('What does typeof null return?');
    expect(ref.current).toHaveAttribute('data-stable', 'true');
    // The order on screen: header, question, answers; actions after the panel.
    const order = [...container.querySelectorAll('[data-testid], .ss-question__block')].map((el) => el.getAttribute('data-testid') ?? 'question');
    expect(order).toEqual(['header', 'question', 'answers', 'actions']);
  });

  it('lets a page with one question drop the reserved block height', () => {
    render(<QuestionShell questionId="q" question="Q?" stable={false} focusable={false} />);
    const block = document.getElementById('q')!;
    expect(block).toHaveAttribute('data-stable', 'false');
    expect(block).not.toHaveAttribute('tabindex');
  });

  it('is the 880px question column with a block of one reserved height', () => {
    addSheet();
    render(<QuestionShell questionId="q" question="Q?" />);
    const shell = document.querySelector('.ss-question') as HTMLElement;
    expect(getComputedStyle(shell).maxWidth).toBe('var(--ss-width-question)');
    expect(getComputedStyle(shell).marginLeft).toBe('auto');
    const block = document.getElementById('q')!;
    expect(getComputedStyle(block).minHeight).toBe('var(--ss-question-block-min)');
    expect(getComputedStyle(block).maxHeight).toBe('var(--ss-question-block-max)');
    expect(getComputedStyle(block).overflowY).toBe('auto');
    // No accent edge on the panel: one surface, the .ss-panel stock.
    expect(css).not.toMatch(/border-top:\s*4px/);
    expect(css).toMatch(/--ss-question-block-min:\s*128px/);
    expect(css).toMatch(/--ss-question-block-max:\s*40vh/);
  });
});
