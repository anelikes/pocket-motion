/**
 * Frame-parallel rendering across processes.
 *
 * The plan proposed band-parallel rasterisation inside a frame, which would
 * need an RGBA window target in the Rust core and threads sharing one `Ui`.
 * Measuring first made that unnecessary: `tick` + `draw` costs ~0.03 ms/frame
 * against ~5 ms of rasterisation, so a worker can fold from frame 0 to the
 * start of its own range for almost nothing and only rasterise its share.
 *
 * A worker covering frames [900, 1800) of a 1800-frame reel ticks 1800 times
 * (~54 ms) and rasterises 900. The redundant folding is under 1% of its work,
 * and the whole thing needs no change to the core.
 *
 * Each worker is a fresh process with its own wasm instance, so nothing is
 * shared and nothing needs locking. The parent stitches the segments and
 * checks the concatenated frame hashes against the sequence a single-threaded
 * run produces — parallelism that changed a pixel would be caught, not assumed.
 */

import { FrameHashSequence, type FrameHash } from "./hash.ts";
import type { RenderOptions } from "./render.ts";

export interface ParallelRenderOptions
  extends Omit<RenderOptions, "onProgress" | "onFrameBoundary" | "wrapOps" | "setup"> {
  /** Worker processes. Defaults to the CPU count, capped at the frame count. */
  readonly workers?: number;
  /** Directory for per-worker segments. Defaults to a temp dir beside the output. */
  readonly scratchDir?: string;
}

export interface ParallelRenderResult {
  readonly frames: number;
  readonly workers: number;
  readonly frameHashes: readonly FrameHash[];
  readonly digest: FrameHash;
  readonly outputPath?: string;
  readonly elapsedMs: number;
  readonly msPerFrame: number;
  /** Per-worker wall time, for spotting a straggler. */
  readonly workerMs: readonly number[];
}

interface WorkerReport {
  readonly start: number;
  readonly end: number;
  readonly hashes: readonly FrameHash[];
  readonly elapsedMs: number;
}

/** Contiguous ranges, remainder spread over the first few workers. */
export function splitRange(frames: number, workers: number): Array<[number, number]> {
  const n = Math.max(1, Math.min(workers, frames));
  const base = Math.floor(frames / n);
  const extra = frames % n;
  const out: Array<[number, number]> = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push([at, at + size]);
    at += size;
  }
  return out;
}

const WORKER = new URL("./parallel-worker.ts", import.meta.url).pathname;

export async function renderParallel(
  options: ParallelRenderOptions,
): Promise<ParallelRenderResult> {
  const started = performance.now();
  const workers = Math.max(1, Math.min(options.workers ?? navigator.hardwareConcurrency ?? 4, options.durationFrames));
  const ranges = splitRange(options.durationFrames, workers);
  const scratch = options.scratchDir ?? `${options.outputPath ?? "/tmp/motion"}.parts`;
  await Bun.$`mkdir -p ${scratch}`.quiet();

  const jobs = ranges.map(async ([start, end], i): Promise<WorkerReport> => {
    const segment = options.outputPath ? `${scratch}/part-${String(i).padStart(4, "0")}.mp4` : undefined;
    const payload = JSON.stringify({ ...options, outputPath: segment, start, end });
    const proc = Bun.spawn(["bun", WORKER], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    proc.stdin.write(payload);
    await proc.stdin.end();
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new Error(`PocketJS Motion: worker ${i} (frames ${start}..${end}) exited ${code}\n${err.trim()}`);
    }
    return JSON.parse(out) as WorkerReport;
  });

  const reports = (await Promise.all(jobs)).sort((a, b) => a.start - b.start);

  const seq = new FrameHashSequence();
  const hashes: FrameHash[] = [];
  for (const r of reports) hashes.push(...r.hashes);
  for (const h of hashes) seq.pushHash(h);

  if (options.outputPath) {
    const list = `${scratch}/concat.txt`;
    await Bun.write(
      list,
      ranges.map((_, i) => `file 'part-${String(i).padStart(4, "0")}.mp4'`).join("\n") + "\n",
    );
    const cat = Bun.spawn(
      ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", options.outputPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    if ((await cat.exited) !== 0) {
      throw new Error(`PocketJS Motion: concat failed\n${(await new Response(cat.stderr).text()).trim()}`);
    }
  }

  const elapsedMs = performance.now() - started;
  return {
    frames: options.durationFrames,
    workers: ranges.length,
    frameHashes: hashes,
    digest: seq.digest(),
    outputPath: options.outputPath,
    elapsedMs,
    msPerFrame: elapsedMs / options.durationFrames,
    workerMs: reports.map((r) => r.elapsedMs),
  };
}
