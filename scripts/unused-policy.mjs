const BASELINED_KINDS = new Set(['files', 'dependencies', 'devDependencies', 'optionalPeerDependencies', 'unlisted', 'unresolved']);
const SERVER_MODULE = /^(?:lib|shared)\//;

/** Knip 6 reports unused files and symbols under issues, not a top-level files list. */
export function reviewUnused(report, baseline) {
  if (!Array.isArray(report?.issues)) throw new Error('Expected Knip 6 issues array');
  if (!Array.isArray(baseline) || baseline.some(value => typeof value !== 'string' || !value)) {
    throw new Error('Unused baseline must be an array of nonempty finding signatures');
  }
  if (new Set(baseline).size !== baseline.length) throw new Error('Unused baseline contains duplicate signatures');
  const current = new Set();
  const scopedExports = new Set();
  let advisoryExports = 0;
  for (const issue of report.issues) {
    if (typeof issue.file !== 'string') throw new Error('Knip issue has no file');
    for (const [kind, values] of Object.entries(issue)) {
      if (!BASELINED_KINDS.has(kind) && kind !== 'exports') continue;
      if (!Array.isArray(values)) throw new Error(`Knip ${kind} findings must be an array`);
      for (const value of values) {
        const name = typeof value === 'string' ? value : value?.name ?? value?.symbol;
        if (typeof name !== 'string' || !name) throw new Error(`Knip ${kind} finding has no name`);
        const signature = `${issue.file}:${kind}:${name}`;
        if (kind !== 'exports') current.add(signature);
        else if (SERVER_MODULE.test(issue.file)) scopedExports.add(signature);
        else advisoryExports += 1;
      }
    }
  }
  const accepted = new Set(baseline);
  return {
    // Server exports always require removal or a documented public API;
    // adding them to the historical baseline never approves them.
    added: [...current].filter(value => !accepted.has(value)).concat([...scopedExports]).sort(),
    stale: baseline.filter(value => !current.has(value)).sort(),
    existing: [...current].filter(value => accepted.has(value)).length,
    advisoryExports,
  };
}
