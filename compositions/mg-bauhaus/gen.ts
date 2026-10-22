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
 * Motion is sampled here at 60 Hz and baked as linear keyframes (src/anim/sampled.ts).
 * Forms are signed-distance PNGs with a printed edge (src/image/print.ts), each ink
 * offset by its plate's misregistration; the paper is the ground under them.
 *
 *   bun compositions/mg-bauhaus/gen.ts
 *   bun src/cli/main.ts build compositions/mg-bauhaus
 */

import { fileURLToPath } from "node:url";
import { El, Reg, inOut, jsxText as jsx, stateAt } from "../../src/anim/sampled.ts";
import * as print from "../../src/image/print.ts";
import { encodePlate, turnPlate, type Plate } from "../../src/image/raster.ts";
import { loadFace, setWord } from "../../src/text/outline.ts";
import { BAND, FLOOR_PIVOT, GY, INK, M, MISREG, POSTER, gx, gy, type Form, type Ink } from "./poster.ts";

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
function png(name: string, plate: Plate, linearSample = true): string {
  const file = `${name}.png`;
  images[file] = { linear: linearSample };
  writes.push(encodePlate(plate).then((bytes) => Bun.write(`${OUT}${file}`, bytes)));
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
  if (!formFiles.has(key)) formFiles.set(key, png(`f-${key}`, print.form(f.kind, f.w, f.h, rgb(INK[f.ink]), seed, Math.min(2, 2048 / Math.max(f.w, f.h)), q)));
  return formFiles.get(key)!;
}
/** A form's PNG in its box, its poster turn `rot` baked into the picture. */
function formInner(f: Form, seed: number): string {
  return img(formFile(f, seed, f.rot ?? 0), f.w, f.h);
}

// ── type as outlines ───────────────────────────────────────────────────────

const archivo = await loadFace(`${OUT}fonts/ArchivoBlack-Regular.ttf`);

/**
 * BAUHAUS set vertically, reading upward, its cap height exactly one module
 * and its length exactly eight: the word is scaled to the box, not to a size
 * (src/text/outline.ts), and cut between its glyphs into one picture per
 * letter, so each letter can be stamped on its own sixteenth.
 */
function verticalWord(text: string, capH: number, length: number, color: string): { letters: { file: string; top: number; h: number }[]; w: number; h: number } {
  const set = setWord(archivo, text, capH, length, rgb(color), "up", 2);
  return { letters: set.letters.map((l, i) => ({ file: png(`word-${i}-${text[i]}`, l.plate), top: l.at, h: l.size })), w: set.w, h: set.h };
}

// ═══════════════════════════════════════════════════════════════════════════

const T_TURN = b(6);
const T_DROP = b(12);
const T_POSTER = b(16); // 8.0 s: the finished poster
const T_STAND = T_POSTER + 14; // the floor has stood up into the band
const T_TYPE = b(16);

// ── grid: horizontals on the eighths, verticals on the sixteenths between, from the centre out ──

/**
 * When each grid line starts to draw: rows in pairs about the centre row on 8ths, columns in pairs about the
 * centre column on the 16ths between. The centre cross is already drawn on the first frame, so the film never
 * opens on blank paper.
 */
const rowAt = (r: number) => -12 + 15 * Math.abs(r - 4);
const colAt = (c: number) => -6 + 15 * Math.abs(c - 8);
function grid(): string {
  const out: string[] = [];
  const line = (v: boolean, at: number, t0: number) => {
    // a line whose draw would have started before tick 0 opens part-way or whole
    const u0 = Math.max(0, Math.min(1, -t0 / 10));
    const draw =
      t0 + 10 <= 0
        ? reg.prop(v ? "scaleY" : "scaleX", [[0, "1"]])
        : reg.prop(v ? "scaleY" : "scaleX", [[0, u0.toFixed(3)], [Math.max(0, t0), u0.toFixed(3)], [t0 + 10, "1"]], "cubic-bezier(0.45,0,0.55,1)");
    const settle = reg.prop("backgroundColor", [[0, INK.black], [Math.max(1, t0 + 40), INK.black], [t0 + 70, "#DACDB5"]]);
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
  // the three stamps it prints as it lifts off, each its poster form at the cell's size; the half sits in the
  // cell's top row, so its flat edge is on a grid line rather than half a module down
  const stamp = (id: string, k: number, scale: number, cy?: number) => {
    const el = new El(reg, P[id]!, { ...cell(k), ...(cy === undefined ? {} : { cy }), sx: scale, sy: scale, op: 0 });
    el.set(b(2 + k) - 12, { op: 1 });
    return el;
  };
  // the quarter's picture carries its poster turn, so its angle here is measured from that (0 at rest)
  const quarter = stamp("quarter", 0, 1);
  const half = stamp("half", 1, 1, ROW_Y + M / 2);
  const tri = stamp("tri", 2, 0.5);
  const row = [quarter, half, tri, mod];

  // b4½..b5¼ · a ripple along the row: each cell hops one whole module, three frames up and three down,
  //   landing on its sixteenth rounded to a whole frame
  row.forEach((el) => {
    const k = row.indexOf(el);
    const land = 2 * Math.round((b(4.5) + 7.5 * k) / 2);
    const y0 = el.s.cy;
    el.to(land - 12, land - 6, { cy: y0 - M }, inOut).to(land - 6, land, { cy: y0 }, inOut);
  });

  // b6 · the row turns a quarter about the frame centre
  for (const el of row) el.orbit(T_TURN - 16, T_TURN, CX, CY, 90);
  // after the turn, down column 8–9: quarter (rows 0–1), half (column 9, rows 2–3), triangle (rows 4–5), module (rows 6–7)

  // Each form now takes its place by moves along the grid, one per half beat, on paths that cross nothing
  // already standing: a slide, a turn about its own centre or a corner, a growth about a corner.
  // Targets come from the poster itself, misregistration included, so each form lands on the pixel the
  // drop's cells will show; the moves between are whole modules.
  const Q = centre(P.quarter!);
  const T = centre(P.tri!);
  const Md = centre(P.module!);
  const Hf = P.half!;
  // b7 · the module (still doubled) slides four modules right along the bottom rows, its top-right corner
  //      landing on the corner its own cell has
  mod.to(b(7) - 16, b(7), { cx: Md.cx - M / 2 }, inOut);
  // b7½ · the quarter slides seven modules left along the top rows
  quarter.to(b(7.5) - 24, b(7.5), { cx: Q.cx }, inOut);
  // b8 · the triangle turns upright about its own centre; b8½ it slides a module right, clear of the disc to come
  tri.to(b(8) - 8, b(8), { rot: 0 }, inOut);
  tri.to(b(8.5) - 10, b(8.5), { cx: T.cx - M }, inOut);
  // b9 · the module halves about its top-right corner; b9½ it rises six modules to the corner it signs,
  //      while the quarter drops six to the foot
  mod.to(b(9) - 8, b(9), { cx: Md.cx, cy: mod.s.cy - M / 2, sx: 1, sy: 1 }, inOut);
  mod.to(b(9.5) - 14, b(9.5), { cy: Md.cy }, inOut);
  quarter.to(b(9.5) - 14, b(9.5), { cy: Q.cy }, inOut);
  // b10 · the half goes left three modules and down three, still on its side, to where a quarter turn
  //       about its bottom-left corner lays it flat in its place
  const pivot = { x: Hf.x + Hf.w, y: Hf.y + Hf.h };
  half.to(b(10) - 14, b(10) - 7, { cx: pivot.x + M / 2 }, inOut).to(b(10) - 7, b(10), { cy: pivot.y - M }, inOut);
  // b10½ · it turns flat about that corner into place, while the quarter squares about its own centre
  half.orbit(b(10.5) - 9, b(10.5), pivot.x, pivot.y, -90);
  quarter.to(b(10.5) - 9, b(10.5), { rot: 0 }, inOut);
  // b11 · the disc closes: its top half from above the frame, its bottom half in from the left;
  //       the triangle doubles about its bottom-left corner into the space the half has left
  const D = P.disc!;
  const dc = centre(D);
  const halfBox = { x: D.x, y: D.y, w: D.w, h: D.h / 2 };
  const top = new El(reg, halfBox, { cx: dc.cx, cy: D.y + D.h / 4 - 3 * D.h / 4 - 60, op: 0 });
  top.set(b(11) - 12, { op: 1 }).to(b(11) - 12, b(11), { cy: D.y + D.h / 4 }, inOut);
  const bottom = new El(reg, halfBox, { cx: -D.w / 2 - 60, cy: D.y + (3 * D.h) / 4, op: 0 });
  bottom.set(b(11) - 12, { op: 1 }).to(b(11) - 12, b(11), { cx: dc.cx }, inOut);
  top.set(b(11) + 1, { op: 0 });
  bottom.set(b(11) + 1, { op: 0 });
  const disc = new El(reg, D, { op: 0 });
  disc.set(b(11) + 1, { op: 1 });
  tri.to(b(11) - 12, b(11), { cx: T.cx, cy: T.cy, sx: 1, sy: 1 }, inOut);
  // b11½ · the floor slides in from the right edge along the bottom row, and the blue square drops into its corner
  const br = centre(P.bar!);
  const bar = new El(reg, P.bar!, { cx: W + P.bar!.w / 2, cy: br.cy, op: 0 });
  bar.set(b(11.5) - 12, { op: 1 }).to(b(11.5) - 12, b(11.5), { cx: br.cx }, inOut);
  const bs = centre(P.bluesq!);
  const bsq = new El(reg, P.bluesq!, { cx: bs.cx, cy: bs.cy - 3 * M, op: 0 });
  bsq.set(b(11.5) - 10, { op: 1 }).to(b(11.5) - 10, b(11.5), { cy: bs.cy }, inOut);

  // the drop hands the poster to the cells; the finished poster takes it back on b16
  const live = [disc, bar, tri, bsq, half, quarter, mod];
  for (const el of live) el.set(T_DROP, { op: 0 }).set(T_POSTER, { op: 1 });

  // b16 · the payoff: the floor stands up about its right corner and becomes the band down column 14.
  //   It turns as a picture for seven frames, then rests as a picture already turned in pixels.
  bar.orbit(T_POSTER, T_STAND, FLOOR_PIVOT.x + MISREG.black[0], FLOOR_PIVOT.y + MISREG.black[1], 90);
  bar.set(T_STAND + 1, { op: 0 });
  const bandForm: Form = { id: "bar", kind: "box", ink: "black", x: BAND.x + MISREG.black[0], y: BAND.y + MISREG.black[1], w: BAND.w, h: BAND.h };
  const band = new El(reg, bandForm, { op: 0 });
  band.set(T_STAND + 1, { op: 1 });

  // b18 · the press shifts its colour plates a few pixels and they snap back into register; black does not move
  const plate: Record<string, [number, number]> = { red: [3, -2], yellow: [-3, 1], blue: [2, 3] };
  const live2: [El, string][] = [[disc, "disc"], [tri, "tri"], [bsq, "bluesq"], [half, "half"], [mod, "module"]];
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
    node(tri, "tri"),
    node(bsq, "bluesq"),
    node(half, "half"),
    node(quarter, "quarter"),
    node(mod, "module"),
    node(bar, "bar"),
    band.node(img(formFile({ kind: "box", ink: "black", w: P.bar!.w, h: P.bar!.h }, seedOf("bar"), 1), BAND.w, BAND.h)),
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
 * A cell between waves is a picture already turned in pixels (turnPlate),
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
  const placed: (Form & print.Placed)[] = POSTER.map((f0) => {
    const f = misreg(f0);
    return { ...f, rot: f.rot ?? 0, rgb: rgb(INK[f.ink]), seed: seedOf(f.id) };
  });
  const out: string[] = [];
  const SCALE = 2;
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
      const slice = print.cell(here, x, y, M, SCALE);
      const dir = (c + r) % 2 === 0 ? 1 : -1;
      const files = [0, 1, 2, 3].map((q) => png(`cell-${c}-${r}-q${q}`, turnPlate(slice, q)));
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
  // BAUHAUS knocked out of the band the floor becomes: paper-coloured letters, inset a quarter module on
  // every side, so the band reads as black around them
  const inset = M / 4;
  const word = verticalWord("BAUHAUS", BAND.w - 2 * inset, BAND.h - 2 * inset, INK.paper);
  const x = BAND.x + MISREG.black[0] + inset;
  const y = BAND.y + MISREG.black[1] + inset;
  const out: string[] = [];
  // one letter per sixteenth once the band stands, the first at the foot: each is stamped, not slid
  word.letters.forEach((l, i) => {
    const t = T_STAND + 2 + 2 * Math.round((7.5 * i) / 2);
    const a = STATIC ? "" : `animate-${reg.anim(reg.window(t))}`;
    out.push(`<View class="absolute left-[${x}px] top-[${y + l.top}px] ${a}">${img(l.file, word.w, l.h)}</View>`);
  });
  // the tagline takes the bottom row the floor has left, sliding in a module from the right on b17½;
  // both lines take their middle dot from the Latin face, spaced evenly, so the separators match
  const track = (px: number) => reg.anim(reg.prop("letterSpacing", [[0, `${px}px`], [TICKS, `${px}px`]]));
  const dot = `<Text class="font-bold text-[24px] text-[${INK.black}]">{"·"}</Text>`;
  // no tracking on the Chinese words: letter spacing also follows a word's last glyph, which pushed each dot
  // off-centre between its neighbours; their two characters sit close, and the gaps alone space the dots
  const zh = (w: string) => `<Text class="font-[cjk] font-bold text-[22px] text-[${INK.black}]">${jsx(w)}</Text>`;
  const tag = `<View class="flex-col gap-[14px]"><Text class="font-bold text-[24px] text-[${INK.black}] animate-${track(7)}">{"FORM · FARBE · FUNKTION"}</Text><View class="flex-row items-center gap-[14px]">${zh("形式")}${dot}${zh("色彩")}${dot}${zh("功能")}</View></View>`;
  const tx = gx(6) + 8;
  const ty = gy(7) + 20;
  if (STATIC) out.push(`<View class="absolute left-[${tx}px] top-[${ty}px]">${tag}</View>`);
  else {
    const el = new El(reg, { x: tx, y: ty, w: 480, h: 80 }, { cx: tx + 240 + M, op: 0 });
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
    // construction, not poster: the legend goes when the poster lands
    const show = STATIC ? "" : `animate-${reg.anim(reg.window(24 + i * 6, T_POSTER))}`;
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
  const g = png("paper", print.ground(1000, 570, rgb(INK.paper), 1919));
  const gr = png("grain", print.grain(1280, 720, 31));
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
