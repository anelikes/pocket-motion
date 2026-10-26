/**
 * `visibility` — is a node the author named painted over everywhere it paints?
 *
 * `compositions/occluded` is the controlled experiment and it is already in
 * the tree: three nodes, two of them `Text` with the same face and size, one
 * before an opaque lid in document order and one after. Nothing else differs.
 * The one before must fail and the one after must pass, so a green run here
 * cannot be a command that darkens everything named, and a red one cannot be a
 * command that fails on any named node it finds.
 *
 * The other half is the negative: `lint`, `check` and `trace` all pass on that
 * same composition, which is the whole shape of the defect — a wrong paint
 * order produces a stable, reproducible, self-consistent digest, and every
 * command that does not look at the picture says so.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { run as runCheck } from "../src/cli/commands/check.ts";
import { run as runLayout } from "../src/cli/commands/layout.ts";
import { run as runLint } from "../src/cli/commands/lint.ts";
import {
  isClean,
  run as runVisibility,
  runFromArgv as visibilityFromArgv,
  sampleFrames,
} from "../src/cli/commands/visibility.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";
import { writeBuildRecord } from "../src/render/build-record.ts";
import { classify } from "../src/render/visibility.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const OCCLUDED = join(ROOT, "compositions", "occluded");
const SMOKE = join(ROOT, "compositions", "smoke");
const LATE_ANIM = join(ROOT, "compositions", "late-anim");
const SPANNED = join(ROOT, "compositions", "spanned");
const TMP = scratchDir("visibility");

const dist = (name: string): string => join(TMP, name);
const flags = (name: string, extra: Record<string, unknown> = {}) =>
  ({
    json: true,
    bundle: join(dist(name), "main.js"),
    pak: join(dist(name), "main.pak"),
    ...extra,
  }) as never;

async function build(
  entryDir: string,
  name: string,
  opts: { config?: boolean } = {},
): Promise<void> {
  const outdir = dist(name);
  mkdirSync(outdir, { recursive: true });
  const argv = [
    "bun",
    join(VENDOR, "tools", "build.ts"),
    join(entryDir, "main.tsx"),
    `--outdir=${outdir}`,
    "--framework=solid",
    "--hz=60",
    ...(opts.config ? [] : ["--no-config"]),
  ];
  const proc = Bun.spawn(argv, {
    cwd: VENDOR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0 || !existsSync(join(outdir, "main.js"))) {
    throw new Error(`${entryDir} build failed (${code}): ${stderr}`);
  }
  // Every command that reads a bundle refuses one with no `build.json` beside
  // it; a fixture built by hand records what `runBuild` would have recorded.
  await writeBuildRecord(outdir, argv);
}

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  if (!existsSync(join(VENDOR, "tools", "build.ts"))) {
    throw new Error(`vendor pocketjs missing at ${VENDOR} — run bun scripts/vendor.ts`);
  }
  await build(OCCLUDED, "occluded");
  await build(SMOKE, "smoke");
  // late-anim's timing is in its own pocket.config.ts, so it must NOT be
  // built with --no-config the way the other two are.
  await build(LATE_ANIM, "late-anim", { config: true });
  // Its whole subject is the declared lifetime, which lives in its config.
  await build(SPANNED, "spanned", { config: true });
}, 180_000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

interface Json {
  ok: boolean;
  frames: number[];
  nodes: Array<{
    name?: string;
    onScreen: number[];
    covered: number[];
    declaredInvisible: number[];
    impossible: number[];
    neverShown: boolean;
    buriedAfterShown: boolean;
  }>;
  failures: string[];
  neverShown: string[];
  buriedAfterShown: string[];
  namedNodes: number;
  impossible: string[];
}

describe("the sampling grid", () => {
  test("both ends are always looked at", () => {
    expect(sampleFrames(240, 24)[0]).toBe(0);
    expect(sampleFrames(240, 24).at(-1)).toBe(239);
    expect(sampleFrames(1, 24)).toEqual([0]);
  });

  test("asking for more samples than there are frames does not repeat one", () => {
    const got = sampleFrames(5, 24);
    expect(got).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(got).size).toBe(got.length);
  });

  test("the spacing is even, so a defect is not sampled out of one region", () => {
    const got = sampleFrames(240, 5);
    expect(got).toEqual([0, 60, 120, 179, 239]);
  });
});

describe("the four readings", () => {
  test("only painted-and-invisible is covered", () => {
    expect(classify(true, true)).toBe("on-screen");
    expect(classify(true, false)).toBe("covered");
    expect(classify(false, false)).toBe("declared-invisible");
    // Cannot occur — the framebuffer is a function of the word stream — and it
    // is a distinct value rather than folded into one of the three so a broken
    // host reads as broken rather than as a finding.
    expect(classify(false, true)).toBe("impossible");
  });
});

describe("compositions/occluded", () => {
  test("the buried caption fails and the one above the lid does not", async () => {
    const result = await runVisibility({
      dir: OCCLUDED,
      all: false,
      flags: flags("occluded"),
    });
    const json = result.json as unknown as Json;
    const byName = new Map(json.nodes.map((n) => [n.name, n]));

    // Same component, same face, same size — only document order differs.
    expect(byName.get("buried")!.neverShown).toBe(true);
    expect(byName.get("buried")!.onScreen).toEqual([]);
    expect(byName.get("buried")!.covered.length).toBe(json.frames.length);

    expect(byName.get("shown")!.neverShown).toBe(false);
    expect(byName.get("shown")!.covered).toEqual([]);
    expect(byName.get("shown")!.onScreen.length).toBe(json.frames.length);
    expect(byName.get("lid")!.neverShown).toBe(false);

    // All three carry a debugName, so the gate is live on this composition —
    // a green run here could otherwise mean nothing was eligible to fail.
    expect(json.namedNodes).toBe(3);
    expect(json.failures).toEqual(["buried"]);
    expect(json.neverShown).toEqual(["buried"]);
    expect(json.impossible).toEqual([]);
    expect(result.exitCode).toBe(EXIT_FAIL);
  }, 120_000);

  test("`lint` and `check` pass on the same composition", async () => {
    const lint = await runLint({ dir: OCCLUDED, flags: flags("occluded") });
    expect(lint.exitCode).toBe(EXIT_OK);
    const check = await runCheck({
      dir: OCCLUDED,
      flags: flags("occluded", { frames: 8 }),
    });
    expect(check.exitCode).toBe(EXIT_OK);
  }, 120_000);

  test("`layout` names the reading rather than only counting the dark node", async () => {
    const result = await runLayout({
      dir: OCCLUDED,
      at: 0,
      all: false,
      flags: flags("occluded", { frames: 1 }),
    });
    const json = result.json as unknown as {
      covered: number;
      notInPicture: number;
      nodes: Array<{ name?: string; visibility: string; paints: boolean }>;
    };
    const byName = new Map(json.nodes.map((n) => [n.name, n]));
    expect(byName.get("buried")!.visibility).toBe("covered");
    expect(byName.get("buried")!.paints).toBe(true);
    expect(byName.get("shown")!.visibility).toBe("on-screen");
    expect(json.covered).toBe(1);
    expect(json.notInPicture).toBe(1);
    // Still exit 0: one frame cannot tell a cut from a defect, and this
    // command reports rather than fails. `visibility` is the one that fails.
    expect(result.exitCode).toBe(EXIT_OK);
  }, 60_000);
});

describe("compositions/smoke", () => {
  test("a film with nothing painted over passes", async () => {
    const result = await runVisibility({
      dir: SMOKE,
      all: false,
      samples: 6,
      flags: flags("smoke"),
    });
    const json = result.json as unknown as Json;
    expect(json.failures).toEqual([]);
    expect(json.impossible).toEqual([]);
    expect(json.frames.length).toBe(6);
    expect(result.exitCode).toBe(EXIT_OK);
  }, 120_000);

  test("--samples 0 is a usage error, not a silent default", async () => {
    await expect(
      runVisibility({ dir: SMOKE, all: false, samples: 0, flags: flags("smoke") }),
    ).rejects.toThrow(/--samples 0 must be a positive integer/);
  });

  // The `--bundle` is what makes this a check on ORDER rather than on the
  // machine. Without it the composition resolves against whatever `dist/`
  // happens to hold, so a run on a tree that has built `smoke` reaches the
  // usage error either way and the test passes without the fix. Naming a
  // bundle that cannot exist means the only way to reach the usage error is
  // to validate before resolving, which is the whole of the change.
  test("a non-numeric --samples is echoed back, not reported as NaN", async () => {
    await expect(
      visibilityFromArgv([
        SMOKE,
        "--samples",
        "notanumber",
        "--bundle",
        join(TMP, "no-such-bundle", "main.js"),
      ]),
    ).rejects.toThrow(/--samples notanumber must be a positive integer/);
  });

  // Every other test calls run() directly, which is how `--samples` shipped in
  // the help text and in AUTHORING.md while `KNOWN_FLAGS` rejected it: the
  // parser is a whitelist and nothing exercised the argv path. A flag a
  // command documents and cannot accept is the shape this repository keeps
  // finding — a claim wider than what was examined.
  test("--samples arrives through argv, not only through run()", async () => {
    const result = await visibilityFromArgv([
      OCCLUDED,
      "--samples",
      "4",
      "--json",
      "--bundle",
      join(dist("occluded"), "main.js"),
      "--pak",
      join(dist("occluded"), "main.pak"),
    ]);
    const json = result.json as unknown as Json;
    expect(json.frames).toEqual([0, 10, 19, 29]);
    expect(json.failures).toEqual(["buried"]);
    expect(result.exitCode).toBe(EXIT_FAIL);
  }, 120_000);
});

describe("the verdict", () => {
  test("a broken host fails, it is not a warning next to a green gate", () => {
    expect(isClean({ failures: [], impossible: [] })).toBe(true);
    expect(isClean({ failures: ["buried"], impossible: [] })).toBe(false);
    // `impossible` cannot be produced by a working host, so this seam is the
    // only place a test can reach it. It was the regression: the command
    // printed "the host is broken" and exited 0.
    expect(isClean({ failures: [], impossible: ["something"] })).toBe(false);
  });
});

describe("compositions/late-anim", () => {
  /**
   * The other half of the discriminator, end to end rather than as a boolean
   * table. `unplayed` is declared `appear 400ms linear 1500ms both` on a
   * 30-frame clock: `both` holds the first keyframe through a delay the film
   * never reaches, so the node sits at opacity 0 for every frame. It is never
   * on screen, exactly like `occluded`'s `buried` — and it must NOT fail,
   * because it emits no geometry at all.
   *
   * Two named nodes, both never shown, opposite verdicts. Without this the
   * only end-to-end pin was the covered side, and a predicate that called
   * everything dark "covered" would have passed the suite.
   */
  test("opacity 0 for the whole film is declared-invisible, not covered", async () => {
    const result = await runVisibility({
      dir: LATE_ANIM,
      all: false,
      flags: flags("late-anim"),
    });
    const json = result.json as unknown as Json;
    const byName = new Map(json.nodes.map((n) => [n.name, n]));

    const unplayed = byName.get("unplayed")!;
    expect(unplayed.onScreen).toEqual([]);
    expect(unplayed.covered).toEqual([]);
    expect(unplayed.declaredInvisible.length).toBe(json.frames.length);
    expect(unplayed.neverShown).toBe(false);

    // `shifted` fades in, so its first frames are dark for the same reason and
    // the rest are not — the same node reading both ways over one sweep.
    const shifted = byName.get("shifted")!;
    expect(shifted.declaredInvisible.length).toBeGreaterThan(0);
    expect(shifted.onScreen.length).toBeGreaterThan(0);
    expect(shifted.covered).toEqual([]);

    // The two `keyframes` cases added later are on screen: `gated` after its
    // step, `contended` from the first frame at the later animation's 0.72.
    for (const name of ["gated", "contended"]) {
      const node = byName.get(name)!;
      expect(node.onScreen.length).toBeGreaterThan(0);
      expect(node.covered).toEqual([]);
    }

    expect(json.namedNodes).toBe(5);
    expect(json.failures).toEqual([]);
    expect(json.impossible).toEqual([]);
    expect(result.exitCode).toBe(EXIT_OK);
  }, 120_000);
});

describe("compositions/spanned", () => {
  /**
   * A buried caption at its own proportions, and the three shapes it has to be
   * told apart from. `occluded` is the same defect with the clean prefix
   * removed, and removing it is what makes that one catchable by "no sampled
   * frame shows it". A caption buried in a real cut IS shown first, and passes
   * every check that does not sweep a span.
   *
   * Four nodes carry the argument, all measured at 240 samples:
   *
   *   spanning   on 0..71, covered 72..239.        the defect
   *   crossfade  on 0..71, dark 72..239, 0 covered. the dissolve that is not
   *   trailing   on 0..71, covered 72..95, dark after. the dissolve that IS
   *   revealed   covered 0..29, on 30..239.        the reveal
   */
  test("a caption buried after its clean prefix fails; a symmetric dissolve does not", async () => {
    const result = await runVisibility({
      dir: SPANNED,
      all: false,
      samples: 40,
      flags: flags("spanned"),
    });
    const json = result.json as unknown as Json;
    const byName = new Map(json.nodes.map((n) => [n.name, n]));

    const spanning = byName.get("spanning")!;
    expect(spanning.onScreen.length).toBeGreaterThan(0);
    expect(spanning.buriedAfterShown).toBe(true);
    // The prefix is what makes it invisible to the other predicate.
    expect(spanning.neverShown).toBe(false);
    // And every covered frame is after the last shown one — it never returns.
    expect(Math.min(...spanning.covered)).toBeGreaterThan(Math.max(...spanning.onScreen));

    // A dissolve whose exit reaches zero no later than the entrance turns
    // opaque: it contributes pixels for the whole overlap and then stops
    // emitting geometry. On-screen, then declared-invisible, never covered.
    const crossfade = byName.get("crossfade")!;
    expect(crossfade.onScreen.length).toBeGreaterThan(0);
    expect(crossfade.covered).toEqual([]);
    expect(crossfade.buriedAfterShown).toBe(false);
    expect(crossfade.declaredInvisible.length).toBeGreaterThan(0);

    expect(byName.get("above")!.buriedAfterShown).toBe(false);
    expect(byName.get("lid")!.buriedAfterShown).toBe(false);
    expect(json.impossible).toEqual([]);
    expect(result.exitCode).toBe(EXIT_FAIL);
  }, 180_000);

  /**
   * The condition above is narrower than "an ordinary dissolve", and this is
   * the difference. `trailing` has a 1200 ms exit under the same 400 ms
   * entrance — nothing exotic — so for the frames its tail outlives the lid's
   * fade it paints with every pixel hidden. It IS covered after being shown,
   * and the film is right.
   *
   * The gate fails it, and that is the honest reach of a predicate that reads
   * the picture alone: from the picture there is nothing separating those
   * frames from `spanning`'s. Pinned here as a red case rather than left as a
   * caveat in a header, because a caveat is what this repository keeps
   * finding wrong.
   */
  test("a dissolve whose exit outlives the entrance IS covered, and fails", async () => {
    const result = await runVisibility({
      dir: SPANNED,
      all: false,
      samples: 40,
      flags: flags("spanned"),
    });
    const json = result.json as unknown as Json;
    const byName = new Map(json.nodes.map((n) => [n.name, n]));

    const trailing = byName.get("trailing")!;
    expect(trailing.onScreen.length).toBeGreaterThan(0);
    expect(trailing.covered.length).toBeGreaterThan(0);
    expect(trailing.buriedAfterShown).toBe(true);
    // It leaves by declaration in the end, which is what makes it a dissolve
    // and not a burial — and what the picture cannot use.
    expect(trailing.declaredInvisible.length).toBeGreaterThan(0);
    expect(Math.max(...trailing.declaredInvisible)).toBeGreaterThan(
      Math.max(...trailing.covered),
    );

    expect(json.namedNodes).toBe(7);
    expect(json.failures).toEqual(["spanning", "trailing"]);
    expect(json.buriedAfterShown).toEqual(["spanning", "trailing"]);
  }, 180_000);

  /**
   * The ordering in the predicate — covered at a LATER frame than the last
   * that showed it — is load-bearing, and until this node existed nothing
   * executed it: dropping the comparison left the whole suite green, because
   * no composition in the tree contained a reveal.
   *
   * `revealed` is covered by `early-lid` for its first frames and shown for
   * every one after. It is named, so it reaches the gate, and it must pass.
   */
  test("a node covered BEFORE it is shown is a reveal, not a burial", async () => {
    const result = await runVisibility({
      dir: SPANNED,
      all: false,
      samples: 40,
      flags: flags("spanned"),
    });
    const json = result.json as unknown as Json;
    const byName = new Map(json.nodes.map((n) => [n.name, n]));

    const revealed = byName.get("revealed")!;
    expect(revealed.covered.length).toBeGreaterThan(0);
    expect(revealed.onScreen.length).toBeGreaterThan(0);
    expect(Math.max(...revealed.covered)).toBeLessThan(Math.min(...revealed.onScreen));
    expect(revealed.buriedAfterShown).toBe(false);
    expect(revealed.neverShown).toBe(false);
    // And it is not in the verdict, though the covered frames are reported.
    expect(json.failures).not.toContain("revealed");
    expect(json.buriedAfterShown).not.toContain("revealed");
  }, 180_000);

  test("`lint` and `check` pass on it, which is why the fixture exists", async () => {
    const lint = await runLint({ dir: SPANNED, flags: flags("spanned") });
    expect(lint.exitCode).toBe(EXIT_OK);
    const check = await runCheck({ dir: SPANNED, flags: flags("spanned", { frames: 8 }) });
    expect(check.exitCode).toBe(EXIT_OK);
  }, 180_000);
});
