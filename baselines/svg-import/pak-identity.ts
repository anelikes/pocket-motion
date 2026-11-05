#!/usr/bin/env bun
/**
 * The bytes every ledger composition builds to, by sha256: pak, bundle and
 * the `<output>.paths.json` inventory when there is one.
 *
 *   bun baselines/svg-import/pak-identity.ts > out.json
 *
 * Run once on a tree vendored without patches 0053-0054 (move them out of
 * patches/ and `bun scripts/vendor.ts --no-wasm`) and once with them; the
 * two outputs are what `baselines/svg-import.md` compares. Every build goes
 * through `runBuild`, the path the ledger and the CLI take.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { runBuild } from "../../src/cli/build.ts";
import { resolveComposition } from "../../src/cli/resolve.ts";

const ROOT = resolve(import.meta.dir, "../..");
const ledger = JSON.parse(readFileSync(join(ROOT, "baselines/digests.json"), "utf8")) as { compositions: Record<string, unknown> };
const sha = (path: string): string | null =>
  existsSync(path) ? new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex") : null;

const out: Record<string, unknown> = {};
for (const dir of Object.keys(ledger.compositions).sort()) {
  const r = await resolveComposition({ dir: join(ROOT, dir), flags: { json: false }, requireBundle: false });
  if (!r.ok) {
    out[dir] = { error: r.message };
    continue;
  }
  const started = performance.now();
  try {
    await runBuild(r.value);
  } catch (e) {
    out[dir] = { error: (e instanceof Error ? e.message : String(e)).split("\n")[0] };
    continue;
  }
  out[dir] = {
    pak: sha(r.value.pakPath),
    bundle: sha(r.value.bundlePath),
    inventory: sha(r.value.bundlePath.replace(/\.js$/, ".paths.json")),
    buildMs: Math.round(performance.now() - started),
  };
  console.error(`${dir} ${Math.round(performance.now() - started)} ms`);
}
console.log(JSON.stringify(out, null, 2));
