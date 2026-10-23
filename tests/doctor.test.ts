/**
 * `doctor` — the environment preflight, and the two exit conventions.
 *
 * The green half is a claim about this machine, so it is asserted loosely:
 * that every check produced a sentence and a shape an agent can branch on,
 * and that a tree able to run this suite passes. The red half is constructed
 * — a PATH with no ffmpeg on it — and is where the contract that matters
 * lives: `--json` exits 0 anyway and puts the verdict in `ok`, while human
 * mode exits 1.
 */

import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";

import {
  WASM_TARGET,
  checkAssets,
  checkVendor,
  diskVerdict,
  report,
  type DoctorCheck,
} from "../src/cli/commands/doctor.ts";
import {
  FULL_RUN_COMFORTABLE_GIB,
  FULL_RUN_NEED_GIB,
  FULL_RUN_RGBA_BYTES,
  FULL_RUN_RGBA_FILES,
  HEADROOM_MULTIPLE,
  RECLAIM_COMMAND,
  formatGiB,
} from "../src/cli/disk.ts";
import { vendorProblems, type VendorStatus } from "../src/vendor/status.ts";
import { EXIT_FAIL, EXIT_OK } from "../src/cli/types.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");

/** A PATH holding bun and the base system, and deliberately no ffmpeg. */
const BARE_PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;

function shaped(check: DoctorCheck): void {
  expect(typeof check.name).toBe("string");
  expect(check.name.length).toBeGreaterThan(0);
  expect(typeof check.ok).toBe("boolean");
  expect(check.detail.length).toBeGreaterThan(0);
  expect(check.fix === null || typeof check.fix === "string").toBe(true);
}

describe("doctor in this tree", () => {
  test(
    "every check reports a sentence, and a tree that can run this suite passes",
    async () => {
      const payload = await report();
      expect(payload.checks.map((c) => c.name)).toEqual([
        "bun",
        "rustup",
        "ffmpeg",
        "ffprobe",
        "vendor",
        "assets",
        "disk",
      ]);
      for (const check of payload.checks) shaped(check);
      const failed = payload.checks.filter((c) => !c.ok);
      expect(
        failed.map((c) => `${c.name}: ${c.detail}`).join("\n") || "clean",
      ).toBe("clean");
      expect(payload.ok).toBe(true);
      // The shipped payload carries the measured need, not a second opinion
      // about it — the numbers `diskVerdict` is asserted on below are the
      // ones a reader of `doctor --json` actually gets.
      const disk = payload.checks.find((c) => c.name === "disk")!;
      expect(disk.detail).toContain(formatGiB(FULL_RUN_NEED_GIB));
      expect(disk.detail).toContain(formatGiB(FULL_RUN_COMFORTABLE_GIB));
    },
    120_000,
  );

  test("a passing check offers no fix, because there is nothing to run", async () => {
    const vendor = await checkVendor();
    expect(vendor.ok).toBe(true);
    expect(vendor.fix).toBeNull();
    expect(vendor.detail).toContain("patch(es)");

    const assets = await checkAssets();
    expect(assets.ok).toBe(true);
    expect(assets.fix).toBeNull();
  }, 60_000);
});

/**
 * The vendored tree's verdict is a pure function of what was observed, so
 * the states this machine is not in can still be asserted.
 */
describe("vendorProblems", () => {
  const healthy: VendorStatus = {
    path: VENDOR,
    present: true,
    head: "e0b37e2",
    pinned: "e0b37e2",
    patches: ["0001-a.patch"],
    dirtyLines: [" M framework/x.ts"],
    wasmPath: join(VENDOR, "hosts/web/pocketjs.wasm"),
    wasmPresent: true,
  };

  test("a healthy tree has nothing to say", () => {
    expect(vendorProblems(healthy)).toEqual([]);
  });

  test("an absent tree is the only thing reported — the rest is unknowable", () => {
    expect(vendorProblems({ ...healthy, present: false })).toEqual([
      `no vendored tree at ${VENDOR}`,
    ]);
  });

  test("a head that is not the pin is named on both sides", () => {
    expect(vendorProblems({ ...healthy, head: "deadbee" })).toEqual([
      "vendored HEAD is deadbee; the pin is e0b37e2",
    ]);
  });

  test("a CLEAN tree is the fault — the patches are applied and never committed", () => {
    expect(vendorProblems({ ...healthy, dirtyLines: [] })).toEqual([
      "1 patch(es) in patches/ but the vendored tree has no modified file, so none of them is applied",
    ]);
  });

  test("a missing wasm is reported: nothing can rasterise without it", () => {
    expect(vendorProblems({ ...healthy, wasmPresent: false })).toEqual([
      `${healthy.wasmPath} is missing, so nothing can rasterise`,
    ]);
  });
});

/**
 * The disk verdict, at free-space values this machine is not at.
 *
 * The number it is measured against is a MEASUREMENT with a date on it —
 * 1,381,017,600 bytes over six files, read off a full serial ledger run on
 * 2026-10-22 — which is what lets this fail at all. It used to be checked
 * against a 64 GiB high-water mark from a tree the release plan deleted, so
 * every hosted runner (11.6 GiB free) came back red, and the `AUTHORING.md`
 * and `SKILL.md` command gates went red with it because both run `doctor` out
 * of a documented fence. Those three failures were one number.
 */
describe("diskVerdict", () => {
  const none = { count: 0, gib: 0 };
  /** What a GitHub-hosted runner reports, and the reason this was rewritten. */
  const HOSTED_RUNNER_GIB = 11.6;

  test("the need is the measurement, not a remembered ceiling", () => {
    expect(FULL_RUN_RGBA_BYTES).toBe(1_381_017_600);
    expect(FULL_RUN_RGBA_FILES).toBe(6);
    expect(formatGiB(FULL_RUN_NEED_GIB)).toBe("1.3 GiB");
    expect(FULL_RUN_COMFORTABLE_GIB).toBe(FULL_RUN_NEED_GIB * HEADROOM_MULTIPLE);
  });

  test("below the need it fails, and says the volume cannot hold a run", () => {
    const v = diskVerdict(FULL_RUN_NEED_GIB - 0.01, none);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("cannot hold one");
    expect(v.detail).toContain("No space left on device");
  });

  test("11.6 GiB — a hosted runner — is ok, which is the whole point", () => {
    const v = diskVerdict(HOSTED_RUNNER_GIB, none);
    expect(v.ok).toBe(true);
    expect(v.fix).toBeNull();
  });

  test("both numbers are named whatever the verdict", () => {
    for (const free of [FULL_RUN_NEED_GIB - 0.01, FULL_RUN_NEED_GIB + 0.01, HOSTED_RUNNER_GIB]) {
      const detail = diskVerdict(free, none).detail;
      expect(detail).toContain(formatGiB(FULL_RUN_NEED_GIB));
      expect(detail).toContain(formatGiB(FULL_RUN_COMFORTABLE_GIB));
      expect(detail).toContain(`${HEADROOM_MULTIPLE}x`);
    }
  });

  test("between the need and 3x it, the headroom is called thin and still passes", () => {
    const v = diskVerdict(FULL_RUN_NEED_GIB + 0.01, none);
    expect(v.ok).toBe(true);
    expect(v.detail).toContain("little room");
  });

  test("re-derivable bytes already on disk are named, and offer the reclaim", () => {
    const v = diskVerdict(FULL_RUN_NEED_GIB - 0.01, { count: 5, gib: FULL_RUN_NEED_GIB });
    expect(v.detail).toContain("5 .rgba file(s)");
    expect(v.fix).toBe(RECLAIM_COMMAND);
  });

  test("a df that says nothing usable is not a failure", () => {
    const v = diskVerdict(null, none);
    expect(v.ok).toBe(true);
    expect(v.detail).toContain("could not be read");
  });
});

// ---------------------------------------------------------------------------
// The red case, constructed
// ---------------------------------------------------------------------------

async function spawnDoctor(
  argv: readonly string[],
  path: string,
): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(["bun", "src/cli/main.ts", "doctor", ...argv], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: path, POCKETJS_ROOT: VENDOR },
  });
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return { stdout, code };
}

describe("a PATH with no ffmpeg on it", () => {
  test("--json still exits 0, and the verdict is ok:false with a fix", async () => {
    const { stdout, code } = await spawnDoctor(["--json"], BARE_PATH);
    expect(code).toBe(EXIT_OK);
    const payload = JSON.parse(stdout) as {
      ok: boolean;
      checks: DoctorCheck[];
    };
    expect(payload.ok).toBe(false);
    const ffmpeg = payload.checks.find((c) => c.name === "ffmpeg")!;
    expect(ffmpeg.ok).toBe(false);
    expect(ffmpeg.detail).toContain("not on PATH");
    expect(ffmpeg.fix).toBe("brew install ffmpeg");
    // ffprobe is asked separately on purpose: `src/cli/footage.ts` probes a
    // source's dimensions and duration BEFORE paying for the ingest, so a
    // tarball carrying only ffmpeg fails later and further in.
    expect(payload.checks.find((c) => c.name === "ffprobe")!.ok).toBe(false);
  }, 120_000);

  test("human mode exits 1 and prints the fix under the failing check", async () => {
    const { stdout, code } = await spawnDoctor([], BARE_PATH);
    expect(code).toBe(EXIT_FAIL);
    expect(stdout).toContain("FAIL ffmpeg");
    expect(stdout).toContain("fix: brew install ffmpeg");
    expect(stdout).toContain("doctor failed —");
  }, 120_000);

  test("the wasm target is named where the rust check can see it", () => {
    // The one string `bun run vendor` compiles against, so the fix line and
    // the check that produces it cannot drift apart.
    expect(WASM_TARGET).toBe("wasm32-unknown-unknown");
  });
});
