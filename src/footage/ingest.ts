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

import { mkdir } from "node:fs/promises";
import type { FootageFit } from "../manifest/sidecar.ts";
import { gridOf } from "./tiling.ts";

export interface IngestOptions {
  readonly src: string;
  readonly outDir: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  /** Power of two, <= 512. Default 512. */
  readonly tile?: number;
  /**
   * How to reconcile a source whose aspect differs from `width`×`height`.
   * Absent or `stretch` is today's `scale=W:H:...` string, byte for byte.
   */
  readonly fit?: FootageFit;
}

export interface IngestManifest {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly tile: number;
  readonly grid: readonly [cols: number, rows: number];
  /** SHA-256 of the frozen RGBA stream — the part that enters input identity. */
  readonly sha256: string;
  readonly bytes: number;
  /** Recorded for provenance. Does not affect rendering: decode already happened. */
  readonly ffmpeg: string;
}

const MAX_TILE = 512;

export async function ingestFootage(options: IngestOptions): Promise<IngestManifest> {
  const tile = options.tile ?? MAX_TILE;
  if (tile < 1 || tile > MAX_TILE || (tile & (tile - 1)) !== 0) {
    throw new Error(
      `PocketJS Motion: tile must be a power of two <= ${MAX_TILE} (upstream TEX_MAX_DIM); got ${tile}`,
    );
  }
  await mkdir(options.outDir, { recursive: true });
  const rawPath = `${options.outDir}/frames.rgba`;

  // Every knob that could move a pixel is pinned here rather than left to a
  // default, because these choices are part of the artifact's identity.
  //
  // `-sws_flags` is the default for any scaler ffmpeg inserts on its own — the
  // format conversion at the end of the graph, if negotiation asks for one.
  // The explicit `scale` in `-vf` sets its own `flags=`, which REPLACES this
  // rather than adding to it, so `ingestScaleFilter` repeats the two names.
  // Both are `+`-prefixed: the option's default is already `bicubic`, and a
  // bare value would drop it.
  const args = [
    "ffmpeg", "-y", "-v", "error",
    "-fflags", "+bitexact",
    "-flags", "+bitexact",
    "-sws_flags", "+accurate_rnd+bitexact",
    "-i", options.src,
    "-vf", ingestScaleFilter(options.width, options.height, options.fit ?? "stretch"),
    "-r", String(options.fps),
    "-frames:v", String(options.frames),
    "-pix_fmt", "rgba",
    "-f", "rawvideo",
    rawPath,
  ];
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `PocketJS Motion: ingest failed (${code})\n${(await new Response(proc.stderr).text()).trim()}`,
    );
  }

  // Hashed in chunks, not read whole. FootageLayer reads one decoded frame at
  // a time, and this path used to materialise the entire track anyway: a cut
  // that scaled a 720x1280 clip to fill a portrait frame decoded to 4.9 GB,
  // and the first `frame` on it lost the process to the allocation. The digest
  // is over the same bytes in the same order either way, which
  // `baselines/ingest-bytes.json` pins.
  const raw = Bun.file(rawPath);
  const byteLength = raw.size;
  const expected = options.width * options.height * 4 * options.frames;
  if (byteLength !== expected) {
    throw new Error(
      `PocketJS Motion: ingest produced ${byteLength} bytes, expected ${expected} ` +
        `(${options.width}x${options.height} RGBA x ${options.frames}) — the source may be shorter than requested`,
    );
  }
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of raw.stream()) hasher.update(chunk);
  const rawSha256 = hasher.digest("hex");

  const manifest: IngestManifest = {
    src: options.src,
    width: options.width,
    height: options.height,
    fps: options.fps,
    frames: options.frames,
    tile,
    // Not width/tile: tiles overlap by a bleed texel each side, so a tile only
    // DRAWS `interiorOf(tile)` pixels. See tiling.ts.
    grid: gridOf(options.width, options.height, tile),
    sha256: rawSha256,
    bytes: byteLength,
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
 * all three synthetic tracks — twelve decodes — produce the digests already in
 * `baselines/ingest-bytes.json`. So the flags are a no-op on macOS/ARM, which
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

/** First line of `ffmpeg -version`. Recorded for provenance, not hashed. */
export async function ffmpegVersion(): Promise<string> {
  const p = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" });
  await p.exited;
  const first = (await new Response(p.stdout).text()).split("\n")[0] ?? "";
  return first.trim();
}
