#!/usr/bin/env bun
/**
 * captions/highlight — a red box sweeps in behind each word as it is spoken
 * and drops out when the word ends; phrases sit at the bottom in uppercase.
 * A port of the HyperFrames catalog's "Highlight" caption style.
 *
 * What the catalog does with `scaleX` from the left edge is done here with
 * `width`: the box is an absolute node whose width bakes from 0 to the word's
 * measured width plus padding, so it never needs a transform origin. The
 * text shadow and the box's drop shadow are not reproduced — there is no
 * blur.
 *
 *   bun compositions/captions/highlight/gen.ts
 *   bun src/cli/main.ts build compositions/captions/highlight
 */

import {
  EASE, KEYWORDS, PHRASES, WORDS, groups, jsx, ms, openRowMeasurer, px, registry, writeComposition,
} from "../../../src/captions/transcript.ts";

const OUT = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../../", import.meta.url).pathname;
const SUPERSAMPLE = 1;

const SIZE = 80;
const GAP = 8;
const PAD_X = 12, PAD_T = 6, PAD_B = 8;
const BOTTOM = 140;
const RADIUS = 10;

const { keyframes, animation, anim, gate } = registry();
const upper = WORDS.map((w) => w.text.toUpperCase());
const m = await openRowMeasurer({ repoRoot: REPO, sizes: [SIZE], bold: true, texts: upper, density: SUPERSAMPLE });
const nodes: string[] = [];
try {
  const lineH = m.lineHeight(SIZE);
  const boxH = lineH + PAD_T + PAD_B;
  const top = 1080 - BOTTOM - boxH;
  for (const g of groups(PHRASES)) {
    const texts = upper.slice(g.first, g.last + 1);
    // the row is laid out on the boxes (word + padding), gap between boxes
    const placed = m.row(texts, SIZE, GAP + 2 * PAD_X, 960);
    const grp = anim(`gin 120ms ${EASE.power2out} ${ms(g.start)}ms both, gout 100ms ${EASE.power2in} ${ms(g.end - 0.1)}ms forwards`);
    const inner: string[] = [];
    placed.forEach((p, i) => {
      const w = WORDS[g.first + i]!;
      const boxW = p.w + 2 * PAD_X;
      const key = `hw${Math.round(boxW)}`;
      keyframes[key] ??= { from: { width: "0px" }, to: { width: px(boxW) } };
      const bg = anim(
        `${key} 150ms ${EASE.power2out} ${ms(w.start)}ms both, ` +
          `gin 150ms ${EASE.power2out} ${ms(w.start)}ms both, gout 100ms ${EASE.power2in} ${ms(w.end)}ms forwards`,
      );
      const left = p.x - PAD_X;
      inner.push(
        `        <View class="absolute left-[${px(left)}] top-[${px(top)}] w-[${px(boxW)}] h-[${px(boxH)}]">
          <View class="absolute left-0 top-0 w-[0px] h-[${px(boxH)}] rounded-[${RADIUS}px] bg-gradient-to-r from-[#ff1745] to-[#df1238] animate-${bg}" />
          <View class="absolute left-[${PAD_X}px] top-[${PAD_T}px]"><Text class="text-[${SIZE}px] font-bold text-[#ffffff]">{${jsx(p.text)}}</Text></View>
        </View>`,
      );
      void KEYWORDS;
    });
    nodes.push(`      <View class="absolute left-0 top-0 w-[1920px] h-[1080px] animate-${grp}">\n${inner.join("\n")}\n      </View>`);
  }
} finally {
  await m.close();
}

await writeComposition({ outDir: OUT, name: "highlight", body: nodes.join("\n"), keyframes, animation, supersample: SUPERSAMPLE, depth: 3 });
console.log(`captions/highlight: ${WORDS.length} words, ${Object.keys(animation).length} animations`);
