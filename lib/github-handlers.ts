/** GitHub garden operations on `api/user/[op].ts`: connect, pick a
 * repository, read status, retry queued commits, disconnect. All require a
 * signed-in learner and the devShark product scope. */

import type { VercelRequest, VercelResponse } from './vercel-types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonError, requireAuthSub, withTimeout, createLogger, ServiceUnavailableError } from './http';
import { enforceRateLimit, RATE_LIMITS, type RateLimitConfig } from './rate-limit';
import { deploymentSubjectIds } from './product-scope';
import { decodeGithubConnectState, encodeGithubConnectState } from './quiz-tokens';
import {
  GithubError,
  checkInstallationOwner,
  getInstallation,
  githubAppSlug,
  installationToken,
  isGithubAppConfigured,
  listInstallationRepos,
  retryQueued,
  type RepoInfo,
} from './github-app';
import type { GithubConnectionResponse, GithubConnectStartResponse, GithubSyncResponse } from '../shared/coding-api';

const logEvent = createLogger('github');

interface ConnectionRow {
  installation_id: number;
  account_login: string;
  account_id: number;
  repo_full_name: string | null;
  default_branch: string | null;
  status: 'pending_repo' | 'active' | 'broken';
  last_error: string | null;
  last_commit_at: string | null;
}
const FIELDS = 'installation_id,account_login,account_id,repo_full_name,default_branch,status,last_error,last_commit_at';

const unavailable = (): GithubConnectionResponse => ({
  available: false, status: 'not_connected', accountLogin: null, repoFullName: null, defaultBranch: null, lastCommitAt: null, queued: 0, lastError: null,
});

async function readConnection(supabase: SupabaseClient, userId: string): Promise<ConnectionRow | null> {
  const { data, error } = await withTimeout(supabase.from('github_connections').select(FIELDS).eq('user_id', userId).maybeSingle());
  if (error) throw new Error('db_error');
  return (data as ConnectionRow | null) ?? null;
}

async function queuedCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await withTimeout(supabase.from('github_commits').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'queued'));
  // Unread is not "nothing waiting": the card would hide files still queued.
  if (error) throw new Error('db_error');
  return count ?? 0;
}

function describe(row: ConnectionRow | null, queued: number, repositories?: RepoInfo[]): GithubConnectionResponse {
  if (!row) return { ...unavailable(), available: true };
  return {
    available: true,
    status: row.status,
    accountLogin: row.account_login,
    repoFullName: row.repo_full_name,
    defaultBranch: row.default_branch,
    lastCommitAt: row.last_commit_at,
    queued,
    lastError: row.last_error,
    ...(repositories ? { repositories: repositories.map((repo) => ({ fullName: repo.full_name, defaultBranch: repo.default_branch, private: repo.private, fork: repo.fork })) } : {}),
  };
}

function installationTaken(res: VercelResponse) {
  logEvent({ status: 409, kind: 'installation_taken' });
  return jsonError(res, 409, 'installation_taken', 'Another devShark account is already connected to this GitHub installation');
}

/** Two tiers: an address backstop that holds a class connecting behind one
 * NAT, then the learner's own bucket, so one learner's retries never use up
 * a classmate's. */
async function withinLimits(
  req: VercelRequest,
  res: VercelResponse,
  address: RateLimitConfig,
  perUser: RateLimitConfig,
  userId: string,
): Promise<boolean> {
  return (await enforceRateLimit(req, res, address)) && enforceRateLimit(req, res, perUser, `user:${userId}`);
}

function gate(req: VercelRequest, res: VercelResponse): boolean {
  if (!deploymentSubjectIds().includes('webdev')) {
    jsonError(res, 404, 'not_available', 'The GitHub garden is not part of this product');
    return false;
  }
  return true;
}

export async function handleGithub(op: string, req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  if (!gate(req, res)) return;
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!isGithubAppConfigured()) {
    if (op === 'github-connection' && req.method === 'GET') return res.json(unavailable());
    return jsonError(res, 503, 'not_configured', 'The GitHub garden is not configured');
  }

  try {
    if (op === 'github-connection') {
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return jsonError(res, 405, 'method_not_allowed', 'Method not allowed'); }
      const row = await readConnection(supabase, userId);
      // The queue count and the repository picker do not wait for each other.
      const [queued, repositories] = await Promise.all([
        row ? queuedCount(supabase, userId) : 0,
        row && row.status === 'pending_repo'
          ? installationToken(row.installation_id)
            .then(listInstallationRepos)
            .then((repos) => repos.filter((repo) => !repo.fork && repo.owner.id === row.account_id))
            .catch((): RepoInfo[] => [])
          : undefined,
      ]);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json(describe(row, queued, repositories));
    }

    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return jsonError(res, 405, 'method_not_allowed', 'Method not allowed'); }

    if (op === 'github-connect-start') {
      if (!(await withinLimits(req, res, RATE_LIMITS.githubConnectAddress, RATE_LIMITS.githubConnect, userId))) return;
      const state = encodeGithubConnectState(userId);
      const out: GithubConnectStartResponse = { url: `https://github.com/apps/${encodeURIComponent(githubAppSlug())}/installations/new?state=${encodeURIComponent(state)}` };
      return res.json(out);
    }

    if (op === 'github-connect-finish') {
      if (!(await withinLimits(req, res, RATE_LIMITS.githubConnectAddress, RATE_LIMITS.githubConnect, userId))) return;
      const body = (req.body || {}) as { installationId?: unknown; state?: unknown; code?: unknown };
      const installationId = Number(body.installationId);
      if (!Number.isInteger(installationId) || installationId <= 0 || typeof body.state !== 'string') return jsonError(res, 400, 'bad_request', 'installationId and state are required');
      const state = decodeGithubConnectState(body.state);
      if (!state || state.userId !== userId) return jsonError(res, 400, 'invalid_state', 'The connection request expired. Start again from your profile.');
      // The state proves which devShark account started the connect; only the
      // authorization code proves which GitHub user finished it. Without it an
      // account could name any installation of the app, someone else's too.
      if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(body.code)) {
        return jsonError(res, 400, 'authorization_missing', 'GitHub did not send an authorization. Connect again from your profile and approve the request GitHub shows.');
      }
      const owner = await checkInstallationOwner(body.code, installationId);
      if (!owner.ok && owner.reason === 'code_refused') {
        logEvent({ status: 403, kind: 'authorization_refused', reason: owner.detail });
        return jsonError(res, 403, 'authorization_failed', 'GitHub did not confirm the authorization. Connect again from your profile.');
      }
      // Listed is not enough: a collaborator on the owner's repository sees the
      // installation too. The installation's account must be the GitHub user
      // who authorized.
      const installation = owner.ok ? await getInstallation(installationId) : null;
      if (installation && installation.account.type !== 'User') return jsonError(res, 400, 'organisation_not_supported', 'Install the app on your own account, not an organisation');
      if (!owner.ok || !installation || installation.account.id !== owner.githubUserId) {
        logEvent({ status: 403, kind: 'installation_not_owned', listed: owner.ok });
        return jsonError(res, 403, 'installation_not_yours', 'This installation is not on the GitHub account that authorized the app');
      }
      const holder = await withTimeout(supabase.from('github_connections').select('user_id').eq('installation_id', installationId).neq('user_id', userId).limit(1).maybeSingle());
      if (holder.error) return jsonError(res, 500, 'db_error', 'Could not check the installation');
      if (holder.data) return installationTaken(res);
      const repos = (await listInstallationRepos(await installationToken(installationId))).filter((repo) => !repo.fork && repo.owner.id === installation.account.id);
      const single = repos.length === 1 ? repos[0] : null;
      const upsert = await withTimeout(supabase.from('github_connections').upsert({
        user_id: userId,
        installation_id: installationId,
        account_login: installation.account.login,
        account_id: installation.account.id,
        repo_full_name: single?.full_name ?? null,
        default_branch: single?.default_branch ?? null,
        status: single ? 'active' : 'pending_repo',
        last_error: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }));
      // Two accounts finishing at once: the unique index of migration 050
      // lets only one of them in.
      if (upsert.error?.code === '23505') return installationTaken(res);
      if (upsert.error) return jsonError(res, 500, 'db_error', 'Could not save the connection');
      logEvent({ status: 200, kind: 'connected', repos: repos.length });
      const row = await readConnection(supabase, userId);
      return res.json(describe(row, 0, single ? undefined : repos));
    }

    if (op === 'github-repo') {
      if (!(await withinLimits(req, res, RATE_LIMITS.githubRepoAddress, RATE_LIMITS.githubRepo, userId))) return;
      const body = (req.body || {}) as { repoFullName?: unknown };
      if (typeof body.repoFullName !== 'string' || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(body.repoFullName)) return jsonError(res, 400, 'bad_request', 'repoFullName is required');
      const row = await readConnection(supabase, userId);
      if (!row) return jsonError(res, 409, 'not_connected', 'Connect GitHub first');
      const repos = await listInstallationRepos(await installationToken(row.installation_id));
      const chosen = repos.find((repo) => repo.full_name === body.repoFullName);
      if (!chosen || chosen.fork || chosen.owner.id !== row.account_id) return jsonError(res, 400, 'bad_repo', 'Pick a repository you own that the app is installed on');
      // GitHub may answer after a reconnect. Apply the choice only to the
      // installation whose repository list the learner was working with.
      const update = await withTimeout(supabase.from('github_connections').update({ repo_full_name: chosen.full_name, default_branch: chosen.default_branch, status: 'active', last_error: null, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('installation_id', row.installation_id).select('installation_id').maybeSingle());
      if (update.error) return jsonError(res, 500, 'db_error', 'Could not save the repository');
      if (!update.data) return jsonError(res, 409, 'connection_changed', 'Your GitHub connection changed. Choose a repository again.');
      return res.json(describe(await readConnection(supabase, userId), await queuedCount(supabase, userId)));
    }

    if (op === 'github-sync') {
      if (!(await withinLimits(req, res, RATE_LIMITS.githubSyncAddress, RATE_LIMITS.githubSync, userId))) return;
      const row = await readConnection(supabase, userId);
      if (!row) return jsonError(res, 409, 'not_connected', 'Connect GitHub first');
      if (row.status === 'broken') {
        // A reinstall may have fixed it: probe the installation before retrying.
        try {
          await getInstallation(row.installation_id);
          await withTimeout(supabase.from('github_connections').update({ status: row.repo_full_name ? 'active' : 'pending_repo', last_error: null, updated_at: new Date().toISOString() }).eq('user_id', userId));
        } catch (error) {
          if (error instanceof GithubError) return res.json({ committed: 0, failed: 0, remaining: await queuedCount(supabase, userId) } satisfies GithubSyncResponse);
          throw error;
        }
      }
      const out: GithubSyncResponse = await retryQueued(supabase, userId, 20);
      return res.json(out);
    }

    if (op === 'github-disconnect') {
      // The connection first: a disconnect that failed leaves the learner
      // connected, and must leave their queued files with them. The queue
      // goes after it, and a failure there answers 500 so the retry removes it
      // before a later connection could write those files to another repository.
      const deleted = await withTimeout(supabase.from('github_connections').delete().eq('user_id', userId));
      if (deleted.error) return jsonError(res, 500, 'db_error', 'Could not disconnect');
      const dropped = await withTimeout(supabase.from('github_commits').delete().eq('user_id', userId));
      if (dropped.error) return jsonError(res, 500, 'db_error', 'Could not disconnect');
      logEvent({ status: 200, kind: 'disconnected' });
      return res.json({ ok: true });
    }

    return jsonError(res, 404, 'unknown_op', `Unknown user op: ${op}`);
  } catch (error) {
    // A Supabase or GitHub call that did not answer in time (lib/http.ts
    // `UpstreamTimeoutError`) is the service busy for a moment: 503, which the
    // client may retry. Not on connect-finish: by then GitHub may have spent
    // the one-time code, and the callback page sends the same code again
    // after a 503, so that op keeps answering a failure the code cannot fix.
    if (error instanceof ServiceUnavailableError && op !== 'github-connect-finish') {
      logEvent({ status: 503, kind: 'unavailable', op, code: error.code });
      return jsonError(res, 503, error.code, error.message);
    }
    if (error instanceof GithubError) {
      logEvent({ status: error.status, kind: 'github_error', op });
      return jsonError(res, 502, 'github_error', 'GitHub did not accept the request. Try again in a moment.');
    }
    logEvent({ status: 500, kind: 'error', op, category: error instanceof Error ? error.name : 'unknown' });
    return jsonError(res, 500, 'internal_error', 'Could not handle the GitHub request');
  }
}
