/**
 * Paging, line breaking, sizing and word windows (`src/captions/layout.ts`),
 * against synthetic metrics so every width in a case is arithmetic a reader
 * can redo: a Latin character is half the size wide, a CJK one the whole
 * size, and a line is the size tall. The real advance tables are exercised by
 * `tests/captions.test.ts`, which builds.
 */

import { describe, expect, test } from "bun:test";

import {
  LayoutError,
  SAFE_AREAS,
  aspectOf,
  derivedDuration,
  ladderOf,
  layoutTrack,
  type LayoutOptions,
  type LayoutWord,
  type Metrics,
} from "../src/captions/layout.ts";
import { NO_START } from "../src/text/fit.ts";

const FLAT: Metrics = {
  padX: 0, padTop: 0, padBottom: 0, slack: 0, gap: 10, tightGap: 0, lineGap: 0,
  blockPadX: 0, blockPadTop: 0, blockPadBottom: 0,
};

const wide = (ch: string): boolean => /[\p{Script=Han}\p{P}]/u.test(ch) && ch.charCodeAt(0) > 0x2000;
const measure = (text: string, size: number): number =>
  [...text].reduce((w, ch) => w + (wide(ch) ? size : size / 2), 0);

function opts(o: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    fps: 30,
    durationFrames: 600,
    width: 1000,
    height: 1000,
    lineWidth: 400,
    margin: 100,
    position: "bottom",
    ladder: [40],
    fit: "track",
    maxLines: 2,
    maxWords: null,
    pauseMs: 400,
    holdMs: 500,
    spaceless: false,
    locale: "en",
    metrics: () => FLAT,
    measure,
    lineHeight: (s) => s,
    ...o,
  };
}

/** Words 0.3 s apart, back to back, unless a time is given. */
function said(...texts: Array<string | [string, number, number]>): LayoutWord[] {
  let t = 0;
  return texts.map((x) => {
    const [text, start, end] = typeof x === "string" ? [x, t, t + 0.3] : x;
    t = end;
    return { text, start, end, segmentEnd: false };
  });
}

const pagesOf = (words: readonly LayoutWord[], o: LayoutOptions): string[] =>
  layoutTrack(words, o).pages.map((p) => p.lines.map((l) => l.units.map((u) => u.text).join(" ")).join(" / "));

describe("aspects and safe areas", () => {
  test("16:9, 9:16 and 1:1 exactly; anything else is none of them", () => {
    expect([aspectOf(1920, 1080), aspectOf(720, 1280), aspectOf(1080, 1080), aspectOf(854, 480)]).toEqual([
      "16:9", "9:16", "1:1", undefined,
    ]);
  });

  test("9:16 keeps the narrowest line and the highest bottom margin", () => {
    expect(SAFE_AREAS["9:16"].lineWidth).toBeLessThan(SAFE_AREAS["16:9"].lineWidth);
    expect(SAFE_AREAS["9:16"].bottom).toBeGreaterThan(SAFE_AREAS["16:9"].bottom);
  });
});

describe("the size ladder", () => {
  test("10% steps from the size, the minimum always last", () => {
    expect(ladderOf(80, 56)).toEqual([80, 72, 64, 56]);
    expect(ladderOf(160, 80)).toEqual([160, 144, 128, 112, 96, 80]);
    expect(ladderOf(40, 40)).toEqual([40]);
  });
});

describe("paging — which words share a screen", () => {
  test("a pause of pauseMs or more closes the page", () => {
    const w = said(["one", 0, 0.3], ["two", 0.3, 0.6], ["three", 1.0, 1.3], ["four", 1.3, 1.6]);
    expect(pagesOf(w, opts())).toEqual(["one two", "three four"]);
    expect(pagesOf(w, opts({ pauseMs: 500 }))).toEqual(["one two three four"]);
  });

  test("a sentence end closes the page, closing quotes allowed after the mark", () => {
    expect(pagesOf(said("One.", "Two!”", "three", "four"), opts())).toEqual(["One.", "Two!”", "three four"]);
  });

  test("a transcript segment end closes the page", () => {
    const w = said("one", "two", "three");
    w[1] = { ...w[1]!, segmentEnd: true };
    expect(pagesOf(w, opts())).toEqual(["one two", "three"]);
  });

  test("maxWords closes the page", () => {
    expect(pagesOf(said("a", "b", "c", "d", "e"), opts({ maxWords: 2 }))).toEqual(["a b", "c d", "e"]);
  });

  test("a word that would need more than maxLines lines starts a new page", () => {
    // 40 px: each word 80 wide, a 400 px line holds four with their gaps.
    const w = said(...Array.from({ length: 10 }, (_, i) => `w${i}xx`));
    const pages = pagesOf(w, opts({ maxLines: 1 }));
    expect(pages).toEqual(["w0xx w1xx w2xx w3xx", "w4xx w5xx w6xx w7xx", "w8xx w9xx"]);
  });

  test("a word starting on the page's first frame joins it whatever maxWords says", () => {
    const w = said(["a", 0, 0.01], ["b", 0.01, 0.3], ["c", 0.3, 0.6]);
    // a and b both start on frame 0: two pages starting on one frame would
    // give the first no frame at all.
    expect(pagesOf(w, opts({ maxWords: 1 }))).toEqual(["a b", "c"]);
  });

  test("words on the page's first frame that cannot fit one page are refused, not drawn over", () => {
    const w = said(["aaaaaaaaaaaaaaaaaaa", 0, 0.01], ["bbbbbbbbbbbbbbbbbbb", 0.01, 0.3]);
    expect(() => layoutTrack(w, opts({ maxLines: 1 }))).toThrow(/start on frame 0 and do not fit one page/);
  });
});

describe("line breaking", () => {
  test("lines are rebalanced to the same count with the slack spread evenly", () => {
    // 60 px words, 300 px line. Greedy fills the first line with four and
    // leaves one; 3 + 2 and 2 + 3 cost the same, and a tie takes the earlier
    // break, so the shorter line is the top one.
    const w = said("aaa", "bbb", "ccc", "ddd", "eee");
    const t = layoutTrack(w, opts({ lineWidth: 300 }));
    expect(t.pages[0]!.lines.map((l) => l.units.length)).toEqual([2, 3]);
    // Without a tie the even split wins outright: 3 + 3 over greedy's 5 + 1.
    const t2 = layoutTrack(said("aaa", "bbb", "ccc", "ddd", "eee", "fff"), opts({ lineWidth: 340 }));
    expect(t2.pages[0]!.lines.map((l) => l.units.length)).toEqual([3, 3]);
  });

  test("every line is centred, and the block sits margin above the bottom", () => {
    const t = layoutTrack(said("aaaa", "bb"), opts());
    const [line] = t.pages[0]!.lines;
    const first = line!.units[0]!;
    const last = line!.units[1]!;
    expect(first.x + (last.x + last.boxW - first.x) / 2).toBe(500);
    expect(t.pages[0]!.block.y + t.pages[0]!.block.h).toBe(1000 - 100);
  });

  test("a spaced word is never broken: the track steps down the ladder until every word fits", () => {
    // "internationalisation" is 20 characters: 400 at 40 px, 360 at 36.
    const w = said("an", "internationalisation", "word");
    const t = layoutTrack(w, opts({ lineWidth: 380, ladder: [40, 36, 32] }));
    expect(t.pages.map((p) => p.size)).toEqual([36, 36]);
    expect(pagesOf(w, opts({ lineWidth: 380, ladder: [40, 36, 32] }))).toEqual(["an / internationalisation", "word"]);
  });

  test("a spaced word wider than the line at the smallest size is refused, naming it", () => {
    const w = said("an", "internationalisation", "word");
    expect(() => layoutTrack(w, opts({ lineWidth: 300, ladder: [40, 36] }))).toThrow(LayoutError);
    expect(() => layoutTrack(w, opts({ lineWidth: 300, ladder: [40, 36] }))).toThrow(
      /word 1 "internationalisation" is 360px wide at 36px, the smallest size allowed, and a line is 300px/,
    );
  });

  test("a spaceless word wider than a line breaks between its characters, never before a closing mark", () => {
    // 40 px per character, 200 px lines: five to a line. The ninth character
    // is 。, which may not start a line, so 文 goes down with it.
    const w = said("一二三四五六七八。");
    const t = layoutTrack(w, opts({ spaceless: true, locale: "zh", lineWidth: 200, maxLines: 3 }));
    const lines = t.pages[0]!.lines.map((l) => l.units.map((u) => u.text).join(""));
    expect(lines).toEqual(["一二三四五", "六七八。"]);
    const t2 = layoutTrack(said("一二三四五六七八九十。"), opts({ spaceless: true, locale: "zh", lineWidth: 200, maxLines: 3 }));
    const lines2 = t2.pages[0]!.lines.map((l) => l.units.map((u) => u.text).join(""));
    expect(lines2).toEqual(["一二三四五", "六七八九", "十。"]);
    for (const l of lines2) expect(NO_START.has([...l][0]!)).toBe(false);
  });

  test("the pieces of a split word are nodes of their own carrying the word's index", () => {
    const t = layoutTrack(said("一二三四五六七"), opts({ spaceless: true, locale: "zh", lineWidth: 200 }));
    const units = t.pages[0]!.lines.flatMap((l) => l.units);
    expect(units.map((u) => [u.word, u.part, u.parts])).toEqual([[0, 0, 2], [0, 1, 2]]);
  });

  test("spaceless words abut; a Latin word among them keeps its gap", () => {
    const t = layoutTrack(said("用", "JSX", "写"), opts({ spaceless: true, locale: "zh" }));
    const [a, b, c] = t.pages[0]!.lines[0]!.units;
    expect(b!.x - (a!.x + a!.boxW)).toBe(10);
    expect(c!.x - (b!.x + b!.boxW)).toBe(10);
    const t2 = layoutTrack(said("每一", "帧"), opts({ spaceless: true, locale: "zh" }));
    const [d, e] = t2.pages[0]!.lines[0]!.units;
    expect(e!.x - (d!.x + d!.boxW)).toBe(0);
  });

  test('fit: "page" sizes each page on its own', () => {
    const w = said(["short", 0, 0.3], ["considerable", 1, 1.3]);
    const t = layoutTrack(w, opts({ fit: "page", maxWords: 1, maxLines: 1, lineWidth: 250, ladder: [80, 60, 40] }));
    // "short" is 200 at 80 px; "considerable" is 480 at 80, 360 at 60, 240 at 40.
    expect(t.pages.map((p) => p.size)).toEqual([80, 40]);
  });
});

describe("time", () => {
  test("a word's window is its frames; the page holds holdMs past its last word", () => {
    const t = layoutTrack(said(["a", 0, 0.5], ["b", 0.5, 1]), opts());
    expect(t.windows).toEqual([{ word: 0, from: 0, to: 14 }, { word: 1, from: 15, to: 29 }]);
    expect([t.pages[0]!.startFrame, t.pages[0]!.endFrame]).toEqual([0, 45]);
  });

  test("a page gives way when the next one starts, and clips a word still being spoken", () => {
    const w = said(["a.", 0, 1], ["b", 0.5, 0.8]);
    const t = layoutTrack(w, opts());
    expect(t.pages.map((p) => [p.startFrame, p.endFrame])).toEqual([[0, 15], [15, 39]]);
    expect(t.windows[0]).toEqual({ word: 0, from: 0, to: 14 });
  });

  test("a word shorter than a frame still gets one", () => {
    const t = layoutTrack(said(["a", 0, 0.01]), opts());
    expect(t.windows[0]).toEqual({ word: 0, from: 0, to: 0 });
  });

  test("a word past the end of the film is refused", () => {
    expect(() => layoutTrack(said(["a", 0, 3]), opts({ durationFrames: 60 }))).toThrow(/ends at frame 90, past the film's 60 frames/);
  });

  test("an undeclared duration is the last word's end plus the hold", () => {
    expect(derivedDuration(said(["a", 0, 1], ["b", 0.5, 2.5]), 30, 500)).toBe(75 + 15);
  });
});
