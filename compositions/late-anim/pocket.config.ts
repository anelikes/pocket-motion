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
 *
 * Two more, about what the grid does to a cut and what a comma list does to a
 * shared property:
 *
 *   gated     a 34 ms step 50 ms in -> ticks 3 to 5, a segment no longer than
 *             one rendered frame, with the render's tick 4 inside it: that
 *             frame shows opacity 0.5, so a cut that was meant to be a cut
 *             arrives a frame late and half drawn (a 17 ms step is one tick
 *             and no frame can land inside it)
 *   contended `appear 300ms` then `dim 200ms 500ms both`: both write opacity,
 *             and `both` makes the later one hold 0.72 from tick 0 — the core
 *             takes the last animation writing a property, so `appear` runs
 *             for 18 ticks and none of it reaches the picture
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      appear: {
        from: { opacity: "0" },
        to: { opacity: "1" },
      },
      dim: {
        from: { opacity: "0.72" },
        to: { opacity: "0.2" },
      },
    },
    animation: {
      "appear-sampled": { value: "appear 400ms linear 0ms both" },
      "appear-shifted": { value: "appear 400ms linear 50ms both" },
      "appear-unplayed": { value: "appear 400ms linear 1500ms both" },
      "appear-gated": { value: "appear 34ms linear 50ms both" },
      "appear-contended": { value: "appear 300ms linear 0ms both, dim 200ms linear 500ms both" },
    },
  },
});
