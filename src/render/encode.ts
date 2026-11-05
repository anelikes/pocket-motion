/**
 * Frames → ffmpeg. Raw RGBA on stdin, never PNG.
 *
 * Encoding a PNG per frame only for ffmpeg to decode it again is pure waste —
 * measured at 91% of wall time in one browser-free renderer we looked at
 * (35.03 ms/frame, of which 31.95 ms was the PNG encode). `-f rawvideo` skips
 * both halves.
 *
 * `-fflags +bitexact -flags +bitexact` drops the encoder tag and creation time
 * so the container is as reproducible as the encoder allows. That is a
 * courtesy, not the contract: the determinism claim rests on frame hashes
 * (src/render/hash.ts), never on MP4 bytes.
 *
 * FOUR OUTPUT FORMATS, and the encode leg is the only thing any of them
 * changes. Frames are hashed before a byte reaches here (`render.ts`), so the
 * digest of a composition is the same whichever format is asked for —
 * `tests/format.test.ts` asserts that rather than leaving it to be inferred
 * from the code's shape.
 *
 *   mp4      libx264, yuv420p — unchanged, and the default
 *   webm     libvpx-vp9, yuv420p (yuva420p with alpha)
 *   mov      ProRes 422 (yuv422p10le), or 4444 (yuva444p10le) with alpha
 *   png-seq  no ffmpeg at all — one RGBA PNG per frame (`pngSequenceSink`)
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
 * The H.264 encoders `render --encoder` takes, for mp4 only. Each is one this
 * repository has measured (`baselines/encode-cost.md`); ffmpeg has others,
 * and a name not here is refused rather than passed through on the strength
 * of ffmpeg knowing it.
 *
 * `h264_videotoolbox` is Apple's hardware encoder. It costs a fraction of
 * libx264's CPU and is not reproducible across machines: the bitstream is
 * the hardware's, so the MP4's bytes differ between two Macs given the same
 * frames. Frame hashes are taken before the encode leg (`render.ts`), so no
 * digest depends on which encoder ran. There is no hardware encoder on the
 * Linux CPU hosts this project deploys to; there the lever is `--preset`.
 */
export const MP4_ENCODERS = ["libx264", "h264_videotoolbox"] as const;
export type Mp4Encoder = (typeof MP4_ENCODERS)[number];

export function isMp4Encoder(value: string): value is Mp4Encoder {
  return (MP4_ENCODERS as readonly string[]).includes(value);
}

/** x264's own preset names, fastest first. `placebo` is left out. */
export const X264_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
] as const;
export type X264Preset = (typeof X264_PRESETS)[number];

export function isX264Preset(value: string): value is X264Preset {
  return (X264_PRESETS as readonly string[]).includes(value);
}

/**
 * `h264_videotoolbox`'s constant quality, `-q:v`, 1..100.
 *
 * Not a bitrate, and the measurement is why (`baselines/encode-cost.md`,
 * Apple M4). Given libx264's own bitrate, VideoToolbox lost 6.7 dB PSNR on a
 * 10 s 1080p title card and 15.1 dB on the hajibang ranking film, so a
 * matched rate is not a matched picture. Its `-b:v` follows the target up to
 * about 3.5 Mb/s and then stops: asked for 15.5 Mb/s, it delivered 4.6 and
 * 5.5. `-q:v` 87 is the lowest value measured that matches libx264 at
 * `medium`, CRF 16 — this leg's default — in both PSNR and SSIM on both
 * films, at 3.27 and 4.72 Mb/s, 2.8x and 3.9x libx264's bytes, and 29% and
 * 14% fewer bytes than the saturated `-b:v` that matched too. The rate is
 * whatever the content needs, as CRF's is. Measured on Apple silicon only;
 * VideoToolbox on an Intel Mac has no constant-quality mode.
 */
export const VIDEOTOOLBOX_QUALITY = 87;

/**
 * What the encode leg is told, decided once: `ffmpegArgs` builds from it and
 * `render --json` reports it, so the report cannot describe an encode other
 * than the one that ran.
 */
export type EncoderSettings =
  | { readonly codec: "libx264"; readonly preset: string; readonly crf: number }
  | { readonly codec: "h264_videotoolbox"; readonly quality: number }
  | { readonly codec: "libvpx-vp9"; readonly crf: number }
  | { readonly codec: "prores_ks"; readonly profile: "3" | "4" };

export function encoderSettings(options: EncodeOptions): EncoderSettings {
  const format = options.format ?? "mp4";
  if (format === "webm") return { codec: "libvpx-vp9", crf: options.crf ?? 24 };
  if (format === "mov") return { codec: "prores_ks", profile: options.alpha === true ? "4" : "3" };
  const encoder = options.encoder ?? "libx264";
  if (!isMp4Encoder(encoder)) {
    // `render` refuses this at argv; a direct caller is told here rather than
    // handed libx264 under a name it did not ask for.
    throw new Error(`PocketJS Motion: no measured mp4 encoder ${JSON.stringify(encoder)} (${MP4_ENCODERS.join(", ")})`);
  }
  if (encoder === "h264_videotoolbox") return { codec: encoder, quality: VIDEOTOOLBOX_QUALITY };
  return { codec: "libx264", preset: options.preset ?? "medium", crf: options.crf ?? 16 };
}

/**
 * Refuse an encoder and format pair the encode leg cannot honour, or a
 * preset the encoder would ignore. Each is a flag that would otherwise be
 * accepted and do nothing — or, for an encoder under webm or mov, replace
 * the codec the format names.
 */
export function assertEncoderSupported(
  format: OutputFormat,
  alpha: boolean,
  encoder: string | undefined,
  preset: string | undefined,
): void {
  if (encoder !== undefined) {
    if (!isMp4Encoder(encoder)) {
      throw new Error(
        `--encoder must be one of ${MP4_ENCODERS.join(", ")}; got ${JSON.stringify(encoder)}. ` +
          "These are the H.264 encoders this repository has measured (baselines/encode-cost.md).",
      );
    }
    if (format !== "mp4") {
      throw new Error(
        `--encoder chooses the H.264 encoder of an mp4; --format ${format} ` +
          (format === "png-seq" ? "runs no encoder at all." : `names its own codec (${format === "webm" ? "libvpx-vp9" : "prores_ks"}).`),
      );
    }
    if (alpha) {
      throw new Error(`--encoder ${encoder} writes H.264 as yuv420p, which has no alpha plane.`);
    }
  }
  if (preset !== undefined) {
    if (!isX264Preset(preset)) {
      throw new Error(`--preset must be one of ${X264_PRESETS.join(", ")}; got ${JSON.stringify(preset)}`);
    }
    if (format !== "mp4") {
      throw new Error(`--preset is libx264's; --format ${format} does not encode with it.`);
    }
    if ((encoder ?? "libx264") !== "libx264") {
      throw new Error(`--preset is libx264's; ${encoder} has no presets and would ignore it.`);
    }
  }
}

/**
 * Refuse an encoder this ffmpeg was built without, before a frame is
 * rendered. Without it the first frame written finds ffmpeg already gone,
 * and the error is a broken pipe. `ffmpeg -encoders` is asked rather than
 * the platform, because an ffmpeg can be built without VideoToolbox on a Mac
 * and without libx264 anywhere.
 */
export async function assertEncoderAvailable(codec: string): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-encoders"], { stdout: "pipe", stderr: "pipe" });
  const [listing] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const names = new Set(listing.split("\n").map((line) => line.trim().split(/\s+/)[1]));
  if (!names.has(codec)) {
    throw new Error(
      `PocketJS Motion: this ffmpeg has no ${codec} encoder (\`ffmpeg -encoders\` does not list it).` +
        (codec === "h264_videotoolbox"
          ? " VideoToolbox is macOS's; on any other host, leave --encoder at libx264 and use --preset."
          : ""),
    );
  }
}

export interface EncodeOptions {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly outputPath: string;
  /** Constant Rate Factor; lower is better quality. Default 16. */
  readonly crf?: number;
  /** x264 preset. Default "medium". libx264 only; `render` refuses it elsewhere. */
  readonly preset?: string;
  /**
   * The mp4's H.264 encoder (`MP4_ENCODERS`). Default `libx264`. webm and mov
   * name their own codec and do not read this; `render` refuses the pair.
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
  readonly format?: Exclude<OutputFormat, "png-seq">;
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
    "-fflags", "+bitexact",
    "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${width}x${height}`,
    "-framerate", String(fps),
    "-i", "-",
  ];
  if (options.scaleTo) {
    const [w, h] = options.scaleTo;
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
    args.push("-vf", `scale=${w}:${h}:flags=area`);
  }
  const alpha = options.alpha === true;
  const settings = encoderSettings(options);

  if (settings.codec === "libvpx-vp9") {
    // `-b:v 0` is what makes `-crf` mean constant quality in VP9; without it
    // libvpx reads the CRF as a ceiling on a bitrate target of zero and
    // produces a picture nobody asked for. `-row-mt 1` is threading only.
    args.push(
      "-c:v",
      settings.codec,
      "-crf",
      String(settings.crf),
      "-b:v",
      "0",
      "-row-mt",
      "1",
      "-pix_fmt",
      alpha ? "yuva420p" : "yuv420p",
      outputPath,
    );
    return args;
  }

  if (settings.codec === "prores_ks") {
    // prores_ks profile 3 is 422 HQ and 4 is 4444. Only 4444 has an alpha
    // plane, so the profile and the pixel format are one decision, made here
    // rather than left to two flags that can disagree.
    args.push(
      "-c:v",
      settings.codec,
      "-profile:v",
      settings.profile === "4" ? "4444" : "3",
      "-pix_fmt",
      alpha ? "yuva444p10le" : "yuv422p10le",
      outputPath,
    );
    return args;
  }

  args.push("-c:v", settings.codec);
  if (settings.codec === "libx264") {
    args.push("-preset", settings.preset, "-crf", String(settings.crf), "-flags", "+bitexact");
  } else {
    // A quality, not a rate: see VIDEOTOOLBOX_QUALITY. `-allow_sw 0` is the
    // default and is stated, because VideoToolbox's software fallback would
    // make `--encoder h264_videotoolbox` an encoder nobody measured.
    args.push("-q:v", String(settings.quality), "-allow_sw", "0");
  }
  args.push("-pix_fmt", "yuv420p", outputPath);
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
