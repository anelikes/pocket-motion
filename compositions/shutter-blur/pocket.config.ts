import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * One timeline per thing the shutter has to get right. Every duration is a
 * whole number of 60 Hz ticks, so nothing here moves with the bake's rounding.
 *
 *   spin2  720 deg/s: a form 400 px from the centre moves ~167 px a frame at
 *          30 fps, and the wrap at 360 is the same picture as 0, so the blur
 *          runs through it
 *   sweep  an eased there-and-back, 1500 px each way
 *   tele   a zero-length keyframe interval at 50% (`50%` and `50.01%` bake to
 *          one tick and the later stop wins): a declared 300 px jump, and the
 *          loop wrap is another
 *   flick  a hold to 49%, then ONE tick to 500 px at 100 ticks a period: a
 *          one-tick segment no tick of the realm shows in progress
 *   gated  a slide under two 34 ms opacity gates: opacity is the frame's own in
 *          every sample, so a gate opens and closes on the frame it would
 *          without a shutter
 *   whip   an eased 520 px there-and-back on two identical labels, one of them
 *          `shutter-hold`
 *   pop    a scale overshoot on the hub
 *   known  4 px a tick, linear, over a 64-tick period: a sample a quarter tick
 *          off the frame's tick sits at a whole pixel, so the pixels of a
 *          2-sample exposure can be written down in advance
 *          (`tests/shutter.test.ts`)
 *   blade  spin2 over 2 ticks: half a revolution a tick, so at every tick the
 *          150 × 30 blade lies at 0 or 180 degrees — the same rectangle — over
 *          `peek`, 15 px inside it at each end and 10 px along each side. The
 *          samples sit up to 79 degrees either side of that and uncover the
 *          bar's ends, so `peek` is covered at the tick of every frame and in
 *          the picture of every exposure. `layout`, `visibility` and `assert`
 *          read the exposure and see it; `--read tick` does not
 *          (`tests/shutter.test.ts`)
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      spin2: { from: { rotate: "0deg" }, to: { rotate: "360deg" } },
      sweep: { "0%": { translateX: "0px" }, "50%": { translateX: "1500px" }, "100%": { translateX: "0px" } },
      tele: { "0%": { translateX: "0px" }, "50%": { translateX: "150px" }, "50.01%": { translateX: "450px" }, "100%": { translateX: "600px" } },
      flick: { "0%": { translateX: "0px" }, "49%": { translateX: "0px" }, "50%": { translateX: "500px" }, "100%": { translateX: "500px" } },
      slide: { from: { translateX: "0px" }, to: { translateX: "600px" } },
      gin: { from: { opacity: "0" }, to: { opacity: "1" } },
      gout: { from: { opacity: "1" }, to: { opacity: "0" } },
      whip: { "0%": { translateX: "0px" }, "50%": { translateX: "520px" }, "100%": { translateX: "0px" } },
      pop: { "0%": { scale: "1" }, "15%": { scale: "1.8" }, "100%": { scale: "1" } },
      known: { from: { translateX: "0px" }, to: { translateX: "256px" } },
    },
    animation: {
      spin2: "spin2 500ms linear infinite",
      sweep: "sweep 1200ms cubic-bezier(0.42,0,0.58,1) infinite",
      tele: "tele 1000ms linear infinite",
      flick: "flick 1667ms linear infinite",
      gated: "slide 1000ms linear infinite, gin 34ms linear 1000ms both, gout 34ms linear 2000ms forwards",
      whip: "whip 1000ms cubic-bezier(0.42,0,0.58,1) infinite",
      pop: "pop 1000ms cubic-bezier(0.25,1,0.5,1) infinite",
      // 1067 ms bakes to 64 ticks (round half up of 64.02).
      known: "known 1067ms linear infinite",
      // 34 ms bakes to 2 ticks (2.04).
      blade: "spin2 34ms linear infinite",
    },
  },
});
