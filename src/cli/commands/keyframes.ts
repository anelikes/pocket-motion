/**
 * `keyframes <composition-dir>`
 * Question: what motion is baked into this pak, and does the render sample the
 * instants it declares?
 *
 * Scope, stated so it is not read wider than it is. This command reads the
 * style table and the ANIM TABLE out of the pak. It does not boot, does not
 * render, and therefore says nothing about whether an animated node is on
 * screen, whether it is painted over, or whether it moves any pixel — a
 * timeline on a node behind an opaque clip reports here exactly as one in
 * plain view. `layout --at N` answers visibility for one frame; nothing yet
 * answers it across a node's whole span.
 *
 * What it does claim:
 *
 *   - the baked schedule: delay, period, iterations, properties, per timeline
 *   - which declared instants land between two rendered frames and are
 *     therefore never observed (`src/anim/timelines.ts` has the mechanism)
 *   - which timelines cannot play at all inside this composition's clock
 *
 * Only the last one fails. An unsampled instant is a real shift in what the
 * author asked for, but it is neither wrong nor avoidable at every fps, and
 * every delivered film here has some — a command that failed on it would be
 * red on the whole ledger from the day it landed, which is not a gate, only
 * noise. A timeline whose delay outlives its clock is unambiguous: it is a
 * declared animation that no frame of this composition can show.
 */

import { existsSync } from "node:fs";
import {
  readTimelines,
  type TimelineReport,
  type TimelineUse,
} from "../../anim/timelines.ts";
import {
  assertBuildRecord,
  BuildRecordError,
} from "../../render/build-record.ts";
import { TICKS_PER_SECOND } from "../../runtime/boot.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";

export interface KeyframesOptions {
  readonly dir: string;
  readonly flags: GlobalFlags;
  /** List every timeline rather than a summary plus examples. */
  readonly all: boolean;
}

/** How many examples a summary shows before it says how many it left out. */
const EXAMPLES = 5;

export async function run(options: KeyframesOptions): Promise<CommandResult> {
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: false,
  });

  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, diagnostics: resolved.diagnostics ?? [], error: "invalid pocket-motion.json" },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
      stdoutLines: ["keyframes failed — invalid sidecar"],
    };
  }

  const c = resolved.value;
  if (!existsSync(c.pakPath)) {
    throw new UsageError(
      `pak not found: ${c.pakPath}\nBuild it with:\n  ${c.buildCommand}`,
    );
  }
  // This command does not boot, so it resolves with `requireBundle: false` and
  // never reaches the check every rendering command gets. It reads baked
  // timelines out of the pak all the same, and a pak whose compiler nobody can
  // name is exactly what `build.json` exists to refuse.
  try {
    await assertBuildRecord({
      bundlePath: c.bundlePath,
      compositionDir: c.dir,
      buildCommand: c.buildCommand,
    });
  } catch (e) {
    if (!(e instanceof BuildRecordError)) throw e;
    throw new UsageError(errMsg(e));
  }

  let report: TimelineReport | null;
  try {
    report = await readTimelines({
      pakPath: c.pakPath,
      fps: c.fps,
      durationFrames: c.durationFrames,
      // ASSUMED, not read. The rate a pak's frame counts are in is published
      // by the BUNDLE (`patches/0010`), and this command does not boot, so
      // nothing here verifies it. The assumption is bounded rather than
      // safe: `assertBakedTickRate` refuses a bundle baked at another rate,
      // so a pak this would misread is a pak no command can render. The
      // printed header names the number so the bound is visible.
      tickHz: TICKS_PER_SECOND,
    });
  } catch (e) {
    throw new UsageError(`could not read the style table in ${c.pakPath}: ${errMsg(e)}`);
  }

  if (!report) {
    return {
      exitCode: EXIT_OK,
      json: { ok: true, timelines: [], bakedCount: 0, unreferenced: 0, note: "no style table in the pak" },
      stdoutLines: [`keyframes — ${c.pakPath} carries no style table; nothing is baked`],
    };
  }

  const neverStarts = report.timelines.filter((t) => t.neverStarts);
  const unsampled = report.timelines.filter((t) => t.unsampled.length > 0);
  const endsPast = report.timelines.filter((t) => t.endsPastWindow);
  const phaseDrift = report.timelines.filter((t) => t.periodOffGrid || t.loopOffGrid);
  const ok = neverStarts.length === 0;

  const json = {
    ok,
    fps: report.fps,
    durationFrames: report.durationFrames,
    ticksPerFrame: report.ticksPerFrame,
    totalTicks: report.totalTicks,
    bakedCount: report.bakedCount,
    unreferenced: report.unreferenced,
    counts: {
      timelines: report.timelines.length,
      neverStarts: neverStarts.length,
      unsampled: unsampled.length,
      endsPastWindow: endsPast.length,
      phaseDrift: phaseDrift.length,
    },
    timelines: report.timelines,
  };

  const stdoutLines = summarise(report, {
    neverStarts,
    unsampled,
    endsPast,
    phaseDrift,
    all: options.all,
  });

  return {
    exitCode: ok ? EXIT_OK : EXIT_FAIL,
    json,
    stdoutLines,
    stderrLines: neverStarts.map(
      (t) =>
        `timeline ${t.animId} (style ${t.styleIndex}, ${t.props.join("+")}): ` +
        `delay ${t.delayFrames} ticks is at or past the ${t.windowTicks}-tick clock it runs on — ` +
        "no frame of this composition can show it",
    ),
  };
}

interface Buckets {
  readonly neverStarts: readonly TimelineUse[];
  readonly unsampled: readonly TimelineUse[];
  readonly endsPast: readonly TimelineUse[];
  readonly phaseDrift: readonly TimelineUse[];
  readonly all: boolean;
}

function summarise(report: TimelineReport, b: Buckets): string[] {
  const props = new Set<string>();
  let segments = 0;
  for (const t of report.timelines) {
    for (const p of t.props) props.add(p);
    segments += t.segments;
  }

  const lines = [
    `keyframes — ${report.timelines.length} timeline(s) over ${segments} segment(s), ` +
      `${report.bakedCount} baked` +
      (report.unreferenced > 0 ? `, ${report.unreferenced} referenced by no style record` : ""),
    `  ${report.fps} fps at an assumed ${TICKS_PER_SECOND} Hz bake rate: the render ` +
      `samples every ${report.ticksPerFrame} core tick(s), ${report.totalTicks} tick(s) ` +
      "of clock in all",
    "  (the rate is published by the bundle and this command does not boot; " +
      "every command that does refuses a bundle baked at another rate)",
    `  properties: ${[...props].sort().join(", ") || "(none)"}`,
  ];

  if (report.ticksPerFrame === 1) {
    lines.push("  every core tick is rendered, so no declared instant can fall between frames");
  } else {
    const worst = b.unsampled.reduce(
      (m, t) => Math.max(m, ...t.unsampled.map((u) => u.shiftFrames)),
      0,
    );
    lines.push(
      `  ${b.unsampled.length} timeline(s) declare an instant no frame samples` +
        (b.unsampled.length > 0 ? ` (largest shift ${worst.toFixed(2)} frame)` : ""),
    );
    if (b.phaseDrift.length > 0) {
      lines.push(
        `  ${b.phaseDrift.length} of them repeat on a period that is not a whole ` +
          "number of frames, so each iteration lands on a different phase",
      );
    }
  }

  if (b.endsPast.length > 0) {
    lines.push(`  ${b.endsPast.length} timeline(s) are cut off by the end of their clock`);
  }
  lines.push(
    b.neverStarts.length === 0
      ? "  0 never start"
      : `  ${b.neverStarts.length} NEVER START — see stderr`,
  );

  const listed = b.all ? report.timelines : b.unsampled.slice(0, EXAMPLES);
  for (const t of listed) lines.push(`    ${describe(t)}`);
  if (!b.all && b.unsampled.length > listed.length) {
    lines.push(`    … ${b.unsampled.length - listed.length} more; --all lists every timeline`);
  }

  return lines;
}

function describe(t: TimelineUse): string {
  const iterations = t.iterations === 0 ? "infinite" : `${t.iterations}x`;
  const shifted = t.unsampled
    .slice(0, 3)
    .map((u) => `${u.tick}→${u.observedTick}`)
    .join(" ");
  return (
    `anim ${t.animId} style ${t.styleIndex}: ${t.props.join("+")} ` +
    `delay ${t.delayFrames} period ${t.periodFrames} ${iterations}` +
    (t.loopFrames > 0 ? ` loop ${t.loopFrames}` : "") +
    (t.unsampled.length > 0 ? `  unsampled ticks ${shifted}` : "") +
    (t.unsampled.length > 3 ? ` (+${t.unsampled.length - 3})` : "")
  );
}

/** argv form used by main.ts */
export async function runFromArgv(
  argv: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(["keyframes", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  return run({ dir, flags: parsed.global, all: parsed.flags.all === true });
}
