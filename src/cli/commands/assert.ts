/**
 * `assert <composition-dir> [--samples N]`
 * Question: does the film do what its sidecar says it is supposed to do?
 *
 * `lint` answers whether the composition is well formed, `check` whether the
 * realm is clean, `trace` whether the frames are stable, `visibility` whether a
 * named node is ever shown. None of them knows what the film is FOR. The
 * generators in this tree already assert their own intent — a dialogue line's
 * composition frame re-derived and compared, a cue that must survive into the
 * mix — but every one of those assertions is about a number the generator
 * computed, and a caption can be computed correctly, laid out correctly, and
 * painted over while all of them stay true.
 *
 * `assertions[]` in the sidecar is the other kind. Each entry names a node's
 * `debugName` and one predicate, and every predicate is evaluated from the
 * picture: the same classification `visibility` sweeps, plus the layout finding
 * codes for `insideBox`. `src/render/assertions.ts` is the evaluation and the
 * exact meaning of each one.
 *
 * WHAT IT CLAIMS: the sampled frames it names, and nothing between them. The
 * printed line says which grid it used and `--samples` is the lever; the exact
 * case is `--samples <durationFrames>` and costs what it costs.
 *
 * AN ASSERTION MOVES NO PIXEL. `identityProjection` drops the key, so writing
 * one does not change a recorded digest — that is asserted in
 * `tests/identity.test.ts` rather than promised here.
 */

import { existsSync } from "node:fs";
import {
  evaluateAssertions,
  predicateOf,
  type AssertionVerdict,
  type SweptNode,
} from "../../render/assertions.ts";
import { active } from "../../render/findings.ts";
import { hardenedBootWorld } from "../../runtime/boot.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { openFootage } from "../footage.ts";
import { errMsg, resolveComposition, type ResolvedComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";
import { inspectLayout, shutterLines } from "./layout.ts";
import { DEFAULT_SAMPLES, parseSamples, sampleFrames } from "./visibility.ts";

export interface AssertOptions {
  readonly dir: string;
  readonly samples?: number;
  readonly flags: GlobalFlags;
}

/** Codes that mean "this node's box is not where a box should be". */
const OUTSIDE_CODES = new Set(["escaped_container", "panel_out_of_canvas"]);

export async function run(options: AssertOptions): Promise<CommandResult> {
  const resolved = await resolveComposition({
    dir: options.dir,
    flags: options.flags,
    requireBundle: true,
  });
  if (!resolved.ok) {
    if (resolved.kind === "usage") throw new UsageError(resolved.message);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: "invalid pocket-motion.json", diagnostics: resolved.diagnostics },
      stderrLines: (resolved.diagnostics ?? []).map(
        (d) => `sidecar ${d.path || "/"}: ${d.code}: ${d.message}`,
      ),
    };
  }
  const c = resolved.value;
  const requested = options.samples ?? DEFAULT_SAMPLES;
  const frames = sampleFrames(c.durationFrames, requested);

  // No assertions is not a failure and is not a silent pass either: the line
  // says so, and `verify`'s envelope carries the zero.
  if (c.sidecar.assertions.length === 0) {
    return {
      exitCode: EXIT_OK,
      json: {
        ok: true,
        frames,
        durationFrames: c.durationFrames,
        assertions: [],
        failures: [],
        note: "the sidecar declares no assertions",
      },
      stdoutLines: [
        "assert — the sidecar declares no assertions.",
        "An `assertions[]` entry names a node's debugName and one of inPicture,",
        "entersBy, exitsBy, insideBox, dwellFrames or before.",
      ],
    };
  }

  try {
    const nodes = await sweepNamedNodes(c, frames);
    const verdicts = evaluateAssertions({
      assertions: c.sidecar.assertions,
      nodes,
      frames,
    });
    const failures = verdicts.filter((v) => !v.ok);

    return {
      exitCode: failures.length === 0 ? EXIT_OK : EXIT_FAIL,
      json: {
        ok: failures.length === 0,
        frames,
        durationFrames: c.durationFrames,
        assertions: verdicts,
        failures: failures.map((v) => `${v.node} ${v.predicate}`),
        ...(c.shutter ? { shutter: c.shutter } : {}),
      },
      stdoutLines: [
        `assert over ${frames.length} of ${c.durationFrames} frame(s) — ` +
          `${verdicts.length} assertion(s), ${failures.length} failing`,
        "",
        ...verdicts.map(line),
        "",
        `Frames sampled: ${
          frames.length === 1 ? frames[0] : `${frames[0]}…${frames[frames.length - 1]}`
        } (--samples ${requested}). Every verdict is about those frames and`,
        "nothing between them; --samples <durationFrames> is the exact case.",
        ...shutterLines(c.shutter),
      ],
      stderrLines: failures.map(
        (v) => `assert: ${v.node} ${v.predicate} ${JSON.stringify(v.expected)} — ${v.detail}`,
      ),
    };
  } catch (e) {
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`assert failed — ${message}`],
    };
  }
}

/**
 * The sweep every predicate reads, by `debugName`.
 *
 * Exported because the predicates and the sweep are two different things to be
 * wrong about, and a test that wants to try an assertion the sidecar does not
 * carry should not have to write a sidecar to do it. `tests/assert.test.ts`
 * sweeps `compositions/spanned` once and evaluates several assertions against
 * that one sweep — the red case and the green one come from the same pixels.
 */
export async function sweepNamedNodes(
  c: ResolvedComposition,
  frames: readonly number[],
): Promise<Map<string, SweptNode>> {
  let footage: Awaited<ReturnType<typeof openFootage>> = null;
  try {
    const world = await hardenedBootWorld({
      bundlePath: c.bundlePath,
      pakPath: existsSync(c.pakPath) ? c.pakPath : undefined,
      width: c.width,
      height: c.height,
      hz: c.fps,
      renderScale: c.supersample,
      shutter: c.shutter,
      buildCommand: c.buildCommand,
    });
    // getTree runs one frame turn and leaves the world at frame 0 — the same
    // accounting `layout` and `visibility` document.
    const tree = world.getTree();
    footage = c.sidecar.footage.length > 0 ? await openFootage(c, world, tree) : null;

    const swept = new Map<
      string,
      { onScreen: number[]; covered: number[]; outsideBox: number[]; hasBox: number[] }
    >();
    let at = 0;
    for (const frame of frames) {
      for (; at < frame; at++) {
        world.frame(0);
        for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
      }
      footage?.present(frame);
      const { nodes } = inspectLayout(world, tree, {
        keepAll: false,
        classify: true,
        findings: {
          viewport: { x: 0, y: 0, w: c.width, h: c.height },
          allow: c.sidecar.layoutAllow,
          physicalWidth: world.physicalWidth,
          density: c.supersample,
        },
      });
      for (const node of nodes) {
        if (!node.name) continue;
        const entry =
          swept.get(node.name) ?? { onScreen: [], covered: [], outsideBox: [], hasBox: [] };
        entry.hasBox.push(frame);
        if (node.visibility === "on-screen") entry.onScreen.push(frame);
        if (node.visibility === "covered") entry.covered.push(frame);
        // An excused finding is not evidence of anything: the sidecar already
        // said that geometry is intended, and `insideBox` would be asserting
        // against the author's own answer.
        if (active(node.findings ?? []).some((f) => OUTSIDE_CODES.has(f.code))) {
          entry.outsideBox.push(frame);
        }
        swept.set(node.name, entry);
      }
    }
    return new Map<string, SweptNode>(swept);
  } finally {
    await footage?.close();
  }
}

function line(v: AssertionVerdict): string {
  return (
    `  ${v.ok ? "ok  " : "FAIL"} ${v.node.slice(0, 24).padEnd(24)} ` +
    `${v.predicate}=${JSON.stringify(v.expected)}`.padEnd(28) +
    ` ${v.detail}`
  );
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["assert", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const samples = parseSamples(parsed.flags.samples);
  return run({
    dir,
    ...(samples === undefined ? {} : { samples }),
    flags: parsed.global,
  });
}

/** Re-exported so `verify` can name the predicate without a second copy. */
export { predicateOf };
