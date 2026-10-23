import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * Every moving thing here is a `<Path>` prop on a baked timeline, so the guest
 * issues no op after mount.
 *
 *   draw    the signature's stroke drawn on: trimEnd 0 -> 1
 *   breathe the blob to its second key and back: morph 0 -> 1 -> 0
 *   orbit   a fifth of a ring travelling round it: trimOffset 0 -> 1, the
 *           window wrapping past the start every turn
 *   turn    the globe turning under its own stroke
 *   swell   the wave's crest and trough trading places: morph 0 -> 1
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      draw: { from: { trimEnd: "0" }, to: { trimEnd: "1" } },
      breathe: { "0%": { morph: "0" }, "50%": { morph: "1" }, "100%": { morph: "0" } },
      orbit: { from: { trimOffset: "0" }, to: { trimOffset: "1" } },
      turn: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
      swell: { from: { morph: "0" }, to: { morph: "1" } },
    },
    animation: {
      draw: { value: "draw 1500ms cubic-bezier(0.4,0,0.2,1) 300ms both" },
      breathe: { value: "breathe 2000ms ease-in-out infinite" },
      orbit: { value: "orbit 2000ms linear infinite" },
      turn: { value: "turn 4000ms linear infinite" },
      swell: { value: "swell 4000ms ease-in-out both" },
    },
  },
});
