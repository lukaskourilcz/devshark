// Server-only reference solutions and hidden tests for lib/coding/tasks/easy-javascript-a.ts.
// Never import from client code. The hidden tests aim at the shortcut each
// visible set leaves open: a hard-coded answer, a changed input, a value or a
// shape the visible tests never used, and the case the technique exists for.

import type { CodingSolution } from '../types';

export const EASY_JAVASCRIPT_A_SOLUTIONS: Record<string, CodingSolution> = {
  /* ── flat ─────────────────────────────────────────────────────────── */
  'js-easy2-flatten-once': {
    solution: `const flattenOnce = list => {
  // flat() defaults to a depth of 1 and returns a new array.
  return list.flat();
};`,
    junior: `const flattenOnce = list => {
  const flattened = list.flat(1);
  return flattened;
};`,
    senior: `const flattenOnce = list => list.flat();`,
    hiddenTests: [
      {"call": "(() => { const list = [1, 2]; return flattenOnce(list) !== list; })()", "expected": true},
      {"call": "(() => { const list = []; return flattenOnce(list) !== list; })()", "expected": true},
      {"call": "(() => { const item = { value: 1 }; const inner = [3]; const list = [item, [2, inner]]; const out = flattenOnce(list); return [out !== list, out[0] === item, out[2] === inner, list[1][1] === inner, list.length]; })()", "expected": [true, true, true, true, 2]},
      {"call": "flattenOnce([null, [false, \"\", null]])", "expected": [null, false, "", null]},
      { call: 'flattenOnce([])', expected: [] },
      { call: 'flattenOnce([[1, 2], 3, [[4]]])', expected: [1, 2, 3, [4]] },
      { call: 'flattenOnce([["x"], "y"])', expected: ['x', 'y'] },
    ],
  },
  'js-easy2-all-tags': {
    solution: `const allTags = posts => {
  // map gives one array of tags per post; flat joins them end to end.
  return posts.map(post => post.tags).flat();
};`,
    junior: `const allTags = posts => {
  const tagLists = posts.map(post => post.tags);
  const tags = tagLists.flat();
  return tags;
};`,
    senior: `// flatMap maps and flattens one level in a single pass.
const allTags = posts => posts.flatMap(({ tags }) => tags);`,
    hiddenTests: [
      { call: 'allTags([{ title: "Nested", tags: ["a", "b", "c"] }])', expected: ['a', 'b', 'c'] },
      { call: 'allTags([{ title: "One", tags: ["solo"] }, { title: "Two", tags: [] }, { title: "Three", tags: ["x", "y"] }])', expected: ['solo', 'x', 'y'] },
      { call: '(() => { const posts = [{ title: "A", tags: ["t"] }]; allTags(posts); return posts; })()', expected: [{ title: 'A', tags: ['t'] }] },
    ],
  },
  'js-easy2-menu-items': {
    solution: `const menuItems = menu => {
  // Two levels of brackets sit around each dish: its section and its group.
  return menu.flat(2);
};`,
    junior: `const menuItems = menu => {
  const depth = 2;
  const dishes = menu.flat(depth);
  return dishes;
};`,
    senior: `const menuItems = menu => menu.flat(2);`,
    hiddenTests: [
      { call: 'menuItems([[["a"], ["b"]], [["c"], ["d", "e"]]])', expected: ['a', 'b', 'c', 'd', 'e'] },
      { call: 'menuItems([[["only"]]])', expected: ['only'] },
      { call: '(() => { const menu = [[["x"]]]; menuItems(menu); return menu; })()', expected: [[['x']]] },
    ],
  },

  /* ── for...in ─────────────────────────────────────────────────────── */
  'js-easy2-keys-with-value': {
    solution: `const keysWithValue = (object, value) => {
  const keys = [];
  for (const key in object) {
    // === keeps "1" and 1 apart.
    if (object[key] === value) keys.push(key);
  }
  return keys;
};`,
    junior: `const keysWithValue = (object, value) => {
  const matching = [];
  for (const key in object) {
    const current = object[key];
    if (current === value) {
      matching.push(key);
    }
  }
  return matching;
};`,
    senior: "const keysWithValue = (object, value) => {\n  const keys = [];\n  // This exercise includes inherited enumerable string keys.\n  for (const key in object) if (object[key] === value) keys.push(key);\n  return keys;\n};",
    hiddenTests: [
      { call: 'keysWithValue({ x: true, y: false, z: true }, true)', expected: ['x', 'z'] },
      { call: 'keysWithValue({ a: null, b: undefined }, null)', expected: ['a'] },
      { call: 'keysWithValue({ one: 0, two: 0, three: 0 }, 0)', expected: ['one', 'two', 'three'] },
    ],
  },
  'js-easy2-invert-object': {
    solution: "const invert = object => {\n  // A null-prototype dictionary treats __proto__ as an ordinary key.\n  const inverted = Object.create(null);\n  for (const key in object) {\n    if (Object.hasOwn(object, key)) inverted[object[key]] = key;\n  }\n  return inverted;\n};",
    junior: "const invert = object => {\n  const result = Object.create(null);\n  for (const key in object) {\n    if (!Object.hasOwn(object, key)) continue;\n    const value = object[key];\n    result[value] = key;\n  }\n  return result;\n};",
    senior: "const invert = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [value, key]));",
    hiddenTests: [
      { call: 'invert({ one: 1, two: 2 })', expected: { 1: 'one', 2: 'two' } },
      { call: 'invert({ k: "v" })', expected: { v: 'k' } },
      { call: 'invert({ a: "z", b: "y", c: "z" })', expected: { z: 'c', y: 'b' } },
    ],
  },
  'js-easy2-own-keys-only': {
    solution: `const ownKeys = object => {
  const keys = [];
  for (const key in object) {
    // for...in visits inherited keys too; hasOwn keeps the object's own.
    if (Object.hasOwn(object, key)) keys.push(key);
  }
  return keys;
};`,
    junior: `const ownKeys = object => {
  const result = [];
  for (const key in object) {
    const isOwn = Object.prototype.hasOwnProperty.call(object, key);
    if (isOwn) {
      result.push(key);
    }
  }
  return result;
};`,
    senior: `const ownKeys = object => {
  const keys = [];
  for (const key in object) if (Object.hasOwn(object, key)) keys.push(key);
  return keys;
};`,
    hiddenTests: [
      { call: 'ownKeys(Object.assign(Object.create({ a: 1, b: 2 }), { c: 3, d: 4 }))', expected: ['c', 'd'] },
      { call: 'ownKeys({ only: undefined })', expected: ['only'] },
      { call: 'ownKeys(Object.assign(Object.create(Object.create({ deep: 1 })), { top: 1 }))', expected: ['top'] },
    ],
  },

  /* ── promises ─────────────────────────────────────────────────────── */
  'js-easy2-double-later': {
    solution: `const doubleLater = promise => {
  // then returns a new promise; a rejection skips the callback and carries on.
  return promise.then(value => value * 2);
};`,
    junior: `const doubleLater = promise => {
  const doubled = promise.then(value => {
    const result = value * 2;
    return result;
  });
  return doubled;
};`,
    senior: "const doubleLater = promise => promise.then(number => 2 * number);",
    hiddenTests: [
      { call: "(() => {const error=Object.freeze({code:\"offline\"}),input=Promise.reject(error);input.catch(()=>{});const output=doubleLater(input);return output.then(()=>false,reason=>reason===error&&output!==input);})()", expected: true, async: true },
      { call: "Promise.all([doubleLater(Promise.resolve(-0)).then(x=>Object.is(x,-0)),doubleLater(Promise.resolve(0.000000001)).then(x=>x===0.000000002),doubleLater(Promise.resolve(1000000000)).then(x=>x===2000000000),doubleLater(Promise.resolve(-1000000000)).then(x=>x===-2000000000)])", expected: [true, true, true, true], async: true },
      { call: "(() => {const input=Object.freeze(Promise.resolve(4)),output=doubleLater(input);let settled=false;output.then(()=>{settled=true;});const immediate=settled;return output.then(value=>[output instanceof Promise,output!==input,immediate,value]);})()", expected: [true, true, false, 8], async: true },

      { call: 'doubleLater(Promise.resolve(21))', expected: 42, async: true },
      { call: 'doubleLater(doubleLater(Promise.resolve(3)))', expected: 12, async: true },
      { call: 'doubleLater(new Promise(resolve => setTimeout(() => resolve(5), 10)))', expected: 10, async: true },
      { call: '(() => { const failing = Promise.reject(new Error("timeout")); failing.catch(() => {}); return doubleLater(failing).then(() => "resolved", error => error.message); })()', expected: 'timeout', async: true },
    ],
  },
  'js-easy2-fallback-on-failure': {
    solution: `const withFallback = (promise, fallback) => {
  // catch runs only on a rejection, so a resolved 0 or undefined passes through.
  return promise.catch(() => fallback);
};`,
    junior: `const withFallback = (promise, fallback) => {
  return promise.catch(error => {
    return fallback;
  });
};`,
    senior: "const withFallback = (promise, fallback) => promise.catch(function recover() { return fallback; });",
    hiddenTests: [
      { call: "(() => {const object=Object.freeze({}),fn=()=>1,symbol=Symbol(\"x\");return Promise.all([object,fn,symbol,false,\"\",NaN,-0].map(value=>withFallback(Promise.resolve(value),\"unused\").then(actual=>Object.is(actual,value))));})()", expected: [true, true, true, true, true, true, true], async: true },
      { call: "(() => {const object=Object.freeze({}),fn=()=>1,symbol=Symbol(\"fallback\"),input=Promise.reject(\"reason\");input.catch(()=>{});return Promise.all([object,fn,symbol].map(value=>withFallback(input,value).then(actual=>actual===value)));})()", expected: [true, true, true], async: true },
      { call: "(() => {const first=Promise.reject(\"first\"),error=Object.freeze({}),fallback=Promise.reject(error);first.catch(()=>{});fallback.catch(()=>{});return Promise.all([withFallback(first,Promise.resolve(9)).then(value=>value===9),withFallback(first,fallback).then(()=>false,reason=>reason===error),withFallback(Promise.resolve(\"kept\"),fallback).then(value=>value===\"kept\")]);})()", expected: [true, true, true], async: true },

      { call: 'withFallback(Promise.resolve([1, 2]), [])', expected: [1, 2], async: true },
      { call: '(() => { const failing = Promise.reject("plain string"); failing.catch(() => {}); return withFallback(failing, "used"); })()', expected: 'used', async: true },
      { call: 'withFallback(new Promise(resolve => setTimeout(() => resolve("late"), 10)), "early")', expected: 'late', async: true },
    ],
  },
  'js-easy2-total-when-ready': {
    solution: `const totalWhenReady = prices =>
  // Promise.all waits for every price and rejects as soon as one fails.
  Promise.all(prices).then(values => values.reduce((sum, value) => sum + value, 0));`,
    junior: `const totalWhenReady = prices => {
  return Promise.all(prices).then(values => {
    let total = 0;
    for (const value of values) {
      total = total + value;
    }
    return total;
  });
};`,
    senior: `const totalWhenReady = async prices => {
  const values = await Promise.all(prices);
  return values.reduce((sum, value) => sum + value, 0);
};`,
    hiddenTests: [
      { call: "(() => {const error=Object.freeze({}),bad=Promise.reject(error);bad.catch(()=>{});const result=totalWhenReady(Object.freeze([new Promise(()=>{}),bad]));return Promise.race([result.then(()=>false,reason=>reason===error),new Promise(done=>setTimeout(()=>done(false),100))]);})()", expected: true, async: true },
      { call: "totalWhenReady(Object.freeze([Promise.resolve(10000000000000000),new Promise(done=>setTimeout(()=>done(-10000000000000000),20)),Promise.resolve(1)]))", expected: 1, async: true },
      { call: "(() => {const prices=[Promise.resolve(1),new Promise(done=>setTimeout(()=>done(2),5))],result=totalWhenReady(prices);prices.length=0;return result.then(sum=>[sum,prices.length]);})()", expected: [3, 0], async: true },
      { call: "totalWhenReady(Object.freeze(Array.from({length:1000},(_,i)=>Promise.resolve(i))))", expected: 499500, async: true },

      { call: 'totalWhenReady([Promise.resolve(-4), Promise.resolve(4)])', expected: 0, async: true },
      { call: 'totalWhenReady([Promise.resolve(10)])', expected: 10, async: true },
      { call: 'totalWhenReady([new Promise(resolve => setTimeout(() => resolve(2), 20)), new Promise(resolve => setTimeout(() => resolve(3), 5))])', expected: 5, async: true },
    ],
  },

  /* ── timers ───────────────────────────────────────────────────────── */
  'js-easy2-cancel-a-timer': {
    solution: `const schedule = (task, ms) => {
  const id = setTimeout(task, ms);
  // The returned function closes over this id, so it cancels this timer only.
  return () => clearTimeout(id);
};`,
    junior: `const schedule = (task, ms) => {
  const timerId = setTimeout(() => {
    task();
  }, ms);
  const cancel = () => {
    clearTimeout(timerId);
  };
  return cancel;
};`,
    senior: `// Clearing a timer that already fired is a no-op, so the id needs no guard.
const schedule = (task, ms) => {
  const id = setTimeout(task, ms);
  return () => clearTimeout(id);
};`,
    hiddenTests: [
      { call: "new Promise(done => {const log=[];let args;const cancel=schedule((...a)=>{args=a;log.push(\"ran\");},0);log.push(\"returned\");setTimeout(()=>{if(typeof cancel===\"function\"){cancel();cancel();}done([log,args?.length??-1]);},20);})", expected: [["returned", "ran"], 0], async: true },
      { call: "new Promise(done => {let calls=0;const cancel=schedule(()=>{calls++;},1000);if(typeof cancel===\"function\"){cancel();cancel();}setTimeout(()=>done([calls,typeof cancel]),60);})", expected: [0, "function"], async: true },
      { call: "new Promise(done => {const log=[];const a=schedule(()=>log.push(\"a\"),20),b=schedule(()=>log.push(\"b\"),10);setTimeout(a,5);setTimeout(()=>{if(typeof b===\"function\")b();done(log);},60);})", expected: ["b"], async: true },

      { call: 'new Promise(done => { const log = []; schedule(() => log.push("slow"), 30); schedule(() => log.push("fast"), 10); setTimeout(() => done(log), 70); })', expected: ['fast', 'slow'], async: true },
      { call: '(() => { let runs = 0; const cancel = schedule(() => { runs += 1; }, 0); return new Promise(done => setTimeout(done, 30)).then(() => { cancel(); return runs; }); })()', expected: 1, async: true },
      { call: 'new Promise(done => { const log = []; schedule(() => log.push("a"), 20); const cancelB = schedule(() => log.push("b"), 20); cancelB(); setTimeout(() => done(log), 60); })', expected: ['a'], async: true },
      { call: 'typeof schedule(() => {}, 5)', expected: 'function' },
    ],
  },
  'js-easy2-repeat-then-stop': {
    solution: `const repeat = (task, times, ms) => {
  if (times <= 0) return;
  let calls = 0;
  const id = setInterval(() => {
    calls += 1;
    task(calls);
    // Clear on the last call, or the interval keeps firing for ever.
    if (calls === times) clearInterval(id);
  }, ms);
};`,
    junior: `const repeat = (task, times, ms) => {
  if (times === 0) {
    return;
  }
  let callNumber = 0;
  const intervalId = setInterval(() => {
    callNumber = callNumber + 1;
    task(callNumber);
    if (callNumber === times) {
      clearInterval(intervalId);
    }
  }, ms);
};`,
    senior: `const repeat = (task, times, ms) => {
  if (times < 1) return;
  let calls = 0;
  const id = setInterval(() => {
    task(++calls);
    if (calls === times) clearInterval(id);
  }, ms);
};`,
    hiddenTests: [
      { call: "new Promise(done => {let calls=0,total=0,last=0,arity=true;repeat((...args)=>{calls++;total+=args[0];last=args[0];arity=arity&&args.length===1;},100,1);const immediate=calls;setTimeout(()=>done([immediate,calls,total,last,arity]),500);})", expected: [0, 100, 5050, 100, true], async: true },
      { call: "new Promise(done => {const native=setInterval;let started=0;globalThis.setInterval=(...args)=>{started++;return native(...args);};repeat(()=>{},0,1000);globalThis.setInterval=native;setTimeout(()=>done(started),10);})", expected: 0, async: true },

      { call: 'new Promise(done => { const log = []; repeat(n => log.push(n), 4, 5); setTimeout(() => done(log), 150); })', expected: [1, 2, 3, 4], async: true },
      { call: 'new Promise(done => { let calls = 0; repeat(() => { calls += 1; }, 2, 5); setTimeout(() => done(calls), 120); })', expected: 2, async: true },
      { call: 'new Promise(done => { const log = []; repeat(n => log.push("a" + n), 2, 5); repeat(n => log.push("b" + n), 1, 5); setTimeout(() => done(log.length), 120); })', expected: 3, async: true },
      { call: "new Promise(done => {const start=setInterval,watches=[];let expected=2;globalThis.setInterval=(fn,ms,...args)=>{const watch={fires:0,expected};watches.push(watch);return start((...received)=>{watch.fires++;fn(...received);},ms,...args);};try{repeat(()=>{},2,5);expected=3;repeat(()=>{},3,5);}finally{globalThis.setInterval=start;}setTimeout(()=>done(watches.reduce((extra,watch)=>extra+Math.max(0,watch.fires-watch.expected),0)),100);})", expected: 0, async: true },
    ],
  },
  'js-easy2-fire-in-delay-order': {
    solution: "const inDelayOrder = jobs => new Promise(resolve => {\n  const fired = [];\n  const total = jobs.length;\n  // With no jobs no timer would ever resolve the promise, so answer now.\n  if (jobs.length === 0) return resolve(fired);\n  for (const { name, ms } of jobs) {\n    setTimeout(() => {\n      fired.push(name);\n      if (fired.length === total) resolve(fired);\n    }, ms);\n  }\n});",
    junior: "const inDelayOrder = jobs => {\n  return new Promise(resolve => {\n    const fired = [];\n    const total = jobs.length;\n    if (jobs.length === 0) {\n      resolve(fired);\n      return;\n    }\n    for (let i = 0; i < jobs.length; i++) {\n      const { name, ms } = jobs[i];\n      setTimeout(() => {\n        fired.push(name);\n        if (fired.length === total) {\n          resolve(fired);\n        }\n      }, ms);\n    }\n  });\n};",
    senior: `const inDelayOrder = async jobs => {
  const fired = [];
  await Promise.all(jobs.map(({ name, ms }) => new Promise(done => setTimeout(() => done(fired.push(name)), ms))));
  return fired;
};`,
    hiddenTests: [
      { call: "(() => {const jobs=[{name:\"first\",ms:5},{name:\"second\",ms:15}],result=inDelayOrder(jobs);jobs[0].name=\"changed\";jobs.push({name:\"new\",ms:0});return Promise.race([result,new Promise(done=>setTimeout(()=>done([\"timeout\"]),100))]);})()", expected: ["first", "second"], async: true },
      { call: "(async()=>{const result=inDelayOrder([{name:\"later\",ms:20}]);let settled=false;result.then(()=>{settled=true;});await Promise.resolve();const beforeTimers=settled;const out=await result;return [result instanceof Promise,beforeTimers,out];})()", expected: [true, false, ["later"]], async: true },
      { call: "inDelayOrder(Object.freeze([Object.freeze({name:\"\",ms:0}),Object.freeze({name:\"same\",ms:0}),Object.freeze({name:\"same\",ms:0})]))", expected: ["", "same", "same"], async: true },
      { call: "inDelayOrder(Object.freeze(Array.from({length:1000},(_,i)=>Object.freeze({name:\"n\"+i,ms:0})))).then(names=>[names.length,names[0],names[999]])", expected: [1000, "n0", "n999"], async: true },

      { call: 'inDelayOrder([{ name: "x", ms: 40 }, { name: "y", ms: 20 }, { name: "z", ms: 0 }])', expected: ['z', 'y', 'x'], async: true },
      { call: 'inDelayOrder([{ name: "solo", ms: 15 }])', expected: ['solo'], async: true },
      { call: 'inDelayOrder([{ name: "b", ms: 25 }, { name: "a", ms: 25 }, { name: "c", ms: 5 }])', expected: ['c', 'b', 'a'], async: true },
    ],
  },

  /* ── callbacks ────────────────────────────────────────────────────── */
  'js-easy2-call-n-times': {
    solution: `const times = (n, callback) => {
  const results = [];
  for (let index = 0; index < n; index += 1) {
    results.push(callback(index));
  }
  return results;
};`,
    junior: `const times = (n, callback) => {
  const results = [];
  for (let index = 0; index < n; index++) {
    const value = callback(index);
    results.push(value);
  }
  return results;
};`,
    senior: `// Array.from calls the mapper once per slot, with the index second.
const times = (n, callback) => Array.from({ length: n }, (_, index) => callback(index));`,
    hiddenTests: [
      {"call": "(() => {const value=Object.freeze({id:1}),seen=[];const out=times(3,function(i){seen.push([i,arguments.length]);return i===1?undefined:value;});return out.length===3&&out[0]===value&&out[1]===undefined&&out[2]===value&&seen.every((x,i)=>x[0]===i&&x[1]===1);})()", "expected": true, "label": "exact single callback argument, order and opaque results"},
      {"call": "(() => {const a=times(0,()=>{throw Error('zero');}),b=times(0,()=>0);return a!==b&&a.length===0;})()", "expected": true, "label": "fresh empty results without callback execution"},
      {"call": "(() => {const error={},seen=[];try{times(5,i=>{seen.push(i);if(i===1)throw error;return i;});}catch(e){return e===error&&seen.join(',')==='0,1';}return false;})()", "expected": true, "label": "same thrown error stops subsequent indices"},
      {"call": "(() => {const out=times(1000,i=>i);return out.length===1000&&out.every((x,i)=>x===i);})()", "expected": true, "label": "thousand-index boundary"},
      { call: 'times(5, i => i % 2 === 0)', expected: [true, false, true, false, true] },
      { call: 'times(1, i => [i])', expected: [[0]] },
      { call: 'times(3, i => "#" + (i + 1))', expected: ['#1', '#2', '#3'] },
    ],
  },
  'js-easy2-error-first-callback': {
    solution: `const safeDivide = (a, b, callback) => {
  if (b === 0) {
    callback(new Error("Cannot divide by zero"));
    // Return here, or the success call below would run as well.
    return;
  }
  callback(null, a / b);
};`,
    junior: `const safeDivide = (a, b, callback) => {
  if (b === 0) {
    const error = new Error("Cannot divide by zero");
    callback(error);
  } else {
    const result = a / b;
    callback(null, result);
  }
};`,
    senior: `const safeDivide = (a, b, callback) => {
  if (b === 0) return void callback(new Error("Cannot divide by zero"));
  callback(null, a / b);
};`,
    hiddenTests: [
      { call: "(() => {const trace=[];let first,second;const x=safeDivide(1.005,2,(...args)=>{trace.push(\"callback\");first=args;return 999;});trace.push(\"returned\");const y=safeDivide(1,-0,(...args)=>{second=args;return 999;});return [trace,first.length,first[0]===null,first[1],second.length,second[0] instanceof Error,second[0].message,x===undefined,y===undefined];})()", expected: [["callback", "returned"], 2, true, 0.5025, 1, true, "Cannot divide by zero", true, true] },
      { call: "(() => {const error=Object.freeze({});let calls=0,same=0;for(const b of [0,2]){try{safeDivide(-4,b,()=>{calls++;throw error;});}catch(e){if(e===error)same++;}}return [calls,same];})()", expected: [2, 2] },
      { call: "(() => {let value;safeDivide(-0,1,(_,x)=>{value=x;});return Object.is(value,-0);})()", expected: true },

      { call: '(() => { let out; safeDivide(7, 2, (error, value) => { out = value; }); return out; })()', expected: 3.5 },
      { call: '(() => { let out; safeDivide(-9, 3, (error, value) => { out = [error, value]; }); return out; })()', expected: [null, -3] },
      { call: '(() => { let calls = 0; safeDivide(1, 0, () => { calls += 1; }); return calls; })()', expected: 1 },
      { call: '[safeDivide(4, 2, () => "ignored"), safeDivide(4, 0, () => "ignored")]', expected: [undefined, undefined] },
    ],
  },
  'js-easy2-after-n-calls': {
    solution: `const after = (count, done) => {
  let calls = 0;
  return () => {
    calls += 1;
    // === rather than >=, so done fires on the count-th call only.
    if (calls === count) done();
  };
};`,
    junior: `const after = (count, done) => {
  let callsSoFar = 0;
  function counted() {
    callsSoFar = callsSoFar + 1;
    if (callsSoFar === count) {
      done();
    }
  }
  return counted;
};`,
    senior: `const after = (count, done) => {
  let remaining = count;
  return () => {
    if (--remaining === 0) done();
  };
};`,
    hiddenTests: [
      { call: "(() => {let calls=0,args;const f=after(10000,(...a)=>{calls++;args=a;});for(let i=0;i<9999;i++)f(\"ignored\");const before=calls;f(\"ignored\");return [before,calls,args.length,f!==after(10000,()=>{})];})()", expected: [0, 1, 0, true] },
      { call: "(() => {let calls=0;const error=Object.freeze({}),f=after(1,()=>{calls++;throw error;});let same=false;try{f();}catch(e){same=e===error;}f();f();return [calls,same];})()", expected: [1, true] },
      { call: "(() => {let calls=0;const f=after(1,()=>{calls++;f();});f();return calls;})()", expected: 1 },

      { call: '(() => { let fired = 0; const finish = after(4, () => { fired += 1; }); finish(); finish(); finish(); return fired; })()', expected: 0 },
      { call: '(() => { const log = []; const finish = after(2, () => log.push("done")); finish(); log.push("one"); finish(); log.push("two"); return log; })()', expected: ['one', 'done', 'two'] },
      { call: '(() => { let args; const finish = after(1, (...received) => { args = received; }); finish("ignored"); return args; })()', expected: [] },
    ],
  },

  /* ── higher-order functions ───────────────────────────────────────── */
  'js-easy2-negate-a-test': {
    solution: `const negate = test =>
  // Rest collects every argument; spread hands them on in the same order.
  (...args) => !test(...args);`,
    junior: `const negate = test => {
  const flipped = (...args) => {
    const result = test(...args);
    if (result) {
      return false;
    }
    return true;
  };
  return flipped;
};`,
    senior: `// A regular function keeps this for tests that are methods.
const negate = test => function (...args) {
  return !test.apply(this, args);
};`,
    hiddenTests: [
      {"call": "(() => {let calls=0;const item=Object.freeze({});const a=negate(function(...args){calls++;return args.length===4&&args[0]===item&&args[1]===undefined&&args[2]===3&&args[3]===4;});return a(item,undefined,3,4)===false&&calls===1;})()", "expected": true, "label": "all argument references and exact callback count"},
      {"call": "[NaN,0n,undefined,null,'',false,{},[],Symbol('x')].map(x=>negate(()=>x)())", "expected": [true, true, true, true, true, true, false, false, false], "label": "return a Boolean for every ordinary truthiness category"},
      {"call": "(() => {const error={};const a=negate(()=>{throw error;});try{a();}catch(e){return e===error;}return false;})()", "expected": true, "label": "the original callback error propagates"},
      {"call": "negate((...args)=>args.length===100)(...Array(100).fill(0))", "expected": false, "label": "hundred-argument boundary"},
      { call: '["", "a", null, "b"].filter(negate(Boolean))', expected: ['', null] },
      { call: 'negate(() => undefined)()', expected: true },
      { call: 'negate((a, b, c) => a + b + c === 6)(1, 2, 3)', expected: false },
      { call: 'typeof negate(() => true)', expected: 'function' },
    ],
  },
  'js-easy2-sort-by-key': {
    solution: "const sortBy = (list, pick) => {\n  const entries = list.map((item, index) => ({ item, index, key: pick(item) }));\n  entries.sort((a, b) => a.key - b.key || a.index - b.index);\n  return entries.map(entry => entry.item);\n};",
    junior: "const sortBy = (list, pick) => {\n  const decorated = list.map((item, index) => {\n    const key = pick(item);\n    return { item, key, index };\n  });\n  decorated.sort((first, second) => {\n    const byKey = first.key - second.key;\n    return byKey === 0 ? first.index - second.index : byKey;\n  });\n  return decorated.map(entry => entry.item);\n};",
    senior: `// pick runs once per item, not once per comparison.
const sortBy = (list, pick) =>
  list
    .map((item, index) => ({ item, key: pick(item), index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ item }) => item);`,
    hiddenTests: [
      { call: "(() => {const a=Object.freeze({}),b=Object.freeze([]),list=Object.freeze([a,undefined,b,NaN,-0]),seen=[];const key=new Map([[a,2],[undefined,-1],[b,2],[NaN,0],[-0,0]]);let arity=true;const x=sortBy(list,(...args)=>{arity=arity&&args.length===1;seen.push(args[0]);return key.get(args[0]);});return [x.length,x[0]===undefined,Number.isNaN(x[1]),Object.is(x[2],-0),x[3]===a,x[4]===b,seen.length,seen[0]===a,seen[1]===undefined,arity,x!==sortBy(list,x=>key.get(x)),list[0]===a,sortBy([],()=>0)!==sortBy([],()=>0)];})()", expected: [5, true, true, true, true, true, 5, true, true, true, true, true, true] },
      { call: "(() => {const error=Object.freeze({}),list=Object.freeze([3,2,1]);let calls=0,same=false;try{sortBy(list,()=>{calls++;throw error;});}catch(e){same=e===error;}return [calls,same,list[0]];})()", expected: [1, true, 3] },
      { call: "(() => {const list=Object.freeze(Array.from({length:10000},(_,i)=>Object.freeze({i,k:i%2}))),out=sortBy(list,x=>x.k);return [out.length,out[0]===list[0],out[4999]===list[9998],out[5000]===list[1],out[9999]===list[9999]];})()", expected: [10000, true, true, true, true] },

      { call: 'sortBy([], n => n)', expected: [] },
      { call: 'sortBy([-1, -5, 3], n => Math.abs(n))', expected: [-1, 3, -5] },
      { call: 'sortBy([{ t: "x", p: 5 }, { t: "y", p: -2 }], o => o.p).map(o => o.t)', expected: ['y', 'x'] },
    ],
  },
  'js-easy2-count-where': {
    solution: `const countWhere = (list, test) => {
  let count = 0;
  for (const item of list) {
    // Any truthy result counts, not only true.
    if (test(item)) count += 1;
  }
  return count;
};`,
    junior: `const countWhere = (list, test) => {
  let count = 0;
  for (const item of list) {
    const passed = test(item);
    if (passed) {
      count = count + 1;
    }
  }
  return count;
};`,
    senior: `const countWhere = (list, test) => {
  let count = 0;
  for (const item of list) if (test(item)) count++;
  return count;
};`,
    hiddenTests: [
      {"call": "(() => {const list=Object.freeze([Object.freeze({id:0}),Object.freeze({id:1}),Object.freeze({id:2})]),seen=[];const n=countWhere(list,function(x){seen.push([x,arguments.length]);return {};});return n===3&&seen.length===3&&seen.every((x,i)=>x[0]===list[i]&&x[1]===1);})()", "expected": true, "label": "one original item argument per call in frozen caller order"},
      {"call": "countWhere(Object.freeze([NaN,0n,undefined,null,'',false,{},[],Symbol('x')]),x=>x)", "expected": 3, "label": "full truthiness includes object array and symbol"},
      {"call": "(() => {const error={},seen=[];try{countWhere(Object.freeze([0,1,2]),x=>{seen.push(x);if(x===1)throw error;return true;});}catch(e){return e===error&&seen.join(',')==='0,1';}return false;})()", "expected": true, "label": "predicate errors propagate and stop traversal"},
      {"call": "countWhere(Object.freeze(Array.from({length:1000},(_,i)=>i)),x=>x%2===0)", "expected": 500, "label": "thousand-element count"},
      { call: 'countWhere([1, 2, 3], () => false)', expected: 0 },
      { call: 'countWhere([1, 2, 3, 4, 5, 6], n => n % 3 === 0)', expected: 2 },
      { call: 'countWhere([{ done: true }, { done: false }, { done: true }], task => task.done)', expected: 2 },
    ],
  },

  /* ── recursion ────────────────────────────────────────────────────── */
  'js-easy2-factorial': {
    solution: `const factorial = n => {
  // The base case comes first: without it the calls never stop.
  if (n === 0) return 1;
  return n * factorial(n - 1);
};`,
    junior: `function factorial(n) {
  if (n === 0) {
    return 1;
  }
  const smaller = factorial(n - 1);
  return n * smaller;
}`,
    senior: `const factorial = n => (n <= 1 ? 1 : n * factorial(n - 1));`,
    hiddenTests: [
      {"call": "factorial(18)", "expected": 6402373705728000, "label": "largest supported exact factorial"},
      {"call": "factorial(12)", "expected": 479001600, "label": "beyond the original ten-factor boundary"},
      {"call": "factorial(-0)", "expected": 1, "label": "signed zero is the zero base case"},
      { call: 'factorial(10)', expected: 3628800 },
      { call: 'factorial(2)', expected: 2 },
      { call: 'factorial(7)', expected: 5040 },
    ],
  },
  'js-easy2-power': {
    solution: `const power = (base, exponent) => {
  if (exponent === 0) return 1;
  // Each call takes one factor off the exponent until none is left.
  return base * power(base, exponent - 1);
};`,
    junior: `function power(base, exponent) {
  if (exponent === 0) {
    return 1;
  }
  const smaller = power(base, exponent - 1);
  return base * smaller;
}`,
    senior: `// Halving the exponent needs about log2(exponent) calls instead of exponent.
const power = (base, exponent) => {
  if (exponent === 0) return 1;
  const half = power(base, Math.floor(exponent / 2));
  return exponent % 2 === 0 ? half * half : half * half * base;
};`,
    hiddenTests: [
      {"call": "[Object.is(power(-0,3),-0),Object.is(power(-0,2),+0),power(0,0)]", "expected": [true, true, 1], "label": "signed zeros and zero exponent"},
      {"call": "power(-1.5,5)", "expected": -7.59375, "label": "negative fractional base and odd exponent"},
      {"call": "power(9.5,10)", "expected": 5987369392.383789, "label": "upper exponent with exact half-step base"},
      { call: 'power(5, 4)', expected: 625 },
      { call: 'power(0, 0)', expected: 1 },
      { call: 'power(1.5, 2)', expected: 2.25 },
      { call: 'power(-3, 2)', expected: 9 },
    ],
  },
  'js-easy2-list-to-array': {
    solution: `const toArray = node => {
  // null ends the chain; every other node puts its value in front of the rest.
  if (node === null) return [];
  return [node.value, ...toArray(node.next)];
};`,
    junior: `function toArray(node) {
  if (node === null) {
    return [];
  }
  const rest = toArray(node.next);
  return [node.value].concat(rest);
}`,
    senior: `// Carry the values down instead of copying the tail on every return.
const toArray = (node, values = []) => {
  if (!node) return values;
  values.push(node.value);
  return toArray(node.next, values);
};`,
    hiddenTests: [
      {"call": "(() => {const value=Object.freeze({id:1}),nested=Object.freeze([2]);const tail=Object.freeze({value:undefined,next:null});const mid=Object.freeze({value:nested,next:tail});const head=Object.freeze({value,next:mid});const a=toArray(head),b=toArray(head);return a!==b&&a.length===3&&a[0]===value&&a[1]===nested&&a[2]===undefined&&head.next===mid&&mid.next===tail;})()", "expected": true, "label": "frozen nodes, original opaque identities and fresh results"},
      {"call": "(() => {const a=toArray(null),b=toArray(null);return a!==b&&a.length===0;})()", "expected": true, "label": "each empty result is fresh"},
      {"call": "(() => {let node=null;for(let i=199;i>=0;i--)node=Object.freeze({value:i,next:node});const a=toArray(node);return a.length===200&&a.every((x,i)=>x===i);})()", "expected": true, "label": "two hundred frozen nodes preserve traversal order"},
      { call: 'toArray({ value: null, next: { value: false, next: null } })', expected: [null, false] },
      { call: '(() => { let node = null; for (let n = 5; n >= 1; n--) node = { value: n, next: node }; return toArray(node); })()', expected: [1, 2, 3, 4, 5] },
      { call: 'toArray({ value: [1], next: { value: { x: 1 }, next: null } })', expected: [[1], { x: 1 }] },
    ],
  },

  /* ── nested loops ─────────────────────────────────────────────────── */
  'js-easy2-every-pair': {
    solution: `const allPairs = list => {
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    // Start one past i: no item pairs with itself, and no pair appears twice.
    for (let j = i + 1; j < list.length; j++) {
      pairs.push([list[i], list[j]]);
    }
  }
  return pairs;
};`,
    junior: `const allPairs = list => {
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const first = list[i];
      const second = list[j];
      pairs.push([first, second]);
    }
  }
  return pairs;
};`,
    senior: `const allPairs = list => list.flatMap((first, i) => list.slice(i + 1).map(second => [first, second]));`,
    hiddenTests: [
      { call: 'allPairs([1, 2, 3, 4]).length', expected: 6 },
      { call: 'allPairs(["x", "y", "z", "w"])', expected: [['x', 'y'], ['x', 'z'], ['x', 'w'], ['y', 'z'], ['y', 'w'], ['z', 'w']] },
      { call: 'allPairs([true, false])', expected: [[true, false]] },
    ],
  },
  'js-easy2-find-in-grid': {
    solution: `const findInGrid = (grid, target) => {
  for (let row = 0; row < grid.length; row++) {
    // Each row uses its own length: rows can differ.
    for (let column = 0; column < grid[row].length; column++) {
      if (grid[row][column] === target) return [row, column];
    }
  }
  return null;
};`,
    junior: `const findInGrid = (grid, target) => {
  for (let row = 0; row < grid.length; row++) {
    const cells = grid[row];
    for (let column = 0; column < cells.length; column++) {
      const cell = cells[column];
      if (cell === target) {
        return [row, column];
      }
    }
  }
  return null;
};`,
    senior: `const findInGrid = (grid, target) => {
  for (const [row, cells] of grid.entries()) {
    const column = cells.indexOf(target);
    if (column !== -1) return [row, column];
  }
  return null;
};`,
    hiddenTests: [
      { call: 'findInGrid([], 1)', expected: null },
      { call: 'findInGrid([[0, 1, 2], [3, 4], [5]], 5)', expected: [2, 0] },
      { call: 'findInGrid([["x"], ["y", "target"]], "target")', expected: [1, 1] },
    ],
  },

  /* ── two pointers ─────────────────────────────────────────────────── */
  'js-easy2-sorted-squares': {
    solution: `const sortedSquares = sorted => {
  const result = new Array(sorted.length);
  let left = 0;
  let right = sorted.length - 1;
  // Fill from the back: the larger end square is the biggest one left.
  for (let write = sorted.length - 1; write >= 0; write--) {
    const leftSquare = sorted[left] * sorted[left];
    const rightSquare = sorted[right] * sorted[right];
    if (leftSquare > rightSquare) {
      result[write] = leftSquare;
      left++;
    } else {
      result[write] = rightSquare;
      right--;
    }
  }
  return result;
};`,
    junior: `const sortedSquares = sorted => {
  const result = [];
  let left = 0;
  let right = sorted.length - 1;
  while (left <= right) {
    const leftSquare = sorted[left] * sorted[left];
    const rightSquare = sorted[right] * sorted[right];
    if (leftSquare > rightSquare) {
      result.push(leftSquare);
      left = left + 1;
    } else {
      result.push(rightSquare);
      right = right - 1;
    }
  }
  return result.reverse();
};`,
    senior: `const sortedSquares = sorted => {
  const result = Array(sorted.length);
  for (let left = 0, right = sorted.length - 1, write = right; left <= right; write--) {
    result[write] = Math.abs(sorted[left]) > Math.abs(sorted[right]) ? sorted[left++] ** 2 : sorted[right--] ** 2;
  }
  return result;
};`,
    hiddenTests: [
      { call: 'sortedSquares([0])', expected: [0] },
      { call: 'sortedSquares([-5, 5])', expected: [25, 25] },
      { call: 'sortedSquares([-10, -2, 1, 1, 4])', expected: [1, 1, 4, 16, 100] },
      { call: '(() => { const input = [-2, 1]; sortedSquares(input); return input; })()', expected: [-2, 1] },
    ],
  },
  'js-easy2-reverse-vowels': {
    solution: `const reverseVowels = text => {
  const isVowel = char => "aeiouAEIOU".includes(char);
  // Strings cannot change in place, so swap inside an array of characters.
  const chars = text.split("");
  let left = 0;
  let right = chars.length - 1;
  while (left < right) {
    if (!isVowel(chars[left])) {
      left++;
    } else if (!isVowel(chars[right])) {
      right--;
    } else {
      [chars[left], chars[right]] = [chars[right], chars[left]];
      left++;
      right--;
    }
  }
  return chars.join("");
};`,
    junior: `const reverseVowels = text => {
  const vowels = "aeiouAEIOU";
  const chars = text.split("");
  let left = 0;
  let right = chars.length - 1;
  while (left < right) {
    while (left < right && !vowels.includes(chars[left])) {
      left = left + 1;
    }
    while (left < right && !vowels.includes(chars[right])) {
      right = right - 1;
    }
    const temporary = chars[left];
    chars[left] = chars[right];
    chars[right] = temporary;
    left = left + 1;
    right = right - 1;
  }
  return chars.join("");
};`,
    senior: `const VOWELS = new Set("aeiouAEIOU");
const reverseVowels = text => {
  const chars = [...text];
  for (let left = 0, right = chars.length - 1; left < right; ) {
    if (!VOWELS.has(chars[left])) left++;
    else if (!VOWELS.has(chars[right])) right--;
    else [chars[left++], chars[right--]] = [chars[right], chars[left]];
  }
  return chars.join("");
};`,
    hiddenTests: [
      { call: 'reverseVowels("leetcode")', expected: 'leotcede' },
      { call: 'reverseVowels("a")', expected: 'a' },
      { call: 'reverseVowels("Hello World")', expected: 'Hollo Werld' },
      { call: 'reverseVowels("AEIOU")', expected: 'UOIEA' },
    ],
  },
  'js-easy2-outside-in': {
    solution: `const outsideIn = list => {
  const result = [];
  let left = 0;
  let right = list.length - 1;
  while (left <= right) {
    result.push(list[left]);
    // When the pointers meet, the middle item goes in once.
    if (left !== right) result.push(list[right]);
    left += 1;
    right -= 1;
  }
  return result;
};`,
    junior: `const outsideIn = list => {
  const result = [];
  let left = 0;
  let right = list.length - 1;
  while (left <= right) {
    const fromLeft = list[left];
    result.push(fromLeft);
    if (left < right) {
      const fromRight = list[right];
      result.push(fromRight);
    }
    left = left + 1;
    right = right - 1;
  }
  return result;
};`,
    senior: `const outsideIn = list => {
  const result = [];
  for (let left = 0, right = list.length - 1; left <= right; left++, right--) {
    result.push(list[left]);
    if (left < right) result.push(list[right]);
  }
  return result;
};`,
    hiddenTests: [
      { call: 'outsideIn([1, 2])', expected: [1, 2] },
      { call: 'outsideIn([10, 20, 30, 40, 50, 60])', expected: [10, 60, 20, 50, 30, 40] },
      { call: 'outsideIn([0, 0, 1])', expected: [0, 1, 0] },
    ],
  },

  /* ── slice ────────────────────────────────────────────────────────── */
  'js-easy2-page-of-results': {
    solution: `const page = (items, pageNumber, pageSize) => {
  // Every earlier page holds pageSize items, and pages count from 1.
  const start = (pageNumber - 1) * pageSize;
  return items.slice(start, start + pageSize);
};`,
    junior: `const page = (items, pageNumber, pageSize) => {
  const pagesBefore = pageNumber - 1;
  const start = pagesBefore * pageSize;
  const end = start + pageSize;
  const pageItems = items.slice(start, end);
  return pageItems;
};`,
    senior: `const page = (items, pageNumber, pageSize) => items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);`,
    hiddenTests: [
      { call: 'page([], 1, 10)', expected: [] },
      { call: 'page([1, 2, 3, 4, 5, 6, 7], 2, 3)', expected: [4, 5, 6] },
      { call: 'page(["only"], 1, 5)', expected: ['only'] },
    ],
  },

  /* ── async and await ──────────────────────────────────────────────── */
  'js-easy2-await-both': {
    solution: `const addBoth = async (first, second) => {
  // Both producers are running. Observe second now, even if first never fulfills.
  const pendingOutcome = Promise.allSettled([second]);
  const a = await first;
  const [outcome] = await pendingOutcome;
  if (outcome.status === "rejected") throw outcome.reason;
  return a + outcome.value;
};`,
    junior: `const addBoth = async (first, second) => {
  const secondOutcome = second.then(
    value => ({ ok: true, value }),
    reason => ({ ok: false, reason })
  );
  const firstValue = await first;
  const result = await secondOutcome;
  if (!result.ok) throw result.reason;
  return firstValue + result.value;
};`,
    senior: `const addBoth = async (first, second) => {
  const observed = Promise.allSettled([second]);
  const a = await first;
  const [b] = await observed;
  if (b.status === "rejected") throw b.reason;
  return a + b.value;
};`,
    hiddenTests: [
      {
        call: `(() => {
          const reason = Object.freeze({ input: "first" });
          const never = new Promise(() => {});
          return addBoth(Promise.reject(reason), never).then(() => false, error => error === reason);
        })()`,
        expected: true, async: true, label: 'the first rejection is delivered even when the second promise never settles',
      },
      { call: "(async()=>{const firstReason=Object.freeze({}),secondReason=Symbol('second'),first=new Promise((_,reject)=>setTimeout(()=>reject(firstReason),30)),second=Promise.reject(secondReason);first.catch(()=>{});second.catch(()=>{});return addBoth(first,second).then(()=>false,error=>error===firstReason);})()", expected: true, async: true },
      { call: "(async()=>{const bad=Promise.reject('second');bad.catch(()=>{});return Promise.race([addBoth(new Promise(()=>{}),bad).then(()=>'settled',()=>'settled'),new Promise(done=>setTimeout(()=>done('pending'),80))]);})()", expected: "pending", async: true },
      { call: "(async()=>{const values=[];for(const [a,b] of [[-0,-0],[0.5,0.25],[10000000000000000,-10000000000000000]])values.push(Object.is(await addBoth(Promise.resolve(a),Promise.resolve(b)),a+b));const first=Object.freeze(Promise.resolve(2)),out=addBoth(first,Promise.resolve(3));return [values,out instanceof Promise,out!==first,await out];})()", expected: [[true, true, true], true, true, 5], async: true },
      { call: "(async()=>{const reason=Object.freeze({}),bad=Promise.reject(reason);bad.catch(()=>{});return addBoth(Promise.resolve(1),bad).then(()=>false,error=>error===reason);})()", expected: true, async: true },

      { call: 'addBoth(Promise.resolve(0.5), Promise.resolve(0.25))', expected: 0.75, async: true },
      { call: 'addBoth(new Promise(resolve => setTimeout(() => resolve(1), 15)), new Promise(resolve => setTimeout(() => resolve(2), 5)))', expected: 3, async: true },
      { call: '(() => { const failing = Promise.reject(new Error("first failed")); failing.catch(() => {}); return addBoth(failing, Promise.resolve(2)).then(() => "resolved", error => error.message); })()', expected: 'first failed', async: true },
      { call: 'addBoth(Promise.resolve(1), Promise.resolve(1)) instanceof Promise', expected: true },
    ],
  },
  'js-easy2-await-or-default': {
    solution: `const loadOr = async (load, fallback) => {
  try {
    // await inside try: a rejection and a synchronous throw both land in catch.
    return await load();
  } catch {
    return fallback;
  }
};`,
    junior: `const loadOr = async (load, fallback) => {
  let result;
  try {
    result = await load();
  } catch (error) {
    result = fallback;
  }
  return result;
};`,
    senior: "const loadOr = async (load, fallback) => {\n  try { return await load(); }\n  catch { return fallback; }\n};",
    hiddenTests: [
      { call: "(async()=>{const fn=()=>1,sym=Symbol('x'),obj=Object.freeze({}),out=[];for(const value of [undefined,false,'',NaN,-0,fn,sym,obj])out.push(Object.is(await loadOr(()=>Promise.resolve(value),'unused'),value));return out;})()", expected: [true, true, true, true, true, true, true, true], async: true },
      { call: "(async()=>{let calls=0;const fn=()=>{calls++;},sym=Symbol('x'),obj=Object.freeze({}),out=[];for(const fallback of [fn,sym,obj,undefined,-0]){out.push(Object.is(await loadOr(()=>{throw null;},fallback),fallback));out.push(Object.is(await loadOr(()=>Promise.reject(false),fallback),fallback));}return [out,calls];})()", expected: [[true, true, true, true, true, true, true, true, true, true], 0], async: true },
      { call: "(async()=>{let calls=0,args=-1;const out=loadOr(function(){calls++;args=arguments.length;return Promise.resolve(0);},1);return [out instanceof Promise,await out,calls,args];})()", expected: [true, 0, 1, 0], async: true },

      { call: 'loadOr(() => new Promise(resolve => setTimeout(() => resolve([1, 2]), 10)), [])', expected: [1, 2], async: true },
      { call: 'loadOr(() => new Promise((resolve, reject) => setTimeout(() => reject(new Error("late failure")), 10)), "fallback")', expected: 'fallback', async: true },
      { call: 'loadOr(() => Promise.resolve(null), "default")', expected: null, async: true },
    ],
  },

  /* ── closures ─────────────────────────────────────────────────────── */
  'js-easy2-running-average': {
    solution: `const makeAverager = () => {
  // Each call to makeAverager gets its own total and count.
  let total = 0;
  let count = 0;
  return value => {
    total += value;
    count += 1;
    return total / count;
  };
};`,
    junior: `const makeAverager = () => {
  let total = 0;
  let count = 0;
  function average(value) {
    total = total + value;
    count = count + 1;
    const result = total / count;
    return result;
  }
  return average;
};`,
    senior: `const makeAverager = () => {
  let total = 0;
  let count = 0;
  return value => (total += value) / ++count;
};`,
    hiddenTests: [
      {"call": "(() => {const a=makeAverager();a(0);a(0);return a(1);})()", "expected": 0.3333333333333333, "label": "do not round repeating fractional averages"},
      {"call": "(() => {const a=makeAverager();let out;for(let i=0;i<1000;i++)out=a(i);return out;})()", "expected": 499.5, "label": "thousand-update call history"},
      {"call": "(() => {const a=makeAverager(),b=makeAverager();return [a(-1000000),b(1000000),a(1000000),b(-1000000),a(0.5),b(-0.5)];})()", "expected": [-1000000, 1000000, 0, 0, 0.16666666666666666, -0.16666666666666666], "label": "interleaved independent signed and fractional totals"},
      { call: '(() => { const avg = makeAverager(); avg(-5); return avg(5); })()', expected: 0 },
      { call: '(() => { const avg = makeAverager(); return [avg(1), avg(2), avg(6)]; })()', expected: [1, 1.5, 3] },
      { call: '(() => { const avg = makeAverager(); return [avg(2.5), avg(3.5)]; })()', expected: [2.5, 3] },
    ],
  },
};
