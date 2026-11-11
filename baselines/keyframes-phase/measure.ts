#!/usr/bin/env bun
/**
 * Every composition's `keyframes` readings on two grids: the one this tree
 * places (`clockOfFrame`, the last tick of each frame's window) and the one a
 * given revision of `src/anim/timelines.ts` placed. `baselines/keyframes-phase.md`
 * has the numbers.
 *
 *   bun baselines/keyframes-phase/measure.ts [--before <rev>]    (524173f by default)
 *
 * It reads the paks under `dist/`, and builds a composition through
 * `runBuild` only when its pak is missing — both ledgers leave out the ones
 * they exempt, and `keyframes` reads those too. A composition that will not
 * build stops the run rather than drop out of the totals. The earlier
 * revision's module is read out of git into a temporary file whose one
 * relative import is pointed back at this tree.
 *
 * The phase-dependent readings — unsampled instants and part-way steps — are
 * printed before and after. Every other reading is compared as a whole, per
 * timeline and per contention, and a difference stops the run: those depend on
 * the segments alone, and the grid's phase moving them would be a defect.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTimelines, type TimelineReport } from "../../src/anim/timelines.ts";
import { runBuild } from "../../src/cli/build.ts";
import { discoverCompositions } from "../../src/cli/discover.ts";
import { resolveComposition } from "../../src/cli/resolve.ts";
import { TICKS_PER_SECOND } from "../../src/runtime/boot.ts";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const before = flag("--before") ?? "524173f";

const source = await new Response(
  Bun.spawn(["git", "-C", ROOT, "show", `${before}:src/anim/timelines.ts`], { stdout: "pipe" }).stdout,
).text();
if (!source.includes("export async function readTimelines")) {
  console.error(`measure: ${before}:src/anim/timelines.ts is not a readTimelines module`);
  process.exit(2);
}
const oldPath = join(mkdtempSync(join(tmpdir(), "keyframes-phase-")), "timelines.ts");
writeFileSync(oldPath, source.replaceAll(`"../runtime/`, `"${ROOT}/src/runtime/`));
const old = (await import(oldPath)) as { readTimelines: typeof readTimelines };

/** Everything but the two phase-dependent readings, in a form `===` can compare. */
function segmentsOnly(r: TimelineReport): string {
  return JSON.stringify({
    ticksPerFrame: r.ticksPerFrame,
    totalTicks: r.totalTicks,
    bakedCount: r.bakedCount,
    unreferenced: r.unreferenced,
    contended: r.contended,
    timelines: r.timelines.map(({ unsampled: _u, partialCuts: _p, ...rest }) => rest),
  });
}

interface Row {
  dir: string;
  fps: number;
  timelines: number;
  unsampled: [number, number];
  instants: [number, number];
  partialTimelines: [number, number];
  partialCuts: [number, number];
  contended: number;
  jumps: number;
}

const rows: Row[] = [];
const missing: string[] = [];
for (const dir of (await discoverCompositions(ROOT)).dirs) {
  const resolved = await resolveComposition({ dir: join(ROOT, dir), flags: { json: false }, requireBundle: false });
  if (!resolved.ok) {
    missing.push(`${dir} (does not resolve)`);
    continue;
  }
  const c = resolved.value;
  if (!(await Bun.file(c.pakPath).exists())) {
    try {
      await runBuild(c);
    } catch (e) {
      missing.push(`${dir} (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
      continue;
    }
  }
  const inputs = { pakPath: c.pakPath, fps: c.fps, durationFrames: c.durationFrames, tickHz: TICKS_PER_SECOND };
  const now = await readTimelines(inputs);
  const then = await old.readTimelines(inputs);
  if (!now || !then) {
    if (now || then) throw new Error(`${dir}: a style table on one side only`);
    continue;
  }
  if (segmentsOnly(now) !== segmentsOnly(then)) {
    throw new Error(`${dir}: a reading that depends on the segments alone moved with the grid's phase`);
  }
  const count = (r: TimelineReport, pick: (t: TimelineReport["timelines"][number]) => number) =>
    r.timelines.reduce((n, t) => n + pick(t), 0);
  rows.push({
    dir,
    fps: c.fps,
    timelines: now.timelines.length,
    unsampled: [then, now].map((r) => r.timelines.filter((t) => t.unsampled.length > 0).length) as [number, number],
    instants: [then, now].map((r) => count(r, (t) => t.unsampled.length)) as [number, number],
    partialTimelines: [then, now].map((r) => r.timelines.filter((t) => t.partialCuts.length > 0).length) as [number, number],
    partialCuts: [then, now].map((r) => count(r, (t) => t.partialCuts.length)) as [number, number],
    contended: now.contended.length,
    jumps: count(now, (t) => t.shutterJumps.length),
  });
}
if (missing.length > 0) {
  console.error(`measure: ${missing.length} composition(s) not read:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

const pair = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a} → ${b}`);
console.log(`before: ${before}; every reading but the two below is identical on both grids, per timeline`);
console.log("");
console.log("| composition | fps | timeline uses | with an unsampled instant | unsampled instants | with a part-way step | part-way steps | contended | jumps |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const r of rows) {
  console.log(
    `| ${r.dir} | ${r.fps} | ${r.timelines} | ${pair(r.unsampled)} | ${pair(r.instants)} | ${pair(r.partialTimelines)} | ${pair(r.partialCuts)} | ${r.contended} | ${r.jumps} |`,
  );
}
