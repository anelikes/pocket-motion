#!/usr/bin/env bun
/**
 * The alternative to sub-tick evaluation, measured: bake the same composition
 * at a higher tick rate and take shutter samples at whole ticks of THAT rate.
 *
 * Boots without `assertBakedTickRate` (which would refuse a 240 Hz bundle —
 * correctly), reads the rate the bundle publishes, and steps the core at it.
 * Every frame is read at the SAME instant as the 60 Hz realm reads it: frame
 * f's 60 Hz clock c = (f+1)*60/fps - 1 is the 240 Hz clock 4c.
 *
 *   bun bakerate.ts --repo <worktree> --a <bundle60.js> --b <bundle240.js> \
 *     --w 1920 --h 1080 --fps 30 --frames 90 [--n 4 --angle 180] [--dump ...]
 *
 * With --n 1 it reports, per frame, whether the two bakes give the same
 * picture at the same instant. With --n N > 1 it renders bundle B's exposure
 * from N whole-tick samples centred (floor) on the instant, resolved with the
 * prototype's arithmetic, and dumps PNGs to compare against the sub-tick one.
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    repo: { type: "string" },
    root: { type: "string" },
    a: { type: "string" },
    b: { type: "string" },
    w: { type: "string" }, h: { type: "string" }, fps: { type: "string" }, frames: { type: "string" },
    n: { type: "string", default: "1" },
    angle: { type: "string", default: "180" },
    dump: { type: "string", default: "" },
    out: { type: "string", default: "out" },
    json: { type: "string" },
  },
});
const repo = a.repo!;
const root = a.root ?? `${repo}/vendor/pocketjs`;
const { createSandbox } = await import(`${repo}/src/harness/sandbox.ts`);
const { createWasmUi } = await import(`${root}/hosts/web/wasm-ops.js`);
const { encodePNG } = await import(`${repo}/vendor/pocketjs/tools/png.ts`);
const { FrameHashSequence } = await import(`${repo}/src/render/hash.ts`);
const W = Number(a.w), H = Number(a.h), fps = Number(a.fps), frames = Number(a.frames);
const N = Number(a.n), angle = Number(a.angle);
const dump = new Set(a.dump ? a.dump.split(",").map(Number) : []);
const BYTES = W * H * 4;

async function boot(bundle: string) {
  const wasm = await createWasmUi(await Bun.file(`${root}/hosts/web/pocketjs.wasm`).arrayBuffer(), { width: W, height: H, rasterDensity: 1 });
  const pak = bundle.replace(/\.js$/, ".pak");
  const slots: Record<string, unknown> = {
    ui: wasm.ops, __simHz: fps, __pocketApp: "main", console: { log() {}, warn() {}, error() {} },
    __pocketDevtoolsTransport: { send() {}, recv: () => null },
  };
  if (await Bun.file(pak).exists()) slots.__pak = await Bun.file(pak).arrayBuffer();
  const sandbox = createSandbox({ slots, extraAllow: ["frame"] });
  sandbox.eval(await Bun.file(bundle).text());
  const frame = sandbox.get("frame") as (b: number) => void;
  const hz = sandbox.get("__pocketTickHz") as number;
  let ticks = 0; // ticks run since boot; the last SAMPLED clock is ticks - 1
  return {
    hz,
    frame,
    /** Tick until the last sampled clock is `clock`. Forward only. */
    to(clock: number) {
      if (clock + 1 < ticks) throw new Error(`cannot rewind to ${clock}`);
      while (ticks < clock + 1) { wasm.tick(); ticks++; }
    },
    render: () => {
      const ptr = wasm.exports.ui_render_scaled(1); // may grow memory: read the buffer after
      return new Uint8Array(wasm.exports.memory.buffer, ptr, BYTES);
    },
  };
}

const A = await boot(a.a!);
const B = await boot(a.b!);
const r = B.hz / A.hz;
if (!Number.isInteger(r)) throw new Error(`rates ${A.hz} / ${B.hz}`);
if (dump.size) mkdirSync(a.out!, { recursive: true });

// Whole-tick sample offsets at B's rate: the span is angle/360 of a frame.
const spanB = (angle / 360) * (B.hz / fps);
const offsets = Array.from({ length: N }, (_, k) => Math.floor((k + 0.5) * spanB / N - spanB / 2));
const differ: number[] = [];
const hashA = new FrameHashSequence("sha256"), hashB = new FrameHashSequence("sha256");
for (let f = 0; f < frames; f++) {
  A.frame(0);
  B.frame(0);
  const c = (f + 1) * (60 / fps) - 1; // the 60 Hz realm's instant for frame f
  A.to(c);
  const pa = A.render().slice();
  let pb: Uint8Array;
  if (N === 1) {
    B.to(c * r);
    pb = B.render().slice();
  } else {
    const acc = new Uint32Array(BYTES);
    for (const o of offsets) {
      B.to(c * r + o);
      const px = B.render();
      for (let i = 0; i < BYTES; i += 4) {
        const al = px[i + 3]!;
        acc[i] += px[i]! * al; acc[i + 1] += px[i + 1]! * al; acc[i + 2] += px[i + 2]! * al; acc[i + 3] += al;
      }
    }
    pb = new Uint8Array(BYTES);
    for (let i = 0; i < BYTES; i += 4) {
      const sa = acc[i + 3]!;
      if (sa === 0) continue;
      for (let ch = 0; ch < 3; ch++) pb[i + ch] = Math.min(255, Math.floor((2 * acc[i + ch]! + sa) / (2 * sa)));
      pb[i + 3] = Math.floor((2 * sa + N) / (2 * N));
    }
  }
  hashA.push(pa);
  hashB.push(pb);
  if (!Buffer.from(pa).equals(Buffer.from(pb))) differ.push(f);
  if (dump.has(f)) writeFileSync(`${a.out}/f${String(f).padStart(3, "0")}-hz${B.hz}-n${N}.png`, encodePNG(pb, W, H));
}
const result = { rates: [A.hz, B.hz], n: N, offsets, frames, framesDiffering: differ.length, differ, digestA: hashA.digest(), digestB: hashB.digest() };
console.log(JSON.stringify(result));
if (a.json) writeFileSync(a.json, JSON.stringify(result, null, 2) + "\n");
