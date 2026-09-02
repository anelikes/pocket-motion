#!/usr/bin/env bun
/**
 * Generates the introduction reel: baked keyframe timelines plus the
 * composition that uses them. See STORYBOARD.md.
 *
 * Everything emitted is a baked timeline the core plays at fixed dt with zero
 * per-frame JS, so the composition stays mount-only. That constraint is what
 * makes the borrowed devices interesting: a scramble is normally a per-frame
 * string rewrite, and here it is a stack of pre-placed glyphs each gated by a
 * one-millisecond opacity step.
 *
 * Shot vocabulary adapted from video-shotcraft (Apache-2.0), rewritten against
 * this renderer's primitives — rects, gradients, arcs, baked glyphs and the 3D
 * pipeline. Nothing is ported: that library targets Remotion, where a shot can
 * reach for blur, glow, clip paths and per-frame JS, none of which exist here.
 *
 * THREE MEASURED FACTS SHAPE EVERY LAYOUT HERE
 *
 * 1. `scale` moves glyphs apart; it does not resize them. At 80 px bold the
 *    cap height is 60 px at scale 1.0, 1.25 and 1.5 alike, while the run
 *    spreads 819 -> 938 -> 1022 px. Images do scale. So camera push-ins are
 *    used on geometry only; `translate` carries every type motion.
 *
 * 2. A rotate-y wall carries an Image into perspective and leaves a Text node
 *    flat and upright on top of it. Nothing on a turning wall is type.
 *
 * 3. Three static full-screen perspective walls cost 20.86 ms/frame against
 *    5.64 ms with none. Collapsed to `scale 0` they cost 5.50 ms, so the room
 *    is alive for the two turns only.
 *
 * No offset here is hand-computed from a guessed string width. Every centred
 * thing is centred by flexbox.
 */

import { BAR, BARS, BEAT, END_MS, FRAMES, bar, beat } from "./beats.ts";
import { BGM, SFX } from "./sound.ts";

const OUT = new URL(".", import.meta.url).pathname;

/**
 * The face this reel IS, declared so its digest can be reproduced by someone
 * who never opened this file.
 *
 * `scripts/build-reel.ts --font inter` still exists and still overrides it:
 * that flag is the A/B rig behind the Phase 1.5 kerning decision
 * (baselines/phase1_5-kerning-trigger.md), not a second identity. The sidecar
 * states what the reel is by default and what every recorded digest was cut
 * against; passing the flag is an experiment the author knows they are running.
 */
const FACE_REL = {
  regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
  bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
};

// ── curves ─────────────────────────────────────────────────────────────────
//
// DRIVE is the reel's primary curve: hold, sprint, brake. Far more extreme
// than a default ease-in-out — the handles are pulled almost to the ends — so
// roughly the middle half of every duration carries nearly all of the travel
// and both ends are near-stationary. Measured on a headline entry: 40 px from
// rest at 133 ms (it has not moved), 17 px at 300 ms (14 px in one frame),
// landed at 700 ms. Peak speed about 7x the average for the move.
//
// It survives every recut. The gallery in `compositions/curves` is where it
// was chosen and is still the way to compare it against anything else.

const DRIVE = "cubic-bezier(.9,0,.1,1)";
const GATHER = "cubic-bezier(.7,0,1,.35)";
const DEPART = "cubic-bezier(.5,0,.85,.2)";

const RISE = 38;
const RESID = 4;
const ATTACK = 620;
const RESIDUAL = 1600;

const keyframes: Record<string, Record<string, Record<string, string>>> = {};
const animation: Record<string, string> = {};

Object.assign(keyframes, {
  "mv-in": { from: { transform: `translateY(${RISE}px)` }, to: { transform: "translateY(0px)" } },
  "mv-res": { from: { transform: "translateY(0px)" }, to: { transform: `translateY(-${RESID}px)` } },
  "mv-out": { from: { transform: `translateY(-${RESID}px)` }, to: { transform: `translateY(-${RESID + 40}px)` } },
  "fd-in": { from: { opacity: "0" }, to: { opacity: "1" } },
  "fd-out": { from: { opacity: "1" }, to: { opacity: "0" } },
  "sx-gather": { from: { transform: "translateX(0px)" }, to: { transform: "translateX(-40px)" } },
  "sx-go": { from: { transform: "translateX(-40px)" }, to: { transform: "translateX(1500px)" } },
});

/** attack, residual, exit — the standard beat, on one element */
function life(inAt: number, outAt: number): string {
  const n = `b${inAt}_${outAt}`;
  animation[n] =
    `mv-in ${ATTACK}ms ${DRIVE} ${inAt}ms both, ` +
    `fd-in 200ms linear ${inAt}ms both, ` +
    `mv-res ${RESIDUAL}ms ${DRIVE} ${inAt + ATTACK}ms forwards, ` +
    `mv-out 320ms ${GATHER} ${outAt}ms forwards, ` +
    `fd-out 280ms linear ${outAt}ms forwards`;
  return n;
}

/**
 * Fade in, hold still, fade out.
 *
 * `life` is wrong for a chart mark: it carries an entrance move and 1.6 s of
 * residual drift, so a row of bars whose heights ARE the data arrives as a
 * sagging curve and the reader sees the animation instead of the measurement.
 */
function hold(inAt: number, outAt: number): string {
  const n = `h${inAt}_${outAt}`;
  animation[n] = `fd-in 200ms linear ${inAt}ms both, fd-out 280ms linear ${outAt}ms forwards`;
  return n;
}

/** visible for exactly [from, to) — a hard-gated stack member */
function gate(from: number, to: number): string {
  const n = `v${from}_${to}`;
  animation[n] = `fd-in 1ms linear ${from}ms both, fd-out 1ms linear ${to}ms forwards`;
  return n;
}

function slideOff(atAt: number): string {
  const n = `so${atAt}`;
  animation[n] =
    `sx-gather 240ms ${GATHER} ${atAt}ms forwards, ` +
    `sx-go 560ms ${DEPART} ${atAt + 240}ms forwards, ` +
    `fd-out 320ms linear ${atAt + 380}ms forwards`;
  return n;
}

function resize(inAt: number, from: number, to: number, dur = ATTACK): string {
  const k = `rz${from}_${to}`;
  keyframes[k] ??= { from: { height: `${from}px` }, to: { height: `${to}px` } };
  const n = `${k}_${inAt}`;
  animation[n] = `${k} ${dur}ms ${DRIVE} ${inAt}ms both`;
  return n;
}

function grow(delay: number, w: number, outAt: number, dur = 900): string {
  const d = `gw${w}_${dur}`;
  keyframes[d] ??= { from: { width: "0px" }, to: { width: `${w}px` } };
  const p = `gx${w}`;
  keyframes[p] ??= { from: { width: `${w}px` }, to: { width: "0px" } };
  const n = `g${delay}_${outAt}_${w}_${dur}`;
  animation[n] = `${d} ${dur}ms ${DRIVE} ${delay}ms both, ${p} 380ms ${GATHER} ${outAt}ms forwards`;
  return n;
}

function sweep(delay: number, deg: number, outAt: number, dur = 1200): string {
  const s = `aw${deg}`;
  keyframes[s] ??= { from: { arcSweep: "0deg" }, to: { arcSweep: `${deg}deg` } };
  const n = `${s}_${delay}_${outAt}`;
  animation[n] = `${s} ${dur}ms ${DRIVE} ${delay}ms both, fd-out 280ms linear ${outAt}ms forwards`;
  return n;
}

// ── borrowed device 1 · smear-multiples ────────────────────────────────────
// A fast move gets lagged copies of itself at falling opacity. Not blur — blur
// does not exist here — countable ghosts, which is what the technique actually
// is: the same interpolation sampled at earlier times.
//
// **The device has an operating range and the first attempt was outside it.**
// Its card gates ghosts on velocity: render them only above 25 px/frame,
// because below that they never pull far enough apart to read as a trail. The
// headline was given the standard 38 px entry, which peaks at 13.9 px/frame —
// so four copies landed within a few pixels of each other and the whole title
// read as embossed, like a rendering fault. A smeared element therefore gets
// its own travel: SLAM is 420 px, which peaks at 153 px/frame.
//
// The ghosts also clear 160 ms BEFORE the main copy lands rather than at the
// same instant. Fading them out on the landing frame puts the doubling at its
// most visible exactly where the eye is going.

const SLAM = 420;
const SMEAR_LAG = 46;

/**
 * The ghost ladder has to live in the keyframes, not in a utility.
 *
 * `opacity-30` on the element does nothing here: the ghost's own `fd-in`
 * animation targets opacity and an animated property wins over the static
 * record for as long as it is filling, which is the element's whole life. Four
 * ghosts marked 40/30/20/10 were therefore all drawing at full opacity, and
 * changing those numbers did not move the frame digest by a single byte —
 * which is how the bug surfaced at all.
 */
const SMEAR_ALPHA = [0.32, 0.22, 0.14, 0.08];

keyframes["mv-slam"] = {
  from: { transform: `translateY(${SLAM}px)` },
  to: { transform: "translateY(0px)" },
};

/** the main copy of a smeared element — a long travel, so the ghosts qualify */
function slamIn(inAt: number, outAt: number): string {
  const n = `sl${inAt}_${outAt}`;
  animation[n] =
    `mv-slam ${ATTACK}ms ${DRIVE} ${inAt}ms both, ` +
    `fd-in 160ms linear ${inAt}ms both, ` +
    `mv-res ${RESIDUAL}ms ${DRIVE} ${inAt + ATTACK}ms forwards, ` +
    `mv-out 320ms ${GATHER} ${outAt}ms forwards, ` +
    `fd-out 280ms linear ${outAt}ms forwards`;
  return n;
}

/**
 * A ghost exists only while the element is actually sprinting.
 *
 * DRIVE spends its first ~28% and last ~28% near-stationary, and during those
 * the lagged copies are a few pixels apart — which is the same embossed
 * doubling the short travel produced, just at a different moment. So the
 * ghosts fade in at 140 ms, after the hold, and are gone by 550 ms, before the
 * brake. They are visible only across the middle of the move, which is the
 * only stretch where they are far enough apart to be read as separate.
 */
const SPRINT_IN = 140;
const SPRINT_OUT = 400;

function smearIn(inAt: number, k: number, alpha: number): string {
  const a = String(alpha).replace(".", "");
  const up = `gh-in-${a}`;
  const dn = `gh-out-${a}`;
  keyframes[up] ??= { from: { opacity: "0" }, to: { opacity: String(alpha) } };
  keyframes[dn] ??= { from: { opacity: String(alpha) }, to: { opacity: "0" } };
  const n = `sm${inAt}_${k}`;
  animation[n] =
    `mv-slam ${ATTACK}ms ${DRIVE} ${inAt + k * SMEAR_LAG}ms both, ` +
    `${up} 90ms linear ${inAt + SPRINT_IN}ms both, ` +
    `${dn} 150ms linear ${inAt + SPRINT_OUT}ms forwards`;
  return n;
}

// ── borrowed device 2 · scramble ───────────────────────────────────────────
// Characters churn through a glyph pool and lock left to right. The original
// rewrites the string every two frames; a mount-only composition cannot, so
// every candidate glyph is placed up front and gated to a 1-frame window. The
// pool is walked by a seeded hash, never a random — the same frame index must
// always produce the same picture, which is the whole premise of the renderer.
//
// Unlocked glyphs sit at a near-background grey and only brighten on lock, so
// the brightness front *is* the progress indicator. The original's glow on
// lock is not reproducible and is not missed; the colour step carries it.

const POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*+=<>/\\|";
const rand = (seed: number): number => {
  const x = Math.sin(seed * 127.3) * 43758.5453;
  return x - Math.floor(x);
};

function scramble(
  text: string,
  opts: {
    startAt: number;
    outAt: number;
    slotW: number;
    slotH: number;
    cls: string;
    dimCls: string;
    stepMs?: number;
    lockStepMs?: number;
    leadMs?: number;
  },
): string {
  const { startAt, outAt, slotW, slotH, cls, dimCls } = opts;
  const stepMs = opts.stepMs ?? 80;
  const lockStep = opts.lockStepMs ?? 78;
  const lead = opts.leadMs ?? 420;
  const chars = [...text];

  return chars
    .map((ch, i) => {
      if (ch === " ") return `        <View class="w-[${Math.round(slotW * 0.42)}] h-[${slotH}]" />`;
      const lockAt = startAt + lead + i * lockStep + Math.round(rand(i * 7) * 60);
      const churnFrom = startAt + Math.round(rand(i * 3.1) * 90);
      const layers: string[] = [];
      for (let t = churnFrom, k = 0; t < lockAt; t += stepMs, k++) {
        const g = POOL[Math.floor(rand(i * 31.7 + k * 5.3) * POOL.length)]!;
        layers.push(
          `          <View class="absolute inset-0 flex-row justify-center items-center animate-${gate(t, Math.min(t + stepMs, lockAt))}"><Text class="${cls} ${dimCls}">{${jsx(g)}}</Text></View>`,
        );
      }
      layers.push(
        `          <View class="absolute inset-0 flex-row justify-center items-center animate-${life(lockAt, outAt)}"><Text class="${cls}">{${jsx(ch)}}</Text></View>`,
      );
      return `        <View class="w-[${slotW}] h-[${slotH}]">\n${layers.join("\n")}\n        </View>`;
    })
    .join("\n");
}

// ── borrowed device 3 · odometer digit roll ────────────────────────────────
// Each digit is an overflow-hidden window over a 0–9–0–9 strip translated
// upward. The original decelerates with a half-row overshoot and a bounce
// back; DRIVE already ends in a hard brake, so the overshoot is a second
// short segment rather than a different easing. Non-digits do not roll.

function odometer(value: string, opts: { at: number; outAt: number; w: number; h: number; cls: string }): string {
  const { at, outAt, w, h, cls } = opts;
  return [...value]
    .map((ch, i) => {
      if (!/[0-9]/.test(ch)) {
        return `            <View class="w-[${Math.round(w * 0.42)}] h-[${h}] flex-row justify-center items-center animate-${life(at, outAt)}"><Text class="${cls}">{${jsx(ch)}}</Text></View>`;
      }
      const d = Number(ch);
      const rolls = 2; // full turns before landing
      const dist = (rolls * 10 + d) * h;
      const k = `roll${dist}`;
      keyframes[k] ??= {
        from: { transform: "translateY(0px)" },
        to: { transform: `translateY(-${dist}px)` },
      };
      const start = at + i * 70;
      const n = `${k}_${start}`;
      animation[n] = `${k} ${900 + i * 60}ms ${DRIVE} ${start}ms both`;
      const strip = Array.from({ length: rolls * 10 + d + 1 }, (_, j) =>
        `                <View class="w-[${w}] h-[${h}] flex-row justify-center items-center"><Text class="${cls}">{"${j % 10}"}</Text></View>`,
      ).join("\n");
      return `            <View class="w-[${w}] h-[${h}] overflow-hidden animate-${life(at, outAt)}">
              <View class="absolute top-0 left-0 flex-col animate-${n}">
${strip}
              </View>
            </View>`;
    })
    .join("\n");
}

// ── the room ───────────────────────────────────────────────────────────────

const TURN_MS = 760;
const GATE = 40;

function roomTurn(t1: number, t2: number): string {
  keyframes["room-turn-1"] ??= { from: { rotateY: 0 }, to: { rotateY: -90 } };
  keyframes["room-turn-2"] ??= { from: { rotateY: -90 }, to: { rotateY: -180 } };
  for (const g of ["g1on", "g1off", "g2on", "g2off"]) {
    keyframes[g] ??= g.endsWith("on")
      ? { from: { scale: "0" }, to: { scale: "1" } }
      : { from: { scale: "1" }, to: { scale: "0" } };
  }
  animation["room"] =
    `room-turn-1 ${TURN_MS}ms ${DRIVE} ${t1}ms both, ` +
    `room-turn-2 ${TURN_MS}ms ${DRIVE} ${t2}ms forwards, ` +
    `g1on 1ms linear ${t1 - GATE}ms both, ` +
    `g1off 1ms linear ${t1 + TURN_MS + GATE}ms forwards, ` +
    `g2on 1ms linear ${t2 - GATE}ms forwards, ` +
    `g2off 1ms linear ${t2 + TURN_MS + GATE}ms forwards`;
  return "room";
}

function lightGround(onAt: number, offAt: number): string {
  keyframes["lit-on"] ??= { from: { scale: "0" }, to: { scale: "1" } };
  keyframes["lit-off"] ??= { from: { scale: "1" }, to: { scale: "0" } };
  animation["lit"] = `lit-on 1ms linear ${onAt}ms both, lit-off 1ms linear ${offAt}ms forwards`;
  return "lit";
}

// ── composition helpers ────────────────────────────────────────────────────

/**
 * Text into a JSX expression container.
 *
 * `JSON.stringify`, not a hand-rolled `\`/`"` escaper: the hand-rolled one this
 * file used to carry is correct for the single-line strings here and silently
 * wrong the moment a string holds a newline — which is exactly what `fitToBox`
 * returns for wrapped copy. Copying that escaper into another generator is
 * how a raw newline ends up inside a string literal in generated source. One
 * correct spelling, in every generator.
 */
const jsx = (s: string): string => JSON.stringify(s);

function stagger(text: string, cls: string, inAt: number, outAt: number, step = 28, indent = 10): string {
  const pad = " ".repeat(indent);
  return [...text]
    .map((ch, i) => `${pad}<Text class="${cls} animate-${life(inAt + i * step, outAt)}">{${jsx(ch)}}</Text>`)
    .join("\n");
}

function line(text: string, cls: string, inAt: number, outAt: number, indent = 8): string {
  const pad = " ".repeat(indent);
  return `${pad}<View class="animate-${life(inAt, outAt)}"><Text class="${cls}">{${jsx(text)}}</Text></View>`;
}

// ── palette and type ───────────────────────────────────────────────────────

const INK_D = "text-zinc-50";
const SUB_D = "text-zinc-300";
const DIM_D = "text-zinc-500";
const INK_L = "text-zinc-900";
const SUB_L = "text-zinc-600";
const DIM_L = "text-zinc-500";
const ACCENT = "bg-gradient-to-r from-blue-500 to-cyan-400";

const HERO = "text-[104px] font-bold";
const SECT = "text-[76px] font-bold";
const NUM = "text-[64px] font-bold";
const BODY = "text-[38px]";
const BODYB = "text-[38px] font-bold";
const SLAB = "text-[34px]";
const SLABB = "text-[34px] font-bold";
const CAP = "text-[26px]";

// ── the timeline, in bars ──────────────────────────────────────────────────
// Every cut is on the grid measured from the track (beats.ts). The track's drop
// sits on bar 7, where the room turns — so the two shots added last go AFTER it,
// between the numbers and the trade. Speed, then proof, then cost.

const A = beat(1),          A_OUT = bar(2) - 200;          // scramble title
const B = bar(2),           B_OUT = bar(7) - 300;          // remove the browser
const T1 = bar(7);                                          // ← the drop
const C = bar(7) + TURN_MS, C_OUT = bar(11) - 260;          // the numbers
const T2 = bar(11);                                         // turn back
const P = bar(11) + TURN_MS + 160, P_OUT = bar(13) - 220;   // same bytes elsewhere
const Q = bar(13) + 160,    Q_OUT = bar(15) - 220;          // sub-pixel
const D = bar(15) + 160,    D_OUT = bar(17) - 200;          // it does less
const E = bar(17), E_OUT = END_MS - 220;                    // lockup

// ── the room ───────────────────────────────────────────────────────────────

const room = `    {/* the room — the camera sits inside it and turns twice, on the
        drop and on the way back. Only geometry rides these walls: a Text on
        a turning wall stays flat and upright, so every marking is a rect.
        Collapsed to scale 0 outside the turns — three full-screen
        perspective quads cost 15 ms/frame and are wanted for 46 frames. */}
    <View class="absolute inset-0 perspective-[3200]">
      <View class="absolute inset-0 translate-z-[-960] animate-${roomTurn(T1, T2)}">
        <View class="absolute top-[-240] bottom-[-240] left-0 right-0 bg-zinc-950 translate-z-[960]">
          <View class="absolute top-[400] left-[0] w-[300] h-[3] bg-zinc-800" />
          <View class="absolute top-[1180] left-[1500] w-[420] h-[3] bg-zinc-800" />
        </View>
        <View class="absolute top-[-240] bottom-[-240] left-0 right-0 bg-zinc-50 translate-x-[960] rotate-y-[90]">
          <View class="absolute top-[260] left-[0] w-[1920] h-[2] bg-zinc-200" />
          <View class="absolute top-[1300] left-[0] w-[1920] h-[2] bg-zinc-200" />
        </View>
        <View class="absolute top-[-240] bottom-[-240] left-0 right-0 bg-zinc-950 translate-z-[-960] rotate-y-[180]">
          <View class="absolute top-[220] left-[760] w-[400] h-[3] bg-zinc-800" />
        </View>
      </View>
    </View>
    <View class="absolute inset-0 bg-zinc-50 animate-${lightGround(T1 + TURN_MS - GATE, T2)}">
      <View class="absolute top-[260] left-[0] w-[1920] h-[2] bg-zinc-200" />
      <View class="absolute top-[820] left-[0] w-[1920] h-[2] bg-zinc-200" />
    </View>`;

// ── 1 · the title, scrambled in ────────────────────────────────────────────

const shot1 = `    {/* 1 · the title assembles out of noise */}
    <View class="absolute inset-0 flex-col justify-center items-center gap-7">
      <View class="flex-row">
${scramble("PocketJS Motion", { startAt: A, outAt: A_OUT, slotW: 74, slotH: 126, cls: HERO, dimCls: "text-zinc-700" })}
      </View>
      <View class="h-[5] rounded ${ACCENT} animate-${grow(A + 1500, 900, A_OUT, 700)}" />
      <View class="flex-row">
${stagger("Deterministic video rendering. No browser.", `${BODY} ${SUB_D}`, A + 1700, A_OUT, 14)}
      </View>
    </View>`;

// ── 2 · remove the browser ─────────────────────────────────────────────────

const SLAB_H = 76;
const DECK_H = 3 * SLAB_H + 2 * 12;
const CHIP_H = 196;

/**
 * The layers leave one per BEAT, not one per bar.
 *
 * At a bar apart they were 1.88 s each, and the deck sat untouched for 3.1 s
 * before the first one went — nine seconds of screen time for about four
 * seconds of event, which reads as the picture having stalled. A beat apart
 * the departures overlap into a cascade, which is what the wave was supposed
 * to be. The shot then has room for a third act instead of a hold.
 */
const REMOVED = [
  { label: "CDP round trip", at: bar(3) },
  { label: "CSS engine", at: bar(3) + BEAT },
  { label: "vsync", at: bar(3) + 2 * BEAT },
];
const LAST_OUT = REMOVED[2]!.at;
const GONE = bar(4);

const deck = REMOVED.map(
  (r, i) => `          <View class="animate-${slideOff(r.at)}">
            <View class="w-[1000] h-[${SLAB_H}] rounded-lg bg-zinc-900 flex-row items-center px-8 gap-6 animate-${life(B + 340 + i * 110, B_OUT)}">
              <View class="w-[16] h-[3] rounded bg-zinc-700" />
              <View class="flex-row items-center">
                <Text class="${SLAB} text-zinc-600">{${jsx(r.label)}}</Text>
                <View class="absolute left-0 right-0 top-[24] h-[3] rounded bg-zinc-600" />
              </View>
            </View>
          </View>`,
).join("\n");

function chip(title: string, l1: string, l2: string, accentText: string, accentBar: string, delay: number): string {
  return `            <View class="w-[492] h-[${CHIP_H}] rounded-lg border border-zinc-700 bg-zinc-900 flex-col animate-${life(delay, B_OUT)}">
              <View class="h-[5] w-[492] rounded ${accentBar}" />
              <View class="flex-col justify-center gap-3 px-8 grow">
                <Text class="${SLABB} ${accentText}">{${jsx(title)}}</Text>
                <Text class="${CAP} text-zinc-400">{${jsx(l1)}}</Text>
                <Text class="${CAP} text-zinc-400">{${jsx(l2)}}</Text>
              </View>
            </View>`;
}

/** the headline arrives with four lagged ghosts of itself */
const smearHead = SMEAR_ALPHA.map(
  (alpha, k) => `        <View class="absolute inset-0 flex-row justify-center animate-${smearIn(B, k + 1, alpha)}">
          <Text class="${SECT} ${INK_D}">{"remove the browser"}</Text>
        </View>`,
).join("\n");

const shot2 = `    {/* 2 · remove the browser — the removal happens on screen, and what is
        removed is never on screen beside what replaces it */}
    <View class="absolute inset-0 flex-col justify-center items-center">
      <View class="flex-col items-center gap-11">
        <View class="w-[1000] h-[92]">
${smearHead}
          <View class="absolute inset-0 flex-row justify-center animate-${slamIn(B, B_OUT)}">
            <Text class="${SECT} ${INK_D}">{"remove the browser"}</Text>
          </View>
        </View>
        <View class="w-[1000] h-[${DECK_H}] animate-${resize(GONE, DECK_H, SLAB_H)}">
          <View class="absolute top-0 left-0 w-[1000] flex-col gap-3">
${deck}
          </View>
          <View class="absolute top-0 left-0 w-[1000] h-[${SLAB_H}] rounded-lg border border-zinc-700 bg-zinc-900 flex-row items-center px-8 gap-6 animate-${life(GONE, B_OUT)}">
            <View class="w-[10] h-[36] rounded ${ACCENT}" />
            <Text class="${SLABB} ${INK_D}">{"Rust core"}</Text>
            <View class="grow" />
            <Text class="${CAP} ${DIM_D}">{"layout · raster · text"}</Text>
          </View>
        </View>
        <View class="w-[1000] h-[0] animate-${resize(GONE + 340, 0, CHIP_H)}">
          <View class="absolute top-0 left-0 w-[1000] flex-row gap-4">
${chip("DETERMINISM", "frames are a pure function", "of the tick index", "text-cyan-400", "bg-cyan-400", GONE + 400)}
${chip("SPEED", "no CDP round trip, no CSS", "engine, no vsync", "text-blue-500", "bg-blue-500", GONE + 520)}
          </View>
        </View>
        {/* third act, arriving on bar 5 and building into the drop. The shot
            used to hold here for four seconds. This is the claim the core
            slab is actually making, and the check step re-verifies it on every
            build — a composition that issued one op per frame would fail the
            build, not the review. */}
        <View class="w-[1000] h-[0] animate-${resize(bar(5), 0, 108)}">
          <View class="absolute top-0 left-0 w-[1000] flex-row items-center justify-center gap-7">
            <View class="flex-row items-end animate-${life(bar(5) + 120, B_OUT)}">
              <Text class="text-[104px] font-bold text-cyan-400">{"0"}</Text>
            </View>
            <View class="flex-col gap-1">
              <View class="animate-${life(bar(5) + 300, B_OUT)}"><Text class="${SLABB} ${INK_D}">{"guest ops per frame"}</Text></View>
              <View class="animate-${life(bar(5) + 420, B_OUT)}"><Text class="${CAP} ${DIM_D}">{"every motion is a baked timeline the core plays itself"}</Text></View>
            </View>
          </View>
        </View>
      </View>
    </View>`;

// ── 3 · the numbers ────────────────────────────────────────────────────────
// Every bar takes the same time. Making duration proportional to value as well
// as length is what forbids a curve with a slow start: length is k*d*E(t/d),
// so ordering holds only where E(x)/x is non-increasing, and an ease-in-out
// under that coupling put HyperFrames' bar ahead of Remotion's for 1.36 s.
// Shared duration admits any curve and holds exact proportion at every instant.

const BAR_MS = 1200;
const ROW_W = 1400;

const ENV = [
  "Apple M4 · 10 cores · macOS",
  "1920×1080 · 30 fps · 450 frames · single worker · median of 3 runs",
  "wall-clock end to end, H.264 encoding included",
];

function row(label: string, value: string, w: number, delay: number, fill: string, valueCls: string): string {
  return `          <View class="w-[${ROW_W}] flex-row items-center gap-7 h-[76] animate-${life(delay - 360, C_OUT)}">
            <View class="w-[430] flex-row justify-end"><Text class="${BODY} ${SUB_L}">{${jsx(label)}}</Text></View>
            <View class="h-[26] rounded ${fill} animate-${grow(delay, w, C_OUT, BAR_MS)}" />
            <View class="flex-row items-end">
${odometer(value, { at: delay + 120, outAt: C_OUT, w: 40, h: 66, cls: `${NUM} ${valueCls}` })}
              <View class="w-[10]" />
              <View class="flex-row items-center h-[66] animate-${life(delay + 400, C_OUT)}"><Text class="${BODYB} ${valueCls}">{"ms"}</Text></View>
            </View>
          </View>`;
}

const shot3 = `    {/* 3 · the numbers — odometer digits over shared-duration bars */}
    <View class="absolute inset-0 flex-col justify-center items-center gap-10">
      <View class="animate-${life(C, C_OUT)}">
        <Text class="${CAP} ${DIM_L}">{"milliseconds per frame · lower is better"}</Text>
      </View>
      <View class="flex-row items-center gap-16">
        <View class="flex-col items-start gap-2">
${row("Remotion · 1 worker", "52.36", 700, C + 420, "bg-zinc-300", SUB_L)}
${row("HyperFrames · 1 worker", "38.19", 511, C + 420, "bg-zinc-300", SUB_L)}
${row("PocketJS Motion · 1 thread", "5.75", 77, C + 420, ACCENT, "text-blue-600")}
        </View>
        {/* the ring needs a gate: at sweep 0 the arc primitive fills its box.
            6.6x is the ratio against the FASTER of the two — Remotion's bar is
            right there and the gap is visibly wider; quoting 9.1x and letting
            a viewer find the smaller number is the wrong way round. */}
        {/* the visibility gate must open AFTER the sweep has left zero, not
            before it: at sweep 0 the arc primitive falls back to filling its
            box, so a gate that opens early shows a solid disc. It opened
            300 ms early here and the disc was on screen for nine frames.
            DRIVE holds near zero for its first ~28%, so the gate waits 420 ms
            past the sweep start, by which point the arc is ~66 degrees. */}
        <View class="flex-col items-center gap-4">
          <View class="w-[230] h-[230] animate-${life(bar(8) + 620, C_OUT)}">
            <View class="absolute top-0 left-0 w-[230] h-[230] rounded-full bg-blue-600 arc-start-[270] arc-width-[12] animate-${sweep(bar(8) + 200, 300, C_OUT)}" />
            <View class="absolute inset-0 flex-row justify-center items-center animate-${life(bar(8) + 900, C_OUT)}">
              <Text class="text-[68px] font-bold ${INK_L}">{"6.6x"}</Text>
            </View>
          </View>
          <View class="animate-${life(bar(9) + 100, C_OUT)}"><Text class="text-[22px] ${DIM_L}">{"vs HyperFrames"}</Text></View>
        </View>
      </View>
    </View>
    {/* the conditions — a benchmark without its environment is an anecdote */}
    <View class="absolute inset-0 flex-col justify-end items-center pb-[70]">
      <View class="flex-col items-center gap-2">
        <View class="w-[120] h-[2] rounded bg-zinc-300 animate-${life(bar(9) + 500, C_OUT)}" />
${ENV.map((l, i) => `        <View class="animate-${life(bar(9) + 640 + i * 130, C_OUT)}"><Text class="text-[22px] ${DIM_L}">{${jsx(l)}}</Text></View>`).join("\n")}
      </View>
    </View>`;

// ── 4 · the trade ──────────────────────────────────────────────────────────

// ── P · the same bytes somewhere else ──────────────────────────────────────
// The reel claimed determinism for four cuts and never showed it. The digest on
// screen is the one in baselines/hash-portability.md — the smoke composition,
// 450 frames, run on this machine and in a linux/x64 container, every frame hash
// equal. It is truncated to 16 characters because a 64-character hex string read
// off a screen is not read, it is skipped.

const DIGEST = "947ec6d2c3b94680";

function platformRow(label: string, at: number, outAt: number): string {
  return `        <View class="flex-row items-center gap-8 animate-${life(at, outAt)}">
          <Text class="${SLAB} ${DIM_D} w-[260]">{"${label}"}</Text>
          <Text class="${SLABB} ${INK_D}">{"${DIGEST}\u2026"}</Text>
        </View>`;
}

const shotP = `    {/* P · determinism, finally shown rather than asserted */}
    <View class="absolute inset-0 flex-col justify-center items-center gap-10">
      <View class="flex-row">
${stagger("Different machine. Same bytes.", `${SECT} ${INK_D}`, P, P_OUT, 18)}
      </View>
      <View class="flex-col gap-5">
${platformRow("darwin \u00b7 arm64", P + 620, P_OUT)}
${platformRow("linux \u00b7 x64", P + 800, P_OUT)}
      </View>
${line("450 frames \u00b7 every hash identical", `${BODY} ${SUB_D}`, P + 1040, P_OUT)}
    </View>`;

// ── Q · sub-pixel ──────────────────────────────────────────────────────────
// The one thing a browser renderer cannot show, and the hardest to put on
// screen: 0.3 px/frame is invisible at 1:1, and this reel renders at
// supersample 1, so it cannot display sub-pixel motion even if it wanted to.
//
// So it plots the measurement instead of miming it — one bar per frame, height
// = that frame's displacement. The reel already treats data this way: the
// odometer shot displays benchmark numbers rather than re-running benchmarks.
//
// The sequences are REGENERATED from the two measured parameters in
// baselines/phase1-2-acceptance.md (mean speed 0.304 and 0.293 px/frame,
// quantum 1.000 and 0.250) rather than being 36 recorded values — the baseline
// records five. Both measured invariants come back out of the reconstruction:
// the 1x row is stationary on 70% of frames, the 4x row on none.

const SAMPLES = 36;

function displacements(speed: number, quantum: number): number[] {
  const at = (n: number) => Math.round((speed * n) / quantum) * quantum;
  return Array.from({ length: SAMPLES }, (_, i) => at(i + 1) - at(i));
}

const ONE_X_SPEED = 0.304;
const ONE_X = displacements(ONE_X_SPEED, 1);
const FOUR_X = displacements(0.293, 0.25);

// At 1x a frame either moves a whole pixel or not at all, so the stationary
// fraction IS 1 - mean speed: 70%, which is the measured figure. Counting the
// 36 bars on screen gives 69% — that is the window, not the measurement, and
// the number quoted should be the one that was measured. The row illustrates
// the pattern; it is not the sample the percentage came from.
const ONE_X_STILL = Math.round((1 - ONE_X_SPEED) * 100);

/** One bar per frame. A zero frame keeps a 3px stub so the row reads as a row. */
function ticks(d: readonly number[], at: number, outAt: number, cls: string): string {
  return d
    .map((v, i) => {
      const h = v === 0 ? 3 : Math.round(v * 44);
      return `          <View class="w-[10] h-[${h}] rounded-sm ${cls} animate-${hold(at + i * 14, outAt)}" />`;
    })
    .join("\n");
}

function tickRow(label: string, note: string, d: readonly number[], at: number, outAt: number, cls: string): string {
  return `      <View class="flex-row items-center gap-9">
        <Text class="${NUM} ${INK_D} w-[110] animate-${life(at, outAt)}">{"${label}"}</Text>
        <View class="flex-row items-end gap-2 h-[48]">
${ticks(d, at + 120, outAt, cls)}
        </View>
        <Text class="${SLAB} ${DIM_D} w-[420] animate-${life(at + 700, outAt)}">{"${note}"}</Text>
      </View>`;
}

const shotQ = `    {/* Q · sub-pixel — one bar per frame, height is that frame's travel */}
    <View class="absolute inset-0 flex-col justify-center items-center gap-11">
      <View class="flex-row">
${stagger("A caption at 0.3 px/frame", `${SECT} ${INK_D}`, Q, Q_OUT, 20)}
      </View>
      <View class="flex-col gap-8">
${tickRow("1\u00d7", `still for ${ONE_X_STILL}% of frames, then a whole pixel`, ONE_X, Q + 620, Q_OUT, "bg-zinc-600")}
${tickRow("4\u00d7", "moves on every frame", FOUR_X, Q + 1060, Q_OUT, ACCENT)}
      </View>
    </View>`;

const shot4 = `    {/* 4 · what it costs — stated before anyone can discover it */}
    <View class="absolute inset-0 flex-col justify-center items-center gap-11">
      <View class="flex-row">
${stagger("It does less.", `${SECT} ${INK_D}`, D, D_OUT, 26)}
      </View>
      <View class="flex-col items-center gap-5">
${line("no blur, no glow, no blend modes", `${BODY} ${DIM_D}`, D + 560, D_OUT)}
${line("a Tailwind subset, not all of CSS", `${BODY} ${DIM_D}`, D + 740, D_OUT)}
${line("that is why it is fast, and why it is portable", `${BODY} ${SUB_D}`, D + 940, D_OUT)}
      </View>
    </View>`;

// ── 5 · lockup ─────────────────────────────────────────────────────────────
// No URL and no licence badge. The project is not public and carries no
// endorsement from PocketJS, and a repository path that resolves to nothing —
// or worse, to somebody else's — is a claim the reel cannot support. The
// wordmark and the one-line description are the whole card.

const shot5 = `    {/* 5 · the lockup */}
    <View class="absolute inset-0 flex-col justify-center items-center gap-8">
      <View class="flex-row items-center gap-6 animate-${life(E, E_OUT)}">
        <View class="w-[16] h-[64] rounded ${ACCENT}" />
        <Text class="${SECT} ${INK_D}">{"PocketJS Motion"}</Text>
      </View>
      <View class="h-[4] rounded ${ACCENT} animate-${grow(E + 380, 700, E_OUT, 560)}" />
${line("Deterministic video rendering. No browser.", `${BODY} ${DIM_D}`, E + 640, E_OUT)}
    </View>`;

const main = `// GENERATED by compositions/reel/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-zinc-950">
${room}
${shot1}
${shot2}
${shot3}
${shotP}
${shotQ}
${shot4}
${shot5}
  </View>
));
`;

await Bun.write(`${OUT}main.tsx`, main);

const config = `// GENERATED by compositions/reel/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(keyframes, null, 6).replace(/\n/g, "\n  ")},
    animation: ${JSON.stringify(animation, null, 6).replace(/\n/g, "\n  ")},
  },
});
`;
await Bun.write(`${OUT}pocket.config.ts`, config);

// The sidecar carries the mix, so it is emitted from `sound.ts` rather than
// retyped here — a second copy of the bed's numbers would drift from the one
// the storyboard reasons about. `SFX` is empty by the decision recorded in
// that file; mapping a `Cue` (ms on the beat grid, stem name) onto a sidecar
// cue (`atFrame`, path, id) is not written, so a re-added cue stops the
// generator instead of vanishing from the mix.
if (SFX.length > 0) {
  throw new Error(
    `reel: sound.ts declares ${SFX.length} cue(s) and gen.ts cannot emit them — ` +
      `write the Cue -> sidecar cue mapping before adding cues back`,
  );
}
await Bun.write(
  `${OUT}pocket-motion.json`,
  JSON.stringify(
    {
      motion: 1,
      durationFrames: FRAMES,
      fps: 30,
      supersample: 1,
      fonts: FACE_REL,
      sound: { bed: BGM },
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `reel: ${Object.keys(keyframes).length} keyframe set(s), ${Object.keys(animation).length} animation(s)\n` +
    `      ${FRAMES} frames · ${(END_MS / 1000).toFixed(2)}s · ${BARS} bars at ${BEAT.toFixed(1)} ms`,
);
