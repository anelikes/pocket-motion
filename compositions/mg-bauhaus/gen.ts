#!/usr/bin/env bun
/**
 * compositions/mg-bauhaus — EIN MODUL · 模数构成. A Bauhaus kinetic poster.
 *
 * 10 s · 1920×1080 · 30 fps · 120 BPM, twenty beats. Written against the
 * "Geometric / Bauhaus" prompt of github.com/Vincentwei1021/mg-styles-15 and
 * judged by that repository's rubric.md; v6 is a redesign around the one
 * move every jury praised, a module rolling about its own corner.
 *
 * The poster is the trail of one module (poster.ts). The grid is ruled in
 * black and settles to a hairline; a red 240 px module slides in on b1 and
 * rolls once per beat, b2 to b12, along a meander over a 7 × 3 grid of its
 * own size. Each roll turns it a quarter about the corner it rolls over, and
 * its trailing edge sweeps into the cell it leaves the quarter disc that
 * corner traced — black, red, yellow, blue in turn. The last roll lands on
 * the drop. On the drop all 128 cells of the frame turn: the poster's own
 * cells, and in every empty one a black quarter disc, the empty blocks
 * holding whole discs. Four waves, one per beat — out from the module, top to
 * bottom, corner to corner, out from the centre — turn every cell a quarter,
 * neighbours opposite ways, so the field of discs walks half a block at each
 * wave and is home again after the fourth, when it spins away. BAUHAUS rises
 * out of the bottom grid line a letter per sixteenth, exactly as wide as the
 * trail.
 *
 * Motion is sampled here at 60 Hz and baked as linear keyframes (src/anim/sampled.ts).
 * Forms are signed-distance PNGs with a printed edge (src/image/print.ts), each ink
 * offset by its plate's misregistration; the paper is the ground under them.
 *
 *   bun compositions/mg-bauhaus/gen.ts
 *   bun src/cli/main.ts build compositions/mg-bauhaus
 */

import { fileURLToPath } from "node:url";
import { El, Reg, inOut, outCubic, jsxText as jsx, stateAt } from "../../src/anim/sampled.ts";
import * as print from "../../src/image/print.ts";
import { encodePlate, turnPlate, type Plate } from "../../src/image/raster.ts";
import { loadFace, setWord } from "../../src/text/outline.ts";
import { GY, INK, M, MISREG, MOD, MODULE, PATH, PIVOT, POSTER, ROLLS, TRAIL, cellX, cellY, gx, gy, type Form, type Ink } from "./poster.ts";

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

const poppins = await loadFace(`${OUT}fonts/Poppins-Black.ttf`);

// ═══════════════════════════════════════════════════════════════════════════

const T_LAND = b(1);
const ROLL = 14; // ticks a roll takes, landing on its beat
const rollEnd = (k: number) => b(2 + k);
const T_DROP = b(12); // the last roll lands on the drop
const T_POSTER = b(16); // 8.0 s: the finished poster
const T_TYPE = b(16);
const T_TAG = b(18);
const T_SNAP = b(19);

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
  // b2..b12 · one roll per beat, a quarter turn clockwise about the corner it rolls over
  ROLLS.forEach((r, k) => {
    const [i, j] = PATH[k]!;
    const [fx, fy] = PIVOT[r];
    mod.orbit(rollEnd(k) - ROLL, rollEnd(k), cellX(i) + fx * MOD + mdx, cellY(j) + fy * MOD + mdy, 90, tip);
  });

  // each stamp is under the module when it starts to tip, so its trailing edge uncovers the quarter it sweeps
  const stamps = TRAIL.map((f0, k) => {
    const f = misreg(f0);
    const el = new El(reg, f, { op: 0 });
    el.set(rollEnd(k) - ROLL, { op: 1 });
    return { el, f };
  });

  // the drop hands the poster to the cells; the finished poster takes it back on b16
  const live = [...stamps.map((s) => s.el), mod];
  for (const el of live) el.set(T_DROP, { op: 0 }).set(T_POSTER, { op: 1 });

  // b19 · the press shifts its colour plates a few pixels and they snap back into register; black does not move
  const plate: Partial<Record<Ink, [number, number]>> = { red: [4, -2], yellow: [-3, 2], blue: [2, 3] };
  const shifted: [El, Ink][] = [...stamps.map((s) => [s.el, s.f.ink] as [El, Ink]), [mod, "red"]];
  for (const [el, ink] of shifted) {
    const off = plate[ink];
    if (!off) continue;
    const s0 = { ...stateAt(el, T_SNAP - 1) };
    el.set(T_SNAP, { cx: s0.cx + off[0], cy: s0.cy + off[1] }).set(T_SNAP + 4, { cx: s0.cx, cy: s0.cy });
  }

  return [...stamps.map((s) => s.el.node(formInner(s.f, seedOf(s.f.id)))), mod.node(formInner(home, seedOf("module")))].join("\n    ");
}

// ── the drop: every cell of the frame turns, four waves, one per beat ─────

/**
 * The frame's 128 cells. A cell inside the poster shows its slice of the
 * poster; every other cell holds a black quarter disc, its corner on the
 * centre of the 2 × 2 block it sits in — blocks are the module's own cells,
 * columns 1–2, 3–4 … — so an empty block is a whole disc.
 *
 * A wave turns every cell a quarter about its own centre, a block's top-left
 * and bottom-right clockwise and the other two the other way. Turned so, the
 * four quarters of a disc swing out to pair with the next block's, and the
 * field of discs walks half a block — to the blocks' sides, their corners,
 * their tops — and after four waves is home. The field spins in on the first
 * wave and away on the last.
 *
 * A cell between waves is a picture already turned in pixels (turnPlate),
 * drawn a pixel larger on every side than its cell (print.cell's bleed), so
 * nothing rests as a turned quad and neighbouring cells meet with no hairline
 * of transparent texture edge between them; only the six frames of a turn are
 * turned quads.
 */
const MOD_CENTRE: [number, number] = [14, 1]; // the landed module's centre, in cells
const WAVES: { at: number; delay: (c: number, r: number) => number }[] = [
  { at: b(12), delay: (c, r) => Math.round(1.1 * Math.hypot(c + 0.5 - MOD_CENTRE[0], r + 0.5 - MOD_CENTRE[1])) },
  { at: b(13), delay: (_c, r) => Math.round(2.5 * r) },
  { at: b(14), delay: (c, r) => Math.round(0.75 * (c + r)) },
  { at: b(15), delay: (c, r) => Math.round(2 * Math.hypot(c + 0.5 - 8, r + 0.5 - 4)) },
];
const TURN = 12; // ticks: six frames, power2.inOut
const waveStart = (w: number, c: number, r: number) => WAVES[w]!.at + WAVES[w]!.delay(c, r);

/** Where a cell sits in its block: blocks pair columns 1–2, 3–4 … and rows 0–1, 2–3 … */
const inBlock = (c: number, r: number): [number, number] => [(((c - 1) % 2) + 2) % 2, r % 2];
/** The turn of the field's quarter in a cell at home: its corner on the block centre (BL 0, TL 1, TR 2, BR 3). */
const homeTurn = ([px, py]: [number, number]) => (py === 0 ? (px === 0 ? 3 : 0) : px === 0 ? 2 : 1);
/** A block's top-left and bottom-right cells turn clockwise, the other two counter-clockwise. */
const turnDir = (c: number, r: number) => {
  const [px, py] = inBlock(c, r);
  return px === py ? 1 : -1;
};

const BLEED = 1;
function cells(): string {
  if (STATIC) return "";
  const placed: (Form & print.Placed)[] = POSTER.map((f0) => {
    const f = misreg(f0);
    return { ...f, rot: f.rot ?? 0, rgb: rgb(INK[f.ink]), seed: seedOf(f.id) };
  });
  // the field's one quarter, sliced out of a whole disc so its bleed is ink where the disc continues
  const disc: print.Placed = { kind: "disc", x: 0, y: 0, w: MOD, h: MOD, rot: 0, rgb: rgb(INK.black), seed: 77 };
  const fieldSlice = print.cell([disc], 0, 0, M, 2, BLEED); // the top-left quarter: its corner at the bottom-right, turn 3
  const fieldFiles = [0, 1, 2, 3].map((q) => png(`field-q${q}`, turnPlate(fieldSlice, (q + 1) % 4)));

  const out: string[] = [];
  const box = (x: number, y: number) => `left-[${x - BLEED}px] top-[${y - BLEED}px] w-[${M + 2 * BLEED}px] h-[${M + 2 * BLEED}px]`;
  const pic = (file: string) => img(file, M + 2 * BLEED, M + 2 * BLEED);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 16; c++) {
      const x = gx(c);
      const y = gy(r);
      const dir = turnDir(c, r);
      const starts = WAVES.map((_, w) => waveStart(w, c, r));
      const here = placed.filter((f, i) => {
        const g = POSTER[i]!;
        return g.x < x + M && g.x + g.w > x && g.y < y + M && g.y + g.h > y;
      });
      const field = here.length === 0;
      let files: string[];
      let q0 = 0;
      if (field) {
        files = fieldFiles;
        q0 = homeTurn(inBlock(c, r));
      } else {
        const slice = print.cell(here, x, y, M, 2, BLEED);
        files = [0, 1, 2, 3].map((q) => png(`cell-${c}-${r}-q${q}`, turnPlate(slice, q)));
      }
      const turned = (k: number) => files[(((q0 + dir * k) % 4) + 4) % 4]!;
      // rest pictures: after wave k the cell has turned k quarters in its direction; the field rests only between waves
      for (let k = field ? 1 : 0; k <= (field ? 3 : 4); k++) {
        const from = k === 0 ? T_DROP : starts[k - 1]! + TURN;
        const until = k === 4 ? T_POSTER : starts[k]!;
        if (from === until && (k === 0 || k === 4)) continue;
        // an empty window would bake as a ramp from tick 0
        if (from >= until) throw new Error(`cell ${c},${r}: rest ${k} is empty (${from}..${until}); the waves overrun their beats`);
        out.push(`<View class="absolute ${box(x, y)} animate-${reg.anim(reg.window(from, until))}">${pic(turned(k))}</View>`);
      }
      // the turning picture: shown only while a wave turns it; the field grows in on the first and away on the last
      const rot: [number, string][] = [[0, "0deg"]];
      const vis: [number, string][] = [[0, "0"]];
      starts.forEach((t, k) => {
        rot.push([t, `${dir * 90 * k}deg`], [t + TURN, `${dir * 90 * (k + 1)}deg`]);
        vis.push([t, "1"], [t + TURN, "0"]);
      });
      const tracks = [reg.prop("rotate", rot, "cubic-bezier(0.45,0,0.55,1)"), reg.step("opacity", vis)];
      if (field) {
        const sc: [number, string][] = [[starts[0]!, "0"], [starts[0]! + TURN, "1"], [starts[3]!, "1"], [starts[3]! + TURN, "0"]];
        tracks.push(reg.prop("scaleX", sc, "cubic-bezier(0.45,0,0.55,1)"), reg.prop("scaleY", sc, "cubic-bezier(0.45,0,0.55,1)"));
      }
      out.push(`<View class="absolute ${box(x, y)} origin-center animate-${reg.anim(tracks)}">${pic(files[q0]!)}</View>`);
    }
  }
  return out.join("\n    ");
}

// ── type ───────────────────────────────────────────────────────────────────

/** BAUHAUS across rows 6–7: cap height two modules, length fourteen — exactly the width of the trail's grid. */
const WORD = { x: gx(1), y: gy(6), capH: 2 * M, length: 14 * M };

function type(): string {
  const set = setWord(poppins, "BAUHAUS", WORD.capH, WORD.length, rgb(INK.black), "across", 2);
  const [dx, dy] = MISREG.black;
  const out: string[] = [];
  // each letter rises out of the bottom grid line on its sixteenth, the clip being the two rows it stands in
  const letters = set.letters.map((l, i) => {
    const file = png(`word-${i}`, l.plate);
    const box = { x: l.at, y: 0, w: l.size, h: WORD.capH };
    if (STATIC) return `<View class="absolute left-[${box.x}px] top-[0px]">${img(file, box.w, box.h)}</View>`;
    // landing on its sixteenth, rounded to a whole frame; the first rises out of the last of the field
    const t = T_TYPE + 2 * Math.round((7.5 * i) / 2);
    const el = new El(reg, box, { cy: box.h / 2 + box.h });
    el.to(t - 6, t, { cy: box.h / 2 }, outCubic);
    return el.node(img(file, box.w, box.h));
  });
  out.push(`<View class="absolute left-[${WORD.x + dx}px] top-[${WORD.y + dy}px] w-[${WORD.length}px] h-[${WORD.capH}px] overflow-hidden">${letters.join("")}</View>`);

  // the tagline in the empty block the trail left at the bottom left, a rule drawn over it on b18
  const S = INK.black;
  const tx = gx(1);
  const ty = gy(4);
  const rule = (a: string) => `<View class="absolute left-[${tx}px] top-[${ty}px] w-[${4 * M}px] h-[4px] bg-[${S}] origin-left ${a}" />`;
  const dot = `<Text class="font-bold text-[30px] text-[${S}]">{"·"}</Text>`;
  const zh = (w: string) => `<Text class="font-[cjk] font-bold text-[28px] text-[${S}]">${jsx(w)}</Text>`;
  const lines = [
    `<View class="flex-row items-center gap-[16px]"><Text class="font-bold text-[30px] text-[${S}]">{"FORM"}</Text>${dot}<Text class="font-bold text-[30px] text-[${S}]">{"FARBE"}</Text>${dot}<Text class="font-bold text-[30px] text-[${S}]">{"FUNKTION"}</Text></View>`,
    `<View class="flex-row items-center gap-[16px]">${zh("形式")}${dot}${zh("色彩")}${dot}${zh("功能")}</View>`,
  ];
  if (STATIC) {
    out.push(rule(""));
    lines.forEach((l, i) => out.push(`<View class="absolute left-[${tx}px] top-[${ty + 24 + i * 52}px]">${l}</View>`));
  } else {
    out.push(rule(`animate-${reg.anim([reg.prop("scaleX", [[T_TAG - 8, "0"], [T_TAG, "1"]], "cubic-bezier(0.16,1,0.3,1)")])}`));
    lines.forEach((l, i) => {
      const t = T_TAG + 4 + 8 * i;
      const el = new El(reg, { x: 0, y: 0, w: 4 * M, h: 52 }, { cy: 26 + 52 });
      el.to(t - 6, t, { cy: 26 }, outCubic);
      out.push(`<View class="absolute left-[${tx}px] top-[${ty + 24 + i * 52}px] w-[${4 * M}px] h-[52px] overflow-hidden">${el.node(l)}</View>`);
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
