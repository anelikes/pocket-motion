/** Pixel readings the observable criteria share. */

import type { Rgba } from "./png.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rgb = readonly [number, number, number];

export function hex(s: string): Rgb {
  const v = s.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function px(img: Rgba, x: number, y: number): Rgb {
  const i = (y * img.w + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

/** Largest per-channel difference. */
export function dist(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

export function chroma(c: Rgb): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

/** Hue in degrees, saturation and value in [0,1]. */
export function toHsv(c: Rgb): [number, number, number] {
  const [r, g, b] = [c[0] / 255, c[1] / 255, c[2] / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [(h + 360) % 360, max === 0 ? 0 : d / max, max];
}

/** The rect clipped to the image, integer bounds; null when nothing is left. */
export function clip(img: Rgba, r: Rect): Rect | null {
  const x0 = Math.max(0, Math.ceil(r.x));
  const y0 = Math.max(0, Math.ceil(r.y));
  const x1 = Math.min(img.w, Math.floor(r.x + r.w));
  const y1 = Math.min(img.h, Math.floor(r.y + r.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export function inset(r: Rect, frac: number): Rect {
  return { x: r.x + r.w * frac, y: r.y + r.h * frac, w: r.w * (1 - 2 * frac), h: r.h * (1 - 2 * frac) };
}

export function* pixelsIn(img: Rgba, r: Rect): Generator<[number, number, Rgb]> {
  const c = clip(img, r);
  if (!c) return;
  for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) yield [x, y, px(img, x, y)];
}

export function count(img: Rgba, r: Rect, pred: (c: Rgb) => boolean): number {
  let n = 0;
  for (const [, , c] of pixelsIn(img, r)) if (pred(c)) n++;
  return n;
}

export function mean(img: Rgba, r: Rect): Rgb {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let n = 0;
  for (const [, , c] of pixelsIn(img, r)) {
    s0 += c[0];
    s1 += c[1];
    s2 += c[2];
    n++;
  }
  return n === 0 ? [0, 0, 0] : [s0 / n, s1 / n, s2 / n];
}

/** Standard deviation of luma over a rect. */
export function lumaStd(img: Rgba, r: Rect): number {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (const [, , c] of pixelsIn(img, r)) {
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    s += l;
    s2 += l * l;
    n++;
  }
  if (n === 0) return NaN;
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

export function meanChroma(img: Rgba, r: Rect): number {
  let s = 0;
  let n = 0;
  for (const [, , c] of pixelsIn(img, r)) {
    s += chroma(c);
    n++;
  }
  return n === 0 ? NaN : s / n;
}

/** Bounding box of the pixels the predicate selects, or null. */
export function bbox(img: Rgba, r: Rect, pred: (c: Rgb) => boolean): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y, c] of pixelsIn(img, r)) {
    if (!pred(c)) continue;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const full = (img: Rgba): Rect => ({ x: 0, y: 0, w: img.w, h: img.h });

export const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Pearson correlation. */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

export const fmt = (n: number, d = 2): string => (Number.isFinite(n) ? n.toFixed(d) : String(n));
