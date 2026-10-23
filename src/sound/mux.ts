/**
 * Mix declared sound under a finished video and write a provenance record
 * next to the output.
 *
 * A separate pass on purpose. Frame hashes are taken before the encoder
 * runs; this module never sees a frame. The video stream is copied. The
 * mixed audio's sha256 is of the delivered soundtrack decoded to a pinned
 * PCM (s16le, 48 kHz, stereo) so "did the mix change" is answerable
 * without comparing AAC packets. The ffmpeg version is the same first line
 * ingest records on each artifact.
 *
 * The record also says which declared elements this mix carries — an
 * optional element whose file was not on disk is listed `mixed: false` —
 * and, when the sidecar declares `silentTailMs`, the tail as measured on
 * that same decode. The verdict on the tail is the caller's to act on.
 */

import { rename } from "node:fs/promises";
import { ffmpegVersion } from "../footage/ingest.ts";
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

export function soundManifestPath(outputPath: string): string {
  return outputPath.replace(/\.mp4$/i, "") + ".sound.json";
}

export function muxArgs(
  videoPath: string,
  outputPath: string,
  graph: MixGraph,
  durationSec: number,
): string[] {
  return [
    "ffmpeg",
    "-y",
    "-v",
    "error",
    "-fflags",
    "+bitexact",
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
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    formatFilterNumber(durationSec),
    "-movflags",
    "+faststart",
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
  /** The sidecar's `silentTailMs`; when set, the tail is measured and recorded. */
  readonly silentTailMs?: number;
}): Promise<MuxResult> {
  const tmp = `${options.outputPath}.mixing.mp4`;
  await runFfmpeg(
    muxArgs(options.videoPath, tmp, options.graph, options.durationSec),
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