#!/usr/bin/env bun
/**
 * Phase 4 defect 2 — is there a route to blend modes that does not touch the
 * core?
 *
 * The first defect was a quality question and had an answer you could put a
 * number on: how far from a correct downscale, and does the error crawl. This
 * one is not. `screen` is not a worse `src-over`, it is a different operation,
 * so "how wrong is it" has no meaning. The core has one `Target::blend` with no
 * mode parameter, the DrawList carries no mode word, the spec has no such
 * concept and Tailwind exposes nothing — the capability is absent, and that much
 * is settled by reading.
 *
 * What is worth measuring is the same thing that decided defect 1: whether the
 * pipeline already has a place where this is free. It does, for one of the two
 * cases.
 *
 * **Host-to-host.** Footage layers are host-owned — `src/footage/layer.ts` holds
 * the pixels and uploads them. Two footage layers blended with each other can be
 * composited by the host before upload, in a plain loop, with no core change at
 * all. This measures whether that loop is affordable next to the 1.19 ms the
 * rasteriser costs and the 2.85 ms the frame hash costs.
 *
 * **Guest-in-the-blend.** Blending footage against something the composition
 * draws — text, a gradient, a rounded rect — is NOT reachable this way. The host
 * does not have those pixels until the core has already composited them, by
 * which time the blend it would need to undo has happened. That case needs the
 * core.
 *
 *   bun scripts/blend-probe.ts
 */

const W = 1920;
const H = 1080;
const PX = W * H;
const REPS = 20;

/** Two deterministic 1080p layers, structured rather than random. */
function layer(seed: number): Uint8Array {
  const out = new Uint8Array(PX * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      out[i] = (x * 3 + seed) & 0xff;
      out[i + 1] = (y * 5 + seed) & 0xff;
      out[i + 2] = ((x ^ y) + seed) & 0xff;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Each mode is its own monomorphic loop with the arithmetic written inline.
 *
 * The first version of this dispatched through a `Record<string, (s, d) =>
 * number>`, and reported overlay at 154 ms against multiply's 6.7 — for
 * arithmetic that differs by one comparison. That was the call site going
 * megamorphic as the loop worked down the table, not the blend: a benchmark
 * measuring itself. Monomorphic loops cost more source and are the only way the
 * numbers mean anything.
 */
type Kernel = (a: Uint8Array, b: Uint8Array, out: Uint8Array, px: number) => void;

const srcOver: Kernel = (a, _b, out, px) => {
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    out[o] = a[o]!;
    out[o + 1] = a[o + 1]!;
    out[o + 2] = a[o + 2]!;
    out[o + 3] = 255;
  }
};

const multiply: Kernel = (a, b, out, px) => {
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    out[o] = (a[o]! * b[o]! + 127) / 255;
    out[o + 1] = (a[o + 1]! * b[o + 1]! + 127) / 255;
    out[o + 2] = (a[o + 2]! * b[o + 2]! + 127) / 255;
    out[o + 3] = 255;
  }
};

const screen: Kernel = (a, b, out, px) => {
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    out[o] = 255 - ((255 - a[o]!) * (255 - b[o]!) + 127) / 255;
    out[o + 1] = 255 - ((255 - a[o + 1]!) * (255 - b[o + 1]!) + 127) / 255;
    out[o + 2] = 255 - ((255 - a[o + 2]!) * (255 - b[o + 2]!) + 127) / 255;
    out[o + 3] = 255;
  }
};

const overlay: Kernel = (a, b, out, px) => {
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const s = a[o + c]!;
      const d = b[o + c]!;
      out[o + c] =
        d < 128 ? (2 * s * d + 127) / 255 : 255 - (2 * (255 - s) * (255 - d) + 127) / 255;
    }
    out[o + 3] = 255;
  }
};

const MODES: readonly [name: string, k: Kernel][] = [
  ["src-over(opaque)", srcOver],
  ["multiply", multiply],
  ["screen", screen],
  ["overlay", overlay],
];

const a = layer(0);
const b = layer(97);
const out = new Uint8Array(PX * 4);

console.log(`host-side blend, ${W}x${H} (${((PX * 4) / 1048576).toFixed(1)} MB/layer), ${REPS} reps`);
console.log("每种模式一个单态循环，算术内联——见上方注释\n");
console.log(`${"mode".padEnd(20)}${"ms/frame".padStart(10)}   ${"vs rasterise 1.19".padStart(20)}`);

for (const [name, k] of MODES) {
  k(a, b, out, PX); // warm up outside the measurement
  const t0 = performance.now();
  for (let r = 0; r < REPS; r++) k(a, b, out, PX);
  const ms = (performance.now() - t0) / REPS;
  console.log(`${name.padEnd(20)}${ms.toFixed(2).padStart(10)}   ${(ms / 1.19).toFixed(1)}x`.padEnd(56));
}
