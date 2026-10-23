/**
 * Minimal flag parser — no deps. Supports:
 *   --flag            boolean true
 *   --flag=value      string/number value
 *   --flag value      string/number value (next argv token)
 *   positional args
 */

import type { HashAlgorithm } from "../render/hash.ts";
import { EXIT_USAGE, type ExitCode, type GlobalFlags } from "./types.ts";

export class UsageError extends Error {
  readonly exitCode: ExitCode = EXIT_USAGE;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface ParsedArgs {
  readonly command: string | undefined;
  readonly positionals: string[];
  readonly flags: Record<string, string | boolean>;
  readonly global: GlobalFlags;
}

const GLOBAL_BOOL = new Set(["json", "all"]);
const GLOBAL_VALUE = new Set([
  "width",
  "height",
  "fps",
  "frames",
  "supersample",
  "hash",
  "bundle",
  "pak",
  "out",
  "at",
  "help",
]);

/** Command-specific booleans. Must be listed here so `--no-open` is not parsed as a value flag. */
const COMMAND_BOOL = new Set(["no-open", "no-watch", "alpha", "annotate", "strict"]);

/** All known flag names (global + command-specific) so unknown flags exit 2. */
const KNOWN_FLAGS = new Set([
  ...GLOBAL_BOOL,
  ...GLOBAL_VALUE,
  ...COMMAND_BOOL,
  "verify",
  "spec",
  "port",
  "bind",
  "samples",
  "read",
  "out-dir",
  "example",
  "format",
  "zoom",
  // keep room for future command flags without expanding GLOBAL_*
]);

/**
 * Flags that parse globally so `--no-open` is boolean, but belong to named
 * commands. `--out` and `--at` have two owners each; a single-string map
 * cannot refuse `trace --out` without also refusing `frame --out`.
 */
const FLAG_COMMAND: Record<string, readonly string[]> = {
  spec: ["render", "preview"],
  "out-dir": ["render"],
  verify: ["sound"],
  port: ["preview"],
  bind: ["preview"],
  "no-open": ["preview"],
  "no-watch": ["preview"],
  out: ["frame", "render", "snapshot"],
  at: ["frame", "layout", "snapshot", "verify"],
  samples: ["visibility", "snapshot", "assert", "verify"],
  read: ["layout", "visibility", "assert", "verify"],
  all: ["keyframes", "layout", "visibility"],
  example: ["init"],
  format: ["render"],
  alpha: ["render"],
  annotate: ["snapshot"],
  zoom: ["snapshot"],
  strict: ["verify"],
};

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        const name = tok.slice(2, eq);
        const value = tok.slice(eq + 1);
        assertKnown(name);
        flags[name] = value;
        i++;
        continue;
      }
      const name = tok.slice(2);
      assertKnown(name);
      if (GLOBAL_BOOL.has(name) || COMMAND_BOOL.has(name) || name === "help") {
        flags[name] = true;
        i++;
        continue;
      }
      // value flag: next token must be the value
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`flag --${name} requires a value`);
      }
      flags[name] = next;
      i += 2;
      continue;
    }
    if (tok.startsWith("-") && tok.length === 2) {
      throw new UsageError(`short flags are not supported: ${tok}`);
    }
    if (command === undefined) {
      command = tok;
    } else {
      positionals.push(tok);
    }
    i++;
  }

  if (command) {
    for (const [flag, owners] of Object.entries(FLAG_COMMAND)) {
      if (flags[flag] !== undefined && !owners.includes(command)) {
        throw new UsageError(`--${flag} is only accepted by ${orList(owners)}`);
      }
    }
  }

  return {
    command,
    positionals,
    flags,
    global: extractGlobal(flags),
  };
}

function orList(owners: readonly string[]): string {
  if (owners.length === 1) return owners[0]!;
  return `${owners.slice(0, -1).join(", ")} or ${owners.at(-1)}`;
}

function assertKnown(name: string): void {
  if (!KNOWN_FLAGS.has(name)) {
    throw new UsageError(`unknown flag --${name}`);
  }
}

function extractGlobal(flags: Record<string, string | boolean>): GlobalFlags {
  return {
    json: flags.json === true,
    width: optionalInt(flags, "width"),
    height: optionalInt(flags, "height"),
    fps: optionalInt(flags, "fps"),
    frames: optionalInt(flags, "frames"),
    supersample: optionalInt(flags, "supersample"),
    hash: hashAlgorithm(flags),
    bundle: optionalString(flags, "bundle"),
    pak: optionalString(flags, "pak"),
  };
}

/**
 * `--hash fast|sha256`. Absent means `sha256`.
 *
 * `fast` is wyhash per frame with the sequence digest still SHA-256. It is a
 * 1.50x end-to-end win because the oracle was costing more than twice the
 * rasteriser, and it is verified equal across darwin/arm64, linux/x64 and Bun
 * 1.1 through 1.3 (`baselines/hash-portability.md`). The default stays sha256
 * anyway: every digest recorded in baselines/ is a SHA-256 one, and wyhash is
 * Bun's implementation detail rather than a standard, so an archival digest
 * should not depend on it.
 */
function hashAlgorithm(flags: Record<string, string | boolean>): HashAlgorithm | undefined {
  const raw = optionalString(flags, "hash");
  if (raw === undefined) return undefined;
  if (raw !== "fast" && raw !== "sha256") {
    throw new UsageError(`--hash must be fast or sha256; got ${raw}`);
  }
  return raw;
}

/** Flags that would patch a job's declared render parameters. */
const JOB_PATCH_FLAGS = ["frames", "fps", "width", "height", "supersample"] as const;

/** A job is a complete object. CLI flags that move pixels are refused with `--spec`. */
export function refuseJobPatches(flags: GlobalFlags, specSet: boolean): void {
  if (!specSet) return;
  if (flags.bundle !== undefined || flags.pak !== undefined) {
    throw new UsageError("--bundle/--pak cannot be used with --spec; a job builds into its own tree");
  }
  for (const name of JOB_PATCH_FLAGS) {
    if (flags[name] !== undefined) {
      throw new UsageError(
        `--${name} cannot override a job spec; put the value in the JSON`,
      );
    }
  }
}

export function optionalString(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new UsageError(`flag --${name} requires a string value`);
  }
  return v;
}

export function requireString(
  flags: Record<string, string | boolean>,
  name: string,
): string {
  const v = optionalString(flags, name);
  if (v === undefined) {
    throw new UsageError(`flag --${name} is required`);
  }
  return v;
}

export function optionalInt(
  flags: Record<string, string | boolean>,
  name: string,
): number | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new UsageError(`flag --${name} requires an integer value`);
  }
  if (!/^-?\d+$/.test(v)) {
    throw new UsageError(`flag --${name} must be an integer; got ${JSON.stringify(v)}`);
  }
  return Number(v);
}

export function requireInt(
  flags: Record<string, string | boolean>,
  name: string,
): number {
  const v = optionalInt(flags, name);
  if (v === undefined) {
    throw new UsageError(`flag --${name} is required`);
  }
  return v;
}

export function requirePositional(
  positionals: readonly string[],
  index: number,
  name: string,
): string {
  const v = positionals[index];
  if (v === undefined) {
    throw new UsageError(`missing required argument: ${name}`);
  }
  return v;
}
