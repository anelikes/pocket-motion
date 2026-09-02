/**
 * A viewing copy of the composition: one MP4, same encode+mux `render` uses.
 *
 * The frame debugger seeks a live world and ships PNGs. A normal player needs
 * a timebase, fullscreen, playbackRate and volume, which a `<video>` element
 * already has — once there is a file. This job is that file. It is a viewing
 * copy (fast hash, veryfast x264), not a ledger artefact.
 */

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openFootage, scratchTree, type FootageHandle } from "../cli/footage.ts";
import { errMsg, type ResolvedComposition } from "../cli/resolve.ts";
import { render as renderComposition } from "../render/render.ts";
import { framesToMs, mixGraph, soundDeclared } from "../sound/mix.ts";
import { muxSound } from "../sound/mux.ts";
import { probeSoundDurations, resolveSound } from "../sound/resolve.ts";

export type MoviePhase = "idle" | "running" | "ready" | "error";

/** Thrown out of the render loop when close() lands mid-encode. */
export class MovieCancelled extends Error {
  constructor() {
    super("PocketJS Motion: viewing copy dropped during encode");
  }
}

export interface MovieStatus {
  readonly phase: MoviePhase;
  readonly frame: number;
  readonly total: number;
  readonly hasAudio: boolean;
  readonly error?: string;
}

export class MovieJob {
  readonly composition: ResolvedComposition;
  #phase: MoviePhase = "idle";
  #frame = 0;
  #error: string | undefined;
  #path: string | undefined;
  #dir: string | undefined;
  #run: Promise<string> | null = null;
  #closed = false;

  constructor(composition: ResolvedComposition) {
    this.composition = composition;
  }

  get hasAudio(): boolean {
    return soundDeclared(this.composition.sidecar.sound);
  }

  status(): MovieStatus {
    return {
      phase: this.#phase,
      frame: this.#frame,
      total: this.composition.durationFrames,
      hasAudio: this.hasAudio,
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  /**
   * Start (or join) the encode. Resolves with the file path.
   *
   * A run that FAILED is not started again. `#encode` clears `#run` on its
   * way out, so this used to begin a fresh render every time it was asked —
   * and `/movie/status` called it before reading `status()`, so `/watch`
   * polling every 400 ms re-rendered the whole film every 400 ms and the
   * phase the page read back was always `running`. The error was unreachable
   * by construction: the one thing the route existed to report was the one
   * thing it could never say. `retry()` is how it starts again, and it has to
   * be asked for.
   */
  ensure(): Promise<string> {
    if (this.#path && this.#phase === "ready") return Promise.resolve(this.#path);
    if (this.#run) return this.#run;
    if (this.#phase === "error") {
      return Promise.reject(new Error(this.#error ?? "the viewing copy failed to encode"));
    }
    this.#run = this.#encode();
    // A cancelled run rejects with nobody waiting on it — preview drops a
    // viewing copy without asking anyone. Handle it here so that is not an
    // unhandled rejection; callers still get the original promise.
    this.#run.catch(() => {});
    return this.#run;
  }

  /** Encode again after a failure. Nothing else clears the error. */
  retry(): Promise<string> {
    if (this.#phase === "error") {
      this.#phase = "idle";
      this.#error = undefined;
    }
    return this.ensure();
  }

  /**
   * Stop and delete this viewing copy.
   *
   * The render loop checks for this every frame and throws, because closing
   * used to leave it running: measured on a composition of 1350 frames, a
   * close at frame 69 returned at once and the render carried on to 1350 —
   * into a directory that had just been deleted, so ffmpeg failed at the end
   * on a file that was no longer there. Preview drops viewing copies for
   * ordinary reasons (a second edit during an encode, a fifth composition
   * pushing the first out of the cache), so that was a whole film's worth of
   * work per drop, spent on a file nothing would read.
   *
   * The wait is bounded by one frame, except during a footage ingest, which
   * has no per-frame hook to check: closing then waits for the ingest.
   */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#run) await this.#run.catch(() => {});
    const dir = this.#dir;
    this.#dir = undefined;
    this.#path = undefined;
    this.#run = null;
    if (dir) await rm(dir, { recursive: true, force: true });
  }

  async #encode(): Promise<string> {
    this.#phase = "running";
    this.#frame = 0;
    this.#error = undefined;
    const c = this.composition;
    const dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-watch-"));
    this.#dir = dir;
    const videoPath = join(dir, "picture.mp4");
    const outPath = join(dir, "watch.mp4");
    const bound: { footage: FootageHandle | null } = { footage: null };

    try {
      const declared = c.sidecar.footage.length > 0;
      const tree = declared ? await scratchTree(c) : null;
      await renderComposition({
        compositionId: c.compositionId,
        bundlePath: c.bundlePath,
        pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
        width: c.width,
        height: c.height,
        hz: c.fps,
        durationFrames: c.durationFrames,
        renderScale: c.supersample,
        scaleTo: c.supersample > 1 ? [c.width, c.height] : undefined,
        hashAlgorithm: "fast",
        preset: "veryfast",
        crf: 23,
        outputPath: videoPath,
        setup: declared
          ? async (source) => {
              await source.seekFrame(0);
              bound.footage = await openFootage(c, source.world, tree);
            }
          : undefined,
        onFrameBoundary: (frame) => bound.footage?.present(frame),
        onProgress: (frame) => {
          this.#frame = frame + 1;
          if (this.#closed) throw new MovieCancelled();
        },
      });

      let path = videoPath;
      if (this.hasAudio) {
        const resolved = resolveSound(c.sidecar, c.dir);
        if (!resolved.ok) {
          throw new Error(
            resolved.diagnostics.map((d) => d.message).join("\n") ||
              "declared sound file missing",
          );
        }
        const probed = await probeSoundDurations(resolved.elements);
        const graph = mixGraph(c.sidecar.sound, probed, c.fps, c.durationFrames);
        const mixed = await muxSound({
          videoPath,
          outputPath: outPath,
          graph,
          durationSec: framesToMs(c.durationFrames, c.fps) / 1000,
        });
        path = mixed.outputPath;
      } else {
        await faststart(videoPath, outPath);
        path = outPath;
      }

      if (this.#closed) {
        throw new MovieCancelled();
      }
      this.#path = path;
      this.#phase = "ready";
      this.#frame = c.durationFrames;
      return path;
    } catch (e) {
      this.#run = null;
      if (this.#closed) {
        // Dropped on purpose. There is no one to report to and nothing to
        // report: this copy is going away.
        this.#phase = "idle";
        this.#error = undefined;
        throw e;
      }
      this.#phase = "error";
      this.#error = errMsg(e);
      throw e;
    } finally {
      await bound.footage?.close();
    }
  }
}

/** Move the moov atom to the front so HTTP playback can start without a full download. */
async function faststart(src: string, dest: string): Promise<void> {
  const p = Bun.spawn(
    ["ffmpeg", "-y", "-v", "error", "-i", src, "-c", "copy", "-movflags", "+faststart", dest],
    { stdout: "pipe", stderr: "pipe" },
  );
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  if (code !== 0) {
    throw new Error(
      `PocketJS Motion: ffmpeg faststart exited ${code}${err.trim() ? `\n${err.trim()}` : ""}`,
    );
  }
}
