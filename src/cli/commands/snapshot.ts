/**
 * `snapshot <composition-dir> --out <dir> [--samples N | --at a,b,c]`
 * Question: what does this film look like at these frames, and where is
 * everything in them?
 *
 * `frame --at N` answers one frame and `layout --at N` answers where its boxes
 * are. Reading a film means doing both, several times, and putting the results
 * side by side — which was a script this repository used to carry and deleted,
 * because a script that lives outside the CLI has none of the CLI's guarantees:
 * it resolved its own paths, booted its own world, and nothing held its pixels
 * to the ones `frame` writes.
 *
 * THE ONE THING THAT MAKES THIS EVIDENCE
 *
 * The un-annotated PNG is BYTE-IDENTICAL to what `frame --at N` writes, and
 * `tests/snapshot.test.ts` asserts it rather than intending it. That is the
 * same claim `preview`'s `/frame` makes and it is made the same way: the frame
 * comes out of `WasmFrameSource` at the composition's own density, through
 * upstream's PNG writer, with no second execution anywhere.
 *
 * `--annotate` writes a SECOND file beside it. The overlay is drawn host-side
 * on a copy of the RGBA buffer (`src/render/annotate.ts`) and never through the
 * composition: a debug layer inside the guest would be geometry in the draw
 * list, would move the frame hash, and would make every reading a reading of a
 * different picture. Both files are always written when `--annotate` is set, so
 * the delivered pixels are on disk next to the drawing about them.
 *
 * `--zoom <debugName>` writes a crop around that node's box, padded, per frame.
 * It is for reading a caption's edges at 1920×1080 without opening an editor.
 *
 * WHAT IT CLAIMS: the frames it names, and nothing between them. `--samples N`
 * spaces them evenly with both ends included — the same grid `visibility`
 * sweeps, from the same function, so a position read off one carries to the
 * other.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { annotateFrame, cropFrame, type Surface } from "../../render/annotate.ts";
import { active } from "../../render/findings.ts";
import { pocketjsRoot } from "../../runtime/boot.ts";
import { WasmFrameSource } from "../../runtime/frame-source.ts";
import {
  UsageError,
  optionalString,
  parseArgs,
  requirePositional,
} from "../args.ts";
import { openFootage, scratchTree } from "../footage.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";
import { inspectLayout, type LayoutNode } from "./layout.ts";
import { DEFAULT_SAMPLES, parseSamples, sampleFrames } from "./visibility.ts";

export interface SnapshotOptions {
  readonly dir: string;
  readonly out: string;
  /** Explicit frames. Mutually exclusive with `samples`. */
  readonly at?: readonly number[];
  readonly samples?: number;
  readonly annotate: boolean;
  /** A node's `debugName`; a crop around its box is written per frame. */
  readonly zoom?: string;
  readonly flags: GlobalFlags;
}

/**
 * `--at a,b,c` as frame indices.
 *
 * Separate and exported for the same reason `parseSamples` is: a usage error
 * must not depend on an artifact being on disk. A bad list is wrong before
 * anything is resolved.
 */
export function parseFrameList(raw: string): number[] {
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new UsageError(`--at ${JSON.stringify(raw)} names no frames`);
  }
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new UsageError(
        `--at takes frame indices separated by commas; ${JSON.stringify(part)} is not one`,
      );
    }
    out.push(Number(part));
  }
  // Ascending and de-duplicated: the source is forward-only, so a list that
  // went backwards would be a rewind it cannot do, and asking for one frame
  // twice would write the same file twice.
  return [...new Set(out)].sort((a, b) => a - b);
}

/** `<out>/frame-000120.png` — zero-padded so a directory listing is in order. */
export function snapshotName(frame: number, suffix = ""): string {
  return `frame-${String(frame).padStart(6, "0")}${suffix}.png`;
}

/** A `debugName` as a path segment. Tile names carry `:` and `/`. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "node";
}

export async function run(options: SnapshotOptions): Promise<CommandResult> {
  if (options.at !== undefined && options.samples !== undefined) {
    throw new UsageError("--at and --samples name the same thing two ways; pass one");
  }

  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: true,
  });
  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: "invalid pocket-motion.json", diagnostics: resolved.diagnostics },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
    };
  }
  const c = resolved.value;

  const frames =
    options.at ?? sampleFrames(c.durationFrames, options.samples ?? DEFAULT_SAMPLES);
  for (const f of frames) {
    if (f >= c.durationFrames) {
      throw new UsageError(`--at ${f} is out of range [0, ${c.durationFrames})`);
    }
  }

  const outDir = resolve(options.out);
  mkdirSync(outDir, { recursive: true });

  let source: WasmFrameSource | undefined;
  let footage: Awaited<ReturnType<typeof openFootage>> = null;
  try {
    const { encodePNG } = (await import(`${pocketjsRoot()}/tools/png.ts`)) as {
      encodePNG: (rgba: Uint8Array, w: number, h: number) => Buffer;
    };

    source = await WasmFrameSource.create({
      compositionId: c.compositionId,
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      width: c.width,
      height: c.height,
      hz: c.fps,
      durationFrames: c.durationFrames,
      renderScale: c.supersample,
      buildCommand: c.buildCommand,
    });
    source.audit();

    // The tree comes from a THROWAWAY world (`scratchTree`), because `getTree`
    // is a round trip that consumes a frame turn — taken on this source it
    // would move the clock the snapshot is a picture of, and the bytes would
    // stop matching `frame --at N`. Node ids are deterministic given the same
    // bundle and pak, which is what makes the scratch tree valid here.
    const needTree = options.annotate || options.zoom !== undefined;
    const tree = needTree || c.sidecar.footage.length > 0 ? await scratchTree(c) : undefined;

    if (c.sidecar.footage.length > 0) {
      await source.seekFrame(0);
      footage = await openFootage(c, source.world, tree);
    }

    const physicalW = c.width * c.supersample;
    const physicalH = c.height * c.supersample;
    const written: Array<Record<string, unknown>> = [];

    for (const frame of frames) {
      await source.seekFrame(frame);
      footage?.present(frame);

      // The clean pixels first, and COPIED: `read()` hands back a view into
      // wasm memory, and everything below renders again.
      const clean = new Uint8Array(source.read());
      const cleanPath = join(outDir, snapshotName(frame));
      const cleanPng = encodePNG(clean, physicalW, physicalH);
      await Bun.write(cleanPath, cleanPng);
      const entry: Record<string, unknown> = {
        frame,
        path: cleanPath,
        bytes: cleanPng.byteLength,
      };

      let nodes: LayoutNode[] | undefined;
      if (needTree) {
        const inspected = inspectLayout(source.world, tree, {
          keepAll: false,
          classify: true,
          findings: {
            viewport: { x: 0, y: 0, w: c.width, h: c.height },
            allow: c.sidecar.layoutAllow,
            physicalWidth: physicalW,
            density: c.supersample,
          },
        });
        nodes = inspected.nodes;
        entry.findings = active(inspected.findings).length;
      }

      const surface: Surface = { pixels: clean, width: physicalW, height: physicalH };

      if (options.annotate && nodes) {
        const marked = annotateFrame({
          frame: surface,
          density: c.supersample,
          nodes,
        });
        const path = join(outDir, snapshotName(frame, ".annotated"));
        const png = encodePNG(marked.pixels, marked.width, marked.height);
        await Bun.write(path, png);
        entry.annotated = path;
      }

      if (options.zoom !== undefined && nodes) {
        const node = nodes.find((n) => n.name === options.zoom);
        if (node === undefined) {
          throw new UsageError(
            `--zoom ${JSON.stringify(options.zoom)} names no node with that debugName at frame ` +
              `${frame}. Named nodes here: ${
                nodes
                  .map((n) => n.name)
                  .filter(Boolean)
                  .slice(0, 12)
                  .join(", ") || "(none)"
              }`,
          );
        }
        const pad = 24;
        const crop = cropFrame(
          surface,
          (node.x - pad) * c.supersample,
          (node.y - pad) * c.supersample,
          (node.w + pad * 2) * c.supersample,
          (node.h + pad * 2) * c.supersample,
        );
        const path = join(outDir, snapshotName(frame, `.zoom-${safeName(options.zoom)}`));
        await Bun.write(path, encodePNG(crop.pixels, crop.width, crop.height));
        entry.zoom = path;
        entry.zoomBox = [node.x, node.y, node.w, node.h];
      }

      written.push(entry);
    }

    return {
      exitCode: EXIT_OK,
      json: {
        ok: true,
        outDir,
        frames,
        width: physicalW,
        height: physicalH,
        annotated: options.annotate,
        ...(options.zoom === undefined ? {} : { zoom: options.zoom }),
        files: written,
      },
      stdoutLines: [
        `snapshot — ${frames.length} frame(s) of ${c.durationFrames} into ${outDir}`,
        ...written.map(
          (e) =>
            `  ${snapshotName(e.frame as number).padEnd(20)} ${physicalW}×${physicalH}` +
            (e.findings === undefined ? "" : `  ${e.findings} finding(s)`) +
            (e.annotated === undefined ? "" : "  +annotated") +
            (e.zoom === undefined ? "" : "  +zoom"),
        ),
        "",
        "The un-annotated PNG is the same bytes `frame --at N` writes. The overlay",
        "is drawn host-side on a copy and never through the composition.",
      ],
    };
  } catch (e) {
    if (e instanceof UsageError) throw e;
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`snapshot failed — ${message}`],
    };
  } finally {
    await footage?.close();
    await source?.dispose();
  }
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["snapshot", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const out = optionalString(parsed.flags, "out");
  if (out === undefined) {
    throw new UsageError("snapshot needs --out <dir>");
  }
  const at = optionalString(parsed.flags, "at");
  const samples = parseSamples(parsed.flags.samples);
  return run({
    dir,
    out,
    ...(at === undefined ? {} : { at: parseFrameList(at) }),
    ...(samples === undefined ? {} : { samples }),
    annotate: parsed.flags.annotate === true,
    ...(parsed.flags.zoom === undefined
      ? {}
      : { zoom: optionalString(parsed.flags, "zoom")! }),
    flags: parsed.global,
  });
}
