/**
 * The mix graph, as strings.
 *
 * Given a resolved sound declaration, fps and durationFrames, this module
 * returns the ffmpeg audio input list and filter graph. It does not spawn a
 * process: the graph is asserted in tests without ffmpeg running.
 *
 * Placement is the arithmetic the resolver already does — narration at
 * `startFrame`, cues at `atFrame`, dialogue at its derived composition
 * frame. Frames become milliseconds in `framesToMs` and nowhere else.
 *
 * Every element's LEVEL is one piece of data, `elementLevel`: its `gain`
 * times its `envelope` (piecewise linear, on the composition clock), times
 * — for the bed — every declared `ducks[]` window and every narration line's
 * `duck` while that line runs. The graph renders that data as a `volume`
 * expression; `sound --verify` reads the same data as the level it expects
 * to measure. So a regression in the expression is a measured mismatch,
 * not a second copy of the same mistake.
 *
 * The bed is `atrim` from `startAt`, then `volume` (a constant, or an
 * `eval=frame` expression when its level varies), then `afade` in and out —
 * each `afade` only when its declared duration is above zero, because `d=0`
 * means ffmpeg's 44100-sample default, not "no fade". Everything else is
 * `adelay` to its offset, `volume` at its level, and one `amix`. Ducking is
 * that expression, not a compressor: a narration line's window is its start
 * and its probed duration, built before ffmpeg starts.
 *
 * A `volume` whose level varies is preceded by `asetnsamples`, because
 * `eval=frame` evaluates once per audio frame and a WAV leg arrives in
 * 4096-sample frames — 85.3 ms at 48 kHz. Without it a duck engaged up to
 * that late and a ramp moved in 85 ms stairs; with 480-sample frames the step
 * is 10 ms at 48 kHz (10.9 at 44.1).
 *
 * A declared `silentTailMs` ends the graph with `atrim=end` at the GATE —
 * `SILENT_TAIL_GUARD_MS` before the tail, because the codec's overlapping
 * frames carry sound past the last non-zero input — and `apad` to the film's
 * length. `atrim` is sample-exact where an `enable=` gate is frame-quantised.
 * The bed's fade-out completes at the gate. Whether the delivered file IS
 * silent across the tail is measured after the mux (`src/sound/tail.ts`):
 * the encoder runs after this graph.
 */

import {
  SILENT_TAIL_GUARD_MS,
  type Diagnostic,
  type EnvelopePoint,
  type NarrationLine,
  type SidecarSound,
  type SoundBed,
} from "../manifest/sidecar.ts";
import type { ResolvedSoundElement } from "./resolve.ts";

export interface MixGraph {
  /**
   * Audio inputs only, as ffmpeg argv fragments (`-i`, path, …).
   * The muxer prepends the video as input 0; filter labels start at `[1:a]`.
   */
  readonly inputArgs: readonly string[];
  readonly filter: string;
  readonly outputLabel: "[a]";
  /**
   * Every declared element, and whether this graph mixes it. An optional
   * element whose file is not on disk is here with `mixed: false`, which is
   * how `render` reports it rather than leaving it out in silence.
   */
  readonly elements: readonly MixedElement[];
}

export interface MixedElement {
  readonly pointer: string;
  readonly id: string | null;
  readonly role: ResolvedSoundElement["role"];
  readonly optional: boolean;
  readonly mixed: boolean;
  /** Absolute path when on disk. */
  readonly path: string | null;
}

/**
 * A step window on the bed, in composition seconds. A narration line's
 * window is written as it always has been, `between` with both ends in; a
 * declared `ducks[]` window is `halfOpen`, like the frames it came from.
 */
export interface DuckWindow {
  readonly startSec: number;
  readonly endSec: number;
  readonly duck: number;
  readonly halfOpen?: boolean;
}

/** One breakpoint of a level, in composition seconds. */
export interface GainPoint {
  readonly t: number;
  readonly gain: number;
}

/**
 * An element's declared level over the composition: `base` is gain ×
 * envelope (one point means constant), and `ducks` multiply it. Fades and
 * the tail gate are separate filters and are not in here.
 */
export interface ElementLevel {
  readonly base: readonly GainPoint[];
  readonly ducks: readonly DuckWindow[];
}

/** Samples per audio frame ahead of a varying `volume`. */
export const VOLUME_STEP_SAMPLES = 480;

/** True when the sidecar names at least one element to mix. */
export function soundDeclared(sound: SidecarSound): boolean {
  return (
    sound.bed !== undefined ||
    sound.narration.length > 0 ||
    sound.dialogue.length > 0 ||
    sound.cues.length > 0
  );
}

/**
 * Composition frames → milliseconds. The only place that conversion happens.
 * Tested at a rate that is not 30 so a `* fps` / `/ 30` swap cannot hide.
 */
export function framesToMs(frames: number, fps: number): number {
  return (frames * 1000) / fps;
}

/** Where the declared silent tail begins, in seconds; null when none. */
export function tailStartSec(
  sound: SidecarSound,
  fps: number,
  durationFrames: number,
): number | null {
  if (sound.silentTailMs === undefined) return null;
  return (framesToMs(durationFrames, fps) - sound.silentTailMs) / 1000;
}

/**
 * Where the mixer stops all sound ahead of a declared tail, in seconds:
 * `SILENT_TAIL_GUARD_MS` before it. Null when no tail is declared.
 */
export function tailGateSec(
  sound: SidecarSound,
  fps: number,
  durationFrames: number,
): number | null {
  const tail = tailStartSec(sound, fps, durationFrames);
  return tail === null ? null : tail - SILENT_TAIL_GUARD_MS / 1000;
}

/** Filter-graph number: enough decimals, no trailing zeros, no scientific notation. */
export function formatFilterNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`PocketJS Motion: mix graph got a non-finite number ${n}`);
  }
  if (Object.is(n, -0) || n === 0) return "0";
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/**
 * An envelope on the composition clock: each point's frame is counted from
 * the element's own start, and its gain multiplies the element's `gain`.
 */
export function envelopeCurve(
  gain: number,
  envelope: readonly EnvelopePoint[] | undefined,
  startFrame: number,
  fps: number,
): GainPoint[] {
  if (envelope === undefined) return [{ t: framesToMs(startFrame, fps) / 1000, gain }];
  return envelope.map((p) => ({
    t: framesToMs(startFrame + p.frame, fps) / 1000,
    gain: gain * p.gain,
  }));
}

/**
 * The base level as an expression in `t`: one flat term per segment, each
 * gated by `gte(t,a)*lt(t,b)`, so exactly one term is non-zero at any instant
 * and nothing nests. Before the first point the first value holds — for a
 * delayed leg that is the silence `adelay` inserted — and after the last the
 * last value holds.
 */
export function baseLevelExpression(base: readonly GainPoint[]): string {
  if (base.length === 0) {
    throw new Error("PocketJS Motion: a level needs at least one point");
  }
  if (base.length === 1) return formatFilterNumber(base[0]!.gain);
  const f = formatFilterNumber;
  const terms: string[] = [];
  const first = base[0]!;
  if (first.t > 0) terms.push(`lt(t,${f(first.t)})*${f(first.gain)}`);
  for (let k = 0; k + 1 < base.length; k++) {
    const a = base[k]!;
    const b = base[k + 1]!;
    const gate = `gte(t,${f(a.t)})*lt(t,${f(b.t)})`;
    terms.push(
      a.gain === b.gain
        ? `${gate}*${f(a.gain)}`
        : `${gate}*(${f(a.gain)}+(${f(b.gain)}-${f(a.gain)})*(t-${f(a.t)})/(${f(b.t)}-${f(a.t)}))`,
    );
  }
  const last = base[base.length - 1]!;
  terms.push(`gte(t,${f(last.t)})*${f(last.gain)}`);
  return `(${terms.join("+")})`;
}

/**
 * The bed's `volume` expression. Base `gain`, times each line's `duck`
 * while that line runs. A window whose `duck` is 1 is omitted — that is
 * "no duck", and dropping it must not change the string.
 *
 * Commas are not escaped here; `escapeFilterExpr` does that when the
 * expression is embedded in a filter chain.
 */
export function bedVolumeExpression(
  gain: number,
  windows: readonly DuckWindow[],
): string {
  return levelExpression({ base: [{ t: 0, gain }], ducks: windows });
}

/** `base` times every duck window, as one expression in `t`. */
export function levelExpression(level: ElementLevel): string {
  let expr = baseLevelExpression(level.base);
  const f = formatFilterNumber;
  for (const w of level.ducks) {
    if (w.duck === 1) continue;
    expr += w.halfOpen
      ? `*if(gte(t,${f(w.startSec)})*lt(t,${f(w.endSec)}),${f(w.duck)},1)`
      : `*if(between(t,${f(w.startSec)},${f(w.endSec)}),${f(w.duck)},1)`;
  }
  return expr;
}

/** True when the level is one number for the whole composition. */
export function levelIsConstant(level: ElementLevel): boolean {
  return level.base.length === 1 && level.ducks.every((w) => w.duck === 1);
}

/** The declared level at composition time `t`. */
export function levelAt(level: ElementLevel, t: number): number {
  const base = level.base;
  let g: number;
  if (t <= base[0]!.t) g = base[0]!.gain;
  else if (t >= base[base.length - 1]!.t) g = base[base.length - 1]!.gain;
  else {
    let k = 0;
    while (!(t >= base[k]!.t && t < base[k + 1]!.t)) k++;
    const a = base[k]!;
    const b = base[k + 1]!;
    g = a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
  }
  for (const w of level.ducks) {
    const inside = w.halfOpen
      ? t >= w.startSec && t < w.endSec
      : t >= w.startSec && t <= w.endSec;
    if (inside) g *= w.duck;
  }
  return g;
}

/** Every instant at which the level changes value or slope, sorted. */
export function levelBreaks(level: ElementLevel): number[] {
  const out = new Set<number>();
  if (level.base.length > 1) for (const p of level.base) out.add(p.t);
  for (const w of level.ducks) {
    if (w.duck === 1) continue;
    out.add(w.startSec);
    out.add(w.endSec);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Smallest and largest declared level over `[a, b]`. The level is linear
 * between breaks, so the extremes are at the ends of the interval and on
 * either side of each break inside it.
 */
export function levelRange(
  level: ElementLevel,
  a: number,
  b: number,
): { readonly min: number; readonly max: number } {
  const eps = 1e-9;
  const at = [a, b];
  for (const t of levelBreaks(level)) {
    if (t > a && t < b) at.push(t - eps, t + eps);
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const t of at) {
    const g = levelAt(level, t);
    if (g < min) min = g;
    if (g > max) max = g;
  }
  return { min, max };
}

/**
 * The first instant from which the level is 0 for the rest of the film, or
 * null when it never is. Ducks are ignored: a duck of 0 is a window.
 */
export function silentFromSec(level: ElementLevel): number | null {
  const base = level.base;
  let k = base.length;
  while (k > 0 && base[k - 1]!.gain === 0) k--;
  if (k === base.length) return null;
  return k === 0 ? Number.NEGATIVE_INFINITY : base[k]!.t;
}

function escapeFilterExpr(expr: string): string {
  return expr.replace(/,/g, "\\,");
}

function byPointer(
  resolved: readonly ResolvedSoundElement[],
): Map<string, ResolvedSoundElement> {
  return new Map(resolved.map((el) => [el.pointer, el]));
}

/**
 * Resolve a declared src, or `null` when `omit` names this pointer, when the
 * element is optional and its file is not on disk, or — only while building
 * a counterfactual — when a sibling's file is not on disk. The render path
 * passes no `omit` and still throws on a missing required file.
 */
function takeResolved(
  map: Map<string, ResolvedSoundElement>,
  pointer: string,
  label: string,
  omit: string | undefined,
): ResolvedSoundElement | null {
  if (pointer === omit) return null;
  const el = map.get(pointer);
  if (el === undefined) {
    throw new Error(`PocketJS Motion: mix graph has no resolved path for ${label}`);
  }
  if (el.path === null) {
    if (el.optional === true || omit !== undefined) return null;
    throw new Error(
      `PocketJS Motion: mix graph cannot use ${label}: the file is not on disk`,
    );
  }
  return el;
}

function requireDuration(
  el: ResolvedSoundElement,
  label: string,
  why: string,
): number {
  if (el.durationSec === undefined) {
    throw new Error(
      `PocketJS Motion: mix graph needs a probed duration on ${label} ` +
        `to ${why}; call probeSoundDurations first`,
    );
  }
  return el.durationSec;
}

/** Options for building a counterfactual. The render path passes none. */
export interface MixOptions {
  /**
   * Keep the omitted narration line's duck window on the bed. `verify` uses
   * it to measure that line's own level: without it the residual is the line
   * PLUS the duck it removed from the bed.
   */
  readonly omitKeepsDuck?: boolean;
}

function narrationWindows(
  lines: readonly NarrationLine[],
  resolved: Map<string, ResolvedSoundElement>,
  fps: number,
  omit: string | undefined,
  options: MixOptions,
): DuckWindow[] {
  const windows: DuckWindow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const pointer = `/sound/narration/${i}/src`;
    const kept = pointer === omit && options.omitKeepsDuck === true;
    const el = kept
      ? resolved.get(pointer) ?? null
      : takeResolved(resolved, pointer, `narration ${JSON.stringify(line.id)}`, omit);
    if (el === null || el.path === null) continue;
    if (line.duck === 1) continue;
    const startSec = framesToMs(line.startFrame, fps) / 1000;
    const durationSec = requireDuration(
      el,
      `narration ${JSON.stringify(line.id)}`,
      "place the duck envelope",
    );
    windows.push({
      startSec,
      endSec: startSec + durationSec,
      duck: line.duck,
    });
  }
  return windows;
}

function bedDuckWindows(bed: SoundBed, fps: number): DuckWindow[] {
  return (bed.ducks ?? []).map((d) => ({
    startSec: framesToMs(d.startFrame, fps) / 1000,
    endSec: framesToMs(d.endFrame, fps) / 1000,
    duck: d.duck,
    halfOpen: true,
  }));
}

/** Composition frame an element starts at, as the graph places it. */
function startFrameOf(
  pointer: string,
  sound: SidecarSound,
  map: Map<string, ResolvedSoundElement>,
): number {
  const m = pointer.match(/^\/sound\/(narration|dialogue|cues)\/(\d+)\/src$/);
  if (pointer === "/sound/bed/src") return 0;
  if (m === null) throw new Error(`PocketJS Motion: no element at ${pointer}`);
  const i = Number(m[2]);
  if (m[1] === "narration") return sound.narration[i]!.startFrame;
  if (m[1] === "cues") return sound.cues[i]!.atFrame;
  const frame = map.get(pointer)?.compositionFrame;
  if (frame === undefined) {
    throw new Error(
      `PocketJS Motion: mix graph needs a composition frame on dialogue ${JSON.stringify(sound.dialogue[i]!.id)}`,
    );
  }
  return frame;
}

/**
 * The declared level of the element at `pointer`. For the bed this is the
 * level the graph renders for THIS mix — so `omit` and `options` are taken,
 * and an omitted narration line's duck is gone unless `omitKeepsDuck`.
 */
export function elementLevel(
  pointer: string,
  sound: SidecarSound,
  resolved: readonly ResolvedSoundElement[],
  fps: number,
  omit?: string,
  options: MixOptions = {},
): ElementLevel {
  const map = byPointer(resolved);
  const start = startFrameOf(pointer, sound, map);
  if (pointer === "/sound/bed/src") {
    const bed = sound.bed!;
    return {
      base: envelopeCurve(bed.gain, bed.envelope, 0, fps),
      ducks: [
        ...narrationWindows(sound.narration, map, fps, omit, options),
        ...bedDuckWindows(bed, fps),
      ],
    };
  }
  const m = pointer.match(/^\/sound\/(narration|dialogue|cues)\/(\d+)\/src$/)!;
  const i = Number(m[2]);
  const el =
    m[1] === "narration" ? sound.narration[i]! : m[1] === "cues" ? sound.cues[i]! : sound.dialogue[i]!;
  return { base: envelopeCurve(el.gain, el.envelope, start, fps), ducks: [] };
}

/** `volume=…`, preceded by `asetnsamples` when the level varies. */
function volumeFilters(level: ElementLevel): string[] {
  if (levelIsConstant(level)) {
    return [`volume=${formatFilterNumber(level.base[0]!.gain)}`];
  }
  return [
    `asetnsamples=n=${VOLUME_STEP_SAMPLES}:p=0`,
    `volume=volume='${escapeFilterExpr(levelExpression(level))}':eval=frame`,
  ];
}

function bedBranch(
  bed: SoundBed,
  path: string,
  inputIndex: number,
  durationSec: number,
  fadeOutEndSec: number,
  level: ElementLevel,
): { inputArgs: string[]; filter: string; label: string } {
  const fadeInSec = bed.fadeInMs / 1000;
  const fadeOutSec = bed.fadeOutMs / 1000;
  const fadeOutStart = Math.max(0, fadeOutEndSec - fadeOutSec);
  const parts = [
    `atrim=start=${formatFilterNumber(bed.startAt)}:duration=${formatFilterNumber(durationSec)}`,
    `asetpts=PTS-STARTPTS`,
    ...volumeFilters(level),
    // `afade` with `d=0` is not "no fade": ffmpeg falls back to its
    // `nb_samples` default of 44100, which at 48 kHz ramps for 0.92 s.
    // Measured on a constant 220 Hz tone through `afade=t=in:st=0:d=0`:
    // −45.13 dBFS at 0 s, −36.67 at 0.1 s, −25.52 at 0.5 s, and level
    // (−21.07) at 0.92 s, against −21.07 untouched throughout. A bed that
    // declares no fade must not be faded, so the leg is left out.
    ...(fadeInSec > 0
      ? [`afade=t=in:st=0:d=${formatFilterNumber(fadeInSec)}`]
      : []),
    ...(fadeOutSec > 0
      ? [
          `afade=t=out:st=${formatFilterNumber(fadeOutStart)}:d=${formatFilterNumber(fadeOutSec)}`,
        ]
      : []),
  ];
  return {
    inputArgs: ["-i", path],
    filter: `[${inputIndex}:a]${parts.join(",")}[bed]`,
    label: "[bed]",
  };
}

function delayedBranch(
  path: string,
  inputIndex: number,
  startMs: number,
  level: ElementLevel,
  label: string,
): { inputArgs: string[]; filter: string; label: string } {
  const parts: string[] = [];
  if (startMs !== 0) {
    parts.push(`adelay=${formatFilterNumber(startMs)}:all=1`);
  }
  // After `adelay`, `t` is composition time: the inserted silence starts at
  // pts 0. Measured: a step written at t=1.5 on a line delayed by 1 s lands
  // at composition 1.5 s, not 2.5.
  parts.push(...volumeFilters(level));
  return {
    inputArgs: ["-i", path],
    filter: `[${inputIndex}:a]${parts.join(",")}${label}`,
    label,
  };
}

/**
 * Elements that, by their probed length, are still sounding when the mixer
 * stops sound ahead of the declared silent tail — the gate would cut them.
 *
 * An element whose level reaches 0 for good at or before the gate is not one
 * of them: its envelope already ends it. The bed is never one: its fade-out
 * is moved to complete at the gate. A skipped optional element is not mixed
 * and is not one.
 */
export function tailOverruns(
  sound: SidecarSound,
  resolved: readonly ResolvedSoundElement[],
  fps: number,
  durationFrames: number,
): Diagnostic[] {
  const tail = tailGateSec(sound, fps, durationFrames);
  if (tail === null) return [];
  const map = byPointer(resolved);
  const out: Diagnostic[] = [];
  for (const el of resolved) {
    if (el.role === "bed" || el.path === null) continue;
    const label = `${el.role} ${JSON.stringify(el.id)}`;
    const startSec = framesToMs(startFrameOf(el.pointer, sound, map), fps) / 1000;
    const endSec = startSec + requireDuration(el, label, "check it against the silent tail");
    if (endSec <= tail + 1e-9) continue;
    const silentFrom = silentFromSec(elementLevel(el.pointer, sound, resolved, fps));
    if (silentFrom !== null && silentFrom <= tail + 1e-9) continue;
    out.push({
      code: "sound.tail.overrun",
      path: el.pointer,
      message:
        `${label} plays from ${startSec.toFixed(3)} s to ${endSec.toFixed(3)} s by its file's length, ` +
        `past ${tail.toFixed(3)} s, where sound stops ${SILENT_TAIL_GUARD_MS} ms before the ` +
        `${sound.silentTailMs} ms silent tail, and the gate would cut it. Move it, shorten the ` +
        `file, or bring its envelope to 0 by ${tail.toFixed(3)} s`,
    });
  }
  return out;
}

/**
 * Build the audio input list and filter graph.
 *
 * Audio inputs are numbered from 1 so the muxer can put the finished
 * video at 0 and copy it. `amix` uses `normalize=0` so adding a cue does
 * not divide the bed down by the input count.
 *
 * `omit` is a JSON pointer (`/sound/narration/0/src`, …). That element's
 * input and leg are left out, and so is its duck window — the mix
 * without that element, not the mix with a hole in the same envelope —
 * unless `options.omitKeepsDuck`. Used by verify to build counterfactuals;
 * the render path never passes it, and on the render path an element that
 * runs into a declared silent tail is refused here as well as by `render`.
 */
export function mixGraph(
  sound: SidecarSound,
  resolved: readonly ResolvedSoundElement[],
  fps: number,
  durationFrames: number,
  omit?: string,
  options: MixOptions = {},
): MixGraph {
  if (!soundDeclared(sound)) {
    throw new Error("PocketJS Motion: mixGraph called with nothing declared");
  }
  if (fps <= 0) {
    throw new Error(`PocketJS Motion: mixGraph fps must be positive; got ${fps}`);
  }
  if (omit === undefined) {
    const overruns = tailOverruns(sound, resolved, fps, durationFrames);
    if (overruns.length > 0) {
      throw new Error(
        `PocketJS Motion: ${overruns.map((d) => d.message).join("\n")}`,
      );
    }
  }

  const map = byPointer(resolved);
  const durationSec = framesToMs(durationFrames, fps) / 1000;
  const gate = tailGateSec(sound, fps, durationFrames);

  const inputArgs: string[] = [];
  const filters: string[] = [];
  const legs: string[] = [];
  const elements: MixedElement[] = [];
  let nextIndex = 1;

  const record = (
    pointer: string,
    id: string | null,
    role: ResolvedSoundElement["role"],
    el: ResolvedSoundElement | null,
  ): void => {
    const known = map.get(pointer);
    elements.push({
      pointer,
      id,
      role,
      optional: known?.optional === true,
      mixed: el !== null,
      path: known?.path ?? null,
    });
  };

  if (sound.bed) {
    const el = takeResolved(map, "/sound/bed/src", "the bed", omit);
    record("/sound/bed/src", null, "bed", el);
    if (el !== null) {
      const branch = bedBranch(
        sound.bed,
        el.path!,
        nextIndex,
        durationSec,
        gate ?? durationSec,
        elementLevel("/sound/bed/src", sound, resolved, fps, omit, options),
      );
      inputArgs.push(...branch.inputArgs);
      filters.push(branch.filter);
      legs.push(branch.label);
      nextIndex++;
    }
  }

  const delayed = [
    ...sound.narration.map((line, i) => ({ role: "narration" as const, id: line.id, i, label: `[n${i}]` })),
    ...sound.dialogue.map((line, i) => ({ role: "dialogue" as const, id: line.id, i, label: `[d${i}]` })),
    ...sound.cues.map((cue, i) => ({ role: "cue" as const, id: cue.id, i, label: `[c${i}]` })),
  ];
  for (const leg of delayed) {
    const pointer = `/sound/${leg.role === "cue" ? "cues" : leg.role}/${leg.i}/src`;
    const el = takeResolved(map, pointer, `${leg.role} ${JSON.stringify(leg.id)}`, omit);
    record(pointer, leg.id, leg.role, el);
    if (el === null) continue;
    const startMs = framesToMs(startFrameOf(pointer, sound, map), fps);
    const branch = delayedBranch(
      el.path!,
      nextIndex,
      startMs,
      elementLevel(pointer, sound, resolved, fps),
      leg.label,
    );
    inputArgs.push(...branch.inputArgs);
    filters.push(branch.filter);
    legs.push(branch.label);
    nextIndex++;
  }

  if (legs.length === 0) {
    // Nothing to mix: every element was omitted for a counterfactual, or is
    // optional and not on disk. The delivery still carries an audio stream,
    // of digital silence, and `elements` says why.
    return {
      inputArgs: [
        "-f",
        "lavfi",
        "-t",
        formatFilterNumber(durationSec),
        "-i",
        "anullsrc=r=48000:cl=stereo",
      ],
      filter: "[1:a]anull[a]",
      outputLabel: "[a]",
      elements,
    };
  }

  const amix = `${legs.join("")}amix=inputs=${legs.length}:normalize=0:dropout_transition=0`;
  if (gate === null) {
    filters.push(`${amix}[a]`);
  } else {
    filters.push(
      `${amix}[mix]`,
      `[mix]atrim=end=${formatFilterNumber(gate)},apad=whole_dur=${formatFilterNumber(durationSec)}[a]`,
    );
  }

  return {
    inputArgs,
    filter: filters.join(";"),
    outputLabel: "[a]",
    elements,
  };
}
