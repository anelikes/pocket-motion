#!/usr/bin/env bun
/**
 * Wall time and CPU of `render` whole and with `--workers N`.
 *
 *   bun baselines/segments/bench.ts <composition-dir>... [--workers 1,2,4,8] [--repeat 1]
 *   bun baselines/segments/bench.ts <composition-dir>... --segments 16
 *
 * `--segments N` is the distributed shape instead: N `render --range`
 * processes run ONE AT A TIME, so each segment's wall and CPU are what it
 * costs on a machine of its own, then `concat` over all of them, timed the
 * same way, and its digest held to a whole render's.
 *
 * Each configuration is the CLI as a child of this process, rendering to an
 * mp4 in a scratch directory. CPU is the child's rusage from `wait4`, user +
 * system, which on macOS includes every descendant it reaped — each worker
 * and each worker's ffmpeg (checked: a grandchild's 5.9 s busy loop came
 * back in the child's figure). The load average is read before and after,
 * because on a shared machine it is half of what a wall time means. Every
 * configuration's digest must equal the first's, or the run fails.
 *
 * Prints one JSON object per run and a markdown table at the end.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const dirs = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const workerCounts = (flag("--workers") ?? "1,2,4,8").split(",").map(Number);
const repeat = Number(flag("--repeat") ?? "1");
const configs: Array<number | null> = [null, ...workerCounts];
const segmentsMode = flag("--segments") === undefined ? null : Number(flag("--segments"));

/** The CLI as a child: wall seconds, CPU seconds (with reaped descendants), and its --json. */
async function timed(args: string[]): Promise<{ wallS: number; cpuS: number; load: [number, number]; json: Record<string, unknown>; stderr: string }> {
  const load0 = loadavg()[0]!;
  const t0 = performance.now();
  const proc = Bun.spawn(["bun", "src/cli/main.ts", ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const wallS = (performance.now() - t0) / 1000;
  const ru = proc.resourceUsage();
  const cpuS = ru ? (Number(ru.cpuTime.user) + Number(ru.cpuTime.system)) / 1e6 : NaN;
  return { wallS, cpuS, load: [+load0.toFixed(1), +loadavg()[0]!.toFixed(1)], json: JSON.parse(stdout || "{}"), stderr };
}

if (segmentsMode !== null) {
  const scratchS = mkdtempSync(join(tmpdir(), "segments-bench-"));
  let bad = false;
  try {
    for (const dir of dirs) {
      const build = Bun.spawnSync(["bun", "src/cli/main.ts", "build", dir], { stdout: "pipe", stderr: "pipe" });
      if (build.exitCode !== 0) throw new Error(`build ${dir}: ${build.stderr.toString()}`);
      const whole = await timed(["render", dir, "--out", join(scratchS, "whole.mp4")]);
      const frames = whole.json.frames as number;
      console.log(JSON.stringify({ dir, whole: true, frames, wallS: +whole.wallS.toFixed(2), cpuS: +whole.cpuS.toFixed(2), load: whole.load }));
      const base = Math.floor(frames / segmentsMode);
      const extra = frames % segmentsMode;
      const parts: string[] = [];
      const rows: Array<{ first: number; last: number; wallS: number; cpuS: number }> = [];
      let at = 0;
      for (let i = 0; i < segmentsMode; i++) {
        const n = base + (i < extra ? 1 : 0);
        const out = join(scratchS, `seg-${i}.mp4`);
        const r = await timed(["render", dir, "--range", `${at}..${at + n - 1}`, "--out", out]);
        if (r.json.ok !== true) throw new Error(`${dir} segment ${i}: ${String(r.json.error ?? r.stderr)}`);
        rows.push({ first: at, last: at + n - 1, wallS: +r.wallS.toFixed(2), cpuS: +r.cpuS.toFixed(2) });
        console.log(JSON.stringify({ dir, segment: i, ...rows.at(-1), load: r.load }));
        parts.push(out);
        at += n;
      }
      const cat = await timed(["concat", dir, ...parts, "--out", join(scratchS, "joined.mp4")]);
      const same = cat.json.digest === whole.json.digest;
      if (!same) bad = true;
      console.log(JSON.stringify({ dir, concat: true, wallS: +cat.wallS.toFixed(2), cpuS: +cat.cpuS.toFixed(2), load: cat.load, digestEqualsWhole: same, error: cat.json.error }));
      const walls = rows.map((r) => r.wallS);
      const cpus = rows.map((r) => r.cpuS);
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      console.log(
        `\n${dir}: whole ${whole.wallS.toFixed(1)} s wall / ${whole.cpuS.toFixed(1)} s CPU; ` +
          `${segmentsMode} segments, each alone: wall ${Math.min(...walls).toFixed(1)}–${Math.max(...walls).toFixed(1)} s ` +
          `(first ${walls[0]!.toFixed(1)}, last ${walls.at(-1)!.toFixed(1)}), CPU ${Math.min(...cpus).toFixed(1)}–${Math.max(...cpus).toFixed(1)} s, ` +
          `sum ${sum(cpus).toFixed(1)} s; concat ${cat.wallS.toFixed(1)} s wall / ${cat.cpuS.toFixed(1)} s CPU; digest ${same ? "equal" : "DIFFERS"}`,
      );
      for (const f of [...parts, ...parts.map((p) => `${p}.segment.json`)]) rmSync(f, { force: true });
    }
  } finally {
    rmSync(scratchS, { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
}

interface Row {
  dir: string;
  workers: number | null;
  run: number;
  frames: number;
  wallS: number;
  cpuS: number;
  load: [number, number];
  digest: string;
}

const scratch = mkdtempSync(join(tmpdir(), "segments-bench-"));
const rows: Row[] = [];
let failed = false;
try {
  for (const dir of dirs) {
    const build = Bun.spawnSync(["bun", "src/cli/main.ts", "build", dir], { stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) throw new Error(`build ${dir}: ${build.stderr.toString()}`);
    for (let run = 0; run < repeat; run++) {
      for (const workers of configs) {
        const out = join(scratch, "film.mp4");
        const load0 = loadavg()[0]!;
        const t0 = performance.now();
        const proc = Bun.spawn(
          ["bun", "src/cli/main.ts", "render", dir, "--out", out, "--json", ...(workers === null ? [] : ["--workers", String(workers)])],
          { stdout: "pipe", stderr: "pipe" },
        );
        const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        const wallS = (performance.now() - t0) / 1000;
        const ru = proc.resourceUsage();
        const cpuS = ru ? (Number(ru.cpuTime.user) + Number(ru.cpuTime.system)) / 1e6 : NaN;
        const json = JSON.parse(stdout || "{}") as { ok?: boolean; digest?: string; frames?: number; error?: string };
        if (json.ok !== true) throw new Error(`${dir} workers=${workers}: ${json.error ?? stderr}`);
        const row: Row = {
          dir, workers, run, frames: json.frames!, wallS: +wallS.toFixed(2), cpuS: +cpuS.toFixed(2),
          load: [+load0.toFixed(1), +loadavg()[0]!.toFixed(1)], digest: json.digest!,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
        rmSync(out, { force: true });
        rmSync(`${out}.sound.json`, { force: true });
      }
    }
    const digests = new Set(rows.filter((r) => r.dir === dir).map((r) => r.digest));
    if (digests.size !== 1) {
      failed = true;
      console.log(`DIGESTS DIFFER for ${dir}: ${[...digests].join(", ")}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("\n| composition | frames | workers | wall s | CPU s | CPU / wall | 1-min load before → after |");
console.log("|---|---:|---|---:|---:|---:|---|");
for (const r of rows) {
  console.log(
    `| ${r.dir} | ${r.frames} | ${r.workers ?? "none (in-process)"} | ${r.wallS.toFixed(1)} | ${r.cpuS.toFixed(1)} | ${(r.cpuS / r.wallS).toFixed(2)} | ${r.load[0]} → ${r.load[1]} |`,
  );
}
process.exit(failed ? 1 : 0);
