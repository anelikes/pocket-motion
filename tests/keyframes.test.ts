/**
 * `keyframes` — the baked timelines, read against the grid the render samples.
 *
 * `compositions/late-anim` declares five cases on one 30-frame clock: an
 * entrance on the grid, one between two frames, one past the end of the film,
 * a two-tick step a rendered frame lands inside, and a comma list whose later
 * animation writes the earlier one's property while it runs. The fixture is
 * built here rather than mocked, because the whole finding is about what the
 * compiler bakes: the delays under test (1, 2 and 90 ticks) are what
 * `msToFrames` makes of 17 ms, 33 ms and 1500 ms, the 34 ms step is two ticks
 * for the same reason, and a hand-written table would stop testing that the
 * moment the baker's rounding changed.
 *
 * Which tick a frame shows is the other half, and it is read off pixels
 * rather than assumed: the fixture's `ruler` moves one pixel a tick, and
 * `frame`'s PNGs at 20, 30 and 60 fps put it where `clockOfFrame` says — the
 * last tick of each frame's window. The readings are then held to the same
 * PNGs: the frame `keyframes` names inside `gated`'s step is the one that
 * shows it half drawn, and the frame it names past `shifted`'s delay shows
 * the entrance already moving where `sampled`'s shows its first keyframe.
 * Placing the grid at the first tick of each window instead — `f * 60 / fps`,
 * what this command did until the ruler was read — fails all of it at 20 and
 * 30 fps.
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
import { run as runFrame } from "../src/cli/commands/frame.ts";
import { clockOfFrame, firstFrameShowing } from "../src/runtime/clock.ts";
import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
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
/** Distinct ANIM TABLE entries the fixture bakes. Measured, not derived: the
 *  baker shares an entry between identical shorthands, and whether two of the
 *  fixture's seven uses collapse is its decision. */
const BAKED_ENTRIES = 7;
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
    // Seven uses: the five named animations, the last of which is a comma
    // list of two, and the ruler.
    expect(r.timelines).toHaveLength(7);

    // (delay, period) in ticks: 17/33/1500 ms delays and 400/34/300/200 ms
    // periods through msToFrames at 60 Hz.
    const at = (delay: number, period: number) => {
      const found = r.timelines.filter((t) => t.delayFrames === delay && t.periodFrames === period);
      expect(found).toHaveLength(1);
      return found[0]!;
    };

    // Frame 0 shows tick 1 and frame 12 tick 25: both ends on the grid.
    const sampled = at(1, 24);
    expect(sampled.unsampled).toHaveLength(0);
    expect(sampled.neverStarts).toBe(false);
    expect(sampled.partialCuts).toHaveLength(0);

    // Tick 2 is even and a 30 fps frame shows only odd ticks, so the entrance
    // the author placed one frame's worth of ms in is first seen by frame 1,
    // at tick 3, already a tick under way — and its end at 26 likewise.
    const shifted = at(2, 24);
    expect(shifted.neverStarts).toBe(false);
    expect(shifted.unsampled).toEqual([
      { what: "delay", tick: 2, observedTick: 3, observedFrame: 1, shiftFrames: 0.5 },
      { what: "segment", tick: 26, observedTick: 27, observedFrame: 13, shiftFrames: 0.5 },
    ]);
    // A 24-tick tween is meant to be seen part-way; it is not a step.
    expect(shifted.partialCuts).toHaveLength(0);

    const unplayed = at(90, 24);
    expect(unplayed.neverStarts).toBe(true);
    expect(unplayed.windowTicks).toBe(60);

    // An entrance at the film's first tick is not one a 30 fps frame shows:
    // frame 0 is drawn after two ticks, at tick 1.
    const ruler = r.timelines.find((t) => t.props.includes("translateX"))!;
    expect(ruler.unsampled).toEqual([
      { what: "delay", tick: 0, observedTick: 1, observedFrame: 0, shiftFrames: 0.5 },
    ]);
  });

  test("a two-tick step from an even tick is shown half done by the frame inside it", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 30,
      tickHz: TICKS_PER_SECOND,
    }))!;
    const gated = r.timelines.find((t) => t.delayFrames === 2 && t.periodFrames === 2)!;
    expect(gated).toBeDefined();
    // Ticks 2→4; frame 1 shows tick 3, halfway along the step.
    expect(gated.partialCuts).toEqual([{ t0: 2, t1: 4, sampledTick: 3, frame: 1, fraction: 0.5 }]);
    // The same step at 60 fps has no frame inside it: every tick is rendered
    // and the endpoints are the two states.
    const r60 = (await readTimelines({
      pakPath: PAK,
      fps: 60,
      durationFrames: 60,
      tickHz: TICKS_PER_SECOND,
    }))!;
    const gated60 = r60.timelines.find((t) => t.delayFrames === 2 && t.periodFrames === 2)!;
    expect(gated60.partialCuts).toHaveLength(0);
    // Nor at 20 fps, where frames show ticks 2, 5, 8: one lands on the step's
    // first tick and the next is past its last. The reading is about phase,
    // not about length alone.
    const r20 = (await readTimelines({
      pakPath: PAK,
      fps: 20,
      durationFrames: 20,
      tickHz: TICKS_PER_SECOND,
    }))!;
    const gated20 = r20.timelines.find((t) => t.delayFrames === 2 && t.periodFrames === 2)!;
    expect(gated20.partialCuts).toHaveLength(0);
    expect(gated20.unsampled).toEqual([
      { what: "segment", tick: 4, observedTick: 5, observedFrame: 1, shiftFrames: 1 / 3 },
    ]);
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
    // instant, not of the duration. The five that declare one on the short
    // clock still do, and `unplayed`, now reached, starts on an even tick.
    expect(r.timelines.filter((t) => t.unsampled.length > 0)).toHaveLength(6);
    const unplayed = r.timelines.find((t) => t.delayFrames === 90)!;
    expect(unplayed.unsampled[0]).toEqual({
      what: "delay",
      tick: 90,
      observedTick: 91,
      observedFrame: 45,
      shiftFrames: 0.5,
    });
  });

  test("every baked timeline is referenced by a style record here", async () => {
    const r = (await readTimelines({
      pakPath: PAK,
      fps: 30,
      durationFrames: 30,
      tickHz: TICKS_PER_SECOND,
    }))!;
    // Seven uses over BAKED_ENTRIES distinct entries; see the constant.
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
    expect(json.counts.unsampled).toBe(5);
    // The header says which tick of its window a frame shows.
    expect((result.stdoutLines ?? []).join("\n")).toContain("(frame f shows tick 2f + 1)");
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
    expect(json.counts.unsampled).toBe(6);
    expect(json.counts.partialCuts).toBe(1);
    expect(json.counts.contended).toBe(1);
    expect(json.contended[0]).toMatchObject({ prop: "opacity", fromTick: 0, toTick: 18 });
    const stdout = (result.stdoutLines ?? []).join("\n");
    expect(stdout).toContain("no frame samples");
    expect(stdout).toContain("shows the step part-way");
    expect(stdout).toContain("shown 0.50 by frame 1 (tick 3)");
    expect(stdout).toContain("written by two animations of one comma list");
    expect(stdout).toContain("opacity — anim");
    expect(stdout).toContain("for ticks 0–18 of its 0–18 by anim");
  });
});

/**
 * The grid read off pixels. `ruler` moves one pixel a tick, so the column its
 * left edge sits in, in `frame`'s own PNG, is the tick that frame shows. The
 * frames are the first three of each rate and the one that shows tick 59;
 * at 60 fps both placements agree, which is what makes the 60 fps column a
 * check on the ruler rather than on the rule.
 *
 * The readings are then held to the same PNGs, through the frame numbers
 * `keyframes` itself reports — so a reading placed on the wrong tick names a
 * frame whose pixels say otherwise. Ink is the brightest red over a text
 * node's band: the ground where it shows nothing, the full text colour where
 * it is at opacity 1.
 */
describe("the tick a frame shows, in `frame`'s pixels", () => {
  type Png = { rgba: Uint8Array; w: number; h: number };
  let decodePNG: (png: Uint8Array) => Png;
  const shots = new Map<string, Promise<Png>>();

  beforeAll(async () => {
    ({ decodePNG } = (await import(join(VENDOR, "tools", "png.ts"))) as { decodePNG: typeof decodePNG });
  });

  /** Frame `at` of the fixture at `fps`, `fps` frames long — one second, 60
   *  ticks, the ruler's whole run — written by `frame` and read back. */
  const shot = (fps: number, at: number): Promise<Png> => {
    const key = `${fps}:${at}`;
    if (!shots.has(key)) {
      shots.set(
        key,
        (async () => {
          const out = join(TMP, `frame-${fps}-${at}.png`);
          const result = await runFrame({ dir: DIR, at, out, flags: flags({ fps, frames: fps }) });
          if (result.exitCode !== EXIT_OK) throw new Error(`frame ${at} at ${fps} fps: ${JSON.stringify(result.json)}`);
          return decodePNG(new Uint8Array(await Bun.file(out).arrayBuffer()));
        })(),
      );
    }
    return shots.get(key)!;
  };

  /** The ruler's left edge, from the fixture's `left-[80px]`: the first
   *  column of its middle row more than half lit. */
  const rulerTick = (p: Png): number => {
    const y = 700;
    for (let x = 0; x < p.w; x++) if (p.rgba[(y * p.w + x) * 4]! >= 128) return x - 80;
    return -1;
  };

  /** The brightest red in a text node's band — `top-[…px]`, 32 px text. */
  const ink = (p: Png, top: number): number => {
    let max = 0;
    for (let y = top; y < top + 48; y++) {
      for (let x = 80; x < 800; x++) max = Math.max(max, p.rgba[(y * p.w + x) * 4]!);
    }
    return max;
  };

  test("a node moving a pixel a tick sits where clockOfFrame says, at 20, 30 and 60 fps", async () => {
    const seen: string[] = [];
    const want: string[] = [];
    for (const fps of [20, 30, 60]) {
      const k = TICKS_PER_SECOND / fps;
      for (const at of [0, 1, 2, fps - 1]) {
        seen.push(`${fps} fps frame ${at}: tick ${rulerTick(await shot(fps, at))}`);
        want.push(`${fps} fps frame ${at}: tick ${clockOfFrame(at, k)}`);
      }
    }
    expect(seen).toEqual(want);
    // Spelled out at 30 fps, so the rule is readable here and not only
    // through the function it holds: the last tick of each two.
    expect(rulerTick(await shot(30, 0))).toBe(1);
    expect(rulerTick(await shot(30, 1))).toBe(3);
    expect(rulerTick(await shot(30, 29))).toBe(59);
  }, 300_000);

  test("the frames the readings name show what the readings say", async () => {
    const r = (await readTimelines({ pakPath: PAK, fps: 30, durationFrames: 30, tickHz: TICKS_PER_SECOND }))!;
    const k = r.ticksPerFrame;
    const timeline = (delay: number, period: number) =>
      r.timelines.find((t) => t.delayFrames === delay && t.periodFrames === period)!;
    const at = async (frame: number, top: number) => ink(await shot(30, frame), top);
    // `unplayed`'s band is ground for the whole film; `sampled` has finished
    // its entrance by the last frame.
    const ground = await at(0, 320);
    const full = await at(29, 80);
    expect(full).toBeGreaterThan(ground + 200);

    // `sampled`: its delay is a tick a frame shows, so that frame shows the
    // first keyframe — opacity 0 — and the next shows it under way.
    const sampled = timeline(1, 24);
    expect(sampled.unsampled).toEqual([]);
    const first = firstFrameShowing(sampled.delayFrames, k);
    expect(await at(first, 80)).toBe(ground);
    expect(await at(first + 1, 80)).toBeGreaterThan(ground);

    // `shifted`: its delay is reported unsampled, and the frame named as the
    // first past it already shows the entrance moving, the one before nothing.
    const shifted = timeline(2, 24).unsampled[0]!;
    expect(shifted.what).toBe("delay");
    expect(await at(shifted.observedFrame - 1, 200)).toBe(ground);
    expect(await at(shifted.observedFrame, 200)).toBeGreaterThan(ground);

    // `gated`: the frame named inside the step shows it half drawn, between
    // a frame of nothing and a frame of all of it.
    const cut = timeline(2, 2).partialCuts[0]!;
    expect(cut.fraction).toBe(0.5);
    const mid = await at(cut.frame, 440);
    expect(await at(cut.frame - 1, 440)).toBe(ground);
    expect(mid).toBeGreaterThan(ground + (full - ground) * 0.4);
    expect(mid).toBeLessThan(ground + (full - ground) * 0.6);
    expect(await at(cut.frame + 1, 440)).toBe(full);
  }, 300_000);
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
  test("rounds to the tick a rendered frame shows, the last of its window", () => {
    // 30 fps frames show ticks 1, 3, 5, 7 …: 16.667, 50, 83.333, 116.667 ms.
    expect(nearestSampledMs(50, 30)).toBeCloseTo(50, 5);
    expect(nearestSampledMs(45, 30)).toBeCloseTo(50, 5);
    expect(nearestSampledMs(0, 30)).toBeCloseTo(16.667, 2);
    expect(nearestSampledMs(83, 30)).toBeCloseTo(83.333, 2);
    expect(nearestSampledMs(110, 30)).toBeCloseTo(116.667, 2);
    expect(nearestSampledMs(50, 60)).toBeCloseTo(50, 5);
    // And what it returns bakes back to such a tick at every rate, through
    // the compiler's round-half-up.
    for (const fps of [15, 20, 30, 60]) {
      const k = TICKS_PER_SECOND / fps;
      for (let ms = 0; ms <= 1000; ms += 7) {
        const tick = Math.floor((nearestSampledMs(ms, fps) * TICKS_PER_SECOND) / 1000 + 0.5);
        expect(clockOfFrame(firstFrameShowing(tick, k), k)).toBe(tick);
      }
    }
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
