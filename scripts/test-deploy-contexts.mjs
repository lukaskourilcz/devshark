import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Exercise parent-directory traversal with Git's ignore engine. The F14
// acceptance also checks Vercel CLI's actual dry/upload inventories and a real
// Docker build; these focused contracts do not replace those platform checks.
const required = ['docs/brand/source/approved/navbar-logo-ink.svg', 'docs/brand/source/v9/recommended/devshark-fin-wave-green.svg'];
const denied = ['docs/release-acceptance.md', 'docs/brand/source/approved/unused.svg', 'docs/brand/source/v9/recommended/unused.svg', 'docs/audit/private.json', 'media/demo.mp4', 'bruno/auth.bru', 'design/reference.svg', 'triage/notes.json', 'tests/browser/public.spec.ts', 'client/tests/app.test.tsx'];
const inputs = [...required, ...denied, 'docker/runtime-reference.ts', 'docker/install-runtime-typescript.mjs', 'docker/server.mjs', 'Dockerfile', 'packages/coding-evaluator/test/evaluate.mjs', 'package.json', 'client/package.json', 'client/src/main.tsx', 'client/public/icons/favicon.svg', 'lib/data/admin-triage.json', 'scripts/build-react-runner.mjs'];

for (const context of ['.vercelignore', '.dockerignore']) {
  test(`${context} excludes non-build sources and retains both full SVG parent chains`, () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'devshark-context-'));
    try {
      execFileSync('git', ['init', '-q', temporary]);
      const rules = path.join(temporary, 'context.ignore'); writeFileSync(rules, readFileSync(context));
      const result = spawnSync('git', ['-c', `core.excludesFile=${rules}`, 'check-ignore', '--no-index', '--stdin', '-z'], { cwd: temporary, input: inputs.join('\0') + '\0', encoding: 'utf8' });
      assert.ok(result.status === 0 || result.status === 1, result.stderr);
      const ignored = new Set(result.stdout.split('\0').filter(Boolean));
      const specificDenied = context === '.vercelignore' ? ['docker/runtime-reference.ts', 'docker/install-runtime-typescript.mjs', 'docker/server.mjs', 'Dockerfile', 'packages/coding-evaluator/test/evaluate.mjs'] : ['docker/runtime-reference.ts', 'packages/coding-evaluator/test/evaluate.mjs'];
      for (const file of [...denied, ...specificDenied]) assert.ok(ignored.has(file), `${context} uploads ${file}`);
      for (const file of inputs.filter((one) => !denied.includes(one) && !specificDenied.includes(one))) assert.ok(!ignored.has(file), `${context} excludes required build input ${file}`);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
}
