#!/usr/bin/env bun
/**
 * captions/pill-karaoke — a light pill at the bottom holding up to four
 * lowercase words; each turns from grey to near-black as it is spoken and
 * stays dark. A port of the HyperFrames catalog's "Pill Karaoke".
 *
 * The colour change is a baked `color` timeline per word: 100ms, linear,
 * starting 50ms before the word. Groups follow the catalog's rule — at most
 * four words, broken at punctuation or at a pause of 100ms or more — and a
 * group shows until the next one starts or 300ms after its last word.
 *
 *   bun compositions/captions/pill-karaoke/gen.ts
 *   bun src/cli/main.ts build compositions/captions/pill-karaoke
 */

import {
  DURATION_S, WORDS, jsx, ms, openRowMeasurer, px, registry, writeComposition, type Word,
} from "../../../src/captions/transcript.ts";

const OUT = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../../", import.meta.url).pathname;
const SUPERSAMPLE = 1;

const SIZE = 72;
const GAP = 16;
const PAD_X = 60, PAD_T = 18, PAD_B = 20;
const RADIUS = 22;
const ZONE = { bottom: 100, h: 220 };
const INACTIVE = "#a6a6a6", ACTIVE = "#1c1e1d";
const MAX_WORDS = 4, PAUSE = 0.1, END_BUFFER = 0.3, LEAD = 0.05, FADE = 100;

/** The catalog's grouping: punctuation, a pause, or four words closes a group. */
function makeGroups(words: readonly Word[]): Array<{ first: number; last: number }> {
  const out: Array<{ first: number; last: number }> = [];
  let first = 0;
  words.forEach((w, i) => {
    const next = words[i + 1];
    const closes = i - first + 1 >= MAX_WORDS || !next || /[,.:!?]$/.test(w.text) || next.start - w.end >= PAUSE;
    if (closes) { out.push({ first, last: i }); first = i + 1; }
  });
  return out;
}

const { keyframes, animation, anim, gate } = registry();
keyframes["lit"] = { from: { color: INACTIVE }, to: { color: ACTIVE } };

const lower = WORDS.map((w) => w.text.toLowerCase());
const m = await openRowMeasurer({ repoRoot: REPO, sizes: [SIZE], bold: true, texts: lower, density: SUPERSAMPLE });
const nodes: string[] = [];
try {
  const lineH = m.lineHeight(SIZE);
  const pillH = lineH + PAD_T + PAD_B;
  const pillTop = 1080 - ZONE.bottom - ZONE.h + (ZONE.h - pillH) / 2;
  const gs = makeGroups(WORDS);
  gs.forEach((g, gi) => {
    const texts = lower.slice(g.first, g.last + 1);
    const placed = m.row(texts, SIZE, GAP, 960);
    const rowW = placed[placed.length - 1]!.x + placed[placed.length - 1]!.w - placed[0]!.x;
    const pillW = rowW + 2 * PAD_X;
    const start = WORDS[g.first]!.start;
    const next = gs[gi + 1];
    const end = next ? Math.min(WORDS[next.first]!.start, WORDS[g.last]!.end + END_BUFFER) : DURATION_S;
    const grp = anim(gate(ms(start), ms(end)));
    const inner = placed.map((p, i) => {
      const w = WORDS[g.first + i]!;
      const cls = i === 0
        ? `text-[${ACTIVE}]`
        : `text-[${INACTIVE}] animate-${anim(`lit ${FADE}ms linear ${ms(Math.max(start, w.start - LEAD))}ms both`)}`;
      return `          <View class="absolute left-[${px(p.x)}] top-[${px(pillTop + PAD_T)}]"><Text class="text-[${SIZE}px] font-bold ${cls}">{${jsx(p.text)}}</Text></View>`;
    });
    nodes.push(
      `      <View class="absolute left-0 top-0 w-[1920px] h-[1080px] animate-${grp}">
        <View class="absolute left-[${px(960 - pillW / 2)}] top-[${px(pillTop)}] w-[${px(pillW)}] h-[${px(pillH)}] rounded-[${RADIUS}px] bg-[#e7e5e7]" />
${inner.join("\n")}
      </View>`,
    );
  });
} finally {
  await m.close();
}

await writeComposition({ outDir: OUT, name: "pill-karaoke", body: nodes.join("\n"), keyframes, animation, supersample: SUPERSAMPLE, depth: 3 });
console.log(`captions/pill-karaoke: ${WORDS.length} words, ${Object.keys(animation).length} animations`);
