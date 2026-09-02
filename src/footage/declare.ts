/**
 * How a composition declares footage: the ONE entry point, for both halves.
 *
 * A footage track is one fact written twice — the sidecar says `grid`, and
 * the tree says how wide each tile is drawn — and the two are not
 * interchangeable. `openFootage` derives the grid from the tree and refuses
 * the track when the two disagree, but the DRAWN SIZE IS THE INGESTED SIZE,
 * so an edit that keeps them consistent and moves both stretches the picture
 * instead of failing. Nothing downstream can tell.
 *
 * So both halves come from here, out of the same numbers:
 *
 *   tileNodes()    the `<Image debugName=… class=…>` per cell
 *   footageTrack() the `footage[]` entry, with `grid` derived by `gridOf`
 *
 * and a generator states the picture's size once. `compositions/footage-tracks`,
 * `compositions/sound-roles` and `compositions/lower-third` all go through
 * this; before it, each wrote the `<Image>` template out itself and two of the
 * three ordered the class tokens differently, which is three chances for the
 * name and three for the geometry.
 *
 * **`<nodePrefix>/tile:<col>:<row>` is not an authoring vocabulary.** It is
 * the protocol the host uses to find the node it uploads pixels into, and an
 * author writing it by hand is writing a string that has to agree with
 * `FootageLayer.create`, `pictureSizeFromTree` and the sidecar's `grid` at the
 * same time. `lint` warns when it finds one it cannot attribute to a
 * `tileNodes` call (`src/lint/tiles.ts`, `footage.tileNamedByHand`).
 */

import type { FootageFit } from "../manifest/sidecar.ts";
import { gridOf, placeTile, tileDebugName } from "./tiling.ts";

export interface TileNodesOptions {
  /** The track's `nodePrefix`; the sidecar entry must carry the same one. */
  readonly nodePrefix: string;
  /** Drawn size of the whole picture, in composition pixels. */
  readonly width: number;
  readonly height: number;
  /** Texture edge, normally `TEX_MAX_DIM`. */
  readonly tile: number;
  /** Leading whitespace on each emitted line. */
  readonly indent?: string;
  /**
   * Where the tiles sit. Omitted means the picture's own origin, which is
   * what a generator wants when the tiles live inside a positioned wrapper.
   */
  readonly originX?: number;
  readonly originY?: number;
}

/**
 * One `<Image>` per cell, as source text, newline-joined.
 *
 * The class is `absolute left-… top-… w-… h-…` and the order is fixed here
 * rather than left to each caller: the literal is what the compiler keys a
 * style record on, so two spellings of one rectangle are two records in the
 * pak. `w-[Npx] h-[Npx]` is explicit on every tile because the drawn size IS
 * the ingested size and `pictureSizeFromTree` reads it back out of the tree —
 * a tile sized by its parent would leave the host with nothing to measure.
 */
export function tileNodes(options: TileNodesOptions): string {
  const indent = options.indent ?? "";
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const [cols, rows] = gridOf(options.width, options.height, options.tile);
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = placeTile(options.width, options.height, options.tile, col, row);
      lines.push(
        `${indent}<Image debugName="${tileDebugName(options.nodePrefix, col, row)}" ` +
          `class="absolute left-[${originX + t.x}px] top-[${originY + t.y}px] ` +
          `w-[${t.w}px] h-[${t.h}px]" />`,
      );
    }
  }
  return lines.join("\n");
}

export interface FootageTrackOptions {
  readonly id: string;
  /** Repo-relative path to the clip. */
  readonly src: string;
  readonly nodePrefix: string;
  readonly tile: number;
  /** The same drawn size `tileNodes` was given — `grid` is derived from it. */
  readonly width: number;
  readonly height: number;
  readonly startFrame: number;
  readonly endFrame: number;
  /** Omitted rather than defaulted to 0, so a sidecar can stay silent about it. */
  readonly sourceFrame?: number;
  readonly fit?: FootageFit;
}

/**
 * The `footage[]` entry for the tiles `tileNodes` emitted.
 *
 * `grid` is DERIVED from the same width/height/tile, which is the whole point
 * of this function existing beside that one: the two halves cannot be edited
 * apart because there is only one place to edit.
 *
 * Key order matches what the sidecars in this tree already carry, so a
 * generator switching to this function rewrites its sidecar byte for byte.
 */
export function footageTrack(options: FootageTrackOptions): Record<string, unknown> {
  const [cols, rows] = gridOf(options.width, options.height, options.tile);
  return {
    id: options.id,
    src: options.src,
    nodePrefix: options.nodePrefix,
    tile: options.tile,
    grid: [cols, rows],
    startFrame: options.startFrame,
    endFrame: options.endFrame,
    ...(options.sourceFrame !== undefined ? { sourceFrame: options.sourceFrame } : {}),
    ...(options.fit !== undefined ? { fit: options.fit } : {}),
  };
}
