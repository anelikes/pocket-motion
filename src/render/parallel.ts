/**
 * Frame-parallel rendering across processes: `render --workers N`.
 *
 * The plan proposed band-parallel rasterisation inside a frame, which would
 * need an RGBA window target in the Rust core and threads sharing one `Ui`.
 * Measuring first made that unnecessary: `tick` + `draw` costs ~0.03 ms/frame
 * against ~5 ms of rasterisation, so a worker can fold from frame 0 to the
 * start of its own range for almost nothing and only rasterise its share.
 *
 * EACH WORKER IS `render --range`, the command a distributed render runs on
 * another machine, spawned here as a child of this Bun. So `--workers` is
 * not a second way to split a film: it is N segment renders and the join
 * `concat` runs (`src/render/segment.ts`), on one machine, and every claim the
 * join makes about segments from elsewhere it makes about these. Each child
 * is a fresh process with its own wasm instance, so nothing is shared and
 * nothing needs locking; the one thing two children could race on — a
 * footage ingest writing its cache — the caller warms before spawning.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { MIN_SEGMENT_FRAMES, segmentManifestPath, splitRange } from "./segment.ts";

const CLI = fileURLToPath(new URL("../cli/main.ts", import.meta.url));

export interface SegmentWorkersOptions {
  /** The composition directory each worker renders. */
  readonly dir: string;
  /** The film's frame count — the range being split. */
  readonly filmFrames: number;
  readonly workers: number;
  /** Where the segments go; the caller owns and removes it. */
  readonly scratchDir: string;
  /** Appended to each segment's name: `.mp4`, or `""` for a png-seq directory. */
  readonly extension: string;
  /**
   * Flags every worker is given as well as `--range` and `--out`: the
   * format, `--alpha`, and the shared flags that decide the picture. A
   * worker resolves the composition itself, so a flag left out here is a
   * worker rendering another film — which the join's identity check refuses.
   */
  readonly forward: readonly string[];
}

export interface WorkerReport {
  readonly first: number;
  readonly last: number;
  /** The segment's manifest — what the join reads. */
  readonly manifestPath: string;
  /** This worker's wall time, for spotting a straggler. */
  readonly elapsedMs: number;
}

/** The argv of one worker: a `render --range` command line. */
export function workerArgv(o: SegmentWorkersOptions, first: number, last: number, out: string): string[] {
  return [
    process.execPath, CLI, "render", o.dir,
    "--range", `${first}..${last}`,
    "--out", out,
    "--json",
    ...o.forward,
  ];
}

/**
 * Render the film as `workers` segments at once. Resolves with one report per
 * segment in film order, or rejects with the first worker's failure after
 * stopping the rest.
 */
export async function renderSegments(o: SegmentWorkersOptions): Promise<WorkerReport[]> {
  const ranges = splitRange(o.filmFrames, o.workers, MIN_SEGMENT_FRAMES);
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  const jobs = ranges.map(async ([start, end], i): Promise<WorkerReport> => {
    const out = join(o.scratchDir, `segment-${String(i).padStart(4, "0")}${o.extension}`);
    const t0 = performance.now();
    const proc = Bun.spawn(workerArgv(o, start, end - 1, out), {
      stdout: "pipe",
      stderr: "pipe",
      // Explicit: a child spawned without `env` gets the environment this
      // process STARTED with, not what it holds now (Bun 1.3.11).
      env: { ...process.env },
    });
    procs.push(proc);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      let error = stderr.trim();
      try {
        error = (JSON.parse(stdout) as { error?: string }).error ?? error;
      } catch {
        /* not JSON: stderr is the account */
      }
      throw new Error(`worker ${i} (render --range ${start}..${end - 1}) exited ${code}: ${error}`);
    }
    return { first: start, last: end - 1, manifestPath: segmentManifestPath(out), elapsedMs: performance.now() - t0 };
  });
  try {
    return await Promise.all(jobs);
  } catch (e) {
    for (const p of procs) {
      try {
        p.kill(9);
      } catch {
        /* already gone */
      }
    }
    await Promise.allSettled(procs.map((p) => p.exited));
    throw e;
  }
}
