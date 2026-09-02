/**
 * What makes a preview live: a watch over the source, and the identity of the
 * artefacts a session was opened on.
 *
 * `preview` has always been a snapshot. It loads a bundle at start and holds
 * it, so an edit and a rebuild change nothing on screen and the page says
 * nothing either — the black-screen session that opened this work lost its
 * first hour to exactly that, against a server four commits behind its own
 * source. Watching closes it: the source changes, the build the CLI itself
 * prints runs, the session reopens on the new bundle, and both pages hear
 * about it.
 *
 * The watch is over the whole `compositions/` tree rather than the one
 * composition's directory, because a cut imports from beside it — a multi-cut
 * delivery keeps its shared modules one level up, and a fixture reads the
 * generator next to it. Watching only the current directory would miss the
 * edit that actually moved the picture. Anything named `dist` is excluded: it
 * is what a build writes, so watching it would have every rebuild trigger the
 * next one.
 */

import { watch, type FSWatcher } from "node:fs";
import { join, sep } from "node:path";

export { artefactDigest, artefactKey } from "../cli/artefacts.ts";

export interface SourceWatchOptions {
  /** Repository root; the watch is over `<root>/compositions`. */
  readonly root: string;
  /** Fired once per burst of changes, after the debounce. */
  readonly onChange: () => void;
  /** Milliseconds to coalesce a burst. A save touches several files. */
  readonly debounceMs?: number;
}

export interface SourceWatch {
  close(): void;
}

/**
 * Watch the composition tree. Returns null when the platform cannot watch
 * recursively — a caller that cannot watch should say so rather than pretend
 * it is live.
 */
export function watchSources(options: SourceWatchOptions): SourceWatch | null {
  const dir = join(options.root, "compositions");
  const debounceMs = options.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher;
  try {
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (filename && isBuildOutput(String(filename))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        options.onChange();
      }, debounceMs);
    });
  } catch {
    return null;
  }
  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}

/**
 * A path the build wrote, rather than a source anyone edited.
 *
 * `dist` at ANY depth, not just directly under `compositions/`.
 *
 * Every build this CLI spawns now lands in ONE root, `<repo>/dist`, which is
 * outside the watched tree entirely (`src/cli/resolve.ts`) — so this filter is
 * no longer what keeps a rebuild from asking for the next one. It is kept
 * because the artefacts inside `compositions/` are real: the root used to
 * depend on how deep a composition sat, leaving `compositions/dist` and
 * `compositions/<name>/dist` behind in any tree built before that change, and
 * a build run by hand takes whatever `--outdir` it is given. Matching a
 * leading `dist/` missed both of those, and nothing looped only because
 * requestReload drops a request while one is running and the build's own write
 * lands inside that window — an accident, not a design.
 *
 * AGENTS.md states the rule this follows: a tool that walks `compositions/`
 * must exclude `dist` by name as well as by `.gitignore`.
 */
export function isBuildOutput(relativePath: string): boolean {
  return relativePath.split(sep).join("/").split("/").includes("dist");
}
