/** Fetch fixtures shared by every React runner: the browser harness writes
 * FETCH_STUB_SOURCE into the sandbox as /fetchStub.js, and the node content
 * test evaluates the same string. Both suites and live previews use these
 * deterministic offline fixtures. Ported from interview-prepper. */

const FIXTURE_USERS = [
  { id: 1, name: 'Leanne Graham', username: 'Bret', email: 'leanne@example.com', address: { city: 'Gwenborough' } },
  { id: 2, name: 'Ervin Howell', username: 'Antonette', email: 'ervin@example.com', address: { city: 'Wisokyburgh' } },
  { id: 3, name: 'Clementine Bauch', username: 'Samantha', email: 'clementine@example.com', address: { city: 'McKenziehaven' } },
];

const FIXTURE_POSTS = [
  { id: 1, userId: 1, title: 'Post one', body: 'Body one' },
  { id: 2, userId: 1, title: 'Post two', body: 'Body two' },
  { id: 3, userId: 1, title: 'Post three', body: 'Body three' },
  { id: 4, userId: 2, title: 'Post four', body: 'Body four' },
  { id: 5, userId: 2, title: 'Post five', body: 'Body five' },
  { id: 6, userId: 2, title: 'Post six', body: 'Body six' },
  { id: 7, userId: 2, title: 'Post seven', body: 'Body seven' },
];

const FIXTURE_TODOS = [
  { id: 1, userId: 1, title: 'Todo one', completed: false },
  { id: 2, userId: 1, title: 'Todo two', completed: true },
  { id: 3, userId: 2, title: 'Todo three', completed: false },
];

const FIXTURE_COMMENTS = [
  { id: 1, postId: 1, name: 'Comment one', email: 'ana@example.com', body: 'First' },
  { id: 2, postId: 1, name: 'Comment two', email: 'bo@example.com', body: 'Second' },
  { id: 3, postId: 2, name: 'Comment three', email: 'ana@example.net', body: 'Third' },
];

const FIXTURE_PRODUCTS = [
  { id: 1, title: 'Laptop', price: 900, category: 'tech' },
  { id: 2, title: 'Mug', price: 10, category: 'kitchen' },
  { id: 3, title: 'Desk', price: 200, category: 'furniture' },
];

/** Seven photos, served three to a page (`/api/photos?page=N`), so the preview
 * of the load-more challenge has two full pages and a short last one. */
const FIXTURE_PHOTOS = [
  { id: 1, title: 'Harbour at dawn' },
  { id: 2, title: 'Rain on the tram' },
  { id: 3, title: 'Market stalls' },
  { id: 4, title: 'Bridge in fog' },
  { id: 5, title: 'Night bus' },
  { id: 6, title: 'Garden steps' },
  { id: 7, title: 'Last ferry' },
];

/** A few days of notifications, so the notification-center preview has
 * something to group (`/api/notifications`). */
const FIXTURE_NOTIFICATIONS = [
  { id: 1, text: 'Ana replied to your comment', date: '2026-09-28', read: false },
  { id: 2, text: 'Your export is ready', date: '2026-09-28', read: true },
  { id: 3, text: 'Bo started following you', date: '2026-09-27', read: false },
  { id: 4, text: 'Weekly summary', date: '2026-09-25', read: true },
  { id: 5, text: 'Cara mentioned you', date: '2026-09-25', read: false },
];

/** A week of product events for the analytics-panel preview (`/api/events`). */
const FIXTURE_EVENTS = [
  { id: 1, type: 'visit', date: '2026-09-01' },
  { id: 2, type: 'signup', date: '2026-09-01' },
  { id: 3, type: 'visit', date: '2026-09-02' },
  { id: 4, type: 'purchase', date: '2026-09-03' },
  { id: 5, type: 'visit', date: '2026-09-03' },
  { id: 6, type: 'signup', date: '2026-09-04' },
  { id: 7, type: 'visit', date: '2026-09-05' },
  { id: 8, type: 'purchase', date: '2026-09-06' },
  { id: 9, type: 'visit', date: '2026-09-07' },
];

const asSource = (value: unknown) => JSON.stringify(value, null, 2);

export const FETCH_STUB_SOURCE = `// Shared offline fixtures for the preview and both test runners.
const FIXTURES = {
  users: ${asSource(FIXTURE_USERS)},
  posts: ${asSource(FIXTURE_POSTS)},
  todos: ${asSource(FIXTURE_TODOS)},
  comments: ${asSource(FIXTURE_COMMENTS)},
  products: ${asSource(FIXTURE_PRODUCTS)},
  photos: ${asSource(FIXTURE_PHOTOS)},
  notifications: ${asSource(FIXTURE_NOTIFICATIONS)},
  events: ${asSource(FIXTURE_EVENTS)},
};

const respond = data => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(JSON.stringify(data)),
});

const byId = (list, id) => list.find(item => String(item.id) === String(id)) ?? list[0];

const resolveBody = (url, options) => {
  const method = (options && options.method ? options.method : 'GET').toUpperCase();
  const [path, query] = String(url).split('?');
  const params = new URLSearchParams(query || '');
  const segments = path.replace(/\\/+$/, '').split('/');
  const last = segments[segments.length - 1];
  const collection = ['users', 'posts', 'todos', 'comments', 'products', 'photos', 'notifications', 'events'].includes(last)
    ? last
    : segments[segments.length - 2];
  const list = FIXTURES[collection];

  if (!list) return { current: { temperature_2m: 21 } };

  if (method === 'POST') {
    const sent = options && options.body ? JSON.parse(options.body) : {};
    return { id: 101, ...sent };
  }

  if (last !== collection) return byId(list, last);
  // Photos come three to a page, the way the load-more challenge asks for them.
  if (collection === 'photos' && params.has('page')) {
    const page = Math.max(1, Number(params.get('page')) || 1);
    return list.slice((page - 1) * 3, page * 3);
  }

  let items = list;
  for (const key of ['userId', 'postId']) {
    if (params.has(key)) items = items.filter(item => String(item[key]) === params.get(key));
  }
  if (params.has('_limit')) {
    const requestedLimit = Number(params.get('_limit'));
    const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : items.length;
    const requestedPage = Number(params.get('_page') || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const start = (page - 1) * limit;
    items = items.slice(start, start + limit);
  }
  // dummyjson-shaped endpoints nest their collection under a key
  return String(url).includes('dummyjson') ? { [collection]: items, total: items.length } : items;
};

globalThis.fetch = (url, options) => {
  const signal = options && options.signal;
  if (signal && signal.aborted) {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return Promise.reject(error);
  }
  return Promise.resolve(respond(resolveBody(url, options)));
};
`;

/** Wrap a component body into a runnable module: solutions and drafts are
 * authored as what a learner types into the starter, which already carries
 * the React import and the default export; add whichever piece is missing. */
export function asRunnableModule(source: string): string {
  const needsImport = !/^import\s/m.test(source);
  const needsExport = !/export\s+default/.test(source);
  return [
    needsImport ? "import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';" : '',
    source,
    needsExport ? 'export default App;' : '',
  ].filter(Boolean).join('\n');
}

/** What a case that let a form submit is told. */
export const FORM_SUBMIT_NOT_PREVENTED =
  'A form was submitted without event.preventDefault(), so a browser would reload the page and lose what it showed';

interface SubmitEventLike { defaultPrevented: boolean; preventDefault(): void }
type SubmitListener = (event: SubmitEventLike) => void;
/** The page's window, or anything else a submit event bubbles up to. */
export interface FormSubmitTarget {
  addEventListener(type: 'submit', listener: SubmitListener, capture: boolean): void;
  removeEventListener(type: 'submit', listener: SubmitListener, capture: boolean): void;
}

/**
 * Watches the form submissions of one case, for both React runners (the
 * grader's jsdom page and the browser harness). In the preview a submission
 * the component does not cancel reloads the frame and throws its state away,
 * whatever the checks read before that happened, so a case during which one
 * happened fails.
 *
 * A capture listener on the window sees every submission first. A bubbling one
 * runs after the component's own handler (React listens on its root, inside
 * the window), notes a submission still not cancelled and cancels it, so the
 * run goes on instead of navigating. A handler that stops the event on its way
 * up and does not cancel it is caught as well: that submission reaches the
 * capture listener and never the bubbling one. Returns the function that stops
 * watching and names the problem, or null.
 */
function watchFormSubmits(page: FormSubmitTarget): () => string | null {
  const seen: SubmitEventLike[] = [];
  const reachedTop = new Set<SubmitEventLike>();
  let leftToBrowser = 0;
  const first: SubmitListener = (event) => { seen.push(event); };
  const last: SubmitListener = (event) => {
    reachedTop.add(event);
    if (event.defaultPrevented) return;
    leftToBrowser += 1;
    event.preventDefault();
  };
  page.addEventListener('submit', first, true);
  page.addEventListener('submit', last, false);
  return () => {
    page.removeEventListener('submit', first, true);
    page.removeEventListener('submit', last, false);
    const stopped = seen.filter((event) => !reachedTop.has(event) && !event.defaultPrevented).length;
    return leftToBrowser + stopped > 0 ? FORM_SUBMIT_NOT_PREVENTED : null;
  };
}

/** The `beforeEach` and `afterEach` a suite registers its hooks with. */
interface CaseHooks {
  beforeEach(body: () => void): void;
  afterEach(body: () => void): void;
}

/**
 * Watches every case of a suite with `watchFormSubmits`, through the suite's
 * own hooks: each case starts a watch, and an `afterEach` ends it and fails
 * the case with the reason. A case that has already failed skips its
 * `afterEach` hooks, so the next case, and the function returned here once
 * the run is over, close a watch it left open. Register after the suite's
 * module has run, so this `afterEach` comes after the suite's own.
 */
export function failUncancelledSubmits(hooks: CaseHooks, page: FormSubmitTarget): () => void {
  let finish: (() => string | null) | null = null;
  const stop = (): string | null => {
    const problem = finish ? finish() : null;
    finish = null;
    return problem;
  };
  hooks.beforeEach(() => {
    stop();
    finish = watchFormSubmits(page);
  });
  hooks.afterEach(() => {
    const problem = stop();
    if (problem) throw new Error(problem);
  });
  return () => { stop(); };
}
