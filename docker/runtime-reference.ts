// Executed inside each measured image, using its installed runtime packages
// and generated worker bundles. This is local container QA, never a live API.
import assert from 'node:assert/strict';
import { CODING_TASKS } from '../lib/coding/catalog';
import { solutionFor } from '../lib/coding/solutions';
import { runChecks } from '../lib/coding/sandbox';
import { checkTypes } from '../lib/coding/ts-check-pool';
import { runReactSuite } from '../lib/coding/react-runner';
import { withHiddenCases } from '../lib/coding/react-hidden';
import { allPassed } from '../shared/coding-evaluate';
import { typesPassed } from '../shared/coding-ts-check';
import { runtimePolicyForTask } from '../shared/coding-task-runtime';

async function main() {
for (const track of ['javascript', 'typescript', 'react'] as const) {
  const task = CODING_TASKS.find((one) => one.track === track && one.verify === 'tests' && solutionFor(one.id));
  assert.ok(task, `Missing ${track} reference task`);
  const solution = solutionFor(task.id)!;
  if (track === 'react') {
    const result = await runReactSuite({ appSource: solution.solution, suite: withHiddenCases(task.suite!, solution.hiddenSuite) });
    assert.equal(result.compileError, null); assert.ok(result.total > 0); assert.equal(result.failed, 0, JSON.stringify(result));
  } else {
    let code = solution.solution;
    if (track === 'typescript') {
      const types = await checkTypes(code, [task.typeTests ?? [], solution.hiddenTypeTests ?? []]);
      assert.ok(!types.stopped && types.results.every(typesPassed), JSON.stringify(types));
      assert.ok(types.javascript); code = types.javascript;
    }
    const result = await runChecks({ code, visible: task.tests ?? [], hidden: solution.hiddenTests ?? [], runtimePolicy: runtimePolicyForTask(task.id), shuffle: (list) => [...list].reverse() });
    assert.ok(allPassed(result.visible)); assert.ok(result.hidden && allPassed(result.hidden));
  }
  console.log(`PASS container reference: ${task.id} (${track}), visible and hidden checks`);
}
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
