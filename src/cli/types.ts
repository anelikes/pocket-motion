/**
 * Shared CLI types: exit codes, command results, global flags.
 *
 * Exit codes are an agent branch surface:
 *   0 — clean
 *   1 — the check failed (findings, non-mount-only, divergence)
 *   2 — the invocation itself was wrong (bad flags, missing file)
 */

import type { SidecarShutter } from "../manifest/sidecar.ts";
import type { HashAlgorithm } from "../render/hash.ts";
import type { InputIdentity } from "../render/identity.ts";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

export type ExitCode = typeof EXIT_OK | typeof EXIT_FAIL | typeof EXIT_USAGE;

/** Result of a command's `run()`. Callers (main + tests) map this to process.exit. */
export interface CommandResult {
  readonly exitCode: ExitCode;
  /**
   * Human-readable lines for stdout when `--json` is absent.
   * Diagnostics always go to stderr via the runner, never mixed into this.
   */
  readonly stdoutLines?: readonly string[];
  /**
   * The single object printed when `--json` is set. Must be one parseable
   * JSON value and nothing else on stdout.
   */
  readonly json?: unknown;
  /** Lines written to stderr in both modes (findings, progress, errors). */
  readonly stderrLines?: readonly string[];
  /**
   * When set, `main` emits the result and then waits here before exiting.
   * Preview holds the HTTP server open; other commands omit this.
   */
  readonly keepAlive?: Promise<void>;
}

/** Flags common to composition-driving commands. */
export interface GlobalFlags {
  readonly json: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly frames?: number;
  readonly supersample?: number;
  /** Per-frame hash. Absent means the default, `sha256`. */
  readonly hash?: HashAlgorithm;
  readonly bundle?: string;
  readonly pak?: string;
}

/**
 * Trace JSON shape — the contract between `trace --json` and `diff`.
 * `digest` is the frame-sequence hash and is what `diff` and the ledger
 * compare. `identity` is the input hash; older traces omit it and `diff`
 * still accepts them.
 */
export interface TraceJson {
  readonly frames: readonly string[];
  readonly digest: string;
  readonly identity?: InputIdentity;
  /** Present exactly when the sidecar declares one: the digest is then of
   *  the exposures, and says which. */
  readonly shutter?: SidecarShutter;
}

export function isTraceJson(value: unknown): value is TraceJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.digest !== "string") return false;
  if (!Array.isArray(v.frames)) return false;
  return v.frames.every((h) => typeof h === "string");
}
