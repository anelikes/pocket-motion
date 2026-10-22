/**
 * Word times to frames, and frames to the delays that make a node visible on
 * exactly those frames.
 *
 * The renderer steps the core at 60 Hz and rasterises every `60 / fps`-th
 * tick. Which tick a frame shows was MEASURED rather than assumed, with
 * one-tick gates at known delays read back through `layout --at N`: frame `f`
 * shows every timeline sampled at clock `(f + 1) * tpf - 1`. At 30 fps that is
 * clock 1, 3, 5…; at 60 fps 0, 1, 2…; at 15 fps 3, 7, 11…. A timeline with
 * delay `D` ticks is at its first keyframe while `clock - D` is 0, so a
 * one-tick `gin` gate shows the node from the first frame whose clock is past
 * `D`, and a fade starting at `D` has moved off zero by the frame after `D`.
 *
 * Delays are written in ms and baked back to ticks by the compiler as
 * `round(ms * 60 / 1000)` (`msToFrames` in the vendored `animation.ts`), so a
 * tick count is written as the whole ms that bakes back to it — `msOfTicks`
 * asserts the round trip instead of trusting it.
 */

import { TICKS_PER_SECOND } from "../runtime/boot.ts";

export const ticksPerFrame = (fps: number): number => TICKS_PER_SECOND / fps;

/** The clock a rendered frame samples. */
export const clockAt = (frame: number, fps: number): number => (frame + 1) * ticksPerFrame(fps) - 1;

/** A word's first frame. */
export const frameOf = (seconds: number, fps: number): number => Math.round(seconds * fps);

/** Whole ms that the compiler bakes back to exactly `ticks`. */
export function msOfTicks(ticks: number): number {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(`captions: a delay or duration of ${ticks} ticks cannot be written`);
  }
  const ms = Math.round((ticks * 1000) / TICKS_PER_SECOND);
  if (Math.round((ms * TICKS_PER_SECOND) / 1000) !== ticks) {
    throw new Error(`captions: ${ms}ms does not bake back to ${ticks} ticks`);
  }
  return ms;
}

/** `ms` as the duration it will bake to, in ticks, at least one. */
export const ticksOfMs = (ms: number): number => Math.max(1, Math.round((ms * TICKS_PER_SECOND) / 1000));

/**
 * Delay of a one-tick `gin` that shows a node from frame `f` and not at
 * `f - 1`, or `null` when the node is visible from frame 0 with no gate at
 * all (60 fps, where frame 0 samples clock 0 and no delay is early enough).
 */
export function gateInTick(frame: number, fps: number): number | null {
  const d = clockAt(frame, fps) - 1;
  return d < 0 ? null : d;
}

/** Delay of a one-tick `gout` that hides a node from frame `f` and not at `f - 1`. */
export const gateOutTick = (frame: number, fps: number): number => clockAt(frame, fps) - 1;

/**
 * A fade that is still above zero at frame `f - 1` and reaches zero exactly at
 * frame `f`: it ends on the clock frame `f` samples. Shortened when the film
 * has not run long enough for the whole of it.
 */
export function fadeOutTo(frame: number, fps: number, ticks: number): { delay: number; ticks: number } {
  const end = clockAt(frame, fps);
  const dur = Math.max(1, Math.min(ticks, end));
  return { delay: end - dur, ticks: dur };
}
