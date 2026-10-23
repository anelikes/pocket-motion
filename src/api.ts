/**
 * pocket-motion as a module: `import { render } from "pocket-motion"`.
 *
 * EVERY FUNCTION HERE IS A CLI INVOCATION THAT RETURNS INSTEAD OF WRITING.
 * The options become the argv the same invocation would have typed, the argv
 * goes through `dispatch` (`src/cli/main.ts`) — the parser, the command, the
 * conversion of a thrown error into `{ ok: false, error, exitCode }` — and
 * the result goes through `jsonPayload` and `envelope` (`src/cli/emit.ts`),
 * which are what `--json` writes. So `await trace(dir)` is the object
 * `trace <dir> --json` prints, including what that object does to it on the
 * way out: absolute paths redacted to `$REPO` and `$HOME`, and `runId` when
 * `MOTION_RUN_ID` is set. `tests/api.test.ts` holds each function equal to
 * the CLI run as a separate process on the same input.
 *
 * Nothing here re-derives a verdict, reshapes a section or adds a field.
 * A function that did would be a second implementation of the command, and
 * the second implementation is the one nobody tests — `verify`'s envelope is
 * held to the same rule for the same reason.
 *
 * WHAT IS NOT CARRIED OVER. The CLI writes diagnostics to stderr for a person
 * reading a terminal; these functions do not, because an embedding process's
 * stderr is not theirs to write to. Everything a caller can branch on is in
 * the object. The exit code is too, where the command has one to report:
 * a usage error is `{ ok: false, exitCode: 2 }`, a thrown failure
 * `{ ok: false, exitCode: 1 }`. No function throws for either; each resolves
 * with the object the CLI would have printed.
 *
 * BUN ONLY. The harness boots the guest in a Bun realm, spawns builds with
 * `Bun.spawn`, hashes with `Bun.CryptoHasher` and reads files with
 * `Bun.file`; under Node the first of those would fail somewhere deep and
 * unrelated. So the module refuses at import instead, and `package.json`
 * exports it under the `bun` condition only.
 */

import { envelope, jsonPayload } from "./cli/emit.ts";
import { dispatch } from "./cli/main.ts";
import type { DoctorReport } from "./cli/commands/doctor.ts";
import type { RenderJson } from "./cli/commands/render.ts";
import type { TraceJson } from "./cli/types.ts";
import type { BuildRecord } from "./render/build-record.ts";

if (typeof Bun === "undefined") {
  throw new Error(
    "pocket-motion runs on Bun only: the guest realm, the build spawn, the frame hash and " +
      "every file read are Bun APIs. Run this under bun (https://bun.sh), 1.3.11 or later.",
  );
}

/** Flags every composition command accepts — the CLI's shared flags. */
export interface CompositionFlags {
  /** Override the viewport width. */
  readonly width?: number;
  /** Override the viewport height. */
  readonly height?: number;
  /** Override fps; must divide 60. */
  readonly fps?: number;
  /** Override the duration, or the observation window. */
  readonly frames?: number;
  readonly supersample?: 1 | 2 | 4;
  /** Per-frame hash. Default `sha256`. */
  readonly hash?: "fast" | "sha256";
  /** A built guest bundle other than the default dist path. */
  readonly bundle?: string;
  /** A built asset pak other than the default dist path. */
  readonly pak?: string;
}

export interface RenderOptions extends CompositionFlags {
  /** The output file, or the directory for `png-seq`. Required unless `outDir` is. */
  readonly out?: string;
  /** A job spec file, or a directory of them (which takes `outDir`). */
  readonly spec?: string;
  /** Where one output per job goes, for a directory of specs. */
  readonly outDir?: string;
  readonly format?: "mp4" | "webm" | "mov" | "png-seq";
  /** Ask the codec for an alpha channel. Refused for mp4. */
  readonly alpha?: boolean;
}

export interface VerifyOptions extends CompositionFlags {
  /** How many layout frames. Mutually exclusive with `at`. */
  readonly samples?: number;
  /** Explicit layout frames. */
  readonly at?: readonly number[];
  /** Count layout warnings towards the verdict. */
  readonly strict?: boolean;
}

/** Present on every result when `MOTION_RUN_ID` is set. */
interface Run {
  readonly runId?: string;
}

/**
 * What any command prints when it was invoked wrongly (`exitCode: 2`) or
 * threw (`exitCode: 1`), and what a command's own failure path prints.
 */
export interface Refusal extends Run {
  readonly ok: false;
  readonly error: string;
  readonly exitCode?: number;
  readonly [key: string]: unknown;
}

export type BuildResult =
  | (Run & {
      readonly ok: true;
      readonly distDir: string;
      readonly bundlePath: string;
      readonly pakPath: string | null;
      readonly buildRecordPath: string;
      readonly buildRecord: BuildRecord;
    })
  | Refusal;

/**
 * `trace`'s failure path carries `frames: []` and `digest: ""` beside the
 * error rather than `ok: false` — it is the shape `diff` reads.
 */
export type TraceResult =
  | (Run & TraceJson)
  | (Run & { readonly frames: readonly string[]; readonly digest: ""; readonly error: string })
  | Refusal;

/** One render, or — for a directory of specs — one entry per job. */
export type RenderResult =
  | (Run & RenderJson)
  | (Run & {
      readonly ok: true;
      readonly jobs: readonly {
        readonly spec: string;
        readonly outputPath: string;
        readonly digest: string;
        readonly frames: number;
      }[];
    })
  | Refusal;

/** Each section is that command's own `--json` object, verbatim. */
export type VerifyResult =
  | (Run & {
      readonly ok: boolean;
      readonly strict: boolean;
      readonly errors: readonly string[];
      readonly warnings: number;
      readonly layoutFrames: readonly number[];
      readonly lint: unknown;
      readonly realm: unknown;
      readonly keyframes: unknown;
      readonly visibility: unknown;
      readonly layout: readonly unknown[];
      readonly assertions: unknown;
    })
  | Refusal;

export type DoctorResult = (Run & DoctorReport) | Refusal;

type Option = string | number | boolean | readonly number[] | undefined;

/**
 * The argv one call stands for, `--json` included. Each option is written
 * `--name=value`, so a value that starts with `--` cannot be read as the next
 * flag, and a `false` or absent option is left out exactly as an untyped flag
 * would be. Exported so a reader can see the command line a call is.
 */
export function argvOf(
  command: string,
  positional: string | undefined,
  options: Readonly<Record<string, Option>> = {},
): string[] {
  const argv = [command];
  if (positional !== undefined) argv.push(positional);
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === false) continue;
    const flag = `--${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
    if (value === true) argv.push(flag);
    else if (Array.isArray(value)) argv.push(`${flag}=${value.join(",")}`);
    else argv.push(`${flag}=${String(value)}`);
  }
  argv.push("--json");
  return argv;
}

async function call<T>(argv: readonly string[]): Promise<T> {
  const result = await dispatch(argv);
  if (result === "help") {
    // `argvOf` never writes `--help`; this is a call this module cannot make.
    throw new Error(`pocket-motion: ${argv.join(" ")} asked for help, which is not an envelope`);
  }
  return envelope(jsonPayload(result)) as T;
}

/** `build <dir> --json`: the bundle, the pak, and `build.json` beside them. */
export function build(dir: string, options: CompositionFlags = {}): Promise<BuildResult> {
  return call(argvOf("build", dir, { ...options }));
}

/** `trace <dir> --json`: the per-frame hashes, their digest, and input identity. */
export function trace(dir: string, options: CompositionFlags = {}): Promise<TraceResult> {
  return call(argvOf("trace", dir, { ...options }));
}

/**
 * `render <dir> --out <file> --json`, or with `spec` a job rendered from the
 * composition's generator. `outputPath` is the file; `digest` and `identity`
 * are the values `trace` reports. A `--spec` job carries no `identity`:
 * it builds in a staged directory whose name is random and lands in the
 * build record, so the same job would report a different one every run.
 */
export function render(dir: string, options: RenderOptions): Promise<RenderResult> {
  return call(argvOf("render", dir, { ...options }));
}

/** `verify <dir> --json`: lint, check, keyframes, visibility, layout and assert in one envelope. */
export function verify(dir: string, options: VerifyOptions = {}): Promise<VerifyResult> {
  return call(argvOf("verify", dir, { ...options }));
}

/**
 * `doctor --json`: can this installation build and render at all, and which
 * command fixes each thing that cannot. The verdict is `ok`; like the CLI's
 * `--json`, it resolves rather than rejecting when a check fails.
 */
export function doctor(): Promise<DoctorResult> {
  return call(argvOf("doctor", undefined));
}
