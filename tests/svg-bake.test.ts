/**
 * The SVG baker (`framework/compiler/bake-svg.ts`, changed by
 * patches/0040-svg-scanline-and-strokes) against the baker it replaced.
 *
 * The replacement makes two claims, held separately because they are
 * different kinds of claim:
 *
 * - Coverage is the reference's, count for count. The reference is the
 *   per-subsample point-in-polygon baker at the pin, kept verbatim in the
 *   vendored tree as `tests/fixtures/bake-svg-reference.ts`; the scanline
 *   must give every pixel the same covered-subsample integer for any contours
 *   and any disc. Held three ways: every SVG this repository and the vendored
 *   tree ship, through the whole pipeline at densities 1-3; seeded random
 *   fills and discs, and fills whose edges pass through subsample positions,
 *   at the coverage function itself; and windows of the hex grid that took
 *   the reference more than ten minutes.
 * - What is new is right: strokes, joins, caps, `<g transform>`, group
 *   opacity and the refusals. The full set lives in the vendored
 *   `tests/svg-bake.test.ts`, which this repository's `bun test ./tests/`
 *   does not run; what AUTHORING.md states as a fact is repeated here so CI
 *   here holds it.
 *
 * Red cases, each run against this file with the edit applied and reverted:
 * the crossing computed from the other endpoint (the same line, different
 * rounding) fails the knife-edge fills and nothing else here — random
 * coordinates hit that rounding about once in 1500 cases, and no shipped SVG
 * does; `<` made `<=` at a sample boundary fails the random fills and the
 * shipped SVGs; dropping the disc's left candidate column fails the random
 * discs; the transform list applied leftmost first fails the transform test;
 * every miter made a bevel fails the join tests; fill and stroke composited
 * separately under `opacity` fails the group test.
 *
 * Imported through computed specifiers so `tsc` does not follow them into
 * `vendor/`, which does not typecheck under this repository's settings.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
// The reference is the slow baker, by design: the corpus run bakes 117 images with it.
const VENDOR = join(ROOT, "vendor", "pocketjs");
const BAKER = join(VENDOR, "framework/compiler/bake-svg.ts");
const REFERENCE = join(VENDOR, "tests/fixtures/bake-svg-reference.ts");
const CASES = join(VENDOR, "tests/fixtures/svg-bake-cases.ts");

type Pt = [number, number];
type Window = [number, number, number, number];
type Visit = (x: number, y: number, covered: number) => void;
interface Image {
  width: number;
  height: number;
  rgba: Uint8Array;
}
interface Baker {
  bakeSvg(svg: string, density?: number): Image;
  coverPath(contours: Pt[][], evenOdd: boolean, x0: number, y0: number, x1: number, y1: number, visit: Visit): void;
  coverCircle(cx: number, cy: number, r: number, x0: number, y0: number, x1: number, y1: number, visit: Visit): void;
}
interface Reference {
  bakeSvg(svg: string, density?: number): Image;
  referencePathCoverage(contours: Pt[][], evenOdd: boolean, x0: number, y0: number, x1: number, y1: number): Uint8Array;
  referenceCircleCoverage(c: { cx: number; cy: number; r: number }, x0: number, y0: number, x1: number, y1: number): Uint8Array;
}
interface Cases {
  coverageCases(seed: number, count: number): {
    paths: { contours: Pt[][]; evenOdd: boolean; window: Window }[];
    circles: { cx: number; cy: number; r: number; window: Window }[];
  };
  knifeEdgeCases(seed: number, count: number): { contours: Pt[][]; evenOdd: boolean; window: Window }[];
  hexGridSvg(): string;
  hexGridStrokeSvg(): string;
  polygonContours(d: string): Pt[][];
}

for (const f of [BAKER, REFERENCE, CASES]) {
  if (!existsSync(f)) throw new Error(`${f} is missing — run \`bun run vendor\` (patches/0040 adds the fixtures)`);
}
const baker = (await import(BAKER)) as Baker;
const reference = (await import(REFERENCE)) as Reference;
const cases = (await import(CASES)) as Cases;

function counts(run: (visit: Visit) => void, [x0, y0, x1, y1]: Window): Uint8Array {
  const w = Math.max(0, x1 - x0);
  const out = new Uint8Array(w * Math.max(0, y1 - y0));
  run((x, y, covered) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) throw new Error(`visited ${x},${y} outside the window`);
    out[(y - y0) * w + (x - x0)] = covered;
  });
  return out;
}

function firstDifference(want: Uint8Array, got: Uint8Array, [x0, y0, x1]: Window): string | null {
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== got[i]) {
      return `pixel ${x0 + (i % (x1 - x0))},${y0 + Math.floor(i / (x1 - x0))}: reference ${want[i]}, scanline ${got[i]}`;
    }
  }
  return null;
}

function svgFiles(root: string): string[] {
  const out = Bun.spawnSync(["git", "ls-files", "*.svg"], { cwd: root }).stdout.toString().trim();
  return out ? out.split("\n").map((f) => join(root, f)) : [];
}

describe("the scanline gives every pixel the reference's covered count", () => {
  test("every SVG the reference bakes, from this repository and the vendored tree, at densities 1-3", () => {
    const files = [...svgFiles(ROOT), ...svgFiles(VENDOR)];
    expect(files.some((f) => f.startsWith(join(ROOT, "compositions")))).toBe(true);
    const held: string[] = [];
    const parts: string[] = [];
    for (const file of files) {
      const svg = readFileSync(file, "utf8");
      // <text> was dropped by the reference and is refused now (below).
      if (/<text\b/.test(svg)) continue;
      for (const density of [1, 2, 3]) {
        let want: Image;
        try {
          want = reference.bakeSvg(svg, density);
        } catch {
          continue;
        }
        const got = baker.bakeSvg(svg, density);
        if (got.width !== want.width || !Buffer.from(got.rgba).equals(Buffer.from(want.rgba))) {
          parts.push(`${file} @${density}x differs`);
        }
        held.push(`${file}@${density}`);
      }
    }
    expect(parts, parts.join("\n") || "identical").toEqual([]);
    // 38 vendored icons and sprites plus compositions/probe/mark.svg, three
    // densities each, as the trees stand. Fewer means the check reaches less
    // than it did — a file the reference stopped accepting, or one removed.
    expect(held.length).toBeGreaterThanOrEqual(117);
  }, 120_000);

  test("1500 random fills and 1500 random discs (seed 2)", () => {
    const { paths, circles } = cases.coverageCases(2, 1500);
    for (const [i, c] of paths.entries()) {
      const want = reference.referencePathCoverage(c.contours, c.evenOdd, ...c.window);
      const got = counts((v) => baker.coverPath(c.contours, c.evenOdd, ...c.window, v), c.window);
      const at = firstDifference(want, got, c.window);
      if (at) throw new Error(`fill case ${i}: ${at}`);
    }
    for (const [i, c] of circles.entries()) {
      const want = reference.referenceCircleCoverage(c, ...c.window);
      const got = counts((v) => baker.coverCircle(c.cx, c.cy, c.r, ...c.window, v), c.window);
      const at = firstDifference(want, got, c.window);
      if (at) throw new Error(`disc case ${i}: ${at}`);
    }
  }, 120_000);

  test("500 knife-edge fills (seed 2): edges through subsample positions", () => {
    for (const [i, c] of cases.knifeEdgeCases(2, 500).entries()) {
      const want = reference.referencePathCoverage(c.contours, c.evenOdd, ...c.window);
      const got = counts((v) => baker.coverPath(c.contours, c.evenOdd, ...c.window, v), c.window);
      const at = firstDifference(want, got, c.window);
      if (at) throw new Error(`knife-edge case ${i}: ${at}`);
    }
  }, 120_000);

  test("the 952-cell hex grid: identical at sampled windows, and baked whole in seconds", () => {
    const svg = cases.hexGridSvg();
    const contours = cases.polygonContours(/d="([^"]*)"/.exec(svg)![1]!);
    for (const window of [[24, 24, 48, 48], [1000, 300, 1024, 324]] as Window[]) {
      const want = reference.referencePathCoverage(contours, true, ...window);
      const got = counts((v) => baker.coverPath(contours, true, ...window, v), window);
      expect(firstDifference(want, got, window)).toBeNull();
    }
    // The reference took more than ten minutes over the whole grid.
    const t = performance.now();
    baker.bakeSvg(svg);
    baker.bakeSvg(cases.hexGridStrokeSvg());
    expect(performance.now() - t).toBeLessThan(5000);
  }, 120_000);
});

const doc = (w: number, h: number, body: string) => `<svg width="${w}" height="${h}">${body}</svg>`;
const same = (a: string, b: string) =>
  Buffer.from(baker.bakeSvg(a).rgba).equals(Buffer.from(baker.bakeSvg(b).rgba));
const pixel = (svg: string, x: number, y: number) => {
  const img = baker.bakeSvg(svg);
  return Array.from(img.rgba.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
};

describe("what AUTHORING.md states about the SVG subset", () => {
  test("a stroke is the region it sweeps: a line is a rectangle, a closed rect a mitred ring", () => {
    expect(same(
      doc(32, 20, `<line x1="4" y1="10" x2="28" y2="10" stroke="#fff" stroke-width="4"/>`),
      doc(32, 20, `<rect x="4" y="8" width="24" height="4" fill="#fff"/>`),
    )).toBe(true);
    expect(same(
      doc(64, 64, `<rect x="10" y="10" width="40" height="30" fill="none" stroke="#fff" stroke-width="4"/>`),
      doc(64, 64, `<path fill="#fff" fill-rule="evenodd" d="M8 8H52V42H8ZM12 12H48V38H12Z"/>`),
    )).toBe(true);
  });

  test("joins: miter to the corner, bevel cut across it", () => {
    const line = (join: string) =>
      doc(64, 64, `<polyline points="10,10 50,10 50,50" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="${join}"/>`);
    expect(same(line("miter"), doc(64, 64, `<path fill="#fff" d="M10 8H52V50H48V12H10Z"/>`))).toBe(true);
    expect(same(line("bevel"), doc(64, 64, `<path fill="#fff" d="M10 8H50L52 10V50H48V12H10Z"/>`))).toBe(true);
  });

  test("transforms apply in SVG order: the shape's own rightmost first, then each <g> outward", () => {
    const square = doc(32, 32, `<path fill="#fff" d="M8 0H16V8H8Z"/>`);
    expect(same(doc(32, 32, `<path fill="#fff" transform="translate(8 0) scale(2)" d="M0 0H4V4H0Z"/>`), square)).toBe(true);
    expect(same(doc(32, 32, `<g transform="translate(8 0)"><rect width="4" height="4" transform="scale(2)" fill="#fff"/></g>`), square)).toBe(true);
  });

  test("fill and stroke under one opacity composite as one group", () => {
    const svg = doc(32, 32, `<rect x="8" y="8" width="16" height="16" fill="#ff0000" stroke="#0000ff" stroke-width="4" opacity="0.5"/>`);
    expect(pixel(svg, 8, 16)).toEqual([0, 0, 255, 128]);
  });

  test("what would paint and is not implemented is refused", () => {
    for (const [body, message] of [
      [`<text x="0" y="10">hi</text>`, "<text> is not drawn"],
      [`<line x2="8" stroke="#fff" stroke-dasharray="2 2"/>`, "stroke-dasharray"],
      [`<rect width="4" height="4" clip-path="url(#c)"/>`, "clip-path"],
      [`<style>.a{fill:red}</style><rect width="4" height="4"/>`, "<style> is not drawn"],
    ] as const) {
      expect(() => baker.bakeSvg(doc(16, 16, body))).toThrow(message);
    }
  });
});
