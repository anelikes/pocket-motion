#!/usr/bin/env bun
/**
 * compositions/long-track — a transform track and a set of opacity tracks,
 * each longer than the 255 segments the ANIM TABLE's one-byte count held.
 *
 * 70 s at 30 fps on a 320×180 canvas, in the two shapes a long-form film
 * reaches that ceiling with:
 *
 *   - a CAMERA over a 1280×720 graph of nodes and orthogonal edges. One
 *     `El.path`, keyed every second tick, carries it from station to station
 *     until tick 4000; it holds on the ninth station and then CUTS to the last
 *     one at tick 4100, past the 2,000th segment. translateX and translateY
 *     each carry 2,003 segments, and the cut is a one-tick step `keyframes`
 *     has to read to the end of the track to report.
 *   - a COUNTER: the frame number in four seven-segment cells (`glyphCell`),
 *     so every frame names itself. A units glyph lights for one frame in ten,
 *     and each of its opacity tracks is 840 segments of one-tick steps.
 *
 * Before patches/0050 the encoder refused both ("animation track needs
 * 1..255 segments") and `src/anim/sampled.ts` refused them earlier still: a
 * generator had to key a film-length move at one key per eight frames, or
 * split it by hand. Every station carries a name, so a test can read the
 * camera at each arrival from `layout` rather than at the end alone. The
 * sidecar asserts what the film is for: the counter is on screen throughout,
 * and `last-station`, which only the cut brings on, is on screen from the cut
 * to the end. A track that stopped at its 255th segment would leave the
 * camera between the first two stations, 8.5 s in, for the rest of the film.
 *
 *   bun compositions/long-track/gen.ts
 *   bun src/cli/main.ts build compositions/long-track
 */

import { fileURLToPath } from "node:url";
import { El, glyphCell, inOut, lerp, Reg, rng } from "../../src/anim/sampled.ts";

const OUT = fileURLToPath(new URL(".", import.meta.url));

const W = 320;
const H = 180;
const FPS = 30;
const FRAMES = 2100;
const TICKS = FRAMES * (60 / FPS);
const DUR_MS = (FRAMES / FPS) * 1000;
/** The camera's travel ends on the ninth station here, and cuts to the last one at T_CUT. */
const T_TRAVEL = 4000;
const T_CUT = 4100;
const reg = new Reg(TICKS, DUR_MS);

// ── the graph ────────────────────────────────────────────────────────────────

const WORLD = { w: 1280, h: 720 };
const COLS = 6;
const ROWS = 5;
const r = rng(0x10ad);
const nodes: { x: number; y: number }[] = [];
for (let j = 0; j < ROWS; j++) {
  for (let i = 0; i < COLS; i++) {
    const cw = WORLD.w / COLS;
    const ch = WORLD.h / ROWS;
    nodes.push({ x: Math.round(cw * (i + 0.25 + 0.5 * r())), y: Math.round(ch * (j + 0.25 + 0.5 * r())) });
  }
}
const at = (i: number, j: number) => j * COLS + i;
/** The tour, as grid cells: a serpentine through the graph, then a cut to the far corner. */
const TOUR = [at(0, 0), at(2, 0), at(2, 2), at(0, 2), at(0, 4), at(2, 4), at(3, 3), at(5, 1), at(4, 3), at(5, 4)];
const LAST = TOUR[TOUR.length - 1]!;
/** Stations the camera travels to; the last is reached by the cut. */
const TRAVEL = TOUR.slice(0, -1);

const edges: [number, number][] = [];
for (let k = 0; k + 1 < TOUR.length; k++) edges.push([TOUR[k]!, TOUR[k + 1]!]);
for (let j = 0; j < ROWS; j++) for (let i = 0; i + 1 < COLS; i++) if (r() < 0.35) edges.push([at(i, j), at(i + 1, j)]);
for (let j = 0; j + 1 < ROWS; j++) for (let i = 0; i < COLS; i++) if (r() < 0.25) edges.push([at(i, j), at(i, j + 1)]);

/** An orthogonal edge: across from `a`, then down or up to `b`. */
function edge(a: number, b: number): string {
  const p = nodes[a]!;
  const q = nodes[b]!;
  const color = TOUR.includes(a) && TOUR.includes(b) ? "#0369a1" : "#334155";
  const x0 = Math.min(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const across = `<View class="absolute left-[${x0}px] top-[${p.y - 1}px] w-[${Math.abs(q.x - p.x) + 1}px] h-[2px] bg-[${color}]" />`;
  const down = `<View class="absolute left-[${q.x - 1}px] top-[${y0}px] w-[2px] h-[${Math.abs(q.y - p.y) + 1}px] bg-[${color}]" />`;
  return across + down;
}

function node(k: number): string {
  const { x, y } = nodes[k]!;
  if (k === LAST) {
    return `<View debugName="last-station" class="absolute left-[${x - 14}px] top-[${y - 14}px] w-[28px] h-[28px] rounded-full border-[3px] border-[#fbbf24] bg-[#78350f]" />`;
  }
  const station = TRAVEL.indexOf(k);
  if (station >= 0) {
    return `<View debugName="station-${station}" class="absolute left-[${x - 8}px] top-[${y - 8}px] w-[16px] h-[16px] rounded-full bg-[#38bdf8]" />`;
  }
  return `<View class="absolute left-[${x - 5}px] top-[${y - 5}px] w-[10px] h-[10px] rounded-full bg-[#64748b]" />`;
}

// ── the camera ───────────────────────────────────────────────────────────────

/** Leg k runs from travel station k to k + 1 and ends on this (even) tick. */
const LEG_END = TRAVEL.slice(1).map((_, k) => Math.round(((k + 1) * T_TRAVEL) / (TRAVEL.length - 1) / 2) * 2);
/** The world's centre when station `k` of the graph sits at the canvas centre. */
const aim = (k: number) => ({ cx: WORLD.w / 2 + W / 2 - nodes[k]!.x, cy: WORLD.h / 2 + H / 2 - nodes[k]!.y });

const camera = new El(reg, { x: 0, y: 0, ...WORLD }, aim(TRAVEL[0]!));
camera.path(0, T_TRAVEL, (t) => {
  const leg = LEG_END.findIndex((end) => t <= end);
  const start = leg === 0 ? 0 : LEG_END[leg - 1]!;
  const u = inOut((t - start) / (LEG_END[leg]! - start));
  const a = aim(TRAVEL[leg]!);
  const z = aim(TRAVEL[leg + 1]!);
  return { cx: lerp(a.cx, z.cx, u), cy: lerp(a.cy, z.cy, u) };
});
camera.set(T_CUT, aim(LAST));

// ── the counter ──────────────────────────────────────────────────────────────

const SEGS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};
/** Segment boxes in a 10×18 cell, two pixels thick. */
const BOX: Record<string, [number, number, number, number]> = {
  a: [2, 0, 6, 2],
  b: [8, 2, 2, 6],
  c: [8, 10, 2, 6],
  d: [2, 16, 6, 2],
  e: [0, 10, 2, 6],
  f: [0, 2, 2, 6],
  g: [2, 8, 6, 2],
};
const digit = (g: string) =>
  `<View class="w-[10px] h-[18px]">${[...SEGS[g]!]
    .map((s) => {
      const [x, y, w, h] = BOX[s]!;
      return `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] bg-[#f8fafc]" />`;
    })
    .join("")}</View>`;
const cells = [1000, 100, 10, 1]
  .map((place) =>
    glyphCell(
      reg,
      Array.from({ length: FRAMES }, (_, f) => [2 * f, String(Math.floor(f / place) % 10)] as [number, string]),
      digit,
      14,
      18,
    ),
  )
  .join("");

// ── write ────────────────────────────────────────────────────────────────────

const world = `${edges.map(([a, b]) => edge(a, b)).join("")}${nodes.map((_, k) => node(k)).join("")}`;

await Bun.write(
  `${OUT}main.tsx`,
  `// GENERATED by compositions/long-track/gen.ts — do not edit by hand.
// Mount-only: the camera and the counter are baked keyframe timelines the core plays.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#020617]">
    ${camera.node(world)}
    <View debugName="counter" class="absolute right-[6px] bottom-[6px] flex-row p-[3px] bg-[#0f172a]">${cells}</View>
  </View>
));
`,
);
await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/long-track/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(reg.keyframes)},
    animation: ${JSON.stringify({ ...reg.animation, ...reg.loops })},
  },
});
`,
);
await Bun.write(
  `${OUT}stations.json`,
  JSON.stringify(
    {
      // what tests/long-track.test.ts reads the camera against: each travel station arrives at the canvas
      // centre on its tick, and the last one on the cut
      canvas: { w: W, h: H },
      arrivals: [
        ...TRAVEL.map((_, k) => ({ node: `station-${k}`, tick: k === 0 ? 0 : LEG_END[k - 1]!, size: 16 })),
        { node: "last-station", tick: T_CUT, size: 28 },
      ],
      cut: T_CUT,
    },
    null,
    2,
  ) + "\n",
);
await Bun.write(
  `${OUT}pocket-motion.json`,
  JSON.stringify(
    {
      motion: 1,
      durationFrames: FRAMES,
      fps: FPS,
      supersample: 1,
      assertions: [
        { node: "counter", inPicture: [0, FRAMES - 1] },
        { node: "last-station", inPicture: [T_CUT / 2, FRAMES - 1] },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`long-track: ${Object.keys(reg.keyframes).length} keyframe sets, ${Object.keys(reg.animation).length} animations`);
