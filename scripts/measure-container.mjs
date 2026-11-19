// Run on one disposable Linux/amd64 CI runner. Image bytes, not context or
// cache bytes, decide the size gate. Neither image is published by this job.
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.env.CONTAINER_BASE_SHA || '0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c';
const output = path.resolve('artifacts/container');
mkdirSync(output, { recursive: true });
const record = { base, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), platform: 'linux/amd64', harness: 'same current source harness against each image runtime packages and generated workers, not baseline handler-code equivalence', complete: false, images: [] };
const command = (name, args, options = {}) => execFileSync(name, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
function logged(name, executable, args) {
  const fd = openSync(path.join(output, `${name}.log`), 'w');
  try { return command(executable, args, { stdio: ['ignore', fd, fd] }); } finally { closeSync(fd); }
}
const temporary = mkdtempSync(path.join(os.tmpdir(), 'devshark-container-before-'));
try {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('CONTAINER_BASE_SHA must be a full published commit.');
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Compare both images on the same Linux/amd64 runner.');
  command('docker', ['info']);
  command('git', ['archive', '--format=tar', '--output', path.join(temporary, 'before.tar'), base]);
  const before = path.join(temporary, 'source'); mkdirSync(before);
  command('tar', ['-xf', path.join(temporary, 'before.tar'), '-C', before]);
  logged('base-image-pull', 'docker', ['pull', '--platform=linux/amd64', 'node:24-bookworm-slim']);
  const nodeBase = JSON.parse(command('docker', ['image', 'inspect', 'node:24-bookworm-slim']))[0];
  record.nodeBase = nodeBase.Id;
  command('node_modules/.bin/esbuild', ['docker/runtime-reference.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external', '--target=node24', `--outfile=${path.join(output, 'runtime-reference.cjs')}`, '--log-level=warning']);
  for (const [name, context] of [['before', before], ['after', process.cwd()]]) {
    const tag = `devshark:f14-${name}`;
    logged(`${name}-build`, 'docker', ['build', '--platform=linux/amd64', '--progress=plain', '-t', tag, context]);
    const image = JSON.parse(command('docker', ['image', 'inspect', tag]))[0];
    if (JSON.stringify(image.RootFS.Layers.slice(0, nodeBase.RootFS.Layers.length)) !== JSON.stringify(nodeBase.RootFS.Layers)) throw new Error('Measured image uses a different Node base layer set.');
    record.images.push({ name, tag, id: image.Id, bytes: image.Size, architecture: image.Architecture, os: image.Os });
    const packageInventory = command('docker', ['run', '--rm', '--entrypoint', 'node', tag, '-e', 'console.log(JSON.stringify({node:process.version,npm:require("node:child_process").execFileSync("npm",["--version"],{encoding:"utf8"}).trim(),typescript:require("typescript/package.json").version,knip:require("node:fs").existsSync("node_modules/knip"),playwright:require("node:fs").existsSync("node_modules/playwright")}))']);
    writeFileSync(path.join(output, `${name}-runtime-packages.json`), packageInventory);
    if (name === 'after') {
      const packages = JSON.parse(packageInventory);
      const locked = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages['node_modules/typescript'].version;
      if (packages.typescript !== locked || packages.knip || packages.playwright) throw new Error('Candidate must retain locked TypeScript and exclude build-only packages.');
    }
    logged(`${name}-references`, 'docker', ['run', '--rm', '--network=none', '--mount', `type=bind,source=${path.join(output, 'runtime-reference.cjs')},target=/app/docker/runtime-reference.cjs,readonly`, '--entrypoint', 'node', tag, '/app/docker/runtime-reference.cjs']);
  }
  logged('image-ls', 'docker', ['image', 'ls', '--no-trunc', '--format', '{{json .}}']);
  record.savedBytes = record.images[0].bytes - record.images[1].bytes;
  if (record.savedBytes <= 0) throw new Error(`Container image did not shrink: ${record.savedBytes} bytes saved.`);
  record.complete = true;
  console.log(`Container images: before ${record.images[0].bytes}, after ${record.images[1].bytes}; saved ${record.savedBytes} bytes.`);
} catch (error) { record.error = error.message; console.error(error.message); process.exitCode = 1; }
finally {
  writeFileSync(path.join(output, 'measurement.json'), JSON.stringify(record, null, 2) + '\n');
  rmSync(temporary, { recursive: true, force: true });
}
