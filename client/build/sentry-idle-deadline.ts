import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

const MODULE = '/@sentry/core/build/esm/tracing/idleSpan.js';
const SHA256 = '026cdbeed06f45899b1d8996abaaa64754c98b946296e2e666afad0dbd08e1fe';

/** Sentry 10.59.0 schedules a 30s deadline per idle span. Once _finished
 * becomes true, its entire callback is a no-op. Cancel that exact timer
 * on the same transition. An active span retains the original deadline.
 * Recheck the upstream implementation when updating @sentry/core. */
export function patchSentryDeadline(code: string, file: string): MagicString {
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== SHA256) {
    throw new Error('Sentry idleSpan.js changed. Review the upstream final timer cleanup before updating the pinned transform.');
  }
  const output = new MagicString(code);
  for (const [needle, replacement] of [
    ['let _finished = false;', 'let _finished = false;\n  let _finalTimeoutID;'],
    ['_finished = true;', '_finished = true;\n    clearTimeout(_finalTimeoutID);'],
    ['  setTimeout(() => {\n    if (!_finished)', '  _finalTimeoutID = setTimeout(() => {\n    if (!_finished)'],
  ]) {
    const position = code.indexOf(needle);
    if (position < 0 || position !== code.lastIndexOf(needle)) {
      throw new Error('Unexpected Sentry idle-span timer implementation.');
    }
    output.overwrite(position, position + needle.length, replacement);
  }
  return output;
}

export function sentryIdleDeadline(tracingConfigured: boolean): Plugin {
  let applied = false;
  return {
    name: 'sentry-idle-span-deadline-cleanup',
    apply: 'build',
    enforce: 'pre',
    buildStart() { applied = false; },
    transform(code, id) {
      if (!id.split('\\').join('/').endsWith(MODULE)) return;
      const updated = patchSentryDeadline(code, id);
      applied = true;
      return { code: updated.toString(), map: updated.generateMap({ hires: true, source: id, includeContent: true }).toString() };
    },
    buildEnd(error) {
      if (!error && tracingConfigured && !applied) this.error('The Sentry idle-span module was not visited. Review its version, module path and deadline cleanup.');
    },
  };
}
