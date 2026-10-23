/**
 * The shutter (patches/0034) end to end, read off `compositions/shutter-blur`
 * after a real build.
 *
 * The sub-tick rule itself — where a sample sits inside a segment, and every
 * kind of jump it must not cross — is held in the core
 * (`engine/core/src/tests.rs`, `shutter_*`, each red under a one-line edit
 * recorded in the patch header). What this file holds is what the core cannot:
 * that the host passes the exposure it declares, that the average the core
 * returns is the one a host would compute, that a declared case reaches the
 * picture (a flick not smeared, a held label sharp, a static caption
 * untouched), and that checkpoints, preview, `frame`, the prober and `lint`
 * agree with it.
 *
 * Each guard was watched red against a core built with the defect it names;
 * `baselines/shutter.md`, "Stage 2", records which edit turned which test red.
 *
 * "Presence under the shutter" holds the cost fix and its one open door: a
 * rect is read off a draw walk rather than a raster (red with the prober's
 * `walk` made a no-op: every rect comes back -1), and `--read tick` is a
 * different picture from the exposure — `peek` is in every exposure and
 * covered at every tick (red with `openProber` ignoring `read`, and red with
 * the exposure ignored by default).
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SHUTTER_INTEGRATED, readTimelines } from "../src/anim/timelines.ts";
import { runBuild } from "../src/cli/build.ts";
import { run as runAssert } from "../src/cli/commands/assert.ts";
import { run as runFrame } from "../src/cli/commands/frame.ts";
import { run as runLayout } from "../src/cli/commands/layout.ts";
import { run as runVisibility } from "../src/cli/commands/visibility.ts";
import { resolveComposition, type ResolvedComposition } from "../src/cli/resolve.ts";
import { EXIT_OK } from "../src/cli/types.ts";
import { lintShutterSource } from "../src/lint/shutter.ts";
import { PreviewSession } from "../src/preview/session.ts";
import { openProber, rect } from "../src/render/visibility.ts";
import {
  TICKS_PER_SECOND,
  exposureOf,
  hardenedBootWorld,
  type BootedWorld,
} from "../src/runtime/boot.ts";
import { WasmFrameSource } from "../src/runtime/frame-source.ts";
import type { SidecarShutter } from "../src/manifest/sidecar.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "compositions", "shutter-blur");
const VENDOR = join(ROOT, "vendor", "pocketjs");
process.env.POCKETJS_ROOT = VENDOR;

let c: ResolvedComposition;

beforeAll(async () => {
  const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: false });
  if (!resolved.ok) throw new Error("shutter-blur did not resolve");
  await runBuild(resolved.value);
  const built = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: true });
  if (!built.ok) throw new Error(built.message);
  c = built.value;
}, 300_000);

/** A world over the fixture's bundle with whatever shutter the test names. */
function boot(shutter: SidecarShutter | null, wasmPath?: string): Promise<BootedWorld> {
  return hardenedBootWorld({
    bundlePath: c.bundlePath,
    pakPath: c.pakPath,
    width: c.width,
    height: c.height,
    hz: c.fps,
    renderScale: c.supersample,
    shutter,
    buildCommand: c.buildCommand,
    ...(wasmPath ? { wasmPath } : {}),
  });
}

/** A node id by `debugName`, out of the DevTools tree `getTree` returns. */
function findNamed(tree: unknown, name: string): number {
  const walk = (n: { i: number; n?: string; k?: unknown[] } | undefined): number | undefined => {
    if (!n) return undefined;
    if (n.n === name) return n.i;
    for (const kid of n.k ?? []) {
      const hit = walk(kid as typeof n);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  const id = walk(tree as never);
  if (id === undefined) throw new Error(`no node named ${name}`);
  return id;
}

/** Fold a world forward to frame `at`, the transaction `seekFrame` drives. */
function advance(world: BootedWorld, from: number, to: number): void {
  for (let f = from; f <= to; f++) {
    world.frame(0);
    for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  }
}

/** Every frame of the film, rendered through `pick`, as copies. */
function film(world: BootedWorld, pick: (w: BootedWorld) => Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let f = 0; f < c.durationFrames; f++) {
    advance(world, f, f);
    out.push(Uint8Array.from(pick(world)));
  }
  return out;
}

const W = 1920;
const px = (fb: Uint8Array, x: number, y: number): [number, number, number, number] => {
  const i = (y * W + x) * 4;
  return [fb[i]!, fb[i + 1]!, fb[i + 2]!, fb[i + 3]!];
};

/** Bytes of a rectangle, for comparing one region of two frames. */
function region(fb: Uint8Array, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const out = new Uint8Array((x1 - x0) * (y1 - y0) * 4);
  let o = 0;
  for (let y = y0; y < y1; y++) {
    out.set(fb.subarray((y * W + x0) * 4, (y * W + x1) * 4), o);
    o += (x1 - x0) * 4;
  }
  return out;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

describe("the exposure the sidecar declares", () => {
  test("the fixture declares 180° × 8, and the span reaches the core as an exact fraction", () => {
    expect(c.shutter).toEqual({ angle: 180, samples: 8 });
    // 30 fps: a frame is 2 ticks, so 180° is one tick, as 360/360.
    expect(exposureOf({ angle: 180, samples: 8 }, 30)).toEqual({ angle: 180, samples: 8, spanNum: 360, spanDen: 360 });
    expect(exposureOf({ angle: 90, samples: 4 }, 60).spanNum / 360).toBe(0.25);
    expect(TICKS_PER_SECOND / c.fps).toBe(2);
  });

  test("one sample is the unblurred frame, at every frame", async () => {
    // Samples are centred on the frame's tick, so the only sample of a
    // one-sample exposure IS the tick. A trailing shutter would put it half a
    // span late and move every moving pixel.
    const one = film(await boot({ angle: 180, samples: 1 }), (w) => w.render());
    const plain = film(await boot(null), (w) => w.render());
    const moved = one.findIndex((f, i) => !same(f, plain[i]!));
    expect(moved).toBe(-1);
  }, 120_000);

  test("a 2-sample exposure of a known move is the average written down in advance", async () => {
    // `known`: a 40 px white square at x = 1200 + 4·(clock mod 64), linear.
    // Frame 10 reads clock 21, so the tick has it at 1284. 180° at 30 fps is
    // one tick; two samples sit a quarter tick either side, at 1283 and 1285,
    // each a whole pixel because 4·(21 ± 1/4) = 84 ± 1 exactly.
    const world = await boot({ angle: 180, samples: 2 });
    advance(world, 0, 10);
    const tick = Uint8Array.from(world.renderTick());
    const exposure = Uint8Array.from(world.render());
    const y = 880;
    const ground = px(tick, 1270, y);
    expect(ground).toEqual([11, 15, 20, 255]); // #0b0f14
    expect(px(tick, 1283, y)).toEqual(ground);
    expect(px(tick, 1284, y)).toEqual([255, 255, 255, 255]);
    expect(px(tick, 1323, y)).toEqual([255, 255, 255, 255]);
    expect(px(tick, 1324, y)).toEqual(ground);
    // Covered by one sample of two: (2·(255 + ground) + 2) / 4, rounded down
    // after the half is added — 133, 135, 138. Covered by both: white.
    const half = [133, 135, 138, 255];
    const white = [255, 255, 255, 255];
    const row = [1282, 1283, 1284, 1285, 1322, 1323, 1324, 1325].map((x): number[] => px(exposure, x, y));
    expect(row).toEqual([ground, half, half, white, white, half, half, ground]);
  }, 60_000);

  test("the core's average equals the same arithmetic done here over the same samples", async () => {
    const world = await boot(c.shutter);
    const e = world.exposure!;
    const sample = (world.exports as unknown as { ui_shutter_sample: (n: number, d: number) => void })
      .ui_shutter_sample;
    let at = 0;
    for (const frame of [7, 15, 24, 45, 60]) {
      advance(world, at, frame);
      at = frame + 1;
      const core = Uint8Array.from(world.render());
      const n = e.samples;
      const acc = new Uint32Array(core.length);
      for (let k = 0; k < n; k++) {
        sample(e.spanNum * (2 * k + 1 - n), e.spanDen * 2 * n);
        const fb = world.renderTick();
        for (let i = 0; i < fb.length; i += 4) {
          const a = fb[i + 3]!;
          acc[i] = acc[i]! + fb[i]! * a;
          acc[i + 1] = acc[i + 1]! + fb[i + 1]! * a;
          acc[i + 2] = acc[i + 2]! + fb[i + 2]! * a;
          acc[i + 3] = acc[i + 3]! + a;
        }
      }
      sample(0, 1);
      const host = new Uint8Array(core.length);
      for (let i = 0; i < acc.length; i += 4) {
        const sa = acc[i + 3]!;
        if (sa === 0) continue;
        for (let ch = 0; ch < 3; ch++) host[i + ch] = Math.min(255, Math.floor((2 * acc[i + ch]! + sa) / (2 * sa)));
        host[i + 3] = Math.floor((2 * sa + n) / (2 * n));
      }
      expect(same(core, host), `frame ${frame}`).toBe(true);
    }
  }, 120_000);

  test("an exposure leaves the core on the frame's own tick: pixels, draw list and rects", async () => {
    const world = await boot(c.shutter);
    // getTree consumes the mount frame; the world is then at frame 0.
    const moving = findNamed(world.getTree(), "label-blur");
    advance(world, 1, 24);
    const tickHash = () => String((world.exports as unknown as { ui_draw_hash: () => bigint }).ui_draw_hash());
    const prober = openProber(world, { classify: true });
    const draw = tickHash();
    const before = Uint8Array.from(world.renderTick());
    world.render();
    prober.drawHash!();
    expect(tickHash()).toBe(draw);
    expect(same(Uint8Array.from(world.renderTick()), before)).toBe(true);
    // The rect latch is filled by a draw walk; the exposure's last walk is
    // the tick's, so a rect read after one is the frame's own box and not
    // the last sample's. The whip is moving fast at frame 24.
    const label = rect(prober, moving);
    world.render();
    expect([prober.rectXY(), prober.rectWH()]).toEqual([label.xy, label.wh]);
    prober.inspect(0);
  }, 60_000);
});

describe("what the exposure leaves alone", () => {
  let ticks: Uint8Array[];
  let exposures: Uint8Array[];
  beforeAll(async () => {
    const world = await boot(c.shutter);
    ticks = [];
    exposures = [];
    for (let f = 0; f < c.durationFrames; f++) {
      advance(world, f, f);
      exposures.push(Uint8Array.from(world.render()));
      ticks.push(Uint8Array.from(world.renderTick()));
    }
  }, 120_000);

  const differing = (x0: number, y0: number, x1: number, y1: number): number[] =>
    ticks.flatMap((t, f) => (same(region(t, x0, y0, x1, y1), region(exposures[f]!, x0, y0, x1, y1)) ? [] : [f]));

  test("a region no sample changes is byte-identical: the static caption", () => {
    expect(differing(80, 40, 740, 90)).toEqual([]);
  });

  test("a one-tick flick is a jump, not a streak: its lane is the tick at every frame", () => {
    // The flick crosses 500 px in one tick (frame 24 is the frame that sees it
    // land). Interpolated, a sample would draw it part-way across the lane.
    expect(differing(1070, 285, 1700, 355)).toEqual([]);
  });

  test("shutter-hold keeps a label sharp, and the same label without it blurs", () => {
    expect(differing(1070, 700, 1910, 820)).toEqual([]);
    expect(differing(1070, 540, 1910, 660).length).toBeGreaterThan(60);
  });

  test("opacity is the frame's: the gated dot opens on the frame it opens on without a shutter", () => {
    // gin at 1000 ms (tick 60) over two ticks: frame 30 reads tick 61, half
    // open, in both pictures; frame 29 is closed in both.
    const dot = (fb: Uint8Array) => px(fb, 1130, 440);
    expect(dot(exposures[29]!)).toEqual(dot(ticks[29]!));
    expect(dot(exposures[29]!)).toEqual([11, 15, 20, 255]);
    expect(dot(exposures[31]!)[1]).toBeGreaterThan(200);
  });
});

describe("the hosts around the exposure", () => {
  test("a core without the exposure exports is refused for a composition that declares a shutter", async () => {
    // The vendored core with one export renamed in place — the same bytes
    // with `ui_render_exposure` missing, which is what a stale build is.
    const bytes = readFileSync(join(VENDOR, "hosts/web/pocketjs.wasm"));
    const name = Buffer.from("ui_render_exposure");
    const at = bytes.indexOf(name);
    expect(at).toBeGreaterThan(0);
    const stale = Buffer.from(bytes);
    stale[at + name.length - 1] = "X".charCodeAt(0);
    const path = join(mkdtempSync(join(tmpdir(), "motion-shutter-")), "stale.wasm");
    writeFileSync(path, stale);
    await expect(boot(c.shutter, path)).rejects.toThrow(/ui_render_exposure[\s\S]*bun scripts\/vendor\.ts/);
    await boot(null, path); // nothing declared, nothing refused
  }, 60_000);

  test("checkpoints skip the scratch, and a rewind renders the exposure a forward seek renders", async () => {
    const make = () =>
      WasmFrameSource.create({
        compositionId: c.compositionId,
        bundlePath: c.bundlePath,
        pakPath: c.pakPath,
        width: c.width,
        height: c.height,
        hz: c.fps,
        shutter: c.shutter,
        durationFrames: c.durationFrames,
        renderScale: c.supersample,
        buildCommand: c.buildCommand,
        checkpointInterval: 10,
      });
    const forward = await make();
    await forward.seekFrame(37);
    const want = Uint8Array.from(forward.read());

    const source = await make();
    await source.seekFrame(60);
    source.read();
    await source.seekFrame(37); // restores 30, folds 7
    expect(same(Uint8Array.from(source.read()), want)).toBe(true);
    const scratch = source.world.exposureScratch();
    expect(scratch.len).toBe(c.width * c.height * 4 * 5);
    // Each snapshot holds the memory minus the scratch.
    const { count, bytes } = source.checkpoints;
    expect(bytes / count).toBeLessThan(source.memoryBytes - scratch.len + 1);
  }, 120_000);

  test("preview serves the bytes `frame --at N` writes, and rewinds without rebuilding the world", async () => {
    const session = await PreviewSession.open(c, { checkpointInterval: 10 });
    try {
      const boot = session.memoryBytes;
      const late = await session.pngAt(45);
      const early = await session.pngAt(12);
      const again = await session.pngAt(45);
      expect(same(again.bytes, late.bytes)).toBe(true);
      // The boot reading already holds the exposure scratch, so the restores
      // above stay inside the 4x rebuild threshold.
      expect(session.memoryBytes).toBeLessThan(boot * 2);

      const out = join(mkdtempSync(join(tmpdir(), "motion-shutter-")), "f12.png");
      const result = await runFrame({ dir: DIR, at: 12, out, flags: { json: false } });
      expect(result.exitCode).toBe(EXIT_OK);
      expect(same(new Uint8Array(await Bun.file(out).arrayBuffer()), early.bytes)).toBe(true);
    } finally {
      await session.close();
    }
  }, 120_000);

  test("`layout` reads the exposure for in-picture and the tick for rects, and says so", async () => {
    const result = await runLayout({ dir: DIR, at: 15, all: false, flags: { json: true } });
    expect(result.exitCode).toBe(EXIT_OK);
    const json = result.json as { shutter?: unknown; nodes: Array<{ name?: string; x: number; inPicture: boolean }> };
    expect(json.shutter).toEqual({ angle: 180, samples: 8 });
    expect(result.stdoutLines?.join("\n")).toContain("rects and ink");
    // `known` at frame 15 (clock 31): the tick puts it at 1200 + 124.
    const known = json.nodes.find((n) => n.name === "known")!;
    expect(known.x).toBe(1324);
    expect(known.inPicture).toBe(true);
  }, 60_000);

  test("the prober asks the exposure's draw hash, and walks the tick for a rect without a raster", () => {
    const calls: string[] = [];
    const exports = {
      ui_debug_inspect: () => {},
      ui_debug_rect_xy: () => 0,
      ui_debug_rect_wh: () => 0,
      ui_debug_hide: () => {},
      ui_draw_hash: () => (calls.push("tick-hash"), 1n),
      ui_draw_hash_exposure: (n: number, d: number, s: number) => (calls.push(`exposure-hash ${n}/${d}x${s}`), 2n),
    };
    const world = {
      exports,
      render: () => (calls.push("exposure"), new Uint8Array(4)),
      renderTick: () => (calls.push("tick"), new Uint8Array(4)),
      exposure: { angle: 180, samples: 8, spanNum: 360, spanDen: 360 },
    } as never;
    const p = openProber(world, { classify: true });
    p.drawHash!();
    p.render();
    rect(p, 3);
    expect(calls).toEqual(["exposure-hash 360/360x8", "exposure", "tick-hash"]);

    // `read: "tick"` asks both questions of the tick: one walk, one raster.
    calls.length = 0;
    const t = openProber(world, { classify: true, read: "tick" });
    t.drawHash!();
    t.render();
    rect(t, 3);
    expect(calls).toEqual(["tick-hash", "tick", "tick-hash"]);
    expect(t.exposure).toBeNull();
  });
});

describe("what reports the shutter's edges", () => {
  test("`keyframes` lists the fixture's two jumps: the zero-length interval and the one-tick flick", async () => {
    const report = await readTimelines({
      pakPath: c.pakPath,
      fps: c.fps,
      durationFrames: c.durationFrames,
      tickHz: TICKS_PER_SECOND,
    });
    const jumps = report!.timelines.flatMap((t) => t.shutterJumps);
    expect(jumps).toEqual([
      { prop: "translateX", tick: 30, kind: "cut" },
      { prop: "translateX", tick: 50, kind: "step" },
    ]);
  });

  test("the integrated props are the core's: SHUTTER_INTEGRATED mirrors `integrates` in shutter.rs", () => {
    const rs = readFileSync(join(VENDOR, "engine/core/src/shutter.rs"), "utf8");
    const body = rs.slice(rs.indexOf("pub fn integrates"), rs.indexOf("fn rotary"));
    const consts = [...body.matchAll(/p::([A-Z_]+)/g)].map((m) => m[1]!);
    const camel = consts.map((k) => k.toLowerCase().replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase()));
    expect(camel.sort()).toEqual([...SHUTTER_INTEGRATED].sort());
  });

  test("lint warns on a hold the source text shows cannot work, and not on the fixture's", async () => {
    const src = [
      "mount(() => (",
      '  <View class="animate-slide">',
      '    <Text class="shutter-hold animate-pop">{"under a mover"}</Text>',
      '    <View class={on ? "shutter-hold" : "w-full"} />',
      "  </View>",
      "));",
    ].join("\n");
    const declared = await lintShutterSource(src, "t.tsx", true);
    expect(declared.map((w) => `${w.line}:${w.code}`)).toEqual([
      "3:shutter.holdUnderAnimatedAncestor",
      "4:shutter.holdsNothing",
      "4:shutter.holdUnderAnimatedAncestor",
    ]);
    const undeclared = await lintShutterSource(src, "t.tsx", false);
    expect(undeclared.map((w) => w.code)).toEqual(["shutter.holdsNothing", "shutter.holdsNothing"]);
    const fixture = readFileSync(join(DIR, "main.tsx"), "utf8");
    expect(await lintShutterSource(fixture, "main.tsx", true)).toEqual([]);
  });
});

describe("presence under the shutter", () => {
  test("a rect read after a draw walk is the rect a render leaves, for every node, at moving frames", async () => {
    const world = await boot(c.shutter);
    const tree = world.getTree() as { i: number; t: string; k?: unknown[] };
    const ids: number[] = [];
    const collect = (n: { i: number; t: string; k?: unknown[] } | undefined): void => {
      if (!n || typeof n.i !== "number" || n.t === "#text") return;
      ids.push(n.i);
      for (const kid of n.k ?? []) collect(kid as typeof n);
    };
    collect(tree);
    const prober = openProber(world, { classify: true });
    const whip = findNamed(tree, "label-blur");
    const whipAt: number[] = [];
    let at = 1;
    for (const frame of [0, 15, 24, 45, 60]) {
      advance(world, at, frame);
      at = frame + 1;
      world.render(); // an exposure first, so the walk follows what a sweep does
      for (const id of ids) {
        const walked = rect(prober, id);
        prober.inspect(id);
        world.renderTick();
        expect([walked.xy, walked.wh], `node ${id} at frame ${frame}`).toEqual([prober.rectXY(), prober.rectWH()]);
        expect(walked.xy, `node ${id} at frame ${frame}`).not.toBe(-1);
      }
      prober.inspect(0);
      whipAt.push(rect(prober, whip).xy);
      prober.inspect(0);
    }
    // The whip moves between those frames, so equal rects are not one stale
    // latch read five times.
    expect(new Set(whipAt).size).toBeGreaterThan(1);
  }, 120_000);

  test("`layout` finds `peek` in the exposure, and covered at the tick when asked, and says which it read", async () => {
    const exposure = await runLayout({ dir: DIR, at: 45, all: false, flags: { json: true } });
    const tick = await runLayout({ dir: DIR, at: 45, all: false, read: "tick", flags: { json: true } });
    type Json = { read?: string; nodes: Array<{ name?: string; x: number; visibility?: string }> };
    const peek = (r: typeof exposure) => (r.json as Json).nodes.find((n) => n.name === "peek")!;
    expect((exposure.json as Json).read).toBe("exposure");
    expect(peek(exposure).visibility).toBe("on-screen");
    expect((tick.json as Json).read).toBe("tick");
    expect(peek(tick).visibility).toBe("covered");
    expect(tick.stdoutLines?.join("\n")).toContain("read at the TICK (--read tick)");
    // Rects are the tick in both readings.
    expect(peek(tick).x).toBe(peek(exposure).x);
  }, 120_000);

  test("`assert` and `visibility` pass `peek` on the exposure and fail it at the tick", async () => {
    type Assert = { ok: boolean; read?: string; failures: string[]; assertions: Array<{ node: string; ok: boolean; detail: string }> };
    const onExposure = (await runAssert({ dir: DIR, flags: { json: true } })).json as Assert;
    const atTick = (await runAssert({ dir: DIR, read: "tick", flags: { json: true } })).json as Assert;
    expect(onExposure.read).toBe("exposure");
    expect(onExposure.ok).toBe(true);
    expect(atTick.read).toBe("tick");
    expect(atTick.failures).toEqual(["peek inPicture"]);
    expect(atTick.assertions.find((a) => a.node === "peek")!.detail).toContain("covered at");

    type Vis = { ok: boolean; read?: string; failures: string[] };
    const visExposure = (await runVisibility({ dir: DIR, all: false, flags: { json: true } })).json as Vis;
    const visTick = (await runVisibility({ dir: DIR, all: false, read: "tick", flags: { json: true } })).json as Vis;
    expect([visExposure.read, visExposure.failures]).toEqual(["exposure", []]);
    expect([visTick.read, visTick.failures]).toEqual(["tick", ["peek"]]);
  }, 600_000);
});
