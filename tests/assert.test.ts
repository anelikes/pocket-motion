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
  mentionedNames,
  run as runAssert,
  runFromArgv as assertFromArgv,
  sweepNamedNodes,
} from "../src/cli/commands/assert.ts";
import { UsageError } from "../src/cli/args.ts";
import { sampleFrames } from "../src/cli/commands/visibility.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";
import {
  dwellSpan,
  evaluateAssertions,
  predicateOf,
  type SweptNode,
} from "../src/render/assertions.ts";
import type { SidecarAssertion } from "../src/manifest/sidecar.ts";

const ROOT = resolve(import.meta.dir, "..");

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
    // The list a failing name is answered with does not depend on the filter.
    expect(narrow.named).toEqual([...full.nodes.keys()]);
    expect(full.named).toEqual([...full.nodes.keys()]);
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
