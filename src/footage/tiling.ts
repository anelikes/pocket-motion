/**
 * Where each footage tile lives, in one place.
 *
 * A picture larger than `TEX_MAX_DIM` has to be split, and each piece is its
 * OWN texture. Bilinear sampling therefore cannot cross a join: at a tile's
 * right edge it blends the last column with itself instead of with the
 * neighbour's first, so joins sample as if nearest even when filtering is on
 * (`baselines/phase4-minification.md`).
 *
 * The fix is to give every tile a texel of its neighbour and never draw that
 * texel — the interior is `tile - 2*BLEED` wide, and the node's UV starts one
 * texel in. A sample at the interior's edge then blends against real
 * neighbouring pixels, which is what one large texture would have done.
 *
 * At the picture's outer edge there is no neighbour, so the bleed texel
 * replicates the edge pixel. That is also what one large texture would do
 * there, since the core's sampler clamps.
 *
 * The layer, the ingest manifest and every composition that lays out tiles all
 * read their geometry from here. They cannot be allowed to disagree: the layer
 * decides which source pixels a texture holds and the composition decides how
 * wide it is drawn, and a mismatch is a stretched picture, not an error.
 */

/** Texels of the neighbour carried on each side of a tile. */
export const BLEED = 1;

/**
 * What separates a track's `nodePrefix` from a tile's coordinates in a
 * `debugName`.
 *
 * The full shape is `<nodePrefix>/tile:<col>:<row>`, and it is a PROTOCOL
 * between the host and the guest rather than something an author composes:
 * `FootageLayer.create` builds the name to look the node up,
 * `pictureSizeFromTree` matches on the prefix to read the drawn size, and
 * `src/lint/tiles.ts` matches on the infix to notice one written by hand.
 * Four places spelled the same template out; if they ever disagreed the
 * symptom would be a track that cannot find its nodes, or worse, a picture
 * drawn at the wrong size.
 *
 * Authors do not write it. `tileNodes` (`src/footage/declare.ts`) does.
 */
export const TILE_NAME_INFIX = "/tile:";

/** The `debugName` of one tile. */
export function tileDebugName(nodePrefix: string, col: number, row: number): string {
  return `${nodePrefix}${TILE_NAME_INFIX}${col}:${row}`;
}

/** What every tile name of a track starts with. */
export function tileNamePrefix(nodePrefix: string): string {
  return `${nodePrefix}${TILE_NAME_INFIX}`;
}

/** Drawn pixels per tile — the texture minus its two bleed texels. */
export function interiorOf(tile: number): number {
  return tile - 2 * BLEED;
}

export function gridOf(width: number, height: number, tile: number): [cols: number, rows: number] {
  const interior = interiorOf(tile);
  return [Math.ceil(width / interior), Math.ceil(height / interior)];
}

export interface TilePlacement {
  /** Position of the tile's interior within the picture. */
  readonly x: number;
  readonly y: number;
  /** Drawn size. Right/bottom tiles are short when the picture does not divide. */
  readonly w: number;
  readonly h: number;
  /** Normalized sub-rect of the texture holding exactly that interior. */
  readonly uv: readonly [u0: number, v0: number, u1: number, v1: number];
}

export function placeTile(
  width: number, height: number, tile: number, col: number, row: number,
): TilePlacement {
  const interior = interiorOf(tile);
  const x = col * interior;
  const y = row * interior;
  const w = Math.min(interior, width - x);
  const h = Math.min(interior, height - y);
  return {
    x, y, w, h,
    uv: [BLEED / tile, BLEED / tile, (BLEED + w) / tile, (BLEED + h) / tile],
  };
}

/**
 * Source pixel a tile's texel maps to, clamped to the picture.
 *
 * Clamping is what makes the outer edges correct rather than a special case:
 * beyond the picture there is nothing to bleed, and replicating the edge pixel
 * is exactly the sampler's own clamp behaviour.
 */
export function sourceTexel(
  origin: number, texel: number, extent: number,
): number {
  const s = origin - BLEED + texel;
  return s < 0 ? 0 : s > extent - 1 ? extent - 1 : s;
}

/**
 * `sourceTexel` for a whole tile at once, as three spans instead of a per-texel
 * clamp: `lead` texels replicating the first source pixel, then `avail` texels
 * copied straight from source `first`, then the rest replicating the last.
 *
 * This is what the per-frame copy actually runs — one `set` per row rather than
 * `tile` of them. `tests/tiling.test.ts` pins it against `sourceTexel` texel by
 * texel, because the two drifting apart would shift the picture by a pixel
 * rather than fail.
 */
export interface TexelRun {
  readonly lead: number;
  readonly first: number;
  readonly avail: number;
}

export function texelRun(origin: number, extent: number, tile: number): TexelRun {
  const start = origin - BLEED;
  const lead = Math.max(0, -start);
  const first = start + lead;
  return { lead, first, avail: Math.min(tile - lead, extent - first) };
}
