#!/usr/bin/env bun
/**
 * Why the reel's bars cannot use the curve that would look best on them.
 *
 * The same three benchmark bars, twice: once on the ease-in-out that reads as
 * a race (slow start, fast middle, brake), once on the ease-out that shipped.
 * Bar length and bar duration are both proportional to ms/frame, so a slow
 * start advances the SHORT bar proportionally further — and HyperFrames, the
 * faster renderer, visibly overtakes Remotion.
 *
 * Everything on screen is computed here from the same bezier the animation
 * uses, including the window where the overtake happens.
 */

const OUT = new URL(".", import.meta.url).pathname;

const keyframes: Record<string, Record<string, Record<string, string>>> = {};
const animation: Record<string, string | { value: string; loop: string }> = {};

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

const BARS = [
  { label: "Remotion", ms: 52.36, w: 700, d: 2356 },
  { label: "HyperFrames", ms: 38.19, w: 511, d: 1719 },
  { label: "PocketJS Motion", ms: 5.75, w: 77, d: 259 },
] as const;

const START = 400;
const LOOP = "3800ms";

/** first and last ms at which the second bar is longer than the first */
function overtakeWindow(p: readonly [number, number, number, number], shared?: number): [number, number] | null {
  const E = bezier(...p);
  const d0 = shared ?? BARS[0].d, d1 = shared ?? BARS[1].d;
  let lo = -1, hi = -1;
  for (let ms = 0; ms <= Math.max(d0, d1); ms += 5) {
    const a = BARS[0].w * E(Math.min(1, ms / d0));
    const b = BARS[1].w * E(Math.min(1, ms / d1));
    if (b > a + 1) { if (lo < 0) lo = ms; hi = ms; }
  }
  return lo < 0 ? null : [lo, hi];
}

function growth(id: string, w: number, d: number, ease: string): string {
  const k = `g${id}`;
  keyframes[k] = { from: { width: "0px" }, to: { width: `${w}px` } };
  animation[k] = { value: `${k} ${d}ms ${ease} ${START}ms both`, loop: LOOP };
  return k;
}

function flash(id: string, from: number, to: number): string {
  const k = "flash";
  keyframes[k] ??= { from: { opacity: "0" }, to: { opacity: "1" } };
  const n = `fl${id}`;
  animation[n] = {
    value: `flash 1ms linear ${START + from}ms both, flash 1ms linear ${START + to}ms reverse`,
    loop: LOOP,
  };
  return n;
}

interface Panel {
  readonly id: string;
  readonly title: string;
  readonly p: readonly [number, number, number, number];
  /** when set, every bar takes this long instead of a time proportional to its
   *  value — which drops the "finishes 6.6x sooner" reading and, in exchange,
   *  makes every curve admissible */
  readonly shared?: number;
  readonly cost?: string;
}

const PANELS: readonly Panel[] = [
  { id: "a", title: "ease-in-out · duration ∝ value", p: [0.4, 0, 0.6, 1],
    cost: "the shape you described. It inverts." },
  { id: "b", title: "ease-out · duration ∝ value", p: [0.2, 0.7, 0.5, 1],
    cost: "what the reel uses. One finishes 6.6× sooner, on screen." },
  { id: "c", title: "ease-in-out · one shared duration", p: [0.7, 0, 0.3, 1], shared: 1700,
    cost: "any curve is admissible — but the finishing times stop being data." },
];

const panels = PANELS.map((panel) => {
  const win = overtakeWindow(panel.p, panel.shared);
  const ease = `cubic-bezier(${panel.p.join(",")})`;
  const rows = BARS.map((b, i) => {
    const fill = i === 2 ? "bg-gradient-to-r from-blue-500 to-cyan-400" : "bg-zinc-700";
    return `        <View class="flex-row items-center gap-5 h-[34]">
          <View class="w-[270] flex-row justify-end"><Text class="text-[22px] text-zinc-400">{"${b.label}"}</Text></View>
          <View class="h-[18] rounded ${fill} animate-${growth(`${panel.id}${i}`, b.w, panel.shared ?? b.d, ease)}" />
          <Text class="text-[19px] text-zinc-600">{"${b.ms.toFixed(2)} ms"}</Text>
        </View>`;
  }).join("\n");

  const verdict = win
    ? `        <View class="flex-row items-center gap-3 h-[28] animate-${flash(panel.id, win[0], win[1])}">
          <View class="w-[8] h-[26] rounded bg-amber-400" />
          <Text class="text-[22px] font-bold text-amber-400">{"HyperFrames is ahead of Remotion — ${win[0]} to ${win[1]} ms"}</Text>
        </View>`
    : `        <View class="flex-row items-center gap-3 h-[28]">
          <View class="w-[8] h-[26] rounded bg-emerald-400" />
          <Text class="text-[22px] font-bold text-emerald-400">{"ordering holds at every frame"}</Text>
        </View>`;

  return `      <View class="w-[1440] flex-col gap-3 px-9 py-5 rounded-xl border border-zinc-800 bg-zinc-900">
        <View class="flex-row items-end gap-5">
          <Text class="text-[26px] font-bold text-zinc-50">{"${panel.title}"}</Text>
          <Text class="text-[19px] text-zinc-500">{"${ease}"}</Text>
        </View>
${rows}
${verdict}
        <Text class="text-[19px] text-zinc-500">{"${panel.cost ?? ""}"}</Text>
      </View>`;
}).join("\n");

const main = `// GENERATED by compositions/curves-race/gen.ts — do not edit by hand.
import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-zinc-950 flex-col justify-center items-center gap-5">
    <View class="w-[1440] flex-row items-end justify-between">
      <Text class="text-[34px] font-bold text-zinc-50">{"Why the bars cannot use that curve"}</Text>
      <Text class="text-[20px] text-zinc-500">{"bar length AND bar duration are both proportional to ms/frame"}</Text>
    </View>
${panels}
    <View class="w-[1440]">
      <Text class="text-[19px] text-zinc-600">{"length = k · d · E(t/d) — ordering holds for all t only if E(x)/x is non-increasing, which every slow start violates"}</Text>
    </View>
  </View>
));
`;

await Bun.write(`${OUT}main.tsx`, main);
await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/curves-race/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(keyframes, null, 6).replace(/\n/g, "\n  ")},
    animation: ${JSON.stringify(animation, null, 6).replace(/\n/g, "\n  ")},
  },
});
`,
);

for (const p of PANELS) {
  const w = overtakeWindow(p.p, p.shared);
  console.log(
    `  ${p.shared ? "shared " + p.shared + "ms" : "duration ∝ value"}  cubic-bezier(${p.p.join(",")}) -> ` +
      (w ? `OVERTAKE ${w[0]}..${w[1]} ms` : "ordering holds"),
  );
}
