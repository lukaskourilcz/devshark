// Checks every installed package against the security advisories its
// maintainers published in their own GitHub repository.
//
// `npm audit` reads only advisories GitHub has reviewed into its global
// database. Maintainers publish repository advisories days or weeks before
// that review, so this script reads them straight from each repository:
//
//   npm run audit:upstream
//
// It needs a GitHub token (GITHUB_TOKEN, GH_TOKEN or `gh auth token`) and
// makes one request per repository plus one per hit, about 420 in all, so CI
// does not run it. It prints each hit with its scope (prod or dev) and its
// lockfile (root or client), writes artifacts/upstream-advisories.json, and
// exits 1 when a production dependency is affected.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';

const LOCKFILES = [
  { location: 'root', dir: '.' },
  { location: 'client', dir: 'client' },
];
const CONCURRENCY = 8;
const MAX_PAGES = 10;
const API = 'https://api.github.com';

function githubToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv.trim();
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// `repository` comes as a URL, `github:owner/repo`, `owner/repo`, or an
// object with a `url`. Anything not on github.com returns null.
function githubSlug(repository) {
  const value = typeof repository === 'object' && repository ? repository.url : repository;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const url = text.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i);
  if (url) return `${url[1]}/${url[2]}`;
  const short = text.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return short ? `${short[1]}/${short[2]}` : null;
}

const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

// Maintainers type `vulnerable_version_range` by hand: ">= 7.0.0, < 7.30.2",
// "<= 7.4.23", "1.2.3, 1.2.4", "=< 5.8.1", ">=8.0.0<=8.3.0" or
// ">=3.9.0, <=3.9.9; 3.9.9 tested". Each part between semicolons that reads
// as a range counts (parts are OR'ed); inside a part a comma means AND, unless
// every item is an exact version, which makes it a list (OR). Returns null
// when no part reads as a range.
function parseVulnerableRange(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const ranges = [];
  const normalized = text.replace(/=</g, '<=').replace(/=>/g, '>=').replace(/(\d)\s*([<>])/g, '$1 $2');
  for (const part of normalized.split(';')) {
    const items = part.split(',').map(item => item.trim()).filter(Boolean);
    if (!items.length) continue;
    const candidate = items.every(item => EXACT_VERSION.test(item))
      ? items.map(item => item.replace(/^v/, '')).join(' || ')
      : items.join(' ');
    const valid = semver.validRange(candidate, { loose: true, includePrerelease: true });
    if (valid) ranges.push(valid);
  }
  return ranges.length ? ranges.join(' || ') : null;
}

// `patched_versions` lists the first fixed release of each line, such as
// "7.30.2", ">= 0.2.1" or "7.6.21, 8.6.15, 9.1.17, 10.1.10".
function parsePatchedVersions(text) {
  if (typeof text !== 'string') return [];
  return text.split(/,|;|\|\|/)
    .map(item => item.trim().replace(/^[>=\s]+/, ''))
    .map(item => semver.valid(item, { loose: true }))
    .filter(Boolean)
    .sort(semver.compare);
}

const releaseLine = version => (semver.major(version) > 0 ? `${semver.major(version)}` : `0.${semver.minor(version)}`);

// A version counts as fixed when it is at or above the patched release of its
// own line, or at or above the newest patched release listed. That keeps a
// sloppy range such as ">7.0.0" from flagging storybook 10.6.6 when 10.1.10
// is the fix for its line.
function isPatched(version, patched) {
  if (!patched.length) return false;
  if (semver.gte(version, patched[patched.length - 1])) return true;
  return patched.some(fixed => releaseLine(fixed) === releaseLine(version) && semver.gte(version, fixed));
}

// A range written as prose ("All versions with vulnerable path construction")
// needs a human only when the installed version is below every listed fix.
function isAffected(version, vulnerability) {
  const patched = isPatched(version, parsePatchedVersions(vulnerability.patched_versions));
  const range = parseVulnerableRange(vulnerability.vulnerable_version_range);
  if (!range) return { affected: false, unparsed: !patched };
  if (!semver.satisfies(version, range, { loose: true, includePrerelease: true })) return { affected: false, unparsed: false };
  return { affected: !patched, unparsed: false };
}

function readInstalled() {
  const installed = [];
  let notInstalled = 0;
  let noRepository = 0;
  for (const { location, dir } of LOCKFILES) {
    const lock = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    for (const [key, entry] of Object.entries(lock.packages || {})) {
      if (!key.includes('node_modules/') || entry.link || !entry.version) continue;
      const manifestPath = path.join(dir, key, 'package.json');
      if (!existsSync(manifestPath)) { notInstalled += 1; continue; }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const slug = githubSlug(manifest.repository);
      if (!slug) { noRepository += 1; continue; }
      installed.push({
        name: (entry.name || key.split('node_modules/').pop()).toLowerCase(),
        version: entry.version,
        scope: entry.dev ? 'dev' : 'prod',
        location,
        slug,
      });
    }
  }
  return { installed, notInstalled, noRepository };
}

async function request(token, url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'devshark-audit-upstream',
      },
    });
    const limited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    if ((limited || response.status >= 500) && attempt < 3) {
      const wait = Number(response.headers.get('retry-after')) || 2 ** attempt * 5;
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
      continue;
    }
    return response;
  }
}

const nextLink = header => header?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;

async function repositoryAdvisories(token, slug) {
  const advisories = [];
  let url = `${API}/repos/${slug}/security-advisories?state=published&per_page=100`;
  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const response = await request(token, url);
    if (response.status === 401) throw new Error('GitHub refused the token (401). Set GITHUB_TOKEN or run `gh auth login`.');
    if (!response.ok) return { advisories, error: `HTTP ${response.status}` };
    advisories.push(...await response.json());
    url = nextLink(response.headers.get('link'));
  }
  return { advisories, error: null };
}

async function globalAdvisory(token, ghsa) {
  const response = await request(token, `${API}/advisories/${ghsa}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET /advisories/${ghsa} answered HTTP ${response.status}`);
  return response.json();
}

async function inPool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function main() {
  const token = githubToken();
  if (!token) {
    console.error('audit:upstream needs a GitHub token: set GITHUB_TOKEN or run `gh auth login`.');
    process.exit(2);
  }
  const { installed, notInstalled, noRepository } = readInstalled();
  const byName = new Map();
  for (const item of installed) {
    if (!byName.has(item.name)) byName.set(item.name, []);
    byName.get(item.name).push(item);
  }
  const slugs = [...new Map(installed.map(item => [item.slug.toLowerCase(), item.slug])).values()].sort();
  const fetched = await inPool(slugs, async slug => ({ slug, ...await repositoryAdvisories(token, slug) }));

  const unreachable = fetched.filter(result => result.error).map(result => `${result.slug} (${result.error})`);
  const unparsed = [];
  const withdrawn = new Set();
  const candidates = new Map();
  for (const { slug, advisories } of fetched) {
    for (const advisory of advisories) {
      for (const vulnerability of advisory.vulnerabilities || []) {
        const pkg = vulnerability.package || {};
        if (pkg.ecosystem && pkg.ecosystem !== 'npm') continue;
        const matches = byName.get(String(pkg.name || '').toLowerCase()) || [];
        for (const item of matches) {
          const { affected, unparsed: unreadable } = isAffected(item.version, vulnerability);
          if (unreadable) {
            unparsed.push(`${advisory.ghsa_id} ${pkg.name} "${vulnerability.vulnerable_version_range}" (${slug})`);
            continue;
          }
          if (!affected) continue;
          if (advisory.withdrawn_at) { withdrawn.add(advisory.ghsa_id); continue; }
          const key = `${advisory.ghsa_id} ${item.name}@${item.version} ${item.location}`;
          const known = candidates.get(key);
          if (known) { if (item.scope === 'prod') known.scope = 'prod'; continue; }
          candidates.set(key, {
            ghsa: advisory.ghsa_id,
            severity: advisory.severity || 'unknown',
            summary: advisory.summary,
            publishedAt: advisory.published_at,
            url: advisory.html_url,
            repository: slug,
            package: item.name,
            version: item.version,
            scope: item.scope,
            location: item.location,
            vulnerableRange: vulnerability.vulnerable_version_range,
            patchedVersions: vulnerability.patched_versions,
          });
        }
      }
    }
  }

  // A withdrawn global entry overrides a repository entry that still reads as
  // published. esbuild's GHSA-gv7w-rqvm-qjhr is one: withdrawn globally on
  // 17 June 2026, published in the repository (for the deno ecosystem, which
  // the npm filter above already skips).
  const ids = [...new Set([...candidates.values()].map(hit => hit.ghsa))];
  const globals = new Map(await inPool(ids, async ghsa => [ghsa, await globalAdvisory(token, ghsa)]));
  const hits = [];
  for (const hit of candidates.values()) {
    const global = globals.get(hit.ghsa);
    if (global?.withdrawn_at) { withdrawn.add(hit.ghsa); continue; }
    hits.push({ ...hit, reviewed: global?.type === 'reviewed' ? 'reviewed' : 'unreviewed' });
  }
  const order = { critical: 0, high: 1, medium: 2, moderate: 2, low: 3, unknown: 4 };
  hits.sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4) || a.package.localeCompare(b.package) || a.ghsa.localeCompare(b.ghsa) || a.location.localeCompare(b.location));

  for (const hit of hits) {
    console.log(`${hit.ghsa}  ${hit.severity.padEnd(8)}  ${`${hit.package}@${hit.version}`.padEnd(34)}  ${hit.scope.padEnd(4)}  ${hit.location.padEnd(6)}  ${hit.reviewed.padEnd(10)}  vulnerable ${hit.vulnerableRange}; patched ${hit.patchedVersions ?? 'none'}`);
  }
  const advisoryCount = new Set(hits.map(hit => hit.ghsa)).size;
  const production = hits.filter(hit => hit.scope === 'prod');
  const scanned = new Set(installed.map(item => `${item.location} ${item.name}@${item.version}`)).size;
  console.log(`\n${advisoryCount} advisories match ${hits.length} installed package versions (${production.length} production).`);
  console.log(`Scanned ${scanned} package versions in ${slugs.length} repositories; not scanned: ${noRepository} lockfile entries without a GitHub repository, ${notInstalled} not installed on this platform.`);
  if (withdrawn.size) console.log(`Ignored withdrawn advisories: ${[...withdrawn].sort().join(', ')}.`);
  if (unreachable.length) console.log(`Could not read advisories of ${unreachable.length} repositories: ${unreachable.join(', ')}.`);
  if (unparsed.length) console.log(`Read these ranges by hand, the script could not parse them:\n  ${[...new Set(unparsed)].join('\n  ')}`);

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/upstream-advisories.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    scanned: { packageVersions: scanned, repositories: slugs.length },
    notScanned: { withoutGithubRepository: noRepository, notInstalled, unreachableRepositories: unreachable },
    withdrawn: [...withdrawn].sort(),
    unparsedRanges: [...new Set(unparsed)],
    hits,
  }, null, 2) + '\n');
  if (production.length) process.exitCode = 1;
}

await main();
