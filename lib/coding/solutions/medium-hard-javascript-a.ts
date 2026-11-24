// Server-only reference solutions and hidden tests for
// lib/coding/tasks/medium-hard-javascript-a.ts. Never import from client code.
// The hidden tests aim at the shortcut each visible set leaves open: the
// technique the task combines, a value or shape the visible checks never used,
// and the case a plausible wrong answer gets wrong.

import type { CodingSolution } from '../types';

export const MEDIUM_HARD_JAVASCRIPT_A_SOLUTIONS: Record<string, CodingSolution> = {
  /* ── Medium: text and patterns ────────────────────────────────────── */
  'js-mh-fill-template': {
    solution: `const fill = (template, values) =>
  // replace calls the callback once per blank, and whatever it returns is
  // used as it is, so a "$" in a value is never read as a pattern.
  template.replace(/\\{\\s*(\\w+)\\s*\\}/g, (blank, name) =>
    // Only the object's own properties count: {toString} is not a value.
    Object.hasOwn(values, name) ? String(values[name]) : blank);`,
    junior: `const fill = (template, values) => {
  const pattern = /\\{\\s*(\\w+)\\s*\\}/g;
  const replaceBlank = (blank, name) => {
    const hasValue = Object.prototype.hasOwnProperty.call(values, name);
    if (hasValue) {
      return String(values[name]);
    }
    return blank;
  };
  return template.replace(pattern, replaceBlank);
};`,
    senior: "const BLANK = /\\{\\s*(?<name>\\w+)\\s*\\}/g;\n\nconst fill = (template, values) =>\n  template.replace(BLANK, (blank, ...rest) => {\n    const { name } = rest.at(-1);\n    return Object.hasOwn(values, name) ? String(values[name]) : blank;\n  });",
    hiddenTests: [
      { call: "(() => {const values=Object.freeze(Object.assign(Object.create(null),{s:Symbol(\"fin\"),n:null,u:undefined,b:12n,x:\"{s} $&\"}));return [fill(\"{s}|{n}|{u}|{b}|{x}\",values),fill(\"{\\t s \\n}|{\u00e9}|{s-s}|{ missing }\",values),Object.keys(values).length];})()", expected: ["Symbol(fin)|null|undefined|12|{s} $&", "Symbol(fin)|{\u00e9}|{s-s}|{ missing }", 5] },
      { call: "(() => {const values=Object.freeze({x:\"z\".repeat(1000)});const out=fill(\"{x}\".repeat(3000),values);return [out.length,out.slice(0,3),out.slice(-3),fill(\"\",values),fill(\"{ x }\",{})];})()", expected: [3000000, "zzz", "zzz", "", "{ x }"] },

      { call: 'fill("{toString} and {constructor}", {})', expected: '{toString} and {constructor}' },
      { call: 'fill("{x}", { x: "$&" })', expected: '$&' },
      { call: 'fill("{user_1} / {User1}", { user_1: "a", User1: "b" })', expected: 'a / b' },
      { call: 'fill("{ a b } and {}", { a: 1 })', expected: '{ a b } and {}' },
      { call: 'fill("{{name}}", { name: "Ada" })', expected: '{Ada}' },
      { call: 'fill("{price} or {price}", { price: 9.5 })', expected: '9.5 or 9.5' },
    ],
  },
  'js-mh-sort-versions': {
    solution: `const sortVersions = versions => {
  const compare = (a, b) => {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    // Walk the longer version; a part that is not there counts as 0.
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (left[i] ?? 0) - (right[i] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0; // equal: sort is stable, so they keep their order
  };
  return [...versions].sort(compare);
};`,
    junior: `const sortVersions = versions => {
  const copy = [];
  for (const version of versions) {
    copy.push(version);
  }
  copy.sort((a, b) => {
    const aParts = a.split(".").map(Number);
    const bParts = b.split(".").map(Number);
    let longest = aParts.length;
    if (bParts.length > longest) {
      longest = bParts.length;
    }
    for (let i = 0; i < longest; i++) {
      let aPart = 0;
      if (i < aParts.length) {
        aPart = aParts[i];
      }
      let bPart = 0;
      if (i < bParts.length) {
        bPart = bParts[i];
      }
      if (aPart < bPart) {
        return -1;
      }
      if (aPart > bPart) {
        return 1;
      }
    }
    return 0;
  });
  return copy;
};`,
    senior: `const sortVersions = versions =>
  versions
    .map(version => ({ version, parts: version.split(".").map(Number) })) // split each version once, not on every comparison
    .sort((a, b) => {
      const length = Math.max(a.parts.length, b.parts.length);
      for (let i = 0; i < length; i++) {
        const difference = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
        if (difference) return difference;
      }
      return 0;
    })
    .map(({ version }) => version);`,
    hiddenTests: [
      { call: "sortVersions(Object.freeze([\"0001.0000000000\",\"1\",\"0.999999999\",\"1000000000\",\"1.000000001\",\"1.0.0\"]))", expected: ["0.999999999", "0001.0000000000", "1", "1.0.0", "1.000000001", "1000000000"] },
      { call: "(() => {const zero=Array(20).fill(\"0\").join(\".\"),last=Array(19).fill(\"0\").concat(\"1\").join(\".\");const empty=Object.freeze([]),single=Object.freeze([\"1\"]);return [sortVersions([last,zero,\"0\"]),sortVersions(empty)!==empty,sortVersions(single)!==single,sortVersions(empty)!==sortVersions(empty)];})()", expected: [["0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0", "0", "0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.1"], true, true, true] },
      { call: "(() => {const input=Object.freeze(Array.from({length:1000},(_,i)=>(999-i)+\".0\"));const out=sortVersions(input);return [out.length,out[0],out[999],input[0],out!==input];})()", expected: [1000, "0.0", "999.0", "999.0", true] },

      { call: 'sortVersions(["0.1", "0.0.1", "0.1.0", "0.0.10", "0.0.2"])', expected: ['0.0.1', '0.0.2', '0.0.10', '0.1', '0.1.0'] },
      { call: 'sortVersions(["4.2.0", "4.2", "4.1.9"])', expected: ['4.1.9', '4.2.0', '4.2'] },
      { call: 'sortVersions(["1.1.1", "1.1", "1.1.1.1", "1"])', expected: ['1', '1.1', '1.1.1', '1.1.1.1'] },
      { call: 'sortVersions(["2.0.0", "1", "2", "1.0", "2.0"])', expected: ['1', '1.0', '2.0.0', '2', '2.0'] },
      { call: 'sortVersions(["1.100", "1.20", "1.3"])', expected: ['1.3', '1.20', '1.100'] },
      { call: 'sortVersions(["5"])', expected: ['5'] },
    ],
  },
  'js-mh-csv-fields': {
    solution: `const parseCsvLine = line => {
  const fields = [];
  let field = "";
  let inQuotes = false;
  let previous = "";
  for (const char of line) {
    if (char === '"') {
      // A quote straight after the quote that closed the field is an escaped
      // quote: keep one, and flipping the flag takes us back inside.
      if (!inQuotes && previous === '"') field += '"';
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
    previous = char;
  }
  fields.push(field); // the last field has no comma after it
  return fields;
};`,
    junior: "const parseCsvLine = line => {\n  const fields = [];\n  let current = \"\", previous = \"\";\n  let inside = false;\n  for (const char of line) {\n    if (char === '\"') {\n      if (inside === false && previous === '\"') current += '\"';\n      inside = !inside;\n    } else if (char === \",\" && inside === false) {\n      fields.push(current);\n      current = \"\";\n    } else { current += char; }\n    previous = char;\n  }\n  fields.push(current);\n  return fields;\n};",
    senior: "const parseCsvLine = line => {\n  const fields = [];\n  let field = \"\", quoted = false, previous = \"\";\n  for (const character of line) {\n    if (character === '\"') {\n      field += !quoted && previous === '\"' ? '\"' : \"\";\n      quoted = !quoted;\n    } else if (character === \",\" && !quoted) {\n      fields.push(field);\n      field = \"\";\n    } else { field += character; }\n    previous = character;\n  }\n  fields.push(field);\n  return fields;\n};",
    hiddenTests: [
      { call: "parseCsvLine(\"\\\"a\\r\\nb\\\",\\\"\\ud83d\\ude00\\\",\\\"\\\"\\\"\\\",,\\\" \\\"\")", expected: ["a\r\nb", "\ud83d\ude00", "\"", "", " "] },
      { call: "(() => {const a=parseCsvLine(\"x\");return [a!==parseCsvLine(\"x\"),parseCsvLine(\"\")!==parseCsvLine(\"\")];})()", expected: [true, true] },
      { call: "(() => {const a=parseCsvLine(\"x\".repeat(10000)),b=parseCsvLine(\",\".repeat(9999));return [a.length,a[0].length,b.length,b.every(x=>x===\"\")];})()", expected: [1, 10000, 10000, true] },

      { call: 'parseCsvLine(\'"a,b,c"\')', expected: ['a,b,c'] },
      { call: 'parseCsvLine(\'""""\')', expected: ['"'] },
      { call: 'parseCsvLine(\'1,"two ""2""",3,"4,5"\')', expected: ['1', 'two "2"', '3', '4,5'] },
      { call: 'parseCsvLine(",")', expected: ['', ''] },
      { call: 'parseCsvLine(" a , b ")', expected: [' a ', ' b '] },
      { call: 'parseCsvLine(\'x,"first\\nsecond"\')', expected: ['x', 'first\nsecond'] },
    ],
  },
  'js-mh-line-reader': {
    solution: `const createLineReader = onLine => {
  // The unfinished end of the text so far. Only this reader's methods see it.
  let held = "";
  const report = line => onLine(line.endsWith("\\r") ? line.slice(0, -1) : line);
  return {
    push(chunk) {
      const pieces = (held + chunk).split("\\n");
      held = pieces.pop(); // the last piece has no "\\n" after it yet
      for (const line of pieces) report(line);
    },
    end() {
      if (held !== "") report(held);
      held = "";
    },
  };
};`,
    junior: `const createLineReader = onLine => {
  let unfinished = "";
  const sendLine = line => {
    let clean = line;
    if (clean.endsWith("\\r")) {
      clean = clean.slice(0, clean.length - 1);
    }
    onLine(clean);
  };
  const push = chunk => {
    const text = unfinished + chunk;
    const pieces = text.split("\\n");
    for (let i = 0; i < pieces.length - 1; i++) {
      sendLine(pieces[i]);
    }
    unfinished = pieces[pieces.length - 1];
  };
  const end = () => {
    if (unfinished.length > 0) {
      sendLine(unfinished);
    }
    unfinished = "";
  };
  return { push, end };
};`,
    senior: `const createLineReader = onLine => {
  let rest = "";
  const report = line => onLine(line.replace(/\\r$/, ""));
  return {
    push(chunk) {
      const lines = (rest + chunk).split("\\n");
      rest = lines.pop();
      lines.forEach(line => report(line));
    },
    end() {
      if (rest) report(rest);
      rest = "";
    },
  };
};`,
    hiddenTests: [
      { call: "(() => {const seen=[];const r=createLineReader((...args)=>{seen.push(args);return 99;});r.push(\" \\r\\r\\n\\r\");r.end();r.end();r.push(\"later\\r\");r.end();r.push(\"\\n\");return seen;})()", expected: [[" \r"], [""], ["later"], [""]] },
      { call: "(() => {let count=0,first,last;const r=createLineReader(line=>{count++;if(count===1)first=line;last=line;});for(let i=0;i<9999;i++)r.push(i%2?\"x\":\"\ud83d\ude00\".slice(0,1));r.push(\"\\n\");return [count,first.length,last===first,first.charCodeAt(0),first.slice(-1)];})()", expected: [1, 9999, true, 55357, "\ud83d"] },

      { call: '(() => { const lines = []; const reader = createLineReader(line => lines.push(line)); for (const char of "ab\\ncd\\n\\ne") reader.push(char); reader.end(); return lines; })()', expected: ['ab', 'cd', '', 'e'] },
      { call: '(() => { const lines = []; const reader = createLineReader(line => lines.push(line)); reader.push(""); reader.push("q\\n"); reader.push(""); reader.end(); return lines; })()', expected: ['q'] },
      { call: '(() => { const lines = []; const reader = createLineReader(line => lines.push(line)); reader.push("1\\n2\\n3\\n4"); return lines; })()', expected: ['1', '2', '3'] },
      { call: '(() => { let calls = 0; const reader = createLineReader(() => { calls++; }); reader.push("a\\nb\\nc\\n"); reader.push("d\\n"); reader.end(); return calls; })()', expected: 4 },
      { call: '(() => { const lines = []; const reader = createLineReader(line => lines.push(line)); reader.end(); reader.push("late\\n"); return lines; })()', expected: ['late'] },
    ],
  },

  /* ── Medium: closures that keep state ─────────────────────────────── */
  'js-mh-undo-redo': {
    solution: `const createHistory = initial => {
  let present = initial;
  const past = []; // newest last
  const undone = []; // the most recently undone last
  return {
    current: () => present,
    set(value) {
      past.push(present);
      present = value;
      undone.length = 0; // a new change starts a new branch
    },
    undo() {
      // Check the length, not the value: 0, "" and false are values too.
      if (past.length > 0) {
        undone.push(present);
        present = past.pop();
      }
      return present;
    },
    redo() {
      if (undone.length > 0) {
        past.push(present);
        present = undone.pop();
      }
      return present;
    },
  };
};`,
    junior: `const createHistory = initial => {
  let present = initial;
  let past = [];
  let future = [];
  const current = () => {
    return present;
  };
  const set = value => {
    past.push(present);
    present = value;
    future = [];
  };
  const undo = () => {
    if (past.length === 0) {
      return present;
    }
    future.push(present);
    present = past.pop();
    return present;
  };
  const redo = () => {
    if (future.length === 0) {
      return present;
    }
    past.push(present);
    present = future.pop();
    return present;
  };
  return { current, set, undo, redo };
};`,
    senior: `const createHistory = initial => {
  let present = initial;
  const past = [];
  const future = [];
  const move = (from, to) => {
    if (from.length === 0) return present;
    to.push(present);
    present = from.pop();
    return present;
  };
  return {
    current: () => present,
    set(value) {
      past.push(present);
      present = value;
      future.length = 0;
    },
    undo: () => move(past, future),
    redo: () => move(future, past),
  };
};`,
    hiddenTests: [
      { call: "(() => {const a=Object.freeze({}),b=Object.freeze([]),h=createHistory(a);h.set(b);h.set(undefined);const u=h.undo(),v=h.undo(),w=h.redo(),x=h.redo();h.set(NaN);const nan=Number.isNaN(h.current());h.set(-0);const zero=Object.is(h.current(),-0);h.undo();h.set(a);return [u===b,v===a,w===b,x===undefined,nan,zero,h.redo()===a,h!==createHistory(a),a===h.current()];})()", expected: [true, true, true, true, true, true, true, true, true] },
      { call: "(() => {const h=createHistory(0);for(let i=1;i<=3333;i++)h.set(i);let x;for(let i=0;i<3333;i++)x=h.undo();let y;for(let i=0;i<3333;i++)y=h.redo();return [x,y,h.current()];})()", expected: [0, 3333, 3333] },
      { call: "(() => {const h=createHistory(\"a\");h.set(\"b\");h.set(\"b\");return [h.undo(),h.undo()];})()", expected: ["b", "a"] },

      { call: '(() => { const history = createHistory("x"); history.set("y"); history.undo(); history.redo(); history.undo(); return [history.current(), history.redo(), history.redo()]; })()', expected: ['x', 'y', 'y'] },
      { call: '(() => { const history = createHistory(0); history.set(""); history.set(false); return [history.undo(), history.undo(), history.undo(), history.redo()]; })()', expected: ['', 0, 0, ''] },
      { call: '(() => { const history = createHistory(0); for (let i = 1; i <= 5; i++) history.set(i); history.undo(); history.undo(); history.undo(); history.set(9); const seen = []; for (let i = 0; i < 5; i++) seen.push(history.undo()); return seen; })()', expected: [2, 1, 0, 0, 0] },
      { call: '(() => { const first = { n: 1 }; const history = createHistory(first); history.set({ n: 2 }); return history.undo() === first; })()', expected: true },
      { call: '(() => { const history = createHistory(null); history.set(undefined); history.set(1); return [history.undo(), history.undo(), history.redo(), history.redo()]; })()', expected: [undefined, null, undefined, 1] },
    ],
  },
  'js-mh-rate-limit': {
    solution: `const createLimiter = (limit, windowMs) => {
  // Times of accepted requests, oldest first. Only this limiter can reach it.
  const times = [];
  const forgetOld = now => {
    // After a quiet spell several times can leave the window at once.
    while (times.length > 0 && now - times[0] >= windowMs) {
      times.shift();
    }
  };
  return {
    allow(now) {
      forgetOld(now);
      if (times.length >= limit) return false; // a refused request is not recorded
      times.push(now);
      return true;
    },
    remaining(now) {
      forgetOld(now);
      return limit - times.length;
    },
  };
};`,
    junior: `const createLimiter = (limit, windowMs) => {
  const accepted = [];
  const dropExpired = now => {
    let oldestIsExpired = accepted.length > 0 && now - accepted[0] >= windowMs;
    while (oldestIsExpired) {
      accepted.shift();
      oldestIsExpired = accepted.length > 0 && now - accepted[0] >= windowMs;
    }
  };
  const allow = now => {
    dropExpired(now);
    if (accepted.length < limit) {
      accepted.push(now);
      return true;
    }
    return false;
  };
  const remaining = now => {
    dropExpired(now);
    const left = limit - accepted.length;
    return left;
  };
  return { allow, remaining };
};`,
    senior: `const createLimiter = (limit, windowMs) => {
  const accepted = [];
  const remaining = now => {
    while (accepted.length && accepted[0] <= now - windowMs) accepted.shift();
    return limit - accepted.length;
  };
  const allow = now => {
    if (remaining(now) <= 0) return false;
    accepted.push(now);
    return true;
  };
  return { allow, remaining };
};`,
    hiddenTests: [
      { call: "(() => {const a=createLimiter(1000,100),b=createLimiter(0,1);let accepted=0;for(let i=0;i<1000;i++)if(a.allow(0))accepted++;const refused=a.allow(99),before=a.remaining(99),after=a.remaining(100),same=a.remaining(100);return [accepted,refused,before,after,same,b.allow(0),b.remaining(1000000000000),a.allow(100),a.remaining(100)];})()", expected: [1000, false, 0, 1000, 1000, false, 0, true, 999] },
      { call: "(() => {const a=createLimiter(1,1000000000);return [a.allow(999000000000),a.allow(999999999999),a.remaining(1000000000000),a.allow(1000000000000)];})()", expected: [true, false, 1, true] },
      { call: "(() => {const a=createLimiter(1,1);let accepted=0;for(let i=0;i<10000;i++)if(a.allow(i))accepted++;return accepted;})()", expected: 10000 },

      { call: '(() => { const limiter = createLimiter(3, 100); limiter.allow(0); limiter.allow(1); limiter.allow(2); return [limiter.remaining(2), limiter.remaining(500)]; })()', expected: [0, 3] },
      { call: '(() => { const limiter = createLimiter(0, 1000); return [limiter.allow(0), limiter.remaining(0), limiter.allow(5000)]; })()', expected: [false, 0, false] },
      { call: '(() => { const limiter = createLimiter(1, 100); limiter.remaining(0); limiter.remaining(1); return [limiter.allow(2), limiter.allow(3)]; })()', expected: [true, false] },
      { call: '(() => { const limiter = createLimiter(2, 50); return [limiter.allow(7), limiter.allow(7), limiter.allow(7), limiter.allow(57), limiter.allow(57), limiter.allow(57)]; })()', expected: [true, true, false, true, true, false] },
      { call: '(() => { const a = createLimiter(2, 100); const b = createLimiter(1, 100); return [a.allow(0), b.allow(0), a.allow(1), b.allow(1), a.remaining(2), b.remaining(150)]; })()', expected: [true, true, true, false, 0, 1] },
    ],
  },
  'js-mh-curry': {
    solution: `const curry = fn => {
  // gather never changes the arguments it has collected, so every partial
  // function can be called again and each call branches off on its own.
  const gather = (...collected) => (...args) => {
    const all = [...collected, ...args];
    return all.length >= fn.length ? fn(...all) : gather(...all);
  };
  return gather();
};`,
    junior: `const curry = fn => {
  const needed = fn.length;
  const collect = previousArgs => {
    return (...newArgs) => {
      const allArgs = [...previousArgs, ...newArgs];
      if (allArgs.length >= needed) {
        return fn(...allArgs);
      }
      return collect(allArgs);
    };
  };
  return collect([]);
};`,
    senior: `const curry = fn => function curried(...args) {
  return args.length >= fn.length ? fn(...args) : (...more) => curried(...args, ...more);
};`,
    hiddenTests: [
      { call: "(() => {const a=Object.freeze({}),b=Object.freeze([]),out=Object.freeze({});const pair=curry((x,y)=>[x,y]),p=pair(a),one=p(b),two=p(undefined);const r=curry((x,y)=>out)(a)(b);return [one[0]===a,one[1]===b,two[0]===a,two[1]===undefined,r===out];})()", expected: [true, true, true, true, true] },
      { call: "(() => {let calls=0;const f=curry((a,b=2,...rest)=>{calls++;return [a,b,rest.length];});const before=typeof f;const a=f(1),b=f(1,3,4,5);const zero=curry((...args)=>args.length);return [before,a,b,calls,zero(),zero(1,2)];})()", expected: ["function", [1, 2, 0], [1, 3, 2], 2, 0, 2] },
      { call: "(() => {const error=Object.freeze({});let calls=0;const f=curry((a,b)=>{calls++;throw error;}),p=f(-0);let same=0;for(let i=0;i<2;i++){try{p(undefined);}catch(e){if(e===error)same++;}}return [calls,same,typeof p];})()", expected: [2, 2, "function"] },
      { call: "(() => {let calls=0;const fn=(...args)=>{calls++;return [args.length,args[0],args[999]];};Object.defineProperty(fn,\"length\",{value:100});const f=curry(fn),a=Array.from({length:1000},(_,i)=>i);return [f(...a),calls];})()", expected: [[1000, 0, 999], 1] },

      { call: '(() => { const volume = (l, w, h) => l * w * h; const base = curry(volume)(2); const wide = base(3); return [wide(4), wide(5), base(1)(1), base(1, 1)]; })()', expected: [24, 30, 2, 2] },
      { call: '(() => { const pair = (a, b) => [a, b]; const one = curry(pair); const two = curry(pair); one("x"); return [two("y")("z"), one("p")("q")]; })()', expected: [['y', 'z'], ['p', 'q']] },
      { call: 'curry((a, b) => a + b)(1)()(2)', expected: 3 },
      { call: 'curry((a, b, c, d) => [a, b, c, d])(1)(2)(3)(4)', expected: [1, 2, 3, 4] },
      { call: '(() => { let calls = 0; const add = curry((a, b) => { calls++; return a + b; }); const addTen = add(10); addTen(1); addTen(2); return [calls, addTen(0)]; })()', expected: [2, 10] },
    ],
  },

  /* ── Medium: arrays and grids ─────────────────────────────────────── */
  'js-mh-spiral': {
    solution: `const spiral = grid => {
  const values = [];
  let top = 0;
  let bottom = grid.length - 1;
  let left = 0;
  let right = grid.length > 0 ? grid[0].length - 1 : -1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) values.push(grid[top][c]);
    top++;
    for (let r = top; r <= bottom; r++) values.push(grid[r][right]);
    right--;
    // A single row or column may be all that was left: check before going back.
    if (top <= bottom) {
      for (let c = right; c >= left; c--) values.push(grid[bottom][c]);
      bottom--;
    }
    if (left <= right) {
      for (let r = bottom; r >= top; r--) values.push(grid[r][left]);
      left++;
    }
  }
  return values;
};`,
    junior: `const spiral = grid => {
  const result = [];
  if (grid.length === 0) {
    return result;
  }
  let topRow = 0;
  let bottomRow = grid.length - 1;
  let leftCol = 0;
  let rightCol = grid[0].length - 1;
  while (topRow <= bottomRow && leftCol <= rightCol) {
    for (let col = leftCol; col <= rightCol; col++) {
      result.push(grid[topRow][col]);
    }
    topRow = topRow + 1;
    for (let row = topRow; row <= bottomRow; row++) {
      result.push(grid[row][rightCol]);
    }
    rightCol = rightCol - 1;
    if (topRow <= bottomRow) {
      for (let col = rightCol; col >= leftCol; col--) {
        result.push(grid[bottomRow][col]);
      }
      bottomRow = bottomRow - 1;
    }
    if (leftCol <= rightCol) {
      for (let row = bottomRow; row >= topRow; row--) {
        result.push(grid[row][leftCol]);
      }
      leftCol = leftCol + 1;
    }
  }
  return result;
};`,
    senior: "const spiral = grid => {\n  const values = [];\n  let top = 0, bottom = grid.length - 1;\n  let left = 0, right = grid.length ? grid[0].length - 1 : -1;\n  while (top <= bottom && left <= right) {\n    for (let c = left; c <= right; c++) values.push(grid[top][c]);\n    top++;\n    for (let r = top; r <= bottom; r++) values.push(grid[r][right]);\n    right--;\n    if (top <= bottom) {\n      for (let c = right; c >= left; c--) values.push(grid[bottom][c]);\n      bottom--;\n    }\n    if (left <= right) {\n      for (let r = bottom; r >= top; r--) values.push(grid[r][left]);\n      left++;\n    }\n  }\n  return values;\n};",
    hiddenTests: [
      { call: "(() => {const a=Object.freeze({}),b=Object.freeze([]),grid=Object.freeze([Object.freeze([a,undefined,NaN]),Object.freeze([b,-0,false])]),x=spiral(grid);return [x.length,x[0]===a,x[1]===undefined,Number.isNaN(x[2]),x[3]===false,Object.is(x[4],-0),x[5]===b,x!==spiral(grid),grid[0][0]===a,spiral([[],[]]).length,spiral([])!==spiral([])];})()", expected: [6, true, true, true, true, true, true, true, true, 0, true] },
      { call: "(() => {const grid=Object.freeze(Array.from({length:100},(_,r)=>Object.freeze(Array.from({length:100},(_,c)=>r*100+c)))),a=spiral(grid);return [a.length,new Set(a).size,a.slice(0,3),a.slice(98,103),a[a.length-1]];})()", expected: [10000, 10000, [0, 1, 2], [98, 99, 199, 299, 399], 5049] },

      { call: 'spiral([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]])', expected: [1, 2, 3, 4, 8, 12, 16, 15, 14, 13, 9, 5, 6, 7, 11, 10] },
      { call: 'spiral([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]])', expected: [1, 2, 3, 4, 5, 10, 15, 14, 13, 12, 11, 6, 7, 8, 9] },
      { call: 'spiral([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15]])', expected: [1, 2, 3, 6, 9, 12, 15, 14, 13, 10, 7, 4, 5, 8, 11] },
      { call: 'spiral([[7]])', expected: [7] },
      { call: '(() => { const grid = [[1, 2], [3, 4]]; const out = spiral(grid); return [out, grid]; })()', expected: [[1, 2, 4, 3], [[1, 2], [3, 4]]] },
      { call: 'spiral([[1, 2, 3], [4, 5, 6]])', expected: [1, 2, 3, 6, 5, 4] },
    ],
  },
  'js-mh-paint-bucket': {
    solution: `const paintBucket = (grid, row, col, colour) => {
  const copy = grid.map(cells => [...cells]); // new rows, so the caller's grid stays as it was
  const from = copy[row][col];
  // Without this guard, same-colour neighbours can recurse back into each other.
  if (from === colour) return copy;
  const paint = (r, c) => {
    if (r < 0 || r >= copy.length || c < 0 || c >= copy[r].length) return;
    if (copy[r][c] !== from) return;
    copy[r][c] = colour;
    paint(r - 1, c);
    paint(r + 1, c);
    paint(r, c - 1);
    paint(r, c + 1);
  };
  paint(row, col);
  return copy;
};`,
    junior: `const paintBucket = (grid, row, col, colour) => {
  const copy = grid.map(cells => {
    const newRow = [];
    for (const cell of cells) {
      newRow.push(cell);
    }
    return newRow;
  });
  const startColour = copy[row][col];
  if (startColour === colour) {
    return copy;
  }
  const fill = (r, c) => {
    const insideRows = r >= 0 && r < copy.length;
    if (!insideRows) {
      return;
    }
    const insideCols = c >= 0 && c < copy[r].length;
    if (!insideCols) {
      return;
    }
    if (copy[r][c] !== startColour) {
      return;
    }
    copy[r][c] = colour;
    fill(r - 1, c);
    fill(r, c + 1);
    fill(r + 1, c);
    fill(r, c - 1);
  };
  fill(row, col);
  return copy;
};`,
    senior: `const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const paintBucket = (grid, row, col, colour) => {
  const copy = grid.map(cells => [...cells]);
  const from = copy[row][col];
  const paint = (r, c) => {
    if (copy[r]?.[c] !== from) return; // off the grid reads undefined, which is never a colour
    copy[r][c] = colour;
    NEIGHBOURS.forEach(([dr, dc]) => paint(r + dr, c + dc));
  };
  if (from !== colour) paint(row, col);
  return copy;
};`,
    hiddenTests: [
      { call: "paintBucket(Object.freeze([Object.freeze([\"r\",\"r\"]),Object.freeze([\"b\",\"r\"])]),0,0,\"\")", expected: [["", ""], ["b", ""]] },
      { call: "(() => {const row=Object.freeze(Array(10).fill(\"\")),grid=Object.freeze(Array(10).fill(row)),out=paintBucket(grid,9,9,\"__proto__\"),same=paintBucket(grid,0,0,\"\");return [out.length,out.every(r=>r.every(x=>x===\"__proto__\")),out!==grid,out.every((r,i)=>r!==grid[i]),new Set(out).size,new Set(same).size,same[0]!==row,grid[0][0],same[0][0]];})()", expected: [10, true, true, true, 10, 10, true, "", ""] },

      { call: 'paintBucket([["s", "s", "s", "s"], ["s", "t", "t", "s"], ["s", "t", "s", "s"], ["t", "s", "s", "t"]], 0, 0, "o")', expected: [['o', 'o', 'o', 'o'], ['o', 't', 't', 'o'], ['o', 't', 'o', 'o'], ['t', 'o', 'o', 't']] },
      { call: 'paintBucket([["a", "a", "a"], ["b", "b", "a"], ["a", "a", "a"]], 2, 0, "z")', expected: [['z', 'z', 'z'], ['b', 'b', 'z'], ['z', 'z', 'z']] },
      { call: 'paintBucket([["a", "a", "b", "a"]], 0, 3, "c")', expected: [['a', 'a', 'b', 'c']] },
      { call: 'paintBucket([["a"]], 0, 0, "b")', expected: [['b']] },
      { call: '(() => { const grid = [["a"]]; const out = paintBucket(grid, 0, 0, "a"); return [out !== grid, out[0] !== grid[0], out]; })()', expected: [true, true, [['a']]] },
      { call: 'paintBucket([["a", "b"], ["a", "b"]], 1, 0, "z")', expected: [['z', 'b'], ['z', 'b']] },
    ],
  },
  'js-mh-sudoku-check': {
    solution: "const isValidSudoku = board => {\n  if (!Array.isArray(board) || board.length !== 9 || !Array.from({ length: 9 }, (_, i) => i).every(i => Object.hasOwn(board, i) && Array.isArray(board[i]) && board[i].length === 9)) return false;\n  // Array.from calls the function nine times: nine different Sets.\n  const rows = Array.from({ length: 9 }, () => new Set());\n  const columns = Array.from({ length: 9 }, () => new Set());\n  const boxes = Array.from({ length: 9 }, () => new Set());\n  for (let r = 0; r < 9; r++) {\n    for (let c = 0; c < 9; c++) {\n      const digit = board[r][c];\n      if (!Object.hasOwn(board[r], c) || !Number.isInteger(digit) || digit < 0 || digit > 9) return false;\n      if (digit === 0) continue; // empty cells never clash\n      const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);\n      if (rows[r].has(digit) || columns[c].has(digit) || boxes[box].has(digit)) return false;\n      rows[r].add(digit);\n      columns[c].add(digit);\n      boxes[box].add(digit);\n    }\n  }\n  return true;\n};",
    junior: "const isValidSudoku = board => {\n  if (!Array.isArray(board) || board.length !== 9 || !Array.from({ length: 9 }, (_, i) => i).every(i => Object.hasOwn(board, i) && Array.isArray(board[i]) && board[i].length === 9)) return false;\n  const rowSets = Array.from({ length: 9 }, () => new Set());\n  const colSets = Array.from({ length: 9 }, () => new Set());\n  const boxSets = Array.from({ length: 9 }, () => new Set());\n  for (let r = 0; r < 9; r++) {\n    for (let c = 0; c < 9; c++) {\n      const digit = board[r][c];\n      if (!Object.hasOwn(board[r], c) || !Number.isInteger(digit) || digit < 0 || digit > 9) return false;\n      if (digit === 0) continue;\n      const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);\n      if (rowSets[r].has(digit) || colSets[c].has(digit) || boxSets[box].has(digit)) return false;\n      rowSets[r].add(digit);\n      colSets[c].add(digit);\n      boxSets[box].add(digit);\n    }\n  }\n  return true;\n};",
    senior: "const isValidSudoku = board => {\n  if (!Array.isArray(board) || board.length !== 9 || !Array.from({ length: 9 }, (_, i) => i).every(i => Object.hasOwn(board, i) && Array.isArray(board[i]) && board[i].length === 9)) return false;\n  const seen = Array.from({ length: 3 }, () => Array.from({ length: 9 }, () => new Set()));\n  for (let r = 0; r < 9; r++) {\n    for (let c = 0; c < 9; c++) {\n      const digit = board[r][c];\n      if (!Object.hasOwn(board[r], c) || !Number.isInteger(digit) || digit < 0 || digit > 9) return false;\n      if (digit === 0) continue;\n      const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);\n      if (seen[0][r].has(digit) || seen[1][c].has(digit) || seen[2][box].has(digit)) return false;\n      seen[0][r].add(digit);\n      seen[1][c].add(digit);\n      seen[2][box].add(digit);\n    }\n  }\n  return true;\n};",
    hiddenTests: [
      { call: "(() => {const empty=()=>Array.from({length:9},()=>Array(9).fill(0));const values=[-1,10,1.5,NaN,Infinity,-Infinity,\"1\",null,undefined,true];const results=values.map(value=>{const b=empty();b[8][8]=value;return isValidSudoku(b);});const hole=empty();delete hole[8][8];const missing=empty();delete missing[8];return [results,isValidSudoku(null),isValidSudoku(\"123456789\"),isValidSudoku(Array(9).fill(\"000000000\")),isValidSudoku(hole),isValidSudoku(missing)];})()", expected: [[false, false, false, false, false, false, false, false, false, false], false, false, false, false, false] },
      { call: "(() => {const complete=Object.freeze(Array.from({length:9},(_,r)=>Object.freeze(Array.from({length:9},(_,c)=>(r*3+Math.floor(r/3)+c)%9+1))));const partial=Array.from({length:9},()=>Array(9).fill(0));partial[0]=[1,2,3,4,5,6,7,8,0];partial[1][8]=9;const zero=Array.from({length:9},()=>Array(9).fill(-0)),before=JSON.stringify(complete);return [isValidSudoku(complete),isValidSudoku(partial),isValidSudoku(zero),JSON.stringify(complete)===before];})()", expected: [true, true, true, true] },

      { call: 'isValidSudoku(["830070000", "600195000", "098000060", "800060003", "400803001", "700020006", "060000280", "000419005", "000080079"].map(row => [...row].map(Number)))', expected: false },
      { call: 'isValidSudoku(["534678912", "672195348", "198342567", "859761423", "426853791", "713924856", "961537284", "287419635", "345286179"].map(row => [...row].map(Number)))', expected: true },
      { call: 'isValidSudoku(["000000000", "000000000", "000070000", "000000000", "000000000", "000000000", "000070000", "000000000", "000000000"].map(row => [...row].map(Number)))', expected: false },
      { call: 'isValidSudoku(["000000000", "000000000", "000000000", "000000000", "000000000", "000000000", "000000900", "000000000", "000000009"].map(row => [...row].map(Number)))', expected: false },
      { call: 'isValidSudoku([...Array.from({ length: 8 }, () => new Array(9).fill(0)), new Array(8).fill(0)])', expected: false },
      { call: 'isValidSudoku(Array.from({ length: 9 }, (_, r) => new Array(r === 4 ? 10 : 9).fill(0)))', expected: false },
    ],
  },
  'js-mh-thread-from-list': {
    solution: `const buildThread = comments => {
  // First pass: every node exists before any reply looks for its parent,
  // which is what makes the input order stop mattering.
  const nodes = new Map();
  for (const { id, text } of comments) nodes.set(id, { id, text, replies: [] });
  const roots = [];
  for (const { id, parentId } of comments) {
    const node = nodes.get(id);
    // has(), not a truthiness check: an id can be 0.
    if (nodes.has(parentId)) nodes.get(parentId).replies.push(node);
    else roots.push(node); // top level, or a parent that is missing
  }
  return roots;
};`,
    junior: `const buildThread = comments => {
  const nodeById = new Map();
  for (const comment of comments) {
    const node = {
      id: comment.id,
      text: comment.text,
      replies: [],
    };
    nodeById.set(comment.id, node);
  }
  const topLevel = [];
  for (const comment of comments) {
    const node = nodeById.get(comment.id);
    const parentExists = nodeById.has(comment.parentId);
    if (parentExists) {
      const parent = nodeById.get(comment.parentId);
      parent.replies.push(node);
    } else {
      topLevel.push(node);
    }
  }
  return topLevel;
};`,
    senior: "const buildThread = comments => {\n  const nodes = new Map();\n  for (const { id, text } of comments) nodes.set(id, { id, text, replies: [] });\n  const roots = [];\n  for (const { id, parentId } of comments) {\n    (nodes.get(parentId)?.replies ?? roots).push(nodes.get(id));\n  }\n  return roots;\n};",
    hiddenTests: [
      { call: "(()=>{const input=Object.freeze([Object.freeze({id:1,parentId:null,text:'number'}),Object.freeze({id:'1',parentId:null,text:'string'}),Object.freeze({id:2,parentId:1,text:'n'}),Object.freeze({id:'2',parentId:'1',text:'s'}),Object.freeze({id:'null',parentId:null,text:'literal'})]);return buildThread(input).map(node=>[node.id,node.replies.map(child=>child.id)]);})()", expected: [[1, [2]], ["1", ["2"]], ["null", []]], async: false },
      { call: "(()=>{const row=Object.assign(Object.create(null),{id:-0,parentId:null,text:'',extra:123}),child={id:'__proto__',parentId:0,text:'\ud83e\udd88'};Object.freeze(row);Object.freeze(child);const input=Object.freeze([child,row]),a=buildThread(input),b=buildThread(input);return [a!==b,a[0]!==b[0],a[0].replies!==b[0].replies,a[0].replies[0]!==child,Object.is(a[0].id,-0),a[0].text,a[0].replies[0].text,Object.keys(a[0]).sort().join(','),row.extra,input[0]===child];})()", expected: [true, true, true, true, true, "", "\ud83e\udd88", "id,replies,text", 123, true], async: false },
      { call: "(()=>{const input=Object.freeze(Array.from({length:100},(_,i)=>Object.freeze({id:i,parentId:i===0?null:i-1,text:String(i)})).reverse());let nodes=buildThread(input),count=0,valid=true;while(nodes.length){valid=valid&&nodes.length===1&&nodes[0].id===count;count++;nodes=nodes[0].replies;}const empty=buildThread([]);return [count,valid,empty.length,empty!==buildThread([])];})()", expected: [100, true, 0, true], async: false },
      { call: "(()=>{const input=Object.freeze(Array.from({length:1000},(_,i)=>Object.freeze({id:i,parentId:i===0?null:0,text:String(i)})));const [root]=buildThread(input);return [root.id,root.replies.length,root.replies[998].id,new Set(root.replies.map(x=>x.replies)).size,root.replies.every(x=>x.replies.length===0)];})()", expected: [0, 999, 999, 999, true], async: false },

      { call: 'buildThread([{ id: 3, parentId: 2, text: "c" }, { id: 2, parentId: 1, text: "b" }, { id: 1, parentId: null, text: "a" }])', expected: [{ id: 1, text: 'a', replies: [{ id: 2, text: 'b', replies: [{ id: 3, text: 'c', replies: [] }] }] }] },
      { call: 'buildThread([{ id: 0, parentId: null, text: "zero" }, { id: 1, parentId: 0, text: "one" }])', expected: [{ id: 0, text: 'zero', replies: [{ id: 1, text: 'one', replies: [] }] }] },
      { call: '(() => { const comments = [{ id: 1, parentId: null, text: "a" }, { id: 2, parentId: 1, text: "b" }]; buildThread(comments); return comments; })()', expected: [{ id: 1, parentId: null, text: 'a' }, { id: 2, parentId: 1, text: 'b' }] },
      { call: 'buildThread([{ id: "x", parentId: null, text: "1" }, { id: "y", parentId: "x", text: "2" }, { id: "z", parentId: "gone", text: "3" }, { id: "w", parentId: "y", text: "4" }, { id: "v", parentId: "x", text: "5" }])', expected: [{ id: 'x', text: '1', replies: [{ id: 'y', text: '2', replies: [{ id: 'w', text: '4', replies: [] }] }, { id: 'v', text: '5', replies: [] }] }, { id: 'z', text: '3', replies: [] }] },
      { call: '(() => { const [root] = buildThread([{ id: 1, parentId: null, text: "a" }, { id: 2, parentId: 1, text: "b" }]); return root.replies[0].replies; })()', expected: [] },
    ],
  },

  /* ── Medium: sums, deep values and async batches ──────────────────── */
  'js-mh-who-owes-what': {
    solution: "const balances = expenses =>\n  expenses.reduce((totals, { paidBy, amount, split }) => {\n    totals[paidBy] = (totals[paidBy] ?? 0) + amount;\n    const share = Math.floor(amount / split.length);\n    const leftOver = amount % split.length;\n    split.forEach((name, index) => {\n      // The first leftOver people pay one cent more, so the shares add up to amount.\n      totals[name] = (totals[name] ?? 0) - share - (index < leftOver ? 1 : 0);\n    });\n    return totals;\n  }, Object.create(null));",
    junior: "const balances = expenses => expenses.reduce((totals, { paidBy, amount, split }) => {\n  totals[paidBy] = (totals[paidBy] ?? 0) + amount;\n  const share = Math.floor(amount / split.length);\n  let remainder = amount % split.length;\n  for (const name of split) {\n    let owes = share;\n    if (remainder > 0) { owes++; remainder--; }\n    totals[name] = (totals[name] ?? 0) - owes;\n  }\n  return totals;\n}, Object.create(null));",
    senior: "const addTo = (totals, name, cents) => {\n  totals[name] = (totals[name] ?? 0) + cents;\n  return totals;\n};\n\nconst balances = expenses =>\n  expenses.reduce((totals, { paidBy, amount, split }) => {\n    const share = Math.floor(amount / split.length);\n    const extra = amount % split.length;\n    addTo(totals, paidBy, amount);\n    split.forEach((name, i) => addTo(totals, name, -(share + (i < extra ? 1 : 0))));\n    return totals;\n  }, Object.create(null));",
    hiddenTests: [
      { call: "(() => {const split=Object.freeze([\"__proto__\",\"constructor\",\"toString\"]),e=Object.freeze([Object.freeze({paidBy:\"__proto__\",amount:10,split})]),a=balances(e),b=balances(e);return [Object.keys(a).length,Object.hasOwn(a,\"__proto__\"),a[\"__proto__\"],a.constructor,a.toString,Object.values(a).reduce((s,v)=>s+v,0),a!==b,e[0].amount,split[0]];})()", expected: [3, true, 6, -3, -3, 0, true, 10, "__proto__"] },
      { call: "(() => {const x=balances([{paidBy:\"0\",amount:0,split:[\" \",\"A\",\"a\"]}]);return [Object.keys(x).length,x[\"0\"],x[\" \"],x.A,x.a,balances([])!==balances([])];})()", expected: [4, 0, 0, 0, 0, true] },
      { call: "(() => {const split=Object.freeze(Array.from({length:100},(_,i)=>\"p\"+i)),expenses=Object.freeze(Array.from({length:1000},()=>Object.freeze({paidBy:\"outside\",amount:1000000000,split}))),x=balances(expenses);return [Object.keys(x).length,x.outside,x.p0,x.p99,Object.values(x).reduce((a,b)=>a+b,0)];})()", expected: [101, 1000000000000, -10000000000, -10000000000, 0] },

      { call: 'balances([{ paidBy: "A", amount: 10, split: ["A", "B", "C", "D"] }])', expected: { A: 7, B: -3, C: -2, D: -2 } },
      { call: 'balances([{ paidBy: "x", amount: 997, split: ["x", "y", "z"] }, { paidBy: "y", amount: 101, split: ["z", "x"] }, { paidBy: "z", amount: 50, split: ["y"] }])', expected: { x: 614, y: -281, z: -333 } },
      { call: 'balances([{ paidBy: "Solo", amount: 999, split: ["Solo"] }])', expected: { Solo: 0 } },
      { call: '(() => { const result = balances([{ paidBy: "p", amount: 1001, split: ["q", "r", "s"] }, { paidBy: "q", amount: 7, split: ["p", "s"] }]); return Object.values(result).reduce((sum, n) => sum + n, 0); })()', expected: 0 },
    ],
  },
  'js-mh-deep-equal': {
    solution: "const deepEqual = (a, b) => {\n  if (Object.is(a, b)) return true; // primitives, NaN, and the same object twice\n  // From here on both must be objects, and typeof null is \"object\" too.\n  if (typeof a !== \"object\" || typeof b !== \"object\" || a === null || b === null) return false;\n  if (Array.isArray(a) !== Array.isArray(b)) return false;\n  if (Array.isArray(a)) {\n    return a.length === b.length && Array.from({ length: a.length }, (_, i) => i).every(i => deepEqual(Object.hasOwn(a, i) ? a[i] : undefined, Object.hasOwn(b, i) ? b[i] : undefined));\n  }\n  const keys = Object.keys(a);\n  // Counting keys alone would let { a: undefined } equal { b: undefined }.\n  return keys.length === Object.keys(b).length &&\n    keys.every(key => Object.prototype.propertyIsEnumerable.call(b, key) && deepEqual(a[key], b[key]));\n};",
    junior: "const deepEqual = (a, b) => {\n  if (Object.is(a, b)) return true;\n  if (a === null || b === null || typeof a !== \"object\" || typeof b !== \"object\") return false;\n  const arrays = Array.isArray(a);\n  if (arrays !== Array.isArray(b)) return false;\n  if (arrays) {\n    if (a.length !== b.length) return false;\n    const indices = Array.from({ length: a.length }, (_, index) => index);\n    return indices.every(index => {\n      const left = Object.hasOwn(a, index) ? a[index] : undefined;\n      const right = Object.hasOwn(b, index) ? b[index] : undefined;\n      return deepEqual(left, right);\n    });\n  }\n  const keys = Object.keys(a);\n  if (keys.length !== Object.keys(b).length) return false;\n  return keys.every(key => Object.prototype.propertyIsEnumerable.call(b, key) && deepEqual(a[key], b[key]));\n};",
    senior: "const deepEqual = (a, b) => {\n  if (Object.is(a, b)) return true;\n  if (!a || !b || typeof a !== \"object\" || typeof b !== \"object\" || Array.isArray(a) !== Array.isArray(b)) return false;\n  if (Array.isArray(a)) {\n    return a.length === b.length && Array.from({ length: a.length }, (_, i) => i).every(i =>\n      deepEqual(Object.hasOwn(a, i) ? a[i] : undefined, Object.hasOwn(b, i) ? b[i] : undefined));\n  }\n  const keys = Object.keys(a);\n  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.propertyIsEnumerable.call(b, key) && deepEqual(a[key], b[key]));\n};",
    hiddenTests: [
      {
        label: 'only enumerable own properties contribute keys in either direction',
        call: `(() => {
          const left = Object.freeze({ theme: 'dark' });
          const right = Object.create(null);
          Object.defineProperty(right, 'theme', { value: 'dark' });
          right.other = 'dark';
          Object.freeze(right);
          return [deepEqual(left, right), deepEqual(right, left), deepEqual(right, { other: 'dark' })];
        })()`,
        expected: [false, false, true],
      },
      { call: "(() => {const hole=Array(1),value=[1],undef=[undefined],extra=[1];extra.note=9;return [deepEqual(hole,value),deepEqual(value,hole),deepEqual(hole,undef),deepEqual(undef,hole),deepEqual(Array(1),Array(2)),deepEqual(extra,[1]),deepEqual(0,-0),deepEqual(-0,-0),deepEqual(NaN,NaN)];})()", expected: [false, false, true, true, false, true, false, true, true] },
      { call: "(() => {const a=Object.assign(Object.create(null),{x:Object.freeze([NaN,undefined,-0])}),b={x:Object.freeze([NaN,undefined,-0])};Object.defineProperty(a,\"hidden\",{value:1});a[Symbol(\"skip\")]=99;Object.freeze(a);Object.freeze(b);const left=Object.freeze(Array.from({length:10000},(_,i)=>i)),right=Object.freeze(Array.from({length:10000},(_,i)=>i));let x=1,y=1;for(let i=0;i<100;i++){x=Object.freeze([x]);y=Object.freeze([y]);}return [deepEqual(a,b),deepEqual(b,a),deepEqual(left,right),deepEqual(x,y),Object.hasOwn(b,\"hidden\")];})()", expected: [true, true, true, true, false] },

      { call: 'deepEqual({ a: undefined }, { b: undefined })', expected: false },
      { call: 'deepEqual({ x: [{ y: [NaN] }] }, { x: [{ y: [NaN] }] })', expected: true },
      { call: 'deepEqual([1, 2, 3], [1, 2])', expected: false },
      { call: 'deepEqual({}, [])', expected: false },
      { call: 'deepEqual({ a: null }, { a: {} })', expected: false },
      { call: 'deepEqual([[], {}], [[], {}])', expected: true },
      { call: 'deepEqual("1", 1)', expected: false },
    ],
  },
  'js-mh-in-batches': {
    solution: "async function inBatches(items, size, worker) {\n  const input = items.slice();\n  const results = [];\n  for (let start = 0; start < input.length; start += size) {\n    const batch = input.slice(start, start + size);\n    const done = await Promise.all(batch.map(item => worker(item)));\n    results.push(...done);\n  }\n  return results;\n}",
    junior: "const inBatches = async (items, size, worker) => {\n  const input = items.slice();\n  const results = [];\n  let start = 0;\n  while (start < input.length) {\n    const batch = input.slice(start, start + size);\n    const pending = [];\n    for (const item of batch) pending.push(worker(item));\n    const values = await Promise.all(pending);\n    for (const value of values) results.push(value);\n    start += size;\n  }\n  return results;\n};",
    senior: "const inBatches = async (items, size, worker) => {\n  const input = items.slice();\n  const batches = Array.from({ length: Math.ceil(input.length / size) }, (_, i) => input.slice(i * size, (i + 1) * size));\n  const results = [];\n  for (const batch of batches) results.push(...await Promise.all(batch.map(item => worker(item))));\n  return results;\n};",
    hiddenTests: [
      { call: "(async()=>{let release;const gate=new Promise(done=>{release=done;});const items=[1,2,3],seen=[];const result=inBatches(items,2,item=>{seen.push(item);return item===1?gate.then(()=>1):Promise.resolve(item);});items[2]=99;items.push(4);release();return [await result,seen];})()", expected: [[1, 2, 3], [1, 2, 3]], async: true },
      { call: "(async()=>{const reason=Symbol('bad'),started=[];const result=inBatches([1,2,3,4],2,item=>{started.push(item);return item===1?new Promise(()=>{}):Promise.reject(reason);});const rejected=await Promise.race([result.then(()=>false,error=>error===reason),new Promise(done=>setTimeout(()=>done(false),100))]);return [rejected,started];})()", expected: [true, [1, 2]], async: true },
      { call: "(async()=>{const obj=Object.freeze({}),fn=()=>1,sym=Symbol('x'),items=Object.freeze([obj,fn,sym,NaN,-0,undefined]);let arity=true;const output=await inBatches(items,2,function(item){arity=arity&&arguments.length===1;return Promise.resolve(item);});return [arity,output!==items,output.length,...output.map((value,index)=>Object.is(value,items[index]))];})()", expected: [true, true, 6, true, true, true, true, true, true], async: true },
      { call: "(async()=>{let active=0,maximum=0,calls=0;const output=await inBatches(Object.freeze(Array.from({length:1000},(_,i)=>i)),1000,item=>{active++;calls++;maximum=Math.max(maximum,active);return Promise.resolve().then(()=>{active--;return item;});});return [output.length,output[0],output[999],calls,maximum,active];})()", expected: [1000, 0, 999, 1000, 1000, 0], async: true },

      { call: 'inBatches([5, 4, 3, 2, 1, 0, 9], 3, n => new Promise(done => setTimeout(() => done(n), n)))', expected: [5, 4, 3, 2, 1, 0, 9], async: true },
      { call: '(async () => { const log = []; await inBatches([1, 2, 3, 4], 2, async n => { log.push("start " + n); await new Promise(done => setTimeout(done, n === 1 ? 40 : 5)); log.push("end " + n); }); return log; })()', expected: ['start 1', 'start 2', 'end 2', 'end 1', 'start 3', 'start 4', 'end 3', 'end 4'], async: true },
      { call: '(async () => { const started = []; try { await inBatches(["a", "b", "c", "d", "e"], 2, async s => { started.push(s); await new Promise(done => setTimeout(done, 1)); if (s === "d") throw new Error("no " + s); return s; }); return "resolved"; } catch (error) { return [error.message, started]; } })()', expected: ['no d', ['a', 'b', 'c', 'd']], async: true },
      { call: 'inBatches([1, 2, 3, 4, 5], 2, async n => n * n)', expected: [1, 4, 9, 16, 25], async: true },
      { call: 'inBatches([], 2, async n => n) instanceof Promise', expected: true },
    ],
  },
  'js-mh-latest-only': {
    solution: `const latestOnly = search => {
  let started = 0; // how many calls this wrapper has started
  return async (...args) => {
    const mine = ++started;
    try {
      const value = await search(...args);
      return mine === started ? { stale: false, value } : { stale: true };
    } catch (error) {
      if (mine !== started) return { stale: true }; // an old failure is as stale as an old answer
      throw error;
    }
  };
};`,
    junior: `const latestOnly = search => {
  let callCount = 0;
  const run = async (...args) => {
    callCount = callCount + 1;
    const myNumber = callCount;
    let value;
    try {
      value = await search(...args);
    } catch (error) {
      const isNewest = myNumber === callCount;
      if (isNewest) {
        throw error;
      }
      return { stale: true };
    }
    const isNewest = myNumber === callCount;
    if (isNewest) {
      return { stale: false, value: value };
    }
    return { stale: true };
  };
  return run;
};`,
    senior: "function latestOnly(search) {\n  let started = 0;\n  return async (...args) => {\n    const mine = ++started;\n    try {\n      const value = await search(...args);\n      return mine === started ? { stale: false, value } : { stale: true };\n    } catch (reason) {\n      if (mine !== started) return { stale: true };\n      throw reason;\n    }\n  };\n}",
    hiddenTests: [
      { call: "(async()=>{const run=latestOnly(value=>Promise.resolve(value)),a=run('first'),b=run('second');return [await a,await b];})()", expected: [{"stale": true}, {"stale": false, "value": "second"}], async: true },
      { call: "(async()=>{const reason=Object.freeze({}),run=latestOnly(()=>{throw reason;});let output;try{output=run();}catch{return false;}return [output instanceof Promise,await output.then(()=>false,error=>error===reason)];})()", expected: [true, true], async: true },
      { call: "(async()=>{const reason=Symbol('old');let run,inner;run=latestOnly(value=>{if(value==='old'){inner=run('new');throw reason;}return Promise.resolve(value);});const outer=run('old');return [await outer,await inner];})()", expected: [{"stale": true}, {"stale": false, "value": "new"}], async: true },
      { call: "(async()=>{const obj=Object.freeze({}),fn=()=>1,sym=Symbol('x'),args=[obj,fn,sym,undefined,NaN,-0];let exact=false;const run=latestOnly(function(...got){exact=got.length===args.length&&got.every((value,index)=>Object.is(value,args[index]));return Promise.resolve(obj);});const output=await run(...args);const reason=Symbol('failure'),bad=latestOnly(()=>Promise.reject(reason));return [exact,output.value===obj,Object.keys(output).sort().join(','),await bad().then(()=>false,error=>error===reason)];})()", expected: [true, true, "stale,value", true], async: true },
      { call: "(async()=>{const run=latestOnly(value=>Promise.resolve(value)),pending=Array.from({length:1000},(_,i)=>run(i));const results=await Promise.all(pending);return [results.slice(0,-1).every(result=>Object.keys(result).join(',')==='stale'&&result.stale===true),results[999].value,results[999].stale];})()", expected: [true, 999, false], async: true },

      { call: '(async () => { const calls = []; const run = latestOnly(async (...args) => { calls.push(args); return args.length; }); const pending = run(1, 2, 3); const seenBeforeAwait = calls.length; return [seenBeforeAwait, await pending, calls]; })()', expected: [1, { stale: false, value: 3 }, [[1, 2, 3]]], async: true },
      { call: '(async () => { const wait = (value, ms) => new Promise(done => setTimeout(() => done(value), ms)); const run = latestOnly(wait); return Promise.all([run("a", 30), run("b", 5), run("c", 20)]); })()', expected: [{ stale: true }, { stale: true }, { stale: false, value: 'c' }], async: true },
      { call: '(async () => { const wait = (value, ms) => new Promise(done => setTimeout(() => done(value), ms)); const run = latestOnly(wait); const first = run(1, 20); await run(2, 5); const third = await run(3, 5); return [await first, third]; })()', expected: [{ stale: true }, { stale: false, value: 3 }], async: true },
      { call: '(async () => { const run = latestOnly(async () => ""); return run(); })()', expected: { stale: false, value: '' }, async: true },
      { call: '(async () => { const run = latestOnly(query => (query === "boom" ? Promise.reject(new Error("broken")) : Promise.resolve(query))); const answer = await run("fine"); const failure = await run("boom").catch(error => error.message); return [answer, failure]; })()', expected: [{ stale: false, value: 'fine' }, 'broken'], async: true },
    ],
  },

  /* ── Hard: algorithms on lists and grids ──────────────────────────── */
  'js-mh-settle-up': {
    solution: `const settleUp = balances => {
  // Largest amount first; a tie goes by name, A to Z.
  const byAmountThenName = (a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // New objects with positive amounts: the payments change these, never balances.
  const debtors = [];
  const creditors = [];
  for (const [name, balance] of Object.entries(balances)) {
    if (balance < 0) debtors.push({ name, amount: -balance });
    else if (balance > 0) creditors.push({ name, amount: balance });
  }
  debtors.sort(byAmountThenName);
  creditors.sort(byAmountThenName);
  const payments = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    const amount = Math.min(debtor.amount, creditor.amount);
    payments.push({ from: debtor.name, to: creditor.name, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    // Whoever still has an amount left stays current: the lists are not re-sorted.
    if (debtor.amount === 0) d++;
    if (creditor.amount === 0) c++;
  }
  return payments;
};`,
    junior: `const settleUp = balances => {
  const owes = [];
  const owed = [];
  const names = Object.keys(balances);
  for (const name of names) {
    const balance = balances[name];
    if (balance < 0) {
      owes.push({ name: name, amount: -balance });
    }
    if (balance > 0) {
      owed.push({ name: name, amount: balance });
    }
  }
  const compare = (a, b) => {
    if (a.amount !== b.amount) {
      return b.amount - a.amount;
    }
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  };
  owes.sort(compare);
  owed.sort(compare);
  const payments = [];
  let d = 0, c = 0;
  while (d < owes.length && c < owed.length) {
    const debtor = owes[d];
    const creditor = owed[c];
    let amount = debtor.amount;
    if (creditor.amount < amount) {
      amount = creditor.amount;
    }
    payments.push({ from: debtor.name, to: creditor.name, amount: amount });
    debtor.amount = debtor.amount - amount;
    creditor.amount = creditor.amount - amount;
    if (debtor.amount === 0) {
      d++;
    }
    if (creditor.amount === 0) {
      c++;
    }
  }
  return payments;
};`,
    senior: `const byAmountThenName = (a, b) => b.amount - a.amount || (a.name < b.name ? -1 : Number(a.name > b.name));

const side = (balances, sign) =>
  Object.entries(balances)
    .filter(([, balance]) => Math.sign(balance) === sign)
    .map(([name, balance]) => ({ name, amount: Math.abs(balance) }))
    .sort(byAmountThenName);

const settleUp = balances => {
  const debtors = side(balances, -1);
  const creditors = side(balances, 1);
  const payments = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);
    payments.push({ from: debtors[d].name, to: creditors[c].name, amount });
    debtors[d].amount -= amount;
    creditors[c].amount -= amount;
    if (debtors[d].amount === 0) d++;
    if (creditors[c].amount === 0) c++;
  }
  return payments;
};`,
    hiddenTests: [{"call": "(() => {const names=['A','b','\u00e9','\ud83d\ude00',''],values=[-2,-1,0,1,2];for(let code=0;code<5**5;code++){let digits=code;const entries=names.map(name=>{const value=values[digits%5];digits=Math.floor(digits/5);return[name,value];});if(entries.reduce((sum,[,v])=>sum+v,0)!==0)continue;const side=sign=>entries.filter(([,v])=>Math.sign(v)===sign).map(([name,v])=>({name,value:Math.abs(v)})).sort((a,b)=>b.value-a.value||(a.name<b.name?-1:a.name>b.name?1:0)),debt=side(-1),credit=side(1),expected=[];let dStart=0;for(const d of debt){let cStart=0;for(const c of credit){const left=Math.max(dStart,cStart),right=Math.min(dStart+d.value,cStart+c.value);if(right>left)expected.push({from:d.name,to:c.name,amount:right-left});cStart+=c.value;}dStart+=d.value;}const input=Object.freeze(Object.fromEntries(entries));if(JSON.stringify(settleUp(input))!==JSON.stringify(expected))return false;}return true;})()", "expected": true}, {"call": "(() => {const input=Object.assign(Object.create(null),{['__proto__']:4294967296,constructor:-4294967296,A:-0});Object.defineProperty(input,'ignored',{value:99});input[Symbol('ignored')]=1;Object.freeze(input);const a=settleUp(input),b=settleUp(input);if(a===b||a[0]===b[0]||a.length!==1||a[0].from!=='constructor'||a[0].to!=='__proto__'||a[0].amount!==4294967296)return false;a[0].amount=1;a.push({});return a[0].amount===1&&a.length===2&&b[0].amount===4294967296&&Object.is(input.A,-0)&&input.constructor===-4294967296&&settleUp({})!==settleUp({});})()", "expected": true}, {"call": "(() => {const entries=Array.from({length:2000},(_,i)=>['p'+String(i).padStart(4,'0'),i<1000?-1000000000000:1000000000000]),out=settleUp(Object.freeze(Object.fromEntries(entries)));return out.length===1000&&out.every((p,i)=>p.from==='p'+String(i).padStart(4,'0')&&p.to==='p'+String(i+1000).padStart(4,'0')&&p.amount===1000000000000);})()", "expected": true}, {"call": "settleUp({ A: 600, B: 500, C: -700, D: -400 })", "expected": [{"from": "C", "to": "A", "amount": 600}, {"from": "C", "to": "B", "amount": 100}, {"from": "D", "to": "B", "amount": 400}]}, {"call": "settleUp({ p: 700, q: -250, r: -250, s: -100, t: -100 })", "expected": [{"from": "q", "to": "p", "amount": 250}, {"from": "r", "to": "p", "amount": 250}, {"from": "s", "to": "p", "amount": 100}, {"from": "t", "to": "p", "amount": 100}]}, {"call": "settleUp({ A: 300, B: 300, C: -500, D: -100 })", "expected": [{"from": "C", "to": "A", "amount": 300}, {"from": "C", "to": "B", "amount": 200}, {"from": "D", "to": "B", "amount": 100}]}, {"call": "settleUp({ a: 1234, b: -1000, c: 567, d: -801 })", "expected": [{"from": "b", "to": "a", "amount": 1000}, {"from": "d", "to": "a", "amount": 234}, {"from": "d", "to": "c", "amount": 567}]}],
  },
  'js-mh-line-diff': {
    solution: `const diffLines = (before, after) => {
  const rows = before.length;
  const cols = after.length;
  // table[i][j]: the longest common subsequence of before.slice(i) and
  // after.slice(j). The extra row and column of zeros is "one side ran out".
  const table = [];
  for (let i = 0; i <= rows; i++) table.push(new Array(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const edit = [];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && before[i] === after[j]) {
      edit.push([" ", before[i]]);
      i++;
      j++;
    } else if (j === cols || (i < rows && table[i + 1][j] >= table[i][j + 1])) {
      edit.push(["-", before[i]]); // on a tie the removal goes first
      i++;
    } else {
      edit.push(["+", after[j]]);
      j++;
    }
  }
  return edit;
};`,
    junior: `const diffLines = (before, after) => {
  const table = [];
  for (let i = 0; i <= before.length; i++) {
    const row = [];
    for (let j = 0; j <= after.length; j++) {
      row.push(0);
    }
    table.push(row);
  }
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      if (before[i] === after[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        const skipBefore = table[i + 1][j];
        const skipAfter = table[i][j + 1];
        if (skipBefore >= skipAfter) {
          table[i][j] = skipBefore;
        } else {
          table[i][j] = skipAfter;
        }
      }
    }
  }
  const result = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      result.push([" ", before[i]]);
      i = i + 1;
      j = j + 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push(["-", before[i]]);
      i = i + 1;
    } else {
      result.push(["+", after[j]]);
      j = j + 1;
    }
  }
  while (i < before.length) {
    result.push(["-", before[i]]);
    i = i + 1;
  }
  while (j < after.length) {
    result.push(["+", after[j]]);
    j = j + 1;
  }
  return result;
};`,
    senior: `const lcsTable = (a, b) => {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
};

const diffLines = (before, after) => {
  const table = lcsTable(before, after);
  const edit = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      edit.push([" ", before[i]]);
      i++;
      j++;
    } else if (j === after.length || (i < before.length && table[i + 1][j] >= table[i][j + 1])) {
      edit.push(["-", before[i++]]);
    } else {
      edit.push(["+", after[j++]]);
    }
  }
  return edit;
};`,
    hiddenTests: [{"call": "(()=>{function best(a,b){let longest=0;for(let mask=0;mask<(1<<a.length);mask++){let at=0,count=0,valid=true;for(let i=0;i<a.length;i++)if(mask>>i&1){while(at<b.length&&b[at]!==a[i])at++;if(at===b.length){valid=false;break;}at++;count++;}if(valid&&count>longest)longest=count;}return longest;}function oracle(a,b){let i=0,j=0;const out=[];while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){out.push([' ',a[i]]);i++;j++;}else if(j===b.length||(i<a.length&&best(a.slice(i+1),b.slice(j))>=best(a.slice(i),b.slice(j+1))))out.push(['-',a[i++]]);else out.push(['+',b[j++]]);}return out;}function same(a,b){return Array.isArray(a)&&a.length===b.length&&a.every((pair,i)=>Array.isArray(pair)&&pair.length===2&&pair[0]===b[i][0]&&pair[1]===b[i][1]);} const words=[[]];for(let length=1;length<=4;length++)for(let mask=0;mask<(1<<length);mask++)words.push(Array.from({length},(_,i)=>mask>>i&1?'A':'B'));for(const a of words)for(const b of words)if(!same(diffLines(Object.freeze([...a]),Object.freeze([...b])),oracle(a,b)))return false;return true;})()", "expected": true, "edge": true},{"call": "(()=>{function best(a,b){let longest=0;for(let mask=0;mask<(1<<a.length);mask++){let at=0,count=0,valid=true;for(let i=0;i<a.length;i++)if(mask>>i&1){while(at<b.length&&b[at]!==a[i])at++;if(at===b.length){valid=false;break;}at++;count++;}if(valid&&count>longest)longest=count;}return longest;}function oracle(a,b){let i=0,j=0;const out=[];while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){out.push([' ',a[i]]);i++;j++;}else if(j===b.length||(i<a.length&&best(a.slice(i+1),b.slice(j))>=best(a.slice(i),b.slice(j+1))))out.push(['-',a[i++]]);else out.push(['+',b[j++]]);}return out;}function same(a,b){return Array.isArray(a)&&a.length===b.length&&a.every((pair,i)=>Array.isArray(pair)&&pair.length===2&&pair[0]===b[i][0]&&pair[1]===b[i][1]);} const names=['',' ','\\n','A','a','\u00e9','e\\u0301','__proto__'];for(let seed=0;seed<32;seed++){const a=Object.freeze(Array.from({length:4},(_,i)=>names[(seed+i*3)%names.length])),b=Object.freeze(Array.from({length:4},(_,i)=>names[(seed*3+i*5)%names.length])),first=diffLines(a,b),second=diffLines(a,b),expected=oracle(a,b);if(first===second||!same(first,expected)||first.some((pair,i)=>pair===second[i])||new Set(first).size!==first.length)return false;if(first.length){first[0][0]='changed';first[0][1]='changed';}first.push(['+','mutable']);if(!same(second,expected)||!same(diffLines(a,b),expected))return false;}return true;})()", "expected": true, "edge": true},{"call": "(()=>{const before=Object.freeze(Array.from({length:200},(_,i)=>'line'+i%7)),after=Object.freeze(Array.from({length:200},(_,i)=>'line'+(i+1)%7)),out=diffLines(before,after),kept=out.filter(pair=>pair[0]===' ').length,old=out.filter(pair=>pair[0]!=='+').map(pair=>pair[1]),next=out.filter(pair=>pair[0]!=='-').map(pair=>pair[1]);if(kept!==199||old.length!==200||next.length!==200||old.some((v,i)=>v!==before[i])||next.some((v,i)=>v!==after[i]))return false;const long=Object.freeze(Array(200).fill('x'.repeat(128))),same=diffLines(long,long);if(same.length!==200||same.some(pair=>pair[0]!==' '||pair[1]!==long[0]))return false;const removed=diffLines(long,Object.freeze([])),added=diffLines(Object.freeze([]),long);return removed.length===200&&added.length===200&&removed.every(pair=>pair[0]==='-')&&added.every(pair=>pair[0]==='+')&&diffLines([],[])!==diffLines([],[]);})()", "expected": true, "edge": true},
      { call: 'diffLines(["title", "intro", "body", "outro", "sign-off"], ["title", "body", "extra", "outro", "thanks", "sign-off"])', expected: [[' ', 'title'], ['-', 'intro'], [' ', 'body'], ['+', 'extra'], [' ', 'outro'], ['+', 'thanks'], [' ', 'sign-off']] },
      { call: 'diffLines(["a", "b", "a", "b"], ["b", "a", "b", "a"])', expected: [['-', 'a'], [' ', 'b'], [' ', 'a'], [' ', 'b'], ['+', 'a']] },
      { call: 'diffLines(["a", "x", "c"], ["a", "y", "c"])', expected: [[' ', 'a'], ['-', 'x'], ['+', 'y'], [' ', 'c']] },
      { call: '(() => { const before = [..."ABCBDAB"]; const after = [..."BDCABA"]; const edit = diffLines(before, after); return [edit.filter(([mark]) => mark === " ").length, edit.filter(([mark]) => mark !== "+").map(([, line]) => line).join(""), edit.filter(([mark]) => mark !== "-").map(([, line]) => line).join("")]; })()', expected: [4, 'ABCBDAB', 'BDCABA'] },
      { call: '(() => { const before = Array.from({ length: 60 }, (_, i) => "line " + (i % 7)); const after = Array.from({ length: 60 }, (_, i) => "line " + (i % 5)); const edit = diffLines(before, after); return [edit.filter(([mark]) => mark === " ").length, edit.filter(([mark]) => mark !== "+").map(([, line]) => line).join() === before.join(), edit.filter(([mark]) => mark !== "-").map(([, line]) => line).join() === after.join()]; })()', expected: [44, true, true] },
      { call: 'diffLines([], [])', expected: [] },
      { call: '(() => { const before = ["b", "c"]; const after = ["c", "b", "a", "c", "b"]; const edit = diffLines(before, after); return [edit.filter(([mark]) => mark === " ").length, edit.filter(([mark]) => mark !== "+").map(([, line]) => line), edit.filter(([mark]) => mark !== "-").map(([, line]) => line)]; })()', expected: [2, ['b', 'c'], ['c', 'b', 'a', 'c', 'b']] },
    ],
  },
  'js-mh-word-search': {
    solution: `const STEPS = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // up, right, down, left

const findWord = (grid, word) => {
  if (word === "") return [];
  const used = new Set();
  const path = [];
  const follow = (row, col, index) => {
    if (row < 0 || row >= grid.length || col < 0 || col >= grid[row].length) return false;
    const key = row + "," + col;
    if (used.has(key) || grid[row][col] !== word[index]) return false;
    used.add(key);
    path.push([row, col]);
    if (index === word.length - 1) return true;
    // some stops at the first neighbour that finishes the word.
    const found = STEPS.some(([dr, dc]) => follow(row + dr, col + dc, index + 1));
    if (!found) {
      // A dead end from here: free the cell, another path may need it.
      used.delete(key);
      path.pop();
    }
    return found;
  };
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (follow(row, col, 0)) return path;
    }
  }
  return null;
};`,
    junior: `const findWord = (grid, word) => {
  if (word.length === 0) {
    return [];
  }
  const visited = [];
  for (let r = 0; r < grid.length; r++) {
    const row = [];
    for (let c = 0; c < grid[r].length; c++) {
      row.push(false);
    }
    visited.push(row);
  }
  const path = [];
  const search = (r, c, index) => {
    if (r < 0 || r >= grid.length) {
      return false;
    }
    if (c < 0 || c >= grid[r].length) {
      return false;
    }
    if (visited[r][c]) {
      return false;
    }
    if (grid[r][c] !== word[index]) {
      return false;
    }
    visited[r][c] = true;
    path.push([r, c]);
    if (index === word.length - 1) {
      return true;
    }
    if (search(r - 1, c, index + 1)) {
      return true;
    }
    if (search(r, c + 1, index + 1)) {
      return true;
    }
    if (search(r + 1, c, index + 1)) {
      return true;
    }
    if (search(r, c - 1, index + 1)) {
      return true;
    }
    visited[r][c] = false;
    path.pop();
    return false;
  };
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (search(r, c, 0)) {
        return path;
      }
    }
  }
  return null;
};`,
    senior: `const STEPS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

const findWord = (grid, word) => {
  if (word === "") return [];
  const trace = (row, col, path) => {
    if (grid[row]?.[col] !== word[path.length] || path.some(([r, c]) => r === row && c === col)) return null;
    const next = [...path, [row, col]]; // a new path per step, so a dead end needs no undoing
    if (next.length === word.length) return next;
    for (const [dr, dc] of STEPS) {
      const found = trace(row + dr, col + dc, next);
      if (found) return found;
    }
    return null;
  };
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const found = trace(row, col, []);
      if (found) return found;
    }
  }
  return null;
};`,
    hiddenTests: [
      {"call": "(()=>{function oracle(grid,word){if(!word.length)return[];const h=grid.length,w=grid[0]?.length??0;for(let start=0;start<h*w;start++){const pending=[[start]];while(pending.length){const path=pending.pop(),last=path[path.length-1],r=Math.floor(last/w),c=last%w;if(grid[r][c]!==word[path.length-1])continue;if(path.length===word.length)return path.map(n=>[Math.floor(n/w),n%w]);const next=[[r,c-1],[r+1,c],[r,c+1],[r-1,c]];for(const[y,x]of next)if(y>=0&&y<h&&x>=0&&x<w&&!path.includes(y*w+x))pending.push([...path,y*w+x]);}}return null;}function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);} const words=[''];for(let n=1;n<=5;n++)for(let mask=0;mask<(1<<n);mask++)words.push(Array.from({length:n},(_,i)=>mask>>i&1?'A':'B').join(''));for(let mask=0;mask<16;mask++){const grid=Object.freeze([0,1].map(r=>[0,1].map(c=>mask>>(r*2+c)&1?'A':'B').join('')));for(const word of words)if(!equal(findWord(grid,word),oracle(grid,word)))return false;}return true;})()", "expected": true},{"call": "(()=>{function oracle(grid,word){if(!word.length)return[];const h=grid.length,w=grid[0]?.length??0;for(let start=0;start<h*w;start++){const pending=[[start]];while(pending.length){const path=pending.pop(),last=path[path.length-1],r=Math.floor(last/w),c=last%w;if(grid[r][c]!==word[path.length-1])continue;if(path.length===word.length)return path.map(n=>[Math.floor(n/w),n%w]);const next=[[r,c-1],[r+1,c],[r,c+1],[r-1,c]];for(const[y,x]of next)if(y>=0&&y<h&&x>=0&&x<w&&!path.includes(y*w+x))pending.push([...path,y*w+x]);}}return null;}function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);} const models=[[[], ''],[[],'a'],[['',''],'a'],[['e\\u0301'],'\u00e9'],[['\u00e9'],'e\\u0301'],[['\ud83d\ude00'],'\ud83d\ude00'],[[' a'],' a'],[['Aa'],'aa'],[['__','__'],'___'],[['AB','BA'],'ABA'],[['A\\n','BX'],'A\\nX']];for(const[grid,word]of models){Object.freeze(grid);const expected=oracle(grid,word),a=findWord(grid,word),b=findWord(grid,word);if(!equal(a,expected)||!equal(b,expected))return false;if(a!==null){if(a===b||a.some((pair,i)=>pair===b[i])||new Set(a).size!==a.length)return false;for(const pair of a){pair[0]=99;pair[1]=99;}a.push([99,99]);if(!equal(b,expected)||!equal(findWord(grid,word),expected))return false;}}return true;})()", "expected": true},{"call": "(()=>{const grid=Object.freeze(['ABCDEFGH',...Array(7).fill('XXXXXXXX')]),out=findWord(grid,'ABCDEFGH');if(!out||out.length!==8||out.some((pair,i)=>pair[0]!==0||pair[1]!==i)||findWord(grid,'ZZZZZZZZ')!==null)return false;const before=JSON.stringify(grid),empty=findWord(grid,'');empty.push([0,0]);return findWord(grid,'').length===0&&JSON.stringify(grid)===before&&findWord(Object.freeze(['A']),'AA')===null;})()", "expected": true},
      { call: 'findWord(["CAA", "AAA", "BCD"], "AAB")', expected: [[1, 1], [1, 0], [2, 0]] },
      { call: 'findWord(["BX", "AB"], "AB")', expected: [[1, 0], [0, 0]] },
      { call: 'findWord(["XA", "AX"], "A")', expected: [[0, 1]] },
      { call: 'findWord(["AXX", "BXX", "CDE"], "EDCBA")', expected: [[2, 2], [2, 1], [2, 0], [1, 0], [0, 0]] },
      { call: 'findWord(["AAAA"], "AAAA")', expected: [[0, 0], [0, 1], [0, 2], [0, 3]] },
      { call: 'findWord(["AB"], "ABA")', expected: null },
    ],
  },
  'js-mh-arrangements': {
    solution: `const arrangements = letters => {
  const counts = new Map();
  for (const letter of letters) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  const results = [];
  const build = prefix => {
    if (prefix.length === letters.length) {
      results.push(prefix);
      return;
    }
    // Each different letter once per position: that is what stops repeats,
    // before they are made rather than after.
    for (const [letter, count] of counts) {
      if (count === 0) continue;
      counts.set(letter, count - 1);
      build(prefix + letter);
      counts.set(letter, count); // put it back for the next branch
    }
  };
  build("");
  return results.sort();
};`,
    junior: `const arrangements = letters => {
  const sorted = Array.from(letters).sort();
  const used = [];
  for (let i = 0; i < sorted.length; i++) {
    used.push(false);
  }
  const results = [];
  const build = (current, depth) => {
    if (depth === sorted.length) {
      results.push(current);
      return;
    }
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) {
        continue;
      }
      if (i > 0 && sorted[i] === sorted[i - 1] && !used[i - 1]) {
        continue;
      }
      used[i] = true;
      build(current + sorted[i], depth + 1);
      used[i] = false;
    }
  };
  build("", 0);
  results.sort();
  return results;
};`,
    senior: `const arrangements = letters => {
  if (letters.length <= 1) return [letters];
  const orders = [];
  for (const letter of new Set(letters)) {
    const at = letters.indexOf(letter);
    const rest = letters.slice(0, at) + letters.slice(at + letter.length);
    for (const tail of arrangements(rest)) orders.push(letter + tail);
  }
  return orders.sort();
};`,
    hiddenTests: [
      {"call": "(()=>{function oracle(text){let results=[''];for(const point of Array.from(text)){const next=new Set();for(const value of results){const a=Array.from(value);for(let i=0;i<=a.length;i++)next.add([...a.slice(0,i),point,...a.slice(i)].join(''));}results=[...next];}return results.sort();}function same(a,b){return Array.isArray(a)&&a.length===b.length&&a.every((x,i)=>x===b[i]);} for(let n=0;n<=5;n++)for(let a=0;a<=n;a++)for(let b=0;b<=n-a;b++){const text='a'.repeat(a)+'b'.repeat(b)+'c'.repeat(n-a-b),expected=oracle(text);if(!same(arrangements(text),expected)||!same(arrangements([...text].reverse().join('')),expected))return false;}return true;})()", "expected": true},{"call": "(()=>{function oracle(text){let results=[''];for(const point of Array.from(text)){const next=new Set();for(const value of results){const a=Array.from(value);for(let i=0;i<=a.length;i++)next.add([...a.slice(0,i),point,...a.slice(i)].join(''));}results=[...next];}return results.sort();}function same(a,b){return Array.isArray(a)&&a.length===b.length&&a.every((x,i)=>x===b[i]);} for(const text of ['\ud83d\ude00a','\ud83d\ude00\ud83d\ude00a','A a','e\\u0301\u00e9','\u00e9\u00e9a','Z0-','\ud834\udd1ea\ud83d\ude00','\\n a','']){const expected=oracle(text),first=arrangements(text),second=arrangements(text);if(first===second||!same(first,expected)||!same(second,expected))return false;first.pop();first.push('changed');if(!same(second,expected)||!same(arrangements(text),expected))return false;}return true;})()", "expected": true},{"call": "(()=>{const same=arrangements('\ud83d\ude00'.repeat(10));if(same.length!==1||same[0]!=='\ud83d\ude00'.repeat(10))return false;const text='abcdefg',out=arrangements(text);if(out.length!==5040||new Set(out).size!==5040||out[0]!=='abcdefg'||out[out.length-1]!=='gfedcba')return false;for(let i=0;i<out.length;i++){if([...out[i]].sort().join('')!==text||i>0&&out[i-1]>out[i])return false;}const repeated=arrangements('aaaaaaaaab');return repeated.length===10&&repeated.every(v=>v.length===10&&v.split('b').length===2);})()", "expected": true},
      { call: 'arrangements("aaaaaaaaab").length', expected: 10 },
      { call: 'arrangements("aaaaaaaabb").length', expected: 45 },
      { call: 'arrangements("cba")', expected: ['abc', 'acb', 'bac', 'bca', 'cab', 'cba'] },
      { call: 'arrangements("aabc")', expected: ['aabc', 'aacb', 'abac', 'abca', 'acab', 'acba', 'baac', 'baca', 'bcaa', 'caab', 'caba', 'cbaa'] },
      { call: 'arrangements("1a1")', expected: ['11a', '1a1', 'a11'] },
    ],
  },
  'js-mh-justify-text': {
    solution: `const justify = (text, width) => {
  // Leading or trailing whitespace leaves empty strings behind: drop them.
  const words = text.split(/\\s+/).filter(word => word !== "");
  const lines = [];
  const widen = lineWords => {
    if (lineWords.length === 1) return lineWords[0].padEnd(width);
    const gaps = lineWords.length - 1;
    const spaces = width - lineWords.reduce((sum, word) => sum + word.length, 0);
    const chunks = [lineWords[0]];
    for (let i = 1; i < lineWords.length; i++) {
      // Every gap gets the even share; the first (spaces % gaps) get one more.
      chunks.push(" ".repeat(Math.floor(spaces / gaps) + (i <= spaces % gaps ? 1 : 0)), lineWords[i]);
    }
    return chunks.join("");
  };
  let line = [];
  let letters = 0;
  for (const word of words) {
    // The word fits after the gaps already there plus one more space.
    if (line.length > 0 && letters + line.length + word.length > width) {
      lines.push(widen(line));
      line = [];
      letters = 0;
    }
    line.push(word);
    letters += word.length;
  }
  if (line.length > 0) lines.push(line.join(" ").padEnd(width)); // the last line is not widened
  return lines;
};`,
    junior: `const justify = (text, width) => {
  const pieces = text.split(/\\s+/);
  const words = [];
  for (const piece of pieces) {
    if (piece.length > 0) {
      words.push(piece);
    }
  }
  const lines = [];
  let index = 0;
  while (index < words.length) {
    const lineWords = [words[index]];
    let lineLength = words[index].length;
    index = index + 1;
    while (index < words.length && lineLength + 1 + words[index].length <= width) {
      lineWords.push(words[index]);
      lineLength = lineLength + 1 + words[index].length;
      index = index + 1;
    }
    const isLastLine = index === words.length;
    let line = "";
    if (isLastLine || lineWords.length === 1) {
      line = lineWords.join(" ").padEnd(width);
    } else {
      let letterCount = 0;
      for (const word of lineWords) {
        letterCount = letterCount + word.length;
      }
      const gapCount = lineWords.length - 1;
      const spaceCount = width - letterCount;
      const evenShare = Math.floor(spaceCount / gapCount);
      let extra = spaceCount % gapCount;
      const chunks = [lineWords[0]];
      for (let i = 1; i < lineWords.length; i++) {
        let gap = evenShare;
        if (extra > 0) {
          gap = gap + 1;
          extra = extra - 1;
        }
        chunks.push(" ".repeat(gap), lineWords[i]);
      }
      line = chunks.join("");
    }
    lines.push(line);
  }
  return lines;
};`,
    senior: `const justify = (text, width) => {
  const groups = [];
  for (const word of text.split(/\\s+/).filter(Boolean)) {
    const current = groups.at(-1);
    if (current && current.letters + current.words.length + word.length <= width) {
      current.words.push(word);
      current.letters += word.length;
    } else groups.push({ words: [word], letters: word.length });
  }
  return groups.map(({ words, letters }, index) => {
    if (index === groups.length - 1 || words.length === 1) return words.join(" ").padEnd(width);
    const gaps = words.length - 1, spaces = width - letters;
    const chunks = [words[0]];
    for (let i = 1; i < words.length; i++) chunks.push(" ".repeat(Math.floor(spaces / gaps) + (i <= spaces % gaps ? 1 : 0)), words[i]);
    return chunks.join("");
  });
};`,
    hiddenTests: [{"call": "(() => {const alphabet=['a','bb','ccc'];for(let n=0;n<=5;n++)for(let code=0;code<3**n;code++){let digits=code;const words=[];for(let i=0;i<n;i++){words.push(alphabet[digits%3]);digits=Math.floor(digits/3);}for(let width=1;width<=9;width++){const groups=[];let line=[];for(const word of words){if(line.length&&line.join(' ').length+1+word.length>width){groups.push(line);line=[];}line.push(word);}if(line.length)groups.push(line);const expected=groups.map((group,index)=>{if(index===groups.length-1||group.length===1)return group.join(' ').padEnd(width);const gaps=Array(group.length-1).fill(' ');let remaining=width-group.join('').length-gaps.length;for(let i=0;remaining>0;i++,remaining--)gaps[i%gaps.length]+=' ';return group.map((word,i)=>word+(gaps[i]||'')).join('');});if(JSON.stringify(justify(words.join(' '),width))!==JSON.stringify(expected))return false;}}return true;})()", "expected": true}, {"call": "(() => {const text='\\uFEFFe\\u0301\\u00a0\ud83d\ude00\\n\\ud83d\\tX\\uFEFF',a=justify(text,2),b=justify(text,2),expected=['e\\u0301','\ud83d\ude00','\\ud83d ','X '];if(JSON.stringify(a)!==JSON.stringify(expected)||a===b||justify('\\u200b',2)[0]!=='\\u200b ')return false;a.push('changed');return a.length===5&&b.length===4&&justify('',1)!==justify('',1);})()", "expected": true}, {"call": "(() => {const text=Array(10000).fill('a').join(' '),a=justify(text,20000),b=justify(text,1),c=justify('x'.repeat(20000),1);return a.length===1&&a[0]===text+' '&&b.length===10000&&b.every(line=>line==='a')&&c.length===1&&c[0]==='x'.repeat(20000)&&justify(' '.repeat(20000),20000).length===0;})()", "expected": true}, {"call": "justify(\"Science is what we understand well enough to explain to a computer. Art is everything else we do\", 20)", "expected": ["Science  is  what we", "understand      well", "enough to explain to", "a  computer.  Art is", "everything  else  we", "do                  "]}, {"call": "justify(\"abc def\", 7)", "expected": ["abc def"]}, {"call": "justify(\"one\\ntwo\\tthree\", 9)", "expected": ["one   two", "three    "]}, {"call": "justify(\"a b c\", 1)", "expected": ["a", "b", "c"]}, {"call": "justify(\"ab cd ef gh\", 6)", "expected": ["ab  cd", "ef gh "]}, {"call": "justify(\"   \", 4)", "expected": []}],
  },

  /* ── Hard: routes, settings and JSON ──────────────────────────────── */
  'js-mh-match-route': {
    solution: `// "/about/" and "/about" are the same page, but "/" keeps its one empty segment.
const segmentsOf = text => {
  const parts = text.split("/");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
};
// Lower is more specific: 0 for an exact segment, 1 for :name, 2 for *.
const rank = segment => (segment === "*" ? 2 : segment.startsWith(":") ? 1 : 0);

const matchRoute = (routes, path) => {
  const parts = segmentsOf(path);
  const tryRoute = route => {
    const pattern = segmentsOf(route);
    const wildcard = pattern[pattern.length - 1] === "*";
    const fixed = wildcard ? pattern.slice(0, -1) : pattern;
    // * needs at least one segment of its own; otherwise the lengths must agree.
    if (wildcard ? parts.length <= fixed.length : parts.length !== fixed.length) return null;
    const fits = fixed.every((segment, i) => (segment.startsWith(":") ? parts[i] !== "" : segment === parts[i]));
    if (!fits) return null;
    const params = Object.create(null);
    fixed.forEach((segment, i) => {
      if (segment.startsWith(":")) params[segment.slice(1)] = parts[i];
    });
    if (wildcard) params.rest = parts.slice(fixed.length).join("/");
    return { route, params };
  };
  const moreSpecific = (a, b) => {
    const left = segmentsOf(a.route).map(rank);
    const right = segmentsOf(b.route).map(rank);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0; // equally specific: sort is stable, so the route listed first stays first
  };
  // map and filter build a new array, so routes itself is never sorted.
  const matches = routes.map(tryRoute).filter(match => match !== null);
  return matches.sort(moreSpecific)[0] ?? null;
};`,
    junior: `const splitPath = text => {
  const parts = text.split("/");
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
};

const segmentRank = segment => {
  if (segment === "*") {
    return 2;
  }
  if (segment.startsWith(":")) {
    return 1;
  }
  return 0;
};

const matchRoute = (routes, path) => {
  const pathParts = splitPath(path);
  const matches = [];
  for (const route of routes) {
    const routeParts = splitPath(route);
    const last = routeParts[routeParts.length - 1];
    const hasRest = last === "*";
    let fixedParts = routeParts;
    if (hasRest) {
      fixedParts = routeParts.slice(0, routeParts.length - 1);
    }
    let lengthOk = pathParts.length === fixedParts.length;
    if (hasRest) {
      lengthOk = pathParts.length > fixedParts.length;
    }
    if (!lengthOk) {
      continue;
    }
    const allMatch = fixedParts.every((part, i) => {
      if (part.startsWith(":")) {
        return pathParts[i] !== "";
      }
      return part === pathParts[i];
    });
    if (!allMatch) {
      continue;
    }
    const params = Object.create(null);
    for (let i = 0; i < fixedParts.length; i++) {
      if (fixedParts[i].startsWith(":")) {
        const name = fixedParts[i].slice(1);
        params[name] = pathParts[i];
      }
    }
    if (hasRest) {
      params.rest = pathParts.slice(fixedParts.length).join("/");
    }
    matches.push({ route: route, params: params });
  }
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) => {
    const aParts = splitPath(a.route);
    const bParts = splitPath(b.route);
    let shorter = aParts.length;
    if (bParts.length < shorter) {
      shorter = bParts.length;
    }
    for (let i = 0; i < shorter; i++) {
      const difference = segmentRank(aParts[i]) - segmentRank(bParts[i]);
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  });
  return matches[0];
};`,
    senior: `const segmentsOf = text => {
  const parts = text.split("/");
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  return parts;
};
const rankOf = segment => (segment === "*" ? 2 : segment[0] === ":" ? 1 : 0);

const matchRoute = (routes, path) => {
  const parts = segmentsOf(path);
  const candidates = [];
  for (const route of routes) {
    const pattern = segmentsOf(route);
    const hasRest = pattern.at(-1) === "*";
    const fixed = hasRest ? pattern.slice(0, -1) : pattern;
    const lengthFits = hasRest ? parts.length > fixed.length : parts.length === fixed.length;
    if (!lengthFits || !fixed.every((segment, i) => (segment[0] === ":" ? parts[i] !== "" : segment === parts[i]))) continue;
    const params = Object.fromEntries(fixed.flatMap((segment, i) => (segment[0] === ":" ? [[segment.slice(1), parts[i]]] : [])));
    if (hasRest) params.rest = parts.slice(fixed.length).join("/");
    candidates.push({ route, params, ranks: pattern.map(rankOf) });
  }
  candidates.sort((a, b) => {
    const i = a.ranks.findIndex((rank, k) => rank !== b.ranks[k]);
    return i === -1 || b.ranks[i] === undefined ? 0 : a.ranks[i] - b.ranks[i];
  });
  const [best] = candidates;
  return best ? { route: best.route, params: best.params } : null;
};`,
    hiddenTests: [{"call": "(() => {const routes=['/','/*','/:id','/x','/x/','/x/*','/x/:id','/:id/y','/x/y','/:id/:tail','/x/:rest/*'],paths=['/','/x','/x/','/x//','/x/y','/x/y/z','/q/y','/x/%2f','//'];const split=s=>{const a=s.split('/');if(a.length>1&&a[a.length-1]==='')a.pop();return a;};for(const path of paths)for(let code=0;code<routes.length**2;code++){const list=Object.freeze([routes[code%routes.length],routes[Math.floor(code/routes.length)]]),parts=split(path),matches=[];for(let index=0;index<list.length;index++){const route=list[index],pattern=split(route),star=pattern[pattern.length-1]==='*',fixed=star?pattern.slice(0,-1):pattern;if(star?parts.length<=fixed.length:parts.length!==fixed.length)continue;const pairs=[];let valid=true;for(let i=0;i<fixed.length;i++){if(fixed[i][0]===':'){if(parts[i]===''){valid=false;break;}pairs.push([fixed[i].slice(1),parts[i]]);}else if(fixed[i]!==parts[i]){valid=false;break;}}if(!valid)continue;if(star)pairs.push(['rest',parts.slice(fixed.length).join('/')]);matches.push({route,params:Object.fromEntries(pairs),ranks:pattern.map(s=>s==='*'?2:s[0]===':'?1:0)});}matches.sort((a,b)=>{for(let i=0;i<Math.min(a.ranks.length,b.ranks.length);i++)if(a.ranks[i]!==b.ranks[i])return a.ranks[i]-b.ranks[i];return 0;});const expected=matches.length?{route:matches[0].route,params:matches[0].params}:null;if(JSON.stringify(matchRoute(list,path))!==JSON.stringify(expected))return false;}return true;})()", "expected": true}, {"call": "(() => {const routes=Object.freeze(['/:__proto__/:constructor','/*']),a=matchRoute(routes,'/x/y'),b=matchRoute(routes,'/x/y');if(a===b||a.params===b.params||!Object.hasOwn(a.params,'__proto__')||a.params.__proto__!=='x'||a.params.constructor!=='y'||matchRoute(['/*'],'/')!==null)return false;a.params.__proto__='changed';return a.params.__proto__==='changed'&&b.params.__proto__==='x'&&matchRoute(['/x/%2f','/x/:v'],'/x/%2f').route==='/x/%2f'&&matchRoute(['/:id/:id'],'/a/b').params.id==='b'&&matchRoute(['/:rest/*'],'/a/b').params.rest==='b';})()", "expected": true}, {"call": "(() => {const routes=Object.freeze(Array.from({length:999},(_,i)=>'/page'+i).concat('/'+ 'x'.repeat(999))),a=matchRoute(routes,'/'+ 'x'.repeat(999)),b=matchRoute(routes,'/none');return a.route==='/'+ 'x'.repeat(999)&&Object.keys(a.params).length===0&&b===null&&matchRoute([], '/x')===null;})()", "expected": true}, {"call": "matchRoute([\"/:section/new\", \"/posts/:id\"], \"/posts/new\")", "expected": {"route": "/posts/:id", "params": {"id": "new"}}}, {"call": "matchRoute([\"/items/:id\", \"/items/:slug\"], \"/items/9\")", "expected": {"route": "/items/:id", "params": {"id": "9"}}}, {"call": "[matchRoute([\"/docs/*\"], \"/docs\"), matchRoute([\"/docs/*\"], \"/docs/\")]", "expected": [null, null]}, {"call": "[matchRoute([\"/\", \"/:page\"], \"/\"), matchRoute([\"/\", \"/:page\"], \"/pricing\")]", "expected": [{"route": "/", "params": {}}, {"route": "/:page", "params": {"page": "pricing"}}]}, {"call": "matchRoute([\"/a/:b\"], \"/a/x/y\")", "expected": null}, {"call": "matchRoute([\"/:a/:b\", \"/shop/:b\", \"/shop/cart\"], \"/shop/cart\")", "expected": {"route": "/shop/cart", "params": {}}}, {"call": "(() => { const routes = [\"/x/*\", \"/x/:id\", \"/x/y\"]; matchRoute(routes, \"/x/y\"); return routes; })()", "expected": ["/x/*", "/x/:id", "/x/y"]}, {"call": "matchRoute([\"/files/:dir/*\"], \"/files/img/a/b.png\")", "expected": {"route": "/files/:dir/*", "params": {"dir": "img", "rest": "a/b.png"}}}, {"call": "[matchRoute([\"/about\"], \"/contact\"), matchRoute([\"/users/:id\", \"/teams/me\"], \"/users/me\")]", "expected": [null, {"route": "/users/:id", "params": {"id": "me"}}]}, {"call": "matchRoute([\"/users/me\", \"/users/:id\"], \"/users/me\")", "expected": {"route": "/users/me", "params": {}}}],
  },
  'js-mh-settings-diff': {
    solution: `// typeof says "object" for null and arrays too; both are leaves here.
const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value);
const sameLeaf = (a, b) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, i) => item === b[i])
    : a === b;

const diffSettings = (before, after) => {
  const changes = [];
  const join = (prefix, key) => (prefix === "" ? key : prefix + "." + key);
  // Every leaf under value, reported with one kind of change.
  const everyLeaf = (value, path, change) => {
    if (!isObject(value)) {
      changes.push({ path, change });
      return;
    }
    for (const key in value) if (Object.hasOwn(value, key)) everyLeaf(value[key], join(path, key), change);
  };
  const walk = (a, b, prefix) => {
    for (const key in a) {
      if (!Object.hasOwn(a, key)) continue;
      const path = join(prefix, key);
      if (!Object.prototype.propertyIsEnumerable.call(b, key)) everyLeaf(a[key], path, "removed");
      else if (isObject(a[key]) && isObject(b[key])) walk(a[key], b[key], path);
      else if (isObject(a[key]) || isObject(b[key])) {
        // An object on one side and a leaf on the other: both sides are reported.
        everyLeaf(a[key], path, "removed");
        everyLeaf(b[key], path, "added");
      } else if (!sameLeaf(a[key], b[key])) changes.push({ path, change: "changed" });
    }
    for (const key in b) {
      if (!Object.hasOwn(b, key)) continue;
      if (!Object.prototype.propertyIsEnumerable.call(a, key)) everyLeaf(b[key], join(prefix, key), "added");
    }
  };
  walk(before, after, "");
  return changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
};`,
    junior: `const isPlainObject = value => {
  if (value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  return typeof value === "object";
};

const leavesEqual = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }
  return a === b;
};

const diffSettings = (before, after) => {
  const changes = [];
  const pathFor = (prefix, key) => {
    if (prefix === "") {
      return key;
    }
    return prefix + "." + key;
  };
  const reportAll = (value, path, change) => {
    if (isPlainObject(value)) {
      for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
        reportAll(value[key], pathFor(path, key), change);
      }
    } else {
      changes.push({ path: path, change: change });
    }
  };
  const compare = (a, b, prefix) => {
    for (const key in a) {
      if (!Object.hasOwn(a, key)) continue;
      const path = pathFor(prefix, key);
      const inB = Object.prototype.propertyIsEnumerable.call(b, key);
      if (!inB) {
        reportAll(a[key], path, "removed");
        continue;
      }
      const aIsObject = isPlainObject(a[key]);
      const bIsObject = isPlainObject(b[key]);
      if (aIsObject && bIsObject) {
        compare(a[key], b[key], path);
      } else if (aIsObject || bIsObject) {
        reportAll(a[key], path, "removed");
        reportAll(b[key], path, "added");
      } else if (!leavesEqual(a[key], b[key])) {
        changes.push({ path: path, change: "changed" });
      }
    }
    for (const key in b) {
      if (!Object.hasOwn(b, key)) continue;
      const inA = Object.prototype.propertyIsEnumerable.call(a, key);
      if (!inA) {
        reportAll(b[key], pathFor(prefix, key), "added");
      }
    }
  };
  compare(before, after, "");
  changes.sort((x, y) => {
    if (x.path < y.path) {
      return -1;
    }
    if (x.path > y.path) {
      return 1;
    }
    return 0;
  });
  return changes;
};`,
    senior: `const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value);

const leaves = (value, prefix = "", out = new Map()) => {
  for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
    const path = prefix ? \`\${prefix}.\${key}\` : key;
    if (isObject(value[key])) leaves(value[key], path, out);
    else out.set(path, value[key]);
  }
  return out;
};

const sameLeaf = (a, b) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, i) => item === b[i]) : a === b;

const diffSettings = (before, after) => {
  const old = leaves(before);
  const next = leaves(after);
  const changes = [];
  for (const [path, value] of old) {
    if (!next.has(path)) changes.push({ path, change: "removed" });
    else if (!sameLeaf(value, next.get(path))) changes.push({ path, change: "changed" });
  }
  for (const path of next.keys()) if (!old.has(path)) changes.push({ path, change: "added" });
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};`,
    hiddenTests: [
      {
        label: 'a nested leaf becomes visible or hidden when its property changes enumerability',
        call: `(() => {
          const hidden = Object.create(null);
          Object.defineProperty(hidden, 'theme', { value: 'dark' });
          Object.freeze(hidden);
          const visible = Object.freeze({ theme: 'dark' });
          return [diffSettings({ ui: hidden }, { ui: visible }), diffSettings({ ui: visible }, { ui: hidden })];
        })()`,
        expected: [[{ path: 'ui.theme', change: 'added' }], [{ path: 'ui.theme', change: 'removed' }]],
      },{"call": "(() => {const values=[0,false,null,NaN,-0,[0],[NaN],{}, {x:1},{x:{y:2}}];const flatten=(node,prefix='',out=[])=>{for(const key of Object.keys(node)){const path=prefix?prefix+'.'+key:key,value=node[key];if(value!==null&&typeof value==='object'&&!Array.isArray(value))flatten(value,path,out);else out.push([path,value]);}return out;};for(const x of values)for(const y of values){const a=flatten({a:x}),b=flatten({a:y}),old=new Map(a),next=new Map(b),expected=[];for(const[path,value]of a){if(!next.has(path))expected.push({path,change:'removed'});else{const other=next.get(path),same=Array.isArray(value)&&Array.isArray(other)?value.length===other.length&&value.every((v,i)=>v===other[i]):value===other;if(!same)expected.push({path,change:'changed'});}}for(const[path]of b)if(!old.has(path))expected.push({path,change:'added'});expected.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);if(JSON.stringify(diffSettings({a:x},{a:y}))!==JSON.stringify(expected))return false;}return true;})()", "expected": true}, {"call": "(() => {const before=Object.assign(Object.create(null),{['__proto__']:Object.freeze([NaN,-0]),constructor:Infinity}),after=Object.assign(Object.create(null),{['__proto__']:Object.freeze([NaN,0]),constructor:Infinity});Object.defineProperty(before,'ignored',{value:1});before[Symbol('ignored')]=true;Object.freeze(before);Object.freeze(after);const a=diffSettings(before,after),b=diffSettings(before,after);if(a===b||a[0]===b[0]||JSON.stringify(a)!==JSON.stringify([{path:'__proto__',change:'changed'}]))return false;a[0].change='mutated';a.push({});return a[0].change==='mutated'&&a.length===2&&b[0].change==='changed'&&Object.is(before.__proto__[1],-0)&&after.__proto__[1]===0&&diffSettings({}, {})!==diffSettings({},{});})()", "expected": true}, {"call": "(() => {let a={leaf:1},b={leaf:2};for(let i=0;i<63;i++){a=Object.freeze({k:a});b=Object.freeze({k:b});}const deep=diffSettings(Object.freeze(a),Object.freeze(b)),wideA=Object.freeze({items:Object.freeze(Array(9998).fill(0))}),wideB=Object.freeze({items:Object.freeze(Array(9998).fill(0).concat(1))});return deep.length===1&&deep[0].path===Array(63).fill('k').concat('leaf').join('.')&&deep[0].change==='changed'&&JSON.stringify(diffSettings(wideA,wideB))===JSON.stringify([{path:'items',change:'changed'}]);})()", "expected": true}, {"call": "diffSettings({ proxy: { host: \"x\", port: 1 } }, { proxy: null })", "expected": [{"path": "proxy", "change": "added"}, {"path": "proxy.host", "change": "removed"}, {"path": "proxy.port", "change": "removed"}]}, {"call": "diffSettings({ cache: false }, { cache: { size: 10 } })", "expected": [{"path": "cache", "change": "removed"}, {"path": "cache.size", "change": "added"}]}, {"call": "diffSettings({ list: [1, 2], mixed: [1, \"1\"] }, { list: [1, 2, 3], mixed: [1, 1] })", "expected": [{"path": "list", "change": "changed"}, {"path": "mixed", "change": "changed"}]}, {"call": "diffSettings({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 1, e: 2 } } } })", "expected": [{"path": "a.b.c.e", "change": "added"}]}, {"call": "diffSettings({ gone: {}, stay: 1 }, { stay: 1, fresh: {} })", "expected": []}, {"call": "diffSettings({ ui: { dark: true, size: \"m\" }, beta: false }, { ui: { dark: true, size: \"l\", font: null }, beta: false, lang: \"en\" })", "expected": [{"path": "lang", "change": "added"}, {"path": "ui.font", "change": "added"}, {"path": "ui.size", "change": "changed"}]}],
  },
  'js-mh-safe-stringify': {
    solution: `const safeStringify = value => {
  // The objects on the path from the root to where we are now. A child that
  // is already on the path points back up: that is the loop.
  const path = new Set();
  const copy = current => {
    if (current === null || typeof current !== "object") return current;
    if (path.has(current)) return "[Circular]";
    path.add(current);
    const result = Array.isArray(current)
      ? current.map(child => copy(child))
      : Object.fromEntries(Object.entries(current).map(([key, child]) => [key, copy(child)]));
    path.delete(current); // leaving it: a later sibling may use the same object freely
    return result;
  };
  return JSON.stringify(copy(value));
};`,
    junior: "function safeStringify(value) {\n  const path = new Set();\n  const copy = current => {\n    if (current === null || typeof current !== 'object') return current;\n    if (path.has(current)) return '[Circular]';\n    path.add(current);\n    let output;\n    if (Array.isArray(current)) output = current.map(copy);\n    else {\n      output = Object.create(null);\n      for (const key of Object.keys(current)) output[key] = copy(current[key]);\n    }\n    path.delete(current);\n    return output;\n  };\n  return JSON.stringify(copy(value));\n}",
    senior: "const safeStringify = value => {\n  const ancestors = new Set();\n  const visit = node => {\n    if (node === null || typeof node !== \"object\") return node;\n    if (ancestors.has(node)) return \"[Circular]\";\n    ancestors.add(node);\n    const result = Array.isArray(node)\n      ? node.map(visit)\n      : Object.fromEntries(Object.keys(node).map(key => [key, visit(node[key])]));\n    ancestors.delete(node);\n    return result;\n  };\n  return JSON.stringify(visit(value));\n};",
    hiddenTests: [
      { call: "(()=>{const root=Object.create(null);root.__proto__=root;root.constructor={value:1};Object.freeze(root.constructor);Object.freeze(root);return safeStringify(root);})()", expected: "{\"__proto__\":\"[Circular]\",\"constructor\":{\"value\":1}}",  },
      { call: "(()=>{const array=[1];array.length=4;array[2]=array;array.extra=array;Object.freeze(array);return safeStringify(array);})()", expected: "[1,null,\"[Circular]\",null]",  },
      { call: "(()=>{const shared={v:1};shared.self=shared;Object.freeze(shared);return safeStringify(Object.freeze({left:shared,right:shared}));})()", expected: "{\"left\":{\"v\":1,\"self\":\"[Circular]\"},\"right\":{\"v\":1,\"self\":\"[Circular]\"}}",  },
      { call: "(()=>{const root={},nodes=[root];let current=root;for(let i=0;i<99;i++){current.next={};current=current.next;nodes.push(current);}current.back=root;nodes.forEach(Object.freeze);let parsed=JSON.parse(safeStringify(root));for(let i=0;i<99;i++)parsed=parsed.next;return [parsed.back,current.back===root,nodes.every(Object.isFrozen)];})()", expected: ["[Circular]", true, true],  },
      { call: "(()=>{const shared=Object.freeze({id:1}),input=Object.freeze(Array(1000).fill(shared)),text=safeStringify(input),parsed=JSON.parse(text);return [parsed.length,parsed.every(value=>value.id===1),text.includes('[Circular]')];})()", expected: [1000, true, false],  },
      { call: "[null,false,42,-0,NaN,Infinity,-Infinity,'\u00e9\ud83e\udd88','\ud800',[],{}].map(value=>safeStringify(value)===JSON.stringify(value))", expected: [true, true, true, true, true, true, true, true, true, true, true],  },
      { call: "(()=>{const value=Object.create(null);value.toJSON='data';value['2']='two';value['1']='one';Object.defineProperty(value,'hidden',{value});value[Symbol('hidden')]=value;return safeStringify(value);})()", expected: "{\"1\":\"one\",\"2\":\"two\",\"toJSON\":\"data\"}",  },

      { call: '(() => { const a = { name: "a" }; const b = { name: "b", back: a }; a.next = b; return safeStringify({ start: a }); })()', expected: '{"start":{"name":"a","next":{"name":"b","back":"[Circular]"}}}' },
      { call: '(() => { const tag = { id: 1 }; return safeStringify([tag, tag, [tag]]); })()', expected: '[{"id":1},{"id":1},[{"id":1}]]' },
      { call: '(() => { const shared = { v: 1 }; return safeStringify({ first: { inner: shared }, second: shared }); })()', expected: '{"first":{"inner":{"v":1}},"second":{"v":1}}' },
      { call: '(() => { const ada = { name: "Ada", friends: [] }; const ben = { name: "Ben", friends: [ada] }; ada.friends.push(ben); return safeStringify([ada, ben]); })()', expected: '[{"name":"Ada","friends":[{"name":"Ben","friends":["[Circular]"]}]},{"name":"Ben","friends":[{"name":"Ada","friends":["[Circular]"]}]}]' },
      { call: '(() => { const node = { id: 1 }; node.self = node; safeStringify(node); return node.self === node; })()', expected: true },
      { call: '[safeStringify(null), safeStringify(42), safeStringify([])]', expected: ['null', '42', '[]'] },
    ],
  },

  /* ── Hard: promises that share work ───────────────────────────────── */
  'js-mh-batch-loader': {
    solution: `const createLoader = (loadMany, waitMs) => {
  // The batch being gathered, id -> callers waiting for it; null between batches.
  let gathering = null;
  const send = async batch => {
    const ids = [...batch.keys()]; // a Map keeps the order ids were first asked for
    try {
      const results = await loadMany(ids);
      ids.forEach((id, index) => {
        for (const { resolve } of batch.get(id)) resolve(results[index]);
      });
    } catch (error) {
      for (const waiting of batch.values()) {
        for (const { reject } of waiting) reject(error);
      }
    }
  };
  return id => new Promise((resolve, reject) => {
    if (gathering === null) {
      const batch = new Map();
      gathering = batch;
      setTimeout(() => {
        gathering = null; // a load from now on starts a new batch
        send(batch);
      }, waitMs);
    }
    if (!gathering.has(id)) gathering.set(id, []);
    gathering.get(id).push({ resolve, reject });
  });
};`,
    junior: "const createLoader = (loadMany, waitMs) => {\n  let currentBatch = null;\n  const load = id => {\n    return new Promise((resolve, reject) => {\n      if (currentBatch === null) {\n        const batch = { ids: [], waiting: new Map() };\n        currentBatch = batch;\n        setTimeout(async () => {\n          currentBatch = null;\n          try {\n            const results = await loadMany(batch.ids);\n            for (let i = 0; i < batch.ids.length; i++) {\n              const callers = batch.waiting.get(batch.ids[i]);\n              for (const caller of callers) {\n                caller.resolve(results[i]);\n              }\n            }\n          } catch (error) {\n            for (const id of batch.ids) {\n              const callers = batch.waiting.get(id);\n              for (const caller of callers) {\n                caller.reject(error);\n              }\n            }\n          }\n        }, waitMs);\n      }\n      if (!currentBatch.waiting.has(id)) {\n        currentBatch.ids.push(id === 0 ? 0 : id);\n        currentBatch.waiting.set(id, []);\n      }\n      currentBatch.waiting.get(id).push({ resolve: resolve, reject: reject });\n    });\n  };\n  return load;\n};",
    senior: `const createLoader = (loadMany, waitMs) => {
  let batch = null;
  return id => {
    if (batch === null) {
      const current = { promises: new Map() };
      current.results = new Promise(done => setTimeout(done, waitMs)).then(() => {
        batch = null;
        return loadMany([...current.promises.keys()]);
      });
      batch = current;
    }
    if (!batch.promises.has(id)) {
      const index = batch.promises.size; // one shared promise per id, picking its own result
      batch.promises.set(id, batch.results.then(results => results[index]));
    }
    return batch.promises.get(id);
  };
};`,
    hiddenTests: [
      { call: "(async()=>{let calls=0;const load=createLoader(async ids=>ids.map(()=>++calls),0);const a=await load('same'),b=await load('same');return [a,b,calls];})()", expected: [1, 2, 2], async: true },
      { call: "(async()=>{let started,finish;const start=new Promise(done=>{started=done;}),gate=new Promise(done=>{finish=done;});let calls=0;const load=createLoader(ids=>{calls++;if(calls===1){started();return gate;}return Promise.resolve(ids.map(()=>'new'));},0);const first=load('x');await start;const second=await load('x');finish(['old']);return [await first,second,calls];})()", expected: ["old", "new", 2], async: true },
      { call: "(async()=>{let seen,arity;const obj=Object.freeze({}),fn=()=>1,sym=Symbol('v'),values=[obj,fn,sym,undefined,NaN,-0],ids=[-0,0,'0','__proto__','',1,'1'];const load=createLoader(function(keys){arity=arguments.length;seen=keys;return Promise.resolve(values);},0);const output=await Promise.all(ids.map(load));return [arity,seen.length,Object.is(seen[0],0),seen.slice(1),output.every((x,i)=>Object.is(x,values[i===0?0:i-1]))];})()", expected: [1, 6, true, ["0", "__proto__", "", 1, "1"], true], async: true },
      { call: "(async()=>{let calls=0,inner;const reason=Symbol('bad');const load=createLoader(ids=>{calls++;if(calls===1){inner=load('later');throw reason;}return Promise.resolve(ids.map(id=>id+'!'));},0);const failures=await Promise.allSettled([load('a'),load('a'),load('b')]);return [failures.every(x=>x.status==='rejected'&&x.reason===reason),await inner,calls];})()", expected: [true, "later!", 2], async: true },
      { call: "(async()=>{let calls=0,keys,inline=true;const load=createLoader(async ids=>{calls++;keys=ids;return ids.map(id=>id*2);},0);const promises=[];for(let i=0;i<1000;i++)promises.push(load(i%500));await Promise.resolve();inline=calls!==0;const values=await Promise.all(promises);return [inline,calls,keys.length,keys.every((id,i)=>id===i),values.length,values.every((value,i)=>value===(i%500)*2)];})()", expected: [false, 1, 500, true, 1000, true], async: true },

      { call: '(async () => { const calls = []; const load = createLoader(async ids => { calls.push(ids); return ids.map(id => -id); }, 10); const values = await Promise.all([load(3), load(1), load(3), load(2)]); return [values, calls]; })()', expected: [[-3, -1, -3, -2], [[3, 1, 2]]], async: true },
      { call: '(async () => { const calls = []; const a = createLoader(async ids => { calls.push("a:" + ids.join()); return ids; }, 10); const b = createLoader(async ids => { calls.push("b:" + ids.join()); return ids; }, 10); await Promise.all([a(1), b(2), a(3)]); return calls.sort(); })()', expected: ['a:1,3', 'b:2'], async: true },
      { call: '(async () => { let fail = true; const load = createLoader(async ids => { if (fail) { fail = false; throw new Error("once"); } return ids.map(id => id + "!"); }, 10); const first = await load("x").catch(error => error.message); const second = await load("x"); return [first, second]; })()', expected: ['once', 'x!'], async: true },
      { call: '(async () => { const load = createLoader(async ids => ids.map(id => (id === "zero" ? 0 : null)), 5); return Promise.all([load("zero"), load("none")]); })()', expected: [0, null], async: true },
      { call: '(async () => { const calls = []; const load = createLoader(async ids => { calls.push(ids.length); return ids; }, 10); const wait = ms => new Promise(done => setTimeout(done, ms)); const all = [load(1), load(2)]; await wait(30); all.push(load(3)); await wait(30); all.push(load(4), load(5), load(4)); await Promise.all(all); return calls; })()', expected: [2, 1, 2], async: true },
      { call: '(async () => { const calls = []; const load = createLoader(ids => { calls.push(ids); return new Promise(done => setTimeout(() => done(ids.map(String)), 50)); }, 5); const first = load(1); await new Promise(done => setTimeout(done, 20)); const second = load(2); return [await first, await second, calls]; })()', expected: ['1', '2', [[1], [2]]], async: true },
    ],
  },
  'js-mh-shared-request': {
    solution: `const shareRequests = (fetchRate, ttlMs, now) => {
  const entries = new Map(); // key -> { promise, at }
  return key => {
    const stored = entries.get(key);
    // The promise exists from the moment the request starts, so a second
    // caller shares it before any answer has arrived.
    if (stored && now() - stored.at < ttlMs) return stored.promise;
    const entry = { promise: fetchRate(key), at: now() };
    entries.set(key, entry);
    entry.promise.catch(() => {
      // Forget a failure, but only this one: a newer request for the same key
      // may have replaced it while it was in flight.
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry.promise;
  };
};`,
    junior: `const shareRequests = (fetchRate, ttlMs, now) => {
  const cache = new Map();
  const get = key => {
    if (cache.has(key)) {
      const saved = cache.get(key);
      const age = now() - saved.at;
      if (age < ttlMs) {
        return saved.promise;
      }
    }
    const promise = fetchRate(key);
    const entry = { promise: promise, at: now() };
    cache.set(key, entry);
    promise.catch(() => {
      const current = cache.get(key);
      if (current === entry) {
        cache.delete(key);
      }
    });
    return promise;
  };
  return get;
};`,
    senior: `const shareRequests = (fetchRate, ttlMs, now) => {
  const entries = new Map();
  const isFresh = entry => entry !== undefined && now() - entry.at < ttlMs;
  return key => {
    const stored = entries.get(key);
    if (isFresh(stored)) return stored.promise;
    const entry = { promise: Promise.resolve(fetchRate(key)), at: now() };
    entries.set(key, entry);
    entry.promise.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry.promise;
  };
};`,
    hiddenTests: [
      { call: "(async()=>{let calls=0;const keys=[1,'1',{},Object.freeze({}),()=>1,Symbol('k'),null,undefined,NaN,-0];const seen=[],get=shareRequests(function(key){seen.push([key,arguments.length]);calls++;return Promise.resolve(key);},1000,()=>0);const results=await Promise.all(keys.map(key=>get(key)));const same=get(NaN)===get(NaN)&&get(-0)===get(0);return [calls,same,seen.every((pair,i)=>Object.is(pair[0],keys[i])&&pair[1]===1),results.every((x,i)=>Object.is(x,keys[i]))];})()", expected: [10, true, true, true], async: true },
      { call: "(async()=>{let time=0,calls=0,fail;const reason=Symbol('old'),get=shareRequests(()=>{calls++;return calls===1?new Promise((_,reject)=>{fail=reject;}):Promise.resolve('new');},10,()=>time);const first=get('x').catch(error=>error===reason);time=10;const second=get('x');fail(reason);const firstResult=await first;const third=get('x');return [firstResult,second===third,await third,calls];})()", expected: [true, true, "new", 2], async: true },
      { call: "(async()=>{let calls=0;const get=shareRequests(async()=>++calls,0,()=>0),a=get('x'),b=get('x');return [a!==b,await a,await b,calls];})()", expected: [true, 1, 2, 2], async: true },
      { call: "(async()=>{let calls=0;const values=[Object.freeze({}),()=>1,Symbol('v'),undefined,NaN,-0],get=shareRequests(key=>{calls++;return Promise.resolve(values[key]);},1000,()=>0);const output=await Promise.all(values.map((_,i)=>get(i)));const failed=shareRequests(()=>Promise.reject(undefined),1000,()=>0);const a=failed('x'),b=failed('x');const results=await Promise.allSettled([a,b]);return [calls,output.every((x,i)=>Object.is(x,values[i])),a===b,results.every(x=>x.status==='rejected'&&x.reason===undefined),await failed('x').then(()=>false,()=>true)];})()", expected: [6, true, true, true, true], async: true },

      { call: '(async () => { let time = 0; let calls = 0; const get = shareRequests(() => { calls++; const mine = calls; return new Promise((done, fail) => setTimeout(() => (mine === 1 ? fail(new Error("slow failure")) : done("fresh")), mine === 1 ? 50 : 10)); }, 20, () => time); const first = get("k").catch(error => error.message); time = 30; const second = get("k"); const firstResult = await first; const third = get("k"); return [firstResult, await second, await third, calls]; })()', expected: ['slow failure', 'fresh', 'fresh', 2], async: true },
      { call: '(async () => { let time = 0; let calls = 0; const get = shareRequests(async () => ++calls, 100, () => time); const first = get("k"); time = 150; const second = get("k"); return [await first, await second]; })()', expected: [1, 2], async: true },
      { call: '(async () => { let time = 0; const seen = []; const get = shareRequests(async key => { seen.push(key); return key; }, 50, () => time); await get("a"); time = 40; await get("b"); time = 60; await get("a"); await get("b"); return seen; })()', expected: ['a', 'b', 'a'], async: true },
      { call: '(async () => { let calls = 0; const fetchRate = async key => { calls++; return key; }; const one = shareRequests(fetchRate, 1000, () => 0); const two = shareRequests(fetchRate, 1000, () => 0); await Promise.all([one("x"), two("x")]); return calls; })()', expected: 2, async: true },
      { call: '(async () => { let calls = 0; const get = shareRequests(async () => { calls++; return 0; }, 1000, () => 0); await get("z"); const again = await get("z"); return [again, calls]; })()', expected: [0, 1], async: true },
    ],
  },
};
