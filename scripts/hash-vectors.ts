#!/usr/bin/env bun
/**
 * Fixed vectors for the per-frame hash, so its value can be compared across
 * platforms without building or rendering anything.
 *
 * `src/render/hash.ts` offers a `"fast"` algorithm (wyhash via `Bun.hash`) that
 * costs 0.24 ms against SHA-256's 2.71 on a 1080p frame — the oracle was
 * costing more than twice the rasteriser. It stays opt-in because the whole
 * determinism claim rests on hashes agreeing across platforms, and only SHA-256
 * had been through that check. wyhash is integer-only and *ought* to be
 * portable; this exists because "ought to" is not the standard.
 *
 * The inputs are generated, never random, and cover what a frame buffer
 * actually looks like: long runs of one value, structure at 4-byte stride,
 * high-entropy noise, and sizes either side of any word or vector boundary an
 * implementation might special-case.
 *
 *   bun scripts/hash-vectors.ts            # print vectors
 *   bun scripts/hash-vectors.ts --json     # machine-readable, for diffing
 */

import { hashFrame, type HashAlgorithm } from "../src/render/hash.ts";

/** Deterministic pseudo-random bytes — a small LCG, identical everywhere. */
function noise(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

/** RGBA that looks like a real frame: a gradient with an opaque alpha channel. */
function frameLike(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = (x * 7) & 0xff;
      out[i + 1] = (y * 5) & 0xff;
      out[i + 2] = (x ^ y) & 0xff;
      out[i + 3] = 255;
    }
  }
  return out;
}

const VECTORS: readonly { name: string; bytes: Uint8Array }[] = [
  { name: "empty", bytes: new Uint8Array(0) },
  { name: "one-zero", bytes: new Uint8Array(1) },
  { name: "one-ff", bytes: Uint8Array.from([0xff]) },
  // Either side of 8/16/32-byte boundaries, where a word- or vector-at-a-time
  // implementation would change code path.
  ...[7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65].map((n) => ({
    name: `noise-${n}`,
    bytes: noise(n, 0x9e3779b9 ^ n),
  })),
  { name: "zeros-4096", bytes: new Uint8Array(4096) },
  { name: "ones-4096", bytes: new Uint8Array(4096).fill(0xff) },
  { name: "noise-65536", bytes: noise(65536, 12345) },
  // A 1080p RGBA frame: the actual per-frame input, 8.3 MB.
  { name: "frame-1920x1080", bytes: frameLike(1920, 1080) },
  // A frame differing from the one above in exactly one byte, so a hash that
  // ignored part of its input would be caught rather than merely agreed with.
  {
    name: "frame-1920x1080-1bit",
    bytes: (() => {
      const f = frameLike(1920, 1080);
      f[f.length - 3] = (f[f.length - 3] ?? 0) ^ 0x01;
      return f;
    })(),
  },
];



type Row = { name: string; bytes: number } & Record<HashAlgorithm, string>;

const rows: Row[] = VECTORS.map((v) => ({
  name: v.name,
  bytes: v.bytes.length,
  fast: hashFrame(v.bytes, "fast"),
  sha256: hashFrame(v.bytes, "sha256"),
}));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ bun: Bun.version, platform: `${process.platform}/${process.arch}`, rows }, null, 2));
} else {
  console.log(`bun ${Bun.version} on ${process.platform}/${process.arch}`);
  console.log("");
  console.log(`${"vector".padEnd(24)}${"bytes".padStart(9)}  ${"fast (wyhash)".padEnd(18)}sha256`);
  for (const r of rows) {
    console.log(`${r.name.padEnd(24)}${String(r.bytes).padStart(9)}  ${r.fast.padEnd(18)}${r.sha256.slice(0, 16)}…`);
  }
}
