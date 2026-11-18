// Turns several outputs of supabase/bench/explain.sql into one table: the
// median execution time of each read, the spread, and the pages it touched
// (the shared buffers of the plan's top node, hit plus read).
//
//   node supabase/bench/medians.mjs run-1.txt run-2.txt … run-7.txt
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node supabase/bench/medians.mjs <explain.sql output> …');
  process.exit(2);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const pages = (text) => [...text.matchAll(/(?:hit|read)=(\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);

const reads = new Map();
for (const file of files) {
  let current = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = /^### (\d+) (.*)$/.exec(line);
    if (heading) {
      current = { id: heading[1], buffers: null, planned: false };
      if (!reads.has(current.id)) reads.set(current.id, { title: heading[2], times: [], pages: [] });
      continue;
    }
    if (!current) continue;
    // Planning buffers come after the plan; a top node without a Buffers
    // line touched no page.
    if (/^\s*Planning( Time)?:/.test(line)) current.planned = true;
    const buffers = /^\s*Buffers: (shared .*)$/.exec(line);
    if (buffers && current.buffers === null && !current.planned) current.buffers = buffers[1];
    const time = /Execution Time: ([\d.]+) ms/.exec(line);
    if (time) {
      const read = reads.get(current.id);
      read.times.push(Number(time[1]));
      read.pages.push(current.buffers ? pages(current.buffers) : 0);
      current = null;
    }
  }
}

const format = (ms) => (ms >= 10 ? ms.toFixed(1) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(3));
console.log(`| # | Read | Median ms | Min to max ms | Pages | Runs |`);
console.log(`|---|---|---:|---:|---:|---:|`);
let short = 0;
for (const [id, read] of [...reads].sort(([a], [b]) => Number(a) - Number(b))) {
  if (read.times.length !== files.length) short += 1;
  const spread = `${format(Math.min(...read.times))} to ${format(Math.max(...read.times))}`;
  console.log(`| ${id} | ${read.title} | ${format(median(read.times))} | ${spread} | ${median(read.pages)} | ${read.times.length} |`);
}
if (short) {
  console.error(`${short} read(s) have fewer timings than the ${files.length} files given; check the outputs for errors.`);
  process.exit(1);
}
