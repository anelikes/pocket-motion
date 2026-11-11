#!/usr/bin/env bun
/**
 * What the raster reuse (`src/render/reuse.ts`) saves, per composition.
 *
 *   bun baselines/raster-reuse/probe.ts <composition-dir>...
 *
 * Two passes over each built composition, one JSON line each:
 *
 * 1. Per frame, on one world: the time `rasterKey()` takes (the draw walk,
 *    under a shutter every sample's, and the revision read) and the time the
 *    raster takes, and whether the key and the pixels equal the previous
 *    frame's. The two times are means over the frames whose key moved,
 *    frame 0 left out: its walk is the first and does the layout, which the
 *    raster's walk would do if the key's had not. `pixelHolds` counts frames
 *    byte-identical to the last one, which is the most any reuse could skip;
 *    `keyHolds` is how many of them the key sees. A frame whose key held and whose pixels did not would be a
 *    wrong reuse, and is counted as `keyHeldPixelsMoved` — it must be 0.
 * 2. End to end: `render()` without an output (what `trace` runs) with the
 *    reuse on and off, alternating, `--runs` times each; CPU from
 *    `process.cpuUsage()`, wall from `performance.now()`. The two digests
 *    must be equal or the script exits 1.
 *
 * Footage is bound the way `trace` binds it, so a footage composition is
 * measured as it renders: a present re-binds every tile, and it never holds.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openFootage, scratchTree, type FootageHandle } from "../../src/cli/footage.ts";
import { resolveComposition, type ResolvedComposition } from "../../src/cli/resolve.ts";
import { hashFrame } from "../../src/render/hash.ts";
import { render, type RenderOptions } from "../../src/render/render.ts";
import { WasmFrameSource } from "../../src/runtime/frame-source.ts";

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 2;
const dirs = args.filter((a, i) => !a.startsWith("--") && i !== runsAt + 1);

function options(c: ResolvedComposition, bound: { footage: FootageHandle | null }, tree: unknown): RenderOptions {
  const declared = c.sidecar.footage.length > 0;
  return {
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
    width: c.width,
    height: c.height,
    hz: c.fps,
    durationFrames: c.durationFrames,
    renderScale: c.supersample,
    shutter: c.shutter,
    setup: declared
      ? async (source) => {
          await source.seekFrame(0);
          bound.footage = await openFootage(c, source.world, tree);
        }
      : undefined,
    onFrameBoundary: (frame) => bound.footage?.present(frame),
  };
}

let failed = false;
for (const dir of dirs) {
  const r = await resolveComposition({ dir: resolve(dir), flags: { json: false }, requireBundle: true });
  if (!r.ok) throw new Error(`${dir}: ${r.message ?? "does not resolve"}`);
  const c = r.value;
  const tree = c.sidecar.footage.length > 0 ? await scratchTree(c) : null;

  // Pass 1: per frame, on one world.
  const bound = { footage: null as FootageHandle | null };
  const o = options(c, bound, tree);
  const source = await WasmFrameSource.create(o);
  await o.setup?.(source);
  let prevKey: string | null = null;
  let prevPixels: string | null = null;
  let keyHolds = 0, pixelHolds = 0, keyHeldPixelsMoved = 0;
  let keyMs = 0, rasterMsChanged = 0, keyMsChanged = 0, changed = 0;
  for (let f = 0; f < c.durationFrames; f++) {
    o.onFrameBoundary?.(f);
    await source.seekFrame(f);
    const t0 = performance.now();
    const key = source.world.rasterKey();
    const t1 = performance.now();
    const rgba = source.read();
    const t2 = performance.now();
    const pixels = hashFrame(rgba, "fast");
    keyMs += t1 - t0;
    const keyHeld = key === prevKey;
    if (keyHeld) keyHolds++;
    else if (f > 0) {
      // Frame 0's walk is the first, and lays the tree out: whichever of the
      // key and the raster walks first pays for that, so it is no one's cost.
      changed++;
      keyMsChanged += t1 - t0;
      rasterMsChanged += t2 - t1;
    }
    if (pixels === prevPixels) pixelHolds++;
    else if (keyHeld) keyHeldPixelsMoved++;
    prevKey = key;
    prevPixels = pixels;
  }
  await bound.footage?.close();
  await source.dispose();

  // Pass 2: end to end, alternating so drift in machine load lands on both.
  const sample = { on: [] as { cpu: number; wall: number }[], off: [] as { cpu: number; wall: number }[] };
  const digests = new Set<string>();
  let reusedFrames = 0;
  for (let i = 0; i < runs * 2; i++) {
    const reuse = i % 2 === (i >> 1) % 2 ? true : false;
    const b = { footage: null as FootageHandle | null };
    const cpu0 = process.cpuUsage();
    const w0 = performance.now();
    const result = await render({ ...options(c, b, tree), reuse });
    const wall = performance.now() - w0;
    const cpu = process.cpuUsage(cpu0);
    await b.footage?.close();
    digests.add(result.digest);
    if (reuse) reusedFrames = result.reusedFrames;
    (reuse ? sample.on : sample.off).push({ cpu: (cpu.user + cpu.system) / 1e6, wall: wall / 1e3 });
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const line = {
    composition: dir.slice(dir.lastIndexOf("compositions/")),
    frames: c.durationFrames,
    size: `${c.width * c.supersample}x${c.height * c.supersample}`,
    shutter: c.shutter ?? null,
    keyHolds,
    pixelHolds,
    keyHeldPixelsMoved,
    reusedFrames,
    keyMsMean: +(keyMs / c.durationFrames).toFixed(3),
    keyMsOnChanged: +(keyMsChanged / Math.max(changed, 1)).toFixed(3),
    rasterMsOnChanged: +(rasterMsChanged / Math.max(changed, 1)).toFixed(3),
    cpuSecondsOn: +median(sample.on.map((s) => s.cpu)).toFixed(2),
    cpuSecondsOff: +median(sample.off.map((s) => s.cpu)).toFixed(2),
    wallSecondsOn: +median(sample.on.map((s) => s.wall)).toFixed(2),
    wallSecondsOff: +median(sample.off.map((s) => s.wall)).toFixed(2),
    digestsEqual: digests.size === 1,
  };
  console.log(JSON.stringify(line));
  if (digests.size !== 1 || keyHeldPixelsMoved !== 0 || reusedFrames !== keyHolds) failed = true;
}
process.exit(failed ? 1 : 0);
