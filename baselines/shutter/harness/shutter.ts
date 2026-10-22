#!/usr/bin/env bun
/**
 * Shutter prototype harness (stage 1, scratch). Boots a built composition
 * against the PROTOTYPE wasm (POCKETJS_ROOT must name the scratch tree that
 * carries `ui_render_exposure`), folds it forward exactly as WasmFrameSource
 * does, and at every frame renders one exposure per requested sample count.
 *
 *   POCKETJS_ROOT=<scratch>/pj bun shutter.ts --repo <worktree> --bundle B --pak P \
 *     --w 1920 --h 1080 --fps 30 --frames 90 --angle 180 --n 1,4,8 \
 *     [--dump 12,30] [--out dir] [--exempt name,...] [--reference] [--json out.json]
 *
 * Prints one digest per N (sha256 per frame, sha256 over the sequence — the
 * repository's FrameHashSequence), and ms per frame split into fold and
 * exposure.
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    repo: { type: "string" },
    bundle: { type: "string" },
    pak: { type: "string" },
    w: { type: "string" },
    h: { type: "string" },
    fps: { type: "string" },
    frames: { type: "string" },
    from: { type: "string", default: "0" },
    angle: { type: "string", default: "180" },
    n: { type: "string", default: "1,4,8" },
    dump: { type: "string", default: "" },
    out: { type: "string", default: "out" },
    exempt: { type: "string", default: "" },
    reference: { type: "boolean", default: false },
    // measurement only: integrate opacity as well (the rejected rule)
    opacity: { type: "boolean", default: false },
    "frame-hashes": { type: "boolean", default: false },
    json: { type: "string" },
    scale: { type: "string", default: "1" },
    // name:x,y,w,h;... — per frame, how many pixels of the region differ from N=1
    regions: { type: "string", default: "" },
  },
});

const repo = a.repo!;
const { hardenedBootWorld, pocketjsRoot } = await import(`${repo}/src/runtime/boot.ts`);
const { FrameHashSequence } = await import(`${repo}/src/render/hash.ts`);
const { encodePNG } = await import(`${repo}/vendor/pocketjs/tools/png.ts`);

const W = Number(a.w), H = Number(a.h), fps = Number(a.fps), frames = Number(a.frames);
const from = Number(a.from);
const scale = Number(a.scale);
const angle = Number(a.angle);
const Ns = a.n!.split(",").map(Number);
const dump = new Set(a.dump ? a.dump.split(",").map(Number) : []);
const T = 60 / fps; // ticks per frame
// Exposure span in ticks = angle/360 * T = (angle*T)/360.
const spanNum = angle * T, spanDen = 360;

async function boot() {
  return hardenedBootWorld({ bundlePath: a.bundle!, pakPath: a.pak, width: W, height: H, hz: fps, renderScale: scale });
}

// Resolve debugNames to node ids on a throwaway world: getTree advances a frame.
const exemptNames = a.exempt ? a.exempt.split(",") : [];
const exemptIds: number[] = [];
if (exemptNames.length) {
  const probe = await boot();
  const tree = probe.getTree() as any;
  const walk = (n: any) => {
    if (!n) return;
    if (exemptNames.includes(n.n)) exemptIds.push(n.i);
    for (const c of n.k ?? []) walk(c);
  };
  walk(tree);
  if (exemptIds.length !== exemptNames.length) throw new Error(`exempt: resolved ${exemptIds.length} of ${exemptNames.length}`);
}

const world = await boot();
world.audit();
const ex = world.exports as any;
if (typeof ex.ui_render_exposure !== "function") throw new Error(`${pocketjsRoot()} wasm has no ui_render_exposure`);
for (const id of exemptIds) ex.ui_shutter_exempt(id);
if (a.opacity) ex.ui_shutter_integrate_opacity(1);

const PW = W * scale, PH = H * scale, BYTES = PW * PH * 4;
const seqs = new Map<number, InstanceType<typeof FrameHashSequence>>(Ns.map((n) => [n, new FrameHashSequence("sha256")]));
const ms = new Map<number, number>(Ns.map((n) => [n, 0]));
let foldMs = 0;
const regions = (a.regions ? a.regions.split(";") : []).map((r) => {
  const [name, box] = r.split(":");
  const [x, y, w, h] = box!.split(",").map(Number);
  return { name: name!, x: x!, y: y!, w: w!, h: h! };
});
const regionDiff: Record<string, Record<number, number[]>> = {};
for (const r of regions) regionDiff[r.name] = Object.fromEntries(Ns.filter((n) => n > 1).map((n) => [n, [] as number[]]));
function diffCount(p: Uint8Array, q: Uint8Array, r: { x: number; y: number; w: number; h: number }): number {
  let c = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * PW + x) * 4;
      if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2] || p[i + 3] !== q[i + 3]) c++;
    }
  }
  return c;
}
let refChecked = 0, refMismatch = 0, restoreMismatch = 0;
if (dump.size) mkdirSync(a.out!, { recursive: true });

function view(ptr: number): Uint8Array {
  if (!ptr) throw new Error("null framebuffer");
  return new Uint8Array(ex.memory.buffer, ptr, BYTES);
}

/** Host-side reference: the same arithmetic as the core's resolve, in JS. */
function referenceExposure(n: number): Uint8Array {
  const acc = new Uint32Array(BYTES);
  for (let k = 0; k < n; k++) {
    ex.ui_shutter_sample(spanNum * (2 * k + 1 - n), spanDen * 2 * n);
    const px = view(ex.ui_render_scaled(scale));
    for (let i = 0; i < BYTES; i += 4) {
      const al = px[i + 3]!;
      acc[i] += px[i]! * al; acc[i + 1] += px[i + 1]! * al; acc[i + 2] += px[i + 2]! * al; acc[i + 3] += al;
    }
  }
  ex.ui_shutter_sample(0, 1);
  const out = new Uint8Array(BYTES);
  for (let i = 0; i < BYTES; i += 4) {
    const sa = acc[i + 3]!;
    if (sa === 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.floor((2 * acc[i + c]! + sa) / (2 * sa)));
    out[i + 3] = Math.floor((2 * sa + n) / (2 * n));
  }
  return out;
}

for (let f = 0; f < from + frames; f++) {
  const t0 = performance.now();
  world.frame(0);
  for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
  foldMs += performance.now() - t0;
  if (f < from) continue;
  let plain: Uint8Array | null = null;
  for (const n of Ns) {
    const s = performance.now();
    const px = view(ex.ui_render_exposure(scale, spanNum, spanDen, n));
    seqs.get(n)!.push(px);
    ms.set(n, ms.get(n)! + performance.now() - s);
    if (n === 1) plain = px.slice();
    else if (plain) for (const r of regions) regionDiff[r.name]![n]!.push(diffCount(px, plain, r));
    if (dump.has(f)) writeFileSync(`${a.out}/f${String(f).padStart(3, "0")}-n${n}.png`, encodePNG(px.slice(), PW, PH));
    if (a.reference && n > 1) {
      const core = px.slice();
      const ref = referenceExposure(n);
      refChecked++;
      if (!Buffer.from(core).equals(Buffer.from(ref))) refMismatch++;
    }
  }
  // The exposure must leave the canonical state behind: a plain render now
  // has to be the N=1 picture.
  if (plain) {
    const again = view(ex.ui_render_scaled(scale));
    if (!Buffer.from(again).equals(Buffer.from(plain))) restoreMismatch++;
  }
}

const result = {
  bun: Bun.version,
  platform: `${process.platform}/${process.arch}`,
  wasm: new Bun.CryptoHasher("sha256").update(await Bun.file(`${pocketjsRoot()}/hosts/web/pocketjs.wasm`).arrayBuffer()).digest("hex"),
  size: [PW, PH], fps, frames, from, angle,
  foldMsPerFrame: +(foldMs / (from + frames)).toFixed(3),
  perN: Ns.map((n) => ({
    n, digest: seqs.get(n)!.digest(), msPerFrame: +(ms.get(n)! / frames).toFixed(2),
    ...(a["frame-hashes"] ? { frameHashes: seqs.get(n)!.frames } : {}),
  })),
  opacityIntegrated: a.opacity,
  reference: a.reference ? { checked: refChecked, mismatched: refMismatch } : undefined,
  restoreMismatch,
  regions: regionDiff,
  exempt: exemptNames,
};
console.log(JSON.stringify(result, null, 2));
if (a.json) writeFileSync(a.json, JSON.stringify(result, null, 2) + "\n");
