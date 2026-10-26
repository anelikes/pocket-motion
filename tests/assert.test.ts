/**
 * Intent assertions, evaluated from the picture.
 *
 * The cases that matter are the two `compositions/spanned` was built for.
 * `spanning` is a caption meant to carry across a cut and covered from frame 72
 * to the end; `revealed` is covered first and shown after, which is a reveal and
 * not a burial. An assertion that `spanning` is in the picture for its whole
 * clock must FAIL, and one that `revealed` enters by its real frame must PASS —
 * on the same sweep, so the difference is the predicate and not the run.
 *
 * They are written here rather than into that fixture's sidecar on purpose.
 * `compositions/spanned`'s row in `baselines/visibility.json` is a recorded red
 * case; editing its sidecar to carry a failing assertion would mean changing a
 * fixture whose whole value is that nothing about it moves. (An assertion could
 * not move its digest — `identityProjection` drops the key and
 * `tests/identity.test.ts` proves it — but a fixture edited for a test's
 * convenience stops being the thing the other tests are reading.)
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import {
  assertComposition,
  mentionedNames,
  mergeSweeps,
  run as runAssert,
  runFromArgv as assertFromArgv,
  sweepNamedNodes,
  type AssertGrid,
} from "../src/cli/commands/assert.ts";
import { UsageError } from "../src/cli/args.ts";
import { sampleFrames } from "../src/cli/commands/visibility.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";
import {
  assertionFrames,
  dwellSpan,
  evaluateAssertions,
  pinFrames,
  predicateOf,
  type AssertionVerdict,
  type SweptNode,
} from "../src/render/assertions.ts";
import type { SidecarAssertion } from "../src/manifest/sidecar.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
process.env.POCKETJS_ROOT = VENDOR;

const SAMPLES = 24;
const FRAMES = sampleFrames(240, SAMPLES);

let spanned: ResolvedComposition;
let swept: Map<string, SweptNode>;

async function sweepOnce(): Promise<Map<string, SweptNode>> {
  if (swept) return swept;
  const resolved = await resolveComposition({
    dir: join(ROOT, "compositions", "spanned"),
    flags: { json: false },
    requireBundle: false,
  });
  if (!resolved.ok) throw new Error(`spanned did not resolve: ${resolved.message}`);
  spanned = resolved.value;
  await runBuild(spanned);
  swept = (await sweepNamedNodes(spanned, FRAMES)).nodes;
  return swept;
}

function verdict(a: SidecarAssertion, nodes: Map<string, SweptNode>) {
  const [only] = evaluateAssertions({ assertions: [a], nodes, frames: FRAMES });
  return only!;
}

describe("assertions against compositions/spanned", () => {
  test("the caption asserted in picture for its whole clock FAILS", async () => {
    const nodes = await sweepOnce();
    const v = verdict({ node: "spanning", inPicture: [0, 239] }, nodes);
    expect(v.ok).toBe(false);
    // The sweep is what says so: `spanning` is shown through the samples before
    // 72 and covered from there to the end.
    expect(v.detail).toContain("not shown at");
    expect(v.detail).toContain("covered at");
  }, 180_000);

  test("the same caption asserted only over the frames it IS up passes", async () => {
    const nodes = await sweepOnce();
    const shown = nodes.get("spanning")!.onScreen;
    expect(shown.length).toBeGreaterThan(0);
    const v = verdict({ node: "spanning", inPicture: [0, shown[shown.length - 1]!] }, nodes);
    expect(v.ok).toBe(true);
  }, 180_000);

  test("the reveal asserted to enter by its real frame PASSES", async () => {
    const nodes = await sweepOnce();
    const first = nodes.get("revealed")!.onScreen[0]!;
    expect(first).toBeGreaterThan(0); // it is covered before it is shown
    expect(verdict({ node: "revealed", entersBy: first }, nodes).ok).toBe(true);
    // One sample earlier is the boundary, and it fails — so the predicate is
    // reading the sweep rather than answering yes to anything.
    const before = FRAMES[FRAMES.indexOf(first) - 1]!;
    expect(verdict({ node: "revealed", entersBy: before }, nodes).ok).toBe(false);
  }, 180_000);

  test("exitsBy, dwellFrames and before read the same sweep", async () => {
    const nodes = await sweepOnce();
    const spanningShown = nodes.get("spanning")!.onScreen;
    const last = spanningShown[spanningShown.length - 1]!;
    expect(verdict({ node: "spanning", exitsBy: last }, nodes).ok).toBe(true);
    expect(verdict({ node: "spanning", exitsBy: 0 }, nodes).ok).toBe(false);

    const span = dwellSpan(spanningShown, FRAMES);
    expect(verdict({ node: "spanning", dwellFrames: span }, nodes).ok).toBe(true);
    expect(verdict({ node: "spanning", dwellFrames: span + 1 }, nodes).ok).toBe(false);

    // `spanning` is up from frame 0; `revealed` is covered until `early-lid`
    // clears. So one is before the other, and not the other way round.
    expect(verdict({ node: "spanning", before: "revealed" }, nodes).ok).toBe(true);
    expect(verdict({ node: "revealed", before: "spanning" }, nodes).ok).toBe(false);
  }, 180_000);

  test("`above` sits inside its container at every sampled frame", async () => {
    const nodes = await sweepOnce();
    expect(verdict({ node: "above", insideBox: true }, nodes).ok).toBe(true);
  }, 180_000);

  test("an assertion about a node nobody named fails and says which names exist", async () => {
    const nodes = await sweepOnce();
    const v = verdict({ node: "no-such-caption", entersBy: 10 }, nodes);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("no node carries the debugName");
    expect(v.detail).toContain("spanning");
  }, 180_000);
});

describe("the command", () => {
  test("a composition with no assertions is a clean exit that says so", async () => {
    await sweepOnce();
    const result = await runAssert({ dir: spanned.dir, samples: 2, flags: { json: true } });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as { ok: boolean; assertions: unknown[]; note?: string };
    expect(json.ok).toBe(true);
    expect(json.assertions).toEqual([]);
    expect(json.note).toContain("no assertions");
  }, 180_000);

  test("the fixture's own assertions pass, and the exit code follows the payload", async () => {
    const dir = join(ROOT, "compositions", "layout-codes");
    const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
    if (!resolved.ok) throw new Error("layout-codes did not resolve");
    await runBuild(resolved.value);
    const result = await runAssert({ dir, samples: 3, flags: { json: true } });
    const json = result.json as { ok: boolean; assertions: Array<{ ok: boolean }>; failures: string[] };
    expect(json.assertions.length).toBeGreaterThan(0);
    expect(json.failures).toEqual([]);
    expect(json.ok).toBe(true);
    expect(result.exitCode).toBe(EXIT_OK);
    // The two cannot disagree: one of them would be lying.
    expect(result.exitCode === EXIT_OK).toBe(json.ok);
    expect(EXIT_FAIL).toBe(1);
  }, 180_000);
});

describe("what the command classifies", () => {
  // `compositions/layout-codes` carries one named node per finding code, so a
  // narrowed sweep can be held to the full one on the codes `insideBox` reads:
  // `escapee` escapes its container, `offscreen` collapses against the canvas
  // edge, and `wing`'s escape is excused in the sidecar.
  const names = new Set(["escapee", "offscreen", "wing", "overlap-a"]);

  test("only the names the assertions mention, each entry the full sweep's", async () => {
    const dir = join(ROOT, "compositions", "layout-codes");
    const resolved = await resolveComposition({ dir, flags: { json: false }, requireBundle: false });
    if (!resolved.ok) throw new Error("layout-codes did not resolve");
    await runBuild(resolved.value);
    const frames = sampleFrames(resolved.value.durationFrames, 6);
    const full = await sweepNamedNodes(resolved.value, frames);
    const narrow = await sweepNamedNodes(resolved.value, frames, { names });

    // Red with the filter removed: every named node comes back classified.
    expect([...narrow.nodes.keys()].sort()).toEqual([...names].sort());
    expect(full.nodes.size).toBeGreaterThan(names.size);
    // Red with the ancestors left out of a narrowed sweep: `escapee` loses its
    // container and reads inside it.
    for (const name of names) expect(narrow.nodes.get(name), name).toEqual(full.nodes.get(name));
    expect(narrow.nodes.get("escapee")!.outsideBox.length).toBe(frames.length);
    expect(narrow.nodes.get("offscreen")!.outsideBox.length).toBeGreaterThan(0);
    expect(narrow.nodes.get("wing")!.outsideBox).toEqual([]);
    // The list a failing name is answered with is the tree's, so it does not
    // depend on the filter, and it holds every name the full sweep laid out.
    expect(narrow.named).toEqual(full.named);
    for (const name of full.nodes.keys()) expect(full.named).toContain(name);
  }, 180_000);

  test("an assertion's own node and its `before` target are what is mentioned", () => {
    expect(
      [...mentionedNames([
        { node: "a", entersBy: 3 },
        { node: "b", before: "c" },
        { node: "a", insideBox: true },
      ])].sort(),
    ).toEqual(["a", "b", "c"]);
  });

  test("`--read` takes exposure or tick, and refuses anything else before resolving", async () => {
    await expect(
      assertFromArgv(["compositions/no-such-composition", "--read", "blur"]),
    ).rejects.toThrow(UsageError);
  });
});

// `compositions/short-sections` is a ranking at hajibang's proportions: ranks
// of 9 frames under a 24-sample grid that steps every 13, each rank's card at
// opacity 0 outside its window. Its sidecar is true at every frame. What these
// hold is that the DEFAULT grid can read it: before `assert` sampled the
// frames its assertions name, 8 of the 19 failed and five of those said no
// node carried a name the tree carries.
describe("sections shorter than the stride — compositions/short-sections", () => {
  const SHORT = join(ROOT, "compositions", "short-sections");
  let short: ResolvedComposition | undefined;
  async function resolveShort(): Promise<ResolvedComposition> {
    if (short) return short;
    const resolved = await resolveComposition({ dir: SHORT, flags: { json: false }, requireBundle: false });
    if (!resolved.ok) throw new Error(`short-sections did not resolve: ${resolved.message}`);
    await runBuild(resolved.value);
    short = resolved.value;
    return short;
  }
  interface AssertJson {
    ok: boolean;
    frames: number[];
    grid: AssertGrid;
    assertions: AssertionVerdict[];
    failures: string[];
  }

  test("the default grid samples what each assertion names, and all 19 hold", async () => {
    await resolveShort();
    const result = await runAssert({ dir: SHORT, flags: { json: true } });
    const json = result.json as AssertJson;
    expect(json.failures).toEqual([]);
    expect(json.assertions.length).toBe(19);
    expect(result.exitCode).toBe(EXIT_OK);
    // Red with `assertionFrames` emptied: the 8 failures below come back.
    expect(json.grid.even).toEqual(sampleFrames(300, 24));
    expect(json.grid.asserted).toContain(111); // title-r3's first frame, in no stride
    expect(json.grid.asserted).toContain(90); // intro's exitsBy 89, and the frame after
    // title-r7 is first shown 3 frames after num-r7, whose window start is
    // sampled; the two frames between are pinned and do not show it.
    expect(json.grid.pinned).toEqual([145, 146]);
    // The parts are disjoint and `frames` is their union.
    const parts = [...json.grid.even, ...json.grid.asserted, ...json.grid.pinned];
    expect(new Set(parts).size).toBe(parts.length);
    expect(json.frames).toEqual([...parts].sort((a, b) => a - b));
  }, 180_000);

  test("on the evenly spaced grid alone 8 fail, and each says what was observed", async () => {
    const c = await resolveShort();
    const even = sampleFrames(c.durationFrames, 24);
    const sweep = await sweepNamedNodes(c, even, { names: mentionedNames(c.sidecar.assertions) });
    const verdicts = evaluateAssertions({
      assertions: c.sidecar.assertions,
      nodes: sweep.nodes,
      named: sweep.named,
      frames: even,
    });
    const failing = verdicts.filter((v) => !v.ok);
    expect(failing.map((v) => `${v.node} ${v.predicate}`)).toEqual([
      "title-r1 inPicture",
      "num-r3 inPicture",
      "title-r3 inPicture",
      "title-r4 inPicture",
      "num-r7 inPicture",
      "title-r7 inPicture",
      "num-r7 before",
      "outro entersBy",
    ]);
    // Ranks 3 and 7 hold no sampled frame. The tree carries both names, so the
    // message says the node was not laid out, and names the frames — not that
    // no node carries the name. Red with the old single message.
    for (const v of failing.filter((f) => /r[37]$/.test(f.node))) {
      expect(v.detail).toContain("is in the tree and was laid out at none of the 24 sampled frame(s)");
      expect(v.detail).toContain("0, 13, 26 … 286, 299 (24)");
      expect(v.detail).not.toContain("no node carries");
    }
    expect(failing[0]!.detail).toBe("no sampled frame falls in [93, 98] — raise --samples");
    // The other way a name goes missing still reads as itself.
    const typo = evaluateAssertions({
      assertions: [{ node: "num-r33", entersBy: 120 }],
      nodes: sweep.nodes,
      named: sweep.named,
      frames: even,
    })[0]!;
    expect(typo.ok).toBe(false);
    expect(typo.detail).toContain('no node carries the debugName "num-r33"');
    expect(typo.detail).toContain("num-r3"); // the tree's names, laid out or not
  }, 180_000);

  test("every frame agrees with the sidecar, so the default grid's pass is not a gap", async () => {
    await resolveShort();
    const json = (await runAssert({ dir: SHORT, samples: 300, flags: { json: true } })).json as AssertJson;
    expect(json.frames.length).toBe(300);
    expect(json.failures).toEqual([]);
  }, 180_000);

  test("`before`'s pair is pinned: two entrances inside one stride are not a tie", async () => {
    const c = await resolveShort();
    // Not the fixture's sidecar — an assertion set with nothing else naming
    // rank 2's frames, so the only sampled frame in rank 2 is the grid's 104,
    // where both nodes are up.
    const only = (assertions: readonly SidecarAssertion[]): ResolvedComposition => ({
      ...c,
      sidecar: { ...c.sidecar, assertions },
    });
    const forward = (await assertComposition(only([{ node: "num-r2", before: "title-r2" }]))).json as AssertJson;
    // Red with `pinFrames` emptied: "first shown at 104; title-r2 at 104".
    expect(forward.assertions[0]!.detail).toBe('first shown at 99; "title-r2" at 102');
    expect(forward.ok).toBe(true);
    expect(forward.grid.pinned).toEqual([92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103]);
    const backward = (await assertComposition(only([{ node: "title-r2", before: "num-r2" }]))).json as AssertJson;
    expect(backward.ok).toBe(false);
  }, 180_000);
});

describe("assertionFrames", () => {
  test("inPicture's ends, entersBy's frame, exitsBy's frame and the next", () => {
    expect(
      assertionFrames(
        [
          { node: "a", inPicture: [10, 20] },
          { node: "b", entersBy: 5 },
          { node: "c", exitsBy: 30 },
          { node: "d", insideBox: true },
          { node: "e", dwellFrames: 7 },
          { node: "f", before: "a" },
          { node: "g", inPicture: [20, 20] },
        ],
        100,
      ),
    ).toEqual([5, 10, 20, 30, 31]);
  });

  test("exitsBy on the last frame names no frame past the clock", () => {
    expect(assertionFrames([{ node: "a", exitsBy: 99 }], 100)).toEqual([99]);
  });
});

describe("pinFrames", () => {
  const node = (onScreen: number[]): SweptNode => ({
    onScreen,
    covered: [],
    outsideBox: [],
    hasBox: onScreen,
  });

  test("the frames between each node's first showing and the sample before it", () => {
    const frames = [0, 10, 20, 30];
    const nodes = new Map([
      ["a", node([20, 30])],
      ["b", node([30])],
    ]);
    expect(pinFrames([{ node: "a", before: "b" }], nodes, frames)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
  });

  test("a node first shown at frame 0, or never, has no gap to search", () => {
    const nodes = new Map([["a", node([0, 10])]]);
    expect(pinFrames([{ node: "a", before: "missing" }], nodes, [0, 10])).toEqual([]);
  });

  test("only `before` pins", () => {
    const nodes = new Map([["a", node([20])]]);
    expect(pinFrames([{ node: "a", entersBy: 20 }], nodes, [0, 10, 20])).toEqual([]);
  });
});

describe("mergeSweeps", () => {
  test("joins each node's frames in order and keeps a node only one sweep saw", () => {
    const a = {
      nodes: new Map<string, SweptNode>([
        ["x", { onScreen: [0, 20], covered: [], outsideBox: [20], hasBox: [0, 20] }],
      ]),
      named: ["x", "y"],
    };
    const b = {
      nodes: new Map<string, SweptNode>([
        ["x", { onScreen: [10], covered: [15], outsideBox: [], hasBox: [10, 15] }],
        ["y", { onScreen: [15], covered: [], outsideBox: [], hasBox: [15] }],
      ]),
      named: ["x", "y"],
    };
    const merged = mergeSweeps(a, b);
    expect(merged.nodes.get("x")).toEqual({
      onScreen: [0, 10, 20],
      covered: [15],
      outsideBox: [20],
      hasBox: [0, 10, 15, 20],
    });
    expect(merged.nodes.get("y")!.onScreen).toEqual([15]);
    expect(merged.named).toEqual(["x", "y"]);
  });
});

describe("dwellSpan", () => {
  test("a run of one sample spans one frame, whatever the stride", () => {
    expect(dwellSpan([50], [0, 25, 50, 75])).toBe(1);
  });

  test("consecutive samples span from the first to the last of the run", () => {
    expect(dwellSpan([25, 50, 75], [0, 25, 50, 75])).toBe(51);
    // A gap breaks the run: the sweep saw the node off at frame 50.
    expect(dwellSpan([0, 25, 75], [0, 25, 50, 75])).toBe(26);
  });
});

describe("predicateOf", () => {
  test("names the one predicate an entry carries", () => {
    expect(predicateOf({ node: "a", entersBy: 3 })).toEqual({ key: "entersBy", value: 3 });
    expect(predicateOf({ node: "a", inPicture: [0, 9] })).toEqual({
      key: "inPicture",
      value: [0, 9],
    });
  });

  test("an entry the parser would have refused throws rather than inventing one", () => {
    expect(() => predicateOf({ node: "a" } as unknown as SidecarAssertion)).toThrow(
      /names no predicate/,
    );
  });
});
