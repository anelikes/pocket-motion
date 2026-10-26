import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * Three entrances on one 30-frame clock, chosen so each lands differently on
 * the grid the render samples. 30 fps means the realm ticks twice per rendered
 * frame, 30 frames of film are 60 ticks of clock, and frame f shows tick
 * 2f + 1 — the last of its two (`clockOfFrame`, `src/runtime/clock.ts`).
 *
 *   sampled   17 ms delay   -> tick 1, the one frame 0 shows, and the 400 ms
 *                             tween ends on tick 25, which frame 12 shows
 *   shifted   33 ms delay   -> tick 2, one frame's worth of ms and an even
 *                             tick: no frame is rendered there, so frame 1,
 *                             at tick 3, shows the entrance already a tick in
 *   unplayed 1500 ms delay  -> tick 90, past the 60 ticks this composition has.
 *                             `both` holds the first keyframe through the
 *                             delay, so the node sits at opacity 0 for the
 *                             whole film with nothing reporting it
 *
 * Two more, about what the grid does to a cut and what a comma list does to a
 * shared property:
 *
 *   gated     a 34 ms step 33 ms in -> ticks 2 to 4, a segment no longer than
 *             one rendered frame, with frame 1's tick 3 inside it: that frame
 *             shows opacity 0.5, so a cut that was meant to be a cut is shown
 *             half drawn (the same step from an odd tick has a frame on each
 *             end and none inside, and a 17 ms step is one tick, which no
 *             frame can land inside)
 *   contended `appear 300ms` then `dim 200ms 500ms both`: both write opacity,
 *             and `both` makes the later one hold 0.72 from tick 0 — the core
 *             takes the last animation writing a property, so `appear` runs
 *             for 18 ticks and none of it reaches the picture
 *
 * And one that is not a case but the measurement the other five rest on:
 *
 *   ruler     `march 1000ms linear` -> 60 ticks, one pixel per tick, so the
 *             pixels of frame f say which tick it shows
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
      march: {
        from: { translateX: "0px" },
        to: { translateX: "60px" },
      },
    },
    animation: {
      "appear-sampled": { value: "appear 400ms linear 17ms both" },
      "appear-shifted": { value: "appear 400ms linear 33ms both" },
      "appear-unplayed": { value: "appear 400ms linear 1500ms both" },
      "appear-gated": { value: "appear 34ms linear 33ms both" },
      "appear-contended": { value: "appear 300ms linear 0ms both, dim 200ms linear 500ms both" },
      ruler: { value: "march 1000ms linear 0ms both" },
    },
  },
});
