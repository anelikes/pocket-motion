import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * The lighthouse's parts, drawn on one at a time and then lit. A stagger is
 * a delay per part (GSAP's `stagger: 0.33`), so every part has its own
 * animation name and the same keyframes.
 *
 *   draw   a part's stroke drawn on: trimEnd 0 -> 1 (DrawSVG's `drawSVG: 0 -> 100%`)
 *   pop    the lamp scaled up from nothing about its own centre
 *   sweep  the beam faded in, then turned to and fro about the lamp (the
 *          mirrored keyframes are written out: `alternate` is not baked)
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      draw: { from: { trimEnd: "0" }, to: { trimEnd: "1" } },
      pop: { from: { transform: "scale(0)" }, to: { transform: "scale(1)" } },
      fade: { from: { opacity: "0" }, to: { opacity: "1" } },
      sweep: { "0%": { transform: "rotate(-14deg)" }, "50%": { transform: "rotate(14deg)" }, "100%": { transform: "rotate(-14deg)" } },
    },
    animation: {
      "draw-0": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 0ms both" },
      "draw-1": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 333ms both" },
      "draw-2": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 667ms both" },
      "draw-3": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 1000ms both" },
      "draw-4": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 1333ms both" },
      "draw-5": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 1667ms both" },
      "draw-6": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 2000ms both" },
      "draw-7": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 2333ms both" },
      "draw-8": { value: "draw 700ms cubic-bezier(0.4,0,0.2,1) 2667ms both" },
      pop: { value: "pop 500ms cubic-bezier(0.34,1.56,0.64,1) 3000ms both" },
      sweep: { value: "fade 400ms ease-out 3333ms both, sweep 3200ms ease-in-out 3333ms infinite both" },
    },
  },
});
