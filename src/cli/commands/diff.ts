/**
 * `diff <trace-a.json> <trace-b.json>`
 * Question: first divergent frame index, or none?
 *
 * Exit 1 when they diverge, 0 when identical — divergence is a finding.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FrameHashSequence } from "../../render/hash.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { errMsg } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  isTraceJson,
  type CommandResult,
  type GlobalFlags,
  type TraceJson,
} from "../types.ts";

export interface DiffOptions {
  readonly aPath: string;
  readonly bPath: string;
  readonly flags: GlobalFlags;
}

export async function run(options: DiffOptions): Promise<CommandResult> {
  const aPath = resolve(options.aPath);
  const bPath = resolve(options.bPath);

  if (!existsSync(aPath)) {
    throw new UsageError(`trace file not found: ${aPath}`);
  }
  if (!existsSync(bPath)) {
    throw new UsageError(`trace file not found: ${bPath}`);
  }

  let a: TraceJson;
  let b: TraceJson;
  try {
    a = await loadTrace(aPath);
    b = await loadTrace(bPath);
  } catch (e) {
    throw new UsageError(errMsg(e));
  }

  const index = FrameHashSequence.firstDivergence(a.frames, b.frames);

  if (index === -1) {
    const payload = {
      ok: true,
      identical: true,
      firstDivergence: null,
      framesA: a.frames.length,
      framesB: b.frames.length,
      digestA: a.digest,
      digestB: b.digest,
    };
    return {
      exitCode: EXIT_OK,
      json: payload,
      stdoutLines: [
        `diff ok — identical (${a.frames.length} frames, digest ${a.digest})`,
      ],
    };
  }

  const hashA = a.frames[index] ?? null;
  const hashB = b.frames[index] ?? null;
  const payload = {
    ok: false,
    identical: false,
    firstDivergence: index,
    hashA,
    hashB,
    framesA: a.frames.length,
    framesB: b.frames.length,
    digestA: a.digest,
    digestB: b.digest,
  };

  return {
    exitCode: EXIT_FAIL,
    json: payload,
    stdoutLines: [
      `diff: first divergence at frame ${index}`,
      `  a[${index}] ${hashA}`,
      `  b[${index}] ${hashB}`,
    ],
  };
}

async function loadTrace(path: string): Promise<TraceJson> {
  let raw: unknown;
  try {
    raw = await Bun.file(path).json();
  } catch (e) {
    throw new Error(`failed to parse ${path}: ${errMsg(e)}`);
  }
  if (!isTraceJson(raw)) {
    throw new Error(
      `${path} is not a valid trace JSON (need { frames: string[], digest: string })`,
    );
  }
  return raw;
}

export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["diff", ...argv]);
  const aPath = requirePositional(parsed.positionals, 0, "trace-a.json");
  const bPath = requirePositional(parsed.positionals, 1, "trace-b.json");
  return run({ aPath, bPath, flags: parsed.global });
}
