#!/usr/bin/env bun
/**
 * Wall time and CPU of `render` whole and with `--workers N`.
 *
 *   bun baselines/segments/bench.ts <composition-dir>... [--workers 1,2,4,8] [--repeat 1]
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
