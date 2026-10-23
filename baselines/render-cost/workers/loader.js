// The SaaS shape of the Worker prototype: one platform Worker that renders
// compositions it has never seen, with no deploy per composition.
//
// A Worker may not eval code, so a composition's bundle cannot be run by the
// Worker that receives it. The Worker Loader binding (env.LOADER) can: it
// builds a Worker from modules handed to it at run time, and caches it by
// name. Here the platform carries the core (core.wasm, as bytes), upstream's
// host adapter and the render shim (worker.js, as text); the request carries
// the composition — the bundle and the pak, which in production would come
// out of R2 — and the dynamic Worker made from all five answers exactly what
// the statically bundled prototype answers.
//
//   POST /render?from=0&to=300[&samples=12]
//        body: u32 little-endian bundle length, the bundle (UTF-8), the pak

import shim from "./shim.txt";
import wasmOps from "./wasm-ops.txt";
import coreBytes from "./core.bin";

async function sha256hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    const body = new Uint8Array(await request.arrayBuffer());
    const n = new DataView(body.buffer, body.byteOffset).getUint32(0, true);
    const bundle = new TextDecoder().decode(body.subarray(4, 4 + n));
    const pak = body.slice(4 + n).buffer;
    // Content-addressed: the same composition reuses the loaded Worker.
    const name = (await sha256hex(body)).slice(0, 16);
    const worker = env.LOADER.get(name, () => ({
      compatibilityDate: "2026-10-01",
      mainModule: "worker.js",
      modules: {
        "worker.js": shim,
        "wasm-ops.js": wasmOps,
        "guest.js": `export default function runGuest() {\n${bundle}\n}\n`,
        "core.wasm": { wasm: coreBytes },
        "scene.pak": { data: pak },
      },
      globalOutbound: null,
    }));
    const inner = new URL(request.url);
    inner.pathname = "/";
    return worker.getEntrypoint().fetch(new Request(inner, { method: "GET" }));
  },
};
