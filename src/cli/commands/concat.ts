/**
 * `concat <composition-dir> <segment>... --out <file>`
 * Question: are these segments one film, and if so, deliver it.
 *
 * A segment is what `render --range <first>..<last> --out <file>` wrote,
 * named here by that `<file>` or by its `<file>.segment.json`. They may come
 * from other machines and in any order. The composition is named because two
 * things come from it: the identity the segments must carry, and the sound,
 * which is muxed once over the joined film and never per segment.
 *
 * The identity is computed as `trace` computes it, with one input taken from
 * the segments rather than measured here: the frozen footage artifacts. A
 * footage hash exists only after an ingest, and `concat` ingests nothing; the
 * segments are checked to agree on it with each other, and the output says
 * which components were taken rather than computed.
 *
 * `--json` is `render`'s object for the joined film — `digest` is the value
 * `trace` reports for this identity — plus `segments` and `join`.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { InputIdentity } from "../../render/identity.ts";
import { checkAndJoin, readSegment, type JoinReport, type Segment } from "../../render/segment.ts";
import { UsageError, optionalString, parseArgs, requirePositional } from "../args.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import { EXIT_FAIL, EXIT_OK, type CommandResult, type GlobalFlags } from "../types.ts";
import { deliverSound, describeJoin, joinRefused, resolveFormat, type RenderJson } from "./render.ts";
import { compositionIdentity } from "./trace.ts";

export interface ConcatJson extends Omit<RenderJson, "elapsedMs" | "msPerFrame" | "workers" | "identity"> {
  identity: InputIdentity;
  /** Identity components the segments supplied and `concat` did not compute. */
  identityFromSegments?: readonly string[];
  segments: ReadonlyArray<{ path: string; first: number; last: number }>;
  join: JoinReport;
  elapsedMs: number;
}

export interface ConcatOptions {
  readonly dir: string;
  readonly segments: readonly string[];
  readonly out: string;
  readonly flags: GlobalFlags;
}

export async function run(options: ConcatOptions): Promise<CommandResult> {
  const started = performance.now();
  const segments: Segment[] = [];
  for (const arg of options.segments) {
    try {
      segments.push(await readSegment(resolve(arg)));
    } catch (e) {
      throw new UsageError(errMsg(e));
    }
  }
  const format = segments[0]!.manifest.format;
  // The extension is checked against the segments' format by the rule
  // `render` checks it against `--format` with, in this command's words.
  try {
    resolveFormat(format, options.out);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    throw new UsageError(
      `the segments are ${format}, and --out ${JSON.stringify(options.out)} names something else: ` +
        (format === "png-seq" ? "png-seq joins into a directory, named with no extension" : `name a ${format} file`),
    );
  }
  const outputPath = resolve(options.out);
  const clash = segments.find((s) => resolve(s.mediaPath) === outputPath);
  if (clash) {
    throw new UsageError(
      `--out ${JSON.stringify(options.out)} is one of the segments; the join reads every segment while it ` +
        "writes, so it writes a new file",
    );
  }

  const resolved = await resolveComposition({ dir: options.dir, flags: options.flags, requireBundle: true });
  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: "invalid pocket-motion.json", diagnostics: resolved.diagnostics },
      stderrLines: (resolved.diagnostics ?? []).map((d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`),
    };
  }
  const c = resolved.value;

  try {
    const footage: Record<string, string> = {};
    const taken: string[] = [];
    for (const [key, hash] of Object.entries(segments[0]!.manifest.identity.components)) {
      if (!key.startsWith("footage:")) continue;
      footage[key.slice("footage:".length)] = hash;
      taken.push(key);
    }
    const identity = await compositionIdentity(c, c.sidecar.footage.length > 0 ? footage : undefined);

    if (format === "png-seq") mkdirSync(outputPath, { recursive: true });
    const joined = await checkAndJoin(
      segments,
      { identity, filmFrames: c.durationFrames, hash: options.flags.hash },
      outputPath,
    );
    if (!joined.ok) return joinRefused(joined.refusals, "concat");

    const first = joined.ordered[0]!.manifest;
    const payload: ConcatJson = {
      ok: true,
      outputPath,
      format,
      alpha: first.alpha,
      ...(joined.alphaFloor !== undefined ? { alphaFloor: joined.alphaFloor } : {}),
      frames: joined.frames.length,
      digest: joined.digest,
      identity,
      ...(taken.length > 0 ? { identityFromSegments: taken } : {}),
      ...(c.shutter ? { shutter: c.shutter } : {}),
      segments: joined.ordered.map((s) => ({ path: s.mediaPath, first: s.manifest.first, last: s.manifest.last })),
      join: joined.report,
      elapsedMs: 0,
    };
    const stdoutLines = [
      `concat ok — ${joined.ordered.length} segment(s), ${payload.frames} frames → ${outputPath} (${format})`,
      `digest ${payload.digest}`,
      `identity ${identity.digest}`,
      ...(taken.length > 0
        ? [`identity components taken from the segments, not computed here: ${taken.join(", ")}`]
        : []),
      ...describeJoin(joined.report),
    ];
    const failed = await deliverSound(c, format, payload, stdoutLines);
    if (failed) return failed;
    payload.elapsedMs = performance.now() - started;
    stdoutLines.push(`${payload.elapsedMs.toFixed(0)} ms`);
    return { exitCode: EXIT_OK, json: payload, stdoutLines };
  } catch (e) {
    if (e instanceof UsageError) throw e;
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`concat failed — ${message}`],
    };
  }
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["concat", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const segments = parsed.positionals.slice(1);
  if (segments.length === 0) {
    throw new UsageError(
      "concat needs the segments to join: concat <composition-dir> <segment>... --out <file>, " +
        "each <segment> the --out of a `render --range` or its .segment.json",
    );
  }
  const out = optionalString(parsed.flags, "out");
  if (out === undefined) throw new UsageError("flag --out is required");
  return run({ dir, segments, out, flags: parsed.global });
}
