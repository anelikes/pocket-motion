/**
 * One composition, one FrameSource — the preview runtime.
 *
 * The browser never boots a world. This session is the same host `frame` and
 * `render` drive: hardened boot, checkpoint-forward seek, host-owned footage.
 * A PNG from `/frame?at=N` is the same bytes `frame --at N` would write.
 *
 * Restore inflates wasm linear memory by one framebuffer per cycle. When that
 * ratchet trips (memory > 4× boot) or a rewind has no snapshot at or before
 * the target, the session disposes the world and boots again — the same
 * cold-start + fold `frame --at N` already does.
 */

import { existsSync } from "node:fs";
import {
  inspectLayout,
  type LayoutNode,
} from "../cli/commands/layout.ts";
import { artefactDigest } from "../cli/artefacts.ts";
import { openFootage, scratchTree, type FootageHandle } from "../cli/footage.ts";
import { errMsg, type ResolvedComposition } from "../cli/resolve.ts";
import { hashFrame } from "../render/hash.ts";
import { pocketjsRoot } from "../runtime/boot.ts";
import { SeekCapabilityError, WasmFrameSource } from "../runtime/frame-source.ts";

export interface PreviewMeta {
  readonly compositionId: string;
  readonly dir: string;
  readonly durationFrames: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly supersample: 1 | 2 | 4;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly hasFootage: boolean;
}

export interface FramePng {
  readonly at: number;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly width: number;
  readonly height: number;
}

export interface LayoutAt {
  readonly at: number;
  readonly viewport: readonly [number, number];
  readonly notInPicture: number;
  readonly nodes: readonly LayoutNode[];
}

export interface PreviewSessionOptions {
  readonly checkpointInterval?: number;
  readonly checkpointMax?: number;
  /** Rebuild when linear memory exceeds this multiple of the boot size. Default 4. */
  readonly rebuildWhenMemoryMultiple?: number;
}

type EncodePng = (rgba: Uint8Array, w: number, h: number) => Buffer;

const DEFAULT_CHECKPOINT_INTERVAL = 30;
const DEFAULT_REBUILD_MULTIPLE = 4;

export class PreviewSession {
  /**
   * How many sessions are holding a wasm world right now.
   *
   * "One session at a time" is the host's stated invariant and the reason
   * selecting another composition closes this one: a single `FootageLayer`
   * has been measured holding ~13 GiB resident, so two live sessions over
   * footage is that twice. Nothing outside this class could see whether the
   * invariant held, so a switch that opened two worlds — or opened one and
   * lost track of the other — looked exactly like a switch that did neither.
   * Exposed for the same reason `memoryBytes` is.
   */
  static openSessions = 0;

  readonly meta: PreviewMeta;
  readonly composition: ResolvedComposition;
  #closed = false;
  #source: WasmFrameSource;
  #tree: unknown;
  #footage: FootageHandle | null;
  #encodePng: EncodePng;
  #queue: Promise<unknown> = Promise.resolve();
  #checkpointInterval: number;
  #checkpointMax: number | undefined;
  #rebuildMultiple: number;
  #bootMemory: number;
  #bootArtefacts: string;

  private constructor(
    composition: ResolvedComposition,
    source: WasmFrameSource,
    tree: unknown,
    footage: FootageHandle | null,
    encodePng: EncodePng,
    checkpointInterval: number,
    checkpointMax: number | undefined,
    rebuildMultiple: number,
    bootArtefacts: string,
  ) {
    this.#bootArtefacts = bootArtefacts;
    this.composition = composition;
    this.#source = source;
    this.#tree = tree;
    this.#footage = footage;
    this.#encodePng = encodePng;
    this.#checkpointInterval = checkpointInterval;
    this.#checkpointMax = checkpointMax;
    this.#rebuildMultiple = rebuildMultiple;
    this.#bootMemory = source.memoryBytes;
    const physicalWidth = composition.width * composition.supersample;
    const physicalHeight = composition.height * composition.supersample;
    this.meta = {
      compositionId: composition.compositionId,
      dir: composition.dir,
      durationFrames: composition.durationFrames,
      fps: composition.fps,
      width: composition.width,
      height: composition.height,
      supersample: composition.supersample,
      physicalWidth,
      physicalHeight,
      hasFootage: composition.sidecar.footage.length > 0,
    };
  }

  static async open(
    composition: ResolvedComposition,
    options: PreviewSessionOptions = {},
  ): Promise<PreviewSession> {
    const { encodePNG } = (await import(
      `${pocketjsRoot()}/tests/png.ts`
    )) as { encodePNG: EncodePng };

    const tree = await scratchTree(composition);
    const checkpointInterval = options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL;
    // The bytes this session is about to boot, read before it boots them.
    // `#rebuild` re-reads the bundle from disk, so this is what says whether
    // the file it re-reads is still the one this session has been serving.
    const bootArtefacts = await artefactDigest(composition);
    const source = await bootSource(composition, tree, checkpointInterval, options.checkpointMax);
    PreviewSession.openSessions += 1;
    return new PreviewSession(
      composition,
      source.source,
      tree,
      source.footage,
      encodePNG,
      checkpointInterval,
      options.checkpointMax,
      options.rebuildWhenMemoryMultiple ?? DEFAULT_REBUILD_MULTIPLE,
      bootArtefacts,
    );
  }

  /** Current wasm linear-memory size. Tests assert the ratchet does not run away. */
  get memoryBytes(): number {
    return this.#source.memoryBytes;
  }

  /** Serialize every seek/render. One wasm world; two overlapping seeks corrupt it. */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn, fn);
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async pngAt(at: number): Promise<FramePng> {
    return this.runExclusive(async () => {
      this.#assertFrame(at);
      await this.#seek(at);
      const rgba = new Uint8Array(this.#source.read());
      const hash = hashFrame(rgba);
      const bytes = new Uint8Array(
        this.#encodePng(rgba, this.meta.physicalWidth, this.meta.physicalHeight),
      );
      return {
        at,
        bytes,
        hash,
        width: this.meta.physicalWidth,
        height: this.meta.physicalHeight,
      };
    });
  }

  async layoutAt(at: number): Promise<LayoutAt> {
    return this.runExclusive(async () => {
      this.#assertFrame(at);
      await this.#seek(at);
      // `classify: false` — the overlay wants rects and `inPicture` and does
      // not read `visibility`, so it does not ask for it. Not a speed choice:
      // measured on `reel --at 300` the two are 1441 ms and 1453 ms, because
      // the extra read is a `draw()` with no rasterisation. Scope — a field
      // this path never validated should not appear in what it serves.
      const { nodes, notInPicture } = inspectLayout(this.#source.world, this.#tree, {
        keepAll: false,
        classify: false,
      });
      return {
        at,
        viewport: [this.meta.width, this.meta.height],
        notInPicture,
        nodes,
      };
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    PreviewSession.openSessions -= 1;
    await this.#queue;
    await this.#footage?.close();
    await this.#source.dispose();
  }

  async #seek(at: number): Promise<void> {
    if (this.#source.memoryBytes > this.#bootMemory * this.#rebuildMultiple) {
      await this.#rebuild();
    }
    try {
      await this.#source.seekFrame(at);
    } catch (e) {
      if (!(e instanceof SeekCapabilityError)) throw e;
      await this.#rebuild();
      await this.#source.seekFrame(at);
    }
    this.#footage?.present(at);
  }

  /**
   * Boot the world again from the artefacts this session was opened on.
   *
   * "The artefacts this session was opened on" is the point. This re-reads
   * the bundle and pak FROM DISK, and preview rebuilds into the same
   * directory — so after a reload that failed, or one that was still
   * building, the old session that was deliberately kept would silently come
   * back on the NEW bundle at whatever moment its memory ratchet happened to
   * trip. The picture changed underneath, nothing was reported, and the frame
   * digest the page had been serving stopped being reproducible from what the
   * session claimed to be showing.
   */
  async #rebuild(): Promise<void> {
    const now = await artefactDigest(this.composition);
    if (now !== this.#bootArtefacts) {
      throw new PreviewArtefactMovedError(
        `PocketJS Motion: the bundle this preview session booted has been ` +
          `rebuilt underneath it (${this.composition.dir}). Re-booting would ` +
          `change the picture without anything saying so, so it is refused. ` +
          `The host reopens the session on the new artefacts; reload the page.`,
      );
    }
    const next = await bootSource(
      this.composition,
      this.#tree,
      this.#checkpointInterval,
      this.#checkpointMax,
    );
    const prevSource = this.#source;
    const prevFootage = this.#footage;
    this.#source = next.source;
    this.#footage = next.footage;
    this.#bootMemory = next.source.memoryBytes;
    await prevFootage?.close();
    await prevSource.dispose();
  }

  #assertFrame(at: number): void {
    if (!Number.isInteger(at) || at < 0 || at >= this.meta.durationFrames) {
      throw new PreviewRangeError(
        `frame ${at} is out of range [0, ${this.meta.durationFrames})`,
      );
    }
  }
}

async function bootSource(
  composition: ResolvedComposition,
  tree: unknown,
  checkpointInterval: number,
  checkpointMax: number | undefined,
): Promise<{ source: WasmFrameSource; footage: FootageHandle | null }> {
  const source = await WasmFrameSource.create({
    compositionId: composition.compositionId,
    bundlePath: composition.bundlePath,
    pakPath: existsSync(composition.pakPath) ? composition.pakPath : undefined,
    width: composition.width,
    height: composition.height,
    hz: composition.fps,
    durationFrames: composition.durationFrames,
    renderScale: composition.supersample,
    checkpointInterval,
    checkpointMax,
    onRestore: undefined,
  });
  source.audit();
  let footage: FootageHandle | null = null;
  if (composition.sidecar.footage.length > 0) {
    await source.seekFrame(0);
    footage = await openFootage(composition, source.world, tree);
    // seekFrame(0) snapshots an empty tile grid. Restore to 0 would drop
    // UV and textures; present() skips tracks not in the target window, so
    // it cannot put them back. Recapture after the host bind.
    footage?.present(0);
    source.recapture();
  }
  return { source, footage };
}

export class PreviewRangeError extends Error {
  override readonly name = "PreviewRangeError";
}

/** The bundle or pak this session booted is not the one on disk any more. */
export class PreviewArtefactMovedError extends Error {
  override readonly name = "PreviewArtefactMovedError";
}

export function previewErrorMessage(e: unknown): string {
  return errMsg(e);
}
