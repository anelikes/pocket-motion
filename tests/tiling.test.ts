/**
 * Tile geometry.
 *
 * The failure mode here is not a crash. If the layer's fast run math and the
 * reference `sourceTexel` disagree, or if a tile's UV and its drawn width
 * disagree, the picture is silently shifted or stretched by a pixel — which
 * looks like a resampling artefact and gets debugged as one.
 */

import { describe, expect, test } from "bun:test";
import { BLEED, gridOf, interiorOf, placeTile, sourceTexel, texelRun } from "../src/footage/tiling.ts";

const GEOMETRIES = [
  { w: 1920, h: 1080, tile: 512 }, // 1080p, the shipping case
  { w: 2048, h: 1024, tile: 512 }, // divides evenly by the TEXTURE, not the interior
  { w: 1020, h: 510, tile: 512 }, // exactly two interiors wide, one tall
  { w: 300, h: 200, tile: 512 }, //  smaller than one tile in both axes
  { w: 511, h: 513, tile: 512 }, //  either side of the texture size
  { w: 64, h: 64, tile: 64 }, //     a small tile, so BLEED is a big fraction
];

describe("texelRun agrees with sourceTexel", () => {
  for (const g of GEOMETRIES) {
    test(`${g.w}x${g.h} tile ${g.tile}`, () => {
      const interior = interiorOf(g.tile);
      const [cols, rows] = gridOf(g.w, g.h, g.tile);
      for (let c = 0; c < cols; c++) {
        const run = texelRun(c * interior, g.w, g.tile);
        expect(run.avail).toBeGreaterThan(0);
        for (let tx = 0; tx < g.tile; tx++) {
          // The run's three spans: replicate `first`, copy, replicate the last.
          const fast =
            tx < run.lead
              ? run.first
              : tx < run.lead + run.avail
                ? run.first + (tx - run.lead)
                : run.first + run.avail - 1;
          expect(fast).toBe(sourceTexel(c * interior, tx, g.w));
        }
      }
      for (let r = 0; r < rows; r++) {
        const run = texelRun(r * interior, g.h, g.tile);
        for (let ty = 0; ty < g.tile; ty++) {
          const fast =
            ty < run.lead
              ? run.first
              : ty < run.lead + run.avail
                ? run.first + (ty - run.lead)
                : run.first + run.avail - 1;
          expect(fast).toBe(sourceTexel(r * interior, ty, g.h));
        }
      }
    });
  }
});

describe("the grid covers the picture exactly once", () => {
  for (const g of GEOMETRIES) {
    test(`${g.w}x${g.h} tile ${g.tile}`, () => {
      const [cols, rows] = gridOf(g.w, g.h, g.tile);
      // Interiors tile the picture with no gap and no overlap.
      let x = 0;
      for (let c = 0; c < cols; c++) {
        const p = placeTile(g.w, g.h, g.tile, c, 0);
        expect(p.x).toBe(x);
        expect(p.w).toBeGreaterThan(0);
        x += p.w;
      }
      expect(x).toBe(g.w);

      let y = 0;
      for (let r = 0; r < rows; r++) {
        const p = placeTile(g.w, g.h, g.tile, 0, r);
        expect(p.y).toBe(y);
        y += p.h;
      }
      expect(y).toBe(g.h);
    });
  }
});

describe("the UV rect selects exactly the drawn interior", () => {
  for (const g of GEOMETRIES) {
    test(`${g.w}x${g.h} tile ${g.tile}`, () => {
      const [cols, rows] = gridOf(g.w, g.h, g.tile);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = placeTile(g.w, g.h, g.tile, c, r);
          const [u0, v0, u1, v1] = p.uv;
          // A UV span of exactly `w` texels, starting one bleed texel in — so
          // the drawn size and the sampled size cannot disagree.
          expect(u0 * g.tile).toBeCloseTo(BLEED, 10);
          expect(v0 * g.tile).toBeCloseTo(BLEED, 10);
          expect((u1 - u0) * g.tile).toBeCloseTo(p.w, 10);
          expect((v1 - v0) * g.tile).toBeCloseTo(p.h, 10);
          // And it stays inside the texture — the core rejects rects that do not.
          expect(u1).toBeLessThanOrEqual(1);
          expect(v1).toBeLessThanOrEqual(1);
          expect(u0).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe("the bleed texel holds the neighbour, not a repeat", () => {
  test("interior joins see across, outer edges clamp", () => {
    const { w, tile } = { w: 1920, tile: 512 };
    const interior = interiorOf(tile);

    // Tile 0's last texel is tile 1's first interior pixel, and vice versa.
    const left = texelRun(0, w, tile);
    const right = texelRun(interior, w, tile);
    const lastOfLeft = left.first + left.avail - 1;
    expect(sourceTexel(0, tile - 1, w)).toBe(interior); // one past tile 0's interior
    expect(sourceTexel(interior, 0, w)).toBe(interior - 1); // one before tile 1's
    expect(lastOfLeft).toBeGreaterThanOrEqual(interior);
    expect(right.first).toBe(interior - BLEED);

    // The picture's own left edge has no neighbour, so texel 0 repeats pixel 0.
    expect(sourceTexel(0, 0, w)).toBe(0);
    expect(left.lead).toBe(BLEED);
  });
});
