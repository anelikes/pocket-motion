/**
 * The frame hash.
 *
 * `fast` (wyhash) is verified equal to itself across darwin/arm64, linux/x64
 * and Bun 1.1 through 1.3 in `baselines/hash-portability.md`. That check is a
 * container run and cannot live in the suite, so what lives here is the part
 * that would tell us the ground moved: a handful of the same vectors, pinned to
 * the values both platforms produced. If a Bun upgrade changes `Bun.hash`,
 * these fail — which is the whole reason the default is not `fast`.
 */

import { describe, expect, test } from "bun:test";
import { FrameHashSequence, hashFrame } from "../src/render/hash.ts";
import { parseArgs } from "../src/cli/args.ts";

/** Same LCG as scripts/hash-vectors.ts — identical bytes on every platform. */
function noise(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

describe("fast hash is pinned to the values both platforms produced", () => {
  const CASES: readonly [name: string, bytes: Uint8Array, fast: string][] = [
    ["empty", new Uint8Array(0), "0409638ee2bde459"],
    ["one-zero", new Uint8Array(1), "fbe5af10e5f8bd85"],
    ["noise-8", noise(8, 0x9e3779b9 ^ 8), "395da491df619652"],
    ["noise-33", noise(33, 0x9e3779b9 ^ 33), "006645b761cca049"],
    ["zeros-4096", new Uint8Array(4096), "7d2c252f605255d3"],
    ["noise-65536", noise(65536, 12345), "17440eac1306d2e5"],
  ];

  for (const [name, bytes, want] of CASES) {
    test(name, () => {
      expect(hashFrame(bytes, "fast")).toBe(want);
    });
  }

  test("hashes are fixed-width, so the sequence digest cannot be ambiguous", () => {
    // A leading-zero hash must still be 16 chars: without the pad, "0a…" and
    // "a…" would join into the same rolling input as a different pair.
    for (let i = 0; i < 400; i++) {
      expect(hashFrame(noise(64, i), "fast")).toHaveLength(16);
    }
  });
});

describe("the two algorithms are distinguishable", () => {
  const frame = noise(4096, 7);

  test("they do not silently produce the same digest", () => {
    const a = new FrameHashSequence("fast");
    const b = new FrameHashSequence("sha256");
    a.push(frame);
    b.push(frame);
    expect(a.digest()).not.toBe(b.digest());
  });

  test("the sequence digest stays SHA-256 under both", () => {
    // The per-frame step is what `fast` changes; the identity of the whole
    // render remains a cryptographic commitment either way.
    for (const algo of ["fast", "sha256"] as const) {
      const s = new FrameHashSequence(algo);
      s.push(frame);
      expect(s.digest()).toHaveLength(64);
    }
  });

  test("frame order is part of the identity", () => {
    const one = noise(1024, 1);
    const two = noise(1024, 2);
    const ab = new FrameHashSequence("fast");
    ab.push(one);
    ab.push(two);
    const ba = new FrameHashSequence("fast");
    ba.push(two);
    ba.push(one);
    expect(ab.digest()).not.toBe(ba.digest());
  });
});

describe("--hash", () => {
  const parse = (argv: string[]) => parseArgs(["trace", "compositions/smoke", ...argv]).global;

  test("defaults to undefined, which render.ts reads as sha256", () => {
    expect(parse([]).hash).toBeUndefined();
  });

  for (const v of ["fast", "sha256"] as const) {
    test(`accepts ${v}`, () => {
      expect(parse(["--hash", v]).hash).toBe(v);
    });
  }

  test("rejects anything else rather than falling back to a default", () => {
    // Silently defaulting would be the bad outcome: a typo would produce a
    // digest under an algorithm the caller did not ask for.
    expect(() => parse(["--hash", "md5"])).toThrow(/fast or sha256/);
  });
});
