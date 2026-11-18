import { test as base, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';

// Specs import `test` and `expect` from here instead of '@playwright/test'.
// The `test` below fails a test whose pages logged a console.error or threw
// an unhandled error or rejection, even when every assertion passed. It hooks
// the test's `context`, so it sees `page`, a second tab opened with
// page.context().newPage() and any popup. Pages from browser.newContext()
// (daily.spec.ts and public.spec.ts open one with JavaScript off) belong to
// another context and stay outside it.
//
// Two kinds of console error say nothing about the app and do not fail a
// test; their count and text go into the report as the `console-ignored`
// attachment. Chromium logs "Failed to load resource: ..." for every request
// that answers 4xx or 5xx or is aborted, and specs answer those on purpose.
// It logs "Blocked script execution in 'about:srcdoc' ..." when Playwright's
// own page scripts meet a frame sandboxed without allow-scripts (the admin
// email preview, sandbox=""); a srcdoc frame with no script of its own logs
// it too.
//
// A spec that breaks the app on purpose (a dropped chunk) names the messages
// it expects with allowConsoleErrors(page, ...patterns). A string matches
// anywhere in the message, a RegExp is tested against it.

export * from '@playwright/test';

type Pattern = string | RegExp;

interface Problem {
  kind: 'console.error' | 'pageerror';
  text: string;
  where: string;
}

const IGNORED_LINES = [
  /^Failed to load resource\b/,
  /^Blocked script execution in '[^']*' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/,
];
const allowed = new WeakMap<BrowserContext, Pattern[]>();

/** Lets messages matching any pattern pass for the rest of this test. */
export function allowConsoleErrors(page: Page, ...patterns: Pattern[]): void {
  if (patterns.length === 0) throw new Error('allowConsoleErrors needs at least one pattern');
  const context = page.context();
  allowed.set(context, [...(allowed.get(context) ?? []), ...patterns]);
}

function matches(text: string, pattern: Pattern): boolean {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

function locate(message: ConsoleMessage): string {
  const { url, lineNumber } = message.location();
  return url ? `${url}:${lineNumber + 1}` : message.page()?.url() ?? '';
}

export const test = base.extend<{ consoleClean: void }>({
  consoleClean: [async ({ context }, use, testInfo) => {
    const problems: Problem[] = [];
    const ignored: string[] = [];
    const watched = new WeakSet<Page>();
    const watch = (page: Page) => {
      if (watched.has(page)) return;
      watched.add(page);
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (IGNORED_LINES.some((line) => line.test(text))) ignored.push(`${text} (${locate(message)})`);
        else problems.push({ kind: 'console.error', text, where: locate(message) });
      });
      page.on('pageerror', (error) => {
        problems.push({ kind: 'pageerror', text: error.stack || String(error), where: page.url() });
      });
    };
    context.pages().forEach(watch);
    context.on('page', watch);

    await use();

    context.off('page', watch);
    if (ignored.length > 0) {
      await testInfo.attach('console-ignored', {
        body: `${ignored.length} line(s) from the network or a sandboxed frame, not counted as failures:\n${ignored.join('\n')}\n`,
        contentType: 'text/plain',
      });
    }
    const patterns = allowed.get(context) ?? [];
    const offending = problems.filter((problem) => !patterns.some((pattern) => matches(problem.text, pattern)));
    if (offending.length === 0) return;
    const report = offending
      .map((problem, index) => `${index + 1}. ${problem.kind} at ${problem.where || 'unknown'}\n${problem.text}`)
      .join('\n\n');
    const summary = `${offending.length} console error(s) or unhandled error(s) during the test:\n\n${report}`;
    // A test that already failed keeps its first failure as the reported one.
    if (testInfo.status !== 'passed') {
      await testInfo.attach('console-errors', { body: `${summary}\n`, contentType: 'text/plain' });
      return;
    }
    throw new Error(`${summary}\n\nFix the cause, or name the expected message with allowConsoleErrors(page, pattern).`);
  }, { auto: true }],
});
