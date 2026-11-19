/** GitHub App client for the garden.
 *
 * The learner installs the app on a repository they own. The server holds the
 * app's private key, mints a short-lived app JWT, exchanges it for an
 * installation token, and writes one file per passed task with the Contents
 * API. No user token is ever stored: the installation id is the whole
 * connection, and the learner can revoke it from GitHub at any time.
 *
 * Connecting proves ownership once. The app requests user authorization
 * during installation, so GitHub's redirect carries a one-time `code` beside
 * the installation id; `checkInstallationOwner` exchanges it for a user access
 * token, uses that token for two reads, and drops it. */

import { createSign } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CodingGardenStatus } from '../shared/coding-api';
import { gardenPathFor, hasLearnLevel, type CodingTask } from '../shared/coding-catalog';
import type { GardenPassInput } from './github-garden';
import { UpstreamTimeoutError, withTimeout } from './http';

const API = 'https://api.github.com';
const USER_AGENT = 'devShark-garden';
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Every variable the garden needs. Without the OAuth client pair a connect
 * could not prove who owns the installation, so the garden stays off. */
const GITHUB_APP_ENV = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
] as const;

export function isGithubAppConfigured(): boolean {
  return GITHUB_APP_ENV.every((key) => Boolean(process.env[key]));
}

export const githubAppSlug = (): string => process.env.GITHUB_APP_SLUG ?? '';

function privateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY ?? '';
  if (raw.includes('-----BEGIN')) return raw.replace(/\\n/g, '\n');
  return Buffer.from(raw, 'base64').toString('utf8');
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/** RS256 app JWT, valid for nine minutes, issued a minute in the past to
 * absorb clock skew (GitHub rejects tokens issued in the future). */
function appJwt(now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: process.env.GITHUB_APP_ID }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey()).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export class GithubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** How long one GitHub call may take before it counts as GitHub not answering. */
const GITHUB_TIMEOUT_MS = 8_000;

/** Our own timer aborted the call: GitHub did not answer in time, which is the
 * service unavailable for a moment (503 `upstream_timeout`), not a fault. */
const timedOut = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** `bearer` for an app JWT or a user access token, `token` for an installation token. */
async function gh<T>(path: string, init: { method?: string; token: string; body?: unknown; bearer?: boolean }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `${init.bearer ? 'Bearer' : 'token'} ${init.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // An outage page from a proxy in front of GitHub, not an API answer.
        throw new GithubError(response.ok ? 502 : response.status, response.ok ? 'GitHub answered with something other than JSON' : response.statusText);
      }
    }
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : response.statusText;
      throw new GithubError(response.status, message.slice(0, 200));
    }
    return data as T;
  } catch (error) {
    if (timedOut(error)) throw new UpstreamTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cached.token;
  const data = await gh<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, { method: 'POST', token: appJwt(), bearer: true });
  tokenCache.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

export interface InstallationInfo {
  id: number;
  account: { login: string; id: number; type: string };
  repository_selection: 'all' | 'selected';
}

export function getInstallation(installationId: number): Promise<InstallationInfo> {
  return gh<InstallationInfo>(`/app/installations/${installationId}`, { token: appJwt(), bearer: true });
}

/* ── installation ownership ───────────────────────────────────────────── */

const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const INSTALLATIONS_PER_PAGE = 100;
/** A learner with more installations of this one app than this is not real. */
const MAX_INSTALLATION_PAGES = 10;

/** Exchanges the one-time `code` from the install redirect for a user access
 * token. GitHub answers a used, expired or foreign code with HTTP 200 and an
 * `error` field, which comes back as `refused`; a transport failure throws. */
async function exchangeInstallCode(code: string): Promise<{ token: string } | { refused: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code }),
      signal: controller.signal,
    });
    if (!response.ok) throw new GithubError(response.status, 'GitHub did not answer the authorization exchange');
    const data = (await response.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
    if (typeof data?.access_token === 'string' && data.access_token) return { token: data.access_token };
    // Only GitHub's short error name is kept, for the log: never the body.
    const reason = typeof data?.error === 'string' && /^[a-z_]{1,64}$/.test(data.error) ? data.error : 'no_token';
    return { refused: reason };
  } catch (error) {
    if (timedOut(error)) throw new UpstreamTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function userCanReachInstallation(userToken: string, installationId: number): Promise<boolean> {
  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page++) {
    const data = await gh<{ installations?: { id: number }[] }>(`/user/installations?per_page=${INSTALLATIONS_PER_PAGE}&page=${page}`, { token: userToken, bearer: true });
    const installations = data.installations ?? [];
    if (installations.some((installation) => installation.id === installationId)) return true;
    if (installations.length < INSTALLATIONS_PER_PAGE) return false;
  }
  return false;
}

export type InstallationOwnerCheck =
  | { ok: true; githubUserId: number }
  | { ok: false; reason: 'code_refused'; detail: string }
  | { ok: false; reason: 'not_listed' };

/** Who finished the install on GitHub, and whether they can reach
 * `installationId`. The code becomes a user access token that is used for
 * `GET /user/installations` (every page) and `GET /user`, then dropped: it is
 * never stored, logged or returned. The caller still compares the returned
 * GitHub user id with the installation's account. */
export async function checkInstallationOwner(code: string, installationId: number): Promise<InstallationOwnerCheck> {
  const exchanged = await exchangeInstallCode(code);
  if ('refused' in exchanged) return { ok: false, reason: 'code_refused', detail: exchanged.refused };
  if (!(await userCanReachInstallation(exchanged.token, installationId))) return { ok: false, reason: 'not_listed' };
  const user = await gh<{ id: number }>('/user', { token: exchanged.token, bearer: true });
  return { ok: true, githubUserId: user.id };
}

export interface RepoInfo {
  full_name: string;
  default_branch: string;
  private: boolean;
  fork: boolean;
  owner: { login: string; id: number };
}

const REPOS_PER_PAGE = 100;
/** An installation on every repository of an account can list hundreds. */
const MAX_REPO_PAGES = 10;

/** Every repository the installation reaches, page by page: an installation
 * on "All repositories" of an account with more than a hundred would
 * otherwise hide the rest from the picker and refuse them as `bad_repo`. */
export async function listInstallationRepos(token: string): Promise<RepoInfo[]> {
  const repositories: RepoInfo[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const data = await gh<{ repositories?: RepoInfo[] }>(`/installation/repositories?per_page=${REPOS_PER_PAGE}&page=${page}`, { token });
    const batch = data.repositories ?? [];
    repositories.push(...batch);
    if (batch.length < REPOS_PER_PAGE) break;
  }
  return repositories;
}

async function getFile(token: string, repo: string, path: string, branch: string): Promise<{ sha: string; content: string } | null> {
  try {
    const data = await gh<{ sha: string; content: string; encoding: string }>(`/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`, { token });
    const content = data.encoding === 'base64' ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8') : data.content;
    return { sha: data.sha, content };
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }
}

async function putFile(token: string, repo: string, path: string, input: {
  content: string;
  message: string;
  branch: string;
  sha?: string;
  author: { name: string; email: string };
}): Promise<{ sha: string; url: string }> {
  const data = await gh<{ commit: { sha: string; html_url: string } }>(`/repos/${repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    token,
    body: {
      message: input.message,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      branch: input.branch,
      ...(input.sha ? { sha: input.sha } : {}),
      author: input.author,
      committer: input.author,
    },
  });
  return { sha: data.commit.sha, url: data.commit.html_url };
}

/* ── file and message builders (pure) ─────────────────────────────────── */

const TRACK_NAMES: Record<CodingTask['track'], string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  react: 'React',
  'system-design': 'System design',
  algorithms: 'Algorithms',
};

function commitMessageFor(task: CodingTask): string {
  const track = TRACK_NAMES[task.track];
  return `Complete "${task.title}" (${track}${hasLearnLevel(task) ? `, ${task.topic === 'dsa' ? 'DSA level' : 'level'} ${task.level}` : ''})`;
}

const LEVEL_TITLES: Record<string, string[]> = {
  javascript: ['Values & Math', 'Strings', 'Booleans & Comparison', 'Arrays: Basics', 'Objects: Basics', 'Array Iteration', 'Filter & Find', 'Reduce', 'Destructuring', 'Spread & Rest', 'Functions & Scope', 'Closures', 'Hoisting & let/const', 'this & Context', 'Callbacks & HOFs', 'Ternary & Short-circuit', 'Type Coercion', 'Truthy / Falsy', 'JSON & Objects', 'Optional & Nullish', 'Promises', 'Async / Await', 'Sets & Maps', 'Edge Cases & Gotchas', 'Mixed Mastery'],
  typescript: ['Basic Types', 'Type Inference', 'Function Types', 'Arrays & Tuples', 'Object Types', 'Interfaces', 'Union Types', 'Literal Types', 'Optional & Readonly', 'Type Aliases', 'Type Narrowing', 'Type Guards', 'Enums', 'Generics: Basics', 'Generic Constraints', 'keyof & typeof', 'Indexed Access', 'Partial & Required', 'Pick & Omit', 'Record', 'Mapped Types', 'Conditional Types', 'infer', 'Template Literals', 'Mixed Mastery'],
  react: ['JSX Basics', 'Components', 'Props', 'Rendering Lists', 'Conditional Rendering', 'useState: Basics', 'Event Handling', 'Updating State', 'State: Objects & Arrays', 'Derived State', 'useEffect: Basics', 'Effect Dependencies', 'Cleanup Functions', 'useRef', 'Forms & Inputs', 'Lifting State Up', 'useMemo', 'useCallback', 'useReducer', 'useContext', 'Custom Hooks', 'Keys & Reconciliation', 'Performance Patterns', 'Common Pitfalls', 'Mixed Mastery'],
};

function buildTaskFile(task: CodingTask, code: string, verdict: { passed: number; total: number }, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const trackName = TRACK_NAMES[task.track];
  const levelName = task.level > 0 ? LEVEL_TITLES[task.track]?.[task.level - 1] : undefined;
  const link = `https://devshark.app/coding/${task.track}/${task.id}`;
  const tests = verdict.total > 0 ? `${verdict.passed}/${verdict.total} tests` : 'passed';
  if (task.track === 'system-design') {
    return `# ${task.title}\n\ndevShark · System design · ${task.tier}\n\nPassed ${day} · ${tests}\n\n${link}\n`;
  }
  const header = [
    '/**',
    ` * ${task.title}`,
    ` * devShark · ${trackName}${levelName ? ` · Level ${task.level} "${levelName}"` : ''} · Tier ${task.tier}`,
    ` * Passed ${day} · ${tests}`,
    ` * ${link}`,
    ' */',
    '',
  ].join('\n');
  return `${header}${code.replace(/\s+$/, '')}\n`;
}

function readmeFor(login: string): string {
  return `# devShark garden\n\nEvery coding task passed on devShark lands here as one file, one folder per subject. Commits are written by the devShark garden app on behalf of ${login}.\n\nhttps://devshark.app/coding\n`;
}

/* ── pipeline ─────────────────────────────────────────────────────────── */

interface ConnectionRow {
  user_id: string;
  installation_id: number;
  account_login: string;
  account_id: number;
  repo_full_name: string | null;
  default_branch: string | null;
  status: 'pending_repo' | 'active' | 'broken';
}

/** The learner's connection, or null when there is none. A failed read
 * throws: read as "none", it told a connected learner to connect GitHub and
 * dropped the pass from the garden without queueing it. */
async function loadConnection(supabase: SupabaseClient, userId: string): Promise<ConnectionRow | null> {
  const { data, error } = await withTimeout(supabase.from('github_connections').select('user_id,installation_id,account_login,account_id,repo_full_name,default_branch,status').eq('user_id', userId).maybeSingle());
  if (error) throw new Error('db_error');
  return (data as ConnectionRow | null) ?? null;
}

const authorFor = (connection: ConnectionRow) => ({
  name: connection.account_login,
  email: `${connection.account_id}+${connection.account_login}@users.noreply.github.com`,
});

async function markBroken(supabase: SupabaseClient, userId: string, message: string) {
  await withTimeout(supabase.from('github_connections').update({ status: 'broken', last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('user_id', userId));
}

interface QueuedRow { id: string; path: string; content: string; message: string; attempts: number }

/** Writes one queued row to the repository. Returns the garden status for the UI. */
async function deliver(supabase: SupabaseClient, connection: ConnectionRow, row: QueuedRow): Promise<CodingGardenStatus> {
  if (connection.status !== 'active' || !connection.repo_full_name || !connection.default_branch) return { status: 'queued' };
  const now = new Date().toISOString();
  try {
    const token = await installationToken(connection.installation_id);
    const repo = connection.repo_full_name;
    const branch = connection.default_branch;
    const author = authorFor(connection);
    // Two reads that do not wait for each other: a pass is answered after them.
    const [readme, existing] = await Promise.all([getFile(token, repo, 'README.md', branch), getFile(token, repo, row.path, branch)]);
    if (!readme) {
      await putFile(token, repo, 'README.md', { content: readmeFor(connection.account_login), message: 'Start the devShark garden', branch, author });
    }
    if (existing && existing.content === row.content) {
      await withTimeout(supabase.from('github_commits').update({ status: 'skipped', updated_at: now }).eq('id', row.id));
      return { status: 'skipped', url: `https://github.com/${repo}/blob/${branch}/${row.path}` };
    }
    const commit = await putFile(token, repo, row.path, { content: row.content, message: row.message, branch, sha: existing?.sha, author });
    await Promise.all([
      withTimeout(supabase.from('github_commits').update({ status: 'committed', commit_sha: commit.sha, attempts: row.attempts + 1, last_error: null, updated_at: now }).eq('id', row.id)),
      withTimeout(supabase.from('github_connections').update({ last_commit_at: now, last_error: null, updated_at: now }).eq('user_id', connection.user_id)),
    ]);
    return { status: 'committed', url: commit.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = row.attempts + 1;
    const broken = error instanceof GithubError && [401, 403, 404].includes(error.status);
    await withTimeout(supabase.from('github_commits').update({ status: attempts >= MAX_ATTEMPTS && !broken ? 'failed' : 'queued', attempts, last_error: message.slice(0, 500), updated_at: now }).eq('id', row.id));
    if (broken) await markBroken(supabase, connection.user_id, message);
    return { status: attempts >= MAX_ATTEMPTS && !broken ? 'failed' : 'queued' };
  }
}

/** Called after a recorded pass. Queues the file and tries to deliver it now,
 * plus up to a few older queued rows. Never throws. */
export async function commitPassedTask(supabase: SupabaseClient, input: GardenPassInput): Promise<CodingGardenStatus | null> {
  if (!isGithubAppConfigured()) return null;
  const connection = await loadConnection(supabase, input.userId);
  if (!connection) return { status: 'not_connected' };
  if (!input.firstPass && !input.codeChanged) return { status: 'skipped' };
  const path = gardenPathFor(input.task);
  const content = buildTaskFile(input.task, input.code, { passed: input.passedCount, total: input.totalCount });
  const message = commitMessageFor(input.task);
  const inserted = await withTimeout(supabase.from('github_commits').insert({ user_id: input.userId, task_id: input.task.id, path, content, message }).select('id,path,content,message,attempts').single());
  if (inserted.error || !inserted.data) return { status: 'failed' };
  const row = inserted.data as QueuedRow;
  // This pass supersedes any copy of the same file still waiting: delivered
  // after this one, an older copy would put the older code back.
  await withTimeout(supabase.from('github_commits').update({ status: 'skipped', updated_at: new Date().toISOString() }).eq('user_id', input.userId).eq('path', path).eq('status', 'queued').neq('id', row.id));
  const status = await deliver(supabase, connection, row);
  // Older queued rows go out after a commit proved the connection works, and
  // the Submit waits for them. Handing this retry to the runtime after the
  // answer (#587, server item 28) was tried and undone: deliver() claims no
  // row, so a Sync pressed on the verdict, or the next pass of one of those
  // files, would then run beside a retry still writing. Two deliveries of
  // one row race on its sha and can turn a committed row back to queued,
  // and a retry that lands after a newer pass of the same file puts the
  // older code back, which the skip above exists to prevent.
  if (status.status === 'committed') await retryQueued(supabase, input.userId, 5).catch(() => undefined);
  return status;
}

/** Retries queued rows for one learner, oldest first. Of several queued
 * copies of one file only the newest is written; the older ones are skipped,
 * so a retry neither writes old code over new nor makes one commit per copy. */
export async function retryQueued(supabase: SupabaseClient, userId: string, limit = 20): Promise<{ committed: number; failed: number; remaining: number }> {
  const [connection, rows] = await Promise.all([
    loadConnection(supabase, userId),
    withTimeout(supabase.from('github_commits').select('id,path,content,message,attempts').eq('user_id', userId).eq('status', 'queued').order('created_at', { ascending: true }).limit(limit)),
  ]);
  // A queue the database would not read is not an empty queue: read as one,
  // Sync told the learner nothing was waiting while their files were.
  if (rows.error) throw new Error('db_error');
  if (!connection) return { committed: 0, failed: 0, remaining: rows.data?.length ?? 0 };
  const queued = (rows.data ?? []) as QueuedRow[];
  const newest = new Map<string, QueuedRow>();
  for (const row of queued) newest.set(row.path, row);
  const superseded = queued.filter((row) => newest.get(row.path) !== row).map((row) => row.id);
  if (superseded.length > 0) {
    await withTimeout(supabase.from('github_commits').update({ status: 'skipped', updated_at: new Date().toISOString() }).in('id', superseded));
  }
  let committed = 0;
  let failed = 0;
  for (const row of queued) {
    if (newest.get(row.path) !== row) continue;
    const status = await deliver(supabase, connection, row);
    if (status.status === 'committed' || status.status === 'skipped') committed++;
    else if (status.status === 'failed') failed++;
    else break; // still queued: the connection is broken or GitHub is down, stop hammering
  }
  const left = await withTimeout(supabase.from('github_commits').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'queued'));
  if (left.error) throw new Error('db_error');
  return { committed, failed, remaining: left.count ?? 0 };
}
