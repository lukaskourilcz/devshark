const APP_ORIGIN = 'https://devshark.invalid';

export function isSafeRedirectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/') || value.startsWith('//')
    || /[\s\\]/u.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  try {
    const path = value.split(/[?#]/u, 1)[0];
    for (const segment of path.split('/')) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || /[/\\]/u.test(decoded)) return false;
    }
    return new URL(value, APP_ORIGIN).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

export function isGithubInstallUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password
      && /^\/apps\/[a-z0-9-]+\/installations\/new$/i.test(url.pathname);
  } catch {
    return false;
  }
}
