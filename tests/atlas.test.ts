/**
 * FONT ATLAS header parsing.
 *
 * This exists because of what a wrong answer looks like. The parser feeds the
 * guard that refuses to measure a string a build never baked, and a codepoint
 * the atlas lacks measures as the tofu cell — a plausible number. A parser that
 * quietly returns an empty codepoint set disarms the guard and every width
 * downstream still looks reasonable. So the cases here are the ones that would
 * fail silently: a truncated cmap, an unaccepted version, no magic at all.
 *
 * Layout under test: `contracts/spec/spec.ts`, "FONT ATLAS binary format".
 */

import { describe, expect, test } from "bun:test";
import { parseAtlases } from "../src/text/atlas.ts";

interface AtlasSpec {
  readonly version?: number;
  readonly slot: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly baseline: number;
  readonly lineHeight: number;
  readonly density?: number;
  readonly bold?: boolean;
  readonly codepoints: readonly number[];
  /** Bytes to cut off the end, to model a truncated blob. */
  readonly truncate?: number;
}

function atlas(s: AtlasSpec): Uint8Array {
  const glyphs = s.codepoints.length;
  const bytes = new Uint8Array(16 + glyphs * 8);
  const view = new DataView(bytes.buffer);
  bytes.set([0x44, 0x43, 0x46, 0x41], 0); // 'D','C','F','A'
  view.setUint16(4, s.version ?? 3, true);
  view.setUint16(6, glyphs, true);
  bytes[8] = s.cellW;
  bytes[9] = s.cellH;
  bytes[10] = s.baseline;
  bytes[11] = s.lineHeight;
  bytes[12] = s.slot;
  bytes[13] = s.bold ? 1 : 0;
  bytes[14] = s.density ?? 1;
  s.codepoints.forEach((cp, i) => {
    view.setUint32(16 + i * 8, cp, true);
    view.setUint16(16 + i * 8 + 4, i, true);
    bytes[16 + i * 8 + 6] = 10; // advance
  });
  return s.truncate ? bytes.subarray(0, bytes.length - s.truncate) : bytes;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const PAD = new Uint8Array(24); // stand-in for the surrounding pak

const SANS = { slot: 14, cellW: 37, cellH: 45, baseline: 35, lineHeight: 45 } as const;

test("reads the header a fit step depends on", () => {
  const found = parseAtlases(concat(PAD, atlas({ ...SANS, codepoints: [0x41, 0x42] }), PAD));
  expect(found.size).toBe(1);
  const a = found.get(14)!;
  expect(a).toMatchObject({ slot: 14, cellW: 37, cellH: 45, baseline: 35, lineHeight: 45, bold: false });
  expect([...a.codepoints].sort((x, y) => x - y)).toEqual([0x41, 0x42]);
});

test("finds several atlases in one pak", () => {
  const found = parseAtlases(
    concat(
      atlas({ ...SANS, codepoints: [0x41] }),
      PAD,
      atlas({ ...SANS, slot: 20, cellH: 60, lineHeight: 60, bold: true, codepoints: [0x42, 0x4e00] }),
    ),
  );
  expect([...found.keys()].sort((a, b) => a - b)).toEqual([14, 20]);
  expect(found.get(20)!.bold).toBe(true);
  expect(found.get(20)!.codepoints.has(0x4e00)).toBe(true);
});

describe("refuses rather than half-reading", () => {
  test("a cmap that runs off the end of the buffer", () => {
    // The dangerous outcome is a PARTIAL codepoint set: the guard downstream
    // would then reject characters that were in fact baked, or worse, accept
    // ones that were not.
    expect(parseAtlases(atlas({ ...SANS, codepoints: [0x41, 0x42, 0x43], truncate: 12 })).size).toBe(0);
  });

  test("a version the layout is not pinned for", () => {
    expect(parseAtlases(atlas({ ...SANS, version: 5, codepoints: [0x41] })).size).toBe(0);
    expect(parseAtlases(atlas({ ...SANS, version: 1, codepoints: [0x41] })).size).toBe(0);
  });

  test("a v4 atlas is accepted — this parser reads the header and cmap, not the kern section", () => {
    const found = parseAtlases(atlas({ ...SANS, version: 4, density: 2, codepoints: [0x41] }));
    expect(found.size).toBe(1);
    expect(found.get(14)!.density).toBe(2);
  });

  test("bytes with no atlas in them", () => {
    expect(parseAtlases(new Uint8Array(512)).size).toBe(0);
    expect(parseAtlases(new Uint8Array([0x44, 0x43, 0x46])).size).toBe(0);
  });
});

test("a v2 atlas resolves to density 1", () => {
  // v2 used bytes 14..15 as reserved, so whatever is there is not a density.
  const bytes = atlas({ ...SANS, version: 2, density: 7, codepoints: [0x41] });
  expect(parseAtlases(bytes).get(14)!.density).toBe(1);
});
