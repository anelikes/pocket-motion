/**
 * The transcript and the layout arithmetic the `compositions/captions/*`
 * generators share.
 *
 * A caption style is a treatment of word-level timestamps: a transcript exists
 * before the render, so every word's time is a number a generator turns into
 * an animation delay (AUTHORING.md, "Mount-only is not 'no data-driven
 * timing'"). Five styles here are ports of the caption presets in the
 * HyperFrames catalog, re-expressed as baked timelines: the cadence, sizes,
 * colours and easings are theirs, read off their sources; the sentence is this
 * project's own.
 *
 * Every word is placed at a MEASURED x: the renderer never wraps, and a
 * reveal that clips or a box that grows behind a word has to know how wide
 * the word is before the frame exists. `measureRow` asks the same advance
 * tables the pak will carry (`src/text/measure.ts`).
 */

import { openMeasurer } from "../text/measure.ts";

export interface Word {
  readonly text: string;
  /** seconds */
  readonly start: number;
  readonly end: number;
}

/** 28 words over 7.75s: the same shape as the catalog's demo transcript (a
 *  word every 0.1–0.5s, punctuation-ended phrases, a pause before each new
 *  sentence), with this project's copy. */
export const WORDS: readonly Word[] = [
  { text: "Every", start: 0.0, end: 0.3 },
  { text: "frame", start: 0.3, end: 0.55 },
  { text: "is", start: 0.55, end: 0.7 },
  { text: "a", start: 0.7, end: 0.8 },
  { text: "hash.", start: 0.8, end: 1.15 },
  { text: "Nothing", start: 1.25, end: 1.55 },
  { text: "moves", start: 1.55, end: 1.8 },
  { text: "by", start: 1.8, end: 1.95 },
  { text: "accident.", start: 1.95, end: 2.4 },
  { text: "Pocket", start: 2.5, end: 2.8 },
  { text: "motion", start: 2.8, end: 3.1 },
  { text: "bakes", start: 3.1, end: 3.35 },
  { text: "JSX", start: 3.35, end: 3.75 },
  { text: "and", start: 3.75, end: 3.85 },
  { text: "Tailwind", start: 3.85, end: 4.25 },
  { text: "into", start: 4.25, end: 4.45 },
  { text: "pixels.", start: 4.45, end: 4.85 },
  { text: "No", start: 4.95, end: 5.1 },
  { text: "browser.", start: 5.1, end: 5.5 },
  { text: "No", start: 5.55, end: 5.7 },
  { text: "wall", start: 5.7, end: 5.9 },
  { text: "clock.", start: 5.9, end: 6.25 },
  { text: "Just", start: 6.35, end: 6.55 },
  { text: "code", start: 6.55, end: 6.8 },
  { text: "that", start: 6.8, end: 6.95 },
  { text: "becomes", start: 6.95, end: 7.3 },
  { text: "a", start: 7.3, end: 7.4 },
  { text: "film.", start: 7.4, end: 7.75 },
];

/** Indices the styles colour as keywords. */
export const KEYWORDS: ReadonlySet<number> = new Set([4, 9, 10, 12, 16, 23, 27]);

export const DURATION_S = 8;
export const FPS = 30;
export const FRAMES = DURATION_S * FPS;

export interface Group {
  readonly first: number;
  readonly last: number;
  /** seconds */
  readonly start: number;
  readonly end: number;
}

/** Phrase groups by word index, inclusive. A group shows from its first
 *  word's start to half a second after its last word's end, or 50ms before
 *  the next group starts, whichever is sooner — the catalog's rule. */
export function groups(ranges: ReadonlyArray<readonly [number, number]>): Group[] {
  return ranges.map(([first, last], gi) => {
    const nextStart = gi + 1 < ranges.length ? WORDS[ranges[gi + 1]![0]]!.start : DURATION_S;
    return { first, last, start: WORDS[first]!.start, end: Math.min(WORDS[last]!.end + 0.5, nextStart - 0.05) };
  });
}

/** The phrase split the styles share: sentences broken at punctuation, at
 *  most four words to a group. */
export const PHRASES: ReadonlyArray<readonly [number, number]> = [
  [0, 4], [5, 8], [9, 10], [11, 13], [14, 16], [17, 18], [19, 21], [22, 24], [25, 27],
];

export const ms = (sec: number) => Math.round(sec * 1000);
export const px = (v: number) => `${v.toFixed(2)}px`;
export const jsx = (s: string) => JSON.stringify(s);

/** The default faces the build bakes when the sidecar declares none. Passed
 *  to the measurer so the widths come from the pak's own advance tables. */
export function defaultFaces(repoRoot: string): { regular: string; bold: string } {
  return {
    regular: `${repoRoot}vendor/pocketjs/assets/fonts/Inter-Regular.ttf`,
    bold: `${repoRoot}vendor/pocketjs/assets/fonts/Inter-Bold.ttf`,
  };
}

export interface Placed {
  readonly text: string;
  readonly x: number;
  readonly w: number;
}

/** Widths for every string at every size the caller will use, then rows
 *  laid out from them. Returns a closure; call `close()` when done. */
export async function openRowMeasurer(opts: {
  repoRoot: string;
  sizes: readonly number[];
  bold: boolean;
  texts: readonly string[];
  density: number;
}): Promise<{
  width: (text: string, size: number) => number;
  lineHeight: (size: number) => number;
  /** Lay `texts` on one row with `gap` between them, centred on `cx`. */
  row: (texts: readonly string[], size: number, gap: number, cx: number) => Placed[];
  close: () => Promise<void>;
}> {
  const m = await openMeasurer({
    face: defaultFaces(opts.repoRoot),
    sizes: opts.sizes.map((px) => ({ px, bold: opts.bold })),
    texts: opts.texts,
    density: opts.density,
  });
  const width = (text: string, size: number) => m.measure(size, opts.bold)(text);
  return {
    width,
    lineHeight: (size) => m.lineHeight(size, opts.bold),
    row: (texts, size, gap, cx) => {
      const ws = texts.map((t) => width(t, size));
      const total = ws.reduce((a, b) => a + b, 0) + gap * (texts.length - 1);
      let x = cx - total / 2;
      return texts.map((text, i) => {
        const p = { text, x, w: ws[i]! };
        x += ws[i]! + gap;
        return p;
      });
    },
    close: () => m.close(),
  };
}

/** Shorthand builders for the animation registry every generator keeps. */
export function registry() {
  const keyframes: Record<string, Record<string, Record<string, string>>> = {
    gin: { from: { opacity: "0" }, to: { opacity: "1" } },
    gout: { from: { opacity: "1" }, to: { opacity: "0" } },
  };
  const animation: Record<string, string> = {};
  let n = 0;
  /** Register a comma list under a fresh name and return the name. */
  const anim = (value: string): string => {
    const name = `a${n++}`;
    animation[name] = value;
    return name;
  };
  /** One-tick step gate: painted from `from`, gone from `until`. */
  const gate = (from: number, until?: number): string =>
    until === undefined
      ? `gin 17ms linear ${from}ms both`
      : `gin 17ms linear ${from}ms both, gout 17ms linear ${until}ms forwards`;
  return { keyframes, animation, anim, gate };
}

/** GSAP's named eases as the bezier the compiler bakes. */
export const EASE = {
  power2out: "cubic-bezier(0.33,1,0.68,1)",
  power2in: "cubic-bezier(0.32,0,0.67,0)",
  power3out: "cubic-bezier(0.22,1,0.36,1)",
  expoOut: "cubic-bezier(0.16,1,0.3,1)",
  /** back.out(1.7) */
  backOut: "cubic-bezier(0.34,1.56,0.64,1)",
  /** back.out(2.2) */
  backOutHard: "cubic-bezier(0.34,1.9,0.64,1)",
} as const;

/** The files every caption composition writes, given its nodes and registry. */
export async function writeComposition(opts: {
  outDir: string;
  name: string;
  body: string;
  keyframes: Record<string, Record<string, Record<string, string>>>;
  animation: Record<string, string>;
  supersample: number;
  /** Repo-relative depth of the composition dir, for the config import. */
  depth: number;
}): Promise<void> {
  const up = "../".repeat(opts.depth);
  await Bun.write(
    `${opts.outDir}main.tsx`,
    `// GENERATED by compositions/captions/${opts.name}/gen.ts — do not edit by hand.
// Mount-only: every motion is a baked keyframe timeline the core plays itself.

import { mount } from "@pocketjs/framework";
import { Text, View } from "@pocketjs/framework/components";

mount(() => (
  <View class="w-full h-full bg-gradient-to-b from-[#1b1f27] to-[#04050a]">
    <View class="absolute left-0 top-0 w-[1920px] h-[1080px]">
${opts.body}
    </View>
  </View>
));
`,
  );
  await Bun.write(
    `${opts.outDir}pocket.config.ts`,
    `// GENERATED by compositions/captions/${opts.name}/gen.ts — do not edit by hand.
import { definePocketConfig } from "${up}vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: ${JSON.stringify(opts.keyframes, null, 6).replace(/\n/g, "\n  ")},
    animation: ${JSON.stringify(opts.animation, null, 6).replace(/\n/g, "\n  ")},
  },
});
`,
  );
  await Bun.write(
    `${opts.outDir}pocket-motion.json`,
    JSON.stringify({ motion: 1, durationFrames: FRAMES, fps: FPS, supersample: opts.supersample }, null, 2) + "\n",
  );
}
