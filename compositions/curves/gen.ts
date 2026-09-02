#!/usr/bin/env bun
/**
 * A curve demo, so a disagreement about "too slow" can be settled by looking
 * at the same thing instead of by describing it.
 *
 * Eight curves, same distance, same duration, running together and looping.
 * Each row carries its exact `cubic-bezier` parameters, a plot of the curve
 * itself, and a dot with a six-ghost trail — the trail is the point: where the
 * dot is fast the ghosts spread out, where it is slow they bunch up, so speed
 * is legible directly rather than inferred. That is the read @patexum's
 * original graphic gets from its motion blur.
 */

const OUT = new URL(".", import.meta.url).pathname;

const keyframes: Record<string, Record<string, Record<string, string>>> = {};
const animation: Record<string, string | { value: string; loop: string }> = {};

const TRAVEL = 900;
const DUR = 1700;
const LOOP = "2800ms";
const GHOSTS = 6;
const GHOST_LAG = 45;

interface Curve {
  readonly name: string;
  readonly p: readonly [number, number, number, number];
  readonly note: string;
  readonly mark?: "want" | "have";
}

const CURVES: readonly Curve[] = [
  { name: "linear", p: [0, 0, 1, 1], note: "no acceleration anywhere" },
  { name: "ease-in-out · mild", p: [0.4, 0, 0.6, 1], note: "slow start, fast middle, brake", mark: "want" },
  { name: "ease-in-out · strong", p: [0.7, 0, 0.3, 1], note: "same shape, pushed harder", mark: "want" },
  { name: "ease-out · mild", p: [0.2, 0.7, 0.5, 1], note: "launches at 3.4x, brakes to 0", mark: "have" },
  { name: "ease-out · SNAP", p: [0.1, 1, 0.1, 1], note: "every entry in the reel uses this" },
  { name: "ease-in", p: [0.7, 0, 1, 0.35], note: "every exit in the reel uses this" },
  { name: "ease-in-out · extreme", p: [0.9, 0, 0.1, 1], note: "almost a teleport in the middle" },
  { name: "ease-out-back", p: [0.34, 1.56, 0.64, 1], note: "overshoots — banned in the reel" },
];

// ── bezier, so the plot and the motion come from the same numbers ───────────

function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const fy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 24; i++) {
      const e = fx(t) - x;
      t -= e / Math.max(1e-6, (3 * ax * t + 2 * bx) * t + cx);
      t = Math.min(1, Math.max(0, t));
    }
    return fy(t);
  };
}

const css = (c: Curve) => `cubic-bezier(${c.p.join(",")})`;

// ── the moving dot and its trail ───────────────────────────────────────────

keyframes["travel"] = {
  from: { transform: "translateX(0px)" },
  to: { transform: `translateX(${TRAVEL}px)` },
};

function move(c: Curve, i: number, lag: number): string {
  const n = `mv${i}_${lag}`;
  animation[n] = { value: `travel ${DUR}ms ${css(c)} ${lag}ms both`, loop: LOOP };
  return n;
}

// ── the plot ───────────────────────────────────────────────────────────────

const PLOT_W = 168;
const PLOT_H = 84;
const SAMPLES = 42;

function plot(c: Curve): string {
  const f = bezier(...c.p);
  const dots: string[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const x = i / (SAMPLES - 1);
    const y = f(x);
    const left = Math.round(x * (PLOT_W - 4));
    // the back-overshoot curve leaves the box; clamp the plot, not the motion
    const top = Math.round((1 - Math.min(1.12, Math.max(-0.12, y))) * (PLOT_H - 4) / 1.24 + PLOT_H * 0.1);
    dots.push(`            <View class="absolute left-[${left}] top-[${top}] w-[4] h-[4] rounded-full bg-cyan-400" />`);
  }
  return dots.join("\n");
}

// ── rows ───────────────────────────────────────────────────────────────────

const MARK: Record<string, string> = {
  want: "bg-amber-400",
  have: "bg-blue-500",
};

const rows = CURVES.map((c, i) => {
  const ghosts: string[] = [];
  for (let g = GHOSTS; g >= 1; g--) {
    const op = ["opacity-10", "opacity-20", "opacity-20", "opacity-30", "opacity-40", "opacity-50"][GHOSTS - g]!;
    ghosts.push(
      `            <View class="absolute left-0 top-0 w-[24] h-[24] rounded-full bg-zinc-400 ${op} animate-${move(c, i, g * GHOST_LAG)}" />`,
    );
  }
  const dotColor = c.mark === "want" ? "bg-amber-400" : c.mark === "have" ? "bg-blue-500" : "bg-zinc-50";
  return `      <View class="flex-row items-center gap-8 h-[102]">
        <View class="w-[52] flex-row justify-center">
          ${c.mark ? `<View class="w-[8] h-[52] rounded ${MARK[c.mark]}" />` : `<View class="w-[8] h-[52]" />`}
        </View>
        <View class="w-[330] flex-col gap-1">
          <Text class="text-[26px] font-bold text-zinc-50">{"${c.name}"}</Text>
          <Text class="text-[20px] text-zinc-500">{"${css(c)}"}</Text>
          <Text class="text-[18px] text-zinc-600">{"${c.note}"}</Text>
        </View>
        <View class="w-[${PLOT_W}] h-[${PLOT_H}] rounded bg-zinc-900">
${plot(c)}
        </View>
        <View class="w-[${TRAVEL + 24}] h-[24]">
${ghosts.join("\n")}
            <View class="absolute left-0 top-0 w-[24] h-[24] rounded-full ${dotColor} animate-${move(c, i, 0)}" />
        </View>
      </View>`;
}).join("\n");

const main = `// GENERATED by compositions/curves/gen.ts — do not edit by hand.
import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-zinc-950 flex-col justify-center items-center gap-6">
    <View class="w-[1560] flex-row items-end justify-between">
      <Text class="text-[38px] font-bold text-zinc-50">{"Animation curves"}</Text>
      <Text class="text-[22px] text-zinc-500">{"same distance · same ${DUR} ms · ${GHOSTS} ghosts at ${GHOST_LAG} ms lag"}</Text>
    </View>
    <View class="w-[1560] h-[2] rounded bg-zinc-800" />
    <View class="flex-col">
${rows}
    </View>
    <View class="w-[1560] flex-row justify-between">
      <View class="flex-row items-center gap-3">
        <View class="w-[14] h-[14] rounded bg-amber-400" />
        <Text class="text-[20px] text-zinc-400">{"the shape you described"}</Text>
      </View>
      <View class="flex-row items-center gap-3">
        <View class="w-[14] h-[14] rounded bg-blue-500" />
        <Text class="text-[20px] text-zinc-400">{"what the reel's bars use now"}</Text>
      </View>
    </View>
  </View>
));
`;

await Bun.write(`${OUT}main.tsx`, main);
await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/curves/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(keyframes, null, 6).replace(/\n/g, "\n  ")},
    animation: ${JSON.stringify(animation, null, 6).replace(/\n/g, "\n  ")},
  },
});
`,
);

console.log(`curves: ${CURVES.length} curves, ${Object.keys(animation).length} animations`);
