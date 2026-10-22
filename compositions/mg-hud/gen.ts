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
 * Sweep angle (deg, clockwise from up) per tick: 2.5° a tick through the
 * search, quickening into the lock, phased so the edge crosses the contact's
 * bearing exactly on T_DETECT.
 */
const sweepAngle = (() => {
  const rate = (t: number) => (t < T_SEARCH ? 0 : t < T_DETECT ? 2.5 : t < T_FLIP ? lerp(2.5, 6, (t - T_DETECT) / (T_FLIP - T_DETECT)) : 3);
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
      if (crossed) el.set(t, { op: 1, sx: 1.8, sy: 1.8 }).to(t, t + 18, { op: 0.25, sx: 1, sy: 1 }, outCubic);
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
  const disc = pngFile("disc", raster.disc(2 * R_GLOBE, R_GLOBE - 2, 0.82, 1, [5, 5, 5]));
  const discEl = `<View class="absolute left-[${CX - R_GLOBE}px] top-[${CY - R_GLOBE}px] w-[${2 * R_GLOBE}px] h-[${2 * R_GLOBE}px] animate-${reg.anim([reg.prop("opacity", [[0, "0"], [29, "0"], [30, "1"], [T_PUSH, "1"], [T_PUSH + 8, "0"]]), reg.prop("translateZ", zKeys)])}">${img(disc, 2 * R_GLOBE, 2 * R_GLOBE)}</View>`;
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
  // city tags: a square, a leader, a name; set on the close map as the dive lands
  const cities: [string, string, number, number, number, number][] = [
    ["苏州", "SZV", 120.5853, 31.2989, -150, -50],
    ["南京", "NKG", 118.7969, 32.0603, -60, -40],
    ["杭州", "HGH", 120.1551, 30.2741, -120, 14],
    ["宁波", "NGB", 121.544, 29.8683, 40, 30],
  ];
  const tags = cities
    .map(([zh, code, lo, la, dx, dy], i) => {
      const [ix, iy] = close.proj(lo, la);
      const x = CX + ix - 450;
      const y = CY + iy - 450;
      const t0 = T_LAND - 26 + i * 6;
      return `
      ${rect(x - 5, y - 5, 10, 10, G.hot, "", reg.anim(reg.window(t0)))}
      ${at(x + (dx < 0 ? dx : 12), y + dy, `<View class="flex-row items-end gap-[6px]">${cjk(zh, 18, G.hot)}${mono(code, 12, G.mid)}</View>`, "", reg.anim(power(t0 + 2)))}`;
    })
    .join("");
  return `
    <View class="absolute left-[${CX - LENS}px] top-[${CY - LENS}px] w-[${2 * LENS}px] h-[${2 * LENS}px] rounded-[${LENS}px] overflow-mask">
      ${layer(wide, 1000, 8, [2, 3], [9, 12])}
      ${layer(close, 900, M_FINAL, [9, 12])}
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
  out.push(label.node(`<View class="absolute left-[-8px] top-[-4px] w-[214px] h-[48px] bg-[${G.plate}]" /><View class="flex-col">${mono("C-04 · SURFACE VESSEL", 14, G.hot)}${mono("HDG 072° · 18.4 KN", 13, G.mid)}</View>`));
  return out.join("\n");
}

/**
 * The lock, one gesture from the bracket opening to the flip: four corners
 * open wide at 1.40 on T_LOCK and hold there, dipping on the beats while the
 * lock counts up; the snap is four frames of cubic-out that land at 1.00 on
 * T_FLIP, the frame the alert fires.
 */
function lock(): string {
  const S = 150;
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    const el = new El(reg, { x: CX - S / 2, y: CY - S / 2, w: S, h: S }, { op: 0, sx: 1.4, sy: 1.4 });
    const t0 = T_LOCK + k * 2;
    el.set(t0, { op: 1 }).set(t0 + 2, { op: 0.2 }).set(t0 + 4, { op: 1 });
    for (const tb of [T_LOCK + B / 2, T_LOCK + B]) el.to(tb, tb + 3, { sx: 1.36, sy: 1.36 }, outCubic).to(tb + 3, tb + 14, { sx: 1.4, sy: 1.4 }, inOut);
    el.path(T_SNAP, T_FLIP, (t) => {
      const v = 1 + 0.4 * (1 - outCubic((t - T_SNAP) / (T_FLIP - T_SNAP)));
      return { sx: v, sy: v };
    });
    out.push(el.node(corner(S, 34, 4, G.hot, k as 0)));
  }
  out.push(`<View class="absolute left-[${CX - 22}px] top-[${CY - 22}px] w-[44px] h-[44px] rounded-[22px] border-[${G.hot}] border-2 animate-${reg.anim(reg.window(T_FLIP))}" />`);
  // the lock counting up beside the open brackets, frame by frame, gone when it lands
  const c0 = T_LOCK + 8;
  const pct: [number, string, number?][] = [[0, "000"]];
  for (let t = c0; t <= T_SNAP; t += 2) pct.push([t, String(Math.round(100 * inOut((t - c0) / (T_SNAP - c0)))).padStart(3, "0"), 0]);
  out.push(`<View class="absolute inset-0 animate-${reg.anim(reg.window(c0 - 2, T_FLIP))}">
    ${rect(CX + 112, CY + 92, 132, 30, G.plate)}
    ${at(CX + 120, CY + 99, mono("LOCK", 13, G.mid))}
    ${rolling(CX + 166, CY + 94, 20, 12, G.hot, pct, "code", 3)}
    ${at(CX + 204, CY + 97, mono("%", 18, G.hot))}
  </View>`);
  return out.join("\n");
}

/**
 * The words of the lock, as two callouts on leaders out of the brackets'
 * right-hand corners: the verdict above, the coordinates below, both over
 * the sea east of the coast, so the contact and the land stay clear.
 */
function lockedText(): string {
  const t0 = T_FLIP;
  const flick = (t: number) => reg.anim(reg.step("opacity", [[0, "0"], [t, "1"], [t + 2, "0"], [t + 4, "1"], [t + 5, "0.4"], [t + 7, "1"]]));
  const plate = (x: number, y: number, w: number, h: number, inner: string, anim: string) =>
    `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${h}px] animate-${anim}"><View class="absolute inset-0 bg-[${G.plate}]" /><View class="absolute inset-0 border-[${G.hot}] border" />${rect(0, 0, 4, h, G.hot)}${inner}</View>`;
  /** A leader: a 2 px line from (x, y) at `deg` clockwise from the +x axis, drawn on from its start. */
  const leader = (x: number, y: number, len: number, deg: number, t: number, origin = "origin-left") =>
    `<View class="absolute left-[${x}px] top-[${y - 1}px] w-[${len}px] h-[2px] bg-[${G.hot}] ${origin} ${deg ? `rotate-${deg}` : ""} animate-${grow("x", t, 6)}" />`;
  const out: string[] = [];
  // the verdict: NE of the brackets
  out.push(leader(CX + 75, CY - 75, 99, 315, t0));
  out.push(leader(CX + 145, CY - 145, 32, 0, t0 + 4));
  out.push(
    plate(
      CX + 177,
      CY - 236,
      280,
      150,
      `<View class="absolute left-[22px] top-[10px] flex-col"><View class="flex-row items-end gap-[6px]">${ui("PRIORITY 1 ·", 15, G.mid, true)}${cjk("一级", 13, G.mid)}</View>${cjk("目标锁定", 60, G.hot)}${ui("TARGET LOCKED", 26, G.hot, true)}</View>`,
      flick(t0 + 6),
    ),
  );
  // the coordinates: SE of the brackets, over open sea, so no city on the map is under a plate
  out.push(leader(CX + 75, CY + 75, 99, 45, t0 + 2));
  out.push(leader(CX + 145, CY + 145, 32, 0, t0 + 6));
  out.push(plate(CX + 177, CY + 100, 280, 90, "", flick(t0 + 8)));
  out.push(typed(CX + 199, CY + 112, 24, [["N31°14′  E121°29′", G.hot]], t0 + 12, { cps: 2, cursorUntil: TICKS }));
  out.push(at(CX + 199, CY + 150, mono("TRACK C-04 · HDG 072°", 13, G.mid), "", reg.anim(power(t0 + 48))));
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
  const L = 18;
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

/** Values sampled every frame through the dive, as counter steps (no scramble), consecutive repeats dropped. */
function diveSeries(f: (t: number) => string): [number, string, number][] {
  const out: [number, string, number][] = [];
  for (let t = T_PUSH; t <= T_LAND; t += 2) {
    const v = f(t);
    if (!out.length || out[out.length - 1]![1] !== v) out.push([t, v, 0]);
  }
  return out;
}

/** The distance to the contact: closing a beat at a time through the search, then counting down with the dive. */
const DISTANCE: [number, string, number?][] = [
  [0, "2416.8"], [48, "2398.2"], [T_SEARCH, "2311.5"], [T_SEARCH + B, "2177.9"], [T_SEARCH + 2 * B, "1903.4"], [T_SEARCH + 3 * B, "1652.0"],
  [T_DETECT, "1288.7"], [T_DETECT + B, "0904.1"], [T_DETECT + 2 * B, "0611.6"], [T_LOCK, "0412.7"], [T_LOCK + B, "0408.9"],
  ...diveSeries((t) => (408.9 / worldMag(t) ** 0.777).toFixed(1).padStart(6, "0")),
];

function leftPanel(): string {
  const x = 70;
  const out: string[] = [];
  out.push(panelFrame(50, 104, 430, 880, 6));
  out.push(header(x, 124, 390, "01", "SELF-TEST", "自检", 18));
  const log: [string, string][] = [
    ["> BUS VOLTAGE 28.1 V ......... ", "[OK]"],
    ["> STAR TRACKER · 3 OF 3 ...... ", "[OK]"],
    ["> REACTION WHEELS SYNC ....... ", "[OK]"],
    ["> SENSOR HEAD −40 °C ......... ", "[OK]"],
    ["> CRYPTO KEY 0x5E21 .......... ", "[OK]"],
  ];
  log.forEach(([a, b2], k) => out.push(typed(x, 166 + k * 24, 15, [[a, G.mid], [b2, G.hot]], 22 + k * 15, { cursorUntil: 22 + (k + 1) * 15 })));
  out.push(typed(x, 166 + 5 * 24, 15, [["> SURVEY GRID E-12 ACTIVE", G.hot]], T_SEARCH, { cursorUntil: T_DETECT + 4 }));
  out.push(typed(x, 166 + 6 * 24, 15, [[`> CONTACT C-04 · BRG ${BEARING.toFixed(1).padStart(5, "0")}°`, G.hot]], T_DETECT + 4, { cursorUntil: T_LOCK + 10 }));
  out.push(typed(x, 166 + 7 * 24, 15, [["> TRACK FILE OPEN · LOCKING", G.hot]], T_LOCK + 10, { cursorUntil: T_FLIP }));
  out.push(typed(x, 166 + 8 * 24, 15, [["> LOCK CONFIRMED", G.hot]], T_FLIP + 2, { cursorUntil: T_FLIP + 40 }));

  out.push(header(x, 400, 390, "02", "DISTANCE", "视距", 40));
  // the big number itself is drawn above the tint (heroNumerals), so it stays white through the flip
  out.push(at(x + 250, 490, ui("KM", 22, G.mid, true), "", reg.anim(power(44))));
  const zoom: [number, string, number?][] = [[0, "01.0"], ...diveSeries((t) => worldMag(t).toFixed(1).padStart(4, "0"))];
  const arcDeg: [number, string, number?][] = [[0, "9.80"], ...diveSeries((t) => (9.8 / worldMag(t)).toFixed(2))];
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(52))}">
    ${at(x, 540, mono("ZOOM ×", 14, G.mid))}${rolling(x + 51, 538, 14, 8.4, G.hot, zoom, "code", 11)}
    ${at(x + 140, 540, mono("ARC", 14, G.mid))}${rolling(x + 172, 538, 14, 8.4, G.hot, arcDeg, "code", 12)}${at(x + 206, 540, mono("°", 14, G.mid))}
    ${at(x + 262, 540, mono("EL 62.4°", 14, G.mid))}
  </View>`);

  // orbit: an ellipse and the satellite riding it
  out.push(header(x, 586, 390, "03", "ORBIT", "轨道", 50));
  const ecx = x + 120;
  const ecy = 700;
  const eA = 104;
  const eB = 44;
  const orbitF = pngFile("orbit", raster.ellipse(2 * eA + 10, 2 * eB + 10, eA, eB, 1.4));
  out.push(at(ecx - eA - 5, ecy - eB - 5, img(orbitF, 2 * eA + 10, 2 * eB + 10), "", reg.anim(power(56))));
  out.push(`<View class="absolute left-[${ecx - 16}px] top-[${ecy - 16}px] w-[32px] h-[32px] rounded-[16px] bg-[${G.mid}] animate-${reg.anim(power(58))}" />`);
  const sat = new El(reg, { x: ecx - 5, y: ecy - 5, w: 10, h: 10 }, { op: 0 });
  sat.set(60, { op: 1 }).path(60, TICKS, (t) => {
    const th = 0.6 + (t / 60) * 0.9;
    return { cx: ecx + eA * Math.cos(th), cy: ecy + eB * Math.sin(th) };
  }, 4);
  out.push(sat.node(`<View class="w-[10px] h-[10px] bg-[${G.hot}] rotate-45" />`));
  out.push(at(x + 250, 660, `<View class="flex-col gap-[6px]">${mono("PERIGEE  611 KM", 13, G.mid)}${mono("APOGEE   634 KM", 13, G.mid)}${mono("REV      1127", 13, G.hot)}</View>`, "", reg.anim(power(62))));

  // the survey grid's own small radar, its sweep a turning wedge
  out.push(header(x, 810, 390, "04", "SURVEY GRID", "巡查网格", 60));
  const mr = 58;
  const mcx = x + 70;
  const mcy = 906;
  const ringN = (rr: number, c: string) => arc(rr, 1, 0, 360, c, [], mcx, mcy);
  const mw = pngFile("wedge-mini", raster.wedge(2 * mr, mr, 50, 0.45, 2));
  const msw = reg.prop("rotate", [[0, "0deg"], [TICKS, "2400deg"]]);
  const msweep = `<View class="absolute left-[${mcx}px] top-[${mcy}px] w-[0px] h-[0px] animate-${reg.anim(msw)}"><View class="absolute left-[${-mr}px] top-[${-mr}px]">${img(mw, 2 * mr, 2 * mr)}</View>${rect(-1, -mr, 2, mr, G.hot)}</View>`;
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(64))}">${ringN(mr, G.mid)}${ringN(mr * 0.66, G.low)}${ringN(mr * 0.33, G.low)}${rect(mcx - mr, mcy, 2 * mr, 1, G.low)}${rect(mcx, mcy - mr, 1, 2 * mr, G.low)}${msweep}</View>`);
  const blips: [number, number, number][] = [[24, -30, T_SEARCH + 20], [-34, 18, T_SEARCH + 55], [12, 36, T_DETECT - 10], [40, -8, T_DETECT + 2]];
  for (const [dx, dy, t] of blips) out.push(rect(mcx + dx - 3, mcy + dy - 3, 6, 6, G.hot, "", reg.anim(reg.prop("opacity", [[0, "0"], [t - 1, "0"], [t, "1"], [t + 40, "0.3"]]))));
  out.push(at(x + 160, 868, `<View class="flex-col gap-[6px]">${mono("PATTERN  LADDER-6", 13, G.mid)}${mono("SECTOR   E-12", 13, G.mid)}${mono("CONTACTS 04", 13, G.hot)}</View>`, "", reg.anim(power(70))));
  return out.join("\n");
}

/** Numerals that read above the alert tint: white in both states. */
function heroNumerals(): string {
  return `<View class="absolute inset-0 animate-${reg.anim(power(44))}">${rolling(66, 436, 80, 40, G.hot, DISTANCE, "ui", 7)}</View>`;
}

function rightPanel(): string {
  const x = 1460;
  const out: string[] = [];
  out.push(panelFrame(1440, 104, 430, 880, 10));
  // the wake's profile: the live trace converges on the reference as the lock closes
  out.push(header(x, 124, 390, "05", "WAKE PROFILE", "尾迹比对", 24));
  const r = rng(5);
  const ys: number[] = [];
  let v = 0;
  for (let k = 0; k <= 180; k++) {
    v = v * 0.7 + (r() - 0.5) * 18;
    ys.push(36 + v + Math.sin(k * 0.21) * 9);
  }
  const ref = pngFile("trace-ref", raster.trace(720, 72, ys, 4, 1.4));
  const live = pngFile("trace-live", raster.trace(720, 72, ys.map((y, k) => y + Math.sin(k * 0.5) * 6), 4, 2));
  const scroll = reg.prop("translateX", [[0, "0px"], [TICKS, "-330px"]]);
  const offset = reg.prop("translateY", [[0, "22px"], [T_DETECT, "16px"], [T_LOCK + 20, "0px"]], "cubic-bezier(0.16,1,0.3,1)");
  out.push(`<View class="absolute left-[${x}px] top-[170px] w-[390px] h-[110px] overflow-hidden animate-${reg.anim(power(30))}"><View class="absolute left-[0px] top-[12px] opacity-40 animate-${reg.anim(scroll)}">${img(ref, 720, 72)}</View><View class="absolute left-[0px] top-[12px] animate-${reg.anim([scroll, offset])}">${img(live, 720, 72)}</View></View>`);
  const deltas: [number, string, number?][] = [[0, "0.421"], [T_SEARCH, "0.388"], [T_SEARCH + 2 * B, "0.244"], [T_DETECT, "0.130"], [T_DETECT + B, "0.061"], [T_LOCK, "0.012"], [T_LOCK + 20, "0.003"]];
  out.push(at(x, 288, mono("Δ WAKE", 13, G.mid), "", reg.anim(power(34))));
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(36))}">${rolling(x + 64, 284, 15, 9, G.hot, deltas, "code", 51)}</View>`);
  out.push(rect(x, 316, 390, 1, G.faint));

  // IFF: a grid of transponder cells; one stays dark, then lights alone
  out.push(header(x, 340, 390, "06", "IFF", "敌我识别", 44));
  const rr = rng(23);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 10; col++) {
      const cx = x + col * 39;
      const cy = 384 + row * 30;
      const target = row === 2 && col === 6;
      const ch: [number, string][] = [[0, "0"]];
      let t = 50 + Math.floor(rr() * 40);
      let on = false;
      while (t < TICKS) {
        on = !on;
        if (target && t > T_DETECT) on = true;
        ch.push([t, on ? (target ? "1" : "0.55") : "0.12"]);
        // the cells chatter faster as the contact closes
        const pace = t < T_DETECT ? 1 : t < T_FLIP ? 0.55 : 1;
        t += Math.round((8 + Math.floor(rr() * 40)) * pace);
      }
      out.push(rect(cx, cy, 33, 22, target ? G.hot : G.mid, "", reg.anim(reg.step("opacity", dedupe(ch)))));
    }
  }
  out.push(at(x, 508, `<View class="flex-row justify-between w-[390px] items-end">${mono("TRANSPONDER 2·6", 13, G.mid)}<View class="flex-row items-end gap-[6px]">${mono("SILENT ·", 13, G.hot)}${cjk("应答静默", 12, G.hot)}</View></View>`, "", reg.anim(reg.window(T_DETECT))));

  // the X band
  out.push(header(x, 572, 390, "07", "X-BAND", "频谱", 56));
  const bars: string[] = [];
  for (let k = 0; k < 30; k++) {
    const keys: [number, string][] = [[0, "0.04"], [60, "0.04"]];
    for (let t = 62; t <= TICKS; t += 4) {
      let vv = 0.15 + r() * 0.55 * (0.6 + 0.4 * Math.sin(k * 0.5 + t * 0.03));
      if (k === 19 && t > T_DETECT) vv = 0.92 + r() * 0.08;
      keys.push([t, vv.toFixed(3)]);
    }
    bars.push(rect(x + k * 13, 640, 8, 110, k === 19 ? G.hot : G.mid, "origin-bottom", reg.anim(reg.prop("scaleY", keys))));
  }
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(60))}">${bars.join("")}${rect(x, 752, 390, 1, G.low)}</View>`);
  out.push(at(x + 19 * 13 - 30, 760, mono("9.650 GHz", 12, G.hot), "", reg.anim(reg.window(T_DETECT))));

  // downlink: packets scrolling
  out.push(header(x, 800, 390, "08", "DOWNLINK", "下行", 66));
  const r2 = rng(77);
  const lines: string[] = [];
  for (let k = 0; k < 40; k++) {
    const hex = Array.from({ length: 8 }, () => Math.floor(r2() * 65536).toString(16).toUpperCase().padStart(4, "0")).join(" ");
    lines.push(`<View class="h-[19px]">${mono(`${(k * 16).toString(16).toUpperCase().padStart(4, "0")}  ${hex}`, 12, k % 7 === 3 ? G.hot : G.low)}</View>`);
  }
  const up = reg.prop("translateY", [[0, "0px"], [TICKS, `-${19 * 26}px`]]);
  out.push(`<View class="absolute left-[${x}px] top-[842px] w-[390px] h-[120px] overflow-hidden animate-${reg.anim(power(70))}"><View class="absolute left-[0px] top-[0px] flex-col animate-${reg.anim(up)}">${lines.join("")}</View></View>`);
  return out.join("\n");
}

// ── top bar, clock, bottom tape ────────────────────────────────────────────

function topBar(): string {
  const out: string[] = [];
  out.push(`<View class="absolute left-[56px] top-[38px] w-[26px] h-[26px] rounded-[13px] border-[${G.hot}] border-2 animate-${reg.anim(power(6))}"><View class="absolute left-[7px] top-[7px] w-[8px] h-[8px] bg-[${G.hot}] rotate-45" /></View>`);
  out.push(at(94, 34, `<View class="flex-row items-end">${ui("VEGA-7", 26, G.hot, true)}<View class="w-[10px]" />${cjk("织女-7", 16, G.mid)}<View class="w-[18px]" />${mono("DEEP-SEA SURVEY ARRAY · BUILD 0417", 13, G.low)}</View>`, "", reg.anim(power(8))));
  out.push(rect(50, 78, 1820, 1, G.low, "origin-left", grow("x", 6, 24)));
  const states: [number, string, string][] = [
    [0, "POWER-ON", "上电"],
    [T_SEARCH, "SURVEY", "巡查"],
    [T_DETECT, "CONTACT", "发现目标"],
    [T_LOCK, "TRACKING", "跟踪中"],
    [T_FLIP, "TARGET LOCKED", "目标锁定"],
  ];
  out.push(`<View class="absolute left-[${CX - 150}px] top-[30px] w-[300px] h-[34px] animate-${reg.anim(power(10))}"><View class="absolute inset-0 bg-[${G.plate}]" /><View class="absolute inset-0 border-[${G.mid}] border-2" /></View>`);
  states.forEach(([t, en, zh], k) => {
    const until = states[k + 1]?.[0];
    // CONTACT and TRACKING blink on the half beat: the escalation is in the status line too
    const blink = t === T_DETECT || t === T_LOCK ? [reg.loop([reg.short({ "0%": { opacity: "1" }, "60%": { opacity: "1" }, "61%": { opacity: "0.25" }, "100%": { opacity: "0.25" } }, B / 2)], B / 2)] : [];
    const inner = `${ui(en, 18, G.hot, true)}<View class="w-[8px]" />${cjk(zh, 13, G.mid)}`;
    out.push(`<View class="absolute left-[${CX - 150}px] top-[30px] w-[300px] h-[34px] animate-${reg.anim(reg.window(Math.max(t, 10), until))}">${blink.length ? `<View class="absolute inset-0 flex-row justify-center items-center animate-${blink[0]}">${inner}</View>` : `<View class="absolute inset-0 flex-row justify-center items-center">${inner}</View>`}</View>`);
  });
  out.push(`<View class="absolute left-[1560px] top-[42px] w-[10px] h-[10px] rounded-[5px] bg-[${G.hot}] animate-${reg.loop([reg.short({ "0%": { opacity: "1" }, "50%": { opacity: "1" }, "51%": { opacity: "0.15" }, "100%": { opacity: "0.15" } }, 2 * B)], 2 * B)}" />`);
  out.push(at(1580, 36, ui("REC", 16, G.mid, true), "", reg.anim(power(12))));
  out.push(at(1640, 36, mono("MET 00:41:", 17, G.mid), "", reg.anim(power(12))));
  out.push(`<View class="absolute inset-0 animate-${reg.anim(power(12))}">${clock(1640 + 10 * 17 * 0.6, 36)}</View>`);
  return out.join("\n");
}

/** Mission elapsed seconds and frames, from 00:41:07:00: every glyph a looping or stepped window. */
function clock(x: number, y: number): string {
  const size = 17;
  const cw = size * 0.6;
  const S0 = 7;
  const cell = (inner: string) => `<View class="w-[${cw}px] h-[22px]">${inner}</View>`;
  const glyph = (ch: string, anim: string) => `<View class="absolute inset-0 flex-row justify-center animate-${anim}">${mono(ch, size, G.hot)}</View>`;
  const turn = (10 - S0) * 60; // the tick the seconds reach 10
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

function bottomTape(): string {
  const out: string[] = [];
  out.push(rect(50, 1000, 1820, 1, G.low, "origin-left", grow("x", 10, 24)));
  const pxPerDeg = 6;
  const marks: string[] = [];
  for (let d = -60; d <= 240; d += 5) {
    const xx = d * pxPerDeg;
    const big = d % 15 === 0;
    marks.push(rect(xx, 0, 2, big ? 14 : 7, big ? G.mid : G.low));
    if (big) marks.push(at(xx - 14, 18, mono(String((d + 360) % 360).padStart(3, "0"), 13, G.mid)));
  }
  const slide: [number, string][] = [];
  for (let t = 0; t <= TICKS; t += 4) slide.push([t, `${(-lonFront(t) * pxPerDeg * 0.5).toFixed(2)}px`]);
  out.push(`<View class="absolute left-[${CX - 520}px] top-[1012px] w-[1040px] h-[40px] overflow-hidden animate-${reg.anim(power(20))}"><View class="absolute left-[520px] top-[0px] animate-${reg.anim(reg.prop("translateX", slide))}">${marks.join("")}</View></View>`);
  out.push(`<View class="absolute left-[${CX - 7}px] top-[1004px] w-[14px] h-[14px] bg-[${G.hot}] rotate-45 animate-${reg.anim(power(22))}" />`);
  out.push(at(70, 1018, mono("SUB-POINT 31.23N 121.47E · ALT 618.2 KM · SUN EL 42°", 14, G.mid), "", reg.anim(power(26))));
  out.push(at(1560, 1018, mono("PKT 0x3F2A · BER 1E-9", 14, G.low), "", reg.anim(power(28))));
  return out.join("\n");
}

function hexGrid(): string {
  const w = 1400;
  const h = 1000;
  const file = pngFile("hex", raster.hexGrid(w, h, 26, 1.4, 330, 640));
  // the grid warms as the contact closes, then falls back under the dive
  return at(CX - w / 2, CY - h / 2, img(file, w, h), "", reg.anim(reg.prop("opacity", [[0, "0"], [24, "0"], [70, "0.3"], [T_DETECT, "0.3"], [T_FLIP - 2, "0.5"], [T_PUSH, "0.5"], [T_PUSH + 30, "0.08"]])));
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
const centre = [hexGrid(), crosshair(), globe(), rimAndScan(), coast(), radar(), rings(), speedLines(), tracking(), lock()].join("\n");
const panels = [leftPanel(), rightPanel(), bottomTape()].join("\n");
const top = [topBar(), lockedText()].join("\n");
const hud = `
      <View class="absolute inset-0 ${GLOW}">${centre}</View>
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
  reg.step("translateX", [[0, "0px"], [T_FLIP, "10px"], [T_FLIP + 2, "-6px"], [T_FLIP + 4, "0px"], [T_FLIP + 31, "4px"], [T_FLIP + 33, "0px"]]),
]);
// a warm additive flash for two frames on the flip
const bloom = reg.anim(reg.prop("opacity", [[0, "0"], [T_FLIP - 1, "0"], [T_FLIP, "0.85"], [T_FLIP + 6, "0"]]));
// chromatic aberration: the reticle again in red and blue, a pixel and a half off, seven on the flip
const caX = (sign: number) => reg.anim([reg.prop("translateX", [[0, `${sign * 1.5}px`], [T_FLIP, `${sign * 1.5}px`], [T_FLIP + 1, `${sign * 7}px`], [T_FLIP + 10, `${sign * 1.5}px`]], "cubic-bezier(0.16,1,0.3,1)")]);
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
    <View class="absolute inset-0 origin-center animate-${punch}">
${hud}
    </View>
    <View class="absolute left-[0px] top-[${CY - W / 2}px] w-[${W}px] h-[${W}px] bg-[radial-gradient(${ORANGE},${ORANGE}_0%,${CYAN}_3%,${CYAN})] mix-blend-multiply animate-${tint}" />
    <View class="absolute inset-0 mix-blend-screen opacity-45 animate-${caX(1)}">${reticle("#ff1f3d", "#7a0f1d", true)}</View>
    <View class="absolute inset-0 mix-blend-screen opacity-45 animate-${caX(-1)}">${reticle("#1f6bff", "#0f2f7a", true)}</View>
    <View class="absolute inset-0 bg-[radial-gradient(#ff2a0000,#ff2a0055)] mix-blend-screen animate-${reg.anim([reg.window(T_FLIP)])}"><View class="absolute inset-0 animate-${reg.loop([reg.short(wash, B, "ease-out", 0)], B)}" /></View>
    <View class="absolute left-[0px] top-[${CY - W / 2}px] w-[${W}px] h-[${W}px] bg-[radial-gradient(#ffd6b0,#ffd6b066_18%,#ffd6b000_45%)] mix-blend-plus-lighter animate-${bloom}" />
    <View class="absolute inset-0 origin-center animate-${punch}"><View class="absolute inset-0 glow-[10px] glow-[#ffffff] glow-gain-[0.6] animate-${defocus}">${heroNumerals()}</View></View>
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
