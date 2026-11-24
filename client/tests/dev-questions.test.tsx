// /dev → Question bank: the question editor saves a new question once however
// fast Save is pressed, and keeps what the admin typed while the bank reloads.
import { useState } from 'react';
import { installNativeDialog } from './dialog-escape';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import QuestionEditor from '../src/components/dev/QuestionEditor';
import DevTriage from '../src/components/dev/DevTriage';
import DevQuestions from '../src/components/dev/DevQuestions';
import type { AdminQuestion } from '../src/lib/devApi';
import { server } from './mocks/server';

// jsdom has no modal dialogs: open and close the element as a browser would.
const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

async function dismissConfirmation(opener: HTMLElement) {
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('alertdialog');
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(cancel).toHaveFocus());
  fireEvent.keyDown(cancel, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(opener).toHaveFocus();
}

function renderEditor(props: Partial<Parameters<typeof QuestionEditor>[0]> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <LanguageProvider>
      <QuestionEditor open initial={null} categories={['react', 'css']} onClose={onClose} onSaved={onSaved} {...props} />
    </LanguageProvider>,
  );
  return { ...view, onSaved, onClose };
}

function fillNewQuestion() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'Which hook keeps state?' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Option 1' }), { target: { value: 'useState' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Option 2' }), { target: { value: 'useRef' } });
}

describe('/dev → the question editor', () => {
  it('returns from a dirty discard confirmation to the editor and then its opener', async () => {
    installNativeDialog();
    function EditorEntry() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Open editor</button>
        <QuestionEditor open={open} initial={null} categories={['react', 'css']} onClose={() => setOpen(false)} onSaved={vi.fn()} />
      </>;
    }
    render(<LanguageProvider><EditorEntry /></LanguageProvider>);
    const opener = screen.getByRole('button', { name: 'Open editor' });
    opener.focus();
    fireEvent.click(opener);
    const editor = await screen.findByRole('dialog');
    await waitFor(() => expect(editor.contains(document.activeElement)).toBe(true));
    const question = within(editor).getByRole('textbox', { name: 'Question' });
    fireEvent.change(question, { target: { value: 'Unfinished question' } });
    const cancel = within(editor).getByRole('button', { name: 'Cancel' });
    await dismissConfirmation(cancel);
    expect(question).toHaveValue('Unfinished question');
    fireEvent.keyDown(cancel, { key: 'Escape' });
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(editor).not.toBeVisible());
    expect(opener).toHaveFocus();
  });

  it('creates a new question once when Save is pressed twice before it renders', async () => {
    const sent: unknown[] = [];
    server.use(http.post('*/api/admin/save', async ({ request }) => {
      sent.push(await request.json());
      await new Promise((resolve) => setTimeout(resolve, 20));
      return HttpResponse.json({ ok: true, id: `dev-${sent.length}` });
    }));
    const { onSaved, onClose } = renderEditor();
    fillNewQuestion();
    const save = screen.getByRole('button', { name: 'Save' });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps the text being typed when the bank re-read hands it a new category list', () => {
    const { rerender } = renderEditor();
    fillNewQuestion();
    // The same categories in a new array, as every re-read of the bank builds.
    rerender(
      <LanguageProvider>
        <QuestionEditor open initial={null} categories={['react', 'css']} onClose={() => {}} onSaved={() => {}} />
      </LanguageProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Which hook keeps state?');
    expect(screen.getByRole('textbox', { name: 'Option 1' })).toHaveValue('useState');
  });
});

const question = (id: string): AdminQuestion => ({
  id, tags: [], introduction: '', question: `Question ${id}?`, options: ['Yes', 'No'], correctAnswer: 0, category: 'react',
  explanation: '', difficulty: 2, importance: 5, source: 'base', deleted: false, review: { active: true, reason: 'reviewed' },
});
const verdict = (mean: number) => ({ cat: 'react', diff: 2, rel: 2, disc: 2, fit: 2, clar: 2, mean, gate: false, greasons: [], dup: false, dec: 'cut', reasons: [], note: '' });

function renderTab(tab: 'triage' | 'questions', client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>{tab === 'triage' ? <DevTriage /> : <DevQuestions />}</LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('/dev → Quality triage', () => {
  it('shows again the rows a bulk delete did not reach when it stops on an error', async () => {
    const deleted: string[] = [];
    server.use(
      http.get('*/api/admin/questions', () => HttpResponse.json({ questions: ['t1', 't2', 't3'].map(question), categories: ['react'], reportCounts: {} })),
      http.get('*/api/admin/triage', () => HttpResponse.json({
        meta: { total: 3, keep: 0, cut: 3, generatedFrom: 'test', keepRule: 'test' },
        verdicts: { t1: verdict(1), t2: verdict(2), t3: verdict(3) },
      })),
      http.post('*/api/admin/delete', async ({ request }) => {
        const { id } = (await request.json()) as { id: string };
        if (id === 't2') return HttpResponse.json({ error: { code: 'internal_error', message: 'Internal error' } }, { status: 500 });
        deleted.push(id);
        return HttpResponse.json({ ok: true });
      }),
    );
    renderTab('triage');
    const opener = await screen.findByRole('button', { name: 'Delete all 3 shown' });
    await dismissConfirmation(opener);
    expect(deleted).toEqual([]);
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText(/deleted 1 before stopping/)).toBeInTheDocument();
    expect(deleted).toEqual(['t1']);
    // t1 is gone; t2 failed and t3 was never sent, so both are still listed.
    expect(screen.queryByText('Question t1?')).toBeNull();
    expect(screen.getByText('Question t2?')).toBeInTheDocument();
    expect(screen.getByText('Question t3?')).toBeInTheDocument();
  });
});

describe('/dev → Quality triage and the Question bank', () => {
  it('lets the Question bank tab drop a question deleted in triage', async () => {
    let bank = ['t1', 't2'];
    server.use(
      http.get('*/api/admin/questions', () => HttpResponse.json({ questions: bank.map(question), categories: ['react'], reportCounts: {} })),
      http.get('*/api/admin/triage', () => HttpResponse.json({
        meta: { total: 2, keep: 0, cut: 2, generatedFrom: 'test', keepRule: 'test' },
        verdicts: { t1: verdict(1), t2: verdict(2) },
      })),
      http.post('*/api/admin/delete', async ({ request }) => {
        const { id } = (await request.json()) as { id: string };
        bank = bank.filter((one) => one !== id);
        return HttpResponse.json({ ok: true });
      }),
    );
    // One cache for both tabs, kept fresh for a minute as the app's is.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    const triage = renderTab('triage', client);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText('Deleted t1')).toBeInTheDocument();
    triage.unmount();
    renderTab('questions', client);
    expect(await screen.findByText('Question t2?')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Question t1?')).toBeNull());
  });
});

describe('/dev → Question bank', () => {
  it('waits out the admin rate limit in a bulk delete instead of stopping at its fifth question', async () => {
    let bank = ['b1', 'b2', 'b3'];
    let limited = false;
    server.use(
      http.get('*/api/admin/questions', () => HttpResponse.json({ questions: bank.map(question), categories: ['react'], reportCounts: {} })),
      http.post('*/api/admin/delete', async ({ request }) => {
        const { id } = (await request.json()) as { id: string };
        // The admin bucket runs dry once, on the second question.
        if (id === 'b2' && !limited) {
          limited = true;
          return HttpResponse.json({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } }, { status: 429 });
        }
        bank = bank.filter((one) => one !== id);
        return HttpResponse.json({ ok: true });
      }),
    );
    renderTab('questions');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all questions on this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (3)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText('Removed 3 questions', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(limited).toBe(true);
    expect(bank).toEqual([]);
  });

  it('unselects and re-reads the questions a bulk delete removed before it stopped on an error', async () => {
    let bank = ['b1', 'b2', 'b3'];
    let reads = 0;
    server.use(
      http.get('*/api/admin/questions', () => {
        reads += 1;
        return HttpResponse.json({ questions: bank.map(question), categories: ['react'], reportCounts: {} });
      }),
      http.post('*/api/admin/delete', async ({ request }) => {
        const { id } = (await request.json()) as { id: string };
        if (id !== 'b1') return HttpResponse.json({ error: { code: 'internal_error', message: 'Internal error' } }, { status: 500 });
        bank = bank.filter((one) => one !== id);
        return HttpResponse.json({ ok: true });
      }),
    );
    renderTab('questions');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select question b1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select question b2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText(/removed 1 of 2 before stopping/)).toBeInTheDocument();
    // b1 went: the bank is read again and it leaves the list and the selection.
    await waitFor(() => expect(screen.queryByText('Question b1?')).toBeNull());
    expect(reads).toBe(2);
    expect(screen.getByRole('button', { name: 'Delete selected (1)' })).toBeInTheDocument();
  });

  it('counts in "Delete N fillers" only the served questions the server deletes, not unreviewed ones', async () => {
    const low = (id: string, active: boolean): AdminQuestion => ({ ...question(id), importance: 2, review: { active, reason: active ? 'reviewed' : 'unreviewed' } });
    server.use(
      http.get('*/api/admin/questions', () => HttpResponse.json({ questions: [low('f1', true), low('f2', false), question('k1')], categories: ['react'], reportCounts: {} })),
    );
    renderTab('questions');
    expect(await screen.findByRole('button', { name: 'Delete 1 filler' })).toBeInTheDocument();
  });

  it('drops a question deleted from its row out of the selection', async () => {
    let bank = ['b1', 'b2'];
    server.use(
      http.get('*/api/admin/questions', () => HttpResponse.json({ questions: bank.map(question), categories: ['react'], reportCounts: {} })),
      http.post('*/api/admin/delete', async ({ request }) => {
        const { id } = (await request.json()) as { id: string };
        bank = bank.filter((one) => one !== id);
        return HttpResponse.json({ ok: true });
      }),
    );
    renderTab('questions');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select question b1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select question b2' }));
    expect(screen.getByRole('button', { name: 'Delete selected (2)' })).toBeInTheDocument();
    const row = screen.getByText('Question b1?').closest('tr') as HTMLElement;
    const opener = within(row).getByRole('button', { name: 'Delete' });
    await dismissConfirmation(opener);
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(screen.queryByText('Question b1?')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Delete selected (1)' })).toBeInTheDocument();
  });
});

// F14-03: retry must recover either independently failing read.
it.each(['questions', 'triage', 'both'] as const)('retries both triage reads after %s failed', async (failed) => {
  let questionsReads = 0;
  let triageReads = 0;
  const triage = () => {
    triageReads++;
    return triageReads === 1 && failed !== 'questions'
      ? HttpResponse.json({ error: { code: 'internal_error', message: 'Internal error' } }, { status: 500 })
      : HttpResponse.json({ meta: { total: 1, keep: 0, cut: 1, generatedFrom: 'test', keepRule: 'test' }, verdicts: { retry: verdict(1) } });
  };
  server.use(
    http.get('*/api/admin/questions', () => {
      questionsReads++;
      return questionsReads === 1 && failed !== 'triage'
        ? HttpResponse.json({ error: { code: 'internal_error', message: 'Internal error' } }, { status: 500 })
        : HttpResponse.json({ questions: [question('retry')], categories: ['react'], reportCounts: {} });
    }),
    http.get('*/api/admin/triage', triage), http.get('*/triage-verdicts.json', triage),
  );
  renderTab('triage');
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Question retry?')).toBeInTheDocument();
  expect(questionsReads).toBeGreaterThanOrEqual(2);
  expect(triageReads).toBeGreaterThanOrEqual(2);
});
