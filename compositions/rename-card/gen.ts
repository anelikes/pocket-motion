#!/usr/bin/env bun
/**
 * rename-card — six seconds of a game's rename dialog, taken off a screen
 * recording frame by frame: a curved slat shutter assembles the dialog, a name
 * is typed into it, and the dialog collapses through a pair of arcs into a bar,
 * the bar into a square, and the square blinks out. 1920x1080, 6s @ 30fps.
 *
 * The opening (0–1150ms) is `compositions/shutter`'s geometry, whose every
 * number was measured off the same recording (its NOTES.md says how). What
 * this file adds — the dialog, the typing and the close — was measured off a
 * 1152x720 copy of the same recording; `NOTES.md` beside this file records
 * each reading and what it does not say. Reference coordinates below are in
 * that 1152x720 frame and map to the canvas by 1920/1152 in x and 1080/720
 * in y, the proportions shutter already holds.
 *
 * Three things this composition exercises that the fixtures do not together:
 *
 *   - the arc primitive (`arc-start` / `arc-sweep` / `arc-width`) as a stroke
 *     rather than a spinner, mirrored, at two radii;
 *   - a typed string, which is a measured caret: every prefix of the name is
 *     its own gated Text node and the caret sits at that prefix's measured
 *     width, so the caret cannot drift from the glyphs it follows;
 *   - one-tick step gates (17ms at 60Hz), because the reference cuts between
 *     states and a 34ms gate sampled at 30fps lands on its own midpoint —
 *     every state arrives one frame late and half grey.
 *
 *   bun compositions/rename-card/gen.ts
 *   bun src/cli/main.ts build compositions/rename-card
 */

import { existsSync } from "node:fs";
import { openMeasurer } from "../../src/text/measure.ts";

const OUT = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url).pathname;

export const VIEW = { w: 1920, h: 1080 } as const;
export const FPS = 30;
export const DURATION_MS = 6_000;
export const FRAMES = Math.round((DURATION_MS / 1000) * FPS); // 180
/** 2, as shutter: the slats are rotated hairlines and 1x shows 22 levels of
 *  stepping on them. The build must be passed `--density=2`, and the
 *  measurement build below is verified to carry the same density. */
export const SUPERSAMPLE = 2;

const FACE_REL = {
  regular: "assets/fonts/NotoSansSC-Regular.otf",
  bold: "assets/fonts/NotoSansSC-Bold.otf",
};

// reference frame (1152x720) -> canvas
const RX = VIEW.w / 1152;
const RY = VIEW.h / 720;
const rx = (x: number) => x * RX;
const ry = (y: number) => y * RY;
const px = (v: number) => `${v.toFixed(2)}px`;
const jsx = (s: string) => JSON.stringify(s);

// ── the name that gets typed ─────────────────────────────────────────────
const NAME = "pocket motion";
const NAME_PX = 16;
const TYPE_START = 1900; // ms; the dialog has landed by 1684 and the reference holds until 3797
const TYPE_STEP = 90; // ms per character

// ── panel geometry (shutter, unchanged) ─────────────────────────────────
const PANEL = { cx: 960, top: 316, bottom: 736, halfW: 580 } as const;
const PANEL_H = PANEL.bottom - PANEL.top;
const SLATS = 18;
const PITCH = (PANEL.halfW * 2) / (SLATS - 1);
const HAIR = 4.4;
const THICK = 39;
const SEGS = 16;
const VSAG = 30;

function bow(u: number): number {
  return 1.000195 + 0.013744 * u - 0.023442 * u * u;
}
function bowSlope(u: number): number {
  return 0.013744 - 2 * 0.023442 * u;
}
/** `rotate-N` parses a non-negative plain number only, so a leftward lean is
 *  its positive coterminal angle. */
function rotateClass(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return `rotate-${d.toFixed(3)}`;
}
function slatX(k: number): number {
  return PANEL.cx - PANEL.halfW + k * PITCH;
}
function slatSpan(k: number): { top: number; bottom: number } {
  const d = (slatX(k) - PANEL.cx) / PANEL.halfW;
  const inset = VSAG * d * d;
  return { top: PANEL.top + inset, bottom: PANEL.bottom - inset };
}

// ── timeline (ms from the start; the recording's 10.000s) ───────────────
const T = {
  railIn: 300,
  railDur: 150,
  railOut: 440,
  seedIn: 455,
  seedOut: 590,
  comb: 600,
  combStart: 634,
  combRise: 34,
  combHold: 100,
  combFall: 34,
  combWipe: 33,
  // reference 11.424s: hairlines and walls cut out. The reference shows the
  // dialog dim over the hairlines for the 12 frames before that cut; here the
  // dialog enters AFTER it, so the two never share a frame — the overlap read
  // as a defect rather than a cadence.
  hairDim: 897,
  slatsOut: 1424,
  contentIn: 1424,
  contentDur: 260,
  // reference 13.797s: the dialog is gone and two thick arcs stand
  dialogOut: 3797,
} as const;
const COMB_DUR = T.combRise + T.combHold + T.combFall;
/** seconds into the recording -> ms into this composition */
const at = (sec: number) => Math.round((sec - 10) * 1000);

// ── registries ──────────────────────────────────────────────────────────
const keyframes: Record<string, Record<string, Record<string, string>>> = {};
const animation: Record<string, string> = {};

keyframes["gin"] = { from: { opacity: "0" }, to: { opacity: "1" } };
keyframes["gout"] = { from: { opacity: "1" }, to: { opacity: "0" } };
keyframes["dim"] = { from: { opacity: "1" }, to: { opacity: "0.36" } };
animation["dimwrap"] = `dim 260ms linear ${T.hairDim}ms both, gout 34ms linear ${T.slatsOut}ms forwards`;

/** A step gate: nothing before `at`, painted from `at`, gone from `until`.
 *  17ms is one tick at the realm's 60Hz, so the step completes before the
 *  next rendered frame at 30fps can sample it half-way. */
function gate(from: number, until?: number): string {
  const n = until === undefined ? `g${from}` : `g${from}_${until}`;
  animation[n] =
    until === undefined
      ? `gin 17ms linear ${from}ms both`
      : `gin 17ms linear ${from}ms both, gout 17ms linear ${until}ms forwards`;
  return n;
}

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
  animation[n] =
    `${key} ${T.combRise}ms linear ${T.combStart + delay}ms both, ` +
    `gin 34ms linear ${T.comb}ms both, gout 34ms linear ${T.slatsOut}ms forwards`;
  return n;
}

function railTick(w: number, delay: number): string {
  const key = `rt${w.toFixed(2)}`.replace(/\./g, "");
  keyframes[key] ??= {
    from: { width: "1.40px", translateX: "0px" },
    to: { width: `${w.toFixed(2)}px`, translateX: `${(-(w - 1.4) / 2).toFixed(2)}px` },
  };
  const n = `${key}_${Math.round(delay)}`;
  animation[n] =
    `${key} 120ms cubic-bezier(0.2,0,0,1) ${T.railIn + delay}ms both, ` +
    `gin 34ms linear ${T.railIn + delay}ms both, gout 60ms linear ${T.railOut}ms forwards`;
  return n;
}

// ── slats (shutter) ─────────────────────────────────────────────────────
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
    const lean = Math.atan((dx * bowSlope(u)) / halfH);
    const len = segSpan / Math.cos(lean) + 1.2;
    const rot = rotateClass((-lean * 180) / Math.PI);
    const frac = (yc - PANEL.top) / PANEL_H;
    const delay = frac * T.combWipe;
    const core = isWall ? wallCycle(hair, thick, delay) : slatCycle(hair, thick, delay);
    into.push(
      `      <View class="absolute left-[${px(cxr - hair / 2)}] top-[${px(yc - len / 2)}] ` +
        `w-[${px(hair)}] h-[${px(len)}] ${rot} bg-[#ffffff] animate-${core}" />`,
    );
  }
}

// ── seeds (shutter) ─────────────────────────────────────────────────────
const SEEDS = 6;
const SEED_PITCH = 46.2;
const SEED_W = 37.8;
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
      `      <View class="absolute left-[${px(cxr - w / 2)}] top-[${px(y)}] ` +
        `w-[${px(w)}] h-[${px(rowH + 0.6)}] bg-[#ffffff] animate-${anim}" />`,
    );
  }
}

// ── the comb rail (shutter) ─────────────────────────────────────────────
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
    `      <View class="absolute left-[${px(x - 0.7)}] top-[${px(y)}] ` +
      `w-[1.40px] h-[14px] bg-[#ffffff] animate-${anim}" />`,
  );
}

// ── the dialog ──────────────────────────────────────────────────────────
// Reference 11.6s: two bowed hairline rails spanning x 190–991 at y 175
// (top, highest at centre) and y 521 (bottom, lowest at centre), sag ~17; a
// mark at y 257, the title at y 288, a dots row at 311, an input box
// x 403–747 / y 341–366, a hint line at y 397, and two buttons y 435–463 at
// x 415–561 (filled) and x 590–735 (outlined).
keyframes["crise"] = {
  from: { translateY: "14px", opacity: "0" },
  to: { translateY: "0px", opacity: "1" },
};
animation["dialog"] =
  `crise ${T.contentDur}ms cubic-bezier(0.2,0,0,1) ${T.contentIn}ms both, ` +
  `gout 17ms linear ${T.dialogOut}ms forwards`;

// caret: 1s period, half on
keyframes["blink"] = { "from,49%": { opacity: "1" }, "50%,to": { opacity: "0" } };
animation["caret"] = `blink 1000ms linear 0ms infinite`;

const RAIL = { x0: rx(190), x1: rx(991), top: ry(175), bottom: ry(521), sag: ry(17), segs: 48, w: 1.6 };
const railLineNodes: string[] = [];
for (const side of ["top", "bottom"] as const) {
  const y0 = side === "top" ? RAIL.top : RAIL.bottom;
  const sign = side === "top" ? +1 : -1; // the top rail dips at the ends, the bottom one rises
  const half = (RAIL.x1 - RAIL.x0) / 2;
  const cx = (RAIL.x0 + RAIL.x1) / 2;
  for (let i = 0; i < RAIL.segs; i++) {
    const xa = RAIL.x0 + (i / RAIL.segs) * (RAIL.x1 - RAIL.x0);
    const xb = RAIL.x0 + ((i + 1) / RAIL.segs) * (RAIL.x1 - RAIL.x0);
    const da = (xa - cx) / half, db = (xb - cx) / half;
    const ya = y0 + sign * RAIL.sag * da * da, yb = y0 + sign * RAIL.sag * db * db;
    const len = Math.hypot(xb - xa, yb - ya) + 1;
    const ang = (Math.atan2(yb - ya, xb - xa) * 180) / Math.PI;
    const mx = (xa + xb) / 2, my = (ya + yb) / 2;
    railLineNodes.push(
      `        <View class="absolute left-[${px(mx - len / 2)}] top-[${px(my - RAIL.w / 2)}] w-[${px(len)}] h-[${px(RAIL.w)}] ${rotateClass(ang)} bg-[#8f969c]" />`,
    );
  }
}

const BOX = { l: rx(403), t: ry(341), w: rx(747 - 403), h: ry(366 - 341), pad: 12 };
const BTN = { t: ry(435), h: ry(463 - 435), l1: rx(415), w1: rx(561 - 415), l2: rx(590), w2: rx(735 - 590) };
const CARET = { w: 3, inset: 6 };

// ── typing: a measured caret ─────────────────────────────────────────────
// Every prefix of NAME is its own Text node, gated in when its character
// lands and out when the next one does; the caret is a separate node per
// prefix, placed at that prefix's width as the renderer's own advance table
// reports it. The measurement build bakes NAME at NAME_PX and refuses a
// codepoint it did not bake, so the caret cannot sit at a guessed width.
const face = { regular: `${REPO}${FACE_REL.regular}`, bold: `${REPO}${FACE_REL.bold}` };
if (!existsSync(face.regular)) {
  throw new Error(
    `compositions/rename-card: ${FACE_REL.regular} is absent. It is fetched, not checked in — ` +
      "run `bun scripts/assets.ts`.",
  );
}
const measurer = await openMeasurer({
  face,
  sizes: [{ px: NAME_PX }],
  texts: [NAME],
  density: SUPERSAMPLE,
});
let typedNodes: string[] = [];
let caretNodes: string[] = [];
const prefixWidths: number[] = [];
try {
  const measure = measurer.measure(NAME_PX);
  const caretAt = (w: number, anim: string) =>
    `        <View class="absolute left-[${px(BOX.l + BOX.pad + w)}] top-[${px(BOX.t + CARET.inset)}] w-[${CARET.w}px] h-[${px(BOX.h - 2 * CARET.inset)}] animate-${anim}">
          <View class="w-[${CARET.w}px] h-[${px(BOX.h - 2 * CARET.inset)}] bg-[#ffffff] animate-caret" />
        </View>`;
  // before the first character: an empty box, blinking caret at the pad
  caretNodes.push(caretAt(0, gate(0, TYPE_START)));
  for (let i = 1; i <= NAME.length; i++) {
    const prefix = NAME.slice(0, i);
    const from = TYPE_START + (i - 1) * TYPE_STEP;
    const until = i < NAME.length ? from + TYPE_STEP : undefined;
    const w = measure(prefix);
    prefixWidths.push(w);
    const g = gate(from, until);
    typedNodes.push(
      `        <View class="absolute left-[${px(BOX.l + BOX.pad)}] top-[${px(BOX.t)}] h-[${px(BOX.h)}] flex-row items-center animate-${g}">
          <Text class="text-[${NAME_PX}px] text-[#f2f2f2]">{${jsx(prefix)}}</Text>
        </View>`,
    );
    caretNodes.push(caretAt(w, g));
  }
} finally {
  await measurer.close();
}
// The typed name must fit the box with the caret after it.
{
  const full = prefixWidths[prefixWidths.length - 1]!;
  if (BOX.pad + full + CARET.w > BOX.w - BOX.pad) {
    throw new Error(`compositions/rename-card: "${NAME}" at ${NAME_PX}px is ${full.toFixed(1)}px wide and does not fit the ${BOX.w.toFixed(1)}px box`);
  }
}

const dialog = `      <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px] animate-dialog">
${railLineNodes.join("\n")}
        <View class="absolute left-[${px(PANEL.cx - 200)}] top-[${px(ry(250))}] w-[400px] h-[${px(ry(18))}] flex-row justify-center items-center gap-[3px]">
          <View class="w-[3px] h-[${px(ry(14))}] bg-[#ffffff]" />
          <View class="w-[3px] h-[${px(ry(10))}] bg-[#ffffff]" />
          <View class="w-[3px] h-[${px(ry(14))}] bg-[#ffffff]" />
          <View class="w-[6px] h-[6px] rounded-full bg-[#ffffff]" />
          <View class="w-[3px] h-[${px(ry(12))}] bg-[#ffffff]" />
        </View>
        <View class="absolute left-[${px(PANEL.cx - 200)}] top-[${px(ry(277))}] w-[400px] flex-row justify-center">
          <Text class="text-[24px] font-bold text-[#f2f2f2]">{${jsx("你是")}}</Text>
        </View>
        <View class="absolute left-[${px(PANEL.cx - 200)}] top-[${px(ry(306))}] w-[400px] flex-row justify-center">
          <Text class="text-[12px] text-[#9aa3ad] tracking-wide">{${jsx("······")}}</Text>
        </View>
        <View class="absolute left-[${px(BOX.l)}] top-[${px(BOX.t)}] w-[${px(BOX.w)}] h-[${px(BOX.h)}] bg-[#2a2e33]" />
${typedNodes.join("\n")}
${caretNodes.join("\n")}
        <View class="absolute left-[${px(PANEL.cx - 500)}] top-[${px(ry(390))}] w-[1000px] flex-row justify-center">
          <Text class="text-[14px] text-[#7f868d]">{${jsx("*你的名字不能多于7个汉字（15个字符）*")}}</Text>
        </View>
        <View class="absolute left-[${px(BTN.l1)}] top-[${px(BTN.t)}] w-[${px(BTN.w1)}] h-[${px(BTN.h)}] bg-[#ececec] flex-row justify-center items-center">
          <Text class="text-[18px] text-[#111111]">{${jsx("取消")}}</Text>
        </View>
        <View class="absolute left-[${px(BTN.l2)}] top-[${px(BTN.t)}] w-[${px(BTN.w2)}] h-[${px(BTN.h)}] border border-[#5a6066] flex-row justify-center items-center">
          <Text class="text-[18px] text-[#6f767d]">{${jsx("确认")}}</Text>
        </View>
      </View>`;

// ── the close ───────────────────────────────────────────────────────────
// Each state is what one reference frame shows and the second of the
// recording it starts at. A state holds until the next; the recording cuts
// between them and nothing here eases.
const closeNodes: string[] = [];

/** A stroke arc: centre, radius, stroke, start degrees (0 = 12 o'clock,
 *  clockwise) and sweep. The primitive draws round caps; the reference's are
 *  flat, and that is the one shape here the vocabulary cannot state. */
function arc(cx: number, cy: number, r: number, stroke: number, start: number, sweep: number, anim: string): string {
  return (
    `      <View class="absolute left-[${px(cx - r)}] top-[${px(cy - r)}] w-[${px(2 * r)}] h-[${px(2 * r)}] rounded-full bg-[#ffffff] ` +
    `arc-start-[${start}] arc-sweep-[${sweep}] arc-width-[${stroke.toFixed(1)}] animate-${anim}" />`
  );
}
const R_SCALE = (RX + RY) / 2; // a circle in the reference is drawn as a circle here, at the mean scale

// 13.797s: thick arcs — circle r=139 centred (366,349) and its mirror, stroke 17, 186°→354°
{
  const a = gate(at(13.797), at(13.831));
  const r = 139 * R_SCALE, s = 17 * RY, cy = ry(349);
  closeNodes.push(arc(rx(366), cy, r, s, 186, 168, a));
  closeNodes.push(arc(rx(1152 - 366), cy, r, s, 6, 168, a));
}
// 13.831–14.034s: thin arcs — r=72 centred (437,347), stroke 3, 189°→351°
{
  const a = gate(at(13.831), at(14.034));
  const r = 72 * R_SCALE, s = 3 * RY, cy = ry(347);
  closeNodes.push(arc(rx(437), cy, r, s, 189, 162, a));
  closeNodes.push(arc(rx(1152 - 437), cy, r, s, 9, 162, a));
}

/** A bar state: white runs at full height (reference rows 340–358) plus dark
 *  slots on rows 347–351, each run an x range in the reference frame. */
function barState(from: number, to: number, runs: ReadonlyArray<[number, number]>, slots: ReadonlyArray<[number, number]> = []): void {
  const a = gate(at(from), at(to));
  const top = ry(340), h = ry(19);
  for (const [x0, x1] of runs) {
    closeNodes.push(
      `      <View class="absolute left-[${px(rx(x0))}] top-[${px(top)}] w-[${px(rx(x1 - x0 + 1))}] h-[${px(h)}] bg-[#ffffff] animate-${a}" />`,
    );
  }
  for (const [x0, x1] of slots) {
    closeNodes.push(
      `      <View class="absolute left-[${px(rx(x0))}] top-[${px(ry(347))}] w-[${px(rx(x1 - x0 + 1))}] h-[${px(ry(5))}] bg-[#000000] animate-${a}" />`,
    );
  }
}
barState(14.0, 14.169, [[419, 732]], [[424, 462], [689, 726]]);
barState(14.169, 14.271, [[437, 450], [474, 486], [493, 682], [697, 715]], [[442, 479], [706, 715]]);
barState(14.271, 14.441, [[438, 439], [445, 468], [479, 483], [493, 611], [635, 666], [680, 692], [704, 712]], [[438, 444], [680, 707]]);
barState(14.441, 14.508, [[429, 439], [448, 513], [529, 540], [547, 602], [613, 616], [630, 694], [709, 721]], [[429, 452], [679, 716]]);
barState(14.508, 14.542, [[526, 534], [560, 570], [578, 590], [597, 606], [620, 625]]);
barState(14.542, 14.61, [[558, 559], [566, 576], [589, 593]]);
barState(14.61, 14.644, [[566, 584]]);
barState(14.678, 14.881, [[566, 584]]);

// the small square: on 14.881–15.119, 15.220–15.288, 15.390–15.525, then out by 15.80
{
  const sq = (a: string) =>
    `      <View class="absolute left-[${px(rx(571))}] top-[${px(ry(345))}] w-[${px(rx(10))}] h-[${px(ry(8))}] bg-[#ffffff] animate-${a}" />`;
  closeNodes.push(sq(gate(at(14.881), at(15.119))));
  closeNodes.push(sq(gate(at(15.22), at(15.288))));
  animation["sqfade"] = `gin 17ms linear ${at(15.39)}ms both, gout 275ms linear ${at(15.525)}ms forwards`;
  closeNodes.push(sq("sqfade"));
}

// ── assemble ────────────────────────────────────────────────────────────
const main = `// GENERATED by compositions/rename-card/gen.ts — do not edit by hand.
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
${dialog}
${closeNodes.join("\n")}
    </View>
  </View>
));
`;
await Bun.write(`${OUT}main.tsx`, main);

await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/rename-card/gen.ts — do not edit by hand.
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
  JSON.stringify({ motion: 1, durationFrames: FRAMES, fps: FPS, supersample: SUPERSAMPLE, fonts: FACE_REL }, null, 2) + "\n",
);

const nodes =
  railNodes.length + seedNodes.length + slatNodes.length + wallNodes.length +
  railLineNodes.length + typedNodes.length + caretNodes.length + closeNodes.length;
console.log(
  `rename-card: ${nodes} nodes, ${Object.keys(keyframes).length} keyframe sets, ${Object.keys(animation).length} animations, ` +
    `${FRAMES} frames @ ${FPS}fps\n` +
    `             "${NAME}" at ${NAME_PX}px measures ${prefixWidths[prefixWidths.length - 1]!.toFixed(2)}px; ` +
    `typed ${TYPE_START}–${TYPE_START + (NAME.length - 1) * TYPE_STEP}ms at ${TYPE_STEP}ms/char`,
);
