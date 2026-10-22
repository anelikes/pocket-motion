/**
 * `src/image/raster.ts` and `src/image/print.ts`: plates a generator paints.
 *
 * Each case below is a claim a film here relied on:
 *
 * - `turnPlate` is a permutation, so a picture resting at a quarter turn is
 *   the same pixels as the turn would have drawn, without being a turned quad;
 * - `streaks` wraps angles before measuring — it once filled the upper half
 *   of its plate, because atan2 is in (−π, π] and the strokes in [0, 2π);
 * - `sar` gives the same speckle with or without the ship, which is what
 *   lets one dissolve into the other;
 * - `cell` cuts the printed poster into tiles that are the form again, pixel
 *   for pixel, so a row of cells has no seam;
 * - printed ink is opaque inside its edge — an ink that thinned its alpha let
 *   the grid show through a red square (mg-bauhaus, fourth jury round).
 */

import { describe, expect, test } from "bun:test";

import { cell, compound, form, type Part, type Placed } from "../src/image/print.ts";
import { polylines, sar, streaks, turnPlate, wedge, type Plate } from "../src/image/raster.ts";

const alpha = (p: Plate, x: number, y: number) => p.rgba[(y * p.width + x) * 4 + 3]!;
const meanAlpha = (p: Plate, y0: number, y1: number) => {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < p.width; x++) (s += alpha(p, x, y)), n++;
  return s / n;
};

describe("turnPlate", () => {
  const plate: Plate = { width: 3, height: 2, rgba: Uint8Array.from({ length: 24 }, (_, i) => i) };
  test("a quarter turn clockwise puts the top-left pixel top-right and swaps the sides", () => {
    const q = turnPlate(plate, 1);
    expect([q.width, q.height]).toEqual([2, 3]);
    expect(Array.from(q.rgba.slice((0 * 2 + 1) * 4, (0 * 2 + 1) * 4 + 4))).toEqual([0, 1, 2, 3]);
  });
  test("four quarter turns, and two half turns, are the identity", () => {
    let p = plate;
    for (let i = 0; i < 4; i++) p = turnPlate(p, 1);
    expect(Array.from(p.rgba)).toEqual(Array.from(plate.rgba));
    expect(Array.from(turnPlate(turnPlate(plate, 2), 2).rgba)).toEqual(Array.from(plate.rgba));
    expect(Array.from(turnPlate(plate, -1).rgba)).toEqual(Array.from(turnPlate(plate, 3).rgba));
  });
});

describe("painters", () => {
  test("streaks are spread round the whole circle, not packed into the upper half", () => {
    const p = streaks(400, 400, 120, 40, 200, 41);
    const top = meanAlpha(p, 0, 200);
    const bottom = meanAlpha(p, 200, 400);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(Math.max(top, bottom) / Math.min(top, bottom)).toBeLessThan(2);
  });

  test("a polyline's soft edge is whole inside r0 and gone past r1", () => {
    const lines: [number, number][][] = [[[0, 100], [200, 100]]];
    const p = polylines(200, 200, lines, 2, 3, [], { r0: 40, r1: 80 });
    expect(alpha(p, 100, 100)).toBeGreaterThan(200);
    expect(alpha(p, 10, 100)).toBe(0);
    expect(alpha(p, 190, 100)).toBe(0);
  });

  test("a wedge is brightest at its leading edge, pointing up, and empty ahead of it", () => {
    const p = wedge(200, 100, 35, 0.5);
    const lead = alpha(p, 99, 50); // just left of straight up, i.e. just behind the edge
    const behind = alpha(p, 85, 50); // further counter-clockwise
    const ahead = alpha(p, 115, 50); // clockwise of the edge
    expect(lead).toBeGreaterThan(behind);
    expect(ahead).toBe(0);
  });

  test("sar: the same seed gives the same speckle away from the ship, with or without it", () => {
    const sea = sar(160, 7, false);
    const ship = sar(160, 7, true);
    // the top-left corner is far from the ship (at 0.64, 0.40) and off its sidelobe cross and wake
    let diff = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) diff = Math.max(diff, Math.abs(sea.rgba[(y * 160 + x) * 4]! - ship.rgba[(y * 160 + x) * 4]!));
    expect(diff).toBeLessThanOrEqual(1);
    // and the ship is there
    expect(ship.rgba[(64 * 160 + 102) * 4]!).toBeGreaterThan(200);
  });

  test("sar: a grain wider than a pixel makes speckle that holds across neighbouring pixels", () => {
    // mean step between horizontal neighbours on open sea, top-left, away from the ship
    const step = (p: Plate) => {
      let sum = 0;
      for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) sum += Math.abs(p.rgba[(y * 160 + x) * 4]! - p.rgba[(y * 160 + x + 1) * 4]!);
      return sum / 1600;
    };
    const fine = sar(160, 7, false);
    const coarse = sar(160, 7, false, 72, [0.64, 0.4], 1, 1, { grain: 3 });
    // dither steps by about as much as the speckle varies; a 3 px grain by well under half of that
    expect(step(coarse)).toBeLessThan(step(fine) * 0.45);
  });
});

describe("print", () => {
  const red: [number, number, number] = [224, 60, 49];
  const disc: Placed = { kind: "disc", x: 0, y: 0, w: 240, h: 240, rot: 0, rgb: red, seed: 9 };
  const sameInk = (a: Plate, ax: number, ay: number, b: Plate, bx: number, by: number, n: number) => {
    let worst = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const ia = ((ay + y) * a.width + ax + x) * 4;
        const ib = ((by + y) * b.width + bx + x) * 4;
        worst = Math.max(worst, Math.abs(a.rgba[ia + 3]! - b.rgba[ib + 3]!));
        if (a.rgba[ia + 3]! > 0) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a.rgba[ia + c]! - b.rgba[ib + c]!));
      }
    }
    return worst;
  };

  test("cells are the form again, pixel for pixel, so neighbours meet without a seam", () => {
    const whole = form("disc", 240, 240, red, 9, 2);
    expect(sameInk(cell([disc], 0, 0, 120, 2), 0, 0, whole, 0, 0, 240)).toBe(0);
    expect(sameInk(cell([disc], 120, 0, 120, 2), 0, 0, whole, 240, 0, 240)).toBe(0);
    expect(sameInk(cell([disc], 120, 120, 120, 2), 0, 0, whole, 240, 240, 240)).toBe(0);
  });

  test("ink is opaque inside its edge: what lies under a form never shows through it", () => {
    const sq = form("box", 120, 120, red, 3, 2);
    let lowest = 255;
    for (let y = 6; y < 234; y++) for (let x = 6; x < 234; x++) lowest = Math.min(lowest, sq.rgba[(y * 240 + x) * 4 + 3]!);
    expect(lowest).toBe(255);
  });

  test("a bleed widens the cell into its neighbours with the same pixels", () => {
    const whole = form("disc", 240, 240, red, 9, 2);
    const bled = cell([disc], 120, 120, 120, 2, 2);
    expect([bled.width, bled.height]).toEqual([248, 248]);
    expect(sameInk(bled, 0, 0, whole, 236, 236, 244)).toBe(0);
  });

  test("a form's own quarter turn is the turned picture, in a cell too", () => {
    const quarter: Placed = { kind: "quarter", x: 0, y: 0, w: 240, h: 240, rot: 1, rgb: [17, 17, 17], seed: 4 };
    const whole = form("quarter", 240, 240, [17, 17, 17], 4, 2, 1);
    expect(sameInk(cell([quarter], 120, 120, 120, 2), 0, 0, whole, 240, 240, 240)).toBe(0);
  });

  test("a compound prints its parts as one form: no seam where parts meet, none where cuts meet", () => {
    const black: [number, number, number] = [17, 17, 17];
    // two boxes side by side, and two counters cut side by side out of a third
    const parts: Part[] = [
      { kind: "box", x: 0, y: 0, w: 60, h: 120, rot: 0 },
      { kind: "box", x: 60, y: 0, w: 60, h: 120, rot: 0 },
      { kind: "box", x: 0, y: 140, w: 120, h: 100, rot: 0 },
      { kind: "box", x: 20, y: 160, w: 40, h: 60, rot: 0, cut: true },
      { kind: "box", x: 60, y: 160, w: 40, h: 60, rot: 0, cut: true },
    ];
    const one = compound(parts, black, 5, 0, 0, 120, 240, 2);
    const at = (p: Plate, x: number, y: number) => p.rgba[(y * p.width + x) * 4 + 3]!;
    // down the joint between the two boxes (plate x 119/120), clear of the outer edge: ink throughout
    let joint = 255;
    for (let y = 8; y < 232; y++) joint = Math.min(joint, at(one, 119, y), at(one, 120, y));
    expect(joint).toBe(255);
    // down the joint between the two cuts: paper throughout
    let cutJoint = 0;
    for (let y = 328; y < 432; y++) cutJoint = Math.max(cutJoint, at(one, 119, y), at(one, 120, y));
    expect(cutJoint).toBe(0);
    // the same two boxes printed as separate forms leave a hairline between them: the defect this exists for
    const apart = cell(
      parts.slice(0, 2).map((p, i) => ({ ...p, rgb: black, seed: 5 + i })),
      0,
      0,
      120,
      2,
    );
    let crack = 255;
    for (let y = 8; y < 232; y++) crack = Math.min(crack, at(apart, 119, y), at(apart, 120, y));
    expect(crack).toBeLessThan(255);
  });
});
