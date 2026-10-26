/**
 * Which tick of a node's clock a rendered frame shows.
 *
 * Two facts decide it, one on each side of the boundary. The host steps the
 * core `60 / fps` ticks per rendered frame and rasterises after the last of
 * them, the first batch included: frame 0 is drawn after one whole window of
 * ticks, not before any (`WasmFrameSource.seekFrame`, and every command that
 * folds frames itself). And the core samples each baked timeline at its
 * clock and THEN advances it, from a clock of 0 when the node's style is
 * applied (`tick_timelines` and `restart_timelines`,
 * `engine/core/src/lib.rs`). So frame `f` is the state after `(f + 1) * k`
 * ticks, sampled at clock `(f + 1) * k - 1` — the LAST tick of the frame's
 * window, never the first:
 *
 *   60 fps  frame f shows tick f
 *   30 fps  frame f shows tick 2f + 1   (1, 3, 5 …)
 *   20 fps  frame f shows tick 3f + 2   (2, 5, 8 …)
 *
 * It was measured before it was written here, three ways that agree: one-tick
 * gates read back through `layout --at` at 15, 30 and 60 fps
 * (`src/captions/clock.ts`), a node moving one pixel per tick read out of
 * `frame`'s PNG at 20, 30 and 60 fps (`tests/keyframes.test.ts`), and the
 * shutter's own fixture (`tests/shutter.test.ts`, "frame 15 (clock 31)").
 * `keyframes`, the captions template and the motion kit derive from these
 * functions rather than restating the rule; the pixel test is what holds the
 * rule to the realm.
 */

import { TICKS_PER_SECOND } from "./boot.ts";

/** Core ticks the realm steps per rendered frame at `fps`. */
export function ticksPerFrame(fps: number): number {
  return TICKS_PER_SECOND / fps;
}

/** The tick of a node's clock rendered frame `frame` shows, `ticksPerFrame`
 *  ticks to a frame. */
export function clockOfFrame(frame: number, ticksPerFrame: number): number {
  return (frame + 1) * ticksPerFrame - 1;
}

/** The first rendered frame that shows `tick` or a later one. Frame 0 for
 *  every tick it already passes. */
export function firstFrameShowing(tick: number, ticksPerFrame: number): number {
  return Math.max(0, Math.ceil((tick + 1) / ticksPerFrame) - 1);
}
