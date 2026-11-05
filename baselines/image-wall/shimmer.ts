#!/usr/bin/env bun
/**
 * The image wall's shimmer, measured: `compositions/image-wall` rendered with
 * each filter an image can have, and how much of every frame changes into the
 * next. `baselines/image-wall.md` holds the table and what it says.
 *
 * Each variant is a staged copy of the composition (`stageVariant`,
 * `compositions/image-wall/gen.ts`) — the same covers, the same push; only
 * the class on the images and `images.json` differ. Each is built
 * through the CLI and rendered in process (`WasmFrameSource`), all of them in
 * lockstep, so no more than one frame of each is held. The supersampled rows
 * render at raster scale 4 and are box-averaged 4x4 here, because png-seq
 * runs no ffmpeg to downscale them.
 *
 * Metrics, over the 299 pairs of consecutive frames:
 *   mean |Δ|   mean absolute difference per channel, /255
 *   flicker    share of pixels whose largest channel moves more than 32
 *   crawl      mean absolute change per channel, from one frame to the next,
 *              of the frame's difference from the reference row's same frame
 *              (trilinear at raster scale 4, box-averaged): how much the
 *              ERROR moves. A steady bias scores near zero however large; an
 *              aliasing pattern that reorganises as the wall moves scores
 *              high. `baselines/phase4-minification.md` used it for footage.
 *   vs ref     mean |Δ| from the reference row's same frame, over all frames
 *   jitter     mean |f(t+1) - 2 f(t) + f(t-1)| per channel, /255, over the
 *              298 triples: the frame-to-frame change that is not steady.
 *              A push moves detail at a rate that changes slowly, so a
 *              well-filtered sequence keeps it small; a pattern that flips
 *              between frames makes it large. It needs no reference.
 *   frame 0    the first frame's seek and read, which reduces every chain
 *   ms/frame   every later frame's, averaged; the rows run interleaved, so a
 *              machine's load lands on all of them alike
 *   memory     wasm linear memory grown from boot to the last frame
 *
 * The content is static and the push slow, so a renderer that resamples well
 * changes a frame little: what moves is the wall's edges and detail coming
 * into resolution. A resampler that aliases redraws the detail it cannot
 * resolve differently at every scale, and that is the shimmer. The reference
 * is what supersampling buys today, not the truth: sixteen box samples a
 * pixel still leave moiré on detail this fine. A blur also changes little,
 * which is what `vs ref` is for.
 *
 *   bun baselines/image-wall/shimmer.ts
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { stageVariant } from "../../compositions/image-wall/gen.ts";
import { resolveComposition } from "../../src/cli/resolve.ts";
import { WasmFrameSource } from "../../src/runtime/frame-source.ts";

const ROOT = join(import.meta.dir, "..", "..");

interface Variant {
  name: string;
  filter: string;
  linear: boolean;
  scale: number;
}

const VARIANTS: Variant[] = [
  { name: "nearest", filter: "", linear: false, scale: 1 },
  { name: "bilinear", filter: "", linear: true, scale: 1 },
  { name: "trilinear", filter: " image-filter-trilinear", linear: false, scale: 1 },
  { name: "bilinear-x4", filter: "", linear: true, scale: 4 },
  { name: "trilinear-x4", filter: " image-filter-trilinear", linear: false, scale: 4 },
];
const REFERENCE = "trilinear-x4";

async function sh(argv: string[]): Promise<string> {
  const p = Bun.spawn(argv, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${argv.join(" ")} failed (${code})\n${err}`);
  return out;
}

async function open(v: Variant): Promise<{ v: Variant; dir: string; source: WasmFrameSource; width: number; height: number; frames: number }> {
  const { dir } = await stageVariant(v.name, v);
  await sh(["bun", "src/cli/main.ts", "build", dir]);
  const r = await resolveComposition({ dir, flags: {} as never, requireBundle: true });
  if (!r.ok) throw new Error(`${v.name}: ${JSON.stringify(r)}`);
  const c = r.value;
  const source = await WasmFrameSource.create({
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: c.pakPath,
    width: c.width,
    height: c.height,
    hz: c.fps,
    durationFrames: c.durationFrames,
    renderScale: v.scale,
    shutter: null,
    buildCommand: c.buildCommand,
  });
  return { v, dir, source, width: c.width, height: c.height, frames: c.durationFrames };
}

/** `rgba` at `scale` averaged back to one pixel per `scale` x `scale` block. */
function boxDown(rgba: Uint8Array, w: number, h: number, scale: number): Uint8Array {
  if (scale === 1) return rgba.slice();
  const sums = new Uint32Array(w * h * 4);
  const pw = w * scale;
  for (let py = 0; py < h * scale; py++) {
    const row = ((py / scale) | 0) * w * 4;
    for (let px = 0; px < pw; px++) {
      const o = row + ((px / scale) | 0) * 4, i = (py * pw + px) * 4;
      sums[o] += rgba[i]!;
      sums[o + 1] += rgba[i + 1]!;
      sums[o + 2] += rgba[i + 2]!;
      sums[o + 3] += rgba[i + 3]!;
    }
  }
  const n = scale * scale;
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor((sums[i]! + n / 2) / n);
  return out;
}

function diff(a: Uint8Array, b: Uint8Array): { mean: number; flicker: number } {
  let sum = 0;
  let moved = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i]! - b[i]!), dg = Math.abs(a[i + 1]! - b[i + 1]!), db = Math.abs(a[i + 2]! - b[i + 2]!);
    sum += dr + dg + db;
    if (Math.max(dr, dg, db) > 32) moved++;
  }
  const px = a.length / 4;
  return { mean: sum / (px * 3), flicker: moved / px };
}

/** Mean |(b - rb) - (a - ra)| per channel, /255: how far the error field moved. */
function crawl(a: Uint8Array, ra: Uint8Array, b: Uint8Array, rb: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if ((i & 3) === 3) continue;
    sum += Math.abs(b[i]! - rb[i]! - (a[i]! - ra[i]!));
  }
  return sum / ((a.length / 4) * 3);
}

/** Mean |c - 2b + a| per channel, /255. */
function second(a: Uint8Array, b: Uint8Array, c: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if ((i & 3) === 3) continue;
    sum += Math.abs(c[i]! - 2 * b[i]! + a[i]!);
  }
  return sum / ((a.length / 4) * 3);
}

const runs = [];
for (const v of VARIANTS) runs.push(await open(v));
const stats = new Map(
  runs.map((r) => [
    r.v.name,
    {
      mean: 0, flicker: 0, crawl: 0, vsRef: 0, jitter: 0, ms: 0, first: 0, booted: r.source.memoryBytes,
      prev: undefined as Uint8Array | undefined, prev2: undefined as Uint8Array | undefined,
    },
  ]),
);
let prevRef: Uint8Array | undefined;
const frames = runs[0]!.frames;
for (let f = 0; f < frames; f++) {
  const now = new Map<string, Uint8Array>();
  for (const r of runs) {
    const t0 = performance.now();
    await r.source.seekFrame(f);
    const rgba = r.source.read();
    const s = stats.get(r.v.name)!;
    if (f === 0) s.first = performance.now() - t0;
    else s.ms += performance.now() - t0;
    now.set(r.v.name, boxDown(rgba, r.width, r.height, r.v.scale));
  }
  const ref = now.get(REFERENCE)!;
  for (const r of runs) {
    const s = stats.get(r.v.name)!;
    const cur = now.get(r.v.name)!;
    if (s.prev) {
      const d = diff(s.prev, cur);
      s.mean += d.mean;
      s.flicker += d.flicker;
      s.crawl += crawl(s.prev, prevRef!, cur, ref);
    }
    if (s.prev && s.prev2) s.jitter += second(s.prev2, s.prev, cur);
    s.vsRef += diff(cur, ref).mean;
    s.prev2 = s.prev;
    s.prev = cur;
  }
  prevRef = ref;
}
const memory = new Map(runs.map((r) => [r.v.name, r.source.memoryBytes]));
for (const r of runs) {
  await r.source.dispose();
  await rm(r.dir, { recursive: true, force: true });
}

console.log(
  "| filter | raster scale | mean \\|Δ\\| /255 | flicker | jitter /255 | crawl /255 | vs ref /255 | frame 0 ms | ms/frame after | memory grown MiB |",
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of runs) {
  const s = stats.get(r.v.name)!;
  const label = r.v.filter ? "trilinear" : r.v.linear ? "bilinear" : "nearest";
  console.log(
    `| ${label} | ${r.v.scale} | ${(s.mean / (frames - 1)).toFixed(3)} | ${((s.flicker / (frames - 1)) * 100).toFixed(2)}% | ` +
      `${(s.jitter / (frames - 2)).toFixed(3)} | ${(s.crawl / (frames - 1)).toFixed(3)} | ${(s.vsRef / frames).toFixed(3)} | ${s.first.toFixed(1)} | ` +
      `${(s.ms / (frames - 1)).toFixed(1)} | ${((memory.get(r.v.name)! - s.booted) / 2 ** 20).toFixed(1)} |`,
  );
}
