/**
 * The end-to-end render: composition → frames → MP4, plus the frame-hash
 * sequence that is the determinism oracle for the run.
 */

import { WasmFrameSource, type WasmFrameSourceOptions } from "../runtime/frame-source.ts";
import { FrameHashSequence, type FrameHash, type HashAlgorithm } from "./hash.ts";
import { createEncodeSink, pngSequenceSink, type EncodeSink, type OutputFormat } from "./encode.ts";

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
}

export async function render(options: RenderOptions): Promise<RenderResult> {
  const started = performance.now();
  const source = await WasmFrameSource.create(options);

  // The realm must be clean before a single frame is trusted.
  source.audit();
  await options.setup?.(source);

  const hashes = new FrameHashSequence(options.hashAlgorithm);
  const format = options.format ?? "mp4";
  const physicalW = options.width * (options.renderScale ?? 1);
  const physicalH = options.height * (options.renderScale ?? 1);
  let sink: EncodeSink | null = null;
  if (options.outputPath) {
    if (format === "png-seq") {
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
      });
    } else {
      sink = createEncodeSink({
        width: physicalW,
        height: physicalH,
        fps: options.hz,
        outputPath: options.outputPath,
        crf: options.crf,
        preset: options.preset,
        encoder: options.encoder,
        scaleTo: options.scaleTo,
        format,
        alpha: options.alpha,
      });
    }
  }
  // Only when someone asked about alpha: this is a pass over every byte of
  // every frame, and paying for it on the ordinary mp4 path would slow the
  // ledger down to answer a question nobody put.
  const wantAlphaFloor = options.alpha === true || format === "png-seq";
  let alphaFloor = 255;

  let finished = false;
  try {
    for (let f = 0; f < options.durationFrames; f++) {
      // Closes mount on the first call, then delimits each frame.
      options.onFrameBoundary?.(f);
      await source.seekFrame(f);
      const rgba = source.read();
      hashes.push(rgba);
      if (wantAlphaFloor) {
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i]! < alphaFloor) alphaFloor = rgba[i]!;
        }
      }
      if (sink) await sink.write(rgba);
      options.onProgress?.(f, options.durationFrames);
    }
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
    frames: options.durationFrames,
    frameHashes: hashes.frames,
    digest: hashes.digest(),
    outputPath: options.outputPath,
    elapsedMs,
    msPerFrame: elapsedMs / options.durationFrames,
    ...(wantAlphaFloor ? { alphaFloor } : {}),
  };
}
