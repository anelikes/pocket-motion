import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * The three animations colour filters exist for: a node fading from grey to
 * full colour (a `filter` list), a brightness flash (the keyframe property),
 * and a hue cycle that loops (a CSS angle).
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      "colour-in": {
        from: { filter: "grayscale(100%)" },
        to: { filter: "grayscale(0%)" },
      },
      flash: {
        "0%, 100%": { brightness: "1" },
        "40%": { brightness: "3" },
      },
      "hue-cycle": {
        from: { hueRotate: "0deg" },
        to: { hueRotate: "1turn" },
      },
    },
    animation: {
      "colour-in": { value: "colour-in 900ms ease-out both" },
      flash: { value: "flash 600ms ease-in-out 200ms both" },
      "hue-cycle": { value: "hue-cycle 1000ms linear infinite" },
    },
  },
});
