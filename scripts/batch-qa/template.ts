/**
 * A product card, designed once and filled from a row: name, price, a one-line
 * claim, and a disclaimer that must stay on screen.
 *
 * It is built the way `compositions/lower-third/gen.ts` is — every field is
 * measured against the renderer's own advance table and fitted down a size
 * ladder at build time, because the core does not wrap (`src/text/fit.ts`).
 * What it does NOT do is refuse a row that does not fit. lower-third throws;
 * this emits the smallest rung and records that the fit said it would not
 * fit (`Fitted.predicted`), so the batch can compare the generator's own
 * prediction with what the pixels show. That comparison is the reason the
 * template is not a refusal.
 *
 * Every box that can be pushed is NAMED. `escaped_container` reports only a
 * node with a name or text, so the first version — whose price row was an
 * unnamed wrapper — let a 7-line name push that row 40 px out of the card
 * with no code against the row; the overflow surfaced only as the badge's
 * `content_overlap` with the legal strip below it.
 *
 * Every text sits in a box the checks can compare against. A run that leaves
 * the canvas is clamped by layout before anything reads it, so a disclaimer
 * whose last line is past the bottom edge produces no code at all
 * (`src/render/findings.ts`, `collapsedAtEdge`). The disclaimer therefore
 * rides in a fixed `legal` strip, and a disclaimer too long for it escapes the
 * strip, which is a box `escaped_container` can see.
 *
 * Written into a staged directory under `dist/` by `scripts/batch-qa/variant.ts`;
 * nothing here is a composition in `compositions/`, so neither ledger and no
 * test discovers it.
 */

import { join } from "node:path";

import type { Row } from "./rows.ts";
import type { Measurer } from "../../src/text/measure.ts";
import { cachedWidth, fitToBox, wrapLines } from "../../src/text/fit.ts";

export const VIEW = { w: 1920, h: 1080 } as const;
export const FPS = 30;
export const DURATION_FRAMES = 90;

export const FONTS = {
  regular: "assets/fonts/NotoSansSC-Regular.otf",
  bold: "assets/fonts/NotoSansSC-Bold.otf",
} as const;

/** Card geometry. The card's inner column is `CARD_W - 2 * PAD`. */
const CARD = { x: 120, y: 96, w: 1120, h: 760 } as const;
const PAD = 64;
const GAP = 28;
export const COLUMN = CARD.w - 2 * PAD;
const BADGE = { h: 132, padX: 36 } as const;
const LEGAL = { x: 120, y: 888, w: 1680, h: 148 } as const;
const HERO = { x: 1360, y: 160, w: 440, h: 640 } as const;

export const NAME_LADDER = [88, 76, 64, 56, 48] as const;
export const CLAIM_LADDER = [40, 34, 30] as const;
export const PRICE_LADDER = [80, 64, 52] as const;
/** Legal copy is not shrunk: a disclaimer below its size is not a disclaimer. */
export const DISCLAIMER_PX = 24;

/** Lines each field is designed for, at its largest rung. */
const NAME_LINES = 2;
const CLAIM_LINES = 3;
const DISCLAIMER_LINES = 4;

/** Every slot the template draws with. The measurer must bake exactly these. */
export const SIZES = [
  ...NAME_LADDER.map((px) => ({ px, bold: true })),
  ...CLAIM_LADDER.map((px) => ({ px })),
  ...PRICE_LADDER.map((px) => ({ px, bold: true })),
  { px: DISCLAIMER_PX },
] as const;

/** Frame by which every field has finished entering, and the clock's last frame. */
export const SETTLED_FRAME = 30;
export const LAST_FRAME = DURATION_FRAMES - 1;
/** Two seconds of disclaimer, the requirement the sidecar asserts. */
export const DISCLAIMER_DWELL = 60;

const PALETTE = {
  ground: "#0b1020",
  card: "#f8fafc",
  ink: "#0f172a",
  muted: "#334155",
  badge: "#dc2626",
  badgeInk: "#ffffff",
  legal: "#94a3b8",
  hero: "#f59e0b",
} as const;

export interface FittedField {
  readonly text: string;
  readonly px: number;
  readonly lines: number;
  /** The fit's own verdict: even the smallest rung leaves the field's box. */
  readonly overflows: boolean;
  /**
   * Line breaks that fall between two letters of one alphabetic word. `wrapLines`
   * breaks a segment wider than the box by grapheme cluster and adds no hyphen,
   * so `Kühlschrankzubehör` can end one line at `Kühlschra`. The box holds, no
   * pixel leaves it, and no gate reads spelling — this is counted here because
   * nothing downstream can count it.
   */
  readonly brokenWords: number;
}

export interface Fitted {
  readonly name: FittedField;
  readonly claim: FittedField;
  readonly price: FittedField;
  readonly disclaimer: FittedField;
  /** Fields the generator itself says will not fit. */
  readonly predicted: readonly string[];
}

/** A row the face cannot draw. Raised by the measurer; the variant is refused. */
export class GlyphRefusal extends Error {
  constructor(readonly field: string, readonly missing: readonly string[], cause: string) {
    super(`${field}: ${cause}`);
  }
}

/**
 * Whitespace collapsed and trimmed, as a template written against a form
 * would. A tab or a run of spaces is not something a field means.
 */
export function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const ALPHA = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Nd}]/u;

/**
 * Breaks in `wrapped` that fall inside a word of `source`: no whitespace was
 * dropped there, and the characters either side are letters or digits.
 * `wrapLines` drops the space it breaks at, so the wrapped text alone cannot
 * tell `Acme / Kühl…` from `Kühlschra / nk…`; the source can.
 */
export function brokenWords(source: string, wrapped: string): number {
  const lines = wrapped.split("\n");
  let pos = 0;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const at = source.indexOf(lines[i]!, pos);
    if (at < 0) return n; // not a wrap of this source; count nothing more
    pos = at + lines[i]!.length;
    if (i + 1 === lines.length) break;
    if (/\s/.test(source[pos] ?? "")) continue;
    const end = [...lines[i]!].at(-1);
    const start = [...lines[i + 1]!][0];
    if (end !== undefined && start !== undefined && ALPHA.test(end) && ALPHA.test(start)) n++;
  }
  return n;
}

function guard<T>(field: string, m: Measurer, text: string, px: number, bold: boolean, f: () => T): T {
  const missing = m.unmapped(text, px, bold);
  if (missing.length > 0) {
    throw new GlyphRefusal(
      field,
      missing,
      `${missing.length} codepoint(s) the face does not carry: ${missing.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}`,
    );
  }
  return f();
}

function ladderFit(
  field: string,
  m: Measurer,
  text: string,
  ladder: readonly number[],
  bold: boolean,
  lines: number,
): FittedField {
  return guard(field, m, text, ladder[0]!, bold, () => {
    const r = fitToBox(
      text,
      { maxWidth: COLUMN, maxHeight: lines * m.lineHeight(ladder[0]!, bold) },
      ladder.map((px) => ({ px, measure: m.measure(px, bold), lineHeight: m.lineHeight(px, bold) })),
      "en",
    );
    return { text: r.text, px: r.px, lines: r.lines.length, overflows: r.overflows, brokenWords: brokenWords(text, r.text) };
  });
}

/** The price is one line or it is a different price: never wrapped, only shrunk. */
function priceFit(m: Measurer, text: string): FittedField {
  const room = COLUMN - 2 * BADGE.padX;
  return guard("price", m, text, PRICE_LADDER[0], true, () => {
    for (const px of PRICE_LADDER) {
      if (m.measure(px, true)(text) <= room) return { text, px, lines: 1, overflows: false, brokenWords: 0 };
    }
    return { text, px: PRICE_LADDER.at(-1)!, lines: 1, overflows: true, brokenWords: 0 };
  });
}

function disclaimerFit(m: Measurer, text: string): FittedField {
  return guard("disclaimer", m, text, DISCLAIMER_PX, false, () => {
    const measure = m.measure(DISCLAIMER_PX);
    const lines = wrapLines(text, { maxWidth: LEGAL.w, measure, locale: "en" });
    const widest = Math.max(0, ...lines.map((l) => cachedWidth(measure)([l])));
    return {
      text: lines.join("\n"),
      px: DISCLAIMER_PX,
      lines: lines.length,
      overflows: widest > LEGAL.w || lines.length > DISCLAIMER_LINES,
      brokenWords: brokenWords(text, lines.join("\n")),
    };
  });
}

export function fit(row: Pick<Row, "name" | "price" | "claim" | "disclaimer">, m: Measurer): Fitted {
  const name = ladderFit("name", m, clean(row.name), NAME_LADDER, true, NAME_LINES);
  const claim = ladderFit("claim", m, clean(row.claim), CLAIM_LADDER, false, CLAIM_LINES);
  const price = priceFit(m, clean(row.price));
  const disclaimer = disclaimerFit(m, clean(row.disclaimer));
  const fields = { name, claim, price, disclaimer };
  return {
    ...fields,
    predicted: Object.entries(fields)
      .filter(([, f]) => f.overflows)
      .map(([k]) => k),
  };
}

export const MAIN_TSX = `// @title PocketJS Motion — batch-QA product card
import { mount } from "@pocketjs/framework";
import ProductCard from "./app.tsx";

mount(() => <ProductCard />);
`;

export const POCKET_JSON =
  JSON.stringify(
    {
      $schema: "https://pocketjs.dev/schema/pocket-2.json",
      pocket: 2,
      id: "dev.pocket-stack.motion-batch-qa-card",
      name: "pocketjs-motion-batch-qa-card",
      title: "PocketJS Motion: batch-QA product card",
      version: "0.0.0",
      engine: { capabilities: { requires: ["text.glyphs.baked"] } },
      app: {
        entry: "main.tsx",
        output: "main",
        framework: "solid",
        viewport: { fixed: { logical: [VIEW.w, VIEW.h], presentation: "native" } },
      },
    },
    null,
    2,
  ) + "\n";

/**
 * Entrances, all `both` so each holds its end value to the last frame. Every
 * delay and duration is a multiple of 100 ms — six ticks at 60 Hz, three
 * frames at 30 fps — so no instant falls on a tick the render never samples
 * (`keyframes` reports those).
 */
export const POCKET_CONFIG = `import { definePocketConfig } from "../../vendor/pocketjs/framework/src/config.ts";

export default definePocketConfig({
  theme: {
    keyframes: {
      slide: { from: { opacity: "0", translateX: "-48px" }, to: { opacity: "1", translateX: "0px" } },
      rise: { from: { opacity: "0", translateY: "24px" }, to: { opacity: "1", translateY: "0px" } },
      pop: { from: { opacity: "0", scale: "0.85" }, to: { opacity: "1", scale: "1" } },
      fade: { from: { opacity: "0" }, to: { opacity: "1" } },
    },
    animation: {
      card: { value: "slide 400ms ease-out 0ms both" },
      hero: { value: "fade 500ms ease-out 100ms both" },
      "rise-name": { value: "rise 400ms ease-out 200ms both" },
      "rise-claim": { value: "rise 400ms ease-out 300ms both" },
      badge: { value: "pop 300ms ease-out 500ms both" },
      legal: { value: "fade 300ms linear 600ms both" },
    },
  },
});
`;

export function appSource(f: Fitted): string {
  const p = PALETTE;
  const t = (s: string): string => JSON.stringify(s);
  return `// GENERATED by scripts/batch-qa/template.ts — do not edit.

import { Text, View } from "@pocketjs/framework/components";

export default function ProductCard() {
  return (
    <View class="w-full h-full bg-[${p.ground}] relative">
      <View debugName="hero" class="animate-hero absolute left-[${HERO.x}px] top-[${HERO.y}px] w-[${HERO.w}px] h-[${HERO.h}px] rounded-[28px] bg-[${p.hero}]" />
      <View debugName="card" class="animate-card absolute left-[${CARD.x}px] top-[${CARD.y}px] w-[${CARD.w}px] h-[${CARD.h}px] rounded-[28px] bg-[${p.card}] flex-col p-[${PAD}px] gap-[${GAP}px]">
        <Text debugName="name" class="animate-rise-name w-[${COLUMN}px] text-[${f.name.px}px] font-bold text-[${p.ink}]">{${t(f.name.text)}}</Text>
        <Text debugName="claim" class="animate-rise-claim w-[${COLUMN}px] text-[${f.claim.px}px] text-[${p.muted}]">{${t(f.claim.text)}}</Text>
        <View debugName="price-row" class="flex-row">
          <View debugName="price-badge" class="animate-badge flex-row items-center h-[${BADGE.h}px] px-[${BADGE.padX}px] rounded-[20px] bg-[${p.badge}]">
            <Text debugName="price" class="text-[${f.price.px}px] font-bold text-[${p.badgeInk}]">{${t(f.price.text)}}</Text>
          </View>
        </View>
      </View>
      <View debugName="legal" class="animate-legal absolute left-[${LEGAL.x}px] top-[${LEGAL.y}px] w-[${LEGAL.w}px] h-[${LEGAL.h}px] flex-col">
        <Text debugName="disclaimer" class="w-[${LEGAL.w}px] text-[${DISCLAIMER_PX}px] text-[${p.legal}]">{${t(f.disclaimer.text)}}</Text>
      </View>
    </View>
  );
}
`;
}

/**
 * What the card is FOR, as `assert` reads it. The disclaimer is the one with
 * a legal floor: on screen for two seconds and never outside its strip.
 */
export function sidecarSource(): string {
  return (
    JSON.stringify(
      {
        motion: 1,
        durationFrames: DURATION_FRAMES,
        fps: FPS,
        supersample: 1,
        fonts: FONTS,
        assertions: [
          { node: "disclaimer", dwellFrames: DISCLAIMER_DWELL },
          { node: "disclaimer", insideBox: true },
          { node: "name", inPicture: [SETTLED_FRAME, LAST_FRAME] },
          { node: "name", insideBox: true },
          { node: "price", inPicture: [SETTLED_FRAME, LAST_FRAME] },
          { node: "price", insideBox: true },
          { node: "claim", insideBox: true },
        ],
      },
      null,
      2,
    ) + "\n"
  );
}

/** Every file a staged variant holds, by name. */
export function stagedFiles(f: Fitted): Record<string, string> {
  return {
    "main.tsx": MAIN_TSX,
    "pocket.json": POCKET_JSON,
    "pocket.config.ts": POCKET_CONFIG,
    "app.tsx": appSource(f),
    "pocket-motion.json": sidecarSource(),
  };
}

/** One digest over every staged file — equal sources, equal key. */
export function sourceKey(files: Record<string, string>): string {
  const h = new Bun.CryptoHasher("sha256");
  for (const name of Object.keys(files).sort()) h.update(`${name}\0${files[name]}\0`);
  return h.digest("hex");
}

/** Absolute font paths under a repository root. */
export function facePaths(root: string): { regular: string; bold: string } {
  return { regular: join(root, FONTS.regular), bold: join(root, FONTS.bold) };
}
