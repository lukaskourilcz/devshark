// Path grading authority (npm run test:path-authority).
//
// The probes below were written against the DSA Foundations path's harnesses.
// E5 (#496) retired that path, so they now grade the private fixtures in
// scripts/fixtures/path-authority-fixtures.ts (the same code, references and
// hidden assertions, copied verbatim) through gradePathCodeWith, the body of
// the production gradePathCode: the same protected harness, shuffled hidden
// run and critical-criterion fold. The published FDE path is graded too, so
// the live entry point stays under test.
import assert from 'node:assert/strict';
import { pathById } from '../lib/learning-paths/catalog';
import { gradePathCode, gradePathCodeWith } from '../lib/learning-paths/grade';
import { solutionFor } from '../lib/learning-paths/solutions';
import { PATH_AUTHORITY_FIXTURES, type PathAuthorityFixtureId } from './fixtures/path-authority-fixtures';
import type { MergedCallTest, MergedCode } from '../lib/learning-paths/types';
import { GraderBusyError } from '../lib/coding/grader-capacity';
import { protectedPathHarness } from '../lib/learning-paths/harness';
import { runChecks } from '../lib/coding/sandbox';
import { allPassed } from '../shared/coding-evaluate';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';

await buildSandboxWorker();
// F11-35: the shared path grading body preserves the same capacity error.
{
  const code: MergedCode = { language: 'react', prompt: '', starter: '', hints: [], tests: [], typeTests: [], criteria: [], suite: '' };
  const busy = new GraderBusyError('react_compile_queue_full', 7);
  await assert.rejects(gradePathCodeWith(code, undefined, 'unused trusted source', async () => { throw busy; }), error => error === busy);
  console.log('PASS path authority: a busy React compiler preserves the capacity error for the existing 503/Retry-After handler');
}

const gradeFixture = (id: PathAuthorityFixtureId, source: string, extra: MergedCallTest[] = []) => {
  const fixture = PATH_AUTHORITY_FIXTURES[id];
  return gradePathCodeWith({ ...fixture.code, tests: [...fixture.code.tests, ...extra] }, fixture.solution, source);
};
const check = async (id: PathAuthorityFixtureId, source: string, passed: boolean, label: string) => {
  const result = await gradeFixture(id, source);
  assert.equal(result.state === 'verified_pass', passed, label);
  console.log(`PASS path authority: ${label}`);
};

// Every fixture's own reference passes, so a refusal below is the probe's
// doing and not a broken fixture.
for (const [id, fixture] of Object.entries(PATH_AUTHORITY_FIXTURES) as [PathAuthorityFixtureId, (typeof PATH_AUTHORITY_FIXTURES)[PathAuthorityFixtureId]][]) {
  assert.ok(fixture.code.harness, `${id}: an authority fixture carries a harness`);
  await check(id, fixture.solution.solution, true, `${id}: the fixture reference passes`);
}

// The published path goes through the same body: its reference passes and a
// blank submission does not.
const fde = pathById('fde')!;
const real = fde.modules.flatMap(module => module.activities)
  .find(activity => activity.kind === 'code' && activity.code?.language === 'javascript' && activity.code.harness && !activity.reuseTaskId)!;
assert.ok(real, 'the FDE path publishes a JavaScript exercise with a harness');
assert.equal((await gradePathCode(real, real.code!, solutionFor(real.id)!.solution)).state, 'verified_pass', `${real.id}: the published reference passes`);
assert.notEqual((await gradePathCode(real, real.code!, '')).state, 'verified_pass', `${real.id}: a blank submission does not pass`);
console.log(`PASS path authority: published ${real.id} grades through the protected harness`);

// This candidate passed the old appended harness: warm up with a linear
// call, replace the read helper, then perform quadratic input traversals.
const forgedReads = `let firstCall=true;
function maxGap(values){
  __countReads=(input,run)=>({result:run(input),reads:0});
  if(values.length<2)return 0;
  if(firstCall){firstCall=false;let low=values[0],high=low;
    for(const v of values){low=Math.min(low,v);high=Math.max(high,v);}return high-low;}
  let best=0;for(const a of values)for(const b of values)best=Math.max(best,Math.abs(a-b));return best;
}`;
for (let attempt = 0; attempt < 5; attempt++) {
  await check('max-gap', forgedReads, false, `read-helper replacement rejected, shuffle ${attempt + 1}`);
}
await check('max-gap', `var __countReads=()=>({reads:0,result:8});
function maxGap(values){let best=0;for(const a of values)for(const b of values)best=Math.max(best,Math.abs(a-b));return best;}`, false, 'same-named helper declaration rejected');
await check('max-gap', `var Proxy=function(values){return values;};
function maxGap(values){let best=0;for(const a of values)for(const b of values)best=Math.max(best,Math.abs(a-b));return best;}`, false, 'learner Proxy replacement cannot bypass input reads');
await check('max-gap', `globalThis.Proxy=function(values){return values;};
function maxGap(values){let best=0;for(const a of values)for(const b of values)best=Math.max(best,Math.abs(a-b));return best;}`, false, 'global Proxy replacement cannot bypass input reads');
await check('max-gap', `RegExp.prototype.test=()=>false;
function maxGap(values){let best=0;for(const a of values)for(const b of values)best=Math.max(best,Math.abs(a-b));return best;}`, false, 'prototype replacement cannot disable captured index detection');
await check('max-gap', `function maxGap(values){if(values.length<2)return 0;
let low=values[0],high=low;for(let i=1;i<values.length;i++){const v=values[i];low=Math.min(low,v);high=Math.max(high,v);}return high-low;}`, true, 'independent valid min/max loop accepted');

await check('recursive-sum', `var __sumCalls=0;
function sumList(head){let total=0,count=0;for(let node=head;node;node=node.next){total+=node.value;count++;}__sumCalls=count+1;return total;}`, false, 'shadow counter cannot make iteration look recursive');
await check('recursive-sum', `function sumList(head){return head===null?0:head.value+sumList(head.next);}`, true, 'valid recursive declaration accepted');

await check('counted-queue', `var __bufferOps=0;
const createQueue=()=>{const items=newQueueBuffer();let length=0;return {
enqueue(value){items.push(value);length++;},
dequeue(){if(!length)return null;const value=items[0];for(let i=1;i<length;i++)items[i-1]=items[i];length--;__bufferOps=0;return value;},
size(){return length;}};};`, false, 'shadow queue counter cannot hide element movement');
await check('counted-queue', `function createQueue(){const items=newQueueBuffer();let front=0;
return {enqueue(value){items.push(value);},dequeue(){if(front===items.length)return null;const result=items[front];items[front++]=null;return result;},size(){return items.length-front;}};}`, true, 'independent valid head-index queue accepted');

// Fixture objects exported to a trusted call are immutable too. The freezer
// comes from the captured probe, even if learner code shadows Object.
const call = { call: '__fixture.value + read(__fixture.value)', expected: 6 };
const authored = 'var __fixture={value:3};';
for (const [label, source, expected] of [
  ['ordinary fixture use', 'function read(value){return value;}', true],
  ['fixture property replacement', 'function read(value){__fixture.value=99;return value;}', false],
  ['fixture binding replacement', 'function read(value){__fixture={value:99};return value;}', false],
  ['shadowed freeze cannot unseal fixtures', 'var Object={freeze:value=>value,keys:()=>[]};function read(value){__fixture.value=99;return value;}', false],
  ['global freeze replacement cannot unseal fixtures', 'globalThis.Object.freeze=value=>value;function read(value){__fixture.value=99;return value;}', false],
] as const) {
  const harness = protectedPathHarness(authored, [call.call]);
  const result = await runChecks({ code: `${harness.before}\n;\n${source}\n;\n${harness.after}`, visible: [call], hidden: [call], shuffle: values => values });
  assert.equal(allPassed(result.visible) && Boolean(result.hidden && allPassed(result.hidden)), expected, label);
  console.log(`PASS path authority: ${label}`);
}
const setupCall = { call: '__measure(3)', expected: { result: 6, calls: 1 } };
const setupHarness = `var __calls=0;
function __measure(value){__calls=0;const result=double(value);return {result,calls:__calls};}
const original=double;
double=value=>{__calls++;return original(value);};`;
for (const [label, source, expected] of [
  ['deferred wrapping sees learner declaration', 'function double(value){return value*2;}', true],
  ['repeated initialization cannot double-wrap', 'function double(value){return value*2;} __devsharkInitializePathHarness();__devsharkInitializePathHarness();', true],
  ['initialization binding cannot be replaced', 'function double(value){return value*2;} __devsharkInitializePathHarness=()=>{};', false],
] as const) {
  const harness = protectedPathHarness(setupHarness, [setupCall.call]);
  const result = await runChecks({ code: `${harness.before}\n;\n${source}\n;\n${harness.after}`, visible: [setupCall], hidden: [setupCall], shuffle: values => values });
  assert.equal(allPassed(result.visible) && Boolean(result.hidden && allPassed(result.hidden)), expected, label);
  console.log(`PASS path authority: ${label}`);
}
for (const [label, source, expected] of [
  ['one definition per index is counted once', 'function reverseInPlace(values){const copy=values.slice().reverse();for(let i=0;i<copy.length;i++)Object.defineProperty(values,String(i),{value:copy[i],writable:true,enumerable:true,configurable:true});return values;}', true],
  ['three definitions per index exceed the budget', 'function reverseInPlace(values){const copy=values.slice().reverse();for(let round=0;round<3;round++)for(let i=0;i<copy.length;i++)Object.defineProperty(values,String(i),{value:copy[i],writable:true,enumerable:true,configurable:true});return values;}', false],
  ['reflection definitions also exceed the budget', 'function reverseInPlace(values){const copy=values.slice().reverse();for(let round=0;round<3;round++)for(let i=0;i<copy.length;i++)Reflect.defineProperty(values,String(i),{value:copy[i],writable:true,enumerable:true,configurable:true});return values;}', false],
  ['delete-and-replace index operations exceed the budget', 'function reverseInPlace(values){const copy=values.slice().reverse();for(let i=0;i<copy.length;i++){delete values[i];values[i]=copy[i];}return values;}', false],
  ['captured definition survives a learner global replacement', 'Object.defineProperty=()=>{throw new Error("replaced");};function reverseInPlace(values){const copy=values.slice().reverse();for(let i=0;i<copy.length;i++)Reflect.defineProperty(values,String(i),{value:copy[i],writable:true,enumerable:true,configurable:true});return values;}', true],
] as const) {
  await check('reverse', source, expected, label);
}


// D04 uses a separate counted-buffer proxy. Property definitions/deletions
// must count there too, while plain assignment stays a single operation.
for (const [label, source, accepted] of [
  ['queue direct definitions are accepted', 'function createQueue(){const a=newQueueBuffer();let h=0;return {enqueue(value){Object.defineProperty(a,String(a.length),{value,writable:true,enumerable:true,configurable:true});},dequeue(){return h<a.length?a[h++]:null;},size(){return a.length-h;}};}', true],
  ['queue repeated definitions exceed the budget', 'function createQueue(){const a=newQueueBuffer();let h=0;return {enqueue(value){a.push(value);for(let i=0;i<10;i++)Object.defineProperty(a,String(a.length-1),{value,writable:true,enumerable:true,configurable:true});},dequeue(){return h<a.length?a[h++]:null;},size(){return a.length-h;}};}', false],
  ['queue reflection definitions exceed the budget', 'function createQueue(){const a=newQueueBuffer();let h=0;return {enqueue(value){a.push(value);for(let i=0;i<10;i++)Reflect.defineProperty(a,String(a.length-1),{value,writable:true,enumerable:true,configurable:true});},dequeue(){return h<a.length?a[h++]:null;},size(){return a.length-h;}};}', false],
  ['queue repeated deletions and definitions exceed the budget', 'function createQueue(){const a=newQueueBuffer();let h=0;return {enqueue(value){a.push(value);const index=String(a.length-1);for(let i=0;i<10;i++){delete a[index];Object.defineProperty(a,index,{value,writable:true,enumerable:true,configurable:true});}},dequeue(){return h<a.length?a[h++]:null;},size(){return a.length-h;}};}', false],
  ['queue captured definition survives global replacement', 'Object.defineProperty=()=>{throw new Error("replaced");};function createQueue(){const a=newQueueBuffer();let h=0;return {enqueue(value){Reflect.defineProperty(a,String(a.length),{value,writable:true,enumerable:true,configurable:true});},dequeue(){return h<a.length?a[h++]:null;},size(){return a.length-h;}};}', true],
] as const) await check('counted-queue', source, accepted, label);


const singleWriteQueue = 'function createQueue(){const a=newQueueBuffer();let h=0;return {enqueue(value){a.push(value);},dequeue(){if(h>=a.length)return null;const value=a[h];a[h++]=null;return value;},size(){return a.length-h;}};}';
const exactCount = await gradeFixture('counted-queue', singleWriteQueue, [{ call: '__measureQueue(32).ops', expected: 96, criterion: 'constant-dequeue' }]);
assert.equal(exactCount.state, 'verified_pass', 'queue append/read/clear are exactly three counted operations per value');
console.log('PASS path authority: queue ordinary assignment is counted once');
console.log('Native path authority checks passed. No production tampering probe was performed.');
