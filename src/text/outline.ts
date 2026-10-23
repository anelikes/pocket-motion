/**
 * Type set as outlines, rasterised by a generator into a plate per letter.
 *
 * Text in the core is baked glyph atlases drawn upright at a baked size, so a
 * word that must stand vertically, fill an exact box, or arrive one letter at
 * a time is set here instead: the face's own outlines (opentype.js, resolved
 * from the vendored tree the way `scripts/kern-audit.ts` resolves it), scaled
 * so the word's ink fills `capH` by `length` exactly, flattened, and filled by
 * scanlines with the non-zero rule at 4×4 subsamples per pixel.
 *
 * The plate is then cut between glyphs, at the midpoint of each gap between
 * one glyph's ink and the next, into one plate per letter. Glyph positions
 * come from `forEachGlyph`, which applies the same kerning `getPath` does —
 * GPOS included, where `getKerningValue` reads only a legacy `kern` table and
 * returns 0 for a face like Inter. Placed at their offsets, the letters are
 * the word again pixel for pixel.
 */

import { readFileSync } from "node:fs";

import type { Plate } from "../image/raster.ts";
import { pocketjsRoot } from "../runtime/boot.ts";

interface PathCommand {
  type: string;
  x: number;
  y: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface OtPath {
  commands: PathCommand[];
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
}
interface OtGlyph {
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
}
export interface Face {
  unitsPerEm: number;
  getPath(text: string, x: number, y: number, size: number, opts?: { kerning?: boolean }): OtPath;
  forEachGlyph(text: string, x: number, y: number, size: number, opts: { kerning?: boolean }, cb: (glyph: OtGlyph, gx: number) => void): void;
}

/** A face, parsed by the vendored opentype.js. */
export async function loadFace(path: string): Promise<Face> {
  const { parse } = (await import(Bun.resolveSync("opentype.js", pocketjsRoot()))) as { parse(buf: ArrayBuffer): Face };
  const b = readFileSync(path);
  return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

export interface Letter {
  /** The letter's plate: across the line, its full cap height; along it, its slice of the word. */
  readonly plate: Plate;
  /** Offset of the slice along the line, in layout px, from the word's start edge (left; for "up", the TOP of the box). */
  readonly at: number;
  /** Length of the slice along the line, in layout px. */
  readonly size: number;
}

export interface SetWord {
  readonly word: Plate;
  readonly letters: Letter[];
  /** Layout size of the box: width × height. */
  readonly w: number;
  readonly h: number;
}

/**
 * `text` in `face`, its ink scaled to `capH` across the line and `length`
 * along it. `orient: "up"` reads bottom to top (the first letter at the
 * foot, the box `capH` wide and `length` tall); `"across"` reads left to
 * right. `scale` is plate pixels per layout px.
 */
export function setWord(face: Face, text: string, capH: number, length: number, rgb: [number, number, number], orient: "up" | "across" = "across", scale = 2): SetWord {
  const p = face.getPath(text, 0, 0, 100, { kerning: true });
  const bb = p.getBoundingBox();
  const sx = length / (bb.x2 - bb.x1);
  const sy = capH / (bb.y2 - bb.y1);
  const S = scale;
  const w = orient === "up" ? capH : length;
  const h = orient === "up" ? length : capH;
  // path coordinates (y down) to plate pixels
  const P = (x: number, y: number): [number, number] =>
    orient === "up" ? [(y - bb.y1) * sy * S, (length - (x - bb.x1) * sx) * S] : [(x - bb.x1) * sx * S, (y - bb.y1) * sy * S];
  const polys: [number, number][][] = [];
  let cur: [number, number][] = [];
  let last: [number, number] = [0, 0];
  for (const c of p.commands) {
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

  const PW = Math.round(w * S);
  const PH = Math.round(h * S);
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
  const rgba = new Uint8Array(PW * PH * 4);
  for (let k = 0; k < PW * PH; k++) {
    rgba[k * 4] = rgb[0];
    rgba[k * 4 + 1] = rgb[1];
    rgba[k * 4 + 2] = rgb[2];
    rgba[k * 4 + 3] = Math.round(Math.min(1, cov[k]!) * 255);
  }
  const word: Plate = { width: PW, height: PH, rgba };

  // where each glyph's ink sits along the line, in path units, with the kerning getPath applied
  const ext: [number, number][] = [];
  face.forEachGlyph(text, 0, 0, 100, { kerning: true }, (glyph, gx) => {
    const g = glyph.getBoundingBox();
    const scaleEm = 100 / face.unitsPerEm;
    ext.push([gx + g.x1 * scaleEm, gx + g.x2 * scaleEm]);
  });
  const cuts = [bb.x1 - 1, ...ext.slice(1).map(([x0], i) => (ext[i]![1] + x0) / 2), bb.x2 + 1];
  // a cut along the line, in plate pixels, on an even pixel so every letter lands on a whole layout px at scale 2
  const along = (x: number) => {
    const v = orient === "up" ? (length - (x - bb.x1) * sx) * S : (x - bb.x1) * sx * S;
    const n = orient === "up" ? PH : PW;
    return Math.max(0, Math.min(n, S * Math.round(v / S)));
  };
  const letters: Letter[] = [...text].map((_, i) => {
    const a = along(cuts[i]!);
    const z = along(cuts[i + 1]!);
    const lo = Math.min(a, z);
    const hi = Math.max(a, z);
    const n = hi - lo;
    const out = new Uint8Array((orient === "up" ? PW * n : n * PH) * 4);
    if (orient === "up") out.set(rgba.subarray(lo * PW * 4, hi * PW * 4));
    else for (let y = 0; y < PH; y++) out.set(rgba.subarray((y * PW + lo) * 4, (y * PW + hi) * 4), y * n * 4);
    const plate: Plate = orient === "up" ? { width: PW, height: n, rgba: out } : { width: n, height: PH, rgba: out };
    return { plate, at: lo / S, size: n / S };
  });
  return { word, letters, w, h };
}
