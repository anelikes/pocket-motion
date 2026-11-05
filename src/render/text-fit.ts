/**
 * What layout chose for a run that declares a fit, a clamp or wrapping, read
 * out of the core.
 *
 * `text-fit-[..]`, `line-clamp-N` and `text-wrap` (`patches/0059`) are
 * evaluated by the core at layout, against the box the solver gives the node,
 * and the answer is recorded on the node: the rung of the ladder drawn,
 * whether any rung held the box, how many lines the run wrapped to and kept,
 * how many characters the clamp left out and how many breaks fell inside a
 * segment. `ui_debug_text_fit(id)` selects that record and returns its
 * summary; `ui_debug_text_fit_word(i)` reads the rest.
 *
 * WHY THE CORE'S RECORD AND NOT THE PIXELS. Every other text code here is
 * read off the frame: `text_box_overflow` and `clipped_text` are the ink a
 * node contributes against its box. Text a clamp left out draws no pixel, so
 * no ink reading can see it — a clamped price that lost its currency sign is
 * green on every pixel gate (`docs/text-shaping.design.md` §7 has the
 * measurement). So `text_truncated` comes from the one place that knows what
 * was dropped, the layout that dropped it.
 *
 * Slots are what the core knows; sizes are what an author wrote. The build's
 * style module maps one to the other (`FONT_SLOTS` in `<output>.styles.ts`,
 * beside the bundle), and `slotPxOf` reads it.
 */

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface TextFitReading {
  /** Size the run is drawn at, px. Absent when no slot table was read. */
  readonly px?: number;
  /** The slot it is drawn with. */
  readonly slot: number;
  /** The declared ladder in px, largest first, when one was declared and a
   *  slot table was read. */
  readonly ladder?: readonly number[];
  /** Index of the rung drawn (0 = the largest), and how many there are. */
  readonly rung: number;
  readonly rungs: number;
  /** A rung held the box. False when even the smallest did not. */
  readonly fitted: boolean;
  /** A ladder was declared (`text-fit-[..]`). */
  readonly declaredLadder: boolean;
  readonly wraps: boolean;
  /** Lines a clamp keeps; 0 when the node declares none. */
  readonly clamp: number;
  readonly linesKept: number;
  /** Lines the run wrapped to at the rung drawn, before the clamp. */
  readonly linesTotal: number;
  /** Characters of the run the clamp left out (spaces not counted). */
  readonly dropped: number;
  /** Line breaks placed between two characters of one segment. */
  readonly split: number;
}

/** The two exports `patches/0059` adds. */
interface FitExports {
  readonly ui_debug_text_fit?: (id: number) => number;
  readonly ui_debug_text_fit_word?: (i: number) => number;
}

/** Word indices of `ui_debug_text_fit_word` (`Ui::debug_text_fit_word`). */
const WORD_LINES = 0;
const WORD_DROPPED = 1;
const WORD_SPLIT = 2;
const WORD_CLAMP = 3;
const WORD_RUNG_SLOT = 8;

/**
 * The fit record of node `id`, or null when it holds none: not a laid-out
 * text node, or one declaring no fit, clamp or wrap. Throws on a core without
 * the exports, because "no record" read off a core that cannot hold one would
 * be an answer about a different engine.
 */
export function readTextFit(
  exports: object,
  id: number,
  slotPx?: ReadonlyMap<number, number>,
): TextFitReading | null {
  const e = exports as FitExports;
  if (typeof e.ui_debug_text_fit !== "function" || typeof e.ui_debug_text_fit_word !== "function") {
    throw new Error(
      "this core has no ui_debug_text_fit (patches/0059-text-fit-and-clamp.patch); rebuild it:\n  bun scripts/vendor.ts",
    );
  }
  const summary = e.ui_debug_text_fit(id);
  if (summary === -1) return null;
  const word = e.ui_debug_text_fit_word;
  const slot = summary & 0xff;
  const rungs = (summary >> 12) & 0xf;
  const lines = word(WORD_LINES);
  const declaredLadder = ((summary >> 17) & 1) === 1;
  const px = slotPx?.get(slot);
  const ladderSlots = declaredLadder ? Array.from({ length: rungs }, (_, i) => word(WORD_RUNG_SLOT + i)) : [];
  const ladderPx = ladderSlots.map((s) => slotPx?.get(s));
  return {
    ...(px === undefined ? {} : { px }),
    slot,
    ...(declaredLadder && ladderPx.every((p) => p !== undefined) ? { ladder: ladderPx as number[] } : {}),
    rung: (summary >> 8) & 0xf,
    rungs,
    fitted: ((summary >> 16) & 1) === 1,
    declaredLadder,
    wraps: ((summary >> 18) & 1) === 1,
    clamp: word(WORD_CLAMP),
    linesKept: lines & 0xffff,
    linesTotal: (lines >>> 16) & 0xffff,
    dropped: word(WORD_DROPPED),
    split: word(WORD_SPLIT),
  };
}

/**
 * The run drew less than its declaration asked for: the clamp left
 * characters out, or a declared ladder bottomed out — no rung held the box,
 * and the run is drawn at the smallest anyway.
 *
 * A fit that settles on a smaller rung is the declaration doing what it says
 * and is not this; `fit.px` in `layout --json` reports which rung, for a
 * reader who wants a floor.
 */
export function truncated(fit: TextFitReading): boolean {
  return fit.dropped > 0 || (fit.declaredLadder && !fit.fitted);
}

/** One line naming the numbers `truncated` was decided from. */
export function describeTruncation(fit: TextFitReading): string {
  const size = fit.px === undefined ? `slot ${fit.slot}` : `${fit.px}px`;
  const parts: string[] = [];
  if (fit.declaredLadder && !fit.fitted) {
    const ladder = fit.ladder === undefined ? `${fit.rungs} rung(s)` : fit.ladder.map((p) => `${p}`).join("/") + "px";
    parts.push(`no rung of ${ladder} held its box; drawn at the smallest, ${size}, in ${fit.linesTotal} line(s)`);
  }
  if (fit.dropped > 0) {
    parts.push(
      `clamped to ${fit.linesKept} of ${fit.linesTotal} line(s) at ${size}: ` +
        `${fit.dropped} character(s) not drawn`,
    );
  }
  return parts.join("; ");
}

/**
 * Slot -> px for the build beside `bundlePath`, from the style module pass 1
 * writes there (`<output>.styles.ts`, `FONT_SLOTS`). Empty when the module is
 * not there, so a reading still names slots.
 */
export async function slotPxOf(bundlePath: string): Promise<Map<number, number>> {
  const path = join(dirname(bundlePath), `${basename(bundlePath, ".js")}.styles.ts`);
  const out = new Map<number, number>();
  if (!existsSync(path)) return out;
  const text = await Bun.file(path).text();
  // `  12: { px: 48, bold: true },` — the module's own literal form
  // (`generateStylesModule`), read as text: importing it would put a
  // composition's build output in this process's module cache.
  const block = /export const FONT_SLOTS[^{]*\{([\s\S]*?)\n\};/.exec(text)?.[1] ?? "";
  for (const m of block.matchAll(/^\s*(\d+): \{ px: (\d+(?:\.\d+)?),/gm)) out.set(Number(m[1]), Number(m[2]));
  return out;
}
