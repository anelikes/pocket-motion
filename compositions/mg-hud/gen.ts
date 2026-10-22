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
import { encodePNG } from "../../vendor/pocketjs/tests/png.ts";
import { landDots } from "./globe.ts";
import { El, Reg, inOut, jsx, lerp, linear, outCubic, outExpo, rng, type Stops } from "./motion.ts";
import * as raster from "./raster.ts";

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
const T_LAND = T_FLIP + 120; // 8.5 s: the dive lands
const T_HOLD = T_LAND + 6;

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
const worldMag = (t: number) => (t <= T_PUSH ? 1 : M_FINAL ** outCubic(Math.min(1, (t - T_PUSH) / (T_LAND - T_PUSH))));
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
function pngFile(name: string, buf: Buffer, linearSample = true): string {
  const file = `${name}.png`;
  images[file] = { linear: linearSample };
  writes.push(Bun.write(`${OUT}${file}`, buf));
  return file;
}
const img = (file: string, w: number, h: number, cls = "") => `<Image class="w-[${w}px] h-[${h}px] ${cls}" src="${file}" />`;

const mono = (s: string, size: number, color: string, extra = "") => `<Text class="font-[code] text-[${size}px] text-[${color}] ${extra}">${jsx(s)}</Text>`;
const ui = (s: string, size: number, color: string, bold = false) => `<Text class="font-[ui] ${bold ? "font-bold" : ""} text-[${size}px] text-[${color}]">${jsx(s)}</Text>`;
const cjk = (s: string, size: number, color: string) => `<Text class="font-[cjk] font-bold text-[${size}px] text-[${color}]">${jsx(s)}</Text>`;
const at = (x: number, y: number, inner: string, cls = "", anim?: string) => `<View class="absolute left-[${x}px] top-[${y}px] ${cls} ${anim ? `animate-${anim}` : ""}">${inner}</View>`;
const rect = (x: number, y: number, w: number, h: number, color: string, cls = "", anim?: string) =>
  `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] bg-[${color}] ${cls} ${anim ? `animate-${anim}` : ""}" />`;

/** CSS cubic-bezier(x1, y1, x2, y2) as an easing of u in [0, 1]: x is solved for u by bisection, then y is read. */
function bezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (u: number) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < u) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
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
function rolling(x: number, y: number, size: number, cellW: number, color: string, timeline: [number, string, number?][], font: "ui" | "code", seed: number, scramble = 3): string {
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
      if (k > 0 && frames > 0 && /\d/.test(ch) && ch !== prev) {
        for (let s = 0; s < frames; s++) seq.push([te + s * 2, String(Math.floor(r() * 10))]);
        seq.push([te + frames * 2, ch]);
      } else seq.push([te, ch]);
    });
    const chars = [...new Set(seq.map(([, ch]) => ch))];
    const nodes = chars.map((ch) => {
      const ch2: [number, string][] = [];
      let on = false;
      for (const [t, v] of seq) {
        const want = v === ch;
        if (want !== on) {
          ch2.push([t, want ? "1" : "0"]);
          on = want;
        }
      }
      if (!ch2.length || ch2[0]![0] > 0) ch2.unshift([0, "0"]);
      const text = font === "ui" ? ui(ch, size, color, true) : mono(ch, size, color);
      return `<View class="absolute inset-0 flex-row justify-center items-center animate-${reg.anim(reg.step("opacity", dedupe(ch2)))}">${text}</View>`;
    });
    cells.push(`<View class="w-[${cellW}px] h-[${Math.round(size * 1.25)}px]">${nodes.join("")}</View>`);
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
    t < T_DETECT ? 1 : t < T_FLIP ? lerp(1, 3, (t - T_DETECT) / (T_FLIP - T_DETECT)) : t < T_FLIP + B ? lerp(3, 1, (t - T_FLIP) / B) : 1;
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
  for (const [s, x, y] of cards) out.push(at(x - 15, y - 9, mono(s, 13, G.mid), "", reg.anim(power(44))));
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
  out.push(`<View class="absolute left-[${CX}px] top-[${CY}px] w-[0px] h-[0px] animate-${reg.anim([reg.prop("rotate", edgeRot), reg.window(T_SEARCH)])}"><View class="absolute left-[-300px] top-[-300px]">${img(wedge, 600, 600)}</View>${rect(-1, -300, 2, 300, G.hot)}</View>`);
  // three earlier contacts, each on a bearing the first pass crosses before it finds C-04
  const blips: [string, number, number][] = [["C-01", 170, 210], ["C-02", 250, 150], ["C-03", 330, 236]];
  for (const [name, bearing, rr] of blips) {
    const x = CX + rr * Math.sin((bearing * Math.PI) / 180);
    const y = CY - rr * Math.cos((bearing * Math.PI) / 180);
    const el = new El(reg, { x: x - 4, y: y - 4, w: 8, h: 8 }, { op: 0 });
    let prev = sweepAngle(T_SEARCH);
    for (let t = T_SEARCH + 1; t < TICKS - 20; t++) {
      const cur = sweepAngle(t);
      const crossed = Math.floor((prev - bearing) / 360) !== Math.floor((cur - bearing) / 360);
      // the edge lights it: three frames of bloom, then six tenths of a second to fade
      if (crossed) el.set(t, { op: 1, sx: 2.6, sy: 2.6 }).to(t, t + 6, { sx: 1.6, sy: 1.6 }, linear).to(t + 6, t + 42, { op: 0.25, sx: 1, sy: 1 }, outCubic);
      prev = cur;
    }
    out.push(el.node(`<View class="w-[8px] h-[8px] bg-[${G.hot}]" />`));
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
  const gwin = reg.anim(reg.prop("opacity", [[0, "0"], [30, "0"], [60, "0.4"], [T_PUSH, "0.4"], [T_PUSH + 6, "0"]]));
  for (let m = 0; m < 180; m += 30) grat.push(`<View class="absolute left-[${-R_GLOBE}px] top-[${-R_GLOBE}px] w-[${2 * R_GLOBE}px] h-[${2 * R_GLOBE}px] rotate-y-[${m}] animate-${gwin}">${img(ring, 2 * R_GLOBE, 2 * R_GLOBE)}</View>`);
  for (const lat of [-60, -30, 0, 30, 60]) {
    const rr = R_GLOBE * Math.cos((lat * Math.PI) / 180);
    const yy = -R_GLOBE * Math.sin((lat * Math.PI) / 180);
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
  // drawn as an untextured rounded box: as a textured quad its two triangles both covered their shared diagonal, a dark seam
  const discEl = `<View class="absolute left-[${CX - R_GLOBE + 2}px] top-[${CY - R_GLOBE + 2}px] w-[${2 * R_GLOBE - 4}px] h-[${2 * R_GLOBE - 4}px] rounded-[${R_GLOBE - 2}px] bg-[#050505] animate-${reg.anim([reg.prop("opacity", [[0, "0"], [29, "0"], [30, "0.82"], [T_PUSH, "0.82"], [T_PUSH + 8, "0"]]), reg.prop("translateZ", zKeys)])}" />`;
  // the globe hands over to the wide map between ×2 and ×5 and is a faint field of points after
  const fadeOut = reg.prop("opacity", [[0, "1"], [tickAtMag(2), "1"], [tickAtMag(5), "0.14"], [T_LAND, "0"]]);
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
      const a = j >= 58 && j < 61 ? 0.55 : 0.18 * (j / 58) ** 2;
      for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 4;
        px[k] = 255;
        px[k + 1] = 255;
        px[k + 2] = 255;
        px[k + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    return encodePNG(px, w, h);
  })());
  const scan: Stops = { "0%": { translateY: `${-80}px` }, "100%": { translateY: `${2 * R_GLOBE + 20}px` } };
  const gone = reg.prop("opacity", [[0, "0"], [40, "0"], [44, "1"], [T_PUSH, "1"], [T_PUSH + 20, "0"]]);
  return `
    ${at(CX - R_GLOBE - 20, CY - R_GLOBE - 20, img(rimF, 2 * R_GLOBE + 40, 2 * R_GLOBE + 40), "", reg.anim([power(40), reg.prop("opacity", [[0, "1"], [T_PUSH, "1"], [T_PUSH + 16, "0"]])]))}
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

/** The coast's lens: inside the reticle's 470 px brackets, so the map never runs out under the panels or the top bar. */
const LENS = 440;
function coast(): string {
  const wide = coastMap("coast-wide", 8, 1000, 5, [360, 495], 1.4, 5);
  const close = coastMap("coast", M_FINAL, 900, 1, [370, 440], 1.6, 7);
  const layer = (map: { file: string }, size: number, m: number, on: [number, number], off?: [number, number]) => {
    const keys: [number, string][] = [[0, (1 / m).toFixed(4)]];
    for (let t = T_PUSH; t <= T_LAND; t += 2) keys.push([t, (worldMag(t) / m).toFixed(4)]);
    const op: [number, string][] = [[0, "0"], [tickAtMag(on[0]), "0"], [tickAtMag(on[1]), "1"]];
    if (off) op.push([tickAtMag(off[0]), "1"], [tickAtMag(off[1]), "0"]);
    return `<View class="absolute left-[${LENS - size / 2}px] top-[${LENS - size / 2}px] w-[${size}px] h-[${size}px] origin-center animate-${reg.anim([reg.prop("scale", keys), reg.prop("opacity", op)])}">${img(map.file, size, size)}</View>`;
  };
  // the vessel's own track on the close map: AIS pings up to the last fix, then the silent leg dashed to the contact
  const pings: [number, number][] = [[124.62, 29.71], [124.21, 29.93], [123.83, 30.14], [123.43, 30.38], [123.05, 30.62]];
  const silent: [number, number][] = [[123.05, 30.62], [122.55, 30.93], [122.02, 31.18], [121.47, 31.23]];
  // drawn in the close map's own pixels and scaled with it, so it stays on the coast it crosses and inside the lens
  const trackMap = { file: pngFile("track", raster.track(900, 900, pings.map(([lo, la]) => close.proj(lo, la)), silent.map(([lo, la]) => close.proj(lo, la)))) };
  const [ix, iy] = close.proj(...pings[pings.length - 1]!);
  const tags = at(CX + ix - 450 - 150, CY + iy - 450 + 14, `<View class="flex-col">${mono("LAST AIS 23:54Z", 12, G.hot)}${mono("−02:47 SILENT", 11, G.mid)}</View>`, "", reg.anim(power(T_LAND)));
  return `
    <View class="absolute left-[${CX - LENS}px] top-[${CY - LENS}px] w-[${2 * LENS}px] h-[${2 * LENS}px] rounded-[${LENS}px] overflow-mask">
      ${layer(wide, 1000, 8, [2, 4], [10, 14])}
      ${layer(close, 900, M_FINAL, [8, 12])}
      ${layer(trackMap, 900, M_FINAL, [10, 16])}
    </View>
    ${tags}`;
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
 * The lock: four corners open wide at 1.40 on T_LOCK and hold there, dipping
 * on the beats; then the snap — ten frames of cubic-bezier(0.16,1,0.3,1)
 * that land at 1.00 on T_FLIP, the frame the alert fires — bites to 0.97 and
 * settles. Two echoes trail the snap; the LOCK reading is the snap itself.
 */
const T_SNAP_IN = T_FLIP - 20;
const lockScale = (t: number) => (t < T_SNAP_IN ? 1.4 : t <= T_FLIP ? 1 + 0.4 * (1 - snapEase((t - T_SNAP_IN) / (T_FLIP - T_SNAP_IN))) : 1);
function lock(): string {
  const S = 150;
  const out: string[] = [];
  const brackets = (color: string, op: number, lag: number) => {
    for (let k = 0; k < 4; k++) {
      const el = new El(reg, { x: CX - S / 2, y: CY - S / 2, w: S, h: S }, { op: 0, sx: 1.4, sy: 1.4 });
      if (lag === 0) {
        const t0 = T_LOCK + k * 2;
        el.set(t0, { op: 1 }).set(t0 + 2, { op: 0.2 }).set(t0 + 4, { op: 1 });
        for (const tb of [T_LOCK + B / 2, T_LOCK + B]) el.to(tb, tb + 3, { sx: 1.36, sy: 1.36 }, outCubic).to(tb + 3, tb + 14, { sx: 1.4, sy: 1.4 }, inOut);
        el.path(T_SNAP_IN, T_FLIP, (t) => ({ sx: lockScale(t), sy: lockScale(t) }));
        el.to(T_FLIP, T_FLIP + 2, { sx: 0.97, sy: 0.97 }, outCubic).to(T_FLIP + 2, T_FLIP + 8, { sx: 1, sy: 1 }, inOut);
      } else {
        // an echo: the snap again, `lag` ticks behind, only while it moves
        el.set(T_SNAP_IN + lag, { op, sx: 1.4, sy: 1.4 }).path(T_SNAP_IN + lag, T_FLIP + lag, (t) => ({ sx: lockScale(t - lag), sy: lockScale(t - lag) }));
        el.set(T_FLIP + lag + 1, { op: 0 });
      }
      out.push(el.node(corner(S, 34, 4, color, k as 0)));
    }
  };
  brackets(G.hot, 0.2, 4);
  brackets(G.hot, 0.4, 2);
  brackets(G.hot, 1, 0);
  out.push(`<View class="absolute left-[${CX - 22}px] top-[${CY - 22}px] w-[44px] h-[44px] rounded-[22px] border-[${G.hot}] border-2 animate-${reg.anim(reg.window(T_FLIP))}" />`);
  // LOCK % is the snap's progress, read off the brackets' scale, frame by frame
  const pct: [number, string, number?][] = [[0, "000"], ...series(T_SNAP_IN, T_FLIP, (t) => String(Math.round(((1.4 - lockScale(t)) / 0.4) * 100)).padStart(3, "0"))];
  out.push(`<View class="absolute inset-0 animate-${reg.anim(reg.window(T_LOCK + 6, T_FLIP + 16))}">
    ${rect(CX + 122, CY + 118, 132, 30, G.plate)}
    ${at(CX + 130, CY + 125, mono("LOCK", 13, G.mid))}
    ${rolling(CX + 176, CY + 120, 20, 12, G.hot, pct, "code", 3)}
    ${at(CX + 214, CY + 123, mono("%", 18, G.hot))}
  </View>`);
  return out.join("\n");
}

/** The coordinates, on a leader out of the brackets' upper-right corner, over open sea and clear of the track. */
function lockedText(): string {
  const t0 = T_FLIP;
  const flick = (t: number) => reg.anim(reg.step("opacity", [[0, "0"], [t, "1"], [t + 2, "0"], [t + 4, "1"], [t + 5, "0.4"], [t + 7, "1"]]));
  const plate = (x: number, y: number, w: number, h: number, inner: string, anim: string) =>
    `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] animate-${anim}"><View class="absolute inset-0 bg-[${G.plate}]" /><View class="absolute inset-0 border-[${G.hot}] border" />${rect(0, 0, 4, h, G.hot)}${inner}</View>`;
  const leader = (x: number, y: number, len: number, deg: number, t: number) =>
    `<View class="absolute left-[${x}px] top-[${y - 1}px] w-[${len}px] h-[2px] bg-[${G.hot}] origin-left ${deg ? `rotate-${deg}` : ""} animate-${grow("x", t, 6)}" />`;
  const out: string[] = [];
  out.push(leader(CX + 75, CY - 75, 99, 315, t0 + 2));
  out.push(leader(CX + 145, CY - 145, 32, 0, t0 + 6));
  out.push(plate(CX + 177, CY - 190, 280, 90, "", flick(t0 + 8)));
  out.push(typed(CX + 199, CY - 178, 24, [["N31°14′  E121°29′", G.hot]], t0 + 12, { cps: 2, cursorUntil: TICKS }));
  out.push(at(CX + 199, CY - 140, mono("C-04 · DARK · AIS OFF", 13, G.mid), "", reg.anim(power(t0 + 48))));
  return out.join("\n");
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

function header(x: number, y: number, w: number, num: string, en: string, zh: string, t0: number): string {
  return `${at(x, y, `<View class="flex-row items-end">${mono(num, 12, G.low)}<View class="w-[8px]" />${ui(en, 17, G.hot, true)}<View class="w-[10px]" />${cjk(zh, 13, G.mid)}</View>`, "", reg.anim(power(t0)))}${rect(x, y + 26, w, 2, G.low, "origin-left", grow("x", t0, 16))}${rect(x, y + 26, 40, 2, G.hot, "origin-left", grow("x", t0 + 4, 10))}`;
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
  [T_SEARCH, "SURVEY", "巡查"],
  [T_DETECT, "CONTACT", "发现目标"],
  [T_LOCK, "TRACKING", "跟踪"],
  [T_FLIP, "LOCKED", "锁定"],
];

function modeLadder(): string {
  const out: string[] = [panelFrame(LX, 100, CW, 250, 4), header(LX + 20, 118, CW - 40, "01", "MODE", "工作状态", 14)];
  const x = LX + 20;
  const spineX = LX + CW - 33;
  // the spine between the status boxes grows a row at a time as the states are reached
  const spine: [number, string][] = [[0, "0"]];
  STATES.forEach(([t], i) => {
    const y = 162 + i * 36;
    const until = STATES[i + 1]?.[0];
    const reached = Math.max(t, 16 + i * 4);
    out.push(at(x, y, mono(`0${i + 1}`, 12, G.low), "", reg.anim(power(16 + i * 4))));
    // dim until reached, bright after
    const label = (c1: string, c2: string) => `<View class="flex-row items-end gap-[8px]">${ui(STATES[i]![1], 18, c1, true)}${cjk(STATES[i]![2], 13, c2)}</View>`;
    out.push(at(x + 32, y - 4, label(G.low, G.faint), "", reg.anim(power(16 + i * 4, reached))));
    out.push(at(x + 32, y - 4, label(G.hot, G.mid), "", reg.anim(reg.window(reached))));
    // the box: an outline from boot, filled on the state
    out.push(`<View class="absolute left-[${spineX - 7}px] top-[${y}px] w-[14px] h-[14px] border-[${G.mid}] border animate-${reg.anim(power(18 + i * 4))}" />`);
    out.push(rect(spineX - 4, y + 3, 8, 8, G.hot, "", reg.anim(reg.window(reached))));
    // the current state: an accent bar and a band; CONTACT and TRACKING blink on the half beat
    const blink = t === T_DETECT || t === T_LOCK;
    const band = `<View class="absolute left-[${LX + 8}px] top-[${y - 8}px] w-[${CW - 16}px] h-[30px] animate-${reg.anim(reg.window(reached, until))}"><View class="absolute inset-0 bg-[${G.hot}] opacity-10" />${rect(0, 0, 4, 30, G.hot, "", blink ? reg.loop([reg.short({ "0%": { opacity: "1" }, "55%": { opacity: "1" }, "56%": { opacity: "0.2" }, "100%": { opacity: "0.2" } }, B / 2)], B / 2) : undefined)}</View>`;
    out.push(band);
    if (i > 0) spine.push([reached - 1, String((i - 1) / 4)], [reached + 6, String(i / 4)]);
  });
  out.push(rect(spineX - 0.5, 169, 1, 144, G.mid, "origin-top", reg.anim(reg.prop("scaleY", spine, "cubic-bezier(0.16,1,0.3,1)"))));
  return out.join("\n");
}

// ── the AIS gap: the transponder's last six hours, and the silence after ──

function aisGap(): string {
  const out: string[] = [panelFrame(LX, 372, CW, 260, 8), header(LX + 20, 390, CW - 40, "02", "AIS GAP", "信号中断", 26)];
  const x0 = LX + 20;
  const span = CW - 40;
  const hx = (h: number) => x0 + ((h + 6) / 6) * span; // -6 h .. now
  const by = 478;
  out.push(rect(x0, by, span, 1, G.low, "origin-left", grow("x", 28, 18)));
  for (let h = -6; h <= 0; h++) {
    out.push(rect(hx(h), by - 4, 1, 9, G.mid, "", reg.anim(power(30 + (h + 6) * 2))));
    out.push(at(hx(h) - (h === 0 ? 14 : 8), by + 10, mono(h === 0 ? "NOW" : `${h}h`, 11, G.low), "", reg.anim(power(32 + (h + 6) * 2))));
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
  // the gap's length, counting the seconds
  const secs: [number, string, number?][] = [[0, "13"]];
  for (let s = 1; s <= 9; s++) secs.push([s * 60, String(13 + s), 0]);
  out.push(at(x0, 518, mono("GAP", 13, G.mid), "", reg.anim(power(80))));
  out.push(at(x0 + 46, 514, ui("02:47:", 30, G.hot, true), "", reg.anim(power(80))));
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(80))}">${rolling(x0 + 120, 514, 30, 16, G.hot, secs, "ui", 9)}</View>`);
  // the sweep finds it again: a hit on the timeline's NOW
  out.push(`<View class="absolute left-[${hx(0) - 1}px] top-[${by - 28}px] w-[2px] h-[56px] bg-[${G.hot}] origin-bottom animate-${reg.anim([reg.window(T_DETECT), reg.prop("scaleY", [[0, "0"], [T_DETECT, "0"], [T_DETECT + 8, "1"]], "cubic-bezier(0.16,1,0.3,1)")])}" />`);
  out.push(at(hx(0) - 66, by - 50, mono("SAR HIT", 12, G.hot), "", reg.anim(power(T_DETECT + 4))));
  out.push(at(x0, 566, `<View class="flex-col gap-[6px]">${mono("MMSI 413 820 517 · CARGO", 13, G.mid)}${mono("LAST COG 071° · SOG 17.9 KN", 13, G.mid)}</View>`, "", reg.anim(power(84))));
  return out.join("\n");
}

// ── the track: what the wake and the chip say about the vessel ─────────────

/** The slant range to the contact: closing smoothly through the search, then counting down with the dive. */
const SLANT: [number, string, number?][] = [
  [0, "2416.8"],
  ...series(60, T_LOCK, (t) => (2416.8 - (2416.8 - 412.7) * inOut((t - 60) / (T_LOCK - 60))).toFixed(1).padStart(6, " ")),
  ...series(T_PUSH, T_LAND, (t) => (412.7 / worldMag(t) ** 0.777).toFixed(1).padStart(6, " ")),
];

function trackPanel(): string {
  const out: string[] = [panelFrame(LX, 654, CW, 336, 12), header(LX + 20, 672, CW - 40, "03", "TRACK", "航迹", 34)];
  const x = LX + 20;
  out.push(at(x, 716, `<View class="flex-row items-end gap-[8px]">${mono("SLANT", 13, G.mid)}${cjk("斜距", 12, G.mid)}</View>`, "", reg.anim(power(40))));
  // the slant digits themselves are drawn above the tint (slantNumerals), so they stay white through the flip
  out.push(at(x + 236, 760, ui("KM", 20, G.mid, true), "", reg.anim(power(44))));
  const row = (y: number, label: string, timeline: [number, string, number?][], unit: string, t0: number, seed: number) =>
    `${at(x, y + 3, mono(label, 13, G.mid), "", reg.anim(power(t0)))}<View class="absolute inset-0 animate-${reg.anim(power(t0))}">${rolling(x + 70, y, 16, 9.6, G.hot, timeline, "code", seed)}</View>${at(x + 70 + timeline[0]![1].length * 9.6 + 6, y + 3, mono(unit, 13, G.mid), "", reg.anim(power(t0)))}`;
  const found = T_DETECT + 6;
  out.push(row(812, "HDG", [[0, "---.-"], [found, "072.4"]], "°", 48, 31));
  out.push(row(838, "SPD", [[0, "--.-"], [found + 4, "18.4"]], "KN", 50, 32));
  out.push(row(864, "LEN", [[0, "---"], [found + 8, "182"]], "M", 52, 33));
  out.push(row(890, "CONF", [[0, "0.000"], ...series(T_DETECT, T_FLIP, (t) => (0.997 * inOut((t - T_DETECT) / (T_FLIP - T_DETECT))).toFixed(3))], "", 54, 34));
  out.push(rect(x + 150, 897, 150, 6, G.faint, "", reg.anim(power(54))));
  out.push(rect(x + 150, 897, 150, 6, G.hot, "origin-left", reg.anim(reg.prop("scaleX", [[0, "0"], [T_DETECT, "0"], [T_FLIP, "0.997"]], "cubic-bezier(0.45,0,0.55,1)"))));
  // the dive's own numbers along the foot
  const zoom: [number, string, number?][] = [[0, "01.0"], ...series(T_PUSH, T_LAND, (t) => worldMag(t).toFixed(1).padStart(4, "0"))];
  const arcDeg: [number, string, number?][] = [[0, "9.80"], ...series(T_PUSH, T_LAND, (t) => (9.8 / worldMag(t)).toFixed(2))];
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(58))}">
    ${at(x, 940, mono("ZOOM ×", 13, G.mid))}${rolling(x + 50, 938, 13, 7.8, G.hot, zoom, "code", 11)}
    ${at(x + 140, 940, mono("ARC", 13, G.mid))}${rolling(x + 172, 938, 13, 7.8, G.hot, arcDeg, "code", 12)}${at(x + 204, 940, mono("°", 13, G.mid))}
  </View>`);
  return out.join("\n");
}

/** Numerals that read above the alert tint: white in both states. */
function slantNumerals(): string {
  return `<View class="absolute inset-0 animate-${reg.anim(power(44))}">${rolling(LX + 14, 734, 52, 26, G.hot, SLANT, "ui", 7)}</View>`;
}

// ── the Kelvin wake: the angle every ship's wake makes, and the speed it gives ──

function kelvinPanel(): string {
  const out: string[] = [panelFrame(RX, 100, CW, 300, 8), header(RX + 20, 118, CW - 40, "04", "KELVIN WAKE", "尾迹角", 22)];
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

// ── the SAR chip: noise while it images, the vessel when it locks ──────────

const CHIP = { x: RX + 20, y: 482, s: 320 };

function sarFrame(): string {
  return [panelFrame(RX, 424, CW, 412, 12), header(RX + 20, 442, CW - 40, "05", "SAR CHIP", "雷达成像", 30)].join("\n");
}

/** The chip itself, outside the panels' end-of-film dim: it is what the lock found. */
function sarPanel(): string {
  const out: string[] = [];
  const noise = pngFile("sar-noise", raster.sar(CHIP.s, 7, false), false);
  const ship = pngFile("sar-ship", raster.sar(CHIP.s, 7, true), false);
  // imaging: speckle, its rows refreshed by a scan bar that loops
  out.push(at(CHIP.x, CHIP.y, img(noise, CHIP.s, CHIP.s), "", reg.anim(reg.prop("opacity", [[0, "0"], [60, "0"], [70, "0.55"], [T_DETECT, "0.55"], [T_DETECT + 4, "0.85"]]))));
  const scanLoop: Stops = { "0%": { translateY: "0px" }, "100%": { translateY: `${CHIP.s - 3}px` } };
  out.push(`<View class="absolute left-[${CHIP.x}px] top-[${CHIP.y}px] w-[${CHIP.s}px] h-[3px] animate-${reg.anim(reg.window(70, T_FLIP))}"><View class="absolute inset-0 bg-[${G.hot}] opacity-60 animate-${reg.loop([reg.short(scanLoop, B)], B)}" /></View>`);
  // the lock: the vessel resolves out of the noise in six frames behind a bright bar
  out.push(at(CHIP.x, CHIP.y, img(ship, CHIP.s, CHIP.s), "", reg.anim(reg.prop("opacity", [[0, "0"], [T_FLIP, "0"], [T_FLIP + 12, "1"]]))));
  out.push(`<View class="absolute left-[${CHIP.x}px] top-[${CHIP.y}px] w-[${CHIP.s}px] h-[6px] bg-[${G.hot}] animate-${reg.anim([reg.window(T_FLIP, T_FLIP + 13), reg.prop("translateY", [[0, "0px"], [T_FLIP, "0px"], [T_FLIP + 12, `${CHIP.s - 6}px`]])])}" />`);
  // small brackets snap onto the hull once it has resolved
  const sx = CHIP.x + CHIP.s * 0.64;
  const sy = CHIP.y + CHIP.s * 0.4;
  const S = 64;
  for (let k = 0; k < 4; k++) {
    const el = new El(reg, { x: sx - S / 2, y: sy - S / 2, w: S, h: S }, { op: 0, sx: 1.6, sy: 1.6 });
    el.set(T_FLIP + 12, { op: 1 }).path(T_FLIP + 12, T_FLIP + 30, (t) => {
      const v = 1 + 0.6 * (1 - snapEase((t - T_FLIP - 12) / 18));
      return { sx: v, sy: v };
    });
    out.push(el.node(corner(S, 14, 2, G.hot, k as 0)));
  }
  out.push(at(CHIP.x, CHIP.y + CHIP.s + 10, `<View class="flex-row justify-between w-[${CHIP.s}px]">${mono("VV · 3 M · STRIPMAP", 12, G.mid)}${mono("C-04", 12, G.hot)}</View>`, "", reg.anim(power(74))));
  return out.join("\n");
}

function swathPanel(): string {
  const out: string[] = [panelFrame(RX, 860, CW, 130, 16)];
  out.push(at(RX + 20, 880, `<View class="flex-col gap-[7px]">${mono("SWATH 42 KM · INC 31.2°", 13, G.mid)}${mono("LOOK RIGHT · DESC · PASS 1127", 13, G.mid)}${mono("SEA STATE 3 · WIND 11 KN NE", 13, G.mid)}</View>`, "", reg.anim(power(60))));
  return out.join("\n");
}

// ── the frame's edges: the orbit along the top, the colophon along the foot ──

function orbitTrack(): string {
  const out: string[] = [];
  const x0 = 470;
  const x1 = 1450;
  const y = 40;
  out.push(rect(x0, y, x1 - x0, 1, G.low, "origin-center", grow("x", 4, 24)));
  for (let x = x0; x <= x1; x += 49) out.push(rect(x, y - 3, 1, 7, G.mid, "", reg.anim(power(10 + Math.round((Math.abs(x - CX) / (x1 - x0)) * 30)))));
  // the sub-satellite point creeping along the pass
  const crawl = reg.prop("translateX", [[0, "0px"], [24, "0px"], [TICKS, `${((x1 - x0) * 0.62).toFixed(1)}px`]]);
  out.push(`<View class="absolute left-[${x0 - 6}px] top-[${y - 6}px] w-[12px] h-[12px] animate-${reg.anim([crawl, reg.window(24)])}"><View class="w-[12px] h-[12px] bg-[${G.hot}] rotate-45" /></View>`);
  out.push(at(x0, y + 10, mono("AOS 03:52Z", 11, G.mid), "", reg.anim(power(20))));
  out.push(at(x1 - 66, y + 10, mono("LOS 04:03Z", 11, G.mid), "", reg.anim(power(20))));
  out.push(at(CX - 70, y - 26, mono("REV 1127 · ASC 121.9°E", 11, G.low), "", reg.anim(power(22))));
  return out.join("\n");
}

function colophon(): string {
  const out: string[] = [];
  out.push(at(LX, 1018, `<View class="flex-row items-end">${ui("VEGA-7", 24, G.hot, true)}<View class="w-[10px]" />${cjk("织女-7", 15, G.mid)}<View class="w-[16px]" />${mono("OCEAN SURVEILLANCE · BUILD 0417", 12, G.low)}</View>`, "", reg.anim(power(8))));
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

// ── the verdict: stamped across the foot of the frame on the flip ──────────

function lockBanner(): string {
  const x = 600;
  const y = 924;
  const w = 720;
  const h = 132;
  const t0 = T_FLIP + 2;
  const stamp = new El(reg, { x, y, w, h }, { op: 0, sx: 1.12, sy: 1.12 });
  stamp.set(t0, { op: 1 }).path(t0, t0 + 8, (t) => {
    const v = 1 + 0.12 * (1 - snapEase((t - t0) / 8));
    return { sx: v, sy: v };
  });
  // three alarm blinks before the end
  const blinks: [number, string][] = [[0, "1"]];
  for (const tb of [18 * B, 18 * B + 15, 19 * B]) blinks.push([tb, "0.15"], [tb + 6, "1"]);
  const inner = `<View class="absolute inset-0 bg-[${G.plate}]" /><View class="absolute inset-0 border-[${G.hot}] border-2" />
    ${rect(0, 0, 8, h, G.hot)}
    <View class="absolute left-[30px] top-[0px] h-[${h}px] flex-row items-center">${cjk("目标锁定", 112, G.hot)}</View>
    ${rect(512, 22, 2, h - 44, G.mid)}
    <View class="absolute left-[536px] top-[24px] flex-col gap-[4px]">${ui("TARGET", 22, G.mid, true)}${ui("LOCKED", 52, G.hot, true)}</View>
    <View class="absolute left-[536px] top-[-26px] flex-row items-end gap-[6px] animate-${reg.anim(reg.step("opacity", blinks))}">${ui("PRIORITY 1 ·", 16, G.hot, true)}${cjk("一级", 14, G.hot)}</View>`;
  return stamp.node(inner);
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
  await Bun.write(`${OUT}scan.png`, encodePNG(px, W, H));
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
  await Bun.write(`${OUT}grain.png`, encodePNG(px, w, h));
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
const dim = reg.anim([reg.prop("opacity", [[0, "1"], [T_HOLD, "1"], [T_HOLD + 24, "0.3"]]), defocusEntry]);
const defocus = reg.anim(defocusEntry);
const GLOW = "glow-[12px] glow-[#ffffff] glow-gain-[1.0]";
const centre = [hexGrid(), crosshair(), globe(), rimAndScan(), coast()].join("\n");
// the radar draws in a layer of its own, without glow: composited inside the glow layer over the coast's halo,
// the wedge came out as a dark dither (an engine defect, reported) where white over white must only brighten
const sweep = radar();
const centreTop = [rings(), speedLines(), tracking(), lock()].join("\n");
const panels = [modeLadder(), aisGap(), trackPanel(), kelvinPanel(), sarFrame(), swathPanel(), orbitTrack(), colophon()].join("\n");
// three restrained glitches — 2.0 s, 4.4 s and 6.4 s — each a frame of tears across the picture
const GLITCH = [120, 264, 384];
const tears = GLITCH.flatMap((t, i) =>
  [137, 491, 803].map((y, k) => rect(0, (y + i * 211 + k * 97) % H, W, 2 + ((i + k) % 2), G.hot, "opacity-40", reg.anim(reg.window(t, t + 2)))),
).join("");
const top = [sarPanel(), lockedText(), lockBanner(), tears].join("\n");
const hud = `
      <View class="absolute inset-0 ${GLOW}">${centre}</View>
      <View class="absolute inset-0">${sweep}</View>
      <View class="absolute inset-0 ${GLOW}">${centreTop}</View>
      <View class="absolute inset-0 animate-${dim}">${panelPlates.join("")}</View>
      <View class="absolute inset-0 ${GLOW} animate-${dim}">${panels}</View>
      <View class="absolute inset-0 ${GLOW}">${top}</View>`;

// the alert spreads from the contact to every corner: the gradient's box is a square the width of the frame,
// so its farthest-corner ellipse is a circle, and 0.85 of its radius clears the frame's corners
const ease = "cubic-bezier(0.3,0.6,0.5,1)";
// both stops sit at 0 until the flip, so the rest state is cyan to the centre pixel; the 3 % band opens as the wave runs
const tint = reg.anim([
  reg.prop("gradVia1Pos", [[0, "0"], [T_FLIP, "0"], [T_FLIP + 14, "0.85"]], ease),
  reg.prop("gradVia2Pos", [[0, "0"], [T_FLIP, "0"], [T_FLIP + 14, "0.88"]], ease),
]);
// the punch: the HUD scales 1.06 -> 1 over six frames, jolting sideways once
const punch = reg.anim([
  reg.prop("scale", [[0, "1"], [T_FLIP, "1"], [T_FLIP + 1, "1.06"], [T_FLIP + 12, "1"]], "cubic-bezier(0.16,1,0.3,1)"),
  reg.step("translateX", [
    [0, "0px"], [120, "8px"], [122, "0px"], [264, "-10px"], [266, "4px"], [268, "0px"], [384, "6px"], [386, "0px"],
    [T_FLIP, "10px"], [T_FLIP + 2, "-6px"], [T_FLIP + 4, "0px"], [T_FLIP + 31, "4px"], [T_FLIP + 33, "0px"],
  ]),
]);
// the flip: one white-hot frame, and a warm burst out of the contact for three
const whiteHot = reg.anim(reg.step("opacity", [[0, "0"], [T_FLIP, "0.7"], [T_FLIP + 2, "0"]]));
const bloom = reg.anim(reg.prop("opacity", [[0, "0"], [T_FLIP - 1, "0"], [T_FLIP, "0.85"], [T_FLIP + 6, "0"]]));
// the alert keeps a near-black ground: the grey under the tint drops by 60 % as it flips, so only the linework turns orange
const groundDown = reg.anim(reg.prop("opacity", [[0, "0"], [T_FLIP, "0"], [T_FLIP + 4, "0.6"]]));
// chromatic aberration: the reticle again in red and blue, a pixel and a half off, seven on the flip
// chromatic aberration: the reticle again in red and blue, 1.5 px off; 6 px on each glitch, 8 px decaying over four frames on the flip
const caX = (sign: number) => {
  const k: [number, string][] = [[0, `${sign * 1.5}px`]];
  for (const t of GLITCH) k.push([t - 1, `${sign * 1.5}px`], [t, `${sign * 6}px`], [t + 4, `${sign * 1.5}px`]);
  k.push([T_FLIP - 1, `${sign * 1.5}px`], [T_FLIP, `${sign * 8}px`], [T_FLIP + 8, `${sign * 1.5}px`]);
  return reg.anim([reg.prop("translateX", k)]);
};
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
  <View class="w-full h-full bg-[${G.bg}]">
    <View class="absolute inset-0 bg-[radial-gradient(#2a2a2a,#1e1e1e_45%,#0c0c0c)]" />
    <View class="absolute inset-0 bg-[#000000] animate-${groundDown}" />
    <View class="absolute inset-0 origin-center animate-${punch}">
${hud}
    </View>
    <View class="absolute left-[0px] top-[${CY - W / 2}px] w-[${W}px] h-[${W}px] bg-[radial-gradient(${ORANGE},${ORANGE}_0%,${CYAN}_3%,${CYAN})] mix-blend-multiply animate-${tint}" />
    <View class="absolute inset-0 mix-blend-screen opacity-45 animate-${caX(1)}">${reticle("#ff1f3d", "#7a0f1d", true)}</View>
    <View class="absolute inset-0 mix-blend-screen opacity-45 animate-${caX(-1)}">${reticle("#1f6bff", "#0f2f7a", true)}</View>
    <View class="absolute inset-0 bg-[radial-gradient(#ff2a0000,#ff2a0030)] mix-blend-screen animate-${reg.anim([reg.window(T_FLIP)])}"><View class="absolute inset-0 animate-${reg.loop([reg.short(wash, B, "ease-out", 0)], B)}" /></View>
    <View class="absolute left-[0px] top-[${CY - W / 2}px] w-[${W}px] h-[${W}px] bg-[radial-gradient(#ffd6b0,#ffd6b066_18%,#ffd6b000_45%)] mix-blend-plus-lighter animate-${bloom}" />
    <View class="absolute inset-0 bg-[#ffffff] mix-blend-plus-lighter animate-${whiteHot}" />
    <View class="absolute inset-0 origin-center animate-${punch}"><View class="absolute inset-0 glow-[10px] glow-[#ffffff] glow-gain-[0.6] animate-${defocus}">${slantNumerals()}</View></View>
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
