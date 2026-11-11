/**
 * Colour filters (patches/0065) through the whole pipeline: the class or
 * keyframe a composition writes, the amount the compiler bakes into the pak,
 * and the layer the wasm core filters.
 *
 * The matrices themselves are held in the core (`engine/core/src/tests.rs`,
 * against an f64 transcription of Filter Effects 1, each guard red under an
 * edit the 0065 header lists). Here `compositions/colour-filters` is read
 * against a second transcription, in TypeScript, applied to the fixture's own
 * unfiltered card: a Tailwind step baked to the wrong amount, a filter that
 * reaches the shadow, or an animation that stops driving the filter turns a
 * card red here that no core test would see.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { readTimelines } from "../src/anim/timelines.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { openProber, rect, type Prober } from "../src/render/visibility.ts";
import { TICKS_PER_SECOND, hardenedBootWorld, type BootedWorld } from "../src/runtime/boot.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "compositions", "colour-filters");
process.env.POCKETJS_ROOT = join(ROOT, "vendor", "pocketjs");

type Rgb = [number, number, number];

/**
 * CSS Filter Effects 1's colour filter functions on 0..1 channels, each
 * result clamped to 0..1: typed from the spec, not from raster.rs.
 */
function css(fn: string, a: number, c: Rgb): Rgb {
  const apply = (m: number[][], t = 0): Rgb =>
    [0, 1, 2].map((i) => Math.min(1, Math.max(0, m[i]![0]! * c[0] + m[i]![1]! * c[1] + m[i]![2]! * c[2] + t))) as Rgb;
  const diag = (k: number) => [[k, 0, 0], [0, k, 0], [0, 0, k]];
  const g = 1 - Math.min(1, a);
  switch (fn) {
    case "brightness": return apply(diag(a));
    case "contrast": return apply(diag(a), 0.5 - 0.5 * a);
    case "invert": return apply(diag(1 - 2 * a), a);
    case "grayscale":
      return apply([
        [0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g],
        [0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g],
        [0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g],
      ]);
    case "sepia":
      return apply([
        [0.393 + 0.607 * g, 0.769 - 0.769 * g, 0.189 - 0.189 * g],
        [0.349 - 0.349 * g, 0.686 + 0.314 * g, 0.168 - 0.168 * g],
        [0.272 - 0.272 * g, 0.534 - 0.534 * g, 0.131 + 0.869 * g],
      ]);
    case "saturate":
      return apply([
        [0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a],
        [0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a],
        [0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a],
      ]);
    case "hue-rotate": {
      const k = Math.cos((a * Math.PI) / 180);
      const s = Math.sin((a * Math.PI) / 180);
      return apply([
        [0.213 + 0.787 * k - 0.213 * s, 0.715 - 0.715 * k - 0.715 * s, 0.072 - 0.072 * k + 0.928 * s],
        [0.213 - 0.213 * k + 0.143 * s, 0.715 + 0.285 * k + 0.14 * s, 0.072 - 0.072 * k - 0.283 * s],
        [0.213 - 0.213 * k - 0.787 * s, 0.715 - 0.715 * k + 0.715 * s, 0.072 + 0.928 * k + 0.072 * s],
      ]);
    }
  }
  throw new Error(fn);
}

/** `filters` in order on an 8-bit colour: 0..255, unrounded. */
const filtered = (filters: Array<[string, number]>, rgb: Rgb): Rgb => {
  let c = rgb.map((v) => v / 255) as Rgb;
  for (const [fn, a] of filters) c = css(fn, a, c);
  return c.map((v) => v * 255) as Rgb;
};

/**
 * How far the frame may land from the exact value, in levels: the core's
 * half-level rounding and its 1/16384 coefficients (the core measured
 * 0.505), and for a hue its own sine polynomial.
 */
const TOLERANCE = 0.6;

let c: ResolvedComposition;
const box = new Map<string, { x: number; y: number; w: number; h: number }>();
/** The frames the tests read, rendered once in order: a world only moves forward. */
const FRAMES = [0, 12, 14, 29] as const;
const rendered = new Map<number, Uint8Array>();
const frame = (f: (typeof FRAMES)[number]): Uint8Array => rendered.get(f)!;

const px = (fb: Uint8Array, x: number, y: number): Rgb => {
  const i = (y * c.width + x) * 4;
  return [fb[i]!, fb[i + 1]!, fb[i + 2]!];
};

/** Points inside a 100x120 card, clear of its rounded corners: the
 *  gradient's red, green and blue thirds, and the white disc at its centre. */
const POINTS: Array<[number, number]> = [[15, 60], [50, 20], [85, 60], [50, 104], [50, 60]];

/** The card `name`'s pixel at a point, beside the reference card's. */
function pair(fb: Uint8Array, name: string, [dx, dy]: [number, number]): { got: Rgb; ref: Rgb } {
  const b = box.get(name)!;
  const r = box.get("ref")!;
  return { got: px(fb, b.x + dx, b.y + dy), ref: px(fb, r.x + dx, r.y + dy) };
}

function expectCss(fb: Uint8Array, name: string, filters: Array<[string, number]>): void {
  for (const point of POINTS) {
    const { got, ref } = pair(fb, name, point);
    const want = filtered(filters, ref);
    for (let ch = 0; ch < 3; ch++) {
      expect(Math.abs(got[ch]! - want[ch]!), `${name} at ${point}: ${got}, CSS ${want.map((v) => v.toFixed(2))} of ${ref}`).toBeLessThanOrEqual(TOLERANCE);
    }
  }
}

function findNamed(tree: unknown, name: string): number {
  const walk = (n: { i: number; n?: string; k?: unknown[] } | undefined): number | undefined => {
    if (!n) return undefined;
    if (n.n === name) return n.i;
    for (const kid of n.k ?? []) {
      const hit = walk(kid as typeof n);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  const id = walk(tree as never);
  if (id === undefined) throw new Error(`no node named ${name}`);
  return id;
}

beforeAll(async () => {
  const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error("colour-filters did not resolve");
  await runBuild(resolved.value);
  const built = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: true });
  if (!built.ok) throw new Error(built.message);
  c = built.value;
  const world: BootedWorld = await hardenedBootWorld({
    bundlePath: c.bundlePath,
    pakPath: c.pakPath,
    width: c.width,
    height: c.height,
    hz: c.fps,
    renderScale: c.supersample,
    shutter: null,
    buildCommand: c.buildCommand,
  });
  // getTree consumes the mount frame; the world is then at frame 0.
  const tree = world.getTree();
  const prober: Prober = openProber(world, { classify: false });
  for (const name of ["ref", "brightness", "contrast", "grayscale", "hue-rotate", "invert", "saturate", "sepia", "colour-in", "flash", "hue-cycle", "clamped", "glow-kept"]) {
    const { xy, wh } = rect(prober, findNamed(tree, name));
    box.set(name, { x: xy & 0xffff, y: xy >>> 16, w: wh & 0xffff, h: wh >>> 16 });
  }
  prober.inspect(0);
  // Fold the world forward frame by frame (seekFrame's transaction).
  let at = 0;
  for (const f of FRAMES) {
    for (; at < f; at++) {
      world.frame(0);
      for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
    }
    rendered.set(f, Uint8Array.from(world.render()));
  }
}, 300_000);

describe("the Tailwind steps are CSS's amounts", () => {
  test("each card is its CSS function of the reference card, the white disc included", () => {
    const fb = frame(0);
    expectCss(fb, "brightness", [["brightness", 1.5]]);
    expectCss(fb, "contrast", [["contrast", 2]]);
    expectCss(fb, "grayscale", [["grayscale", 1]]);
    expectCss(fb, "hue-rotate", [["hue-rotate", 90]]);
    expectCss(fb, "invert", [["invert", 1]]);
    expectCss(fb, "saturate", [["saturate", 2]]);
    expectCss(fb, "sepia", [["sepia", 1]]);
    // brightness then contrast, clamped between: brightness(2) whitens the
    // disc and most of the gradient, contrast(0.5) then halves toward grey.
    expectCss(fb, "clamped", [["brightness", 2], ["contrast", 0.5]]);
  });

  test("a greyed node's glow is made from its alpha and keeps its own colour", () => {
    const fb = frame(0);
    const b = box.get("glow-kept")!;
    const centre = px(fb, b.x + 45, b.y + 45);
    // #f97316's luminance, 0.2126 * 249 + 0.7152 * 115 + 0.0722 * 22.
    for (const v of centre) expect(Math.abs(v - 136.8)).toBeLessThanOrEqual(TOLERANCE);
    // 6 px outside the disc the cyan halo shows over the slate ground; a
    // greyed halo would leave green and blue no further above red than the
    // ground's own 8 and 27.
    const [r, g, bl] = px(fb, b.x - 6, b.y + 45);
    expect(g - r, `halo ${[r, g, bl]}`).toBeGreaterThan(40);
    expect(bl - r, `halo ${[r, g, bl]}`).toBeGreaterThan(40);
  });
});

describe("the three animations the task names", () => {
  // 30 fps: frame f shows the clock (f + 1) * 2 - 1.
  const region = (fb: Uint8Array, name: string): number[] => {
    const b = box.get(name)!;
    const out: number[] = [];
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out.push(...px(fb, x, y));
    return out;
  };
  const spread = (fb: Uint8Array, name: string): number =>
    Math.max(...POINTS.map((p) => { const { got } = pair(fb, name, p); return Math.max(...got) - Math.min(...got); }));

  test("grey to colour: nearly grey on the first frame, the plain card once it lands", () => {
    const first = frame(0);
    const refSpread = Math.max(...POINTS.map((p) => { const { ref } = pair(first, "ref", p); return Math.max(...ref) - Math.min(...ref); }));
    expect(spread(first, "colour-in")).toBeLessThan(refSpread / 4);
    const last = frame(29);
    // grayscale(0) is identity: no layer, so the card is the reference's bytes.
    expect(region(last, "colour-in")).toEqual(region(last, "ref"));
  });

  test("a hue cycle: the frame shows hue-rotate at the angle its tick reached", () => {
    // 1000 ms linear from 0 to a full turn is 6 degrees a tick; frame 14
    // shows clock 29.
    expectCss(frame(14), "hue-cycle", [["hue-rotate", 174]]);
  });

  test("a brightness flash: the plain card before its delay and after it, brighter between", () => {
    const sum = (fb: Uint8Array, name: string) => POINTS.reduce((s, p) => s + pair(fb, name, p).got.reduce((a, v) => a + v, 0), 0);
    const before = frame(0);
    expect(region(before, "flash")).toEqual(region(before, "ref"));
    // 200 ms delay, peak at 40 % of 600 ms: clock 26.4; frame 12 shows 25.
    const peak = frame(12);
    expect(sum(peak, "flash")).toBeGreaterThan(sum(peak, "ref") * 1.4);
    const after = frame(29);
    expect(region(after, "flash")).toEqual(region(after, "ref"));
  });
});

describe("the host reads the new props by name", () => {
  test("keyframes names the colour filter tracks the pak carries", async () => {
    const report = await readTimelines({ pakPath: c.pakPath, fps: c.fps, durationFrames: c.durationFrames, tickHz: TICKS_PER_SECOND });
    const props = new Set(report!.timelines.flatMap((t) => [...t.props]));
    expect([...props].sort()).toEqual(["brightness", "grayscale", "hueRotate"]);
  });
});
