/**
 * Build-time line breaking and shrink-to-fit, for a renderer that has neither.
 *
 * `engine/core/src/text.rs` states the constraint in its own header: *"v1 line
 * model (documented limitation): NO automatic word wrap — a run breaks only on
 * explicit '\n'"*. A `Text` whose content is wider than its box does not wrap
 * and does not shrink; it draws past the box, and `overflow-hidden` only turns
 * that into silently missing words.
 *
 * The way out does not need the core, because the pipeline already has a place
 * where this is free. Compositions are GENERATED (each one's `gen.ts`) and
 * the host can measure text exactly (`Ui::measure_text`, reachable as
 * `ops.measureText`). So the break decision is made at build time against the
 * renderer's own advance table, and what reaches the composition is a string
 * that already carries its '\n'. The core is unchanged, the guest stays
 * mount-only, and the result is baked into the source, so it is as deterministic
 * as the glyph atlas.
 *
 * ## Why candidate lines are measured whole
 *
 * The split — segment once, then try candidate lines — is the shape
 * `chenglou/pretext` uses in the browser. Width is not additive here: the
 * atlas carries pair adjustments, and `measure_run` applies them between
 * adjacent glyphs. The width of `"Ta"` is not the width of `"T"` plus the
 * width of `"a"`. Every candidate — a trial greedy line, a grapheme cluster,
 * a balanced `[i, j)` span — is therefore measured as the joined string.
 *
 * ## What the host measurement does NOT cover
 *
 * `Ui::measure_text` calls `measure_run(text, slot, 0.0, f32::NAN)` — tracking
 * is pinned to 0 and the line height is left to the atlas. Tracking is recovered
 * here in arithmetic (`+ tracking * glyphs`, which is what `measure_run` does
 * with it); line height has to come from the atlas header in the pak, which is
 * what `atlasMetrics` in `scripts/fit-probe.ts` reads.
 */

/** Width in logical px of `text` on one line, tracking 0. Injected so this
 *  module never binds a world: the probe passes `ops.measureText`, tests pass a
 *  table. */
export type Measure = (text: string) => number;

/**
 * Characters that may not begin a line (行頭禁則). Breaking before these is what
 * makes wrapped CJK look wrong at a glance — a line starting with `。` is the
 * tell.
 *
 * The rule is enforced by 追い出し: send the previous segment down with the
 * offender. That is impossible when the line holds ONE segment, since popping it
 * would emit an empty line, and the alternative — keeping the pair together past
 * the right edge — breaks the invariant this module exists for. In that corner
 * the box wins and the offender starts the line. It takes a box barely wider
 * than a single word to reach: with the test's synthetic metrics, `Chrome` alone
 * fills a 60px line and the `，` after it has nowhere to go.
 */
export const NO_START: ReadonlySet<string> = new Set(
  [
    ...",.;:!?)]}%",
    ..."、。，．！？：；）］｝〕〉》」』】〙〗〞",
    ..."”’»›・ー…‥",
  ],
);

/** Characters that may not end a line (行末禁則). */
export const NO_END: ReadonlySet<string> = new Set([..."([{", ..."（［｛〔〈《「『【〘〖〝", ..."“‘«‹"]);

const isSpace = (s: string): boolean => s.trim() === "";

/** Unicode scalars, matching `measure_run`'s `text.chars()`. */
export const glyphCount = (s: string): number => [...s].length;

export interface WrapOptions {
  /** Box width in logical px. */
  readonly maxWidth: number;
  readonly measure: Measure;
  /** BCP-47 tag for `Intl.Segmenter`. `undefined` uses the host default, which
   *  is not deterministic across machines — pass one. */
  readonly locale?: string;
  /** Per-glyph tracking in px (`tracking-wide` compiles to `px(0.025 * size)`).
   *  `measure` is tracking-blind, so it is added back here. */
  readonly tracking?: number;
  /** Apply the 禁則 sets above. On by default; off isolates their effect. */
  readonly kinsoku?: boolean;
  /** `"greedy"` (default) or `"balanced"` — see `WrapStrategy`. */
  readonly strategy?: WrapStrategy;
}

/**
 * How the break positions are chosen. Both obey the same hard invariants: no
 * line is ever wider than the box, and no character is ever dropped. They
 * differ only in what they consider a good-looking block.
 *
 * - `greedy` fills each line and takes what is left, which is what a browser
 *   does by default. Cheapest, never surprising, and the last line is whatever
 *   remains — sometimes one word.
 * - `balanced` minimises the sum of squared slack over every line INCLUDING the
 *   last, which is the only way to even up a heading. On body copy it is the
 *   wrong tool: it pads the final line by shortening all the others.
 *
 * Roughly what CSS `text-wrap: balance` does, and for the same reason.
 *
 * A third strategy lived here — the textbook Knuth-Plass objective with the
 * last line free — and was deleted after being measured rather than argued
 * about: over 404 breaks it differed from `greedy` 13 times, and on two-line
 * text it never differed at all, because with the last line free the cheapest
 * two-line break is the one that fills line 1. Charging the last line is the
 * whole mechanism, so the free-last-line variant was a third name for the
 * default. `scripts/wrap-compare.ts` renders the comparison.
 */
export type WrapStrategy = "greedy" | "balanced";

/**
 * Break opportunities. `Intl.Segmenter` at word granularity is the whole reason
 * this handles Chinese at all: there are no spaces to split on, and it returns
 * `确定 / 性 / 视频 / 渲染 / ，` for text a space-splitter returns whole.
 */
export function segments(text: string, locale?: string): string[] {
  const seg = new Intl.Segmenter(locale, { granularity: "word" });
  return [...seg.segment(text)].map((s) => s.segment);
}

function graphemes(text: string, locale?: string): string[] {
  const seg = new Intl.Segmenter(locale, { granularity: "grapheme" });
  return [...seg.segment(text)].map((s) => s.segment);
}

/**
 * A memoised width over a candidate line. The segments are joined and the
 * resulting string is measured once — pair adjustments live between glyphs,
 * so a sum of per-segment widths is a different number. See the module header.
 */
export function cachedWidth(measure: Measure, tracking = 0): (segs: readonly string[]) => number {
  const cache = new Map<string, number>();
  return (segs) => {
    const text = segs.join("");
    let w = cache.get(text);
    if (w === undefined) {
      w = measure(text) + tracking * glyphCount(text);
      cache.set(text, w);
    }
    return w;
  };
}

/**
 * One paragraph reduced to the units a line can be built from.
 *
 * `items` never contains whitespace and every entry fits `maxWidth` on its own
 * — anything wider is already broken by grapheme here, so the breaker below
 * cannot be handed a unit it has no legal placement for. `seps[i]` is the
 * whitespace that precedes `items[i]`, kept beside it rather than inside it
 * because a separator that lands on a break is dropped.
 */
interface Units {
  readonly items: string[];
  readonly seps: string[];
}

function unitsOf(para: string, o: WrapOptions, width: (s: readonly string[]) => number): Units {
  const items: string[] = [];
  const seps: string[] = [];
  let pending = "";
  for (const seg of segments(para, o.locale)) {
    if (isSpace(seg)) {
      pending += seg;
      continue;
    }
    if (width([seg]) <= o.maxWidth) {
      items.push(seg);
      seps.push(pending);
      pending = "";
      continue;
    }
    // No word break to use: break the segment itself by grapheme cluster. Only
    // the first piece keeps the separator; the rest butt against it.
    let cluster: string[] = [];
    for (const g of graphemes(seg, o.locale)) {
      if (cluster.length > 0 && width([...cluster, g]) > o.maxWidth) {
        items.push(cluster.join(""));
        seps.push(pending);
        pending = "";
        cluster = [];
      }
      cluster.push(g);
    }
    if (cluster.length > 0) {
      items.push(cluster.join(""));
      seps.push(pending);
      pending = "";
    }
  }
  return { items, seps };
}

/** Is breaking BEFORE `items[j]` forbidden by the 禁則 sets? */
function breakBlocked(items: readonly string[], j: number): boolean {
  const next = items[j];
  const prev = items[j - 1];
  if (next === undefined || prev === undefined) return false;
  return NO_START.has([...next][0]!) || NO_END.has([...prev][glyphCount(prev) - 1]!);
}

/**
 * Minimum-raggedness breaking.
 *
 * Each line is charged the square of its slack, so two half-empty lines cost far
 * more than one snug line and one short one, and the optimum is the even block.
 * The LAST line pays too, which is the whole difference from the textbook
 * objective: leave it free and the cheapest two-line break is the one that fills
 * line 1, which is what greedy already does (see `WrapStrategy`).
 *
 * Each candidate `[i, j)` is measured as the joined line, because width is
 * not additive across a split (see the module header). This pass considers
 * many more candidates than the greedy one.
 */
function balancedBreaks(
  u: Units,
  o: WrapOptions,
  width: (s: readonly string[]) => number,
): string[] {
  const { items, seps } = u;
  const n = items.length;
  if (n === 0) return [""];
  const kinsoku = o.kinsoku ?? true;

  // Line [i, j) drops the separator that would have started it.
  const lineText = (i: number, j: number): string => {
    let s = items[i]!;
    for (let k = i + 1; k < j; k++) s += seps[k]! + items[k]!;
    return s;
  };
  const lineWidth = (i: number, j: number): number => width([lineText(i, j)]);

  // Large enough to dominate any raggedness total (slack is bounded by the box
  // width, and a line count by the item count) without reaching the range where
  // doubles stop separating sums.
  const KINSOKU_PENALTY = 1e12;
  /** Charged once per line that cannot fit at all, above any kinsoku total. */
  const UNBREAKABLE_PENALTY = 1e15;

  const best = new Float64Array(n + 1).fill(Infinity);
  const from = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const w = lineWidth(i, j);
      if (w > o.maxWidth) break; // wider only as i decreases
      if (best[i] === Infinity) continue;
      const slack = o.maxWidth - w;
      let cost = slack * slack;
      if (kinsoku && j < n && breakBlocked(items, j)) cost += KINSOKU_PENALTY;
      const total = best[i]! + cost;
      if (total < best[j]!) {
        best[j] = total;
        from[j] = i;
      }
    }
    if (best[j] === Infinity) {
      // No legal line ends at j, which happens only when `items[j-1]` is a
      // single grapheme wider than the box — a box narrower than one glyph.
      // Greedy puts it on a line of its own and lets the box lose; so does
      // this. Without the fallback `from[j]` stays -1 and the reconstruction
      // below walks off the front of `items`, which silently returned the whole
      // paragraph on ONE unwrapped line rather than failing.
      best[j] = best[j - 1]! + UNBREAKABLE_PENALTY;
      from[j] = j - 1;
    }
  }

  const out: string[] = [];
  for (let j = n; j > 0; ) {
    const i = from[j]!;
    const parts: string[] = [];
    for (let k = i; k < j; k++) parts.push(k === i ? items[k]! : seps[k]! + items[k]!);
    out.push(parts.join(""));
    j = i;
  }
  return out.reverse();
}

/**
 * Line breaking. Explicit '\n' in `text` is preserved as a hard break.
 *
 * Greedy by default; `strategy: "balanced"` minimises raggedness instead.
 */
export function wrapLines(text: string, o: WrapOptions): string[] {
  const width = cachedWidth(o.measure, o.tracking ?? 0);
  const kinsoku = o.kinsoku ?? true;
  const out: string[] = [];

  for (const para of text.split("\n")) {
    if (para === "") {
      out.push("");
      continue;
    }
    if (o.strategy === "balanced") {
      out.push(...balancedBreaks(unitsOf(para, o, width), o, width));
      continue;
    }
    let line: string[] = [];
    let pending: string[] = []; // whitespace run, dropped if it lands on a break

    const flush = (): void => {
      // Drop whitespace left at the end of a line. It draws nothing, but it is
      // not free: it advances the pen, so it inflates the measured width, and
      // under `text-align: center` (`text.rs` `layout_run` centres on the pen)
      // it shifts the whole line left by half a space.
      while (line.length > 0 && isSpace(line[line.length - 1]!)) line.pop();
      out.push(line.join(""));
      line = [];
    };

    const push = (seg: string): void => {
      // A segment wider than the box on its own has no word break to use, so it
      // is broken by grapheme cluster. This has to be checked BEFORE the normal
      // path and whatever is already on the line: guarding it on an empty line
      // only (the first version of this) leaves every over-long word that is not
      // first on its line flushed onto a line of its own and never broken —
      // "screenshot" at 38px is 320px wide and sat in a 200px box.
      if (width([seg]) > o.maxWidth) {
        if (line.length > 0) flush();
        pending = [];
        let cluster: string[] = [];
        for (const g of graphemes(seg, o.locale)) {
          if (cluster.length > 0 && width([...cluster, g]) > o.maxWidth) {
            line = cluster;
            flush();
            cluster = [];
          }
          cluster.push(g);
        }
        line = cluster;
        return;
      }
      const trial = [...line, ...pending, seg];
      if (line.length > 0 && width(trial) > o.maxWidth) {
        if (kinsoku) {
          // 追い出し: rather than break before a character that may not start a
          // line (or after one that may not end one), send the previous
          // segment down with it.
          const last = line[line.length - 1]!;
          const blocked =
            NO_START.has([...seg][0]!) || NO_END.has([...last][glyphCount(last) - 1]!);
          // The pair carries the separator that was between them, and it only
          // goes down if it FITS. The first version did neither: it rebuilt the
          // line as `[last, seg]`, which dropped the space (`beta ，` became
          // `beta，`) and never checked the width, so `text»` sat 10px past a
          // 40px box — a silent violation of the one invariant this module has.
          const moved = [last, ...pending, seg];
          if (blocked && line.length > 1 && width(moved) <= o.maxWidth) {
            line.pop();
            flush();
            line = moved;
            pending = [];
            return;
          }
        }
        flush();
        line = [seg];
      } else {
        line = trial;
      }
      pending = [];
    };

    for (const seg of segments(para, o.locale)) {
      if (isSpace(seg)) pending.push(seg);
      else push(seg);
    }
    flush();
  }
  return out;
}

/** `wrapLines` joined with '\n' — what a generated composition emits. */
export const wrap = (text: string, o: WrapOptions): string => wrapLines(text, o).join("\n");

export interface FitCandidate {
  /** Font size in px — must be a size the build actually bakes a slot for. */
  readonly px: number;
  readonly measure: Measure;
  /** Atlas line advance for this slot, from the pak header. */
  readonly lineHeight: number;
  readonly tracking?: number;
}

export interface FitResult {
  readonly px: number;
  readonly text: string;
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
  /** True when even the smallest candidate overflows — the caller has to widen
   *  the box or cut the copy, and should be told rather than handed a lie. */
  readonly overflows: boolean;
}

/**
 * Largest candidate size whose wrapped block fits `maxWidth` x `maxHeight`.
 *
 * Sizes must be measured, not scaled from one bake: advances are `u8` LOGICAL
 * px per glyph, so a 38px bake is not a 64px bake times 38/64 — the rounding is
 * per glyph and the error accumulates along the line.
 */
export function fitToBox(
  text: string,
  box: { readonly maxWidth: number; readonly maxHeight: number },
  candidates: readonly FitCandidate[],
  locale?: string,
  strategy?: WrapStrategy,
): FitResult {
  const ordered = [...candidates].sort((a, b) => b.px - a.px);
  let last: FitResult | undefined;
  for (const c of ordered) {
    const lines = wrapLines(text, {
      maxWidth: box.maxWidth,
      measure: c.measure,
      locale,
      tracking: c.tracking,
      strategy,
    });
    const width = cachedWidth(c.measure, c.tracking ?? 0);
    const w = Math.max(...lines.map((l) => width([l])), 0);
    const h = lines.length * c.lineHeight;
    const r: FitResult = {
      px: c.px,
      text: lines.join("\n"),
      lines,
      width: w,
      height: h,
      overflows: w > box.maxWidth || h > box.maxHeight,
    };
    if (!r.overflows) return r;
    last = r;
  }
  return last!;
}
