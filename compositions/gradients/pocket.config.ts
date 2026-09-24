import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * Two gradient animations: the headline's angle turns 90 -> 270 degrees, and
 * a bright via stop sweeps across the bar below it (its position keyframed
 * from 0.05 to 0.95).
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      turn: { from: { gradAngle: "90deg" }, to: { gradAngle: "270deg" } },
      sweep: { from: { gradVia1Pos: "0.05" }, to: { gradVia1Pos: "0.95" } },
    },
    animation: {
      turn: { value: "turn 1000ms ease-in-out both" },
      sweep: { value: "sweep 1000ms linear both" },
    },
  },
});
