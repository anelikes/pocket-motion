/**
 * `visibility <composition-dir> [--samples N]`
 * Question: over the film, is a node the author named ever shown at all?
 *
 * This is the sweep the other two commands do not do. `layout --at N` asks one
 * frame; `keyframes` reads a schedule out of the pak without booting and so
 * reports a timeline on a node behind an opaque clip exactly as one in plain
 * view. A caption covered by the next shot for most of its window needs both
 * halves and had neither: `lint`, `check`, `trace` and `diff` all pass on it,
 * nothing fails, and nothing notices unless a person happens to run `layout`
 * at a frame past the burial.
 *
 * WHAT IT EXAMINES, AND WHAT IT THEREFORE CLAIMS
 *
 * A sample of frames, evenly spaced across the whole composition, first and
 * last included — `--samples`, default 24, and the printed line names the
 * number it used. At each one, every node that carries a name or text is
 * classified by `src/render/visibility.ts`: on-screen, covered, or
 * declared-invisible. So the claim is about the sampled frames and not the
 * ones between them. A node covered for fewer frames than the stride can fall
 * between two samples and is not reported; raise `--samples` to narrow that.
 *
 * The tree is read once. Mount-only compositions do not restructure after
 * mount — that is what `check` and `lint/mount-only` enforce — so node ids are
 * stable across the sweep, and re-reading the tree per frame would cost a
 * frame turn each time and move the clock the sweep is measuring.
 *
 * WHAT FAILS, AND THE MEASUREMENT THAT SET EACH LINE
 *
 * Two readings, both about a node the author gave a `debugName`.
 *
 * NEVER SHOWN — it emits geometry at some sampled frame and no sampled frame
 * shows any part of it.
 *
 * BURIED AFTER BEING SHOWN — some sampled frame shows it, and a LATER sampled
 * frame has it covered. It was up, something painted over it, and it never
 * came back. This is the buried-caption shape at its own proportions rather
 * than the degenerate always-covered one, and it is what
 * `compositions/spanned` holds:
 * measured at 240 samples, `spanning` paints at every frame of the film, is
 * shown through 71 and covered from 72 to the end.
 *
 * Both are exact rather than thresholds, and the ordering in the second is
 * load-bearing: a node covered BEFORE the last frame that shows it is a
 * reveal, not a burial. `compositions/spanned`'s `revealed` is the only one in
 * the tree and it must pass.
 *
 * WHAT SEPARATES THE SECOND READING FROM A CROSS-FADE, EXACTLY
 *
 * A dissolve whose outgoing half reaches zero no later than its incoming half
 * turns opaque is covered at NO frame: it contributes pixels for the whole
 * overlap and then stops emitting geometry, reading `on-screen` and then
 * `declared-invisible`. `spanned`'s `crossfade` is that dissolve and records
 * zero covered frames.
 *
 * That condition is narrower than "an ordinary dissolve", and the difference
 * is a red case the fixture carries rather than a caveat. `spanned`'s
 * `trailing` is the same dissolve with a 1200 ms exit under a 400 ms
 * entrance — nothing exotic — and for the 24 frames its tail outlives the
 * lid's fade it paints with every pixel hidden. It IS covered after being
 * shown, it FAILS, and the film is fine. Reading the picture alone there is
 * nothing that separates those 24 frames from a caption buried for the rest
 * of its window; separating them needs the declared lifetime joined to the
 * measured span, which is the open hole `AGENTS.md` records. Until then the honest statement is that this
 * reading reaches every node that paints while hidden and never returns, of
 * which a wrongly buried caption is one kind and a long dissolve tail is
 * another.
 *
 * `baselines/visibility.json` holds the counts per composition, so the
 * numbers below are re-derived by `scripts/visibility.ts` rather than
 * remembered. Over the tree as it stands: 7 nodes are covered after being
 * shown and 2 of them are named — `spanned`'s `spanning` and `trailing`, the
 * fixture. The other 5 are `reel`'s odometer digits riding past the edge of
 * their window.
 *
 * The obvious predicate for the first reading is that one without the name,
 * and it is measurably wrong. **21 nodes paint and are never once shown, and
 * exactly 2 of them are named** — the `buried` node in
 * `compositions/occluded` and the one in `compositions/layout-codes`, both
 * fixtures and both deliberately buried. The other 19 are in `reel`, which
 * reproduces its digest, and every one is correct:
 *
 *   - a text run that is a single space. It emits a glyph cell and covers no
 *     pixel.
 *   - the odometer (`reel/gen.ts`): each digit is an `overflow-hidden` window
 *     over a 0-9-0-9 strip, so at any frame most of the strip is outside the
 *     window and the digit straddling its edge emits words the clip stage
 *     reduces to no coverage.
 *
 * **None of the 19 is named**, and 67 nodes in the tree carry a `debugName`.
 * So the name separates the finding from the noise. What it does NOT mean is
 * "the author saying this node is a thing in the film", and the split is worth
 * stating exactly, because it decides what this gate can reach:
 *
 *   13  `footage:<track>/tile:<col>:<row>`  the binder's addressing scheme.
 *       `openFootage` refuses a bound track whose tiles are not named that
 *       way, so these are a protocol, not a choice — 7 in `footage-tracks`
 *       and 4 in the `kenburns` / `shimmer` probes, which push their own
 *       textures and declare no track.
 *   54  the fixtures and `footage-tracks`'s four labels.
 *
 * A footage tile that paints and is never shown is still a real finding — a
 * bound tile that reaches no frame is a wrong grid or a track covered end to
 * end — and that is the layer a buried caption's occlusion comes from. But a
 * caption is not a tile.
 *
 * The rest of the cost, stated rather than smoothed: `reel`, the one
 * composition here at film length, records 0 named of 631 nodes, so on it this
 * command reports and cannot fail. Naming a node is how an author opts into
 * the gate, and `AUTHORING.md` says so where it says to name things.
 *
 * WHAT IT STILL DOES NOT CATCH
 *
 * WHY a node is buried. The second reading answers "it painted while hidden
 * and never came back", which is the same answer for a caption the next shot
 * ate and for the tail of an asymmetric dissolve. Telling those apart needs
 * the node's own declared lifetime — the baked timeline `keyframes` already
 * reads — joined to the span measured here, and that join does not exist:
 * `AGENTS.md` records the spike that showed it is available and that applied
 * naively it produces noise.
 *
 * A burial that ends. A node covered for a stretch in the middle and shown
 * again by the last sample is a reveal by this predicate and passes, which is
 * correct for `revealed` and would be wrong for a caption hidden through the
 * one shot that mattered.
 *
 * A burial shorter than the sampling stride, which can fall between two
 * samples entirely. `--samples` is the only lever.
 */

import { existsSync } from "node:fs";
import { baseline, openProber, probe, rect, type Reading } from "../../render/visibility.ts";
import { hardenedBootWorld } from "../../runtime/boot.ts";
import { UsageError, parseArgs, requirePositional } from "../args.ts";
import { openFootage } from "../footage.ts";
import { errMsg, resolveComposition } from "../resolve.ts";
import {
  EXIT_FAIL,
  EXIT_OK,
  type CommandResult,
  type GlobalFlags,
} from "../types.ts";
import { flattenTree, parseRead, shutterJson, shutterLines } from "./layout.ts";

/** One node of the DevTools tree (`framework/src/devtools.ts` serializeNode). */
interface TreeNode {
  readonly i: number;
  readonly t: string;
  readonly n?: string;
  readonly c?: string;
  readonly x?: string;
  readonly k?: readonly TreeNode[];
}

export interface VisibilityOptions {
  readonly dir: string;
  /** How many frames to look at. */
  readonly samples?: number;
  /** What the user typed for it, so the usage error can echo that rather than
   *  the `NaN` a bad string becomes. */
  readonly samplesRaw?: string;
  /** Include nodes that carry neither text nor a debugName. */
  readonly all: boolean;
  /** Under a declared shutter, the picture each node is classified in.
   *  Absent means the exposure. */
  readonly read?: Reading;
  readonly flags: GlobalFlags;
}

export interface NodeSpan {
  readonly id: number;
  readonly kind: string;
  readonly name?: string;
  readonly text?: string;
  /** Sampled frames at which the node contributed a pixel. */
  readonly onScreen: readonly number[];
  /** Sampled frames at which it emitted geometry and nothing survived. */
  readonly covered: readonly number[];
  /** Sampled frames at which it emitted no geometry at all. */
  readonly declaredInvisible: readonly number[];
  /** Sampled frames the table says cannot happen (see visibility.ts). */
  readonly impossible: readonly number[];
  /** It paints somewhere and no sampled frame shows any of it. Reported for
   *  every node; a failure only when the node is named. */
  readonly neverShown: boolean;
  /** A sampled frame shows it and a LATER one has it covered — the ordering
   *  is what separates a burial from a reveal, and `compositions/spanned`'s
   *  `revealed` is the tree's only reveal. Same rule about the name. */
  readonly buriedAfterShown: boolean;
}

/** Default sample count. A draw walk for the rect, then a render and a
 *  draw-list hash per node per frame — `samples` of each under a shutter,
 *  unless `--read tick` — is what each one costs, so this is the knob that
 *  decides the runtime. */
export const DEFAULT_SAMPLES = 24;

/** How many examples a summary shows before it says how many it left out. */
const EXAMPLES = 5;

/**
 * `--samples` as a number, or a usage error naming what was typed.
 *
 * Separate from `run()` because a usage error must not depend on an artifact.
 * The check used to sit after `resolveComposition`, so on a machine with no
 * built bundle `--samples notanumber` reported the missing bundle instead —
 * and the test for it only passed where an earlier run happened to have left
 * one on disk. A fresh worktree is what found that. The test now names a
 * bundle that cannot exist, so the ordering is the only thing that can make
 * it pass.
 */
export function parseSamples(raw: string | number | boolean | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new UsageError(`--samples ${String(raw)} must be a positive integer`);
  }
  return n;
}

/**
 * The verdict, in one place so the exit code and the JSON `ok` cannot drift.
 *
 * `impossible` is in here and was not at first: the command printed a
 * paragraph about the host being broken and then exited 0, which is a green
 * gate sitting next to the statement that every reading behind it was taken
 * through a broken host. It cannot be produced by a working one, so this is
 * the only seam a test can reach.
 */
export function isClean(v: {
  readonly failures: readonly unknown[];
  readonly impossible: readonly unknown[];
}): boolean {
  return v.failures.length === 0 && v.impossible.length === 0;
}

/**
 * Evenly spaced frame indices over `[0, durationFrames)`, both ends included.
 *
 * Exported because the spacing is the command's claim: which frames it looked
 * at is the difference between "this film is clean" and "these 24 frames are".
 */
export function sampleFrames(durationFrames: number, samples: number): number[] {
  const n = Math.max(1, Math.min(samples, durationFrames));
  if (n === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = Math.round((i * (durationFrames - 1)) / (n - 1));
    if (out[out.length - 1] !== f) out.push(f);
  }
  return out;
}

/** A row's name. Whitespace collapses, and a text run that is only whitespace
 *  falls back to the kind rather than printing a blank row — those are 18 of
 *  the 26 never-shown nodes on the ledger, and a blank line reads as a bug in
 *  the report rather than as the space it is. */
const label = (n: NodeSpan): string => {
  if (n.name) return n.name.slice(0, 40);
  const text = (n.text ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 40) : `${n.kind} #${n.id}`;
};

export async function run(options: VisibilityOptions): Promise<CommandResult> {
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
  // `runFromArgv` has already rejected a bad one; a caller reaching `run()`
  // directly gets the same message from the same place.
  const requested = parseSamples(options.samplesRaw ?? options.samples) ?? DEFAULT_SAMPLES;
  const frames = sampleFrames(c.durationFrames, requested);

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

    // getTree runs one frame turn and leaves the world at frame 0, exactly as
    // `layout` documents. Everything after this advances from there.
    const tree = world.getTree() as TreeNode | undefined;
    // Explicit, not the default: this command's whole output is the
    // classification, and inheriting it from a parameter default is how it
    // would quietly stop being asked for.
    const prober = openProber(world, {
      classify: true,
      ...(options.read ? { read: options.read } : {}),
    });
    footage = c.sidecar.footage.length > 0 ? await openFootage(c, world, tree) : null;

    const spans = new Map<
      number,
      { entry: TreeNode; text?: string; on: number[]; cov: number[]; dark: number[]; odd: number[] }
    >();
    for (const { node, text } of flattenTree(tree, options.all)) {
      spans.set(node.i, { entry: node, text, on: [], cov: [], dark: [], odd: [] });
    }

    let at = 0;
    for (const frame of frames) {
      for (; at < frame; at++) {
        world.frame(0);
        for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
      }
      footage?.present(frame);
      const base = baseline(prober);
      for (const span of spans.values()) {
        const id = span.entry.i;
        // No box means the walk never reached the node — display:none, or an
        // ancestor whose opacity culled the subtree. It emitted nothing, so it
        // belongs with the declared-invisible; asking the probe would give the
        // same answer at the cost of a render and a hash.
        if (rect(prober, id).xy === -1) {
          span.dark.push(frame);
          continue;
        }
        const verdict = probe(prober, id, base).visibility;
        if (verdict === "on-screen") span.on.push(frame);
        else if (verdict === "covered") span.cov.push(frame);
        else if (verdict === "declared-invisible") span.dark.push(frame);
        else if (verdict === "impossible") span.odd.push(frame);
        else {
          // `undefined` means the prober was opened without classification,
          // which is a wiring mistake here and NOT the `impossible` reading.
          // Folding it into that bucket would report a broken host.
          throw new Error(
            "visibility: the prober returned no verdict — it was opened without " +
              "classification, so `paints` was never measured",
          );
        }
      }
    }
    baseline(prober); // leave every latch clear

    const report: NodeSpan[] = [...spans.values()].map((s) => ({
      id: s.entry.i,
      kind: s.entry.t,
      ...(s.entry.n ? { name: s.entry.n } : {}),
      ...(s.text ? { text: s.text } : {}),
      onScreen: s.on,
      covered: s.cov,
      declaredInvisible: s.dark,
      impossible: s.odd,
      neverShown: s.cov.length > 0 && s.on.length === 0,
      // Strictly after the last frame that showed it. A node covered BEFORE
      // it is shown is a reveal, which is not this.
      buriedAfterShown:
        s.on.length > 0 && s.cov.some((f) => f > s.on[s.on.length - 1]!),
    }));

    const named = report.filter((n) => n.name);
    const neverShown = report.filter((n) => n.neverShown);
    const buried = report.filter((n) => n.buriedAfterShown);
    const failures = [...neverShown, ...buried].filter((n) => n.name);
    const everCovered = report.filter((n) => n.covered.length > 0);
    const neverPaints = report.filter(
      (n) => n.onScreen.length === 0 && n.covered.length === 0,
    );
    const impossible = report.filter((n) => n.impossible.length > 0);

    const example = (n: NodeSpan): string =>
      `  ${label(n).padEnd(42)} covered at ${n.covered.length} of ${frames.length} ` +
      `sample(s), first at frame ${n.covered[0]}`;
    const buriedExample = (n: NodeSpan): string =>
      `  ${label(n).padEnd(42)} shown through frame ${n.onScreen[n.onScreen.length - 1]}, ` +
      `covered from ${n.covered.find((f) => f > n.onScreen[n.onScreen.length - 1]!)} ` +
      `(${n.onScreen.length} shown, ${n.covered.length} covered, of ${frames.length})`;

    const stdoutLines = [
      `visibility over ${frames.length} of ${c.durationFrames} frame(s) — ` +
        `${report.length} named/text node(s), ${named.length} of them named`,
      "",
      ...(neverShown.filter((n) => n.name).length > 0
        ? [
            `${neverShown.filter((n) => n.name).length} named node(s) paint and no sampled ` +
              "frame shows any of them:",
            ...neverShown.filter((n) => n.name).map(example),
            "",
          ]
        : []),
      ...(buried.filter((n) => n.name).length > 0
        ? [
            `${buried.filter((n) => n.name).length} named node(s) were shown and then covered ` +
              "at a later sampled frame:",
            ...buried.filter((n) => n.name).map(buriedExample),
            "",
          ]
        : []),
      ...(impossible.length > 0
        ? [
            `${impossible.length} node(s) changed a pixel while removing no word from the`,
            "draw list. The framebuffer is a function of that word stream, so this",
            "cannot happen — the host is broken, and every other reading in this",
            "report was taken through it. See src/render/visibility.ts.",
            "",
          ]
        : []),
      `${everCovered.length} node(s) covered at some sampled frame — ordinary at a cut.`,
      `${neverPaints.length} node(s) emitted nothing at any sampled frame.`,
      `${neverShown.length} node(s) paint and are never shown, ` +
        `${neverShown.filter((n) => n.name).length} of them named` +
        (neverShown.length > 0 ? ":" : "."),
      ...neverShown.slice(0, EXAMPLES).map(example),
      ...(neverShown.length > EXAMPLES ? [`  … ${neverShown.length - EXAMPLES} more`] : []),
      `${buried.length} node(s) were shown and then covered, ` +
        `${buried.filter((n) => n.name).length} of them named` +
        (buried.length > 0 ? ":" : "."),
      ...buried.slice(0, EXAMPLES).map(buriedExample),
      ...(buried.length > EXAMPLES ? [`  … ${buried.length - EXAMPLES} more`] : []),
      "",
      `Frames sampled: ${
        frames.length === 1 ? frames[0] : `${frames[0]}…${frames[frames.length - 1]}`
      } (--samples ${requested}). A node covered for fewer frames`,
      "than the stride can fall between two samples.",
      "Only a NAMED node is a failure — never shown, or shown and then buried;",
      "the rest of both columns is reported. `bun scripts/visibility.ts` is what",
      "holds these counts across the tree — this run measured only this one.",
      ...shutterLines(c.shutter, options.read),
    ];

    return {
      exitCode: isClean({ failures, impossible }) ? EXIT_OK : EXIT_FAIL,
      json: {
        ok: isClean({ failures, impossible }),
        frames,
        durationFrames: c.durationFrames,
        nodes: report,
        // Named and never shown — the failure. `neverShown` is the same
        // observation over every node, which is reported and not failed on.
        failures: failures.map(label),
        neverShown: neverShown.map(label),
        buriedAfterShown: buried.map(label),
        namedNodes: named.length,
        everCovered: everCovered.length,
        neverPaints: neverPaints.length,
        impossible: impossible.map(label),
        ...shutterJson(c.shutter, options.read),
      },
      stdoutLines,
      stderrLines: [
        ...neverShown
          .filter((n) => n.name)
          .map((n) => `visibility: ${label(n)} paints and no sampled frame shows it`),
        ...buried
          .filter((n) => n.name)
          .map(
            (n) =>
              `visibility: ${label(n)} was shown through frame ` +
              `${n.onScreen[n.onScreen.length - 1]} and covered after it`,
          ),
        ...impossible.map(
          (n) => `visibility: ${n} changed a pixel while removing no draw-list word`,
        ),
      ],
    };
  } catch (e) {
    const message = errMsg(e);
    return {
      exitCode: EXIT_FAIL,
      json: { ok: false, error: message },
      stderrLines: [message],
      stdoutLines: [`visibility failed — ${message}`],
    };
  } finally {
    await footage?.close();
  }
}

export async function runFromArgv(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseArgs(["visibility", ...argv]);
  const dir = requirePositional(parsed.positionals, 0, "composition-dir");
  const samples = parsed.flags.samples;
  // Before anything resolves: a bad flag is a usage error whatever is on disk.
  const parsedSamples = parseSamples(samples);
  const read = parseRead(parsed.flags.read);
  return run({
    dir,
    ...(parsedSamples === undefined
      ? {}
      : { samples: parsedSamples, samplesRaw: String(samples) }),
    all: parsed.flags.all === true,
    ...(read ? { read } : {}),
    flags: parsed.global,
  });
}
