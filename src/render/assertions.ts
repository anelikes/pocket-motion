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
 * SAMPLED frame at or before 40 showed the node — at 24 samples over 240
 * frames the stride is about 10, so a node that appears at 38 and is asserted
 * `entersBy: 39` can fail on a grid that has no sample in between. That is a
 * property of sampling and not a bug to be smoothed: the verdict names the
 * frames it looked at, and `--samples` is the lever. The exact case,
 * `--samples durationFrames`, is available and costs what it costs.
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
  /** By `debugName`. A name the tree does not carry is a failure, not a skip. */
  readonly nodes: ReadonlyMap<string, SweptNode>;
  /** The frames the sweep looked at, ascending. */
  readonly frames: readonly number[];
  /**
   * Every debugName the sweep saw a box for, first seen first — what a failing
   * name is told the composition carries. Absent means `nodes`' own keys,
   * which is the same list when every named node was classified; `assert`
   * classifies only the names its assertions mention and passes this.
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
        // An assertion about a node nobody named is not vacuously true. A
        // renamed `debugName` would otherwise turn every assertion about it
        // green at once, which is the failure mode that costs the most.
        detail:
          `no node carries the debugName ${JSON.stringify(a.node)}. ` +
          `Named in this composition: ${
            (inputs.named ?? [...inputs.nodes.keys()]).slice(0, 8).join(", ") || "(none)"
          }`,
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
        return {
          ...base,
          ok: false,
          detail: `no node carries the debugName ${JSON.stringify(value)}`,
        };
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
