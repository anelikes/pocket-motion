import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * A buried caption at its real proportions, which `compositions/occluded` does
 * not carry: that one is buried from frame 0, and the caption this models is
 * shown first. Five declarations put four shapes of "covered" side by side, because
 * telling them apart is the whole predicate.
 *
 * 240 frames at 30 fps is 8000 ms and 480 core ticks. All `both`, so the held
 * value applies outside the active window:
 *
 *   caption-span  0%/5%/90%/100% over the whole film. MEASURED: it paints at
 *                 every one of the 240 frames — neither the 0% nor the 100%
 *                 stop produces a dark frame at its end — and the lid covers
 *                 it from frame 72 on. The defect.
 *   lid-in        opacity 0 -> 1 at 2000 ms: opaque from frame 72 onward.
 *   cross-out     opacity 1 -> 0 over the same 400 ms window. Its exit lands on
 *                 the frame the lid turns opaque, so it is covered at NO frame:
 *                 on screen, then invisible by declaration. An ordinary
 *                 dissolve, and it must not be a finding.
 *   trail-out     the same dissolve with a 1200 ms exit under the same 400 ms
 *                 entrance. From frame 72 to 95 it still paints and the lid
 *                 hides every pixel, so it IS covered — and a check that reads
 *                 the picture alone cannot tell those frames from the
 *                 caption's. This is the gate's reach, held here as a red case
 *                 rather than as a sentence.
 *   early-out     an opaque box over `revealed` alone, gone by frame 33. What
 *                 it leaves behind is covered BEFORE it is shown, which is a
 *                 reveal and not a burial — the ordering the predicate rests
 *                 on, and nothing else in the tree contains one.
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      caption: {
        "0%": { opacity: "0" },
        "5%": { opacity: "1" },
        "90%": { opacity: "1" },
        "100%": { opacity: "0" },
      },
      appear: { from: { opacity: "0" }, to: { opacity: "1" } },
      vanish: { from: { opacity: "1" }, to: { opacity: "0" } },
    },
    animation: {
      "caption-span": { value: "caption 8000ms linear 0ms both" },
      "lid-in": { value: "appear 400ms linear 2000ms both" },
      "cross-out": { value: "vanish 400ms linear 2000ms both" },
      "trail-out": { value: "vanish 1200ms linear 2000ms both" },
      "early-out": { value: "vanish 100ms linear 1000ms both" },
    },
  },
});
