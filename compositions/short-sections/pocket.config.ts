import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * 300 frames at 30 fps is 10 s and 600 core ticks; frame f shows tick 2f + 1.
 * Every delay is a multiple of 100 ms, so every one bakes to a whole tick.
 *
 *   intro    `hold` over 3000 ms: up from frame 0, gone at frame 90.
 *   rank-K   `gate` over 300 ms from frame 90 + 9(K - 1): opaque from that
 *            frame for 9 frames, opacity 0 before and after (`both`), which
 *            culls the card's subtree. MEASURED with `visibility --samples
 *            300`: num-rK is on screen at exactly those 9 frames.
 *   title-K  `appear` 100 ms from 3 frames into its rank: on screen for the
 *            rank's last 6 frames.
 *   outro    `appear` 100 ms from 5400 ms: up from frame 162 to the end.
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      gate: {
        "0%": { opacity: "0" },
        "5%": { opacity: "1" },
        "95%": { opacity: "1" },
        "100%": { opacity: "0" },
      },
      hold: {
        "0%": { opacity: "1" },
        "99%": { opacity: "1" },
        "100%": { opacity: "0" },
      },
      appear: { from: { opacity: "0" }, to: { opacity: "1" } },
    },
    animation: {
      intro: { value: "hold 3000ms linear 0ms both" },
      "rank-1": { value: "gate 300ms linear 3000ms both" },
      "title-1": { value: "appear 100ms linear 3100ms both" },
      "rank-2": { value: "gate 300ms linear 3300ms both" },
      "title-2": { value: "appear 100ms linear 3400ms both" },
      "rank-3": { value: "gate 300ms linear 3600ms both" },
      "title-3": { value: "appear 100ms linear 3700ms both" },
      "rank-4": { value: "gate 300ms linear 3900ms both" },
      "title-4": { value: "appear 100ms linear 4000ms both" },
      "rank-5": { value: "gate 300ms linear 4200ms both" },
      "title-5": { value: "appear 100ms linear 4300ms both" },
      "rank-6": { value: "gate 300ms linear 4500ms both" },
      "title-6": { value: "appear 100ms linear 4600ms both" },
      "rank-7": { value: "gate 300ms linear 4800ms both" },
      "title-7": { value: "appear 100ms linear 4900ms both" },
      "rank-8": { value: "gate 300ms linear 5100ms both" },
      "title-8": { value: "appear 100ms linear 5200ms both" },
      outro: { value: "appear 100ms linear 5400ms both" },
    },
  },
});
