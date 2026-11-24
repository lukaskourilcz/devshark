// The Easy band of the JavaScript track, first wave (#226).
//
// Thirty tier 1 and tier 2 challenges written against the technique-coverage
// matrix that `npm run test:coding` prints: every focus tag on a Medium
// JavaScript challenge gets at least three Easy ones. This wave covers flat,
// for...in, promises, recursion, timers, callbacks, higher-order functions,
// nested loops and two pointers, then adds async/await, closures and slice.
//
// Each challenge practises one technique (two focus tags at most), fits in ten
// minutes and starts from a starter that fails its own checks. The first
// focus tag names the documentation page that ends the hint ladder.
//
// Later waves copy this layout: `easy-<track>-<wave>.ts` here, the matching
// file under `../solutions/`, and one line in `EASY_BAND` in `../catalog.ts`.
// These challenges fill the Coding section and never enter a Learn level's
// quota.
//
// Task bodies only: prompts, starters, visible tests, hints. No solutions.

import type { CodingTaskSource } from '../types';

export const EASY_JAVASCRIPT_A_TASKS: CodingTaskSource[] = [
  /* ── flat ─────────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-flatten-once',
    track: 'javascript',
    topic: 'javascript',
    level: 4,
    tier: 1,
    focus: ['flat'],
    title: 'Flatten one level',
    prompt: "Write `flattenOnce(list)`, returning a new array with exactly one level of nesting removed. The outer array and its immediate child arrays are dense. Keep element order and do not change any input array. Values and deeper arrays keep their identity: this is a shallow operation. `[1, [2, [3]]]` becomes `[1, 2, [3]]`; empty child arrays add nothing, and an empty input still returns a new empty array. `flat()` is one useful approach. Target: O(n) time, where n counts outer entries plus entries in immediate child arrays; deeper arrays are not traversed.",
    starter: `const flattenOnce = list => {

};

// Scratch pad. Change this and press Run.
console.log(flattenOnce([1, [2, 3], [4]]));
`,
    skeleton: `const flattenOnce = list => {
  return /* list with one level of nesting removed */;
};`,
    hints: ["Distinguish an array directly inside the list from one inside that array. Only the first layer is unpacked; non-array values stay in place."],
    approach: [
      'Call `flat()` on the list. With no argument its depth is 1.',
      'Return what it gives back. It is a new array, so the input keeps its nesting.',
      'Items that are not arrays pass through as they are, and an empty inner array adds nothing.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'flattenOnce([1, [2, 3], [4]])', expected: [1, 2, 3, 4] },
      { call: 'flattenOnce([["a"], ["b", "c"]])', expected: ['a', 'b', 'c'] },
      { call: 'flattenOnce([1, [2, [3]]])', expected: [1, 2, [3]], label: 'only one level comes off', edge: true },
      { call: 'flattenOnce([[], [1], []])', expected: [1], label: 'empty inner arrays add nothing', edge: true },
      { call: '(() => { const list = [1, [2]]; flattenOnce(list); return list; })()', expected: [1, [2]], label: 'the input keeps its nesting', edge: true },
    ],
  },
  {
    id: 'js-easy2-all-tags',
    track: 'javascript',
    topic: 'javascript',
    level: 6,
    tier: 1,
    focus: ['flat', 'map'],
    title: 'Every tag in one list',
    prompt: "Each post is `{ title, tags }`, where `tags` is an array of strings. Write `allTags(posts)`, returning one array of every tag, post by post and in order: map each post to its tags, then flatten the result with `flat()`. `allTags([{ title: \"A\", tags: [\"js\", \"css\"] }, { title: \"B\", tags: [\"html\"] }])` gives `[\"js\", \"css\", \"html\"]`. A tag used twice appears twice, and a post with no tags adds nothing. Inputs are ordinary dense arrays and data objects with own tags arrays of primitive strings; empty tag strings are valid. Always return a fresh array, including for one post or no posts. Do not change posts, titles or tag arrays; frozen inputs are valid. Target: O(n) time, where n is the number of posts plus the total number of tag entries; copying a string reference takes constant time.",
    starter: `const allTags = posts => {

};

// Scratch pad. Change this and press Run.
console.log(allTags([{ title: "A", tags: ["js", "css"] }, { title: "B", tags: ["html"] }]));
`,
    skeleton: `const allTags = posts => {
  const tagLists = posts.map(/* each post to its tags */);
  return /* tagLists with one level removed */;
};`,
    hints: ['`map` gives you an array of arrays, one per post. `flat()` turns that into one array.'],
    approach: [
      'Map every post to its `tags` array. You now hold one array per post.',
      'Call `flat()` on that result to join the arrays end to end, in post order.',
      'Leave duplicates in: the task asks for every tag, not every distinct one.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'allTags([{ title: "A", tags: ["js", "css"] }, { title: "B", tags: ["html"] }])', expected: ['js', 'css', 'html'] },
      { call: 'allTags([{ title: "A", tags: ["js"] }, { title: "B", tags: ["js", "node"] }])', expected: ['js', 'js', 'node'], label: 'a repeated tag stays' },
      { call: 'allTags([{ title: "A", tags: [] }, { title: "B", tags: ["x"] }])', expected: ['x'], label: 'a post with no tags adds nothing', edge: true },
      { call: 'allTags([])', expected: [], label: 'no posts', edge: true },
      { call: "(() => {const tags=[\"b\",\"a\"],post={title:\"A\",tags};const out=allTags([post]);return out!==tags&&out.length===2&&out[0]===\"b\"&&out[1]===\"a\"&&post.title===\"A\"&&post.tags===tags&&tags[0]===\"b\"&&tags[1]===\"a\";})()", expected: true, label: "fresh result and unchanged source tag order", edge: true },
      { call: "allTags(Object.freeze([Object.freeze({title:\"A\",tags:Object.freeze([\"\",\"x\",\"\"])}),Object.freeze({title:\"B\",tags:Object.freeze([])})]))", expected: ["", "x", ""], label: "frozen inputs and empty tag values", edge: true },
      { call: "(() => {const posts=[];const a=allTags(posts),b=allTags(posts);return a!==posts&&a!==b&&a.length===0&&b.length===0;})()", expected: true, label: "fresh empty results", edge: true },
    ],
  },
  {
    id: 'js-easy2-menu-items',
    track: 'javascript',
    topic: 'javascript',
    level: 6,
    tier: 2,
    focus: ['flat'],
    title: 'Two levels down',
    prompt: "A menu is an array of sections, each section is an array of groups, and each group is an array of dish names. Write `menuItems(menu)`, returning every dish in one flat array, in order, with a single call to `flat` given the right depth. `menuItems([[[\"soup\"], [\"bread\", \"salad\"]], [[\"cake\"]]])` gives `[\"soup\", \"bread\", \"salad\", \"cake\"]`. Empty sections and empty groups add nothing. All levels are ordinary dense arrays and every dish name is a primitive string, including empty strings, spaces and repeats. Keep every dish exactly as stored. Do not change any input level; frozen sections and groups are valid. Return a fresh array, even for one group or an empty menu. Target: O(n) time, where n counts sections, groups and dish entries together; copying string references takes constant time.",
    starter: `const menuItems = menu => {

};

// Scratch pad. Change this and press Run.
console.log(menuItems([[["soup"], ["bread", "salad"]], [["cake"]]]));
`,
    skeleton: `const menuItems = menu => {
  return menu.flat(/* how many levels of brackets sit around a dish? */);
};`,
    hints: ['Count the brackets around a dish below the menu itself: one for its section, one for its group. `flat` takes that count as its argument.'],
    approach: [
      'Count the levels of nesting under the menu: sections hold groups, and groups hold dishes.',
      'Pass that number to `flat`, which removes that many levels in one call.',
      'Empty sections and groups flatten to nothing, so they need no special case.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'menuItems([[["soup"], ["bread", "salad"]], [["cake"]]])', expected: ['soup', 'bread', 'salad', 'cake'] },
      { call: 'menuItems([[["tea", "coffee"]]])', expected: ['tea', 'coffee'] },
      { call: 'menuItems([[], [["pie"]], [[]]])', expected: ['pie'], label: 'empty sections and groups add nothing', edge: true },
      { call: 'menuItems([])', expected: [], label: 'an empty menu', edge: true },
      { call: "menuItems([[[\"\",\"x\",\"x\",\" \"]],[]])", expected: ["", "x", "x", " "], label: "empty dish names and repetitions remain", edge: true },
      { call: "menuItems(Object.freeze([Object.freeze([Object.freeze([\"b\",\"a\"])])]))", expected: ["b", "a"], label: "frozen nested input", edge: true },
      { call: "(() => {const group=[\"b\",\"a\"],menu=[[group]];const out=menuItems(menu);return out!==group&&out!==menu&&out.length===2&&group[0]===\"b\"&&group[1]===\"a\";})()", expected: true, label: "fresh result and unchanged group order", edge: true },
      { call: "(() => {const menu=[];const first=menuItems(menu),second=menuItems(menu);return first!==menu&&first!==second&&first.length===0&&second.length===0;})()", expected: true, label: "fresh empty results", edge: true },
    ],
  },

  /* ── for...in ─────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-keys-with-value',
    track: 'javascript',
    topic: 'javascript',
    level: 5,
    tier: 1,
    focus: ['for-in', 'objects'],
    title: 'Keys that hold a value',
    prompt: "Write `keysWithValue(object, value)`, returning an array of the keys whose value is strictly equal to `value`, in the order a `for…in` loop visits them. `keysWithValue({ a: 1, b: 2, c: 1 }, 1)` gives `[\"a\", \"c\"]`. No match gives an empty array, and the string `\"1\"` does not match the number `1`. This exercise deliberately includes inherited enumerable string keys, exactly as `for...in` does; symbol and non-enumerable keys are excluded. Own properties shadow inherited properties of the same name, even when the own property is non-enumerable. Inputs are ordinary data objects without getters or proxies; do not mutate them or their prototypes, and accept null-prototype or frozen objects. Strict equality means NaN never matches, 0 matches -0, and object values match only by reference. Target: O(n) time, where n counts property names and prototype objects inspected; assume constant-time property access and equality.",
    starter: `const keysWithValue = (object, value) => {

};

// Scratch pad. Change this and press Run.
console.log(keysWithValue({ a: 1, b: 2, c: 1 }, 1));
`,
    skeleton: `const keysWithValue = (object, value) => {
  const keys = [];

  for (const key in object) {
    // keep the key when its value is strictly equal to value
  }

  return keys;
};`,
    hints: ["Compare the value read with bracket notation using strict equality. Unlike Object.keys, a for...in loop also reaches inherited enumerable keys; decide whether an own key hides an inherited one."],
    approach: ["Start a fresh array, then visit enumerable string keys with for...in. In this exercise inherited keys are intentionally included.", "Read object[key] and append the key only when the value is strictly equal to the query. Do not replace === with Object.is or coercive equality.", "Return the array. For an application that needs only own keys, add Object.hasOwn or use Object.keys instead; that is a different contract."],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'keysWithValue({ a: 1, b: 2, c: 1 }, 1)', expected: ['a', 'c'] },
      { call: 'keysWithValue({ mon: "open", tue: "closed", wed: "open" }, "open")', expected: ['mon', 'wed'] },
      { call: 'keysWithValue({ a: 1 }, 5)', expected: [], label: 'no match gives an empty array', edge: true },
      { call: 'keysWithValue({ a: "1", b: 1 }, 1)', expected: ['b'], label: 'a string never equals a number', edge: true },
      { call: 'keysWithValue({}, 0)', expected: [], label: 'an empty object', edge: true },
      { call: "(() => { const parent={p:1,a:1}; const o=Object.create(parent);o.b=1;o.a=2;return keysWithValue(o,1); })()", expected: ["b", "p"], label: "inherited keys with own shadowing", edge: true },
      { call: "(() => { const o=Object.create({x:1,y:1});Object.defineProperty(o,\"x\",{value:1,enumerable:false});o[Symbol(\"s\")]=1;return keysWithValue(o,1); })()", expected: ["y"], label: "non-enumerable own key hides inherited key", edge: true },
      { call: "keysWithValue({a:NaN,b:NaN},NaN)", expected: [], label: "NaN is not strictly equal to itself", edge: true },
      { call: "keysWithValue({a:0,b:-0},-0)", expected: ["a", "b"], label: "strict equality includes both zero signs", edge: true },
      { call: "(() => { const value={id:1}; const o=Object.freeze(Object.assign(Object.create(null),{a:value,b:{id:1},c:value})); return keysWithValue(o,value); })()", expected: ["a", "c"], label: "reference equality and frozen null-prototype input", edge: true },
      { call: "keysWithValue({\"10\":1,\"2\":1,z:1},1)", expected: ["2", "10", "z"], label: "integer key order", edge: true },
    ],
  },
  {
    id: 'js-easy2-invert-object',
    track: 'javascript',
    topic: 'javascript',
    level: 5,
    tier: 1,
    focus: ['for-in', 'objects'],
    title: 'Swap keys and values',
    prompt: "Write `invert(object)`, returning a fresh dictionary whose keys are the original values and whose values are the original keys. Consider only own enumerable string keys, in Object.keys order; loop with `for...in` and ignore inherited keys. For example, `invert({ a: \"x\", b: \"y\" })` gives `{ x: \"a\", y: \"b\" }`. When values repeat, the last visited original key wins. Values are primitive strings or finite numbers; convert numbers to property names with JavaScript string conversion. All string names, including `__proto__`, `constructor` and the empty string, must work as own data keys. Inputs are ordinary data objects without getters or proxies, including null-prototype and frozen objects. Do not change the input. The result may have a null prototype. Target: O(n) time, where n counts inspected property names and prototype objects, plus the total length of those names and converted own values, using average constant-time dictionary access.",
    starter: `const invert = object => {

};

// Scratch pad. Change this and press Run.
console.log(invert({ a: "x", b: "y" }));
`,
    skeleton: "const invert = object => {\n  const inverted = Object.create(null);\n  for (const key in object) {\n    // ignore inherited keys, then store the old key under the old value\n  }\n  return inverted;\n};",
    hints: ["Use the old value as a dictionary key and the old key as its value. A null-prototype dictionary avoids inherited setters and reserved property names; check ownership while iterating the input."],
    approach: ["Create a dictionary with Object.create(null), so names such as __proto__ are ordinary data keys.", "Visit enumerable string keys with for...in and keep only keys for which Object.hasOwn(object, key) is true.", "Assign each original key under its converted value. Assignment overwrites an earlier match, so the last visited key wins. Return the dictionary."],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'invert({ a: "x", b: "y" })', expected: { x: 'a', y: 'b' } },
      { call: 'invert({ red: "#f00", green: "#0f0" })', expected: { '#f00': 'red', '#0f0': 'green' } },
      { call: 'invert({ first: "same", second: "same" })', expected: { same: 'second' }, label: 'the last key with a value wins', edge: true },
      { call: 'invert({})', expected: {}, label: 'an empty object', edge: true },
      { call: '(() => { const input = { a: "b" }; invert(input); return input; })()', expected: { a: 'b' }, label: 'the input is not changed', edge: true },
      { call: "(() => { const o=Object.create({inherited:\"bad\"});o.own=\"ok\";Object.defineProperty(o,\"hidden\",{value:\"secret\"});o[Symbol(\"s\")]=\"symbol\";return invert(o); })()", expected: {"ok": "own"}, label: "ignore inherited non-enumerable and symbol keys", edge: true },
      { call: "(() => { const out=invert(Object.freeze({a:\"__proto__\",b:\"constructor\",c:\"\"})); return Object.hasOwn(out,\"__proto__\")&&out.__proto__===\"a\"&&Object.hasOwn(out,\"constructor\")&&out.constructor===\"b\"&&out[\"\"]===\"c\"; })()", expected: true, label: "special names are own data keys", edge: true },
      { call: "invert({\"10\":\"same\",\"2\":\"same\",a:\"same\"})", expected: {"same": "a"}, label: "last visited key follows property order", edge: true },
      { call: "invert(Object.assign(Object.create(null),{a:0,b:-0,c:1.5}))", expected: {"0": "b", "1.5": "c"}, label: "numeric conversion and null-prototype input", edge: true },
      { call: "(() => { const o={}; const out=invert(o); return out!==o&&Object.keys(out).length===0; })()", expected: true, label: "fresh empty dictionary", edge: true },
    ],
  },
  {
    id: 'js-easy2-own-keys-only',
    track: 'javascript',
    topic: 'javascript',
    level: 5,
    tier: 2,
    focus: ['for-in', 'objects'],
    title: 'Own keys only',
    prompt: "A `for…in` loop also visits keys an object inherits from its prototype. Write `ownKeys(object)`, returning only the keys the object holds itself, in loop order, by checking each key with `Object.hasOwn(object, key)` inside a `for…in` loop. With `const item = Object.create({ shared: true })` and then `item.name = \"pen\"`, `ownKeys(item)` gives `[\"name\"]`. An object with no keys of its own gives an empty array. Only enumerable string keys are included; symbol and non-enumerable keys are excluded. For ordinary objects, array-index names come first in numeric order, followed by other string names in creation order. Inputs have data properties without getters or proxies; accept null-prototype and frozen objects, including a key named hasOwnProperty. Return a fresh array and do not mutate the input or its prototypes. Target: O(n) time, where n counts property names and prototype objects inspected, assuming constant-time ownership checks.",
    starter: `const ownKeys = object => {

};

// Scratch pad. Change this and press Run.
const item = Object.create({ shared: true });
item.name = "pen";
console.log(ownKeys(item));
`,
    skeleton: `const ownKeys = object => {
  const keys = [];

  for (const key in object) {
    // skip the key unless the object holds it itself
  }

  return keys;
};`,
    hints: ['Log every key a plain `for…in` visits on the scratch-pad `item`: `shared` comes from the prototype. `Object.hasOwn(object, key)` is `true` only for the object’s own keys.'],
    approach: [
      'Start an empty array and loop over the object with `for…in`.',
      'For each key, ask `Object.hasOwn(object, key)` whether the object holds that key itself.',
      'Push the key only when the answer is `true`. An own key that shadows an inherited one is still an own key, and the loop visits it once.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'ownKeys({ a: 1, b: 2 })', expected: ['a', 'b'] },
      { call: 'ownKeys(Object.assign(Object.create({ shared: true }), { name: "pen" }))', expected: ['name'], label: 'inherited keys are skipped' },
      { call: 'ownKeys(Object.create({ inherited: 1 }))', expected: [], label: 'only inherited keys', edge: true },
      { call: 'ownKeys({})', expected: [], label: 'an empty object', edge: true },
      { call: 'ownKeys(Object.assign(Object.create({ size: "M" }), { size: "L" }))', expected: ['size'], label: 'an own key that shadows an inherited one appears once', edge: true },
      { call: "(() => {const o=Object.assign(Object.create(null),{hasOwnProperty:0,a:1});return ownKeys(Object.freeze(o));})()", expected: ["hasOwnProperty", "a"], label: "borrowed ownership checks work without a prototype", edge: true },
      { call: "(() => {const o={a:1};Object.defineProperty(o,\"hidden\",{value:2});o[Symbol(\"s\")]=3;return ownKeys(o);})()", expected: ["a"], label: "exclude non-enumerable and symbol keys", edge: true },
      { call: "ownKeys({\"10\":1,\"2\":1,z:1})", expected: ["2", "10", "z"], label: "integer names precede other keys", edge: true },
      { call: "(() => {const o=Object.create({x:1});Object.defineProperty(o,\"x\",{value:2,enumerable:false});return ownKeys(o);})()", expected: [], label: "hidden own property is not emitted", edge: true },
      { call: "(() => {const o={a:1};ownKeys(o);return o.a===1&&Object.keys(o).length===1;})()", expected: true, label: "preserve the source object", edge: true },
    ],
  },

  /* ── promises ─────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-double-later',
    track: 'javascript',
    topic: 'javascript',
    level: 21,
    tier: 2,
    focus: ['promises'],
    title: 'Double it when it arrives',
    prompt: "Write `doubleLater(promise)`, returning a promise of twice the number `promise` resolves to, using `.then`. `doubleLater(Promise.resolve(4))` resolves to 8. When `promise` rejects, the promise you return rejects with the same error. The input is an ordinary native Promise with standard methods, possibly pending. Fulfillment is a finite Number between -1000000000 and 1000000000, including -0; use normal Number multiplication without rounding. Return a new native Promise immediately, distinct from the input; fulfillment handlers run asynchronously. Rejection reasons can be any value: preserve the exact original value/reference, not just an Error message. Do not change user-visible properties of the input promise. Target: O(1) time for wrapper work and O(1) space for retained chain state, excluding waiting, producer work and host promise scheduling.",
    starter: `const doubleLater = promise => {

};

// Scratch pad. Uncomment once your function returns a promise.
// doubleLater(Promise.resolve(4)).then(value => console.log(value));
`,
    skeleton: `const doubleLater = promise => {
  return promise.then(value => {
    return /* twice the value */;
  });
};`,
    hints: ['`.then(callback)` returns a new promise that resolves to whatever the callback returns. A rejection skips the callback and passes straight through.'],
    approach: [
      'Call `.then` on the promise you were given and return the promise it creates.',
      'Inside the callback, return the value times two.',
      'Leave rejections alone: without a `.catch`, the error reaches whoever waits on your promise.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'doubleLater(Promise.resolve(4))', expected: 8, async: true },
      { call: 'doubleLater(Promise.resolve(-2.5))', expected: -5, async: true },
      { call: 'doubleLater(Promise.resolve(0))', expected: 0, label: 'zero doubles to zero', edge: true, async: true },
      { call: '(() => { const failing = Promise.reject(new Error("offline")); failing.catch(() => {}); return doubleLater(failing).catch(error => error.message); })()', expected: 'offline', label: 'a rejection passes through unchanged', edge: true, async: true },
      { call: 'doubleLater(Promise.resolve(1)) instanceof Promise', expected: true, label: 'it returns a promise' },
    ],
  },
  {
    id: 'js-easy2-fallback-on-failure',
    track: 'javascript',
    topic: 'javascript',
    level: 21,
    tier: 2,
    focus: ['promises'],
    title: 'Fall back on failure',
    prompt: "Write `withFallback(promise, fallback)`, returning a promise that resolves to whatever `promise` resolves to, or to `fallback` when `promise` rejects, using `.catch`. `withFallback(Promise.resolve(\"fresh\"), \"cached\")` resolves to `\"fresh\"`, and a rejected promise gives `\"cached\"`. A resolved `0` or `undefined` is a success and is kept. promise is an ordinary native Promise with standard methods, possibly pending. Preserve the exact fulfilled value/reference, including false, empty text, NaN, -0, functions, Symbols and frozen records; never clone or coerce it. fallback is an opaque nonthenable value or an ordinary native Promise. A rejection uses that exact value; a promise fallback is adopted, including its rejection. A function fallback is a value, not a factory to invoke. A successful input must not use the fallback. Return a new native Promise immediately and leave user-visible input properties unchanged. Target: O(1) time for wrapper work and O(1) space for retained chain state, excluding waiting, producer work, adopted-promise work and host scheduling.",
    starter: `const withFallback = (promise, fallback) => {

};

// Scratch pad. Uncomment once your function returns a promise.
// withFallback(Promise.resolve("fresh"), "cached").then(value => console.log(value));
`,
    skeleton: `const withFallback = (promise, fallback) => {
  return promise.catch(() => {
    return /* the value to use instead */;
  });
};`,
    hints: ['`.catch(callback)` runs only when the promise rejects, and the promise it returns resolves to what the callback returns. A resolved value passes through untouched. Returning a promise from catch makes the chain follow that promise’s outcome.'],
    approach: [
      'Chain `.catch` onto the promise you were given and return the result.',
      'In the callback, ignore the error and return the fallback.',
      'Avoid `||` on the resolved value: it would swap a real `0` for the fallback.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'withFallback(Promise.resolve("fresh"), "cached")', expected: 'fresh', async: true },
      { call: '(() => { const failing = Promise.reject(new Error("offline")); failing.catch(() => {}); return withFallback(failing, "cached"); })()', expected: 'cached', label: 'a rejection gives the fallback', async: true },
      { call: 'withFallback(Promise.resolve(0), 10)', expected: 0, label: 'a resolved zero is kept', edge: true, async: true },
      { call: 'withFallback(Promise.resolve(undefined), "default")', expected: undefined, label: 'a resolved undefined is still a success', edge: true, async: true },
      { call: '(() => { const failing = Promise.reject(new Error("x")); failing.catch(() => {}); return withFallback(failing, null); })()', expected: null, label: 'the fallback can be null', edge: true, async: true },
    ],
  },
  {
    id: 'js-easy2-total-when-ready',
    track: 'javascript',
    topic: 'javascript',
    level: 21,
    tier: 2,
    focus: ['promises'],
    title: 'Total once every price arrives',
    prompt: "Write `totalWhenReady(prices)`, where `prices` is an array of promises that each resolve to a number. Wait for all of them with `Promise.all` and resolve to their sum. `totalWhenReady([Promise.resolve(3), Promise.resolve(4)])` resolves to 7, and an empty array resolves to 0. If any price rejects, the total rejects with that error. prices is a read-only dense array of at most 1000 ordinary native Promises and may be frozen. Capture its initial membership during the call; later caller edits must not change this total. Fulfillments are finite Numbers of absolute value at most 10000000000000000. Add from +0 in input order with ordinary Number + and no rounding; floating-point addition order matters. Reject with the exact first observed rejection reason/reference without waiting for still-pending inputs, even if another input never settles. Rejection does not cancel those other producers. Return a native Promise immediately. Target: O(n) time for wrapper registration/fold work and O(n) space for retained values/handlers, where n is 1 + prices.length, excluding waiting, producer work and host scheduling.",
    starter: `const totalWhenReady = prices => {

};

// Scratch pad. Uncomment once your function returns a promise.
// totalWhenReady([Promise.resolve(3), Promise.resolve(4)]).then(total => console.log(total));
`,
    skeleton: `const totalWhenReady = prices => {
  return Promise.all(prices).then(values => {
    // add up values, starting from 0
  });
};`,
    hints: ['`Promise.all(prices)` resolves to an array of the numbers, in the same order, once every promise has resolved. Sum that array inside `.then`.'],
    approach: [
      'Pass the whole array to `Promise.all`, which waits for every promise.',
      'In `.then`, add up the array of numbers it resolves to, starting from 0 so an empty list totals 0.',
      'Return that promise. `Promise.all` already rejects as soon as one price fails.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'totalWhenReady([Promise.resolve(3), Promise.resolve(4)])', expected: 7, async: true },
      { call: 'totalWhenReady([Promise.resolve(1.5), Promise.resolve(2.5), Promise.resolve(6)])', expected: 10, async: true },
      { call: 'totalWhenReady([])', expected: 0, label: 'no prices total 0', edge: true, async: true },
      { call: 'totalWhenReady([new Promise(resolve => setTimeout(() => resolve(5), 30)), Promise.resolve(1)])', expected: 6, label: 'a slow price is waited for', edge: true, async: true },
      { call: '(() => { const failing = Promise.reject(new Error("price missing")); failing.catch(() => {}); return totalWhenReady([Promise.resolve(2), failing]).catch(error => error.message); })()', expected: 'price missing', label: 'one failure rejects the total', edge: true, async: true },
    ],
  },

  /* ── timers ───────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-cancel-a-timer',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 2,
    focus: ['timers', 'closures'],
    title: 'Schedule with a cancel button',
    prompt: "Write `schedule(task, ms)`, which starts a `setTimeout` that calls `task` after `ms` milliseconds and returns a function that cancels that timer with `clearTimeout`. Call the cancel function before the timer fires and `task` never runs. Calling it after the task has run, or twice, does nothing. ms is an integer from 0 to 1000. task is a synchronous function that returns normally, takes no arguments and does not depend on this; ignore its return value. Scheduling never calls task inline, including for ms zero. Every schedule call owns a separate cancel function/timer, and the cancel function return value is unspecified. Delays are minimum waits, not a wall-clock scheduling guarantee. Target: O(1) time and auxiliary space for this wrapper per schedule/cancel call, excluding host timer management and task work.",
    starter: `const schedule = (task, ms) => {

};

// Scratch pad. Change this and press Run.
schedule(() => console.log("ran"), 100);
`,
    skeleton: `const schedule = (task, ms) => {
  const id = /* start the timer */;
  return () => {
    // cancel this timer
  };
};`,
    hints: ['`setTimeout` returns an id. Keep it in a variable, and the function you return can pass it to `clearTimeout` later.'],
    approach: [
      'Start the timer with `setTimeout(task, ms)` and store the id it returns.',
      'Return an arrow function that calls `clearTimeout` with that id. It closes over the variable, so each call to `schedule` cancels only its own timer.',
      'Clearing a timer that has already fired, or clearing it twice, is harmless, so no extra checks are needed.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'new Promise(done => { const log = []; schedule(() => log.push("ran"), 20); setTimeout(() => done(log), 60); })', expected: ['ran'], label: 'the task runs after the delay', async: true },
      { call: 'new Promise(done => { const log = []; const cancel = schedule(() => log.push("ran"), 20); cancel(); setTimeout(() => done(log), 60); })', expected: [], label: 'cancelled in time, it never runs', async: true },
      { call: 'new Promise(done => { const log = []; const cancelA = schedule(() => log.push("a"), 20); schedule(() => log.push("b"), 20); cancelA(); setTimeout(() => done(log), 60); })', expected: ['b'], label: 'each cancel stops its own timer', edge: true, async: true },
      { call: '(() => { const log = []; const cancel = schedule(() => log.push("ran"), 10); return new Promise(done => setTimeout(done, 50)).then(() => { cancel(); cancel(); return log; }); })()', expected: ['ran'], label: 'cancelling late, or twice, does nothing', edge: true, async: true },
    ],
  },
  {
    id: 'js-easy2-repeat-then-stop',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 2,
    focus: ['timers'],
    title: 'Repeat, then stop',
    prompt: "Write `repeat(task, times, ms)`, which uses `setInterval` to call `task` every `ms` milliseconds, passing the call number (1, then 2, and so on), and stops with `clearInterval` after exactly `times` calls. `repeat(n => console.log(n), 3, 10)` prints 1, 2 and 3, then nothing more. A `times` of 0 never calls `task`. times is an integer from 0 to 1000 and ms is an integer from 1 to 1000. task is synchronous, returns normally and does not depend on this; ignore its return value. Each invocation receives exactly one argument, its 1-based call number. No call happens inline before repeat returns, and times zero starts no interval. Separate repeat calls keep separate counters/timers; the function return value is unspecified. Timer delays are minimum waits rather than precise wall-clock deadlines. Target: O(n) time for all wrapper callback dispatches, where n is 1 + times, excluding host timer management, waiting and task work; wrapper state uses O(1) auxiliary space.",
    starter: `const repeat = (task, times, ms) => {

};

// Scratch pad. Change this and press Run.
repeat(n => console.log(n), 3, 10);
`,
    skeleton: `const repeat = (task, times, ms) => {
  if (/* nothing to do */) return;
  let calls = 0;
  const id = setInterval(() => {
    // count this call, run the task with its number, stop after the last
  }, ms);
};`,
    hints: ['An interval keeps firing until something clears it. Count the calls in a variable outside the callback and call `clearInterval(id)` when the count reaches `times`.'],
    approach: [
      'Return early when `times` is 0, so no interval starts at all.',
      'Start the interval and keep its id. In the callback, add one to a counter and call `task` with it.',
      'When the counter equals `times`, clear the interval with its id so it never fires again.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'new Promise(done => { const log = []; repeat(n => log.push(n), 3, 10); setTimeout(() => done(log), 150); })', expected: [1, 2, 3], label: 'it stops after three calls', async: true },
      { call: 'new Promise(done => { const log = []; repeat(n => log.push(n * 10), 2, 10); setTimeout(() => done(log), 120); })', expected: [10, 20], label: 'the task receives the call number', async: true },
      { call: 'new Promise(done => { const log = []; repeat(n => log.push(n), 1, 10); setTimeout(() => done(log), 100); })', expected: [1], label: 'one call, then nothing', edge: true, async: true },
      { call: 'new Promise(done => { const log = []; repeat(n => log.push(n), 0, 10); setTimeout(() => done(log), 80); })', expected: [], label: 'zero times never calls the task', edge: true, async: true },
    ],
  },
  {
    id: 'js-easy2-fire-in-delay-order',
    track: 'javascript',
    topic: 'javascript',
    level: 21,
    tier: 2,
    focus: ['timers', 'promises'],
    title: 'Finish in order of delay',
    prompt: "Write `inDelayOrder(jobs)`, where each job is `{ name, ms }`. Start a `setTimeout` for every job at once, record each name when its timer fires, and resolve to the names in the order they fired once the last one has. `inDelayOrder([{ name: \"slow\", ms: 30 }, { name: \"fast\", ms: 10 }])` resolves to `[\"fast\", \"slow\"]`. Jobs with the same delay fire in the order they were started, and an empty list resolves to `[]`. jobs is a read-only dense array of at most 1000 ordinary data records, possibly frozen with its records. name is literal text of at most 1000 UTF-16 code units, including empty/duplicate names; ms is an integer from 0 to 1000. Capture each name/delay and the original job count while registering timers, so caller edits after return cannot change this run. Return a native Promise immediately; even zero-delay callbacks run later, and a nonempty run must stay pending until its timers fire. Record actual callback order rather than sorting the input by numeric delays. Equal delays retain registration order in the checker; waits are minimum delays, not exact physical deadlines. Separate calls and output arrays are independent. Target: O(n) time for wrapper registration/callback work and O(n) space for timers/results, where n is 1 + jobs.length, excluding waiting and host timer management.",
    starter: `const inDelayOrder = jobs => {

};

// Scratch pad. Uncomment once your function returns a promise.
// inDelayOrder([{ name: "slow", ms: 30 }, { name: "fast", ms: 10 }]).then(names => console.log(names));
`,
    skeleton: `const inDelayOrder = jobs => new Promise(resolve => {
  const fired = [];
  const total = jobs.length; // capture the original count
  if (/* no jobs */) return resolve(fired);

  for (const { name, ms } of jobs) {
    setTimeout(() => {
      // record the name, and resolve once every job has fired
    }, ms);
  }
});`,
    hints: ['Wrap the timers in `new Promise(resolve => …)`. Each timer pushes its name, and the one that makes the list as long as the original job count calls `resolve`.'],
    approach: [
      'Return a new promise and keep an array of fired names inside it.',
      'Capture each name/delay and start one `setTimeout` per original job. Its callback pushes the job’s name, and calls `resolve` with the array when the array has as many names as the captured original count.',
      'With no jobs no timer ever fires, so resolve with the empty array straight away.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'inDelayOrder([{ name: "slow", ms: 30 }, { name: "fast", ms: 10 }])', expected: ['fast', 'slow'], async: true },
      { call: 'inDelayOrder([{ name: "a", ms: 20 }, { name: "b", ms: 5 }, { name: "c", ms: 40 }])', expected: ['b', 'a', 'c'], async: true },
      { call: 'inDelayOrder([{ name: "first", ms: 10 }, { name: "second", ms: 10 }])', expected: ['first', 'second'], label: 'equal delays keep their start order', edge: true, async: true },
      { call: 'inDelayOrder([{ name: "now", ms: 0 }])', expected: ['now'], label: 'a zero delay still waits for the timer', edge: true, async: true },
      { call: 'inDelayOrder([])', expected: [], label: 'no jobs', edge: true, async: true },
    ],
  },

  /* ── callbacks ────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-call-n-times',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 1,
    focus: ['callbacks', 'for'],
    title: 'Call it n times',
    prompt: "Write `times(n, callback)`, calling `callback` once for each index from 0 up to `n - 1` and returning an array of what each call returned. `times(3, i => i * 10)` gives `[0, 10, 20]`. When `n` is 0 the callback is never called and the result is empty. Domain: n is an integer from 0 through 1,000. Call the synchronous callback with exactly one argument, the index, once per index in ascending order. Preserve returned values/references, including undefined and falsy results, in a fresh dense output array. If the callback throws, propagate the same error and stop further calls. Target: O(n) time and O(n) result slots under bounded-cost callbacks and amortized array append; the zero case does constant work.",
    starter: `const times = (n, callback) => {

};

// Scratch pad. Change this and press Run.
console.log(times(3, i => i * 10));
`,
    skeleton: `const times = (n, callback) => {
  const results = [];

  for (/* each index from 0 up to n - 1 */) {
    // call callback with the index and keep what it returns
  }

  return results;
};`,
    hints: ['`callback` is an ordinary function held in a variable. Call it as `callback(index)` inside a `for` loop and push the result.'],
    approach: [
      'Start an empty array for the results.',
      'Loop an index from 0 while it is below `n`, and push `callback(index)` each time round.',
      'Return the array. With `n` at 0 the loop body never runs and the callback is never called.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'times(3, i => i * 10)', expected: [0, 10, 20] },
      { call: 'times(2, () => "hi")', expected: ['hi', 'hi'] },
      { call: '(() => { const seen = []; times(4, i => seen.push(i)); return seen; })()', expected: [0, 1, 2, 3], label: 'the callback receives each index in order' },
      { call: 'times(0, i => i)', expected: [], label: 'zero calls give an empty array', edge: true },
      { call: '(() => { let calls = 0; times(0, () => { calls += 1; }); return calls; })()', expected: 0, label: 'zero never calls the callback', edge: true },
    ],
  },
  {
    id: 'js-easy2-error-first-callback',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 2,
    focus: ['callbacks'],
    title: 'Error-first callback',
    prompt: "Node-style functions report through one callback whose first argument is an error, or `null` when nothing went wrong. Write `safeDivide(a, b, callback)`: when `b` is 0, call `callback` with an `Error` whose message is `\"Cannot divide by zero\"`; otherwise call `callback(null, a / b)`. Call it exactly once either way. `safeDivide` itself returns nothing. a and b are finite Numbers between -1000000 and 1000000; a nonzero b has magnitude at least 0.000001. Both signs of zero count as a zero denominator. Invoke callback synchronously with exactly one argument on error, or exactly two on success, and ignore its return value. Do not round the normal Number quotient. If callback throws, propagate that original value without retrying the callback. The normal return value is undefined. Target: O(1) time and auxiliary space, excluding callback work.",
    starter: `const safeDivide = (a, b, callback) => {

};

// Scratch pad. Change this and press Run.
safeDivide(6, 3, (error, value) => console.log(error, value));
safeDivide(1, 0, (error, value) => console.log(error && error.message, value));
`,
    skeleton: `const safeDivide = (a, b, callback) => {
  if (b === 0) {
    // report the error, then stop
  }
  // report success: no error, then the result
};`,
    hints: ['The error goes first: `callback(new Error("Cannot divide by zero"))` on failure and `callback(null, a / b)` on success. Return after the error so the success line never runs as well.'],
    approach: [
      'Check `b` first. When it is 0, call the callback with a new `Error` carrying the exact message, then `return`.',
      'Otherwise call the callback with `null` in the error slot and the quotient second.',
      'Do not return the callback’s result: `safeDivide` answers through the callback only.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: '(() => { let out; safeDivide(6, 3, (error, value) => { out = [error, value]; }); return out; })()', expected: [null, 2] },
      { call: '(() => { let out; safeDivide(1, 0, error => { out = error instanceof Error ? error.message : "not an Error"; }); return out; })()', expected: 'Cannot divide by zero' },
      { call: '(() => { let calls = 0; safeDivide(5, 0, () => { calls += 1; }); safeDivide(5, 5, () => { calls += 1; }); return calls; })()', expected: 2, label: 'exactly one call each time' },
      { call: '(() => { let out; safeDivide(0, 4, (error, value) => { out = [error, value]; }); return out; })()', expected: [null, 0], label: 'zero divided by a number is fine', edge: true },
      { call: '(() => { let seen = "unset"; safeDivide(1, 0, (error, value) => { seen = value; }); return seen; })()', expected: undefined, label: 'no value arrives with an error', edge: true },
    ],
  },
  {
    id: 'js-easy2-after-n-calls',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 2,
    focus: ['callbacks', 'closures'],
    title: 'Done after n calls',
    prompt: "Write `after(count, done)`, where `count` is at least 1. Return a function that calls `done`, with no arguments, on its `count`-th call and at no other time. Three uploads that each call the returned function when they finish trigger `done` once, after the last. Calls after the `count`-th do nothing. count is an integer from 1 to 10000 and each returned function may receive up to 10000 calls. Every factory returns a distinct independent function. The returned function ignores its arguments and invokes done synchronously with zero arguments, exactly on the count-th call; its own return value is unspecified. If done throws, propagate that original value and still regard the count-th call as consumed, so later calls never invoke it again. done does not depend on this. Target: O(1) time and auxiliary space per factory/returned-function call, excluding done work.",
    starter: `const after = (count, done) => {

};

// Scratch pad. Uncomment once your function returns a function.
// const finish = after(2, () => console.log("all done"));
// finish();
// finish();
`,
    skeleton: `const after = (count, done) => {
  let calls = 0;
  return () => {
    // count this call, and call done on exactly the count-th one
  };
};`,
    hints: ['Keep a counter in `after`, outside the function you return. The returned function adds one each time and calls `done()` when the counter equals `count`.'],
    approach: [
      'Declare a counter inside `after`, starting at 0.',
      'Return a function that adds one to the counter every time it is called. It closes over the counter, so the count survives between calls.',
      'Call `done()` when the counter equals `count`. Using `===` rather than `>=` keeps later calls from firing it again.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: '(() => { let fired = 0; const finish = after(3, () => { fired += 1; }); finish(); finish(); const before = fired; finish(); return [before, fired]; })()', expected: [0, 1] },
      { call: '(() => { let fired = 0; const finish = after(1, () => { fired += 1; }); finish(); return fired; })()', expected: 1 },
      { call: '(() => { let fired = 0; const finish = after(2, () => { fired += 1; }); for (let i = 0; i < 5; i++) finish(); return fired; })()', expected: 1, label: 'extra calls do nothing', edge: true },
      { call: '(() => { let fired = 0; const a = after(2, () => { fired += 1; }); const b = after(2, () => { fired += 10; }); a(); b(); a(); return fired; })()', expected: 1, label: 'each counter is separate', edge: true },
    ],
  },

  /* ── higher-order functions ───────────────────────────────────────── */
  {
    id: 'js-easy2-negate-a-test',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 2,
    focus: ['higher-order'],
    title: 'Flip a test',
    prompt: "Write `negate(test)`, a higher-order function that returns a new function giving the opposite answer: `true` where `test` returns a falsy value and `false` where it returns a truthy one. The new function passes every argument it receives on to `test`. `[1, 2, 3, 4].filter(negate(n => n % 2 === 0))` gives `[1, 3]`. Call test exactly once per wrapper invocation, preserving argument count, order and value references. Return a Boolean, not a truthy/falsy surrogate. If test throws, propagate that same error. Domain: synchronous tests independent of dynamic this, at most 100 arguments per invocation and 1,000 invocations per wrapper. Target: O(n) time per invocation, where n is 1 plus the argument count for rest/spread handling, excluding the test function’s own work.",
    starter: `const negate = test => {

};

// Scratch pad. Uncomment once your function returns a function.
// console.log([1, 2, 3, 4].filter(negate(n => n % 2 === 0)));
`,
    skeleton: `const negate = test => {
  return (...args) => {
    return /* the opposite of test called with args */;
  };
};`,
    hints: ['Return a function. Collect its arguments with `...args`, call `test(...args)`, and put `!` in front of the result.'],
    approach: [
      'Return a new function from `negate` instead of a value.',
      'Give that function a rest parameter so it accepts any number of arguments, then spread them into `test`.',
      'Apply `!` to what `test` returns. It turns any falsy value into `true` and any truthy one into `false`.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: '[1, 2, 3, 4].filter(negate(n => n % 2 === 0))', expected: [1, 3] },
      { call: 'negate(word => word.length > 3)("sea")', expected: true },
      { call: 'negate(value => value)(0)', expected: true, label: 'a falsy result becomes true', edge: true },
      { call: 'negate(value => value)("text")', expected: false, label: 'a truthy result becomes false', edge: true },
      { call: 'negate((a, b) => a > b)(5, 2)', expected: false, label: 'every argument reaches the test', edge: true },
    ],
  },
  {
    id: 'js-easy2-sort-by-key',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 2,
    focus: ['higher-order', 'sort'],
    title: 'Sort by what a function picks',
    prompt: "Write `sortBy(list, pick)`, returning a new array sorted from smallest to largest by the number `pick(item)` returns for each item. `sortBy([{ name: \"b\", age: 30 }, { name: \"a\", age: 20 }], person => person.age)` puts the 20-year-old first. Items that pick the same number keep their original order, and `list` itself is not changed. list is a read-only dense array of at most 10000 opaque values, including undefined, and may be frozen. Preserve original references/values and return a fresh array on every call, including empty input. Call pick exactly once per item in original input order with exactly that one argument before sorting, storing its finite Number key (between -1000000 and 1000000). pick is synchronous and does not mutate the list; propagate its original thrown value if it fails. Decorate values with their key/index, sort those records and unwrap: native sort puts raw undefined values last without calling the comparator, so sorting raw values would break this contract. Target: O(n log n) time under the usual stable comparison-sort cost model and O(n) wrapper/output space, where n is 2 + list.length, excluding pick work; JavaScript does not specify a universal native-sort time bound.",
    starter: `const sortBy = (list, pick) => {

};

// Scratch pad. Change this and press Run.
console.log(sortBy(["ccc", "a", "bb"], word => word.length));
`,
    skeleton: "const sortBy = (list, pick) => {\n  const decorated = list.map((item, index) => ({ item, index, key: /* pick this item once */ }));\n  decorated.sort((a, b) => /* compare numeric keys, then original indices */);\n  return decorated.map(entry => /* original item */);\n};",
    hints: ["Cache each picked number on a wrapper record before sorting. Native sort moves raw undefined values to the end without calling its comparator; sorting wrapper records avoids that special case."],
    approach: ["Map each original item to a record carrying that item, its picked numeric key and its original index.", "Sort those records by key, then index for ties.", "Map the records back to their original items. The input stays unchanged and every pick ran once before sorting."],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'sortBy([{ name: "b", age: 30 }, { name: "a", age: 20 }], person => person.age).map(person => person.name)', expected: ['a', 'b'] },
      { call: 'sortBy(["ccc", "a", "bb"], word => word.length)', expected: ['a', 'bb', 'ccc'] },
      { call: 'sortBy([10, 9, 100], n => n)', expected: [9, 10, 100], label: 'numbers sort by value, not as text', edge: true },
      { call: 'sortBy([{ id: 1, rank: 2 }, { id: 2, rank: 1 }, { id: 3, rank: 2 }], item => item.rank).map(item => item.id)', expected: [2, 1, 3], label: 'equal keys keep their order', edge: true },
      { call: '(() => { const list = [3, 1, 2]; sortBy(list, n => n); return list; })()', expected: [3, 1, 2], label: 'the input is not changed', edge: true },
    ],
  },
  {
    id: 'js-easy2-count-where',
    track: 'javascript',
    topic: 'javascript',
    level: 15,
    tier: 1,
    focus: ['higher-order', 'for-of'],
    title: 'Count where a test passes',
    prompt: "Write `countWhere(list, test)`, returning how many items make `test(item)` truthy, with a `for…of` loop that calls the function you were given. `countWhere([3, 8, 12], n => n > 5)` gives 2. An empty list gives 0. Domain: a dense ordinary array of at most 1,000 opaque values, possibly frozen. Call the synchronous test exactly once for each item in input order, with only that original item as its argument. Do not mutate or inspect the items yourself. Any truthy return counts, including objects; falsy values such as NaN, 0n and undefined do not. A thrown test error propagates unchanged and stops traversal. Target: O(n) time, where n is list length, under bounded-cost tests; only O(1) additional state is needed.",
    starter: `const countWhere = (list, test) => {

};

// Scratch pad. Change this and press Run.
console.log(countWhere([3, 8, 12], n => n > 5));
`,
    skeleton: `const countWhere = (list, test) => {
  let count = 0;

  for (const item of list) {
    // count the item when test(item) is truthy
  }

  return count;
};`,
    hints: ['`test` is a function you call like any other: `if (test(item))` counts any truthy result, not only `true`.'],
    approach: [
      'Start a counter at 0.',
      'Visit each item with `for…of` and call `test(item)`.',
      'Add one when the result is truthy, then return the counter.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'countWhere([3, 8, 12], n => n > 5)', expected: 2 },
      { call: 'countWhere(["apple", "kiwi", "avocado"], word => word.startsWith("a"))', expected: 2 },
      { call: 'countWhere([], () => true)', expected: 0, label: 'an empty list', edge: true },
      { call: 'countWhere([0, "", "x", 1], value => value)', expected: 2, label: 'truthy results count, not only true', edge: true },
    ],
  },

  /* ── recursion ────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-factorial',
    track: 'javascript',
    topic: 'javascript',
    level: 11,
    tier: 1,
    focus: ['recursion'],
    title: 'Factorial by recursion',
    prompt: "Write `factorial(n)` for a whole number `n` of zero or more, by recursion: the factorial of 0 is 1, and the factorial of any larger `n` is `n` times the factorial of `n - 1`. `factorial(5)` gives 120. Use no loop: the function calls itself. Domain: n is an integer from 0 through 18, so the factorial is an exactly represented safe-integer Number. Negative, fractional, larger and BigInt inputs are outside this exercise. Target: O(n) time, where n is the requested integer, under unit-cost Number arithmetic; the direct recursion also uses O(n) call-stack space.",
    starter: `const factorial = n => {

};

// Scratch pad. Change this and press Run.
console.log(factorial(5));
`,
    skeleton: `const factorial = n => {
  if (/* the base case */) return /* its answer */;
  return /* n times a smaller factorial */;
};`,
    hints: ['A recursive function needs a case that stops. Here it is `n === 0`, which returns 1. Every other call hands a smaller number to `factorial`.'],
    approach: [
      'Write the base case first: when `n` is 0, return 1.',
      'For any other `n`, return `n * factorial(n - 1)`.',
      'Each call works on a smaller number, so the calls always reach 0 and stop.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'factorial(5)', expected: 120 },
      { call: 'factorial(3)', expected: 6 },
      { call: 'factorial(0)', expected: 1, label: 'the base case: 0! is 1', edge: true },
      { call: 'factorial(1)', expected: 1, label: 'one step from the base case', edge: true },
    ],
  },
  {
    id: 'js-easy2-power',
    track: 'javascript',
    topic: 'javascript',
    level: 11,
    tier: 1,
    focus: ['recursion'],
    title: 'Power by recursion',
    prompt: "Write `power(base, exponent)` for a whole-number `exponent` of zero or more, by recursion and without `**` or `Math.pow`: any base to the power 0 is 1, and `base` to the power `exponent` is `base` times `base` to the power `exponent - 1`. `power(2, 5)` gives 32. Domain: exponent is an integer from 0 through 10; base is a Number from -10 through 10 in steps of 0.5, including signed zero. These bounds keep the specified multiplications exactly representable. Return 1 for exponent 0, including 0 to the power 0. For other exponents retain the sign of zero produced by multiplication. Target: O(n) time for the direct recursion, where n is the exponent under unit-cost arithmetic; faster recursive exponentiation is also accepted.",
    starter: `const power = (base, exponent) => {

};

// Scratch pad. Change this and press Run.
console.log(power(2, 5));
`,
    skeleton: `const power = (base, exponent) => {
  if (/* the base case */) return 1;
  return /* base times a smaller power */;
};`,
    hints: ['The base case is an exponent of 0. Every other call multiplies `base` by `power(base, exponent - 1)`.'],
    approach: [
      'Return 1 when the exponent is 0.',
      'Otherwise return `base * power(base, exponent - 1)`.',
      'A negative base needs no special case: the multiplications keep track of the sign.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'power(2, 5)', expected: 32 },
      { call: 'power(3, 3)', expected: 27 },
      { call: 'power(7, 0)', expected: 1, label: 'any base to the power 0 is 1', edge: true },
      { call: 'power(-2, 3)', expected: -8, label: 'a negative base keeps its sign on odd powers', edge: true },
      { call: 'power(10, 1)', expected: 10, label: 'one step from the base case', edge: true },
    ],
  },
  {
    id: 'js-easy2-list-to-array',
    track: 'javascript',
    topic: 'javascript',
    level: 11,
    tier: 2,
    focus: ['recursion'],
    title: 'Walk a linked list',
    prompt: "A linked list is a chain of nodes shaped `{ value, next }`, where the last node’s `next` is `null`. Write `toArray(node)`, returning the values from `node` to the end of the chain, in order, by recursion: `null` is the empty list and gives `[]`, and any other node gives its value followed by `toArray(node.next)`. `toArray({ value: 1, next: { value: 2, next: null } })` gives `[1, 2]`. Domain: an acyclic chain of at most 200 ordinary nodes ending in null. Nodes may be frozen and values are opaque JavaScript values, including undefined, nested arrays and object references. Return a fresh array every time, preserve exact value identities and do not change any node. Target: O(n²) time for the taught recursive suffix-copying approach, where n is the node count and copying k array slots costs O(k). An accumulator-based recursion can achieve O(n) time and is also accepted; call-stack space is O(n).",
    starter: `const toArray = node => {

};

// Scratch pad. Change this and press Run.
console.log(toArray({ value: 1, next: { value: 2, next: null } }));
`,
    skeleton: `const toArray = node => {
  if (/* the end of the chain */) return [];
  return [/* this node's value */, ...toArray(/* the rest of the chain */)];
};`,
    hints: ['The base case is `node === null`. For any other node, put `node.value` in front of whatever `toArray(node.next)` returns.'],
    approach: [
      'Handle the end of the chain first: `null` gives an empty array.',
      'For a real node, call `toArray(node.next)` to get the values of the rest of the chain.',
      'Return a new array with this node’s value first and the rest spread after it.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'toArray({ value: 1, next: { value: 2, next: null } })', expected: [1, 2] },
      { call: 'toArray({ value: "a", next: { value: "b", next: { value: "c", next: null } } })', expected: ['a', 'b', 'c'] },
      { call: 'toArray(null)', expected: [], label: 'the empty list', edge: true },
      { call: 'toArray({ value: 0, next: null })', expected: [0], label: 'a single node', edge: true },
    ],
  },

  /* ── nested loops ─────────────────────────────────────────────────── */
  {
    id: 'js-easy2-every-pair',
    track: 'javascript',
    topic: 'javascript',
    level: 6,
    tier: 2,
    focus: ['nested-loops'],
    title: 'Every pair once',
    prompt: "Write `allPairs(list)`, returning every pair of items at two different positions as `[first, second]`, where `first` comes earlier in the list than `second`. Use a `for` loop nested inside another, with the inner loop starting one place after the outer one. `allPairs([\"a\", \"b\", \"c\"])` gives `[[\"a\", \"b\"], [\"a\", \"c\"], [\"b\", \"c\"]]`. A list of fewer than two items gives no pairs. `list` is an ordinary dense array of at most 200 data values. Preserve each original value reference, even when the same object or value appears at multiple positions. Enumerate pairs by increasing first index, then increasing second index. Return a fresh outer array and separate fresh two-item arrays; do not change the source or nested values, and accept frozen input. Target: O(n²) time, where n is the input length: the output contains n * (n - 1) / 2 pairs, each formed by copying two references.",
    starter: `const allPairs = list => {

};

// Scratch pad. Change this and press Run.
console.log(allPairs(["a", "b", "c"]));
`,
    skeleton: `const allPairs = list => {
  const pairs = [];

  for (let i = 0; i < list.length; i++) {
    for (/* j from the place after i to the end */) {
      // record the pair of list[i] and list[j]
    }
  }

  return pairs;
};`,
    hints: ['Start the inner index at `i + 1`. Starting at 0 would pair an item with itself and list every pair twice.'],
    approach: [
      'Loop an outer index `i` over every position.',
      'Loop an inner index `j` from `i + 1` to the end, so it only looks at later positions.',
      'Push `[list[i], list[j]]` for every pair of indexes.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'allPairs(["a", "b", "c"])', expected: [['a', 'b'], ['a', 'c'], ['b', 'c']] },
      { call: 'allPairs([1, 2])', expected: [[1, 2]] },
      { call: 'allPairs([1, 1, 2])', expected: [[1, 1], [1, 2], [1, 2]], label: 'equal values at different positions still pair', edge: true },
      { call: 'allPairs([7])', expected: [], label: 'one item has no pair', edge: true },
      { call: 'allPairs([])', expected: [], label: 'an empty list', edge: true },
      { call: "(() => {const item={id:1},list=Object.freeze([item,item,\"x\"]);const out=allPairs(list);return out!==list&&out.length===3&&out[0]!==out[1]&&out[1]!==out[2]&&out[0][0]===item&&out[0][1]===item&&out[1][0]===item&&out[1][1]===\"x\"&&item.id===1;})()", expected: true, label: "frozen duplicate object references and independent pairs", edge: true },
      { call: "(() => {const list=[3,1,2];allPairs(list);return list;})()", expected: [3, 1, 2], label: "preserve source order", edge: true },
      { call: "(() => {const list=[];const a=allPairs(list),b=allPairs(list);return a!==list&&a!==b&&a.length===0&&b.length===0;})()", expected: true, label: "fresh empty pair lists", edge: true },
      { call: "allPairs(Array.from({length:200},(_,i)=>i)).length", expected: 19900, label: "bounded pair count", edge: true },
    ],
  },
  {
    id: 'js-easy2-find-in-grid',
    track: 'javascript',
    topic: 'javascript',
    level: 6,
    tier: 1,
    focus: ['nested-loops'],
    title: 'Find it in a grid',
    prompt: "Write `findInGrid(grid, target)`, where `grid` is an array of rows. Return `[row, column]` for the first cell equal to `target`, reading each row from left to right and the rows from top to bottom, or `null` when no cell matches. Stop as soon as you find it. `findInGrid([[1, 2], [3, 4]], 3)` gives `[1, 0]`. Match with strict equality (===): NaN never matches, 0 and -0 match, and objects match only by reference. Both levels are ordinary dense arrays; row lengths may differ and empty rows are valid. Treat equality as constant-time for this exercise. Do not mutate the grid, rows or stored values; frozen input is valid. A found coordinate pair must be a fresh array. Target: O(n) time in the worst case, where n is the number of rows plus all their cells; an early match may take less.",
    starter: `const findInGrid = (grid, target) => {

};

// Scratch pad. Change this and press Run.
console.log(findInGrid([[1, 2], [3, 4]], 3));
`,
    skeleton: `const findInGrid = (grid, target) => {
  for (let row = 0; row < grid.length; row++) {
    for (/* every column of this row */) {
      // return the position when the cell matches
    }
  }
  return null;
};`,
    hints: ['The outer loop picks a row and the inner loop walks that row’s cells. A `return` inside the inner loop stops both at once.'],
    approach: [
      'Loop over the row indexes, then over the column indexes of that row. Use the row’s own length, since rows can differ in length.',
      'When `grid[row][column]` equals the target, return `[row, column]` straight away.',
      'After both loops finish without a match, return `null`.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'findInGrid([[1, 2], [3, 4]], 3)', expected: [1, 0] },
      { call: 'findInGrid([["a", "b", "c"], ["d", "e", "f"]], "f")', expected: [1, 2] },
      { call: 'findInGrid([[1, 2], [3, 4]], 9)', expected: null, label: 'no match gives null', edge: true },
      { call: 'findInGrid([[5, 5], [5, 5]], 5)', expected: [0, 0], label: 'the first match wins', edge: true },
      { call: 'findInGrid([[], [8]], 8)', expected: [1, 0], label: 'rows can be empty or of different lengths', edge: true },
      { call: "findInGrid([[\"1\",1]],1)", expected: [0, 1], label: "strict equality does not coerce strings", edge: true },
      { call: "findInGrid([[NaN],[NaN]],NaN)", expected: null, label: "NaN does not match itself", edge: true },
      { call: "findInGrid([[0,-0]],-0)", expected: [0, 0], label: "both zero signs compare equal", edge: true },
      { call: "(() => {const target={id:1};return findInGrid([[{id:1},target]],target);})()", expected: [0, 1], label: "object reference equality", edge: true },
      { call: "findInGrid(Object.freeze([Object.freeze([]),Object.freeze([1,2,3])]),3)", expected: [1, 2], label: "frozen ragged rows", edge: true },
      { call: "(() => {const rows=[[1],[2]];findInGrid(rows,1);return rows.length===2&&rows[0][0]===1&&rows[1][0]===2;})()", expected: true, label: "preserve row order", edge: true },
      { call: "(() => {const first=findInGrid([[1]],1),second=findInGrid([[1]],1);return first!==second&&first[0]===0&&first[1]===0;})()", expected: true, label: "fresh coordinate pairs", edge: true },
    ],
  },

  /* ── two pointers ─────────────────────────────────────────────────── */
  {
    id: 'js-easy2-sorted-squares',
    track: 'javascript',
    topic: 'javascript',
    level: 6,
    tier: 2,
    focus: ['two-pointer'],
    title: 'Squares in order',
    prompt: "Write `sortedSquares(sorted)`, where `sorted` holds numbers in ascending order, some possibly negative. Return a new array of their squares, also in ascending order, without calling `sort`. The biggest square sits at one of the two ends, so move a pointer in from each end, compare the two squares, and fill the result from the back. `sortedSquares([-4, -1, 0, 3])` gives `[0, 1, 9, 16]`. The input is an ordinary dense array of at most 10000 integers in nondecreasing order, each between -1000000 and 1000000. Squares remain exact Numbers. Keep duplicates, treat either zero sign numerically as zero and return a fresh array, including for empty input. Do not change the source; frozen arrays are valid. Target: O(n) time, where n is the input length and bounded square/index operations take constant time. Repeatedly inserting at the front shifts earlier results; append and reverse once, or fill allocated slots from the back.",
    starter: `const sortedSquares = sorted => {

};

// Scratch pad. Change this and press Run.
console.log(sortedSquares([-4, -1, 0, 3]));
`,
    skeleton: `const sortedSquares = sorted => {
  const result = new Array(sorted.length);
  let left = 0;
  let right = sorted.length - 1;

  for (let write = sorted.length - 1; write >= 0; write--) {
    // place the larger of the two end squares at write, then move that pointer in
  }

  return result;
};`,
    hints: ['Squaring a large negative number gives a large square, so the biggest square is at the left end or the right end. Take the larger one, write it at the back of the result, and move that pointer inwards.'],
    approach: [
      'Put `left` at the first index, `right` at the last, and prepare a result array of the same length.',
      'Fill the result from its last slot to its first. Each time, compare the squares at `left` and `right`.',
      'Write the larger square and move only the pointer it came from. When the loop ends, every slot is filled in ascending order.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'sortedSquares([-4, -1, 0, 3])', expected: [0, 1, 9, 16] },
      { call: 'sortedSquares([-7, -3, 2, 3, 11])', expected: [4, 9, 9, 49, 121] },
      { call: 'sortedSquares([1, 2, 3])', expected: [1, 4, 9], label: 'no negatives', edge: true },
      { call: 'sortedSquares([-3, -2, -1])', expected: [1, 4, 9], label: 'only negatives', edge: true },
      { call: 'sortedSquares([])', expected: [], label: 'an empty list', edge: true },
      { call: "sortedSquares(Object.freeze([-1000000,-2,-2,-0,0,3,1000000]))", expected: [0, 0, 4, 4, 9, 1000000000000, 1000000000000], label: "frozen input exact bounds duplicates and zeros", edge: true },
      { call: "(() => {const input=[-4,-1,0,3];sortedSquares(input);return input;})()", expected: [-4, -1, 0, 3], label: "preserve longer input order", edge: true },
      { call: "(() => {const input=[];const a=sortedSquares(input),b=sortedSquares(input);return a!==input&&a!==b&&a.length===0&&b.length===0;})()", expected: true, label: "fresh empty output", edge: true },
      { call: "(() => {const out=sortedSquares(Array.from({length:128},(_,i)=>i-64));return out.length===128&&out[0]===0&&out[127]===4096&&out.every((value,index)=>index===0||out[index-1]<=value);})()", expected: true, label: "larger two-sided input", edge: true },
    ],
  },
  {
    id: 'js-easy2-reverse-vowels',
    track: 'javascript',
    topic: 'javascript',
    level: 6,
    tier: 2,
    focus: ['two-pointer', 'strings'],
    title: 'Reverse only the vowels',
    prompt: "Write `reverseVowels(text)`, returning the text with its vowels (a, e, i, o and u, in either case) in reverse order and every other character where it was. Move one pointer in from each end, step past characters that are not vowels, and swap when both pointers rest on a vowel. `reverseVowels(\"hello\")` gives `\"holle\"`. `text` is a primitive string. Only the literal ASCII letters aeiouAEIOU are vowels here; y, accented letters, dotted İ and other Unicode characters are not. Preserve every non-vowel UTF-16 unit and all original vowel cases; do not normalize or lowercase the text. For example, `reverseVowels(\"İaE\")` gives \"İEa\". Target: O(n) time, where n is the UTF-16 input length; fixed-set membership is constant-time and both pointers only move inward.",
    starter: `const reverseVowels = text => {

};

// Scratch pad. Change this and press Run.
console.log(reverseVowels("hello"));
`,
    skeleton: `const reverseVowels = text => {
  const chars = text.split("");
  let left = 0;
  let right = chars.length - 1;

  while (left < right) {
    // a non-vowel at left: step left on and go round again
    // a non-vowel at right: step right back and go round again
    // otherwise swap the two vowels and move both pointers in
  }

  return chars.join("");
};`,
    hints: ["Collect the text in a mutable array and use the fixed uppercase/lowercase ASCII vowel set. Each pointer skips non-vowels only inward, so even nested skipping loops visit each position a bounded number of times."],
    approach: [
      'Split the text into characters and set `left` to 0 and `right` to the last index.',
      'While `left` is below `right`, take one step each time round: if `left` sits on a non-vowel, move it forward; otherwise, if `right` sits on a non-vowel, move it back. A loop that only checks for a vowel would run off the end of a word with none.',
      'When both rest on vowels, swap them and move both pointers one step in. Join the characters to finish.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'reverseVowels("hello")', expected: 'holle' },
      { call: 'reverseVowels("javascript")', expected: 'jivascrapt' },
      { call: 'reverseVowels("Aa")', expected: 'aA', label: 'upper-case vowels count and keep their case', edge: true },
      { call: 'reverseVowels("rhythm")', expected: 'rhythm', label: 'no vowels', edge: true },
      { call: 'reverseVowels("")', expected: '', label: 'the empty string', edge: true },
      { call: "reverseVowels(\"İaE\")", expected: "İEa", label: "only literal ASCII vowels move", edge: true },
      { call: "reverseVowels(\"éaO🦈\")", expected: "éOa🦈", label: "accented letters and surrogate pairs stay intact", edge: true },
      { call: "reverseVowels(\"a\\u0301E\")", expected: "Éa", label: "combining mark stays in place", edge: true },
      { call: "reverseVowels(\"yY123🦈\")", expected: "yY123🦈", label: "no matching vowels", edge: true },
      { call: "reverseVowels(\"ae\")", expected: "ea", label: "two adjacent vowels", edge: true },
    ],
  },
  {
    id: 'js-easy2-outside-in',
    track: 'javascript',
    topic: 'javascript',
    level: 6,
    tier: 2,
    focus: ['two-pointer'],
    title: 'Outside in',
    prompt: "Write `outsideIn(list)`, returning a new array that takes the first item, then the last, then the second, then the second to last, and so on until the two ends meet. Keep one index at each end and move them towards each other. `outsideIn([1, 2, 3, 4, 5])` gives `[1, 5, 2, 4, 3]`: the middle item of an odd-length list appears once. The input is not changed. The input is an ordinary dense array of data values. Keep the original value references and all repeated occurrences. Return a fresh outer array for every input, including an empty list. Do not change the input or nested values; frozen arrays are valid. Target: O(n) time, where n is the number of input items and copying one reference takes constant time.",
    starter: `const outsideIn = list => {

};

// Scratch pad. Change this and press Run.
console.log(outsideIn([1, 2, 3, 4, 5]));
`,
    skeleton: `const outsideIn = list => {
  const result = [];
  let left = 0;
  let right = list.length - 1;

  while (left <= right) {
    // take from the left, then from the right unless the pointers have met
  }

  return result;
};`,
    hints: ['Loop while `left <= right`. Push `list[left]`, then push `list[right]` only when `left` and `right` are different positions.'],
    approach: [
      'Start `left` at 0 and `right` at the last index, with an empty result.',
      'Each time round, push the item at `left`, then the item at `right` unless both pointers sit on the same item.',
      'Move `left` one step right and `right` one step left, and stop when they cross.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'outsideIn([1, 2, 3, 4, 5])', expected: [1, 5, 2, 4, 3] },
      { call: 'outsideIn(["a", "b", "c", "d"])', expected: ['a', 'd', 'b', 'c'] },
      { call: 'outsideIn([9])', expected: [9], label: 'a single item appears once', edge: true },
      { call: 'outsideIn([])', expected: [], label: 'an empty list', edge: true },
      { call: '(() => { const list = [1, 2, 3]; outsideIn(list); return list; })()', expected: [1, 2, 3], label: 'the input is not changed', edge: true },
      { call: "(() => {const item={id:1},list=Object.freeze([item,\"a\",item,\"b\"]);const out=outsideIn(list);return out!==list&&out.length===4&&out[0]===item&&out[1]===\"b\"&&out[2]===\"a\"&&out[3]===item&&item.id===1;})()", expected: true, label: "frozen source and repeated references", edge: true },
      { call: "(() => {const list=[3,1,4,2];outsideIn(list);return list;})()", expected: [3, 1, 4, 2], label: "preserve longer source order", edge: true },
      { call: "(() => {const list=[];const a=outsideIn(list),b=outsideIn(list);return a!==list&&a!==b&&a.length===0&&b.length===0;})()", expected: true, label: "fresh empty arrays", edge: true },
      { call: "(() => {const out=outsideIn([null,undefined,false,0,\"\"]);return out.length===5&&out[0]===null&&out[1]===\"\"&&out[2]===undefined&&out[3]===0&&out[4]===false;})()", expected: true, label: "retain falsy and missing-value entries", edge: true },
    ],
  },

  /* ── slice ────────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-page-of-results',
    track: 'javascript',
    topic: 'javascript',
    level: 4,
    tier: 1,
    focus: ['slice'],
    title: 'One page of results',
    prompt: "Write `page(items, pageNumber, pageSize)`, returning the items on one page of a list that shows `pageSize` items per page, with pages counted from 1, using `slice`. `page([\"a\", \"b\", \"c\", \"d\", \"e\"], 2, 2)` gives `[\"c\", \"d\"]`. The last page can be short, a page past the end is empty, and `items` is not changed. `items` is an ordinary dense array. `pageNumber` and `pageSize` are positive integers no greater than 10000. Return a fresh outer array even for the whole list or an empty page; keep original item references, order and duplicates. Do not change the input or nested values; frozen arrays are valid. Target: O(n) time in the worst case, where n is the number of input items, assuming constant-time index arithmetic and reference copying.",
    starter: `const page = (items, pageNumber, pageSize) => {

};

// Scratch pad. Change this and press Run.
console.log(page(["a", "b", "c", "d", "e"], 2, 2));
`,
    skeleton: `const page = (items, pageNumber, pageSize) => {
  const start = /* how many items come before this page */;
  return items.slice(start, /* where this page ends */);
};`,
    hints: ["Count how many full pages come before this one. Use that count to find the start index, then remember that the end index of `slice` is excluded."],
    approach: [
      'Work out the start index: every earlier page holds `pageSize` items, so it is `(pageNumber - 1) * pageSize`.',
      'The end index is the start plus `pageSize`. `slice` excludes it.',
      'Return `items.slice(start, end)`. It copies, and it returns fewer items or none when the range runs past the end.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'page(["a", "b", "c", "d", "e"], 2, 2)', expected: ['c', 'd'] },
      { call: 'page([1, 2, 3, 4, 5, 6], 1, 3)', expected: [1, 2, 3] },
      { call: 'page(["a", "b", "c", "d", "e"], 3, 2)', expected: ['e'], label: 'the last page can be short', edge: true },
      { call: 'page([1, 2, 3], 5, 2)', expected: [], label: 'a page past the end is empty', edge: true },
      { call: '(() => { const items = [1, 2, 3, 4]; page(items, 1, 2); return items; })()', expected: [1, 2, 3, 4], label: 'the list is not changed', edge: true },
      { call: "(() => { const item={id:1}; const items=Object.freeze([item,item,0]); const out=page(items,1,2); return out!==items&&out.length===2&&out[0]===item&&out[1]===item&&item.id===1; })()", expected: true, label: "frozen input and repeated object references", edge: true },
      { call: "(() => { const items=[1,2]; const out=page(items,1,10000); return out!==items&&out.length===2&&out[0]===1&&out[1]===2; })()", expected: true, label: "fresh whole-list result", edge: true },
      { call: "(() => { const items=[]; const out=page(items,1,1); return Array.isArray(out)&&out!==items&&out.length===0; })()", expected: true, label: "fresh empty page", edge: true },
      { call: "page([1,2,3],10000,10000)", expected: [], label: "large valid page bounds", edge: true },
    ],
  },

  /* ── async and await ──────────────────────────────────────────────── */
  {
    id: 'js-easy2-await-both',
    track: 'javascript',
    topic: 'javascript',
    level: 22,
    tier: 2,
    focus: ['async-await'],
    title: 'Await two values',
    prompt: "Write an `async` function `addBoth(first, second)`, where both arguments are promises of numbers. `await` each one and return their sum, so the caller gets a promise of the total. `addBoth(Promise.resolve(2), Promise.resolve(3))` resolves to 5. If either promise rejects, the promise `addBoth` returns rejects with the same error. Both inputs are ordinary native Promises with standard methods, fulfilling with finite Numbers of absolute value at most 10000000000000000, including -0. Await first before awaiting second: if both reject, the first rejection wins even if the second rejects sooner. A rejection of second cannot settle the result while first is still pending. This ordered exercise differs from fail-fast Promise.all aggregation. Forward the exact original rejection reason/reference, which need not be an Error. Use ordinary Number addition without rounding and leave user-visible input properties unchanged. Return a new native Promise immediately. Producers may already be running; ordered awaits do not serialize their start. Observe second as soon as addBoth starts so its rejection is handled even if first stays pending or rejects. Keep the two outcomes in input order. Target: O(1) time and retained wrapper state, excluding waiting, producer work and host scheduling.",
    starter: `const addBoth = async (first, second) => {

};

// Scratch pad. Change this and press Run.
addBoth(Promise.resolve(2), Promise.resolve(3)).then(total => console.log(total));
`,
    skeleton: `const addBoth = async (first, second) => {
  const outcome = /* start observing second without letting its rejection go unhandled */;
  const a = /* wait for first */;
  /* use the observed outcome to return the sum or throw the original reason */
};`,
    hints: ['`await promise` pauses the async function until the promise settles and gives you its value. A rejection becomes a throw, which rejects the promise `addBoth` returns.'],
    approach: [
      'Mark the function `async`, so whatever it returns arrives wrapped in a promise.',
      'Observe both outcomes of second right away. For example, Promise.allSettled([second]) always fulfills with a record of what happened.',
      'Await first. If it succeeds, inspect the saved second outcome. Add its value or throw its original reason.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: 'addBoth(Promise.resolve(2), Promise.resolve(3))', expected: 5, async: true },
      { call: 'addBoth(Promise.resolve(-1), Promise.resolve(1))', expected: 0, async: true },
      { call: 'addBoth(new Promise(resolve => setTimeout(() => resolve(10), 20)), Promise.resolve(5))', expected: 15, label: 'a slow value is waited for', edge: true, async: true },
      { call: '(() => { const failing = Promise.reject(new Error("no second value")); failing.catch(() => {}); return addBoth(Promise.resolve(1), failing).catch(error => error.message); })()', expected: 'no second value', label: 'a rejection reaches the caller', edge: true, async: true },
    ],
  },
  {
    id: 'js-easy2-await-or-default',
    track: 'javascript',
    topic: 'javascript',
    level: 22,
    tier: 2,
    focus: ['async-await'],
    title: 'Try, await, fall back',
    prompt: "Write an `async` function `loadOr(load, fallback)`. Call `load()`, which returns a promise, and `await` it inside `try`. Return what it resolves to, or return `fallback` from the `catch` when it rejects. `load` may also throw before it returns a promise, and that counts as a failure too. A resolved `0` or `null` is a success and is kept. Call the supplied ordinary function exactly once with no arguments; it returns an ordinary native Promise or throws synchronously. Preserve exact successful nonthenable values/references, including undefined, false, empty text, functions, Symbols, NaN and -0. fallback is an opaque nonthenable value; return that exact value after any throw/rejection, without invoking it or cloning it. Return a fresh native Promise immediately, on success or failure. Target: O(1) time and wrapper state, excluding load work, waiting and host scheduling.",
    starter: `const loadOr = async (load, fallback) => {

};

// Scratch pad. Change this and press Run.
loadOr(() => Promise.reject(new Error("offline")), "guest").then(value => console.log(value));
`,
    skeleton: `const loadOr = async (load, fallback) => {
  try {
    return /* the value load() resolves to */;
  } catch {
    return /* the value to use instead */;
  }
};`,
    hints: ['`try` only catches a rejection you `await` inside it. `return await load()` in the `try` block catches both a rejected promise and a throw from `load` itself.'],
    approach: [
      'Open a `try` block and call `load()` inside it, so a synchronous throw lands in `catch`.',
      'Write `return await load()`. Without `await` the promise would leave the `try` before it rejects, and `catch` would never see the error.',
      'In `catch`, return the fallback.',
    ],
    verify: 'tests',
    estimatedMinutes: 10,
    tests: [
      { call: 'loadOr(() => Promise.resolve("profile"), "guest")', expected: 'profile', async: true },
      { call: 'loadOr(() => Promise.reject(new Error("offline")), "guest")', expected: 'guest', label: 'a rejection gives the fallback', async: true },
      { call: 'loadOr(() => { throw new Error("bad config"); }, "guest")', expected: 'guest', label: 'a throw before any promise counts too', edge: true, async: true },
      { call: 'loadOr(() => Promise.resolve(0), 5)', expected: 0, label: 'a resolved zero is kept', edge: true, async: true },
      { call: '(() => { let calls = 0; return loadOr(() => { calls += 1; return Promise.resolve("x"); }, "y").then(() => calls); })()', expected: 1, label: 'load is called exactly once', edge: true, async: true },
    ],
  },

  /* ── closures ─────────────────────────────────────────────────────── */
  {
    id: 'js-easy2-running-average',
    track: 'javascript',
    topic: 'javascript',
    level: 12,
    tier: 2,
    focus: ['closures'],
    title: 'Running average',
    prompt: "Write `makeAverager()`, returning a function that takes one number at a time and returns the average of every number it has received so far. Keep the running total and count in variables the returned function closes over, so each averager remembers only its own numbers. After `const avg = makeAverager()`, `avg(10)` gives 10 and then `avg(20)` gives 15. Domain: at most 1,000 calls per averager, each receiving a finite Number from -1,000,000 through 1,000,000. Start the Number total at 0, add values in call order, and return total / count without rounding. Normal JavaScript floating-point arithmetic applies; do not promise exact decimal arithmetic. Target: O(1) time per update and O(1) stored state, independent of the number of earlier calls, under unit-cost Number arithmetic.",
    starter: `const makeAverager = () => {

};

// Scratch pad. Uncomment once your function returns a function.
// const avg = makeAverager();
// console.log(avg(10), avg(20));
`,
    skeleton: `const makeAverager = () => {
  let total = 0;
  let count = 0;
  return value => {
    // add the value to the total, count it, and return the average
  };
};`,
    hints: ['Declare `total` and `count` inside `makeAverager`, outside the function it returns. Each call of the returned function updates them, and they survive until the next call.'],
    approach: [
      'Inside `makeAverager`, declare a total and a count, both starting at 0.',
      'Return a function that adds its argument to the total, adds one to the count, and returns total divided by count.',
      'Every call to `makeAverager` creates a fresh total and count, so two averagers never share numbers.',
    ],
    verify: 'tests',
    estimatedMinutes: 5,
    tests: [
      { call: '(() => { const avg = makeAverager(); avg(10); return avg(20); })()', expected: 15 },
      { call: '(() => { const avg = makeAverager(); return [avg(4), avg(8), avg(0)]; })()', expected: [4, 6, 4] },
      { call: '(() => { const avg = makeAverager(); return avg(7); })()', expected: 7, label: 'the first number is its own average', edge: true },
      { call: '(() => { const a = makeAverager(); const b = makeAverager(); a(100); return b(2); })()', expected: 2, label: 'each averager keeps its own numbers', edge: true },
    ],
  },
];
