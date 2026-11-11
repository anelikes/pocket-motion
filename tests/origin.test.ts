/**
 * A transform origin anywhere (patches/0066), and moving.
 *
 * The core's tests hold the arithmetic: an origin's length is the fraction
 * it equals, on the 2D and the 3D path, and both halves animate
 * (`engine/core/src/tests.rs`). This reads `compositions/origin` out of its
 * own pixels: each bar's flat colour bounds a box that the rotation about
 * the origin the class names puts in one place, and the zoom's box follows
 * the origin its keyframes move. A compiler that drops the length, or a
 * keyframe property that never reaches the core, lands a box elsewhere.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { readTimelines } from "../src/anim/timelines.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { TICKS_PER_SECOND, hardenedBootWorld } from "../src/runtime/boot.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "compositions", "origin");

let c: ResolvedComposition;
const FRAMES = [0, 14, 29] as const;
const rendered = new Map<number, Uint8Array>();

beforeAll(async () => {
  const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error("origin did not resolve");
  await runBuild(resolved.value);
  const built = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: true });
  if (!built.ok) throw new Error(built.message);
  c = built.value;
  const world = await hardenedBootWorld({
    bundlePath: c.bundlePath,
    pakPath: c.pakPath,
    width: c.width,
    height: c.height,
    hz: c.fps,
    renderScale: c.supersample,
    shutter: null,
    buildCommand: c.buildCommand,
  });
  // Frame 0 is the mount frame and its ticks, as `seekFrame(0)` runs it.
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  let at = 0;
  for (const f of FRAMES) {
    for (; at < f; at++) {
      world.frame(0);
      for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
    }
    rendered.set(f, Uint8Array.from(world.render()));
  }
}, 300_000);

/** The box of every pixel `match` takes, as [x0, y0, x1, y1), whole pixels. */
function bounds(fb: Uint8Array, match: (r: number, g: number, b: number) => boolean): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (!match(fb[i]!, fb[i + 1]!, fb[i + 2]!)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return [x0, y0, x1, y1];
}

/** Over half covered by one flat primary: red, green, blue or yellow. */
const RED = (r: number, g: number, b: number) => r > 128 && g < 64 && b < 64;
const GREEN = (r: number, g: number, b: number) => g > 128 && r < 64 && b < 64;
const BLUE = (r: number, g: number, b: number) => b > 128 && r < 64 && g < 64;
const YELLOW = (r: number, g: number, b: number) => r > 128 && g > 128 && b < 64;

/**
 * A w x h box at (left, top) turned 90 degrees clockwise about the point
 * (ox, oy) of its own: the box CSS puts it in. Corner (dx, dy) from the
 * origin goes to (-dy, dx).
 */
function turned90(left: number, top: number, w: number, h: number, ox: number, oy: number): [number, number, number, number] {
  const xs = [0, h].map((y) => left + ox - (y - oy));
  const ys = [0, w].map((x) => top + oy + (x - ox));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe("origin-[..] places the pivot", () => {
  test("a keyword, a length from the left edge, and calc() of a percentage and a length", () => {
    const fb = rendered.get(0)!;
    expect(bounds(fb, RED)).toEqual(turned90(80, 30, 100, 40, 0, 0));
    // origin-[12px_0]: 12 px in from the left edge, on the top.
    expect(bounds(fb, GREEN)).toEqual(turned90(150, 30, 100, 40, 12, 0));
    // origin-[calc(100%_-_20px)_bottom]: 20 px in from the right, on the bottom.
    expect(bounds(fb, BLUE)).toEqual(turned90(200, 60, 100, 40, 80, 40));
  });
});

describe("the origin animates", () => {
  test("a card held at scale 2 pans by its own size as its origin moves corner to corner", () => {
    // About origin (ox, oy) a 2x scale spans [left - ox, left - ox + 2w).
    // Linear over 1000 ms from 0% 0% to 100% 100%: frame f shows clock
    // 2f + 1 of 60, so the origin is that fraction of the card.
    for (const f of FRAMES) {
      const u = (2 * f + 1) / 60;
      const [x0, y0, x1, y1] = bounds(rendered.get(f)!, YELLOW);
      const want = [430 - 100 * u, 150 - 60 * u, 430 - 100 * u + 200, 150 - 60 * u + 120];
      for (const [k, v] of [x0, y0, x1, y1].entries()) {
        expect(Math.abs(v - want[k]!), `frame ${f}: [${[x0, y0, x1, y1]}], CSS [${want.map((n) => n.toFixed(2))}]`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  test("keyframes names the origin tracks the pak carries", async () => {
    const report = await readTimelines({ pakPath: c.pakPath, fps: c.fps, durationFrames: c.durationFrames, tickHz: TICKS_PER_SECOND });
    const props = new Set(report!.timelines.flatMap((t) => [...t.props]));
    expect([...props].sort()).toEqual(["originX", "originXPx", "originY", "originYPx"]);
  });
});
