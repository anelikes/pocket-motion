/**
 * The raster reuse (`src/render/reuse.ts`) delivers the frames a full raster
 * would, and the encode leg's `--encoder` and `--preset` say what they do.
 *
 * Every reuse guard compares a render with the reuse on against the same
 * render with it off, frame hash by frame hash, so what each one asserts is
 * "these pixels are the ones the raster would have produced", read off the
 * pixels. Each was watched red under the edit named:
 *
 * - "holds and changes": red with `RasterReuse.read` comparing the PREVIOUS
 *   frame's key against the one before it (the key of the wrong frame): 27
 *   of `highlight`'s 240 frames were delivered as the frame before.
 * - "under a shutter": red with `rasterKey` taking `ui_draw_hash` (the tick's
 *   draw list) in place of the exposure's fold: frame 1 was delivered as
 *   frame 0, and frame 8 as frame 7's blur, held to the end.
 * - "a freed texture": red with `rasterKey` returning the draw hash without
 *   the raster revision: frames 4 to 7 were delivered with the image the
 *   core no longer draws.
 * - "a detached view": red with the `byteLength > 0` check removed — the
 *   reuse handed back a view of zero bytes.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { scratchTree } from "../src/cli/footage.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { EXIT_OK, EXIT_USAGE } from "../src/cli/types.ts";
import {
  VIDEOTOOLBOX_QUALITY,
  assertEncoderAvailable,
  assertEncoderSupported,
  encoderSettings,
  ffmpegArgs,
} from "../src/render/encode.ts";
import { render, type RenderOptions } from "../src/render/render.ts";
import { RasterReuse } from "../src/render/reuse.ts";
import { WasmFrameSource } from "../src/runtime/frame-source.ts";

const ROOT = resolve(import.meta.dir, "..");
const HOLDS = "compositions/captions/highlight";
const IMAGES = "compositions/images";
const TMP = mkdtempSync(join(tmpdir(), "pocketjs-motion-reuse-"));

const LEDGER = (
  JSON.parse(readFileSync(join(ROOT, "baselines/digests.json"), "utf8")) as {
    compositions: Record<string, { digest: string }>;
  }
).compositions;

const built: Record<string, ResolvedComposition> = {};

beforeAll(async () => {
  for (const dir of [HOLDS, IMAGES]) {
    const resolved = await resolveComposition({ dir: join(ROOT, dir), flags: { json: false }, requireBundle: false });
    if (!resolved.ok) throw new Error(`${dir}: ${resolved.message}`);
    await runBuild(resolved.value);
    built[dir] = resolved.value;
  }
}, 600_000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function optionsOf(c: ResolvedComposition): RenderOptions {
  return {
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
    width: c.width,
    height: c.height,
    hz: c.fps,
    durationFrames: c.durationFrames,
    renderScale: c.supersample,
    shutter: c.shutter,
    hashAlgorithm: "fast",
  };
}

async function bothWays(o: RenderOptions) {
  const on = await render({ ...o, reuse: true });
  const off = await render({ ...o, reuse: false });
  return { on, off };
}

describe("the reuse delivers the frames a full raster would", () => {
  test(
    "holds and changes: every frame hash equal, with frames reused and frames rasterised",
    async () => {
      const c = built[HOLDS]!;
      const { on, off } = await bothWays(optionsOf(c));
      expect(off.reusedFrames).toBe(0);
      // The fixture has to exercise both branches, or equality says nothing.
      expect(on.reusedFrames).toBeGreaterThan(c.durationFrames / 4);
      expect(on.reusedFrames).toBeLessThan(c.durationFrames - 1);
      expect(on.frameHashes).toEqual(off.frameHashes);

      // And the digest the ledger recorded without any reuse, at sha256.
      const sha = await render({ ...optionsOf(c), hashAlgorithm: "sha256" });
      expect(sha.digest).toBe(LEDGER[HOLDS]!.digest);
    },
    600_000,
  );

  test(
    "under a shutter: the key is the exposure's, and a hold at the tick is not a hold",
    async () => {
      // `held-shutter` (staged below): a box slides between ticks 3 and 15,
      // both frame ticks at 30 fps, under 180° x 4. Frame 1's tick sees the
      // box at its start, as frame 0's does, while its later samples see it
      // move; frame 8's tick sees it at its end, as frame 7's does, while
      // frame 7's earlier samples saw it move. So the tick's draw list holds
      // at frames 1 and 8 and the exposure does not.
      const c = await stageHeldShutter();
      const ticks = await tickHashes(c);
      expect(ticks[1]).toBe(ticks[0]);
      expect(ticks[8]).toBe(ticks[7]);

      const { on, off } = await bothWays(optionsOf(c));
      expect(off.frameHashes[1]).not.toBe(off.frameHashes[0]);
      expect(off.frameHashes[8]).not.toBe(off.frameHashes[7]);
      expect(on.frameHashes).toEqual(off.frameHashes);
      // Frames 9-23 hold in every sample and are the only frames reused.
      expect(on.reusedFrames).toBe(15);
    },
    600_000,
  );

  test(
    "a freed texture: the draw list holds, the revision moves, and the frame is rasterised",
    async () => {
      // `images` is one still frame, so a render of eight holds throughout.
      // The host binds a texture of its own to the `texels` node after mount
      // and frees it at frame 4 without re-binding: the node's TEX_QUAD keeps
      // the freed handle, so the draw list does not move, and the raster
      // draws nothing there. Only the raster revision says so.
      const c = built[IMAGES]!;
      const tree = (await scratchTree(c)) as TreeNode;
      const node = findNamed(tree, "texels");
      expect(node).toBeGreaterThan(0);
      const FREE_AT = 4;

      const drawHashes: string[] = [];
      const runOnce = (reuse: boolean) => {
        let handle = -1;
        let ops: HostOps | null = null;
        let ex: Record<string, () => bigint> | null = null;
        return render({
          ...optionsOf(c),
          durationFrames: 8,
          reuse,
          setup: async (source) => {
            await source.seekFrame(0);
            ops = source.world.ops as unknown as HostOps;
            ex = source.world.exports as unknown as Record<string, () => bigint>;
            const red = new Uint8Array(16 * 16 * 4);
            for (let i = 0; i < red.length; i += 4) red.set([255, 0, 0, 255], i);
            handle = ops.uploadTexture(red, 16, 16, 3);
            ops.setImage(node, handle);
          },
          onFrameBoundary: (frame) => {
            if (frame !== FREE_AT) return;
            const before = String(ex!.ui_draw_hash!());
            ops!.freeTexture(handle);
            drawHashes.push(before, String(ex!.ui_draw_hash!()));
          },
        });
      };
      const off = await runOnce(false);
      const on = await runOnce(true);

      // The case is the one claimed: the free moved no word and moved pixels.
      expect(drawHashes[0]).toBe(drawHashes[1]);
      expect(off.frameHashes[FREE_AT]).not.toBe(off.frameHashes[FREE_AT - 1]);
      expect(on.frameHashes).toEqual(off.frameHashes);
      // Holds either side of the free were reused; the free itself was not.
      expect(on.reusedFrames).toBe(8 - 2);
    },
    600_000,
  );

  test("a detached view is rasterised again, not handed back", () => {
    let renders = 0;
    let buffer = new ArrayBuffer(16);
    const reuse = new RasterReuse({ rasterKey: () => "held" }, () => {
      renders++;
      buffer = new ArrayBuffer(16);
      return new Uint8Array(buffer);
    });
    expect(reuse.read().byteLength).toBe(16);
    expect(reuse.read().byteLength).toBe(16);
    expect([renders, reuse.reused]).toEqual([1, 1]);
    // What a grown wasm memory does to every view of the old buffer.
    buffer.transfer();
    expect(reuse.read().byteLength).toBe(16);
    expect([renders, reuse.rasterised, reuse.reused]).toEqual([2, 2, 1]);
  });
});

/**
 * A composition no film in the tree is: holds under a declared shutter, and
 * an animation whose both ends sit on frame ticks. The shutter fixtures in
 * the tree move on every frame, so none of them holds at all
 * (`baselines/raster-reuse.md`). Staged in a tree of symlinks with its own
 * `compositions/` and `dist/`, as `tests/authoring.test.ts` stages one.
 */
async function stageHeldShutter(): Promise<ResolvedComposition> {
  const tree = join(TMP, "tree");
  mkdirSync(join(tree, "dist"), { recursive: true });
  for (const entry of readdirSync(ROOT)) {
    if (entry === "dist" || entry === ".git" || entry === "compositions") continue;
    symlinkSync(join(ROOT, entry), join(tree, entry));
  }
  const dir = join(tree, "compositions", "held-shutter");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "main.tsx"),
    [
      'import { mount } from "@pocketjs/framework";',
      'import { View } from "@pocketjs/framework/components";',
      "",
      "mount(() => (",
      '  <View class="w-full h-full bg-slate-950">',
      '    <View class="animate-slide absolute left-[20px] top-[60px] w-[60px] h-[60px] bg-amber-400" />',
      "  </View>",
      "));",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "pocket.config.ts"),
    [
      'import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";',
      "",
      "// 50 ms is tick 3 and 200 ms twelve ticks, so the slide runs from tick 3",
      "// to tick 15: frame 1's tick and frame 7's at 30 fps.",
      "export default definePocketConfig({",
      "  theme: {",
      '    keyframes: { slide: { from: { transform: "translateX(0px)" }, to: { transform: "translateX(200px)" } } },',
      '    animation: { slide: { value: "slide 200ms linear 50ms both" } },',
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "pocket-motion.json"),
    JSON.stringify({ motion: 1, durationFrames: 24, fps: 30, supersample: 1, shutter: { angle: 180, samples: 4 } }),
  );
  writeFileSync(
    join(dir, "pocket.json"),
    JSON.stringify({
      $schema: "https://pocketjs.dev/schema/pocket-2.json",
      pocket: 2,
      id: "dev.pocket-stack.motion-held-shutter",
      name: "pocketjs-motion-held-shutter",
      title: "held under a shutter",
      version: "0.0.0",
      engine: { capabilities: { requires: [] } },
      app: {
        entry: "compositions/held-shutter/main.tsx",
        output: "held-shutter",
        framework: "solid",
        viewport: { fixed: { logical: [320, 180], presentation: "native" } },
      },
    }),
  );
  const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error(`held-shutter: ${resolved.message}`);
  await runBuild(resolved.value);
  return resolved.value;
}

/** The frame's own tick's draw-list hash, per frame — what a tick-keyed reuse would compare. */
async function tickHashes(c: ResolvedComposition): Promise<string[]> {
  const source = await WasmFrameSource.create({ ...optionsOf(c), compositionId: c.compositionId });
  const ex = source.world.exports as unknown as Record<string, () => bigint>;
  const out: string[] = [];
  for (let f = 0; f < c.durationFrames; f++) {
    await source.seekFrame(f);
    out.push(String(ex.ui_draw_hash!()));
  }
  await source.dispose();
  return out;
}

interface TreeNode {
  readonly i: number;
  readonly n?: string;
  readonly k?: readonly TreeNode[];
}

interface HostOps {
  uploadTexture(buf: Uint8Array, w: number, h: number, psm: number): number;
  setImage(id: number, tex: number): void;
  freeTexture(handle: number): void;
}

function findNamed(node: TreeNode, name: string): number {
  if (node.n === name) return node.i;
  for (const child of node.k ?? []) {
    const id = findNamed(child, name);
    if (id > 0) return id;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// --encoder and --preset
// ---------------------------------------------------------------------------

describe("the encode leg's encoder", () => {
  const base = { width: 1920, height: 1080, fps: 30, outputPath: "/dev/null" } as const;

  test("libx264 takes the preset; the default is medium at crf 16, as it was", () => {
    expect(encoderSettings(base)).toEqual({ codec: "libx264", preset: "medium", crf: 16 });
    expect(() => encoderSettings({ ...base, encoder: "h264_nvenc" })).toThrow(/no measured mp4 encoder/);
    const args = ffmpegArgs({ ...base, preset: "veryfast" }).join(" ");
    expect(args).toContain("-c:v libx264 -preset veryfast -crf 16 -flags +bitexact");
  });

  test("h264_videotoolbox gets a constant quality, no CRF, no preset, no rate and no software fallback", () => {
    expect(VIDEOTOOLBOX_QUALITY).toBe(87);
    expect(encoderSettings({ ...base, encoder: "h264_videotoolbox" })).toEqual({
      codec: "h264_videotoolbox",
      quality: 87,
    });
    const args = ffmpegArgs({ ...base, encoder: "h264_videotoolbox" }).join(" ");
    expect(args).toContain("-c:v h264_videotoolbox -q:v 87 -allow_sw 0 -pix_fmt yuv420p");
    expect(args).not.toContain("-crf");
    expect(args).not.toContain("-preset");
    expect(args).not.toContain("-b:v");
  });

  test("each pair the leg cannot honour is refused", () => {
    expect(() => assertEncoderSupported("mp4", false, "h264_videotoolbox", undefined)).not.toThrow();
    expect(() => assertEncoderSupported("mp4", false, "libx264", "faster")).not.toThrow();
    expect(() => assertEncoderSupported("mp4", false, "hevc_videotoolbox", undefined)).toThrow(/must be one of/);
    expect(() => assertEncoderSupported("webm", false, "h264_videotoolbox", undefined)).toThrow(/libvpx-vp9/);
    expect(() => assertEncoderSupported("mov", true, "libx264", undefined)).toThrow(/prores_ks/);
    expect(() => assertEncoderSupported("png-seq", false, "libx264", undefined)).toThrow(/no encoder/);
    expect(() => assertEncoderSupported("mp4", true, "h264_videotoolbox", undefined)).toThrow(/no alpha plane/);
    expect(() => assertEncoderSupported("mp4", false, "h264_videotoolbox", "fast")).toThrow(/no presets/);
    expect(() => assertEncoderSupported("webm", false, undefined, "fast")).toThrow(/does not encode with it/);
    expect(() => assertEncoderSupported("mp4", false, undefined, "placebo")).toThrow(/must be one of/);
  });

  test("an encoder this ffmpeg lacks is refused by name", async () => {
    await expect(assertEncoderAvailable("no_such_encoder_x")).rejects.toThrow(/no no_such_encoder_x encoder/);
    await expect(assertEncoderAvailable("libx264")).resolves.toBeUndefined();
  });

  test("the CLI refuses the pairs with exit 2 before it boots anything", async () => {
    for (const argv of [
      ["--encoder", "h264_videotoolbox", "--format", "mov", "--out", join(TMP, "x.mov")],
      ["--encoder", "h264_videotoolbox", "--preset", "fast", "--out", join(TMP, "x.mp4")],
      ["--preset", "fast", "--format", "png-seq", "--out", join(TMP, "frames")],
    ]) {
      const proc = Bun.spawn(["bun", "src/cli/main.ts", "render", IMAGES, ...argv], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await proc.exited, argv.join(" ")).toBe(EXIT_USAGE);
    }
  });
});

const hasVideoToolbox = await assertEncoderAvailable("h264_videotoolbox").then(
  () => true,
  () => false,
);

describe("--encoder h264_videotoolbox, read back", () => {
  test.skipIf(!hasVideoToolbox)(
    "writes H.264 at the stated quality, reports it, and the digest is the ledger's",
    async () => {
      const out = join(TMP, "vt.mp4");
      const proc = Bun.spawn(
        ["bun", "src/cli/main.ts", "render", HOLDS, "--encoder", "h264_videotoolbox", "--out", out, "--json"],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
      );
      const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(code).toBe(EXIT_OK);
      const payload = JSON.parse(text) as { digest: string; encoder: { codec: string; quality: number } };
      expect(payload.encoder).toEqual({ codec: "h264_videotoolbox", quality: 87 });
      expect(payload.digest).toBe(LEDGER[HOLDS]!.digest);
      const probe = Bun.spawn(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0", out],
        { stdout: "pipe" },
      );
      expect((await new Response(probe.stdout).text()).trim()).toBe("h264,yuv420p");
    },
    600_000,
  );

  test.skipIf(hasVideoToolbox)(
    "is refused before boot on an ffmpeg without it",
    async () => {
      const proc = Bun.spawn(
        ["bun", "src/cli/main.ts", "render", IMAGES, "--encoder", "h264_videotoolbox", "--out", join(TMP, "vt.mp4")],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
      );
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect(code).not.toBe(EXIT_OK);
      expect(stderr).toContain("no h264_videotoolbox encoder");
    },
    600_000,
  );
});
