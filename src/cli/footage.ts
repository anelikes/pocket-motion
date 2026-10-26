/**
 * Bind a sidecar's `footage` array to the world being driven.
 *
 * The layer is host-owned: the guest declares placeholder Image tiles at
 * mount and never touches them. This module is the missing CLI half —
 * ingest on demand, then `present(n)` every frame — so a composition that
 * declares footage cannot produce a digest without it.
 *
 * `getTree()` is a guest round trip that consumes one frame turn
 * (`boot.ts`). Callers must not take the tree from the world they are
 * about to render: that would shift every baked keyframe by one frame
 * against `WasmFrameSource.seekFrame`, which is exactly the class of
 * error this wiring exists to close. `scratchTree` boots a throwaway
 * world for the tree; node ids are deterministic given the same
 * bundle+pak, so the scratch tree is valid against the main world's ops.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ffmpegVersionText,
  ingestFootage,
  ingestRecipe,
  unionSpans,
  type IngestManifest,
  type SourceSpan,
} from "../footage/ingest.ts";
import { FootageLayer } from "../footage/layer.ts";
import { gridOf, tileNamePrefix } from "../footage/tiling.ts";
import type { FootageFit, FootageTrack } from "../manifest/sidecar.ts";
import { hardenedBootWorld, type BootedWorld } from "../runtime/boot.ts";
import { repoRootOf, type ResolvedComposition } from "./resolve.ts";

export interface FootageHandle {
  present(frame: number): void;
  close(): Promise<void>;
  /** Frozen-artifact sha256, by track id — the footage half of input identity. */
  readonly hashes: Readonly<Record<string, string>>;
}

export interface OpenFootageOptions {
  /**
   * Run host-side ops inside this so the mount-only oracle excludes them.
   * Required for `check`; identity is fine for trace/frame/render.
   */
  readonly asHost?: <T>(fn: () => T) => T;
}

/**
 * Everything a decode's bytes depend on, hashed. A cache hit hands back an
 * artifact a miss would have decoded, so the key is what a miss would run,
 * on what, with what — and nothing that only says where the result goes.
 *
 * `spans` is the union of the source frames the tracks reading this artifact
 * can show (`reachableSpan`), so a cut that changes which frames are shown
 * re-decodes, and one that only moves them in the film — the same
 * `sourceFrame` and length at another `startFrame` — does not. It used to be
 * the whole clip, keyed on the clip's length and on nothing about placement:
 * a whole decode never had to change when a cut moved, and it cost a
 * 179-frame artifact for a 101-frame window.
 *
 * `recipe` is the ingest argv with the source path taken out
 * (`ingestRecipe`), built by the function that builds the argv the decode
 * runs. Before it was here, the key held what the sidecar decides and nothing
 * the ingest code decides: an edit to the `-vf` string or a scaler flag left
 * every warm `dist` serving the artifact the previous recipe made, and CI —
 * which starts with no `dist` — could not notice. `width`, `height`, `fps`
 * and `fit` are in the argv as well and are kept as fields so `cache.json`
 * reads without decoding a filter string.
 *
 * `ffmpeg` is a digest of all of `ffmpeg -version` (`ffmpegVersionText`). A
 * miss runs whatever ffmpeg is installed, and the bytes it writes are that
 * build's: the H.264 decode to YUV is bit-exact by specification, but the
 * conversion to RGBA, the lanczos resample and the `-r` rate conversion are
 * library and fftools code, and `accurate_rnd`/`bitexact` pin how one build
 * rounds across architectures, not what another release computes. Without
 * it, upgrading ffmpeg under a warm `dist` would leave the old build's bytes
 * in front of every footage frame, and a fresh checkout on the same machine
 * would decode something else from the same revision. The cost is one
 * re-decode per footage artifact after an upgrade, including one that moved
 * nothing. `tile` does not reach the bytes; it is here because the manifest
 * written beside them carries the grid.
 */
export interface FootageCacheKeyInput {
  readonly srcSha256: string;
  readonly tile: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly fit: FootageFit;
  readonly spans: readonly SourceSpan[];
  readonly recipe: readonly string[];
  readonly ffmpeg: string;
}

interface TreeNode {
  readonly i?: number;
  readonly n?: string;
  readonly c?: string;
  readonly k?: readonly TreeNode[];
}

interface CacheRecord extends FootageCacheKeyInput {
  readonly key: string;
}

export function footageCacheKey(input: FootageCacheKeyInput): string {
  // Key order is fixed so the same inputs always hash the same.
  return new Bun.CryptoHasher("sha256")
    .update(
      JSON.stringify({
        srcSha256: input.srcSha256,
        tile: input.tile,
        fps: input.fps,
        width: input.width,
        height: input.height,
        fit: input.fit,
        spans: input.spans,
        recipe: input.recipe,
        ffmpeg: input.ffmpeg,
      }),
    )
    .digest("hex");
}

/**
 * Mount a throwaway world and read its tree. The world is discarded: this
 * is the only safe way to resolve `debugName → node id` without advancing
 * the world that will produce frames.
 */
export async function scratchTree(c: ResolvedComposition): Promise<unknown> {
  const world = await hardenedBootWorld({
    bundlePath: c.bundlePath,
    pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
    width: c.width,
    height: c.height,
    hz: c.fps,
    renderScale: c.supersample,
    // The tree only; this world renders nothing.
    shutter: null,
    buildCommand: c.buildCommand,
  });
  return world.getTree();
}

export async function openFootage(
  c: ResolvedComposition,
  world: BootedWorld,
  tree: unknown,
  options: OpenFootageOptions = {},
): Promise<FootageHandle | null> {
  const tracks = c.sidecar.footage;
  if (tracks.length === 0) return null;

  const names = collectDebugNames(tree);
  const repoRoot = repoRootOf(c.dir);
  const footageRoot = join(dirname(c.bundlePath), "footage");

  // Everything the tree can refuse, for every track, before anything costs a
  // process: an author fixing a name should not wait on ffprobe to hear it.
  const drawn: { track: FootageTrack; srcPath: string; size: { width: number; height: number } }[] = [];
  for (const track of tracks) {
    const srcPath = resolve(repoRoot, track.src);
    if (!existsSync(srcPath)) {
      throw new Error(
        `PocketJS Motion: footage track ${JSON.stringify(track.id)} source is missing: ${srcPath}\n` +
          `The sidecar names this file as ${JSON.stringify(track.src)}.\n` +
          "Place the clip at that path (fetched assets: `bun scripts/assets.ts`) and retry.",
      );
    }

    const under = names.filter((n) => n === track.nodePrefix || n.startsWith(`${track.nodePrefix}/`));
    if (under.length === 0) {
      const shown = names.slice(0, 20).map((n) => JSON.stringify(n)).join(", ");
      const extra = names.length > 20 ? ` (+${names.length - 20} more)` : "";
      throw new Error(
        `PocketJS Motion: footage track ${JSON.stringify(track.id)} declared ` +
          `nodePrefix ${JSON.stringify(track.nodePrefix)} but the composition tree ` +
          `has no nodes under that prefix.\n` +
          `Looked for ${JSON.stringify(track.nodePrefix)} and ${JSON.stringify(`${tileNamePrefix(track.nodePrefix)}…`)}.\n` +
          `Found: ${names.length > 0 ? shown + extra : "(no debugNames)"}.\n` +
          "The tile nodes come from `tileNodes` in `src/footage/declare.ts`, which a " +
          "composition's gen.ts calls with the picture's drawn size; `footageTrack` " +
          "beside it writes this sidecar entry from the same numbers, so the grid and " +
          "the nodes cannot be edited apart. Emitting the names by hand means keeping " +
          `${track.grid[0]}x${track.grid[1]} names, this sidecar's grid and each tile's ` +
          "drawn size in agreement yourself, and the drawn size IS the ingested size.",
      );
    }

    const size = pictureSizeFromTree(tree, track);
    if (!size) {
      throw new Error(
        `PocketJS Motion: footage track ${JSON.stringify(track.id)} has tile nodes ` +
          `under ${JSON.stringify(track.nodePrefix)} but none carry w-[Npx] h-[Npx], ` +
          `so the ingest size cannot be read from the tree.\n` +
          "Each tile Image needs an explicit pixel size (drawn size equals ingested size).",
      );
    }

    const derived = gridOf(size.width, size.height, track.tile);
    if (derived[0] !== track.grid[0] || derived[1] !== track.grid[1]) {
      throw new Error(
        `PocketJS Motion: footage track ${JSON.stringify(track.id)} sidecar grid ` +
          `[${track.grid[0]}, ${track.grid[1]}] does not match its tile nodes ` +
          `(${size.width}×${size.height} at tile ${track.tile} → [${derived[0]}, ${derived[1]}]).`,
      );
    }
    drawn.push({ track, srcPath, size });
  }

  const ffmpeg = await requireFfmpeg();

  // Tracks that would decode to the same bytes share one artifact holding the
  // union of what each can show. `footage-tracks` maps one clip twice, at
  // [0, 60) and [89, 179): one decode of 150 frames rather than two of 179.
  const groups = new Map<string, Group>();
  const groupOf = new Map<string, Group>();
  for (const { track, srcPath, size } of drawn) {
    const srcSha256 = await sha256File(srcPath);
    const frames = await sourceFrameCount(srcPath, c.fps);
    const srcSize = await sourceDimensions(srcPath);
    // Before the ingest, not after: a declared window that cannot fit is
    // knowable from the clip's duration alone. Cutting 10-second takes into a
    // minute-long film makes this the most common thing to get wrong, and
    // paying an ingest to be told so is a slow way to learn it. The same is
    // true of a source whose aspect does not match the box — the squeeze is
    // visible in the frozen artifact, and the hash then treats it as an input.
    assertWindowFitsClip(track, frames);
    const fit = assertAspectFit(track, srcSize, size);
    const id = JSON.stringify([srcSha256, size.width, size.height, fit, track.tile]);
    let group = groups.get(id);
    if (!group) {
      // Under the first track that reads it, so the directory is stable while
      // the sidecar's order is; a re-decode replaces it in place.
      group = { dir: join(footageRoot, track.id), srcPath, srcSha256, size, fit, tile: track.tile, spans: [] };
      groups.set(id, group);
    }
    group.spans.push(reachableSpan(track, c.sidecar.durationFrames));
    groupOf.set(track.id, group);
  }

  pruneUnread(footageRoot, new Set([...groups.values()].map((g) => g.dir)));

  const artifacts = new Map<Group, { manifest: IngestManifest; rawPath: string }>();
  for (const group of groups.values()) {
    const spans = unionSpans(group.spans);
    const recipe = { width: group.size.width, height: group.size.height, fps: c.fps, spans, fit: group.fit };
    const keyInput: FootageCacheKeyInput = {
      srcSha256: group.srcSha256,
      tile: group.tile,
      fps: c.fps,
      width: group.size.width,
      height: group.size.height,
      fit: group.fit,
      spans,
      recipe: ingestRecipe(recipe),
      ffmpeg,
    };
    const key = footageCacheKey(keyInput);
    const cached = await readCache(group.dir, key);
    if (cached) {
      artifacts.set(group, cached);
      continue;
    }
    const manifest = await ingestFootage({ ...recipe, src: group.srcPath, outDir: group.dir, tile: group.tile });
    await writeCache(group.dir, key, keyInput);
    artifacts.set(group, { manifest, rawPath: join(group.dir, "frames.rgba") });
  }

  const layers: LayerBind[] = [];
  const hashes: Record<string, string> = {};
  try {
    for (const { track } of drawn) {
      const { manifest, rawPath } = artifacts.get(groupOf.get(track.id)!)!;
      const layer = await FootageLayer.create({
        manifest,
        rawPath,
        nodePrefix: track.nodePrefix,
        tree,
        ops: world.ops as never,
        asHost: options.asHost,
      });
      hashes[track.id] = manifest.sha256;
      layers.push({
        layer,
        startFrame: track.startFrame,
        endFrame: track.endFrame,
        sourceFrame: track.sourceFrame,
      });
    }
  } catch (e) {
    for (const bind of layers) bind.layer.close();
    throw e;
  }

  return {
    present(frame: number): void {
      for (const bind of layers) {
        const src = clipFrameAt(bind, frame);
        if (src === undefined) continue;
        bind.layer.present(src);
      }
    },
    async close(): Promise<void> {
      for (const bind of layers) bind.layer.close();
    },
    hashes,
  };
}

/**
 * Remove artifact directories beside the bundle that no track of this sidecar
 * reads: a renamed track's, and one a shared artifact replaced. A tree built
 * before spans holds `footage-tracks`' whole 179-frame `wide-return` decode,
 * which `wide-open`'s artifact now serves; left alone it would sit in `dist`
 * for good and the ledger's end-of-run count would report a sixth file on
 * every warm tree. Only a directory holding what an ingest writes is touched.
 * A process still reading one keeps its open descriptor, so an unlink under
 * it changes nothing it presents.
 */
function pruneUnread(footageRoot: string, keep: ReadonlySet<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(footageRoot);
  } catch {
    return;
  }
  for (const name of entries) {
    const dir = join(footageRoot, name);
    if (keep.has(dir)) continue;
    if (!existsSync(join(dir, "cache.json")) && !existsSync(join(dir, "manifest.json"))) continue;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Tracks whose decodes are the same bytes, and the spans each can show. */
interface Group {
  readonly dir: string;
  readonly srcPath: string;
  readonly srcSha256: string;
  readonly size: { readonly width: number; readonly height: number };
  readonly fit: FootageFit;
  readonly tile: number;
  readonly spans: SourceSpan[];
}

interface LayerBind {
  readonly layer: FootageLayer;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly sourceFrame: number;
}

/**
 * Source frame shown at `compositionFrame`, or `undefined` outside
 * `[startFrame, endFrame)`. The mapping is
 * `sourceFrame + (compositionFrame - startFrame)`.
 */
export function clipFrameAt(
  track: Pick<FootageTrack, "startFrame" | "endFrame" | "sourceFrame">,
  compositionFrame: number,
): number | undefined {
  if (compositionFrame < track.startFrame || compositionFrame >= track.endFrame) {
    return undefined;
  }
  return track.sourceFrame + (compositionFrame - track.startFrame);
}

/**
 * The source frames a track can show: `clipFrameAt` over every composition
 * frame of its window, which the film's length ends. The parser already
 * refuses an `endFrame` past `durationFrames`; the clip here is the same rule
 * stated where the span is derived, so a span never depends on that refusal.
 *
 * `durationFrames` is the sidecar's, not a `--frames` given to one command: a
 * `check` over 30 frames and a `trace` over the film read the same artifact,
 * rather than each re-decoding the span the other just wrote.
 */
export function reachableSpan(
  track: Pick<FootageTrack, "startFrame" | "endFrame" | "sourceFrame">,
  durationFrames: number,
): SourceSpan {
  const shown = Math.max(0, Math.min(track.endFrame, durationFrames) - track.startFrame);
  return [track.sourceFrame, track.sourceFrame + shown];
}

/**
 * The window must fit the frozen clip. Asking for a source frame the
 * ingest does not have used to clamp to the last picture; that is the
 * silent wrong result this check exists to refuse.
 */
export function assertWindowFitsClip(
  track: Pick<FootageTrack, "id" | "startFrame" | "endFrame" | "sourceFrame">,
  clipFrames: number,
): void {
  const want = track.endFrame - track.startFrame;
  if (track.sourceFrame + want <= clipFrames) return;
  const maxEnd = track.startFrame + (clipFrames - track.sourceFrame);
  throw new Error(
    `PocketJS Motion: footage track ${JSON.stringify(track.id)} asks for ${want} frames ` +
      `but the clip has ${clipFrames}.\n` +
      `The window is sourceFrame ${track.sourceFrame} + ${want} frames ` +
      `(composition [${track.startFrame}, ${track.endFrame})).\n` +
      `The largest endFrame that would fit is ${maxEnd}.`,
  );
}

/**
 * How far a bare `scale=dstW:dstH` would displace the far edge, in
 * destination pixels.
 *
 * Integer inequality is not the test. Two sizes that differ by a pixel
 * can still agree to well under a destination pixel once they are
 * ratios, and that is rounding, not distortion.
 *
 *   const factor = (srcW / srcH) / (dstW / dstH);  // what a bare scale= would apply
 *   const drift = Math.abs(1 - factor) * dstW;     // how far it moves the far edge, in dst px
 *   // drift < 1  → below the rounding floor, treat as exact, keep today's filter
 *   // drift >= 1 → distortion; require an explicit fit
 */
export function aspectDrift(srcW: number, srcH: number, dstW: number, dstH: number): number {
  const factor = (srcW / srcH) / (dstW / dstH);
  return Math.abs(1 - factor) * dstW;
}

/**
 * The fit `ingestFootage` will be called with. A match resolves to
 * `stretch` — today's filter — even if the sidecar named something
 * else, so a matching clip cannot pick up a different swscale path.
 * A mismatch without `fit` is the silent stretch this exists to refuse.
 */
export function assertAspectFit(
  track: Pick<FootageTrack, "id" | "fit">,
  src: { width: number; height: number },
  dst: { width: number; height: number },
): FootageFit {
  const drift = aspectDrift(src.width, src.height, dst.width, dst.height);
  if (drift < 1) return "stretch";
  if (track.fit !== undefined) return track.fit;
  const moved = drift < 10 ? `${drift.toFixed(2)} px` : `${Math.round(drift)} px`;
  throw new Error(
    `PocketJS Motion: footage track ${JSON.stringify(track.id)} source is ` +
      `${src.width}×${src.height}, drawn size is ${dst.width}×${dst.height}.\n` +
      `A bare scale would squeeze the picture, moving the far edge by ${moved} ` +
      `— that is a distortion, not rounding, and there is no default.\n` +
      "Set `fit` on this track:\n" +
      "  cover    — fill the box, crop the overflow\n" +
      "  contain  — fit inside the box, pad the remainder\n" +
      "  stretch  — anamorphic squeeze; the current behaviour, now stated",
  );
}

export function collectDebugNames(tree: unknown): string[] {
  const out: string[] = [];
  walk(tree as TreeNode | null, (node) => {
    if (typeof node.n === "string") out.push(node.n);
  });
  return out;
}

/**
 * Picture size as the union of tile interiors. Drawn size equals ingested
 * size (both reference drivers, `tiling.ts`); the tree is the authority
 * because the sidecar stores only the grid, not the pixel extent.
 */
export function pictureSizeFromTree(
  tree: unknown,
  track: Pick<FootageTrack, "nodePrefix" | "grid">,
): { width: number; height: number } | null {
  const [cols, rows] = track.grid;
  let maxR = 0;
  let maxB = 0;
  let found = 0;
  walk(tree as TreeNode | null, (node) => {
    if (typeof node.n !== "string" || !node.n.startsWith(tileNamePrefix(track.nodePrefix))) return;
    const cls = node.c ?? "";
    const x = classPx(cls, "left") ?? 0;
    const y = classPx(cls, "top") ?? 0;
    const w = classPx(cls, "w");
    const h = classPx(cls, "h");
    if (w === undefined || h === undefined) return;
    found += 1;
    if (x + w > maxR) maxR = x + w;
    if (y + h > maxB) maxB = y + h;
  });
  if (found === 0 || maxR <= 0 || maxB <= 0) return null;
  if (found < cols * rows) {
    // Partial grids still have a well-defined union; the layer will reject
    // missing tile names on its own with a more specific list.
  }
  return { width: maxR, height: maxB };
}

function classPx(cls: string, prop: string): number | undefined {
  const m = new RegExp(`(?:^|\\s)${prop}-\\[(\\d+)px\\](?:\\s|$)`).exec(cls);
  return m ? Number(m[1]) : undefined;
}

function walk(node: TreeNode | null | undefined, visit: (n: TreeNode) => void): void {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.k ?? []) walk(child, visit);
}

/** The `ffmpeg` half of the cache key: a digest of all of `ffmpeg -version`. */
async function requireFfmpeg(): Promise<string> {
  try {
    const text = await ffmpegVersionText();
    return new Bun.CryptoHasher("sha256").update(text).digest("hex");
  } catch {
    // spawn throws when the binary is not on PATH
  }
  throw new Error(
    "PocketJS Motion: ffmpeg is not on PATH; footage cannot be ingested.\n" +
      "Install it (macOS: brew install ffmpeg) and retry.",
  );
}

async function sha256File(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex");
}

async function sourceDimensions(src: string): Promise<{ width: number; height: number }> {
  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      src,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = (await new Response(proc.stdout).text()).trim();
  const err = (await new Response(proc.stderr).text()).trim();
  if ((await proc.exited) !== 0 || text.length === 0) {
    throw new Error(
      `PocketJS Motion: ffprobe failed on ${src}${err ? `\n${err}` : ""}\n` +
        "Install ffmpeg (macOS: brew install ffmpeg) and retry.",
    );
  }
  const [wRaw, hRaw] = text.split(/[x,]/);
  const width = Number(wRaw);
  const height = Number(hRaw);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(
      `PocketJS Motion: ffprobe returned a non-size for ${src}: ${JSON.stringify(text)}`,
    );
  }
  return { width, height };
}

async function sourceFrameCount(src: string, fps: number): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = (await new Response(proc.stdout).text()).trim();
  const err = (await new Response(proc.stderr).text()).trim();
  if ((await proc.exited) !== 0 || text.length === 0) {
    throw new Error(
      `PocketJS Motion: ffprobe failed on ${src}${err ? `\n${err}` : ""}\n` +
        "Install ffmpeg (macOS: brew install ffmpeg) and retry.",
    );
  }
  const seconds = Number(text);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`PocketJS Motion: ffprobe returned a non-duration for ${src}: ${JSON.stringify(text)}`);
  }
  // Floor, then drop the last frame: resampled 24→30 fps lengths are
  // *just* over an integer (10.041667s × 30 = 301.25), and requesting
  // that extra frame is a different last picture than the reference
  // drivers, who both ingested with a one-frame margin.
  return Math.max(1, Math.floor(seconds * fps) - 1);
}

async function readCache(
  outDir: string,
  key: string,
): Promise<{ manifest: IngestManifest; rawPath: string } | null> {
  const recordPath = join(outDir, "cache.json");
  const manifestPath = join(outDir, "manifest.json");
  const rawPath = join(outDir, "frames.rgba");
  if (!existsSync(recordPath) || !existsSync(manifestPath) || !existsSync(rawPath)) return null;
  try {
    const record = (await Bun.file(recordPath).json()) as CacheRecord;
    if (record.key !== key) return null;
    const manifest = (await Bun.file(manifestPath).json()) as IngestManifest;
    if (Bun.file(rawPath).size !== manifest.bytes) return null;
    return { manifest, rawPath };
  } catch {
    return null;
  }
}

async function writeCache(outDir: string, key: string, input: FootageCacheKeyInput): Promise<void> {
  const record: CacheRecord = { key, ...input };
  await Bun.write(join(outDir, "cache.json"), JSON.stringify(record, null, 2));
}
