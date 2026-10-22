/**
 * `frame <composition-dir> --at N --out <file.png>`
 * Question: what does frame N look like as a PNG?
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describeShutter, pocketjsRoot } from "../../runtime/boot.ts";
import { WasmFrameSource } from "../../runtime/frame-source.ts";
import {
  UsageError,
  optionalString,
  parseArgs,
  requireInt,
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

export interface FrameOptions {
  readonly dir: string;
  readonly at: number;
  readonly out: string;
  readonly flags: GlobalFlags;
}

export async function run(options: FrameOptions): Promise<CommandResult> {
  if (!Number.isInteger(options.at) || options.at < 0) {
    throw new UsageError(`--at must be a non-negative integer; got ${options.at}`);
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
      json: { ok: false, error: "invalid pocket-motion.json" },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
    };
  }

  const c = resolved.value;
  if (options.at >= c.durationFrames) {
    throw new UsageError(
      `--at ${options.at} is out of range [0, ${c.durationFrames})`,
    );
  }

  const outPath = resolve(options.out);
  let source: WasmFrameSource | undefined;

  try {
    source = await WasmFrameSource.create({
      compositionId: c.compositionId,
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      width: c.width,
      height: c.height,
      hz: c.fps,
      durationFrames: c.durationFrames,
      renderScale: c.supersample,
      shutter: c.shutter,
      buildCommand: c.buildCommand,
    });

    source.audit();
    let footage = null;
    if (c.sidecar.footage.length > 0) {
      const tree = await scratchTree(c);
      await source.seekFrame(0);
      footage = await openFootage(c, source.world, tree);
    }
    await source.seekFrame(options.at);
    footage?.present(options.at);
    const rgba = source.read();
    await footage?.close();

    const { encodePNG } = (await import(
      `${pocketjsRoot()}/tools/png.ts`
    )) as {
      encodePNG: (rgba: Uint8Array, w: number, h: number) => Buffer;
    };

    const physicalW = c.width * c.supersample;
    const physicalH = c.height * c.supersample;
    const png = encodePNG(rgba, physicalW, physicalH);
    await Bun.write(outPath, png);

    const payload = {
      ok: true,
      frame: options.at,
      outputPath: outPath,
      width: physicalW,
      height: physicalH,
      bytes: png.byteLength,
      ...(c.shutter ? { shutter: c.shutter } : {}),
    };

    return {
      exitCode: EXIT_OK,
      json: payload,
      stdoutLines: [
        `frame ${options.at} → ${outPath} (${physicalW}×${physicalH}, ${png.byteLength} bytes)`,
        ...(c.shutter ? [`shutter ${describeShutter(c.shutter)} — the PNG is the frame's exposure`] : []),
      ],
    };
  } catch (e) {
    // UsageError from seek range etc. should propagate as exit 2
    if (e instanceof UsageError) throw e;
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`frame failed — ${message}`],
    };
  } finally {
    await source?.dispose();
  }
}

export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["frame", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const at = requireInt(parsed.flags, "at");
  const out = optionalString(parsed.flags, "out");
  if (out === undefined) {
    throw new UsageError("flag --out is required (path to .png)");
  }
  return run({ dir, at, out, flags: parsed.global });
}
