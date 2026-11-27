/** M04: Enterprise boundaries and identity (M04 once B9 renumbers the path).
 *
 * The module between the connector and everything that reads from it or
 * writes into it. M02 taught the sync to survive a messy feed; this one
 * decides who may see what came back, how a customer's systems vouch for a
 * user or a connection, and what gets recorded when they do. Two lessons, one
 * ten-question check, one graded webhook receiver in TypeScript.
 *
 * Lesson 1 keeps the tenant rule: the tenant comes from verified context,
 * never from arguments. Nine of the fifteen postings in the plan's research
 * (docs/learn-sections-fde-flagship-plan.md, section 3) ask for enterprise
 * integration: REST, webhooks, OAuth, SSO/SAML, legacy SQL and SOAP,
 * migrations. Lesson 2 covers the identity and webhook part of that: the
 * OAuth authorization code flow with PKCE and token handling, SAML assertion
 * and OIDC ID token checks, signed webhooks with replay protection, the audit
 * entry, and the retention and deletion of every copy the integration makes.
 *
 * The receiver has four security criteria, each critical: a forged signature,
 * a replayed delivery, a payload that reaches into another tenant, and a grant
 * that expired or was revoked. A correct record shape cannot average any of
 * them away.
 *
 * Marlbrook Systems, its two tenants (Dunfold Freight and Kestrel Foods),
 * their connections, secrets, tickets and grants are fixtures written for
 * this module. The ticketing provider, the identity providers and their
 * deliveries are object literals in the task harness. There is no live
 * identity provider, no model, no vendor account and no network call anywhere
 * in it, and no real customer data appears in it. */

import type { ModuleSource } from '../../types';

/** The two-tenant ticket store, the two connections and the delivery builder
 * the assertions run against. Appended after the learner's code, so none of it
 * can be shadowed by a same-named declaration.
 *
 * `__hmacSha256` is a plain-JavaScript HMAC-SHA256 (RFC 2104 over FIPS 180-4
 * SHA-256, base64 output), because the sandbox has no crypto module. It was
 * checked against Node's `crypto.createHmac` on empty, multi-block, long-key
 * and non-ASCII input when this module was written.
 *
 * `__world` hands the learner a `ctx` and keeps the probes (`reads`, `writes`,
 * `claims`, `audit`) on an object the learner's code never sees, so a
 * submission cannot fake the evidence the grade reads. Two options change
 * what `ctx.safeEqual` answers, so the grade can tell a comparison that goes
 * through it from one that only calls it: `safeEqual: 'never'` makes it refuse
 * every pair, and `acceptPair: [a, b]` makes it accept that one pair (in
 * either order) although the two strings differ. */
const WEBHOOK_WORLD = `
var __K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

var __utf8 = function (text) {
  var out = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      var low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
};

var __sha256 = function (bytes) {
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var data = bytes.slice();
  var bitLength = bytes.length * 8;
  data.push(0x80);
  while (data.length % 64 !== 56) data.push(0);
  for (var shift = 7; shift >= 0; shift--) data.push(shift >= 4 ? 0 : (bitLength >>> (shift * 8)) & 255);
  var w = new Array(64);
  for (var block = 0; block < data.length; block += 64) {
    for (var t = 0; t < 16; t++) {
      var at = block + t * 4;
      w[t] = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
    }
    for (var u = 16; u < 64; u++) {
      var x = w[u - 15];
      var y = w[u - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[u] = (w[u - 16] + s0 + w[u - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (var r = 0; r < 64; r++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (k + S1 + ch + __K[r] + w[r]) >>> 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + k) >>> 0;
  }
  var digest = [];
  for (var i = 0; i < 8; i++) digest.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255);
  return digest;
};

var __B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

var __base64 = function (bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += __B64.charAt((n >> 18) & 63) + __B64.charAt((n >> 12) & 63);
    out += i + 1 < bytes.length ? __B64.charAt((n >> 6) & 63) : '=';
    out += i + 2 < bytes.length ? __B64.charAt(n & 63) : '=';
  }
  return out;
};

var __hmacSha256 = function (secret, content) {
  var key = __utf8(secret);
  if (key.length > 64) key = __sha256(key);
  while (key.length < 64) key.push(0);
  var inner = [];
  var outer = [];
  for (var i = 0; i < 64; i++) {
    inner.push(key[i] ^ 0x36);
    outer.push(key[i] ^ 0x5c);
  }
  return __base64(__sha256(outer.concat(__sha256(inner.concat(__utf8(content))))));
};

var __NOW = '2026-04-02T09:00:00Z';
var __NOW_SECONDS = Date.parse(__NOW) / 1000;

var __CONNECTIONS = {
  'CON-DUN': { tenantId: 'TEN-4021', secret: 'whsec-fixture-dunfold-6f1c', grantId: 'GRT-91' },
  'CON-KES': { tenantId: 'TEN-7788', secret: 'whsec-fixture-kestrel-29ab', grantId: 'GRT-92' }
};

var __TICKETS = [
  { id: 'TCK-1001', tenantId: 'TEN-4021', status: 'open' },
  { id: 'TCK-1002', tenantId: 'TEN-4021', status: 'pending' },
  { id: 'TCK-2001', tenantId: 'TEN-7788', status: 'open' }
];

var __clone = function (value) { return JSON.parse(JSON.stringify(value)); };
var __has = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };

var __event = function (patch) {
  var event = { type: 'ticket.status_changed', ticketId: 'TCK-1001', tenantId: 'TEN-4021', status: 'solved' };
  if (patch) {
    for (var key in patch) {
      if (__has(patch, key)) {
        if (patch[key] === undefined) delete event[key];
        else event[key] = patch[key];
      }
    }
  }
  return event;
};

var __deliver = function (options) {
  var o = options || {};
  var connectionId = __has(o, 'connectionId') ? o.connectionId : 'CON-DUN';
  var id = __has(o, 'id') ? o.id : 'msg_2Lk9';
  var timestamp = __has(o, 'timestamp') ? o.timestamp : String(__NOW_SECONDS - (__has(o, 'age') ? o.age : 40));
  var body = __has(o, 'rawBody') ? o.rawBody : JSON.stringify(__event(o.event));
  var known = __has(__CONNECTIONS, connectionId) ? __CONNECTIONS[connectionId].secret : 'whsec-fixture-unknown';
  var secret = __has(o, 'secret') ? o.secret : known;
  var signature = __has(o, 'signature') ? o.signature : 'v1,' + __hmacSha256(secret, id + '.' + timestamp + '.' + body);
  if (o.extraSignatures) signature = o.extraSignatures.concat([signature]).join(' ');
  var headers = { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature };
  (o.omit || []).forEach(function (name) { delete headers[name]; });
  return { connectionId: connectionId, headers: headers, body: __has(o, 'bodyAfterSigning') ? o.bodyAfterSigning : body };
};

var __world = function (options) {
  var o = options || {};
  var tickets = __TICKETS.map(__clone);
  var claimed = {};
  var world = { reads: [], writes: [], claims: [], audit: [], ctx: null };
  world.ctx = {
    now: __NOW,
    getConnection: function (id) {
      if (!__has(__CONNECTIONS, id)) return null;
      var base = __CONNECTIONS[id];
      var grant = { id: base.grantId, expiresAt: '2026-04-02T17:00:00Z', revokedAt: null };
      if (id === 'CON-DUN' && o.grant) {
        for (var key in o.grant) if (__has(o.grant, key)) grant[key] = o.grant[key];
      }
      return { tenantId: base.tenantId, secret: base.secret, grant: grant };
    },
    sign: function (secret, content) { return __hmacSha256(String(secret), String(content)); },
    safeEqual: function (left, right) {
      var a = String(left);
      var b = String(right);
      if (o.safeEqual === 'never') return false;
      if (o.acceptPair && ((a === o.acceptPair[0] && b === o.acceptPair[1]) || (a === o.acceptPair[1] && b === o.acceptPair[0]))) return true;
      var diff = a.length ^ b.length;
      var length = Math.max(a.length, b.length);
      for (var i = 0; i < length; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
      return diff === 0;
    },
    claim: function (key) {
      var name = String(key);
      world.claims.push(name);
      if (__has(claimed, name)) return false;
      claimed[name] = true;
      return true;
    },
    findTicket: function (tenantId, ticketId) {
      world.reads.push(String(tenantId) + ':' + String(ticketId));
      var found = tickets.filter(function (one) { return one.tenantId === tenantId && one.id === ticketId; })[0];
      return found ? __clone(found) : null;
    },
    updateStatus: function (tenantId, ticketId, status) {
      world.writes.push(String(tenantId) + ':' + String(ticketId) + ':' + String(status));
    },
    audit: function (entry) { world.audit.push(__clone(entry)); }
  };
  return world;
};
`.trim();

export const FDE_M04: ModuleSource = {
  id: 'fde-v1-m04',
  title: 'Enterprise boundaries and identity',
  outcomes: [
    'Separate who the caller is from who they are acting for, and take the tenant from the verified session or connection rather than from anything the caller, the payload or the model wrote.',
    'Scope the query instead of filtering the result, and say what a post-fetch filter has already exposed by the time it runs.',
    'Connect to a customer system with the OAuth authorization code flow and PKCE, and hold the tokens it returns so they stay scoped, server-side and out of logs.',
    'Check a SAML assertion or an OIDC ID token for issuer, audience, time window, request binding and reuse before it starts a session.',
    'Verify a signed webhook against its raw body, refuse replays and stale timestamps, check the grant at the point of use, and record every decision in an audit entry.',
    'List every copy an integration makes of a customer record, and say how long each one stays and what deletion does to it.',
  ],
  competencies: ['boundaries'],
  dependsOn: ['fde-v1-m03'],
  estimatedMinutes: 140,
  lessons: [
    {
      id: 'fde-v1-m03-l1',
      title: 'Identity and tenant access',
      summary:
        'The three identities in one request, why the tenant has to come from the verified session, and why a filter applied after the fetch is not a boundary.',
      estimatedMinutes: 25,
      sources: [
        { label: 'RFC 9110, HTTP Semantics', url: 'https://www.rfc-editor.org/rfc/rfc9110', reviewedOn: '2026-10-21' },
        {
          label: 'MDN, HTTP response status codes',
          url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Model Context Protocol specification',
          url: 'https://modelcontextprotocol.io/specification',
          reviewedOn: '2026-10-21',
        },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'This workbench asks who is calling and which tenant/action that caller is currently allowed to access. Verify the request context and current authorization; successful sign-in alone does not prove every later action is allowed.',
        },
        {
          kind: 'prose',
          body:
            'Authentication answers the first question: the server checked a credential and knows it is talking to user USR-31. Authorization answers a narrower one: may this caller do this action, to this record, right now. A system that gets the first right and treats the second as a formality is the system that shows Dunfold Freight an order belonging to Kestrel Foods.',
        },
        {
          kind: 'table',
          caption: 'Four things a single tool call carries that all look like identity, and only one of which decides the tenant.',
          headers: ['What it is', 'Where it comes from', 'What it is allowed to decide'],
          rows: [
            [
              'The principal',
              'Trusted caller context verified for the current request',
              'Which grants apply, and whose name goes in the audit entry',
            ],
            [
              'The tenant',
              'The currently authorized active tenant; this workbench fixes it for the call',
              'Which customer’s rows the query is allowed to touch',
            ],
            [
              'The service identity',
              'The database credential the process itself holds',
              'Only the access its database role actually holds; it does not establish the caller’s tenant permission',
            ],
            [
              'The tool arguments',
              'The model, from text it read a moment ago',
              'Filters inside the tenant the session already fixed, and nothing wider',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'A privileged service can become a confused deputy if it uses its own database access on behalf of an unauthorized caller. Service credentials need least privilege; they need not have access to every tenant. Tool arguments may be influenced by a model, user or external content. The server must resolve authority from trusted context. This workbench ignores proposed tenant selectors; another API may accept a selector only after explicit membership and permission checks.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            '// Unsafe with an unrestricted store: the caller selects a tenant without authorization.\nconst unsafeReadOrders = (session, args) =>\n  store.queryOrders(args.tenantId, { status: args.status });\n\n// This workbench uses its trusted, currently authorized active tenant.\nconst scopedReadOrders = (session, args) =>\n  store.queryOrders(session.tenantId, { status: args.status });',
          caption: 'The comparison assumes an unrestricted store and a preverified active-tenant context. The scoped version still needs grant enforcement and an actual store access policy.',
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Tool arguments, retrieved documents and model output do not grant authority. Enforce the chosen authorization policy outside the model on every relevant request/effect. Prompt instructions and structured framing may reduce risk, but they do not replace server permission checks. Identity claims and data access must follow the actual trusted path.',
        },
        {
          kind: 'prose',
          body:
            'This workbench requires the storage query itself to be tenant-scoped. Fetching every tenant into the application and filtering afterwards violates that policy even if the final result happens to be correct. Other trusted aggregation services may have different permissions and policies; do not infer an external leak solely because broad data was fetched.',
        },
        {
          kind: 'code',
          language: 'javascript',
          code:
            '// Broad fetch: all tenants enter the application, against this workbench policy.\nconst allRows = store.scanAll();\nlogger.info(\'orders fetched\', { count: allRows.length });\nconst filteredRows = allRows.filter(row => row.tenantId === session.tenantId);\n\n// Scoped fetch: the store must actually enforce the supplied tenant boundary.\nconst scopedRows = store.queryOrders(session.tenantId, {});',
          caption: 'Broad and scoped reads have different data exposure. A scoped method name alone proves no access policy; inspect its implementation, role and storage enforcement.',
        },
        {
          kind: 'prose',
          body:
            'A broad fetch places more tenants’ data in the process and increases the consequences of a logging, caching, exception-reporting or filtering mistake. A log containing an all-tenant count exposes that aggregate to its readers, not necessarily the underlying rows. An exception includes row payloads only if the reporting configuration attaches them. Evaluate actual data flows and permissions rather than claiming every broad fetch already leaked all records.',
        },
        {
          kind: 'trace',
          caption:
            'One tool call whose arguments ask for the wrong tenant, stepped through the wrapper. The webhook receiver in this module’s exercise resolves its tenant the same way.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Verify session', 'Read arguments', 'Resolve tenant', 'Check grant', 'Query store', 'Return'],
                note: 'The assistant proposes one call: orders.read, with arguments { status: "open", tenantId: "TEN-7788" }. Nothing has been decided yet.',
              },
              {
                cells: ['Verify session', 'Read arguments', 'Resolve tenant', 'Check grant', 'Query store', 'Return'],
                marks: [{ index: 0, role: 'active' }],
                note: 'The server verifies this request context: user USR-31 and currently authorized active tenant TEN-4021, Dunfold Freight. These values do not come from the model-proposed request body.',
              },
              {
                cells: ['Verify session', 'Read arguments', 'Resolve tenant', 'Check grant', 'Query store', 'Return'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'active' },
                ],
                note: 'The wrapper reads the arguments. `status` is a filter the model is allowed to choose. `tenantId` is dropped here and never read again.',
              },
              {
                cells: ['Verify session', 'Read arguments', 'Resolve tenant', 'Check grant', 'Query store', 'Return'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'excluded' },
                  { index: 2, role: 'active' },
                ],
                note: 'The tenant is TEN-4021, taken from the session. The argument asking for TEN-7788 changed nothing, and the call that carried it returns exactly what the same call without it returns.',
              },
              {
                cells: ['Verify session', 'Read arguments', 'Resolve tenant', 'Check grant', 'Query store', 'Return'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'excluded' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'active' },
                ],
                note: 'Under this fixture policy, a matching unrevoked orders.read grant expires at 17:00 and the trusted request time is 09:00, so it permits the read. A TEN-7788 grant does not authorize TEN-4021.',
              },
              {
                cells: ['Verify session', 'Read arguments', 'Resolve tenant', 'Check grant', 'Query store', 'Return'],
                marks: [
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'active' },
                ],
                note: 'The store is asked for TEN-4021 open orders. With the stipulated scoped store, Kestrel’s rows do not enter this result; the wrapper does not need a post-fetch tenant filter.',
              },
              {
                cells: ['Verify session', 'Read arguments', 'Resolve tenant', 'Check grant', 'Query store', 'Return'],
                marks: [
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'settled' },
                  { index: 5, role: 'active' },
                ],
                note: 'Two orders come back. The wrapper returns the id, tenant, status and total, and drops the customer name nobody asked for.',
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'Use application scoping and appropriate storage enforcement, such as correctly configured row-level security or a restricted per-tenant credential. Check which role the query actually uses and whether it bypasses those rules. Defense in depth can contain some wrapper bugs; two checks are not an unconditional guarantee against a breach, especially if they share a flawed authority source.',
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'RFC 9110 distinguishes missing/invalid authentication credentials (401) from a request the server understands but refuses (403), and permits 404 to conceal a forbidden resource. This workbench can use a consistent public refusal for inaccessible and nonexistent records to reduce enumeration. That is a chosen disclosure policy, not a universal requirement; timing, metadata and other responses also need review. Keep precise internal reasons without exposing sensitive details.',
        },
        {
          kind: 'prose',
          body:
            'Write the rule down where the next engineer will meet it. One sentence at the top of the wrapper says that the tenant comes from the session and that arguments may only narrow within it. That sentence costs less than the review meeting after the first cross-tenant read. The exercise at the end of this module applies the same rule to a webhook: the tenant comes from the connection whose secret verified the signature, and the payload may only agree with it.',
        },
      ],
    },
    {
      id: 'fde-v1-m03-l2',
      title: 'Delegated access, SSO, webhooks and audit',
      summary:
        'How a customer’s systems vouch for a user and for a connection: the OAuth authorization code flow with PKCE, the checks a SAML assertion or an OIDC ID token must pass, a signed webhook with a replay store, the audit entry behind every decision, and what deletion has to reach.',
      estimatedMinutes: 40,
      sources: [
        {
          label: 'IETF draft-ietf-oauth-v2-1, The OAuth 2.1 Authorization Framework (draft 16, work in progress)',
          url: 'https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/',
          reviewedOn: '2026-10-21',
        },
        { label: 'RFC 6749, The OAuth 2.0 Authorization Framework', url: 'https://www.rfc-editor.org/rfc/rfc6749', reviewedOn: '2026-10-21' },
        { label: 'RFC 9700, Best Current Practice for OAuth 2.0 Security', url: 'https://www.rfc-editor.org/rfc/rfc9700', reviewedOn: '2026-10-21' },
        { label: 'RFC 7636, Proof Key for Code Exchange by OAuth Public Clients', url: 'https://www.rfc-editor.org/rfc/rfc7636', reviewedOn: '2026-10-21' },
        {
          label: 'OASIS, Assertions and Protocols for SAML V2.0 (SAML Core)',
          url: 'https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'OASIS, Profiles for SAML V2.0 (SAML Profiles), section 4.1, Web Browser SSO Profile',
          url: 'https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf',
          reviewedOn: '2026-10-21',
        },
        { label: 'OpenID Connect Core 1.0, ID Token Validation', url: 'https://openid.net/specs/openid-connect-core-1_0.html', reviewedOn: '2026-10-21' },
        {
          label: 'OWASP SAML Security Cheat Sheet',
          url: 'https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html',
          reviewedOn: '2026-10-21',
        },
        {
          label: 'Standard Webhooks specification, version 1.0.0',
          url: 'https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md',
          reviewedOn: '2026-10-21',
        },
        { label: 'OWASP Logging Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html', reviewedOn: '2026-10-21' },
      ],
      sections: [
        {
          kind: 'prose',
          body:
            'Dunfold’s security reviewer sends four questions before the pilot starts. How do our people sign in to your tool? How does your tool reach our ticketing system? How does our ticketing system reach you? What do you record and keep when any of that happens? Each question has a protocol behind it and a short list of checks that you either run or skip. This lesson goes through those checks in that order.',
        },
        {
          kind: 'prose',
          body:
            'Start with the second question, because it comes up first in the build. Marlbrook’s connector needs to read and update Dunfold’s tickets in the ticketing system Dunfold already runs. Dunfold’s admin should approve that once, for two named actions, without typing her password into Marlbrook. The OAuth authorization code grant covers this case: she approves at the authorization server she already trusts, and Marlbrook receives tokens limited to what she approved.',
        },
        {
          kind: 'trace',
          caption:
            'The authorization code flow with PKCE, one step at a time. Read each note for the value that step checks.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Create verifier', 'Redirect', 'Admin approves', 'Code returns', 'Exchange', 'Call the API'],
                note: 'Dunfold’s admin clicks Connect in Marlbrook’s settings. Marlbrook wants the scopes tickets.read and tickets.write, and it has sent nothing yet.',
              },
              {
                cells: ['Create verifier', 'Redirect', 'Admin approves', 'Code returns', 'Exchange', 'Call the API'],
                marks: [{ index: 0, role: 'active' }],
                note: 'Marlbrook’s server generates a random code_verifier and a one-time state value and keeps both with the admin’s session. It sends only code_challenge, the base64url SHA-256 of the verifier, with method S256.',
              },
              {
                cells: ['Create verifier', 'Redirect', 'Admin approves', 'Code returns', 'Exchange', 'Call the API'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'active' },
                ],
                note: 'The browser goes to the authorization server with client_id, redirect_uri, scope, state and code_challenge. The authorization server compares redirect_uri with the registered value by exact string match.',
              },
              {
                cells: ['Create verifier', 'Redirect', 'Admin approves', 'Code returns', 'Exchange', 'Call the API'],
                marks: [
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'active' },
                ],
                note: 'The admin signs in at her own provider and approves the two scopes. Marlbrook never sees her password.',
              },
              {
                cells: ['Create verifier', 'Redirect', 'Admin approves', 'Code returns', 'Exchange', 'Call the API'],
                marks: [
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'active' },
                ],
                note: 'The browser returns to the redirect URI with a short-lived, single-use code and the same state. Marlbrook drops the callback when state differs from the value it stored for this session.',
              },
              {
                cells: ['Create verifier', 'Redirect', 'Admin approves', 'Code returns', 'Exchange', 'Call the API'],
                marks: [
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'active' },
                ],
                note: 'Marlbrook’s server posts the code and the original code_verifier to the token endpoint. Someone who intercepted the code alone cannot redeem it, because they never held the verifier.',
              },
              {
                cells: ['Create verifier', 'Redirect', 'Admin approves', 'Code returns', 'Exchange', 'Call the API'],
                marks: [
                  { index: 4, role: 'settled' },
                  { index: 5, role: 'active' },
                ],
                note: 'The response carries an access token and a refresh token. Marlbrook stores both against Dunfold’s connection and calls the ticket API with the access token in the Authorization header.',
              },
            ],
          },
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'The OAuth 2.1 draft leaves out the implicit grant and the resource owner password grant, requires PKCE for the authorization code grant unless narrow conditions hold, and requires exact redirect URI matching. You do not need to wait for it. RFC 9700, the current security best practice for OAuth 2.0, already says clients must not use the password grant, should not use the implicit grant, and must use PKCE when they are public clients. If a customer’s provider offers you only the password grant, raise it as a finding in the security review.',
        },
        {
          kind: 'table',
          caption: 'Four credentials a connector holds, what each one proves, and how to keep it.',
          headers: ['Credential', 'What it proves', 'How to hold it'],
          rows: [
            [
              'Authorization code',
              'The admin approved this request a moment ago',
              'Redeem it once, with the PKCE verifier. RFC 6749 recommends a lifetime of ten minutes at most',
            ],
            [
              'Access token',
              'Its holder may call these APIs, with these scopes, until it expires',
              'Send it in the Authorization header and never in a URL query; keep it out of logs and error reports',
            ],
            [
              'Refresh token',
              'Marlbrook may ask for new access tokens without the admin present',
              'Store it server-side against the tenant’s connection, encrypted at rest; when the server rotates it, keep only the new one',
            ],
            [
              'Client secret',
              'The request comes from Marlbrook’s registered client',
              'Keep it in the secret store of the service that calls the token endpoint; it never reaches a browser',
            ],
          ],
        },
        {
          kind: 'prose',
          body:
            'Ask for the scopes the pilot needs and stop there. RFC 9700 recommends restricting an access token to the minimum privileges the use case requires, and to the one resource server it is meant for. A connector token that can also delete users turns a parsing bug in your sync into a security incident at the customer.',
        },
        {
          kind: 'prose',
          body:
            'Sign-in runs the other way. Dunfold’s people already sign in through Dunfold’s identity provider, and their security team wants your tool behind it. Two protocols carry that sign-in. SAML 2.0 posts a signed XML assertion to your assertion consumer service (ACS). OpenID Connect returns a signed ID token at the end of an OAuth-style flow. Both hand you a statement that the provider authenticated a person. Before you start a session on that statement, check that it was meant for you, that it is current, and that it answers a login you started.',
        },
        {
          kind: 'table',
          caption:
            'The checks a SAML assertion or an OIDC ID token passes before it starts a session. Skip a row and a token issued for another application, or an old one, gets in.',
          headers: ['Check', 'SAML 2.0 assertion', 'OIDC ID token'],
          rows: [
            [
              'Signature, with a key you configured',
              'XML signature over the assertion or the response, verified with the certificate in your configuration for this provider, not a key the document carries',
              'JWS signature verified with the issuer’s keys and the algorithm you expect',
            ],
            ['Issuer', '`Issuer` names the provider you configured for this tenant', '`iss` exactly matches the issuer you configured'],
            [
              'Meant for you',
              '`Audience` matches your entity ID; `Destination` and `Recipient` match your ACS URL',
              '`aud` contains your `client_id`',
            ],
            ['Current', '`NotBefore` and `NotOnOrAfter` hold at the current time', '`exp` lies in the future; `iat` falls inside the window you accept'],
            ['Answers your login', '`InResponseTo` matches a request you sent', '`nonce` matches the value you sent with the request'],
            ['Used once', 'Keep the IDs of used assertions until their `NotOnOrAfter` passes and refuse a repeat', 'Keep accepted nonces and refuse a repeat'],
          ],
        },
        {
          kind: 'prose',
          body:
            'The SAML column comes from two OASIS documents. SAML Core defines the audience and time conditions, and it requires a recipient to check `Destination` against the address where the message arrived. The SAML Profiles document, in its web browser SSO profile, requires the service provider to check `Recipient` and `InResponseTo`, and to keep the IDs of used bearer assertions until their `NotOnOrAfter` passes so that none is accepted twice. The OWASP SAML Security Cheat Sheet repeats these checks for a service provider and asks for replay detection at the response or assertion level.',
        },
        {
          kind: 'prose',
          body:
            'Decide the tenant from the provider connection that verified the assertion, never from an attribute inside it. An email address ending in @dunfold.example tells you what a provider asserted about a person. When Kestrel’s provider asserts that address, Kestrel’s provider is still the one talking. Map each configured issuer to exactly one tenant, and refuse an assertion whose verified issuer has no mapping.',
        },
        {
          kind: 'prose',
          body:
            'The third question covers traffic the customer’s systems start. Dunfold’s ticketing system calls Marlbrook each time a ticket changes status. Anyone who learns the endpoint URL can call it too, so the receiver needs proof that the provider sent this exact body, for this connection, recently, and once. The Standard Webhooks specification describes one common shape for that proof: three headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`) and an HMAC-SHA256 signature over the id, the timestamp and the body joined by full stops.',
        },
        {
          kind: 'code',
          language: 'typescript',
          code:
            "import { createHmac, timingSafeEqual } from 'node:crypto';\n\n// Verify against the raw body string, exactly as it arrived.\nfunction verifyDelivery(secret: string, headers: Headers, rawBody: string): boolean {\n  const id = headers.get('webhook-id');\n  const timestamp = headers.get('webhook-timestamp');\n  const signatures = headers.get('webhook-signature');\n  if (!id || !timestamp || !signatures) return false;\n  const mac = createHmac('sha256', secret).update(`${id}.${timestamp}.${rawBody}`).digest('base64');\n  const expected = Buffer.from(`v1,${mac}`);\n  return signatures.split(' ').some((entry) => {\n    const given = Buffer.from(entry);\n    return given.length === expected.length && timingSafeEqual(given, expected);\n  });\n}",
          caption:
            'A Node sketch for reading, not the exercise’s code. It leaves out how your provider encodes the secret, which you take from its documentation. The exercise hands you `ctx.sign` and `ctx.safeEqual` instead, because its sandbox has no crypto module.',
        },
        {
          kind: 'table',
          caption: 'What each part of the receiver’s check stops, and what it leaves to the next part.',
          headers: ['Check', 'What it stops', 'What it leaves open'],
          rows: [
            [
              'HMAC over id, timestamp and raw body',
              'A forged or edited delivery from anyone without the connection’s secret',
              'A genuine delivery that someone captured and sends again',
            ],
            [
              'Constant-time comparison',
              'Guessing a valid signature one character at a time from response timing',
              'Freshness and reuse; it only compares two strings',
            ],
            [
              'Timestamp tolerance (300 seconds in the exercise)',
              'A delivery captured last week and replayed today',
              'A replay inside the window',
            ],
            [
              'Replay store keyed by connection and `webhook-id`',
              'The same delivery processed twice inside the window, whether an attacker or the provider’s own retry sent it',
              'A replay after its key expired while the timestamp still passes. Keep each key until its signed timestamp plus the tolerance has passed: with 300 seconds either way, that can be 600 seconds after arrival',
            ],
          ],
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Verify the body as it arrived. A framework that parses JSON before your handler runs and gives you a re-serialized string can change spacing or key order, and the signature stops matching. The Standard Webhooks specification warns about this case. Read the raw body, verify it, then parse it.',
        },
        {
          kind: 'trace',
          caption:
            'One delivery stepped through the receiver you repair in the exercise. Watch which value decides the tenant.',
          trace: {
            shape: 'array',
            frames: [
              {
                cells: ['Connection', 'Signature', 'Timestamp', 'Grant', 'Payload', 'Tenant', 'Replay', 'Write'],
                note: 'A POST arrives at /hooks/CON-DUN with webhook-id msg_7Qd2, a timestamp 40 seconds old and one v1 signature. The body says ticket TCK-2001 moved to solved, for tenant TEN-7788.',
              },
              {
                cells: ['Connection', 'Signature', 'Timestamp', 'Grant', 'Payload', 'Tenant', 'Replay', 'Write'],
                marks: [{ index: 0, role: 'active' }],
                note: 'CON-DUN is Dunfold Freight’s connection: tenant TEN-4021, its own signing secret, and the grant Dunfold’s admin approved.',
              },
              {
                cells: ['Connection', 'Signature', 'Timestamp', 'Grant', 'Payload', 'Tenant', 'Replay', 'Write'],
                marks: [
                  { index: 0, role: 'settled' },
                  { index: 1, role: 'active' },
                ],
                note: 'The receiver signs msg_7Qd2, the timestamp and the raw body with Dunfold’s secret and compares in constant time. It matches, so a holder of Dunfold’s secret sent this body.',
              },
              {
                cells: ['Connection', 'Signature', 'Timestamp', 'Grant', 'Payload', 'Tenant', 'Replay', 'Write'],
                marks: [
                  { index: 1, role: 'settled' },
                  { index: 2, role: 'settled' },
                  { index: 3, role: 'active' },
                ],
                note: 'Forty seconds sits inside the 300-second tolerance. The grant expires at 17:00 and nobody revoked it, so at 09:00 it holds.',
              },
              {
                cells: ['Connection', 'Signature', 'Timestamp', 'Grant', 'Payload', 'Tenant', 'Replay', 'Write'],
                marks: [
                  { index: 3, role: 'settled' },
                  { index: 4, role: 'settled' },
                  { index: 5, role: 'excluded' },
                ],
                note: 'The payload parses and names TEN-7788, Kestrel Foods. A routing mistake at the provider or a leaked secret could produce this. Dunfold’s signature does not let Dunfold’s connection touch Kestrel’s records, so the receiver refuses with tenant_mismatch before it looks the ticket up.',
              },
              {
                cells: ['Connection', 'Signature', 'Timestamp', 'Grant', 'Payload', 'Tenant', 'Replay', 'Write'],
                marks: [
                  { index: 5, role: 'excluded' },
                  { index: 6, role: 'excluded' },
                  { index: 7, role: 'excluded' },
                ],
                note: 'The receiver claims no webhook-id and writes nothing. The audit log gains one refuse entry naming CON-DUN, TEN-4021 and the reason.',
              },
            ],
          },
        },
        {
          kind: 'prose',
          body:
            'The fourth question asks what you record. Every decision in this lesson produces an audit entry: a token exchanged, a session started, a delivery accepted or refused. The OWASP Logging Cheat Sheet groups what an entry needs as when, where, who and what, and lists authentication failures and access control failures among the events to record.',
        },
        {
          kind: 'code',
          language: 'json',
          code:
            '{\n  "at": "2026-04-02T09:00:00Z",\n  "requestId": "req-5b81c0",\n  "actor": { "type": "connection", "id": "CON-DUN" },\n  "onBehalfOfTenant": "TEN-4021",\n  "action": "webhook.ticket_status",\n  "webhookId": "msg_7Qd2",\n  "targetIds": ["TCK-2001"],\n  "decision": "refuse",\n  "reason": "tenant_mismatch",\n  "grantId": "GRT-91",\n  "policyVersion": 4\n}',
          caption:
            'A hypothetical entry for the refused delivery above. It names the delivery and the ticket by id and leaves out the body, the signature and the secret.',
        },
        {
          kind: 'table',
          caption: 'Each field of that entry, and the question a reviewer cannot answer without it.',
          headers: ['Field', 'What it answers', 'What its absence costs'],
          rows: [
            ['`actor`', 'Which person, service or connection acted', 'Every entry reads “the integration did it”, and you cannot tell one customer’s connection from another'],
            ['`onBehalfOfTenant`', 'Whose data the action touched', 'You cannot tell a normal update from a cross-tenant one'],
            ['`action`, `webhookId` and `targetIds`', 'What happened, to which records, from which delivery', 'You know something happened and not what'],
            ['`decision` and `reason`', 'Accepted or refused, and on what ground', 'Refusals vanish, so forty forged deliveries look like a quiet afternoon'],
            ['`grantId`, `policyVersion`', 'Which permission and which rules applied', 'An id helps only while you keep the grant and policy history it points to'],
            ['`at` in UTC, `requestId`', 'When, and which request', 'You cannot line the entry up with the trace beside it'],
          ],
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Log ids, not secrets or bodies. The OWASP Logging Cheat Sheet lists access tokens, session identifiers and passwords among the data you remove, mask or hash before you write a log entry. An audit entry that copies a token or a payload makes one more copy of it, with its own retention period and its own readers.',
        },
        {
          kind: 'prose',
          body:
            'The fourth question has a second half: what do you keep, and for how long? One day Dunfold’s legal team will ask Marlbrook to delete a ticket, or everything from the pilot. Before the pilot starts, list every copy the integration makes and give each one a retention period, an owner and a deletion step. Identifiers count too: an id-only record still needs access and retention rules.',
        },
        {
          kind: 'table',
          caption: 'Where one Dunfold ticket ends up once the connector syncs it, and what deletion has to do about each copy.',
          headers: ['Copy', 'Who made it', 'What deletion has to do'],
          rows: [
            ['The synced row', 'The connector, on first sync', 'Remove it, and say whether removal means the row is gone or only hidden'],
            ['A response cache', 'Marlbrook’s own read path', 'Evict the key, or the ticket keeps answering until the cache entry expires'],
            ['A derived index', 'A search or embedding job that ran later', 'Delete the derived rows too; they hold the ticket in another shape'],
            ['Logs and error reports', 'A handler that logged or attached the payload', 'Apply the log retention period, scrub what deletion requires, and log ids instead of bodies from then on'],
            ['Backups', 'The scheduled snapshot', 'State how long backups live, who can read them, and how a restore reapplies earlier deletions'],
            ['Audit entries', 'The receiver, on every decision', 'Keep them for the period the audit policy sets; they hold ids, which is why they must not hold bodies'],
          ],
        },
        {
          kind: 'callout',
          tone: 'warning',
          body:
            'Promise only the deletion you can show. Setting `deletedAt` hides a row and leaves it in the table. Removing the row leaves the cache, the index, the logs and last night’s backup as they were. Tell the customer what stays, who can read it and for how long.',
        },
        {
          kind: 'prose',
          body:
            'The `grantId` in that entry points at the customer’s approval for this connection, and an approval ends in two ways. Expiry is a time condition: compare the trusted current time with `expiresAt`, and at the expiry instant the grant has already ended. Revocation is an event: the customer’s admin withdrew approval before the expiry, and your check sees it only when it reads the current grant. Check both at the point of use, before each write, so the first delivery after a revocation gets refused.',
        },
        {
          kind: 'table',
          caption: 'Four grant states under the exercise’s point-of-use policy. Any caching delay you allow needs its own definition and test.',
          headers: ['State', 'What the receiver does', 'What the entry records'],
          rows: [
            ['Valid', 'Applies the update inside the connection’s tenant', '`accept`, with the grant id and the policy version'],
            ['Expired', 'Refuses before it reads or writes a ticket', '`refuse`, reason `grant_expired`, with the expiry time'],
            ['Revoked', 'Refuses once its check reads the revocation', '`refuse`, reason `grant_revoked`, with who revoked it and when'],
            ['Revoked and expired', 'Refuses and reports the revocation, the decision a person made', '`refuse`, reason `grant_revoked`'],
          ],
        },
        {
          kind: 'callout',
          tone: 'note',
          body:
            'Every delivery, secret, assertion, token, ticket and grant in this module is a fixture written for it. No identity provider, ticketing system or provider account sits behind the exercise, and nothing in it calls a network. The protocols are real; the companies are invented.',
        },
      ],
    },
  ],
  activities: [
    {
      id: 'fde-v1-m03-l1-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: identity and tenant access',
      summary: 'Current request authority, fixed active-tenant policy, scoped storage and bounded disclosure risks.',
      competencies: ['boundaries'],
      estimatedMinutes: 25,
      lessonId: 'fde-v1-m03-l1',
    },
    {
      id: 'fde-v1-m03-l2-read',
      kind: 'lesson',
      purpose: 'exercise',
      verification: 'self_reviewed',
      title: 'Read: delegated access, SSO, webhooks and audit',
      summary: 'The OAuth code flow with PKCE and token handling, SAML and OIDC checks, signed webhooks with replay protection, audit entries, and retention and deletion of every copy.',
      competencies: ['boundaries'],
      estimatedMinutes: 40,
      lessonId: 'fde-v1-m03-l2',
    },
    {
      id: 'fde-v1-m03-checks',
      kind: 'check',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Boundary checks',
      summary:
        'Ten boundary questions under explicit policies: active-tenant authority, scoped storage access, per-batch grants, audit attribution, the OAuth code flow and token handling, SAML and OIDC validation, webhook signatures and replay.',
      competencies: ['boundaries'],
      estimatedMinutes: 25,
      passThreshold: 0.8,
      questions: [
        {
          id: 'fde-v1-m03-q1',
          prompt:
            'This run is bound by policy to the active tenant in a server-verified session; even membership in another tenant does not permit switching this run. The model supplies tool arguments. Which tenant source must the wrapper use while checking current permission?',
          options: [
            'The server-verified active-tenant session, with current authorization checked for the operation.',
            'From the `tenantId` argument on the tool call, after checking that it names a tenant the store knows about.',
            'From the `X-Tenant-Id` header the client sends, after checking the operator belongs to that tenant.',
            'From the `tenantId` on the records themselves, once the query has returned them.',
          ],
          correct: 0,
          explanation:
            'Under this explicit fixed-tenant policy, use the server-verified active tenant and current authorization. A valid credential from sign-in alone does not guarantee every later operation remains permitted. The tool argument is written by the model from text it just read, so checking that it names a real tenant only proves the attacker picked an existing one. The header is written by the client; a membership-checked header can be valid in a different design that explicitly permits tenant selection, but it does not satisfy this run’s fixed-active-tenant policy. Reading the tenant off the returned rows is the post-fetch filter, and by then the rows are already in your process.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q2',
          prompt:
            'The policy requires tenant scope at the storage query. A handler instead fetches all tenants and correctly filters before returning only the caller’s rows. Why does this still violate that policy and least-data-access design?',
          options: [
            'A JavaScript comparison of two tenant ids can differ from the database’s collation, so the filter may keep a row the store would have excluded.',
            'Unrelated tenants’ rows enter the handler before filtering, increasing exposure to later logging, error or aggregation mistakes.',
            'The extra rows make the request slow enough to time out under load, and a timed-out request returns the unfiltered set.',
            'The filter cannot see rows written since the query started, so the caller misses their own most recent orders.',
          ],
          correct: 1,
          explanation:
            'The broad fetch already violates the stated storage-scope policy by bringing unrelated rows into the handler. It expands the data exposed to later mistakes; it does not prove that every log or crash report actually contains those rows. Apply the authorized tenant at the query and use an appropriate independent database policy where supported. Collation is a real hazard in a different discussion and would produce a wrong result rather than this one. The latency claim is backwards — a fast leak is still a leak, and a timeout returns an error, not the raw set. Missing later writes is a consistency question, not the stated storage-scope defect; its behavior depends on the query and isolation model.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q3',
          prompt:
            'Policy requires a currently valid grant before every batch and forbids self-extension. An export writes exactly 20 orders per successful batch. After two batches, the operator’s grant expires before batch three starts. What must the wrapper do?',
          options: [
            'Finish the run: the grant was checked and valid when the job started, and re-checking a permission mid-job makes long exports unreliable.',
            'Finish the run but flag the remaining rows for review, because an expiry ends future authorizations while a revocation ends current ones.',
            'Refuse the third batch, stop the job, and record the denial together with the 40 rows already written.',
            'Extend the grant for the remaining batches, since the operator was authorized when the work began and nobody revoked it.',
          ],
          correct: 2,
          explanation:
            'The stated policy requires authorization again before batch three, when this grant is no longer valid. Stop before writing that batch and record the denial plus the 40 rows already written; denial does not undo completed external work. A start-only check does not meet this policy, and the wrapper cannot renew its own authority. Expiry and revocation have different mechanisms and propagation rules in different systems, so do not infer a universal in-flight rule beyond the contract given here.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q4',
          prompt:
            'Which candidate best records who read which tenant’s orders, the authorization decision and policy/grant correlation, without copying complete customer rows into this audit entry?',
          context: {
            language: 'json',
            code:
              '[\n  { "entry": "A", "at": "2026-04-02T09:14:11Z", "message": "Operator exported orders" },\n\n  { "entry": "B", "at": "2026-04-02T09:14:11Z", "actor": "USR-31", "action": "orders.read",\n    "decision": "allow",\n    "records": [{ "id": "ORD-1001", "customer": "Halloway Depot", "total": 240.5 }] },\n\n  { "entry": "C", "at": "2026-04-02T09:14:11Z", "requestId": "req-9d2f41", "actor": "USR-31",\n    "onBehalfOfTenant": "TEN-4021", "action": "orders.read",\n    "targetIds": ["ORD-1001", "ORD-1005"],\n    "decision": "allow", "grantId": "GRT-77", "policyVersion": 4 },\n\n  { "entry": "D", "at": "09:14", "actor": "assistant", "action": "read", "decision": "allow" }\n]',
          },
          options: [
            'C: actor, tenant, action/targets, decision, grant/policy and request correlation.',
            'B, because it stores the rows themselves, so a reviewer can see exactly which data left the system without trusting anything else.',
            'A, because a plain sentence is what a reviewer actually reads, and the UTC timestamp is enough to find the matching request in the logs.',
            'D, because it is the smallest entry that still records an actor, an action and a decision, and short entries are the ones teams keep writing.',
          ],
          correct: 0,
          explanation:
            'C records the requested attribution and correlation fields. Fully reproducing a past decision also needs the relevant historical policy/grant versions and decision inputs; a version number alone does not reconstruct them. B copies customer details and totals that are not needed for this entry’s stated purpose, while omitting tenant and grant attribution. Protect and retain audit evidence according to the actual policy; this question does not set a universal retention period. A has no actor, no tenant and no ids, so it is a sentence rather than a record. D records the software as the actor and a local time with no date or zone, which is exactly the entry that cannot be lined up with anything else six months later.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q5',
          prompt:
            'Marlbrook’s connector must read and update Dunfold’s tickets in Dunfold’s ticketing system. Dunfold’s admin approves it once, for two scopes. The connector runs on Marlbrook’s servers, and the provider supports current OAuth. Which flow fits?',
          options: [
            'The resource owner password grant: the admin types her ticketing password into Marlbrook once, and Marlbrook trades it for tokens and discards it.',
            'The authorization code grant with PKCE: a one-time state value, an exactly matched redirect URI, and the code redeemed once with the verifier.',
            'The implicit grant: the access token returns in the redirect fragment, so Marlbrook’s servers never have to store a code or a refresh token.',
            'The client credentials grant: Marlbrook authenticates as itself with its own client secret and receives one token that works for every tenant.',
          ],
          correct: 1,
          explanation:
            'The authorization code grant with PKCE lets the admin approve at the authorization server she already trusts. Marlbrook never sees her password, and the token carries only the scopes she approved. State and PKCE protect the callback, and exact redirect matching keeps the code from landing anywhere else. The password grant hands her credentials to Marlbrook; RFC 9700 says clients must not use it, and the OAuth 2.1 draft leaves it out. The implicit grant puts the token in the browser’s redirect, where it can leak and cannot be sender-constrained; RFC 9700 says clients should not use it. Client credentials can fit machine-to-machine access with no user involved, but it records no admin’s approval, and a token that works for every tenant is wider than this connection needs.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q6',
          prompt:
            'The token endpoint returns a one-hour access token and a refresh token for Dunfold’s connection. Which handling fits the connector?',
          options: [
            'Send the access token as an `access_token` query parameter, so each line of the connector’s access log shows which token served which call.',
            'Keep the refresh token in the admin’s browser storage, so the connection survives when Marlbrook restores its own database from a backup.',
            'Request every scope the provider offers in this first consent, so a later Marlbrook feature never has to show the admin a second consent screen.',
            'Store both tokens server-side against Dunfold’s connection, send the access token in the Authorization header, and keep only the newest refresh token.',
          ],
          correct: 3,
          explanation:
            'Server-side storage tied to the tenant’s connection keeps the tokens with the one service that uses them, the Authorization header keeps the access token out of URLs, and keeping only the newest refresh token follows the rotation the server performs. The OAuth 2.1 draft says clients must not send access tokens in a URI query parameter, and a token in an access log is a token anyone who reads the log can replay. Browser storage puts a long-lived credential where any script on the page can read it, and it ties the connection to one person’s browser instead of the tenant. Asking for every scope breaks the least-privilege rule RFC 9700 recommends: a bug in the sync could then reach whatever the widest scope reaches.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q7',
          prompt:
            'Marlbrook receives a SAML response for Dunfold’s single sign-on. Its XML signature verifies with the certificate configured for Dunfold’s identity provider. What else must hold before Marlbrook starts a session?',
          options: [
            'The audience is Marlbrook’s entity ID, Destination and Recipient match its ACS URL, the time conditions hold, InResponseTo matches a request Marlbrook sent, and the assertion id is new.',
            'The email attribute ends in a domain registered to a Marlbrook tenant, and that domain decides which tenant the person signs in to, whichever provider sent the response.',
            'The signature also verifies with the certificate inside the response’s KeyInfo element, so a certificate the provider rotated yesterday keeps working without a configuration change.',
            'Nothing beyond the signature and the Issuer value, because a valid signature from Dunfold’s provider already shows that the assertion was issued for this login.',
          ],
          correct: 0,
          explanation:
            'A valid signature proves who issued the assertion. The audience, Destination and Recipient checks prove it was meant for Marlbrook, NotBefore and NotOnOrAfter prove it is current, InResponseTo ties it to a login Marlbrook started, and a record of used assertion IDs stops a replay. SAML Core defines the audience and time conditions and requires the recipient to check Destination. The SAML Profiles document requires a service provider in web browser SSO to check Recipient and InResponseTo, and to keep the IDs of used bearer assertions until their NotOnOrAfter passes. The OWASP SAML Security Cheat Sheet lists these checks for a service provider and asks for replay detection at the response or assertion level. The email domain is a claim inside the assertion; the tenant comes from the provider connection that verified it, or Kestrel’s provider could sign people in to Dunfold. The OWASP cheat sheet says to verify with keys obtained from the provider and to ignore KeyInfo, since an attacker who signs with their own key would put that key in KeyInfo. A signature and an issuer say nothing about audience or freshness: the same provider signs assertions for every application it serves.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q8',
          prompt:
            'Dunfold’s identity provider also serves an expense app. A forwarding bug hands Marlbrook an ID token that the provider issued, correctly signed, to that expense app. Which ID token check refuses it?',
          options: [
            '`iss` exactly matches the issuer Marlbrook configured for Dunfold.',
            'The JWS signature verifies with the keys Dunfold’s provider publishes.',
            '`aud` contains the `client_id` Marlbrook registered with the provider.',
            '`exp` still lies in the future at the moment Marlbrook checks it.',
          ],
          correct: 2,
          explanation:
            'OpenID Connect Core requires the client to reject an ID token whose `aud` does not list its own `client_id`. The expense app’s token names the expense app’s client, so that check refuses it. The issuer matches, because the same provider issued both tokens. The signature verifies, because the same provider signed both with the same keys. The expiry may well lie in the future if the token is fresh. Keep those three checks, but none of them tells two applications at one provider apart.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q9',
          prompt:
            'The provider signs `webhook-id.webhook-timestamp.body` with HMAC-SHA256 under the connection’s secret. Marlbrook’s web framework parses JSON bodies before handlers run. Which verification should the receiver use?',
          options: [
            'Re-serialize the parsed body with sorted keys and sign that, so spacing differences between the provider and the framework cannot cause false rejections.',
            'Read the raw body before any parsing, sign the id, timestamp and raw body, and compare with each header entry through a constant-time comparison.',
            'Accept requests only from the provider’s published IP ranges and skip the HMAC, since an attacker cannot forge a TCP source address across the internet.',
            'Sign the raw body alone and compare with `===`, since the id and the timestamp travel in headers that the provider’s TLS session already protects.',
          ],
          correct: 1,
          explanation:
            'The signature covers the exact bytes the provider sent, with the id and timestamp in front, so you verify that same string and compare in constant time. The Standard Webhooks specification describes this signed content and asks for a constant-time comparison. A re-serialized body differs from the signed one, which the specification warns about: genuine deliveries fail, and a fix that loosens the check accepts edited ones. An IP allowlist can add a layer, but it proves nothing about the body or the connection, and published ranges change. Signing the body alone lets an attacker pair a captured body with a fresh timestamp and id, and `===` returns at the first differing character, which leaks timing.',
          competencies: ['boundaries'],
        },
        {
          id: 'fde-v1-m03-q10',
          prompt:
            'Marlbrook verifies signatures and refuses timestamps more than 300 seconds from now. A support engineer pastes a genuine delivery, headers and all, into a shared debugging channel, and someone resends it 40 seconds after it first arrived. What refuses the second copy?',
          options: [
            'The signature check, because each signature is valid only for the first request that presents it to the receiver.',
            'The timestamp tolerance, because the copy arrives 40 seconds later than the original delivery did.',
            'TLS, because the resent copy travels on a different connection, with different session keys, than the original delivery.',
            'A replay store keyed by connection and `webhook-id`, keeping each key until its signed timestamp is over 300 seconds old.',
          ],
          correct: 3,
          explanation:
            'Inside the tolerance window, only a record of ids already processed tells the copy from the original. Key it by connection and `webhook-id`, and keep each key until the delivery’s own signed timestamp falls outside the tolerance. The tolerance runs 300 seconds in both directions, so a delivery stamped 300 seconds ahead can arrive now, and a copy of it still passes the timestamp check up to 600 seconds later. A key kept only 300 seconds from arrival would expire inside that span, and the copy would be applied. Counting from the signed timestamp, or keeping every key for twice the tolerance, leaves nothing the timestamp check does not cover. The signature is a property of the content, so an exact copy carries a valid one. Forty seconds sits inside the 300-second tolerance. TLS protects the bytes in transit; it does not stop someone who already holds a genuine delivery from sending it again on a new connection.',
          competencies: ['boundaries'],
        },
      ],
    },
    {
      id: 'fde-v1-m03-webhook-receiver',
      kind: 'code',
      purpose: 'exercise',
      verification: 'machine_verified',
      title: 'Tenant-scoped webhook receiver',
      summary:
        'Repair a TypeScript receiver that trusts the payload’s tenant, compares the signature header with ===, skips the timestamp, grant and payload checks, never asks the replay store and writes no audit entry. Graded on behaviour, signature, replay, tenant isolation and permission freshness.',
      competencies: ['boundaries'],
      estimatedMinutes: 50,
      code: {
        language: 'typescript',
        prompt:
          'Dunfold Freight and Kestrel Foods each connected their ticketing system to Marlbrook. When a ticket changes status, the provider POSTs a delivery to `/hooks/:connectionId`. Repair `receiveWebhook(delivery, ctx)`, the function every delivery passes through. It returns `{ ok: true, ticketId, status }` when it applied the update and `{ ok: false, reason }` when it refused.\n\n`delivery.connectionId` comes from the URL path. `delivery.headers` holds lowercase header names: `webhook-id`, `webhook-timestamp` (whole seconds since the Unix epoch, as a string) and `webhook-signature` (one or more space-separated entries such as `v1,<base64>`). `delivery.body` is the raw body string exactly as it arrived.\n\n`ctx` is the trusted server side: `now` (an ISO instant), `getConnection(id)` (a `Connection` or `null`), `sign(secret, content)` (HMAC-SHA256, base64), `safeEqual(a, b)` (a constant-time string comparison), `claim(key)` (the replay store: `true` the first time you claim a key, `false` after), `findTicket(tenantId, ticketId)` (a tenant-scoped read that returns the ticket or `null`), `updateStatus(tenantId, ticketId, status)` and `audit(entry)`.\n\nThe starter trusts the payload’s tenant, compares the whole signature header with `===`, skips the timestamp, grant and payload checks, throws on a body that does not parse, never asks the replay store and writes no audit entry. The scratch pad shows what the first of those costs. Repair it so it checks, in this order:\n\n1. **Connection.** When `ctx.getConnection(delivery.connectionId)` returns `null`, refuse `unknown_connection`.\n2. **Signature.** When any of the three headers is missing or empty, refuse `bad_signature`. Otherwise compute `\'v1,\' + ctx.sign(connection.secret, id + \'.\' + timestamp + \'.\' + body)` and compare it with each space-separated entry of `webhook-signature` through `ctx.safeEqual`. When no entry matches, refuse `bad_signature`.\n3. **Timestamp.** The timestamp must be ASCII digits only and lie within 300 seconds of `ctx.now`, in either direction; exactly 300 seconds passes. Otherwise refuse `stale_timestamp`.\n4. **Grant.** The connection’s grant is revoked when `revokedAt` is set and falls at or before `ctx.now`: refuse `grant_revoked`. It is expired when `expiresAt` falls at or before `ctx.now`: refuse `grant_expired`. When both hold, report `grant_revoked`. Fail closed on a date that does not parse: an unparseable `expiresAt` has expired, and a `revokedAt` that is set but does not parse counts as revoked.\n5. **Payload.** Parse the body as JSON. It must be an object with `type` equal to `ticket.status_changed`, a string `ticketId`, a string `tenantId`, and a `status` of `open`, `pending` or `solved`. Anything else, including a body that does not parse, is `bad_payload`.\n6. **Tenant.** The tenant is `connection.tenantId`. When the payload’s `tenantId` names another tenant, refuse `tenant_mismatch` before you read any ticket.\n7. **Ticket.** When `ctx.findTicket(connection.tenantId, ticketId)` returns `null`, refuse `unknown_ticket`.\n8. **Replay.** Claim the key `connectionId + \':\' + webhookId`. When `ctx.claim` returns `false`, refuse `replayed`. Claim only here, after every other check passed, so a refused delivery never uses up its id.\n9. **Write.** Call `ctx.updateStatus(connection.tenantId, ticketId, status)` once and return `{ ok: true, ticketId, status }`.\n\nEvery delivery, accepted or refused, writes exactly one audit entry through `ctx.audit`: `{ webhookId, connectionId, tenantId, decision, reason }`. `webhookId` is the header value, or `null` when it is missing or empty. `tenantId` is the connection’s tenant, or `null` for an unknown connection. `decision` is `accept` or `refuse`, and `reason` is the refusal reason or `accepted`.\n\nDomain: a body of at most 64 KiB, header values of at most 200 characters, and at most 10 signature entries. The `ctx` functions never throw. Do not mutate `delivery`. Target: O(n) time, where n is the body length plus the length of the signature header.\n\nThe deliveries, secrets, tickets and grants are fixtures written for this exercise. No ticketing provider, network or clock sits behind them: `ctx.now` is the only time there is, and `ctx.sign` is a plain-JavaScript HMAC-SHA256 because the sandbox has no crypto module.',
        contract: [
          'The tenant is `connection.tenantId`. The payload’s `tenantId` may only agree with it; it never chooses which tenant you read or write.',
          'Compare signatures through `ctx.safeEqual` only. A `===` comparison stops at the first differing character. The grade checks that your accept decision is the answer `ctx.safeEqual` gives for the header entry and the expected signature, so calling it beside a `===` comparison does not pass.',
          'Verify `delivery.body` as it arrived. Do not parse and re-serialize it before you sign.',
          'Call `ctx.claim` once, after every other check passed, and `ctx.updateStatus` at most once, after a successful claim.',
          'Keep the supplied type names and the `receiveWebhook` signature. No imports, no network and no clock: the harness supplies `ctx`. Do not declare names that start with `__`.',
        ],
        starter: `type Reason =
  | 'unknown_connection'
  | 'bad_signature'
  | 'stale_timestamp'
  | 'grant_revoked'
  | 'grant_expired'
  | 'bad_payload'
  | 'tenant_mismatch'
  | 'unknown_ticket'
  | 'replayed';

type TicketStatus = 'open' | 'pending' | 'solved';

interface Delivery {
  connectionId: string;
  headers: Record<string, string | undefined>;
  body: string;
}

interface Grant {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface Connection {
  tenantId: string;
  secret: string;
  grant: Grant;
}

interface Ticket {
  id: string;
  tenantId: string;
  status: TicketStatus;
}

interface AuditEntry {
  webhookId: string | null;
  connectionId: string;
  tenantId: string | null;
  decision: 'accept' | 'refuse';
  reason: Reason | 'accepted';
}

interface ReceiverContext {
  now: string;
  getConnection(id: string): Connection | null;
  sign(secret: string, content: string): string;
  safeEqual(a: string, b: string): boolean;
  claim(key: string): boolean;
  findTicket(tenantId: string, ticketId: string): Ticket | null;
  updateStatus(tenantId: string, ticketId: string, status: TicketStatus): void;
  audit(entry: AuditEntry): void;
}

type Outcome = { ok: true; ticketId: string; status: TicketStatus } | { ok: false; reason: Reason };

const receiveWebhook = (delivery: Delivery, ctx: ReceiverContext): Outcome => {
  const connection = ctx.getConnection(delivery.connectionId);
  if (!connection) return { ok: false, reason: 'unknown_connection' };

  const id = delivery.headers['webhook-id'] ?? '';
  const timestamp = delivery.headers['webhook-timestamp'] ?? '';
  const expected = 'v1,' + ctx.sign(connection.secret, id + '.' + timestamp + '.' + delivery.body);
  if (delivery.headers['webhook-signature'] !== expected) return { ok: false, reason: 'bad_signature' };

  const event = JSON.parse(delivery.body);
  const tenantId: string = event.tenantId;
  const ticket = ctx.findTicket(tenantId, event.ticketId);
  if (!ticket) return { ok: false, reason: 'unknown_ticket' };

  ctx.updateStatus(tenantId, ticket.id, event.status);
  return { ok: true, ticketId: ticket.id, status: event.status };
};

// Scratch pad: change this before submitting.
// demoSign is a stand-in so the pad runs on its own. It is not an HMAC.
const demoSign = (secret: string, content: string): string => secret + ':' + content.length;
const demoTickets: Ticket[] = [
  { id: 'TCK-1001', tenantId: 'TEN-4021', status: 'open' },
  { id: 'TCK-2001', tenantId: 'TEN-7788', status: 'open' },
];
const demoCtx: ReceiverContext = {
  now: '2026-04-02T09:00:00Z',
  getConnection: (id) =>
    id === 'CON-DUN'
      ? { tenantId: 'TEN-4021', secret: 'dunfold-demo', grant: { id: 'GRT-91', expiresAt: '2026-04-02T17:00:00Z', revokedAt: null } }
      : null,
  sign: demoSign,
  safeEqual: (a, b) => a === b,
  claim: () => true,
  findTicket: (tenantId, ticketId) => demoTickets.find((one) => one.tenantId === tenantId && one.id === ticketId) ?? null,
  updateStatus: (tenantId, ticketId, status) => console.log('write', tenantId, ticketId, status),
  audit: (entry) => console.log('audit', JSON.stringify(entry)),
};
const demoBody = JSON.stringify({ type: 'ticket.status_changed', ticketId: 'TCK-2001', tenantId: 'TEN-7788', status: 'solved' });
const demoStamp = String(Date.parse(demoCtx.now) / 1000 - 40);
const demoSignature = 'v1,' + demoSign('dunfold-demo', 'msg_7Qd2.' + demoStamp + '.' + demoBody);

// Dunfold's connection, Kestrel's ticket. Look at whose ticket gets written.
console.log(JSON.stringify(receiveWebhook({
  connectionId: 'CON-DUN',
  headers: { 'webhook-id': 'msg_7Qd2', 'webhook-timestamp': demoStamp, 'webhook-signature': demoSignature },
  body: demoBody,
}, demoCtx)));
`,
        skeleton: `// Keep the type declarations from the starter above this function.

const receiveWebhook = (delivery: Delivery, ctx: ReceiverContext): Outcome => {
  const connectionId = delivery.connectionId;
  const webhookId = delivery.headers['webhook-id'] || null;
  const connection = ctx.getConnection(connectionId);
  const refuse = (reason: Reason): Outcome => {
    /* one audit entry: webhookId, connectionId, the connection's tenant or null, 'refuse', reason */
    return { ok: false, reason };
  };
  if (!connection) return refuse('unknown_connection');

  /* signature: all three headers present, then 'v1,' + ctx.sign(...) against each entry through ctx.safeEqual */

  /* timestamp: digits only, within 300 seconds of ctx.now either way */

  /* grant: revoked at or before now, then expired at or before now; an unparseable date fails closed */

  /* payload: JSON.parse inside try/catch, then type, ticketId, tenantId and status */

  /* tenant: connection.tenantId decides; a payload naming another tenant is tenant_mismatch */

  /* ticket: ctx.findTicket with the connection's tenant */

  /* replay: ctx.claim(connectionId + ':' + webhookId), last of all */

  /* write, audit 'accept' with reason 'accepted', return the outcome */
};`,
        hints: [
          'Write a small `refuse(reason)` helper that records the audit entry and returns `{ ok: false, reason }`. Every refusal then audits the same way, and you cannot forget one.',
          'Split the signature header on spaces and use `.some((entry) => ctx.safeEqual(entry, expected))`. Sign `delivery.body` itself: the provider signed the string it sent, and a parsed-then-stringified body is a different string.',
          'Read the tenant from `connection.tenantId` and compare the payload’s `tenantId` against it. Call `ctx.claim` only after the ticket lookup succeeds, so a forged or refused delivery cannot use up a genuine id.',
        ],
        approach: [
          'Look up the connection and refuse `unknown_connection` when there is none.',
          'Refuse `bad_signature` when a header is missing, then compare `\'v1,\' + ctx.sign(...)` with each signature entry through `ctx.safeEqual`.',
          'Refuse `stale_timestamp` unless the timestamp is digits only and within 300 seconds of `ctx.now`.',
          'Refuse `grant_revoked`, then `grant_expired`, comparing instants with `Date.parse` and treating a date that does not parse as already passed.',
          'Parse and validate the payload, refuse `tenant_mismatch` when it names another tenant, and refuse `unknown_ticket` when the scoped lookup misses.',
          'Claim `connectionId:webhookId`, refuse `replayed` when the claim fails, then write once, audit the acceptance and return.',
        ],
        criteria: [
          {
            id: 'core',
            label: 'Correct outcomes, payload validation and one audit entry per delivery',
            critical: true,
            weight: 2,
            detail:
              'The behaviour is off outside the four security checks, or the code does not compile. Confirm that an unknown connection refuses with `unknown_connection` and audits a null tenant, that a body which does not parse or misses a field gives `bad_payload` without throwing, that an accepted delivery returns `{ ok: true, ticketId, status }`, and that every delivery writes exactly one audit entry with the right decision and reason.',
          },
          {
            id: 'signature',
            label: 'Only a delivery signed with the connection’s secret over its raw body is accepted',
            critical: true,
            weight: 3,
            detail:
              'A delivery the connection’s secret did not sign got through, or a genuine one was refused. Check that a missing header, a wrong secret, a body edited after signing and an entry without the `v1,` prefix all refuse with `bad_signature`, that a valid entry anywhere in the space-separated list passes, and that the accept decision is the answer `ctx.safeEqual` gives for the entry and the expected signature rather than the result of `===`.',
          },
          {
            id: 'replay',
            label: 'A delivery is applied at most once, and only while it is fresh',
            critical: true,
            weight: 3,
            detail:
              'A delivery was applied twice, or a stale one was applied, or a genuine one was refused as a replay. The receiver claims `connectionId:webhookId` once, after every other check, so the same id on another connection is a different delivery and a forged delivery never uses up a genuine id. Timestamps that are not digits, or lie more than 300 seconds from `ctx.now` in either direction, refuse with `stale_timestamp`.',
          },
          {
            id: 'tenant-isolation',
            label: 'No delivery reads or writes another tenant’s ticket, whatever its payload says',
            critical: true,
            weight: 3,
            detail:
              'The tenant boundary did not hold. A payload naming another tenant must refuse with `tenant_mismatch` before any ticket is read, a ticket id that belongs to another tenant must miss the scoped lookup, and the audit entry must name the connection’s tenant. A valid signature proves which connection sent the delivery; it does not let that connection reach another tenant’s records.',
          },
          {
            id: 'permission-freshness',
            label: 'An expired or revoked grant refuses before anything is read or written',
            critical: true,
            weight: 2,
            detail:
              'A grant check ran too late, too loosely, or not at all. A grant whose `expiresAt` is at or before `ctx.now` gives `grant_expired`, a grant revoked at or before `ctx.now` gives `grant_revoked` even when it has also expired, a revocation dated after `ctx.now` does not refuse, a date that does not parse fails closed, and none of those refusals reads a ticket or claims an id.',
          },
        ],
        tests: [
          {
            call: '(function () { var w = __world(); var out = receiveWebhook(__deliver(), w.ctx); return { out: out, writes: w.writes }; })()',
            expected: { out: { ok: true, ticketId: 'TCK-1001', status: 'solved' }, writes: ['TEN-4021:TCK-1001:solved'] },
            label: 'a genuine delivery for Dunfold’s own ticket is applied once',
          },
          {
            call: '(function () { var w = __world(); receiveWebhook(__deliver(), w.ctx); return w.audit; })()',
            expected: [{ webhookId: 'msg_2Lk9', connectionId: 'CON-DUN', tenantId: 'TEN-4021', decision: 'accept', reason: 'accepted' }],
            label: 'the accepted delivery writes one audit entry',
          },
          {
            call: "(function () { var w = __world(); var out = receiveWebhook(__deliver({ connectionId: 'CON-XYZ' }), w.ctx); return { out: out, audit: w.audit }; })()",
            expected: {
              out: { ok: false, reason: 'unknown_connection' },
              audit: [{ webhookId: 'msg_2Lk9', connectionId: 'CON-XYZ', tenantId: null, decision: 'refuse', reason: 'unknown_connection' }],
            },
            label: 'an unknown connection is refused and audited with no tenant',
            edge: true,
          },
          {
            call: "(function () { var w = __world(); var out = receiveWebhook(__deliver({ event: { status: 'deleted' } }), w.ctx); return { out: out, writes: w.writes }; })()",
            expected: { out: { ok: false, reason: 'bad_payload' }, writes: [] },
            label: 'a status outside open, pending and solved is a bad payload',
          },
          {
            call: "(function () { var w = __world(); var out = receiveWebhook(__deliver({ secret: 'whsec-guessed' }), w.ctx); return { out: out, writes: w.writes, claims: w.claims }; })()",
            expected: { out: { ok: false, reason: 'bad_signature' }, writes: [], claims: [] },
            label: 'a delivery signed with the wrong secret is refused',
            criterion: 'signature',
          },
          {
            call: "(function () { var w = __world(); var out = receiveWebhook(__deliver({ omit: ['webhook-signature'] }), w.ctx); return { out: out, writes: w.writes }; })()",
            expected: { out: { ok: false, reason: 'bad_signature' }, writes: [] },
            label: 'a delivery with no signature header is refused',
            edge: true,
            criterion: 'signature',
          },
          {
            call: '(function () { var w = __world(); var d = __deliver(); var first = receiveWebhook(d, w.ctx); var second = receiveWebhook(d, w.ctx); return { first: first, second: second, writes: w.writes }; })()',
            expected: {
              first: { ok: true, ticketId: 'TCK-1001', status: 'solved' },
              second: { ok: false, reason: 'replayed' },
              writes: ['TEN-4021:TCK-1001:solved'],
            },
            label: 'the same delivery sent twice is applied once',
            criterion: 'replay',
          },
          {
            call: '(function () { var w = __world(); var out = receiveWebhook(__deliver({ age: 301 }), w.ctx); return { out: out, writes: w.writes }; })()',
            expected: { out: { ok: false, reason: 'stale_timestamp' }, writes: [] },
            label: 'a correctly signed delivery 301 seconds old is refused',
            edge: true,
            criterion: 'replay',
          },
          {
            call: "(function () { var w = __world(); var out = receiveWebhook(__deliver({ event: { ticketId: 'TCK-2001', tenantId: 'TEN-7788' } }), w.ctx); return { out: out, reads: w.reads, writes: w.writes }; })()",
            expected: { out: { ok: false, reason: 'tenant_mismatch' }, reads: [], writes: [] },
            label: 'Dunfold’s connection cannot update Kestrel’s ticket by naming Kestrel in the payload',
            criterion: 'tenant-isolation',
          },
          {
            call: "(function () { var w = __world({ grant: { expiresAt: '2026-04-02T08:00:00Z' } }); var out = receiveWebhook(__deliver(), w.ctx); return { out: out, claims: w.claims, writes: w.writes }; })()",
            expected: { out: { ok: false, reason: 'grant_expired' }, claims: [], writes: [] },
            label: 'a grant that expired an hour ago refuses before anything is claimed or written',
            criterion: 'permission-freshness',
          },
        ],
        harness: WEBHOOK_WORLD,
      },
    },
  ],
  requires: [
    { activityId: 'fde-v1-m03-checks', state: 'verified_pass' },
    { activityId: 'fde-v1-m03-webhook-receiver', state: 'verified_pass' },
  ],
};
