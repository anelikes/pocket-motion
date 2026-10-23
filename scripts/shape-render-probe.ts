#!/usr/bin/env bun
/**
 * PROTOTYPE — shaped runs drawn by the UNMODIFIED core, for
 * docs/text-shaping.design.md.
 *
 * The question it answers: does the draw path need to change for shaped
 * text, or is GLYPH_RUN — (atlas gid, x, y) per glyph — already the right
 * op? It writes a composition in which every glyph of a shaped line is its own
 * absolutely positioned one-character `Text`, so the core places each cell at
 * exactly the position the shaper chose and nothing of its own line model
 * (advances, kerning, order) is involved.
 *
 * The baker keys cells by codepoint, and a shaped glyph — an Arabic medial
 * form, a lam-alef ligature, a Devanagari conjunct — has none. So each face
 * is first copied with one extra cmap range, U+F0000 + gid -> gid (plane 15,
 * private use), and the composition names glyphs by those codepoints. That is
 * a probe's trick and not the design: the design gives the atlas a glyph-id
 * section instead (see the doc's step list).
 *
 *   bun scripts/shape-render-probe.ts --wasm <hb.wasm> --bidi <bidi-js dir> \
 *     --out <composition dir> --face name=<font> [--face name=<font> ...]
 *
 * Bidi is resolved by bidi-js (UAX #9) with the paragraph direction stated
 * per line, runs are split at embedding-level boundaries, each run is shaped
 * with its own direction and script, and runs are put in visual order by
 * rule L2. Fonts and the bidi implementation are passed by path because none
 * of them is in this repository.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { pocketjsRoot } from "../src/runtime/boot.ts";
import { openShaper, type Direction, type ShaperFace } from "../src/text/shape.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const PX = Number(arg("px") ?? 56);
const LEFT = 40;
const TOP = 40;
const LINE = Math.round(PX * 1.4);
const PUA = 0xf0000;

interface Line {
  readonly name: string;
  readonly face: string;
  readonly text: string;
  readonly paragraph: "ltr" | "rtl";
  readonly language: string;
}

/** Top-to-bottom columns, right to left: `writing-mode: vertical-rl` with
 *  every character upright. Shaped with HB_DIRECTION_TTB, which applies
 *  `vert`/`vrt2` and the face's vertical advances and origins. */
interface Column {
  readonly name: string;
  readonly face: string;
  readonly text: string;
  readonly language: string;
}

const COLUMNS: readonly Column[] = [
  { name: "v1", face: "cjk", text: "「确定性」视频渲染、", language: "zh" },
  { name: "v2", face: "cjk", text: "无需浏览器。ー（测试）", language: "zh" },
];
const COLUMN_RIGHT = 1800;
const COLUMN_STEP = Math.round(PX * 1.4);

/** The same strings `compositions/textcmp-scripts` draws unshaped, row for row. */
const LINES: readonly Line[] = [
  { name: "ar-join", face: "arabic", text: "مرحبا بالعالم", paragraph: "rtl", language: "ar" },
  { name: "ar-lam-alef", face: "arabic", text: "لا إله", paragraph: "rtl", language: "ar" },
  { name: "ar-marks", face: "arabic", text: "بِسْمِ اللَّهِ", paragraph: "rtl", language: "ar" },
  { name: "mixed", face: "tahoma", text: "اشترِ iPhone 15 الآن", paragraph: "rtl", language: "ar" },
  { name: "he", face: "tahoma", text: "שלום עולם · מחיר: 120 ₪", paragraph: "rtl", language: "he" },
  { name: "th-stack", face: "tahoma", text: "ที่นี่ น้ำ สวัสดีครับ", paragraph: "ltr", language: "th" },
  { name: "deva", face: "deva", text: "नमस्ते दुनिया · धर्म · कि", paragraph: "ltr", language: "hi" },
];

/** ISO 15924 of a run, from its first character in a script block. A probe's
 *  shortcut: the design takes script from UAX #24 Script_Extensions. */
function scriptOf(s: string): string {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0600 && c <= 0x06ff) return "Arab";
    if (c >= 0x0590 && c <= 0x05ff) return "Hebr";
    if (c >= 0x0e00 && c <= 0x0e7f) return "Thai";
    if (c >= 0x0900 && c <= 0x097f) return "Deva";
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return "Latn";
  }
  return "Zyyy";
}

// ---------------------------------------------------------------------------
// A face with U+F0000 + gid mapped to every glyph
// ---------------------------------------------------------------------------

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
function u16(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

/** A format-12 cmap carrying `map` plus [PUA, PUA + numGlyphs) -> [0, numGlyphs). */
function cmap12(map: Map<number, number>, numGlyphs: number): Uint8Array {
  const pairs = [...map.entries()].filter(([cp]) => cp < PUA).sort((a, b) => a[0] - b[0]);
  const groups: [number, number, number][] = [];
  for (const [cp, gid] of pairs) {
    const g = groups[groups.length - 1];
    if (g && cp === g[1] + 1 && gid === g[2] + (cp - g[0])) g[1] = cp;
    else groups.push([cp, cp, gid]);
  }
  groups.push([PUA, PUA + numGlyphs - 1, 0]);
  const sub = 16 + groups.length * 12;
  const out = new Uint8Array(4 + 8 + sub);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0);
  dv.setUint16(2, 1);
  dv.setUint16(4, 3); // platform Windows
  dv.setUint16(6, 10); // UCS-4
  dv.setUint32(8, 12);
  dv.setUint16(12, 12);
  dv.setUint32(16, sub);
  dv.setUint32(20, 0);
  dv.setUint32(24, groups.length);
  groups.forEach(([a, b, g], i) => {
    dv.setUint32(28 + i * 12, a);
    dv.setUint32(32 + i * 12, b);
    dv.setUint32(36 + i * 12, g);
  });
  return out;
}

/** Copy of an sfnt with its cmap replaced. Every other table is copied byte
 *  for byte, so glyph ids, outlines and layout tables are the original's. */
async function withGlyphCmap(bytes: Uint8Array): Promise<Uint8Array> {
  // The vendored opentype.js, resolved the way `src/text/outline.ts` resolves it.
  const { parse } = (await import(Bun.resolveSync("opentype.js", pocketjsRoot()))) as {
    parse(buf: ArrayBuffer): { numGlyphs: number; tables: { cmap: { glyphIndexMap: Record<string, number> } } };
  };
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const map = new Map<number, number>(
    Object.entries(font.tables.cmap.glyphIndexMap).map(([k, v]) => [Number(k), v]),
  );
  const numTables = u16(bytes, 4);
  const tables: { tag: string; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(r, r + 4));
    const off = u32(bytes, r + 8);
    const len = u32(bytes, r + 12);
    tables.push({ tag, data: tag === "cmap" ? cmap12(map, font.numGlyphs) : bytes.subarray(off, off + len) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  let size = 12 + tables.length * 16;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(bytes.subarray(0, 4), 0);
  dv.setUint16(4, tables.length);
  const es = Math.floor(Math.log2(tables.length));
  dv.setUint16(6, 16 * 2 ** es);
  dv.setUint16(8, es);
  dv.setUint16(10, tables.length * 16 - 16 * 2 ** es);
  let at = 12 + tables.length * 16;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    let sum = 0;
    const padded = new Uint8Array((t.data.length + 3) & ~3);
    padded.set(t.data);
    for (let k = 0; k < padded.length; k += 4) sum = (sum + u32(padded, k)) >>> 0;
    dv.setUint32(r + 4, sum);
    dv.setUint32(r + 8, at);
    dv.setUint32(r + 12, t.data.length);
    out.set(padded, at);
    at += padded.length;
  });
  return out;
}

// ---------------------------------------------------------------------------

interface Placed {
  readonly gid: number;
  readonly x: number;
  readonly y: number;
}

async function main(): Promise<void> {
  const wasm = arg("wasm");
  const bidiDir = arg("bidi");
  const outDir = arg("out");
  const faceArgs = process.argv.flatMap((a, i) => (a === "--face" ? [process.argv[i + 1]!] : []));
  if (!wasm || !bidiDir || !outDir || faceArgs.length === 0) {
    console.error("usage: bun scripts/shape-render-probe.ts --wasm <hb.wasm> --bidi <bidi-js dir> --out <dir> --face name=<font> ...");
    process.exit(2);
  }
  const bidi = (await import(resolve(bidiDir, "dist/bidi.mjs"))).default();
  const shaper = await openShaper(new Uint8Array(await Bun.file(wasm).arrayBuffer()));
  const root = resolve(import.meta.dir, "..");
  const out = resolve(outDir);
  await mkdir(join(out, "fonts"), { recursive: true });

  const faces = new Map<string, { face: ShaperFace; file: string }>();
  for (const spec of faceArgs) {
    const [name, path] = spec.split("=") as [string, string];
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const file = join(out, "fonts", `${name}-glyphs${path.slice(path.lastIndexOf("."))}`);
    await writeFile(file, await withGlyphCmap(bytes));
    faces.set(name, { face: shaper.face(bytes), file });
  }

  const rows: string[] = [];
  const report: { name: string; glyphs: number; distinctGids: number }[] = [];
  LINES.forEach((line, row) => {
    const f = faces.get(line.face);
    if (!f) throw new Error(`no --face ${line.face}`);
    const scale = PX / f.face.upem;
    const levels = bidi.getEmbeddingLevels(line.text, line.paragraph);
    // Level runs, in logical order.
    const runs: { start: number; end: number; level: number }[] = [];
    for (let i = 0; i < line.text.length; i++) {
      const lv = levels.levels[i];
      const last = runs[runs.length - 1];
      if (last && last.level === lv) last.end = i + 1;
      else runs.push({ start: i, end: i + 1, level: lv });
    }
    // L2: from the highest level down to the lowest odd one, reverse every
    // maximal sequence of runs at that level or above.
    const order = runs.map((_, i) => i);
    const max = Math.max(...runs.map((r) => r.level));
    const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), max + 1);
    for (let lv = max; lv >= minOdd; lv--) {
      for (let i = 0; i < order.length; ) {
        if (runs[order[i]!]!.level < lv) {
          i++;
          continue;
        }
        let j = i;
        while (j < order.length && runs[order[j]!]!.level >= lv) j++;
        order.splice(i, j - i, ...order.slice(i, j).reverse());
        i = j;
      }
    }
    let pen = 0; // font units
    const placed: Placed[] = [];
    for (const ri of order) {
      const r = runs[ri]!;
      const text = line.text.slice(r.start, r.end);
      const direction: Direction = r.level % 2 === 1 ? "rtl" : "ltr";
      const script = scriptOf(text) === "Zyyy" ? scriptOf(line.text) : scriptOf(text);
      const shaped = f.face.shape({ text, direction, script, language: line.language });
      for (const g of shaped.glyphs) {
        placed.push({ gid: g.gid, x: (pen + g.xOffset) * scale, y: g.yOffset * scale });
        pen += g.xAdvance;
      }
    }
    report.push({ name: line.name, glyphs: placed.length, distinctGids: new Set(placed.map((p) => p.gid)).size });
    const top = TOP + row * LINE;
    const fx = (n: number) => n.toFixed(3).replace(/\.?0+$/, "");
    const cells = placed
      .map(
        (p) =>
          `        <Text class="absolute left-[${fx(LEFT + p.x)}px] top-[${fx(top - p.y)}px] text-[${PX}px] text-white font-[${line.face}]">{"\\u{${(PUA + p.gid).toString(16)}}"}</Text>`,
      )
      .join("\n");
    rows.push(`      {/* ${line.name} */}\n${cells}`);
  });

  COLUMNS.forEach((col, i) => {
    const f = faces.get(col.face);
    if (!f) return;
    const scale = PX / f.face.upem;
    const shaped = f.face.shape({ text: col.text, direction: "ttb", script: "Hani", language: col.language });
    // HarfBuzz returns TTB offsets relative to each glyph's HORIZONTAL
    // origin, so a glyph is drawn exactly as a horizontal one is, at
    // (pen + offset); the pen moves down by -yAdvance.
    const centre = COLUMN_RIGHT - i * COLUMN_STEP;
    let pen = 0;
    const fx = (n: number) => n.toFixed(3).replace(/\.?0+$/, "");
    const cells = shaped.glyphs.map((g) => {
      const x = centre + g.xOffset * scale;
      const y = TOP - (pen + g.yOffset) * scale;
      pen += g.yAdvance;
      return `        <Text class="absolute left-[${fx(x)}px] top-[${fx(y)}px] text-[${PX}px] text-white font-[${col.face}]">{"\\u{${(PUA + g.gid).toString(16)}}"}</Text>`;
    });
    report.push({ name: col.name, glyphs: shaped.glyphs.length, distinctGids: new Set(shaped.glyphs.map((g) => g.gid)).size });
    rows.push(`      {/* ${col.name} (vertical-rl) */}\n${cells.join("\n")}`);
  });

  const app = `// GENERATED by scripts/shape-render-probe.ts — shaped runs, one absolutely
// placed Text per glyph, named by U+F0000 + gid in a cmap-extended copy of
// each face. Evidence for docs/text-shaping.design.md, not a fixture.
import { Text, View } from "@pocketjs/framework/components";

export default function Shaped() {
  return (
    <View class="w-full h-full bg-black relative">
${rows.join("\n")}
    </View>
  );
}
`;
  await writeFile(join(out, "app.tsx"), app);
  await writeFile(
    join(out, "main.tsx"),
    `// @title PocketJS Motion — complex scripts, shaped (prototype)\nimport { mount } from "@pocketjs/framework";\nimport Shaped from "./app.tsx";\n\nmount(() => <Shaped />);\n`,
  );
  const rel = (p: string) => relative(root, p);
  const faceDecl = Object.fromEntries(
    [...faces.entries()].map(([name, { file }]) => [name, { regular: rel(file), bold: rel(file) }]),
  );
  await writeFile(
    join(out, "pocket-motion.json"),
    JSON.stringify(
      {
        motion: 1,
        durationFrames: 1,
        fps: 30,
        supersample: 1,
        fonts: {
          regular: "assets/fonts/HarmonyOS_Sans_Regular.ttf",
          bold: "assets/fonts/HarmonyOS_Sans_Bold.ttf",
          faces: faceDecl,
        },
      },
      null,
      2,
    ) + "\n",
  );
  const id = rel(out).replace(/[^a-z0-9]+/gi, "-");
  await writeFile(
    join(out, "pocket.json"),
    JSON.stringify(
      {
        $schema: "https://pocketjs.dev/schema/pocket-2.json",
        pocket: 2,
        id: `dev.pocket-stack.motion-${id}`,
        name: `pocketjs-motion-${id}`,
        title: "PocketJS Motion: complex scripts, shaped (prototype)",
        version: "0.0.0",
        engine: { capabilities: { requires: ["text.glyphs.baked"] } },
        app: {
          entry: `${rel(out)}/main.tsx`,
          output: `motion-${id}`,
          framework: "solid",
          viewport: { fixed: { logical: [1920, 1080], presentation: "native" } },
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ shaper: shaper.version, lines: report }, null, 2));
}

if (import.meta.main) await main();
