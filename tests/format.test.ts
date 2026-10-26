/**
 * `render --format` and `--alpha`: what each one actually produces, read back
 * out of the file rather than off the argv.
 *
 * The argv cases below are unit tests of `ffmpegArgs` and say what was asked
 * for. The `describe("what ffmpeg actually wrote")` block is the one that
 * matters: it renders `compositions/alpha` four ways and asks ffprobe what
 * came out, because "we passed -pix_fmt yuva444p10le" and "the file carries
 * an alpha channel" are different claims and one of them was wrong twice
 * while this was being written.
 *
 * TWO THINGS READING THE ARGV WOULD HAVE GOT WRONG, both pinned below:
 *
 * - ProRes 4444 is asked for as `yuva444p10le` and DECODES as
 *   `yuva444p12le`. The 4444 bitstream is 12-bit; the encoder takes a 10-bit
 *   input pixel format and the decoder reports the bitstream's. So the
 *   assertion is on the profile and on the alpha plane being present, not on
 *   the bit depth.
 * - VP9-in-WebM carries alpha OUT OF BAND. The video stream's own `pix_fmt`
 *   stays `yuv420p` whether or not `--alpha` was given, and the difference is
 *   the container's `alpha_mode` tag. Asserting `pix_fmt=yuva420p` would have
 *   been red on a correct file.
 *
 * And the property the whole feature rests on: **the frame digest does not
 * move with the format.** Frames are hashed before the sink is written to, so
 * all four renders below report the same digest, and it is the one in
 * `baselines/digests.json`.
 *
 * `describe("delivered files, read back")` holds the three things a file had
 * wrong while every gate was green, each measured on main before the fix:
 *
 * - SOUND TURNED EVERY FORMAT INTO AN MP4. The mux wrote `<out>.mixing.mp4`
 *   with AAC whatever `--format` said: a `.webm` held an ISO MP4 of VP9 and
 *   AAC with its alpha gone, and every `.mov` failed outright, because the
 *   MP4 muxer has no tag for ProRes. The container is read here from the
 *   bytes — MP4 and MOV by their `ftyp` brand, WebM by its EBML DocType,
 *   since ffprobe names both Matroska flavours `matroska,webm` — and VP9's
 *   alpha by its track's AlphaMode element and by decoding it.
 * - NO COLOUR TAGS, AND A BT.601 MATRIX. A field of flat patches read back
 *   under BT.709, which is what a player takes for an untagged HD file, had
 *   a channel 40 levels out; now the tags are asserted and the decode honours
 *   them.
 * - AUDIO SHORTER THAN THE PICTURE. A 1 s cue under a 2 s film delivered a
 *   1 s audio stream.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DELIVERY_COLOUR,
  OUTPUT_FORMATS,
  createEncodeSink,
  ffmpegArgs,
  formatCarriesAlpha,
  formatExtension,
  pngSequenceSink,
  type ContainerFormat,
} from "../src/render/encode.ts";
import { parseSidecar } from "../src/manifest/sidecar.ts";
import { mixGraph } from "../src/sound/mix.ts";
import { muxArgs, muxAudioArgs, muxSound, soundManifestPath } from "../src/sound/mux.ts";
import { decodeDeliveredPcm, DELIVERED_PCM } from "../src/sound/tail.ts";
import { assertAlphaSupported, resolveFormat } from "../src/cli/commands/render.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { UsageError } from "../src/cli/args.ts";
import { EXIT_OK, EXIT_USAGE } from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const ALPHA_DIR = "compositions/alpha";
const SOUND_ROLES_DIR = "compositions/sound-roles";
const TMP = "/tmp/pocketjs-motion-format-test";

process.env.POCKETJS_ROOT = VENDOR;

/** The digest `compositions/alpha` is recorded at, whatever format asks. */
const LEDGER_DIGEST = (
  JSON.parse(readFileSync(join(ROOT, "baselines/digests.json"), "utf8")) as {
    compositions: Record<string, { digest: string }>;
  }
).compositions[ALPHA_DIR]!.digest;

async function cli(argv: readonly string[]): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["bun", "src/cli/main.ts", ...argv], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, POCKETJS_ROOT: VENDOR },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: stdout + stderr, code };
}

async function ffprobeStream(path: string): Promise<Record<string, string>> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`ffprobe failed on ${path}`);
  const fields: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return fields;
}

/** stdout of an ffmpeg-family command, as bytes; throws on a non-zero exit. */
async function runBytes(argv: readonly string[]): Promise<Uint8Array> {
  const p = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).arrayBuffer(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) throw new Error(`${argv.join(" ")} exited ${code}\n${err.trim()}`);
  return new Uint8Array(out);
}

interface Probed {
  format: { format_name: string; tags?: Record<string, string> };
  streams: Array<Record<string, string | undefined> & { tags?: Record<string, string> }>;
}

async function probe(path: string): Promise<Probed> {
  const text = new TextDecoder().decode(
    await runBytes(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path]),
  );
  return JSON.parse(text) as Probed;
}

function streamOf(p: Probed, type: "video" | "audio"): Probed["streams"][number] | undefined {
  return p.streams.find((s) => s.codec_type === type);
}

/** A stream's duration: MP4 and MOV state it on the stream, Matroska in a DURATION tag. */
function streamSec(s: Probed["streams"][number]): number {
  if (s.duration !== undefined && s.duration !== "N/A") return Number(s.duration);
  const [h, m, sec] = (s.tags?.DURATION ?? "").split(":");
  if (sec === undefined) throw new Error(`no duration on stream ${s.index}`);
  return Number(h) * 3600 + Number(m) * 60 + Number(sec);
}

/**
 * What an MP4 or MOV says it is: its `ftyp` major brand, read from the bytes.
 * ffprobe's `format_name` is the same string for both.
 */
function ftypBrand(bytes: Uint8Array): string | null {
  if (new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") return null;
  return new TextDecoder().decode(bytes.subarray(8, 12));
}

/**
 * The header of a Matroska file, read from the bytes: the EBML DocType —
 * `webm` or `matroska`, which ffprobe reports alike as `matroska,webm` — and
 * each track's CodecID and AlphaMode element, which is what a browser reads
 * to decode VP9's out-of-band alpha. ffprobe's `alpha_mode` tag is derived:
 * on a remuxed file it comes back as `ALPHA_MODE`, from a SimpleTag the
 * remux copied, whether or not the element is there.
 */
function matroskaHeader(bytes: Uint8Array): {
  docType: string | null;
  tracks: Array<{ codec: string; alphaMode: number | null }>;
} {
  const vint = (p: number, keepMarker: boolean): [value: number, length: number] => {
    const first = bytes[p]!;
    let len = 1;
    while (len < 8 && (first & (0x80 >> (len - 1))) === 0) len++;
    let v = keepMarker ? first : first & (0xff >> len);
    for (let i = 1; i < len; i++) v = v * 256 + bytes[p + i]!;
    return [v, len];
  };
  const children = (from: number, to: number) => {
    const out: Array<{ id: number; start: number; end: number }> = [];
    for (let p = from; p < to; ) {
      const [id, il] = vint(p, true);
      const [size, sl] = vint(p + il, false);
      const start = p + il + sl;
      const end = Math.min(to, start + size);
      out.push({ id, start, end });
      p = end;
    }
    return out;
  };
  const text = (e: { start: number; end: number }) =>
    new TextDecoder().decode(bytes.subarray(e.start, e.end)).replace(/\0+$/, "");
  const uint = (e: { start: number; end: number }) =>
    [...bytes.subarray(e.start, e.end)].reduce((v, b) => v * 256 + b, 0);

  let docType: string | null = null;
  const tracks: Array<{ codec: string; alphaMode: number | null }> = [];
  let p = 0;
  // EBML header, then the Segment; stop at the first Cluster, past the header.
  const [headerId, hl] = vint(p, true);
  if (headerId !== 0x1a45dfa3) return { docType, tracks };
  const [headerSize, hsl] = vint(p + hl, false);
  for (const e of children(p + hl + hsl, p + hl + hsl + headerSize)) {
    if (e.id === 0x4282) docType = text(e);
  }
  p = p + hl + hsl + headerSize;
  const [segId, gl] = vint(p, true);
  if (segId !== 0x18538067) return { docType, tracks };
  const [, gsl] = vint(p + gl, false);
  for (let q = p + gl + gsl; q < bytes.length; ) {
    const [id, il] = vint(q, true);
    if (id === 0x1f43b675) break;
    const [size, sl] = vint(q + il, false);
    const start = q + il + sl;
    if (id === 0x1654ae6b) {
      for (const entry of children(start, start + size)) {
        if (entry.id !== 0xae) continue;
        let codec = "";
        let alphaMode: number | null = null;
        for (const f of children(entry.start, entry.end)) {
          if (f.id === 0x86) codec = text(f);
          if (f.id === 0xe0) {
            for (const v of children(f.start, f.end)) if (v.id === 0x53c0) alphaMode = uint(v);
          }
        }
        tracks.push({ codec, alphaMode });
      }
    }
    q = start + size;
  }
  return { docType, tracks };
}

/** The container a delivered file actually is, from its bytes. */
function containerOf(path: string): string {
  const bytes = new Uint8Array(readFileSync(path));
  const brand = ftypBrand(bytes);
  if (brand !== null) return `ftyp:${brand.trim()}`;
  const docType = matroskaHeader(bytes).docType;
  return docType === null ? "unknown" : `ebml:${docType}`;
}

const CONTAINER: Record<ContainerFormat, string> = {
  mp4: "ftyp:isom",
  webm: "ebml:webm",
  mov: "ftyp:qt",
};

/**
 * No muxer version string in the container: `-fflags +bitexact` reached the
 * output. A versioned `encoder=Lavf62.3.100` is what every delivery carried
 * while the flag sat on the input side.
 */
function versionedMuxerTag(p: Probed): string | undefined {
  return Object.values(p.format.tags ?? {}).find((v) => /^Lavf\d/.test(v));
}

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

describe("ffmpegArgs by format", () => {
  const base = { width: 320, height: 180, fps: 30, outputPath: "/dev/null" } as const;

  test("mp4 is unchanged — libx264, yuv420p, bitexact", () => {
    const args = ffmpegArgs(base).join(" ");
    expect(args).toContain("-c:v libx264");
    expect(args).toContain("-pix_fmt yuv420p");
    expect(args).toContain("-flags +bitexact");
    // Absent `format` must mean exactly what it meant before this flag
    // existed, or every recorded mp4 in the tree stops being reproducible.
    expect(ffmpegArgs({ ...base, format: "mp4" })).toEqual(ffmpegArgs(base));
  });

  test("webm is VP9, and `-b:v 0` is what makes --crf mean quality", () => {
    const args = ffmpegArgs({ ...base, format: "webm" }).join(" ");
    expect(args).toContain("-c:v libvpx-vp9");
    expect(args).toContain("-b:v 0");
    expect(args).toContain("-pix_fmt yuv420p");
    expect(ffmpegArgs({ ...base, format: "webm", alpha: true }).join(" ")).toContain(
      "-pix_fmt yuva420p",
    );
  });

  test("mov picks profile and pixel format together, never separately", () => {
    const plain = ffmpegArgs({ ...base, format: "mov" }).join(" ");
    expect(plain).toContain("-c:v prores_ks");
    expect(plain).toContain("-profile:v 3");
    expect(plain).toContain("-pix_fmt yuv422p10le");

    const alpha = ffmpegArgs({ ...base, format: "mov", alpha: true }).join(" ");
    expect(alpha).toContain("-profile:v 4444");
    expect(alpha).toContain("-pix_fmt yuva444p10le");
  });

  test("the supersample downscale still applies whatever the format", () => {
    for (const format of ["mp4", "webm", "mov"] as const) {
      expect(
        ffmpegArgs({ ...base, format, scaleTo: [160, 90] }).join(" "),
        format,
      ).toContain("scale=160:90:flags=area:");
    }
  });

  test("each container is named with -f, and bitexact is an OUTPUT flag", () => {
    // ffmpeg picks a muxer by extension when not told, and `render --format mov
    // --out cut` — which resolveFormat accepts — failed with "Unable to choose
    // an output format". The format flag before `-i -` set the rawvideo
    // demuxer bitexact and left the muxer writing its version.
    for (const format of ["mp4", "webm", "mov"] as const) {
      const args = ffmpegArgs({ ...base, format });
      expect(args.slice(-5), format).toEqual(["-fflags", "+bitexact", "-f", format, "/dev/null"]);
      expect(args.indexOf("-fflags"), format).toBeGreaterThan(args.indexOf("-"));
    }
  });

  test("the conversion to YUV names BT.709, and the stream is tagged with what it names", () => {
    for (const [format, alpha, pixFmt] of [
      ["mp4", false, "yuv420p"],
      ["webm", false, "yuv420p"],
      ["webm", true, "yuva420p"],
      ["mov", false, "yuv422p10le"],
      ["mov", true, "yuva444p10le"],
    ] as const) {
      const args = ffmpegArgs({ ...base, format, alpha });
      const vf = args[args.indexOf("-vf") + 1];
      expect(vf, `${format} ${alpha}`).toBe(
        "setparams=color_primaries=bt709:color_trc=bt709," +
          `scale=out_color_matrix=bt709:out_range=tv,format=${pixFmt}`,
      );
      const joined = args.join(" ");
      for (const tag of [
        "-colorspace bt709",
        "-color_primaries bt709",
        "-color_trc bt709",
        "-color_range tv",
        `-pix_fmt ${pixFmt}`,
      ]) {
        expect(joined, `${format} ${alpha}`).toContain(tag);
      }
    }
    expect(DELIVERY_COLOUR).toEqual({ matrix: "bt709", primaries: "bt709", transfer: "bt709", range: "tv" });
  });
});

describe("the sound mux, by container", () => {
  test("each container carries its own audio codec and is named with -f", () => {
    expect(muxAudioArgs("mp4")).toEqual(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]);
    expect(muxAudioArgs("webm")).toEqual(["-c:a", "libopus", "-b:a", "192k", "-ar", "48000"]);
    expect(muxAudioArgs("mov")).toEqual(["-c:a", "pcm_s24le", "-ar", "48000", "-movflags", "+faststart"]);
    const graph = { inputArgs: [], filter: "anullsrc[a]", outputLabel: "[a]" as const, elements: [] };
    for (const format of ["mp4", "webm", "mov"] as const) {
      const args = muxArgs("in", "out", graph, 2, format);
      expect(args.slice(-5), format).toEqual(["-fflags", "+bitexact", "-f", format, "out"]);
      expect(args.join(" "), format).toContain("-c:v copy");
    }
  });

  test("the record is named after the whole delivered file, so two formats of one name keep two", () => {
    // `hero.mp4` and `hero.webm` are the pair a page lists as two sources of
    // one <video>. Stripping the extension gave both one record.
    const paths = ["/o/hero.mp4", "/o/hero.webm", "/o/hero.mov", "/o/hero"].map(soundManifestPath);
    expect(paths).toEqual([
      "/o/hero.mp4.sound.json",
      "/o/hero.webm.sound.json",
      "/o/hero.mov.sound.json",
      "/o/hero.sound.json",
    ]);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("resolveFormat", () => {
  test("no --format: the extension decides, and mp4 is the fallback", () => {
    expect(resolveFormat(undefined, "out.mp4")).toBe("mp4");
    expect(resolveFormat(undefined, "out.mov")).toBe("mov");
    expect(resolveFormat(undefined, "out.webm")).toBe("webm");
    expect(resolveFormat(undefined, "frames")).toBe("mp4");
  });

  test("--format and an extension that disagree is refused, not silently won", () => {
    // A .webm holding H.264 plays and reports a sensible duration. It is
    // exactly the silent-wrong-result shape refused everywhere else here.
    expect(() => resolveFormat("mp4", "cut.webm")).toThrow(UsageError);
    expect(() => resolveFormat("mov", "cut.mp4")).toThrow(/disagree|names/);
    expect(resolveFormat("mov", "cut.mov")).toBe("mov");
    expect(resolveFormat("mov", "cut")).toBe("mov");
  });

  test("png-seq writes a directory, so an extension on --out is refused", () => {
    expect(resolveFormat("png-seq", "frames")).toBe("png-seq");
    expect(() => resolveFormat("png-seq", "frames.mp4")).toThrow(/directory/);
  });

  test("an unknown format names the four", () => {
    expect(() => resolveFormat("gif", "out.gif")).toThrow(/mp4, webm, mov, png-seq/);
  });

  test("--alpha against mp4 is refused rather than dropped", () => {
    expect(() => assertAlphaSupported("mp4", true)).toThrow(/no alpha plane/);
    for (const format of OUTPUT_FORMATS) {
      if (format === "mp4") continue;
      expect(() => assertAlphaSupported(format, true), format).not.toThrow();
    }
    expect(() => assertAlphaSupported("mp4", false)).not.toThrow();
  });

  test("formatExtension and formatCarriesAlpha agree with the table above", () => {
    expect(formatExtension("mp4")).toBe(".mp4");
    expect(formatExtension("png-seq")).toBeNull();
    expect(formatCarriesAlpha("mp4")).toBe(false);
    expect(formatCarriesAlpha("mov")).toBe(true);
  });
});

describe("pngSequenceSink", () => {
  test("refuses a supersampled render rather than writing the wrong size", () => {
    // The downscale is an ffmpeg filter and this format runs no ffmpeg.
    // Accepting `scaleTo` would write supersampled frames under a sidecar
    // that declares another size, which has already shipped once here on the
    // mp4 leg.
    expect(() =>
      pngSequenceSink({
        width: 640,
        height: 360,
        outDir: TMP,
        encodePNG: () => new Uint8Array(),
        scaleTo: [320, 180],
      }),
    ).toThrow(/cannot downscale/);
  });

  test("a frame of the wrong length is named by index", async () => {
    const sink = pngSequenceSink({
      width: 2,
      height: 2,
      outDir: TMP,
      encodePNG: () => new Uint8Array([1]),
    });
    await expect(sink.write(new Uint8Array(4))).rejects.toThrow(/frame 0 has 4 bytes/);
  });
});

// ---------------------------------------------------------------------------
// Delivered files, read back — the encode leg and the sound mux, driven with
// a known picture rather than a composition, so every number below is
// against an input whose bytes the test wrote.
// ---------------------------------------------------------------------------

/** Flat patches, 64 px square, so chroma subsampling has nothing to blur at a centre. */
const FIELD = { width: 256, height: 128, fps: 30, frames: 60 } as const;
const PATCHES: ReadonlyArray<readonly [number, number, number]> = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
  [0, 255, 255], [255, 0, 255], [128, 128, 128], [200, 150, 120],
];

/**
 * How far a patch may decode from what was written, per channel, in levels.
 * Measured with the BT.709 conversion and tags: 1 through H.264 and VP9, 0
 * through ProRes. Measured on main, untagged BT.601 decoded the way a player
 * takes an untagged HD file: 39 (H.264, VP9) and 40 (ProRes) — 255 green came
 * back 216.
 */
const COLOUR_TOLERANCE = 3;

/** Left half opaque, then a quarter at 128, then a quarter transparent. */
function colourField(): Uint8Array {
  const { width, height } = FIELD;
  const b = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = PATCHES[Math.floor(y / 64) * 4 + Math.floor(x / 64)]!;
      const i = (y * width + x) * 4;
      b[i] = c[0];
      b[i + 1] = c[1];
      b[i + 2] = c[2];
      b[i + 3] = x < 128 ? 255 : x < 192 ? 128 : 0;
    }
  }
  return b;
}

const DELIVERIES = [
  { name: "mp4", format: "mp4", alpha: false },
  { name: "webm", format: "webm", alpha: false },
  { name: "webm-alpha", format: "webm", alpha: true },
  { name: "mov", format: "mov", alpha: false },
  { name: "mov-alpha", format: "mov", alpha: true },
] as const;

/**
 * The first frame as RGB, decoded the way a player does: with the matrix and
 * range the stream is tagged with, and BT.709 / video range where it carries
 * none — what a player takes for an untagged HD file.
 */
async function decodeAsPlayer(path: string): Promise<Uint8Array> {
  const v = streamOf(await probe(path), "video")!;
  const matrix =
    v.color_space === "smpte170m" || v.color_space === "bt470bg" ? "bt601" : "bt709";
  const range = v.color_range === "pc" ? "pc" : "tv";
  return runBytes([
    "ffmpeg", "-v", "error", "-i", path, "-frames:v", "1",
    "-vf", `scale=in_color_matrix=${matrix}:in_range=${range}:flags=accurate_rnd+full_chroma_int,format=rgb24`,
    "-f", "rawvideo", "-",
  ]);
}

/** Every frame as RGBA, alpha included: VP9's out-of-band alpha needs libvpx's decoder. */
async function decodeRgba(path: string, format: ContainerFormat): Promise<Uint8Array> {
  return runBytes([
    "ffmpeg", "-v", "error",
    ...(format === "webm" ? ["-c:v", "libvpx-vp9"] : []),
    "-i", path, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ]);
}

/** One frame of the codec, in seconds: the most two stream ends may differ by. */
function audioFrameSec(a: Probed["streams"][number]): number {
  const rate = Number(a.sample_rate);
  if (a.codec_name === "aac") return 1024 / rate;
  // libopus's default frame is 20 ms.
  if (a.codec_name === "opus") return 0.02;
  return 1 / rate;
}

describe("delivered files, read back", () => {
  let dir = "";
  const film = FIELD.frames / FIELD.fps;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pocketjs-motion-delivery-"));
    const field = colourField();
    for (const d of DELIVERIES) {
      const sink = createEncodeSink({
        width: FIELD.width,
        height: FIELD.height,
        fps: FIELD.fps,
        outputPath: join(dir, `${d.name}.${d.format}`),
        format: d.format,
        alpha: d.alpha,
      });
      for (let f = 0; f < FIELD.frames; f++) await sink.write(field);
      await sink.finish();
    }
    await runBytes([
      "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=44100",
      "-c:a", "pcm_s16le", join(dir, "tone.wav"),
    ]);
  }, 300_000);
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("a colour field decodes to its own RGB under the tags each format carries", async () => {
    for (const d of DELIVERIES) {
      const path = join(dir, `${d.name}.${d.format}`);
      const v = streamOf(await probe(path), "video")!;
      expect(
        [v.color_space, v.color_primaries, v.color_transfer],
        d.name,
      ).toEqual(["bt709", "bt709", "bt709"]);
      // ProRes has no range field, in its bitstream or in MOV's `colr`, so
      // ffprobe reports none and decoders take video range.
      expect(v.color_range, d.name).toBe(d.format === "mov" ? undefined : "tv");

      const rgb = await decodeAsPlayer(path);
      const off: string[] = [];
      PATCHES.forEach((want, k) => {
        const x = (k % 4) * 64 + 32;
        const y = Math.floor(k / 4) * 64 + 32;
        const i = (y * FIELD.width + x) * 3;
        const got = [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
        if (got.some((g, c) => Math.abs(g - want[c]!) > COLOUR_TOLERANCE)) {
          off.push(`${want.join(",")} → ${got.join(",")}`);
        }
      });
      expect(off, d.name).toEqual([]);
    }
  }, 300_000);

  test(
    "sound muxes into the container --format names, keeps the alpha and the colour, and lasts as long as the picture",
    async () => {
      // A 1 s cue under a 2 s film: the mix ends with the cue unless it is padded.
      const parsed = parseSidecar({
        motion: 1,
        durationFrames: FIELD.frames,
        fps: FIELD.fps,
        sound: { cues: [{ id: "tone", src: "tone.wav", atFrame: 0 }] },
      });
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
      const graph = mixGraph(
        parsed.value.sound,
        [
          {
            id: "tone",
            role: "cue",
            src: "tone.wav",
            path: join(dir, "tone.wav"),
            pointer: "/sound/cues/0/src",
            durationSec: 1,
          },
        ],
        FIELD.fps,
        FIELD.frames,
      );
      const codecs: Record<ContainerFormat, [string, string]> = {
        mp4: ["h264", "aac"],
        webm: ["vp9", "opus"],
        mov: ["prores", "pcm_s24le"],
      };

      for (const d of DELIVERIES) {
        const picture = join(dir, `${d.name}.${d.format}`);
        const out = join(dir, `${d.name}-sound.${d.format}`);
        const mixed = await muxSound({
          videoPath: picture,
          outputPath: out,
          graph,
          durationSec: film,
          format: d.format,
        });
        expect(mixed.manifestPath, d.name).toBe(`${out}.sound.json`);
        expect(existsSync(mixed.manifestPath), d.name).toBe(true);

        expect(containerOf(out), d.name).toBe(CONTAINER[d.format]);
        const p = await probe(out);
        expect(versionedMuxerTag(p), d.name).toBeUndefined();
        const v = streamOf(p, "video")!;
        const a = streamOf(p, "audio")!;
        expect([v.codec_name, a.codec_name], d.name).toEqual(codecs[d.format]);
        expect([v.color_space, v.color_primaries, v.color_transfer], d.name).toEqual([
          "bt709",
          "bt709",
          "bt709",
        ]);

        // As long as the picture, read two ways: the durations the container
        // states, which is what a player shows, and the samples a decode
        // yields, which is what it plays.
        const frame = audioFrameSec(a);
        expect(Math.abs(streamSec(v) - film), d.name).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(streamSec(a) - streamSec(v)), `${d.name} stated`).toBeLessThanOrEqual(frame);
        const pcm = await decodeDeliveredPcm(out);
        const decodedSec = pcm.byteLength / (2 * DELIVERED_PCM.channels) / DELIVERED_PCM.rate;
        expect(Math.abs(decodedSec - film), `${d.name} decoded`).toBeLessThanOrEqual(frame);

        if (d.format === "webm") {
          const header = matroskaHeader(new Uint8Array(readFileSync(out)));
          const video = header.tracks.find((t) => t.codec === "V_VP9");
          expect(video?.alphaMode ?? null, d.name).toBe(d.alpha ? 1 : null);
        }
        if (d.alpha) {
          // The picture the mux copied is the picture the encode leg wrote,
          // alpha plane included, and the plane carries the field's three levels.
          const before = await decodeRgba(picture, d.format);
          const after = await decodeRgba(out, d.format);
          expect(Bun.SHA256.hash(after, "hex"), d.name).toBe(Bun.SHA256.hash(before, "hex"));
          const levels = new Set<number>();
          for (let i = 3; i < FIELD.width * FIELD.height * 4; i += 4) levels.add(after[i]!);
          expect(levels.has(0) && levels.has(255) && levels.size >= 3, d.name).toBe(true);
          if (d.format === "mov") expect(v.profile, d.name).toBe("4444");
        }
      }
    },
    300_000,
  );
});

// ---------------------------------------------------------------------------
// The file, read back
// ---------------------------------------------------------------------------

describe("what ffmpeg actually wrote", () => {
  beforeAll(async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    // `render` without `--spec` does not build: `resolveComposition` is called
    // with `requireBundle: true` and refuses a missing bundle with exit 2. So
    // every render below reads artifacts somebody else made, and on a checkout
    // whose `dist/` is empty — a fresh clone, and every CI runner — nobody
    // does: nothing else in this suite builds either of these two, and
    // `AUTHORING.md`'s `build compositions/alpha` fence runs in
    // `tests/authoring.test.ts`'s scratch tree and lands in ITS dist. Verified
    // by hand: with `dist/compositions/alpha` moved aside, `render
    // compositions/alpha --format mov --alpha` exits 2 with `bundle not
    // found`, and six of the seven tests in this block go red on it.
    //
    // Built the way the sibling fixtures are, through `runBuild`, which writes
    // the `build.json` every command that reads a bundle demands.
    for (const dir of [ALPHA_DIR, SOUND_ROLES_DIR]) {
      const resolved = await resolveComposition({
        dir: join(ROOT, dir),
        flags: { json: false },
        requireBundle: false,
      });
      if (!resolved.ok) throw new Error(`${dir}: ${resolved.message}`);
      await runBuild(resolved.value);
    }
  }, 600_000);
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  test(
    "mp4, webm, mov and png-seq all report the ledger's digest",
    async () => {
      // Frames are hashed before a byte reaches the sink, so the format
      // cannot move the digest. Asserted rather than left to be read off the
      // shape of render.ts.
      const digests: Record<string, string> = {};
      for (const [format, out] of [
        ["mp4", join(TMP, "a.mp4")],
        ["webm", join(TMP, "a.webm")],
        ["mov", join(TMP, "a.mov")],
        ["png-seq", join(TMP, "seq")],
      ] as const) {
        const { out: text, code } = await cli([
          "render",
          ALPHA_DIR,
          "--format",
          format,
          "--out",
          out,
          "--json",
        ]);
        expect(`${format}: ${code}`).toBe(`${format}: ${EXIT_OK}`);
        const payload = JSON.parse(text.slice(text.indexOf("{"))) as {
          digest: string;
          format: string;
        };
        expect(payload.format).toBe(format);
        digests[format] = payload.digest;
        if (format === "png-seq") continue;
        // And the file is the container its format names, tagged with the
        // colour it was converted with — a composition with no sound.
        expect(containerOf(out), format).toBe(CONTAINER[format]);
        const probed = await probe(out);
        expect(probed.streams.map((s) => s.codec_type), format).toEqual(["video"]);
        const v = streamOf(probed, "video")!;
        expect([v.color_space, v.color_primaries, v.color_transfer], format).toEqual([
          "bt709",
          "bt709",
          "bt709",
        ]);
        expect(versionedMuxerTag(probed), format).toBeUndefined();
      }
      expect(Object.values(digests)).toEqual([
        LEDGER_DIGEST,
        LEDGER_DIGEST,
        LEDGER_DIGEST,
        LEDGER_DIGEST,
      ]);
    },
    600_000,
  );

  test(
    "--out with no extension still gets the container --format names",
    async () => {
      // resolveFormat accepts it; ffmpeg, choosing a muxer by extension, did not.
      const out = join(TMP, "cut");
      const { out: text, code } = await cli(["render", ALPHA_DIR, "--format", "mov", "--out", out]);
      expect(code, text).toBe(EXIT_OK);
      expect(containerOf(out)).toBe(CONTAINER.mov);
    },
    600_000,
  );

  test(
    "mov --alpha is ProRes 4444 with an alpha plane; without it, 422 HQ",
    async () => {
      const withAlpha = join(TMP, "alpha.mov");
      expect((await cli(["render", ALPHA_DIR, "--format", "mov", "--alpha", "--out", withAlpha])).code).toBe(
        EXIT_OK,
      );
      const a = await ffprobeStream(withAlpha);
      expect(a.codec_name).toBe("prores");
      expect(a.profile).toBe("4444");
      // Asked for as yuva444p10le; the 4444 bitstream is 12-bit, so the
      // DECODER reports yuva444p12le. What is being asserted is the alpha
      // plane, not the bit depth.
      expect(a.pix_fmt).toStartWith("yuva444p");

      const plain = join(TMP, "plain.mov");
      expect((await cli(["render", ALPHA_DIR, "--format", "mov", "--out", plain])).code).toBe(EXIT_OK);
      const p = await ffprobeStream(plain);
      expect(p.profile).toBe("HQ");
      expect(p.pix_fmt).toBe("yuv422p10le");
    },
    600_000,
  );

  test(
    "webm --alpha carries alpha in the container, not in the stream's pix_fmt",
    async () => {
      const withAlpha = join(TMP, "alpha.webm");
      expect(
        (await cli(["render", ALPHA_DIR, "--format", "webm", "--alpha", "--out", withAlpha])).code,
      ).toBe(EXIT_OK);
      const a = await ffprobeStream(withAlpha);
      expect(a.codec_name).toBe("vp9");
      // VP9 stores alpha out of band, referenced by Matroska's AlphaMode. The
      // video stream's own pixel format stays yuv420p, so `pix_fmt` is not
      // where the answer is — asserting yuva420p here would be red on a
      // correct file.
      expect(a.pix_fmt).toBe("yuv420p");
      expect(a["TAG:alpha_mode"]).toBe("1");

      const plain = join(TMP, "plain.webm");
      expect((await cli(["render", ALPHA_DIR, "--format", "webm", "--out", plain])).code).toBe(
        EXIT_OK,
      );
      expect((await ffprobeStream(plain))["TAG:alpha_mode"]).toBeUndefined();
    },
    600_000,
  );

  test(
    "png-seq writes the same bytes `frame --at N` does",
    async () => {
      // The strongest thing that can be said about this leg: it is not a
      // second rendering of the picture, it is the same PNG the frame
      // debugger hands out. Same claim preview's /frame makes.
      const seq = join(TMP, "cmp-seq");
      expect((await cli(["render", ALPHA_DIR, "--format", "png-seq", "--out", seq])).code).toBe(
        EXIT_OK,
      );
      for (const at of [0, 1]) {
        const single = join(TMP, `f${at}.png`);
        expect((await cli(["frame", ALPHA_DIR, "--at", String(at), "--out", single])).code).toBe(
          EXIT_OK,
        );
        const a = new Uint8Array(await Bun.file(single).arrayBuffer());
        const b = new Uint8Array(
          await Bun.file(join(seq, `${String(at).padStart(6, "0")}.png`)).arrayBuffer(),
        );
        expect(`frame ${at}: ${a.length} bytes`).toBe(`frame ${at}: ${b.length} bytes`);
        expect(Bun.SHA256.hash(a, "hex")).toBe(Bun.SHA256.hash(b, "hex"));
      }
      expect(existsSync(join(seq, "000002.png"))).toBe(false);
    },
    600_000,
  );

  test(
    "the alpha floor is measured, and it is 0 — the channel carries the picture",
    async () => {
      // `compositions/alpha` declares no ground. Patch 0014 clears the
      // framebuffer to transparent black, so every pixel its one panel does
      // not cover has alpha 0 and the floor is 0. Before the patch this
      // asserted 255 and said so; the number is the evidence either way.
      const { out } = await cli([
        "render",
        ALPHA_DIR,
        "--format",
        "mov",
        "--alpha",
        "--out",
        join(TMP, "floor.mov"),
        "--json",
      ]);
      const payload = JSON.parse(out.slice(out.indexOf("{"))) as {
        alpha: boolean;
        alphaFloor: number;
      };
      expect(payload.alpha).toBe(true);
      expect(payload.alphaFloor).toBe(0);
    },
    600_000,
  );

  test(
    "declared sound and png-seq: the mix is skipped, and the run says so",
    async () => {
      // A directory of stills is not a container and has nowhere to put an
      // audio stream. Every other absence in this project is loud, so this
      // one is reported rather than dropped — `compositions/sound-roles`
      // declares one element of each role and is the only composition that
      // can put the question. Four frames: this is about the branch, not the
      // picture.
      const seq = join(TMP, "sound-seq");
      const { out, code } = await cli([
        "render",
        "compositions/sound-roles",
        "--frames",
        "4",
        "--format",
        "png-seq",
        "--out",
        seq,
        "--json",
      ]);
      expect(code).toBe(EXIT_OK);
      const payload = JSON.parse(out.slice(out.indexOf("{"))) as {
        sound?: unknown;
        soundSkipped?: string;
      };
      expect(payload.sound).toBeUndefined();
      expect(payload.soundSkipped).toContain("not a container");
      expect(existsSync(join(seq, "000003.png"))).toBe(true);
    },
    900_000,
  );

  test(
    "declared sound and webm or mov: the container --format names, the tail, and sound --verify",
    async () => {
      // `compositions/sound-roles` declares one element of each role and a
      // 500 ms silent tail. Measured on main: to webm, an ISO MP4 of VP9 and
      // AAC under the .webm name; to mov, `render` exited 1 with "Could not
      // find tag for codec prores". The tail is measured after the mux on
      // every container, and `sound --verify` reads the file the way a
      // player would — an Opus WebM's window cut by seeking read 8 ms early.
      const want: Record<"webm" | "mov", [string, string]> = {
        webm: ["vp9", "opus"],
        mov: ["prores", "pcm_s24le"],
      };
      for (const format of ["webm", "mov"] as const) {
        const out = join(TMP, `roles.${format}`);
        const render = await cli(["render", SOUND_ROLES_DIR, "--format", format, "--out", out, "--json"]);
        expect(render.code, render.out).toBe(EXIT_OK);
        const payload = JSON.parse(render.out.slice(render.out.indexOf("{"))) as {
          sound: { manifestPath: string; tail: { ok: boolean } };
        };
        expect(payload.sound.tail.ok, format).toBe(true);
        expect(payload.sound.manifestPath, format).toBe(`${out}.sound.json`);

        expect(containerOf(out), format).toBe(CONTAINER[format]);
        const probed = await probe(out);
        const v = streamOf(probed, "video")!;
        const a = streamOf(probed, "audio")!;
        expect([v.codec_name, a.codec_name], format).toEqual(want[format]);
        expect(v.color_space, format).toBe("bt709");
        expect(Math.abs(streamSec(a) - streamSec(v)), format).toBeLessThanOrEqual(audioFrameSec(a));

        const verify = await cli(["sound", SOUND_ROLES_DIR, "--verify", out, "--json"]);
        expect(verify.code, `${format}: ${verify.out}`).toBe(EXIT_OK);
        const result = JSON.parse(verify.out.slice(verify.out.indexOf("{"))) as {
          verify: { elements: Array<{ status: string }> };
        };
        expect(result.verify.elements.map((e) => e.status), format).toEqual([
          "present",
          "present",
          "present",
          "present",
          "skipped",
        ]);
      }
    },
    900_000,
  );

  test("--alpha with mp4 exits 2 before rendering anything", async () => {
    const out = join(TMP, "refused.mp4");
    const { out: text, code } = await cli([
      "render",
      ALPHA_DIR,
      "--format",
      "mp4",
      "--alpha",
      "--out",
      out,
    ]);
    expect(code).toBe(EXIT_USAGE);
    expect(text).toContain("no alpha plane");
    expect(existsSync(out)).toBe(false);
  }, 120_000);
});
