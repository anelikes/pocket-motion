/**
 * The five caption treatments, over pages `src/captions/layout.ts` laid out.
 *
 * These are the styles `compositions/captions/*` ported from the HyperFrames
 * catalog — cadence, easings and colours as `compositions/captions/NOTES.md`
 * records them — re-expressed for what a product needs and a single fixed
 * row did not: any number of lines, three aspects, any transcript, and a
 * contract about time. **Every word is in the picture at every frame of its
 * window** (`WordWindow`), and the sidecar the template writes asserts it,
 * one `inPicture` per word. What each treatment had to do to keep that:
 *
 * - every entrance starts one tick before the frame it is due on
 *   (`gateInTick`), so the frame a word is spoken on already shows it part-way
 *   in rather than at its first keyframe — a fade at zero, a clip window at
 *   zero width;
 * - every exit reaches zero exactly on the frame the page gives way
 *   (`fadeOutTo`), never earlier, so the last word of a page is still drawn on
 *   the last frame of its window;
 * - a page's entrance and its exit sit on two nested wrappers, so their
 *   opacities multiply instead of contending for one property.
 *
 * A clip window that has closed to zero width needs no gate of its own: it
 * emits no geometry, so `visibility` reads it as invisible by declaration and
 * never as covered — measured on `compositions/captions/burn-zh` at every one
 * of its 101 frames with the windows ungated, 0 nodes covered.
 *
 * Every word node carries `debugName="w<index>"` (`w<index>.<piece>` when a
 * spaceless word was split across lines), which is what opts it into
 * `visibility` and what the assertions name.
 */

import { clockAt, fadeOutTo, gateInTick, gateOutTick, msOfTicks, ticksOfMs } from "./clock.ts";
import type { Metrics, Page, PlacedUnit, Position, TrackLayout, WordWindow } from "./layout.ts";

export const STYLE_NAMES = ["highlight", "pill-karaoke", "clip-wipe", "matrix-decode", "kinetic-slam"] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

export const CASES = ["upper", "lower", "none"] as const;
export type TextCase = (typeof CASES)[number];

/** Colour keys, per style, and what each one paints. */
export const STYLE_COLOURS: Readonly<Record<StyleName, Readonly<Record<string, string>>>> = {
  highlight: { ink: "#ffffff", box: "#ff1745" },
  "pill-karaoke": { pill: "#e7e5e7", inactive: "#a6a6a6", active: "#1c1e1d" },
  "clip-wipe": { ink: "#ffffff", accent: "#ffd700", spoken: "#ffffff66" },
  "matrix-decode": { ink: "#00ff41" },
  "kinetic-slam": { ink: "#ffffff", accent: "#ffd700" },
};

/** Styles that colour `keywords` with their `accent`. */
export const KEYWORD_STYLES: ReadonlySet<StyleName> = new Set(["clip-wipe", "kinetic-slam"]);

export interface StyleDefaults {
  /** Text size at a 1080 px short side; scaled linearly with the viewport. */
  readonly size: number;
  /** `minSize` as a fraction of `size`. */
  readonly minRatio: number;
  readonly case: TextCase;
  readonly position: Position;
  readonly maxLines: number;
  readonly maxWords: number | null;
  readonly pauseMs: number;
  readonly holdMs: number;
  /** One size for the whole track, or the largest that fits per page. */
  readonly fit: "track" | "page";
}

/**
 * Defaults, from the catalog sources where they had one. `kinetic-slam` is
 * 160 rather than the catalog's 220 (and the port's 200): the CJK face here
 * bakes up to 176 px (AGENTS.md, "the largest bakeable text size"), and a
 * default that refuses half the languages is not a default.
 */
export const STYLE_DEFAULTS: Readonly<Record<StyleName, StyleDefaults>> = {
  highlight: { size: 80, minRatio: 0.7, case: "upper", position: "bottom", maxLines: 2, maxWords: null, pauseMs: 400, holdMs: 500, fit: "track" },
  "pill-karaoke": { size: 72, minRatio: 0.7, case: "lower", position: "bottom", maxLines: 2, maxWords: 4, pauseMs: 400, holdMs: 300, fit: "track" },
  "clip-wipe": { size: 88, minRatio: 0.7, case: "upper", position: "bottom", maxLines: 2, maxWords: null, pauseMs: 400, holdMs: 500, fit: "track" },
  "matrix-decode": { size: 96, minRatio: 0.7, case: "none", position: "bottom", maxLines: 2, maxWords: null, pauseMs: 400, holdMs: 500, fit: "track" },
  "kinetic-slam": { size: 160, minRatio: 0.5, case: "upper", position: "center", maxLines: 1, maxWords: 1, pauseMs: 400, holdMs: 300, fit: "page" },
};

/** Spacing at size `s`, in whole px. Ratios are the catalog's, read at its size. */
export function metricsOf(style: StyleName, s: number): Metrics {
  const r = (k: number): number => Math.round(k * s);
  const none = { padX: 0, padTop: 0, padBottom: 0, slack: 0, blockPadX: 0, blockPadTop: 0, blockPadBottom: 0 };
  switch (style) {
    case "highlight": // padding 12/6/8 and gap 8 at 80 px
      return { ...none, padX: r(0.15), padTop: r(0.075), padBottom: r(0.1), gap: r(0.1), tightGap: r(0.05), lineGap: r(0.1) };
    case "pill-karaoke": // pill padding 60/18/20 and gap 16 at 72 px
      return { ...none, gap: r(0.22), tightGap: 0, lineGap: r(0.05), blockPadX: r(0.83), blockPadTop: r(0.25), blockPadBottom: r(0.28) };
    case "clip-wipe": // gap 24 at 88 px; 2 px of slack so the last glyph's edge is inside its window
      return { ...none, slack: 2, gap: r(0.27), tightGap: 0, lineGap: r(0.05) };
    case "matrix-decode": // gap 24 at 96 px
      return { ...none, gap: r(0.25), tightGap: 0, lineGap: r(0.05) };
    case "kinetic-slam":
      return { ...none, gap: r(0.25), tightGap: 0, lineGap: 0 };
  }
}

/** GSAP's named eases as the bezier the compiler bakes (`transcript.ts` `EASE`). */
const EASE = {
  power2out: "cubic-bezier(0.33,1,0.68,1)",
  power2in: "cubic-bezier(0.32,0,0.67,0)",
  expoOut: "cubic-bezier(0.16,1,0.3,1)",
  backOut: "cubic-bezier(0.34,1.56,0.64,1)",
  backOutHard: "cubic-bezier(0.34,1.9,0.64,1)",
} as const;

export interface StyleParams {
  readonly name: StyleName;
  readonly colours: Readonly<Record<string, string>>;
  /** Normalised (`keywordKey`) keywords; empty for styles without an accent. */
  readonly keywords: ReadonlySet<string>;
}

export interface RenderInput {
  readonly layout: TrackLayout;
  readonly params: StyleParams;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  /** The characters a scramble may draw from: the transcript's own, for a spaceless language. */
  readonly scrambleFrom: string;
}

export interface Rendered {
  /** JSX for the caption layer, indented for the generated tree. */
  readonly body: string;
  readonly keyframes: Record<string, Record<string, Record<string, string>>>;
  readonly animation: Record<string, string>;
  /** Node name and window, one per drawn word node. */
  readonly named: ReadonlyArray<{ readonly node: string; readonly window: WordWindow }>;
}

/** A keyword match ignores case and the punctuation attached to a word. */
export const keywordKey = (s: string): string => s.replace(/^\p{P}+|\p{P}+$/gu, "").toLowerCase();

export const px = (v: number): string => `${Number.isInteger(v) ? v : v.toFixed(2)}px`;

/**
 * A `Text` child as a JSX expression. A word that matches the build's picture
 * pattern (`^[\w./-]+\.(?:png|svg)$` over every string literal — AUTHORING.md,
 * "Still pictures") is written as two literals, so a transcript that says
 * "logo.png" is drawn as text instead of making the build look for a file.
 */
export function textLiteral(s: string): string {
  const m = /^([\w./-]+)(\.(?:png|svg))$/.exec(s);
  return m ? `{${JSON.stringify(m[1])} + ${JSON.stringify(m[2])}}` : `{${JSON.stringify(s)}}`;
}

/** Keyframes and animations, deduplicated by content and named in first-use order. */
class Registry {
  readonly keyframes: Record<string, Record<string, Record<string, string>>> = {
    gin: { from: { opacity: "0" }, to: { opacity: "1" } },
    gout: { from: { opacity: "1" }, to: { opacity: "0" } },
  };
  readonly animation: Record<string, string> = {};
  private readonly byKeyframe = new Map<string, string>();
  private readonly byValue = new Map<string, string>();

  /** A keyframe block, by content; `stem` prefixes the name. */
  frames(stem: string, frames: Record<string, Record<string, string>>): string {
    const key = JSON.stringify(frames);
    let name = this.byKeyframe.get(key);
    if (name === undefined) {
      name = `${stem}${this.byKeyframe.size}`;
      this.byKeyframe.set(key, name);
      this.keyframes[name] = frames;
    }
    return name;
  }

  /** A comma list, by content. Empty list: no animation at all. */
  anim(entries: readonly (string | null)[]): string {
    const value = entries.filter((e): e is string => e !== null).join(", ");
    if (value === "") return "";
    let name = this.byValue.get(value);
    if (name === undefined) {
      name = `c${this.byValue.size}`;
      this.byValue.set(value, name);
      this.animation[name] = value;
    }
    return ` animate-${name}`;
  }
}

const ms = (ticks: number): string => `${msOfTicks(ticks)}ms`;

/** A one-tick gate in, at a delay from `gateInTick`; `null` is visible from the start. */
const ginAt = (delay: number | null): string | null => (delay === null ? null : `gin ${ms(1)} linear ${ms(delay)} both`);
/** A one-tick gate: visible from clock `from`, hidden from clock `until`. */
const gin = (from: number): string | null => ginAt(from <= 0 ? null : from - 1);
const gout = (until: number): string => `gout ${ms(1)} linear ${ms(until - 1)} forwards`;

/** A page's entrance: a fade starting one tick before its first frame. */
function fadeIn(page: Page, fps: number, durMs: number, ease: string): string | null {
  const d = gateInTick(page.startFrame, fps);
  return d === null ? null : `gin ${ms(ticksOfMs(durMs))} ${ease} ${ms(d)} both`;
}

/** A page's exit: a fade reaching zero exactly when the page gives way. */
function fadeOut(page: Page, fps: number, durMs: number, ease: string): string {
  const f = fadeOutTo(page.endFrame, fps, ticksOfMs(durMs));
  return `gout ${ms(f.ticks)} ${ease} ${ms(f.delay)} forwards`;
}

const nodeName = (u: PlacedUnit): string => (u.parts > 1 ? `w${u.word}.${u.part}` : `w${u.word}`);

/** mulberry32, so a scramble is a function of where it is and nothing else. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** The scramble strings a word shows before itself, decided at build time. */
export function scrambles(u: PlacedUnit, from: string): [string, string] {
  const pool = from.length > 0 ? [...from] : [...ALNUM];
  const n = from.length > 0 ? [...u.text].length : Math.min(8, Math.max(2, [...u.text].length));
  const make = (k: number): string => {
    const r = rng(u.word * 1000 + u.part * 10 + k);
    let out = "";
    for (let i = 0; i < n; i++) out += pool[Math.floor(r() * pool.length)];
    return out;
  };
  return [make(0), make(1)];
}

export function renderStyle(input: RenderInput): Rendered {
  const { layout, params, fps } = input;
  const reg = new Registry();
  const named: Array<{ node: string; window: WordWindow }> = [];
  const windowOf = new Map(layout.windows.map((w) => [w.word, w]));
  const W = input.width;
  const H = input.height;
  const full = `absolute left-0 top-0 w-[${W}px] h-[${H}px]`;
  const c = params.colours;
  const isKeyword = (u: PlacedUnit): boolean => params.keywords.has(keywordKey(u.text));
  const pages: string[] = [];

  for (const page of layout.pages) {
    const s = page.size;
    const m = page.metrics;
    const units = page.lines.flatMap((l) => l.units);
    const textCls = (colour: string): string => `text-[${s}px] font-bold text-[${colour}]`;
    const inner: string[] = [];
    const name = (u: PlacedUnit): string => {
      const n = nodeName(u);
      named.push({ node: n, window: windowOf.get(u.word)! });
      return n;
    };
    // When a word's entrance starts (one tick before its first frame, or
    // `null`: it is up from the first frame with nothing to start), and the
    // frame its window ends on.
    const lead = (u: PlacedUnit): number | null => gateInTick(windowOf.get(u.word)!.from, fps);
    const endFrame = (u: PlacedUnit): number => windowOf.get(u.word)!.to + 1;

    let enter: string | null;
    let leave: string;
    switch (params.name) {
      case "highlight": {
        enter = fadeIn(page, fps, 120, EASE.power2out);
        leave = fadeOut(page, fps, 100, EASE.power2in);
        for (const u of units) {
          const open = reg.frames("hw", { from: { width: "0px" }, to: { width: px(u.boxW) } });
          const d = lead(u);
          const box = reg.anim([
            d === null ? null : `${open} ${ms(ticksOfMs(150))} ${EASE.power2out} ${ms(d)} both`,
            d === null ? null : `gin ${ms(ticksOfMs(150))} ${EASE.power2out} ${ms(d)} both`,
            `gout ${ms(ticksOfMs(100))} ${EASE.power2in} ${ms(gateOutTick(endFrame(u), fps))} forwards`,
          ]);
          inner.push(
            `<View debugName="${name(u)}" class="absolute left-[${u.x}px] top-[${u.y}px] w-[${px(u.boxW)}] h-[${u.boxH}px]">`,
            `  <View class="absolute left-0 top-0 w-[${d === null ? px(u.boxW) : "0px"}] h-[${u.boxH}px] rounded-[${Math.round(0.125 * s)}px] bg-[${c.box}]${box}" />`,
            `  <View class="absolute left-[${m.padX}px] top-[${m.padTop}px]"><Text class="${textCls(c.ink!)}">${textLiteral(u.text)}</Text></View>`,
            `</View>`,
          );
        }
        break;
      }
      case "pill-karaoke": {
        enter = ginAt(gateInTick(page.startFrame, fps));
        leave = gout(clockAt(page.endFrame, fps));
        const b = page.block;
        inner.push(
          `<View class="absolute left-[${b.x}px] top-[${b.y}px] w-[${px(b.w)}] h-[${b.h}px] rounded-[${Math.round(0.3 * s)}px] bg-[${c.pill}]" />`,
        );
        const lit = reg.frames("lit", { from: { color: c.inactive! }, to: { color: c.active! } });
        const pageIn = gateInTick(page.startFrame, fps) ?? 0;
        for (const u of units) {
          // 50 ms early, as the catalog does it, but never before the page is up.
          const at = Math.max(pageIn, (lead(u) ?? 0) - ticksOfMs(50));
          const already = windowOf.get(u.word)!.from === page.startFrame;
          const cls = already ? textCls(c.active!) : textCls(c.inactive!) + reg.anim([`${lit} ${ms(ticksOfMs(100))} linear ${ms(at)} both`]);
          inner.push(
            `<View debugName="${name(u)}" class="absolute left-[${u.x}px] top-[${u.y}px]"><Text class="${cls}">${textLiteral(u.text)}</Text></View>`,
          );
        }
        break;
      }
      case "clip-wipe": {
        // Nothing to fade: before its turn a word's window is zero wide, and
        // after it the window has closed to zero again.
        enter = null;
        leave = gout(clockAt(page.endFrame, fps));
        const dim = reg.frames("dim", { from: { color: c.ink! }, to: { color: c.spoken! } });
        const gold = reg.frames("kw", { from: { color: c.ink! }, to: { color: c.accent! } });
        const goldDim = reg.frames("kwdim", { from: { color: c.accent! }, to: { color: c.spoken! } });
        const stagger = ticksOfMs(40);
        const pageEnd = clockAt(page.endFrame, fps);
        units.forEach((u, k) => {
          const w = Math.ceil(u.boxW);
          const open = reg.frames("cw", { from: { width: "0px" }, to: { width: px(w) } });
          const closeWin = reg.frames("cx", { from: { translateX: "0px", width: px(w) }, to: { translateX: px(w), width: "0px" } });
          const closeText = reg.frames("ct", { from: { translateX: "0px" }, to: { translateX: px(-w) } });
          // `null`: the window is open from the first frame, with nothing to open.
          const openAt = lead(u);
          // The window closes left to right, 40 ms apart, ending when the page
          // does — but never before the word's own window has ended.
          const closeEnd = Math.min(pageEnd, Math.max(clockAt(endFrame(u), fps), pageEnd - stagger * (units.length - 1 - k)));
          const closeDur = Math.max(1, Math.min(ticksOfMs(250), closeEnd - (openAt ?? -1) - 1));
          const closeAt = closeEnd - closeDur;
          const win = reg.anim([
            openAt === null ? null : `${open} ${ms(ticksOfMs(300))} ${EASE.power2out} ${ms(openAt)} both`,
            `${closeWin} ${ms(closeDur)} ${EASE.power2in} ${ms(closeAt)} forwards`,
          ]);
          const spoken = clockAt(endFrame(u), fps) - 1;
          const colour = isKeyword(u)
            ? [`${gold} ${ms(ticksOfMs(50))} linear ${ms((openAt ?? 0) + ticksOfMs(100))} both`, `${goldDim} ${ms(ticksOfMs(200))} linear ${ms(spoken)} forwards`]
            : [`${dim} ${ms(ticksOfMs(200))} linear ${ms(spoken)} forwards`];
          const txt = reg.anim([...colour, `${closeText} ${ms(closeDur)} ${EASE.power2in} ${ms(closeAt)} forwards`]);
          inner.push(
            `<View debugName="${name(u)}" class="absolute left-[${u.x}px] top-[${u.y}px] w-[${openAt === null ? px(w) : "0px"}] h-[${u.boxH}px] overflow-hidden${win}">`,
            `  <View class="absolute left-0 top-0"><Text class="${textCls(c.ink!)}${txt}">${textLiteral(u.text)}</Text></View>`,
            `</View>`,
          );
        });
        break;
      }
      case "matrix-decode": {
        enter = fadeIn(page, fps, 100, "linear");
        leave = fadeOut(page, fps, 120, "linear");
        for (const u of units) {
          // The clock the word's first frame samples, and how long it has.
          const t0 = clockAt(windowOf.get(u.word)!.from, fps);
          const span = clockAt(endFrame(u), fps) - t0;
          // Two scrambles of 100 ms each, shortened so the word itself
          // still lands inside its own window.
          const q = Math.min(ticksOfMs(100), Math.floor(span / 3));
          const [s0, s1] = scrambles(u, input.scrambleFrom);
          const lines = [`<View debugName="${name(u)}" class="absolute left-[${u.x}px] top-[${u.y}px] w-[${px(u.boxW)}] h-[${u.boxH}px]">`];
          const step = (text: string, enter: string | null, until: number | null): void => {
            const a = reg.anim([enter, until === null ? null : gout(until)]);
            lines.push(`  <View class="absolute left-0 top-0${a}"><Text class="${textCls(c.ink!)}">${textLiteral(text)}</Text></View>`);
          };
          if (q > 0) {
            step(s0, ginAt(lead(u)), t0 + q);
            step(s1, gin(t0 + q), t0 + 2 * q);
            step(u.text, gin(t0 + 2 * q), null);
          } else {
            step(u.text, ginAt(lead(u)), null);
          }
          lines.push(`</View>`);
          inner.push(...lines);
        }
        break;
      }
      case "kinetic-slam": {
        const short = Math.min(W, H);
        const dy = Math.round(0.111 * short);
        const dx = Math.round(0.278 * short);
        const ENTRANCES = [
          { frames: { from: { translateY: px(-dy), opacity: "0" }, to: { translateY: "0px", opacity: "1" } }, ms: 220, ease: EASE.backOut },
          { frames: { from: { translateX: px(-dx), opacity: "0" }, to: { translateX: "0px", opacity: "1" } }, ms: 200, ease: EASE.expoOut },
          { frames: { from: { translateX: px(dx), opacity: "0" }, to: { translateX: "0px", opacity: "1" } }, ms: 200, ease: EASE.expoOut },
          // The catalog scales up from 0.4 here. A scale moves baked glyphs and
          // never resizes them, so this one rises with the harder overshoot.
          { frames: { from: { translateY: px(dy), opacity: "0" }, to: { translateY: "0px", opacity: "1" } }, ms: 240, ease: EASE.backOutHard },
        ] as const;
        const e = ENTRANCES[page.index % 4]!;
        const d = gateInTick(page.startFrame, fps);
        enter = d === null ? null : `${reg.frames("slam", e.frames)} ${ms(ticksOfMs(e.ms))} ${e.ease} ${ms(d)} both`;
        leave = fadeOut(page, fps, 100, EASE.power2in);
        for (const u of units) {
          inner.push(
            `<View debugName="${name(u)}" class="absolute left-[${u.x}px] top-[${u.y}px]"><Text class="${textCls(isKeyword(u) ? c.accent! : c.ink!)}">${textLiteral(u.text)}</Text></View>`,
          );
        }
        break;
      }
    }
    pages.push(
      [
        `<View class="${full}${reg.anim([enter])}">`,
        `  <View class="${full}${reg.anim([leave])}">`,
        ...inner.map((l) => `    ${l}`),
        `  </View>`,
        `</View>`,
      ].join("\n"),
    );
  }

  return {
    body: pages.join("\n"),
    keyframes: reg.keyframes,
    animation: reg.animation,
    named,
  };
}
