/**
 * `keyframes` — the baked timelines, read against the grid the render samples.
 *
 * `compositions/late-anim` declares three entrances on one 30-frame clock, one
 * per case: on the grid, between two frames, and past the end of the film. The
 * fixture is built here rather than mocked, because the whole finding is about
 * what the compiler bakes: the delays under test (0, 3 and 90 ticks) are what
 * `msToFrames` makes of 0 ms, 50 ms and 1500 ms, and a hand-written table would
 * stop testing that the moment the baker's rounding changed.
 *
 * The negative half is asserted too: `lint` and `check` pass on the same
 * composition. A timeline the film cannot reach is invisible to every other
 * command, which is why this one exists.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { readTimelines, nearestSampledMs } from "../src/anim/timelines.ts";
import { writeBuildRecord } from "../src/render/build-record.ts";
import { TICKS_PER_SECOND } from "../src/runtime/boot.ts";
import { run as runCheck } from "../src/cli/commands/check.ts";
import { run as runKeyframes } from "../src/cli/commands/keyframes.ts";
import { run as runLint } from "../src/cli/commands/lint.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const DIR = join(ROOT, "compositions", "late-anim");
const TMP = "/tmp/pocketjs-motion-keyframes-test";
const BUNDLE = join(TMP, "main.js");
const PAK = join(TMP, "main.pak");

process.env.POCKETJS_ROOT = VENDOR;

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
    env: { ...process.env, POCKETJS_ROOT: VENDOR },
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
    expect(r.timelines).toHaveLength(3);

    const byDelay = new Map(r.timelines.map((t) => [t.delayFrames, t]));
    // 0 ms, 50 ms, 1500 ms through msToFrames at 60 Hz.
    expect([...byDelay.keys()].sort((a, b) => a - b)).toEqual([0, 3, 90]);

    const sampled = byDelay.get(0)!;
    expect(sampled.unsampled).toHaveLength(0);
    expect(sampled.neverStarts).toBe(false);

    // Tick 3 is odd and the render only looks at even ticks, so the entrance
    // the author placed at 50 ms first appears at tick 4.
    const shifted = byDelay.get(3)!;
    expect(shifted.neverStarts).toBe(false);
    expect(shifted.unsampled[0]).toMatchObject({
      what: "delay",
      tick: 3,
      observedTick: 4,
      shiftFrames: 0.5,
    });

    const unplayed = byDelay.get(90)!;
    expect(unplayed.neverStarts).toBe(true);
    expect(unplayed.windowTicks).toBe(60);
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
    // instant, not of the duration.
    expect(r.timelines.filter((t) => t.unsampled.length > 0)).toHaveLength(1);
  });

  test("every baked timeline is referenced by a style record here", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 30,
      tickHz: TICKS_PER_SECOND,
    }))!;
    expect(r.bakedCount).toBe(3);
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
    expect(json.counts.unsampled).toBe(1);
  });

  test("an unsampled instant is reported, not failed", async () => {
    // 60 frames of clock reaches tick 90, so the only finding left is the shift.
    const result = await runKeyframes({ dir: DIR, flags: flags({ frames: 60 }), all: false });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as { counts: Record<string, number> };
    expect(json.counts.neverStarts).toBe(0);
    expect(json.counts.unsampled).toBe(1);
    expect((result.stdoutLines ?? []).join("\n")).toContain("no frame samples");
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
