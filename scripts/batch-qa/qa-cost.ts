#!/usr/bin/env bun
/**
 * Where `verify`'s time goes on one staged variant: each section it runs,
 * called alone, `--repeat` times, with this process's CPU time per call.
 *
 *   bun scripts/batch-qa/variant.ts ... --keep        # leaves dist/bqa-<key>
 *   bun scripts/batch-qa/qa-cost.ts dist/bqa-<key> [--repeat 3]
 *
 * The sections are the same `run()` calls `verify` makes, in its order, with
 * its defaults (24-frame grids for visibility and assert, five layout frames),
 * plus a hash-only render of every frame for scale and a single layout frame
 * at the hold, the cheapest check that reads the layout codes. CPU time rather
 * than wall time, because the machine this was measured on was shared. Every
 * section after the first runs in a warm process; `variant.ts` calls `verify`
 * once in a fresh one, so the batch's own QA times are higher than these.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { render as renderComposition } from "../../src/render/render.ts";
import { resolveComposition } from "../../src/cli/resolve.ts";
import type { GlobalFlags } from "../../src/cli/types.ts";
import * as assertCmd from "../../src/cli/commands/assert.ts";
import * as checkCmd from "../../src/cli/commands/check.ts";
import * as keyframesCmd from "../../src/cli/commands/keyframes.ts";
import * as layoutCmd from "../../src/cli/commands/layout.ts";
import * as lintCmd from "../../src/cli/commands/lint.ts";
import * as verifyCmd from "../../src/cli/commands/verify.ts";
import * as visibilityCmd from "../../src/cli/commands/visibility.ts";
import { sampleFrames } from "../../src/cli/commands/visibility.ts";

const argv = process.argv.slice(2);
const dir = resolve(argv[0] ?? "");
if (!existsSync(join(dir, "pocket-motion.json"))) throw new Error(`qa-cost: ${dir} is not a staged variant`);
const ri = argv.indexOf("--repeat");
const repeat = ri >= 0 ? Number(argv[ri + 1]) : 3;
const flags: GlobalFlags = { json: true, bundle: join(dir, "dist", "main.js"), pak: join(dir, "dist", "main.pak") };
const r = await resolveComposition({ dir, flags, requireBundle: true });
if (!r.ok) throw new Error(r.message);
const c = r.value;
const layoutFrames = sampleFrames(c.durationFrames, verifyCmd.DEFAULT_LAYOUT_SAMPLES);

const sections: Array<[string, () => Promise<unknown>]> = [
  ["render (hash only)", () =>
    renderComposition({
      compositionId: c.compositionId, bundlePath: c.bundlePath, pakPath: c.pakPath, width: c.width,
      height: c.height, hz: c.fps, durationFrames: c.durationFrames, renderScale: c.supersample,
      shutter: c.shutter, buildCommand: c.buildCommand,
    })],
  ["lint", () => lintCmd.run({ dir, flags })],
  ["realm (check)", () => checkCmd.run({ dir, flags })],
  ["keyframes", () => keyframesCmd.run({ dir, flags, all: false })],
  ["visibility (24)", () => visibilityCmd.run({ dir, all: false, flags })],
  // The cheap tier the report weighs against the sweep: one layout frame at
  // the hold, whose findings carry every gated code this template produced.
  [`layout x1 (frame ${c.durationFrames - 1})`, () => layoutCmd.run({ dir, at: c.durationFrames - 1, all: false, flags })],
  [`layout x${layoutFrames.length}`, async () => {
    for (const at of layoutFrames) await layoutCmd.run({ dir, at, all: false, flags });
  }],
  ["assert (24)", () => assertCmd.run({ dir, flags })],
  ["verify (lint ... assert)", () => verifyCmd.run({ dir, strict: false, flags })],
];

const rows: Array<{ section: string; cpuMs: number[] }> = [];
for (const [name, f] of sections) {
  const cpuMs: number[] = [];
  for (let i = 0; i < repeat; i++) {
    const c0 = process.cpuUsage();
    await f();
    const u = process.cpuUsage(c0);
    cpuMs.push(Math.round((u.user + u.system) / 1000));
  }
  rows.push({ section: name, cpuMs });
  console.error(`qa-cost: ${name.padEnd(28)} ${cpuMs.join(" ")} ms`);
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
console.log(JSON.stringify({ dir, repeat, layoutFrames, sections: rows.map((s) => ({ ...s, medianMs: median(s.cpuMs) })) }, null, 2));
