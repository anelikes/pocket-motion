#!/usr/bin/env bun
/**
 * One row of `compositions/image-wall` at a frame, under each filter and at
 * raster scale 4, cropped, box-averaged to one pixel per logical pixel and
 * magnified 4x nearest, stacked top to bottom: nearest, bilinear, trilinear,
 * trilinear x4. What `baselines/image-wall.md` describes under "the x4
 * renders keep moiré". PNGs are gitignored; this writes one where it is told.
 *
 *   bun baselines/image-wall/crops.ts <out.png> [frame]
 */

import { stageVariant } from "../../compositions/image-wall/gen.ts";
import { runBuild } from "../../src/cli/build.ts";
import { resolveComposition } from "../../src/cli/resolve.ts";
import { pocketjsRoot } from "../../src/runtime/boot.ts";
import { WasmFrameSource } from "../../src/runtime/frame-source.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: bun baselines/image-wall/crops.ts <out.png> [frame]");
const at = Number(process.argv[3] ?? 0);
const { encodePNG } = (await import(`${pocketjsRoot()}/tests/png.ts`)) as {
  encodePNG: (rgba: Uint8Array, w: number, h: number) => Buffer;
};

// The wall's first row, in logical px, and the magnification.
const [X0, Y0, CW, CH, ZOOM] = [316, 178, 330, 72, 4];
const ROWS = [
  { name: "nearest", filter: "", linear: false, scale: 1 },
  { name: "bilinear", filter: "", linear: true, scale: 1 },
  { name: "trilinear", filter: " image-filter-trilinear", linear: false, scale: 1 },
  { name: "trilinear-x4", filter: " image-filter-trilinear", linear: false, scale: 4 },
] as const;

const W = CW * ZOOM, H = CH * ZOOM;
const sheet = new Uint8Array(W * H * ROWS.length * 4);
for (const [row, v] of ROWS.entries()) {
  const { dir, dispose } = await stageVariant(`crop-${v.name}`, v);
  const r = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
  if (!r.ok) throw new Error(`${v.name} did not resolve`);
  const c = r.value;
  await runBuild(c);
  const source = await WasmFrameSource.create({
    compositionId: c.compositionId, bundlePath: c.bundlePath, pakPath: c.pakPath,
    width: c.width, height: c.height, hz: c.fps, durationFrames: c.durationFrames,
    renderScale: v.scale, shutter: null, buildCommand: c.buildCommand,
  });
  await source.seekFrame(at);
  const rgba = source.read();
  const pw = c.width * v.scale, n = v.scale * v.scale;
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const px = [0, 0, 0, 0];
      for (let j = 0; j < v.scale; j++) {
        for (let i = 0; i < v.scale; i++) {
          const o = (((Y0 + y) * v.scale + j) * pw + (X0 + x) * v.scale + i) * 4;
          for (let k = 0; k < 4; k++) px[k]! += rgba[o + k]!;
        }
      }
      for (let j = 0; j < ZOOM; j++) {
        for (let i = 0; i < ZOOM; i++) {
          const o = ((row * H + y * ZOOM + j) * W + x * ZOOM + i) * 4;
          for (let k = 0; k < 4; k++) sheet[o + k] = Math.floor((px[k]! + n / 2) / n);
        }
      }
    }
  }
  await source.dispose();
  await dispose();
}
await Bun.write(out, encodePNG(sheet, W, H * ROWS.length));
console.log(`wrote ${out} (${W}x${H * ROWS.length}): ${ROWS.map((v) => v.name).join(", ")}, top to bottom`);
