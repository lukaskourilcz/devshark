// Pages that React suites must judge the way their prompts read, for
// `npm run test:coding`.
//
// The content audit of 8 October 2026 (C2-2, C2-4 and C2-9) found suites that
// failed pages their prompt allows, such as a Retry button inside the alert,
// the starter's own heading or "Loading" in a child of the status region, and
// suites that passed wrong pages. Its second pass (V2-1, V2-5) added a heading
// that shows the loading status and a hover written with pointer events. Each variant here is the task's reference
// with a few exact edits. A correct one must pass the suite the server runs,
// visible and hidden cases together, and a wrong one must fail it.

export interface ReactVariant {
  /** The task whose reference the edits start from and whose suite grades the page. */
  id: string;
  /** What this page does differently from the reference. */
  note: string;
  /** Replacements applied in order; each `from` has to be in the page. */
  edits: (readonly [from: string, to: string])[];
  /** True when the prompt allows the page, so the suite must pass it. */
  correct: boolean;
}

const RETRY_IN_PATH_ALERT: ReactVariant['edits'] = [[
  '<p role="alert">Could not load users</p>\n          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>',
  '<p role="alert">Could not load users <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>',
]];

const RETRY_IN_LINKS_ALERT: ReactVariant['edits'] = [[
  '<p role="alert">Request failed</p>\n          <button onClick={reload}>Retry</button>',
  '<p role="alert">Request failed <button onClick={reload}>Retry</button></p>',
]];

const FULLSTACK_STATUS_AND_ALERT = '{loading&&<p role="status">Loading</p>}{error&&<><p role="alert">{error}</p><button disabled={loading||busy} onClick={()=>refresh()}>Retry</button></>}';

export const REACT_VARIANTS: ReactVariant[] = [
  {
    id: 'react-loading-state',
    note: "keeps the starter heading \"Loading state\"",
    edits: [["if (loading) return <p role=\"status\">Loading\u2026</p>;", "if (loading) return <main><h2>Loading state</h2><p role=\"status\">Loading\u2026</p></main>;"], ["return <main>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;", "return <main><h2>Loading state</h2>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;"]],
    correct: true,
  },
  {
    id: 'react-loading-state',
    note: "keeps the starter heading and never shows a loading line",
    edits: [["if (loading) return <p role=\"status\">Loading\u2026</p>;", "if (loading) return <main><h2>Loading state</h2></main>;"], ["return <main>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;", "return <main><h2>Loading state</h2>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;"]],
    correct: false,
  },
  {
    id: 'react-loading-state',
    note: "shows \"Loading\u2026\" in the heading itself, then \"Users\"",
    edits: [["if (loading) return <p role=\"status\">Loading\u2026</p>;", "if (loading) return <main><h2 role=\"status\">Loading\u2026</h2></main>;"], ["return <main>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;", "return <main><h2>Users</h2>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;"]],
    correct: true,
  },
  {
    id: 'react-loading-state',
    note: "keeps the starter heading and shows \"Loading\u2026\" in an h3 under it",
    edits: [["if (loading) return <p role=\"status\">Loading\u2026</p>;", "if (loading) return <main><h2>Loading state</h2><h3 role=\"status\">Loading\u2026</h3></main>;"], ["return <main>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;", "return <main><h2>Loading state</h2>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;"]],
    correct: true,
  },
  {
    id: 'react-loading-state',
    note: "keeps a \"Loading\u2026\" heading once the users have arrived",
    edits: [["return <main>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;", "return <main><h2>Loading\u2026</h2>{error && <p role=\"alert\">{error}</p>}<ul>{users.map(user => <li key={user.id}>{user.name}</li>)}</ul></main>;"]],
    correct: false,
  },
  {
    id: 'react-star-rating',
    note: 'marks filled stars with aria-pressed and an emoji star',
    edits: [["onClick={() => setRating(star)}>{star <= shown ? '★' : '☆'}</button>", "onClick={() => setRating(star)} aria-pressed={star <= shown}>{star <= shown ? '⭐' : '·'}</button>"]],
    correct: true,
  },
  {
    id: 'react-star-rating',
    note: 'shows ★ on every star and marks filled ones with a class',
    edits: [["onClick={() => setRating(star)}>{star <= shown ? '★' : '☆'}</button>", "onClick={() => setRating(star)} className={star <= shown ? 'star on' : 'star'}>★</button>"]],
    correct: true,
  },
  {
    id: 'react-star-rating',
    note: 'previews with onPointerEnter and onPointerLeave',
    edits: [
      ['<div onMouseLeave={() => setHovered(0)}>', '<div onPointerLeave={() => setHovered(0)}>'],
      ['onMouseEnter={() => setHovered(star)}', 'onPointerEnter={() => setHovered(star)}'],
    ],
    correct: true,
  },
  {
    id: 'react-star-rating',
    note: 'fills only the hovered or chosen star, not the ones before it',
    edits: [["{star <= shown ? '★' : '☆'}", "{star === shown ? '★' : '☆'}"]],
    correct: false,
  },
  {
    id: 'react-abort-a-request',
    note: 'lists the post titles instead of counting them',
    edits: [['return <main>{error && <p role="alert">{error}</p>}<p>{posts.length} posts</p></main>;', 'return <main>{error && <p role="alert">{error}</p>}<ul>{posts.map(post => <li key={post.id}>{post.title}</li>)}</ul></main>;']],
    correct: true,
  },
  {
    id: 'react-abort-a-request',
    note: 'aborts a controller whose signal never reached fetch',
    edits: [["fetch('https://jsonplaceholder.typicode.com/posts', {signal: controller.signal})", "fetch('https://jsonplaceholder.typicode.com/posts')"]],
    correct: false,
  },
  {
    id: 'react-mh-load-more',
    note: 'puts Try again inside the alert',
    edits: [
      ["{status === 'error' && <p role=\"alert\">Could not load photos</p>}", "{status === 'error' && <p role=\"alert\">Could not load photos <button type=\"button\" onClick={() => load(page + 1)}>Try again</button></p>}"],
      ["{status === 'done' ? (", "{status === 'error' ? null : status === 'done' ? ("],
    ],
    correct: true,
  },
  ...[2, 3, 4, 5].map((level): ReactVariant => ({ id: `react-path-effects-${level}`, note: 'puts Retry inside the alert', edits: RETRY_IN_PATH_ALERT, correct: true })),
  {
    id: 'react-path-effects-4',
    note: 'lets a late failure from the old loader set the error',
    edits: [["if (!ignore) setStatus('error');", "setStatus('error');"]],
    correct: false,
  },
  ...['planner', 'stockroom', 'workshops'].flatMap((app) => [5, 6, 7, 8].map((stage): ReactVariant => ({
    id: `react-fullstack-${app}-${stage}`,
    note: 'puts Retry inside the alert and "Loading" in a span inside the status region',
    edits: [[FULLSTACK_STATUS_AND_ALERT, '{loading&&<div role="status"><span>Loading</span></div>}{error&&<p role="alert">{error}<button disabled={loading||busy} onClick={()=>refresh()}>Retry</button></p>}']],
    correct: true,
  }))),
  {
    id: 'react-fullstack-planner-5',
    note: 'shows "Loading" with no status role',
    edits: [['{loading&&<p role="status">Loading</p>}', '{loading&&<p>Loading</p>}']],
    correct: false,
  },
  { id: 'react-fullstack-links-4', note: 'puts Retry inside the alert', edits: RETRY_IN_LINKS_ALERT, correct: true },
  { id: 'react-fullstack-links-5', note: 'puts Retry inside the alert', edits: RETRY_IN_LINKS_ALERT, correct: true },
  {
    id: 'react-mh-search-as-you-type',
    note: 'puts Try again inside the alert and the query in an <em>',
    edits: [
      ['<p role="alert">Search failed</p>\n        <button type="button" onClick={() => setAttempt((count) => count + 1)}>Try again</button>', '<p role="alert">Search failed <button type="button" onClick={() => setAttempt((count) => count + 1)}>Try again</button></p>'],
      ['<p>No books match “{query}”</p>', '<p>No books match “<em>{query}</em>”</p>'],
    ],
    correct: true,
  },
  {
    id: 'react-mh-autosave',
    note: 'puts Retry inside the alert',
    edits: [['<p role="alert">Could not save</p>\n        <button type="button" onClick={save}>Retry</button>', '<p role="alert">Could not save <button type="button" onClick={save}>Retry</button></p>']],
    correct: true,
  },
  {
    id: 'react-mh-autosave',
    note: 'never moves the saved text on, so closing a saved page saves again',
    edits: [['    savedRef.current = body;\n', '']],
    correct: false,
  },
  {
    id: 'react-weather-style-dashboard',
    note: 'puts Retry inside the alert and the unknown name in a <strong>',
    edits: [
      ['<p role="alert">Could not load the weather</p>\n          <button type="button" onClick={() => loadWeather(failedCity)}>Retry</button>', '<p role="alert">Could not load the weather<button type="button" onClick={() => loadWeather(failedCity)}>Retry</button></p>'],
      ['<p>Unknown city: {unknown}</p>', '<p>Unknown city: <strong>{unknown}</strong></p>'],
    ],
    correct: true,
  },
  {
    id: 'react-mh-wait-for-export',
    note: 'disables Export once the job has an id, not from the click',
    edits: [["const running = starting || (jobId !== null && (job === null || job.status === 'running'));", "const running = jobId !== null && (job === null || job.status === 'running');"]],
    correct: true,
  },
  {
    id: 'react-mh-wait-for-export',
    note: 'enables Export again once the job reports running',
    edits: [["const running = starting || (jobId !== null && (job === null || job.status === 'running'));", 'const running = starting || (jobId !== null && job === null);']],
    correct: false,
  },
  ...[3, 4, 5].map((stage): ReactVariant => ({
    id: `react-evolving-catalog-${stage}`,
    note: 'a ticked checkbox can never be unticked',
    edits: [['ids.includes(p.id)?ids.filter(id=>id!==p.id):[...ids,p.id]', 'ids.includes(p.id)?ids:[...ids,p.id]']],
    correct: false,
  })),
  {
    id: 'react-notification-center',
    note: 'always shows the empty-state line',
    edits: [["{dates.length === 0 && <p>{unreadOnly ? 'No unread notifications' : 'No notifications'}</p>}", "<p>{unreadOnly ? 'No unread notifications' : 'No notifications'}</p>"]],
    correct: false,
  },
  {
    id: 'react-comments-viewer',
    note: 'lowercases the filter but not the email',
    edits: [['comment.email.toLowerCase().includes(needle)', 'comment.email.includes(needle)']],
    correct: false,
  },
  {
    id: 'react-mh-rename-in-place',
    note: 'closes the form on any key',
    edits: [["onKeyDown={(event) => { if (event.key === 'Escape') close(); }}", 'onKeyDown={() => close()}']],
    correct: false,
  },
  {
    id: 'react-mh-menu-button',
    note: 'ArrowUp always jumps to the last item',
    edits: [['setActive(active === 0 ? last : active - 1);', 'setActive(last);']],
    correct: false,
  },
  {
    id: 'react-mh-city-combobox',
    note: 'ArrowUp always jumps to the last option',
    edits: [['else setActive(active < 0 ? count - 1 : (active - 1 + count) % count);', 'else setActive(count - 1);']],
    correct: false,
  },
  {
    id: 'react-usedebounce-hook',
    note: 'never clears the previous timeout',
    edits: [['return () => clearTimeout(timer); ', '']],
    correct: false,
  },
];
