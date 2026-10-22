/**
 * Which words share a screen, where each line breaks, how large the text is,
 * and where every word sits — decided at build time, against the renderer's
 * own advance tables, because the renderer neither wraps nor shrinks
 * (AUTHORING.md, "Text").
 *
 * The unit is the transcript WORD, not a segmenter word: a word is what has a
 * time, and every word is its own node so a style can animate it on its own
 * clock. Each word is measured as one string and drawn as one `Text` run, so
 * the width of a line is the sum of its words' widths and the gaps between
 * them — additive here, unlike `src/text/fit.ts`, because nothing kerns
 * across two runs.
 *
 * ## Paging: which words share a screen
 *
 * Words are taken in order and a page closes before a word when any of these
 * holds: the pause before it is at least `pauseMs`; the word before it ends a
 * sentence (`.` `!` `?` `…` `。` `！` `？`, closing quotes allowed after); the
 * word before it ends a transcript segment; the page already holds `maxWords`;
 * or adding it would need more than `maxLines` lines. One rule overrides all of
 * them: **a word that starts on the same frame as the page's first word joins
 * that page**, because two pages starting on one frame would give the first
 * of them no frame to be seen on. When such a word cannot fit, the layout is
 * refused rather than drawn over the line.
 *
 * ## Line breaking
 *
 * Inside a page, lines are broken between words, greedily, and then rebalanced
 * to the same number of lines so the slack is spread evenly (the squared-slack
 * objective `fit.ts` calls `balanced`). A language written without spaces
 * (`isSpaceless`) may also break INSIDE a word that is wider than a whole
 * line — between characters, which is how such text breaks anyway — keeping
 * to 禁則: a piece never begins with a mark in `NO_START` nor ends with one in
 * `NO_END` (`src/text/fit.ts`). The pieces of a split word are separate nodes
 * carrying the word's own time. A spaced language never breaks inside a word.
 *
 * ## Size, and the word too wide for any line
 *
 * Sizes come from a ladder, largest first, each a real atlas slot. With
 * `fit: "track"` the whole track takes the largest rung at which every word
 * fits a line on its own, so the size does not jump between pages; with
 * `fit: "page"` (one big word at a time) each page takes the largest rung at
 * which it fits. A spaced-language word wider than the line at the smallest
 * rung is REFUSED, naming the word and both widths — splitting it would
 * change what it says, and a size below the declared minimum is not what was
 * declared.
 *
 * ## Time
 *
 * A word's frames are `[round(start·fps), max(that + 1, round(end·fps)))`. A
 * page is shown from its first word's frame until `holdMs` after its last
 * word, or until the next page starts, whichever is first. A word whose own
 * end runs past its page's end (speech that overlaps the next page) is shown
 * until the page gives way: its WINDOW is its frames clipped to its page, and
 * that window is what the generated `assertions[]` claim.
 */

import { NO_END, NO_START } from "../text/fit.ts";
import { frameOf } from "./clock.ts";

export const ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type Aspect = (typeof ASPECTS)[number];

export function aspectOf(width: number, height: number): Aspect | undefined {
  if (width * 9 === height * 16) return "16:9";
  if (width * 16 === height * 9) return "9:16";
  if (width === height) return "1:1";
  return undefined;
}

/**
 * Where captions may be drawn, per aspect: the widest a caption block may be
 * as a fraction of the width, and the margins as fractions of the height.
 *
 * - 16:9 — 80% of the width, inside the 90% title-safe width with room to
 *   spare; 10% of the height from the bottom, inside the 5% title-safe band.
 * - 9:16 — short-form players draw a column of buttons down the right edge
 *   and a description band along the bottom, so the line is held to 78% and
 *   the block sits 22% of the height up. These are this template's numbers,
 *   chosen to clear those overlays; they are not a platform's published zone.
 * - 1:1 — 84% and 10%.
 *
 * The top margin is used by `position: "top"`. `layout.lineWidth` and
 * `layout.margin` override them per job.
 */
export const SAFE_AREAS: Readonly<Record<Aspect, { lineWidth: number; top: number; bottom: number }>> = {
  "16:9": { lineWidth: 0.8, top: 0.08, bottom: 0.1 },
  "9:16": { lineWidth: 0.78, top: 0.12, bottom: 0.22 },
  "1:1": { lineWidth: 0.84, top: 0.08, bottom: 0.1 },
};

export const POSITIONS = ["bottom", "center", "top"] as const;
export type Position = (typeof POSITIONS)[number];

/** A style's spacing at one size, in px. */
export interface Metrics {
  /** Around each word's text: a highlight box is the word plus these. */
  readonly padX: number;
  readonly padTop: number;
  readonly padBottom: number;
  /** Extra width on a word's right, inside its box (a clip window's slack). */
  readonly slack: number;
  /** Between two words where either side of the boundary is a Latin letter or digit. */
  readonly gap: number;
  /** Between two words of a spaceless language. */
  readonly tightGap: number;
  /** Between two line boxes. */
  readonly lineGap: number;
  /** Around the whole block (a pill behind every line). */
  readonly blockPadX: number;
  readonly blockPadTop: number;
  readonly blockPadBottom: number;
}

export interface LayoutWord {
  /** As displayed: the style's case already applied. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly segmentEnd: boolean;
}

export interface LayoutOptions {
  readonly fps: number;
  readonly durationFrames: number;
  readonly width: number;
  readonly height: number;
  /** Widest a caption block may be, px — the whole block, pads included. */
  readonly lineWidth: number;
  /** Distance from the anchoring edge, px; unused for `center`. */
  readonly margin: number;
  readonly position: Position;
  /** Sizes, largest first. Every one must be measurable. */
  readonly ladder: readonly number[];
  readonly fit: "track" | "page";
  readonly maxLines: number;
  /** `null` is no limit. */
  readonly maxWords: number | null;
  readonly pauseMs: number;
  readonly holdMs: number;
  readonly spaceless: boolean;
  readonly locale: string;
  readonly metrics: (size: number) => Metrics;
  /** Width of one run in logical px. */
  readonly measure: (text: string, size: number) => number;
  readonly lineHeight: (size: number) => number;
}

export interface PlacedUnit {
  /** Index into the transcript's words. */
  readonly word: number;
  /** Which piece of the word, and how many there are (1 unless split). */
  readonly part: number;
  readonly parts: number;
  readonly text: string;
  /** Box origin, px. The text sits at `x + padX`, `y + padTop`. */
  readonly x: number;
  readonly y: number;
  /** Measured width of the text alone. */
  readonly textW: number;
  /** Box: text plus pads and slack. */
  readonly boxW: number;
  readonly boxH: number;
}

export interface PlacedLine {
  readonly units: readonly PlacedUnit[];
}

export interface Page {
  readonly index: number;
  readonly first: number;
  readonly last: number;
  readonly size: number;
  readonly metrics: Metrics;
  readonly lineHeight: number;
  readonly lines: readonly PlacedLine[];
  /** The block, pads included. */
  readonly block: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Shown from `startFrame`, gone from `endFrame`. */
  readonly startFrame: number;
  readonly endFrame: number;
}

/** A word's frames on screen: `[from, to]`, both inclusive. */
export interface WordWindow {
  readonly word: number;
  readonly from: number;
  readonly to: number;
}

export interface TrackLayout {
  readonly pages: readonly Page[];
  readonly windows: readonly WordWindow[];
}

export class LayoutError extends Error {}

/** Ends a sentence: the mark may be followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?…。！？][\p{Pe}\p{Pf}"']*$/u;
const LATIN_EDGE = /[\p{Script=Latin}\p{Nd}]/u;

/** Unicode grapheme clusters; `locale` is the spec's, so the split is the spec's. */
function graphemes(text: string, locale: string): string[] {
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
}

/** Ladder rungs from `size` down to `minSize`: 10% steps, `minSize` always last. */
export function ladderOf(size: number, minSize: number): number[] {
  const out: number[] = [];
  for (let k = 0; ; k++) {
    const r = Math.round(size * (1 - 0.1 * k));
    if (r <= minSize) break;
    if (out[out.length - 1] !== r) out.push(r);
  }
  out.push(minSize);
  return out;
}

interface Unit {
  readonly word: number;
  readonly part: number;
  parts: number;
  readonly text: string;
  readonly textW: number;
  readonly boxW: number;
}

interface Broken {
  readonly lines: Unit[][];
  readonly split: boolean;
}

/**
 * Lay one track out.
 *
 * Throws `LayoutError` for the three refusals: a spaced-language word wider
 * than the line at the smallest size, a page that cannot fit even one word,
 * and words starting on one frame that do not fit one page.
 */
export function layoutTrack(words: readonly LayoutWord[], o: LayoutOptions): TrackLayout {
  if (words.length === 0) throw new LayoutError("captions: no words to lay out");
  const ladder = [...o.ladder];
  const startF = words.map((w) => frameOf(w.start, o.fps));
  const endF = words.map((w, i) => Math.max(startF[i]! + 1, frameOf(w.end, o.fps)));
  const lastEnd = Math.max(...endF);
  if (lastEnd > o.durationFrames) {
    const i = endF.indexOf(lastEnd);
    throw new LayoutError(
      `captions: word ${i} ${JSON.stringify(words[i]!.text)} ends at frame ${lastEnd}, past the ` +
        `film's ${o.durationFrames} frames`,
    );
  }

  const widthCache = new Map<string, number>();
  const width = (text: string, size: number): number => {
    const key = `${size}\u0000${text}`;
    let w = widthCache.get(key);
    if (w === undefined) {
      w = o.measure(text, size);
      widthCache.set(key, w);
    }
    return w;
  };
  const unitOf = (word: number, part: number, text: string, size: number): Unit => {
    const m = o.metrics(size);
    const textW = width(text, size);
    return { word, part, parts: 1, text, textW, boxW: textW + 2 * m.padX + m.slack };
  };
  const avail = (size: number): number => o.lineWidth - 2 * o.metrics(size).blockPadX;
  const gapBetween = (a: Unit, b: Unit, size: number): number => {
    if (a.word === b.word) return 0;
    const m = o.metrics(size);
    if (!o.spaceless) return m.gap;
    const left = [...a.text].at(-1) ?? "";
    const right = [...b.text][0] ?? "";
    return LATIN_EDGE.test(left) || LATIN_EDGE.test(right) ? m.gap : m.tightGap;
  };
  const lineWidthOf = (line: readonly Unit[], size: number): number =>
    line.reduce((sum, u, k) => sum + u.boxW + (k > 0 ? gapBetween(line[k - 1]!, u, size) : 0), 0);

  /** A spaceless word wider than a line, as pieces that each fit, 禁則 kept. */
  const splitWord = (word: number, size: number): Unit[] | null => {
    const room = avail(size);
    const pieces: string[][] = [];
    let cur: string[] = [];
    for (const g of graphemes(words[word]!.text, o.locale)) {
      if (cur.length > 0 && unitOf(word, 0, [...cur, g].join(""), size).boxW > room) {
        const last = cur[cur.length - 1]!;
        if ((NO_START.has(g) || NO_END.has(last)) && cur.length > 1) {
          pieces.push(cur.slice(0, -1));
          cur = [last, g];
        } else {
          pieces.push(cur);
          cur = [g];
        }
      } else {
        cur.push(g);
      }
    }
    if (cur.length > 0) pieces.push(cur);
    const units = pieces.map((p, k) => unitOf(word, k, p.join(""), size));
    if (units.some((u) => u.boxW > room)) return null;
    for (const u of units) u.parts = units.length;
    return units;
  };

  /** Greedy lines for `ids` at `size`, or null when a word cannot be placed at all. */
  const greedy = (ids: readonly number[], size: number): Broken | null => {
    const room = avail(size);
    const lines: Unit[][] = [[]];
    let split = false;
    const place = (u: Unit): void => {
      const line = lines[lines.length - 1]!;
      const g = line.length > 0 ? gapBetween(line[line.length - 1]!, u, size) : 0;
      if (line.length > 0 && lineWidthOf(line, size) + g + u.boxW > room) lines.push([u]);
      else line.push(u);
    };
    for (const id of ids) {
      const whole = unitOf(id, 0, words[id]!.text, size);
      if (whole.boxW <= room) {
        place(whole);
        continue;
      }
      if (!o.spaceless) return null;
      const pieces = splitWord(id, size);
      if (pieces === null) return null;
      split = true;
      // A split word starts on a line of its own; each piece then fills one.
      if (lines[lines.length - 1]!.length > 0) lines.push([]);
      pieces.forEach((p, k) => {
        if (k > 0) lines.push([]);
        lines[lines.length - 1]!.push(p);
      });
    }
    return { lines: lines.filter((l) => l.length > 0), split };
  };

  /** Rebreak whole-word lines into the same count with the least squared slack. */
  const balance = (b: Broken, size: number): Unit[][] => {
    const k = b.lines.length;
    if (k < 2 || b.split) return b.lines;
    const units = b.lines.flat();
    const n = units.length;
    const room = avail(size);
    const cost = (i: number, j: number): number => {
      const w = lineWidthOf(units.slice(i, j), size);
      return w > room ? Infinity : (room - w) ** 2;
    };
    // best[l][j]: least cost of the first j units in l lines.
    const best: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
    const from: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
    best[0]![0] = 0;
    for (let l = 1; l <= k; l++) {
      for (let j = l; j <= n; j++) {
        for (let i = l - 1; i < j; i++) {
          const c = best[l - 1]![i]! + cost(i, j);
          // Strict: the earliest break wins a tie, so the result is a function of the input.
          if (c < best[l]![j]!) {
            best[l]![j] = c;
            from[l]![j] = i;
          }
        }
      }
    }
    if (best[k]![n] === Infinity) return b.lines;
    const out: Unit[][] = [];
    for (let l = k, j = n; l > 0; l--) {
      const i = from[l]![j]!;
      out.unshift(units.slice(i, j));
      j = i;
    }
    return out;
  };

  // The track's size, or every size a page may take.
  let trackSize: number | undefined;
  if (o.fit === "track") {
    for (const size of ladder) {
      const fits = words.every((_, i) => greedy([i], size) !== null);
      if (fits) {
        trackSize = size;
        break;
      }
    }
    if (trackSize === undefined) {
      const min = ladder[ladder.length - 1]!;
      const widest = words
        .map((w, i) => ({ i, w: unitOf(i, 0, w.text, min).boxW }))
        .filter((x) => greedy([x.i], min) === null)
        .sort((a, b) => b.w - a.w)[0]!;
      throw new LayoutError(
        `captions: word ${widest.i} ${JSON.stringify(words[widest.i]!.text)} is ${Math.ceil(widest.w)}px ` +
          `wide at ${min}px, the smallest size allowed, and a line is ${Math.floor(avail(min))}px. ` +
          "A word in a language written with spaces is never broken; lower `style.minSize`, " +
          "widen `layout.lineWidth`, or shorten the word in the transcript",
      );
    }
  }

  /** The size a page of `ids` takes, and its lines; null when no rung fits it. */
  const setPage = (ids: readonly number[]): { size: number; broken: Broken } | null => {
    const rungs = trackSize !== undefined ? [trackSize] : ladder;
    for (const size of rungs) {
      const b = greedy(ids, size);
      if (b !== null && b.lines.length <= o.maxLines) return { size, broken: b };
    }
    return null;
  };

  // Paging.
  const pageIds: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (cur.length > 0) {
      const prev = words[i - 1]!;
      const closes =
        (words[i]!.start - prev.end) * 1000 >= o.pauseMs ||
        SENTENCE_END.test(prev.text) ||
        prev.segmentEnd ||
        (o.maxWords !== null && cur.length >= o.maxWords) ||
        setPage([...cur, i]) === null;
      if (closes && startF[i]! > startF[cur[0]!]!) {
        pageIds.push(cur);
        cur = [];
      } else if (closes && setPage([...cur, i]) === null) {
        throw new LayoutError(
          `captions: words ${cur[0]}–${i} all start on frame ${startF[i]} and do not fit one page ` +
            `of ${o.maxLines} line(s); a page that starts on the same frame as the one before it ` +
            "would never be seen. Raise `layout.maxLines` or `fps`",
        );
      }
    }
    cur.push(i);
    if (setPage(cur) === null) {
      const w = words[i]!;
      throw new LayoutError(
        `captions: word ${i} ${JSON.stringify(w.text)} does not fit ${o.maxLines} line(s) at any size ` +
          `from ${ladder[0]}px to ${ladder[ladder.length - 1]}px within a ${Math.floor(o.lineWidth)}px line`,
      );
    }
  }
  if (cur.length > 0) pageIds.push(cur);

  const holdFrames = Math.round((o.holdMs * o.fps) / 1000);
  const pages: Page[] = [];
  const windows: WordWindow[] = [];
  pageIds.forEach((ids, pi) => {
    const set = setPage(ids)!;
    const size = set.size;
    const m = o.metrics(size);
    const lh = o.lineHeight(size);
    const lines = balance(set.broken, size);
    const lineBox = lh + m.padTop + m.padBottom;
    const innerH = lines.length * lineBox + (lines.length - 1) * m.lineGap;
    const blockH = innerH + m.blockPadTop + m.blockPadBottom;
    const blockTop =
      o.position === "bottom"
        ? o.height - o.margin - blockH
        : o.position === "top"
          ? o.margin
          : Math.round((o.height - blockH) / 2);
    const widths = lines.map((l) => lineWidthOf(l, size));
    const blockW = Math.max(...widths) + 2 * m.blockPadX;
    const placed: PlacedLine[] = lines.map((line, li) => {
      const y = blockTop + m.blockPadTop + li * (lineBox + m.lineGap);
      const left = (o.width - widths[li]!) / 2;
      let offset = 0;
      const units = line.map((u, k) => {
        if (k > 0) offset += gapBetween(line[k - 1]!, u, size);
        const p: PlacedUnit = {
          word: u.word,
          part: u.part,
          parts: u.parts,
          text: u.text,
          x: Math.round(left + offset),
          y: Math.round(y),
          textW: u.textW,
          boxW: u.boxW,
          boxH: lineBox,
        };
        offset += u.boxW;
        return p;
      });
      return { units };
    });
    const startFrame = startF[ids[0]!]!;
    const lastEndF = Math.max(...ids.map((i) => endF[i]!));
    const next = pageIds[pi + 1];
    const endFrame = Math.min(
      lastEndF + holdFrames,
      next !== undefined ? startF[next[0]!]! : o.durationFrames,
      o.durationFrames,
    );
    pages.push({
      index: pi,
      first: ids[0]!,
      last: ids[ids.length - 1]!,
      size,
      metrics: m,
      lineHeight: lh,
      lines: placed,
      block: { x: Math.round((o.width - blockW) / 2), y: Math.round(blockTop), w: blockW, h: blockH },
      startFrame,
      endFrame,
    });
    for (const i of ids) windows.push({ word: i, from: startF[i]!, to: Math.min(endF[i]!, endFrame) - 1 });
  });
  return { pages, windows };
}

/** The first frame after every word has ended and the last page has been held. */
export function derivedDuration(
  words: readonly { start: number; end: number }[],
  fps: number,
  holdMs: number,
): number {
  const endF = words.map((w) => Math.max(frameOf(w.start, fps) + 1, frameOf(w.end, fps)));
  return Math.max(...endF) + Math.round((holdMs * fps) / 1000);
}
