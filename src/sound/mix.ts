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
 * The bed is `atrim` from `startAt`, then `volume` (a constant, or an
 * `eval=frame` envelope when a narration line ducks it), then `afade` in
 * and out — each `afade` only when its declared duration is above zero,
 * because `d=0` means ffmpeg's 44100-sample default, not "no fade". Everything else is `adelay` to its offset, `volume` at its
 * gain, and one `amix`. Ducking is that envelope, not a compressor: `duck`
 * on a line is the linear factor the bed's gain is multiplied by while
 * the line runs, built from the line's start and its probed duration
 * before ffmpeg starts.
 */

import type {
  NarrationLine,
  SidecarSound,
  SoundBed,
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
}

export interface DuckWindow {
  readonly startSec: number;
  readonly endSec: number;
  readonly duck: number;
}

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
  let expr = formatFilterNumber(gain);
  for (const w of windows) {
    if (w.duck === 1) continue;
    expr +=
      `*if(between(t,${formatFilterNumber(w.startSec)},${formatFilterNumber(w.endSec)}),` +
      `${formatFilterNumber(w.duck)},1)`;
  }
  return expr;
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
 * Resolve a declared src, or `null` when `omit` names this pointer (or,
 * only while building a counterfactual, a sibling whose file is not on
 * disk). The render path passes no `omit` and still throws on a missing
 * file.
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
    if (omit !== undefined) return null;
    throw new Error(
      `PocketJS Motion: mix graph cannot use ${label}: the file is not on disk`,
    );
  }
  return el;
}

function requireDuration(
  el: ResolvedSoundElement,
  label: string,
): number {
  if (el.durationSec === undefined) {
    throw new Error(
      `PocketJS Motion: mix graph needs a probed duration on ${label} ` +
        `to place the duck envelope; call probeSoundDurations first`,
    );
  }
  return el.durationSec;
}

function bedBranch(
  bed: SoundBed,
  path: string,
  inputIndex: number,
  durationSec: number,
  windows: readonly DuckWindow[],
): { inputArgs: string[]; filter: string; label: string } {
  const fadeInSec = bed.fadeInMs / 1000;
  const fadeOutSec = bed.fadeOutMs / 1000;
  const fadeOutStart = Math.max(0, durationSec - fadeOutSec);
  const expr = bedVolumeExpression(bed.gain, windows);
  const volume =
    windows.some((w) => w.duck !== 1)
      ? `volume=volume='${escapeFilterExpr(expr)}':eval=frame`
      : `volume=${formatFilterNumber(bed.gain)}`;
  const parts = [
    `atrim=start=${formatFilterNumber(bed.startAt)}:duration=${formatFilterNumber(durationSec)}`,
    `asetpts=PTS-STARTPTS`,
    volume,
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
  gain: number,
  label: string,
): { inputArgs: string[]; filter: string; label: string } {
  const parts: string[] = [];
  if (startMs !== 0) {
    parts.push(`adelay=${formatFilterNumber(startMs)}:all=1`);
  }
  parts.push(`volume=${formatFilterNumber(gain)}`);
  return {
    inputArgs: ["-i", path],
    filter: `[${inputIndex}:a]${parts.join(",")}${label}`,
    label,
  };
}

function narrationWindows(
  lines: readonly NarrationLine[],
  resolved: Map<string, ResolvedSoundElement>,
  fps: number,
  omit?: string,
): DuckWindow[] {
  const windows: DuckWindow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const pointer = `/sound/narration/${i}/src`;
    if (pointer === omit) continue;
    const el = takeResolved(
      resolved,
      pointer,
      `narration ${JSON.stringify(line.id)}`,
      omit,
    );
    if (el === null) continue;
    if (line.duck === 1) continue;
    const startSec = framesToMs(line.startFrame, fps) / 1000;
    const durationSec = requireDuration(
      el,
      `narration ${JSON.stringify(line.id)}`,
    );
    windows.push({
      startSec,
      endSec: startSec + durationSec,
      duck: line.duck,
    });
  }
  return windows;
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
 * without that element, not the mix with a hole in the same envelope.
 * Used by verify to build the counterfactual; the render path never
 * passes it.
 */
export function mixGraph(
  sound: SidecarSound,
  resolved: readonly ResolvedSoundElement[],
  fps: number,
  durationFrames: number,
  omit?: string,
): MixGraph {
  if (!soundDeclared(sound)) {
    throw new Error("PocketJS Motion: mixGraph called with nothing declared");
  }
  if (fps <= 0) {
    throw new Error(`PocketJS Motion: mixGraph fps must be positive; got ${fps}`);
  }

  const map = byPointer(resolved);
  const durationMs = framesToMs(durationFrames, fps);
  const durationSec = durationMs / 1000;
  const windows = narrationWindows(sound.narration, map, fps, omit);

  const inputArgs: string[] = [];
  const filters: string[] = [];
  const legs: string[] = [];
  let nextIndex = 1;

  if (sound.bed) {
    const el = takeResolved(map, "/sound/bed/src", "the bed", omit);
    if (el !== null) {
      const branch = bedBranch(sound.bed, el.path!, nextIndex, durationSec, windows);
      inputArgs.push(...branch.inputArgs);
      filters.push(branch.filter);
      legs.push(branch.label);
      nextIndex++;
    }
  }

  for (let i = 0; i < sound.narration.length; i++) {
    const line = sound.narration[i]!;
    const el = takeResolved(
      map,
      `/sound/narration/${i}/src`,
      `narration ${JSON.stringify(line.id)}`,
      omit,
    );
    if (el === null) continue;
    const startMs = framesToMs(line.startFrame, fps);
    const branch = delayedBranch(
      el.path!,
      nextIndex,
      startMs,
      line.gain,
      `[n${i}]`,
    );
    inputArgs.push(...branch.inputArgs);
    filters.push(branch.filter);
    legs.push(branch.label);
    nextIndex++;
  }

  for (let i = 0; i < sound.dialogue.length; i++) {
    const line = sound.dialogue[i]!;
    const el = takeResolved(
      map,
      `/sound/dialogue/${i}/src`,
      `dialogue ${JSON.stringify(line.id)}`,
      omit,
    );
    if (el === null) continue;
    if (el.compositionFrame === undefined) {
      throw new Error(
        `PocketJS Motion: mix graph needs a composition frame on dialogue ${JSON.stringify(line.id)}`,
      );
    }
    const startMs = framesToMs(el.compositionFrame, fps);
    const branch = delayedBranch(
      el.path!,
      nextIndex,
      startMs,
      line.gain,
      `[d${i}]`,
    );
    inputArgs.push(...branch.inputArgs);
    filters.push(branch.filter);
    legs.push(branch.label);
    nextIndex++;
  }

  for (let i = 0; i < sound.cues.length; i++) {
    const cue = sound.cues[i]!;
    const el = takeResolved(
      map,
      `/sound/cues/${i}/src`,
      `cue ${JSON.stringify(cue.id)}`,
      omit,
    );
    if (el === null) continue;
    const startMs = framesToMs(cue.atFrame, fps);
    const branch = delayedBranch(
      el.path!,
      nextIndex,
      startMs,
      cue.gain,
      `[c${i}]`,
    );
    inputArgs.push(...branch.inputArgs);
    filters.push(branch.filter);
    legs.push(branch.label);
    nextIndex++;
  }

  if (legs.length === 0) {
    if (omit !== undefined) {
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
      };
    }
    throw new Error("PocketJS Motion: mix graph produced no audio legs");
  }

  filters.push(
    `${legs.join("")}amix=inputs=${legs.length}:normalize=0:dropout_transition=0[a]`,
  );

  return {
    inputArgs,
    filter: filters.join(";"),
    outputLabel: "[a]",
  };
}