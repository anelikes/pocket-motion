/**
 * `render <composition-dir> --out <file.mp4>`
 * Question: produce the video.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { render as renderComposition } from "../../render/render.ts";
import {
  OUTPUT_FORMATS,
  formatCarriesAlpha,
  formatExtension,
  isOutputFormat,
  type OutputFormat,
} from "../../render/encode.ts";
import type { SidecarShutter } from "../../manifest/sidecar.ts";
import { describeShutter, pocketjsRoot } from "../../runtime/boot.ts";
import { framesToMs, mixGraph, soundDeclared } from "../../sound/mix.ts";
import { muxSound } from "../../sound/mux.ts";
import { probeSoundDurations, resolveSound } from "../../sound/resolve.ts";
import {
  UsageError,
  optionalString,
  parseArgs,
  refuseJobPatches,
  requirePositional,
} from "../args.ts";
import { openFootage, scratchTree, type FootageHandle } from "../footage.ts";
import { parseSpec } from "../../manifest/spec.ts";
import { runBuild } from "../build.ts";
import {
  errMsg,
  repoRootOf,
  resolveComposition,
} from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

export interface RenderOptions {
  readonly dir: string;
  readonly out: string;
  readonly flags: GlobalFlags;
  /** Job spec. When set, the composition's generator runs, then a build, then encode. */
  readonly spec?: string;
  /** Container and codec. Default `mp4`. */
  readonly format?: OutputFormat;
  /** Ask the codec for an alpha channel. Refused for `mp4`. */
  readonly alpha?: boolean;
}

/**
 * Which format this invocation means, refusing every way the two ways of
 * saying it can disagree.
 *
 * `--format` is the declaration and the extension is a second statement of
 * the same fact, so they are checked against each other rather than one
 * silently winning: an `.webm` file holding H.264 plays, reports a sensible
 * duration, and is wrong — the shape this project refuses everywhere else.
 * With no `--format` the extension decides, because a reader who typed
 * `--out cut.mov` has already said which one they meant.
 */
export function resolveFormat(
  requested: string | undefined,
  out: string,
): OutputFormat {
  if (requested !== undefined && !isOutputFormat(requested)) {
    throw new UsageError(
      `--format must be one of ${OUTPUT_FORMATS.join(", ")}; got ${JSON.stringify(requested)}`,
    );
  }
  const ext = extname(out).toLowerCase();
  const fromExt = ext.length > 1 && isOutputFormat(ext.slice(1)) ? (ext.slice(1) as OutputFormat) : undefined;

  if (requested === undefined) return fromExt ?? "mp4";
  const want = formatExtension(requested);
  if (want === null) {
    // png-seq writes a DIRECTORY of frames. An extension on it means the
    // reader is expecting one file and would find a directory named `out.mp4`
    // holding PNGs.
    if (ext.length > 0) {
      throw new UsageError(
        `--format png-seq writes a directory of frames, so --out must name a directory; ` +
          `${JSON.stringify(out)} has an extension.`,
      );
    }
    return requested;
  }
  if (ext.length > 0 && ext !== want) {
    throw new UsageError(
      `--format ${requested} writes ${want}, but --out names ${JSON.stringify(ext)}. ` +
        "A container and an extension that disagree is a file that plays and is not what " +
        "it says it is; rename the output or change the format.",
    );
  }
  return requested;
}

/** `--alpha` against a codec that has no alpha plane is refused, never dropped. */
export function assertAlphaSupported(format: OutputFormat, alpha: boolean): void {
  if (!alpha || formatCarriesAlpha(format)) return;
  throw new UsageError(
    "--alpha has no meaning for mp4: this project encodes H.264 as yuv420p, which has no " +
      "alpha plane, and accepting the flag would drop the channel without saying so. " +
      "Use --format mov (ProRes 4444), --format webm (VP9 yuva420p), or --format png-seq.",
  );
}

/**
 * What the encode leg is told to scale to: the DECLARED viewport whenever the
 * render is supersampled, nothing otherwise.
 *
 * A rule with no test is a rule that comes back, and this one was already
 * missing once — `render()` accepted `scaleTo` and `encode.ts` built the
 * lanczos filter for it, but no command ever passed it, so a supersample-2
 * render shipped 3840×2160 under a sidecar that declared 1080p, and every
 * gate stayed green because none of them opens the encoded file.
 * `tests/format.test.ts` reads the delivery back with ffprobe. Frame hashes
 * are taken before the encode leg, so nothing decided here can move a digest.
 */
export function encodeScaleTo(c: {
  readonly width: number;
  readonly height: number;
  readonly supersample: number;
}): [number, number] | undefined {
  return c.supersample > 1 ? [c.width, c.height] : undefined;
}

export async function stageSpec(dir: string, specPath: string): Promise<{ dir: string; dispose: () => Promise<void> }> {
  const genPath = resolve(dir, "gen.ts");
  if (!existsSync(genPath)) {
    throw new UsageError(`--spec requires a generator at ${genPath}`);
  }
  const mod = (await import(genPath)) as {
    stageJob?: (path: string) => Promise<{ dir: string; dispose: () => Promise<void> }>;
  };
  if (typeof mod.stageJob !== "function") {
    throw new UsageError(`${genPath} does not export stageJob(specPath)`);
  }
  return mod.stageJob(resolve(specPath));
}

export async function run(options: RenderOptions): Promise<CommandResult> {
  let staged: { dir: string; dispose: () => Promise<void> } | undefined;
  if (options.spec) {
    try {
      staged = await stageSpec(options.dir, options.spec);
    } catch (e) {
      if (e instanceof UsageError) throw e;
      const message = errMsg(e);
      return {
        exitCode: EXIT_FAIL,
        json: { ok: false, error: message },
        stderrLines: [message],
        stdoutLines: [`render failed — ${message}`],
      };
    }
  }

  const bound: { footage: FootageHandle | null } = { footage: null };
  try {
    // A job builds into its staged tree so `dispose()` removes the artifacts.
    // `--bundle` / `--pak` with `--spec` are refused at argv parse.
    const flags = staged
      ? {
          ...options.flags,
          bundle: join(staged.dir, "dist", "main.js"),
          pak: join(staged.dir, "dist", "main.pak"),
        }
      : options.flags;
    const resolved = await resolveComposition({
      dir: staged?.dir ?? options.dir,
      flags,
      requireBundle: options.spec ? false : true,
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
    const outputPath = resolve(options.out);
    const format = options.format ?? "mp4";
    if (options.spec) {
      await runBuild(c);
    }
    if (format === "png-seq") mkdirSync(outputPath, { recursive: true });
    // Upstream's PNG encoder, reached through a computed specifier the way
    // `frame` reaches it. Loaded only for the one format that needs it, so
    // an mp4 render does not pay an import for a leg it never runs.
    const encodePNG =
      format === "png-seq"
        ? (
            (await import(`${pocketjsRoot()}/tools/png.ts`)) as {
              encodePNG: (rgba: Uint8Array, w: number, h: number) => Uint8Array;
            }
          ).encodePNG
        : undefined;
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
      shutter: c.shutter,
      buildCommand: c.buildCommand,
      scaleTo: encodeScaleTo(c),
      hashAlgorithm: options.flags.hash,
      outputPath,
      format,
      alpha: options.alpha === true,
      encodePNG,
      setup: declared
        ? async (source) => {
            await source.seekFrame(0);
            bound.footage = await openFootage(c, source.world, tree);
          }
        : undefined,
      onFrameBoundary: (frame) => bound.footage?.present(frame),
    });

    const payload: {
      ok: true;
      outputPath: string;
      format: OutputFormat;
      alpha: boolean;
      alphaFloor?: number;
      frames: number;
      digest: string;
      elapsedMs: number;
      msPerFrame: number;
      shutter?: SidecarShutter;
      soundSkipped?: string;
      sound?: {
        sha256: string;
        bytes: number;
        ffmpeg: string;
        manifestPath: string;
      };
    } = {
      ok: true,
      outputPath: result.outputPath ?? outputPath,
      format,
      alpha: options.alpha === true,
      ...(result.alphaFloor !== undefined ? { alphaFloor: result.alphaFloor } : {}),
      frames: result.frames,
      digest: result.digest,
      elapsedMs: result.elapsedMs,
      msPerFrame: result.msPerFrame,
      ...(c.shutter ? { shutter: c.shutter } : {}),
    };

    const stdoutLines = [
      `render ok — ${result.frames} frames → ${payload.outputPath} (${format})`,
      `digest ${result.digest}`,
      `${result.msPerFrame.toFixed(2)} ms/frame (${result.elapsedMs.toFixed(0)} ms total)`,
      ...(c.shutter
        ? [`shutter ${describeShutter(c.shutter)} — every frame is an exposure of ${c.shutter.samples} renders`]
        : []),
    ];
    if (result.alphaFloor !== undefined) {
      // Reported every time: the number is the evidence. The rasteriser
      // clears to transparent black (patch 0014), so 255 now means the
      // composition's own ground covers the canvas, and anything lower is
      // a pixel no declared ground reached.
      stdoutLines.push(
        result.alphaFloor === 255
          ? "alpha floor 255 — every pixel of every frame is opaque: the composition's ground covers the canvas"
          : `alpha floor ${result.alphaFloor} — the frames are transparent where no ground was declared`,
      );
    }

    // Mux after the frames are encoded and hashed. This command is the
    // only caller: `trace` hashes without an outputPath and never reaches
    // this block, so a sound declaration cannot move a frame digest.
    //
    // png-seq is the exception, and it is stated rather than skipped in
    // silence: a directory of stills is not a container and has nowhere to
    // put an audio stream, so a composition that declares sound would
    // otherwise lose it here without a word.
    if (soundDeclared(c.sidecar.sound) && format === "png-seq") {
      payload.soundSkipped =
        "png-seq is a directory of stills, not a container: the declared sound has nowhere " +
        "to go. Render this composition to mp4, webm or mov for the mix.";
      stdoutLines.push(`sound not muxed — ${payload.soundSkipped}`);
    } else if (soundDeclared(c.sidecar.sound)) {
      const resolved = resolveSound(c.sidecar, c.dir);
      if (!resolved.ok) {
        return {
          exitCode: EXIT_FAIL,
          json: {
            ok: false,
            error: "declared sound file missing",
            diagnostics: resolved.diagnostics,
            digest: result.digest,
          },
          stderrLines: resolved.diagnostics.map(
            (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
          ),
          stdoutLines: [`render failed — declared sound file missing`],
        };
      }
      const probed = await probeSoundDurations(resolved.elements);
      const graph = mixGraph(c.sidecar.sound, probed, c.fps, c.durationFrames);
      const mixed = await muxSound({
        videoPath: payload.outputPath,
        outputPath: payload.outputPath,
        graph,
        durationSec: framesToMs(c.durationFrames, c.fps) / 1000,
      });
      payload.sound = {
        sha256: mixed.sha256,
        bytes: mixed.bytes,
        ffmpeg: mixed.ffmpeg,
        manifestPath: mixed.manifestPath,
      };
      stdoutLines.push(
        `sound ${mixed.sha256}  ${mixed.ffmpeg}`,
        `sound manifest ${mixed.manifestPath}`,
      );
    }

    return {
      exitCode: EXIT_OK,
      json: payload,
      stdoutLines,
    };
  } catch (e) {
    if (e instanceof UsageError) throw e;
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`render failed — ${message}`],
    };
  } finally {
    await bound.footage?.close();
    await staged?.dispose();
  }
}

async function runBatch(options: {
  readonly dir: string;
  readonly specDir: string;
  readonly outDir: string;
  readonly flags: GlobalFlags;
  readonly format: OutputFormat;
  readonly alpha: boolean;
}): Promise<CommandResult> {
  const files = readdirSync(options.specDir)
    .filter((n) => n.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new UsageError(`no .json jobs in ${options.specDir}`);
  }
  const root = repoRootOf(resolve(options.dir));
  let expectedTemplate: string | undefined;
  const defaultSpecPath = join(resolve(options.dir), "spec.default.json");
  if (existsSync(defaultSpecPath)) {
    try {
      const def = (await Bun.file(defaultSpecPath).json()) as { template?: unknown };
      if (typeof def.template === "string") expectedTemplate = def.template;
    } catch {
      expectedTemplate = undefined;
    }
  }
  const parseFails: Array<{ spec: string; error: string }> = [];
  for (const name of files) {
    const specPath = join(options.specDir, name);
    let raw: unknown;
    try {
      raw = await Bun.file(specPath).json();
    } catch (e) {
      parseFails.push({ spec: name, error: errMsg(e) });
      continue;
    }
    if (Array.isArray(raw)) {
      parseFails.push({
        spec: name,
        error: "a job is one JSON object; for many jobs pass a directory of .json files",
      });
      continue;
    }
    const parsed = parseSpec(raw, { root });
    if (!parsed.ok) {
      parseFails.push({
        spec: name,
        error: parsed.diagnostics.map((d) => `${d.path || "/"}: ${d.code}: ${d.message}`).join("\n"),
      });
      continue;
    }
    if (expectedTemplate !== undefined && parsed.value.template !== expectedTemplate) {
      parseFails.push({
        spec: name,
        error: `this generator is ${JSON.stringify(expectedTemplate)}; got ${JSON.stringify(parsed.value.template)}`,
      });
    }
  }
  if (parseFails.length > 0) {
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: "one or more jobs failed to parse", failed: parseFails, done: [], pending: files },
      stderrLines: parseFails.map((f) => `${f.spec}: ${f.error}`),
      stdoutLines: [`render failed — ${parseFails.length} job(s) failed to parse`],
    };
  }
  mkdirSync(options.outDir, { recursive: true });
  const jobs: Array<{ spec: string; outputPath: string; digest: string; frames: number }> = [];
  const stdoutLines: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i]!;
    const specPath = join(options.specDir, name);
    // One output per job, named after the job. `png-seq` makes each of those
    // a directory rather than a file, which is why the extension comes from
    // the format instead of being spelled `.mp4` here.
    const out = join(
      options.outDir,
      `${basename(name, ".json")}${formatExtension(options.format) ?? ""}`,
    );
    const result = await run({
      dir: options.dir,
      out,
      flags: options.flags,
      spec: specPath,
      format: options.format,
      alpha: options.alpha,
    });
    if (result.exitCode !== EXIT_OK) {
      const pending = files.slice(i + 1);
      return {
        exitCode: result.exitCode,
        json: {
          ok: false,
          error: `${name}: ${(result.json as { error?: string } | undefined)?.error ?? "render failed"}`,
          failed: [
            {
              spec: name,
              error: (result.json as { error?: string } | undefined)?.error ?? "render failed",
            },
          ],
          done: jobs,
          pending,
        },
        stderrLines: [`${name}: ${(result.stderrLines ?? []).join("\n") || "render failed"}`],
        stdoutLines: [`render failed — ${name}`],
      };
    }
    const json = result.json as { digest: string; frames: number; outputPath: string };
    jobs.push({ spec: name, outputPath: json.outputPath, digest: json.digest, frames: json.frames });
    stdoutLines.push(`${name}  ${json.digest}`);
  }
  return {
    exitCode: EXIT_OK,
    json: { ok: true, jobs },
    stdoutLines,
  };
}

export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["render", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const spec = optionalString(parsed.flags, "spec");
  refuseJobPatches(parsed.global, spec !== undefined);
  const out = optionalString(parsed.flags, "out");
  const outDir = optionalString(parsed.flags, "out-dir");
  const requestedFormat = optionalString(parsed.flags, "format");
  const alpha = parsed.flags.alpha === true;

  if (spec !== undefined) {
    const specPath = resolve(spec);
    if (!existsSync(specPath)) {
      throw new UsageError(`spec not found: ${specPath}`);
    }
    const st = statSync(specPath);
    if (st.isDirectory()) {
      if (out !== undefined) {
        throw new UsageError("--out is one file; a directory of jobs needs --out-dir");
      }
      if (outDir === undefined) {
        throw new UsageError("--spec <dir> requires --out-dir");
      }
      // A directory of jobs names no output file, so there is no extension to
      // check the format against — `--format` alone decides, defaulting to mp4.
      const batchFormat = resolveFormat(requestedFormat, "");
      assertAlphaSupported(batchFormat, alpha);
      return runBatch({
        dir,
        specDir: specPath,
        outDir: resolve(outDir),
        flags: parsed.global,
        format: batchFormat,
        alpha,
      });
    }
    if (outDir !== undefined) {
      throw new UsageError("--out-dir is for a directory of jobs; a single spec uses --out");
    }
    if (out === undefined) {
      throw new UsageError("flag --out is required");
    }
    let raw: unknown;
    try {
      raw = await Bun.file(specPath).json();
    } catch {
      raw = undefined;
    }
    if (Array.isArray(raw)) {
      throw new UsageError("a job is one JSON object; for many jobs pass a directory of .json files");
    }
    const format = resolveFormat(requestedFormat, out);
    assertAlphaSupported(format, alpha);
    return run({ dir, out, flags: parsed.global, spec: specPath, format, alpha });
  }

  if (outDir !== undefined) {
    throw new UsageError("--out-dir requires --spec <dir>");
  }
  if (out === undefined) {
    throw new UsageError("flag --out is required");
  }
  const format = resolveFormat(requestedFormat, out);
  assertAlphaSupported(format, alpha);
  return run({ dir, out, flags: parsed.global, format, alpha });
}
