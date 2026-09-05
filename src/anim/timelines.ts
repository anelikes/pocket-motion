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
 * Two more readings come off the same table, each the shape of a defect that
 * shipped in a composition here before anything reported it:
 *
 *   - a CUT the grid lands inside. A segment no longer than one rendered frame
 *     is a step, not a tween — the author wanted the next frame to show the
 *     other state. When its endpoints straddle a sampled tick, the one frame
 *     taken inside it shows the step part-way: a 34 ms gate (two ticks) at an
 *     odd tick, sampled at 30 fps, arrives a frame late and half drawn. A
 *     17 ms gate is one tick and no frame can land inside it.
 *   - a PROPERTY two animations of one comma list write at once. The core
 *     takes the LAST animation currently writing a property, and an animation
 *     with `both` or `backwards` fill is writing from tick 0
 *     (`tick_timelines`, `engine/core/src/lib.rs`). So `gin 34ms both` followed
 *     by a tween whose `from` carries opacity, also `both`, shows the tween's
 *     first keyframe from the start and `gin` never reaches the picture. The
 *     reading is the span over which the earlier one is RUNNING while the
 *     later one is writing; an earlier one merely holding its end value under
 *     a later one is the ordinary hand-off and is not reported.
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
  /** Segments no longer than one rendered frame that a sampled tick lands
   *  strictly inside, so the render shows the step part-way. */
  readonly partialCuts: readonly PartialCut[];
}

/** A step the render takes one frame inside of. */
export interface PartialCut {
  /** Segment endpoints in ticks from the node's clock start. */
  readonly t0: number;
  readonly t1: number;
  /** The sampled tick strictly between them. */
  readonly sampledTick: number;
  /** (sampledTick - t0) / (t1 - t0): how far along the step that frame shows,
   *  before easing. */
  readonly fraction: number;
}

/** A property two animations of one comma list write at the same time. */
export interface PropContention {
  readonly styleIndex: number;
  readonly prop: string;
  /** ANIM TABLE indices in comma-list order; the later one's value is the one
   *  the node gets. */
  readonly earlier: number;
  readonly later: number;
  /** Ticks from the node's clock start over which the earlier timeline is
   *  running and the later one is writing. `toTick` is exclusive and never
   *  past the window. */
  readonly fromTick: number;
  readonly toTick: number;
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
  /** Properties two animations of one style record write at once. */
  readonly contended: readonly PropContention[];
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
  ANIM_FILL_BACKWARDS: number;
  ANIM_FILL_FORWARDS: number;
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
  const contended: PropContention[] = [];
  const referenced = new Set<number>();

  for (const [styleIndex, style] of table.styles.entries()) {
    const use = style.animation;
    if (!use) continue;
    contended.push(
      ...contentions({
        styleIndex,
        anims: use.anims.map((id) => table.anims[id]).filter((a) => a !== undefined),
        animIds: use.anims.filter((id) => table.anims[id] !== undefined),
        loopFrames: use.loopFrames,
        totalTicks,
        propName,
        fillBackwards: spec.ANIM_FILL_BACKWARDS,
        fillForwards: spec.ANIM_FILL_FORWARDS,
      }),
    );
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
    contended,
  };
}

/** The clock a node's animations run against restarts every `loopFrames`
 *  ticks, so a loop shorter than the composition bounds what is reachable; a
 *  loop longer than it never wraps and the composition bounds it instead. */
function windowOf(loopFrames: number, totalTicks: number): number {
  return loopFrames > 0 ? Math.min(loopFrames, totalTicks) : totalTicks;
}

interface BakedAnim {
  delayFrames: number;
  periodFrames: number;
  iterations: number;
  fill: number;
  tracks: Array<{ prop: number; segments: Array<{ t0: number; t1: number }> }>;
}

interface ContentionInputs {
  readonly styleIndex: number;
  readonly anims: readonly BakedAnim[];
  readonly animIds: readonly number[];
  readonly loopFrames: number;
  readonly totalTicks: number;
  readonly propName: ReadonlyMap<number, string>;
  readonly fillBackwards: number;
  readonly fillForwards: number;
}

/**
 * Every (earlier, later) pair of one style record's comma list that share a
 * property, over the ticks where the earlier is running and the later is
 * writing. Mirrors `tick_timelines`: a later entry overrides only while it
 * writes, and it writes before its delay only under backwards fill and after
 * its last iteration only under forwards fill.
 */
function contentions(i: ContentionInputs): PropContention[] {
  const window = windowOf(i.loopFrames, i.totalTicks);
  const running = (a: BakedAnim): [number, number] => [
    a.delayFrames,
    a.iterations === 0 ? Infinity : a.delayFrames + a.periodFrames * a.iterations,
  ];
  const writing = (a: BakedAnim): [number, number] => [
    (a.fill & i.fillBackwards) !== 0 ? 0 : a.delayFrames,
    a.iterations === 0 || (a.fill & i.fillForwards) !== 0
      ? Infinity
      : a.delayFrames + a.periodFrames * a.iterations,
  ];
  const out: PropContention[] = [];
  for (let e = 0; e < i.anims.length; e++) {
    const earlier = i.anims[e]!;
    const [r0, r1] = running(earlier);
    for (let l = e + 1; l < i.anims.length; l++) {
      const later = i.anims[l]!;
      const [w0, w1] = writing(later);
      const fromTick = Math.max(r0, w0);
      const toTick = Math.min(r1, w1, window);
      if (fromTick >= toTick) continue;
      const laterProps = new Set(later.tracks.map((t) => t.prop));
      for (const prop of new Set(earlier.tracks.map((t) => t.prop))) {
        if (!laterProps.has(prop)) continue;
        out.push({
          styleIndex: i.styleIndex,
          prop: i.propName.get(prop) ?? `prop${prop}`,
          earlier: i.animIds[e]!,
          later: i.animIds[l]!,
          fromTick,
          toTick,
        });
      }
    }
  }
  return out;
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

  const windowTicks = windowOf(i.loopFrames, totalTicks);

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

  // A step is a segment no longer than the sampling stride. A sampled tick
  // strictly inside one is a frame that shows the step part-way; the
  // endpoints themselves are the two states the author wrote. Distinct
  // (t0, t1) pairs, for the same reason boundaries are.
  const partialCuts: PartialCut[] = [];
  const seen = new Set<string>();
  for (const track of anim.tracks) {
    for (const seg of track.segments) {
      const key = `${seg.t0}:${seg.t1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cut = partialCut(anim.delayFrames + seg.t0, anim.delayFrames + seg.t1, ticksPerFrame, windowTicks);
      if (cut) partialCuts.push(cut);
    }
  }
  partialCuts.sort((a, b) => a.t0 - b.t0);

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
    partialCuts,
  };
}

/** The one sampled tick strictly inside a step, or null when the segment is
 *  longer than a frame, outside the window, or has no sample inside it. */
function partialCut(
  t0: number,
  t1: number,
  ticksPerFrame: number,
  windowTicks: number,
): PartialCut | null {
  const length = t1 - t0;
  if (length <= 0 || length > ticksPerFrame) return null;
  if (t0 >= windowTicks) return null;
  const sampledTick = Math.ceil((t0 + 1) / ticksPerFrame) * ticksPerFrame;
  if (sampledTick >= t1 || sampledTick >= windowTicks) return null;
  return { t0, t1, sampledTick, fraction: (sampledTick - t0) / length };
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
