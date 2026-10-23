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
 */

import {
  outDirOf,
  writeBuildRecord,
  type BuildRecord,
} from "../render/build-record.ts";
import { buildSpawn, type ResolvedComposition } from "./resolve.ts";

/**
 * Build a composition and record what built it.
 *
 * Takes the composition rather than a command string so no caller can spawn
 * `buildCommand.split(" ")` — a path with a space in it became two argv tokens
 * and surfaced three layers down as `cannot resolve app "dist"`.
 */
export async function runBuild(
  c: Pick<ResolvedComposition, "buildArgs" | "dir">,
): Promise<BuildRecord> {
  const { argv, cwd, env } = buildSpawn(c);
  const proc = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe" });
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
  const outDir = outDirOf(argv);
  if (outDir === null) {
    // buildSpawn always writes one; a caller that dropped it would leave an
    // artifact no command can read, which is worth failing on rather than
    // discovering later.
    throw new Error(`build argv names no --outdir: ${argv.join(" ")}`);
  }
  return writeBuildRecord(outDir, argv);
}
