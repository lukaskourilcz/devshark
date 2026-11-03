// Opening a reading (/learn/big-o's lesson 1) asks for the lesson with the
// press, while the reader's code is still loading, and draws the reading as
// soon as that code is in, without React's 300 ms hold on a boundary that
// showed its fallback (perf baseline #587 C19 follow-up: the lazy reader had
// made a reading open about 0.4 s later than when it was in the map's chunk).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { BigOIntroduction } from '../src/components/learn/BigOIntroduction';
import { server } from './mocks/server';

// The reader's code arrives only when the test lets it.
const gate = vi.hoisted(() => {
  let open = () => {};
  const arrived = new Promise<void>((resolve) => { open = resolve; });
  return { arrived, open: () => open() };
});
vi.mock('../src/components/learn/LearnLesson', async (importOriginal) => {
  await gate.arrived;
  return importOriginal();
});
// The lazy boundary is the path that suspends; a load that succeeds must not use it.
const boundary = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../src/components/ShellPartBoundary', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/components/ShellPartBoundary')>();
  function CountedBoundary(props: import('react').ComponentProps<typeof real.ShellPartBoundary>) {
    boundary.renders += 1;
    return <real.ShellPartBoundary {...props} />;
  }
  return { ...real, ShellPartBoundary: CountedBoundary };
});

const PROSE = 'Count the operations as the input grows.';
const lesson = { id: 'dsa-v1-d01-l1', title: 'Complexity Basics', sources: [], sections: [{ kind: 'prose', body: PROSE }] };

describe('opening a reading', () => {
  it('asks for the lesson before the reader’s code is in, once, and draws it as soon as the code arrives', async () => {
    const lessonReads: string[] = [];
    server.use(http.get('*/api/quiz/roadmap', ({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get('resource') === 'lesson') {
        lessonReads.push(params.get('id') ?? '');
        return HttpResponse.json({ lesson, hash: 'fixture-hash' });
      }
      return HttpResponse.json({ topics: [], structure: {} });
    }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/learn/big-o']}>
          <LanguageProvider><BigOIntroduction /></LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complexity Basics' }));
    await waitFor(() => expect(lessonReads).toEqual(['dsa-v1-d01-l1']));
    expect(screen.queryByText(PROSE)).not.toBeInTheDocument();
    // Let the read's answer settle in the cache before the code arrives.
    await new Promise((resolve) => setTimeout(resolve, 50));

    gate.open();
    expect(await screen.findByText(PROSE, undefined, { timeout: 2000 })).toBeInTheDocument();
    // Drawn from state, not by suspending: React holds a boundary that showed
    // its fallback 300 ms before it draws what arrived (its production build;
    // the test build skips that hold, so the boundary count pins it without
    // depending on import/CPU wall time on a busy machine).
    expect(boundary.renders).toBe(0);
    expect(screen.getByRole('button', { name: 'Start the questions' })).toBeInTheDocument();
    // The reader took the opener's answer instead of asking again.
    expect(lessonReads).toEqual(['dsa-v1-d01-l1']);
  });
});
