// Fresh child; imported code gets no provider environment or transport access.
const { performance } = require('node:perf_hooks');
const { writeSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const artifact = process.argv[2];
const approvedMarkers = new Set(JSON.parse(process.argv[3] || '[]'));
let attempts = 0;
const deny = () => { attempts++; throw new Error('network_or_process_denied'); };
for (const [name, methods] of Object.entries({
  'node:http': ['request', 'get'], 'node:https': ['request', 'get'],
  'node:net': ['connect', 'createConnection'], 'node:tls': ['connect'], 'node:http2': ['connect'],
  'node:dgram': ['createSocket'], 'node:dns': ['lookup', 'resolve', 'resolve4', 'resolve6'],
  'node:child_process': ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
})) {
  const mod = require(name);
  for (const method of methods) mod[method] = deny;
}
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) {
  const dns = require('node:dns');
  if (dns[method]) dns[method] = deny;
  if (dns.promises[method]) dns.promises[method] = async () => { deny(); };
  if (dns.Resolver.prototype[method]) dns.Resolver.prototype[method] = deny;
  if (dns.promises.Resolver.prototype[method]) dns.promises.Resolver.prototype[method] = async () => { deny(); };
}
require('node:net').Socket.prototype.connect = deny;
require('node:worker_threads').Worker = class { constructor() { deny(); } };
globalThis.fetch = async () => { deny(); };
globalThis.WebSocket = class { constructor() { deny(); } };
syncBuiltinESMExports();
// Source/provider log text is never copied into the collector's JSON.
let logCalls = 0;
for (const name of ['log', 'warn', 'error', 'info', 'debug']) console[name] = () => { logCalls++; };
const beforeHeap = process.memoryUsage().heapUsed;
const beforeCpu = process.cpuUsage();
const started = performance.now();
let importError = false;
try { require(artifact); } catch { importError = true; }
const importWallMs = performance.now() - started;
const cpu = process.cpuUsage(beforeCpu);
const afterHeap = process.memoryUsage().heapUsed;
const packages = [...new Set(Object.keys(require.cache).map(file => file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(name => name && name !== '.cache'))].sort();
const markers = [...new Set(globalThis.__evaluated || [])].filter(marker => approvedMarkers.has(marker)).sort();
const report = { ok: !importError && attempts === 0, ...(attempts ? { error: 'network_or_process_attempted' } : importError ? { error: 'import_failed' } : {}), pid: process.pid, importWallMs, cpu: { userMicros: cpu.user, systemMicros: cpu.system }, heapBeforeBytes: beforeHeap, heapAfterBytes: afterHeap, heapDeltaBytes: afterHeap - beforeHeap, packages, markers, deniedAttempts: attempts, suppressedLogCalls: logCalls };
writeSync(1, '\n' + JSON.stringify(report) + '\n');
// This deliberately measures synchronous CJS evaluation, not delayed work.
process.exit(0);
