/**
 * Frames → ffmpeg. Raw RGBA on stdin, never PNG.
 *
 * Encoding a PNG per frame only for ffmpeg to decode it again is pure waste —
 * measured at 91% of wall time in one browser-free renderer we looked at
 * (35.03 ms/frame, of which 31.95 ms was the PNG encode). `-f rawvideo` skips
 * both halves.
 *
 * `-fflags +bitexact` on the output drops the muxer's version string and
 * creation time, and `-flags +bitexact` the encoder's, so the container is
 * as reproducible as the encoder allows. That is a courtesy, not the
 * contract: the determinism claim rests on frame hashes (src/render/hash.ts),
 * never on MP4 bytes. The format flag sat before `-i -` until the files were
 * read back, where it set the rawvideo DEMUXER bitexact and every delivery
 * carried `encoder=Lavf62.3.100`.
 *
 * FOUR OUTPUT FORMATS, and the encode leg is the only thing any of them
 * changes. Frames are hashed before a byte reaches here (`render.ts`), so the
 * digest of a composition is the same whichever format is asked for —
 * `tests/format.test.ts` asserts that rather than leaving it to be inferred
 * from the code's shape.
 *
 *   mp4      libx264, yuv420p — the default
 *   webm     libvpx-vp9, yuv420p (yuva420p with alpha)
 *   mov      ProRes 422 (yuv422p10le), or 4444 (yuva444p10le) with alpha
 *   png-seq  no ffmpeg at all — one RGBA PNG per frame (`pngSequenceSink`)
 *
 * The container is named with `-f`, never inferred from `--out`: ffmpeg picks
 * a muxer by extension, so `--format mov --out cut`, which `render` accepts,
 * failed with "Unable to choose an output format".
 *
 * **Every ffmpeg format is BT.709, converted and tagged** (`DELIVERY_COLOUR`).
 * swscale's default matrix for RGB → YUV is BT.601, and the files carried no
 * colour tags, so the matrix was left to the player. A player that takes
 * BT.709 for an untagged HD file — the convention — shifted every saturated
 * colour: measured on a field of flat patches through this leg and decoded
 * with the BT.709 matrix, 255 green came back 216 and 255 magenta 255,39,255,
 * a worst channel 40 levels out, in all three formats. Now the matrix is
 * named in the `scale` that does the conversion, so it does not depend on
 * what the encoder's options negotiate, and the same field decodes within
 * `tests/format.test.ts`'s tolerance under the tags the file carries.
 *
 * Primaries and transfer go on the frames (`setparams`) as well as on the
 * encoder, because ffmpeg 8.0's encoder takes them from the frames: with the
 * four output options and no `setparams`, measured, the H.264 stream came
 * out tagged with matrix and range and nothing else. On 8.0 the output
 * options repeat what the chain already set; they stay because they are the
 * encoder's own fields, which is where an ffmpeg that does not carry frame
 * properties into the encoder would look — no such ffmpeg was run here.
 * ProRes has no range field in its bitstream or in MOV's `colr` atom, so a
 * ProRes file reads `color_range=unknown` and decoders take video range.
 *
 * **`--alpha` delivers a picture.** The rasteriser clears the framebuffer to
 * TRANSPARENT black (`patches/0014-transparent-clear.patch`), so a pixel no
 * declared ground reaches has alpha 0 and a composition with a full-bleed
 * ground is 255 everywhere. `render` MEASURES that per run rather than
 * repeating this sentence: `alphaFloor` below is the smallest alpha byte
 * seen, and the command reports it — 0 on `compositions/alpha`, 255 on
 * anything grounded.
 */

export const OUTPUT_FORMATS = ["mp4", "webm", "mov", "png-seq"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

/**
 * The extension a format's `--out` must carry, or `null` for `png-seq`,
 * whose output is a DIRECTORY of frames rather than one file.
 *
 * Checked rather than inferred-and-forgotten: a `.webm` file holding H.264 is
 * exactly the silent-wrong-result shape this project refuses everywhere else,
 * so `render` fails when `--format` and the extension disagree.
 */
export function formatExtension(format: OutputFormat): string | null {
  return format === "png-seq" ? null : `.${format}`;
}

/** Formats whose codec can carry an alpha channel. */
export function formatCarriesAlpha(format: OutputFormat): boolean {
  return format !== "mp4";
}

/**
 * The formats ffmpeg writes: every one but `png-seq`. Each is also the name
 * of ffmpeg's muxer for it, which the encode leg and the sound mux pass as
 * `-f`.
 */
export type ContainerFormat = Exclude<OutputFormat, "png-seq">;

/**
 * The colour every encoded file is converted with and tagged as. sRGB, which
 * the rasteriser's bytes are, shares BT.709's primaries; the transfer is
 * tagged BT.709 as video delivered from RGB conventionally is, and no transfer
 * conversion is applied — the code values are the rasteriser's.
 */
export const DELIVERY_COLOUR = {
  matrix: "bt709",
  primaries: "bt709",
  transfer: "bt709",
  range: "tv",
} as const;

/**
 * The `-vf` chain: frame colour properties, the RGB → YUV conversion with its
 * matrix named, and the pixel format, so no scaler ffmpeg inserts on its own
 * is left to choose a matrix. The supersample downscale, when there is one,
 * is the same `scale`.
 */
function videoFilter(scaleTo: EncodeOptions["scaleTo"], pixFmt: string): string {
  const c = DELIVERY_COLOUR;
  // area: `scaleTo` is set only for supersample 2 or 4, so this is always an
  // exact integer downscale, and an area average over the subpixels is what
  // supersampling means. The filter is part of the output's identity —
  // pinned, not left to ffmpeg's default.
  //
  // lanczos was here. Its negative lobes put a halo on hard edges that the
  // source does not contain, and this renderer still emits hard edges: the
  // core computes fractional coverage for axis-aligned rect spans, rounded
  // corners, and — since the POLY op — rotated SOLID boxes, but not for
  // rotated gradients, which still fan into coverage-less TRIs, and not for
  // baked glyph cells. Measured on a 4x hard-edged bar,
  // background 128, bar 255, downscaled 4:1, at an edge covering 75% of its
  // pixel:
  //
  //   area     ... 128 128 223 255 255 255 160 128 ...   exact: 128+0.75*127
  //   lanczos  ... 129 121 221 255 252 255 162 121 ...   halo both sides
  //
  // Across 70 rows of a slowly drifting edge, the darkest pixel beside the
  // bar was a constant 128 under area and ranged 118-128 under lanczos: the
  // halo depth tracks sub-pixel phase, so it pulses along the edge. That is
  // an artefact the source never had, and it is the signature people read as
  // edge crawl.
  //
  // This applies to the supersample step only. `src/footage/ingest.ts` scales
  // photographic footage by arbitrary factors, where lanczos is the right
  // choice and stays.
  const size = scaleTo ? `${scaleTo[0]}:${scaleTo[1]}:flags=area:` : "";
  return [
    `setparams=color_primaries=${c.primaries}:color_trc=${c.transfer}`,
    `scale=${size}out_color_matrix=${c.matrix}:out_range=${c.range}`,
    `format=${pixFmt}`,
  ].join(",");
}

function colourTags(): string[] {
  const c = DELIVERY_COLOUR;
  return [
    "-colorspace", c.matrix,
    "-color_primaries", c.primaries,
    "-color_trc", c.transfer,
    "-color_range", c.range,
  ];
}

export interface EncodeOptions {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly outputPath: string;
  /** Constant Rate Factor; lower is better quality. Default 16. */
  readonly crf?: number;
  /** x264 preset. Default "medium". Ignored by hardware encoders. */
  readonly preset?: string;
  /**
   * Video encoder. Default `libx264`.
   *
   * Measured: with libx264 the encoder, not the renderer, is what caps a
   * frame-parallel render — each worker runs its own and they contend for the
   * same cores. `h264_videotoolbox` moves that off the CPU entirely.
   * The trade is reproducibility: hardware encoders are not bit-exact across
   * machines, so the MP4 stops being comparable byte-for-byte. Frame hashes are
   * taken before encoding and are unaffected.
   */
  readonly encoder?: string;
  /** Downscale to this size on the way out — the supersampling step. */
  readonly scaleTo?: readonly [width: number, height: number];
  /** Container and codec. Default `mp4`, which is the historical behaviour. */
  readonly format?: ContainerFormat;
  /** Ask the codec for an alpha channel. Refused for `mp4` by the caller. */
  readonly alpha?: boolean;
}

export interface EncodeSink {
  /** Write one RGBA frame. Must be exactly width*height*4 bytes. */
  write(rgba: Uint8Array): Promise<void>;
  /** Close stdin and wait for ffmpeg. Throws on a non-zero exit. */
  finish(): Promise<void>;
  /**
   * Give up on this encode and kill ffmpeg.
   *
   * ffmpeg reads frames from stdin, so a render that stops before the last
   * frame leaves it waiting on a pipe nobody will write to again — measured:
   * an abandoned encode left `ffmpeg -f rawvideo ... -i -` resident with the
   * render already gone. Never throws: it runs on the way out of a failure
   * that is already being reported.
   */
  abort(): Promise<void>;
}

export function ffmpegArgs(options: EncodeOptions): string[] {
  const { width, height, fps, outputPath } = options;
  const args = [
    "ffmpeg", "-y", "-v", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${width}x${height}`,
    "-framerate", String(fps),
    "-i", "-",
  ];
  const format = options.format ?? "mp4";
  const alpha = options.alpha === true;
  const pixFmt =
    format === "webm"
      ? alpha ? "yuva420p" : "yuv420p"
      : format === "mov"
        ? alpha ? "yuva444p10le" : "yuv422p10le"
        : "yuv420p";

  args.push("-vf", videoFilter(options.scaleTo, pixFmt));

  if (format === "webm") {
    // `-b:v 0` is what makes `-crf` mean constant quality in VP9; without it
    // libvpx reads the CRF as a ceiling on a bitrate target of zero and
    // produces a picture nobody asked for. `-row-mt 1` is threading only.
    args.push(
      "-c:v",
      options.encoder ?? "libvpx-vp9",
      "-crf",
      String(options.crf ?? 24),
      "-b:v",
      "0",
      "-row-mt",
      "1",
    );
  } else if (format === "mov") {
    // prores_ks profile 3 is 422 HQ and 4 is 4444. Only 4444 has an alpha
    // plane, so the profile and the pixel format are one decision, made here
    // rather than left to two flags that can disagree.
    args.push("-c:v", options.encoder ?? "prores_ks", "-profile:v", alpha ? "4444" : "3");
  } else {
    const encoder = options.encoder ?? "libx264";
    args.push("-c:v", encoder);
    if (encoder === "libx264") {
      args.push("-preset", options.preset ?? "medium", "-crf", String(options.crf ?? 16), "-flags", "+bitexact");
    } else {
      // Hardware encoders take a bitrate/quality knob rather than CRF.
      args.push("-q:v", String(options.crf ?? 55));
    }
  }
  args.push("-pix_fmt", pixFmt, ...colourTags(), "-fflags", "+bitexact", "-f", format, outputPath);
  return args;
}

export function createEncodeSink(options: EncodeOptions): EncodeSink {
  const expected = options.width * options.height * 4;
  const proc = Bun.spawn(ffmpegArgs(options), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let frames = 0;
  return {
    async write(rgba: Uint8Array): Promise<void> {
      if (rgba.length !== expected) {
        throw new Error(
          `PocketJS Motion: frame ${frames} has ${rgba.length} bytes, expected ` +
            `${expected} (${options.width}x${options.height} RGBA)`,
        );
      }
      frames++;
      proc.stdin.write(rgba);
      await proc.stdin.flush();
    },
    async finish(): Promise<void> {
      await proc.stdin.end();
      const code = await proc.exited;
      if (code !== 0) {
        const err = await new Response(proc.stderr).text();
        throw new Error(`PocketJS Motion: ffmpeg exited ${code}\n${err.trim()}`);
      }
    },
    async abort(): Promise<void> {
      try {
        // SIGKILL, not SIGTERM. ffmpeg here is blocked reading a stdin that
        // will get no more frames, and measured on a live encode it does not
        // act on SIGTERM in that state: kill() then await exited hung past
        // five seconds with the process still resident, while signal 9
        // returned in a millisecond. Ending stdin first would let it finalise
        // the partial file, which is work nobody wants — the directory this
        // was writing into is about to be removed.
        proc.kill(9);
        await proc.exited;
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * `png-seq`: one RGBA PNG per frame, and no ffmpeg anywhere in the path.
 *
 * The header above explains why the ffmpeg legs take raw RGBA rather than
 * PNG — a per-frame PNG encode measured at 91% of wall time. That cost is
 * unavoidable here, because a PNG per frame IS the output. It is also the one
 * format whose files are lossless and carry all four channels exactly as the
 * rasteriser produced them, which is what makes it the format to reach for
 * when the next tool in the chain is not a player.
 *
 * `%06d.png` from 0, in the directory `--out` names. Six digits because five
 * overflows at 27.8 minutes of 60 fps, and a filename that stops sorting is a
 * frame order nothing reports.
 *
 * `scaleTo` is REFUSED rather than ignored: the supersample downscale is an
 * ffmpeg filter (`scale=…:flags=area`) and there is no ffmpeg here, so
 * accepting it would write frames at the supersampled size under a sidecar
 * that declares another. That has happened here once before, on the mp4 leg:
 * `render()` took `scaleTo` and no command passed it, so a supersample-2
 * render shipped 3840×2160 under a sidecar declaring 1080p, silently.
 */
export function pngSequenceSink(options: {
  readonly width: number;
  readonly height: number;
  readonly outDir: string;
  /** Encodes one RGBA buffer. Injected so this module needs no upstream import. */
  readonly encodePNG: (rgba: Uint8Array, width: number, height: number) => Uint8Array;
  readonly scaleTo?: readonly [width: number, height: number];
}): EncodeSink {
  if (options.scaleTo) {
    throw new Error(
      "PocketJS Motion: png-seq cannot downscale a supersampled render — the " +
        "downscale is an ffmpeg filter and this format runs no ffmpeg. Render this " +
        "composition at supersample 1, or pick a format with an encode leg.",
    );
  }
  const expected = options.width * options.height * 4;
  let frame = 0;
  return {
    async write(rgba: Uint8Array): Promise<void> {
      if (rgba.length !== expected) {
        throw new Error(
          `PocketJS Motion: frame ${frame} has ${rgba.length} bytes, expected ` +
            `${expected} (${options.width}x${options.height} RGBA)`,
        );
      }
      const path = `${options.outDir}/${String(frame).padStart(6, "0")}.png`;
      await Bun.write(path, options.encodePNG(rgba, options.width, options.height));
      frame++;
    },
    async finish(): Promise<void> {
      /* every frame is already on disk; there is no container to finalise */
    },
    async abort(): Promise<void> {
      // Nothing is holding a pipe open, and the frames already written are
      // the frames that were rendered. Removing them would be this module
      // deciding what a caller wants out of a partial run.
    },
  };
}
