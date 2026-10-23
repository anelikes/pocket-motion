/**
 * Is the declared silent tail digital silence in the delivered file?
 *
 * Measured after the mux, on the same decode the sound manifest's sha256 is
 * of — s16le, 48 kHz, stereo — so the verdict and the recorded digest
 * describe one PCM. Every sample from the tail's start to the end of the
 * decode is read, not a window of it, and the verdict is that every one is
 * zero. A decode that ends before the composition does is not a pass: the
 * part it does not reach was not examined.
 *
 * The gate puts exact zeros into the encoder; what reaches the tail is the
 * codec's overlap from the frames before it, which is why the mixer stops
 * sound `SILENT_TAIL_GUARD_MS` early. Measured before either was written, a
 * 220 Hz bed at gain 0.3 muxed to AAC at 192 kb/s, gated exactly AT the tail
 * (5.5 s of 6), counting non-zero samples in the tail:
 *
 *   fade-out completing at the tail      s16: 0               f32: 1216, peak 1.3e-6
 *   fade-out completing 100 ms earlier   s16: 0               f32: 0
 *   no fade-out, hard cut at the tail    s16: 871, peak 8, in the first 21 ms
 *
 * and the four-role mix that `compositions/sound-roles` declares left 1092 at
 * s16 with the fade completing at the tail, because what the encoder spends
 * on a frame depends on the frames before it. With the guard, that same mix's
 * tail is zero in a 32-bit float decode too: the residue, 3136 values with a
 * peak of 1.6e-6, sits inside the 50 ms before it. The claim is still made on
 * the s16 decode the manifest hashes, measured on the file and not inferred
 * from the graph.
 */

export const DELIVERED_PCM = {
  format: "s16le",
  codec: "pcm_s16le",
  rate: 48000,
  channels: 2,
} as const;

export interface TailMeasurement {
  readonly silentTailMs: number;
  /** Where the tail begins, seconds. */
  readonly fromSec: number;
  /** Where the composition ends, seconds. */
  readonly compositionEndSec: number;
  /** Where the decode ends; the examined span is `[fromSec, decodedSec)`. */
  readonly decodedSec: number;
  /** Sample values read (per channel, both channels). */
  readonly samples: number;
  readonly nonZero: number;
  /** Largest |sample| in the tail, in s16 units. */
  readonly peak: number;
  /** First non-zero sample, seconds after the tail begins; null when none. */
  readonly firstNonZeroAfterSec: number | null;
  readonly ok: boolean;
}

/** Decode the delivered audio to `DELIVERED_PCM`. */
export async function decodeDeliveredPcm(path: string): Promise<Uint8Array> {
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      path,
      "-vn",
      "-f",
      DELIVERED_PCM.format,
      "-acodec",
      DELIVERED_PCM.codec,
      "-ac",
      String(DELIVERED_PCM.channels),
      "-ar",
      String(DELIVERED_PCM.rate),
      "pipe:1",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [bytes, err, code] = await Promise.all([
    new Response(p.stdout).arrayBuffer(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `PocketJS Motion: could not decode audio from ${path}${err.trim() ? `\n${err.trim()}` : ""}`,
    );
  }
  return new Uint8Array(bytes);
}

/** The verdict on decoded `DELIVERED_PCM`. Pure, so it is tested without ffmpeg. */
export function silentTailOf(
  pcm: Uint8Array,
  compositionEndSec: number,
  silentTailMs: number,
): TailMeasurement {
  const { rate, channels } = DELIVERED_PCM;
  const view = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const frames = Math.floor(view.length / channels);
  const fromSec = compositionEndSec - silentTailMs / 1000;
  const fromFrame = Math.round(fromSec * rate);
  let nonZero = 0;
  let peak = 0;
  let first = -1;
  for (let i = fromFrame * channels; i < frames * channels; i++) {
    const v = Math.abs(view[i]!);
    if (v === 0) continue;
    nonZero++;
    if (v > peak) peak = v;
    if (first < 0) first = Math.floor(i / channels);
  }
  const decodedSec = frames / rate;
  // One sample of slack: the composition's end is not always a whole sample.
  const reached = frames >= Math.floor(compositionEndSec * rate);
  return {
    silentTailMs,
    fromSec,
    compositionEndSec,
    decodedSec,
    samples: Math.max(0, frames - fromFrame) * channels,
    nonZero,
    peak,
    firstNonZeroAfterSec: first < 0 ? null : (first - fromFrame) / rate,
    ok: reached && nonZero === 0,
  };
}

export async function measureSilentTail(
  path: string,
  compositionEndSec: number,
  silentTailMs: number,
): Promise<TailMeasurement> {
  return silentTailOf(await decodeDeliveredPcm(path), compositionEndSec, silentTailMs);
}

/** One line for a person, carrying the numbers. */
export function describeTail(t: TailMeasurement): string {
  const span = `${t.fromSec.toFixed(3)}–${t.decodedSec.toFixed(3)} s`;
  if (t.ok) {
    return (
      `silent tail ${t.silentTailMs} ms is digital silence — ${t.samples} samples over ${span}, ` +
      "every one zero (s16le 48 kHz stereo decode)"
    );
  }
  if (t.decodedSec < t.compositionEndSec - 1 / DELIVERED_PCM.rate) {
    return (
      `silent tail ${t.silentTailMs} ms not established — the decode ends at ${t.decodedSec.toFixed(3)} s, ` +
      `before the composition's end at ${t.compositionEndSec.toFixed(3)} s, so the rest was not examined`
    );
  }
  return (
    `silent tail ${t.silentTailMs} ms is NOT digital silence — ${t.nonZero} of ${t.samples} samples ` +
    `over ${span} are non-zero, peak |${t.peak}|, the first ${(t.firstNonZeroAfterSec! * 1000).toFixed(2)} ms ` +
    "after the tail begins (s16le 48 kHz stereo decode). A fade-out that completes at the tail leaves " +
    "nothing there; a hard cut leaves the codec's overlap"
  );
}
