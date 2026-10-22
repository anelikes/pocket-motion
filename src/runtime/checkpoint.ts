/**
 * Core checkpointing — the `checkpoint-forward` seek `seekFrame` rides on.
 *
 * The whole frame state of a mount-only composition lives in the Rust core's
 * linear memory: the retained tree, the style table, the animation tracks and
 * the tick counter. Nothing in the JS heap changes after mount (that is what
 * mount-only means and what `src/lint/oracle.ts` verifies), so copying linear
 * memory captures the world.
 *
 * This is the same idea as upstream's DevTools roadmap entry — "I-frame memory
 * snapshots (wasm linear-memory copies every N frames), tape frames are the
 * P-frames" — and one implementation serves both time-travel and distribution.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER
 *
 * Host-side footage state. `free_texture` bumps a slot generation, so a handle
 * taken before a restore can alias a live texture afterwards — freeing it would
 * delete someone else's pixels. Rather than checkpoint that state, the footage
 * layer is re-presented after every restore: it is a pure function of the frame
 * index, so rebuilding is both simpler and self-evidently correct. See
 * `FootageLayer.present`.
 *
 * The exposure scratch of a declared shutter (`patches/0031`). Per physical
 * pixel it is four u32 sums and the resolved exposure, five times the
 * framebuffer — 39.6 of the 51.3 MiB a 1080p core holds after one exposure
 * (`baselines/shutter.md`, stage 2) — and
 * no exposure reads a byte of it before writing it. A snapshot skips that
 * range and a restore leaves it alone. The allocation itself is reserved at
 * boot, before the first snapshot, so the allocator state every snapshot
 * restores already owns it.
 */

/** A byte range of linear memory a snapshot leaves out. `len: 0` is none. */
export interface SkipRange {
  readonly ptr: number;
  readonly len: number;
}

export interface CoreSnapshot {
  /** Linear memory below the skipped range (all of it when nothing is skipped). */
  readonly memory: Uint8Array;
  /** Linear memory above the skipped range, restored at `skip.ptr + skip.len`. */
  readonly tail: Uint8Array;
  readonly skip: SkipRange;
  /** Frame index this snapshot represents. */
  readonly frame: number;
  /** What the snapshot holds: the memory minus the skipped range. */
  readonly bytes: number;
}

export interface WasmMemoryAccess {
  readonly memory: WebAssembly.Memory;
}

/**
 * Copy linear memory. Cost is the memory's whole size, so callers should space
 * checkpoints out rather than taking one per frame.
 */
export function captureSnapshot(
  ex: WasmMemoryAccess,
  frame: number,
  skip: SkipRange = { ptr: 0, len: 0 },
): CoreSnapshot {
  const view = new Uint8Array(ex.memory.buffer);
  if (skip.len > 0 && (skip.ptr < 0 || skip.ptr + skip.len > view.length)) {
    throw new Error(
      `PocketJS Motion: skip range ${skip.ptr}+${skip.len} is outside linear memory (${view.length})`,
    );
  }
  const cut = skip.len > 0 ? skip.ptr : view.length;
  const memory = view.slice(0, cut);
  const tail = skip.len > 0 ? view.slice(skip.ptr + skip.len) : new Uint8Array(0);
  return { memory, tail, skip, frame, bytes: memory.length + tail.length };
}

/**
 * Write a snapshot's bytes back into the prefix of linear memory.
 *
 * Linear memory only ever grows, so a snapshot is never larger than the buffer
 * it is restored into. The prefix write is enough for the *pixels*: the core
 * state that matters lives in that prefix.
 *
 * It is not enough for the *heap*. `memory.grow` is relative to the real
 * buffer size, not the size the snapshot's allocator bookkeeping records.
 * Restore + fold therefore appends a new framebuffer beyond the restored
 * watermark on every cycle, and the old tail is never reused. Measured on
 * reel: each restore grows the buffer by one 1920×1080×4 frame (~8.3 MB),
 * linearly, with no plateau. Closing that ratchet is a core change. The
 * ladder's byte budget (below) stops us multiplying the grown buffer by
 * keeping N copies of it.
 */
export function restoreSnapshot(ex: WasmMemoryAccess, snap: CoreSnapshot): void {
  const view = new Uint8Array(ex.memory.buffer);
  const extent = snap.memory.length + snap.skip.len + snap.tail.length;
  if (extent > view.length) {
    throw new Error(
      `PocketJS Motion: snapshot (${extent} bytes) is larger than current ` +
        `linear memory (${view.length}) — linear memory should never shrink`,
    );
  }
  view.set(snap.memory);
  if (snap.tail.length > 0) view.set(snap.tail, snap.skip.ptr + snap.skip.len);
}

/**
 * Keyframe ladder: a snapshot every `interval` frames, so `seekFrame(n)` restores
 * the nearest one at or before `n` and folds forward the remainder.
 *
 * The interval trades memory for seek latency: with the wasm core at a few MB,
 * one snapshot per 30 frames costs a few MB per second of video and bounds the
 * fold to at most 30 frames.
 *
 * `max` caps how many snapshots stay resident. preview is the long-lived
 * caller; `render` / `trace` never open a ladder. Frame 0 is kept so a scrub
 * back to the start still restores, unless `max === 1`.
 *
 * A byte budget was tried and withdrawn: once a single snap exceeded it, the
 * ladder collapsed to the playhead copy and every rewind threw. The ratchet
 * that inflates each snap is stopped by rebuilding the world (PreviewSession),
 * not by dropping restore points.
 */
export const CHECKPOINT_LADDER_MAX = 8;

export class CheckpointLadder {
  #snapshots = new Map<number, CoreSnapshot>();
  readonly interval: number;
  readonly max: number;

  constructor(interval = 30, max = CHECKPOINT_LADDER_MAX) {
    if (!Number.isInteger(interval) || interval < 1) {
      throw new RangeError(`PocketJS Motion: checkpoint interval must be >= 1; got ${interval}`);
    }
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`PocketJS Motion: checkpoint max must be >= 1; got ${max}`);
    }
    this.interval = interval;
    this.max = max;
  }

  /** True when frame `n` is a checkpoint boundary. */
  isBoundary(n: number): boolean {
    return n % this.interval === 0;
  }

  put(snap: CoreSnapshot): void {
    this.#snapshots.set(snap.frame, snap);
    this.#evict(snap.frame);
  }

  /** Drop snapshots farthest from `playhead` until `size <= max`. */
  #evict(playhead: number): void {
    while (this.#snapshots.size > this.max) {
      const victim = this.#farthest(playhead);
      if (victim === undefined) break;
      this.#snapshots.delete(victim);
    }
  }

  /**
   * Farthest snap from the playhead that we are allowed to drop.
   * Prefer dropping non-zero frames so a scrub back to the start still
   * restores; drop 0 only when it is the last remaining other snap (`max === 1`).
   */
  #farthest(playhead: number): number | undefined {
    const others: number[] = [];
    for (const f of this.#snapshots.keys()) {
      if (f !== playhead) others.push(f);
    }
    if (others.length === 0) return undefined;
    const pool = others.some((f) => f !== 0) ? others.filter((f) => f !== 0) : others;
    let victim = pool[0]!;
    let dist = Math.abs(victim - playhead);
    for (const f of pool) {
      const d = Math.abs(f - playhead);
      if (d > dist) {
        dist = d;
        victim = f;
      }
    }
    return victim;
  }

  /** The nearest checkpoint at or before `n`, if any. */
  nearest(n: number): CoreSnapshot | undefined {
    for (let f = n - (n % this.interval); f >= 0; f -= this.interval) {
      const s = this.#snapshots.get(f);
      if (s) return s;
    }
    return undefined;
  }

  get size(): number {
    return this.#snapshots.size;
  }

  get bytes(): number {
    let total = 0;
    for (const s of this.#snapshots.values()) total += s.bytes;
    return total;
  }

  clear(): void {
    this.#snapshots.clear();
  }
}
