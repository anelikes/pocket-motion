/**
 * Runtime mount-only oracle for PocketJS Motion.
 *
 * After mount, a composition is mount-only only if the guest issues no further
 * work that mutates frame state. This module wraps a HostOps-shaped object and
 * counts guest-originated calls across frames. Host-side work (e.g. footage
 * texture uploads every frame) is excluded via `asHost`.
 *
 * ## Scope — this module answers one of the two questions
 *
 * Counting HostOps calls catches every guest action that **reaches the core**,
 * within the window observed. It cannot see work that is merely *booked*:
 * `after(10, …)` issues nothing for 600 frames and then mutates the world, so
 * no finite ops observation can rule it out. That is not a tuning problem —
 * lengthening the window only moves the deadline that defeats it.
 *
 * The complement is `BootedWorld.pendingWork()` (`src/runtime/boot.ts`), which
 * reads the framework's scheduled-work registries directly — frame hooks,
 * timers, effects in flight, service pumps. Those are module-level bindings
 * with no export upstream; `patches/0003` adds read-only counters and publishes
 * them on a contract slot.
 *
 * `check` requires all three to agree: zero ops after mount (empirical), zero
 * pending work (structural), and no forbidden imports (static). Each covers a
 * gap the others have.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OracleOptions {
  /** Frames to run after mount. Default 30. */
  readonly frames?: number;
}

export interface OracleReport {
  readonly framesObserved: number;
  /** Guest-originated HostOps calls per frame, index 0 = first frame after mount. */
  readonly opsPerFrame: readonly number[];
  /**
   * Ops the guest issued while MOUNTING — everything before the first
   * `beginFrame()`. A composition necessarily builds its tree here, so a
   * non-zero value is expected and says nothing about mount-only.
   */
  readonly mountOps: number;
  /** Guest ops AFTER mount. This is the number mount-only is about. */
  readonly totalOps: number;
  /** `true` iff `totalOps === 0` — the guest did nothing once mounted. */
  readonly mountOnly: boolean;
  /** Which ops fired, for diagnosis: `{ setStyle: 12, setProp: 3 }`. */
  readonly opsByName: Readonly<Record<string, number>>;
}

/**
 * Wrap a HostOps-shaped object so calls can be counted, and separate calls the
 * host itself makes (footage uploads) from calls the guest makes.
 */
export interface CountingOps {
  /** Pass this to the sandbox as the `ui` slot. */
  readonly ops: Record<string, unknown>;
  /**
   * Count only what the guest did; host-side calls made inside this callback
   * are excluded (depth counter — nested `asHost` works).
   */
  asHost<T>(fn: () => T): T;
  /** Mark the start of the next frame (finalises the previous frame's count). */
  beginFrame(): void;
  /** Snapshot counts for `frames` frames after mount. */
  report(frames: number): OracleReport;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Wrap `inner` HostOps so every function property is instrumented.
 * Non-function properties are passed through unchanged.
 */
export function countingOps(inner: Record<string, unknown>): CountingOps {
  /** >0 while inside `asHost` (supports nesting). */
  let hostDepth = 0;

  /** Whether `beginFrame` has been called at least once. */
  let inSequence = false;

  /** Guest ops accumulated for the current open frame. */
  let currentFrameOps = 0;

  /** Finalised per-frame guest op counts (excludes the still-open frame). */
  const finalised: number[] = [];

  let totalOps = 0;
  /** Guest ops issued during mount (everything before the first beginFrame). */
  let mountOps = 0;
  const opsByName: Record<string, number> = {};

  const recordGuestOp = (name: string): void => {
    if (hostDepth !== 0) return;
    totalOps += 1;
    currentFrameOps += 1;
    opsByName[name] = (opsByName[name] ?? 0) + 1;
  };

  const ops: Record<string, unknown> = {};

  for (const key of Object.keys(inner)) {
    const value = inner[key];
    if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      ops[key] = (...args: unknown[]): unknown => {
        recordGuestOp(key);
        // Transparent: return values and thrown errors pass through unchanged.
        return fn.apply(inner, args);
      };
    } else {
      ops[key] = value;
    }
  }

  return {
    ops,

    asHost<T>(fn: () => T): T {
      hostDepth += 1;
      try {
        return fn();
      } finally {
        hostDepth -= 1;
      }
    },

    beginFrame(): void {
      if (inSequence) {
        finalised.push(currentFrameOps);
        currentFrameOps = 0;
      } else {
        // First boundary: open frame 0. Any ops counted before the first
        // beginFrame remain in currentFrameOps and become frame 0's count
        // only if they occur after this call — pre-sequence ops are still
        // in totalOps/opsByName (guest did call them) but sit in
        // currentFrameOps until the first finalisation. Clear them so frame 0
        // starts clean; they already contributed to totals.
        // First boundary closes MOUNT. A composition must build its tree, so
        // those ops are expected; mount-only is only about what happens after.
        // Move them aside rather than counting them against the verdict.
        mountOps = totalOps;
        totalOps = 0;
        for (const k of Object.keys(opsByName)) delete opsByName[k];
        currentFrameOps = 0;
        inSequence = true;
      }
    },

    report(frames: number): OracleReport {
      // Include the still-open frame if a sequence is active.
      const all = inSequence
        ? finalised.concat([currentFrameOps])
        : finalised.slice();

      const opsPerFrame: number[] = [];
      for (let i = 0; i < frames; i++) {
        opsPerFrame.push(all[i] ?? 0);
      }

      return {
        framesObserved: frames,
        opsPerFrame,
        mountOps,
        totalOps,
        mountOnly: totalOps === 0,
        opsByName: { ...opsByName },
      };
    },
  };
}
