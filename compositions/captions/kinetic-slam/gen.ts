#!/usr/bin/env bun
/**
 * captions/kinetic-slam — one word at a time, full-screen, each arriving from
 * a different direction: from above with an overshoot, from the left, from
 * the right, and — where the catalog scales up from 0.4 — from below. A port
 * of the HyperFrames catalog's "Kinetic Slam".
 *
 * The fourth entrance is the one deliberate departure: a `scale` moves
 * baked glyphs and never resizes them, so a word scaling in from 0.4 would
 * bunch full-size glyphs toward its centre (AUTHORING.md, "Text"). It rises
 * from below with the harder overshoot instead. The word's size is fitted
 * to 1720px by measuring at a ladder of sizes, the way the catalog fits with
 * a canvas; the largest is 200px because the atlas cell is a byte tall.
 *
 *   bun compositions/captions/kinetic-slam/gen.ts
 *   bun src/cli/main.ts build compositions/captions/kinetic-slam
 */

import {
  EASE, KEYWORDS, WORDS, jsx, ms, openRowMeasurer, px, registry, writeComposition,
} from "../../../src/captions/transcript.ts";

const OUT = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../../", import.meta.url).pathname;
const SUPERSAMPLE = 1;

const LADDER = [200, 180, 160, 140, 120, 100] as const;
const MAX_W = 1720;

const { keyframes, animation, anim } = registry();
keyframes["fromAbove"] = { from: { translateY: "-120px", opacity: "0" }, to: { translateY: "0px", opacity: "1" } };
keyframes["fromLeft"] = { from: { translateX: "-300px", opacity: "0" }, to: { translateX: "0px", opacity: "1" } };
keyframes["fromRight"] = { from: { translateX: "300px", opacity: "0" }, to: { translateX: "0px", opacity: "1" } };
keyframes["fromBelow"] = { from: { translateY: "120px", opacity: "0" }, to: { translateY: "0px", opacity: "1" } };
const ENTRANCES = [
  `fromAbove 220ms ${EASE.backOut}`,
  `fromLeft 200ms ${EASE.expoOut}`,
  `fromRight 200ms ${EASE.expoOut}`,
  `fromBelow 240ms ${EASE.backOutHard}`,
] as const;

const upper = WORDS.map((w) => w.text.toUpperCase());
const m = await openRowMeasurer({ repoRoot: REPO, sizes: LADDER, bold: true, texts: upper, density: SUPERSAMPLE });
const nodes: string[] = [];
try {
  WORDS.forEach((w, wi) => {
    const text = upper[wi]!;
    const size = LADDER.find((s) => m.width(text, s) <= MAX_W) ?? LADDER[LADDER.length - 1]!;
    const width = m.width(text, size);
    const lineH = m.lineHeight(size);
    const a = anim(`${ENTRANCES[wi % 4]} ${ms(w.start)}ms both, gout 100ms ${EASE.power2in} ${ms(w.end)}ms forwards`);
    const color = KEYWORDS.has(wi) ? "#ffd700" : "#ffffff";
    nodes.push(
      `      <View class="absolute left-[${px(960 - width / 2)}] top-[${px(540 - lineH / 2)}] animate-${a}">` +
        `<Text class="text-[${size}px] font-bold text-[${color}]">{${jsx(text)}}</Text></View>`,
    );
  });
} finally {
  await m.close();
}

await writeComposition({ outDir: OUT, name: "kinetic-slam", body: nodes.join("\n"), keyframes, animation, supersample: SUPERSAMPLE, depth: 3 });
console.log(`captions/kinetic-slam: ${WORDS.length} words, ${Object.keys(animation).length} animations`);
