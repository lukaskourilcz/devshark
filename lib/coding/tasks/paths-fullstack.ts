/** The FullStack section's short path: a link shortener in five levels.
 *
 * Level 1 checks input in JavaScript; levels 2 and 3 build a typed in-memory
 * API in TypeScript; levels 4 and 5 put a React client on top of it that
 * talks to that API through the shared, network-free `./localFetch`
 * transport. Each level is graded by its own track's grader, exactly like the
 * longer FullStack apps: the React levels re-run every API check as part of
 * their suite, so the client cannot pass on a broken API.
 *
 * Task bodies only. Solutions live in `lib/coding/solutions/paths-fullstack.ts`. */

import type { CallTest, CodingTask, TypeTest } from '../../../shared/coding-catalog';
import { EVOLVING_CHALLENGES, evolvingTaskTrack } from '../../../shared/evolving';
import { LINKS_REACT_SCAFFOLD } from '../../../shared/coding-fullstack-support';
import { runtimeSuite } from './fullstack';
import { check, doc } from './path-helpers';

const LINKS_ID = 'fullstack-links';
const ENDPOINT = '/api/links';
export const LINKS_SEED = [
  { url: 'https://developer.mozilla.org', slug: 'mdn', visits: 3 },
  { url: 'https://react.dev', slug: 'react', visits: 0 },
];

const prompts = [
  'A link shortener turns a long URL into a short slug. Start with the check every later level relies on. Write `normalizeLink(value)`: accept a non-null object that is not an array, with a string `url` and a string `slug`. Trim both. The url must start with `https://` and have something after it, 200 characters at most. The slug is lower-cased and must be 3 to 20 characters of `a`–`z`, `0`–`9` and `-`. Return a new `{ url, slug }`, or `null` when anything is wrong. Ignore extra fields and never change the input.',
  "Port `normalizeLink` to TypeScript with an `unknown` input, and define `Draft = { url: string; slug: string }` and `Link = Draft & { visits: number }`. Add `RequestData = { method: string; path: string; body?: unknown }`, `Reply = { status: number; body: unknown }` and `createApi(seed: readonly Link[]): (request: RequestData) => Reply`, an in-memory API with its own copy of the seed. `GET /api/links` returns 200 and every link in insertion order. `POST /api/links` checks the body with `normalizeLink`: an invalid body returns 400 `{ error: \"invalid\" }`, a slug that already exists returns 409 `{ error: \"taken\" }`, and otherwise the link is stored with `visits: 0` and returned with 201. Anything else returns 404 `{ error: \"not_found\" }`. Replies carry copies, so a caller cannot change the stored links. Retain the earlier exact normalizeLink rules, including inherited ordinary data fields, ECMAScript trim/lowercase, UTF16 limits and literal https prefix rather than full URL parsing. Seeds are dense readonly/frozen arrays of at most 10000 valid Links with unique already-normalized slugs, exactly url/slug/visits own data fields and nonnegative integer visits<=1000000. Each API owns separate shallow record copies; primitive fields make these sufficient. Requests have ordinary string method/path fields, path<=256 units; normalization raw strings<=20000 units. Match methods/paths exactly and case-sensitively with no trimming, URL decoding or query handling. GET preserves insertion order, POST collisions occur after normalization, invalid/collision/unknown requests leave state unchanged. Reply wrappers, arrays and every link/error object are fresh mutable values without aliases into stored/seed/caller state. At most10000 requests and10000 live links are used. This is a synchronous in-memory exercise, not an HTTP deployment. Preserve unknown input/body types, readonly seed and the typed returned handler. Target: O(n+s) time and O(n+s) extra space as a common bound per API construction or request, where n is current/seed link count+1 and s is combined raw path/url/slug UTF16 length+1. This covers the junior linear lookup and listing/copying; Map versions improve some routes.",
  "Extend `createApi`. `POST /api/links/SLUG/visit` adds one to that link's visits and returns 200 with the updated link. `DELETE /api/links/SLUG` removes the link and returns 200 `{ deleted: \"SLUG\" }`; a deleted slug is free to use again. An unknown slug returns 404 `{ error: \"not_found\" }`, and so does a visit sent with any method but POST. Keep every earlier normalization, seed/ownership, typing and exact route rule/bound. A successful visit increments once and returns a fresh copy; unknown/wrong-method/malformed paths never increment or delete. Route slugs are exact stored keys, without lowercasing, decoding, trimming, query parsing or trailing-slash/newline acceptance. DELETE removes only that key and keeps survivors in insertion order;a subsequent POST of the deleted normalized slug appends a fresh link with zero visits. Seeds have visits<=1000000 and at most 10000 requests, so every increment stays a safe integer. Reply mutation never changes future state. Target: O(n+s) time and O(n+s) extra space as the same common construction/request bound, n=live/seed links+1, s=combined raw path/url/slug length+1; correct Map implementations may improve lookup/deletion while the junior array implementation retains linear work.",
  'Keep your typed API and export `normalizeLink` and `createApi` from this file. Add `export default function App({ fetcher })`: use the `fetcher` prop, or when it is missing, one `createLocalFetch(createApi(SEED))` per mounted app, importing `createLocalFetch` from \'./localFetch\'. SEED is `[{ url: "https://developer.mozilla.org", slug: "mdn", visits: 3 }, { url: "https://react.dev", slug: "react", visits: 0 }]`. On mount, GET /api/links. From the first render until the answer arrives, show "Loading" with `role="status"`. Then list each link in an `li` with its slug and url, and its visits in an `output` labelled "visits SLUG". An empty list shows "No links". A rejected or non-2xx answer shows "Request failed" with `role="alert"` and a "Retry" button that loads again. Give every link a "Visit SLUG" button that POSTs /api/links/SLUG/visit and then loads the list again. `./localFetch` runs your own handler in the page; there is no server behind it.',
  'Add a form with inputs labelled "URL" and "Slug" and a "Shorten" button. Submitting POSTs JSON to /api/links with `headers: { "Content-Type": "application/json" }`, and Shorten is disabled until the request settles. On 201, load the list again and clear both inputs. On 409 show "Slug already taken" with `role="alert"`; on 400, "Check the link and slug"; on any other failure, "Request failed". After a failure the inputs keep what was typed.',
];

const hints = [
  'Check the shape before anything else: `typeof value !== "object" || value === null || Array.isArray(value)` is `null`. Then check that both fields are strings before you call `trim` on them.',
  'Keep the links in a `Map` from slug to link inside `createApi`, filled from copies of the seed. Copy on the way out too: `{ ...link }`. A 409 is a `has` on that Map.',
  'Split the path: `request.path.split("/")` for `/api/links/abc/visit` gives `["", "api", "links", "abc", "visit"]`. Look the slug up once and answer 404 when the Map does not have it.',
  "Create one transport per mounted app with lazy state. Load all returned links, keep Loading visible until the response is ready, and retry rejected or non-successful responses. Visit POSTs for that slug and then reloads the authoritative list. Parent renders retain the local API; other mounted apps have their own API.",
  "Submit the current URL and Slug as JSON with the Content-Type header and keep Shorten disabled until settlement. Only 201 clears both inputs and reloads. A 409, 400, other status or rejected request keeps both fields and shows its matching alert; a later success removes the old message.",
];

const approaches = [
  ['Return `null` unless the value is a non-array object with string `url` and `slug`.', 'Trim both; lower-case the slug.', 'Test the url\'s prefix and length and the slug\'s pattern; return a new `{ url, slug }` when both pass.'],
  ['Type `normalizeLink` and declare the four types.', 'In `createApi`, copy the seed into a Map keyed by slug.', 'Answer GET and POST on /api/links, with 400, 409 and 404 for everything the brief lists.'],
  ['Split the path into its parts.', 'Handle `POST .../SLUG/visit` and `DELETE .../SLUG`, each looking the slug up first.', 'Return copies, and leave every earlier route as it was.'],
  ['Pick the transport once per mount: the prop, or a local API over SEED.', 'Load the list in an effect; keep a status of loading, ready or error.', 'Render the list with a Visit button that POSTs, then loads again.'],
  ['Keep the two inputs, a pending flag and an error message in state.', 'On submit, POST the JSON body and wait for the answer.', 'On 201 reload and clear; otherwise show the message for that status and keep the inputs.'],
];

const references = [
  [doc('typeof', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof'), doc('String.prototype.startsWith()', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith')],
  [doc('Narrowing unknown', 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html'), doc('HTTP status 409 Conflict', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/409')],
  [doc('HTTP request methods', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods'), doc('HTTP status 404 Not Found', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404')],
  [doc('Fetching data with effects', 'https://react.dev/reference/react/useEffect#fetching-data-with-effects'), doc('Using the Fetch API: checking the response', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#checking_response_status')],
  [doc('Using the Fetch API: setting a body', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#setting_a_body'), doc('Reacting to input with state', 'https://react.dev/learn/reacting-to-input-with-state')],
];

const seedCall = JSON.stringify(LINKS_SEED[0]);
const tests: CallTest[][] = [
  [
    check('normalizeLink({url: " https://devshark.app/learn ", slug: " Learn-JS "})', { url: 'https://devshark.app/learn', slug: 'learn-js' }),
    check('normalizeLink({url: "https://a.io", slug: "abc", extra: 1})', { url: 'https://a.io', slug: 'abc' }, 'extra fields are dropped'),
    check('normalizeLink({url: "http://example.com", slug: "abc"})', null, 'only https links'),
    check('normalizeLink({url: "https://", slug: "abc"})', null, 'a link needs more than the scheme', true),
    check('normalizeLink({url: "https://a.io", slug: "ab"})', null, 'a slug needs three characters', true),
    check('normalizeLink({url: "https://a.io", slug: "no spaces"})', null, 'a slug has no spaces', true),
    check('normalizeLink({url: 42, slug: "abc"})', null, 'the url must be a string', true),
    check('normalizeLink(null)', null, 'null', true),
    check('normalizeLink(["https://a.io", "abc"])', null, 'an array is not a link', true),
    check('(() => { const input = {url: " https://a.io ", slug: "ABC"}; normalizeLink(input); return input; })()', { url: ' https://a.io ', slug: 'ABC' }, 'the input is not changed', true),
  ],
  [check("(()=>{const api=createApi([{url:'https://z',slug:'zzz',visits:0},{url:'https://a',slug:'aaa',visits:0}]);return api({method:'GET',path:'/api/links'}).body.map(v=>v.slug);})()",["zzz", "aaa"]),
    check(`createApi([${seedCall}])({method: "GET", path: "/api/links"})`, { status: 200, body: [LINKS_SEED[0]] }),
    check('createApi([])({method: "POST", path: "/api/links", body: {url: " https://devshark.app ", slug: "Shark"}})', { status: 201, body: { url: 'https://devshark.app', slug: 'shark', visits: 0 } }),
    check('createApi([])({method: "POST", path: "/api/links", body: {url: "ftp://x.io", slug: "abc"}})', { status: 400, body: { error: 'invalid' } }, 'an invalid body'),
    check(`createApi([${seedCall}])({method: "POST", path: "/api/links", body: {url: "https://b.io", slug: "MDN"}})`, { status: 409, body: { error: 'taken' } }, 'a slug is unique, whatever its case', true),
    check('createApi([])({method: "GET", path: "/api/nope"})', { status: 404, body: { error: 'not_found' } }, 'an unknown route', true),
    check('(() => { const api = createApi([]); api({method: "POST", path: "/api/links", body: {url: "https://a.io", slug: "one"}}); return api({method: "GET", path: "/api/links"}).body.length; })()', 1, 'a created link is listed'),
    check(`(() => { const seed = [${seedCall}]; const api = createApi(seed); seed[0].visits = 99; const reply = api({method: "GET", path: "/api/links"}); reply.body[0].visits = 42; return api({method: "GET", path: "/api/links"}).body[0].visits; })()`, 3, 'state is copied in and out', true),
  ],
  [check("createApi([{url:'https://a',slug:'abc',visits:0}])({method:'POST',path:'/api/links/abc/visit\\n'})",{"status": 404, "body": {"error": "not_found"}}),
    check(`(() => { const api = createApi([${seedCall}]); api({method: "POST", path: "/api/links/mdn/visit"}); return api({method: "POST", path: "/api/links/mdn/visit"}); })()`, { status: 200, body: { url: LINKS_SEED[0].url, slug: 'mdn', visits: 5 } }),
    check(`(() => { const api = createApi([${seedCall}]); const reply = api({method: "DELETE", path: "/api/links/mdn"}); return [reply, api({method: "GET", path: "/api/links"}).body]; })()`, [{ status: 200, body: { deleted: 'mdn' } }, []]),
    check(`(() => { const api = createApi([${seedCall}]); api({method: "DELETE", path: "/api/links/mdn"}); return api({method: "POST", path: "/api/links", body: {url: "https://b.io", slug: "mdn"}}).status; })()`, 201, 'a deleted slug is free again'),
    check('createApi([])({method: "POST", path: "/api/links/none/visit"})', { status: 404, body: { error: 'not_found' } }, 'visiting an unknown slug', true),
    check('createApi([])({method: "DELETE", path: "/api/links/none"})', { status: 404, body: { error: 'not_found' } }, 'deleting an unknown slug', true),
    check(`createApi([${seedCall}])({method: "GET", path: "/api/links/mdn/visit"})`, { status: 404, body: { error: 'not_found' } }, 'a visit needs POST', true),
  ],
];

const typeTests: TypeTest[][] = [
  [],
  [{"code": "{const seed:readonly Link[]=[{url:\"https://a\",slug:\"abc\",visits:0}];const api:(request:RequestData)=>Reply=createApi(seed);const result:Reply=api({method:\"GET\",path:\"/api/links\"});const body:unknown=result.body;}"},{"code": "{const bad:string=createApi([])({method:\"GET\",path:\"/api/links\"});}", "rejects": true},{"code": "{const bad:string=createApi([])({method:\"GET\",path:\"/api/links\"}).body;}", "rejects": true},
    { code: '{ const draft: Draft | null = normalizeLink({}); const link: Link = { url: "https://a.io", slug: "abc", visits: 0 }; const api: (request: RequestData) => Reply = createApi([link]); }' },
    { code: '{ const link: Link = { url: "https://a.io", slug: "abc", visits: "0" }; }', rejects: true },
    { code: '{ const wrong: string = normalizeLink({}); }', rejects: true },
    { code: '{ createApi([{ url: "https://a.io" }]); }', rejects: true },
  ],
  [{"code": "{const bad:string=createApi([])({method:\"POST\",path:\"/api/links/abc/visit\"});}", "rejects": true},
    { code: '{ const reply: Reply = createApi([])({ method: "DELETE", path: "/api/links/abc" }); }' },
    { code: '{ createApi([])({ method: "GET" }); }', rejects: true },
  ],
];

const settle = "const settle=async()=>{await waitFor(()=>expect(screen.queryByText('Loading')).toBeNull())};";
const PRELUDE = `import React from 'react';import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';import App,{normalizeLink,createApi} from './App';import {createLocalFetch} from './localFetch';afterEach(cleanup);\n${runtimeSuite(tests.flat())}\nconst seed=${JSON.stringify(LINKS_SEED)};const endpoint=${JSON.stringify(ENDPOINT)};${settle}\n`;

/** The shared header of the React levels' suites: the imports, every API
 * check as a test of its own, and the seed the UI checks start from. */
export const FULLSTACK_PATH_PRELUDES: Record<string, string> = { [LINKS_ID]: PRELUDE };

const suites = [
  `const alertText=()=>screen.queryAllByRole('alert').map((node)=>{const copy=node.cloneNode(true);copy.querySelectorAll('button').forEach((button)=>button.remove());return copy.textContent;}).join(' ').trim();
test('lists links from your own API, with a working default',async()=>{render(<App/>);await settle();expect(screen.getAllByRole('listitem').length).toBe(2);expect(screen.getByLabelText('visits mdn').textContent).toBe('3');cleanup();const api=createApi(seed);api({method:'POST',path:endpoint,body:{url:'https://example.com',slug:'extra'}});render(<App fetcher={createLocalFetch(api)}/>);await settle();expect(screen.getAllByRole('listitem').length).toBe(3);expect(screen.getAllByRole('listitem')[2].textContent).toContain('https://example.com');});
test('loading, an empty list, failure and retry',async()=>{let resolve;render(<App fetcher={()=>new Promise((done)=>{resolve=done;})}/>);expect(screen.getByRole('status').textContent).toBe('Loading');resolve({ok:true,status:200,json:async()=>[]});await settle();expect(screen.getByText('No links').textContent).toBe('No links');cleanup();let calls=0;render(<App fetcher={async()=>{calls+=1;if(calls===1)throw new Error('offline');return {ok:true,status:200,json:async()=>[]};}}/>);await waitFor(()=>expect(alertText()).toBe('Request failed'));fireEvent.click(screen.getByRole('button',{name:'Retry',exact:true}));await settle();expect(screen.getByText('No links').textContent).toBe('No links');cleanup();render(<App fetcher={async()=>({ok:false,status:500,json:async()=>({error:'boom'})})}/>);await waitFor(()=>expect(alertText()).toBe('Request failed'));});
test('a visit goes through your API',async()=>{const api=createApi(seed);render(<App fetcher={createLocalFetch(api)}/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Visit react',exact:true}));await waitFor(()=>expect(screen.getByLabelText('visits react').textContent).toBe('1'));expect(api({method:'GET',path:endpoint}).body[1].visits).toBe(1);});`,
  `const fill=(label,value)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
test('shortening a link round-trips through your API',async()=>{const api=createApi(seed);render(<App fetcher={createLocalFetch(api)}/>);await settle();fill('URL','https://devshark.app');fill('Slug','Shark');fireEvent.click(screen.getByRole('button',{name:'Shorten',exact:true}));await waitFor(()=>expect(screen.getByLabelText('visits shark').textContent).toBe('0'));expect(screen.getByLabelText('URL').value).toBe('');expect(screen.getByLabelText('Slug').value).toBe('');expect(api({method:'GET',path:endpoint}).body.length).toBe(3);});
test('a taken slug and an invalid link keep what was typed',async()=>{render(<App fetcher={createLocalFetch(createApi(seed))}/>);await settle();fill('URL','https://example.com');fill('Slug','MDN');fireEvent.click(screen.getByRole('button',{name:'Shorten',exact:true}));await waitFor(()=>expect(alertText()).toBe('Slug already taken'));expect(screen.getByLabelText('Slug').value).toBe('MDN');fill('URL','ftp://nope');fill('Slug','fine');fireEvent.click(screen.getByRole('button',{name:'Shorten',exact:true}));await waitFor(()=>expect(alertText()).toBe('Check the link and slug'));expect(screen.getByLabelText('URL').value).toBe('ftp://nope');expect(screen.getAllByRole('listitem').length).toBe(2);});
test('the request carries JSON and Shorten waits for it',async()=>{let finish;const sent=[];const local=createLocalFetch(createApi(seed));render(<App fetcher={(url,options)=>{if(options&&options.method==='POST'&&url===endpoint){sent.push(options);return new Promise((done)=>{finish=()=>done(local(url,options));});}return local(url,options);}}/>);await settle();fill('URL','https://devshark.app');fill('Slug','shark');fireEvent.click(screen.getByRole('button',{name:'Shorten',exact:true}));expect(sent.length).toBe(1);expect(sent[0].headers['Content-Type']).toBe('application/json');expect(JSON.parse(sent[0].body).slug).toBe('shark');expect(screen.getByRole('button',{name:'Shorten',exact:true}).disabled).toBe(true);finish();await waitFor(()=>expect(screen.getByRole('button',{name:'Shorten',exact:true}).disabled).toBe(false));await waitFor(()=>expect(screen.getByLabelText('visits shark').textContent).toBe('0'));});
test('a failed request shows Request failed',async()=>{const local=createLocalFetch(createApi(seed));render(<App fetcher={(url,options)=>options&&options.method==='POST'&&url===endpoint?Promise.resolve({ok:false,status:500,json:async()=>({error:'boom'})}):local(url,options)}/>);await settle();fill('URL','https://devshark.app');fill('Slug','shark');fireEvent.click(screen.getByRole('button',{name:'Shorten',exact:true}));await waitFor(()=>expect(alertText()).toBe('Request failed'));expect(screen.getByLabelText('Slug').value).toBe('shark');});`,
];

const TYPED_STARTER = `type Draft = { url: string; slug: string };
type Link = Draft & { visits: number };
type RequestData = { method: string; path: string; body?: unknown };
type Reply = { status: number; body: unknown };

function normalizeLink(value: unknown): Draft | null {
  return null;
}

function createApi(seed: readonly Link[]): (request: RequestData) => Reply {
  return () => ({ status: 404, body: { error: "not_found" } });
}
`;

const JS_STARTER = `// Link shortener. Level 1 checks the input every later level relies on.

function normalizeLink(value) {
  return null;
}
`;

/** Levels 1–3 carry runtime tests (and 2–3 type tests); 4–5 carry a React
 * suite whose prelude re-runs every API test. */
export function buildFullStackPathTasks(): CodingTask[] {
  const project = EVOLVING_CHALLENGES.find((one) => one.id === LINKS_ID)!;
  return project.stages.map((id, index): CodingTask => {
    const track = evolvingTaskTrack(id);
    const react = track === 'react';
    return {
      id, track, topic: track, level: 25, tier: 2, verify: 'tests',
      title: `${project.title} · ${index + 1}`,
      prompt: index === 0 ? "A link shortener turns a long URL into a short slug. Start with the check every later level relies on. Write `normalizeLink(value)`: accept a non-null object that is not an array, with a string `url` and a string `slug`. Trim both. The url must start with `https://` and have something after it, 200 characters at most. The slug is lower-cased and must be 3 to 20 characters of `a`\u2013`z`, `0`\u2013`9` and `-`. Return a new `{ url, slug }`, or `null` when anything is wrong. Ignore extra fields and never change the input. Use ECMAScript trim and toLowerCase, then measure UTF16 code units. Only the literal https prefix and length are checked; spaces or line breaks inside the remaining text are not URL validation errors. Hyphens may appear anywhere in a valid slug. Required fields may be inherited data fields; ignore extra fields without reading them. Inputs contain ordinary data fields, no proxies or required-field accessors, with at most 20000 code units per raw string. Return a fresh mutable record on each success, without retaining caller state. Target: O(n) time and O(n) space, where n is one plus the combined UTF16 lengths of the raw url and slug, including trimming and lowercase conversion. Non-string shape checks take constant time." : prompts[index],
      previousRequirements: prompts.slice(0, index),
      references: index === 0 ? [...references[0], doc('String trimming', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/trim'), doc('Lowercase conversion', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toLowerCase')] : references[index],

      hints: [hints[index]],
      approach: [...approaches[index]],
      focus: index === 0 ? ['objects', 'strings'] : react ? ['useEffect', 'fetch', 'forms'] : ['narrowing', 'unions'],
      estimatedMinutes: 20 + index * 5,
      starter: index === 0 ? JS_STARTER : TYPED_STARTER + (react ? LINKS_REACT_SCAFFOLD : ''),
      ...(react
        ? { suite: PRELUDE + suites.slice(0, index - 2).join('\n') }
        : {
          tests: [...tests.slice(0, index + 1).flat(), ...(index === 0 ? [{"call": "normalizeLink({url:'https://a b',slug:' A-B '})", "expected": {"url": "https://a b", "slug": "a-b"}, "label": "prefix and length only; this is not URL parsing"}] : [])],
          ...(index > 0 ? { typeTests: typeTests.slice(0, index + 1).flat() } : {}),
        }),
    };
  });
}
