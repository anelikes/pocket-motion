// Shutter prototype: a fill-rate-heavy scene (stage 1, scratch only).
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: {
      cw: { from: { rotate: "0deg" }, to: { rotate: "360deg" } },
      ccw: { from: { rotate: "360deg" }, to: { rotate: "0deg" } },
      drift: { "0%": { translateX: "-300px" }, "50%": { translateX: "300px" }, "100%": { translateX: "-300px" } },
    },
    animation: {
      cw: "cw 900ms linear infinite",
      ccw: "ccw 1300ms linear infinite",
      drift: "drift 1000ms cubic-bezier(0.42,0,0.58,1) infinite",
    },
  },
});
