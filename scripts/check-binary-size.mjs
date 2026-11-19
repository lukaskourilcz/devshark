// Compare current files with an explicit CI base. Existing, unchanged binaries
// remain in the repository; adding, moving or changing one requires this gate.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

const LIMIT = 500_000;
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--base' || !args[1])) {
  console.error('Usage: node scripts/check-binary-size.mjs [--base <commit-ref>]');
  process.exit(2);
}
const git = (...values) => execFileSync('git', values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let base;
try {
  const supplied = args[1] || process.env.BINARY_BASE_SHA;
  const ref = supplied || git('merge-base', 'HEAD', 'origin/main').trim();
  base = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
} catch {
  console.error('Cannot resolve binary-size base. Fetch the base commit and pass --base <commit-ref>.');
  process.exit(2);
}
let paths;
try {
  paths = [...new Set([
    ...git('diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMT', base, '--').split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
  ].filter(Boolean))].sort();
} catch {
  console.error('Cannot list files for the binary-size comparison.');
  process.exit(2);
}
const oversized = [];
const decoder = new TextDecoder('utf-8', { fatal: true });
for (const file of paths) {
  const stat = lstatSync(file);
  // Git stores a symlink's path text. Do not follow it out of the checkout.
  if (!stat.isFile() || stat.size <= LIMIT) continue;
  const bytes = readFileSync(file);
  let binary = bytes.includes(0);
  if (!binary) {
    try { decoder.decode(bytes); } catch { binary = true; }
  }
  if (binary) oversized.push(`${JSON.stringify(file)}: ${stat.size} bytes`);
}
if (oversized.length) {
  console.error(`New or changed binaries exceed ${LIMIT} bytes:\n${oversized.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Binary size: ${paths.length} new/changed paths checked against ${base}; limit ${LIMIT} bytes.`);
}
