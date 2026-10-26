/**
 * The footage layer — owned by the HOST, never by the guest.
 *
 * The guest declares placeholder image nodes at mount and never touches them
 * again, so it stays mount-only. The host swaps their pixels every frame, the
 * same way it feeds the pak: a host concern, not application logic.
 *
 * This is not an optimisation. `free_texture` bumps the slot generation, so
 * every outstanding copy of a handle goes stale and draws nothing
 * (`engine/core/src/lib.rs`). Re-binding is therefore mandatory each frame —
 * and if the guest did it, the guest would be doing per-frame work and
 * checkpointing would no longer be sound.
 */

import { closeSync, openSync, readSync } from "node:fs";
import { spanFrames, storedIndex, type IngestManifest } from "./ingest.ts";
import { interiorOf, placeTile, texelRun, tileDebugName } from "./tiling.ts";

/** Subset of HostOps this layer needs. */
export interface FootageOps {
  uploadTexture(buf: Uint8Array, w: number, h: number, psm: number): number;
  setImage(id: number, tex: number): void;
  freeTexture?(handle: number): void;
  /** Present only on a host built from `patches/0004`; see `linear` below. */
  uploadTextureFlags?(buf: Uint8Array, w: number, h: number, psm: number, flags: number): number;
  /** Present only on a host built from `patches/0005`; see `tiling.ts`. */
  setImageUv?(id: number, u0: number, v0: number, u1: number, v1: number): void;
}

/** DevTools tree node shape (`framework/src/devtools.ts` TreeNodeJson). */
interface TreeNode {
  i: number;
  n?: string;
  k?: TreeNode[];
}

const PSM_8888 = 3;

/** `spec::img::FLAG_LINEAR` — bilinear sampling instead of the nearest default. */
const IMG_FLAG_LINEAR = 1 << 1;

export interface FootageLayerOptions {
  readonly manifest: IngestManifest;
  readonly rawPath: string;
  /** debugName prefix the composition used, e.g. "footage:a-roll". */
  readonly nodePrefix: string;
  /** Composition tree from a single getTree() after mount. */
  readonly tree: unknown;
  readonly ops: FootageOps;
  /** Run host-side ops inside this so the mount-only oracle excludes them. */
  readonly asHost?: <T>(fn: () => T) => T;
  /**
   * Sample the tiles bilinearly rather than nearest.
   *
   * Only matters when the rasteriser resamples — footage drawn at its ingested
   * size is exact either way, and nearest is the golden-pinned default the rest
   * of the framework depends on, so this is off unless asked for.
   *
   * Requesting it on a host that cannot do it **throws**. The wasm export is
   * feature-detected upstream-style, and a silent fall back to nearest here
   * would return a wrong number rather than an error
   * (`baselines/phase4-minification.md`).
   */
  readonly linear?: boolean;
}

/**
 * Resolve `<prefix>/tile:<col>:<row>` debugNames to node ids, then swap each
 * tile's texture per frame.
 */
export class FootageLayer {
  #ops: FootageOps;
  #nodeByTile: (number | undefined)[];
  #live: number[] = [];
  #fd: number;
  /** One decoded picture — `width * height * 4`. The rest of the clip stays on disk. */
  #pixels: Uint8Array;
  /** Frame currently in `#pixels`, or -1 before the first read. */
  #loaded = -1;
  #m: IngestManifest;
  #asHost: <T>(fn: () => T) => T;
  #upload: (cell: Uint8Array, tile: number) => number;

  private constructor(o: FootageLayerOptions, fd: number, nodes: (number | undefined)[]) {
    this.#ops = o.ops;
    this.#m = o.manifest;
    this.#fd = fd;
    this.#pixels = new Uint8Array(o.manifest.width * o.manifest.height * 4);
    this.#nodeByTile = nodes;
    this.#asHost = o.asHost ?? ((fn) => fn());
    const ops = o.ops;
    this.#upload = o.linear
      ? (cell, tile) => ops.uploadTextureFlags!(cell, tile, tile, PSM_8888, IMG_FLAG_LINEAR)
      : (cell, tile) => ops.uploadTexture(cell, tile, tile, PSM_8888);
  }

  static async create(o: FootageLayerOptions): Promise<FootageLayer> {
    const [cols, rows] = o.manifest.grid;
    const nodes: (number | undefined)[] = new Array(cols * rows).fill(undefined);
    const byName = new Map<string, number>();
    walk(o.tree as TreeNode | null, byName);

    const missing: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const name = tileDebugName(o.nodePrefix, c, r);
        const id = byName.get(name);
        if (id === undefined) missing.push(name);
        else nodes[r * cols + c] = id;
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `PocketJS Motion: composition is missing footage tile nodes: ${missing.slice(0, 4).join(", ")}` +
          (missing.length > 4 ? ` (+${missing.length - 4} more)` : "") +
          `\nThe ${cols}x${rows} tile nodes come from \`tileNodes\` in ` +
          "`src/footage/declare.ts`, called with this picture's drawn size.",
      );
    }
    if (o.linear && typeof o.ops.uploadTextureFlags !== "function") {
      throw new Error(
        "PocketJS Motion: linear footage sampling was requested but the host has no " +
          "uploadTextureFlags op.\nThe wasm rasteriser predates `patches/0004`; rebuild it " +
          "with `bun scripts/vendor.ts`.\nFalling back to nearest would answer the question " +
          "wrongly rather than not at all, so this is an error.",
      );
    }
    if (typeof o.ops.setImageUv !== "function") {
      throw new Error(
        "PocketJS Motion: the host has no setImageUv op.\nThe wasm rasteriser predates " +
          "`patches/0005`; rebuild it with `bun scripts/vendor.ts`.\nTiles carry a bleed texel " +
          "on each side and are drawn through an inset UV rect; without it every tile would " +
          "draw its neighbour's pixels stretched over the join.",
      );
    }

    // State the sub-rect once, at mount. It is a property of the node, not of
    // the binding, so the per-frame texture swap does not have to repeat it.
    const { width, height, tile } = o.manifest;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const node = nodes[r * cols + c];
        if (node === undefined) continue;
        const { uv } = placeTile(width, height, tile, c, r);
        o.ops.setImageUv(node, uv[0], uv[1], uv[2], uv[3]);
      }
    }

    if (spanFrames(o.manifest.spans) !== o.manifest.frames) {
      throw new Error(
        `PocketJS Motion: footage manifest for ${JSON.stringify(o.nodePrefix)} holds ` +
          `${o.manifest.frames} frames but its spans ${JSON.stringify(o.manifest.spans)} ` +
          `cover ${spanFrames(o.manifest.spans)}.`,
      );
    }

    // The raw file is width*height*4*frames. present() only ever consumes one
    // window of that; keeping the rest resident is a function of duration
    // and is what made a multi-track film an allocation failure.
    const fd = openSync(o.rawPath, "r");
    return new FootageLayer(o, fd, nodes);
  }

  get frames(): number {
    return this.#m.frames;
  }

  /**
   * Bind source frame `n`'s pixels. Call once per rendered frame, before
   * render().
   *
   * `n` is the clip's own frame — `sourceFrame + (compositionFrame -
   * startFrame)` — and the manifest's spans say where it is stored. A frame
   * no span holds is refused. It used to be clamped to the nearest stored
   * one, which with a whole clip on disk only ever met an index past either
   * end; with spans it would also meet the gap between two, and show a
   * picture from the wrong side of it.
   */
  present(n: number): void {
    if (this.#fd < 0) {
      throw new Error("PocketJS Motion: FootageLayer.present after close");
    }
    const { width, height, tile, grid, spans } = this.#m;
    const [cols, rows] = grid;
    const frame = storedIndex(spans, n);
    if (frame === undefined) {
      throw new Error(
        `PocketJS Motion: footage frame ${n} is outside the decoded spans ` +
          `${JSON.stringify(spans)} of ${JSON.stringify(this.#m.src)}.\n` +
          "The ingest decodes the source frames the sidecar's placement can reach " +
          "(`src/cli/footage.ts`); a frame outside them was never written.",
      );
    }
    const frameBytes = width * height * 4;

    // Sequential present of the same n is one read, not one per call. The
    // rebind below still runs: free_texture bumps the slot generation, and a
    // checkpoint restore re-presents the same index onto invalidated handles.
    if (this.#loaded !== frame) {
      const got = readSync(this.#fd, this.#pixels, 0, frameBytes, frame * frameBytes);
      if (got !== frameBytes) {
        throw new Error(
          `PocketJS Motion: footage raw read was short (wanted ${frameBytes} at frame ${frame}, got ${got})`,
        );
      }
      this.#loaded = frame;
    }

    this.#asHost(() => {
      for (const h of this.#live) this.#ops.freeTexture?.(h);
      this.#live.length = 0;

      const interior = interiorOf(tile);
      const cell = new Uint8Array(tile * tile * 4);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Every texel is written, bleed included. The interior lands at
          // texels [BLEED, BLEED+w); the texels either side hold the
          // neighbour's pixels, or the picture's own edge replicated where
          // there is no neighbour — which is the sampler's clamp either way.
          const rx = texelRun(c * interior, width, tile);
          const ry = texelRun(r * interior, height, tile);
          for (let ty = 0; ty < tile; ty++) {
            const sy = ry.first + Math.min(Math.max(ty - ry.lead, 0), ry.avail - 1);
            const row = sy * width * 4;
            const dst = ty * tile * 4;
            const left = row + rx.first * 4;
            const right = row + (rx.first + rx.avail - 1) * 4;
            for (let tx = 0; tx < rx.lead; tx++) cell.set(this.#pixels.subarray(left, left + 4), dst + tx * 4);
            cell.set(this.#pixels.subarray(left, left + rx.avail * 4), dst + rx.lead * 4);
            for (let tx = rx.lead + rx.avail; tx < tile; tx++) {
              cell.set(this.#pixels.subarray(right, right + 4), dst + tx * 4);
            }
          }
          const handle = this.#upload(cell, tile);
          const node = this.#nodeByTile[r * cols + c];
          if (node !== undefined) this.#ops.setImage(node, handle);
          this.#live.push(handle);
        }
      }
    });
  }

  /** Release the raw file descriptor. Idempotent. */
  close(): void {
    if (this.#fd < 0) return;
    closeSync(this.#fd);
    this.#fd = -1;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  /** Handles currently bound — the checkpoint/restore path needs these. */
  get liveHandles(): readonly number[] {
    return this.#live;
  }
}

function walk(node: TreeNode | null, out: Map<string, number>): void {
  if (!node || typeof node !== "object") return;
  if (typeof node.n === "string") out.set(node.n, node.i);
  for (const child of node.k ?? []) walk(child, out);
}
