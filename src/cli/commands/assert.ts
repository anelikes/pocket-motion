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
 * WHICH FRAMES: `--samples` evenly spaced ones, plus every frame an assertion
 * names (an `inPicture` window's ends, an `entersBy` frame, an `exitsBy` frame
 * and the one after it), plus — after those have been read — the frames that
 * put each `before` node's first showing where it happens.
 * `src/render/assertions.ts` has the rule and the measurement that set it: an
 * even grid alone decides a window narrower than its stride by where the
 * stride falls, which on a template of short sections is most of them. The
 * JSON's `grid` names each part and `frames` is their union.
 *
 * WHAT IT CLASSIFIES: the nodes its assertions mention — each `node`, and each
 * `before` target — and no other. Every verdict is about one of those, so a
 * probe of anything else is a render no line of the output reads, and under a
 * shutter each one is `samples` renders. On `compositions/mg-hud`, three
 * assertions against 593 named-or-text nodes, the default grid with no shutter
 * cost 35,265 rasters before and costs 102 now (`baselines/shutter.md`,
 * "Stage 3"). `insideBox` reads the same codes it read
 * before: a kept node's ancestors are still measured, so its container is the
 * one it always had. The names the tree carries are still all read, off the
 * tree and with no walk, for the line that answers an assertion naming none of
 * them and to tell that name from one whose node no sampled frame laid out.
 *
 * UNDER A SHUTTER the classification is of the exposure. `--read tick` asks
 * the frame's own tick instead, at one render a probe instead of `samples`,
 * and the JSON's `read` and the printed shutter lines say which was read —
 * `src/render/visibility.ts` says what the tick does not see.
 *
 * AN ASSERTION MOVES NO PIXEL. `identityProjection` drops the key, so writing
 * one does not change a recorded digest — that is asserted in
 * `tests/identity.test.ts` rather than promised here.
 */

import { existsSync } from "node:fs";
import {
  assertionFrames,
  evaluateAssertions,
  pinFrames,
  predicateOf,
  type AssertionVerdict,
  type SweptNode,
} from "../../render/assertions.ts";
import { active } from "../../render/findings.ts";
import type { Reading } from "../../render/visibility.ts";
import type { SidecarAssertion } from "../../manifest/sidecar.ts";
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
import { flattenTree, inspectLayout, parseRead, shutterJson, shutterLines } from "./layout.ts";
import { DEFAULT_SAMPLES, parseSamples, sampleFrames } from "./visibility.ts";

export interface AssertOptions {
  readonly dir: string;
  readonly samples?: number;
  /** Under a declared shutter, the picture each node is classified in.
   *  Absent means the exposure. */
  readonly read?: Reading;
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
  return assertComposition(resolved.value, {
    ...(options.samples === undefined ? {} : { samples: options.samples }),
    ...(options.read ? { read: options.read } : {}),
  });
}

export interface AssertCompositionOptions {
  readonly samples?: number;
  readonly read?: Reading;
}

/**
 * The frames a run sampled, in the three parts it took them for. Disjoint;
 * their union is the JSON's `frames`.
 */
export interface AssertGrid {
  /** `--samples` as asked for. */
  readonly samples: number;
  /** The evenly spaced frames, first and last included. */
  readonly even: readonly number[];
  /** Frames an assertion names that `even` does not hold. */
  readonly asserted: readonly number[];
  /** Frames between a `before` node's first showing and the sampled frame
   *  before it, read after the other two. */
  readonly pinned: readonly number[];
}

/** Two ascending frame lists as one, ascending, each frame once. */
function union(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

const listFrames = (frames: readonly number[]): string =>
  frames.length <= 8
    ? frames.join(", ")
    : `${frames.slice(0, 5).join(", ")} … ${frames.slice(-2).join(", ")}`;

/** The printed lines that name the grid. */
function gridLines(grid: AssertGrid, frames: readonly number[]): string[] {
  const even = grid.even;
  return [
    `Frames sampled: ${frames.length} — ${even.length} evenly spaced over ` +
      `${even.length === 1 ? even[0] : `${even[0]}…${even[even.length - 1]}`} (--samples ${grid.samples})`,
    ...(grid.asserted.length > 0
      ? [`  + ${grid.asserted.length} that the assertions name: ${listFrames(grid.asserted)}`]
      : []),
    ...(grid.pinned.length > 0
      ? [`  + ${grid.pinned.length} pinning where a \`before\` node is first shown: ${listFrames(grid.pinned)}`]
      : []),
    "Every verdict is about those frames and nothing between them;",
    "--samples <durationFrames> is the exact case.",
  ];
}

/**
 * `assert` on a composition already resolved: the object `assert --json`
 * prints, and the exit code that goes with it.
 *
 * Separate from `run` so `render --spec --assert` can check a job's staged
 * tree before the tree is removed, and carry this object verbatim — a job's
 * verdict reshaped by `render` would be a second implementation of this
 * command, which is the rule `verify`'s sections are held to as well.
 */
export async function assertComposition(
  c: ResolvedComposition,
  options: AssertCompositionOptions = {},
): Promise<CommandResult> {
  const requested = options.samples ?? DEFAULT_SAMPLES;
  const assertions = c.sidecar.assertions;
  const even = sampleFrames(c.durationFrames, requested);

  // No assertions is not a failure and is not a silent pass either: the line
  // says so, and `verify`'s envelope carries the zero.
  if (assertions.length === 0) {
    const grid: AssertGrid = { samples: requested, even, asserted: [], pinned: [] };
    return {
      exitCode: EXIT_OK,
      json: {
        ok: true,
        frames: even,
        grid,
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
    const onEven = new Set(even);
    const asserted = assertionFrames(assertions, c.durationFrames).filter((f) => !onEven.has(f));
    const planned = union(even, asserted);
    const sweepOptions: SweepOptions = {
      names: mentionedNames(assertions),
      ...(options.read ? { read: options.read } : {}),
    };
    let sweep = await sweepNamedNodes(c, planned, sweepOptions);
    // `before` names no frame of its own, so its pair is found from the first
    // sweep and read in a second one. Each boots its own world: the clock only
    // runs forward, and the frames to add are known only once the first has
    // run to the end.
    const pinned = pinFrames(assertions, sweep.nodes, planned);
    if (pinned.length > 0) {
      sweep = mergeSweeps(sweep, await sweepNamedNodes(c, pinned, sweepOptions));
    }
    const frames = union(planned, pinned);
    const grid: AssertGrid = { samples: requested, even, asserted, pinned };

    const verdicts = evaluateAssertions({
      assertions,
      nodes: sweep.nodes,
      named: sweep.named,
      frames,
    });
    const failures = verdicts.filter((v) => !v.ok);

    return {
      exitCode: failures.length === 0 ? EXIT_OK : EXIT_FAIL,
      json: {
        ok: failures.length === 0,
        frames,
        grid,
        durationFrames: c.durationFrames,
        assertions: verdicts,
        failures: failures.map((v) => `${v.node} ${v.predicate}`),
        ...shutterJson(c.shutter, options.read),
      },
      stdoutLines: [
        `assert over ${frames.length} of ${c.durationFrames} frame(s) — ` +
          `${verdicts.length} assertion(s), ${failures.length} failing`,
        "",
        ...verdicts.map(line),
        "",
        ...gridLines(grid, frames),
        ...shutterLines(c.shutter, options.read),
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

/** Every debugName an assertion reads: its own node, and a `before` target. */
export function mentionedNames(assertions: readonly SidecarAssertion[]): Set<string> {
  const out = new Set<string>();
  for (const a of assertions) {
    out.add(a.node);
    if ("before" in a) out.add(a.before);
  }
  return out;
}

export interface SweepOptions {
  /** Classify only nodes carrying one of these debugNames. Absent means
   *  every named node. */
  readonly names?: ReadonlySet<string>;
  /** Under a declared shutter, the picture classified. Absent: the exposure. */
  readonly read?: Reading;
}

export interface Sweep {
  /** By debugName: each name classified that had a box at a sampled frame. */
  readonly nodes: Map<string, SweptNode>;
  /** Every debugName the tree carries, in document order, whether or not it
   *  was classified and whether or not any sampled frame laid it out. */
  readonly named: readonly string[];
}

/**
 * Two sweeps of one composition over disjoint frames, as one.
 *
 * Every entry is classified the same way at every frame it holds — same
 * names, same reading — so the merge is per-frame lists joined and sorted.
 * The tree is the same tree in both, so `named` is either one.
 */
export function mergeSweeps(a: Sweep, b: Sweep): Sweep {
  const nodes = new Map<string, SweptNode>();
  const join = (x: readonly number[], y: readonly number[]): number[] =>
    [...x, ...y].sort((p, q) => p - q);
  for (const name of new Set([...a.nodes.keys(), ...b.nodes.keys()])) {
    const x = a.nodes.get(name);
    const y = b.nodes.get(name);
    if (x === undefined || y === undefined) {
      nodes.set(name, (x ?? y)!);
      continue;
    }
    nodes.set(name, {
      ...(x.name === undefined ? {} : { name: x.name }),
      onScreen: join(x.onScreen, y.onScreen),
      covered: join(x.covered, y.covered),
      outsideBox: join(x.outsideBox, y.outsideBox),
      hasBox: join(x.hasBox, y.hasBox),
    });
  }
  return { nodes, named: a.named };
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
  options: SweepOptions = {},
): Promise<Sweep> {
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
    // Every name the tree carries, off the tree: a mount-only composition
    // does not restructure after mount, so this is every node any frame has.
    const named = [
      ...new Set(
        flattenTree(tree as Parameters<typeof flattenTree>[0], false).flatMap((k) =>
          k.node.n === undefined ? [] : [k.node.n],
        ),
      ),
    ];
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
        ...(options.names ? { names: options.names } : {}),
        ...(options.read ? { read: options.read } : {}),
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
    return { nodes: new Map<string, SweptNode>(swept), named };
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
  const read = parseRead(parsed.flags.read);
  return run({
    dir,
    ...(samples === undefined ? {} : { samples }),
    ...(read ? { read } : {}),
    flags: parsed.global,
  });
}

/** Re-exported so `verify` can name the predicate without a second copy. */
export { predicateOf };
