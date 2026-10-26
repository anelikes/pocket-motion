/**
 * Loaded before every test file (`bunfig.toml`, `[test] preload`), so what it
 * decides holds for the whole suite and no file can forget it.
 *
 * POCKETJS_ROOT. `pocketjsRoot()` (`src/runtime/boot.ts`) takes the wasm core,
 * the compiler a build runs and the transform cache from it when it is set,
 * and from the vendored tree beside its own source when it is not.
 * `scripts/vendor.ts` reads the same variable as a local clone source, so a
 * session that vendored a fresh worktree from another checkout's tree has it to
 * hand — and a suite run under it booted THAT tree's engine. The vector-paths
 * session's control drew nothing that way, on a core with no PATH op.
 *
 * It is refused, not overridden, because an override cannot reach every
 * process. Bun gives a child spawned without `env` the environment this
 * process STARTED with, not `process.env` as later assigned — measured on Bun
 * 1.3.11 with `Bun.spawn`, `Bun.spawnSync` and `node:child_process` alike — so
 * a test spawning the CLI that way would still boot the inherited tree. And
 * the package test's installed bin has to resolve the package's own tree,
 * which no value set here names. Unset, every process resolves the tree beside
 * its own code: this checkout's, for the suite and every CLI it spawns.
 *
 * Scratch. `tests/scratch.ts` makes this run's root; it is removed here, after
 * the last file.
 */

import { afterAll } from "bun:test";
import { rmSync } from "node:fs";

import { SCRATCH_ROOT } from "./scratch.ts";

if (process.env.POCKETJS_ROOT !== undefined) {
  console.error(
    `tests/preload.ts: POCKETJS_ROOT is set (${JSON.stringify(process.env.POCKETJS_ROOT)}). ` +
      "The suite tests the vendored tree beside its own source, and a child spawned " +
      "without an explicit env would boot the tree this names instead. " +
      "Run it unset: env -u POCKETJS_ROOT bun test ./tests/",
  );
  process.exit(1);
}

afterAll(() => rmSync(SCRATCH_ROOT, { recursive: true, force: true }));
