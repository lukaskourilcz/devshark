import { describe, expect, it } from 'vitest';
import { isSafeRedirectPath, isGithubInstallUrl } from '../src/lib/safeRedirect';
import { isAuthLandingPath, isSafeReturnPath } from '../src/lib/authReturn';

describe('learner navigation', () => {
  it('allows relative app destinations and compares only the callback path', () => {
    expect(isSafeReturnPath).toBe(isSafeRedirectPath);
    expect(isSafeReturnPath('/coding/javascript?sort=date#progress')).toBe(true);
    expect(isSafeReturnPath('/learn/../account')).toBe(false);
    expect(isSafeReturnPath('https://example.org/')).toBe(false);
    expect(isAuthLandingPath('/Auth/Confirmed/?next=/coding')).toBe(true);
    expect(isAuthLandingPath('/auth/confirmed-next')).toBe(false);
  });
  it('recognizes the GitHub App installation page', () => {
    expect(isGithubInstallUrl('https://github.com/apps/devshark-garden/installations/new?state=abc')).toBe(true);
    expect(isGithubInstallUrl('https://example.org/apps/devshark-garden/installations/new')).toBe(false);
    expect(isGithubInstallUrl('https://github.com/about')).toBe(false);
  });
});
