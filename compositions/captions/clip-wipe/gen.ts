#!/usr/bin/env bun
/**
 * captions/clip-wipe — each word is revealed left to right by a clip as it is
 * spoken, keywords turn gold, spoken words settle to 40% white, and the whole
 * phrase wipes out to the right with a stagger. A port of the HyperFrames
 * catalog's "Clip Wipe".
 *
 * `clip-path: inset()` becomes an `overflow-hidden` window per word whose
 * width bakes from 0 to the word's measured width. The exit clip, which
 * eats the word from its left edge, is the window's left edge moving right
 * (translateX up, width down) while the text inside moves left by the same
 * amount, so the glyphs stay put on screen and only the window closes.
 *
 *   bun compositions/captions/clip-wipe/gen.ts
 *   bun src/cli/main.ts build compositions/captions/clip-wipe
 */

import {
  EASE, KEYWORDS, PHRASES, WORDS, groups, jsx, ms, openRowMeasurer, px, registry, writeComposition,
} from "../../../src/captions/transcript.ts";

const OUT = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../../", import.meta.url).pathname;
const SUPERSAMPLE = 1;

const SIZE = 88;
const GAP = 24;
const BOTTOM = 120;
const GOLD = "#ffd700", DIM = "#ffffff66";

const { keyframes, animation, anim, gate } = registry();
keyframes["toGold"] = { from: { color: "#ffffff" }, to: { color: GOLD } };
keyframes["whiteDim"] = { from: { color: "#ffffff" }, to: { color: DIM } };
keyframes["goldDim"] = { from: { color: GOLD }, to: { color: DIM } };

const upper = WORDS.map((w) => w.text.toUpperCase());
const m = await openRowMeasurer({ repoRoot: REPO, sizes: [SIZE], bold: true, texts: upper, density: SUPERSAMPLE });
const nodes: string[] = [];
try {
  const lineH = m.lineHeight(SIZE);
  const top = 1080 - BOTTOM - lineH;
  for (const g of groups(PHRASES)) {
    const texts = upper.slice(g.first, g.last + 1);
    const placed = m.row(texts, SIZE, GAP, 960);
    const grp = anim(gate(ms(g.start), ms(g.end)));
    const inner: string[] = [];
    placed.forEach((p, i) => {
      const wi = g.first + i;
      const w = WORDS[wi]!;
      const W = Math.ceil(p.w) + 2; // a pixel of slack so the last glyph's edge is inside the window
      const open = `cw${W}`;
      keyframes[open] ??= { from: { width: "0px" }, to: { width: px(W) } };
      const closeWin = `cx${W}`;
      keyframes[closeWin] ??= { from: { translateX: "0px", width: px(W) }, to: { translateX: px(W), width: "0px" } };
      const closeText = `ct${W}`;
      keyframes[closeText] ??= { from: { translateX: "0px" }, to: { translateX: px(-W) } };
      const exitAt = ms(g.end - 0.2 + i * 0.04);
      const win = anim(`${open} 300ms ${EASE.power2out} ${ms(w.start)}ms both, ${closeWin} 250ms ${EASE.power2in} ${exitAt}ms forwards`);
      const isKW = KEYWORDS.has(wi);
      const colour = isKW
        ? `toGold 50ms linear ${ms(w.start + 0.1)}ms both, goldDim 200ms linear ${ms(w.end)}ms forwards`
        : `whiteDim 200ms linear ${ms(w.end)}ms both`;
      const txt = anim(`${colour}, ${closeText} 250ms ${EASE.power2in} ${exitAt}ms forwards`);
      inner.push(
        `        <View class="absolute left-[${px(p.x)}] top-[${px(top)}] w-[0px] h-[${px(lineH)}] overflow-hidden animate-${win}">
          <View class="absolute left-0 top-0"><Text class="text-[${SIZE}px] font-bold text-[#ffffff] animate-${txt}">{${jsx(p.text)}}</Text></View>
        </View>`,
      );
    });
    nodes.push(`      <View class="absolute left-0 top-0 w-[1920px] h-[1080px] animate-${grp}">\n${inner.join("\n")}\n      </View>`);
  }
} finally {
  await m.close();
}

await writeComposition({ outDir: OUT, name: "clip-wipe", body: nodes.join("\n"), keyframes, animation, supersample: SUPERSAMPLE, depth: 3 });
console.log(`captions/clip-wipe: ${WORDS.length} words, ${Object.keys(animation).length} animations`);
