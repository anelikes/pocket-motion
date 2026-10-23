import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * The render-cost benchmark scene's timelines. Every delay and duration is a
 * multiple of 100 ms, which is three whole frames at 30 fps and six ticks at
 * 60 Hz, so nothing here moves with the bake's rounding and the Remotion and
 * HyperFrames ports can state the same instants in frames.
 *
 * The scene is the same in `../../remotion/` and `../../hyperframes/`; a
 * change here is a change there.
 */
const OUT_EXPO = "cubic-bezier(0.16,1,0.3,1)";
const IN_OUT = "cubic-bezier(0.65,0,0.35,1)";
const IN_EXPO = "cubic-bezier(0.7,0,0.84,0)";
const SINE = "cubic-bezier(0.37,0,0.63,1)";

export default definePocketConfig({
  theme: {
    keyframes: {
      rise: { from: { translateY: "30px", opacity: "0" }, to: { translateY: "0px", opacity: "1" } },
      riseLg: { from: { translateY: "80px", opacity: "0" }, to: { translateY: "0px", opacity: "1" } },
      growX: { from: { scaleX: "0" }, to: { scaleX: "1" } },
      push: { from: { scale: "1" }, to: { scale: "1.04" } },
      fadeOut: { from: { opacity: "1" }, to: { opacity: "0" } },
      slideIn: { from: { translateX: "-900px" }, to: { translateX: "0px" } },
      slideOut: { from: { translateX: "0px" }, to: { translateX: "-900px" } },
      breathe: { "0%": { scale: "1" }, "50%": { scale: "1.15" }, "100%": { scale: "1" } },
      spin: { from: { rotate: "0deg" }, to: { rotate: "360deg" } },
      spinBack: { from: { rotate: "360deg" }, to: { rotate: "0deg" } },
      bobY: { "0%": { translateY: "0px" }, "50%": { translateY: "-40px" }, "100%": { translateY: "0px" } },
      bobX: { "0%": { translateX: "0px" }, "50%": { translateX: "30px" }, "100%": { translateX: "0px" } },
    },
    animation: {
      glow: `breathe 4000ms ${SINE} infinite`,
      "shape-a": `spin 12000ms linear infinite, bobY 5000ms ${SINE} infinite`,
      "shape-b": `spinBack 9000ms linear infinite, bobX 4000ms ${SINE} infinite`,
      "shape-c": "spin 20000ms linear infinite",
      kicker: `rise 600ms ${OUT_EXPO} 300ms both`,
      title1: `riseLg 700ms ${OUT_EXPO} 500ms both`,
      title2: `riseLg 700ms ${OUT_EXPO} 700ms both`,
      bar: `growX 600ms ${IN_OUT} 1100ms both`,
      subtitle: `rise 600ms ${OUT_EXPO} 1400ms both`,
      push: "push 10000ms linear both",
      "title-out": `fadeOut 500ms ${IN_EXPO} 9300ms forwards`,
      "plate-in": `slideIn 600ms ${OUT_EXPO} 4500ms both`,
      "plate-out": `slideOut 500ms ${IN_EXPO} 8600ms forwards`,
      name: `rise 500ms ${OUT_EXPO} 4800ms both`,
      role: `rise 500ms ${OUT_EXPO} 5000ms both`,
      progress: "growX 10000ms linear both",
    },
  },
});
