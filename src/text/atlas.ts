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
    for (let g = 0; g < glyphs; g++) {
      codepoints.add(view.getUint32(i + HEADER_SIZE + g * CMAP_ENTRY_SIZE, true));
    }
    out.set(pak[i + 12]!, {
      slot: pak[i + 12]!,
      cellW: pak[i + 8]!,
      cellH: pak[i + 9]!,
      baseline: pak[i + 10]!,
      lineHeight: pak[i + 11]!,
      density: version >= 3 ? pak[i + 14]! : 1,
      bold: (pak[i + 13]! & 1) !== 0,
      codepoints,
    });
  }
  return out;
}

export async function readAtlases(pakPath: string): Promise<Map<number, AtlasHeader>> {
  return parseAtlases(new Uint8Array(await Bun.file(pakPath).arrayBuffer()));
}
