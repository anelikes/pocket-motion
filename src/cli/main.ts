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

import { UsageError, parseArgs } from "./args.ts";
import { applyEmit } from "./emit.ts";
import * as assertCmd from "./commands/assert.ts";
import * as buildCmd from "./commands/build.ts";
import * as checkCmd from "./commands/check.ts";
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
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  type CommandResult,
  type ExitCode,
} from "./types.ts";

const COMMANDS: Record<
  string,
  {
    readonly summary: string;
    readonly run: (argv: readonly string[]) => Promise<CommandResult>;
  }
> = {
  lint: {
    summary: "is the sidecar valid and is the source mount-only?",
    run: (argv) => lintCmd.runFromArgv(argv),
  },
  check: {
    summary: "does it boot, is the realm clean, is it mount-only at runtime?",
    run: (argv) => checkCmd.runFromArgv(argv),
  },
  build: {
    summary:
      "build the bundle and pak, and record the toolchain that produced them in build.json",
    run: (argv) => buildCmd.runFromArgv(argv),
  },
  render: {
    summary: "produce the video (--out file.mp4)",
    run: (argv) => renderCmd.runFromArgv(argv),
  },
  trace: {
    summary: "the frame-hash sequence + digest",
    run: (argv) => traceCmd.runFromArgv(argv),
  },
  frame: {
    summary: "one frame as a PNG (--at N --out file.png)",
    run: (argv) => frameCmd.runFromArgv(argv),
  },
  diff: {
    summary: "first divergent frame index between two traces, or none",
    run: (argv) => diffCmd.runFromArgv(argv),
  },
  layout: {
    summary: "where every node landed, how big, and whether it is in the picture (--at N)",
    run: (argv) => layoutCmd.runFromArgv(argv),
  },
  visibility: {
    summary:
      "over sampled frames: is a node you named never once shown? (--samples N)",
    run: (argv) => visibilityCmd.runFromArgv(argv),
  },
  keyframes: {
    summary:
      "the baked animation timelines, and which declared instants fall between rendered frames",
    run: (argv) => keyframesCmd.runFromArgv(argv),
  },
  sound: {
    summary:
      "what the sidecar declares for sound, and whether each file is on disk; --verify <file> checks each declared element contributed to the mix",
    run: (argv) => soundCmd.runFromArgv(argv),
  },
  preview: {
    summary: "player at /watch; frame debugger at / — same host that hashes it",
    run: (argv) => previewCmd.runFromArgv(argv),
  },
  doctor: {
    summary:
      "can this checkout build and render at all? (--json always exits 0; ok is in the payload)",
    run: (argv) => doctorCmd.runFromArgv(argv),
  },
  init: {
    summary: "start a composition from a fixture (--example smoke|copy|footage-tracks|sound-roles)",
    run: (argv) => initCmd.runFromArgv(argv),
  },
  verify: {
    summary:
      "lint + check + keyframes + visibility + layout + assertions, in one --json envelope",
    run: (argv) => verifyCmd.runFromArgv(argv),
  },
  assert: {
    summary:
      "does the film do what the sidecar's assertions[] say it should? (--samples N)",
    run: (argv) => assertCmd.runFromArgv(argv),
  },
  snapshot: {
    summary:
      "PNGs at sampled frames (--out dir), optionally with layout's boxes and finding codes drawn over them (--annotate)",
    run: (argv) => snapshotCmd.runFromArgv(argv),
  },
};

export function helpText(): string {
  const lines = [
    "pocket-motion — deterministic video rendering for PocketJS (no browser)",
    "",
    "Usage:",
    "  bun src/cli/main.ts <command> [args] [--json] [flags]",
    "",
    "Commands:",
  ];
  for (const name of Object.keys(COMMANDS)) {
    const summary = COMMANDS[name]!.summary;
    lines.push(`  ${name.padEnd(11)} ${summary}`);
  }
  lines.push(
    "",
    "Shared flags:",
    "  --json              one JSON object on stdout; diagnostics on stderr",
    "  --width N           override viewport width",
    "  --height N          override viewport height",
    "  --fps N             override fps (must divide 60)",
    "  --frames N          override duration / observation window",
    "  --supersample 1|2|4 override supersample factor",
    "  --hash fast|sha256  per-frame hash (default sha256; fast is ~1.5x end to end)",
    "  --bundle <path>     built guest bundle (.js)",
    "  --pak <path>        built asset pak (.pak)",
    "  --verify <file>     sound: did each declared element contribute to this mix?",
    "  --spec <file>       render/preview: one job spec JSON (stage, generate, build)",
    "  --spec <dir>        render: one JSON file per job; requires --out-dir",
    "  --out-dir <dir>     render: write one mp4 per --spec directory entry",
    "  --port N            preview listen port (default 8741; 0 = ephemeral)",
    "  --bind <addr>       preview bind address (default 127.0.0.1)",
    "  --no-open           preview: print the URL, do not open a browser",
    "  --no-watch          preview: do not rebuild and reopen on a source change",
    "  --example <name>    init: which fixture to start from",
    "  --format <name>     render: mp4 | webm | mov | png-seq (default mp4)",
    "  --alpha             render: ask the codec for an alpha channel (not mp4)",
    "  --samples N         visibility/snapshot: how many frames to look at (default 24)",
    "  --annotate          snapshot: also write a copy with layout's boxes drawn on it",
    "  --zoom <debugName>  snapshot: also write a crop around that node",
    "  --strict            verify: count warnings towards the exit code",
    "  --all               keyframes/layout/visibility: list every entry, not a summary",
    "",
    "Exit codes:",
    "  0  clean",
    "  1  check failed (lint findings, non-mount-only, divergence)",
    "  2  invocation wrong (bad flags, missing file)",
  );
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
 */
export async function dispatch(argv: readonly string[]): Promise<CommandResult | "help"> {
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
    return await cmd.run(rest);
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
    console.log(helpText());
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
