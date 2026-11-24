/** The TypeScript checker for the server and node tests: the compiler and its
 * lib files come off the disk. vercel.json includes the lib files in the
 * function bundle, since nothing imports them statically. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type * as TS from 'typescript';
import { createTypeScript, isCheckerLibFile, type TypeScriptChecker } from '../../shared/coding-ts-check';

/** The compiler, loaded when the first in-thread checker is built. On a
 * deployment the checks run on their worker thread, so the request thread that
 * imports this module through ts-check-pool.ts never needs it there; loading it
 * at import cost every instance of the roadmap, user and settings functions
 * about 90 ms (#587, server item 16). Loaded synchronously, inside the call
 * that builds the checker, so the check runs on the same stack as before.
 *
 * @vercel/node compiles this file to CommonJS, where the plain
 * `require('typescript')` is what its file tracer follows. Scripts bundled as
 * ESM have no real `require` (esbuild's stand-in has no `resolve`), so they
 * load it from the working directory. */
function loadTypeScript(): typeof TS {
  return typeof require === 'function' && typeof require.resolve === 'function'
    ? require('typescript') as typeof TS
    : createRequire(path.join(process.cwd(), 'package.json'))('typescript') as typeof TS;
}

let checker: TypeScriptChecker | null = null;

/**
 * Where TypeScript's `lib.*.d.ts` files live.
 *
 * `require.resolve` is the right answer in the CommonJS serverless bundle. It
 * is not available when this module is bundled into an ESM test script, where
 * esbuild replaces `require` with a shim that has no `resolve`, so fall back to
 * walking up from the working directory. Both paths land on the same files;
 * the fallback exists so the content tests can use the real checker rather than
 * building a second one that could drift from it.
 */
function typescriptLibDir(): string {
  const resolver = (globalThis as { require?: { resolve?: (id: string) => string } }).require ??
    (typeof require !== 'undefined' ? (require as unknown as { resolve?: (id: string) => string }) : undefined);
  if (typeof resolver?.resolve === 'function') {
    try {
      return path.join(path.dirname(resolver.resolve('typescript/package.json')), 'lib');
    } catch {
      // Fall through to the directory walk.
    }
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'node_modules', 'typescript', 'lib');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('typescript_lib_not_found');
}

/** `code` as JavaScript, or null when the compiler could not transpile it.
 * Deeply nested code (a thousand nested arrows, calls or blocks) overflows
 * the compiler's stack with a RangeError. */
export function transpileOrNull(checker: TypeScriptChecker, code: string): string | null {
  try {
    return checker.toJavaScript(code);
  } catch {
    return null;
  }
}

export function nodeTypeScriptChecker(): TypeScriptChecker {
  if (checker) return checker;
  const libDir = typescriptLibDir();
  const files = readdirSync(libDir);
  const checkerFiles = files.filter(isCheckerLibFile);
  if (process.env.VERCEL_ENV === 'preview' && process.env.DEVSHARK_AUDIT_TS_FILES === '1') {
    const shipped = files.filter(name => /^lib\..+\.d\.ts$/.test(name)).sort();
    console.log(JSON.stringify({
      route: 'coding/typescript', kind: 'preview_declaration_inventory',
      shipped: shipped.length, used: checkerFiles.length,
      names_sha256: createHash('sha256').update(shipped.join('\n')).digest('hex'),
    }));
  }
  const libs = Object.fromEntries(
    checkerFiles.map((name) => [name, readFileSync(path.join(libDir, name), 'utf8')]),
  );
  checker = createTypeScript({ ts: loadTypeScript(), libs });
  return checker;
}
