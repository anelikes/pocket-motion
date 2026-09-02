/**
 * One build at a time, because a build writes outside its own `--outdir`.
 *
 * `vendor/pocketjs/tools/build.ts` pass 1 writes
 * `vendor/pocketjs/framework/src/styles.generated.ts` — a SINGLE file in the
 * shared vendored tree, not under the `--outdir` the caller named — and pass 2
 * then resolves that path. Two builds overlapping therefore share one mutable
 * file whichever directories they were pointed at.
 *
 * WHAT AN OVERLAP ACTUALLY COSTS, measured rather than feared. Two things,
 * and only one of them is loud:
 *
 *  - The mirror is the only place the px -> font-slot assignment is published,
 *    and `src/text/measure.ts` reads it back immediately after its own build to
 *    pair the slot table with that build's pak. A composition build landing
 *    between those two steps replaces the table, and `verifySlots` throws
 *    `styles.generated.ts is not this build's`. Reproduced in one process by
 *    starting a composition build 300-500 ms into a measurement build.
 *  - Nothing else reads it back, so every other overlap is silent. Pass 2 is
 *    handed this build's styles in memory by `jsxPlugin`, so a clobbered
 *    mirror still produces a correct pak; the file only has to EXIST for the
 *    bundler to resolve the import. And `Bun.write` never leaves a gap for
 *    that to fall through — one process rewriting a 200 KB file 84k times
 *    while another stats it 5.1M times reports 0 missing and 0 empty (a
 *    stand-in file, not this one; what was being measured is `Bun.write`).
 *    So the hazard is the CONTENT between a write and the reader that pairs
 *    it with a pak, not the file's momentary absence.
 *
 * A file that was never there at all is a THIRD thing, and it is not a race
 * between two builds: one build alone, on a fresh checkout, resolves the path
 * in pass 1 before creating it and again in pass 2 after. `src/vendor/mirror.ts`
 * has the mechanism and the CI run; `withBuildLock` seeds the file below so no
 * build this repository spawns is in that state.
 *
 * WHY A LOCK AND NOT A RETRY. The other option considered was to catch a build
 * failure whose stderr names `styles.generated.ts` and run it again. That
 * reacts to one symptom, and it is the symptom that is NOT the damage: in the
 * race reproduced above the build that lost the file exited 0 and it was the
 * MEASURER that failed. A retry would have had nothing to retry. Preventing
 * the overlap covers both symptoms; reacting to a failed build covers neither
 * reliably.
 *
 * TWO SCOPES, because there are two ways builds overlap here:
 *
 *  - Within one process: `runBuild` (`src/cli/build.ts`) and `openMeasurer`
 *    (`src/text/measure.ts`) are both spawn sites, and a caller can have both
 *    in flight. A promise chain closes that, the same shape
 *    `PreviewSession.runExclusive` and `makeSwitchQueue` already use.
 *  - Between processes: the ledger, `preview`'s hot reload, a second CLI and a
 *    person building by hand all reach the same vendored tree. An advisory
 *    lock file closes that.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied: a build spawned straight
 * from `bun vendor/pocketjs/tools/build.ts` takes no lock, because upstream is
 * not patched for this. It is still the case that everything THIS repository
 * builds is serialised, and `AGENTS.md` already says a build outside `runBuild`
 * is a build somebody ran by hand.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { pocketjsRoot } from "../runtime/boot.ts";
import { seedMirror } from "./mirror.ts";

/**
 * `.cache/` rather than a new directory: upstream's own `.gitignore` calls it
 * the "pass-1 transform cache (content-hash keyed; safe to delete any time)",
 * which is exactly the lifetime a lock file wants. `scripts/vendor.ts` removes
 * the whole tree, so a rebuild cannot inherit a stale one.
 */
export function lockPath(): string {
  return join(pocketjsRoot(), ".cache", "build.lock");
}

/** What a holder records, so a waiter can say who it is waiting for. */
interface Holder {
  readonly pid: number;
  readonly host: string;
  readonly startedAt: number;
  /** What is being built, for the message. */
  readonly what: string;
}

/** How long to wait for another process before failing and naming the holder. */
const WAIT_TIMEOUT_MS = 10 * 60_000;
/** How often to retry the exclusive create while waiting. */
const POLL_MS = 50;

function readHolder(path: string): Holder | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object") return null;
    const h = raw as Record<string, unknown>;
    if (typeof h.pid !== "number" || typeof h.host !== "string") return null;
    return {
      pid: h.pid,
      host: h.host,
      startedAt: typeof h.startedAt === "number" ? h.startedAt : 0,
      what: typeof h.what === "string" ? h.what : "a build",
    };
  } catch {
    // Absent, or half-written by a holder that is mid-`writeFileSync`. Either
    // way there is nothing to attribute the lock to yet; the caller retries.
    return null;
  }
}

/**
 * Is the recorded holder still running?
 *
 * `kill(pid, 0)` answers for this machine only, which is the honest limit: the
 * vendored tree is a local directory and a lock held by another host is a
 * situation this cannot resolve, so a foreign host is treated as alive and the
 * wait runs to its timeout with a message that names the host.
 */
function holderAlive(h: Holder): boolean {
  if (h.host !== hostname()) return true;
  try {
    process.kill(h.pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists and is not ours to signal.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Take the file lock, or throw saying who holds it. Returns a release fn. */
async function acquireFileLock(what: string): Promise<() => void> {
  const path = lockPath();
  mkdirSync(join(pocketjsRoot(), ".cache"), { recursive: true });
  const mine: Holder = { pid: process.pid, host: hostname(), startedAt: Date.now(), what };
  const body = JSON.stringify(mine);
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      // `wx` is O_CREAT|O_EXCL: the create either wins or throws EEXIST, which
      // is the whole mutual exclusion. Nothing here is atomic across a network
      // filesystem, and the vendored tree is not on one.
      writeFileSync(path, body, { flag: "wx" });
      return () => {
        // Only remove a lock that is still ours. A lock stolen from us as
        // stale belongs to somebody else now, and removing it would hand a
        // third process the same window this exists to close.
        const held = readHolder(path);
        if (held && held.pid === mine.pid && held.startedAt === mine.startedAt) {
          rmSync(path, { force: true });
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const held = readHolder(path);
    if (held !== null && !holderAlive(held)) {
      // The holder died without releasing. Say so on the way past rather than
      // recovering silently: a lock file outliving its process means a build
      // was killed, and that is worth one line.
      process.stderr.write(
        `build lock: pid ${held.pid} died holding it (${held.what}); taking it over\n`,
      );
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() > deadline) {
      const who = held
        ? `pid ${held.pid} on ${held.host}, building ${held.what} since ` +
          `${new Date(held.startedAt).toISOString()}`
        : "an unreadable lock file";
      throw new Error(
        `build lock: waited ${Math.round(WAIT_TIMEOUT_MS / 1000)}s for ${who}.\n` +
          `Every build writes ${join(pocketjsRoot(), "framework/src/styles.generated.ts")}, ` +
          "which is shared, so builds run one at a time.\n" +
          `If nothing is building, remove ${path}.`,
      );
    }
    await Bun.sleep(POLL_MS);
  }
}

/** In-process serialisation. Cross-process is the file lock inside it. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Run `work` with no other build in flight — in this process or any other that
 * goes through this module.
 *
 * The critical section is the caller's whole unit of work, not just the spawn:
 * `openMeasurer` has to hold it past the build until it has read the mirror
 * back, which is the window the reproduction above lands in.
 */
export function withBuildLock<T>(what: string, work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const release = await acquireFileLock(what);
    try {
      // Inside the lock, because it writes the same shared file the lock is
      // about. `seedMirror` only fills an absence, so a real table written by
      // the previous holder is left alone; what it prevents is a build having
      // to resolve `styles.generated.ts` off a directory Bun may already have
      // listed without it. `scripts/vendor.ts` seeds a fresh tree, and this
      // covers a tree that lost the file afterwards — `tests/build-lock.test.ts`
      // removes it on purpose, and so can a person. See `src/vendor/mirror.ts`.
      seedMirror();
      return await work();
    } finally {
      release();
    }
  };
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
