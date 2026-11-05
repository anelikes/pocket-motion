/**
 * Three path primitives, from the compiler and the kit to the picture: dashes
 * (patches/0045), a morph between keys drawn separately (patches/0046) and
 * motion along a path (`src/anim/path-motion.ts`).
 *
 * The dash geometry — where the pattern puts each dash, the dots, the join
 * over a closed start, trim revealing dashes without moving them — is held in
 * the core (`engine/core/src/path_tests.rs`, each test red under an edit
 * `baselines/path-primitives/redcheck.py` makes). What this file holds:
 *
 *   - the tokens and keyframe names reach the props they name, and a pattern
 *     the core would draw solid is refused at the token;
 *   - equalisation keeps every key's outline, gives the same outline written
 *     another way an identity morph, and leaves keys that already line up
 *     the bytes 0043 baked; its bytes are pinned, and this suite runs on
 *     Linux/x86-64 in the determinism workflow;
 *   - the kit's angle, its keys and its chord error;
 *   - `compositions/path-primitives`, built: movers on their outlines at the
 *     frames `layout` reads, dashes and gaps where the pattern says in the
 *     pixels, marching that repeats on its period, the sidecar's assertions.
 *
 * Each test names the edit that turns it red; `redcheck-ts.ts` beside the
 * core script makes those edits.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import { PathFollower, atan2Deg, keyTicks, motionPath, unwrapDegrees } from "../src/anim/path-motion.ts";
import { bezier } from "../src/anim/sampled.ts";
import { runBuild } from "../src/cli/build.ts";
import { run as runAssert } from "../src/cli/commands/assert.ts";
import { run as runCheck } from "../src/cli/commands/check.ts";
import { run as runLayout } from "../src/cli/commands/layout.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { EXIT_OK } from "../src/cli/types.ts";
import { WasmFrameSource } from "../src/runtime/frame-source.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const DIR = join(ROOT, "compositions", "path-primitives");
process.env.POCKETJS_ROOT = VENDOR;

interface Entry {
  verbs: number[];
  shapes: number[][];
}
// Computed specifiers, as the catalogue gates do: `vendor/` does not
// typecheck under this repository's settings.
const pathData = (await import(`${VENDOR}/framework/compiler/path-data.ts`)) as {
  compilePathEntry(keys: readonly string[], viewBox?: string): Entry;
};
const tailwind = (await import(`${VENDOR}/framework/compiler/tailwind.ts`)) as {
  parseClassLiteral(literal: string): { base: Array<{ prop: number; value: number }> } | null;
};
const animation = (await import(`${VENDOR}/framework/compiler/animation.ts`)) as {
  registerAnimationTheme(theme: unknown): void;
  bakedTimelines(): Array<{ tracks: Array<{ prop: number }> }>;
};
const spec = (await import(`${VENDOR}/contracts/spec/spec.ts`)) as {
  PROP: Record<"dashCount" | "dash0" | "dash1" | "dash2" | "dashOffset", number>;
};
const { PROP } = spec;

const f32 = (bits: number): number => new Float32Array(new Uint32Array([bits]).buffer)[0]!;

// The fixture's outlines, as main.tsx writes them.
const MAIN = await Bun.file(join(DIR, "main.tsx")).text();
const CONFIG = await Bun.file(join(DIR, "pocket.config.ts")).text();
function literal(src: string, name: string): string {
  const m = new RegExp(`const ${name} =\\s*((?:"[^"]*"\\s*\\+?\\s*)+);`).exec(src);
  if (!m) throw new Error(`no const ${name}`);
  return [...m[1]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
}
const ROUTE = literal(MAIN, "ROUTE");
const ORBIT = literal(MAIN, "ORBIT");
const KEYS = {
  playPause: [literal(MAIN, "PLAY"), literal(MAIN, "PAUSE")],
  heartStar: [literal(MAIN, "HEART"), literal(MAIN, "STAR")],
  ringSquare: [literal(MAIN, "RING"), literal(MAIN, "SQUARE")],
};

// ---- dashes: the declaration ---------------------------------------------------------

describe("dashes: the tokens and keyframe names reach their props", () => {
  const props = (lit: string): Map<number, number> | null => {
    const r = tailwind.parseClassLiteral(lit);
    return r ? new Map(r.base.map((p) => [p.prop, p.value])) : null;
  };

  test("stroke-dash-[..] sets the count and the lengths; stroke-dash-offset-[..] the offset", () => {
    // Red with the dash branch removed from parsePathUtility: the generic
    // `stroke-` branch reads `dash-[12_8]` as a colour and the literal fails.
    const p = props("stroke-dash-[12_8] stroke-dash-offset-[-4.5]")!;
    expect(p.get(PROP.dashCount)).toBe(2);
    expect(f32(p.get(PROP.dash0)!)).toBe(12);
    expect(f32(p.get(PROP.dash1)!)).toBe(8);
    expect(f32(p.get(PROP.dashOffset)!)).toBe(-4.5);
    const q = props("stroke-dash-[0,16,4]")!;
    expect(q.get(PROP.dashCount)).toBe(3);
    expect([q.get(PROP.dash0), q.get(PROP.dash1), q.get(PROP.dash2)].map((v) => f32(v!))).toEqual([0, 16, 4]);
    expect(props("stroke-dash-none")!.get(PROP.dashCount)).toBe(0);
  });

  test("a pattern the core would draw solid does not parse", () => {
    // More than four lengths, a negative one, all zero, none: each would be
    // a solid stroke under a class that says dashed. Red with the
    // `lens.some((v) => v > 0)` check removed (all zero then parses).
    for (const bad of ["stroke-dash-[1_2_3_4_5]", "stroke-dash-[-1_2]", "stroke-dash-[0_0]", "stroke-dash-[]", "stroke-dash-[a_b]", "stroke-dash-offset-[x]"]) {
      expect(props(`fill-none ${bad}`)).toBeNull();
    }
  });

  test("dashOffset, strokeDashoffset and stroke-dashoffset are keyframe names for the offset", () => {
    // Red with the two names removed from animation.ts's property table.
    for (const name of ["dashOffset", "strokeDashoffset", "stroke-dashoffset"]) {
      animation.registerAnimationTheme({ keyframes: { k: { from: { [name]: "0" }, to: { [name]: "-20" } } }, animation: { k: "k 1000ms linear infinite" } });
      try {
        const rec = tailwind.parseClassLiteral("animate-k") as unknown as { animation: { anims: number[] } };
        const tl = animation.bakedTimelines()[rec.animation.anims[0]!]!;
        expect(tl.tracks.map((t) => t.prop)).toEqual([PROP.dashOffset]);
      } finally {
        animation.registerAnimationTheme(undefined);
      }
    }
  });
});

// ---- morph equalisation ------------------------------------------------------------------

type Pt = [number, number];

/** The outline of one key as cubics: [start, c1, c2, end] each. */
function cubicsOf(e: Entry, key: number): Pt[][] {
  const pts = e.shapes[key]!;
  const out: Pt[][] = [];
  let k = 0;
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  for (const v of e.verbs) {
    if (v === 0) {
      cur = start = [pts[k]!, pts[k + 1]!];
      k += 2;
    } else if (v === 1) {
      const p: Pt = [pts[k]!, pts[k + 1]!];
      out.push([cur, cur, p, p]);
      cur = p;
      k += 2;
    } else if (v === 2) {
      const c: Pt[] = [cur, [pts[k]!, pts[k + 1]!], [pts[k + 2]!, pts[k + 3]!], [pts[k + 4]!, pts[k + 5]!]];
      out.push(c);
      cur = c[3]!;
      k += 6;
    } else {
      if (cur[0] !== start[0] || cur[1] !== start[1]) out.push([cur, cur, start, start]);
      cur = start;
    }
  }
  return out;
}
const at = (c: Pt[], t: number): Pt => {
  const m = 1 - t;
  const w = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t];
  return [w.reduce((s, wi, i) => s + wi * c[i]![0], 0), w.reduce((s, wi, i) => s + wi * c[i]![1], 0)];
};
/** Distance from p to the outline, by dense sampling (2048 a cubic). */
function distTo(cubics: Pt[][], p: Pt): number {
  let best = Infinity;
  for (const c of cubics) {
    let prev = at(c, 0);
    for (let i = 1; i <= 2048; i++) {
      const q = at(c, i / 2048);
      const [dx, dy] = [q[0] - prev[0], q[1] - prev[1]];
      const l2 = dx * dx + dy * dy;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dy) / l2)) : 0;
      const [x, y] = [prev[0] + dx * u - p[0], prev[1] + dy * u - p[1]];
      best = Math.min(best, Math.sqrt(x * x + y * y));
      prev = q;
    }
  }
  return best;
}

describe("a morph between keys drawn separately (patches/0046)", () => {
  test("keys that already line up bake the bytes 0043 baked", () => {
    // Recorded from the pin with 0001-0043 and 0050 applied, before 0046:
    // the fixture vector-paths' two morphs and a line/cubic promotion. Red
    // with alignByCommands skipped (every key set then equalised).
    const BLOB_CIRCLE =
      "M160 20 C197.1 20 232.7 34.7 259 61 C285.3 87.3 300 122.9 300 160 C300 197.1 285.3 232.7 259 259 C232.7 285.3 197.1 300 160 300 C122.9 300 87.3 285.3 61 259 C34.7 232.7 20 197.1 20 160 C20 122.9 34.7 87.3 61 61 C87.3 34.7 122.9 20 160 20 Z";
    const BLOB_STAR =
      "M160 10 C180 10 182.6 80.8 210.9 109.1 C239.2 137.4 310 140 310 160 C310 180 239.2 182.6 210.9 210.9 C182.6 239.2 180 310 160 310 C140 310 137.4 239.2 109.1 210.9 C80.8 182.6 10 180 10 160 C10 140 80.8 137.4 109.1 109.1 C137.4 80.8 140 10 160 10 Z";
    const WAVE_UP = "M-250 150 C-100 40 50 260 200 150 S500 40 650 150 L650 300 L-250 300 Z";
    const WAVE_DOWN = "M-250 150 C-100 260 50 40 200 150 S500 260 650 150 L650 300 L-250 300 Z";
    const SQ_LINE = "M0 0 L10 0 L10 10 L0 10 Z";
    const SQ_CUBIC = "M0 0 C3 0 7 0 10 0 L10 10 C7 10 3 10 0 10 Z";
    const digest = (keys: string[]): string => createHash("sha256").update(JSON.stringify(pathData.compilePathEntry(keys))).digest("hex");
    expect(digest([BLOB_CIRCLE, BLOB_STAR])).toBe("d82c552d8fb4cc8ce583a5f82f7d2c9af497be33d7dcff817e2e9641e2ea83f9");
    expect(digest([WAVE_UP, WAVE_DOWN])).toBe("0e601b239f270bfc12ca20d700d3d9657fc148f78ea5ee7d082514b1c29c34e7");
    expect(digest([SQ_LINE, SQ_CUBIC, SQ_LINE])).toBe("7321c0f339ce6615aaea3c5e55351659e28d03f22724428592f0de5696c4b4dc");
  });

  test("every key keeps its outline: each of its points on the curve it was written as, each written vertex kept", () => {
    // Red with `split` taking its second half from the wrong control
    // points, or `resample` emitting a nowhere-cubic where a split belongs.
    for (const [name, keys] of Object.entries(KEYS)) {
      const e = pathData.compilePathEntry(keys);
      expect(new Set(e.shapes.map((s) => s.length)).size).toBe(1);
      keys.forEach((d, k) => {
        const original = cubicsOf(pathData.compilePathEntry([d]), 0);
        // A slot this key has no partner for is a point that draws nothing
        // (no area to fill, no length to stroke): it is not part of the outline.
        const eq = cubicsOf(e, k).filter((c) => !c.every((q) => q[0] === c[0]![0] && q[1] === c[0]![1]) || distTo(original, c[0]!) < 1e-3);
        let worst = 0;
        for (const c of eq) for (const t of [0, 0.25, 0.5, 0.75, 1]) worst = Math.max(worst, distTo(original, at(c, t)));
        expect({ name, key: k, worst: worst < 1e-3 }).toEqual({ name, key: k, worst: true });
        const ends = new Set(eq.map((c) => `${Math.fround(c[3]![0])},${Math.fround(c[3]![1])}`));
        for (const c of original) expect(ends.has(`${Math.fround(c[3]![0])},${Math.fround(c[3]![1])}`)).toBe(true);
      });
    }
  });

  test("one outline written another way morphs to itself", () => {
    // Started at another corner with an edge split, wound the other way, its
    // two subpaths in the other order: each pair of keys must equalise to
    // the same points, so every frame of the morph is the same picture.
    // Red with the start search, the winding rule or the pairing by size
    // removed (the morph then turns, flips or swaps).
    const SQ = "M0 0 L10 0 L10 10 L0 10 Z";
    const cases: [string, string][] = [
      [SQ, "M10 10 L5 10 L0 10 L0 0 L10 0 Z"],
      [SQ, "M0 0 L0 10 L5 10 L10 10 L10 0 Z"],
      ["M0 0 H40 V40 H0 Z M60 0 H70 V10 H60 Z", "M60 0 H70 V10 H65 V10 H60 Z M0 0 H40 V40 H0 Z"],
    ];
    for (const [a, b] of cases) {
      const e = pathData.compilePathEntry([a, b]);
      const diff = Math.max(...e.shapes[0]!.map((v, i) => Math.abs(v - e.shapes[1]![i]!)));
      expect({ a, b, diff }).toEqual({ a, b, diff: 0 });
    }
  });

  test("a subpath with no partner is a point at the centre of its own box", () => {
    // The ring's hole has no partner in the square: key 1's second slot is
    // every point at (50, 50), where the hole closes. Red with the point
    // put at the origin.
    const e = pathData.compilePathEntry(KEYS.ringSquare);
    const slot2 = e.verbs.lastIndexOf(0);
    let k = 0;
    for (let i = 0; i < slot2; i++) k += e.verbs[i] === 0 ? 2 : e.verbs[i] === 2 ? 6 : 0;
    const rest = e.shapes[1]!.slice(k);
    expect(rest.length).toBeGreaterThan(2);
    expect(rest.every((v) => v === 50)).toBe(true);
  });

  test("the bytes are pinned, and nothing reaches the host's trigonometry", () => {
    // Every key set the fixture bakes, by sha256 of the entry. This suite
    // runs on Linux/x86-64 in the determinism workflow, so a host whose
    // arithmetic moved a bit would fail here. And Math.sin/cos/tan/atan2/
    // pow/exp/log stubbed to throw: equalisation and the arc conversion use
    // none of them.
    const banned = ["sin", "cos", "tan", "atan", "atan2", "asin", "acos", "pow", "exp", "log", "hypot", "cbrt"] as const;
    const saved = banned.map((n) => (Math as unknown as Record<string, unknown>)[n]);
    for (const n of banned) (Math as unknown as Record<string, unknown>)[n] = () => {
      throw new Error(`Math.${n} called`);
    };
    let digests: string[];
    try {
      digests = Object.values(KEYS).map((keys) => createHash("sha256").update(JSON.stringify(pathData.compilePathEntry(keys, "0 0 100 100"))).digest("hex"));
      new PathFollower(ROUTE).at(0.5);
      motionPath({ d: ORBIT, durationMs: 2400, rotate: true });
    } finally {
      banned.forEach((n, i) => ((Math as unknown as Record<string, unknown>)[n] = saved[i]));
    }
    expect(digests).toEqual(PINNED_MORPHS);
  });
});

/** sha256 of each fixture morph's entry, recorded on darwin/arm64. */
const PINNED_MORPHS: string[] = [
  "5f1fe9725956b49413c68f0af4fa4fc781c8314d07bba9c8c98fc819acbda79f", // play -> pause
  "48cb749b0126cfc5fc116eff59265e258dd96d62d324534848ff84b08e980d40", // heart -> star
  "ee4f4a0863c2be612372c11b401adbf5449794d17eea81f5aee5b77ab406da4a", // ring -> square
];

// ---- motion along a path ---------------------------------------------------------------

describe("motion along a path (src/anim/path-motion.ts)", () => {
  test("atan2Deg: exact on the axes and diagonals, the host's angle elsewhere to 1e-12", () => {
    // Red with the octant reduction's `180 - deg` written `deg - 180`.
    const exact: [number, number, number][] = [[0, 1, 0], [1, 1, 45], [1, 0, 90], [1, -1, 135], [0, -1, 180], [-1, -1, -135], [-1, 0, -90], [-1, 1, -45], [0, 0, 0]];
    for (const [y, x, deg] of exact) expect(atan2Deg(y, x)).toBe(deg);
    for (let i = 0; i < 1000; i++) {
      const a = (i * 0.7853981) % 6.283;
      const [y, x] = [Math.sin(a) * (1 + i), Math.cos(a) * (1 + i)];
      expect(Math.abs(atan2Deg(y, x) - (Math.atan2(y, x) * 180) / Math.PI)).toBeLessThan(1e-12);
    }
  });

  test("a follower walks the outline a <Path> draws, by arc length, through the same viewBox", () => {
    const circle = new PathFollower("M100 0 A100 100 0 1 1 100 200 A100 100 0 1 1 100 0 Z");
    expect(Math.abs(circle.length - 2 * Math.PI * 100)).toBeLessThan(0.01);
    for (const [u, x, y, a] of [[0, 100, 0, 0], [0.25, 200, 100, 90], [0.5, 100, 200, 180], [0.75, 0, 100, -90]] as const) {
      const p = circle.at(u);
      expect([Math.abs(p.x - x) < 1e-9, Math.abs(p.y - y) < 1e-9, Math.abs(p.angle - a) < 1e-9]).toEqual([true, true, true]);
    }
    // In a 300x200 box at (40, 20) with viewBox 0 0 100 100: scale 2, meet,
    // centred across (50 px each side). Red with the centring left out.
    const placed = new PathFollower("M10 50 L90 50", { viewBox: "0 0 100 100", box: { x: 40, y: 20, w: 300, h: 200 } });
    expect(placed.at(0)).toEqual({ x: 110, y: 120, angle: 0 });
    expect(placed.length).toBeCloseTo(160, 9);
  });

  test("keys: tick 0, the odd ticks, the last; on the curve at every key; turns unwrapped", () => {
    // Red with keyTicks' phase 0 (even ticks, which a 30 fps frame never
    // shows) and with unwrapDegrees removed (a loop's angle jumps by 360
    // between two keys and the core turns the dart the long way round).
    expect(keyTicks(9, 2, 1)).toEqual([0, 1, 3, 5, 7, 9]);
    expect(keyTicks(8, 2, 1)).toEqual([0, 1, 3, 5, 7, 8]);
    expect(keyTicks(4, 1, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(unwrapDegrees([170, -170, -10, 100, -79])).toEqual([170, 190, 350, 460, 281]);
    const m = motionPath({ d: ORBIT, durationMs: 2400, rotate: true, node: { x: 0, y: 0, w: 28, h: 28 }, path: { box: { x: 480, y: 90, w: 400, h: 360 } } });
    const stops = Object.entries(m.keyframes);
    expect(stops.length).toBe(keyTicks(144, 2, 1).length);
    expect(stops.slice(0, 3).map(([pct]) => pct)).toEqual(["0%", `${(100 / 144).toFixed(4)}%`, `${(300 / 144).toFixed(4)}%`]);
    const rot = stops.map(([, v]) => parseFloat(v.rotate!));
    for (let i = 1; i < rot.length; i++) expect(Math.abs(rot[i]! - rot[i - 1]!)).toBeLessThan(180);
    expect(rot.at(-1)! - rot[0]!).toBeCloseTo(360, 6);
    // 7.4 px a tick round a curvature radius of at least 142 px: a 2-tick
    // chord's sagitta, (2 * 7.4)^2 / (8 * 142) = 0.19 px, at the even ticks
    // a 30 fps frame never shows.
    expect(m.chordError.atTicks).toBeLessThan(0.2);
    expect(m.value("orbit", { iterations: "infinite" })).toBe("orbit 2400ms linear 0ms infinite both");
  });

  test("the chord error the design note records: 2.19 px a key apart at 21 px a tick on a 100 px radius", () => {
    const CIRCLE = "M100 0 A100 100 0 1 1 100 200 A100 100 0 1 1 100 0 Z";
    const two = motionPath({ d: CIRCLE, durationMs: 500 }).chordError;
    const one = motionPath({ d: CIRCLE, durationMs: 500, every: 1 }).chordError;
    expect([two.atTicks.toFixed(2), two.betweenTicks.toFixed(2)]).toEqual(["2.19", "2.15"]);
    expect([one.atTicks < 1e-9, one.betweenTicks.toFixed(2)]).toEqual([true, "0.55"]);
  });

  test("the fixture samples the outlines main.tsx draws", () => {
    expect(literal(CONFIG, "ROUTE")).toBe(ROUTE);
    expect(literal(CONFIG, "ORBIT")).toBe(ORBIT);
  });
});

// ---- the fixture, built ------------------------------------------------------------------

describe("compositions/path-primitives", () => {
  let width = 0;
  async function readFrame(f: number): Promise<Uint8Array> {
    const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: true });
    if (!resolved.ok) throw new Error("path-primitives did not resolve");
    const c = resolved.value;
    width = c.width;
    const source = await WasmFrameSource.create({
      compositionId: c.compositionId,
      bundlePath: c.bundlePath,
      pakPath: c.pakPath,
      width: c.width,
      height: c.height,
      hz: c.fps,
      shutter: c.shutter,
      durationFrames: c.durationFrames,
      renderScale: c.supersample,
      buildCommand: c.buildCommand,
    });
    try {
      source.audit();
      await source.seekFrame(f);
      return Uint8Array.from(source.read());
    } finally {
      await source.dispose?.();
    }
  }
  const luma = (fb: Uint8Array, x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return (fb[i]! + fb[i + 1]! + fb[i + 2]!) / 3;
  };

  beforeAll(async () => {
    const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: false });
    if (!resolved.ok) throw new Error("path-primitives did not resolve");
    await runBuild(resolved.value);
  }, 300_000);

  test("the dart and the dot sit on the route, and the orbiter on its ellipse, at the frames layout reads", async () => {
    // Frame f shows the clock 2f + 1 at 30 fps; fly starts 24 ticks in,
    // trail 48, orbit at 0 and loops every 144. A mover keyed in the wrong
    // space (the route's box, not its quadrant), or keyed on even ticks,
    // is off by its box or by a chord here. The box is layout's, rounded to
    // the pixel; the tolerance is that rounding.
    const route = new PathFollower(ROUTE);
    const orbit = new PathFollower(ORBIT, { box: { x: 480, y: 90, w: 400, h: 360 } });
    const swoop = bezier(0.65, 0, 0.35, 1);
    const off: string[] = [];
    for (const f of [0, 20, 37, 55, 80, 100, 149]) {
      const result = await runLayout({ dir: DIR, at: f, all: false, flags: { json: true } });
      expect(result.exitCode).toBe(EXIT_OK);
      const nodes = (result.json as { nodes: Array<{ name?: string; x: number; y: number; w: number; h: number }> }).nodes;
      const clock = 2 * f + 1;
      const want = (name: string, p: { x: number; y: number }, qx: number, qy: number): void => {
        const n = nodes.find((m) => m.name === name);
        if (!n) return void off.push(`${name} absent at frame ${f}`);
        const [cx, cy] = [n.x + n.w / 2 - qx, n.y + n.h / 2 - qy];
        if (Math.abs(cx - p.x) > 1 || Math.abs(cy - p.y) > 1) off.push(`${name} at frame ${f}: centre ${cx},${cy}, want ${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      };
      const u = (t: number, delay: number, ticks: number): number => swoop(Math.min(1, Math.max(0, (t - delay) / ticks)));
      want("trail", route.at(u(clock, 48, 216)), 0, 540);
      want("orbiter", orbit.at(((clock % 144) + 144) % 144 / 144), 960, 540);
      if (f === 0 || f === 149) want("dart", route.at(u(clock, 24, 216)), 0, 540);
    }
    expect(off).toEqual([]);
  }, 300_000);

  test("the dashed connector is dashes and gaps where the pattern puts them", async () => {
    // Row y = 130 of the connectors quadrant, x 280..680: [12, 8] from x 280,
    // so lit 280..292, 300..312 … and dark between. Red with the walk
    // passing no pattern (one solid line) or the phase run backward.
    const fb = await readFrame(0);
    let wrong = 0;
    for (let x = 282; x < 678; x++) {
      const p = (x - 280) % 20;
      if (p === 0 || p === 12 || p === 11 || p === 19) continue; // edges carry partial coverage
      const lit = luma(fb, x, 130) > 100;
      if (lit !== p < 12) wrong++;
    }
    expect(wrong).toBe(0);
  }, 300_000);

  test("the marching connector repeats on its period and moves inside it", async () => {
    // march runs the offset back 20 (one period) every 1000 ms: frames 30
    // apart are one picture there, frames 7 apart are not.
    const [a, b, c] = [await readFrame(10), await readFrame(40), await readFrame(17)];
    const region = (fb: Uint8Array): number[] => {
      const out: number[] = [];
      // Right of the selection (x < 602), which marches on 600 ms.
      for (let y = 180; y < 420; y += 3) for (let x = 606; x < 790; x += 3) out.push(luma(fb, x, y));
      return out;
    };
    expect(region(a)).toEqual(region(b));
    expect(region(a)).not.toEqual(region(c));
  }, 300_000);

  test("the sidecar's assertions hold and the realm issues no op", async () => {
    const assert = await runAssert({ dir: DIR, samples: 24, flags: { json: true } });
    const json = assert.json as { assertions: Array<{ node: string; ok: boolean }>; failures: string[] };
    expect(json.failures).toEqual([]);
    expect(assert.exitCode).toBe(EXIT_OK);
    const check = await runCheck({ dir: DIR, flags: { json: true } });
    expect(check.exitCode).toBe(EXIT_OK);
  }, 300_000);
});
