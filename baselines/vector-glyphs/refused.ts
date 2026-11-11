#!/usr/bin/env bun
/**
 * Which of Noto Color Emoji's codepoints a slot leaves out, and why
 * (`patches/0063`): what the colour reader refuses (colr.ts), what the
 * gradient mapping refuses, and what is a picture only inside a shaped
 * sequence (`sequenceOnly`, bake-font.ts). Each one misses at render and is
 * reported as tofu. A codepoint the slot's own face maps never reaches the
 * fallback, so the list for a composition is this one minus its face's map.
 *
 *   bun baselines/vector-glyphs/refused.ts
 */

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const C = `${ROOT}/vendor/pocketjs/framework/compiler`;
const { readColourTables, gradientCoefficients } = await import(`${C}/colr.ts`);
const { sequenceOnly } = await import(`${C}/bake-font.ts`);
const ot = await import(Bun.resolveSync("opentype.js", `${ROOT}/vendor/pocketjs`));
const parse = (ot.default ?? ot).parse;

const bytes = new Uint8Array(await Bun.file(`${ROOT}/assets/fonts/Noto-COLRv1.ttf`).arrayBuffer());
const font = parse(bytes.buffer);
const tables = readColourTables(bytes)!;
const cmap: Record<string, number> = font.tables.cmap.glyphIndexMap;

const byReason = new Map<string, number[]>();
let colour = 0;
let drawn = 0;
for (const [key, gid] of Object.entries(cmap)) {
  const cp = Number(key);
  const g = tables.glyph(gid);
  if (g !== null) colour++;
  let why: string | null = sequenceOnly(cp);
  if (why === null && g !== null) {
    if ("refused" in g) why = g.refused;
    else {
      for (const l of g.layers) {
        if (l.fill.kind !== "linear" && l.fill.kind !== "radial") continue;
        const r = gradientCoefficients(l.fill, [1, 0, 0, -1, 0, 0]);
        if ("refused" in r) {
          why = r.refused;
          break;
        }
      }
    }
  }
  if (why === null) {
    if (g !== null) drawn++;
    continue;
  }
  byReason.set(why, [...(byReason.get(why) ?? []), cp]);
}
const label = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
console.log(`Noto-COLRv1.ttf: ${Object.keys(cmap).length} mapped codepoints, ${colour} with colour paint, ${drawn} drawn`);
for (const [why, cps] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${cps.length} — ${why}`);
  console.log(`  ${cps.sort((a, b) => a - b).map((cp) => `${label(cp)} ${cp >= 0xe0000 || (cp >= 0xfe000 && cp < 0xff000) ? "" : String.fromCodePoint(cp)}`.trim()).join(", ")}`);
}
