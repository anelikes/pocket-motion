/**
 * Mix declared sound under a finished video and write a provenance record
 * next to the output.
 *
 * A separate pass on purpose. Frame hashes are taken before the encoder
 * runs; this module never sees a frame. The video stream is copied. The
 * mixed audio's sha256 is of the delivered soundtrack decoded to a pinned
 * PCM (s16le, 48 kHz, stereo) so "did the mix change" is answerable
 * without comparing encoded packets. The ffmpeg version is the same first
 * line ingest records on each artifact.
 *
 * The container is the one `render --format` names (`muxAudioArgs`). This
 * pass used to mux into `<out>.mixing.mp4` with AAC whatever the format:
 * measured, a `.webm` came out an ISO MP4 of VP9 and AAC with its alpha gone,
 * and every `.mov` failed — the MP4 muxer has no tag for ProRes.
 *
 * The record also says which declared elements this mix carries — an
 * optional element whose file was not on disk is listed `mixed: false` —
 * and, when the sidecar declares `silentTailMs`, the tail as measured on
 * that same decode. The verdict on the tail is the caller's to act on.
 */

import { rename } from "node:fs/promises";
import { ffmpegVersion } from "../footage/ingest.ts";
import type { ContainerFormat } from "../render/encode.ts";
import { formatFilterNumber, type MixedElement, type MixGraph } from "./mix.ts";
import { decodeDeliveredPcm, silentTailOf, type TailMeasurement } from "./tail.ts";

export interface MixManifest {
  readonly sha256: string;
  readonly bytes: number;
  readonly ffmpeg: string;
  /** Every declared element and whether this mix carries it. */
  readonly elements: readonly ManifestElement[];
  /** Present when the sidecar declares `silentTailMs`. */
  readonly tail?: TailMeasurement;
}

export interface ManifestElement {
  readonly pointer: string;
  readonly id: string | null;
  readonly role: MixedElement["role"];
  readonly optional: boolean;
  readonly mixed: boolean;
}

export interface MuxResult extends MixManifest {
  readonly outputPath: string;
  readonly manifestPath: string;
}

/**
 * The record sits beside the delivery and is named after ALL of its file name:
 * `hero.mp4` → `hero.mp4.sound.json`. A record per extension-stripped stem
 * would give `hero.mp4` and `hero.webm` — the pair a page lists as two
 * sources of one `<video>` — one record, and the second render would
 * overwrite the first one's digest with its own.
 */
export function soundManifestPath(outputPath: string): string {
  return `${outputPath}.sound.json`;
}

/**
 * The audio leg of each container, and the container flags beside it.
 *
 *   mp4   AAC at 192 kb/s, `+faststart`; the rate is the graph's.
 *   webm  Opus at 192 kb/s, 48 kHz. WebM carries Opus or Vorbis and nothing
 *         else, and Opus runs at 48 kHz, so the rate is stated rather than
 *         left to the resampler ffmpeg inserts on its own.
 *   mov   PCM, signed 24-bit, 48 kHz, `+faststart`. MOV is the ProRes
 *         container, a mastering format whose audio is uncompressed at the
 *         rate video runs at; PCM also has no encoder delay or frame padding,
 *         so its duration is the graph's to the sample.
 *
 * The video stream is copied in all three, so the alpha a WebM carries out
 * of band (Matroska's BlockAdditional, flagged by the track's AlphaMode) and the
 * alpha plane inside ProRes 4444 arrive in the delivery as they left the
 * encode leg — `tests/format.test.ts` decodes both sides and compares them.
 */
export function muxAudioArgs(format: ContainerFormat): string[] {
  switch (format) {
    case "mp4":
      return ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
    case "webm":
      return ["-c:a", "libopus", "-b:a", "192k", "-ar", "48000"];
    case "mov":
      return ["-c:a", "pcm_s24le", "-ar", "48000", "-movflags", "+faststart"];
  }
}

export function muxArgs(
  videoPath: string,
  outputPath: string,
  graph: MixGraph,
  durationSec: number,
  format: ContainerFormat,
): string[] {
  return [
    "ffmpeg",
    "-y",
    "-v",
    "error",
    "-i",
    videoPath,
    ...graph.inputArgs,
    "-filter_complex",
    graph.filter,
    "-map",
    "0:v:0",
    "-map",
    graph.outputLabel,
    "-c:v",
    "copy",
    ...muxAudioArgs(format),
    "-t",
    formatFilterNumber(durationSec),
    "-fflags",
    "+bitexact",
    "-f",
    format,
    outputPath,
  ];
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  const p = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  if (code !== 0) {
    throw new Error(
      `PocketJS Motion: ffmpeg mix exited ${code}${err.trim() ? `\n${err.trim()}` : ""}`,
    );
  }
}

/**
 * Decode the audio stream to pinned PCM and hash it.
 *
 * Sample format, rate and channel count are fixed so the digest is of the
 * mix, not of whatever layout the encoder happened to write.
 */
export async function hashDecodedAudio(path: string): Promise<{
  sha256: string;
  bytes: number;
}> {
  return hashPcm(await decodeDeliveredPcm(path));
}

function hashPcm(pcm: Uint8Array): { sha256: string; bytes: number } {
  return {
    sha256: new Bun.CryptoHasher("sha256").update(pcm).digest("hex"),
    bytes: pcm.byteLength,
  };
}

export async function muxSound(options: {
  readonly videoPath: string;
  readonly outputPath: string;
  readonly graph: MixGraph;
  readonly durationSec: number;
  /**
   * The container `videoPath` is in and `outputPath` will be. No default:
   * a mux that assumed mp4 wrote MP4 bytes under a `.webm` name and failed on
   * every ProRes `.mov`.
   */
  readonly format: ContainerFormat;
  /** The sidecar's `silentTailMs`; when set, the tail is measured and recorded. */
  readonly silentTailMs?: number;
}): Promise<MuxResult> {
  const tmp = `${options.outputPath}.mixing.${options.format}`;
  await runFfmpeg(
    muxArgs(options.videoPath, tmp, options.graph, options.durationSec, options.format),
  );
  await rename(tmp, options.outputPath);

  const pcm = await decodeDeliveredPcm(options.outputPath);
  const hashed = hashPcm(pcm);
  const manifest: MixManifest = {
    sha256: hashed.sha256,
    bytes: hashed.bytes,
    ffmpeg: await ffmpegVersion(),
    elements: options.graph.elements.map((e) => ({
      pointer: e.pointer,
      id: e.id,
      role: e.role,
      optional: e.optional,
      mixed: e.mixed,
    })),
    ...(options.silentTailMs !== undefined
      ? { tail: silentTailOf(pcm, options.durationSec, options.silentTailMs) }
      : {}),
  };
  const manifestPath = soundManifestPath(options.outputPath);
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return {
    ...manifest,
    outputPath: options.outputPath,
    manifestPath,
  };
}