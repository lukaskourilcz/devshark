/** The `console` a learner's JavaScript sees, in both places it runs: the
 * browser worker behind the Run button (`shared/coding-evaluate.ts`) and the
 * QuickJS sandbox that grades a submission (`lib/coding/sandbox.ts`).
 *
 * The debugging paths teach the console as a tool, so it has to be more than
 * `log`: `table`, `group`, `count`, `time`, `assert`, `dir` and `trace` all
 * print something readable into the Console tab instead of throwing "is not a
 * function". What each method prints is written once, here, as source text,
 * because the sandbox needs text to evaluate inside the VM and the worker
 * compiles the same text, so a line looks the same after Run and after Submit.
 * The one difference is the clock: the sandbox's timers are virtual, so a
 * `console.time` there reads 0ms for synchronous work and the virtual delay
 * for timers, while the worker reads the real one.
 *
 * The factory takes three functions from its runner: `emit(line)` stores one
 * finished line and enforces the runner's line cap, `format(value)` renders one
 * argument the way that runner always has, and `clock()` returns milliseconds.
 * It reaches nothing else: no host object, no grading state. */

/** @public Published by name through packages/coding-evaluator/src/index.ts in ESM and CommonJS. */
export type ConsoleEmit = (line: string) => void;
/** @public Published by name through packages/coding-evaluator/src/index.ts in ESM and CommonJS. */
export type ConsoleFormat = (value: unknown) => string;
/** @public Published by name through packages/coding-evaluator/src/index.ts in ESM and CommonJS. */
export type ConsoleClock = () => number;
/** @public Published by name through packages/coding-evaluator/src/index.ts in ESM and CommonJS. */
export type LearnerConsole = Record<string, (...args: unknown[]) => void>;
export type LearnerConsoleFactory = (emit: ConsoleEmit, format: ConsoleFormat, clock: ConsoleClock) => LearnerConsole;

/** Rows past this many are summarised, so one table cannot flood the tab. */
/** @public Published from packages/coding-evaluator/src/index.ts; preserve the package API. */
export const CONSOLE_TABLE_ROWS = 50;

/** Plain ES2019 on purpose: QuickJS evaluates it as written. */
export const CONSOLE_SOURCE = `(emit, format, clock) => {
  let indent = '';
  const counts = new Map();
  const timers = new Map();
  const say = (text) => emit(indent + text);
  const join = (args) => {
    let text = '';
    for (let i = 0; i < args.length; i++) text += (i ? ' ' : '') + format(args[i]);
    return text;
  };
  const print = (...args) => say(join(args));
  const name = (label) => (label === undefined ? 'default' : String(label));
  const cell = (value) => (typeof value === 'string' ? '"' + value + '"' : format(value));
  const since = (label) => {
    const ms = clock() - timers.get(label);
    return label + ': ' + Math.round(ms * 1000) / 1000 + 'ms';
  };
  const table = (data) => {
    if (data === null || typeof data !== 'object') { print(data); return; }
    const keys = Object.keys(data);
    const shown = keys.slice(0, ${CONSOLE_TABLE_ROWS});
    const columns = [];
    let values = false;
    for (const key of shown) {
      const row = data[key];
      if (row !== null && typeof row === 'object') {
        for (const column of Object.keys(row)) if (columns.indexOf(column) === -1) columns.push(column);
      } else values = true;
    }
    const header = ['(index)'].concat(columns, values ? ['Values'] : []);
    const rows = shown.map((key) => {
      const row = data[key];
      const nested = row !== null && typeof row === 'object';
      return [key].concat(
        columns.map((column) => (nested && Object.prototype.hasOwnProperty.call(row, column) ? cell(row[column]) : '')),
        values ? [nested ? '' : cell(row)] : [],
      );
    });
    const widths = header.map((title, index) => rows.reduce((wide, row) => Math.max(wide, row[index].length), title.length));
    const line = (cells, gap, fill) => cells.map((text, index) => text + fill.repeat(widths[index] - text.length)).join(gap).replace(/ +$/, '');
    const lines = [line(header, ' | ', ' '), line(widths.map(() => ''), '-+-', '-')].concat(rows.map((row) => line(row, ' | ', ' ')));
    if (keys.length > shown.length) lines.push('… ' + (keys.length - shown.length) + ' more rows');
    say(lines.join('\\n' + indent));
  };
  const group = (...label) => {
    if (label.length) print(...label);
    indent += '  ';
  };
  return {
    log: print,
    info: print,
    debug: print,
    warn: print,
    error: print,
    dir: (value) => print(value),
    trace: (...args) => print(...['Trace' + (args.length ? ':' : '')].concat(args)),
    assert: (condition, ...args) => { if (!condition) print(...['Assertion failed' + (args.length ? ':' : '')].concat(args)); },
    table,
    group,
    groupCollapsed: group,
    groupEnd: () => { indent = indent.slice(0, -2); },
    count: (label) => {
      const key = name(label);
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);
      say(key + ': ' + next);
    },
    countReset: (label) => { counts.set(name(label), 0); },
    time: (label) => {
      const key = name(label);
      if (timers.has(key)) { say('Timer "' + key + '" already exists'); return; }
      timers.set(key, clock());
    },
    timeLog: (label, ...data) => {
      const key = name(label);
      if (!timers.has(key)) { say('Timer "' + key + '" does not exist'); return; }
      say(since(key) + (data.length ? ' ' + join(data) : ''));
    },
    timeEnd: (label) => {
      const key = name(label);
      if (!timers.has(key)) { say('Timer "' + key + '" does not exist'); return; }
      say(since(key));
      timers.delete(key);
    },
  };
}`;

// Capture the trusted compiler before a disposable task realm can revoke
// learner-visible compilation. Keep actual compilation lazy for page CSP.
const compileConsole = Function;
let compiled: LearnerConsoleFactory | null = null;

/** The factory compiled for this JavaScript realm. Only the worker and the
 * node content test call it: the page itself never compiles code, which is
 * why this waits for the first call instead of running at import. */
export function learnerConsoleFactory(): LearnerConsoleFactory {
  compiled ??= compileConsole(`return ${CONSOLE_SOURCE};`)() as LearnerConsoleFactory;
  return compiled;
}
