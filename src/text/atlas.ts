/**
 * Read baked FONT ATLAS headers out of a pak.
 *
 * Two things a build-time fit needs are not on the ops table:
 *
 * - **Line height.** `Ui::measure_text` is `measure_run(...).0` — width only —
 *   so the line advance a wrapped block's height depends on cannot be asked
 *   for. It is byte 11 of each atlas header.
 * - **Which codepoints exist.** A codepoint the atlas does not carry resolves
 *   to tofu and MEASURES as `cell_w` (`engine/core/src/text.rs`, `glyph()`), so
 *   a build that was never asked to bake a character still returns a plausible
 *   width for it, and every self-consistency check passes. Reading the cmap is
 *   the only way to refuse.
 *
 * The atlases are found by scanning for the magic rather than by walking the
 * pak directory: the layout being scanned for is pinned in
 * `contracts/spec/spec.ts` under "FONT ATLAS binary format", and the magic plus
 * an accepted version is a stronger match than a key convention.
 */

/** 'D','C','F','A' — `spec.FONT_MAGIC`, little-endian. */
const MAGIC = [0x44, 0x43, 0x46, 0x41] as const;
const HEADER_SIZE = 16;
const CMAP_ENTRY_SIZE = 8;

export interface AtlasHeader {
  readonly slot: number;
  /** Logical cell dimensions in px. */
  readonly cellW: number;
  readonly cellH: number;
  /** Logical px from the cell top to the baseline. */
  readonly baseline: number;
  /** Default logical line advance in px — what a block's height is built from. */
  readonly lineHeight: number;
  /** Raster samples per logical pixel (v2 atlases resolve to 1). */
  readonly density: number;
  readonly bold: boolean;
  /** Codepoints this atlas carries. */
  readonly codepoints: ReadonlySet<number>;
  /** FONT_FLAG_METRICS_ONLY (bit 1 of byte 13): baked with `--metrics-only`,
   *  1x1 empty cells, real advances. Measures; must never be drawn. */
  readonly metricsOnly: boolean;
  /** Logical px advance per codepoint (the cmap's byte 6). */
  readonly advances: ReadonlyMap<number, number>;
  /** Kern pairs by codepoint, `"<left>,<right>"` -> logical px; empty before v4. */
  readonly kern: ReadonlyMap<string, number>;
  /** A FONT VECTOR slot read as an atlas header (`slotHeaders`): outlines,
   *  no cells, so `cellW` is 0 and `density` is whatever the build's was. */
  readonly vector?: true;
}

export function parseAtlases(pak: Uint8Array): Map<number, AtlasHeader> {
  const view = new DataView(pak.buffer, pak.byteOffset, pak.byteLength);
  const out = new Map<number, AtlasHeader>();
  for (let i = 0; i + HEADER_SIZE <= pak.length; i++) {
    if (pak[i] !== MAGIC[0] || pak[i + 1] !== MAGIC[1] || pak[i + 2] !== MAGIC[2] || pak[i + 3] !== MAGIC[3]) {
      continue;
    }
    const version = view.getUint16(i + 4, true);
    if (version !== 2 && version !== 3 && version !== 4) continue;
    const glyphs = view.getUint16(i + 6, true);
    const cmapEnd = i + HEADER_SIZE + glyphs * CMAP_ENTRY_SIZE;
    if (cmapEnd > pak.length) continue;
    const codepoints = new Set<number>();
    const advances = new Map<number, number>();
    const byGid = new Map<number, number>();
    for (let g = 0; g < glyphs; g++) {
      const at = i + HEADER_SIZE + g * CMAP_ENTRY_SIZE;
      const cp = view.getUint32(at, true);
      codepoints.add(cp);
      advances.set(cp, pak[at + 6]!);
      byGid.set(view.getUint16(at + 4, true), cp);
    }
    const density = version >= 3 ? pak[i + 14]! : 1;
    const kern = new Map<string, number>();
    if (version === 4) {
      const at = cmapEnd + glyphs * pak[i + 8]! * density * pak[i + 9]! * density;
      if (at + 4 <= pak.length) {
        const pairs = view.getUint32(at, true);
        for (let k = 0; k < pairs && at + 4 + (k + 1) * 5 <= pak.length; k++) {
          const o = at + 4 + k * 5;
          const l = byGid.get(view.getUint16(o, true));
          const r = byGid.get(view.getUint16(o + 2, true));
          if (l !== undefined && r !== undefined) kern.set(`${l},${r}`, view.getInt8(o + 4));
        }
      }
    }
    out.set(pak[i + 12]!, {
      slot: pak[i + 12]!,
      cellW: pak[i + 8]!,
      cellH: pak[i + 9]!,
      baseline: pak[i + 10]!,
      lineHeight: pak[i + 11]!,
      density: version >= 3 ? pak[i + 14]! : 1,
      bold: (pak[i + 13]! & 1) !== 0,
      metricsOnly: (pak[i + 13]! & 2) !== 0,
      codepoints,
      advances,
      kern,
    });
  }
  return out;
}

/** 'D','C','F','V' — `spec.FONT_VECTOR_MAGIC` (pocket-motion), little-endian. */
const VECTOR_MAGIC = [0x44, 0x43, 0x46, 0x56] as const;
const VECTOR_HEADER_SIZE = 36;

/**
 * A FONT VECTOR blob's header and metrics (`patches/0063`): a slot drawn as
 * outlines, or an atlas slot's colour-glyph supplement. The metrics are the
 * atlas's formulas in wider fields, so at one size an atlas slot and a vector
 * slot compare field for field.
 */
export interface VectorFaceHeader {
  readonly slot: number;
  readonly bold: boolean;
  readonly metricsOnly: boolean;
  /** Carries an atlas slot's colour glyphs; its metrics are unused. */
  readonly supplement: boolean;
  readonly cellH: number;
  readonly baseline: number;
  readonly lineHeight: number;
  readonly codepoints: ReadonlySet<number>;
  readonly advances: ReadonlyMap<number, number>;
  readonly kern: ReadonlyMap<string, number>;
  /** Layers per codepoint: 1 for a plain glyph, more for a colour one. */
  readonly layers: ReadonlyMap<number, number>;
}

/** Every FONT VECTOR blob in a pak, found by its magic as atlases are. */
export function parseVectorFaces(pak: Uint8Array): VectorFaceHeader[] {
  const view = new DataView(pak.buffer, pak.byteOffset, pak.byteLength);
  const out: VectorFaceHeader[] = [];
  for (let i = 0; i + VECTOR_HEADER_SIZE <= pak.length; i++) {
    if (pak[i] !== VECTOR_MAGIC[0] || pak[i + 1] !== VECTOR_MAGIC[1] || pak[i + 2] !== VECTOR_MAGIC[2] || pak[i + 3] !== VECTOR_MAGIC[3]) {
      continue;
    }
    if (view.getUint16(i + 4, true) !== 1) continue;
    const flags = view.getUint16(i + 6, true);
    const glyphs = view.getUint32(i + 16, true);
    const pairs = view.getUint32(i + 20, true);
    const cmapAt = i + VECTOR_HEADER_SIZE;
    const glyphAt = cmapAt + glyphs * 8;
    const kernAt = glyphAt + glyphs * 8;
    if (kernAt + pairs * 6 > pak.length) continue;
    const codepoints = new Set<number>();
    const advances = new Map<number, number>();
    const byGid = new Map<number, number>();
    const layers = new Map<number, number>();
    let valid = true;
    for (let g = 0; g < glyphs; g++) {
      const at = cmapAt + g * 8;
      const cp = view.getUint32(at, true);
      const gid = view.getUint16(at + 4, true);
      // Four bytes that happen to spell the magic are not a blob.
      if (gid >= glyphs) {
        valid = false;
        break;
      }
      codepoints.add(cp);
      advances.set(cp, view.getUint16(at + 6, true));
      byGid.set(gid, cp);
      layers.set(cp, view.getUint16(glyphAt + gid * 8 + 4, true));
    }
    if (!valid) continue;
    const kern = new Map<string, number>();
    for (let k = 0; k < pairs; k++) {
      const o = kernAt + k * 6;
      const l = byGid.get(view.getUint16(o, true));
      const r = byGid.get(view.getUint16(o + 2, true));
      if (l !== undefined && r !== undefined) kern.set(`${l},${r}`, view.getInt16(o + 4, true));
    }
    out.push({
      slot: pak[i + 12]!,
      bold: (flags & 1) !== 0,
      metricsOnly: (flags & 2) !== 0,
      supplement: (flags & 4) !== 0,
      cellH: view.getUint16(i + 8, true),
      baseline: view.getUint16(i + 10, true),
      lineHeight: view.getUint16(i + 14, true),
      codepoints,
      advances,
      kern,
      layers,
    });
  }
  return out;
}

export async function readAtlases(pakPath: string): Promise<Map<number, AtlasHeader>> {
  return parseAtlases(new Uint8Array(await Bun.file(pakPath).arrayBuffer()));
}

/**
 * Every slot's metrics, atlas or vector (`patches/0063`), by slot. A vector
 * slot has no raster density — its outlines are filled at the frame's — so
 * it is reported at `density`, the one the build was asked for, and a reader
 * that checks density against the build's sees it agree. A supplement holds
 * no metrics of its own and is not a slot here.
 */
export function slotHeaders(pak: Uint8Array, density: number): Map<number, AtlasHeader> {
  const out = parseAtlases(pak);
  for (const v of parseVectorFaces(pak)) {
    if (v.supplement) continue;
    out.set(v.slot, {
      slot: v.slot,
      cellW: 0,
      cellH: v.cellH,
      baseline: v.baseline,
      lineHeight: v.lineHeight,
      density,
      bold: v.bold,
      codepoints: v.codepoints,
      metricsOnly: v.metricsOnly,
      advances: v.advances,
      kern: v.kern,
      vector: true,
    });
  }
  return out;
}
