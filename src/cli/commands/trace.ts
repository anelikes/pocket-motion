/**
 * `trace <composition-dir>`
 * Question: what is the frame-hash sequence + digest?
 *
 * `--json` is `{ frames, digest, identity }`. `digest` is the frame
 * sequence — the field the ledger and `diff` compare. `identity` is the
 * input hash (`src/render/identity.ts`).
 */

import { existsSync } from "node:fs";
import {
  computeIdentity,
  recordedToolchain,
  sidecarCanonicalOf,
} from "../../render/identity.ts";
import { render as renderComposition } from "../../render/render.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { openFootage, scratchTree, type FootageHandle } from "../footage.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
  type TraceJson,
} from "../types.ts";

export interface TraceOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
}

export async function run(options: TraceOptions): Promise<CommandResult> {
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: true,
  });
  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { frames: [], digest: "", error: "invalid pocket-motion.json" },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
    };
  }

  const c = resolved.value;

  const bound: { footage: FootageHandle | null } = { footage: null };
  try {
    const declared = c.sidecar.footage.length > 0;
    const tree = declared ? await scratchTree(c) : null;
    const result = await renderComposition({
      compositionId: c.compositionId,
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      width: c.width,
      height: c.height,
      hz: c.fps,
      durationFrames: c.durationFrames,
      renderScale: c.supersample,
      buildCommand: c.buildCommand,
      hashAlgorithm: options.flags.hash,
      // no outputPath — hash-only path
      setup: declared
        ? async (source) => {
            // Frame 0 IS the mount call. Nodes exist only after it, which is
            // why the layer is bound here rather than at boot.
            await source.seekFrame(0);
            bound.footage = await openFootage(c, source.world, tree);
          }
        : undefined,
      onFrameBoundary: (frame) => bound.footage?.present(frame),
    });

    const identity = await computeIdentity({
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      sidecarCanonical: sidecarCanonicalOf(c.sidecar),
      fontPaths: c.fontPaths
        ? [c.fontPaths.regular, c.fontPaths.bold]
        : undefined,
      footageHashes: bound.footage?.hashes,
      width: c.width,
      height: c.height,
      fps: c.fps,
      durationFrames: c.durationFrames,
      renderScale: c.supersample,
      rasterDensity: 1,
      // `resolveComposition` read this off `build.json` and refused the
      // bundle if there was none, so the toolchain here is the one that
      // produced the artifact rather than the one running the trace.
      buildRecord: c.buildRecord ?? (await recordedToolchain(c.bundlePath)).buildRecord,
    });

    const trace: TraceJson = {
      frames: result.frameHashes,
      digest: result.digest,
      identity,
    };

    return {
      exitCode: EXIT_OK,
      json: trace,
      stdoutLines: [
        `trace ok — ${result.frames} frames`,
        `digest ${result.digest}`,
        `identity ${identity.digest}`,
        ...result.frameHashes.map((h, i) => `  [${i}] ${h}`),
      ],
    };
  } catch (e) {
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { frames: [] as string[], digest: "", error: message },
      stderrLines: [message],
      stdoutLines: [`trace failed — ${message}`],
    };
  } finally {
    await bound.footage?.close();
  }
}

export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["trace", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  return run({ dir, flags: parsed.global });
}
