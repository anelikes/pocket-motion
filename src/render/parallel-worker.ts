#!/usr/bin/env bun
/**
 * One worker of a frame-parallel render. Reads its job from stdin, folds to the
 * start of its range, rasterises and encodes its share, and reports its frame
 * hashes on stdout.
 *
 * Folding to the range start is deliberate and cheap: tick+draw is ~0.03 ms
 * against ~5 ms of rasterisation (see parallel.ts).
 */

import { WasmFrameSource } from "../runtime/frame-source.ts";
import { hashFrame, type FrameHash, type HashAlgorithm } from "./hash.ts";
import { createEncodeSink } from "./encode.ts";

interface Job {
  start: number;
  end: number;
  outputPath?: string;
  compositionId: string;
  bundlePath: string;
  pakPath?: string;
  width: number;
  height: number;
  hz: number;
  durationFrames: number;
  renderScale?: number;
  rasterDensity?: number;
  crf?: number;
  preset?: string;
  encoder?: string;
  scaleTo?: [number, number];
  hashAlgorithm?: HashAlgorithm;
}

const job = JSON.parse(await new Response(Bun.stdin.stream()).text()) as Job;
const t0 = performance.now();

const source = await WasmFrameSource.create(job);
source.audit();

const sink = job.outputPath
  ? createEncodeSink({
      width: job.width * (job.renderScale ?? 1),
      height: job.height * (job.renderScale ?? 1),
      fps: job.hz,
      outputPath: job.outputPath,
      crf: job.crf,
      preset: job.preset,
      encoder: job.encoder,
      scaleTo: job.scaleTo,
    })
  : null;

const hashes: FrameHash[] = [];
for (let f = 0; f < job.end; f++) {
  await source.seekFrame(f);
  if (f < job.start) continue; // fold only; this range belongs to another worker
  const rgba = source.read();
  hashes.push(hashFrame(rgba, job.hashAlgorithm));
  if (sink) await sink.write(rgba);
}
if (sink) await sink.finish();
await source.dispose();

process.stdout.write(
  JSON.stringify({ start: job.start, end: job.end, hashes, elapsedMs: performance.now() - t0 }),
);
