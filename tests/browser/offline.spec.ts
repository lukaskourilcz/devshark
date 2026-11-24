import { test, expect, type Page } from './console-clean';
import { localAuth, storeFakeSession } from './fake-session';

// A signed-in learner finishes a quiz and the connection drops as the result
// goes to the account. The result waits on this device
// (lib/pendingQuizReceipts.ts) and goes out once when the browser is back
// online (components/PendingQuizResults.tsx). learning-release.spec.ts covers
// the replay with a synthetic 'online' event while the network stays up; this
// spec takes the browser offline for real with context.setOffline. The wire
// fixtures stand in for the server: they establish no grading or account
// write, which the SQL and contract tests cover.

const RECEIPT = 'offline-spec-signed-receipt';
const questions = [
  { id: 'offline-typeof', category: 'javascript', difficulty: 1, introduction: '', question: 'What does typeof null return?', options: ['"object"', '"null"', '"undefined"', '"number"'] },
  { id: 'offline-number', category: 'javascript', difficulty: 1, introduction: '', question: 'Which value is a number?', options: ['42', '"42"', 'null', 'undefined'] },
];
const grade = {
  totalQuestions: 2, correctAnswers: 1, percentage: 50, questXp: 0, resultReceipt: RECEIPT,
  results: [
    { questionId: 'offline-typeof', selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'typeof null is "object", kept for compatibility.' },
    { questionId: 'offline-number', selectedIndex: 2, correctAnswer: 0, isCorrect: false, explanation: '42 is a numeric literal; null is not a number.' },
  ],
};

/** The quiz API, and every POST /api/user/stats. The first write takes the
 * browser offline and fails as a dropped connection would. */
async function quizServer(page: Page, dropFirstReceipt = true) {
  const grades: unknown[] = [];
  const attempts: unknown[] = [];
  const delivered: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/quiz/questions') {
      return route.fulfill({ json: { sessionId: 'offline-spec-session-unique-attempt-key', expiresAt: Date.now() + 3_600_000, questions } });
    }
    if (url.pathname === '/api/quiz/submit') {
      grades.push(route.request().postDataJSON());
      return route.fulfill({ json: grade });
    }
    if (url.pathname === '/api/user/stats' && route.request().method() === 'POST') {
      attempts.push(route.request().postDataJSON());
      if (dropFirstReceipt && attempts.length === 1) {
        await page.context().setOffline(true);
        return route.abort('internetdisconnected');
      }
      delivered.push(route.request().postDataJSON());
      return route.fulfill({ json: { data: null, applied: false, questXp: 0 } });
    }
    if (url.pathname === '/api/user/xp') return route.fulfill({ json: { data: { quest_xp: 0, by_subject: {} } } });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'local offline fixture' } } });
  });
  return { attempts, delivered, grades };
}

async function prepareQuiz(page: Page) {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('devshark:consent', JSON.stringify({ version: 2, analytics: false, marketing: false, decidedAt: Date.now() }));
    localStorage.setItem('devquiz:quiz-setup:v1', JSON.stringify({ count: 10, difficulty: 'mixed', categories: ['javascript'] }));
  });
  await storeFakeSession(page);
  await localAuth(page);
}

test('a quiz result saved while offline goes to the account once when the connection returns', async ({ page, context }) => {
  await prepareQuiz(page);
  const server = await quizServer(page);

  await page.goto('/quiz');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start quiz', exact: true }).click();
  await page.getByRole('radio', { name: '"object"', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'null', exact: true }).click();
  await page.getByRole('button', { name: 'Submit quiz', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 / 2');

  // The write failed offline: the result waits on this device, and the page says so.
  const status = page.locator('.quiz-save-status');
  await expect(status).toHaveText('Waiting to sync. We’ll retry when you reconnect or reopen devShark.');
  await expect(page.getByText('You’re offline. This screen stays available; actions resume when the connection returns.')).toBeVisible();
  expect(server.attempts).toHaveLength(1);
  expect(server.delivered).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('devshark:pending-quiz-receipts:v2'))).toContain(RECEIPT);

  // Back online: one replay records it, and the result screen hears of it.
  await context.setOffline(false);
  await expect(status).toHaveText('Saved to your account');
  await expect(page.getByText('Connection restored.')).toBeVisible();
  expect(server.delivered).toEqual([expect.objectContaining({ result_receipt: RECEIPT })]);
  expect(await page.evaluate(() => localStorage.getItem('devshark:pending-quiz-receipts:v2'))).toBeNull();

  // A later reconnect finds nothing waiting and sends nothing.
  await context.setOffline(true);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(750);
  expect(server.attempts).toHaveLength(2);
  expect(server.delivered).toHaveLength(1);
  await expect(status).toHaveText('Saved to your account');
});

test('Submit made offline replays the same answers once on reconnect', async ({ page, context }) => {
  await prepareQuiz(page);
  const server = await quizServer(page, false);
  await page.goto('/quiz');
  await page.getByRole('button', { name: 'Start quiz', exact: true }).click();
  await page.getByRole('radio', { name: '"object"', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'null', exact: true }).click();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Submit quiz', exact: true }).click();
  await expect(page.getByText('Answers saved in this tab. We’ll submit them when you reconnect.')).toBeVisible();
  expect(server.grades).toHaveLength(0);
  expect(server.delivered).toHaveLength(0);
  await context.setOffline(false);
  await expect(page.locator('.quiz-save-status')).toHaveText('Saved to your account');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect(server.grades).toEqual([expect.objectContaining({
    answers: { 'offline-typeof': 0, 'offline-number': 2 },
    sessionId: 'offline-spec-session-unique-attempt-key',
  })]);
  expect(server.delivered).toHaveLength(1);
});
