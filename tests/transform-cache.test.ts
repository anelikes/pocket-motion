/**
 * Upstream's compiler keeps its transform cache under `$HOME/.cache` unless
 * told otherwise (`tools/targets/cache.ts`, since the pin moved to 66caf4e5),
 * and a build that cannot create it fails. Every build this repository spawns
 * names `vendor/pocketjs/.cache` instead (`src/vendor/cache.ts`), so a HOME
 * nothing can write to is not a reason a composition does not build — nor a
 * measurement, which spawns its own build, and which every generator that
 * fits text runs first.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { buildSpawn, resolveComposition } from "../src/cli/resolve.ts";
import { pocketjsRoot } from "../src/runtime/boot.ts";
import { openMeasurer } from "../src/text/measure.ts";
import { pocketNexusCacheDir } from "../src/vendor/cache.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const SMOKE_DIR = join(ROOT, "compositions", "smoke");
const TMP = scratchDir("transform-cache");

/** Run `body` with HOME under a regular file (no directory can be created
 *  there) and no XDG_CACHE_HOME, restoring both after. */
async function withBlockedHome<T>(body: () => Promise<T>): Promise<T> {
  const saved = { HOME: process.env.HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME };
  const blocked = join(TMP, "home-is-a-file");
  mkdirSync(TMP, { recursive: true });
  await Bun.write(blocked, "");
  process.env.HOME = join(blocked, "home");
  delete process.env.XDG_CACHE_HOME;
  try {
    return await body();
  } finally {
    process.env.HOME = saved.HOME;
    if (saved.XDG_CACHE_HOME !== undefined) process.env.XDG_CACHE_HOME = saved.XDG_CACHE_HOME;
  }
}

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
    await withBlockedHome(() => runBuild(result.value));
    expect(existsSync(join(dist, "main.js"))).toBe(true);
    expect(readdirSync(join(pocketNexusCacheDir(), "transforms")).length).toBeGreaterThan(0);
  }, 120_000);

  test("nor does it stop a measurement", async () => {
    // A child started with the blocked HOME, the way a generator runs where
    // HOME is read-only: a spawn that names no env inherits the environment
    // its process STARTED with, so editing process.env here would not reach
    // the measurer's own build at all.
    mkdirSync(TMP, { recursive: true });
    const blocked = join(TMP, "home-is-a-file");
    await Bun.write(blocked, "");
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "XDG_CACHE_HOME" && k !== "POCKET_NEXUS_CACHE_DIR") env[k] = v;
    }
    env.HOME = join(blocked, "home");
    const script = `
      const { openMeasurer } = await import(${JSON.stringify(join(ROOT, "src/text/measure.ts"))});
      const face = {
        regular: ${JSON.stringify(join(ROOT, "assets/fonts/HarmonyOS_Sans_Regular.ttf"))},
        bold: ${JSON.stringify(join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf"))},
      };
      const m = await openMeasurer({ face, sizes: [{ px: 31 }], texts: ["Measured under a blocked HOME"] });
      console.log("width", m.measure(31)("Measured under a blocked HOME"));
      await m.close();
    `;
    const p = Bun.spawn(["bun", "-e", script], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(`${code}\n${err}`.slice(0, 600)).toStartWith("0\n");
    expect(Number(/width (\S+)/.exec(out)?.[1])).toBeGreaterThan(0);
  }, 120_000);
});
