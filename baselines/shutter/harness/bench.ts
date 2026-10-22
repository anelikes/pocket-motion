#!/usr/bin/env bun
/**
 * Shutter cost per frame. For each of `--frames` frames starting at `--from`,
 * and each N, time `ui_render_exposure` `--reps` times (it restores the
 * frame's state, so a repeat renders the same exposure) and keep the fastest;
 * report the median and the minimum of those over the frames. The same is
 * measured for N plain samples with no accumulation (`raster`), so
 * `exposure - raster` is what the averaging costs.
 *
 *   POCKETJS_ROOT=<scratch>/pj bun bench.ts --repo <worktree> --bundle B --pak P \
 *     --w 1920 --h 1080 --fps 30 --from 20 --frames 12 --n 1,4,8,16 --reps 3
 */
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    repo: { type: "string" }, bundle: { type: "string" }, pak: { type: "string" },
    w: { type: "string" }, h: { type: "string" }, fps: { type: "string" },
    from: { type: "string", default: "0" }, frames: { type: "string", default: "12" },
    n: { type: "string", default: "1,4,8,16" }, reps: { type: "string", default: "3" },
    angle: { type: "string", default: "180" }, scale: { type: "string", default: "1" },
    label: { type: "string", default: "" }, json: { type: "string" },
    host: { type: "boolean", default: false },
  },
});
const { hardenedBootWorld } = await import(`${a.repo}/src/runtime/boot.ts`);
const W = Number(a.w), H = Number(a.h), fps = Number(a.fps), scale = Number(a.scale);
const from = Number(a.from), frames = Number(a.frames), reps = Number(a.reps);
const Ns = a.n!.split(",").map(Number);
const T = 60 / fps, spanNum = Number(a.angle) * T, spanDen = 360;
const world = await hardenedBootWorld({ bundlePath: a.bundle!, pakPath: a.pak, width: W, height: H, hz: fps, renderScale: scale });
const ex = world.exports as any;

const expo: Record<number, number[]> = Object.fromEntries(Ns.map((n) => [n, []]));
const raster: Record<number, number[]> = Object.fromEntries(Ns.map((n) => [n, []]));
const host: Record<number, number[]> = Object.fromEntries(Ns.map((n) => [n, []]));
const PB = W * scale * H * scale * 4;
const acc = new Uint32Array(PB), out = new Uint8Array(PB);
/** The same exposure averaged in the host (JS), for the core-vs-host question. */
function hostExposure(n: number): Uint8Array {
  if (n === 1) return new Uint8Array(ex.memory.buffer, ex.ui_render_scaled(scale), PB);
  acc.fill(0);
  for (let k = 0; k < n; k++) {
    ex.ui_shutter_sample(spanNum * (2 * k + 1 - n), spanDen * 2 * n);
    const ptr = ex.ui_render_scaled(scale);
    const px = new Uint8Array(ex.memory.buffer, ptr, PB);
    for (let i = 0; i < PB; i += 4) {
      const al = px[i + 3]!;
      acc[i] += px[i]! * al; acc[i + 1] += px[i + 1]! * al; acc[i + 2] += px[i + 2]! * al; acc[i + 3] += al;
    }
  }
  ex.ui_shutter_sample(0, 1);
  const full = 255 * n;
  for (let i = 0; i < PB; i += 4) {
    const sa = acc[i + 3]!;
    if (sa === 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
    if (sa === full) {
      for (let c = 0; c < 3; c++) out[i + c] = Math.floor((2 * (acc[i + c]! / 255) + n) / (2 * n));
      out[i + 3] = 255;
      continue;
    }
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.floor((2 * acc[i + c]! + sa) / (2 * sa)));
    out[i + 3] = Math.floor((2 * sa + n) / (2 * n));
  }
  return out;
}
const best = (fn: () => void) => {
  let m = Infinity;
  for (let r = 0; r < reps; r++) { const t = performance.now(); fn(); m = Math.min(m, performance.now() - t); }
  return m;
};
for (let f = 0; f < from + frames; f++) {
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  if (f < from) continue;
  for (const n of Ns) {
    expo[n]!.push(best(() => ex.ui_render_exposure(scale, spanNum, spanDen, n)));
    if (a.host) host[n]!.push(best(() => hostExposure(n)));
    raster[n]!.push(best(() => {
      for (let k = 0; k < n; k++) {
        if (n > 1) ex.ui_shutter_sample(spanNum * (2 * k + 1 - n), spanDen * 2 * n);
        ex.ui_render_scaled(scale);
      }
      if (n > 1) ex.ui_shutter_sample(0, 1);
    }));
  }
}
const med = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]!; };
const r2 = (x: number) => +x.toFixed(2);
const rows = Ns.map((n) => ({
  n,
  exposureMedianMs: r2(med(expo[n]!)), exposureMinMs: r2(Math.min(...expo[n]!)),
  rasterMedianMs: r2(med(raster[n]!)), averagingMedianMs: r2(med(expo[n]!) - med(raster[n]!)),
  ...(a.host ? { hostExposureMedianMs: r2(med(host[n]!)) } : {}),
}));
const result = { label: a.label, platform: `${process.platform}/${process.arch}`, size: [W * scale, H * scale], from, frames, reps, angle: Number(a.angle), rows };
console.log(JSON.stringify(result));
if (a.json) writeFileSync(a.json, JSON.stringify(result, null, 2) + "\n");
