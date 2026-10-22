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
import { El, Reg, inOut, outCubic, jsxText as jsx } from "../../src/anim/sampled.ts";
import * as print from "../../src/image/print.ts";
import { encodePlate, turnPlate, type Plate } from "../../src/image/raster.ts";
import { ACTS, CIRCLE, CIRCLE_BLOCK, COLS, GY, INK, LEFT, M, MISREG, MOD, MODULE, PATH, PIVOT, POSTER, ROWS, TRAIL, TURN as ROLL_TURN, WORD, WORD_X, cellX, cellY, gx, gy, letterFoot, letterForms, type Form } from "./poster.ts";

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
const T_TAG = b(18);
const T_LAST = b(19); // the module turns once more, about its own centre, on the last accent

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
const seedOf = (id: string) => 100 + POSTER.findIndex((f) => f.id === id);

/** The poster drawn statically. */
function posterNodes(): string {
  return POSTER.map((f0) => {
    const f = misreg(f0);
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
  const turn = (k: number, f: () => void) => {
    f();
    mod.set(actEnd(k) + 1, { rot: 0 });
  };
  ACTS.forEach((a, k) => {
    const [i, j] = PATH[k]!;
    if (a === "S") turn(k, () => mod.to(actEnd(k) - ROLL, actEnd(k), { rot: 90 }, inOut));
    else {
      const [fx, fy] = PIVOT[a];
      turn(k, () => mod.orbit(actEnd(k) - ROLL, actEnd(k), cellX(i) + fx * MOD + mdx, cellY(j) + fy * MOD + mdy, ROLL_TURN[a], tip));
    }
  });

  // what each move leaves is under the module as it starts to move: a roll's trailing edge uncovers its quarter,
  // and a spin's disc is uncovered by the move after it
  const left = LEFT.flatMap((f0, k) => {
    if (!f0) return [];
    const f = misreg(f0);
    const el = new El(reg, f, { op: 0 });
    el.set(actEnd(k) - ROLL, { op: 1 });
    return [{ el, f }];
  });
  // the drop hands the poster to the cells; the finished poster takes it back on b16, with the circle the drop left
  for (const el of [...left.map((l) => l.el), mod]) el.set(T_DROP, { op: 0 }).set(T_POSTER, { op: 1 });
  const circle = misreg(CIRCLE);
  const circleEl = new El(reg, circle, { op: 0 });
  circleEl.set(T_POSTER, { op: 1 });
  // b19 · the module turns once more about its own centre, the last accent
  mod.to(T_LAST - ROLL, T_LAST, { rot: 90 }, inOut).set(T_LAST + 1, { rot: 0 });

  return [
    circleEl.node(formInner(circle, seedOf("circle"))),
    ...left.map((l) => l.el.node(formInner(l.f, seedOf(l.f.id)))),
    mod.node(formInner(home, seedOf("module"))),
  ].join("\n    ");
}

// ── the drop: every cell turns, four waves, one per beat ───────────────────

/**
 * The cells are the module's own: the 6 × 4 grid it moves on, and the four
 * cells of the word's column. On the downbeat every cell the poster leaves
 * empty fills with a black quarter disc, its corner on the centre of the
 * 2 × 2 block it sits in, so an empty block is a whole disc four modules
 * across. A cell the poster holds shows its form whole.
 *
 * A wave turns every cell a quarter about its own centre, a block's top-left
 * and bottom-right clockwise and the other two the other way. Turned so, the
 * quarters of a disc swing out to pair with the next block's, and the field
 * of discs walks half a block — to the blocks' sides, their corners, their
 * tops — and after four waves is home. The field goes cell by cell as the
 * last wave leaves it, except the empty block that becomes the circle.
 *
 * A cell between waves is a picture already turned in pixels (turnPlate),
 * drawn a pixel larger on every side than its cell (print.cell's bleed), so
 * nothing rests as a turned quad; only the six frames of a turn are.
 */
const centreOf = (x: number, y: number): [number, number] => [x + MOD / 2, y + MOD / 2];
const MOD_C = centreOf(MODULE.x, MODULE.y);
const WAVES: { at: number; delay: (x: number, y: number, j: number) => number }[] = [
  { at: b(12), delay: (x, y) => Math.round((3 * Math.hypot(x - MOD_C[0], y - MOD_C[1])) / MOD) },
  { at: b(13), delay: (_x, _y, j) => 5 * j },
  { at: b(14), delay: (x, y) => Math.round(1.6 * ((x - WORD_X - MOD / 2) / MOD + (y - GY - MOD / 2) / MOD)) },
  { at: b(15), delay: (x, y) => Math.round((4.5 * Math.hypot(x - CX, y - CY)) / MOD) },
];
const TURN = 12; // ticks: six frames, power2.inOut

/** The turn of the field's quarter in a cell at home, by its place in its block: its corner on the block centre (BL 0, TL 1, TR 2, BR 3). */
const homeTurn = (px: number, py: number) => (py === 0 ? (px === 0 ? 3 : 0) : px === 0 ? 2 : 1);

const BLEED = 1;
function cells(): string {
  if (STATIC) return "";
  const placed: (Form & print.Placed)[] = [...TRAIL, MODULE].map((f0) => {
    const f = misreg(f0);
    return { ...f, rot: f.rot ?? 0, rgb: rgb(INK[f.ink]), seed: seedOf(f.id) };
  });
  // the field's one quarter, sliced out of a whole disc so its bleed is ink where the disc continues
  const disc: print.Placed = { kind: "disc", x: 0, y: 0, w: 2 * MOD, h: 2 * MOD, rot: 0, rgb: rgb(INK.black), seed: 77 };
  const fieldSlice = print.cell([disc], 0, 0, MOD, 2, BLEED); // the top-left quarter: its corner at the bottom-right, turn 3
  const fieldFiles = [0, 1, 2, 3].map((q) => png(`field-q${q}`, turnPlate(fieldSlice, (q + 1) % 4)));

  // the module's grid, and the word's column as the right half of a block whose left half is off the grid
  const grid: { x: number; y: number; px: number; py: number; j: number; circle: boolean }[] = [];
  for (let j = 0; j < ROWS; j++) {
    grid.push({ x: WORD_X, y: cellY(j), px: 1, py: j % 2, j, circle: false });
    for (let i = 0; i < COLS; i++) {
      const circle = Math.floor(i / 2) * 2 === CIRCLE_BLOCK[0] && Math.floor(j / 2) * 2 === CIRCLE_BLOCK[1];
      grid.push({ x: cellX(i), y: cellY(j), px: i % 2, py: j % 2, j, circle });
    }
  }
  const out: string[] = [];
  const box = (x: number, y: number) => `left-[${x - BLEED}px] top-[${y - BLEED}px] w-[${MOD + 2 * BLEED}px] h-[${MOD + 2 * BLEED}px]`;
  const pic = (file: string) => img(file, MOD + 2 * BLEED, MOD + 2 * BLEED);
  for (const g of grid) {
    const [cx, cy] = centreOf(g.x, g.y);
    const dir = g.px === g.py ? 1 : -1;
    const starts = WAVES.map((w) => w.at + w.delay(cx, cy, g.j));
    const here = placed.filter((f) => f.x - MISREG[f.ink][0] === g.x && f.y - MISREG[f.ink][1] === g.y);
    const field = here.length === 0;
    let files: string[];
    let q0 = 0;
    if (field) {
      files = fieldFiles;
      q0 = homeTurn(g.px, g.py);
    } else {
      const slice = print.cell(here, g.x, g.y, MOD, 2, BLEED);
      files = [0, 1, 2, 3].map((q) => png(`cell-${g.x}-${g.y}-q${q}`, turnPlate(slice, q)));
    }
    const turned = (k: number) => files[(((q0 + dir * k) % 4) + 4) % 4]!;
    // rest pictures: after wave k the cell has turned k quarters in its direction. The field goes as the last wave
    //   leaves it, except the circle's block, which holds until the poster takes it back
    const lastRest = field && !g.circle ? 3 : 4;
    for (let k = 0; k <= lastRest; k++) {
      const from = k === 0 ? T_DROP : starts[k - 1]! + TURN;
      const until = k === 4 ? T_POSTER : starts[k]!;
      if (from === until && (k === 0 || k === 4)) continue;
      // an empty window would bake as a ramp from tick 0
      if (from >= until) throw new Error(`cell ${g.x},${g.y}: rest ${k} is empty (${from}..${until}); the waves overrun their beats`);
      out.push(`<View class="absolute ${box(g.x, g.y)} animate-${reg.anim(reg.window(from, until))}">${pic(turned(k))}</View>`);
    }
    // the turning picture: shown only while a wave turns it
    const rot: [number, string][] = [[0, "0deg"]];
    const vis: [number, string][] = [[0, "0"]];
    starts.forEach((t, k) => {
      rot.push([t, `${dir * 90 * k}deg`], [t + TURN, `${dir * 90 * (k + 1)}deg`]);
      vis.push([t, "1"], [t + TURN, "0"]);
    });
    out.push(`<View class="absolute ${box(g.x, g.y)} origin-center animate-${reg.anim([reg.prop("rotate", rot, "cubic-bezier(0.45,0,0.55,1)"), reg.step("opacity", vis)])}">${pic(files[q0]!)}</View>`);
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
    el.set(t - 8, { op: 1 }).orbit(t - 6, t, px, foot, -90, tip);
    el.set(t + 1, { rot: 0 });
    out.push(el.node(img(file, MOD, MOD)));
  });

  // the tagline under a rule across the bottom right, drawn on b18
  const S = INK.black;
  const tx = cellX(2);
  const ty = gy(7);
  const rule = (a: string) => `<View class="absolute left-[${tx}px] top-[${ty}px] w-[${3 * MOD}px] h-[3px] bg-[${S}] origin-left ${a}" />`;
  const track = (px: number) => reg.anim(reg.prop("letterSpacing", [[0, `${px}px`], [TICKS, `${px}px`]]));
  const dot = `<Text class="font-bold text-[22px] text-[${S}]">{"·"}</Text>`;
  const zh = (w: string) => `<Text class="font-[cjk] font-bold text-[24px] text-[${S}]">${jsx(w)}</Text>`;
  const lines = [
    `<View class="flex-row items-center gap-[12px]"><Text class="font-bold text-[22px] text-[${S}] animate-${track(4)}">{"FORM"}</Text>${dot}<Text class="font-bold text-[22px] text-[${S}] animate-${track(4)}">{"FARBE"}</Text>${dot}<Text class="font-bold text-[22px] text-[${S}] animate-${track(4)}">{"FUNKTION"}</Text></View>`,
    `<View class="flex-row items-center gap-[12px]">${zh("形式")}${dot}${zh("色彩")}${dot}${zh("功能")}</View>`,
  ];
  if (STATIC) {
    out.push(rule(""));
    lines.forEach((l, i) => out.push(`<View class="absolute left-[${tx}px] top-[${ty + 20 + i * 44}px]">${l}</View>`));
  } else {
    out.push(rule(`animate-${reg.anim([reg.prop("scaleX", [[T_TAG - 8, "0"], [T_TAG, "1"]], "cubic-bezier(0.45,0,0.55,1)")])}`));
    lines.forEach((l, i) => {
      const t = T_TAG + 4 + 8 * i;
      const el = new El(reg, { x: 0, y: 0, w: 3 * MOD, h: 44 }, { cy: 22 + 44 });
      el.to(t - 6, t, { cy: 22 }, outCubic);
      out.push(`<View class="absolute left-[${tx}px] top-[${ty + 20 + i * 44}px] w-[${3 * MOD}px] h-[44px] overflow-hidden">${el.node(l)}</View>`);
    });
  }
  return out.join("\n    ");
}

// ── furniture: the title, inset a half module from the corner ─────────────

function furniture(): string {
  const S = "#3A342C";
  const t = STATIC ? "" : `animate-${reg.anim(reg.window(40))}`;
  return `<View class="absolute left-[${M / 2}px] top-[1040px] flex-row items-center gap-[10px] ${t}"><Text class="font-bold text-[13px] text-[${S}]">{"EIN MODUL"}</Text><Text class="font-[cjk] font-bold text-[12px] text-[${S}]">{"模数构成"}</Text></View>`;
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
    // the paper boils at 12 fps, so a held poster still breathes
    for (let t = 0, k = 0; t < TICKS; t += 5, k++) {
      xs.push([t, `${r[k % 5]![0]}px`]);
      ys.push([t, `${r[k % 5]![1]}px`]);
    }
    a = `animate-${reg.anim([reg.step("translateX", xs), reg.step("translateY", ys)])}`;
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
