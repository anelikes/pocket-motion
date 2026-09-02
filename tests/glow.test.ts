/**
 * Build-time glow plate. The kernel is the thing under test: a real box,
 * real pixels, no stub of the raster.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TEX_MAX_DIM } from "../src/manifest/sidecar.ts";
import { generate } from "../compositions/glow/gen.ts";
import {
  CANCEL_BUTTON,
  GLOW_FILL_DIM,
  glowCanvasSize,
  nextPow2,
  rasterGlowCap,
  rasterGlowFill,
  rasterGlowPlate,
  writeGlowColumn,
  writeGlowPng,
} from "../src/image/glow.ts";

const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

function sample(
  plate: { width: number; rgba: Uint8Array },
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  const i = (y * plate.width + x) * 4;
  return {
    r: plate.rgba[i]!,
    g: plate.rgba[i + 1]!,
    b: plate.rgba[i + 2]!,
    a: plate.rgba[i + 3]!,
  };
}

describe("glow plate raster", () => {
  test("canvas is power-of-two and at most TEX_MAX_DIM", () => {
    const plate = rasterGlowPlate(CANCEL_BUTTON);
    expect(isPow2(plate.width)).toBe(true);
    expect(isPow2(plate.height)).toBe(true);
    expect(plate.width).toBeLessThanOrEqual(TEX_MAX_DIM);
    expect(plate.height).toBeLessThanOrEqual(TEX_MAX_DIM);
    expect(plate.rgba.length).toBe(plate.width * plate.height * 4);
  });

  test("a pixel just above the rect outshines a far corner", () => {
    const plate = rasterGlowPlate(CANCEL_BUTTON);
    const { rect } = plate;
    const midX = Math.round(rect.x + rect.w / 2);
    const aboveY = Math.max(0, Math.round(rect.y - 1));
    const halo = sample(plate, midX, aboveY);
    const corner = sample(plate, 0, 0);
    expect(halo.a).toBeGreaterThan(corner.a);
    expect(halo.a).toBeGreaterThan(40);
    expect(corner.a).toBeLessThan(8);
    expect(halo.r).toBe(255);
    expect(halo.g).toBe(255);
    expect(halo.b).toBe(255);
  });

  test("left and right of the rect stay dark — the glow is vertical only", () => {
    const plate = rasterGlowPlate(CANCEL_BUTTON);
    const { rect } = plate;
    const midY = Math.round(rect.y + rect.h / 2);
    const leftX = Math.max(0, Math.round(rect.x - 2));
    const rightX = Math.min(plate.width - 1, Math.round(rect.x + rect.w + 2));
    const aboveY = Math.max(0, Math.round(rect.y - 2));
    const midX = Math.round(rect.x + rect.w / 2);
    expect(sample(plate, leftX, midY).a).toBeLessThan(16);
    expect(sample(plate, rightX, midY).a).toBeLessThan(16);
    expect(sample(plate, midX, aboveY).a).toBeGreaterThan(40);
  });

  test("the veil is weak at the edge and stays close further out", () => {
    const plate = rasterGlowPlate(CANCEL_BUTTON);
    const { rect } = plate;
    const midX = Math.round(rect.x + rect.w / 2);
    const near = sample(plate, midX, Math.max(0, Math.round(rect.y - 4)));
    const mid = sample(plate, midX, Math.max(0, Math.round(rect.y - 20)));
    expect(near.a).toBeLessThan(110);
    expect(mid.a).toBeGreaterThan(40);
    expect(Math.abs(near.a - mid.a)).toBeLessThan(30);
  });

  test("the far corner is near-transparent", () => {
    const plate = rasterGlowPlate(CANCEL_BUTTON);
    expect(sample(plate, 0, 0).a).toBeLessThan(8);
    expect(sample(plate, plate.width - 1, 0).a).toBeLessThan(8);
    expect(sample(plate, 0, plate.height - 1).a).toBeLessThan(8);
    expect(sample(plate, plate.width - 1, plate.height - 1).a).toBeLessThan(8);
  });

  test("a box that cannot pad to TEX_MAX_DIM is refused", () => {
    expect(() =>
      rasterGlowPlate({ width: 500, height: 500, radius: 8, sigma: 20, spread: 40 }),
    ).toThrow(new RegExp(`TEX_MAX_DIM ${TEX_MAX_DIM}`));
  });

  test("glowCanvasSize names the same pow2 the raster uses", () => {
    const spread = CANCEL_BUTTON.spread ?? Math.ceil(3 * CANCEL_BUTTON.sigma);
    const want = glowCanvasSize(
      CANCEL_BUTTON.width + 2 * spread,
      CANCEL_BUTTON.height + 2 * spread,
    );
    const plate = rasterGlowPlate(CANCEL_BUTTON);
    expect(plate.width).toBe(want.w);
    expect(plate.height).toBe(want.h);
    expect(nextPow2(364)).toBe(512);
  });

  test("the cancel button plate is hollow — an opaque View covers the rect", () => {
    const plate = rasterGlowPlate(CANCEL_BUTTON);
    const { rect } = plate;
    const midX = Math.round(rect.x + rect.w / 2);
    const midY = Math.round(rect.y + rect.h / 2);
    expect(sample(plate, midX, midY).a).toBe(0);
  });
});

describe("glow column fill and cap", () => {
  test("the fill is a constant peak — stretching it in X or Y is lossless", () => {
    const fill = rasterGlowFill();
    expect(fill.width).toBe(GLOW_FILL_DIM);
    expect(fill.height).toBe(GLOW_FILL_DIM);
    const peak = sample(fill, 0, 0).a;
    expect(peak).toBeGreaterThan(40);
    for (let y = 0; y < fill.height; y++) {
      for (let x = 0; x < fill.width; x++) {
        expect(sample(fill, x, y).a).toBe(peak);
      }
    }
  });

  test("the cap is bright at the stack edge and fades away from it", () => {
    const cap = rasterGlowCap();
    expect(cap.height).toBe(CANCEL_BUTTON.spread);
    expect(isPow2(cap.width)).toBe(true);
    expect(isPow2(cap.height)).toBe(true);
    const midX = Math.floor(cap.width / 2);
    const bright = sample(cap, midX, cap.height - 1);
    const far = sample(cap, midX, 0);
    expect(bright.a).toBeGreaterThan(40);
    expect(bright.a).toBe(sample(rasterGlowFill(), 0, 0).a);
    expect(far.a).toBeLessThan(bright.a);
    expect(far.a).toBeLessThan(16);
    expect(Math.abs(sample(cap, 0, cap.height - 1).a - bright.a)).toBeLessThan(8);
    expect(Math.abs(sample(cap, cap.width - 1, cap.height - 1).a - bright.a)).toBeLessThan(8);
  });

  test("writeGlowColumn writes both plates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-glow-col-"));
    try {
      const { fill, cap, spread } = await writeGlowColumn(dir);
      expect(spread).toBe(CANCEL_BUTTON.spread);
      expect(await Bun.file(join(dir, "glow.png")).exists()).toBe(true);
      expect(await Bun.file(join(dir, "glow-cap.png")).exists()).toBe(true);
      expect(sample(fill, 0, 0).a).toBe(sample(cap, 0, cap.height - 1).a);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("writeGlowPng", () => {
  test("writes a non-empty PNG of the raster", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-glow-"));
    try {
      const path = join(dir, "glow.png");
      const plate = await writeGlowPng(path, CANCEL_BUTTON);
      const file = Bun.file(path);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(8);
      const bytes = new Uint8Array(await file.arrayBuffer());
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(plate.width).toBe(rasterGlowPlate(CANCEL_BUTTON).width);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a failed write is an error, not a silent checkerboard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-glow-"));
    try {
      const blocker = join(dir, "not-a-dir");
      await writeFile(blocker, "x");
      await expect(writeGlowPng(join(blocker, "glow.png"), CANCEL_BUTTON)).rejects.toThrow(
        /could not write/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the generator surfaces a failed plate write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocketjs-motion-glow-"));
    try {
      const blocker = join(dir, "not-a-dir");
      await writeFile(blocker, "x");
      await expect(generate(blocker)).rejects.toThrow(/could not write/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
