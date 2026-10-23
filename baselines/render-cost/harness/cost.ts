#!/usr/bin/env bun
/**
 * Per-video cost estimates from the measured medians and published prices.
 *
 *   bun cost.ts <results dir>
 *
 * Every price is a constant below with the page it was read from on
 * 2026-10-23. Every platform cost is an ESTIMATE: no render here ran on
 * Lambda, on Cloudflare or in a container. What is measured is the CPU time a
 * render took on an Apple M4 (runs.jsonl, workerd.jsonl); the formulas turn
 * that into what each platform would bill, and say which assumption each one
 * rests on. The AI-call scenarios are assumptions about what one 10 s video
 * asks for, priced from the same sheets.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2]!;
const read = (f: string) =>
  existsSync(join(dir, f))
    ? readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).flatMap((l) => {
          // Two early startup lines were written as `:.534` and `:,`; the
          // first is repaired, the second skipped. Nothing else is touched.
          try { return [JSON.parse(l.replace(/:\./g, ":0."))]; } catch { return []; }
        })
    : [];
// The same filter as summarize.ts: browser-renderer records from before the
// sampler fix undercount Chrome.
const runs = read("runs.jsonl").filter(
  (r) => r.exitCode === 0 && (r.sampler >= 2 || r.label.startsWith("pm.")),
);
const wk = read("workerd.jsonl");
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const cpu = (label: string) => med(runs.filter((r) => r.label === label).map((r) => r.cpuSeconds));
const wall = (label: string) => med(runs.filter((r) => r.label === label).map((r) => r.wallMs / 1000));
const cpuOf = (label: string, comm: RegExp) =>
  med(
    runs
      .filter((r) => r.label === label)
      .map((r) => Object.entries(r.cpuByComm as Record<string, number>).filter(([k]) => comm.test(k)).reduce((a, [, v]) => a + v, 0)),
  );
const wkCpu = (query: string, variant = "static") =>
  med(wk.filter((r) => r.query === query && (r.variant ?? "static") === variant).map((r) => r.workerdCpuSeconds));

// ---- Prices, read 2026-10-23 -------------------------------------------------
// AWS Lambda us-east-1, arm64 tier 1, per GB-second; per request.
// https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json
const LAMBDA_ARM_GBS = 0.0000133334;
const LAMBDA_REQUEST = 0.0000002;
// Remotion Lambda defaults: 2048 MB, arm64; framesPerLambda = max(frames /
// concurrency, 20), concurrency 75..150 over 0..18,000 frames.
// https://www.remotion.dev/docs/lambda/concurrency, packages/lambda-client/src/constants.ts
const REMOTION_LAMBDA_GB = 2;
// Remotion for Automators: $0.01 per render, $100/month minimum.
// https://www.remotion.dev/docs/license/faq
const REMOTION_LICENCE_PER_RENDER = 0.01;
// Workers Standard: per CPU-ms, per request. https://developers.cloudflare.com/workers/platform/pricing/
const WORKERS_CPU_MS = 0.02 / 1e6;
const WORKERS_REQUEST = 0.3 / 1e6;
// Dynamic Workers: $0.002 per Dynamic Worker per day past 1,000 a month.
// https://developers.cloudflare.com/dynamic-workers/pricing/
const DYNAMIC_WORKER_DAY = 0.002;
// Cloudflare Containers: per vCPU-second (active), per GiB-second and
// GB-second provisioned. standard-2 = 1 vCPU, 6 GiB, 12 GB disk.
// https://developers.cloudflare.com/containers/platform/pricing/, /limits/
const CT_VCPU_S = 0.00002;
const CT_GIB_S = 0.0000025;
const CT_DISK_GB_S = 0.00000007;
const CT_STANDARD2 = { vcpu: 1, gib: 6, diskGb: 12 };
// AI calls. https://platform.claude.com/docs/en/about-claude/pricing
const OPUS_IN = 4 / 1e6;
const OPUS_OUT = 20 / 1e6;
// https://docs.byteplus.com/en/docs/ModelArk/1544106 (USD list)
const SEEDREAM_40 = 0.03;
const SEEDREAM_50_PRO = 0.045;
const SEEDANCE_5S_1080 = { "1.0 pro fast": 0.24, "2.0": 1.87, "2.5": 2.843 };
// https://elevenlabs.io/pricing/api — v4 multilingual, per 1K characters
const ELEVEN_PER_1K = 0.08;
// https://developers.openai.com/api/docs/pricing — whisper-1 per minute
const WHISPER_MIN = 0.006;
// https://developers.heygen.com/docs/enterprise-pricing — Avatar IV 0.1 credit/s at $0.50/credit
const HEYGEN_AVATAR_IV_S = 0.05;

const usd = (x: number) => (x >= 0.01 ? `$${x.toFixed(3)}` : `$${x.toFixed(5)}`);

// ---- Render ------------------------------------------------------------------
const FRAMES = 300;
const rows: Array<{ name: string; low: number; high: number; how: string }> = [];

// Remotion Lambda. Two readings, neither a Lambda run.
//
// Published: Remotion's own cost examples (remotion.dev/docs/lambda/cost-example,
// 2048 MB, warm, us-east-1): $0.001 for its HelloWorld template, $0.017 for a
// one-minute video. Quoted as a row of its own.
//
// Derived: the CPU this Mac measured for Remotion at concurrency 1 with its
// default GL — the GPU here, so Chrome's raster work on the GPU is NOT in the
// number, and Lambda runs `swangle` (software GL) instead, which on this Mac
// cost about 4 s a frame and is not taken as Lambda's speed. Lambda bills
// wall time x memory, and a 2048 MB function has 2 vCPU
// (remotion.dev/docs/lambda/runtime). Low: that CPU spread over 2 vCPU on
// cores as fast as an M4's, plus 1 s of Chrome start per function. High:
// Graviton at half an M4 core's speed, one vCPU busy, 3 s of start each.
rows.push({
  name: "Remotion Lambda, Remotion's published examples",
  low: 0.001,
  high: 0.017 / 6,
  how: "HelloWorld template $0.001; one-minute video $0.017, prorated to 10 s = $0.0028 (remotion.dev/docs/lambda/cost-example)",
});
{
  const c = cpu("rm.render.c1");
  const concurrency = 75 + (150 - 75) * Math.min(FRAMES / 18000, 1);
  const perLambda = Math.max(Math.ceil(FRAMES / concurrency), 20);
  const lambdas = Math.ceil(FRAMES / perLambda) + 1; // + the main function
  const lowS = c / 2 + lambdas * 1;
  const highS = (c * 2) / 1 + lambdas * 3;
  const price = (s: number) => s * REMOTION_LAMBDA_GB * LAMBDA_ARM_GBS + lambdas * LAMBDA_REQUEST;
  rows.push({
    name: "Remotion Lambda, compute (estimate)",
    low: price(lowS),
    high: price(highS),
    how: `${c.toFixed(1)} CPU-s measured; ${lambdas} functions of ${perLambda} frames; ${lowS.toFixed(0)}–${highS.toFixed(0)} function-seconds x 2 GB x ${LAMBDA_ARM_GBS}/GB-s; S3 not counted`,
  });
  rows.push({
    name: "Remotion Lambda, compute + company licence (estimate)",
    low: price(lowS) + REMOTION_LICENCE_PER_RENDER,
    high: price(highS) + REMOTION_LICENCE_PER_RENDER,
    how: `+ $${REMOTION_LICENCE_PER_RENDER} per render (Remotion for Automators; free for companies of up to 3)`,
  });
}

// One container renders and encodes. CPU is billed on active use, memory and
// disk on the provisioned size for as long as it runs; on a 1-vCPU instance
// the wall time is at least the CPU time. The renderer's own process and its
// ffmpeg share the vCPU.
function container(label: string, name: string) {
  const c = cpu(label);
  const w = c / CT_STANDARD2.vcpu;
  const cost = c * CT_VCPU_S + w * CT_STANDARD2.gib * CT_GIB_S + w * CT_STANDARD2.diskGb * CT_DISK_GB_S;
  rows.push({
    name,
    low: cost,
    high: cost * 2,
    how: `${c.toFixed(1)} CPU-s measured, standard-2 (1 vCPU, 6 GiB) for ${w.toFixed(0)} s; high = x2 for a slower core`,
  });
}
container("pm.render.none", "pocket-motion in a container (estimate)");
container("pm.render.s12", "pocket-motion, shutter 12, in a container (estimate)");
container("rm.render.c1", "Remotion in a container (estimate)");
container("hf.render.w1.sw", "HyperFrames in a container (estimate)");

// Workers: the core renders in a Worker (CPU measured in workerd), frames
// leave deflated, a container encodes them (ffmpeg's CPU measured inside
// pm.render.none). Dynamic Worker fee when each composition is loaded at run
// time rather than deployed.
{
  const render = wkCpu("from=0&to=300");
  const deflate = wkCpu("from=0&to=300&deflate=1");
  const ffmpeg = cpuOf("pm.render.none", /ffmpeg/);
  const worker = (Number.isFinite(deflate) ? deflate : render) * 1000 * WORKERS_CPU_MS + WORKERS_REQUEST;
  const enc = ffmpeg * CT_VCPU_S + ffmpeg * CT_STANDARD2.gib * CT_GIB_S + ffmpeg * CT_STANDARD2.diskGb * CT_DISK_GB_S;
  rows.push({
    name: "pocket-motion in a Worker + encode in a container (estimate)",
    low: worker + enc,
    high: (worker + enc) * 2,
    how: `Worker ${(Number.isFinite(deflate) ? deflate : render).toFixed(1)} CPU-s (render${Number.isFinite(deflate) ? " + deflate" : ""}) + ffmpeg ${ffmpeg.toFixed(1)} CPU-s on standard-2`,
  });
  rows.push({
    name: "  + one Dynamic Worker per composition",
    low: worker + enc + DYNAMIC_WORKER_DAY,
    high: (worker + enc) * 2 + DYNAMIC_WORKER_DAY,
    how: `+ $${DYNAMIC_WORKER_DAY} per Dynamic Worker per day past 1,000 a month`,
  });
}

console.log("### Render, per 10 s 1080p30 video\n");
console.log("| path | low | high | basis |");
console.log("|---|---:|---:|---|");
for (const r of rows) console.log(`| ${r.name} | ${usd(r.low)} | ${usd(r.high)} | ${r.how} |`);

// ---- AI calls ----------------------------------------------------------------
// Assumptions for ONE 10 s video, stated so they can be argued with:
//   design: Opus 5.5, 30k input tokens (instructions, the authoring reference,
//     the brief) and 8k output tokens (the composition and its config) per
//     attempt, two attempts (one repair after lint/check)
//   narration: 10 s at ~15 characters a second = 150 characters
//   captions: ASR over the 10 s
const design = 2 * (30_000 * OPUS_IN + 8_000 * OPUS_OUT);
const tts = (150 / 1000) * ELEVEN_PER_1K;
const asr = (10 / 60) * WHISPER_MIN;
const base = design + tts + asr;
const scenarios: Array<[string, number, number]> = [
  ["motion graphics only: design x2 + TTS + ASR", base, base],
  ["+ 3 generated stills (Seedream 4.0 .. 5.0 pro)", base + 3 * SEEDREAM_40, base + 3 * SEEDREAM_50_PRO],
  ["+ one 5 s 1080p generated shot (Seedance 1.0 pro fast .. 2.5)", base + SEEDANCE_5S_1080["1.0 pro fast"], base + SEEDANCE_5S_1080["2.5"]],
  ["+ 10 s HeyGen avatar (Avatar IV)", base + 10 * HEYGEN_AVATAR_IV_S, base + 10 * HEYGEN_AVATAR_IV_S],
];
console.log("\n### AI calls, per 10 s video (estimate)\n");
console.log("| line | cost |");
console.log("|---|---:|");
console.log(`| design, Opus 5.5, 2 x (30k in + 8k out) | ${usd(design)} |`);
console.log(`| narration, ElevenLabs v4, 150 characters | ${usd(tts)} |`);
console.log(`| captions, whisper-1, 10 s | ${usd(asr)} |`);
console.log("\n| scenario | low | high |");
console.log("|---|---:|---:|");
for (const [n, lo, hi] of scenarios) console.log(`| ${n} | ${usd(lo)} | ${usd(hi)} |`);

// ---- Share -------------------------------------------------------------------
console.log("\n### Render as a share of the whole video's cost\n");
const pick = (needle: string) => rows.find((r) => r.name.startsWith(needle))!;
const paths: Array<[string, { low: number; high: number }]> = [
  ["pocket-motion, container", pick("pocket-motion in a container")],
  ["pocket-motion shutter 12, container", pick("pocket-motion, shutter 12, in a container")],
  ["Remotion Lambda, compute", pick("Remotion Lambda, compute (estimate)")],
  ["Remotion Lambda + licence", pick("Remotion Lambda, compute + company licence")],
];
console.log("| scenario | " + paths.map(([n]) => n).join(" | ") + " |");
console.log("|---|" + paths.map(() => "---:").join("|") + "|");
for (const [n, lo, hi] of scenarios) {
  const cells = paths.map(([, r]) => {
    // Smallest share: cheapest render over the dearest AI; largest: the reverse.
    const a = (r.low / (r.low + hi)) * 100;
    const b = (r.high / (r.high + lo)) * 100;
    return `${a.toFixed(2)}–${b.toFixed(2)} %`;
  });
  console.log(`| ${n} | ${cells.join(" | ")} |`);
}
