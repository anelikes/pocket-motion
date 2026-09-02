/**
 * Build-time line breaking.
 *
 * The failure mode is not a crash. A wrapper that overshoots by one segment
 * produces a composition that renders, looks right at the width it was authored
 * for, and pushes a word past the box at some other width — which is exactly the
 * bug the module was written to remove. So the tests here are sweeps rather than
 * examples: every size against every width, asserting the two properties that
 * make the approach worth anything at all — no line is wider than the box, and
 * nothing is dropped.
 *
 * `measure` is synthetic, so none of this needs a world. `scripts/fit-probe.ts`
 * is where it is checked against the real advance table and rendered pixels.
 */

import { describe, expect, test } from "bun:test";
import {
  cachedWidth,
  fitToBox,
  glyphCount,
  segments,
  wrap,
  wrapLines,
  type Measure,
} from "../src/text/fit.ts";

/** Latin 10px, CJK 20px — the proportions that matter, without a font. */
const measure: Measure = (s) =>
  [...s].reduce((a, c) => a + (c.codePointAt(0)! > 0x2e80 ? 20 : 10), 0);

const EN = "Deterministic video rendering. No browser, no headless Chrome, no screenshot loop.";
const ZH = "确定性视频渲染。没有浏览器，没有无头 Chrome，也没有截图循环。";

const widest = (lines: readonly string[]): number => Math.max(...lines.map(measure), 0);
const flat = (s: string): string => s.replace(/\s+/g, "");

/**
 * Losslessness, exactly: every line must sit LITERALLY at the running position
 * in the source, and the only characters a break may swallow are whitespace.
 *
 * The weaker check — strip all whitespace from both sides and compare — cannot
 * see a dropped space, and a dropped space is a real defect: it is a word join.
 * The 追い出し path did exactly that, turning `beta ，` into `beta，`, and passed
 * every losslessness assertion in this file until this predicate existed.
 */
function lossless(text: string, lines: readonly string[]): boolean {
  let i = 0;
  for (let k = 0; k < lines.length; k++) {
    if (k > 0) while (i < text.length && /\s/.test(text[i]!)) i++;
    if (!text.startsWith(lines[k]!, i)) return false;
    i += lines[k]!.length;
  }
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i === text.length;
}

/**
 * Texts shaped to reach the corners: a space before punctuation that may not
 * begin a line (which is what puts a separator in play across the push-down),
 * and paired punctuation that may not end one.
 */
const CORNERS = [
  "alpha beta ，gamma delta epsilon zeta",
  "one two ,three four five six seven eight",
  "把这个 词 ，还有下一个词往下赶，再来一点文字",
  "quoted «text» and （brackets） plus 「引号」 here",
  "a bb ccc dddd ,eeeee ffffff ggg hh i",
];

describe("no line is ever wider than the box", () => {
  for (const [label, text, locale] of [["latin", EN, "en"], ["cjk", ZH, "zh"]] as const) {
    test(label, () => {
      for (let w = 60; w <= 900; w += 10) {
        const lines = wrapLines(text, { maxWidth: w, measure, locale });
        expect({ w, widest: widest(lines) }).toEqual({ w, widest: expect.any(Number) });
        expect(widest(lines)).toBeLessThanOrEqual(w);
        expect(flat(lines.join(""))).toBe(flat(text));
      }
    });
  }
});

describe("balanced keeps every guarantee greedy gives", () => {
  for (const [label, text, locale] of [["latin", EN, "en"], ["cjk", ZH, "zh"]] as const) {
    test(label, () => {
      for (let w = 60; w <= 900; w += 10) {
        const lines = wrapLines(text, { maxWidth: w, measure, locale, strategy: "balanced" });
        expect(widest(lines)).toBeLessThanOrEqual(w);
        expect(flat(lines.join(""))).toBe(flat(text));
      }
    });
  }
});

test("balanced evens the lines greedy leaves lopsided", () => {
  const head = "Deterministic video rendering without a browser";
  const spread = (lines: readonly string[]): number =>
    Math.max(...lines.map(measure)) - Math.min(...lines.map(measure));

  let improved = 0;
  let worse = 0;
  for (let w = 300; w <= 900; w += 10) {
    const greedy = wrapLines(head, { maxWidth: w, measure, locale: "en" });
    const balanced = wrapLines(head, { maxWidth: w, measure, locale: "en", strategy: "balanced" });
    // Balancing must never buy evenness with an extra line.
    expect(balanced.length).toBe(greedy.length);
    const d = spread(balanced) - spread(greedy);
    if (d < 0) improved++;
    if (d > 0) worse++;
  }
  expect(improved).toBeGreaterThan(0);
  expect(worse).toBe(0);
});

describe("the 禁則 corners keep both invariants", () => {
  for (const strategy of ["greedy", "balanced"] as const) {
    test(strategy, () => {
      for (const text of CORNERS) {
        for (let w = 30; w <= 400; w += 5) {
          const lines = wrapLines(text, { maxWidth: w, measure, locale: "zh", strategy });
          // Not a space may be dropped, not just not a letter.
          expect({ text, w, ok: lossless(text, lines) }).toMatchObject({ ok: true });
          // Only a unit that cannot be broken at all may exceed the box.
          const over = lines.filter((l) => measure(l) > w && [...l].length > 1);
          expect({ text, w, over }).toMatchObject({ over: [] });
        }
      }
    });
  }
});

test("a box narrower than one glyph still wraps", () => {
  // `unitsOf` cannot make an item fit a box narrower than a single grapheme, so
  // the DP finds no legal line and used to walk off the front of its own array
  // — which returned the whole paragraph on one unwrapped line.
  for (const strategy of ["greedy", "balanced"] as const) {
    for (const w of [5, 10, 15]) {
      const lines = wrapLines("确定性", { maxWidth: w, measure, locale: "zh", strategy });
      expect({ strategy, w, lines }).toMatchObject({ lines: ["确", "定", "性"] });
    }
  }
});

test("a word wider than the box is broken by grapheme even mid-line", () => {
  // The first version guarded this on an empty line, so an over-long word that
  // was not first got flushed onto a line of its own and never broken.
  expect(wrapLines("aa bbbbbbbbbb", { maxWidth: 50, measure, locale: "en" })).toEqual([
    "aa",
    "bbbbb",
    "bbbbb",
  ]);
});

test("explicit newlines survive as hard breaks", () => {
  expect(wrapLines("one\ntwo", { maxWidth: 1000, measure, locale: "en" })).toEqual(["one", "two"]);
  expect(wrapLines("a\n\nb", { maxWidth: 1000, measure, locale: "en" })).toEqual(["a", "", "b"]);
});

test("text that already fits is returned untouched", () => {
  expect(wrap(EN, { maxWidth: 10_000, measure, locale: "en" })).toBe(EN);
});

test("the space a break consumes is not carried onto the next line", () => {
  const lines = wrapLines("aaa bbb", { maxWidth: 30, measure, locale: "en" });
  expect(lines).toEqual(["aaa", "bbb"]);
});

describe("the CJK line-start rule", () => {
  const bad = new Set([..."、。，．！？：；）］｝"]);
  const offenders = (lines: readonly string[]): number =>
    lines.filter((l) => l.length > 0 && bad.has([...l][0]!)).length;

  test("holds at every width the box leaves room for", () => {
    let naiveOffenders = 0;
    let yielded = 0;
    for (let w = 60; w <= 900; w += 10) {
      const off = wrapLines(ZH, { maxWidth: w, measure, locale: "zh", kinsoku: false });
      const on = wrapLines(ZH, { maxWidth: w, measure, locale: "zh" });
      naiveOffenders += offenders(off);

      // The rule can only be enforced by sending the previous segment down, so
      // a line holding one segment has nothing to send. There the box wins —
      // assert that this is the ONLY way an offender survives.
      on.forEach((line, i) => {
        if (i === 0 || !bad.has([...line][0] ?? "")) return;
        yielded++;
        expect(segments(on[i - 1]!, "zh").length).toBe(1);
      });

      expect(widest(on)).toBeLessThanOrEqual(w);
      expect(flat(on.join(""))).toBe(flat(ZH));
    }
    // If the naive breaker never offended, the rule was never exercised and the
    // assertions above proved nothing.
    expect(naiveOffenders).toBeGreaterThan(0);
    expect(yielded).toBeLessThan(naiveOffenders);
  });
});

test("Intl.Segmenter finds breaks in text with no spaces", () => {
  const segs = segments("确定性视频渲染", "zh");
  expect(segs.length).toBeGreaterThan(1);
  expect(segs.join("")).toBe("确定性视频渲染");
});

describe("cachedWidth", () => {
  test("joins segments before measuring", () => {
    for (const s of [EN, ZH]) {
      const width = cachedWidth(measure);
      const segs = segments(s, "en");
      expect(width(segs)).toBe(measure(s));
    }
  });

  test("tracking is added once per glyph, which measure does not do", () => {
    const width = cachedWidth(measure, 2);
    expect(width(["abc"])).toBe(measure("abc") + 2 * 3);
    expect(glyphCount("确定")).toBe(2);
  });

  test("a pair that spans two segments is not a sum of the parts", () => {
    const kern: Measure = (s) => {
      let w = 0;
      const chars = [...s];
      for (let i = 0; i < chars.length; i++) {
        w += 10;
        if (i > 0 && chars[i - 1] === "T" && chars[i] === "a") w -= 7;
      }
      return w;
    };
    const width = cachedWidth(kern);
    expect(width(["T"])).toBe(10);
    expect(width(["a"])).toBe(10);
    expect(width(["T", "a"])).toBe(13);
    expect(width(["Ta"])).toBe(13);
  });
});

test("an over-long word is broken on the joined width, not a sum of graphemes", () => {
  const kern: Measure = (s) => {
    let w = 0;
    const chars = [...s];
    for (let i = 0; i < chars.length; i++) {
      w += 10;
      if (i > 0 && chars[i - 1] === "T" && chars[i] === "a") w -= 7;
    }
    return w;
  };
  // "Ta" is 13, not 20. A 15px box holds the pair on one line.
  expect(wrapLines("Tabbbbbbbbb", { maxWidth: 15, measure: kern, locale: "en" })).toEqual([
    "Ta",
    "b",
    "b",
    "b",
    "b",
    "b",
    "b",
    "b",
    "b",
    "b",
  ]);
});

test("balanced measures a candidate line as a whole, not a prefix sum", () => {
  // Every adjacent pair subtracts 3. "aa bb" is 38 as a string and 44 as a
  // sum of "aa" + " " + "bb", so a 40px box only fits the joined line.
  const kern: Measure = (s) => {
    const n = [...s].length;
    return n === 0 ? 0 : n * 10 - (n - 1) * 3;
  };
  expect(wrapLines("aa bb", { maxWidth: 40, measure: kern, locale: "en", strategy: "balanced" })).toEqual([
    "aa bb",
  ]);
});

describe("fitToBox", () => {
  // Sizes scale the synthetic measure, and line height tracks the size.
  const candidate = (px: number) => ({
    px,
    measure: ((s: string) => (measure(s) * px) / 40) as Measure,
    lineHeight: px,
  });
  const LADDER = [40, 32, 24, 16].map(candidate);

  test("picks the largest size that fits", () => {
    const r = fitToBox("aaaa bbbb cccc", { maxWidth: 200, maxHeight: 100 }, LADDER, "en");
    expect(r.overflows).toBe(false);
    expect(r.width).toBeLessThanOrEqual(200);
    expect(r.height).toBeLessThanOrEqual(100);
    // Anything larger must genuinely not fit, or "largest" is a lie.
    const bigger = LADDER.filter((c) => c.px > r.px);
    for (const c of bigger) {
      const lines = wrapLines("aaaa bbbb cccc", { maxWidth: 200, measure: c.measure, locale: "en" });
      const w = cachedWidth(c.measure);
      expect(Math.max(...lines.map((l) => w([l]))) > 200 || lines.length * c.lineHeight > 100)
        .toBe(true);
    }
  });

  test("reports overflow rather than pretending, when nothing fits", () => {
    const r = fitToBox(EN, { maxWidth: 40, maxHeight: 20 }, LADDER, "en");
    expect(r.overflows).toBe(true);
    expect(r.px).toBe(16); // the smallest was still tried
  });
});
