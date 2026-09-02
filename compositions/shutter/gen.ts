#!/usr/bin/env bun
/**
 * Curved slat shutter — a panel that assembles itself out of vertical slats
 * on a surface bulging toward the viewer, then holds while its content fades
 * in. 3840x2160, 5s @ 30fps (150 frames) — the geometry is authored in
 * 1920-space and scaled by K, see below.
 *
 * Every number below was measured off a reference recording rather than
 * eyeballed; `NOTES.md` records what was measured, how, and what the
 * measurement cannot say. The two shapes that matter:
 *
 *   bow    Each row of the panel is scaled horizontally about the centre.
 *          Regressing run-centres row by row against a reference row gave a
 *          slope that fits s(u) = 1.000195 + 0.013744u - 0.023442u^2 for
 *          u in [-1,1] (top..bottom) — a parabola peaking just below middle,
 *          which is what a surface bulging toward the viewer does. It is NOT
 *          barrel distortion: the horizontal displacement is proportional to
 *          distance from the centre, not to the cube of the radius.
 *
 *   wave   The slats do not ease. They snap to hairlines full-height, hold one
 *          frame bare, then a thickening front sweeps top-to-bottom, holds,
 *          and a thinning front sweeps the same way — the whole flash is five
 *          frames. The two end slats never thin: they are what is left
 *          holding the frame. See T below for the measured milliseconds.
 *
 * There is no warp primitive and no mask in this vocabulary, so the curve is
 * geometry or it is nothing. Each slat is SEGS short segments, each ROTATED
 * onto the curve's local tangent — not stacked axis-aligned rectangles. That
 * distinction is the whole quality of the picture: a stack approximates a
 * leaning line with a staircase whose joints are horizontal discontinuities,
 * and no amount of subdivision removes them (100 rows was tried), nor does
 * supersampling — it softens a step into a soft step, and the eye reads the
 * discontinuity, not the edge across it. Rotated, the only residual is
 * chord-vs-curve sagitta, printed on every run and currently 0.04px.
 * Supersampling is still needed, but for the segments' own long edges, which
 * are hard: see SUPERSAMPLE.
 *
 *   bun compositions/shutter/gen.ts
 *   bun vendor/pocketjs/tools/build.ts compositions/shutter/main.tsx \
 *     --outdir=dist/compositions/shutter --framework=solid --density=2 \
 *     --font-regular=assets/fonts/NotoSansSC-Regular.otf \
 *     --font-bold=assets/fonts/NotoSansSC-Bold.otf
 */

const OUT = new URL(".", import.meta.url).pathname;

/** Delivery scale over the 1920x1080 the geometry below is authored in.
 *  K = 2 delivers 3840x2160 from the same 7680x4320 render buffer that
 *  1920x1080 at supersample 4 used — identical cost, four times the delivered
 *  pixels, and one more downscale (the player's) working on the thin lines.
 *  Every constant that reaches a pixel is multiplied by K exactly once, at
 *  its definition, so the design numbers stay comparable to the measurements
 *  in NOTES.md, which are all in 1920-space. */
export const K = 2;
export const VIEW = { w: 1920 * K, h: 1080 * K } as const;
export const FPS = 30;
export const DURATION_MS = 5_000;
export const FRAMES = Math.round((DURATION_MS / 1000) * FPS); // 150

/** Render at N x; `render` area-averages the encode back to the viewport.
 *
 *  This is no longer the composition's anti-aliasing, and for most of its life
 *  it was the only one it had. `draw.rs` computed fractional coverage for
 *  axis-aligned content only; a rotated solid box went through `emit_tri`,
 *  whose op has no coverage field, so every slat edge was binary and the
 *  downscale was the whole of the softness. The core now emits `POLY` for
 *  rotated solid boxes and samples coverage 4x4 over the clipped polygon, so
 *  the edges arrive graded and supersampling only decides how finely.
 *
 *  Measured on the delivered 3840x2160, frame 30, this composition:
 *
 *      supersample 1   22 distinct levels   11.4 ms/frame
 *      supersample 2   68                   40.8 ms/frame
 *
 *  Both put the same amount of ink on a hairline — 9.0-9.2 px against a design
 *  width of 8.8 — so the choice is edge grading, not geometry. 2 is kept
 *  because 22 levels shows visible stepping at this line width; for a longer
 *  piece 1 is 3.6x cheaper and the number is here rather than re-measured.
 *
 *  The build must be passed a matching `--density=`, and every command refuses
 *  the mismatch.
 *  Note the digest covers the SUPERSAMPLED buffer: frame hashes are taken
 *  before the encode leg (src/cli/commands/render.ts), so `trace` here is not
 *  a hash of the delivered pixels. */
export const SUPERSAMPLE = 2;

/** Repo-relative: the sidecar declares these too, and the two must not disagree. */
const FACE_REL = {
  regular: "assets/fonts/NotoSansSC-Regular.otf",
  bold: "assets/fonts/NotoSansSC-Bold.otf",
};

// ── copy ────────────────────────────────────────────────────────────────
// Single-line strings only: this renderer never wraps and never shrinks text,
// so anything that would need a break has to be broken here (see AUTHORING.md
// "Text"). Swap these two lines to re-purpose the card; nothing else depends
// on their content.
const COPY = {
  title: "曲面快门",
  sub: "18 条板条 · 逐帧还原",
} as const;

// ── panel geometry ──────────────────────────────────────────────────────
// Reference frame was 1730x1080 (a 2560x1600 screen). Held proportions:
// panel 60.1% of width, 38.6% of height, centred in x, centre 48.7% down.
const PANEL = {
  cx: 960 * K,
  top: 316 * K,
  bottom: 736 * K,
  halfW: 580 * K, // slat 0 at cx-halfW, slat 17 at cx+halfW
} as const;
const PANEL_H = PANEL.bottom - PANEL.top; // 420

const SLATS = 18;
const PITCH = (PANEL.halfW * 2) / (SLATS - 1); // 68.235
const HAIR = 4.4 * K; // settled hairline, measured 3-4px at 1730 wide
const THICK = 39 * K; // peak comb, measured 35px at 1730 wide

/** Segments per slat.
 *
 *  Each segment is ROTATED to the curve's local tangent, which is what makes
 *  this number small. Stacking axis-aligned rectangles instead — the obvious
 *  construction, and the one this file used first — approximates a leaning
 *  line with a staircase, and no amount of subdivision or supersampling
 *  removes it: every joint is a horizontal discontinuity, and the eye reads
 *  the discontinuity, not the softness of the edge across it. At 100 stacked
 *  rectangles the hairlines still visibly stepped.
 *
 *  Rotated, the only error left is the chord-vs-parabola sagitta,
 *  (1/8)·|x''|·Δ², and x'' here is 6.2e-4 px per px². Over 16 segments of a
 *  420px panel that is 0.05px — a twentieth of a pixel, against a hairline
 *  4.4px wide. 8 would give 0.21px and still be under one. */
const SEGS = 16;

/** Vertical bulge: the panel is taller in the middle than at its ends.
 *  Measured off the rail fit y = 720.7 - 31.7*d^2 (d = dx/halfW), and
 *  corroborated by the comb's top row carrying 13 of 18 slats and its
 *  bottom row 9 of 18. */
const VSAG = 30 * K;

/** Horizontal scale of the row at u (u = -1 top edge, +1 bottom edge). */
function bow(u: number): number {
  return 1.000195 + 0.013744 * u - 0.023442 * u * u;
}

/** d(bow)/du — the tangent each segment is rotated onto. */
function bowSlope(u: number): number {
  return 0.013744 - 2 * 0.023442 * u;
}

/** `rotate-N` parses a non-negative plain number only (`plainNum`), so a
 *  leftward lean is expressed as its positive coterminal angle. */
function rotateClass(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return `rotate-${d.toFixed(3)}`;
}

/** Unbowed centre of slat k. */
function slatX(k: number): number {
  return PANEL.cx - PANEL.halfW + k * PITCH;
}

/** This slat's own vertical span: the ends pull in as |dx| grows. */
function slatSpan(k: number): { top: number; bottom: number } {
  const d = (slatX(k) - PANEL.cx) / PANEL.halfW;
  const inset = VSAG * d * d;
  return { top: PANEL.top + inset, bottom: PANEL.bottom - inset };
}

// ── timeline (ms) ───────────────────────────────────────────────────────
// Reference cadence at 29.6fps, re-expressed in ms: rail wipe 4 frames,
// seed slats 4 frames, the whole comb flash 5 frames (~170ms). Nothing here
// is eased into place — the source cuts.
const T = {
  railIn: 300,
  railDur: 150,
  railOut: 440,
  seedIn: 455,
  seedOut: 590, // clears before the comb gates in, or both paint the same frame
  comb: 600, // the hairlines gate in, full height, all at once
  // …and only then does the thickening start. The reference spends one whole
  // frame on bare hairlines before the front moves; folding the two together
  // loses that frame, which is a sixth of the whole flash.
  combStart: 634,
  combRise: 34, // one frame at 30fps: the local thicken
  combHold: 100, // three frames of full comb, as the reference holds
  combFall: 34,
  combWipe: 33, // top-to-bottom travel of the front
  contentIn: 1150,
  contentDur: 420,
} as const;
const COMB_DUR = T.combRise + T.combHold + T.combFall; // 170

// ── keyframe / animation registries ─────────────────────────────────────
const keyframes: Record<string, Record<string, Record<string, string>>> = {};
const animation: Record<string, string> = {};

// Shared channels, declared once rather than lazily by whichever helper runs
// first: `dim` is used by slatCycle and `gin` by three callers, so registering
// them on first use makes the config depend on emit order.
keyframes["gin"] = { from: { opacity: "0" }, to: { opacity: "1" } };
keyframes["gout"] = { from: { opacity: "1" }, to: { opacity: "0" } };
// The reference drops the settled hairlines well below the walls once the
// content arrives. That was a backgroundColor animation on each core until the
// ramps arrived: `gradFrom`/`gradTo` are not in the compiler's KEYFRAME_PROPS,
// so a ramp would have stayed white around a dimmed core, and the fix was to
// dim a wrapper instead. The ramps are gone and the constraint with them; the
// wrapper stays because one animation beats 288.
keyframes["dim"] = { from: { opacity: "1" }, to: { opacity: "0.36" } };
animation["dimwrap"] = `dim 260ms linear ${1150 - 120}ms both`;

/** A step gate: nothing before `at`, fully painted after it. One frame wide,
 *  because a baked opacity channel overrides the static record for the node's
 *  whole life — so "invisible until now" has to be in the animation itself. */
function gate(at: number, until?: number): string {
  const n = until === undefined ? `g${at}` : `g${at}_${until}`;
  animation[n] =
    until === undefined
      ? `gin 34ms linear ${at}ms both`
      : `gin 34ms linear ${at}ms both, gout 34ms linear ${until}ms forwards`;
  return n;
}

/** hair -> thick -> hair for one row, holding thick across the middle.
 *  `width` alone would grow the segment to the right, so translateX carries
 *  it back by half the growth and the slat stays centred on its own axis. */
function slatCycle(hair: number, thick: number, delay: number): string {
  const key = `sc${hair.toFixed(2)}_${thick.toFixed(2)}`.replace(/\./g, "");
  const p1 = ((T.combRise / COMB_DUR) * 100).toFixed(3);
  const p2 = (((T.combRise + T.combHold) / COMB_DUR) * 100).toFixed(3);
  keyframes[key] ??= {
    from: { width: `${hair.toFixed(2)}px`, translateX: "0px" },
    [`${p1}%,${p2}%`]: {
      width: `${thick.toFixed(2)}px`,
      translateX: `${(-(thick - hair) / 2).toFixed(2)}px`,
    },
    to: { width: `${hair.toFixed(2)}px`, translateX: "0px" },
  };
  const n = `${key}_${Math.round(delay)}`;
  animation[n] =
    `${key} ${COMB_DUR}ms linear ${T.combStart + delay}ms both, ` +
    `gin 34ms linear ${T.comb}ms both`;
  return n;
}


/** hair -> thick, and stay: the two end slats, which never thin back. */
function wallCycle(hair: number, thick: number, delay: number): string {
  const key = `wc${hair.toFixed(2)}_${thick.toFixed(2)}`.replace(/\./g, "");
  keyframes[key] ??= {
    from: { width: `${hair.toFixed(2)}px`, translateX: "0px" },
    to: {
      width: `${thick.toFixed(2)}px`,
      translateX: `${(-(thick - hair) / 2).toFixed(2)}px`,
    },
  };
  const n = `${key}_${Math.round(delay)}`;
  animation[n] = `${key} ${T.combRise}ms linear ${T.combStart + delay}ms both, gin 34ms linear ${T.comb}ms both`;
  return n;
}

/** A rail tick widening into its neighbour, so a comb becomes a solid bar. */
function railTick(w: number, delay: number): string {
  const key = `rt${w.toFixed(2)}`.replace(/\./g, "");
  keyframes[key] ??= {
    from: { width: `${1.4 * K}px`, translateX: "0px" },
    to: { width: `${w.toFixed(2)}px`, translateX: `${(-(w - 1.4 * K) / 2).toFixed(2)}px` },
  };
  const n = `${key}_${Math.round(delay)}`;
  animation[n] =
    `${key} 120ms cubic-bezier(0.2,0,0,1) ${T.railIn + delay}ms both, ` +
    `gin 34ms linear ${T.railIn + delay}ms both, gout 60ms linear ${T.railOut}ms forwards`;
  return n;
}

// ── emit: the slat field ────────────────────────────────────────────────
// One rotated segment per SEGS, centred on the curve and leaning along it,
// one flat node each. Until the core learned `POLY` these were three nodes —
// a gradient ramp on either side of the solid core, painting the coverage the
// rasteriser would not compute. That put 12.00 px of ink on a hairline whose
// measured width is 8.80; the ramps were adding a third of the line. Coverage
// puts 9.0-9.2 there and varies with sub-pixel position, which a fixed-width
// ramp cannot do.
let maxSag = 0;
let maxLean = 0;
const slatNodes: string[] = [];
const wallNodes: string[] = [];

for (let k = 0; k < SLATS; k++) {
  const isWall = k === 0 || k === SLATS - 1;
  const span = slatSpan(k);
  const segSpan = (span.bottom - span.top) / SEGS;
  const dx = slatX(k) - PANEL.cx;
  const halfH = PANEL_H / 2;
  const panelCy = PANEL.top + halfH;
  const into = isWall ? wallNodes : slatNodes;

  for (let j = 0; j < SEGS; j++) {
    const yc = span.top + (j + 0.5) * segSpan;
    const u = (yc - panelCy) / halfH;
    const s = bow(u);
    const cxr = PANEL.cx + dx * s;
    const hair = HAIR * s;
    const thick = THICK * s;

    const dxdy = (dx * bowSlope(u)) / halfH;
    const lean = Math.atan(dxdy);
    maxLean = Math.max(maxLean, Math.abs((lean * 180) / Math.PI));
    const d2 = (dx * -2 * 0.023442) / (halfH * halfH);
    maxSag = Math.max(maxSag, (Math.abs(d2) * segSpan * segSpan) / 8);

    const len = segSpan / Math.cos(lean) + 1.2 * K;
    const rot = rotateClass((-lean * 180) / Math.PI);
    const top = (yc - len / 2).toFixed(2);
    const h = len.toFixed(2);

    const frac = (yc - PANEL.top) / PANEL_H;
    const delay = frac * T.combWipe;
    const core = isWall ? wallCycle(hair, thick, delay) : slatCycle(hair, thick, delay);

    into.push(
      `      <View class="absolute left-[${(cxr - hair / 2).toFixed(2)}px] top-[${top}px] ` +
        `w-[${hair.toFixed(2)}px] h-[${h}px] ${rot} bg-[#ffffff] animate-${core}" />`,
    );
  }
}

// ── emit: the seed slats that precede the comb ──────────────────────────
// Reference showed a tight cluster of thick bars near the centre for four
// frames before the full row arrived: 5-6 runs of 34px inside 208px at 1730
// wide, so they sit at their OWN pitch (~42px, tighter than the slat grid's
// 61px) rather than on it. Same bow, no cycle — they gate in and out.
const SEEDS = 6;
const SEED_PITCH = 46.2 * K; // 41.6px at 1730 wide
const SEED_W = 37.8 * K; // 34px at 1730 wide
const seedNodes: string[] = [];
for (let i = 0; i < SEEDS; i++) {
  const seedX = PANEL.cx + (i - (SEEDS - 1) / 2) * SEED_PITCH;
  const span = { top: PANEL.top + 2, bottom: PANEL.bottom - 2 };
  const rowH = (span.bottom - span.top) / SEGS;
  const dx = seedX - PANEL.cx;
  const anim = gate(T.seedIn, T.seedOut);
  for (let r = 0; r < SEGS; r++) {
    const y = span.top + r * rowH;
    const u = (y + rowH / 2 - (PANEL.top + PANEL_H / 2)) / (PANEL_H / 2);
    const s = bow(u);
    const cxr = PANEL.cx + dx * s;
    const w = SEED_W * s;
    seedNodes.push(
      `      <View class="absolute left-[${(cxr - w / 2).toFixed(2)}px] top-[${y.toFixed(2)}px] ` +
        `w-[${w.toFixed(2)}px] h-[${(rowH + 0.6).toFixed(2)}px] bg-[#ffffff] animate-${anim}" />`,
    );
  }
}

// ── emit: the rail ──────────────────────────────────────────────────────
// The panel's own bottom edge, arriving as a comb of ticks that merge into a
// solid bar left to right. Measured: y = 720.7 - 31.7*(dx/halfW)^2.
const RAIL_TICKS = 64;
const railNodes: string[] = [];
for (let i = 0; i < RAIL_TICKS; i++) {
  const f = i / (RAIL_TICKS - 1);
  const x = PANEL.cx - PANEL.halfW + f * PANEL.halfW * 2;
  const d = (x - PANEL.cx) / PANEL.halfW;
  const y = PANEL.bottom - VSAG * d * d;
  const w = (PANEL.halfW * 2) / (RAIL_TICKS - 1);
  const anim = railTick(w, f * T.railDur);
  railNodes.push(
    `      <View class="absolute left-[${(x - 0.7).toFixed(2)}px] top-[${y.toFixed(2)}px] ` +
      `w-[${(1.4 * K).toFixed(2)}px] h-[${14 * K}px] bg-[#ffffff] animate-${anim}" />`,
  );
}

// ── emit: the content the panel was assembled to hold ────────────────────
keyframes["crise"] ??= {
  from: { translateY: `${14 * K}px`, opacity: "0" },
  to: { translateY: "0px", opacity: "1" },
};
animation["cin"] = `crise ${T.contentDur}ms cubic-bezier(0.2,0,0,1) ${T.contentIn}ms both`;
animation["cin2"] = `crise ${T.contentDur}ms cubic-bezier(0.2,0,0,1) ${T.contentIn + 120}ms both`;

const jsx = (s: string) => JSON.stringify(s);

const content = `      <View class="absolute left-[${PANEL.cx - 400 * K}px] top-[${PANEL.top + 150 * K}px] w-[${800 * K}px] flex-col items-center gap-[${16 * K}px]">
        <Text class="text-[${76 * K}px] font-bold text-[#ffffff] animate-cin">{${jsx(COPY.title)}}</Text>
        <Text class="text-[${26 * K}px] text-[#9aa3ad] tracking-wide animate-cin2">{${jsx(COPY.sub)}}</Text>
      </View>`;

// ── assemble ────────────────────────────────────────────────────────────
const main = `// GENERATED by compositions/shutter/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#000000]">
    <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px]">
${railNodes.join("\n")}
${seedNodes.join("\n")}
      <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px] animate-dimwrap">
${slatNodes.join("\n")}
      </View>
${wallNodes.join("\n")}
${content}
    </View>
  </View>
));
`;

await Bun.write(`${OUT}main.tsx`, main);

const config = `// GENERATED by compositions/shutter/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(keyframes, null, 6).replace(/\n/g, "\n  ")},
    animation: ${JSON.stringify(animation, null, 6).replace(/\n/g, "\n  ")},
  },
});
`;
await Bun.write(`${OUT}pocket.config.ts`, config);

await Bun.write(
  `${OUT}pocket-motion.json`,
  JSON.stringify(
    { motion: 1, durationFrames: FRAMES, fps: FPS, supersample: SUPERSAMPLE, fonts: FACE_REL },
    null,
    2,
  ) + "\n",
);

// What the segmentation costs, printed rather than assumed: how far a chord
// departs from the curve it replaces. Under a tenth of a pixel it cannot be
// what anyone is looking at, and the number says so on every run.
console.log(
  `shutter: ${slatNodes.length + wallNodes.length + seedNodes.length + railNodes.length} nodes ` +
    `(${SLATS} slats x ${SEGS} rotated segments` +
    ` + ${seedNodes.length} seed + ${RAIL_TICKS} rail)\n` +
    `         ${Object.keys(keyframes).length} keyframe set(s), ${Object.keys(animation).length} animation(s)\n` +
    `         ${FRAMES} frames · ${(DURATION_MS / 1000).toFixed(1)}s @ ${FPS}fps\n` +
    `         max lean ${maxLean.toFixed(1)}deg · worst chord-vs-curve error ` +
    `${maxSag.toFixed(3)}px (hairline is ${HAIR}px)`,
);
