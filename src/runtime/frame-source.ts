/**
 * The frame contract — borrowed in shape from HyperFrames' `FrameAdapter`,
 * which is the cleanest statement of "the animation runtime is driven by seek,
 * not by a clock" we found in the field.
 *
 * The difference is that we declare how far an implementation can seek instead
 * of promising arbitrary order. Upstream's core advances with a monotonic
 * `self.frame.wrapping_add(1)` and has no seek at all, and frame state that
 * lives in the JS heap (Solid's graph, the mirror tree, timer and effect
 * queues) is invisible to a core snapshot. v1 therefore folds forward and says
 * so, rather than shipping an API that promises what it cannot honour.
 */

import { hardenedBootWorld, type BootOptions, type BootedWorld } from "./boot.ts";
import { CheckpointLadder, captureSnapshot, restoreSnapshot } from "./checkpoint.ts";

export type SeekCapability =
  /** Monotonic only. Rewinding throws. */
  | "forward-only"
  /** May restore the nearest checkpoint at or before `n`, then fold forward. */
  | "checkpoint-forward"
  /** Any order. Requires checkpointing that also covers host-side footage state. */
  | "random";

export interface FrameSourceContext {
  readonly compositionId: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

export interface FrameSource {
  readonly context: FrameSourceContext;
  /** How far this implementation can seek. Callers must respect it. */
  readonly seek: SeekCapability;
  readonly durationFrames: number;
  /** The frame currently loaded, or -1 before the first seek. */
  readonly position: number;
  /**
   * Advance (or, where the capability allows, move) to `frame`.
   * Same frame index always yields the same pixels. Nothing may resolve
   * asynchronously after the frame is committed.
   */
  seekFrame(frame: number): Promise<void>;
  /** RGBA of the current frame, at physical size. */
  read(): Uint8Array;
  dispose(): Promise<void>;
}

export class SeekCapabilityError extends Error {
  override readonly name = "SeekCapabilityError";
}

export interface WasmFrameSourceOptions extends BootOptions {
  readonly durationFrames: number;
  readonly compositionId: string;
  /**
   * Snapshot linear memory every N frames, upgrading `seek` from
   * `forward-only` to `checkpoint-forward`. Omit to stay forward-only and pay
   * no memory. Each snapshot costs the core's whole linear memory (~10 MB at
   * 1080p), so space them out.
   */
  readonly checkpointInterval?: number;
  /** Passed to CheckpointLadder. Preview tests use 1 to force a missing origin. */
  readonly checkpointMax?: number;
  /**
   * Re-present host-owned state (footage) after a restore. Called with the
   * frame being restored TO. Footage is a pure function of the frame index, so
   * rebuilding it beats checkpointing texture handles whose generations a
   * restore would invalidate (see checkpoint.ts).
   */
  readonly onRestore?: (frame: number) => void;
}

/**
 * Forward-only source over the wasm core.
 *
 * `seekFrame(n)` runs `n - position` guest turns, each followed by
 * `60/hz` core ticks — the same transaction upstream's hosts drive, so the
 * trajectory matches a real run rather than approximating it.
 */
export class WasmFrameSource implements FrameSource {
  readonly seek: SeekCapability;
  readonly context: FrameSourceContext;
  readonly durationFrames: number;

  #world: BootedWorld;
  #position = -1;
  #disposed = false;
  #ladder: CheckpointLadder | null;
  #onRestore: ((frame: number) => void) | undefined;

  private constructor(
    world: BootedWorld,
    context: FrameSourceContext,
    durationFrames: number,
    ladder: CheckpointLadder | null,
    onRestore?: (frame: number) => void,
  ) {
    this.#world = world;
    this.context = context;
    this.durationFrames = durationFrames;
    this.#ladder = ladder;
    this.#onRestore = onRestore;
    this.seek = ladder ? "checkpoint-forward" : "forward-only";
  }

  /** Snapshots held and their total size — the memory this costs. */
  get checkpoints(): { count: number; bytes: number } {
    return { count: this.#ladder?.size ?? 0, bytes: this.#ladder?.bytes ?? 0 };
  }

  static async create(options: WasmFrameSourceOptions): Promise<WasmFrameSource> {
    const world = await hardenedBootWorld(options);
    const ladder =
      options.checkpointInterval !== undefined
        ? new CheckpointLadder(options.checkpointInterval, options.checkpointMax)
        : null;
    return new WasmFrameSource(
      world,
      {
        compositionId: options.compositionId,
        fps: options.hz,
        width: options.width,
        height: options.height,
      },
      options.durationFrames,
      ladder,
      options.onRestore,
    );
  }

  /** The booted world. Footage binds against `world.ops` after mount. */
  get world(): BootedWorld {
    return this.#world;
  }

  /** Current wasm linear-memory size. Restore+fold grows this; preview rebuilds when it runs away. */
  get memoryBytes(): number {
    return this.#world.exports.memory.buffer.byteLength;
  }

  get position(): number {
    return this.#position;
  }

  /** Structural self-check of the guest realm; throws if a global is unguarded. */
  audit(): ReturnType<BootedWorld["audit"]> {
    return this.#world.audit();
  }

  async seekFrame(frame: number): Promise<void> {
    if (this.#disposed) throw new Error("PocketJS Motion: FrameSource is disposed");
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.durationFrames) {
      throw new RangeError(
        `PocketJS Motion: frame must be an integer in [0, ${this.durationFrames}); got ${frame}`,
      );
    }
    if (frame < this.#position) {
      const snap = this.#ladder?.nearest(frame);
      if (!snap) {
        throw new SeekCapabilityError(
          `PocketJS Motion: cannot rewind from ${this.#position} to ${frame} — ` +
            (this.#ladder
              ? `no checkpoint at or before ${frame}`
              : "this FrameSource is `forward-only`; pass `checkpointInterval` to enable rewinding"),
        );
      }
      restoreSnapshot(this.#world.exports, snap);
      this.#position = snap.frame;
      // Host-owned state is rebuilt rather than restored — see checkpoint.ts.
      this.#onRestore?.(snap.frame);
    }
    while (this.#position < frame) {
      this.#world.frame(0);
      for (let t = 0; t < this.#world.ticksPerFrame; t++) this.#world.tick();
      this.#position++;
      if (this.#ladder?.isBoundary(this.#position)) {
        this.#ladder.put(captureSnapshot(this.#world.exports, this.#position, this.#world.exposureScratch()));
      }
    }
  }

  /**
   * The frame's pixels — under a declared shutter, its exposure. Every
   * command that delivers or hashes a frame reads it here, so `frame --at N`,
   * `/frame`, `trace` and `render` cannot disagree about which picture a
   * frame is.
   */
  read(): Uint8Array {
    if (this.#position < 0) {
      throw new Error("PocketJS Motion: read() before the first seekFrame()");
    }
    return this.#world.render();
  }

  /**
   * Replace the snapshot at the current frame, if this is a checkpoint
   * boundary. `seekFrame(0)` captures before the host binds footage; call
   * this after `openFootage` so a restore to 0 still has UV and textures.
   */
  recapture(): void {
    if (this.#disposed) throw new Error("PocketJS Motion: FrameSource is disposed");
    if (!this.#ladder || this.#position < 0) return;
    if (!this.#ladder.isBoundary(this.#position)) return;
    this.#ladder.put(captureSnapshot(this.#world.exports, this.#position, this.#world.exposureScratch()));
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
  }
}
