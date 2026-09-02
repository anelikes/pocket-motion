/**
 * Read the baked keyframe timelines out of a pak, and place them on the grid
 * the render actually samples.
 *
 * Motion comes from timelines the compiler bakes into `styles.bin`: a delay, a
 * period, and per-property segments whose endpoints are frame counts at the
 * bake rate. The bake rate is the realm's tick rate — 60 — and it is not the
 * composition's `fps`. The realm steps `60 / fps` ticks per rendered frame and
 * rasterises once, at the end, so **only every `60 / fps`-th tick is ever
 * looked at**. An endpoint that lands between two of them is not wrong and not
 * nondeterministic; it is simply never observed, and the transition it declares
 * appears at the next sampled tick instead.
 *
 * The declared timing is therefore quantised twice: once by
 * `msToFrames` at bake time (round-half-up to 60 Hz), and once by the sampling
 * grid at render time. The second one is invisible everywhere — the pak is
 * valid, the realm is clean, the digest is stable — and it does not shift a
 * whole stagger evenly. `compositions/curves` asks for six ghost lags 45 ms
 * apart; they bake to ticks 3, 5, 8, 11, 14, 16 and are sampled at 4, 6, 8, 12,
 * 14, 16 — gaps of 2, 2, 4, 2, 2 where the author wrote five equal ones. That
 * composition exists to read curve speed off ghost spacing.
 *
 * This module reports. It does not re-time anything, and it says nothing about
 * whether an animated node is on screen — `layout` answers that, one frame at a
 * time, and neither command answers it across a node's whole span.
 */

import { pocketjsRoot } from "../runtime/boot.ts";

/** One baked timeline as a style record uses it. */
export interface TimelineUse {
  /** Index into the style table — the compiled class literal that carries it. */
  readonly styleIndex: number;
  /** Index into the ANIM TABLE. Several style records may share one. */
  readonly animId: number;
  /** Whole-choreography loop period in ticks, or 0 when it plays once. */
  readonly loopFrames: number;
  /** Ticks between the node's clock start and this timeline's first segment. */
  readonly delayFrames: number;
  /** One iteration's length in ticks. */
  readonly periodFrames: number;
  /** 0 means infinite. */
  readonly iterations: number;
  /** Animated properties, by spec name. */
  readonly props: readonly string[];
  readonly segments: number;
  /** Ticks of clock this timeline can actually be observed over. */
  readonly windowTicks: number;
  /** The delay outlives the window: no frame of this composition shows it. */
  readonly neverStarts: boolean;
  /** A finite animation whose last iteration is cut off by the window. */
  readonly endsPastWindow: boolean;
  /** Declared instants in the first iteration that no rendered frame samples. */
  readonly unsampled: readonly UnsampledInstant[];
  /** The period is not a whole number of rendered frames, so every iteration
   *  after the first lands on a different phase of the sampling grid. */
  readonly periodOffGrid: boolean;
  /** Same, for the whole-choreography loop. */
  readonly loopOffGrid: boolean;
}

/** A declared instant and the frame that actually shows it. */
export interface UnsampledInstant {
  readonly what: "delay" | "segment";
  /** Ticks from the node's clock start. */
  readonly tick: number;
  /** The first sampled tick at or after it. */
  readonly observedTick: number;
  /** observedTick - tick, in rendered frames. Always in (0, 1). */
  readonly shiftFrames: number;
}

export interface TimelineReport {
  readonly fps: number;
  readonly durationFrames: number;
  /** Core ticks per rendered frame — the sampling stride. */
  readonly ticksPerFrame: number;
  readonly totalTicks: number;
  readonly timelines: readonly TimelineUse[];
  /** Distinct ANIM TABLE entries, whether or not a style record uses them. */
  readonly bakedCount: number;
  /** Baked entries no style record references. */
  readonly unreferenced: number;
}

/** Everything this module needs from the vendored spec, imported at call time
 *  (the same route `frame.ts` takes to upstream's PNG writer). */
interface SpecModule {
  decodeStyleTable(bytes: Uint8Array): {
    styles: Array<{ animation?: { anims: number[]; loopFrames: number } }>;
    anims: Array<{
      delayFrames: number;
      periodFrames: number;
      iterations: number;
      fill: number;
      tracks: Array<{ prop: number; segments: Array<{ t0: number; t1: number }> }>;
    }>;
  };
  PROP: Record<string, number>;
}

interface PakModule {
  unpack(file: Uint8Array): Array<{ key: string; data: Uint8Array }>;
  KEY_STYLES: string;
}

export interface TimelineInputs {
  readonly pakPath: string;
  readonly fps: number;
  readonly durationFrames: number;
  /**
   * Core ticks per second — the rate the pak's frame counts are IN.
   *
   * Required, and it used to default to 60. A pak baked at another rate makes
   * every number here wrong in the lenient direction: `ticksPerFrame` doubles,
   * `totalTicks` doubles with it, and a timeline whose delay outlives the clock
   * stops looking like one. The caller has to say where the rate came from
   * rather than inherit it from this file.
   */
  readonly tickHz: number;
}

/**
 * Decode and analyse. Returns null when the pak carries no style table at all,
 * which is a composition with no class literals rather than a failure.
 */
export async function readTimelines(
  inputs: TimelineInputs,
): Promise<TimelineReport | null> {
  const pak = (await import(
    `${pocketjsRoot()}/framework/compiler/pak.ts`
  )) as unknown as PakModule;
  const spec = (await import(
    `${pocketjsRoot()}/contracts/spec/spec.ts`
  )) as unknown as SpecModule;

  const bytes = new Uint8Array(await Bun.file(inputs.pakPath).arrayBuffer());
  const blob = pak.unpack(bytes).find((b) => b.key === pak.KEY_STYLES);
  if (!blob) return null;

  const table = spec.decodeStyleTable(blob.data);
  const propName = reversePropMap(spec.PROP);

  const ticksPerFrame = inputs.tickHz / inputs.fps;
  const totalTicks = inputs.durationFrames * ticksPerFrame;

  const timelines: TimelineUse[] = [];
  const referenced = new Set<number>();

  for (const [styleIndex, style] of table.styles.entries()) {
    const use = style.animation;
    if (!use) continue;
    for (const animId of use.anims) {
      referenced.add(animId);
      const anim = table.anims[animId];
      if (!anim) continue; // a reference the table cannot satisfy is not ours to invent
      timelines.push(
        analyse({
          styleIndex,
          animId,
          loopFrames: use.loopFrames,
          anim,
          propName,
          ticksPerFrame,
          totalTicks,
        }),
      );
    }
  }

  return {
    fps: inputs.fps,
    durationFrames: inputs.durationFrames,
    ticksPerFrame,
    totalTicks,
    timelines,
    bakedCount: table.anims.length,
    unreferenced: table.anims.length - referenced.size,
  };
}

function reversePropMap(prop: Record<string, number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [name, id] of Object.entries(prop)) {
    if (typeof id === "number" && !out.has(id)) out.set(id, name);
  }
  return out;
}

interface AnalyseInputs {
  readonly styleIndex: number;
  readonly animId: number;
  readonly loopFrames: number;
  readonly anim: {
    delayFrames: number;
    periodFrames: number;
    iterations: number;
    tracks: Array<{ prop: number; segments: Array<{ t0: number; t1: number }> }>;
  };
  readonly propName: ReadonlyMap<number, string>;
  readonly ticksPerFrame: number;
  readonly totalTicks: number;
}

function analyse(i: AnalyseInputs): TimelineUse {
  const { anim, ticksPerFrame, totalTicks } = i;

  // The clock a node's animations run against restarts every `loopFrames`
  // ticks, so a loop shorter than the composition bounds what is reachable;
  // a loop longer than it never wraps and the composition bounds it instead.
  const windowTicks =
    i.loopFrames > 0 ? Math.min(i.loopFrames, totalTicks) : totalTicks;

  const props = [...new Set(anim.tracks.map((t) => i.propName.get(t.prop) ?? `prop${t.prop}`))];
  const segments = anim.tracks.reduce((n, t) => n + t.segments.length, 0);

  // Distinct segment boundaries: several tracks usually share them, and one
  // boundary reported once per track would read as many separate defects.
  const boundaries = new Set<number>();
  for (const track of anim.tracks) {
    for (const seg of track.segments) {
      boundaries.add(seg.t0);
      boundaries.add(seg.t1);
    }
  }

  const unsampled: UnsampledInstant[] = [];
  const consider = (what: "delay" | "segment", tick: number): void => {
    if (tick >= windowTicks) return; // outside the film; not a timing shift
    const instant = unsampledInstant(what, tick, ticksPerFrame);
    if (instant) unsampled.push(instant);
  };
  consider("delay", anim.delayFrames);
  for (const t of [...boundaries].sort((a, b) => a - b)) {
    if (t === 0) continue; // the delay already reports the first boundary
    consider("segment", anim.delayFrames + t);
  }

  const iterationsEnd =
    anim.iterations === 0
      ? Infinity
      : anim.delayFrames + anim.periodFrames * anim.iterations;

  return {
    styleIndex: i.styleIndex,
    animId: i.animId,
    loopFrames: i.loopFrames,
    delayFrames: anim.delayFrames,
    periodFrames: anim.periodFrames,
    iterations: anim.iterations,
    props,
    segments,
    windowTicks,
    neverStarts: anim.delayFrames >= windowTicks,
    endsPastWindow: iterationsEnd > windowTicks && Number.isFinite(iterationsEnd),
    unsampled,
    periodOffGrid: anim.iterations !== 1 && anim.periodFrames % ticksPerFrame !== 0,
    loopOffGrid: i.loopFrames > 0 && i.loopFrames % ticksPerFrame !== 0,
  };
}

/** The instant, and where the render first shows it — or null when it is sampled. */
function unsampledInstant(
  what: "delay" | "segment",
  tick: number,
  ticksPerFrame: number,
): UnsampledInstant | null {
  if (tick % ticksPerFrame === 0) return null;
  const observedTick = Math.ceil(tick / ticksPerFrame) * ticksPerFrame;
  return {
    what,
    tick,
    observedTick,
    shiftFrames: (observedTick - tick) / ticksPerFrame,
  };
}

/** Milliseconds that bake to a tick the given fps samples. */
export function nearestSampledMs(ms: number, fps: number): number {
  const perFrameMs = 1000 / fps;
  return Math.round(ms / perFrameMs) * perFrameMs;
}
