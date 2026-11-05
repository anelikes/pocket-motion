/**
 * Skip the raster of a frame the core would draw exactly as it drew the last.
 *
 * A frame's pixels are a function of three things: the draw list's words, the
 * resources the raster reads through them (textures and font atlases, by
 * handle and slot), and the target — the scale and viewport. The core states
 * that itself: `damage::DamageTracker::prepare` repaints nothing when the
 * words, the core's raster revision and the target are all unchanged. Within
 * one render the target never changes, so the key here is the other two
 * (`BootedWorld.rasterKey`): `ui_draw_hash` over the words, and
 * `ui_raster_revision` (`patches/0051`). When frame f's key equals frame
 * f-1's, the raster is skipped and frame f-1's pixels are delivered again.
 *
 * WHY THE PAIR AND NOT THE HASH
 *
 * The words carry a texture HANDLE, and the walk emits it without resolving
 * it: free the texture an image is bound to and the words stay the same while
 * the raster draws nothing there. A font atlas loaded over a slot is the same
 * shape. Nothing in a mount-only render does either after mount — footage
 * frees and re-binds every frame, and a re-bound handle carries a new
 * generation, so its words move — but "nothing does" is a claim about which
 * ops this repository's guests and hosts call, and the revision is the
 * core's own record of every one of them. `tests/reuse.test.ts` frees a bound
 * texture mid-hold and is red with the revision dropped from the key.
 *
 * Under a shutter the hash is `ui_draw_hash_exposure`, every sample's draw
 * list folded in order, so a frame is reused only when every sample would be.
 *
 * THE HASH IS 64 BITS
 *
 * FNV-1a over the words, upstream's own dirty signal, compared between two
 * consecutive frames: two different lists collide by accident with a
 * probability of the order of 2^-64 per frame, the bound `src/render/hash.ts`
 * accepts for `--hash fast`. The frame hash is still taken of every
 * delivered frame, reused or not, so a reuse that delivered the wrong picture
 * is a digest that disagrees with the ledger: every composition in
 * `baselines/digests.json` traces to its recorded digest with the reuse on,
 * and the ledger recorded those digests with no reuse at all.
 *
 * WHAT IT DOES NOT CATCH
 *
 * A frame whose words moved and whose pixels did not. Measured on the
 * hajibang ranking template (`baselines/raster-reuse.md`): a background
 * image panning a fraction of a texel per frame moves one word of a TEX_QUAD
 * every frame, so no two consecutive draw lists are equal, while nearest
 * sampling leaves a third of the frames byte-identical to the one before.
 * Seeing those would need the raster's own quantisation in the key; this
 * keys on what the core states and nothing it would have to be asked to
 * predict.
 *
 * WHERE IT IS SOUND
 *
 * The pixels handed back are the view the last raster returned, into wasm
 * memory. They are still that frame's only while nothing else has rendered
 * from the world since — no probe, no `renderTick`, no checkpoint restore —
 * which holds in `render()`, the one caller, because it owns its source for
 * the whole loop. A view whose memory has grown under it is detached and
 * reads as zero bytes; that is rasterised again rather than delivered.
 */

/** What a reused read needs from the world. */
export interface ReuseWorld {
  readonly rasterKey: () => string;
}

export class RasterReuse {
  #key: string | null = null;
  #pixels: Uint8Array | null = null;
  #rasterised = 0;
  #reused = 0;
  readonly #world: ReuseWorld;
  readonly #render: () => Uint8Array;

  constructor(world: ReuseWorld, render: () => Uint8Array) {
    this.#world = world;
    this.#render = render;
  }

  /** The current frame's pixels: the last raster's when the key has not moved. */
  read(): Uint8Array {
    const key = this.#world.rasterKey();
    const held = this.#pixels;
    if (held !== null && key === this.#key && held.byteLength > 0) {
      this.#reused++;
      return held;
    }
    const rgba = this.#render();
    this.#key = key;
    this.#pixels = rgba;
    this.#rasterised++;
    return rgba;
  }

  /** Frames delivered from a raster of their own. */
  get rasterised(): number {
    return this.#rasterised;
  }

  /** Frames delivered as the previous frame's pixels. */
  get reused(): number {
    return this.#reused;
  }
}
