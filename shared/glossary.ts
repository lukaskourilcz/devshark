/** The reviewed abbreviation glossary.
 *
 * devShark used to teach abbreviations as a subject: fifteen levels of what
 * letters stand for. That tests recall of expansions, which is not the thing
 * that stops a learner reading a sentence. What stops them is meeting `CORS` in
 * the middle of an explanation and not knowing what it does — and the answer to
 * that is help where the word is, not a path taken in advance.
 *
 * So the path is retired and this replaces it. Every entry is authored: the
 * expansion, one plain sentence about what it means *here*, and the domains it
 * belongs to, because plenty of these mean different things in different
 * places. Nothing is guessed, nothing is generated, and a term nobody has
 * written a definition for simply gets no help rather than an invented one.
 *
 * Two rules the matcher below enforces rather than assumes:
 *
 *   - **Word boundaries and case.** `API` matches `API`, and never the `api`
 *     inside `rapid` or a lowercase variable name.
 *   - **Not everything capitalised is an acronym.** `npm` is a name, not
 *     initials, and inventing an expansion for it would be worse than silence.
 *     The `expansion` field is optional for exactly this reason. */


/** Where a term means what the entry says it means. A term with more than one
 * sense carries one entry per domain, and the surrounding content decides. */
const GLOSSARY_DOMAINS = [
  'web', 'javascript', 'typescript', 'react', 'nodejs', 'databases',
  'security', 'devops', 'ai', 'dsa', 'general',
] as const;
export type GlossaryDomain = (typeof GLOSSARY_DOMAINS)[number];

export interface GlossaryEntry {
  /** The abbreviation exactly as it is written in content. */
  term: string;
  /** What the letters stand for. Absent when the term is a name rather than
   * initials — `npm` has no expansion, and pretending otherwise is a mistake. */
  expansion?: string;
  /** One sentence on what it means and why it matters here. */
  meaning: string;
  /** The domains this sense belongs to. A term with two senses has two
   * entries with different domains, and the content's own topic picks. */
  domains: readonly GlossaryDomain[];
  /** ISO date this entry was last reviewed. */
  reviewed: string;
}

const R = '2026-09-08';

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: 'API',
    expansion: 'Application Programming Interface',
    meaning: 'The agreed set of calls one piece of software offers another — the promise about what you may ask for and what comes back.',
    domains: ['web', 'javascript', 'nodejs', 'general', 'ai'],
    reviewed: R,
  },
  {
    term: 'HTTP',
    expansion: 'HyperText Transfer Protocol',
    meaning: 'The request-and-response protocol the web runs on: a method, a URL, headers, and a status code coming back.',
    domains: ['web', 'general', 'nodejs'],
    reviewed: R,
  },
  {
    term: 'HTTPS',
    expansion: 'HTTP Secure',
    meaning: 'HTTP carried over TLS, so the connection is encrypted, the server is authenticated, and nothing in between can alter it.',
    domains: ['web', 'security', 'general'],
    reviewed: R,
  },
  {
    term: 'URL',
    expansion: 'Uniform Resource Locator',
    meaning: 'The address of a resource: scheme, host, path, and optionally a query string and a fragment.',
    domains: ['web', 'general'],
    reviewed: R,
  },
  {
    term: 'DNS',
    expansion: 'Domain Name System',
    meaning: 'The lookup that turns a hostname into an IP address before a connection can be opened.',
    domains: ['web', 'devops', 'general'],
    reviewed: R,
  },
  {
    term: 'CORS',
    expansion: 'Cross-Origin Resource Sharing',
    meaning: 'The headers by which a server tells the browser which other origins may read its responses — a relaxation of the same-origin rule, granted by the target.',
    domains: ['web', 'security', 'javascript'],
    reviewed: R,
  },
  {
    term: 'DOM',
    expansion: 'Document Object Model',
    meaning: 'The live tree of objects a browser builds from HTML, and the thing scripts read and change.',
    domains: ['web', 'javascript', 'react'],
    reviewed: R,
  },
  {
    term: 'JSON',
    expansion: 'JavaScript Object Notation',
    meaning: 'A text format for objects, arrays, strings, numbers, booleans and null — and nothing else, which is why dates and undefined do not survive it.',
    domains: ['web', 'javascript', 'general'],
    reviewed: R,
  },
  {
    term: 'CSS',
    expansion: 'Cascading Style Sheets',
    meaning: 'The language that describes how markup is presented, and the cascade that decides which rule wins when several apply.',
    domains: ['web', 'general'],
    reviewed: R,
  },
  {
    term: 'HTML',
    expansion: 'HyperText Markup Language',
    meaning: 'The markup that gives a document its structure and meaning — headings, lists, links, form controls — before any styling.',
    domains: ['web', 'general'],
    reviewed: R,
  },
  {
    term: 'SPA',
    expansion: 'Single-Page Application',
    meaning: 'An app that loads one shell and then builds and changes the interface in the browser instead of fetching a new document per view.',
    domains: ['web', 'react', 'general'],
    reviewed: R,
  },
  {
    term: 'SSR',
    expansion: 'Server-Side Rendering',
    meaning: 'Building the HTML on the server so the first response already contains the page, rather than a shell the browser has to fill in.',
    domains: ['react', 'web'],
    reviewed: R,
  },
  {
    term: 'JSX',
    meaning: 'React’s syntax for describing elements in JavaScript. It is compiled to function calls — it is not HTML, and its attribute names differ in places.',
    domains: ['react'],
    reviewed: R,
  },
  {
    term: 'SQL',
    expansion: 'Structured Query Language',
    meaning: 'The language for querying and changing relational data: what to select, from where, filtered how, grouped by what.',
    domains: ['databases', 'general'],
    reviewed: R,
  },
  {
    term: 'ORM',
    expansion: 'Object-Relational Mapping',
    meaning: 'A layer that presents rows as objects. It saves boilerplate and hides the query, which is fine until the query is the problem.',
    domains: ['databases', 'nodejs'],
    reviewed: R,
  },
  {
    term: 'ACID',
    expansion: 'Atomicity, Consistency, Isolation, Durability',
    meaning: 'The four guarantees a transactional database offers: all-or-nothing, valid state, non-interference, and surviving a crash.',
    domains: ['databases'],
    reviewed: R,
  },
  {
    term: 'JWT',
    expansion: 'JSON Web Token',
    meaning: 'A signed token carrying claims. The signature proves who issued it; it is not encrypted, so anything inside it is readable.',
    domains: ['security', 'web', 'nodejs'],
    reviewed: R,
  },
  {
    term: 'XSS',
    expansion: 'Cross-Site Scripting',
    meaning: 'Getting your script to run in someone else’s page, usually by way of content the page rendered without escaping it.',
    domains: ['security', 'web'],
    reviewed: R,
  },
  {
    term: 'CSRF',
    expansion: 'Cross-Site Request Forgery',
    meaning: 'Making a signed-in browser send a request it did not intend, using the credentials it already carries.',
    domains: ['security', 'web'],
    reviewed: R,
  },
  {
    term: 'RBAC',
    expansion: 'Role-Based Access Control',
    meaning: 'Deciding what someone may do from the role they hold, rather than from a list attached to each person.',
    domains: ['security', 'databases'],
    reviewed: R,
  },
  {
    term: 'RLS',
    expansion: 'Row-Level Security',
    meaning: 'Rules the database itself applies to decide which rows a caller may see, so a forgotten filter in the application is not the only defence.',
    domains: ['databases', 'security'],
    reviewed: R,
  },
  {
    term: 'CI',
    expansion: 'Continuous Integration',
    meaning: 'Merging work frequently and running the checks automatically on every change, so problems are found small.',
    domains: ['devops', 'general'],
    reviewed: R,
  },
  {
    term: 'CD',
    expansion: 'Continuous Delivery',
    meaning: 'Keeping the main branch releasable at all times, so shipping is a decision rather than a project.',
    domains: ['devops'],
    reviewed: R,
  },
  {
    term: 'CDN',
    expansion: 'Content Delivery Network',
    meaning: 'Servers near the user that hold copies of your static responses, so the distance a byte travels is shorter.',
    domains: ['devops', 'web'],
    reviewed: R,
  },
  {
    term: 'TTL',
    expansion: 'Time To Live',
    meaning: 'How long a cached or stored value may be used before it must be fetched or checked again.',
    domains: ['devops', 'databases', 'web'],
    reviewed: R,
  },
  {
    term: 'LLM',
    expansion: 'Large Language Model',
    meaning: 'A model that predicts text. Useful where a plausible answer is checkable; unreliable wherever the answer has to be exactly right and nothing verifies it.',
    domains: ['ai'],
    reviewed: R,
  },
  {
    term: 'RAG',
    expansion: 'Retrieval-Augmented Generation',
    meaning: 'Fetching relevant documents first and giving them to the model, so its answer is grounded in something you can cite and check.',
    domains: ['ai'],
    reviewed: R,
  },
  {
    term: 'MCP',
    expansion: 'Model Context Protocol',
    meaning: 'A protocol for exposing tools and data to a model through a declared interface, rather than by pasting them into a prompt.',
    domains: ['ai'],
    reviewed: R,
  },
  {
    term: 'DSA',
    expansion: 'Data Structures and Algorithms',
    meaning: 'How data is arranged and what that arrangement costs — the arrays, maps, stacks, queues, trees and the operations over them.',
    domains: ['dsa', 'general'],
    reviewed: R,
  },
  {
    term: 'TDD',
    expansion: 'Test-Driven Development',
    meaning: 'Writing the failing test before the code that satisfies it. A way of working, not a requirement for a test to count.',
    domains: ['general', 'devops'],
    reviewed: R,
  },
  {
    term: 'npm',
    // No expansion on purpose: it is a name, not initials. Inventing one would
    // be worse than saying nothing.
    meaning: 'The default package registry and command-line tool for Node projects. The name is not an acronym.',
    domains: ['nodejs', 'javascript', 'devops'],
    reviewed: R,
  },
  {
    term: 'ARIA',
    expansion: 'Accessible Rich Internet Applications',
    meaning: 'Attributes that describe roles, states and properties to assistive technology — for use when a native element cannot say it already.',
    domains: ['web', 'react'],
    reviewed: R,
  },
];

/* ── matching ──────────────────────────────────────────────────────────── */

const BY_TERM = new Map<string, GlossaryEntry[]>();
for (const entry of GLOSSARY) {
  const list = BY_TERM.get(entry.term) ?? [];
  list.push(entry);
  BY_TERM.set(entry.term, list);
}

/** Every distinct term, longest first, so a longer match wins over a shorter
 * one that is a prefix of it. */
const TERMS = [...BY_TERM.keys()].sort((a, b) => b.length - a.length);

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The glossary entries a block of text actually contains, in the order the
 * terms first appear.
 *
 * Matching is exact-case and boundary-aware: `API` matches `API` and never the
 * `api` inside `rapid` or a lowercase identifier. When a term has more than one
 * sense, `domain` picks; without a hint every sense is returned, so a learner
 * sees that the word is ambiguous rather than being told the wrong one.
 */
export function termsIn(text: string, domain?: GlossaryDomain): GlossaryEntry[] {
  if (!text) return [];
  const found: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const term of TERMS) {
    // A boundary on each side that is not a word character, so `API` inside
    // `APIs` still matches (plural) but `rapid` does not.
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeForRegExp(term)}(s?)($|[^A-Za-z0-9_])`);
    if (!pattern.test(text)) continue;
    const senses = BY_TERM.get(term) ?? [];
    const scoped = domain ? senses.filter((entry) => entry.domains.includes(domain)) : senses;
    for (const entry of scoped.length > 0 ? scoped : senses) {
      const key = `${entry.term}|${entry.domains.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(entry);
    }
  }
  // Order by where each term first appears, so the list reads with the text.
  return found.sort((a, b) => text.indexOf(a.term) - text.indexOf(b.term));
}

/** Terms across several blocks — a question with its options and explanation —
 * de-duplicated, so one control covers the whole item. */
export function termsInAll(texts: readonly (string | undefined)[], domain?: GlossaryDomain): GlossaryEntry[] {
  const joined = texts.filter((one): one is string => typeof one === 'string' && one.length > 0).join('\n');
  return termsIn(joined, domain);
}

export const isGlossaryDomain = (value: unknown): value is GlossaryDomain =>
  typeof value === 'string' && (GLOSSARY_DOMAINS as readonly string[]).includes(value);
