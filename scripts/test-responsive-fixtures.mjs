// Responsive acceptance must inspect the requested account page with local
// data. A successful sign-in gate or an unhandled Auth read is not coverage.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { apiFixture, fixtureSession, renderProblems } from './check-responsive.mjs';

const budget = JSON.parse(readFileSync(new URL('../docs/quality/bundle-budget.json', import.meta.url), 'utf8'));
const auth = new URL(budget.measuredBuild.env.VITE_SUPABASE_URL);
const api = (value) => new URL(value, 'http://127.0.0.1:4173');
const ready = { mounted: true, headings: ['Responsive Learner'], pathname: '/profile', readyMarkers: ['profile'] };

test('F6-04: a profile navigation that lands home fails route identity', () => {
  const problems = renderProblems('/profile', { ...ready, pathname: '/', readyMarkers: [] }, [], 'Page not found');
  assert.ok(problems.some((problem) => /profile|route|landed/i.test(problem)), problems.join('\n'));
});

test('F6-04: a heading without loaded profile content does not establish account coverage', () => {
  const problems = renderProblems('/profile', { ...ready, headings: ['Profile'], readyMarkers: [] }, [], 'Page not found');
  assert.ok(problems.some((problem) => /profile|ready|content/i.test(problem)), problems.join('\n'));
});

test('F6-04: the requested profile with loaded content passes identity', () => {
  assert.deepEqual(renderProblems('/profile', ready, [], 'Page not found'), []);
});

test('F6-04: a fixture miss still fails after a profile has rendered', () => {
  const problems = renderProblems('/profile', ready, [{ request: 'GET /api/unexpected', answered: false }], 'Page not found');
  assert.ok(problems.some((problem) => problem.includes('/api/unexpected')));
});

test('F6-04: local Auth and profile fixtures describe the same invented learner', () => {
  const session = fixtureSession();
  const user = apiFixture('GET', new URL('/auth/v1/user', auth));
  const stats = apiFixture('GET', api('/api/user/stats'));
  assert.equal(user.status, 200);
  assert.equal(stats.status, 200);
  assert.equal(user.body.id, session.user.id);
  assert.equal(stats.body.data.user_id, session.user.id);
  assert.ok(stats.body.data.total_quizzes > 0, 'the profile measures learned activity');
  assert.ok(stats.body.data.total_questions > 0);
  assert.match(session.access_token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.match(session.user.email, /\.test$/, 'the fixture identifies no real account');
});

test('F6-04: the legacy user router and path form receive the same fixture', () => {
  assert.deepEqual(apiFixture('GET', api('/api/user/%5Bop%5D?op=stats')), apiFixture('GET', api('/api/user/stats')));
});

test('F6-04: a saved-card fixture supplies a real review card rather than an empty gate', () => {
  const cards = apiFixture('GET', api('/api/flashcards?subject=webdev'));
  assert.equal(cards.status, 200);
  assert.ok(cards.body.cards.length > 0);
  assert.equal(typeof cards.body.cards[0].question, 'string');
  assert.equal(typeof cards.body.cards[0].correct_answer, 'string');
});

test('F6-04: only the configured local Auth project receives user fixtures', () => {
  assert.equal(apiFixture('GET', new URL('https://unrelated.example.test/auth/v1/user')), null);
  assert.equal(apiFixture('POST', new URL('/auth/v1/signup', auth)), null);
});

test('F6-04: local Auth permits only the known CORS preflights', () => {
  assert.equal(apiFixture('OPTIONS', new URL('/auth/v1/user', auth)).status, 204);
  assert.equal(apiFixture('OPTIONS', new URL('/auth/v1/signup', auth)), null);
});

test('F6-04: unexpected API reads and submissions never get a success fixture', () => {
  assert.equal(apiFixture('GET', api('/api/unexpected')), null);
  assert.equal(apiFixture('POST', api('/api/quiz/submit')), null);
});

test('F6-04: guest mode cannot borrow an authenticated profile or saved deck', () => {
  assert.equal(apiFixture('GET', api('/api/user/stats'), 'guest'), null);
  assert.equal(apiFixture('GET', api('/api/flashcards?subject=webdev'), 'guest'), null);
});

test('F6-04: coding progress supplies the fields consumed by the Coding dashboard', () => {
  const result = apiFixture('GET', api('/api/user/[op]?op=coding-progress'));
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.tasks, 'object');
  assert.notEqual(result.body.tasks, null);
  assert.ok(Array.isArray(result.body.due));
  assert.ok(Number.isInteger(result.body.javascriptLevelsCleared));
  assert.deepEqual(Object.keys(result.body.passedByTrack).sort(), ['javascript', 'typescript', 'react', 'system-design', 'algorithms'].sort());
  for (const count of Object.values(result.body.passedByTrack)) assert.ok(Number.isInteger(count) && count >= 0);
  assert.equal(Object.hasOwn(result.body, 'progress'), false, 'the handler returns tasks, not a progress wrapper');
});

test('F6-04: an unconnected GitHub fixture selects the visible connect state', () => {
  const result = apiFixture('GET', api('/api/user/[op]?op=github-connection'));
  assert.equal(result.status, 200);
  assert.equal(result.body.available, true, 'the garden card remains in this fixture layout');
  assert.equal(result.body.status, 'not_connected', 'the client must not fall into its connected branch');
  for (const field of ['accountLogin', 'repoFullName', 'defaultBranch', 'lastCommitAt', 'lastError']) assert.equal(result.body[field], null, field);
  assert.equal(result.body.queued, 0);
  assert.equal(Object.hasOwn(result.body, 'connected'), false, 'the handler uses a status discriminant');
});
