#!/usr/bin/env bun
/**
 * captions/matrix-decode — every word shows two scrambles of four random
 * alphanumerics, 100ms each, before the real word lands; the phrase fades in
 * over 100ms and out over 120ms, in terminal green. A port of the HyperFrames
 * catalog's "Matrix Decode".
 *
 * The scramble is three Text nodes per word behind one-tick step gates, and
 * the random characters are decided here, at build time, from a seeded
 * generator — the realm refuses `Math.random`, and the scramble is part of
 * the picture's identity like any other literal.
 *
 *   bun compositions/captions/matrix-decode/gen.ts
 *   bun src/cli/main.ts build compositions/captions/matrix-decode
 */

import {
  PHRASES, WORDS, groups, jsx, ms, openRowMeasurer, px, registry, writeComposition,
} from "../../../src/captions/transcript.ts";

const OUT = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../../", import.meta.url).pathname;
const SUPERSAMPLE = 1;

const SIZE = 96;
const GAP = 24;
const BOTTOM = 120;
const GREEN = "#00ff41";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** mulberry32, so the scramble is a function of the word index alone. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function scramble(seed: number): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < 4; i++) out += ALNUM[Math.floor(r() * ALNUM.length)];
  return out;
}

const { keyframes, animation, anim, gate } = registry();
const scr = WORDS.map((_, wi) => [scramble(wi * 1000), scramble(wi * 1000 + 1)] as const);
const texts = [...WORDS.map((w) => w.text), ...scr.flat()];
const m = await openRowMeasurer({ repoRoot: REPO, sizes: [SIZE], bold: true, texts, density: SUPERSAMPLE });
const nodes: string[] = [];
try {
  const lineH = m.lineHeight(SIZE);
  const top = 1080 - BOTTOM - lineH;
  for (const g of groups(PHRASES)) {
    const placed = m.row(WORDS.slice(g.first, g.last + 1).map((w) => w.text), SIZE, GAP, 960);
    const grp = anim(`gin 100ms linear ${ms(g.start)}ms both, gout 120ms linear ${ms(g.end - 0.12)}ms forwards`);
    const inner: string[] = [];
    placed.forEach((p, i) => {
      const wi = g.first + i;
      const w = WORDS[wi]!;
      const [s0, s1] = scr[wi]!;
      const t0 = ms(w.start), t1 = ms(w.start + 0.1), t2 = ms(w.start + 0.2);
      const node = (text: string, a: string) =>
        `        <View class="absolute left-[${px(p.x)}] top-[${px(top)}] animate-${a}"><Text class="text-[${SIZE}px] font-bold text-[${GREEN}]">{${jsx(text)}}</Text></View>`;
      inner.push(node(s0, anim(gate(t0, t1))), node(s1, anim(gate(t1, t2))), node(p.text, anim(gate(t2))));
    });
    nodes.push(`      <View class="absolute left-0 top-0 w-[1920px] h-[1080px] animate-${grp}">\n${inner.join("\n")}\n      </View>`);
  }
} finally {
  await m.close();
}

await writeComposition({ outDir: OUT, name: "matrix-decode", body: nodes.join("\n"), keyframes, animation, supersample: SUPERSAMPLE, depth: 3 });
console.log(`captions/matrix-decode: ${WORDS.length} words, ${Object.keys(animation).length} animations`);
