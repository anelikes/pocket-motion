/**
 * Apply the I/O contract for a CommandResult:
 * - --json: exactly one JSON object on stdout, nothing else
 * - human: stdoutLines on stdout
 * - stderrLines always to stderr (both modes)
 *
 * The JSON write is awaited to the OS before the caller may `process.exit`.
 * A trace of a film-length composition is a multi-hundred-KB object, and a
 * pipe reader (the digest ledger, `... | python3`) accepts 64 KiB before
 * exerting backpressure; `process.stdout.write` queues the rest and returns,
 * and an exit at that moment truncates the object mid-string. A shell
 * redirect to a file never blocks, which is why the truncation only appeared
 * the first time the ledger ran a composition this long.
 *
 * TWO THINGS HAPPEN TO THE ENVELOPE ON THE WAY OUT, and both happen HERE
 * rather than in each command, because a rule applied in twelve places is a
 * rule with eleven chances to be forgotten:
 *
 * - every absolute path is redacted (`redactPaths`). A `--json` object is
 *   what an agent pastes into an issue, a log, or another agent's context.
 *   `$REPO` and `$HOME` say the same thing about a path without saying whose
 *   machine it is, and `$REPO` says the more useful of the two: a path
 *   inside the checkout is a fact about this repository, and one outside it
 *   is a fact about the operator.
 * - `MOTION_RUN_ID`, when set, is echoed as `runId`. One agent turn runs
 *   `lint`, `check`, `trace` and `visibility`; the envelopes are four
 *   objects with nothing joining them, and the shell that ran them is the
 *   only place the join existed.
 *
 * Neither touches stderr. Diagnostics are for a person reading a terminal,
 * where a real path is what you paste back into a command.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";

import type { CommandResult } from "./types.ts";

/** The repository root — this module sits at `src/cli/`. */
const REPO_ROOT = resolve(import.meta.dir, "../..");

/** Environment variable an agent sets to join one turn's envelopes. */
export const RUN_ID_ENV = "MOTION_RUN_ID";

export interface RedactRoots {
  /** Rewritten to `$REPO`. */
  readonly repoRoot: string;
  /** Rewritten to `$HOME`, after `repoRoot` — the checkout is usually inside it. */
  readonly home: string;
}

export function redactRoots(): RedactRoots {
  return { repoRoot: REPO_ROOT, home: homedir() };
}

/**
 * Replace the two roots wherever they appear in `text`.
 *
 * A substring replacement rather than a path-shaped one, because most paths
 * in an envelope are not their own field: they are inside a sentence
 * (`bundle not found: $HOME/…`, a build command, a refusal quoting an
 * argv). Anything that is neither under the checkout nor under the home
 * directory — `/usr/local/bin/ffmpeg`, `/tmp/…` — is left alone: it names
 * the machine's software, not its operator.
 *
 * Order is load-bearing. The checkout is normally under the home directory,
 * so redacting `home` first would turn every repository path into
 * `$HOME/code/…` and lose the more useful of the two answers.
 */
export function redactString(text: string, roots: RedactRoots): string {
  let out = text;
  if (roots.repoRoot.length > 1) out = out.replaceAll(roots.repoRoot, "$REPO");
  if (roots.home.length > 1) out = out.replaceAll(roots.home, "$HOME");
  return out;
}

/**
 * `redactString` over every string in a JSON value, keys included.
 *
 * Keys because a payload may be a map keyed by path — `sound --verify`
 * reports per-file, and a future command that reports per-artifact would put
 * the path where nothing else looks.
 */
export function redactPaths<T>(value: T, roots: RedactRoots = redactRoots()): T {
  return walk(value, roots) as T;
}

function walk(value: unknown, roots: RedactRoots): unknown {
  if (typeof value === "string") return redactString(value, roots);
  if (Array.isArray(value)) return value.map((v) => walk(v, roots));
  if (value !== null && typeof value === "object") {
    // A class instance would lose its prototype here. Envelopes are plain
    // JSON — `JSON.stringify` would have flattened it anyway — so the copy
    // costs nothing that survived the write.
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[redactString(key, roots)] = walk(v, roots);
    }
    return out;
  }
  return value;
}

/**
 * The envelope as it goes to stdout: redacted, and carrying `runId` when the
 * environment named one.
 *
 * `runId` is attached only to an object envelope. Nothing in this CLI emits
 * an array or a bare value today, and a `runId` grafted onto one would be a
 * field a reader cannot address.
 */
export function envelope(
  payload: unknown,
  env: Record<string, string | undefined> = process.env,
  roots: RedactRoots = redactRoots(),
): unknown {
  const redacted = redactPaths(payload, roots);
  const runId = env[RUN_ID_ENV];
  if (
    runId === undefined ||
    runId === "" ||
    redacted === null ||
    typeof redacted !== "object" ||
    Array.isArray(redacted)
  ) {
    return redacted;
  }
  return { ...(redacted as Record<string, unknown>), runId };
}

function writeStdout(chunk: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

export async function applyEmit(
  result: CommandResult,
  jsonMode: boolean,
): Promise<void> {
  if (result.stderrLines) {
    for (const line of result.stderrLines) console.error(line);
  }
  if (jsonMode) {
    // Always print an object when in json mode, even if the command forgot —
    // agents must always get one parseable value.
    const payload =
      result.json !== undefined
        ? result.json
        : {
            ok: result.exitCode === 0,
            exitCode: result.exitCode,
            error:
              result.stderrLines?.join("\n") ||
              result.stdoutLines?.join("\n") ||
              undefined,
          };
    await writeStdout(JSON.stringify(envelope(payload)) + "\n");
    return;
  }
  if (result.stdoutLines) {
    for (const line of result.stdoutLines) console.log(line);
  }
}
