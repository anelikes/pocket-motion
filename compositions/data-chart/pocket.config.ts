import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 *   draw   the series drawn on: trimEnd 0 -> 1
 *   fill   the area under it faded in once the line has passed
 *   dots   the points faded in last
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      draw: { from: { trimEnd: "0" }, to: { trimEnd: "1" } },
      fade: { from: { opacity: "0" }, to: { opacity: "1" } },
    },
    animation: {
      draw: { value: "draw 1500ms cubic-bezier(0.4,0,0.2,1) 200ms both" },
      fill: { value: "fade 600ms ease-out 1500ms both" },
      dots: { value: "fade 400ms ease-out 2000ms both" },
    },
  },
});
