import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

/**
 * Two of the four windows move; both keep their contents still on screen by
 * animating the window and the child on the same clock with the same easing.
 *
 *   iris   the window's box grows about (480, 270) of its quadrant from 0 to
 *          700 px, so left = 480 - w/2 and top = 270 - h/2; the child sits at
 *          quadrant origin, i.e. at (-left, -top) in the window — every one of
 *          the six numbers is affine in the box size, so one easing keeps them
 *          consistent at every frame.
 *   wipe   the window's width grows from 0 to 2400 px; it is rotated about its
 *          left edge (`origin-left`), so that edge stays put and the right one
 *          sweeps. The scene inside is rotated back about the same point and
 *          needs no animation.
 *
 * The iris window is `rounded-[350px]`, not `rounded-full`: the compiler
 * resolves `rounded-full` from the size WRITTEN in the literal, which is 0px
 * here, while a radius in px is clamped to half the box at draw time and so
 * follows the growing box.
 */
export default definePocketConfig({
  theme: {
    keyframes: {
      "iris-window": {
        from: { width: "0px", height: "0px", left: "480px", top: "270px" },
        to: { width: "700px", height: "700px", left: "130px", top: "-80px" },
      },
      "iris-scene": {
        from: { left: "-480px", top: "-270px" },
        to: { left: "-130px", top: "80px" },
      },
      "wipe-window": {
        from: { width: "0px" },
        to: { width: "2400px" },
      },
    },
    animation: {
      "iris-window": { value: "iris-window 2000ms cubic-bezier(0.4,0,0.2,1) 300ms both" },
      "iris-scene": { value: "iris-scene 2000ms cubic-bezier(0.4,0,0.2,1) 300ms both" },
      "wipe-window": { value: "wipe-window 2200ms cubic-bezier(0.4,0,0.2,1) 200ms both" },
    },
  },
});
