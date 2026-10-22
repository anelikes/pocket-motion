/**
 * `overflow-mask` (patches/0013) end to end: the compiler's token, the core's
 * outline, the rasteriser's coverage and this repository's gates, read off
 * `compositions/masked` after a real build.
 *
 * The coverage claim itself — a mask of shape S is byte-identical to a POLY
 * of shape S — is held in the core (`engine/core/src/tests.rs`, 54 cases,
 * red with the level builder made binary). What this file holds is what the
 * core cannot: that the token survives the compiler and the pak, that the
 * pixels a scissor would get wrong are right (inside the AABB, outside the
 * outline), that the fixture's own assertions hold, and what `visibility`
 * and `check` say about a masked tree.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { runBuild } from "../src/cli/build.ts";
import { run as runAssert } from "../src/cli/commands/assert.ts";
import { run as runCheck } from "../src/cli/commands/check.ts";
import { run as runVisibility } from "../src/cli/commands/visibility.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { EXIT_OK } from "../src/cli/types.ts";
import { WasmFrameSource } from "../src/runtime/frame-source.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "compositions", "masked");
process.env.POCKETJS_ROOT = join(ROOT, "vendor", "pocketjs");

type Rgb = readonly [number, number, number];
const A_GROUND: Rgb = [30, 41, 59]; // slate-800, both scenes A
const ROOT_GROUND: Rgb = [11, 15, 20]; // #0b0f14
const NESTED_OUTER: Rgb = [49, 46, 129]; // #312e81
const near = (p: Rgb, q: Rgb, tol = 2) => p.every((v, i) => Math.abs(v - q[i]!) <= tol);

let frame89: Uint8Array;
let width = 0;

async function readFrame(at: number): Promise<Uint8Array> {
  const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: true });
  if (!resolved.ok) throw new Error("masked did not resolve");
  const c = resolved.value;
  width = c.width;
  const source = await WasmFrameSource.create({
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: c.pakPath,
    width: c.width,
    height: c.height,
    hz: c.fps,
    shutter: c.shutter,
    durationFrames: c.durationFrames,
    renderScale: c.supersample,
    buildCommand: c.buildCommand,
  });
  try {
    source.audit();
    await source.seekFrame(at);
    return Uint8Array.from(source.read());
  } finally {
    await source.dispose?.();
  }
}

function px(fb: Uint8Array, x: number, y: number): Rgb {
  const i = (y * width + x) * 4;
  return [fb[i]!, fb[i + 1]!, fb[i + 2]!];
}

beforeAll(async () => {
  const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error("masked did not resolve");
  await runBuild(resolved.value);
  frame89 = await readFrame(89);
}, 300_000);

describe("compositions/masked at its last frame", () => {
  test("the iris is a circle: inside the window's box but outside its outline is scene A", () => {
    // Circle centre (480, 270), radius 350 at frame 89. The quadrant's
    // corner (150, 30) is inside the window's AABB — a scissor would show B
    // there — and 408 px from the centre, outside the circle.
    expect(near(px(frame89, 150, 30), A_GROUND)).toBe(true);
    const centre = px(frame89, 480, 270);
    expect(near(centre, A_GROUND)).toBe(false);
    expect(centre[1]).toBeGreaterThan(100); // B's teal-to-green gradient
    // The arc carries coverage: along a row through the circle, the pixels
    // where the edge crosses are neither A nor B.
    const seen = new Set<string>();
    for (let x = 122; x <= 142; x++) seen.add(px(frame89, x, 300).join(","));
    expect(seen.size).toBeGreaterThan(2);
  });

  test("the card's corners are rounded: the corner pixel is the root ground, the card's centre is the card", () => {
    // Card at canvas (130, 660), 700x300, radius 40. Its top-left corner
    // pixel is inside the box and outside the rounded outline.
    expect(near(px(frame89, 133, 663), ROOT_GROUND)).toBe(true);
    expect(near(px(frame89, 480, 690), [30, 41, 59])).toBe(true); // #1e293b, above the text
  });

  test("the nested circle sits inside the rotated window", () => {
    // Inner circle: centre (1440, 810), radius 200, inside a 500x400 window
    // rotated 15 degrees about the same centre.
    const core = px(frame89, 1440, 810);
    expect(core[0]).toBeGreaterThan(200); // orange-to-yellow gradient
    expect(near(px(frame89, 1670, 810), NESTED_OUTER)).toBe(true); // 230 px out: window, not circle
    expect(near(px(frame89, 1440, 590), ROOT_GROUND)).toBe(true); // 220 px up: past the rotated window's top edge
  });

  test("the wipe has reached the far corner and the scene behind it is still", () => {
    expect(near(px(frame89, 1900, 520), A_GROUND)).toBe(false);
    // The 'after' label was laid out at quadrant (60, 60) inside a scene
    // rotated back about the window's origin: its ink is at canvas ~(1020, 90).
    let white = 0;
    for (let x = 1020; x < 1140; x++) {
      const [r, g, b] = px(frame89, x, 95);
      if (r > 200 && g > 200 && b > 200) white++;
    }
    expect(white).toBeGreaterThan(5);
  });
});

describe("the gates", () => {
  test("check passes: a mask is baked geometry, no guest op runs per frame", async () => {
    const result = await runCheck({ dir: DIR, flags: { json: true, frames: 8 } as never });
    expect(result.exitCode).toBe(EXIT_OK);
  }, 120_000);

  test("visibility reads the wiped label as buried and nothing else", async () => {
    const result = await runVisibility({ dir: DIR, all: false, flags: { json: true } as never });
    const json = result.json as {
      failures: string[];
      nodes: Array<{ name: string; onScreen: number[]; declaredInvisible: number[] }>;
    };
    expect(json.failures).toEqual(["wipe-a-label"]);
    const title = json.nodes.find((n) => n.name === "iris-b-title")!;
    // Before the window has any size it emits nothing: declared-invisible,
    // not covered. Then the circle reaches the title.
    expect(title.declaredInvisible).toEqual([0, 4, 8]);
    expect(title.onScreen[0]).toBe(12);
  }, 300_000);

  test("the sidecar's assertions hold on the default grid", async () => {
    const result = await runAssert({ dir: DIR, samples: 24, flags: { json: true } });
    const json = result.json as { ok: boolean; failures: string[] };
    expect(json.failures).toEqual([]);
    expect(json.ok).toBe(true);
    expect(result.exitCode).toBe(EXIT_OK);
  }, 300_000);
});
