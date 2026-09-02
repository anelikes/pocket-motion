import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * Three entrances on one 30-frame clock, chosen so each lands differently on
 * the grid the render samples. 30 fps means the realm ticks twice per rendered
 * frame and 30 frames of film are 60 ticks of clock.
 *
 *   sampled   0 ms delay   -> tick 0, and every segment endpoint even
 *   shifted  50 ms delay   -> tick 3, an odd tick: no frame is rendered there,
 *                             so the entrance begins at tick 4 instead
 *   unplayed 1500 ms delay -> tick 90, past the 60 ticks this composition has.
 *                             `both` holds the first keyframe through the
 *                             delay, so the node sits at opacity 0 for the
 *                             whole film with nothing reporting it
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      appear: {
        from: { opacity: "0" },
        to: { opacity: "1" },
      },
    },
    animation: {
      "appear-sampled": { value: "appear 400ms linear 0ms both" },
      "appear-shifted": { value: "appear 400ms linear 50ms both" },
      "appear-unplayed": { value: "appear 400ms linear 1500ms both" },
    },
  },
});
