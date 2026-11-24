import { describe, expect, it } from 'vitest';
import { deployEnvironment, deployRelease } from '../build/deploy-stamp';

const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('deployRelease', () => {
  it('takes the Git commit Vercel sets for a Git-triggered build', () => {
    expect(deployRelease({ VERCEL_GIT_COMMIT_SHA: sha, DEPLOY_COMMIT_SHA: 'f'.repeat(40) })).toBe(sha);
  });

  it('takes the commit a CLI release passes when Vercel has no Git commit', () => {
    expect(deployRelease({ DEPLOY_COMMIT_SHA: sha.toUpperCase() })).toBe(sha);
    expect(deployRelease({ VERCEL_GIT_COMMIT_SHA: '', DEPLOY_COMMIT_SHA: sha })).toBe(sha);
  });

  it('leaves the release unset for anything but a full SHA', () => {
    expect(deployRelease({})).toBe('');
    expect(deployRelease({ DEPLOY_COMMIT_SHA: sha.slice(0, 8) })).toBe('');
    expect(deployRelease({ DEPLOY_COMMIT_SHA: `${sha}\n` })).toBe('');
    expect(deployRelease({ VERCEL_GIT_COMMIT_SHA: 'main' })).toBe('');
  });
});

describe('deployEnvironment', () => {
  it('keeps only the three Vercel environments', () => {
    expect(deployEnvironment({ VERCEL_ENV: 'production' })).toBe('production');
    expect(deployEnvironment({ VERCEL_ENV: 'preview' })).toBe('preview');
    expect(deployEnvironment({ VERCEL_ENV: 'staging' })).toBe('');
    expect(deployEnvironment({})).toBe('');
  });
});
