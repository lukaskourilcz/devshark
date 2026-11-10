import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { publicLesson } from '../../lib/learn-lessons';
import { localAuth, storeFakeSession } from './fake-session';

// These tests exercise the built UI with local wire fixtures. They do not
// establish server grading or leaderboard writes; SQL and preview smoke
// checks cover those boundaries independently.
const longCode = `const names = [${Array.from({ length: 24 }, (_, i) => `"learner${i}"`).join(', ')}];`;

async function prepare(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(theme => {
    localStorage.setItem('devquiz:color-mode', theme);
    localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
  }, theme);
}

async function challenge(page: Page) {
  const completions: unknown[] = [];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/quiz/challenge') {
      if (url.searchParams.get('resource') === 'leaderboard') return route.fulfill({ json: {
        top: [{ id: 'one', name: 'calmShark1', score: 8, createdAt: '2026-10-13T10:00:00Z', topics: ['javascript', 'react'], allTopics: false },
          { id: 'two', name: 'braveShark2', score: 7, createdAt: '2026-10-13T10:00:00Z', topics: ['javascript'], allTopics: true }], champion: null,
      } });
      if (url.searchParams.get('resource') === 'complete') {
        completions.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true, awarded: false, score: 1, xp: 0, record: null } });
      }
      const exclude = new Set((url.searchParams.get('exclude') ?? '').split(','));
      return route.fulfill({ json: { sessionId: 'local-session', runToken: 'local-run', questions: Array.from({ length: 12 }, (_, i) => ({
        id: `local-${i}`, category: 'javascript', difficulty: 1,
        question: `Question ${i + 1}: which value is a number?\n\n\`\`\`javascript\n${longCode}\n\`\`\``,
        options: ['42', '"42"', 'null', 'undefined'],
      })).filter(q => !exclude.has(q.id)) } });
    }
    if (url.pathname === '/api/quiz/submit') {
      const body = route.request().postDataJSON() as { answers: Record<string, number> };
      const [questionId, selectedIndex] = Object.entries(body.answers)[0];
      const correct = selectedIndex === 0;
      return route.fulfill({ json: { totalQuestions: 1, correctAnswers: Number(correct), percentage: correct ? 100 : 0, questXp: 0,
        results: [{ questionId, selectedIndex, correctAnswer: 0, isCorrect: correct, explanation: '42 has no quotation marks, so it is a number.', scoreProof: `local-proof-${questionId}` }],
      } });
    }
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'local fixture' } } });
  });
  return completions;
}

for (const theme of ['light', 'dark'] as const) for (const width of [360, 1440]) {
  test(`${theme} ${width}px: Skill Check keeps question width and reviews the accepted answers`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page, theme);
    const questions = [
      { id: 'skill-code', category: 'javascript', difficulty: 1, question: `What does typeof null return?\n\n\`\`\`javascript\n${longCode}\n\`\`\``, options: ['object', 'string', 'null', 'undefined'] },
      { id: 'skill-plain', category: 'javascript', difficulty: 1, question: 'Which value is a number?', options: ['42', '"42"', 'null', 'undefined'] },
    ];
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      const resource = url.searchParams.get('resource');
      if (url.pathname === '/api/quiz/roadmap') {
        if (resource === 'progress') return route.fulfill({ json: { data: {}, extra: { unlocked: [] } } });
        if (resource === 'learning-path-catalog') return route.fulfill({ json: { versions: {}, paths: [] } });
        if (resource === 'placement') {
          if (route.request().method() === 'GET') return route.fulfill({ json: { done: false, round: 1, totalRounds: 1, difficulty: 1, asked: 0, total: 2, idkCountsAsMiss: true, placementToken: 'local-placement', questions } });
          return route.fulfill({ json: { done: true, correct: 1, total: 2, difficulty: 1, unlockedPreview: [], review: [
            { questionId: 'skill-code', selectedIndex: 1, correctAnswer: 0, isCorrect: false, explanation: 'typeof null is object for historical compatibility.' },
            { questionId: 'skill-plain', selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: '42 is a numeric literal.' },
          ] } });
        }
        return route.fulfill({ json: { topics: ['javascript'], structure: { javascript: { levels: [{ level: 1, title: 'Values', difficulty: 1, questionCount: 8 }], checkpoints: [] } } } });
      }
      return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'local fixture' } } });
    });
    await page.goto('/learn');
    await page.getByRole('button', { name: /Skill check/ }).click();
    await page.getByRole('button', { name: 'Start placement', exact: true }).click();
    const stem = page.locator('#placement-question');
    await expect(stem.locator('pre')).toBeVisible();
    const codingWidth = (await stem.boundingBox())!.width;
    await page.getByRole('radio', { name: 'string', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(stem).toContainText('Which value is a number?');
    expect(Math.abs((await stem.boundingBox())!.width - codingWidth)).toBeLessThan(2);
    await page.getByRole('radio', { name: '42', exact: true }).click();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    const review = page.locator('.rm-placement-review');
    await expect(review.locator('article')).toHaveCount(2);
    await expect(review).toContainText('Your answer: string');
    await expect(review).toContainText('Correct answer: object');
    await expect(review).toContainText('typeof null is object for historical compatibility.');
    await expect(review).toContainText('42 is a numeric literal.');
    await expect(page.getByRole('button', { name: 'Share result', exact: true })).toHaveCount(0);
    await expect(page.getByText('We opened the paths that match where you are. You can retake this anytime.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`${theme} ${width}px: Challenge has a full-width code block, feedback under the answers and positive-only automatic completion`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page, theme);
    const completions = await challenge(page);
    await page.goto('/challenge');
    await expect(page.getByText(/each question has 90 seconds/)).toBeVisible();
    await expect(page.getByText('Relaxed pace')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('timer')).toContainText('1:30');
    const code = page.locator('#challenge-question pre');
    await expect(code).toBeVisible();
    const answers = page.getByRole('radiogroup');
    await expect(answers).toBeVisible();
    const codeBox = await code.boundingBox();
    const answersBox = await answers.boundingBox();
    expect(Math.abs(codeBox!.width - answersBox!.width)).toBeLessThan(2);
    expect(await code.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByRole('radio', { name: '42', exact: true }).click();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    // UX audit questions-01: the verdict sits in normal flow under the
    // answers, inside the panel, so it never covers them; it is drawn at full
    // opacity on its own tinted surface.
    const feedback = page.locator('.ss-question-feedback').filter({ hasText: '42 has no quotation marks' });
    await expect(feedback.getByRole('status')).toBeVisible();
    const appearance = await feedback.locator('.astryx-banner').evaluate(el => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, opacity: style.opacity };
    });
    expect(appearance.opacity).toBe('1');
    expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)');
    const gradedAnswers = await answers.boundingBox();
    expect((await feedback.boundingBox())!.y).toBeGreaterThanOrEqual(gradedAnswers!.y + gradedAnswers!.height);
    await page.screenshot({ path: info.outputPath(`challenge-feedback-${theme}-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Next question', exact: true }).click();
    await expect(page.getByRole('timer')).toContainText('1:30');
    for (let strike = 0; strike < 3; strike++) {
      await page.getByRole('radio', { name: '"42"', exact: true }).click();
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await page.getByRole('button', { name: strike === 2 ? 'See result' : 'Next question', exact: true }).click();
    }
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Run ended');
    await expect.poll(() => completions.length).toBe(1);
    await expect(page.getByText('Save your score', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Play again', exact: true }).click();
    for (let strike = 0; strike < 3; strike++) {
      await page.getByRole('radio', { name: '"42"', exact: true }).click();
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await page.getByRole('button', { name: strike === 2 ? 'See result' : 'Next question', exact: true }).click();
    }
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Run ended');
    expect(completions).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`${theme} ${width}px: Big O guide reflows at 200% text size and opens its first free lesson`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page, theme);
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'local fixture' } } }));
    await page.goto('/big-o');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Big O');
    // The guide ends on one row whose one primary opens lesson 1 itself
    // (UX audit learn-19), not a link to the page that lists the lessons.
    const start = page.getByRole('button', { name: 'Start lesson 1', exact: true });
    await expect(start).toBeVisible();
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const brand = await page.getByRole('link', { name: 'devShark home', exact: true }).boundingBox();
    const login = await page.getByRole('button', { name: 'Sign in', exact: true }).boundingBox();
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(login!.x);
    const examples = page.getByRole('region', { name: 'Common patterns', exact: true });
    await examples.focus();
    await expect(examples).toBeFocused();
    if (await examples.evaluate(el => el.scrollWidth > el.clientWidth)) {
      await examples.press('ArrowRight');
      await expect.poll(() => examples.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
    const findings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(findings.violations.map(v => v.id)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`big-o-${theme}-${width}-200.png`), fullPage: true });
    await start.click();
    await expect(page.getByRole('button', { name: 'Big O introduction', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/learn\/big-o$/);
  });
}


for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Learn reading reflows and starts no attempt before the learner asks`, async ({ page }) => {
    await prepare(page, theme);
    let attempts = 0;
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/quiz/roadmap' && url.searchParams.get('resource') === 'lesson') {
        return route.fulfill({ json: publicLesson(url.searchParams.get('id')!) });
      }
      if (url.pathname === '/api/quiz/roadmap' && url.searchParams.get('level')) {
        attempts++;
        const base = { category: 'dsa', difficulty: 1, introduction: '', tags: [], options: ['n', '1', '0', 'undefined'] };
        return route.fulfill({ json: { kind: 'level', topic: 'dsa', ref: 1, title: 'Complexity Basics', passPct: 75, sessionId: 'fixture-attempt', questions: [
          { ...base, id: 'fixture-q', question: 'Which count grows with the input?\n\n```js\nconst count = names.length;\n```' },
          { ...base, id: 'fixture-q2', question: 'Which count grows with the input?\n\n```js\nconst count = items.length;\n```' },
        ] } });
      }
      if (url.pathname === '/api/quiz/roadmap' && url.searchParams.get('resource') === 'answer') {
        return route.fulfill({ json: { selectedIndex: 1, correctAnswer: 0, isCorrect: false, explanation: 'The number of elements grows with the input. The length is n, not a constant.' } });
      }
      return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'local fixture' } } });
    });
    await page.goto('/learn/big-o');
    await page.getByRole('button', { name: 'Complexity Basics', exact: true }).click();
    await expect(page.locator('.lp-lesson')).toBeVisible();
    expect(attempts).toBe(0);
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px`).toBe(true);
    }
    const findings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(findings.violations.map(v => v.id)).toEqual([]);
    const start = page.getByRole('button', { name: 'Start the questions' });
    await page.setViewportSize({ width: 1280, height: 733 });
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Which count grows with the input?', { exact: true })).toBeVisible();
    expect(attempts).toBe(1);
    const stem = page.locator('#lesson-question');
    const answer = page.getByRole('radio', { name: '1', exact: true });
    const size = (el: Element) => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(await stem.evaluate(size)).toBeCloseTo(0.85 * 1.15, 3);
    expect(await stem.locator('pre code').evaluate(size)).toBeCloseTo(0.6375 * 1.15, 3);
    expect(await answer.evaluate(size)).toBeCloseTo(0.85 * 1.15, 3);
    await expect(page.getByText(/Press 1.4 to answer/)).toHaveCount(0);
    await stem.press('2');
    const card = page.locator('.ss-question__panel');
    const next = card.getByRole('button', { name: 'Continue', exact: true });
    await expect(next).toBeFocused();
    const counter = card.getByText('Question 1 of 2', { exact: true });
    const report = card.getByRole('button', { name: 'Flag this question as wrong or misleading' });
    await expect(card.locator('.ss-question-header__row').first().getByRole('button', { name: 'Exit lesson' })).toBeVisible();
    const [cardBox, reportBox, counterBox, nextBox] = await Promise.all([
      card.boundingBox(), report.boundingBox(), counter.boundingBox(), next.boundingBox(),
    ]);
    expect(cardBox!.y).toBeGreaterThanOrEqual(0);
    expect(cardBox!.y + cardBox!.height).toBeLessThan(733);
    expect(reportBox!.x).toBeLessThan(counterBox!.x);
    expect(counterBox!.x).toBeLessThan(nextBox!.x);
    expect(Math.abs(reportBox!.y - nextBox!.y)).toBeLessThan(2);
    const content = card.locator('.ss-question__content');
    expect(await content.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    await next.click();
    await expect(card.getByText('Question 2 of 2', { exact: true })).toBeVisible();
  });
}


// Quiz audit Q01–Q10: deterministic wire fixtures exercise the actual built
// UI; grading, account writes and entitlements remain server responsibilities.
const quizAuditQuestions = [
  { id: 'quiz-ux-code', category: 'javascript', difficulty: 1, introduction: 'Think about JavaScript’s historical compatibility.',
    question: `What does typeof null return?\n\n\`\`\`javascript\n${longCode}\n\`\`\``, options: ['object', 'string', 'null', 'undefined'] },
  { id: 'quiz-ux-number', category: 'javascript', difficulty: 1, introduction: '', question: 'Which value is a number?', options: ['42', '"42"', 'null', 'undefined'] },
  { id: 'quiz-ux-retired', category: 'javascript', difficulty: 1, introduction: '', question: 'This question was retired during your attempt.', options: ['True', 'False'] },
];
const quizAuditGrade = {
  totalQuestions: 2, correctAnswers: 1, percentage: 50, questXp: 0, voided: ['quiz-ux-retired'],
  results: [
    { questionId: 'quiz-ux-code', selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'typeof null returns object for historical compatibility.' },
    { questionId: 'quiz-ux-number', selectedIndex: 2, correctAnswer: 0, isCorrect: false, explanation: '42 is a numeric literal; null is not a number.' },
  ],
};

async function quizAuditFixture(page: Page, signedIn = false) {
  let grades = 0;
  let writes = 0;
  await page.addInitScript(() => localStorage.setItem('devquiz:quiz-setup:v1', JSON.stringify({ count: 10, difficulty: 'mixed', categories: ['javascript'] })));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/quiz/questions' || url.pathname === '/api/quiz/daily') {
      return route.fulfill({ json: { sessionId: 'quiz-audit-session-unique-attempt-key', expiresAt: Date.now() + 3_600_000, questions: quizAuditQuestions } });
    }
    if (url.pathname === '/api/quiz/submit') {
      grades++;
      return route.fulfill({ json: { ...quizAuditGrade, ...(signedIn ? { resultReceipt: 'quiz-audit-signed-receipt' } : {}) } });
    }
    if (url.pathname === '/api/user/stats' && route.request().method() === 'POST') {
      writes++;
      return writes === 1
        ? route.fulfill({ status: 503, json: { error: { code: 'temporarily_unavailable', message: 'Try again' } } })
        : route.fulfill({ json: { data: null, applied: false, questXp: 0 } });
    }
    if (url.pathname === '/api/user/xp') return route.fulfill({ json: { data: { quest_xp: 0, by_subject: {} } } });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'local Quiz fixture' } } });
  });
  return { grades: () => grades, writes: () => writes };
}

async function finishQuizAudit(page: Page) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'null', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'True', exact: true }).click();
  const review = page.getByRole('button', { name: 'Review unanswered (1)', exact: true });
  await expect(review).not.toHaveAttribute('aria-disabled');
  await review.click();
  await expect(page.locator('#question-text-quiz-ux-code')).toBeFocused();
  await page.getByRole('radio', { name: 'object', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Submit quiz', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 / 2');
}

for (const theme of ['light', 'dark'] as const) for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
  test(`${theme} ${width}px: Quiz setup, unanswered navigation and mistake review stay usable`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1280 ? 733 : 1000 });
    await prepare(page, theme);
    const fixture = await quizAuditFixture(page);
    await page.goto('/quiz');
    await expect(page.getByText('You’re practising on this device. Sign in before starting to save results to your account.')).toBeVisible();
    await page.getByRole('radio', { name: 'Difficulty: Progressive', exact: true }).click();
    await expect(page.getByText('Progressive: Difficulty 1 to 5, in order.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 360 || width === 1440) await page.screenshot({ path: info.outputPath(`quiz-setup-${theme}-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Start quiz', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('Quiz · Question 1 of 3');
    await expect(page.getByText('0 of 3 answered', { exact: true })).toBeVisible();
    await expect(page.locator('time')).toContainText('Submit before');
    await expect(page.locator('#question-text-quiz-ux-code pre')).toBeVisible();
    if (width === 1280) {
      const card = page.locator('.ss-question__panel');
      const next = card.getByRole('button', { name: 'Next', exact: true });
      await expect(next).toBeVisible();
      const bounds = (await card.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThan(733);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 360 || width === 1440) await page.screenshot({ path: info.outputPath(`quiz-active-${theme}-${width}.png`), fullPage: true });
    await finishQuizAudit(page);
    const primary = page.getByRole('button', { name: 'Review incorrect answers (1)', exact: true });
    await expect(primary).toHaveClass(/ss-swim-cta/);
    await expect(page.getByText('42 is a numeric literal; null is not a number.')).toBeVisible();
    await expect(page.locator('.quiz-review-grid')).not.toContainText('typeof null returns object');
    if (width === 360 || width === 1440) {
      await page.locator('main').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: info.outputPath(`quiz-result-summary-${theme}-${width}.png`), fullPage: true });
    }
    await expect(page.locator('.quiz-retired')).toContainText('Retired, not counted');
    await page.getByRole('radio', { name: 'All answers (2)', exact: true }).click();
    await expect(page.locator('.quiz-review-grid')).toContainText('typeof null returns object');
    await primary.click();
    await expect(page.locator('#quiz-review')).toBeFocused();
    await expect(page.getByRole('radio', { name: 'Incorrect (1)', exact: true })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(fixture.grades()).toBe(1);
    if (width === 360 || width === 1440) {
      const findings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(findings.violations.map(v => v.id)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`quiz-result-${theme}-${width}.png`), fullPage: true });
    }
  });
}

test('Quiz keeps account save status visible and updates it after background receipt replay', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await prepare(page, 'dark');
  await storeFakeSession(page);
  await localAuth(page);
  const fixture = await quizAuditFixture(page, true);
  await page.goto('/quiz');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start quiz', exact: true }).click();
  await finishQuizAudit(page);
  await expect(page.locator('.quiz-save-status')).toHaveText('Waiting to sync. We’ll retry when you reconnect or reopen devShark.');
  await page.screenshot({ path: info.outputPath('quiz-save-pending-dark-390.png'), fullPage: true });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.quiz-save-status')).toHaveText('Saved to your account');
  expect(fixture.grades()).toBe(1);
  expect(fixture.writes()).toBe(2);
});

for (const mode of ['daily', 'review']) {
  test(`Quiz identifies the linked ${mode} mode while preserving answer navigation`, async ({ page }) => {
    await prepare(page, 'dark');
    await storeFakeSession(page);
    await localAuth(page);
    await quizAuditFixture(page);
    await page.goto(`/quiz?mode=${mode}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(`${mode === 'daily' ? 'Today’s challenge' : 'Review'} · Question 1 of 3`);
    await expect(page.getByText('0 of 3 answered', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review unanswered (3)', exact: true })).toBeVisible();
  });
}

test('Quiz shows all topics immediately and bulk selection applies to the whole permitted list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await prepare(page, 'dark');
  await quizAuditFixture(page);
  await page.goto('/quiz');
  await expect(page.getByRole('button', { name: 'Show all categories', exact: true })).toHaveCount(0);
  const security = page.getByRole('button', { name: 'Security', exact: true });
  await expect(security).toBeVisible();
  await security.click();
  await expect(security).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.getByRole('button', { name: 'React', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(security).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('devquiz:quiz-setup:v1')!).categories)).toEqual([]);
});

test('Quiz notices a passed deadline without clearing answers or inventing a grading refusal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.clock.install();
  await prepare(page, 'dark');
  await quizAuditFixture(page);
  await page.goto('/quiz');
  await page.getByRole('button', { name: 'Start quiz', exact: true }).click();
  await page.getByRole('radio', { name: 'object', exact: true }).click();
  const answersTop = (await page.getByRole('radiogroup').boundingBox())!.y;
  await page.clock.fastForward(61 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/This quiz’s submit deadline has passed/)).toBeVisible();
  expect(Math.abs((await page.getByRole('radiogroup').boundingBox())!.y - answersTop)).toBeLessThan(1);
  await expect(page.getByRole('radio', { name: 'object', exact: true })).toBeChecked();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('devquiz:in-progress')!).answers)).toEqual({ 'quiz-ux-code': 0 });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'null', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'True', exact: true }).click();
  await page.getByRole('button', { name: 'Submit quiz', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 / 2');
});

test('Quiz can cancel a slow question load and gives focus back to settings', async ({ page }) => {
  await prepare(page, 'dark');
  await quizAuditFixture(page);
  let release: (() => void) | undefined;
  await page.route('**/api/quiz/questions?**', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { sessionId: 'late-quiz', questions: quizAuditQuestions } }).catch(() => undefined);
  });
  await page.goto('/quiz');
  await page.getByRole('button', { name: 'Start quiz', exact: true }).click();
  const cancel = page.getByRole('button', { name: 'Back to quiz settings', exact: true });
  await expect(cancel).toBeVisible({ timeout: 8_000 });
  await cancel.click();
  await expect(page.getByRole('heading', { name: 'Build your quiz.', exact: true })).toBeFocused();
  release!();
  await expect(page.getByRole('button', { name: 'Start quiz', exact: true })).toBeVisible();
  await expect(page.getByText('What does typeof null return?', { exact: true })).toHaveCount(0);
});
