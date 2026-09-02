#!/usr/bin/env bun
/**
 * What kerning actually landed in a pak, and what it does to a composition's
 * own copy.
 *
 * `scripts/kern-audit.ts` reads the FONT: it walks GPOS and reports what the
 * face declares. That answers "does this face need kerning". It cannot answer
 * "did the pairs survive the bake", because between the face and the picture
 * sit a subset (only glyphs the composition uses), a per-slot scale, and an
 * `i8` rounding to whole logical pixels that drops any pair rounding to zero.
 *
 * This reads the ARTIFACT instead — the v4 atlases inside a built `.pak` — and
 * sums their kern section over each string the composition's `main.tsx`
 * actually sets. Two apparatus disagreeing is the useful outcome: on
 * `compositions/reel` this agrees with `layout --at` on all fourteen lines
 * checked that way (baselines/phase1_5-kerning-trigger.md, "Looked at").
 *
 *   bun scripts/kern-baked.ts dist/compositions/reel/main.pak compositions/reel/main.tsx
 *   bun scripts/kern-baked.ts --json <pak> <main.tsx>
 *
 * The atlas layout is the one pinned in `contracts/spec/spec.ts` under "FONT
 * ATLAS binary format"; atlases are found by scanning for the magic, the same
 * way `src/text/atlas.ts` finds them.
 */

import { readFileSync } from "node:fs";

const MAGIC = [0x44, 0x43, 0x46, 0x41] as const; // 'D','C','F','A'
const HEADER_SIZE = 16;
const CMAP_ENTRY_SIZE = 8;
const KERN_PAIR_SIZE = 5;

interface Atlas {
  readonly slot: number;
  readonly version: number;
  readonly bold: boolean;
  /** Logical cell width in px — the closest thing the atlas carries to a size. */
  readonly cellW: number;
  readonly gid: ReadonlyMap<number, number>;
  readonly pairs: ReadonlyMap<number, number>;
}

const packed = (l: number, r: number): number => l * 0x10000 + r;

function atlases(pak: Uint8Array): Atlas[] {
  const view = new DataView(pak.buffer, pak.byteOffset, pak.byteLength);
  const out: Atlas[] = [];
  for (let i = 0; i + HEADER_SIZE <= pak.length; i++) {
    if (pak[i] !== MAGIC[0] || pak[i + 1] !== MAGIC[1] || pak[i + 2] !== MAGIC[2] || pak[i + 3] !== MAGIC[3]) {
      continue;
    }
    const version = view.getUint16(i + 4, true);
    if (version !== 2 && version !== 3 && version !== 4) continue;
    const glyphs = view.getUint16(i + 6, true);
    const cellW = pak[i + 8]!;
    const cellH = pak[i + 9]!;
    const density = pak[i + 14]!;
    const cmapAt = i + HEADER_SIZE;
    const coverageAt = cmapAt + glyphs * CMAP_ENTRY_SIZE;
    const kernAt = coverageAt + glyphs * cellH * density * cellW * density;
    if (kernAt + 4 > pak.length) continue;

    const gid = new Map<number, number>();
    for (let g = 0; g < glyphs; g++) {
      const at = cmapAt + g * CMAP_ENTRY_SIZE;
      gid.set(view.getUint32(at, true), view.getUint16(at + 4, true));
    }

    const pairs = new Map<number, number>();
    if (version === 4) {
      const count = view.getUint32(kernAt, true);
      // A truncated section means this was not an atlas after all: the magic
      // can occur inside coverage bytes, so a bad tail is a rejection, not a
      // corrupt file.
      if (kernAt + 4 + count * KERN_PAIR_SIZE > pak.length) continue;
      for (let k = 0; k < count; k++) {
        const at = kernAt + 4 + k * KERN_PAIR_SIZE;
        pairs.set(packed(view.getUint16(at, true), view.getUint16(at + 2, true)), view.getInt8(at + 4));
      }
    }
    out.push({ slot: pak[i + 12]!, version, bold: (pak[i + 13]! & 1) === 1, cellW, gid, pairs });
  }
  return out;
}

/** Total kern shift for one string in one atlas, in logical px. */
function shift(a: Atlas, s: string): number {
  let total = 0;
  let prev: number | undefined;
  for (const ch of s) {
    const g = a.gid.get(ch.codePointAt(0)!) ?? 0;
    if (prev !== undefined) total += a.pairs.get(packed(prev, g)) ?? 0;
    prev = g;
  }
  return total;
}

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const [pakPath, srcPath] = argv.filter((a) => !a.startsWith("--"));
if (!pakPath || !srcPath) {
  console.error("usage: bun scripts/kern-baked.ts [--json] <pak> <main.tsx>");
  process.exit(2);
}

const found = atlases(new Uint8Array(readFileSync(pakPath)));
const src = readFileSync(srcPath, "utf8");

// `<Text class="…">{"…"}</Text>` is what every generator in this tree emits,
// and the literal is `JSON.stringify` output, so JSON.parse is its inverse.
const NODE = /<Text class="([^"]*)">\{("(?:[^"\\]|\\.)*")\}<\/Text>/g;
const SIZE = /text-\[(\d+)px\]/;

interface Row {
  readonly text: string;
  readonly px: number;
  readonly bold: boolean;
  readonly slot: number;
  readonly shiftPx: number;
}
const rows: Row[] = [];
const seen = new Set<string>();
let singleChar = 0;
let singleGlyphs = 0;
let multiGlyphs = 0;

for (const m of src.matchAll(NODE)) {
  const cls = m[1]!;
  const text = JSON.parse(m[2]!) as string;
  const chars = [...text].length;
  if (chars <= 1) {
    singleChar++;
    singleGlyphs += chars;
    continue;
  }
  multiGlyphs += chars;
  const px = SIZE.exec(cls);
  if (!px) continue;
  const size = Number(px[1]);
  const bold = cls.includes("font-bold");
  const key = `${size}|${bold}|${text}`;
  if (seen.has(key)) continue;
  seen.add(key);

  // The atlas records a cell width, not the requested size, so the slot is
  // matched by nearest cell among atlases of the right weight. A cell is the
  // em box rounded up, so the gap is small and a wrong match would show as a
  // shift that `layout` does not reproduce.
  const cand = found.filter((a) => a.bold === bold);
  if (cand.length === 0) continue;
  const a = cand.reduce((best, x) => (Math.abs(x.cellW - size) < Math.abs(best.cellW - size) ? x : best));
  if (Math.abs(a.cellW - size) > 4) continue;
  rows.push({ text, px: size, bold, slot: a.slot, shiftPx: shift(a, text) });
}

rows.sort((x, y) => x.shiftPx - y.shiftPx || x.text.localeCompare(y.text));
const moved = rows.filter((r) => r.shiftPx !== 0);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        pak: pakPath,
        source: srcPath,
        atlases: found.map((a) => ({ slot: a.slot, version: a.version, cellW: a.cellW, bold: a.bold, pairs: a.pairs.size })),
        strings: rows,
        moved: moved.length,
        singleCharNodes: singleChar,
        glyphsThatCannotKern: singleGlyphs,
        glyphsTotal: singleGlyphs + multiGlyphs,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

for (const a of [...found].sort((x, y) => x.cellW - y.cellW)) {
  console.log(`slot ${String(a.slot).padStart(2)}  v${a.version}  cell ${String(a.cellW).padStart(3)}px ${a.bold ? "bold" : "    "}  ${String(a.pairs.size).padStart(4)} pair(s)`);
}
console.log();
console.log(`${"shift".padStart(7)}  ${"size".padStart(4)}  string`);
for (const r of rows) {
  const sign = r.shiftPx > 0 ? `+${r.shiftPx}` : String(r.shiftPx);
  console.log(`${sign.padStart(7)}  ${String(r.px).padStart(3)}${r.bold ? "b" : " "}  ${r.text}`);
}
console.log();
console.log(`${rows.length} distinct multi-character string(s), ${moved.length} shifted.`);
console.log(
  `${singleChar} single-character <Text> node(s): ${singleGlyphs} of ${singleGlyphs + multiGlyphs} glyphs ` +
    `(${Math.round((100 * singleGlyphs) / (singleGlyphs + multiGlyphs))}%) are one-glyph runs, which no pair can reach.`,
);
