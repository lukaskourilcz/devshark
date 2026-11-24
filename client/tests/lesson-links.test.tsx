import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { LessonView, RichText } from '../src/components/learn/LessonBody';

const runner = vi.hoisted(() => ({
  signals: [] as (AbortSignal | undefined)[],
  finish: [] as ((logs: string[]) => void)[],
}));
vi.mock('../src/coding/runner/run-tests', () => ({
  // A run that never finishes on its own, like a snippet with an endless loop,
  // unless a test finishes it through `runner.finish`.
  runCodeTests: ({ signal }: { signal?: AbortSignal }) => {
    runner.signals.push(signal);
    return new Promise((resolve) => {
      runner.finish.push((logs) => resolve({ logs, codeError: null, runnerUnavailable: false }));
    });
  },
}));
it('opens a case in Learn and keeps source links isolated in a new tab', () => {
  render(<RichText text={'Try [the case](/learn/forward-deployed-engineer/path/fde-v1-m02?activity=fde-v1-m02-cases-01). Read [the source](https://www.typescriptlang.org/docs/).'} />);
  expect(screen.getByRole('link', { name: 'the case' })).toHaveAttribute('href', '/learn/forward-deployed-engineer/path/fde-v1-m02?activity=fde-v1-m02-cases-01');
  expect(screen.getByRole('link', { name: 'the case' })).not.toHaveAttribute('target');
  expect(screen.getByRole('link', { name: 'the source' })).toHaveAttribute('rel', 'noreferrer noopener');
  expect(screen.getByRole('link', { name: 'the source' })).toHaveAttribute('target', '_blank');
});
it('leaves dangerous/unsupported destinations, HTML and inline-code examples as plain text', () => {
  const unsafe = [
    'javascript:alert', 'data:text/html,unsafe', 'http://example.invalid', '//example.invalid', '/admin',
    '/learn/../admin', '/learn/fde/../../admin', '/learn/fde/../web-developer', '/learn/./web-developer',
    '/learn/%2e%2e/admin', '/learn/%2E%2E/admin', '/learn/%2e%2e%2fadmin', '/learn/%252e%252e/admin',
    '/learn/web-developer%2f..%2fadmin', '/learn/web-developer%5c..%5cadmin', '/learn//web-developer',
  ];
  const text = unsafe.map((href, index) => `[unsafe ${index}](${href})`).join(' ')
    + ' [   ](https://example.invalid) <img src=x onerror=alert> `[code](https://example.invalid)` ``[double](https://example.invalid) `example` ``';
  const { container } = render(<RichText text={text} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('code')).toHaveTextContent('[code](https://example.invalid)');
  expect(container.querySelectorAll('code')[1]).toHaveTextContent('[double](https://example.invalid) `example`');
});

// Authored emphasis printed its asterisks: "name *which* cost function"
// (UX audit learn-21). Code, multiplication and globs keep theirs.
it('renders *emphasis* as <em> outside code spans only', () => {
  const { container } = render(<RichText text={'Best and worst name *which* cost function, an upper *and a lower* bound. `*literal*` stays, 2 * n * 3 stays, a*b*c stays, s3:* stays. See [the *docs*](https://www.typescriptlang.org/docs/) (*this* too).'} />);
  const ems = [...container.querySelectorAll('em')].map((em) => em.textContent);
  expect(ems).toEqual(['which', 'and a lower', 'this']);
  expect(container.querySelector('code')).toHaveTextContent('*literal*');
  expect(container).toHaveTextContent('2 * n * 3 stays, a*b*c stays, s3:* stays.');
  expect(container).not.toHaveTextContent('*which*');
  expect(screen.getByRole('link', { name: 'the *docs*' })).toBeInTheDocument();
});

it('renders authored case-bank links in row headings without interpreting HTML cells', () => {
  render(<LanguageProvider><LessonView lesson={{ id: 'case-bank', title: 'Case bank', sources: [], sections: [{ kind: 'table', caption: 'Cases', headers: ['Case', 'Focus'], rows: [
    ['[Dashboard](/learn/forward-deployed-engineer/path/fde-v1-m02?activity=fde-v1-m02-cases-dashboard)', '<img src=x> [Docs](https://www.typescriptlang.org/docs/)'],
    ['`[literal heading](https://example.invalid)`', '``[literal cell](https://example.invalid)``'],
  ] }] }} /></LanguageProvider>);
  expect(screen.getByRole('link', { name: 'Dashboard' }).closest('th')).toHaveAttribute('scope', 'row');
  expect(screen.getByRole('link', { name: 'Docs' }).closest('td')).not.toBeNull();
  expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  expect(screen.getByRole('table')).toHaveAccessibleName('Cases');
  expect(screen.queryByRole('link', { name: 'literal heading' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'literal cell' })).not.toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});

it('stops a running lesson example when the lesson goes away', () => {
  const view = render(<LanguageProvider><LessonView lesson={{ id: 'loops', title: 'Loops', sources: [], sections: [
    { kind: 'example', language: 'javascript', caption: 'Count down', code: 'while (true) {}', note: 'Nothing here is graded.' },
  ] }} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Run it' }));
  expect(runner.signals).toHaveLength(1);
  expect(runner.signals[0]?.aborted).toBe(false);
  view.unmount();
  expect(runner.signals[0]?.aborted).toBe(true);
});

it('opens the next lesson with its own example code, not the edits from the last one', () => {
  const lesson = (id: string, code: string) => ({ id, title: id, sources: [], sections: [
    { kind: 'example' as const, language: 'javascript', caption: 'Try it', code, note: 'Nothing here is graded.' },
  ] });
  const view = render(<LanguageProvider><LessonView lesson={lesson('first', 'first()')} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('Try it'), { target: { value: 'edited()' } });
  view.rerender(<LanguageProvider><LessonView lesson={lesson('second', 'second()')} /></LanguageProvider>);
  expect(screen.getByLabelText('Try it')).toHaveValue('second()');
});

it('keeps the lesson readable when a trace arrives without frames', () => {
  render(<LanguageProvider><LessonView lesson={{ id: 'empty-trace', title: 'Empty trace', sources: [], sections: [
    { kind: 'prose', body: 'The text around it still reads.' },
    { kind: 'trace', caption: 'A trace', trace: { shape: 'array', frames: [] } },
  ] }} /></LanguageProvider>);
  expect(screen.getByText('The text around it still reads.')).toBeInTheDocument();
  expect(screen.queryByText('A trace')).toBeNull();
});

it('lets only the latest run of a lesson example paint its output', async () => {
  runner.signals.length = 0;
  runner.finish.length = 0;
  const view = render(<LanguageProvider><LessonView lesson={{ id: 'double-run', title: 'Double run', sources: [], sections: [
    { kind: 'example', language: 'javascript', caption: 'Print', code: 'console.log(1)', note: 'Nothing here is graded.' },
  ] }} /></LanguageProvider>);
  const button = screen.getByRole('button', { name: 'Run it' });
  const outputRegion = () => view.container.querySelector('pre[role="status"]');
  const status = outputRegion();
  expect(status).toBeEmptyDOMElement();
  button.focus();
  // Two presses inside one task: the disabled state has not reached the DOM yet.
  act(() => { button.click(); button.click(); });
  expect(runner.signals).toHaveLength(2);
  expect(runner.signals[0]?.aborted).toBe(true);
  expect(runner.signals[1]?.aborted).toBe(false);
  await act(async () => { runner.finish[1](['newer']); });
  expect(outputRegion()).toBe(status);
  expect(status).toHaveTextContent('newer');
  expect(button).toHaveFocus();
  await act(async () => { runner.finish[0](['older']); });
  expect(view.container.querySelector('.lp-example__output')).toHaveTextContent('newer');
  expect(screen.getByRole('button', { name: 'Run it' })).toBeEnabled();
});
