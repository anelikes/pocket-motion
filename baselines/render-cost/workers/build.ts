#!/usr/bin/env bun
/**
 * Turn a pocket-motion build into a workerd project.
 *
 *   bun build.ts --dist <dir holding main.js, main.pak> --out <dir> [--port 8787]
 *
 * Writes, into --out:
 *   core.wasm     the vendored core (vendor/pocketjs/hosts/web/pocketjs.wasm),
 *                 a `wasm` module: compiled when the Worker is loaded, because
 *                 a Worker may not compile wasm bytes at run time
 *   wasm-ops.js   upstream's host adapter, unchanged
 *   guest.js      the composition's bundle as `export default function`,
 *                 because a Worker may not eval it
 *   scene.pak     the pak, a `data` module (an ArrayBuffer)
 *   worker.js     the fetch handler, with the scene's size and rate inlined
 *   config.capnp  a workerd config serving it on 127.0.0.1:<port> (default 18787)
 *   loader/       the same core behind a Worker Loader (loader.js): the
 *                 composition arrives in the request body, served on <port>+1
 *                 by loader/config.capnp; loader/request.bin is this
 *                 composition encoded as that body
 * and prints each module's size, raw and gzipped, against the upload limit.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1]! : d;
};
const dist = resolve(flag("dist")!);
const out = resolve(flag("out")!);
const port = flag("port", "18787");
const here = import.meta.dir;
const repo = resolve(here, "../../..");
const vendor = process.env.POCKETJS_ROOT ?? join(repo, "vendor/pocketjs");
mkdirSync(out, { recursive: true });

const record = JSON.parse(readFileSync(join(dist, "build.json"), "utf8"));
copyFileSync(join(vendor, "hosts/web/pocketjs.wasm"), join(out, "core.wasm"));
copyFileSync(join(vendor, "hosts/web/wasm-ops.js"), join(out, "wasm-ops.js"));
copyFileSync(join(dist, "main.pak"), join(out, "scene.pak"));
writeFileSync(join(out, "guest.js"), `export default function runGuest() {\n${readFileSync(join(dist, "main.js"), "utf8")}\n}\n`);
const scene = { width: 1920, height: 1080, fps: 30, built: record.argv ?? null };
writeFileSync(
  join(out, "worker.js"),
  readFileSync(join(here, "worker.js"), "utf8").replace("JSON.parse(SCENE_JSON)", JSON.stringify(scene)),
);
writeFileSync(
  join(out, "config.capnp"),
  `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ (name = "main", worker = .renderer) ],
  sockets = [ (name = "http", address = "127.0.0.1:${port}", http = (), service = "main") ],
);
const renderer :Workerd.Worker = (
  modules = [
    (name = "worker.js", esModule = embed "worker.js"),
    (name = "wasm-ops.js", esModule = embed "wasm-ops.js"),
    (name = "guest.js", esModule = embed "guest.js"),
    (name = "core.wasm", wasm = embed "core.wasm"),
    (name = "scene.pak", data = embed "scene.pak"),
  ],
  compatibilityDate = "2026-10-01",
);
`,
);

// The Worker Loader variant: the platform Worker holds the core and the shim;
// the composition travels in the request.
const ld = join(out, "loader");
mkdirSync(ld, { recursive: true });
copyFileSync(join(here, "loader.js"), join(ld, "loader.js"));
copyFileSync(join(out, "worker.js"), join(ld, "shim.txt"));
copyFileSync(join(out, "wasm-ops.js"), join(ld, "wasm-ops.txt"));
copyFileSync(join(out, "core.wasm"), join(ld, "core.bin"));
const bundleBytes = readFileSync(join(dist, "main.js"));
const head = Buffer.alloc(4);
head.writeUInt32LE(bundleBytes.length, 0);
writeFileSync(join(ld, "request.bin"), Buffer.concat([head, bundleBytes, readFileSync(join(dist, "main.pak"))]));
writeFileSync(
  join(ld, "config.capnp"),
  `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ (name = "platform", worker = .platform) ],
  sockets = [ (name = "http", address = "127.0.0.1:${Number(port) + 1}", http = (), service = "platform") ],
);
const platform :Workerd.Worker = (
  modules = [
    (name = "loader.js", esModule = embed "loader.js"),
    (name = "shim.txt", text = embed "shim.txt"),
    (name = "wasm-ops.txt", text = embed "wasm-ops.txt"),
    (name = "core.bin", data = embed "core.bin"),
  ],
  bindings = [ (name = "LOADER", workerLoader = ()) ],
  compatibilityDate = "2026-10-01",
  compatibilityFlags = ["experimental"],
);
`,
);

let raw = 0;
let gz = 0;
for (const f of ["worker.js", "wasm-ops.js", "guest.js", "core.wasm", "scene.pak"]) {
  const b = readFileSync(join(out, f));
  const z = gzipSync(b, { level: 9 }).length;
  raw += b.length;
  gz += z;
  console.log(`${f.padEnd(12)} ${String(b.length).padStart(9)} B raw  ${String(z).padStart(9)} B gzip`);
}
console.log(`${"total".padEnd(12)} ${String(raw).padStart(9)} B raw  ${String(gz).padStart(9)} B gzip`);
