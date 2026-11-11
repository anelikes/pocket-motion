#!/usr/bin/env bun
/**
 * CPU per rendered video: the `render` command run as a person runs it, once
 * per configuration, interleaved.
 *
 *   bun baselines/encode-cost/end-to-end.ts <composition-dir> --work <dir> [--runs N]
 *
 * Each run spawns `bun src/cli/main.ts render <dir> --out … --json` with the
 * configuration's flags and reads the child's rusage when it exits. That is
 * wait4's, which on macOS includes every descendant the child waited for, so
 * it is Bun and its ffmpeg together: measured, a `sh -c` whose background
 * child spun for the run reports that child's CPU. Wall is spawn to exit.
 * Runs go round-robin over the configurations, so drift in machine load
 * lands on all of them. Medians of `--runs` (default 3). Every run's digest
 * must be the same, or the script exits 1.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = resolve(argv[0]!);
const work = resolve(flag("work") ?? "baselines/encode-cost/raw");
const runs = Number(flag("runs") ?? 3);
mkdirSync(work, { recursive: true });
const ROOT = resolve(import.meta.dir, "../..");

const configs: { name: string; flags: string[] }[] = [
  { name: "default (libx264 medium, reuse on)", flags: [] },
  { name: "--no-reuse", flags: ["--no-reuse"] },
  { name: "--preset faster", flags: ["--preset", "faster"] },
  { name: "--preset veryfast", flags: ["--preset", "veryfast"] },
  { name: "--encoder h264_videotoolbox", flags: ["--encoder", "h264_videotoolbox"] },
];

const samples = new Map<string, { cpu: number; wall: number; reused: number; bytes: number }[]>();
const digests = new Set<string>();
for (let r = 0; r < runs; r++) {
  for (const config of configs) {
    const out = join(work, `${config.name.replace(/[^a-z0-9]+/gi, "-")}.mp4`);
    const t0 = performance.now();
    const proc = Bun.spawn(["bun", "src/cli/main.ts", "render", dir, "--out", out, "--json", ...config.flags], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [text, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const wall = (performance.now() - t0) / 1e3;
    if (code !== 0) throw new Error(`${config.name}: exit ${code}\n${err}`);
    const json = JSON.parse(text) as { digest: string; reusedFrames: number };
    digests.add(json.digest);
    const cpu = Number(proc.resourceUsage()!.cpuTime.total) / 1e6;
    const bytes = Bun.file(out).size;
    const list = samples.get(config.name) ?? [];
    list.push({ cpu, wall, reused: json.reusedFrames, bytes });
    samples.set(config.name, list);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
for (const config of configs) {
  const list = samples.get(config.name)!;
  console.log(
    JSON.stringify({
      composition: dir.slice(dir.lastIndexOf("compositions/")),
      config: config.name,
      runs: list.length,
      cpu: +median(list.map((s) => s.cpu)).toFixed(2),
      cpuAll: list.map((s) => +s.cpu.toFixed(2)),
      wall: +median(list.map((s) => s.wall)).toFixed(2),
      reusedFrames: list[0]!.reused,
      bytes: list[0]!.bytes,
    }),
  );
}
if (digests.size !== 1) {
  console.error(`digests differ across runs: ${[...digests].join(", ")}`);
  process.exit(1);
}
