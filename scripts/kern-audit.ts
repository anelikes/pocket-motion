#!/usr/bin/env bun
/**
 * Does a font actually need kerning, or is it drawn to work without it?
 *
 * Phase 1.5 (kerning + a bring-your-own face) is a conditional phase, and the
 * condition is "the deliverable needs a face other than Inter". Appendix D
 * settled the question for Inter by measurement rather than by reputation: its
 * classic problem pairs are all ZERO, because it is a UI face designed for
 * environments with no shaping engine. So shipping Inter meant kerning could
 * wait.
 *
 * `scripts/build-reel.ts` defaults to `--font harmony`. The condition fired and
 * nobody re-ran the measurement. This is that measurement, generalised to any
 * face so the next one does not need a new script.
 *
 * `opentype.js`'s `getKerningValue()` returns 0 for fonts whose kerning lives in
 * GPOS rather than a legacy `kern` table — Inter is one — so this walks the
 * `lookupType === 2` subtables directly: format 1 pair sets, and format 2
 * class-based pairs expanded through their class definitions.
 *
 *   bun scripts/kern-audit.ts assets/fonts/HarmonyOS_Sans_Regular.ttf
 *   bun scripts/kern-audit.ts --json <font>…
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// opentype.js belongs to the vendored upstream (its compiler uses it), not to
// this repository. Resolve it from there rather than adding a dependency here
// for a diagnostic that runs a few times a year.
const VENDOR = join(new URL("..", import.meta.url).pathname.replace(/\/$/, ""), "vendor/pocketjs");
const { parse: parseFont } = (await import(Bun.resolveSync("opentype.js", VENDOR))) as {
  parse(buf: ArrayBuffer): unknown;
};

/** The pairs a reader notices when they are wrong (appendix D uses this set). */
const CLASSIC = [
  "AV", "VA", "To", "Ta", "Yo", "P.", "F,", "LT", "W.", "ry", "av", "r.", "Av", "Wa",
] as const;

interface OpenTypeFont {
  tables: Record<string, unknown>;
  glyphs: { length: number; get(i: number): { name?: string; unicode?: number; unicodes?: number[] } };
  charToGlyphIndex(c: string): number;
}

/** Every glyph id covered by a Coverage table. */
function coverageGlyphs(cov: { format: number; glyphs?: number[]; ranges?: { start: number; end: number; index: number }[] }): number[] {
  if (cov.format === 1) return cov.glyphs ?? [];
  const out: number[] = [];
  for (const r of cov.ranges ?? []) for (let g = r.start; g <= r.end; g++) out.push(g);
  return out;
}

/** Glyph ids per class, from a ClassDef table. */
function classMap(cd: { format: number; startGlyph?: number; classes?: number[]; ranges?: { start: number; end: number; classId: number }[] } | undefined): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const put = (cls: number, gid: number) => {
    const a = out.get(cls);
    if (a) a.push(gid);
    else out.set(cls, [gid]);
  };
  if (!cd) return out;
  if (cd.format === 1) {
    (cd.classes ?? []).forEach((cls, i) => put(cls, (cd.startGlyph ?? 0) + i));
  } else {
    for (const r of cd.ranges ?? []) for (let g = r.start; g <= r.end; g++) put(r.classId, g);
  }
  return out;
}

interface Audit {
  readonly font: string;
  readonly unitsPerEm: number;
  readonly hasLegacyKern: boolean;
  readonly hasGpos: boolean;
  readonly format1: { pairs: number; ascii: number };
  readonly format2: { pairs: number; ascii: number };
  readonly classic: { pair: string; value: number }[];
  readonly sampleAscii: string[];
  /** Every ASCII pair with a non-zero x-advance, in font units. */
  readonly byPair: Map<string, number>;
}

function audit(path: string): Audit {
  const buf = readFileSync(path);
  const font = parseFont(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  ) as unknown as OpenTypeFont;
  const gpos = font.tables.gpos as
    | { lookups?: { lookupType: number; subtables?: unknown[] }[] }
    | undefined;

  // gid -> the ASCII char it maps to, so pairs can be reported readably.
  const charOf = new Map<number, string>();
  for (let cp = 0x20; cp <= 0x7e; cp++) {
    const ch = String.fromCharCode(cp);
    const gid = font.charToGlyphIndex(ch);
    if (gid > 0 && !charOf.has(gid)) charOf.set(gid, ch);
  }

  const f1 = { pairs: 0, ascii: 0 };
  const f2 = { pairs: 0, ascii: 0 };
  /** "AV" -> x-advance adjustment, in font units. */
  const byPair = new Map<string, number>();
  const note = (l: number, r: number, v: number, bucket: { pairs: number; ascii: number }) => {
    if (v === 0) return;
    bucket.pairs++;
    const a = charOf.get(l);
    const b = charOf.get(r);
    if (a !== undefined && b !== undefined) {
      bucket.ascii++;
      byPair.set(a + b, v);
    }
  };

  for (const lookup of gpos?.lookups ?? []) {
    if (lookup.lookupType !== 2) continue;
    for (const sub of (lookup.subtables ?? []) as Record<string, never>[]) {
      const st = sub as unknown as {
        posFormat: number;
        coverage: Parameters<typeof coverageGlyphs>[0];
        pairSets?: { secondGlyph: number; value1?: { xAdvance?: number } }[][];
        classDef1?: Parameters<typeof classMap>[0];
        classDef2?: Parameters<typeof classMap>[0];
        classRecords?: { value1?: { xAdvance?: number } }[][];
      };

      if (st.posFormat === 1) {
        const first = coverageGlyphs(st.coverage);
        (st.pairSets ?? []).forEach((set, i) => {
          const l = first[i];
          if (l === undefined) return;
          for (const rec of set) note(l, rec.secondGlyph, rec.value1?.xAdvance ?? 0, f1);
        });
      } else if (st.posFormat === 2) {
        // Class 0 is "everything in coverage not in another class", so it has to
        // be reconstructed from coverage rather than read from the ClassDef.
        const c1 = classMap(st.classDef1);
        const c2 = classMap(st.classDef2);
        const covered = coverageGlyphs(st.coverage);
        const inAClass = new Set([...c1.values()].flat());
        c1.set(0, [...(c1.get(0) ?? []), ...covered.filter((g) => !inAClass.has(g))]);
        (st.classRecords ?? []).forEach((row, i) => {
          row.forEach((rec, j) => {
            const v = rec.value1?.xAdvance ?? 0;
            if (v === 0) return;
            for (const l of c1.get(i) ?? []) for (const r of c2.get(j) ?? []) note(l, r, v, f2);
          });
        });
      }
    }
  }

  return {
    font: path.split("/").pop() ?? path,
    unitsPerEm: (font.tables.head as { unitsPerEm: number } | undefined)?.unitsPerEm ?? 0,
    hasLegacyKern: font.tables.kern !== undefined,
    hasGpos: gpos !== undefined,
    format1: f1,
    format2: f2,
    classic: CLASSIC.map((pair) => ({ pair, value: byPair.get(pair) ?? 0 })),
    sampleAscii: [...byPair.entries()].slice(0, 12).map(([p, v]) => `${p}=${v}`),
    byPair,
  };
}

/**
 * What kerning would do to real copy.
 *
 * A font having kerning and a deliverable NEEDING it are different claims. This
 * answers the second: for each line, how many adjacent pairs kern and how far
 * the line's total width moves without them, as a fraction of an em.
 */
function corpus(a: Audit, lines: readonly string[]): void {
  console.log(`  against the reel's own copy:`);
  let worstLine = { text: "", shift: 0, pairs: 0 };
  for (const line of lines) {
    let shift = 0;
    let pairs = 0;
    const hits: string[] = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const v = a.byPair.get(line.slice(i, i + 2)) ?? 0;
      if (v === 0) continue;
      shift += v;
      pairs++;
      if (hits.length < 4) hits.push(`${line.slice(i, i + 2)}${v > 0 ? "+" : ""}${v}`);
    }
    const em = a.unitsPerEm || 1;
    console.log(
      `    ${JSON.stringify(line).padEnd(46)} ${String(pairs).padStart(2)} pair(s)  ` +
        `${(shift / em).toFixed(3).padStart(7)} em` + (hits.length ? `   ${hits.join(" ")}` : ""),
    );
    if (Math.abs(shift) > Math.abs(worstLine.shift)) worstLine = { text: line, shift, pairs };
  }
  if (worstLine.pairs > 0) {
    const em = a.unitsPerEm || 1;
    // The reel sets its headline at 64px (compositions/reel/gen.ts).
    console.log(
      `    worst line moves ${(worstLine.shift / em).toFixed(3)} em = ` +
        `${((worstLine.shift / em) * 64).toFixed(1)} px at the 64px headline size`,
    );
  }
}

/** The reel's visible copy — see compositions/reel/gen.ts. */
const REEL_COPY = [
  "PocketJS Motion",
  "Deterministic video rendering. No browser.",
  "DETERMINISM",
  "SPEED",
  "It does less.",
  "CDP round trip",
  "CSS engine",
  "Rust core",
  "Apple M4 · 10 cores · macOS",
  "HyperFrames · 1 worker",
  "PocketJS Motion · 1 thread",
  "Remotion · 1 worker",
  "a Tailwind subset, not all of CSS",
] as const;

const paths = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (paths.length === 0) {
  console.error("usage: bun scripts/kern-audit.ts <font.ttf>…");
  process.exit(2);
}

const results = paths.map(audit);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const em = r.unitsPerEm;
    console.log(`${r.font}  (unitsPerEm ${em}, legacy kern table: ${r.hasLegacyKern ? "yes" : "no"}, GPOS: ${r.hasGpos ? "yes" : "no"})`);
    console.log(`  format 1 (pairSets):     ${String(r.format1.pairs).padStart(6)} non-zero, ${String(r.format1.ascii).padStart(5)} ASCII-ASCII`);
    console.log(`  format 2 (class-based):  ${String(r.format2.pairs).padStart(6)} non-zero, ${String(r.format2.ascii).padStart(5)} ASCII-ASCII`);
    const nonZero = r.classic.filter((c) => c.value !== 0);
    console.log(`  classic problem pairs:   ${nonZero.length}/${r.classic.length} non-zero`);
    for (const c of r.classic) {
      const pct = em ? ((c.value / em) * 100).toFixed(2) : "—";
      console.log(`      ${c.pair}  ${String(c.value).padStart(6)} units  ${pct.padStart(6)}% em${c.value === 0 ? "" : "   <-"}`);
    }
    if (r.sampleAscii.length) console.log(`  sample ASCII pairs:      ${r.sampleAscii.join(" ")}`);
    if (process.argv.includes("--corpus")) corpus(r, REEL_COPY);
    console.log("");
  }
}
