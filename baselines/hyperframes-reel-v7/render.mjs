#!/usr/bin/env bun
/**
 * Render the HyperFrames port of the PocketJS Motion reel and print timing.
 *
 *   bun baselines/hyperframes-reel-v7/render.mjs
 *   WORKERS=1 bun baselines/hyperframes-reel-v7/render.mjs
 *   WORKERS=10 bun baselines/hyperframes-reel-v7/render.mjs
 *
 * Uses the local hyperframes-main producer package (same path as the M4 baseline).
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HF_PRODUCER = resolve(
  __dirname,
  "../../../hyperframes-main/packages/producer/src/index.ts",
);

const { createRenderJob, executeRenderJob } = await import(HF_PRODUCER);

const workers = Math.max(1, Number(process.env.WORKERS || "1"));
const out =
  process.env.OUT ||
  resolve("/tmp", `pocketjs-motion-reel-v7-hf-w${workers}.mp4`);
const dir = __dirname;

process.env.PRODUCER_ENABLE_BROWSER_POOL = "false";

const job = createRenderJob({
  fps: 30,
  quality: "standard",
  format: "mp4",
  workers,
  useGpu: false,
  hdrMode: "force-sdr",
});

console.log(`hyperframes reel-v7 port`);
console.log(`  project: ${dir}`);
console.log(`  out:     ${out}`);
console.log(`  workers: ${workers}`);
console.log(`  fps:     30 · quality: standard · 1920×1080 · 28.2s`);

const t0 = performance.now();
const result = await executeRenderJob(job, dir, out);
const wall = performance.now() - t0;

const frames = 846; // 28.2s * 30
const msPerFrame = wall / frames;

console.log("");
console.log("── result ──────────────────────────────────────────");
console.log(`  output:      ${out}`);
console.log(`  wall_ms:     ${wall.toFixed(0)}`);
console.log(`  wall_s:      ${(wall / 1000).toFixed(2)}`);
console.log(`  ms/frame:    ${msPerFrame.toFixed(2)}  (wall / 846 frames)`);
console.log(`  realtime×:   ${(28200 / wall).toFixed(2)}×`);
if (result && typeof result === "object") {
  try {
    console.log(`  result_keys: ${Object.keys(result).join(", ")}`);
  } catch {}
}
console.log("RENDER_OK");
