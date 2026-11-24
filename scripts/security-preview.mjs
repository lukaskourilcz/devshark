import assert from 'node:assert/strict';
import { validatePreviewOrigin } from './cold-start-preview-access.mjs';

export const PRODUCTION_SUPABASE_REF = 'rvlybcjdpafwyeuojvhl';

export function securityPreviewOptions(args, url) {
  function option(name) {
    const matches = args.filter(arg => arg === name || arg.startsWith(`${name}=`));
    if (!matches.length) return undefined;
    assert(matches.length === 1 && matches[0].startsWith(`${name}=`) && matches[0].length > name.length + 1, `${name} requires one value`);
    return matches[0].slice(name.length + 1);
  }
  const state = option('--preview-state');
  const stage = option('--staging-supabase-ref');
  if (state || stage) validatePreviewOrigin(url);
  if (stage) {
    assert(state, '--staging-supabase-ref requires exact-origin --preview-state');
    assert(/^[a-z0-9]{20}$/.test(stage) && stage !== PRODUCTION_SUPABASE_REF, 'Expected a separate 20-character staging project reference');
    assert(new URL(url).hostname !== 'react-express-app-five.vercel.app', 'Staging cannot replace the production alias policy');
  }
  return { state, stage };
}

// Retain every directive and every other connect-src token byte-for-byte.
export function securityPreviewPolicy(policy, stage) {
  if (!stage) return policy;
  const replaced = [];
  const result = policy.split(';').map(directive => {
    if (!/^\s*connect-src\s/.test(directive)) return directive;
    return directive.replace(/\S+/g, source => {
      for (const scheme of ['https', 'wss']) {
        if (source === `${scheme}://${PRODUCTION_SUPABASE_REF}.supabase.co`) {
          replaced.push(scheme);
          return `${scheme}://${stage}.supabase.co`;
        }
      }
      return source;
    });
  }).join(';');
  assert.deepEqual(replaced.sort(), ['https', 'wss'], 'Expected exactly two project-specific connect-src entries');
  return result;
}
