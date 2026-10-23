#!/usr/bin/env bun
/**
 * Where a pocket-motion frame's time goes, without the CLI around it.
 *
 *   bun core-bench.ts --dist <dir holding main.js, main.pak> [--samples N] [--frames 300] [--scale 1]
 *
 * `--scale 2` renders at supersample 2, which needs a pak built at
 * `--density=2` (stage-pm.sh builds the `-ss2` variants that way).
 *
 * Boots the scene the way every command does (hardenedBootWorld), then per
 * frame times, with performance.now(): the fold (one guest turn plus 60/hz
 * core ticks), the raster (`render()`, the exposure under a shutter), and the
 * SHA-256 the CLI takes of every frame. No encode: `render`'s ffmpeg is a
 * separate process and measure.ts reports it by name. Prints medians and
 * totals as one JSON line, plus the wasm linear memory after boot and at the
 * end, which is the number a 128 MB isolate is tested against.
 */
import { hardenedBootWorld } from "../../../src/runtime/boot.ts";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1]! : d;
};
const dist = flag("dist")!;
const samples = Number(flag("samples", "0"));
const frames = Number(flag("frames", "300"));
const scale = Number(flag("scale", "1"));

const t0 = performance.now();
const world = await hardenedBootWorld({
  bundlePath: `${dist}/main.js`,
  pakPath: `${dist}/main.pak`,
  width: 1920,
  height: 1080,
  hz: 30,
  renderScale: scale,
  rasterDensity: scale,
  shutter: samples > 1 ? { angle: 180, samples } : null,
});
const bootMs = performance.now() - t0;
const memAfterBoot = world.exports.memory.buffer.byteLength;

const fold: number[] = [];
const raster: number[] = [];
const hash: number[] = [];
for (let f = 0; f < frames; f++) {
  const a = performance.now();
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  const b = performance.now();
  const rgba = world.render();
  const c = performance.now();
  new Bun.CryptoHasher("sha256").update(rgba).digest("hex");
  const d = performance.now();
  fold.push(b - a);
  raster.push(c - b);
  hash.push(d - c);
}
const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
console.log(
  JSON.stringify({
    dist,
    samples: samples > 1 ? samples : null,
    scale,
    frames,
    bootMs: +bootMs.toFixed(1),
    foldMsMedian: +med(fold).toFixed(3),
    rasterMsMedian: +med(raster).toFixed(2),
    hashMsMedian: +med(hash).toFixed(2),
    foldMsTotal: +sum(fold).toFixed(0),
    rasterMsTotal: +sum(raster).toFixed(0),
    hashMsTotal: +sum(hash).toFixed(0),
    wasmMemoryAfterBootBytes: memAfterBoot,
    wasmMemoryBytes: world.exports.memory.buffer.byteLength,
  }),
);
