import { isDeepStrictEqual } from 'node:util';
import type {
  CodingTask,
  CallTest,
  TypeTest,
} from '../../../shared/coding-catalog';
import { EVOLVING_CHALLENGES } from '../../../shared/evolving';
import { test } from './evolving';
import { DEBUG_CHECKPOINTS } from './evolving-debug';
import { FULLSTACK_APPS, fullstackSeed, fullstackSpec } from './fullstack';
import { FULLSTACK_PATH_PRELUDES } from './paths-fullstack';
import { checkpointLadder } from './evolving-checkpoint-hints';

interface Checkpoint {
  prompt: string;
  focus?: CodingTask['focus'];
  references?: CodingTask['references'];
  tests?: CallTest[];
  suite?: string;
  typeTests?: TypeTest[];
  /** Checks for this checkpoint in addition to its inherited signatures. */
  additionalTypeTests?: TypeTest[];
}
const calls = (...entries: [string, unknown][]) =>
  entries.map(([call, expected]) => test(call, expected));
const step = (prompt: string, tests: CallTest[], metadata: Pick<Checkpoint, 'focus' | 'references' | 'additionalTypeTests'> = {}): Checkpoint => ({
  prompt,
  tests,
  ...metadata,
});
const ui = (prompt: string, body: string): Checkpoint => ({
  prompt,
  suite: `test(${JSON.stringify(prompt.split('.')[0])},async()=>{${body}});\n`,
});
const CHECKPOINTS: Record<string, Checkpoint[]> = {
  'js-evolving-calculator': [
    step(
      "Implement calculate(expression) for one non-negative integer, optionally surrounded by whitespace. expression is a primitive string with at most 20000 UTF-16 units. After ECMAScript trim whitespace is removed, it contains one or more ASCII decimal digits; leading zeros are allowed. Its numeric value is at most Number.MAX_SAFE_INTEGER. Return that exact Number; equivalent zero signs are accepted. There are no signs, operators, exponent notation, hexadecimal forms or internal spaces at this checkpoint. n is the actual raw string length. Target: O(n) time and O(n) extra space in the string-copy model. Trimming and Number conversion are allowed; do not narrow the result to 32 bits.",
      calls(
        ["calculate(\"4294967296\")", 4294967296],
        ['calculate("0")', 0],
        ['calculate("42")', 42],
        ['calculate(" 7 ")', 7],
        ['calculate("1234")', 1234],
      ),
      { focus: ['strings', 'functions'], references: [{ title: 'Number()', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/Number' }] },
    ),
    step(
      "Add subtraction alongside addition, applying operators from left to right. Operands may now be non-negative decimal literals: one or more ASCII digits, optionally followed by a dot and one or more digits. Leading zeros remain valid. JavaScript whitespace is allowed between tokens, never inside a number. Inputs are valid primitive strings up to 20000 UTF-16 units, with finite Number operands and results. Use ordinary Number arithmetic, including its rounding: 0.1 + 0.2 is 0.30000000000000004. There are no unary signs or parentheses at this checkpoint. Target: O(n) time and O(n) extra space, where n is the raw string length.",
      calls(
        ["calculate(\"0.1+0.2\")", 0.30000000000000004],
        ["calculate(\"10-3-2\")", 5],
        ["calculate(\"1.5+2.5-1\")", 3],
      ),
      { focus: ["strings", "while"] },
    ),
    step(
      "Add nested parentheses, keeping the earlier four operators, precedence and left associativity. A parenthesized expression acts as one operand. Inputs are valid primitive strings up to 20000 UTF-16 units, with at most 64 nested parentheses, finite Number operands/final results and no division by zero. Use the same ASCII decimal literals, leading zeros, JavaScript whitespace between tokens and ordinary Number rounding. Unary signs and malformed-input handling belong to the next milestone. Scan with an index or sticky number expression; do not repeatedly copy the remaining suffix. Target: O(n) time and O(n) extra space, where n is the raw string length.",
      calls(
        ["calculate(\"2\\uFEFF*(3+4)\")", 14],
        ["calculate(\"2*(3+4)\")", 14],
        ["calculate(\"2*(3+(4/2))\")", 10],
      ),
      { focus: ["strings", "recursion", "while"] },
    ),
    step(
      "Add calculateWithVariables(expression, variables), resolving identifiers as numeric operands. At this checkpoint all expressions are valid, every referenced name exists as an own finite-number data property and evaluation is finite without division by zero. Unknown/invalid names and malformed-input checks come in the next milestone. Identifiers are case-sensitive ASCII names [A-Za-z_][A-Za-z0-9_]* of at most 64 characters. variables is a non-null non-array record with at most 2000 own string-keyed data properties, possibly frozen or with any prototype. Own non-enumerable data properties count; inherited properties and symbols never supply variables. Accessors and proxies are outside this task. Read only referenced names and never mutate the record. Each raw expression has at most 20000 UTF-16 units and retains the earlier decimal/operator/whitespace grammar and 64-level parenthesis/unary bounds. Every finite Number is a valid variable value, including subnormal numbers and values normally printed with an exponent. Equivalent zero signs are accepted. Substitution, if used, must write plain digits and parenthesize negatives; direct token lookup is also valid. Native eval/Function compilers remain unavailable. Target: O(n) time and O(n) extra space, where n is the raw expression length; Number values have a fixed bounded decimal width and property lookup uses the usual constant-time model.",
      calls(
        ["(()=>{const variables=Object.defineProperty({},'Hidden',{value:2});return calculateWithVariables('Hidden+1',variables);})()", 3],
        ['calculateWithVariables("a+2",{a:3})', 5],
        ['calculateWithVariables("a*(b+2)",{a:-3,b:4})', -18],
        ['calculateWithVariables("x",{x:1e-7})', 1e-7],
      ),
      { focus: ["objects", "strings", "while"] },
    ),
    step(
      "Add runProgram(lines). Evaluate valid assignments NAME = expression and expression-only lines in order; every line appends its numeric value to results. Assignments update variables only after evaluating the right side against the current environment. Reassignment is allowed. At this checkpoint all lines are valid, names are defined before use and each result is finite; malformed programs come next. Empty programs return {variables:{},results:[]}. Names follow the earlier case-sensitive identifier grammar, including __proto__, constructor and toString. lines is a dense array of at most 2000 primitive strings, with at most 20000 total UTF-16 units; frozen arrays are valid. Retain earlier expression/variable rules. Each call starts a fresh environment. Return fresh mutable results and a fresh mutable variables record with own enumerable data entries; ordinary or null-prototype records are valid. Do not mutate lines or reuse another call's state. Target: O(n) time and O(n) extra space, where n counts lines plus their total UTF-16units; property lookup uses the usual constant-time model. Do not copy the whole environment before every line.",
      calls(
        ["runProgram([\"Upper=2\",\"upper=3\",\"Upper+upper\"])", {"variables": {"Upper": 2, "upper": 3}, "results": [2, 3, 5]}],
        ['runProgram(["x=2","x+3"])', { variables: { x: 2 }, results: [2, 5] }],
        ['runProgram([])', { variables: {}, results: [] }],
      ),
      { focus: ["objects", "strings", "for-of"] },
    ),
  ],
  'js-evolving-query': [
    step(
      "Implement query(rows, options={}) before filters are introduced. rows is a dense array of at most 20000 non-null record objects; repeated references, frozen records/arrays and arbitrary record fields/prototypes are valid. options is omitted or an empty record at this checkpoint. Return a fresh mutable array containing the exact original record references in order, including duplicates. Treat records as opaque: do not read, copy or change their properties, and do not mutate rows. Separate calls return separate arrays. Target: O(n) time and O(n) extra space, where n is rows.length; field count and field values are not traversed.",
      calls(
        ["(()=>{const row={x:1};return query([row])[0]===row;})()", true],
        ['query([])', []],
        ['query([{x:1}])', [{ x: 1 }]],
        ['query([{x:2},{x:1}])', [{ x: 2 }, { x: 1 }]],
        ['(()=>{const rows=[{x:1}];return query(rows)!==rows})()', true],
      ),
      { focus: ["filter", "functions"] },
    ),
    step(
      "Add stable sorting after filtering. orderBy is omitted/undefined or a field name, including the empty string. desc is a boolean, default false. After filtering, sort by that field: retained values are all finite Numbers or all strings of at most 128 UTF-16 units. Compare with ordinary numeric or literal UTF-16 < and >; use no locale order or Unicode normalization. Equal values keep their input order in both directions. Without orderBy, keep input order. Keep the earlier input, identity and immutability rules and the n/m definitions. Pagination comes next. Target: O(n*m + n*log(n)) time and O(n+m) extra space.",
      calls(
        ["query([{v:\"é\",id:0},{v:\"e\\u0301\",id:1}],{orderBy:\"v\"}).map(row=>row.id)", [1, 0]],
        ['query([{x:3},{x:1}],{orderBy:"x"})', [{ x: 1 }, { x: 3 }]],
        ['query([{x:1},{x:2}],{orderBy:"x",desc:true})', [{ x: 2 }, { x: 1 }]],
      ),
      { focus: ["filter", "sort"] },
    ),
    step(
      "Keep filtering, stable sorting and pagination, then add projection. select is omitted/undefined or a dense array of at most 64 field names, including duplicates or no names. When supplied, create a fresh mutable record per row with only selected own data fields that exist, including non-enumerable fields. Keep values by reference, including undefined; omit inherited/missing fields. Output entries must be own enumerable writable/configurable data properties, including __proto__. Ordinary or null-prototype records are valid; key insertion order is not part of the result. Keep the earlier input, identity and immutability rules and the n/m definitions. With no select, retain original record references; deduplication comes next. Target: O(n*m + n*log(n)) time and O(n+m) extra space. The selected-field count and name width are bounded, so projection is linear in row count.",
      calls(
        ["Object.hasOwn(query([{x:undefined}],{select:['x']})[0],'x')", true],
        ['query([{x:1,y:2}],{select:["x"]})', [{ x: 1 }]],
        ['query([{x:1}],{select:["missing"]})', [{}]],
      ),
      { focus: ["filter", "sort", "map"] },
    ),
    step(
      "Add groupRows(rows, field, valueField), counting each row and summing its value into a strict-equality key group. At this checkpoint every referenced amount is a finite Number; ignoring invalid amounts is added next. rows is a dense array of at most 20000 non-null records. field/valueField are string property names of at most 64 UTF-16 units, including empty/prototype-like names. Use ordinary property lookup; missing keys read undefined. Referenced properties are data (no proxies/accessors); frozen inputs and inherited data are valid, and unused fields remain opaque. Keys may be undefined, null, booleans, Numbers including NaN/infinities, strings up to 128 UTF-16 units, symbols, object/function identities or BigInts of at most 256 bits. Group with ===: NaN never matches any earlier key, zero signs share a group and objects match only by identity. Preserve first-seen group order and original key references; equivalent zero signs are accepted. Use ordinary Number addition, including rounding/possible overflow. Return a fresh mutable array of fresh mutable {key,count,sum} data records and never mutate rows. Target: O(n) time and O(n) extra space, where n is rows.length+1, using normal Map lookup with the stated bounded key widths.",
      calls(
        ["groupRows([{k:NaN,v:1},{k:NaN,v:2}],\"k\",\"v\").map(group=>group.count)", [1, 1]],
        [
          'groupRows([{k:"a",v:2},{k:"a",v:3}],"k","v")',
          [{ key: 'a', count: 2, sum: 5 }],
        ],
        ['groupRows([],"k","v")', []],
      ),
      { focus: ["map-set", "objects"] },
    ),
    step(
      "Add joinRows(left, right, leftKey, rightKey) as an inner join. Emit {left:row,right:row} for each strict-equality key match and omit unmatched left rows. Left-join output is added next. left/right are dense arrays of at most 1000 non-null records each. Key property names are strings up to 64 UTF-16 units, including empty/prototype-like names. Read ordinary data properties; missing reads undefined and inherited data is valid. Frozen inputs are valid; proxies/accessors at referenced fields are outside scope and unused data stays opaque. Keys use the earlier bounded group-key domain and === semantics: NaN never matches, zero signs match and objects/symbols match by identity. Keep exact source row references and every duplicate-key combination, in left position order then right position order. Return fresh mutable pair records in a fresh mutable array; never clone or mutate source rows. Inputs produce at most 20000 output pairs. Target: O(n*m+L) time and O(n+m+L) extra space, where n=left.length+1, m=right.length+1 and L is output pair count. A correct indexed join may be faster.",
      calls(
        ["joinRows([{k:NaN}],[{k:NaN}],\"k\",\"k\").length", 0],
        [
          'joinRows([{id:1}],[{fk:1}],"id","fk")',
          [{ left: { id: 1 }, right: { fk: 1 } }],
        ],
        ['joinRows([{id:1}],[{fk:"1"}],"id","fk")', []],
      ),
      { focus: ["filter", "map", "objects"] },
    ),
  ],
  'js-evolving-events': [
    step(
      "Implement createBus() with on(event, listener) and emit(event, value), delivering values synchronously to the registered listener. At this checkpoint each event is registered at most once per bus; multiple listeners come next. Events are case-sensitive strings of at most 128 UTF-16 units (including empty/prototype-like names) or symbols matched by identity; use no Unicode normalization. Listeners are functions and do not throw, register or recursively emit at this step. Deliver exactly once before emit returns, ignore the listener return value and do nothing for unknown events. Pass the exact value unchanged, including undefined, null, falsy primitives, functions and cyclic/opaque objects; do not inspect or clone payloads. Each bus owns independent private state. There are at most 20000 registrations per bus. Target: O(1) time per on/emit, excluding callback work; O(k) extra space across k registered event names, with ordinary bounded-key lookup. Creating a bus takes O(1).",
      calls(
        ["(()=>{const value={},bus=createBus();let same=false;bus.on('x',received=>same=received===value);bus.emit('x',value);return same;})()", true],
        [
          '(()=>{const b=createBus(),a=[];b.on("x",v=>a.push(v));b.emit("x",2);return a})()',
          [2],
        ],
        [
          '(()=>{const b=createBus(),a=[];b.on("x",v=>a.push(v));b.emit("y",2);return a})()',
          [],
        ],
        [
          '(()=>{const b=createBus(),a=[];b.on("x",v=>a.push(v));b.emit("x",0);return a})()',
          [0],
        ],
        [
          '(()=>{const b=createBus(),a=[];b.on("x",v=>a.push(v));b.emit("x",1);b.emit("x",2);return a})()',
          [1, 2],
        ],
      ),
      { focus: ["closures", "map-set"] },
    ),
    step(
      "Make on(event, listener) return a fresh idempotent unsubscribe function for that registration only. Preserve every other subscription, including registrations of the same callback or another event. Repeating it or calling it after removal does nothing further. Callbacks do not throw, change subscriptions or reenter emit at this checkpoint; once comes next. Keep the earlier bounded event/payload rules, independent state, one-argument delivery, ignored listener returns and n/k definitions. Target: O(n) time and O(n) extra space per emit, excluding callback work/persistent state. Creating a bus and registering/unsubscribing target O(1) amortized time; state remains O(k).",
      calls(
        ["(()=>{const bus=createBus();let calls=0;const fn=()=>calls++;bus.on('x',fn);const off=bus.on('x',fn);off();off();bus.emit('x');return calls;})()", 1],[
        '(()=>{const b=createBus(),a=[];const off=b.on("x",()=>a.push(1));off();off();b.emit("x");return a})()',
        [],
      ]),
    ),
    step(
      "Catch each listener exception, continue and return the thrown values from this emit in order, in a fresh mutable array. Unknown/successful emits return fresh []. Keep exact values, including undefined, objects or arrays; do not stringify, flatten or deduplicate. Keep prior once/unsubscribe and bounded nesting. Listeners may now throw, but explicit subscription changes during delivery and snapshot semantics come next. Keep the earlier bounded event/payload rules, independent state, one-argument delivery, ignored listener returns and n/k definitions. Target: O(n) time and O(n) extra space per emit, excluding callback work/persistent state. Creating a bus and registering/unsubscribing target O(1) amortized time; state remains O(k).",
      calls(
        ["(()=>{const bus=createBus();bus.on('é',()=>{throw 'a'});bus.on('e\\u0301',()=>{throw 'b'});return bus.emit('é');})()", ["a"]],
        [
          '(()=>{const b=createBus();b.on("x",()=>{throw "a"});b.on("x",()=>{throw "b"});return b.emit("x")})()',
          ['a', 'b'],
        ],
        ['createBus().emit("none")', []],
      ),
    ),
    step(
      "Add createBufferedBus() exposing on, once, emit, pause and resume. Keep the earlier bounded exact event names, opaque payloads, independent subscriptions and snapshot/error rules. Each bus starts unpaused. pause is idempotent. A paused emit queues the exact event/value pair and returns fresh mutable []; an unpaused emit dispatches immediately. resume unpauses, removes queued pairs oldest first before delivery and returns a fresh mutable array of the direct errors from those deliveries, in delivery/listener order. Resolve subscriptions when draining, not when enqueueing; keep thrown arrays as single error values. Empty resume is safe. At most 20000 emissions and registrations occur per bus; inherited nesting limits still apply. Let q=1+events drained by this resume, c=total subscription entries captured for their delivery and n=q+c. Target: O(n) time amortized over queue operations, excluding callback work and separately charged nested calls. Queue storage is O(H), H=1+lifetime queued pairs, with O(k) subscription state and O(c) transient delivery/error space. Enqueue, pause and dequeue target amortized O(1); use a cursor, linked nodes or two stacks instead of shifting the queue. Callbacks do not call pause, resume or the buffered emit during a flush at this checkpoint; stopping/reentering a flush comes next.",
      calls(
        ["(()=>{const bus=createBufferedBus(),seen=[];bus.on('x',value=>seen.push(value));bus.pause();bus.emit('x',1);bus.emit('x',2);bus.resume();return seen;})()", [1, 2]],
        [
          '(()=>{const b=createBufferedBus(),a=[];b.on("x",v=>a.push(v));b.pause();b.emit("x",1);const before=a.slice();b.resume();return [before,a]})()',
          [[], [1]],
        ],
      ),
    ),
    step(
      "Add createReplayBus(capacity) with emit and on(event,listener,replay=false). Keep the earlier exact event/payload and live subscription/error rules. capacity is any non-negative safe integer, including 0 and values above 2^32; allocate history lazily, never an array of length capacity. Retain exact values even without listeners, before dispatching live callbacks. Histories are separate per event/bus. on(event,listener,replay=false) returns an idempotent unsubscribe; false/omitted means future values only, true synchronously delivers the newest retained values oldest first, then future live values. Replay callbacks do not throw, recursively emit or change subscriptions at this step. There are at most 20000 emissions and registrations per bus; inherited live nesting limits remain. Let n=1+live subscriptions for emit, or 1+retained values delivered by replaying on. Target: O(n) time and O(n) transient delivery space, excluding callback work; retaining one value targets amortized O(1), not repeated history copies. Persistent history is O(H) across H=1+lifetime emissions, bounded further by capacity per event, with O(k) subscription state. Zero capacity still dispatches live values. This checkpoint has no clear method; clearing history comes next.",
      calls(
        ["(()=>{const bus=createReplayBus(4294967296),seen=[];bus.emit('x',1);bus.emit('x',2);bus.on('x',value=>seen.push(value),true);return seen;})()", [1, 2]],
        [
          '(()=>{const b=createReplayBus(2),a=[];[1,2,3].forEach(v=>b.emit("x",v));b.on("x",v=>a.push(v),true);return a})()',
          [2, 3],
        ],
      ),
    ),
  ],
  'js-evolving-graph': [
    step(
      "Implement plan(graph) for independent tasks: every task dependency is an empty array, so no dependency traversal is required. graph is a non-null non-array record with any prototype, possibly frozen, containing at most 20000 own properties. Task IDs are its own enumerable string keys (at most 64 UTF-16 units); ignore inherited, non-enumerable and symbol keys without reading their values. IDs may be empty, Unicode or prototype-like. Return them exactly in Object.keys order: canonical array-index keys in numeric order, then other string keys in creation order. Do not sort or normalize names. Return a fresh mutable array, including for empty graphs, without mutating graph/arrays. Task fields are data properties; unused metadata may contain accessors and stays opaque. Proxies are outside scope. Target: O(n) time and O(n) extra space, n=1+all own properties, using bounded-name lookup. Dependency ordering comes in the next milestone.",
      calls(
        ["plan(Object.assign(Object.create({inherited:[]}),{own:[]}))", ["own"]],
        ['plan({})', []],
        ['plan({a:[]})', ['a']],
        ['plan({b:[],a:[]})', ['b', 'a']],
        ['plan({a:[],b:[],c:[]})', ['a', 'b', 'c']],
      ),
      { focus: ['objects', 'functions'], references: [{ title: 'Own enumerable keys', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys' }] },
    ),
    step(
      "Validate every dependency before traversal. Return null if any referenced ID is not a declared own enumerable task key, including a name found only in inherited or hidden metadata. Otherwise keep the earlier deterministic DFS order and bounded graph/ownership/n/m rules. Graphs remain acyclic at this checkpoint; cycle rejection comes next. Target: O(n+m) time and O(n+m) extra space.",
      calls(
        ["plan(Object.assign(Object.create({missing:[]}),{root:[\"missing\"]}))", null],
        ['plan({a:["missing"]})', null]),
    ),
    step(
      "Add plan(graph, options={}) with options.layers omitted/undefined/false or true. Default/false retains the previous validated DFS result, including null for invalid graphs. For true, this checkpoint supplies only valid acyclic graphs with declared dependencies. Return fresh mutable arrays of every currently ready task, in Object.keys order within each layer. All dependencies must have completed in earlier layers; collect the whole layer before marking its members complete. Empty graph returns fresh []. Keep prior graph bounds, exact IDs, ownership and n/m definitions. Do not share layer arrays with each other or across calls. Target: O(n*(n+m)) time and O(n+m) extra space; rescanning for each layer is allowed and a correct depth/index approach may be faster. Invalid layered graphs are handled in the next milestone.",
      calls(
        ["(()=>{const layers=plan({root:['leaf'],leaf:[]},{layers:true});layers[0].push('mutable');return layers;})()", [["leaf", "mutable"], ["root"]]],
        [
        'plan({a:[],b:[],c:["a","b"]},{layers:true})',
        [['a', 'b'], ['c']],
      ]),
    ),
    step(
      "Add criticalPath(graph,durations) for valid acyclic graphs where every task has a supplied own finite non-negative Number duration. Count each node on the selected dependency chain, not unrelated branches. Defaults and invalid-input rejection come next. Keep the earlier bounded graph/ID/readonly/n/m rules. durations is a non-null non-array record with any prototype, possibly frozen, with at most 20000 own properties. Only own data values at declared task IDs supply durations, including non-enumerable values; inherited/unknown/symbol entries are ignored without reading them. Accessors at used duration fields and proxies are outside scope. Use ordinary Number addition without rounding or integer narrowing; equivalent zero signs are accepted. Inputs guarantee every chain sum is finite. Choose a node's first dependency-array entry among equal-duration chains and the first node in plan order among equal overall totals, including zero totals; longest means greatest total duration, not most nodes. Return a fresh mutable {duration,path} record and path array, independent of graph/durations/other calls. Empty graph returns {duration:0,path:[]}. Let d=1+maximum chain node count. Target: O(n*d+m) time and O(n*d+m) extra space, allowing copied per-node paths; predecessor links may be faster.",
      calls(
        ["criticalPath({a:[],b:[\"a\"]},{a:0.25,b:0.5})", {"duration": 0.75, "path": ["a", "b"]}],

        [
          'criticalPath({a:[],b:["a"],c:[]},{a:2,b:3,c:4})',
          { duration: 5, path: ['a', 'b'] },
        ],
        [
          'criticalPath({a:[],b:["a"]},{a:0,b:1})',
          { duration: 1, path: ['a', 'b'] },
        ],
      ),
    ),
    step(
      "Add impactedNodes(graph,changed) for valid acyclic graphs and known declared changed task IDs. Keep the prior bounded graph, exact IDs, readonly ownership and deterministic DFS plan order. changed is a dense readonly array of at most 20000 exact string task IDs, possibly frozen, with duplicates allowed. Propagate to dependents transitively, never to an otherwise unaffected dependency; emit every affected declared task once in plan order regardless of changed order. Return a fresh mutable array without changing changed/graph/dependencies or reusing another call's result. Let k=1+changed.length and retain n/m from plan. Target: O(n+m+k) time and O(n+m+k) extra space. A forward scan or reverse-edge traversal is valid; avoid shifting a large queue. Unknown IDs and invalid graphs are rejected in the next milestone.",
      calls(
        ["impactedNodes({'\u00e9':[],'e\\u0301':[],root:['e\\u0301']},['e\\u0301'])", ["e\u0301", "root"]],
        ['impactedNodes({a:[],b:["a"],c:["b"],d:[]},["b"])', ['b', 'c']]),
    ),
  ],
  'ts-evolving-result': [
    step(
      'Implement generic mapResult<T,U> for successful Result<T> values. Apply fn once and wrap its value as {ok:true,value}. Keep the Result union and precise return types; callbacks do not throw yet. Only successful inputs are required at this checkpoint; failure handling is the next milestone. Inputs may be frozen. Call fn synchronously exactly once with the exact opaque value and wrap its exact result in a fresh mutable success record; do not inspect, clone, await or coerce payloads. A Promise returned by fn stays the value. Keep mapResult<T,U>(result:Result<T>,fn:(value:T)=>U):Result<U>. Target: O(1) time and O(1) extra space, excluding callback work and payload storage, per runtime call; compiler work is separate.',
      calls(
        ["(()=>{let count=0;const value=[];const out=mapResult({ok:true,value},x=>{count++;return x;});return out.ok===true&&out.value===value&&count===1;})()", true],
        ['mapResult({ok:true,value:2},n=>n*3)', { ok: true, value: 6 }],
        ['mapResult({ok:true,value:0},String)', { ok: true, value: '0' }],
        [
          'mapResult({ok:true,value:null},()=>false)',
          { ok: true, value: false },
        ],
        ['mapResult({ok:true,value:"a"},s=>s.length)', { ok: true, value: 1 }],
      ),
    ),
    step(
      "Add flatMapResult<T,U>(result,fn), where fn returns Result<U>. Forward failures unchanged and return callback results without nesting. Callbacks in this step do not throw. Result inputs are readonly ordinary data records and may be frozen. On success call fn synchronously once with the exact original value and return its exact Result object, including a frozen or reused callback result, without cloning, inspecting or awaiting its payload. On input failure do not call fn; preserve the exact error string, allowing the original or an equivalent fresh failure wrapper. Preserve earlier mapResult requirements. Target: O(1) time and O(1) extra space for flatMapResult itself, excluding callback work and opaque payload storage; TypeScript compiler work is separate.",
      calls(
        ["(()=>{const next={ok:true,value:[]};return flatMapResult({ok:true,value:1},()=>next)===next;})()",true],
        [
          'flatMapResult({ok:true,value:2},n=>({ok:true,value:n+1}))',
          { ok: true, value: 3 },
        ],
        [
          'flatMapResult({ok:false,error:"bad"},()=>{throw "called"})',
          { ok: false, error: 'bad' },
        ],
      ),
      { additionalTypeTests: [{"code": "{const fn:<T,U>(r:Result<T>,cb:(v:T)=>Result<U>)=>Result<U>=flatMapResult;const r:Result<string>=flatMapResult({ok:true,value:1},(n:number)=>({ok:true,value:String(n)}));}"}, {"code": "{const bad:Result<string>=flatMapResult({ok:true,value:1},(n:number)=>({ok:true,value:n}));}", "rejects": true}] },
    ),
    step(
      "Add collectResults<T>(results:readonly Result<T>[]):Result<T[]>. Collect successful values in order; stop at the first failure. Empty inputs succeed with []. results is a dense readonly array of at most 10000 valid ordinary Result records, possibly frozen. Copy successful payload references, not their contents, into a fresh mutable success array and fresh mutable success wrapper, preserving duplicates and exact order. On the first failure return its exact error string without processing later results; original or equivalent fresh failure wrapper is allowed. Never change inputs. Empty calls each own a fresh array. Target: O(n) time and O(n) extra space, where n is one plus results.length; opaque payload size is excluded.",
      calls(
        ["(()=>{const value=[];const out=collectResults([{ok:true,value},{ok:true,value}]);return out.ok===true&&out.value.length===2&&out.value[0]===value&&out.value[1]===value;})()",true],
        [
          'collectResults([{ok:true,value:1},{ok:true,value:2}])',
          { ok: true, value: [1, 2] },
        ],
        ['collectResults([])', { ok: true, value: [] }],
      ),
      { additionalTypeTests: [{"code": "{const fn:<T>(r:readonly Result<T>[])=>Result<T[]>=collectResults;const r:Result<number[]>=collectResults([{ok:true,value:1}] as const);}"}, {"code": "{const bad:Result<string[]>=collectResults([{ok:true,value:1}]);}", "rejects": true}] },
    ),
    step(
      "Add partitionResults<T>(results:readonly Result<T>[]), returning {values:T[],errors:string[]}. Preserve relative order within each group. Start with all-success and empty inputs. Only all-success and empty inputs are required at this checkpoint; mixed failures come next. results is a dense readonly array of at most 10000 valid ordinary success records, possibly frozen. Keep original opaque values, duplicates and order without inspecting, cloning or awaiting them. Each call returns a fresh mutable outer record and two distinct fresh mutable arrays; errors starts empty and remains usable by the caller. Empty calls do not share storage. Preserve input state. Target: O(n) time and O(n) extra space, where n is one plus results.length; payload size is excluded.",
      calls(
        ["(()=>{const out=partitionResults([]);out.errors.push('mutable');return out.values.length===0&&out.errors[0]==='mutable';})()",true],
        [
          'partitionResults([{ok:true,value:1},{ok:true,value:2}])',
          { values: [1, 2], errors: [] },
        ],
        ['partitionResults([])', { values: [], errors: [] }],
      ),
      { additionalTypeTests: [{"code": "{const fn:<T>(r:readonly Result<T>[])=>{values:T[];errors:string[]}=partitionResults;}"}, {"code": "{const bad:{values:string[];errors:string[]}=partitionResults([{ok:true,value:1}]);}", "rejects": true}] },
    ),
    step(
      "Add recoverResult<T>(result,fn) to recover a failure using fn(error):Result<T>. A success passes through without calling fn. Convert callback throws using the earlier error convention. On success return the original Result record without invoking fn. On failure call fn once synchronously with the exact original error string and return its exact Result record without cloning or awaiting it. Result records may be frozen and payloads are opaque. Use the earlier exact Error.message/String(nonError) policy for synchronous throws: messages/conversions are strings of at most 20000 units and conversion does not throw. A newly caught failure owns a mutable record. Do not mutate inputs. Target: O(1) time and O(1) additional wrapper space for recoverResult itself; callback work, opaque payloads and throwable text conversion are excluded.",
      calls(
        ["(()=>{const next={ok:true,value:[]};return recoverResult({ok:false,error:'x'},()=>next)===next;})()",true],[
        'recoverResult({ok:false,error:"x"},e=>({ok:true,value:e.length}))',
        { ok: true, value: 1 },
      ]),
      { additionalTypeTests: [{"code": "{const fn:<T>(r:Result<T>,cb:(e:string)=>Result<T>)=>Result<T>=recoverResult;}"}, {"code": "{const bad:Result<string>=recoverResult<number>({ok:false,error:\"x\"},()=>({ok:true,value:1}));}", "rejects": true}] },
    ),
  ],
  'ts-evolving-store': [
    step(
      "Implement generic createStore<T>(initial) with get():T and set(value:T):void. Store and replace ordinary numeric or string values in a closure. At this checkpoint the runtime inputs are finite Number values from -1000000000 to 1000000000 or primitive strings of at most 20000 UTF16 units. Preserve exact values, including signed zero and text case/whitespace/Unicode representation; do not trim, normalize or coerce them. Each factory call owns an independent state binding. Both methods must work when detached from the returned object; set has a void return type. Keep the generic get/set types even though this checkpoint exercises only numbers and strings. Target: O(1) time and O(1) additional storage per createStore/get/set call, excluding storage of the original value.",
      calls(
        ["(()=>{const store=createStore('e\\u0301');store.set(' \u00e9 ');return store.get();})()"," \u00e9 "],
        ['createStore(1).get()', 1],
        ['createStore("a").get()', 'a'],
        ['(()=>{const s=createStore(1);s.set(2);return s.get()})()', 2],
        ['(()=>{const s=createStore("a");s.set("b");return s.get()})()', 'b'],
      ),
    ),
    step(
      "Add update(fn:(value:T)=>T):void. Apply fn to the current state and pass its result through set. Keep the earlier exact opaque state and detached get/set rules. update also works detached: call fn synchronously exactly once with the original current value, then store its exact return reference/value through set without cloning, coercion or awaiting. Callbacks do not throw, change this store themselves or depend on this. No subscriptions or history are required yet. Preserve update(fn:(value:T)=>T):void. Target: O(1) time and O(1) extra storage for update itself, excluding callback work and opaque state storage.",
      calls(
        ["(()=>{let count=0;const s=createStore(1);s.update(v=>{count++;return v+1;});return [s.get(),count];})()",[2, 1]],[
        '(()=>{const s=createStore(1);s.update(n=>n+2);return s.get()})()',
        3,
      ]),
      { additionalTypeTests: [{"code": "{const s=createStore(1);const update:(fn:(v:number)=>number)=>void=s.update;const empty:void=update((n:number)=>n+1);}"}, {"code": "{createStore(1).update((n:number)=>String(n));}", "rejects": true}] },
    ),
    step(
      "Add undo():boolean. Each actual set/update records the prior value; undo restores it and notifies subscribers once. Return false without notifying when history is empty. Keep all earlier opaque-state, Object.is, independent snapshot subscription and nonthrowing/nonreentrant callback rules. Save original state references without cloning; undo restores that exact prior value and notifies once, or returns false without notification/history changes when unavailable. Equal set/update creates no undo entry. No redo is required here. Methods work detached. Do not impose a fixed history cap; this task uses at most 10000 state-changing calls and 256 live subscriptions. Target: O(n) time per state operation, amortized in the usual array append/pop model, and O(h+n) space for retained history and registrations, where n is one plus live subscriptions and h is one plus retained past states; get is O(1). Callback work and opaque state contents are excluded.",
      calls(
        ["(()=>{const first=[],s=createStore(first);s.set([1]);s.undo();return s.get()===first;})()",true],[
        '(()=>{const s=createStore(0);s.set(1);return [s.undo(),s.get(),s.undo()]})()',
        [true, 0, false],
      ]),
      { additionalTypeTests: [{"code": "{const flag:boolean=createStore(1).undo();}"}, {"code": "{const bad:string=createStore(1).undo();}", "rejects": true}] },
    ),
    step(
      "Add selectStore<T,U>(store,select:(value:T)=>U) with get():U. Subscribe to the source and keep the selected value current after source changes. Accept any source with get():T and subscribe(fn:(value:T)=>void):()=>void; do not require other createStore methods. A source does not emit on subscribe and sends its current original value synchronously on each change. Compute select once from source.get() during creation and once per notification from its supplied value. get returns the same cached opaque U until a notification, without rereading the source, recomputing, cloning or awaiting it. Selectors do not throw, change the source or depend on this. This checkpoint needs only get; derived subscribers/dispose come next. Target: O(1) time and O(1) extra space for own work per creation, notification or get, excluding selector execution, source get/subscribe/notification work and opaque payload storage.",
      calls(
        ["(()=>{let count=0;const s=createStore(1),d=selectStore(s,v=>{count++;return [v];}),first=d.get();return d.get()===first&&count===1;})()",true],[
        '(()=>{const s=createStore({n:1}),d=selectStore(s,x=>x.n);s.set({n:2});return d.get()})()',
        2,
      ]),
      { additionalTypeTests: [{"code": "{const d=selectStore(createStore({n:1}),(v:{n:number})=>String(v.n));const value:string=d.get();}"}, {"code": "{const d=selectStore(createStore({n:1}),(v:{n:number})=>String(v.n));const bad:number=d.get();}", "rejects": true}] },
    ),
    step(
      "Add transactStore<T>(store,steps:readonly ((value:T)=>T)[]):boolean. Compute pure steps privately and perform one set with the final value. Return true; this step uses callbacks that do not throw. Keep the earlier full createStore/selectStore contracts. Also accept any minimal source with get():T and set(value:T):void. steps is a dense readonly/frozen array of at most 10000 synchronous pure functions with stable membership and no this dependence; each receives the exact previous opaque result once in order. Read source.get once, stage only local references without clone/freeze/coercion/await, then call source.set exactly once with the final value, including empty/no-op transactions. Do not expose intermediate values or extra undo entries. Callbacks and source methods do not throw or mutate the source; pure steps do not mutate their inputs. Preserve boolean return and generic readonly step types. Target: O(n) time and O(1) extra space for transaction work, where n is one plus steps.length, excluding callback/source work and opaque payload storage. Earlier source/derived history and subscription bounds remain separate.",
      calls(
        ["(()=>{let sets=0;const source={get:()=>1,set:()=>{sets++;}};return [transactStore(source,[]),sets];})()",[true, 1]],[
        '(()=>{const s=createStore(1);return [transactStore(s,[x=>x+1,x=>x*3]),s.get()]})()',
        [true, 6],
      ]),
      { additionalTypeTests: [{"code": "{const source={get:()=>1,set:(v:number):void=>{}};const steps:readonly ((n:number)=>number)[]=[n=>n+1];const ok:boolean=transactStore(source,steps);}"}, {"code": "{const bad:string=transactStore(createStore(1),[]);}", "rejects": true}, {"code": "{transactStore(createStore(1),[(n:number)=>String(n)]);}", "rejects": true}] },
    ),
  ],
  'ts-evolving-schema': [
    step(
      "Implement validate(schema,value:unknown):string[] for the string schema. Return [] for strings and [\"$: expected string\"] otherwise. Keep the supplied Schema union. The runtime schema in this checkpoint is only \"string\"; keep the supplied union unchanged for the next milestone. Test primitive typeof string without coercion: empty, whitespace and exact Unicode strings up to 20000 UTF16 units are valid; boxed String values and all other opaque values are invalid. Do not inspect, convert, clone or mutate the value. Each call returns a fresh mutable string[] with exactly the stated error, or a fresh empty array. Preserve validate(schema:Schema,value:unknown):string[]. Target: O(1) time and O(1) extra space per call, excluding input storage; string contents are not traversed.",
      calls(
        ["validate('string',new String('x'))",["$: expected string"]],
        ['validate("string","a")', []],
        ['validate("string","")', []],
        ['validate("string",2)', ['$: expected string']],
        ['validate("string",null)', ['$: expected string']],
      ),
      { additionalTypeTests: [{"code": "{const fn:(schema:Schema,value:unknown)=>string[]=validate;const errors:string[]=fn(\"string\",undefined);}"}, {"code": "{const bad:number=validate(\"string\",1);}", "rejects": true}] },
    ),
    step(
      "Extend Schema with {object:Record<string,Schema>} and validate flat records. Check declared fields in schema order, allow extras, and use $.FIELD paths. Missing fields are undefined. Keep all earlier primitive/no-coercion and fresh mutable string[] rules. Schemas are valid ordinary data with exactly one structural discriminator and acyclic nesting; schema field maps may be frozen or have null prototypes. Traverse only own enumerable schema fields in Object.keys order; a missing own candidate field is undefined even if inherited. Read declared own data fields only, ignore extras without inspecting them, and do not mutate schemas or values. Field names contain at most 64 UTF16 units; build paths by literal dot/index concatenation without escaping. Values may be frozen or have prototypes; selected fields have ordinary data descriptors. Unvisited extras may have getters. Schema depth is at most 32 and a call visits at most 20000 schema/value pairs; each field map has at most 1000 keys. Exclude input payload contents and unvisited extra fields from work counts. Runtime object schemas here are flat maps of primitive schemas and candidate object values are non-null non-array records; retain all primitive runtime checks too. Target: O(n+p) time and O(n+p) extra space, where n is one plus the number of declared fields and p is the total returned error-text length.",
      calls(
        ["validate({object:{name:'string'}},Object.create({name:'inherited'}))",["$.name: expected string"]],[
        'validate({object:{name:"string"}},{name:2})',
        ['$.name: expected string'],
      ]),
      { additionalTypeTests: [{"code": "{const errors:string[]=validate({object:{x:\"boolean\"}},{});}"}, {"code": "{validate({object:{x:\"date\"}},{});}", "rejects": true}] },
    ),
    step(
      "Extend Schema with {array:Schema}. Validate each array element in order using $[INDEX] paths. A non-array returns [\"$: expected array\"]. Keep all earlier primitive/no-coercion and fresh mutable string[] rules. Schemas are valid ordinary data with exactly one structural discriminator and acyclic nesting; schema field maps may be frozen or have null prototypes. Traverse only own enumerable schema fields in Object.keys order; a missing own candidate field is undefined even if inherited. Read declared own data fields only, ignore extras without inspecting them, and do not mutate schemas or values. Field names contain at most 64 UTF16 units; build paths by literal dot/index concatenation without escaping. Values may be frozen or have prototypes; selected fields have ordinary data descriptors. Unvisited extras may have getters. Schema depth is at most 32 and a call visits at most 20000 schema/value pairs; each field map has at most 1000 keys. Exclude input payload contents and unvisited extra fields from work counts. Arrays are ordinary arrays with standard prototypes/iteration, may be frozen or sparse, and have length at most 10000. Validate every numeric index from 0 to length-1; holes count as undefined rather than being skipped. Do not fill holes or mutate arrays. Wrong array containers produce one error at their current path. Optional schemas are not required yet. Target: O(n*d+p) time and O(n*d+p) extra space as a common upper bound, where n is one plus visited schema/value pairs, d is one plus maximum visited schema depth, and p is the total UTF16 length of returned error strings. This includes repeated error-array copying and rendered paths; implementations that collect directly may use less.",
      calls(
        ["validate({array:'number'},new Array(2))",["$[0]: expected number", "$[1]: expected number"]],['validate({array:"number"},[1,"x"])', ['$[1]: expected number']]),
      { additionalTypeTests: [{"code": "{const errors:string[]=validate({array:{object:{x:\"number\"}}},[]);}"}, {"code": "{validate({array:\"date\"},[]);}", "rejects": true}] },
    ),
    step(
      "Add validateRecord(schema:Schema,value:unknown):string[] for plain records. Validate every own enumerable value and replace the root path with $.KEY. Preserve key order; an empty record succeeds. Keep all earlier primitive/no-coercion and fresh mutable string[] rules. Schemas are valid ordinary data with exactly one structural discriminator and acyclic nesting; schema field maps may be frozen or have null prototypes. Traverse only own enumerable schema fields in Object.keys order; a missing own candidate field is undefined even if inherited. Read declared own data fields only, ignore extras without inspecting them, and do not mutate schemas or values. Field names contain at most 64 UTF16 units; build paths by literal dot/index concatenation without escaping. Values may be frozen or have prototypes; selected fields have ordinary data descriptors. Unvisited extras may have getters. Schema depth is at most 32 and a call visits at most 20000 schema/value pairs; each field map has at most 1000 keys. Exclude input payload contents and unvisited extra fields from work counts. Keep full optional/array validation, including sparse holes as undefined. Runtime validateRecord inputs at this checkpoint are non-null non-array ordinary records (possibly frozen or with null/inherited prototypes). Visit only Object.keys(value), ignore inherited, non-enumerable and symbol keys, preserve its standard numeric/string key order, and rewrite only the leading $ in each nested error. Record keys use letters, digits and underscores, at most 64 units; at most 1000 entries. Each record result is a fresh mutable string[]. Preserve validateRecord(schema:Schema,value:unknown):string[]. Target: O(n*d+p) time and O(n*d+p) extra space as a common upper bound, where n is one plus visited schema/value pairs, d is one plus maximum visited schema depth, and p is the total UTF16 length of returned error strings. This includes repeated error-array copying and rendered paths; implementations that collect directly may use less. For validateRecord, n and p aggregate all entry validations plus the record-key traversal; d includes their deepest schema visit.",
      calls(
        ["validateRecord('number',{z:'bad',a:'bad'})",["$.z: expected number", "$.a: expected number"]],
        ['validateRecord("number",{a:"x"})', ['$.a: expected number']],
        ['validateRecord("number",{})', []],
      ),
      { additionalTypeTests: [{"code": "{const fn:(schema:Schema,value:unknown)=>string[]=validateRecord;const out:string[]=fn({optional:\"number\"},{});}"}, {"code": "{const bad:number=validateRecord(\"number\",{});}", "rejects": true}, {"code": "{validateRecord(\"date\",{});}", "rejects": true}] },
    ),
    step(
      "Add validateUnion(schemas:readonly Schema[],value:unknown):string[]. Succeed if any branch validates; otherwise return the shortest error list, breaking ties by schema order. Empty schemas returns [\"$: no alternatives\"]. Retain all earlier schema and record contracts. schemas is a dense readonly/frozen array of at most 1000 valid acyclic schemas; do not sort/mutate it. A zero-error branch succeeds; if none succeeds, choose the first branch among those with minimum error count, not minimum text length. Returning after a successful branch or checking other valid branches is allowed; no observable getter/callback behavior is part of a schema. Empty, success and failure results are fresh mutable string[]. Preserve validateUnion(schemas:readonly Schema[], value:unknown):string[]. Target: O(n*d+p) time and O(n*d+p) extra space for this checkpoint, where n is one plus the summed schema/value-pair counts across all branches plus array length, d is maximum schema depth+1, and p is total generated branch-error text. This bounds the permitted full scan even on success. Retain depth 32, <=20000 aggregate pairs and prior key/array bounds.",
      calls(
        ["validateUnion(['string','boolean'],2)",["$: expected string"]],
        ['validateUnion(["string","number"],2)', []],
        ['validateUnion([],1)', ['$: no alternatives']],
      ),
      { additionalTypeTests: [{"code": "{const rules:readonly Schema[]=[\"number\"];const errors:string[]=validateUnion(rules,undefined);}"}, {"code": "{const bad:number=validateUnion([\"string\"],1);}", "rejects": true}, {"code": "{validateUnion([\"date\"],1);}", "rejects": true}] },
    ),
  ],
  'react-evolving-board': [
    ui(
      'Create default-exported App with a controlled input labelled "Task" and an "Add" button. Typing should update the input; start empty.',
      `render(<App/>);const input=screen.getByLabelText('Task');expect(input.value).toBe('');fireEvent.change(input,{target:{value:'Write'}});expect(input.value).toBe('Write');expect(screen.getByRole('button',{name:'Add',exact:true})).toBeTruthy();`,
    ),
    ui(
      'Add filter buttons "All", "Active", "Completed". Derive visible rows without changing the full task list.',
      `render(<App/>);add('A');add('B');fireEvent.click(screen.getByRole('checkbox',{name:'A'}));fireEvent.click(screen.getByRole('button',{name:'Active',exact:true}));expect(screen.queryByRole('checkbox',{name:'A'})).toBeNull();expect(screen.getByRole('checkbox',{name:'B'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'All',exact:true}));expect(screen.getAllByRole('checkbox').length).toBe(2);`,
    ),
    ui(
      'Add "Undo" for task mutations. Disable it initially; one undo restores the complete task list before the latest add, delete or toggle.',
      `render(<App/>);expect(screen.getByRole('button',{name:'Undo',exact:true}).disabled).toBe(true);add('A');fireEvent.click(screen.getByRole('button',{name:'Undo',exact:true}));expect(screen.queryByRole('checkbox',{name:'A'})).toBeNull();`,
    ),
    ui(
      'Add "Complete all" to mark every task complete regardless of filter. Disable it when no active tasks exist. Treat the action as one undoable mutation.',
      `render(<App/>);expect(screen.getByRole('button',{name:'Complete all',exact:true}).disabled).toBe(true);add('A');add('B');fireEvent.click(screen.getByRole('button',{name:'Complete all',exact:true}));expect(screen.getAllByRole('checkbox').every(x=>x.checked)).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Undo',exact:true}));expect(screen.getAllByRole('checkbox').every(x=>!x.checked)).toBe(true);`,
    ),
    ui(
      'Add "Move up TASK_TEXT" buttons. Move a task one position earlier in the full list, preserving its ID and completion. Disable the first task’s button.',
      `render(<App/>);add('A');add('B');expect(screen.getByRole('button',{name:'Move up A',exact:true}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Move up B',exact:true}));expect(require('@testing-library/react').within(screen.getAllByRole('listitem')[0]).getByRole('checkbox',{name:'B',exact:true})).toBeTruthy();`,
    ),
  ],
  'react-evolving-catalog': [
    ui(
      'Render products in default-exported App: Apple (id 1, price 2), Banana (id 2, price 1), Carrot (id 3, price 3), Dates (id 4, price 4). Use li elements containing each name and price.',
      `render(<App/>);const rows=screen.getAllByRole('listitem');expect(rows[0].textContent).toContain('Apple');expect(rows[0].textContent).toContain('2');expect(rows[1].textContent).toContain('Banana');expect(rows[1].textContent).toContain('1');`,
    ),
    ui(
      'Add a select labelled "Sort" with values name, price-asc and price-desc, defaulting to name. Sort a copy of the filtered products.',
      `render(<App/>);fireEvent.change(screen.getByLabelText('Sort'),{target:{value:'price-desc'}});expect(screen.getAllByRole('listitem')[0].textContent).toContain('Dates');`,
    ),
    ui(
      'Add a checkbox labelled with each product name. Keep selected IDs independent of pagination and search; output "Selected total" sums prices of all selected products.',
      `render(<App/>);fireEvent.click(screen.getByRole('checkbox',{name:'Apple'}));expect(screen.getByLabelText('Selected total').textContent).toBe('2');search('Dates');expect(screen.getByLabelText('Selected total').textContent).toBe('2');`,
    ),
    ui(
      'Add the number input "Maximum price". Empty means no limit; a non-negative number retains products priced at or below it.',
      `render(<App/>);fireEvent.change(screen.getByLabelText('Maximum price'),{target:{value:'1'}});expect(screen.getAllByRole('listitem').length).toBe(1);expect(screen.getByRole('listitem').textContent).toContain('Banana');`,
    ),
    ui(
      'For selected products show "Quantity NAME" inputs, including products hidden by search. Default quantity is 1. Accept integers 1–99 and calculate Selected total as price times quantity.',
      `render(<App/>);fireEvent.click(screen.getByRole('checkbox',{name:'Apple'}));expect(screen.getByLabelText('Quantity Apple').value).toBe('1');fireEvent.change(screen.getByLabelText('Quantity Apple'),{target:{value:'3'}});expect(screen.getByLabelText('Selected total').textContent).toBe('6');`,
    ),
  ],
  'react-evolving-form': [
    ui(
      'Create default-exported App with a form, controlled "Email" input and "Next" button. Start with an empty email; typing updates the value. Prevent browser navigation on submit.',
      `render(<App/>);const input=screen.getByLabelText('Email');expect(input.value).toBe('');fireEvent.change(input,{target:{value:'a@b.cz'}});expect(input.value).toBe('a@b.cz');fireEvent.click(screen.getByRole('button',{name:'Next',exact:true}));`,
    ),
    ui(
      'After email acceptance show a second step with a controlled "Name" input and "Back" / "Next" buttons. Keep "Email accepted" visible and preserve email when going Back.',
      `render(<App/>);fill('Email','a@b.cz');next();expect(screen.getByLabelText('Name')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Back',exact:true}));expect(screen.getByLabelText('Email').value).toBe('a@b.cz');`,
    ),
    ui(
      'On the summary add an "I agree" checkbox and "Submit" button. Disable Submit until consent is checked; going Back clears consent.',
      `render(<App/>);fill('Email','a@b.cz');next();fill('Name','Ada');next();expect(screen.getByRole('button',{name:'Submit',exact:true}).disabled).toBe(true);fireEvent.click(screen.getByLabelText('I agree'));expect(screen.getByRole('button',{name:'Submit',exact:true}).disabled).toBe(false);`,
    ),
    ui(
      'On the name step add "Account type" select with personal (default) and business values. Show a controlled "Company" input only for business; retain its value when switching types.',
      `render(<App/>);fill('Email','a@b.cz');next();expect(screen.getByLabelText('Account type').value).toBe('personal');fireEvent.change(screen.getByLabelText('Account type'),{target:{value:'business'}});fill('Company','Sharks');fireEvent.change(screen.getByLabelText('Account type'),{target:{value:'personal'}});expect(screen.queryByLabelText('Company')).toBeNull();fireEvent.change(screen.getByLabelText('Account type'),{target:{value:'business'}});expect(screen.getByLabelText('Company').value).toBe('Sharks');`,
    ),
    ui(
      'Add "Save draft" before submission. Save JSON {version:1,email,name,account,company} to localStorage key evolving-form-draft. Do not persist consent.',
      `localStorage.clear();render(<App/>);fill('Email','saved@b.cz');fireEvent.click(screen.getByRole('button',{name:'Save draft',exact:true}));const draft=JSON.parse(localStorage.getItem('evolving-form-draft'));expect(draft.version).toBe(1);expect(draft.email).toBe('saved@b.cz');expect(Object.prototype.hasOwnProperty.call(draft,'consent')).toBe(false);`,
    ),
  ],
};

const REACT_HEADER =
  "import React from 'react';\nimport { render, screen, fireEvent, cleanup } from '@testing-library/react';\nimport App from './App';\nafterEach(cleanup);\n";

function fullstackCheckpoints(slug: string): Record<string, Checkpoint> {
  const app = FULLSTACK_APPS.find((app) => app.slug === slug)!;
  const { amount, endpoint } = app;
  const checkpoints: Record<string, Checkpoint> = {
    '2': {
      ...step(
        `Port normalizeInput to TypeScript: input unknown, return Draft|null, where Draft={name:string;${amount}:number}. Keep all earlier validation. Define Item=Draft & {id:number;version:number}. Keep the earlier exact name and integer rules: preserve case, Unicode representation and interior spaces; use ECMAScript trim and UTF16 lengths, and accept signed zero as zero. Ordinary inherited data fields are allowed, extra getters are ignored, and required-field accessors/proxies are outside this exercise. Raw names have at most 20000 code units. Return a fresh mutable Draft without changing or retaining caller state. Item.id and Item.version must be number fields even though this checkpoint has no update/API behavior yet. Target: O(n) time and O(n) space for normalization, where n is one plus raw name UTF16 length; type declarations themselves have no runtime cost.`,
        // The earlier validation, checked where the stage-1 checks leave gaps:
        // a positive amount, a negative one, and both upper limits exactly.
        calls(
          [`normalizeInput({name:'e\\u0301',${amount}:0})`, {name:'e\u0301',[amount]:0}],
          [`normalizeInput({name:'Plan',${amount}:5})`, { name: 'Plan', [amount]: 5 }],
          [`normalizeInput({name:'A',${amount}:-1})`, null],
          [`normalizeInput({name:'x'.repeat(80),${amount}:1})`, { name: 'x'.repeat(80), [amount]: 1 }],
          [`normalizeInput({name:'A',${amount}:1000})`, { name: 'A', [amount]: 1000 }],
        ),
      ),
      typeTests: [
        {code: `{const item:Item={id:1,name:"A",${amount}:0,version:1};const id:number=item.id;const version:number=item.version;}`},
        {code: `{const item:Item={id:1,name:"A",${amount}:0,version:"bad"};}`, rejects: true},
        {code: `{const item:Item={id:"bad",name:"A",${amount}:0,version:1};}`, rejects: true},
        { code: '{const d:Draft|null=normalizeInput({});}' },
        { code: '{const bad:string=normalizeInput({});}', rejects: true },
      ],
    },
    '5': ui(
      `Keep and export your API functions. Add default App({fetcher}), importing createLocalFetch from './localFetch'. Use the provided fetcher or one stable createLocalFetch(createApi(SEED)) per mount, with SEED=${JSON.stringify(fullstackSeed(app))}. Fetch GET ${endpoint} and render each name in an li and ${amount} in output labelled '${amount} NAME'. Start with successful responses.`,
      `const calls=[];const local=createLocalFetch(createApi(seed));render(<App fetcher={(url,opt)=>{calls.push(url);return local(url,opt)}}/>);await waitFor(()=>expect(screen.getByLabelText('${amount} ${app.first}').textContent).toBe('2'));expect(calls[0]).toBe(endpoint);`,
    ),
    '6': ui(
      `Add a form with controlled 'Name' and '${amount}' inputs and a 'Create' button. Wire input changes and prevent navigation on submit; sending POST is the next step.`,
      `render(<App/>);await settle();fireEvent.change(screen.getByLabelText('Name'),{target:{value:'New'}});fireEvent.change(screen.getByLabelText('${amount}',{exact:true}),{target:{value:'3'}});expect(screen.getByLabelText('Name').value).toBe('New');expect(screen.getByLabelText('${amount}',{exact:true}).value).toBe('3');fireEvent.click(screen.getByRole('button',{name:'Create',exact:true}));`,
    ),
    '8': ui(
      `Add client-side 'Search' and 'Available only' filters. Search uses trimmed case-insensitive name substrings; available means ${amount}>0. Combine filters without changing API records.`,
      `const api=createApi(seed);render(<App fetcher={createLocalFetch(api)}/>);await settle();fireEvent.change(screen.getByLabelText('Search'),{target:{value:' ${app.first.toUpperCase()} '}});expect(screen.getAllByRole('listitem').length).toBe(1);expect(screen.getByRole('listitem').textContent).toContain('${app.first}');expect(api({method:'GET',path:endpoint}).body.length).toBe(3);`,
    ),
  };
  if(slug==='workshops'){
    const port=checkpoints['2'];
    port.prompt=port.prompt+" Draft.name must remain a primitive string type. Preserve the exact normalized name and trim every ECMAScript whitespace character, including tabs and nonbreaking spaces, rather than only ASCII spaces. Keep unknown input narrowing and numeric Item identity/version fields; this checkpoint still requires no update/API. The earlier O(n) normalization target and raw-name input size remain unchanged.";
    port.tests=[...(port.tests??[]), {call:"normalizeInput({name:'\\tWorkshop\\u00a0',seats:1})",expected:{"name": "Workshop", "seats": 1}}];
    port.typeTests=[...(port.typeTests??[]),{"code": "{const fn:(value:unknown)=>Draft|null=normalizeInput;const draft=fn({} as unknown);if(draft){const name:string=draft.name;}}"},{"code": "{const bad:number=({} as Draft).name;}", "rejects": true},{"code": "{const bad:Draft={name:1,seats:0};}", "rejects": true}];
  }
  return checkpoints;
}

/** "Title · 3". */
const stageTitle = (title: string, n: number): string => `${title} · ${n}`;

/** Insert smaller prerequisites without changing existing milestone IDs.
 * Test deltas accumulate in stage order, so every subsequent run checks earlier work. */
export function expandEvolvingTasks(tasks: CodingTask[]): CodingTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const out = tasks.filter(
    (task) =>
      !EVOLVING_CHALLENGES.some((project) => project.stages.includes(task.id)),
  );
  for (const project of EVOLVING_CHALLENGES) {
    const milestones = project.stages.filter((id) => !id.endsWith('-start'));
    // A short path has no checkpoints: every level is a milestone of its own.
    const checkpointed = milestones.length < project.stages.length;
    const fullstack =
      project.category === 'fullstack' && checkpointed
        ? fullstackCheckpoints(project.id.slice(10))
        : null;
    let previousBase: CodingTask | undefined;
    let previous: CodingTask | undefined;
    const prompts: string[] = [];
    for (const [index, id] of milestones.entries()) {
      const base = byId.get(id)!;
      const checkpoint = !checkpointed
        ? undefined
        : fullstack
          ? fullstack[String(index + 1)]
          : (CHECKPOINTS[project.id] ?? DEBUG_CHECKPOINTS[project.id])[index];
      if (checkpoint) {
        const firstReact = base.suite && !previous?.suite;
        const header = firstReact
          ? fullstack
            ? fullstackSpec(
                FULLSTACK_APPS.find(
                  (app) => project.id === `fullstack-${app.slug}`,
                )!,
              ).prelude
            : REACT_HEADER
          : previous?.suite;
        const task: CodingTask = {
          ...base,
          id: `${id}-start`,
          prompt: checkpoint.prompt,
          ...checkpointLadder(`${id}-start`),
          ...(checkpoint.focus ? { focus: checkpoint.focus } : {}),
          ...(checkpoint.references ? { references: checkpoint.references } : {}),
          previousRequirements: [...prompts],
          estimatedMinutes: 5,
          title: stageTitle(project.title, prompts.length + 1),
          ...(base.tests
            ? {
                tests: [
                  ...(previous?.tests ?? []),
                  ...(checkpoint.tests ?? []),
                ],
              }
            : {}),
          ...(base.track === 'typescript'
            ? {
                typeTests: [
                  ...(checkpoint.typeTests ??
                    (index === 0 ? base.typeTests : previous?.typeTests) ?? []),
                  ...(checkpoint.additionalTypeTests ?? []),
                ],
              }
            : {}),
          ...(base.suite
            ? { suite: (header ?? REACT_HEADER) + (checkpoint.suite ?? '') }
            : {}),
        };
        out.push(task);
        previous = task;
        prompts.push(task.prompt);
      }
      const built: CodingTask = {
        ...base,
        previousRequirements: [...prompts],
        estimatedMinutes: 10,
        title: stageTitle(project.title, prompts.length + 1),
        ...(base.tests
          ? {
              tests: [
                ...(previous?.tests ?? []),
                ...base.tests.slice(previousBase?.tests?.length ?? 0),
              ],
            }
          : {}),
        ...(base.suite
          ? {
              suite:
                (previous?.suite ?? '') +
                base.suite.slice(
                  previousBase?.suite?.length ??
                    (checkpoint
                      ? fullstack
                        ? fullstackSpec(
                            FULLSTACK_APPS.find(
                              (app) => project.id === `fullstack-${app.slug}`,
                            )!,
                          ).prelude.length
                        : REACT_HEADER.length
                      : 0),
                ),
            }
          : {}),
      };
      out.push(built);
      previous = built;
      previousBase = base;
      prompts.push(base.prompt);
    }
    orderStageChecks(out, project.stages, fullstack
      ? fullstackSpec(FULLSTACK_APPS.find((app) => project.id === `fullstack-${app.slug}`)!).prelude
      : FULLSTACK_PATH_PRELUDES[project.id] ?? REACT_HEADER);
  }
  return out;
}

const samePrefix = <T>(prefix: readonly T[] | undefined, list: readonly T[] | undefined): boolean =>
  Boolean(prefix && list && prefix.length <= list.length && prefix.every((item, index) => JSON.stringify(item) === JSON.stringify(list[index])));

/**
 * Put each stage's own checks first.
 *
 * The builders above accumulate: a stage's tests are every earlier stage's
 * tests followed by the new ones, and a React suite is the header followed by
 * every earlier block and then the new blocks. That order is right for
 * proving nothing regressed and wrong for reading: the first rows in Results
 * should show what the brief just asked for, with the inputs it takes and the
 * output it wants. So each stage is rewritten as [its new checks, then the
 * previous stage's checks in the previous stage's order], recursively, which
 * keeps every earlier check and moves the new ones to the top. The suite's
 * header stays first because the tests import through it.
 */
function orderStageChecks(out: CodingTask[], stages: readonly string[], header: string): void {
  let original: CodingTask | undefined;
  let ordered: CodingTask | undefined;
  for (const id of stages) {
    const index = out.findIndex((task) => task.id === id);
    if (index < 0) continue;
    const task = out[index];
    const next: CodingTask = { ...task };
    if (task.tests && samePrefix(original?.tests, task.tests)) {
      const fresh = task.tests.slice(original?.tests?.length ?? 0);
      const earlier = ordered?.tests ?? [];
      const introduced = fresh.filter((check, index) => {
        // Different labels, display calls, edge flags, or expected values stay distinct.
        const same = (other: CallTest) => other.call === check.call && isDeepStrictEqual(other, check);
        if (!earlier.some(same)) return true;
        // An explicit repeat in the same stage may exercise state in the submission.
        return fresh.some((other, at) => at !== index && same(other));
      });
      next.tests = [...introduced, ...earlier];
    }
    if (task.typeTests && samePrefix(original?.typeTests, task.typeTests)) {
      const fresh = task.typeTests.slice(original?.typeTests?.length ?? 0);
      next.typeTests = [...fresh, ...(ordered?.typeTests ?? [])];
    }
    if (task.suite && task.suite.startsWith(header) && original?.suite && task.suite.startsWith(original.suite)) {
      const fresh = task.suite.slice(original.suite.length);
      const earlier = ordered?.suite?.startsWith(header) ? ordered.suite.slice(header.length) : '';
      next.suite = header + fresh + earlier;
    }
    out[index] = next;
    original = task;
    ordered = next;
  }
}
