/** Type checking and transpiling for the TypeScript track.
 *
 * A TypeScript task is graded twice: the runtime suite says the code does the
 * right thing, and the compiler says the types say the right thing. The
 * compiler and its lib files are injected because the callers load them
 * differently: the browser worker has them inlined by the bundler, the node
 * test and the server read them off disk. Ported from interview-prepper. */

import type * as ts from 'typescript';

type TypeScriptModule = typeof ts;

const ANSWER_FILE = 'answer.ts';
const GLOBALS_FILE = 'globals.d.ts';

// The lib files describe the language, not the host. `console`, the timers
// and the web APIs both runners have come from the DOM lib, which is 2.5 MB
// of browser API for a few signatures, so they are declared here instead. The
// console methods are the ones both runners provide (`shared/coding-console.ts`);
// URL, URLSearchParams, the text encoders and base64 are the ones the grader
// adds (`lib/coding/sandbox-web-apis.ts`).
const GLOBALS = `declare const console: {
  log(...values: unknown[]): void;
  info(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
  debug(...values: unknown[]): void;
  dir(value?: unknown): void;
  trace(...values: unknown[]): void;
  assert(condition?: unknown, ...values: unknown[]): void;
  table(data?: unknown): void;
  group(...label: unknown[]): void;
  groupCollapsed(...label: unknown[]): void;
  groupEnd(): void;
  count(label?: string): void;
  countReset(label?: string): void;
  time(label?: string): void;
  timeLog(label?: string, ...values: unknown[]): void;
  timeEnd(label?: string): void;
};
declare function setTimeout(handler: (...args: never[]) => void, ms?: number): number;
declare function clearTimeout(handle?: number): void;
declare function setInterval(handler: (...args: never[]) => void, ms?: number): number;
declare function clearInterval(handle?: number): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;
declare class URLSearchParams {
  constructor(init?: string[][] | Record<string, string> | string | URLSearchParams | Iterable<readonly [string, string]>);
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(callback: (value: string, key: string, parent: URLSearchParams) => void, thisArg?: unknown): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare class URL {
  constructor(url: string | URL, base?: string | URL);
  static canParse(url: string | URL, base?: string | URL): boolean;
  static parse(url: string | URL, base?: string | URL): URL | null;
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
  toJSON(): string;
}
declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string;
}
declare function atob(data: string): string;
declare function btoa(data: string): string;
`;

/** The newest lib the checker offers, so a modern method is never a false error. */
export const LIB_FILE = 'lib.es2023.d.ts';
/** Errors past this many are noise. */
const MAX_REPORTED_ERRORS = 8;

export interface TypeTestInput {
  code: string;
  rejects?: boolean;
}
export interface TypeCheckResult {
  codeErrors: { line: number; message: string }[];
  typeTests: { pass: boolean; error: string | null }[];
}
export interface TypeScriptChecker {
  check(code: string, typeTests?: TypeTestInput[]): TypeCheckResult;
  toJavaScript(code: string): string;
}

export function createTypeScript({ ts: compiler, libs }: { ts: TypeScriptModule; libs: Record<string, string> }): TypeScriptChecker {
  const parsed = new Map<string, ts.SourceFile | undefined>();
  const target = compiler.ScriptTarget.ES2023;

  const libSource = (fileName: string): ts.SourceFile | undefined => {
    const name = fileName.replace(/^.*\//, '');
    if (!parsed.has(name)) {
      const text = libs[name];
      parsed.set(name, text === undefined ? undefined : compiler.createSourceFile(name, text, target, true));
    }
    return parsed.get(name);
  };

  const options: ts.CompilerOptions = {
    target,
    lib: [LIB_FILE],
    module: compiler.ModuleKind.None,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowUnreachableCode: true,
    allowUnusedLabels: true,
  };

  // The learner and the checker globals remain scripts. Each assertion is a
  // separate module: it can read the learner's declarations while its own
  // helper names stay local. Append the marker so authored line numbers hold.
  const diagnose = (code: string, tests: readonly string[]) => {
    const testNames = tests.map((_, index) => `type-test-${index + 1}.ts`);
    const files = new Map<string, ts.SourceFile>([
      [GLOBALS_FILE, compiler.createSourceFile(GLOBALS_FILE, GLOBALS, target, true)],
      [ANSWER_FILE, compiler.createSourceFile(ANSWER_FILE, code, target, true)],
      ...testNames.map((name, index): [string, ts.SourceFile] => [name, compiler.createSourceFile(name, `${tests[index]}\nexport {};\n`, target, true)]),
    ]);
    const host: ts.CompilerHost = {
      getSourceFile: (name: string) => files.get(name) ?? libSource(name),
      writeFile: () => {},
      getDefaultLibFileName: () => LIB_FILE,
      useCaseSensitiveFileNames: () => true,
      getCanonicalFileName: (name: string) => name,
      getCurrentDirectory: () => '/',
      getNewLine: () => '\n',
      fileExists: (name: string) => files.has(name) || Boolean(libSource(name)),
      readFile: (name: string) => host.getSourceFile(name, target)?.text,
      directoryExists: () => true,
      getDirectories: () => [],
    };
    const program = compiler.createProgram([...files.keys()], options, host);
    const report = (file: ts.SourceFile) => [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].map((diagnostic) => ({
      line: diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
        : 0,
      message: compiler.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    }));
    return { code: report(files.get(ANSWER_FILE)!), tests: testNames.map((name) => report(files.get(name)!)) };
  };

  /** Type-checks `code`, with each type test as its own file beside it: a
   * diagnostic in a test's file belongs to that assertion, and one in the
   * code's file to the code. */
  const check = (code: string, typeTests: TypeTestInput[] = []): TypeCheckResult => {
    const diagnostics = diagnose(code, typeTests.map((one) => one.code));
    const codeErrors = diagnostics.code
      .map((one) => ({ ...one, line: one.line + 1 }))
      .slice(0, MAX_REPORTED_ERRORS);
    const results = typeTests.map((typeTest, index) => {
      const errors = diagnostics.tests[index];
      const rejected = errors.length > 0;
      return { pass: Boolean(typeTest.rejects) === rejected, error: rejected ? errors[0].message : null };
    });
    return { codeErrors, typeTests: results };
  };

  const toJavaScript = (code: string): string => compiler.transpileModule(code, {
    compilerOptions: { target, module: compiler.ModuleKind.None, removeComments: false },
    fileName: ANSWER_FILE,
  }).outputText;

  return { check, toJavaScript };
}

/** True when the types are clean: nothing wrong in the code, every assertion met. */
export const typesPassed = (result: TypeCheckResult | null | undefined): boolean =>
  Boolean(result) && result!.codeErrors.length === 0 && result!.typeTests.every((one) => one.pass);

/** The lib file names the checker needs, for callers that read them from disk. */
export const isCheckerLibFile = (name: string): boolean => /^lib\.(es.*|decorators.*)\.d\.ts$/.test(name);
