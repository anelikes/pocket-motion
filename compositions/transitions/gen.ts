#!/usr/bin/env bun
/**
 * transitions — nine ways from scene A to scene B, one after another, each
 * ported from a transition in the HyperFrames catalog and re-expressed as
 * baked timelines over two placeholder scenes. 1920x1080, 30fps.
 *
 * Each segment holds A, plays the transition, holds B, and cuts to the next
 * segment. The timings and eases are the catalog's, read off its sources
 * (`NOTES.md` states each); what could not be carried over is stated there
 * too — every one of them is a blur or a mask.
 *
 * Two of the nine are "flat" ports: the catalog's iris and halftone reveal B
 * THROUGH a growing clip, which is a mask this rasteriser does not have.
 * Here the growing shape is B's own ground colour, and B's content fades in
 * once the ground has covered the frame — the same picture when B is a flat
 * card, a different one when B is a photograph.
 *
 *   bun compositions/transitions/gen.ts
 *   bun src/cli/main.ts build compositions/transitions
 */

const OUT = new URL(".", import.meta.url).pathname;

export const VIEW = { w: 1920, h: 1080 } as const;
export const FPS = 30;
export const SUPERSAMPLE = 1;

const px = (v: number) => `${v.toFixed(2)}px`;
const jsx = (s: string) => JSON.stringify(s);

// GSAP's named eases as the beziers the compiler bakes
const E = {
  power2in: "cubic-bezier(0.32,0,0.67,0)",
  power2out: "cubic-bezier(0.33,1,0.68,1)",
  power2inOut: "cubic-bezier(0.65,0,0.35,1)",
  power3out: "cubic-bezier(0.22,1,0.36,1)",
  power3inOut: "cubic-bezier(0.66,0,0.34,1)",
  power4in: "cubic-bezier(0.5,0,0.75,0)",
  power4out: "cubic-bezier(0.25,1,0.5,1)",
  backOut: "cubic-bezier(0.34,1.56,0.64,1)",
  sineInOut: "cubic-bezier(0.37,0,0.63,1)",
} as const;

// ── registry ────────────────────────────────────────────────────────────
const keyframes: Record<string, Record<string, Record<string, string>>> = {
  gin: { from: { opacity: "0" }, to: { opacity: "1" } },
  gout: { from: { opacity: "1" }, to: { opacity: "0" } },
};
const animation: Record<string, string> = {};
let n = 0;
const anim = (value: string): string => {
  const name = `a${n++}`;
  animation[name] = value;
  return name;
};
const gate = (from: number, until?: number): string =>
  until === undefined ? `gin 17ms linear ${from}ms both` : `gin 17ms linear ${from}ms both, gout 17ms linear ${until}ms forwards`;
/** A keyframe set registered once per distinct shape, named from its content. */
function kf(prefix: string, frames: Record<string, Record<string, string>>): string {
  const key = `${prefix}_${JSON.stringify(frames).replace(/[^a-z0-9]/gi, "").slice(0, 40)}`;
  keyframes[key] ??= frames;
  return key;
}
const tween = (from: Record<string, string>, to: Record<string, string>, dur: number, ease: string, delay: number, fill = "both") =>
  `${kf("t", { from, to })} ${dur}ms ${ease} ${delay}ms ${fill}`;

// ── the two scenes ──────────────────────────────────────────────────────
// Scene A: slate, a title and three rounded rows. Scene B: teal-to-green,
// a title and a two-column layout. Full frame, so a transition has an edge
// to leave by and the whole canvas to cover.
const A_BG = "bg-gradient-to-r from-[#0f172a] to-[#334155]";
const B_BG = "bg-gradient-to-r from-[#155e75] to-[#10b981]";
const B_FLAT = "#127a6f";

function scene(which: "A" | "B", cls = "", extra = ""): string {
  const bg = which === "A" ? A_BG : B_BG;
  const label = which === "A" ? "Dashboard" : "Analytics";
  const rows =
    which === "A"
      ? [
          `<View class="absolute left-[160px] top-[380px] w-[1600px] h-[120px] rounded-[24px] bg-[#ffffff1f]" />`,
          `<View class="absolute left-[160px] top-[540px] w-[1600px] h-[120px] rounded-[24px] bg-[#ffffff17]" />`,
          `<View class="absolute left-[160px] top-[700px] w-[1100px] h-[120px] rounded-[24px] bg-[#ffffff12]" />`,
        ]
      : [
          `<View class="absolute left-[160px] top-[380px] w-[760px] h-[440px] rounded-[24px] bg-[#ffffff1f]" />`,
          `<View class="absolute left-[1000px] top-[380px] w-[760px] h-[200px] rounded-[24px] bg-[#ffffff17]" />`,
          `<View class="absolute left-[1000px] top-[620px] w-[760px] h-[200px] rounded-[24px] bg-[#ffffff12]" />`,
        ];
  return `        <View class="absolute left-0 top-0 w-[1920px] h-[1080px] ${bg} ${cls}">
          <View class="absolute left-[160px] top-[200px] px-[28px] py-[12px] rounded-[999px] bg-[#ffffff24]"><Text class="text-[40px] font-bold text-[#ffffff]">{${jsx(label)}}</Text></View>
          ${rows.join("\n          ")}
${extra}
        </View>`;
}

// ── segments ────────────────────────────────────────────────────────────
const HOLD_A = 400;
const SEG = 2800;
const segments: Array<{ name: string; body: (t0: number) => string }> = [];
const caption = (name: string) =>
  `        <View class="absolute left-[60px] top-[40px] px-[20px] py-[8px] rounded-[10px] bg-[#000000a0]"><Text class="text-[26px] font-bold text-[#e6e6e6]">{${jsx(name)}}</Text></View>`;

// 1. cut-the-curve: the outgoing accelerates power4.in over the first third,
//    swaps at peak velocity, the incoming continues in the same direction
//    with power4.out. Distance 34% of the width; entry distance scaled by
//    the time ratio so the velocities match at the seam. Blur omitted.
segments.push({
  name: "cut-the-curve",
  body: (t0) => {
    const D = 1000, CUT = D * 0.33, ENTRY = D - CUT;
    const dist = 0.34 * VIEW.w, entry = dist * (ENTRY / CUT);
    const s = t0 + HOLD_A;
    const outA = anim(
      `${tween({ translateX: "0px", opacity: "1" }, { translateX: px(-dist), opacity: "0.72" }, CUT, E.power4in, s)}, gout 17ms linear ${s + CUT}ms forwards`,
    );
    // B sits off screen at 0.72 before the cut; the gate that hides it until
    // then is on a wrapper, because two animations on one node's opacity
    // resolve to the later one in the list and the fill of the tween would
    // otherwise show B early.
    const inB = anim(tween({ translateX: px(entry), opacity: "0.72" }, { translateX: "0px", opacity: "1" }, ENTRY, E.power4out, s + CUT));
    const gB = anim(gate(s + CUT));
    return `        <View class="absolute left-0 top-0 w-[1920px] h-[1080px] animate-${gB}">
${scene("B", `animate-${inB}`)}
        </View>
${scene("A", `animate-${outA}`)}`;
  },
});

// 2. directional-wipe: B is revealed by a clip from the left over 800ms
//    power3.inOut while sliding 60px→0 and settling 1.04→1; A shrinks to
//    0.96 under it; a light band sweeps across; the catalog's one-frame RGB
//    flash at the seam is omitted with its blur.
segments.push({
  name: "directional-wipe",
  body: (t0) => {
    const PUSH = 800, s = t0 + HOLD_A;
    const win = anim(tween({ width: "0px" }, { width: px(VIEW.w) }, PUSH, E.power3inOut, s));
    const inner = anim(tween({ translateX: "60px", scale: "1.04" }, { translateX: "0px", scale: "1" }, PUSH, E.power3inOut, s));
    const from = anim(tween({ scale: "1" }, { scale: "0.96" }, PUSH, E.power3inOut, s));
    const fx = anim(tween({ translateX: px(-1.1 * VIEW.w) }, { translateX: px(1.1 * VIEW.w) }, 580, E.power2inOut, s + 100));
    return `${scene("A", `animate-${from}`)}
        <View class="absolute left-0 top-0 w-[0px] h-[1080px] overflow-hidden animate-${win}">
${scene("B", `animate-${inner}`)}
        </View>
        <View class="absolute left-0 top-0 w-[1920px] h-[1080px] animate-${fx}">
          <View class="absolute left-[660px] top-0 w-[300px] h-[1080px] bg-gradient-to-r from-[#ffffff00] to-[#ffffffb0]" />
          <View class="absolute left-[960px] top-0 w-[300px] h-[1080px] bg-gradient-to-r from-[#ffffffb0] to-[#ffffff00]" />
        </View>`;
  },
});

// 3. fade-through: A fades out into a paper wash, the wash fades out over B.
segments.push({
  name: "fade-through",
  body: (t0) => {
    const s = t0 + HOLD_A;
    const outA = anim(`gout 350ms ${E.power2in} ${s}ms both`);
    const wash = anim(`gin 350ms ${E.power2out} ${s}ms both, gout 450ms ${E.power2in} ${s + 350}ms forwards`);
    const inB = anim(`gin 450ms ${E.power2out} ${s + 300}ms both`);
    return `${scene("B", `animate-${inB}`)}
${scene("A", `animate-${outA}`)}
        <View class="absolute left-0 top-0 w-[1920px] h-[1080px] bg-[#f8f5ec] animate-${wash}" />`;
  },
});

// 4. grid-pixelate-wipe: 16x9 cells pop in over A with a diagonal stagger
//    until the frame is covered, A cuts to B underneath, and the cells pop
//    out in the same order.
segments.push({
  name: "grid-pixelate-wipe",
  body: (t0) => {
    const COLS = 16, ROWS = 9, cw = VIEW.w / COLS, ch = VIEW.h / ROWS;
    const s = t0 + HOLD_A, STEP = 28, POP = 220;
    const coverAt = s + (COLS + ROWS - 2) * STEP + POP;
    const cells: string[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const d = (r + c) * STEP;
        const a = anim(`${tween({ scale: "0" }, { scale: "1" }, POP, E.power2out, s + d)}, ${tween({ scale: "1" }, { scale: "0" }, POP, E.power2in, coverAt + 120 + d, "forwards")}`);
        cells.push(`        <View class="absolute left-[${px(c * cw)}] top-[${px(r * ch)}] w-[${px(cw + 1)}] h-[${px(ch + 1)}] bg-[#0b0b0f] animate-${a}" />`);
      }
    const a = anim(gate(t0, coverAt + 60));
    const b = anim(gate(coverAt + 60));
    return `${scene("B", `animate-${b}`)}\n${scene("A", `animate-${a}`)}\n${cells.join("\n")}`;
  },
});

// 5. match-cut: A's circle grows 0.54→0.64 over 450ms power3.out, then to 1
//    over 950ms power4.in; hard cut at 1400ms; B's circle settles 1→0.74
//    over 650ms power4.out while B's copy rises in.
segments.push({
  name: "match-cut",
  body: (t0) => {
    const s = t0 + 100, CUT = 1400, R = 520;
    const circA = anim(`${tween({ scale: "0.54" }, { scale: "0.64" }, 450, E.power3out, s)}, ${tween({ scale: "0.64" }, { scale: "1" }, CUT - 450, E.power4in, s + 450, "forwards")}`);
    const circB = anim(tween({ scale: "1" }, { scale: "0.74" }, 650, E.power4out, s + CUT));
    const a = anim(gate(t0, s + CUT));
    const b = anim(gate(s + CUT));
    const copy = anim(`${tween({ translateY: "26px", opacity: "0" }, { translateY: "0px", opacity: "1" }, 550, E.power3out, s + CUT + 100)}`);
    const circle = (cls: string, a: string) =>
      `          <View class="absolute left-[${px(960 - R)}] top-[${px(540 - R)}] w-[${px(2 * R)}] h-[${px(2 * R)}] rounded-full ${cls} animate-${a}" />`;
    return `        <View class="absolute left-0 top-0 w-[1920px] h-[1080px] bg-[#0b0f14] animate-${a}">
${circle("bg-[#4ade80]", circA)}
          <View class="absolute left-[160px] top-[200px]"><Text class="text-[40px] font-bold text-[#ffffff]">{"Start"}</Text></View>
        </View>
        <View class="absolute left-0 top-0 w-[1920px] h-[1080px] ${B_BG} animate-${b}">
${circle("bg-[#0b0f14]", circB)}
          <View class="absolute left-[160px] top-[200px] animate-${copy}"><Text class="text-[40px] font-bold text-[#ffffff]">{"Done"}</Text></View>
        </View>`;
  },
});

// 6. rubber-band-bumper: A pulls left against resistance in five equal
//    steps (5, 8.5, 10.5, 11.75, 12.25% of the width), each power2.out,
//    then snaps to −112% with back.out(1.7) over 84% of the release while
//    B settles in from −5%, scale 0.985 and opacity 0.82, with the same
//    overshoot. The accent bands stretch with the pull and let go.
segments.push({
  name: "rubber-band-bumper",
  body: (t0) => {
    const IN = 1250, OUTD = 950, s = t0 + 100;
    const pulls = [5, 8.5, 10.5, 11.75, 12.25];
    const seg = IN / pulls.length;
    const W = VIEW.w;
    const frames: Record<string, Record<string, string>> = { from: { translateX: "0px" } };
    const total = IN + OUTD * 0.84;
    pulls.forEach((p, i) => { frames[`${(((i + 1) * seg) / total * 100).toFixed(3)}%`] = { translateX: px(-(p / 100) * W) }; });
    frames.to = { translateX: px(-1.12 * W) };
    // the pull steps are power2.out each; the snap is back.out — two
    // animations, the second starting where the first ends
    const pullKf = kf("pull", Object.fromEntries(Object.entries(frames).filter(([k]) => k !== "to")) as Record<string, Record<string, string>>);
    keyframes[pullKf]![`to`] = { translateX: px(-(pulls[pulls.length - 1]! / 100) * W) };
    const outA = anim(
      `${pullKf} ${IN}ms ${E.power2out} ${s}ms both, ` +
        `${tween({ translateX: px(-(12.25 / 100) * W) }, { translateX: px(-1.12 * W) }, OUTD * 0.84, E.backOut, s + IN, "forwards")}`,
    );
    const inB = anim(tween({ translateX: px(-0.05 * W), scale: "0.985", opacity: "0.82" }, { translateX: "0px", scale: "1", opacity: "1" }, OUTD * 0.78, E.backOut, s + IN));
    const bands: string[] = [];
    for (let i = 0; i < 3; i++) {
      const bw = kf("band", { from: { width: "8px", opacity: "0.7" }, to: { width: px(8 + (12.25 / 14) * 100 * 4), opacity: "0.7" } });
      const ba = anim(`${bw} ${IN}ms ${E.power2out} ${s}ms both, gout ${OUTD * 0.28}ms ${E.power4out} ${s + IN}ms forwards`);
      bands.push(`        <View class="absolute left-[1910px] top-[${px(300 + i * 200)}] w-[8px] h-[80px] rounded-[4px] bg-[#6ee7b7] animate-${ba}" />`);
    }
    return `${scene("B", `animate-${inB}`)}\n${scene("A", `animate-${outA}`)}\n${bands.join("\n")}`;
  },
});

// 7. whip-pan-cut: A and B side by side on one strip that whips left by a
//    full width over 550ms power3.inOut; the cut is the midpoint. The
//    catalog caps a directional blur at the peak; here three echoes of the
//    strip trail it at one, two and three ticks behind, fading, which is
//    what a blur reads as at this speed.
segments.push({
  name: "whip-pan-cut",
  body: (t0) => {
    const s = t0 + HOLD_A, WHIP = 550;
    const strips: string[] = [];
    for (const [lag, op] of [[51, 0.18], [34, 0.28], [17, 0.45], [0, 1]] as const) {
      // an echo carries its opacity inside its own timeline: there is no
      // arbitrary opacity utility, and a constant is a flat keyframe
      const a = anim(
        `${tween({ translateX: "0px", opacity: `${op}` }, { translateX: px(-VIEW.w), opacity: `${op}` }, WHIP, E.power3inOut, s + lag)}` +
          (lag ? `, gout 17ms linear ${s + WHIP + lag}ms forwards` : ""),
      );
      strips.push(`        <View class="absolute left-0 top-0 w-[3840px] h-[1080px] animate-${a}">
${scene("A")}
          <View class="absolute left-[1920px] top-0 w-[1920px] h-[1080px]">
${scene("B")}
          </View>
        </View>`);
    }
    return strips.join("\n");
  },
});

// 8. iris-reveal (flat): B's ground grows as a circle from a point off
//    centre over 1100ms power2.inOut to a radius that clears the far corner,
//    with a rim ring on its edge; B's content fades in once covered.
segments.push({
  name: "iris-reveal (flat)",
  body: (t0) => {
    const s = t0 + HOLD_A, OPEN = 1100;
    const cx = 700, cy = 620;
    const far = Math.hypot(Math.max(cx, VIEW.w - cx), Math.max(cy, VIEW.h - cy));
    const R = far + 8;
    const grow = anim(tween({ scale: "0.001" }, { scale: "1" }, OPEN, E.power2inOut, s));
    const rim = anim(`${tween({ scale: "0.001" }, { scale: "1" }, OPEN, E.power2inOut, s)}, gin 180ms ${E.power2out} ${s}ms both, gout 240ms ${E.power2in} ${s + OPEN - 240}ms forwards`);
    const content = anim(`gin 300ms ${E.power2out} ${s + OPEN - 100}ms both`);
    return `${scene("A")}
        <View class="absolute left-[${px(cx - R)}] top-[${px(cy - R)}] w-[${px(2 * R)}] h-[${px(2 * R)}] rounded-full bg-[${B_FLAT}] animate-${grow}" />
        <View class="absolute left-[${px(cx - R)}] top-[${px(cy - R)}] w-[${px(2 * R)}] h-[${px(2 * R)}] rounded-full bg-[#6ee7b7] arc-start-[0] arc-sweep-[360] arc-width-[10] animate-${rim}" />
${scene("B", `animate-${content}`)}`;
  },
});

// 9. halftone-dissolve (flat): dots on a fixed grid grow smallest-first from
//    the left with a seeded jitter until they merge into B's ground; B's
//    content fades in over the merged field.
segments.push({
  name: "halftone-dissolve (flat)",
  body: (t0) => {
    const s = t0 + HOLD_A, CELL = 80, GROW = 420, SPAN = 900;
    const cols = Math.ceil(VIEW.w / CELL) + 1, rows = Math.ceil(VIEW.h / CELL) + 1;
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const dots: string[] = [];
    const D = CELL * 1.5; // the diameter that makes neighbours overlap
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = (c + (r % 2 === 0 ? 0.25 : 0.75)) * CELL, y = (r + 0.5) * CELL;
        const th = Math.max(0, Math.min(1, x / VIEW.w + (rnd() - 0.5) * 0.22));
        const a = anim(tween({ scale: "0" }, { scale: "1" }, GROW, E.power2out, s + th * SPAN));
        dots.push(`        <View class="absolute left-[${px(x - D / 2)}] top-[${px(y - D / 2)}] w-[${px(D)}] h-[${px(D)}] rounded-full bg-[${B_FLAT}] animate-${a}" />`);
      }
    const content = anim(`gin 300ms ${E.power2out} ${s + SPAN + GROW - 150}ms both`);
    return `${scene("A")}\n${dots.join("\n")}\n${scene("B", `animate-${content}`)}`;
  },
});

// ── assemble ────────────────────────────────────────────────────────────
const body: string[] = [];
segments.forEach((sg, i) => {
  const t0 = i * SEG;
  const g = anim(gate(t0, i < segments.length - 1 ? t0 + SEG : undefined));
  body.push(`      <View class="absolute left-0 top-0 w-[1920px] h-[1080px] animate-${g}">\n${sg.body(t0)}\n${caption(sg.name)}\n      </View>`);
});
export const DURATION_MS = segments.length * SEG;
export const FRAMES = Math.round((DURATION_MS / 1000) * FPS);

await Bun.write(
  `${OUT}main.tsx`,
  `// GENERATED by compositions/transitions/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#0b0f14]">
    <View class="absolute left-0 top-0 w-[1920px] h-[1080px]">
${body.join("\n")}
    </View>
  </View>
));
`,
);
await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/transitions/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(keyframes, null, 6).replace(/\n/g, "\n  ")},
    animation: ${JSON.stringify(animation, null, 6).replace(/\n/g, "\n  ")},
  },
});
`,
);
await Bun.write(
  `${OUT}pocket-motion.json`,
  JSON.stringify({ motion: 1, durationFrames: FRAMES, fps: FPS, supersample: SUPERSAMPLE }, null, 2) + "\n",
);
console.log(`transitions: ${segments.length} segments, ${Object.keys(keyframes).length} keyframe sets, ${Object.keys(animation).length} animations, ${FRAMES} frames (${(DURATION_MS / 1000).toFixed(1)}s)`);
