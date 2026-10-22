// Shutter prototype scene (stage 1, scratch only).
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: {
      // 720 deg/s: a form 400 px from the centre moves ~167 px per 30 fps frame.
      spin2: { from: { rotate: "0deg" }, to: { rotate: "360deg" } },
      sweep: { "0%": { translateX: "0px" }, "50%": { translateX: "1500px" }, "100%": { translateX: "0px" } },
      // A zero-length interval at 50%: a declared jump of 300 px, then the loop wrap is another.
      tele: { "0%": { translateX: "0px" }, "50%": { translateX: "150px" }, "50.01%": { translateX: "450px" }, "100%": { translateX: "600px" } },
      // 0..49% hold, 49%..50% is ONE tick at 100 ticks per period: a one-tick segment.
      flick: { "0%": { translateX: "0px" }, "49%": { translateX: "0px" }, "50%": { translateX: "500px" }, "100%": { translateX: "500px" } },
      slide: { from: { translateX: "0px" }, to: { translateX: "600px" } },
      gin: { from: { opacity: "0" }, to: { opacity: "1" } },
      gout: { from: { opacity: "1" }, to: { opacity: "0" } },
      whip: { "0%": { translateX: "0px" }, "50%": { translateX: "520px" }, "100%": { translateX: "0px" } },
      pop: { "0%": { scale: "1" }, "15%": { scale: "1.8" }, "100%": { scale: "1" } },
    },
    animation: {
      spin2: "spin2 500ms linear infinite",
      sweep: "sweep 1200ms cubic-bezier(0.42,0,0.58,1) infinite",
      tele: "tele 1000ms linear infinite",
      flick: "flick 1667ms linear infinite",
      gated: "slide 1000ms linear infinite, gin 34ms linear 1000ms both, gout 34ms linear 2000ms forwards",
      whip: "whip 1000ms cubic-bezier(0.42,0,0.58,1) infinite",
      pop: "pop 1000ms cubic-bezier(0.25,1,0.5,1) infinite",
    },
  },
});
