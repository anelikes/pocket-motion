/**
 * Printed forms, rasterised here as PNGs from signed distance functions.
 *
 * A form is its exact geometry (box, disc, quarter, half, triangle) plus two
 * things a press adds: an edge that wanders by under a pixel (low-frequency
 * noise added to the distance), and ink that is not quite even (a few percent
 * of alpha noise inside the fill). Cost is the pixel count, which the build's
 * SVG baker — a point-in-polygon test per subsample per edge — could not
 * afford for a rough outline the size of the frame.
 */

import { encodePNG } from "../../vendor/pocketjs/tests/png.ts";

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [-1, 1]. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = x - xi;
  const v = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  const top = a + (b - a) * s(u);
  const bot = c + (d - c) * s(u);
  return (top + (bot - top) * s(v)) * 2 - 1;
}

export type Kind = "box" | "disc" | "quarter" | "half" | "tri";

/**
 * Signed distance (px, negative inside) of a form filling a w×h box.
 * quarter: the disc of radius min(w,h) centred on the box's bottom-left corner.
 * half: the disc of diameter w centred on the box's top edge, bulging down.
 * tri: the right triangle with its right angle at the bottom-right corner.
 */
function sdf(kind: Kind, w: number, h: number, x: number, y: number): number {
  const box = Math.max(-x, x - w, -y, y - h);
  switch (kind) {
    case "box":
      return box;
    case "disc":
      return Math.hypot(x - w / 2, y - h / 2) - w / 2;
    case "quarter":
      return Math.max(box, Math.hypot(x, y - h) - Math.min(w, h));
    case "half":
      return Math.max(box, Math.hypot(x - w / 2, y) - w / 2);
    case "tri": {
      // inside: x <= w, y <= h, and on the lower-right side of the hypotenuse (0,h)-(w,0)
      const len = Math.hypot(w, h);
      const hyp = -(x * h + y * w - w * h) / len; // positive above-left of the hypotenuse
      return Math.max(x - w, y - h, hyp);
    }
  }
}

/** A form as a PNG at `scale` px per unit, its colour straight, its alpha the ink, turned `quarters` clockwise in pixels. */
export function form(kind: Kind, w: number, h: number, rgb: [number, number, number], seed: number, scale = 2, quarters = 0): Buffer {
  const { px, W, H } = formPixels(kind, w, h, rgb, seed, scale);
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return encodePNG(px, W, H);
  if (q === 2) return encodePNG(turned2(px, W, H), W, H);
  if (W !== H) throw new Error("form: a quarter turn in pixels needs a square picture");
  return encodePNG(turned(px, W, q), W, H);
}

/** The pixels of a form: what `form` encodes. */
export function formPixels(kind: Kind, w: number, h: number, rgb: [number, number, number], seed: number, scale = 2): { px: Uint8Array; W: number; H: number } {
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  const px = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / scale;
      const y = (j + 0.5) / scale;
      // the edge wanders ±0.8 px over a few px of run; ink density varies ±3 %
      const d = sdf(kind, w, h, x, y) + 0.55 * noise(x * 0.22, y * 0.22, seed) + 0.25 * noise(x * 0.9, y * 0.9, seed + 7);
      const a = Math.max(0, Math.min(1, 0.5 - d * scale));
      // dark ink shows its density variation as paper coming through, so it varies a third as much
      const amp = rgb[0] + rgb[1] + rgb[2] < 120 ? 0.35 : 1;
      const dens = 1 - amp * (0.025 - 0.025 * noise(x * 0.06, y * 0.06, seed + 13) - 0.012 * noise(x * 0.7, y * 0.7, seed + 29));
      const k = (j * W + i) * 4;
      px[k] = rgb[0];
      px[k + 1] = rgb[1];
      px[k + 2] = rgb[2];
      px[k + 3] = Math.round(Math.max(0, Math.min(1, a * dens)) * 255);
    }
  }
  return { px, W, H };
}

/** A W×H RGBA buffer turned half a turn. */
function turned2(px: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let k = 0; k < W * H; k++) {
    const d = (W * H - 1 - k) * 4;
    out[d] = px[k * 4]!;
    out[d + 1] = px[k * 4 + 1]!;
    out[d + 2] = px[k * 4 + 2]!;
    out[d + 3] = px[k * 4 + 3]!;
  }
  return out;
}

/** Paper: warm, nearly flat, a little tooth — multiplied, so white is no change. */
export function paper(w: number, h: number, seed: number): Buffer {
  const px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const mott = noise(i / 40, j / 40, seed) * 0.5 + noise(i / 9, j / 9, seed + 3) * 0.3;
      const tooth = hash(i, j, seed + 11);
      const dark = 3 + mott * 2.2 + tooth * 4.5;
      const k = (j * w + i) * 4;
      px[k] = 255 - dark;
      px[k + 1] = 255 - dark * 1.04;
      px[k + 2] = 255 - dark * 1.18;
      px[k + 3] = 255;
    }
  }
  return encodePNG(px, w, h);
}

/** Paper as a ground: the paper colour itself, mottled a few levels either way, drawn UNDER the inks so they print at spec. */
export function ground(w: number, h: number, rgb: [number, number, number], seed: number): Buffer {
  const px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const mott = noise(i / 60, j / 60, seed) * 0.6 + noise(i / 14, j / 14, seed + 3) * 0.4;
      const d = mott * 3.2;
      const k = (j * w + i) * 4;
      px[k] = Math.max(0, Math.min(255, Math.round(rgb[0] + d)));
      px[k + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] + d)));
      px[k + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] + d * 1.1)));
      px[k + 3] = 255;
    }
  }
  return encodePNG(px, w, h);
}

/** A fine print grain around mid-grey, for an overlay pass over paper and ink alike. */
export function grain(w: number, h: number, seed: number): Buffer {
  const px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = 128 + (hash(i, j, seed) - 0.5) * 60 + noise(i / 3, j / 3, seed + 5) * 10;
      const k = (j * w + i) * 4;
      px[k] = v;
      px[k + 1] = v;
      px[k + 2] = v;
      px[k + 3] = 255;
    }
  }
  return encodePNG(px, w, h);
}

export interface Placed {
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** clockwise quarter turns of the drawn form inside its box */
  rot: number;
  rgb: [number, number, number];
  seed: number;
}

/**
 * One cell of the printed poster as straight RGBA, `size` px square at
 * `scale` px per unit, its top-left at (x0, y0) in frame units: every form in
 * `forms` composited in order with exactly the edge and density `form()`
 * prints, sampled in each form's own coordinates. The cell's sides are not
 * edges of anything, so a row of cells tiles back into the poster without a
 * seam.
 */
export function cell(forms: Placed[], x0: number, y0: number, size: number, scale = 2): Uint8Array {
  const n = Math.round(size * scale);
  const px = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const X = x0 + (i + 0.5) / scale;
      const Y = y0 + (j + 0.5) / scale;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const f of forms) {
        // the form's own coordinates: undo its quarter turns about its box centre (clockwise, y down)
        let ox = X - f.x - f.w / 2;
        let oy = Y - f.y - f.h / 2;
        for (let k = 0; k < ((f.rot % 4) + 4) % 4; k++) [ox, oy] = [oy, -ox];
        ox += f.w / 2;
        oy += f.h / 2;
        if (ox < -2 || oy < -2 || ox > f.w + 2 || oy > f.h + 2) continue;
        const d = sdf(f.kind, f.w, f.h, ox, oy) + 0.55 * noise(ox * 0.22, oy * 0.22, f.seed) + 0.25 * noise(ox * 0.9, oy * 0.9, f.seed + 7);
        const cov = Math.max(0, Math.min(1, 0.5 - d * scale));
        if (cov <= 0) continue;
        const amp = f.rgb[0] + f.rgb[1] + f.rgb[2] < 120 ? 0.35 : 1;
        const dens = 1 - amp * (0.025 - 0.025 * noise(ox * 0.06, oy * 0.06, f.seed + 13) - 0.012 * noise(ox * 0.7, oy * 0.7, f.seed + 29));
        const s = Math.max(0, Math.min(1, cov * dens));
        // straight-alpha src-over
        const na = s + a * (1 - s);
        r = (f.rgb[0] * s + r * a * (1 - s)) / na;
        g = (f.rgb[1] * s + g * a * (1 - s)) / na;
        b = (f.rgb[2] * s + b * a * (1 - s)) / na;
        a = na;
      }
      const k = (j * n + i) * 4;
      px[k] = Math.round(r);
      px[k + 1] = Math.round(g);
      px[k + 2] = Math.round(b);
      px[k + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/** An n×n RGBA buffer turned `quarters` clockwise quarter turns: an exact permutation, no resampling. */
export function turned(px: Uint8Array, n: number, quarters: number): Uint8Array {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return px;
  const out = new Uint8Array(px.length);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // destination (i, j) takes its source from the inverse turn
      const [si, sj] = q === 1 ? [j, n - 1 - i] : q === 2 ? [n - 1 - i, n - 1 - j] : [n - 1 - j, i];
      const d = (j * n + i) * 4;
      const s = (sj * n + si) * 4;
      out[d] = px[s]!;
      out[d + 1] = px[s + 1]!;
      out[d + 2] = px[s + 2]!;
      out[d + 3] = px[s + 3]!;
    }
  }
  return out;
}

export const encode = (px: Uint8Array, w: number, h: number): Buffer => encodePNG(px, w, h);
