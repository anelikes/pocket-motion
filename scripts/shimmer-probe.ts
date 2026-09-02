#!/usr/bin/env bun
/**
 * Phase 4 step 1 — does minified footage actually shimmer, and how much scaling
 * can the pipeline absorb before it does?
 *
 * Two hard defects in `raster.rs` were asserted from a survey, the first being
 * "no mipmap — scaled footage shimmers, the most glaring artefact in video".
 * Nobody had measured it. `baselines/phase5-throughput.md` is the standing
 * warning about assertions of that kind: its premise ("93% of the time is
 * rasterisation") came from a synthetic scene of 400 translucent boxes and did
 * not survive contact with real content.
 *
 * ## Method
 *
 *   1. A zone plate — the canonical aliasing pattern, radial frequency rising
 *      through Nyquist and past it. A resampler that aliases at all aliases
 *      here; real footage is a strictly easier case.
 *   2. The pattern TRANSLATES one source pixel per frame. Translating the crop
 *      window rather than animating the pattern keeps the content identical, so
 *      every difference between consecutive frames is the shift or the
 *      resampler's error, and nothing else.
 *   3. The CONTROL ingests at the drawn size, so swscale does the downscale and
 *      the rasteriser draws tiles at native size. That is what the pipeline does
 *      today: `src/footage/ingest.ts` scales to the final size with lanczos.
 *   4. The SWEEP ingests at 2048x1024 and draws smaller and smaller, so the
 *      RASTERISER does the downscale — the Ken Burns case, where no single
 *      ingest resolution is right because the on-screen scale moves.
 *   5. Everything is compared against ffmpeg's lanczos downscale to the same
 *      drawn size, through the same range conversion the ingest applies, so the
 *      only variable left is who resampled.
 *
 * ## Metrics
 *
 *   mean |Δ|  how far the frame is from a correct downscale (spatial error)
 *   PSNR      the same thing in dB
 *   crawl     how much the ERROR FIELD moves frame to frame. A stable
 *             resampling bias scores near zero however large it is; aliasing
 *             that reorganises as the content slides scores high. This is the
 *             number that means "shimmer" — the artefact is temporal.
 *
 * The control must come back at 0.00 / infinite dB. If it does not, the harness
 * is wrong and no other row means anything.
 *
 * ## Sampling modes
 *
 * Every row is measured twice, nearest and bilinear, against the same
 * reference. Bilinear needs `patches/0004` — before it, `spec::img::FLAG_LINEAR`
 * existed in the core with no route to it from a host uploading its own pixels.
 * Requesting linear on a rasteriser that lacks the op throws rather than
 * quietly sampling nearest, so a stale wasm cannot produce a plausible table.
 *
 *   bun scripts/shimmer-probe.ts
 *   bun scripts/shimmer-probe.ts --frames 24
 */

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { rect, ratio, VIEW, type Layout } from "../compositions/shimmer/gen.ts";
import { ingestFootage, type IngestManifest } from "../src/footage/ingest.ts";
import { FootageLayer } from "../src/footage/layer.ts";
import { hardenedBootWorld } from "../src/runtime/boot.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VENDOR = join(ROOT, "vendor/pocketjs");
const WORK = "/tmp/pocketjs-motion-shimmer";
const FPS = 30;

/** The range conversion `src/footage/ingest.ts` applies. The reference must
 *  match it, or a level shift is scored as resampling error. */
const RANGE = "in_range=tv:out_range=pc";

/** Source resolution for the sweep: 4x2 tiles, sized to the DRAWN interior
 *  (510) rather than the 512 texture, so every tile is full and square. */
const SRC = { w: 2040, h: 1020 } as const;

const argv = process.argv.slice(2);
const flagOf = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const FRAMES = Number(flagOf("frames") ?? 48);

/**
 * The control draws 2x1 tiles at native size from a 1024x512 ingest. The
 * minification sweep draws the full 4x2 grid smaller and smaller: 480 is the
 * largest cell that still fits 4 across a 1920 viewport, 64 the smallest worth
 * asking about (8x).
 *
 * The magnification arm reuses the control's 1024x512 ingest and draws it
 * BIGGER — 2 cols, so 960 is the largest cell that fits. Zoom-in is half of what
 * a push does and it fails differently: nothing aliases, the picture goes blocky.
 */
const CONTROL: Layout = { cols: 2, rows: 1, cell: 510 };
const SWEEP: readonly Layout[] = [480, 448, 384, 320, 255, 128, 64].map((cell) => ({ cols: 4, rows: 2, cell }));
const MAGNIFY: readonly Layout[] = [640, 768, 960].map((cell) => ({ cols: 2, rows: 1, cell }));

async function run(cmd: string[], quiet = false): Promise<void> {
  const p = Bun.spawn(cmd, {
    stdout: quiet ? "ignore" : "inherit",
    stderr: quiet ? "ignore" : "inherit",
    cwd: ROOT,
  });
  if ((await p.exited) !== 0) throw new Error(`${cmd[0]} failed: ${cmd.slice(0, 6).join(" ")}…`);
}

async function makeSource(path: string): Promise<void> {
  await run([
    "ffmpeg", "-y", "-v", "error",
    "-f", "lavfi",
    // kx2/ky2 are the 2-order phases — the radial frequency sweep that makes
    // this a zone plate. ku/kv are colour phases and leave luma flat.
    "-i", `zoneplate=size=${SRC.w + FRAMES}x${SRC.h}:rate=${FPS}:d=${(FRAMES / FPS + 1).toFixed(3)}:precision=10:kx2=196:ky2=196`,
    "-vf", `crop=${SRC.w}:${SRC.h}:'min(n\\,${FRAMES - 1})':0,format=rgb24`,
    "-frames:v", String(FRAMES),
    "-c:v", "ffv1", // lossless: no codec error may enter the comparison
    path,
  ]);
}

/** What a correct resampler produces at `w`x`h` from the ORIGINAL source. */
async function makeReference(src: string, w: number, h: number, out: string): Promise<Uint8Array> {
  await run([
    "ffmpeg", "-y", "-v", "error",
    "-i", src,
    "-vf", `scale=${w}:${h}:flags=lanczos:${RANGE}`,
    "-f", "rawvideo", "-pix_fmt", "rgba",
    out,
  ]);
  return new Uint8Array(await Bun.file(out).arrayBuffer());
}

/**
 * What a correct resampler produces at `w`x`h` from the INGESTED pixels.
 *
 * Magnification needs this and minification must not use it. Upscaling cannot
 * recover what the ingest already discarded, so scoring a magnified draw against
 * the original 2048x1024 zone plate would charge the rasteriser for the ingest's
 * downscale. The fair question is "given these pixels, is this the best
 * enlargement of them" — so the reference starts from the same bytes the
 * rasteriser was handed. No range conversion here: the ingest already applied it.
 */
async function makeReferenceFromIngest(
  raw: string, srcW: number, srcH: number, w: number, h: number, out: string,
): Promise<Uint8Array> {
  await run([
    "ffmpeg", "-y", "-v", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${srcW}x${srcH}`, "-r", String(FPS), "-i", raw,
    "-vf", `scale=${w}:${h}:flags=lanczos`,
    "-f", "rawvideo", "-pix_fmt", "rgba",
    out,
  ]);
  return new Uint8Array(await Bun.file(out).arrayBuffer());
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array, px: number, offA: number, offB: number): number {
  let sum = 0;
  for (let i = 0; i < px; i++) {
    const ia = offA + i * 4;
    const ib = offB + i * 4;
    sum += Math.abs(a[ia]! - b[ib]!) + Math.abs(a[ia + 1]! - b[ib + 1]!) + Math.abs(a[ia + 2]! - b[ib + 2]!);
  }
  return sum / (px * 3);
}

function psnr(a: Uint8Array, b: Uint8Array, px: number, offA: number, offB: number): number {
  let sq = 0;
  for (let i = 0; i < px; i++) {
    const ia = offA + i * 4;
    const ib = offB + i * 4;
    for (let c = 0; c < 3; c++) {
      const d = a[ia + c]! - b[ib + c]!;
      sq += d * d;
    }
  }
  const mse = sq / (px * 3);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** Signed per-channel error against the reference — the crawl metric's input. */
function errorField(probe: Uint8Array, ref: Uint8Array, refOff: number, px: number): Int16Array {
  const e = new Int16Array(px * 3);
  for (let i = 0; i < px; i++) {
    for (let c = 0; c < 3; c++) e[i * 3 + c] = probe[i * 4 + c]! - ref[refOff + i * 4 + c]!;
  }
  return e;
}

function meanAbsDelta(a: Int16Array, b: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

function cropRect(frame: Uint8Array, r: { x: number; y: number; w: number; h: number }): Uint8Array {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * VIEW.w + r.x) * 4;
    out.set(frame.subarray(src, src + r.w * 4), y * r.w * 4);
  }
  return out;
}

async function writePng(rgba: Uint8Array, w: number, h: number, path: string): Promise<void> {
  const p = Bun.spawn(
    ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
      "-s", `${w}x${h}`, "-i", "pipe:0", "-frames:v", "1", path],
    { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
  );
  p.stdin.write(rgba);
  await p.stdin.end();
  if ((await p.exited) !== 0) throw new Error(`png write failed: ${path}`);
}

/** The two sampling modes, measured against the same reference. */
const MODES = [
  { key: "nearest", linear: false },
  { key: "linear", linear: true },
] as const;
type ModeKey = (typeof MODES)[number]["key"];

interface Row {
  readonly label: string;
  readonly ratio: number;
  readonly by: Record<ModeKey, { spatial: number; psnr: number; crawl: number }>;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

async function probe(
  l: Layout,
  label: string,
  makeRef: (w: number, h: number, out: string) => Promise<Uint8Array>,
  manifest: IngestManifest,
  rawPath: string,
  still?: string,
): Promise<Row> {
  const r = rect(l);
  const px = r.w * r.h;
  const stride = px * 4;

  await run(["bun", join(ROOT, "compositions/shimmer/gen.ts"), String(l.cols), String(l.rows), String(l.cell)], true);

  const reference = await makeRef(r.w, r.h, join(WORK, `ref-${label}.rgba`));

  const dist = join(ROOT, `dist/shimmer-${label}`);
  await run(["bun", join(VENDOR, "tools/build.ts"),
    join(ROOT, "compositions/shimmer/main.tsx"), `--outdir=${dist}`, "--framework=solid"], true);

  const by = {} as Row["by"];

  // A fresh world per mode. The composition is static, so one world would very
  // likely do — but "very likely" is not the standard the rest of this harness
  // holds itself to, and booting again costs milliseconds.
  for (const mode of MODES) {
    const world = await hardenedBootWorld({
      bundlePath: join(dist, "main.js"),
      pakPath: existsSync(join(dist, "main.pak")) ? join(dist, "main.pak") : undefined,
      width: VIEW.w,
      height: VIEW.h,
      hz: FPS,
    });

    world.frame(0);
    for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
    const layer = await FootageLayer.create({
      manifest,
      rawPath,
      nodePrefix: "footage:probe",
      tree: world.getTree(),
      ops: world.ops as never,
      linear: mode.linear,
    });

    const spatial: number[] = [];
    const psnrs: number[] = [];
    const crawl: number[] = [];
    let prevError: Int16Array | undefined;

    try {
      for (let n = 0; n < FRAMES; n++) {
        layer.present(n);
        world.frame(0);
        for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
        const p = cropRect(world.render(), r);

        spatial.push(meanAbsDiff(p, reference, px, 0, n * stride));
        psnrs.push(psnr(p, reference, px, 0, n * stride));

        const e = errorField(p, reference, n * stride, px);
        if (prevError) crawl.push(meanAbsDelta(e, prevError));
        prevError = e;

        if (still && n === FRAMES >> 1) {
          await writePng(p, r.w, r.h, join(WORK, `${still}-${mode.key}.png`));
          if (mode.linear) {
            await writePng(reference.subarray(n * stride, (n + 1) * stride), r.w, r.h, join(WORK, `${still}-reference.png`));
          }
        }
      }
    } finally {
      layer.close();
    }

    by[mode.key] = { spatial: mean(spatial), psnr: mean(psnrs), crawl: mean(crawl) };
  }

  return { label, ratio: ratio(l), by };
}

// ---------------------------------------------------------------------------

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });

console.log(`shimmer probe — zone plate, ${FRAMES} frames`);
const srcPath = join(WORK, "source.mkv");
console.log("  generating the zone plate");
await makeSource(srcPath);

const minify: Row[] = [];
const magnify: Row[] = [];

// Control: ingest at the drawn size, so the rasteriser never resamples. Its
// 1024x512 output is also what the magnification arm enlarges.
const controlRect = rect(CONTROL);
const controlDir = join(WORK, "ingest-control");
{
  console.log(`  control — ingest ${controlRect.w}x${controlRect.h}, draw 1:1`);
  const m = await ingestFootage({
    src: srcPath, outDir: controlDir, width: controlRect.w, height: controlRect.h, fps: FPS, frames: FRAMES,
  });
  minify.push(await probe(
    CONTROL, "control",
    (w, h, out) => makeReference(srcPath, w, h, out),
    m, join(controlDir, "frames.rgba"),
  ));
}

// Minification: one ingest at source resolution, drawn at falling sizes.
{
  console.log(`  minify — ingest ${SRC.w}x${SRC.h} once, draw smaller`);
  const dir = join(WORK, "ingest-sweep");
  const m = await ingestFootage({ src: srcPath, outDir: dir, width: SRC.w, height: SRC.h, fps: FPS, frames: FRAMES });
  for (const l of SWEEP) {
    const label = `x${ratio(l).toFixed(2)}`;
    console.log(`    ${label}`);
    minify.push(await probe(
      l, label,
      (w, h, out) => makeReference(srcPath, w, h, out),
      m, join(dir, "frames.rgba"), Math.abs(ratio(l) - 2) < 1e-6 ? "2x" : undefined,
    ));
  }
}

// Magnification: the control's ingest, drawn bigger, scored against a lanczos
// enlargement of those same ingested pixels.
{
  console.log(`  magnify — ingest ${controlRect.w}x${controlRect.h}, draw bigger`);
  const raw = join(controlDir, "frames.rgba");
  const m = await ingestFootage({
    src: srcPath, outDir: controlDir, width: controlRect.w, height: controlRect.h, fps: FPS, frames: FRAMES,
  });
  for (const l of MAGNIFY) {
    const label = `m${(1 / ratio(l)).toFixed(2)}`;
    console.log(`    ${label}`);
    magnify.push(await probe(
      l, label,
      (w, h, out) => makeReferenceFromIngest(raw, controlRect.w, controlRect.h, w, h, out),
      m, raw, Math.abs(1 / ratio(l) - 1.88) < 0.02 ? "mag" : undefined,
    ));
  }
}

const dB = (x: number): string => (x === Infinity ? "∞" : x.toFixed(2));

function table(title: string, note: string, scale: (r: Row) => string, rows: Row[]): void {
  console.log("");
  console.log(`  ${title}`);
  console.log("            mean |Δ| vs lanczos      PSNR                 error crawl/frame");
  console.log("  scale     nearest    linear        nearest    linear    nearest   linear");
  console.log("  ------    -------    ------        -------    ------    -------   ------");
  for (const r of rows) {
    const [n, l] = [r.by.nearest, r.by.linear];
    console.log(
      `  ${scale(r).padEnd(8)}  ` +
        `${n.spatial.toFixed(2).padStart(6)}    ${l.spatial.toFixed(2).padStart(6)}        ` +
        `${dB(n.psnr).padStart(6)}    ${dB(l.psnr).padStart(6)}    ` +
        `${n.crawl.toFixed(2).padStart(7)}   ${l.crawl.toFixed(2).padStart(6)}`,
    );
  }
  console.log(`  ${note}`);
}

table(
  "MINIFY — reference is a lanczos downscale of the original zone plate",
  "* control — swscale did the downscale, the rasteriser drew 1:1",
  (r) => (r.ratio === 1 ? "1.00 *" : r.ratio.toFixed(2)),
  minify,
);
table(
  "MAGNIFY — reference is a lanczos enlargement of the SAME ingested pixels",
  "(upscaling cannot recover what the ingest discarded; this asks only whether",
  (r) => `${(1 / r.ratio).toFixed(2)}`,
  magnify,
);
console.log("   the enlargement itself is right)");
console.log(`\nstills in ${WORK}`);
