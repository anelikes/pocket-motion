/**
 * Scratch directories for the suite, one root per run.
 *
 * Tests used to write to fixed paths — `/tmp/pocketjs-motion-cli-test` and
 * about twenty more — so two checkouts running `bun test ./tests/` at once
 * deleted each other's builds mid-run: each file's `beforeAll` removes its
 * directory and rebuilds into it, and the other run's `trace` then read a
 * bundle that was not there or was not its own. 14 to 34 false failures a run
 * were reported by several sessions, every one passing when its suite ran
 * alone.
 *
 * Now the root is a fresh `mkdtemp` under `os.tmpdir()`, created once per
 * process — `bun test` runs every file in one process and evaluates this
 * module once — and every directory a test asks for is a fresh `mkdtemp`
 * under it, so no two runs and no two files can name the same path.
 * `tests/preload.ts` removes the root after the last file. The root is the
 * realpath, because macOS's `os.tmpdir()` is under `/var`, a symlink to
 * `/private/var`, and a child's `process.cwd()` reports the resolved form.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** This run's scratch root. */
export const SCRATCH_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "pocket-motion-test-")));

/**
 * A new, empty directory under this run's root, named after `name` so a path
 * in a failure says which test made it. A second call with the same name is a
 * second directory.
 */
export function scratchDir(name: string): string {
  return mkdtempSync(join(SCRATCH_ROOT, `${name}-`));
}
