#!/usr/bin/env bun
/**
 * Can footage take a CURVED push, and does a tiled layer survive it?
 *
 * Four questions that fail independently, so each gets its own content:
 *
 *   curve     Does an animated `scale` move the footage grid at all, does the
 *             composition stay mount-only while it does, and does the scale
 *             follow the cubic-bezier rather than a straight line? Measured on
 *             the real drawn extent, not on the declared animation.
 *
 *   geometry  `TEX_QUAD` encodes integer x/y/w/h, so each tile rounds its own
 *             destination rect and adjacent tiles could round apart. Solid white
 *             footage on black: any dip inside the drawn picture is background
 *             showing through a gap.
 *
 *   reaches   Does `linear: true` actually change what the rasteriser does? A
 *             1px checkerboard, where nearest and bilinear cannot agree. Without
 *             this the other rows could all be measuring nearest twice.
 *
 *   seam      Each tile is its OWN texture, so bilinear at tile 0's right edge
 *             could only blend the last column with itself instead of with tile
 *             1's first column. `tiling.ts` gives every tile a bleed texel of
 *             its neighbour and insets the UV past it; this checks that it
 *             worked. A hard black→white edge placed inside tile 0 and an
 *             identical one placed exactly on the join, compared — after the
 *             fix both must interpolate identically.
 *
 * Footage is synthesised as raw RGBA rather than decoded, so the content is
 * exactly what the arithmetic says it is and no codec or swscale step can be
 * blamed for a result.
 *
 *   bun scripts/push-probe.ts
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FootageLayer } from "../src/footage/layer.ts";
import { gridOf, interiorOf } from "../src/footage/tiling.ts";
import { hardenedBootWorld, totalPendingWork } from "../src/runtime/boot.ts";
import type { IngestManifest } from "../src/footage/ingest.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VENDOR = join(ROOT, "vendor/pocketjs");
const WORK = "/tmp/pocketjs-motion-push";
const DIST = join(ROOT, "dist/kenburns");
const VIEW = { w: 1920, h: 1080 };
const TILE = 512, FRAMES = 60, FPS = 30;
/** 2x1 tiles of the DRAWN interior (510), not of the 512 texture. */
const INTERIOR = interiorOf(TILE);
const W = INTERIOR * 2, H = INTERIOR;

/** Matches compositions/kenburns/pocket.config.ts. */
const FROM = 1.0, TO = 1.75;
const BEZIER = [0.7, 0, 0.3, 1] as const;

const MANIFEST: IngestManifest = {
  src: "synthetic", width: W, height: H, fps: FPS, frames: FRAMES, tile: TILE,
  grid: gridOf(W, H, TILE), sha256: "0".repeat(64), bytes: W * H * 4 * FRAMES,
  ffmpeg: "synthetic",
};

async function synth(name: string, px: (x: number, y: number) => number): Promise<string> {
  const raw = new Uint8Array(W * H * 4 * FRAMES);
  for (let n = 0; n < FRAMES; n++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = px(x, y);
        const i = ((n * H + y) * W + x) * 4;
        raw[i] = v; raw[i + 1] = v; raw[i + 2] = v; raw[i + 3] = 255;
      }
    }
  }
  const p = join(WORK, `${name}.rgba`);
  await writeFile(p, raw);
  return p;
}

interface Shot { frames: Uint8Array[]; pending: number }

/** Render frames 0..upTo of the push. Frames are kept, not just the last. */
async function shoot(rawPath: string, linear: boolean, upTo: number): Promise<Shot> {
  const world = await hardenedBootWorld({
    bundlePath: join(DIST, "main.js"),
    pakPath: existsSync(join(DIST, "main.pak")) ? join(DIST, "main.pak") : undefined,
    width: VIEW.w, height: VIEW.h, hz: FPS,
    shutter: null,
  });
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  const layer = await FootageLayer.create({
    manifest: MANIFEST, rawPath, nodePrefix: "footage:kb",
    tree: world.getTree(), ops: world.ops as never, linear,
  });
  const frames: Uint8Array[] = [];
  try {
    for (let n = 0; n <= upTo; n++) {
      layer.present(n);
      world.frame(0);
      for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
      frames.push(world.render().slice());
    }
    const w = world.pendingWork();
    return { frames, pending: w ? totalPendingWork(w) : -1 };
  } finally {
    layer.close();
  }
}

const green = (f: Uint8Array, x: number, y: number): number => f[(y * VIEW.w + x) * 4 + 1]!;

/** Horizontal extent of anything not pure black, on the middle row. */
function extent(f: Uint8Array): { x0: number; x1: number } {
  const y = VIEW.h >> 1;
  let x0 = -1, x1 = -1;
  for (let x = 0; x < VIEW.w; x++) if (green(f, x, y) > 0) { if (x0 < 0) x0 = x; x1 = x; }
  return { x0, x1 };
}

function bezierY(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const fy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    let t = x;
    for (let i = 0; i < 24; i++) {
      const e = fx(t) - x;
      t -= e / Math.max(1e-6, (3 * ax * t + 2 * bx) * t + cx);
      t = Math.min(1, Math.max(0, t));
    }
    return fy(t);
  };
}

// ---------------------------------------------------------------------------

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });

if (!existsSync(join(DIST, "main.js"))) {
  console.error(`push-probe: build the composition first —\n  bun ${VENDOR}/tools/build.ts ${ROOT}/compositions/kenburns/main.tsx --outdir=${DIST} --framework=solid`);
  process.exit(2);
}

const white = await synth("white", () => 255);
const checker = await synth("checker", (x, y) => ((x + y) & 1) * 255);
// black | white | black | white, with the LAST rising edge placed exactly on
// the tile join and an identical one well inside tile 0 as the control.
const edges = await synth("edges", (x) => (x >= INTERIOR || (x >= 256 && x < 384) ? 255 : 0));

// -- curve + geometry, from one pass over the solid-white push --------------

const shot = await shoot(white, true, FRAMES - 1);
const ease = bezierY(...BEZIER);

const measured: number[] = [];
let gapFrames = 0, deepest = 0, deepestAt = 0;
for (let n = 0; n < FRAMES; n++) {
  const f = shot.frames[n]!;
  const { x0, x1 } = extent(f);
  measured.push((x1 - x0 + 1) / W);
  // Geometry: a gap between tiles shows the black ground through solid white.
  let dip = 0, dipAt = -1;
  for (let x = x0 + 1; x < x1; x++) {
    const d = 255 - green(f, x, VIEW.h >> 1);
    if (d > dip) { dip = d; dipAt = x; }
  }
  if (dip > 0) { gapFrames++; if (dip > deepest) { deepest = dip; deepestAt = dipAt - Math.round((x0 + x1) / 2); } }
}

/**
 * Fit a pure phase shift before scoring the shape.
 *
 * The harness burns a frame before capture (one `frame()` for the tree the
 * footage layer resolves against), and the animation clock starts when the
 * style is applied, not when this loop does. That is a constant lead, and
 * charging it to the curve would report a distortion that is not there — so
 * measure the lead, then ask whether the SHAPE survives it.
 */
const curveAt = (n: number, off: number) => FROM + (TO - FROM) * ease(Math.min(1, (n + off) / FRAMES));
const err = (off: number) => Math.max(...measured.map((m, n) => Math.abs(m - curveAt(n, off))));
let bestOff = 0, bestErr = Infinity;
for (let i = 0; i <= 200; i++) {
  const off = i * 0.05;
  const e = err(off);
  if (e < bestErr) { bestErr = e; bestOff = off; }
}

console.log(`mount-only     pendingWork total ${shot.pending}`);
console.log("");
console.log("  frame   measured   curve   linear would be");
let linearGap = 0;
for (let n = 0; n < FRAMES; n += 6) {
  const lin = FROM + (TO - FROM) * (n / FRAMES);
  linearGap = Math.max(linearGap, Math.abs(curveAt(n, bestOff) - lin));
  console.log(`  ${String(n).padStart(5)}   ${measured[n]!.toFixed(3)}     ${curveAt(n, bestOff).toFixed(3)}       ${lin.toFixed(3)}`);
}
console.log("");
console.log(`curve          shape matches to ${bestErr.toFixed(4)} after a ${bestOff.toFixed(2)}-frame lead`);
console.log(`               (extent quantises to 1px = ${(1 / W).toFixed(4)}, so that is the floor;`);
console.log(`                the bezier departs from a straight line by up to ${linearGap.toFixed(3)})`);
console.log(`geometry       gap frames ${gapFrames}/${FRAMES}` +
  (deepest ? `  deepest dip ${deepest}/255 at ${deepestAt >= 0 ? "+" : ""}${deepestAt}px from the join` : "  — tiles stay welded"));

// -- does the flag reach the rasteriser at all? -----------------------------

{
  const a = (await shoot(checker, false, 40)).frames.at(-1)!;
  const b = (await shoot(checker, true, 40)).frames.at(-1)!;
  let differing = 0, worst = 0;
  for (let i = 1; i < a.length; i += 4) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d) differing++;
    if (d > worst) worst = d;
  }
  console.log(`reaches        ${differing} pixels differ, max |Δ| ${worst}/255 — ` +
    (differing ? "the flag reaches the draw" : "THE FLAG IS NOT REACHING THE DRAW"));
}

// -- the clamp seam ---------------------------------------------------------

console.log("");
for (const linear of [false, true]) {
  const f = (await shoot(edges, linear, 40)).frames.at(-1)!;
  const y = VIEW.h >> 1;
  const rises: number[] = [];
  for (let x = 1; x < VIEW.w; x++) if (green(f, x - 1, y) < 128 && green(f, x, y) >= 128) rises.push(x);
  const prof = (c: number) => Array.from({ length: 8 }, (_, i) => String(green(f, c - 4 + i, y)).padStart(3)).join(" ");
  const tag = linear ? "linear " : "nearest";
  if (rises[0]) console.log(`seam ${tag}  edge inside tile 0:  ${prof(rises[0])}`);
  if (rises[1]) console.log(`seam ${tag}  edge ON the join:    ${prof(rises[1])}`);
}

// -- the join, phase-free ---------------------------------------------------
//
// Two hard edges land at different sub-pixel phases, so their profiles differ
// even when both are correct — that comparison can show the clamp is gone but
// cannot show the join is RIGHT. A triangle ramp can: bilinear of a linear
// function is exactly linear, so a correct render has zero second difference
// everywhere except the ramp's own turning points. A join that samples wrong
// puts a spike there and nowhere else.
{
  // Period 76 puts the join (source 510) 16px from the nearest turning point,
  // and the short half-period makes the ramp steep: a flattened column at the
  // join would score an order of magnitude above the noise floor rather than
  // just above it. A gentler ramp passes this test without being able to fail
  // it, which is the failure mode of a test like this.
  const period = 76;
  const tri = await synth("ramp", (x) => {
    const p = x % period;
    const up = p < period / 2 ? p : period - p;
    return Math.round((up / (period / 2)) * 240);
  });
  const f = (await shoot(tri, true, 40)).frames.at(-1)!;
  const y = VIEW.h >> 1;
  const { x0, x1 } = extent(f);
  const d2 = (x: number) => Math.abs(green(f, x - 1, y) - 2 * green(f, x, y) + green(f, x + 1, y));

  // Where the join landed on screen: the interior boundary, through the same
  // scale the extent reveals.
  const scale = (x1 - x0 + 1) / W;
  const join = Math.round(x0 + INTERIOR * scale);
  // Turning points, so the ramp's own corners are not counted as defects.
  const turns = new Set<number>();
  for (let sx = 0; sx <= W; sx += period / 2) {
    const c = Math.round(x0 + sx * scale);
    for (let k = -3; k <= 3; k++) turns.add(c + k);
  }

  let atJoin = 0;
  for (let x = join - 3; x <= join + 3; x++) atJoin = Math.max(atJoin, d2(x));
  let elsewhere = 0;
  let step = 0;
  for (let x = x0 + 6; x < x1 - 6; x++) {
    if (turns.has(x)) continue;
    step = Math.max(step, Math.abs(green(f, x, y) - green(f, x - 1, y)));
    if (Math.abs(x - join) <= 5) continue;
    elsewhere = Math.max(elsewhere, d2(x));
  }
  console.log("");
  console.log(`join           max |2nd diff| at the join ${atJoin}, elsewhere on the ramp ${elsewhere}`);
  console.log(`               the ramp steps ${step}/255 per screen pixel, so a flattened column`);
  console.log(`               at the join would score about that — the test can fail.`);
  console.log(`               ${atJoin <= elsewhere ? "the join is indistinguishable from the rest of the picture" : "THE JOIN STILL STANDS OUT"}`);
}
