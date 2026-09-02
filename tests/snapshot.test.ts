/**
 * `snapshot`, and the one claim that makes it evidence.
 *
 * The un-annotated PNG has to be the same bytes `frame --at N` writes. Without
 * that, a sheet of frames is a rehearsal of the render rather than the render,
 * and every reading taken off it is a reading of a picture nothing delivers —
 * which is the thing `preview`'s `/frame` test exists to rule out one level
 * over.
 *
 * The second claim is the overlay's: it is drawn host-side on a COPY. A debug
 * layer inside the composition would be geometry in the draw list, would move
 * `ui_draw_hash` and the frame hash with it, and would make `layout` and
 * `visibility` report on a different picture from the one being delivered. The
 * test for it is that the clean file is byte-identical whether or not
 * `--annotate` was passed.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { writeBuildRecord } from "../src/render/build-record.ts";
import { run as runFrame } from "../src/cli/commands/frame.ts";
import {
  parseFrameList,
  run as runSnapshot,
  runFromArgv,
  safeName,
  snapshotName,
} from "../src/cli/commands/snapshot.ts";
import { sampleFrames } from "../src/cli/commands/visibility.ts";
import { cropFrame, drawText, textWidth, type Surface } from "../src/render/annotate.ts";
import { EXIT_OK } from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const DIR = join(ROOT, "compositions", "layout-codes");
const TMP = "/tmp/pocketjs-motion-snapshot-test";
const DIST = join(TMP, "dist");
const BUNDLE = join(DIST, "main.js");
const PAK = join(DIST, "main.pak");
const OUT = join(TMP, "out");

process.env.POCKETJS_ROOT = VENDOR;

function flags(extra: Record<string, unknown> = {}) {
  return { json: true, bundle: BUNDLE, pak: PAK, ...extra } as never;
}

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const argv = [
    "bun",
    join(VENDOR, "tools", "build.ts"),
    join(DIR, "main.tsx"),
    `--outdir=${DIST}`,
    "--framework=solid",
    "--no-config",
  ];
  const proc = Bun.spawn(argv, {
    cwd: VENDOR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, POCKETJS_ROOT: VENDOR },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 || !existsSync(BUNDLE)) {
    throw new Error(`layout-codes build failed (${code})\n${out}\n${err}`);
  }
  await writeBuildRecord(DIST, argv);
}, 180_000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("snapshot", () => {
  test("the un-annotated PNG is the same bytes `frame --at N` writes", async () => {
    const framePath = join(TMP, "by-frame.png");
    const a = await runFrame({ dir: DIR, at: 7, out: framePath, flags: flags() });
    expect(a.exitCode).toBe(EXIT_OK);

    const b = await runSnapshot({
      dir: DIR,
      out: OUT,
      at: [7],
      annotate: false,
      flags: flags(),
    });
    expect(b.exitCode).toBe(EXIT_OK);

    const fromFrame = readFileSync(framePath);
    const fromSnapshot = readFileSync(join(OUT, snapshotName(7)));
    expect(fromSnapshot.byteLength).toBe(fromFrame.byteLength);
    expect(Buffer.compare(fromSnapshot, fromFrame)).toBe(0);
  }, 120_000);

  test("--annotate writes a second file and does not touch the first", async () => {
    const plainDir = join(TMP, "plain");
    const markedDir = join(TMP, "marked");
    await runSnapshot({ dir: DIR, out: plainDir, at: [0], annotate: false, flags: flags() });
    const marked = await runSnapshot({
      dir: DIR,
      out: markedDir,
      at: [0],
      annotate: true,
      flags: flags(),
    });
    expect(marked.exitCode).toBe(EXIT_OK);

    const clean = readFileSync(join(plainDir, snapshotName(0)));
    const cleanBeside = readFileSync(join(markedDir, snapshotName(0)));
    // The base image is the same bytes with the overlay on and off. This is
    // the assertion that "annotate only overlays" is a fact rather than an
    // intention: writing the overlay into the buffer the clean file comes from
    // turns it red.
    expect(Buffer.compare(cleanBeside, clean)).toBe(0);

    const annotated = readFileSync(join(markedDir, snapshotName(0, ".annotated")));
    expect(Buffer.compare(annotated, clean)).not.toBe(0);

    const json = marked.json as { files: Array<{ annotated?: string; findings?: number }> };
    expect(json.files[0]?.annotated).toBe(join(markedDir, snapshotName(0, ".annotated")));
    // The fixture is one named node per code; the overlay is drawn from the
    // same findings `layout` prints.
    expect(json.files[0]?.findings).toBe(10);
  }, 120_000);

  test("--samples uses the grid `visibility` sweeps", async () => {
    const dir = join(TMP, "sampled");
    const result = await runSnapshot({
      dir: DIR,
      out: dir,
      samples: 4,
      annotate: false,
      flags: flags(),
    });
    const json = result.json as { frames: number[] };
    expect(json.frames).toEqual(sampleFrames(30, 4));
    for (const f of json.frames) {
      expect(existsSync(join(dir, snapshotName(f)))).toBe(true);
    }
  }, 120_000);

  test("--zoom writes a crop the size of the node's box plus its padding", async () => {
    const dir = join(TMP, "zoomed");
    const result = await runSnapshot({
      dir: DIR,
      out: dir,
      at: [0],
      annotate: false,
      zoom: "cut-off",
      flags: flags(),
    });
    const json = result.json as {
      files: Array<{ zoom?: string; zoomBox?: [number, number, number, number] }>;
    };
    const file = json.files[0]!;
    expect(file.zoom).toBe(join(dir, snapshotName(0, ".zoom-cut-off")));
    // `cut-off`'s box, as `layout --at 0` reports it.
    expect(file.zoomBox).toEqual([1200, 780, 720, 44]);
    expect(readFileSync(file.zoom!).byteLength).toBeGreaterThan(0);
  }, 120_000);

  /**
   * The crop is taken from the SAME buffer the overlay is drawn from, so
   * "annotate only overlays" has to hold inside one run and not only between
   * the files it writes. The clean PNG is written before the overlay exists, so
   * comparing the two clean files could never have caught an overlay that drew
   * into the buffer in place — this can, and does: making `annotateFrame` reuse
   * `frame.pixels` instead of copying turns exactly this red.
   */
  test("a zoom crop taken beside an overlay carries none of it", async () => {
    const withOverlay = join(TMP, "zoom-annotated");
    const withoutOverlay = join(TMP, "zoom-plain");
    await runSnapshot({
      dir: DIR,
      out: withOverlay,
      at: [0],
      annotate: true,
      zoom: "escapee",
      flags: flags(),
    });
    await runSnapshot({
      dir: DIR,
      out: withoutOverlay,
      at: [0],
      annotate: false,
      zoom: "escapee",
      flags: flags(),
    });
    const a = readFileSync(join(withOverlay, snapshotName(0, ".zoom-escapee")));
    const b = readFileSync(join(withoutOverlay, snapshotName(0, ".zoom-escapee")));
    expect(Buffer.compare(a, b)).toBe(0);
  }, 120_000);

  test("--zoom naming a node nothing carries says which names exist", async () => {
    await expect(
      runSnapshot({
        dir: DIR,
        out: join(TMP, "nope"),
        at: [0],
        annotate: false,
        zoom: "no-such-node",
        flags: flags(),
      }),
    ).rejects.toThrow(/names no node with that debugName.*escapee|no-such-node/s);
  }, 120_000);

  test("--at and --samples together is a usage error", async () => {
    await expect(
      runSnapshot({
        dir: DIR,
        out: OUT,
        at: [0],
        samples: 3,
        annotate: false,
        flags: flags(),
      }),
    ).rejects.toThrow(/name the same thing two ways/);
  });

  test("--out is required", async () => {
    await expect(runFromArgv([DIR, "--at", "0"])).rejects.toThrow(/needs --out/);
  });
});

describe("the frame list", () => {
  test("ascending and de-duplicated, so a forward-only source can serve it", () => {
    expect(parseFrameList("12,3,3,0")).toEqual([0, 3, 12]);
    expect(parseFrameList(" 5 ")).toEqual([5]);
  });

  test("anything that is not a frame index is a usage error", () => {
    expect(() => parseFrameList("1,two")).toThrow(/is not one/);
    expect(() => parseFrameList("-4")).toThrow(/is not one/);
    expect(() => parseFrameList(",,")).toThrow(/names no frames/);
  });
});

describe("the overlay's own drawing", () => {
  const surface = (w: number, h: number): Surface => ({
    pixels: new Uint8Array(w * h * 4),
    width: w,
    height: h,
  });

  test("text lands inside the width it reports", () => {
    const s = surface(200, 40);
    drawText(s, 4, 4, "ab-12", [255, 255, 255, 255], 2);
    const w = textWidth("ab-12", 2);
    let maxX = -1;
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        if (s.pixels[(y * s.width + x) * 4 + 3]! > 0) maxX = Math.max(maxX, x);
      }
    }
    expect(maxX).toBeGreaterThan(0);
    expect(maxX).toBeLessThan(4 + w);
  });

  test("a crop that starts outside the frame comes back as the part that exists", () => {
    const s = surface(10, 10);
    const c = cropFrame(s, -5, -5, 8, 8);
    expect([c.width, c.height]).toEqual([3, 3]);
    const inside = cropFrame(s, 2, 2, 4, 4);
    expect([inside.width, inside.height]).toEqual([4, 4]);
    expect(inside.pixels.length).toBe(4 * 4 * 4);
  });

  test("a filename is a filename even when the node name is a tile address", () => {
    expect(safeName("footage:a-roll/tile:2:1")).toBe("footage-a-roll-tile-2-1");
    expect(safeName("::")).toBe("node");
  });
});
