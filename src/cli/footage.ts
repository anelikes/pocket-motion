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

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ingestFootage, type IngestManifest } from "../footage/ingest.ts";
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
 * The ingest's own arguments, hashed. A cache hit reuses the decoded tiles,
 * so the key is exactly what `ingestFootage` is called with and nothing else.
 *
 * Placement — `startFrame`, `endFrame`, `sourceFrame` — and the film's length
 * select frames out of a decode; they do not change its pixels. Keying on
 * them would re-decode a whole clip every time an author moved a cut, which
 * under a brief assembled from ten-second takes is most edits.
 *
 * `fit` is one of those arguments: cover / contain / stretch decode to
 * different bytes. The value here is the resolved one, including the
 * matched-aspect case (always `stretch`, today's filter), so the key is total.
 */
export interface FootageCacheKeyInput {
  readonly srcSha256: string;
  readonly tile: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly fit: FootageFit;
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
        frames: input.frames,
        fit: input.fit,
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

  const layers: LayerBind[] = [];
  const hashes: Record<string, string> = {};
  try {
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

      await requireFfmpeg();

      const srcSha256 = await sha256File(srcPath);
      const frames = await sourceFrameCount(srcPath, c.fps);
      const srcSize = await sourceDimensions(srcPath);
      // Before the ingest, not after: `ingestFootage` decodes the whole clip to
      // a raw file and a declared window that cannot fit is knowable from the
      // clip's duration alone. Cutting 10-second takes into a minute-long film
      // makes this the most common thing to get wrong, and paying a full ingest
      // to be told so is a slow way to learn it. The same is true of a source
      // whose aspect does not match the box — the squeeze is visible in the
      // frozen artifact, and the hash then treats it as an input.
      assertWindowFitsClip(track, frames);
      const fit = assertAspectFit(track, srcSize, size);
      const keyInput: FootageCacheKeyInput = {
        srcSha256,
        tile: track.tile,
        fps: c.fps,
        width: size.width,
        height: size.height,
        frames,
        fit,
      };
      const key = footageCacheKey(keyInput);
      const outDir = join(footageRoot, track.id);
      const cached = await readCache(outDir, key);
      let manifest: IngestManifest;
      let rawPath: string;
      if (cached) {
        manifest = cached.manifest;
        rawPath = cached.rawPath;
      } else {
        manifest = await ingestFootage({
          src: srcPath,
          outDir,
          width: size.width,
          height: size.height,
          fps: c.fps,
          frames,
          tile: track.tile,
          fit,
        });
        rawPath = join(outDir, "frames.rgba");
        await writeCache(outDir, key, keyInput);
      }

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

async function requireFfmpeg(): Promise<void> {
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code === 0) return;
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
