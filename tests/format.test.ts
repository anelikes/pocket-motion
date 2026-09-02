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
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  OUTPUT_FORMATS,
  ffmpegArgs,
  formatCarriesAlpha,
  formatExtension,
  pngSequenceSink,
} from "../src/render/encode.ts";
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
      ).toContain("scale=160:90:flags=area");
    }
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
    "the alpha floor is measured, and it is 255 — the channel carries nothing yet",
    async () => {
      // `compositions/alpha` declares no ground, and its frames are still
      // fully opaque, because `clear_black` fills opaque. This is the fixture
      // for that, and the day the core's clear changes this number drops and
      // this test says so rather than a paragraph going quietly stale.
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
      expect(payload.alphaFloor).toBe(255);
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
