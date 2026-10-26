/**
 * CLI footage wiring — the four cases the spec requires.
 *
 * No full-film render. openFootage fails loud before it needs a real world
 * for the missing-source and missing-prefix cases, and the cache key is a
 * pure function of everything a decode's bytes depend on.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aspectDrift,
  assertAspectFit,
  clipFrameAt,
  footageCacheKey,
  openFootage,
  reachableSpan,
  type FootageCacheKeyInput,
} from "../src/cli/footage.ts";
import {
  ingestFootage,
  ingestRecipe,
  ingestScaleFilter,
  RECIPE_SRC,
  unionSpans,
  type IngestManifest,
} from "../src/footage/ingest.ts";
import { FootageLayer } from "../src/footage/layer.ts";
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
  const spans = [[0, 300]] as const;
  const base: FootageCacheKeyInput = {
    srcSha256: "aa".repeat(32),
    tile: 512,
    fps: 30,
    width: 1080,
    height: 1920,
    fit: "stretch",
    spans,
    recipe: ingestRecipe({ width: 1080, height: 1920, fps: 30, spans, fit: "stretch" }),
    ffmpeg: "ff".repeat(32),
  };

  test("the same inputs produce the same key", () => {
    expect(footageCacheKey(base)).toBe(footageCacheKey({ ...base }));
  });

  test("changes when any input a decode depends on changes", () => {
    const origin = footageCacheKey(base);
    const variants: FootageCacheKeyInput[] = [
      { ...base, srcSha256: "bb".repeat(32) },
      { ...base, tile: 256 },
      { ...base, fps: 15 },
      { ...base, width: 720 },
      { ...base, height: 1280 },
      { ...base, fit: "cover" },
      { ...base, fit: "contain" },
      { ...base, spans: [[0, 180]] },
      { ...base, spans: [[20, 300]] },
      { ...base, spans: [[0, 60], [89, 300]] },
      { ...base, ffmpeg: "fe".repeat(32) },
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

  // What the ingest code decides, as opposed to what the sidecar decides. The
  // key used to hold only the second, so editing a scaler flag left every warm
  // `dist` serving the artifact the previous flags made. Every token of the
  // argv but the source path is the recipe, and each one moves the key.
  test("changes when any token of the recipe changes", () => {
    const origin = footageCacheKey(base);
    expect(base.recipe).toContain(RECIPE_SRC);
    const keys = new Set<string>([origin]);
    base.recipe.forEach((token, i) => {
      if (token === RECIPE_SRC) return;
      const recipe = base.recipe.with(i, `${token}~`);
      keys.add(footageCacheKey({ ...base, recipe }));
    });
    expect(keys.size).toBe(base.recipe.length);
  });

  test("the recipe is the argv the ingest runs, with the source path taken out", () => {
    expect(base.recipe).toEqual([
      "ffmpeg", "-v", "error",
      "-fflags", "+bitexact",
      "-flags", "+bitexact",
      "-sws_flags", "+accurate_rnd+bitexact",
      "-i", RECIPE_SRC,
      "-vf", ingestScaleFilter(1080, 1920, "stretch"),
      "-r", "30",
      "-frames:v", "300",
      "-pix_fmt", "rgba",
      "-f", "rawvideo",
      "pipe:1",
    ]);
  });

  // The other half: moving a cut in the film without changing which source
  // frames it shows reuses the decode, and so does declaring the same frames
  // in another order.
  test("does not change when placement moves without changing the frames shown", () => {
    const at0 = reachableSpan({ startFrame: 0, endFrame: 60, sourceFrame: 89 }, 150);
    const at90 = reachableSpan({ startFrame: 90, endFrame: 150, sourceFrame: 89 }, 150);
    expect(at0).toEqual([89, 149]);
    expect(at90).toEqual(at0);
    expect(unionSpans([[89, 179], [0, 60]])).toEqual(unionSpans([[0, 60], [89, 179]]));
    const key = (s: readonly (readonly [number, number])[]) =>
      footageCacheKey({ ...base, spans: unionSpans(s) });
    expect(key([[0, 60], [89, 179]])).toBe(key([[89, 179], [0, 60]]));
    expect(key([[0, 60], [30, 90]])).toBe(key([[0, 90]]));
    expect(key([[0, 60], [60, 90]])).toBe(key([[0, 90]]));
  });
});

describe("reachable span", () => {
  test("a track's span is its window mapped onto the clip, ended by the film", () => {
    expect(reachableSpan({ startFrame: 30, endFrame: 150, sourceFrame: 20 }, 180)).toEqual([20, 140]);
    expect(reachableSpan({ startFrame: 0, endFrame: 101, sourceFrame: 0 }, 101)).toEqual([0, 101]);
    // The parser refuses endFrame past the film; the span does not rely on it.
    expect(reachableSpan({ startFrame: 10, endFrame: 200, sourceFrame: 5 }, 60)).toEqual([5, 55]);
  });

  test("the union sorts, merges overlapping and touching spans, and drops empty ones", () => {
    expect(unionSpans([[89, 179], [0, 60]])).toEqual([[0, 60], [89, 179]]);
    expect(unionSpans([[0, 60], [40, 90], [90, 100], [5, 5]])).toEqual([[0, 100]]);
    expect(unionSpans([[10, 20], [0, 5], [12, 15]])).toEqual([[0, 5], [10, 20]]);
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

describe("openFootage — decoded spans and the recipe", () => {
  const TILE = 16;
  const PX = 8;
  const FRAME = PX * PX * 4;
  let work = "";
  let clipPath = "";
  let whole: { manifest: IngestManifest; bytes: Buffer };

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "pocketjs-motion-spans-"));
    await mkdir(join(work, "compositions", "spans"), { recursive: true });
    clipPath = join(work, "ramp.mp4");
    // Luma 4N on frame N, losslessly encoded, so every frame of the 2 s clip is
    // a different picture and an off-by-one shows as a wrong buffer.
    const proc = Bun.spawn(
      [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", `nullsrc=s=${PX}x${PX}:r=30:d=2,geq=lum='4*N':cb=128:cr=128`,
        "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p",
        clipPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const err = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) throw new Error(`test fixture ffmpeg failed: ${err}`);
    // The whole clip, decoded the way every ingest did before spans: the
    // reference each span has to be a byte slice of. 2 s at 30 fps is 59
    // frames once `sourceFrameCount` drops the last.
    const outDir = join(work, "whole");
    const manifest = await ingestFootage({
      src: clipPath, outDir, width: PX, height: PX, fps: 30, spans: [[0, 59]], tile: TILE,
    });
    whole = { manifest, bytes: readFileSync(join(outDir, "frames.rgba")) };
  });

  afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  const dir = () => join(work, "compositions", "spans");
  const footageDir = (id: string) => join(dir(), "dist", "footage", id);

  function spansComposition(footage: FootageTrack[], durationFrames: number): ResolvedComposition {
    return {
      ...composition(footage, dir(), durationFrames),
      bundlePath: join(dir(), "dist", "main.js"),
      pakPath: join(dir(), "dist", "main.pak"),
      distDir: join(dir(), "dist"),
    };
  }

  const tree = (...prefixes: string[]) => ({
    i: 0,
    k: prefixes.map((n, i) => ({
      i: i + 1,
      n: `${n}/tile:0:0`,
      c: `absolute w-[${PX}px] h-[${PX}px] left-[0px] top-[0px]`,
    })),
  });

  function uploadingWorld(): { world: BootedWorld; uploads: Uint8Array[] } {
    const uploads: Uint8Array[] = [];
    const world = {
      ops: {
        uploadTexture: (buf: Uint8Array) => uploads.push(Uint8Array.from(buf)),
        setImage: () => {},
        setImageUv: () => {},
        freeTexture: () => {},
      },
    } as unknown as BootedWorld;
    return { world, uploads };
  }

  function track(id: string, o: Partial<FootageTrack>): FootageTrack {
    return {
      id,
      src: "ramp.mp4",
      nodePrefix: `footage:${id}`,
      tile: TILE,
      grid: [1, 1],
      startFrame: 0,
      endFrame: 10,
      sourceFrame: 0,
      ...o,
    };
  }

  // The defect this answers: a 101-frame window kept all 179 frames of its
  // clip on disk, and one clip mapped twice was decoded whole twice.
  test("one clip mapped twice is one artifact holding exactly the union of what each can show", async () => {
    await rm(join(dir(), "dist"), { recursive: true, force: true });
    const head = track("head", { startFrame: 0, endFrame: 10, sourceFrame: 0 });
    const tail = track("tail", { startFrame: 10, endFrame: 20, sourceFrame: 40 });
    // What a tree built before spans holds for `tail`: its own whole decode.
    // Nothing reads it once `head`'s artifact serves both, so it goes; a
    // directory that is not an ingest's is left alone.
    await mkdir(footageDir("tail"), { recursive: true });
    writeFileSync(join(footageDir("tail"), "cache.json"), "{}");
    writeFileSync(join(footageDir("tail"), "frames.rgba"), whole.bytes);
    await mkdir(footageDir("notes"), { recursive: true });
    writeFileSync(join(footageDir("notes"), "README"), "not an ingest");
    const { world, uploads } = uploadingWorld();
    const handle = await openFootage(spansComposition([head, tail], 30), world, tree(head.nodePrefix, tail.nodePrefix));

    const manifest = JSON.parse(readFileSync(join(footageDir("head"), "manifest.json"), "utf8")) as IngestManifest;
    expect(manifest.spans).toEqual([[0, 10], [40, 50]]);
    expect(manifest.frames).toBe(20);
    expect(existsSync(footageDir("tail"))).toBe(false);
    expect(existsSync(join(footageDir("notes"), "README"))).toBe(true);
    expect(handle!.hashes).toEqual({ head: manifest.sha256, tail: manifest.sha256 });

    // Byte for byte the frames a whole decode holds at those indices: stopping
    // the decode at frame 50 of 59 moved none of the 50 before it.
    const stored = readFileSync(join(footageDir("head"), "frames.rgba"));
    const slice = (a: number, b: number) => whole.bytes.subarray(a * FRAME, b * FRAME);
    expect(stored.equals(Buffer.concat([slice(0, 10), slice(40, 50)]))).toBe(true);

    // And `sourceFrame + (f - startFrame)` still lands on them: every
    // composition frame uploads what the whole clip's layer uploads for the
    // source frame that mapping names.
    const ref = uploadingWorld();
    const wholeLayer = await FootageLayer.create({
      manifest: whole.manifest,
      rawPath: join(work, "whole", "frames.rgba"),
      nodePrefix: head.nodePrefix,
      tree: tree(head.nodePrefix),
      ops: ref.world.ops as never,
    });
    for (let f = 0; f < 20; f++) {
      uploads.length = 0;
      handle!.present(f);
      const bind = f < 10 ? head : tail;
      expect(uploads).toHaveLength(1);
      wholeLayer.present(clipFrameAt(bind, f)!);
      expect(Buffer.from(uploads[0]!).equals(Buffer.from(ref.uploads.at(-1)!))).toBe(true);
    }
    wholeLayer.close();
    await handle!.close();
  });

  // The cache's half of the same defect: a key that holds what the sidecar
  // decides and not what the ingest code decides hands a warm `dist` the
  // artifact an older recipe made. The older recipe here is today's with
  // `+accurate_rnd+bitexact` taken out, roughly what ran before CI run
  // 33599991463 — which on aarch64 decodes the same bytes, so a stale hit
  // would have been invisible on the machine that made it. It is only ever a
  // key; nothing runs it. The planted artifact is filled with a byte no
  // decode of this clip produces, so a hit is seen in the hash.
  test("an artifact an older recipe made is decoded again, not handed back", async () => {
    await rm(join(dir(), "dist"), { recursive: true, force: true });
    const only = track("only", {});
    const open = async () => {
      const handle = await openFootage(spansComposition([only], 30), uploadingWorld().world, tree(only.nodePrefix));
      await handle!.close();
      return handle!.hashes.only!;
    };
    const fresh = await open();
    const cachePath = join(footageDir("only"), "cache.json");
    const manifestPath = join(footageDir("only"), "manifest.json");
    const record = JSON.parse(readFileSync(cachePath, "utf8")) as FootageCacheKeyInput & { key: string };
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as IngestManifest;
    // The recipe keyed is the recipe that ran.
    expect(record.recipe).toEqual(manifest.recipe);

    const plant = (recipe: readonly string[]) => {
      const { key: _key, ...input } = record;
      writeFileSync(join(footageDir("only"), "frames.rgba"), Buffer.alloc(manifest.bytes, 0x7f));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, sha256: "7f".repeat(32), recipe }));
      writeFileSync(cachePath, JSON.stringify({ ...input, recipe, key: footageCacheKey({ ...input, recipe }) }));
    };

    // Control: planted under today's recipe, the artifact IS handed back —
    // so what the next case measures is the recipe, not a cache that never hits.
    plant(record.recipe);
    expect(await open()).toBe("7f".repeat(32));

    const older = record.recipe.map((t) => t.replaceAll("+accurate_rnd+bitexact", ""));
    expect(older).not.toEqual(record.recipe);
    plant(older);
    expect(await open()).toBe(fresh);
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
