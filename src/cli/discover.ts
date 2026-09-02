/**
 * Which directories in this tree are compositions — the one rule, in one
 * place.
 *
 * A composition is a directory holding `main.tsx`, found at any depth, since a
 * delivery may nest its cuts (`compositions/nested/a/9x16`). Tracked AND
 * not-yet-committed, minus anything gitignored: a composition being written
 * right now still has to be accounted for, while build output and scratch
 * worktrees stay out through `.gitignore`. `dist` is excluded by name as well,
 * because build output lands inside the source tree and a fresh clone's
 * `.gitignore` is not the only thing standing between the two.
 *
 * By name AT ANY DEPTH, which is the rule AGENTS.md states for every tool
 * that walks this tree, and which this filter did not follow: it matched a
 * leading `compositions/dist/` only. The dist root is two levels above the
 * composition, so how deep a composition sits decides where its build lands,
 * and a nested cut's does not land under `compositions/dist` at all —
 * a nested cut used to build into `compositions/nested/dist/a/9x16`, which the
 * leading form does not match. Two other places read `dist/` as a prefix and
 * were fixed at the same time; this was the third. There is one dist root now
 * (`src/cli/resolve.ts`), but a tree built before that carries the old
 * directories and a build run by hand takes whatever `--outdir` it is given,
 * so the by-name rule still stands.
 *
 * `scripts/digests.ts` and `scripts/visibility.ts` each spelled this out, and
 * `scripts/visibility.ts` said in its own comment that the copy was deliberate
 * so a composition added tomorrow could not fall out of one loop while staying
 * in the other. A third caller — preview's composition rail, which is a list a
 * person picks from rather than a gate — is where that arrangement stops
 * paying: a rail that discovers compositions its own way is a rail that can
 * show a composition the ledger has never measured, and say nothing.
 */

/** Where the tree is and what is in it, both from git. */
export interface CompositionCatalog {
  /** Absolute path of the repository root. */
  readonly root: string;
  /** Composition directories, relative to `root`, sorted. */
  readonly dirs: readonly string[];
}

export class DiscoveryError extends Error {}

/**
 * Discover compositions in the repository containing `from`.
 *
 * `from` may be any path inside the tree — the repository root is asked of git
 * rather than assumed from the process's working directory, so a preview
 * started from somewhere else still lists the tree its composition belongs to.
 */
export async function discoverCompositions(from: string): Promise<CompositionCatalog> {
  const root = (await git(["-C", from, "rev-parse", "--show-toplevel"], from)).trim();
  if (root === "") throw new DiscoveryError(`not inside a git repository: ${from}`);
  const listed = await git(
    [
      "-C",
      root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "compositions/**/main.tsx",
    ],
    root,
  );
  return { root, dirs: compositionDirs(listed) };
}

/**
 * The pure half: `git ls-files` output to composition directories. Separated
 * so the rule can be asserted without a repository standing in for it.
 */
export function compositionDirs(lsFilesOutput: string): readonly string[] {
  return lsFilesOutput
    .split("\n")
    .filter(Boolean)
    .map((f) => f.slice(0, -"/main.tsx".length))
    .filter((d) => !d.split("/").includes("dist"))
    .sort();
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) {
    throw new DiscoveryError(
      `git ${args.join(" ")} exited ${code}${err.trim() ? `\n${err.trim()}` : ""}`,
    );
  }
  return out;
}
