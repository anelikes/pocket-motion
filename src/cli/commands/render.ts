/**
 * `render <composition-dir> --out <file.mp4>`
 * Question: produce the video.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { render as renderComposition } from "../../render/render.ts";
import {
  OUTPUT_FORMATS,
  formatCarriesAlpha,
  formatExtension,
  isOutputFormat,
  type OutputFormat,
} from "../../render/encode.ts";
import type { SidecarShutter, SidecarSound } from "../../manifest/sidecar.ts";
import type { InputIdentity } from "../../render/identity.ts";
import { renderSegments } from "../../render/parallel.ts";
import {
  SEGMENT_KIND,
  SEGMENT_VERSION,
  checkAndJoin,
  ffmpegVersionLine,
  mediaDigest,
  readSegment,
  recordedEncoderArgv,
  segmentManifestPath,
  type JoinRefusal,
  type JoinReport,
  type Segment,
  type SegmentManifest,
} from "../../render/segment.ts";
import { WasmFrameSource } from "../../runtime/frame-source.ts";
import { describeShutter, pocketjsRoot } from "../../runtime/boot.ts";
import { framesToMs, mixGraph, soundDeclared, tailOverruns } from "../../sound/mix.ts";
import { muxSound, type ManifestElement } from "../../sound/mux.ts";
import { probeSoundDurations, resolveSound } from "../../sound/resolve.ts";
import { describeTail, type TailMeasurement } from "../../sound/tail.ts";
import {
  UsageError,
  optionalInt,
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
  type ResolvedComposition,
} from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";
import { compositionIdentity } from "./trace.ts";

/** What `render --json` prints for one finished render. */
export interface RenderJson {
  ok: true;
  outputPath: string;
  format: OutputFormat;
  alpha: boolean;
  alphaFloor?: number;
  frames: number;
  /** The frame-sequence digest — the same value `trace` reports. */
  digest: string;
  /** `trace`'s input identity. Absent for a `--spec` job (see `run`). */
  identity?: InputIdentity;
  elapsedMs: number;
  msPerFrame: number;
  shutter?: SidecarShutter;
  soundSkipped?: string;
  sound?: SoundJson;
  /** `--workers`: how the film was split, and each worker's wall time. */
  workers?: {
    count: number;
    segments: ReadonlyArray<{ first: number; last: number; elapsedMs: number }>;
  };
  /** `--workers`: how the segments were joined and what reading the result back found. */
  join?: JoinReport;
}

/** The mix `render` and `concat` mux into a delivery, and its manifest. */
export interface SoundJson {
  sha256: string;
  bytes: number;
  ffmpeg: string;
  manifestPath: string;
  elements: readonly ManifestElement[];
  tail?: TailMeasurement;
}

/**
 * What `render --range` prints: one segment of a film, not a film. It
 * carries no `digest` on purpose — the digest of some frames is not the
 * value `trace` reports, and a field of that name holding it would be
 * compared with one. `concat` computes the film's from the manifest.
 */
export interface SegmentJson {
  ok: true;
  segment: { first: number; last: number };
  outputPath: string;
  /** `<outputPath>.segment.json`: the frame hashes, identity and encoder argv `concat` reads. */
  manifestPath: string;
  format: OutputFormat;
  alpha: boolean;
  alphaFloor?: number;
  frames: number;
  filmFrames: number;
  identity: InputIdentity;
  elapsedMs: number;
  msPerFrame: number;
  shutter?: SidecarShutter;
  /** Present when the composition declares sound: why this segment carries none. */
  soundDeferred?: string;
}

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
  /** `--range first..last`: render frames `first` to `last` of the film as a segment. */
  readonly range?: readonly [first: number, last: number];
  /** `--workers N`: render as N segments in N processes, then join them. */
  readonly workers?: number;
}

/**
 * `--range <first>..<last>`, both frames inclusive — the numbers `trace`
 * prints beside the hashes, so the range a reader writes is the frames they
 * read. Checked against the film's length once it is resolved.
 */
export function parseRange(raw: string): [first: number, last: number] {
  const m = /^(\d+)\.\.(\d+)$/.exec(raw);
  if (!m) {
    throw new UsageError(
      `--range takes <first>..<last>, two frame numbers, both included; got ${JSON.stringify(raw)}`,
    );
  }
  const first = Number(m[1]);
  const last = Number(m[2]);
  if (last < first) {
    throw new UsageError(`--range ${raw} ends before it starts`);
  }
  return [first, last];
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
    if (options.range && options.range[1] >= c.durationFrames) {
      throw new UsageError(
        `--range ${options.range[0]}..${options.range[1]} runs past the film: its frames are 0..${c.durationFrames - 1}`,
      );
    }
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
    let result: {
      readonly frames: number;
      readonly digest: string;
      readonly elapsedMs: number;
      readonly msPerFrame: number;
      readonly alphaFloor?: number;
      readonly outputPath?: string;
    };
    let identity: InputIdentity | undefined;
    let split: Pick<RenderJson, "workers" | "join"> = {};
    if (options.workers !== undefined) {
      // `flags`, not `options.flags`: a job's workers render its staged build.
      const w = await renderWithWorkers(c, { ...options, flags }, outputPath, format);
      if (!w.ok) return w.result;
      result = w;
      // Computed either way — the join checks every segment against it — and
      // reported only where `trace` could reproduce it (see below).
      identity = staged ? undefined : w.identity;
      split = { workers: w.workers, join: w.join };
    } else {
      const declared = c.sidecar.footage.length > 0;
      const tree = declared ? await scratchTree(c) : null;
      const rendered = await renderComposition({
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
        ...(options.range ? { range: [options.range[0], options.range[1] + 1] as const } : {}),
        setup: declared
          ? async (source) => {
              await source.seekFrame(0);
              bound.footage = await openFootage(c, source.world, tree);
            }
          : undefined,
        onFrameBoundary: (frame) => bound.footage?.present(frame),
      });
      if (options.range) {
        return await segmentResult(c, options, rendered, outputPath, format, bound.footage?.hashes);
      }
      result = rendered;

      // The identity `trace` would report, from the same function, so a delivery
      // carries the pair a reader on another machine compares against. Not for
      // a job: `--spec` builds in a staged directory whose name is random and
      // lands in `build.json`'s argv, so two renders of one job would report two
      // identities — the reason `trace` does not accept `--spec` either.
      identity = staged ? undefined : await compositionIdentity(c, bound.footage?.hashes);
    }

    const payload: RenderJson = {
      ok: true,
      outputPath: result.outputPath ?? outputPath,
      format,
      alpha: options.alpha === true,
      ...(result.alphaFloor !== undefined ? { alphaFloor: result.alphaFloor } : {}),
      frames: result.frames,
      digest: result.digest,
      ...(identity ? { identity } : {}),
      elapsedMs: result.elapsedMs,
      msPerFrame: result.msPerFrame,
      ...(c.shutter ? { shutter: c.shutter } : {}),
      ...split,
    };

    const stdoutLines = [
      `render ok — ${result.frames} frames → ${payload.outputPath} (${format})`,
      `digest ${result.digest}`,
      ...(identity ? [`identity ${identity.digest}`] : []),
      `${result.msPerFrame.toFixed(2)} ms/frame (${result.elapsedMs.toFixed(0)} ms total)`,
      ...(split.workers
        ? [
            `workers ${split.workers.count} — ${split.workers.segments
              .map((s) => `${s.first}..${s.last} ${(s.elapsedMs / 1000).toFixed(1)} s`)
              .join(", ")}`,
            ...(split.join ? describeJoin(split.join) : []),
          ]
        : []),
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

    const failed = await deliverSound(c, format, payload, stdoutLines);
    if (failed) return failed;

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

function withoutTail(sound: SidecarSound): SidecarSound {
  const { silentTailMs: _tail, ...rest } = sound;
  return rest;
}

/**
 * Mux the declared sound into a delivery whose frames are already encoded and
 * hashed — once, over the whole film. `render`, `render --workers` and
 * `concat` all end here, so a segment is never given a mix of its own and a
 * joined film is mixed exactly as a one-shot render is. Returns the failure
 * to report, or null when the delivery is complete; `payload` and
 * `stdoutLines` gain what was muxed.
 */
export async function deliverSound(
  c: ResolvedComposition,
  format: OutputFormat,
  payload: { ok: boolean; outputPath: string; digest: string; soundSkipped?: string; sound?: SoundJson },
  stdoutLines: string[],
): Promise<CommandResult | null> {
  // Mux after the frames are encoded and hashed. `trace` hashes without an
  // outputPath and never reaches this function, so a sound declaration
  // cannot move a frame digest.
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
          digest: payload.digest,
        },
        stderrLines: resolved.diagnostics.map(
          (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
        ),
        stdoutLines: [`render failed — declared sound file missing`],
      };
    }
    const probed = await probeSoundDurations(resolved.elements);
    // The declared tail is the last N ms of the FILM. A `--frames` render
    // of another length does not end where the film does, so it carries no
    // tail, and says so rather than gating some other instant.
    const partial = c.durationFrames !== c.sidecar.durationFrames;
    const sound =
      partial && c.sidecar.sound.silentTailMs !== undefined
        ? withoutTail(c.sidecar.sound)
        : c.sidecar.sound;
    if (sound !== c.sidecar.sound) {
      stdoutLines.push(
        `sound silent tail not applied — --frames renders ${c.durationFrames} of ` +
          `${c.sidecar.durationFrames} frames, and the declared ${c.sidecar.sound.silentTailMs} ms ` +
          "tail is the end of the film",
      );
    }
    // An element still sounding when the declared silent tail begins would
    // be cut by the gate. The parser refuses one that STARTS in the tail;
    // how long a file runs is known only once it is probed, so this is the
    // first place that can refuse the rest.
    const overruns = tailOverruns(sound, probed, c.fps, c.durationFrames);
    if (overruns.length > 0) {
      return {
        exitCode: EXIT_FAIL,
        json: {
          ok: false,
          error: "declared sound runs into the silent tail",
          diagnostics: overruns,
          digest: payload.digest,
        },
        stderrLines: overruns.map((d) => `sidecar ${d.path}: ${d.code}: ${d.message}`),
        stdoutLines: [`render failed — declared sound runs into the silent tail`],
      };
    }
    const graph = mixGraph(sound, probed, c.fps, c.durationFrames);
    const mixed = await muxSound({
      videoPath: payload.outputPath,
      outputPath: payload.outputPath,
      graph,
      durationSec: framesToMs(c.durationFrames, c.fps) / 1000,
      ...(sound.silentTailMs !== undefined ? { silentTailMs: sound.silentTailMs } : {}),
    });
    payload.sound = {
      sha256: mixed.sha256,
      bytes: mixed.bytes,
      ffmpeg: mixed.ffmpeg,
      manifestPath: mixed.manifestPath,
      elements: mixed.elements,
      ...(mixed.tail !== undefined ? { tail: mixed.tail } : {}),
    };
    stdoutLines.push(
      `sound ${mixed.sha256}  ${mixed.ffmpeg}`,
      `sound manifest ${mixed.manifestPath}`,
    );
    // An optional element is reported whichever way it went: one that was
    // skipped is a delivery without it, and saying so is the difference
    // between this and the probed-guessed-path mix the schema replaced.
    for (const e of graph.elements) {
      if (!e.optional) continue;
      const who = `${e.role} ${e.id === null ? "" : JSON.stringify(e.id) + " "}`;
      stdoutLines.push(
        e.mixed
          ? `sound optional ${who}mixed — ${e.path}`
          : `sound optional ${who}skipped — not on disk: ${resolved.elements.find((r) => r.pointer === e.pointer)?.src ?? e.pointer}`,
      );
    }
    if (mixed.tail !== undefined) {
      stdoutLines.push(`sound ${describeTail(mixed.tail)}`);
      if (!mixed.tail.ok) {
        // The file is written and stays where it is, as a video whose
        // declared sound is missing does: the exit code is the verdict.
        return {
          exitCode: EXIT_FAIL,
          json: { ...payload, ok: false, error: "declared silent tail not met" },
          stdoutLines: [
            ...stdoutLines,
            `render failed — the declared silent tail is not digital silence in ${payload.outputPath}`,
          ],
        };
      }
    }
  }
  return null;
}

/**
 * `render --range`: write the segment's manifest beside it and report it.
 *
 * The identity is the FILM's — `durationFrames` included — computed exactly
 * as `trace` computes it, so segments of one film rendered on different
 * machines carry one value and `concat` can refuse any that does not.
 */
async function segmentResult(
  c: ResolvedComposition,
  options: RenderOptions,
  result: Awaited<ReturnType<typeof renderComposition>>,
  outputPath: string,
  format: OutputFormat,
  footageHashes: Readonly<Record<string, string>> | undefined,
): Promise<CommandResult> {
  const [first, last] = options.range!;
  const identity = await compositionIdentity(c, footageHashes);
  const manifest: SegmentManifest = {
    kind: SEGMENT_KIND,
    version: SEGMENT_VERSION,
    compositionId: c.compositionId,
    first,
    last,
    filmFrames: c.durationFrames,
    fps: c.fps,
    format,
    alpha: options.alpha === true,
    hash: options.flags.hash ?? "sha256",
    identity,
    frameHashes: result.frameHashes,
    ...(result.alphaFloor !== undefined ? { alphaFloor: result.alphaFloor } : {}),
    encoder: result.encode
      ? { argv: recordedEncoderArgv(result.encode), ffmpeg: await ffmpegVersionLine() }
      : { argv: null, ffmpeg: null },
    media: { name: basename(outputPath), ...(await mediaDigest(outputPath)) },
  };
  const manifestPath = segmentManifestPath(outputPath);
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const soundDeferred = soundDeclared(c.sidecar.sound)
    ? "a segment carries no sound: `concat` muxes the declared mix once, over the joined film"
    : undefined;
  const payload: SegmentJson = {
    ok: true,
    segment: { first, last },
    outputPath,
    manifestPath,
    format,
    alpha: options.alpha === true,
    ...(result.alphaFloor !== undefined ? { alphaFloor: result.alphaFloor } : {}),
    frames: result.frames,
    filmFrames: c.durationFrames,
    identity,
    elapsedMs: result.elapsedMs,
    msPerFrame: result.msPerFrame,
    ...(c.shutter ? { shutter: c.shutter } : {}),
    ...(soundDeferred ? { soundDeferred } : {}),
  };
  return {
    exitCode: EXIT_OK,
    json: payload,
    stdoutLines: [
      `render ok — segment ${first}..${last} of a ${c.durationFrames}-frame film → ${outputPath} (${format})`,
      `manifest ${manifestPath}`,
      `identity ${identity.digest}`,
      `${result.msPerFrame.toFixed(2)} ms/frame (${result.elapsedMs.toFixed(0)} ms total)`,
      ...(soundDeferred ? [`sound deferred — ${soundDeferred}`] : []),
    ],
  };
}

/**
 * Bind the declared footage once in this process and let it go: the ingest
 * writes a cache under the bundle's directory, and N workers finding it cold
 * would each write it at once. Returns the frozen artifacts' hashes — the
 * footage half of the identity every segment is checked against.
 */
async function ingestFootageOnce(
  c: ResolvedComposition,
): Promise<Readonly<Record<string, string>> | undefined> {
  if (c.sidecar.footage.length === 0) return undefined;
  const tree = await scratchTree(c);
  const source = await WasmFrameSource.create({
    compositionId: c.compositionId,
    bundlePath: c.bundlePath,
    pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
    width: c.width,
    height: c.height,
    hz: c.fps,
    durationFrames: c.durationFrames,
    renderScale: c.supersample,
    // This world mounts so the footage can bind, and renders nothing.
    shutter: null,
    buildCommand: c.buildCommand,
  });
  try {
    await source.seekFrame(0);
    const handle = await openFootage(c, source.world, tree);
    await handle?.close();
    return handle?.hashes;
  } finally {
    await source.dispose();
  }
}

/** The flags every worker is given besides `--range` and `--out`. */
function forwardedFlags(flags: GlobalFlags, format: OutputFormat, alpha: boolean): string[] {
  const out = [`--format=${format}`];
  if (alpha) out.push("--alpha");
  for (const name of ["width", "height", "fps", "frames", "supersample", "hash", "bundle", "pak"] as const) {
    const value = flags[name];
    if (value !== undefined) out.push(`--${name}=${value}`);
  }
  return out;
}

/** A refused join as a command result — `render --workers` and `concat` print the same. */
export function joinRefused(refusals: readonly JoinRefusal[], command: string): CommandResult {
  return {
    exitCode: EXIT_FAIL,
    json: { ok: false, error: "segments refused", refusals },
    stderrLines: refusals.map((r) => `${r.code}: ${r.message}`),
    stdoutLines: [`${command} failed — ${refusals.length} reason(s) the segments are not one film`],
  };
}

export function describeJoin(join: JoinReport): string[] {
  return [
    `joined ${join.segments} segment(s) by ${join.method}`,
    ...join.verified.map((v) => `  read back: ${v}`),
  ];
}

/**
 * `render --workers N`: N `render --range` processes into a scratch
 * directory beside the output, then the join `concat` runs. The scratch is
 * removed whether or not the join succeeds; the delivery is the joined file.
 */
async function renderWithWorkers(
  c: ResolvedComposition,
  options: RenderOptions,
  outputPath: string,
  format: OutputFormat,
): Promise<
  | {
      ok: true;
      frames: number;
      digest: string;
      identity: InputIdentity;
      alphaFloor?: number;
      elapsedMs: number;
      msPerFrame: number;
      workers: NonNullable<RenderJson["workers"]>;
      join: JoinReport;
    }
  | { ok: false; result: CommandResult }
> {
  const started = performance.now();
  const identity = await compositionIdentity(c, await ingestFootageOnce(c));
  const scratch = mkdtempSync(join(dirname(outputPath), `.${basename(outputPath)}.segments-`));
  try {
    const reports = await renderSegments({
      dir: c.dir,
      filmFrames: c.durationFrames,
      workers: options.workers!,
      scratchDir: scratch,
      extension: formatExtension(format) ?? "",
      forward: forwardedFlags(options.flags, format, options.alpha === true),
    });
    const segments: Segment[] = await Promise.all(reports.map((r) => readSegment(r.manifestPath)));
    const joined = await checkAndJoin(
      segments,
      { identity, filmFrames: c.durationFrames, hash: options.flags.hash },
      outputPath,
    );
    if (!joined.ok) return { ok: false, result: joinRefused(joined.refusals, "render") };
    const elapsedMs = performance.now() - started;
    return {
      ok: true,
      frames: joined.frames.length,
      digest: joined.digest,
      identity,
      ...(joined.alphaFloor !== undefined ? { alphaFloor: joined.alphaFloor } : {}),
      elapsedMs,
      msPerFrame: elapsedMs / joined.frames.length,
      workers: {
        count: reports.length,
        segments: reports.map((r) => ({ first: r.first, last: r.last, elapsedMs: r.elapsedMs })),
      },
      join: joined.report,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function runBatch(options: {
  readonly dir: string;
  readonly specDir: string;
  readonly outDir: string;
  readonly flags: GlobalFlags;
  readonly format: OutputFormat;
  readonly alpha: boolean;
  readonly workers?: number;
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
      ...(options.workers !== undefined ? { workers: options.workers } : {}),
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
  const rawRange = optionalString(parsed.flags, "range");
  const range = rawRange === undefined ? undefined : parseRange(rawRange);
  const workers = optionalInt(parsed.flags, "workers");
  if (workers !== undefined && workers < 1) {
    throw new UsageError(`--workers must be at least 1; got ${workers}`);
  }
  if (range !== undefined && workers !== undefined) {
    throw new UsageError(
      "--range renders one segment in this process; --workers splits the film itself. Pass one.",
    );
  }
  const split = {
    ...(range !== undefined ? { range } : {}),
    ...(workers !== undefined ? { workers } : {}),
  };

  if (spec !== undefined) {
    // A segment is joined by identity, and a job's identity is not stable:
    // its staged directory's random name is in `build.json`'s argv, so two
    // segments of one job staged twice would be refused as two films. A
    // job's `--workers` share one staging, which is why that is accepted.
    if (range !== undefined) {
      throw new UsageError(
        "--range cannot be used with --spec: each staging of a job has its own identity, so its " +
          "segments could not be joined. Render the job whole, or with --workers N.",
      );
    }
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
        ...split,
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
    return run({ dir, out, flags: parsed.global, spec: specPath, format, alpha, ...split });
  }

  if (outDir !== undefined) {
    throw new UsageError("--out-dir requires --spec <dir>");
  }
  if (out === undefined) {
    throw new UsageError("flag --out is required");
  }
  const format = resolveFormat(requestedFormat, out);
  assertAlphaSupported(format, alpha);
  return run({ dir, out, flags: parsed.global, format, alpha, ...split });
}
