/**
 * CLI footage wiring — the four cases the spec requires.
 *
 * No full-film render. openFootage fails loud before it needs a real world
 * for the missing-source and missing-prefix cases, and the cache key is a
 * pure function of the pixel-affecting inputs.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aspectDrift,
  assertAspectFit,
  clipFrameAt,
  footageCacheKey,
  openFootage,
  type FootageCacheKeyInput,
} from "../src/cli/footage.ts";
import { ingestScaleFilter } from "../src/footage/ingest.ts";
import type { ResolvedComposition } from "../src/cli/resolve.ts";
import type { BootedWorld } from "../src/runtime/boot.ts";
import {
  EMPTY_SOUND,
  parseSidecar,
  type FootageTrack,
  type MotionSidecar,
} from "../src/manifest/sidecar.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function sidecar(footage: FootageTrack[], durationFrames = 30): MotionSidecar {
  return {
    motion: 1,
    durationFrames,
    fps: 30,
    supersample: 1,
    footage,
    sound: EMPTY_SOUND,
    layoutAllow: [],
    assertions: [],
  };
}

function composition(
  footage: FootageTrack[],
  dir = `${ROOT}/compositions/smoke`,
  durationFrames = 30,
): ResolvedComposition {
  return {
    dir,
    entryPath: `${dir}/main.tsx`,
    pocketPath: `${dir}/pocket.json`,
    sidecarPath: `${dir}/pocket-motion.json`,
    pocket: {},
    sidecar: sidecar(footage, durationFrames),
    compositionId: "test",
    outputName: "test",
    distDir: `${dir}/dist`,
    bundlePath: `${dir}/dist/main.js`,
    pakPath: `${dir}/dist/main.pak`,
    width: 1080,
    height: 1920,
    fps: 30,
    durationFrames,
    supersample: 1,
    shutter: null,
    buildCommand: "unused",
    buildArgs: ["unused"],
  };
}

const TRACK: FootageTrack = {
  id: "a-roll",
  src: "assets/synthetic/bars-9x16-30fps.mp4",
  nodePrefix: "footage:a-roll",
  tile: 512,
  grid: [3, 4],
  startFrame: 0,
  endFrame: 30,
  sourceFrame: 0,
};

const world = {} as BootedWorld;

describe("openFootage — no footage", () => {
  test("a sidecar with no footage gets no layer", async () => {
    const handle = await openFootage(composition([]), world, { i: 0, k: [] });
    expect(handle).toBeNull();
  });
});

describe("openFootage — loud failures", () => {
  test("a declared track whose source is missing names the file", async () => {
    const track: FootageTrack = {
      ...TRACK,
      src: "assets/synthetic/this-clip-does-not-exist.mp4",
    };
    let err: unknown;
    try {
      await openFootage(composition([track]), world, { i: 0, k: [] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("this-clip-does-not-exist.mp4");
    expect(message).toContain("a-roll");
  });

  test("a declared nodePrefix that matches no node names the prefix", async () => {
    const tree = {
      i: 0,
      k: [
        { i: 1, n: "title" },
        { i: 2, n: "footage:other/tile:0:0" },
      ],
    };
    let err: unknown;
    try {
      await openFootage(composition([TRACK]), world, tree);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("footage:a-roll");
    expect(message).toContain("title");
    expect(message).toContain("footage:other/tile:0:0");
  });
});

describe("footage cache key", () => {
  const base = {
    srcSha256: "aa".repeat(32),
    tile: 512,
    fps: 30,
    width: 1080,
    height: 1920,
    frames: 300,
    fit: "stretch" as const,
  };

  test("the same inputs produce the same key", () => {
    expect(footageCacheKey(base)).toBe(footageCacheKey({ ...base }));
  });

  test("changes when any pixel-affecting input changes", () => {
    const origin = footageCacheKey(base);
    const variants: FootageCacheKeyInput[] = [
      { ...base, srcSha256: "bb".repeat(32) },
      { ...base, tile: 256 },
      { ...base, fps: 15 },
      { ...base, width: 720 },
      { ...base, height: 1280 },
      { ...base, frames: 180 },
      { ...base, fit: "cover" },
      { ...base, fit: "contain" },
    ];
    const keys = new Set(variants.map(footageCacheKey));
    expect(keys.size).toBe(variants.length);
    expect(keys.has(origin)).toBe(false);
  });

  test("changes when fit changes", () => {
    const stretch = footageCacheKey({ ...base, fit: "stretch" });
    const cover = footageCacheKey({ ...base, fit: "cover" });
    const contain = footageCacheKey({ ...base, fit: "contain" });
    expect(new Set([stretch, cover, contain]).size).toBe(3);
  });

  // The other half of the same claim, and the one with a cost attached:
  // moving a cut must not re-decode the clip. An author trimming a film to an
  // exact length changes placement on almost every iteration.
  test("does not change when only the placement does", () => {
    const origin = footageCacheKey(base);
    for (const extra of [
      { startFrame: 12 },
      { endFrame: 60 },
      { sourceFrame: 8 },
      { durationFrames: 60 },
      { grid: [2, 2] as const },
    ]) {
      expect(footageCacheKey({ ...base, ...extra } as FootageCacheKeyInput)).toBe(origin);
    }
  });
});

describe("aspect drift", () => {
  test("exact ratios sit at 0", () => {
    expect(aspectDrift(1280, 720, 960, 540)).toBe(0);
    expect(aspectDrift(720, 1280, 1080, 1920)).toBe(0);
  });

  // 100×101 → 100×100: factor = 100/101, drift ≈ 0.990 px — rounding.
  // 101×100 → 100×100: factor = 1.01,     drift = 1 px     — distortion.
  test("a far-edge move below 1 px is rounding and keeps today's filter", () => {
    expect(aspectDrift(100, 101, 100, 100)).toBeLessThan(1);
    expect(
      assertAspectFit({ id: "t" }, { width: 100, height: 101 }, { width: 100, height: 100 }),
    ).toBe("stretch");
  });

  test("a far-edge move of 1 px is a distortion and needs an explicit fit", () => {
    expect(aspectDrift(101, 100, 100, 100)).toBeGreaterThanOrEqual(1);
    expect(() =>
      assertAspectFit({ id: "t" }, { width: 101, height: 100 }, { width: 100, height: 100 }),
    ).toThrow(/101×100/);
    expect(
      assertAspectFit(
        { id: "t", fit: "cover" },
        { width: 101, height: 100 },
        { width: 100, height: 100 },
      ),
    ).toBe("cover");
  });

  test("the refusal names the sizes, the squeeze, and the three fits", () => {
    let err: unknown;
    try {
      assertAspectFit({ id: "kitchen-a" }, { width: 1280, height: 720 }, { width: 1080, height: 1920 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("kitchen-a");
    expect(message).toContain("1280×720");
    expect(message).toContain("1080×1920");
    expect(message).toMatch(/cover/);
    expect(message).toMatch(/contain/);
    expect(message).toMatch(/stretch/);
    expect(message).toMatch(/crop/);
    expect(message).toMatch(/pad/);
    expect(message).toMatch(/squeeze/);
  });
});

describe("ingest scale filter", () => {
  test("stretch is today's scale string, byte for byte", () => {
    const today = "scale=1080:1920:flags=lanczos+accurate_rnd+bitexact:in_range=tv:out_range=pc";
    expect(ingestScaleFilter(1080, 1920, "stretch")).toBe(today);
    expect(ingestScaleFilter(1080, 1920)).toBe(today);
  });

  // The reason the two rounding flags are in that string is an architecture
  // this machine cannot run: CI run 33599991463 reproduced 19 of 21 digests on
  // Linux/x86-64 and missed exactly the two compositions that declare footage.
  // A fit that keeps `lanczos` and loses `accurate_rnd` decodes to different
  // bytes there and the same bytes here, so nothing local would report it —
  // which is why every fit is pinned rather than only the one in use.
  test("every fit carries accurate_rnd and bitexact, not only the kernel", () => {
    for (const fit of ["stretch", "cover", "contain"] as const) {
      const filter = ingestScaleFilter(1080, 1920, fit);
      for (const scale of filter.split(",").filter((f) => f.startsWith("scale="))) {
        expect(scale).toContain("flags=lanczos+accurate_rnd+bitexact");
      }
    }
  });

  test("cover crops after the scale, contain pads after it", () => {
    expect(ingestScaleFilter(1080, 1920, "cover")).toBe(
      "scale=1080:1920:force_original_aspect_ratio=increase" +
        ":flags=lanczos+accurate_rnd+bitexact:in_range=tv:out_range=pc,crop=1080:1920",
    );
    expect(ingestScaleFilter(1080, 1920, "contain")).toBe(
      "scale=1080:1920:force_original_aspect_ratio=decrease" +
        ":flags=lanczos+accurate_rnd+bitexact:in_range=tv:out_range=pc," +
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    );
  });
});

describe("footage placement window", () => {
  test("a track with only startFrame runs from that frame to the composition end, from clip frame 0", () => {
    const parsed = parseSidecar({
      motion: 1,
      durationFrames: 30,
      fps: 30,
      footage: [
        {
          id: "a-roll",
          src: "clip.mp4",
          nodePrefix: "footage:a-roll",
          tile: 512,
          grid: [2, 2],
          startFrame: 10,
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const track = parsed.value.footage[0]!;
    expect(track.endFrame).toBe(30);
    expect(track.sourceFrame).toBe(0);
    expect(clipFrameAt(track, 9)).toBeUndefined();
    expect(clipFrameAt(track, 10)).toBe(0);
    expect(clipFrameAt(track, 29)).toBe(19);
    expect(clipFrameAt(track, 30)).toBeUndefined();
  });

  test("the parser rejects endFrame <= startFrame and endFrame > durationFrames, each with its own code", () => {
    const base = {
      motion: 1 as const,
      durationFrames: 30,
      fps: 30,
      footage: [
        {
          id: "a-roll",
          src: "clip.mp4",
          nodePrefix: "footage:a-roll",
          tile: 512,
          grid: [2, 2],
          startFrame: 10,
          endFrame: 10,
        },
      ],
    };
    const equal = parseSidecar(base);
    expect(equal.ok).toBe(false);
    if (equal.ok) throw new Error("unreachable");
    expect(equal.diagnostics.some((d) => d.code === "sidecar.footage.endFrame.notAfterStart")).toBe(true);

    const past = parseSidecar({
      ...base,
      footage: [{ ...base.footage[0]!, endFrame: 31 }],
    });
    expect(past.ok).toBe(false);
    if (past.ok) throw new Error("unreachable");
    expect(past.diagnostics.some((d) => d.code === "sidecar.footage.endFrame.pastDuration")).toBe(true);
  });
});

describe("openFootage — placement window", () => {
  const TILE = 16;
  const PX = 8;
  let work = "";
  let clipRel = "";

  const tileTree = (...prefixes: string[]) => ({
    i: 0,
    k: prefixes.map((n, i) => ({
      i: i + 1,
      n: `${n}/tile:0:0`,
      c: `absolute w-[${PX}px] h-[${PX}px] left-[0px] top-[0px]`,
    })),
  });

  function recordingWorld(): { world: BootedWorld; uploads: Uint8Array[] } {
    const uploads: Uint8Array[] = [];
    let next = 1;
    const world = {
      ops: {
        uploadTexture: (buf: Uint8Array) => {
          uploads.push(Uint8Array.from(buf));
          return next++;
        },
        setImage: () => {},
        setImageUv: () => {},
        freeTexture: () => {},
      },
    } as unknown as BootedWorld;
    return { world, uploads };
  }

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "pocketjs-motion-window-"));
    // repoRootOf looks for a `compositions` ancestor.
    const dir = join(work, "compositions", "win");
    await mkdir(dir, { recursive: true });
    const clip = join(work, "clip.mp4");
    // 1s red then 1s blue @ 30fps. ffprobe duration ≈ 2s → CLI ingest
    // floor(2*30)-1 = 59 frames. Red occupies the first half.
    const proc = Bun.spawn(
      [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=30:d=1",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=30:d=1",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
        "-pix_fmt", "yuv420p",
        clip,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const err = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) {
      throw new Error(`test fixture ffmpeg failed: ${err}`);
    }
    clipRel = "clip.mp4";
  });

  afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  function winComposition(footage: FootageTrack[], durationFrames: number): ResolvedComposition {
    const dir = join(work, "compositions", "win");
    return {
      ...composition(footage, dir, durationFrames),
      bundlePath: join(dir, "dist", "main.js"),
      pakPath: join(dir, "dist", "main.pak"),
      distDir: join(dir, "dist"),
    };
  }

  function tinyTrack(overrides: Partial<FootageTrack> = {}): FootageTrack {
    return {
      id: "a-roll",
      src: clipRel,
      nodePrefix: "footage:a-roll",
      tile: TILE,
      grid: [1, 1],
      startFrame: 0,
      endFrame: 20,
      sourceFrame: 0,
      ...overrides,
    };
  }

  test("a window longer than the clip fails at open and names both frame counts", async () => {
    const track = tinyTrack({ endFrame: 100 });
    let err: unknown;
    try {
      await openFootage(winComposition([track], 100), recordingWorld().world, tileTree(track.nodePrefix));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("a-roll");
    expect(message).toMatch(/asks for 100 frames/);
    expect(message).toMatch(/clip has \d+/);
    const have = Number(/clip has (\d+)/.exec(message)?.[1]);
    expect(have).toBeGreaterThan(0);
    expect(have).toBeLessThan(100);
    expect(message).toContain("largest endFrame");
  });

  test("sourceFrame offsets the clip: two tracks on one src present different pictures on the same frame", async () => {
    const head = tinyTrack({ id: "head", nodePrefix: "footage:head", sourceFrame: 0, startFrame: 0, endFrame: 10 });
    const tail = tinyTrack({ id: "tail", nodePrefix: "footage:tail", sourceFrame: 40, startFrame: 0, endFrame: 10 });
    const { world, uploads } = recordingWorld();
    const handle = await openFootage(winComposition([head, tail], 30), world, tileTree(head.nodePrefix, tail.nodePrefix));
    expect(handle).not.toBeNull();
    handle!.present(0);
    // One tile each → two uploads. Red vs blue after yuv420p is still a
    // different buffer; the offset is the only reason they would differ.
    expect(uploads.length).toBe(2);
    expect(Buffer.from(uploads[0]!).equals(Buffer.from(uploads[1]!))).toBe(false);
    expect(clipFrameAt(head, 0)).not.toBe(clipFrameAt(tail, 0));
    await handle!.close();
  });
});

describe("openFootage — aspect fit", () => {
  const TILE = 32;
  let work = "";
  let clipRel = "";

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "pocketjs-motion-fit-"));
    const dir = join(work, "compositions", "fit");
    await mkdir(dir, { recursive: true });
    const clip = join(work, "wide.mp4");
    // 16×8 landscape into an 8×16 box. drift = |1 - 4| * 8 = 24 px.
    const proc = Bun.spawn(
      [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=16x8:r=30:d=1",
        "-pix_fmt", "yuv420p",
        clip,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const err = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) {
      throw new Error(`test fixture ffmpeg failed: ${err}`);
    }
    clipRel = "wide.mp4";
  });

  afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  function fitComposition(footage: FootageTrack[]): ResolvedComposition {
    const dir = join(work, "compositions", "fit");
    return {
      ...composition(footage, dir, 10),
      bundlePath: join(dir, "dist", "main.js"),
      pakPath: join(dir, "dist", "main.pak"),
      distDir: join(dir, "dist"),
    };
  }

  const tree = {
    i: 0,
    k: [
      {
        i: 1,
        n: "footage:a-roll/tile:0:0",
        c: "absolute w-[8px] h-[16px] left-[0px] top-[0px]",
      },
    ],
  };

  function mismatchTrack(overrides: Partial<FootageTrack> = {}): FootageTrack {
    return {
      id: "a-roll",
      src: clipRel,
      nodePrefix: "footage:a-roll",
      tile: TILE,
      grid: [1, 1],
      startFrame: 0,
      endFrame: 10,
      sourceFrame: 0,
      ...overrides,
    };
  }

  test("a mismatched aspect without fit fails at open and names both sizes", async () => {
    let err: unknown;
    try {
      await openFootage(fitComposition([mismatchTrack()]), world, tree);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("a-roll");
    expect(message).toContain("16×8");
    expect(message).toContain("8×16");
    expect(message).toContain("cover");
    expect(message).toContain("contain");
    expect(message).toContain("stretch");
  });
});
