/**
 * Where upstream's compiler keeps its transform cache, for every build this
 * repository spawns.
 *
 * Upstream moved the cache out of its own tree (`tools/targets/cache.ts`):
 * `$POCKET_NEXUS_CACHE_DIR`, else `$XDG_CACHE_HOME/pocket-nexus`, else
 * `~/.cache/pocket-nexus`. Left to that, a build fails where HOME is not
 * writable — a sandbox, some runners — and every checkout on one machine
 * shares one directory. Naming the vendored tree's own `.cache/` puts the
 * transforms back where they were at e0b37e2 (`vendor/pocketjs/.cache/
 * transforms/`): inside `/vendor/`, which `.gitignore` already excludes, and
 * gone with the tree on `bun run vendor --refresh`.
 *
 * The cache is not an input to the picture. Its key mixes the module's source,
 * the framework, the feature set and a digest of the compiler's own sources
 * (`compilerImplementationHash` in `framework/compiler/jsx-plugin.ts`), so a
 * hit returns what a miss would have computed; where it lives only decides
 * whether a build can run at all.
 */

import { join } from "node:path";

import { pocketjsRoot } from "../runtime/boot.ts";

/** The directory a build is told to use as `POCKET_NEXUS_CACHE_DIR`. */
export function pocketNexusCacheDir(): string {
  return join(pocketjsRoot(), ".cache");
}

/** The environment a build spawns with: this process's, plus the cache dir. */
export function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.POCKET_NEXUS_CACHE_DIR = pocketNexusCacheDir();
  return env;
}
