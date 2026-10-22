#!/usr/bin/env bun
/**
 * compositions/mg-bauhaus — EIN MODUL · 模数构成. A Bauhaus kinetic poster.
 *
 * 10 s · 1920×1080 · 30 fps · 120 BPM, twenty beats. Written against the
 * "Geometric / Bauhaus" prompt of github.com/Vincentwei1021/mg-styles-15 and
 * judged by that repository's rubric.md; v6 is a redesign around the one
 * move every jury praised, a module rolling about its own corner.
 *
 * The poster is the trace of one module (poster.ts). The grid is ruled in
 * black and settles to a hairline; a red 240 px module slides in on b1 and
 * makes one move a beat, b2 to b12, over a 6 × 4 grid of its own size. A
 * roll turns it a quarter about the corner it rolls over and leaves, in the
 * cell it lifts off, the quarter disc that corner swept; a spin turns it
 * about its own centre and leaves the disc its edges swept. The last roll
 * lands on the drop. On the downbeat the empty cells fill with black quarter
 * discs, an empty block a whole disc four modules across, and four waves —
 * out from the module, down, across, out from the centre — turn every cell a
 * quarter, neighbours opposite ways, so the field of discs walks half a block
 * at each and is home after the fourth. The field goes along the last wave
 * except one block, which stays as the poster's circle. BAUHAUS is built from
 * the same squares and quarter discs: each letter stands upright beside its
 * column and tips into it about its corner, one a sixteenth, reading upward.
 *
 * Motion is sampled here at 60 Hz and baked as linear keyframes (src/anim/sampled.ts).
 * Forms are signed-distance PNGs with a printed edge (src/image/print.ts), each ink
 * offset by its plate's misregistration; the paper is the ground under them.
 *
 *   bun compositions/mg-bauhaus/gen.ts
 *   bun src/cli/main.ts build compositions/mg-bauhaus
 */

import { fileURLToPath } from "node:url";
import { El, Reg, inOut, outCubic, jsxText as jsx, type Stops } from "../../src/anim/sampled.ts";
import * as print from "../../src/image/print.ts";
import { encodePlate, turnPlate, type Plate } from "../../src/image/raster.ts";
import { ACTS, CIRCLE, CIRCLE_BLOCK, COLS, GY, INK, LEFT, M, MISREG, MOD, MODULE, PATH, PIVOT, POSTER, ROWS, TRAIL, TURN as ROLL_TURN, WORD, WORD_X, cellX, cellY, gx, gy, letterFoot, letterForms, type Form, type Ink } from "./poster.ts";

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

// ═══════════════════════════════════════════════════════════════════════════

const T_LAND = b(1);
const ROLL = 14; // ticks a move takes, landing on its beat
const actEnd = (k: number) => b(2 + k);
const T_DROP = b(12); // the last roll lands on the drop
const T_POSTER = b(16); // 8.0 s: the finished poster
const T_TYPE = b(16);
const T_TAG = b(17.5);
const T_LAST = b(18); // the module turns once more, about its own centre; from 9.0 s the poster holds

/** A roll tips slowly and lands hard: power-in, arriving at speed on the beat. */
const tip = (u: number) => u ** 2.2;

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
/** A poster form as printed: misregistered, and two pixels larger on every side, so two plates' offsets never open a hairline of paper between neighbours. */
const OVER = 2;
function printed(f: Form): Form {
  const m = misreg(f);
  return { ...m, x: m.x - OVER, y: m.y - OVER, w: m.w + 2 * OVER, h: m.h + 2 * OVER };
}
const seedOf = (id: string) => 100 + POSTER.findIndex((f) => f.id === id);

/** The poster drawn statically. */
function posterNodes(): string {
  return POSTER.map((f0) => {
    const f = printed(f0);
    return `<View class="absolute left-[${f.x}px] top-[${f.y}px] w-[${f.w}px] h-[${f.h}px]">${formInner(f, seedOf(f.id))}</View>`;
  }).join("");
}

function forms(): string {
  if (STATIC) return posterNodes();
  const [mdx, mdy] = MISREG.red;
  const home = misreg(MODULE);
  const at = ([i, j]: [number, number]) => ({ cx: cellX(i) + MOD / 2 + mdx, cy: cellY(j) + MOD / 2 + mdy });

  // b1 · the module slides in from the left edge to its first cell
  const mod = new El(reg, home, { ...at(PATH[0]!), op: 0 });
  mod.set(T_LAND - 14, { op: 1, cx: -MOD / 2 }).to(T_LAND - 14, T_LAND, { cx: at(PATH[0]!).cx }, outCubic);
  // b2..b12 · one move a beat: a roll about a corner, or a spin about its own centre. A square a quarter
  //   turned looks as it did, so its angle goes back to 0 the tick after it lands and it never rests as a turned quad
  //   — except the last, which lands on the drop, where the cells take the module over
  const turn = (k: number, f: () => void) => {
    f();
    if (k < ACTS.length - 1) mod.set(actEnd(k) + 1, { rot: 0 });
    else mod.set(T_DROP + 1, { rot: 0, op: 0 });
  };
  ACTS.forEach((a, k) => {
    const [i, j] = PATH[k]!;
    if (a === "S") turn(k, () => mod.to(actEnd(k) - ROLL, actEnd(k), { rot: 90 }, inOut));
    else if (a === "F") return; // the fold is the picture's own: foldWrap
    else if (a === "C") turn(k, () => mod.orbit(actEnd(k) - ROLL, actEnd(k), CX + mdx, CY + mdy, 90, inOut));
    else {
      const [fx, fy] = PIVOT[a];
      turn(k, () => mod.orbit(actEnd(k) - ROLL, actEnd(k), cellX(i) + fx * MOD + mdx, cellY(j) + fy * MOD + mdy, ROLL_TURN[a], tip));
    }
  });

  // what each move leaves is under the module as it starts to move: a roll's trailing edge uncovers its quarter,
  // and a spin's disc is uncovered by the move after it
  // a roll's form is under the module as it starts to move, so its trailing edge uncovers it; a spin's or a fold's is
  //   uncovered by the move after it, so it appears only then (shown earlier, it peeked out under the module's edge)
  const left = LEFT.flatMap((f0, k) => {
    if (!f0) return [];
    const f = printed(f0);
    const el = new El(reg, f, { op: 0 });
    const stays = ACTS[k] === "S" || ACTS[k] === "F";
    el.set(stays ? actEnd(k + 1) - ROLL : actEnd(k) - ROLL, { op: 1 });
    return [{ el, f }];
  });
  // the drop hands the poster to the cells; the finished poster takes it back on b16, with the circle the drop left
  //   (the module's own hand-over is its last landing, above: an element's keys are written in time order)
  for (const l of left) l.el.set(T_DROP, { op: 0 }).set(T_POSTER, { op: 1 });
  mod.set(T_POSTER, { op: 1 });
  const circle = printed(CIRCLE);
  const circleEl = new El(reg, circle, { op: 0 });
  circleEl.set(T_POSTER, { op: 1 });
  // b19 · the module turns once more about its own centre, the last accent
  mod.to(T_LAST - ROLL, T_LAST, { rot: 90 }, inOut).set(T_LAST + 1, { rot: 0 });

  return [
    circleEl.node(formInner(circle, seedOf("circle"))),
    ...left.map((l) => l.el.node(formInner(l.f, seedOf(l.f.id)))),
    mod.node(foldWrap(formInner(home, seedOf("module")))),
    swingPivot(),
  ].join("\n    ");
}

/** The frame centre, marked while the module swings about it: a cross on the pivot. */
function swingPivot(): string {
  const k = ACTS.indexOf("C");
  if (k < 0 || STATIC) return "";
  const a = `animate-${reg.anim(reg.window(actEnd(k) - ROLL - 8, actEnd(k) + 6))}`;
  return `<View class="absolute left-[${CX - 12}px] top-[${CY - 12}px] ${a}">${img(png("pivot", print.form("disc", 24, 24, rgb(INK.black), 12, 2)), 24, 24)}</View><View class="absolute left-[${CX - 22}px] top-[${CY - 22}px] w-[44px] h-[44px] border-[${INK.black}] border-2 rounded-[22px] ${a}" />`;
}

/**
 * A fold over the module's bottom-left/top-right diagonal: in a frame turned
 * 45°, the picture squeezes across that diagonal to a line and opens again,
 * so the square reads as turning over on it. The two turns cancel, so at rest
 * the picture is upright and never a turned quad.
 */
function foldWrap(inner: string): string {
  const keys: [number, string][] = [[0, "1"]];
  ACTS.forEach((a, k) => {
    if (a !== "F") return;
    const t = actEnd(k);
    keys.push([t - ROLL, "1"], [t - ROLL / 2, "0.02"], [t, "1"]);
  });
  if (keys.length === 1) return inner;
  return `<View class="absolute inset-0 origin-center rotate-45"><View class="absolute inset-0 origin-center animate-${reg.anim(reg.prop("scaleX", keys, "cubic-bezier(0.45,0,0.55,1)"))}"><View class="absolute inset-0 origin-center rotate-315">${inner}</View></View></View>`;
}

// ── the drop: every cell turns, four waves, one per beat ───────────────────

/**
 * The cells are the module's own: the 6 × 4 grid it moves on, and the four
 * cells of the word's column. A cell the poster holds shows its form whole,
 * and turns a quarter on each of four waves, one per beat — out from the
 * module, down, across, out from the centre — neighbours opposite ways, so
 * after four it is home.
 *
 * Every other cell takes a quarter disc, its corner on the centre of its
 * 2 × 2 block, in its block's ink — a quarter of the field black at most, so
 * the primaries hold. The field flips in on the drop as a wave out from where
 * the module landed, a step of the grid every frame; it turns on the second
 * and third waves, and on the fourth beat flips out again, the far cells
 * first and the module's neighbours last. Its quarters are set so that after
 * two turns each block is a whole disc, and the one empty block of the
 * module's grid stays: its four quarters flip over to blue on sixteenths and
 * the poster takes it back as its circle.
 *
 * A cell between turns is a picture already turned in pixels (turnPlate),
 * drawn a pixel larger on every side than its cell (print.cell's bleed), so
 * nothing rests as a turned quad; only the six frames of a turn are.
 */
const centreOf = (x: number, y: number): [number, number] => [x + MOD / 2, y + MOD / 2];
const MOD_C = centreOf(MODULE.x, MODULE.y);
const MOD_CELL = PATH[PATH.length - 1]!;
const WAVES: { at: number; delay: (x: number, y: number, j: number) => number }[] = [
  { at: b(12), delay: (x, y) => Math.round((3 * Math.hypot(x - MOD_C[0], y - MOD_C[1])) / MOD) },
  { at: b(13), delay: (_x, _y, j) => 5 * j },
  { at: b(14), delay: (x, y) => Math.round(1.6 * ((x - WORD_X - MOD / 2) / MOD + (y - GY - MOD / 2) / MOD)) },
  { at: b(15), delay: (x, y) => Math.round((4.5 * Math.hypot(x - CX, y - CY)) / MOD) },
];
const TURN = 12; // ticks: six frames, power2.inOut
const FLIP = 6; // ticks a tile takes to flip in or out
const T_OUT = b(15); // the field flips out
/** The circle's four quarters flip to blue on sixteenths, the last landing on the poster's downbeat. */
const circleFlip = (n: number) => T_POSTER - 6 - 4 * (3 - n);

/** The turn of the field's quarter in a cell at home, by its place in its block: its corner on the block centre (BL 0, TL 1, TR 2, BR 3). */
const homeTurn = (px: number, py: number) => (py === 0 ? (px === 0 ? 3 : 0) : px === 0 ? 2 : 1);
/** Each block's ink; the circle's block is black until it turns blue. Black is two blocks of eight. */
const BLOCK_INK: Record<string, Ink> = { "-1,0": "red", "0,0": "yellow", "1,0": "black", "2,0": "red", "-1,1": "blue", "0,1": "black", "1,1": "yellow", "2,1": "blue" };

const BLEED = 1;
function cells(): string {
  if (STATIC) return "";
  const placed: (Form & print.Placed & { cell: [number, number] })[] = [...TRAIL, MODULE].map((f0) => {
    const f = printed(f0);
    return { ...f, rot: f.rot ?? 0, rgb: rgb(INK[f.ink]), seed: seedOf(f.id), cell: [f0.x, f0.y] };
  });
  // the field's quarter in each ink, sliced out of a whole disc so its bleed is ink where the disc continues
  const fieldFiles = new Map<Ink, string[]>();
  const fieldOf = (ink: Ink) => {
    if (!fieldFiles.has(ink)) {
      const [dx, dy] = MISREG[ink];
      const disc: print.Placed = { kind: "disc", x: dx, y: dy, w: 2 * MOD, h: 2 * MOD, rot: 0, rgb: rgb(INK[ink]), seed: 77 };
      const slice = print.cell([disc], 0, 0, MOD, 2, BLEED); // the top-left quarter: its corner at the bottom-right, turn 3
      fieldFiles.set(ink, [0, 1, 2, 3].map((q) => png(`field-${ink}-q${q}`, turnPlate(slice, (q + 1) % 4))));
    }
    return fieldFiles.get(ink)!;
  };

  // the module's grid, and the word's column as the right half of a block whose left half is off the grid
  const grid: { x: number; y: number; i: number; j: number; px: number; py: number; circle: boolean }[] = [];
  for (let j = 0; j < ROWS; j++) {
    grid.push({ x: WORD_X, y: cellY(j), i: -1, j, px: 1, py: j % 2, circle: false });
    for (let i = 0; i < COLS; i++) {
      const circle = Math.floor(i / 2) * 2 === CIRCLE_BLOCK[0] && Math.floor(j / 2) * 2 === CIRCLE_BLOCK[1];
      grid.push({ x: cellX(i), y: cellY(j), i, j, px: i % 2, py: j % 2, circle });
    }
  }
  const out: string[] = [];
  const box = (x: number, y: number) => `left-[${x - BLEED}px] top-[${y - BLEED}px] w-[${MOD + 2 * BLEED}px] h-[${MOD + 2 * BLEED}px]`;
  const pic = (file: string) => img(file, MOD + 2 * BLEED, MOD + 2 * BLEED);
  const view = (x: number, y: number, file: string, tracks: string[]) => `<View class="absolute ${box(x, y)} origin-center animate-${reg.anim(tracks)}">${pic(file)}</View>`;
  const ease = "cubic-bezier(0.45,0,0.55,1)";
  const turning = (g: { x: number; y: number }, file: string, dir: number, turns: [number, number][]) => {
    // the turning picture: shown only while a wave turns it; turns are [start tick, quarters already turned]
    const rot: [number, string][] = [[0, "0deg"]];
    const vis: [number, string][] = [[0, "0"]];
    for (const [t, k] of turns) {
      rot.push([t, `${dir * 90 * k}deg`], [t + TURN, `${dir * 90 * (k + 1)}deg`]);
      vis.push([t, "1"], [t + TURN, "0"]);
    }
    // unclipped: clipped to its cell, a quarter mid-turn read as a hexagon or a bow-tie, which looks like a fault
    return view(g.x, g.y, file, [reg.prop("rotate", rot, ease), reg.step("opacity", vis)]);
  };
  for (const g of grid) {
    const [cx, cy] = centreOf(g.x, g.y);
    const dir = g.px === g.py ? 1 : -1;
    const starts = WAVES.map((w) => w.at + w.delay(cx, cy, g.j));
    const here = placed.filter((f) => f.cell[0] === g.x && f.cell[1] === g.y);
    if (here.length) {
      const slice = print.cell(here, g.x, g.y, MOD, 2, BLEED);
      const files = [0, 1, 2, 3].map((q) => png(`cell-${g.x}-${g.y}-q${q}`, turnPlate(slice, q)));
      const turned = (k: number) => files[(((dir * k) % 4) + 4) % 4]!;
      for (let k = 0; k <= 4; k++) {
        const from = k === 0 ? T_DROP : starts[k - 1]! + TURN;
        const until = k === 4 ? T_POSTER : starts[k]!;
        if (from === until && (k === 0 || k === 4)) continue;
        // an empty window would bake as a ramp from tick 0
        if (from >= until) throw new Error(`cell ${g.x},${g.y}: rest ${k} is empty (${from}..${until}); the waves overrun their beats`);
        out.push(`<View class="absolute ${box(g.x, g.y)} animate-${reg.anim(reg.window(from, until))}">${pic(turned(k))}</View>`);
      }
      out.push(turning(g, files[0]!, dir, starts.map((t, k) => [t, k] as [number, number])));
      continue;
    }
    // the field: in on the drop, two turns, out on the fourth beat
    const block = `${g.i < 0 ? -1 : Math.floor(g.i / 2)},${Math.floor(g.j / 2)}`;
    const files = fieldOf(BLOCK_INK[block]!);
    const q0 = (((homeTurn(g.px, g.py) - 2 * dir) % 4) + 4) % 4;
    const turned = (k: number) => files[(((q0 + dir * k) % 4) + 4) % 4]!;
    const steps = Math.abs((g.i < 0 ? -1 : g.i) - MOD_CELL[0]) + Math.abs(g.j - MOD_CELL[1]);
    // the field lands on the downbeat: the four steps nearest the module finish their flip on frame 180, power-in;
    //   the far ones follow a frame a step
    const tin = T_DROP - FLIP + 2 * Math.max(0, steps - 4);
    const [s1, s2] = [starts[1]!, starts[2]!];
    out.push(view(g.x, g.y, turned(0), [reg.window(tin, s1), reg.prop("scaleX", [[tin, "0.12"], [tin + FLIP, "1"]], "cubic-bezier(0.55,0,1,0.45)")]));
    out.push(view(g.x, g.y, turned(1), [reg.window(s1 + TURN, s2)]));
    if (g.circle) {
      const n = (g.py === 0 ? (g.px === 0 ? 0 : 1) : g.px === 1 ? 2 : 3);
      const ft = circleFlip(n);
      out.push(view(g.x, g.y, turned(2), [reg.window(s2 + TURN, ft + FLIP / 2), reg.prop("scaleX", [[ft, "1"], [ft + FLIP / 2, "0.12"]], ease)]));
      out.push(view(g.x, g.y, fieldOf("blue")[(((q0 + 2 * dir) % 4) + 4) % 4]!, [reg.window(ft + FLIP / 2, T_POSTER), reg.prop("scaleX", [[ft + FLIP / 2, "0.12"], [ft + FLIP, "1"]], ease)]));
    } else {
      const fo = T_OUT + 2 * (7 - steps);
      out.push(view(g.x, g.y, turned(2), [reg.window(s2 + TURN, fo + FLIP), reg.prop("scaleX", [[fo, "1"], [fo + FLIP, "0.12"]], ease)]));
    }
    out.push(turning(g, files[q0]!, dir, [[s1, 0], [s2, 1]]));
  }
  return out.join("\n    ");
}

// ── the word ───────────────────────────────────────────────────────────────

/**
 * BAUHAUS in the column the drop has cleared, each letter printed from its
 * squares and quarter discs exactly as the forms are. A letter stands upright
 * in the gutter beside its place for a frame, then tips into the column about
 * its foot's corner, landing on its sixteenth, B first.
 */
function type(): string {
  const out: string[] = [];
  [...WORD].forEach((_, k) => {
    const foot = letterFoot(k);
    // one compound form per letter: its parts printed as one edge, its counters cut out of it, so no joint
    //   between two parts shows; offset by the black plate's misregistration
    const [dx, dy] = MISREG.black;
    const parts: print.Part[] = letterForms(k).map((f) => ({ kind: f.kind, x: f.x + dx, y: f.y + dy, w: f.w, h: f.h, rot: f.rot ?? 0, cut: f.ink === "paper" }));
    // a square picture over the letter and the slot above it: the letter is its lower half
    const file = png(`letter-${k}`, print.compound(parts, rgb(INK.black), 300 + k, WORD_X, foot - MOD, MOD, MOD, 2));
    const home = { x: WORD_X, y: foot - MOD, w: MOD, h: MOD };
    if (STATIC) {
      out.push(`<View class="absolute left-[${home.x}px] top-[${home.y}px]">${img(file, MOD, MOD)}</View>`);
      return;
    }
    const t = T_TYPE + 2 * Math.round((7.5 * k) / 2);
    // upright in the gutter: the letter turned a quarter clockwise about the corner it will tip over
    const px = WORD_X + MOD;
    const el = new El(reg, home, { cx: px + M, cy: foot - M, rot: 90, op: 0 });
    el.set(t - 6, { op: 0 }).orbit(t - 6, t, px, foot, -90, tip);
    // first seen two ticks into the tip, already turning, and from then on to the end
    for (const [k, v] of el.keys) if (k >= t - 4) el.keys.set(k, { ...v, op: 1 });
    el.s.op = 1;
    el.set(t + 1, { rot: 0 });
    out.push(el.node(img(file, MOD, MOD)));
  });

  // the tagline under a rule across the bottom right, drawn on b18
  const S = INK.black;
  const tx = cellX(2) + M;
  const ty = gy(6);
  const RW = cellX(5) - tx; // the rule ends on the last module edge of the forms, x 1680
  const rule = (a: string) => `<View class="absolute left-[${tx}px] top-[${ty}px] w-[${RW}px] h-[3px] bg-[${S}] origin-left ${a}" />`;
  const track = (px: number) => reg.anim(reg.prop("letterSpacing", [[0, `${px}px`], [TICKS, `${px}px`]]));
  const dot = `<Text class="font-bold text-[30px] text-[${S}]">{"·"}</Text>`;
  const zh = (w: string) => `<Text class="font-[cjk] font-bold text-[30px] text-[${S}]">${jsx(w)}</Text>`;
  const en = (w: string) => `<Text class="font-bold text-[32px] text-[${S}]">${jsx(w)}</Text>`;
  const col = (w: string, z: string, last = false) => `<View class="flex-col gap-[6px] w-[${last ? 200 : 150}px]">${en(w)}${zh(z)}</View>`;
  const lines = [`<View class="flex-row items-start">${col("FORM", "形式")}${col("FARBE", "色彩")}${col("FUNKTION", "功能", true)}</View>`];
  if (STATIC) {
    out.push(rule(""));
    lines.forEach((l) => out.push(`<View class="absolute left-[${tx}px] top-[${ty + 22}px]">${l}</View>`));
  } else {
    out.push(rule(`animate-${reg.anim([reg.prop("scaleX", [[T_TAG - 8, "0"], [T_TAG, "1"]], "cubic-bezier(0.45,0,0.55,1)")])}`));
    lines.forEach((l, i) => {
      const t = T_TAG + 4 + 8 * i;
      const el = new El(reg, { x: 0, y: 0, w: RW, h: 90 }, { cy: 45 + 90 });
      el.to(t - 6, t, { cy: 45 }, outCubic);
      out.push(`<View class="absolute left-[${tx}px] top-[${ty + 22 + i * 90}px] w-[${RW}px] h-[90px] overflow-hidden">${el.node(l)}</View>`);
    });
  }
  return out.join("\n    ");
}

// ── furniture: the title, inset a half module from the corner ─────────────

function furniture(): string {
  const S = "#3A342C";
  const t = STATIC ? "" : `animate-${reg.anim(reg.window(40))}`;
  return `<View class="absolute left-[${M}px] top-[1034px] flex-row items-center gap-[12px] ${t}"><Text class="font-bold text-[18px] text-[${S}]">{"EIN MODUL"}</Text><Text class="font-bold text-[18px] text-[${S}]">{"·"}</Text><Text class="font-[cjk] font-bold text-[19px] text-[${S}]">{"模数构成"}</Text></View>`;
}

/** The paper: a ground under the inks, at the spec colour, its mottle and a fine grain over all boiling at 10 fps. */
function paper(): { ground: string; grain: string } {
  const g = png("paper", print.ground(1000, 570, rgb(INK.paper), 1919));
  const gr = png("grain", print.grain(1280, 720, 31));
  let a = "";
  if (!STATIC) {
    // the paper boils every second frame, evenly, so a held poster still breathes: five offsets, four ticks each,
    //   as one loop of twenty ticks (as a film-length track it would be 300 keys, past what a track holds)
    const r = [[0, 0], [-14, 6], [9, -11], [-5, -16], [16, 10]];
    const stops: Stops = {};
    r.forEach(([x, y], k) => {
      const v = { translateX: `${x}px`, translateY: `${y}px` };
      stops[`${(k * 20).toFixed(2)}%`] = v;
      stops[k === r.length - 1 ? "100%" : `${(k * 20 + 19.9).toFixed(2)}%`] = v;
    });
    a = `animate-${reg.loop([reg.short(stops, 20)], 20)}`;
  }
  return {
    ground: `<Image class="absolute left-[-40px] top-[-30px] w-[2000px] h-[1140px] ${a}" src="${g}" />`,
    grain: `<Image class="absolute left-[-40px] top-[-30px] w-[2000px] h-[1140px] mix-blend-overlay opacity-20 ${a}" src="${gr}" />`,
  };
}

// ── assemble ───────────────────────────────────────────────────────────────

const ink_ = [grid(), forms(), cells(), type()].join("\n    ");
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
      // motion blur: each frame an exposure of 8 renders over 144° of the frame's duration (patches/0034); only transform
      //   timelines are sampled between ticks, so cuts, gates and fades stay where they are
      ...(process.env.SHUTTER === "0" ? {} : { shutter: { angle: 144, samples: 8 } }),
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
