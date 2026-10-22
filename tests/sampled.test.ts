/**
 * `src/anim/sampled.ts`: generator-side motion baked as linear keyframes.
 *
 * The three guards are the defects that reached a film before the module had
 * them (compositions/mg-hud and compositions/mg-bauhaus):
 *
 * - `El.path` after `set(t0, …)` re-keyed `t0 - 1` with the state AFTER the
 *   change, so a banner meant to appear at 6.5 s faded in from frame 0;
 * - `Reg.window(from, until)` with `until <= from` crossed its step keys and
 *   baked a ramp from tick 0, so four cells of a drop wave faded in from the
 *   first frame;
 * - more than 255 segments in one track fails the build two steps later.
 */

import { describe, expect, test } from "bun:test";

import { bezier, decodeSeq, echo, El, glyphCell, MAX_KEYS, Reg, rng, stateAt } from "../src/anim/sampled.ts";

const reg = () => new Reg(600, 10_000);
const opacityAt = (r: Reg, entry: string, t: number) => {
  const stops = r.keyframes[entry.split(" ")[0]!]!;
  return stops[r.pct(t)]?.opacity;
};

describe("El", () => {
  test("path after set keeps the state before the change at t0 - 1", () => {
    const r = reg();
    const el = new El(r, { x: 0, y: 0, w: 10, h: 10 }, { op: 0, sx: 1.1, sy: 1.1 });
    el.set(392, { op: 1 }).path(392, 400, (t) => ({ sx: 1 + 0.1 * (1 - (t - 392) / 8), sy: 1 }));
    expect(el.keys.get(391)!.op).toBe(0);
    expect(el.keys.get(392)!.op).toBe(1);
    // and baked: nothing between tick 0 and tick 391 shows it
    const entry = el.entry();
    expect(opacityAt(r, entry, 391)).toBe("0");
    expect(opacityAt(r, entry, 392)).toBe("1");
  });

  test("path on its own still holds the previous state until it starts", () => {
    const el = new El(reg(), { x: 0, y: 0, w: 10, h: 10 }, { cx: 5, cy: 5 });
    el.path(100, 110, (t) => ({ cx: 5 + (t - 100) }));
    expect(el.keys.get(99)!.cx).toBe(5);
    expect(el.keys.get(110)!.cx).toBe(15);
  });

  test("orbit lands on the exact arc and turns the element with it", () => {
    const el = new El(reg(), { x: 90, y: -10, w: 20, h: 20 }); // centre (100, 0)
    el.orbit(0, 30, 0, 0, 90);
    const s = el.keys.get(30)!;
    expect(s.cx).toBeCloseTo(0, 9);
    expect(s.cy).toBeCloseTo(100, 9);
    expect(s.rot).toBe(90);
  });

  test("entry refuses a track the baker cannot hold", () => {
    const el = new El(reg(), { x: 0, y: 0, w: 10, h: 10 });
    el.to(0, 599, { cx: 1000 }, (u) => u * u);
    expect(() => el.entry()).toThrow(/255 segments/);
  });
});

describe("Reg", () => {
  test("window refuses an empty or inverted window instead of baking a ramp", () => {
    const r = reg();
    expect(() => r.window(480, 480)).toThrow(/empty or inverted/);
    expect(() => r.window(484, 480)).toThrow(/empty or inverted/);
    const entry = r.window(479, 480);
    expect(opacityAt(r, entry, 478)).toBe("0");
    expect(opacityAt(r, entry, 479)).toBe("1");
    expect(opacityAt(r, entry, 480)).toBe("0");
  });

  test("step refuses changes that do not strictly increase", () => {
    expect(() => reg().step("opacity", [[0, "0"], [10, "1"], [10, "0"]])).toThrow(/does not follow/);
    expect(() => reg().step("opacity", [[0, "0"], [10, "1"], [9, "0"]])).toThrow(/does not follow/);
  });

  test("prop refuses more keys than a track holds", () => {
    const keys = Array.from({ length: MAX_KEYS + 1 }, (_, i) => [i, String(i)] as [number, string]);
    expect(() => reg().prop("opacity", keys)).toThrow(/255 segments/);
    expect(() => reg().prop("opacity", keys.slice(0, MAX_KEYS))).not.toThrow();
  });
});

describe("helpers", () => {
  test("bezier: exact ends, the symmetric curve's midpoint, and monotonic", () => {
    const e = bezier(0.42, 0, 0.58, 1);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    expect(e(0.5)).toBeCloseTo(0.5, 9);
    const snap = bezier(0.16, 1, 0.3, 1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = snap(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // fast out: most of the way there in the first fifth
    expect(snap(0.2)).toBeGreaterThan(0.75);
  });

  test("stateAt interpolates keys the way the core does, linearly", () => {
    const el = new El(reg(), { x: 0, y: 0, w: 0, h: 0 }, { cx: 0 });
    el.set(10, { cx: 0 }).set(20, { cx: 100 });
    el.keys.set(30, { ...el.keys.get(20)!, cx: 200 });
    expect(stateAt(el, 25).cx).toBe(150);
    expect(stateAt(el, 1000).cx).toBe(200);
  });

  test("echo trails by its lag inside its spans and is invisible outside them", () => {
    const r = reg();
    const el = new El(r, { x: 0, y: 0, w: 10, h: 10 }, { cx: 0 });
    el.to(100, 120, { cx: 200 }, (u) => u);
    const g = echo(el, 4, 0.5, [[100, 120]]);
    expect(stateAt(g, 110).cx).toBeCloseTo(stateAt(el, 106).cx, 9);
    expect(stateAt(g, 110).op).toBe(0.5);
    expect(stateAt(g, 90).op).toBe(0);
    expect(stateAt(g, 200).op).toBe(0);
  });
});

describe("glyphCell", () => {
  /** Each glyph's opacity at tick t, read off its baked track the way the core plays it (linear between stops). */
  const lit = (r: Reg, html: string, t: number) => {
    const out: string[] = [];
    for (const m of html.matchAll(/animate-(\w+)">(.)<\/View>/g)) {
      const film = r.animation[m[1]!]!.split(" ")[0]!;
      const stops = Object.entries(r.keyframes[film]!).map(([p, v]) => [(parseFloat(p) / 100) * r.ticks, Number(v.opacity)] as [number, number]);
      stops.sort((a, b) => a[0] - b[0]);
      let v = stops[0]![1];
      for (let i = 0; i + 1 < stops.length; i++) {
        const [a, va] = stops[i]!;
        const [z, vz] = stops[i + 1]!;
        if (t >= a && t <= z) v = z === a ? vz : va + ((vz - va) * (t - a)) / (z - a);
      }
      if (t > stops[stops.length - 1]![0]) v = stops[stops.length - 1]![1];
      if (v > 0.5) out.push(m[2]!);
    }
    return out;
  };

  test("is dark before its first change and shows exactly one glyph at every tick after", () => {
    const r = reg();
    const seq = decodeSeq("Z", "ABC", 100, 5, rng(3));
    const html = glyphCell(r, seq, (g) => g, 20, 30);
    for (let t = 0; t < 100; t++) expect(lit(r, html, t)).toEqual([]);
    for (let t = 100; t <= 600; t++) {
      const want = [...seq].reverse().find(([k]) => k <= t)![1];
      expect(lit(r, html, t)).toEqual([want]);
    }
    expect(lit(r, html, 110)).toEqual(["Z"]);
  });

  test("a later change on the same tick wins, and a change back in time is refused", () => {
    const r = reg();
    const html = glyphCell(r, [[10, "A"], [20, "B"], [20, "C"]], (g) => g, 20, 30);
    expect(lit(r, html, 25)).toEqual(["C"]);
    expect(() => glyphCell(reg(), [[10, "A"], [5, "B"]], (g) => g, 20, 30)).toThrow(/forward in time/);
  });
});

