/**
 * Synthetic "photos": seeded procedural landscapes, so the suite carries no
 * image bytes and every run gets the same inputs. Each has a sky in its own
 * hue (so a check can tell the photos apart by mean colour), a sun, three
 * ridge lines, speckled foliage and, when asked, a FABRIC panel — a one-pixel
 * checkerboard that aliases visibly when it is drawn smaller than its pixels
 * without filtering. Arithmetic only, so the bytes do not depend on the host's
 * `Math.sin`.
 */

import type { Rgba } from "./png.ts";

export interface PhotoOptions {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  /** Sky hue in degrees. */
  readonly hue: number;
  /** The checkerboard panel, in source pixels, or none. */
  readonly fabric?: { x0: number; y0: number; x1: number; y1: number };
}

/** The fabric panel the wall photos carry, in 800 × 600 source pixels. */
export const WALL_FABRIC = { x0: 520, y0: 340, x1: 760, y1: 560 } as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** HSV in [0,360) × [0,1] × [0,1] to 8-bit RGB. */
export function hsv(h: number, s: number, v: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6]!;
  return [Math.round(r! * 255), Math.round(g! * 255), Math.round(b! * 255)];
}

/** A 1-D value-noise ridge: `n` control points, smoothstep between them. */
function ridge(rand: () => number, n: number): (x: number) => number {
  const pts = Array.from({ length: n + 1 }, () => rand());
  return (x: number) => {
    const p = Math.min(n - 1e-9, Math.max(0, x * n));
    const i = Math.floor(p);
    const f = p - i;
    const s = f * f * (3 - 2 * f);
    return pts[i]! * (1 - s) + pts[i + 1]! * s;
  };
}

export function photo(o: PhotoOptions): Rgba {
  const { w, h } = o;
  const rand = mulberry32(o.seed);
  const data = new Uint8Array(w * h * 4);
  const skyTop = hsv(o.hue, 0.75, 0.55);
  const skyLow = hsv(o.hue + 35, 0.55, 0.95);
  const sunX = (0.2 + rand() * 0.6) * w;
  const sunY = (0.18 + rand() * 0.15) * h;
  const sunR = (0.05 + rand() * 0.03) * w;
  const sun = hsv(o.hue + 60, 0.35, 1);
  const layers = [0, 1, 2].map((k) => {
    const coarse = ridge(rand, 5 + k * 3);
    const fine = ridge(rand, 23 + k * 11);
    const base = 0.42 + k * 0.13;
    return {
      y: (x: number) => (base + 0.16 * (coarse(x) - 0.5) + 0.04 * (fine(x) - 0.5)) * h,
      rgb: hsv(o.hue + 150 + k * 25, 0.6 - k * 0.1, 0.5 - k * 0.12),
    };
  });
  const foliageTop = 0.84 * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h;
      let r = skyTop[0] + (skyLow[0] - skyTop[0]) * t;
      let g = skyTop[1] + (skyLow[1] - skyTop[1]) * t;
      let b = skyTop[2] + (skyLow[2] - skyTop[2]) * t;
      const dx = x - sunX;
      const dy = y - sunY;
      const d2 = dx * dx + dy * dy;
      if (d2 < sunR * sunR) {
        [r, g, b] = sun;
      } else {
        const glow = Math.max(0, 1 - d2 / (sunR * sunR * 9));
        r += (sun[0] - r) * glow * 0.5;
        g += (sun[1] - g) * glow * 0.5;
        b += (sun[2] - b) * glow * 0.5;
      }
      for (const layer of layers) {
        if (y >= layer.y(x / w)) [r, g, b] = layer.rgb;
      }
      if (y >= foliageTop) {
        const n = rand();
        const leaf = hsv(o.hue + 110 + n * 40, 0.7, 0.25 + n * 0.45);
        [r, g, b] = leaf;
      }
      const f = o.fabric;
      if (f && x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1) {
        const on = (x + y) % 2 === 0;
        [r, g, b] = on ? hsv(o.hue + 180, 0.25, 0.92) : hsv(o.hue + 180, 0.6, 0.12);
      }
      const i = (y * w + x) * 4;
      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = 255;
    }
  }
  return { w, h, data };
}
