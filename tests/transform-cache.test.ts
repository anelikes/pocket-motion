/**
 * Upstream's compiler keeps its transform cache under `$HOME/.cache` unless
 * told otherwise (`tools/targets/cache.ts`, since the pin moved to 66caf4e5),
 * and a build that cannot create it fails. Every build this repository spawns
 * names `vendor/pocketjs/.cache` instead (`src/vendor/cache.ts`), so a HOME
 * nothing can write to is not a reason a composition does not build.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { buildSpawn, resolveComposition } from "../src/cli/resolve.ts";
import { pocketjsRoot } from "../src/runtime/boot.ts";
import { pocketNexusCacheDir } from "../src/vendor/cache.ts";

const ROOT = resolve(import.meta.dir, "..");
const SMOKE_DIR = join(ROOT, "compositions", "smoke");
const TMP = "/tmp/pocketjs-motion-transform-cache-test";

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("the transform cache", () => {
  test("a build is told to use the vendored tree's .cache", async () => {
    const result = await resolveComposition({ dir: SMOKE_DIR, flags: { json: false }, requireBundle: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildSpawn(result.value).env.POCKET_NEXUS_CACHE_DIR).toBe(join(pocketjsRoot(), ".cache"));
  });

  test("a HOME nothing can write to does not stop a build", async () => {
    const dist = join(TMP, "dist");
    mkdirSync(dist, { recursive: true });
    const result = await resolveComposition({
      dir: SMOKE_DIR,
      flags: { json: false, bundle: join(dist, "main.js"), pak: join(dist, "main.pak") },
      requireBundle: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = { HOME: process.env.HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME };
    // A path under a regular file: no directory can be created there.
    const blocked = join(TMP, "home-is-a-file");
    await Bun.write(blocked, "");
    process.env.HOME = join(blocked, "home");
    delete process.env.XDG_CACHE_HOME;
    try {
      await runBuild(result.value);
    } finally {
      process.env.HOME = saved.HOME;
      if (saved.XDG_CACHE_HOME !== undefined) process.env.XDG_CACHE_HOME = saved.XDG_CACHE_HOME;
    }
    expect(existsSync(join(dist, "main.js"))).toBe(true);
    expect(readdirSync(join(pocketNexusCacheDir(), "transforms")).length).toBeGreaterThan(0);
  }, 120_000);
});
