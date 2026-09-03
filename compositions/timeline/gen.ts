#!/usr/bin/env bun
/**
 * timeline — a year of milestones on one horizontal strip. Each card slides
 * to the centre, grows, holds, and gives way to the next; a ruler of ticks
 * rides between the cards, a vertical hairline marks the centre, and the
 * quarter labels behind everything move at less than half the strip's speed.
 * A wordmark with a light sweep closes it. 1920x1080, 28s @ 30fps.
 *
 * Everything that moves was measured off a recording (see NOTES.md). The
 * ruler ticks tracked frame by frame gave the cadence — a hold of ~0.9s, a
 * move of ~0.85s over one card pitch, a velocity that peaks a fifth of the
 * way in — and their SPACING gave the zoom: the whole strip pulls back to
 * 0.883 in the middle of every move and returns. One card tracked through
 * its whole pass gave the per-card scale: 1 on the right, growing to 1.58 at
 * the centre on its own slower clock, shrinking to 0.93 on the left. The card
 * bodies here are placeholders drawn from rectangles; the recording's are
 * screenshots.
 *
 * Four mechanisms this exercises:
 *
 *   - ONE translateX timeline moves the whole strip. Its keyframes are the
 *     hold/move boundaries as percentages of the film, and the easing applies
 *     per segment, so a hold is a flat segment and a move is a snap — no card
 *     carries its own position.
 *   - The zoom is a `scale` timeline on a wrapper round the strip, about the
 *     canvas centre, with a dip at every move — three animations on three
 *     nested nodes (zoom, strip, card) compose without reading each other.
 *   - The centre pop is a per-card `scale` about the node's centre, and every
 *     caption is OUTSIDE the scaled node: a scale moves glyphs and never
 *     resizes them, so the large and small captions are two Text nodes
 *     crossfaded on the same clock, placed where the scaled body's edges land.
 *   - The light sweep is an `overflow-hidden` window sliding across a white
 *     copy of the wordmark while the copy slides the other way, so the copy
 *     stays put on screen and only the window moves.
 *
 *   bun compositions/timeline/gen.ts
 *   bun src/cli/main.ts build compositions/timeline
 */

const OUT = new URL(".", import.meta.url).pathname;

export const VIEW = { w: 1920, h: 1080 } as const;
export const FPS = 30;
export const SUPERSAMPLE = 2;

const px = (v: number) => `${v.toFixed(2)}px`;
const jsx = (s: string) => JSON.stringify(s);

// ── cadence (ms) ────────────────────────────────────────────────────────
const HOLD = 900;
const MOVE = 850;
const PERIOD = HOLD + MOVE;
const EXIT = 1000; // the strip leaves after the last hold
const LOGO_IN = 300; // after the strip is gone
const LOGO_FADE = 400;
const SWEEP_DELAY = 500;
const SWEEP = 1200;
const LOGO_HOLD = 1400;
/** Measured: velocity peaks ~12 frames into a ~50-frame move and decays
 *  over the rest. */
const EASE = "cubic-bezier(0.45,0,0.1,1)";

// ── the cards ───────────────────────────────────────────────────────────
type Kind = "phone" | "wide" | "square";
interface Card {
  readonly date: string;
  readonly title: string;
  readonly likes: string;
  readonly kind: Kind;
}
const SIZE: Record<Kind, { w: number; h: number }> = {
  phone: { w: 260, h: 520 },
  wide: { w: 360, h: 320 },
  square: { w: 380, h: 380 },
};
const CARDS: readonly Card[] = [
  { date: "Aug. 15 ’25", title: "First deterministic render", likes: "2,854", kind: "wide" },
  { date: "Sep. 9 ’25", title: "Mount-only lint lands", likes: "7,146", kind: "phone" },
  { date: "Oct. 12 ’25", title: "Digest ledger goes green", likes: "2,849", kind: "wide" },
  { date: "Oct. 14 ’25", title: "Footage as a tile grid", likes: "4,827", kind: "square" },
  { date: "Oct. 16 ’25", title: "Identity names its inputs", likes: "6,175", kind: "wide" },
  { date: "Nov. 22 ’25", title: "Build-time text fitting", likes: "27,130", kind: "phone" },
  { date: "Jan. 6 ’26", title: "Visibility sweep", likes: "6,558", kind: "wide" },
  { date: "Jan. 9 ’26", title: "Sound as four roles", likes: "5,852", kind: "phone" },
  { date: "Feb. 3 ’26", title: "Layout finding codes", likes: "3,760", kind: "square" },
  { date: "Mar. 1 ’26", title: "Coverage for rotated boxes", likes: "11,281", kind: "phone" },
  { date: "Mar. 19 ’26", title: "The curved slat shutter", likes: "3,975", kind: "wide" },
  { date: "Apr. 7 ’26", title: "Cross-platform digests", likes: "12,758", kind: "square" },
  { date: "Jul. 20 ’26", title: "A measured caret", likes: "32,262", kind: "phone" },
  { date: "Sep. 2 ’26", title: "Published", likes: "10,220", kind: "wide" },
];
const N = CARDS.length;

// ── geometry ────────────────────────────────────────────────────────────
const CY = 600; // every card body is centred on this line
const GAP = 190; // edge to edge, holding the five ruler ticks
const CX = VIEW.w / 2;
/** The recording dims cards within ~400px of either edge; a card at x=442 was
 *  still full brightness and one at x=300 was not. */
const VIGNETTE = 380;

/** x of each card's centre on the strip, card 0 at the canvas centre. */
const centres: number[] = [];
{
  let x = CX;
  for (let k = 0; k < N; k++) {
    if (k > 0) x += SIZE[CARDS[k - 1]!.kind].w / 2 + GAP + SIZE[CARDS[k]!.kind].w / 2;
    centres.push(x);
  }
}
const stripEnd = centres[N - 1]! + SIZE[CARDS[N - 1]!.kind].w / 2 + GAP;

// ── registries ──────────────────────────────────────────────────────────
const keyframes: Record<string, Record<string, Record<string, string>>> = {};
const animation: Record<string, string> = {};
keyframes["gin"] = { from: { opacity: "0" }, to: { opacity: "1" } };

// ── the strip's one timeline ────────────────────────────────────────────
// Stops at every hold/move boundary. The exit is one more move that takes
// the whole strip off the left edge.
const stripDur = (N - 1) * PERIOD + HOLD + EXIT;
const pct = (t: number) => `${((t / stripDur) * 100).toFixed(4)}%`;
function stripKeyframes(factor: number): Record<string, Record<string, string>> {
  const kf: Record<string, Record<string, string>> = {};
  const at = (t: number, x: number) => {
    const sel = t === 0 ? "from" : t === stripDur ? "to" : pct(t);
    kf[sel] = { translateX: `${(-x * factor).toFixed(2)}px` };
  };
  for (let k = 0; k < N; k++) {
    const x = centres[k]! - CX;
    at(k * PERIOD, x);
    at(k * PERIOD + HOLD, x);
  }
  at(stripDur, (stripEnd - CX) + CX + 400);
  return kf;
}
keyframes["strip"] = stripKeyframes(1);
animation["strip"] = `strip ${stripDur}ms ${EASE} 0ms both`;
// the quarter labels behind: same stops, less than half the distance
keyframes["stripBack"] = stripKeyframes(0.42);
animation["stripBack"] = `stripBack ${stripDur}ms ${EASE} 0ms both`;

// ── the zoom: the whole strip pulls back on every move ──────────────────
// Measured on the ruler ticks: 30px apart at rest, 26.5px at the middle of
// every move — the strip scales to 0.883 about the canvas centre, reaching
// it ~300ms after the move starts, holding ~150ms, and back to 1 about 200ms
// after the move ends. The quarter labels behind move less: 0.94.
const ZOOM = 0.883;
const ZOOM_BACK = 0.94;
const Z_OUT = 300, Z_HOLD = 150, Z_IN = 600;
function zoomKeyframes(z: number): Record<string, Record<string, string>> {
  const kf: Record<string, Record<string, string>> = { from: { scale: "1" }, to: { scale: "1" } };
  const moves: number[] = [];
  for (let k = 1; k < N; k++) moves.push((k - 1) * PERIOD + HOLD);
  moves.push((N - 1) * PERIOD + HOLD); // the exit
  for (const m of moves) {
    kf[pct(m)] = { scale: "1" };
    kf[pct(m + Z_OUT)] = { scale: `${z}` };
    kf[pct(m + Z_OUT + Z_HOLD)] = { scale: `${z}` };
    if (m + Z_OUT + Z_HOLD + Z_IN < stripDur) kf[pct(m + Z_OUT + Z_HOLD + Z_IN)] = { scale: "1" };
  }
  return kf;
}
keyframes["zoom"] = zoomKeyframes(ZOOM);
animation["zoom"] = `zoom ${stripDur}ms cubic-bezier(0.4,0,0.2,1) 0ms both`;
keyframes["zoomBack"] = zoomKeyframes(ZOOM_BACK);
animation["zoomBack"] = `zoomBack ${stripDur}ms cubic-bezier(0.4,0,0.2,1) 0ms both`;

// ── per-card scale and caption crossfade ────────────────────────────────
// Measured on one card seen at every position (NOTES.md): a card arrives at
// scale 1, starts growing ~250ms into the move, is at 1.5 by 800ms and creeps
// to 1.58 over the next 700ms; it starts shrinking ~100ms into the move out,
// is back to 1 by ~600ms and settles at 0.93 on the left — the past is
// smaller than the future — and one slot further at 0.87.
const S_CENTRE = 1.58;
const S_LEFT = 0.93;
const S_FAR = 0.87;
const IN_LAG = 250, IN_DUR = 1250, IN_EASE = "cubic-bezier(0.15,0.7,0.1,1)";
const OUT_LAG = 100, OUT_DUR = 950, OUT_EASE = "cubic-bezier(0.5,0,0.2,1)";
const CAP_DUR = 500;
keyframes["popIn"] = { from: { scale: "1" }, to: { scale: `${S_CENTRE}` } };
keyframes["popOut"] = { from: { scale: `${S_CENTRE}` }, to: { scale: `${S_LEFT}` } };
keyframes["popFar"] = { from: { scale: `${S_LEFT}` }, to: { scale: `${S_FAR}` } };
keyframes["gout"] = { from: { opacity: "1" }, to: { opacity: "0" } };

function cardAnims(k: number): { pop: string; capL: string; capS: string } {
  const moveIn = (k - 1) * PERIOD + HOLD; // negative for k = 0, which starts at the centre
  const moveOut = k * PERIOD + HOLD;
  const moveFar = (k + 1) * PERIOD + HOLD;
  const pop: string[] = [];
  const capL: string[] = [];
  const capS: string[] = [];
  if (k > 0) {
    pop.push(`popIn ${IN_DUR}ms ${IN_EASE} ${moveIn + IN_LAG}ms both`);
    capL.push(`gin ${CAP_DUR}ms ${IN_EASE} ${moveIn + IN_LAG}ms both`);
    capS.push(`gout ${CAP_DUR}ms ${IN_EASE} ${moveIn + IN_LAG}ms both`);
  }
  pop.push(`popOut ${OUT_DUR}ms ${OUT_EASE} ${moveOut + OUT_LAG}ms ${k > 0 ? "forwards" : "both"}`);
  capL.push(`gout ${CAP_DUR}ms ${OUT_EASE} ${moveOut + OUT_LAG}ms ${k > 0 ? "forwards" : "both"}`);
  capS.push(`gin ${CAP_DUR}ms ${OUT_EASE} ${moveOut + OUT_LAG}ms ${k > 0 ? "forwards" : "both"}`);
  if (moveFar < stripDur) pop.push(`popFar ${MOVE}ms ${EASE} ${moveFar}ms forwards`);
  animation[`pop_${k}`] = pop.join(", ");
  animation[`capL_${k}`] = capL.join(", ");
  animation[`capS_${k}`] = capS.join(", ");
  return { pop: `pop_${k}`, capL: `capL_${k}`, capS: `capS_${k}` };
}
const POP = S_CENTRE;

// ── placeholder bodies ──────────────────────────────────────────────────
// Rectangles standing in for screenshots. Everything is absolute inside the
// body so the body can be scaled as one node.
function rotateClass(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return `rotate-${d.toFixed(3)}`;
}

function body(kind: Kind, seed: number): string {
  const { w, h } = SIZE[kind];
  const out: string[] = [];
  const rect = (x: number, y: number, rw: number, rh: number, cls: string) =>
    out.push(`            <View class="absolute left-[${px(x)}] top-[${px(y)}] w-[${px(rw)}] h-[${px(rh)}] ${cls}" />`);
  if (kind === "phone") {
    rect(0, 0, w, h, "rounded-[30px] bg-[#111111]");
    rect(18, 18, w - 36, h - 36, "rounded-[20px] bg-[#f3f3f3]");
    rect(w / 2 - 34, 30, 68, 8, "rounded-[4px] bg-[#111111]");
    const widths = [0.72, 0.9, 0.55, 0.84, 0.66, 0.78, 0.5, 0.88];
    for (let i = 0; i < 8; i++) {
      const y = 72 + i * 46;
      rect(40, y, 34, 22, "rounded-[6px] bg-[#d9d9d9]");
      rect(84, y + 6, (w - 124) * widths[(i + seed) % widths.length]!, 10, "rounded-[5px] bg-[#c4c4c4]");
    }
    rect(40, h - 92, w - 80, 34, "rounded-[10px] bg-[#1d9bf0]");
  } else if (kind === "wide") {
    rect(0, 0, w, h, "rounded-[24px] bg-[#0f0f0f]");
    rect(16, 16, w - 32, h - 32, "rounded-[16px] bg-[#ffffff]");
    rect(40, 40, 150, 12, "rounded-[6px] bg-[#111111]");
    rect(w - 64, 36, 22, 22, "rounded-[6px] bg-[#111111]");
    // a jagged line of rotated segments, rising to the right
    const x0 = 44, x1 = w - 44, yBase = h - 78, yTop = 84;
    const pts: Array<[number, number]> = [];
    const S = 14;
    let v = 0.25;
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      v = Math.max(0.05, Math.min(1, v + (((seed * 7 + i * 13) % 11) - 5) / 30 + t * 0.06));
      const spike = i === S - 2 ? 0.45 : 0;
      pts.push([x0 + t * (x1 - x0), yBase - (v + spike) * (yBase - yTop)]);
    }
    for (let i = 0; i < S; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
      const len = Math.hypot(bx - ax, by - ay) + 2;
      const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      out.push(
        `            <View class="absolute left-[${px(mx - len / 2)}] top-[${px(my - 1.5)}] w-[${px(len)}] h-[3px] ${rotateClass(ang)} bg-[#1f4e79]" />`,
      );
    }
    for (let i = 0; i < 22; i++) rect(x0 + i * ((x1 - x0) / 22), h - 62, 10, 6, "bg-[#bdbdbd]");
    for (const [i, lw] of [[0, 56], [1, 30], [2, 30]] as const) rect(x0 + i * ((x1 - x0) / 2.2), h - 44, lw, 8, "rounded-[4px] bg-[#8a8a8a]");
  } else {
    rect(0, 0, w, h, "rounded-[24px] bg-[#0f0f0f]");
    rect(16, 16, w - 32, h - 32, "rounded-[16px] bg-[#1a1a1a]");
    const tile = (w - 32 - 24 * 2 - 16 * 2) / 3;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const i = r * 3 + c;
        const accent = i === (seed * 5) % 9;
        rect(40 + c * (tile + 16), 40 + r * (tile + 16), tile, tile, `rounded-[14px] ${accent ? "bg-[#7c3aed]" : i % 2 ? "bg-[#2b2b2b]" : "bg-[#353535]"}`);
      }
  }
  return out.join("\n");
}

// ── the strip's children ────────────────────────────────────────────────
const CAP = { dateS: 15, titleS: 19, dateL: 22, titleL: 29, likesS: 15, likesL: 22 };
const stripNodes: string[] = [];
const backNodes: string[] = [];

function ticksAt(x: number): void {
  for (let i = -2; i <= 2; i++) {
    stripNodes.push(`        <View class="absolute left-[${px(x + i * 30 - 1)}] top-[${px(CY - 20)}] w-[2px] h-[40px] bg-[#3a3a3a]" />`);
  }
}
// ticks before the first card, in every gap, and after the last
ticksAt(centres[0]! - SIZE[CARDS[0]!.kind].w / 2 - GAP / 2);
for (let k = 0; k < N; k++) {
  const card = CARDS[k]!;
  const { w, h } = SIZE[card.kind];
  const cx = centres[k]!;
  const left = cx - w / 2, top = CY - h / 2;
  const a = cardAnims(k);
  // body, scaled about its centre
  stripNodes.push(
    `        <View class="absolute left-[${px(left)}] top-[${px(top)}] w-[${px(w)}] h-[${px(h)}] animate-${a.pop}">\n${body(card.kind, k)}\n        </View>`,
  );
  // small captions, where the unscaled body's edges are
  stripNodes.push(
    `        <View class="absolute left-[${px(left)}] top-[${px(top - 62)}] w-[${px(w + 200)}] animate-${a.capS}">
          <Text class="text-[${CAP.dateS}px] text-[#8b8b8b]">{${jsx(card.date)}}</Text>
        </View>
        <View class="absolute left-[${px(left)}] top-[${px(top - 40)}] w-[${px(w + 200)}] animate-${a.capS}">
          <Text class="text-[${CAP.titleS}px] text-[#e6e6e6]">{${jsx(card.title)}}</Text>
        </View>
        <View class="absolute left-[${px(left)}] top-[${px(top + h + 16)}] flex-row items-center gap-[6px] animate-${a.capS}">
          <View class="w-[12px] h-[12px] rounded-full border border-[#8b8b8b]" />
          <Text class="text-[${CAP.likesS}px] text-[#8b8b8b]">{${jsx(card.likes)}}</Text>
        </View>`,
  );
  // large captions, where the scaled body's edges land
  const gl = cx - (w * POP) / 2, gt = CY - (h * POP) / 2, gb = CY + (h * POP) / 2;
  stripNodes.push(
    `        <View class="absolute left-[${px(gl)}] top-[${px(gt - 82)}] w-[${px(w * POP + 200)}] animate-${a.capL}">
          <Text class="text-[${CAP.dateL}px] text-[#8b8b8b]">{${jsx(card.date)}}</Text>
        </View>
        <View class="absolute left-[${px(gl)}] top-[${px(gt - 52)}] w-[${px(w * POP + 200)}] animate-${a.capL}">
          <Text class="text-[${CAP.titleL}px] text-[#ffffff]">{${jsx(card.title)}}</Text>
        </View>
        <View class="absolute left-[${px(gl)}] top-[${px(gb + 20)}] flex-row items-center gap-[8px] animate-${a.capL}">
          <View class="w-[16px] h-[16px] rounded-full border border-[#bdbdbd]" />
          <Text class="text-[${CAP.likesL}px] text-[#e6e6e6]">{${jsx(card.likes)}}</Text>
        </View>`,
  );
  if (k < N - 1) ticksAt((cx + w / 2 + centres[k + 1]! - SIZE[CARDS[k + 1]!.kind].w / 2) / 2);
}
ticksAt(stripEnd - GAP / 2);

// quarter labels behind the strip: one per ~3.5 cards, alternating top and
// bottom, at less than half the strip's speed so they read as a far layer
const LABELS = ["’25", "Q4", "’26", "Q2", "’26"];
for (let j = 0; j < LABELS.length; j++) {
  const x = CX + j * 1500 * 0.42 - 120;
  const top = j % 2 === 0 ? 520 : -70;
  backNodes.push(
    `        <View class="absolute left-[${px(x)}] top-[${px(top)}]"><Text class="text-[200px] font-bold text-[#1a1a1a]">{${jsx(LABELS[j]!)}}</Text></View>`,
  );
}

// ── the wordmark and its light sweep ────────────────────────────────────
const logoAt = stripDur + LOGO_IN;
animation["logoIn"] = `gin ${LOGO_FADE}ms ${EASE} ${logoAt}ms both`;
const SWEEP_W = 180;
const SWEEP_SPAN = 1000; // the window travels this far; the copy travels back the same
keyframes["sweepWin"] = { from: { translateX: "0px" }, to: { translateX: `${SWEEP_SPAN}px` } };
keyframes["sweepText"] = { from: { translateX: "0px" }, to: { translateX: `${-SWEEP_SPAN}px` } };
const sweepAt = logoAt + LOGO_FADE + SWEEP_DELAY;
animation["sweepWin"] = `sweepWin ${SWEEP}ms cubic-bezier(0.4,0,0.2,1) ${sweepAt}ms both`;
animation["sweepText"] = `sweepText ${SWEEP}ms cubic-bezier(0.4,0,0.2,1) ${sweepAt}ms both`;
const LOGO = { l: CX - 500, t: CY - 130, w: 1000, h: 160 };
const logo = `      <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px] animate-logoIn">
        <View class="absolute left-[${px(LOGO.l)}] top-[${px(LOGO.t)}] w-[${px(LOGO.w)}] h-[${px(LOGO.h)}] flex-row justify-center items-center">
          <Text class="text-[96px] font-bold text-[#2e2e2e]">{${jsx("pocket motion")}}</Text>
        </View>
        <View class="absolute left-[${px(LOGO.l - SWEEP_W)}] top-[${px(LOGO.t)}] w-[${px(SWEEP_W)}] h-[${px(LOGO.h)}] overflow-hidden animate-sweepWin">
          <View class="absolute left-[${px(SWEEP_W)}] top-0 w-[${px(LOGO.w)}] h-[${px(LOGO.h)}] flex-row justify-center items-center animate-sweepText">
            <Text class="text-[96px] font-bold text-[#ffffff]">{${jsx("pocket motion")}}</Text>
          </View>
        </View>
      </View>`;

export const DURATION_MS = sweepAt + SWEEP + LOGO_HOLD;
export const FRAMES = Math.ceil((DURATION_MS / 1000) * FPS);

// ── assemble ────────────────────────────────────────────────────────────
const main = `// GENERATED by compositions/timeline/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#000000]">
    <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px]">
      <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px] animate-zoomBack">
        <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px] animate-stripBack">
${backNodes.join("\n")}
        </View>
      </View>
      <View class="absolute left-[${px(CX - 0.5)}] top-0 w-[1px] h-[${VIEW.h}px] bg-[#2c2c2c]" />
      <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px] animate-zoom">
        <View class="absolute left-0 top-0 w-[${VIEW.w}px] h-[${VIEW.h}px] animate-strip">
${stripNodes.join("\n")}
        </View>
      </View>
      <View class="absolute left-0 top-0 w-[${VIGNETTE}px] h-[${VIEW.h}px] bg-gradient-to-r from-[#000000ff] to-[#00000000]" />
      <View class="absolute left-[${VIEW.w - VIGNETTE}px] top-0 w-[${VIGNETTE}px] h-[${VIEW.h}px] bg-gradient-to-l from-[#000000ff] to-[#00000000]" />
${logo}
    </View>
  </View>
));
`;
await Bun.write(`${OUT}main.tsx`, main);

await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/timeline/gen.ts — do not edit by hand.
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

console.log(
  `timeline: ${N} cards, strip ${stripEnd.toFixed(0)}px, ${Object.keys(keyframes).length} keyframe sets, ` +
    `${Object.keys(animation).length} animations, ${FRAMES} frames (${(DURATION_MS / 1000).toFixed(2)}s @ ${FPS}fps)`,
);
