/** M05 Data plumbing (temporary file and id until B9 renumbers the path).
 *
 * The module between the integration modules and the model modules. M02
 * taught a connector to survive one messy feed; this one moves records
 * between systems with SQL, legacy exports and a paginated API, and keeps
 * the result honest under replay.
 *
 * Two lessons, one six-question SQL reading check, one graded TypeScript
 * reconciliation. devShark runs no SQL (decision D5 in the flagship plan),
 * so SQL is graded as reading: every table, query result, export row and
 * API page is a fixture written for this module, and the lessons say so.
 *
 * The reconciliation splits its criteria four ways, all critical: the
 * validated record shape, a count for every row read, the same ledger
 * whatever order the batches replay in, and a failed walk that writes
 * nothing. A dropped row or an order-dependent merge cannot be averaged
 * away by a correct record shape.
 *
 * Kestrel Lane Supply, its customers, account ids and addresses are
 * invented. Email addresses use the reserved `.example` domain. No real
 * customer data, live database, vendor account or network call appears
 * anywhere in it. */

import type { ModuleSource } from '../../types';

/** The legacy CSV reader, the fixture export, the fixture CRM pages and the
 * client builder the assertions run against. Appended after the learner's
 * code, so none of it can be shadowed by a same-named declaration.
 *
 * `parseCsv` is the one API the brief hands the learner. It follows RFC 4180
 * (quoted fields, doubled quotes, CRLF or LF line ends) and skips empty
 * lines. Written with String.raw so its escapes reach the sandbox as source. */
const ACCOUNT_SOURCES = String.raw`
var parseCsv = function (text) {
  var rows = [];
  var row = [];
  var field = '';
  var quoted = false;
  var started = false;
  var i = 0;
  while (i < text.length) {
    var ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i += 1; continue; }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') { quoted = true; started = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; started = true; i += 1; continue; }
    if (ch === '\r' || ch === '\n') {
      if (started) { row.push(field); rows.push(row); }
      row = [];
      field = '';
      started = false;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    started = true;
    i += 1;
  }
  if (started) { row.push(field); rows.push(row); }
  return rows;
};

var __CSV = [
  'account_id,region,name,email,updated_at',
  'ACC-0001,north,Orchard Row Bakery,billing@orchardrow.example,2026-03-01 09:00:00',
  'acc-0002 ,south,"Fenwick, Hale & Co",accounts@fenwickhale.example,2026-03-01 10:30:00',
  ',north,No Id Ltd,ops@noid.example,2026-03-01 11:00:00',
  'ACC-0003,east,Tarn Valley Dairy,tarn-valley.example,2026-03-02 08:00:00',
  'ACC-0004,west,"Quill & Ledger ""Stationers"""," Finance@QuillLedger.example ",2026-03-02 08:15:00',
  'ACC-0002,south,"Fenwick, Hale & Co",accounts@fenwickhale.example,2026-03-01 10:30:00',
  'ACC-0005,north,Mossgate Hardware,help@mossgate.example,03/02/2026 09:00'
].join('\r\n') + '\r\n';

var __PAGES = [
  {
    cursor: null,
    nextCursor: 'c2',
    accounts: [
      { accountId: 'ACC-0002', displayName: 'Fenwick Hale & Co', email: 'accounts@fenwickhale.example', modifiedAt: '2026-03-03T09:00:00Z' },
      { accountId: 'ACC-0006', displayName: 'Brackenridge Clinic', email: 'admin@brackenridge.example', modifiedAt: '2026-03-03T12:00:00Z' },
      { accountId: '', displayName: 'Unlinked signup', email: 'hello@unlinked.example', modifiedAt: '2026-03-03T12:05:00Z' }
    ]
  },
  {
    cursor: 'c2',
    nextCursor: 'c3',
    accounts: [
      { accountId: 'ACC-0001', displayName: 'Orchard Row Bakery Ltd', email: 'billing@orchardrow.example', modifiedAt: '2026-02-20T16:00:00Z' },
      { accountId: 'ACC-0007', displayName: 'Wren Street Books', email: 'shop@wrenstreet.example', modifiedAt: '2026-03-04T10:00:00Z' }
    ]
  },
  {
    cursor: 'c3',
    nextCursor: null,
    accounts: [
      { accountId: 'ACC-0007', displayName: 'Wren St Books', email: 'shop@wrenstreet.example', modifiedAt: '2026-03-01T10:00:00Z' },
      { accountId: 'ACC-0004', displayName: 'Quill and Ledger', email: 'finance@quillledger.example', modifiedAt: '2026-03-02T08:15:00Z' },
      { accountId: 'ACC-0008', displayName: 'Larchfield School', email: null, modifiedAt: '2026-03-05T07:30:00Z' }
    ]
  }
];

var __makeClient = function (pages, options) {
  var opts = options || {};
  var client = {
    requests: [],
    listAccounts: function (cursor) {
      var key = cursor === undefined ? null : cursor;
      client.requests.push(key);
      if (opts.failOn !== undefined && opts.failOn === key) {
        return Promise.reject({ status: opts.status || 503, message: 'account service unavailable' });
      }
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].cursor === key) {
          return Promise.resolve(JSON.parse(JSON.stringify({ accounts: pages[i].accounts, nextCursor: pages[i].nextCursor })));
        }
      }
      return Promise.reject({ status: 404, message: 'unknown cursor ' + String(key) });
    }
  };
  return client;
};

var __client = function () { return __makeClient(__PAGES, {}); };
var __page = function (accounts) { return __makeClient([{ cursor: null, nextCursor: null, accounts: accounts }], {}); };
var __ids = function (applied) { return applied.ledger.map(function (record) { return record.id; }); };
var __counts = function (applied) {
  var report = applied.report;
  return { read: report.read, applied: report.applied, stale: report.stale, rejected: report.rejected.length };
};
var __csv = function (lines) { return lines.join('\r\n'); };
`.trim();

/** The types every version of the exercise shares. The starter and the
 * skeleton both open with them, so the type assertions find them by name. */
const ACCOUNT_TYPES = `type Source = 'csv' | 'api';
type Reason = 'missing-id' | 'bad-email' | 'bad-timestamp';

interface AccountRecord {
  id: string;
  name: string;
  email: string;
  updatedAt: string;
  source: Source;
}

interface Rejection {
  ref: string;
  reason: Reason;
}

interface BatchReport {
  source: Source;
  read: number;
  applied: number;
  stale: number;
  rejected: Rejection[];
}

interface Applied {
  ledger: AccountRecord[];
  report: BatchReport;
}

interface ApiAccount {
  accountId?: unknown;
  displayName?: unknown;
  email?: unknown;
  modifiedAt?: unknown;
}

interface AccountPage {
  accounts: ApiAccount[];
  nextCursor: string | null;
}

interface AccountsClient {
  listAccounts(cursor: string | null): Promise<AccountPage>;
}

// Provided by the task harness: an RFC 4180 reader. Keep this declaration.
declare function parseCsv(text: string): string[][];`;

export const FDE_M05: ModuleSource = {
  id: 'fde-v1-m05',
  title: 'Data plumbing',
  outcomes: [
    'Read a join against fixture tables and name the rows it returns, including the rows an outer join keeps and a WHERE clause then removes.',
    'Spot a join that multiplies rows before an aggregate, and deduplicate a staging table with a tie-breaker that picks the same row on every run.',
    'Choose the index an incremental keyset query needs, and say which rows a timestamp watermark loses.',
    'Write an upsert that an older replay cannot overwrite, and plan a schema change as expand, migrate and contract.',
    'Reconcile a CSV export and a paginated API into one validated ledger that counts every row and comes out the same when the batches replay in either order.',
  ],
  competencies: ['data-plumbing', 'integration'],
  dependsOn: ['fde-v1-m03'],
  estimatedMinutes: 140,
  lessons: [
    {
      id: 'fde-v1-m05-data-l1',
      title: 'SQL for integration: joins, dedupe, incremental loads and upserts',
      summary:
        'The four query shapes an integration runs on: joins that drop or multiply rows, a dedupe that picks the same row every run, a keyset read that loses nothing at a page boundary, and an upsert an older replay cannot overwrite.',
      estimatedMinutes: 30,
      sources: [
        {
          label: 'Bloomberry: I analyzed 1,000 forward deployed engineer jobs (Henley Wing Chiu, November 2025)',
          url: 'https://bloomberry.com/blog/i-analyzed-1000-forward-deployed-engineer-jobs-what-i-learned/',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Palantir: Forward Deployed Software Engineer posting',
          url: 'https://jobs.lever.co/palantir/dab396d4-2f14-4796-aac0-0d82883dccf0',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostgreSQL documentation: table expressions and joined tables',
          url: 'https://www.postgresql.org/docs/current/queries-table-expressions.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostgreSQL documentation: window functions tutorial',
          url: 'https://www.postgresql.org/docs/current/tutorial-window.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostgreSQL documentation: row constructor comparison',
          url: 'https://www.postgresql.org/docs/current/functions-comparisons.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostgreSQL documentation: multicolumn indexes',
          url: 'https://www.postgresql.org/docs/current/indexes-multicolumn.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostgreSQL documentation: indexes and ORDER BY',
          url: 'https://www.postgresql.org/docs/current/indexes-ordering.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostgreSQL documentation: combining multiple indexes',
          url: 'https://www.postgresql.org/docs/current/indexes-bitmap-scans.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'PostgreSQL documentation: INSERT and ON CONFLICT',
          url: 'https://www.postgresql.org/docs/current/sql-insert.html',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'Kestrel Lane Supply wants its support desk to see each customer’s billing state. Billing lives in a twelve-year-old system. The customer gives you read access to a reporting replica and a nightly CSV export, and the CRM has a paginated API. You will write SQL against tables you did not design, and you will read SQL that other people wrote at 2 a.m. This lesson covers the four query shapes that integration work runs on: joins, deduplication, incremental loads and upserts.',
        },
        {
          kind: 'prose',
          body:
            'Postings describe this work. Bloomberry’s analysis of 1,000 FDE postings (November 2025) ranks integrating systems and APIs as the third most cited responsibility, in 32% of them. Palantir’s Forward Deployed Software Engineer posting lists wrangling massive-scale data as part of the job.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Prerequisite: the Databases topic in Learn, levels 5 to 11 (aggregations and GROUP BY through transactions). Take those levels first if a LEFT JOIN or a composite index is new to you. Nothing in this module runs a database. Kestrel Lane Supply, its tables, its rows and every query result below are fixtures written for this module, and the check grades how you read the SQL.',
        },
        {
          kind: 'table',
          caption: 'Fixture table `customers`. Every example in this lesson reads these three tables.',
          headers: ['id', 'name'],
          rows: [
            ['C1', 'Orchard Row Bakery'],
            ['C2', 'Fenwick Hale & Co'],
            ['C3', 'Tarn Valley Dairy'],
          ],
        },
        {
          kind: 'table',
          caption: 'Fixture table `invoices`. Invoice I4 points at customer C9, which the billing team deleted last year.',
          headers: ['id', 'customer_id', 'amount', 'status'],
          rows: [
            ['I1', 'C1', '120', 'paid'],
            ['I2', 'C1', '80', 'open'],
            ['I3', 'C2', '200', 'open'],
            ['I4', 'C9', '50', 'open'],
          ],
        },
        {
          kind: 'table',
          caption: 'Fixture table `contacts`. C1 has two contacts, C2 has one, C3 has none.',
          headers: ['id', 'customer_id', 'email'],
          rows: [
            ['K1', 'C1', 'billing@orchardrow.example'],
            ['K2', 'C1', 'owner@orchardrow.example'],
            ['K3', 'C2', 'accounts@fenwickhale.example'],
          ],
        },
        {
          kind: 'prose',
          body:
            'An inner join keeps a row only when both sides match. Join invoices to customers and I4 drops out, and nothing in the result tells you it happened. Count what a join drops before you trust what it keeps: `SELECT count(*) FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE c.id IS NULL` returns 1 on these tables, and that 1 belongs in your sync report.',
        },
        {
          kind: 'code',
          language: 'sql',
          code:
            "-- A: the status filter sits in ON\nSELECT c.id, i.id AS invoice_id\nFROM customers c\nLEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'open';\n\n-- B: the same filter moved to WHERE\nSELECT c.id, i.id AS invoice_id\nFROM customers c\nLEFT JOIN invoices i ON i.customer_id = c.id\nWHERE i.status = 'open';",
          caption: 'Two queries that differ in one line. A returns C1 with I2, C2 with I3 and C3 with NULL. B returns only the first two rows.',
        },
        {
          kind: 'prose',
          body:
            'The PostgreSQL documentation on joined tables states the rule: the database processes a restriction in ON before the join and a restriction in WHERE after it. Query B first adds C3 with NULL invoice columns, then compares NULL with `open`. That comparison is not true, so C3 leaves the result. Query B is an inner join written the long way.',
        },
        {
          kind: 'prose',
          body:
            'Joins also multiply. C1 has two invoices and two contacts. Join customers to both tables in one query and C1 appears in four rows, one per invoice and contact pair, so `SUM(i.amount)` adds each invoice twice and reports 400 where the invoices hold 200. Aggregate each child table in its own subquery, then join the totals.',
        },
        {
          kind: 'code',
          language: 'sql',
          code:
            'SELECT c.id, inv.billed, con.contacts\nFROM customers c\nLEFT JOIN (\n  SELECT customer_id, SUM(amount) AS billed FROM invoices GROUP BY customer_id\n) inv ON inv.customer_id = c.id\nLEFT JOIN (\n  SELECT customer_id, COUNT(*) AS contacts FROM contacts GROUP BY customer_id\n) con ON con.customer_id = c.id;',
          caption: 'Aggregate before you join. C1 comes back once with 200 billed and 2 contacts, C2 with 200 and 1, C3 with NULL in both columns.',
        },
        {
          kind: 'prose',
          body:
            'A staging table holds whatever the export sent, duplicates included. The usual dedupe numbers the rows inside each key and keeps row 1.',
        },
        {
          kind: 'code',
          language: 'sql',
          code:
            'SELECT account_id, email, updated_at\nFROM (\n  SELECT s.*,\n         row_number() OVER (\n           PARTITION BY s.account_id\n           ORDER BY s.updated_at DESC, s.export_row DESC\n         ) AS rn\n  FROM staging_accounts s\n) ranked\nWHERE rn = 1;',
          caption: 'Keep the newest row per account. The second ORDER BY column decides between rows that share a timestamp.',
        },
        {
          kind: 'prose',
          body:
            'Keep the tie-breaker. The PostgreSQL window-function tutorial says `row_number` numbers rows in the order the ORDER BY defines, with tied rows numbered in an unspecified order. Drop `export_row` and two rows for one account with the same `updated_at` can swap places between runs, so Tuesday’s load keeps a different email from Monday’s. Break ties with a column that is unique inside the partition and means something: the later export row, or the higher version number.',
        },
        {
          kind: 'prose',
          body:
            'An incremental load reads only what changed since the last run. The first version most people write stores the highest `updated_at` it saw and asks for rows after it. Two things break it. When a page boundary falls between rows that share the stored timestamp, `>` skips the rest of them for good. And a writer that stamps `updated_at` when its transaction starts and commits a few seconds later can land a row behind a watermark you already stored.',
        },
        {
          kind: 'code',
          language: 'sql',
          code:
            "-- Resume strictly after the last (updated_at, id) pair you stored.\nSELECT id, name, email, updated_at\nFROM accounts\nWHERE (updated_at, id) > (:last_updated_at, :last_id)\nORDER BY updated_at, id\nLIMIT 500;\n\nCREATE INDEX accounts_updated_at_id ON accounts (updated_at, id);",
          caption: 'A keyset read. The pair (updated_at, id) is unique, so a page boundary can no longer split rows that share a timestamp.',
        },
        {
          kind: 'prose',
          body:
            'PostgreSQL compares row values left to right and stops at the first unequal pair, so `(updated_at, id) > (t, \'ACC-0042\')` means a later timestamp, or the same timestamp with a later id. An index on `(updated_at, id)` returns rows already in that order. The documentation on indexes and ORDER BY adds that with a matching index, `ORDER BY ... LIMIT n` reads the first n rows without scanning the remainder. For the late commits, re-read a short overlap window behind the stored pair on every run, and make the write idempotent so the overlap costs you nothing.',
        },
        {
          kind: 'prose',
          body:
            'Index column order decides how much of the index a query scans. The multicolumn index page gives the rule: equality constraints on leading columns, plus an inequality on the first column without an equality, limit the portion of the index scanned. PostgreSQL 18 adds a B-tree skip scan, which can also use a later column when a leading column has few distinct values; it does not help when the leading column is unique. Three single-column indexes do not add up to one composite: the planner can combine them with a bitmap, but the page on combining indexes notes that the bitmap visits rows in physical order and loses any index ordering, so an ORDER BY needs a separate sort.',
        },
        {
          kind: 'code',
          language: 'sql',
          code:
            'INSERT INTO accounts AS a (tenant_id, external_id, name, email, updated_at)\nVALUES ($1, $2, $3, $4, $5)\nON CONFLICT (tenant_id, external_id) DO UPDATE\nSET name = excluded.name,\n    email = excluded.email,\n    updated_at = excluded.updated_at\nWHERE a.updated_at < excluded.updated_at;',
          caption: 'An upsert that an older replay cannot overwrite. `excluded` is the row the INSERT proposed; `a` is the row already stored.',
        },
        {
          kind: 'prose',
          body:
            'Three details from the PostgreSQL INSERT reference decide whether this works. The conflict target needs a unique index or constraint on exactly `(tenant_id, external_id)`; without one, inference fails and the statement raises an error. The database evaluates the DO UPDATE WHERE clause after it finds a conflict, and it locks a row that fails the clause without updating it, so an older replay changes nothing. And one INSERT may not change the same existing row twice: a batch that carries ACC-0042 twice raises a cardinality violation, which is why the dedupe step runs before the upsert.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'The guard compares timestamps, and an equal timestamp keeps the stored row. If two sources can write the same account with the same `updated_at`, whichever loads first wins, and a replay in the other order leaves a different answer. Decide which source outranks the other on a tie, write that down for the customer, and put it in the comparison. The exercise at the end of this module builds that rule into its merge.',
        },
        {
          kind: 'table',
          caption: 'What each technique in this lesson protects you from, and what it still needs from you.',
          headers: ['Technique', 'Failure it prevents', 'What it still needs'],
          rows: [
            ['Count the rows a join drops', 'Orphans vanishing from an inner join', 'A line in the sync report for the count'],
            ['Aggregate before joining', 'Sums inflated by a one-to-many fan-out', 'One subquery per child table'],
            ['`row_number` with a unique tie-breaker', 'A dedupe that keeps a different row each run', 'A column that orders ties for a reason'],
            ['Keyset on `(updated_at, id)`', 'Rows lost at a page boundary', 'An index with the same columns in the same order'],
            ['Upsert with a version guard', 'An older replay overwriting newer data', 'A unique index on the key and a rule for ties'],
          ],
        },
      ],
    },
    {
      id: 'fde-v1-m05-data-l2',
      title: 'Pipelines, schema migration, legacy sources and backfills',
      summary:
        'The stages a load passes through and the counts each one owes you, RFC 4180 CSV and SOAP 1.2 faults from legacy systems, expand-and-contract schema changes on a live table, and a backfill that can stop, restart and interleave with the nightly job.',
      estimatedMinutes: 30,
      sources: [
        { label: 'RFC 4180: Common Format and MIME Type for CSV Files', url: 'https://www.rfc-editor.org/rfc/rfc4180', reviewedOn: '2026-10-21' },
        { label: 'W3C: SOAP Version 1.2 Part 1, Messaging Framework', url: 'https://www.w3.org/TR/soap12-part1/', reviewedOn: '2026-10-21' },
        { label: 'W3C: SOAP Version 1.2 Part 2, Adjuncts (HTTP binding)', url: 'https://www.w3.org/TR/soap12-part2/', reviewedOn: '2026-10-21' },
        { label: 'Danilo Sato: ParallelChange (martinfowler.com, 2014)', url: 'https://martinfowler.com/bliki/ParallelChange.html', reviewedOn: '2026-10-21' },
        { label: 'PostgreSQL documentation: ALTER TABLE', url: 'https://www.postgresql.org/docs/current/sql-altertable.html', reviewedOn: '2026-10-21' },
        { label: 'PostgreSQL documentation: CREATE INDEX', url: 'https://www.postgresql.org/docs/current/sql-createindex.html', reviewedOn: '2026-10-21' },
        { label: 'PostgreSQL documentation: Explicit Locking (table-level lock modes)', url: 'https://www.postgresql.org/docs/current/explicit-locking.html', reviewedOn: '2026-10-21' },
        { label: 'PostgreSQL documentation: Client Connection Defaults (lock_timeout)', url: 'https://www.postgresql.org/docs/current/runtime-config-client.html', reviewedOn: '2026-10-21' },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'A pipeline is the SQL from the last lesson plus everything around it: where the rows come from, what happens to the ones you cannot use, how the schema changes under a running load, and how you reload a year of history without stopping the nightly job. Each stage owes you a count, and the counts have to add up.',
        },
        {
          kind: 'table',
          caption: 'The stages of one load, and the number each stage reports.',
          headers: ['Stage', 'What it does', 'What it reports'],
          rows: [
            ['Extract', 'Reads the source: a file, the pages of an API, a SOAP call', 'Rows read, per source and run'],
            ['Validate', 'Maps each row to the target shape, or rejects it with a reason', 'Each rejected row with its position and reason'],
            ['Stage', 'Holds the validated batch apart from the live table and drops in-batch duplicates', 'Rows staged, and each dropped duplicate counted as unchanged'],
            ['Load', 'Applies the batch in one transaction with an idempotent upsert', 'Rows applied, and rows that changed nothing, which join the unchanged count'],
            ['Reconcile', 'Checks the counts against each other', 'Read = applied + unchanged + rejected, with duplicates inside unchanged'],
          ],
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            '“Loaded 412” hides the eleven rows you threw away. “Read 423: 412 applied, 11 rejected for a missing account id, rows 7, 19 and 30 among them” gives the customer’s billing team a list to fix at the source, and it tells you next month when eleven has become ninety.',
        },
        {
          kind: 'prose',
          body:
            'The legacy billing system exports CSV. RFC 4180 documents the common format, and it says of itself that it does not specify an Internet standard. Its rules: each record sits on its own line, delimited by CRLF, an optional header line comes first, fields that contain commas, double quotes or line breaks sit inside double quotes, and a double quote inside a quoted field is escaped by doubling it. Split each line on commas and your loader breaks the first time a customer is called `Fenwick, Hale & Co`.',
        },
        {
          kind: 'code',
          language: 'csv',
          code:
            'account_id,region,name,email,updated_at\nacc-0002 ,south,"Fenwick, Hale & Co",accounts@fenwickhale.example,2026-03-01 10:30:00\nACC-0004,west,"Quill & Ledger ""Stationers"""," Finance@QuillLedger.example ",2026-03-02 08:15:00',
          caption: 'Two rows of the fixture export, copied as the exercise loads them. Split on commas, the first row has six fields and its email column reads ` Hale & Co"`.',
        },
        {
          kind: 'prose',
          body:
            'Read columns by header name, not by position: this export puts `region` second, and next quarter’s may not. Trim and normalise the key before you compare it, since the export writes `acc-0002 ` where the CRM writes `ACC-0002`. The same goes for the email: the quotes around `" Finance@QuillLedger.example "` keep its spaces inside the field, so trim and lowercase it before you validate it. And ask which character encoding the export uses. RFC 4180 notes that common usage is US-ASCII and that other character sets travel with a `charset` parameter. A file dropped on a shared drive carries no media type at all, so get the answer from the customer and write it into the integration notes.',
        },
        {
          kind: 'prose',
          body:
            'The finance ledger sits behind a SOAP 1.2 service, and its envelope tells you more than its status code. A SOAP 1.2 fault carries a code. `env:Sender` means the message was malformed or missing information, and the specification says you should generally not resend it without change. `env:Receiver` means processing failed, and the same message could succeed if you resend it later. The SOAP 1.2 HTTP binding sends `env:Sender` faults with status 400 and every other fault, `env:Receiver` included, with 500.',
        },
        {
          kind: 'code',
          language: 'xml',
          code:
            '<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">\n  <env:Body>\n    <env:Fault>\n      <env:Code>\n        <env:Value>env:Receiver</env:Value>\n      </env:Code>\n      <env:Reason>\n        <env:Text xml:lang="en">Ledger is running its nightly close</env:Text>\n      </env:Reason>\n    </env:Fault>\n  </env:Body>\n</env:Envelope>',
          caption: 'A fixture SOAP 1.2 fault, sent with HTTP 500. The code is env:Receiver, so the same message can go again after a wait.',
        },
        {
          kind: 'prose',
          body:
            'So read the fault code before you choose a retry. A client that retries every 500 resends a message that drew an `env:MustUnderstand` fault, which arrives as a 500 too, and the message fails the same way each time. A client that never retries a 500 gives up on a ledger that only needed to finish its nightly close.',
        },
        {
          kind: 'prose',
          body:
            'Schema changes land while the pipeline runs. Danilo Sato’s ParallelChange entry on martinfowler.com splits a breaking change into three phases: expand the interface to support the old and the new version, migrate the clients, then contract by removing the old one. On a table, that sequence looks like this.',
        },
        {
          kind: 'table',
          caption: 'Moving `email` to a new `billing_email` column without stopping the nightly load. Lock notes come from the PostgreSQL ALTER TABLE, CREATE INDEX and explicit locking pages.',
          headers: ['Phase', 'Step', 'Lock it takes, and why the load keeps running'],
          rows: [
            ['Expand', '`ALTER TABLE accounts ADD COLUMN billing_email text`', 'A brief ACCESS EXCLUSIVE lock. With no default, or a non-volatile one, there is no table rewrite, so the statement commits quickly and releases the lock'],
            ['Expand', '`CREATE INDEX CONCURRENTLY` on the new column', 'SHARE UPDATE EXCLUSIVE, which lets inserts, updates and deletes through; it cannot run inside a transaction block'],
            ['Migrate', 'Write both columns, backfill old rows in batches, then move readers to the new column', 'ROW EXCLUSIVE, like any write. Each step can stop and resume, and old readers still see the old column'],
            ['Migrate', 'Add a CHECK constraint `NOT VALID`, then `VALIDATE CONSTRAINT`', 'Adding it takes a brief ACCESS EXCLUSIVE lock and skips the scan. Validation scans under SHARE UPDATE EXCLUSIVE, which lets reads and writes through'],
            ['Contract', 'Stop writing `email`, then drop it', 'Another brief ACCESS EXCLUSIVE lock, and only after no reader, report or job still uses the column'],
          ],
        },
        {
          kind: 'prose',
          body:
            'Brief is not the same as harmless. ACCESS EXCLUSIVE conflicts with every other lock mode, including the one a plain SELECT takes, and an ALTER TABLE waits for any transaction that already holds a lock on the table. If the nightly load has a transaction open on `accounts`, the ALTER waits for it, and the queries that arrive after the ALTER queue behind it, so a one-millisecond change stalls the table for as long as the load runs. Run each ACCESS EXCLUSIVE step with a short `lock_timeout`, such as `SET lock_timeout = \'2s\'`, so PostgreSQL aborts the ALTER instead of letting it wait, and retry it until it lands between transactions.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'A failed `CREATE INDEX CONCURRENTLY` leaves an index marked INVALID. PostgreSQL ignores it for queries and still updates it on every write. Drop it and build it again.',
        },
        {
          kind: 'prose',
          body:
            'A backfill reloads history through the same path as the nightly load: the same validation and the same upsert, in bounded batches, with a checkpoint after each committed batch. Two properties let you stop it, restart it and run it beside the nightly job. Each batch applies whole or not at all, so a failure halfway leaves the target as it was and the retry starts clean. And the merge decides by version, never by arrival: the newest `updated_at` wins, and a fixed source precedence settles a tie. Under that rule the backfill and the nightly load can interleave in any order and end on the same rows.',
        },
        {
          kind: 'table',
          caption: 'Account ACC-0004 arrives from both sources with the same timestamp. The CRM outranks the export, so both orders end on the CRM row.',
          headers: ['Arrival order', 'After the first batch', 'After the second batch'],
          rows: [
            ['CSV, then API', 'The CSV row, 08:15:00', 'The API row: same time, and the CRM outranks the export'],
            ['API, then CSV', 'The API row, 08:15:00', 'The API row: the CSV row is stale and counted as unchanged'],
          ],
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Everything in this module is a fixture: the tables, the query results, the CSV export, the API pages and the SOAP fault. No database, ledger service or CRM runs anywhere in it. The exercise grades TypeScript against the same fixtures.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m05-data-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: SQL for integration',
      summary: 'Joins that drop or multiply rows, a deterministic dedupe, keyset incremental loads with their index, and a guarded upsert, all on fixture tables.',
      competencies: ['data-plumbing'],
      estimatedMinutes: 30,
      lessonId: 'fde-v1-m05-data-l1',
    },
    {
      id: 'fde-v1-m05-data-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: pipelines, migrations, legacy sources and backfills',
      summary: 'Stage counts that add up, RFC 4180 CSV, SOAP 1.2 fault codes, expand-and-contract schema changes and order-free backfills.',
      competencies: ['data-plumbing'],
      estimatedMinutes: 30,
      lessonId: 'fde-v1-m05-data-l2',
    },
    {
      id: 'fde-v1-m05-data-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Read the SQL',
      summary: 'Six SQL reading questions on fixture tables: what a query returns, which index it needs, and what breaks when a load replays.',
      competencies: ['data-plumbing'],
      estimatedMinutes: 20,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-m05-data-q1',
          prompt: 'Which rows does this query return on the fixture tables?',
          context: {
            language: 'sql',
            code:
              "-- customers: C1 Orchard Row Bakery, C2 Fenwick Hale & Co, C3 Tarn Valley Dairy\n-- invoices (id, customer_id, amount, status):\n--   I1 C1 120 paid | I2 C1 80 open | I3 C2 200 open | I4 C9 50 open\nSELECT c.id, i.id AS invoice_id\nFROM customers c\nLEFT JOIN invoices i ON i.customer_id = c.id\nWHERE i.status = 'paid' OR i.id IS NULL;",
          },
          options: [
            '(C1, I1) and (C3, NULL).',
            '(C1, I1), (C2, NULL) and (C3, NULL).',
            '(C1, I1) only.',
            '(C1, I1), (C3, NULL) and (NULL, I4).',
          ],
          correct: 0,
          explanation:
            'The LEFT JOIN runs first and produces (C1, I1), (C1, I2), (C2, I3) and (C3, NULL). WHERE then keeps the paid row and the row with no invoice, so C2 leaves the result: it has an invoice, and that invoice is open. (C2, NULL) is what you get when `i.status = \'paid\'` moves into ON and the WHERE goes: the database then filters invoices before the join, and C2 keeps a NULL-extended row. "(C1, I1) only" treats the query as an inner join, but `OR i.id IS NULL` keeps the NULL-extended row for C3. (NULL, I4) would need a RIGHT or FULL join; a LEFT JOIN from customers never adds a row for an invoice whose customer is missing.',
          competencies: ['data-plumbing'],
        },
        {
          id: 'fde-v1-m05-data-q2',
          prompt: 'What does this query return for customer C1?',
          context: {
            language: 'sql',
            code:
              "-- invoices: I1 C1 120 | I2 C1 80 | I3 C2 200\n-- contacts: K1 C1 | K2 C1 | K3 C2\nSELECT c.id,\n       COUNT(DISTINCT i.id) AS invoices,\n       SUM(i.amount) AS billed\nFROM customers c\nJOIN invoices i ON i.customer_id = c.id\nJOIN contacts k ON k.customer_id = c.id\nWHERE c.id = 'C1'\nGROUP BY c.id;",
          },
          options: [
            'invoices 2, billed 400.',
            'invoices 2, billed 200.',
            'invoices 4, billed 400.',
            'Two rows for C1, one per contact, each with invoices 2 and billed 200.',
          ],
          correct: 0,
          explanation:
            'C1 has two invoices and two contacts, so the joins produce four rows for C1, one per invoice and contact pair. `COUNT(DISTINCT i.id)` collapses those to the two invoice ids. `SUM(i.amount)` has no DISTINCT and adds 120 and 80 twice each, giving 400. "invoices 2, billed 200" is what the author meant, and it needs the sum computed in a subquery before the contacts join. "invoices 4" would need a plain `COUNT(i.id)`. One row per contact would need the contact in the GROUP BY; `GROUP BY c.id` puts all four rows for C1 into one group, whichever contact each came from.',
          competencies: ['data-plumbing'],
        },
        {
          id: 'fde-v1-m05-data-q3',
          prompt: 'Which statement about this dedupe is true on the fixture staging table?',
          context: {
            language: 'sql',
            code:
              "-- staging_accounts (export_row, account_id, email, updated_at)\n--   1  ACC-0007  old@wrenstreet.example    2026-03-04 10:00\n--   2  ACC-0007  shop@wrenstreet.example   2026-03-04 10:00\n--   3  ACC-0007  older@wrenstreet.example  2026-03-01 09:00\nSELECT account_id, email\nFROM (\n  SELECT s.*,\n         row_number() OVER (PARTITION BY account_id ORDER BY updated_at DESC) AS rn\n  FROM staging_accounts s\n) ranked\nWHERE rn = 1;",
          },
          options: [
            'It returns one row for ACC-0007, old@ or shop@, and two runs can disagree on which.',
            'It returns both 10:00 rows for ACC-0007, because `row_number` gives tied rows the same number.',
            'It returns shop@, because tied rows keep the order of `export_row` and the later export row is numbered first.',
            'It raises an error, because the window ORDER BY does not identify a single row in each partition.',
          ],
          correct: 0,
          explanation:
            'The PostgreSQL window tutorial says `row_number` numbers rows in the ORDER BY order, with tied rows numbered in an unspecified order. Rows 1 and 2 tie on `updated_at`, so either can come out as rn = 1, and two runs can disagree. A unique tie-breaker such as `export_row DESC` makes the choice repeatable. Equal numbers for ties is what `rank()` does; `row_number` always hands out distinct numbers. Nothing promises that ties follow `export_row` or any physical order. And PostgreSQL accepts an ORDER BY that leaves ties; it raises no error, so the bug passes any review that runs the query once.',
          competencies: ['data-plumbing'],
        },
        {
          id: 'fde-v1-m05-data-q4',
          prompt:
            'This query runs every five minutes for each of 300 tenants against a 40-million-row `accounts` table. Which index lets PostgreSQL read the next 500 rows in order without scanning the rest?',
          context: {
            language: 'sql',
            code:
              'SELECT id, tenant_id, updated_at, name\nFROM accounts\nWHERE tenant_id = $1\n  AND (updated_at, id) > ($2, $3)\nORDER BY updated_at, id\nLIMIT 500;',
          },
          options: [
            '`(tenant_id, updated_at, id)`',
            '`(updated_at, id)`',
            'Three single-column indexes, on `tenant_id`, `updated_at` and `id`',
            '`(id, tenant_id, updated_at)`',
          ],
          correct: 0,
          explanation:
            'The multicolumn index rule: equality on leading columns, plus an inequality on the first column without an equality, limit the part of the index scanned. Equality on `tenant_id` first, then the range on `updated_at`, narrows the scan to one tenant’s recent rows, already in `updated_at, id` order, so the LIMIT stops after 500. `(updated_at, id)` matches the order, but every tenant’s rows sit interleaved in it, and the scan walks past other tenants’ rows to collect 500 of this one’s. Single-column indexes combine through a bitmap, which visits rows in physical order and loses the index ordering, so the database sorts every match before the LIMIT. `(id, tenant_id, updated_at)` is ordered by `id`, so it cannot return rows in `updated_at, id` order and the database sorts every match before the LIMIT. And `id` is unique, so the PostgreSQL 18 skip scan has no repeated `id` values to skip between.',
          competencies: ['data-plumbing'],
        },
        {
          id: 'fde-v1-m05-data-q5',
          prompt:
            'Batch B loads first and writes ACC-0007 with `shop@wrenstreet.example`, updated 10:00. A retry then replays the older batch A, which carries `old@wrenstreet.example`, updated 09:00. What does ACC-0007 hold afterwards?',
          context: {
            language: 'sql',
            code:
              "-- accounts has a unique index on (tenant_id, external_id)\nINSERT INTO accounts AS a (tenant_id, external_id, email, updated_at)\nVALUES ('T1', 'ACC-0007', :email, :updated_at)\nON CONFLICT (tenant_id, external_id) DO UPDATE\nSET email = excluded.email,\n    updated_at = excluded.updated_at;",
          },
          options: [
            '`old@wrenstreet.example` and 09:00: the replay overwrites the newer row; nothing compares timestamps.',
            '`shop@wrenstreet.example` and 10:00: ON CONFLICT keeps the existing row when the key already exists.',
            '`shop@wrenstreet.example` and 10:00: the replay fails with a unique violation and changes nothing.',
            'Two rows for ACC-0007, one from each batch, until a later dedupe removes the older one.',
          ],
          correct: 0,
          explanation:
            'DO UPDATE applies its SET to the conflicting row whenever its WHERE clause allows, and this statement has no WHERE clause, so the last write wins whatever its age. The replay puts the 09:00 email back. Add `WHERE a.updated_at < excluded.updated_at` and the older replay locks the row without updating it. Keeping the existing row is what `ON CONFLICT DO NOTHING` does, not DO UPDATE. The unique violation is the error ON CONFLICT exists to absorb: the conflict target matches the unique index, so no error reaches you. Two rows cannot exist while the unique index on `(tenant_id, external_id)` holds.',
          competencies: ['data-plumbing'],
        },
        {
          id: 'fde-v1-m05-data-q6',
          prompt:
            'The previous run read Z, A and B, hit its LIMIT of 3, and stored B’s `updated_at`, 10:00:00, as the watermark. B, C and D tie, and on that run B happened to come first among them. No row changes before this run. Which rows does the load miss for good?',
          context: {
            language: 'sql',
            code:
              "-- accounts: Z 09:58:00 | A 09:59:00 | B 10:00:00 | C 10:00:00 | D 10:00:00 | E 10:01:00\nSELECT id, updated_at\nFROM accounts\nWHERE updated_at > :watermark\nORDER BY updated_at\nLIMIT 3;",
          },
          options: [
            'C and D.',
            'None: this run returns C, D and E.',
            'None, but B loads a second time.',
            'B, because `>` excludes the watermark row itself.',
          ],
          correct: 0,
          explanation:
            'C and D share 10:00:00 with B. The previous run stopped between B and C, and `updated_at > 10:00:00` excludes every row at exactly 10:00:00, so this run returns E alone and C and D never load unless someone edits them. A keyset on `(updated_at, id)` resumes after B itself and picks them up. "This run returns C, D and E" describes that keyset, not this query: a timestamp alone cannot tell B from C. "B loads a second time" would need `>=`, and with `>=` and LIMIT 3 this run returns B, C and D, so it does more than repeat B. `>` does exclude B, but the previous run already loaded B, so nothing is lost there.',
          competencies: ['data-plumbing'],
        },
      ],
    },
    {
      id: 'fde-v1-m05-data-reconcile',
      kind: 'code',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Reconcile a CSV export and a paginated API',
      summary:
        'Load a legacy CSV export and three pages of a CRM API into one validated ledger. Graded on the records, on a count for every row, on the same ledger whatever order the batches replay in, and on a failed walk that writes nothing.',
      competencies: ['data-plumbing', 'integration'],
      estimatedMinutes: 60,
      code: {
        language: 'typescript',
        prompt:
          'Kestrel Lane Supply keeps customer accounts in two places: a legacy billing system that exports CSV, and a CRM with a paginated API. Write the two functions that load either source into one ledger of validated accounts.\n\n`applyCsv(ledger, csv)` returns `{ ledger, report }`. `applyApi(ledger, client)` returns a promise for the same shape. Both take the current ledger and return a new one, and neither writes into the ledger it was given.\n\n**Reading the sources**\n\n- CSV: `parseCsv(csv)` comes from the task harness and returns rows of strings, following RFC 4180; it skips empty lines. The first row is the header. Find `account_id`, `name`, `email` and `updated_at` by header name, after trimming and lowercasing each header cell. The columns come in any order, with extra columns you ignore. A row shorter than the header has `\'\'` in its missing cells. Number the data rows from 1: the first row after the header is `csv:1`.\n- API: call `client.listAccounts(null)`, then follow `nextCursor` until it is `null`. Each page is `{ accounts, nextCursor }`, and an empty page does not end the walk. Read `accountId`, `displayName`, `email` and `modifiedAt`. Number the accounts from 1 across all pages, in the order they arrived: `api:1`, `api:2` and on. If a call rejects, let that rejection reach your caller unchanged and do not retry it. Merge nothing until every page has arrived.\n\n**Validating a row.** A value that is not a string counts as `\'\'`. Trim every value, then check in this order and report only the first failure:\n\n1. `id`: uppercase it. An empty id is the rejection `missing-id`.\n2. `email`: lowercase it. It needs exactly one `@`, at least one character on each side, and no whitespace, or the rejection is `bad-email`.\n3. `updatedAt`: either `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SSZ` with ASCII digits, both meaning UTC. Store it as `YYYY-MM-DDTHH:MM:SSZ`. Any other shape is `bad-timestamp`. Only the shape is checked, not the calendar.\n4. `name`: trimmed. An empty name is allowed.\n\nA valid row becomes exactly `{ id, name, email, updatedAt, source }`, with `source` set to `\'csv\'` or `\'api\'`.\n\n**Merging.** Take valid rows in input order. A row whose id is not in the ledger is added. A row whose id is already there replaces the stored record only when it is newer: a later `updatedAt`, or the same `updatedAt` with source `\'api\'` over a stored `\'csv\'` record, because the CRM is the system of record. Any other valid row is stale and changes nothing.\n\n**Reporting.** `report` is `{ source, read, applied, stale, rejected }`. `read` counts every data row or account, `applied` the rows that added or replaced a record, `stale` the valid rows that changed nothing, and `rejected` lists `{ ref, reason }` in input order. Every row lands in exactly one of the three, so `read === applied + stale + rejected.length`.\n\nReturn `ledger` sorted by `id`, comparing UTF-16 code units with `<` and `>`, so `ACC-10` sorts before `ACC-9`.\n\nLoad the two sources in either order, or replay either one, and the ledger comes out the same.\n\nInput bounds: at most 1,000 rows or accounts per call and at most 20 pages; string fields hold at most 200 UTF-16 code units; ordinary data objects with no getters or proxies. Rows from one source that share an id and an `updatedAt` carry the same name and email.\n\nTarget: O(n log n) time, where n is the number of rows read plus the records already in the ledger.\n\nThe CSV export, the API pages and every account in them are fixtures written for this exercise. `client` is an object literal in the task harness. Nothing opens a network connection, and no real customer data appears.',
        contract: [
          'Keep the type names and both signatures. The type assertions call `applyCsv`, `applyApi`, `AccountRecord`, `Applied`, `Rejection`, `Reason` and `AccountsClient` by name.',
          '`parseCsv` comes from the task harness. Keep its `declare function` line, and do not define your own.',
          'Return a new ledger array. Do not push into, sort or change the ledger you were given, or any record in it.',
          'Call `client.listAccounts` once per page. Do not retry a rejection, and merge nothing from a walk that failed.',
          'No imports, no network, no clock and no randomness.',
        ],
        starter: `${ACCOUNT_TYPES}

const applyCsv = (ledger: readonly AccountRecord[], csv: string): Applied => {

};

const applyApi = async (ledger: readonly AccountRecord[], client: AccountsClient): Promise<Applied> => {

};

// Scratch pad: change this before submitting.
const demoCsv = 'account_id,name,email,updated_at\\r\\nACC-0101,Demo export,demo@kestrel.example,2026-03-01 09:00:00';
const fromCsv = applyCsv([], demoCsv);
console.log(JSON.stringify(fromCsv.report));
const demoClient: AccountsClient = {
  listAccounts: cursor => Promise.resolve({
    accounts: cursor === null
      ? [{ accountId: 'acc-0101', displayName: 'Demo CRM', email: 'demo@kestrel.example', modifiedAt: '2026-03-02T09:00:00Z' }]
      : [],
    nextCursor: null,
  }),
};
applyApi(fromCsv.ledger, demoClient).then(out => console.log(JSON.stringify(out.ledger)));
`,
        skeleton: `${ACCOUNT_TYPES}

/* One intermediate row shape for both sources: { ref, id, name, email, updatedAt } */

const toRecord = (/* a raw row, its source */) => {
  /* trim; non-strings count as '' */
  /* id: uppercase, or 'missing-id' */
  /* email: lowercase, exactly one @ with text on both sides and no whitespace, or 'bad-email' */
  /* updatedAt: 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DDTHH:MM:SSZ', stored as the second, or 'bad-timestamp' */
};

const supersedes = (incoming: AccountRecord, current: AccountRecord): boolean => {
  /* a later updatedAt, or the same updatedAt with 'api' over 'csv' */
};

const merge = (ledger: readonly AccountRecord[], rows /* : your row type */, source: Source): Applied => {
  /* copy the ledger into a Map keyed by id; never write into \`ledger\` */
  /* for each row: rejected, applied or stale */
  /* return the Map's values sorted by id, and the report */
};

const applyCsv = (ledger: readonly AccountRecord[], csv: string): Applied => {
  /* parseCsv, find the four columns by header name, number rows csv:1, csv:2, ... */
};

const applyApi = async (ledger: readonly AccountRecord[], client: AccountsClient): Promise<Applied> => {
  /* collect every page first, numbering accounts api:1, api:2, ...; then merge once */
};`,
        hints: [
          'Turn both sources into the same intermediate row, `{ ref, id, name, email, updatedAt }`, then write one merge that both functions call. Validation and the replace rule then live in one place.',
          'Copy the ledger into a `Map` keyed by id at the start of the merge. Writing into the Map leaves the caller’s array alone, and `[...byId.values()].sort(...)` gives you the new ledger.',
          'The replace rule decides whether order matters. The stored timestamp has a fixed width, so compare the strings with `>`, and break a tie with a fixed rank where `api` beats `csv`. An identical replay then compares equal and counts as stale.',
          'In `applyApi`, push every account into an array before you merge. A rejection from `await client.listAccounts(cursor)` then leaves the function before the merge runs, and the caller’s ledger never changes.',
        ],
        approach: [
          'Write `toRecord(row, source)`: trim, check id, email and timestamp in that order, and return either a record or the first rejection reason.',
          'Write `supersedes(incoming, current)`: true for a later `updatedAt`, or for the same `updatedAt` when the incoming source is `api` and the stored one is `csv`.',
          'Write `merge(ledger, rows, source)`: copy the ledger into a Map, count each row as rejected, applied or stale, and return the sorted values with the report.',
          'In `applyCsv`, take the header from `parseCsv`, find the four columns by trimmed lowercase name, and build rows `csv:1`, `csv:2` and on.',
          'In `applyApi`, walk the cursor from `null` to `null`, collect accounts as `api:1`, `api:2` and on, then call the merge once.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'Validated records from both sources',
            critical: true,
            weight: 3,
            detail:
              'A record or a rejection reason is wrong. Check that you find CSV columns by trimmed, lowercased header name, that ids are trimmed and uppercased, that emails are trimmed and lowercased with exactly one @, that both timestamp shapes come out as `YYYY-MM-DDTHH:MM:SSZ`, that the API walk follows `nextCursor` past empty pages, and that the ledger is sorted by id in UTF-16 code-unit order, compared with `<` and `>` rather than `localeCompare`.',
          },
          {
            id: 'accounted',
            label: 'Every row read is applied, stale or rejected with a reason',
            critical: true,
            weight: 2,
            detail:
              'The report does not account for every row. Each data row or account must land in exactly one of `applied`, `stale` or `rejected`, and each rejection needs its `ref` (`csv:N` or `api:N`, counted from 1 in input order) and the first failing reason. A row you skip without recording it is a row the customer never hears about.',
          },
          {
            id: 'replay',
            label: 'Replays in either order land on the same ledger',
            critical: true,
            weight: 2,
            detail:
              'The ledger depends on the order the rows arrived in. A stored record may only be replaced by a newer one: a later `updatedAt`, or the same `updatedAt` from `api` over `csv`. Anything else, an identical replay included, is stale and changes nothing.',
          },
          {
            id: 'atomic',
            label: 'A failed walk or a replay never writes into the ledger it was given',
            critical: true,
            weight: 2,
            detail:
              'The ledger passed in changed, or a failed API walk left part of its pages behind. Copy the ledger before you merge, collect every page before you apply any of them, and let a rejection from `listAccounts` reach the caller without a retry.',
          },
        ],
        tests: [
          {
            call: "applyCsv([], __CSV).ledger",
            expected: [{"id":"ACC-0001","name":"Orchard Row Bakery","email":"billing@orchardrow.example","updatedAt":"2026-03-01T09:00:00Z","source":"csv"},{"id":"ACC-0002","name":"Fenwick, Hale & Co","email":"accounts@fenwickhale.example","updatedAt":"2026-03-01T10:30:00Z","source":"csv"},{"id":"ACC-0004","name":"Quill & Ledger \"Stationers\"","email":"finance@quillledger.example","updatedAt":"2026-03-02T08:15:00Z","source":"csv"}],
            label: "the CSV export yields three validated records, ids normalised and quoted fields read whole",
          },
          {
            call: "applyApi([], __client()).then(__ids)",
            expected: ["ACC-0001","ACC-0002","ACC-0004","ACC-0006","ACC-0007"],
            label: "the API walk covers all three pages",
            async: true,
          },
          {
            call: "applyCsv([], __CSV).report",
            expected: {"source":"csv","read":7,"applied":3,"stale":1,"rejected":[{"ref":"csv:3","reason":"missing-id"},{"ref":"csv:4","reason":"bad-email"},{"ref":"csv:7","reason":"bad-timestamp"}]},
            label: "the CSV report counts all seven rows: three applied, one stale duplicate, three rejected with reasons",
            criterion: "accounted",
          },
          {
            call: "applyApi([], __client()).then(function (r) { return r.report; })",
            expected: {"source":"api","read":8,"applied":5,"stale":1,"rejected":[{"ref":"api:3","reason":"missing-id"},{"ref":"api:8","reason":"bad-email"}]},
            label: "the API report counts all eight accounts, with the blank id and the null email rejected by position",
            async: true,
            criterion: "accounted",
          },
          {
            call: "applyApi([], __client()).then(function (r) { return r.ledger.filter(function (x) { return x.id === 'ACC-0007'; }); })",
            expected: [{"id":"ACC-0007","name":"Wren Street Books","email":"shop@wrenstreet.example","updatedAt":"2026-03-04T10:00:00Z","source":"api"}],
            label: "an older version of ACC-0007 on a later page does not replace the newer one",
            edge: true,
            async: true,
            criterion: "replay",
          },
          {
            call: "(function () { var csvFirst = applyCsv([], __CSV).ledger; return applyApi(csvFirst, __client()).then(function (a) { return applyApi([], __client()).then(function (b) { var apiFirst = applyCsv(b.ledger, __CSV); return { same: JSON.stringify(a.ledger) === JSON.stringify(apiFirst.ledger), ledger: a.ledger }; }); }); })()",
            expected: {"same":true,"ledger":[{"id":"ACC-0001","name":"Orchard Row Bakery","email":"billing@orchardrow.example","updatedAt":"2026-03-01T09:00:00Z","source":"csv"},{"id":"ACC-0002","name":"Fenwick Hale & Co","email":"accounts@fenwickhale.example","updatedAt":"2026-03-03T09:00:00Z","source":"api"},{"id":"ACC-0004","name":"Quill and Ledger","email":"finance@quillledger.example","updatedAt":"2026-03-02T08:15:00Z","source":"api"},{"id":"ACC-0006","name":"Brackenridge Clinic","email":"admin@brackenridge.example","updatedAt":"2026-03-03T12:00:00Z","source":"api"},{"id":"ACC-0007","name":"Wren Street Books","email":"shop@wrenstreet.example","updatedAt":"2026-03-04T10:00:00Z","source":"api"}]},
            label: "CSV then API and API then CSV land on the same five records",
            async: true,
            criterion: "replay",
          },
          {
            call: "(function () { var once = applyCsv([], __CSV); var twice = applyCsv(once.ledger, __CSV); return { same: JSON.stringify(once.ledger) === JSON.stringify(twice.ledger), counts: __counts(twice) }; })()",
            expected: {"same":true,"counts":{"read":7,"applied":0,"stale":4,"rejected":3}},
            label: "replaying the CSV export changes nothing and counts every valid row as stale",
            edge: true,
            criterion: "replay",
          },
          {
            call: "(function () { var ledger = applyCsv([], __CSV).ledger; var before = JSON.stringify(ledger); var c = __makeClient(__PAGES, { failOn: 'c3' }); return applyApi(ledger, c).then(function () { return 'resolved'; }, function (error) { return { status: error && error.status, requests: c.requests, unchanged: JSON.stringify(ledger) === before }; }); })()",
            expected: {"status":503,"requests":[null,"c2","c3"],"unchanged":true},
            label: "a page that fails leaves the ledger as it was and the rejection reaches the caller",
            edge: true,
            async: true,
            criterion: "atomic",
          },
          {
            call: "(function () { var ledger = applyCsv([], __CSV).ledger; var c = __makeClient(__PAGES, { failOn: 'c3' }); return applyApi(ledger, c).then(null, function () { return applyApi(ledger, __client()); }).then(function (retried) { return applyApi(ledger, __client()).then(function (clean) { return JSON.stringify(retried) === JSON.stringify(clean); }); }); })()",
            expected: true,
            label: "a retry after the failed walk gives the same result as a clean run",
            edge: true,
            async: true,
            criterion: "atomic",
          },
        ],
        typeTests: [
          {
            code: "const __applied: Applied = applyCsv([], 'account_id,name,email,updated_at');",
            label: 'applyCsv returns an Applied',
          },
          {
            code: 'const __pending: Promise<Applied> = applyApi([], { listAccounts: () => Promise.resolve({ accounts: [], nextCursor: null }) });',
            label: 'applyApi returns a promise for an Applied',
          },
          {
            code: "declare const __frozenLedger: readonly AccountRecord[]; const __fromFrozen: Applied = applyCsv(__frozenLedger, '');",
            label: 'a readonly ledger is accepted',
          },
          {
            code: 'applyCsv([], 42);',
            label: 'the CSV source is text, not a number',
            rejects: true,
          },
          {
            code: "const __wrongSource: AccountRecord = { id: 'ACC-0001', name: '', email: 'a@x.example', updatedAt: '2026-03-01T09:00:00Z', source: 'sftp' };",
            label: 'a record comes from csv or api, nowhere else',
            rejects: true,
          },
        ],
        harness: ACCOUNT_SOURCES,
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m05-data-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m05-data-reconcile', state: 'verified_pass' },
  ],
};
