/**
 * The bake-rate guard (`src/runtime/boot.ts`).
 *
 * Two layers. The unit cases pin the MESSAGE — both rates, the ratio, the
 * repair line, and that an absent marker is refused rather than read as 60.
 * The end-to-end pair at the bottom pins the thing the message is about: a
 * bundle really built at 30 Hz, handed to the real boot path.
 *
 * The second layer was missing, and this header asserted it had been done by
 * hand against `compositions/curves`. A claim about a check that no check
 * re-derives is the defect this repository has recorded three times.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { TICKS_PER_SECOND, assertBakedTickRate, hardenedBootWorld } from "../src/runtime/boot.ts";
import { scratchDir } from "./scratch.ts";

const ROOT = resolve(import.meta.dir, "..");
const VENDOR = join(ROOT, "vendor", "pocketjs");
const BUNDLE = "/tmp/whatever/main.js";
const BUILD = "bun tools/build.ts main.tsx --hz=60";

describe("assertBakedTickRate", () => {
  test("the realm's own rate passes", () => {
    expect(() => assertBakedTickRate(TICKS_PER_SECOND, BUNDLE)).not.toThrow();
  });

  test("another rate is refused, and the message names both rates and the ratio", () => {
    let message = "";
    try {
      assertBakedTickRate(30, BUNDLE, BUILD);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("baked at 30 Hz");
    expect(message).toContain(`realm ticks at ${TICKS_PER_SECOND} Hz`);
    // 60/30: the animation completes in half the declared time.
    expect(message).toContain("2.00x");
    expect(message).toContain(BUILD);
  });

  test("a rate above the realm's is refused too — the mistake is not only downward", () => {
    expect(() => assertBakedTickRate(120, BUNDLE)).toThrow(/baked at 120 Hz/);
  });

  /**
   * The point of the patch: before it, the rate was not readable at all. A
   * bundle that does not publish it has not declared 60, it has declared
   * nothing, and the two must not collapse into the same verdict.
   */
  test("an absent marker is refused rather than read as the realm's rate", () => {
    let message = "";
    try {
      assertBakedTickRate(undefined, BUNDLE, BUILD);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("__pocketTickHz");
    expect(message).toContain("patches/0010-publish-baked-tick-rate.patch");
    expect(message).toContain("bun scripts/vendor.ts");
    expect(message).toContain(BUILD);
  });

  test("a non-numeric marker is refused without inventing a ratio", () => {
    let message = "";
    try {
      assertBakedTickRate("60", BUNDLE);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("baked at 60 Hz");
    expect(message).not.toContain("x its declared speed");
  });

  test("the repair line is omitted when no build command is known", () => {
    let message = "";
    try {
      assertBakedTickRate(30, BUNDLE);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain("Rebuild at the realm's rate:");
    expect(message).toContain("--hz=60");
  });
});

/**
 * The same predicate against bundles actually built at each rate.
 *
 * The unit cases above hand `assertBakedTickRate` a literal, which pins the
 * message and not the thing the message is about — whether a bundle built at
 * another rate reaches the guard at all. The header of this file used to
 * assert that had been done by hand, which is the shape this repository keeps
 * finding: a claim about a check that no check re-derives. Two builds of one
 * three-node composition, and the boot path either refuses or does not.
 */
describe("a bundle actually built at another rate", () => {
  const TMP = scratchDir("tick-rate");
  const DIR = join(ROOT, "compositions", "late-anim");

  const build = async (hz: number): Promise<string> => {
    const outdir = join(TMP, `hz${hz}`);
    mkdirSync(outdir, { recursive: true });
    const proc = Bun.spawn(
      [
        "bun",
        join(VENDOR, "tools", "build.ts"),
        join(DIR, "main.tsx"),
        `--outdir=${outdir}`,
        "--framework=solid",
        `--hz=${hz}`,
      ],
      { cwd: VENDOR, stdout: "pipe", stderr: "pipe", env: { ...process.env } },
    );
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    const bundle = join(outdir, "main.js");
    if (code !== 0 || !existsSync(bundle)) {
      throw new Error(`--hz=${hz} build failed (${code}): ${stderr}`);
    }
    return bundle;
  };

  const boot = async (bundlePath: string): Promise<string> => {
    try {
      await hardenedBootWorld({
        bundlePath,
        width: 640,
        height: 360,
        hz: 30,
        shutter: null,
        renderScale: 1,
        buildCommand: BUILD,
      });
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    if (!existsSync(join(VENDOR, "tools", "build.ts"))) {
      throw new Error(`vendor pocketjs missing at ${VENDOR} — run bun scripts/vendor.ts`);
    }
  });
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  test("--hz=30 is refused by the boot path, not only by the predicate", async () => {
    const message = await boot(await build(30));
    expect(message).toContain("baked at 30 Hz");
    expect(message).toContain("2.00x");
    expect(message).toContain(BUILD);
  }, 180_000);

  // The other half: the same composition, the same boot, the rate the build
  // command the CLI prints actually passes. Without this the test above would
  // also pass if `hardenedBootWorld` refused every bundle it was handed.
  test("--hz=60 boots", async () => {
    expect(await boot(await build(60))).toBe("");
  }, 180_000);
});
