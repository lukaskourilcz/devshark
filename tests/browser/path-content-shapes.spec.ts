import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { storeFakeSession, localAuth } from './fake-session';
import { activitySummary, publicManifest } from '../../lib/learning-paths/catalog';
import { pathInventory } from '../../shared/learning-paths';
import { SCHEMA_FIXTURE_NOTE, SCHEMA_FIXTURE_SCENARIO, schemaFixture } from '../../scripts/learning-path-schema-fixture';

// The content shapes of #497 in the built client: a check with a scenario, a
// code activity with a fixture note, and the interview-prep shelf. Local wire
// and auth fixtures only, built from scripts/learning-path-schema-fixture.ts;
// no account, grading, enrollment or database call occurs. The server side is
// covered by the schema and handler contracts in `npm run test:paths`.
//
// Not wired into quality.yml (owner decision for #497, until B14). Run it
// against a preview built with the bundle budget's placeholder Supabase pair:
//   TEST_BASE_URL=http://localhost:<port> npm run test:browser -- tests/browser/path-content-shapes.spec.ts

const path = schemaFixture();
const manifest = publicManifest(path);
const loop = path.modules.find((module) => module.id === 'fde-v1-x01')!;
const check = loop.activities.find((activity) => activity.id === 'fde-v1-x01-case')!;
const drill = loop.activities.find((activity) => activity.id === 'fde-v1-x01-drill')!;
const enrollment = { enrollmentId: 'LOCALSHAPES000000000', pathId: 'fde', curriculumVersion: path.version, baseTrackAtEnrollment: null, status: 'active', startedAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' };
const WIDTHS = [360, 390, 768, 1024, 1280, 1440];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SCENARIO_FIRST = SCHEMA_FIXTURE_SCENARIO.split('\n\n')[0];
const NOTE_FIRST = SCHEMA_FIXTURE_NOTE.split('\n\n')[0].split('`')[0];

const started = (activityId: string) => {
  const activity = activityId === check.id ? check : drill;
  const base = { attemptId: 'LOCALATTEMPT00000000', session: 'local-session', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), activity: activitySummary(activity), purpose: activity.purpose, draft: null, previous: null };
  if (activity === check) {
    // Authored order, options unshuffled: the answer key stays in this file.
    return { ...base, check: { questions: check.questions!.map(({ id, prompt, options, competencies }) => ({ id, prompt, options, competencies })), passThreshold: check.passThreshold } };
  }
  return { ...base, code: { language: 'javascript', prompt: drill.code!.prompt, starter: drill.code!.starter, hints: drill.code!.hints, tests: drill.code!.tests.map(({ call, expected, label }) => ({ call, expected, label })) } };
};

// A failed practice check: every question wrong, the key and explanations
// shown, which is when the review draws the radios disabled.
const failedCheck = {
  activityId: check.id, state: 'needs_revision', verification: 'machine_verified', score: 0, criteria: [],
  questions: check.questions!.map((question) => ({ questionId: question.id, correct: false, correctIndex: question.correct, explanation: question.explanation })),
  code: null, feedback: [], module: null, guidedComplete: false, nextActivityId: check.id, replayed: false, xpAwarded: 0,
};

async function setUp(page: Page, theme: 'light' | 'dark') {
  await storeFakeSession(page);
  await localAuth(page);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((mode) => {
    localStorage.setItem('devquiz:color-mode', mode);
    localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
  }, theme);
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const resource = url.searchParams.get('resource');
    const op = url.searchParams.get('op') ?? url.pathname.split('/').pop();
    if (resource === 'learning-path-catalog') return route.fulfill({ json: { versions: { fde: path.version }, paths: [{ manifest, availability: 'available', inventory: pathInventory(manifest) }] } });
    if (resource === 'learning-path-start') return route.fulfill({ json: started((route.request().postDataJSON() as { activityId: string }).activityId) });
    if (resource === 'learning-path-submit') return route.fulfill({ json: failedCheck });
    if (op === 'entitlement') return route.fulfill({ json: { tier: 'premium', source: 'manual', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null } });
    if (op === 'learning-path-enrollment') return route.fulfill({ json: { enrollments: [enrollment] } });
    if (op === 'learning-path-progress') return route.fulfill({ json: { enrollment, modules: [], competencies: [], recommendedBridges: [], nextActivityId: 'fde-v1-x01-read', guidedComplete: false, artifacts: { submitted: 0, total: 0 }, dueActivityIds: [] } });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'Local test fixture' } } });
  });
}

async function expectReflow(page: Page, selector: string) {
  const target = page.locator(selector).first();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page scroll at ${width}`).toBe(true);
    expect(await target.evaluate((el) => el.scrollWidth <= el.clientWidth), `${selector} overflow at ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page scroll at 360 and 200%').toBe(true);
  expect(await target.evaluate((el) => el.scrollWidth <= el.clientWidth), `${selector} overflow at 360 and 200%`).toBe(true);
  await page.addStyleTag({ content: 'html { font-size: 100% !important; }' });
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const findings = await new AxeBuilder({ page }).include(selector).withTags(AXE_TAGS).analyze();
  expect(findings.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the overview lists the interview-prep shelf apart from the loop`, async ({ page }, info) => {
    await setUp(page, theme);
    await page.goto('/learn/forward-deployed-engineer/path');
    const shelf = page.getByRole('region', { name: 'Interview prep' });
    await expect(shelf).toBeVisible();
    await expect(shelf).toContainText('Learning round');
    await expect(shelf).toContainText('Optional');
    const modules = page.locator('section.lp-section').filter({ has: page.getByRole('heading', { level: 2, name: 'Modules' }) });
    await expect(modules).toContainText('Decomposition cases');
    await expect(modules).not.toContainText('Learning round');
    await expectReflow(page, '[aria-labelledby="path-shelf-interview-prep"]');
    await shelf.screenshot({ path: info.outputPath(`shelf-${theme}.png`) });
    await expectNoAxeViolations(page, '[aria-labelledby="path-shelf-interview-prep"]');
  });

  test(`${theme}: a scenario check keeps its case once, readable and first in reading order`, async ({ page }, info) => {
    await setUp(page, theme);
    await page.goto(`/learn/forward-deployed-engineer/path/fde-v1-x01?activity=${check.id}`);
    const scenario = page.getByRole('region', { name: 'The scenario' });
    await expect(scenario).toBeVisible();
    await expect(page.getByText(SCENARIO_FIRST)).toHaveCount(1);
    const firstQuestion = page.getByRole('group', { name: /What do you ask the lead first\?/ });
    const firstRadio = firstQuestion.getByRole('radio').first();
    expect((await scenario.boundingBox())!.y).toBeLessThan((await firstQuestion.boundingBox())!.y);

    // Reading text, not a stop: from the workspace's Close button, the last
    // control above the scenario, one Tab passes the case and lands on the
    // first radio.
    // Retried as one step: on a loaded runner the activity's own focus move
    // (its heading, on open) can land after our focus() and the Tab then
    // starts elsewhere. The assertion is the same: one Tab from Close.
    const close = page.locator('.lp-workspace').getByRole('button', { name: 'Close' });
    await expect(async () => {
      await close.focus();
      await expect(close).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(firstRadio).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    expect(await scenario.evaluate((el) => el.querySelector('a, button, input, select, textarea, [tabindex]'))).toBeNull();

    // The answer radios carry the brand accent at 20px on their own
    // selector, so renaming the check's container cannot drop it.
    const radioStyle = await firstRadio.evaluate((el) => {
      const style = getComputedStyle(el);
      return { accent: style.accentColor, width: style.width };
    });
    expect(radioStyle.accent).not.toBe('auto');
    expect(radioStyle.width).toBe('20px');

    await expectReflow(page, '.lp-check-view section.lp-brief');
    await expectNoAxeViolations(page, '.lp-check-view section.lp-brief');

    // Answer every question wrong and submit: the review keeps the case once
    // and draws the whole check at full opacity, radios disabled.
    for (const question of check.questions!) {
      const wrong = question.options[(question.correct + 1) % question.options.length];
      await page.getByRole('radio', { name: wrong }).check();
    }
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(check.questions![0].explanation)).toBeVisible();
    await expect(scenario).toBeVisible();
    await expect(page.getByText(SCENARIO_FIRST)).toHaveCount(1);
    await expect(firstRadio).toBeDisabled();
    expect(await page.locator('.lp-check-view').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await scenario.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expectReflow(page, '.lp-check-view section.lp-brief');
    await scenario.screenshot({ path: info.outputPath(`scenario-review-${theme}.png`) });
    await expectNoAxeViolations(page, '.lp-check-view');
  });

  test(`${theme}: a code activity keeps its fixture note in Description beside the editor`, async ({ page }, info) => {
    await setUp(page, theme);
    await page.goto(`/learn/forward-deployed-engineer/path/fde-v1-x01?activity=${drill.id}`);
    const note = page.getByRole('tabpanel', { name: 'Description' }).locator('.lp-notice--info');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Before you start');
    await expect(note).toContainText(NOTE_FIRST);
    const editor = page.locator('.cd-workbench--activity .cm-editor');
    await expect(editor).toBeVisible();
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const output = await page.locator('.cd-workbench--activity .cd-pane--output').boundingBox();
      const codePane = await page.locator('.cd-workbench--activity .cd-pane--editor').boundingBox();
      if (width >= 1024) expect(output!.x).toBeGreaterThan(codePane!.x);
      else expect(output!.y).toBeLessThan(codePane!.y);
      await expect(page.locator('.ss-header')).toBeHidden();
    }
    await expectReflow(page, '.cd-workbench--activity [role="tabpanel"] .lp-notice--info');
    await note.screenshot({ path: info.outputPath(`fixture-note-${theme}.png`) });
    await expectNoAxeViolations(page, '.cd-workbench--activity [role="tabpanel"] .lp-notice--info');
  });
}

// Owner hold: keep these end-to-end checks for the future FDE release.
test.skip(!FDE_SECTION_VISIBLE, 'FDE is hidden until the owner reopens it');
