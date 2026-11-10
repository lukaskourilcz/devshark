import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { BigOIntroduction } from '../src/components/Roadmap';
import BigOPage from '../src/components/BigOPage';
import { server } from './mocks/server';

beforeAll(() => import('../src/components/learn/LearnLesson'));
const lesson = { id: 'dsa-v1-d01-l1', title: 'Complexity Basics', sources: [], sections: [{ kind: 'prose', body: 'Count the operations as the input grows.' }] };
function mount(failReading = false, at = '/learn/big-o', failFirstAttempt = false) {
  const reads: string[] = [];
  server.use(http.get('*/api/quiz/roadmap', ({ request }) => {
    const params = new URL(request.url).searchParams;
    if (params.get('resource') === 'lesson') {
      reads.push('reading');
      return failReading ? HttpResponse.json({ error: { code: 'unavailable', message: 'Unavailable' } }, { status: 503 }) : HttpResponse.json({ lesson, hash: 'fixture-hash' });
    }
    if (params.get('level')) {
      reads.push('attempt');
      if (failFirstAttempt) {
        failFirstAttempt = false;
        return HttpResponse.json({ error: { code: 'unavailable', message: 'Questions unavailable' } }, { status: 503 });
      }
      return HttpResponse.json({ kind: 'level', topic: 'dsa', ref: 1, title: 'Complexity Basics', passPct: 75, sessionId: 'fixture-attempt', questions: [{ id: 'fixture-q', category: 'dsa', difficulty: 1, question: 'Which count grows with the input?', options: ['n', '1'], introduction: '', tags: [] }] });
    }
    return HttpResponse.json({ topics: [], structure: {} });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[at]}><LanguageProvider><Routes><Route path="/learn/big-o" element={<><BigOIntroduction /><Where /></>} /><Route path="/big-o" element={<><BigOPage /><Where /></>} /></Routes></LanguageProvider></MemoryRouter></QueryClientProvider>);
  return reads;
}
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}
describe('Learn lesson reading', () => {
  it('shows the shared lesson without opening an attempt until Start the questions', async () => {
    const reads = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Complexity Basics' }));
    await screen.findByRole('heading', { name: 'Complexity Basics', level: 1 });
    expect(reads).toEqual(['reading']);
    expect(screen.getByText('Count the operations as the input grows.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start the questions' }));
    await screen.findByText('Which count grows with the input?');
    expect(reads).toEqual(['reading', 'attempt']);
  });
  it('retries an unavailable question attempt without reopening the reading', async () => {
    const reads = mount(false, '/learn/big-o', true);
    fireEvent.click(screen.getByRole('button', { name: 'Complexity Basics' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start the questions' }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('alert')).toHaveTextContent('Server error. Try again in a moment.');
    fireEvent.click(retry);
    expect(await screen.findByText('Which count grows with the input?')).toBeInTheDocument();
    expect(reads).toEqual(['reading', 'attempt', 'attempt']);
  });

  it('names where Back goes and ends on one row with the only primary (learn-05)', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Complexity Basics' }));
    await screen.findByRole('heading', { name: 'Complexity Basics', level: 1 });
    const start = screen.getByRole('button', { name: 'Start the questions' });
    expect(start).toHaveClass('ss-swim-cta');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    const row = start.closest('.lp-lesson-start');
    expect(row).not.toBeNull();
    expect(screen.queryByText('Reading is optional. It records no progress and earns no XP.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip to questions' })).toBeNull();
    const back = screen.getByRole('button', { name: 'Big O introduction' });
    expect(back).toHaveClass('lp-lesson-back');
    fireEvent.click(back);
    await screen.findByRole('button', { name: 'Complexity Basics' });
    expect(screen.queryByRole('button', { name: 'Start the questions' })).toBeNull();
  });
  it('lines Back\u2019s arrow up with the h1 by pulling back the ghost button\u2019s padding (learn-05)', () => {
    const css = readFileSync(new URL('../src/components/paths/LearningPaths.css', import.meta.url), 'utf8');
    expect(css).toContain('.lp-page > .lp-lesson-back { align-self: flex-start; margin-inline-start: -12px; }');
  });
  it('keeps questions available when public reading fails', async () => {
    const reads = mount(true);
    fireEvent.click(screen.getByRole('button', { name: 'Complexity Basics' }));
    await screen.findByText('The lesson could not load. Try again or start the questions.');
    expect(reads).toEqual(['reading']);
    fireEvent.click(screen.getByRole('button', { name: 'Start the questions' }));
    await waitFor(() => expect(reads).toEqual(['reading', 'attempt']));
    await screen.findByText('Which count grows with the input?');
  });
});

// The guide and the introduction said the same paragraph, and the guide ended
// on a link to a page that listed the lessons again (UX audit learn-19).
describe('Big O guide and introduction', () => {
  it('/learn/big-o opens with the Learn header, the guide as the link above the h1, and the two lessons in one row', () => {
    mount();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Big O introduction' });
    expect(h1).toHaveClass('ss-section-title');
    const guide = screen.getByRole('link', { name: 'Big O guide' });
    expect(guide).toHaveAttribute('href', '/big-o');
    expect(guide.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Two short lessons/)).toBeNull();
    const first = screen.getByRole('button', { name: 'Complexity Basics' });
    const second = screen.getByRole('button', { name: 'Big O and Growth' });
    expect(first).toHaveClass('ss-swim-cta');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    expect(first.closest('.bo-lessons')).toBe(second.closest('.bo-lessons'));
    expect(first.closest('li')).toHaveTextContent('Lesson 1 of 2');
    expect(second.closest('li')).toHaveTextContent('Lesson 2 of 2');
  });

  it('/big-o ends on one row whose one primary opens lesson 1 directly', async () => {
    const reads = mount(false, '/big-o');
    expect(screen.getByRole('heading', { level: 2, name: 'Two free lessons' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /learning path/ })).toBeNull();
    const start = screen.getByRole('button', { name: 'Start lesson 1' });
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    fireEvent.click(start);
    await screen.findByRole('heading', { name: 'Complexity Basics', level: 1 });
    expect(reads).toEqual(['reading']);
    // The lesson takes focus so a screen reader starts there, without the
    // browser's ring round the whole page (it is not a Tab stop).
    const lessonRoot = document.querySelector<HTMLElement>('.lp-page')!;
    await waitFor(() => expect(document.activeElement).toBe(lessonRoot));
    expect(lessonRoot.style.outline).toBe('none');
    // The parameter is dropped once the lesson is open, so Back and a reload
    // land on the introduction.
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/learn\/big-o$/));
    fireEvent.click(screen.getByRole('button', { name: 'Big O introduction' }));
    await screen.findByRole('button', { name: 'Complexity Basics' });
  });
});
