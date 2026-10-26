/**
 * `keyframes` — the baked timelines, read against the grid the render samples.
 *
 * `compositions/late-anim` declares five cases on one 30-frame clock: an
 * entrance on the grid, one between two frames, one past the end of the film,
 * a two-tick step a rendered frame lands inside, and a comma list whose later
 * animation writes the earlier one's property while it runs. The fixture is
 * built here rather than mocked, because the whole finding is about what the
 * compiler bakes: the delays under test (0, 3 and 90 ticks) are what
 * `msToFrames` makes of 0 ms, 50 ms and 1500 ms, the 34 ms step is two ticks
 * for the same reason, and a hand-written table would stop testing that the
 * moment the baker's rounding changed.
 *
 * The negative half is asserted too: `lint` and `check` pass on the same
 * composition. A timeline the film cannot reach is invisible to every other
 * command, which is why this one exists.
 *
 * `compositions/long-track` is the second fixture: tracks over the 255
 * segments the ANIM TABLE held before patches/0050, read to their ends.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { readTimelines, nearestSampledMs } from "../src/anim/timelines.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { writeBuildRecord } from "../src/render/build-record.ts";
import { TICKS_PER_SECOND } from "../src/runtime/boot.ts";
import { run as runCheck } from "../src/cli/commands/check.ts";
import { run as runKeyframes } from "../src/cli/commands/keyframes.ts";
import { run as runLint } from "../src/cli/commands/lint.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const DIR = join(ROOT, "compositions", "late-anim");
const TMP = scratchDir("keyframes");
/** Distinct ANIM TABLE entries the fixture bakes. Measured, not derived: the
 *  baker shares an entry between identical shorthands, and whether two of the
 *  fixture's six uses collapse is its decision. */
const BAKED_ENTRIES = 6;
const BUNDLE = join(TMP, "main.js");
const PAK = join(TMP, "main.pak");

function flags(extra: Record<string, unknown> = {}) {
  return { json: false, bundle: BUNDLE, pak: PAK, ...extra } as never;
}

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  // The timing under test lives in the composition's own pocket.config.ts, so
  // this build must NOT pass --no-config the way the smoke fixtures do.
  const argv = [
    "bun",
    join(VENDOR, "tools", "build.ts"),
    join(DIR, "main.tsx"),
    `--outdir=${TMP}`,
    "--framework=solid",
    "--hz=60",
  ];
  const proc = Bun.spawn(argv, {
    cwd: VENDOR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 || !existsSync(PAK)) {
    throw new Error(`late-anim build failed (${code}): ${stderr}`);
  }
  // `keyframes` refuses a pak whose build nothing recorded, so a fixture built
  // by hand records the same way `runBuild` does.
  await writeBuildRecord(TMP, argv);
}, 180_000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("readTimelines", () => {
  test("the three declared entrances bake to the three cases", async () => {
    const report = await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 30,
      tickHz: TICKS_PER_SECOND,
    });
    expect(report).not.toBeNull();
    const r = report!;
    expect(r.ticksPerFrame).toBe(2);
    expect(r.totalTicks).toBe(60);
    // Six uses: the five named animations, the last of which is a comma list
    // of two.
    expect(r.timelines).toHaveLength(6);

    // (delay, period) in ticks: 0/50/1500 ms delays and 400/34/300/200 ms
    // periods through msToFrames at 60 Hz.
    const at = (delay: number, period: number) => {
      const found = r.timelines.filter((t) => t.delayFrames === delay && t.periodFrames === period);
      expect(found).toHaveLength(1);
      return found[0]!;
    };

    const sampled = at(0, 24);
    expect(sampled.unsampled).toHaveLength(0);
    expect(sampled.neverStarts).toBe(false);
    expect(sampled.partialCuts).toHaveLength(0);

    // Tick 3 is odd and the render only looks at even ticks, so the entrance
    // the author placed at 50 ms first appears at tick 4.
    const shifted = at(3, 24);
    expect(shifted.neverStarts).toBe(false);
    expect(shifted.unsampled[0]).toMatchObject({
      what: "delay",
      tick: 3,
      observedTick: 4,
      shiftFrames: 0.5,
    });
    // A 24-tick tween is meant to be seen part-way; it is not a step.
    expect(shifted.partialCuts).toHaveLength(0);

    const unplayed = at(90, 24);
    expect(unplayed.neverStarts).toBe(true);
    expect(unplayed.windowTicks).toBe(60);
  });

  test("a two-tick step at an odd tick is shown half done by the frame inside it", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 30,
      tickHz: TICKS_PER_SECOND,
    }))!;
    const gated = r.timelines.find((t) => t.delayFrames === 3 && t.periodFrames === 2)!;
    expect(gated).toBeDefined();
    // Ticks 3→5; the render looks at tick 4, halfway along the step.
    expect(gated.partialCuts).toEqual([{ t0: 3, t1: 5, sampledTick: 4, fraction: 0.5 }]);
    // The same step at 60 fps has no frame inside it: every tick is rendered
    // and the endpoints are the two states.
    const r60 = (await readTimelines({
      pakPath: PAK,
      fps: 60,
      durationFrames: 60,
      tickHz: TICKS_PER_SECOND,
    }))!;
    const gated60 = r60.timelines.find((t) => t.delayFrames === 3 && t.periodFrames === 2)!;
    expect(gated60.partialCuts).toHaveLength(0);
    // And a two-tick step starting on an even tick would be sampled at both
    // ends and nowhere between, which is the case the fixture does not carry:
    // the reading is about phase, not about length alone.
  });

  test("a later animation with backwards fill writes over the earlier one for its whole run", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 30,
      tickHz: TICKS_PER_SECOND,
    }))!;
    expect(r.contended).toHaveLength(1);
    const c = r.contended[0]!;
    expect(c.prop).toBe("opacity");
    // `appear 300ms` runs over ticks 0–18; `dim … 500ms both` is writing from
    // tick 0 because `both` holds its first keyframe through the delay.
    expect(c.fromTick).toBe(0);
    expect(c.toTick).toBe(18);
    const earlier = r.timelines.find((t) => t.animId === c.earlier)!;
    const later = r.timelines.find((t) => t.animId === c.later)!;
    expect(earlier.periodFrames).toBe(18);
    expect(later.delayFrames).toBe(30);
    expect(earlier.styleIndex).toBe(later.styleIndex);
    expect(c.styleIndex).toBe(earlier.styleIndex);
  });

  test("at 60 fps every tick is rendered, so nothing is unsampled", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 60,
      durationFrames: 120,
      tickHz: TICKS_PER_SECOND,
    }))!;
    expect(r.ticksPerFrame).toBe(1);
    expect(r.timelines.every((t) => t.unsampled.length === 0)).toBe(true);
    expect(r.timelines.every((t) => !t.neverStarts)).toBe(true);
  });

  test("a longer clock reaches the late entrance", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 60,
      tickHz: TICKS_PER_SECOND,
    }))!;
    expect(r.timelines.filter((t) => t.neverStarts)).toHaveLength(0);
    // The shift does not go away with a longer film: it is a property of the
    // instant, not of the duration. `shifted` and `gated` both start at tick 3.
    expect(r.timelines.filter((t) => t.unsampled.length > 0)).toHaveLength(2);
  });

  test("every baked timeline is referenced by a style record here", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 30,
      tickHz: TICKS_PER_SECOND,
    }))!;
    // Six uses over BAKED_ENTRIES distinct entries; see the constant.
    expect(r.bakedCount).toBe(BAKED_ENTRIES);
    expect(r.unreferenced).toBe(0);
  });
});

describe("keyframes command", () => {
  test("fails on the timeline the film cannot reach, and says which", async () => {
    const result = await runKeyframes({ dir: DIR, flags: flags(), all: true });
    expect(result.exitCode).toBe(EXIT_FAIL);
    const stderr = (result.stderrLines ?? []).join("\n");
    expect(stderr).toContain("delay 90 ticks");
    expect(stderr).toContain("60-tick clock");
    const json = result.json as { counts: Record<string, number>; ok: boolean };
    expect(json.ok).toBe(false);
    expect(json.counts.neverStarts).toBe(1);
    expect(json.counts.unsampled).toBe(2);
  });

  test("an unsampled instant, a part-way step and a contended property are reported, not failed", async () => {
    // 60 frames of clock reaches tick 90, so what is left is the three readings
    // that never fail.
    const result = await runKeyframes({ dir: DIR, flags: flags({ frames: 60 }), all: false });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as {
      counts: Record<string, number>;
      contended: Array<{ prop: string; fromTick: number; toTick: number }>;
    };
    expect(json.counts.neverStarts).toBe(0);
    expect(json.counts.unsampled).toBe(2);
    expect(json.counts.partialCuts).toBe(1);
    expect(json.counts.contended).toBe(1);
    expect(json.contended[0]).toMatchObject({ prop: "opacity", fromTick: 0, toTick: 18 });
    const stdout = (result.stdoutLines ?? []).join("\n");
    expect(stdout).toContain("no frame samples");
    expect(stdout).toContain("shows the step part-way");
    expect(stdout).toContain("shown 0.50 at 4");
    expect(stdout).toContain("written by two animations of one comma list");
    expect(stdout).toContain("opacity — anim");
    expect(stdout).toContain("for ticks 0–18 of its 0–18 by anim");
  });
});

/**
 * The point of the fixture: every other command is green on it. A declared
 * animation that no frame can show is not a determinism problem, a realm
 * problem, or a sidecar problem, so nothing else has any reason to look.
 */
describe("the same composition passes everything else", () => {
  test("lint", async () => {
    const result = await runLint({ dir: DIR, flags: flags() });
    expect(result.exitCode).toBe(EXIT_OK);
  });

  test("check", async () => {
    const result = await runCheck({ dir: DIR, flags: flags({ frames: 8 }) });
    expect(result.exitCode).toBe(EXIT_OK);
  }, 60_000);
});

describe("nearestSampledMs", () => {
  test("rounds to a whole rendered frame", () => {
    expect(nearestSampledMs(50, 30)).toBeCloseTo(66.667, 2);
    expect(nearestSampledMs(45, 30)).toBeCloseTo(33.333, 2);
    expect(nearestSampledMs(100, 30)).toBeCloseTo(100, 5);
    expect(nearestSampledMs(50, 60)).toBeCloseTo(50, 5);
  });
});

/**
 * `compositions/long-track`: a camera whose six transform tracks carry 2,003
 * segments each and ten opacity tracks of 841, every one past the 255 the
 * ANIM TABLE held before patches/0050. `readTimelines` decodes through the
 * vendored `decodeStyleTable`, so the readings come from the same bytes the
 * core plays; what is held here is that they come from ALL of them. Every
 * timeline's segment count is held to the keyframe set the generator wrote,
 * and the one reading placed at the far end of a track — the camera's cut at
 * tick 4100, after its 2,000th segment, reported as a step the shutter does
 * not blur across — must be there. A decoder that read the count's low byte
 * would carry 211 of the camera's segments and none of the cut.
 *
 * The readings asserted are the ones that depend on the segments alone. Which
 * instants count as unsampled depends on where the render's grid sits against
 * a node's clock, and that is the same question for a track of any length.
 */
describe("a track over 255 segments", () => {
  const LONG = join(ROOT, "compositions", "long-track");
  let report: NonNullable<Awaited<ReturnType<typeof readTimelines>>>;
  let theme: { keyframes: Record<string, Record<string, Record<string, string>>> };

  beforeAll(async () => {
    const resolved = await resolveComposition({ dir: LONG, flags: { json: false }, requireBundle: false });
    if (!resolved.ok) throw new Error("long-track did not resolve");
    await runBuild(resolved.value);
    report = (await readTimelines({
      pakPath: resolved.value.pakPath,
      fps: 30,
      durationFrames: 2100,
      tickHz: TICKS_PER_SECOND,
    }))!;
    theme = ((await import(join(LONG, "pocket.config.ts"))) as { default: { theme: typeof theme } }).default.theme;
  }, 300_000);

  /** Segments a keyframe set bakes to: one per gap between distinct positions, per property. */
  const segmentsOf = (stops: Record<string, Record<string, string>>): number => {
    const positions = new Set(Object.keys(stops).map((pct) => parseFloat(pct))).size;
    const props = new Set(Object.values(stops).flatMap((decl) => Object.keys(decl))).size;
    return props * (positions - 1);
  };

  test("every timeline carries every segment its keyframe set declares", () => {
    const declared = Object.values(theme.keyframes).map(segmentsOf).sort((a, b) => a - b);
    const baked = report.timelines.map((t) => t.segments).sort((a, b) => a - b);
    expect(baked).toEqual(declared);
    expect(report.timelines.filter((t) => t.segments > 255 * t.props.length).length).toBe(11);
  });

  test("the camera's cut after its 2,000th segment is read, and nothing contends", () => {
    const camera = report.timelines.find((t) => t.props.includes("translateX"))!;
    expect(camera.segments).toBe(6 * 2003);
    expect(camera.shutterJumps).toEqual([
      { prop: "translateX", tick: 4100, kind: "step" },
      { prop: "translateY", tick: 4100, kind: "step" },
    ]);
    expect(camera.neverStarts).toBe(false);
    expect(camera.endsPastWindow).toBe(false);
    expect(report.contended).toEqual([]);
  });
});
