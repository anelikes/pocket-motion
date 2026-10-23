/**
 * Tracks over 255 segments (patches/0050), from the generator kit to the
 * picture.
 *
 * The format half — the wide segment count, its one encoding, the core's
 * search, the order it refuses — is held in the patch's own tests
 * (`engine/core/src/tests.rs`, `tests/anim-long-tracks.test.ts` in the
 * vendored tree, which this suite does not run). What this file holds is what
 * those cannot see:
 *
 *   - `src/anim/sampled.ts` writes a film-length move as ONE keyframe set and
 *     the vendored baker, encoder and decoder carry every segment of it — red
 *     with the kit's old 250-key refusal restored, and red with 0050 out of
 *     `patches/` ("animation track needs 1..255 segments");
 *   - `compositions/long-track`, built, puts every station of its camera tour
 *     at the canvas centre on the tick the generator wrote, the last one by a
 *     cut past the 2,000th segment, and its sidecar's assertions hold. A
 *     track the core stopped reading at its 255th segment leaves the camera
 *     between the first two stations from tick 510 on, and every arrival
 *     after `station-1` fails here.
 *
 * Positions are read from `layout`, the world box of each named station, at
 * the frame its arrival tick falls on. Frame f shows the node's clock 2f + 1
 * (see `tests/shutter.test.ts`, "frame 15 (clock 31)"), one tick past an
 * arrival on an even tick; the legs are eased in and out, so that tick moves
 * the camera by less than a hundredth of a pixel and the box rounds to the
 * same place. The tolerance is the box's own rounding, one pixel.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { El, inOut, lerp, MAX_TICKS, MOVE_STEP, Reg } from "../src/anim/sampled.ts";
import { runBuild } from "../src/cli/build.ts";
import { run as runAssert } from "../src/cli/commands/assert.ts";
import { run as runLayout } from "../src/cli/commands/layout.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { EXIT_OK } from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const DIR = join(ROOT, "compositions", "long-track");
process.env.POCKETJS_ROOT = VENDOR;

interface Segment {
  t0: number;
  t1: number;
  from: number;
  to: number;
}
interface Timeline {
  tracks: Array<{ prop: number; segments: Segment[] }>;
}

describe("the kit writes a film-length move as one keyframe set the format carries", () => {
  test("an El.path over 70 s survives the baker, the encoder and the decoder segment for segment", async () => {
    const ticks = 4200;
    const reg = new Reg(ticks, 70_000);
    const el = new El(reg, { x: 0, y: 0, w: 10, h: 10 });
    el.path(0, ticks, (t) => ({ cx: 5 + lerp(0, 900, inOut(t / ticks)), cy: 5 + 40 * Math.sin(t / 50) }));
    const entry = el.entry();
    const name = entry.split(" ")[0]!;
    const stops = Object.keys(reg.keyframes[name]!).length;
    expect(stops).toBe(ticks / MOVE_STEP + 1);

    const { registerAnimationTheme, bakedTimelines } = (await import(
      `${VENDOR}/framework/compiler/animation.ts`
    )) as { registerAnimationTheme(theme: unknown): void; bakedTimelines(): Timeline[] };
    const { parseClassLiteral } = (await import(`${VENDOR}/framework/compiler/tailwind.ts`)) as {
      parseClassLiteral(literal: string): { animation?: { anims: number[] } } | null;
    };
    const spec = (await import(`${VENDOR}/contracts/spec/spec.ts`)) as {
      encodeStyleTable(styles: unknown[], anims: Timeline[]): Uint8Array;
      decodeStyleTable(bytes: Uint8Array): { anims: Timeline[] };
      PROP: Record<string, number>;
    };
    registerAnimationTheme({ keyframes: reg.keyframes, animation: { walk: entry } });
    try {
      const rec = parseClassLiteral("animate-walk")!;
      const baked = bakedTimelines()[rec.animation!.anims[0]!]!;
      const back = spec.decodeStyleTable(spec.encodeStyleTable([rec], bakedTimelines())).anims[0]!;
      for (const prop of ["translateX", "translateY"]) {
        const track = back.tracks.find((t) => t.prop === spec.PROP[prop])!;
        expect(track.segments.length).toBe(stops - 1);
        expect(track.segments).toEqual(baked.tracks.find((t) => t.prop === spec.PROP[prop])!.segments);
        expect(track.segments[track.segments.length - 1]!.t1).toBe(ticks);
      }
    } finally {
      registerAnimationTheme(undefined);
    }
  });

  test("Reg refuses a film longer than a timeline's u16 period, and takes the longest one", () => {
    expect(MAX_TICKS).toBe(65_535);
    expect(() => new Reg(MAX_TICKS + 1, ((MAX_TICKS + 1) * 1000) / 60)).toThrow(/at most 65535/);
    expect(() => new Reg(MAX_TICKS, (MAX_TICKS * 1000) / 60)).not.toThrow();
  });
});

describe("compositions/long-track", () => {
  interface Arrival {
    node: string;
    tick: number;
    size: number;
  }
  let stations: { canvas: { w: number; h: number }; arrivals: Arrival[]; cut: number };

  beforeAll(async () => {
    stations = JSON.parse(await Bun.file(join(DIR, "stations.json")).text());
    const resolved = await resolveComposition({ dir: DIR, flags: { json: false }, requireBundle: false });
    if (!resolved.ok) throw new Error("long-track did not resolve");
    await runBuild(resolved.value);
  }, 300_000);

  test("every station is at the canvas centre on its arrival, the last by the cut", async () => {
    const off: string[] = [];
    for (const a of stations.arrivals) {
      const frame = a.tick / 2;
      const result = await runLayout({ dir: DIR, at: frame, all: false, flags: { json: true } });
      expect(result.exitCode).toBe(EXIT_OK);
      const nodes = (result.json as { nodes: Array<{ name?: string; x: number; y: number; inPicture: boolean }> }).nodes;
      const n = nodes.find((m) => m.name === a.node);
      const want = { x: stations.canvas.w / 2 - a.size / 2, y: stations.canvas.h / 2 - a.size / 2 };
      if (!n || !n.inPicture || Math.abs(n.x - want.x) > 1 || Math.abs(n.y - want.y) > 1) {
        off.push(`${a.node} at frame ${frame} (tick ${a.tick}): ${n ? `${n.x},${n.y} inPicture=${n.inPicture}` : "absent"}, want ${want.x},${want.y}`);
      }
    }
    expect(off).toEqual([]);
    // the arrivals span the track: the last travel station after segment 1,750, the cut after 2,000
    expect(stations.arrivals.at(-2)!.tick).toBe(4000);
    expect(stations.cut).toBe(4100);
  }, 300_000);

  test("the sidecar's assertions hold: the counter throughout, the last station from the cut on", async () => {
    const result = await runAssert({ dir: DIR, samples: 24, flags: { json: true } });
    const json = result.json as { ok: boolean; assertions: Array<{ node: string; ok: boolean }>; failures: string[] };
    expect(json.assertions.map((a) => a.node).sort()).toEqual(["counter", "last-station"]);
    expect(json.failures).toEqual([]);
    expect(result.exitCode).toBe(EXIT_OK);
  }, 300_000);
});
