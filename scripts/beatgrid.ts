#!/usr/bin/env bun
/**
 * Measure a track's tempo, beat phase and per-bar energy.
 *
 * The reel's whole timeline is pinned to this output, so it is measured rather
 * than taken from the library's metadata: the stated ~129 BPM and the measured
 * 127.7 differ by enough to drift most of a beat across 34 seconds.
 *
 *   bun scripts/beatgrid.ts assets/audio/cat-walk.mp3
 *
 * Method: energy envelope at 86 Hz, half-wave-rectified first difference as an
 * onset signal, autocorrelation over 60–190 BPM for the period, then a phase
 * search over one period. The per-bar RMS table is for choosing where to enter
 * the track — the reel starts at the bar where the groove is fully in, which
 * also places the drop on the reel's midpoint.
 */

const SR = 22050;
const HOP = 256;

const path = process.argv[2];
if (!path) {
  console.error("usage: bun scripts/beatgrid.ts <audio file>");
  process.exit(2);
}

const proc = Bun.spawn(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], {
  stdout: "pipe",
});
const pcm = new Float32Array(await new Response(proc.stdout).arrayBuffer());
if (pcm.length === 0) {
  console.error(`no audio decoded from ${path}`);
  process.exit(1);
}

const frames = Math.floor(pcm.length / HOP);
const fps = SR / HOP;

const env = new Float32Array(frames);
for (let i = 0; i < frames; i++) {
  let s = 0;
  for (let j = 0; j < HOP; j++) s += pcm[i * HOP + j]! ** 2;
  env[i] = Math.sqrt(s / HOP);
}

const onset = new Float32Array(frames);
for (let i = 1; i < frames; i++) onset[i] = Math.max(0, env[i]! - env[i - 1]!);
let mean = 0;
for (const v of onset) mean += v;
mean /= frames;
for (let i = 0; i < frames; i++) onset[i]! -= mean;

let best = { bpm: 0, score: -Infinity };
for (let bpm = 60; bpm <= 190; bpm += 0.1) {
  const lag = Math.round((fps * 60) / bpm);
  let s = 0;
  let n = 0;
  for (let i = 0; i + lag < frames; i++) {
    s += onset[i]! * onset[i + lag]!;
    n++;
  }
  if (n > 0 && s / n > best.score) best = { bpm, score: s / n };
}

const period = (fps * 60) / best.bpm;
let phase = { at: 0, score: -Infinity };
for (let ph = 0; ph < period; ph += 0.25) {
  let s = 0;
  let n = 0;
  for (let b = 0; ; b++) {
    const i = Math.round(ph + b * period);
    if (i >= frames) break;
    s += onset[i]!;
    n++;
  }
  if (n > 0 && s / n > phase.score) phase = { at: ph, score: s / n };
}

const beatMs = 60000 / best.bpm;
console.log(`${path}`);
console.log(`  ${(pcm.length / SR).toFixed(1)}s · ${best.bpm.toFixed(1)} BPM`);
console.log(`  beat ${beatMs.toFixed(1)} ms · bar ${(beatMs * 4).toFixed(1)} ms · phase ${((phase.at / fps) * 1000).toFixed(0)} ms`);
console.log(`\n  bar   start      rms`);

const barLen = period * 4;
for (let b = 0; ; b++) {
  const i0 = Math.round(phase.at + b * barLen);
  const i1 = Math.round(phase.at + (b + 1) * barLen);
  if (i1 >= frames) break;
  let s = 0;
  for (let i = i0; i < i1; i++) s += env[i]! ** 2;
  const rms = Math.sqrt(s / (i1 - i0));
  console.log(
    `  ${String(b).padStart(3)}  ${((phase.at + b * barLen) / fps).toFixed(2).padStart(6)}s  ` +
      `${"█".repeat(Math.round(rms * 120))} ${rms.toFixed(3)}`,
  );
}
