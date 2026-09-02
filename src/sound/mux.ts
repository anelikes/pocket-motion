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
 */

import { rename } from "node:fs/promises";
import { ffmpegVersion } from "../footage/ingest.ts";
import { formatFilterNumber, type MixGraph } from "./mix.ts";

export interface MixManifest {
  readonly sha256: string;
  readonly bytes: number;
  readonly ffmpeg: string;
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
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      path,
      "-vn",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "2",
      "-ar",
      "48000",
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
  const pcm = new Uint8Array(bytes);
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
}): Promise<MuxResult> {
  const tmp = `${options.outputPath}.mixing.mp4`;
  await runFfmpeg(
    muxArgs(options.videoPath, tmp, options.graph, options.durationSec),
  );
  await rename(tmp, options.outputPath);

  const hashed = await hashDecodedAudio(options.outputPath);
  const manifest: MixManifest = {
    sha256: hashed.sha256,
    bytes: hashed.bytes,
    ffmpeg: await ffmpegVersion(),
  };
  const manifestPath = soundManifestPath(options.outputPath);
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return {
    ...manifest,
    outputPath: options.outputPath,
    manifestPath,
  };
}