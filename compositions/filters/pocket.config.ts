import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * Two filter animations: a rack focus (blur 16 px -> 0 with a glow growing
 * under it) written as a CSS `filter`, and a glow whose radius breathes,
 * written as the drop-shadow props directly.
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      focus: {
        from: { filter: "blur(16px) drop-shadow(0px 0px 4px #38bdf8)" },
        to: { filter: "blur(0px) drop-shadow(0px 0px 28px #38bdf8)" },
      },
      breathe: {
        from: { dropShadowBlur: "8px", dropShadowGain: "1" },
        "50%": { dropShadowBlur: "32px", dropShadowGain: "3" },
        to: { dropShadowBlur: "8px", dropShadowGain: "1" },
      },
    },
    animation: {
      focus: { value: "focus 900ms ease-out both" },
      breathe: { value: "breathe 1000ms ease-in-out both" },
    },
  },
});
