// pocket-motion's render core inside a Cloudflare Worker (workerd), as small
// as it can be and still answer whether the core runs there.
//
// What the Bun CLI does in src/runtime/boot.ts and frame-source.ts, minus the
// node:vm sandbox (there is no node:vm and no eval in a Worker): instantiate
// the wasm core from a module compiled at upload, hand the guest its contract
// slots on globalThis, run the guest bundle — shipped as module code, not
// eval'd — and fold one guest turn plus 60/hz core ticks per frame. Each
// rendered frame's RGBA is hashed with SHA-256, and the sequence digest is
// sha256(hashes.join("\n")), the same as src/render/hash.ts, so a response can
// be compared byte for byte with `trace --json` from the Bun CLI.
//
//   GET /?from=0&to=300            frames [from, to), no shutter
//   GET /?from=0&to=300&samples=12 a 180° shutter of 12 samples
//   GET /?at=200&raw=1             frame 200's RGBA bytes, for a picture
//   GET /?from=0&to=300&deflate=1  also deflate every frame (CompressionStream),
//                                  what a Worker must do before a frame can
//                                  leave it for an encoder elsewhere
//   GET /health                    renders nothing: the Worker is loaded
//
// The clock inside a request does not advance while code runs, so timing is
// taken by the caller (baselines/render-cost/harness/workerd.sh).

import core from "./core.wasm";
import pak from "./scene.pak";
import runGuest from "./guest.js";
import { createWasmUi } from "./wasm-ops.js";

const SCENE = JSON.parse(SCENE_JSON);
const TICKS_PER_SECOND = 60;

async function deflatedSize(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  let n = 0;
  for await (const chunk of stream) n += chunk.byteLength;
  return n;
}

async function sha256hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    const at = url.searchParams.get("at");
    const from = at !== null ? Number(at) : Number(url.searchParams.get("from") ?? 0);
    const to = at !== null ? from + 1 : Number(url.searchParams.get("to") ?? from + 1);
    const samples = Number(url.searchParams.get("samples") ?? 0);
    const angle = Number(url.searchParams.get("angle") ?? 180);
    const raw = url.searchParams.get("raw") === "1";
    const deflate = url.searchParams.get("deflate") === "1";
    const { width, height, fps } = SCENE;
    const ticksPerFrame = TICKS_PER_SECOND / fps;

    const wasm = await createWasmUi(core, { width, height, rasterDensity: 1 });
    if (samples > 1) wasm.reserveExposure(1);
    const memoryAfterBoot = wasm.exports.memory.buffer.byteLength;

    // The contract slots boot.ts hands the guest through its sandbox.
    globalThis.ui = wasm.ops;
    globalThis.__simHz = fps;
    globalThis.__pocketApp = "main";
    globalThis.__pak = pak;
    globalThis.__pocketDevtoolsTransport = { send() {}, recv() { return null; } };
    runGuest();
    const guestFrame = globalThis.frame;
    if (typeof guestFrame !== "function") throw new Error("guest did not install globalThis.frame");
    if (globalThis.__pocketTickHz !== TICKS_PER_SECOND) {
      throw new Error(`bundle baked at ${globalThis.__pocketTickHz} Hz, realm ticks at ${TICKS_PER_SECOND}`);
    }

    const hashes = [];
    let deflatedBytes = 0;
    let last = null;
    for (let f = 0; f < to; f++) {
      guestFrame(0);
      for (let t = 0; t < ticksPerFrame; t++) wasm.tick();
      if (f < from) continue;
      last = samples > 1
        ? wasm.renderExposure(1, angle * ticksPerFrame, 360, samples)
        : wasm.renderScaled(1);
      if (!raw) hashes.push(await sha256hex(last));
      if (deflate) deflatedBytes += await deflatedSize(last.slice());
    }
    if (raw) return new Response(last.slice(), { headers: { "content-type": "application/octet-stream" } });
    return Response.json({
      from, to, samples: samples > 1 ? samples : null, angle: samples > 1 ? angle : null,
      frames: hashes,
      digest: await sha256hex(new TextEncoder().encode(hashes.join("\n"))),
      wasmMemoryAfterBootBytes: memoryAfterBoot,
      wasmMemoryBytes: wasm.exports.memory.buffer.byteLength,
      pakBytes: pak.byteLength,
      ...(deflate ? { deflatedBytes, rawBytes: (to - from) * last.byteLength } : {}),
    });
  },
};
