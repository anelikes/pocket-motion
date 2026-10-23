/**
 * `verify <composition-dir>`
 * Question: does every gate this repository has pass on this composition?
 *
 * Six commands, in one order, into one JSON object:
 *
 *   lint        the sidecar is valid, the source is mount-only, every
 *               referenced image is on disk
 *   realm       `check`: it boots, the realm is clean, no guest ops
 *   keyframes   the baked timelines, and whether any of them can never play
 *   visibility  over sampled frames: is a node you named never shown, or shown
 *               and then buried
 *   layout      the boxes and the finding codes, at sampled frames
 *   assertions  `assert`: does the sidecar's `assertions[]` hold
 *
 * EACH SECTION IS THE SUB-COMMAND'S OWN JSON, verbatim. Not a summary of it,
 * not a re-shaped version of it — the same object `lint --json` prints, under
 * the key `lint`. `tests/verify.test.ts` compares them field by field against
 * the sub-commands run alone, because an envelope that quietly reformatted a
 * section would be a second implementation of every gate in it, and the second
 * one is the one nobody tests.
 *
 * `MOTION_RUN_ID` is echoed as `runId` — by `applyEmit`, which does it for
 * every `--json` envelope this CLI writes rather than once per command. This
 * one only reads it for the human line.
 *
 * WHAT DECIDES THE EXIT CODE. An ERROR is a section whose own verdict is
 * false: a lint finding, a dirty realm, a timeline that can never play, a named
 * node never shown, a failing assertion. A WARNING is an active `layout`
 * finding — `layout` exits 0 carrying those and this does too, because a node
 * outside its window is not painted and an intended lower third does overlap
 * the shot under it. `--strict` makes the warnings count as well.
 *
 * THE GRIDS ARE NOT THE SAME AND THAT IS DELIBERATE. `--samples N` and
 * `--at a,b,c` decide the LAYOUT frames, because that is the section where a
 * frame costs a boot; `visibility` and `assert` sweep their own default grid,
 * so their sections are comparable to those commands run alone. The layout
 * default is small for the same reason — five frames, named in the output.
 *
 * WHAT IT COSTS. Every section that boots, boots: `check`, `visibility`,
 * `assert`, and one per sampled layout frame. On a fixture that is seconds. On
 * a composition at film length it is minutes, and lowering `--samples` is the
 * lever for the layout frames. Under a shutter `--read tick` is the other: it
 * reaches `visibility`, `layout` and `assert` alike, each section's `read`
 * says so, and so does the envelope beside `shutter`.
 */

import { UsageError, parseArgs, requirePositional } from "../args.ts";
import type { Reading } from "../../render/visibility.ts";
import { describeShutter } from "../../runtime/boot.ts";
import { RUN_ID_ENV } from "../emit.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";
import * as assertCmd from "./assert.ts";
import * as checkCmd from "./check.ts";
import * as keyframesCmd from "./keyframes.ts";
import * as layoutCmd from "./layout.ts";
import { parseRead, shutterJson } from "./layout.ts";
import * as lintCmd from "./lint.ts";
import { parseFrameList } from "./snapshot.ts";
import { parseSamples, sampleFrames } from "./visibility.ts";
import * as visibilityCmd from "./visibility.ts";

/**
 * Layout frames when nobody says.
 *
 * Five rather than `visibility`'s 24 because a layout frame costs a boot and a
 * probe per node, and this command already boots four other times. It is named
 * in the printed line so the number is never inherited silently.
 */
export const DEFAULT_LAYOUT_SAMPLES = 5;

export interface VerifyOptions {
  readonly dir: string;
  /** Explicit layout frames. Mutually exclusive with `samples`. */
  readonly at?: readonly number[];
  /** How many layout frames. */
  readonly samples?: number;
  /** Count warnings towards the exit code. */
  readonly strict: boolean;
  /** Under a declared shutter, the picture the pixel sections classify.
   *  Absent means the exposure. */
  readonly read?: Reading;
  readonly flags: GlobalFlags;
}

/** One section's result and what it contributed to the verdict. */
interface Section {
  readonly name: string;
  readonly json: unknown;
  readonly ok: boolean;
}

/** A sub-command that threw rather than returning — a missing artifact, say.
 *  Recorded as that section's failure so the other five still report. */
function thrown(e: unknown): { ok: false; error: string } {
  return { ok: false, error: errMsg(e) };
}

async function section(
  name: string,
  run: () => Promise<CommandResult>,
): Promise<Section> {
  try {
    const result = await run();
    const json = result.json;
    const ok =
      typeof json === "object" && json !== null && "ok" in json
        ? (json as { ok: unknown }).ok === true
        : result.exitCode === EXIT_OK;
    return { name, json, ok };
  } catch (e) {
    return { name, json: thrown(e), ok: false };
  }
}

export async function run(options: VerifyOptions): Promise<CommandResult> {
  if (options.at !== undefined && options.samples !== undefined) {
    throw new UsageError("--at and --samples name the same thing two ways; pass one");
  }

  // Resolved once up front so a wrong directory or a missing bundle is a usage
  // error carrying the build command, rather than the same message repeated in
  // six sections.
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: true,
  });
  if (!resolved.ok && resolved.kind === "usage") {
    throw new UsageError(resolved.message);
  }
  // A sidecar that will not parse is not a usage error: `lint` is the command
  // that reports it, and the envelope should carry its diagnostics.
  const durationFrames = resolved.ok ? resolved.value.durationFrames : 1;
  const shutter = resolved.ok ? resolved.value.shutter : null;

  const layoutFrames =
    options.at ??
    sampleFrames(durationFrames, options.samples ?? DEFAULT_LAYOUT_SAMPLES);
  for (const f of layoutFrames) {
    if (f >= durationFrames) {
      throw new UsageError(`--at ${f} is out of range [0, ${durationFrames})`);
    }
  }

  const flags = options.flags;
  const dir = options.dir;
  const read = options.read ? { read: options.read } : {};

  const lint = await section("lint", () => lintCmd.run({ dir, flags }));
  const realm = await section("realm", () => checkCmd.run({ dir, flags }));
  const keyframes = await section("keyframes", () =>
    keyframesCmd.run({ dir, flags, all: false }),
  );
  const visibility = await section("visibility", () =>
    visibilityCmd.run({ dir, all: false, ...read, flags }),
  );

  const layouts: unknown[] = [];
  let layoutOk = true;
  for (const at of layoutFrames) {
    const one = await section(`layout@${at}`, () =>
      layoutCmd.run({ dir, at, all: false, ...read, flags }),
    );
    layouts.push(one.json);
    if (!one.ok) layoutOk = false;
  }

  const assertions = await section("assertions", () => assertCmd.run({ dir, ...read, flags }));

  const sections: Section[] = [
    lint,
    realm,
    keyframes,
    visibility,
    { name: "layout", json: layouts, ok: layoutOk },
    assertions,
  ];
  const errors = sections.filter((s) => !s.ok).map((s) => s.name);

  // A warning is an active layout finding. `layout` exits 0 carrying them and
  // so does this; `--strict` is what makes them count.
  const warnings = countWarnings(layouts);

  const ok = errors.length === 0 && (!options.strict || warnings === 0);
  // `runId` is NOT attached here. `applyEmit` puts it on every `--json`
  // envelope this CLI writes, so a second copy in this one would be the same
  // rule in two places — and the second place is the one that goes stale. The
  // HUMAN line below still reads it, because that path never goes through
  // `envelope()`; it reads it under emit's own name so there is one spelling.
  const runId = process.env[RUN_ID_ENV];

  return {
    exitCode: ok ? EXIT_OK : EXIT_FAIL,
    json: {
      ok,
      strict: options.strict,
      errors,
      warnings,
      layoutFrames,
      // The envelope names the shutter once; each section that reads pixels
      // names it again in its own JSON, verbatim.
      ...shutterJson(shutter, options.read),
      lint: lint.json,
      realm: realm.json,
      keyframes: keyframes.json,
      visibility: visibility.json,
      layout: layouts,
      assertions: assertions.json,
    },
    stdoutLines: [
      `verify ${dir}${runId === undefined ? "" : ` (run ${runId})`} — ` +
        `${errors.length} error(s), ${warnings} warning(s)` +
        (options.strict ? ", --strict" : ""),
      "",
      ...sections.map(
        (s) => `  ${s.ok ? "ok  " : "FAIL"} ${s.name}${describe(s)}`,
      ),
      "",
      `Layout sampled at ${layoutFrames.join(", ")} of ${durationFrames} frame(s).`,
      "`visibility` and `assert` sweep their own default grid, so those sections",
      "are the same objects those commands print on their own.",
      "A warning is an active layout finding; --strict counts them.",
      ...(shutter
        ? [
            options.read === "tick"
              ? `Shutter ${describeShutter(shutter)}: the pixel sections read the frame's own TICK (--read tick), not the exposure; \`realm\` renders none.`
              : `Shutter ${describeShutter(shutter)}: the pixel sections read exposures; \`realm\` renders none.`,
          ]
        : []),
    ],
    stderrLines: errors.map((name) => `verify: ${name} failed`),
  };
}

function describe(s: Section): string {
  const json = s.json as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(json)) return ` — ${json.length} frame(s)`;
  if (json === null || typeof json !== "object") return "";
  const error = (json as { error?: unknown }).error;
  if (typeof error === "string") return ` — ${error}`;
  const failures = (json as { failures?: unknown }).failures;
  if (Array.isArray(failures) && failures.length > 0) {
    return ` — ${failures.join(", ")}`;
  }
  return "";
}

/** Active findings summed over the sampled layout frames. */
export function countWarnings(layouts: readonly unknown[]): number {
  let total = 0;
  for (const one of layouts) {
    const counts = (one as { findingCounts?: Record<string, number> } | null)?.findingCounts;
    if (!counts) continue;
    for (const n of Object.values(counts)) total += n;
  }
  return total;
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["verify", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const at = parsed.flags.at;
  const samples = parseSamples(parsed.flags.samples);
  const read = parseRead(parsed.flags.read);
  return run({
    dir,
    ...(at === undefined ? {} : { at: parseFrameList(String(at)) }),
    ...(samples === undefined ? {} : { samples }),
    strict: parsed.flags.strict === true,
    ...(read ? { read } : {}),
    flags: parsed.global,
  });
}
