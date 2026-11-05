/**
 * The one place a composition's build is spawned.
 *
 * `buildSpawn` (`resolve.ts`) says what to run; this runs it and records what
 * ran. Every caller goes through here — the `build` command, `render --spec`,
 * `preview`'s hot reload, and both ledgers — so a build cannot happen without
 * `build.json` landing beside the artifacts. That is what makes the refusal in
 * `resolveComposition` a boundary rather than a nuisance: everything this
 * repository builds is attributable, and what is left over is a build somebody
 * ran by hand with upstream's own tool.
 *
 * It does not wait for other builds. A build writes its outputs, its style
 * table among them, into the `--outdir` this argv names, and inside the
 * vendored tree only content-addressed transform-cache entries
 * (upstream #591, on the pin since 66caf4e5;
 * `tests/style-table.test.ts` holds both halves).
 *
 * A build whose collector met a `<Path>` `d` it could not read says so on one
 * line (`paths at mount:`, `patches/0054`). Only then is the bundle mounted
 * to read the outlines it computes (`src/render/path-inventory.ts`), and when
 * there are any it is built again with them as `--path-inventory=`, which is
 * the argv recorded. A composition whose every `d` is a literal never takes
 * that path, so its artifacts are the bytes they were.
 */

import { rmSync } from "node:fs";
import { basename, join } from "node:path";

import {
  outDirOf,
  writeBuildRecord,
  type BuildRecord,
} from "../render/build-record.ts";
import { unbakedOutlines, type PathInventory } from "../render/path-inventory.ts";
import { buildSpawn, type ResolvedComposition } from "./resolve.ts";

/** The line `tools/build.ts` prints when some `d` attribute is known only at mount. */
const PATHS_AT_MOUNT = /^\s*paths at mount: (\d+) /m;

async function spawnBuild(argv: readonly string[], cwd: string, env: Record<string, string>): Promise<string> {
  const proc = Bun.spawn([...argv], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `build failed (${code})${stderr.trim() ? `\n${stderr.trim()}` : ""}${stdout.trim() ? `\n${stdout.trim()}` : ""}`,
    );
  }
  return stdout;
}

/**
 * Build a composition and record what built it.
 *
 * Takes the composition rather than a command string so no caller can spawn
 * `buildCommand.split(" ")` — a path with a space in it became two argv tokens
 * and surfaced three layers down as `cannot resolve app "dist"`.
 */
export async function runBuild(
  c: Pick<ResolvedComposition, "buildArgs" | "dir" | "bundlePath" | "pakPath" | "width" | "height" | "fps">,
): Promise<BuildRecord> {
  const { argv, cwd, env } = buildSpawn(c);
  const outDir = outDirOf(argv);
  if (outDir === null) {
    // buildSpawn always writes one; a caller that dropped it would leave an
    // artifact no command can read, which is worth failing on rather than
    // discovering later.
    throw new Error(`build argv names no --outdir: ${argv.join(" ")}`);
  }
  const inventoryPath = join(outDir, `${basename(c.bundlePath, ".js")}.paths.json`);
  // One a previous build left would describe a bundle this one replaces.
  rmSync(inventoryPath, { force: true });
  const stdout = await spawnBuild(argv, cwd, env);

  let recorded: readonly string[] = argv;
  const unread = PATHS_AT_MOUNT.exec(stdout);
  if (unread) {
    const read = async (): Promise<PathInventory["outlines"]> => {
      try {
        return await unbakedOutlines(c);
      } catch (e) {
        throw new Error(
          `${unread[1]} <Path> d attribute(s) are not literals, so the build mounts the bundle to read their outlines, ` +
            `and the mount failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    };
    const outlines = await read();
    if (outlines.length > 0) {
      const inventory: PathInventory = { outlines };
      await Bun.write(inventoryPath, JSON.stringify(inventory, null, 2) + "\n");
      recorded = [...argv, `--path-inventory=${inventoryPath}`];
      await spawnBuild(recorded, cwd, env);
      // The rebuilt bundle differs from the one mounted (its PATH_IDS), so the
      // inventory holds only if its mount computes the same outlines.
      const again = await read();
      if (again.length > 0) {
        throw new Error(
          `the bundle rebuilt with the ${outlines.length} outline(s) its mount computed (${inventoryPath}) ` +
            `mounts ${again.length} more: what the composition draws depends on something that changed between ` +
            `the two builds. First: ${JSON.stringify(again[0]).slice(0, 200)}`,
        );
      }
    }
  }
  // The record names the entry relative to the composition and the outdir
  // relative to itself, so it says nothing about where either sits; `cwd`,
  // the composition's repository, is what a face the sidecar names by an
  // absolute path is written relative to.
  return writeBuildRecord(outDir, recorded, { compositionDir: c.dir, projectRoot: cwd });
}
