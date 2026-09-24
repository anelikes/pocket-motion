import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * One animated stroke: the width grows from 0 to 10 px and the colour warms
 * over the 45 frames. `-webkit-text-stroke-width` is accepted as a keyframe
 * property under its camel-case spelling, as is `textStrokeWidth`.
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      "stroke-grow": {
        from: { WebkitTextStrokeWidth: "0px", WebkitTextStrokeColor: "#38bdf8" },
        to: { WebkitTextStrokeWidth: "10px", WebkitTextStrokeColor: "#f97316" },
      },
    },
    animation: {
      "stroke-grow": { value: "stroke-grow 1400ms ease-in-out both" },
    },
  },
});
