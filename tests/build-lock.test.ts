/**
 * One build at a time, over the file every build writes and no build owns.
 *
 * `vendor/pocketjs/tools/build.ts` pass 1 writes
 * `vendor/pocketjs/framework/src/styles.generated.ts` into the SHARED vendored
 * tree, outside the `--outdir` it was given, and pass 2 resolves that path. So
 * "two builds into two directories" is not two independent builds, and this
 * file is about what that costs and what now prevents it.
 *
 * WHAT GOES RED WITHOUT THE LOCK, and it is not the case the CI failure
 * suggested. Two facts were measured first:
 *
 *  - `Bun.write` never leaves a file missing or empty: one process rewriting a
 *    200 KB stand-in 84k times while another stats it 5.1M times reports 0 of
 *    each. And every build writes the mirror in its own pass 1 before its own
 *    pass 2 resolves it. So "one build removes it while another resolves it"
 *    is not a window that exists here.
 *  - The window that does exist is between a write and a reader that pairs the
 *    file with a pak. `src/text/measure.ts` is the only such reader: it reads
 *    the px -> slot table straight back out of the mirror to check it against
 *    the atlases in its own build's pak. A composition build landing in that
 *    gap replaces the table, and `verifySlots` refuses.
 *
 * `the measurer survives a composition build beside it` is therefore the guard
 * with a regression behind it. Before the lock, run with a composition build
 * starting 300 ms into a measurement build, it fails with
 *
 *     openMeasurer: the slot table has no entry for 37px regular, which this
 *     build was asked to bake — styles.generated.ts is not this build's
 *
 * on 2 of 8 sampled offsets, 300 ms red on both runs of a hand sweep, and this
 * test's own six offsets went red at 150 ms with the lock reverted. It is a
 * timing guard and it says so: the offsets below bracket the window measured on
 * this machine, and a much faster or slower one could step over it — one red
 * offset is enough, so six are sampled rather than one. That is also why the
 * other tests pin the properties directly instead of only sampling.
 *
 * WHAT THE TWO "mirror deleted first" TESTS DO AND DO NOT SHOW, now that
 * `withBuildLock` seeds the file. They were written for the shape the CI
 * failure reported — `Could not resolve: "./styles.generated.ts"` on a fresh
 * checkout — and that case was green here with and without the lock, so they
 * were kept as properties rather than as a reproduction. They still hold two:
 * two overlapping builds both exit 0, and the mirror is present afterwards.
 * They no longer say anything about a build resolving a file its own pass 1
 * wrote, because the seed puts it there first; that is the point of the seed,
 * and `tests/vendor-mirror.test.ts` is where the seed itself is held.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { runBuild } from "../src/cli/build.ts";
import { resolveComposition } from "../src/cli/resolve.ts";
import { lockPath, withBuildLock } from "../src/vendor/build-lock.ts";
import { seedMirror } from "../src/vendor/mirror.ts";
import { openMeasurer } from "../src/text/measure.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const MIRROR = join(VENDOR, "framework", "src", "styles.generated.ts");

process.env.POCKETJS_ROOT = VENDOR;

const FACE = {
  regular: join(ROOT, "assets/fonts/HarmonyOS_Sans_Regular.ttf"),
  bold: join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf"),
};

/** Sizes no composition in this tree bakes, so a foreign table cannot satisfy them. */
const ODD_SIZES = [{ px: 37 }, { px: 59 }, { px: 83, bold: true }] as const;

async function composition(dir: string) {
  const r = await resolveComposition({
    dir: join(ROOT, dir),
    flags: { json: false },
    requireBundle: false,
  });
  if (!r.ok) throw new Error(`${dir}: ${r.message}`);
  return r.value;
}

/** One CLI build as its own process, which is the cross-process case. */
async function cliBuild(dir: string): Promise<{ code: number; text: string }> {
  const proc = Bun.spawn(["bun", "src/cli/main.ts", "build", dir], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, POCKETJS_ROOT: VENDOR },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, text: stdout + stderr };
}

beforeAll(() => {
  if (!existsSync(join(VENDOR, "tools", "build.ts"))) {
    throw new Error(`vendor pocketjs missing at ${VENDOR} — run bun run vendor`);
  }
  if (!existsSync(FACE.regular)) {
    throw new Error(`${FACE.regular} is absent — run bun scripts/assets.ts`);
  }
});

afterAll(() => {
  // A lock file surviving the suite would make the next run wait on a pid that
  // is gone. Releasing is the code's job; this only keeps a failure here from
  // costing the next run anything.
  rmSync(lockPath(), { force: true });
  // Likewise the mirror: two tests above delete it, and a failure between the
  // delete and the build that would rewrite it would leave the tree in the
  // state `doctor` now reports as a fault.
  seedMirror(VENDOR);
});

describe("the build lock", () => {
  test(
    "the measurer survives a composition build beside it",
    async () => {
      const smoke = await composition("compositions/smoke");
      const failures: string[] = [];
      // Offsets bracketing the window measured on this machine: a measurement
      // build writes the mirror at roughly 1s and reads it back at roughly
      // 1.8s, and a composition build started at these offsets writes inside
      // that gap.
      for (const offsetMs of [150, 250, 350, 450, 550, 650]) {
        const [measured, built] = await Promise.allSettled([
          (async () => {
            const m = await openMeasurer({
              face: FACE,
              sizes: [...ODD_SIZES],
              texts: ["measure me"],
            });
            await m.close();
          })(),
          (async () => {
            await Bun.sleep(offsetMs);
            await runBuild(smoke);
          })(),
        ]);
        for (const [what, r] of [
          ["measurer", measured],
          ["composition build", built],
        ] as const) {
          if (r.status === "rejected") {
            failures.push(`+${offsetMs}ms ${what}: ${String((r.reason as Error).message).split("\n")[0]}`);
          }
        }
      }
      expect(failures.join("\n") || "clean").toBe("clean");
    },
    300_000,
  );

  test(
    "two builds in one process, with the mirror deleted first",
    async () => {
      // The fresh-checkout state: the mirror is gitignored upstream and does
      // not exist until a build writes it.
      rmSync(MIRROR, { force: true });
      expect(existsSync(MIRROR)).toBe(false);
      const [a, b] = await Promise.allSettled([
        runBuild(await composition("compositions/smoke")),
        runBuild(await composition("compositions/probe")),
      ]);
      expect(a.status === "rejected" ? String((a.reason as Error).message) : "ok").toBe("ok");
      expect(b.status === "rejected" ? String((b.reason as Error).message) : "ok").toBe("ok");
      // Written by whichever went second, and present either way — pass 2
      // resolves it off disk, so a build that left it absent would break the
      // next one.
      expect(existsSync(MIRROR)).toBe(true);
    },
    300_000,
  );

  test(
    "two builds as two processes, with the mirror deleted first",
    async () => {
      rmSync(MIRROR, { force: true });
      const [a, b] = await Promise.all([
        cliBuild("compositions/smoke"),
        cliBuild("compositions/probe"),
      ]);
      expect(`smoke: ${a.code}\n${a.text}`).toStartWith("smoke: 0");
      expect(`probe: ${b.code}\n${b.text}`).toStartWith("probe: 0");
      expect(existsSync(MIRROR)).toBe(true);
      // Both released. A held lock here would be a build that exited without
      // running its `finally`.
      expect(existsSync(lockPath())).toBe(false);
    },
    300_000,
  );

  test("a lock left by a dead process is taken over, not waited on", async () => {
    // The recovery path, without killing anything: a pid that cannot exist
    // stands in for a build that was interrupted. Without the takeover this
    // would block for the full timeout.
    await Bun.write(
      lockPath(),
      JSON.stringify({
        pid: 0x7ffffff,
        host: (await import("node:os")).hostname(),
        startedAt: Date.now(),
        what: "a build that is not running",
      }),
    );
    const started = Date.now();
    const seen = await withBuildLock("the takeover", async () => "ran");
    expect(seen).toBe("ran");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(existsSync(lockPath())).toBe(false);
  }, 30_000);

  test("the lock is released when the work throws", async () => {
    await expect(
      withBuildLock("a build that fails", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(lockPath())).toBe(false);
  });
});
