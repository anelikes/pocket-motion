/**
 * `openMeasurer`'s metrics cache: a metrics-only bake of a charset, built once
 * and booted per call, measuring what a full per-text bake measures.
 *
 * Four claims, each with a red case that was checked by hand:
 *
 * - the cached measurer returns the SAME widths and line heights as a full
 *   bake over the same strings — the measurement comes from the core's own
 *   `measureText` over the same advances and kern pairs, and the coverage the
 *   metrics-only bake drops was never read (red with the bake's advance made
 *   different, e.g. `advance + 1` in bake-font.ts);
 * - a second call is a HIT: nothing is built, the pak on disk is the same
 *   file (red with the key made to include `Bun.nanoseconds()`);
 * - a string with a character outside the charset FALLS BACK to a full bake
 *   and still measures (red with `textsOutside` returning `[]`);
 * - a render boot REFUSES a metrics-only pak, so the cache can never be drawn
 *   as if it were a composition (red with the check in `boot.ts` removed).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hardenedBootWorld } from "../src/runtime/boot.ts";
import { openMeasurer, textsOutside } from "../src/text/measure.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const FACE = {
  regular: join(ROOT, "assets/fonts/HarmonyOS_Sans_Regular.ttf"),
  bold: join(ROOT, "assets/fonts/HarmonyOS_Sans_Bold.ttf"),
};
/** Sizes no composition bakes, so a stale mirror cannot satisfy them. */
const SIZES: readonly { px: number; bold?: boolean }[] = [{ px: 41 }, { px: 67, bold: true }];
const CHARSET = "ÀÉÎàéîïñü—“”…";
const CORPUS = ["Wave", "To Type AV", "café — “naïve” ñu", "…", "ÎLE"];

const cacheDir = await mkdtemp(join(tmpdir(), "pocketjs-measure-cache-"));
afterAll(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("the metrics cache", () => {
  test("measures exactly what a full per-text bake measures", async () => {
    const full = await openMeasurer({ face: FACE, sizes: [...SIZES], texts: CORPUS });
    const cached = await openMeasurer({
      face: FACE, sizes: [...SIZES], texts: CORPUS, cache: { charset: CHARSET, dir: cacheDir },
    });
    try {
      expect(cached.atlas(41).metricsOnly).toBe(true);
      expect(full.atlas(41).metricsOnly).toBe(false);
      expect([cached.atlas(41).cellW, cached.atlas(41).cellH]).toEqual([1, 1]);
      for (const s of SIZES) {
        expect(cached.lineHeight(s.px, s.bold)).toBe(full.lineHeight(s.px, s.bold));
        const a = full.measure(s.px, s.bold);
        const b = cached.measure(s.px, s.bold);
        for (const text of CORPUS) {
          expect(`${s.px}${s.bold ? "b" : ""} ${text}: ${b(text)}`).toBe(
            `${s.px}${s.bold ? "b" : ""} ${text}: ${a(text)}`,
          );
          expect(a(text)).toBeGreaterThan(0);
        }
      }
    } finally {
      await full.close();
      await cached.close();
    }
  }, 120_000);

  test("a second call hits: the pak on disk is untouched and no build runs", async () => {
    const opts = { face: FACE, sizes: [...SIZES], texts: CORPUS, cache: { charset: CHARSET, dir: cacheDir } };
    const first = await openMeasurer(opts);
    await first.close();
    const entries = (await import("node:fs")).readdirSync(cacheDir).filter((e) => !e.includes(".tmp-"));
    expect(entries.length).toBe(1);
    const pak = join(cacheDir, entries[0]!, "dist", "main.pak");
    const before = statSync(pak);
    const t0 = performance.now();
    const second = await openMeasurer(opts);
    const ms = performance.now() - t0;
    await second.close();
    const after = statSync(pak);
    expect([after.mtimeMs, after.size, after.ino]).toEqual([before.mtimeMs, before.size, before.ino]);
    // A build is ~600 ms on this machine; a boot is tens of ms. The bound is
    // loose on purpose: the file identity above is the claim, this is the cost.
    expect(ms).toBeLessThan(400);
    // The whole charset at both sizes is kilobytes, not megabytes.
    expect(after.size).toBeLessThan(64 * 1024);
  }, 120_000);

  test("a character outside the charset falls back to a full bake", async () => {
    expect(textsOutside(["plain ascii\n", "é"], CHARSET)).toEqual([]);
    expect(textsOutside(["中文"], CHARSET)).toEqual(["中", "文"]);
    const m = await openMeasurer({
      face: FACE, sizes: [...SIZES], texts: ["café", "ΩMEGA"], cache: { charset: CHARSET, dir: cacheDir },
    });
    try {
      expect(m.atlas(41).metricsOnly).toBe(false);
      expect(m.measure(41)("ΩMEGA")).toBeGreaterThan(0);
    } finally {
      await m.close();
    }
  }, 120_000);

  test("a render boot refuses a metrics-only pak", async () => {
    const entries = (await import("node:fs")).readdirSync(cacheDir).filter((e) => !e.includes(".tmp-"));
    const dist = join(cacheDir, entries[0]!, "dist");
    await expect(
      hardenedBootWorld({ bundlePath: join(dist, "main.js"), pakPath: join(dist, "main.pak"), width: 64, height: 64, hz: 30 }),
    ).rejects.toThrow(/metrics-only/);
    const ok = await hardenedBootWorld({
      bundlePath: join(dist, "main.js"), pakPath: join(dist, "main.pak"), width: 64, height: 64, hz: 30,
      allowMetricsOnly: true,
    });
    expect(typeof ok.frame).toBe("function");
  }, 60_000);
});
