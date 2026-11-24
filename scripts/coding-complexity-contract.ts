import assert from 'node:assert/strict';
import { assessComplexity } from '../lib/coding/complexity';
import { codingPassXp, complexityGuidance } from '../shared/coding-complexity';
import { codingTaskForHistory } from '../lib/coding/catalog';
import { solutionFor } from '../lib/coding/solutions';

export function complexityContracts() {
  const task = { track: 'javascript' as const, prompt: 'Target: O(n) time and O(1) extra space.', tests: [{ call: 'solve([1,2,3])', expected: 6 }] };
  const target = (prompt: string) => complexityGuidance({ ...task, prompt }).targetTime;
  assert.equal(target('Target: O(n).'), 'O(n)', 'a standalone authored runtime target is applicable');
  assert.equal(target('Target: O(log min(a, b)) calls.'), 'O(log min(a, b))', 'nested notation remains complete');
  assert.equal(target('Target: O(log n) checks and O(1) space.'), 'O(log n)');
  assert.equal(target('Target: O(n) space.'), null, 'space cannot be mistaken for time');
  assert.equal(target('Target: O(n time.'), null, 'incomplete notation is not presented');
  assert.equal(complexityGuidance({ ...task, tests: [] }).targetTime, null, 'type-only tasks have no runtime target');
  assert.equal(complexityGuidance({ ...task, track: 'react' }).targetTime, null, 'UI rendering has no comparable runtime target');
  for (const [id, time, space] of [
    ['alg-dsaa-hop-distances', 'O(n+m)', 'O(n+m)'],
    ['alg-dsaa-components', 'O(n+m)', 'O(n+m)'],
    ['alg-dsaa-combinations', 'O(K*k+n)', 'O(n)'],
    ['alg-dsaa-distinct-window', 'O(n)', 'O(s+1)'],
    ['alg-dsaa-popcount32', 'O(b)', 'O(1)'],
  ]) {
    const guidance = complexityGuidance(codingTaskForHistory(id)!);
    assert.equal(guidance.targetTime, time, id + ' displays its authored runtime target');
    assert.equal(guidance.targetSpace, space, id + ' displays its authored space target');
  }
  const check = (code: string) => assessComplexity(task, code);
  assert.equal(check('const solve = xs => xs.length;').time, 'O(1)');
  assert.equal(check('const solve = xs => xs.map(x => x * 2);').time, 'O(n)');
  assert.equal(check('const solve = xs => xs.slice().sort((a,b) => a-b);').time, 'O(n log n)');
  const nested = check('function solve(xs) { let sum=0; for(let i=0;i<xs.length;i++) for(let j=0;j<xs.length;j++) sum+=xs[j]; return sum; }');
  assert.equal(nested.time, 'O(n^2)');
  assert.equal(nested.assessment, 'above-target');
  assert.equal(codingPassXp(nested), 15);
  assert.equal(codingPassXp(check('const solve = xs => xs.map(x => x);')), 25);
  assert.equal(codingPassXp(check('const solve = xs => mystery(xs);')), 25);
  for (const authored of ['O(n*m)', 'O(n*m + L)', 'O(n + m)', 'O(log min(a, b))', 'O(k)']) {
    const independent = { ...task, prompt: `Target: ${authored} time; n and m are independent input sizes.`, tests: [{ call: 'solve([1,2], [3,4,5])', expected: [[4,5,6],[5,6,7]] }] };
    const scoped = assessComplexity(independent, 'const solve = (left, right) => left.map(x => right.map(y => x+y));');
    assert.equal(scoped.time, null, authored + ': unsupported authored dimensions have no single-n label');
    assert.equal(scoped.assessment, 'unknown', authored);
    assert.equal(scoped.guidance.targetTime, authored, 'the applicable authored target remains visible');
    assert.equal(codingPassXp(scoped), 25, authored + ': an unavailable estimate retains the base reward');
  }
  const withoutTarget = { ...task, prompt: 'Collect all pairs.' };
  assert.equal(assessComplexity(withoutTarget, 'const solve = xs => xs.map(x => xs.map(y => x+y));').time, 'O(n^2)', 'supported structural estimates without an authored target remain available');
  assert.equal(check('const solve = xs => xs.map(x => [1, 2, 3].includes(x));').time, 'O(n)', 'a fixed inner scan is constant work');
  assert.equal(check('const solve = xs => [1, 2, 3].map(x => xs.includes(x));').time, 'O(n)', 'a fixed outer scan does not multiply input growth');
  assert.equal(check('function solve(xs) { const fixed = [1,2,3]; for (const x of fixed) { fixed.includes(x); } return xs; }').time, 'O(1)');
  assert.equal(check('function solve(xs) { const copy = xs; return copy.map(x => xs.map(y => y+x)); }').time, 'O(n^2)');

  assert.equal(check('function solve(xs) { for(let i=0;i<xs.length;i++) for(let j=0;j<3;j++) xs[i]+=j; return xs; }').time, 'O(n)');
  assert.equal(check('const solve = xs => xs.map(x => xs.map(y => y+x));').time, 'O(n^2)');
  assert.equal(check('const solve = xs => new Set(xs.map(x => xs.map(y => y+x)));').time, 'O(n^2)');
  assert.equal(check('const solve = xs => [...xs.map(x => xs.map(y => y+x))];').time, 'O(n^2)');
  assert.equal(check('function solve(xs) { for (const x of xs.map(x => xs.map(y => y+x))) {} return xs; }').time, 'O(n^2)');
  assert.equal(check('function solve(xs) { for (let i=0;i<xs.length && xs.includes(i);i++) {} return xs; }').assessment, 'unknown');
  for (const code of [
    'function solve(xs) { for(let i=0;i<xs.length;i++) for(let j=0;j<Math.min(xs.length,3);j++) {} return xs; }',
    'function solve(xs) { for(let i=0;i<xs.length;i++) for(let j=0;j<3 && xs.length>0;j++) {} return xs; }',
    'function solve(xs) { for(let i=0;i<xs.length;i+=3) for(let j=i;j<Math.min(i+3,xs.length);j++) {} return xs; }',
    'function solve(xs) { let right=0; for(let left=0;left<xs.length;left++) while(right<xs.length) right++; return xs; }',
    'function solve(xs) { let arr=xs; arr=[1,2,3]; return xs.map(x=>arr.includes(x)); }',
    'function solve(xs) { for(let i=0;i<xs.length;i++) for(let j=0;j<xs.length;j++) { break; } return xs; }',
    'function solve(xs) { let j=0; for(let i=0;i<xs.length;i++) for(;j<xs.length;j++) {} return xs; }',
    'function solve(xs) { const n=xs.length%3; for(let i=0;i<xs.length;i++) for(let j=0;j<n;j++) {} return xs; }',
    'function solve(xs) { for(let i=0;i<xs.length;i++) for(let j=0;j<(xs.length?3:0);j++) {} return xs; }',
    'const solve = xs => xs.map(x => xs.some(() => true));',
    'const solve = xs => xs.map(x => xs.every(() => false));',
    'const solve = xs => xs.map(x => xs.includes(xs[0]));',
  ]) assert.equal(codingPassXp(check(code)), 25, 'an uncertain bounded/amortized traversal must not reduce XP');
  assert.equal(check("const solve = xs => xs.map(x => /[a-z]/.test('abc'));").time, 'O(n)');
  assert.equal(check('const solve = xs => xs.map(x => xs.slice(0,3).includes(x));').time, 'O(n)');
  assert.equal(check('const solve = xs => xs.map(x => xs.slice(-3).includes(x));').time, 'O(n)');
  assert.equal(check('const solve = xs => xs.split("").map(x => xs.substring(0,3).includes(x));').time, 'O(n)');
  for (const code of [
    'function solve(text) { let total=0; for(let i=0;i<text.length;i++) total+=text.slice(i,i+2).length; return total; }',
    'function solve(text) { let total=0; for(let i=0;i<text.length;i++) total+=text.substring(i,i+2).length; return total; }',
    'function solve(text) { let total=0; for(let i=0;i<text.length;i++) total+=text.substr(i,2).length; return total; }',
    'function solve(text) { let i=text.length-1; const words=[]; while(i>=0) { const end=i+1; while(i>=0&&text[i]!==" ")i--; words.push(text.slice(i+1,end)); i--; } return words; }',
    'const solve = xs => xs.map((x,i) => xs.slice(i,i+2));',
    'const solve = xs => xs.map(x => xs.slice(1,-1));',
    'const solve = xs => xs.map(x => xs.slice(0,1e999));',
    'const solve = xs => xs.map(x => xs.slice(1e308));',
    'function solve(xs,start,end) { return xs.map(x=>xs.slice(start,end)); }',
  ]) {
    const report = check(code);
    assert.equal(report.time, null, 'unmodelled range widths have no whole-input or constant label');
    assert.equal(report.assessment, 'unknown');
    assert.equal(report.guidance.targetTime, 'O(n)');
    assert.equal(codingPassXp(report), 25, 'uncertain range copying cannot reduce XP');
  }
  for (const expression of ['xs.slice(0,3)', 'xs.slice(-5,-1)', 'xs.slice(-3.5)', 'xs.substring(-5,3)', 'xs.substr(-3)', 'xs.substr(2,3)', 'xs.slice(0.5,-0.5)']) {
    assert.equal(check(`const solve = xs => xs.map(x => ${expression});`).time, 'O(n)', expression + ': fixed normalized windows stay bounded');
  }
  for (const expression of ['xs.slice()', 'xs.slice(0)', 'xs.slice(1)', 'xs.slice(-0.5)', 'xs.substring(-3)', 'xs.substr(-0.5)']) {
    const report = check(`const solve = xs => xs.map(x => ${expression});`);
    assert.equal(report.time, 'O(n^2)', expression + ': whole copies/suffixes are not fixed windows');
    assert.equal(codingPassXp(report), 15, 'reliable quadratic copying retains the lower reward');
  }
  const romanTask = codingTaskForHistory('alg-easy2-roman-numerals')!;
  const tokenDecoder = 'const fromRoman=numeral=>{const values={I:1,V:5,X:10,L:50,C:100,D:500,M:1000,IV:4,IX:9,XL:40,XC:90,CD:400,CM:900};let total=0,index=0;while(index<numeral.length){const pair=numeral.slice(index,index+2);if(pair.length===2&&values[pair]!==undefined){total+=values[pair];index+=2;}else{total+=values[numeral[index]];index++;}}return total;};';
  const romanRange = assessComplexity(romanTask, tokenDecoder);
  assert.equal(romanRange.time, null, 'the actual Roman token decoder needs range review, not a quadratic label');
  assert.equal(romanRange.guidance.targetTime, 'O(n)');
  assert.equal(codingPassXp(romanRange), 25);
  assert.equal(check('function solve(xs) { for (let i=mystery(xs);i<xs.length;i++) {} return xs; }').assessment, 'unknown');
  assert.equal(check('const solve = xs => /[a-z]/.test(xs);').time, 'O(n)');
  assert.equal(check('function solve(xs) { let i=1; while(i<xs.length) i*=2; return i; }').time, 'O(log n)');
  // An identifier is matched as a name, never as a pattern: `$` once read as
  // an end-of-text anchor, so a `$`-named input never bounded its own loop.
  assert.equal(check('function solve($xs) { let t=0; for (let i=0;i<$xs.length;i++) t+=$xs[i]; return t; }').time, 'O(n)', '$ in an input name is part of the name');
  // A counter that starts at a literal is fixed, and a bound that names it is
  // not thereby fixed: these walked whole inputs and were labelled O(1).
  for (const code of [
    'function solve({ items }) { let t=0; for (let i=0;i<items.length;i++) for (let j=0;j<items.length;j++) t+=items[j]; return t; }',
    'function solve(xs) { const half = Math.floor(xs.length / 2); for (let i=0;i<half;i++) xs[i]=xs[xs.length-1-i]; return xs; }',
    'function solve(xs) { let t=0; for (let i=0;i<$xs.length;i++) t+=xs[i]; return t; }',
    'function solve(xs) { let i=0; while (i<ys.length) i++; return xs; }',
  ]) {
    assert.equal(check(code).time, null, code);
    assert.equal(check(code).assessment, 'unknown', code);
  }
  for (const code of [
    'function solve(xs) { let t=0; for (let i=0;i<3;i++) t+=i; return xs.length + t; }',
    'function solve(xs) { const fixed=[1,2,3]; let t=0; for (let i=0;i<fixed.length-1;i++) t+=fixed[i]; return xs.length + t; }',
  ]) assert.equal(check(code).time, 'O(1)', code + ': a literal or fixed-collection bound stays constant work');
  // A loop index bounds a nested loop only inside the loop that declares it.
  // A later loop reusing the name over a literal read as input-sized, so this
  // O(n) solution was labelled O(n^2), above target, and paid 15 XP.
  const reusedIndex = check('function solve(xs) { let t=0; for (let i=0;i<xs.length;i++) t+=xs[i]; for (let i=0;i<3;i++) for (let j=0;j<xs.length;j++) t++; return t; }');
  assert.equal(reusedIndex.time, 'O(n)', 'a reused index name is not an input size outside its own loop');
  assert.equal(codingPassXp(reusedIndex), 25);
  assert.equal(check('function solve(xs) { let t=0; for (let i=0;i<xs.length;i++) for (let j=0;j<i;j++) t++; return t; }').time, 'O(n^2)', 'an enclosing index still bounds a nested loop');
  assert.equal(check('function solve(xs) { let t=0; for (var i=0;i<xs.length;i++) t++; for (let j=0;j<i;j++) t++; return t; }').time, 'O(n)', 'a var index outlives its loop and still bounds a later one');
  assert.equal(check('const solve = xs => xs.length ? solve(xs.slice(1)) : 0;').assessment, 'unknown');
  assert.equal(check('const solve = xs => mystery(xs);').time, null);
  assert.equal(check('const solve = xs => { while(xs.length) xs = mystery(xs); return 1; };').assessment, 'unknown');
  assert.equal(check('const solve =').assessment, 'unknown');
  const deeplyNested = `function solve(xs) { ${'{'.repeat(5000)} return xs; ${'}'.repeat(5000)} }`;
  assert.doesNotThrow(() => check(deeplyNested), 'an advisory parser failure cannot replace the grader verdict');
  assert.equal(check(deeplyNested).assessment, 'unknown');
  assert.equal(check('const solve = xs => { let out = ""; for (let i=0;i<xs.length;i++) out+=xs[i]; return out; };').assessment, 'unknown');
  // A helper is inspected again at every call, so one helper called a
  // thousand times was a thousand full inspections: 13 kB held a request for
  // seconds. One shared budget covers every pass of one assessment.
  const bindings = Array.from({ length: 500 }, (_, i) => `b${i}=a`).join(',');
  const repeatedHelper = `function h(a){const z=()=>{const ${bindings};${'for(let i=0;q<q;);'.repeat(200)}};return 1;}`
    + `function solve(xs){${'h(xs);'.repeat(1000)}return 1;}`;
  const limited = check(repeatedHelper);
  assert.equal(limited.assessment, 'unknown', 'a repeatedly inspected helper stops at the shared analysis budget');
  assert.equal(limited.explanation, 'The analysis limit was reached. Review the code manually.');
  assert.equal(codingPassXp(limited), 25, 'an exhausted analysis keeps the base reward');
  assert.equal(check('const solve = xs => /^(a+)+$/.test(xs);').assessment, 'unknown');
  assert.equal(check('const cache = mystery(); const solve = xs => cache[xs];').assessment, 'unknown');
  for (const code of [
    'const solve = text => `Hello, ${text}!`;',
    'const solve = text => "Hello, " + text + "!";',
    'function solve(text:string, suffix:string){return text+suffix;}',
    'function solve(text:string){let prefix:string;prefix="Hello";return prefix+", "+text;}',
  ]) {
    assert.equal(check(code).time, null, 'unresolved string construction has no constant label');
    assert.equal(codingPassXp(check(code)), 25, 'unknown string construction keeps its base reward');
  }
  const stringInputs = { ...task, tests: [{ call: 'solve("first", "second")', expected: 'firstsecond' }] };
  assert.equal(assessComplexity(stringInputs, 'const solve = (left, right) => left + right;').time, null, 'tested string arguments do not become scalar arithmetic');
  assert.equal(check('const solve = value => value + 1;').time, 'O(1)', 'scalar arithmetic remains analyzable');
  assert.equal(check('const solve = value => value.name;').time, 'O(1)', 'field access has no output construction');
  assert.equal(check('const solve = value => "a" + "b";').time, 'O(1)', 'fixed literals remain bounded');
  assert.equal(check('const solve = value => `prefix${"fixed"}`;').time, 'O(1)', 'fixed template interpolation is bounded');
  // The tested factory's setup cost cannot stand in for later calls. These
  // pairs construct just as cheaply but their returned workloads differ.
  const factoryTask = { ...task, tests: [{ call: '(() => { const run = solve(); return run([1,2,3]); })()', expected: 6 }] };
  for (const code of [
    'const solve = () => xs => xs.map(x => x);',
    'const solve = () => xs => xs.map(x => xs.map(y => x+y));',
    'function solve() { const work = xs => xs.map(x => x); const alias = work; return alias; }',
    'function solve() { function work(xs) { return xs.map(x => x); } return { work }; }',
    'function solve() { let work; work = xs => xs.map(x => x); return work; }',
    'const solve = () => ({ work(xs) { return xs.map(x => x); } });',
    'const solve = () => ({ get work() { return [1,2,3].map(x => x); } });',
    'const solve = () => [xs => xs.map(x => x)];',
    'const solve = () => true ? (xs => xs.map(x => x)) : (xs => xs);',
    'const solve = () => { const work = xs => xs; return ({ work } as const); };',
    'function helper() { return xs => xs.map(x => x); } const solve = () => helper();',
    'function solve() { const box = {}; box.work = xs => xs.map(x => x); return box; }',
    'function solve() { const box = {}; const alias = box; alias.work = xs => xs.map(x => xs.map(y => x+y)); return box; }',
    'function solve() { const list = []; list.push(xs => xs.map(x => x)); return list; }',

  ]) {
    const scoped = assessComplexity(factoryTask, code);
    assert.equal(scoped.time, null, code);
    assert.equal(scoped.assessment, 'unknown', code);
    assert.equal(codingPassXp(scoped), 25, code);
    assert.equal(scoped.guidance.targetTime, 'O(n)', 'an unavailable estimate keeps the authored target');
  }
  const aliases = 'const a0 = xs => xs.map(x => x);' + Array.from({ length: 500 }, (_, i) => `const a${i + 1} = a${i};`).join('');
  assert.equal(assessComplexity(factoryTask, `function solve() { ${aliases} return a500; }`).assessment, 'unknown', 'a bounded long alias chain stays unavailable');
  assert.equal(check('function solve(xs) { function unused() { return () => xs.length; } return xs.length; }').time, 'O(1)', 'an uncalled local factory does not replace the eager entry workload');
  assert.equal(check('const solve = xs => xs.map(x => x * 2);').time, 'O(n)', 'an eager callback is not an escaping function');
  assert.equal(codingPassXp(nested), 15, 'reliably quadratic eager work still earns 15 XP');
  for (const id of ['js-mh-rate-limit', 'js-mh-curry', 'js-mh-latest-only']) {
    const authored = codingTaskForHistory(id)!;
    for (const variant of ['solution', 'junior', 'senior'] as const) {
      const scoped = assessComplexity(authored, solutionFor(id)![variant]!);
      assert.equal(scoped.time, null, id + '/' + variant);
      assert.equal(scoped.assessment, 'unknown', id + '/' + variant);
      assert.equal(codingPassXp(scoped), 25, id + '/' + variant);
    }
  }
  for (const [id, goal] of [['ts-pluck-all', 'O(n*m)'], ['ts-mh-print-table', 'O(n*m + L)']]) {
    const authored = codingTaskForHistory(id)!;
    for (const variant of ['solution', 'junior', 'senior'] as const) {
      const scoped = assessComplexity(authored, solutionFor(id)![variant]!);
      assert.equal(scoped.guidance.targetTime, goal, id + '/' + variant);
      assert.equal(scoped.time, null, id + ': independent authored sizes must not collapse into n^2');
      assert.equal(scoped.assessment, 'unknown');
      assert.equal(codingPassXp(scoped), 25);
    }
  }
  const palindrome = codingTaskForHistory('alg-valid-palindrome')!;
  const report = assessComplexity(palindrome, solutionFor(palindrome.id)!.solution);
  assert.equal(report.guidance.targetTime, 'O(n)');
  assert.equal(report.guidance.targetSpace, 'O(1)');
  assert.equal(report.time, 'O(n)', JSON.stringify(report));
  assert.equal(report.assessment, 'within-target');
  assert.equal(assessComplexity({ ...task, track: 'react' }, 'const App = () => null').assessment, 'unknown');
  console.log('Complexity contracts passed: scans, nesting, fixed bounds, sorting, logarithmic loops, recursion, unresolved calls, deferred workloads and palindrome.');
}
