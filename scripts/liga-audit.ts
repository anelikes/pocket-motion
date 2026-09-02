#!/usr/bin/env bun
/**
 * Does a font substitute glyphs, and does the deliverable hit those substitutions?
 *
 * `scripts/kern-audit.ts` answered the same question for GPOS pair positioning
 * and put a number on Phase 1.5's trigger. This is the other half of "bring
 * your own face": GSUB, where a font replaces a RUN of glyphs with a different
 * one — `fi` drawn as a single glyph rather than an f beside an i.
 *
 * The baker reads exactly three things (`framework/compiler/bake-font.ts`):
 * `hhea` for line metrics, `charToGlyphIndex` for the cmap, and `advanceWidth`
 * for the advance. One codepoint, one glyph, one width. So no substitution of
 * any kind is applied, and a browser showing the same file applies `liga` and
 * `calt` by default. A substitution therefore differs in BOTH the shape drawn
 * and the width advanced.
 *
 * Only features a browser turns on WITHOUT being asked are counted as exposure:
 * `liga` (standard) and `rlig` (required) are on by default, `clig` is on for
 * contextual pairs, and `calt` is on. `dlig`, `hist`, `ss01`… are opt-in via
 * font-feature-settings, so a font declaring them costs us nothing.
 *
 *   bun scripts/liga-audit.ts assets/fonts/HarmonyOS_Sans_Regular.ttf
 *   bun scripts/liga-audit.ts --json <font>…
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const VENDOR = join(new URL("..", import.meta.url).pathname.replace(/\/$/, ""), "vendor/pocketjs");
const { parse: parseFont } = (await import(Bun.resolveSync("opentype.js", VENDOR))) as {
  parse(buf: ArrayBuffer): any;
};

/** On in a browser with no author opt-in. `dlig`/`hist`/`ss0N` are not. */
const DEFAULT_ON = ["liga", "rlig", "clig", "calt"] as const;

interface Sub {
  readonly feature: string;
  readonly from: string;   // the characters that get replaced
  readonly fromGids: readonly number[];
  readonly toGid: number;
  readonly printable: boolean; // every component maps back to a codepoint
}

function coverageGlyphs(cov: any): number[] {
  if (!cov) return [];
  if (cov.format === 1) return cov.glyphs ?? [];
  const out: number[] = [];
  for (const r of cov.ranges ?? []) for (let g = r.start; g <= r.end; g++) out.push(g);
  return out;
}

function audit(path: string) {
  const buf = readFileSync(path);
  const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  // gid -> codepoint, from the cmap the baker itself uses.
  const gidToCp = new Map<number, number>();
  for (const [cpStr, gid] of Object.entries((font.tables.cmap?.glyphIndexMap ?? {}) as Record<string, number>)) {
    if (!gidToCp.has(gid)) gidToCp.set(gid, Number(cpStr));
  }
  const chr = (gid: number) => {
    const cp = gidToCp.get(gid);
    return cp === undefined ? null : String.fromCodePoint(cp);
  };

  const gsub = font.tables.gsub;
  const subs: Sub[] = [];
  const declared: string[] = [...new Set<string>((gsub?.features ?? []).map((f: any) => f.tag))].sort();

  // A feature tag appears once per script/language system, and they share
  // lookups. Walking the feature list naively visits the same lookup dozens of
  // times and reports the same ligature dozens of times — dedupe on the lookup
  // index, keeping the first tag that reached it.
  const reached = new Map<number, string>();
  for (const tag of DEFAULT_ON) {
    for (const f of (gsub?.features ?? []).filter((x: any) => x.tag === tag)) {
      for (const li of f.feature?.lookupListIndexes ?? []) {
        if (!reached.has(li)) reached.set(li, tag);
      }
    }
  }
  {
    for (const [li, tag] of reached) {
      {
        const lk = gsub.lookups?.[li];
        if (!lk || lk.lookupType !== 4) continue;   // 4 = ligature substitution
        for (const st of lk.subtables ?? []) {
          const first = coverageGlyphs(st.coverage);
          (st.ligatureSets ?? []).forEach((set: any[], i: number) => {
            for (const lig of set ?? []) {
              const gids = [first[i]!, ...(lig.components ?? [])];
              const chars = gids.map(chr);
              subs.push({
                feature: tag,
                from: chars.map((c) => c ?? "�").join(""),
                fromGids: gids,
                toGid: lig.ligGlyph,
                printable: chars.every((c) => c !== null),
              });
            }
          });
        }
      }
    }
  }
  const upem = font.unitsPerEm;
  const widthOf = (gid: number) => font.glyphs.get(gid)?.advanceWidth ?? 0;
  return { path, upem, declared, subs, widthOf, hasGsub: Boolean(gsub) };
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("usage: bun scripts/liga-audit.ts [--json] <font.ttf>…");
  process.exit(2);
}

const report: unknown[] = [];
for (const f of files) {
  const r = audit(f);
  const printable = r.subs.filter((s) => s.printable);
  const ascii = printable.filter((s) => [...s.from].every((c) => c.charCodeAt(0) < 128));
  if (json) {
    report.push({
      font: f, unitsPerEm: r.upem, hasGsub: r.hasGsub, declared: r.declared,
      substitutions: r.subs.length, printable: printable.length, ascii: ascii.length,
      asciiList: ascii.map((s) => ({
        feature: s.feature, from: s.from,
        naiveWidth: s.fromGids.reduce((a, g) => a + r.widthOf(g), 0),
        ligatureWidth: r.widthOf(s.toGid),
      })),
    });
    continue;
  }
  console.log(`\n${f}`);
  console.log(`  unitsPerEm ${r.upem}   GSUB ${r.hasGsub ? "yes" : "NO"}`);
  console.log(`  features declared: ${r.declared.join(" ") || "(none)"}`);
  console.log(`  browser-default substitutions (${DEFAULT_ON.join("/")}), lookupType 4:`);
  console.log(`    total ${r.subs.length}   with printable components ${printable.length}   ASCII-only ${ascii.length}`);
  for (const s of ascii) {
    const naive = s.fromGids.reduce((a, g) => a + r.widthOf(g), 0);
    const lig = r.widthOf(s.toGid);
    const d = lig - naive;
    console.log(
      `      ${s.feature}  ${JSON.stringify(s.from).padEnd(8)} ` +
        `naive ${String(naive).padStart(5)}  ligature ${String(lig).padStart(5)}  ` +
        `delta ${(d >= 0 ? "+" : "") + d} (${((d / r.upem) * 100).toFixed(1)}% em)`,
    );
  }
}
if (json) console.log(JSON.stringify(report, null, 2));
