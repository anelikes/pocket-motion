#!/usr/bin/env bun
/**
 * Run one command and measure it as a process TREE.
 *
 *   bun measure.ts --label <name> --out <results.jsonl> [--cwd <dir>] [--env K=V ...] -- <argv...>
 *
 * A browser renderer is a dozen processes (node, Chrome, its GPU and renderer
 * helpers, ffmpeg), so the numbers of the one process the shell started say
 * little. Every 100 ms this reads `ps` for every process and keeps the
 * descendants of the spawned one:
 *
 *   peakTreeRssBytes   the largest SUM of RSS over the tree seen at one sample.
 *                      Shared pages (Chrome's frameworks) are counted once per
 *                      process, so this overstates what the tree needs; it is
 *                      what a container's memory limit is tested against far
 *                      more closely than any one process's peak.
 *   peakProcRssBytes   the largest RSS of any one process in the tree.
 *   treeCpuSeconds     per pid, the LARGEST cumulative CPU time `ps` reported,
 *                      summed. Largest, not last: a process caught exiting is
 *                      listed as `(name)` with a CPU time of 0, and keeping
 *                      the last reading turned Chrome's whole render into
 *                      0.11 s. A process that lived less than one sample is
 *                      missed, and one that ran on after its last sample is
 *                      undercounted by at most one interval of its CPU.
 *   rusageCpuSeconds   user + system from wait4 on the spawned process, which
 *                      includes every descendant that was waited for. Chrome
 *                      helpers killed by their parent are reaped and counted;
 *                      daemons that detach are not. The larger of the two is
 *                      the honest one, and both are recorded.
 *
 * Load average is read before and after, because this machine is shared and a
 * wall time measured at load 40 is not one measured at load 4. CPU time moves
 * far less with load than wall time does, which is why it is the column the
 * cost estimate uses.
 */

import { appendFileSync } from "node:fs";
import { loadavg } from "node:os";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
if (sep < 0) throw new Error("usage: measure.ts --label L --out F [--cwd D] [--env K=V] -- argv...");
const opts = args.slice(0, sep);
const argv = args.slice(sep + 1);
const flag = (name: string) => {
  const i = opts.indexOf(`--${name}`);
  return i >= 0 ? opts[i + 1] : undefined;
};
const label = flag("label") ?? argv.join(" ");
const out = flag("out");
const cwd = flag("cwd") ?? process.cwd();
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
for (let i = 0; i < opts.length; i++) {
  if (opts[i] === "--env") {
    const [k, ...v] = opts[i + 1]!.split("=");
    env[k!] = v.join("=");
  }
}

/** `[[dd-]hh:]mm:ss.cc` from `ps -o time` to seconds. */
function cpuSeconds(s: string): number {
  let days = 0;
  let rest = s;
  const dash = rest.indexOf("-");
  if (dash >= 0) {
    days = Number(rest.slice(0, dash));
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(":").map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return days * 86400 + secs;
}

interface Row { pid: number; ppid: number; rssKb: number; cpu: number; comm: string }

async function snapshot(): Promise<Row[]> {
  const p = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,rss=,time=,comm="], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(p.stdout).text();
  await p.exited;
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: +m[1]!, ppid: +m[2]!, rssKb: +m[3]!, cpu: cpuSeconds(m[4]!), comm: m[5]! });
  }
  return rows;
}

function descendants(rows: Row[], root: number): Row[] {
  const kids = new Map<number, Row[]>();
  for (const r of rows) {
    const list = kids.get(r.ppid) ?? [];
    list.push(r);
    kids.set(r.ppid, list);
  }
  const outRows: Row[] = [];
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop()!;
    const self = rows.find((r) => r.pid === pid);
    if (self) outRows.push(self);
    for (const k of kids.get(pid) ?? []) stack.push(k.pid);
  }
  return outRows;
}

const loadBefore = loadavg();
const started = performance.now();
const child = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe" });
const stdoutP = new Response(child.stdout).text();
const stderrP = new Response(child.stderr).text();

let peakTreeRss = 0;
let peakProcRss = 0;
let peakProcComm = "";
let peakProcs = 0;
const lastCpu = new Map<number, { cpu: number; comm: string }>();
let done = false;
const sampler = (async () => {
  while (!done) {
    const rows = await snapshot();
    const tree = descendants(rows, child.pid);
    let sum = 0;
    for (const r of tree) {
      sum += r.rssKb * 1024;
      const comm = r.comm.replace(/^\((.*)\)$/, "$1");
      if (r.rssKb * 1024 > peakProcRss) {
        peakProcRss = r.rssKb * 1024;
        peakProcComm = comm;
      }
      const seen = lastCpu.get(r.pid);
      if (!seen || r.cpu > seen.cpu) lastCpu.set(r.pid, { cpu: r.cpu, comm });
    }
    peakTreeRss = Math.max(peakTreeRss, sum);
    peakProcs = Math.max(peakProcs, tree.length);
    await Bun.sleep(100);
  }
})();

const exitCode = await child.exited;
const wallMs = performance.now() - started;
done = true;
await sampler;
const usage = child.resourceUsage();
const stdout = await stdoutP;
const stderr = await stderrP;
const loadAfter = loadavg();

const byComm: Record<string, number> = {};
let treeCpu = 0;
for (const { cpu, comm } of lastCpu.values()) {
  treeCpu += cpu;
  const key = comm.split("/").pop()!;
  byComm[key] = (byComm[key] ?? 0) + cpu;
}
const rusageCpu = usage
  ? Number(usage.cpuTime.user + usage.cpuTime.system) / 1e6
  : NaN;

const record = {
  label,
  sampler: 2,
  argv,
  cwd,
  exitCode,
  wallMs: Math.round(wallMs),
  treeCpuSeconds: +treeCpu.toFixed(2),
  rusageCpuSeconds: +rusageCpu.toFixed(2),
  cpuSeconds: +Math.max(treeCpu, rusageCpu).toFixed(2),
  peakTreeRssBytes: peakTreeRss,
  peakProcRssBytes: peakProcRss,
  peakProcComm: peakProcComm.split("/").pop(),
  rusageMaxRssBytes: usage?.maxRSS ?? null,
  peakProcs,
  cpuByComm: Object.fromEntries(Object.entries(byComm).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(2)])),
  loadBefore: loadBefore.map((x) => +x.toFixed(2)),
  loadAfter: loadAfter.map((x) => +x.toFixed(2)),
  at: new Date().toISOString(),
  stdoutTail: stdout.split("\n").filter(Boolean).slice(-6),
  stderrTail: stderr.split("\n").filter(Boolean).slice(-6),
};
if (out) appendFileSync(out, JSON.stringify(record) + "\n");
console.log(
  `${label}: exit ${exitCode} wall ${(wallMs / 1000).toFixed(2)} s cpu ${record.cpuSeconds} s ` +
    `(tree ${record.treeCpuSeconds}, rusage ${record.rusageCpuSeconds}) peak tree RSS ${(peakTreeRss / 2 ** 20).toFixed(0)} MiB ` +
    `load ${loadBefore[0]!.toFixed(1)}->${loadAfter[0]!.toFixed(1)}`,
);
if (exitCode !== 0) {
  console.log(stderr.split("\n").slice(-20).join("\n"));
  process.exit(exitCode);
}
