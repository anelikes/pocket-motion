/**
 * `image-filter-trilinear` (patches/0064), from the class literal to the
 * picture.
 *
 * The reduction, the footprint, the level pick, the blend and the op a
 * trilinear image emits are held in the patch's own tests
 * (`engine/core/src/mip.rs`, `raster.rs`, `tests.rs`). What this file holds is
 * what those cannot see: that `compositions/image-wall`, built — generator,
 * class literal, compiler, pak, wasm — holds still as it is pushed in, where
 * the same wall without the class shimmers. It is red with the class taken
 * out of `gen.ts`'s `source()`.
 *
 * Both readings are the frames' own, over the first 30 frames of the push:
 * the mean absolute change per channel from one frame to the next, and the
 * share of pixels whose largest channel moves more than 32 levels. The push
 * moves the wall's edge under half a pixel a frame there, so what moves more
 * is the resampler. Pixels are deterministic, so these are exact; the bounds
 * sit between the two measured values (`baselines/image-wall.md` has the
 * whole film, every filter and a supersampled reference).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { stageVariant } from "../compositions/image-wall/gen.ts";
import { runBuild } from "../src/cli/build.ts";
import { runGenerator } from "../src/cli/generators.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { WasmFrameSource } from "../src/runtime/frame-source.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "compositions", "image-wall");
const FRAMES = 30;

async function open(dir: string): Promise<WasmFrameSource> {
  const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error(`${dir} did not resolve`);
  const c = resolved.value;
  await runBuild(c);
  return WasmFrameSource.create({
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: c.pakPath,
    width: c.width,
    height: c.height,
    hz: c.fps,
    durationFrames: c.durationFrames,
    renderScale: c.supersample,
    shutter: null,
    buildCommand: c.buildCommand,
  });
}

/** Mean |Δ| per channel (/255) and the share of pixels moving more than 32, per frame pair. */
async function frameToFrame(source: WasmFrameSource): Promise<{ mean: number; flicker: number }> {
  let prev: Uint8Array | undefined;
  let mean = 0;
  let flicker = 0;
  for (let f = 0; f < FRAMES; f++) {
    await source.seekFrame(f);
    const cur = source.read().slice();
    if (prev) {
      let sum = 0;
      let moved = 0;
      for (let i = 0; i < cur.length; i += 4) {
        const dr = Math.abs(cur[i]! - prev[i]!), dg = Math.abs(cur[i + 1]! - prev[i + 1]!), db = Math.abs(cur[i + 2]! - prev[i + 2]!);
        sum += dr + dg + db;
        if (Math.max(dr, dg, db) > 32) moved++;
      }
      const px = cur.length / 4;
      mean += sum / (px * 3);
      flicker += moved / px;
    }
    prev = cur;
  }
  return { mean: mean / (FRAMES - 1), flicker: flicker / (FRAMES - 1) };
}

describe("compositions/image-wall", () => {
  let wall: WasmFrameSource;
  let nearest: WasmFrameSource;
  let bilinear: WasmFrameSource;
  const disposals: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    await runGenerator(ROOT, "compositions/image-wall");
    wall = await open(DIR);
    const n = await stageVariant("test-nearest", { filter: "", linear: false });
    disposals.push(n.dispose);
    nearest = await open(n.dir);
    const b = await stageVariant("test-bilinear", { filter: "", linear: true });
    disposals.push(b.dispose);
    bilinear = await open(b.dir);
  }, 300_000);

  afterAll(async () => {
    for (const s of [wall, nearest, bilinear]) await s?.dispose();
    for (const dispose of disposals) await dispose();
  });

  test("the wall pushed in holds still where the same wall nearest or bilinear shimmers", async () => {
    const got = {
      trilinear: await frameToFrame(wall),
      nearest: await frameToFrame(nearest),
      bilinear: await frameToFrame(bilinear),
    };
    expect(got.trilinear.mean).toBeLessThan(BOUND.mean);
    expect(got.nearest.mean).toBeGreaterThan(BOUND.mean);
    expect(got.bilinear.mean).toBeGreaterThan(BOUND.mean);
    expect(got.trilinear.flicker).toBeLessThan(BOUND.flicker);
    expect(got.nearest.flicker).toBeGreaterThan(BOUND.flicker);
    expect(got.bilinear.flicker).toBeGreaterThan(BOUND.flicker);
  }, 300_000);
});

/**
 * Between the measured values. When written: mean |Δ| 2.06 trilinear, 5.36
 * nearest, 5.12 bilinear; flicker 2.64%, 4.70%, 5.57%.
 */
const BOUND = { mean: 3.5, flicker: 0.036 };
