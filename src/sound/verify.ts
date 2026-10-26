/**
 * Is each declared element in the produced mix, at its offset — and, where
 * the declaration varies its level, at that level?
 *
 * For each element this builds the same mix graph with that element
 * omitted and measures the residual against the produced file. If the
 * residual is at or below the floor, the element contributed nothing.
 * A loud bed cannot hide that: the bed is in both signals and cancels.
 *
 * The residual is measured in several windows across the span the element
 * claims, not only at its start, so an element that muxes and then stops
 * early reports as `truncated` rather than as present. Each window is
 * paired with the source's own level at the same instant and with the
 * element's DECLARED level there (gain × envelope × ducks), and a window
 * where the two together put the element under the floor is dropped: there
 * the produced mix and the omit-mix are equal whether or not the element
 * muxed, so the window carries no evidence either way. An envelope that
 * ramps a line to 0 is therefore not read as the line stopping.
 *
 * Levels are checked only where the declaration VARIES them — an
 * `envelope`, a bed `ducks[]` window, a narration line's `duck` — at one
 * window inside each piece between two breakpoints: the residual's level
 * less the source's (read through the mix's own channel layout, since a
 * mono leg in a stereo mix is upmixed at −3.01 dB) must lie within the
 * declared level's range over that window, give or take
 * `VERIFY_LEVEL_TOLERANCE_DB`. The expected level comes from the sidecar's
 * numbers (`elementLevel`), not from rendering the graph, so an expression
 * that drops a term is a measured mismatch rather than agreeing with itself.
 * A constant level is not checked, and neither is a piece too short to hold
 * a window or one where the source is silent.
 *
 * It does not check overlap, or that the element is the right audio — a
 * wrong file at the right offset produces a residual and passes. A source
 * that is silent in every sampled window is reported as `source-silent`, a
 * declared level that leaves nothing above the floor as `declared-silent`,
 * and neither is a pass. An optional element whose file is not on disk is
 * `skipped`: there is nothing to compare, and that is said rather than
 * passed or failed. Between the sampled windows nothing is examined: a gap
 * shorter than the spacing is not seen.
 *
 * A declared `silentTailMs` is measured on the produced file the way
 * `render` measures it (`src/sound/tail.ts`): every sample from the tail's
 * start to the end of the decode.
 *
 * Every window is read from ONE decode of the produced file
 * (`decodeProducedAudio`), never by seeking into the container, because an
 * input `-ss` is not on the same clock in every container. Measured on
 * `compositions/sound-roles` muxed to each: a window cut with `-ss 0.75` out
 * of the MP4 matched the full decode at 0.75 s sample for sample, and out of
 * the Opus WebM it matched 384 samples (8.0 ms) EARLIER — the stream starts
 * at a negative time, its pre-skip, which the full decode drops. Against a
 * reference on the composition clock that turned a correct mix's 440 Hz
 * narration nearly to antiphase, and the bed's level window under it read
 * +6.0 dB against a declared −24.4, where the MP4 and MOV read within
 * 0.02 dB of it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MotionSidecar } from "../manifest/sidecar.ts";
import {
  elementLevel,
  framesToMs,
  levelBreaks,
  levelIsConstant,
  levelRange,
  mixGraph,
  tailGateSec,
  type ElementLevel,
  type MixGraph,
} from "./mix.ts";
import {
  probeSoundDurations,
  type ResolvedSoundElement,
} from "./resolve.ts";
import { measureSilentTail, type TailMeasurement } from "./tail.ts";

/** Short window used for the RMS sample, in seconds. */
export const VERIFY_WINDOW_SEC = 0.1;

/**
 * RMS floor in dBFS for a source that has nothing to hear.
 * −50 dB is well under speech and under this repository's beds; a digital
 * zero reports as `-inf` and is also silent.
 */
export const VERIFY_RMS_FLOOR_DB = -50;

/**
 * Residual floor in dBFS. At or below this, omitting the element from
 * the graph does not change the produced file, so the element
 * contributed nothing.
 *
 * Measured 2026-08-17 through `verifyMix` itself (pcm omit-mix, 100 ms
 * window, invert+amix
 * `[1:a]volume=-1[inv];[0:a][inv]amix=inputs=2:normalize=0`):
 *
 *   sine fixture — 220 Hz bed 6 s + 880 Hz line 2 s at 2.0 s:
 *     present line  −21.07 dBFS (wav) / −21.08 (aac mux)
 *     absent line   −inf         (wav) / −80.38 (aac mux)
 *     present bed   −21.07 dBFS (wav) / −45.86 (aac mux at offset 0;
 *                     AAC priming fills part of the window)
 *   same fixture, bed 20 dB louder than the line (wav):
 *     present line  −22.30 dBFS
 *     absent line   −inf
 *   compositions/reel — cat-walk bed, a 2 s line declared at 2.0 s:
 *     present line  −24.08 dBFS (wav) / −24.11 (aac mux)
 *     absent line   −inf         (wav) / −58.56 (aac mux)
 *
 * The two populations do not overlap. Present is at or above −45.86;
 * absent is at or below −58.56. −50 sits between them. Matched formats
 * cancel to −inf; the aac figures are encoder error against the pcm
 * omit-mix.
 */
export const VERIFY_RESIDUAL_FLOOR_DB = -50;

export type VerifyStatus =
  | "present"
  | "truncated"
  | "unmuxed"
  /** Present, and a level window measured outside the declared level. */
  | "level-mismatch"
  /** The source is silent in every sampled window, so nothing was established. */
  | "source-silent"
  /** The declared level puts every voiced window under the floor. */
  | "declared-silent"
  | "source-missing"
  /** Declared `optional` and not on disk: not mixed, nothing to examine. */
  | "skipped"
  | "no-audio";

/**
 * How far a measured level may sit outside the declared range, in dB.
 *
 * Measured 2026-10-23 on `compositions/sound-roles` muxed to AAC at
 * 192 kb/s. Correct mix: the bed's windows under the narration duck and under
 * the cut duck sat 0.018 and 0.009 dB from the declared level, the dialogue
 * envelope's hold 0.001 dB, its ramp inside the range. The same mix with the
 * dialogue envelope left out: 3.06 dB outside on the ramp. With the cut duck
 * left out: 6.0 dB outside. 1 dB sits between the two populations with room
 * on both sides; `tests/sound.test.ts` holds both.
 */
export const VERIFY_LEVEL_TOLERANCE_DB = 1;

/**
 * How late a varying level may switch: one `VOLUME_STEP_SAMPLES` frame at
 * the slowest rate a source here has, 480 / 44100 s. The expected range of a
 * window starting at `a` is taken over `[a − lag, a + window]`.
 */
export const VERIFY_LEVEL_LAG_SEC = 0.011;

/** A level window keeps this far from either end of its piece. */
export const VERIFY_LEVEL_MARGIN_SEC = 0.05;

export interface LevelWindow {
  readonly atSec: number;
  /** The source at the same instant, through the mix's channel layout. */
  readonly sourceDb: number;
  /** Produced minus the mix without this element. */
  readonly residualDb: number;
  /** `residualDb − sourceDb`: the level the element arrived at. */
  readonly measuredDb: number;
  /** The declared level's range over the window, in dB (−Infinity for 0). */
  readonly expectedMinDb: number;
  readonly expectedMaxDb: number;
  readonly ok: boolean;
}

export interface LevelReport {
  readonly windows: readonly LevelWindow[];
  /** Pieces of the declared level with no window: too short, or the source and
   *  the declared level together under the floor there. */
  readonly unexamined: number;
}

/**
 * Windows sampled across an element's declared span.
 *
 * One window at the offset answers "did this element mux at all" and nothing
 * about how long it lasted: a line present at 2.00 s and gone by 2.20 s passes
 * a single sample. Widening the one window does not fix that — RMS over two
 * seconds of a 100 ms fragment sits only ~13 dB down, still well above the
 * floor. Separate windows at the start, middle and end of the span each either
 * cancel or do not, so a truncated element reports as `truncated` rather than
 * as present.
 */
export const VERIFY_SAMPLES = 3;


export interface VerifyElement {
  readonly id: string | null;
  readonly role: ResolvedSoundElement["role"];
  readonly pointer: string;
  readonly optional: boolean;
  readonly offsetSec: number;
  readonly sourceRmsDb: number | null;
  readonly residualRmsDb: number | null;
  readonly status: VerifyStatus;
  /** Present when the declared level varies over the element's span. */
  readonly level?: LevelReport;
}

export interface VerifyResult {
  /**
   * True only when every declared element is `present` or `skipped`, and a
   * declared silent tail measured silent. `source-silent` and
   * `declared-silent` are reports, not passes: there was nothing to hear,
   * so this check did not establish that the element muxed.
   */
  readonly ok: boolean;
  readonly floorDb: number;
  readonly windowSec: number;
  readonly elements: readonly VerifyElement[];
  /** Present when the sidecar declares `silentTailMs`. */
  readonly tail?: TailMeasurement;
}

const SILENT = Number.NEGATIVE_INFINITY;

export function isBelowFloor(rmsDb: number, floorDb = VERIFY_RMS_FLOOR_DB): boolean {
  return !Number.isFinite(rmsDb) || rmsDb <= floorDb;
}

function parseRmsDb(err: string, path: string, startSec: number): number {
  if (/does not contain any stream|Output file does not contain any stream|Stream map.*matches no streams/i.test(err)) {
    return SILENT;
  }

  const m = err.match(/RMS level dB:\s*(-?(?:inf|[\d.]+))/i);
  if (m === null) {
    if (/Output file #0 does not contain any stream/i.test(err) || /no audio/i.test(err)) {
      return SILENT;
    }
    // A window past EOF also yields no samples; treat as silent rather
    // than as a probe failure — the mix simply has nothing there.
    if (/nothing was encoded|frame= *0/i.test(err)) return SILENT;
    throw new Error(
      `PocketJS Motion: could not read RMS from ${path} at ${startSec}s\n${err.trim()}`,
    );
  }
  const raw = m[1]!;
  if (raw.toLowerCase() === "inf" || raw.toLowerCase() === "-inf") return SILENT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SILENT;
  return n;
}

/**
 * RMS over `[startSec, startSec + windowSec)` of `path`, in dBFS.
 * Returns `-Infinity` when the window decodes to digital silence or the
 * file has no audio stream.
 */
export async function measureRmsDb(
  path: string,
  startSec: number,
  windowSec: number = VERIFY_WINDOW_SEC,
  layout?: "mono" | "stereo",
): Promise<number> {
  // `layout` converts inside the graph, with the rematrix `amix`'s own
  // negotiation inserts: `-ac` on the output would act after `astats`.
  const convert = layout === undefined ? "" : `aformat=channel_layouts=${layout},`;
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-nostats",
      "-ss",
      String(Math.max(0, startSec)),
      "-t",
      String(windowSec),
      "-i",
      path,
      "-vn",
      "-af",
      `${convert}astats=measure_overall=RMS_level:measure_perchannel=none`,
      "-f",
      "null",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const err = await new Response(p.stderr).text();
  await p.exited;
  return parseRmsDb(err, path, startSec);
}

/**
 * RMS of `produced − reference` over the window, in dBFS.
 *
 * ffmpeg has no subtract, so the reference is inverted and summed:
 * `[1:a]volume=-1[inv];[0:a][inv]amix=inputs=2:normalize=0`.
 * Returns `-Infinity` when the residual is digital silence.
 */
export async function measureResidualRmsDb(
  producedPath: string,
  referencePath: string,
  startSec: number,
  windowSec: number = VERIFY_WINDOW_SEC,
): Promise<number> {
  const start = String(Math.max(0, startSec));
  const dur = String(windowSec);
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-nostats",
      "-ss",
      start,
      "-t",
      dur,
      "-vn",
      "-i",
      producedPath,
      "-ss",
      start,
      "-t",
      dur,
      "-vn",
      "-i",
      referencePath,
      "-filter_complex",
      "[1:a]volume=-1[inv];[0:a][inv]amix=inputs=2:normalize=0,astats=measure_overall=RMS_level:measure_perchannel=none",
      "-f",
      "null",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const err = await new Response(p.stderr).text();
  await p.exited;
  return parseRmsDb(err, `${producedPath} − ${referencePath}`, startSec);
}

/**
 * The source's own level over time, as `[startSec, rmsDb]` per window, from
 * one pass. Pure so the parse is asserted in tests without ffmpeg running.
 */
export function envelopeFromAstatsLog(log: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at: number | null = null;
  for (const line of log.split("\n")) {
    const t = line.match(/pts_time:\s*(-?[\d.]+)/);
    if (t !== null) {
      at = Number(t[1]);
      continue;
    }
    const v = line.match(/RMS_level=(-?(?:inf|[\d.]+))/i);
    if (v !== null && at !== null) {
      const raw = v[1]!.toLowerCase();
      out.push([
        at,
        raw.endsWith("inf") ? Number.NEGATIVE_INFINITY : Number(raw),
      ]);
      at = null;
    }
  }
  return out;
}

/**
 * `envelopeFromAstatsLog` on a real file: `asetnsamples` chunks the stream
 * into window-length blocks and `astats` reports each block's RMS.
 *
 * This reads the same quantity the check reads. `silencedetect` was here and
 * is the wrong instrument: it thresholds on amplitude, so low-level room tone
 * measuring -53 dBFS RMS with peaks above -50 is not silence to it. On a
 * recorded narration line it reported no silence at all — at d=0.1, 0.02 or
 * 0.005 — while three of that file's 180 windows read -51 to -53.
 */
export async function sourceEnvelope(
  path: string,
  windowSec: number = VERIFY_WINDOW_SEC,
): Promise<Array<[number, number]>> {
  const rate = 48000;
  const n = Math.max(1, Math.round(rate * windowSec));
  const p = Bun.spawn(
    [
      "ffmpeg", "-v", "error", "-i", path, "-vn",
      "-af",
      `aresample=${rate},asetnsamples=n=${n},astats=metadata=1:reset=1,` +
        `ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-`,
      "-f", "null", "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = await new Response(p.stdout).text();
  await p.exited;
  return envelopeFromAstatsLog(text);
}

/** Contiguous runs of windows at or above the floor, as `[start, end)`. */
export function voicedFromEnvelope(
  envelope: readonly (readonly [number, number])[],
  floorDb: number = VERIFY_RMS_FLOOR_DB,
  windowSec: number = VERIFY_WINDOW_SEC,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from: number | null = null;
  let last = 0;
  for (const [at, db] of envelope) {
    if (!isBelowFloor(db, floorDb)) {
      if (from === null) from = at;
      last = at;
    } else if (from !== null) {
      out.push([from, last + windowSec]);
      from = null;
    }
  }
  if (from !== null) out.push([from, last + windowSec]);
  return out;
}

/** The parts of `spans` inside `[from, to)`. */
export function clipSpans(
  spans: readonly (readonly [number, number])[],
  from: number,
  to: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of spans) {
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

/**
 * Window starts spread across voiced material, not across wall time.
 *
 * A fixed grid can land entirely on silence the source legitimately has: a
 * 2.84 s narration line with one internal pause put the three evenly spaced
 * points on its leading silence, that pause, and its trailing silence — every
 * window uninformative, on a correctly muxed line.
 *
 * Spacing by cumulative voiced time instead puts every window on signal
 * while still reaching both ends of the element, which is what catches a
 * line that muxes and then stops.
 */
export function sampleOffsetsInVoiced(
  voiced: readonly (readonly [number, number])[],
  windowSec: number = VERIFY_WINDOW_SEC,
  samples: number = VERIFY_SAMPLES,
): number[] {
  // A window must fit inside its span, so the usable starts of [a, b) are
  // [a, b - windowSec].
  const usable = voiced
    .map(([a, b]) => [a, b - windowSec] as const)
    .filter(([a, b]) => b >= a);
  if (usable.length === 0) return [];
  const lengths = usable.map(([a, b]) => b - a);
  const total = lengths.reduce((x, y) => x + y, 0);
  const n = Math.max(1, samples);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const want = n === 1 ? 0 : (total * i) / (n - 1);
    let acc = 0;
    let at = usable[usable.length - 1]![1];
    for (let k = 0; k < usable.length; k++) {
      if (want <= acc + lengths[k]!) {
        at = usable[k]![0] + (want - acc);
        break;
      }
      acc += lengths[k]!;
    }
    if (out.length === 0 || Math.abs(at - out[out.length - 1]!) > 1e-9) out.push(at);
  }
  return out;
}

/** Channel count of the first audio stream; 0 when there is none. */
/**
 * The produced file's first audio stream, decoded from its start to 32-bit
 * float PCM at its own rate and channel count — nothing resampled or
 * remixed, so the level checks read the mix's own layout.
 */
async function decodeProducedAudio(path: string, wavPath: string): Promise<void> {
  const p = Bun.spawn(
    ["ffmpeg", "-y", "-v", "error", "-i", path, "-map", "0:a:0", "-c:a", "pcm_f32le", wavPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  if (code !== 0) {
    throw new Error(
      `PocketJS Motion: could not decode audio from ${path}${err.trim() ? `\n${err.trim()}` : ""}`,
    );
  }
}

export async function audioChannels(path: string): Promise<number> {
  const p = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=channels",
      "-of",
      "csv=p=0",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = (await new Response(p.stdout).text()).trim();
  await p.exited;
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export async function hasAudioStream(path: string): Promise<boolean> {
  const p = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const text = (await new Response(p.stdout).text()).trim();
  await p.exited;
  return text.length > 0;
}

/**
 * Source-file time that plays at composition time 0 for this element.
 * Only the bed has one: `startAt` seeks into its source. The fade-in is
 * not part of this — the fade lives in the mix graph, not in the file.
 */
function sourceOffsetSec(
  el: ResolvedSoundElement,
  sidecar: MotionSidecar,
): number {
  if (el.role === "bed") return sidecar.sound.bed?.startAt ?? 0;
  return 0;
}

function mixOffsetSec(
  el: ResolvedSoundElement,
  sidecar: MotionSidecar,
  fps: number,
): number {
  // The bed starts at composition 0. Sampling begins after its fade-in,
  // but that shift belongs to `elementSampleStartSec` and is applied
  // there; adding it here too moved every bed window by two fades, and a
  // fade-in of half the composition then pushed the only window past the
  // end — a correctly muxed bed measured as `unmuxed` at fadeInMs 3000
  // on a 6 s composition.
  if (el.role === "bed") return 0;
  if (el.role === "narration") {
    const line = sidecar.sound.narration.find((l) => l.id === el.id);
    return line === undefined ? 0 : framesToMs(line.startFrame, fps) / 1000;
  }
  if (el.role === "cue") {
    const cue = sidecar.sound.cues.find((c) => c.id === el.id);
    return cue === undefined ? 0 : framesToMs(cue.atFrame, fps) / 1000;
  }
  if (el.compositionFrame !== undefined) {
    return framesToMs(el.compositionFrame, fps) / 1000;
  }
  return 0;
}

/**
 * Source-file time that plays at composition time `atSec`.
 *
 * A window asks two questions at the same instant — what the produced mix
 * has there, and what the source had to offer there — so both readings
 * need the same clock.
 */
export function sourceTimeAt(
  el: ResolvedSoundElement,
  sidecar: MotionSidecar,
  atSec: number,
  fps: number,
): number {
  return Math.max(
    0,
    atSec - mixOffsetSec(el, sidecar, fps) + sourceOffsetSec(el, sidecar),
  );
}

async function renderMixPcm(
  graph: MixGraph,
  outputPath: string,
  durationSec: number,
): Promise<void> {
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-t",
      String(durationSec),
      "-i",
      "anullsrc=r=48000:cl=stereo",
      ...graph.inputArgs,
      "-filter_complex",
      graph.filter,
      "-map",
      graph.outputLabel,
      "-t",
      String(durationSec),
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  if (code !== 0) {
    throw new Error(
      `PocketJS Motion: could not render omit-mix\n${err.trim()}`,
    );
  }
}

function mixableBesides(
  elements: readonly ResolvedSoundElement[],
  pointer: string,
): boolean {
  return elements.some((e) => e.pointer !== pointer && e.path !== null);
}

/**
 * Where to sample an element, across the span it claims to occupy.
 *
 * The span is the source's own duration, clipped to what is left of the
 * composition. The bed is clipped again by its fades: at the very end of a
 * fade-out its contribution really is near zero, and sampling there would
 * report a correctly-muxed bed as truncated.
 */
export function sampleOffsetsSec(
  startSec: number,
  spanSec: number,
  windowSec: number = VERIFY_WINDOW_SEC,
  samples: number = VERIFY_SAMPLES,
): number[] {
  const usable = spanSec - windowSec;
  if (!(usable > windowSec) || samples < 2) return [Math.max(0, startSec)];
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    out.push(Math.max(0, startSec + (usable * i) / (samples - 1)));
  }
  return out;
}

/**
 * Where sampling starts for an element.
 *
 * A bed enters through `fadeInMs`, and inside that fade a correctly muxed bed
 * is legitimately near silence: a gain-0.14 bed measures -69.45 dBFS at the
 * top of a 1.5 s fade and -56.67 dBFS a fifth of a second in, against a
 * -50 dBFS floor. Sampling from the declared start therefore calls a present
 * bed `truncated`, and the fix is not to raise the gain until the check is
 * satisfied — that changes the delivery to suit the instrument.
 *
 * It is the same mistake as judging a shot from a frame taken in the middle of
 * its fade: a sample taken during a transition describes the transition, not
 * the thing. So sampling begins after it.
 *
 * This is the only place the fade shift is applied. `mixOffsetSec` reports
 * where the element starts, which for a bed is composition 0.
 */
export function elementSampleStartSec(
  el: ResolvedSoundElement,
  sidecar: MotionSidecar,
  startSec: number,
): number {
  if (el.role === "bed") {
    return startSec + (sidecar.sound.bed?.fadeInMs ?? 0) / 1000;
  }
  return startSec;
}

/**
 * How long the element is sampled for, from `startSec`.
 *
 * The bed runs to where its fade-out begins, and that is earlier than the end
 * of the picture when a silent tail is declared: its fade completes at the
 * gate ahead of the tail. Every other element runs for its source's length,
 * clipped to the composition and to that gate.
 */
function elementSpanSec(
  el: ResolvedSoundElement,
  sidecar: MotionSidecar,
  startSec: number,
  compositionDurationSec: number,
  fps: number,
): number {
  const gate = tailGateSec(sidecar.sound, fps, sidecar.durationFrames);
  const end = gate ?? compositionDurationSec;
  if (el.role === "bed") {
    const fadeOutSec = (sidecar.sound.bed?.fadeOutMs ?? 0) / 1000;
    return Math.max(0, end - fadeOutSec - startSec);
  }
  const source = el.durationSec ?? 0;
  return Math.max(0, Math.min(source, end - startSec));
}

function toDb(gain: number): number {
  return gain <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(gain);
}

/**
 * The declared level's range over a window that starts at `atSec`, widened
 * back by the lag a varying `volume` may switch late by.
 */
export function expectedLevelRange(
  level: ElementLevel,
  atSec: number,
  windowSec: number = VERIFY_WINDOW_SEC,
): { readonly min: number; readonly max: number } {
  return levelRange(level, atSec - VERIFY_LEVEL_LAG_SEC, atSec + windowSec);
}

/**
 * One window per piece of the declared level inside `[from, to)`.
 *
 * A piece runs between two breakpoints — an envelope point, the edge of a
 * duck window — or between a breakpoint and the span's end, and the window
 * sits at its middle, so it is as far from either switch as the piece
 * allows. A piece shorter than the window plus a margin at each end gets no
 * window: it is counted as unexamined rather than read across a switch.
 */
export function levelWindowStarts(
  level: ElementLevel,
  from: number,
  to: number,
  windowSec: number = VERIFY_WINDOW_SEC,
  marginSec: number = VERIFY_LEVEL_MARGIN_SEC,
): { readonly starts: number[]; readonly unexamined: number } {
  const edges = [from, ...levelBreaks(level).filter((t) => t > from && t < to), to];
  const starts: number[] = [];
  let unexamined = 0;
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = edges[k]!;
    const b = edges[k + 1]!;
    if (b - a < windowSec + 2 * marginSec) {
      unexamined++;
      continue;
    }
    starts.push((a + b) / 2 - windowSec / 2);
  }
  return { starts, unexamined };
}

/** The verdict on one level window. Pure, so the arithmetic is tested alone. */
export function levelWindowOk(
  measuredDb: number,
  residualDb: number,
  expected: { readonly min: number; readonly max: number },
  toleranceDb: number = VERIFY_LEVEL_TOLERANCE_DB,
): boolean {
  // Declared silent across the whole window: the element must contribute
  // nothing measurable there.
  if (expected.max <= 0) return isBelowFloor(residualDb, VERIFY_RESIDUAL_FLOOR_DB);
  if (!Number.isFinite(measuredDb)) return false;
  return measuredDb >= toDb(expected.min) - toleranceDb && measuredDb <= toDb(expected.max) + toleranceDb;
}

/**
 * The level of `el` as the produced mix should carry it. Built with the
 * element itself as `omit` so a missing sibling is skipped rather than thrown
 * on — this is a measurement of the mix that exists, and the sibling reports
 * its own absence. Omitting the element does not change its own level.
 */
function declaredLevel(
  el: ResolvedSoundElement,
  sidecar: MotionSidecar,
  elements: readonly ResolvedSoundElement[],
  fps: number,
): ElementLevel {
  return elementLevel(el.pointer, sidecar.sound, elements, fps, el.pointer);
}

function layoutOf(channels: number): "mono" | "stereo" | undefined {
  return channels === 1 ? "mono" : channels === 2 ? "stereo" : undefined;
}

export async function verifyMix(options: {
  readonly sidecar: MotionSidecar;
  readonly elements: readonly ResolvedSoundElement[];
  readonly producedPath: string;
  readonly fps: number;
}): Promise<VerifyResult> {
  const { sidecar, producedPath, fps } = options;
  const elements = await probeSoundDurations(options.elements);
  const channels = await audioChannels(producedPath);
  const audio = channels > 0;
  const layout = layoutOf(channels);
  const durationSec = framesToMs(sidecar.durationFrames, fps) / 1000;
  const tmp = mkdtempSync(join(tmpdir(), "pocketjs-verify-"));
  const out: VerifyElement[] = [];

  try {
    const decoded = join(tmp, "produced.wav");
    if (audio) await decodeProducedAudio(producedPath, decoded);
    for (const el of elements) {
      const offsetSec = mixOffsetSec(el, sidecar, fps);
      const head = {
        id: el.id,
        role: el.role,
        pointer: el.pointer,
        optional: el.optional === true,
        offsetSec,
      };
      if (!audio) {
        out.push({ ...head, sourceRmsDb: null, residualRmsDb: null, status: "no-audio" });
        continue;
      }
      if (el.path === null) {
        out.push({
          ...head,
          sourceRmsDb: null,
          residualRmsDb: null,
          status: el.optional === true ? "skipped" : "source-missing",
        });
        continue;
      }

      const level = declaredLevel(el, sidecar, elements, fps);
      // Sampled across the element's declared span, not only at its start:
      // one window cannot tell a full line from its first 100 ms. And
      // sampled where the source has something to contribute, not at fixed
      // fractions of the span: a window where the source is itself silent
      // cannot answer whether the element muxed, because the produced mix
      // and the omit-mix are equal there either way. Speech is full of such
      // windows, which is how every element of a correct mix came to be
      // reported as absent.
      const sampleFrom = elementSampleStartSec(el, sidecar, offsetSec);
      const spanSec = elementSpanSec(el, sidecar, sampleFrom, durationSec, fps);
      const srcFrom = sourceTimeAt(el, sidecar, sampleFrom, fps);
      const voiced = clipSpans(
        voicedFromEnvelope(await sourceEnvelope(el.path)),
        srcFrom,
        srcFrom + spanSec,
      );
      // Source and composition clocks differ by a constant, so one offset
      // carries the mapping back.
      const offsets = sampleOffsetsInVoiced(voiced).map(
        (at) => sampleFrom + (at - srcFrom),
      );
      if (offsets.length === 0) {
        out.push({
          ...head,
          sourceRmsDb: await measureRmsDb(el.path, srcFrom),
          residualRmsDb: null,
          status: "source-silent",
        });
        continue;
      }
      const sourceDbs: number[] = [];
      for (const at of offsets) {
        sourceDbs.push(
          await measureRmsDb(el.path, sourceTimeAt(el, sidecar, at, fps)),
        );
      }
      // Voiced sampling narrows where windows land; it does not guarantee
      // the level there. `silencedetect` thresholds on amplitude and this
      // check reads RMS over 100 ms, so a window can be voiced by one and
      // under the floor by the other — a recorded narration line picked a
      // window reading -51.2 dBFS. Those windows are still dropped, and so
      // is a window where the DECLARED level puts the element under the
      // floor: an envelope at 0 there is the declaration, not an absence.
      const voicedHeard: number[] = [];
      const heard: number[] = [];
      for (let i = 0; i < offsets.length; i++) {
        if (isBelowFloor(sourceDbs[i]!, VERIFY_RMS_FLOOR_DB)) continue;
        voicedHeard.push(i);
        const expected = expectedLevelRange(level, offsets[i]!);
        if (!isBelowFloor(sourceDbs[i]! + toDb(expected.max), VERIFY_RMS_FLOOR_DB)) {
          heard.push(i);
        }
      }
      if (heard.length === 0) {
        out.push({
          ...head,
          sourceRmsDb: sourceDbs.reduce((a, b) => (a > b ? a : b)),
          residualRmsDb: null,
          status: voicedHeard.length > 0 ? "declared-silent" : "source-silent",
        });
        continue;
      }

      // The reference mix is rendered once and reused for every window.
      const alone = !mixableBesides(elements, el.pointer);
      let refPath: string | null = null;
      if (!alone) {
        refPath = join(tmp, "ref.wav");
        await renderMixPcm(
          mixGraph(sidecar.sound, elements, fps, sidecar.durationFrames, el.pointer),
          refPath,
          durationSec,
        );
      }
      const residualAt = (at: number, ref: string | null): Promise<number> =>
        ref === null
          ? // Residual against silence is the produced window itself.
            measureRmsDb(decoded, at)
          : measureResidualRmsDb(decoded, ref, at);

      const residuals: number[] = [];
      for (const i of heard) residuals.push(await residualAt(offsets[i]!, refPath));
      const absent = residuals.filter((r) =>
        isBelowFloor(r, VERIFY_RESIDUAL_FLOOR_DB),
      ).length;
      // The worst window is what the element is reported as: an element that
      // vanishes halfway through is not a present element. Its source level
      // is reported from that same window, so the two numbers printed on
      // one line describe one observation.
      let worst = 0;
      for (let i = 1; i < residuals.length; i++) {
        if (residuals[i]! < residuals[worst]!) worst = i;
      }
      let status: VerifyStatus =
        absent === residuals.length ? "unmuxed" : absent > 0 ? "truncated" : "present";

      let levelReport: LevelReport | undefined;
      if (!levelIsConstant(level)) {
        // A narration line's residual against the plain omit-mix is the line
        // plus the duck it took off the bed. Its own level is read against
        // a mix that keeps that duck.
        const n = el.pointer.match(/^\/sound\/narration\/(\d+)\/src$/);
        const line = n === null ? undefined : sidecar.sound.narration[Number(n[1])];
        let levelRef = refPath;
        if (!alone && line !== undefined && line.duck !== 1) {
          levelRef = join(tmp, "ref-keep-duck.wav");
          await renderMixPcm(
            mixGraph(sidecar.sound, elements, fps, sidecar.durationFrames, el.pointer, {
              omitKeepsDuck: true,
            }),
            levelRef,
            durationSec,
          );
        }
        const planned = levelWindowStarts(level, sampleFrom, sampleFrom + spanSec);
        const windows: LevelWindow[] = [];
        let unexamined = planned.unexamined;
        for (const at of planned.starts) {
          const sourceDb = await measureRmsDb(
            el.path,
            sourceTimeAt(el, sidecar, at, fps),
            VERIFY_WINDOW_SEC,
            layout,
          );
          const expected = expectedLevelRange(level, at);
          // A window carries evidence about a level when the source is
          // voiced there and the declared level leaves the element above the
          // floor — under it, the encoder's error is the same size as the
          // thing measured. A piece declared silent is the exception: it
          // asks whether the element is absent, which the floor answers.
          if (
            isBelowFloor(sourceDb, VERIFY_RMS_FLOOR_DB) ||
            (expected.max > 0 && isBelowFloor(sourceDb + toDb(expected.max), VERIFY_RMS_FLOOR_DB))
          ) {
            unexamined++;
            continue;
          }
          const residualDb = await residualAt(at, levelRef);
          const measuredDb = residualDb - sourceDb;
          windows.push({
            atSec: at,
            sourceDb,
            residualDb,
            measuredDb,
            expectedMinDb: toDb(expected.min),
            expectedMaxDb: toDb(expected.max),
            ok: levelWindowOk(measuredDb, residualDb, expected),
          });
        }
        levelReport = { windows, unexamined };
        if (status === "present" && windows.some((w) => !w.ok)) status = "level-mismatch";
      }

      out.push({
        ...head,
        sourceRmsDb: sourceDbs[heard[worst]!]!,
        residualRmsDb: residuals[worst]!,
        status,
        ...(levelReport !== undefined ? { level: levelReport } : {}),
      });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const tail =
    sidecar.sound.silentTailMs !== undefined && audio
      ? await measureSilentTail(producedPath, durationSec, sidecar.sound.silentTailMs)
      : undefined;

  return {
    ok:
      out.length > 0 &&
      out.every((e) => e.status === "present" || e.status === "skipped") &&
      (sidecar.sound.silentTailMs === undefined || tail?.ok === true),
    floorDb: VERIFY_RESIDUAL_FLOOR_DB,
    windowSec: VERIFY_WINDOW_SEC,
    elements: out,
    ...(tail !== undefined ? { tail } : {}),
  };
}
