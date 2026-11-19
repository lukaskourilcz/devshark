import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { reviewUnused } from './unused-policy.mjs';
const run = spawnSync(process.execPath, ['node_modules/knip/bin/knip.js', '--reporter', 'json', '--no-config-hints', '--include', 'files,dependencies,unlisted,unresolved,exports'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (run.error) throw run.error;
if (/ERROR:/.test(run.stderr)) throw new Error(run.stderr);
let report;
try { report = JSON.parse(run.stdout); } catch { throw new Error(`Knip could not produce a report: ${run.stderr}`); }
if (run.status !== 0 && run.status !== 1) throw new Error(run.stderr);
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/unused.json', JSON.stringify(report, null, 2) + '\n');
const baseline = JSON.parse(readFileSync('docs/quality/unused-baseline.json', 'utf8'));
const { added, stale, existing, advisoryExports } = reviewUnused(report, baseline);
if (added.length) console.error('New unused-code findings require review:\n' + added.join('\n'));
if (stale.length) console.error('Stale unused-code baseline entries must be removed:\n' + stale.join('\n'));
if (added.length || stale.length) process.exitCode = 1;
else console.log(`Knip: no new findings or stale entries; ${existing} reviewed findings remain. ${advisoryExports} exports outside lib/shared remain advisory in artifacts/unused.json.`);
