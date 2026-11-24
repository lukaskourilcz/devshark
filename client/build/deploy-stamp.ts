/** The commit a build is released as, for Sentry's `release` (F15, #644).
 *
 * Vercel sets `VERCEL_GIT_COMMIT_SHA` only for Git-triggered builds. A
 * `vercel deploy --prod` from a checkout builds without it, so production
 * `dpl_vPPHKGead2nYnwHhp6csEig2B3i3` (24 November 2026) shipped with no
 * release. Such a release passes the commit itself:
 * `vercel deploy --prod --build-env DEPLOY_COMMIT_SHA=$(git rev-parse HEAD)`.
 * Only a full 40-character SHA counts; anything else leaves the release
 * unset rather than tagging events with a wrong one. */
export function deployRelease(env: Record<string, string | undefined>): string {
  for (const value of [env.VERCEL_GIT_COMMIT_SHA, env.DEPLOY_COMMIT_SHA]) {
    if (/^[a-f0-9]{40}$/i.test(value ?? '')) return value!.toLowerCase();
  }
  return '';
}

/** The Vercel environment the build targets, or '' outside Vercel. */
export function deployEnvironment(env: Record<string, string | undefined>): string {
  return ['development', 'preview', 'production'].includes(env.VERCEL_ENV ?? '') ? env.VERCEL_ENV! : '';
}
