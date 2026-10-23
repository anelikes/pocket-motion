#!/usr/bin/env bun
/**
 * Tables for docs/render-cost-benchmark.md from the raw results.
 *
 *   bun summarize.ts <results dir>
 *
 * Reads runs.jsonl (measure.ts), workerd.jsonl (workerd.sh) and
 * core-bench.jsonl (core-bench.ts) and prints markdown: per configuration,
 * the median and the range over repetitions of wall time, CPU time and peak
 * tree RSS, the per-frame figures derived from them, and the load average the
 * runs were taken at. Nothing here is measured; it only arranges what was.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2]!;
const lines = (f: string) =>
  existsSync(join(dir, f))
    ? readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).flatMap((l) => {
          // Two early startup lines were written as `:.534` and `:,`; the
          // first is repaired, the second skipped. Nothing else is touched.
          try { return [JSON.parse(l.replace(/:\./g, ":0."))]; } catch { return []; }
        })
    : [];
// Records from before the sampler kept each pid's largest CPU reading (no
// `sampler` field) undercount Chrome, whose processes are caught exiting with
// a CPU time of 0; they are dropped for the two browser renderers. A
// pocket-motion run's CPU comes from wait4, which covers Bun and its ffmpeg,
// so those records stand.
const runs = lines("runs.jsonl").filter(
  (r) => r.exitCode === 0 && (r.sampler >= 2 || r.label.startsWith("pm.")),
);
const failed = lines("runs.jsonl").filter((r) => r.exitCode !== 0);
const wk = lines("workerd.jsonl");
const core = lines("core-bench.jsonl");

const FRAMES = 300;
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const range = (xs: number[], d = 1) =>
  xs.length > 1 ? ` (${Math.min(...xs).toFixed(d)}–${Math.max(...xs).toFixed(d)})` : "";
const mib = (b: number) => b / 2 ** 20;

const labels = [...new Set(runs.map((r) => r.label as string))];
console.log("### Every configuration (median of n, range in brackets)\n");
console.log("| configuration | n | wall s | CPU s | peak tree RSS MiB | peak process | load (1 min) |");
console.log("|---|---:|---:|---:|---:|---|---:|");
for (const l of labels) {
  const rs = runs.filter((r) => r.label === l);
  const wall = rs.map((r) => r.wallMs / 1000);
  const cpu = rs.map((r) => r.cpuSeconds);
  const rss = rs.map((r) => mib(r.peakTreeRssBytes));
  const load = rs.map((r) => (r.loadBefore[0] + r.loadAfter[0]) / 2);
  const proc = med(rs.map((r) => mib(r.peakProcRssBytes)));
  console.log(
    `| ${l} | ${rs.length} | ${med(wall).toFixed(2)}${range(wall, 2)} | ${med(cpu).toFixed(2)}${range(cpu, 2)} | ` +
      `${med(rss).toFixed(0)}${range(rss, 0)} | ${proc.toFixed(0)} MiB ${rs[0].peakProcComm} | ${med(load).toFixed(1)}${range(load, 1)} |`,
  );
}
if (failed.length) {
  console.log(`\nFailed runs: ${failed.map((r) => `${r.label} (exit ${r.exitCode})`).join(", ")}`);
}

// Per-frame: amortised (whole render / 300) and marginal (render minus the
// renderer's own first-frame run, over the 299 frames after it).
const pairs: Array<[string, string, string, number?]> = [
  ["pocket-motion", "pm.render.none", "pm.first-frame"],
  ["pocket-motion, shutter 4", "pm.render.s4", "pm.first-frame"],
  ["pocket-motion, shutter 12", "pm.render.s12", "pm.first-frame"],
  ["Remotion, concurrency 1", "rm.render.c1", "rm.first-frame"],
  ["Remotion, concurrency 1, swangle, frames 0-29", "rm.render.c1.swangle.30f", "rm.first-frame", 30],
  ["Remotion, concurrency 5", "rm.render.c5", "rm.first-frame"],
  ["HyperFrames, 1 worker", "hf.render.w1", "hf.first-frame"],
  ["HyperFrames, 1 worker, software GL", "hf.render.w1.sw", "hf.first-frame"],
  ["HyperFrames, auto workers", "hf.render.auto", "hf.first-frame"],
];
console.log("\n### Per frame (from the medians above)\n");
console.log("| renderer | wall ms/frame amortised | wall ms/frame marginal | CPU ms/frame amortised | CPU ms/frame marginal | CPU s per 300 frames |");
console.log("|---|---:|---:|---:|---:|---:|");
for (const [name, full, first, n = FRAMES] of pairs) {
  const f = runs.filter((r) => r.label === full);
  const c = runs.filter((r) => r.label === first);
  if (!f.length || !c.length) continue;
  const fw = med(f.map((r) => r.wallMs));
  const cw = med(c.map((r) => r.wallMs));
  const fc = med(f.map((r) => r.cpuSeconds * 1000));
  const cc = med(c.map((r) => r.cpuSeconds * 1000));
  console.log(
    `| ${name} | ${(fw / n).toFixed(1)} | ${((fw - cw) / (n - 1)).toFixed(1)} | ${(fc / n).toFixed(1)} | ` +
      `${((fc - cc) / (n - 1)).toFixed(1)} | ${((fc / n) * FRAMES / 1000).toFixed(1)}${n !== FRAMES ? " (x300/" + n + ")" : ""} |`,
  );
}

// CPU split by process name for the full renders.
console.log("\n### Where the CPU went (median CPU s by process name, full renders)\n");
for (const [name, full] of pairs) {
  const f = runs.filter((r) => r.label === full);
  if (!f.length) continue;
  // `ps` lists an exiting process as `(name)`; older records kept that form.
  const byName = (r: { cpuByComm: Record<string, number> }) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.cpuByComm)) {
      const n = k.replace(/^\((.*)\)$/, "$1");
      out[n] = (out[n] ?? 0) + v;
    }
    return out;
  };
  const split = f.map(byName);
  const names = new Set(split.flatMap((r) => Object.keys(r)));
  const parts: string[] = [];
  for (const n of names) {
    const v = med(split.map((r) => r[n] ?? 0));
    if (v >= 0.1) parts.push(`${n} ${v.toFixed(1)}`);
  }
  console.log(`- ${name}: ${parts.join(", ")}`);
}

if (wk.length) {
  console.log("\n### workerd (median of n, range in brackets)\n");
  console.log("| variant | request | n | wall s | workerd CPU s | wasm memory MiB | workerd RSS MiB | digest |");
  console.log("|---|---|---:|---:|---:|---:|---:|---|");
  const keys = [...new Set(wk.map((r) => `${r.variant ?? "static"}|${r.query}`))];
  for (const k of keys) {
    const [variant, query] = k.split("|");
    const rs = wk.filter((r) => `${r.variant ?? "static"}|${r.query}` === k);
    const wall = rs.map((r) => r.wallSeconds);
    const cpu = rs.map((r) => r.workerdCpuSeconds).filter((x) => x !== undefined);
    const mem = rs.map((r) => r.wasmMemoryBytes).filter(Boolean).map(mib);
    const rss = rs.map((r) => mib(r.workerdRssBytes));
    const digests = [...new Set(rs.map((r) => r.digest).filter(Boolean))].map((d) => d.slice(0, 8));
    console.log(
      `| ${variant} | ${query} | ${rs.length} | ${med(wall).toFixed(2)}${range(wall, 2)} | ` +
        `${cpu.length ? med(cpu).toFixed(2) + range(cpu, 2) : "—"} | ${mem.length ? med(mem).toFixed(1) : "—"} | ` +
        `${med(rss).toFixed(0)} | ${digests.join(", ") || "—"} |`,
    );
  }
}

const deflated = wk.filter((r) => r.deflatedBytes);
if (deflated.length) {
  const d = med(deflated.map((r) => r.deflatedBytes));
  const raw = deflated[0].rawBytes;
  console.log(
    `\nDeflated in the Worker (deflate-raw, ${deflated.length} run(s)): ${(d / 2 ** 20).toFixed(1)} MiB for 300 frames ` +
      `against ${(raw / 2 ** 30).toFixed(2)} GiB raw (${((d / raw) * 100).toFixed(2)} %), ${(d / 300 / 1024).toFixed(0)} KiB a frame.`,
  );
}

if (core.length) {
  console.log("\n### pocket-motion core, per frame (core-bench.ts, one run each)\n");
  console.log("| variant | scale | frames | boot ms | fold ms (median) | raster ms (median) | SHA-256 ms (median) | wasm memory MiB |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of core) {
    console.log(
      `| ${r.samples ? `shutter ${r.samples}` : "no shutter"} | ${r.scale ?? 1} | ${r.frames} | ${r.bootMs} | ${r.foldMsMedian} | ` +
        `${r.rasterMsMedian} | ${r.hashMsMedian} | ${mib(r.wasmMemoryBytes).toFixed(1)} |`,
    );
  }
}
