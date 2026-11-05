import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";
import { motionPath } from "../../src/anim/path-motion.ts";
import { bezier } from "../../src/anim/sampled.ts";

/**
 * Every moving thing here is a baked timeline, so the guest issues no op
 * after mount.
 *
 *   march, march-select   the dash offset run back one period, looping:
 *                         the dashes march forward along the path
 *   toggle, breathe       morphs between keys drawn separately
 *   draw-route, draw-ring trimEnd 0 -> 1 over a dashed stroke
 *   fly, trail, orbit     motion along a path, sampled by the kit from the
 *                         same outline main.tsx draws (written twice, held
 *                         equal by tests/path-primitives.test.ts)
 */

// The route's quadrant is the containing block of both the route and the
// movers, so its `d` is in their coordinates as written.
const ROUTE =
  "M70 430 C230 430 250 150 410 150 C570 150 600 360 480 360 C360 360 420 150 590 150 C750 150 770 430 890 430";
const ORBIT = "M200 20 A180 160 0 1 1 200 340 A180 160 0 1 1 200 20 Z";

const swoop = bezier(0.65, 0, 0.35, 1);
export const fly = motionPath({ d: ROUTE, node: { x: 0, y: 0, w: 56, h: 56 }, durationMs: 3600, ease: swoop, rotate: true });
export const trail = motionPath({ d: ROUTE, node: { x: 0, y: 0, w: 18, h: 18 }, durationMs: 3600, ease: swoop });
export const orbit = motionPath({
  d: ORBIT,
  path: { box: { x: 480, y: 90, w: 400, h: 360 } },
  node: { x: 0, y: 0, w: 28, h: 28 },
  durationMs: 2400,
});

export default definePocketConfig({
  theme: {
    keyframes: {
      march: { from: { dashOffset: "0" }, to: { dashOffset: "-20" } },
      "march-select": { from: { strokeDashoffset: "0" }, to: { strokeDashoffset: "-12" } },
      toggle: { "0%": { morph: "0" }, "30%": { morph: "0" }, "50%": { morph: "1" }, "80%": { morph: "1" }, "100%": { morph: "0" } },
      breathe: { "0%": { morph: "0" }, "50%": { morph: "1" }, "100%": { morph: "0" } },
      "draw-route": { from: { trimEnd: "0" }, to: { trimEnd: "1" } },
      "draw-ring": { from: { trimEnd: "0" }, to: { trimEnd: "1" } },
      fly: fly.keyframes,
      trail: trail.keyframes,
      orbit: orbit.keyframes,
    },
    animation: {
      march: { value: "march 1000ms linear infinite" },
      "march-select": { value: "march-select 600ms linear infinite" },
      toggle: { value: "toggle 3000ms ease-in-out infinite" },
      breathe: { value: "breathe 2400ms ease-in-out infinite" },
      "draw-route": { value: "draw-route 800ms cubic-bezier(0.4,0,0.2,1) both" },
      "draw-ring": { value: "draw-ring 1600ms ease-in-out 200ms both" },
      fly: { value: fly.value("fly", { delayMs: 400 }) },
      trail: { value: trail.value("trail", { delayMs: 800 }) },
      orbit: { value: orbit.value("orbit", { iterations: "infinite" }) },
    },
  },
});
