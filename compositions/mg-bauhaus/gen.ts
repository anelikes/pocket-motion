#!/usr/bin/env bun
/**
 * compositions/mg-bauhaus — EIN MODUL · 模数构成. A Bauhaus kinetic poster.
 *
 * 10 s · 1920×1080 · 30 fps · 120 BPM, twenty beats. Written against the
 * "Geometric / Bauhaus" prompt of github.com/Vincentwei1021/mg-styles-15 and
 * judged by that repository's rubric.md; v3 answers the second jury's notes.
 *
 * Everything is one module. The grid is ruled in black and settles to a
 * hairline; a red 240 px module lands, rolls three modules about its own
 * corner printing a quarter, a half and a triangle behind it; the row ripples
 * and turns a quarter about the frame centre; the forms take their places
 * one per beat, each on a path through empty modules (poster.ts). On the drop
 * the poster is cut into its 128 cells and every cell snaps a quarter about
 * its own centre in two frames; a diagonal wave turns each cell over to the
 * same red module, a sine wave runs out through the field of 128, and a wave
 * from the other corner turns them back onto the finished poster. BAUHAUS is
 * stamped a letter per sixteenth.
 *
 * Motion is sampled here at 60 Hz and baked as linear keyframes (motion.ts).
 * Forms are signed-distance PNGs with a printed edge (ink.ts), each ink
 * offset by its plate's misregistration; the paper is the ground under them.
 *
 *   bun compositions/mg-bauhaus/gen.ts
 *   bun src/cli/main.ts build compositions/mg-bauhaus
 */

import { fileURLToPath } from "node:url";
import * as opentype from "../../vendor/pocketjs/node_modules/opentype.js/dist/opentype.mjs";
import { encodePNG } from "../../vendor/pocketjs/tests/png.ts";
import * as ink from "./ink.ts";
import { El, Reg, inOut, jsx, lerp, type State } from "./motion.ts";
import { GY, INK, M, MISREG, POSTER, gx, gy, type Form, type Ink } from "./poster.ts";

const OUT = fileURLToPath(new URL(".", import.meta.url));
const STATIC = process.env.POSTER_ONLY === "1";

// ── time ───────────────────────────────────────────────────────────────────

const FPS = 30;
const TICKS = 600;
const DUR_MS = 10_000;
const B = 30;
const b = (n: number) => Math.round(n * B);
const reg = new Reg(TICKS, DUR_MS);

const W = 1920;
const H = 1080;
const CX = 960;
const CY = 540;

const writes: Promise<number>[] = [];
const images: Record<string, { linear: boolean }> = {};
function png(name: string, buf: Buffer, linearSample = true): string {
  const file = `${name}.png`;
  images[file] = { linear: linearSample };
  writes.push(Bun.write(`${OUT}${file}`, buf));
  return file;
}
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const img = (file: string, w: number, h: number) => `<Image class="w-[${w}px] h-[${h}px]" src="${file}" />`;

/**
 * The PNG of a form, drawn into its own w×h box and turned `quarters`
 * clockwise in pixels. A form at rest is never a turned picture: the core
 * draws a turned textured quad as two triangles whose shared diagonal shows
 * as a faint line, so a turn the poster keeps is baked into the pixels.
 */
const formFiles = new Map<string, string>();
function formFile(f: { kind: Form["kind"]; ink: Ink; w: number; h: number }, seed: number, quarters = 0): string {
  const q = ((quarters % 4) + 4) % 4;
  const key = `${f.kind}-${f.ink}-${f.w}x${f.h}-${seed}${q ? `-q${q}` : ""}`;
  // twice the drawn size, unless that passes the 2048 px a picture may be
  if (!formFiles.has(key)) formFiles.set(key, png(`f-${key}`, ink.form(f.kind, f.w, f.h, rgb(INK[f.ink]), seed, Math.min(2, 2048 / Math.max(f.w, f.h)), q)));
  return formFiles.get(key)!;
}
/** A form's PNG in its box, its poster turn `rot` baked into the picture. */
function formInner(f: Form, seed: number): string {
  return img(formFile(f, seed, f.rot ?? 0), f.w, f.h);
}

// ── type as outlines ───────────────────────────────────────────────────────

const archivo = opentype.parse(await Bun.file(`${OUT}fonts/ArchivoBlack-Regular.ttf`).arrayBuffer());

/**
 * BAUHAUS set vertically, reading upward, its cap height exactly one module
 * and its length exactly eight: the word is scaled to the box, not to a size.
 * Rasterised by scanlines (non-zero, 4×4 subsamples) from its flattened
 * outline, then cut between its glyphs into one picture per letter, so each
 * letter can be stamped on its own sixteenth.
 */
function verticalWord(text: string, capH: number, length: number, color: string): { letters: { file: string; top: number; h: number }[]; w: number; h: number } {
  const p = archivo.getPath(text, 0, 0, 100, { kerning: true });
  const bb = p.getBoundingBox();
  const sx = length / (bb.x2 - bb.x1);
  const sy = capH / (bb.y2 - bb.y1);
  const S = 2;
  const w = capH;
  const h = length;
  const polys: [number, number][][] = [];
  let cur: [number, number][] = [];
  const P = (x: number, y: number): [number, number] => [(y - bb.y1) * sy * S, (length - (x - bb.x1) * sx) * S];
  let last: [number, number] = [0, 0];
  for (const c of p.commands as { type: string; x: number; y: number; x1: number; y1: number; x2: number; y2: number }[]) {
    if (c.type === "M") {
      if (cur.length) polys.push(cur);
      cur = [P(c.x, c.y)];
      last = [c.x, c.y];
    } else if (c.type === "L") {
      cur.push(P(c.x, c.y));
      last = [c.x, c.y];
    } else if (c.type === "Q") {
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        cur.push(P((1 - t) ** 2 * last[0] + 2 * (1 - t) * t * c.x1 + t * t * c.x, (1 - t) ** 2 * last[1] + 2 * (1 - t) * t * c.y1 + t * t * c.y));
      }
      last = [c.x, c.y];
    } else if (c.type === "C") {
      for (let k = 1; k <= 10; k++) {
        const t = k / 10;
        const u = 1 - t;
        cur.push(P(u ** 3 * last[0] + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x, u ** 3 * last[1] + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y));
      }
      last = [c.x, c.y];
    } else if (c.type === "Z") {
      if (cur.length) polys.push(cur);
      cur = [];
    }
  }
  if (cur.length) polys.push(cur);
  const PW = w * S;
  const PH = h * S;
  const cov = new Float32Array(PW * PH);
  const SS = 4;
  for (let j = 0; j < PH; j++) {
    for (let sj = 0; sj < SS; sj++) {
      const yy = j + (sj + 0.5) / SS;
      const xs: [number, number][] = [];
      for (const poly of polys) {
        for (let i = 0; i < poly.length; i++) {
          const [x0, y0] = poly[i]!;
          const [x1, y1] = poly[(i + 1) % poly.length]!;
          if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) xs.push([x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
        }
      }
      xs.sort((a, c) => a[0] - c[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k]![1];
        if (wind === 0) continue;
        const a = xs[k]![0];
        const z = xs[k + 1]![0];
        for (let s2 = 0; s2 < SS; s2++) {
          const off = (s2 + 0.5) / SS;
          const i0 = Math.max(0, Math.ceil(a - off));
          const i1 = Math.min(PW - 1, Math.floor(z - off));
          for (let i = i0; i <= i1; i++) cov[j * PW + i]! += 1 / (SS * SS);
        }
      }
    }
  }
  // where each glyph sits along the line, in the path's own units, with the same kerning getPath applied
  const glyphs = archivo.stringToGlyphs(text);
  const em = 100 / archivo.unitsPerEm;
  const ext: [number, number][] = [];
  let pen = 0;
  glyphs.forEach((gl: { advanceWidth: number; getBoundingBox(): { x1: number; x2: number } }, i: number) => {
    const gb = gl.getBoundingBox();
    ext.push([pen + gb.x1 * em, pen + gb.x2 * em]);
    pen += gl.advanceWidth * em;
    if (i < glyphs.length - 1) pen += archivo.getKerningValue(gl, glyphs[i + 1]) * em;
  });
  const cuts = [bb.x1 - 1, ...ext.slice(1).map(([x0], i) => (ext[i]![1] + x0) / 2), bb.x2 + 1];
  // the word reads upward: glyph x maps to image row (length - (x - x1) * sx) * S, on even rows so each letter lands on a whole pixel
  const row = (x: number) => Math.max(0, Math.min(PH, 2 * Math.round(((length - (x - bb.x1) * sx) * S) / 2)));
  const [r, g, bl] = rgb(color);
  const letters = text.split("").map((ch, i) => {
    const r0 = row(cuts[i + 1]!);
    const r1 = row(cuts[i]!);
    const LH = r1 - r0;
    const px = new Uint8Array(PW * LH * 4);
    for (let j = 0; j < LH; j++) {
      for (let x = 0; x < PW; x++) {
        const k = (j * PW + x) * 4;
        px[k] = r;
        px[k + 1] = g;
        px[k + 2] = bl;
        px[k + 3] = Math.round(Math.min(1, cov[(r0 + j) * PW + x]!) * 255);
      }
    }
    return { file: png(`word-${i}-${ch}`, encodePNG(px, PW, LH)), top: r0 / S, h: LH / S };
  });
  return { letters, w, h };
}

// ═══════════════════════════════════════════════════════════════════════════

const T_TURN = b(6);
const T_DROP = b(12);
const T_POSTER = b(16); // 8.0 s: the finished poster
const T_TYPE = b(16);

// ── grid: horizontals on the eighths, verticals on the sixteenths between, from the centre out ──

/** When each grid line is drawn: rows in pairs about the centre row on 8ths, columns in pairs about the centre column on the 16ths between. */
const rowAt = (r: number) => 2 + 15 * Math.abs(r - 4);
const colAt = (c: number) => 8 + 15 * Math.abs(c - 8);
function grid(): string {
  const out: string[] = [];
  const line = (v: boolean, at: number, t0: number) => {
    const draw = reg.prop(v ? "scaleY" : "scaleX", [[0, "0"], [t0, "0"], [t0 + 10, "1"]], "cubic-bezier(0.45,0,0.55,1)");
    const settle = reg.prop("backgroundColor", [[0, INK.black], [t0 + 40, INK.black], [t0 + 70, "#DACDB5"]]);
    // the finished print: the construction fades to a third
    const recede = reg.prop("opacity", [[0, "1"], [T_POSTER, "1"], [T_POSTER + 20, "0.35"]]);
    const cls = v ? `left-[${at - 1}px] top-[0px] w-[2px] h-[${H}px]` : `left-[0px] top-[${at - 1}px] w-[${W}px] h-[2px]`;
    out.push(`<View class="absolute ${cls} origin-center animate-${reg.anim(STATIC ? [recede] : [draw, settle, recede])}" />`);
  };
  for (let r = 0; r <= 8; r++) line(false, gy(r), rowAt(r));
  for (let c = 1; c < 16; c++) line(true, c * 120, colAt(c));
  return out.join("\n    ");
}

// ── the forms ──────────────────────────────────────────────────────────────

function misreg(f: Form): Form {
  const [dx, dy] = MISREG[f.ink];
  return { ...f, x: f.x + dx, y: f.y + dy };
}
const seedOf = (id: string) => 100 + POSTER.findIndex((f) => f.id === id);

/** The poster drawn statically, with the frame origin at (ox, oy). */
function posterNodes(ox: number, oy: number): string {
  return POSTER.map((f0) => {
    const f = misreg(f0);
    return `<View class="absolute left-[${f.x + ox}px] top-[${f.y + oy}px] w-[${f.w}px] h-[${f.h}px]">${formInner(f, seedOf(f.id))}</View>`;
  }).join("");
}

/** An element's state at tick t: the baked keys are linear, so this is what the core will draw. */
function stateAt(el: El, t: number): State {
  const ks = [...el.keys.keys()].sort((a, c) => a - c);
  if (t <= ks[0]!) return { ...el.keys.get(ks[0]!)! };
  for (let i = 0; i + 1 < ks.length; i++) {
    const a = ks[i]!;
    const z = ks[i + 1]!;
    if (t >= a && t <= z) {
      const p = el.keys.get(a)!;
      const q = el.keys.get(z)!;
      const u = z === a ? 1 : (t - a) / (z - a);
      return { cx: lerp(p.cx, q.cx, u), cy: lerp(p.cy, q.cy, u), rot: lerp(p.rot, q.rot, u), sx: lerp(p.sx, q.sx, u), sy: lerp(p.sy, q.sy, u), op: lerp(p.op, q.op, u) };
    }
  }
  return { ...el.keys.get(ks[ks.length - 1]!)! };
}

/**
 * An echo of a fast move: the element again, `lag` ticks behind it at
 * `alpha` of its opacity, present only inside `spans`. Two of them stand in
 * for the motion blur a tick-quantised core cannot draw, and read as a
 * multiple exposure, which the style allows.
 */
function echo(el: El, lag: number, alpha: number, spans: [number, number][]): El {
  const g = new El(reg, el.home, { op: 0 });
  for (const [a, z] of spans) {
    g.keys.set(a + lag - 1, { ...stateAt(el, a - 1), op: 0 });
    for (let t = a + lag; t <= z + lag; t++) {
      const s = stateAt(el, t - lag);
      g.keys.set(t, { ...s, op: s.op * alpha });
    }
    g.keys.set(z + lag + 1, { ...stateAt(el, z), op: 0 });
  }
  g.s = { ...stateAt(el, TICKS), op: 0 };
  return g;
}

function forms(): string {
  if (STATIC) return posterNodes(0, 0);
  const P = Object.fromEntries(POSTER.map((f) => [f.id, misreg(f)])) as Record<string, Form>;
  const centre = (f: Form) => ({ cx: f.x + f.w / 2, cy: f.y + f.h / 2 });

  // the row: four 240 px cells, columns 4..11, rows 2..3 — its bottom edge on the centre line
  const ROW_Y = gy(2);
  const cell = (k: number) => ({ cx: gx(4 + 2 * k) + M, cy: ROW_Y + M });

  // b1 · the module lands, sliding in from the left edge
  const mod = new El(reg, P.module!, { ...cell(0), sx: 2, sy: 2, op: 0 });
  mod.set(b(1) - 14, { op: 1, cx: -2 * M }).to(b(1) - 14, b(1), { cx: cell(0).cx }, inOut);
  // b2..b4 · it rolls about its bottom-right corner, touching down on each beat
  for (let k = 0; k < 3; k++) {
    const t1 = b(2 + k);
    mod.orbit(t1 - 12, t1, gx(4 + 2 * k) + 2 * M, ROW_Y + 2 * M, 90);
  }
  // the three stamps it prints as it lifts off, each its poster form at the cell's size
  const stamp = (id: string, k: number, scale: number, rot: number) => {
    const el = new El(reg, P[id]!, { ...cell(k), sx: scale, sy: scale, rot, op: 0 });
    el.set(b(2 + k) - 12, { op: 1 });
    return el;
  };
  // the quarter's picture carries its poster turn, so its angle here is measured from that (0 at rest)
  const quarter = stamp("quarter", 0, 1, 0);
  const half = stamp("half", 1, 1, 0);
  const tri = stamp("tri", 2, 0.5, 0);
  const row = [quarter, half, tri, mod];

  // b4½..b5¼ · a ripple along the row: each cell hops one whole module, three frames up and three down,
  //   landing on its sixteenth rounded to a whole frame
  row.forEach((el, k) => {
    const land = 2 * Math.round((b(4.5) + 7.5 * k) / 2);
    const y0 = cell(k).cy;
    el.to(land - 12, land - 6, { cy: y0 - M }, inOut).to(land - 6, land, { cy: y0 }, inOut);
  });

  // b6 · the row turns a quarter about the frame centre
  for (const el of row) el.orbit(T_TURN - 16, T_TURN, CX, CY, 90);
  // after the turn the column at x = 1080 holds, top to bottom: quarter, half, triangle, module

  // b7 · the module leaves in an L — right along row 7 to column 13 while it halves and spins,
  //      then straight up to the corner it signs
  const mc = centre(P.module!);
  // it spins a turn and a half, landing upside down; a square module looks the same, and setting the angle back
  // to 0 the tick after it lands keeps it off the core's turned-picture path, whose triangles leave a diagonal seam
  mod.to(b(7) - 14, b(7) - 7, { cx: mc.cx, sx: 1, sy: 1, rot: 540 }, inOut).to(b(7) - 7, b(7), { cy: mc.cy }, inOut).set(b(7) + 1, { rot: 0 });
  // the row's three stamps come out of the turn at +90°; each is set square again as soon as it has turned back
  // b8 · the quarter turns back a quarter in place, then an L along row 1 and down column 1
  const q = centre(P.quarter!);
  quarter.to(b(8) - 18, b(8) - 12, { rot: 0 }, inOut).to(b(8) - 12, b(8) - 5, { cx: q.cx }, inOut).to(b(8) - 5, b(8), { cy: q.cy }, inOut);
  // b9 · the half goes round through empty modules: left two, down to the foot, flat side up, right to its place
  const hf = centre(P.half!);
  half.to(b(9) - 26, b(9) - 20, { cx: 840 }, inOut).to(b(9) - 20, b(9) - 13, { cy: hf.cy }, inOut).to(b(9) - 13, b(9) - 8, { rot: 0 }, inOut).to(b(9) - 8, b(9), { cx: hf.cx }, inOut);
  // b9½ · the triangle turns upright about its own centre, then doubles into its place
  tri.to(b(9) + 2, b(9) + 8, { rot: 0 }, inOut).to(b(9) + 9, b(9.5) + 6, { ...centre(P.tri!), sx: 1, sy: 1 }, inOut);
  // b10 · the disc arrives as two halves, from above and below the frame, meeting on its diameter
  const D = P.disc!;
  const dc = centre(D);
  const halfBox = { x: D.x, y: D.y, w: D.w, h: D.h / 2 };
  const top = new El(reg, halfBox, { cx: dc.cx, cy: D.y + D.h / 4 - 3 * D.h / 4 - 60, op: 0 });
  top.set(b(10) - 12, { op: 1 }).to(b(10) - 12, b(10), { cy: D.y + D.h / 4 }, inOut);
  const bottom = new El(reg, halfBox, { cx: dc.cx, cy: H + D.h / 4 + 60, op: 0 });
  bottom.set(b(10) - 12, { op: 1 }).to(b(10) - 12, b(10), { cy: D.y + (3 * D.h) / 4 }, inOut);
  top.set(b(10) + 1, { op: 0 });
  bottom.set(b(10) + 1, { op: 0 });
  const disc = new El(reg, D, { op: 0 });
  disc.set(b(10) + 1, { op: 1 });
  // b11 · the floor slides in from the right edge, under the triangle, clear of the quarter
  const br = centre(P.bar!);
  const bar = new El(reg, P.bar!, { cx: W + P.bar!.w / 2, cy: br.cy, op: 0 });
  bar.set(b(11) - 12, { op: 1 }).to(b(11) - 12, b(11), { cx: br.cx }, inOut);
  // b11½ · the blue square drops into the top corner beside the module
  const bs = centre(P.bluesq!);
  const bsq = new El(reg, P.bluesq!, { cx: bs.cx, cy: bs.cy - 3 * M, op: 0 });
  bsq.set(b(11.5) - 10, { op: 1 }).to(b(11.5) - 10, b(11.5), { cy: bs.cy }, inOut);

  // the drop hands the poster to the cells; the finished poster takes it back on b16
  const live = [disc, bar, tri, bsq, half, quarter, mod];
  for (const el of live) el.set(T_DROP, { op: 0 }).set(T_POSTER, { op: 1 });
  // b18 · the press shifts its colour plates a few pixels and they snap back into register; black does not move
  const plate: Record<string, [number, number]> = { red: [3, -2], yellow: [-3, 1], blue: [2, 3] };
  const live2: [El, string][] = [[disc, "disc"], [bar, "bar"], [tri, "tri"], [bsq, "bluesq"], [half, "half"], [quarter, "quarter"], [mod, "module"]];
  for (const [el, id] of live2) {
    const off = plate[P[id]!.ink];
    if (!off) continue;
    const s0 = { ...stateAt(el, b(18) - 1) };
    el.set(b(18), { cx: s0.cx + off[0], cy: s0.cy + off[1] }).set(b(18) + 6, { cx: s0.cx, cy: s0.cy });
  }

  const node = (el: El, id: string, f?: Form) => el.node(formInner(f ?? P[id]!, seedOf(id)));
  const halfForm: Form = { id: "disc", kind: "half", ink: "red", x: halfBox.x, y: halfBox.y, w: halfBox.w, h: halfBox.h };
  const topForm: Form = { ...halfForm, rot: 2 };
  return [
    node(top, "disc", topForm),
    node(bottom, "disc", halfForm),
    node(disc, "disc"),
    node(bar, "bar"),
    node(tri, "tri"),
    node(bsq, "bluesq"),
    node(half, "half"),
    node(quarter, "quarter"),
    node(mod, "module"),
  ].join("\n    ");
}

// ── the drop: four waves of quarter turns, one from each corner, one per beat ──

/**
 * On the drop every cell of the poster that carries ink is cut out and turns
 * a quarter about its own centre as a wave crosses it — one wave per beat,
 * each from a different corner, three quarters of a tick between
 * neighbouring diagonals, so a wave crosses the grid inside its beat. Neighbours turn opposite ways, so the poster passes through
 * three mosaics of itself in all four inks; after the fourth wave every cell
 * has turned a whole turn and the poster is back, on b16.
 *
 * A cell between waves is a picture already turned in pixels (ink.turned),
 * so nothing rests as a turned quad; only the six frames of each turn are.
 */
const WAVES: { from: [number, number]; at: number }[] = [
  { from: [0, 0], at: b(12) },
  { from: [15, 0], at: b(13) },
  { from: [15, 7], at: b(14) },
  { from: [0, 7], at: b(15) },
];
const TURN = 12; // ticks: six frames, power2.inOut
/** A wave reaches a cell ¾ tick per diagonal step from its corner: 22 steps and a 12-tick turn fit inside its beat. */
const waveStart = (w: number, c: number, r: number) => {
  const [fc, fr] = WAVES[w]!.from;
  return WAVES[w]!.at + Math.round(0.75 * (Math.abs(c - fc) + Math.abs(r - fr)));
};

function cells(): string {
  if (STATIC) return "";
  const placed: (Form & ink.Placed)[] = POSTER.map((f0) => {
    const f = misreg(f0);
    return { ...f, rot: f.rot ?? 0, rgb: rgb(INK[f.ink]), seed: seedOf(f.id) };
  });
  const out: string[] = [];
  const SCALE = 2;
  const n = M * SCALE;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 16; c++) {
      const x = gx(c);
      const y = gy(r);
      // the forms whose registered box overlaps this cell; a misregistered overhang stays in its own cell
      const here = placed.filter((f, i) => {
        const g = POSTER[i]!;
        return g.x < x + M && g.x + g.w > x && g.y < y + M && g.y + g.h > y;
      });
      if (!here.length) continue;
      const px = ink.cell(here, x, y, M, SCALE);
      const dir = (c + r) % 2 === 0 ? 1 : -1;
      const files = [0, 1, 2, 3].map((q) => png(`cell-${c}-${r}-q${q}`, ink.encode(ink.turned(px, n, q), n, n)));
      const starts = WAVES.map((_, w) => waveStart(w, c, r));
      // rest pictures: after wave k the cell has turned k quarters in its direction
      for (let k = 0; k <= 4; k++) {
        const from = k === 0 ? T_DROP : starts[k - 1]! + TURN;
        const until = k === 4 ? T_POSTER : starts[k]!;
        const q = (((dir * k) % 4) + 4) % 4;
        // an empty window would bake as a ramp from tick 0
        if (from >= until) throw new Error(`cell ${c},${r}: rest ${k} is empty (${from}..${until}); the waves overrun their beats`);
        out.push(`<View class="absolute left-[${x}px] top-[${y}px] animate-${reg.anim(reg.window(from, until))}">${img(files[q]!, M, M)}</View>`);
      }
      // the turning picture: shown only while a wave turns it
      const rot: [number, string][] = [[0, "0deg"]];
      const vis: [number, string][] = [[0, "0"]];
      starts.forEach((t, k) => {
        rot.push([t, `${dir * 90 * k}deg`], [t + TURN, `${dir * 90 * (k + 1)}deg`]);
        vis.push([t, "1"], [t + TURN, "0"]);
      });
      out.push(
        `<View class="absolute left-[${x}px] top-[${y}px] w-[${M}px] h-[${M}px] origin-center animate-${reg.anim([reg.prop("rotate", rot, "cubic-bezier(0.45,0,0.55,1)"), reg.step("opacity", vis)])}">${img(files[0]!, M, M)}</View>`,
      );
    }
  }
  return out.join("\n    ");
}

// ── type ───────────────────────────────────────────────────────────────────

function type(): string {
  const word = verticalWord("BAUHAUS", M, 8 * M, INK.black);
  // a quarter module clear of the red module it stands beside
  const x = gx(14) + M / 4;
  const y = gy(0);
  const out: string[] = [];
  // one letter per sixteenth, the first at the foot: each one is stamped, not slid
  word.letters.forEach((l, i) => {
    const t = T_TYPE + 2 * Math.round((7.5 * i) / 2);
    const a = STATIC ? "" : `animate-${reg.anim(reg.window(t))}`;
    out.push(`<View class="absolute left-[${x}px] top-[${y + l.top}px] ${a}">${img(l.file, word.w, l.h)}</View>`);
  });
  // the tagline, tracked, its cap top on a grid line; it slides in one module on b17½
  // both lines take their middle dot from the Latin face, so the separators match in size and weight
  const track = (px: number) => reg.anim(reg.prop("letterSpacing", [[0, `${px}px`], [TICKS, `${px}px`]]));
  const dot = `<Text class="font-bold text-[26px] text-[${INK.black}]">{"·"}</Text>`;
  const zh = (w: string) => `<Text class="font-[cjk] font-bold text-[24px] text-[${INK.black}] animate-${track(4)}">${jsx(w)}</Text>`;
  const tag = `<View class="flex-col gap-[10px]"><Text class="font-bold text-[26px] text-[${INK.black}] animate-${track(6)}">{"FORM · FARBE · FUNKTION"}</Text><View class="flex-row items-center gap-[12px]">${zh("形式")}${dot}${zh("色彩")}${dot}${zh("功能")}</View></View>`;
  const tx = gx(3) + 4;
  const ty = gy(7) + 12;
  if (STATIC) out.push(`<View class="absolute left-[${tx}px] top-[${ty}px]">${tag}</View>`);
  else {
    const el = new El(reg, { x: tx, y: ty, w: 480, h: 80 }, { cx: tx + 240 - M, op: 0 });
    el.set(b(17.5) - 8, { op: 1 }).to(b(17.5) - 8, b(17.5), { cx: tx + 240 }, inOut);
    out.push(el.node(tag));
  }
  return out.join("\n    ");
}

// ── furniture: a module ruler that draws with the grid, and the four operations below it ──

/** The operations the film uses, and the spans in which each one acts: its legend entry is lit while it does. */
const OPS: { en: string; zh: string; icon: string; spans: [number, number][] }[] = [
  { en: "ROLL", zh: "滚", icon: "roll", spans: [[b(2) - 12, b(4)]] },
  { en: "TURN", zh: "转", icon: "turn", spans: [[T_TURN - 16, T_TURN], [b(8) - 18, b(8) - 12], [b(9) + 2, b(9) + 8], ...WAVES.map((w) => [w.at, w.at + 29] as [number, number])] },
  { en: "SLIDE", zh: "移", icon: "slide", spans: [[b(1) - 14, b(1)], [b(4.5) - 12, b(5.25)], [b(7) - 14, b(7)], [b(8) - 12, b(8)], [b(9) - 26, b(9)], [b(10) - 12, b(10)], [b(11) - 12, b(11.5)]] },
  { en: "GROW", zh: "长", icon: "grow", spans: [[b(9) + 9, b(9.5) + 6]] },
];

function furniture(): string {
  const S = "#3A342C";
  const out: string[] = [];
  // the ruler: a tick and a module number on each column line, drawn as its line is
  for (let c = 1; c < 16; c++) {
    const a = STATIC ? "" : `animate-${reg.anim(reg.window(colAt(c) + 6))}`;
    out.push(`<View class="absolute left-[${gx(c)}px] top-[${GY - 14}px] ${a}"><View class="w-[2px] h-[14px] bg-[${S}]" /></View>`);
    out.push(`<View class="absolute left-[${gx(c) + 7}px] top-[${GY - 26}px] ${a}"><Text class="font-bold text-[11px] text-[${S}]">${jsx(String(c + 1).padStart(2, "0"))}</Text></View>`);
  }
  // the legend: four small pictograms, each dark while its operation acts and faint otherwise
  const icon = (kind: string, col: string) => {
    const sq = (x: number, y: number, w: number, extra = "") => `<View class="absolute left-[${x}px] top-[${y}px] w-[${w}px] h-[${w}px] ${extra}" />`;
    if (kind === "roll") return `${sq(0, 4, 12, `bg-[${col}]`)}<View class="absolute left-[10px] top-[14px] w-[4px] h-[4px] bg-[${col}]" />${sq(14, 4, 12, `border-[${col}] border`)}`;
    if (kind === "turn") return `${sq(6, 2, 14, `border-[${col}] border`)}${sq(8, 4, 10, `bg-[${col}] rotate-45 origin-center`)}`;
    if (kind === "slide") return `${sq(0, 4, 12, `border-[${col}] border`)}<View class="absolute left-[13px] top-[9px] w-[8px] h-[2px] bg-[${col}]" />${sq(14, 4, 12, `bg-[${col}]`)}`;
    return `${sq(2, 0, 20, `border-[${col}] border`)}${sq(7, 5, 10, `bg-[${col}]`)}`;
  };
  const x0 = CX - 230;
  OPS.forEach((op, i) => {
    const x = x0 + i * 120;
    const item = (col: string) => `<View class="flex-row items-center gap-[8px]"><View class="w-[26px] h-[20px]">${icon(op.icon, col)}</View><Text class="font-bold text-[12px] text-[${col}]">${jsx(op.en)}</Text><Text class="font-[cjk] font-bold text-[12px] text-[${col}]">${jsx(op.zh)}</Text></View>`;
    const show = STATIC ? "" : `animate-${reg.anim(reg.window(24 + i * 6))}`;
    out.push(`<View class="absolute left-[${x}px] top-[1038px] ${show}">${item("#B9AE9C")}</View>`);
    if (!STATIC) {
      const ch: [number, string][] = [[0, "0"]];
      for (const [a, z] of op.spans) ch.push([a, "1"], [z + 4, "0"]);
      ch.sort((p, q) => p[0] - q[0]);
      const clean: [number, string][] = [];
      for (const c of ch) {
        if (clean.length && clean[clean.length - 1]![0] >= c[0]) clean[clean.length - 1] = c;
        else if (!clean.length || clean[clean.length - 1]![1] !== c[1]) clean.push(c);
      }
      out.push(`<View class="absolute left-[${x}px] top-[1038px] animate-${reg.anim(reg.step("opacity", clean))}">${item(S)}</View>`);
    }
  });
  // the title, inset a half module from the corner
  const t = STATIC ? "" : `animate-${reg.anim(reg.window(40))}`;
  out.push(`<View class="absolute left-[${M / 2}px] top-[1040px] flex-row items-center gap-[10px] ${t}"><Text class="font-bold text-[13px] text-[${S}]">{"EIN MODUL"}</Text><Text class="font-[cjk] font-bold text-[12px] text-[${S}]">{"模数构成"}</Text></View>`);
  return out.join("\n    ");
}

/** The pivot of the turn: a cross on the frame centre, only while the row turns about it. */
function pivot(): string {
  if (STATIC) return "";
  const a = `animate-${reg.anim(reg.window(T_TURN - 15, T_TURN + 6))}`;
  return `<View class="absolute left-[${CX - 14}px] top-[${CY - 1}px] w-[28px] h-[3px] bg-[${INK.black}] ${a}" /><View class="absolute left-[${CX - 1}px] top-[${CY - 14}px] w-[3px] h-[28px] bg-[${INK.black}] ${a}" />`;
}

/** The paper: a ground under the inks, at the spec colour, its mottle and a fine grain over all boiling at 10 fps. */
function paper(): { ground: string; grain: string } {
  const g = png("paper", ink.ground(1000, 570, rgb(INK.paper), 1919));
  const gr = png("grain", ink.grain(1280, 720, 31));
  let a = "";
  if (!STATIC) {
    const xs: [number, string][] = [];
    const ys: [number, string][] = [];
    const r = [[0, 0], [-14, 6], [9, -11], [-5, -16], [16, 10]];
    for (let t = 0, k = 0; t < TICKS; t += 6, k++) {
      xs.push([t, `${r[k % 5]![0]}px`]);
      ys.push([t, `${r[k % 5]![1]}px`]);
    }
    a = `animate-${reg.anim([reg.step("translateX", xs), reg.step("translateY", ys)])}`;
  }
  return {
    ground: `<Image class="absolute left-[-40px] top-[-30px] w-[2000px] h-[1140px] ${a}" src="${g}" />`,
    grain: `<Image class="absolute left-[-40px] top-[-30px] w-[2000px] h-[1140px] mix-blend-overlay opacity-14 ${a}" src="${gr}" />`,
  };
}

// ── assemble ───────────────────────────────────────────────────────────────

const ink_ = [grid(), forms(), pivot(), cells(), type()].join("\n    ");
const sheet = paper();
const body = `${sheet.ground}\n    ${ink_}\n    ${furniture()}\n    ${sheet.grain}`;
await Promise.all(writes);
await Bun.write(
  `${OUT}main.tsx`,
  `// GENERATED by compositions/mg-bauhaus/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Image, Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-[${INK.paper}]">
    ${body}
  </View>
));
`,
);
await Bun.write(
  `${OUT}pocket.config.ts`,
  `// GENERATED by compositions/mg-bauhaus/gen.ts — do not edit by hand.
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
      durationFrames: STATIC ? 1 : (DUR_MS / 1000) * FPS,
      fps: FPS,
      supersample: 1,
      fonts: {
        regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
        bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
        faces: { cjk: { regular: "assets/fonts/NotoSansSC-Regular.otf", bold: "assets/fonts/NotoSansSC-Bold.otf" } },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(`mg-bauhaus${STATIC ? " (poster only)" : ""}: ${Object.keys(reg.keyframes).length} keyframe sets, ${formFiles.size} forms`);
