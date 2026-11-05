/**
 * Footage ingest — a BUILD step, not a render step.
 *
 * Decoding is the only part of the pipeline whose output can differ between
 * machines: H.264/H.265 bitstream decoding is bit-exact by spec, but YUV→RGB
 * conversion and scaling go through swscale, whose version and SIMD path are
 * not a stable contract.
 *
 * So we decode once, freeze the result, and hash it. The frozen artifact is an
 * *input* — same standing as the pak and the font files — and the render path
 * holds no decoder at all. Change ffmpeg and the ingest artifact changes, which
 * changes the input identity; it can never make the same artifact render
 * differently.
 *
 * That freeze bounds the damage; it does not remove it. Freezing the decode on
 * ONE machine and shipping it would, but the artifact is build output and each
 * machine decodes its own. CI run 33599991463 is what that costs when the
 * conversion is left to a default — see `ingestScaleFilter` below, which now
 * pins the rounding as well as the kernel.
 *
 * Tiles because a 1080p frame cannot be one texture: upstream enforces
 * power-of-two and <= 512 (`TEX_MAX_DIM`) in `Ui::upload_texture_flags`.
 */

import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { FootageFit } from "../manifest/sidecar.ts";
import { gridOf } from "./tiling.ts";

/**
 * Source frames `[start, end)`, counted at the composition's fps — the
 * index `sourceFrame + (compositionFrame - startFrame)` addresses.
 */
export type SourceSpan = readonly [start: number, end: number];

/** What the decode is asked for. Everything here is in the argv. */
export interface IngestRecipeOptions {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /**
   * The source frames to keep, sorted, each non-empty, no two touching —
   * what `unionSpans` returns. Nothing outside them is written.
   */
  readonly spans: readonly SourceSpan[];
  /**
   * How to reconcile a source whose aspect differs from `width`×`height`.
   * Absent or `stretch` is today's `scale=W:H:...` string, byte for byte.
   */
  readonly fit?: FootageFit;
}

export interface IngestOptions extends IngestRecipeOptions {
  readonly src: string;
  readonly outDir: string;
  /** Power of two, <= 512. Default 512. */
  readonly tile?: number;
}

export interface IngestManifest {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /**
   * Source frames the artifact holds, in order. Frame `n` of the clip is
   * stored at its offset within its span plus the lengths of the spans
   * before it; a frame in no span was decoded and not written.
   */
  readonly spans: readonly SourceSpan[];
  /** Frames stored: the spans' lengths summed. */
  readonly frames: number;
  readonly tile: number;
  readonly grid: readonly [cols: number, rows: number];
  /** SHA-256 of the frozen RGBA stream — the part that enters input identity. */
  readonly sha256: string;
  readonly bytes: number;
  /** The argv that decoded it, the source path replaced by `RECIPE_SRC`. */
  readonly recipe: readonly string[];
  /** Recorded for provenance. Does not affect rendering: decode already happened. */
  readonly ffmpeg: string;
}

const MAX_TILE = 512;

/** Where the source path stands in an argv used as a key or a record. */
export const RECIPE_SRC = "<src>";

/**
 * The ingest command for `src`. One function, so the argv the decode runs and
 * the argv the cache key hashes (`ingestRecipe`) cannot be two spellings.
 *
 * Every knob that could move a pixel is pinned here rather than left to a
 * default, because these choices are part of the artifact's identity.
 *
 * `-sws_flags` is the default for any scaler ffmpeg inserts on its own — the
 * format conversion at the end of the graph, if negotiation asks for one.
 * The explicit `scale` in `-vf` sets its own `flags=`, which REPLACES this
 * rather than adding to it, so `ingestScaleFilter` repeats the two names.
 * Both are `+`-prefixed: the option's default is already `bicubic`, and a
 * bare value would drop it.
 *
 * The decode stops at the last span's end and starts at the clip's first
 * frame, whatever the first span is. `-r` is the rate conversion that decides
 * which source picture each output frame shows, and it counts from the first
 * frame the decoder hands it, so a seek moves the origin it counts from.
 * Measured on `bars-16x9-24fps.mp4` read at 30 fps (2026-10-26): `-ss 20/30`
 * ahead of `-i` decodes frames [20, 140) to the same bytes as a decode from
 * frame 0, and `-ss 89/30` decodes [89, 179) to different ones. So the frames
 * before a span are decoded and dropped on the way to the file
 * (`ingestFootage`) rather than skipped. Stopping early moves nothing:
 * `-frames:v` ends the output after N frames and does not change the N before
 * it — every artifact the ledger ingests is a byte slice of the whole decode
 * `baselines/ingest-bytes.json` records, and `tests/footage-cli.test.ts`
 * holds the same against a whole decode of a clip it makes.
 */
export function ingestArgv(src: string, options: IngestRecipeOptions): string[] {
  assertSpans(options.spans);
  return [
    "ffmpeg", "-v", "error",
    "-fflags", "+bitexact",
    "-flags", "+bitexact",
    "-sws_flags", "+accurate_rnd+bitexact",
    "-i", src,
    "-vf", ingestScaleFilter(options.width, options.height, options.fit ?? "stretch"),
    "-r", String(options.fps),
    "-frames:v", String(options.spans.at(-1)![1]),
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    "pipe:1",
  ];
}

/** `ingestArgv` with the source path taken out: what the cache key hashes. */
export function ingestRecipe(options: IngestRecipeOptions): string[] {
  return ingestArgv(RECIPE_SRC, options);
}

/**
 * Sorted, merged, empty spans dropped. Touching spans merge too, so one set of
 * frames has one spelling and one key.
 */
export function unionSpans(spans: readonly SourceSpan[]): SourceSpan[] {
  const sorted = spans.filter(([a, b]) => b > a).toSorted((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Frames the spans hold. */
export function spanFrames(spans: readonly SourceSpan[]): number {
  return spans.reduce((n, [a, b]) => n + (b - a), 0);
}

/**
 * Where source frame `n` sits in an artifact holding `spans`, or `undefined`
 * when no span holds it.
 */
export function storedIndex(spans: readonly SourceSpan[], n: number): number | undefined {
  let before = 0;
  for (const [a, b] of spans) {
    if (n < a) return undefined;
    if (n < b) return before + (n - a);
    before += b - a;
  }
  return undefined;
}

/** Refuse spans `unionSpans` would have rewritten, so a key has one spelling. */
export function assertSpans(spans: readonly SourceSpan[]): void {
  const problem =
    spans.length === 0
      ? "no spans"
      : spans.find(([a, b]) => !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b <= a)
        ? "a span that is empty, negative or not integral"
        : spans.some((s, i) => i > 0 && s[0] <= spans[i - 1]![1])
          ? "spans out of order, overlapping or touching"
          : undefined;
  if (problem) {
    throw new Error(
      `PocketJS Motion: ingest spans ${JSON.stringify(spans)}: ${problem}. ` +
        "Pass them through `unionSpans` first.",
    );
  }
}

export async function ingestFootage(options: IngestOptions): Promise<IngestManifest> {
  const tile = options.tile ?? MAX_TILE;
  if (tile < 1 || tile > MAX_TILE || (tile & (tile - 1)) !== 0) {
    throw new Error(
      `PocketJS Motion: tile must be a power of two <= ${MAX_TILE} (upstream TEX_MAX_DIM); got ${tile}`,
    );
  }
  const { spans } = options;
  const args = ingestArgv(options.src, options);
  await mkdir(options.outDir, { recursive: true });
  const rawPath = `${options.outDir}/frames.rgba`;
  // Written beside and renamed over, so a FootageLayer another process has
  // open on the previous artifact keeps reading the previous inode. A cut
  // that changes the frames shown now re-decodes, so a preview reading the
  // previous span while a `trace` writes the next one is an ordinary state.
  // The name ends in `.rgba` so `RECLAIM_COMMAND` reaches a partial one a
  // crash leaves.
  const partialPath = `${options.outDir}/frames.${process.pid}.partial.rgba`;

  // Streamed through here rather than written by ffmpeg, because the decode
  // runs from the clip's first frame (`ingestArgv`) and only the spans are
  // kept: the frames between them never reach the disk. Hashed as written —
  // FootageLayer reads one decoded frame at a time, and this path once
  // materialised a whole track to hash it: a cut that scaled a 720x1280 clip
  // to fill a portrait frame decoded to 4.9 GB, and the first `frame` on it
  // lost the process to the allocation.
  const frameBytes = options.width * options.height * 4;
  const decodeFrames = spans.at(-1)![1];
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(proc.stderr).text();
  const hasher = new Bun.CryptoHasher("sha256");
  const fd = openSync(partialPath, "w");
  let read = 0;
  let written = 0;
  let span = 0;
  try {
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      let at = 0;
      while (at < chunk.length) {
        const pos = read + at;
        const frame = Math.floor(pos / frameBytes);
        const take = Math.min(chunk.length - at, (frame + 1) * frameBytes - pos);
        while (span < spans.length && frame >= spans[span]![1]) span++;
        if (span < spans.length && frame >= spans[span]![0]) {
          const part = chunk.subarray(at, at + take);
          for (let off = 0; off < part.length; ) off += writeSync(fd, part, off);
          hasher.update(part);
          written += take;
        }
        at += take;
      }
      read += chunk.length;
    }
  } catch (e) {
    // A full disk lands here, as ENOSPC from the write. ffmpeg would block on
    // a pipe nobody reads, and the partial file is the space being asked for.
    proc.kill();
    rmSync(partialPath, { force: true });
    throw e;
  } finally {
    closeSync(fd);
  }
  const code = await proc.exited;
  const problem =
    code !== 0
      ? `ingest failed (${code})\n${(await stderr).trim()}`
      : read !== frameBytes * decodeFrames
        ? `ingest decoded ${read} bytes, expected ${frameBytes * decodeFrames} ` +
          `(${options.width}x${options.height} RGBA x ${decodeFrames}) — the source may be shorter than requested`
        : written !== frameBytes * spanFrames(spans)
          ? `ingest wrote ${written} bytes for spans ${JSON.stringify(spans)}, ` +
            `expected ${frameBytes * spanFrames(spans)}`
          : undefined;
  if (problem) {
    rmSync(partialPath, { force: true });
    throw new Error(`PocketJS Motion: ${problem}`);
  }
  renameSync(partialPath, rawPath);

  const manifest: IngestManifest = {
    src: options.src,
    width: options.width,
    height: options.height,
    fps: options.fps,
    spans,
    frames: spanFrames(spans),
    tile,
    // Not width/tile: tiles overlap by a bleed texel each side, so a tile only
    // DRAWS `interiorOf(tile)` pixels. See tiling.ts.
    grid: gridOf(options.width, options.height, tile),
    sha256: hasher.digest("hex"),
    bytes: written,
    recipe: ingestRecipe(options),
    ffmpeg: await ffmpegVersion(),
  };
  await Bun.write(`${options.outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * The scaler flags every `scale` in the `-vf` chain carries.
 *
 * `lanczos` picks the kernel. `accurate_rnd` and `bitexact` are why the
 * artifact is the same bytes on another architecture, and they are here
 * because it was not: CI run 33599991463 was the first Linux run of the ledger
 * with footage present, and 19 of 21 compositions reproduced the digests
 * recorded on macOS/ARM byte for byte while the two that declare footage did
 * not. Everything downstream of this decode — the wasm rasteriser, the font
 * atlas, the frame hash — crossed the architecture intact; the decoded RGBA
 * did not.
 *
 * The mechanism is swscale's scaler, not the H.264 decode: bitstream decoding
 * to YUV planes is bit-exact by spec, and it is the yuv420p→rgba conversion
 * and the resample that go through per-architecture code. The output stage —
 * `yuv2planeX` for planar, `yuv2packedX` for the packed RGB this asks for —
 * has x86 assembly in two rounding behaviours, and the fast one, which is the
 * default, does not agree with the C reference the aarch64 build falls back
 * to for these conversions. `SWS_ACCURATE_RND` selects the agreeing one;
 * `SWS_BITEXACT` drops the remaining approximations.
 *
 * Measured on this machine before the flags were added: with them and without
 * them, and with `-cpuflags 0` forcing the C path, all four combinations of
 * all three synthetic tracks — twelve decodes — produce the whole-clip digests
 * `baselines/ingest-bytes.json` records. So the flags are a no-op on macOS/ARM, which
 * is the shape the explanation predicts — the aarch64 path already IS the
 * reference — and they move no recorded digest here. What they change is the
 * x86 build's path.
 *
 * The strings are load-bearing. Changing one — even to an equivalent
 * `force_original_aspect_ratio` form — is a different swscale path and a
 * different frozen digest, and `tests/footage-cli.test.ts` pins all three.
 */
const SWS_FLAGS = "lanczos+accurate_rnd+bitexact";

export function ingestScaleFilter(
  width: number,
  height: number,
  fit: FootageFit = "stretch",
): string {
  if (fit === "stretch") {
    return `scale=${width}:${height}:flags=${SWS_FLAGS}:in_range=tv:out_range=pc`;
  }
  if (fit === "cover") {
    return (
      `scale=${width}:${height}:force_original_aspect_ratio=increase` +
      `:flags=${SWS_FLAGS}:in_range=tv:out_range=pc,crop=${width}:${height}`
    );
  }
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease` +
    `:flags=${SWS_FLAGS}:in_range=tv:out_range=pc,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
  );
}

/** First line of `ffmpeg -version`. Recorded for provenance; the manifest is not hashed. */
export async function ffmpegVersion(): Promise<string> {
  const first = (await ffmpegVersionText()).split("\n")[0] ?? "";
  return first.trim();
}

/**
 * All of `ffmpeg -version`: the release, the configure line and the version of
 * every library it loaded, which on a shared build is read at run time — so a
 * libswscale upgraded under an unchanged `ffmpeg` binary shows here. What it
 * does not name is the version of an external decoder such as libdav1d.
 */
export async function ffmpegVersionText(): Promise<string> {
  const p = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" });
  const [text, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code !== 0) throw new Error(`PocketJS Motion: \`ffmpeg -version\` exited ${code}`);
  return text;
}
