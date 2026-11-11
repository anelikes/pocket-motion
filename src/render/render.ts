/**
 * The end-to-end render: composition → frames → MP4, plus the frame-hash
 * sequence that is the determinism oracle for the run.
 */

import { WasmFrameSource, type WasmFrameSourceOptions } from "../runtime/frame-source.ts";
import { FrameHashSequence, type FrameHash, type HashAlgorithm } from "./hash.ts";
import {
  assertEncoderAvailable,
  createEncodeSink,
  encoderSettings,
  pngSequenceSink,
  type EncodeOptions,
  type EncodeSink,
  type EncoderSettings,
  type OutputFormat,
} from "./encode.ts";
import { RasterReuse } from "./reuse.ts";

export interface RenderOptions extends Omit<WasmFrameSourceOptions, "compositionId"> {
  readonly compositionId: string;
  /**
   * Called once the source is booted and audited, before the frame loop.
   * Footage uses this to mount (so tile nodes exist) and bind layers
   * against `source.world.ops`.
   */
  readonly setup?: (source: WasmFrameSource) => void | Promise<void>;
  /**
   * Called once per frame before the guest turn, with the frame index.
   * Two jobs: it is the mount-only oracle's frame boundary (the first call
   * closes mount), and it is where the host presents footage for this frame.
   */
  readonly onFrameBoundary?: (frame: number) => void;
  /** Omit to hash frames without encoding — the fast path for verification. */
  readonly outputPath?: string;
  readonly crf?: number;
  readonly preset?: string;
  readonly encoder?: string;
  /**
   * Downscale on the way out. With `renderScale: N` and a pak built at
   * `--density=N`, this is the supersampling path: N× samples in, target size out.
   */
  readonly scaleTo?: readonly [width: number, height: number];
  readonly onProgress?: (frame: number, total: number) => void;
  /**
   * Stop at the next frame boundary: the loop throws the signal's reason, the
   * encode leg is aborted on the way out as for any other failure, and no
   * result is returned. What the caller then does with the frames already
   * written is the caller's decision — `render` removes them.
   *
   * With a signal, every frame boundary also yields one macrotask turn. A
   * signal is fired from outside — an MCP client's cancel arrives on stdin —
   * and the loop below otherwise does not reliably let the event loop read
   * it. Measured on `compositions/smoke`: a 20 ms interval timer fired once
   * in 120 frames of a hash-only loop (`trace`) and 73 times with an mp4 leg,
   * whose pipe flush is I/O; and without the turn a cancel sent to a png-seq
   * render was not read within two minutes, its frames written by
   * `Bun.write`. `tests/mcp.test.ts` is red on both. Without a signal nothing
   * changes, so neither the ledger nor the CLI pays for the turn.
   */
  readonly signal?: AbortSignal;
  /** Per-frame hash. Defaults to `"sha256"` — the verified one; see src/render/hash.ts. */
  readonly hashAlgorithm?: HashAlgorithm;
  /**
   * Container and codec. Default `mp4`.
   *
   * The only thing this changes is what happens to a frame AFTER it has been
   * hashed, which is why `RenderResult.digest` is format-independent — the
   * push into `hashes` below happens before the sink is written to, and no
   * branch here reaches back.
   */
  readonly format?: OutputFormat;
  /** Ask the codec for an alpha channel. `png-seq` always carries one. */
  readonly alpha?: boolean;
  /**
   * For `png-seq`: how to turn one RGBA buffer into PNG bytes.
   *
   * Injected rather than imported because the encoder is upstream's
   * (`<pocketjs>/tools/png.ts`), reached through a computed specifier the way
   * `frame` reaches it, and `src/render/` should not know where the vendored
   * tree is.
   */
  readonly encodePNG?: (rgba: Uint8Array, width: number, height: number) => Uint8Array;
  /**
   * Render only frames `[start, end)` of the film — a SEGMENT.
   *
   * Every frame before `start` still runs: its frame boundary, its guest turn
   * and its ticks, exactly as a whole render runs them, and nothing else — no
   * raster, no hash, no encode. So the world a segment rasterises frame
   * `start` from is the world a whole render reaches there, by the same
   * sequence of calls rather than by a shortcut that is supposed to be
   * equivalent. Folding is the cheap half: `seekFrame` never rasterises, and
   * `read()` is where the picture is drawn. The frame boundary is not a
   * formality: footage is presented there, and a track's tiles hold the last
   * frame presented to them once its window has passed, so skipping the
   * boundaries of folded frames moved `footage-tracks`' digest.
   *
   * `durationFrames` stays the film's, because it is part of input identity
   * and because the clock a segment folds through is the film's clock.
   * `tests/segments.test.ts` holds three segments joined to a whole render,
   * frame hash for frame hash.
   */
  readonly range?: readonly [start: number, end: number];
  /**
   * Skip the raster of a frame whose draw list and raster revision equal the
   * previous frame's, and deliver the previous frame's pixels
   * (`src/render/reuse.ts`). Default on. The frame hash is taken either way,
   * so this cannot move a digest without the digest saying so.
   */
  readonly reuse?: boolean;
  /**
   * Throw `MissingGlyphError` rather than deliver text drawn as tofu: checked
   * on the first frame rendered, before it reaches the sink, and after the
   * last. `render --spec` sets it — a job's text comes from data nobody
   * looked at.
   */
  readonly refuseMissingGlyphs?: boolean;
}

export interface RenderResult {
  readonly frames: number;
  readonly frameHashes: readonly FrameHash[];
  /** Identity of the whole sequence — the thing to compare across machines. */
  readonly digest: FrameHash;
  readonly outputPath?: string;
  readonly elapsedMs: number;
  readonly msPerFrame: number;
  /**
   * The smallest alpha byte over every frame, or undefined when nothing asked.
   *
   * Measured rather than assumed. The rasteriser clears to transparent black
   * (patch 0014), so this is 0 wherever a composition leaves a pixel to no
   * declared ground and 255 for one whose ground covers the canvas. Before
   * 0014 the clear was opaque and this came back 255 for every composition
   * in the tree; the number the command prints is what said so, and what
   * says otherwise now.
   */
  readonly alphaFloor?: number;
  /** The frames rendered, `[start, end)` — the whole film unless `range` was given. */
  readonly range: readonly [start: number, end: number];
  /**
   * What the encode leg was asked for, output path aside — `ffmpegArgs` of
   * this is the command that wrote the file. Absent for `png-seq` and for a
   * hash-only run. A segment records it, because a stream copy can join only
   * bitstreams one encoder configuration wrote.
   */
  readonly encode?: Omit<EncodeOptions, "outputPath">;
  /**
   * Frames delivered as the previous frame's pixels because the core would
   * have drawn them the same (`src/render/reuse.ts`); 0 with `reuse: false`.
   * `frames - reusedFrames` frames were rasterised.
   */
  readonly reusedFrames: number;
  /** What the encode leg was told; absent with no output and for `png-seq`. */
  readonly encoder?: EncoderSettings;
  /**
   * Codepoints the render drew as the tofu box, ascending: no glyph in the
   * slot's face or in any `fonts.fallback` face (`src/text/missing.ts`).
   * Empty when every glyph was found.
   */
  readonly missingGlyphs: readonly number[];
}

/**
 * A render asked to refuse tofu (`RenderOptions.refuseMissingGlyphs`) found
 * text with a glyph no declared face carries. Thrown before the first frame
 * reaches the sink when the mounted text has one, and after the last when a
 * later frame's does.
 */
export class MissingGlyphError extends Error {
  constructor(readonly codepoints: readonly number[]) {
    super(
      `PocketJS Motion: ${codepoints.length} codepoint(s) have no glyph in the slot's face or any ` +
        "fonts.fallback face and would be drawn as the tofu box",
    );
  }
}

export async function render(options: RenderOptions): Promise<RenderResult> {
  const started = performance.now();
  const [start, end] = options.range ?? [0, options.durationFrames];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > options.durationFrames || start >= end) {
    throw new RangeError(
      `PocketJS Motion: a range must be integers with 0 <= start < end <= ${options.durationFrames}; ` +
        `got [${start}, ${end})`,
    );
  }
  const format = options.format ?? "mp4";
  const physicalW = options.width * (options.renderScale ?? 1);
  const physicalH = options.height * (options.renderScale ?? 1);
  const encode: Omit<EncodeOptions, "outputPath"> | undefined =
    options.outputPath && format !== "png-seq"
      ? {
          width: physicalW,
          height: physicalH,
          fps: options.hz,
          crf: options.crf,
          preset: options.preset,
          encoder: options.encoder,
          scaleTo: options.scaleTo,
          format,
          alpha: options.alpha,
        }
      : undefined;
  const encoder = encode ? encoderSettings({ ...encode, outputPath: options.outputPath! }) : undefined;
  // Before the boot: an ffmpeg without the encoder would otherwise surface
  // as a broken pipe at the first frame written.
  if (encoder) await assertEncoderAvailable(encoder.codec);

  options.signal?.throwIfAborted();
  const source = await WasmFrameSource.create(options);

  // The realm must be clean before a single frame is trusted.
  source.audit();
  await options.setup?.(source);

  const hashes = new FrameHashSequence(options.hashAlgorithm);
  let sink: EncodeSink | null = null;
  if (options.outputPath && format === "png-seq") {
    if (!options.encodePNG) {
      throw new Error(
        "PocketJS Motion: png-seq needs an encodePNG; the caller supplies it " +
          "(src/cli/commands/render.ts reaches upstream's the way `frame` does).",
      );
    }
    sink = pngSequenceSink({
      width: physicalW,
      height: physicalH,
      outDir: options.outputPath,
      encodePNG: options.encodePNG,
      scaleTo: options.scaleTo,
      firstFrame: start,
    });
  } else if (encode) {
    sink = createEncodeSink({ ...encode, outputPath: options.outputPath! });
  }
  // Only when someone asked about alpha: this is a pass over every byte of
  // every frame, and paying for it on the ordinary mp4 path would slow the
  // ledger down to answer a question nobody put.
  const wantAlphaFloor = options.alpha === true || format === "png-seq";
  let alphaFloor = 255;
  // Sound only because this loop is the source's one reader: nothing else
  // renders from the world between two reads (see reuse.ts). A segment's
  // folded frames are never read, so its first frame is always rasterised.
  const reuse = options.reuse === false ? null : new RasterReuse(source.world, () => source.read());

  let finished = false;
  let missingGlyphs: readonly number[] = [];
  try {
    for (let f = 0; f < end; f++) {
      if (options.signal) {
        await new Promise<void>((next) => setImmediate(next));
        options.signal.throwIfAborted();
      }
      // Closes mount on the first call, then delimits each frame.
      options.onFrameBoundary?.(f);
      await source.seekFrame(f);
      // Before the range: folded, never drawn (see `range`).
      if (f < start) continue;
      if (options.refuseMissingGlyphs && f === start) {
        const missing = source.world.missingGlyphs();
        if (missing.length > 0) throw new MissingGlyphError(missing);
      }
      const rgba = reuse ? reuse.read() : source.read();
      hashes.push(rgba);
      if (wantAlphaFloor) {
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i]! < alphaFloor) alphaFloor = rgba[i]!;
        }
      }
      if (sink) await sink.write(rgba);
      // Counted in the frames this call renders, so a segment's progress
      // runs from 0 like a whole render's.
      options.onProgress?.(f - start, end - start);
    }
    missingGlyphs = source.world.missingGlyphs();
    if (options.refuseMissingGlyphs && missingGlyphs.length > 0) throw new MissingGlyphError(missingGlyphs);
    if (sink) await sink.finish();
    finished = true;
  } finally {
    // ffmpeg is waiting on a stdin nobody will write to again. Leaving the
    // loop any other way — a render error, or preview dropping a viewing
    // copy mid-encode — used to leave it resident.
    if (sink && !finished) await sink.abort();
    await source.dispose();
  }

  const elapsedMs = performance.now() - started;
  return {
    frames: end - start,
    frameHashes: hashes.frames,
    digest: hashes.digest(),
    outputPath: options.outputPath,
    elapsedMs,
    msPerFrame: elapsedMs / (end - start),
    ...(wantAlphaFloor ? { alphaFloor } : {}),
    range: [start, end],
    ...(encode ? { encode } : {}),
    reusedFrames: reuse?.reused ?? 0,
    ...(encoder ? { encoder } : {}),
    missingGlyphs,
  };
}
