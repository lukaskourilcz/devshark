// Opt-in, bounded deployment smoke test. Anonymous submissions cannot award XP.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadPreviewAccess } from './cold-start-preview-access.mjs';
import { solutionFor } from '../lib/coding/solutions';

const origin = process.env.SMOKE_BASE_URL;
assert(origin, 'Set SMOKE_BASE_URL to the authorized deployment');
const base = new URL(origin).origin;
assert(origin === base || origin === `${base}/`, 'SMOKE_BASE_URL must be a bare deployment origin');
const state = process.env.SMOKE_PREVIEW_STATE;
const access = state ? loadPreviewAccess(base, state) : null;
const reportFile = 'artifacts/grading-load.json';
mkdirSync('artifacts', {recursive:true});
access?.assertOutputAllowed(reportFile);
function request(path: string, init: RequestInit = {}) {
  const url = new URL(path, base);
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(access?.headersFor(url) ?? {})) headers.set(name, String(value));
  return fetch(url, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(50_000) });
}
const samples: Array<{ id: string; ms: number; status: number; passed: boolean }> = [];
const ids = ['react-evolving-form-1-start', 'react-evolving-board-1-start', 'react-evolving-catalog-1-start'];
async function run(id: string) {
  const response = await request(`/api/quiz/roadmap?resource=coding-task&id=${id}`);
  assert.equal(response.status, 200);
  const task = await response.json();
  assert(task.session, `${id}: no anonymous session`);
  const code = solutionFor(id)?.solution;
  assert(code, `${id}: no reference solution`);
  const start = performance.now();
  const graded = await request('/api/quiz/roadmap?resource=coding-submit', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({session:task.session,code,runCount:1,hintsUsed:0,durationMs:1}),
  });
  const result = graded.ok ? await graded.json() : {};
  const sample = {id,ms:Math.round(performance.now()-start),status:graded.status,passed:result.verdict==='passed'};
  samples.push(sample);
  assert.equal(graded.status,200,JSON.stringify(sample));
  assert(sample.passed,JSON.stringify(sample));
  assert.equal(result.xpAwarded,0);assert.equal(result.applied,false);
}
try {
  // One cold observation, followed by three bounded batches at concurrency 3.
  await run(ids[0]);
  for(let batch=0;batch<3;batch++) {
    const results=await Promise.allSettled(ids.map(run));
    for(const result of results) if(result.status==='rejected') throw result.reason;
  }
} finally {
  const times=samples.map(s=>s.ms).sort((a,b)=>a-b);
  const result={timestamp:new Date().toISOString(),base,concurrency:3,samples,
    p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)};
  const json = JSON.stringify(result,null,2);
  if (access) {
    try { access.writeReport(reportFile,json); } finally { access.dispose(); }
  } else {
    writeFileSync(reportFile,json);
  }
  console.log(JSON.stringify(result));
}
