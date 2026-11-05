import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * Every moving thing is a baked timeline, so the guest issues no op after
 * mount.
 *
 *   rise   the hero from 60% and a -8 degree turn to rest, 600 ms
 *   turn   the turning character, a revolution every 3 s
 *   sway   the flame rocking and breathing, 1.5 s a cycle
 *   slide  the title in from the left after the hero lands
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      rise: {
        from: { transform: "translateY(80px) scale(0.6) rotate(-8deg)", opacity: "0" },
        to: { transform: "translateY(0px) scale(1) rotate(0deg)", opacity: "1" },
      },
      turn: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
      sway: {
        "0%": { transform: "rotate(-12deg) scale(0.9)" },
        "50%": { transform: "rotate(12deg) scale(1.1)" },
        "100%": { transform: "rotate(-12deg) scale(0.9)" },
      },
      slide: { from: { transform: "translateX(-60px)", opacity: "0" }, to: { transform: "translateX(0px)", opacity: "1" } },
    },
    animation: {
      rise: { value: "rise 600ms cubic-bezier(0.2,0.8,0.2,1) both" },
      turn: { value: "turn 3000ms linear infinite" },
      sway: { value: "sway 1500ms ease-in-out infinite" },
      slide: { value: "slide 400ms ease-out 700ms both" },
    },
  },
});
