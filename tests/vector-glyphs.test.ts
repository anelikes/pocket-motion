/**
 * Vector glyphs (`patches/0063`): a text size whose atlas cell would exceed
 * the FONT ATLAS header's 255 px, or a literal that says `text-vector`, bakes
 * as a FONT VECTOR face, and the core fills its glyphs' outlines as PATH ops.
 *
 * The claim these tests hold is the switch-over: at the largest size both can
 * bake, an atlas slot and a vector slot of one face carry the same metrics —
 * baseline, cell height, line height, every advance, every kern pair — so a
 * string lays out identically whichever draws it, and the outline lands on
 * the atlas glyph's pixels. The sizes are each face's ceiling, computed from
 * its `hhea` (176 px for Noto Sans SC, 211 px for Inter), so a test at the
 * ceiling is the switch-over itself. One size past it must bake rather than be
 * refused, which was `patches/0002`'s answer.
 *
 * Red, each watched (`baselines/vector-glyphs/redcheck.ts`):
 *   - `bakeVectorSlot` rounding an advance with Math.floor: "carry the atlas's
 *     metrics" fails on the first advance with a fraction over .5;
 *   - its kern pairs dropped (`pairs` = []): the same test, on the kern map;
 *   - its baseline as Math.ceil(ascent): the same test, on `baseline`;
 *   - `bakeEither`'s ceiling test removed: "past the ceiling" fails with
 *     0002's refusal from the build;
 *   - `slotHeaders` leaving vector slots out: "measures a size past the
 *     ceiling" fails, the measurer finding no slot for 480 px;
 *   - `emit_vector_glyphs` not rounding the anchor (`snap` false): "the
 *     outlines land where the atlas draws" fails on the pixel-for-pixel share
 *     (2.96% against the 1.5% bound), each cell sitting half a pixel down a
 *     line box one pixel taller than it for that.
 *
 * `VECTOR_GLYPHS_PRINT=1` prints the ink boxes, totals and share the last
 * test compares — the numbers `baselines/vector-glyphs.md` records.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { WasmFrameSource } from "../src/runtime/frame-source.ts";
import { parseAtlases, parseVectorFaces } from "../src/text/atlas.ts";
import { openMeasurer } from "../src/text/measure.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const TMP = scratchDir("vector-glyphs");

const W = 1800;
const H = 1200;
const CJK = "第一名AVATAR";
const LATIN = "AVATAR Wo.";

/** One absolutely placed line. Both faces' cells are 255 px at their
 *  ceilings, so a 256 px line puts the cell half a pixel down its line box:
 *  GLYPH_RUN rounds that anchor to a whole pixel, and the outline must land
 *  where it does. */
const line = (name: string, top: number, cls: string, text: string) =>
  `    <Text debugName="${name}" class="absolute left-[40px] top-[${top}px] leading-[256px] ${cls} text-white">{${JSON.stringify(text)}}</Text>`;

async function stage(): Promise<ResolvedComposition> {
  const tree = join(TMP, "tree");
  mkdirSync(join(tree, "dist"), { recursive: true });
  for (const entry of readdirSync(ROOT)) {
    if (entry === "dist" || entry === ".git" || entry === "compositions") continue;
    symlinkSync(join(ROOT, entry), join(tree, entry));
  }
  const dir = join(tree, "compositions", "switch-over");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "main.tsx"),
    [
      'import { mount } from "@pocketjs/framework";',
      'import { Text, View } from "@pocketjs/framework/components";',
      "",
      "mount(() => (",
      '  <View class="w-full h-full bg-black">',
      line("atlas-cjk", 20, "text-[176px] font-bold", CJK),
      line("vector-cjk", 280, "text-[176px] font-bold text-vector", CJK),
      line("atlas-latin", 540, "font-[inter] text-[211px]", LATIN),
      line("vector-latin", 840, "font-[inter] text-[211px] text-vector", LATIN),
      // One px past Noto Sans SC's ceiling, off the canvas: baked, not refused.
      line("past", 1300, "text-[177px] font-bold", "第"),
      "  </View>",
      "));",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "pocket-motion.json"),
    JSON.stringify({
      motion: 1,
      durationFrames: 1,
      fps: 30,
      supersample: 1,
      fonts: {
        regular: "assets/fonts/NotoSansSC-Regular.otf",
        bold: "assets/fonts/NotoSansSC-Bold.otf",
        faces: {
          inter: {
            regular: "vendor/pocketjs/assets/fonts/Inter-Regular.ttf",
            bold: "vendor/pocketjs/assets/fonts/Inter-Bold.ttf",
          },
        },
      },
    }),
  );
  writeFileSync(
    join(dir, "pocket.json"),
    JSON.stringify({
      $schema: "https://pocketjs.dev/schema/pocket-2.json",
      pocket: 2,
      id: "dev.pocket-stack.motion-switch-over",
      name: "pocketjs-motion-switch-over",
      title: "atlas and vector at one size",
      version: "0.0.0",
      engine: { capabilities: { requires: [] } },
      app: {
        entry: "compositions/switch-over/main.tsx",
        output: "main",
        framework: "solid",
        viewport: { fixed: { logical: [W, H], presentation: "native" } },
      },
    }),
  );
  const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error(`switch-over: ${resolved.message}`);
  await runBuild(resolved.value);
  return resolved.value;
}

let c: ResolvedComposition;
let slots: Record<number, { px: number; bold: boolean; face?: string; vector?: boolean }>;

beforeAll(async () => {
  c = await stage();
  const styles = readFileSync(join(c.bundlePath, "..", "main.styles.ts"), "utf8");
  const block = /export const FONT_SLOTS[^=]*= (\{[\s\S]*?\n\});/.exec(styles)![1]!;
  slots = Function(`return (${block});`)() as typeof slots;
}, 120_000);

describe("vector glyphs at the switch-over", () => {
  test("at a face's largest atlas size, a vector slot carries the atlas's metrics", () => {
    const pak = new Uint8Array(readFileSync(c.pakPath));
    const atlases = parseAtlases(pak);
    const vectors = new Map(parseVectorFaces(pak).map((v) => [v.slot, v]));
    const pairs = Object.entries(slots).filter(([, s]) => s.vector === true);
    expect(pairs.length).toBe(2);
    for (const [vslot, s] of pairs) {
      const [aslot] = Object.entries(slots).find(
        ([, a]) => a.vector !== true && a.px === s.px && a.bold === s.bold && a.face === s.face,
      )!;
      const atlas = atlases.get(Number(aslot))!;
      const vector = vectors.get(Number(vslot))!;
      expect(atlas).toBeDefined();
      expect(vector.supplement).toBe(false);
      expect({ baseline: vector.baseline, cellH: vector.cellH, lineHeight: vector.lineHeight }).toEqual({
        baseline: atlas.baseline,
        cellH: atlas.cellH,
        lineHeight: atlas.lineHeight,
      });
      // Every codepoint the build collected, not one string: the charset is
      // global, so this is the whole of what either slot can lay out.
      expect(vector.advances).toEqual(atlas.advances);
      expect(vector.kern).toEqual(atlas.kern);
      expect(atlas.kern.size).toBeGreaterThan(0);
    }
  });

  test("past the ceiling the size bakes as a vector slot instead of being refused", () => {
    const [slot] = Object.entries(slots).find(([, s]) => s.px === 177)!;
    const vector = parseVectorFaces(new Uint8Array(readFileSync(c.pakPath))).find((v) => v.slot === Number(slot));
    expect(vector).toBeDefined();
    // round(1.160 * 177) + ceil(0.288 * 177) = 205 + 51: one row past the u8.
    expect(vector!.cellH).toBe(256);
    expect(parseAtlases(new Uint8Array(readFileSync(c.pakPath))).has(Number(slot))).toBe(false);
  });

  test("a generator measures a size past the ceiling as it measures an atlas", async () => {
    const m = await openMeasurer({
      face: { regular: join(ROOT, "assets/fonts/NotoSansSC-Regular.otf"), bold: join(ROOT, "assets/fonts/NotoSansSC-Bold.otf") },
      sizes: [{ px: 480, bold: true }],
      texts: ["第一名"],
      workdir: join(TMP, "measure"),
    });
    try {
      // Three full-width glyphs, 480 px each; the line round(1.448 * 480).
      expect(m.measure(480, true)("第一名")).toBe(1440);
      expect(m.lineHeight(480, true)).toBe(695);
    } finally {
      await m.close();
    }
  }, 120_000);

  test("the outlines land where the atlas draws the same text", async () => {
    const source = await WasmFrameSource.create({
      compositionId: c.compositionId,
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      width: c.width,
      height: c.height,
      hz: c.fps,
      durationFrames: c.durationFrames,
      renderScale: 1,
      shutter: null,
    });
    await source.seekFrame(0);
    const rgba = source.read().slice();
    await source.dispose();
    // The ink box of a band of rows, in band-relative coordinates, from the
    // green channel (the text is white on black).
    const ink = (top: number, rows: number) => {
      let [x0, y0, x1, y1] = [W, rows, -1, -1];
      let sum = 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < W; x++) {
          const g = rgba[((top + y) * W + x) * 4 + 1]!;
          sum += g;
          if (g > 127) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
      }
      return { box: [x0, y0, x1, y1], sum };
    };
    // How far apart two bands are, pixel by pixel, as a share of the ink.
    const apart = (a: number, b: number, rows: number) => {
      let diff = 0;
      let sum = 0;
      for (let i = 0; i < rows * W; i++) {
        const p = rgba[(a * W + i) * 4 + 1]!;
        diff += Math.abs(p - rgba[(b * W + i) * 4 + 1]!);
        sum += p;
      }
      return diff / sum;
    };
    for (const [a, v, rows] of [
      [20, 280, 260],
      [540, 840, 300],
    ] as const) {
      const atlas = ink(a, rows);
      const vector = ink(v, rows);
      const share = apart(a, v, rows);
      if (process.env.VECTOR_GLYPHS_PRINT) console.log(JSON.stringify({ atlas, vector, share }));
      // Same glyphs at the same anchors: the half-coverage boundary moves by
      // at most one pixel between two rasterisers of one outline.
      for (let k = 0; k < 4; k++) expect(Math.abs(vector.box[k]! - atlas.box[k]!)).toBeLessThanOrEqual(1);
      // And the same amount of ink, within 1%: a glyph drawn at another
      // size or with an advance off by a pixel moves this by more.
      expect(Math.abs(vector.sum - atlas.sum) / atlas.sum).toBeLessThan(0.01);
      // And pixel for pixel: two rasterisers of one outline at one anchor
      // differ by about 0.5% of the ink (measured at both ceilings); half a
      // pixel of anchor between them is several times that.
      expect(share).toBeLessThan(0.015);
    }
  }, 60_000);
});
