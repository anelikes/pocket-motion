#!/usr/bin/env bun
/**
 * compositions/mg-bauhaus — EIN MODUL · 模数构成. A Bauhaus kinetic poster.
 *
 * 10 s · 1920×1080 · 30 fps · 120 BPM, twenty beats. Written against the
 * "Geometric / Bauhaus" prompt of github.com/Vincentwei1021/mg-styles-15 and
 * judged by that repository's rubric.md; v2 answers the first jury's notes.
 *
 * Everything is one module. The grid is ruled in black on the hi-hats and
 * settles to a hairline; a red 240 px module lands, rolls three modules about
 * its own corner printing a quarter, a half and a triangle behind it; the row
 * turns a quarter about the frame centre; the forms take their places one per
 * beat in the poster (poster.ts). On the drop the poster itself is cut into
 * its 128 cells, which tumble a quarter about their corners in a phase-shifted
 * wave and tumble back, reassembling it; BAUHAUS rises module by module.
 *
 * Motion is sampled here at 60 Hz and baked as linear keyframes (motion.ts).
 * Forms are signed-distance PNGs with a printed edge (ink.ts), each ink
 * offset by its plate's misregistration.
 *
 *   bun compositions/mg-bauhaus/gen.ts
 *   bun src/cli/main.ts build compositions/mg-bauhaus
 */

import { fileURLToPath } from "node:url";
import * as opentype from "../../vendor/pocketjs/node_modules/opentype.js/dist/opentype.mjs";
import { encodePNG } from "../../vendor/pocketjs/tests/png.ts";
import * as ink from "./ink.ts";
import { El, Reg, inOut, jsx, linear, outCubic } from "./motion.ts";
import { INK, M, MISREG, POSTER, gx, gy, type Form, type Ink } from "./poster.ts";

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

/** The PNG of a form, drawn into its own w×h box. */
const formFiles = new Map<string, string>();
function formFile(f: { kind: Form["kind"]; ink: Ink; w: number; h: number }, seed: number): string {
  const key = `${f.kind}-${f.ink}-${f.w}x${f.h}-${seed}`;
  // twice the drawn size, unless that passes the 2048 px a picture may be
  if (!formFiles.has(key)) formFiles.set(key, png(`f-${key}`, ink.form(f.kind, f.w, f.h, rgb(INK[f.ink]), seed, Math.min(2, 2048 / Math.max(f.w, f.h)))));
  return formFiles.get(key)!;
}
/** A form's PNG in its box, turned `rot` quarter turns about its centre (square boxes). */
function formInner(f: Form, seed: number): string {
  const r = f.rot ?? 0;
  const file = formFile(f, seed);
  return r === 0 ? img(file, f.w, f.h) : `<View class="w-[${f.w}px] h-[${f.h}px] rotate-${(r * 90) % 360} origin-center">${img(file, f.w, f.h)}</View>`;
}

// ── type as outlines ───────────────────────────────────────────────────────

const archivo = opentype.parse(await Bun.file(`${OUT}fonts/ArchivoBlack-Regular.ttf`).arrayBuffer());

/**
 * BAUHAUS set vertically, reading upward, its cap height exactly one module
 * and its length exactly eight: the word is scaled to the box, not to a size.
 * Rasterised by scanlines (non-zero, 4×4 subsamples) from its flattened outline.
 */
function verticalWord(text: string, capH: number, length: number, color: string): { file: string; w: number; h: number } {
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
  const px = new Uint8Array(PW * PH * 4);
  const [r, g, bl] = rgb(color);
  for (let k = 0; k < PW * PH; k++) {
    px[k * 4] = r;
    px[k * 4 + 1] = g;
    px[k * 4 + 2] = bl;
    px[k * 4 + 3] = Math.round(Math.min(1, cov[k]!) * 255);
  }
  return { file: png("word", encodePNG(px, PW, PH)), w, h };
}

// ═══════════════════════════════════════════════════════════════════════════

const T_TURN = b(6);
const T_DROP = b(12);
const T_TYPE = b(16);

// ── grid: ruled in black on the hats, settling to a hairline ───────────────

function grid(): string {
  const out: string[] = [];
  const lines: { v: boolean; at: number }[] = [];
  for (let c = 1; c < 16; c++) lines.push({ v: true, at: c * 120 });
  for (let r = 0; r <= 8; r++) lines.push({ v: false, at: gy(r) });
  lines.sort((p, q) => Math.abs(p.v ? p.at - CX : p.at - CY) / (p.v ? 1 : 0.6) - Math.abs(q.v ? q.at - CX : q.at - CY) / (q.v ? 1 : 0.6));
  lines.forEach((l, k) => {
    const t0 = 2 + k * 3;
    const draw = reg.prop(l.v ? "scaleY" : "scaleX", [[0, "0"], [t0, "0"], [t0 + 12, "1"]], "cubic-bezier(0.45,0,0.55,1)");
    const settle = reg.prop("backgroundColor", [[0, INK.black], [72 + k, INK.black], [100 + k, "#DACDB5"]]);
    const cls = l.v ? `left-[${l.at - 1}px] top-[0px] w-[2px] h-[${H}px]` : `left-[0px] top-[${l.at - 1}px] w-[${W}px] h-[2px]`;
    out.push(`<View class="absolute ${cls} origin-center animate-${reg.anim(STATIC ? [settle] : [draw, settle])}" />`);
  });
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
  // the poster's own turn of each form, in degrees
  const rotDeg = (id: string) => ((P[id]!.rot ?? 0) * 90) % 360;

  // the row: four 240 px cells, columns 4..11, rows 2..3 — its bottom edge on the centre line
  const ROW_Y = gy(2);
  const cell = (k: number) => ({ cx: gx(4 + 2 * k) + M, cy: ROW_Y + M });

  // 1 · the module lands on beat 1, sliding in from the left edge
  const mod = new El(reg, P.module!, { ...cell(0), sx: 2, sy: 2, op: 0 });
  mod.set(b(1) - 14, { op: 1, cx: -2 * M }).to(b(1) - 14, b(1), { cx: cell(0).cx }, outCubic);
  // 2 · it rolls about its bottom-right corner, touching down on beats 2, 3, 4
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
  const quarter = stamp("quarter", 0, 1, rotDeg("quarter"));
  const half = stamp("half", 1, 1, 0);
  const tri = stamp("tri", 2, 0.5, 0);

  // 3 · beat 6: the row turns a quarter about the frame centre
  for (const el of [mod, quarter, half, tri]) el.orbit(T_TURN - 16, T_TURN, CX, CY, 90);

  // 4 · beats 7..11: one action per beat, each a grid move, each landing on its beat.
  // After the turn the column holds, top to bottom: quarter, half, triangle, module.
  // 7 — the module leaves in an L: right along row 6 to column 13, shrinking to one
  //     module, then straight up to the corner it signs
  const mc = centre(P.module!);
  mod.to(b(7) - 14, b(7) - 7, { cx: mc.cx, sx: 1, sy: 1, rot: 540 }, inOut).to(b(7) - 7, b(7), { cy: mc.cy }, inOut);
  // 8 — the triangle turns upright about its own centre (four frames), then on the
  //     off-beat slides three modules right while doubling about its bottom-right corner
  tri.to(b(8) - 8, b(8), { rot: 0 }, inOut);
  tri.to(b(8) + 3, b(8) + 15, { ...centre(P.tri!), sx: 1, sy: 1 }, inOut);
  // 9 — the disc grows about its top-left corner: two modules, four, six
  const disc = new El(reg, P.disc!, { cx: P.disc!.x + M, cy: P.disc!.y + M, sx: 1 / 3, sy: 1 / 3, op: 0 });
  disc.set(b(9) - 10, { op: 1 });
  disc.to(b(9) - 10, b(9), { cx: P.disc!.x + 2 * M, cy: P.disc!.y + 2 * M, sx: 2 / 3, sy: 2 / 3 }, inOut);
  disc.to(b(9) + 5, b(9) + 15, { ...centre(P.disc!), sx: 1, sy: 1 }, inOut);
  // 10 — the floor: one module stretched ten long, from its left end
  const bar = new El(reg, P.bar!, { cx: P.bar!.x + M / 2, cy: P.bar!.y + M / 2, sx: 0.1, sy: 1, op: 0 });
  bar.set(b(10) - 12, { op: 1 }).to(b(10) - 12, b(10), { ...centre(P.bar!), sx: 1 }, inOut);
  // 10.5 — the quarter turns back a quarter in place, then takes an L to the floor's end
  const q0 = centre(P.quarter!);
  quarter.to(b(10) + 1, b(10) + 6, { rot: rotDeg("quarter") }, inOut);
  quarter.to(b(10) + 6, b(10) + 15, { cx: q0.cx }, inOut).to(b(10) + 15, b(11) - 2, { cy: q0.cy }, inOut);
  // 11 — the half turns flat side up and slides into place under the floor; the blue
  //      square drops into the top corner
  const hf = centre(P.half!);
  half.to(b(11) - 12, b(11) - 6, { rot: 0 }, inOut).to(b(11) - 6, b(11) + 6, { ...hf }, inOut);
  const bsq = new El(reg, P.bluesq!, { cx: centre(P.bluesq!).cx, cy: centre(P.bluesq!).cy - 3 * M, op: 0 });
  bsq.set(b(11) - 10, { op: 1 }).to(b(11) - 10, b(11), { cy: centre(P.bluesq!).cy }, inOut);

  // 5 · on the drop the live forms hand over to the cells; they take back on beat 16
  const live = [disc, bar, tri, bsq, half, quarter, mod];
  for (const el of live) el.set(T_DROP, { op: 0 }).set(b(16), { op: 1 });
  // the last beat: the quarter turns a quarter more, a final stamp
  quarter.to(b(19) - 8, b(19), { rot: rotDeg("quarter") + 450 }, inOut);

  const node = (el: El, id: string) => el.node(formInner({ ...P[id]!, rot: 0 }, seedOf(id)));
  return [node(disc, "disc"), node(bar, "bar"), node(tri, "tri"), node(bsq, "bluesq"), node(half, "half"), node(quarter, "quarter"), node(mod, "module")].join("\n    ");
}

// ── the drop: the poster cut into its cells ────────────────────────────────

function cells(): string {
  if (STATIC) return "";
  const out: string[] = [];
  const poster = posterNodes(0, 0);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 16; c++) {
      const x = gx(c);
      const y = gy(r);
      const el = new El(reg, { x, y, w: M, h: M }, { op: 0 });
      // the pivot alternates by row: even rows turn about the top-left corner, odd rows about the bottom-right
      const [px, py] = r % 2 === 0 ? [x, y] : [x + M, y + M];
      const dir = r % 2 === 0 ? 90 : -90;
      el.set(T_DROP, { op: 1 });
      const d1 = Math.round(1.5 * (c + r)); // 0.05 s per diagonal
      el.orbit(T_DROP + d1, T_DROP + d1 + 9, px, py, dir, inOut);
      const d2 = Math.round(1.5 * (15 - c + r)); // back across, from the other corner
      el.orbit(b(13) + d2, b(13) + d2 + 9, px, py, dir, inOut);
      // the reverse: both quarters back, the last cell landing on beat 16
      const d3 = Math.round(1.6 * (22 - (c + r)));
      el.orbit(b(16) - 46 + d3 - 10, b(16) - 46 + d3, px, py, -2 * dir, inOut);
      el.set(b(16), { op: 0 });
      out.push(el.node(`<View class="absolute left-[0px] top-[0px] w-[${M}px] h-[${M}px] overflow-mask"><View class="absolute left-[${-x}px] top-[${-y}px] w-[${W}px] h-[${H}px]">${poster}</View></View>`));
    }
  }
  return out.join("\n    ");
}

// ── type ───────────────────────────────────────────────────────────────────

function type(): string {
  const word = verticalWord("BAUHAUS", M, 8 * M, INK.black);
  const x = gx(14);
  const y = gy(0);
  const out: string[] = [];
  if (STATIC) out.push(`<View class="absolute left-[${x}px] top-[${y}px]">${img(word.file, word.w, word.h)}</View>`);
  else {
    // it rises out of the grid's foot one module per sixteenth
    const el = new El(reg, { x: 0, y: 0, w: word.w, h: word.h }, { cy: word.h / 2 + word.h, op: 0 });
    el.set(T_TYPE, { op: 1 });
    for (let k = 1; k <= 8; k++) el.to(T_TYPE + (k - 1) * 3, T_TYPE + k * 3, { cy: word.h / 2 + word.h - k * M }, linear);
    out.push(`<View class="absolute left-[${x}px] top-[${y}px] w-[${word.w}px] h-[${word.h}px] overflow-hidden">${el.node(img(word.file, word.w, word.h))}</View>`);
  }
  // the tagline, tracked, its cap top on a grid line; it slides in one module on beat 17
  const tag = `<View class="flex-col gap-[12px]"><Text class="font-bold text-[22px] text-[${INK.black}] animate-${reg.anim(reg.prop("letterSpacing", [[0, "4px"], [TICKS, "4px"]]))}">{"FORM · FARBE · FUNKTION"}</Text><Text class="font-[cjk] font-bold text-[20px] text-[${INK.black}] animate-${reg.anim(reg.prop("letterSpacing", [[0, "3px"], [TICKS, "3px"]]))}">{"形式 · 色彩 · 功能"}</Text></View>`;
  const tx = gx(3) + 4;
  const ty = gy(7) + 16;
  if (STATIC) out.push(`<View class="absolute left-[${tx}px] top-[${ty}px]">${tag}</View>`);
  else {
    const el = new El(reg, { x: tx, y: ty, w: 420, h: 70 }, { cx: tx + 210 - M, op: 0 });
    el.set(b(17) - 8, { op: 1 }).to(b(17) - 8, b(17), { cx: tx + 210 }, inOut);
    out.push(el.node(tag));
  }
  return out.join("\n    ");
}

// ── print furniture ────────────────────────────────────────────────────────

function furniture(): string {
  const S = "#3A342C";
  const t = (x: number, y: number, s: string) => `<View class="absolute left-[${x}px] top-[${y}px]"><Text class="font-bold text-[14px] text-[${S}]">${jsx(s)}</Text></View>`;
  const reg_ = (x: number, y: number) =>
    `<View class="absolute left-[${x - 11}px] top-[${y - 11}px] w-[22px] h-[22px] rounded-[11px] border-[${S}] border-2" /><View class="absolute left-[${x - 18}px] top-[${y - 1}px] w-[36px] h-[2px] bg-[${S}]" /><View class="absolute left-[${x - 1}px] top-[${y - 18}px] w-[2px] h-[36px] bg-[${S}]" />`;
  const digit = (pos: number) =>
    Array.from({ length: 10 }, (_, v) => {
      const ch: [number, string][] = [[0, "0"]];
      for (let i = 0; i < 20; i++) if (Number(String(i + 1).padStart(2, "0")[pos]) === v) ch.push([b(i), "1"], [b(i + 1), "0"]);
      const clean: [number, string][] = [];
      for (const c of ch) {
        if (clean.length && clean[clean.length - 1]![0] === c[0]) clean[clean.length - 1] = c;
        else clean.push(c);
      }
      if (clean[clean.length - 1]![0] >= TICKS) clean.pop();
      return `<View class="absolute inset-0 flex-row justify-center animate-${reg.anim(reg.step("opacity", clean))}"><Text class="font-bold text-[14px] text-[${S}]">${jsx(String(v))}</Text></View>`;
    }).join("");
  const chip = (x: number, c: string) => `<View class="absolute left-[${x}px] top-[1044px] w-[22px] h-[12px] bg-[${c}]" />`;
  return `
    ${reg_(CX, 30)}${reg_(CX, 1050)}
    <View class="absolute left-[${gx(1)}px] top-[20px] flex-row items-center gap-[10px]"><Text class="font-bold text-[14px] text-[${S}]">{"KINETISCHES PLAKAT Nº 01 · EIN MODUL"}</Text><Text class="font-[cjk] font-bold text-[13px] text-[${S}]">{"模数构成"}</Text></View>
    ${t(gx(12), 20, "STAATLICHES BAUHAUS · WEIMAR 1919")}
    ${t(gx(1), 1040, "16 × 8 MODULE · 120 PX · 120 BPM · 20 SCHLÄGE")}
    <View class="absolute left-[${gx(12)}px] top-[1040px] flex-row items-center"><Text class="font-bold text-[14px] text-[${S}]">{"SCHLAG "}</Text><View class="w-[10px] h-[18px]">${STATIC ? "" : digit(0)}</View><View class="w-[10px] h-[18px]">${STATIC ? "" : digit(1)}</View><Text class="font-bold text-[14px] text-[${S}]">{" / 20"}</Text></View>
    ${chip(gx(14) + 30, INK.red)}${chip(gx(14) + 58, INK.yellow)}${chip(gx(14) + 86, INK.blue)}${chip(gx(14) + 114, INK.black)}`;
}

/** The pivot of the turn: a deliberate dot, from the turn on. */
function pivot(): string {
  const a = STATIC ? "" : `animate-${reg.anim(reg.window(b(5)))}`;
  return `<View class="absolute left-[${CX - 8}px] top-[${CY - 8}px] w-[16px] h-[16px] rounded-[8px] bg-[${INK.black}] ${a}" />`;
}

/** Paper, multiplied over everything, its tooth boiling at 12 fps. */
function paper(): string {
  const file = png("paper", ink.paper(1000, 570, 1919));
  let a = "";
  if (!STATIC) {
    const xs: [number, string][] = [];
    const ys: [number, string][] = [];
    const r = [[0, 0], [-14, 6], [9, -11], [-5, -16], [16, 10]];
    for (let t = 0, k = 0; t < TICKS; t += 10, k++) {
      xs.push([t, `${r[k % 5]![0]}px`]);
      ys.push([t, `${r[k % 5]![1]}px`]);
    }
    a = `animate-${reg.anim([reg.step("translateX", xs), reg.step("translateY", ys)])}`;
  }
  return `<Image class="absolute left-[-40px] top-[-30px] w-[2000px] h-[1140px] mix-blend-multiply ${a}" src="${file}" />`;
}

// ── assemble ───────────────────────────────────────────────────────────────

const ink_ = [grid(), forms(), pivot(), cells(), type()].join("\n    ");
const kick = STATIC ? "" : `animate-${reg.anim([reg.step("translateX", [[0, "0px"], [b(18), "5px"], [b(18) + 2, "-2px"], [b(18) + 4, "0px"]]), reg.step("translateY", [[0, "0px"], [b(18), "-3px"], [b(18) + 2, "1px"], [b(18) + 4, "0px"]])])}`;
const body = `<View class="absolute inset-0 ${kick}">\n    ${ink_}\n    </View>\n    ${furniture()}`;
const paperNode = paper();
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
    ${paperNode}
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
