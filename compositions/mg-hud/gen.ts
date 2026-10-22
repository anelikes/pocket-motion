#!/usr/bin/env bun
/**
 * compositions/mg-hud — VEGA-7 · 织女-7 · TARGET LOCKED. A film-UI HUD.
 *
 * 10 s · 1920×1080 · 30 fps · 120 BPM. Written against the "Cyberpunk HUD /
 * FUI" prompt of github.com/Vincentwei1021/mg-styles-15 and judged by that
 * repository's rubric.md; v3 answers the second jury's notes.
 *
 * A survey satellite powers on, sweeps the East China Sea, finds a surface
 * contact off-centre on the sweep's first pass, turns the globe to bring it
 * under the crosshair and closes the lock. The brackets hold wide while the
 * lock counts up, then snap in four frames and land on the beat that flips
 * the whole frame to alert orange; the view dives into the globe and the
 * coast resolves under it in two maps of rising detail. The globe is real
 * geometry in the core's 3D: Natural Earth land sampled to dots on a sphere
 * (globe.ts). Lines are drawn in grey and tinted by one multiply layer whose
 * radial gradient carries the alert outward from the target to the corners.
 *
 * Two facts about the core shaped this file: an arc ignores its parent's
 * rotation (it is drawn from its own start angle), so every turning arc is an
 * animated arcStart; and an arc whose sweep is 0 draws as its whole box.
 *
 *   bun compositions/mg-hud/gen.ts
 *   bun src/cli/main.ts build compositions/mg-hud
 */

import { fileURLToPath } from "node:url";
import { bezier, El, glyphCell, Reg, inOut, jsxText as jsx, lerp, linear, outCubic, outExpo, rng, type Stops } from "../../src/anim/sampled.ts";
import * as raster from "../../src/image/raster.ts";
import { encodePlate, type Plate } from "../../src/image/raster.ts";
import { landDots } from "./globe.ts";

const OUT = fileURLToPath(new URL(".", import.meta.url));

// ── time ───────────────────────────────────────────────────────────────────

const FPS = 30;
const TICKS = 600;
const DUR_MS = 10_000;
const B = 30;
const reg = new Reg(TICKS, DUR_MS);

const T_SEARCH = 4 * B; // 2.0 s
const T_DETECT = 8 * B; // 4.0 s: the sweep's first pass crosses the contact
const T_LOCK = 11 * B; // 5.5 s: brackets open wide on the contact, the lock counts up
const T_FLIP = 13 * B; // 6.5 s: the snap lands and the frame flips to alert
const T_SNAP = T_FLIP - 8; // the four-frame snap that lands on the flip
const T_PUSH = T_FLIP + 4; // the dive starts a moment after the flash
const T_LAND = T_FLIP + 60; // 7.5 s: one continuous push lands on the radar image of the vessel
const T_HOLD = 17 * B; // 8.5 s: the panels step back
const T_KV = T_LAND + 4; // the Kelvin V is drawn over its wake
const T_CONF = T_FLIP + 96; // 8.1 s: CONFIRMED
const T_INT = T_LAND; // 7.5 s: the interceptor's vector is drawn in and its ETA starts counting
const T_TASK = 18 * B; // 9.0 s: the intercept is tasked
const T_ALARM = [T_LAND + 4]; // 7.57 s: the alarm sweep, answered by the border (once: a second full-frame pump read as a repeat)
const T_END = 552; // 9.2 s: the brackets flash white and the suite stands down over twelve frames; the end card holds 0.8 s


// ── frame ──────────────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;
const CX = 960;
const CY = 540;
const G = { hot: "#ffffff", mid: "#a6a6a6", low: "#7d7d7d", faint: "#3a3a3a", bg: "#1e1e1e", plate: "#0b0b0b" };
const CYAN = "#00e5ff";
const ORANGE = "#ff6a00";

// ── the contact: where the globe puts it on screen, tick by tick ───────────

const R_GLOBE = 270;
const TARGET = { lat: 31.2304, lon: 121.4737 };
const PERSP = 2600;
const M_FINAL = 34;
/** Magnification at the contact: 1 until the push, M_FINAL on the landing, eased in log space. */
const worldMag = (t: number) => (t <= T_PUSH ? 1 : M_FINAL ** inOut(Math.min(1, (t - T_PUSH) / (T_LAND - T_PUSH))));
/** How far the globe is pulled toward the camera to give `worldMag` at its near point. */
const diveZ = (t: number) => (PERSP - R_GLOBE) * (1 - 1 / worldMag(t));

/** The contact on screen for a globe turned to `lonF`, tilted by `tilt` and pulled forward by `dz`. */
function project(lonF: number, tilt: number, dz: number): { x: number; y: number; front: boolean } {
  const rad = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = R_GLOBE;
  // the core's rotateX turns +y (down) toward the viewer for a positive angle: `rotate-x-[-lat]`
  // lifts a northern dot up the screen, and this must agree or the tracking box mirrors the contact
  const rx = (th: number) => {
    const c = Math.cos(th * rad);
    const s = Math.sin(th * rad);
    [y, z] = [y * c + z * s, -y * s + z * c];
  };
  const ry = (th: number) => {
    const c = Math.cos(th * rad);
    const s = Math.sin(th * rad);
    [x, z] = [x * c + z * s, -x * s + z * c];
  };
  rx(-TARGET.lat);
  ry(TARGET.lon);
  ry(-lonF);
  rx(tilt);
  z += dz;
  const f = PERSP / (PERSP - z);
  return { x: CX + x * f, y: CY + y * f, front: z > dz };
}

/** Where the sweep finds the contact: up and right of the pivot, so the edge is seen to cross it. */
const FOUND = { x: CX + 180, y: CY - 120 };
const BEARING = (Math.atan2(FOUND.x - CX, CY - FOUND.y) * 180) / Math.PI; // clockwise from up
/** The globe's turn and tilt that put the contact at FOUND: two unknowns, Newton on a finite-difference Jacobian. */
const [LON_FOUND, TILT_FOUND] = (() => {
  let lo = TARGET.lon - 30;
  let ti = TARGET.lat - 15;
  for (let i = 0; i < 30; i++) {
    const p = project(lo, ti, 0);
    const ex = p.x - FOUND.x;
    const ey = p.y - FOUND.y;
    if (Math.hypot(ex, ey) < 1e-6) break;
    const h = 1e-4;
    const pl = project(lo + h, ti, 0);
    const pt = project(lo, ti + h, 0);
    const a = (pl.x - p.x) / h;
    const b = (pt.x - p.x) / h;
    const c = (pl.y - p.y) / h;
    const d = (pt.y - p.y) / h;
    const det = a * d - b * c;
    lo -= (d * ex - b * ey) / det;
    ti -= (-c * ex + a * ey) / det;
  }
  const check = project(lo, ti, 0);
  if (Math.hypot(check.x - FOUND.x, check.y - FOUND.y) > 0.01 || !check.front) throw new Error("mg-hud: no globe pose puts the contact at FOUND");
  return [lo, ti];
})();

/** The globe settles with the contact at FOUND on the detection beat, holds, then slews it under the crosshair. */
const T_RECENTRE = T_DETECT + 12;
const slew = (t: number) => inOut(Math.max(0, Math.min(1, (t - T_RECENTRE) / (T_LOCK - T_RECENTRE))));
const lonFront = (t: number) => (t <= T_DETECT ? lerp(-8, LON_FOUND, outCubic(t / T_DETECT)) : lerp(LON_FOUND, TARGET.lon, slew(t)));
const tiltAt = (t: number) =>
  t < T_SEARCH ? 14 : t <= T_DETECT ? lerp(14, TILT_FOUND, inOut((t - T_SEARCH) / (T_DETECT - T_SEARCH))) : lerp(TILT_FOUND, TARGET.lat, slew(t));
const targetScreen = (t: number) => project(lonFront(t), tiltAt(t), diveZ(t));

/**
 * The side panels' dark plates, drawn outside every glow layer. A glow is the
 * layer's ALPHA blurred under its content (raster.rs), so an 85 % plate inside
 * one lets 15 % of a white halo through and reads lighter than the ground.
 */
const panelPlates: string[] = [];
const writes: Promise<number>[] = [];
const images: Record<string, { linear: boolean }> = {};
function pngFile(name: string, plate: Plate, linearSample = true): string {
  const file = `${name}.png`;
  images[file] = { linear: linearSample };
  writes.push(encodePlate(plate).then((bytes) => Bun.write(`${OUT}${file}`, bytes)));
  return file;
}
const img = (file: string, w: number, h: number, cls = "") => `<Image class="w-[${w}px] h-[${h}px] ${cls}" src="${file}" />`;

const mono = (s: string, size: number, color: string, extra = "") => `<Text class="font-[code] text-[${size}px] text-[${color}] ${extra}">${jsx(s)}</Text>`;
const ui = (s: string, size: number, color: string, bold = false) => `<Text class="font-[ui] ${bold ? "font-bold" : ""} text-[${size}px] text-[${color}]">${jsx(s)}</Text>`;
const cjk = (s: string, size: number, color: string) => `<Text class="font-[cjk] font-bold text-[${size}px] text-[${color}]">${jsx(s)}</Text>`;
const at = (x: number, y: number, inner: string, cls = "", anim?: string) => `<View class="absolute left-[${x}px] top-[${y}px] ${cls} ${anim ? `animate-${anim}` : ""}">${inner}</View>`;
const rect = (x: number, y: number, w: number, h: number, color: string, cls = "", anim?: string) =>
  `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] bg-[${color}] ${cls} ${anim ? `animate-${anim}` : ""}" />`;

/** The lock's ease: fast out, slow in, no overshoot. */
const snapEase = bezier(0.16, 1, 0.3, 1);

function grow(axis: "x" | "y", t0: number, dur = 14): string {
  return reg.anim(reg.prop(axis === "x" ? "scaleX" : "scaleY", [[0, "0"], [t0, "0"], [t0 + dur, "1"]], "cubic-bezier(0.16,1,0.3,1)"));
}
function power(t0: number, until?: number): string {
  const ch: [number, string][] = [[0, "0"], [t0, "1"], [t0 + 2, "0.2"], [t0 + 4, "1"]];
  if (until !== undefined) ch.push([until, "0"]);
  return reg.step("opacity", ch);
}
function dedupe(ch: [number, string][]): [number, string][] {
  const out: [number, string][] = [];
  for (const c of ch) {
    if (out.length && out[out.length - 1]![0] === c[0]) out[out.length - 1] = c;
    else if (!out.length || out[out.length - 1]![1] !== c[1]) out.push(c);
  }
  return out;
}

// ── typewriter ─────────────────────────────────────────────────────────────

function typed(x: number, y: number, size: number, parts: [string, string][], t0: number, opts: { cps?: number; cursorUntil?: number } = {}): string {
  const per = opts.cps ?? 1;
  const cw = size * 0.6;
  let i = 0;
  const glyphs: string[] = [];
  for (const [text, color] of parts) {
    for (const ch of text) {
      if (ch !== " ") glyphs.push(at(x + i * cw, y, mono(ch, size, color), "", reg.anim(reg.window(t0 + i * per))));
      i++;
    }
  }
  const end = t0 + i * per;
  const cursorUntil = opts.cursorUntil ?? end + 18;
  const moves: [number, string][] = [[0, "0px"]];
  for (let k = 1; k <= i; k++) moves.push([t0 + k * per, `${k * cw}px`]);
  const blink: [number, string][] = [[0, "0"], [t0, "1"]];
  for (let t = end + 8; t < cursorUntil - 8; t += 16) blink.push([t, "0"], [t + 8, "1"]);
  blink.push([cursorUntil, "0"]);
  return glyphs.join("") + rect(x, y + size * 0.15, cw * 0.9, size * 1.05, G.hot, "", reg.anim([reg.step("translateX", moves), reg.step("opacity", dedupe(blink))]));
}

// ── rolling numbers: a change scrambles for a few frames, then settles; every change a hard cut ──

/**
 * A digit string through a list of [tick, value, scrambleFrames?] changes.
 * A digit that changes runs through `scramble` frames of random digits first
 * (3 unless the entry says otherwise); 0 makes the entry a plain counter step.
 */
function rolling(x: number, y: number, size: number, cellW: number, color: string, timeline: [number, string, number?][], font: "ui" | "code", seed: number, scramble = 3, fixed: number[] = []): string {
  const r = rng(seed);
  const len = timeline[0]![1].length;
  const cells: string[] = [];
  for (let c = 0; c < len; c++) {
    const seq: [number, string][] = [];
    timeline.forEach(([t, v, sc], k) => {
      const prev = k > 0 ? timeline[k - 1]![1][c] : undefined;
      const ch = v[c]!;
      const frames = sc ?? scramble;
      // frames are two ticks: every change sits on an even tick so no frame lands between two digits
      const te = t + (t % 2);
      if (k > 0 && frames > 0 && !fixed.includes(c) && /\d/.test(ch) && ch !== prev) {
        for (let s = 0; s < frames; s++) seq.push([te + s * 2, String(Math.floor(r() * 10))]);
        seq.push([te + frames * 2, ch]);
      } else seq.push([te, ch]);
    });
    cells.push(glyphCell(reg, seq, (ch) => (font === "ui" ? ui(ch, size, color, true) : mono(ch, size, color)), cellW, Math.round(size * 1.25)));
  }
  return at(x, y, `<View class="flex-row">${cells.join("")}</View>`);
}

// ═══════════════════════════════════════════════════════════════════════════
// rings, ticks, sweep — arcs turn by their start angle
// ═══════════════════════════════════════════════════════════════════════════

function arc(r: number, width: number, start: number, sweep: number, color: string, anims: string[] = [], cx = CX, cy = CY, extra = ""): string {
  const d = 2 * r;
  return `<View class="absolute left-[${cx - r}px] top-[${cy - r}px] w-[${d}px] h-[${d}px] rounded-[${r}px] bg-[${color}] arc-start-[${start}] arc-sweep-[${sweep}] arc-width-[${width}] ${extra} ${anims.length ? `animate-${reg.anim(anims)}` : ""}" />`;
}
const drawOn = (sweep: number, t0: number, dur: number) =>
  `${reg.prop("arcSweep", [[0, "0.5deg"], [t0, "0.5deg"], [t0 + dur, `${sweep}deg`]], "cubic-bezier(0.16,1,0.3,1)")}, ${reg.window(t0 + 1)}`;
/** The rings' clock: 1× until the contact, winding up to 3× into the flip, back to 1× a beat after it. */
const pace = (() => {
  const rate = (t: number) =>
    t < T_DETECT ? 1 : t < T_FLIP ? lerp(1, 3, (t - T_DETECT) / (T_FLIP - T_DETECT)) : t < T_FLIP + B ? lerp(3, 1, (t - T_FLIP) / B) : t < T_LAND ? 1 : 2.2;
  const a: number[] = [0];
  for (let t = 1; t <= TICKS; t++) a.push(a[t - 1]! + rate(t - 1));
  return (t: number) => a[Math.max(0, Math.min(TICKS, t))]!;
})();
const paced = (f: (ticks: number) => string) => Array.from({ length: TICKS / 10 + 1 }, (_, i) => [i * 10, f(pace(i * 10))] as [number, string]);
/** An arc turning at `degPerSec` on the rings' clock: its start angle. */
const turnArc = (start: number, degPerSec: number) => reg.prop("arcStart", paced((k) => `${(start + (degPerSec * k) / 60).toFixed(2)}deg`));
const spin = (degPerSec: number) => reg.prop("rotate", paced((k) => `${((degPerSec * k) / 60).toFixed(2)}deg`));

/** The reticle: what persists from boot to the end. `color` lets the CA copies reuse it. */
function reticle(color: string, faint: string, withDrawOn: boolean): string {
  const out: string[] = [];
  const d = (sweep: number, t0: number, dur: number) => (withDrawOn ? [drawOn(sweep, t0, dur)] : []);
  out.push(arc(312, 3, 0, 360, color, d(360, 8, 26)));
  // B: four heavy segments turning clockwise
  [0, 90, 180, 270].forEach((a, k) => out.push(arc(334, 7, a + 8, 64, faint, [...d(64, 18 + k * 3, 18), turnArc(a + 8, 7)])));
  // E: the two big brackets of the reticle
  out.push(arc(470, 4, 220, 100, color, d(100, 40, 22)));
  out.push(arc(470, 4, 40, 100, color, d(100, 40, 22)));
  return out.join("\n");
}

function rings(): string {
  const out: string[] = [reticle(G.hot, G.mid, true)];
  // tick ring: 120 ticks on rotated wrappers (rects do turn with their parent)
  const ticks: string[] = [];
  for (let k = 0; k < 120; k++) {
    const long = k % 10 === 0;
    const len = long ? 16 : 7;
    ticks.push(`<View class="absolute left-[${CX}px] top-[${CY}px] w-[0px] h-[0px] rotate-${k * 3}"><View class="absolute left-[-1px] top-[${-356 - len}px] w-[2px] h-[${len}px] bg-[${long ? G.hot : G.mid}] animate-${reg.anim(reg.window(22 + Math.round(k * 0.22)))}" /></View>`);
  }
  out.push(`<View class="absolute inset-0 origin-center animate-${reg.anim(spin(-4))}">${ticks.join("")}</View>`);
  // C: dashed ring turning counter-clockwise
  for (let k = 0; k < 48; k++) out.push(arc(392, 2, k * 7.5, 3.5, G.low, [reg.window(30 + Math.round(k * 0.4)), turnArc(k * 7.5, -9)]));
  // D: thin outer ring; cardinal labels sit inside it, clear of the brackets
  out.push(arc(430, 1, 0, 360, G.low, [drawOn(360, 34, 30)]));
  const cards: [string, number, number][] = [["000", CX, CY - 412], ["090", CX + 412, CY], ["180", CX, CY + 412], ["270", CX - 412, CY]];
  // 180 sits where the verdict lands, so it goes on the flip
  for (const [s, x, y] of cards) out.push(at(x - 15, y - 9, mono(s, 13, G.mid), "", reg.anim(power(44, s === "180" ? T_FLIP : undefined))));
  out.push(arc(290, 1, 0, 360, G.low, [drawOn(360, 14, 30)]));
  // from the contact to the flip the outer ring flashes on every beat, then on every half beat once the lock is counting
  const beats = [T_DETECT, T_DETECT + B, T_DETECT + 2 * B, T_LOCK, T_LOCK + B / 2, T_LOCK + B, T_LOCK + (3 * B) / 2];
  const flash: [number, string][] = [[0, "0"]];
  for (const tb of beats) flash.push([tb - 1, "0"], [tb, "0.9"], [tb + 12, "0"]);
  out.push(arc(430, 3, 0, 360, G.hot, [reg.prop("opacity", flash)]));
  return out.join("\n");
}

/**
 * Sweep angle (deg, clockwise from up) per tick: 1.8° a tick (108° a
 * second) from the survey on, phased so the edge crosses the contact's
 * bearing exactly on T_DETECT.
 */
const sweepAngle = (() => {
  const rate = (t: number) => (t < T_SEARCH ? 0 : 1.8);
  const a: number[] = [0];
  for (let t = 1; t <= TICKS; t++) a.push(a[t - 1]! + rate(t - 1));
  const shift = BEARING - a[T_DETECT]!;
  return (t: number) => a[Math.max(0, Math.min(TICKS, t))]! + shift;
})();

/** The radar: a 35° wedge fading behind the leading edge, and blips that flare as it passes. */
function radar(): string {
  const out: string[] = [];
  // the wedge and its leading edge share one rotating wrapper: an image turns with its parent, an arc does not
  const wedge = pngFile("wedge", raster.wedge(600, 300, 35, 0.42));
  const edgeRot: [number, string][] = [];
  for (let t = 0; t <= TICKS; t += 4) edgeRot.push([t, `${sweepAngle(t).toFixed(2)}deg`]);
  out.push(`<View class="absolute left-[${CX}px] top-[${CY}px] w-[0px] h-[0px] animate-${reg.anim([reg.prop("rotate", edgeRot), reg.window(T_SEARCH, T_PUSH)])}"><View class="absolute left-[-300px] top-[-300px]">${img(wedge, 600, 600)}</View>${rect(-1, -300, 2, 300, G.hot)}</View>`);
  // three earlier contacts, each on a bearing the first pass crosses before it finds C-04
  const blips: [string, number, number][] = [["C-01", 170, 210], ["C-02", 250, 150], ["C-03", 330, 236]];
  for (const [name, bearing, rr] of blips) {
    const x = CX + rr * Math.sin((bearing * Math.PI) / 180);
    const y = CY - rr * Math.cos((bearing * Math.PI) / 180);
    const el = new El(reg, { x: x - 4, y: y - 4, w: 8, h: 8 }, { op: 0 });
    let prev = sweepAngle(T_SEARCH);
    for (let t = T_SEARCH + 1; t < T_PUSH - 44; t++) {
      const cur = sweepAngle(t);
      const crossed = Math.floor((prev - bearing) / 360) !== Math.floor((cur - bearing) / 360);
      // the edge lights it: three frames of bloom, then six tenths of a second to fade
      if (crossed) el.set(t, { op: 1, sx: 2.6, sy: 2.6 }).to(t, t + 6, { sx: 1.6, sy: 1.6 }, linear).to(t + 6, t + 42, { op: 0.25, sx: 1, sy: 1 }, outCubic);
      prev = cur;
    }
    // the search's marks go with the dive: left on, they stood as stray squares over the radar picture
    el.set(T_PUSH, { op: 0 });
    out.push(el.node(`<View class="w-[8px] h-[8px] bg-[${G.hot}]" />`));
    if (name === "C-02") {
      // its first pass flags it; the AIS matches and it clears — the suite is looking for a vessel that is silent
      let p0 = sweepAngle(T_SEARCH);
      let first = 0;
      for (let t = T_SEARCH + 1; t < T_DETECT && !first; t++) {
        const c = sweepAngle(t);
        if (Math.floor((p0 - bearing) / 360) !== Math.floor((c - bearing) / 360)) first = t;
        p0 = c;
      }
      if (first) {
        out.push(at(x + 12, y + 8, `<View class="flex-row gap-[6px]">${mono("AIS MATCH", 11, G.hot)}${mono("· CLEARED", 11, G.mid)}</View>`, "", reg.anim(reg.step("opacity", [[0, "0"], [first + 4, "1"], [first + 6, "0.2"], [first + 8, "1"], [first + 44, "0"]]))));
        out.push(rect(x - 12, y - 12, 24, 24, "#00000000", `border-[${G.hot}] border`, reg.anim(reg.window(first, first + 30))));
      }
    }
    out.push(at(x + 10, y - 7, mono(name, 11, G.mid), "", reg.anim(reg.window(T_SEARCH + 10, T_FLIP))));
  }
  return out.join("\n");
}

function crosshair(): string {
  const hx = rect(0, CY - 1, W, 2, G.mid, "origin-center", grow("x", 0, 10));
  const hy = rect(CX - 1, 0, 2, H, G.mid, "origin-center", grow("y", 1, 10));
  const fade = reg.anim(reg.prop("opacity", [[0, "1"], [12, "1"], [30, "0.18"]]));
  const c = (x: number, y: number, w: number, h: number) => rect(x, y, w, h, G.hot);
  return `<View class="absolute inset-0 animate-${fade}">${hx}${hy}</View>${c(CX - 26, CY - 1, 16, 2)}${c(CX + 10, CY - 1, 16, 2)}${c(CX - 1, CY - 26, 2, 16)}${c(CX - 1, CY + 10, 2, 16)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// the globe and the dive
// ═══════════════════════════════════════════════════════════════════════════

/** The tick at which the dive reaches magnification m (the inverse of worldMag). */
const tickAtMag = (m: number) => Math.round(T_PUSH + (T_LAND - T_PUSH) * (1 - (1 - Math.log(m) / Math.log(M_FINAL)) ** (1 / 3)));
/** Ticks the globe's pose is keyed at: every 4, every 2 through the fast half of the dive. */
const poseTicks = (() => {
  const out: number[] = [];
  for (let t = 0; t < TICKS; t += t >= T_PUSH - 4 && t < T_PUSH + 60 ? 2 : 4) out.push(t);
  out.push(TICKS);
  return out;
})();

function globe(): string {
  const geo = JSON.parse(require("node:fs").readFileSync(`${OUT}data/ne_110m_land.geojson`, "utf8"));
  const dots = landDots(geo, 2.4);
  const dot = pngFile("dot", raster.disc(6, 2.6, 1, 4));
  // a dot keeps its size on screen through the dive, so the land opens into a field rather than swelling
  const dotScale = reg.prop("scale", poseTicks.filter((t) => t >= T_PUSH - 4 || t === 0).map((t) => [t, (1 / worldMag(t)).toFixed(4)] as [number, string]));
  const byLat = new Map<number, string>();
  const dotAnim = (lat: number) => {
    if (!byLat.has(lat)) byLat.set(lat, reg.anim([reg.window(36 + Math.round((80 - lat) * 0.55)), dotScale]));
    return byLat.get(lat)!;
  };
  const z0 = `absolute left-[0px] top-[0px] w-[0px] h-[0px]`;
  const nodes = dots.map(
    (d) => `<View class="${z0} rotate-y-[${d.lon}]"><View class="${z0} rotate-x-[${-d.lat}]"><View class="${z0} translate-z-[${R_GLOBE}] animate-${dotAnim(d.lat)}"><View class="absolute left-[-3px] top-[-3px]">${img(dot, 6, 6)}</View></View></View></View>`,
  );
  const ring = pngFile("ring", raster.ring(2 * R_GLOBE, R_GLOBE - 1.5, 1.6));
  const grat: string[] = [];
  const gwin = reg.anim(reg.prop("opacity", [[0, "0"], [30, "0"], [60, "0.3"], [T_PUSH, "0.3"], [T_PUSH + 6, "0"]]));
  for (let m = 0; m < 180; m += 15) grat.push(`<View class="absolute left-[${-R_GLOBE}px] top-[${-R_GLOBE}px] w-[${2 * R_GLOBE}px] h-[${2 * R_GLOBE}px] rotate-y-[${m}] animate-${gwin}">${img(ring, 2 * R_GLOBE, 2 * R_GLOBE)}</View>`);
  for (const lat of [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75]) {
    // rounded to a hundredth: a class carries its numbers as text, and 1e-14 is not a length
    const rr = Math.round(100 * R_GLOBE * Math.cos((lat * Math.PI) / 180)) / 100;
    const yy = Math.round(-100 * R_GLOBE * Math.sin((lat * Math.PI) / 180)) / 100;
    grat.push(`<View class="absolute left-[${-rr}px] top-[${yy - rr}px] w-[${2 * rr}px] h-[${2 * rr}px] rotate-x-[90] animate-${gwin}">${img(ring, 2 * rr, 2 * rr)}</View>`);
  }
  // the contact's own mark rides the globe from detection until the dive, then the lock holds the place
  const pulse: Stops = { "0%": { scale: "1" }, "40%": { scale: "1.9" }, "100%": { scale: "1" } };
  const target = `<View class="${z0} rotate-y-[${TARGET.lon}]"><View class="${z0} rotate-x-[${-TARGET.lat}]"><View class="${z0} translate-z-[${R_GLOBE + 2}] animate-${reg.anim(reg.window(T_DETECT, T_PUSH))}"><View class="absolute left-[-7px] top-[-7px] w-[14px] h-[14px] bg-[${G.hot}] rotate-45 origin-center animate-${reg.loop([reg.short(pulse, B)], B)}" /></View></View></View>`;
  const spinKeys: [number, string][] = [];
  const tiltKeys: [number, string][] = [];
  const zKeys: [number, string][] = [];
  for (const t of poseTicks) {
    spinKeys.push([t, `${(-lonFront(t)).toFixed(3)}deg`]);
    tiltKeys.push([t, `${tiltAt(t).toFixed(3)}deg`]);
    zKeys.push([t, `${diveZ(t).toFixed(2)}px`]);
  }
  // the back hemisphere at about 15 %: a dark disc at z = 0, painter-sorted between the halves. It goes with
  // the push: in a glow layer a translucent dark plate lets the halo under it through, and a disc the size of the frame reads as haze
  // a textured picture: the core's 3D path draws an untextured rounded box as a square, and a picture's diagonal seam
  // (reported to the engine) is the smaller fault
  const disc = pngFile("disc", raster.disc(2 * R_GLOBE, R_GLOBE - 2, 0.82, 1, [5, 5, 5]));
  const discEl = `<View class="absolute left-[${CX - R_GLOBE}px] top-[${CY - R_GLOBE}px] w-[${2 * R_GLOBE}px] h-[${2 * R_GLOBE}px] animate-${reg.anim([reg.prop("opacity", [[0, "0"], [29, "0"], [30, "1"], [T_PUSH, "1"], [T_PUSH + 8, "0"]]), reg.prop("translateZ", zKeys)])}">${img(disc, 2 * R_GLOBE, 2 * R_GLOBE)}</View>`;
  // the globe hands over to the wide map between ×2 and ×5 and is a faint field of points after
  // it steps back to half while the lock reads, so the brackets are the brightest thing in the lens
  const fadeOut = reg.prop("opacity", [[0, "1"], [T_LOCK, "1"], [T_LOCK + 10, "0.5"], [tickAtMag(2), "0.5"], [tickAtMag(5), "0.1"], [T_LAND, "0"]]);
  return `
    <View class="absolute inset-0 perspective-[${PERSP}] animate-${reg.anim(fadeOut)}">
      <View class="absolute left-[${CX}px] top-[${CY}px] w-[0px] h-[0px] animate-${reg.anim([reg.prop("rotateX", tiltKeys), reg.prop("translateZ", zKeys)])}">
        <View class="${z0} animate-${reg.anim(reg.prop("rotateY", spinKeys))}">
          ${grat.join("")}
          ${nodes.join("")}
          ${target}
        </View>
      </View>
      ${discEl}
    </View>`;
}

/** The rim and a hologram scan band that crosses the sphere top to bottom. */
function rimAndScan(): string {
  const rimF = pngFile("rim", raster.ring(2 * R_GLOBE + 40, R_GLOBE + 3, 2.5));
  const band = pngFile("band", (() => {
    const w = 8;
    const h = 64;
    const px = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) {
      const a = 0.22 * Math.sin((Math.PI * j) / h) ** 2;
      for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 4;
        px[k] = 255;
        px[k + 1] = 255;
        px[k + 2] = 255;
        px[k + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    return { width: w, height: h, rgba: px };
  })());
  // a limb glow: the sphere's edge brighter than its face, rising like a fresnel term and falling off just outside
  const limbN = 2 * (R_GLOBE + 30);
  const limb = pngFile("limb", (() => {
    const px = new Uint8Array(limbN * limbN * 4);
    for (let j = 0; j < limbN; j++) {
      for (let i = 0; i < limbN; i++) {
        const r = Math.hypot(i + 0.5 - limbN / 2, j + 0.5 - limbN / 2) / R_GLOBE;
        const a = r <= 1 ? 0.32 * r ** 8 : 0.32 * Math.exp(-((r - 1) * R_GLOBE) / 7);
        const o = (j * limbN + i) * 4;
        px[o] = 255;
        px[o + 1] = 255;
        px[o + 2] = 255;
        px[o + 3] = Math.round(a * 255);
      }
    }
    return { width: limbN, height: limbN, rgba: px };
  })());
  const scan: Stops = { "0%": { translateY: `${-80}px` }, "100%": { translateY: `${2 * R_GLOBE + 20}px` } };
  const gone = reg.prop("opacity", [[0, "0"], [40, "0"], [44, "1"], [T_PUSH, "1"], [T_PUSH + 20, "0"]]);
  return `
    ${at(CX - limbN / 2, CY - limbN / 2, img(limb, limbN, limbN), "", reg.anim(reg.prop("opacity", [[0, "0"], [40, "0"], [60, "1"], [T_PUSH, "1"], [T_PUSH + 12, "0"]])))}
    ${at(CX - R_GLOBE - 20, CY - R_GLOBE - 20, img(rimF, 2 * R_GLOBE + 40, 2 * R_GLOBE + 40), "", reg.anim(reg.prop("opacity", [[0, "0"], [39, "0"], [40, "1"], [41, "1"], [42, "0.2"], [43, "0.2"], [44, "1"], [T_PUSH, "1"], [T_PUSH + 16, "0"]])))}
    <View class="absolute left-[${CX - R_GLOBE}px] top-[${CY - R_GLOBE}px] w-[${2 * R_GLOBE}px] h-[${2 * R_GLOBE}px] rounded-[${R_GLOBE}px] overflow-mask animate-${reg.anim(gone)}">
      <View class="absolute left-[0px] top-[0px] animate-${reg.loop([reg.short(scan, 90)], 90)}">${img(band, 2 * R_GLOBE, 64)}</View>
    </View>`;
}

/**
 * The coast the dive lands on, in two maps of rising detail: a wide one at ×8
 * with a 5° graticule takes over from the globe, a close one at ×34 with a 1°
 * graticule takes over from that. Each is an orthographic map about the
 * contact, scaled by the same magnification the globe is following, with a
 * soft edge baked in so neither shows where its data stops.
 */
function coastMap(name: string, m: number, size: number, grid: number, fade: [number, number], core: number, glow: number): { file: string; proj: (lon: number, lat: number) => [number, number] } {
  const data = JSON.parse(require("node:fs").readFileSync(`${OUT}data/coast-east-china.json`, "utf8")) as { lines: number[][][] };
  const rad = Math.PI / 180;
  const k = R_GLOBE * m;
  const proj = (lon: number, lat: number): [number, number] => {
    const φ = lat * rad;
    const φ0 = TARGET.lat * rad;
    const dλ = (lon - TARGET.lon) * rad;
    const x = Math.cos(φ) * Math.sin(dλ);
    const y = Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(dλ);
    return [size / 2 + x * k, size / 2 - y * k];
  };
  const lines = data.lines.map((l) => l.map(([lo, la]) => proj(lo!, la!)));
  const grat: [number, number][][] = [];
  for (let lo = 100; lo <= 140; lo += grid) grat.push(Array.from({ length: 61 }, (_, j) => proj(lo, 15 + j * 0.5)));
  for (let la = 15; la <= 45; la += grid) grat.push(Array.from({ length: 81 }, (_, j) => proj(100 + j * 0.5, la)));
  return { file: pngFile(name, raster.polylines(size, size, lines, core, glow, grat, { r0: fade[0], r1: fade[1] }, 0.55)), proj };
}

/** The coast's lens: just inside the reticle's main ring (312), so neither the map nor the radar picture crosses the ring band. */
const LENS = 308;
/** The radar picture's slow push after the dive lands, shared by the picture and what is drawn on it. */
const sarPush = () => reg.prop("scale", [[0, "1"], [T_LAND, "1"], [TICKS, "1.06"]], "cubic-bezier(0.25,0.1,0.25,1)");
const SAR_K = 4; // the radar picture's scale: the hull is 36 k px long
const OTHERS: [number, number][] = [
  [0.2, 0.66],
  [0.8, 0.28],
  [0.84, 0.74],
];

function coast(): string {
  const wide = coastMap("coast-wide", 8, 1000, 5, [360, 495], 1.4, 5);
  const keys: [number, string][] = [[0, (1 / 8).toFixed(4)]];
  for (let t = T_PUSH; t <= T_LAND; t += 2) keys.push([t, (worldMag(t) / 8).toFixed(4)]);
  const map = `<View class="absolute left-[${LENS - 500}px] top-[${LENS - 500}px] w-[1000px] h-[1000px] origin-center animate-${reg.anim([reg.prop("scale", keys), reg.prop("opacity", [[0, "0"], [tickAtMag(2), "0"], [tickAtMag(4), "1"], [tickAtMag(9), "1"], [tickAtMag(13), "0"]])])}">${img(wide.file, 1000, 1000)}</View>`;
  // the radar picture is the last stage of the same zoom: it grows with the magnification from ×8, so the
  // push never cuts; then it keeps pushing in slowly for the rest of the film
  const S = 2 * LENS;
  const sarLens = pngFile(
    "sar-lens",
    raster.sar(S, 11, true, 72, [0.5, 0.5], SAR_K, 1.25, { clutter: 0.36, grain: 2.5, arms: 1.1, chevrons: false, shore: { side: "top", depth: 0.13, rough: true }, others: OTHERS, vignette: { r0: 0.8, r1: 1 } }),
    false,
  );
  const sk: [number, string][] = [[0, (1 / M_FINAL).toFixed(4)]];
  for (let t = T_PUSH; t <= T_LAND; t += 2) sk.push([t, (worldMag(t) / M_FINAL).toFixed(4)]);
  const zoom = reg.prop("scale", sk);
  const sar = `<View class="absolute left-[0px] top-[0px] w-[${S}px] h-[${S}px] origin-center animate-${reg.anim([reg.prop("opacity", [[0, "0"], [tickAtMag(8), "0"], [tickAtMag(12), "1"]]), zoom])}"><View class="absolute inset-0 origin-center animate-${reg.anim(sarPush())}">${img(sarLens, S, S)}
      ${OTHERS.map(([fx, fy]) => {
        // each other vessel's marker flares when the sweep's edge crosses its bearing, and decays over two thirds of a second
        const brg = (((Math.atan2(fx * S - S / 2, S / 2 - fy * S) * 180) / Math.PI) + 360) % 360;
        const ch: [number, string][] = [[0, "0.25"]];
        let prev = sweepAngle(T_LAND);
        for (let t = T_LAND + 1; t < TICKS - 1; t++) {
          const cur = sweepAngle(t);
          if (Math.floor((prev - brg) / 360) !== Math.floor((cur - brg) / 360)) ch.push([t - 1, "0.25"], [t, "1"], [t + 20, "0.25"]);
          prev = cur;
        }
        return `<View class="absolute left-[${fx * S - 9}px] top-[${fy * S - 9}px] w-[18px] h-[18px] border-[${G.hot}] border-2 rotate-45 animate-${reg.anim(reg.prop("opacity", ch))}" /><View class="absolute left-[${fx * S + 14}px] top-[${fy * S - 8}px]">${mono(`C-0${5 + OTHERS.findIndex((o) => o[0] === fx)} AIS`, 11, G.mid)}</View>`;
      }).join("")}
    </View></View>`;
  // range rings: one a beat out from the hull once the push has landed, the alarm's own pulse
  const pr = pngFile("pulse", raster.ring(2 * LENS, LENS - 4, 2));
  const pulse: Stops = { "0%": { scale: "0.14", opacity: "0.85" }, "100%": { scale: "1", opacity: "0" } };
  const pulses = `<View class="absolute inset-0 animate-${reg.anim(reg.window(T_LAND))}"><View class="absolute inset-0 origin-center animate-${reg.loop([reg.short(pulse, B, "cubic-bezier(0.16,1,0.3,1)")], B)}">${img(pr, 2 * LENS, 2 * LENS)}</View></View>`;
  return `
    <View class="absolute left-[${CX - LENS}px] top-[${CY - LENS}px] w-[${2 * LENS}px] h-[${2 * LENS}px] rounded-[${LENS}px] overflow-mask">
      ${map}
      ${sar}
      ${pulses}
    </View>
    <View class="absolute inset-0 origin-center animate-${reg.anim(sarPush())}">${kelvinOverlay()}${interceptVector()}</View>`;
}

/**
 * The hull as a crisp outline over its radar return — 182 m, a pointed bow,
 * a square stern, on its 072° heading — rasterised already turned, so it is
 * never a turned quad.
 */
function hullPlate(): Plate {
  const n = 400; // 200 layout px at 2×
  const hdg = (72 * Math.PI) / 180;
  const [ax, ay] = [Math.sin(hdg), -Math.cos(hdg)];
  const L = 18 * SAR_K;
  const pts: [number, number][] = [[-L, -11], [L - 30, -11], [L, 0], [L - 30, 11], [-L, 11]];
  const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as [[number, number], [number, number]]);
  const px = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / 2 - 100;
      const y = (j + 0.5) / 2 - 100;
      // into the hull's own frame: u along the heading, v across it
      const u = x * ax + y * ay;
      const v = -x * ay + y * ax;
      let d = Infinity;
      let inside = false;
      for (const [[x0, y0], [x1, y1]] of segs) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const k = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy)));
        d = Math.min(d, Math.hypot(u - x0 - k * dx, v - y0 - k * dy));
        if ((y0 > v) !== (y1 > v) && u < x0 + ((v - y0) * dx) / dy) inside = !inside;
      }
      const line = Math.max(0, Math.min(1, 1.1 - d * 2 + 0.5));
      const a = Math.max(line, inside ? 0.22 : 0);
      const o = (j * n + i) * 4;
      px[o] = 255;
      px[o + 1] = 216;
      px[o + 2] = 176;
      px[o + 3] = Math.round(a * 255);
    }
  }
  return { width: n, height: n, rgba: px };
}

/**
 * The Kelvin V drawn on the real wake: the hull outlined as the push lands,
 * then from the stern two arms at ±19.47° to the track, drawn on over twenty
 * frames, and the angle between them.
 */
function kelvinOverlay(): string {
  // the apex where sar() puts it: its arms are measured back from the hull's centre (raster.ts), so drawn from the
  //   stern the overlay sat 72 px off the wake it annotates
  const sx = CX;
  const sy = CY;
  const out: string[] = [];
  for (const deg of [252 - 19.47, 252 + 19.47]) {
    out.push(`<View class="absolute left-[${sx.toFixed(1)}px] top-[${(sy - 1).toFixed(1)}px] w-[200px] h-[2px] bg-[${G.hot}] origin-left rotate-${(deg - 90).toFixed(2)} animate-${grow("x", T_KV, 40)}" />`);
  }
  out.push(arc(130, 1.5, 252 - 19.47, 38.94, G.hot, [drawOn(38.94, T_KV + 30, 14)], sx, sy));
  return out.join("\n");
}

/** The hull, white above the alert's tint so the target is not the chrome's colour, riding the chip's slow push. */
function hullTop(): string {
  // the vector outline read as clip-art over the radar picture: the hull is the radar's own return now
  return "";
}

/**
 * The vessel's projected course: dashes run out from the bow along its 072°
 * heading over 8.1–9.0 s, toward the HUANGPU the track panel names.
 */
function course(): string {
  const hdg = (72 * Math.PI) / 180;
  const [ux, uy] = [Math.sin(hdg), -Math.cos(hdg)];
  const out: string[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 92 + i * 24;
    out.push(rect(CX + ux * r - 6, CY + uy * r - 1, 12, 2, G.hot, `origin-center rotate-${(72 - 90 + 360).toFixed(1)}`, reg.anim(reg.window(T_CONF + 4 + i * 6, T_END))));
  }
  out.push(at(CX + ux * 250 - 30, CY + uy * 250 - 34, mono("HUANGPU 072°", 13, G.hot), "", reg.anim(power(T_CONF + 52, T_END))));
  return `<View class="absolute inset-0 origin-center animate-${reg.anim(sarPush())}">${out.join("")}</View>`;
}

/** The value of the angle and what it gives, on a plate: drawn above the rings. */
/** 19.47° lifts off the KELVIN WAKE panel and flies onto the arc drawn on the picture: the panel's physics becomes the evidence. */
function kelvinFly(lx: number, ly: number): string {
  const t0 = T_KV + 26;
  const from = { x: RX + CW - 64 - 236, y: 262 - 12 };
  const el = new El(reg, { x: lx - 70, y: ly - 18, w: 120, h: 30 }, { cx: from.x + 60, cy: from.y + 15, op: 0 });
  el.set(t0, { op: 1 }).to(t0, t0 + 14, { cx: lx - 10, cy: ly - 3 }, (u) => 1 - (1 - u) ** 3).set(t0 + 15, { op: 0 });
  return el.node(ui("19.47°", 22, G.hot, true));
}

function kelvinLabel(): string {
  const sx = CX;
  const sy = CY;
  const lx = sx + 170 * Math.sin((252 * Math.PI) / 180);
  const ly = sy - 170 * Math.cos((252 * Math.PI) / 180);
  return `${kelvinFly(lx, ly)}<View class="absolute left-[${(lx - 70).toFixed(0)}px] top-[${(ly - 18).toFixed(0)}px] w-[176px] h-[36px] animate-${reg.anim(power(T_KV + 40))}"><View class="absolute inset-0 bg-[${G.plate}] opacity-85" /><View class="absolute inset-0 flex-row items-center justify-center gap-[8px]">${ui("19.47°", 22, G.hot, true)}${mono("→ 18.4 KN", 13, G.hot)}</View></View>`;
}

/** CONFIRMED: the evidence agrees with the lock — beside the brackets, above the rings. */
function confirmStamp(): string {
  const flick = reg.anim(reg.step("opacity", [[0, "0"], [T_CONF, "1"], [T_CONF + 2, "0"], [T_CONF + 4, "1"]]));
  return `<View class="absolute left-[${HERO.x + HERO.w - 196}px] top-[${HERO.y + HERO.h - 42}px] w-[180px] h-[34px] animate-${flick}"><View class="absolute inset-0 bg-[${G.plate}]" /><View class="absolute inset-0 border-[${G.hot}] border-2" /><View class="absolute inset-0 flex-row items-center justify-center gap-[8px]">${ui("CONFIRMED", 20, G.hot, true)}${cjk("确认", 16, G.hot)}</View></View>`;
}

/** The cutter's vector into the lens from its bearing, dotted on, the cutter creeping along it. */
function interceptVector(): string {
  const brg = (248 * Math.PI) / 180;
  const ux = Math.sin(brg);
  const uy = -Math.cos(brg);
  const r0 = 440;
  const r1 = LOCK_S / 2 + 30;
  const out: string[] = [];
  const n = 16;
  // dotted on over twenty-four frames from the cutter's bearing, a dash every three ticks
  for (let i = 0; i < n; i++) {
    const r = r0 - ((r0 - r1) * i) / (n - 1);
    out.push(rect(CX + ux * r - 4, CY + uy * r - 1, 8, 2, G.hot, `origin-center rotate-${((brg * 180) / Math.PI - 90).toFixed(1)}`, reg.anim(reg.window(T_INT + 3 * i))));
  }
  const cutter = new El(reg, { x: CX + ux * r0 - 8, y: CY + uy * r0 - 8, w: 16, h: 16 }, { op: 0 });
  cutter.set(T_INT, { op: 1 }).to(T_INT, TICKS, { cx: CX + ux * (r0 - 90), cy: CY + uy * (r0 - 90) }, linear);
  out.push(cutter.node(`<View class="w-[16px] h-[16px] bg-[${G.hot}] rotate-45" />`));
  out.push(at(CX + ux * r0 - 124, CY + uy * r0 + 18, mono("CG-2108", 13, G.hot), "", reg.anim(power(T_INT + 6))));
  return out.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// tracking and lock
// ═══════════════════════════════════════════════════════════════════════════

function corner(s: number, len: number, thick: number, color: string, which: 0 | 1 | 2 | 3): string {
  const c = (x: number, y: number, w: number, h: number) => rect(x, y, w, h, color);
  if (which === 0) return c(0, 0, len, thick) + c(0, 0, thick, len);
  if (which === 1) return c(s - len, 0, len, thick) + c(s - thick, 0, thick, len);
  if (which === 2) return c(s - len, s - thick, len, thick) + c(s - thick, s - len, thick, len);
  return c(0, s - thick, len, thick) + c(0, s - len, thick, len);
}

function tracking(): string {
  const S = 64;
  const out: string[] = [];
  // the sweep finds the contact: a ring bursts out of it on the beat
  const burst = pngFile("burst", raster.ring(120, 56, 2.2));
  const b = new El(reg, { x: FOUND.x - 60, y: FOUND.y - 60, w: 120, h: 120 }, { op: 0, sx: 0.2, sy: 0.2 });
  b.set(T_DETECT, { op: 1, sx: 0.25, sy: 0.25 }).to(T_DETECT, T_DETECT + 20, { op: 0, sx: 1.6, sy: 1.6 }, outCubic);
  out.push(b.node(img(burst, 120, 120)));
  const el = new El(reg, { x: CX - S / 2, y: CY - S / 2, w: S, h: S }, { op: 0 });
  el.path(T_DETECT, T_LOCK, (t) => {
    const p = targetScreen(t);
    return { cx: p.x, cy: p.y, op: p.front ? 1 : 0 };
  }, 2);
  el.set(T_LOCK + 1, { op: 0 });
  const label = new El(reg, { x: CX + S / 2 + 14, y: CY - S / 2 - 6, w: 250, h: 40 }, { op: 0 });
  label.path(T_DETECT + 6, T_LOCK, (t) => {
    const p = targetScreen(t);
    return { cx: p.x + S / 2 + 14 + 125, cy: p.y - S / 2 - 6 + 20, op: p.front ? 1 : 0 };
  }, 2);
  label.set(T_LOCK + 1, { op: 0 });
  const inner = [0, 1, 2, 3].map((k) => corner(S, 14, 2, G.hot, k as 0)).join("");
  out.push(el.node(`${inner}<View class="absolute left-[${S / 2 - 3}px] top-[${S / 2 - 3}px] w-[6px] h-[6px] bg-[${G.hot}]" />`));
  out.push(label.node(`<View class="absolute left-[-8px] top-[-4px] w-[214px] h-[48px] bg-[${G.plate}]" /><View class="flex-col">${mono("C-04 · DARK VESSEL", 14, G.hot)}${mono("AIS OFF 02:47 · WAKE", 13, G.mid)}</View>`));
  return out.join("\n");
}

/**
 * The lock. Four corners, each its own piece, open at 1.8 of a 140 px box on
 * the contact, turned 45°, on T_LOCK; from a fifth of a second later they
 * spin square and close to 1.3 while LOCK counts up, then close the last of the way in
 * four frames that arrive at speed on T_FLIP, the frame the alert fires, bite
 * to 0.94 and settle. Through the dive the box opens with the zoom to frame
 * the vessel the contact turns out to be. The corners move rather than scale,
 * so their strokes keep their weight at every size.
 */
const T_RAMP = T_LOCK + 6;
const T_SNAP_IN = T_FLIP - 8;
const T_HELD = T_FLIP - 18; // f186: the brackets are square at 1.4 and hold for the snap
const LOCK_D = 70; // half the box the brackets close on: 140 px around the contact
const VESSEL_D = 130; // half the box they open to as the push lands on the vessel
const LOCK_S = 2 * VESSEL_D;
const lockD = (t: number): number => {
  if (t < T_RAMP) return 1.8 * LOCK_D;
  if (t < T_HELD) return lerp(1.8 * LOCK_D, 1.4 * LOCK_D, inOut((t - T_RAMP) / (T_HELD - T_RAMP)));
  if (t < T_SNAP_IN) return 1.4 * LOCK_D;
  if (t <= T_FLIP) return lerp(1.4 * LOCK_D, LOCK_D, ((t - T_SNAP_IN) / (T_FLIP - T_SNAP_IN)) ** 2);
  if (t <= T_FLIP + 2) return lerp(LOCK_D, 0.97 * LOCK_D, (t - T_FLIP) / 2);
  if (t <= T_FLIP + 4) return lerp(0.97 * LOCK_D, LOCK_D, (t - T_FLIP - 2) / 2);
  // the lock holds its box through the dive (opening with the zoom read as letting go), then locks again on the vessel
  //   the push lands on: open at 1.4 of the vessel's box, four frames in at speed, a one-frame bite
  if (t <= T_LAND - 8) return LOCK_D;
  if (t <= T_LAND) return lerp(1.4 * VESSEL_D, VESSEL_D, ((t - (T_LAND - 8)) / 8) ** 2);
  if (t <= T_LAND + 2) return lerp(VESSEL_D, 0.97 * VESSEL_D, (t - T_LAND) / 2);
  if (t <= T_LAND + 4) return lerp(0.97 * VESSEL_D, VESSEL_D, (t - T_LAND - 2) / 2);
  return VESSEL_D;
};
const lockRot = (t: number): number => (t < T_RAMP ? 45 : t < T_HELD ? lerp(45, 0, inOut((t - T_RAMP) / (T_HELD - T_RAMP))) : 0);
/** LOCK's reading through the spin and the snap: slow while it turns, fast as it bites. */
const lockPct = (t: number) => Math.round(100 * Math.max(0, Math.min(1, (t - T_RAMP) / (T_FLIP - T_RAMP))) ** 1.6);
const CORNER = 64;
/** At 100 % the lock blinks twice: two frames dark, two lit, two dark. */
const blinkOp = (t: number) => ((t >= T_FLIP + 4 && t < T_FLIP + 6) || (t >= T_FLIP + 10 && t < T_FLIP + 12) ? 0.15 : 1);
const SIGNS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/** Where corner k's 64 px piece sits at tick t: its outer corner on the box, the whole set turned about the contact. */
const cornerPose = (k: number, t: number) => {
  const [sx, sy] = SIGNS[k]!;
  const d = lockD(t) - CORNER / 2;
  const th = (lockRot(t) * Math.PI) / 180;
  return { cx: CX + sx * d * Math.cos(th) - sy * d * Math.sin(th), cy: CY + sx * d * Math.sin(th) + sy * d * Math.cos(th), rot: lockRot(t) };
};

function bracketEls(color: string, thick: number, op: number, only?: [number, number][]): string {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    const el = new El(reg, { x: CX - CORNER / 2, y: CY - CORNER / 2, w: CORNER, h: CORNER }, { ...cornerPose(k, 0), op: 0 });
    if (only) {
      for (const [a, z] of only) el.set(a, { ...cornerPose(k, a), op }).set(z, { op: 0 });
    } else {
      const t0 = T_LOCK + k * 2;
      // the pose every tick from the lock opening through the spin, the snap and the dive, with the power-on flicker
      //   and the two blinks at 100 % in the same pass: keys are written in time order
      const powerOn = (t: number) => (t < t0 ? 0 : t < t0 + 2 ? 1 : t < t0 + 4 ? 0.2 : 1);
      el.path(T_LOCK, T_LAND + 4, (t) => ({ ...cornerPose(k, t), op: powerOn(t) * blinkOp(t) }));
    }
    out.push(el.node(corner(CORNER, 40, thick, color, k as 0)));
  }
  return out.join("\n");
}

/** The brackets again, following the pose every tick, at the opacity `opAt` gives: written in time order. */
function bracketCopy(color: string, thick: number, opAt: (t: number) => number): string {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    const el = new El(reg, { x: CX - CORNER / 2, y: CY - CORNER / 2, w: CORNER, h: CORNER }, { ...cornerPose(k, 0), op: 0 });
    el.path(T_RAMP, T_LAND + 4, (t) => ({ ...cornerPose(k, t), op: opAt(t) }));
    let prev = opAt(T_LAND + 4);
    for (let t = T_LAND + 5; t <= TICKS; t++) {
      const v = opAt(t);
      if (v !== prev) el.set(t, { op: v });
      prev = v;
    }
    out.push(el.node(corner(CORNER, 40, thick, color, k as 0)));
  }
  return out.join("\n");
}

function lock(): string {
  const out: string[] = [bracketEls(G.hot, 5, 1)];
  // LOCK % rides under the bracket's bottom-left corner, a new reading every frame, and blinks with it at 100
  const pct: [number, string, number?][] = [[0, "000"], ...series(T_RAMP, T_FLIP, (t) => String(lockPct(t)).padStart(3, "0"))];
  const tag = new El(reg, { x: CX - 70, y: CY + 70, w: 120, h: 26 }, { op: 0 });
  tag.set(T_LOCK + 6, { op: 1, cx: CX - lockD(T_LOCK) + 60, cy: CY + lockD(T_LOCK) + 25 });
  tag.path(T_RAMP, T_PUSH + 8, (t) => ({ cx: CX - lockD(t) + 60, cy: CY + lockD(t) + 25, op: t >= T_PUSH + 8 ? 0 : blinkOp(t) }));
  out.push(tag.node(`<View class="absolute inset-0 flex-row items-center gap-[6px]">${mono("LOCK", 13, G.mid)}${rolling(0, 0, 18, 11, G.hot, pct, "code", 3).replace('class="absolute left-[0px] top-[0px] "', 'class=""')}${mono("%", 15, G.hot)}</View>`));
  // GSD: what one pixel of the lens covers on the ground, from the globe's 23.6 km down through the dive, and the
  //   radar chip's 1.3 m once it lands — read off the same curve the zoom follows
  const gsd: [number, string, number?][] = [[0, "23600"], ...series(T_PUSH, T_LAND - 2, (t) => String(Math.round(23600 / worldMag(t))).padStart(5, "0")), [T_LAND, "001.3", 3]];
  out.push(`<View class="absolute inset-0 animate-${reg.anim(reg.window(T_PUSH, T_END + 2))}">
    ${rect(CX + 196, CY - 334, 176, 30, G.plate)}
    ${at(CX + 204, CY - 327, mono("GSD", 13, G.mid))}
    ${rolling(CX + 240, CY - 332, 20, 12, G.hot, gsd, "code", 5)}
    ${at(CX + 306, CY - 327, mono("M/PX", 13, G.mid))}
  </View>`);
  return out.join("\n");
}

/** The brackets once more, white, for the frame they land and the two the film ends on: drawn above the tint, so the bite reads as light. */
function lockCore(): string {
  // the white flashes on the hit and the stand-down, and from the hit on a white-hot core inside the orange stroke
  const flash = (t: number) => ((t >= T_FLIP && t < T_FLIP + 2) || (t >= T_END && t < T_END + 4) ? 1 : 0);
  return bracketCopy("#ffffff", 3, flash) + bracketCopy("#ffd8b0", 2, (t) => (flash(t) ? 0 : t >= T_FLIP + 2 ? 0.6 : 0));
}

/**
 * The alert's front: a hot ring riding the edge of the recolour as it runs
 * out from the contact, so the wave reads as light passing rather than a
 * disc appearing. The tint's front is gradVia1Pos of the gradient's radius
 * (960·√2, the farthest corner of its square box) through the same
 * cubic-bezier, so ring and tint agree on every tick.
 */
const TINT_RUN = 16;
function alertFront(): string {
  const R = 880;
  const p = raster.ring(1800, R, 4, 1);
  for (let i = 0; i < p.rgba.length; i += 4) [p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]] = [255, 214, 168];
  const file = pngFile("front", p);
  const el = new El(reg, { x: CX - 900, y: CY - 900, w: 1800, h: 1800 }, { op: 0, sx: 0.01, sy: 0.01 });
  el.set(T_FLIP, { op: 1 }).path(T_FLIP, T_FLIP + TINT_RUN, (t) => {
    const u = (t - T_FLIP) / TINT_RUN;
    const s = Math.max(0.01, (snapEase(u) * 0.85 * 960 * Math.SQRT2) / R);
    return { sx: s, sy: s, op: 1 - 0.7 * u };
  });
  el.set(T_FLIP + TINT_RUN + 1, { op: 0 });
  return el.node(img(file, 1800, 1800));
}

/**
 * The verdict, one block on the foot of the rings, tied to the lock by a
 * leader dropped from the box: 目标锁定 and TARGET LOCKED on the first line,
 * the coordinates under them as large as the clock, the priority and, from
 * 8.1 s, CONFIRMED under those. It lands with the hit, on the flip's own
 * frame; for its first two frames a white copy above the tint burns it in
 * (heroHot), then the alert's orange takes it. Its plate sits outside every
 * glow layer (bandPlates), so it quiets the rings under it without haze.
 */
const HERO = { x: CX - 370, y: CY + 286, w: 740, h: 182 };
const bandPlates: string[] = [];
const SHADES = "▓▒░█";
/** The title: each glyph a block for a frame, a lighter block for a frame, then itself, a tick apart, landing on the hit. */
function heroTitle(c: string): string {
  const cell = (ch: string, i: number, w: number, draw: (g: string) => string) =>
    glyphCell(reg, [[T_FLIP - 4 + i, SHADES[i % 2]!], [T_FLIP - 2 + i, SHADES[(i + 1) % 2]!], [T_FLIP + i, ch]], (g) => (SHADES.includes(g) ? mono(g, 48, c) : draw(g)), w, 92);
  const zh = [..."目标锁定"].map((ch, i) => cell(ch, i, 88, (g) => cjk(g, 82, c))).join("");
  const en = [..."TARGET LOCKED"].map((ch, i) => (ch === " " ? `<View class="w-[11px] h-[72px]" />` : cell(ch, i + 2, 24, (g) => ui(g, 42, c, true)))).join("");
  // the slam: 1.15 to 1 over four frames as the hit lands
  const slam = reg.anim(reg.prop("scale", [[0, "1.15"], [T_FLIP, "1.15"], [T_FLIP + 8, "1"]], "cubic-bezier(0.16,1,0.3,1)"));
  return `<View class="absolute left-[${HERO.x}px] top-[${HERO.y + 4}px] w-[${HERO.w}px] h-[92px] flex-row justify-center items-end gap-[22px] origin-center animate-${slam}"><View class="flex-row">${zh}</View><View class="flex-row">${en}</View></View>`;
}
/** A hazard cap: diagonal stripes across the plate's end. */
function hazard(): string {
  return pngFile("hazard", (() => {
    const w = 28;
    const h = HERO.h;
    const px = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const on = ((i + j) % 16) < 8;
        const o = (j * w + i) * 4;
        px[o] = 255;
        px[o + 1] = 255;
        px[o + 2] = 255;
        px[o + 3] = on ? 200 : 0;
      }
    }
    return { width: w, height: h, rgba: px };
  })(), false);
}
function lockup(): string {
  const out: string[] = [];
  const show = reg.anim(reg.window(T_FLIP));
  // solid, so the rings under it are cut out rather than seen through it, with a closed keyline
  bandPlates.push(rect(HERO.x, HERO.y, HERO.w, HERO.h, "#140600", "", show));
  out.push(`<View class="absolute left-[${HERO.x}px] top-[${HERO.y}px] w-[${HERO.w}px] h-[${HERO.h}px] border-[${G.hot}] border animate-${show}" />`);
  // the verdict's plate ends in two heavy rules rather than hazard caps (the reference's banner carries those)
  out.push(rect(HERO.x - 8, HERO.y, 4, HERO.h, G.hot, "", show), rect(HERO.x + HERO.w + 4, HERO.y, 4, HERO.h, G.hot, "", show));
  out.push(rect(HERO.x, HERO.y, HERO.w, 2, G.hot, "origin-center", grow("x", T_FLIP - 4, 8)));
  // the leader, dropped from the box's foot to the block as the brackets close; it goes with the rings
  out.push(`<View class="absolute left-[${CX - 1}px] top-[${CY + LOCK_D}px] w-[2px] h-[${HERO.y - CY - LOCK_D}px] bg-[${G.hot}] origin-top animate-${reg.anim([reg.prop("scaleY", [[0, "0"], [T_FLIP - 6, "0"], [T_FLIP, "1"]], "cubic-bezier(0.16,1,0.3,1)"), reg.window(0, T_END + 8)])}" />`);
  out.push(heroTitle(G.hot));
  out.push(arc(LENS + 4, 2, 0, 360, G.hot, [reg.window(T_END + 10)]));
  // the coordinates type in under it, two frames a character, behind a block cursor
  const coord = "N31°14′  E121°29′";
  out.push(typed(CX - Math.round((coord.length * 32 * 0.6) / 2), HERO.y + 100, 32, [[coord, G.hot]], T_FLIP + 8, { cps: 4, cursorUntil: T_FLIP + 8 + coord.length * 4 + 24 }));
  out.push(at(HERO.x + 24, HERO.y + HERO.h - 34, `<View class="flex-row items-center gap-[8px]">${mono("PRIORITY 1", 15, G.mid)}${mono("·", 14, G.mid)}${cjk("一级优先", 16, G.mid)}</View>`, "", reg.anim(power(T_FLIP + 20, T_END + 12))));
  return out.join("\n");
}
/** The title's first two frames, white, above the tint: the hit burns it in before the orange takes it. */
function heroHot(): string {
  return `<View class="absolute inset-0 glow-[16px] glow-[#ffffff] glow-gain-[1.4] animate-${reg.anim(reg.window(T_FLIP, T_FLIP + 4))}">${heroTitle("#ffffff")}</View>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// panels
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A panel draws itself on: its outline runs round the perimeter as four
 * lines, the dark plate fills in behind, and the corner marks power on last.
 */
function panelFrame(x: number, y: number, w: number, h: number, t0: number): string {
  const L = 16;
  const c = (xx: number, yy: number, ww: number, hh: number) => rect(xx, yy, ww, hh, G.mid);
  const k = `${c(x, y, L, 2)}${c(x, y, 2, L)}${c(x + w - L, y, L, 2)}${c(x + w - 2, y, 2, L)}${c(x, y + h - 2, L, 2)}${c(x, y + h - L, 2, L)}${c(x + w - L, y + h - 2, L, 2)}${c(x + w - 2, y + h - L, 2, L)}`;
  const edges = [
    rect(x, y, w, 1, G.low, "origin-left", grow("x", t0, 16)),
    rect(x + w - 1, y, 1, h, G.low, "origin-top", grow("y", t0 + 8, 22)),
    rect(x, y + h - 1, w, 1, G.low, "origin-right", grow("x", t0 + 16, 16)),
    rect(x, y, 1, h, G.low, "origin-bottom", grow("y", t0 + 24, 22)),
  ].join("");
  const fill = reg.anim(reg.prop("opacity", [[0, "0"], [t0 + 30, "0"], [t0 + 50, "0.8"]]));
  panelPlates.push(`<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] bg-[${G.plate}] animate-${fill}" />`);
  return `${edges}<View class="absolute inset-0 animate-${reg.anim(power(t0 + 30))}">${k}</View>`;
}

function header(x: number, y: number, w: number, _num: string, en: string, zh: string, t0: number): string {
  return `${at(x, y, `<View class="flex-row items-end">${ui(en, 17, G.hot, true)}<View class="w-[10px]" />${cjk(zh, 16, G.hot)}</View>`, "", reg.anim(power(t0)))}${rect(x, y + 26, w, 2, G.low, "origin-left", grow("x", t0, 16))}${rect(x, y + 26, 40, 2, G.hot, "origin-left", grow("x", t0 + 4, 10))}`;
}

/** Values sampled every frame from `t0` to `t1`, as counter steps (no scramble), consecutive repeats dropped. */
function series(t0: number, t1: number, f: (t: number) => string): [number, string, number][] {
  const out: [number, string, number][] = [];
  for (let t = t0; t <= t1; t += 2) {
    const v = f(t);
    if (!out.length || out[out.length - 1]![1] !== v) out.push([t, v, 0]);
  }
  return out;
}

const LX = 50; // left column
const RX = 1510; // right column
const CW = 360; // column width

// ── the mode ladder: where the suite is, as a list it walks down ───────────

const STATES: [number, string, string][] = [
  [0, "POWER-ON", "上电"],
  [T_SEARCH, "SEARCH", "搜索"],
  [T_DETECT, "CONTACT", "发现目标"],
  [T_LOCK, "TRACK", "跟踪"],
  [T_FLIP, "LOCK", "锁定"],
];

/**
 * The suite's phase as a strip across the top of the frame: five segments,
 * typed in at boot, each filled when the suite reaches it, the current one
 * underlined; CONTACT and TRACKING blink on the half beat.
 */
function phaseStrip(): string {
  const out: string[] = [];
  const x0 = 470;
  const w = 184;
  const gap = 15;
  const y = 22;
  const h = 40;
  STATES.forEach(([t, en, zh], i) => {
    const x = x0 + i * (w + gap);
    const until = STATES[i + 1]?.[0];
    // typed in on sixteenths 4, 6, 8, 10 and 12, each with its beep
    const tIn = 30 + i * 15;
    const reached = Math.max(t, tIn + en.length + 6);
    out.push(`<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] border-[${G.low}] border animate-${reg.anim(power(tIn - 4))}" />`);
    out.push(typed(x + 12, y + 11, 15, [[en, G.low]], tIn, { cursorUntil: tIn + en.length + 4 }));
    const blink = t === T_DETECT || t === T_LOCK;
    // the current phase is a solid tab with dark type; a phase passed keeps its outline and mid type
    const label = (c1: string, c2: string) => `<View class="flex-row items-center gap-[8px]">${mono(en, 15, c1)}${cjk(zh, 13, c2)}</View>`;
    out.push(rect(x, y, w, h, G.hot, "", reg.anim(reg.window(reached, until))));
    out.push(at(x + 12, y + 9, label("#021014", "#021014"), "", reg.anim(reg.window(reached, until))));
    if (until !== undefined) out.push(at(x + 12, y + 9, label(G.mid, G.low), "", reg.anim(reg.window(until))));
    out.push(rect(x, y + h + 4, w, 3, G.hot, "", blink ? reg.loop([reg.short({ "0%": { opacity: "1" }, "55%": { opacity: "1" }, "56%": { opacity: "0.2" }, "100%": { opacity: "0.2" } }, B / 2)], B / 2) : undefined).replace("<View", `<View`));
    // the underline shows only while this is the current phase
    out[out.length - 1] = `<View class="absolute inset-0 animate-${reg.anim(reg.window(reached, until))}">${out[out.length - 1]}</View>`;
  });
  return out.join("\n");
}

// ── the AIS gap: the transponder's last six hours, and the silence after ──

function aisGap(): string {
  const out: string[] = [panelFrame(LX, 100, CW, 260, 4), header(LX + 20, 118, CW - 40, "", "AIS SILENT", "AIS 静默", 20)];
  const x0 = LX + 20;
  const span = CW - 40;
  const hx = (h: number) => x0 + ((h + 6) / 6) * span; // -6 h .. now
  const by = 206;
  out.push(rect(x0, by, span, 1, G.low, "origin-left", grow("x", 28, 18)));
  for (let h = -6; h <= 0; h++) {
    out.push(rect(hx(h), by - 4, 1, 9, G.mid, "", reg.anim(power(30 + (h + 6) * 2))));
    out.push(at(hx(h) - (h === 0 ? 30 : 8), by + 10, mono(h === 0 ? "NOW" : `${h}h`, 11, G.low), "", reg.anim(power(32 + (h + 6) * 2))));
  }
  // a ping every ten minutes until 2 h 47 min ago, loading in left to right
  const last = -(2 + 47 / 60);
  const pings: number[] = [];
  for (let h = -6; h <= last + 1e-6; h += 1 / 6) pings.push(h);
  pings.push(last);
  pings.forEach((h, k) => out.push(rect(hx(h) - 2, by - 2, 5, 5, G.hot, "", reg.anim(reg.window(36 + k * 2)))));
  // the silence: a band from the last ping to now that opens on the survey
  out.push(`<View class="absolute left-[${hx(last)}px] top-[${by - 9}px] w-[${hx(0) - hx(last)}px] h-[19px] origin-left animate-${grow("x", T_SEARCH - 20, 24)}"><View class="absolute inset-0 bg-[${G.hot}] opacity-12" />${rect(0, 0, hx(0) - hx(last), 1, G.mid)}${rect(0, 18, hx(0) - hx(last), 1, G.mid)}</View>`);
  out.push(at(hx(last) - 4, by - 34, `<View class="flex-row items-end gap-[6px]">${mono("LAST AIS", 11, G.mid)}${mono("23:54Z", 12, G.hot)}</View>`, "", reg.anim(power(76))));
  // the gap's length counts in gapNumerals, drawn above the tint: the story's own clock is the hero number
  out.push(at(x0, 258, `<View class="flex-col">${mono("SILENT", 12, G.mid)}${mono("FOR", 12, G.mid)}</View>`, "", reg.anim(power(80))));
  // the sweep finds it again: a hit on the timeline's NOW
  out.push(`<View class="absolute left-[${hx(0) - 1}px] top-[${by - 28}px] w-[2px] h-[56px] bg-[${G.hot}] origin-bottom animate-${reg.anim([reg.window(T_DETECT), reg.prop("scaleY", [[0, "0"], [T_DETECT, "0"], [T_DETECT + 8, "1"]], "cubic-bezier(0.16,1,0.3,1)")])}" />`);
  out.push(at(hx(0) - 66, by - 50, mono("SAR HIT", 12, G.hot), "", reg.anim(power(T_DETECT + 4))));
  out.push(at(x0, 318, mono("MMSI 413 820 517 · LAST SOG 17.9 KN", 12, G.mid), "", reg.anim(power(84))));
  return out.join("\n");
}

// ── the track: what the wake and the chip say about the vessel ─────────────

function trackPanel(): string {
  const out: string[] = [panelFrame(LX, 380, CW, 300, 28), header(LX + 20, 398, CW - 40, "", "TRACK", "航迹", 50)];
  const x = LX + 20;
  const row = (y: number, label: string, timeline: [number, string, number?][], unit: string, t0: number, seed: number, fixed: number[] = []) =>
    `${at(x, y + 3, mono(label, 13, G.mid), "", reg.anim(power(t0)))}<View class="absolute inset-0 animate-${reg.anim(power(t0))}">${rolling(x + 70, y, 16, 9.6, G.hot, timeline, "code", seed, 3, fixed)}</View>${at(x + 70 + timeline[0]![1].length * 9.6 + 6, y + 3, mono(unit, 13, G.mid), "", reg.anim(power(t0)))}`;
  const found = T_DETECT + 6;
  // a heading's hundreds is 0–3, so that cell settles without scrambling through 4–9
  // while the suite searches each readout hunts: a stray reading for two frames on every beat, then dashes again
  const hunt = (dash: string, seed: number, gen: (r: () => number) => string): [number, string, number?][] => {
    const r = rng(seed);
    const out: [number, string, number?][] = [[0, dash]];
    for (let t = T_SEARCH + 2; t + 6 < found; t += B) out.push([t, gen(r), 0], [t + 4, dash, 0]);
    return out;
  };
  const num = (r: () => number, max: number, dp: number, w: number) => (r() * max).toFixed(dp).padStart(w, "0");
  out.push(row(448, "HDG", [...hunt("---.-", 41, (r) => num(r, 360, 1, 5)), [found, "072.4"]], "°", 64, 31, [0]));
  out.push(row(486, "SPD", [...hunt("--.-", 42, (r) => num(r, 40, 1, 4)), [found + 4, "18.4"]], "KN", 68, 32));
  out.push(row(524, "LEN", [...hunt("---", 43, (r) => num(r, 400, 0, 3)), [found + 8, "182"]], "M", 72, 33));
  out.push(row(562, "CONF", [[0, "0.000"], ...series(T_DETECT, T_FLIP, (t) => (0.982 * inOut((t - T_DETECT) / (T_FLIP - T_DETECT))).toFixed(3))], "", 76, 34));
  out.push(rect(x, 602, 320, 6, G.faint, "", reg.anim(power(76))));
  out.push(rect(x, 602, 320, 6, G.hot, "origin-left", reg.anim(reg.prop("scaleX", [[0, "0"], [T_DETECT, "0"], [T_FLIP, "0.982"]], "cubic-bezier(0.45,0,0.55,1)"))));
  out.push(at(x, 628, `<View class="flex-col gap-[6px]">${mono("COURSE PROJ 072° → HUANGPU", 12, G.mid)}${mono("ETA BERTH 00:38", 12, G.mid)}</View>`, "", reg.anim(power(T_DETECT + 30))));
  return out.join("\n");
}

/** The silence's length, the story's own clock, drawn above the alert tint so it stays white: 02:47:13 and counting. */
function gapNumerals(): string {
  // one string through rolling(), the colons and fixed digits as cells that never change, so nothing gaps
  const clock: [number, string, number?][] = [[0, "02:47:13"]];
  for (let s = 1; s <= 9; s++) clock.push([s * 60, `02:47:${13 + s}`, 0]);
  // the cutter's ETA counts down in real time to the tenth: 12.6 NM at 31 KN is 24 min 23 s
  const eta: [number, string, number?][] = [[0, "24:23.0"]];
  for (let t = T_INT, k = 0; t <= TICKS; t += 6, k++) {
    const d = 24 * 600 + 230 - k;
    eta.push([t, `${String(Math.floor(d / 600)).padStart(2, "0")}:${String(Math.floor((d % 600) / 10)).padStart(2, "0")}.${d % 10}`, k === 0 ? 3 : 0]);
  }
  return `<View class="absolute inset-0 animate-${reg.anim(power(84))}">${rolling(LX + 72, 240, 52, 27, G.hot, clock, "ui", 9)}</View>
    <View class="absolute inset-0 animate-${reg.anim(reg.window(T_INT))}">${rolling(LX + 68, 812, 40, 21, G.hot, eta, "ui", 21)}</View>`;
}

// ── the intercept: a patrol cutter tasked to the contact ───────────────────

function interceptPanel(): string {
  const out: string[] = [panelFrame(LX, 700, CW, 290, 52), header(LX + 20, 718, CW - 40, "", "INTERCEPT", "拦截", 74)];
  const x = LX + 20;
  out.push(at(x, 762, `<View class="flex-col gap-[6px]">${mono("CG-2108 · PATROL CUTTER", 13, G.mid)}${mono("BRG 248° · 31 KN · 12.6 NM", 13, G.mid)}</View>`, "", reg.anim(power(90))));
  out.push(at(x, 822, mono("STANDBY", 16, G.low), "", reg.anim(power(96, T_INT))));
  // while it stands by, its log types two frames a character, and goes when the cutter is tasked
  const log = ["> UPLINK VEGA-7 · NOMINAL", "> CG-2108 ON STATION 31.06N", "> AWAIT TASKING · RTB 02:10"];
  out.push(`<View class="absolute inset-0 animate-${reg.anim(reg.window(0, T_INT))}">${log.map((l, i) => typed(x, 856 + i * 22, 13, [[l, G.mid]], 180 + i * 96, { cps: 4, cursorUntil: 180 + i * 96 + l.length * 4 + (i === log.length - 1 ? 60 : 8) })).join("")}</View>`);
  out.push(at(x, 830, mono("ETA", 13, G.mid), "", reg.anim(reg.window(T_INT))));
  out.push(typed(x, 884, 14, [["> TASKED", G.hot]], T_TASK, { cursorUntil: TICKS }));
  out.push(at(x + 9 * 8.4 + 14, 884, cjk("拦截已下达", 13, G.mid), "", reg.anim(power(T_TASK + 12))));
  return out.join("\n");
}

// ── the Kelvin wake: the angle every ship's wake makes, and the speed it gives ──

function kelvinPanel(): string {
  const out: string[] = [panelFrame(RX, 100, CW, 300, 16), header(RX + 20, 118, CW - 40, "", "KELVIN WAKE", "开尔文尾迹", 30)];
  const ax = RX + CW - 64;
  const ay = 262;
  const len = 230;
  const t0 = T_DETECT + 2;
  out.push(at(RX + 20, 162, mono("NO WAKE IN SWATH", 13, G.low), "", reg.anim(power(30, t0))));
  // the track, dashed, straight back from the ship
  for (let k = 0; k < 12; k++) out.push(rect(ax - 14 - k * 19, ay, 10, 1, G.mid, "", reg.anim(reg.window(t0 + k))));
  // the two arms at ±19.47°, grown out of the ship
  for (const deg of [160.53, 199.47]) {
    out.push(`<View class="absolute left-[${ax}px] top-[${ay - 1}px] w-[${len}px] h-[2px] bg-[${G.hot}] origin-left rotate-${deg} animate-${grow("x", t0, 12)}" />`);
  }
  // the angle between them, and its value
  out.push(arc(150, 1.5, 250.53, 38.94, G.mid, [drawOn(38.94, t0 + 8, 12)], ax, ay));
  out.push(at(ax - 236, ay - 12, ui("19.47°", 22, G.hot, true), "", reg.anim(power(t0 + 14))));
  out.push(`<View class="absolute left-[${ax - 7}px] top-[${ay - 7}px] w-[14px] h-[14px] bg-[${G.hot}] rotate-45 animate-${reg.anim(reg.window(t0))}" />`);
  // the wavelength across the arms gives the speed: v = sqrt(g λ / 2π)
  out.push(at(RX + 20, 340, `<View class="flex-row items-end gap-[10px]">${mono("λ 57.4 M", 14, G.hot)}${mono("→", 14, G.mid)}${mono("V = √(gλ/2π) = 18.4 KN", 14, G.hot)}</View>`, "", reg.anim(power(t0 + 20))));
  out.push(at(RX + 20, 366, mono("WAKE LEN 2.6 KM · AGE 4 MIN", 12, G.mid), "", reg.anim(power(t0 + 26))));
  return out.join("\n");
}

// ── the signal: two sparklines, the return's SNR and its coherence ───────

function sparkPanel(): string {
  const out: string[] = [panelFrame(RX, 424, CW, 412, 40), header(RX + 20, 442, CW - 40, "", "WAKE SIGNAL", "尾迹回波", 62)];
  const x = RX + 20;
  const span = CW - 40;
  // each trace scrolls 330 px over the film, so its point at x is under the panel's right edge at t = (x - span) / 330 * T
  const xAt = (t: number) => span + (330 * t) / TICKS;
  const make = (seed: number, base: number, steps: [number, number][], wob: number) => {
    const r = rng(seed);
    const ys: number[] = [];
    let v = 0;
    for (let k = 0; k * 4 <= 760; k++) {
      v = v * 0.6 + (r() - 0.5) * wob;
      let lvl = base;
      for (const [t, l] of steps) if (k * 4 >= xAt(t)) lvl = l;
      ys.push(Math.max(4, Math.min(66, lvl + v)));
    }
    return ys;
  };
  const snr = pngFile("spark-snr", raster.trace(760, 70, make(41, 56, [[T_DETECT, 30], [T_FLIP, 14]], 14), 4, 1.6));
  const coh = pngFile("spark-coh", raster.trace(760, 70, make(43, 54, [[T_DETECT, 34], [T_LOCK, 22], [T_FLIP, 12]], 9), 4, 1.6));
  const scroll = reg.prop("translateX", [[0, "0px"], [TICKS, "-330px"]]);
  const lane = (y: number, label: string, zh: string, file: string, values: [number, string, number?][], unit: string, seed: number, t0: number) => `
    ${at(x, y, `<View class="flex-row items-end gap-[8px]">${mono(label, 13, G.mid)}${cjk(zh, 13, G.mid)}</View>`, "", reg.anim(power(t0)))}
    <View class="absolute inset-0 animate-${reg.anim(power(t0))}">${rolling(x + span - 84, y - 4, 18, 10.8, G.hot, values, "code", seed)}</View>
    ${at(x + span - 84 + values[0]![1].length * 10.8 + 4, y, mono(unit, 12, G.mid), "", reg.anim(power(t0)))}
    <View class="absolute left-[${x}px] top-[${y + 24}px] w-[${span}px] h-[90px] overflow-hidden animate-${reg.anim(power(t0 + 4))}">
      ${rect(0, 20, span, 1, G.faint)}
      <View class="absolute left-[0px] top-[10px] animate-${reg.anim(scroll)}">${img(file, 760, 70)}</View>
    </View>`;
  out.push(lane(490, "BACKSCATTER σ0", "后向散射", snr, [[0, "-21.4"], [T_DETECT, "-12.8"], [T_FLIP, "-08.6"]], "dB", 61, 70));
  out.push(lane(650, "WAKE CONTRAST", "尾迹对比度", coh, [[0, "0.21"], [T_DETECT, "0.74"], [T_LOCK, "0.88"], [T_FLIP, "0.97"]], "", 62, 78));
  return out.join("\n");
}

function swathPanel(): string {
  const out: string[] = [panelFrame(RX, 860, CW, 130, 64)];
  out.push(at(RX + 20, 880, `<View class="flex-col gap-[7px]">${mono("SWATH 42 KM · INC 31.2°", 13, G.mid)}${mono("LOOK RIGHT · DESC · PASS 1127", 13, G.mid)}${mono("SEA STATE 3 · WIND 11 KN NE", 13, G.mid)}</View>`, "", reg.anim(power(60))));
  return out.join("\n");
}

// ── the frame's edges: the orbit along the top, the colophon along the foot ──


function colophon(): string {
  const out: string[] = [];
  out.push(at(LX, 1018, `<View class="flex-row items-end">${ui("VEGA-7", 24, G.hot, true)}<View class="w-[14px]" />${mono("SAT 3/6 · OCEAN SURVEILLANCE · BUILD 0417", 12, G.low)}</View>`, "", reg.anim(power(8))));
  out.push(at(1600, 1022, mono("MET 00:41:", 17, G.mid), "", reg.anim(power(12))));
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(12))}">${clock(1600 + 10 * 17 * 0.6, 1022)}</View>`);
  return out.join("\n");
}

/** Mission elapsed seconds and frames, from 00:41:07:00: every glyph a looping or stepped window. */
function clock(x: number, y: number): string {
  const size = 17;
  const cw = size * 0.6;
  const S0 = 7;
  const cell = (inner: string) => `<View class="w-[${cw}px] h-[22px]">${inner}</View>`;
  const glyph = (ch: string, anim: string) => `<View class="absolute inset-0 flex-row justify-center animate-${anim}">${mono(ch, size, G.hot)}</View>`;
  const turn = (10 - S0) * 60;
  const tens = glyph("0", reg.anim(reg.window(0, turn))) + glyph("1", reg.anim(reg.window(turn)));
  const units = Array.from({ length: 10 }, (_, v) => {
    const ws: [number, string][] = [[0, "0"]];
    for (let sec = 0; sec < 10; sec++) if ((S0 + sec) % 10 === v) ws.push([sec * 60, "1"], [sec * 60 + 60, "0"]);
    return glyph(String(v), reg.anim(reg.step("opacity", dedupe(ws).filter(([t]) => t < TICKS))));
  }).join("");
  const ftens = [0, 1, 2].map((v) => glyph(String(v), reg.cycle(v * 20, v * 20 + 20, 60))).join("");
  const funits = Array.from({ length: 10 }, (_, v) => glyph(String(v), reg.cycle(v * 2, v * 2 + 2, 20))).join("");
  return at(x, y, `<View class="flex-row">${cell(tens)}${cell(units)}<View class="w-[${cw}px] h-[22px] flex-row justify-center">${mono(":", size, G.mid)}</View>${cell(ftens)}${cell(funits)}</View>`);
}

function hexGrid(): string {
  const w = 1400;
  const h = 1000;
  const file = pngFile("hex", raster.hexGrid(w, h, 26, 1.4, 330, 640));
  // a texture, not a layer of its own: about a seventh of the ticks' brightness, warming a little into the lock
  return at(CX - w / 2, CY - h / 2, img(file, w, h), "", reg.anim(reg.prop("opacity", [[0, "0"], [24, "0"], [70, "0.14"], [T_DETECT, "0.14"], [T_FLIP - 2, "0.22"], [T_PUSH, "0.22"], [T_PUSH + 30, "0.06"]])));
}

// ── finish ─────────────────────────────────────────────────────────────────

async function scanlines(): Promise<string> {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y % 3 === 0 ? 205 : 255;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  await Bun.write(`${OUT}scan.png`, await encodePlate({ width: W, height: H, rgba: px }));
  images["scan.png"] = { linear: false };
  return "scan.png";
}
async function grain(): Promise<string> {
  const w = 960;
  const h = 540;
  const r = rng(9);
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 128 + (r() - 0.5) * 70;
    px[i * 4] = v;
    px[i * 4 + 1] = v;
    px[i * 4 + 2] = v;
    px[i * 4 + 3] = 255;
  }
  await Bun.write(`${OUT}grain.png`, await encodePlate({ width: w, height: h, rgba: px }));
  images["grain.png"] = { linear: true };
  return "grain.png";
}

// ═══════════════════════════════════════════════════════════════════════════
// assemble
// ═══════════════════════════════════════════════════════════════════════════

// panels dim to 30 % once the dive has landed, leaving the target and its words
/** Speed lines for the first frames of the dive: a ring of radial strokes that rushes outward and is gone. */
function speedLines(): string {
  const file = pngFile("streaks", raster.streaks(1920, 1080, 180, 240, 1150, 41));
  const el = new El(reg, { x: 0, y: 0, w: W, h: H }, { op: 0, sx: 0.8, sy: 0.8 });
  el.set(T_PUSH, { op: 0.75, sx: 0.8, sy: 0.8 }).to(T_PUSH, T_PUSH + 6, { sx: 1.0, sy: 1.0 }, linear).to(T_PUSH + 6, T_PUSH + 18, { op: 0, sx: 1.5, sy: 1.5 }, outCubic);
  return el.node(img(file, W, H));
}

// panels dim to 30 % once the dive has landed, leaving the target and its words; they lose focus through the push
const defocusEntry = reg.prop("blur", [[0, "0px"], [T_PUSH, "0px"], [T_PUSH + 8, "8px"], [T_PUSH + 30, "0px"]]);
// …and on 9.5 s the suite stands down in reverse order of what it built: panels first, the rings two ticks later,
//   the lens two after that, leaving the lock, the vessel and the verdict
const dim = reg.anim([reg.prop("opacity", [[0, "1"], [T_HOLD, "1"], [T_HOLD + 24, "0.72"], [T_END, "0.72"], [T_END + 6, "0"]]), defocusEntry]);
const outAt = (t: number) => reg.anim(reg.prop("opacity", [[0, "1"], [t, "1"], [t + 6, "0"]]));
const defocus = reg.anim(defocusEntry);
const GLOW = "glow-[12px] glow-[#ffffff] glow-gain-[1.0]";
const centre = [hexGrid(), crosshair(), globe(), coast()].join("\n");
// the rim and its limb glow composite white over white, which inside a glow layer comes out as dark speckle along
// the limb (the engine defect the radar met; reported again with a repro): they draw in a layer of their own
const rim = rimAndScan();
// the radar draws in a layer of its own, without glow: composited inside the glow layer over the coast's halo,
// the wedge came out as a dark dither (an engine defect, reported) where white over white must only brighten
const sweep = radar();
const centreTop = [rings(), speedLines(), tracking()].join("\n");
const panels = [phaseStrip(), aisGap(), trackPanel(), interceptPanel(), kelvinPanel(), sparkPanel(), swathPanel(), colophon()].join("\n");
// three restrained glitches — 2.0 s, 4.4 s and 6.4 s — each a frame of tears across the picture
const GLITCH = [120, 264, 384];
const tears = GLITCH.flatMap((t, i) =>
  [137, 491, 803].map((y, k) => rect(0, (y + i * 211 + k * 97) % H, W, 2 + ((i + k) % 2), G.hot, "opacity-20", reg.anim(reg.window(t, t + 2)))),
).join("");
// an alert border, pulsing at 2 Hz from a second after the flip: the tail keeps its pulse
const border = `<View class="absolute left-[12px] top-[12px] right-[12px] bottom-[12px] border-[${G.hot}] border-[3px] animate-${reg.anim(reg.window(T_FLIP + 30))}"><View class="absolute inset-0 border-[${G.hot}] border-[3px] animate-${reg.loop([reg.short({ "0%": { opacity: "1" }, "50%": { opacity: "0.6" }, "100%": { opacity: "1" } }, B)], B)}" /></View>`;
const top = [kelvinLabel(), confirmStamp(), tears, border].join("\n");
const hud = `
      <View class="absolute inset-0 ${GLOW} animate-${reg.anim(reg.prop("opacity", [[0, "1"], [T_END + 12, "1"], [T_END + 18, "0.7"]]))}">${centre}</View>
      <View class="absolute inset-0 animate-${outAt(T_END + 18)}">${rim}</View>
      <View class="absolute inset-0">${sweep}</View>
      <View class="absolute inset-0 ${GLOW} animate-${outAt(T_END + 12)}">${centreTop}</View>
      <View class="absolute inset-0 ${GLOW}">${lock()}${course()}</View>
      <View class="absolute inset-0 animate-${dim}">${panelPlates.join("")}</View>
      <View class="absolute inset-0 ${GLOW} animate-${dim}">${panels}</View>
      <View class="absolute inset-0">${bandPlates.join("")}</View>
      <View class="absolute inset-0 ${GLOW}">${lockup()}${typed(HERO.x + 24, HERO.y + HERO.h - 36, 16, [["> HANDOFF → CG-2108", G.hot]], T_END + 14, { cps: 1, cursorUntil: TICKS })}</View>
      <View class="absolute inset-0 ${GLOW} animate-${outAt(T_END + 6)}">${top}</View>`;

// the alert spreads from the contact to every corner: the gradient's box is a square the width of the frame,
// so its farthest-corner ellipse is a circle, and 0.85 of its radius clears the frame's corners
// the front runs out over eight frames on the lock's own ease, and alertFront rides it
const ease = "cubic-bezier(0.16,1,0.3,1)";
// both stops sit at 0 until the flip, so the rest state is cyan to the centre pixel; the 3 % band opens as the wave runs
const tint = reg.anim([
  reg.prop("gradVia1Pos", [[0, "0"], [T_FLIP, "0"], [T_FLIP + TINT_RUN, "0.85"]], ease),
  reg.prop("gradVia2Pos", [[0, "0"], [T_FLIP, "0"], [T_FLIP + TINT_RUN, "0.88"]], ease),
]);
// the punch: the HUD scales 1.06 -> 1 over six frames, jolting sideways once; from the landing it pushes in 3 % to the end
const punch = reg.anim([
  reg.prop("scale", [[0, "1"], [T_SEARCH, "1"], [T_FLIP, "1.025"], [T_FLIP + 1, "1.08"], [T_FLIP + 12, "1"], [T_LAND, "1"], [T_END, "1.03"]], "cubic-bezier(0.16,1,0.3,1)"),
  reg.step("translateX", [
    [0, "0px"], [120, "8px"], [122, "0px"], [264, "-10px"], [266, "4px"], [268, "0px"], [384, "6px"], [386, "0px"],
    [T_FLIP, "10px"], [T_FLIP + 2, "-6px"], [T_FLIP + 4, "0px"], [T_FLIP + 31, "4px"], [T_FLIP + 33, "0px"],
  ]),
]);

// the alert keeps a near-black ground: the grey under the tint drops by 60 % as it flips, so only the linework turns orange
const groundDown = reg.anim(reg.prop("opacity", [[0, "0"], [T_FLIP, "0"], [T_FLIP + 4, "0.95"]]));
// chromatic aberration: the reticle again in red and blue, a pixel and a half off, seven on the flip
// chromatic aberration: the reticle again in red and blue, 1.5 px off; 6 px on each glitch, 8 px decaying over four frames on the flip
const caX = (sign: number) => {
  const k: [number, string][] = [[0, `${sign * 1.5}px`]];
  for (const t of GLITCH) k.push([t - 1, `${sign * 1.5}px`], [t, `${sign * 6}px`], [t + 4, `${sign * 1.5}px`]);
  k.push([T_FLIP - 1, `${sign * 1.5}px`], [T_FLIP, `${sign * 6}px`], [T_FLIP + 8, `${sign * 1.5}px`]);
  // present only on the glitches and the flip: at rest its fringes cut through the type over the rings
  // the windows, merged where one ends on the tick the next begins (the 6.4 s glitch runs into the flip)
  const spans: [number, number][] = [...GLITCH.map((t) => [t, t + 6] as [number, number]), [T_FLIP, T_FLIP + 8]];
  const merged: [number, number][] = [];
  for (const [a, z] of spans.sort((p, q) => p[0] - q[0])) {
    if (merged.length && a <= merged[merged.length - 1]![1]) merged[merged.length - 1]![1] = Math.max(merged[merged.length - 1]![1], z);
    else merged.push([a, z]);
  }
  const on: [number, string][] = [[0, "0"]];
  for (const [a, z] of merged) on.push([a, "0.45"], [z, "0"]);
  return reg.anim([reg.prop("translateX", k), reg.step("opacity", on)]);
};
// the alarm sweeps: the frame's edge flares orange and the border doubles for a few frames
const alarmKeys = (peak: string): [number, string][] => [[0, "0"], ...T_ALARM.flatMap((a) => [[a - 1, "0"], [a, peak], [a + 14, "0"]] as [number, string][])];
const alarm = reg.anim(reg.prop("opacity", alarmKeys("1")));
const alarmEdge = reg.anim(reg.step("opacity", [[0, "0"], ...T_ALARM.flatMap((a) => [[a, "1"], [a + 4, "0"]] as [number, string][])]));
const wash: Stops = { "0%": { opacity: "0.0" }, "12%": { opacity: "0.18" }, "100%": { opacity: "0.0" } };
const scan = await scanlines();
const grn = await grain();
await Promise.all(writes);

await Bun.write(
  `${OUT}main.tsx`,
  `// GENERATED by compositions/mg-hud/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Image, Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[#000000]">
    <View class="absolute inset-0 bg-[${G.bg}]" />
    <View class="absolute inset-0 bg-[radial-gradient(#2a2a2a,#1e1e1e_45%,#0c0c0c)]" />
    <View class="absolute inset-0 bg-[#000000] animate-${groundDown}" />
    <View class="absolute inset-0 origin-center animate-${punch}">
${hud}
    </View>
    <View class="absolute left-[0px] top-[${CY - W / 2}px] w-[${W}px] h-[${W}px] bg-[radial-gradient(${ORANGE},${ORANGE}_0%,${CYAN}_3%,${CYAN})] mix-blend-multiply animate-${tint}" />
    <View class="absolute inset-0 mix-blend-screen animate-${caX(1)}">${reticle("#ff1f3d", "#7a0f1d", true)}</View>
    <View class="absolute inset-0 mix-blend-screen animate-${caX(-1)}">${reticle("#1f6bff", "#0f2f7a", true)}</View>
    <View class="absolute inset-0 bg-[radial-gradient(#ff2a0000,#ff2a0030)] mix-blend-screen animate-${reg.anim([reg.window(T_FLIP)])}"><View class="absolute inset-0 animate-${reg.loop([reg.short(wash, B, "ease-out", 0)], B)}" /></View>
    <View class="absolute left-[0px] top-[${CY - W / 2}px] w-[${W}px] h-[${W}px] bg-[radial-gradient(#ffe2c0,#ffe2c000_38%)] mix-blend-screen animate-${reg.anim(reg.prop("opacity", [[0, "0"], [T_FLIP - 1, "0"], [T_FLIP, "0.85"], [T_FLIP + 4, "0"]]))}" />
    <View class="absolute inset-0 bg-[radial-gradient(#ff6a0000,#ff6a0000_55%,#ff6a00b0)] mix-blend-screen animate-${alarm}" />
    <View class="absolute left-[12px] top-[12px] right-[12px] bottom-[12px] border-[#ffd6a8] border-[7px] animate-${alarmEdge}" />
    <View class="absolute inset-0 origin-center animate-${punch}">${lockCore()}${alertFront()}${hullTop()}${heroHot()}</View>
    <View class="absolute inset-0 origin-center animate-${punch}"><View class="absolute inset-0 glow-[10px] glow-[#ffffff] glow-gain-[0.6] animate-${defocus}"><View class="absolute inset-0 animate-${outAt(T_END)}">${gapNumerals()}</View></View></View>
    <Image class="absolute left-[0px] top-[0px] w-[1920px] h-[1080px] mix-blend-multiply opacity-50" src="${scan}" />
    <Image class="absolute left-[0px] top-[0px] w-[1920px] h-[1080px] mix-blend-overlay opacity-30" src="${grn}" />
    <View class="absolute inset-0 bg-[radial-gradient(#00000000,#00000000_55%,#000000c0)]" />
  </View>
));
`,
);
await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/mg-hud/gen.ts — do not edit by hand.
import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(reg.keyframes)},
    animation: ${JSON.stringify({ ...reg.animation, ...reg.loops })},
  },
});
`,
);
await Bun.write(`${OUT}images.json`, JSON.stringify(images, null, 2) + "\n");
await Bun.write(
  `${OUT}pocket-motion.json`,
  JSON.stringify(
    {
      motion: 1,
      durationFrames: (DUR_MS / 1000) * FPS,
      fps: FPS,
      supersample: 1,
      // motion blur: each frame an exposure of 6 renders over 120° of the frame's duration (patches/0034); only transform
      //   timelines are sampled between ticks, so cuts, gates and fades stay where they are
      ...(process.env.SHUTTER === "0" ? {} : { shutter: { angle: 120, samples: 6 } }),
      fonts: {
        regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
        bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
        faces: {
          cjk: { regular: "assets/fonts/NotoSansSC-Regular.otf", bold: "assets/fonts/NotoSansSC-Bold.otf" },
          code: { regular: "vendor/pocketjs/assets/fonts/JetBrainsMono-Regular.ttf", bold: "vendor/pocketjs/assets/fonts/JetBrainsMono-Regular.ttf" },
          ui: { regular: "compositions/mg-hud/fonts/Rajdhani-SemiBold.ttf", bold: "compositions/mg-hud/fonts/Rajdhani-Bold.ttf" },
        },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(`mg-hud: ${Object.keys(reg.keyframes).length} keyframe sets, ${Object.keys(reg.animation).length + Object.keys(reg.loops).length} animations`);
