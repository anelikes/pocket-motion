#!/usr/bin/env bun
/**
 * pocket-motion CLI entry.
 *
 *   bun src/cli/main.ts <command> [args]
 *   bun run motion -- <command> [args]
 *
 * Every command answers one assertable question and supports --json.
 * No command requires a browser.
 */

import { FLAG_COMMAND, UsageError, parseArgs } from "./args.ts";
import { applyEmit } from "./emit.ts";
import * as assertCmd from "./commands/assert.ts";
import * as buildCmd from "./commands/build.ts";
import * as checkCmd from "./commands/check.ts";
import * as concatCmd from "./commands/concat.ts";
import * as diffCmd from "./commands/diff.ts";
import * as frameCmd from "./commands/frame.ts";
import * as keyframesCmd from "./commands/keyframes.ts";
import * as layoutCmd from "./commands/layout.ts";
import * as lintCmd from "./commands/lint.ts";
import * as renderCmd from "./commands/render.ts";
import * as previewCmd from "./commands/preview.ts";
import * as snapshotCmd from "./commands/snapshot.ts";
import * as soundCmd from "./commands/sound.ts";
import * as traceCmd from "./commands/trace.ts";
import * as verifyCmd from "./commands/verify.ts";
import * as visibilityCmd from "./commands/visibility.ts";
import * as doctorCmd from "./commands/doctor.ts";
import * as initCmd from "./commands/init.ts";
import * as mcpCmd from "./commands/mcp.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  type CommandResult,
  type ExitCode,
  type RunContext,
} from "./types.ts";

const COMMANDS: Record<
  string,
  {
    readonly summary: string;
    /** The command line, as the first line of the command file's header
     *  states it (`tests/cli.test.ts` holds the two equal). */
    readonly usage: string;
    readonly run: (argv: readonly string[], context: RunContext) => Promise<CommandResult>;
  }
> = {
  lint: {
    summary: "is the sidecar valid and is the source mount-only?",
    usage: "lint <composition-dir>",
    run: (argv) => lintCmd.runFromArgv(argv),
  },
  check: {
    summary: "does it boot, is the realm clean, is it mount-only at runtime?",
    usage: "check <composition-dir>",
    run: (argv) => checkCmd.runFromArgv(argv),
  },
  build: {
    summary:
      "build the bundle and pak, and record the toolchain that produced them in build.json",
    usage: "build <composition-dir>",
    run: (argv) => buildCmd.runFromArgv(argv),
  },
  render: {
    summary:
      "produce the video (--out file.mp4); --workers N splits it over N processes, --range A..B renders one segment",
    usage: "render <composition-dir> --out <file.mp4>",
    run: (argv, context) => renderCmd.runFromArgv(argv, context),
  },
  concat: {
    summary:
      "join `render --range` segments into one film (--out file.mp4): refuses mixed identity, gaps and overlaps; muxes sound once",
    usage: "concat <composition-dir> <segment>... --out <file>",
    run: (argv, context) => concatCmd.runFromArgv(argv, context),
  },
  trace: {
    summary: "the frame-hash sequence + digest",
    usage: "trace <composition-dir>",
    run: (argv, context) => traceCmd.runFromArgv(argv, context),
  },
  frame: {
    summary: "one frame as a PNG (--at N --out file.png)",
    usage: "frame <composition-dir> --at N --out <file.png>",
    run: (argv) => frameCmd.runFromArgv(argv),
  },
  diff: {
    summary: "first divergent frame index between two traces, or none",
    usage: "diff <trace-a.json> <trace-b.json>",
    run: (argv) => diffCmd.runFromArgv(argv),
  },
  layout: {
    summary: "where every node landed, how big, and whether it is in the picture (--at N)",
    usage: "layout <composition-dir> --at <frame>",
    run: (argv) => layoutCmd.runFromArgv(argv),
  },
  visibility: {
    summary:
      "over sampled frames: is a node you named never once shown? (--samples N)",
    usage: "visibility <composition-dir> [--samples N]",
    run: (argv) => visibilityCmd.runFromArgv(argv),
  },
  keyframes: {
    summary:
      "the baked animation timelines, and which declared instants fall between rendered frames",
    usage: "keyframes <composition-dir>",
    run: (argv) => keyframesCmd.runFromArgv(argv),
  },
  sound: {
    summary:
      "what the sidecar declares for sound, and whether each file is on disk; --verify <file> checks each declared element contributed to the mix",
    usage: "sound <composition-dir>",
    run: (argv) => soundCmd.runFromArgv(argv),
  },
  preview: {
    summary: "player at /watch; frame debugger at / — same host that hashes it",
    usage: "preview <composition-dir>",
    run: (argv) => previewCmd.runFromArgv(argv),
  },
  doctor: {
    summary:
      "can this checkout build and render at all? (--json always exits 0; ok is in the payload)",
    usage: "doctor",
    run: (argv) => doctorCmd.runFromArgv(argv),
  },
  init: {
    summary: "start a composition from a fixture (--example smoke|copy|footage-tracks|sound-roles)",
    usage: "init <dir> --example smoke|copy|footage-tracks|sound-roles",
    run: (argv) => initCmd.runFromArgv(argv),
  },
  verify: {
    summary:
      "lint + check + keyframes + visibility + layout + assertions, in one --json envelope",
    usage: "verify <composition-dir>",
    run: (argv) => verifyCmd.runFromArgv(argv),
  },
  assert: {
    summary:
      "does the film do what the sidecar's assertions[] say it should? (--samples N)",
    usage: "assert <composition-dir> [--samples N]",
    run: (argv) => assertCmd.runFromArgv(argv),
  },
  snapshot: {
    summary:
      "PNGs at sampled frames (--out dir), optionally with layout's boxes and finding codes drawn over them (--annotate)",
    usage: "snapshot <composition-dir> --out <dir> [--samples N | --at a,b,c]",
    run: (argv) => snapshotCmd.runFromArgv(argv),
  },
  mcp: {
    summary:
      "serve render, verify, assert, layout, trace and doctor as MCP tools on stdin/stdout",
    usage: "mcp",
    run: (argv) => mcpCmd.runFromArgv(argv),
  },
};

/**
 * Every flag's help, keyed by the flag name `FLAG_COMMAND` (`args.ts`) uses,
 * so a command's own help lists exactly the flags its parser hands it. A
 * flag `FLAG_COMMAND` does not name is shared by every command.
 */
const FLAG_HELP: readonly (readonly [string, readonly string[]])[] = [
  ["json", ["--json              one JSON object on stdout; diagnostics on stderr"]],
  ["width", ["--width N           override viewport width"]],
  ["height", ["--height N          override viewport height"]],
  ["fps", ["--fps N             override fps (must divide 60)"]],
  ["frames", ["--frames N          override duration / observation window"]],
  ["supersample", ["--supersample 1|2|4 override supersample factor"]],
  ["hash", ["--hash fast|sha256  per-frame hash (default sha256; fast is ~1.5x end to end)"]],
  ["bundle", ["--bundle <path>     built guest bundle (.js)"]],
  ["pak", ["--pak <path>        built asset pak (.pak)"]],
  ["out", ["--out <path>        frame/snapshot/render/concat: the file (or snapshot's directory) to write"]],
  ["at", ["--at N              frame/layout: the frame; snapshot/verify: a,b,c — the frames to read"]],
  ["verify", ["--verify <file>     sound: did each declared element contribute to this mix?"]],
  [
    "spec",
    [
      "--spec <file>       render/preview: one job spec JSON (stage, generate, build)",
      "--spec <dir>        render: one JSON file per job; requires --out-dir",
    ],
  ],
  ["out-dir", ["--out-dir <dir>     render: write one mp4 per --spec directory entry"]],
  ["port", ["--port N            preview listen port (default 8741; 0 = ephemeral)"]],
  ["bind", ["--bind <addr>       preview bind address (default 127.0.0.1)"]],
  ["no-open", ["--no-open           preview: print the URL, do not open a browser"]],
  ["no-watch", ["--no-watch          preview: do not rebuild and reopen on a source change"]],
  ["example", ["--example <name>    init: which fixture to start from"]],
  ["format", ["--format <name>     render: mp4 | webm | mov | png-seq (default mp4)"]],
  ["alpha", ["--alpha             render: ask the codec for an alpha channel (not mp4)"]],
  ["encoder", ["--encoder <name>    render mp4: libx264 (default) or h264_videotoolbox (macOS hardware)"]],
  ["preset", ["--preset <name>     render mp4: libx264's preset (default medium)"]],
  [
    "no-assert",
    [
      "--no-assert         render --spec: skip the job's own assertions[], which are",
      "                    otherwise checked on its staged tree before it renders",
    ],
  ],
  ["no-reuse", ["--no-reuse          render/trace: rasterise every frame, held ones included"]],
  ["workers", ["--workers N         render: N `render --range` processes, joined and read back"]],
  ["range", ["--range A..B        render: frames A to B (both included) as a segment for concat"]],
  ["samples", ["--samples N         visibility/snapshot/assert/verify: how many frames to look at (default 24)"]],
  [
    "read",
    [
      "--read exposure|tick layout/visibility/assert/verify, under a shutter: classify",
      "                    the delivered exposure (default) or the frame's own tick",
    ],
  ],
  ["annotate", ["--annotate          snapshot: also write a copy with layout's boxes drawn on it"]],
  ["zoom", ["--zoom <debugName>  snapshot: also write a crop around that node"]],
  ["strict", ["--strict            verify: count warnings towards the exit code"]],
  ["all", ["--all               keyframes/layout/visibility: list every entry, not a summary"]],
];

const EXIT_LINES = [
  "Exit codes:",
  "  0  clean",
  "  1  check failed (lint findings, non-mount-only, divergence)",
  "  2  invocation wrong (bad flags, missing file)",
];

/**
 * `--help`: every command and every flag; `<command> --help`: that command's
 * line, its own flags and the shared ones. A command that is not one gets the
 * whole text.
 */
export function helpText(command?: string): string {
  const flagLines = (keep: (name: string) => boolean) =>
    FLAG_HELP.filter(([name]) => keep(name)).flatMap(([, lines]) => lines.map((l) => `  ${l}`));
  const shared = (name: string) => FLAG_COMMAND[name] === undefined;
  const cmd = command === undefined ? undefined : COMMANDS[command];
  if (cmd && command) {
    const own = flagLines((name) => FLAG_COMMAND[name]?.includes(command) === true);
    return [
      `pocket-motion ${command} — ${cmd.summary}`,
      "",
      "Usage:",
      `  bun src/cli/main.ts ${cmd.usage} [--json]`,
      ...(own.length ? ["", "Flags:", ...own] : []),
      "",
      "Shared flags:",
      ...flagLines(shared),
      "",
      ...EXIT_LINES,
      "",
      "`bun src/cli/main.ts --help` lists every command.",
    ].join("\n");
  }
  const lines = [
    "pocket-motion — deterministic video rendering for PocketJS (no browser)",
    "",
    "Usage:",
    "  bun src/cli/main.ts <command> [args] [--json] [flags]",
    "  bun src/cli/main.ts <command> --help",
    "",
    "Commands:",
  ];
  for (const name of Object.keys(COMMANDS)) {
    const summary = COMMANDS[name]!.summary;
    lines.push(`  ${name.padEnd(11)} ${summary}`);
  }
  lines.push("", "Shared flags:", ...flagLines(() => true), "", ...EXIT_LINES);
  return lines.join("\n");
}

/**
 * One command line to the result it produced, written nowhere.
 *
 * Everything between the argv and the bytes `main` writes: parsing, the
 * command lookup, the command itself, and the conversion of a thrown error
 * into the `{ ok: false, error, exitCode }` result a usage error or a failure
 * prints. `src/api.ts` calls this and `main` calls this, so an API call and a
 * CLI invocation with the same argv run the same code up to the point where
 * one writes the object and the other returns it. `"help"` is returned rather
 * than a result because help is the one output that is not an envelope.
 *
 * `context` is what an embedding caller adds and an argv cannot carry — a
 * cancel signal and a progress callback (`RunContext`). The CLI passes none.
 */
export async function dispatch(
  argv: readonly string[],
  context: RunContext = {},
): Promise<CommandResult | "help"> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.flags.help === true) return "help";

    const name = parsed.command;
    if (!name) {
      throw new UsageError("missing command — try --help");
    }
    const cmd = COMMANDS[name];
    if (!cmd) {
      throw new UsageError(
        `unknown command ${JSON.stringify(name)} — try --help`,
      );
    }

    // Re-pass original argv without the command token so each command's
    // parseArgs sees its own positionals + flags.
    const rest = argv.slice(argv.indexOf(name) + 1);
    return await cmd.run(rest, context);
  } catch (e) {
    if (e instanceof UsageError) {
      return {
        exitCode: EXIT_USAGE,
        json: { ok: false, error: e.message, exitCode: EXIT_USAGE },
        stderrLines: [e.message],
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message, exitCode: EXIT_FAIL },
      stderrLines: [message],
    };
  }
}

/**
 * Programmatic entry used by tests and by the process main.
 * Returns the exit code; does not call process.exit.
 */
export async function main(argv: readonly string[]): Promise<ExitCode> {
  // Help with no args or explicit --help / help
  if (
    argv.length === 0 ||
    argv[0] === "--help" ||
    argv[0] === "help" ||
    argv[0] === "-h"
  ) {
    console.log(helpText());
    return EXIT_OK;
  }

  // Pre-scan for --json so usage errors can still emit JSON when asked.
  const jsonMode = argv.includes("--json") || argv.some((a) => a === "--json=true");
  const result = await dispatch(argv);
  if (result === "help") {
    console.log(helpText(parseArgs(argv).command));
    return EXIT_OK;
  }
  await applyEmit(result, jsonMode);
  if (result.keepAlive) await result.keepAlive;
  return result.exitCode;
}

// Process entry — only when executed directly.
if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
