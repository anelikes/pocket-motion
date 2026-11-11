import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * A zoom whose focal point travels: the card is held at twice its size and
 * its transform origin moves from its top-left corner to its bottom-right,
 * so the picture pans while it is magnified — a product of two motions no
 * eased translate track can carry.
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      pan: {
        from: { transformOrigin: "0% 0%" },
        to: { transformOrigin: "100% 100%" },
      },
    },
    animation: {
      pan: { value: "pan 1000ms linear both" },
    },
  },
});
