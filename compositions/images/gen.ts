#!/usr/bin/env bun
/**
 * Writes the two pictures `compositions/images` draws. `.gitignore` ignores
 * `*.png`, so they are made here, from integer arithmetic and `Math.sqrt`
 * (correctly rounded), and the ledger and the tests run this before they
 * build (`src/cli/generators.ts`).
 *
 *   horizon.png  900x506 — a sky gradient, a sun disc and a horizon band
 *   texels.png   3x5 — fifteen distinct colours, one per texel
 *
 *   bun compositions/images/gen.ts
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { pocketjsRoot } from "../../src/runtime/boot.ts";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const { encodePNG } = (await import(`${pocketjsRoot()}/tests/png.ts`)) as {
  encodePNG: (rgba: Uint8Array, w: number, h: number) => Buffer;
};

function horizon(): { w: number; h: number; rgba: Uint8Array } {
  const w = 900, h = 506;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const t = y / (h - 1);
      let r = Math.round(30 + 200 * t), g = Math.round(40 + 90 * t), b = Math.round(110 + 40 * (1 - t));
      const dx = x - 620, dy = y - 300, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 90) {
        r = 255; g = 214; b = 120;
      } else if (d < 110) {
        const f = (110 - d) / 20;
        r = Math.round(r + (255 - r) * f); g = Math.round(g + (214 - g) * f); b = Math.round(b + (120 - b) * f);
      }
      if (y > 380) {
        const f = Math.min(1, (y - 380) / 6);
        r = Math.round(r * (1 - f) + 12 * f); g = Math.round(g * (1 - f) + 18 * f); b = Math.round(b * (1 - f) + 38 * f);
      }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  return { w, h, rgba };
}

function texels(): { w: number; h: number; rgba: Uint8Array } {
  const w = 3, h = 5;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      rgba[o] = 60 + 90 * x; rgba[o + 1] = 40 * y + 40; rgba[o + 2] = (x + y) % 2 ? 230 : 90; rgba[o + 3] = 255;
    }
  }
  return { w, h, rgba };
}

for (const [name, img] of [["horizon.png", horizon()], ["texels.png", texels()]] as const) {
  await Bun.write(join(DIR, name), encodePNG(img.rgba, img.w, img.h));
}
