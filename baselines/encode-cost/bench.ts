#!/usr/bin/env bun
/**
 * What each encode leg costs and what it delivers, on one composition's frames.
 *
 *   bun baselines/encode-cost/bench.ts <composition-dir> --work <dir> [--runs N]
 *
 * The frames are rendered once, to `<work>/frames.rgba`, so every encoder
 * reads the same bytes and none of them pays for the renderer. Each config is
 * then the argv `ffmpegArgs` builds for it (`src/render/encode.ts`) with the
 * stdin input replaced by that file — the encode `render` runs, not a
 * hand-written one. Per config, median of `--runs` (default 3):
 *
 *   cpu      ffmpeg's user + system seconds (`resourceUsage`, from wait4)
 *   wall     seconds from spawn to exit
 *   bytes    the file
 *   psnr     average PSNR (dB) of the decode against the source frames,
 *            both in yuv420p through the same default swscale conversion
 *            the encode leg uses, so chroma subsampling is not counted
 *   ssim     SSIM (All) on the same pair
 *   vsX264   PSNR against the default encode's decode (libx264, medium,
 *            CRF 16) — how far a config's picture is from what `render`
 *            delivers today
 *
 * The VideoToolbox rows are given rates relative to the bitrate the default
 * encode came out at ("matched" is that rate), and constant-quality `-q:v`
 * values, so the two kinds of rate control can be read side by side.
 * `--q 85,90` runs only those `-q:v` values, against the default encode an
 * earlier full run left in `--work`.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveComposition } from "../../src/cli/resolve.ts";
import { encodeScaleTo } from "../../src/cli/commands/render.ts";
import { ffmpegArgs, type EncodeOptions } from "../../src/render/encode.ts";
import { WasmFrameSource } from "../../src/runtime/frame-source.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = resolve(argv[0]!);
const work = resolve(flag("work") ?? "baselines/encode-cost/raw");
const runs = Number(flag("runs") ?? 3);
// `--q 85,90`: only VideoToolbox at those -q:v values, against the default
// encode a full run already left in `--work`.
const onlyQ = flag("q")?.split(",").map(Number);
mkdirSync(work, { recursive: true });

const r = await resolveComposition({ dir, flags: { json: false }, requireBundle: true });
if (!r.ok) throw new Error(`${dir}: ${r.message ?? "does not resolve"}`);
const c = r.value;
if (c.sidecar.footage.length > 0) throw new Error("bench reads compositions without footage");
const raw = join(work, "frames.rgba");
const physicalW = c.width * c.supersample;
const physicalH = c.height * c.supersample;
const frameBytes = physicalW * physicalH * 4;

if (!existsSync(raw) || statSync(raw).size !== frameBytes * c.durationFrames) {
  const source = await WasmFrameSource.create({
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
    width: c.width,
    height: c.height,
    hz: c.fps,
    durationFrames: c.durationFrames,
    renderScale: c.supersample,
    shutter: c.shutter,
  });
  const writer = Bun.file(raw).writer();
  for (let f = 0; f < c.durationFrames; f++) {
    await source.seekFrame(f);
    writer.write(source.read());
    await writer.flush();
  }
  await writer.end();
  await source.dispose();
}

const base: EncodeOptions = {
  width: physicalW,
  height: physicalH,
  fps: c.fps,
  outputPath: "",
  scaleTo: encodeScaleTo(c),
};

/** `ffmpegArgs` with the stdin input replaced by the frames file, and a rate override. */
function argsFor(options: EncodeOptions, out: string, override?: string[]): string[] {
  const args = ffmpegArgs({ ...options, outputPath: out });
  const input = args.indexOf("-i");
  args[input + 1] = raw;
  if (override) {
    // Replace the encoder's own rate-control pair with the one asked for.
    const i = args.indexOf("-b:v");
    args.splice(i, 2, ...override);
  }
  return args;
}

async function timed(cmd: string[]): Promise<{ cpu: number; wall: number }> {
  const t0 = performance.now();
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  const wall = (performance.now() - t0) / 1e3;
  if (code !== 0) throw new Error(`${cmd.join(" ")}\n${err}`);
  const usage = proc.resourceUsage()!;
  return { cpu: Number(usage.cpuTime.total) / 1e6, wall };
}

/** PSNR average and SSIM All of `encoded` against the source frames, or against `reference`. */
async function quality(encoded: string, reference?: string): Promise<{ psnr: number; ssim: number }> {
  const ref = reference
    ? ["-i", reference]
    : ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${physicalW}x${physicalH}`, "-framerate", String(c.fps), "-i", raw];
  // The source goes through the scale the encode leg applies (the
  // supersample downscale) and the same default conversion to yuv420p.
  const scale = base.scaleTo ? `scale=${base.scaleTo[0]}:${base.scaleTo[1]}:flags=area,` : "";
  const graph =
    `[0:v]format=yuv420p,split[a][b];[1:v]${reference ? "" : scale}format=yuv420p,split[c][d];` +
    "[a][c]psnr;[b][d]ssim";
  const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-i", encoded, ...ref, "-lavfi", graph, "-f", "null", "-"], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [err] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  const psnr = /PSNR .*average:([\d.]+|inf)/.exec(err)?.[1];
  const ssim = /SSIM .*All:([\d.]+)/.exec(err)?.[1];
  if (!psnr || !ssim) throw new Error(`no PSNR/SSIM for ${encoded}\n${err.slice(-2000)}`);
  return { psnr: psnr === "inf" ? Infinity : Number(psnr), ssim: Number(ssim) };
}

interface Config {
  readonly name: string;
  readonly options: EncodeOptions;
  readonly override?: () => string[];
}

const seconds = c.durationFrames / c.fps;
let matched = 0;
const configs: Config[] = [
  { name: "libx264 medium crf16 (default)", options: base },
  { name: "libx264 faster crf16", options: { ...base, preset: "faster" } },
  { name: "libx264 veryfast crf16", options: { ...base, preset: "veryfast" } },
  { name: "videotoolbox default", options: { ...base, encoder: "h264_videotoolbox" } },
  ...[1, 1.5, 2, 3].map((x) => ({
    name: `videotoolbox b:v ${x}x matched`,
    options: { ...base, encoder: "h264_videotoolbox" },
    override: () => ["-b:v", String(Math.round(matched * x))],
  })),
  ...[60, 70, 80].map((q) => ({
    name: `videotoolbox q:v ${q}`,
    options: { ...base, encoder: "h264_videotoolbox" },
    override: () => ["-q:v", String(q)],
  })),
];

const run = onlyQ
  ? onlyQ.map((q) => ({
      name: `videotoolbox q:v ${q}`,
      options: { ...base, encoder: "h264_videotoolbox" },
      override: () => ["-q:v", String(q)],
    }))
  : configs;
const rows = [];
const reference = join(work, "libx264-medium-crf16-default.mp4");
for (const config of run) {
  const out = join(work, `${config.name.replace(/[^a-z0-9.]+/gi, "-").replace(/-+$/, "")}.mp4`.toLowerCase());
  const samples: { cpu: number; wall: number }[] = [];
  for (let i = 0; i < runs; i++) samples.push(await timed(argsFor(config.options, out, config.override?.())));
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const bytes = statSync(out).size;
  if (matched === 0) matched = Math.round((bytes * 8) / seconds);
  const q = await quality(out);
  const vs = config.name.includes("(default)") ? { psnr: Infinity } : await quality(out, reference);
  const row = {
    composition: dir.slice(dir.lastIndexOf("compositions/")),
    config: config.name,
    rateArg: config.override?.().join(" ") ?? null,
    cpu: +median(samples.map((s) => s.cpu)).toFixed(2),
    wall: +median(samples.map((s) => s.wall)).toFixed(2),
    bytes,
    mbps: +((bytes * 8) / seconds / 1e6).toFixed(2),
    psnr: +q.psnr.toFixed(2),
    ssim: +q.ssim.toFixed(5),
    vsX264: Number.isFinite(vs.psnr) ? +vs.psnr.toFixed(2) : null,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
