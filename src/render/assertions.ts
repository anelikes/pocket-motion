/**
 * What the sidecar says a node is supposed to do, checked against the picture.
 *
 * Every generator in this repository already asserts its own intent — a
 * dialogue line's composition frame re-derived and compared against the
 * constant beside it, a cue that must survive into the mix — and every one of
 * those assertions is about a NUMBER the generator computed. None of them is
 * about a pixel. So a caption can be asserted into existence, laid out
 * correctly, and painted over, and every assertion in the tree stays true.
 *
 * These are the other kind: they are evaluated from the same sweep
 * `visibility` runs, so what they are about is whether the node was ON SCREEN.
 *
 * WHAT AN ASSERTION CLAIMS, EXACTLY
 *
 * Sampled frames, and nothing between them. `entersBy: 40` passing means some
 * SAMPLED frame at or before 40 showed the node. That is a property of
 * sampling and not a bug to be smoothed: the verdict names the frames it
 * looked at, and `--samples` is the lever. The exact case,
 * `--samples durationFrames`, is available and costs what it costs.
 *
 * WHICH FRAMES ARE SAMPLED
 *
 * An evenly spaced grid alone decides a window narrower than its stride by
 * where the stride happens to fall. Measured on hajibang's ranking template
 * (the port on branch `claude/angry-carson-0abed5`), its twenty-rank request:
 * 1 s a rank over 1,125 frames, so 24 samples step every 49 and most ranks
 * held none. 66 of its 107 assertions failed on a correct film — 26 with "no
 * sampled frame falls in" and 40 with "no node carries the debugName" about
 * nodes the tree carries. `compositions/short-sections` is that shape at
 * fixture size. So `assert` samples, besides the grid, the frames each
 * assertion itself names (`assertionFrames`):
 *
 *   inPicture [from, to]   from and to
 *   entersBy N             N — the last frame it may first be shown at
 *   exitsBy N              N and N + 1 — the last frame it may be shown at and
 *                          the first it may not
 *
 * `before` names no frame. What it compares is two first showings, so its
 * pair is found rather than named (`pinFrames`): once the grid has been read,
 * every frame between each node's first showing and the sampled frame before
 * it is sampled too, which puts each first showing on the frame it happens.
 * Two entrances inside one stride otherwise read as one sampled frame, and a
 * strict "earlier than" fails on a tie the film does not have.
 *
 * `insideBox` and `dwellFrames` name no frame and add none.
 *
 * Adding frames can only make a verdict more exact, never vacuous: a frame
 * added inside a dwell run that does not show the node breaks the run, which
 * is what the node did.
 *
 * `dwellFrames` is the one where this matters most, so it is defined
 * conservatively: the span of the longest run of CONSECUTIVE sampled frames
 * that show the node, measured from the first of that run to the last, plus
 * one. A run that is one sample long spans one frame by this measure, however
 * wide the stride — the sweep saw the node at one instant and has no evidence
 * about its neighbours.
 */

import type { SidecarAssertion } from "../manifest/sidecar.ts";

/** One node's classification across the sweep, as `visibility` produces it. */
export interface SweptNode {
  readonly name?: string;
  /** Sampled frames at which the node contributed a pixel. */
  readonly onScreen: readonly number[];
  /** Sampled frames at which it emitted geometry and nothing survived. */
  readonly covered: readonly number[];
  /** Sampled frames at which it had a box that left its container or the
   *  canvas — the `insideBox` predicate's evidence, from the layout codes. */
  readonly outsideBox: readonly number[];
  /** Sampled frames at which it had a box at all. */
  readonly hasBox: readonly number[];
}

export interface AssertionVerdict {
  readonly node: string;
  /** The predicate key, as written. */
  readonly predicate: string;
  /** The predicate's value, as written. */
  readonly expected: unknown;
  readonly ok: boolean;
  /** One line naming what was measured, whether it passed or failed. */
  readonly detail: string;
}

export interface EvaluateInputs {
  readonly assertions: readonly SidecarAssertion[];
  /**
   * By `debugName`: each node the sweep laid out at a sampled frame. A name
   * missing here is a failure, not a skip, whether or not the tree carries it.
   */
  readonly nodes: ReadonlyMap<string, SweptNode>;
  /** The frames the sweep looked at, ascending. */
  readonly frames: readonly number[];
  /**
   * Every debugName the tree carries, in document order. It separates the two
   * ways a name can be missing from `nodes` — no node carries it, or a node
   * does and no sampled frame laid it out — and it is what a name of the first
   * kind is told the composition carries. Absent means `nodes`' own keys, and
   * then every missing name reads as the first kind.
   */
  readonly named?: readonly string[];
}

const list = (frames: readonly number[]): string =>
  frames.length === 0
    ? "none"
    : frames.length <= 6
      ? frames.join(", ")
      : `${frames.slice(0, 3).join(", ")} … ${frames.slice(-2).join(", ")} (${frames.length})`;

/** The predicate an entry names, and its value. Exactly one exists. */
export function predicateOf(a: SidecarAssertion): { key: string; value: unknown } {
  for (const key of ["inPicture", "entersBy", "exitsBy", "insideBox", "dwellFrames", "before"]) {
    if (key in a) return { key, value: (a as unknown as Record<string, unknown>)[key] };
  }
  // The parser refuses an entry naming none, so reaching this means a caller
  // built an assertion by hand. Say so rather than return a made-up verdict.
  throw new Error(`assertion for ${a.node} names no predicate`);
}

/**
 * The frames the assertions themselves name, ascending and inside the clock.
 *
 * The header's table is the rule. The parser has already held every frame to
 * the clock; the bound here is for `exitsBy`'s N + 1 on the last frame, which
 * no frame can follow.
 */
export function assertionFrames(
  assertions: readonly SidecarAssertion[],
  durationFrames: number,
): number[] {
  const out = new Set<number>();
  const add = (f: number): void => {
    if (f >= 0 && f < durationFrames) out.add(f);
  };
  for (const a of assertions) {
    if ("inPicture" in a) {
      add(a.inPicture[0]);
      add(a.inPicture[1]);
    } else if ("entersBy" in a) {
      add(a.entersBy);
    } else if ("exitsBy" in a) {
      add(a.exitsBy);
      add(a.exitsBy + 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * The frames that put each `before` node's first showing where it happens.
 *
 * For each node a `before` compares, every frame strictly between its first
 * showing on `frames` and the sampled frame before that one. Sampled, those
 * frames leave the node's first showing at the earliest frame of that gap
 * that shows it, which is the frame it entered unless it was also shown and
 * hidden again inside an earlier gap — a stretch no grid short of every frame
 * sees. A node no sampled frame shows has no gap to search, and adds nothing.
 */
export function pinFrames(
  assertions: readonly SidecarAssertion[],
  nodes: ReadonlyMap<string, SweptNode>,
  frames: readonly number[],
): number[] {
  const out = new Set<number>();
  for (const a of assertions) {
    if (!("before" in a)) continue;
    for (const name of [a.node, a.before]) {
      const first = nodes.get(name)?.onScreen[0];
      if (first === undefined) continue;
      const i = frames.indexOf(first);
      const prev = i > 0 ? frames[i - 1]! : -1;
      for (let f = prev + 1; f < first; f++) out.add(f);
    }
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * Why a name has no sweep entry, as the verdict's detail.
 *
 * Two different facts, and the message used to state the first for both. A
 * name no node carries is a rename or a typo. A name the tree carries with no
 * entry is a node the draw walk reached at none of the sampled frames: it, or
 * an ancestor, was `display: none`, or an ancestor was at opacity 0 and the
 * walk returned above it (`draw.rs`). A node at its OWN opacity 0 still has a
 * box, so it is never this. Both are failures — neither has any evidence
 * behind it — and only the first is about the name.
 */
function absent(name: string, inputs: EvaluateInputs): string {
  const named = inputs.named ?? [...inputs.nodes.keys()];
  if (named.includes(name)) {
    return (
      `${JSON.stringify(name)} is in the tree and was laid out at none of the ` +
      `${inputs.frames.length} sampled frame(s) (${list(inputs.frames)}): the draw walk ` +
      "did not reach it at any of them — it or an ancestor was display: none, or an " +
      "ancestor was at opacity 0 — so no sampled frame carries evidence about it"
    );
  }
  // An assertion about a node nobody named is not vacuously true. A renamed
  // `debugName` would otherwise turn every assertion about it green at once,
  // which is the failure mode that costs the most.
  return (
    `no node carries the debugName ${JSON.stringify(name)}. ` +
    `Named in this composition: ${named.slice(0, 8).join(", ") || "(none)"}` +
    (named.length > 8 ? ` … (${named.length})` : "")
  );
}

/**
 * The longest run of consecutive SAMPLED frames showing the node, in
 * composition frames.
 *
 * `frames` is the whole grid; a run is broken by a sampled frame that did not
 * show the node, not by the gap between two samples.
 */
export function dwellSpan(
  onScreen: readonly number[],
  frames: readonly number[],
): number {
  const shown = new Set(onScreen);
  let best = 0;
  let runStart: number | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (shown.has(f)) {
      if (runStart === null) runStart = f;
      best = Math.max(best, f - runStart + 1);
    } else {
      runStart = null;
    }
  }
  return best;
}

export function evaluateAssertions(inputs: EvaluateInputs): AssertionVerdict[] {
  const out: AssertionVerdict[] = [];
  for (const a of inputs.assertions) {
    const { key, value } = predicateOf(a);
    const node = inputs.nodes.get(a.node);
    if (node === undefined) {
      out.push({
        node: a.node,
        predicate: key,
        expected: value,
        ok: false,
        detail: absent(a.node, inputs),
      });
      continue;
    }
    out.push(verdict(a, key, value, node, inputs));
  }
  return out;
}

function verdict(
  a: SidecarAssertion,
  key: string,
  value: unknown,
  node: SweptNode,
  inputs: EvaluateInputs,
): AssertionVerdict {
  const base = { node: a.node, predicate: key, expected: value };
  const shown = node.onScreen;

  switch (key) {
    case "inPicture": {
      const [from, to] = value as [number, number];
      const within = inputs.frames.filter((f) => f >= from && f <= to);
      const missing = within.filter((f) => !shown.includes(f));
      return {
        ...base,
        ok: within.length > 0 && missing.length === 0,
        detail:
          within.length === 0
            ? `no sampled frame falls in [${from}, ${to}] — raise --samples`
            : missing.length === 0
              ? `shown at all ${within.length} sampled frame(s) in [${from}, ${to}]`
              : `not shown at ${list(missing)} of the ${within.length} sampled frame(s) in ` +
                `[${from}, ${to}]; covered at ${list(node.covered.filter((f) => f >= from && f <= to))}`,
      };
    }
    case "entersBy": {
      const by = value as number;
      const first = shown[0];
      return {
        ...base,
        ok: first !== undefined && first <= by,
        detail:
          first === undefined
            ? `no sampled frame shows it at all`
            : `first shown at sampled frame ${first}` + (first <= by ? "" : `, after ${by}`),
      };
    }
    case "exitsBy": {
      const by = value as number;
      const after = shown.filter((f) => f > by);
      return {
        ...base,
        ok: after.length === 0,
        detail:
          after.length === 0
            ? shown.length === 0
              ? "no sampled frame shows it at all"
              : `last shown at sampled frame ${shown[shown.length - 1]}`
            : `still shown at ${list(after)}, after ${by}`,
      };
    }
    case "insideBox": {
      return {
        ...base,
        ok: node.outsideBox.length === 0,
        detail:
          node.outsideBox.length === 0
            ? `inside its container and the canvas at all ${node.hasBox.length} sampled frame(s) it has a box`
            : `outside at ${list(node.outsideBox)} of the ${node.hasBox.length} sampled frame(s) it has a box`,
      };
    }
    case "dwellFrames": {
      const want = value as number;
      const got = dwellSpan(shown, inputs.frames);
      return {
        ...base,
        ok: got >= want,
        detail:
          `longest run of consecutive sampled frames showing it spans ${got} frame(s); ` +
          `wanted ${want}`,
      };
    }
    case "before": {
      const other = inputs.nodes.get(value as string);
      if (other === undefined) {
        return { ...base, ok: false, detail: absent(value as string, inputs) };
      }
      const mine = shown[0];
      const theirs = other.onScreen[0];
      return {
        ...base,
        ok: mine !== undefined && theirs !== undefined && mine < theirs,
        detail:
          mine === undefined
            ? "no sampled frame shows it at all"
            : theirs === undefined
              ? `no sampled frame shows ${JSON.stringify(value)} at all`
              : `first shown at ${mine}; ${JSON.stringify(value)} at ${theirs}`,
      };
    }
    default:
      throw new Error(`unknown assertion predicate ${key}`);
  }
}
