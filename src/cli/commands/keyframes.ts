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
 *   - which steps — segments no longer than one rendered frame — the render
 *     takes a frame inside of, and so shows part-way
 *   - which properties two animations of one comma list write at the same
 *     time, the earlier one's motion going nowhere while the later writes
 *   - which timelines cannot play at all inside this composition's clock
 *
 * Only the last one fails. An unsampled instant is a real shift in what the
 * author asked for, but it is neither wrong nor avoidable at every fps, and
 * every delivered film here has some — a command that failed on it would be
 * red on the whole ledger from the day it landed, which is not a gate, only
 * noise. A part-way step and a contended property are each the shape of a
 * defect that shipped here (`compositions/rename-card`'s close arrived a frame
 * late and grey; `compositions/transitions`' incoming scene showed at 0.72
 * before its cut), and both are reported rather than failed for the same
 * reason: the ledger was measured with the readings in place, and the number
 * of each in the tree is in the commit that added them. A timeline whose
 * delay outlives its clock is unambiguous: it is a declared animation that no
 * frame of this composition can show.
 */

import { existsSync } from "node:fs";
import {
  readTimelines,
  type PropContention,
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
      json: {
        ok: true,
        timelines: [],
        contended: [],
        bakedCount: 0,
        unreferenced: 0,
        note: "no style table in the pak",
      },
      stdoutLines: [`keyframes — ${c.pakPath} carries no style table; nothing is baked`],
    };
  }

  const neverStarts = report.timelines.filter((t) => t.neverStarts);
  const unsampled = report.timelines.filter((t) => t.unsampled.length > 0);
  const endsPast = report.timelines.filter((t) => t.endsPastWindow);
  const phaseDrift = report.timelines.filter((t) => t.periodOffGrid || t.loopOffGrid);
  const partialCuts = report.timelines.filter((t) => t.partialCuts.length > 0);
  const jumps = report.timelines.filter((t) => t.shutterJumps.length > 0);
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
      partialCuts: partialCuts.length,
      contended: report.contended.length,
      shutterJumps: jumps.length,
    },
    ...(c.shutter ? { shutter: c.shutter } : {}),
    timelines: report.timelines,
    contended: report.contended,
  };

  const stdoutLines = summarise(report, {
    neverStarts,
    unsampled,
    endsPast,
    phaseDrift,
    partialCuts,
    jumps: c.shutter ? jumps : null,
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
  readonly partialCuts: readonly TimelineUse[];
  /** Timelines with a transform jump, or null when no shutter is declared and
   *  where a blur stops is not a question. */
  readonly jumps: readonly TimelineUse[] | null;
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

  if (b.partialCuts.length > 0) {
    lines.push(
      `  ${b.partialCuts.length} timeline(s) carry a step no longer than one frame that a ` +
        "rendered frame lands inside, so that frame shows the step part-way",
    );
  }
  if (report.contended.length > 0) {
    lines.push(
      `  ${report.contended.length} propert${report.contended.length === 1 ? "y is" : "ies are"} ` +
        "written by two animations of one comma list at once; the later one is what the node gets",
    );
    for (const c of report.contended.slice(0, b.all ? report.contended.length : EXAMPLES)) {
      lines.push(`    ${describeContention(c, report)}`);
    }
    if (!b.all && report.contended.length > EXAMPLES) {
      lines.push(`    … ${report.contended.length - EXAMPLES} more; --all lists every one`);
    }
  }
  if (b.jumps !== null) {
    const count = b.jumps.reduce((n, t) => n + t.shutterJumps.length, 0);
    lines.push(
      `  ${count} transform jump(s) in ${b.jumps.length} timeline(s): the declared shutter ` +
        "does not blur across a one-tick step or a cut, so motion there reads as a cut",
    );
    for (const t of b.jumps.slice(0, b.all ? b.jumps.length : EXAMPLES)) {
      const shown = t.shutterJumps.slice(0, 4).map((j) => `${j.prop} ${j.kind}@${j.tick}`);
      lines.push(
        `    timeline ${t.animId} (style ${t.styleIndex}): ${shown.join(", ")}` +
          (t.shutterJumps.length > 4 ? ` (+${t.shutterJumps.length - 4})` : ""),
      );
    }
    if (!b.all && b.jumps.length > EXAMPLES) {
      lines.push(`    … ${b.jumps.length - EXAMPLES} more; --all lists every one`);
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

  const examples = [...new Set([...b.partialCuts, ...b.unsampled])];
  const listed = b.all ? report.timelines : examples.slice(0, EXAMPLES);
  for (const t of listed) lines.push(`    ${describe(t)}`);
  if (!b.all && examples.length > listed.length) {
    lines.push(`    … ${examples.length - listed.length} more; --all lists every timeline`);
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
    (t.unsampled.length > 3 ? ` (+${t.unsampled.length - 3})` : "") +
    (t.partialCuts.length > 0
      ? `  step ${t.partialCuts
          .slice(0, 3)
          .map((c) => `${c.t0}→${c.t1} shown ${c.fraction.toFixed(2)} at ${c.sampledTick}`)
          .join(", ")}`
      : "") +
    (t.partialCuts.length > 3 ? ` (+${t.partialCuts.length - 3})` : "")
  );
}

function describeContention(c: PropContention, report: TimelineReport): string {
  const earlier = report.timelines.find((t) => t.animId === c.earlier && t.styleIndex === c.styleIndex);
  const run = earlier
    ? ` of its ${earlier.delayFrames}–${
        earlier.iterations === 0 ? "∞" : earlier.delayFrames + earlier.periodFrames * earlier.iterations
      }`
    : "";
  return (
    `style ${c.styleIndex}: ${c.prop} — anim ${c.earlier} is written over for ticks ` +
    `${c.fromTick}–${c.toTick}${run} by anim ${c.later}, later in the list`
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
