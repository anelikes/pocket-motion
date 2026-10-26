/**
 * The footage layer's sampling contract.
 *
 * Nearest is the rasteriser's golden-pinned default and the right answer for
 * footage drawn at its ingested size. Bilinear is opt-in per texture
 * (`spec::img::FLAG_LINEAR`) and only reachable through the op `patches/0004`
 * adds, so the interesting cases are which upload op gets called and what
 * happens when the one being asked for is not there.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FootageLayer, type FootageOps } from "../src/footage/layer.ts";
import { gridOf, placeTile } from "../src/footage/tiling.ts";
import type { IngestManifest } from "../src/footage/ingest.ts";

// A 4px texture bleeds 1 texel each side, so it DRAWS 2 — which makes a 4x2
// picture exactly two tiles, the same shape as the shipping 1080p grid.
const TILE = 4;
const W = 4, H = 2, FRAMES = 2;
const MANIFEST: IngestManifest = {
  src: "test",
  width: W,
  height: H,
  fps: 30,
  spans: [[0, FRAMES]],
  frames: FRAMES,
  tile: TILE,
  grid: gridOf(W, H, TILE),
  sha256: "0".repeat(64),
  bytes: W * H * 4 * FRAMES,
  recipe: [],
  ffmpeg: "test",
};

/** One tile node per manifest cell, named the way the layer resolves them. */
const TREE = {
  i: 0,
  k: [
    { i: 11, n: "footage:t/tile:0:0" },
    { i: 12, n: "footage:t/tile:1:0" },
  ],
};

interface Call {
  readonly op: "uploadTexture" | "uploadTextureFlags";
  readonly flags?: number;
}

interface UvCall {
  readonly id: number;
  readonly uv: readonly number[];
}

interface Rec {
  ops: FootageOps;
  calls: Call[];
  bound: number[];
  uvs: UvCall[];
}

function recordingOps(withFlags: boolean, withUv = true): Rec {
  const calls: Call[] = [];
  const bound: number[] = [];
  const uvs: UvCall[] = [];
  let next = 0;
  const ops: FootageOps = {
    uploadTexture: () => {
      calls.push({ op: "uploadTexture" });
      return next++;
    },
    setImage: (id) => {
      bound.push(id);
    },
  };
  if (withFlags) {
    ops.uploadTextureFlags = (_b, _w, _h, _psm, flags) => {
      calls.push({ op: "uploadTextureFlags", flags });
      return next++;
    };
  }
  if (withUv) ops.setImageUv = (id, u0, v0, u1, v1) => uvs.push({ id, uv: [u0, v0, u1, v1] });
  return { ops, calls, bound, uvs };
}

let dir = "";
let rawPath = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-footage-"));
  rawPath = join(dir, "frames.rgba");
  await writeFile(rawPath, Buffer.alloc(MANIFEST.bytes));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const create = (ops: FootageOps, linear?: boolean) =>
  FootageLayer.create({ manifest: MANIFEST, rawPath, nodePrefix: "footage:t", tree: TREE, ops, linear });

describe("footage sampling mode", () => {
  test("defaults to the flagless upload even when the host offers flags", async () => {
    const { ops, calls, bound } = recordingOps(true);
    const layer = await create(ops);
    layer.present(0);
    expect(calls.map((c) => c.op)).toEqual(["uploadTexture", "uploadTexture"]);
    expect(bound).toEqual([11, 12]);
    layer.close();
  });

  test("linear uploads through uploadTextureFlags with FLAG_LINEAR", async () => {
    const { ops, calls, bound } = recordingOps(true);
    const layer = await create(ops, true);
    layer.present(0);
    // spec::img::FLAG_LINEAR — bit 1, so 2. FLAG_RLE (bit 0) must stay clear:
    // these are raw pixels, not a PackBits stream.
    expect(calls).toEqual([
      { op: "uploadTextureFlags", flags: 2 },
      { op: "uploadTextureFlags", flags: 2 },
    ]);
    expect(bound).toEqual([11, 12]);
    layer.close();
  });

  test("each tile gets the UV rect its geometry says, once, at mount", async () => {
    const { ops, uvs } = recordingOps(true);
    const layer = await create(ops);
    const [cols, rows] = MANIFEST.grid;
    const want = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        want.push({ id: 11 + r * cols + c, uv: [...placeTile(W, H, TILE, c, r).uv] });
      }
    }
    expect(uvs).toEqual(want);
    // A 4px texture with one bleed texel each side draws texels [1, 3).
    expect(uvs[0]!.uv).toEqual([0.25, 0.25, 0.75, 0.75]);
    // Stated at mount, not per frame — the node keeps it across rebinding.
    layer.present(0);
    layer.present(1);
    expect(uvs).toHaveLength(cols * rows);
    layer.close();
  });

  test("a host without setImageUv throws rather than stretching the bleed", async () => {
    const { ops, calls } = recordingOps(true, false);
    await expect(create(ops)).rejects.toThrow(/setImageUv/);
    expect(calls).toEqual([]);
  });

  test("linear on a host without the op throws instead of sampling nearest", async () => {
    const { ops, calls } = recordingOps(false);
    await expect(create(ops, true)).rejects.toThrow(/uploadTextureFlags/);
    // The point of the throw: nothing was uploaded the wrong way first.
    expect(calls).toEqual([]);
  });

  test("a host without the op is still fine for the default path", async () => {
    const { ops, calls } = recordingOps(false);
    const layer = await create(ops);
    layer.present(0);
    expect(calls.map((c) => c.op)).toEqual(["uploadTexture", "uploadTexture"]);
    layer.close();
  });

  // The manifest's spans are where each source frame sits. Two spans with a
  // gap between them: a frame in the gap was never written, and the clamp
  // this replaced would have shown a picture from one side of it.
  test("present addresses source frames through the spans and refuses one outside them", async () => {
    const frame0 = Buffer.alloc(W * H * 4, 0x11);
    const frame1 = Buffer.alloc(W * H * 4, 0x22);
    const twoPath = join(dir, "two-frames.rgba");
    await writeFile(twoPath, Buffer.concat([frame0, frame1]));

    const uploads: Uint8Array[] = [];
    let next = 0;
    const rec = recordingOps(false);
    rec.ops.uploadTexture = (buf) => {
      rec.calls.push({ op: "uploadTexture" });
      uploads.push(Uint8Array.from(buf));
      return next++;
    };

    const layer = await FootageLayer.create({
      manifest: { ...MANIFEST, spans: [[3, 4], [7, 8]] },
      rawPath: twoPath,
      nodePrefix: "footage:t",
      tree: TREE,
      ops: rec.ops,
    });

    layer.present(3);
    const first = Buffer.from(uploads[0]!);
    expect(first.subarray(0, 4).equals(Buffer.alloc(4, 0x11))).toBe(true);
    layer.present(7);
    const second = Buffer.from(uploads[2]!);
    expect(second.subarray(0, 4).equals(Buffer.alloc(4, 0x22))).toBe(true);
    layer.present(3);
    expect(Buffer.from(uploads[4]!).equals(first)).toBe(true);
    expect(uploads).toHaveLength(6);

    for (const n of [-1, 0, 4, 5, 6, 8, 99]) {
      expect(() => layer.present(n)).toThrow(/outside the decoded spans \[\[3,4\],\[7,8\]\]/);
    }
    expect(uploads).toHaveLength(6);

    layer.close();
    layer.close();
    expect(() => layer.present(3)).toThrow(/after close/);
  });

  test("a manifest whose spans do not add up to its frames is refused at create", async () => {
    const { ops } = recordingOps(false);
    await expect(
      FootageLayer.create({
        manifest: { ...MANIFEST, spans: [[0, 3]] },
        rawPath,
        nodePrefix: "footage:t",
        tree: TREE,
        ops,
      }),
    ).rejects.toThrow(/holds 2 frames but its spans \[\[0,3\]\] cover 3/);
  });
});
