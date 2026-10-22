/**
 * Build-time glow plates. The renderer has no blur; the falloff is already
 * in the pixels.
 *
 * The 取消 button is one hollow plate: an opaque View covers the rect, so
 * the interior is zeroed and `axis: "y"` lights only the top and bottom.
 *
 * A template column is transparent text. Stretching a plate that carries
 * the gradient in Y would pull that gradient into the type once the stack
 * is taller than 512. The column is three images instead: a constant fill
 * stretched to the stack (lossless), and two caps at native σ, one rotated
 * 180° for the bottom. X is constant on every plate, so stretching to the
 * column width is lossless the same way.
 */

import { join } from "node:path";

import { TEX_MAX_DIM } from "../manifest/sidecar.ts";
import { pocketjsRoot } from "../runtime/boot.ts";

export interface GlowBox {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly sigma: number;
  /** Extra pixels of kernel room around the box. Default `ceil(3 * sigma)`. */
  readonly spread?: number;
  /** Peak alpha of the veil, 0..1. Default 1. Weak glow uses a small gain so
   *  the band is faint from the edge, not a bright rim that then fades. */
  readonly gain?: number;
  readonly color?: { readonly r: number; readonly g: number; readonly b: number };
  /**
   * `"y"` — only the top and bottom edges.
   * `"x"` — only the left and right edges.
   * omitted — all four.
   */
  readonly axis?: "x" | "y";
}

export interface GlowPlate {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** Where the rounded rect sits in canvas space. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/** The 取消 button the glow composition paints. */
export const CANCEL_BUTTON = {
  width: 280,
  height: 72,
  radius: 8,
  sigma: 28,
  spread: 64,
  gain: 0.32,
  axis: "y",
} as const;

export const GLOW_ASSET = "glow.png";
export const GLOW_CAP_ASSET = "glow-cap.png";
/** Tiny pow2 fill — constant, so stretching to the column × stack is lossless. */
export const GLOW_FILL_DIM = 8;

export function nextPow2(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function glowCanvasSize(contentW: number, contentH: number): { w: number; h: number } {
  const w = nextPow2(Math.ceil(contentW));
  const h = nextPow2(Math.ceil(contentH));
  if (w > TEX_MAX_DIM || h > TEX_MAX_DIM) {
    throw new Error(
      `glow plate: canvas ${w}×${h} exceeds TEX_MAX_DIM ${TEX_MAX_DIM} ` +
        `(content ${contentW}×${contentH})`,
    );
  }
  return { w, h };
}

/**
 * Signed distance to a rounded rectangle centred at the origin, half-size
 * `(hw, hh)`, corner radius `r`. Negative inside.
 */
export function sdRoundRect(px: number, py: number, hw: number, hh: number, r: number): number {
  const rr = Math.max(0, Math.min(r, Math.min(hw, hh)));
  const dx = Math.abs(px) - (hw - rr);
  const dy = Math.abs(py) - (hh - rr);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - rr;
}

function peakOf(gain: number): number {
  if (!(gain >= 0) || gain > 1) {
    throw new Error(`glow plate: gain must be in 0..1; got ${gain}`);
  }
  return Math.max(0, Math.min(255, Math.round(gain * 255)));
}

function paintRgb(rgba: Uint8Array, color: { r: number; g: number; b: number }): void {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = color.r;
    rgba[i + 1] = color.g;
    rgba[i + 2] = color.b;
  }
}

/** Constant peak-alpha plate. Stretching it does not change the veil. */
export function rasterGlowFill(
  gain: number = CANCEL_BUTTON.gain,
  color: { readonly r: number; readonly g: number; readonly b: number } = { r: 255, g: 255, b: 255 },
): GlowPlate {
  const w = GLOW_FILL_DIM;
  const h = GLOW_FILL_DIM;
  const peak = peakOf(gain);
  const rgba = new Uint8Array(w * h * 4);
  paintRgb(rgba, color);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = peak;
  return { width: w, height: h, rgba, rect: { x: 0, y: 0, w, h } };
}

/**
 * 1-D vertical falloff, bright at the bottom edge (dY = 0) and fading toward
 * the top. The bottom cap is this plate with `rotate-180`. Height is `spread`
 * so the Image can be laid out 1:1 in Y.
 */
export function rasterGlowCap(
  spread: number = CANCEL_BUTTON.spread,
  sigma: number = CANCEL_BUTTON.sigma,
  gain: number = CANCEL_BUTTON.gain,
  color: { readonly r: number; readonly g: number; readonly b: number } = { r: 255, g: 255, b: 255 },
): GlowPlate {
  if (spread < 1) throw new Error(`glow cap: spread must be ≥ 1; got ${spread}`);
  if (!(sigma > 0)) throw new Error(`glow cap: sigma must be positive; got ${sigma}`);
  const { w, h } = glowCanvasSize(GLOW_FILL_DIM, spread);
  if (h !== spread) {
    throw new Error(`glow cap: spread ${spread} is not a power of two; canvas would be ${h}`);
  }
  const peak = peakOf(gain);
  const twoSigma2 = 2 * sigma * sigma;
  const rgba = new Uint8Array(w * h * 4);
  paintRgb(rgba, color);
  for (let y = 0; y < h; y++) {
    const dY = h - (y + 0.5);
    const a =
      dY <= 0 ? peak : Math.max(0, Math.min(255, Math.round(gain * Math.exp(-(dY * dY) / twoSigma2) * 255)));
    for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = a;
  }
  return { width: w, height: h, rgba, rect: { x: 0, y: 0, w, h } };
}

export function rasterGlowPlate(box: GlowBox): GlowPlate {
  if (box.width < 1 || box.height < 1) {
    throw new Error(`glow plate: box must be at least 1×1; got ${box.width}×${box.height}`);
  }
  if (!(box.sigma > 0)) {
    throw new Error(`glow plate: sigma must be positive; got ${box.sigma}`);
  }
  const spread = box.spread ?? Math.ceil(3 * box.sigma);
  if (spread < 0) throw new Error(`glow plate: spread must be ≥ 0; got ${spread}`);
  const contentW = box.width + 2 * spread;
  const contentH = box.height + 2 * spread;
  const { w, h } = glowCanvasSize(contentW, contentH);

  const rectX = (w - box.width) / 2;
  const rectY = (h - box.height) / 2;
  const cx = rectX + box.width / 2;
  const cy = rectY + box.height / 2;
  const hw = box.width / 2;
  const hh = box.height / 2;
  const radius = box.radius;
  const axis = box.axis ?? "both";
  const gain = box.gain ?? 1;
  const twoSigma2 = 2 * box.sigma * box.sigma;

  const color = box.color ?? { r: 255, g: 255, b: 255 };
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const d = sdRoundRect(px, py, hw, hh, radius);
      const o = (y * w + x) * 4;
      rgba[o] = color.r;
      rgba[o + 1] = color.g;
      rgba[o + 2] = color.b;
      // Inside the button the plate is unused — the View covers it.
      if (d <= 0) {
        rgba[o + 3] = 0;
        continue;
      }
      // "y" = only columns that overlap the button, so left/right stay dark.
      if (axis === "y" && Math.abs(px) > hw) {
        rgba[o + 3] = 0;
        continue;
      }
      if (axis === "x" && Math.abs(py) > hh) {
        rgba[o + 3] = 0;
        continue;
      }
      const falloff = gain * Math.exp(-(d * d) / twoSigma2);
      rgba[o + 3] = Math.max(0, Math.min(255, Math.round(falloff * 255)));
    }
  }

  return {
    width: w,
    height: h,
    rgba,
    rect: { x: rectX, y: rectY, w: box.width, h: box.height },
  };
}

export async function writePlatePng(path: string, plate: GlowPlate): Promise<GlowPlate> {
  const { encodePNG } = (await import(`${pocketjsRoot()}/tools/png.ts`)) as {
    encodePNG: (rgba: Uint8Array, w: number, h: number) => Buffer;
  };
  let png: Buffer;
  try {
    png = encodePNG(plate.rgba, plate.width, plate.height);
  } catch (e) {
    throw new Error(
      `glow plate: encodePNG failed for ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (png.length === 0) {
    throw new Error(`glow plate: encodePNG produced an empty buffer for ${path}`);
  }
  try {
    await Bun.write(path, png);
  } catch (e) {
    throw new Error(
      `glow plate: could not write ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return plate;
}

export async function writeGlowPng(path: string, box: GlowBox): Promise<GlowPlate> {
  return writePlatePng(path, rasterGlowPlate(box));
}

/** Fill + cap for a template column. Both writes fail loud, not as a checkerboard. */
/**
 * The three nodes a column veil is painted from: a cap above the stack, the
 * constant fill stretched across it, and the same cap below turned over.
 *
 * `rotate-180` is what makes the lower cap fade downward; dropping it puts the
 * bright edge at the bottom of the frame and a dark seam under the last line.
 * That is a property of the picture, not of this string, so
 * `compositions/glow-column` renders both a short and a tall stack into the
 * digest ledger.
 */
export function glowColumnNodes(columnW: number, stackH: number, indent: string): string {
  const spread = CANCEL_BUTTON.spread;
  return (
    [
      `${indent}<Image debugName="glow-top" class="absolute left-0 top-[-${spread}px] w-[${columnW}px] h-[${spread}px]" src="${GLOW_CAP_ASSET}" />`,
      `${indent}<Image debugName="glow" class="absolute left-0 top-0 w-[${columnW}px] h-[${stackH}px]" src="${GLOW_ASSET}" />`,
      `${indent}<Image debugName="glow-bot" class="absolute left-0 top-[${stackH}px] w-[${columnW}px] h-[${spread}px] rotate-180" src="${GLOW_CAP_ASSET}" />`,
    ].join("\n") + "\n"
  );
}

export async function writeGlowColumn(
  outDir: string,
): Promise<{ fill: GlowPlate; cap: GlowPlate; spread: number }> {
  const fill = await writePlatePng(join(outDir, GLOW_ASSET), rasterGlowFill());
  const cap = await writePlatePng(join(outDir, GLOW_CAP_ASSET), rasterGlowCap());
  return { fill, cap, spread: CANCEL_BUTTON.spread };
}
