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

/** A form as a PNG at `scale` px per unit, its colour straight, its alpha the ink. */
export function form(kind: Kind, w: number, h: number, rgb: [number, number, number], seed: number, scale = 2): Buffer {
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
      const dens = 0.975 + 0.025 * noise(x * 0.06, y * 0.06, seed + 13) + 0.012 * noise(x * 0.7, y * 0.7, seed + 29);
      const k = (j * W + i) * 4;
      px[k] = rgb[0];
      px[k + 1] = rgb[1];
      px[k + 2] = rgb[2];
      px[k + 3] = Math.round(Math.max(0, Math.min(1, a * dens)) * 255);
    }
  }
  return encodePNG(px, W, H);
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
